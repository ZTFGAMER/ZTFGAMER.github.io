import type { ItemDef } from '@/items/ItemDef'

export type TierName = 'Bronze' | 'Silver' | 'Gold' | 'Diamond'

export interface ItemTierBaseStats {
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

const TIER_ORDER: TierName[] = ['Bronze', 'Silver', 'Gold', 'Diamond']

export function parseTierName(raw?: string): TierName {
  const text = raw ?? ''
  if (text.includes('Silver')) return 'Silver'
  if (text.includes('Gold')) return 'Gold'
  if (text.includes('Diamond')) return 'Diamond'
  return 'Bronze'
}

function parseAvailableTiers(raw: string): TierName[] {
  const s = (raw || '').trim()
  if (!s) return [...TIER_ORDER]
  const out = s
    .split('/')
    .map((v) => parseTierName(v.trim()))
    .filter((v, idx, arr) => arr.indexOf(v) === idx)
  return out.length > 0 ? out : [...TIER_ORDER]
}

function parseTierStar(raw?: string): 1 | 2 {
  const m = (raw ?? '').match(/#(\d+)/)
  const n = Number(m?.[1] ?? '1')
  if (!Number.isFinite(n) || n <= 1) return 1
  return 2
}

function pickTierSeriesValue(series: string, tierIndex: number): number {
  const parts = series.split(/[\/|]/).map((v) => v.trim()).filter(Boolean)
  if (parts.length === 0) return 0
  const idx = Math.max(0, Math.min(parts.length - 1, tierIndex))
  const n = Number(parts[idx])
  return Number.isFinite(n) ? n : 0
}

function extractTierSeriesValue(text: string, regex: RegExp, tierIndex: number): number | null {
  const hit = text.match(regex)
  const series = hit?.[1]?.trim()
  if (!series) return null
  const v = pickTierSeriesValue(series, tierIndex)
  return Number.isFinite(v) ? v : null
}

function parseCooldownMsByTier(item: ItemDef, tierIndex: number): number {
  const rawTier = (item.cooldown_tiers ?? '').trim()
  if (rawTier && rawTier !== '无') {
    const v = pickTierSeriesValue(rawTier, tierIndex)
    if (Number.isFinite(v) && v > 0) return v
  }
  const fallback = Number(item.cooldown)
  return Number.isFinite(fallback) ? Math.max(0, fallback) : 0
}

export function resolveItemTierBaseStats(item: ItemDef, tierRaw?: string): ItemTierBaseStats {
  const tier = parseTierName(tierRaw)
  const star = parseTierStar(tierRaw)
  const available = parseAvailableTiers(item.available_tiers)
  const idxRaw = available.indexOf(tier)
  const tierIndexBase = idxRaw >= 0 ? idxRaw : 0
  const tierIndex = tierIndexBase + (star - 1)
  const skillText = (item.skills ?? []).map((s) => s.cn ?? '').join('\n')

  const damage = extractTierSeriesValue(skillText, /造成\s*([0-9]+(?:[\/|][0-9]+)*)\s*伤害/, tierIndex)
  const heal = extractTierSeriesValue(skillText, /(?:治疗|回复)\s*([0-9]+(?:[\/|][0-9]+)*)/, tierIndex)
  const shield = extractTierSeriesValue(skillText, /(?:获得|提供)\s*([0-9]+(?:[\/|][0-9]+)*)\s*护盾/, tierIndex)
  const burn = extractTierSeriesValue(skillText, /(?:造成|附加|获得)?\s*([0-9]+(?:[\/|][0-9]+)*)\s*灼烧/, tierIndex)
  const poison = extractTierSeriesValue(skillText, /(?:造成|附加|获得)?\s*([0-9]+(?:[\/|][0-9]+)*)\s*(?:剧毒|中毒)/, tierIndex)
  const regen = extractTierSeriesValue(skillText, /(?:获得|提供)\s*([0-9]+(?:[\/|][0-9]+)*)\s*(?:再生|生命回复)/, tierIndex)
  const multicast = extractTierSeriesValue(skillText, /(?:触发|连续发射|连发(?:次数)?\s*[:：]?)\s*([0-9]+(?:[\/|][0-9]+)*)\s*次?/, tierIndex)

  return {
    cooldownMs: parseCooldownMsByTier(item, tierIndex),
    damage: Math.max(0, damage ?? item.damage ?? 0),
    heal: Math.max(0, heal ?? item.heal ?? 0),
    shield: Math.max(0, shield ?? item.shield ?? 0),
    burn: Math.max(0, burn ?? item.burn ?? 0),
    poison: Math.max(0, poison ?? item.poison ?? 0),
    regen: Math.max(0, regen ?? item.regen ?? 0),
    crit: Math.max(0, item.crit ?? 0),
    multicast: Math.max(1, Math.round(multicast ?? item.multicast ?? 1)),
  }
}
