// ============================================================
// PvpRoom — PVP 房间协议层
// 负责：玩家加入/离开、商店倒计时、快照交换
// Hub-and-spoke：所有消息经房主中继
// ============================================================

import type { DataConnection } from 'peerjs'
import { PeerConnection } from '@/pvp/PeerConnection'
import type { PvpPlayer, PvpMsgToClient, PvpMsgToHost } from '@/pvp/PvpTypes'
import { getOpponentIndex } from '@/pvp/PvpTypes'
import type { BattleSnapshotBundle } from '@/combat/BattleSnapshotStore'
import { generateAiSnapshot } from '@/pvp/AiSnapshot'

const DEFAULT_COUNTDOWN_MS = 90_000

export type RoomRole = 'host' | 'client'

export class PvpRoom {
  private peerConn = new PeerConnection()
  private role: RoomRole = 'client'

  // Host only: map from peerId → DataConnection
  private hostConns = new Map<string, DataConnection>()
  // Client only: connection to host
  private clientConn: DataConnection | null = null

  // Shared state
  private _players: PvpPlayer[] = []
  private _myIndex = 0
  private _totalPlayers = 4
  private _maxPlayers = 4
  // Per-day snapshot collection (host only)
  private daySnapshots = new Map<number, Map<number, BattleSnapshotBundle>>()
  private dayCountdownTimer: ReturnType<typeof setTimeout> | null = null
  // Game-over wins collection (host only)
  private playerWins = new Map<number, number>()
  private gameOverBroadcast = false

  // ---------- Callbacks (set by PvpContext / PvpLobbyScene) ----------
  onRoomStateChange?: (players: PvpPlayer[]) => void
  onGameStart?: (myIndex: number, totalPlayers: number) => void
  onDayReady?: (day: number, countdownMs: number) => void
  onPlayerStatusUpdate?: (day: number, readyIndices: number[]) => void
  onOpponentSnapshot?: (day: number, snapshot: BattleSnapshotBundle) => void
  onGameOver?: (rankings: { nickname: string; wins: number; index: number }[]) => void
  onError?: (msg: string) => void

  get players(): PvpPlayer[] { return this._players }
  get myIndex(): number { return this._myIndex }
  get maxPlayers(): number { return this._maxPlayers }
  get isHost(): boolean { return this.role === 'host' }

  // ----------------------------------------------------------------
  // 创建房间（房主调用）
  // ----------------------------------------------------------------
  async createRoom(roomCode: string, nickname: string, maxPlayers: number): Promise<void> {
    this.role = 'host'

    this._maxPlayers = maxPlayers
    this._totalPlayers = maxPlayers

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
  private handleIncomingConnection(conn: DataConnection): void {
    conn.on('open', () => {
      this.hostConns.set(conn.peer, conn)
      conn.on('data', (raw) => this.handleHostReceive(conn.peer, raw as PvpMsgToHost))
      conn.on('close', () => this.handlePeerDisconnect(conn.peer))
    })
  }

  private handleHostReceive(peerId: string, msg: PvpMsgToHost): void {
    if (msg.type === 'join') {
      // 去重：同一个 peer 重复发 join 时只广播最新房间状态，不重复添加
      if (this._players.find((p) => p.peerId === peerId)) {
        this.broadcastRoomState()
        return
      }

      // 断线重连：同名玩家已在房间但断线，复用原有槽位避免重复显示
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
      this.hostReceiveSnapshot(peerId, msg.day, msg.snapshot)
    } else if (msg.type === 'wins_report') {
      const player = this._players.find((p) => p.peerId === peerId)
      if (player) {
        this.playerWins.set(player.index, msg.wins)
        console.log('[PvpRoom] 收到胜场上报 player[' + player.index + '] ' + player.nickname + ' wins=' + msg.wins)
        this.hostTryBroadcastGameOver()
      }
    }
  }

  private handlePeerDisconnect(peerId: string): void {
    const player = this._players.find((p) => p.peerId === peerId)
    if (player) player.connected = false
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
        this.onGameStart?.(msg.myIndex, msg.totalPlayers)
        break
      case 'day_ready':
        this.onDayReady?.(msg.day, msg.countdownMs)
        break
      case 'player_status':
        this.onPlayerStatusUpdate?.(msg.day, msg.readyIndices)
        break
      case 'opponent_snapshot':
        this.onOpponentSnapshot?.(msg.day, msg.snapshot)
        break
      case 'game_over':
        this.onGameOver?.(msg.rankings)
        break
    }
  }

  // ----------------------------------------------------------------
  // 房主：开始游戏
  // ----------------------------------------------------------------
  startGame(): void {
    if (!this.isHost) return

    // 用 AI 补全不足的玩家槽
    for (let i = 1; i < this._maxPlayers; i++) {
      if (!this._players.find((p) => p.index === i)) {
        this._players.push({
          peerId: `ai-${i}`,
          nickname: `AI ${i}`,
          index: i,
          connected: false,
          isAi: true,
        })
      }
    }
    this._totalPlayers = this._maxPlayers

    // 先广播含 AI 的完整玩家列表，确保客户端 session.players 包含所有对手
    this.broadcastRoomState()

    // 分配 index 并通知每个客户端
    this._players.forEach((player) => {
      if (player.isAi || player.index === 0) return
      this.sendToPlayer(player.index, {
        type: 'game_start',
        myIndex: player.index,
        totalPlayers: this._totalPlayers,
        countdownMs: DEFAULT_COUNTDOWN_MS,
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
    void day  // day tracked via daySnapshots map
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

    // 检查所有真人玩家是否都已提交
    const humanPlayers = this._players.filter((p) => !p.isAi)
    const allReady = humanPlayers.every((p) => map.has(p.index))
    if (allReady) {
      console.log('[PvpRoom] 所有真人玩家已提交，分发快照')
      if (this.dayCountdownTimer) clearTimeout(this.dayCountdownTimer)
      this.hostDispatchSnapshots(day)
    }
  }

  /** 房主提交自己的快照 */
  hostSubmitSnapshot(day: number, snapshot: BattleSnapshotBundle): void {
    if (!this.isHost) return
    const map = this.daySnapshots.get(day) ?? new Map<number, BattleSnapshotBundle>()
    this.daySnapshots.set(day, map)
    map.set(0, snapshot)

    const readyIndices = Array.from(map.keys())
    console.log('[PvpRoom] 房主提交快照 day=' + day + ' readyIndices=' + JSON.stringify(readyIndices))
    this.broadcastToClients({ type: 'player_status', day, readyIndices })
    this.onPlayerStatusUpdate?.(day, readyIndices)

    const humanPlayers = this._players.filter((p) => !p.isAi)
    const allReady = humanPlayers.every((p) => map.has(p.index))
    if (allReady) {
      console.log('[PvpRoom] 所有真人玩家已提交（host路径），分发快照')
      if (this.dayCountdownTimer) clearTimeout(this.dayCountdownTimer)
      this.hostDispatchSnapshots(day)
    }
  }

  // ----------------------------------------------------------------
  // 房主：分发快照给每个玩家
  // ----------------------------------------------------------------
  private hostDispatchSnapshots(day: number): void {
    if (!this.isHost) return
    const map = this.daySnapshots.get(day) ?? new Map()

    // 为未提交的真人用 AI 补全
    for (const player of this._players) {
      if (!map.has(player.index)) {
        console.log('[PvpRoom] player[' + player.index + '] ' + player.nickname + ' 未提交，用AI快照补全')
        map.set(player.index, generateAiSnapshot(day))
      }
    }

    // 为每个真人玩家发送对手快照
    for (const player of this._players) {
      const opponentIdx = getOpponentIndex(player.index, this._totalPlayers, day - 1)
      const opponentSnap = map.get(opponentIdx) ?? generateAiSnapshot(day)
      console.log('[PvpRoom] 分发: player[' + player.index + '] ' + player.nickname + ' vs opponent[' + opponentIdx + '] entities=' + opponentSnap.entities.length)

      if (player.index === 0) {
        // 房主自己
        this.onOpponentSnapshot?.(day, opponentSnap)
      } else if (!player.isAi) {
        this.sendToPlayer(player.index, {
          type: 'opponent_snapshot',
          day,
          snapshot: opponentSnap,
        })
      }
    }
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
        }
      }, 5000)
    } else {
      this.sendToHost({ type: 'wins_report', wins })
    }
  }

  private buildRankings(): { nickname: string; wins: number; index: number }[] {
    return this._players
      .map((p) => ({ nickname: p.nickname, wins: this.playerWins.get(p.index) ?? 0, index: p.index }))
      .sort((a, b) => b.wins - a.wins)
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

  // ----------------------------------------------------------------
  // 销毁
  // ----------------------------------------------------------------
  destroy(): void {
    if (this.dayCountdownTimer) clearTimeout(this.dayCountdownTimer)
    this.hostConns.forEach((conn) => conn.close())
    this.clientConn?.close()
    this.peerConn.destroy()
  }
}
