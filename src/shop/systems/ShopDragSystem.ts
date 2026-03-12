// ============================================================
// ShopDragSystem — 商店卡牌拖拽逻辑
// 提取自 ShopScene.ts Phase 8 Batch E
// 包含：startShopDrag / onShopDragMove / onShopDragEnd / resetDrag
//       及辅助：applySellButtonState / clearSelection / sortBackpackItemsByRule 等
// ============================================================

import type { ShopSceneCtx } from '../ShopSceneContext'
import { getApp } from '@/core/AppContext'
import { getConfig } from '@/core/DataLoader'
import { GridZone, CELL_SIZE, CELL_HEIGHT } from '@/common/grid/GridZone'
import { normalizeSize } from '@/common/items/ItemDef'
import type { ItemDef } from '@/common/items/ItemDef'
import type { ItemSizeNorm } from '@/common/grid/GridSystem'
import type { TierKey } from '@/shop/ShopManager'
import { Assets, Container, Sprite, Texture, type FederatedPointerEvent } from 'pixi.js'
import { instanceToTier, getInstanceTierStar } from './ShopInstanceRegistry'
import {
  nextId,
  instanceToDefId,
  instanceToPermanentDamageBonus,
  setInstanceQualityLevel,
  getInstanceTier,
} from './ShopInstanceRegistry'
import {
  parseTierName,
  getItemDefById,
  nextTierLevel,
  tierStarLevelIndex,
  canUseLv7MorphSynthesis,
} from './ShopSynthesisLogic'
import { isShopInputEnabled, getDefaultItemInfoMode, resetInfoModeSelection } from '../ShopModeHelpers'
import { canPlaceInVisibleCols, toVisualTier, hasAnyPlaceInVisibleCols } from '../ShopMathHelpers'
import { CANVAS_W, BTN_RADIUS } from '@/config/layoutConstants'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { type ToastReason, showHintToast } from '../ui/ShopToastSystem'
import {
  stopFlashEffect,
  startFlashEffect as _startFlashEffect,
  startGridDragButtonFlash as _startGridDragButtonFlash,
  stopGridDragButtonFlash as _stopGridDragButtonFlash,
  playSynthesisFlashEffect,
} from '../ui/ShopAnimationEffects'
import {
  findSynthesisTargetWithDragProbe,
  getSynthesisTargetItem,
  highlightSynthesisTarget,
  clearBackpackSynthesisGuideArrows,
  refreshBackpackSynthesisGuideArrows,
  type SynthesisTarget,
  type SynthesizeResult,
  type SynthesisCallbacks,
} from './ShopSynthesisController'
import { canBuyItemUnderFirstPurchaseRule } from './ShopHeroSystem'
import {
  canAffordShopSlot,
  getShopSlotPreviewPrice,
  tryBuyShopSlotWithSkill,
  markShopPurchaseDone,
  showFirstPurchaseRuleHint,
} from './ShopPurchaseLogic'
import type { NeutralChoiceCandidate } from '../panels/NeutralItemPanel'
import {
  getOverlapBlockersInBattle,
  buildBackpackPlanForTransferred,
  applyBackpackPlanWithTransferred,
  applyBackpackAutoPackExisting,
  getArchetypeSortOrder,
} from './ShopAutoPackManager'
import { planUnifiedSqueeze } from '@/common/grid/SqueezeLogic'
import { planAutoPack, type PackItem, type PackPlacement } from '@/common/grid/AutoPack'
import { unlockItemToPool } from './ShopInstanceManager'
import { findFirstBackpackPlace } from './ShopGridInventory'
import { getItemIconUrl } from '@/core/AssetPath'

// ---- 公共类型 ----

export type ShopDragDeps = {
  // 面板操作
  hideSynthesisHoverInfo: () => void
  showSynthesisHoverInfo: (defId: string, tier: TierKey, star: 1 | 2, target: SynthesisTarget) => void
  showCrossSynthesisConfirmOverlay: (
    source: { def: ItemDef; tier: TierKey; star: 1 | 2 },
    target: { def: ItemDef; tier: TierKey; star: 1 | 2 },
    toTier: TierKey,
    toStar: 1 | 2,
    onConfirm: () => void,
  ) => void
  hideSkillDetailPopup: () => void
  // 场景操作
  refreshShopUI: () => void
  applyPhaseInputLock: () => void
  recordNeutralItemObtained: (defId: string) => void
  // NeutralItemPanel 方法（通过 ShopScene.ts shim）
  showLv7MorphSynthesisConfirmOverlay: (stage: Container, onConfirm: () => void) => void
  buildStoneTransformChoices: (target: SynthesisTarget, rule: 'same' | 'other') => NeutralChoiceCandidate[]
  showNeutralChoiceOverlay: (stage: Container, title: string, candidates: NeutralChoiceCandidate[], onConfirm?: (c: NeutralChoiceCandidate) => boolean, mode?: 'default' | 'special_shop_like') => boolean
  transformPlacedItemKeepLevelTo: (instanceId: string, zone: 'battle' | 'backpack', def: ItemDef, withFx?: boolean) => boolean
  // 复合操作（ShopScene.ts shim 已持有完整回调）
  synthesizeTarget: (defId: string, tier: TierKey, star: 1 | 2, targetInstanceId: string, zone: 'battle' | 'backpack') => SynthesizeResult | null
  grantSynthesisExp: (amount: number, from: { instanceId: string; zone: 'battle' | 'backpack' }) => void
  tryRunHeroCrossSynthesisReroll: (stage: Container, synth: SynthesizeResult) => boolean
  tryRunHeroSameItemSynthesisChoice: (defId: string, tier: TierKey, star: 1 | 2, target: SynthesisTarget, consumeSource: () => boolean) => boolean
  purchaseCallbacks: { updateNeutralPseudoRandomCounterOnPurchase: (item: ItemDef) => void }
  isBackpackDropLocked: (col: number, row: number, size: ItemSizeNorm) => boolean
}

// ---- 内联辅助 ----

function isCrossIdSynthesisConfirmEnabled(): boolean {
  const runtimeToggle = getDebugCfg('gameplayCrossSynthesisConfirm') >= 0.5
  if (runtimeToggle) return true
  return getConfig().shopRules?.crossIdSynthesisRequireConfirm === true
}

function makeSynthCallbacksFromDeps(deps: ShopDragDeps): SynthesisCallbacks {
  return {
    isBackpackDropLocked: (col, row, sz) => deps.isBackpackDropLocked(col, row, sz),
    unlockItemToPool: (_defId: string) => false,
    applyInstanceTierVisuals: () => {},
    syncShopOwnedTierRules: () => {},
    grantSynthesisExp: (amt, from) => { if (from) deps.grantSynthesisExp(amt ?? 1, from) },
    checkAndPopPendingRewards: () => {},
  }
}

// ---- 按钮状态 ----

export function applySellButtonState(ctx: ShopSceneCtx): void {
  if (ctx.specialShopBackpackViewActive) {
    if (ctx.sellBtnHandle) { ctx.sellBtnHandle.container.visible = false; ctx.sellBtnHandle.setSubLabel('') }
    if (ctx.refreshBtnHandle) ctx.refreshBtnHandle.container.visible = false
    if (ctx.refreshCostText) ctx.refreshCostText.visible = false
    return
  }
  if (!isShopInputEnabled(ctx)) {
    if (ctx.sellBtnHandle) { ctx.sellBtnHandle.container.visible = false; ctx.sellBtnHandle.setSubLabel('') }
    if (ctx.refreshBtnHandle) ctx.refreshBtnHandle.container.visible = false
    if (ctx.refreshCostText) ctx.refreshCostText.visible = false
    return
  }
  if (ctx.sellBtnHandle) { ctx.sellBtnHandle.container.visible = true; ctx.sellBtnHandle.redraw(true); ctx.sellBtnHandle.setSubLabel('') }
  if (ctx.refreshBtnHandle) ctx.refreshBtnHandle.container.visible = true
  if (ctx.refreshCostText) ctx.refreshCostText.visible = true
}

export function clearSelection(ctx: ShopSceneCtx, deps: ShopDragDeps): void {
  ctx.currentSelection = { kind: 'none' }
  ctx.selectedSellAction = null
  resetInfoModeSelection(ctx)
  deps.hideSkillDetailPopup()
  deps.hideSynthesisHoverInfo()
  clearBackpackSynthesisGuideArrows(ctx)
  ctx.shopPanel?.setSelectedSlot(-1)
  ctx.battleView?.setSelected(null)
  ctx.backpackView?.setSelected(null)
  ctx.levelQuickRewardView?.setSelected(null)
  ctx.sellPopup?.hide()
  applySellButtonState(ctx)
}

export function setSellButtonPrice(price: number, ctx: ShopSceneCtx): void {
  void price
  ctx.sellBtnHandle?.setSubLabel('')
}

export function canBattleAcceptShopItem(size: ItemSizeNorm, ctx: ShopSceneCtx): boolean {
  if (!ctx.battleSystem || !ctx.battleView) return false
  const w = size === '1x1' ? 1 : size === '2x1' ? 2 : 3
  const maxCol = ctx.battleView.activeColCount - w
  if (maxCol < 0) return false
  for (let col = 0; col <= maxCol; col++) {
    if (canPlaceInVisibleCols(ctx.battleSystem, ctx.battleView, col, 0, size)) return true
    const unified = planUnifiedSqueeze(
      { system: ctx.battleSystem, activeColCount: ctx.battleView.activeColCount },
      col, 0, size, '__shop_drag__',
      ctx.backpackSystem && ctx.backpackView
        ? { system: ctx.backpackSystem, activeColCount: ctx.backpackView.activeColCount }
        : undefined,
    )
    if (unified) return true
  }
  return false
}

export function startFlashEffect(stage: Container, size: ItemSizeNorm, forceBothZones: boolean, ctx: ShopSceneCtx): void {
  _startFlashEffect(ctx, stage, size, forceBothZones, {
    canBattleAcceptShopItem: (sz) => canBattleAcceptShopItem(sz, ctx),
    hasAnyPlaceInVisibleCols: (sz) => ctx.backpackSystem && ctx.backpackView
      ? hasAnyPlaceInVisibleCols(ctx.backpackSystem, ctx.backpackView, sz) : false,
  })
}

export function sortBackpackItemsByRule(ctx: ShopSceneCtx, deps: ShopDragDeps): void {
  if (!ctx.backpackSystem || !ctx.backpackView) return
  const items = ctx.backpackSystem.getAllItems()
  if (items.length <= 1) { showHintToast('backpack_full_buy' as ToastReason, '背包已整理', 0x9be5ff, ctx); return }

  const sorted = [...items].sort((a, b) => {
    const archCmp = getArchetypeSortOrder(a.defId) - getArchetypeSortOrder(b.defId)
    if (archCmp !== 0) return archCmp
    const aLv = tierStarLevelIndex(instanceToTier.get(a.instanceId) ?? 'Bronze', getInstanceTierStar(a.instanceId)) + 1
    const bLv = tierStarLevelIndex(instanceToTier.get(b.instanceId) ?? 'Bronze', getInstanceTierStar(b.instanceId)) + 1
    if (aLv !== bLv) return bLv - aLv
    const idCmp = a.defId.localeCompare(b.defId)
    if (idCmp !== 0) return idCmp
    return a.instanceId.localeCompare(b.instanceId)
  })

  const slots: Array<{ col: number; row: number }> = []
  for (let row = 0; row < ctx.backpackSystem.rows; row++)
    for (let col = 0; col < ctx.backpackView.activeColCount; col++)
      slots.push({ col, row })

  const packItems: PackItem[] = sorted.map((it, idx) => {
    const preferred = slots[Math.min(idx, slots.length - 1)] ?? { col: 0, row: 0 }
    return { instanceId: it.instanceId, defId: it.defId, size: it.size, preferredCol: preferred.col, preferredRow: preferred.row }
  })

  const plan = planAutoPack(packItems, ctx.backpackView.activeColCount, ctx.backpackSystem.rows)
  if (!plan) { showHintToast('backpack_full_buy' as ToastReason, '整理失败：背包空间异常', 0xff8f8f, ctx); return }
  applyBackpackAutoPackExisting(plan, ctx)
  deps.refreshShopUI()
  showHintToast('backpack_full_buy' as ToastReason, '背包已按规则整理', 0x9be5ff, ctx)
}

// ---- 区域检测 ----

export function getGridDragSellAreaTopLocalY(): number {
  return Math.min(getDebugCfg('sellBtnY'), getDebugCfg('refreshBtnY'), getDebugCfg('phaseBtnY')) - Math.round(BTN_RADIUS * 0.72)
}

export function isOverGridDragSellArea(gx: number, gy: number): boolean {
  const stage = getApp().stage
  const top = stage.toGlobal({ x: 0, y: getGridDragSellAreaTopLocalY() })
  const left = stage.toGlobal({ x: 0, y: 0 })
  const right = stage.toGlobal({ x: CANVAS_W, y: 0 })
  return gy >= top.y && gx >= Math.min(left.x, right.x) && gx <= Math.max(left.x, right.x)
}

export function isOverAnyGridDropTarget(gx: number, gy: number, size: ItemSizeNorm, ctx: ShopSceneCtx): boolean {
  const dy = getDebugCfg('dragYOffset')
  return !!(ctx.battleView?.pixelToCellForItem(gx, gy, size, dy) ?? ctx.backpackView?.pixelToCellForItem(gx, gy, size, dy))
}

export function updateGridDragSellAreaHover(gx: number, gy: number, size: ItemSizeNorm, ctx: ShopSceneCtx): void {
  ctx.gridDragSellHot = ctx.gridDragCanSell
    ? isOverGridDragSellArea(gx, gy) && !isOverAnyGridDropTarget(gx, gy, size, ctx)
    : false
}

function makeGridDragInternalDeps(ctx: ShopSceneCtx) {
  return {
    isShopInputEnabled: () => isShopInputEnabled(ctx),
    applySellButtonState: () => applySellButtonState(ctx),
    getGridDragSellAreaTopLocalY: () => getGridDragSellAreaTopLocalY(),
  }
}

export function startGridDragButtonFlash(stage: Container, canSell: boolean, canToBackpack: boolean, sellPrice: number, ctx: ShopSceneCtx): void {
  _startGridDragButtonFlash(ctx, stage, canSell, canToBackpack, sellPrice, makeGridDragInternalDeps(ctx))
}

export function stopGridDragButtonFlash(ctx: ShopSceneCtx): void {
  _stopGridDragButtonFlash(ctx, makeGridDragInternalDeps(ctx))
}

export function isOverBpBtn(gx: number, gy: number): boolean {
  const cx = getDebugCfg('backpackBtnX'), cy = getDebugCfg('backpackBtnY'), r = BTN_RADIUS + 24
  const c = getApp().stage.toGlobal({ x: cx, y: cy })
  return (gx - c.x) ** 2 + (gy - c.y) ** 2 <= r * r
}

export function isPointInZoneArea(view: GridZone | null, gx: number, gy: number): boolean {
  if (!view || !view.visible) return false
  const a = view.toGlobal({ x: 0, y: 0 })
  const b = view.toGlobal({ x: view.activeColCount * CELL_SIZE, y: CELL_HEIGHT })
  return gx >= Math.min(a.x, b.x) && gx <= Math.max(a.x, b.x) && gy >= Math.min(a.y, b.y) && gy <= Math.max(a.y, b.y)
}

// ---- 拖拽：重置 ----

export function resetDrag(ctx: ShopSceneCtx, deps: ShopDragDeps): void {
  if (ctx.shopDragFloater) {
    ctx.shopDragFloater.parent?.removeChild(ctx.shopDragFloater)
    ctx.shopDragFloater.destroy({ children: true })
    ctx.shopDragFloater = null
  }
  if (ctx.shopDragHiddenSlot >= 0) ctx.shopPanel?.setSlotDragging(ctx.shopDragHiddenSlot, false)
  ctx.shopDragHiddenSlot = -1; ctx.shopDragSlotIdx = -1; ctx.shopDragSize = null; ctx.shopDragPointerId = -1
  deps.hideSynthesisHoverInfo()
  clearBackpackSynthesisGuideArrows(ctx)
  clearSelection(ctx, deps)
}

// ---- 拖拽：开始 ----

export function startShopDrag(slotIndex: number, e: FederatedPointerEvent, stage: Container, ctx: ShopSceneCtx, deps: ShopDragDeps): void {
  if (!isShopInputEnabled(ctx) || !ctx.shopManager) return
  clearSelection(ctx, deps)
  const slot = ctx.shopManager.pool[slotIndex]
  if (!slot || slot.purchased || !canAffordShopSlot(slot, ctx)) return

  const size = normalizeSize(slot.item.size)
  const iconW = size === '1x1' ? CELL_SIZE : size === '2x1' ? CELL_SIZE * 2 : CELL_SIZE * 3
  const floater = new Container()
  floater.eventMode = 'none'; floater.interactiveChildren = false
  const sp = new Sprite(Texture.WHITE)
  sp.width = iconW - 10; sp.height = iconW - 10; sp.x = 5; sp.y = 5; sp.alpha = 0
  floater.addChild(sp)
  Assets.load<Texture>(getItemIconUrl(slot.item.id))
    .then(tex => { sp.texture = tex; sp.alpha = 0.9 })
    .catch(err => console.warn('[ShopScene] 拖拽浮层图标加载失败', slot.item.id, err))

  const offsetY = getDebugCfg('dragYOffset')
  const p = stage.toLocal(e.global)
  floater.x = p.x - iconW / 2; floater.y = p.y + offsetY - iconW / 2
  stage.addChild(floater)

  ctx.shopDragFloater = floater; ctx.shopDragSlotIdx = slotIndex
  ctx.shopDragHiddenSlot = slotIndex; ctx.shopDragSize = size; ctx.shopDragPointerId = e.pointerId
  ctx.shopPanel?.setSlotDragging(slotIndex, true)
  ctx.currentSelection = { kind: 'shop', slotIndex }; ctx.selectedSellAction = null
  ctx.sellPopup?.show(slot.item, getShopSlotPreviewPrice(slot, ctx), 'buy', slot.tier)
  applySellButtonState(ctx)
  startFlashEffect(stage, size, false, ctx)
}

// ---- 拖拽：移动 ----

export function onShopDragMove(e: FederatedPointerEvent, ctx: ShopSceneCtx, deps: ShopDragDeps): void {
  if (!isShopInputEnabled(ctx) || !ctx.shopDragFloater || !ctx.shopDragSize) return
  if (e.pointerId !== ctx.shopDragPointerId) return

  const dragSlot = ctx.shopManager?.pool[ctx.shopDragSlotIdx]
  refreshBackpackSynthesisGuideArrows(dragSlot?.item.id ?? null, dragSlot?.tier ?? null, 1, ctx)

  const iconW = ctx.shopDragSize === '1x1' ? CELL_SIZE : ctx.shopDragSize === '2x1' ? CELL_SIZE * 2 : CELL_SIZE * 3
  const offsetY = getDebugCfg('dragYOffset')
  const p = getApp().stage.toLocal(e.global)
  ctx.shopDragFloater.x = p.x - iconW / 2; ctx.shopDragFloater.y = p.y + offsetY - iconW / 2

  const gx = e.globalX, gy = e.globalY
  const synthTarget = dragSlot
    ? findSynthesisTargetWithDragProbe(dragSlot.item.id, dragSlot.tier, 1, gx, gy, ctx.shopDragSize, ctx, makeSynthCallbacksFromDeps(deps))
    : null

  if (synthTarget) {
    highlightSynthesisTarget(synthTarget, ctx)
    if (dragSlot) deps.showSynthesisHoverInfo(dragSlot.item.id, dragSlot.tier, 1, synthTarget)
    return
  }
  deps.hideSynthesisHoverInfo()

  if (dragSlot && ctx.sellPopup) {
    ctx.sellPopup.show(dragSlot.item, getShopSlotPreviewPrice(dragSlot, ctx), 'buy', toVisualTier(dragSlot.tier, 1), undefined, getDefaultItemInfoMode())
  }

  const battleCell = ctx.battleView?.pixelToCellForItem(gx, gy, ctx.shopDragSize, 0)
  if (battleCell && ctx.battleSystem) {
    const finalRow = battleCell.row
    let canDirect = canPlaceInVisibleCols(ctx.battleSystem, ctx.battleView!, battleCell.col, finalRow, ctx.shopDragSize)
    if (!canDirect) {
      const unified = planUnifiedSqueeze(
        { system: ctx.battleSystem, activeColCount: ctx.battleView!.activeColCount },
        battleCell.col, finalRow, ctx.shopDragSize, '__shop_drag__',
        ctx.backpackSystem && ctx.backpackView ? { system: ctx.backpackSystem, activeColCount: ctx.backpackView.activeColCount } : undefined,
      )
      if (unified?.mode === 'local' && unified.moves.length > 0) {
        const ms = getDebugCfg('squeezeMs')
        for (const move of unified.moves) {
          const item = ctx.battleSystem.getItem(move.instanceId); if (!item) continue
          ctx.battleSystem.remove(move.instanceId)
          ctx.battleSystem.place(move.newCol, move.newRow, item.size, item.defId, move.instanceId)
          ctx.battleView!.animateToCell(move.instanceId, move.newCol, move.newRow, ms)
        }
        canDirect = canPlaceInVisibleCols(ctx.battleSystem, ctx.battleView!, battleCell.col, finalRow, ctx.shopDragSize)
      }
    }
    let canReplace = false
    if (!canDirect) {
      const blockers = getOverlapBlockersInBattle(battleCell.col, finalRow, ctx.shopDragSize, ctx)
      canReplace = blockers.length > 0 && buildBackpackPlanForTransferred(blockers, ctx) !== null
    }
    ctx.battleView!.highlightCells(battleCell.col, battleCell.row, ctx.shopDragSize, canDirect || canReplace, undefined)
  } else {
    ctx.battleView?.clearHighlight()
  }

  if (ctx.backpackView?.visible) {
    const bpCell = ctx.backpackView.pixelToCellForItem(gx, gy, ctx.shopDragSize, 0)
    if (bpCell && ctx.backpackSystem) {
      ctx.backpackView.highlightCells(bpCell.col, bpCell.row, ctx.shopDragSize,
        canPlaceInVisibleCols(ctx.backpackSystem, ctx.backpackView, bpCell.col, bpCell.row, ctx.shopDragSize))
    } else {
      ctx.backpackView.clearHighlight()
    }
  }
}

// ---- 拖拽：结束 ----

export async function onShopDragEnd(e: FederatedPointerEvent, stage: Container, ctx: ShopSceneCtx, deps: ShopDragDeps): Promise<void> {
  if (!isShopInputEnabled(ctx)) { deps.applyPhaseInputLock(); return }
  if (!ctx.shopDragFloater || ctx.shopDragSlotIdx < 0 || !ctx.shopDragSize) return
  if (e.pointerId !== ctx.shopDragPointerId) return

  const slot = ctx.shopManager?.pool[ctx.shopDragSlotIdx]
  stopFlashEffect(ctx)
  ctx.battleView?.clearHighlight(); ctx.backpackView?.clearHighlight()
  deps.hideSynthesisHoverInfo()
  clearBackpackSynthesisGuideArrows(ctx)

  if (!slot || !ctx.shopManager || !ctx.shopDragSize) { resetDrag(ctx, deps); return }
  if (!canBuyItemUnderFirstPurchaseRule(ctx, slot.item)) { showFirstPurchaseRuleHint(ctx); resetDrag(ctx, deps); return }

  const gx = e.globalX, gy = e.globalY
  const size = ctx.shopDragSize
  const synthTarget = findSynthesisTargetWithDragProbe(slot.item.id, slot.tier, 1, gx, gy, size, ctx, makeSynthCallbacksFromDeps(deps))
  const battleCell = ctx.battleView?.pixelToCellForItem(gx, gy, size, 0)
  const bpCell = ctx.backpackView?.visible ? ctx.backpackView.pixelToCellForItem(gx, gy, size, 0) : null
  const overBattleArea = isPointInZoneArea(ctx.battleView, gx, gy)
  const onBpBtn = isOverBpBtn(gx, gy)

  if (synthTarget) {
    const targetItem = getSynthesisTargetItem(synthTarget, ctx)
    const targetTier = getInstanceTier(synthTarget.instanceId) ?? slot.tier
    const targetStar = getInstanceTierStar(synthTarget.instanceId)
    const lv7MorphMode = !!targetItem && canUseLv7MorphSynthesis(slot.item.id, targetItem.defId, slot.tier, 1, targetTier, targetStar)

    if (lv7MorphMode) {
      deps.showLv7MorphSynthesisConfirmOverlay(stage, () => {
        const choices = deps.buildStoneTransformChoices(synthTarget, 'same')
        if (choices.length <= 0) { showHintToast('backpack_full_buy' as ToastReason, 'Lv7转化：当前无可用候选', 0xffb27a, ctx); deps.refreshShopUI(); return }
        const opened = deps.showNeutralChoiceOverlay(stage, '选择变化方向', choices, (picked: NeutralChoiceCandidate) => {
          const buyRet = tryBuyShopSlotWithSkill(slot, ctx, deps.purchaseCallbacks)
          if (!buyRet.ok) { showHintToast('no_gold_buy' as ToastReason, '金币不足，无法购买', 0xff8f8f, ctx); deps.refreshShopUI(); return false }
          markShopPurchaseDone(ctx)
          const ok = deps.transformPlacedItemKeepLevelTo(synthTarget.instanceId, synthTarget.zone, picked.item, true)
          if (!ok) { showHintToast('backpack_full_buy' as ToastReason, 'Lv7转化失败', 0xff8f8f, ctx); deps.refreshShopUI(); return false }
          deps.grantSynthesisExp(1, { instanceId: synthTarget.instanceId, zone: synthTarget.zone })
          showHintToast('no_gold_buy' as ToastReason, 'Lv7合成：已触发变化石效果', 0x9be5ff, ctx)
          deps.refreshShopUI(); return true
        }, 'special_shop_like')
        if (!opened) { showHintToast('backpack_full_buy' as ToastReason, 'Lv7转化：当前无可用候选', 0xffb27a, ctx); deps.refreshShopUI() }
      })
      resetDrag(ctx, deps); return
    }

    const isCrossId = !!targetItem && targetItem.defId !== slot.item.id
    if (isCrossId) {
      const targetDef = targetItem ? getItemDefById(targetItem.defId) : null
      const upgradeTo = nextTierLevel(slot.tier, 1)
      if (!targetItem || !targetDef || !upgradeTo) { resetDrag(ctx, deps); return }

      const runCrossSynthesis = () => {
        const buyRet = tryBuyShopSlotWithSkill(slot, ctx, deps.purchaseCallbacks)
        if (!buyRet.ok) { showHintToast('no_gold_buy' as ToastReason, '金币不足，无法购买', 0xff8f8f, ctx); deps.refreshShopUI(); return }
        markShopPurchaseDone(ctx)
        const synth = deps.synthesizeTarget(slot.item.id, slot.tier, 1, synthTarget.instanceId, synthTarget.zone)
        if (!synth) { showHintToast('backpack_full_buy' as ToastReason, '合成目标无效', 0xff8f8f, ctx); deps.refreshShopUI(); return }
        playSynthesisFlashEffect(ctx, stage, synth)
        if (!deps.tryRunHeroCrossSynthesisReroll(stage, synth)) deps.refreshShopUI()
      }
      if (isCrossIdSynthesisConfirmEnabled()) {
        deps.showCrossSynthesisConfirmOverlay(
          { def: slot.item, tier: slot.tier, star: 1 },
          { def: targetDef, tier: targetTier, star: targetStar },
          upgradeTo.tier, upgradeTo.star, runCrossSynthesis,
        )
      } else {
        runCrossSynthesis()
      }
      resetDrag(ctx, deps); return
    }

    if (deps.tryRunHeroSameItemSynthesisChoice(slot.item.id, slot.tier, 1, synthTarget, () => {
      const ret = tryBuyShopSlotWithSkill(slot, ctx, deps.purchaseCallbacks)
      if (!ret.ok) { showHintToast('no_gold_buy' as ToastReason, '金币不足，无法购买', 0xff8f8f, ctx); return false }
      markShopPurchaseDone(ctx); return true
    })) { resetDrag(ctx, deps); return }

    if (!tryBuyShopSlotWithSkill(slot, ctx, deps.purchaseCallbacks).ok) {
      showHintToast('no_gold_buy' as ToastReason, '金币不足，无法购买', 0xff8f8f, ctx); resetDrag(ctx, deps); return
    }
    markShopPurchaseDone(ctx)
    const synth = deps.synthesizeTarget(slot.item.id, slot.tier, 1, synthTarget.instanceId, synthTarget.zone)
    if (!synth) { showHintToast('backpack_full_buy' as ToastReason, '合成目标无效', 0xff8f8f, ctx); deps.refreshShopUI(); resetDrag(ctx, deps); return }
    playSynthesisFlashEffect(ctx, stage, synth)
    deps.refreshShopUI(); resetDrag(ctx, deps); return
  }

  if (!overBattleArea && !bpCell && !onBpBtn) { resetDrag(ctx, deps); return }

  // ---- 战斗区放置 ----
  const battleFinalRow = battleCell?.row ?? 0
  const battleCanDirect = !!(battleCell && ctx.battleSystem && ctx.battleView
    && canPlaceInVisibleCols(ctx.battleSystem, ctx.battleView, battleCell.col, battleFinalRow, size))
  let battleSqueezeMoves: { instanceId: string; newCol: number; newRow: number }[] = []
  const battleUnified = (!battleCanDirect && battleCell && ctx.battleSystem && ctx.battleView)
    ? planUnifiedSqueeze(
      { system: ctx.battleSystem, activeColCount: ctx.battleView.activeColCount },
      battleCell.col, battleFinalRow, size, '__shop_drag__',
      ctx.backpackSystem && ctx.backpackView ? { system: ctx.backpackSystem, activeColCount: ctx.backpackView.activeColCount } : undefined,
    ) : null
  if (battleUnified?.mode === 'local') battleSqueezeMoves = battleUnified.moves

  let battleTransferPlan: PackPlacement[] | null = null
  let battleTransferredIds = new Set<string>()
  if (!battleCanDirect && battleSqueezeMoves.length === 0 && battleCell && ctx.battleSystem && ctx.battleView) {
    const mode = battleUnified?.mode
    if (mode === 'cross') {
      const blockersById = new Map(getOverlapBlockersInBattle(battleCell.col, battleFinalRow, size, ctx).map(b => [b.instanceId, b] as const))
      const transfers = (battleUnified as NonNullable<typeof battleUnified>).transfers.map(t => blockersById.get(t.instanceId)).filter((v): v is { instanceId: string; defId: string; size: ItemSizeNorm } => !!v)
      const plan = buildBackpackPlanForTransferred(transfers, ctx)
      if (plan) { battleTransferPlan = plan; battleTransferredIds = new Set(transfers.map(b => b.instanceId)) }
    }
  }
  if (!battleCanDirect && battleSqueezeMoves.length === 0 && battleCell && ctx.battleSystem && ctx.battleView && battleTransferPlan === null) {
    const blockers = getOverlapBlockersInBattle(battleCell.col, battleFinalRow, size, ctx)
    if (blockers.length > 0) {
      const plan = buildBackpackPlanForTransferred(blockers, ctx)
      if (plan) { battleTransferPlan = plan; battleTransferredIds = new Set(blockers.map(b => b.instanceId)) }
    }
  }

  if (ctx.battleSystem && ctx.battleView && battleCell && (battleCanDirect || battleSqueezeMoves.length > 0 || battleTransferPlan !== null)) {
    if (tryBuyShopSlotWithSkill(slot, ctx, deps.purchaseCallbacks).ok) {
      markShopPurchaseDone(ctx)
      if (battleSqueezeMoves.length > 0) {
        const ms = getDebugCfg('squeezeMs')
        for (const move of battleSqueezeMoves) {
          const item = ctx.battleSystem.getItem(move.instanceId); if (!item) continue
          ctx.battleSystem.remove(move.instanceId)
          ctx.battleSystem.place(move.newCol, move.newRow, item.size, item.defId, move.instanceId)
          ctx.battleView.animateToCell(move.instanceId, move.newCol, move.newRow, ms)
        }
      }
      if (battleTransferPlan && battleTransferredIds.size > 0) applyBackpackPlanWithTransferred(battleTransferPlan, battleTransferredIds, ctx)
      const id = nextId()
      ctx.battleSystem.place(battleCell.col, battleFinalRow, size, slot.item.id, id)
      void ctx.battleView!.addItem(id, slot.item.id, size, battleCell.col, battleFinalRow, toVisualTier(slot.tier, 1)).then(() => {
        ctx.battleView!.setItemTier(id, toVisualTier(slot.tier, 1)); ctx.drag?.refreshZone(ctx.battleView!)
      })
      instanceToDefId.set(id, slot.item.id)
      setInstanceQualityLevel(id, slot.item.id, parseTierName(slot.item.starting_tier) ?? 'Bronze', 1)
      instanceToPermanentDamageBonus.set(id, 0)
      deps.recordNeutralItemObtained(slot.item.id); unlockItemToPool(slot.item.id, ctx)
      deps.refreshShopUI()
    } else {
      showHintToast('no_gold_buy' as ToastReason, '金币不足，无法购买', 0xff8f8f, ctx)
    }
    resetDrag(ctx, deps); return
  }

  // ---- 背包区放置 ----
  if (bpCell || onBpBtn) {
    const directCell = bpCell && ctx.backpackSystem && ctx.backpackView
      ? (canPlaceInVisibleCols(ctx.backpackSystem, ctx.backpackView, bpCell.col, bpCell.row, size) ? { col: bpCell.col, row: bpCell.row } : null)
      : null
    const targetCell = directCell ?? (onBpBtn ? findFirstBackpackPlace(size, ctx) : null)
    if (!targetCell) { showHintToast('backpack_full_buy' as ToastReason, '背包已满，无法购买', 0xff8f8f, ctx); resetDrag(ctx, deps); return }
    if (!tryBuyShopSlotWithSkill(slot, ctx, deps.purchaseCallbacks).ok) {
      showHintToast('no_gold_buy' as ToastReason, '金币不足，无法购买', 0xff8f8f, ctx); resetDrag(ctx, deps); return
    }
    markShopPurchaseDone(ctx)
    const id = nextId()
    ctx.backpackSystem!.place(targetCell.col, targetCell.row, size, slot.item.id, id)
    void ctx.backpackView!.addItem(id, slot.item.id, size, targetCell.col, targetCell.row, toVisualTier(slot.tier, 1)).then(() => {
      ctx.backpackView!.setItemTier(id, toVisualTier(slot.tier, 1)); ctx.drag?.refreshZone(ctx.backpackView!)
    })
    instanceToDefId.set(id, slot.item.id)
    setInstanceQualityLevel(id, slot.item.id, parseTierName(slot.item.starting_tier) ?? 'Bronze', 1)
    instanceToPermanentDamageBonus.set(id, 0)
    deps.recordNeutralItemObtained(slot.item.id); unlockItemToPool(slot.item.id, ctx)
    deps.refreshShopUI()
  }

  resetDrag(ctx, deps)
}
