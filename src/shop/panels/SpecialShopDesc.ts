// ============================================================
// SpecialShopDesc — 特殊商店物品描述格式化工具（无 ctx 依赖）
// ============================================================

import type { ItemDef } from '@/common/items/ItemDef'
import { getAllItems } from '@/core/DataLoader'
import type { TierKey } from '@/shop/ShopManager'
import { GridZone } from '@/common/grid/GridZone'
import { parseTierName, tierStarLevelIndex } from '../systems/ShopSynthesisLogic'

// ── 品质解析 ──────────────────────────────────────────────────

export function parseAvailableTiers(raw: string): TierKey[] {
  const s = (raw || '').trim()
  if (!s) return ['Bronze', 'Silver', 'Gold', 'Diamond']
  const out = s
    .split('/')
    .map((v) => parseTierName(v.trim()))
    .filter((v): v is TierKey => !!v)
  return out.length > 0 ? out : ['Bronze', 'Silver', 'Gold', 'Diamond']
}

// ── 速度文字 ──────────────────────────────────────────────────

export function getSpecialShopSpeedTierText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '无'
  if (ms <= 600) return '极快'
  if (ms <= 1000) return '很快'
  if (ms <= 1500) return '快'
  if (ms <= 2500) return '中等'
  if (ms <= 4000) return '慢'
  return '很慢'
}

// ── Tier/星级文本替换 ─────────────────────────────────────────

export function resolveTierSeriesTextByStar(item: ItemDef, tier: TierKey, star: 1 | 2, series: string): string {
  const parts = series.split(/[\/|]/).map((v) => v.trim()).filter(Boolean)
  if (parts.length <= 0) return series
  const tiers = parseAvailableTiers(item.available_tiers)
  const base = Math.max(0, tiers.indexOf(tier))
  const idx = Math.max(0, Math.min(parts.length - 1, base + (star - 1)))
  const resolved = parts[idx] ?? series
  const trimmed = String(series).trim()
  if (/^[+\-]/.test(trimmed) && !/^[+\-]/.test(resolved)) {
    const sign = trimmed.startsWith('-') ? '-' : '+'
    return `${sign}${resolved}`
  }
  return resolved
}

export function resolveSkillLineByTierStar(item: ItemDef, tier: TierKey, star: 1 | 2, line: string): string {
  return line.replace(/([+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)+)/g, (raw) => resolveTierSeriesTextByStar(item, tier, star, raw))
}

// ── 描述文本生成 ──────────────────────────────────────────────

export function getSpecialShopSimpleDesc(item: ItemDef, tier: TierKey, star: 1 | 2): string {
  const fromSimple = String(item.simple_desc ?? '').trim()
  if (fromSimple) return fromSimple
  const fromTiered = String(item.simple_desc_tiered ?? '').trim()
  if (fromTiered) {
    const parts = fromTiered.split('|').map((v) => v.trim()).filter(Boolean)
    if (parts.length > 0) {
      const levelIdx = Math.max(0, Math.min(parts.length - 1, tierStarLevelIndex(tier, star)))
      return parts[levelIdx] ?? parts[0]!
    }
  }
  const first = (item.skills ?? []).map((s) => String(s.cn ?? '').trim()).find(Boolean)
  if (!first) return '(暂无描述)'
  return resolveSkillLineByTierStar(item, tier, star, first)
}

export function getSpecialShopDetailDesc(item: ItemDef, tier: TierKey, star: 1 | 2): string {
  const fromTiered = String(item.simple_desc_tiered ?? '').trim()
  if (fromTiered) return resolveSkillLineByTierStar(item, tier, star, fromTiered)
  const fromSimple = String(item.simple_desc ?? '').trim()
  if (fromSimple) return fromSimple
  return getSpecialShopSimpleDesc(item, tier, star)
}

// ── 数值提取工具 ──────────────────────────────────────────────

export function pickTierSeriesValueByTier(series: string, tier: TierKey, availableTiersRaw: string): number {
  const parts = series.split(/[\/|]/).map((v) => v.trim()).filter(Boolean)
  if (parts.length === 0) return 0
  const tiers = parseAvailableTiers(availableTiersRaw)
  const tierIdx = Math.max(0, tiers.indexOf(tier))
  const idx = Math.max(0, Math.min(parts.length - 1, tierIdx))
  const n = Number(parts[idx])
  return Number.isFinite(n) ? n : 0
}

export function tierValueFromSkillLine(item: ReturnType<typeof getAllItems>[number], tier: TierKey, line: string): number {
  const m = line.match(/(\d+(?:\.\d+)?(?:[\/|]\d+(?:\.\d+)?)+)/)
  if (!m?.[1]) return 0
  return pickTierSeriesValueByTier(m[1], tier, item.available_tiers)
}

export function ammoValueFromLineByStar(item: ReturnType<typeof getAllItems>[number], tier: TierKey, star: 1 | 2, line: string): number {
  const m = line.match(/弹药\s*[:：]\s*(\d+(?:[\/|]\d+)*)/)
  if (!m?.[1]) return 0
  const parts = m[1].split(/[\/|]/).map((v) => v.trim()).filter(Boolean)
  if (parts.length === 0) return 0
  const tiers = parseAvailableTiers(item.available_tiers)
  const base = Math.max(0, tiers.indexOf(tier))
  const idx = Math.max(0, Math.min(parts.length - 1, base + (star - 1)))
  const n = Number(parts[idx])
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
}

// ── GridZone 弹药显示 ─────────────────────────────────────────

export function setZoneItemAmmo(view: GridZone, instanceId: string, current: number, max: number): void {
  const v = view as GridZone & { setItemAmmo?: (id: string, c: number, m: number) => void }
  v.setItemAmmo?.(instanceId, current, max)
}

// ── 攻击物品判断 ──────────────────────────────────────────────

export function isAttackItemForBattle(item: ReturnType<typeof getAllItems>[number]): boolean {
  if (item.damage > 0) return true
  const lines = (item.skills ?? []).map((s) => s.cn ?? '')
  return lines.some((line) => /攻击造成|掷出造成|最大生命值.*%.*伤害|等同于当前自身护盾值/.test(line))
}
