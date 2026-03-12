// ============================================================
// ShopItemGrant — 将 PoolCandidate 发放到战斗区或背包
// 提取自 ShopScene.ts Phase 8
// ============================================================

import type { ShopSceneCtx } from './ShopSceneContext'
import { getAllItems } from '@/core/DataLoader'
import { normalizeSize } from '@/items/ItemDef'
import type { ItemDef } from '@/items/ItemDef'
import {
  nextId,
  instanceToDefId,
  instanceToPermanentDamageBonus,
  setInstanceQualityLevel,
} from './InstanceRegistry'
import { parseTierName } from './SynthesisLogic'
import { toVisualTier } from './ShopMathHelpers'
import { type ToastReason, showHintToast } from './ShopToastSystem'
import { findFirstBattlePlace, findFirstBackpackPlace } from './ShopGridInventory'
import type { PoolCandidate } from './QuickBuySystem'
import { getUnlockPoolBuyPriceByLevel } from './QuickBuySystem'
import { unlockItemToPool } from './ShopInstanceManager'
import { flyRewardToGridSlot } from './ShopRewardSystem'

export type ItemGrantCallbacks = {
  recordNeutralItemObtained: (defId: string) => void
}

export function grantPoolCandidateToBoardOrBackpack(
  candidate: PoolCandidate,
  toastPrefix: string,
  opts: { flyFromHeroAvatar?: boolean; silentNoSpaceToast?: boolean; onSettled?: () => void } | undefined,
  ctx: ShopSceneCtx,
  callbacks: ItemGrantCallbacks,
): boolean {
  if (!ctx.battleSystem || !ctx.battleView || !ctx.backpackSystem || !ctx.backpackView) return false
  const size = normalizeSize(candidate.item.size)
  const battleSlot = findFirstBattlePlace(size, ctx)
  const backpackSlot = battleSlot ? null : findFirstBackpackPlace(size, ctx)
  if (!battleSlot && !backpackSlot) {
    if (!opts?.silentNoSpaceToast) {
      showHintToast('backpack_full_buy' as ToastReason, `${toastPrefix}：空间不足，发放失败`, 0xffb27a, ctx)
    }
    return false
  }
  const id = nextId()
  const visualTier = toVisualTier(candidate.tier, candidate.star)
  if (battleSlot) {
    ctx.battleSystem.place(battleSlot.col, battleSlot.row, size, candidate.item.id, id)
    const onLand = () => {
      if (!ctx.battleSystem?.getItem(id) || !ctx.battleView) { opts?.onSettled?.(); return }
      void ctx.battleView.addItem(id, candidate.item.id, size, battleSlot.col, battleSlot.row, visualTier).then(() => {
        ctx.battleView!.setItemTier(id, visualTier)
        ctx.drag?.refreshZone(ctx.battleView!)
        opts?.onSettled?.()
      })
    }
    if (opts?.flyFromHeroAvatar) flyRewardToGridSlot(candidate.item.id, ctx.battleView, battleSlot.col, battleSlot.row, onLand, ctx)
    else onLand()
  } else if (backpackSlot) {
    ctx.backpackSystem.place(backpackSlot.col, backpackSlot.row, size, candidate.item.id, id)
    const onLand = () => {
      if (!ctx.backpackSystem?.getItem(id) || !ctx.backpackView) { opts?.onSettled?.(); return }
      void ctx.backpackView.addItem(id, candidate.item.id, size, backpackSlot.col, backpackSlot.row, visualTier).then(() => {
        ctx.backpackView!.setItemTier(id, visualTier)
        ctx.drag?.refreshZone(ctx.backpackView!)
        opts?.onSettled?.()
      })
    }
    if (opts?.flyFromHeroAvatar) flyRewardToGridSlot(candidate.item.id, ctx.backpackView, backpackSlot.col, backpackSlot.row, onLand, ctx)
    else onLand()
  }
  instanceToDefId.set(id, candidate.item.id)
  setInstanceQualityLevel(id, candidate.item.id, parseTierName(candidate.item.starting_tier) ?? 'Bronze', candidate.level)
  instanceToPermanentDamageBonus.set(id, 0)
  callbacks.recordNeutralItemObtained(candidate.item.id)
  unlockItemToPool(candidate.item.id, ctx)
  showHintToast('backpack_full_buy' as ToastReason, `${toastPrefix}：获得 ${candidate.item.name_cn}`, 0x86e1ff, ctx)
  return true
}

function getItemDefByCn(nameCn: string): ItemDef | null {
  return getAllItems().find((it) => it.name_cn === nameCn) ?? null
}

export function buildNamedPoolCandidate(nameCn: string): PoolCandidate | null {
  const item = getItemDefByCn(nameCn)
  if (!item) return null
  const tier = parseTierName(item.starting_tier) ?? 'Bronze'
  const level = (tier === 'Bronze' ? 1 : tier === 'Silver' ? 2 : tier === 'Gold' ? 4 : 6) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  return { item, level, tier, star: 1, price: getUnlockPoolBuyPriceByLevel(level) }
}
