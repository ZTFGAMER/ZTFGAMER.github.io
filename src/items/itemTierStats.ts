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

export function parseTierName(raw?: string): TierName {
  const text = raw ?? ''
  if (text.includes('Silver')) return 'Silver'
  if (text.includes('Gold')) return 'Gold'
  if (text.includes('Diamond')) return 'Diamond'
  return 'Bronze'
}

function parseTierStar(raw?: string): 1 | 2 {
  const m = (raw ?? '').match(/#(\d+)/)
  const n = Number(m?.[1] ?? '1')
  if (!Number.isFinite(n) || n <= 1) return 1
  return 2
}

function tierScore(tier: TierName, star: 1 | 2): number {
  if (tier === 'Bronze') return 1
  if (tier === 'Silver') return star === 2 ? 3 : 2
  if (tier === 'Gold') return star === 2 ? 5 : 4
  return star === 2 ? 7 : 6
}

function startTierScore(item: ItemDef): number {
  const start = parseTierName(item.starting_tier)
  if (start === 'Silver') return 2
  if (start === 'Gold') return 4
  if (start === 'Diamond') return 6
  return 1
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
  const tierIndex = Math.max(0, tierScore(tier, star) - startTierScore(item))
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
