// ============================================================
// ShopBattleZoneBuilder — 战斗区 UI 构建
// 提取自 ShopScene.ts Phase 8
// 包含：buildBattleZoneUI
// ============================================================

import { DragController } from '@/common/grid/DragController'
import { GridSystem } from '@/common/grid/GridSystem'
import type { ItemSizeNorm } from '@/common/grid/GridSystem'
import { GridZone } from '@/common/grid/GridZone'
import { ShopPanelView } from '@/shop/ui/ShopPanelView'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { getConfig as getGameCfg, getAllItems } from '@/core/DataLoader'
import { getApp } from '@/core/AppContext'
import { normalizeSize, type ItemDef } from '@/common/items/ItemDef'
import type { TierKey } from '@/shop/ShopManager'
import { Container, Text, type FederatedPointerEvent } from 'pixi.js'
import type { ItemInfoCustomDisplay } from '@/common/ui/SellPopup'
import {
  instanceToDefId,
  getInstanceTier,
  getInstanceTierStar,
  getInstanceLevel,
  removeInstanceMeta,
} from '../systems/ShopInstanceRegistry'
import {
  getItemDefById,
  isNeutralItemDef,
  nextTierLevel,
  canUseLv7MorphSynthesis,
} from '../systems/ShopSynthesisLogic'
import {
  isNeutralTargetStone,
  type NeutralChoiceCandidate,
  type SynthesisTarget,
} from '../panels/NeutralItemPanel'
import { showHintToast } from './ShopToastSystem'
import {
  toVisualTier,
  getBattleZoneX,
  getBackpackZoneX,
  getBackpackZoneYByBattle,
} from '../ShopMathHelpers'
import {
  isOverGridDragSellArea,
  isOverAnyGridDropTarget,
  isOverBpBtn,
  isPointInZoneArea,
  updateGridDragSellAreaHover,
} from '../systems/ShopDragSystem'
import {
  canBackpackAcceptByAutoPack,
  buildBackpackAutoPackPlan,
  applyBackpackAutoPackExisting,
} from '../systems/ShopAutoPackManager'
import {
  getDefaultItemInfoMode,
} from '../ShopModeHelpers'
import {
  findSynthesisTargetWithDragProbe,
  getSynthesisTargetItem,
  highlightSynthesisTarget,
  clearBackpackSynthesisGuideArrows,
  refreshBackpackSynthesisGuideArrows,
  findBattleSynthesisTargetWithDragProbeIgnoringNoSynthesis,
  isBattleZoneNoSynthesisEnabled,
  type SynthesizeResult,
  type SynthesisCallbacks,
} from '../systems/ShopSynthesisController'
import { playSynthesisFlashEffect } from './ShopAnimationEffects'
import { restoreDraggedItemToZone } from '../systems/ShopGridInventory'
import type { ShopSceneCtx } from '../ShopSceneContext'

// ---- 内联辅助 ----

function isCrossIdSynthesisConfirmEnabled(): boolean {
  const runtimeToggle = getDebugCfg('gameplayCrossSynthesisConfirm') >= 0.5
  if (runtimeToggle) return true
  return getGameCfg().shopRules?.crossIdSynthesisRequireConfirm === true
}

// ---- 公共类型 ----

export type BattleZoneUICallbacks = {
  refreshShopUI: () => void
  isBackpackDropLocked: (col: number, row: number, size: ItemSizeNorm) => boolean
  clearSelection: () => void
  grantHeroDiscardSameLevelReward: (defId: string, level: 1 | 2 | 3 | 4 | 5 | 6 | 7) => void
  checkAndPopPendingRewards: () => void
  grantSynthesisExp: (amount?: number, from?: { instanceId: string; zone: 'battle' | 'backpack' }) => void
  updateMiniMap: () => void
  refreshBattlePassiveStatBadges: (showJump?: boolean) => void
  startShopDrag: (slotIndex: number, e: FederatedPointerEvent, stage: Container) => void
  startGridDragButtonFlash: (stage: Container, canSell: boolean, canToBackpack: boolean, sellPrice: number) => void
  stopGridDragButtonFlash: () => void
  setSellButtonPrice: (price: number) => void
  applySellButtonState: () => void
  // synthesis panel shims
  hideSynthesisHoverInfo: () => void
  showSynthesisHoverInfo: (defId: string, tier: TierKey, star: 1 | 2, target: SynthesisTarget) => void
  showCrossSynthesisConfirmOverlay: (
    source: { def: ItemDef; tier: TierKey; star: 1 | 2 },
    target: { def: ItemDef; tier: TierKey; star: 1 | 2 },
    toTier: TierKey,
    toStar: 1 | 2,
    onConfirm: () => void,
    onCancel?: () => void,
  ) => void
  // applyInstanceTierVisuals
  applyInstanceTierVisuals: () => void
  // NeutralItemPanel shims (all via neutralItemPanel?.method())
  refreshNeutralStoneGuideArrows: (sourceDef: ItemDef | null | undefined, excludeInstanceId?: string) => void
  applyNeutralDiscardEffect: (source: ItemDef, stage: Container) => boolean
  findNeutralStoneTargetWithDragProbe: (sourceDef: ItemDef, gx: number, gy: number, dragSize?: ItemSizeNorm) => SynthesisTarget | null
  applyNeutralStoneTargetEffect: (sourceDef: ItemDef, target: SynthesisTarget, stage: Container) => boolean
  showLv7MorphSynthesisConfirmOverlay: (stage: Container, onConfirm: () => void, onCancel?: () => void) => void
  buildStoneTransformChoices: (target: SynthesisTarget, rule: 'same' | 'other') => NeutralChoiceCandidate[]
  showNeutralChoiceOverlay: (stage: Container, title: string, candidates: NeutralChoiceCandidate[], onConfirm?: (c: NeutralChoiceCandidate) => boolean, mode?: 'default' | 'special_shop_like') => boolean
  transformPlacedItemKeepLevelTo: (instanceId: string, zone: 'battle' | 'backpack', def: ItemDef, withFx?: boolean) => boolean
  tryRunSameArchetypeDiffItemStoneSynthesis: (sourceInstanceId: string, sourceDefId: string, sourceTier: TierKey, sourceStar: 1 | 2, target: SynthesisTarget, restore: () => void) => boolean
  showNeutralStoneHoverInfo: (sourceDef: ItemDef, target: SynthesisTarget) => void
  // SynthesisCtrl / HeroSystem compound operations
  synthesizeTarget: (defId: string, tier: TierKey, star: 1 | 2, targetInstanceId: string, zone: 'battle' | 'backpack') => SynthesizeResult | null
  tryRunHeroCrossSynthesisReroll: (stage: Container, synth: SynthesizeResult) => boolean
  tryRunHeroSameItemSynthesisChoice: (stage: Container, defId: string, tier: TierKey, star: 1 | 2, target: SynthesisTarget, consumeSource: () => boolean) => boolean
}

// ---- 主函数 ----

export function buildBattleZoneUI(
  stage: Container,
  cfg: ReturnType<typeof getGameCfg>,
  ctx: ShopSceneCtx,
  callbacks: BattleZoneUICallbacks,
): void {
  const canvas = getApp().canvas as HTMLCanvasElement

  const {
    refreshShopUI,
    isBackpackDropLocked,
    clearSelection,
    grantHeroDiscardSameLevelReward,
    checkAndPopPendingRewards,
    grantSynthesisExp,
    updateMiniMap,
    refreshBattlePassiveStatBadges,
    startShopDrag,
    startGridDragButtonFlash,
    stopGridDragButtonFlash,
    setSellButtonPrice,
    applySellButtonState,
    hideSynthesisHoverInfo,
    showSynthesisHoverInfo,
    showCrossSynthesisConfirmOverlay,
    applyInstanceTierVisuals,
    refreshNeutralStoneGuideArrows,
    applyNeutralDiscardEffect,
    findNeutralStoneTargetWithDragProbe,
    applyNeutralStoneTargetEffect,
    showLv7MorphSynthesisConfirmOverlay,
    buildStoneTransformChoices,
    showNeutralChoiceOverlay,
    transformPlacedItemKeepLevelTo,
    tryRunSameArchetypeDiffItemStoneSynthesis,
    showNeutralStoneHoverInfo,
    synthesizeTarget,
    tryRunHeroCrossSynthesisReroll,
    tryRunHeroSameItemSynthesisChoice,
  } = callbacks

  const synthCbs: SynthesisCallbacks = {
    isBackpackDropLocked: (col, row, sz) => isBackpackDropLocked(col, row, sz),
    unlockItemToPool: (_defId) => false,
    applyInstanceTierVisuals: () => {},
    syncShopOwnedTierRules: () => {},
    grantSynthesisExp: (amt, from) => { if (from) grantSynthesisExp(amt, from) },
    checkAndPopPendingRewards: () => {},
  }

  // 商店面板
  ctx.shopPanel = new ShopPanelView()
  ctx.shopPanel.x = getDebugCfg('shopAreaX')
  ctx.shopPanel.y = getDebugCfg('shopAreaY')
  ctx.shopPanel.onDragStart = (slotIndex, e) => startShopDrag(slotIndex, e, stage)
  ctx.shopPanel.visible = false
  stage.addChild(ctx.shopPanel)

  // 格子系统
  const compactMode = cfg.gameplayModeValues?.compactMode
  const activeCols = compactMode?.enabled
    ? (compactMode.battleCols ?? 6)
    : (cfg.dailyBattleSlots[0] ?? 4)
  const backpackRows = compactMode?.enabled
    ? (compactMode.backpackRows ?? 3)
    : 2
  ctx.battleSystem   = new GridSystem(6)
  ctx.backpackSystem = new GridSystem(6, backpackRows)
  ctx.battleView     = new GridZone('上阵区', 6, activeCols, 1)
  ctx.backpackView   = new GridZone('背包', 6, 6, backpackRows)
  ctx.backpackView.setAutoPackEnabled(false)
  ctx.battleView.setStatBadgeMode('archetype')
  ctx.backpackView.setStatBadgeMode('archetype')
  ctx.battleView.x   = getBattleZoneX(activeCols, ctx)
  ctx.battleView.y   = getDebugCfg('battleZoneY')
  ctx.backpackView.x = getBackpackZoneX(ctx.backpackView.activeColCount, ctx)
  ctx.backpackView.y = getBackpackZoneYByBattle(ctx)
  ctx.backpackView.visible = true

  stage.addChild(ctx.battleView)
  stage.addChild(ctx.backpackView)
  ctx.battleZoneTitleText = new Text({
    text: '上阵区',
    style: {
      fontSize: cfg.textSizes.gridZoneLabel,
      fill: 0xd8e5ff,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      stroke: { color: 0x0f1a3a, width: 4 },
    },
  })
  ctx.battleZoneTitleText.anchor.set(0.5)
  ctx.battleZoneTitleText.zIndex = 14
  stage.addChild(ctx.battleZoneTitleText)

  ctx.backpackZoneTitleText = new Text({
    text: '背包区',
    style: {
      fontSize: cfg.textSizes.gridZoneLabel,
      fill: 0xd8e5ff,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      stroke: { color: 0x0f1a3a, width: 4 },
    },
  })
  ctx.backpackZoneTitleText.anchor.set(0.5)
  ctx.backpackZoneTitleText.zIndex = 14
  stage.addChild(ctx.backpackZoneTitleText)
  if (ctx.passiveJumpLayer) ctx.battleView.addChild(ctx.passiveJumpLayer)

  ctx.drag = new DragController(stage, canvas)
  ctx.drag.addZone(ctx.battleSystem,  ctx.battleView)
  ctx.drag.addZone(ctx.backpackSystem, ctx.backpackView)
  ctx.drag.onDropCellLocked = ({ view, col, row, size }) => {
    if (view !== ctx.backpackView) return false
    return isBackpackDropLocked(col, row, size)
  }
  ctx.drag.onDragStart = (instanceId: string) => {
    clearSelection()
    const defId = instanceToDefId.get(instanceId)
    if (!defId || !ctx.sellPopup || !ctx.shopManager) return
    const item = getAllItems().find(i => i.id === defId)
    if (!item) return
    const tier = getInstanceTier(instanceId)
    const star = getInstanceTierStar(instanceId)
    const sellPrice = 0
    if (isNeutralTargetStone(item)) refreshNeutralStoneGuideArrows(item, instanceId)
    else refreshBackpackSynthesisGuideArrows(defId, tier ?? null, star, ctx, instanceId)
    // 拖拽中视为选中：显示物品详情（不设置区域高亮，因物品已脱离格子）
    const inBattle = !!ctx.battleView?.hasItem(instanceId)
    ctx.currentSelection = { kind: inBattle ? 'battle' : 'backpack', instanceId }
    ctx.selectedSellAction = null  // 拖拽中暂不执行出售
    ctx.sellPopup.show(item, sellPrice, 'none', toVisualTier(tier, star), undefined, getDefaultItemInfoMode())
    setSellButtonPrice(sellPrice)
    applySellButtonState()

    // 按钮闪烁提示：可出售则闪出售；战斗区->背包（背包未打开且有空位）则闪背包按钮
    const canSell = true
    const canToBackpack = inBattle && !ctx.showingBackpack
      && canBackpackAcceptByAutoPack(item.id, normalizeSize(item.size), ctx)
    startGridDragButtonFlash(stage, canSell, canToBackpack, 0)
  }
  ctx.drag.onSpecialDrop = ({ instanceId, anchorGx, anchorGy, size, originCol, originRow, homeSystem, homeView, defId }) => {
    if (!ctx.shopManager) return false
    const item = getAllItems().find(i => i.id === defId)
    if (!item) return false

    const sourceDef = getItemDefById(defId)
    const sourceLevel = getInstanceLevel(instanceId)
    const overSellArea = isOverGridDragSellArea(anchorGx, anchorGy)
    const overAnyDropTarget = isOverAnyGridDropTarget(anchorGx, anchorGy, size, ctx)
    const forceDiscardForNeutralStone = !!sourceDef && isNeutralTargetStone(sourceDef) && overSellArea

    // 1) 拖到下方丢弃区域：直接丢弃
    // 普通物品：未命中任意格子候选时才丢弃；
    // 变化石/转职石：命中丢弃区时优先允许丢弃，避免"无目标时无法丢弃"。
    if ((overSellArea && !overAnyDropTarget) || forceDiscardForNeutralStone) {
      if (sourceDef && isNeutralItemDef(sourceDef)) {
        const ok = applyNeutralDiscardEffect(sourceDef, stage)
        if (!ok) return false
      }
      homeSystem.remove(instanceId)
      removeInstanceMeta(instanceId)
      showHintToast('no_gold_buy', `已丢弃：${sourceDef?.name_cn ?? item.name_cn}`, 0x9be5ff, ctx)
      if (sourceDef && sourceLevel) {
        grantHeroDiscardSameLevelReward(sourceDef.id, sourceLevel)
      }
      refreshShopUI()
      checkAndPopPendingRewards()
      return true
    }

    if (sourceDef && isNeutralTargetStone(sourceDef)) {
      const target = findNeutralStoneTargetWithDragProbe(sourceDef, anchorGx, anchorGy, size)
      if (!target) return false
      const ok = applyNeutralStoneTargetEffect(sourceDef, target, stage)
      if (!ok) return false
      homeSystem.remove(instanceId)
      removeInstanceMeta(instanceId)
      refreshShopUI()
      return true
    }

    const fromTier = getInstanceTier(instanceId) ?? 'Bronze'
    const fromStar = getInstanceTierStar(instanceId)

    if (
      isBattleZoneNoSynthesisEnabled()
      && homeView === ctx.backpackView
      && (!!nextTierLevel(fromTier, fromStar) || canUseLv7MorphSynthesis(defId, defId, fromTier, fromStar, fromTier, fromStar))
      && isPointInZoneArea(ctx.battleView, anchorGx, anchorGy)
    ) {
      const blockedBattleSynth = findBattleSynthesisTargetWithDragProbeIgnoringNoSynthesis(defId, fromTier, fromStar, anchorGx, anchorGy, size, ctx)
      if (blockedBattleSynth) {
        showHintToast('backpack_full_buy', '上阵区内无法合成', 0xffd48f, ctx)
      }
    }

    // 1.5) 拖到同装备同品质目标物品：执行合成（优先于挤出/普通落位）
    const canLv7Morph = canUseLv7MorphSynthesis(defId, defId, fromTier, fromStar, fromTier, fromStar)
    if (nextTierLevel(fromTier, fromStar) || canLv7Morph) {
      const synthTarget = findSynthesisTargetWithDragProbe(defId, fromTier, fromStar, anchorGx, anchorGy, size, ctx, synthCbs)
      if (synthTarget) {
        const targetItem = getSynthesisTargetItem(synthTarget, ctx)
        const targetTier = getInstanceTier(synthTarget.instanceId) ?? fromTier
        const targetStar = getInstanceTierStar(synthTarget.instanceId)
        const lv7MorphMode = !!targetItem && canUseLv7MorphSynthesis(defId, targetItem.defId, fromTier, fromStar, targetTier, targetStar)
        if (lv7MorphMode) {
          showLv7MorphSynthesisConfirmOverlay(stage, () => {
            const choices = buildStoneTransformChoices(synthTarget, 'same')
            if (choices.length <= 0) {
              showHintToast('backpack_full_buy', 'Lv7转化：当前无可用候选', 0xffb27a, ctx)
              restoreDraggedItemToZone(
                instanceId,
                defId,
                size,
                fromTier,
                fromStar,
                originCol,
                originRow,
                homeSystem,
                homeView,
                ctx,
              )
              refreshShopUI()
              return
            }
            const opened = showNeutralChoiceOverlay(stage, '选择变化方向', choices, (picked) => {
              const ok = transformPlacedItemKeepLevelTo(synthTarget.instanceId, synthTarget.zone, picked.item, true)
              if (!ok) {
                showHintToast('backpack_full_buy', 'Lv7转化失败', 0xff8f8f, ctx)
                return false
              }
              removeInstanceMeta(instanceId)
              grantSynthesisExp(1, { instanceId: synthTarget.instanceId, zone: synthTarget.zone })
              showHintToast('no_gold_buy', 'Lv7合成：已触发变化石效果', 0x9be5ff, ctx)
              refreshShopUI()
              return true
            }, 'special_shop_like')
            if (!opened) {
              showHintToast('backpack_full_buy', 'Lv7转化：当前无可用候选', 0xffb27a, ctx)
              restoreDraggedItemToZone(
                instanceId,
                defId,
                size,
                fromTier,
                fromStar,
                originCol,
                originRow,
                homeSystem,
                homeView,
                ctx,
              )
              refreshShopUI()
            }
          }, () => {
            restoreDraggedItemToZone(
              instanceId,
              defId,
              size,
              fromTier,
              fromStar,
              originCol,
              originRow,
              homeSystem,
              homeView,
              ctx,
            )
            refreshShopUI()
          })
          return true
        }
        if (targetItem && targetItem.defId !== defId) {
          const targetDef = getItemDefById(targetItem.defId)
          if (!targetDef) return false
          const upgradeTo = nextTierLevel(fromTier, fromStar)
          if (!upgradeTo) return false
          const restoreDragToHome = () => {
            restoreDraggedItemToZone(
              instanceId,
              defId,
              size,
              fromTier,
              fromStar,
              originCol,
              originRow,
              homeSystem,
              homeView,
              ctx,
            )
            refreshShopUI()
          }
          if (tryRunSameArchetypeDiffItemStoneSynthesis(
            instanceId,
            defId,
            fromTier,
            fromStar,
            synthTarget,
            restoreDragToHome,
          )) {
            return true
          }
          const runCrossSynthesis = () => {
            const synth = synthesizeTarget(defId, fromTier, fromStar, synthTarget.instanceId, synthTarget.zone)
            if (!synth) {
              showHintToast('backpack_full_buy', '合成目标无效', 0xff8f8f, ctx)
              restoreDragToHome()
              return
            }
            removeInstanceMeta(instanceId)
            playSynthesisFlashEffect(ctx, stage, synth)
            if (!tryRunHeroCrossSynthesisReroll(stage, synth)) {
              refreshShopUI()
            }
          }
          if (isCrossIdSynthesisConfirmEnabled()) {
            showCrossSynthesisConfirmOverlay(
              { def: item, tier: fromTier, star: fromStar },
              { def: targetDef, tier: targetTier, star: targetStar },
              upgradeTo.tier,
              upgradeTo.star,
              runCrossSynthesis,
              () => {
                restoreDragToHome()
              },
            )
          } else {
            runCrossSynthesis()
          }
          return true
        }

        if (tryRunHeroSameItemSynthesisChoice(
          stage,
          defId,
          fromTier,
          fromStar,
          synthTarget,
          () => {
            removeInstanceMeta(instanceId)
            return true
          },
        )) {
          return true
        }
        const synth = synthesizeTarget(defId, fromTier, fromStar, synthTarget.instanceId, synthTarget.zone)
        if (synth) {
          removeInstanceMeta(instanceId)
          playSynthesisFlashEffect(ctx, stage, synth)
          refreshShopUI()
          return true
        }
      }
    }

    // 2) 战斗区拖到背包按钮：背包未打开时执行自动整理后放入
    if (
      homeView === ctx.battleView
      && !ctx.showingBackpack
      && isOverBpBtn(anchorGx, anchorGy)
      && ctx.backpackSystem
      && ctx.backpackView
    ) {
      const autoPlan = buildBackpackAutoPackPlan(defId, size, ctx)
      if (!autoPlan) {
        showHintToast('backpack_full_transfer', '背包已满，无法转移', 0xff8f8f, ctx)
        return false
      }
      homeSystem.remove(instanceId)
      applyBackpackAutoPackExisting(autoPlan.existing, ctx)
      ctx.backpackSystem.place(autoPlan.incoming.col, autoPlan.incoming.row, size, defId, instanceId)
      const tier = getInstanceTier(instanceId)
      const star = getInstanceTierStar(instanceId)
      ctx.backpackView.addItem(instanceId, defId, size, autoPlan.incoming.col, autoPlan.incoming.row, toVisualTier(tier, star)).then(() => {
        ctx.backpackView!.setItemTier(instanceId, toVisualTier(tier, star))
        ctx.drag?.refreshZone(ctx.backpackView!)
      })
      refreshShopUI()
      return true
    }

    return false
  }
  ctx.drag.onDragMove = ({ instanceId, anchorGx, anchorGy, size }) => {
    updateGridDragSellAreaHover(anchorGx, anchorGy, size, ctx)

    // 可用状态随时重算（例如拖拽过程中背包可见状态变化）
    if (ctx.gridDragCanToBackpack) {
      ctx.gridDragCanToBackpack = !ctx.showingBackpack
    }

    const defId = instanceToDefId.get(instanceId)
    const tier = getInstanceTier(instanceId)
    const star = getInstanceTierStar(instanceId)
    const item = defId ? getItemDefById(defId) : null
    if (isNeutralTargetStone(item)) refreshNeutralStoneGuideArrows(item, instanceId)
    else refreshBackpackSynthesisGuideArrows(defId ?? null, tier ?? null, star, ctx, instanceId)

    const sellPrice = 0
    const overSell = ctx.gridDragCanSell && ctx.gridDragSellHot
    if (item && ctx.sellPopup && tier && overSell) {
      const stoneHint = isNeutralTargetStone(item)
        ? (item.name_cn === '转职石' ? '拖到目标物品上触发转职效果' : '拖到目标物品上触发变化效果')
        : '丢弃后不会获得金币'
      const customDisplay: ItemInfoCustomDisplay = {
        overrideName: `${item.name_cn}（拖拽丢弃）`,
        lines: [stoneHint],
        suppressStats: true,
      }
      ctx.sellPopup.show(item, sellPrice, 'none', toVisualTier(tier, star), undefined, 'detailed', undefined, customDisplay)
      ctx.drag?.setSqueezeSuppressed(false)
      hideSynthesisHoverInfo()
      return
    }

    const canLv7Morph = !!defId && !!tier && canUseLv7MorphSynthesis(defId, defId, tier, star, tier, star)
    if (!defId || !tier || (!nextTierLevel(tier, star) && !canLv7Morph)) {
      ctx.drag?.setSqueezeSuppressed(false)
      clearBackpackSynthesisGuideArrows(ctx)
      if (item && ctx.sellPopup) {
        ctx.sellPopup.show(item, sellPrice, 'none', toVisualTier(tier, star), undefined, getDefaultItemInfoMode())
      }
      return
    }

    if (item && isNeutralTargetStone(item)) {
      const target = findNeutralStoneTargetWithDragProbe(item, anchorGx, anchorGy, size)
      if (target) {
        ctx.drag?.setSqueezeSuppressed(true, true)
        highlightSynthesisTarget(target, ctx)
        showNeutralStoneHoverInfo(item, target)
      } else {
        ctx.drag?.setSqueezeSuppressed(false)
        hideSynthesisHoverInfo()
        if (ctx.sellPopup) {
          const customDisplay: ItemInfoCustomDisplay = {
            lines: ['拖到目标物品上触发效果'],
            suppressStats: true,
          }
          ctx.sellPopup.show(item, sellPrice, 'none', toVisualTier(tier, star), undefined, 'detailed', undefined, customDisplay)
        }
      }
      return
    }

    const synthTarget = findSynthesisTargetWithDragProbe(defId, tier, star, anchorGx, anchorGy, size, ctx, synthCbs)
    if (synthTarget) {
      ctx.drag?.setSqueezeSuppressed(true, true)
      highlightSynthesisTarget(synthTarget, ctx)
      showSynthesisHoverInfo(defId, tier, star, synthTarget)
    } else {
      ctx.drag?.setSqueezeSuppressed(false)
      hideSynthesisHoverInfo()
      if (item && ctx.sellPopup) {
        ctx.sellPopup.show(item, sellPrice, 'none', toVisualTier(tier, star), undefined, getDefaultItemInfoMode())
      }
    }
  }
  ctx.drag.onDragEnd = () => {
    ctx.drag?.setSqueezeSuppressed(false)
    hideSynthesisHoverInfo()
    clearBackpackSynthesisGuideArrows(ctx)
    stopGridDragButtonFlash()
    applyInstanceTierVisuals()
    updateMiniMap()
    refreshBattlePassiveStatBadges(true)
    clearSelection()
  }
}
