// ============================================================
// ShopInstanceManager — 实例等级/品阶视觉同步与解锁池管理
// 提取自 ShopScene.ts Phase 8
// ============================================================

import type { ShopSceneCtx } from '../ShopSceneContext'
import type { TierKey } from '@/shop/ShopManager'
import { isRunClassItemPoolAllowed } from '@/core/DataLoader'
import {
  instanceToDefId,
  instanceToTier,
  getInstanceTier,
  getInstanceTierStar,
} from './ShopInstanceRegistry'
import { getItemDefById } from './ShopSynthesisLogic'
import { compareTier, toVisualTier } from '../ShopMathHelpers'

export function applyInstanceTierVisuals(ctx: ShopSceneCtx): void {
  if (ctx.battleView) {
    for (const id of instanceToDefId.keys()) {
      ctx.battleView.setItemTier(id, toVisualTier(getInstanceTier(id), getInstanceTierStar(id)))
    }
  }
  if (ctx.backpackView) {
    for (const id of instanceToDefId.keys()) {
      ctx.backpackView.setItemTier(id, toVisualTier(getInstanceTier(id), getInstanceTierStar(id)))
    }
  }
}

export function collectOwnedTierByDef(): Map<string, TierKey> {
  const result = new Map<string, TierKey>()
  for (const [id, defId] of instanceToDefId) {
    const tier = instanceToTier.get(id) ?? 'Bronze'
    const old = result.get(defId)
    if (!old || compareTier(tier, old) > 0) result.set(defId, tier)
  }
  return result
}

export function syncShopOwnedTierRules(ctx: ShopSceneCtx): void {
  if (!ctx.shopManager) return
  ctx.shopManager.setOwnedTiers(collectOwnedTierByDef())
}

export function syncUnlockPoolToManager(ctx: ShopSceneCtx): void {
  if (!ctx.shopManager) return
  ctx.shopManager.setUnlockedItemIds(Array.from(ctx.unlockedItemIds))
}

export function unlockItemToPool(defId: string, ctx: ShopSceneCtx): boolean {
  const item = getItemDefById(defId)
  if (!item) return false
  if (!isRunClassItemPoolAllowed(defId)) return false
  if (ctx.unlockedItemIds.has(defId)) return false
  ctx.unlockedItemIds.add(defId)
  ctx.shopManager?.unlockItem(defId)
  return true
}
