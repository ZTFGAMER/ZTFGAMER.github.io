// ============================================================
// PvpTypes — PVP 模式共享类型定义
// ============================================================

import type { BattleSnapshotBundle } from '@/combat/BattleSnapshotStore'

export type PvpMode = 'async' | 'sync-a'

/**
 * 异步PVP每天内的阶段：
 * shop1 → wild1 → shop2 → wild2 → shop3 → pvp
 */
export type PvpDayPhase = 'shop1' | 'wild1' | 'shop2' | 'wild2' | 'shop3' | 'pvp'

export interface PvpPlayer {
  peerId: string
  nickname: string
  index: number      // 0-based slot index in the room
  connected: boolean
  isAi: boolean
}

export interface PvpSession {
  myIndex: number
  totalPlayers: number
  totalDays: number           // = (totalPlayers - 1) * 3
  players: PvpPlayer[]
  currentDay: number
  wins: number                // my win count
  dayResults: Record<number, 'player' | 'enemy' | 'draw'>
  pvpMode: PvpMode
  rankings?: { nickname: string; wins: number | null; index: number }[]  // filled after game_over
  playerHps: Record<number, number>       // playerIndex → current HP
  eliminatedPlayers: number[]             // playerIndices eliminated (HP ≤ 0)
  currentOpponentPlayerIndex?: number    // 当天实际对手的 playerIndex（bye 轮由 host 解析后下发）
  initialHp: number                       // 初始血量（房主创建时设定）
}

/**
 * 根据玩家总数计算总天数。
 * 公式：(totalPlayers - 1) * 3
 *   - 2人：3天，双方恰好对战 3 场
 *   - 4人：9天，每对恰好对战 3 场
 *   - 3人：6天（奇数补 bye 位），每对对战 2 场，其余为 AI 轮空场次
 */
export function calcTotalDays(totalPlayers: number): number {
  return Math.max(1, totalPlayers - 1) * 3
}

/**
 * 基于存活玩家列表的配对：将存活玩家映射为连续位置再调用 getOpponentIndex。
 * alivePlayers: 存活玩家实际 playerIndex 列表（升序），淘汰后自动收缩。
 * 返回实际 playerIndex，-1 表示轮空。
 */
export function getOpponentFromAlive(myIndex: number, alivePlayers: number[], dayZeroBased: number): number {
  const myPos = alivePlayers.indexOf(myIndex)
  if (myPos < 0) return -1
  const opponentPos = getOpponentIndex(myPos, alivePlayers.length, dayZeroBased)
  return opponentPos >= 0 ? (alivePlayers[opponentPos] ?? -1) : -1
}


export type PvpMsgToHost =
  | { type: 'join'; nickname: string }
  | { type: 'snapshot_ready'; day: number; snapshot: BattleSnapshotBundle; isFinal?: boolean }
  | { type: 'wins_report'; wins: number }
  | { type: 'battle_sync_ready'; day: number }
  | { type: 'round_result'; day: number; winner: 'player' | 'enemy' | 'draw'; survivingDamage: number }
  | { type: 'urge'; targetPlayerIndex: number }

export type PvpMsgToClient =
  | { type: 'room_state'; players: Omit<PvpPlayer, 'peerId'>[]; maxPlayers: number }
  | { type: 'game_start'; myIndex: number; totalPlayers: number; countdownMs: number; initialHp: number }
  | { type: 'day_ready'; day: number; countdownMs: number }
  | { type: 'player_status'; day: number; readyIndices: number[] }
  | { type: 'opponent_snapshot'; day: number; snapshot: BattleSnapshotBundle; opponentPlayerIndex?: number }
  | { type: 'game_over'; rankings: { nickname: string; wins: number | null; index: number }[] }
  | { type: 'battle_sync_start'; day: number }
  | { type: 'round_summary'; day: number; hpMap: Record<number, number>; newlyEliminated: number[]; snapshots: Record<number, BattleSnapshotBundle> }
  | { type: 'sync_ready_update'; day: number; readyIndices: number[] }
  | { type: 'urge_notify'; fromPlayerIndex: number; fromNickname: string }

export type PvpMsg = PvpMsgToHost | PvpMsgToClient

/**
 * 对称圆圈轮转配对算法：保证同一天内 A 的对手是 B 时 B 的对手也是 A。
 * 奇数玩家补虚拟 bye 位（凑偶），轮空玩家返回 -1（由调用方用 AI 快照替代）。
 *
 * 算法（标准 circle method）：
 *   固定 player[0]，将 [1..n-1] 排成一个圈，每轮左旋一格。
 *   第 round 轮配对：0 vs rotated[0]，rotated[n-2] vs rotated[1]，...
 *
 * 注意：myIndex / 返回值均为"位置编号"（0..totalPlayers-1），非实际 playerIndex。
 * 若需基于存活玩家配对，请使用 getOpponentFromAlive。
 */
export function getOpponentIndex(myIndex: number, totalPlayers: number, dayZeroBased: number): number {
  if (totalPlayers <= 1) return -1

  // 奇数补 bye 位，凑成偶数
  const n = totalPlayers % 2 === 0 ? totalPlayers : totalPlayers + 1
  const round = dayZeroBased % (n - 1)

  // rotatingAt(i) = 第 round 轮，圆圈第 i 位实际玩家编号
  const rotatingAt = (i: number): number => ((i + round) % (n - 1)) + 1

  // 固定位: player 0 vs rotatingAt(0)
  const r0 = rotatingAt(0)
  if (myIndex === 0) return r0 < totalPlayers ? r0 : -1
  if (myIndex === r0) return 0

  // 剩余 n/2 - 1 对: rotatingAt(n-1-j) vs rotatingAt(j), j = 1..n/2-1
  for (let j = 1; j < n / 2; j++) {
    const a = rotatingAt(n - 1 - j)
    const b = rotatingAt(j)
    if (myIndex === a) return b < totalPlayers ? b : -1
    if (myIndex === b) return a < totalPlayers ? a : -1
  }

  return -1
}
