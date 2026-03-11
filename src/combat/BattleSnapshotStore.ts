import type { CombatEntity } from '@/grid/GridSystem'
import type { TierKey } from '@/shop/ShopManager'

export interface BattleSnapshotEntity extends CombatEntity {
  tier: TierKey
  tierStar?: 1 | 2
  quality?: TierKey
  level?: 1 | 2 | 3 | 4 | 5 | 6 | 7
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
  playerBattleHp?: number
  showBasicSynthesisGuide?: boolean
  entities: BattleSnapshotEntity[]
  /** 快照所有者自身的技能 ID（PVP 提交时附带，对手用作 enemySkillIds） */
  ownerSkillIds?: string[]
  /** PVP 专用：对手的 entities，替代 CombatEngine 内部的 makeEnemyRunners */
  pvpEnemyEntities?: BattleSnapshotEntity[]
  /** PVP 专用：对手的技能 ID、背包数、金币、奖杯胜场 */
  pvpEnemySkillIds?: string[]
  pvpEnemyBackpackItemCount?: number
  pvpEnemyGold?: number
  pvpEnemyTrophyWins?: number
  /** 快照提交方的英雄 ID（starterClass） */
  ownerHeroId?: string
  /** PVP 专用：对手的英雄 ID，由 ownerHeroId 传递而来 */
  pvpEnemyHeroId?: string
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
    playerBattleHp: typeof snapshot.playerBattleHp === 'number' ? Math.max(1, Math.round(snapshot.playerBattleHp)) : undefined,
    showBasicSynthesisGuide: snapshot.showBasicSynthesisGuide === true,
    entities: snapshot.entities.map((it) => ({ ...it })),
    ownerSkillIds: snapshot.ownerSkillIds ? [...snapshot.ownerSkillIds] : undefined,
    pvpEnemyEntities: snapshot.pvpEnemyEntities?.map((it) => ({ ...it })),
    pvpEnemySkillIds: snapshot.pvpEnemySkillIds ? [...snapshot.pvpEnemySkillIds] : undefined,
    pvpEnemyBackpackItemCount: snapshot.pvpEnemyBackpackItemCount,
    pvpEnemyGold: snapshot.pvpEnemyGold,
    pvpEnemyTrophyWins: snapshot.pvpEnemyTrophyWins,
    ownerHeroId: snapshot.ownerHeroId,
    pvpEnemyHeroId: snapshot.pvpEnemyHeroId,
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
    playerBattleHp: typeof currentSnapshot.playerBattleHp === 'number' ? Math.max(1, Math.round(currentSnapshot.playerBattleHp)) : undefined,
    showBasicSynthesisGuide: currentSnapshot.showBasicSynthesisGuide === true,
    entities: currentSnapshot.entities.map((it) => ({ ...it })),
    ownerSkillIds: currentSnapshot.ownerSkillIds ? [...currentSnapshot.ownerSkillIds] : undefined,
    pvpEnemyEntities: currentSnapshot.pvpEnemyEntities?.map((it) => ({ ...it })),
    pvpEnemySkillIds: currentSnapshot.pvpEnemySkillIds ? [...currentSnapshot.pvpEnemySkillIds] : undefined,
    pvpEnemyBackpackItemCount: currentSnapshot.pvpEnemyBackpackItemCount,
    pvpEnemyGold: currentSnapshot.pvpEnemyGold,
    pvpEnemyTrophyWins: currentSnapshot.pvpEnemyTrophyWins,
    ownerHeroId: currentSnapshot.ownerHeroId,
    pvpEnemyHeroId: currentSnapshot.pvpEnemyHeroId,
  }
}

export function clearBattleSnapshot(): void {
  currentSnapshot = null
}
