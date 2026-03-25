import type { CombatEntity } from '@/tower/common/grid/GridSystem'
import type { TierKey } from '@/tower/shop/ShopManager'
import type { ItemEnchantmentKey } from '@/tower/common/items/ItemEnchantment'

const TOWER_BATTLE_SNAPSHOT_STORAGE_KEY = 'bigbazzar_tower_battle_snapshot_v1'

export interface BattleSnapshotEntity extends CombatEntity {
  tier: TierKey
  tierStar?: 1 | 2
  quality?: TierKey
  level?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  permanentDamageBonus?: number
  enchantment?: ItemEnchantmentKey
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
  /** PVP 专用：对手的技能 ID、背包数、金币、奖杯胜场、战斗生命值 */
  pvpEnemySkillIds?: string[]
  pvpEnemyBackpackItemCount?: number
  pvpEnemyGold?: number
  pvpEnemyTrophyWins?: number
  pvpEnemyBattleHp?: number
  /** 快照提交方的英雄 ID（starterClass） */
  ownerHeroId?: string
  /** 快照提交方的玩家等级 */
  ownerLevel?: number
  /** PVP 专用：对手的英雄 ID，由 ownerHeroId 传递而来 */
  pvpEnemyHeroId?: string
}

let currentSnapshot: BattleSnapshotBundle | null = null

function cloneSnapshot(snapshot: BattleSnapshotBundle): BattleSnapshotBundle {
  return {
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
    pvpEnemyBattleHp: typeof snapshot.pvpEnemyBattleHp === 'number' ? Math.max(1, Math.round(snapshot.pvpEnemyBattleHp)) : undefined,
    ownerHeroId: snapshot.ownerHeroId,
    ownerLevel: typeof snapshot.ownerLevel === 'number' ? Math.max(1, Math.round(snapshot.ownerLevel)) : undefined,
    pvpEnemyHeroId: snapshot.pvpEnemyHeroId,
  }
}

function saveSnapshotToStorage(snapshot: BattleSnapshotBundle): void {
  try {
    localStorage.setItem(TOWER_BATTLE_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // ignore storage failures
  }
}

function loadSnapshotFromStorage(): BattleSnapshotBundle | null {
  try {
    const raw = localStorage.getItem(TOWER_BATTLE_SNAPSHOT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as BattleSnapshotBundle | null
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entities)) return null
    return cloneSnapshot(parsed)
  } catch {
    return null
  }
}

export function setBattleSnapshot(snapshot: BattleSnapshotBundle): void {
  currentSnapshot = cloneSnapshot(snapshot)
  saveSnapshotToStorage(currentSnapshot)
  console.log('[Snapshot] setBattleSnapshot day=' + snapshot.day + ' entities=' + snapshot.entities.length + ' pvpEnemyEntities=' + (snapshot.pvpEnemyEntities?.length ?? 'none'))
}

export function getBattleSnapshot(): BattleSnapshotBundle | null {
  if (!currentSnapshot) currentSnapshot = loadSnapshotFromStorage()
  if (!currentSnapshot) return null
  return cloneSnapshot(currentSnapshot)
}

export function clearBattleSnapshot(): void {
  currentSnapshot = null
  try {
    localStorage.removeItem(TOWER_BATTLE_SNAPSHOT_STORAGE_KEY)
  } catch {
    // ignore storage failures
  }
}
