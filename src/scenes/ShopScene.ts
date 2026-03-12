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
  getPlayerProgressState,
  getWinTrophyState,
  resetLifeState,
  setPlayerProgressState,
} from '@/core/RunState'
import { GridSystem }        from '@/grid/GridSystem'
import type { ItemSizeNorm, PlacedItem } from '@/grid/GridSystem'
import { GridZone, CELL_SIZE, CELL_HEIGHT } from '@/grid/GridZone'
import { DragController }    from '@/grid/DragController'
import { planAutoPack, type PackItem, type PackPlacement } from '@/grid/AutoPack'
import { planUnifiedSqueeze } from '@/grid/SqueezeLogic'
import { normalizeSize, type ItemDef } from '@/items/ItemDef'
import { ShopManager, getDailyGoldForDay, type ShopSlot, type TierKey } from '@/shop/ShopManager'
import { ShopPanelView }     from '@/ui/ShopPanelView'
import { SellPopup, type ItemInfoCustomDisplay } from '@/ui/SellPopup'
import { getConfig as getDebugCfg, onConfigChange as onDebugCfgChange } from '@/config/debugConfig'
import { getItemIconUrl } from '@/core/assetPath'
import { PhaseManager } from '@/core/PhaseManager'
import { clearBattleSnapshot, getBattleSnapshot, setBattleSnapshot, type BattleSnapshotBundle } from '@/combat/BattleSnapshotStore'
import { PvpContext } from '@/pvp/PvpContext'
// getOpponentFromAlive moved to PvpPanel.ts
import { clearBattleOutcome, consumeBattleOutcome } from '@/combat/BattleOutcomeStore'
// bronzeSkillConfig, silverSkillConfig, goldSkillConfig imports moved to SkillSystem.ts
import { shouldTriggerSkill48ExtraUpgrade } from '@/skills/goldSkillRules'
import {
  Container, Graphics, Text, Sprite,
  Assets, Texture, Rectangle, Ticker,
  type FederatedPointerEvent,
} from 'pixi.js'
import {
  TIER_ORDER,
  nextTierLevel, tierStarLevelIndex,
  parseTierName, getPrimaryArchetype, toSkillArchetype,
  isNeutralArchetypeKey, isNeutralItemDef, getItemDefById,
  canSynthesizePair, canUseLv7MorphSynthesis,
  pickSynthesisResultWithGuarantee,
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
  setInstanceQualityLevel, getInstanceQuality, getInstanceLevel,
  getInstanceTier, getInstanceTierStar,
  levelFromLegacyTierStar,
} from './shop/InstanceRegistry'
import { PvpPanel } from './shop/PvpPanel'
import * as PvpPanelModule from './shop/PvpPanel'
import { SettingsDebugPanel } from './shop/SettingsDebugPanel'
import { SkillDraftPanel } from './shop/SkillDraftPanel'
import { EventDraftPanel } from './shop/EventDraftPanel'
import { SpecialShopPanel } from './shop/SpecialShopPanel'
import {
  NeutralItemPanel,
  getNeutralSpecialKind,
  isNeutralTargetStone,
  getNeutralDailyRollCap,
  neutralRandomCategoryOfItem,
  type NeutralSpecialKind,
  type NeutralChoiceCandidate,
} from './shop/NeutralItemPanel'
import {
  SynthesisPanel,
  getCrossSynthesisMinStartingTier,
  shouldCrossSynthesisPreferOtherArchetype,
  pickCrossIdEvolveCandidates,
} from './shop/SynthesisPanel'
import {
  getStarterClassTag,
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
  clampLevel,
  clampPlayerLevel,
  getPlayerLevelCap,
  getPlayerExpNeedByLevel,
  getQualityLevelRange,
  layoutPlayerStatusPanel,
  playPlayerLevelUpFx,
  playSynthesisExpFlyEffect,
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
  showMoveToBattleGuideHand,
  showBuyGuideHand,
  stopUnlockRevealPlayback
} from './shop/AnimationEffects'
import * as AnimationEffects from './shop/AnimationEffects'
import { CANVAS_W, CANVAS_H, BTN_RADIUS } from '@/config/layoutConstants'
import { getShopUiColor, getClassColor } from '@/config/colorPalette'
import {
  parseAvailableTiers, getSpecialShopSpeedTierText,
  tierValueFromSkillLine, ammoValueFromLineByStar,
  getSpecialShopSimpleDesc, getSpecialShopDetailDesc,
  setZoneItemAmmo, isAttackItemForBattle,
} from './shop/SpecialShopDesc'
import {
  clamp01, easeOutCubic, lerp,
  getSizeCols, getSizeCellDim, makeGridCellKey,
  compareTier, toVisualTier,
  getDayActiveCols, getShopItemScale,
  getBattleItemScale, getBattleZoneX, getBackpackZoneX, getBackpackZoneYByBattle,
  canPlaceInVisibleCols, hasAnyPlaceInVisibleCols,
} from './shop/ShopMathHelpers'
import {
  type ToastReason,
  createHintToast, showHintToast,
} from './shop/ShopToastSystem'
import {
  shouldShowSimpleDescriptions, isSkillDraftRerollEnabled, isEventDraftRerollEnabled,
  getDefaultItemInfoMode, getDefaultSkillDetailMode,
  resetInfoModeSelection, resolveInfoMode,
  isShopInputEnabled,
} from './shop/ShopModeHelpers'
import {
  clearAutoPackCache,
  buildBackpackAutoPackPlan, applyBackpackAutoPackExisting,
  canBackpackAcceptByAutoPack, getOverlapBlockersInBattle,
  buildBackpackPlanForTransferred, applyBackpackPlanWithTransferred,
  getArchetypeSortOrder,
} from './shop/ShopAutoPackManager'
import { buildBattleSnapshot } from './shop/ShopBattleSnapshot'
import { refreshUpgradeHints } from './shop/ShopUpgradeHints'

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
const PHASE_BTN_W   = BTN_RADIUS * 4
const PHASE_BTN_H   = BTN_RADIUS * 2
const AREA_LABEL_LEFT_X = 0
const BACKPACK_LABEL_GLOBAL_Y_GAP = 60
const BATTLE_ZONE_TITLE_TOP_GAP = 28
const BACKPACK_ZONE_TITLE_TOP_GAP = 22

// ---- 背包小地图 ----
const MINI_CELL = 20
const MINI_W    = 6 * MINI_CELL
const SHOP_QUICK_BUY_PRICE = 3
// ---- 场景级状态 ----

// 按钮/UI 引用（动画需要）

// ToastReason → 已移至 ./shop/ShopToastSystem.ts

// 商店拖拽状态

// Day 状态

type CircleBtnHandle = {
  container: Container
  redraw: (active: boolean) => void
  setCenter: (cx: number, cy: number) => void
  setLabel: (label: string) => void
  setSubLabel: (text: string) => void
}

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

type SynthesizeResult = {
  instanceId: string
  targetZone: 'battle' | 'backpack'
  fromTier: TierKey
  fromStar: 1 | 2
  toTier: TierKey
  toStar: 1 | 2
  targetSize: ItemSizeNorm
}

type SynthesisTarget = {
  instanceId: string
  zone: 'battle' | 'backpack'
}

function getSynthHighlightColor(): number { return getShopUiColor('highlight') }
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


function getShopSlotPreviewPrice(slot: ShopSlot, ctx: ShopSceneCtx = _ctx): number {
  return resolveBuyPriceWithSkills(ctx, slot.price).finalPrice
}

function canAffordShopSlot(slot: ShopSlot, ctx: ShopSceneCtx = _ctx): boolean {
  if (!ctx.shopManager || slot.purchased) return false
  return ctx.shopManager.gold >= getShopSlotPreviewPrice(slot, ctx)
}

function upsertPickedSkill(skillId: string, ctx: ShopSceneCtx = _ctx): void {
  SkillSystem.upsertPickedSkill(ctx, skillId, { grantSkill20DailyBronzeItemIfNeeded: () => grantSkill20DailyBronzeItemIfNeeded() })
}

function removePickedSkill(skillId: string, ctx: ShopSceneCtx = _ctx): void {
  SkillSystem.removePickedSkill(ctx, skillId, { getDefaultSkillDetailMode: () => getDefaultSkillDetailMode() })
}

function tryBuyShopSlotWithSkill(slot: ShopSlot, ctx: ShopSceneCtx = _ctx): { ok: boolean; finalPrice: number; discount: number } {
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
  if (consumeSkill15NextBuyDiscountAfterSuccess(ctx)) showHintToast('no_gold_buy', '砍价高手触发：本次-1G', 0x8ff0b0, ctx)
  const skill30Ready = consumeSkill30BundleAfterSuccess(ctx, priced.freeBySkill30)
  if (priced.freeBySkill30) showHintToast('no_gold_buy', '打包购买触发：本次0金币', 0x9be5ff, ctx)
  else if (skill30Ready) showHintToast('no_gold_buy', '打包购买就绪：下次购买0金币', 0x9be5ff, ctx)
  updateNeutralPseudoRandomCounterOnPurchase(slot.item)
  return { ok: true, finalPrice: priced.finalPrice, discount: priced.discount }
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
function pickCrossSynthesisDesiredMinTier(resultTier: TierKey, resultStar: 1 | 2, available?: TierKey[]): TierKey {
  const level = Math.max(1, Math.min(7, tierStarLevelIndex(resultTier, resultStar) + 1)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  return pickQualityByPseudoRandomBag(level, available ?? ['Bronze', 'Silver', 'Gold', 'Diamond'])
}

function pickCrossSynthesisResultWithCycle(
  candidates: ItemDef[],
  resultTier: TierKey,
  resultStar: 1 | 2,
  _minStartingTier: TierKey,
): ItemDef | null {
  if (candidates.length <= 0) return null
  const availableMinTiers = Array.from(new Set(candidates.map((it) => parseTierName(it.starting_tier) ?? 'Bronze')))
  const desiredMinTier = pickCrossSynthesisDesiredMinTier(resultTier, resultStar, availableMinTiers)
  let targetMinTier = desiredMinTier
  let pool = candidates.filter((it) => (parseTierName(it.starting_tier) ?? 'Bronze') === targetMinTier)
  if (pool.length <= 0) {
    const startIdx = Math.max(0, TIER_ORDER.indexOf(targetMinTier))
    for (let i = startIdx + 1; i < TIER_ORDER.length; i++) {
      const higher = TIER_ORDER[i]!
      const p = candidates.filter((it) => (parseTierName(it.starting_tier) ?? 'Bronze') === higher)
      if (p.length > 0) {
        targetMinTier = higher
        pool = p
        break
      }
    }
  }
  if (pool.length <= 0) pool = candidates
  return pickSynthesisResultWithGuarantee(pool, resultTier, resultStar)
}

function shouldGuaranteeNewUnlock(resultTier: TierKey, resultStar: 1 | 2): boolean {
  void resultTier
  void resultStar
  return false
}

function applyInstanceTierVisuals(ctx: ShopSceneCtx = _ctx): void {
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

function collectOwnedTierByDef(): Map<string, TierKey> {
  const result = new Map<string, TierKey>()
  for (const [id, defId] of instanceToDefId) {
    const tier = instanceToTier.get(id) ?? 'Bronze'
    const old = result.get(defId)
    if (!old || compareTier(tier, old) > 0) result.set(defId, tier)
  }
  return result
}

function syncShopOwnedTierRules(ctx: ShopSceneCtx = _ctx): void {
  if (!ctx.shopManager) return
  ctx.shopManager.setOwnedTiers(collectOwnedTierByDef())
}

function syncUnlockPoolToManager(ctx: ShopSceneCtx = _ctx): void {
  if (!ctx.shopManager) return
  ctx.shopManager.setUnlockedItemIds(Array.from(ctx.unlockedItemIds))
}

function unlockItemToPool(defId: string, ctx: ShopSceneCtx = _ctx): boolean {
  const item = getItemDefById(defId)
  if (!item) return false
  if (ctx.unlockedItemIds.has(defId)) return false
  ctx.unlockedItemIds.add(defId)
  ctx.shopManager?.unlockItem(defId)
  return true
}

function showFirstPurchaseRuleHint(ctx: ShopSceneCtx = _ctx): void {
  const tag = getStarterClassTag(ctx)
  const label = tag || '本职业'
  showHintToast('no_gold_buy', `首次购买需为${label}物品`, 0xffd48f, ctx)
}

function markShopPurchaseDone(ctx: ShopSceneCtx = _ctx): void {
  ctx.hasBoughtOnce = true
}


function getPlacedItemCenterOnStage(instanceId: string, zone: 'battle' | 'backpack', ctx: ShopSceneCtx = _ctx): { x: number; y: number } | null {
  if (!ctx.battleSystem || !ctx.backpackSystem || !ctx.battleView || !ctx.backpackView) return null
  const system = zone === 'battle' ? ctx.battleSystem : ctx.backpackSystem
  const view = zone === 'battle' ? ctx.battleView : ctx.backpackView
  const item = system.getItem(instanceId)
  if (!item) return null
  const w = item.size === '1x1' ? CELL_SIZE : item.size === '2x1' ? CELL_SIZE * 2 : CELL_SIZE * 3
  const h = CELL_HEIGHT
  const centerGlobal = view.toGlobal({
    x: item.col * CELL_SIZE + w / 2,
    y: item.row * CELL_HEIGHT + h / 2,
  })
  return getApp().stage.toLocal(centerGlobal)
}


/**
 * 飞行动画：从头像位置飞一个光球到目标格
 * @param defId 物品定义ID（保留参数以兼容调用方）
 * @param targetSlotCol 目标格列
 * @param targetSlotRow 目标格行
 * @param onLand 落地回调（执行真正的视觉addItem）
 */
function flyRewardToGridSlot(
  defId: string,
  targetView: GridZone,
  targetSlotCol: number,
  targetSlotRow: number,
  onLand: () => void,
  ctx: ShopSceneCtx = _ctx,
): void {
  if (!ctx.playerStatusAvatar) { onLand(); return }
  const stage = getApp().stage

  // 起点：头像中心（舞台坐标）
  const avatarBounds = ctx.playerStatusAvatar.getBounds()
  const startPos = stage.toLocal({ x: avatarBounds.x + avatarBounds.width / 2, y: avatarBounds.y + avatarBounds.height / 2 })

  // 终点：目标格中心（舞台坐标）
  const targetGlobal = targetView.toGlobal({
    x: targetSlotCol * CELL_SIZE + CELL_SIZE / 2,
    y: targetSlotRow * CELL_HEIGHT + CELL_HEIGHT / 2,
  })
  const endPos = stage.toLocal(targetGlobal)

  // 与背包区物品图标观感对齐（原先过大，约缩小一半）
  const iconSize = Math.round(CELL_SIZE * 0.36)
  const durationMs = getDebugCfg('rewardFlyDurationMs')

  const makeProxyAndAnimate = () => {
    void defId
    let proxy: Graphics
    const g = new Graphics()
    g.circle(0, 0, iconSize / 2)
    g.fill({ color: 0xffd700, alpha: 0.95 })
    g.circle(0, 0, Math.max(4, iconSize / 2 - 4))
    g.fill({ color: 0xfff8b0, alpha: 0.9 })
    g.eventMode = 'none'
    proxy = g
    proxy.x = startPos.x
    proxy.y = startPos.y
    stage.addChild(proxy)

    const startAt = Date.now()
    const tick = () => {
      const t = Math.min(1, (Date.now() - startAt) / durationMs)
      const ease = 1 - Math.pow(1 - t, 3)  // ease-out cubic
      proxy.x = startPos.x + (endPos.x - startPos.x) * ease
      proxy.y = startPos.y + (endPos.y - startPos.y) * ease - Math.sin(Math.PI * t) * 60
      proxy.alpha = t < 0.85 ? 1 : (1 - t) / 0.15  // 尾段淡出
      const sc = 1 + Math.sin(Math.PI * t) * 0.08
      proxy.scale.set(sc)
      if (t >= 1) {
        Ticker.shared.remove(tick)
        proxy.parent?.removeChild(proxy)
        proxy.destroy()
        onLand()
      }
    }
    Ticker.shared.add(tick)
  }
  makeProxyAndAnimate()
}

function flyRewardToBackpack(
  defId: string,
  targetSlotCol: number,
  targetSlotRow: number,
  onLand: () => void,
  ctx: ShopSceneCtx = _ctx,
): void {
  if (!ctx.backpackView) { onLand(); return }
  flyRewardToGridSlot(defId, ctx.backpackView, targetSlotCol, targetSlotRow, onLand)
}

/** 检查背包是否有空位可放1x1物品并执行待领取奖励发放 */
function checkAndPopPendingRewards(ctx: ShopSceneCtx = _ctx): void {
  if (ctx.pendingLevelRewards.length === 0) {
    checkAndPopPendingHeroPeriodicRewards(ctx)
    return
  }
  if (!ctx.backpackSystem || !ctx.backpackView) return

  while (ctx.pendingLevelRewards.length > 0) {
    const slot = findFirstBackpackPlace('1x1')
    if (!slot) break  // 背包满，等待空格
    lockBackpackRewardCell(slot.col, slot.row, ctx)

    const defId = ctx.pendingLevelRewards[0]!
    const def = getItemDefById(defId)
    if (!def) { ctx.pendingLevelRewards.shift(); continue }

    // 逻辑先占位（alpha=0，防止拖拽占用）
    const id = nextId()
    ctx.backpackSystem.place(slot.col, slot.row, '1x1', defId, id)
    instanceToDefId.set(id, defId)
    setInstanceQualityLevel(id, defId, 'Bronze', 1)
    instanceToPermanentDamageBonus.set(id, 0)
    const kind = getNeutralSpecialKind(def)
    if (kind) recordLevelRewardObtained(kind)
    recordNeutralItemObtained(defId)
    unlockItemToPool(defId, ctx)
    ctx.pendingLevelRewards.shift()

    // 飞行动画结束后再显示物品（addItem触发acquireFx），然后继续派发下一个待领取
    const capturedId = id
    const capturedDef = def
    const capturedSlot = { ...slot }
    flyRewardToBackpack(defId, slot.col, slot.row, () => {
      if (!ctx.backpackView || !ctx.backpackSystem) {
        unlockBackpackRewardCell(capturedSlot.col, capturedSlot.row, ctx)
        return
      }
      // 检查物品还在（没被移除）
      if (!ctx.backpackSystem.getItem(capturedId)) {
        unlockBackpackRewardCell(capturedSlot.col, capturedSlot.row, ctx)
        checkAndPopPendingRewards(ctx)
        return
      }
      void ctx.backpackView.addItem(capturedId, capturedDef.id, '1x1', capturedSlot.col, capturedSlot.row, 'Bronze#1').then(() => {
        ctx.backpackView!.setItemTier(capturedId, 'Bronze#1')
        ctx.drag?.refreshZone(ctx.backpackView!)
        // 动画落地后检查是否还有更多待领取
        checkAndPopPendingRewards(ctx)
      }).finally(() => {
        unlockBackpackRewardCell(capturedSlot.col, capturedSlot.row, ctx)
      })
    }, ctx)

    saveShopStateToStorage(captureShopState(ctx))
    break  // 每次只发一个，等动画结束后再检查下一个
  }

  if (ctx.pendingLevelRewards.length === 0) {
    checkAndPopPendingHeroPeriodicRewards(ctx)
  }
}

/** 处理升级奖励：抽取物品加入待领取队列 */
function handleLevelReward(level: number, ctx: ShopSceneCtx = _ctx): void {
  const rewards = rollLevelRewardDefIds(level)
  if (rewards.length <= 0) {
    if (ctx.shopManager) {
      const goldFallback = 3
      ctx.shopManager.gold += goldFallback
      showHintToast('no_gold_buy', `升级奖励：中立物品已满，获得${goldFallback}G`, 0xffd700, ctx)
    }
    saveShopStateToStorage(captureShopState(ctx))
    return
  }
  ctx.pendingLevelRewards.push(...rewards)
  checkAndPopPendingRewards(ctx)
}

function grantSynthesisExp(amount = 1, from?: { instanceId: string; zone: 'battle' | 'backpack' }, ctx: ShopSceneCtx = _ctx): void {
  const add = Math.max(0, Math.round(amount))
  if (add <= 0) return
  const cap = getPlayerLevelCap()
  const current = getPlayerProgressState()
  const levelBeforeUpgrade = clampPlayerLevel(current.level)
  let level = clampPlayerLevel(current.level)
  let exp = Math.max(0, Math.round(current.exp)) + add
  let leveled = false
  while (level < cap) {
    const need = getPlayerExpNeedByLevel(level)
    if (exp < need) break
    exp -= need
    level += 1
    leveled = true
  }
  if (level >= cap) exp = 0
  setPlayerProgressState(level, exp)
  playSynthesisExpFlyEffect(ctx, from ? getPlacedItemCenterOnStage(from.instanceId, from.zone, ctx) : null)
  if (leveled) {
    showHintToast('no_gold_buy', `升级到 Lv${level}`, 0x8ff0b0, ctx)
    playPlayerLevelUpFx(ctx)
    handleLevelReward(levelBeforeUpgrade, ctx)
  }
}









function getSpecialShopShownDesc(item: ItemDef, tier: TierKey, star: 1 | 2, detailed: boolean): string {
  if (!shouldShowSimpleDescriptions() || detailed) return getSpecialShopDetailDesc(item, tier, star)
  return getSpecialShopSimpleDesc(item, tier, star)
}







function applyPostBattlePermanentGrowth(snapshot: BattleSnapshotBundle): boolean {
  const allItems = getAllItems()
  const byId = new Map(allItems.map((it) => [it.id, it] as const))
  const playerEntities = snapshot.entities
  const attackerCount = playerEntities
    .map((e) => byId.get(e.defId))
    .filter((v): v is ReturnType<typeof getAllItems>[number] => !!v)
    .filter((it) => isAttackItemForBattle(it))
    .length

  if (attackerCount !== 1) return false

  let changed = false
  for (const entity of playerEntities) {
    const item = byId.get(entity.defId)
    if (!item) continue
    const line = (item.skills ?? []).map((s) => s.cn ?? '').find((s) => /唯一的攻击物品.*战斗结束后永久\+\d+(?:\/\d+)*伤害/.test(s))
    if (!line) continue
    const bonus = Math.round(tierValueFromSkillLine(item, entity.tier, line))
    if (bonus <= 0) continue
    const prev = Math.max(0, Math.round(instanceToPermanentDamageBonus.get(entity.instanceId) ?? 0))
    instanceToPermanentDamageBonus.set(entity.instanceId, prev + bonus)
    changed = true
    console.log(`[ShopScene] 战后永久成长 ${item.name_cn} +${bonus}伤害（累计 ${prev + bonus}）`)
  }
  return changed
}

function applyPostBattleAutoCopy(snapshot: BattleSnapshotBundle, ctx: ShopSceneCtx = _ctx): boolean {
  if (!ctx.backpackSystem || !ctx.backpackView) return false
  const allItems = getAllItems()
  const byId = new Map(allItems.map((it) => [it.id, it] as const))
  let changed = false

  for (const entity of snapshot.entities) {
    const item = byId.get(entity.defId)
    if (!item) continue
    const hasAutoCopy = (item.skills ?? []).some((s) => /每次战斗后自动复制/.test(s.cn ?? ''))
    if (!hasAutoCopy) continue
    const size = normalizeSize(item.size)
    const place = findFirstBackpackPlace(size)
    if (!place) continue

    const newId = nextId()
    ctx.backpackSystem.place(place.col, place.row, size, item.id, newId)
    ctx.backpackView.addItem(newId, item.id, size, place.col, place.row, toVisualTier(entity.tier, 1)).then(() => {
      ctx.backpackView!.setItemTier(newId, toVisualTier(entity.tier, 1))
      ctx.drag?.refreshZone(ctx.backpackView!)
    })
    instanceToDefId.set(newId, item.id)
    setInstanceQualityLevel(newId, item.id, parseTierName(item.starting_tier) ?? 'Bronze', levelFromLegacyTierStar(entity.tier, 1))
    instanceToPermanentDamageBonus.set(newId, 0)
    recordNeutralItemObtained(item.id)
    changed = true
    console.log(`[ShopScene] 战后复制 ${item.name_cn} -> 背包`)
  }

  return changed
}

function applyPostBattleEffects(snapshot: BattleSnapshotBundle | null): void {
  if (!snapshot) return
  const changedGrowth = applyPostBattlePermanentGrowth(snapshot)
  const changedCopy = applyPostBattleAutoCopy(snapshot)
  if (changedGrowth || changedCopy) {
    syncShopOwnedTierRules()
    refreshShopUI()
  }
}



function isPointInItemBounds(view: GridZone, item: PlacedItem, gx: number, gy: number): boolean {
  const w = item.size === '1x1' ? CELL_SIZE : item.size === '2x1' ? CELL_SIZE * 2 : CELL_SIZE * 3
  const h = CELL_HEIGHT
  const left = item.col * CELL_SIZE
  const top = item.row * CELL_HEIGHT
  const a = view.toGlobal({ x: left, y: top })
  const b = view.toGlobal({ x: left + w, y: top + h })
  const x0 = Math.min(a.x, b.x)
  const x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const y1 = Math.max(a.y, b.y)
  return gx >= x0 && gx <= x1 && gy >= y0 && gy <= y1
}

function collectSynthesisGuideIds(
  system: GridSystem | null,
  defId: string,
  tier: TierKey,
  star: 1 | 2,
  excludeInstanceId?: string,
): { sameIds: string[]; crossIds: string[] } {
  if (!system) return { sameIds: [], crossIds: [] }
  const sameIds: string[] = []
  const crossIds: string[] = []
  for (const it of system.getAllItems()) {
    if (excludeInstanceId && it.instanceId === excludeInstanceId) continue
    const itTier = instanceToTier.get(it.instanceId) ?? 'Bronze'
    const itStar = getInstanceTierStar(it.instanceId)
    if (!canSynthesizePair(defId, it.defId, tier, star, itTier, itStar)) continue
    if (it.defId === defId) sameIds.push(it.instanceId)
    else crossIds.push(it.instanceId)
  }
  return { sameIds, crossIds }
}

function refreshBackpackSynthesisGuideArrows(
  defId: string | null,
  tier: TierKey | null,
  star: 1 | 2,
  excludeInstanceId?: string,
  ctx: ShopSceneCtx = _ctx,
): void {
  if (!ctx.backpackView || !ctx.battleView) return
  const canLv7Morph = !!defId && !!tier && canUseLv7MorphSynthesis(defId, defId, tier, star, tier, star)
  if (!defId || !tier || (!nextTierLevel(tier, star) && !canLv7Morph)) {
    ctx.backpackView.setDragGuideArrows([])
    ctx.battleView.setDragGuideArrows([])
    return
  }
  const backpackGuide = collectSynthesisGuideIds(ctx.backpackSystem, defId, tier, star, excludeInstanceId)
  const battleGuide = isBattleZoneNoSynthesisEnabled()
    ? { sameIds: [], crossIds: [] }
    : collectSynthesisGuideIds(ctx.battleSystem, defId, tier, star, excludeInstanceId)
  if (canLv7Morph) {
    ctx.backpackView.setDragGuideArrows([], [...backpackGuide.sameIds, ...backpackGuide.crossIds], 'convert')
    ctx.battleView.setDragGuideArrows([], [...battleGuide.sameIds, ...battleGuide.crossIds], 'convert')
    return
  }
  ctx.backpackView.setDragGuideArrows(backpackGuide.sameIds, backpackGuide.crossIds)
  ctx.battleView.setDragGuideArrows(battleGuide.sameIds, battleGuide.crossIds)
}

function clearBackpackSynthesisGuideArrows(ctx: ShopSceneCtx = _ctx): void {
  ctx.backpackView?.setDragGuideArrows([])
  ctx.battleView?.setDragGuideArrows([])
}

function findSynthesisTargetAtPointer(
  defId: string,
  tier: TierKey,
  star: 1 | 2,
  gx: number,
  gy: number,
  _dragSize?: ItemSizeNorm,
  ctx: ShopSceneCtx = _ctx,
): SynthesisTarget | null {
  if (!isBattleZoneNoSynthesisEnabled() && ctx.battleView && ctx.battleSystem) {
    for (const it of ctx.battleSystem.getAllItems()) {
      const itTier = instanceToTier.get(it.instanceId) ?? 'Bronze'
      const itStar = getInstanceTierStar(it.instanceId)
      if (!canSynthesizePair(defId, it.defId, tier, star, itTier, itStar)) continue
      if (isPointInItemBounds(ctx.battleView, it, gx, gy)) {
        return { instanceId: it.instanceId, zone: 'battle' }
      }
    }
  }

  if (ctx.backpackView && ctx.backpackView.visible && ctx.backpackSystem) {
    for (const it of ctx.backpackSystem.getAllItems()) {
      if (isBackpackDropLocked(it.col, it.row, it.size)) continue
      const itTier = instanceToTier.get(it.instanceId) ?? 'Bronze'
      const itStar = getInstanceTierStar(it.instanceId)
      if (!canSynthesizePair(defId, it.defId, tier, star, itTier, itStar)) continue
      if (isPointInItemBounds(ctx.backpackView, it, gx, gy)) {
        return { instanceId: it.instanceId, zone: 'backpack' }
      }
    }
  }

  return null
}

function findSynthesisTargetByFootprint(
  defId: string,
  tier: TierKey,
  star: 1 | 2,
  gx: number,
  gy: number,
  dragSize?: ItemSizeNorm,
  ctx: ShopSceneCtx = _ctx,
): SynthesisTarget | null {
  if (!dragSize) return null
  const { w, h } = getSizeCellDim(dragSize)
  const tryZone = (
    view: GridZone | null,
    system: GridSystem | null,
    zone: 'battle' | 'backpack',
  ): SynthesisTarget | null => {
    if (!view || !system || (zone === 'backpack' && !view.visible)) return null
    const cell = view.pixelToCellForItem(gx, gy, dragSize, 0)
    if (!cell) return null
    const l = cell.col
    const r = cell.col + w
    const t = cell.row
    const b = cell.row + h
    for (const it of system.getAllItems()) {
      if (zone === 'backpack' && isBackpackDropLocked(it.col, it.row, it.size)) continue
      const itTier = instanceToTier.get(it.instanceId) ?? 'Bronze'
      const itStar = getInstanceTierStar(it.instanceId)
      if (!canSynthesizePair(defId, it.defId, tier, star, itTier, itStar)) continue
      const d = getSizeCellDim(it.size)
      const il = it.col
      const ir = it.col + d.w
      const itop = it.row
      const ib = it.row + d.h
      if (l < ir && r > il && t < ib && b > itop) {
        return { instanceId: it.instanceId, zone }
      }
    }
    return null
  }

  return (
    (isBattleZoneNoSynthesisEnabled() ? null : tryZone(ctx.battleView, ctx.battleSystem, 'battle'))
    ?? tryZone(ctx.backpackView, ctx.backpackSystem, 'backpack')
  )
}

function findSynthesisTargetWithDragProbe(
  defId: string,
  tier: TierKey,
  star: 1 | 2,
  gx: number,
  gy: number,
  dragSize?: ItemSizeNorm,
): SynthesisTarget | null {
  const direct = findSynthesisTargetAtPointer(defId, tier, star, gx, gy, dragSize)
  if (direct) return direct
  const byFootprint = findSynthesisTargetByFootprint(defId, tier, star, gx, gy, dragSize)
  if (byFootprint) return byFootprint
  const probeY = gy + (dragSize ? getDebugCfg('dragYOffset') : 0)
  if (probeY === gy) return null
  return (
    findSynthesisTargetAtPointer(defId, tier, star, gx, probeY, dragSize)
    ?? findSynthesisTargetByFootprint(defId, tier, star, gx, probeY, dragSize)
  )
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
  if (!ctx.battleSystem || !ctx.battleView) return null
  const battleSystemRef = ctx.battleSystem
  const battleViewRef = ctx.battleView

  const matchAtPointer = (probeY: number): SynthesisTarget | null => {
    for (const it of battleSystemRef.getAllItems()) {
      const itTier = instanceToTier.get(it.instanceId) ?? 'Bronze'
      const itStar = getInstanceTierStar(it.instanceId)
      if (!canSynthesizePair(defId, it.defId, tier, star, itTier, itStar)) continue
      if (isPointInItemBounds(battleViewRef, it, gx, probeY)) {
        return { instanceId: it.instanceId, zone: 'battle' }
      }
    }
    return null
  }

  const matchByFootprint = (probeY: number): SynthesisTarget | null => {
    if (!dragSize) return null
    const { w, h } = getSizeCellDim(dragSize)
    const cell = battleViewRef.pixelToCellForItem(gx, probeY, dragSize, 0)
    if (!cell) return null
    const l = cell.col
    const r = cell.col + w
    const t = cell.row
    const b = cell.row + h
    for (const it of battleSystemRef.getAllItems()) {
      const itTier = instanceToTier.get(it.instanceId) ?? 'Bronze'
      const itStar = getInstanceTierStar(it.instanceId)
      if (!canSynthesizePair(defId, it.defId, tier, star, itTier, itStar)) continue
      const d = getSizeCellDim(it.size)
      const il = it.col
      const ir = it.col + d.w
      const itop = it.row
      const ib = it.row + d.h
      if (l < ir && r > il && t < ib && b > itop) {
        return { instanceId: it.instanceId, zone: 'battle' }
      }
    }
    return null
  }

  const direct = matchAtPointer(gy) ?? matchByFootprint(gy)
  if (direct) return direct
  const probeY = gy + (dragSize ? getDebugCfg('dragYOffset') : 0)
  if (probeY === gy) return null
  return matchAtPointer(probeY) ?? matchByFootprint(probeY)
}

function getSynthesisTargetItem(target: SynthesisTarget, ctx: ShopSceneCtx = _ctx): PlacedItem | null {
  if (!ctx.battleSystem || !ctx.backpackSystem) return null
  const system = target.zone === 'battle' ? ctx.battleSystem : ctx.backpackSystem
  return system.getItem(target.instanceId) ?? null
}

function highlightSynthesisTarget(target: SynthesisTarget | null, ctx: ShopSceneCtx = _ctx): void {
  if (!target || !ctx.battleSystem || !ctx.backpackSystem || !ctx.battleView || !ctx.backpackView) {
    ctx.battleView?.clearHighlight()
    ctx.backpackView?.clearHighlight()
    return
  }

  const inBattle = target.zone === 'battle'
  const system = inBattle ? ctx.battleSystem : ctx.backpackSystem
  const view = inBattle ? ctx.battleView : ctx.backpackView
  const item = system.getItem(target.instanceId)
  if (!item) {
    ctx.battleView?.clearHighlight()
    ctx.backpackView?.clearHighlight()
    return
  }

  view.highlightCells(item.col, item.row, item.size, true, getSynthHighlightColor())
  if (inBattle) ctx.backpackView.clearHighlight()
  else ctx.battleView.clearHighlight()
}

function synthesizeTarget(
  defId: string,
  tier: TierKey,
  star: 1 | 2,
  targetInstanceId: string,
  zone: 'battle' | 'backpack',
  ctx: ShopSceneCtx = _ctx,
): SynthesizeResult | null {
  if (!ctx.battleSystem || !ctx.backpackSystem || !ctx.battleView || !ctx.backpackView) return null
  const baseUpgrade = nextTierLevel(tier, star)
  if (!baseUpgrade) return null
  let upgradeTo = baseUpgrade
  const eventExtra = ctx.dayEventState.extraUpgradeRemaining > 0
  if (eventExtra) {
    const extra = nextTierLevel(upgradeTo.tier, upgradeTo.star)
    if (extra) upgradeTo = extra
  }
  const skillExtra = nextTierLevel(upgradeTo.tier, upgradeTo.star)
  const wantsSkillExtra = shouldTriggerSkill48ExtraUpgrade(hasPickedSkill(ctx, 'skill48'), !!skillExtra, Math.random())
  if (wantsSkillExtra && skillExtra) upgradeTo = skillExtra

  const targetItem = zone === 'battle'
    ? ctx.battleSystem.getItem(targetInstanceId)
    : ctx.backpackSystem.getItem(targetInstanceId)
  if (!targetItem) return null
  const targetTier = instanceToTier.get(targetInstanceId) ?? 'Bronze'
  const targetStar = getInstanceTierStar(targetInstanceId)
  if (!canSynthesizePair(defId, targetItem.defId, tier, star, targetTier, targetStar)) return null

  const sourceDef = getItemDefById(defId)
  if (!sourceDef) return null
  const targetDef = getItemDefById(targetItem.defId)
  if (!targetDef) return null

  const isSameIdSynthesis = defId === targetItem.defId
  const forceSynthesisActive = !!(ctx.dayEventState.forceSynthesisArchetype && ctx.dayEventState.forceSynthesisRemaining > 0)
  const minStartingTier = getCrossSynthesisMinStartingTier(sourceDef, targetDef)
  const preferOtherArchetype = shouldCrossSynthesisPreferOtherArchetype(sourceDef, targetDef) && !forceSynthesisActive
  let guaranteeNewUnlock = shouldGuaranteeNewUnlock(upgradeTo.tier, upgradeTo.star)
  let resultLevel = tierStarLevelIndex(upgradeTo.tier, upgradeTo.star) + 1
  const buildCandidates = (targetTier: TierKey) => {
    const all = pickCrossIdEvolveCandidates(sourceDef, targetItem.size, targetTier, minStartingTier, preferOtherArchetype)
    if (forceSynthesisActive) {
      const forced = all.filter((it) => toSkillArchetype(getPrimaryArchetype(it.tags)) === ctx.dayEventState.forceSynthesisArchetype)
      if (forced.length > 0) return forced
      if (all.length > 0) return all
      return [sourceDef]
    }
    if (ctx.dayEventState.allSynthesisRandom) {
      if (all.length > 0) return all
      return [sourceDef]
    }
    if (isSameIdSynthesis) return [sourceDef]
    return all
  }
  let evolveCandidates = buildCandidates(upgradeTo.tier)
  let evolvedDef = pickCrossSynthesisResultWithCycle(evolveCandidates, upgradeTo.tier, upgradeTo.star, minStartingTier)
  if (!evolvedDef && (upgradeTo.tier !== baseUpgrade.tier || upgradeTo.star !== baseUpgrade.star)) {
    upgradeTo = baseUpgrade
    guaranteeNewUnlock = shouldGuaranteeNewUnlock(upgradeTo.tier, upgradeTo.star)
    resultLevel = tierStarLevelIndex(upgradeTo.tier, upgradeTo.star) + 1
    evolveCandidates = buildCandidates(upgradeTo.tier)
    evolvedDef = pickCrossSynthesisResultWithCycle(evolveCandidates, upgradeTo.tier, upgradeTo.star, minStartingTier)
  }
  if (!evolvedDef) return null

  const system = zone === 'battle' ? ctx.battleSystem : ctx.backpackSystem
  const view = zone === 'battle' ? ctx.battleView : ctx.backpackView
  system.remove(targetInstanceId)
  if (!system.place(targetItem.col, targetItem.row, targetItem.size, evolvedDef.id, targetInstanceId)) {
    system.place(targetItem.col, targetItem.row, targetItem.size, targetItem.defId, targetInstanceId)
    return null
  }
  view.removeItem(targetInstanceId)
  void view.addItem(
    targetInstanceId,
    evolvedDef.id,
    targetItem.size,
    targetItem.col,
    targetItem.row,
    toVisualTier(upgradeTo.tier, upgradeTo.star),
  ).then(() => {
    view.setItemTier(targetInstanceId, toVisualTier(upgradeTo.tier, upgradeTo.star))
    ctx.drag?.refreshZone(view)
  })

  instanceToDefId.set(targetInstanceId, evolvedDef.id)
  setInstanceQualityLevel(targetInstanceId, evolvedDef.id, parseTierName(evolvedDef.starting_tier) ?? 'Bronze', resultLevel)
  if (eventExtra && ctx.dayEventState.extraUpgradeRemaining > 0) {
    ctx.dayEventState.extraUpgradeRemaining = Math.max(0, ctx.dayEventState.extraUpgradeRemaining - 1)
  }
  if (forceSynthesisActive && ctx.dayEventState.forceSynthesisRemaining > 0) {
    ctx.dayEventState.forceSynthesisRemaining = Math.max(0, ctx.dayEventState.forceSynthesisRemaining - 1)
    if (ctx.dayEventState.forceSynthesisRemaining <= 0) ctx.dayEventState.forceSynthesisArchetype = null
  }
  unlockItemToPool(evolvedDef.id)
  if (guaranteeNewUnlock && (resultLevel === 3 || resultLevel === 5 || resultLevel === 7)) {
    ctx.guaranteedNewUnlockTriggeredLevels.add(resultLevel)
  }
  applyInstanceTierVisuals()
  syncShopOwnedTierRules()
  refreshUpgradeHints(_ctx)
  grantSynthesisExp(1, { instanceId: targetInstanceId, zone })
  // 合成释放了背包空间，尝试发放待领取升级奖励
  checkAndPopPendingRewards()
  return {
    instanceId: targetInstanceId,
    targetZone: zone,
    fromTier: tier,
    fromStar: star,
    toTier: upgradeTo.tier,
    toStar: upgradeTo.star,
    targetSize: targetItem.size,
  }
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


function findFirstBackpackPlace(size: ItemSizeNorm, ctx: ShopSceneCtx = _ctx): { col: number; row: number } | null {
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

function findFirstBattlePlace(size: ItemSizeNorm, ctx: ShopSceneCtx = _ctx): { col: number; row: number } | null {
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




type OwnedPlacedItem = { item: PlacedItem; zone: 'battle' | 'backpack' }

function getAllOwnedPlacedItems(ctx: ShopSceneCtx = _ctx): OwnedPlacedItem[] {
  const out: OwnedPlacedItem[] = []
  if (ctx.battleSystem) {
    for (const it of ctx.battleSystem.getAllItems()) out.push({ item: it, zone: 'battle' })
  }
  if (ctx.backpackSystem) {
    for (const it of ctx.backpackSystem.getAllItems()) out.push({ item: it, zone: 'backpack' })
  }
  return out
}

function pickRandomElements<T>(list: T[], count: number): T[] {
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

function removePlacedItemById(instanceId: string, zone: 'battle' | 'backpack', ctx: ShopSceneCtx = _ctx): void {
  const system = zone === 'battle' ? ctx.battleSystem : ctx.backpackSystem
  const view = zone === 'battle' ? ctx.battleView : ctx.backpackView
  if (!system || !view) return
  system.remove(instanceId)
  view.removeItem(instanceId)
  removeInstanceMeta(instanceId)
}

function placeItemToInventoryOrBattle(def: ItemDef, tier: TierKey, star: 1 | 2, ctx: ShopSceneCtx = _ctx): boolean {
  if (!ctx.battleSystem || !ctx.battleView || !ctx.backpackSystem || !ctx.backpackView) return false
  const size = normalizeSize(def.size)
  const battleSlot = findFirstBattlePlace(size)
  const backpackSlot = battleSlot ? null : findFirstBackpackPlace(size)
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
  recordNeutralItemObtained(def.id)
  unlockItemToPool(def.id)
  return true
}

function upgradePlacedItem(instanceId: string, zone: 'battle' | 'backpack', withFx = false, ctx: ShopSceneCtx = _ctx): boolean {
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

function convertAndUpgradePlacedItem(instanceId: string, zone: 'battle' | 'backpack', withFx = false, ctx: ShopSceneCtx = _ctx): boolean {
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
  unlockItemToPool(picked.id)
  if (withFx) playTransformOrUpgradeFlashEffect(ctx, instanceId, zone)
  return true
}

function canUpgradePlacedItem(instanceId: string, zone: 'battle' | 'backpack', ctx: ShopSceneCtx = _ctx): boolean {
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

function canConvertAndUpgradePlacedItem(instanceId: string, zone: 'battle' | 'backpack', ctx: ShopSceneCtx = _ctx): boolean {
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

function collectUpgradeableOwnedPlacedItems(zone?: 'battle' | 'backpack'): OwnedPlacedItem[] {
  return getAllOwnedPlacedItems().filter((it) => {
    if (zone && it.zone !== zone) return false
    return canUpgradePlacedItem(it.item.instanceId, it.zone)
  })
}

function schedulePendingGold(day: number, amount: number, ctx: ShopSceneCtx = _ctx): void {
  const d = Math.max(1, Math.round(day))
  const a = Math.max(0, Math.round(amount))
  if (d <= 0 || a <= 0) return
  ctx.pendingGoldByDay.set(d, (ctx.pendingGoldByDay.get(d) ?? 0) + a)
}

function schedulePendingBattleUpgrade(day: number, count: number, ctx: ShopSceneCtx = _ctx): void {
  const d = Math.max(1, Math.round(day))
  const c = Math.max(0, Math.round(count))
  if (d <= 0 || c <= 0) return
  ctx.pendingBattleUpgradeByDay.set(d, (ctx.pendingBattleUpgradeByDay.get(d) ?? 0) + c)
}

function convertPlacedItemKeepLevel(instanceId: string, zone: 'battle' | 'backpack', withFx = false, ctx: ShopSceneCtx = _ctx): boolean {
  const system = zone === 'battle' ? ctx.battleSystem : ctx.backpackSystem
  const view = zone === 'battle' ? ctx.battleView : ctx.backpackView
  if (!system || !view) return false
  const placed = system.getItem(instanceId)
  if (!placed) return false
  const level = getInstanceLevel(instanceId)
  const legacy = levelToTierStar(level)
  const tier = legacy?.tier ?? 'Bronze'
  const star = legacy?.star ?? 1
  const candidates = collectPoolCandidatesByLevel(level)
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
  unlockItemToPool(picked.id)
  if (withFx) playTransformOrUpgradeFlashEffect(ctx, instanceId, zone)
  return true
}

function upgradeLowestLevelItemsOnce(): number {
  const all = collectUpgradeableOwnedPlacedItems()
  if (all.length <= 0) return 0
  let minLevel = Number.POSITIVE_INFINITY
  for (const one of all) {
    minLevel = Math.min(minLevel, getInstanceLevel(one.item.instanceId))
  }
  let changed = 0
  for (const one of all) {
    const lv = getInstanceLevel(one.item.instanceId)
    if (lv !== minLevel) continue
    if (upgradePlacedItem(one.item.instanceId, one.zone, true)) changed += 1
  }
  return changed
}

function convertHighestLevelItemsOnce(): number {
  const all = getAllOwnedPlacedItems()
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
    if (convertPlacedItemKeepLevel(one.item.instanceId, one.zone, true)) changed += 1
  }
  return changed
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
  if (!ctx.battleSystem || !ctx.battleView || !ctx.backpackSystem || !ctx.backpackView) return false
  const size = normalizeSize(candidate.item.size)
  const battleSlot = findFirstBattlePlace(size)
  const backpackSlot = battleSlot ? null : findFirstBackpackPlace(size)
  if (!battleSlot && !backpackSlot) {
    if (!opts?.silentNoSpaceToast) {
      showHintToast('backpack_full_buy', `${toastPrefix}：空间不足，发放失败`, 0xffb27a, ctx)
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
    if (opts?.flyFromHeroAvatar) flyRewardToGridSlot(candidate.item.id, ctx.battleView, battleSlot.col, battleSlot.row, onLand)
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
    if (opts?.flyFromHeroAvatar) flyRewardToGridSlot(candidate.item.id, ctx.backpackView, backpackSlot.col, backpackSlot.row, onLand)
    else onLand()
  }
  instanceToDefId.set(id, candidate.item.id)
  setInstanceQualityLevel(id, candidate.item.id, parseTierName(candidate.item.starting_tier) ?? 'Bronze', candidate.level)
  instanceToPermanentDamageBonus.set(id, 0)
  recordNeutralItemObtained(candidate.item.id)
  unlockItemToPool(candidate.item.id, ctx)
  showHintToast('backpack_full_buy', `${toastPrefix}：获得 ${candidate.item.name_cn}`, 0x86e1ff, ctx)
  return true
}

function buildNamedPoolCandidate(nameCn: string): PoolCandidate | null {
  const item = getItemDefByCn(nameCn)
  if (!item) return null
  const tier = parseTierName(item.starting_tier) ?? 'Bronze'
  const level = (tier === 'Bronze' ? 1 : tier === 'Silver' ? 2 : tier === 'Gold' ? 4 : 6) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  return { item, level, tier, star: 1, price: getUnlockPoolBuyPriceByLevel(level) }
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
  if (!ctx.dayPrevBtn || !ctx.dayNextBtn || !ctx.dayDebugText) return
  const gap = Math.max(16, Math.round(ctx.dayDebugText.style.fontSize as number))

  // 预留左右等宽箭头槽位，确保 Day 文本始终几何居中
  const arrowSlotW = Math.max(ctx.dayPrevBtn.width, ctx.dayNextBtn.width)
  ctx.dayPrevBtn.x = 0
  ctx.dayDebugText.x = arrowSlotW + gap
  ctx.dayNextBtn.x = ctx.dayDebugText.x + ctx.dayDebugText.width + gap + (arrowSlotW - ctx.dayNextBtn.width)

  // 垂直也对齐到同一中线
  const maxH = Math.max(ctx.dayPrevBtn.height, ctx.dayDebugText.height, ctx.dayNextBtn.height)
  ctx.dayPrevBtn.y = (maxH - ctx.dayPrevBtn.height) / 2
  ctx.dayDebugText.y = (maxH - ctx.dayDebugText.height) / 2
  ctx.dayNextBtn.y = (maxH - ctx.dayNextBtn.height) / 2

  // 以 Day 文本中心作为容器 pivot，便于全局精确居中
  if (ctx.dayDebugCon) {
    ctx.dayDebugCon.pivot.x = ctx.dayDebugText.x + ctx.dayDebugText.width / 2
  }
}

function applyItemInfoPanelLayout(ctx: ShopSceneCtx = _ctx): void {
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

function applyTextSizesFromDebug(ctx: ShopSceneCtx = _ctx): void {
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

function applyAreaLabelLeftAlign(ctx: ShopSceneCtx = _ctx): void {
  ctx.battleView?.setLabelGlobalLeft(AREA_LABEL_LEFT_X)
  ctx.backpackView?.setLabelGlobalLeft(AREA_LABEL_LEFT_X)
  ctx.shopPanel?.setLabelGlobalLeft(AREA_LABEL_LEFT_X)
}

function applyLayoutFromDebug(ctx: ShopSceneCtx = _ctx): void {
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
  skillDraftPanel?.layoutSkillIconBar()

  // 商店/背包/战斗区半透背景：按需求移除
  if (ctx.shopAreaBg) { ctx.shopAreaBg.clear(); ctx.shopAreaBg.visible = false }
  if (ctx.backpackAreaBg) { ctx.backpackAreaBg.clear(); ctx.backpackAreaBg.visible = false }
  if (ctx.battleAreaBg) { ctx.battleAreaBg.clear(); ctx.battleAreaBg.visible = false }

  applyTextSizesFromDebug(ctx)
  applyItemInfoPanelLayout(ctx)
  applyAreaLabelLeftAlign(ctx)
  applyPhaseUiVisibility(ctx)
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
  if (ctx.specialShopBackpackViewActive) {
    if (ctx.sellBtnHandle) {
      ctx.sellBtnHandle.container.visible = false
      ctx.sellBtnHandle.setSubLabel('')
    }
    if (ctx.refreshBtnHandle) ctx.refreshBtnHandle.container.visible = false
    if (ctx.refreshCostText) ctx.refreshCostText.visible = false
    return
  }

  if (!isShopInputEnabled(ctx)) {
    if (ctx.sellBtnHandle) {
      ctx.sellBtnHandle.container.visible = false
      ctx.sellBtnHandle.setSubLabel('')
    }
    if (ctx.refreshBtnHandle) ctx.refreshBtnHandle.container.visible = false
    if (ctx.refreshCostText) ctx.refreshCostText.visible = false
    return
  }

  if (ctx.sellBtnHandle) {
    ctx.sellBtnHandle.container.visible = true
    ctx.sellBtnHandle.redraw(true)
    ctx.sellBtnHandle.setSubLabel('')
  }

  if (ctx.refreshBtnHandle) ctx.refreshBtnHandle.container.visible = true
  if (ctx.refreshCostText) ctx.refreshCostText.visible = true
}

// canPlaceInVisibleCols / hasAnyPlaceInVisibleCols -> moved to ./shop/ShopMathHelpers.ts


function clearSelection(ctx: ShopSceneCtx = _ctx): void {
  ctx.currentSelection = { kind: 'none' }
  ctx.selectedSellAction = null
  resetInfoModeSelection(ctx)
  skillDraftPanel?.hideSkillDetailPopup()
  synthesisPanel?.hideSynthesisHoverInfo()
  ctx.shopPanel?.setSelectedSlot(-1)
  ctx.battleView?.setSelected(null)
  ctx.backpackView?.setSelected(null)
  ctx.sellPopup?.hide()
  applySellButtonState(ctx)
}

function setSellButtonPrice(price: number, ctx: ShopSceneCtx = _ctx): void {
  if (!ctx.sellBtnHandle) return
  void price
  ctx.sellBtnHandle.setSubLabel('')
}

function canBattleAcceptShopItem(size: ItemSizeNorm, ctx: ShopSceneCtx = _ctx): boolean {
  if (!ctx.battleSystem || !ctx.battleView) return false
  const w = size === '1x1' ? 1 : size === '2x1' ? 2 : 3
  const h = 1
  const maxCol = ctx.battleView.activeColCount - w
  const maxRow = 1 - h
  if (maxCol < 0 || maxRow < 0) return false

  for (let row = 0; row <= maxRow; row++) {
    for (let col = 0; col <= maxCol; col++) {
      const finalRow = row
      if (canPlaceInVisibleCols(ctx.battleSystem, ctx.battleView, col, finalRow, size)) return true
      const unified = planUnifiedSqueeze(
        { system: ctx.battleSystem, activeColCount: ctx.battleView.activeColCount },
        col,
        finalRow,
        size,
        '__shop_drag__',
        ctx.backpackSystem && ctx.backpackView
          ? { system: ctx.backpackSystem, activeColCount: ctx.backpackView.activeColCount }
          : undefined,
      )
      if (unified) return true
    }
  }
  return false
}

// ============================================================
// 区域闪光特效
// ============================================================
function startFlashEffect(stage: Container, size: ItemSizeNorm, forceBothZones = false, ctx: ShopSceneCtx = _ctx): void {
  AnimationEffects.startFlashEffect(ctx, stage, size, forceBothZones, {
    canBattleAcceptShopItem: (sz) => canBattleAcceptShopItem(sz),
    hasAnyPlaceInVisibleCols: (sz) => ctx.backpackSystem && ctx.backpackView
      ? hasAnyPlaceInVisibleCols(ctx.backpackSystem, ctx.backpackView, sz) : false,
  })
}


// clearAutoPackCache / clonePackPlan / getBackpackStateSignature / getAutoPackPlanCached /
// buildBackpackAutoPackPlan / applyBackpackAutoPackExisting / canBackpackAcceptByAutoPack /
// getOverlapBlockersInBattle / buildBackpackPlanForTransferred / applyBackpackPlanWithTransferred
// → 已移至 ./shop/ShopAutoPackManager.ts

// getArchetypeSortOrder -> moved to ./shop/ShopAutoPackManager.ts


function sortBackpackItemsByRule(ctx: ShopSceneCtx = _ctx): void {
  if (!ctx.backpackSystem || !ctx.backpackView) return
  const items = ctx.backpackSystem.getAllItems()
  if (items.length <= 1) {
    showHintToast('backpack_full_buy', '背包已整理', 0x9be5ff, ctx)
    return
  }

  const sorted = [...items].sort((a, b) => {
    const archCmp = getArchetypeSortOrder(a.defId) - getArchetypeSortOrder(b.defId)
    if (archCmp !== 0) return archCmp
    const aTier = instanceToTier.get(a.instanceId) ?? 'Bronze'
    const bTier = instanceToTier.get(b.instanceId) ?? 'Bronze'
    const aStar = getInstanceTierStar(a.instanceId)
    const bStar = getInstanceTierStar(b.instanceId)
    const aLevel = tierStarLevelIndex(aTier, aStar) + 1
    const bLevel = tierStarLevelIndex(bTier, bStar) + 1
    if (aLevel !== bLevel) return bLevel - aLevel
    const idCmp = a.defId.localeCompare(b.defId)
    if (idCmp !== 0) return idCmp
    return a.instanceId.localeCompare(b.instanceId)
  })

  const slots: Array<{ col: number; row: number }> = []
  for (let row = 0; row < ctx.backpackSystem.rows; row++) {
    for (let col = 0; col < ctx.backpackView.activeColCount; col++) {
      slots.push({ col, row })
    }
  }

  const packItems: PackItem[] = sorted.map((it, idx) => {
    const preferred = slots[Math.min(idx, Math.max(0, slots.length - 1))] ?? { col: 0, row: 0 }
    return {
      instanceId: it.instanceId,
      defId: it.defId,
      size: it.size,
      preferredCol: preferred.col,
      preferredRow: preferred.row,
    }
  })

  const plan = planAutoPack(packItems, ctx.backpackView.activeColCount, ctx.backpackSystem.rows)
  if (!plan) {
    showHintToast('backpack_full_buy', '整理失败：背包空间异常', 0xff8f8f, ctx)
    return
  }

  applyBackpackAutoPackExisting(plan, ctx)
  refreshShopUI()
  showHintToast('backpack_full_buy', '背包已按规则整理', 0x9be5ff, ctx)
}

function getGridDragSellAreaTopLocalY(): number {
  const yTop = Math.min(
    getDebugCfg('sellBtnY'),
    getDebugCfg('refreshBtnY'),
    getDebugCfg('phaseBtnY'),
  )
  return yTop - Math.round(BTN_RADIUS * 0.72)
}

function isOverGridDragSellArea(gx: number, gy: number): boolean {
  const stage = getApp().stage
  const top = stage.toGlobal({ x: 0, y: getGridDragSellAreaTopLocalY() })
  const left = stage.toGlobal({ x: 0, y: 0 })
  const right = stage.toGlobal({ x: CANVAS_W, y: 0 })
  const x0 = Math.min(left.x, right.x)
  const x1 = Math.max(left.x, right.x)
  return gy >= top.y && gx >= x0 && gx <= x1
}

function isOverAnyGridDropTarget(gx: number, gy: number, size: ItemSizeNorm, ctx: ShopSceneCtx = _ctx): boolean {
  const dragOffsetY = getDebugCfg('dragYOffset')
  const overBattle = ctx.battleView?.pixelToCellForItem(gx, gy, size, dragOffsetY)
  if (overBattle) return true
  const overBackpack = ctx.backpackView?.pixelToCellForItem(gx, gy, size, dragOffsetY)
  return !!overBackpack
}

function updateGridDragSellAreaHover(gx: number, gy: number, size: ItemSizeNorm, ctx: ShopSceneCtx = _ctx): void {
  if (!ctx.gridDragCanSell) {
    ctx.gridDragSellHot = false
    return
  }
  const hot = isOverGridDragSellArea(gx, gy) && !isOverAnyGridDropTarget(gx, gy, size, ctx)
  ctx.gridDragSellHot = hot
}

function makeGridDragDeps(ctx: ShopSceneCtx = _ctx) {
  return {
    isShopInputEnabled: () => isShopInputEnabled(ctx),
    applySellButtonState: () => applySellButtonState(ctx),
    getGridDragSellAreaTopLocalY: () => getGridDragSellAreaTopLocalY(),
  }
}

function startGridDragButtonFlash(stage: Container, canSell: boolean, canToBackpack: boolean, sellPrice = 0, ctx: ShopSceneCtx = _ctx): void {
  AnimationEffects.startGridDragButtonFlash(ctx, stage, canSell, canToBackpack, sellPrice, makeGridDragDeps(ctx))
}

function stopGridDragButtonFlash(ctx: ShopSceneCtx = _ctx): void {
  AnimationEffects.stopGridDragButtonFlash(ctx, makeGridDragDeps(ctx))
}


// ============================================================
// 商店拖拽：开始
// ============================================================
function startShopDrag(
  slotIndex: number,
  e: FederatedPointerEvent,
  stage: Container,
  ctx: ShopSceneCtx = _ctx,
): void {
  if (!isShopInputEnabled(ctx)) return
  if (!ctx.shopManager) return
  clearSelection(ctx)
  const slot = ctx.shopManager.pool[slotIndex]
  if (!slot || slot.purchased || !canAffordShopSlot(slot, ctx)) return

  const size  = normalizeSize(slot.item.size)
  const iconW = size === '1x1' ? CELL_SIZE : size === '2x1' ? CELL_SIZE * 2 : CELL_SIZE * 3
  const iconH = iconW

  const floater   = new Container()

  // 拖拽浮层：仅显示图片本体（不显示边框与背景）
  floater.eventMode = 'none'
  floater.interactiveChildren = false

  const sp = new Sprite(Texture.WHITE)
  sp.width = iconW - 10; sp.height = iconH - 10
  sp.x = 5; sp.y = 5; sp.alpha = 0
  floater.addChild(sp)
  Assets.load<Texture>(getItemIconUrl(slot.item.id))
    .then(tex => { sp.texture = tex; sp.alpha = 0.9 })
    .catch((err) => { console.warn('[ShopScene] 拖拽浮层图标加载失败', slot.item.id, err) })

  const offsetY = getDebugCfg('dragYOffset')
  const s = 1
  floater.scale.set(s)
  const p = stage.toLocal(e.global)
  floater.x = p.x - (iconW * s) / 2
  floater.y = p.y + offsetY - (iconH * s) / 2
  stage.addChild(floater)

  ctx.shopDragFloater   = floater
  ctx.shopDragSlotIdx   = slotIndex
  ctx.shopDragHiddenSlot = slotIndex
  ctx.shopDragSize      = size
  ctx.shopDragPointerId = e.pointerId
  ctx.shopPanel?.setSlotDragging(slotIndex, true)

  // 拖拽中视为选中：显示物品详情
  ctx.currentSelection = { kind: 'shop', slotIndex }
  ctx.selectedSellAction = null
  ctx.sellPopup?.show(slot.item, getShopSlotPreviewPrice(slot, ctx), 'buy', slot.tier)
  applySellButtonState(ctx)

  startFlashEffect(stage, size)
}

// ============================================================
// 商店拖拽：移动
// ============================================================
function onShopDragMove(e: FederatedPointerEvent, ctx: ShopSceneCtx = _ctx): void {
  if (!isShopInputEnabled(ctx)) return
  if (!ctx.shopDragFloater || !ctx.shopDragSize) return
  if (e.pointerId !== ctx.shopDragPointerId) return

  const dragSlot = ctx.shopManager?.pool[ctx.shopDragSlotIdx]
  refreshBackpackSynthesisGuideArrows(dragSlot?.item.id ?? null, dragSlot?.tier ?? null, 1)

  const s = 1

  const iconW   = ctx.shopDragSize === '1x1' ? CELL_SIZE : ctx.shopDragSize === '2x1' ? CELL_SIZE * 2 : CELL_SIZE * 3
  const iconH   = iconW
  const offsetY = getDebugCfg('dragYOffset')
  const stage = getApp().stage
  const p = stage.toLocal(e.global)
  ctx.shopDragFloater.scale.set(s)
  ctx.shopDragFloater.x = p.x - (iconW * s) / 2
  ctx.shopDragFloater.y = p.y + offsetY - (iconH * s) / 2

  const gx = e.globalX, gy = e.globalY
  const battleCell = ctx.battleView?.pixelToCellForItem(gx, gy, ctx.shopDragSize, 0)
  let synthTarget = dragSlot
    ? findSynthesisTargetWithDragProbe(dragSlot.item.id, dragSlot.tier, 1, gx, gy, ctx.shopDragSize)
    : null

  if (synthTarget) {
    highlightSynthesisTarget(synthTarget)
    if (dragSlot) synthesisPanel?.showSynthesisHoverInfo(dragSlot.item.id, dragSlot.tier, 1, synthTarget)
    return
  }
  synthesisPanel?.hideSynthesisHoverInfo()

  if (dragSlot && ctx.sellPopup) {
    ctx.sellPopup.show(dragSlot.item, getShopSlotPreviewPrice(dragSlot, ctx), 'buy', toVisualTier(dragSlot.tier, 1), undefined, getDefaultItemInfoMode())
  }

  if (battleCell && ctx.battleSystem) {
    const finalRow = battleCell.row
    let canDirect = canPlaceInVisibleCols(ctx.battleSystem, ctx.battleView!, battleCell.col, finalRow, ctx.shopDragSize)

    if (!canDirect) {
      const unified = planUnifiedSqueeze(
        { system: ctx.battleSystem, activeColCount: ctx.battleView!.activeColCount },
        battleCell.col,
        finalRow,
        ctx.shopDragSize,
        '__shop_drag__',
        ctx.backpackSystem && ctx.backpackView
          ? { system: ctx.backpackSystem, activeColCount: ctx.backpackView.activeColCount }
          : undefined,
      )
      if (unified?.mode === 'local' && unified.moves.length > 0) {
        const squeezeMs = getDebugCfg('squeezeMs')
        for (const move of unified.moves) {
          const movedItem = ctx.battleSystem.getItem(move.instanceId)
          if (!movedItem) continue
          ctx.battleSystem.remove(move.instanceId)
          ctx.battleSystem.place(move.newCol, move.newRow, movedItem.size, movedItem.defId, move.instanceId)
          ctx.battleView!.animateToCell(move.instanceId, move.newCol, move.newRow, squeezeMs)
        }
        canDirect = canPlaceInVisibleCols(ctx.battleSystem, ctx.battleView!, battleCell.col, finalRow, ctx.shopDragSize)
      }
    }

    let canReplaceToBackpack = false
    if (!canDirect) {
      const blockers = getOverlapBlockersInBattle(battleCell.col, finalRow, ctx.shopDragSize, ctx)
      if (blockers.length > 0) {
        const transferPlan = buildBackpackPlanForTransferred(blockers, ctx)
        canReplaceToBackpack = transferPlan !== null
      }
    }

    ctx.battleView!.highlightCells(
      battleCell.col,
      battleCell.row,
      ctx.shopDragSize,
      canDirect || canReplaceToBackpack,
      undefined,
    )
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

// ============================================================
// 商店拖拽：结束
// ============================================================
async function onShopDragEnd(e: FederatedPointerEvent, stage: Container, ctx: ShopSceneCtx = _ctx): Promise<void> {
  if (!isShopInputEnabled(ctx)) {
    applyPhaseInputLock(ctx)
    return
  }
  if (!ctx.shopDragFloater || ctx.shopDragSlotIdx < 0 || !ctx.shopDragSize) return
  if (e.pointerId !== ctx.shopDragPointerId) return

  const slot = ctx.shopManager?.pool[ctx.shopDragSlotIdx]

  stopFlashEffect(ctx)
  ctx.battleView?.clearHighlight()
  ctx.backpackView?.clearHighlight()
  synthesisPanel?.hideSynthesisHoverInfo()
  clearBackpackSynthesisGuideArrows()

  if (!slot || !ctx.shopManager || !ctx.shopDragSize) { resetDrag(ctx); return }
  if (!canBuyItemUnderFirstPurchaseRule(ctx, slot.item)) {
    showFirstPurchaseRuleHint()
    resetDrag(ctx); return
  }

  const gx = e.globalX, gy = e.globalY
  const size = ctx.shopDragSize
  let synthTarget = findSynthesisTargetWithDragProbe(slot.item.id, slot.tier, 1, gx, gy, size)
  const battleCell = ctx.battleView?.pixelToCellForItem(gx, gy, size, 0)
  const bpCell = ctx.backpackView?.visible ? ctx.backpackView.pixelToCellForItem(gx, gy, size, 0) : null
  const overBattleArea = isPointInZoneArea(ctx.battleView, gx, gy)
  const onBpBtn = isOverBpBtn(gx, gy)

  if (synthTarget) {
    const targetItem = getSynthesisTargetItem(synthTarget)
    const targetTier = getInstanceTier(synthTarget.instanceId) ?? slot.tier
    const targetStar = getInstanceTierStar(synthTarget.instanceId)
    const lv7MorphMode = !!targetItem && canUseLv7MorphSynthesis(slot.item.id, targetItem.defId, slot.tier, 1, targetTier, targetStar)
    if (lv7MorphMode) {
      showLv7MorphSynthesisConfirmOverlay(stage, () => {
        const choices = buildStoneTransformChoices(synthTarget, 'same')
        if (choices.length <= 0) {
          showHintToast('backpack_full_buy', 'Lv7转化：当前无可用候选', 0xffb27a, ctx)
          refreshShopUI()
          return
        }
        const opened = showNeutralChoiceOverlay(stage, '选择变化方向', choices, (picked) => {
          const buyRet = tryBuyShopSlotWithSkill(slot)
          if (!buyRet.ok) {
            showHintToast('no_gold_buy', '金币不足，无法购买', 0xff8f8f, ctx)
            refreshShopUI()
            return false
          }
          markShopPurchaseDone()
          const ok = transformPlacedItemKeepLevelTo(synthTarget.instanceId, synthTarget.zone, picked.item, true)
          if (!ok) {
            showHintToast('backpack_full_buy', 'Lv7转化失败', 0xff8f8f, ctx)
            refreshShopUI()
            return false
          }
          grantSynthesisExp(1, { instanceId: synthTarget.instanceId, zone: synthTarget.zone })
          showHintToast('no_gold_buy', 'Lv7合成：已触发变化石效果', 0x9be5ff, ctx)
          refreshShopUI()
          return true
        }, 'special_shop_like')
        if (!opened) {
          showHintToast('backpack_full_buy', 'Lv7转化：当前无可用候选', 0xffb27a, ctx)
          refreshShopUI()
        }
      })
      resetDrag(ctx)
      return
    }
    const isCrossId = !!targetItem && targetItem.defId !== slot.item.id
    if (isCrossId) {
      const targetDef = targetItem ? getItemDefById(targetItem.defId) : null
      if (!targetItem || !targetDef) {
        resetDrag(ctx)
        return
      }
      const upgradeTo = nextTierLevel(slot.tier, 1)
      if (!upgradeTo) {
        resetDrag(ctx)
        return
      }
      const runCrossSynthesis = () => {
        const buyRet = tryBuyShopSlotWithSkill(slot)
        if (!buyRet.ok) {
          showHintToast('no_gold_buy', '金币不足，无法购买', 0xff8f8f, ctx)
          refreshShopUI()
          return
        }
        markShopPurchaseDone()
        const synth = synthesizeTarget(slot.item.id, slot.tier, 1, synthTarget.instanceId, synthTarget.zone)
        if (!synth) {
          showHintToast('backpack_full_buy', '合成目标无效', 0xff8f8f, ctx)
          refreshShopUI()
          return
        }
        playSynthesisFlashEffect(ctx, stage, synth)
        if (!tryRunHeroCrossSynthesisReroll(stage, synth)) {
          refreshShopUI()
        }
      }
      if (isCrossIdSynthesisConfirmEnabled()) {
        synthesisPanel?.showCrossSynthesisConfirmOverlay(
          { def: slot.item, tier: slot.tier, star: 1 },
          { def: targetDef, tier: targetTier, star: targetStar },
          upgradeTo.tier,
          upgradeTo.star,
          runCrossSynthesis,
        )
      } else {
        runCrossSynthesis()
      }
      resetDrag(ctx)
      return
    }

    if (tryRunHeroSameItemSynthesisChoice(
      stage,
      slot.item.id,
      slot.tier,
      1,
      synthTarget,
      () => {
        const ret = tryBuyShopSlotWithSkill(slot)
        if (!ret.ok) {
          showHintToast('no_gold_buy', '金币不足，无法购买', 0xff8f8f, ctx)
          return false
        }
        markShopPurchaseDone()
        return true
      },
    )) {
      resetDrag(ctx); return
    }

    if (!tryBuyShopSlotWithSkill(slot).ok) {
      showHintToast('no_gold_buy', '金币不足，无法购买', 0xff8f8f, ctx)
      resetDrag(ctx); return
    }
    markShopPurchaseDone()
    const synth = synthesizeTarget(slot.item.id, slot.tier, 1, synthTarget.instanceId, synthTarget.zone)
    if (!synth) {
      showHintToast('backpack_full_buy', '合成目标无效', 0xff8f8f, ctx)
      refreshShopUI()
      resetDrag(ctx); return
    }
    playSynthesisFlashEffect(ctx, stage, synth)
    refreshShopUI()
    resetDrag(ctx); return
  }

  // 仅当落点在战斗区（含合成范围）/背包格子/背包按钮时才允许购买
  if (!overBattleArea && !bpCell && !onBpBtn) {
    resetDrag(ctx)
    return
  }

  // 战斗区放置
  const battleFinalRow = battleCell ? battleCell.row : 0
  const battleCanDirect = !!(battleCell && ctx.battleSystem && ctx.battleView
    && canPlaceInVisibleCols(ctx.battleSystem, ctx.battleView, battleCell.col, battleFinalRow, size))
  let battleSqueezeMoves: { instanceId: string; newCol: number; newRow: number }[] = []
  const battleUnified = (!battleCanDirect && battleCell && ctx.battleSystem && ctx.battleView)
    ? planUnifiedSqueeze(
      { system: ctx.battleSystem, activeColCount: ctx.battleView.activeColCount },
      battleCell.col,
      battleFinalRow,
      size,
      '__shop_drag__',
      ctx.backpackSystem && ctx.backpackView
        ? { system: ctx.backpackSystem, activeColCount: ctx.backpackView.activeColCount }
        : undefined,
    )
    : null
  if (battleUnified?.mode === 'local') battleSqueezeMoves = battleUnified.moves

  let battleTransferPlan: PackPlacement[] | null = null
  let battleTransferredIds = new Set<string>()
  if (!battleCanDirect && battleSqueezeMoves.length === 0 && battleCell && ctx.battleSystem && ctx.battleView) {
    if (battleUnified?.mode === 'cross') {
      const blockersById = new Map(getOverlapBlockersInBattle(battleCell.col, battleFinalRow, size, ctx).map(b => [b.instanceId, b] as const))
      const transfers = battleUnified.transfers.map(t => blockersById.get(t.instanceId)).filter((v): v is { instanceId: string; defId: string; size: ItemSizeNorm } => !!v)
      const plan = buildBackpackPlanForTransferred(transfers, ctx)
      if (plan) {
        battleTransferPlan = plan
        battleTransferredIds = new Set(transfers.map((b) => b.instanceId))
      }
    }
  }
  if (!battleCanDirect && battleSqueezeMoves.length === 0 && battleCell && ctx.battleSystem && ctx.battleView && battleTransferPlan === null) {
    const blockers = getOverlapBlockersInBattle(battleCell.col, battleFinalRow, size, ctx)
    if (blockers.length > 0) {
      const plan = buildBackpackPlanForTransferred(blockers, ctx)
      if (plan) {
        battleTransferPlan = plan
        battleTransferredIds = new Set(blockers.map((b) => b.instanceId))
      }
    }
  }
  if (
    ctx.battleSystem && ctx.battleView
    && (
      (battleCell && (battleCanDirect || battleSqueezeMoves.length > 0))
      || (battleCell && battleTransferPlan !== null)
    )
  ) {
    if (tryBuyShopSlotWithSkill(slot).ok) {
      markShopPurchaseDone()
      if (!battleCell) { resetDrag(ctx); return }
      if (battleSqueezeMoves.length > 0) {
        const squeezeMs = getDebugCfg('squeezeMs')
        for (const move of battleSqueezeMoves) {
          const movedItem = ctx.battleSystem.getItem(move.instanceId)
          if (!movedItem) continue
          ctx.battleSystem.remove(move.instanceId)
          ctx.battleSystem.place(move.newCol, move.newRow, movedItem.size, movedItem.defId, move.instanceId)
          ctx.battleView.animateToCell(move.instanceId, move.newCol, move.newRow, squeezeMs)
        }
      }
      if (battleTransferPlan && battleTransferredIds.size > 0) {
        applyBackpackPlanWithTransferred(battleTransferPlan, battleTransferredIds, ctx)
      }
      const id = nextId()
      ctx.battleSystem.place(battleCell.col, battleFinalRow, size, slot.item.id, id)
      ctx.battleView!.addItem(id, slot.item.id, size, battleCell.col, battleFinalRow, toVisualTier(slot.tier, 1))
        .then(() => {
          ctx.battleView!.setItemTier(id, toVisualTier(slot.tier, 1))
          ctx.drag?.refreshZone(ctx.battleView!)
        })
      instanceToDefId.set(id, slot.item.id)
      setInstanceQualityLevel(id, slot.item.id, parseTierName(slot.item.starting_tier) ?? 'Bronze', 1)
      instanceToPermanentDamageBonus.set(id, 0)
      recordNeutralItemObtained(slot.item.id)
      unlockItemToPool(slot.item.id)
      refreshShopUI()
    } else {
      showHintToast('no_gold_buy', '金币不足，无法购买', 0xff8f8f, ctx)
    }
    resetDrag(ctx); return
  }

  // 背包区放置
  if (bpCell || onBpBtn) {
    const directCell = bpCell && ctx.backpackSystem && ctx.backpackView
      ? (() => {
        const finalRow = bpCell.row
        return canPlaceInVisibleCols(ctx.backpackSystem, ctx.backpackView, bpCell.col, finalRow, size)
          ? { col: bpCell.col, row: finalRow }
          : null
      })()
      : null
    const buttonCell = onBpBtn ? findFirstBackpackPlace(size) : null
    const targetCell = directCell ?? buttonCell
    if (!targetCell) {
      showHintToast('backpack_full_buy', '背包已满，无法购买', 0xff8f8f, ctx)
      resetDrag(ctx); return
    }

    if (!tryBuyShopSlotWithSkill(slot).ok) {
      showHintToast('no_gold_buy', '金币不足，无法购买', 0xff8f8f, ctx)
      resetDrag(ctx); return
    }
    markShopPurchaseDone()

    const id = nextId()
    ctx.backpackSystem!.place(targetCell.col, targetCell.row, size, slot.item.id, id)
    ctx.backpackView!.addItem(id, slot.item.id, size, targetCell.col, targetCell.row, toVisualTier(slot.tier, 1))
      .then(() => {
        ctx.backpackView!.setItemTier(id, toVisualTier(slot.tier, 1))
        ctx.drag?.refreshZone(ctx.backpackView!)
      })
    instanceToDefId.set(id, slot.item.id)
    setInstanceQualityLevel(id, slot.item.id, parseTierName(slot.item.starting_tier) ?? 'Bronze', 1)
    instanceToPermanentDamageBonus.set(id, 0)
    recordNeutralItemObtained(slot.item.id)
    unlockItemToPool(slot.item.id)
    refreshShopUI()
  }

  resetDrag(ctx)
}

function resetDrag(ctx: ShopSceneCtx = _ctx): void {
  if (ctx.shopDragFloater) {
    const p = ctx.shopDragFloater.parent
    if (p) p.removeChild(ctx.shopDragFloater)
    ctx.shopDragFloater.destroy({ children: true })
    ctx.shopDragFloater = null
  }
  if (ctx.shopDragHiddenSlot >= 0) {
    ctx.shopPanel?.setSlotDragging(ctx.shopDragHiddenSlot, false)
  }
  ctx.shopDragHiddenSlot = -1
  ctx.shopDragSlotIdx = -1; ctx.shopDragSize = null; ctx.shopDragPointerId = -1
  synthesisPanel?.hideSynthesisHoverInfo()
  clearBackpackSynthesisGuideArrows()
  clearSelection(ctx)
}

function isOverBpBtn(gx: number, gy: number): boolean {
  const cx = getDebugCfg('backpackBtnX')
  const cy = getDebugCfg('backpackBtnY')
  const r  = BTN_RADIUS + 24
  const c = getApp().stage.toGlobal({ x: cx, y: cy })
  return (gx - c.x) ** 2 + (gy - c.y) ** 2 <= r * r
}

function isPointInZoneArea(view: GridZone | null, gx: number, gy: number): boolean {
  if (!view || !view.visible) return false
  const w = view.activeColCount * CELL_SIZE
  const h = CELL_HEIGHT
  const a = view.toGlobal({ x: 0, y: 0 })
  const b = view.toGlobal({ x: w, y: h })
  const x0 = Math.min(a.x, b.x)
  const x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const y1 = Math.max(a.y, b.y)
  return gx >= x0 && gx <= x1 && gy >= y0 && gy <= y1
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
    // ---- EventBus 主场景事件处理注册 ----
    // 面板模块通过 ctx.events.emit(...) 触发，主场景在此统一处理
    ctx.events.removeAll()
    ctx.events.on('REFRESH_SHOP_UI',          ()       => refreshShopUI())
    ctx.events.on('REFRESH_PLAYER_STATUS_UI', ()       => refreshPlayerStatusUI())
    ctx.events.on('SHOW_TOAST',               (reason) => showHintToast(reason, '', undefined, _ctx))
    ctx.events.on('SELECTION_CLEARED',        ()       => clearSelection())
    // PVP：注册 endSession 时的清理回调（避免 PvpContext ↔ ShopScene 循环 import）
    PvpContext.registerClearShopState(() => PvpPanelModule.clearPvpShopState(ctx))
    // PVP 模式：注册自动提交回调（倒计时结束时若未手动提交则自动触发）
    if (PvpContext.isActive()) {
      PvpContext.registerAutoSubmit(() => {
        clearBattleOutcome()
        ctx.pendingSkillBarMoveStartAtMs = Date.now()
        const snapshot = buildBattleSnapshot(ctx, ctx.pendingSkillBarMoveStartAtMs)
        if (snapshot) {
          setBattleSnapshot(snapshot)
          ctx.pendingBattleTransition = true
          ctx.pendingAdvanceToNextDay = true
          ctx.pvpReadyLocked = true
          if (PvpContext.getPvpMode() === 'sync-a') pvpPanel?.showPvpWaitingPanel(stage)
          PvpContext.onPlayerReady()
        }
      })
      // sync-a：通知 host 本玩家已进入商店（所有人到齐后才开始倒计时）
      PvpContext.notifyShopEntered()
      // sync-a：注册回调
      if (PvpContext.getPvpMode() === 'sync-a') {
        ctx.pvpUrgeCooldownSet.clear()
        PvpContext.onUrgeReceived = (fromPlayerIndex, fromNickname) => {
          const session = PvpContext.getSession()
          const fromPlayer = session?.players.find(p => p.index === fromPlayerIndex)
          const name = fromPlayer?.nickname ?? fromNickname
          pvpPanel?.showEggSplatOverlay(name)
        }
        // 跳转战斗前主动清理等待面板（防止面板残留到战斗场景）
        PvpContext.onBeforeBattleTransition = () => {
          if (ctx.pvpWaitingPanel) {
            ctx.pvpWaitingPanel.parent?.removeChild(ctx.pvpWaitingPanel)
            ctx.pvpWaitingPanel.destroy({ children: true })
            ctx.pvpWaitingPanel = null
          }
          if (ctx.pvpBackpackReturnBtn) {
            ctx.pvpBackpackReturnBtn.parent?.removeChild(ctx.pvpBackpackReturnBtn)
            ctx.pvpBackpackReturnBtn.destroy({ children: true })
            ctx.pvpBackpackReturnBtn = null
          }
        }
        // eliminatedPlayers 变化时立即刷新等待面板（round_summary 延迟到达时的兜底）
        PvpContext.onEliminatedPlayersUpdate = () => {
          pvpPanel?.refreshPvpWaitingPanel()
        }
        // 对手 index 确认后刷新等待面板对手卡（轮空/镜像场景：host 下发 opponent_snapshot 后触发）
        PvpContext.onOpponentKnown = () => {
          pvpPanel?.refreshPvpWaitingPanel()
        }
      }
    }

    ctx.battlePassivePrevStats.clear()
    ctx.battlePassiveResolvedStats.clear()
    ctx.passiveJumpLayer = new Container()
    ctx.passiveJumpLayer.eventMode = 'none'

    createHintToast(stage, _ctx)
    ctx.showingBackpack = true
}

function buildTopAreaUI(stage: Container, cfg: ReturnType<typeof getConfig>, ctx: ShopSceneCtx = _ctx): void {
    // 顶部分区背景（商店 / 背包）
    ctx.shopAreaBg = new Graphics()
    stage.addChild(ctx.shopAreaBg)
    ctx.backpackAreaBg = new Graphics()
    stage.addChild(ctx.backpackAreaBg)
    ctx.battleAreaBg = new Graphics()
    stage.addChild(ctx.battleAreaBg)

    const restartLabel = new Text({
      text: '重新开始',
      style: {
        fontSize: cfg.textSizes.refreshCost,
        fill: 0xffe8a3,
        fontFamily: 'Arial',
        fontWeight: 'bold',
      },
    })
    const restartBg = new Graphics()
    const restartPadX = 18
    const restartPadY = 10
    const restartW = restartLabel.width + restartPadX * 2
    const restartH = restartLabel.height + restartPadY * 2
    restartBg.roundRect(0, 0, restartW, restartH, 14)
    restartBg.fill({ color: 0x1f2940, alpha: 0.88 })
    restartBg.stroke({ color: 0xffd25a, width: 2, alpha: 0.95 })
    restartLabel.x = restartPadX
    restartLabel.y = restartPadY
    const restartCon = new Container()
    restartCon.x = 16
    restartCon.y = 16
    restartCon.eventMode = 'static'
    restartCon.cursor = 'pointer'
    restartCon.hitArea = new Rectangle(0, 0, restartW, restartH)
    restartCon.addChild(restartBg)
    restartCon.addChild(restartLabel)
    restartCon.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      restartRunFromBeginning(ctx)
    })
    ctx.restartBtn = restartCon
    stage.addChild(restartCon)

    ctx.playerStatusCon = new Container()
    ctx.playerStatusCon.zIndex = 95
    ctx.playerStatusCon.x = 0
    ctx.playerStatusCon.y = getDebugCfg('shopPlayerStatusY')

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
      toggleHeroPassiveDetailPopup(ctx)
    })
    ctx.playerStatusCon.addChild(ctx.playerStatusAvatar)

    ctx.playerStatusAvatarClickHit = new Graphics()
    ctx.playerStatusAvatarClickHit.eventMode = 'static'
    ctx.playerStatusAvatarClickHit.cursor = 'pointer'
    ctx.playerStatusAvatarClickHit.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      toggleHeroPassiveDetailPopup(ctx)
    })
    ctx.playerStatusCon.addChild(ctx.playerStatusAvatarClickHit)

    ctx.playerStatusDailySkillStar = new Text({
      text: '★',
      style: {
        fontSize: 28,
        fill: 0xffd24a,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x4a2d00, width: 3 },
      },
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
        fill: 0xf3f8ff,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x0f172b, width: 3 },
      },
    })
    ctx.playerStatusLvText.anchor.set(0.5)
    ctx.playerStatusCon.addChild(ctx.playerStatusLvText)

    layoutPlayerStatusPanel(ctx)

    stage.addChild(ctx.playerStatusCon)

    ctx.livesText = new Text({
      text: '❤️ 5/5',
      style: {
        fontSize: cfg.textSizes.refreshCost,
        fill: 0xffd4d4,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x000000, width: 3 },
      },
    })
    ctx.livesText.zIndex = 95
    stage.addChild(ctx.livesText)

    // PVP 模式：在血量文字下方添加专属「查看玩家」小按钮（PVE 模式不显示）
    if (PvpContext.isActive()) {
      const pvpPlayersBtn = new Container()
      pvpPlayersBtn.zIndex = 96

      const btnBg = new Graphics()
      btnBg.roundRect(0, 0, 110, 36, 10).fill({ color: 0x162238, alpha: 0.92 })
      btnBg.roundRect(0, 0, 110, 36, 10).stroke({ color: 0x3a5a8a, width: 1.2 })
      pvpPlayersBtn.addChild(btnBg)

      const btnT = new Text({
        text: '👥 查看玩家',
        style: { fill: 0x88bbee, fontSize: 17, fontWeight: 'bold' },
      })
      btnT.anchor.set(0.5)
      btnT.x = 55
      btnT.y = 18
      pvpPlayersBtn.addChild(btnT)

      // 定位到右上角血量文字下方（blood text y=18, height≈28, gap=4）
      pvpPlayersBtn.x = CANVAS_W - 118
      pvpPlayersBtn.y = 52

      pvpPlayersBtn.eventMode = 'static'
      pvpPlayersBtn.cursor = 'pointer'
      pvpPlayersBtn.on('pointerdown', () => pvpPanel?.openPvpPlayerListOverlay())
      pvpPlayersBtn.on('pointerover', () => { pvpPlayersBtn.alpha = 0.75 })
      pvpPlayersBtn.on('pointerout', () => { pvpPlayersBtn.alpha = 1 })
      stage.addChild(pvpPlayersBtn)

      // ── 本轮对手徽章 + 英雄背景立绘（sync-a：商店阶段始终可见）──
      if (PvpContext.getPvpMode() === 'sync-a') {
        pvpPanel?.buildPvpOpponentBadge()
        void pvpPanel?.buildPvpOpponentHeroLayer()
        // day_ready 携带轮空预分配时（onEnter 之后 ~300ms 到达），补建徽章
        PvpContext.onOpponentPreAssigned = () => {
          pvpPanel?.buildPvpOpponentBadge()
          void pvpPanel?.buildPvpOpponentHeroLayer()
        }
        // round_summary 比 onEnter 晚到时，补建英雄立绘
        PvpContext.onRoundSummaryReceived = () => {
          void pvpPanel?.buildPvpOpponentHeroLayer()
        }
      }
    }

    ctx.trophyText = new Text({
      text: '🏆 0/10',
      style: {
        fontSize: cfg.textSizes.refreshCost,
        fill: 0xffe8b4,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x000000, width: 3 },
      },
    })
    ctx.trophyText.zIndex = 95
    stage.addChild(ctx.trophyText)
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
    // ---- 按钮行 ----
    ctx.btnRow = new Container()
    ctx.btnRow.x = 0
    ctx.btnRow.y = 0

    function makeCircleBtn(
      cx: number,
      cy: number,
      label: string,
      activeColor: number,
      inactiveColor = 0xcc3333,
      mainFontSize = cfg.textSizes.shopButtonLabel,
    ): CircleBtnHandle {
      const g   = new Graphics()
      const txt = new Text({
        text: label,
        style: { fontSize: mainFontSize, fill: 0xeebbbb, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      txt.name = 'btn-main'
      const sub = new Text({
        text: '',
        style: { fontSize: cfg.textSizes.sellButtonSubPrice, fill: 0xffd700, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      sub.name = 'sell-price'
      sub.visible = false

      let curCx = cx
      let curCy = cy
      let curActive = false

      const container = new Container()
      container.addChild(g); container.addChild(txt); container.addChild(sub)
      container.eventMode = 'static'
      container.cursor    = 'pointer'

      const redraw = (active: boolean) => {
        curActive = active
        g.clear()
        g.circle(curCx, curCy, BTN_RADIUS)
        g.stroke({ color: active ? activeColor : inactiveColor, width: 3 })
        if (active) g.fill({ color: activeColor, alpha: 0.15 })
        txt.style.fill = active ? activeColor : inactiveColor
        const gap = Math.max(2, Math.round(txt.height * 0.08))
        const groupH = sub.visible ? (txt.height + gap + sub.height) : txt.height
        const groupTop = curCy - groupH / 2
        txt.x = curCx - txt.width / 2
        txt.y = groupTop
        sub.x = curCx - sub.width / 2
        sub.y = txt.y + txt.height + gap
        container.hitArea = new Rectangle(curCx - BTN_RADIUS, curCy - BTN_RADIUS, BTN_RADIUS * 2, BTN_RADIUS * 2)
      }

      const setCenter = (nextCx: number, nextCy: number) => {
        curCx = nextCx
        curCy = nextCy
        redraw(curActive)
      }

      const setLabel = (nextLabel: string) => {
        txt.text = nextLabel
        redraw(curActive)
      }

      const setSubLabel = (text: string) => {
        sub.text = text
        sub.visible = text.length > 0
        redraw(curActive)
      }

      redraw(false)
      return { container, redraw, setCenter, setLabel, setSubLabel }
    }

    function makePhaseRectBtn(
      cx: number,
      cy: number,
      label: string,
      activeColor: number,
      inactiveColor = 0xffcc44,
      mainFontSize = cfg.textSizes.phaseButtonLabel,
    ): CircleBtnHandle {
      const g = new Graphics()
      const txt = new Text({
        text: label,
        style: { fontSize: mainFontSize, fill: 0x1a1a2a, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      txt.name = 'btn-main'
      const sub = new Text({
        text: '',
        style: { fontSize: cfg.textSizes.sellButtonSubPrice, fill: 0xffd700, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      sub.name = 'sell-price'
      sub.visible = false

      let curCx = cx
      let curCy = cy
      let curActive = true

      const container = new Container()
      container.addChild(g)
      container.addChild(txt)
      container.addChild(sub)
      container.eventMode = 'static'
      container.cursor = 'pointer'

      const redraw = (active: boolean) => {
        curActive = active
        const drawColor = active ? activeColor : inactiveColor
        const left = curCx - PHASE_BTN_W / 2
        const top = curCy - PHASE_BTN_H / 2
        const corner = Math.max(10, Math.round(getDebugCfg('gridItemCornerRadius') + 8))
        g.clear()
        g.roundRect(left, top, PHASE_BTN_W, PHASE_BTN_H, corner)
        g.stroke({ color: drawColor, width: 3 })
        g.fill({ color: drawColor, alpha: 0.18 })
        txt.style.fill = drawColor
        const gap = Math.max(2, Math.round(txt.height * 0.08))
        const groupH = sub.visible ? (txt.height + gap + sub.height) : txt.height
        const groupTop = curCy - groupH / 2
        txt.x = curCx - txt.width / 2
        txt.y = groupTop
        sub.x = curCx - sub.width / 2
        sub.y = txt.y + txt.height + gap
        container.hitArea = new Rectangle(left, top, PHASE_BTN_W, PHASE_BTN_H)
      }

      const setCenter = (nextCx: number, nextCy: number) => {
        curCx = nextCx
        curCy = nextCy
        redraw(curActive)
      }

      const setLabel = (nextLabel: string) => {
        txt.text = nextLabel
        redraw(curActive)
      }

      const setSubLabel = (text: string) => {
        sub.text = text
        sub.visible = text.length > 0
        redraw(curActive)
      }

      redraw(true)
      return { container, redraw, setCenter, setLabel, setSubLabel }
    }

    ctx.bpBtnHandle = null

    // 购买按钮（中，矩形）
    const refreshBtn = makePhaseRectBtn(
      getDebugCfg('refreshBtnX'),
      getDebugCfg('refreshBtnY'),
      '购买',
      0x44aaff,
      0x44aaff,
      cfg.textSizes.phaseButtonLabel,
    )
    refreshBtn.container.on('pointerdown', () => {
      if (!isShopInputEnabled(_ctx)) return
      clearSelection()
      buyRandomBronzeToBoardOrBackpack()
      refreshBtn.redraw(false)
    })
    ctx.refreshBtnHandle = refreshBtn
    ctx.btnRow.addChild(refreshBtn.container)

    refreshBtn.setSubLabel(`💰 ${ctx.shopManager!.gold}/${getQuickBuyPricePreviewLabel()}`)

    // 保留占位引用，避免旧流程空指针
    ctx.refreshCostText = null

    ctx.goldText = null

    // 整理按钮（右）
    const sellBtn = makeCircleBtn(getDebugCfg('sellBtnX'), getDebugCfg('sellBtnY'), '整理', 0x3b74ff, 0x3b74ff)
    sellBtn.container.on('pointerdown', () => {
      if (!isShopInputEnabled(_ctx)) return
      // 选中点击“整理”只执行整理，不再触发丢弃。
      if (ctx.selectedSellAction) ctx.selectedSellAction = null
      clearSelection()
      sortBackpackItemsByRule()
    })
    ctx.sellBtnHandle = sellBtn
    ctx.btnRow.addChild(sellBtn.container)

    // 战斗切换按钮（圆形）
    const phaseBtn = makeCircleBtn(
      getDebugCfg('phaseBtnX'),
      getDebugCfg('phaseBtnY'),
      '战斗',
      0xffcc44,
      0xffcc44,
      cfg.textSizes.shopButtonLabel,
    )
    phaseBtn.container.on('pointerdown', () => {
      if (!isShopInputEnabled(_ctx)) {
        SceneManager.goto('shop')
        return
      }
      if (ctx.battleStartTransition) return
      const boardItemCount = ctx.battleSystem?.getAllItems().length ?? 0
      const backpackItemCount = ctx.backpackSystem?.getAllItems().length ?? 0
      if (boardItemCount <= 0 && canAffordQuickBuyNow()) {
        showHintToast('no_gold_buy', '请先购买物品作战', 0xffd48f, _ctx)
        showBuyGuideHand(ctx)
        return
      }
      if (boardItemCount <= 0 && backpackItemCount > 0) {
        // PVP 模式：允许直接提交（背包物品不参与战斗，但快照交换正常工作）
        if (!PvpContext.isActive()) {
          showHintToast('no_gold_buy', '请将物品拖入上阵区', 0xffd48f, _ctx)
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
      // PVP 模式：提交快照给对手，等待对方快照，不走本地过渡动画
      if (PvpContext.isActive()) {
        ctx.pvpReadyLocked = true
        ctx.phaseBtnHandle?.setLabel('等待...')
        ctx.phaseBtnHandle?.redraw(true)
        // sync-a：先建面板再调 onPlayerReady，防止 host 同步触发 goto('battle') 后面板才加入
        if (PvpContext.getPvpMode() === 'sync-a') pvpPanel?.showPvpWaitingPanel(stage)
        PvpContext.onPlayerReady()
        return
      }
      beginBattleStartTransition()
    })
    ctx.phaseBtnHandle = phaseBtn
    ctx.btnRow.addChild(phaseBtn.container)

    ctx.miniMapGfx = null
    ctx.miniMapCon = null

    stage.addChild(ctx.btnRow)
    ensureBottomHudVisibleAndOnTop(stage)

    // 丢弃弹窗
    const selectGridItem = (
      instanceId: string,
      system: GridSystem,
      view: GridZone,
      kind: 'battle' | 'backpack',
    ) => {
      const defId = instanceToDefId.get(instanceId)
      if (!defId || !ctx.sellPopup || !ctx.shopManager) return
      const item = getAllItems().find(i => i.id === defId)
      if (!item) return

      ctx.battleView?.setSelected(kind === 'battle' ? instanceId : null)
      ctx.backpackView?.setSelected(kind === 'backpack' ? instanceId : null)
      ctx.shopPanel?.setSelectedSlot(-1)

      ctx.currentSelection = kind === 'battle'
        ? { kind: 'battle', instanceId }
        : { kind: 'backpack', instanceId }

      skillDraftPanel?.hideSkillDetailPopup()
      if (kind === 'battle') refreshBattlePassiveStatBadges(false)
      const tier = getInstanceTier(instanceId)
      const star = getInstanceTierStar(instanceId)
      const sellPrice = 0
      const infoMode = resolveInfoMode(`${kind}:${instanceId}:${tier}:${star}`, _ctx)
      ctx.sellPopup.show(item, sellPrice, 'none', toVisualTier(tier, star), undefined, infoMode)

      ctx.selectedSellAction = () => {
        system.remove(instanceId)
        view.removeItem(instanceId)
        removeInstanceMeta(instanceId)
        ctx.drag?.refreshZone(view)
      }

      setSellButtonPrice(sellPrice)
      applySellButtonState()
    }

    const handleShopSlotTap = (slotIndex: number) => {
      if (!isShopInputEnabled(_ctx)) return
      if (!ctx.shopManager || !ctx.sellPopup) return
      const slot = ctx.shopManager.pool[slotIndex]
      if (!slot) return

      ctx.shopPanel?.setSelectedSlot(slotIndex)
      ctx.battleView?.setSelected(null)
      ctx.backpackView?.setSelected(null)
      ctx.currentSelection = { kind: 'shop', slotIndex }
      ctx.selectedSellAction = null

      const infoMode = resolveInfoMode(`shop:${slotIndex}:${slot.item.id}:${slot.tier}`, _ctx)
      skillDraftPanel?.hideSkillDetailPopup()
      ctx.sellPopup.show(slot.item, getShopSlotPreviewPrice(slot), 'buy', toVisualTier(slot.tier, 1), undefined, infoMode)
      applySellButtonState()
    }

    ctx.backpackView!.onTap = (id) => {
      if (!isShopInputEnabled(_ctx)) return
      if (ctx.specialShopBackpackViewActive) {
        handleSpecialShopBackpackItemTap(id, 'backpack')
        return
      }
      selectGridItem(id, ctx.backpackSystem!, ctx.backpackView!, 'backpack')
    }
    ctx.battleView!.onTap   = (id) => {
      if (!isShopInputEnabled(_ctx)) return
      if (ctx.specialShopBackpackViewActive) {
        handleSpecialShopBackpackItemTap(id, 'battle')
        return
      }
      selectGridItem(id, ctx.battleSystem!, ctx.battleView!, 'battle')
    }
    ctx.shopPanel!.onTap    = (slotIndex) => handleShopSlotTap(slotIndex)

    ctx.sellPopup = new SellPopup(CANVAS_W, CANVAS_H)
    ctx.sellPopup.zIndex = 20
    stage.addChild(ctx.sellPopup)
    applyLayoutFromDebug()

    ctx.offDebugCfg = onDebugCfgChange((key) => {
      if (
        key === 'shopAreaX' || key === 'shopAreaY'
        || key === 'shopItemScale'
        || key === 'battleItemScale'
        || key === 'battleItemScaleBackpackOpen'
        || key === 'enemyAreaScale'
        || key === 'battleZoneX' || key === 'battleZoneY'
        || key === 'backpackZoneX' || key === 'backpackZoneY'
        || key === 'backpackBtnX' || key === 'backpackBtnY'
        || key === 'sellBtnX' || key === 'sellBtnY'
        || key === 'refreshBtnX' || key === 'refreshBtnY'
        || key === 'phaseBtnX' || key === 'phaseBtnY'
        || key === 'goldTextCenterX' || key === 'goldTextY'
        || key === 'shopPlayerStatusY'
        || key === 'shopPlayerStatusLvY'
        || key === 'shopPlayerStatusExpBarWidth' || key === 'shopPlayerStatusExpBarHeight'
        || key === 'shopPlayerStatusExpBarOffsetX' || key === 'shopPlayerStatusExpBarOffsetY'
        || key === 'dayDebugX' || key === 'dayDebugY'
        || key === 'tierBorderWidth'
        || key === 'gridItemCornerRadius'
        || key === 'gridCellBorderWidth'
        || key === 'shopAreaBgWidth' || key === 'shopAreaBgHeight'
        || key === 'backpackAreaBgWidth' || key === 'backpackAreaBgHeight'
        || key === 'itemInfoWidth' || key === 'itemInfoMinH' || key === 'itemInfoMinHSmall' || key === 'itemInfoBottomGapToShop'
        || key === 'gridZoneLabelFontSize'
        || key === 'shopButtonLabelFontSize'
        || key === 'phaseButtonLabelFontSize'
        || key === 'sellButtonSubPriceFontSize'
        || key === 'refreshCostFontSize'
        || key === 'goldFontSize'
        || key === 'shopPlayerStatusLvFontSize'
        || key === 'dayDebugArrowFontSize'
        || key === 'dayDebugLabelFontSize'
        || key === 'shopItemNameFontSize'
        || key === 'shopItemPriceFontSize'
        || key === 'shopItemBoughtFontSize'
        || key === 'itemStatBadgeFontSize'
        || key === 'itemTierStarFontSize'
        || key === 'itemTierStarStrokeWidth'
        || key === 'itemTierStarOffsetX'
        || key === 'itemTierStarOffsetY'
        || key === 'itemStatBadgeOffsetY'
        || key === 'itemInfoNameFontSize'
        || key === 'itemInfoTierFontSize'
        || key === 'itemInfoPriceFontSize'
        || key === 'itemInfoPriceCornerFontSize'
        || key === 'itemInfoCooldownFontSize'
        || key === 'itemInfoDescFontSize'
        || key === 'itemInfoSimpleDescFontSize'
        || key === 'battleOrbColorHp'
        || key === 'battleColorShield'
        || key === 'battleColorBurn'
        || key === 'battleColorPoison'
        || key === 'battleColorRegen'
      ) {
        applyLayoutFromDebug()
      }
    })

    // 点击空白区域关闭信息面板（物品/按钮/面板内点击会自行 stopPropagation 或切换内容）
    ctx.onStageTapHidePopup = () => {
      if (ctx.shopDragFloater) return
      clearSelection()
    }
    stage.on('pointerdown', ctx.onStageTapHidePopup)

    // Stage 级指针事件（商店拖拽）
    ctx.onStageShopPointerMove = (e: FederatedPointerEvent) => {
      if (ctx.shopDragFloater) onShopDragMove(e)
    }
    ctx.onStageShopPointerUp = (e: FederatedPointerEvent) => {
      if (ctx.shopDragFloater) void onShopDragEnd(e, stage)
    }
    ctx.onStageShopPointerUpOutside = (e: FederatedPointerEvent) => {
      if (ctx.shopDragFloater) void onShopDragEnd(e, stage)
    }
    stage.on('pointermove', ctx.onStageShopPointerMove)
    stage.on('pointerup', ctx.onStageShopPointerUp)
    stage.on('pointerupoutside', ctx.onStageShopPointerUpOutside)

    // Debug 天数控制
    ctx.dayDebugCon = new Container()
    ctx.dayDebugCon.x = CANVAS_W / 2
    ctx.dayDebugCon.y = getDebugCfg('dayDebugY')

    const prevDayBtn = new Text({ text: '◀', style: { fontSize: cfg.textSizes.dayDebugArrow, fill: 0x888888 } })
    prevDayBtn.eventMode = 'static'
    prevDayBtn.cursor    = 'pointer'
    prevDayBtn.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      if (!isShopInputEnabled(_ctx)) return
      setDay(ctx.currentDay - 1)
    })

    ctx.dayDebugText = new Text({
      text: `Day ${ctx.currentDay}`,
      style: { fontSize: cfg.textSizes.dayDebugLabel, fill: 0xcccccc, fontFamily: 'Arial' },
    })

    const nextDayBtn = new Text({ text: '▶', style: { fontSize: cfg.textSizes.dayDebugArrow, fill: 0x888888 } })
    nextDayBtn.eventMode = 'static'
    nextDayBtn.cursor    = 'pointer'
    nextDayBtn.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      if (!isShopInputEnabled(_ctx)) return
      setDay(ctx.currentDay + 1)
    })

    ctx.dayDebugCon.addChild(prevDayBtn, ctx.dayDebugText, nextDayBtn)
    stage.addChild(ctx.dayDebugCon)
    ctx.dayPrevBtn = prevDayBtn
    ctx.dayNextBtn = nextDayBtn
    layoutDayDebugControls()
    settingsPanel?.createSettingsButton()
    // Day 调试文字在此处才创建，需要再应用一次字号配置以覆盖 game_config 默认值
    applyTextSizesFromDebug()
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

