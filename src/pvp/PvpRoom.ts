// ============================================================
// PvpRoom — PVP 房间协议层
// 负责：玩家加入/离开、商店倒计时、快照交换
// Hub-and-spoke：所有消息经房主中继
// ============================================================

import { WsConnection, type VirtualDataConnection } from '@/pvp/WsConnection'
import type { PvpPlayer, PvpMsgToClient, PvpMsgToHost, PvpMode } from '@/pvp/PvpTypes'
import { getOpponentFromAlive } from '@/pvp/PvpTypes'
import type { BattleSnapshotBundle } from '@/battle/BattleSnapshotStore'
import { getConfig } from '@/core/DataLoader'

function getDefaultCountdownMs(): number {
  return getConfig().pvpRules?.createRoomCountdownMs ?? 120_000
}

export type RoomRole = 'host' | 'client'

export class PvpRoom {
  private peerConn = new WsConnection()
  private role: RoomRole = 'client'

  // Host only: map from peerId → VirtualDataConnection
  private hostConns = new Map<string, VirtualDataConnection>()
  // Client only: connection to host
  private clientConn: VirtualDataConnection | null = null

  // Shared state
  private _players: PvpPlayer[] = []
  private _myIndex = 0
  private _totalPlayers = 4
  private _maxPlayers = 4
  private _initialHp = 30
  // 游戏是否已开始（开始后锁定房间，拒绝迟到加入）
  private gameStarted = false
  // Per-day snapshot collection (host only)
  // 存储每位玩家当天最新提交的快照（shop1→shop2→shop3 滚动覆盖，最新优先）
  private latestDaySnapshots = new Map<number, Map<number, BattleSnapshotBundle>>()
  private dayCountdownTimer: ReturnType<typeof setTimeout> | null = null
  // 已对每位玩家派发过对手快照的记录（day → Set<playerIndex>），防止重复派发
  private dispatchedPlayersByDay = new Map<number, Set<number>>()
  // 已发给每位客户端的对手快照（day → playerIndex → opponentSnap）
  // 用于处理竞态：客户端战斗比宿主慢时迟到提交，宿主补发对手快照
  private dispatchedOpponentSnaps = new Map<number, Map<number, BattleSnapshotBundle>>()
  // Game-over wins collection (host only)
  private playerWins = new Map<number, number>()
  private gameOverBroadcast = false

  // HP / elimination system (host only)
  private playerHps = new Map<number, number>()
  private eliminatedSet = new Set<number>()
  private ghostSnapshots: BattleSnapshotBundle[] = []
  private playerLastSnapshots = new Map<number, BattleSnapshotBundle>()  // 每位玩家最新快照，用于淘汰后的幽灵对手
  private roundResultsByDay = new Map<number, Map<number, { winner: 'player' | 'enemy' | 'draw'; survivingDamage: number }>>()
  private roundEndProcessedDays = new Set<number>()  // 防止 hostProcessRoundEnd 重入
  // day → 该天分发快照时的存活玩家 index 列表（升序），供 hostProcessRoundEnd 对称使用
  private dayAliveIndices = new Map<number, number[]>()
  // 每位玩家本局是否已触发过绝地反击（仅一次）
  private lastStandUsed = new Set<number>()
  // 每位玩家本局是否已应用过英雄额外红心（hero9）
  private heroHpBonusApplied = new Set<number>()
  // 淘汰顺序记录：按淘汰先后排列 playerIndex，第一个元素为最先被淘汰的玩家
  private eliminationOrder: number[] = []
  // sync-a：每天预计算的轮空配对（playerIndex → mirrorOpponentIndex）
  private byePairingsByDay = new Map<number, Map<number, number>>()
  // sync-a：每天已进入商店的玩家集合（host only），全员到位后触发倒计时
  private shopEnteredByDay = new Map<number, Set<number>>()
  // sync-a：已触发过倒计时的天数，防止重复广播
  private countdownStartedDays = new Set<number>()
  // 周期性状态重检定时器：每 60s 重新评估所有活跃天的就绪状态
  // 对齐 relay 心跳周期（30s），兜底 relay close 通知偶发丢失的情况
  private stateCheckInterval: ReturnType<typeof setInterval> | null = null

  pvpMode: PvpMode = 'async'
  // Mode A: sync-ready tracking per day
  private daySyncReadyPlayers = new Map<number, Set<number>>() // day → set of playerIndex
  onBattleSyncStart?: (day: number) => void
  onCountdownStart?: (day: number) => void

  // ---------- Callbacks (set by PvpContext / PvpLobbyScene) ----------
  onRoomStateChange?: (players: PvpPlayer[]) => void
  onGameStart?: (myIndex: number, totalPlayers: number) => void
  onDayReady?: (day: number, countdownMs: number, byeOpponentMap?: Record<number, number>) => void
  onPlayerStatusUpdate?: (day: number, readyIndices: number[]) => void
  onOpponentSnapshot?: (day: number, snapshot: BattleSnapshotBundle, opponentPlayerIndex?: number) => void
  onGameOver?: (rankings: { nickname: string; wins: number | null; index: number }[]) => void
  onError?: (msg: string) => void
  onRoundSummary?: (day: number, hpMap: Record<number, number>, newlyEliminated: number[], snapshots: Record<number, BattleSnapshotBundle>, lastStandTriggered: number[]) => void
  onSyncReadyUpdate?: (day: number, readyIndices: number[]) => void
  onUrgeNotify?: (fromPlayerIndex: number, fromNickname: string) => void

  get players(): PvpPlayer[] { return this._players }
  get myIndex(): number { return this._myIndex }
  get maxPlayers(): number { return this._maxPlayers }
  get initialHp(): number { return this._initialHp }
  get isHost(): boolean { return this.role === 'host' }

  // ----------------------------------------------------------------
  // 创建房间（房主调用）
  // ----------------------------------------------------------------
  async createRoom(roomCode: string, nickname: string, maxPlayers: number, initialHp = 30): Promise<void> {
    this.role = 'host'

    this._maxPlayers = maxPlayers
    this._totalPlayers = maxPlayers
    this._initialHp = initialHp

    await this.peerConn.create(roomCode)

    // 房主自己是玩家 0
    this._myIndex = 0
    this._players = [{
      peerId: roomCode,
      nickname,
      index: 0,
      connected: true,
      isAi: false,
    }]

    this.peerConn.onConnection((conn) => this.handleIncomingConnection(conn))
    this.peerConn.onError((err) => this.onError?.(err.message))
  }

  // ----------------------------------------------------------------
  // 加入房间（客户端调用）
  // ----------------------------------------------------------------
  async joinRoom(roomCode: string, nickname: string): Promise<void> {
    this.role = 'client'

    // 客户端用随机 ID
    await this.peerConn.create()
    const conn = await this.peerConn.connect(roomCode)
    this.clientConn = conn

    conn.on('data', (raw) => this.handleClientMessage(raw as PvpMsgToClient))
    conn.on('close', () => this.onError?.('与房主的连接已断开'))
    conn.on('error', (err) => this.onError?.(String(err)))

    // 发送加入请求
    this.sendToHost({ type: 'join', nickname })
  }

  // ----------------------------------------------------------------
  // 房主：处理新连接
  // ----------------------------------------------------------------
  private handleIncomingConnection(conn: VirtualDataConnection): void {
    conn.on('open', () => {
      this.hostConns.set(conn.peer, conn)
      conn.on('data', (raw) => this.handleHostReceive(conn.peer, raw as PvpMsgToHost))
      conn.on('close', () => this.handlePeerDisconnect(conn.peer))
    })
  }

  private handleHostReceive(peerId: string, msg: PvpMsgToHost): void {
    if (msg.type === 'join') {
      // 游戏已开始：拒绝迟到加入，主动关闭连接
      if (this.gameStarted) {
        console.log('[PvpRoom] 拒绝迟到加入（游戏已开始）peerId=' + peerId)
        const conn = this.hostConns.get(peerId)
        conn?.close()
        this.hostConns.delete(peerId)
        return
      }

      // 去重：同一个 peer 重复发 join 时只广播最新房间状态，不重复添加
      if (this._players.find((p) => p.peerId === peerId)) {
        this.broadcastRoomState()
        return
      }

      // 断线重连：同名玩家已在房间但断线，复用原有槽位
      const disconnected = this._players.find((p) => !p.isAi && !p.connected && p.nickname === msg.nickname)
      if (disconnected) {
        disconnected.peerId = peerId
        disconnected.connected = true
        this.broadcastRoomState()
        this.onRoomStateChange?.(this._players)
        return
      }

      // 分配 index
      const usedIndices = new Set(this._players.map((p) => p.index))
      let idx = 1
      while (usedIndices.has(idx)) idx++

      const player: PvpPlayer = {
        peerId,
        nickname: msg.nickname,
        index: idx,
        connected: true,
        isAi: false,
      }
      this._players.push(player)

      // 广播房间状态
      this.broadcastRoomState()
      this.onRoomStateChange?.(this._players)
    } else if (msg.type === 'snapshot_ready') {
      const player = this._players.find((p) => p.peerId === peerId)
      if (!player) { console.warn('[PvpRoom] snapshot_ready: unknown peerId', peerId); return }

      // 迟到最终快照：该玩家已分发过对手快照，补发一次（竞态保护）
      const alreadyDispatched = this.dispatchedPlayersByDay.get(msg.day)?.has(player.index)
      if (alreadyDispatched && msg.isFinal) {
        const opponentSnap = this.dispatchedOpponentSnaps.get(msg.day)?.get(player.index)
        if (opponentSnap) {
          console.log('[PvpRoom] 迟到最终快照补发 day=' + msg.day + ' → player[' + player.index + '] ' + player.nickname)
          this.sendToPlayer(player.index, { type: 'opponent_snapshot', day: msg.day, snapshot: opponentSnap })
        }
        return
      }
      this.hostReceiveSnapshot(peerId, msg.day, msg.snapshot, msg.isFinal ?? false)
    } else if (msg.type === 'wins_report') {
      const player = this._players.find((p) => p.peerId === peerId)
      if (player) {
        this.playerWins.set(player.index, msg.wins)
        console.log('[PvpRoom] 收到胜场上报 player[' + player.index + '] ' + player.nickname + ' wins=' + msg.wins)
        this.hostTryBroadcastGameOver()
      }
    } else if (msg.type === 'battle_sync_ready') {
      const player = this._players.find((p) => p.peerId === peerId)
      if (!player) return
      const day = msg.day
      if (!this.daySyncReadyPlayers.has(day)) this.daySyncReadyPlayers.set(day, new Set())
      this.daySyncReadyPlayers.get(day)!.add(player.index)
      // 广播当前就绪状态给所有人
      const readyIndices = Array.from(this.daySyncReadyPlayers.get(day)!)
      this.broadcastToClients({ type: 'sync_ready_update', day, readyIndices })
      this.onSyncReadyUpdate?.(day, readyIndices)
      this.tryTriggerSyncStart(day)
    } else if (msg.type === 'shop_entered') {
      const player = this._players.find((p) => p.peerId === peerId)
      if (!player) return
      if (!this.shopEnteredByDay.has(msg.day)) this.shopEnteredByDay.set(msg.day, new Set())
      this.shopEnteredByDay.get(msg.day)!.add(player.index)
      this.checkAndStartCountdown(msg.day)
    } else if (msg.type === 'urge') {
      const fromPlayer = this._players.find((p) => p.peerId === peerId)
      if (!fromPlayer) return
      const target = this._players.find((p) => p.index === msg.targetPlayerIndex)
      if (!target) return
      if (target.index === 0) {
        // 催促 host 自身
        this.onUrgeNotify?.(fromPlayer.index, fromPlayer.nickname)
      } else {
        this.sendToPlayer(target.index, { type: 'urge_notify', fromPlayerIndex: fromPlayer.index, fromNickname: fromPlayer.nickname })
      }
    } else if (msg.type === 'round_result') {
      const player = this._players.find((p) => p.peerId === peerId)
      if (player) {
        this.hostReceiveRoundResult(player.index, msg.day, msg.winner, msg.survivingDamage)
      }
    }
  }

  private handlePeerDisconnect(peerId: string): void {
    const player = this._players.find((p) => p.peerId === peerId)
    if (player) {
      if (!this.gameStarted) {
        // 游戏未开始：直接移除玩家，避免残留断线玩家占据槽位
        this._players = this._players.filter((p) => p.peerId !== peerId)
      } else {
        // 游戏进行中：标记断线以支持同名玩家重连
        player.connected = false
      }
    }
    this.hostConns.delete(peerId)
    this.broadcastRoomState()
    this.onRoomStateChange?.(this._players)
    // 断线后重新检查各阶段就绪状态，避免断线玩家永久阻塞游戏推进
    // 使用 latestDaySnapshots.keys() 遍历所有已激活的天数（比 daySyncReadyPlayers/shopEnteredByDay 更完整）
    if (this.gameStarted) {
      for (const day of this.latestDaySnapshots.keys()) {
        this.tryTriggerSyncStart(day)
        this.checkAndStartCountdown(day)
      }
      // 补检正在等待结算的回合：断线玩家不再阻塞 round_result 收集
      for (const day of this.roundResultsByDay.keys()) {
        if (this.roundEndProcessedDays.has(day)) continue
        const connectedAlivePlayers = this._players.filter((p) => !p.isAi && !this.eliminatedSet.has(p.index) && p.connected)
        if (connectedAlivePlayers.length > 0 && connectedAlivePlayers.every((p) => this.roundResultsByDay.get(day)?.has(p.index))) {
          this.hostProcessRoundEnd(day)
        }
      }
    }
  }

  // ----------------------------------------------------------------
  // 客户端：处理来自房主的消息
  // ----------------------------------------------------------------
  private handleClientMessage(msg: PvpMsgToClient): void {
    switch (msg.type) {
      case 'room_state':
        this._players = msg.players.map((p) => ({
          ...p,
          peerId: p.index === this._myIndex ? (this.peerConn.peerId ?? '') : '',
        }))
        this._maxPlayers = msg.maxPlayers
        this.onRoomStateChange?.(this._players)
        break
      case 'game_start':
        this._myIndex = msg.myIndex
        this._totalPlayers = msg.totalPlayers
        this._initialHp = msg.initialHp
        this.onGameStart?.(msg.myIndex, msg.totalPlayers)
        break
      case 'day_ready':
        this.onDayReady?.(msg.day, msg.countdownMs, msg.byeOpponentMap)
        break
      case 'player_status':
        this.onPlayerStatusUpdate?.(msg.day, msg.readyIndices)
        break
      case 'opponent_snapshot':
        this.onOpponentSnapshot?.(msg.day, msg.snapshot, msg.opponentPlayerIndex)
        break
      case 'game_over':
        this.onGameOver?.(msg.rankings)
        break
      case 'battle_sync_start':
        this.onBattleSyncStart?.(msg.day)
        break
      case 'round_summary':
        this.onRoundSummary?.(msg.day, msg.hpMap, msg.newlyEliminated, msg.snapshots, msg.lastStandTriggered)
        break
      case 'sync_ready_update':
        this.onSyncReadyUpdate?.(msg.day, msg.readyIndices)
        break
      case 'urge_notify':
        this.onUrgeNotify?.(msg.fromPlayerIndex, msg.fromNickname)
        break
      case 'countdown_start':
        this.onCountdownStart?.(msg.day)
        break
    }
  }

  // ----------------------------------------------------------------
  // 房主：开始游戏
  // ----------------------------------------------------------------
  startGame(): void {
    if (!this.isHost) return

    this.gameStarted = true  // 锁定房间，拒绝后续加入

    // 只使用实际加入的真人玩家，不补 AI
    this._totalPlayers = this._players.length

    // Initialize HP for all players
    const initHp = this._initialHp
    this._players.forEach((p) => this.playerHps.set(p.index, initHp))
    this.lastStandUsed.clear()
    this.heroHpBonusApplied.clear()

    // 广播房间状态
    this.broadcastRoomState()

    // 通知每个客户端开始游戏
    this._players.forEach((player) => {
      if (player.index === 0) return
      this.sendToPlayer(player.index, {
        type: 'game_start',
        myIndex: player.index,
        totalPlayers: this._totalPlayers,
        countdownMs: getDefaultCountdownMs(),
        initialHp: this._initialHp,
      })
    })

    // 房主自己触发 onGameStart
    this.onGameStart?.(0, this._totalPlayers)

    // 启动周期状态重检（对齐 relay 心跳周期，兜底 close 通知偶发丢失）
    this.stateCheckInterval = setInterval(() => {
      for (const day of this.latestDaySnapshots.keys()) {
        this.tryTriggerSyncStart(day)
        this.checkAndStartCountdown(day)
      }
    }, 60_000)

    // 马上开始 Day 1
    setTimeout(() => this.hostStartDay(1), 300)
  }

  // ----------------------------------------------------------------
  // 房主：开始某天的商店倒计时
  // ----------------------------------------------------------------
  hostStartDay(day: number): void {
    if (!this.isHost) return
    this.latestDaySnapshots.set(day, new Map())
    this.dispatchedPlayersByDay.set(day, new Set())

    // sync-a：预计算轮空配对，随 day_ready 下发，客户端商店阶段即可展示对手
    let byeOpponentMap: Record<number, number> | undefined
    if (this.pvpMode === 'sync-a') {
      const aliveForDay = this._players
        .filter(p => !p.isAi && !this.eliminatedSet.has(p.index))
        .map(p => p.index)
        .sort((a, b) => a - b)
      const byePairings = new Map<number, number>()
      for (const idx of aliveForDay) {
        const oppIdx = getOpponentFromAlive(idx, aliveForDay, day - 1)
        if (oppIdx < 0) {
          // 轮空：确定性选第一个其他存活玩家作为镜像（保证客户端可复现）
          const mirror = aliveForDay.find(i => i !== idx)
          if (mirror !== undefined) byePairings.set(idx, mirror)
        }
      }
      this.byePairingsByDay.set(day, byePairings)
      if (byePairings.size > 0) {
        byeOpponentMap = {}
        byePairings.forEach((opp, player) => { byeOpponentMap![player] = opp })
      }
    }

    const countdownMs = getDefaultCountdownMs()
    this.broadcastToClients({ type: 'day_ready', day, countdownMs, byeOpponentMap })
    this.onDayReady?.(day, countdownMs, byeOpponentMap)

    // 补检：若所有玩家已在 hostStartDay 之前进入商店（shop_entered 先于 day 初始化到达），
    // 在此处补触发倒计时，此时 countdownTotalMs 已由 onDayReady 设置为正确值
    this.checkAndStartCountdown(day)

    // 安全兜底：10分钟后对所有尚未收到分发的存活玩家强制用昨日快照分发
    if (this.dayCountdownTimer) clearTimeout(this.dayCountdownTimer)
    this.dayCountdownTimer = setTimeout(() => {
      this.hostForceDispatchAll(day)
    }, 600_000)
  }

  /** 玩家进入商店时上报（host 本地调用；客户端发消息给 host） */
  notifyShopEntered(day: number): void {
    if (this.pvpMode !== 'sync-a') return
    if (this.isHost) {
      if (!this.shopEnteredByDay.has(day)) this.shopEnteredByDay.set(day, new Set())
      this.shopEnteredByDay.get(day)!.add(this._myIndex)
      this.checkAndStartCountdown(day)
    } else {
      this.sendToHost({ type: 'shop_entered', day })
    }
  }

  /** 检查所有存活且在线玩家是否已进入商店，若是则广播倒计时开始 */
  private checkAndStartCountdown(day: number): void {
    if (this.countdownStartedDays.has(day)) return
    // 只有 hostStartDay 已初始化该天后才允许启动倒计时，防止 shop_entered 比 hostStartDay 更早到达时
    // 以 countdownTotalMs=0 触发即时倒计时（500ms 后自动提交空快照直接开战）
    if (!this.latestDaySnapshots.has(day)) return
    const entered = this.shopEnteredByDay.get(day) ?? new Set()
    const aliveHumans = this._players.filter((p) => !p.isAi && !this.eliminatedSet.has(p.index) && p.connected)
    if (aliveHumans.length > 0 && aliveHumans.every((p) => entered.has(p.index))) {
      console.log('[PvpRoom] 所有玩家已进入商店，启动倒计时 day=' + day)
      this.countdownStartedDays.add(day)
      this.broadcastToClients({ type: 'countdown_start', day })
      this.onCountdownStart?.(day)
    }
  }

  /** 安全兜底：强制向所有未分发的存活玩家派发（使用可用的最佳快照） */
  private hostForceDispatchAll(day: number): void {
    if (!this.isHost) return
    const aliveHumans = this._players.filter((p) => !p.isAi && !this.eliminatedSet.has(p.index))
    const dispatched = this.dispatchedPlayersByDay.get(day) ?? new Set()
    for (const player of aliveHumans) {
      if (!dispatched.has(player.index)) {
        console.log('[PvpRoom] 兜底分发 day=' + day + ' player[' + player.index + ']')
        this.hostDispatchToPlayer(player.index, day)
      }
    }
  }

  // ----------------------------------------------------------------
  // 房主：收到某个玩家的快照（中间或最终）
  // ----------------------------------------------------------------
  private hostReceiveSnapshot(peerId: string, day: number, snapshot: BattleSnapshotBundle, isFinal = false): void {
    if (!this.isHost) return
    const player = this._players.find((p) => p.peerId === peerId)
    if (!player) { console.warn('[PvpRoom] hostReceiveSnapshot: unknown peerId', peerId); return }

    this.hostStoreAndMaybeDispatch(player.index, day, snapshot, isFinal)
  }

  /** 房主提交自己的快照 */
  hostSubmitSnapshot(day: number, snapshot: BattleSnapshotBundle, isFinal = false): void {
    if (!this.isHost) return
    this.hostStoreAndMaybeDispatch(0, day, snapshot, isFinal)
  }

  /** 更新快照并在 isFinal 时分发（sync-a：等全员提交后统一分发；async：立即分发） */
  private hostStoreAndMaybeDispatch(playerIndex: number, day: number, snapshot: BattleSnapshotBundle, isFinal: boolean): void {
    this.tryApplyHeroHpBonus(playerIndex, snapshot)

    // 始终更新 latestDaySnapshots（shop1→shop2→shop3 覆盖）
    const map = this.latestDaySnapshots.get(day) ?? new Map<number, BattleSnapshotBundle>()
    this.latestDaySnapshots.set(day, map)
    map.set(playerIndex, snapshot)

    console.log('[PvpRoom] 收到' + (isFinal ? '最终' : '中间') + '快照 day=' + day + ' player[' + playerIndex + '] isFinal=' + isFinal)

    if (isFinal) {
      // 最终快照：更新昨日存档（供后续天数的兜底）
      this.playerLastSnapshots.set(playerIndex, snapshot)

      if (this.pvpMode === 'sync-a') {
        // sync-a：不立即分发，等所有存活玩家提交后在 notifySyncReady 时统一分发
        // 确保所有人拿到的都是当日最新阵容
      } else {
        // async：立即分发（先提交先战斗）
        this.hostDispatchToPlayer(playerIndex, day)
      }
    }
  }

  private tryApplyHeroHpBonus(playerIndex: number, snapshot: BattleSnapshotBundle): void {
    if (!this.isHost) return
    if (this.heroHpBonusApplied.has(playerIndex)) return
    if (snapshot.ownerHeroId !== 'hero9') return
    const currentHp = this.playerHps.get(playerIndex)
    if (typeof currentHp !== 'number' || !Number.isFinite(currentHp)) return
    this.playerHps.set(playerIndex, currentHp + 10)
    this.heroHpBonusApplied.add(playerIndex)
  }

  // ----------------------------------------------------------------
  // 房主：向单个玩家分发 PVP 对手快照（即时分发，无需等待所有人）
  // 快照优先级：当天最新提交 > 昨日快照 > 空快照
  // ----------------------------------------------------------------
  private hostDispatchToPlayer(playerIndex: number, day: number): void {
    if (!this.isHost) return
    if (this.eliminatedSet.has(playerIndex)) return

    // 防重派发：同一天同一玩家只分发一次
    if (!this.dispatchedPlayersByDay.has(day)) this.dispatchedPlayersByDay.set(day, new Set())
    const dispatched = this.dispatchedPlayersByDay.get(day)!
    if (dispatched.has(playerIndex)) {
      console.warn('[PvpRoom] 已分发，跳过 day=' + day + ' player[' + playerIndex + ']')
      return
    }
    dispatched.add(playerIndex)

    // 计算当天存活玩家列表并记录（供 hostProcessRoundEnd 对称使用）
    const aliveIndices = this._players
      .filter((p) => !p.isAi && !this.eliminatedSet.has(p.index))
      .map((p) => p.index)
      .sort((a, b) => a - b)
    if (!this.dayAliveIndices.has(day)) {
      this.dayAliveIndices.set(day, aliveIndices)
    }

    const latestMap = this.latestDaySnapshots.get(day) ?? new Map<number, BattleSnapshotBundle>()
    const opponentIdx = getOpponentFromAlive(playerIndex, aliveIndices, day - 1)

    let opponentSnap: BattleSnapshotBundle
    let resolvedOpponentIdx = opponentIdx

    if (opponentIdx < 0) {
      // 轮空：优先使用 hostStartDay 预计算的确定性镜像配对（与 day_ready 下发的保持一致）
      const preMirror = this.byePairingsByDay.get(day)?.get(playerIndex) ?? -1
      const mirrorIdx = preMirror >= 0 ? preMirror : -1
      if (mirrorIdx >= 0) {
        // 用预配对玩家的当天快照（若已提交）或昨日快照
        opponentSnap = latestMap.get(mirrorIdx)
          ?? this.playerLastSnapshots.get(mirrorIdx)
          ?? this.getGhostOrEmpty(day)
        resolvedOpponentIdx = mirrorIdx
      } else {
        // 兜底：从当天已提交中选第一个（确定性，非随机）
        const candidates = [...latestMap.entries()]
          .filter(([idx]) => idx !== playerIndex && !this.eliminatedSet.has(idx))
          .sort(([a], [b]) => a - b)
        if (candidates.length > 0) {
          const [ownerIdx, snap] = candidates[0]!
          opponentSnap = snap
          resolvedOpponentIdx = ownerIdx
        } else {
          opponentSnap = this.playerLastSnapshots.get(playerIndex) ?? this.getGhostOrEmpty(day)
          resolvedOpponentIdx = -1
        }
      }
    } else {
      // 常规对战：使用对手当天最新快照，若无则用昨日快照
      opponentSnap = latestMap.get(opponentIdx)
        ?? this.playerLastSnapshots.get(opponentIdx)
        ?? this.getGhostOrEmpty(day)

      if (!latestMap.has(opponentIdx)) {
        console.log('[PvpRoom] player[' + playerIndex + '] 使用对手昨日快照 (opponent[' + opponentIdx + '] 未提交当天快照)')
      }
    }

    console.log('[PvpRoom] 即时分发→player[' + playerIndex + '] vs opponent[' + resolvedOpponentIdx + '] entities=' + opponentSnap.entities.length)

    // 记录已分发快照（用于迟到补发）
    if (!this.dispatchedOpponentSnaps.has(day)) this.dispatchedOpponentSnaps.set(day, new Map())
    this.dispatchedOpponentSnaps.get(day)!.set(playerIndex, opponentSnap)

    if (playerIndex === 0) {
      // Host 自身触发放最后，防止同步场景跳转影响其他逻辑
      this.onOpponentSnapshot?.(day, opponentSnap, resolvedOpponentIdx >= 0 ? resolvedOpponentIdx : undefined)
    } else {
      this.sendToPlayer(playerIndex, {
        type: 'opponent_snapshot',
        day,
        snapshot: opponentSnap,
        opponentPlayerIndex: resolvedOpponentIdx >= 0 ? resolvedOpponentIdx : undefined,
      })
    }
  }

  // ----------------------------------------------------------------
  // 客户端：提交快照（isFinal=true 表示 Shop3 最终快照，触发立即分发）
  // ----------------------------------------------------------------
  submitSnapshot(day: number, snapshot: BattleSnapshotBundle, isFinal = false): void {
    if (this.isHost) {
      this.hostSubmitSnapshot(day, snapshot, isFinal)
    } else {
      this.sendToHost({ type: 'snapshot_ready', day, snapshot, isFinal })
    }
  }

  // ----------------------------------------------------------------
  // 房主：触发下一天（由 PvpContext 在战斗结束后调用）
  // ----------------------------------------------------------------
  advanceToDay(day: number): void {
    if (!this.isHost) return
    setTimeout(() => this.hostStartDay(day), 500)
  }

  // ----------------------------------------------------------------
  // 游戏结束：上报自己胜场 / 客户端发送给房主
  // ----------------------------------------------------------------
  reportWins(wins: number): void {
    if (this.isHost) {
      this.playerWins.set(0, wins)
      console.log('[PvpRoom] 房主上报胜场 wins=' + wins)
      this.hostTryBroadcastGameOver()
      // 5s 兜底：部分客户端断线未上报时强制广播
      setTimeout(() => {
        if (!this.gameOverBroadcast) {
          console.log('[PvpRoom] 兜底：强制广播 game_over')
          this.gameOverBroadcast = true
          const rankings = this.buildRankings()
          this.broadcastToClients({ type: 'game_over', rankings })
          this.onGameOver?.(rankings)
          this.dispatchedOpponentSnaps.clear()
        }
      }, 5000)
    } else {
      this.sendToHost({ type: 'wins_report', wins })
    }
  }

  private buildRankings(): { nickname: string; wins: number | null; index: number }[] {
    return this._players
      .map((p) => ({ nickname: p.nickname, wins: this.playerWins.get(p.index) ?? null, index: p.index }))
      .sort((a, b) => (b.wins ?? -1) - (a.wins ?? -1))
  }

  private hostTryBroadcastGameOver(): void {
    if (this.gameOverBroadcast) return
    const humanPlayers = this._players.filter((p) => !p.isAi)
    if (!humanPlayers.every((p) => this.playerWins.has(p.index))) return
    this.gameOverBroadcast = true
    const rankings = this.buildRankings()
    console.log('[PvpRoom] 所有真人玩家已上报，广播 game_over rankings=' + JSON.stringify(rankings))
    this.broadcastToClients({ type: 'game_over', rankings })
    this.onGameOver?.(rankings)
    // 游戏结束后清理补发缓存
    this.dispatchedOpponentSnaps.clear()
  }

  // ----------------------------------------------------------------
  // 发送工具
  // ----------------------------------------------------------------
  private sendToHost(msg: PvpMsgToHost): void {
    try {
      this.clientConn?.send(msg)
    } catch (e) {
      console.warn('[PvpRoom] sendToHost error', e)
    }
  }

  private sendToPlayer(playerIndex: number, msg: PvpMsgToClient): void {
    const player = this._players.find((p) => p.index === playerIndex)
    if (!player || player.isAi) return
    const conn = this.hostConns.get(player.peerId)
    try {
      conn?.send(msg)
    } catch (e) {
      console.warn('[PvpRoom] sendToPlayer error', e)
    }
  }

  private broadcastToClients(msg: PvpMsgToClient): void {
    for (const conn of this.hostConns.values()) {
      try {
        conn.send(msg)
      } catch (e) {
        console.warn('[PvpRoom] broadcast error', e)
      }
    }
  }

  private broadcastRoomState(): void {
    const state = this._players.map((p) => ({
      nickname: p.nickname,
      index: p.index,
      connected: p.connected,
      isAi: p.isAi,
    }))
    this.broadcastToClients({ type: 'room_state', players: state, maxPlayers: this._maxPlayers })
  }

  /** 检查在线存活玩家是否全员 sync-ready，若是则统一分发快照并广播开战 */
  private tryTriggerSyncStart(day: number): void {
    if (!this.isHost) return
    const humanPlayers = this._players.filter((p) => !p.isAi && !this.eliminatedSet.has(p.index) && p.connected)
    if (humanPlayers.length > 0 && humanPlayers.every((p) => this.daySyncReadyPlayers.get(day)?.has(p.index))) {
      console.log('[PvpRoom] 所有在线玩家 sync-ready，统一分发快照 + 广播 battle_sync_start day=' + day)
      for (const p of humanPlayers) {
        this.hostDispatchToPlayer(p.index, day)
      }
      this.broadcastToClients({ type: 'battle_sync_start', day })
      this.onBattleSyncStart?.(day)
    }
  }

  /** Mode A: client/host signals ready for sync battle */
  notifySyncReady(day: number): void {
    if (this.isHost) {
      if (!this.daySyncReadyPlayers.has(day)) this.daySyncReadyPlayers.set(day, new Set())
      this.daySyncReadyPlayers.get(day)!.add(0)
      // 广播当前就绪状态
      const readyIndices = Array.from(this.daySyncReadyPlayers.get(day)!)
      this.broadcastToClients({ type: 'sync_ready_update', day, readyIndices })
      this.onSyncReadyUpdate?.(day, readyIndices)
      this.tryTriggerSyncStart(day)
      // 注：断线兜底由 stateCheckInterval（60s 周期）统一负责，无需每天单独设 timer
    } else {
      this.sendToHost({ type: 'battle_sync_ready', day })
    }
  }

  /** 催促某个玩家（client/host 均可调用） */
  sendUrge(targetPlayerIndex: number): void {
    if (this.isHost) {
      // host 催促别人：直接发给目标
      const target = this._players.find((p) => p.index === targetPlayerIndex)
      if (!target || target.isAi) return
      const me = this._players.find((p) => p.index === 0)
      if (!me) return
      this.sendToPlayer(target.index, { type: 'urge_notify', fromPlayerIndex: 0, fromNickname: me.nickname })
    } else {
      this.sendToHost({ type: 'urge', targetPlayerIndex })
    }
  }

  // ----------------------------------------------------------------
  // HP / elimination system
  // ----------------------------------------------------------------

  /** Bye 轮 / 对手已淘汰：优先返回幽灵快照（已淘汰玩家的阵容），否则返回空快照（玩家自动获胜） */
  private getGhostOrEmpty(day: number): BattleSnapshotBundle {
    if (this.ghostSnapshots.length > 0) {
      return this.ghostSnapshots[Math.floor(Math.random() * this.ghostSnapshots.length)]!
    }
    return this.makeEmptySnapshot(day)
  }

  /** 返回无实体的空快照（用于 bye 轮对手 / 断线补全） */
  private makeEmptySnapshot(day: number): BattleSnapshotBundle {
    return { day, activeColCount: 1, createdAtMs: Date.now(), entities: [] }
  }

  /** Called at end of each round to report result (winner + survivingDamage) */
  reportRoundResult(day: number, winner: 'player' | 'enemy' | 'draw', survivingDamage: number): void {
    if (this.isHost) {
      this.hostReceiveRoundResult(0, day, winner, survivingDamage)
    } else {
      this.sendToHost({ type: 'round_result', day, winner, survivingDamage })
    }
  }

  private hostReceiveRoundResult(playerIndex: number, day: number, winner: 'player' | 'enemy' | 'draw', survivingDamage: number): void {
    if (!this.isHost) return
    if (!this.roundResultsByDay.has(day)) this.roundResultsByDay.set(day, new Map())
    this.roundResultsByDay.get(day)!.set(playerIndex, { winner, survivingDamage })
    console.log('[PvpRoom] round_result day=' + day + ' player[' + playerIndex + '] winner=' + winner + ' dmg=' + survivingDamage)

    // 只等待在线的存活真人玩家上报（断线玩家不阻塞结算）
    const humanAlivePlayers = this._players.filter((p) => !p.isAi && !this.eliminatedSet.has(p.index) && p.connected)
    const allReported = humanAlivePlayers.length > 0 && humanAlivePlayers.every((p) => this.roundResultsByDay.get(day)?.has(p.index))
    if (allReported) {
      this.hostProcessRoundEnd(day)
    }
  }

  private hostProcessRoundEnd(day: number): void {
    if (this.roundEndProcessedDays.has(day)) {
      console.warn('[PvpRoom] hostProcessRoundEnd day=' + day + ' 重复调用，已忽略')
      return
    }
    this.roundEndProcessedDays.add(day)
    const results = this.roundResultsByDay.get(day)
    if (!results) return
    const hpMap: Record<number, number> = {}
    const newlyEliminated: number[] = []
    const lastStandTriggered: number[] = []

    // 只处理存活的真人玩家 HP（AI 玩家不参与 HP 计算）
    // 使用派发快照时记录的存活列表，保证配对与分发时一致
    const aliveIndices = this.dayAliveIndices.get(day) ?? []
    const alivePlayers = this._players.filter((p) => !p.isAi && !this.eliminatedSet.has(p.index))
    for (const player of alivePlayers) {
      const opponentIdx = getOpponentFromAlive(player.index, aliveIndices, day - 1)
      const myResult = results.get(player.index)
      // 断线玩家无结果上报，视为本轮落败（扣血并可能淘汰）
      const lost = myResult?.winner === 'enemy' || (myResult === undefined && !player.connected)
      if (lost) {
        void opponentIdx
        const damage = Math.max(1, Math.min(8, Math.round(day)))
        const currentHp = this.playerHps.get(player.index) ?? 0
        let newHp = Math.max(0, currentHp - damage)
        if (newHp <= 0 && !this.lastStandUsed.has(player.index)) {
          newHp = 1
          this.lastStandUsed.add(player.index)
          lastStandTriggered.push(player.index)
        }
        this.playerHps.set(player.index, newHp)
      }
      hpMap[player.index] = this.playerHps.get(player.index) ?? 0
    }

    // Check for new eliminations
    for (const player of alivePlayers) {
      if ((this.playerHps.get(player.index) ?? 0) <= 0) {
        this.eliminatedSet.add(player.index)
        newlyEliminated.push(player.index)
        // 记录淘汰顺序（先被淘汰的在前）
        if (!this.eliminationOrder.includes(player.index)) {
          this.eliminationOrder.push(player.index)
        }
        // 从缓存的最新快照中取该玩家的阵容存入幽灵池
        const lastSnap = this.playerLastSnapshots.get(player.index)
        if (lastSnap) this.ghostSnapshots.push(lastSnap)
        console.log('[PvpRoom] player[' + player.index + '] eliminated at day=' + day + ' eliminationOrder=' + JSON.stringify(this.eliminationOrder))
      }
    }

    // 淘汰后重新检查：若有玩家已提交最终快照但等待分发，立即触发（解决竞态）
    // 新机制下，分发是按玩家独立触发的，淘汰后不需要重新扫描

    // 构造所有玩家上局快照 map（用于客户端查看阵容）
    const snapshots: Record<number, BattleSnapshotBundle> = {}
    for (const [idx, snap] of this.playerLastSnapshots.entries()) {
      snapshots[idx] = snap
    }

    console.log('[PvpRoom] hostProcessRoundEnd day=' + day + ' hpMap=' + JSON.stringify(hpMap) + ' newlyEliminated=' + JSON.stringify(newlyEliminated) + ' lastStand=' + JSON.stringify(lastStandTriggered))
    this.broadcastToClients({ type: 'round_summary', day, hpMap, newlyEliminated, snapshots, lastStandTriggered })
    this.onRoundSummary?.(day, hpMap, newlyEliminated, snapshots, lastStandTriggered)

    // Check game over
    const cfg = getConfig()
    const maxRounds = cfg.pvpRules?.maxRounds ?? 30
    // 只统计存活的真人玩家数量（AI 不计入胜负）
    const survivorCount = this._players.filter((p) => !p.isAi && !this.eliminatedSet.has(p.index)).length
    if (survivorCount <= 1 || day >= maxRounds) {
      // 排名分数：存活玩家用"总人数 + 剩余HP"保证高于所有淘汰玩家；
      // 淘汰玩家用淘汰顺序索引（越晚淘汰 = 索引越大 = 分数越高 = 排名越靠前）
      this._players.forEach((p) => {
        if (!this.eliminatedSet.has(p.index)) {
          // 存活者：totalPlayers + hp 保证分数高于任何淘汰玩家（最大淘汰索引 < totalPlayers - 1）
          this.playerWins.set(p.index, this._players.length + (this.playerHps.get(p.index) ?? 0))
        } else {
          // 淘汰者：eliminationOrder 中索引越大表示越晚被淘汰，排名越好
          const elimPos = this.eliminationOrder.indexOf(p.index)
          this.playerWins.set(p.index, elimPos) // 0=最先淘汰(最差)，N-1=最后淘汰(较好)
        }
      })
      this.hostTryBroadcastGameOver()
    }
  }

  // ----------------------------------------------------------------
  // 销毁
  // ----------------------------------------------------------------
  destroy(): void {
    if (this.dayCountdownTimer) clearTimeout(this.dayCountdownTimer)
    if (this.stateCheckInterval) clearInterval(this.stateCheckInterval)
    this.hostConns.forEach((conn) => conn.close())
    this.clientConn?.close()
    this.peerConn.destroy()
    this.dispatchedOpponentSnaps.clear()
    this.latestDaySnapshots.clear()
    this.dispatchedPlayersByDay.clear()
    this.shopEnteredByDay.clear()
    this.countdownStartedDays.clear()
  }
}
