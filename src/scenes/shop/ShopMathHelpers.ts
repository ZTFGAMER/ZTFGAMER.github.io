// ============================================================
// ShopMathHelpers — 商店场景纯工具函数（无 ctx 依赖）
// ============================================================

import type { ItemSizeNorm } from '@/grid/GridSystem'
import type { TierKey } from '@/shop/ShopManager'
import { TIER_ORDER, normalizeTierStar } from './SynthesisLogic'

// ── 动画数学 ──────────────────────────────────────────────────

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

export function easeOutCubic(t: number): number {
  const p = clamp01(t)
  return 1 - Math.pow(1 - p, 3)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// ── 格子尺寸 ──────────────────────────────────────────────────

export function getSizeCols(size: ItemSizeNorm): number {
  if (size === '2x1') return 2
  if (size === '3x1') return 3
  return 1
}

export function getSizeCellDim(size: ItemSizeNorm): { w: number; h: number } {
  if (size === '1x1') return { w: 1, h: 1 }
  if (size === '2x1') return { w: 2, h: 1 }
  return { w: 3, h: 1 }
}

export function makeGridCellKey(col: number, row: number): string {
  return `${Math.round(col)},${Math.round(row)}`
}

// ── 品质 / Tier 比较 ──────────────────────────────────────────

export function compareTier(a: TierKey, b: TierKey): number {
  return TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b)
}

export function toVisualTier(tier?: TierKey, star?: 1 | 2): string | undefined {
  if (!tier) return undefined
  return `${tier}#${normalizeTierStar(tier, star)}`
}
