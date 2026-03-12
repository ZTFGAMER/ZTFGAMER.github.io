// ============================================================
// ShopGridInventory — 格子库存 CRUD 操作
// 提取自 ShopScene.ts Phase 8 Batch A
// 包含：格位查找、物品放置/升级/转化/移除、调度奖励
// ============================================================

import type { ShopSceneCtx } from '../ShopSceneContext'
import { GridSystem } from '@/common/grid/GridSystem'
import type { ItemSizeNorm, PlacedItem } from '@/common/grid/GridSystem'
import { GridZone } from '@/common/grid/GridZone'
import { normalizeSize, type ItemDef } from '@/common/items/ItemDef'
import type { TierKey } from '@/shop/ShopManager'
import {
  nextId,
  instanceToDefId,
  instanceToTier,
  instanceToPermanentDamageBonus,
  removeInstanceMeta,
  setInstanceQualityLevel,
  getInstanceQuality,
  getInstanceLevel,
  getInstanceTierStar,
  levelFromLegacyTierStar,
} from './ShopInstanceRegistry'
import {
  parseTierName,
  isNeutralItemDef,
  getItemDefById,
  tierStarLevelIndex,
} from './ShopSynthesisLogic'
import { clampLevel, getQualityLevelRange } from '../ui/PlayerStatusUI'
import { levelToTierStar } from './QuickBuySystem'
import { playTransformOrUpgradeFlashEffect } from '../ui/ShopAnimationEffects'
import { pickCrossIdEvolveCandidates } from '../panels/SynthesisPanel'
import { canPlaceInVisibleCols, toVisualTier } from '../ShopMathHelpers'
import type { PoolCandidate } from './QuickBuySystem'

// ---- 公共类型 ----

export type OwnedPlacedItem = { item: PlacedItem; zone: 'battle' | 'backpack' }

/** 需要回调到 ShopScene.ts 的跨模块依赖 */
export type GridInventoryCallbacks = {
  recordNeutralItemObtained: (defId: string) => void
  unlockItemToPool: (defId: string) => boolean
  collectPoolCandidatesByLevel: (level: 1 | 2 | 3 | 4 | 5 | 6 | 7) => PoolCandidate[]
}

// ---- 格位查找 ----

export function findFirstBackpackPlace(size: ItemSizeNorm, ctx: ShopSceneCtx): { col: number; row: number } | null {
  if (!ctx.backpackSystem || !ctx.backpackView) return null
  for (let row = 0; row < ctx.backpackSystem.rows; row++) {
    for (let col = 0; col < ctx.backpackView.activeColCount; col++) {
      const finalRow = row
      if (canPlaceInVisibleCols(ctx.backpackSystem, ctx.backpackView, col, finalRow, size)) {
        return { col, row: finalRow }
      }
    }
  }
  return null
}

export function findFirstBattlePlace(size: ItemSizeNorm, ctx: ShopSceneCtx): { col: number; row: number } | null {
  if (!ctx.battleSystem || !ctx.battleView) return null
  for (let row = 0; row < ctx.battleSystem.rows; row++) {
    for (let col = 0; col < ctx.battleView.activeColCount; col++) {
      if (canPlaceInVisibleCols(ctx.battleSystem, ctx.battleView, col, row, size)) {
        return { col, row }
      }
    }
  }
  return null
}

// ---- 物品集合 ----

export function getAllOwnedPlacedItems(ctx: ShopSceneCtx): OwnedPlacedItem[] {
  const out: OwnedPlacedItem[] = []
  if (ctx.battleSystem) {
    for (const it of ctx.battleSystem.getAllItems()) out.push({ item: it, zone: 'battle' })
  }
  if (ctx.backpackSystem) {
    for (const it of ctx.backpackSystem.getAllItems()) out.push({ item: it, zone: 'backpack' })
  }
  return out
}

export function pickRandomElements<T>(list: T[], count: number): T[] {
  const arr = [...list]
  const out: T[] = []
  while (out.length < count && arr.length > 0) {
    const idx = Math.floor(Math.random() * arr.length)
    const picked = arr[idx]
    if (picked !== undefined) out.push(picked)
    arr.splice(idx, 1)
  }
  return out
}

// ---- 物品移除 ----

export function removePlacedItemById(instanceId: string, zone: 'battle' | 'backpack', ctx: ShopSceneCtx): void {
  const system = zone === 'battle' ? ctx.battleSystem : ctx.backpackSystem
  const view = zone === 'battle' ? ctx.battleView : ctx.backpackView
  if (!system || !view) return
  system.remove(instanceId)
  view.removeItem(instanceId)
  removeInstanceMeta(instanceId)
}

// ---- 物品放置 ----

export function placeItemToInventoryOrBattle(
  def: ItemDef,
  tier: TierKey,
  star: 1 | 2,
  ctx: ShopSceneCtx,
  callbacks: GridInventoryCallbacks,
): boolean {
  if (!ctx.battleSystem || !ctx.battleView || !ctx.backpackSystem || !ctx.backpackView) return false
  const size = normalizeSize(def.size)
  const battleSlot = findFirstBattlePlace(size, ctx)
  const backpackSlot = battleSlot ? null : findFirstBackpackPlace(size, ctx)
  if (!battleSlot && !backpackSlot) return false

  const id = nextId()
  const visualTier = toVisualTier(tier, star)
  if (battleSlot) {
    ctx.battleSystem.place(battleSlot.col, battleSlot.row, size, def.id, id)
    void ctx.battleView.addItem(id, def.id, size, battleSlot.col, battleSlot.row, visualTier).then(() => {
      ctx.battleView!.setItemTier(id, visualTier)
      ctx.drag?.refreshZone(ctx.battleView!)
    })
  } else if (backpackSlot) {
    ctx.backpackSystem.place(backpackSlot.col, backpackSlot.row, size, def.id, id)
    void ctx.backpackView.addItem(id, def.id, size, backpackSlot.col, backpackSlot.row, visualTier).then(() => {
      ctx.backpackView!.setItemTier(id, visualTier)
      ctx.drag?.refreshZone(ctx.backpackView!)
    })
  }
  instanceToDefId.set(id, def.id)
  setInstanceQualityLevel(id, def.id, parseTierName(def.starting_tier) ?? 'Bronze', levelFromLegacyTierStar(tier, star))
  instanceToPermanentDamageBonus.set(id, 0)
  callbacks.recordNeutralItemObtained(def.id)
  callbacks.unlockItemToPool(def.id)
  return true
}

// ---- 物品升级 / 转化 ----

export function upgradePlacedItem(
  instanceId: string,
  zone: 'battle' | 'backpack',
  withFx: boolean,
  ctx: ShopSceneCtx,
): boolean {
  const system = zone === 'battle' ? ctx.battleSystem : ctx.backpackSystem
  const view = zone === 'battle' ? ctx.battleView : ctx.backpackView
  if (!system || !view) return false
  const placed = system.getItem(instanceId)
  if (!placed) return false
  const level = getInstanceLevel(instanceId)
  const quality = getInstanceQuality(instanceId)
  const range = getQualityLevelRange(quality)
  if (level >= range.max) return false
  const nextLevel = clampLevel(level + 1)
  const next = levelToTierStar(nextLevel)
  if (!next) return false
  const defId = instanceToDefId.get(instanceId)
  if (!defId) return false

  system.remove(instanceId)
  if (!system.place(placed.col, placed.row, placed.size, defId, instanceId)) {
    system.place(placed.col, placed.row, placed.size, placed.defId, instanceId)
    return false
  }
  view.removeItem(instanceId)
  void view.addItem(instanceId, defId, placed.size, placed.col, placed.row, toVisualTier(next.tier, next.star)).then(() => {
    view.setItemTier(instanceId, toVisualTier(next.tier, next.star))
    ctx.drag?.refreshZone(view)
  })
  setInstanceQualityLevel(instanceId, defId, quality, nextLevel)
  if (withFx) playTransformOrUpgradeFlashEffect(ctx, instanceId, zone)
  return true
}

export function convertAndUpgradePlacedItem(
  instanceId: string,
  zone: 'battle' | 'backpack',
  withFx: boolean,
  ctx: ShopSceneCtx,
  callbacks: GridInventoryCallbacks,
): boolean {
  const system = zone === 'battle' ? ctx.battleSystem : ctx.backpackSystem
  const view = zone === 'battle' ? ctx.battleView : ctx.backpackView
  if (!system || !view) return false
  const placed = system.getItem(instanceId)
  if (!placed) return false
  const level = getInstanceLevel(instanceId)
  const quality = getInstanceQuality(instanceId)
  const range = getQualityLevelRange(quality)
  if (level >= range.max) return false
  const nextLevel = clampLevel(level + 1)
  const next = levelToTierStar(nextLevel)
  if (!next) return false
  const sourceDef = getItemDefById(placed.defId)
  if (!sourceDef) return false
  if (isNeutralItemDef(sourceDef)) return false
  const candidates = pickCrossIdEvolveCandidates(sourceDef, placed.size, next.tier, 'Bronze')
  if (candidates.length <= 0) return false
  const picked = candidates[Math.floor(Math.random() * candidates.length)]
  if (!picked) return false

  system.remove(instanceId)
  if (!system.place(placed.col, placed.row, placed.size, picked.id, instanceId)) {
    system.place(placed.col, placed.row, placed.size, placed.defId, instanceId)
    return false
  }
  view.removeItem(instanceId)
  void view.addItem(instanceId, picked.id, placed.size, placed.col, placed.row, toVisualTier(next.tier, next.star)).then(() => {
    view.setItemTier(instanceId, toVisualTier(next.tier, next.star))
    ctx.drag?.refreshZone(view)
  })
  instanceToDefId.set(instanceId, picked.id)
  setInstanceQualityLevel(instanceId, picked.id, parseTierName(picked.starting_tier) ?? 'Bronze', nextLevel)
  callbacks.unlockItemToPool(picked.id)
  if (withFx) playTransformOrUpgradeFlashEffect(ctx, instanceId, zone)
  return true
}

export function canUpgradePlacedItem(instanceId: string, zone: 'battle' | 'backpack', ctx: ShopSceneCtx): boolean {
  const system = zone === 'battle' ? ctx.battleSystem : ctx.backpackSystem
  if (!system) return false
  const placed = system.getItem(instanceId)
  if (!placed) return false
  const def = getItemDefById(placed.defId)
  if (!def || isNeutralItemDef(def)) return false
  const quality = getInstanceQuality(instanceId)
  const level = getInstanceLevel(instanceId)
  const range = getQualityLevelRange(quality)
  return level < range.max
}

export function canConvertAndUpgradePlacedItem(instanceId: string, zone: 'battle' | 'backpack', ctx: ShopSceneCtx): boolean {
  const system = zone === 'battle' ? ctx.battleSystem : ctx.backpackSystem
  if (!system) return false
  const placed = system.getItem(instanceId)
  if (!placed) return false
  const quality = getInstanceQuality(instanceId)
  const level = getInstanceLevel(instanceId)
  const range = getQualityLevelRange(quality)
  if (level >= range.max) return false
  const nextLevel = clampLevel(level + 1)
  const next = levelToTierStar(nextLevel)
  if (!next) return false
  const sourceDef = getItemDefById(placed.defId)
  if (!sourceDef) return false
  if (isNeutralItemDef(sourceDef)) return false
  const candidates = pickCrossIdEvolveCandidates(sourceDef, placed.size, next.tier, 'Bronze')
  return candidates.length > 0
}

export function collectUpgradeableOwnedPlacedItems(zone: 'battle' | 'backpack' | undefined, ctx: ShopSceneCtx): OwnedPlacedItem[] {
  return getAllOwnedPlacedItems(ctx).filter((it) => {
    if (zone && it.zone !== zone) return false
    return canUpgradePlacedItem(it.item.instanceId, it.zone, ctx)
  })
}

// ---- 调度奖励 ----

export function schedulePendingGold(day: number, amount: number, ctx: ShopSceneCtx): void {
  const d = Math.max(1, Math.round(day))
  const a = Math.max(0, Math.round(amount))
  if (d <= 0 || a <= 0) return
  ctx.pendingGoldByDay.set(d, (ctx.pendingGoldByDay.get(d) ?? 0) + a)
}

export function schedulePendingBattleUpgrade(day: number, count: number, ctx: ShopSceneCtx): void {
  const d = Math.max(1, Math.round(day))
  const c = Math.max(0, Math.round(count))
  if (d <= 0 || c <= 0) return
  ctx.pendingBattleUpgradeByDay.set(d, (ctx.pendingBattleUpgradeByDay.get(d) ?? 0) + c)
}

// ---- 原地转化（保持等级）----

export function convertPlacedItemKeepLevel(
  instanceId: string,
  zone: 'battle' | 'backpack',
  withFx: boolean,
  ctx: ShopSceneCtx,
  callbacks: GridInventoryCallbacks,
): boolean {
  const system = zone === 'battle' ? ctx.battleSystem : ctx.backpackSystem
  const view = zone === 'battle' ? ctx.battleView : ctx.backpackView
  if (!system || !view) return false
  const placed = system.getItem(instanceId)
  if (!placed) return false
  const level = getInstanceLevel(instanceId)
  const legacy = levelToTierStar(level)
  const tier = legacy?.tier ?? 'Bronze'
  const star = legacy?.star ?? 1
  const candidates = callbacks.collectPoolCandidatesByLevel(level as 1 | 2 | 3 | 4 | 5 | 6 | 7)
    .filter((c) => normalizeSize(c.item.size) === placed.size)
    .map((c) => c.item)
    .filter((it) => it.id !== placed.defId)
  const picked = candidates[Math.floor(Math.random() * candidates.length)]
  if (!picked) return false

  system.remove(instanceId)
  if (!system.place(placed.col, placed.row, placed.size, picked.id, instanceId)) {
    system.place(placed.col, placed.row, placed.size, placed.defId, instanceId)
    return false
  }
  view.removeItem(instanceId)
  void view.addItem(instanceId, picked.id, placed.size, placed.col, placed.row, toVisualTier(tier, star)).then(() => {
    view.setItemTier(instanceId, toVisualTier(tier, star))
    ctx.drag?.refreshZone(view)
  })
  instanceToDefId.set(instanceId, picked.id)
  setInstanceQualityLevel(instanceId, picked.id, parseTierName(picked.starting_tier) ?? 'Bronze', level)
  callbacks.unlockItemToPool(picked.id)
  if (withFx) playTransformOrUpgradeFlashEffect(ctx, instanceId, zone)
  return true
}

export function upgradeLowestLevelItemsOnce(ctx: ShopSceneCtx): number {
  const all = collectUpgradeableOwnedPlacedItems(undefined, ctx)
  if (all.length <= 0) return 0
  let minLevel = Number.POSITIVE_INFINITY
  for (const one of all) {
    minLevel = Math.min(minLevel, getInstanceLevel(one.item.instanceId))
  }
  let changed = 0
  for (const one of all) {
    const lv = getInstanceLevel(one.item.instanceId)
    if (lv !== minLevel) continue
    if (upgradePlacedItem(one.item.instanceId, one.zone, true, ctx)) changed += 1
  }
  return changed
}

export function convertHighestLevelItemsOnce(ctx: ShopSceneCtx, callbacks: GridInventoryCallbacks): number {
  const all = getAllOwnedPlacedItems(ctx)
  if (all.length <= 0) return 0
  let maxLevel = 0
  for (const one of all) {
    const tier = instanceToTier.get(one.item.instanceId) ?? 'Bronze'
    const star = getInstanceTierStar(one.item.instanceId)
    maxLevel = Math.max(maxLevel, tierStarLevelIndex(tier, star) + 1)
  }
  let changed = 0
  for (const one of all) {
    const tier = instanceToTier.get(one.item.instanceId) ?? 'Bronze'
    const star = getInstanceTierStar(one.item.instanceId)
    const lv = tierStarLevelIndex(tier, star) + 1
    if (lv !== maxLevel) continue
    if (convertPlacedItemKeepLevel(one.item.instanceId, one.zone, true, ctx, callbacks)) changed += 1
  }
  return changed
}

// ---- 拖拽回位（供 ShopDragController 使用）----

export function restoreDraggedItemToZone(
  instanceId: string,
  defId: string,
  size: ItemSizeNorm,
  tier: TierKey,
  star: 1 | 2,
  originCol: number,
  originRow: number,
  homeSystem: GridSystem,
  homeView: GridZone,
  ctx: ShopSceneCtx,
): void {
  if (!homeSystem.getItem(instanceId)) {
    let placed = false
    if (homeSystem.canPlace(originCol, originRow, size)) {
      placed = homeSystem.place(originCol, originRow, size, defId, instanceId)
    }
    if (!placed) {
      for (let col = 0; col < homeView.activeColCount && !placed; col++) {
        for (let row = 0; row < homeSystem.rows && !placed; row++) {
          if (!homeSystem.canPlace(col, row, size)) continue
          placed = homeSystem.place(col, row, size, defId, instanceId)
          if (placed) {
            originCol = col
            originRow = row
          }
        }
      }
    }
    if (!placed) return
  }
  void homeView.addItem(instanceId, defId, size, originCol, originRow, toVisualTier(tier, star)).then(() => {
    homeView.setItemTier(instanceId, toVisualTier(tier, star))
    ctx.drag?.refreshZone(homeView)
  })
}
