import type { BattleSnapshotBundle } from './BattleSnapshotStore'
import { setBattleSnapshot } from './BattleSnapshotStore'

export type BattleReplayRecord = {
  snapshot: BattleSnapshotBundle
  enemyHeroId: string
  randomValues: number[]
  randomTags: string[]
  createdAtMs: number
}

let lastReplayRecord: BattleReplayRecord | null = null
let replayRequested = false

function cloneSnapshot(snapshot: BattleSnapshotBundle): BattleSnapshotBundle {
  return {
    day: snapshot.day,
    activeColCount: snapshot.activeColCount,
    createdAtMs: snapshot.createdAtMs,
    skillBarMoveStartAtMs: snapshot.skillBarMoveStartAtMs,
    playerBackpackItemCount: snapshot.playerBackpackItemCount,
    playerGold: snapshot.playerGold,
    playerTrophyWins: snapshot.playerTrophyWins,
    playerBattleHp: snapshot.playerBattleHp,
    showBasicSynthesisGuide: snapshot.showBasicSynthesisGuide,
    entities: snapshot.entities.map((it) => ({ ...it })),
    ownerSkillIds: snapshot.ownerSkillIds ? [...snapshot.ownerSkillIds] : undefined,
    pvpEnemyEntities: snapshot.pvpEnemyEntities?.map((it) => ({ ...it })),
    pvpEnemySkillIds: snapshot.pvpEnemySkillIds ? [...snapshot.pvpEnemySkillIds] : undefined,
    pvpEnemyBackpackItemCount: snapshot.pvpEnemyBackpackItemCount,
    pvpEnemyGold: snapshot.pvpEnemyGold,
    pvpEnemyTrophyWins: snapshot.pvpEnemyTrophyWins,
    pvpEnemyBattleHp: snapshot.pvpEnemyBattleHp,
    ownerHeroId: snapshot.ownerHeroId,
    ownerLevel: snapshot.ownerLevel,
    pvpEnemyHeroId: snapshot.pvpEnemyHeroId,
  }
}

function cloneRecord(record: BattleReplayRecord): BattleReplayRecord {
  return {
    snapshot: cloneSnapshot(record.snapshot),
    enemyHeroId: record.enemyHeroId,
    randomValues: [...record.randomValues],
    randomTags: [...record.randomTags],
    createdAtMs: record.createdAtMs,
  }
}

export function saveBattleReplayRecord(record: BattleReplayRecord): void {
  lastReplayRecord = cloneRecord(record)
}

export function hasBattleReplayRecord(): boolean {
  return lastReplayRecord != null
}

export function requestBattleReplay(): boolean {
  if (!lastReplayRecord) return false
  replayRequested = true
  setBattleSnapshot(cloneSnapshot(lastReplayRecord.snapshot))
  return true
}

export function consumeRequestedBattleReplay(): BattleReplayRecord | null {
  if (!replayRequested || !lastReplayRecord) return null
  replayRequested = false
  return cloneRecord(lastReplayRecord)
}
