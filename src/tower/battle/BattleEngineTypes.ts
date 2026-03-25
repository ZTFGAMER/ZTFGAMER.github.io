import type { BattleSnapshotBundle } from '@/tower/battle/BattleSnapshotStore'
import type { CombatBoardItem, CombatItemRuntimeState, CombatResult } from '@/tower/battle/CombatEngine'

export type TowerEnemyUnitView = {
  id: string
  enemyId: string
  icon: string
  lane: number
  isFlying?: boolean
  hp: number
  maxHp: number
  distance: number
  maxDistance: number
  isBlockedByFront?: boolean
  isMoving?: boolean
}

export type BattleQueuePerfStats = {
  pendingHits: number
  pendingItemFires: number
  pendingChargePulses: number
  pendingAmmoRefills: number
  maxPendingHits: number
  maxPendingItemFires: number
  maxPendingChargePulses: number
  maxPendingAmmoRefills: number
}

export type BattleRuntimeCachePerfStats = {
  calls: number
  cacheHits: number
}

export type TowerEnemyStatsView = {
  remainingCount: number
  totalCount: number
  allEnemiesSpawnedAtMs?: number | null
  elapsedMs?: number
  currentWaveHasBoss?: boolean
}

export type TowerClassAttackDistanceView = {
  swordsman: number
  archer: number
  assassin: number
  mage: number
}

export interface BattleEngineLike {
  start(snapshot: BattleSnapshotBundle, options?: {
    enemyDisabled?: boolean
    playerSkillIds?: string[]
    enemySkillIds?: string[]
    playerBackpackItemCount?: number
    playerGold?: number
    playerTrophyWins?: number
    enemyBackpackItemCount?: number
    enemyGold?: number
    enemyTrophyWins?: number
  }): void
  update(dt: number): void
  getEnemySkillIds(): string[]
  getBoardState(): {
    player: { id: string; side: 'player' | 'enemy'; maxHp: number; hp: number; shield: number; burn: number; poison: number; regen: number }
    enemy: { id: string; side: 'player' | 'enemy'; maxHp: number; hp: number; shield: number; burn: number; poison: number; regen: number }
    items: CombatBoardItem[]
  }
  getRuntimeState(): CombatItemRuntimeState[]
  getDebugState(): { tickIndex: number; playerAlive: number; enemyAlive: number; playerHp: number; enemyHp: number; inFatigue: boolean; enemySkillCount: number }
  isFinished(): boolean
  getResult(): CombatResult | null
  getQueuePerfStats(): BattleQueuePerfStats
  getRuntimeCachePerfStats(): BattleRuntimeCachePerfStats
  syncPlayerEntities?(entities: BattleSnapshotBundle['entities'], options?: { resetChargeIds?: string[] }): void
  queueNextTowerWave?(nextDay: number): void
  getTowerEnemyUnits?(): TowerEnemyUnitView[]
  getTowerEnemyStats?(): TowerEnemyStatsView
  getTowerClassAttackDistances?(): TowerClassAttackDistanceView
}
