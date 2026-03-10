import { EventBus } from '@/core/EventBus'
import type { BattleSnapshotBundle, BattleSnapshotEntity } from '@/combat/BattleSnapshotStore'
import { getAllItems, getConfig } from '@/core/DataLoader'
import { getLifeState, getPlayerWinStreakState } from '@/core/RunState'
import type { ItemDef, ItemSizeNorm, SkillArchetype } from '@/items/ItemDef'
import { normalizeSize } from '@/items/ItemDef'
import { resolveItemTierBaseStats } from '@/items/itemTierStats'
import { BRONZE_SKILL_PICKS } from '@/skills/bronzeSkillConfig'
import { SILVER_SKILL_PICKS } from '@/skills/silverSkillConfig'
import { GOLD_SKILL_PICKS } from '@/skills/goldSkillConfig'

export type CombatPhase = 'IDLE' | 'INIT' | 'SETUP' | 'TICK' | 'RESOLVE' | 'END'

export interface CombatResult {
  winner: 'player' | 'enemy' | 'draw'
  ticks: number
  survivingDamage: number  // 1 + tier-weight sum of winner's surviving items
}

interface HeroState {
  id: string
  side: 'player' | 'enemy'
  maxHp: number
  hp: number
  shield: number
  burn: number
  poison: number
  regen: number
}

interface CombatItemRunner {
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

interface PendingHit {
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

interface PendingItemFire {
  dueTick: number
  sourceItemId: string
  extraTriggered?: boolean
}

interface PendingChargePulse {
  dueTick: number
  sourceItemId: string
  targetItemId: string
  gainMs: number
}

interface PendingAmmoRefill {
  dueTick: number
  sourceItemId: string
  targetItemId: string
  gainAmmo: number
  chargeMs: number
}

const DEBUG_SHIELD_CHARGE = false
const HERO_MAX_HP_CAP = 999999
const HERO_SHIELD_CAP = 999999
const ITEM_DAMAGE_CAP = 999999

interface CombatStartOptions {
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

type SkillTierLite = 'bronze' | 'silver' | 'gold'

type DraftSkillLite = {
  id: string
  archetype: SkillArchetype
  tier: SkillTierLite
}

type ControlStatus = 'freeze' | 'slow' | 'haste'

interface ControlSpec {
  status: ControlStatus
  durationMs: number
  count: number
  targetSide: 'ally' | 'enemy'
  targetAll: boolean
  targetMode: 'leftmost' | 'adjacent' | 'random' | 'fastest' | 'left'
}

function parseTierName(raw: string): string {
  if (raw.includes('Bronze')) return 'Bronze'
  if (raw.includes('Silver')) return 'Silver'
  if (raw.includes('Gold')) return 'Gold'
  if (raw.includes('Diamond')) return 'Diamond'
  return ''
}

function parseAvailableTiers(raw: string): string[] {
  const s = (raw || '').trim()
  if (!s) return ['Bronze', 'Silver', 'Gold', 'Diamond']
  const out = s
    .split('/')
    .map((v) => parseTierName(v.trim()))
    .filter((v): v is string => Boolean(v))
  return out.length > 0 ? out : ['Bronze', 'Silver', 'Gold', 'Diamond']
}

function parseTierStar(raw: string): 1 | 2 {
  const m = raw.match(/#(\d+)/)
  const n = Number(m?.[1] ?? '1')
  if (!Number.isFinite(n) || n <= 1) return 1
  return 2
}

function tierScoreFromRaw(raw: string): number {
  const tier = parseTierName(raw)
  const star = parseTierStar(raw)
  if (tier === 'Bronze') return 1
  if (tier === 'Silver') return star === 2 ? 3 : 2
  if (tier === 'Gold') return star === 2 ? 5 : 4
  return star === 2 ? 7 : 6
}

function startTierScore(def: ItemDef | null): number {
  if (!def) return 1
  const tier = parseTierName(def.starting_tier || 'Bronze')
  if (tier === 'Silver') return 2
  if (tier === 'Gold') return 4
  if (tier === 'Diamond') return 6
  return 1
}

function tierIndexFromRaw(def: ItemDef | null, tierRaw: string): number {
  if (!def) return 0
  const score = tierScoreFromRaw(tierRaw)
  const start = startTierScore(def)
  return Math.max(0, score - start)
}

function ammoFromSkillLines(lines: string[], tierIndex: number): number {
  for (const line of lines) {
    const m = line.match(/弹药\s*[:：]\s*(\+?\d+(?:[\/|]\+?\d+)*)/)
    if (!m?.[1]) continue
    const v = Math.round(pickTierSeriesValue(m[1], tierIndex))
    if (v > 0) return v
  }
  return 0
}

function multicastFromSkillLines(lines: string[], tierIndex: number, fallback: number): number {
  for (const line of lines) {
    const m = line.match(/(?:连续发射|触发)\s*(\+?\d+(?:[\/|]\+?\d+)*)\s*次/)
    if (!m?.[1]) continue
    const v = Math.round(pickTierSeriesValue(m[1], tierIndex))
    if (v > 0) return v
  }
  return fallback
}

function pickTierSeriesValue(series: string, tierIndex: number): number {
  const parts = series.split(/[\/|]/).map((v) => v.trim()).filter(Boolean)
  if (parts.length === 0) return 0
  const idx = Math.max(0, Math.min(parts.length - 1, tierIndex))
  const n = Number((parts[idx] ?? '').replace(/^\+/, '').replace(/%$/u, ''))
  return Number.isFinite(n) ? n : 0
}

type EnemyTier = 'Bronze' | 'Silver' | 'Gold' | 'Diamond'
type EnemyStar = 1 | 2

function tierStarToRaw(tier: EnemyTier, star: EnemyStar): string {
  return `${tier}#${star}`
}

function qualityScoreToTierStar(score: number): { tier: EnemyTier; star: EnemyStar } {
  const s = Math.max(1, Math.min(7, Math.round(score)))
  if (s >= 7) return { tier: 'Diamond', star: 2 }
  if (s >= 6) return { tier: 'Diamond', star: 1 }
  if (s >= 5) return { tier: 'Gold', star: 2 }
  if (s >= 4) return { tier: 'Gold', star: 1 }
  if (s >= 3) return { tier: 'Silver', star: 2 }
  if (s >= 2) return { tier: 'Silver', star: 1 }
  return { tier: 'Bronze', star: 1 }
}

function dailyCurveValue(values: number[] | undefined, day: number, fallback: number): number {
  if (!Array.isArray(values) || values.length === 0) return fallback
  const idx = Math.max(0, Math.min(values.length - 1, Math.floor(day) - 1))
  const v = Number(values[idx])
  return Number.isFinite(v) ? v : fallback
}

function buildQualityScores(itemCount: number, targetAvg: number): number[] {
  const count = Math.max(1, Math.round(itemCount))
  const avg = Math.max(1, Math.min(7, targetAvg))
  const maxScore = Math.max(1, Math.min(7, Math.floor(avg + 1)))
  const targetSum = Math.max(count, Math.min(count * maxScore, Math.floor(avg * count)))
  const base = Math.max(1, Math.min(maxScore, Math.floor(avg)))
  const scores = Array.from({ length: count }, () => base)
  let sum = base * count

  let cursor = 0
  while (sum < targetSum) {
    const i = cursor % count
    if (scores[i]! < maxScore) {
      scores[i] = scores[i]! + 1
      sum += 1
    }
    cursor += 1
    if (cursor > count * 16) break
  }
  cursor = 0
  while (sum > targetSum) {
    const i = cursor % count
    if (scores[i]! > 1) {
      scores[i] = scores[i]! - 1
      sum -= 1
    }
    cursor += 1
    if (cursor > count * 16) break
  }
  return scores
}

function makeSeededRng(seed: number): () => number {
  let s = (seed | 0) ^ 0x9e3779b9
  if (s === 0) s = 0x6d2b79f5
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 1000000) / 1000000
  }
}

function getPrimaryArchetypeTag(rawTags: string): string {
  const first = String(rawTags || '')
    .split('|')[0]?.trim() ?? ''
  const simple = first.split('/')[0]?.trim() ?? ''
  return simple
}

function normalizeSkillArchetype(raw: string): SkillArchetype | null {
  const s = `${raw}`.trim()
  if (s === 'warrior' || s === '战士') return 'warrior'
  if (s === 'archer' || s === '弓手') return 'archer'
  if (s === 'assassin' || s === '刺客') return 'assassin'
  if (s === 'utility' || s === '通用') return 'utility'
  return null
}

const ALL_DRAFT_SKILLS: DraftSkillLite[] = [
  ...BRONZE_SKILL_PICKS,
  ...SILVER_SKILL_PICKS,
  ...GOLD_SKILL_PICKS,
].map((it) => ({
  id: it.id,
  archetype: it.archetype,
  tier: it.tier,
}))

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

const FALLBACK_CD_MS = 3000
const MIN_REDUCED_CD_MS = 100

type CombatRuntimeOverride = {
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

let runtimeOverride: CombatRuntimeOverride = {}

export function setCombatRuntimeOverride(next: CombatRuntimeOverride): void {
  runtimeOverride = { ...next }
}

function rv<K extends keyof CombatRuntimeOverride>(key: K, fallback: number): number {
  const v = runtimeOverride[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function rvBool<K extends keyof CombatRuntimeOverride>(key: K, fallback: boolean): boolean {
  const v = runtimeOverride[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v >= 0.5
  return fallback
}

function parseControlSpecsFromDef(def: ItemDef, cr: ReturnType<typeof getConfig>['combatRuntime']): ControlSpec[] {
  const lines = [
    ...def.skills.map((s) => s.cn),
    ...def.skills.map((s) => s.en),
    def.hidden_tags,
    def.tags,
  ].join('\n')

  const collect = (status: ControlStatus): ControlSpec[] => {
    const keyword = status === 'freeze' ? /冻结|freeze/i : status === 'slow' ? /减速|slow/i : /加速|haste/i
    if (!keyword.test(lines)) return []

    const statusLines = lines.split(/\n+/).filter((line) => keyword.test(line))
    if (statusLines.length === 0) return []

    return statusLines.map((line) => {
      const all = /所有|all/i.test(line)
      const countMatch = line.match(/(\d+)\s*(?:件|个)/) ?? line.match(/(\d+)\s*(items?)/i)
      const secondMatch = line.match(/(\d+(?:\.\d+)?)\s*秒/) ?? line.match(/(\d+(?:\.\d+)?)\s*s(ec)?/i)
      const count = all ? 999 : Math.max(1, Number(countMatch?.[1] ?? 1))
      const sec = Math.max(0.1, Number(secondMatch?.[1] ?? (status === 'freeze' ? 1 : 1.5)))
      const targetSide: 'ally' | 'enemy' = /己方|我方|ally|friendly/i.test(line)
        ? 'ally'
        : status === 'haste'
          ? 'ally'
          : 'enemy'
      const targetMode: ControlSpec['targetMode'] = /左侧|left\s+side|to\s+the\s+left/i.test(line)
        ? 'left'
        : /相邻|adjacent/i.test(line)
        ? 'adjacent'
        : /随机|random/i.test(line)
          ? 'random'
          : /最快|fastest/i.test(line)
            ? 'fastest'
            : 'leftmost'
      const defaultMs = status === 'freeze'
        ? (cr.cardFreezeMs ?? 1000)
        : status === 'slow'
          ? (cr.cardSlowMs ?? 1500)
          : (cr.cardHasteMs ?? 1500)
      const durationMs = Math.max(1, Math.round(sec * 1000)) || defaultMs
      return {
        status,
        durationMs,
        count,
        targetSide,
        targetAll: all,
        targetMode,
      }
    })
  }

  return [
    ...collect('freeze'),
    ...collect('slow'),
    ...collect('haste'),
  ]
}

export class CombatEngine {
  private phase: CombatPhase = 'IDLE'
  private day = 1
  private elapsedMs = 0
  private tickAccumulatorMs = 0
  private fatigueAccumulatorMs = 0
  private fatigueTickCount = 0
  private tickIndex = 0
  private inFatigue = false
  private finished = false
  private result: CombatResult | null = null

  private playerHero: HeroState = { id: 'hero_player', side: 'player', maxHp: 1, hp: 1, shield: 0, burn: 0, poison: 0, regen: 0 }
  private enemyHero: HeroState = { id: 'hero_enemy', side: 'enemy', maxHp: 1, hp: 1, shield: 0, burn: 0, poison: 0, regen: 0 }
  private items: CombatItemRunner[] = []
  private pendingHits: PendingHit[] = []
  private pendingItemFires: PendingItemFire[] = []
  private pendingChargePulses: PendingChargePulse[] = []
  private pendingAmmoRefills: PendingAmmoRefill[] = []
  private lastQueuedFireTickByItem: Map<string, number> = new Map()
  private playerSkillIds = new Set<string>()
  private enemySkillIds = new Set<string>()
  private skillEnemyHalfTriggered = false
  private skillPlayerHalfTriggered = false
  private skillEnemySelfHalfTriggered = false
  private skillEnemyHalfTriggeredFromEnemy = false
  private skillPlayerHalfShieldTriggered = false
  private skillEnemyHalfShieldTriggered = false
  private skillPlayerHalfShieldCdTriggered = false
  private skillEnemyHalfShieldCdTriggered = false
  private skillFirstAmmoEmptyTriggeredBySide: Record<'player' | 'enemy', boolean> = { player: false, enemy: false }
  private skill47ReviveTriggeredBySide: Record<'player' | 'enemy', boolean> = { player: false, enemy: false }
  private deathMarkCheckUsedBySide: Record<'player' | 'enemy', boolean> = { player: false, enemy: false }
  private unyieldingTriggeredBySide: Record<'player' | 'enemy', boolean> = { player: false, enemy: false }
  private heroInvincibleMsBySide: Record<'player' | 'enemy', number> = { player: 0, enemy: 0 }
  private skill86UseCountBySide: Record<'player' | 'enemy', number> = { player: 0, enemy: 0 }
  private skillExecuteDamageBonus = 0
  private skillEnemyExecuteDamageBonus = 0
  private skill33RegenPerTick = 0
  private skillEnemy33RegenPerTick = 0
  private playerBackpackItemCount = 0
  private playerActiveColCount = 0
  private playerGoldAtBattleStart = 0
  private playerTrophyWinsAtBattleStart = 0
  private enemyBackpackItemCount = 0
  private enemyGoldAtBattleStart = 0
  private enemyTrophyWinsAtBattleStart = 0

  private debugShieldChargeLog(msg: string, extra?: Record<string, unknown>): void {
    if (!DEBUG_SHIELD_CHARGE) return
    const payload = extra ? ` ${JSON.stringify(extra)}` : ''
    const line = `[CombatEngine][shield-charge][护盾充能] ${msg}${payload}`
    console.warn(line)
  }

  start(snapshot: BattleSnapshotBundle, options?: CombatStartOptions): void {
    this.reset()
    const cfg = getConfig()
    this.day = snapshot.day
    const enemyHpRow = cfg.dailyEnemyHealth ?? cfg.dailyHealth
    const playerHpRow = cfg.dailyPlayerHealth ?? enemyHpRow
    const hpIdx = Math.max(0, Math.min(enemyHpRow.length - 1, snapshot.day - 1))
    const enemyHp = enemyHpRow[hpIdx] ?? enemyHpRow[0] ?? 300
    const playerHp = playerHpRow[Math.max(0, Math.min(playerHpRow.length - 1, snapshot.day - 1))] ?? playerHpRow[0] ?? enemyHp

    this.playerHero = { id: 'hero_player', side: 'player', maxHp: playerHp, hp: playerHp, shield: 0, burn: 0, poison: 0, regen: 0 }
    this.enemyHero = { id: 'hero_enemy', side: 'enemy', maxHp: enemyHp, hp: enemyHp, shield: 0, burn: 0, poison: 0, regen: 0 }

    const enemyRunners = options?.enemyDisabled ? [] :
      (snapshot.pvpEnemyEntities
        ? snapshot.pvpEnemyEntities.map((it, idx) => ({ ...this.toRunner(it, `E-${idx}`), side: 'enemy' as const }))
        : this.makeEnemyRunners(snapshot))
    this.items = [
      ...snapshot.entities.map((it, idx) => this.toRunner(it, `P-${idx}`)),
      ...enemyRunners,
    ]

    this.playerSkillIds = new Set((options?.playerSkillIds ?? []).map((id) => `${id}`.trim()).filter(Boolean))
    this.enemySkillIds = new Set((options?.enemySkillIds ?? []).map((id) => `${id}`.trim()).filter(Boolean))
    // PVP 模式（pvpEnemyEntities 存在）时不随机生成敌方技能，使用对手传来的 pvpEnemySkillIds（可能为空）
    const isPvpBattle = !!snapshot.pvpEnemyEntities
    if (!options?.enemyDisabled && this.enemySkillIds.size <= 0 && !isPvpBattle) {
      this.enemySkillIds = this.rollEnemySkillIds(snapshot)
    }
    this.skillEnemyHalfTriggered = false
    this.skillPlayerHalfTriggered = false
    this.skillEnemySelfHalfTriggered = false
    this.skillEnemyHalfTriggeredFromEnemy = false
    this.skillPlayerHalfShieldTriggered = false
    this.skillEnemyHalfShieldTriggered = false
    this.skillPlayerHalfShieldCdTriggered = false
    this.skillEnemyHalfShieldCdTriggered = false
    this.skillFirstAmmoEmptyTriggeredBySide = { player: false, enemy: false }
    this.skill47ReviveTriggeredBySide = { player: false, enemy: false }
    this.deathMarkCheckUsedBySide = { player: false, enemy: false }
    this.unyieldingTriggeredBySide = { player: false, enemy: false }
    this.heroInvincibleMsBySide = { player: 0, enemy: 0 }
    this.skill86UseCountBySide = { player: 0, enemy: 0 }
    this.skillExecuteDamageBonus = 0
    this.skillEnemyExecuteDamageBonus = 0
    this.skill33RegenPerTick = 0
    this.skillEnemy33RegenPerTick = 0
    this.playerBackpackItemCount = Math.max(
      0,
      Math.round(options?.playerBackpackItemCount ?? snapshot.playerBackpackItemCount ?? 0),
    )
    this.playerActiveColCount = Math.max(1, Math.round(snapshot.activeColCount || 1))
    this.playerGoldAtBattleStart = Math.max(0, Math.round(options?.playerGold ?? snapshot.playerGold ?? 0))
    this.playerTrophyWinsAtBattleStart = Math.max(0, Math.round(options?.playerTrophyWins ?? snapshot.playerTrophyWins ?? 0))
    this.enemyBackpackItemCount = Math.max(0, Math.round(options?.enemyBackpackItemCount ?? snapshot.pvpEnemyBackpackItemCount ?? 0))
    this.enemyGoldAtBattleStart = Math.max(0, Math.round(options?.enemyGold ?? snapshot.pvpEnemyGold ?? 0))
    this.enemyTrophyWinsAtBattleStart = Math.max(0, Math.round(options?.enemyTrophyWins ?? snapshot.pvpEnemyTrophyWins ?? 0))

    this.applyPickedSkillBattleStartEffects()
    this.applyBattleStartEffects()
    this.clampCombatCaps()

    this.phase = 'INIT'
  }

  update(dt: number): void {
    if (this.phase === 'IDLE' || this.phase === 'END') return
    const cfg = getConfig().combatRuntime
    const deltaMs = dt * 1000
    this.elapsedMs += deltaMs

    if (this.phase === 'INIT') {
      this.phase = 'SETUP'
      return
    }
    if (this.phase === 'SETUP') {
      this.phase = 'TICK'
      return
    }

    if (this.phase === 'TICK') {
      const fatigueStartMs = Math.max(0, rv('fatigueStartMs', cfg.fatigueStartMs ?? cfg.timeoutMs ?? 40000))
      const fatigueIntervalMs = Math.max(1, rv('fatigueTickMs', cfg.fatigueTickMs ?? cfg.fatigueIntervalMs ?? 1000))

      if (!this.inFatigue && this.elapsedMs >= fatigueStartMs) {
        this.inFatigue = true
        EventBus.emit('battle:fatigue_start', { elapsedMs: this.elapsedMs })
      }

      if (this.shouldResolve()) {
        this.phase = 'RESOLVE'
      }
      if (this.phase === 'RESOLVE') {
        this.finishCombat()
        return
      }

      this.tickAccumulatorMs += deltaMs
      while (this.tickAccumulatorMs >= cfg.tickMs) {
        this.tickAccumulatorMs -= cfg.tickMs
        this.stepOneTick(cfg.tickMs)
        if (this.shouldResolve()) {
          this.phase = 'RESOLVE'
          break
        }
        if (this.inFatigue) {
          this.fatigueAccumulatorMs += cfg.tickMs
          while (this.fatigueAccumulatorMs >= fatigueIntervalMs) {
            this.fatigueAccumulatorMs -= fatigueIntervalMs
            this.stepFatigue()
            if (this.shouldResolve()) {
              this.phase = 'RESOLVE'
              break
            }
          }
          if (this.phase === 'RESOLVE') break
        }
      }
    }

    if (this.phase === 'RESOLVE') this.finishCombat()
  }

  getPhase(): CombatPhase {
    return this.phase
  }

  isFinished(): boolean {
    return this.finished
  }

  getResult(): CombatResult | null {
    return this.result ? { ...this.result } : null
  }

  getEnemySkillIds(): string[] {
    return Array.from(this.enemySkillIds)
  }

  getDebugState(): { tickIndex: number; playerAlive: number; enemyAlive: number; playerHp: number; enemyHp: number; inFatigue: boolean; enemySkillCount: number } {
    return {
      tickIndex: this.tickIndex,
      playerAlive: this.playerHero.hp > 0 ? 1 : 0,
      enemyAlive: this.enemyHero.hp > 0 ? 1 : 0,
      playerHp: this.playerHero.hp,
      enemyHp: this.enemyHero.hp,
      inFatigue: this.inFatigue,
      enemySkillCount: this.enemySkillIds.size,
    }
  }

  getBoardState(): { player: HeroState; enemy: HeroState; items: CombatBoardItem[] } {
    const playerRegenDisplay = this.playerHero.regen + (this.hasPlayerSkill('skill33') ? Math.max(0, this.skill33RegenPerTick) : 0)
    const enemyRegenDisplay = this.enemyHero.regen + (this.hasEnemySkill('skill33') ? Math.max(0, this.skillEnemy33RegenPerTick) : 0)
    return {
      player: { ...this.playerHero, regen: playerRegenDisplay },
      enemy: { ...this.enemyHero, regen: enemyRegenDisplay },
      items: this.items.map((it) => ({
        id: it.id,
        side: it.side,
        defId: it.defId,
        col: it.col,
        row: it.row,
        size: it.size,
        tier: it.tier,
        tierStar: it.tierStar,
        chargeRatio: Math.max(0, Math.min(1, it.runtime.currentChargeMs / Math.max(1, this.effectiveCooldownMs(it)))),
      })),
    }
  }

  getRuntimeState(): CombatItemRuntimeState[] {
    return this.items.map((it) => ({
      ...(() => {
        const skillMul = this.skillDamageMultiplier(it)
        const baseDamageRaw = Math.max(0, it.baseStats.damage + this.runtimeGlobalDamageBonus(it))
        const baseDamageUnscaled = Math.max(0, Math.round(baseDamageRaw * skillMul))
        let runtimeDamage = this.scaledDamage(it, baseDamageUnscaled + it.runtime.tempDamageBonus)
        const def = this.findItemDef(it.defId)
        if (def && this.skillLines(def).some((s) => /相邻回旋镖时伤害翻倍/.test(s))) {
          const hasAdjacentSame = this.items.some((other) =>
            other.id !== it.id
            && other.side === it.side
            && other.defId === it.defId
            && this.isAdjacentByFootprint(other, it),
          )
          if (hasAdjacentSame) runtimeDamage *= 2
        }
        if (def) {
          const tIdx = this.tierIndex(def, it.tier)
          const lines = this.skillLines(def)
          const sourceHero = it.side === 'player' ? this.playerHero : this.enemyHero
          const targetHero = it.side === 'player' ? this.enemyHero : this.playerHero
          if (lines.some((s) => /等同于当前自身护盾值|根据当前护盾值对对方造成伤害/.test(s))) {
            runtimeDamage += Math.max(0, sourceHero.shield)
          }
          const maxHpLine = lines.find((s) => /最大生命值.*%.*伤害/.test(s) && !/摧毁自身/.test(s) && !/第一次攻击/.test(s))
          if (maxHpLine) {
            const m = maxHpLine.match(/最大生命值\s*([+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*)\s*的伤害/)
            if (m?.[1]) {
              const pct = /[\/|]/.test(m[1]) ? pickTierSeriesValue(m[1], tIdx) : Number(m[1].replace(/%$/u, ''))
              if (Number.isFinite(pct) && pct > 0) {
                runtimeDamage += Math.round(targetHero.maxHp * (pct / 100))
              }
            }
          }
          const firstHitLine = lines.find((s) => /第一次攻击额外造成目标最大生命值\d+(?:[\/|]\d+)*%的伤害/.test(s))
          if (firstHitLine && it.runtime.executeCount < 1) {
            const pct = Math.max(0, this.tierValueFromLine(firstHitLine, tIdx))
            if (pct > 0) runtimeDamage += Math.round(targetHero.maxHp * (pct / 100))
          }
          const selfHpPctLine = lines.find((s) => /额外造成自身当前生命值\d+(?:[\/|]\d+)*%的伤害/.test(s))
          if (selfHpPctLine) {
            const pct = Math.max(0, this.tierValueFromLine(selfHpPctLine, tIdx))
            if (pct > 0) runtimeDamage += Math.round(sourceHero.hp * (pct / 100))
          }
          const selfMaxHpPctLine = lines.find((s) => /额外造成自身最大生命值\d+(?:[\/|]\d+)*%的伤害/.test(s))
          if (selfMaxHpPctLine) {
            const pct = Math.max(0, this.tierValueFromLine(selfMaxHpPctLine, tIdx))
            if (pct > 0) runtimeDamage += Math.round(sourceHero.maxHp * (pct / 100))
          }
          if (lines.some((s) => /如果这是唯一的伤害物品[，,]?造成3倍伤害/.test(s))) {
            const attackers = this.items.filter((other) => other.side === it.side && this.isDamageItemForUniqueCheck(other))
            if (attackers.length === 1) runtimeDamage = Math.max(0, runtimeDamage * 3)
          }
          const emptyAmmoBurstLine = lines.find((s) => /弹药耗尽时造成\d+(?:[\/|]\d+)*倍伤害/.test(s))
          if (emptyAmmoBurstLine && it.runtime.ammoMax > 0 && it.runtime.ammoCurrent > 0) {
            const emptyAmmoBurstMul = Math.max(1, this.tierValueFromLine(emptyAmmoBurstLine, tIdx))
            const phantomCount = this.items.filter((other) => {
              if (other.side !== it.side) return false
              if (other.id === it.id) return false
              const otherDef = this.findItemDef(other.defId)
              return this.skillLines(otherDef).some((line) => /弹药物品伤害\+\d+(?:[\/|]\d+)*，弹药消耗翻倍/.test(line))
            }).length
            const ammoSpendPerUse = 1 + phantomCount
            const willEmptyAmmoThisUse = it.runtime.ammoCurrent - ammoSpendPerUse <= 0
            if (willEmptyAmmoThisUse && emptyAmmoBurstMul > 1) {
              runtimeDamage = Math.max(0, Math.round(runtimeDamage * emptyAmmoBurstMul))
            }
          }
          const explode = lines.find((s) => /弹药耗尽时摧毁自身.*最大生命值.*%.*伤害/.test(s))
          if (explode) {
            const pctSeries = explode.match(/最大生命值\s*([+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*)\s*的伤害/)
            const pct = pctSeries?.[1]
              ? (/[\/|]/.test(pctSeries[1]) ? pickTierSeriesValue(pctSeries[1], tIdx) : Number(pctSeries[1].replace(/%$/u, '')))
              : 0
            if (pct > 0) runtimeDamage = Math.max(runtimeDamage, Math.round(targetHero.maxHp * (pct / 100)))
          }
        }
        runtimeDamage = Math.max(0, Math.min(ITEM_DAMAGE_CAP, Math.round(runtimeDamage)))
        let runtimeHeal = Math.max(0, it.baseStats.heal)
        let runtimeShield = Math.max(0, it.baseStats.shield + this.shieldGainBonusForItem(it))
        if (def) {
          const tIdx = this.tierIndex(def, it.tier)
          const lines = this.skillLines(def)
          const sourceHero = it.side === 'player' ? this.playerHero : this.enemyHero
          const maxHpHealLine = lines.find((s) => /恢复最大生命值\s*[+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*\s*的生命值/.test(s))
          if (maxHpHealLine) {
            const pct = Math.max(0, this.tierValueFromLine(maxHpHealLine, tIdx)) / 100
            if (pct > 0) runtimeHeal += Math.max(0, Math.round(sourceHero.maxHp * pct))
          }
          if (lines.some((s) => /获得护盾[，,]?等于当前生命值/.test(s))) {
            runtimeShield = Math.max(0, Math.round(sourceHero.hp))
          } else {
            runtimeShield = Math.max(0, this.scaleShieldGain(it.side, runtimeShield))
          }
          const unyieldingLine = lines.find((s) => /濒死时获得3秒无敌.*最大生命值.*%.*护盾/.test(s))
          if (unyieldingLine) {
            const m = unyieldingLine.match(/最大生命值\s*([+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*)\s*的护盾/)
            if (m?.[1]) {
              const pct = /[\/|]/.test(m[1]) ? pickTierSeriesValue(m[1], tIdx) : Number(m[1].replace(/%$/u, ''))
              if (Number.isFinite(pct) && pct > 0) {
                const shield = this.scaleShieldGain(it.side, Math.round(sourceHero.maxHp * (pct / 100)))
                runtimeShield = Math.max(runtimeShield, Math.max(0, shield))
              }
            }
          }
        }
        return {
          id: it.id,
          side: it.side,
          currentChargeMs: it.runtime.currentChargeMs,
          cooldownMs: Math.max(0, this.effectiveCooldownMs(it)),
          chargePercent: Math.max(0, Math.min(1, it.runtime.currentChargeMs / Math.max(1, this.effectiveCooldownMs(it)))),
          executeCount: it.runtime.executeCount,
          tempDamageBonus: it.runtime.tempDamageBonus,
          ammoMax: it.runtime.ammoMax,
          ammoCurrent: it.runtime.ammoCurrent,
          freezeMs: it.runtime.modifiers.freezeMs,
          slowMs: it.runtime.modifiers.slowMs,
          hasteMs: it.runtime.modifiers.hasteMs,
          damage: runtimeDamage,
          heal: Math.max(0, runtimeHeal),
          shield: Math.max(0, Math.min(HERO_SHIELD_CAP, runtimeShield)),
          burn: Math.max(0, it.baseStats.burn),
          poison: Math.max(0, it.baseStats.poison),
          multicast: (() => {
            const base = Math.max(1, Math.round(it.baseStats.multicast))
            const goldMulticast = this.hasSkill(it.side, 'skill88') && this.elapsedMs <= 5000 ? 1 : 0
            const boosted = Math.max(1, base + Math.max(0, Math.round(it.runtime.bonusMulticast)) + goldMulticast)
            const localDef = this.findItemDef(it.defId)
            if (!localDef) return boosted
            const allAmmoShot = this.skillLines(localDef).some((s) => /(?:一次)?打出所有弹药/.test(s))
            if (!allAmmoShot || it.runtime.ammoMax <= 0) return boosted
            return Math.max(boosted, Math.max(1, it.runtime.ammoCurrent))
          })(),
        }
      })(),
    }))
  }

  private reset(): void {
    this.phase = 'IDLE'
    this.elapsedMs = 0
    this.tickAccumulatorMs = 0
    this.fatigueAccumulatorMs = 0
    this.fatigueTickCount = 0
    this.tickIndex = 0
    this.inFatigue = false
    this.finished = false
    this.result = null
    this.items = []
    this.pendingHits = []
    this.pendingItemFires = []
    this.pendingChargePulses = []
    this.pendingAmmoRefills = []
    this.lastQueuedFireTickByItem.clear()
    this.playerSkillIds.clear()
    this.enemySkillIds.clear()
    this.skillEnemyHalfTriggered = false
    this.skillPlayerHalfTriggered = false
    this.skillEnemySelfHalfTriggered = false
    this.skillEnemyHalfTriggeredFromEnemy = false
    this.skillPlayerHalfShieldTriggered = false
    this.skillEnemyHalfShieldTriggered = false
    this.skillPlayerHalfShieldCdTriggered = false
    this.skillEnemyHalfShieldCdTriggered = false
    this.skillFirstAmmoEmptyTriggeredBySide = { player: false, enemy: false }
    this.skill47ReviveTriggeredBySide = { player: false, enemy: false }
    this.deathMarkCheckUsedBySide = { player: false, enemy: false }
    this.unyieldingTriggeredBySide = { player: false, enemy: false }
    this.heroInvincibleMsBySide = { player: 0, enemy: 0 }
    this.skill86UseCountBySide = { player: 0, enemy: 0 }
    this.skillExecuteDamageBonus = 0
    this.skillEnemyExecuteDamageBonus = 0
    this.skill33RegenPerTick = 0
    this.skillEnemy33RegenPerTick = 0
    this.playerBackpackItemCount = 0
    this.playerActiveColCount = 0
    this.playerGoldAtBattleStart = 0
    this.playerTrophyWinsAtBattleStart = 0
    this.enemyBackpackItemCount = 0
    this.enemyGoldAtBattleStart = 0
    this.enemyTrophyWinsAtBattleStart = 0
  }

  private hasPlayerSkill(id: string): boolean {
    return this.playerSkillIds.has(id)
  }

  private hasEnemySkill(id: string): boolean {
    return this.enemySkillIds.has(id)
  }

  private hasSkill(side: 'player' | 'enemy', id: string): boolean {
    return side === 'player' ? this.hasPlayerSkill(id) : this.hasEnemySkill(id)
  }

  private heroOf(side: 'player' | 'enemy'): HeroState {
    return side === 'player' ? this.playerHero : this.enemyHero
  }

  private oppositeSide(side: 'player' | 'enemy'): 'player' | 'enemy' {
    return side === 'player' ? 'enemy' : 'player'
  }

  private isHeroInvincible(side: 'player' | 'enemy'): boolean {
    return (this.heroInvincibleMsBySide[side] ?? 0) > 0
  }

  private itemArchetype(def: ItemDef | null): string {
    return getPrimaryArchetypeTag(def?.tags ?? '')
  }

  private hasLine(def: ItemDef | null, regex: RegExp): boolean {
    return this.skillLines(def).some((s) => regex.test(s))
  }

  private isItemDestroyImmune(item: CombatItemRunner): boolean {
    const def = this.findItemDef(item.defId)
    const lines = this.skillLines(def)
    return lines.some((s) => /无敌|不可摧毁/.test(s))
  }

  private rollEnemySkillIds(snapshot: BattleSnapshotBundle): Set<string> {
    const out = new Set<string>()
    const skillCfg = getConfig().skillSystem
    if (!skillCfg?.enemyMirrorDraft?.enabled) return out

    const planRows = Array.isArray(skillCfg.dailyDraftPlan) ? skillCfg.dailyDraftPlan : []
    const draftedPlans = planRows
      .filter((it) => Math.round(Number(it.day) || 0) <= this.day && (Number(it.shouldDraft) || 0) >= 0.5)
      .sort((a, b) => (Math.round(Number(a.day) || 0) - Math.round(Number(b.day) || 0)))
    if (draftedPlans.length <= 0) return out

    const pickByDay = skillCfg.enemyMirrorDraft.pickCountByDay ?? []
    const configuredPick = Math.max(0, Math.round(Number(pickByDay[Math.max(0, this.day - 1)] ?? 0) || 0))
    const pickCount = Math.max(configuredPick, draftedPlans.length)
    if (pickCount <= 0) return out

    const rngSeed = this.day * 1619 + Math.max(1, Math.round(snapshot.createdAtMs % 1000000)) * 13 + this.items.length * 97
    const rng = makeSeededRng(rngSeed)

    const enemyItems = this.items.filter((it) => it.side === 'enemy')
    const archCount = new Map<SkillArchetype, number>()
    for (const one of enemyItems) {
      const def = this.findItemDef(one.defId)
      const tag = normalizeSkillArchetype(getPrimaryArchetypeTag(def?.tags ?? ''))
      if (!tag) continue
      archCount.set(tag, (archCount.get(tag) ?? 0) + 1)
    }

    const archetypes: SkillArchetype[] = ['warrior', 'archer', 'assassin', 'utility']
    const maxCount = Math.max(...archetypes.map((k) => archCount.get(k) ?? 0), 0)
    const preferredPool = archetypes.filter((k) => (archCount.get(k) ?? 0) === maxCount)
    const preferredArchetype = preferredPool.length > 0
      ? preferredPool[Math.floor(rng() * preferredPool.length)]!
      : 'utility'

    const minRatioRaw = Number(skillCfg.enemyMirrorDraft.mainArchetypeRatioMin ?? 0.4)
    const maxRatioRaw = Number(skillCfg.enemyMirrorDraft.mainArchetypeRatioMax ?? 0.8)
    const minRatio = Math.max(0, Math.min(1, Math.min(minRatioRaw, maxRatioRaw)))
    const maxRatio = Math.max(0, Math.min(1, Math.max(minRatioRaw, maxRatioRaw)))
    const minMain = Math.max(0, Math.min(pickCount, Math.ceil(pickCount * minRatio)))
    const maxMain = Math.max(minMain, Math.min(pickCount, Math.floor(pickCount * maxRatio)))
    const targetMain = minMain + Math.floor(rng() * (maxMain - minMain + 1))

    const used = new Set<string>()
    const pickTierByPlan = (plan: Record<string, unknown>): SkillTierLite => {
      const bronzeProb = Math.max(0, Number(plan.bronzeProb) || 0)
      const silverProb = Math.max(0, Number(plan.silverProb) || 0)
      const goldProb = Math.max(0, Number(plan.goldProb) || 0)
      const tierSum = bronzeProb + silverProb + goldProb
      if (tierSum <= 0) return 'bronze'
      let roll = rng() * tierSum
      if (roll < bronzeProb) return 'bronze'
      roll -= bronzeProb
      if (roll < silverProb) return 'silver'
      return 'gold'
    }

    const pickOne = (tier: SkillTierLite, forcedArch: SkillArchetype | null): DraftSkillLite | null => {
      const tierPool = ALL_DRAFT_SKILLS.filter((s) => s.tier === tier && !used.has(s.id))
      const forcePool = forcedArch ? tierPool.filter((s) => s.archetype === forcedArch) : tierPool
      const primary = forcePool.length > 0 ? forcePool : tierPool
      if (primary.length <= 0) return null
      return primary[Math.floor(rng() * primary.length)] ?? null
    }

    const slotPlans: Array<Record<string, unknown>> = [...draftedPlans]
    while (slotPlans.length < pickCount) {
      const idx = Math.max(0, draftedPlans.length - 1 - ((slotPlans.length - draftedPlans.length) % draftedPlans.length))
      slotPlans.push(draftedPlans[idx]!)
    }

    const slotMustMain = Array.from({ length: slotPlans.length }, (_, i) => i < targetMain)
    for (let i = slotMustMain.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const t = slotMustMain[i]
      slotMustMain[i] = slotMustMain[j]!
      slotMustMain[j] = t!
    }

    for (let i = 0; i < slotPlans.length; i++) {
      const tier = pickTierByPlan(slotPlans[i]!)
      const mustMain = slotMustMain[i] === true
      const picked = pickOne(tier, mustMain ? preferredArchetype : null)
      if (!picked) continue
      used.add(picked.id)
      out.add(picked.id)
    }

    return out
  }

  private isWeaponItem(item: CombatItemRunner): boolean {
    return this.isDamageBonusEligible(item)
  }

  private isShieldItem(item: CombatItemRunner): boolean {
    return item.baseStats.shield > 0
  }

  private isAmmoItem(item: CombatItemRunner): boolean {
    return item.runtime.ammoMax > 0
  }

  private isDamageBonusEligible(item: CombatItemRunner): boolean {
    return item.baseStats.damage > 0 && !this.isShieldItem(item)
  }

  private isDamageItemForUniqueCheck(item: CombatItemRunner): boolean {
    if (this.isDamageBonusEligible(item)) return true
    const def = this.findItemDef(item.defId)
    return this.skillLines(def).some((s) => /弹药耗尽时摧毁自身.*最大生命值.*%.*伤害/.test(s))
  }

  private cooldownReductionPct(item: CombatItemRunner): number {
    const side = item.side
    let pct = 0
    if (this.hasSkill(side, 'skill6')) pct += 0.05
    if (this.hasSkill(side, 'skill12') && this.isAmmoItem(item)) pct += 0.1
    if (this.hasSkill(side, 'skill14') && this.elapsedMs <= 5000) pct += 0.1
    if (this.hasSkill(side, 'skill38') && this.heroOf(side).shield > 0) pct += 0.2
    if (this.hasSkill(side, 'skill40')) pct += 0.1
    if (this.hasSkill(side, 'skill26') && ((side === 'player' ? this.skillPlayerHalfShieldCdTriggered : this.skillEnemyHalfShieldCdTriggered)) && this.isShieldItem(item)) pct += 0.15
    if (this.hasSkill(side, 'skill60') && !this.hasAnyShieldItems(side)) pct += 0.1

    const selfDef = this.findItemDef(item.defId)
    const selfArch = this.itemArchetype(selfDef)
    if (selfArch === '刺客') {
      for (const owner of this.items) {
        if (owner.side !== side) continue
        const def = this.findItemDef(owner.defId)
        const line = this.skillLines(def).find((s) => /刺客物品间隔缩短\d+(?:[\/|]\d+)*%/.test(s))
        if (!line) continue
        const tIdx = this.tierIndex(def, owner.tier)
        const reducedPct = Math.max(0, this.tierValueFromLine(line, tIdx)) / 100
        pct += reducedPct
      }
    }
    return Math.max(0, Math.min(0.95, pct))
  }

  private effectiveCooldownMs(item: CombatItemRunner): number {
    if (item.baseStats.cooldownMs <= 0) return 0
    const pct = this.cooldownReductionPct(item)
    const reduced = Math.round(item.baseStats.cooldownMs * (1 - pct))
    return Math.max(this.minReducedCdMsFor(item), reduced)
  }

  private minReducedCdMsFor(item: CombatItemRunner): number {
    return this.hasSkill(item.side, 'skill40') ? 100 : MIN_REDUCED_CD_MS
  }

  private runtimeGlobalDamageBonus(item: CombatItemRunner): number {
    if (!this.isDamageBonusEligible(item)) return 0
    const side = item.side
    let bonus = side === 'player' ? this.skillExecuteDamageBonus : this.skillEnemyExecuteDamageBonus
    if (this.hasSkill(side, 'skill13') && this.elapsedMs <= 5000) bonus += 12
    if (this.hasSkill(side, 'skill53')) bonus += this.totalAmmoCurrent(side) * 4
    if (this.hasSkill(side, 'skill27') && this.effectiveCooldownMs(item) < 2500) bonus += 20
    if (this.hasSkill(side, 'skill37')) bonus += Math.floor(Math.max(0, this.heroOf(side).shield) / 10)
    return bonus
  }

  private itemDamageScale(item: CombatItemRunner): number {
    return Math.max(0, item.runtime.damageScale || 1)
  }

  private scaledDamage(item: CombatItemRunner, value: number): number {
    const scaled = Math.max(0, Math.round(Math.max(0, value) * this.itemDamageScale(item)))
    return Math.min(ITEM_DAMAGE_CAP, scaled)
  }

  private clampHeroState(hero: HeroState): void {
    hero.maxHp = Math.max(1, Math.min(HERO_MAX_HP_CAP, Math.round(hero.maxHp)))
    hero.hp = Math.max(0, Math.min(hero.maxHp, Math.round(hero.hp)))
    hero.shield = Math.max(0, Math.min(HERO_SHIELD_CAP, Math.round(hero.shield)))
  }

  private clampCombatCaps(): void {
    this.clampHeroState(this.playerHero)
    this.clampHeroState(this.enemyHero)
    for (const item of this.items) {
      item.baseStats.damage = Math.max(0, Math.min(ITEM_DAMAGE_CAP, Math.round(item.baseStats.damage)))
    }
  }

  private uniqueDamageItem(side: 'player' | 'enemy'): CombatItemRunner | null {
    const items = this.items.filter((it) => it.side === side && this.isDamageBonusEligible(it))
    return items.length === 1 ? items[0]! : null
  }

  private uniqueAmmoItem(side: 'player' | 'enemy'): CombatItemRunner | null {
    const items = this.items.filter((it) => it.side === side && this.isAmmoItem(it))
    return items.length === 1 ? items[0]! : null
  }

  private allItemsAreAmmo(side: 'player' | 'enemy'): boolean {
    const items = this.items.filter((it) => it.side === side)
    if (items.length <= 0) return false
    return items.every((it) => this.isAmmoItem(it))
  }

  private skillDamageMultiplier(item: CombatItemRunner): number {
    const side = item.side
    let mul = 1
    if (this.hasSkill(side, 'skill43') && this.uniqueDamageItem(side)?.id === item.id) mul *= 1.5
    if (this.hasSkill(side, 'skill44') && this.uniqueAmmoItem(side)?.id === item.id) mul *= 1.5
    if (this.hasSkill(side, 'skill84') && this.allItemsAreAmmo(side)) mul *= 1.5
    return Math.max(0, mul)
  }

  private applyOnDealDamageLifesteal(attacker: CombatItemRunner, dealtHpDamage: number): void {
    const dealt = Math.max(0, Math.round(dealtHpDamage))
    if (dealt <= 0) return
    const hasSkill43Lifesteal = this.hasSkill(attacker.side, 'skill43') && this.uniqueDamageItem(attacker.side)?.id === attacker.id
    if (!hasSkill43Lifesteal) return
    const hero = this.heroOf(attacker.side)
    if (hero.hp <= 0) return
    const healAmount = Math.max(1, Math.round(dealt))
    const healed = Math.max(0, Math.min(hero.maxHp - hero.hp, healAmount))
    if (healed <= 0) return
    hero.hp += healed
    EventBus.emit('battle:heal', {
      targetId: hero.id,
      sourceItemId: attacker.id,
      amount: healed,
      isRegen: false,
      targetType: 'hero',
      targetSide: hero.side,
      sourceType: 'item',
      sourceSide: attacker.side,
    })
  }

  private hasAnyShieldItems(side: 'player' | 'enemy'): boolean {
    return this.items.some((it) => it.side === side && this.isShieldItem(it))
  }

  private occupiedColsBySide(side: 'player' | 'enemy'): number {
    const occupied = new Set<number>()
    for (const one of this.items) {
      if (one.side !== side) continue
      const width = this.itemWidth(one.size)
      for (let c = 0; c < width; c++) occupied.add(one.col + c)
    }
    return occupied.size
  }

  private totalAmmoCurrent(side: 'player' | 'enemy'): number {
    let total = 0
    for (const it of this.items) {
      if (it.side !== side) continue
      total += Math.max(0, it.runtime.ammoCurrent)
    }
    return total
  }

  private sortedItemsBySide(side: 'player' | 'enemy', filterFn: (item: CombatItemRunner) => boolean): CombatItemRunner[] {
    return this.items
      .filter((it) => it.side === side && filterFn(it))
      .sort((a, b) => (a.col - b.col) || a.id.localeCompare(b.id))
  }

  private applyPickedSkillBattleStartEffects(): void {
    const isZoneNotFull = (side: 'player' | 'enemy'): boolean => {
      const cap = Math.max(1, this.playerActiveColCount)
      return this.occupiedColsBySide(side) < cap
    }

    const applySide = (side: 'player' | 'enemy'): void => {
      const hasAnySkill = side === 'player' ? this.playerSkillIds.size > 0 : this.enemySkillIds.size > 0
      if (!hasAnySkill) return
      const hero = this.heroOf(side)
      const shieldItems = this.sortedItemsBySide(side, (it) => this.isShieldItem(it))
      const ammoItems = this.sortedItemsBySide(side, (it) => this.isAmmoItem(it))
      const weaponItems = this.sortedItemsBySide(side, (it) => this.isWeaponItem(it))

      if (this.hasSkill(side, 'skill1') && shieldItems.length > 0) shieldItems[0]!.baseStats.shield += 25
      if (this.hasSkill(side, 'skill2') && shieldItems.length > 0) shieldItems[shieldItems.length - 1]!.baseStats.shield += 25
      if (this.hasSkill(side, 'skill3')) {
        for (const one of shieldItems) one.baseStats.shield += 10
      }

      if (this.hasSkill(side, 'skill7')) {
        hero.maxHp = Math.max(1, Math.round(hero.maxHp * 1.1))
        hero.hp = Math.min(hero.maxHp, Math.round(hero.hp * 1.1))
      }

      if (this.hasSkill(side, 'skill49') && isZoneNotFull(side)) {
        hero.maxHp = Math.max(1, Math.round(hero.maxHp * 2))
        hero.hp = Math.min(hero.maxHp, Math.round(hero.hp * 2))
      }

      if (this.hasSkill(side, 'skill36')) {
        const gainShield = this.scaleShieldGain(side, Math.round(hero.maxHp * 0.3))
        if (gainShield > 0) {
          hero.shield += gainShield
          EventBus.emit('battle:gain_shield', {
            targetId: hero.id,
            sourceItemId: 'skill36',
            amount: gainShield,
            targetType: 'hero',
            targetSide: hero.side,
            sourceType: 'system',
            sourceSide: side,
          })
          this.applyOnShieldGainCharge(side)
          this.applyShieldGainSkillTriggers(side, 'skill36', gainShield, false)
        }
      }

      if (this.hasSkill(side, 'skill8') && ammoItems.length > 0) {
        const one = ammoItems[0]!
        one.runtime.ammoMax += 2
        one.runtime.ammoCurrent = Math.min(one.runtime.ammoMax, one.runtime.ammoCurrent + 2)
      }
      if (this.hasSkill(side, 'skill51')) {
        for (const one of ammoItems) {
          one.runtime.ammoMax += 2
          one.runtime.ammoCurrent = Math.min(one.runtime.ammoMax, one.runtime.ammoCurrent + 2)
        }
      }
      if (this.hasSkill(side, 'skill44') && ammoItems.length === 1) {
        const one = ammoItems[0]!
        one.runtime.ammoMax += 10
        one.runtime.ammoCurrent = Math.min(one.runtime.ammoMax, one.runtime.ammoCurrent + 10)
      }

      if (this.hasSkill(side, 'skill10')) {
        for (const one of ammoItems) one.baseStats.damage += 10
      }

      if (this.hasSkill(side, 'skill16')) {
        for (const one of weaponItems) one.baseStats.damage += 8
      }

      if (this.hasSkill(side, 'skill19') && weaponItems.length > 0) {
        const first = weaponItems[0]!
        const last = weaponItems[weaponItems.length - 1]!
        first.baseStats.damage += 12
        if (last.id !== first.id) last.baseStats.damage += 12
      }

      if (this.hasSkill(side, 'skill59')) {
        const countByDef = new Map<string, number>()
        for (const one of this.items) {
          if (one.side !== side) continue
          countByDef.set(one.defId, (countByDef.get(one.defId) ?? 0) + 1)
        }
        for (const one of this.items) {
          if (one.side !== side) continue
          if (one.baseStats.damage <= 0) continue
          if ((countByDef.get(one.defId) ?? 0) < 2) continue
          one.baseStats.damage += 20
        }
      }

      const backpackCount = side === 'player' ? this.playerBackpackItemCount : this.enemyBackpackItemCount
      if (this.hasSkill(side, 'skill35') && backpackCount > 0) {
        const mul = 1 + backpackCount * 0.02
        hero.maxHp = Math.max(1, Math.round(hero.maxHp * mul))
        hero.hp = Math.min(hero.maxHp, Math.round(hero.hp * mul))
      }

      const trophyWins = side === 'player' ? this.playerTrophyWinsAtBattleStart : this.enemyTrophyWinsAtBattleStart
      const goldAtStart = side === 'player' ? this.playerGoldAtBattleStart : this.enemyGoldAtBattleStart
      const execBonus = side === 'player' ? 'skillExecuteDamageBonus' : 'skillEnemyExecuteDamageBonus'
      if (this.hasSkill(side, 'skill46') && trophyWins > 0) {
        this[execBonus] += trophyWins * 15
      }
      if (this.hasSkill(side, 'skill95') && goldAtStart > 0) {
        this[execBonus] += goldAtStart
      }

      if (this.hasSkill(side, 'skill33')) {
        const regenPerTick = Math.max(1, Math.round(hero.maxHp * 0.03))
        if (side === 'player') this.skill33RegenPerTick = regenPerTick
        else this.skillEnemy33RegenPerTick = regenPerTick
      }
    }

    applySide('player')
    applySide('enemy')
  }

  private handleHeroHpThresholdTriggers(side: 'player' | 'enemy', hpBefore: number, hpAfter: number): void {
    const hero = side === 'player' ? this.playerHero : this.enemyHero
    if (hpBefore > 0 && hpAfter <= 0 && !this.unyieldingTriggeredBySide[side]) {
      const guard = this.items.find((it) => {
        if (it.side !== side) return false
        const def = this.findItemDef(it.defId)
        return this.skillLines(def).some((s) => /濒死时获得3秒无敌.*最大生命值.*%.*护盾/.test(s))
      })
      if (guard) {
        const def = this.findItemDef(guard.defId)
        const line = this.skillLines(def).find((s) => /濒死时获得3秒无敌.*最大生命值.*%.*护盾/.test(s))
        let pct = 0
        if (line) {
          const tIdx = this.tierIndex(def, guard.tier)
          const m = line.match(/最大生命值\s*([+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*)\s*的护盾/)
          if (m?.[1]) {
            pct = /[\/|]/.test(m[1]) ? pickTierSeriesValue(m[1], tIdx) : Number(m[1].replace(/%$/u, ''))
            pct = Math.max(0, pct)
          }
        }
        this.unyieldingTriggeredBySide[side] = true
        hero.hp = 1
        this.heroInvincibleMsBySide[side] = Math.max(this.heroInvincibleMsBySide[side], 3000)
        if (pct > 0) {
          const gainShield = this.scaleShieldGain(side, Math.round(hero.maxHp * (pct / 100)))
          if (gainShield > 0) {
            hero.shield += gainShield
            EventBus.emit('battle:gain_shield', {
              targetId: hero.id,
              sourceItemId: guard.id,
              amount: gainShield,
              targetType: 'hero',
              targetSide: hero.side,
              sourceType: 'item',
              sourceSide: side,
            })
          }
        }
        hpAfter = hero.hp
      }
    }

    const threshold = hero.maxHp * 0.5
    if (!(hpBefore > threshold && hpAfter <= threshold)) return

    const owner = this.oppositeSide(side)
    if (owner === 'player') {
      if (!this.skillEnemyHalfTriggered && (this.hasPlayerSkill('skill18') || this.hasPlayerSkill('skill45'))) {
        this.skillEnemyHalfTriggered = true
        if (this.hasPlayerSkill('skill18')) this.skillExecuteDamageBonus += 15
        if (this.hasPlayerSkill('skill45')) {
          for (const it of this.items) {
            if (it.side !== 'player') continue
            this.chargeItemByMs(it, 2000)
          }
        }
      }
    } else {
      if (!this.skillEnemyHalfTriggeredFromEnemy && (this.hasEnemySkill('skill18') || this.hasEnemySkill('skill45'))) {
        this.skillEnemyHalfTriggeredFromEnemy = true
        if (this.hasEnemySkill('skill18')) this.skillEnemyExecuteDamageBonus += 15
        if (this.hasEnemySkill('skill45')) {
          for (const it of this.items) {
            if (it.side !== 'enemy') continue
            this.chargeItemByMs(it, 2000)
          }
        }
      }
    }

    if (side === 'player') {
      if (!this.skillPlayerHalfTriggered && this.hasPlayerSkill('skill21')) {
        this.skillPlayerHalfTriggered = true
        const heal = Math.max(0, Math.round(hero.maxHp * 0.15))
        const real = Math.max(0, Math.min(hero.maxHp - hero.hp, heal))
        if (real > 0) {
          hero.hp += real
          EventBus.emit('battle:heal', {
            targetId: hero.id,
            sourceItemId: 'skill21',
            amount: real,
            isRegen: false,
            targetType: 'hero',
            targetSide: hero.side,
            sourceType: 'system',
            sourceSide: 'player',
          })
        }
      }

      if (!this.skillPlayerHalfShieldTriggered && this.hasPlayerSkill('skill25')) {
        this.skillPlayerHalfShieldTriggered = true
        const gainShield = this.scaleShieldGain('player', Math.round(hero.maxHp * 0.2))
        if (gainShield > 0) {
          hero.shield += gainShield
          EventBus.emit('battle:gain_shield', {
            targetId: hero.id,
            sourceItemId: 'skill25',
            amount: gainShield,
            targetType: 'hero',
            targetSide: hero.side,
            sourceType: 'system',
            sourceSide: 'player',
          })
          this.applyOnShieldGainCharge('player')
          this.applyShieldGainSkillTriggers('player', 'skill25', gainShield, false)
        }
      }

      if (!this.skillPlayerHalfShieldCdTriggered && this.hasPlayerSkill('skill26')) {
        this.skillPlayerHalfShieldCdTriggered = true
      }
      return
    }

    if (!this.skillEnemySelfHalfTriggered && this.hasEnemySkill('skill21')) {
      this.skillEnemySelfHalfTriggered = true
      const heal = Math.max(0, Math.round(hero.maxHp * 0.15))
      const real = Math.max(0, Math.min(hero.maxHp - hero.hp, heal))
      if (real > 0) {
        hero.hp += real
        EventBus.emit('battle:heal', {
          targetId: hero.id,
          sourceItemId: 'skill21',
          amount: real,
          isRegen: false,
          targetType: 'hero',
          targetSide: hero.side,
          sourceType: 'system',
          sourceSide: 'enemy',
        })
      }
    }

    if (!this.skillEnemyHalfShieldTriggered && this.hasEnemySkill('skill25')) {
      this.skillEnemyHalfShieldTriggered = true
      const gainShield = this.scaleShieldGain('enemy', Math.round(hero.maxHp * 0.2))
      if (gainShield > 0) {
        hero.shield += gainShield
        EventBus.emit('battle:gain_shield', {
          targetId: hero.id,
          sourceItemId: 'skill25',
          amount: gainShield,
          targetType: 'hero',
          targetSide: hero.side,
          sourceType: 'system',
          sourceSide: 'enemy',
        })
        this.applyOnShieldGainCharge('enemy')
        this.applyShieldGainSkillTriggers('enemy', 'skill25', gainShield, false)
      }
    }

    if (!this.skillEnemyHalfShieldCdTriggered && this.hasEnemySkill('skill26')) {
      this.skillEnemyHalfShieldCdTriggered = true
    }
  }

  private leftmostDamageItem(side: 'player' | 'enemy'): CombatItemRunner | null {
    const all = this.sortedItemsBySide(side, (it) => this.isDamageBonusEligible(it))
    return all[0] ?? null
  }

  private applyDirectSkillDamage(
    sourceSide: 'player' | 'enemy',
    panel: number,
    sourceSkillId: string,
    sourceType: 'system' | 'item' = 'system',
  ): void {
    const targetHero = sourceSide === 'player' ? this.enemyHero : this.playerHero
    if (panel <= 0 || targetHero.hp <= 0) return
    if (this.isHeroInvincible(targetHero.side)) {
      EventBus.emit('battle:take_damage', {
        targetId: targetHero.id,
        sourceItemId: sourceSkillId,
        amount: panel,
        isCrit: false,
        type: 'normal',
        targetType: 'hero',
        targetSide: targetHero.side,
        sourceType,
        sourceSide,
        baseDamage: panel,
        finalDamage: 0,
      })
      return
    }
    let remaining = panel
    const hpBefore = targetHero.hp
    if (targetHero.shield > 0) {
      const blocked = Math.min(targetHero.shield, remaining)
      targetHero.shield -= blocked
      remaining -= blocked
    }
    if (remaining > 0) {
      targetHero.hp = Math.max(0, targetHero.hp - remaining)
      this.handleHeroHpThresholdTriggers(targetHero.side, hpBefore, targetHero.hp)
    }
    EventBus.emit('battle:take_damage', {
      targetId: targetHero.id,
      sourceItemId: sourceSkillId,
      amount: panel,
      isCrit: false,
      type: 'normal',
      targetType: 'hero',
      targetSide: targetHero.side,
      sourceType,
      sourceSide,
      baseDamage: panel,
      finalDamage: remaining,
    })
    if (remaining > 0) {
      this.applyWanJianGrowthOnAnyDamage(sourceSide)
    }
    if (targetHero.hp === 0) {
      EventBus.emit('battle:unit_die', {
        unitId: targetHero.id,
        side: targetHero.side,
      })
    }
  }

  private applyShieldGainSkillTriggers(side: 'player' | 'enemy', sourceItemId: string, gainedShield = 0, fromShieldItem = false): void {
    if (!this.hasSkill(side, 'skill22') && !this.hasSkill(side, 'skill23') && !this.hasSkill(side, 'skill24') && !this.hasSkill(side, 'skill82')) return

    if (this.hasSkill(side, 'skill22')) {
      const leftmostDamage = this.leftmostDamageItem(side)
      if (leftmostDamage) leftmostDamage.baseStats.damage += 15
    }

    if (this.hasSkill(side, 'skill23')) {
      this.applyDirectSkillDamage(side, 30, 'skill23')
    }

    if (this.hasSkill(side, 'skill24')) {
      const source = this.items.find((it) => it.id === sourceItemId && it.side === side)
      if (source) {
        for (const ally of this.items) {
          if (ally.side !== side || ally.id === source.id) continue
          if (!this.isAdjacentByFootprint(ally, source)) continue
          if (!this.isShieldItem(ally)) continue
          ally.baseStats.shield += 15
        }
      }
    }

    if (this.hasSkill(side, 'skill82') && fromShieldItem && gainedShield > 0) {
      this.applyDirectSkillDamage(side, gainedShield, 'skill82')
    }
  }

  private applySkill33RegenTick(): void {
    const applyOne = (side: 'player' | 'enemy', perTick: number): void => {
      if (!this.hasSkill(side, 'skill33')) return
      if (perTick <= 0) return
      const hero = this.heroOf(side)
      if (hero.hp <= 0) return
      const healed = Math.max(0, Math.min(hero.maxHp - hero.hp, perTick))
      if (healed <= 0) return
      hero.hp += healed
      EventBus.emit('battle:heal', {
        targetId: hero.id,
        sourceItemId: 'skill33',
        amount: healed,
        isRegen: true,
        targetType: 'hero',
        targetSide: hero.side,
        sourceType: 'system',
        sourceSide: side,
      })
    }
    applyOne('player', this.skill33RegenPerTick)
    applyOne('enemy', this.skillEnemy33RegenPerTick)
  }

  private scaleShieldGain(side: 'player' | 'enemy', amount: number): number {
    const base = Math.max(0, Math.round(amount))
    if (base <= 0) return 0
    if (this.hasSkill(side, 'skill39') && this.elapsedMs <= 10000) {
      return Math.max(0, Math.round(base * 2))
    }
    return base
  }

  private applyOnDealDamageSkillTriggers(attacker: CombatItemRunner): void {
    if (this.hasSkill(attacker.side, 'skill58') && this.isDamageBonusEligible(attacker)) {
      attacker.baseStats.damage += 2
    }
    if (this.hasSkill(attacker.side, 'skill57')) {
      attacker.baseStats.cooldownMs = Math.max(
        this.minReducedCdMsFor(attacker),
        Math.round(attacker.baseStats.cooldownMs * 0.98),
      )
    }
  }

  private applyWanJianGrowthOnAnyDamage(sourceSide: 'player' | 'enemy'): void {
    for (const owner of this.items) {
      if (owner.side !== sourceSide) continue
      if (!this.isDamageBonusEligible(owner)) continue
      const def = this.findItemDef(owner.defId)
      const line = this.skillLines(def).find((s) => /造成任意伤害时此物品伤害\+\d+(?:[\/|]\d+)*/.test(s))
      if (!line) continue
      const v = Math.max(0, Math.round(this.tierValueFromLine(line, this.tierIndex(def, owner.tier))))
      if (v > 0) owner.baseStats.damage += v
    }
  }

  private tryDeathMarkExecution(sourceSide: 'player' | 'enemy', targetHero: HeroState): void {
    if (this.deathMarkCheckUsedBySide[sourceSide]) return
    const marker = this.items.find((it) => {
      if (it.side !== sourceSide) return false
      const def = this.findItemDef(it.defId)
      return this.skillLines(def).some((s) => /生命值低于.*直接斩杀/.test(s))
    })
    if (!marker) return
    const def = this.findItemDef(marker.defId)
    const line = this.skillLines(def).find((s) => /生命值低于.*直接斩杀/.test(s))
    if (!line) return
    const pct = Math.max(0, this.tierValueFromLine(line, this.tierIndex(def, marker.tier)))
    if (pct <= 0) return
    if (targetHero.maxHp <= 0 || targetHero.hp <= 0) return
    if (targetHero.hp / targetHero.maxHp > pct / 100) return
    this.deathMarkCheckUsedBySide[sourceSide] = true
    this.enqueueExtraTriggeredUse(marker)
  }

  private toRunner(entity: BattleSnapshotEntity, idPrefix: string): CombatItemRunner {
    const def = this.findItemDef(entity.defId)
    const level = Math.max(1, Math.min(7, Math.round(entity.level ?? 0)))
    const tierStarFromLevel = qualityScoreToTierStar(level)
    const fallbackTierStar: { tier: EnemyTier; star: EnemyStar } = {
      tier: (entity.tier ?? 'Bronze') as EnemyTier,
      star: (entity.tier === 'Bronze' ? 1 : (entity.tierStar === 2 ? 2 : 1)) as EnemyStar,
    }
    const tierStarResolved = entity.level ? tierStarFromLevel : fallbackTierStar
    const tierStar: 1 | 2 = tierStarResolved.star
    const tierRaw = `${tierStarResolved.tier}#${tierStarResolved.star}`
    const snapBase = entity.baseStats
    const tierStats = def ? resolveItemTierBaseStats(def, tierRaw) : null
    const tierIndex = tierIndexFromRaw(def, tierRaw)
    const lines = this.skillLines(def)
    const ammoMax = ammoFromSkillLines(lines, tierIndex)
    const baseMulticast = Math.max(1, Math.round(snapBase?.multicast ?? tierStats?.multicast ?? def?.multicast ?? 1))
    const parsedMulticast = multicastFromSkillLines(lines, tierIndex, baseMulticast)
    const permanentBonus = ('permanentDamageBonus' in entity && typeof entity.permanentDamageBonus === 'number')
      ? Math.max(0, entity.permanentDamageBonus)
      : 0
    return {
      id: `${idPrefix}-${entity.instanceId}`,
      side: 'player',
      defId: entity.defId,
      baseStats: {
        cooldownMs: this.validCooldown(snapBase?.cooldownMs ?? tierStats?.cooldownMs ?? def?.cooldown ?? 0),
        damage: Math.max(0, snapBase?.damage ?? ((tierStats?.damage ?? def?.damage ?? 0) + permanentBonus)),
        heal: Math.max(0, snapBase?.heal ?? tierStats?.heal ?? def?.heal ?? 0),
        shield: Math.max(0, snapBase?.shield ?? tierStats?.shield ?? def?.shield ?? 0),
        burn: Math.max(0, snapBase?.burn ?? tierStats?.burn ?? def?.burn ?? 0),
        poison: Math.max(0, snapBase?.poison ?? tierStats?.poison ?? def?.poison ?? 0),
        regen: Math.max(0, snapBase?.regen ?? tierStats?.regen ?? def?.regen ?? 0),
        crit: Math.max(0, snapBase?.crit ?? tierStats?.crit ?? def?.crit ?? 0),
        multicast: Math.max(1, parsedMulticast),
      },
      runtime: {
        currentChargeMs: 0,
        pendingChargeMs: 0,
        tempDamageBonus: 0,
        damageScale: 1,
        bonusMulticast: 0,
        executeCount: 0,
        ammoMax,
        ammoCurrent: ammoMax,
        modifiers: {
          freezeMs: 0,
          slowMs: 0,
          hasteMs: 0,
        },
      },
      col: entity.col,
      row: entity.row,
      size: entity.size,
      tier: tierRaw,
      tierStar,
    }
  }

  private makeEnemyRunners(snapshot: BattleSnapshotBundle): CombatItemRunner[] {
    const all = getAllItems()
    if (!all.length) return []
    const nonNeutralAll = all.filter((def) => !this.isNeutralItemDef(def))
    if (!nonNeutralAll.length) return []
    const cfg = getConfig()
    const labCfg = cfg.gameplayModeValues?.enemyDraftLab
    const labEnabled = rvBool('enemyDraftEnabled', labCfg?.enabled === true)
    const configuredDefs = this.pickEnemyDefsByDay(nonNeutralAll)
    const seedDefs = configuredDefs.length > 0 ? configuredDefs : nonNeutralAll
    if (seedDefs.length === 0) return []

    const rng = makeSeededRng(this.day * 977 + snapshot.activeColCount * 131 + seedDefs.length * 17)

    if (!labEnabled) {
      const teaching = this.buildEnemyTeachingRunners(snapshot, nonNeutralAll, rng)
      if (teaching && teaching.length > 0) return teaching
    }

    const sameArchetypeBias = Math.max(0, Math.min(1, rv('enemyDraftSameArchetypeBias', labCfg?.sameArchetypeBias ?? 0.85)))
    const targetCount = Math.max(1, Math.min(
      snapshot.activeColCount,
      Math.round(dailyCurveValue(labCfg?.dailyItemCount, this.day, 5)),
    ))
    const baseTargetAvgQuality = Math.max(1, Math.min(7, dailyCurveValue(labCfg?.dailyAvgQuality, this.day, 3)))
    const playerWinStreak = Math.max(0, Math.round(getPlayerWinStreakState().count))
    const playerHp = Math.max(1, Math.round(getLifeState().current))
    const streakIdx = Math.min(9, playerWinStreak)
    const streakBonusByHp: Record<1 | 2 | 3 | 4 | 5, number[]> = {
      5: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25],
      4: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25],
      3: [0, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
      2: [0, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
      1: [-0.25, 0, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75],
    }
    const hpKey: 1 | 2 | 3 | 4 | 5 = playerHp >= 5 ? 5 : playerHp >= 4 ? 4 : playerHp >= 3 ? 3 : playerHp >= 2 ? 2 : 1
    const streakQualityBonus = streakBonusByHp[hpKey][streakIdx] ?? 0
    const targetAvgQuality = Math.max(1, Math.min(7, baseTargetAvgQuality + streakQualityBonus))
    const qualityScores = buildQualityScores(targetCount, targetAvgQuality)

    const byArchetype = new Map<string, ItemDef[]>()
    for (const def of seedDefs) {
      const size = normalizeSize(def.size)
      if (size !== '1x1') continue
      const tag = getPrimaryArchetypeTag(def.tags)
      if (!tag) continue
      const bucket = byArchetype.get(tag) ?? []
      bucket.push(def)
      byArchetype.set(tag, bucket)
    }
    const archetypes = Array.from(byArchetype.keys())
    const preferredArchetype = archetypes.length > 0
      ? archetypes[Math.floor(rng() * archetypes.length)]!
      : ''

    const order = Array.from({ length: snapshot.activeColCount }, (_, i) => i)
      .sort((a, b) => Math.abs(a - (snapshot.activeColCount - 1) / 2) - Math.abs(b - (snapshot.activeColCount - 1) / 2))

    const out: CombatItemRunner[] = []
    let serial = 0
    const poolBase = seedDefs.filter((d) => normalizeSize(d.size) === '1x1')
    for (let i = 0; i < qualityScores.length && i < order.length; i++) {
      const score = qualityScores[i]!
      const desired = qualityScoreToTierStar(score)
      const tierPool = poolBase.filter((def) => parseAvailableTiers(def.available_tiers).includes(desired.tier))
      const sameArchPool = preferredArchetype
        ? tierPool.filter((def) => getPrimaryArchetypeTag(def.tags) === preferredArchetype)
        : []
      const chosenPool = (sameArchPool.length > 0 && rng() < sameArchetypeBias) ? sameArchPool : tierPool
      const picked = chosenPool[Math.floor(rng() * chosenPool.length)] ?? tierPool[Math.floor(rng() * tierPool.length)] ?? poolBase[Math.floor(rng() * poolBase.length)]
      if (!picked) continue
      serial++
      out.push(this.buildEnemyRunner(picked, `E-${this.day}-${serial}-${picked.id}`, order[i]!, 0, '1x1', desired.tier, desired.star))
    }

    if (out.length === 0) {
      const fallback = poolBase[Math.floor(rng() * poolBase.length)] ?? seedDefs[0]
      if (!fallback) return []
      const slot = order[0] ?? 0
      out.push(this.buildEnemyRunner(fallback, `E-fallback-${fallback.id}`, slot, 0, '1x1', 'Bronze', 1))
    }
    return out
  }

  private buildEnemyRunner(
    def: ItemDef,
    id: string,
    col: number,
    row: number,
    size: ItemSizeNorm,
    tier: EnemyTier,
    star: EnemyStar,
  ): CombatItemRunner {
    const tierRaw = tierStarToRaw(tier, star)
    const tierStats = resolveItemTierBaseStats(def, tierRaw)
    const tierIdx = tierIndexFromRaw(def, tierRaw)
    const lines = this.skillLines(def)
    const ammoMax = ammoFromSkillLines(lines, tierIdx)
    const multicast = multicastFromSkillLines(lines, tierIdx, Math.max(1, Math.round(tierStats.multicast)))
    return {
      id,
      side: 'enemy',
      defId: def.id,
      baseStats: {
        cooldownMs: this.validCooldown(tierStats.cooldownMs),
        damage: Math.max(0, tierStats.damage),
        heal: Math.max(0, tierStats.heal),
        shield: Math.max(0, tierStats.shield),
        burn: Math.max(0, tierStats.burn),
        poison: Math.max(0, tierStats.poison),
        regen: Math.max(0, tierStats.regen),
        crit: Math.max(0, tierStats.crit),
        multicast: Math.max(1, multicast),
      },
      runtime: {
        currentChargeMs: 0,
        pendingChargeMs: 0,
        tempDamageBonus: 0,
        damageScale: 1,
        bonusMulticast: 0,
        executeCount: 0,
        ammoMax,
        ammoCurrent: ammoMax,
        modifiers: { freezeMs: 0, slowMs: 0, hasteMs: 0 },
      },
      col,
      row,
      size,
      tier: tierRaw,
      tierStar: star,
    }
  }

  private buildEnemyTeachingRunners(
    snapshot: BattleSnapshotBundle,
    all: ItemDef[],
    rng: () => number,
  ): CombatItemRunner[] | null {
    const rules = getConfig().combatRuntime.enemyTeachingByDay ?? []
    const matched = rules.find((r) => this.day >= r.dayStart && this.day <= r.dayEnd)
    if (!matched || !matched.templates || matched.templates.length === 0) return null

    const sizeWidth = (size: ItemSizeNorm): number => (size === '1x1' ? 1 : size === '2x1' ? 2 : 3)
    const byName = new Map<string, ItemDef>()
    for (const it of all) {
      byName.set(it.id, it)
      byName.set(it.name_cn, it)
      byName.set(it.name_en, it)
    }

    const template = matched.templates[Math.floor(rng() * matched.templates.length)]
    if (!template) return null

    const occ = Array.from({ length: snapshot.activeColCount }, () => false)
    const out: CombatItemRunner[] = []
    let serial = 0

    for (const p of template.placements) {
      const def = byName.get(p.itemName)
      if (!def) continue
      const size = normalizeSize(def.size)
      const w = sizeWidth(size)
      if (p.col < 0 || p.col + w > snapshot.activeColCount) continue
      let blocked = false
      for (let k = 0; k < w; k++) if (occ[p.col + k]) blocked = true
      if (blocked) continue

      const available = parseAvailableTiers(def.available_tiers)
      const desiredTier = (p.tier ?? 'Bronze') as EnemyTier
      const tier = (available.includes(desiredTier) ? desiredTier : (available[0] ?? 'Bronze')) as EnemyTier
      const star = (tier === 'Bronze' ? 1 : (p.star === 2 ? 2 : 1)) as EnemyStar

      for (let k = 0; k < w; k++) occ[p.col + k] = true
      serial++
      out.push(this.buildEnemyRunner(def, `E-template-${this.day}-${serial}-${def.id}`, p.col, 0, size, tier, star))
    }

    return out.length > 0 ? out : null
  }

  private pickEnemyDefsByDay(all: ItemDef[]): ItemDef[] {
    const rules = getConfig().combatRuntime.enemyByDay ?? []
    const matched = rules.find((r) => this.day >= r.dayStart && this.day <= r.dayEnd)
    if (!matched || !matched.itemNames.length) return []
    const byName = new Map<string, ItemDef>()
    for (const it of all) {
      byName.set(it.name_cn, it)
      byName.set(it.name_en, it)
      byName.set(it.id, it)
    }
    const out: ItemDef[] = []
    for (const key of matched.itemNames) {
      const hit = byName.get(key)
      if (hit && !this.isNeutralItemDef(hit)) out.push(hit)
    }
    return out
  }

  private isNeutralItemDef(def: ItemDef): boolean {
    const tag = getPrimaryArchetypeTag(def.tags)
    return tag === '中立' || tag.toLowerCase() === 'neutral'
  }

  private validCooldown(cd: number): number {
    if (!Number.isFinite(cd)) return FALLBACK_CD_MS
    if (cd <= 0) return 0
    return Math.round(cd)
  }

  private findItemDef(defId: string): ItemDef | null {
    return getAllItems().find((it) => it.id === defId) ?? null
  }

  private skillLines(def: ItemDef | null): string[] {
    if (!def) return []
    return (def.skills ?? []).map((s) => s.cn?.trim() ?? '').filter(Boolean)
  }

  private tierIndex(def: ItemDef | null, tier: string): number {
    return tierIndexFromRaw(def, tier)
  }

  private tierValueFromLine(line: string, tierIndex: number): number {
    const m = line.match(/([+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*)/)
    if (!m?.[1]) return 0
    return pickTierSeriesValue(m[1], tierIndex)
  }

  private isAdjacentById(aId: string, bId: string): boolean {
    const a = this.items.find((it) => it.id === aId)
    const b = this.items.find((it) => it.id === bId)
    if (!a || !b) return false
    return this.isAdjacentByFootprint(a, b)
  }

  private applyHasteToTargetItems(source: CombatItemRunner, targets: CombatItemRunner[], durationMs: number): void {
    for (const target of targets) {
      target.runtime.modifiers.hasteMs = Math.max(target.runtime.modifiers.hasteMs, durationMs)
      EventBus.emit('battle:status_apply', {
        targetId: target.id,
        sourceItemId: source.id,
        status: 'haste',
        amount: durationMs,
        targetType: 'item',
        targetSide: target.side,
        sourceType: 'item',
        sourceSide: source.side,
      })
    }
  }

  private applyAdjacentUseHasteTriggers(fired: CombatItemRunner): void {
    for (const owner of this.items) {
      if (owner.side !== fired.side || owner.id === fired.id) continue
      if (!this.isAdjacentByFootprint(owner, fired)) continue
      const def = this.findItemDef(owner.defId)
      if (!def) continue
      const line = this.skillLines(def).find((s) => /相邻物品使用时.*加速另一侧的物品/.test(s))
      if (!line) continue
      const sec = this.tierValueFromLine(line, this.tierIndex(def, owner.tier))
      if (sec <= 0) continue

      const ownerStart = owner.col
      const ownerEnd = owner.col + this.itemWidth(owner.size) - 1
      const firedCenter = fired.col + this.itemWidth(fired.size) / 2
      const ownerCenter = owner.col + this.itemWidth(owner.size) / 2
      const wantRight = firedCenter < ownerCenter

      const target = this.items
        .filter((it) => it.side === owner.side && it.id !== owner.id && it.id !== fired.id)
        .find((it) => {
          const s = it.col
          const e = it.col + this.itemWidth(it.size) - 1
          return wantRight ? s === ownerEnd + 1 : e === ownerStart - 1
        })
      if (target) this.applyHasteToTargetItems(owner, [target], Math.round(sec * 1000))
    }
  }

  private applyAdjacentUseBurnTriggers(fired: CombatItemRunner): void {
    const targetHero = fired.side === 'player' ? this.enemyHero : this.playerHero
    if (targetHero.hp <= 0) return
    for (const owner of this.items) {
      if (owner.side !== fired.side || owner.id === fired.id) continue
      if (!this.isAdjacentByFootprint(owner, fired)) continue
      const def = this.findItemDef(owner.defId)
      if (!def) continue
      const line = this.skillLines(def).find((s) => /使用相邻物品时.*造成\d+(?:\/\d+)*灼烧/.test(s))
      if (!line) continue
      const burn = Math.round(this.tierValueFromLine(line, this.tierIndex(def, owner.tier)))
      if (burn <= 0) continue
      targetHero.burn += burn
      EventBus.emit('battle:status_apply', {
        targetId: targetHero.id,
        sourceItemId: owner.id,
        status: 'burn',
        amount: burn,
        targetType: 'hero',
        targetSide: targetHero.side,
        sourceType: 'item',
        sourceSide: owner.side,
      })
    }
  }

  private applyAdjacentUseExtraFireTriggers(fired: CombatItemRunner): void {
    for (const owner of this.items) {
      if (owner.side !== fired.side || owner.id === fired.id) continue
      if (!this.isAdjacentByFootprint(owner, fired)) continue
      const def = this.findItemDef(owner.defId)
      if (!def) continue
      if (!this.skillLines(def).some((s) => /使用相邻物品时(?:额外|立即)使用此物品/.test(s))) continue
      this.enqueueExtraTriggeredUse(owner)
    }
  }

  private applyBurnUseSlowTriggers(fired: CombatItemRunner): void {
    if (fired.baseStats.burn <= 0) return
    for (const owner of this.items) {
      if (owner.side !== fired.side || owner.id === fired.id) continue
      const def = this.findItemDef(owner.defId)
      if (!def) continue
      const line = this.skillLines(def).find((s) => /使用灼烧物品时.*减速敌方\d+件敌方物品\d+(?:\/\d+)*秒/.test(s))
      if (!line) continue
      const sec = this.tierValueFromLine(line, this.tierIndex(def, owner.tier))
      if (sec <= 0) continue
      const targets = this.pickControlTargets({
        side: fired.side === 'player' ? 'enemy' : 'player',
        count: 1,
        mode: 'leftmost',
        source: owner,
      })
      for (const target of targets) {
        const durationMs = Math.max(1, Math.round(sec * 1000))
        target.runtime.modifiers.slowMs = Math.max(target.runtime.modifiers.slowMs, durationMs)
        EventBus.emit('battle:status_apply', {
          targetId: target.id,
          sourceItemId: owner.id,
          status: 'slow',
          amount: durationMs,
          targetType: 'item',
          targetSide: target.side,
          sourceType: 'item',
          sourceSide: owner.side,
        })
      }
    }
  }

  private applyBattleStartPassiveGrowths(): void {
    for (const owner of this.items) {
      const def = this.findItemDef(owner.defId)
      if (!def) continue
      const lines = this.skillLines(def)
      const tIdx = this.tierIndex(def, owner.tier)

      const shieldLine = lines.find((s) => /护盾物品护盾值\+\d+(?:\/\d+)*/.test(s))
      if (shieldLine) {
        const v = Math.round(this.tierValueFromLine(shieldLine, tIdx))
        if (v > 0) {
          for (const ally of this.items) {
            if (ally.side !== owner.side) continue
            if (ally.baseStats.shield <= 0) continue
            ally.baseStats.shield += v
          }
        }
      }

      const burnLine = lines.find((s) => /灼烧物品\+\d+(?:\/\d+)*灼烧/.test(s))
      if (burnLine) {
        const v = Math.round(this.tierValueFromLine(burnLine, tIdx))
        if (v > 0) {
          for (const ally of this.items) {
            if (ally.side !== owner.side) continue
            if (ally.baseStats.burn <= 0) continue
            ally.baseStats.burn += v
          }
        }
      }

      const adjacentPoisonLine = lines.find((s) => /相邻剧毒物品\+\d+(?:\/\d+)*剧毒/.test(s))
      if (adjacentPoisonLine) {
        const v = Math.round(this.tierValueFromLine(adjacentPoisonLine, tIdx))
        if (v > 0) {
          for (const ally of this.items) {
            if (ally.side !== owner.side || ally.id === owner.id) continue
            if (ally.baseStats.poison <= 0) continue
            if (!this.isAdjacentByFootprint(ally, owner)) continue
            ally.baseStats.poison += v
          }
        }
      }

      const adjacentWeaponDamageLine = lines.find((s) => /相邻的?武器伤害\+\d+(?:\/\d+)*/.test(s))
      if (adjacentWeaponDamageLine) {
        const v = Math.round(this.tierValueFromLine(adjacentWeaponDamageLine, tIdx))
        if (v > 0) {
          for (const ally of this.items) {
            if (ally.side !== owner.side || ally.id === owner.id) continue
            if (!this.isDamageBonusEligible(ally)) continue
            if (!this.isAdjacentByFootprint(ally, owner)) continue
            ally.baseStats.damage += v
          }
        }
      }

      const allWeaponDamageLine = lines.find(
        (s) => /(?:武器|物品)伤害\+\d+(?:[\/|]\d+)*/.test(s)
          && !/相邻/.test(s)
          && !/所有刺客物品/.test(s)
          && !/其他武器攻击时该(?:武器|物品)伤害\+/.test(s),
      )
      if (allWeaponDamageLine) {
        const v = Math.round(this.tierValueFromLine(allWeaponDamageLine, tIdx))
        if (v > 0) {
          for (const ally of this.items) {
            if (ally.side !== owner.side) continue
            if (!this.isDamageBonusEligible(ally)) continue
            ally.baseStats.damage += v
          }
        }
      }

      const allAssassinDamageLine = lines.find((s) => /所有刺客物品伤害\+\d+(?:[\/|]\d+)*/.test(s))
      if (allAssassinDamageLine) {
        const v = Math.round(this.tierValueFromLine(allAssassinDamageLine, tIdx))
        if (v > 0) {
          for (const ally of this.items) {
            if (ally.side !== owner.side) continue
            if (!this.isDamageBonusEligible(ally)) continue
            const allyDef = this.findItemDef(ally.defId)
            if (this.itemArchetype(allyDef) !== '刺客') continue
            ally.baseStats.damage += v
          }
        }
      }

      const scoutLine = lines.find((s) => /上阵区每有1件其他刺客物品[，,]?连发次数\+1/.test(s))
      if (scoutLine) {
        const n = this.items.filter((ally) => {
          if (ally.side !== owner.side || ally.id === owner.id) return false
          const allyDef = this.findItemDef(ally.defId)
          return this.itemArchetype(allyDef) === '刺客'
        }).length
        if (n > 0) owner.baseStats.multicast += n
      }

      const adjacentAmmoCapLine = lines.find((s) => /相邻物品\+\d+(?:[\/|]\+?\d+)*最大弹药量/.test(s))
      if (adjacentAmmoCapLine) {
        const v = Math.round(this.tierValueFromLine(adjacentAmmoCapLine, tIdx))
        if (v > 0) {
          for (const ally of this.items) {
            if (ally.side !== owner.side || ally.id === owner.id) continue
            if (!this.isAdjacentByFootprint(ally, owner)) continue
            if (ally.runtime.ammoMax <= 0) continue
            const beforeCurrent = ally.runtime.ammoCurrent
            const beforeMax = ally.runtime.ammoMax
            ally.runtime.ammoMax += v
            if (beforeCurrent < beforeMax) {
              ally.runtime.ammoCurrent = Math.min(ally.runtime.ammoMax, beforeCurrent + v)
              const gained = Math.max(0, ally.runtime.ammoCurrent - beforeCurrent)
              if (gained > 0) this.applyOnAmmoRefilledDamageGrowth(ally, gained)
            }
          }
        }
      }

      const adjacentAmmoCapLine2 = lines.find((s) => /相邻弹药物品最大弹药量\+\d+(?:[\/|]\d+)*/.test(s))
      if (adjacentAmmoCapLine2) {
        const v = Math.round(this.tierValueFromLine(adjacentAmmoCapLine2, tIdx))
        if (v > 0) {
          for (const ally of this.items) {
            if (ally.side !== owner.side || ally.id === owner.id) continue
            if (!this.isAdjacentByFootprint(ally, owner)) continue
            if (ally.runtime.ammoMax <= 0) continue
            ally.runtime.ammoMax += v
            ally.runtime.ammoCurrent = Math.min(ally.runtime.ammoMax, ally.runtime.ammoCurrent + v)
          }
        }
      }

      const scopeLine = lines.find((s) => /相邻伤害物品伤害\+\d+(?:[\/|]\d+)*%/.test(s))
      if (scopeLine) {
        const pct = Math.max(0, this.tierValueFromLine(scopeLine, tIdx)) / 100
        if (pct > 0) {
          for (const ally of this.items) {
            if (ally.side !== owner.side || ally.id === owner.id) continue
            if (!this.isAdjacentByFootprint(ally, owner)) continue
            if (!this.isDamageBonusEligible(ally)) continue
            ally.runtime.damageScale *= (1 + pct)
          }
        }
      }

      const phantomLine = lines.find((s) => /弹药物品伤害\+\d+(?:[\/|]\d+)*/.test(s) && /弹药消耗翻倍/.test(s))
      if (phantomLine) {
        const v = Math.round(this.tierValueFromLine(phantomLine, tIdx))
        if (v > 0) {
          for (const ally of this.items) {
            if (ally.side !== owner.side) continue
            if (!this.isAmmoItem(ally)) continue
            if (!this.isDamageBonusEligible(ally)) continue
            ally.baseStats.damage += v
          }
        }
      }

      const hpBoostLine = lines.find((s) => /最大生命值\+\d+(?:[\/|]\d+)*%/.test(s))
      if (hpBoostLine) {
        const pct = Math.max(0, this.tierValueFromLine(hpBoostLine, tIdx)) / 100
        if (pct > 0) {
          const hero = this.heroOf(owner.side)
          hero.maxHp = Math.max(1, Math.round(hero.maxHp * (1 + pct)))
          hero.hp = Math.max(1, Math.round(hero.hp * (1 + pct)))
        }
      }

      const rightMulticastLine = lines.find((s) => /右侧的(?:攻击|伤害)物品连发次数\+\d+(?:[\/|]\d+)*/.test(s))
      if (rightMulticastLine) {
        const v = Math.max(0, Math.round(this.tierValueFromLine(rightMulticastLine, tIdx)))
        if (v > 0) {
          const ownerRightEdge = owner.col + this.itemWidth(owner.size) - 1
          const rightTarget = this.items
            .filter((ally) => ally.side === owner.side && ally.id !== owner.id)
            .find((ally) => ally.col === ownerRightEdge + 1 && this.isDamageBonusEligible(ally))
          if (rightTarget) rightTarget.baseStats.multicast += v
        }
      }
    }
  }

  private chargeItemByMs(owner: CombatItemRunner, gainMs: number): void {
    const gain = Math.max(0, Math.round(gainMs))
    if (gain <= 0) return
    const lastDue = this.lastQueuedFireTickByItem.get(owner.id)
    const hasQueuedFire = Number.isFinite(lastDue) && (lastDue as number) >= this.tickIndex
    if (hasQueuedFire) {
      owner.runtime.pendingChargeMs += gain
      return
    }

    const before = owner.runtime.currentChargeMs
    const ownerCooldown = this.effectiveCooldownMs(owner)
    owner.runtime.currentChargeMs = Math.min(ownerCooldown, owner.runtime.currentChargeMs + gain)
    const consumed = Math.max(0, owner.runtime.currentChargeMs - before)
    const overflow = Math.max(0, gain - consumed)
    if (overflow > 0) owner.runtime.pendingChargeMs += overflow

    const needsAmmo = owner.runtime.ammoMax > 0
    const hasAmmo = owner.runtime.ammoCurrent > 0
    if (owner.runtime.currentChargeMs >= ownerCooldown && (!needsAmmo || hasAmmo)) {
      const baseDue = this.tickIndex + 1
      const prevDue = this.lastQueuedFireTickByItem.get(owner.id) ?? (this.tickIndex - 1)
      const dueTick = Math.max(baseDue, prevDue + 1)
      this.pendingItemFires.push({ dueTick, sourceItemId: owner.id })
      this.lastQueuedFireTickByItem.set(owner.id, dueTick)
    }
  }

  private scheduleRepeatedChargePulses(
    source: CombatItemRunner,
    target: CombatItemRunner,
    times: number,
    gainMs: number,
    intervalTick: number,
  ): void {
    const count = Math.max(1, Math.round(times))
    const step = Math.max(1, Math.round(intervalTick))
    const gain = Math.max(1, Math.round(gainMs))
    for (let i = 0; i < count; i++) {
      this.pendingChargePulses.push({
        dueTick: this.tickIndex + i * step,
        sourceItemId: source.id,
        targetItemId: target.id,
        gainMs: gain,
      })
    }
  }

  private enqueueExtraTriggeredUse(source: CombatItemRunner): void {
    const nextTick = this.tickIndex + 1
    this.pendingItemFires.push({
      dueTick: nextTick,
      sourceItemId: source.id,
      extraTriggered: true,
    })
  }

  private removeItemFromBattle(itemId: string): void {
    const removed = this.items.find((it) => it.id === itemId)
    this.items = this.items.filter((it) => it.id !== itemId)
    this.pendingItemFires = this.pendingItemFires.filter((f) => f.sourceItemId !== itemId)
    this.pendingChargePulses = this.pendingChargePulses.filter((p) => p.sourceItemId !== itemId && p.targetItemId !== itemId)
    this.pendingAmmoRefills = this.pendingAmmoRefills.filter((p) => p.sourceItemId !== itemId && p.targetItemId !== itemId)
    this.pendingHits = this.pendingHits.filter((h) => h.sourceItemId !== itemId)
    this.lastQueuedFireTickByItem.delete(itemId)
    if (removed) {
      EventBus.emit('battle:unit_die', {
        unitId: itemId,
        side: removed.side,
      })
    }
  }

  private applyOnAmmoRefilledDamageGrowth(target: CombatItemRunner, gainedAmmo: number): void {
    const gained = Math.max(0, Math.round(gainedAmmo))
    if (gained <= 0) return
    const def = this.findItemDef(target.defId)
    if (!def) return
    if (!this.isDamageBonusEligible(target)) return
    const line = this.skillLines(def).find((s) => /补充弹药时伤害\+\d+(?:[\/|]\d+)*/.test(s))
    if (!line) return
    const perAmmo = Math.max(0, Math.round(this.tierValueFromLine(line, this.tierIndex(def, target.tier))))
    if (perAmmo <= 0) return
    target.baseStats.damage += perAmmo * gained
  }

  private refillAmmoAndTriggerGrowth(target: CombatItemRunner, gainAmmo: number): number {
    const gain = Math.max(0, Math.round(gainAmmo))
    if (gain <= 0) return 0
    if (target.runtime.ammoMax <= 0) return 0
    const beforeCurrent = target.runtime.ammoCurrent
    const beforeMax = target.runtime.ammoMax
    if (beforeCurrent >= beforeMax) return 0
    target.runtime.ammoCurrent = Math.min(beforeMax, beforeCurrent + gain)
    const actualGained = Math.max(0, target.runtime.ammoCurrent - beforeCurrent)
    if (actualGained > 0) this.applyOnAmmoRefilledDamageGrowth(target, actualGained)
    return actualGained
  }

  private applyOnShieldGainCharge(side: 'player' | 'enemy'): void {
    for (const owner of this.items) {
      if (owner.side !== side) continue
      const def = this.findItemDef(owner.defId)
      if (!def) continue
      const line = this.skillLines(def).find((s) => /获得护盾时.*充能\d+(?:\/\d+)*秒/.test(s))
      if (!line) continue
      const gainMs = Math.max(0, Math.round(this.tierValueFromLine(line, this.tierIndex(def, owner.tier)) * 1000))
      if (gainMs <= 0) continue

      this.debugShieldChargeLog('on_shield_gain_detected', {
        tick: this.tickIndex,
        itemId: owner.id,
        defId: owner.defId,
        side: owner.side,
        gainMs,
        currentChargeMs: owner.runtime.currentChargeMs,
        pendingChargeMs: owner.runtime.pendingChargeMs,
        cooldownMs: this.effectiveCooldownMs(owner),
      })

      this.chargeItemByMs(owner, gainMs)
    }
  }

  private applyPendingChargeToFreshCycle(owner: CombatItemRunner): void {
    if (owner.runtime.pendingChargeMs <= 0) return
    const gain = owner.runtime.pendingChargeMs
    owner.runtime.pendingChargeMs = 0
    const ownerCooldown = this.effectiveCooldownMs(owner)
    owner.runtime.currentChargeMs = Math.min(ownerCooldown, owner.runtime.currentChargeMs + gain)
    this.debugShieldChargeLog('apply_pending_to_fresh_cycle', {
      tick: this.tickIndex,
      itemId: owner.id,
      gain,
      currentChargeMs: owner.runtime.currentChargeMs,
      cooldownMs: ownerCooldown,
    })

    const needsAmmo = owner.runtime.ammoMax > 0
    const hasAmmo = owner.runtime.ammoCurrent > 0
    if (owner.runtime.currentChargeMs >= ownerCooldown && (!needsAmmo || hasAmmo)) {
      const baseDue = this.tickIndex + 1
      const lastDue = this.lastQueuedFireTickByItem.get(owner.id) ?? (this.tickIndex - 1)
      const dueTick = Math.max(baseDue, lastDue + 1)
      this.pendingItemFires.push({ dueTick, sourceItemId: owner.id })
      this.lastQueuedFireTickByItem.set(owner.id, dueTick)
      this.debugShieldChargeLog('queue_from_pending_charge', {
        tick: this.tickIndex,
        itemId: owner.id,
        dueTick,
      })
    }
  }

  private enqueueOneAttackFrom(source: CombatItemRunner): void {
    const baseDamage = this.scaledDamage(source, source.baseStats.damage + this.runtimeGlobalDamageBonus(source))
    const damage = this.scaledDamage(source, source.baseStats.damage + source.runtime.tempDamageBonus + this.runtimeGlobalDamageBonus(source))
    if (damage <= 0) return
    this.pendingHits.push({
      dueTick: this.tickIndex,
      side: source.side,
      sourceItemId: source.id,
      defId: source.defId,
      baseDamage,
      damage,
      attackerDamageAtQueue: this.scaledDamage(source, source.baseStats.damage + source.runtime.tempDamageBonus + this.runtimeGlobalDamageBonus(source)),
      crit: source.baseStats.crit,
    })
  }

  private applyOnWeaponAttackTriggers(attacker: CombatItemRunner): void {
    if (attacker.baseStats.damage <= 0) return
    for (const owner of this.items) {
      if (owner.side !== attacker.side || owner.id === attacker.id) continue
      const def = this.findItemDef(owner.defId)
      if (!def) continue
      const lines = this.skillLines(def)
      const tIdx = this.tierIndex(def, owner.tier)

      const allWeaponBuffLine = lines.find((s) => /相邻的?武器攻击时.*所有武器伤害\+\d+(?:\/\d+)*/.test(s))
      if (allWeaponBuffLine && this.isAdjacentByFootprint(owner, attacker)) {
        const v = Math.round(this.tierValueFromLine(allWeaponBuffLine, tIdx))
        if (v > 0) {
          for (const ally of this.items) {
            if (ally.side !== owner.side || !this.isDamageBonusEligible(ally)) continue
            ally.baseStats.damage += v
          }
        }
      }

      const selfGrowLine = lines.find((s) => /其他武器攻击时该武器伤害\+\d+(?:\/\d+)*/.test(s))
      if (selfGrowLine) {
        const v = Math.round(this.tierValueFromLine(selfGrowLine, tIdx))
        if (v > 0 && this.isDamageBonusEligible(owner)) owner.runtime.tempDamageBonus += v
      }

      const extraFireLine = lines.find((s) => /相邻武器攻击时额外触发此武器攻击/.test(s))
      if (extraFireLine && this.isAdjacentByFootprint(owner, attacker)) {
        this.enqueueOneAttackFrom(owner)
      }

      const ammoTriggerLine = lines.find((s) => /使用(?:其他)?弹药物品时.*(?:攻击|连发)次数(?:\+[\d|/]+|增加)/.test(s))
      if (ammoTriggerLine && attacker.runtime.ammoMax > 0) {
        const parsed = Math.round(this.tierValueFromLine(ammoTriggerLine, tIdx))
        const v = Math.max(1, Math.abs(parsed || 1))
        owner.runtime.bonusMulticast += v
      }
    }
  }

  private applyFreezeTriggeredAdjacentAttackBuff(source: CombatItemRunner): void {
    const def = this.findItemDef(source.defId)
    if (!def) return
    const line = this.skillLines(def).find((s) => /冻结敌方时.*相邻攻击物品\+\d+(?:\/\d+)*伤害/.test(s))
    if (!line) return
    const v = Math.round(this.tierValueFromLine(line, this.tierIndex(def, source.tier)))
    if (v <= 0) return
    for (const ally of this.items) {
      if (ally.side !== source.side || ally.id === source.id) continue
      if (!this.isDamageBonusEligible(ally)) continue
      if (!this.isAdjacentByFootprint(ally, source)) continue
      ally.runtime.tempDamageBonus += v
    }
  }

  private applyAdjacentAttackDamageGrowth(attacker: CombatItemRunner): void {
    for (const owner of this.items) {
      if (owner.side !== attacker.side || owner.id === attacker.id) continue
      if (!this.isAdjacentByFootprint(owner, attacker)) continue
      const def = this.findItemDef(owner.defId)
      if (!def) continue
      const line = this.skillLines(def).find((s) => /相邻物品攻击造成伤害时.*该物品\+\d+(?:\/\d+)*伤害/.test(s))
      if (!line) continue
      const v = Math.round(this.tierValueFromLine(line, this.tierIndex(def, owner.tier)))
      if (v > 0 && this.isDamageBonusEligible(owner)) owner.runtime.tempDamageBonus += v
    }
  }

  private shieldGainBonusForItem(source: CombatItemRunner): number {
    if (source.baseStats.shield <= 0) return 0
    let bonus = 0
    for (const owner of this.items) {
      if (owner.side !== source.side || owner.id === source.id) continue
      if (!this.isAdjacentByFootprint(owner, source)) continue
      const def = this.findItemDef(owner.defId)
      if (!def) continue
      const line = this.skillLines(def).find((s) =>
        /相邻(?:的)?护盾物品(?:护盾)?\+\d+(?:\/\d+)*/.test(s)
        && !/每次使用后|使用后/.test(s),
      )
      if (!line) continue
      bonus += Math.round(this.tierValueFromLine(line, this.tierIndex(def, owner.tier)))
    }
    return Math.max(0, bonus)
  }

  private applyReviveIfPossible(side: 'player' | 'enemy'): boolean {
    const hero = side === 'player' ? this.playerHero : this.enemyHero
    if (hero.hp > 0) return false
    if (this.hasSkill(side, 'skill47') && !this.skill47ReviveTriggeredBySide[side]) {
      this.skill47ReviveTriggeredBySide[side] = true
      hero.hp = Math.max(1, Math.round(hero.maxHp * 0.5))
      EventBus.emit('battle:heal', {
        targetId: hero.id,
        sourceItemId: 'skill47',
        amount: hero.hp,
        isRegen: false,
        targetType: 'hero',
        targetSide: hero.side,
        sourceType: 'system',
        sourceSide: side,
      })
      return true
    }
    const candidates = this.items.filter((it) => it.side === side && !it.reviveUsed)
    for (const item of candidates) {
      const def = this.findItemDef(item.defId)
      if (!def) continue
      const line = this.skillLines(def).find((s) => /首次被击败时复活并恢复\d+(?:\/\d+)*生命值/.test(s))
      if (!line) continue
      const heal = Math.round(this.tierValueFromLine(line, this.tierIndex(def, item.tier)))
      if (heal <= 0) continue
      item.reviveUsed = true
      hero.hp = Math.min(hero.maxHp, heal)
      EventBus.emit('battle:heal', {
        targetId: hero.id,
        sourceItemId: item.id,
        amount: hero.hp,
        isRegen: false,
        targetType: 'hero',
        targetSide: hero.side,
        sourceType: 'item',
        sourceSide: side,
      })
      return true
    }
    return false
  }

  private stepOneTick(tickMs: number): void {
    this.tickIndex += 1
    this.heroInvincibleMsBySide.player = Math.max(0, this.heroInvincibleMsBySide.player - tickMs)
    this.heroInvincibleMsBySide.enemy = Math.max(0, this.heroInvincibleMsBySide.enemy - tickMs)
    this.resolveQueuedItemFiresForCurrentTick()
    this.resolveQueuedChargePulsesForCurrentTick()
    this.resolveQueuedAmmoRefillsForCurrentTick()
    const queue: CombatItemRunner[] = []
    for (const item of this.items) {
      if (item.baseStats.cooldownMs <= 0) continue
      const freezeBefore = item.runtime.modifiers.freezeMs
      const slowBefore = item.runtime.modifiers.slowMs
      const hasteBefore = item.runtime.modifiers.hasteMs
      if (item.runtime.modifiers.freezeMs > 0) {
        item.runtime.modifiers.freezeMs = Math.max(0, item.runtime.modifiers.freezeMs - tickMs)
        if (freezeBefore > 0 && item.runtime.modifiers.freezeMs === 0) {
          EventBus.emit('battle:status_remove', {
            targetId: item.id,
            status: 'freeze',
            targetType: 'item',
            targetSide: item.side,
          })
        }
      }
      if (item.runtime.modifiers.slowMs > 0) {
        item.runtime.modifiers.slowMs = Math.max(0, item.runtime.modifiers.slowMs - tickMs)
        if (slowBefore > 0 && item.runtime.modifiers.slowMs === 0) {
          EventBus.emit('battle:status_remove', {
            targetId: item.id,
            status: 'slow',
            targetType: 'item',
            targetSide: item.side,
          })
        }
      }
      if (item.runtime.modifiers.hasteMs > 0) {
        item.runtime.modifiers.hasteMs = Math.max(0, item.runtime.modifiers.hasteMs - tickMs)
        if (hasteBefore > 0 && item.runtime.modifiers.hasteMs === 0) {
          EventBus.emit('battle:status_remove', {
            targetId: item.id,
            status: 'haste',
            targetType: 'item',
            targetSide: item.side,
          })
        }
      }

      if (item.runtime.modifiers.freezeMs > 0) continue

      const cr = getConfig().combatRuntime
      const slowFactor = Math.max(0, Math.min(0.95, cr.cardSlowFactor ?? 0.4))
      const hasteFactor = Math.max(0, cr.cardHasteFactor ?? 0.4)
      let gain = tickMs
      if (item.runtime.modifiers.slowMs > 0) gain *= Math.max(0.05, 1 - slowFactor)
      if (item.runtime.modifiers.hasteMs > 0) gain *= 1 + hasteFactor

      const effectiveCooldown = this.effectiveCooldownMs(item)
      item.runtime.currentChargeMs += gain
      if (item.runtime.currentChargeMs >= effectiveCooldown) {
        const needsAmmo = item.runtime.ammoMax > 0
        const hasAmmo = item.runtime.ammoCurrent > 0
        if (needsAmmo && !hasAmmo) {
          // 弹药武器无弹时：停在“已充能完成”状态，等待补弹后立刻可发射
          item.runtime.currentChargeMs = effectiveCooldown
        } else {
          item.runtime.currentChargeMs = 0
          item.runtime.executeCount += 1
          this.applyPendingChargeToFreshCycle(item)
          queue.push(item)
        }
      }
    }

    const playerQueue = queue.filter((q) => q.side === 'player')
    const enemyQueue = queue.filter((q) => q.side === 'enemy')
    for (const q of playerQueue) this.resolveFire(q)
    for (const q of enemyQueue) this.resolveFire(q)

    this.processStatusPeriodicByTick()
    this.resolvePendingHitsForCurrentTick()
    this.tryDeathMarkExecution('player', this.enemyHero)
    this.tryDeathMarkExecution('enemy', this.playerHero)
    this.clampCombatCaps()
  }

  private resolveQueuedChargePulsesForCurrentTick(): void {
    if (!this.pendingChargePulses.length) return
    const due = this.pendingChargePulses.filter((p) => p.dueTick <= this.tickIndex)
    this.pendingChargePulses = this.pendingChargePulses.filter((p) => p.dueTick > this.tickIndex)
    for (const one of due) {
      const target = this.items.find((it) => it.id === one.targetItemId)
      if (!target) continue
      this.chargeItemByMs(target, one.gainMs)
    }
  }

  private resolveQueuedAmmoRefillsForCurrentTick(): void {
    if (!this.pendingAmmoRefills.length) return
    const due = this.pendingAmmoRefills.filter((p) => p.dueTick <= this.tickIndex)
    this.pendingAmmoRefills = this.pendingAmmoRefills.filter((p) => p.dueTick > this.tickIndex)
    for (const one of due) {
      const target = this.items.find((it) => it.id === one.targetItemId)
      if (!target) continue
      this.refillAmmoAndTriggerGrowth(target, one.gainAmmo)
      if (one.chargeMs > 0) this.chargeItemByMs(target, one.chargeMs)
    }
  }

  private resolveQueuedItemFiresForCurrentTick(): void {
    if (!this.pendingItemFires.length) return
    const due = this.pendingItemFires.filter((f) => f.dueTick <= this.tickIndex)
    this.pendingItemFires = this.pendingItemFires.filter((f) => f.dueTick > this.tickIndex)
    for (const one of due) {
      const owner = this.items.find((it) => it.id === one.sourceItemId)
      if (!owner) continue
      this.debugShieldChargeLog('dequeue_fire', {
        tick: this.tickIndex,
        itemId: one.sourceItemId,
        dueTick: one.dueTick,
      })
      if (owner.runtime.modifiers.freezeMs > 0) {
        const nextTick = this.tickIndex + 1
        this.pendingItemFires.push({ dueTick: nextTick, sourceItemId: owner.id })
        this.lastQueuedFireTickByItem.set(owner.id, nextTick)
        this.debugShieldChargeLog('dequeue_frozen_requeue', {
          tick: this.tickIndex,
          itemId: owner.id,
          nextTick,
        })
        continue
      }
      const needsAmmo = owner.runtime.ammoMax > 0
      const hasAmmo = owner.runtime.ammoCurrent > 0
      if (needsAmmo && !hasAmmo) continue
      owner.runtime.currentChargeMs = 0
      owner.runtime.executeCount += 1
      this.applyPendingChargeToFreshCycle(owner)
      this.debugShieldChargeLog('dequeue_fire_resolve', {
        tick: this.tickIndex,
        itemId: owner.id,
        executeCount: owner.runtime.executeCount,
      })
      this.resolveFire(owner, one.extraTriggered === true)
    }
  }

  private resolveFire(item: CombatItemRunner, fromExtraTrigger = false): void {
    const sourceHero = item.side === 'player' ? this.playerHero : this.enemyHero
    const targetHero = item.side === 'player' ? this.enemyHero : this.playerHero
    const def = this.findItemDef(item.defId)
    const lines = this.skillLines(def)
    const tIdx = this.tierIndex(def, item.tier)
    const sourceArch = this.itemArchetype(def)
    const isAllAmmoShot = lines.some((s) => /(?:一次)?打出所有弹药/.test(s))
    const emptyAmmoBurstLine = lines.find((s) => /弹药耗尽时造成\d+(?:[\/|]\d+)*倍伤害/.test(s))
    const emptyAmmoBurstMul = emptyAmmoBurstLine
      ? Math.max(1, this.tierValueFromLine(emptyAmmoBurstLine, tIdx))
      : 1
    const useDamageLine = lines.find((s) => /使用时伤害\+\d+(?:[\/|]\d+)*/.test(s))
    const useDamageBonus = useDamageLine ? Math.round(this.tierValueFromLine(useDamageLine, tIdx)) : 0
    const canGrowDamageOnUse = useDamageBonus > 0 && this.isDamageBonusEligible(item)
    const skill88Multicast = this.hasSkill(item.side, 'skill88') && this.elapsedMs <= 5000 ? 1 : 0
    let fireCount = Math.max(1, item.baseStats.multicast + item.runtime.bonusMulticast + skill88Multicast)
    const ammoBeforeUse = item.runtime.ammoCurrent
    if (item.runtime.ammoMax > 0) {
      if (item.runtime.ammoCurrent <= 0) return
      fireCount = isAllAmmoShot
        ? Math.max(1, item.runtime.ammoCurrent)
        : fireCount
    }
    const willEmptyAmmoThisUse = item.runtime.ammoMax > 0
      && ((isAllAmmoShot && ammoBeforeUse > 0 && ammoBeforeUse <= fireCount) || (!isAllAmmoShot && ammoBeforeUse === 1))
    const useRepeatCount = Math.max(1, fireCount)
    const tickMsCfg = Math.max(1, getConfig().combatRuntime.tickMs)
    const shotIntervalMs = useRepeatCount > 1
      ? tickMsCfg
      : Math.max(tickMsCfg, this.effectiveCooldownMs(item) / Math.max(1, useRepeatCount))
    const shotIntervalTick = Math.max(1, Math.round(shotIntervalMs / tickMsCfg))

    if (sourceArch === '刺客') {
      for (const ally of this.items) {
        if (ally.side !== item.side || ally.id === item.id) continue
        const allyDef = this.findItemDef(ally.defId)
        if (!this.hasLine(allyDef, /使用刺客物品时立即使用此物品/)) continue
        this.enqueueExtraTriggeredUse(ally)
      }
    }

    EventBus.emit('battle:item_trigger', {
      itemId: item.defId,
      sourceItemId: item.id,
      side: item.side,
      triggerCount: 1,
      multicast: useRepeatCount,
      extraTriggered: fromExtraTrigger,
    })

    for (let i = 0; i < useRepeatCount; i++) {
      this.applyAdjacentUseHasteTriggers(item)
      if (!fromExtraTrigger) this.applyAdjacentUseExtraFireTriggers(item)
      this.applyAdjacentUseBurnTriggers(item)
      this.applyBurnUseSlowTriggers(item)
    }

    if (this.hasSkill(item.side, 'skill86') && this.skill86UseCountBySide[item.side] < 8) {
      const triggerCount = Math.min(useRepeatCount, 8 - this.skill86UseCountBySide[item.side])
      this.skill86UseCountBySide[item.side] += triggerCount
      const ammoCandidates = this.items
        .filter((it) => it.side === item.side && this.isAmmoItem(it))
        .sort((a, b) => (a.col - b.col) || a.id.localeCompare(b.id))
      const target = ammoCandidates.find((it) => it.runtime.currentChargeMs < this.effectiveCooldownMs(it)) ?? ammoCandidates[0]
      if (target) this.scheduleRepeatedChargePulses(item, target, triggerCount, 1000, shotIntervalTick)
    }

    if (this.hasSkill(item.side, 'skill87')) {
      const ordered = this.items
        .filter((it) => it.side === item.side)
        .sort((a, b) => (a.col - b.col) || a.id.localeCompare(b.id))
      const leftmost = ordered[0]
      const rightmost = ordered[ordered.length - 1]
      if (leftmost && rightmost && leftmost.id === item.id) {
          this.scheduleRepeatedChargePulses(item, rightmost, useRepeatCount, 500, shotIntervalTick)
        }
      }

    if (this.hasSkill(item.side, 'skill4') && this.isShieldItem(item)) {
      for (const ally of this.items) {
        if (ally.side !== item.side || ally.id === item.id) continue
        if (!this.isAdjacentByFootprint(ally, item)) continue
        if (!this.isDamageBonusEligible(ally)) continue
        ally.baseStats.damage += 4 * useRepeatCount
      }
    }
    if (this.hasSkill(item.side, 'skill5') && this.isShieldItem(item)) {
      item.baseStats.shield += 7 * useRepeatCount
    }
    if (this.hasSkill(item.side, 'skill11') && this.isAmmoItem(item)) {
      for (const ally of this.items) {
        if (ally.side !== item.side || ally.id === item.id) continue
        if (!this.isAdjacentByFootprint(ally, item)) continue
        if (!this.isDamageBonusEligible(ally)) continue
        ally.baseStats.damage += 5 * useRepeatCount
      }
    }

    const ctrl = this.applyCardEffects(item, def)

    // 控制触发增益（本场战斗内）
    if (ctrl.freeze > 0) {
      this.applyFreezeTriggeredAdjacentAttackBuff(item)
      for (const line of lines) {
        const v = Math.round(this.tierValueFromLine(line, tIdx))
        if (v <= 0) continue
        if (/冻结.*\+\d+(?:[\/|]\d+)*伤害/.test(line) && this.isDamageBonusEligible(item)) item.runtime.tempDamageBonus += v
        if (/冻结.*\+\d+(?:[\/|]\d+)*灼烧/.test(line)) item.baseStats.burn += v
        if (/冻结.*\+\d+(?:[\/|]\d+)*剧毒/.test(line)) item.baseStats.poison += v
      }
    }
    if (ctrl.slow > 0) {
      for (const line of lines) {
        const v = Math.round(this.tierValueFromLine(line, tIdx))
        if (v <= 0) continue
        if (/减速.*\+\d+(?:[\/|]\d+)*伤害/.test(line) && this.isDamageBonusEligible(item)) item.runtime.tempDamageBonus += v
        if (/减速.*\+\d+(?:[\/|]\d+)*灼烧/.test(line)) item.baseStats.burn += v
      }
    }
    if (ctrl.haste > 0) {
      const line = lines.find((s) => /触发加速时.*额外造成\d+(?:[\/|]\d+)*伤害/.test(s))
      if (line) {
        const v = Math.round(this.tierValueFromLine(line, tIdx))
        if (v > 0) {
          this.pendingHits.push({
            dueTick: this.tickIndex,
            side: item.side,
            sourceItemId: item.id,
            defId: item.defId,
            baseDamage: v,
            damage: v,
            crit: item.baseStats.crit,
          })
        }
      }
    }

    if (item.baseStats.shield > 0 && sourceHero.hp > 0) {
      const rawShieldPanel = item.baseStats.shield + this.shieldGainBonusForItem(item)
      let shieldPanel = this.scaleShieldGain(item.side, rawShieldPanel)
      if (lines.some((s) => /获得护盾[，,]?等于当前生命值/.test(s))) {
        shieldPanel = Math.max(0, Math.round(sourceHero.hp))
      }
      sourceHero.shield += shieldPanel
      this.debugShieldChargeLog('shield_gain_happened', {
        tick: this.tickIndex,
        sourceItemId: item.id,
        side: item.side,
        amount: shieldPanel,
      })
      EventBus.emit('battle:gain_shield', {
        targetId: sourceHero.id,
        sourceItemId: item.id,
        amount: shieldPanel,
        targetType: 'hero',
        targetSide: sourceHero.side,
        sourceType: 'item',
        sourceSide: item.side,
      })
      this.applyOnShieldGainCharge(item.side)
      this.applyShieldGainSkillTriggers(item.side, item.id, shieldPanel, this.isShieldItem(item))

      // 获得护盾时加速 1 件物品
      const shieldHasteLine = lines.find((s) => /获得护盾时.*加速.*件物品/.test(s))
      if (shieldHasteLine) {
        const sec = this.tierValueFromLine(shieldHasteLine, tIdx)
        if (sec > 0) {
          const targets = this.pickControlTargets({
            side: item.side,
            count: 1,
            mode: 'leftmost',
            source: item,
            excludeId: item.id,
          })
          this.applyHasteToTargetItems(item, targets, Math.round(sec * 1000))
        }
      }
    }

    const adjacentShieldUseLine = lines.find((s) => /使用时相邻(?:的)?(?:护盾物品)?护盾\+\d+(?:[\/|]\d+)*/.test(s))
    if (adjacentShieldUseLine) {
      const v = Math.round(this.tierValueFromLine(adjacentShieldUseLine, tIdx)) * useRepeatCount
      if (v > 0) {
        for (const ally of this.items) {
          if (ally.side !== item.side || ally.id === item.id) continue
          if (!this.isAdjacentByFootprint(ally, item)) continue
          if (ally.baseStats.shield <= 0) continue
          ally.baseStats.shield += v
        }
      }
    }

    const adjacentDamageUseLine = lines.find((s) => /使用时相邻物品伤害\+\d+(?:[\/|]\d+)*/.test(s))
    if (adjacentDamageUseLine) {
      const v = Math.round(this.tierValueFromLine(adjacentDamageUseLine, tIdx)) * useRepeatCount
      if (v > 0) {
        for (const ally of this.items) {
          if (ally.side !== item.side || ally.id === item.id) continue
          if (!this.isAdjacentByFootprint(ally, item)) continue
          if (!this.isDamageBonusEligible(ally)) continue
          ally.baseStats.damage += v
        }
      }
    }

    const allShieldUseLine = lines.find((s) => /使用后所有护盾物品\+\d+(?:[\/|]\d+)*护盾/.test(s))
    if (allShieldUseLine) {
      const v = Math.round(this.tierValueFromLine(allShieldUseLine, tIdx)) * useRepeatCount
      if (v > 0) {
        for (const ally of this.items) {
          if (ally.side !== item.side) continue
          if (ally.baseStats.shield <= 0) continue
          ally.baseStats.shield += v
        }
      }
    }
    const maxHpHealLine = lines.find((s) => /恢复最大生命值\s*[+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*\s*的生命值/.test(s))
    const maxHpHealAmount = (() => {
      if (!maxHpHealLine) return 0
      const pct = Math.max(0, this.tierValueFromLine(maxHpHealLine, tIdx)) / 100
      if (pct <= 0) return 0
      return Math.max(0, Math.round(sourceHero.maxHp * pct))
    })()

    if ((item.baseStats.heal > 0 || maxHpHealAmount > 0) && sourceHero.hp > 0) {
      const totalHeal = Math.max(0, item.baseStats.heal + maxHpHealAmount)
      const realHeal = Math.max(0, Math.min(sourceHero.maxHp - sourceHero.hp, totalHeal))
      if (realHeal > 0) {
        sourceHero.hp += realHeal
        EventBus.emit('battle:heal', {
          targetId: sourceHero.id,
          sourceItemId: item.id,
          amount: realHeal,
          isRegen: false,
          targetType: 'hero',
          targetSide: sourceHero.side,
          sourceType: 'item',
          sourceSide: item.side,
        })
      }
      const cleansePct = Math.max(0, rv('healCleansePct', getConfig().combatRuntime.healCleansePct))
      const clearLayer = Math.max(0, Math.ceil(item.baseStats.heal * cleansePct))
      if (clearLayer > 0) {
        const burnBefore = sourceHero.burn
        const poisonBefore = sourceHero.poison
        sourceHero.burn = Math.max(0, sourceHero.burn - clearLayer)
        sourceHero.poison = Math.max(0, sourceHero.poison - clearLayer)
        if (burnBefore > 0 && sourceHero.burn === 0) {
          EventBus.emit('battle:status_remove', {
            targetId: sourceHero.id,
            status: 'burn',
            targetType: 'hero',
            targetSide: sourceHero.side,
          })
        }
        if (poisonBefore > 0 && sourceHero.poison === 0) {
          EventBus.emit('battle:status_remove', {
            targetId: sourceHero.id,
            status: 'poison',
            targetType: 'hero',
            targetSide: sourceHero.side,
          })
        }
      }
    }

    if (item.baseStats.burn > 0) {
      targetHero.burn += item.baseStats.burn
      EventBus.emit('battle:status_apply', {
        targetId: targetHero.id,
        sourceItemId: item.id,
        status: 'burn',
        amount: item.baseStats.burn,
        targetType: 'hero',
        targetSide: targetHero.side,
        sourceType: 'item',
        sourceSide: item.side,
      })

      // 造成灼烧时：剧毒物品 +X 剧毒
      const line = lines.find((s) => /造成灼烧时.*剧毒物品\+\d+(?:[\/|]\d+)*/.test(s))
      if (line) {
        const v = Math.round(this.tierValueFromLine(line, tIdx))
        if (v > 0) {
          for (const ally of this.items) {
            if (ally.side !== item.side) continue
            if (ally.baseStats.poison <= 0) continue
            ally.baseStats.poison += v
          }
        }
      }
    }
    if (item.baseStats.poison > 0) {
      targetHero.poison += item.baseStats.poison
      EventBus.emit('battle:status_apply', {
        targetId: targetHero.id,
        sourceItemId: item.id,
        status: 'poison',
        amount: item.baseStats.poison,
        targetType: 'hero',
        targetSide: targetHero.side,
        sourceType: 'item',
        sourceSide: item.side,
      })

      if (lines.some((s) => /并使目标身上的剧毒层数翻倍/.test(s))) {
        const extra = Math.max(0, targetHero.poison)
        if (extra > 0) {
          targetHero.poison += extra
          EventBus.emit('battle:status_apply', {
            targetId: targetHero.id,
            sourceItemId: item.id,
            status: 'poison',
            amount: extra,
            targetType: 'hero',
            targetSide: targetHero.side,
            sourceType: 'item',
            sourceSide: item.side,
          })
        }
      }

      // 造成剧毒时恢复
      const healLine = lines.find((s) => /造成剧毒时恢复\+?\d+(?:[\/|]\d+)*/.test(s))
      if (healLine) {
        const heal = Math.round(this.tierValueFromLine(healLine, tIdx))
        if (heal > 0 && sourceHero.hp > 0) {
          const real = Math.max(0, Math.min(sourceHero.maxHp - sourceHero.hp, heal))
          if (real > 0) {
            sourceHero.hp += real
            EventBus.emit('battle:heal', {
              targetId: sourceHero.id,
              sourceItemId: item.id,
              amount: real,
              isRegen: false,
              targetType: 'hero',
              targetSide: sourceHero.side,
              sourceType: 'item',
              sourceSide: item.side,
            })
          }
        }
      }

      // 造成剧毒时：灼烧物品 +X 灼烧
      const poisonToBurnLine = lines.find((s) => /造成剧毒时.*灼烧物品\+\d+(?:[\/|]\d+)*/.test(s))
      if (poisonToBurnLine) {
        const v = Math.round(this.tierValueFromLine(poisonToBurnLine, tIdx))
        if (v > 0) {
          for (const ally of this.items) {
            if (ally.side !== item.side) continue
            if (ally.baseStats.burn <= 0) continue
            ally.baseStats.burn += v
          }
        }
      }
    }
    if (item.baseStats.regen > 0) {
      sourceHero.regen += item.baseStats.regen
      EventBus.emit('battle:status_apply', {
        targetId: sourceHero.id,
        sourceItemId: item.id,
        status: 'regen',
        amount: item.baseStats.regen,
        targetType: 'hero',
        targetSide: sourceHero.side,
        sourceType: 'item',
        sourceSide: item.side,
      })
    }

    const baseDamageRaw = Math.max(0, item.baseStats.damage + this.runtimeGlobalDamageBonus(item))
    const skillMul = this.skillDamageMultiplier(item)
    const baseDamageUnscaled = Math.max(0, Math.round(baseDamageRaw * skillMul))
    const baseDamage = this.scaledDamage(item, baseDamageUnscaled)
    let damageAfterBonus = this.scaledDamage(item, baseDamageUnscaled + item.runtime.tempDamageBonus)

    const adjacentBoomerangDouble = lines.some((s) => /相邻回旋镖时伤害翻倍/.test(s))
    if (adjacentBoomerangDouble) {
      const hasAdjacentSame = this.items.some((ally) =>
        ally.side === item.side
        && ally.id !== item.id
        && ally.defId === item.defId
        && this.isAdjacentByFootprint(ally, item),
      )
      if (hasAdjacentSame) damageAfterBonus *= 2
    }

    // 等同当前自身护盾值
    if (lines.some((s) => /等同于当前自身护盾值|根据当前护盾值对对方造成伤害/.test(s))) {
      damageAfterBonus += Math.max(0, sourceHero.shield)
    }
    // 目标最大生命值百分比伤害
    const maxHpLine = lines.find((s) => /最大生命值.*%.*伤害/.test(s) && !/摧毁自身/.test(s) && !/第一次攻击/.test(s))
    if (maxHpLine) {
      const m = maxHpLine.match(/最大生命值\s*([+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*)\s*的伤害/)
      if (m?.[1]) {
        const pct = /[\/|]/.test(m[1]) ? pickTierSeriesValue(m[1], tIdx) : Number(m[1].replace(/%$/u, ''))
        if (Number.isFinite(pct) && pct > 0) {
          damageAfterBonus += Math.round(targetHero.maxHp * (pct / 100))
        }
      }
    }

    const firstHitLine = lines.find((s) => /第一次攻击额外造成目标最大生命值\d+(?:[\/|]\d+)*%的伤害/.test(s))
    const firstHitBonus = (() => {
      if (!firstHitLine || item.runtime.executeCount > 1) return 0
      const pct = Math.max(0, this.tierValueFromLine(firstHitLine, tIdx))
      if (pct <= 0) return 0
      return Math.round(targetHero.maxHp * (pct / 100))
    })()

    const selfHpPctLine = lines.find((s) => /额外造成自身当前生命值\d+(?:[\/|]\d+)*%的伤害/.test(s))
    if (selfHpPctLine) {
      const pct = Math.max(0, this.tierValueFromLine(selfHpPctLine, tIdx))
      if (pct > 0) damageAfterBonus += Math.round(sourceHero.hp * (pct / 100))
    }

    const selfMaxHpPctLine = lines.find((s) => /额外造成自身最大生命值\d+(?:[\/|]\d+)*%的伤害/.test(s))
    if (selfMaxHpPctLine) {
      const pct = Math.max(0, this.tierValueFromLine(selfMaxHpPctLine, tIdx))
      if (pct > 0) damageAfterBonus += Math.round(sourceHero.maxHp * (pct / 100))
    }

    // 邻接被动：相邻物品攻击时，攻击造成 X 伤害
    for (const ally of this.items) {
      if (ally.side !== item.side || ally.id === item.id) continue
      if (!this.isAdjacentById(ally.id, item.id)) continue
      const allyDef = this.findItemDef(ally.defId)
      const allyLine = this.skillLines(allyDef).find((s) => /相邻物品攻击时.*造成\d+(?:[\/|]\d+)*伤害/.test(s))
      if (!allyLine) continue
      const v = Math.round(this.tierValueFromLine(allyLine, this.tierIndex(allyDef, ally.tier)))
      if (v > 0) damageAfterBonus += v
    }

    if (damageAfterBonus > 0) {
      const isLastShotDoubleTriggered = this.hasSkill(item.side, 'skill50')
        && item.runtime.ammoMax > 0
        && ((isAllAmmoShot && ammoBeforeUse > 0) || (!isAllAmmoShot && ammoBeforeUse === 1))
      if (lines.some((s) => /唯一的攻击物品.*触发2次/.test(s))) {
        const attackers = this.items.filter((it) => it.side === item.side && it.baseStats.damage > 0)
        if (attackers.length === 1) fireCount = Math.max(fireCount, 2)
      }
      let progressiveUseBonus = 0
      for (let i = 0; i < fireCount; i++) {
        let shotDamage = Math.max(0, damageAfterBonus + this.scaledDamage(item, progressiveUseBonus))
        if (i === 0 && firstHitBonus > 0) {
          shotDamage = Math.max(0, shotDamage + firstHitBonus)
        }
        if (isLastShotDoubleTriggered && i === fireCount - 1) {
          shotDamage = Math.max(0, shotDamage * 2)
        }
        if (lines.some((s) => /如果这是唯一的伤害物品[，,]?造成3倍伤害/.test(s))) {
          const attackers = this.items.filter((it) => it.side === item.side && this.isDamageItemForUniqueCheck(it))
          if (attackers.length === 1) shotDamage = Math.max(0, shotDamage * 3)
        }
        if (willEmptyAmmoThisUse && emptyAmmoBurstMul > 1) {
          shotDamage = Math.max(0, Math.round(shotDamage * emptyAmmoBurstMul))
        }
          this.pendingHits.push({
          dueTick: this.tickIndex + i * shotIntervalTick,
          side: item.side,
          sourceItemId: item.id,
          defId: item.defId,
          baseDamage,
          damage: shotDamage,
          attackerDamageAtQueue: this.scaledDamage(item, item.baseStats.damage + item.runtime.tempDamageBonus + this.runtimeGlobalDamageBonus(item)),
          lockAttackerDelta: true,
          crit: item.baseStats.crit,
        })
        if (canGrowDamageOnUse) {
          item.baseStats.damage += useDamageBonus
          progressiveUseBonus += useDamageBonus
        }
      }
    }

    if (lines.some((s) => /摧毁敌人的1件物品/.test(s))) {
      const enemies = this.items
        .filter((it) => it.side !== item.side)
        .filter((it) => !this.isItemDestroyImmune(it))
      if (enemies.length > 0) {
        const rng = makeSeededRng(this.seedFrom(item.id, this.tickIndex))
        const picked = enemies[Math.floor(rng() * enemies.length)]
        if (picked) {
          EventBus.emit('battle:item_destroy', {
            sourceItemId: item.id,
            sourceSide: item.side,
            targetItemId: picked.id,
            targetSide: picked.side,
          })
          this.removeItemFromBattle(picked.id)
        }
      }
    }

    if (item.runtime.ammoMax > 0) {
      const ammoBefore = item.runtime.ammoCurrent
      const phantomCount = this.items.filter((it) => {
        if (it.side !== item.side) return false
        const def2 = this.findItemDef(it.defId)
        return this.hasLine(def2, /弹药物品伤害\+\d+(?:[\/|]\d+)*[，,]?弹药消耗翻倍/)
      }).length
      const singleUseCost = Math.max(1, 1 + phantomCount)
      if (isAllAmmoShot) item.runtime.ammoCurrent = Math.max(0, item.runtime.ammoCurrent - fireCount)
      else item.runtime.ammoCurrent = Math.max(0, item.runtime.ammoCurrent - singleUseCost)
      const ammoSpent = Math.max(0, ammoBefore - item.runtime.ammoCurrent)
      const becameEmpty = ammoBefore > 0 && item.runtime.ammoCurrent <= 0
      if (this.hasSkill(item.side, 'skill9') && !this.skillFirstAmmoEmptyTriggeredBySide[item.side] && becameEmpty) {
        this.skillFirstAmmoEmptyTriggeredBySide[item.side] = true
        this.refillAmmoAndTriggerGrowth(item, 3)
      }
      if (this.hasSkill(item.side, 'skill52') && becameEmpty) {
        if (makeSeededRng(this.seedFrom(item.defId, this.tickIndex))() < 0.5) {
          this.refillAmmoAndTriggerGrowth(item, item.runtime.ammoMax)
        }
      }
      if (this.hasSkill(item.side, 'skill54') && ammoSpent > 0) {
        for (const ally of this.items) {
          if (ally.side !== item.side) continue
          if (!this.isDamageBonusEligible(ally)) continue
          ally.baseStats.damage += 5
        }
      }
      if (this.hasSkill(item.side, 'skill85') && becameEmpty) {
        for (const ally of this.items) {
          if (ally.side !== item.side || ally.id === item.id) continue
          if (!this.isAdjacentByFootprint(ally, item)) continue
          if (!this.isDamageBonusEligible(ally)) continue
          ally.baseStats.damage += 50
        }
      }

      if (becameEmpty) {
        for (const owner of this.items) {
          if (owner.side !== item.side) continue
          const ownerDef = this.findItemDef(owner.defId)
          const line = this.skillLines(ownerDef).find((s) => /任意物品弹药耗尽时为其补充\d+(?:[\/|]\d+)*发弹药并充能\d+(?:[\/|]\d+)*秒/.test(s))
          if (!line) continue
          const gain = Math.max(0, Math.round(this.tierValueFromLine(line, this.tierIndex(ownerDef, owner.tier))))
          if (gain <= 0) continue
          this.pendingAmmoRefills.push({
            dueTick: this.tickIndex + 1,
            sourceItemId: owner.id,
            targetItemId: item.id,
            gainAmmo: gain,
            chargeMs: 1000,
          })
        }
      }
    }

    if (lines.some((s) => /连发次数-1/.test(s))) {
      item.baseStats.multicast = Math.max(1, item.baseStats.multicast - 1)
    }

    const refillAmmoLine = lines.find((s) => /补充\d+(?:[\/|]\d+)*(?:发)?弹药/.test(s))
    if (refillAmmoLine) {
      const gain = (() => {
        const m = refillAmmoLine.match(/补充\s*(\d+(?:[\/|]\d+)*)\s*(?:发)?弹药/)
        if (!m?.[1]) return 0
        return Math.max(0, Math.round(pickTierSeriesValue(m[1], tIdx))) * useRepeatCount
      })()
      if (gain > 0) {
        const allTeamRefill = /为其他物品补充\d+(?:[\/|]\d+)*发弹药/.test(refillAmmoLine)
        for (const ally of this.items) {
          if (ally.side !== item.side || ally.id === item.id) continue
          if (!allTeamRefill && !this.isAdjacentByFootprint(ally, item)) continue
          if (ally.runtime.ammoMax <= 0) continue
          this.refillAmmoAndTriggerGrowth(ally, gain)
        }
      }
    }

    const selfDestroyExplodeLine = lines.find((s) => /弹药耗尽时摧毁自身.*最大生命值.*%.*伤害/.test(s))
    if (selfDestroyExplodeLine && item.runtime.ammoMax > 0 && item.runtime.ammoCurrent <= 0) {
      const pctSeries = selfDestroyExplodeLine.match(/最大生命值\s*([+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*)\s*的伤害/)
      const pct = pctSeries?.[1]
        ? (/[\/|]/.test(pctSeries[1]) ? pickTierSeriesValue(pctSeries[1], tIdx) : Number(pctSeries[1].replace(/%$/u, '')))
        : 0
      if (pct > 0) this.applyDirectSkillDamage(item.side, Math.round(targetHero.maxHp * (pct / 100)), item.id, 'item')
      this.removeItemFromBattle(item.id)
      return
    }

    const postAttackDamageLine = lines.find((s) => /每次攻击后伤害\+\d+(?:[\/|]\d+)*/.test(s))
    if (postAttackDamageLine) {
      const v = Math.round(this.tierValueFromLine(postAttackDamageLine, tIdx)) * useRepeatCount
      if (v > 0 && this.isDamageBonusEligible(item)) item.baseStats.damage += v
    }

    const postUseShieldLine = lines.find((s) => /每次使用后护盾\+\d+(?:[\/|]\d+)*/.test(s))
    if (postUseShieldLine) {
      const v = Math.round(this.tierValueFromLine(postUseShieldLine, tIdx)) * useRepeatCount
      if (v > 0) item.baseStats.shield += v
    }

    const adjacentShieldGrowLine = lines.find((s) => /每次使用后相邻护盾物品\+\d+(?:[\/|]\d+)*护盾/.test(s))
    if (adjacentShieldGrowLine) {
      const v = Math.round(this.tierValueFromLine(adjacentShieldGrowLine, tIdx)) * useRepeatCount
      if (v > 0) {
        for (const ally of this.items) {
          if (ally.side !== item.side || ally.id === item.id) continue
          if (ally.baseStats.shield <= 0) continue
          if (!this.isAdjacentByFootprint(ally, item)) continue
          ally.baseStats.shield += v
        }
      }
    }

    if (lines.some((s) => /(?:每次)?使用后伤害翻倍/.test(s)) && this.isDamageBonusEligible(item)) {
      for (let i = 0; i < useRepeatCount; i++) item.baseStats.damage = Math.max(0, item.baseStats.damage * 2)
    }

    // 每次使用后自身 CD 减少 1 秒（本场战斗内）
    if (lines.some((s) => /每次使用后自身CD减少1秒/.test(s))) {
      item.baseStats.cooldownMs = Math.max(this.minReducedCdMsFor(item), item.baseStats.cooldownMs - 1000 * useRepeatCount)
    }
    const postUseCooldownLine = lines.find((s) => /攻击后间隔/.test(s))
    if (postUseCooldownLine) {
      let reduceMs = 1000
      let minMs = 1000
      const matched = postUseCooldownLine.match(/间隔[^\d]*(\d+)\s*ms[^\d]*最低[^\d]*(\d+)\s*ms/i)
      if (matched) {
        const parsedReduce = Number(matched[1])
        const parsedMin = Number(matched[2])
        if (Number.isFinite(parsedReduce) && parsedReduce > 0) reduceMs = parsedReduce
        if (Number.isFinite(parsedMin) && parsedMin > 0) minMs = parsedMin
      }
      item.baseStats.cooldownMs = Math.max(Math.max(minMs, this.minReducedCdMsFor(item)), item.baseStats.cooldownMs - reduceMs * useRepeatCount)
    }

    const postUseDamageReduceLine = lines.find((s) => /(?:每次)?使用后伤害-[\d|/]+/.test(s))
    if (postUseDamageReduceLine) {
      const v = Math.abs(Math.round(this.tierValueFromLine(postUseDamageReduceLine, tIdx))) * useRepeatCount
      if (v > 0) item.baseStats.damage = Math.max(1, item.baseStats.damage - v)
    }

    // 飞出时加速相邻物品
    const flyHasteLine = lines.find((s) => /飞出时加速相邻物品/.test(s))
    if (flyHasteLine) {
      const sec = this.tierValueFromLine(flyHasteLine, tIdx)
      if (sec > 0) {
        const targets = this.items.filter((it) => it.side === item.side && it.id !== item.id && this.isAdjacentByFootprint(it, item))
        this.applyHasteToTargetItems(item, targets, Math.round(sec * 1000 * useRepeatCount))
      }
    }
  }

  private applyBattleStartEffects(): void {
    this.applyBattleStartPassiveGrowths()
    for (const item of this.items) {
      const def = this.findItemDef(item.defId)
      if (!def) continue
      const lines = this.skillLines(def)
      if (!lines.some((s) => s.includes('开场时'))) continue

      const auto = lines.some((s) => /开场时自动触发/.test(s))
      if (auto) this.resolveFire(item)

      const ctrlSpecs = parseControlSpecsFromDef(def, getConfig().combatRuntime)
      const startSpecs = ctrlSpecs.filter((spec) => lines.some((ln) => {
        if (!ln.includes('开场时')) return false
        if (spec.status === 'freeze') return ln.includes('冻结')
        if (spec.status === 'slow') return ln.includes('减速')
        return ln.includes('加速')
      }))
      for (const spec of startSpecs) {
        const side: 'player' | 'enemy' = spec.targetSide === 'ally' ? item.side : (item.side === 'player' ? 'enemy' : 'player')
        const targets = this.pickControlTargets({
          side,
          count: spec.targetAll ? 999 : spec.count,
          mode: spec.targetMode,
          source: item,
          excludeId: spec.targetSide === 'ally' ? item.id : undefined,
        })
        for (const target of targets) {
          if (spec.status === 'freeze') target.runtime.modifiers.freezeMs = Math.max(target.runtime.modifiers.freezeMs, spec.durationMs)
          if (spec.status === 'slow') target.runtime.modifiers.slowMs = Math.max(target.runtime.modifiers.slowMs, spec.durationMs)
          if (spec.status === 'haste') target.runtime.modifiers.hasteMs = Math.max(target.runtime.modifiers.hasteMs, spec.durationMs)
          EventBus.emit('battle:status_apply', {
            targetId: target.id,
            sourceItemId: item.id,
            status: spec.status,
            amount: spec.durationMs,
            targetType: 'item',
            targetSide: target.side,
            sourceType: 'item',
            sourceSide: item.side,
          })
        }
      }
    }
  }

  private applyCardEffects(source: CombatItemRunner, def: ItemDef | null): { freeze: number; slow: number; haste: number } {
    if (!def) return { freeze: 0, slow: 0, haste: 0 }
    const out = { freeze: 0, slow: 0, haste: 0 }
    const specs = parseControlSpecsFromDef(def, getConfig().combatRuntime)
    for (const spec of specs) {
      const side: 'player' | 'enemy' =
        spec.targetSide === 'ally'
          ? source.side
          : (source.side === 'player' ? 'enemy' : 'player')
      const targets = this.pickControlTargets({
        side,
        count: spec.targetAll ? 999 : spec.count,
        mode: spec.targetMode,
        source,
        excludeId: spec.targetSide === 'ally' ? source.id : undefined,
      })
      for (const target of targets) {
        if (spec.status === 'freeze') target.runtime.modifiers.freezeMs = Math.max(target.runtime.modifiers.freezeMs, spec.durationMs)
        if (spec.status === 'slow') target.runtime.modifiers.slowMs = Math.max(target.runtime.modifiers.slowMs, spec.durationMs)
        if (spec.status === 'haste') target.runtime.modifiers.hasteMs = Math.max(target.runtime.modifiers.hasteMs, spec.durationMs)
        if (spec.status === 'freeze') out.freeze += 1
        if (spec.status === 'slow') out.slow += 1
        if (spec.status === 'haste') out.haste += 1
        EventBus.emit('battle:status_apply', {
          targetId: target.id,
          sourceItemId: source.id,
          status: spec.status,
          amount: spec.durationMs,
          targetType: 'item',
          targetSide: target.side,
          sourceType: 'item',
          sourceSide: source.side,
        })
      }
    }
    return out
  }

  private pickControlTargets(params: {
    side: 'player' | 'enemy'
    count: number
    mode: ControlSpec['targetMode']
    source: CombatItemRunner
    excludeId?: string
  }): CombatItemRunner[] {
    const { side, count, mode, source, excludeId } = params
    const base = this.items
      .filter((it) => it.side === side && it.id !== excludeId)
      .sort((a, b) => (a.col - b.col) || a.id.localeCompare(b.id))
    if (base.length === 0) return []

    const limitedCount = Math.max(0, Math.min(count, base.length))
    if (limitedCount === 0) return []

    if (mode === 'adjacent') {
      const adjacent = base.filter((it) => this.isAdjacentByFootprint(it, source))
      if (adjacent.length <= limitedCount) return adjacent
      return adjacent.slice(0, limitedCount)
    }

    if (mode === 'left') {
      const sourceLeft = source.col
      const left = base
        .filter((it) => it.col + this.itemWidth(it.size) - 1 === sourceLeft - 1)
        .sort((a, b) => a.id.localeCompare(b.id))
      return left.slice(0, limitedCount)
    }

    if (mode === 'fastest') {
      const ordered = [...base].sort((a, b) => {
        const ar = Math.max(0, a.baseStats.cooldownMs - a.runtime.currentChargeMs)
        const br = Math.max(0, b.baseStats.cooldownMs - b.runtime.currentChargeMs)
        return ar - br || a.id.localeCompare(b.id)
      })
      return ordered.slice(0, limitedCount)
    }

    if (mode === 'random') {
      const seed = this.seedFrom(source.id, this.tickIndex)
      const shuffled = this.shuffleDeterministic(base, seed)
      return shuffled.slice(0, limitedCount)
    }

    if (limitedCount >= base.length) return base
    return base.slice(0, limitedCount)
  }

  private itemWidth(size: ItemSizeNorm): number {
    if (size === '3x1') return 3
    if (size === '2x1') return 2
    return 1
  }

  private isAdjacentByFootprint(a: CombatItemRunner, b: CombatItemRunner): boolean {
    const aStart = a.col
    const aEnd = a.col + this.itemWidth(a.size) - 1
    const bStart = b.col
    const bEnd = b.col + this.itemWidth(b.size) - 1
    return aStart === bEnd + 1 || bStart === aEnd + 1
  }

  private seedFrom(key: string, salt: number): number {
    let h = 2166136261 ^ salt
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return h >>> 0
  }

  private shuffleDeterministic<T>(arr: T[], seed: number): T[] {
    const out = [...arr]
    let s = seed || 1
    const next = (): number => {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0
      return s / 0x100000000
    }
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1))
      const t = out[i]
      out[i] = out[j]!
      out[j] = t!
    }
    return out
  }

  private resolvePendingHitsForCurrentTick(): void {
    if (!this.pendingHits.length) return
    const due = this.pendingHits.filter((h) => h.dueTick <= this.tickIndex)
    this.pendingHits = this.pendingHits.filter((h) => h.dueTick > this.tickIndex)

    for (let hitIdx = 0; hitIdx < due.length; hitIdx++) {
      const hit = due[hitIdx]!
      EventBus.emit('battle:item_fire', {
        itemId: hit.defId,
        sourceItemId: hit.sourceItemId,
        side: hit.side,
        multicast: 1,
      })
      const attacker = this.items.find((it) => it.id === hit.sourceItemId)
      if (attacker) this.applyOnWeaponAttackTriggers(attacker)

      let resolvedBaseDamage = hit.baseDamage
      let resolvedDamage = hit.damage
      if (attacker && !hit.lockAttackerDelta && typeof hit.attackerDamageAtQueue === 'number') {
        const currentAttackerDamage = this.scaledDamage(attacker, attacker.baseStats.damage + attacker.runtime.tempDamageBonus + this.runtimeGlobalDamageBonus(attacker))
        const delta = currentAttackerDamage - hit.attackerDamageAtQueue
        if (delta !== 0) {
          resolvedBaseDamage = Math.max(0, hit.baseDamage + delta)
          resolvedDamage = Math.max(0, hit.damage + delta)
        }
      }
      resolvedBaseDamage = Math.max(0, Math.min(ITEM_DAMAGE_CAP, Math.round(resolvedBaseDamage)))
      resolvedDamage = Math.max(0, Math.min(ITEM_DAMAGE_CAP, Math.round(resolvedDamage)))
      const targetHero = hit.side === 'player' ? this.enemyHero : this.playerHero
      if (targetHero.hp <= 0) continue
      const critRoll = makeSeededRng(this.seedFrom(hit.defId, this.tickIndex * 1000 + hitIdx))() * 100
      const isCrit = critRoll < hit.crit
      const critMult = getConfig().combatRuntime.critMultiplier
      const panel = Math.max(0, Math.min(ITEM_DAMAGE_CAP, isCrit ? Math.round(resolvedDamage * critMult) : resolvedDamage))

      let remaining = panel
      const hpBefore = targetHero.hp
      if (!this.isHeroInvincible(targetHero.side)) {
        if (targetHero.shield > 0) {
          const blocked = Math.min(targetHero.shield, remaining)
          targetHero.shield -= blocked
          remaining -= blocked
        }
        if (remaining > 0) {
          targetHero.hp = Math.max(0, targetHero.hp - remaining)
          this.handleHeroHpThresholdTriggers(targetHero.side, hpBefore, targetHero.hp)
        }
      } else {
        remaining = 0
      }

      EventBus.emit('battle:take_damage', {
        targetId: targetHero.id,
        sourceItemId: hit.sourceItemId,
        amount: panel,
        isCrit,
        type: 'normal',
        targetType: 'hero',
        targetSide: targetHero.side,
        sourceType: 'item',
        sourceSide: hit.side,
        baseDamage: resolvedBaseDamage,
        finalDamage: remaining,
      })

      if (panel > 0) {
        this.applyOnHeroDamagedReactions(targetHero.side)
      }

      if (remaining > 0) {
        this.applyWanJianGrowthOnAnyDamage(hit.side)
        if (attacker) {
          this.applyOnDealDamageLifesteal(attacker, remaining)
          this.applyOnDealDamageSkillTriggers(attacker)
          this.applyAdjacentAttackDamageGrowth(attacker)
        }
        this.tryDeathMarkExecution(hit.side, targetHero)
      }

      if (targetHero.hp === 0) {
        EventBus.emit('battle:unit_die', {
          unitId: targetHero.id,
          side: targetHero.side,
        })
      }
    }
  }

  private applyOnHeroDamagedReactions(side: 'player' | 'enemy'): void {
    const hero = side === 'player' ? this.playerHero : this.enemyHero
    if (hero.hp <= 0) return
    for (const item of this.items) {
      if (item.side !== side) continue
      const def = this.findItemDef(item.defId)
      if (!def) continue
      const lines = this.skillLines(def)
      const tIdx = this.tierIndex(def, item.tier)

      const gainShieldLine = lines.find((s) => /受到攻击伤害时获得\d+(?:\/\d+)*护盾/.test(s))
      if (gainShieldLine) {
        const rawAmount = Math.round(this.tierValueFromLine(gainShieldLine, tIdx))
        const amount = this.scaleShieldGain(side, rawAmount)
        if (amount > 0) {
          hero.shield += amount
          EventBus.emit('battle:gain_shield', {
            targetId: hero.id,
            sourceItemId: item.id,
            amount,
            targetType: 'hero',
            targetSide: hero.side,
            sourceType: 'item',
            sourceSide: item.side,
          })
          this.applyOnShieldGainCharge(side)
          this.applyShieldGainSkillTriggers(side, item.id, amount, false)
        }
      }

      const selfChargeLine = lines.find((s) => /受到攻击时为此物品充能\d+(?:[\/|]\d+)*秒/.test(s))
      if (selfChargeLine) {
        const gainMs = Math.max(0, Math.round(this.tierValueFromLine(selfChargeLine, tIdx) * 1000))
        if (gainMs > 0) this.chargeItemByMs(item, gainMs)
      }

      if (lines.some((s) => /受到攻击时(?:额外|立即)使用此物品/.test(s))) {
        this.enqueueExtraTriggeredUse(item)
      }
    }
  }

  private stepFatigue(): void {
    const cr = getConfig().combatRuntime
    const tickMs = Math.max(1, rv('fatigueTickMs', cr.fatigueTickMs ?? cr.fatigueIntervalMs ?? 1000))
    const fixedBase = Math.max(0, rv('fatigueBaseValue', cr.fatigueBaseValue ?? cr.fatigueDamageFixedPerInterval ?? 1))
    const doubleEveryMs = Math.max(1, rv('fatigueDoubleEveryMs', cr.fatigueDoubleEveryMs ?? 1000))
    const elapsedFatigueMs = this.fatigueTickCount * tickMs
    const stack = Math.floor(elapsedFatigueMs / doubleEveryMs)
    const factor = Math.pow(2, Math.min(30, stack))
    const panelDamage = Math.max(1, Math.round(fixedBase * factor))

    const pPanel = panelDamage
    const ePanel = panelDamage

    const applyOne = (hero: HeroState, panel: number): { panel: number; hpDamage: number } => {
      if (this.isHeroInvincible(hero.side)) return { panel, hpDamage: 0 }
      const hpBefore = hero.hp
      let remaining = panel
      if (hero.shield > 0) {
        const blocked = Math.min(hero.shield, remaining)
        hero.shield -= blocked
        remaining -= blocked
      }
      if (remaining > 0) {
        hero.hp = Math.max(0, hero.hp - remaining)
        this.handleHeroHpThresholdTriggers(hero.side, hpBefore, hero.hp)
      }
      return { panel, hpDamage: remaining }
    }

    const p = applyOne(this.playerHero, pPanel)
    const e = applyOne(this.enemyHero, ePanel)

    this.fatigueTickCount += 1

    EventBus.emit('battle:fatigue_tick', {
      elapsedMs: this.elapsedMs,
      tick: this.fatigueTickCount,
      playerDamage: p.hpDamage,
      enemyDamage: e.hpDamage,
    })

    EventBus.emit('battle:take_damage', {
      targetId: this.playerHero.id,
      sourceItemId: 'fatigue',
      amount: p.panel,
      isCrit: false,
      type: 'normal',
      targetType: 'hero',
      targetSide: 'player',
      sourceType: 'system',
      sourceSide: 'system',
      finalDamage: p.hpDamage,
    })
    EventBus.emit('battle:take_damage', {
      targetId: this.enemyHero.id,
      sourceItemId: 'fatigue',
      amount: e.panel,
      isCrit: false,
      type: 'normal',
      targetType: 'hero',
      targetSide: 'enemy',
      sourceType: 'system',
      sourceSide: 'system',
      finalDamage: e.hpDamage,
    })
    this.clampCombatCaps()
  }

  private processStatusPeriodicByTick(): void {
    const cr = getConfig().combatRuntime
    const tickMs = Math.max(1, cr.tickMs)
    const burnTickEvery = Math.max(1, Math.round(Math.max(1, rv('burnTickMs', cr.burnTickMs)) / tickMs))
    const poisonTickEvery = Math.max(1, Math.round(Math.max(1, rv('poisonTickMs', cr.poisonTickMs)) / tickMs))
    const regenTickEvery = Math.max(1, Math.round(Math.max(1, rv('regenTickMs', cr.regenTickMs)) / tickMs))
    const skill33TickEvery = Math.max(1, Math.round(1000 / tickMs))

    if (this.tickIndex % burnTickEvery === 0) {
      this.applyBurnTick(this.playerHero)
      this.applyBurnTick(this.enemyHero)
    }

    if (this.tickIndex % poisonTickEvery === 0) {
      this.applyPoisonTick(this.playerHero)
      this.applyPoisonTick(this.enemyHero)
    }

    if (this.tickIndex % regenTickEvery === 0) {
      this.applyRegenTick(this.playerHero)
      this.applyRegenTick(this.enemyHero)
    }

    if (this.tickIndex % skill33TickEvery === 0) {
      this.applySkill33RegenTick()
    }
  }

  private applyBurnTick(hero: HeroState): void {
    const layer = hero.burn
    if (layer <= 0 || hero.hp <= 0) return
    if (this.isHeroInvincible(hero.side)) return
    let hpDamage = layer
    const shieldFactor = Math.max(0, rv('burnShieldFactor', getConfig().combatRuntime.burnShieldFactor))
    if (hero.shield > 0) {
      const shieldCost = Math.min(hero.shield, Math.ceil(layer * shieldFactor))
      hero.shield -= shieldCost
      const protectedValue = shieldFactor > 0 ? shieldCost / shieldFactor : 0
      hpDamage = Math.max(0, Math.round(layer - protectedValue))
    }
    if (hpDamage > 0) {
      const hpBefore = hero.hp
      hero.hp = Math.max(0, hero.hp - hpDamage)
      this.handleHeroHpThresholdTriggers(hero.side, hpBefore, hero.hp)
      EventBus.emit('battle:take_damage', {
        targetId: hero.id,
        sourceItemId: 'status_burn',
        amount: hpDamage,
        isCrit: false,
        type: 'burn',
        targetType: 'hero',
        targetSide: hero.side,
        sourceType: 'system',
        sourceSide: 'system',
      })
    }

    const decayPct = Math.max(0, rv('burnDecayPct', getConfig().combatRuntime.burnDecayPct))
    const decay = Math.ceil(layer * decayPct)
    if (decay > 0) {
      const burnBefore = hero.burn
      hero.burn = Math.max(0, hero.burn - decay)
      if (burnBefore > 0 && hero.burn === 0) {
        EventBus.emit('battle:status_remove', {
          targetId: hero.id,
          status: 'burn',
          targetType: 'hero',
          targetSide: hero.side,
        })
      }
    }
  }

  private applyPoisonTick(hero: HeroState): void {
    const layer = hero.poison
    if (layer <= 0 || hero.hp <= 0) return
    if (this.isHeroInvincible(hero.side)) return
    const hpBefore = hero.hp
    hero.hp = Math.max(0, hero.hp - layer)
    this.handleHeroHpThresholdTriggers(hero.side, hpBefore, hero.hp)
    EventBus.emit('battle:take_damage', {
      targetId: hero.id,
      sourceItemId: 'status_poison',
      amount: layer,
      isCrit: false,
      type: 'poison',
      targetType: 'hero',
      targetSide: hero.side,
      sourceType: 'system',
      sourceSide: 'system',
    })
  }

  private applyRegenTick(hero: HeroState): void {
    const layer = hero.regen
    if (layer <= 0 || hero.hp <= 0) return
    const healed = Math.max(0, Math.min(hero.maxHp - hero.hp, layer))
    if (healed <= 0) return
    hero.hp += healed
    EventBus.emit('battle:heal', {
      targetId: hero.id,
      sourceItemId: 'status_regen',
      amount: healed,
      isRegen: true,
      targetType: 'hero',
      targetSide: hero.side,
      sourceType: 'system',
      sourceSide: 'system',
    })
  }

  private shouldResolve(): boolean {
    this.applyReviveIfPossible('player')
    this.applyReviveIfPossible('enemy')
    return this.playerHero.hp <= 0 || this.enemyHero.hp <= 0
  }

  private computeSurvivingDamage(_winnerSide: 'player' | 'enemy'): number {
    // 固定扣血：每次失败扣 baseDamage 点，不计算存活物品权重
    return getConfig().pvpRules?.baseDamage ?? 1
  }

  private finishCombat(): void {
    if (this.finished) return
    this.finished = true
    this.phase = 'END'
    let winner: 'player' | 'enemy' | 'draw' = 'draw'
    if (this.playerHero.hp > 0 && this.enemyHero.hp <= 0) winner = 'player'
    if (this.enemyHero.hp > 0 && this.playerHero.hp <= 0) winner = 'enemy'
    const survivingDamage = winner === 'draw' ? 0
      : winner === 'player' ? this.computeSurvivingDamage('player')
      : this.computeSurvivingDamage('enemy')
    this.result = { winner, ticks: this.tickIndex, survivingDamage }
    EventBus.emit('battle:end', {
      winner,
      blameLog: [
        `day=${this.day}`,
        `ticks=${this.tickIndex}`,
        `playerHp=${this.playerHero.hp}`,
        `enemyHp=${this.enemyHero.hp}`,
        `fatigue=${this.inFatigue ? '1' : '0'}`,
      ],
    })
  }
}
