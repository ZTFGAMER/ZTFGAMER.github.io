import { EventBus } from '@/core/EventBus'
import type { BattleSnapshotBundle, BattleSnapshotEntity } from '@/combat/BattleSnapshotStore'
import { getAllItems, getConfig } from '@/core/DataLoader'
import type { ItemDef, ItemSizeNorm } from '@/items/ItemDef'
import { normalizeSize } from '@/items/ItemDef'
import { resolveItemTierBaseStats } from '@/items/itemTierStats'

export type CombatPhase = 'IDLE' | 'INIT' | 'SETUP' | 'TICK' | 'RESOLVE' | 'END'

export interface CombatResult {
  winner: 'player' | 'enemy' | 'draw'
  ticks: number
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
  crit: number
}

interface PendingItemFire {
  dueTick: number
  sourceItemId: string
}

const DEBUG_SHIELD_CHARGE = false

interface CombatStartOptions {
  enemyDisabled?: boolean
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
  const star = tier === 'Diamond' ? 1 : parseTierStar(raw)
  if (tier === 'Bronze') return star === 2 ? 2 : 1
  if (tier === 'Silver') return star === 2 ? 4 : 3
  if (tier === 'Gold') return star === 2 ? 6 : 5
  return 7
}

function startTierScore(def: ItemDef | null): number {
  if (!def) return 1
  const tier = parseTierName(def.starting_tier || 'Bronze')
  if (tier === 'Silver') return 3
  if (tier === 'Gold') return 5
  if (tier === 'Diamond') return 7
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
  const n = Number((parts[idx] ?? '').replace(/^\+/, ''))
  return Number.isFinite(n) ? n : 0
}

type EnemyTier = 'Bronze' | 'Silver' | 'Gold' | 'Diamond'
type EnemyStar = 1 | 2

function tierStarToRaw(tier: EnemyTier, star: EnemyStar): string {
  return tier === 'Diamond' ? 'Diamond' : `${tier}#${star}`
}

function qualityScoreToTierStar(score: number): { tier: EnemyTier; star: EnemyStar } {
  const s = Math.max(1, Math.min(7, Math.round(score)))
  if (s >= 7) return { tier: 'Diamond', star: 1 }
  if (s >= 6) return { tier: 'Gold', star: 2 }
  if (s >= 5) return { tier: 'Gold', star: 1 }
  if (s >= 4) return { tier: 'Silver', star: 2 }
  if (s >= 3) return { tier: 'Silver', star: 1 }
  if (s >= 2) return { tier: 'Bronze', star: 2 }
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
const MIN_REDUCED_CD_MS = 500

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
  private lastQueuedFireTickByItem: Map<string, number> = new Map()

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

    this.items = [
      ...snapshot.entities.map((it, idx) => this.toRunner(it, `P-${idx}`)),
      ...(options?.enemyDisabled ? [] : this.makeEnemyRunners(snapshot)),
    ]

    this.applyBattleStartEffects()

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

  getDebugState(): { tickIndex: number; playerAlive: number; enemyAlive: number; playerHp: number; enemyHp: number; inFatigue: boolean } {
    return {
      tickIndex: this.tickIndex,
      playerAlive: this.playerHero.hp > 0 ? 1 : 0,
      enemyAlive: this.enemyHero.hp > 0 ? 1 : 0,
      playerHp: this.playerHero.hp,
      enemyHp: this.enemyHero.hp,
      inFatigue: this.inFatigue,
    }
  }

  getBoardState(): { player: HeroState; enemy: HeroState; items: CombatBoardItem[] } {
    return {
      player: { ...this.playerHero },
      enemy: { ...this.enemyHero },
      items: this.items.map((it) => ({
        id: it.id,
        side: it.side,
        defId: it.defId,
        col: it.col,
        row: it.row,
        size: it.size,
        tier: it.tier,
        tierStar: it.tierStar,
        chargeRatio: Math.max(0, Math.min(1, it.runtime.currentChargeMs / Math.max(1, it.baseStats.cooldownMs))),
      })),
    }
  }

  getRuntimeState(): CombatItemRuntimeState[] {
    return this.items.map((it) => ({
      ...(() => {
        const baseDamage = Math.max(0, it.baseStats.damage + it.runtime.tempDamageBonus)
        let runtimeDamage = baseDamage
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
        return {
          id: it.id,
          side: it.side,
          currentChargeMs: it.runtime.currentChargeMs,
          cooldownMs: Math.max(0, it.baseStats.cooldownMs),
          chargePercent: Math.max(0, Math.min(1, it.runtime.currentChargeMs / Math.max(1, it.baseStats.cooldownMs))),
          executeCount: it.runtime.executeCount,
          tempDamageBonus: it.runtime.tempDamageBonus,
          ammoMax: it.runtime.ammoMax,
          ammoCurrent: it.runtime.ammoCurrent,
          freezeMs: it.runtime.modifiers.freezeMs,
          slowMs: it.runtime.modifiers.slowMs,
          hasteMs: it.runtime.modifiers.hasteMs,
          damage: runtimeDamage,
          heal: Math.max(0, it.baseStats.heal),
          shield: Math.max(0, it.baseStats.shield + this.shieldGainBonusForItem(it)),
          burn: Math.max(0, it.baseStats.burn),
          poison: Math.max(0, it.baseStats.poison),
          multicast: (() => {
            const base = Math.max(1, Math.round(it.baseStats.multicast))
            const boosted = Math.max(1, base + Math.max(0, Math.round(it.runtime.bonusMulticast)))
            const localDef = this.findItemDef(it.defId)
            if (!localDef) return boosted
            const allAmmoShot = this.skillLines(localDef).some((s) => /一次打出所有弹药/.test(s))
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
    this.lastQueuedFireTickByItem.clear()
  }

  private toRunner(entity: BattleSnapshotEntity, idPrefix: string): CombatItemRunner {
    const def = this.findItemDef(entity.defId)
    const tierStar: 1 | 2 = entity.tier === 'Diamond' ? 1 : (entity.tierStar === 2 ? 2 : 1)
    const tierRaw = entity.tier === 'Diamond' ? 'Diamond' : `${entity.tier}#${tierStar}`
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
    const cfg = getConfig()
    const labCfg = cfg.gameplayModeValues?.enemyDraftLab
    const labEnabled = rvBool('enemyDraftEnabled', labCfg?.enabled === true)
    const configuredDefs = this.pickEnemyDefsByDay(all)
    const seedDefs = configuredDefs.length > 0 ? configuredDefs : all
    if (seedDefs.length === 0) return []

    const rng = makeSeededRng(this.day * 977 + snapshot.activeColCount * 131 + seedDefs.length * 17)

    if (!labEnabled) {
      const teaching = this.buildEnemyTeachingRunners(snapshot, all, rng)
      if (teaching && teaching.length > 0) return teaching
    }

    const sameArchetypeBias = Math.max(0, Math.min(1, rv('enemyDraftSameArchetypeBias', labCfg?.sameArchetypeBias ?? 0.85)))
    const targetCount = Math.max(1, Math.min(
      snapshot.activeColCount,
      Math.round(dailyCurveValue(labCfg?.dailyItemCount, this.day, 5)),
    ))
    const targetAvgQuality = Math.max(1, Math.min(7, dailyCurveValue(labCfg?.dailyAvgQuality, this.day, 3)))
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
      const star = (tier === 'Diamond' ? 1 : (p.star ?? 1)) as EnemyStar

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
      if (hit) out.push(hit)
    }
    return out
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
    if (!def) return 0
    const tiers = parseAvailableTiers(def.available_tiers)
    const tierName = parseTierName(tier)
    const idx = tiers.indexOf(tierName)
    const baseIdx = idx >= 0 ? idx : 0
    const star = parseTierStar(tier)
    return baseIdx + (star - 1)
  }

  private tierValueFromLine(line: string, tierIndex: number): number {
    const m = line.match(/(\+?\d+(?:\.\d+)?(?:[\/|]\+?\d+(?:\.\d+)?)*)/)
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
            if (ally.baseStats.damage <= 0) continue
            if (!this.isAdjacentByFootprint(ally, owner)) continue
            ally.baseStats.damage += v
          }
        }
      }

      const allWeaponDamageLine = lines.find(
        (s) => /(?:武器|物品)伤害\+\d+(?:[\/|]\d+)*/.test(s)
          && !/相邻/.test(s)
          && !/其他武器攻击时该(?:武器|物品)伤害\+/.test(s),
      )
      if (allWeaponDamageLine) {
        const v = Math.round(this.tierValueFromLine(allWeaponDamageLine, tIdx))
        if (v > 0) {
          for (const ally of this.items) {
            if (ally.side !== owner.side) continue
            if (ally.baseStats.damage <= 0) continue
            ally.baseStats.damage += v
          }
        }
      }

      const adjacentAmmoCapLine = lines.find((s) => /相邻物品\+\d+(?:[\/|]\+?\d+)*最大弹药量/.test(s))
      if (adjacentAmmoCapLine) {
        const v = Math.round(this.tierValueFromLine(adjacentAmmoCapLine, tIdx))
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
    }
  }

  private applyOnShieldGainCharge(side: 'player' | 'enemy'): void {
    const hasQueuedFire = (itemId: string): boolean => {
      const lastDue = this.lastQueuedFireTickByItem.get(itemId)
      return Number.isFinite(lastDue) && (lastDue as number) >= this.tickIndex
    }

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
        cooldownMs: owner.baseStats.cooldownMs,
      })

      if (hasQueuedFire(owner.id)) {
        owner.runtime.pendingChargeMs += gainMs
        this.debugShieldChargeLog('queued_fire_exists_add_pending', {
          tick: this.tickIndex,
          itemId: owner.id,
          gainMs,
          pendingChargeMs: owner.runtime.pendingChargeMs,
        })
        continue
      }

      const before = owner.runtime.currentChargeMs
      owner.runtime.currentChargeMs = Math.min(owner.baseStats.cooldownMs, owner.runtime.currentChargeMs + gainMs)
      const consumed = Math.max(0, owner.runtime.currentChargeMs - before)
      const overflow = Math.max(0, gainMs - consumed)
      if (overflow > 0) {
        owner.runtime.pendingChargeMs += overflow
        this.debugShieldChargeLog('overflow_to_pending', {
          tick: this.tickIndex,
          itemId: owner.id,
          overflow,
          pendingChargeMs: owner.runtime.pendingChargeMs,
        })
      }

      const needsAmmo = owner.runtime.ammoMax > 0
      const hasAmmo = owner.runtime.ammoCurrent > 0
      if (owner.runtime.currentChargeMs >= owner.baseStats.cooldownMs && (!needsAmmo || hasAmmo)) {
        const baseDue = this.tickIndex + 1
        const lastDue = this.lastQueuedFireTickByItem.get(owner.id) ?? (this.tickIndex - 1)
        const dueTick = Math.max(baseDue, lastDue + 1)
        this.pendingItemFires.push({ dueTick, sourceItemId: owner.id })
        this.lastQueuedFireTickByItem.set(owner.id, dueTick)
        this.debugShieldChargeLog('queue_extra_fire', {
          tick: this.tickIndex,
          itemId: owner.id,
          dueTick,
          currentChargeMs: owner.runtime.currentChargeMs,
          pendingChargeMs: owner.runtime.pendingChargeMs,
        })
      }
    }
  }

  private applyPendingChargeToFreshCycle(owner: CombatItemRunner): void {
    if (owner.runtime.pendingChargeMs <= 0) return
    const gain = owner.runtime.pendingChargeMs
    owner.runtime.pendingChargeMs = 0
    owner.runtime.currentChargeMs = Math.min(owner.baseStats.cooldownMs, owner.runtime.currentChargeMs + gain)
    this.debugShieldChargeLog('apply_pending_to_fresh_cycle', {
      tick: this.tickIndex,
      itemId: owner.id,
      gain,
      currentChargeMs: owner.runtime.currentChargeMs,
      cooldownMs: owner.baseStats.cooldownMs,
    })

    const needsAmmo = owner.runtime.ammoMax > 0
    const hasAmmo = owner.runtime.ammoCurrent > 0
    if (owner.runtime.currentChargeMs >= owner.baseStats.cooldownMs && (!needsAmmo || hasAmmo)) {
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
    const baseDamage = Math.max(0, source.baseStats.damage)
    const damage = Math.max(0, baseDamage + source.runtime.tempDamageBonus)
    if (damage <= 0) return
    this.pendingHits.push({
      dueTick: this.tickIndex,
      side: source.side,
      sourceItemId: source.id,
      defId: source.defId,
      baseDamage,
      damage,
      attackerDamageAtQueue: Math.max(0, source.baseStats.damage + source.runtime.tempDamageBonus),
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
            if (ally.side !== owner.side || ally.baseStats.damage <= 0) continue
            ally.baseStats.damage += v
          }
        }
      }

      const selfGrowLine = lines.find((s) => /其他武器攻击时该武器伤害\+\d+(?:\/\d+)*/.test(s))
      if (selfGrowLine) {
        const v = Math.round(this.tierValueFromLine(selfGrowLine, tIdx))
        if (v > 0 && owner.baseStats.damage > 0) owner.runtime.tempDamageBonus += v
      }

      const extraFireLine = lines.find((s) => /相邻武器攻击时额外触发此武器攻击/.test(s))
      if (extraFireLine && this.isAdjacentByFootprint(owner, attacker)) {
        this.enqueueOneAttackFrom(owner)
      }

      const ammoTriggerLine = lines.find((s) => /使用弹药物品时攻击次数\+1/.test(s))
      if (ammoTriggerLine && attacker.runtime.ammoMax > 0) {
        owner.runtime.bonusMulticast += 1
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
      if (ally.baseStats.damage <= 0) continue
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
      if (v > 0 && owner.baseStats.damage > 0) owner.runtime.tempDamageBonus += v
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
    this.resolveQueuedItemFiresForCurrentTick()
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

      item.runtime.currentChargeMs += gain
      if (item.runtime.currentChargeMs >= item.baseStats.cooldownMs) {
        const needsAmmo = item.runtime.ammoMax > 0
        const hasAmmo = item.runtime.ammoCurrent > 0
        if (needsAmmo && !hasAmmo) {
          // 弹药武器无弹时：停在“已充能完成”状态，等待补弹后立刻可发射
          item.runtime.currentChargeMs = item.baseStats.cooldownMs
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
      this.resolveFire(owner)
    }
  }

  private resolveFire(item: CombatItemRunner): void {
    const sourceHero = item.side === 'player' ? this.playerHero : this.enemyHero
    const targetHero = item.side === 'player' ? this.enemyHero : this.playerHero
    const def = this.findItemDef(item.defId)
    const lines = this.skillLines(def)
    const tIdx = this.tierIndex(def, item.tier)
    const isAllAmmoShot = lines.some((s) => /(?:一次)?打出所有弹药/.test(s))
    const useDamageLine = lines.find((s) => /使用时伤害\+\d+(?:[\/|]\d+)*/.test(s))
    const useDamageBonus = useDamageLine ? Math.round(this.tierValueFromLine(useDamageLine, tIdx)) : 0
    let fireCount = Math.max(1, item.baseStats.multicast + item.runtime.bonusMulticast)
    if (item.runtime.ammoMax > 0) {
      if (item.runtime.ammoCurrent <= 0) return
      fireCount = isAllAmmoShot
        ? Math.max(1, item.runtime.ammoCurrent)
        : fireCount
    }
    this.applyAdjacentUseHasteTriggers(item)
    this.applyAdjacentUseBurnTriggers(item)
    this.applyBurnUseSlowTriggers(item)

    const ctrl = this.applyCardEffects(item, def)

    // 控制触发增益（本场战斗内）
    if (ctrl.freeze > 0) {
      this.applyFreezeTriggeredAdjacentAttackBuff(item)
      for (const line of lines) {
        const v = Math.round(this.tierValueFromLine(line, tIdx))
        if (v <= 0) continue
        if (/冻结.*\+\d+(?:\/\d+)*伤害/.test(line)) item.runtime.tempDamageBonus += v
        if (/冻结.*\+\d+(?:\/\d+)*灼烧/.test(line)) item.baseStats.burn += v
        if (/冻结.*\+\d+(?:\/\d+)*剧毒/.test(line)) item.baseStats.poison += v
      }
    }
    if (ctrl.slow > 0) {
      for (const line of lines) {
        const v = Math.round(this.tierValueFromLine(line, tIdx))
        if (v <= 0) continue
        if (/减速.*\+\d+(?:\/\d+)*伤害/.test(line)) item.runtime.tempDamageBonus += v
        if (/减速.*\+\d+(?:\/\d+)*灼烧/.test(line)) item.baseStats.burn += v
      }
    }
    if (ctrl.haste > 0) {
      const line = lines.find((s) => /触发加速时.*额外造成\d+(?:\/\d+)*伤害/.test(s))
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
      const shieldPanel = item.baseStats.shield + this.shieldGainBonusForItem(item)
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
      const v = Math.round(this.tierValueFromLine(adjacentShieldUseLine, tIdx))
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
      const v = Math.round(this.tierValueFromLine(adjacentDamageUseLine, tIdx))
      if (v > 0) {
        for (const ally of this.items) {
          if (ally.side !== item.side || ally.id === item.id) continue
          if (!this.isAdjacentByFootprint(ally, item)) continue
          if (ally.baseStats.damage <= 0) continue
          ally.baseStats.damage += v
        }
      }
    }

    const allShieldUseLine = lines.find((s) => /使用后所有护盾物品\+\d+(?:[\/|]\d+)*护盾/.test(s))
    if (allShieldUseLine) {
      const v = Math.round(this.tierValueFromLine(allShieldUseLine, tIdx))
      if (v > 0) {
        for (const ally of this.items) {
          if (ally.side !== item.side) continue
          if (ally.baseStats.shield <= 0) continue
          ally.baseStats.shield += v
        }
      }
    }
    if (item.baseStats.heal > 0 && sourceHero.hp > 0) {
      sourceHero.hp = Math.min(sourceHero.maxHp, sourceHero.hp + item.baseStats.heal)
      EventBus.emit('battle:heal', {
        targetId: sourceHero.id,
        sourceItemId: item.id,
        amount: item.baseStats.heal,
        isRegen: false,
        targetType: 'hero',
        targetSide: sourceHero.side,
        sourceType: 'item',
        sourceSide: item.side,
      })
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
      const line = lines.find((s) => /造成灼烧时.*剧毒物品\+\d+(?:\/\d+)*/.test(s))
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
      const healLine = lines.find((s) => /造成剧毒时恢复\+?\d+(?:\/\d+)*/.test(s))
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
      const poisonToBurnLine = lines.find((s) => /造成剧毒时.*灼烧物品\+\d+(?:\/\d+)*/.test(s))
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

    const baseDamage = Math.max(0, item.baseStats.damage)
    let damageAfterBonus = Math.max(0, baseDamage + item.runtime.tempDamageBonus + useDamageBonus)

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
    const maxHpLine = lines.find((s) => /最大生命值.*%.*伤害/.test(s))
    if (maxHpLine) {
      const m = maxHpLine.match(/(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*)%/)
      if (m?.[1]) {
        const pct = m[1].includes('/') ? pickTierSeriesValue(m[1], tIdx) : Number(m[1])
        if (Number.isFinite(pct) && pct > 0) {
          damageAfterBonus += Math.round(targetHero.maxHp * (pct / 100))
        }
      }
    }

    // 邻接被动：相邻物品攻击时，攻击造成 X 伤害
    for (const ally of this.items) {
      if (ally.side !== item.side || ally.id === item.id) continue
      if (!this.isAdjacentById(ally.id, item.id)) continue
      const allyDef = this.findItemDef(ally.defId)
      const allyLine = this.skillLines(allyDef).find((s) => /相邻物品攻击时.*造成\d+(?:\/\d+)*伤害/.test(s))
      if (!allyLine) continue
      const v = Math.round(this.tierValueFromLine(allyLine, this.tierIndex(allyDef, ally.tier)))
      if (v > 0) damageAfterBonus += v
    }

    if (damageAfterBonus > 0) {
      if (lines.some((s) => /唯一的攻击物品.*触发2次/.test(s))) {
        const attackers = this.items.filter((it) => it.side === item.side && it.baseStats.damage > 0)
        if (attackers.length === 1) fireCount = Math.max(fireCount, 2)
      }
      for (let i = 0; i < fireCount; i++) {
        const shotDamage = Math.max(0, damageAfterBonus + useDamageBonus * i)
        this.pendingHits.push({
          dueTick: this.tickIndex + i,
          side: item.side,
          sourceItemId: item.id,
          defId: item.defId,
          baseDamage,
          damage: shotDamage,
          attackerDamageAtQueue: Math.max(0, item.baseStats.damage + item.runtime.tempDamageBonus),
          crit: item.baseStats.crit,
        })
      }
    }

    if (item.runtime.ammoMax > 0) {
      if (isAllAmmoShot) item.runtime.ammoCurrent = Math.max(0, item.runtime.ammoCurrent - fireCount)
      else item.runtime.ammoCurrent = Math.max(0, item.runtime.ammoCurrent - 1)
    }

    if (lines.some((s) => /连发次数-1/.test(s))) {
      item.baseStats.multicast = Math.max(1, item.baseStats.multicast - 1)
    }

    const refillAmmoLine = lines.find((s) => /补充\d+(?:\/\d+)*(?:发)?弹药/.test(s))
    if (refillAmmoLine) {
      const gain = (() => {
        const m = refillAmmoLine.match(/补充\s*(\d+(?:[\/|]\d+)*)\s*(?:发)?弹药/)
        if (!m?.[1]) return 0
        return Math.max(0, Math.round(pickTierSeriesValue(m[1], tIdx)))
      })()
      if (gain > 0) {
        for (const ally of this.items) {
          if (ally.side !== item.side || ally.id === item.id) continue
          if (!this.isAdjacentByFootprint(ally, item)) continue
          if (ally.runtime.ammoMax <= 0) continue
          ally.runtime.ammoCurrent = Math.min(ally.runtime.ammoMax, ally.runtime.ammoCurrent + gain)
        }
      }
    }

    const postAttackDamageLine = lines.find((s) => /每次攻击后伤害\+\d+(?:\/\d+)*/.test(s))
    if (postAttackDamageLine) {
      const v = Math.round(this.tierValueFromLine(postAttackDamageLine, tIdx))
      if (v > 0 && item.baseStats.damage > 0) item.baseStats.damage += v
    }

    const postUseShieldLine = lines.find((s) => /每次使用后护盾\+\d+(?:\/\d+)*/.test(s))
    if (postUseShieldLine) {
      const v = Math.round(this.tierValueFromLine(postUseShieldLine, tIdx))
      if (v > 0) item.baseStats.shield += v
    }

    const adjacentShieldGrowLine = lines.find((s) => /每次使用后相邻护盾物品\+\d+(?:\/\d+)*护盾/.test(s))
    if (adjacentShieldGrowLine) {
      const v = Math.round(this.tierValueFromLine(adjacentShieldGrowLine, tIdx))
      if (v > 0) {
        for (const ally of this.items) {
          if (ally.side !== item.side || ally.id === item.id) continue
          if (ally.baseStats.shield <= 0) continue
          if (!this.isAdjacentByFootprint(ally, item)) continue
          ally.baseStats.shield += v
        }
      }
    }

    if (lines.some((s) => /每次使用后伤害翻倍/.test(s))) {
      item.baseStats.damage = Math.max(0, item.baseStats.damage * 2)
    }

    // 每次使用后自身 CD 减少 1 秒（本场战斗内）
    if (lines.some((s) => /每次使用后自身CD减少1秒/.test(s))) {
      item.baseStats.cooldownMs = Math.max(MIN_REDUCED_CD_MS, item.baseStats.cooldownMs - 1000)
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
      item.baseStats.cooldownMs = Math.max(Math.max(minMs, MIN_REDUCED_CD_MS), item.baseStats.cooldownMs - reduceMs)
    }

    const postUseDamageReduceLine = lines.find((s) => /使用后伤害-\d+/.test(s))
    if (postUseDamageReduceLine) {
      const v = Math.round(this.tierValueFromLine(postUseDamageReduceLine, tIdx))
      if (v > 0) item.baseStats.damage = Math.max(1, item.baseStats.damage - v)
    }

    // 飞出时加速相邻物品
    const flyHasteLine = lines.find((s) => /飞出时加速相邻物品/.test(s))
    if (flyHasteLine) {
      const sec = this.tierValueFromLine(flyHasteLine, tIdx)
      if (sec > 0) {
        const targets = this.items.filter((it) => it.side === item.side && it.id !== item.id && this.isAdjacentByFootprint(it, item))
        this.applyHasteToTargetItems(item, targets, Math.round(sec * 1000))
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

    for (const hit of due) {
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
      if (attacker && typeof hit.attackerDamageAtQueue === 'number') {
        const currentAttackerDamage = Math.max(0, attacker.baseStats.damage + attacker.runtime.tempDamageBonus)
        const delta = currentAttackerDamage - hit.attackerDamageAtQueue
        if (delta !== 0) {
          resolvedBaseDamage = Math.max(0, hit.baseDamage + delta)
          resolvedDamage = Math.max(0, hit.damage + delta)
        }
      }
      const targetHero = hit.side === 'player' ? this.enemyHero : this.playerHero
      if (targetHero.hp <= 0) continue
      const critRoll = Math.random() * 100
      const isCrit = critRoll < hit.crit
      const critMult = getConfig().combatRuntime.critMultiplier
      const panel = isCrit ? Math.round(resolvedDamage * critMult) : resolvedDamage

      let remaining = panel
      if (targetHero.shield > 0) {
        const blocked = Math.min(targetHero.shield, remaining)
        targetHero.shield -= blocked
        remaining -= blocked
      }
      if (remaining > 0) {
        targetHero.hp = Math.max(0, targetHero.hp - remaining)
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

      if (remaining > 0) {
        this.applyOnHeroDamagedReactions(targetHero.side)
        if (attacker) this.applyAdjacentAttackDamageGrowth(attacker)
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
      const line = this.skillLines(def).find((s) => /受到攻击伤害时获得\d+(?:\/\d+)*护盾/.test(s))
      if (!line) continue
      const amount = Math.round(this.tierValueFromLine(line, this.tierIndex(def, item.tier)))
      if (amount <= 0) continue
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
      let remaining = panel
      if (hero.shield > 0) {
        const blocked = Math.min(hero.shield, remaining)
        hero.shield -= blocked
        remaining -= blocked
      }
      if (remaining > 0) {
        hero.hp = Math.max(0, hero.hp - remaining)
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
  }

  private processStatusPeriodicByTick(): void {
    const cr = getConfig().combatRuntime
    const tickMs = Math.max(1, cr.tickMs)
    const burnTickEvery = Math.max(1, Math.round(Math.max(1, rv('burnTickMs', cr.burnTickMs)) / tickMs))
    const poisonTickEvery = Math.max(1, Math.round(Math.max(1, rv('poisonTickMs', cr.poisonTickMs)) / tickMs))
    const regenTickEvery = Math.max(1, Math.round(Math.max(1, rv('regenTickMs', cr.regenTickMs)) / tickMs))

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
  }

  private applyBurnTick(hero: HeroState): void {
    const layer = hero.burn
    if (layer <= 0 || hero.hp <= 0) return
    let hpDamage = layer
    const shieldFactor = Math.max(0, rv('burnShieldFactor', getConfig().combatRuntime.burnShieldFactor))
    if (hero.shield > 0) {
      const shieldCost = Math.min(hero.shield, Math.ceil(layer * shieldFactor))
      hero.shield -= shieldCost
      const protectedValue = shieldFactor > 0 ? shieldCost / shieldFactor : 0
      hpDamage = Math.max(0, Math.round(layer - protectedValue))
    }
    if (hpDamage > 0) {
      hero.hp = Math.max(0, hero.hp - hpDamage)
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
    hero.hp = Math.max(0, hero.hp - layer)
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

  private finishCombat(): void {
    if (this.finished) return
    this.finished = true
    this.phase = 'END'
    let winner: 'player' | 'enemy' | 'draw' = 'draw'
    if (this.playerHero.hp > 0 && this.enemyHero.hp <= 0) winner = 'player'
    if (this.enemyHero.hp > 0 && this.playerHero.hp <= 0) winner = 'enemy'
    this.result = { winner, ticks: this.tickIndex }
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
