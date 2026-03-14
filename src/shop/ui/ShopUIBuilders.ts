// ============================================================
// ShopUIBuilders — 顶部区域 UI + 按钮行 UI 构建
// 提取自 ShopScene.ts Phase 8 Batch F
// 包含：buildTopAreaUI / buildButtonRowUI
// ============================================================

import type { ShopSceneCtx, CircleBtnHandle } from '../ShopSceneContext'
import { SceneManager } from '@/core/SceneManager'
import { PvpContext } from '@/pvp/PvpContext'
import { clearBattleOutcome } from '@/battle/BattleOutcomeStore'
import { setBattleSnapshot } from '@/battle/BattleSnapshotStore'
import { Container, Graphics, Sprite, Text, Texture, Rectangle, type FederatedPointerEvent } from 'pixi.js'
import { GridSystem } from '@/common/grid/GridSystem'
import { GridZone } from '@/common/grid/GridZone'
import type { ItemDef } from '@/common/items/ItemDef'
import { getAllItems, getConfig as getGameCfg } from '@/core/DataLoader'
import { getConfig as getDebugCfg, onConfigChange as onDebugCfgChange } from '@/config/debugConfig'
import { SellPopup } from '@/common/ui/SellPopup'
import { CANVAS_W, CANVAS_H, BTN_RADIUS } from '@/config/layoutConstants'
import {
  instanceToDefId,
  removeInstanceMeta,
  getInstanceEnchantment,
  getInstanceTier,
  getInstanceTierStar,
} from '../systems/ShopInstanceRegistry'
import { getItemEnchantmentDisplay, resolveItemEnchantmentEffectCn } from '@/common/items/ItemEnchantment'
import { layoutPlayerStatusPanel } from './PlayerStatusUI'
import { toVisualTier, getBattleZoneDisplayY } from '../ShopMathHelpers'
import {
  isShopInputEnabled,
  resolveInfoMode,
} from '../ShopModeHelpers'
import {
  showBuyGuideHand,
  showMoveToBattleGuideHand,
} from './ShopAnimationEffects'
import { showHintToast } from './ShopToastSystem'
import { buildBattleSnapshot } from '../ShopBattleSnapshot'
import { getShopSlotPreviewPrice } from '../systems/ShopPurchaseLogic'
import {
  applySellButtonState,
  setSellButtonPrice,
  clearSelection,
  sortBackpackItemsByRule,
  onShopDragMove as _onShopDragMove,
  onShopDragEnd as _onShopDragEnd,
} from '../systems/ShopDragSystem'
import type { ShopDragDeps } from '../systems/ShopDragSystem'
import { isNeutralTargetStone } from '../panels/NeutralItemPanel'
import { refreshBackpackSynthesisGuideArrows, clearBackpackSynthesisGuideArrows } from '../systems/ShopSynthesisController'
import { refreshLevelQuickRewardLayout } from '../systems/ShopRewardSystem'
import {
  applyLayoutFromDebug,
  applyTextSizesFromDebug,
  layoutDayDebugControls,
} from './ShopDebugLayout'
import type { DebugLayoutCallbacks } from './ShopDebugLayout'

// ---- 公共类型 ----

export type TopAreaUICallbacks = {
  restartRunFromBeginning: () => void
  toggleHeroPassiveDetailPopup: () => void
  pvpBuildAllPlayersLayer: () => void
  pvpRefreshSideCardStates: () => void
}

export type ButtonRowUICallbacks = {
  buyRandomBronzeToBoardOrBackpack: () => void
  canAffordQuickBuyNow: () => boolean
  beginBattleStartTransition: () => void
  setDay: (day: number) => void
  ensureBottomHudVisibleAndOnTop: (stage: Container) => void
  pvpShowWaitingPanel: (stage: Container) => void
  createSettingsButton: () => void
  getQuickBuyPricePreviewLabel: () => string
  hideSkillDetailPopup: () => void
  refreshBattlePassiveStatBadges: (showJump?: boolean) => void
  handleSpecialShopBackpackItemTap: (id: string, kind: 'battle' | 'backpack') => void
  refreshNeutralStoneGuideArrows: (sourceDef: ItemDef | null | undefined, excludeInstanceId?: string) => void
  // 传入 drag/debug 依赖，供内部事件 handler 用
  dragDeps: ShopDragDeps
  debugLayoutCallbacks: DebugLayoutCallbacks
}

// ---- buildTopAreaUI ----

export function buildTopAreaUI(
  stage: Container,
  cfg: ReturnType<typeof getGameCfg>,
  ctx: ShopSceneCtx,
  callbacks: TopAreaUICallbacks,
): void {
  ctx.shopAreaBg = new Graphics()
  stage.addChild(ctx.shopAreaBg)
  ctx.backpackAreaBg = new Graphics()
  stage.addChild(ctx.backpackAreaBg)
  ctx.battleAreaBg = new Graphics()
  stage.addChild(ctx.battleAreaBg)

  const restartLabel = new Text({
    text: '重新开始',
    style: { fontSize: cfg.textSizes.refreshCost, fill: 0xffe8a3, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  const restartBg = new Graphics()
  const restartPadX = 18, restartPadY = 10
  const restartW = restartLabel.width + restartPadX * 2
  const restartH = restartLabel.height + restartPadY * 2
  restartBg.roundRect(0, 0, restartW, restartH, 14)
  restartBg.fill({ color: 0x1f2940, alpha: 0.88 })
  restartBg.stroke({ color: 0xffd25a, width: 2, alpha: 0.95 })
  restartLabel.x = restartPadX; restartLabel.y = restartPadY
  const restartCon = new Container()
  restartCon.x = 16; restartCon.y = 16
  restartCon.eventMode = 'static'; restartCon.cursor = 'pointer'
  restartCon.hitArea = new Rectangle(0, 0, restartW, restartH)
  restartCon.addChild(restartBg, restartLabel)
  restartCon.on('pointerdown', (e: FederatedPointerEvent) => {
    e.stopPropagation()
    callbacks.restartRunFromBeginning()
  })
  ctx.restartBtn = restartCon
  stage.addChild(restartCon)

  ctx.playerStatusCon = new Container()
  ctx.playerStatusCon.zIndex = 95
  ctx.playerStatusCon.x = getDebugCfg('shopPlayerStatusX')
  ctx.playerStatusCon.y = getBattleZoneDisplayY(ctx) + getDebugCfg('shopPlayerStatusY')

  ctx.playerStatusAvatar = new Sprite(Texture.WHITE)
  ctx.playerStatusAvatar.x = 260
  ctx.playerStatusAvatar.y = 10
  ctx.playerStatusAvatar.width = 120
  ctx.playerStatusAvatar.height = 120
  ctx.playerStatusAvatar.alpha = 0
  ctx.playerStatusAvatar.eventMode = 'static'
  ctx.playerStatusAvatar.cursor = 'pointer'
  ctx.playerStatusAvatar.on('pointerdown', (e: FederatedPointerEvent) => {
    e.stopPropagation()
    callbacks.toggleHeroPassiveDetailPopup()
  })
  ctx.playerStatusCon.addChild(ctx.playerStatusAvatar)

  ctx.playerStatusAvatarClickHit = new Graphics()
  ctx.playerStatusAvatarClickHit.eventMode = 'static'
  ctx.playerStatusAvatarClickHit.cursor = 'pointer'
  ctx.playerStatusAvatarClickHit.on('pointerdown', (e: FederatedPointerEvent) => {
    e.stopPropagation()
    callbacks.toggleHeroPassiveDetailPopup()
  })
  ctx.playerStatusCon.addChild(ctx.playerStatusAvatarClickHit)

  ctx.playerStatusDailySkillStar = new Text({
    text: '★',
    style: { fontSize: 28, fill: 0xffd24a, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x4a2d00, width: 3 } },
  })
  ctx.playerStatusDailySkillStar.anchor.set(0.5)
  ctx.playerStatusDailySkillStar.visible = false
  ctx.playerStatusCon.addChild(ctx.playerStatusDailySkillStar)

  ctx.playerStatusExpBg = new Graphics()
  ctx.playerStatusCon.addChild(ctx.playerStatusExpBg)

  ctx.playerStatusExpBar = new Graphics()
  ctx.playerStatusCon.addChild(ctx.playerStatusExpBar)

  ctx.playerStatusLvText = new Text({
    text: 'Lv1',
    style: {
      fontSize: getDebugCfg('shopPlayerStatusLvFontSize'),
      fill: 0xf3f8ff, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x0f172b, width: 3 },
    },
  })
  ctx.playerStatusLvText.anchor.set(0.5)
  ctx.playerStatusCon.addChild(ctx.playerStatusLvText)

  layoutPlayerStatusPanel(ctx)
  stage.addChild(ctx.playerStatusCon)

  ctx.livesText = new Text({
    text: '❤️ 5/5',
    style: { fontSize: cfg.textSizes.refreshCost, fill: 0xffd4d4, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 3 } },
  })
  ctx.livesText.zIndex = 95
  stage.addChild(ctx.livesText)

  if (PvpContext.isActive() && PvpContext.getPvpMode() === 'sync-a') {
    callbacks.pvpBuildAllPlayersLayer()
    PvpContext.onOpponentPreAssigned = () => {
      callbacks.pvpBuildAllPlayersLayer()
    }
    PvpContext.onRoundSummaryReceived = () => {
      callbacks.pvpBuildAllPlayersLayer()
    }
    PvpContext.onSyncReadyUpdate = () => {
      callbacks.pvpRefreshSideCardStates()
    }
    PvpContext.onBeforeBattleTransition = () => {
      if (ctx.pvpAllPlayersLayer) ctx.pvpAllPlayersLayer.visible = false
    }
  }

  ctx.trophyText = new Text({
    text: '🏆 0/10',
    style: { fontSize: cfg.textSizes.refreshCost, fill: 0xffe8b4, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 3 } },
  })
  ctx.trophyText.zIndex = 95
  stage.addChild(ctx.trophyText)
}

// ---- buildButtonRowUI ----

export function buildButtonRowUI(
  stage: Container,
  cfg: ReturnType<typeof getGameCfg>,
  ctx: ShopSceneCtx,
  callbacks: ButtonRowUICallbacks,
): void {
  const PHASE_BTN_W = BTN_RADIUS * 4
  const PHASE_BTN_H = BTN_RADIUS * 2

  ctx.btnRow = new Container()
  ctx.btnRow.x = 0; ctx.btnRow.y = 0

  function makeCircleBtn(
    cx: number, cy: number, label: string, activeColor: number,
    inactiveColor = 0xcc3333, mainFontSize = cfg.textSizes.shopButtonLabel,
  ): CircleBtnHandle {
    const g = new Graphics()
    const txt = new Text({ text: label, style: { fontSize: mainFontSize, fill: 0xeebbbb, fontFamily: 'Arial', fontWeight: 'bold' } })
    txt.name = 'btn-main'
    const sub = new Text({ text: '', style: { fontSize: cfg.textSizes.sellButtonSubPrice, fill: 0xffd700, fontFamily: 'Arial', fontWeight: 'bold' } })
    sub.name = 'sell-price'; sub.visible = false
    let curCx = cx, curCy = cy, curActive = false
    const container = new Container()
    container.addChild(g, txt, sub); container.eventMode = 'static'; container.cursor = 'pointer'
    const redraw = (active: boolean) => {
      curActive = active
      g.clear(); g.circle(curCx, curCy, BTN_RADIUS); g.stroke({ color: active ? activeColor : inactiveColor, width: 3 })
      if (active) g.fill({ color: activeColor, alpha: 0.15 })
      txt.style.fill = active ? activeColor : inactiveColor
      const gap = Math.max(2, Math.round(txt.height * 0.08))
      const groupH = sub.visible ? (txt.height + gap + sub.height) : txt.height
      const groupTop = curCy - groupH / 2
      txt.x = curCx - txt.width / 2; txt.y = groupTop
      sub.x = curCx - sub.width / 2; sub.y = txt.y + txt.height + gap
      container.hitArea = new Rectangle(curCx - BTN_RADIUS, curCy - BTN_RADIUS, BTN_RADIUS * 2, BTN_RADIUS * 2)
    }
    const setCenter = (nx: number, ny: number) => { curCx = nx; curCy = ny; redraw(curActive) }
    const setLabel = (l: string) => { txt.text = l; redraw(curActive) }
    const setSubLabel = (t: string) => { sub.text = t; sub.visible = t.length > 0; redraw(curActive) }
    redraw(false)
    return { container, redraw, setCenter, setLabel, setSubLabel }
  }

  function makePhaseRectBtn(
    cx: number, cy: number, label: string, activeColor: number,
    inactiveColor = 0xffcc44, mainFontSize = cfg.textSizes.phaseButtonLabel,
  ): CircleBtnHandle {
    const g = new Graphics()
    const txt = new Text({ text: label, style: { fontSize: mainFontSize, fill: 0x1a1a2a, fontFamily: 'Arial', fontWeight: 'bold' } })
    txt.name = 'btn-main'
    const sub = new Text({ text: '', style: { fontSize: cfg.textSizes.sellButtonSubPrice, fill: 0xffd700, fontFamily: 'Arial', fontWeight: 'bold' } })
    sub.name = 'sell-price'; sub.visible = false
    let curCx = cx, curCy = cy, curActive = true
    const container = new Container()
    container.addChild(g, txt, sub); container.eventMode = 'static'; container.cursor = 'pointer'
    const redraw = (active: boolean) => {
      curActive = active
      const drawColor = active ? activeColor : inactiveColor
      const left = curCx - PHASE_BTN_W / 2, top = curCy - PHASE_BTN_H / 2
      const corner = Math.max(10, Math.round(getDebugCfg('gridItemCornerRadius') + 8))
      g.clear(); g.roundRect(left, top, PHASE_BTN_W, PHASE_BTN_H, corner)
      g.stroke({ color: drawColor, width: 3 }); g.fill({ color: drawColor, alpha: 0.18 })
      txt.style.fill = drawColor
      const gap = Math.max(2, Math.round(txt.height * 0.08))
      const groupH = sub.visible ? (txt.height + gap + sub.height) : txt.height
      const groupTop = curCy - groupH / 2
      txt.x = curCx - txt.width / 2; txt.y = groupTop
      sub.x = curCx - sub.width / 2; sub.y = txt.y + txt.height + gap
      container.hitArea = new Rectangle(left, top, PHASE_BTN_W, PHASE_BTN_H)
    }
    const setCenter = (nx: number, ny: number) => { curCx = nx; curCy = ny; redraw(curActive) }
    const setLabel = (l: string) => { txt.text = l; redraw(curActive) }
    const setSubLabel = (t: string) => { sub.text = t; sub.visible = t.length > 0; redraw(curActive) }
    redraw(true)
    return { container, redraw, setCenter, setLabel, setSubLabel }
  }

  ctx.bpBtnHandle = null

  // 购买按钮（矩形）
  const refreshBtn = makePhaseRectBtn(getDebugCfg('refreshBtnX'), getDebugCfg('refreshBtnY'), '购买', 0x44aaff, 0x44aaff, cfg.textSizes.phaseButtonLabel)
  refreshBtn.container.on('pointerdown', () => {
    if (!isShopInputEnabled(ctx)) return
    clearSelection(ctx, callbacks.dragDeps)
    callbacks.buyRandomBronzeToBoardOrBackpack()
    refreshBtn.redraw(false)
  })
  ctx.refreshBtnHandle = refreshBtn
  ctx.btnRow.addChild(refreshBtn.container)
  refreshBtn.setSubLabel(`💰 ${ctx.shopManager!.gold}/${callbacks.getQuickBuyPricePreviewLabel()}`)
  ctx.refreshCostText = null
  ctx.goldText = null

  // 整理按钮
  const sellBtn = makeCircleBtn(getDebugCfg('sellBtnX'), getDebugCfg('sellBtnY'), '整理', 0x3b74ff, 0x3b74ff)
  sellBtn.container.on('pointerdown', () => {
    if (!isShopInputEnabled(ctx)) return
    if (ctx.selectedSellAction) ctx.selectedSellAction = null
    clearSelection(ctx, callbacks.dragDeps)
    sortBackpackItemsByRule(ctx, callbacks.dragDeps)
  })
  ctx.sellBtnHandle = sellBtn
  ctx.btnRow.addChild(sellBtn.container)

  // 战斗切换按钮
  const phaseBtn = makeCircleBtn(getDebugCfg('phaseBtnX'), getDebugCfg('phaseBtnY'), '战斗', 0xffcc44, 0xffcc44, cfg.textSizes.shopButtonLabel)
  phaseBtn.container.on('pointerdown', () => {
    if (!isShopInputEnabled(ctx)) { SceneManager.goto('shop'); return }
    if (ctx.battleStartTransition) return
    if (ctx.levelQuickRewardOverlay) {
      showHintToast('no_gold_buy', '请先选择奖励', 0xffd86b, ctx)
      return
    }
    const boardItemCount = ctx.battleSystem?.getAllItems().length ?? 0
    const backpackItemCount = ctx.backpackSystem?.getAllItems().length ?? 0
    if (boardItemCount <= 0 && callbacks.canAffordQuickBuyNow()) {
      showBuyGuideHand(ctx)
      return
    }
    if (boardItemCount <= 0 && backpackItemCount > 0) {
      if (!PvpContext.isActive()) {
        showMoveToBattleGuideHand(ctx)
        return
      }
    }
    clearBattleOutcome()
    ctx.pendingSkillBarMoveStartAtMs = Date.now()
    const snapshot = buildBattleSnapshot(ctx, ctx.pendingSkillBarMoveStartAtMs)
    if (snapshot) {
      setBattleSnapshot(snapshot)
      console.log(`[ShopScene] 战斗快照已生成 day=${snapshot.day} entities=${snapshot.entities.length} cols=${snapshot.activeColCount}`)
    }
    ctx.pendingBattleTransition = true
    ctx.pendingAdvanceToNextDay = true
    if (PvpContext.isActive()) {
      ctx.pvpReadyLocked = true
      ctx.phaseBtnHandle?.setLabel('等待...')
      ctx.phaseBtnHandle?.redraw(true)
      if (PvpContext.getPvpMode() === 'sync-a') callbacks.pvpShowWaitingPanel(stage)
      PvpContext.onPlayerReady()
      return
    }
    callbacks.beginBattleStartTransition()
  })
  ctx.phaseBtnHandle = phaseBtn
  ctx.btnRow.addChild(phaseBtn.container)

  ctx.miniMapGfx = null
  ctx.miniMapCon = null
  stage.addChild(ctx.btnRow)
  callbacks.ensureBottomHudVisibleAndOnTop(stage)

  // 丢弃弹窗选中
  const selectGridItem = (instanceId: string, system: GridSystem, view: GridZone, kind: 'battle' | 'backpack') => {
    const defId = instanceToDefId.get(instanceId)
    if (!defId || !ctx.sellPopup || !ctx.shopManager) return
    const item = getAllItems().find(i => i.id === defId)
    if (!item) return
    ctx.battleView?.setSelected(kind === 'battle' ? instanceId : null)
    ctx.backpackView?.setSelected(kind === 'backpack' ? instanceId : null)
    ctx.shopPanel?.setSelectedSlot(-1)
    ctx.currentSelection = kind === 'battle' ? { kind: 'battle', instanceId } : { kind: 'backpack', instanceId }
    callbacks.hideSkillDetailPopup()
    if (kind === 'battle') callbacks.refreshBattlePassiveStatBadges(false)
    const tier = getInstanceTier(instanceId)
    const star = getInstanceTierStar(instanceId)
    if (isNeutralTargetStone(item)) callbacks.refreshNeutralStoneGuideArrows(item, instanceId)
    else refreshBackpackSynthesisGuideArrows(defId, tier ?? null, star, ctx, instanceId)
    const sellPrice = 0
    const infoMode = resolveInfoMode(`${kind}:${instanceId}:${tier}:${star}`, ctx)
    const enchantment = getInstanceEnchantment(instanceId)
    const enchantDisplay = enchantment
      ? {
        ...getItemEnchantmentDisplay(enchantment),
        effectCn: resolveItemEnchantmentEffectCn(item, enchantment),
      }
      : undefined
    ctx.sellPopup.show(item, sellPrice, 'none', toVisualTier(tier, star), undefined, infoMode, undefined, undefined, enchantDisplay)
    ctx.selectedSellAction = () => {
      system.remove(instanceId); view.removeItem(instanceId)
      removeInstanceMeta(instanceId); ctx.drag?.refreshZone(view)
    }
    setSellButtonPrice(sellPrice, ctx)
    applySellButtonState(ctx)
  }

  const handleShopSlotTap = (slotIndex: number) => {
    if (!isShopInputEnabled(ctx)) return
    if (!ctx.shopManager || !ctx.sellPopup) return
    const slot = ctx.shopManager.pool[slotIndex]
    if (!slot) return
    clearBackpackSynthesisGuideArrows(ctx)
    ctx.shopPanel?.setSelectedSlot(slotIndex)
    ctx.battleView?.setSelected(null); ctx.backpackView?.setSelected(null)
    ctx.currentSelection = { kind: 'shop', slotIndex }; ctx.selectedSellAction = null
    const infoMode = resolveInfoMode(`shop:${slotIndex}:${slot.item.id}:${slot.tier}`, ctx)
    callbacks.hideSkillDetailPopup()
    ctx.sellPopup.show(slot.item, getShopSlotPreviewPrice(slot, ctx), 'buy', toVisualTier(slot.tier, 1), undefined, infoMode)
    applySellButtonState(ctx)
  }

  ctx.backpackView!.onTap = (id) => {
    if (!isShopInputEnabled(ctx)) return
    if (ctx.specialShopBackpackViewActive) { callbacks.handleSpecialShopBackpackItemTap(id, 'backpack'); return }
    selectGridItem(id, ctx.backpackSystem!, ctx.backpackView!, 'backpack')
  }
  ctx.battleView!.onTap = (id) => {
    if (!isShopInputEnabled(ctx)) return
    if (ctx.specialShopBackpackViewActive) { callbacks.handleSpecialShopBackpackItemTap(id, 'battle'); return }
    selectGridItem(id, ctx.battleSystem!, ctx.battleView!, 'battle')
  }
  ctx.shopPanel!.onTap = (slotIndex) => handleShopSlotTap(slotIndex)

  ctx.sellPopup = new SellPopup(CANVAS_W, CANVAS_H)
  const rawSellPopupShow = ctx.sellPopup.show.bind(ctx.sellPopup)
  ctx.sellPopup.show = ((...args: Parameters<SellPopup['show']>) => {
    callbacks.hideSkillDetailPopup()
    return rawSellPopupShow(...args)
  }) as SellPopup['show']
  ctx.sellPopup.zIndex = 20
  stage.addChild(ctx.sellPopup)
  applyLayoutFromDebug(ctx, callbacks.debugLayoutCallbacks)

  ctx.offDebugCfg = onDebugCfgChange((key) => {
    const layoutKeys = [
      'shopAreaX','shopAreaY','shopItemScale','battleItemScale','battleItemScaleBackpackOpen',
      'enemyAreaScale','battleZoneX','battleZoneY','backpackZoneX','backpackZoneY',
      'backpackBtnX','backpackBtnY','sellBtnX','sellBtnY','refreshBtnX','refreshBtnY',
      'phaseBtnX','phaseBtnY','goldTextCenterX','goldTextY','shopPlayerStatusY','shopPlayerStatusX',
      'shopPlayerStatusLvY','shopPlayerStatusExpBarWidth','shopPlayerStatusExpBarHeight',
      'shopPlayerStatusExpBarOffsetX','shopPlayerStatusExpBarOffsetY',
      'levelQuickRewardOffsetX','levelQuickRewardOffsetY',
      'dayDebugX','dayDebugY','tierBorderWidth','gridItemCornerRadius','gridCellBorderWidth',
      'shopAreaBgWidth','shopAreaBgHeight','backpackAreaBgWidth','backpackAreaBgHeight',
      'itemInfoWidth','itemInfoMinH','itemInfoMinHSmall','itemInfoBottomGapToShop',
      'gridZoneLabelFontSize','shopButtonLabelFontSize','phaseButtonLabelFontSize',
      'sellButtonSubPriceFontSize','refreshCostFontSize','goldFontSize',
      'shopPlayerStatusLvFontSize','dayDebugArrowFontSize','dayDebugLabelFontSize',
      'shopItemNameFontSize','shopItemPriceFontSize','shopItemBoughtFontSize',
      'itemStatBadgeFontSize','itemTierStarFontSize','itemTierStarStrokeWidth',
      'itemTierStarOffsetX','itemTierStarOffsetY','itemStatBadgeOffsetY',
      'itemInfoNameFontSize','itemInfoTierFontSize','itemInfoPriceFontSize',
      'itemInfoPriceCornerFontSize','itemInfoCooldownFontSize','itemInfoDescFontSize',
      'itemInfoSimpleDescFontSize','battleOrbColorHp','battleColorShield',
      'battleColorBurn','battleColorPoison','battleColorRegen','gameplayItemFrameColorByArchetype',
      'gameplayBackpackRows','gameplayBackpackRowsDynamicByDay',
    ] as const
    if ((layoutKeys as readonly string[]).includes(key)) {
      applyLayoutFromDebug(ctx, callbacks.debugLayoutCallbacks)
      refreshLevelQuickRewardLayout(ctx)
    }
  })

  ctx.onStageTapHidePopup = () => { if (ctx.shopDragFloater) return; clearSelection(ctx, callbacks.dragDeps) }
  stage.on('pointerdown', ctx.onStageTapHidePopup)

  ctx.onStageShopPointerMove = (e: FederatedPointerEvent) => { if (ctx.shopDragFloater) _onShopDragMove(e, ctx, callbacks.dragDeps) }
  ctx.onStageShopPointerUp = (e: FederatedPointerEvent) => { if (ctx.shopDragFloater) void _onShopDragEnd(e, stage, ctx, callbacks.dragDeps) }
  ctx.onStageShopPointerUpOutside = (e: FederatedPointerEvent) => { if (ctx.shopDragFloater) void _onShopDragEnd(e, stage, ctx, callbacks.dragDeps) }
  stage.on('pointermove', ctx.onStageShopPointerMove)
  stage.on('pointerup', ctx.onStageShopPointerUp)
  stage.on('pointerupoutside', ctx.onStageShopPointerUpOutside)

  ctx.dayDebugCon = new Container()
  ctx.dayDebugCon.x = CANVAS_W / 2
  ctx.dayDebugCon.y = getDebugCfg('dayDebugY')

  const prevDayBtn = new Text({ text: '◀', style: { fontSize: cfg.textSizes.dayDebugArrow, fill: 0x888888 } })
  prevDayBtn.eventMode = 'static'; prevDayBtn.cursor = 'pointer'
  prevDayBtn.on('pointerdown', (e: FederatedPointerEvent) => {
    e.stopPropagation()
    if (!isShopInputEnabled(ctx)) return
    callbacks.setDay(ctx.currentDay - 1)
  })

  ctx.dayDebugText = new Text({ text: `Day ${ctx.currentDay}`, style: { fontSize: cfg.textSizes.dayDebugLabel, fill: 0xcccccc, fontFamily: 'Arial' } })

  const nextDayBtn = new Text({ text: '▶', style: { fontSize: cfg.textSizes.dayDebugArrow, fill: 0x888888 } })
  nextDayBtn.eventMode = 'static'; nextDayBtn.cursor = 'pointer'
  nextDayBtn.on('pointerdown', (e: FederatedPointerEvent) => {
    e.stopPropagation()
    if (!isShopInputEnabled(ctx)) return
    callbacks.setDay(ctx.currentDay + 1)
  })

  ctx.dayDebugCon.addChild(prevDayBtn, ctx.dayDebugText, nextDayBtn)
  stage.addChild(ctx.dayDebugCon)
  ctx.dayPrevBtn = prevDayBtn; ctx.dayNextBtn = nextDayBtn
  layoutDayDebugControls(ctx)
  callbacks.createSettingsButton()
  applyTextSizesFromDebug(ctx)
}
