// ============================================================
// ShopDebugLayout — Debug 布局调整（文字大小、位置、区域标签）
// 提取自 ShopScene.ts Phase 8 Batch G
// 包含：applyTextSizesFromDebug、applyLayoutFromDebug 等
// ============================================================

import type { ShopSceneCtx } from '../ShopSceneContext'
import type { CircleBtnHandle } from '../ShopSceneContext'
import { CANVAS_W, BTN_RADIUS } from '@/config/layoutConstants'
import { CELL_SIZE, CELL_HEIGHT } from '@/common/grid/GridZone'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { Text } from 'pixi.js'
import {
  getBattleItemScale,
  getShopItemScale,
  getDayActiveCols,
  getBattleZoneX,
  getBackpackZoneX,
  getBackpackZoneYByBattle,
} from '../ShopMathHelpers'
import { layoutPlayerStatusPanel } from './PlayerStatusUI'

// ---- 布局常量 ----
const AREA_LABEL_LEFT_X = 0
const BACKPACK_LABEL_GLOBAL_Y_GAP = 60
const BATTLE_ZONE_TITLE_TOP_GAP = 28
const BACKPACK_ZONE_TITLE_TOP_GAP = 22
const MINI_CELL = 20
const MINI_W = 6 * MINI_CELL

export type DebugLayoutCallbacks = {
  applyPhaseUiVisibility: () => void
  layoutSkillIconBar: () => void
}

// ---- 函数 ----

export function layoutDayDebugControls(ctx: ShopSceneCtx): void {
  if (!ctx.dayPrevBtn || !ctx.dayNextBtn || !ctx.dayDebugText) return
  const gap = Math.max(16, Math.round(ctx.dayDebugText.style.fontSize as number))

  const arrowSlotW = Math.max(ctx.dayPrevBtn.width, ctx.dayNextBtn.width)
  ctx.dayPrevBtn.x = 0
  ctx.dayDebugText.x = arrowSlotW + gap
  ctx.dayNextBtn.x = ctx.dayDebugText.x + ctx.dayDebugText.width + gap + (arrowSlotW - ctx.dayNextBtn.width)

  const maxH = Math.max(ctx.dayPrevBtn.height, ctx.dayDebugText.height, ctx.dayNextBtn.height)
  ctx.dayPrevBtn.y = (maxH - ctx.dayPrevBtn.height) / 2
  ctx.dayDebugText.y = (maxH - ctx.dayDebugText.height) / 2
  ctx.dayNextBtn.y = (maxH - ctx.dayNextBtn.height) / 2

  if (ctx.dayDebugCon) {
    ctx.dayDebugCon.pivot.x = ctx.dayDebugText.x + ctx.dayDebugText.width / 2
  }
}

export function applyItemInfoPanelLayout(ctx: ShopSceneCtx): void {
  if (!ctx.sellPopup) return
  ctx.sellPopup.setWidth(getDebugCfg('itemInfoWidth'))
  ctx.sellPopup.setMinHeight(getDebugCfg('itemInfoMinH'))
  ctx.sellPopup.setSmallMinHeight(getDebugCfg('itemInfoMinHSmall'))
  ctx.sellPopup.setCornerRadius(getDebugCfg('gridItemCornerRadius'))
  ctx.sellPopup.setTextSizes({
    name:  getDebugCfg('itemInfoNameFontSize'),
    tier:  getDebugCfg('itemInfoTierFontSize'),
    cooldown: getDebugCfg('itemInfoCooldownFontSize'),
    priceCorner: getDebugCfg('itemInfoPriceCornerFontSize'),
    desc:  getDebugCfg('itemInfoDescFontSize'),
    simpleDesc: getDebugCfg('itemInfoSimpleDescFontSize'),
  })
  let panelBottomY = getDebugCfg('shopAreaY') - getDebugCfg('itemInfoBottomGapToShop') - 92
  if (ctx.skillIconBarCon?.visible) {
    panelBottomY = Math.min(panelBottomY, ctx.skillIconBarCon.y - 44)
  }
  ctx.sellPopup.setBottomAnchor(panelBottomY)
}

export function applyTextSizesFromDebug(ctx: ShopSceneCtx): void {
  const buttonSize = getDebugCfg('shopButtonLabelFontSize')
  const phaseButtonSize = getDebugCfg('phaseButtonLabelFontSize')
  const sellSubSize = getDebugCfg('sellButtonSubPriceFontSize')
  const areaLabelSize = getDebugCfg('gridZoneLabelFontSize')

  const setBtnTextSize = (handle: CircleBtnHandle | null, active = false): void => {
    if (!handle) return
    const main = handle.container.getChildByName('btn-main') as Text | null
    const sub = handle.container.getChildByName('sell-price') as Text | null
    if (main) main.style.fontSize = buttonSize
    if (sub) sub.style.fontSize = sellSubSize
    handle.redraw(active)
  }

  setBtnTextSize(ctx.bpBtnHandle, ctx.showingBackpack)
  setBtnTextSize(ctx.refreshBtnHandle, true)
  setBtnTextSize(ctx.sellBtnHandle, false)
  setBtnTextSize(ctx.phaseBtnHandle, true)

  if (ctx.refreshBtnHandle) {
    const main = ctx.refreshBtnHandle.container.getChildByName('btn-main') as Text | null
    if (main) main.style.fontSize = phaseButtonSize
    ctx.refreshBtnHandle.redraw(true)
  }

  if (ctx.phaseBtnHandle) {
    const main = ctx.phaseBtnHandle.container.getChildByName('btn-main') as Text | null
    if (main) main.style.fontSize = buttonSize
    ctx.phaseBtnHandle.redraw(true)
  }

  if (ctx.refreshCostText) ctx.refreshCostText.style.fontSize = getDebugCfg('refreshCostFontSize')
  if (ctx.hintToastText) ctx.hintToastText.style.fontSize = getDebugCfg('refreshCostFontSize')
  if (ctx.livesText) ctx.livesText.style.fontSize = getDebugCfg('refreshCostFontSize')
  if (ctx.goldText) {
    ctx.goldText.style.fontSize = getDebugCfg('goldFontSize')
    const s = getBattleItemScale(ctx)
    ctx.goldText.scale.set(s)
    ctx.goldText.x = getDebugCfg('goldTextCenterX') - ctx.goldText.width / 2
    ctx.goldText.y = getDebugCfg('goldTextY')
  }
  if (ctx.dayPrevBtn) ctx.dayPrevBtn.style.fontSize = getDebugCfg('dayDebugArrowFontSize')
  if (ctx.dayNextBtn) ctx.dayNextBtn.style.fontSize = getDebugCfg('dayDebugArrowFontSize')
  if (ctx.dayDebugText) ctx.dayDebugText.style.fontSize = getDebugCfg('dayDebugLabelFontSize')
  if (ctx.playerStatusLvText) ctx.playerStatusLvText.style.fontSize = getDebugCfg('shopPlayerStatusLvFontSize')
  layoutDayDebugControls(ctx)

  ctx.battleView?.setLabelFontSize(areaLabelSize / (ctx.battleView.scale.x || 1))
  ctx.backpackView?.setLabelFontSize(areaLabelSize / (ctx.backpackView.scale.x || 1))
  ctx.shopPanel?.setLabelFontSize(areaLabelSize)
  ctx.battleView?.setLabelVisible(false)
  ctx.backpackView?.setLabelVisible(false)
  if (ctx.battleZoneTitleText) {
    ctx.battleZoneTitleText.style.fontSize = areaLabelSize
  }
  if (ctx.backpackZoneTitleText) {
    ctx.backpackZoneTitleText.style.fontSize = areaLabelSize
  }
  ctx.battleView?.setStatBadgeFontSize(getDebugCfg('itemStatBadgeFontSize'))
  ctx.backpackView?.setStatBadgeFontSize(getDebugCfg('itemStatBadgeFontSize'))
  ctx.battleView?.setTierStarFontSize(getDebugCfg('itemTierStarFontSize'))
  ctx.backpackView?.setTierStarFontSize(getDebugCfg('itemTierStarFontSize'))
  ctx.battleView?.setTierStarStrokeWidth(getDebugCfg('itemTierStarStrokeWidth'))
  ctx.backpackView?.setTierStarStrokeWidth(getDebugCfg('itemTierStarStrokeWidth'))
  ctx.battleView?.setTierStarOffsetX(getDebugCfg('itemTierStarOffsetX'))
  ctx.backpackView?.setTierStarOffsetX(getDebugCfg('itemTierStarOffsetX'))
  ctx.battleView?.setTierStarOffsetY(getDebugCfg('itemTierStarOffsetY'))
  ctx.backpackView?.setTierStarOffsetY(getDebugCfg('itemTierStarOffsetY'))
  ctx.battleView?.setStatBadgeOffsetY(getDebugCfg('itemStatBadgeOffsetY'))
  ctx.backpackView?.setStatBadgeOffsetY(getDebugCfg('itemStatBadgeOffsetY'))
  ctx.shopPanel?.setStatBadgeFontSize(getDebugCfg('itemStatBadgeFontSize'))
  ctx.shopPanel?.setStatBadgeOffsetY(getDebugCfg('itemStatBadgeOffsetY'))

  ctx.shopPanel?.setTextSizes({
    itemName: getDebugCfg('shopItemNameFontSize'),
    itemPrice: getDebugCfg('shopItemPriceFontSize'),
    itemBought: getDebugCfg('shopItemBoughtFontSize'),
  })

  ctx.sellPopup?.setTextSizes({
    name: getDebugCfg('itemInfoNameFontSize'),
    tier: getDebugCfg('itemInfoTierFontSize'),
    cooldown: getDebugCfg('itemInfoCooldownFontSize'),
    priceCorner: getDebugCfg('itemInfoPriceCornerFontSize'),
    desc: getDebugCfg('itemInfoDescFontSize'),
    simpleDesc: getDebugCfg('itemInfoSimpleDescFontSize'),
  })
}

export function applyAreaLabelLeftAlign(ctx: ShopSceneCtx): void {
  ctx.battleView?.setLabelGlobalLeft(AREA_LABEL_LEFT_X)
  ctx.backpackView?.setLabelGlobalLeft(AREA_LABEL_LEFT_X)
  ctx.shopPanel?.setLabelGlobalLeft(AREA_LABEL_LEFT_X)
}

export function applyLayoutFromDebug(ctx: ShopSceneCtx, callbacks: DebugLayoutCallbacks): void {
  const s = getBattleItemScale(ctx)
  const shopScale = getShopItemScale()

  if (ctx.shopPanel) {
    ctx.shopPanel.x = getDebugCfg('shopAreaX')
    ctx.shopPanel.y = getDebugCfg('shopAreaY')
    ctx.shopPanel.setItemScale(shopScale)
    ctx.shopPanel.setTierBorderWidth(getDebugCfg('tierBorderWidth'))
    ctx.shopPanel.setCornerRadius(getDebugCfg('gridItemCornerRadius'))
  }
  if (ctx.battleView) {
    ctx.battleView.scale.set(s)
    ctx.battleView.x = getBattleZoneX(getDayActiveCols(ctx.currentDay), ctx)
    ctx.battleView.y = getDebugCfg('battleZoneY') + (CELL_HEIGHT * (1 - s)) / 2
    ctx.battleView.setTierBorderWidth(getDebugCfg('tierBorderWidth'))
    ctx.battleView.setCornerRadius(getDebugCfg('gridItemCornerRadius'))
    ctx.battleView.setCellBorderWidth(getDebugCfg('gridCellBorderWidth'))
  }
  if (ctx.backpackView) {
    ctx.backpackView.scale.set(s)
    ctx.backpackView.x = getBackpackZoneX(ctx.backpackView.activeColCount, ctx)
    ctx.backpackView.y = getBackpackZoneYByBattle(ctx)
    ctx.backpackView.setTierBorderWidth(getDebugCfg('tierBorderWidth'))
    ctx.backpackView.setCornerRadius(getDebugCfg('gridItemCornerRadius'))
    ctx.backpackView.setCellBorderWidth(getDebugCfg('gridCellBorderWidth'))
    ctx.backpackView.setLabelGlobalTop(ctx.backpackView.y - BACKPACK_LABEL_GLOBAL_Y_GAP)
  }
  if (ctx.battleZoneTitleText && ctx.battleView) {
    ctx.battleZoneTitleText.x = ctx.battleView.x + (ctx.battleView.activeColCount * CELL_SIZE * s) / 2
    ctx.battleZoneTitleText.y = ctx.battleView.y - BATTLE_ZONE_TITLE_TOP_GAP
  }
  if (ctx.backpackZoneTitleText && ctx.backpackView) {
    ctx.backpackZoneTitleText.x = ctx.backpackView.x + (ctx.backpackView.activeColCount * CELL_SIZE * s) / 2
    ctx.backpackZoneTitleText.y = ctx.backpackView.y - BACKPACK_ZONE_TITLE_TOP_GAP
  }
  if (ctx.bpBtnHandle) {
    ctx.bpBtnHandle.setCenter(getDebugCfg('backpackBtnX'), getDebugCfg('backpackBtnY'))
  }
  if (ctx.sellBtnHandle) {
    ctx.sellBtnHandle.setCenter(getDebugCfg('sellBtnX'), getDebugCfg('sellBtnY'))
  }
  if (ctx.refreshBtnHandle) {
    ctx.refreshBtnHandle.setCenter(getDebugCfg('refreshBtnX'), getDebugCfg('refreshBtnY'))
  }
  if (ctx.phaseBtnHandle) {
    ctx.phaseBtnHandle.setCenter(getDebugCfg('phaseBtnX'), getDebugCfg('phaseBtnY'))
  }
  if (ctx.goldText) {
    ctx.goldText.x = getDebugCfg('goldTextCenterX') - ctx.goldText.width / 2
    ctx.goldText.y = getDebugCfg('goldTextY')
  }
  if (ctx.dayDebugCon) {
    ctx.dayDebugCon.x = CANVAS_W / 2
    ctx.dayDebugCon.y = getDebugCfg('dayDebugY')
  }
  if (ctx.livesText) {
    ctx.livesText.x = CANVAS_W - ctx.livesText.width - 18
    ctx.livesText.y = 18
  }
  layoutPlayerStatusPanel(ctx)
  if (ctx.miniMapCon) {
    ctx.miniMapCon.x = getDebugCfg('backpackBtnX') - MINI_W / 2
    ctx.miniMapCon.y = getDebugCfg('backpackBtnY') + BTN_RADIUS + 8
  }
  callbacks.layoutSkillIconBar()

  if (ctx.shopAreaBg) { ctx.shopAreaBg.clear(); ctx.shopAreaBg.visible = false }
  if (ctx.backpackAreaBg) { ctx.backpackAreaBg.clear(); ctx.backpackAreaBg.visible = false }
  if (ctx.battleAreaBg) { ctx.battleAreaBg.clear(); ctx.battleAreaBg.visible = false }

  applyTextSizesFromDebug(ctx)
  applyItemInfoPanelLayout(ctx)
  applyAreaLabelLeftAlign(ctx)
  callbacks.applyPhaseUiVisibility()
}
