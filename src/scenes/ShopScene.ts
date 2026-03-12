// ============================================================
// ShopScene — 商店/准备场景（Phase 2 视觉验收版）
// 布局（640×1384 画布）：
//   y=430  商店面板 / 背包（互斥显示）
//   y=840  按钮行：背包 | 刷新(金币) | 丢弃
//   y=1020 我的战斗区 5×2
// 拖拽购买：从商店卡片拖到战斗区/背包按钮完成购买
// ============================================================

import { SceneManager, type Scene } from './SceneManager'
import { getApp } from '@/core/AppContext'
import { getConfig, getAllItems } from '@/core/DataLoader'
import {
  clearCurrentRunState,
  getLifeState,
  getWinTrophyState,
  resetLifeState,
} from '@/core/RunState'
import { GridSystem }        from '@/grid/GridSystem'
import type { ItemSizeNorm, PlacedItem } from '@/grid/GridSystem'
import { GridZone, CELL_HEIGHT } from '@/grid/GridZone'
import { DragController }    from '@/grid/DragController'
import { normalizeSize, type ItemDef } from '@/items/ItemDef'
import { ShopManager, getDailyGoldForDay, type TierKey } from '@/shop/ShopManager'
import { ShopPanelView }     from '@/ui/ShopPanelView'
import type { ItemInfoCustomDisplay } from '@/ui/SellPopup'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { PhaseManager } from '@/core/PhaseManager'
import { clearBattleSnapshot, getBattleSnapshot, setBattleSnapshot, type BattleSnapshotBundle } from '@/combat/BattleSnapshotStore'
import { PvpContext } from '@/pvp/PvpContext'
// getOpponentFromAlive moved to PvpPanel.ts
import { clearBattleOutcome, consumeBattleOutcome } from '@/combat/BattleOutcomeStore'
// bronzeSkillConfig, silverSkillConfig, goldSkillConfig imports moved to SkillSystem.ts
// shouldTriggerSkill48ExtraUpgrade → moved to ShopSynthesisController.ts
import {
  Container, Graphics, Text,
  Ticker,
  type FederatedPointerEvent,
} from 'pixi.js'
import {
  nextTierLevel, tierStarLevelIndex,
  getPrimaryArchetype, toSkillArchetype,
  isNeutralArchetypeKey, isNeutralItemDef, getItemDefById,
  canUseLv7MorphSynthesis,
} from './shop/SynthesisLogic'
import {
  saveShopStateToStorage, loadShopStateFromStorage,
  captureShopState,
  applySavedShopState,
  type ApplySavedShopStateCallbacks,
} from './shop/ShopStateStorage'
import { createShopSceneCtx, type ShopSceneCtx, type StarterClass } from './shop/ShopSceneContext'
import {
  nextId,
  instanceToDefId,
  instanceToTier, instanceToPermanentDamageBonus,
  removeInstanceMeta, clearAllInstanceMaps,
  setInstanceQualityLevel, getInstanceLevel,
  getInstanceTier, getInstanceTierStar,
  levelFromLegacyTierStar,
} from './shop/InstanceRegistry'
import { PvpPanel } from './shop/PvpPanel'
import { SettingsDebugPanel } from './shop/SettingsDebugPanel'
import { SkillDraftPanel } from './shop/SkillDraftPanel'
import { EventDraftPanel } from './shop/EventDraftPanel'
import { SpecialShopPanel } from './shop/SpecialShopPanel'
import {
  NeutralItemPanel,
  isNeutralTargetStone,
  getNeutralDailyRollCap,
  neutralRandomCategoryOfItem,
  type NeutralSpecialKind,
  type NeutralChoiceCandidate,
} from './shop/NeutralItemPanel'
import { SynthesisPanel } from './shop/SynthesisPanel'
import {
  getHeroIconByStarterClass,
  isStarterClassItem,
  isFirstPurchaseLockedToStarterClass,
  canBuyItemUnderFirstPurchaseRule,
  canUseHeroDailyCardReroll,
  canTriggerHeroSameItemSynthesisChoice,
  shouldShowHeroDailySkillReadyStar,
  createGuideItemCard,
  getGuideFrameTierByLevel,
} from './shop/HeroSystem'
import * as HeroSystem from './shop/HeroSystem'
import {
  markEventSelected,
  resetEventSelectionCounters,
  getSelectedEventCount,
  getEventPoolRows,
  isEventChoiceAvailable,
  pickRandomEventDraftChoices,
  pickRandomEventDraftChoicesNoOverlap,
  resolveEventDescText,
  resetDayEventState,
  resetFutureEventState,
} from './shop/EventSystem'
import * as EventSystem from './shop/EventSystem'
import {
  pickQualityByPseudoRandomBag,
  getQuickBuyLevelWeightsByDay,
  getMaxQuickBuyLevelForDay,
  levelToTierStar,
  getUnlockPoolBuyPriceByLevel,
  QUALITY_PSEUDO_RANDOM_STATE,
  QUICK_BUY_LEVEL_PSEUDO_RANDOM_STATE,
} from './shop/QuickBuySystem'
import * as QuickBuySystem from './shop/QuickBuySystem'
import {
  getQualityLevelRange,
} from './shop/PlayerStatusUI'
import * as PlayerStatusUI from './shop/PlayerStatusUI'
import {
  hasPickedSkill,
  resetSkill15NextBuyDiscountState,
  resetSkill30BundleState,
  resolveBuyPriceWithSkills,
  consumeSkill15NextBuyDiscountAfterSuccess,
  consumeSkill30BundleAfterSuccess,
  getDailyPlanRow,
  getSkillTierForDay,
  pickSkillChoices,
  pickSkillChoicesNoOverlap,
  pickSkillChoicesExactTier,
} from './shop/SkillSystem'
import * as SkillSystem from './shop/SkillSystem'
import {
  playSynthesisFlashEffect,
  playTransformOrUpgradeFlashEffect,
  stopFlashEffect,
  stopBattleGuideHandAnim,
  stopUnlockRevealPlayback
} from './shop/AnimationEffects'
import { CANVAS_W } from '@/config/layoutConstants'
import { getShopUiColor, getClassColor } from '@/config/colorPalette'
import {
  parseAvailableTiers, getSpecialShopSpeedTierText,
  ammoValueFromLineByStar,
  getSpecialShopSimpleDesc, getSpecialShopDetailDesc,
  setZoneItemAmmo,
} from './shop/SpecialShopDesc'
import {
  clamp01, easeOutCubic, lerp,
  getSizeCols, getSizeCellDim, makeGridCellKey,
  compareTier, toVisualTier,
  getDayActiveCols,
  getBattleItemScale, getBattleZoneX, getBackpackZoneX, getBackpackZoneYByBattle,
} from './shop/ShopMathHelpers'
import {
  type ToastReason,
  showHintToast,
} from './shop/ShopToastSystem'
import {
  shouldShowSimpleDescriptions, isSkillDraftRerollEnabled, isEventDraftRerollEnabled,
  getDefaultItemInfoMode, getDefaultSkillDetailMode,
  resetInfoModeSelection,
  isShopInputEnabled,
} from './shop/ShopModeHelpers'
import {
  clearAutoPackCache,
  buildBackpackAutoPackPlan, applyBackpackAutoPackExisting,
  canBackpackAcceptByAutoPack,
} from './shop/ShopAutoPackManager'
import { buildBattleSnapshot } from './shop/ShopBattleSnapshot'
import * as GridInventory from './shop/ShopGridInventory'
import type { GridInventoryCallbacks, OwnedPlacedItem } from './shop/ShopGridInventory'
import * as PostBattle from './shop/ShopPostBattle'
import type { PostBattleCallbacks } from './shop/ShopPostBattle'
import * as SynthesisCtrl from './shop/ShopSynthesisController'
import type { SynthesisCallbacks, SynthesizeResult, SynthesisTarget } from './shop/ShopSynthesisController'
import * as RewardSystem from './shop/ShopRewardSystem'
import type { RewardSystemCallbacks } from './shop/ShopRewardSystem'
import * as DebugLayout from './shop/ShopDebugLayout'
import type { DebugLayoutCallbacks } from './shop/ShopDebugLayout'
import * as InstanceMgr from './shop/ShopInstanceManager'
import * as PurchaseLogic from './shop/ShopPurchaseLogic'
import type { PurchaseCallbacks } from './shop/ShopPurchaseLogic'
import * as ItemGrant from './shop/ShopItemGrant'
import type { ItemGrantCallbacks } from './shop/ShopItemGrant'
import * as DragSystem from './shop/ShopDragSystem'
import type { ShopDragDeps } from './shop/ShopDragSystem'
import { refreshUpgradeHints } from './shop/ShopUpgradeHints'
import * as UIBuilders from './shop/ShopUIBuilders'
import type { TopAreaUICallbacks, ButtonRowUICallbacks } from './shop/ShopUIBuilders'
import * as EventBusSetup from './shop/ShopEventBusSetup'
import type { EventBusSetupCallbacks } from './shop/ShopEventBusSetup'

// ---- 場景共享狀態上下文 ----
const _ctx: ShopSceneCtx = createShopSceneCtx()

// ---- HeroSystem 本地 shim 包裝（轉發 _ctx + callbacks）----
// 以下函數與原函數簽名完全相同，供場景內部直接調用

function getItemDefByCn(nameCn: string): ItemDef | null {
  return getAllItems().find((it) => it.name_cn === nameCn) ?? null
}

function makeCaptureAndSave(ctx: ShopSceneCtx = _ctx) {
  return () => {
    const s = captureShopState(ctx)
    if (s) saveShopStateToStorage(s)
  }
}

function makeHeroCallbacks() {
  return {
    getUnlockPoolBuyPriceByLevel: (level: 1 | 2 | 3 | 4 | 5 | 6 | 7) => getUnlockPoolBuyPriceByLevel(level),
    grantPoolCandidateToBoardOrBackpack: (
      candidate: Parameters<typeof grantPoolCandidateToBoardOrBackpack>[0],
      source: string,
      opts?: Parameters<typeof grantPoolCandidateToBoardOrBackpack>[2],
    ) => grantPoolCandidateToBoardOrBackpack(candidate, source, opts),
    refreshPlayerStatusUI: () => refreshPlayerStatusUI(),
    captureAndSave: makeCaptureAndSave(),
  }
}


function markHeroSameItemSynthesisChoiceTriggered(ctx: ShopSceneCtx = _ctx): void {
  HeroSystem.markHeroSameItemSynthesisChoiceTriggered(ctx, { refreshPlayerStatusUI: () => refreshPlayerStatusUI() })
}

function checkAndPopPendingHeroPeriodicRewards(ctx: ShopSceneCtx = _ctx): void {
  HeroSystem.checkAndPopPendingHeroPeriodicRewards(ctx, makeHeroCallbacks())
}

function grantHeroPeriodicRewardOrQueue(nameCn: string, source: string, ctx: ShopSceneCtx = _ctx): boolean {
  return HeroSystem.grantHeroPeriodicRewardOrQueue(ctx, nameCn, source, {
    buildNamedPoolCandidate: (n) => buildNamedPoolCandidate(n),
    grantPoolCandidateToBoardOrBackpack: (c, s, o) => grantPoolCandidateToBoardOrBackpack(c, s, o),
    showHintToast: (r, m, c) => showHintToast(r as ToastReason, m, c, ctx),
    refreshPlayerStatusUI: () => refreshPlayerStatusUI(),
    captureAndSave: makeCaptureAndSave(),
  })
}

function grantHeroStartDayEffectsIfNeeded(ctx: ShopSceneCtx = _ctx): void {
  HeroSystem.grantHeroStartDayEffectsIfNeeded(ctx, {
    showHintToast: (r, m, c) => showHintToast(r as ToastReason, m, c, ctx),
  })
}

function grantHeroPeriodicEffectsOnNewDay(day: number, ctx: ShopSceneCtx = _ctx): void {
  HeroSystem.grantHeroPeriodicEffectsOnNewDay(ctx, day, {
    showHintToast: (r, m, c) => showHintToast(r as ToastReason, m, c, ctx),
    grantHeroPeriodicRewardOrQueue: (n, s) => grantHeroPeriodicRewardOrQueue(n, s, ctx),
  })
}

function grantSilverDailyGoldBonusesOnNewDay(ctx: ShopSceneCtx = _ctx): void {
  HeroSystem.grantSilverDailyGoldBonusesOnNewDay(ctx, {
    hasPickedSkill: (id) => hasPickedSkill(ctx, id),
    showHintToast: (r, m, c) => showHintToast(r as ToastReason, m, c, ctx),
  })
}

function grantHeroDiscardSameLevelReward(discardedDefId: string, level: 1 | 2 | 3 | 4 | 5 | 6 | 7, ctx: ShopSceneCtx = _ctx): void {
  HeroSystem.grantHeroDiscardSameLevelReward(ctx, discardedDefId, level, {
    collectPoolCandidatesByLevel: (lv) => collectPoolCandidatesByLevel(lv),
    grantPoolCandidateToBoardOrBackpack: (c, s, o) => grantPoolCandidateToBoardOrBackpack(c, s, o),
    refreshPlayerStatusUI: () => refreshPlayerStatusUI(),
  })
}

function refreshBattlePassiveStatBadges(showJump = true, ctx: ShopSceneCtx = _ctx): void {
  HeroSystem.refreshBattlePassiveStatBadges(ctx, showJump, {
    getInstanceTier: (id) => getInstanceTier(id),
    getInstanceTierStar: (id) => getInstanceTierStar(id),
    getInstancePermanentDamageBonus: (id) => Math.max(0, Math.round(instanceToPermanentDamageBonus.get(id) ?? 0)),
    setZoneItemAmmo: (id, c, m) => { if (ctx.battleView) setZoneItemAmmo(ctx.battleView, id, c, m) },
  })
}

function seedInitialUnlockPoolByStarterClass(pick: StarterClass, ctx: ShopSceneCtx = _ctx): void {
  HeroSystem.seedInitialUnlockPoolByStarterClass(ctx, pick, {
    resetSkill15NextBuyDiscountState: () => resetSkill15NextBuyDiscountState(ctx),
    resetSkill30BundleState: () => resetSkill30BundleState(ctx),
    syncUnlockPoolToManager: () => syncUnlockPoolToManager(),
  })
}

function tryRunHeroCrossSynthesisReroll(stage: Container, synth: SynthesizeResult, ctx: ShopSceneCtx = _ctx): boolean {
  return HeroSystem.tryRunHeroCrossSynthesisReroll(ctx, stage, synth, {
    collectPoolCandidatesByLevel: (lv) => collectPoolCandidatesByLevel(lv),
    showNeutralChoiceOverlay: (s, t, c, onC, m) => showNeutralChoiceOverlay(s, t, c, onC, m),
    transformPlacedItemKeepLevelTo: (id, z, it, kl) => transformPlacedItemKeepLevelTo(id, z, it, kl),
    setInstanceQualityLevel: (id, defId, q, lv) => setInstanceQualityLevel(id, defId, q, lv),
    applyInstanceTierVisuals: () => applyInstanceTierVisuals(),
    syncShopOwnedTierRules: () => syncShopOwnedTierRules(),
    refreshUpgradeHints: () => refreshUpgradeHints(_ctx),
    showHintToast: (r, m, c) => showHintToast(r as ToastReason, m, c, ctx),
    refreshShopUI: () => refreshShopUI(),
    refreshPlayerStatusUI: () => refreshPlayerStatusUI(),
    tierStarLevelIndex: (t, s) => tierStarLevelIndex(t, s),
    pickRandomElements: (list, count) => pickRandomElements(list, count),
  })
}

function toggleHeroPassiveDetailPopup(ctx: ShopSceneCtx = _ctx): void {
  HeroSystem.toggleHeroPassiveDetailPopup(ctx, getApp().stage, {
    hideSkillDetailPopup: () => skillDraftPanel?.hideSkillDetailPopup(),
    resetInfoModeSelection: () => resetInfoModeSelection(ctx),
    applySellButtonState: () => applySellButtonState(ctx),
  })
}

function ensureStarterClassSelection(stage: Container, ctx: ShopSceneCtx = _ctx): void {
  HeroSystem.ensureStarterClassSelection(ctx, stage, {
    setTransitionInputEnabled: (enabled) => setTransitionInputEnabled(enabled, ctx),
    applyPhaseInputLock: () => applyPhaseInputLock(ctx),
    refreshShopUI: () => refreshShopUI(),
    captureAndSave: makeCaptureAndSave(),
    ensureDailyChoiceSelection: (s) => ensureDailyChoiceSelection(s),
    grantHeroStartDayEffectsIfNeeded: () => grantHeroStartDayEffectsIfNeeded(ctx),
    seedInitialUnlockPoolByStarterClass: (pick) => seedInitialUnlockPoolByStarterClass(pick, ctx),
  })
}



// ---- EventSystem 本地 shim 包裝 ----

function makeEventCallbacks() {
  return {
    showHintToast: (reason: string, message: string, color?: number) => showHintToast(reason as ToastReason, message, color, _ctx),
    collectUpgradeableOwnedPlacedItems: (zone?: 'battle' | 'backpack') => collectUpgradeableOwnedPlacedItems(zone),
    upgradePlacedItem: (instanceId: string, zone: 'battle' | 'backpack', withFx?: boolean) => upgradePlacedItem(instanceId, zone, withFx),
    convertAndUpgradePlacedItem: (instanceId: string, zone: 'battle' | 'backpack', withFx?: boolean) => convertAndUpgradePlacedItem(instanceId, zone, withFx),
    canConvertAndUpgradePlacedItem: (instanceId: string, zone: 'battle' | 'backpack') => canConvertAndUpgradePlacedItem(instanceId, zone),
    getAllOwnedPlacedItems: () => getAllOwnedPlacedItems(),
    placeItemToInventoryOrBattle: (def: ItemDef, tier: TierKey, star: 1 | 2) => placeItemToInventoryOrBattle(def, tier, star),
    removePlacedItemById: (instanceId: string, zone: 'battle' | 'backpack') => removePlacedItemById(instanceId, zone),
    schedulePendingGold: (day: number, amount: number) => schedulePendingGold(day, amount),
    schedulePendingBattleUpgrade: (day: number, count: number) => schedulePendingBattleUpgrade(day, count),
    convertHighestLevelItemsOnce: () => convertHighestLevelItemsOnce(),
    upgradeLowestLevelItemsOnce: () => upgradeLowestLevelItemsOnce(),
    collectPoolCandidatesByLevel: (level: 1 | 2 | 3 | 4 | 5 | 6 | 7) => collectPoolCandidatesByLevel(level),
    getQuickBuyLevelWeightsByDay: (day: number) => getQuickBuyLevelWeightsByDay(day),
    getInstanceTierMap: () => instanceToTier,
    getInstanceTierStar: (instanceId: string) => getInstanceTierStar(instanceId),
  }
}

function applyEventEffect(event: EventChoice, fromTest = false, ctx: ShopSceneCtx = _ctx): boolean {
  return EventSystem.applyEventEffect(ctx, event, makeEventCallbacks(), fromTest)
}

function applyFutureEventEffectsOnNewDay(day: number, ctx: ShopSceneCtx = _ctx): void {
  EventSystem.applyFutureEventEffectsOnNewDay(ctx, day, {
    showHintToast: (reason, message, color) => showHintToast(reason as ToastReason, message, color, ctx),
    collectUpgradeableOwnedPlacedItems: (zone?: 'battle' | 'backpack') => collectUpgradeableOwnedPlacedItems(zone),
    upgradePlacedItem: (instanceId, zone, withFx) => upgradePlacedItem(instanceId, zone, withFx),
  })
}











// ---- QuickBuySystem 本地 shim 包裝 ----

function makeQuickBuyCallbacks(ctx: ShopSceneCtx = _ctx) {
  return {
    findFirstBattlePlace: (size: ItemSizeNorm) => findFirstBattlePlace(size),
    findFirstBackpackPlace: (size: ItemSizeNorm) => findFirstBackpackPlace(size),
    isFirstPurchaseLockedToStarterClass: () => isFirstPurchaseLockedToStarterClass(),
    isStarterClassItem: (item: ItemDef) => isStarterClassItem(ctx, item),
    collectNeutralQuickBuyCandidates: () => collectNeutralQuickBuyCandidates(),
    rewriteNeutralRandomPick: (item: ItemDef) => rewriteNeutralRandomPick(item),
    canRandomNeutralItem: (item: ItemDef) => canRandomNeutralItem(item),
    pickNeutralRandomCategoryByPool: (candidates: Array<{ item: ItemDef }>) =>
      (neutralItemPanel?.pickNeutralRandomCategoryByPool(candidates) ?? 'stone') as 'stone' | 'scroll' | 'medal',
    neutralRandomCategoryOfItem: (item: ItemDef) => neutralRandomCategoryOfItem(item),
    getNeutralDailyRollCap: (day: number) => getNeutralDailyRollCap(day),
    getInstanceLevel: (instanceId: string) => getInstanceLevel(instanceId),
    getInstanceTier: (instanceId: string) => getInstanceTier(instanceId),
    getInstanceTierMap: () => instanceToTier,
    getInstanceTierStar: (instanceId: string) => getInstanceTierStar(instanceId),
  }
}

function rollNextQuickBuyOffer(force = false, ctx: ShopSceneCtx = _ctx) {
  return QuickBuySystem.rollNextQuickBuyOffer(ctx, force, makeQuickBuyCallbacks(ctx))
}




function collectPoolCandidatesByLevel(level: 1 | 2 | 3 | 4 | 5 | 6 | 7, ctx: ShopSceneCtx = _ctx): PoolCandidate[] {
  return QuickBuySystem.collectPoolCandidatesByLevel(ctx, level, {
    findFirstBattlePlace: (size) => findFirstBattlePlace(size),
    findFirstBackpackPlace: (size) => findFirstBackpackPlace(size),
  })
}

function findCandidateByOffer(offer: { itemId: string; tier: TierKey; star: 1 | 2; price: number } | null, ctx: ShopSceneCtx = _ctx): PoolCandidate | null {
  return QuickBuySystem.findCandidateByOffer(ctx, offer, {
    findFirstBattlePlace: (size) => findFirstBattlePlace(size),
    findFirstBackpackPlace: (size) => findFirstBackpackPlace(size),
    rewriteNeutralRandomPick: (item) => rewriteNeutralRandomPick(item),
    canRandomNeutralItem: (item) => canRandomNeutralItem(item),
  })
}



// ---- GridInventory callbacks factory ----
function makeGridInventoryCallbacks(): GridInventoryCallbacks {
  return {
    recordNeutralItemObtained: (defId) => recordNeutralItemObtained(defId),
    unlockItemToPool: (defId) => unlockItemToPool(defId),
    collectPoolCandidatesByLevel: (level) => collectPoolCandidatesByLevel(level),
  }
}

// ---- PVP 面板實例（onEnter 初始化，onExit 清理）----
let pvpPanel: PvpPanel | null = null

// ---- Settings/Debug 面板實例（onEnter 初始化，onExit 清理）----
let settingsPanel: SettingsDebugPanel | null = null

// ---- SkillDraft 面板實例（onEnter 初始化，onExit 清理）----
let skillDraftPanel: SkillDraftPanel | null = null

// ---- EventDraft 面板實例（onEnter 初始化，onExit 清理）----
let eventDraftPanel: EventDraftPanel | null = null

// ---- SpecialShop 面板實例（onEnter 初始化，onExit 清理）----
let specialShopPanel: SpecialShopPanel | null = null

// ---- NeutralItem 面板實例（onEnter 初始化，onExit 清理）----
let neutralItemPanel: NeutralItemPanel | null = null

// ---- SynthesisPanel 面板實例（onEnter 初始化，onExit 清理）----
let synthesisPanel: SynthesisPanel | null = null

// ---- 布局常量（640×1384 画布，CANVAS_W/H/BTN_RADIUS/BACKPACK_GAP_FROM_BATTLE 来自 layoutConstants）----

// ---- 背包小地图 ----
const MINI_CELL = 20
const SHOP_QUICK_BUY_PRICE = 3
// ---- 场景级状态 ----

// 按钮/UI 引用（动画需要）

// ToastReason → 已移至 ./shop/ShopToastSystem.ts

// 商店拖拽状态

// Day 状态

// CircleBtnHandle → imported from ShopSceneContext

// shouldShowSimpleDescriptions / isSkillDraftRerollEnabled / isEventDraftRerollEnabled /
// getDefaultItemInfoMode / getDefaultSkillDetailMode / resetInfoModeSelection / resolveInfoMode
// → 已移至 ./shop/ShopModeHelpers.ts

// sync-a 臭鸡蛋：无冷却，可无限扔


type EventLane = 'left' | 'right'
type EventArchetype = 'warrior' | 'archer' | 'assassin'

type EventChoice = {
  id: string
  enabled?: boolean
  dayStart: number
  dayEnd: number
  icon: string
  lane: EventLane
  shortDesc: string
  detailDesc: string
  note?: string
  limits?: {
    maxSelectionsPerRun?: number
  }
  conditions?: {
    requireArchetypeOwned?: EventArchetype
    requireHeartNotFull?: boolean
    requireBackpackNotEmpty?: boolean
    requireBattleNotEmpty?: boolean
    requireBattleArchetypeTopTie?: EventArchetype
  }
}

// 升级奖励状态（持久化）

// 临时开关：屏蔽技能三选一流程已移至 SkillDraftPanel.ts



function lockBackpackRewardCell(col: number, row: number, ctx: ShopSceneCtx = _ctx): void {
  ctx.lockedBackpackRewardCells.add(makeGridCellKey(col, row))
}

function unlockBackpackRewardCell(col: number, row: number, ctx: ShopSceneCtx = _ctx): void {
  ctx.lockedBackpackRewardCells.delete(makeGridCellKey(col, row))
}

function isBackpackDropLocked(col: number, row: number, size: ItemSizeNorm, ctx: ShopSceneCtx = _ctx): boolean {
  if (ctx.lockedBackpackRewardCells.size <= 0) return false
  const { w, h } = getSizeCellDim(size)
  const left = Math.round(col)
  const top = Math.round(row)
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) {
      if (ctx.lockedBackpackRewardCells.has(makeGridCellKey(left + dx, top + dy))) return true
    }
  }
  return false
}

function setTransitionInputEnabled(enabled: boolean, ctx: ShopSceneCtx = _ctx): void {
  ctx.drag?.setEnabled(enabled)
  if (ctx.shopPanel) ctx.shopPanel.interactiveChildren = enabled
  if (ctx.btnRow) ctx.btnRow.interactiveChildren = enabled
  if (ctx.dayDebugCon) ctx.dayDebugCon.interactiveChildren = enabled
}

function beginBattleStartTransition(ctx: ShopSceneCtx = _ctx): void {
  if (ctx.battleStartTransition) return
  const transitionMs = Math.max(1, getDebugCfg('shopToBattleTransitionMs'))
  const battleDropPx = Math.max(0, getDebugCfg('battleZoneYInBattleOffset'))
  const backpackDropPx = Math.max(0, getDebugCfg('shopToBattleBackpackDropPx'))
  const backpackTargetAlpha = clamp01(getDebugCfg('shopToBattleBackpackAlpha'))
  const buttonsTargetAlpha = clamp01(getDebugCfg('shopToBattleButtonsAlpha'))
  const currentBattleY = ctx.battleView?.y ?? (getDebugCfg('battleZoneY') + (CELL_HEIGHT * (1 - getBattleItemScale(ctx))) / 2)
  const currentBackpackY = ctx.backpackView?.y ?? getBackpackZoneYByBattle(ctx)

  clearSelection(ctx)
  skillDraftPanel?.hideSkillDetailPopup()
  if (ctx.skillIconBarCon) ctx.skillIconBarCon.visible = false
  stopGridDragButtonFlash(ctx)
  stopFlashEffect(ctx)
  ctx.battleView?.clearHighlight()
  ctx.backpackView?.clearHighlight()
  setTransitionInputEnabled(false, ctx)
  setBaseShopPrimaryButtonsVisible(false)
  if (ctx.battleZoneTitleText) {
    ctx.battleZoneTitleText.alpha = 0
    ctx.battleZoneTitleText.visible = false
  }
  if (ctx.backpackZoneTitleText) {
    ctx.backpackZoneTitleText.alpha = 0
    ctx.backpackZoneTitleText.visible = false
  }

  ctx.battleStartTransition = {
    elapsedMs: 0,
    durationMs: transitionMs,
    battleStartY: currentBattleY,
    battleTargetY: currentBattleY + battleDropPx,
    backpackStartY: currentBackpackY,
    backpackTargetY: currentBackpackY + backpackDropPx,
    backpackStartAlpha: ctx.backpackView?.alpha ?? 1,
    backpackTargetAlpha,
    buttonsStartAlpha: ctx.btnRow?.alpha ?? 1,
    buttonsTargetAlpha,
  }
}

function tickBattleStartTransition(dt: number, ctx: ShopSceneCtx = _ctx): void {
  if (!ctx.battleStartTransition) return
  ctx.battleStartTransition.elapsedMs += Math.max(0, dt * 1000)
  const t = clamp01(ctx.battleStartTransition.elapsedMs / ctx.battleStartTransition.durationMs)
  const eased = easeOutCubic(t)

  if (ctx.battleView) {
    ctx.battleView.y = lerp(ctx.battleStartTransition.battleStartY, ctx.battleStartTransition.battleTargetY, eased)
  }
  if (ctx.backpackView) {
    ctx.backpackView.y = lerp(ctx.battleStartTransition.backpackStartY, ctx.battleStartTransition.backpackTargetY, eased)
    ctx.backpackView.alpha = lerp(ctx.battleStartTransition.backpackStartAlpha, ctx.battleStartTransition.backpackTargetAlpha, eased)
  }
  if (ctx.backpackAreaBg) {
    ctx.backpackAreaBg.alpha = lerp(1, ctx.battleStartTransition.backpackTargetAlpha, eased)
  }
  if (ctx.btnRow) {
    ctx.btnRow.alpha = lerp(ctx.battleStartTransition.buttonsStartAlpha, ctx.battleStartTransition.buttonsTargetAlpha, eased)
  }
  if (ctx.refreshCostText) {
    ctx.refreshCostText.alpha = lerp(1, ctx.battleStartTransition.buttonsTargetAlpha, eased)
  }
  if (ctx.dayDebugCon) {
    ctx.dayDebugCon.alpha = lerp(1, ctx.battleStartTransition.buttonsTargetAlpha, eased)
  }
  if (ctx.hintToastCon) {
    ctx.hintToastCon.alpha = lerp(1, ctx.battleStartTransition.buttonsTargetAlpha, eased)
  }

  if (t >= 1) {
    ctx.battleStartTransition = null
    SceneManager.goto('battle')
  }
}

function restartRunFromBeginning(ctx: ShopSceneCtx = _ctx): void {
  clearCurrentRunState()
  resetLifeState()
  clearBattleSnapshot()
  clearBattleOutcome()
  ctx.savedShopState = null
  ctx.pendingBattleTransition = false
  ctx.pendingAdvanceToNextDay = false
  ctx.pvpReadyLocked = false
  window.location.reload()
}

// isShopInputEnabled → 已移至 ./shop/ShopModeHelpers.ts
// createHintToast / shouldShowToast / showHintToast → 已移至 ./shop/ShopToastSystem.ts

function canAffordQuickBuyNow(ctx: ShopSceneCtx = _ctx): boolean {
  if (!ctx.shopManager) return false
  const offer = rollNextQuickBuyOffer(false, ctx)
  if (!offer) return false
  if (!canBuyItemUnderFirstPurchaseRule(ctx, offer.item)) return false
  const price = resolveBuyPriceWithSkills(ctx, offer.price).finalPrice
  return ctx.shopManager.gold >= price
}


function updatePhaseToggleButton(ctx: ShopSceneCtx = _ctx): void {
  if (!ctx.phaseBtnHandle) return
  const inShop = isShopInputEnabled(ctx)
  // PVP 模式下用「准备」替代「战斗」，语义更清晰
  const battleLabel = PvpContext.isActive() ? '准备' : '战斗'
  ctx.phaseBtnHandle.setLabel(inShop ? battleLabel : '商店')
  ctx.phaseBtnHandle.redraw(true)
}

function applyPhaseUiVisibility(ctx: ShopSceneCtx = _ctx): void {
  const inShop = isShopInputEnabled(ctx)

  if (!inShop) {
    ctx.showingBackpack = true
    ctx.shopPanel?.setSelectedSlot(-1)
    ctx.battleView?.setSelected(null)
    ctx.backpackView?.setSelected(null)
    clearSelection(ctx)
    applySellButtonState(ctx)
  }

  if (ctx.shopPanel) ctx.shopPanel.visible = false
  if (ctx.backpackView) ctx.backpackView.visible = inShop && ctx.showingBackpack
  if (ctx.shopAreaBg) ctx.shopAreaBg.visible = inShop && !ctx.showingBackpack
  if (ctx.backpackAreaBg) ctx.backpackAreaBg.visible = inShop && ctx.showingBackpack
  if (ctx.battleAreaBg) ctx.battleAreaBg.visible = inShop
  if (ctx.battleZoneTitleText) ctx.battleZoneTitleText.visible = inShop
  if (ctx.backpackZoneTitleText) ctx.backpackZoneTitleText.visible = inShop && ctx.showingBackpack
  if (ctx.battleZoneTitleText && inShop) ctx.battleZoneTitleText.alpha = 1
  if (ctx.backpackZoneTitleText && inShop) ctx.backpackZoneTitleText.alpha = 1

  if (ctx.specialShopBackpackViewActive) {
    if (ctx.bpBtnHandle) ctx.bpBtnHandle.container.visible = false
    if (ctx.refreshBtnHandle) ctx.refreshBtnHandle.container.visible = false
    if (ctx.sellBtnHandle) ctx.sellBtnHandle.container.visible = false
    if (ctx.phaseBtnHandle) ctx.phaseBtnHandle.container.visible = false
  } else {
    if (ctx.bpBtnHandle) ctx.bpBtnHandle.container.visible = false
    if (ctx.refreshBtnHandle) ctx.refreshBtnHandle.container.visible = inShop
    if (ctx.sellBtnHandle) ctx.sellBtnHandle.container.visible = inShop
    if (ctx.phaseBtnHandle) ctx.phaseBtnHandle.container.visible = true
  }

  if (ctx.refreshCostText) ctx.refreshCostText.visible = inShop
  if (ctx.goldText) ctx.goldText.visible = inShop
  if (ctx.livesText) ctx.livesText.visible = inShop
  if (ctx.playerStatusCon) ctx.playerStatusCon.visible = inShop
  if (ctx.miniMapCon) ctx.miniMapCon.visible = inShop
  if (ctx.dayDebugCon) ctx.dayDebugCon.visible = inShop
  if (ctx.sellPopup) ctx.sellPopup.visible = inShop && ctx.currentSelection.kind !== 'none'
  if (ctx.hintToastCon && !inShop) ctx.hintToastCon.visible = false
  if (ctx.unlockRevealLayer) ctx.unlockRevealLayer.visible = inShop && ctx.unlockRevealActive

  if (!inShop) {
    stopGridDragButtonFlash(ctx)
    stopFlashEffect(ctx)
    ctx.battleView?.clearHighlight()
    ctx.backpackView?.clearHighlight()
  }

  updatePhaseToggleButton(ctx)
}

function applyPhaseInputLock(ctx: ShopSceneCtx = _ctx): void {
  synthesisPanel?.teardownCrossSynthesisConfirmOverlay()
  const enabled = isShopInputEnabled(ctx)
  ctx.drag?.setEnabled(enabled)

  if (ctx.shopDragFloater) {
    if (ctx.shopDragFloater.parent) ctx.shopDragFloater.parent.removeChild(ctx.shopDragFloater)
    ctx.shopDragFloater.destroy({ children: true })
    ctx.shopDragFloater = null
  }
  resetDrag(ctx)
  applyPhaseUiVisibility(ctx)
}

// buildBattleSnapshot / resolveInstanceBaseStats → 已移至 ./shop/ShopBattleSnapshot.ts


function makeApplyCallbacks(ctx: ShopSceneCtx = _ctx): ApplySavedShopStateCallbacks {
  return {
    toVisualTier: (tier, star) => toVisualTier(tier, star),
    syncUnlockPoolToManager: () => syncUnlockPoolToManager(),
    hasPickedSkill: (id) => hasPickedSkill(ctx, id),
    resetSkill15NextBuyDiscountState: () => resetSkill15NextBuyDiscountState(ctx),
    resetSkill30BundleState: () => resetSkill30BundleState(ctx),
  }
}



// UpgradeMatch / computeUpgradeMatch / refreshUpgradeHints -> moved to ./shop/ShopUpgradeHints.ts

// SynthesizeResult / SynthesisTarget → imported from ShopSynthesisController
function getArchetypeCornerBadge(item: ItemDef): { label: string; fill: number; stroke: number } {
  const key = toSkillArchetype(getPrimaryArchetype(item.tags))
  if (key === 'warrior') return { label: '战士', fill: getClassColor('Warrior'), stroke: 0xffc0c0 }
  if (key === 'archer') return { label: '弓手', fill: getClassColor('Archer'),  stroke: 0xb5ffd0 }
  if (key === 'assassin') return { label: '刺客', fill: getClassColor('Assassin'), stroke: 0xc5d5ff }
  return { label: '中立', fill: getClassColor('neutral'), stroke: 0xffe3ac }
}

function addArchetypeCornerBadge(card: Container, item: ItemDef, cardW: number, iconTopY: number): void {
  const badge = getArchetypeCornerBadge(item)
  const text = new Text({
    text: badge.label,
    style: { fontSize: 20, fill: 0xf9fbff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  const padX = 10
  const padY = 4
  const bg = new Graphics()
  const badgeW = Math.max(64, Math.ceil(text.width + padX * 2))
  const badgeH = Math.max(26, Math.ceil(text.height + padY * 2))
  const badgeY = Math.max(-26, Math.round(iconTopY - badgeH - 8))
  bg.roundRect(0, 0, badgeW, badgeH, 10)
  bg.fill({ color: badge.fill, alpha: 0.96 })
  bg.stroke({ color: badge.stroke, width: 2, alpha: 0.96 })
  bg.x = Math.round((cardW - badgeW) / 2)
  bg.y = badgeY
  text.x = Math.round(bg.x + (badgeW - text.width) / 2)
  text.y = Math.round(bg.y + (badgeH - text.height) / 2)
  card.addChild(bg)
  card.addChild(text)
}

function isCrossIdSynthesisConfirmEnabled(): boolean {
  const runtimeToggle = getDebugCfg('gameplayCrossSynthesisConfirm') >= 0.5
  if (runtimeToggle) return true
  const raw = getConfig().shopRules?.crossIdSynthesisRequireConfirm
  return raw === true
}

function isBattleZoneNoSynthesisEnabled(): boolean {
  return getDebugCfg('gameplayBattleZoneNoSynthesis') >= 0.5
}

function isSameArchetypeDiffItemStoneSynthesisEnabled(): boolean {
  return getDebugCfg('gameplaySameArchetypeDiffItemStoneSynthesis') >= 0.5
}

function canUseSameArchetypeDiffItemStoneSynthesis(
  sourceDefId: string,
  targetDefId: string,
  sourceTier: TierKey,
  sourceStar: 1 | 2,
  targetTier: TierKey,
  targetStar: 1 | 2,
): boolean {
  if (!isSameArchetypeDiffItemStoneSynthesisEnabled()) return false
  if (sourceDefId === targetDefId) return false
  if (sourceTier !== targetTier || sourceStar !== targetStar) return false
  if (!nextTierLevel(sourceTier, sourceStar)) return false
  const sourceDef = getItemDefById(sourceDefId)
  const targetDef = getItemDefById(targetDefId)
  if (!sourceDef || !targetDef) return false
  if (isNeutralItemDef(sourceDef) || isNeutralItemDef(targetDef)) return false
  const sourceArch = getPrimaryArchetype(sourceDef.tags)
  const targetArch = getPrimaryArchetype(targetDef.tags)
  if (!sourceArch || !targetArch) return false
  return sourceArch === targetArch
}


function upsertPickedSkill(skillId: string, ctx: ShopSceneCtx = _ctx): void {
  SkillSystem.upsertPickedSkill(ctx, skillId, { grantSkill20DailyBronzeItemIfNeeded: () => grantSkill20DailyBronzeItemIfNeeded() })
}

function removePickedSkill(skillId: string, ctx: ShopSceneCtx = _ctx): void {
  SkillSystem.removePickedSkill(ctx, skillId, { getDefaultSkillDetailMode: () => getDefaultSkillDetailMode() })
}

function closeSpecialShopOverlay(): void {
  specialShopPanel?.closeSpecialShopOverlay()
}

function setBaseShopPrimaryButtonsVisible(visible: boolean, ctx: ShopSceneCtx = _ctx): void {
  if (ctx.bpBtnHandle) ctx.bpBtnHandle.container.visible = visible
  if (ctx.refreshBtnHandle) ctx.refreshBtnHandle.container.visible = visible
  if (ctx.sellBtnHandle) ctx.sellBtnHandle.container.visible = visible
  if (ctx.phaseBtnHandle) ctx.phaseBtnHandle.container.visible = visible
}

function renderSpecialShopCheckMarks(): void {
  specialShopPanel?.renderSpecialShopCheckMarks()
}

function handleSpecialShopBackpackItemTap(instanceId: string, kind: 'battle' | 'backpack'): void {
  specialShopPanel?.handleSpecialShopBackpackItemTap(instanceId, kind)
}

function applyInstanceTierVisuals(ctx: ShopSceneCtx = _ctx): void {
  InstanceMgr.applyInstanceTierVisuals(ctx)
}

function syncShopOwnedTierRules(ctx: ShopSceneCtx = _ctx): void {
  InstanceMgr.syncShopOwnedTierRules(ctx)
}

function syncUnlockPoolToManager(ctx: ShopSceneCtx = _ctx): void {
  InstanceMgr.syncUnlockPoolToManager(ctx)
}

function unlockItemToPool(defId: string, ctx: ShopSceneCtx = _ctx): boolean {
  return InstanceMgr.unlockItemToPool(defId, ctx)
}

function showFirstPurchaseRuleHint(ctx: ShopSceneCtx = _ctx): void {
  PurchaseLogic.showFirstPurchaseRuleHint(ctx)
}

function markShopPurchaseDone(ctx: ShopSceneCtx = _ctx): void {
  PurchaseLogic.markShopPurchaseDone(ctx)
}




function checkAndPopPendingRewards(ctx: ShopSceneCtx = _ctx): void {
  RewardSystem.checkAndPopPendingRewards(ctx, makeRewardSystemCallbacks())
}

function grantSynthesisExp(amount = 1, from?: { instanceId: string; zone: 'battle' | 'backpack' }, ctx: ShopSceneCtx = _ctx): void {
  RewardSystem.grantSynthesisExp(amount, from, ctx, makeRewardSystemCallbacks())
}









function getSpecialShopShownDesc(item: ItemDef, tier: TierKey, star: 1 | 2, detailed: boolean): string {
  if (!shouldShowSimpleDescriptions() || detailed) return getSpecialShopDetailDesc(item, tier, star)
  return getSpecialShopSimpleDesc(item, tier, star)
}







function makeShopDragDeps(): ShopDragDeps {
  return {
    hideSynthesisHoverInfo: () => synthesisPanel?.hideSynthesisHoverInfo(),
    showSynthesisHoverInfo: (defId, tier, star, target) => synthesisPanel?.showSynthesisHoverInfo(defId, tier, star, target),
    showCrossSynthesisConfirmOverlay: (source, target, toTier, toStar, onConfirm) =>
      synthesisPanel?.showCrossSynthesisConfirmOverlay(source, target, toTier, toStar, onConfirm),
    hideSkillDetailPopup: () => skillDraftPanel?.hideSkillDetailPopup(),
    refreshShopUI: () => refreshShopUI(),
    applyPhaseInputLock: () => applyPhaseInputLock(),
    recordNeutralItemObtained: (defId) => recordNeutralItemObtained(defId),
    showLv7MorphSynthesisConfirmOverlay: (stage, onConfirm) => showLv7MorphSynthesisConfirmOverlay(stage, onConfirm),
    buildStoneTransformChoices: (target, rule) => buildStoneTransformChoices(target, rule),
    showNeutralChoiceOverlay: (stage, title, candidates, onConfirm, mode) => showNeutralChoiceOverlay(stage, title, candidates, onConfirm, mode),
    transformPlacedItemKeepLevelTo: (id, zone, def, fx) => transformPlacedItemKeepLevelTo(id, zone, def, fx),
    synthesizeTarget: (defId, tier, star, targetId, zone) => synthesizeTarget(defId, tier, star, targetId, zone),
    grantSynthesisExp: (amount, from) => grantSynthesisExp(amount, from),
    tryRunHeroCrossSynthesisReroll: (stage, synth) => tryRunHeroCrossSynthesisReroll(stage, synth),
    tryRunHeroSameItemSynthesisChoice: (defId, tier, star, target, consumeSource) =>
      tryRunHeroSameItemSynthesisChoice(getApp().stage, defId, tier, star, target, consumeSource),
    purchaseCallbacks: makePurchaseCallbacks(),
    isBackpackDropLocked: (col, row, size) => isBackpackDropLocked(col, row, size),
  }
}

function makeItemGrantCallbacks(): ItemGrantCallbacks {
  return {
    recordNeutralItemObtained: (defId) => recordNeutralItemObtained(defId),
  }
}


function makeTopAreaUICallbacks(): TopAreaUICallbacks {
  return {
    restartRunFromBeginning: () => restartRunFromBeginning(),
    toggleHeroPassiveDetailPopup: () => toggleHeroPassiveDetailPopup(),
    pvpOpenPlayerList: () => pvpPanel?.openPvpPlayerListOverlay(),
    pvpBuildOpponentBadge: () => pvpPanel?.buildPvpOpponentBadge(),
    pvpBuildOpponentHeroLayer: () => pvpPanel?.buildPvpOpponentHeroLayer() ?? Promise.resolve(),
  }
}

function makeButtonRowUICallbacks(): ButtonRowUICallbacks {
  return {
    buyRandomBronzeToBoardOrBackpack: () => buyRandomBronzeToBoardOrBackpack(),
    canAffordQuickBuyNow: () => canAffordQuickBuyNow(),
    beginBattleStartTransition: () => beginBattleStartTransition(),
    setDay: (day) => setDay(day),
    ensureBottomHudVisibleAndOnTop: (stage) => ensureBottomHudVisibleAndOnTop(stage),
    pvpShowWaitingPanel: (stage) => pvpPanel?.showPvpWaitingPanel(stage),
    createSettingsButton: () => settingsPanel?.createSettingsButton(),
    getQuickBuyPricePreviewLabel: () => getQuickBuyPricePreviewLabel(),
    hideSkillDetailPopup: () => skillDraftPanel?.hideSkillDetailPopup(),
    refreshBattlePassiveStatBadges: (showJump) => refreshBattlePassiveStatBadges(showJump),
    handleSpecialShopBackpackItemTap: (id, kind) => handleSpecialShopBackpackItemTap(id, kind),
    dragDeps: makeShopDragDeps(),
    debugLayoutCallbacks: makeDebugLayoutCallbacks(),
  }
}


function makeEventBusSetupCallbacks(): EventBusSetupCallbacks {
  return {
    refreshShopUI: () => refreshShopUI(),
    refreshPlayerStatusUI: () => refreshPlayerStatusUI(),
    dragDeps: makeShopDragDeps(),
    pvpShowWaitingPanel: (stage) => pvpPanel?.showPvpWaitingPanel(stage),
    pvpShowEggSplatOverlay: (name) => pvpPanel?.showEggSplatOverlay(name),
    pvpRefreshWaitingPanel: () => pvpPanel?.refreshPvpWaitingPanel(),
  }
}

function makePurchaseCallbacks(): PurchaseCallbacks {
  return {
    updateNeutralPseudoRandomCounterOnPurchase: (item) => updateNeutralPseudoRandomCounterOnPurchase(item),
  }
}

function makeDebugLayoutCallbacks(): DebugLayoutCallbacks {
  return {
    applyPhaseUiVisibility: () => applyPhaseUiVisibility(),
    layoutSkillIconBar: () => skillDraftPanel?.layoutSkillIconBar(),
  }
}

function makeRewardSystemCallbacks(): RewardSystemCallbacks {
  return {
    lockBackpackRewardCell: (col, row) => lockBackpackRewardCell(col, row),
    unlockBackpackRewardCell: (col, row) => unlockBackpackRewardCell(col, row),
    recordLevelRewardObtained: (kind) => recordLevelRewardObtained(kind),
    recordNeutralItemObtained: (defId) => recordNeutralItemObtained(defId),
    unlockItemToPool: (defId) => unlockItemToPool(defId),
    checkAndPopPendingHeroPeriodicRewards: () => checkAndPopPendingHeroPeriodicRewards(),
    rollLevelRewardDefIds: (level) => rollLevelRewardDefIds(level),
  }
}

function makeSynthesisCallbacks(): SynthesisCallbacks {
  return {
    isBackpackDropLocked: (col, row, size) => isBackpackDropLocked(col, row, size),
    unlockItemToPool: (defId) => unlockItemToPool(defId),
    applyInstanceTierVisuals: () => applyInstanceTierVisuals(),
    syncShopOwnedTierRules: () => syncShopOwnedTierRules(),
    grantSynthesisExp: (amount, from) => grantSynthesisExp(amount, from),
    checkAndPopPendingRewards: () => checkAndPopPendingRewards(),
  }
}

function makePostBattleCallbacks(): PostBattleCallbacks {
  return {
    recordNeutralItemObtained: (defId) => recordNeutralItemObtained(defId),
    syncShopOwnedTierRules: () => syncShopOwnedTierRules(),
    refreshShopUI: () => refreshShopUI(),
  }
}

function applyPostBattleEffects(snapshot: BattleSnapshotBundle | null): void {
  PostBattle.applyPostBattleEffects(snapshot, _ctx, makePostBattleCallbacks())
}



function isPointInItemBounds(view: GridZone, item: PlacedItem, gx: number, gy: number): boolean {
  return SynthesisCtrl.isPointInItemBounds(view, item, gx, gy)
}

function refreshBackpackSynthesisGuideArrows(
  defId: string | null,
  tier: TierKey | null,
  star: 1 | 2,
  excludeInstanceId?: string,
  ctx: ShopSceneCtx = _ctx,
): void {
  SynthesisCtrl.refreshBackpackSynthesisGuideArrows(defId, tier, star, ctx, excludeInstanceId)
}

function clearBackpackSynthesisGuideArrows(ctx: ShopSceneCtx = _ctx): void {
  SynthesisCtrl.clearBackpackSynthesisGuideArrows(ctx)
}

function findSynthesisTargetWithDragProbe(
  defId: string,
  tier: TierKey,
  star: 1 | 2,
  gx: number,
  gy: number,
  dragSize?: ItemSizeNorm,
): SynthesisTarget | null {
  return SynthesisCtrl.findSynthesisTargetWithDragProbe(defId, tier, star, gx, gy, dragSize, _ctx, makeSynthesisCallbacks())
}

function findBattleSynthesisTargetWithDragProbeIgnoringNoSynthesis(
  defId: string,
  tier: TierKey,
  star: 1 | 2,
  gx: number,
  gy: number,
  dragSize?: ItemSizeNorm,
  ctx: ShopSceneCtx = _ctx,
): SynthesisTarget | null {
  return SynthesisCtrl.findBattleSynthesisTargetWithDragProbeIgnoringNoSynthesis(defId, tier, star, gx, gy, dragSize, ctx)
}

function getSynthesisTargetItem(target: SynthesisTarget, ctx: ShopSceneCtx = _ctx): PlacedItem | null {
  return SynthesisCtrl.getSynthesisTargetItem(target, ctx)
}

function highlightSynthesisTarget(target: SynthesisTarget | null, ctx: ShopSceneCtx = _ctx): void {
  SynthesisCtrl.highlightSynthesisTarget(target, ctx)
}

function synthesizeTarget(
  defId: string,
  tier: TierKey,
  star: 1 | 2,
  targetInstanceId: string,
  zone: 'battle' | 'backpack',
  ctx: ShopSceneCtx = _ctx,
): SynthesizeResult | null {
  return SynthesisCtrl.synthesizeTarget(defId, tier, star, targetInstanceId, zone, ctx, makeSynthesisCallbacks())
}

function restoreDraggedItemToZone(
  instanceId: string,
  defId: string,
  size: ItemSizeNorm,
  tier: TierKey,
  star: 1 | 2,
  originCol: number,
  originRow: number,
  homeSystem: GridSystem,
  homeView: GridZone,
  ctx: ShopSceneCtx = _ctx,
): void {
  GridInventory.restoreDraggedItemToZone(instanceId, defId, size, tier, star, originCol, originRow, homeSystem, homeView, ctx)
}


function findFirstBackpackPlace(size: ItemSizeNorm, ctx: ShopSceneCtx = _ctx): { col: number; row: number } | null {
  return GridInventory.findFirstBackpackPlace(size, ctx)
}

function findFirstBattlePlace(size: ItemSizeNorm, ctx: ShopSceneCtx = _ctx): { col: number; row: number } | null {
  return GridInventory.findFirstBattlePlace(size, ctx)
}




function getAllOwnedPlacedItems(ctx: ShopSceneCtx = _ctx): OwnedPlacedItem[] {
  return GridInventory.getAllOwnedPlacedItems(ctx)
}

function pickRandomElements<T>(list: T[], count: number): T[] {
  return GridInventory.pickRandomElements(list, count)
}

function removePlacedItemById(instanceId: string, zone: 'battle' | 'backpack', ctx: ShopSceneCtx = _ctx): void {
  GridInventory.removePlacedItemById(instanceId, zone, ctx)
}

function placeItemToInventoryOrBattle(def: ItemDef, tier: TierKey, star: 1 | 2, ctx: ShopSceneCtx = _ctx): boolean {
  return GridInventory.placeItemToInventoryOrBattle(def, tier, star, ctx, makeGridInventoryCallbacks())
}

function upgradePlacedItem(instanceId: string, zone: 'battle' | 'backpack', withFx = false, ctx: ShopSceneCtx = _ctx): boolean {
  return GridInventory.upgradePlacedItem(instanceId, zone, withFx, ctx)
}

function convertAndUpgradePlacedItem(instanceId: string, zone: 'battle' | 'backpack', withFx = false, ctx: ShopSceneCtx = _ctx): boolean {
  return GridInventory.convertAndUpgradePlacedItem(instanceId, zone, withFx, ctx, makeGridInventoryCallbacks())
}

function canConvertAndUpgradePlacedItem(instanceId: string, zone: 'battle' | 'backpack', ctx: ShopSceneCtx = _ctx): boolean {
  return GridInventory.canConvertAndUpgradePlacedItem(instanceId, zone, ctx)
}

function collectUpgradeableOwnedPlacedItems(zone?: 'battle' | 'backpack'): OwnedPlacedItem[] {
  return GridInventory.collectUpgradeableOwnedPlacedItems(zone, _ctx)
}

function schedulePendingGold(day: number, amount: number, ctx: ShopSceneCtx = _ctx): void {
  GridInventory.schedulePendingGold(day, amount, ctx)
}

function schedulePendingBattleUpgrade(day: number, count: number, ctx: ShopSceneCtx = _ctx): void {
  GridInventory.schedulePendingBattleUpgrade(day, count, ctx)
}

function upgradeLowestLevelItemsOnce(): number {
  return GridInventory.upgradeLowestLevelItemsOnce(_ctx)
}

function convertHighestLevelItemsOnce(): number {
  return GridInventory.convertHighestLevelItemsOnce(_ctx, makeGridInventoryCallbacks())
}

// ============================================================
// 中性物品系統 — 已提取至 NeutralItemPanel.ts
// 以下函數通過 neutralItemPanel 實例調用
// ============================================================

// NeutralSpecialKind, NeutralChoiceCandidate 類型已從 NeutralItemPanel.ts import


function recordNeutralItemObtained(defId: string): void {
  neutralItemPanel?.recordNeutralItemObtained(defId)
}

function recordLevelRewardObtained(kind: NeutralSpecialKind): void {
  neutralItemPanel?.recordLevelRewardObtained(kind)
}

function rewriteNeutralRandomPick(item: ItemDef): ItemDef {
  return neutralItemPanel?.rewriteNeutralRandomPick(item) ?? item
}

function canRandomNeutralItem(item: ItemDef): boolean {
  return neutralItemPanel?.canRandomNeutralItem(item) ?? true
}

function refreshNeutralStoneGuideArrows(sourceDef: ItemDef | null | undefined, excludeInstanceId?: string): void {
  neutralItemPanel?.refreshNeutralStoneGuideArrows(sourceDef, excludeInstanceId)
}

function findNeutralStoneTargetWithDragProbe(
  sourceDef: ItemDef,
  gx: number,
  gy: number,
  dragSize?: ItemSizeNorm,
): SynthesisTarget | null {
  return neutralItemPanel?.findNeutralStoneTargetWithDragProbe(sourceDef, gx, gy, dragSize) ?? null
}

function showNeutralStoneHoverInfo(sourceDef: ItemDef, target: SynthesisTarget): void {
  neutralItemPanel?.showNeutralStoneHoverInfo(sourceDef, target)
}

function showNeutralChoiceOverlay(
  stage: Container,
  titleText: string,
  candidates: NeutralChoiceCandidate[],
  onConfirmPick?: (candidate: NeutralChoiceCandidate) => boolean,
  displayMode: 'default' | 'special_shop_like' = 'default',
  options?: {
    canReroll?: () => boolean
    onReroll?: () => NeutralChoiceCandidate[]
    onRerollUsed?: () => void
    rerollBtnText?: string
  },
): boolean {
  void stage
  return neutralItemPanel?.showNeutralChoiceOverlay(titleText, candidates, onConfirmPick, displayMode, options) ?? false
}


function showLv7MorphSynthesisConfirmOverlay(
  _stage: Container,
  onConfirm: () => void,
  onCancel?: () => void,
): void {
  neutralItemPanel?.showLv7MorphSynthesisConfirmOverlay(onConfirm, onCancel)
}

function applyNeutralDiscardEffect(source: ItemDef, _stage: Container): boolean {
  return neutralItemPanel?.applyNeutralDiscardEffect(source) ?? false
}

function applyNeutralStoneTargetEffect(sourceDef: ItemDef, target: SynthesisTarget, _stage: Container): boolean {
  return neutralItemPanel?.applyNeutralStoneTargetEffect(sourceDef, target) ?? false
}

function buildStoneTransformChoices(
  target: SynthesisTarget,
  rule: 'same' | 'other',
  opts?: { rollLevel?: number; displayTier?: TierKey; displayStar?: 1 | 2; choiceCount?: number },
): NeutralChoiceCandidate[] {
  return neutralItemPanel?.buildStoneTransformChoices(target, rule, opts) ?? []
}


function transformPlacedItemKeepLevelTo(
  instanceId: string,
  zone: 'battle' | 'backpack',
  nextDef: ItemDef,
  withFx = false,
): boolean {
  return neutralItemPanel?.transformPlacedItemKeepLevelTo(instanceId, zone, nextDef, withFx) ?? false
}

function tryRunHeroSameItemSynthesisChoice(
  _stage: Container,
  sourceDefId: string,
  sourceTier: TierKey,
  sourceStar: 1 | 2,
  target: SynthesisTarget,
  consumeSource: () => boolean,
): boolean {
  return neutralItemPanel?.tryRunHeroSameItemSynthesisChoice(sourceDefId, sourceTier, sourceStar, target, consumeSource) ?? false
}

function tryRunSameArchetypeDiffItemStoneSynthesis(
  sourceInstanceId: string,
  sourceDefId: string,
  sourceTier: TierKey,
  sourceStar: 1 | 2,
  target: SynthesisTarget,
  restore: () => void,
): boolean {
  return neutralItemPanel?.tryRunSameArchetypeDiffItemStoneSynthesis(sourceInstanceId, sourceDefId, sourceTier, sourceStar, target, restore) ?? false
}

function rollLevelRewardDefIds(level: number): string[] {
  return neutralItemPanel?.rollLevelRewardDefIds(level) ?? []
}

// getSkillDailyDraftPlanRows / makeSkillPoolByTier / randomByWeight / pickMixedSkillTier / getDominantBattleArchetype
// are internal to SkillSystem.ts and not directly called from ShopScene




function ensureSpecialShopSelection(_stage: Container): void {
  specialShopPanel?.ensureSpecialShopSelection()
}
void ensureSpecialShopSelection

function ensureDailyChoiceSelection(_stage: Container, ctx: ShopSceneCtx = _ctx): void {
  if (ctx.classSelectOverlay) return
  if (ctx.starterGuideOverlay) return
  if (ctx.skillDraftOverlay || ctx.eventDraftOverlay || ctx.specialShopOverlay) return
  const hasPendingSkillDraft = !!(ctx.pendingSkillDraft && ctx.pendingSkillDraft.day === ctx.currentDay)
  if (hasPendingSkillDraft) {
    skillDraftPanel?.ensureSkillDraftSelection()
    return
  }
  const hasPendingEventDraft = !!(ctx.pendingEventDraft && ctx.pendingEventDraft.day === ctx.currentDay)
  if (hasPendingEventDraft) {
    eventDraftPanel?.ensureEventDraftSelection()
    return
  }
}
void ensureDailyChoiceSelection


// ============================================================
// 小地图
// ============================================================
function updateMiniMap(ctx: ShopSceneCtx = _ctx): void {
  if (!ctx.miniMapGfx || !ctx.backpackSystem) return
  const g = ctx.miniMapGfx
  g.clear()
  const rows = ctx.backpackSystem.rows
  const cols = ctx.backpackView?.activeColCount ?? 6
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x    = c * MINI_CELL
      const y    = r * MINI_CELL
      const free = ctx.backpackSystem.canPlace(c, r, '1x1')
      g.rect(x + 1, y + 1, MINI_CELL - 2, MINI_CELL - 2)
      g.fill({ color: free ? 0x2a2a40 : 0xffcc44, alpha: free ? 0.35 : 0.75 })
      g.rect(x, y, MINI_CELL, MINI_CELL)
      g.stroke({ color: 0x555577, width: 1 })
    }
  }
}

function refreshPlayerStatusUI(ctx: ShopSceneCtx = _ctx): void {
  PlayerStatusUI.refreshPlayerStatusUI(ctx, {
    getHeroIconByStarterClass: () => getHeroIconByStarterClass(ctx),
    shouldShowHeroDailySkillReadyStar: () => shouldShowHeroDailySkillReadyStar(ctx),
  })
}


// ============================================================
// 刷新商店 UI
// ============================================================
function refreshShopUI(ctx: ShopSceneCtx = _ctx): void {
  if (!ctx.shopManager) return
  syncShopOwnedTierRules()
  if (ctx.shopPanel) {
    ctx.shopPanel.update([], ctx.shopManager.gold)
  }
  if (ctx.goldText) {
    ctx.goldText.text = `💰 ${ctx.shopManager.gold}G`
    ctx.goldText.x    = getDebugCfg('goldTextCenterX') - ctx.goldText.width / 2
    ctx.goldText.y    = getDebugCfg('goldTextY')
  }
  if (ctx.livesText) {
    if (PvpContext.isActive()) {
      // PVP 模式：显示 PVP HP，不显示 PVE 生命
      const pvpSession = PvpContext.getSession()
      const myHp = pvpSession?.playerHps?.[pvpSession?.myIndex ?? -1] ?? 30
      const initHp = pvpSession?.initialHp ?? 30
      ctx.livesText.text = `❤️ ${myHp}/${initHp}`
      ctx.livesText.style.fill = myHp <= 2 ? 0xff6a6a : 0xffd4d4
    } else {
      const lives = getLifeState()
      ctx.livesText.text = `❤️ ${lives.current}/${lives.max}`
      ctx.livesText.style.fill = lives.current <= 1 ? 0xff6a6a : 0xffd4d4
    }
    ctx.livesText.x = CANVAS_W - ctx.livesText.width - 18
    ctx.livesText.y = 18
  }
  if (ctx.trophyText) {
    if (PvpContext.isActive()) {
      // PVP 模式：隐藏奖杯
      ctx.trophyText.visible = false
    } else {
      ctx.trophyText.visible = true
      const target = getConfig().runRules?.trophyWinsToFinalVictory ?? 10
      const trophy = getWinTrophyState(target)
      ctx.trophyText.text = `🏆 ${trophy.wins}/${trophy.target}`
      ctx.trophyText.style.fill = trophy.wins >= trophy.target ? 0xffde79 : 0xffe8b4
      ctx.trophyText.x = CANVAS_W - ctx.trophyText.width - 18
      ctx.trophyText.y = (ctx.livesText?.y ?? 18) + (ctx.livesText?.height ?? 0) + 6
    }
  }
  if (ctx.refreshCostText) {
    ctx.refreshCostText.text = `💰 ${ctx.shopManager.gold}/${getQuickBuyPricePreviewLabel()}`
    ctx.refreshCostText.x    = getDebugCfg('refreshBtnX') - ctx.refreshCostText.width / 2
    ctx.refreshCostText.style.fill = ctx.shopManager.gold >= getQuickBuyMinPrice() ? getShopUiColor('gold') : getShopUiColor('danger')
  }
  if (ctx.refreshBtnHandle) {
    ctx.refreshBtnHandle.setLabel('购买')
    ctx.refreshBtnHandle.setSubLabel(`💰 ${ctx.shopManager.gold}/${getQuickBuyPricePreviewLabel()}`)
    const sub = ctx.refreshBtnHandle.container.getChildByName('sell-price') as Text | null
    if (sub) sub.style.fill = ctx.shopManager.gold >= getQuickBuyMinPrice() ? getShopUiColor('gold') : getShopUiColor('danger')
  }
  refreshPlayerStatusUI()
  if (ctx.specialShopBackpackViewActive) {
    setBaseShopPrimaryButtonsVisible(false)
    ctx.drag?.setEnabled(false)
    renderSpecialShopCheckMarks()
  }
  if ((ctx.skillDraftOverlay || ctx.eventDraftOverlay || ctx.specialShopOverlay) && !ctx.specialShopBackpackViewActive) {
    setBaseShopPrimaryButtonsVisible(false)
  }
  updateMiniMap()
  refreshUpgradeHints(_ctx)
  refreshBattlePassiveStatBadges(true)
  skillDraftPanel?.layoutSkillIconBar()
  checkAndPopPendingRewards()
  saveShopStateToStorage(captureShopState(ctx))
}
type PoolCandidate = {
  item: ItemDef
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7
  tier: TierKey
  star: 1 | 2
  price: number
}

function collectNeutralQuickBuyCandidates(): PoolCandidate[] {
  return neutralItemPanel?.collectNeutralQuickBuyCandidates() ?? []
}

function updateNeutralPseudoRandomCounterOnPurchase(item: ItemDef): void {
  neutralItemPanel?.updateNeutralPseudoRandomCounterOnPurchase(item)
}

function getQuickBuyMinPrice(ctx: ShopSceneCtx = _ctx): number {
  const offer = rollNextQuickBuyOffer(false, ctx)
  if (!offer) return SHOP_QUICK_BUY_PRICE
  return resolveBuyPriceWithSkills(ctx, offer.price).finalPrice
}

function getQuickBuyPricePreviewLabel(ctx: ShopSceneCtx = _ctx): string {
  const offer = rollNextQuickBuyOffer(false, ctx)
  if (!offer) return '-'
  return `${resolveBuyPriceWithSkills(ctx, offer.price).finalPrice}`
}

function buyRandomBronzeToBoardOrBackpack(ctx: ShopSceneCtx = _ctx): void {
  SkillSystem.buyRandomBronzeToBoardOrBackpack(ctx, {
    syncShopOwnedTierRules: () => syncShopOwnedTierRules(),
    rollNextQuickBuyOffer: (force) => rollNextQuickBuyOffer(force, ctx),
    findCandidateByOffer: (offer) => findCandidateByOffer(offer, ctx),
    collectPoolCandidatesByLevel: (level) => collectPoolCandidatesByLevel(level, ctx),
    canBuyItemUnderFirstPurchaseRule: (item) => canBuyItemUnderFirstPurchaseRule(ctx, item),
    showFirstPurchaseRuleHint: () => showFirstPurchaseRuleHint(),
    findFirstBattlePlace: (size) => findFirstBattlePlace(size),
    findFirstBackpackPlace: (size) => findFirstBackpackPlace(size),
    showHintToast: (reason, message, color) => showHintToast(reason as ToastReason, message, color, ctx),
    refreshShopUI: () => refreshShopUI(),
    markShopPurchaseDone: () => markShopPurchaseDone(),
    nextId: () => nextId(),
    toVisualTier: (tier, star) => toVisualTier(tier, star),
    instanceToDefId,
    setInstanceQualityLevel: (id, defId, q, lv) => setInstanceQualityLevel(id, defId, q, lv),
    levelFromLegacyTierStar: (tier, star) => levelFromLegacyTierStar(tier, star),
    instanceToPermanentDamageBonus,
    recordNeutralItemObtained: (itemId) => recordNeutralItemObtained(itemId),
    updateNeutralPseudoRandomCounterOnPurchase: (item) => updateNeutralPseudoRandomCounterOnPurchase(item),
    unlockItemToPool: (itemId) => unlockItemToPool(itemId),
  })
}

// ---- Day 辅助 ----

// getDayActiveCols / getShopItemScale / getBattleItemScale /
// getBattleZoneX / getBackpackZoneX / getBackpackZoneYByBattle
// → 已移至 ./shop/ShopMathHelpers.ts

function grantSkill20DailyBronzeItemIfNeeded(ctx: ShopSceneCtx = _ctx): void {
  SkillSystem.grantSkill20DailyBronzeItemIfNeeded(ctx, {
    findFirstBackpackPlace: (size) => findFirstBackpackPlace(size),
    nextId: () => nextId(),
    toVisualTier: (tier, star) => toVisualTier(tier, star),
    setInstanceQualityLevel: (id, defId, q, lv) => setInstanceQualityLevel(id, defId, q, lv),
    instanceToDefId,
    instanceToPermanentDamageBonus,
    recordNeutralItemObtained: (itemId) => recordNeutralItemObtained(itemId),
    unlockItemToPool: (itemId) => unlockItemToPool(itemId, ctx),
    showHintToast: (reason, message, color) => showHintToast(reason as ToastReason, message, color, ctx),
  })
}

function grantPoolCandidateToBoardOrBackpack(
  candidate: PoolCandidate,
  toastPrefix: string,
  opts?: { flyFromHeroAvatar?: boolean; silentNoSpaceToast?: boolean; onSettled?: () => void },
  ctx: ShopSceneCtx = _ctx,
): boolean {
  return ItemGrant.grantPoolCandidateToBoardOrBackpack(candidate, toastPrefix, opts, ctx, makeItemGrantCallbacks())
}

function buildNamedPoolCandidate(nameCn: string): PoolCandidate | null {
  return ItemGrant.buildNamedPoolCandidate(nameCn)
}


function setDay(day: number, ctx: ShopSceneCtx = _ctx): void {
  const prevDay = ctx.currentDay
  ctx.currentDay = Math.max(1, Math.min(20, day))
  if (ctx.currentDay !== prevDay) {
    resetDayEventState(ctx)
    ctx.pendingEventDraft = null
    eventDraftPanel?.closeEventDraftOverlay()
    closeSpecialShopOverlay()
    ctx.specialShopRefreshCount = 0
    ctx.specialShopOffers = []
    QUALITY_PSEUDO_RANDOM_STATE.clear()
    QUICK_BUY_LEVEL_PSEUDO_RANDOM_STATE.clear()
    ctx.nextQuickBuyOffer = null
  }
  const newCols = getDayActiveCols(ctx.currentDay)

  // 1. 更新 GridZone 格子背景（立即重绘）
  if (ctx.battleView) ctx.battleView.setActiveColCount(newCols)

  // 2. 动画：ctx.battleView.x 从当前值平滑移至新居中位置
  if (ctx.battleView) {
    const fromX = ctx.battleView.x
    const toX   = getBattleZoneX(newCols, ctx)
    if (ctx.expandTickFn) { Ticker.shared.remove(ctx.expandTickFn); ctx.expandTickFn = null }
    if (Math.abs(toX - fromX) > 1) {
      const durationMs = getDebugCfg('battleZoneExpandMs')
      const startMs    = Date.now()
      ctx.expandTickFn = () => {
        const t    = Math.min((Date.now() - startMs) / durationMs, 1)
        const ease = 1 - Math.pow(1 - t, 3)
        ctx.battleView!.x = fromX + (toX - fromX) * ease
        applyAreaLabelLeftAlign(ctx)
        skillDraftPanel?.layoutSkillIconBar()
        if (t >= 1) { Ticker.shared.remove(ctx.expandTickFn!); ctx.expandTickFn = null }
      }
      Ticker.shared.add(ctx.expandTickFn)
    } else {
      ctx.battleView.x = toX
      applyAreaLabelLeftAlign(ctx)
      skillDraftPanel?.layoutSkillIconBar()
    }
  }

  // 3. 同步 ShopManager 天数并刷新商店卡池
  if (ctx.shopManager) {
    syncShopOwnedTierRules(ctx)
    ctx.shopManager.setDay(ctx.currentDay)
    // Debug 改天数：每次实际变更天数都发放一次当日金币
    if (ctx.currentDay !== prevDay) {
      if (!ctx.blockedBaseIncomeDays.has(ctx.currentDay)) {
        ctx.shopManager.gold += getDailyGoldForDay(getConfig(), ctx.currentDay)
      } else {
        ctx.blockedBaseIncomeDays.delete(ctx.currentDay)
        showHintToast('no_gold_buy', '事件效果：今日基础收入已被透支', 0xffd48f, ctx)
      }
      grantSilverDailyGoldBonusesOnNewDay(ctx)
      applyFutureEventEffectsOnNewDay(ctx.currentDay, ctx)
      grantHeroPeriodicEffectsOnNewDay(ctx.currentDay, ctx)
    }
  }
  if (ctx.currentDay !== prevDay) grantSkill20DailyBronzeItemIfNeeded(ctx)
  refreshShopUI()

  // 4. 更新 Debug 天数文字
  if (ctx.dayDebugText) {
    ctx.dayDebugText.text = `Day ${ctx.currentDay}`
    layoutDayDebugControls(ctx)
  }
  ensureDailyChoiceSelection(getApp().stage)
}

function layoutDayDebugControls(ctx: ShopSceneCtx = _ctx): void {
  DebugLayout.layoutDayDebugControls(ctx)
}

function applyAreaLabelLeftAlign(ctx: ShopSceneCtx = _ctx): void {
  DebugLayout.applyAreaLabelLeftAlign(ctx)
}

function ensureBottomHudVisibleAndOnTop(stage: Container, ctx: ShopSceneCtx = _ctx): void {
  if (ctx.btnRow) {
    ctx.btnRow.visible = true
    stage.addChild(ctx.btnRow)
  }
  if (ctx.goldText) ctx.goldText.visible = true
  applySellButtonState(ctx)
}

function applySellButtonState(ctx: ShopSceneCtx = _ctx): void {
  DragSystem.applySellButtonState(ctx)
}

// canPlaceInVisibleCols / hasAnyPlaceInVisibleCols -> moved to ./shop/ShopMathHelpers.ts


function clearSelection(ctx: ShopSceneCtx = _ctx): void {
  DragSystem.clearSelection(ctx, makeShopDragDeps())
}

function setSellButtonPrice(price: number, ctx: ShopSceneCtx = _ctx): void {
  DragSystem.setSellButtonPrice(price, ctx)
}


// clearAutoPackCache / clonePackPlan / getBackpackStateSignature / getAutoPackPlanCached /
// buildBackpackAutoPackPlan / applyBackpackAutoPackExisting / canBackpackAcceptByAutoPack /
// getOverlapBlockersInBattle / buildBackpackPlanForTransferred / applyBackpackPlanWithTransferred
// → 已移至 ./shop/ShopAutoPackManager.ts

// getArchetypeSortOrder -> moved to ./shop/ShopAutoPackManager.ts



function isOverGridDragSellArea(gx: number, gy: number): boolean {
  return DragSystem.isOverGridDragSellArea(gx, gy)
}

function isOverAnyGridDropTarget(gx: number, gy: number, size: ItemSizeNorm, ctx: ShopSceneCtx = _ctx): boolean {
  return DragSystem.isOverAnyGridDropTarget(gx, gy, size, ctx)
}

function updateGridDragSellAreaHover(gx: number, gy: number, size: ItemSizeNorm, ctx: ShopSceneCtx = _ctx): void {
  DragSystem.updateGridDragSellAreaHover(gx, gy, size, ctx)
}

function startGridDragButtonFlash(stage: Container, canSell: boolean, canToBackpack: boolean, sellPrice = 0, ctx: ShopSceneCtx = _ctx): void {
  DragSystem.startGridDragButtonFlash(stage, canSell, canToBackpack, sellPrice, ctx)
}

function stopGridDragButtonFlash(ctx: ShopSceneCtx = _ctx): void {
  DragSystem.stopGridDragButtonFlash(ctx)
}


// ============================================================
// 商店拖拽：开始
// ============================================================
function startShopDrag(slotIndex: number, e: FederatedPointerEvent, stage: Container, ctx: ShopSceneCtx = _ctx): void {
  DragSystem.startShopDrag(slotIndex, e, stage, ctx, makeShopDragDeps())
}

function resetDrag(ctx: ShopSceneCtx = _ctx): void {
  DragSystem.resetDrag(ctx, makeShopDragDeps())
}

function isOverBpBtn(gx: number, gy: number): boolean {
  return DragSystem.isOverBpBtn(gx, gy)
}

function isPointInZoneArea(view: GridZone | null, gx: number, gy: number): boolean {
  return DragSystem.isPointInZoneArea(view, gx, gy)
}


// ============================================================
// onEnter 子初始化函数
// ============================================================

function initPanelInstances(stage: Container, ctx: ShopSceneCtx = _ctx): void {
  // ---- PVP 面板初始化 ----
  pvpPanel = new PvpPanel(ctx)
    stage.addChild(pvpPanel)

    // ---- Settings/Debug 面板初始化 ----
    settingsPanel = new SettingsDebugPanel(ctx, stage, {
      refreshShopUI: () => refreshShopUI(),
      captureAndSave: () => saveShopStateToStorage(captureShopState(ctx)),
      refreshSkillIconBar: () => skillDraftPanel?.refreshSkillIconBar(),
      hasPickedSkill: (id) => hasPickedSkill(ctx, id),
      upsertPickedSkill: (id) => upsertPickedSkill(id),
      removePickedSkill: (id) => removePickedSkill(id),
      applyEventEffect: (event, fromTest) => applyEventEffect(event, fromTest),
      markEventSelected: (id) => markEventSelected(ctx, id),
      resetEventSelectionCounters: () => resetEventSelectionCounters(ctx),
      showHintToast: (reason, msg, color) => showHintToast(reason, msg, color, _ctx),
      placeItemToInventoryOrBattle: (def, tier, star) => placeItemToInventoryOrBattle(def, tier, star),
      getQualityLevelRange: (quality) => getQualityLevelRange(quality),
      levelToTierStar: (level) => levelToTierStar(level),
      getEventPoolRows: () => getEventPoolRows(),
      getSelectedEventCount: (id) => getSelectedEventCount(ctx, id),
      isEventChoiceAvailable: (event, day) => isEventChoiceAvailable(ctx, event, day),
      getPrimaryArchetype: (tags) => getPrimaryArchetype(tags),
      isNeutralArchetypeKey: (arch) => isNeutralArchetypeKey(arch),
      getAllItems: () => [...getAllItems()],
    })
    stage.addChild(settingsPanel)

    // ---- SkillDraft 面板初始化 ----
    skillDraftPanel = new SkillDraftPanel(ctx, stage, {
      captureAndSave: () => saveShopStateToStorage(captureShopState(ctx)),
      clearSelection: () => clearSelection(),
      setTransitionInputEnabled: (enabled) => setTransitionInputEnabled(enabled),
      setBaseShopPrimaryButtonsVisible: (visible) => setBaseShopPrimaryButtonsVisible(visible),
      applyPhaseInputLock: () => applyPhaseInputLock(),
      upsertPickedSkill: (skillId) => upsertPickedSkill(skillId),
      getSkillTierForDay: (day) => getSkillTierForDay(day),
      pickSkillChoices: (tier, day) => pickSkillChoices(ctx, tier, day),
      pickSkillChoicesNoOverlap: (tier, day, blocked) => pickSkillChoicesNoOverlap(ctx, tier, day, blocked),
      pickSkillChoicesExactTier: (tier, blocked) => pickSkillChoicesExactTier(ctx, tier, blocked),
      shouldShowSimpleDescriptions: () => shouldShowSimpleDescriptions(),
      isSkillDraftRerollEnabled: () => isSkillDraftRerollEnabled(),
      getDefaultSkillDetailMode: () => getDefaultSkillDetailMode(),
      showHintToast: (reason, msg, color) => showHintToast(reason, msg, color, _ctx),
      resetInfoModeSelection: () => resetInfoModeSelection(_ctx),
      applySellButtonState: () => applySellButtonState(),
    })
    stage.addChild(skillDraftPanel)

    // ---- EventDraft 面板初始化 ----
    eventDraftPanel = new EventDraftPanel(ctx, stage, {
      captureAndSave: () => saveShopStateToStorage(captureShopState(ctx)),
      clearSelection: () => clearSelection(),
      setTransitionInputEnabled: (enabled) => setTransitionInputEnabled(enabled),
      setBaseShopPrimaryButtonsVisible: (visible) => setBaseShopPrimaryButtonsVisible(visible),
      applyPhaseInputLock: () => applyPhaseInputLock(),
      applyEventEffect: (event, fromTest) => applyEventEffect(event, fromTest),
      markEventSelected: (id) => markEventSelected(ctx, id),
      getDailyPlanRow: (day) => getDailyPlanRow(day),
      pickRandomEventDraftChoices: (day) => pickRandomEventDraftChoices(ctx, day),
      pickRandomEventDraftChoicesNoOverlap: (day, blocked) => pickRandomEventDraftChoicesNoOverlap(ctx, day, blocked),
      resolveEventDescText: (event, detailed) => resolveEventDescText(ctx, event, detailed),
      shouldShowSimpleDescriptions: () => shouldShowSimpleDescriptions(),
      isEventDraftRerollEnabled: () => isEventDraftRerollEnabled(),
      showHintToast: (reason, msg, color) => showHintToast(reason, msg, color, _ctx),
    })
    stage.addChild(eventDraftPanel)

    // ---- SpecialShop 面板初始化 ----
    specialShopPanel = new SpecialShopPanel(ctx, stage, {
      captureAndSave: () => saveShopStateToStorage(captureShopState(ctx)),
      clearSelection: () => clearSelection(),
      setTransitionInputEnabled: (enabled) => setTransitionInputEnabled(enabled),
      setBaseShopPrimaryButtonsVisible: (visible) => setBaseShopPrimaryButtonsVisible(visible),
      applyPhaseInputLock: () => applyPhaseInputLock(),
      refreshShopUI: () => refreshShopUI(),
      refreshPlayerStatusUI: () => refreshPlayerStatusUI(),
      showHintToast: (reason, msg, color) => showHintToast(reason, msg, color, _ctx),
      checkAndPopPendingRewards: () => checkAndPopPendingRewards(),
      getDailyPlanRow: (day) => getDailyPlanRow(day),
      parseAvailableTiers: (raw) => parseAvailableTiers(raw),
      getSizeCols: (size) => getSizeCols(size),
      getInstanceTier: (instanceId) => getInstanceTier(instanceId),
      getInstanceTierStar: (instanceId) => getInstanceTierStar(instanceId),
      toVisualTier: (tier, star) => toVisualTier(tier, star),
      removeInstanceMeta: (instanceId) => removeInstanceMeta(instanceId),
      setInstanceQualityLevel: (instanceId, defId, quality, level) => setInstanceQualityLevel(instanceId, defId, quality, level),
      instanceToDefId,
      instanceToTier,
      instanceToPermanentDamageBonus,
      nextId: () => nextId(),
      markShopPurchaseDone: () => markShopPurchaseDone(),
      recordNeutralItemObtained: (defId) => recordNeutralItemObtained(defId),
      unlockItemToPool: (defId) => unlockItemToPool(defId),
      resolveBuyPriceWithSkills: (basePrice) => resolveBuyPriceWithSkills(ctx, basePrice),
      consumeSkill15NextBuyDiscountAfterSuccess: () => consumeSkill15NextBuyDiscountAfterSuccess(ctx),
      consumeSkill30BundleAfterSuccess: (consumed) => consumeSkill30BundleAfterSuccess(ctx, consumed),
      canBuyItemUnderFirstPurchaseRule: (item) => canBuyItemUnderFirstPurchaseRule(ctx, item),
      showFirstPurchaseRuleHint: () => showFirstPurchaseRuleHint(),
      findFirstBattlePlace: (size) => findFirstBattlePlace(size),
      findFirstBackpackPlace: (size) => findFirstBackpackPlace(size),
      shouldShowSimpleDescriptions: () => shouldShowSimpleDescriptions(),
      addArchetypeCornerBadge: (card, item, cardW, iconTopY) => addArchetypeCornerBadge(card, item, cardW, iconTopY),
      ammoValueFromLineByStar: (item, tier, star, line) => ammoValueFromLineByStar(item, tier, star, line),
      rewriteNeutralRandomPick: (item) => rewriteNeutralRandomPick(item),
      canRandomNeutralItem: (item) => canRandomNeutralItem(item),
    })
    stage.addChild(specialShopPanel)

    // ---- NeutralItem 面板初始化 ----
    neutralItemPanel = new NeutralItemPanel(ctx, stage, {
      captureAndSave: () => saveShopStateToStorage(captureShopState(ctx)),
      refreshShopUI: () => refreshShopUI(),
      refreshPlayerStatusUI: () => refreshPlayerStatusUI(),
      setTransitionInputEnabled: (enabled) => setTransitionInputEnabled(enabled),
      setBaseShopPrimaryButtonsVisible: (visible) => setBaseShopPrimaryButtonsVisible(visible),
      applyPhaseInputLock: () => applyPhaseInputLock(),
      showHintToast: (reason, msg, color) => showHintToast(reason, msg, color, _ctx),
      clearBackpackSynthesisGuideArrows: () => clearBackpackSynthesisGuideArrows(),
      placeItemToInventoryOrBattle: (def, tier, star) => placeItemToInventoryOrBattle(def, tier, star),
      unlockItemToPool: (defId) => unlockItemToPool(defId),
      getInstanceLevel: (instanceId) => getInstanceLevel(instanceId),
      getInstanceTier: (instanceId) => getInstanceTier(instanceId),
      getInstanceTierStar: (instanceId) => getInstanceTierStar(instanceId),
      setInstanceQualityLevel: (instanceId, defId, quality, level) => setInstanceQualityLevel(instanceId, defId, quality, level),
      removeInstanceMeta: (instanceId) => removeInstanceMeta(instanceId),
      toVisualTier: (tier, star) => toVisualTier(tier, star),
      instanceToDefId,
      isBackpackDropLocked: (col, row, size) => isBackpackDropLocked(col, row, size),
      isPointInItemBounds: (view, item, gx, gy) => isPointInItemBounds(view, item, gx, gy),
      getSizeCellDim: (size) => getSizeCellDim(size),
      findFirstBattlePlace: (size) => findFirstBattlePlace(size),
      findFirstBackpackPlace: (size) => findFirstBackpackPlace(size),
      upgradePlacedItem: (instanceId, zone, withFx) => upgradePlacedItem(instanceId, zone, withFx),
      getAllOwnedPlacedItems: () => getAllOwnedPlacedItems(),
      collectUpgradeableOwnedPlacedItems: (zone) => collectUpgradeableOwnedPlacedItems(zone),
      applyInstanceTierVisuals: () => applyInstanceTierVisuals(),
      syncShopOwnedTierRules: () => syncShopOwnedTierRules(),
      refreshUpgradeHints: () => refreshUpgradeHints(_ctx),
      grantSynthesisExp: (amount, from) => grantSynthesisExp(amount, from),
      playTransformOrUpgradeFlashEffect: (instanceId, zone) => playTransformOrUpgradeFlashEffect(ctx, instanceId, zone),
      canTriggerHeroSameItemSynthesisChoice: () => canTriggerHeroSameItemSynthesisChoice(ctx),
      markHeroSameItemSynthesisChoiceTriggered: () => markHeroSameItemSynthesisChoiceTriggered(),
      canUseSameArchetypeDiffItemStoneSynthesis: (a, b, c, d, e, f) => canUseSameArchetypeDiffItemStoneSynthesis(a, b, c, d, e, f),
      canUseHeroDailyCardReroll: () => canUseHeroDailyCardReroll(ctx),
      collectPoolCandidatesByLevel: (level) => collectPoolCandidatesByLevel(level),
      pickQualityByPseudoRandomBag: (level, available) => pickQualityByPseudoRandomBag(level, available),
      getMaxQuickBuyLevelForDay: (day) => getMaxQuickBuyLevelForDay(day),
      getQuickBuyLevelWeightsByDay: (day) => getQuickBuyLevelWeightsByDay(day),
      getUnlockPoolBuyPriceByLevel: (level) => getUnlockPoolBuyPriceByLevel(level as 1 | 2 | 3 | 4 | 5 | 6 | 7),
      parseAvailableTiers: (raw) => parseAvailableTiers(raw),
      compareTier: (a, b) => compareTier(a, b),
      openEventDraftPanel: () => {
        eventDraftPanel?.closeEventDraftOverlay()
        eventDraftPanel?.ensureEventDraftSelection()
      },
      openSpecialShopPanel: () => specialShopPanel?.openSpecialShopFromNeutralScroll() ?? false,
      openSkillDraftPanel: (_tier) => {
        skillDraftPanel?.closeSkillDraftOverlay()
        skillDraftPanel?.ensureSkillDraftSelection()
        return true
      },
      shouldShowSimpleDescriptions: () => shouldShowSimpleDescriptions(),
      addArchetypeCornerBadge: (card, item, cardW, iconTopY) => addArchetypeCornerBadge(card, item, cardW, iconTopY),
      getSpecialShopShownDesc: (item, tier, star, detailed) => getSpecialShopShownDesc(item, tier, star, detailed),
      getSpecialShopSpeedTierText: (ms) => getSpecialShopSpeedTierText(ms),
      ammoValueFromLineByStar: (item, tier, star, line) => ammoValueFromLineByStar(item, tier, star, line),
      createGuideItemCard: (item, levelText, tierForFrame) => createGuideItemCard(item, levelText, tierForFrame),
      getGuideFrameTierByLevel: (levelText) => getGuideFrameTierByLevel(levelText),
      pickSkillChoicesExactTier: (tier) => pickSkillChoicesExactTier(ctx, tier),
      pickRandomEventDraftChoices: (day) => pickRandomEventDraftChoices(ctx, day),
    })
    stage.addChild(neutralItemPanel)

    synthesisPanel = new SynthesisPanel(ctx, stage, {
      captureAndSave: () => saveShopStateToStorage(captureShopState(ctx)),
      refreshShopUI: () => refreshShopUI(),
      refreshPlayerStatusUI: () => refreshPlayerStatusUI(),
      canUseSameArchetypeDiffItemStoneSynthesis: (a, b, c, d, e, f) => canUseSameArchetypeDiffItemStoneSynthesis(a, b, c, d, e, f),
      getInstanceTier: (instanceId) => getInstanceTier(instanceId),
      getInstanceTierStar: (instanceId) => getInstanceTierStar(instanceId),
      toVisualTier: (tier, star) => toVisualTier(tier, star),
      getItemDefByCn: (nameCn) => getItemDefByCn(nameCn),
    })
    stage.addChild(synthesisPanel)
}

function setupEventBusAndPvpCallbacks(stage: Container, ctx: ShopSceneCtx = _ctx): void {
  EventBusSetup.setupEventBusAndPvpCallbacks(stage, ctx, makeEventBusSetupCallbacks())
}

function buildTopAreaUI(stage: Container, cfg: ReturnType<typeof getConfig>, ctx: ShopSceneCtx = _ctx): void {
  UIBuilders.buildTopAreaUI(stage, cfg, ctx, makeTopAreaUICallbacks())
}
function buildBattleZoneUI(stage: Container, cfg: ReturnType<typeof getConfig>, ctx: ShopSceneCtx = _ctx): void {
    const canvas = getApp().canvas as HTMLCanvasElement

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
      else refreshBackpackSynthesisGuideArrows(defId, tier ?? null, star, instanceId)
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
      const overAnyDropTarget = isOverAnyGridDropTarget(anchorGx, anchorGy, size)
      const forceDiscardForNeutralStone = !!sourceDef && isNeutralTargetStone(sourceDef) && overSellArea

      // 1) 拖到下方丢弃区域：直接丢弃
      // 普通物品：未命中任意格子候选时才丢弃；
      // 变化石/转职石：命中丢弃区时优先允许丢弃，避免“无目标时无法丢弃”。
      if ((overSellArea && !overAnyDropTarget) || forceDiscardForNeutralStone) {
        if (sourceDef && isNeutralItemDef(sourceDef)) {
          const ok = applyNeutralDiscardEffect(sourceDef, stage)
          if (!ok) return false
        }
        homeSystem.remove(instanceId)
        removeInstanceMeta(instanceId)
        showHintToast('no_gold_buy', `已丢弃：${sourceDef?.name_cn ?? item.name_cn}`, 0x9be5ff, _ctx)
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
        const blockedBattleSynth = findBattleSynthesisTargetWithDragProbeIgnoringNoSynthesis(defId, fromTier, fromStar, anchorGx, anchorGy, size)
        if (blockedBattleSynth) {
          showHintToast('backpack_full_buy', '上阵区内无法合成', 0xffd48f, _ctx)
        }
      }

      // 1.5) 拖到同装备同品质目标物品：执行合成（优先于挤出/普通落位）
      const canLv7Morph = canUseLv7MorphSynthesis(defId, defId, fromTier, fromStar, fromTier, fromStar)
      if (nextTierLevel(fromTier, fromStar) || canLv7Morph) {
        const synthTarget = findSynthesisTargetWithDragProbe(defId, fromTier, fromStar, anchorGx, anchorGy, size)
        if (synthTarget) {
          const targetItem = getSynthesisTargetItem(synthTarget)
          const targetTier = getInstanceTier(synthTarget.instanceId) ?? fromTier
          const targetStar = getInstanceTierStar(synthTarget.instanceId)
          const lv7MorphMode = !!targetItem && canUseLv7MorphSynthesis(defId, targetItem.defId, fromTier, fromStar, targetTier, targetStar)
          if (lv7MorphMode) {
            showLv7MorphSynthesisConfirmOverlay(stage, () => {
              const choices = buildStoneTransformChoices(synthTarget, 'same')
              if (choices.length <= 0) {
                showHintToast('backpack_full_buy', 'Lv7转化：当前无可用候选', 0xffb27a, _ctx)
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
                )
                refreshShopUI()
                return
              }
              const opened = showNeutralChoiceOverlay(stage, '选择变化方向', choices, (picked) => {
                const ok = transformPlacedItemKeepLevelTo(synthTarget.instanceId, synthTarget.zone, picked.item, true)
                if (!ok) {
                  showHintToast('backpack_full_buy', 'Lv7转化失败', 0xff8f8f, _ctx)
                  return false
                }
                removeInstanceMeta(instanceId)
                grantSynthesisExp(1, { instanceId: synthTarget.instanceId, zone: synthTarget.zone })
                showHintToast('no_gold_buy', 'Lv7合成：已触发变化石效果', 0x9be5ff, _ctx)
                refreshShopUI()
                return true
              }, 'special_shop_like')
              if (!opened) {
                showHintToast('backpack_full_buy', 'Lv7转化：当前无可用候选', 0xffb27a, _ctx)
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
                showHintToast('backpack_full_buy', '合成目标无效', 0xff8f8f, _ctx)
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
              synthesisPanel?.showCrossSynthesisConfirmOverlay(
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
          showHintToast('backpack_full_transfer', '背包已满，无法转移', 0xff8f8f, _ctx)
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
      updateGridDragSellAreaHover(anchorGx, anchorGy, size)

      // 可用状态随时重算（例如拖拽过程中背包可见状态变化）
      if (ctx.gridDragCanToBackpack) {
        ctx.gridDragCanToBackpack = !ctx.showingBackpack
      }

      const defId = instanceToDefId.get(instanceId)
      const tier = getInstanceTier(instanceId)
      const star = getInstanceTierStar(instanceId)
      const item = defId ? getItemDefById(defId) : null
      if (isNeutralTargetStone(item)) refreshNeutralStoneGuideArrows(item, instanceId)
      else refreshBackpackSynthesisGuideArrows(defId ?? null, tier ?? null, star, instanceId)

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
        synthesisPanel?.hideSynthesisHoverInfo()
        return
      }

      const canLv7Morph = !!defId && !!tier && canUseLv7MorphSynthesis(defId, defId, tier, star, tier, star)
      if (!defId || !tier || (!nextTierLevel(tier, star) && !canLv7Morph)) {
        ctx.drag?.setSqueezeSuppressed(false)
        clearBackpackSynthesisGuideArrows()
        if (item && ctx.sellPopup) {
          ctx.sellPopup.show(item, sellPrice, 'none', toVisualTier(tier, star), undefined, getDefaultItemInfoMode())
        }
        return
      }

      if (item && isNeutralTargetStone(item)) {
        const target = findNeutralStoneTargetWithDragProbe(item, anchorGx, anchorGy, size)
        if (target) {
          ctx.drag?.setSqueezeSuppressed(true, true)
          highlightSynthesisTarget(target)
          showNeutralStoneHoverInfo(item, target)
        } else {
          ctx.drag?.setSqueezeSuppressed(false)
          synthesisPanel?.hideSynthesisHoverInfo()
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

      const synthTarget = findSynthesisTargetWithDragProbe(defId, tier, star, anchorGx, anchorGy, size)
      if (synthTarget) {
        ctx.drag?.setSqueezeSuppressed(true, true)
        highlightSynthesisTarget(synthTarget)
        synthesisPanel?.showSynthesisHoverInfo(defId, tier, star, synthTarget)
      } else {
        ctx.drag?.setSqueezeSuppressed(false)
        synthesisPanel?.hideSynthesisHoverInfo()
        if (item && ctx.sellPopup) {
          ctx.sellPopup.show(item, sellPrice, 'none', toVisualTier(tier, star), undefined, getDefaultItemInfoMode())
        }
      }
    }
    ctx.drag.onDragEnd = () => {
      ctx.drag?.setSqueezeSuppressed(false)
      synthesisPanel?.hideSynthesisHoverInfo()
      clearBackpackSynthesisGuideArrows()
      stopGridDragButtonFlash(ctx)
      applyInstanceTierVisuals()
      updateMiniMap()
      refreshBattlePassiveStatBadges(true)
      clearSelection()
    }
}

function buildButtonRowUI(stage: Container, cfg: ReturnType<typeof getConfig>, ctx: ShopSceneCtx = _ctx): void {
  UIBuilders.buildButtonRowUI(stage, cfg, ctx, makeButtonRowUICallbacks())
}


// ============================================================
// 主场景
// ============================================================
export const ShopScene: Scene = {
  name: 'shop',

  onEnter() {
    console.log('[ShopScene] 进入商店场景')
    const app    = getApp()
    const cfg    = getConfig()
    const items  = getAllItems()
    const stage  = app.stage

    initPanelInstances(stage)

    setupEventBusAndPvpCallbacks(stage)

    _ctx.shopManager = new ShopManager(cfg, items, 1)

    buildTopAreaUI(stage, cfg)

    buildBattleZoneUI(stage, cfg)

    buildButtonRowUI(stage, cfg)

    _ctx.offPhaseChange = PhaseManager.onChange((next, prev) => {
      if (next === 'COMBAT') {
        const snapshot = buildBattleSnapshot(_ctx, _ctx.pendingSkillBarMoveStartAtMs ?? undefined)
        if (snapshot) {
          setBattleSnapshot(snapshot)
          console.log(`[ShopScene] 战斗快照已生成 day=${snapshot.day} entities=${snapshot.entities.length} cols=${snapshot.activeColCount}`)
        }
      }
      if (prev === 'COMBAT' && next !== 'COMBAT') {
        clearBattleSnapshot()
      }
      applyPhaseInputLock()
    })

    // PVP 模式下不从 localStorage 读取（防止加载 PVE 存档），依赖 _ctx.savedShopState 内存维持阶段状态
    const restoredState = _ctx.savedShopState ?? (PvpContext.isActive() ? null : loadShopStateFromStorage())
    const battleOutcome = consumeBattleOutcome()
    if (restoredState) {
      applySavedShopState(restoredState, _ctx, makeApplyCallbacks())
      _ctx.savedShopState = null
      if (_ctx.pendingAdvanceToNextDay || PvpContext.isActive()) {
        if (PvpContext.isActive() && PvpContext.isMidDayShopPhase()) {
          // PVP 中间商店阶段（shop2/shop3）：刷新卡池但不发放基础日收入
          setDay(_ctx.currentDay)  // 同一天 → setDay 内部不触发收入逻辑
          const wildBonus = PvpContext.consumePendingWildGoldBonus()
          if (wildBonus > 0 && _ctx.shopManager) {
            _ctx.shopManager.gold += wildBonus
            console.log('[ShopScene] 野怪奖励 +' + wildBonus + 'G')
          }
        } else {
          setDay(_ctx.currentDay + 1)
        }
        applyPostBattleEffects(battleOutcome?.snapshot ?? null)
        _ctx.pendingAdvanceToNextDay = false
      }
      grantSkill20DailyBronzeItemIfNeeded()
    } else {
      _ctx.pendingAdvanceToNextDay = false
      _ctx.starterClass = null
      _ctx.starterHeroChoiceOptions = []
      _ctx.starterGranted = false
      _ctx.starterBattleGuideShown = false
      _ctx.hasBoughtOnce = false
      resetSkill15NextBuyDiscountState(_ctx)
      resetSkill30BundleState(_ctx)
      _ctx.quickBuyNoSynthRefreshStreak = 0
      _ctx.quickBuyNeutralMissStreak = 0
      _ctx.pickedSkills = []
      _ctx.draftedSkillDays = []
      _ctx.pendingSkillDraft = null
      _ctx.draftedEventDays = []
      _ctx.pendingEventDraft = null
      _ctx.draftedSpecialShopDays = []
      _ctx.specialShopRefreshCount = 0
      _ctx.specialShopOffers = []
      resetEventSelectionCounters(_ctx)
      resetDayEventState(_ctx)
      resetFutureEventState(_ctx)
      _ctx.skillDetailMode = getDefaultSkillDetailMode()
      _ctx.skill20GrantedDays.clear()
      _ctx.unlockedItemIds.clear()
      _ctx.neutralObtainedCountByKind.clear()
      _ctx.neutralRandomCategoryPool = []
      _ctx.neutralDailyRollCountByDay.clear()
      _ctx.guaranteedNewUnlockTriggeredLevels.clear()
      QUALITY_PSEUDO_RANDOM_STATE.clear()
      QUICK_BUY_LEVEL_PSEUDO_RANDOM_STATE.clear()
      _ctx.nextQuickBuyOffer = null
      _ctx.heroDailyCardRerollUsedDays.clear()
      _ctx.heroFirstDiscardRewardedDays.clear()
      _ctx.heroFirstSameItemSynthesisChoiceDays.clear()
      _ctx.heroSmithStoneGrantedDays.clear()
      _ctx.heroAdventurerScrollGrantedDays.clear()
      _ctx.heroCommanderMedalGrantedDays.clear()
      _ctx.heroHeirGoldEquipGrantedDays.clear()
      _ctx.heroTycoonGoldGrantedDays.clear()
      _ctx.pendingHeroPeriodicRewards = []
      _ctx.pendingHeroPeriodicRewardDispatching = false
      syncUnlockPoolToManager()
      grantSkill20DailyBronzeItemIfNeeded()
    }
    skillDraftPanel?.refreshSkillIconBar()
    refreshShopUI()
    applyPhaseInputLock()
    ensureStarterClassSelection(stage)
    ensureDailyChoiceSelection(stage)
  },

  onExit() {
    console.log('[ShopScene] 离开商店场景')
    const { stage } = getApp()

    pvpPanel?.destroy({ children: true })
    pvpPanel = null

    settingsPanel?.closeSettingsOverlay()
    settingsPanel?.destroy({ children: true })
    settingsPanel = null

    skillDraftPanel?.closeSkillDraftOverlay()
    skillDraftPanel?.destroy({ children: true })
    skillDraftPanel = null

    eventDraftPanel?.closeEventDraftOverlay()
    eventDraftPanel?.destroy({ children: true })
    eventDraftPanel = null

    specialShopPanel?.closeSpecialShopOverlay()
    specialShopPanel?.destroy({ children: true })
    specialShopPanel = null

    neutralItemPanel?.destroy({ children: true })
    neutralItemPanel = null

    synthesisPanel?.teardownCrossSynthesisConfirmOverlay()
    synthesisPanel?.destroy({ children: true })
    synthesisPanel = null

    stopFlashEffect(_ctx)
    stopGridDragButtonFlash(_ctx)
    stopBattleGuideHandAnim(_ctx)
    stopUnlockRevealPlayback(_ctx)

    if (_ctx.shopDragFloater) {
      stage.removeChild(_ctx.shopDragFloater)
      _ctx.shopDragFloater.destroy({ children: true })
      _ctx.shopDragFloater = null
    }
    resetDrag()

    if (_ctx.shopPanel)    { stage.removeChild(_ctx.shopPanel); _ctx.shopPanel.destroy({ children: true }); _ctx.shopPanel = null }
    if (_ctx.sellPopup)    stage.removeChild(_ctx.sellPopup)
    if (_ctx.battleView)   { stage.removeChild(_ctx.battleView); _ctx.battleView.destroy({ children: true }); _ctx.battleView = null }
    if (_ctx.backpackView) { stage.removeChild(_ctx.backpackView); _ctx.backpackView.destroy({ children: true }); _ctx.backpackView = null }
    if (_ctx.battleZoneTitleText) stage.removeChild(_ctx.battleZoneTitleText)
    if (_ctx.backpackZoneTitleText) stage.removeChild(_ctx.backpackZoneTitleText)
    if (_ctx.shopAreaBg)   stage.removeChild(_ctx.shopAreaBg)
    if (_ctx.backpackAreaBg) stage.removeChild(_ctx.backpackAreaBg)
    if (_ctx.battleAreaBg) stage.removeChild(_ctx.battleAreaBg)
    if (_ctx.restartBtn)   stage.removeChild(_ctx.restartBtn)
    if (_ctx.playerStatusCon) stage.removeChild(_ctx.playerStatusCon)
    if (_ctx.livesText)    stage.removeChild(_ctx.livesText)
    if (_ctx.trophyText)   stage.removeChild(_ctx.trophyText)
    if (_ctx.pvpPlayerListOverlay) {
      stage.removeChild(_ctx.pvpPlayerListOverlay)
      _ctx.pvpPlayerListOverlay.destroy({ children: true })
      _ctx.pvpPlayerListOverlay = null
    }
    if (_ctx.pvpWaitingPanel) {
      stage.removeChild(_ctx.pvpWaitingPanel)
      _ctx.pvpWaitingPanel.destroy({ children: true })
      _ctx.pvpWaitingPanel = null
    }
    if (_ctx.pvpOpponentBadge) {
      stage.removeChild(_ctx.pvpOpponentBadge)
      _ctx.pvpOpponentBadge.destroy({ children: true })
      _ctx.pvpOpponentBadge = null
    }
    if (_ctx.pvpOpponentHeroLayer) {
      stage.removeChild(_ctx.pvpOpponentHeroLayer)
      _ctx.pvpOpponentHeroLayer.destroy({ children: true })
      _ctx.pvpOpponentHeroLayer = null
    }
    if (_ctx.pvpBackpackReturnBtn) {
      _ctx.pvpBackpackReturnBtn.parent?.removeChild(_ctx.pvpBackpackReturnBtn)
      _ctx.pvpBackpackReturnBtn.destroy({ children: true })
      _ctx.pvpBackpackReturnBtn = null
    }
    PvpContext.onUrgeReceived = null
    PvpContext.onBeforeBattleTransition = null
    PvpContext.onEliminatedPlayersUpdate = null
    PvpContext.onOpponentKnown = null
    PvpContext.onOpponentPreAssigned = null
    PvpContext.onRoundSummaryReceived = null
    _ctx.pvpUrgeCooldownSet.clear()
    if (_ctx.btnRow)       stage.removeChild(_ctx.btnRow)
    if (_ctx.dayDebugCon)  stage.removeChild(_ctx.dayDebugCon)
    if (_ctx.settingsBtn)  stage.removeChild(_ctx.settingsBtn)
    if (_ctx.hintToastCon) stage.removeChild(_ctx.hintToastCon)
    if (_ctx.unlockRevealLayer) stage.removeChild(_ctx.unlockRevealLayer)
    if (_ctx.passiveJumpLayer?.parent) _ctx.passiveJumpLayer.parent.removeChild(_ctx.passiveJumpLayer)
    if (_ctx.classSelectOverlay?.parent) _ctx.classSelectOverlay.parent.removeChild(_ctx.classSelectOverlay)
    _ctx.classSelectOverlay?.destroy({ children: true })
    _ctx.classSelectOverlay = null
    if (_ctx.starterGuideOverlay?.parent) _ctx.starterGuideOverlay.parent.removeChild(_ctx.starterGuideOverlay)
    _ctx.starterGuideOverlay?.destroy({ children: true })
    _ctx.starterGuideOverlay = null
    if (_ctx.specialShopOverlay?.parent) _ctx.specialShopOverlay.parent.removeChild(_ctx.specialShopOverlay)
    _ctx.specialShopOverlay?.destroy({ children: true })
    _ctx.specialShopOverlay = null
    _ctx.playerStatusCon?.destroy({ children: true })
    _ctx.playerStatusCon = null
    _ctx.playerStatusAvatar = null
    _ctx.playerStatusAvatarClickHit = null
    _ctx.playerStatusDailySkillStar = null
    _ctx.playerStatusLvText = null
    _ctx.playerStatusExpBg = null
    _ctx.playerStatusExpBar = null
    _ctx.playerStatusAvatarUrl = ''
    if (_ctx.skillIconBarCon?.parent) _ctx.skillIconBarCon.parent.removeChild(_ctx.skillIconBarCon)
    _ctx.skillIconBarCon?.destroy({ children: true })
    _ctx.skillIconBarCon = null
    _ctx.synthHoverInfoKey = ''

    if (_ctx.onStageTapHidePopup) {
      stage.off('pointerdown', _ctx.onStageTapHidePopup)
      _ctx.onStageTapHidePopup = null
    }
    if (_ctx.onStageShopPointerMove) {
      stage.off('pointermove', _ctx.onStageShopPointerMove)
      _ctx.onStageShopPointerMove = null
    }
    if (_ctx.onStageShopPointerUp) {
      stage.off('pointerup', _ctx.onStageShopPointerUp)
      _ctx.onStageShopPointerUp = null
    }
    if (_ctx.onStageShopPointerUpOutside) {
      stage.off('pointerupoutside', _ctx.onStageShopPointerUpOutside)
      _ctx.onStageShopPointerUpOutside = null
    }

    if (_ctx.bpBtnHandle?.container) {
      const upTick = (_ctx.bpBtnHandle.container as any)._upgradeTick as (() => void) | undefined
      if (upTick) {
        Ticker.shared.remove(upTick)
        ;(_ctx.bpBtnHandle.container as any)._upgradeTick = undefined
      }
    }
    _ctx.offDebugCfg?.()
    _ctx.offDebugCfg = null
    _ctx.offPhaseChange?.()
    _ctx.offPhaseChange = null
    _ctx.pvpReadyLocked = false
    if (_ctx.pendingBattleTransition || PvpContext.isActive() || getBattleSnapshot()) {
      _ctx.savedShopState = captureShopState(_ctx)
      // PVP 模式下不写 localStorage：PVP 内阶段切换靠 _ctx.savedShopState 内存维持即可，
      // 写入主 key 会在 PVP 结束后污染 PVE 存档
      if (!PvpContext.isActive()) saveShopStateToStorage(_ctx.savedShopState)
      _ctx.pendingBattleTransition = false
    } else {
      clearBattleSnapshot()
      clearBattleOutcome()
      _ctx.savedShopState = null
      _ctx.pendingAdvanceToNextDay = false
    }
    clearAutoPackCache()
    if (_ctx.hintToastHideTimer) {
      clearTimeout(_ctx.hintToastHideTimer)
      _ctx.hintToastHideTimer = null
    }

    _ctx.battleStartTransition = null

    _ctx.drag?.destroy()
    _ctx.shopManager   = null; _ctx.shopPanel    = null; _ctx.sellPopup = null
    _ctx.btnRow        = null
    _ctx.goldText      = null; _ctx.miniMapGfx   = null; _ctx.miniMapCon = null
    _ctx.shopAreaBg    = null; _ctx.backpackAreaBg = null; _ctx.battleAreaBg = null
    _ctx.battleZoneTitleText = null
    _ctx.backpackZoneTitleText = null
    _ctx.restartBtn    = null
    _ctx.livesText     = null
    _ctx.trophyText    = null
    _ctx.bpBtnHandle   = null; _ctx.refreshBtnHandle = null; _ctx.sellBtnHandle = null
    _ctx.phaseBtnHandle = null
    _ctx.refreshCostText = null
    _ctx.hintToastCon = null
    _ctx.hintToastBg = null
    _ctx.hintToastText = null
    _ctx.battleGuideHandCon = null
    _ctx.battleGuideHandTick = null
    _ctx.unlockRevealLayer = null
    _ctx.unlockRevealTickFn = null
    _ctx.unlockRevealActive = false
    _ctx.crossSynthesisConfirmOverlay = null
    _ctx.crossSynthesisConfirmTick = null
    _ctx.crossSynthesisConfirmUnlockInput = null
    _ctx.crossSynthesisConfirmAction = null
    _ctx.crossSynthesisConfirmCloseTimer = null
    _ctx.passiveJumpLayer = null
    _ctx.battlePassivePrevStats.clear()
    _ctx.battlePassiveResolvedStats.clear()
    if (_ctx.expandTickFn) { Ticker.shared.remove(_ctx.expandTickFn); _ctx.expandTickFn = null }
    _ctx.dayDebugText    = null
    _ctx.dayPrevBtn      = null
    _ctx.dayNextBtn      = null
    _ctx.dayDebugCon     = null
    _ctx.settingsBtn     = null
    _ctx.currentDay      = 1
    _ctx.unlockedItemIds.clear()
    _ctx.neutralObtainedCountByKind.clear()
    _ctx.neutralRandomCategoryPool = []
    _ctx.neutralDailyRollCountByDay.clear()
    _ctx.guaranteedNewUnlockTriggeredLevels.clear()
    QUALITY_PSEUDO_RANDOM_STATE.clear()
    QUICK_BUY_LEVEL_PSEUDO_RANDOM_STATE.clear()
    _ctx.nextQuickBuyOffer = null
    _ctx.starterClass    = null
    _ctx.starterHeroChoiceOptions = []
    _ctx.starterGranted  = false
    _ctx.starterBattleGuideShown = false
    _ctx.hasBoughtOnce = false
    resetSkill15NextBuyDiscountState(_ctx)
    resetSkill30BundleState(_ctx)
    _ctx.quickBuyNoSynthRefreshStreak = 0
    _ctx.quickBuyNeutralMissStreak = 0
    _ctx.pickedSkills    = []
    _ctx.draftedSkillDays = []
    _ctx.pendingSkillDraft = null
    _ctx.draftedEventDays = []
    _ctx.pendingEventDraft = null
    _ctx.draftedSpecialShopDays = []
    _ctx.specialShopRefreshCount = 0
    _ctx.specialShopOffers = []
    resetEventSelectionCounters(_ctx)
    resetDayEventState(_ctx)
    resetFutureEventState(_ctx)
    _ctx.itemTransformFlashLastAtMs.clear()
    _ctx.skillDetailMode = getDefaultSkillDetailMode()
    _ctx.skill20GrantedDays.clear()
    _ctx.heroDailyCardRerollUsedDays.clear()
    _ctx.heroFirstDiscardRewardedDays.clear()
    _ctx.heroFirstSameItemSynthesisChoiceDays.clear()
    _ctx.heroSmithStoneGrantedDays.clear()
    _ctx.heroAdventurerScrollGrantedDays.clear()
    _ctx.heroCommanderMedalGrantedDays.clear()
    _ctx.heroHeirGoldEquipGrantedDays.clear()
    _ctx.heroTycoonGoldGrantedDays.clear()
    _ctx.pendingHeroPeriodicRewards = []
    _ctx.pendingHeroPeriodicRewardDispatching = false
    _ctx.showingBackpack = false
    _ctx.battleSystem = _ctx.backpackSystem = _ctx.battleView = _ctx.backpackView = _ctx.drag = null
    clearAllInstanceMaps()
    _ctx.battlePassiveResolvedStats.clear()
  },

  update(dt: number) {
    tickBattleStartTransition(dt)
    // PVP 倒计时：实时更新 Day 标签旁的秒数
    if (PvpContext.isActive() && _ctx.dayDebugText) {
      const remain = PvpContext.getCountdownRemainMs()
      const secs = Math.ceil(remain / 1000)
      const next = remain > 0 ? `Day ${_ctx.currentDay} · ${secs}s` : `Day ${_ctx.currentDay}`
      if (_ctx.dayDebugText.text !== next) {
        _ctx.dayDebugText.text = next
        layoutDayDebugControls()
      }
      const color = remain <= 0 ? 0xcccccc : remain < 30000 ? 0xff6b6b : 0xffd86b
      if (_ctx.dayDebugText.style.fill !== color) _ctx.dayDebugText.style.fill = color
    }
    // PVP HP：实时响应 round_summary 更新右上角血量显示
    if (PvpContext.isActive() && _ctx.livesText) {
      const pvpSession = PvpContext.getSession()
      const myHp = pvpSession?.playerHps?.[pvpSession?.myIndex ?? -1] ?? 30
      const initHp = pvpSession?.initialHp ?? 30
      const next = `❤️ ${myHp}/${initHp}`
      if (_ctx.livesText.text !== next) {
        _ctx.livesText.text = next
        _ctx.livesText.style.fill = myHp <= 2 ? 0xff6a6a : 0xffd4d4
        _ctx.livesText.x = CANVAS_W - _ctx.livesText.width - 18
      }
    }
    // sync-a 等待面板：就绪状态变化时刷新
    if (_ctx.pvpWaitingPanel) {
      const cur = PvpContext.getSyncReadyIndices()
      const curKey = cur.slice().sort().join(',')
      if ((_ctx.pvpWaitingPanel as any)._lastReadyKey !== curKey) {
        ;(_ctx.pvpWaitingPanel as any)._lastReadyKey = curKey
          pvpPanel?.refreshPvpWaitingPanel()
      }
    }
  },
}

