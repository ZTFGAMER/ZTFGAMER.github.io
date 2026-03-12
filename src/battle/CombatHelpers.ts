// ============================================================
// CombatHelpers — 战斗引擎工具函数、常量、运行时覆盖
// ============================================================

import type { ItemDef, SkillArchetype } from '@/common/items/ItemDef'
import { getAllItems, getConfig } from '@/core/DataLoader'
import { BRONZE_SKILL_PICKS } from '@/common/skills/BronzeSkillConfig'
import { SILVER_SKILL_PICKS } from '@/common/skills/SilverSkillConfig'
import { GOLD_SKILL_PICKS } from '@/common/skills/GoldSkillConfig'
import type {
  DraftSkillLite, SkillTierLite, ControlSpec, ControlStatus,
  EnemyTier, EnemyStar, CombatRuntimeOverride,
} from './CombatTypes'

// ── 常量 ────────────────────────────────────────────────────
export const DEBUG_SHIELD_CHARGE = false
export const HERO_MAX_HP_CAP = 999999
export const HERO_SHIELD_CAP = 999999
export const ITEM_DAMAGE_CAP = 999999
export const FALLBACK_CD_MS = 3000
export const MIN_REDUCED_CD_MS = 100

// ── Tier 解析工具 ────────────────────────────────────────────
export function parseTierName(raw: string): string {
  if (raw.includes('Bronze')) return 'Bronze'
  if (raw.includes('Silver')) return 'Silver'
  if (raw.includes('Gold')) return 'Gold'
  if (raw.includes('Diamond')) return 'Diamond'
  return ''
}

export function parseAvailableTiers(raw: string): string[] {
  const s = (raw || '').trim()
  if (!s) return ['Bronze', 'Silver', 'Gold', 'Diamond']
  const out = s
    .split('/')
    .map((v) => parseTierName(v.trim()))
    .filter((v): v is string => Boolean(v))
  return out.length > 0 ? out : ['Bronze', 'Silver', 'Gold', 'Diamond']
}

export function parseTierStar(raw: string): 1 | 2 {
  const m = raw.match(/#(\d+)/)
  const n = Number(m?.[1] ?? '1')
  if (!Number.isFinite(n) || n <= 1) return 1
  return 2
}

export function tierScoreFromRaw(raw: string): number {
  const tier = parseTierName(raw)
  const star = parseTierStar(raw)
  if (tier === 'Bronze') return 1
  if (tier === 'Silver') return star === 2 ? 3 : 2
  if (tier === 'Gold') return star === 2 ? 5 : 4
  return star === 2 ? 7 : 6
}

export function startTierScore(def: ItemDef | null): number {
  if (!def) return 1
  const tier = parseTierName(def.starting_tier || 'Bronze')
  if (tier === 'Silver') return 2
  if (tier === 'Gold') return 4
  if (tier === 'Diamond') return 6
  return 1
}

export function tierIndexFromRaw(def: ItemDef | null, tierRaw: string): number {
  if (!def) return 0
  const score = tierScoreFromRaw(tierRaw)
  const start = startTierScore(def)
  return Math.max(0, score - start)
}

export function ammoFromSkillLines(lines: string[], tierIndex: number): number {
  for (const line of lines) {
    const m = line.match(/弹药\s*[:：]\s*(\+?\d+(?:[\/|]\+?\d+)*)/)
    if (!m?.[1]) continue
    const v = Math.round(pickTierSeriesValue(m[1], tierIndex))
    if (v > 0) return v
  }
  return 0
}

export function multicastFromSkillLines(lines: string[], tierIndex: number, fallback: number): number {
  for (const line of lines) {
    const m = line.match(/(?:连续发射|触发)\s*(\+?\d+(?:[\/|]\+?\d+)*)\s*次/)
    if (!m?.[1]) continue
    const v = Math.round(pickTierSeriesValue(m[1], tierIndex))
    if (v > 0) return v
  }
  return fallback
}

export function pickTierSeriesValue(series: string, tierIndex: number): number {
  const parts = series.split(/[\/|]/).map((v) => v.trim()).filter(Boolean)
  if (parts.length === 0) return 0
  const idx = Math.max(0, Math.min(parts.length - 1, tierIndex))
  const n = Number((parts[idx] ?? '').replace(/^\+/, '').replace(/%$/u, ''))
  return Number.isFinite(n) ? n : 0
}

export function tierStarToRaw(tier: EnemyTier, star: EnemyStar): string {
  return `${tier}#${star}`
}

export function qualityScoreToTierStar(score: number): { tier: EnemyTier; star: EnemyStar } {
  const s = Math.max(1, Math.min(7, Math.round(score)))
  if (s >= 7) return { tier: 'Diamond', star: 2 }
  if (s >= 6) return { tier: 'Diamond', star: 1 }
  if (s >= 5) return { tier: 'Gold', star: 2 }
  if (s >= 4) return { tier: 'Gold', star: 1 }
  if (s >= 3) return { tier: 'Silver', star: 2 }
  if (s >= 2) return { tier: 'Silver', star: 1 }
  return { tier: 'Bronze', star: 1 }
}

export function dailyCurveValue(values: number[] | undefined, day: number, fallback: number): number {
  if (!Array.isArray(values) || values.length === 0) return fallback
  const idx = Math.max(0, Math.min(values.length - 1, Math.floor(day) - 1))
  const v = Number(values[idx])
  return Number.isFinite(v) ? v : fallback
}

export function buildQualityScores(itemCount: number, targetAvg: number): number[] {
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

export function makeSeededRng(seed: number): () => number {
  let s = (seed | 0) ^ 0x9e3779b9
  if (s === 0) s = 0x6d2b79f5
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 1000000) / 1000000
  }
}

export function getPrimaryArchetypeTag(rawTags: string): string {
  const first = String(rawTags || '')
    .split('|')[0]?.trim() ?? ''
  const simple = first.split('/')[0]?.trim() ?? ''
  return simple
}

export function normalizeSkillArchetype(raw: string): SkillArchetype | null {
  const s = `${raw}`.trim()
  if (s === 'warrior' || s === '战士') return 'warrior'
  if (s === 'archer' || s === '弓手') return 'archer'
  if (s === 'assassin' || s === '刺客') return 'assassin'
  if (s === 'utility' || s === '通用') return 'utility'
  return null
}

export const ALL_DRAFT_SKILLS: DraftSkillLite[] = [
  ...BRONZE_SKILL_PICKS,
  ...SILVER_SKILL_PICKS,
  ...GOLD_SKILL_PICKS,
].map((it) => ({
  id: it.id,
  archetype: it.archetype,
  tier: it.tier as SkillTierLite,
}))

// ── 运行时覆盖（Debug/测试用）────────────────────────────────
let runtimeOverride: CombatRuntimeOverride = {}

export function setCombatRuntimeOverride(next: CombatRuntimeOverride): void {
  runtimeOverride = { ...next }
}

export function rv<K extends keyof CombatRuntimeOverride>(key: K, fallback: number): number {
  const v = runtimeOverride[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

export function rvBool<K extends keyof CombatRuntimeOverride>(key: K, fallback: boolean): boolean {
  const v = runtimeOverride[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v >= 0.5
  return fallback
}

export function parseControlSpecsFromDef(def: ItemDef, cr: ReturnType<typeof getConfig>['combatRuntime']): ControlSpec[] {
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

// ── 从 CombatEngine 类提取的纯工具函数 ───────────────────────

export function findItemDef(defId: string): ItemDef | null {
  return getAllItems().find((it) => it.id === defId) ?? null
}

export function isNeutralItemDef(def: ItemDef): boolean {
  const tag = getPrimaryArchetypeTag(def.tags)
  return tag === '中立' || tag.toLowerCase() === 'neutral'
}

export function validCooldown(cd: number): number {
  if (!Number.isFinite(cd)) return FALLBACK_CD_MS
  if (cd <= 0) return 0
  return Math.round(cd)
}

export function skillLines(def: ItemDef | null): string[] {
  if (!def) return []
  return (def.skills ?? []).map((s) => s.cn?.trim() ?? '').filter(Boolean)
}

export function tierValueFromLine(line: string | undefined, tierIndex: number): number {
  if (!line) return 0
  const m = line.match(/([+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*)/)
  if (!m?.[1]) return 0
  return pickTierSeriesValue(m[1], tierIndex)
}

// ── CombatItemRunner 纯判断工具（无状态，可被多个 System 共用）────

import type { CombatItemRunner } from './CombatTypes'
import type { ItemSizeNorm } from '@/common/items/ItemDef'

export function itemWidth(size: ItemSizeNorm): number {
  if (size === '3x1') return 3
  if (size === '2x1') return 2
  return 1
}

export function isAdjacentByFootprint(a: CombatItemRunner, b: CombatItemRunner): boolean {
  const aEnd = a.col + itemWidth(a.size) - 1
  const bEnd = b.col + itemWidth(b.size) - 1
  return a.col === bEnd + 1 || b.col === aEnd + 1
}

export function isShieldItem(item: CombatItemRunner): boolean {
  return item.baseStats.shield > 0
}

export function isAmmoItem(item: CombatItemRunner): boolean {
  return item.runtime.ammoMax > 0
}

export function isDamageBonusEligible(item: CombatItemRunner): boolean {
  return item.baseStats.damage > 0 && !isShieldItem(item)
}

export function isWeaponItem(item: CombatItemRunner): boolean {
  return isDamageBonusEligible(item)
}

export function itemArchetype(def: ItemDef | null): string {
  return getPrimaryArchetypeTag(def?.tags ?? '')
}

export function hasLine(def: ItemDef | null, regex: RegExp): boolean {
  return skillLines(def).some((s) => regex.test(s))
}

export function isItemDestroyImmune(item: CombatItemRunner): boolean {
  return skillLines(findItemDef(item.defId)).some((s) => /无敌|不可摧毁/.test(s))
}

// ── 确定性随机工具（纯函数，CombatEngine / ItemTriggerSystem 共用）────

export function seedFrom(key: string, salt: number): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function shuffleDeterministic<T>(arr: T[], seed: number): T[] {
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
