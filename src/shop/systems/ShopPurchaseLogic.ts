// ============================================================
// ShopPurchaseLogic — 购买价格计算、购买执行
// 提取自 ShopScene.ts Phase 8
// ============================================================

import type { ShopSceneCtx } from '../ShopSceneContext'
import type { ShopSlot } from '@/shop/ShopManager'
import type { ItemDef } from '@/common/items/ItemDef'
import { getAllItems } from '@/core/DataLoader'
import { toSkillArchetype, getPrimaryArchetype } from './ShopSynthesisLogic'
import { getStarterClassTag } from './ShopHeroSystem'
import {
  resolveBuyPriceWithSkills,
  consumeSkill15NextBuyDiscountAfterSuccess,
  consumeSkill30BundleAfterSuccess,
} from './ShopSkillSystem'
import { parseAvailableTiers } from '../panels/SpecialShopDesc'
import { type ToastReason, showHintToast } from '../ui/ShopToastSystem'

export type PurchaseCallbacks = {
  updateNeutralPseudoRandomCounterOnPurchase: (item: ItemDef) => void
}

export function getShopSlotPreviewPrice(slot: ShopSlot, ctx: ShopSceneCtx): number {
  return resolveBuyPriceWithSkills(ctx, slot.price).finalPrice
}

export function canAffordShopSlot(slot: ShopSlot, ctx: ShopSceneCtx): boolean {
  if (!ctx.shopManager || slot.purchased) return false
  return ctx.shopManager.gold >= getShopSlotPreviewPrice(slot, ctx)
}

export function tryBuyShopSlotWithSkill(
  slot: ShopSlot,
  ctx: ShopSceneCtx,
  callbacks: PurchaseCallbacks,
): { ok: boolean; finalPrice: number; discount: number } {
  if (!ctx.shopManager || slot.purchased) return { ok: false, finalPrice: slot.price, discount: 0 }
  if (ctx.dayEventState.forceBuyArchetype && ctx.dayEventState.forceBuyRemaining > 0) {
    const currentArch = toSkillArchetype(getPrimaryArchetype(slot.item.tags))
    if (currentArch !== ctx.dayEventState.forceBuyArchetype) {
      const candidates = getAllItems().filter((it) => {
        if (!parseAvailableTiers(it.available_tiers).includes(slot.tier)) return false
        return toSkillArchetype(getPrimaryArchetype(it.tags)) === ctx.dayEventState.forceBuyArchetype
      })
      const replacement = candidates[Math.floor(Math.random() * candidates.length)]
      if (replacement) {
        slot.item = replacement
        slot.price = ctx.shopManager.getItemPrice(replacement, slot.tier)
      }
    }
  }
  const priced = resolveBuyPriceWithSkills(ctx, slot.price)
  if (ctx.shopManager.gold < priced.finalPrice) return { ok: false, finalPrice: priced.finalPrice, discount: priced.discount }
  ctx.shopManager.gold -= priced.finalPrice
  slot.purchased = true
  if (ctx.dayEventState.forceBuyRemaining > 0) {
    ctx.dayEventState.forceBuyRemaining = Math.max(0, ctx.dayEventState.forceBuyRemaining - 1)
    if (ctx.dayEventState.forceBuyRemaining <= 0) ctx.dayEventState.forceBuyArchetype = null
  }
  if (consumeSkill15NextBuyDiscountAfterSuccess(ctx)) showHintToast('no_gold_buy' as ToastReason, '砍价高手触发：本次-1G', 0x8ff0b0, ctx)
  const skill30Ready = consumeSkill30BundleAfterSuccess(ctx, priced.freeBySkill30)
  if (priced.freeBySkill30) showHintToast('no_gold_buy' as ToastReason, '打包购买触发：本次0金币', 0x9be5ff, ctx)
  else if (skill30Ready) showHintToast('no_gold_buy' as ToastReason, '打包购买就绪：下次购买0金币', 0x9be5ff, ctx)
  callbacks.updateNeutralPseudoRandomCounterOnPurchase(slot.item)
  return { ok: true, finalPrice: priced.finalPrice, discount: priced.discount }
}

export function showFirstPurchaseRuleHint(ctx: ShopSceneCtx): void {
  const tag = getStarterClassTag(ctx)
  const label = tag || '本职业'
  showHintToast('no_gold_buy' as ToastReason, `首次购买需为${label}物品`, 0xffd48f, ctx)
}

export function markShopPurchaseDone(ctx: ShopSceneCtx): void {
  ctx.hasBoughtOnce = true
}
