// ============================================================
// CombatTypes — 战斗引擎所有类型定义（无逻辑，纯类型）
// ============================================================

import type { ItemSizeNorm, SkillArchetype } from '@/common/items/ItemDef'

export type CombatPhase = 'IDLE' | 'INIT' | 'SETUP' | 'TICK' | 'RESOLVE' | 'END'

export interface CombatResult {
  winner: 'player' | 'enemy' | 'draw'
  ticks: number
  survivingDamage: number  // 1 + tier-weight sum of winner's surviving items
}

export interface HeroState {
  id: string
  side: 'player' | 'enemy'
  maxHp: number
  hp: number
  shield: number
  burn: number
  poison: number
  regen: number
}

export interface CombatItemRunner {
  id: string
  side: 'player' | 'enemy'
  defId: string
  baseStats: {
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
  runtime: {
    currentChargeMs: number
    pendingChargeMs: number
    tempDamageBonus: number
    damageScale: number
    bonusMulticast: number
    executeCount: number
    ammoMax: number
    ammoCurrent: number
    modifiers: {
      freezeMs: number
      slowMs: number
      hasteMs: number
    }
  }
  col: number
  row: number
  size: ItemSizeNorm
  tier: string
  tierStar: 1 | 2
  reviveUsed?: boolean
}

export interface CombatItemRuntimeState {
  id: string
  side: 'player' | 'enemy'
  currentChargeMs: number
  cooldownMs: number
  chargePercent: number
  executeCount: number
  tempDamageBonus: number
  ammoMax: number
  ammoCurrent: number
  freezeMs: number
  slowMs: number
  hasteMs: number
  damage: number
  heal: number
  shield: number
  burn: number
  poison: number
  multicast: number
}

export interface PendingHit {
  dueTick: number
  side: 'player' | 'enemy'
  sourceItemId: string
  defId: string
  baseDamage: number
  damage: number
  attackerDamageAtQueue?: number
  lockAttackerDelta?: boolean
  crit: number
}

export interface PendingItemFire {
  dueTick: number
  sourceItemId: string
  extraTriggered?: boolean
}

export interface PendingChargePulse {
  dueTick: number
  sourceItemId: string
  targetItemId: string
  gainMs: number
}

export interface PendingAmmoRefill {
  dueTick: number
  sourceItemId: string
  targetItemId: string
  gainAmmo: number
  chargeMs: number
}

export interface CombatStartOptions {
  enemyDisabled?: boolean
  playerSkillIds?: string[]
  enemySkillIds?: string[]
  playerBackpackItemCount?: number
  playerGold?: number
  playerTrophyWins?: number
  enemyBackpackItemCount?: number
  enemyGold?: number
  enemyTrophyWins?: number
}

export type SkillTierLite = 'bronze' | 'silver' | 'gold'

export type DraftSkillLite = {
  id: string
  archetype: SkillArchetype
  tier: SkillTierLite
}

export type ControlStatus = 'freeze' | 'slow' | 'haste'

export interface ControlSpec {
  status: ControlStatus
  durationMs: number
  count: number
  targetSide: 'ally' | 'enemy'
  targetAll: boolean
  targetMode: 'leftmost' | 'adjacent' | 'random' | 'fastest' | 'left'
}

export interface CombatBoardItem {
  id: string
  side: 'player' | 'enemy'
  defId: string
  col: number
  row: number
  size: ItemSizeNorm
  tier: string
  tierStar: 1 | 2
  chargeRatio: number
}

export type EnemyTier = 'Bronze' | 'Silver' | 'Gold' | 'Diamond'
export type EnemyStar = 1 | 2

// ── CombatState — 战斗引擎完整可变状态（主程建议：集中化便于快照/replay）──

export interface CombatState {
  // 计时器 / 流程
  phase: CombatPhase
  day: number
  elapsedMs: number
  tickAccumulatorMs: number
  fatigueAccumulatorMs: number
  fatigueTickCount: number
  tickIndex: number
  inFatigue: boolean
  finished: boolean
  result: CombatResult | null

  // 英雄 / 物品实体
  playerHero: HeroState
  enemyHero: HeroState
  items: CombatItemRunner[]
  pendingHits: PendingHit[]
  pendingItemFires: PendingItemFire[]
  pendingChargePulses: PendingChargePulse[]
  pendingAmmoRefills: PendingAmmoRefill[]
  lastQueuedFireTickByItem: Map<string, number>

  // 技能 ID 集合
  playerSkillIds: Set<string>
  enemySkillIds: Set<string>

  // 技能一次性触发标志
  skillEnemyHalfTriggered: boolean
  skillPlayerHalfTriggered: boolean
  skillEnemySelfHalfTriggered: boolean
  skillEnemyHalfTriggeredFromEnemy: boolean
  skillPlayerHalfShieldTriggered: boolean
  skillEnemyHalfShieldTriggered: boolean
  skillPlayerHalfShieldCdTriggered: boolean
  skillEnemyHalfShieldCdTriggered: boolean
  skillFirstAmmoEmptyTriggeredBySide: Record<'player' | 'enemy', boolean>
  skill47ReviveTriggeredBySide: Record<'player' | 'enemy', boolean>
  deathMarkCheckUsedBySide: Record<'player' | 'enemy', boolean>
  unyieldingTriggeredBySide: Record<'player' | 'enemy', boolean>
  heroInvincibleMsBySide: Record<'player' | 'enemy', number>
  skill86UseCountBySide: Record<'player' | 'enemy', number>

  // 技能累积数值
  skillExecuteDamageBonus: number
  skillEnemyExecuteDamageBonus: number
  skill33RegenPerTick: number
  skillEnemy33RegenPerTick: number

  // 战斗开始时的上下文快照
  playerBackpackItemCount: number
  playerActiveColCount: number
  playerGoldAtBattleStart: number
  playerTrophyWinsAtBattleStart: number
  enemyBackpackItemCount: number
  enemyGoldAtBattleStart: number
  enemyTrophyWinsAtBattleStart: number
}

export function createCombatState(): CombatState {
  return {
    phase: 'IDLE',
    day: 1,
    elapsedMs: 0,
    tickAccumulatorMs: 0,
    fatigueAccumulatorMs: 0,
    fatigueTickCount: 0,
    tickIndex: 0,
    inFatigue: false,
    finished: false,
    result: null,

    playerHero: { id: 'hero_player', side: 'player', maxHp: 1, hp: 1, shield: 0, burn: 0, poison: 0, regen: 0 },
    enemyHero: { id: 'hero_enemy', side: 'enemy', maxHp: 1, hp: 1, shield: 0, burn: 0, poison: 0, regen: 0 },
    items: [],
    pendingHits: [],
    pendingItemFires: [],
    pendingChargePulses: [],
    pendingAmmoRefills: [],
    lastQueuedFireTickByItem: new Map(),

    playerSkillIds: new Set(),
    enemySkillIds: new Set(),

    skillEnemyHalfTriggered: false,
    skillPlayerHalfTriggered: false,
    skillEnemySelfHalfTriggered: false,
    skillEnemyHalfTriggeredFromEnemy: false,
    skillPlayerHalfShieldTriggered: false,
    skillEnemyHalfShieldTriggered: false,
    skillPlayerHalfShieldCdTriggered: false,
    skillEnemyHalfShieldCdTriggered: false,
    skillFirstAmmoEmptyTriggeredBySide: { player: false, enemy: false },
    skill47ReviveTriggeredBySide: { player: false, enemy: false },
    deathMarkCheckUsedBySide: { player: false, enemy: false },
    unyieldingTriggeredBySide: { player: false, enemy: false },
    heroInvincibleMsBySide: { player: 0, enemy: 0 },
    skill86UseCountBySide: { player: 0, enemy: 0 },

    skillExecuteDamageBonus: 0,
    skillEnemyExecuteDamageBonus: 0,
    skill33RegenPerTick: 0,
    skillEnemy33RegenPerTick: 0,

    playerBackpackItemCount: 0,
    playerActiveColCount: 0,
    playerGoldAtBattleStart: 0,
    playerTrophyWinsAtBattleStart: 0,
    enemyBackpackItemCount: 0,
    enemyGoldAtBattleStart: 0,
    enemyTrophyWinsAtBattleStart: 0,
  }
}

export type CombatRuntimeOverride = {
  burnTickMs?: number
  poisonTickMs?: number
  regenTickMs?: number
  fatigueStartMs?: number
  fatigueTickMs?: number
  fatigueBaseValue?: number
  fatigueDoubleEveryMs?: number
  fatigueIntervalMs?: number
  fatigueDamageFixedPerInterval?: number
  burnShieldFactor?: number
  burnDecayPct?: number
  healCleansePct?: number
  enemyDraftEnabled?: number
  enemyDraftSameArchetypeBias?: number
}
