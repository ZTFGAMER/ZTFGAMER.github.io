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
  entities: BattleSnapshotEntity[]
}

let currentSnapshot: BattleSnapshotBundle | null = null

export function setBattleSnapshot(snapshot: BattleSnapshotBundle): void {
  currentSnapshot = {
    day: snapshot.day,
    activeColCount: snapshot.activeColCount,
    createdAtMs: snapshot.createdAtMs,
    entities: snapshot.entities.map((it) => ({ ...it })),
  }
}

export function getBattleSnapshot(): BattleSnapshotBundle | null {
  if (!currentSnapshot) return null
  return {
    day: currentSnapshot.day,
    activeColCount: currentSnapshot.activeColCount,
    createdAtMs: currentSnapshot.createdAtMs,
    entities: currentSnapshot.entities.map((it) => ({ ...it })),
  }
}

export function clearBattleSnapshot(): void {
  currentSnapshot = null
}
