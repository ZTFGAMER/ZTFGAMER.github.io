// ============================================================
// ShopPanelInitializer — 面板实例初始化
// 职责：
//   - 创建并返回 7 个面板实例：
//     PvpPanel, SettingsDebugPanel, SkillDraftPanel, EventDraftPanel,
//     SpecialShopPanel, NeutralItemPanel, SynthesisPanel
//   - 接收场景本地 deps（无法从其他模块直接导入的回调）
// ============================================================

import { Container } from 'pixi.js'
import type { TierKey } from '@/shop/ShopManager'
import type { ItemDef } from '@/common/items/ItemDef'
import type { ItemSizeNorm } from '@/common/grid/GridSystem'
import type { ShopSceneCtx, EventChoice } from './ShopSceneContext'

import { PvpPanel } from './panels/PvpPanel'
import { SettingsDebugPanel } from './panels/SettingsDebugPanel'
import { SkillDraftPanel } from './panels/SkillDraftPanel'
import { EventDraftPanel } from './panels/EventDraftPanel'
import { SpecialShopPanel } from './panels/SpecialShopPanel'
import { NeutralItemPanel } from './panels/NeutralItemPanel'
import type { NeutralChoiceCandidate } from './panels/NeutralItemPanel'
import { SynthesisPanel } from './panels/SynthesisPanel'

import {
  saveShopStateToStorage,
  captureShopState,
} from './ShopStateStorage'

import {
  nextId,
  instanceToDefId,
  instanceToTier,
  instanceToPermanentDamageBonus,
  removeInstanceMeta,
  setInstanceQualityLevel,
  getInstanceLevel,
  getInstanceTier,
  getInstanceTierStar,
} from './systems/ShopInstanceRegistry'

import {
  markEventSelected,
  resetEventSelectionCounters,
  getSelectedEventCount,
  getEventPoolRows,
  isEventChoiceAvailable,
  pickRandomEventDraftChoices,
  pickRandomEventDraftChoicesNoOverlap,
  resolveEventDescText,
} from './systems/ShopEventSystem'

import {
  pickQualityByPseudoRandomBag,
  getQuickBuyLevelWeightsByDay,
  getMaxQuickBuyLevelForDay,
  levelToTierStar,
  getUnlockPoolBuyPriceByLevel,
} from './systems/QuickBuySystem'
import type { PoolCandidate } from './systems/QuickBuySystem'

import { getQualityLevelRange } from './ui/PlayerStatusUI'

import {
  hasPickedSkill,
  resolveBuyPriceWithSkills,
  consumeSkill15NextBuyDiscountAfterSuccess,
  consumeSkill30BundleAfterSuccess,
  getDailyPlanRow,
  getSkillTierForDay,
  pickSkillChoices,
  pickSkillChoicesNoOverlap,
  pickSkillChoicesExactTier,
} from './systems/ShopSkillSystem'

import {
  playTransformOrUpgradeFlashEffect,
} from './ui/ShopAnimationEffects'

import {
  parseAvailableTiers,
  getSpecialShopSpeedTierText,
  ammoValueFromLineByStar,
} from './panels/SpecialShopDesc'

import {
  getSizeCols,
  getSizeCellDim,
  compareTier,
  toVisualTier,
} from './ShopMathHelpers'

import { showHintToast } from './ui/ShopToastSystem'

import {
  shouldShowSimpleDescriptions,
  isSkillDraftRerollEnabled,
  isEventDraftRerollEnabled,
  getDefaultSkillDetailMode,
  resetInfoModeSelection,
} from './ShopModeHelpers'

import {
  getPrimaryArchetype,
  isNeutralArchetypeKey,
} from './systems/ShopSynthesisLogic'

import {
  canBuyItemUnderFirstPurchaseRule,
  canUseHeroDailyCardReroll,
  canTriggerHeroSameItemSynthesisChoice,
  createGuideItemCard,
  getGuideFrameTierByLevel,
} from './systems/ShopHeroSystem'
import { getAllItems } from '@/core/DataLoader'

import { isPointInItemBounds } from './systems/ShopSynthesisController'
import { refreshUpgradeHints } from './ui/ShopUpgradeHints'

import type { OwnedPlacedItem } from './systems/ShopGridInventory'

// ============================================================
// 返回类型
// ============================================================

export type PanelSet = {
  pvpPanel: PvpPanel
  settingsPanel: SettingsDebugPanel
  skillDraftPanel: SkillDraftPanel
  eventDraftPanel: EventDraftPanel
  specialShopPanel: SpecialShopPanel
  neutralItemPanel: NeutralItemPanel
  synthesisPanel: SynthesisPanel
}

// ============================================================
// 场景本地依赖（无法从其他模块导入，须由 ShopScene 传入）
// ============================================================

export type PanelInitDeps = {
  refreshShopUI: () => void
  refreshPlayerStatusUI: () => void
  setTransitionInputEnabled: (enabled: boolean) => void
  setBaseShopPrimaryButtonsVisible: (visible: boolean) => void
  applyPhaseInputLock: () => void
  clearSelection: () => void
  applySellButtonState: () => void
  checkAndPopPendingRewards: () => void
  grantSynthesisExp: (amount?: number, from?: { instanceId: string; zone: 'battle' | 'backpack' }) => void
  applyInstanceTierVisuals: () => void
  syncShopOwnedTierRules: () => void
  markShopPurchaseDone: () => void
  recordNeutralItemObtained: (defId: string) => void
  unlockItemToPool: (defId: string) => boolean
  showFirstPurchaseRuleHint: () => void
  isBackpackDropLocked: (col: number, row: number, size: ItemSizeNorm) => boolean
  canUseSameArchetypeDiffItemStoneSynthesis: (
    a: string,
    b: string,
    c: TierKey,
    d: 1 | 2,
    e: TierKey,
    f: 1 | 2,
  ) => boolean
  collectPoolCandidatesByLevel: (level: 1 | 2 | 3 | 4 | 5 | 6 | 7) => PoolCandidate[]
  addArchetypeCornerBadge: (card: Container, item: ItemDef, cardW: number, iconTopY: number) => void
  getSpecialShopShownDesc: (item: ItemDef, tier: TierKey, star: 1 | 2, detailed: boolean) => string
  markHeroSameItemSynthesisChoiceTriggered: () => void
  upsertPickedSkill: (id: string) => void
  removePickedSkill: (id: string) => void
  applyEventEffect: (event: EventChoice, fromTest?: boolean) => boolean
  placeItemToInventoryOrBattle: (def: ItemDef, tier: TierKey, star: 1 | 2) => boolean
  upgradePlacedItem: (instanceId: string, zone: 'battle' | 'backpack', withFx?: boolean) => boolean
  getAllOwnedPlacedItems: () => OwnedPlacedItem[]
  collectUpgradeableOwnedPlacedItems: (zone?: 'battle' | 'backpack') => OwnedPlacedItem[]
  findFirstBattlePlace: (size: ItemSizeNorm) => { col: number; row: number } | null
  findFirstBackpackPlace: (size: ItemSizeNorm) => { col: number; row: number } | null
  refreshSkillIconBarFn: () => void
  openEventDraftPanel: () => void
  openSkillDraftPanel: (tier?: TierKey) => boolean
  openSpecialShopPanel: () => boolean
  clearBackpackSynthesisGuideArrows: () => void
  rewriteNeutralRandomPick: (item: ItemDef) => ItemDef
  canRandomNeutralItem: (item: ItemDef) => boolean
  getItemDefByCn: (nameCn: string) => ItemDef | null
  addOnePlayerLevelForTest: () => void
  isLevelQuickDraftEnabled: () => boolean
  enqueueLevelQuickDraftChoices: (
    title: string,
    choices: NeutralChoiceCandidate[],
    opts?: {
      consumePickedAsReward?: boolean
      onPicked?: (picked: NeutralChoiceCandidate) => void
    },
  ) => boolean
}

// ============================================================
// 主函数
// ============================================================

export function initPanelInstances(
  stage: Container,
  ctx: ShopSceneCtx,
  deps: PanelInitDeps,
): PanelSet {
  // ---- PVP 面板初始化 ----
  const pvpPanel = new PvpPanel(ctx)
  stage.addChild(pvpPanel)

  // ---- Settings/Debug 面板初始化 ----
  const settingsPanel = new SettingsDebugPanel(ctx, stage, {
    refreshShopUI: () => deps.refreshShopUI(),
    captureAndSave: () => saveShopStateToStorage(captureShopState(ctx)),
    refreshSkillIconBar: () => deps.refreshSkillIconBarFn(),
    hasPickedSkill: (id) => hasPickedSkill(ctx, id),
    upsertPickedSkill: (id) => deps.upsertPickedSkill(id),
    removePickedSkill: (id) => deps.removePickedSkill(id),
    applyEventEffect: (event, fromTest) => deps.applyEventEffect(event, fromTest),
    markEventSelected: (id) => markEventSelected(ctx, id),
    resetEventSelectionCounters: () => resetEventSelectionCounters(ctx),
    showHintToast: (reason, msg, color) => showHintToast(reason, msg, color, ctx),
    placeItemToInventoryOrBattle: (def, tier, star) => deps.placeItemToInventoryOrBattle(def, tier, star),
    getQualityLevelRange: (quality) => getQualityLevelRange(quality),
    levelToTierStar: (level) => levelToTierStar(level),
    getEventPoolRows: () => getEventPoolRows(),
    getSelectedEventCount: (id) => getSelectedEventCount(ctx, id),
    isEventChoiceAvailable: (event, day) => isEventChoiceAvailable(ctx, event, day),
    getPrimaryArchetype: (tags) => getPrimaryArchetype(tags),
    isNeutralArchetypeKey: (arch) => isNeutralArchetypeKey(arch),
    getAllItems: () => [...getAllItems()],
    addOnePlayerLevelForTest: () => deps.addOnePlayerLevelForTest(),
  })
  stage.addChild(settingsPanel)

  // ---- SkillDraft 面板初始化 ----
  const skillDraftPanel = new SkillDraftPanel(ctx, stage, {
    captureAndSave: () => saveShopStateToStorage(captureShopState(ctx)),
    clearSelection: () => deps.clearSelection(),
    setTransitionInputEnabled: (enabled) => deps.setTransitionInputEnabled(enabled),
    setBaseShopPrimaryButtonsVisible: (visible) => deps.setBaseShopPrimaryButtonsVisible(visible),
    applyPhaseInputLock: () => deps.applyPhaseInputLock(),
    upsertPickedSkill: (skillId) => deps.upsertPickedSkill(skillId),
    getSkillTierForDay: (day) => getSkillTierForDay(day),
    pickSkillChoices: (tier, day) => pickSkillChoices(ctx, tier, day),
    pickSkillChoicesNoOverlap: (tier, day, blocked) => pickSkillChoicesNoOverlap(ctx, tier, day, blocked),
    pickSkillChoicesExactTier: (tier, blocked) => pickSkillChoicesExactTier(ctx, tier, blocked),
    shouldShowSimpleDescriptions: () => shouldShowSimpleDescriptions(),
    isSkillDraftRerollEnabled: () => isSkillDraftRerollEnabled(),
    getDefaultSkillDetailMode: () => getDefaultSkillDetailMode(),
    showHintToast: (reason, msg, color) => showHintToast(reason, msg, color, ctx),
    resetInfoModeSelection: () => resetInfoModeSelection(ctx),
    applySellButtonState: () => deps.applySellButtonState(),
  })
  stage.addChild(skillDraftPanel)

  // ---- EventDraft 面板初始化 ----
  const eventDraftPanel = new EventDraftPanel(ctx, stage, {
    captureAndSave: () => saveShopStateToStorage(captureShopState(ctx)),
    clearSelection: () => deps.clearSelection(),
    setTransitionInputEnabled: (enabled) => deps.setTransitionInputEnabled(enabled),
    setBaseShopPrimaryButtonsVisible: (visible) => deps.setBaseShopPrimaryButtonsVisible(visible),
    applyPhaseInputLock: () => deps.applyPhaseInputLock(),
    applyEventEffect: (event, fromTest) => deps.applyEventEffect(event, fromTest),
    markEventSelected: (id) => markEventSelected(ctx, id),
    getDailyPlanRow: (day) => getDailyPlanRow(day),
    pickRandomEventDraftChoices: (day) => pickRandomEventDraftChoices(ctx, day),
    pickRandomEventDraftChoicesNoOverlap: (day, blocked) => pickRandomEventDraftChoicesNoOverlap(ctx, day, blocked),
    resolveEventDescText: (event, detailed) => resolveEventDescText(ctx, event, detailed),
    shouldShowSimpleDescriptions: () => shouldShowSimpleDescriptions(),
    isEventDraftRerollEnabled: () => isEventDraftRerollEnabled(),
    showHintToast: (reason, msg, color) => showHintToast(reason, msg, color, ctx),
  })
  stage.addChild(eventDraftPanel)

  // ---- SpecialShop 面板初始化 ----
  const specialShopPanel = new SpecialShopPanel(ctx, stage, {
    captureAndSave: () => saveShopStateToStorage(captureShopState(ctx)),
    clearSelection: () => deps.clearSelection(),
    setTransitionInputEnabled: (enabled) => deps.setTransitionInputEnabled(enabled),
    setBaseShopPrimaryButtonsVisible: (visible) => deps.setBaseShopPrimaryButtonsVisible(visible),
    applyPhaseInputLock: () => deps.applyPhaseInputLock(),
    refreshShopUI: () => deps.refreshShopUI(),
    refreshPlayerStatusUI: () => deps.refreshPlayerStatusUI(),
    showHintToast: (reason, msg, color) => showHintToast(reason, msg, color, ctx),
    checkAndPopPendingRewards: () => deps.checkAndPopPendingRewards(),
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
    markShopPurchaseDone: () => deps.markShopPurchaseDone(),
    recordNeutralItemObtained: (defId) => deps.recordNeutralItemObtained(defId),
    unlockItemToPool: (defId) => deps.unlockItemToPool(defId),
    resolveBuyPriceWithSkills: (basePrice) => resolveBuyPriceWithSkills(ctx, basePrice),
    consumeSkill15NextBuyDiscountAfterSuccess: () => consumeSkill15NextBuyDiscountAfterSuccess(ctx),
    consumeSkill30BundleAfterSuccess: (consumed) => consumeSkill30BundleAfterSuccess(ctx, consumed),
    canBuyItemUnderFirstPurchaseRule: (item) => canBuyItemUnderFirstPurchaseRule(ctx, item),
    showFirstPurchaseRuleHint: () => deps.showFirstPurchaseRuleHint(),
    findFirstBattlePlace: (size) => deps.findFirstBattlePlace(size),
    findFirstBackpackPlace: (size) => deps.findFirstBackpackPlace(size),
    shouldShowSimpleDescriptions: () => shouldShowSimpleDescriptions(),
    addArchetypeCornerBadge: (card, item, cardW, iconTopY) => deps.addArchetypeCornerBadge(card, item, cardW, iconTopY),
    ammoValueFromLineByStar: (item, tier, star, line) => ammoValueFromLineByStar(item, tier, star, line),
    rewriteNeutralRandomPick: (item) => deps.rewriteNeutralRandomPick(item),
    canRandomNeutralItem: (item) => deps.canRandomNeutralItem(item),
  })
  stage.addChild(specialShopPanel)

  // ---- NeutralItem 面板初始化 ----
  const neutralItemPanel = new NeutralItemPanel(ctx, stage, {
    captureAndSave: () => saveShopStateToStorage(captureShopState(ctx)),
    refreshShopUI: () => deps.refreshShopUI(),
    refreshPlayerStatusUI: () => deps.refreshPlayerStatusUI(),
    setTransitionInputEnabled: (enabled) => deps.setTransitionInputEnabled(enabled),
    setBaseShopPrimaryButtonsVisible: (visible) => deps.setBaseShopPrimaryButtonsVisible(visible),
    applyPhaseInputLock: () => deps.applyPhaseInputLock(),
    showHintToast: (reason, msg, color) => showHintToast(reason, msg, color, ctx),
    clearBackpackSynthesisGuideArrows: () => deps.clearBackpackSynthesisGuideArrows(),
    placeItemToInventoryOrBattle: (def, tier, star) => deps.placeItemToInventoryOrBattle(def, tier, star),
    unlockItemToPool: (defId) => deps.unlockItemToPool(defId),
    getInstanceLevel: (instanceId) => getInstanceLevel(instanceId),
    getInstanceTier: (instanceId) => getInstanceTier(instanceId),
    getInstanceTierStar: (instanceId) => getInstanceTierStar(instanceId),
    setInstanceQualityLevel: (instanceId, defId, quality, level) => setInstanceQualityLevel(instanceId, defId, quality, level),
    removeInstanceMeta: (instanceId) => removeInstanceMeta(instanceId),
    toVisualTier: (tier, star) => toVisualTier(tier, star),
    instanceToDefId,
    isBackpackDropLocked: (col, row, size) => deps.isBackpackDropLocked(col, row, size),
    isPointInItemBounds: (view, item, gx, gy) => isPointInItemBounds(view, item, gx, gy),
    getSizeCellDim: (size) => getSizeCellDim(size),
    findFirstBattlePlace: (size) => deps.findFirstBattlePlace(size),
    findFirstBackpackPlace: (size) => deps.findFirstBackpackPlace(size),
    upgradePlacedItem: (instanceId, zone, withFx) => deps.upgradePlacedItem(instanceId, zone, withFx),
    getAllOwnedPlacedItems: () => deps.getAllOwnedPlacedItems(),
    collectUpgradeableOwnedPlacedItems: (zone) => deps.collectUpgradeableOwnedPlacedItems(zone),
    applyInstanceTierVisuals: () => deps.applyInstanceTierVisuals(),
    syncShopOwnedTierRules: () => deps.syncShopOwnedTierRules(),
    refreshUpgradeHints: () => refreshUpgradeHints(ctx),
    grantSynthesisExp: (amount, from) => deps.grantSynthesisExp(amount, from),
    playTransformOrUpgradeFlashEffect: (instanceId, zone) => playTransformOrUpgradeFlashEffect(ctx, instanceId, zone),
    canTriggerHeroSameItemSynthesisChoice: () => canTriggerHeroSameItemSynthesisChoice(ctx),
    markHeroSameItemSynthesisChoiceTriggered: () => deps.markHeroSameItemSynthesisChoiceTriggered(),
    canUseSameArchetypeDiffItemStoneSynthesis: (a, b, c, d, e, f) => deps.canUseSameArchetypeDiffItemStoneSynthesis(a, b, c, d, e, f),
    canUseHeroDailyCardReroll: () => canUseHeroDailyCardReroll(ctx),
    collectPoolCandidatesByLevel: (level) => deps.collectPoolCandidatesByLevel(level),
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
    addArchetypeCornerBadge: (card, item, cardW, iconTopY) => deps.addArchetypeCornerBadge(card, item, cardW, iconTopY),
    getSpecialShopShownDesc: (item, tier, star, detailed) => deps.getSpecialShopShownDesc(item, tier, star, detailed),
    getSpecialShopSpeedTierText: (ms) => getSpecialShopSpeedTierText(ms),
    ammoValueFromLineByStar: (item, tier, star, line) => ammoValueFromLineByStar(item, tier, star, line),
    createGuideItemCard: (item, levelText, tierForFrame) => createGuideItemCard(item, levelText, tierForFrame),
    getGuideFrameTierByLevel: (levelText) => getGuideFrameTierByLevel(levelText),
    pickSkillChoicesExactTier: (tier) => pickSkillChoicesExactTier(ctx, tier),
    pickRandomEventDraftChoices: (day) => pickRandomEventDraftChoices(ctx, day),
    isLevelQuickDraftEnabled: () => deps.isLevelQuickDraftEnabled(),
    enqueueLevelQuickDraftChoices: (title, choices, opts) => deps.enqueueLevelQuickDraftChoices(title, choices, opts),
  })
  stage.addChild(neutralItemPanel)

  // ---- Synthesis 面板初始化 ----
  const synthesisPanel = new SynthesisPanel(ctx, stage, {
    captureAndSave: () => saveShopStateToStorage(captureShopState(ctx)),
    refreshShopUI: () => deps.refreshShopUI(),
    refreshPlayerStatusUI: () => deps.refreshPlayerStatusUI(),
    canUseSameArchetypeDiffItemStoneSynthesis: (a, b, c, d, e, f) => deps.canUseSameArchetypeDiffItemStoneSynthesis(a, b, c, d, e, f),
    getInstanceTier: (instanceId) => getInstanceTier(instanceId),
    getInstanceTierStar: (instanceId) => getInstanceTierStar(instanceId),
    toVisualTier: (tier, star) => toVisualTier(tier, star),
    getItemDefByCn: (nameCn) => deps.getItemDefByCn(nameCn),
  })
  stage.addChild(synthesisPanel)

  return {
    pvpPanel,
    settingsPanel,
    skillDraftPanel,
    eventDraftPanel,
    specialShopPanel,
    neutralItemPanel,
    synthesisPanel,
  }
}
