// ============================================================
// CombatTypes — 战斗引擎所有类型定义（无逻辑，纯类型）
// ============================================================

import type { ItemSizeNorm, SkillArchetype } from '@/items/ItemDef'

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
