// ============================================================
// PvpTypes — PVP 模式共享类型定义
// ============================================================

import type { BattleSnapshotBundle } from '@/combat/BattleSnapshotStore'

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
  totalDays: number           // = (totalPlayers - 1) * 3，确保每对玩家恰好 3 次
  players: PvpPlayer[]
  currentDay: number
  wins: number                // my win count
  dayResults: Record<number, 'player' | 'enemy' | 'draw'>
  countdownMs: number
  rankings?: { nickname: string; wins: number; index: number }[]  // filled after game_over
}

/** 根据玩家总数计算总天数（每对玩家恰好打 3 场） */
export function calcTotalDays(totalPlayers: number): number {
  return Math.max(1, totalPlayers - 1) * 3
}

export type PvpMsgToHost =
  | { type: 'join'; nickname: string }
  | { type: 'snapshot_ready'; day: number; snapshot: BattleSnapshotBundle }
  | { type: 'wins_report'; wins: number }

export type PvpMsgToClient =
  | { type: 'room_state'; players: Omit<PvpPlayer, 'peerId'>[]; maxPlayers: number }
  | { type: 'game_start'; myIndex: number; totalPlayers: number; countdownMs: number }
  | { type: 'day_ready'; day: number; countdownMs: number }
  | { type: 'player_status'; day: number; readyIndices: number[] }
  | { type: 'opponent_snapshot'; day: number; snapshot: BattleSnapshotBundle }
  | { type: 'game_over'; rankings: { nickname: string; wins: number; index: number }[] }

export type PvpMsg = PvpMsgToHost | PvpMsgToClient

/** 根据我的 index 和总人数，计算第 day 天（0-based）的对手 index */
export function getOpponentIndex(myIndex: number, totalPlayers: number, dayZeroBased: number): number {
  const opponents: number[] = []
  for (let i = 0; i < totalPlayers; i++) {
    if (i !== myIndex) opponents.push(i)
  }
  return opponents[dayZeroBased % opponents.length]
}
