// ============================================================
// PvpRoom — PVP 房间协议层
// 负责：玩家加入/离开、商店倒计时、快照交换
// Hub-and-spoke：所有消息经房主中继
// ============================================================

import { WsConnection, type VirtualDataConnection } from '@/pvp/WsConnection'
import type { PvpPlayer, PvpMsgToClient, PvpMsgToHost, PvpMode } from '@/pvp/PvpTypes'
import { getOpponentFromAlive } from '@/pvp/PvpTypes'
import type { BattleSnapshotBundle } from '@/combat/BattleSnapshotStore'
import { getConfig } from '@/core/DataLoader'

const DEFAULT_COUNTDOWN_MS = 90_000

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
  private _initialHp = 6
  // 游戏是否已开始（开始后锁定房间，拒绝迟到加入）
  private gameStarted = false
  // Per-day snapshot collection (host only)
  private daySnapshots = new Map<number, Map<number, BattleSnapshotBundle>>()
  private dayCountdownTimer: ReturnType<typeof setTimeout> | null = null
  // 已派发过的天数（防止重复派发同一天快照）
  private dispatchedDays = new Set<number>()
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
  // day → 该天分发快照时的存活玩家 index 列表（升序），供 hostProcessRoundEnd 对称使用
  private dayAliveIndices = new Map<number, number[]>()
  // 淘汰顺序记录：按淘汰先后排列 playerIndex，第一个元素为最先被淘汰的玩家
  private eliminationOrder: number[] = []

  pvpMode: PvpMode = 'async'
  // Mode A: sync-ready tracking per day
  private daySyncReadyPlayers = new Map<number, Set<number>>() // day → set of playerIndex
  onBattleSyncStart?: (day: number) => void

  // ---------- Callbacks (set by PvpContext / PvpLobbyScene) ----------
  onRoomStateChange?: (players: PvpPlayer[]) => void
  onGameStart?: (myIndex: number, totalPlayers: number) => void
  onDayReady?: (day: number, countdownMs: number) => void
  onPlayerStatusUpdate?: (day: number, readyIndices: number[]) => void
  onOpponentSnapshot?: (day: number, snapshot: BattleSnapshotBundle, opponentPlayerIndex?: number) => void
  onGameOver?: (rankings: { nickname: string; wins: number | null; index: number }[]) => void
  onError?: (msg: string) => void
  onRoundSummary?: (day: number, hpMap: Record<number, number>, newlyEliminated: number[], snapshots: Record<number, BattleSnapshotBundle>) => void

  get players(): PvpPlayer[] { return this._players }
  get myIndex(): number { return this._myIndex }
  get maxPlayers(): number { return this._maxPlayers }
  get initialHp(): number { return this._initialHp }
  get isHost(): boolean { return this.role === 'host' }

  // ----------------------------------------------------------------
  // 创建房间（房主调用）
  // ----------------------------------------------------------------
  async createRoom(roomCode: string, nickname: string, maxPlayers: number, initialHp = 6): Promise<void> {
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
      // 迟到快照处理：该天已派发但客户端可能错过了 opponent_snapshot（竞态），补发一次
      if (this.dispatchedDays.has(msg.day)) {
        const player = this._players.find((p) => p.peerId === peerId)
        const opponentSnap = player ? this.dispatchedOpponentSnaps.get(msg.day)?.get(player.index) : undefined
        if (opponentSnap && player) {
          console.log('[PvpRoom] 迟到快照补发 opponent_snapshot day=' + msg.day + ' → player[' + player.index + '] ' + player.nickname)
          this.sendToPlayer(player.index, { type: 'opponent_snapshot', day: msg.day, snapshot: opponentSnap })
        } else {
          console.warn('[PvpRoom] 忽略已派发天快照（无补发数据）day=' + msg.day + ' from peerId=' + peerId)
        }
        return
      }
      this.hostReceiveSnapshot(peerId, msg.day, msg.snapshot)
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
      const humanPlayers = this._players.filter((p) => !p.isAi && !this.eliminatedSet.has(p.index))
      if (humanPlayers.every((p) => this.daySyncReadyPlayers.get(day)?.has(p.index))) {
        console.log('[PvpRoom] 所有玩家 sync-ready，广播 battle_sync_start day=' + day)
        this.broadcastToClients({ type: 'battle_sync_start', day })
        this.onBattleSyncStart?.(day)
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
        this.onDayReady?.(msg.day, msg.countdownMs)
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
        this.onRoundSummary?.(msg.day, msg.hpMap, msg.newlyEliminated, msg.snapshots)
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

    // 广播房间状态
    this.broadcastRoomState()

    // 通知每个客户端开始游戏
    this._players.forEach((player) => {
      if (player.index === 0) return
      this.sendToPlayer(player.index, {
        type: 'game_start',
        myIndex: player.index,
        totalPlayers: this._totalPlayers,
        countdownMs: DEFAULT_COUNTDOWN_MS,
        initialHp: this._initialHp,
      })
    })

    // 房主自己触发 onGameStart
    this.onGameStart?.(0, this._totalPlayers)

    // 马上开始 Day 1
    setTimeout(() => this.hostStartDay(1), 300)
  }

  // ----------------------------------------------------------------
  // 房主：开始某天的商店倒计时
  // ----------------------------------------------------------------
  hostStartDay(day: number): void {
    if (!this.isHost) return
    this.daySnapshots.set(day, new Map())

    const countdownMs = DEFAULT_COUNTDOWN_MS
    this.broadcastToClients({ type: 'day_ready', day, countdownMs })
    this.onDayReady?.(day, countdownMs)

    // 倒计时结束后强制分发（超时未提交的用 AI 替代）
    if (this.dayCountdownTimer) clearTimeout(this.dayCountdownTimer)
    this.dayCountdownTimer = setTimeout(() => {
      this.hostDispatchSnapshots(day)
    }, countdownMs + 5000) // 5s 额外等待缓冲
  }

  // ----------------------------------------------------------------
  // 房主：收到某个玩家的快照
  // ----------------------------------------------------------------
  private hostReceiveSnapshot(peerId: string, day: number, snapshot: BattleSnapshotBundle): void {
    if (!this.isHost) return
    const player = this._players.find((p) => p.peerId === peerId)
    if (!player) { console.warn('[PvpRoom] hostReceiveSnapshot: unknown peerId', peerId); return }

    const map = this.daySnapshots.get(day) ?? new Map<number, BattleSnapshotBundle>()
    this.daySnapshots.set(day, map)
    map.set(player.index, snapshot)

    const readyIndices = Array.from(map.keys())
    console.log('[PvpRoom] 收到快照 day=' + day + ' from player[' + player.index + '] ' + player.nickname + ' readyIndices=' + JSON.stringify(readyIndices))

    // 广播"已准备"状态
    this.broadcastToClients({ type: 'player_status', day, readyIndices })
    this.onPlayerStatusUpdate?.(day, readyIndices)

    // 检查所有存活真人玩家是否都已提交（淘汰玩家不再等待）
    const humanPlayers = this._players.filter((p) => !p.isAi && !this.eliminatedSet.has(p.index))
    const allReady = humanPlayers.every((p) => map.has(p.index))
    if (allReady) {
      console.log('[PvpRoom] 所有存活真人玩家已提交，分发快照')
      if (this.dayCountdownTimer) clearTimeout(this.dayCountdownTimer)
      this.hostDispatchSnapshots(day)
    }
  }

  /** 房主提交自己的快照 */
  hostSubmitSnapshot(day: number, snapshot: BattleSnapshotBundle): void {
    if (!this.isHost) return
    // 忽略已派发天数（防重派发保护）
    if (this.dispatchedDays.has(day)) {
      console.warn('[PvpRoom] 忽略已派发天快照（host路径）day=' + day)
      return
    }
    const map = this.daySnapshots.get(day) ?? new Map<number, BattleSnapshotBundle>()
    this.daySnapshots.set(day, map)
    map.set(0, snapshot)

    const readyIndices = Array.from(map.keys())
    console.log('[PvpRoom] 房主提交快照 day=' + day + ' readyIndices=' + JSON.stringify(readyIndices))
    this.broadcastToClients({ type: 'player_status', day, readyIndices })
    this.onPlayerStatusUpdate?.(day, readyIndices)

    const humanPlayers = this._players.filter((p) => !p.isAi && !this.eliminatedSet.has(p.index))
    const allReady = humanPlayers.every((p) => map.has(p.index))
    if (allReady) {
      console.log('[PvpRoom] 所有存活真人玩家已提交（host路径），分发快照')
      if (this.dayCountdownTimer) clearTimeout(this.dayCountdownTimer)
      this.hostDispatchSnapshots(day)
    }
  }

  // ----------------------------------------------------------------
  // 房主：分发快照给每个玩家
  // 顺序：先发所有客户端，最后触发房主自身
  // 理由：房主的 onOpponentSnapshot 回调会同步跳转场景，放最后避免影响客户端发送
  // ----------------------------------------------------------------
  private hostDispatchSnapshots(day: number): void {
    if (!this.isHost) return

    // 防重派发：同一天只派发一次
    if (this.dispatchedDays.has(day)) {
      console.warn('[PvpRoom] hostDispatchSnapshots: day=' + day + ' 已派发，跳过')
      return
    }
    this.dispatchedDays.add(day)

    const map = this.daySnapshots.get(day) ?? new Map()

    // 为未提交的真人玩家用空快照补全（断线保护）
    for (const player of this._players) {
      if (!map.has(player.index)) {
        console.log('[PvpRoom] player[' + player.index + '] ' + player.nickname + ' 未提交，用空快照补全')
        map.set(player.index, this.makeEmptySnapshot(day))
      }
    }

    // 记录每个客户端应收到的对手快照，用于迟到提交时补发
    const dayOpponentSnaps = new Map<number, BattleSnapshotBundle>()
    this.dispatchedOpponentSnaps.set(day, dayOpponentSnaps)

    // 当天存活玩家列表（升序），收缩配对算法所用；同时存入 dayAliveIndices 供 hostProcessRoundEnd 使用
    const aliveIndices = this._players
      .filter((p) => !p.isAi && !this.eliminatedSet.has(p.index))
      .map((p) => p.index)
      .sort((a, b) => a - b)
    this.dayAliveIndices.set(day, aliveIndices)
    console.log('[PvpRoom] day=' + day + ' aliveIndices=' + JSON.stringify(aliveIndices))

    // 第一步：向所有存活客户端发送 opponent_snapshot（已淘汰玩家跳过）
    for (const player of this._players) {
      if (player.index === 0 || player.isAi) continue
      if (this.eliminatedSet.has(player.index)) continue
      const opponentIdx = getOpponentFromAlive(player.index, aliveIndices, day - 1)
      let opponentSnap: BattleSnapshotBundle
      let resolvedOpponentIdx = opponentIdx
      if (opponentIdx < 0) {
        const bye = this.getByeOpponentSnap(map, player.index, day)
        opponentSnap = bye.snap
        resolvedOpponentIdx = bye.ownerIndex
      } else {
        opponentSnap = map.get(opponentIdx) ?? this.getGhostOrEmpty(day)
      }
      console.log('[PvpRoom] 分发→client player[' + player.index + '] ' + player.nickname + ' vs opponent[' + resolvedOpponentIdx + '] entities=' + opponentSnap.entities.length)
      dayOpponentSnaps.set(player.index, opponentSnap)
      this.sendToPlayer(player.index, { type: 'opponent_snapshot', day, snapshot: opponentSnap, opponentPlayerIndex: resolvedOpponentIdx >= 0 ? resolvedOpponentIdx : undefined })
    }

    // 第二步：最后触发房主自身（放最后，防止同步场景跳转影响上方发送循环）
    let hostOpponentSnap: BattleSnapshotBundle
    let resolvedHostOpponentIdx: number
    if (this.eliminatedSet.has(0)) {
      // host 已被淘汰，不参与本轮战斗，跳过自身触发
      resolvedHostOpponentIdx = -1
      hostOpponentSnap = this.makeEmptySnapshot(day)
    } else {
      const hostOpponentIdx = getOpponentFromAlive(0, aliveIndices, day - 1)
      resolvedHostOpponentIdx = hostOpponentIdx
      if (hostOpponentIdx < 0) {
        const bye = this.getByeOpponentSnap(map, 0, day)
        hostOpponentSnap = bye.snap
        resolvedHostOpponentIdx = bye.ownerIndex
      } else {
        hostOpponentSnap = map.get(hostOpponentIdx) ?? this.getGhostOrEmpty(day)
      }
      console.log('[PvpRoom] 分发→host vs opponent[' + resolvedHostOpponentIdx + '] entities=' + hostOpponentSnap.entities.length)
      this.onOpponentSnapshot?.(day, hostOpponentSnap, resolvedHostOpponentIdx >= 0 ? resolvedHostOpponentIdx : undefined)
    }

    // 删除前将本轮快照存入 playerLastSnapshots，供淘汰时填入幽灵快照池
    for (const [playerIdx, snap] of map.entries()) {
      this.playerLastSnapshots.set(playerIdx, snap)
    }
    // 清理当天快照数据（节省内存；防重派发已由 dispatchedDays 保护）
    this.daySnapshots.delete(day)
  }

  // ----------------------------------------------------------------
  // 客户端：提交快照
  // ----------------------------------------------------------------
  submitSnapshot(day: number, snapshot: BattleSnapshotBundle): void {
    if (this.isHost) {
      this.hostSubmitSnapshot(day, snapshot)
    } else {
      this.sendToHost({ type: 'snapshot_ready', day, snapshot })
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

  /** Mode A: client/host signals ready for sync battle */
  notifySyncReady(day: number): void {
    if (this.isHost) {
      if (!this.daySyncReadyPlayers.has(day)) this.daySyncReadyPlayers.set(day, new Set())
      this.daySyncReadyPlayers.get(day)!.add(0)
      const humanPlayers = this._players.filter((p) => !p.isAi && !this.eliminatedSet.has(p.index))
      if (humanPlayers.every((p) => this.daySyncReadyPlayers.get(day)?.has(p.index))) {
        console.log('[PvpRoom] 所有玩家 sync-ready（host路径），广播 battle_sync_start day=' + day)
        this.broadcastToClients({ type: 'battle_sync_start', day })
        this.onBattleSyncStart?.(day)
      }
    } else {
      this.sendToHost({ type: 'battle_sync_ready', day })
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

  /**
   * Bye 轮对手快照：从当天存活玩家的提交中随机选一个（排除自身）。
   * 保证 bye 玩家永远面对真实阵容，而非空对手。
   * 返回 { snap, ownerIndex }，ownerIndex 用于在客户端显示真实昵称。
   */
  private getByeOpponentSnap(
    map: Map<number, BattleSnapshotBundle>,
    byePlayerIndex: number,
    day: number,
  ): { snap: BattleSnapshotBundle; ownerIndex: number } {
    const candidates = [...map.entries()]
      .filter(([idx]) => idx !== byePlayerIndex && !this.eliminatedSet.has(idx))
    if (candidates.length > 0) {
      const [ownerIndex, snap] = candidates[Math.floor(Math.random() * candidates.length)]!
      return { snap, ownerIndex }
    }
    return { snap: this.getGhostOrEmpty(day), ownerIndex: -1 }
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

    // Check if all alive players have reported
    // 只等待存活的真人玩家上报（AI 玩家没有连接，永远不会上报）
    const humanAlivePlayers = this._players.filter((p) => !p.isAi && !this.eliminatedSet.has(p.index))
    const allReported = humanAlivePlayers.every((p) => this.roundResultsByDay.get(day)?.has(p.index))
    if (allReported) {
      this.hostProcessRoundEnd(day)
    }
  }

  private hostProcessRoundEnd(day: number): void {
    const results = this.roundResultsByDay.get(day)
    if (!results) return
    const hpMap: Record<number, number> = {}
    const newlyEliminated: number[] = []

    // 只处理存活的真人玩家 HP（AI 玩家不参与 HP 计算）
    // 使用派发快照时记录的存活列表，保证配对与分发时一致
    const aliveIndices = this.dayAliveIndices.get(day) ?? []
    const alivePlayers = this._players.filter((p) => !p.isAi && !this.eliminatedSet.has(p.index))
    for (const player of alivePlayers) {
      const opponentIdx = getOpponentFromAlive(player.index, aliveIndices, day - 1)
      const myResult = results.get(player.index)
      const lost = myResult?.winner === 'enemy'
      if (lost) {
        // Opponent's survivingDamage is what the opponent reported as winner
        const opponentResult = opponentIdx >= 0 ? results.get(opponentIdx) : undefined
        const damage = opponentResult?.survivingDamage ?? (getConfig().pvpRules?.baseDamage ?? 1)
        const currentHp = this.playerHps.get(player.index) ?? 0
        const newHp = Math.max(0, currentHp - damage)
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

    // 淘汰后重新检查：若有待派发的天，其快照已被所有存活玩家提交，立即派发（解决竞态：D+1 快照先于淘汰处理到达）
    if (newlyEliminated.length > 0) {
      for (const [pendingDay, pendingMap] of this.daySnapshots.entries()) {
        if (this.dispatchedDays.has(pendingDay)) continue
        const humanAlivePlayers = this._players.filter((p) => !p.isAi && !this.eliminatedSet.has(p.index))
        if (humanAlivePlayers.every((p) => pendingMap.has(p.index))) {
          console.log('[PvpRoom] 淘汰后重新检查 day=' + pendingDay + '：所有存活玩家已提交，立即派发')
          if (this.dayCountdownTimer) clearTimeout(this.dayCountdownTimer)
          this.hostDispatchSnapshots(pendingDay)
        }
      }
    }

    // 构造所有玩家上局快照 map（用于客户端查看阵容）
    const snapshots: Record<number, BattleSnapshotBundle> = {}
    for (const [idx, snap] of this.playerLastSnapshots.entries()) {
      snapshots[idx] = snap
    }

    console.log('[PvpRoom] hostProcessRoundEnd day=' + day + ' hpMap=' + JSON.stringify(hpMap) + ' newlyEliminated=' + JSON.stringify(newlyEliminated))
    this.broadcastToClients({ type: 'round_summary', day, hpMap, newlyEliminated, snapshots })
    this.onRoundSummary?.(day, hpMap, newlyEliminated, snapshots)

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
    this.hostConns.forEach((conn) => conn.close())
    this.clientConn?.close()
    this.peerConn.destroy()
    this.dispatchedOpponentSnaps.clear()
  }
}
