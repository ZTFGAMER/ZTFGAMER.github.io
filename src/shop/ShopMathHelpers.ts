// ============================================================
// ShopMathHelpers — 商店场景纯工具函数（无 ctx 依赖）
// ============================================================

import type { ItemSizeNorm, GridSystem } from '@/common/grid/GridSystem'
import type { TierKey } from '@/shop/ShopManager'
import { TIER_ORDER, normalizeTierStar } from './systems/ShopSynthesisLogic'
import { getConfig } from '@/core/DataLoader'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { CELL_SIZE, CELL_HEIGHT, type GridZone } from '@/common/grid/GridZone'
import { CANVAS_W, BACKPACK_GAP_FROM_BATTLE } from '@/config/layoutConstants'
import type { ShopSceneCtx } from './ShopSceneContext'

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

// ── 坐标 / 布局计算 ───────────────────────────────────────────

export function getDayActiveCols(day: number): number {
  const slots = getConfig().dailyBattleSlots
  if (day <= 2) return slots[0] ?? 4
  if (day <= 4) return slots[1] ?? 5
  return slots[2] ?? 6
}

export function getShopItemScale(): number {
  return getDebugCfg('shopItemScale')
}

export function getBattleItemScale(ctx: ShopSceneCtx): number {
  return ctx.showingBackpack
    ? getDebugCfg('battleItemScaleBackpackOpen')
    : getDebugCfg('battleItemScale')
}

export function getBattleZoneX(activeCols: number, ctx: ShopSceneCtx): number {
  const s = getBattleItemScale(ctx)
  return getDebugCfg('battleZoneX') + (CANVAS_W - activeCols * CELL_SIZE * s) / 2
}

export function getBackpackZoneX(activeCols: number, ctx: ShopSceneCtx): number {
  const s = getBattleItemScale(ctx)
  return (CANVAS_W - activeCols * CELL_SIZE * s) / 2
}

export function getBackpackZoneYByBattle(ctx: ShopSceneCtx): number {
  const s = getBattleItemScale(ctx)
  return getDebugCfg('battleZoneY') + CELL_HEIGHT * s + BACKPACK_GAP_FROM_BATTLE + (CELL_HEIGHT * (1 - s)) / 2
}

// ── 格子放置检测（纯函数，不依赖 ctx）────────────────────────────

export function canPlaceInVisibleCols(
  system: GridSystem,
  view: GridZone,
  col: number,
  row: number,
  size: ItemSizeNorm,
): boolean {
  const { w, h } = system.getSizeDim(size)
  if (col < 0 || row < 0) return false
  if (col + w > view.activeColCount) return false
  if (row + h > system.rows) return false
  return system.canPlace(col, row, size)
}

export function hasAnyPlaceInVisibleCols(system: GridSystem, view: GridZone, size: ItemSizeNorm): boolean {
  const { w, h } = system.getSizeDim(size)
  const maxCol = view.activeColCount - w
  if (maxCol < 0) return false
  const maxRow = system.rows - h
  if (maxRow < 0) return false
  for (let r = 0; r <= maxRow; r++)
    for (let c = 0; c <= maxCol; c++)
      if (system.canPlace(c, r, size)) return true
  return false
}
