import type { CombatEntity } from '@/grid/GridSystem'
import type { TierKey } from '@/shop/ShopManager'

export interface BattleSnapshotEntity extends CombatEntity {
  tier: TierKey
  tierStar?: 1 | 2
  permanentDamageBonus?: number
  baseStats?: {
    cooldownMs: number
    damage: number
    heal: number
    shield: number
    burn: number
    poison: number
    regen: number
    crit: number
    multicast: number
  }
}

export interface BattleSnapshotBundle {
  day: number
  activeColCount: number
  createdAtMs: number
  skillBarMoveStartAtMs?: number
  playerBackpackItemCount?: number
  playerGold?: number
  playerTrophyWins?: number
  showBasicSynthesisGuide?: boolean
  entities: BattleSnapshotEntity[]
  /** PVP 专用：对手的 entities，替代 CombatEngine 内部的 makeEnemyRunners */
  pvpEnemyEntities?: BattleSnapshotEntity[]
}

let currentSnapshot: BattleSnapshotBundle | null = null

export function setBattleSnapshot(snapshot: BattleSnapshotBundle): void {
  currentSnapshot = {
    day: snapshot.day,
    activeColCount: snapshot.activeColCount,
    createdAtMs: snapshot.createdAtMs,
    skillBarMoveStartAtMs: typeof snapshot.skillBarMoveStartAtMs === 'number' ? snapshot.skillBarMoveStartAtMs : undefined,
    playerBackpackItemCount: typeof snapshot.playerBackpackItemCount === 'number' ? Math.max(0, Math.round(snapshot.playerBackpackItemCount)) : undefined,
    playerGold: typeof snapshot.playerGold === 'number' ? Math.max(0, Math.round(snapshot.playerGold)) : undefined,
    playerTrophyWins: typeof snapshot.playerTrophyWins === 'number' ? Math.max(0, Math.round(snapshot.playerTrophyWins)) : undefined,
    showBasicSynthesisGuide: snapshot.showBasicSynthesisGuide === true,
    entities: snapshot.entities.map((it) => ({ ...it })),
    pvpEnemyEntities: snapshot.pvpEnemyEntities?.map((it) => ({ ...it })),
  }
  console.log('[Snapshot] setBattleSnapshot day=' + snapshot.day + ' entities=' + snapshot.entities.length + ' pvpEnemyEntities=' + (snapshot.pvpEnemyEntities?.length ?? 'none'))
}

export function getBattleSnapshot(): BattleSnapshotBundle | null {
  if (!currentSnapshot) return null
  return {
    day: currentSnapshot.day,
    activeColCount: currentSnapshot.activeColCount,
    createdAtMs: currentSnapshot.createdAtMs,
    skillBarMoveStartAtMs: typeof currentSnapshot.skillBarMoveStartAtMs === 'number' ? currentSnapshot.skillBarMoveStartAtMs : undefined,
    playerBackpackItemCount: typeof currentSnapshot.playerBackpackItemCount === 'number' ? Math.max(0, Math.round(currentSnapshot.playerBackpackItemCount)) : undefined,
    playerGold: typeof currentSnapshot.playerGold === 'number' ? Math.max(0, Math.round(currentSnapshot.playerGold)) : undefined,
    playerTrophyWins: typeof currentSnapshot.playerTrophyWins === 'number' ? Math.max(0, Math.round(currentSnapshot.playerTrophyWins)) : undefined,
    showBasicSynthesisGuide: currentSnapshot.showBasicSynthesisGuide === true,
    entities: currentSnapshot.entities.map((it) => ({ ...it })),
    pvpEnemyEntities: currentSnapshot.pvpEnemyEntities?.map((it) => ({ ...it })),
  }
}

export function clearBattleSnapshot(): void {
  currentSnapshot = null
}
