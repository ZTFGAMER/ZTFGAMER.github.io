// ============================================================
// NeutralItemPanel — 中性物品系統面板
// 從 ShopScene.ts 提取，使用 Class 方式（繼承 Container）
// 包含：
//   showNeutralChoiceOverlay（選擇 overlay，最大函數 ~394 行）
//   showMedalArchetypeChoiceOverlay（~175 行）
//   showLv7MorphSynthesisConfirmOverlay
//   applyNeutralDiscardEffect、applyNeutralStoneTargetEffect
//   buildStoneTransformChoices、rollStoneTransformCandidate
//   collectArchetypeRuleTransformCandidates、transformPlacedItemKeepLevelTo
//   tryRunHeroSameItemSynthesisChoice、tryRunSameArchetypeDiffItemStoneSynthesis
//   openEventDraftFromNeutralScroll、openSpecialShopFromNeutralScroll
//   openSkillDraftFromNeutralScrollByItem
//   refreshNeutralStoneGuideArrows、findNeutralStoneTargetWithDragProbe
//   showNeutralStoneHoverInfo
//   recordNeutralItemObtained
//   rewriteNeutralRandomPick、canRandomNeutralItem
//   collectNeutralQuickBuyCandidates、updateNeutralPseudoRandomCounterOnPurchase
//   rollLevelRewardDefIds、recordLevelRewardObtained
//   getNeutralSpecialKind（共用 utility，也 export）
//   isNeutralTargetStone、isValidNeutralStoneTarget
//   pickNeutralRandomCategoryByPool、refillNeutralRandomCategoryPool
//   getNeutralDailyRollCap
// ============================================================

import {
  Container, Graphics, Text, Sprite,
  Assets, Texture, Rectangle,
  type FederatedPointerEvent,
} from 'pixi.js'
import { getConfig, getAllItems } from '@/core/DataLoader'
import { getEventIconUrl, getItemIconUrl } from '@/core/assetPath'
import { getTierColor } from '@/config/colorPalette'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { resolveItemTierBaseStats } from '@/items/itemTierStats'
import { normalizeSize, type ItemDef, type SkillArchetype, type SkillTier } from '@/items/ItemDef'
import type { ItemSizeNorm, PlacedItem } from '@/grid/GridSystem'
import type { GridSystem } from '@/grid/GridSystem'
import type { GridZone } from '@/grid/GridZone'
import type { TierKey } from '@/shop/ShopManager'
import type { ShopSceneCtx, ToastReason, EventArchetype } from './ShopSceneContext'
import {
  parseTierName,
  getPrimaryArchetype,
  toSkillArchetype,
  isNeutralItemDef,
  getItemDefById,
  tierStarLevelIndex,
  nextTierLevel,
} from './SynthesisLogic'

import { CANVAS_W, CANVAS_H } from '@/config/layoutConstants'

// ============================================================
// 類型定義（export 供 ShopScene.ts 使用）
// ============================================================

export type NeutralSpecialKind =
  | 'upgrade_stone'
  | 'class_shift_stone'
  | 'class_morph_stone'
  | 'warrior_stone'
  | 'archer_stone'
  | 'assassin_stone'
  | 'gold_morph_stone'
  | 'diamond_morph_stone'
  | 'skill_scroll'
  | 'shop_scroll'
  | 'event_scroll'
  | 'raw_stone'
  | 'medal'
  | 'blank_scroll'
  | 'silver_chest'
  | 'golden_chest'
  | 'diamond_chest'

export type NeutralChoiceCandidate = {
  item: ItemDef
  tier: TierKey
  star: 1 | 2
}

export type SynthesisTarget = {
  instanceId: string
  zone: 'battle' | 'backpack'
}

type NeutralRandomCategory = 'stone' | 'scroll' | 'medal'

type LevelRewardStoneWeights = {
  classStone: number
  randomStone: number
  goldStone: number
  diamondStone: number
}

// ============================================================
// Callbacks interface
// ============================================================

export interface NeutralItemPanelCallbacks {
  captureAndSave: () => void
  refreshShopUI: () => void
  refreshPlayerStatusUI: () => void
  setTransitionInputEnabled: (enabled: boolean) => void
  setBaseShopPrimaryButtonsVisible: (visible: boolean) => void
  applyPhaseInputLock: () => void
  showHintToast: (reason: ToastReason, msg: string, color?: number) => void
  clearBackpackSynthesisGuideArrows: () => void

  // 物品放置
  placeItemToInventoryOrBattle: (def: ItemDef, tier: TierKey, star: 1 | 2) => boolean
  unlockItemToPool: (defId: string) => boolean

  // 實例元數據
  getInstanceLevel: (instanceId: string) => 1 | 2 | 3 | 4 | 5 | 6 | 7
  getInstanceTier: (instanceId: string) => TierKey | undefined
  getInstanceTierStar: (instanceId: string) => 1 | 2
  setInstanceQualityLevel: (instanceId: string, defId: string, quality?: TierKey, level?: number) => void
  removeInstanceMeta: (instanceId: string) => void
  toVisualTier: (tier?: TierKey, star?: 1 | 2) => string | undefined
  instanceToDefId: Map<string, string>

  // 網格工具
  isBackpackDropLocked: (col: number, row: number, size: ItemSizeNorm) => boolean
  isPointInItemBounds: (view: GridZone, item: PlacedItem, gx: number, gy: number) => boolean
  getSizeCellDim: (size: ItemSizeNorm) => { w: number; h: number }
  findFirstBattlePlace: (size: ItemSizeNorm) => { col: number; row: number } | null
  findFirstBackpackPlace: (size: ItemSizeNorm) => { col: number; row: number } | null

  // 升級/合成
  upgradePlacedItem: (instanceId: string, zone: 'battle' | 'backpack', withFx?: boolean) => boolean
  getAllOwnedPlacedItems: () => Array<{ item: PlacedItem; zone: 'battle' | 'backpack' }>
  collectUpgradeableOwnedPlacedItems: (zone?: 'battle' | 'backpack') => Array<{ item: PlacedItem; zone: 'battle' | 'backpack' }>
  applyInstanceTierVisuals: () => void
  syncShopOwnedTierRules: () => void
  refreshUpgradeHints: () => void
  grantSynthesisExp: (amount: number, from?: { instanceId: string; zone: 'battle' | 'backpack' }) => void
  playTransformOrUpgradeFlashEffect: (instanceId: string, zone: 'battle' | 'backpack') => void

  // 英雄能力
  canTriggerHeroSameItemSynthesisChoice: () => boolean
  markHeroSameItemSynthesisChoiceTriggered: () => void
  canUseSameArchetypeDiffItemStoneSynthesis: (
    sourceDefId: string, targetDefId: string,
    sourceTier: TierKey, sourceStar: 1 | 2,
    targetTier: TierKey, targetStar: 1 | 2,
  ) => boolean
  canUseHeroDailyCardReroll: () => boolean

  // 物品池
  collectPoolCandidatesByLevel: (level: 1 | 2 | 3 | 4 | 5 | 6 | 7) => Array<{
    item: ItemDef; level: 1 | 2 | 3 | 4 | 5 | 6 | 7; tier: TierKey; star: 1 | 2; price: number
  }>
  pickQualityByPseudoRandomBag: (level: 1 | 2 | 3 | 4 | 5 | 6 | 7, available: TierKey[]) => TierKey
  getMaxQuickBuyLevelForDay: (day: number) => 1 | 2 | 3 | 4 | 5 | 6 | 7
  getQuickBuyLevelWeightsByDay: (day: number) => number[]
  getUnlockPoolBuyPriceByLevel: (level: number) => number
  parseAvailableTiers: (raw: string) => TierKey[]
  compareTier: (a: TierKey, b: TierKey) => number

  // 技能/事件 draft panel 橋接
  openEventDraftPanel: () => void
  openSpecialShopPanel: () => boolean
  openSkillDraftPanel: (tier: SkillTier) => boolean

  // UI 工具
  shouldShowSimpleDescriptions: () => boolean
  addArchetypeCornerBadge: (card: Container, item: ItemDef, cardW: number, iconTopY: number) => void
  getSpecialShopShownDesc: (item: ItemDef, tier: TierKey, star: 1 | 2, detailed: boolean) => string
  getSpecialShopSpeedTierText: (ms: number) => string
  ammoValueFromLineByStar: (item: ItemDef, tier: TierKey, star: 1 | 2, line: string) => number
  createGuideItemCard: (item: ItemDef, levelText: string, tierForFrame: 'Bronze' | 'Silver' | 'Gold' | 'Diamond') => Container
  getGuideFrameTierByLevel: (levelText: string) => 'Bronze' | 'Silver' | 'Gold' | 'Diamond'
  pickSkillChoicesExactTier: (tier: SkillTier) => Array<{ id: string; name: string; archetype: SkillArchetype; desc: string; detailDesc?: string; tier: SkillTier; icon?: string }>
  pickRandomEventDraftChoices: (day: number) => Array<unknown>
}

// ============================================================
// 靜態常量
// ============================================================

const NEUTRAL_RANDOM_CAP_BY_DAY: Record<NeutralSpecialKind, number[]> = {
  upgrade_stone:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  class_shift_stone:  [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10],
  class_morph_stone:  [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10],
  warrior_stone:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  archer_stone:       [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  assassin_stone:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  gold_morph_stone:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  diamond_morph_stone:[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  skill_scroll:       [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  shop_scroll:        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  event_scroll:       [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10],
  raw_stone:          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  medal:              [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10],
  blank_scroll:       [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  silver_chest:       [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  golden_chest:       [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  diamond_chest:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
}

const NEUTRAL_DAILY_ROLL_CAP_BY_DAY: number[] = [
  0, 2, 3, 3, 4, 4, 5, 5, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
]

const NEUTRAL_RANDOM_RATIO_BUCKET_TEMPLATE: NeutralRandomCategory[] = ['stone', 'stone', 'scroll', 'scroll', 'medal']

const FIXED_LEVEL_REWARD_BASE_ITEM_IDS_BY_LEVEL: Array<string | null> = [
  'item59',
  'neutral_item_28_skill_scroll',
  'item59',
  'neutral_item_28_skill_scroll',
  'item59',
  'item62',
  'item59',
  'item62',
  'item58',
  'item63',
  'item58',
  'item63',
  'item58',
  'item58',
  'item58',
  'item58',
  'item60',
  'item60',
  'item60',
  'item60',
  'item60',
  'item60',
  'item60',
  'item60',
  'item60',
  'item60',
]

const FIXED_LEVEL_REWARD_RANDOM_STONE_COUNT_BY_LEVEL: number[] = [
  0, 0, 0, 0,
  1, 1, 1, 1,
  1, 1, 1, 1,
  2, 2, 2, 2, 2, 2,
  2, 2, 2, 2, 2, 2, 2, 2,
]

// ============================================================
// 純 utility 函數（export 供 ShopScene.ts 直接使用）
// ============================================================

export function getNeutralSpecialKind(item: ItemDef): NeutralSpecialKind | null {
  const key = String(item.name_cn || '').trim()
  if (key === '升级石') return 'upgrade_stone'
  if (key === '转职石') return 'class_shift_stone'
  if (key === '变化石') return 'class_morph_stone'
  if (key === '战士石') return 'warrior_stone'
  if (key === '弓手石') return 'archer_stone'
  if (key === '刺客石') return 'assassin_stone'
  if (key === '点金石') return 'gold_morph_stone'
  if (key === '真钻石') return 'diamond_morph_stone'
  if (key === '技能卷轴' || key === '青铜卷轴' || key === '白银卷轴' || key === '黄金卷轴') return 'skill_scroll'
  if (key === '购物卷轴') return 'shop_scroll'
  if (key === '冒险卷轴') return 'event_scroll'
  if (key === '原石') return 'raw_stone'
  if (key === '勋章') return 'medal'
  if (key === '空白卷轴') return 'blank_scroll'
  if (key === '白银宝箱') return 'silver_chest'
  if (key === '黄金宝箱') return 'golden_chest'
  if (key === '钻石宝箱') return 'diamond_chest'
  return null
}

export function isNeutralTargetStone(item: ItemDef | null | undefined): boolean {
  if (!item) return false
  const kind = getNeutralSpecialKind(item)
  return kind === 'class_shift_stone'
    || kind === 'class_morph_stone'
    || kind === 'warrior_stone'
    || kind === 'archer_stone'
    || kind === 'assassin_stone'
    || kind === 'gold_morph_stone'
    || kind === 'diamond_morph_stone'
}

export function isValidNeutralStoneTarget(sourceDef: ItemDef, targetDef: ItemDef): boolean {
  if (!isNeutralTargetStone(sourceDef)) return false
  if (isNeutralItemDef(targetDef)) return false
  const srcArch = toSkillArchetype(getPrimaryArchetype(targetDef.tags))
  if (srcArch !== 'warrior' && srcArch !== 'archer' && srcArch !== 'assassin') return false
  void getNeutralSpecialKind(sourceDef)
  return true
}

// ============================================================
// NeutralItemPanel class
// ============================================================

export class NeutralItemPanel extends Container {
  private ctx: ShopSceneCtx
  private stage: Container
  private cb: NeutralItemPanelCallbacks

  constructor(ctx: ShopSceneCtx, stage: Container, callbacks: NeutralItemPanelCallbacks) {
    super()
    this.ctx = ctx
    this.stage = stage
    this.cb = callbacks
  }

  // ============================================================
  // 公開 API — 供 ShopScene.ts 调用
  // ============================================================

  showNeutralChoiceOverlay(
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
    return this._showNeutralChoiceOverlay(this.stage, titleText, candidates, onConfirmPick, displayMode, options)
  }

  showMedalArchetypeChoiceOverlay(): boolean {
    return this._showMedalArchetypeChoiceOverlay(this.stage)
  }

  showLv7MorphSynthesisConfirmOverlay(onConfirm: () => void, onCancel?: () => void): void {
    this._showLv7MorphSynthesisConfirmOverlay(this.stage, onConfirm, onCancel)
  }

  applyNeutralDiscardEffect(source: ItemDef): boolean {
    return this._applyNeutralDiscardEffect(source, this.stage)
  }

  applyNeutralStoneTargetEffect(sourceDef: ItemDef, target: SynthesisTarget): boolean {
    return this._applyNeutralStoneTargetEffect(sourceDef, target, this.stage)
  }

  buildStoneTransformChoices(
    target: SynthesisTarget,
    rule: 'same' | 'other',
    opts?: { rollLevel?: number; displayTier?: TierKey; displayStar?: 1 | 2; choiceCount?: number },
  ): NeutralChoiceCandidate[] {
    return this._buildStoneTransformChoices(target, rule, opts)
  }

  rollStoneTransformCandidate(
    target: SynthesisTarget,
    rule: 'same' | 'other',
    opts?: { rollLevel?: number; displayTier?: TierKey; displayStar?: 1 | 2 },
  ): NeutralChoiceCandidate | null {
    return this._rollStoneTransformCandidate(target, rule, opts)
  }

  tryRunHeroSameItemSynthesisChoice(
    sourceDefId: string,
    sourceTier: TierKey,
    sourceStar: 1 | 2,
    target: SynthesisTarget,
    consumeSource: () => boolean,
  ): boolean {
    return this._tryRunHeroSameItemSynthesisChoice(this.stage, sourceDefId, sourceTier, sourceStar, target, consumeSource)
  }

  tryRunSameArchetypeDiffItemStoneSynthesis(
    sourceInstanceId: string,
    sourceDefId: string,
    sourceTier: TierKey,
    sourceStar: 1 | 2,
    target: SynthesisTarget,
    restore: () => void,
  ): boolean {
    return this._tryRunSameArchetypeDiffItemStoneSynthesis(sourceInstanceId, sourceDefId, sourceTier, sourceStar, target, restore)
  }

  refreshNeutralStoneGuideArrows(sourceDef: ItemDef | null | undefined, excludeInstanceId?: string): void {
    this._refreshNeutralStoneGuideArrows(sourceDef, excludeInstanceId)
  }

  findNeutralStoneTargetWithDragProbe(
    sourceDef: ItemDef,
    gx: number,
    gy: number,
    dragSize?: ItemSizeNorm,
  ): SynthesisTarget | null {
    return this._findNeutralStoneTargetWithDragProbe(sourceDef, gx, gy, dragSize)
  }

  showNeutralStoneHoverInfo(sourceDef: ItemDef, target: SynthesisTarget): void {
    this._showNeutralStoneHoverInfo(sourceDef, target)
  }

  recordNeutralItemObtained(defId: string): void {
    const item = getItemDefById(defId)
    if (!item || !isNeutralItemDef(item)) return
    const kind = getNeutralSpecialKind(item)
    if (!kind) return
    const prev = this.ctx.neutralObtainedCountByKind.get(kind) ?? 0
    this.ctx.neutralObtainedCountByKind.set(kind, Math.max(0, Math.round(prev + 1)))
  }

  recordLevelRewardObtained(kind: NeutralSpecialKind): void {
    const prev = this.ctx.levelRewardObtainedByKind.get(kind) ?? 0
    this.ctx.levelRewardObtainedByKind.set(kind, Math.max(0, Math.round(prev + 1)))
  }

  rewriteNeutralRandomPick(item: ItemDef): ItemDef {
    return this._rewriteNeutralRandomPick(item)
  }

  canRandomNeutralItem(item: ItemDef): boolean {
    if (!isNeutralItemDef(item)) return true
    const kind = getNeutralSpecialKind(item)
    if (!kind) return true
    return this._isNeutralKindRandomAvailable(kind)
  }

  collectNeutralQuickBuyCandidates(): Array<{ item: ItemDef; level: 1 | 2 | 3 | 4 | 5 | 6 | 7; tier: TierKey; star: 1 | 2; price: number }> {
    return []
  }

  updateNeutralPseudoRandomCounterOnPurchase(item: ItemDef): void {
    if (isNeutralItemDef(item)) {
      this.ctx.quickBuyNeutralMissStreak = 0
      return
    }
    const shopRulesCfg = (getConfig().shopRules ?? {}) as { quickBuyNeutralPseudoRandomChances?: number[] }
    const pseudoChanceSource = shopRulesCfg.quickBuyNeutralPseudoRandomChances
    const pseudoChanceRows = Array.isArray(pseudoChanceSource)
      ? pseudoChanceSource
        .map((v: number) => Math.max(0, Math.min(1, Number(v))))
        .filter((v: number) => Number.isFinite(v))
      : []
    if (pseudoChanceRows.length > 0) {
      this.ctx.quickBuyNeutralMissStreak = Math.min(this.ctx.quickBuyNeutralMissStreak + 1, pseudoChanceRows.length - 1)
    } else {
      this.ctx.quickBuyNeutralMissStreak = Math.min(this.ctx.quickBuyNeutralMissStreak + 1, 999)
    }
  }

  getNeutralDailyRollCap(day: number): number {
    return _getNeutralDailyRollCap(day)
  }

  pickNeutralRandomCategoryByPool(
    candidates: Array<{ item: ItemDef }>,
  ): NeutralRandomCategory {
    if (this.ctx.neutralRandomCategoryPool.length <= 0) this._refillNeutralRandomCategoryPool()
    const available = new Set(
      candidates
        .map((one) => _neutralRandomCategoryOfItem(one.item))
        .filter((v): v is NeutralRandomCategory => v === 'stone' || v === 'scroll' || v === 'medal'),
    )
    for (let i = 0; i < this.ctx.neutralRandomCategoryPool.length; i++) {
      const one = this.ctx.neutralRandomCategoryPool[i]!
      if (!available.has(one)) continue
      this.ctx.neutralRandomCategoryPool.splice(i, 1)
      return one
    }
    const fallback = candidates
      .map((one) => _neutralRandomCategoryOfItem(one.item))
      .find((v): v is NeutralRandomCategory => v === 'stone' || v === 'scroll' || v === 'medal')
    if (fallback) return fallback
    return 'stone'
  }

  rollLevelRewardDefIds(level: number): string[] {
    return this._rollLevelRewardDefIds(level)
  }

  transformPlacedItemKeepLevelTo(
    instanceId: string,
    zone: 'battle' | 'backpack',
    nextDef: ItemDef,
    withFx = false,
  ): boolean {
    return this._transformPlacedItemKeepLevelTo(instanceId, zone, nextDef, withFx)
  }

  // ============================================================
  // 内部实現 — 純 neutral 邏輯 helpers
  // ============================================================

  private _refillNeutralRandomCategoryPool(): void {
    this.ctx.neutralRandomCategoryPool = [...NEUTRAL_RANDOM_RATIO_BUCKET_TEMPLATE]
    for (let i = this.ctx.neutralRandomCategoryPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = this.ctx.neutralRandomCategoryPool[i]
      this.ctx.neutralRandomCategoryPool[i] = this.ctx.neutralRandomCategoryPool[j]!
      this.ctx.neutralRandomCategoryPool[j] = tmp!
    }
  }

  private _getNeutralRandomMinDay(kind: NeutralSpecialKind): number {
    const shopRulesCfg = (getConfig().shopRules ?? {}) as { quickBuyNeutralStartDay?: number }
    const defaultDay = Math.max(1, Math.round(Number(shopRulesCfg.quickBuyNeutralStartDay ?? 2) || 2))
    if (kind === 'raw_stone') return Math.max(defaultDay, 5)
    if (kind === 'blank_scroll') return Math.max(defaultDay, 5)
    return defaultDay
  }

  private _getNeutralRandomCapByDay(day: number, kind: NeutralSpecialKind): number {
    const row = NEUTRAL_RANDOM_CAP_BY_DAY[kind]
    const d = Math.max(1, Math.min(20, Math.round(day)))
    return Math.max(0, Math.round(row[d - 1] ?? row[row.length - 1] ?? 0))
  }

  private _getNeutralObtainedCount(kind: NeutralSpecialKind): number {
    return Math.max(0, Math.round(this.ctx.neutralObtainedCountByKind.get(kind) ?? 0))
  }

  private _isNeutralKindOwnCapAvailable(kind: NeutralSpecialKind): boolean {
    return this._getNeutralObtainedCount(kind) < this._getNeutralRandomCapByDay(this.ctx.currentDay, kind)
  }

  private _isNeutralKindRandomAvailable(kind: NeutralSpecialKind): boolean {
    if (this.ctx.currentDay < this._getNeutralRandomMinDay(kind)) return false
    if (!this._isNeutralKindOwnCapAvailable(kind)) return false
    if (kind === 'blank_scroll') {
      const hasAnyScrollAvailable = this._isNeutralKindOwnCapAvailable('skill_scroll')
        || this._isNeutralKindOwnCapAvailable('shop_scroll')
        || this._isNeutralKindOwnCapAvailable('event_scroll')
      if (!hasAnyScrollAvailable) return false
    }
    if (kind === 'raw_stone') {
      const hasAnyStoneAvailable = this._isNeutralKindOwnCapAvailable('upgrade_stone')
        || this._isNeutralKindOwnCapAvailable('class_shift_stone')
        || this._isNeutralKindOwnCapAvailable('class_morph_stone')
      if (!hasAnyStoneAvailable) return false
    }
    return true
  }

  private _getNeutralReplacementKindForRandom(kind: NeutralSpecialKind): NeutralSpecialKind | null {
    if (kind === 'skill_scroll' || kind === 'shop_scroll' || kind === 'event_scroll') return 'blank_scroll'
    if (
      kind === 'upgrade_stone'
      || kind === 'class_shift_stone'
      || kind === 'class_morph_stone'
      || kind === 'warrior_stone'
      || kind === 'archer_stone'
      || kind === 'assassin_stone'
      || kind === 'gold_morph_stone'
      || kind === 'diamond_morph_stone'
    ) return 'raw_stone'
    return null
  }

  private _rewriteNeutralRandomPick(item: ItemDef): ItemDef {
    if (!isNeutralItemDef(item)) return item
    const kind = getNeutralSpecialKind(item)
    if (!kind) return item

    if (kind === 'blank_scroll') {
      const scrollKinds: NeutralSpecialKind[] = ['skill_scroll', 'shop_scroll', 'event_scroll']
      const availableScrollKinds = scrollKinds.filter((k) => this._isNeutralKindRandomAvailable(k))
      if (availableScrollKinds.length === 1) {
        const only = availableScrollKinds[0]
        const onlyName = only === 'skill_scroll'
          ? '青铜卷轴'
          : only === 'shop_scroll'
            ? '购物卷轴'
            : '冒险卷轴'
        return _getItemDefByCn(onlyName) ?? item
      }
    }

    const replacementKind = this._getNeutralReplacementKindForRandom(kind)
    if (!replacementKind) return item
    if (!this._isNeutralKindRandomAvailable(replacementKind)) return item
    const replacementName = replacementKind === 'blank_scroll' ? '空白卷轴' : '原石'
    return _getItemDefByCn(replacementName) ?? item
  }

  // ---- Level reward ----

  private _getLevelRewardStoneWeights(level: number): LevelRewardStoneWeights {
    if (level <= 6) return { classStone: 0.75, randomStone: 0.25, goldStone: 0, diamondStone: 0 }
    if (level <= 10) return { classStone: 0.6, randomStone: 0.2, goldStone: 0.2, diamondStone: 0 }
    if (level <= 14) return { classStone: 0.6, randomStone: 0.1, goldStone: 0.2, diamondStone: 0.1 }
    if (level <= 18) return { classStone: 0.6, randomStone: 0.1, goldStone: 0.1, diamondStone: 0.2 }
    return { classStone: 0.6, randomStone: 0, goldStone: 0, diamondStone: 0.4 }
  }

  private _rollRandomTransformStoneDefId(weights: LevelRewardStoneWeights): string | null {
    const classWeight = Math.max(0, Number(weights.classStone) || 0)
    const randomWeight = Math.max(0, Number(weights.randomStone) || 0)
    const goldWeight = Math.max(0, Number(weights.goldStone) || 0)
    const diamondWeight = Math.max(0, Number(weights.diamondStone) || 0)
    const total = classWeight + randomWeight + goldWeight + diamondWeight
    if (total <= 0) return null

    let roll = Math.random() * total
    const category = (() => {
      roll -= classWeight
      if (roll <= 0) return 'class' as const
      roll -= randomWeight
      if (roll <= 0) return 'random' as const
      roll -= goldWeight
      if (roll <= 0) return 'gold' as const
      return 'diamond' as const
    })()

    if (category === 'class') {
      const classStoneIds = ['item64', 'item65', 'item66'].filter((id) => !!getItemDefById(id))
      if (classStoneIds.length <= 0) return null
      return classStoneIds[Math.floor(Math.random() * classStoneIds.length)] ?? null
    }
    if (category === 'random') return getItemDefById('neutral_item_27_class_morph_stone')?.id ?? null
    if (category === 'gold') return getItemDefById('item68')?.id ?? null
    return getItemDefById('item69')?.id ?? null
  }

  private _rollLevelRewardDefIds(level: number): string[] {
    const lv = Math.max(1, Math.min(26, Math.round(level)))
    const out: string[] = []

    const baseDefId = FIXED_LEVEL_REWARD_BASE_ITEM_IDS_BY_LEVEL[lv - 1]
    if (baseDefId && getItemDefById(baseDefId)) out.push(baseDefId)

    const randomStoneCount = Math.max(0, Math.round(FIXED_LEVEL_REWARD_RANDOM_STONE_COUNT_BY_LEVEL[lv - 1] ?? 0))
    if (randomStoneCount <= 0) return out

    const weights = this._getLevelRewardStoneWeights(lv)
    for (let i = 0; i < randomStoneCount; i++) {
      const one = this._rollRandomTransformStoneDefId(weights)
      if (one) out.push(one)
    }
    return out
  }

  // ---- Stone guide arrows ----

  private _collectNeutralStoneGuideIds(
    system: GridSystem | null,
    sourceDef: ItemDef,
    excludeInstanceId?: string,
  ): string[] {
    if (!system) return []
    const out: string[] = []
    for (const it of system.getAllItems()) {
      if (excludeInstanceId && it.instanceId === excludeInstanceId) continue
      const targetDef = getItemDefById(it.defId)
      if (!targetDef) continue
      if (!isValidNeutralStoneTarget(sourceDef, targetDef)) continue
      out.push(it.instanceId)
    }
    return out
  }

  private _refreshNeutralStoneGuideArrows(sourceDef: ItemDef | null | undefined, excludeInstanceId?: string): void {
    if (!this.ctx.backpackView || !this.ctx.battleView) return
    if (!sourceDef || !isNeutralTargetStone(sourceDef)) {
      this.cb.clearBackpackSynthesisGuideArrows()
      return
    }
    const backpackIds = this._collectNeutralStoneGuideIds(this.ctx.backpackSystem, sourceDef, excludeInstanceId)
    const battleIds = this._collectNeutralStoneGuideIds(this.ctx.battleSystem, sourceDef, excludeInstanceId)
    this.ctx.backpackView.setDragGuideArrows([], backpackIds, 'convert')
    this.ctx.battleView.setDragGuideArrows([], battleIds, 'convert')
  }

  private _findNeutralStoneTargetWithDragProbe(
    sourceDef: ItemDef,
    gx: number,
    gy: number,
    dragSize?: ItemSizeNorm,
  ): SynthesisTarget | null {
    const cb = this.cb
    const ctx = this.ctx

    const matchAtPointer = (
      system: GridSystem | null,
      view: GridZone | null,
      zone: 'battle' | 'backpack',
      probeY: number,
    ): SynthesisTarget | null => {
      if (!system || !view || (zone === 'backpack' && !view.visible)) return null
      for (const it of system.getAllItems()) {
        if (zone === 'backpack' && cb.isBackpackDropLocked(it.col, it.row, it.size)) continue
        const targetDef = getItemDefById(it.defId)
        if (!targetDef) continue
        if (!isValidNeutralStoneTarget(sourceDef, targetDef)) continue
        if (cb.isPointInItemBounds(view, it, gx, probeY)) return { instanceId: it.instanceId, zone }
      }
      return null
    }

    const matchByFootprint = (
      system: GridSystem | null,
      view: GridZone | null,
      zone: 'battle' | 'backpack',
      probeY: number,
    ): SynthesisTarget | null => {
      if (!dragSize || !system || !view || (zone === 'backpack' && !view.visible)) return null
      const { w, h } = cb.getSizeCellDim(dragSize)
      const cell = view.pixelToCellForItem(gx, probeY, dragSize, 0)
      if (!cell) return null
      const l = cell.col
      const r = cell.col + w
      const t = cell.row
      const b = cell.row + h
      for (const it of system.getAllItems()) {
        if (zone === 'backpack' && cb.isBackpackDropLocked(it.col, it.row, it.size)) continue
        const targetDef = getItemDefById(it.defId)
        if (!targetDef) continue
        if (!isValidNeutralStoneTarget(sourceDef, targetDef)) continue
        const d = cb.getSizeCellDim(it.size)
        const il = it.col
        const ir = it.col + d.w
        const itop = it.row
        const ib = it.row + d.h
        if (l < ir && r > il && t < ib && b > itop) return { instanceId: it.instanceId, zone }
      }
      return null
    }

    const direct =
      matchAtPointer(ctx.battleSystem, ctx.battleView, 'battle', gy)
      ?? matchAtPointer(ctx.backpackSystem, ctx.backpackView, 'backpack', gy)
      ?? matchByFootprint(ctx.battleSystem, ctx.battleView, 'battle', gy)
      ?? matchByFootprint(ctx.backpackSystem, ctx.backpackView, 'backpack', gy)
    if (direct) return direct
    const probeY = gy + (dragSize ? getDebugCfg('dragYOffset') : 0)
    if (probeY === gy) return null
    return (
      matchAtPointer(ctx.battleSystem, ctx.battleView, 'battle', probeY)
      ?? matchAtPointer(ctx.backpackSystem, ctx.backpackView, 'backpack', probeY)
      ?? matchByFootprint(ctx.battleSystem, ctx.battleView, 'battle', probeY)
      ?? matchByFootprint(ctx.backpackSystem, ctx.backpackView, 'backpack', probeY)
    )
  }

  private _showNeutralStoneHoverInfo(sourceDef: ItemDef, target: SynthesisTarget): void {
    if (!this.ctx.sellPopup || !this.ctx.shopManager) return
    const system = target.zone === 'battle' ? this.ctx.battleSystem : this.ctx.backpackSystem
    const targetItem = system?.getItem(target.instanceId)
    if (!targetItem) return
    const targetDef = getItemDefById(targetItem.defId)
    if (!targetDef) return
    const kind = getNeutralSpecialKind(sourceDef)
    if (kind !== 'class_shift_stone' && kind !== 'class_morph_stone') return
    const desc = kind === 'class_shift_stone'
      ? `拖到目标：将${targetDef.name_cn}转化为其他职业同等级物品`
      : `拖到目标：将${targetDef.name_cn}转化为本职业其他同等级物品`
    const customDisplay = {
      overrideName: `${sourceDef.name_cn}（作用于目标）`,
      lines: [desc],
      suppressStats: true,
    }
    const tier = this.cb.getInstanceTier(targetItem.instanceId)
    const star = this.cb.getInstanceTierStar(targetItem.instanceId)
    this.ctx.sellPopup.show(sourceDef, 0, 'none', this.cb.toVisualTier(tier, star), undefined, 'detailed', undefined, customDisplay)
  }

  // ---- Choice overlay helpers ----

  private _getNeutralChoiceSimpleDesc(item: ItemDef): string {
    const normalize = (raw: string): string => raw.trim().replace(/[。！!；;，,\s]+$/g, '')
    const simple = String(item.simple_desc || '').trim()
    if (simple) return normalize(simple)
    const line = (item.skills ?? []).map((s) => String(s.cn || '').trim()).find((v) => v.length > 0)
    return line ? normalize(line) : '点击查看详细效果'
  }

  private _getNeutralChoiceDetailDesc(item: ItemDef): string {
    const normalize = (raw: string): string => raw.trim().replace(/[。！!；;，,\s]+$/g, '')
    const detailByConfig = String(item.simple_desc_tiered || '').trim()
    if (detailByConfig) return normalize(detailByConfig)
    const lines = (item.skills ?? [])
      .map((s) => String(s.cn || '').trim())
      .filter((v) => v.length > 0)
    if (lines.length <= 0) return this._getNeutralChoiceSimpleDesc(item)
    return normalize(lines[0] || '') || this._getNeutralChoiceSimpleDesc(item)
  }

  // ---- showNeutralChoiceOverlay ----

  private _showNeutralChoiceOverlay(
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
    const showSimple = this.cb.shouldShowSimpleDescriptions()
    const normalizeCandidates = (list: NeutralChoiceCandidate[]) =>
      list.filter((one, idx, arr) => arr.findIndex((it) => it.item.id === one.item.id) === idx).slice(0, 3)
    const uniq = normalizeCandidates(candidates)
    if (uniq.length <= 0) return false

    this.cb.setTransitionInputEnabled(false)
    this.cb.setBaseShopPrimaryButtonsVisible(false)

    const overlay = new Container()
    overlay.zIndex = 3600
    overlay.eventMode = 'static'
    overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

    const mask = new Graphics()
    mask.rect(0, 0, CANVAS_W, CANVAS_H)
    mask.fill({ color: 0x070d1d, alpha: 0.92 })
    overlay.addChild(mask)

    const title = new Text({
      text: titleText,
      style: { fontSize: 42, fill: 0xfff2cf, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    title.anchor.set(0.5)
    title.x = CANVAS_W / 2
    title.y = 228
    overlay.addChild(title)

    const hint = new Text({
      text: '选择1个物品',
      style: { fontSize: 24, fill: 0xbcd0f2, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    hint.anchor.set(0.5)
    hint.x = CANVAS_W / 2
    hint.y = 286
    overlay.addChild(hint)

    const cardWMax = 238
    const cardH = 470 + (displayMode === 'special_shop_like' ? 120 : 0)
    const sidePadding = 16
    const gapX = uniq.length === 2 ? 40 : 12
    const maxTotalW = Math.max(0, CANVAS_W - sidePadding * 2)
    const cardW = Math.min(cardWMax, Math.floor((maxTotalW - (uniq.length - 1) * gapX) / uniq.length))
    const totalW = uniq.length * cardW + (uniq.length - 1) * gapX
    const startX = (CANVAS_W - totalW) / 2
    const cardY = 580

    const closeOverlay = (withRefresh = true) => {
      if (overlay.parent) overlay.parent.removeChild(overlay)
      overlay.destroy({ children: true })
      this.cb.setTransitionInputEnabled(true)
      this.cb.applyPhaseInputLock()
      if (withRefresh) {
        this.cb.refreshShopUI()
        this.cb.captureAndSave()
      }
    }

    let selectedIdx = uniq.length === 1 ? 0 : -1
    const redrawList: Array<() => void> = []

    uniq.forEach((cand, idx) => {
      const card = new Container()
      card.x = startX + idx * (cardW + gapX)
      card.y = cardY
      card.eventMode = 'static'
      card.cursor = 'pointer'
      card.hitArea = new Rectangle(0, 0, cardW, cardH)

      const border = new Graphics()
      border.roundRect(0, 0, cardW, cardH, 24)
      border.fill({ color: 0x18263e, alpha: 0.96 })
      border.stroke({ color: 0x7cc6ff, width: 3, alpha: 1 })
      card.addChild(border)

      const selectedFrame = new Graphics()
      selectedFrame.roundRect(3, 3, cardW - 6, cardH - 6, 22)
      selectedFrame.stroke({ color: 0xffe28a, width: 5, alpha: 1 })
      selectedFrame.visible = false
      card.addChild(selectedFrame)

      const showShopLike = displayMode === 'special_shop_like'
      const baseTier = parseTierName(cand.item.starting_tier) ?? 'Bronze'
      const levelNum = tierStarLevelIndex(cand.tier, cand.star) + 1
      let descStartY = 244

      if (showShopLike) {
        const icon = new Sprite(Texture.WHITE)
        icon.width = 132
        icon.height = 132
        icon.x = (cardW - icon.width) / 2
        icon.y = 20
        icon.alpha = 0
        card.addChild(icon)
        this.cb.addArchetypeCornerBadge(card, cand.item, cardW, icon.y)
        void Assets.load<Texture>(getItemIconUrl(cand.item.id)).then((tex) => {
          icon.texture = tex
          icon.alpha = 1
        }).catch(() => {
          // ignore load error in runtime
        })
      } else {
        const level = String(Math.max(1, Math.min(7, levelNum)))
        const icon = this.cb.createGuideItemCard(cand.item, level, this.cb.getGuideFrameTierByLevel(level))
        icon.x = Math.round((cardW - icon.width) / 2)
        icon.y = 108
        card.addChild(icon)
        this.cb.addArchetypeCornerBadge(card, cand.item, cardW, icon.y)
      }

      const name = new Text({
        text: cand.item.name_cn,
        style: { fontSize: showShopLike ? 26 : 30, fill: 0xf5f8ff, fontFamily: 'Arial', fontWeight: 'bold', wordWrap: true, wordWrapWidth: cardW - 24, align: 'center' },
      })
      name.anchor.set(0.5, 0)
      name.x = cardW / 2
      name.y = showShopLike ? 168 : 198
      card.addChild(name)

      const tierPill = new Graphics()
      if (showShopLike) {
        const tierFill = baseTier === 'Bronze'
          ? 0x7f6839
          : baseTier === 'Silver'
            ? 0x5c6678
            : baseTier === 'Gold'
              ? 0x8f6a2d
              : 0x2f5f86
        tierPill.roundRect(0, 0, 116, 38, 12)
        tierPill.fill({ color: tierFill, alpha: 0.96 })
        tierPill.stroke({ color: getTierColor(baseTier), width: 2, alpha: 0.95 })
        tierPill.x = (cardW - 116) / 2
        tierPill.y = 208
        card.addChild(tierPill)

        const tier = new Text({
          text: `${_tierCnFromTier(baseTier)}Lv${levelNum}`,
          style: { fontSize: 24, fill: 0xfff4d0, fontFamily: 'Arial', fontWeight: 'bold' },
        })
        tier.anchor.set(0.5)
        tier.x = cardW / 2
        tier.y = tierPill.y + 19
        card.addChild(tier)

        const tierStats = resolveItemTierBaseStats(cand.item, `${cand.tier}#${cand.star}`)
        const damageValue = Math.max(0, Math.round(tierStats.damage))
        const shieldValue = Math.max(0, Math.round(tierStats.shield))
        const healValue = Math.max(0, Math.round(tierStats.heal))
        const cooldownMs = Math.max(0, Math.round(tierStats.cooldownMs))
        const mainStatText = damageValue > 0
          ? `✦伤害${damageValue}`
          : shieldValue > 0
            ? `🛡护盾${shieldValue}`
            : healValue > 0
              ? `✚回血${healValue}`
              : '◈被动'
        const mainStatColor = damageValue > 0 ? 0xff7a82 : shieldValue > 0 ? 0xffd983 : healValue > 0 ? 0x73e6a6 : 0x86b8ff
        const speedText = cooldownMs > 0 ? `⏱速度${this.cb.getSpecialShopSpeedTierText(cooldownMs)}` : ''

        const ammoLine = (cand.item.skills ?? [])
          .map((s) => String(s.cn ?? '').trim())
          .find((s) => /弹药\s*[:：]\s*\d+/.test(s))
        const ammo = ammoLine ? this.cb.ammoValueFromLineByStar(cand.item, cand.tier, cand.star, ammoLine) : 0

        const statEntries: Array<{ text: string; color: number }> = [
          { text: mainStatText, color: mainStatColor },
        ]
        if (speedText) statEntries.push({ text: speedText, color: 0x70b2ff })
        if (ammo > 0) statEntries.push({ text: `◉弹药${ammo}`, color: 0xffd36b })

        const statStartY = 258
        const statGapY = 34
        for (let si = 0; si < statEntries.length; si++) {
          const entry = statEntries[si]!
          const line = new Text({
            text: entry.text,
            style: { fontSize: 24, fill: entry.color, fontFamily: 'Arial', fontWeight: 'bold' },
          })
          line.anchor.set(0.5, 0)
          line.x = cardW / 2
          line.y = statStartY + si * statGapY
          card.addChild(line)
        }

        const divider = new Graphics()
        const dividerY = statStartY + statEntries.length * statGapY + 2
        divider.moveTo(12, dividerY)
        divider.lineTo(cardW - 12, dividerY)
        divider.stroke({ color: 0x4a5f88, width: 1.5, alpha: 0.95 })
        card.addChild(divider)
        descStartY = dividerY + 14
      }

      const simpleDesc = new Text({
        text: showShopLike
          ? this.cb.getSpecialShopShownDesc(cand.item, cand.tier, cand.star, false)
          : this._getNeutralChoiceSimpleDesc(cand.item),
        style: {
          fontSize: showShopLike ? 20 : 24,
          fill: showShopLike ? 0xcad7f5 : 0xffefc8,
          fontFamily: 'Arial',
          fontWeight: showShopLike ? 'normal' : 'bold',
          wordWrap: true,
          breakWords: true,
          wordWrapWidth: cardW - (showShopLike ? 24 : 28),
          lineHeight: showShopLike ? 28 : 32,
          align: showShopLike ? 'left' : 'center',
        },
      })
      if (showShopLike) {
        simpleDesc.x = 12
        simpleDesc.y = descStartY
      } else {
        simpleDesc.anchor.set(0.5, 0)
        simpleDesc.x = cardW / 2
        simpleDesc.y = 244
      }
      card.addChild(simpleDesc)

      const detailDesc = new Text({
        text: showShopLike
          ? this.cb.getSpecialShopShownDesc(cand.item, cand.tier, cand.star, true)
          : this._getNeutralChoiceDetailDesc(cand.item),
        style: {
          fontSize: showShopLike ? 20 : 24,
          fill: showShopLike ? 0xf2f7ff : 0x9fe3b9,
          fontFamily: 'Arial',
          fontWeight: showShopLike ? 'normal' : 'bold',
          wordWrap: true,
          breakWords: true,
          wordWrapWidth: cardW - (showShopLike ? 24 : 28),
          lineHeight: showShopLike ? 28 : 32,
          align: showShopLike ? 'left' : 'center',
        },
      })
      if (showShopLike) {
        detailDesc.x = 12
        detailDesc.y = descStartY
      } else {
        detailDesc.anchor.set(0.5, 0)
        detailDesc.x = cardW / 2
        detailDesc.y = 244
      }
      detailDesc.visible = false
      card.addChild(detailDesc)

      const pick = new Text({
        text: '点击选择',
        style: { fontSize: 28, fill: 0x8fe6b2, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      pick.anchor.set(0.5)
      pick.x = cardW / 2
      pick.y = cardH - 46
      pick.visible = false
      card.addChild(pick)

      const redraw = () => {
        const selected = selectedIdx === idx
        selectedFrame.visible = selected
        simpleDesc.visible = showSimple && !selected
        detailDesc.visible = !showSimple || selected
        pick.visible = selected
      }
      redraw()
      redrawList.push(redraw)

      card.on('pointerdown', (e: FederatedPointerEvent) => {
        e.stopPropagation()
        if (selectedIdx !== idx) {
          selectedIdx = idx
          redrawList.forEach((fn) => fn())
          return
        }
        const ok = onConfirmPick
          ? onConfirmPick(cand)
          : this.cb.placeItemToInventoryOrBattle(cand.item, cand.tier, cand.star)
        if (!ok && !onConfirmPick) this.cb.showHintToast('backpack_full_buy', '上阵区和背包已满，无法获得该物品', 0xff8f8f)
        closeOverlay()
      })

      overlay.addChild(card)
    })

    const actionBtnW = 186
    const actionBtnH = 96
    const actionBtnGap = 18
    const actionBtnFontSize = 22
    const actionBtnStartX = Math.round((CANVAS_W - (actionBtnW * 3 + actionBtnGap * 2)) / 2)
    const actionBtnY = CANVAS_H - 146

    const holdBtn = new Container()
    holdBtn.x = actionBtnStartX
    holdBtn.y = actionBtnY
    holdBtn.eventMode = 'static'
    holdBtn.cursor = 'pointer'
    const holdBg = new Graphics()
    holdBg.roundRect(0, 0, actionBtnW, actionBtnH, 20)
    holdBg.fill({ color: 0x29436e, alpha: 0.94 })
    holdBg.stroke({ color: 0x84b7ff, width: 3, alpha: 0.95 })
    const holdTxt = new Text({
      text: '按住查看布局',
      style: { fontSize: actionBtnFontSize, fill: 0xeaf4ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    holdTxt.anchor.set(0.5)
    holdTxt.x = actionBtnW / 2
    holdTxt.y = actionBtnH / 2
    holdBtn.addChild(holdBg, holdTxt)

    const setHoldView = (holding: boolean): void => {
      this.cb.setBaseShopPrimaryButtonsVisible(false)
      title.visible = !holding
      mask.alpha = holding ? 0.16 : 0.92
      for (const c of overlay.children) {
        if (c === mask || c === holdBtn) continue
        c.visible = !holding
      }
    }

    holdBtn.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      setHoldView(true)
    })
    holdBtn.on('pointerup', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      setHoldView(false)
    })
    holdBtn.on('pointerupoutside', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      setHoldView(false)
    })
    overlay.addChild(holdBtn)

    const canShowRerollBtn = !!options?.onReroll
    if (canShowRerollBtn) {
      const rerollBtn = new Container()
      rerollBtn.x = actionBtnStartX + actionBtnW + actionBtnGap
      rerollBtn.y = actionBtnY
      rerollBtn.eventMode = 'static'
      rerollBtn.cursor = 'pointer'
      const rerollBg = new Graphics()
      const rerollTxt = new Text({
        text: options?.rerollBtnText || '重选1次',
        style: { fontSize: actionBtnFontSize, fill: 0x10213a, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      rerollTxt.anchor.set(0.5)
      rerollTxt.x = actionBtnW / 2
      rerollTxt.y = actionBtnH / 2
      rerollBtn.addChild(rerollBg, rerollTxt)

      const redrawRerollBtn = () => {
        const can = !!options?.onReroll && (options?.canReroll ? options.canReroll() : true)
        rerollBg.clear()
        rerollBg.roundRect(0, 0, actionBtnW, actionBtnH, 20)
        rerollBg.fill({ color: can ? 0xffd86b : 0x8a6e4b, alpha: 0.95 })
        rerollBg.stroke({ color: can ? 0xffefad : 0xb89d78, width: 3, alpha: 0.95 })
        rerollTxt.style.fill = can ? 0x10213a : 0xd7c4a8
        rerollBtn.visible = can
      }
      redrawRerollBtn()

      rerollBtn.on('pointerdown', (e: FederatedPointerEvent) => {
        e.stopPropagation()
        if (!options?.onReroll) return
        if (options?.canReroll && !options.canReroll()) return
        const next = normalizeCandidates(options.onReroll())
        if (next.length <= 0) {
          this.cb.showHintToast('backpack_full_buy', '占卜师：当前无可重选候选', 0xffb27a)
          return
        }
        options.onRerollUsed?.()
        closeOverlay(false)
        this._showNeutralChoiceOverlay(stage, titleText, next, onConfirmPick, displayMode, options)
      })

      overlay.addChild(rerollBtn)
    }

    stage.addChild(overlay)
    return true
  }

  // ---- showMedalArchetypeChoiceOverlay ----

  private _showMedalArchetypeChoiceOverlay(stage: Container): boolean {
    const choices: Array<{ archetype: EventArchetype; title: string; cardLabel: string; icon: string }> = [
      { archetype: 'warrior', title: '战士', cardLabel: '战士物品', icon: 'event4' },
      { archetype: 'archer', title: '弓手', cardLabel: '弓手物品', icon: 'event5' },
      { archetype: 'assassin', title: '刺客', cardLabel: '刺客物品', icon: 'event6' },
    ]

    this.cb.setTransitionInputEnabled(false)
    this.cb.setBaseShopPrimaryButtonsVisible(false)

    const overlay = new Container()
    overlay.zIndex = 3600
    overlay.eventMode = 'static'
    overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

    const mask = new Graphics()
    mask.rect(0, 0, CANVAS_W, CANVAS_H)
    mask.fill({ color: 0x070d1d, alpha: 0.92 })
    overlay.addChild(mask)

    const title = new Text({
      text: '获得一个物品',
      style: { fontSize: 40, fill: 0xfff2cf, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    title.anchor.set(0.5)
    title.x = CANVAS_W / 2
    title.y = 250
    overlay.addChild(title)

    const closeOverlay = () => {
      if (overlay.parent) overlay.parent.removeChild(overlay)
      overlay.destroy({ children: true })
      this.cb.setTransitionInputEnabled(true)
      this.cb.applyPhaseInputLock()
      this.cb.refreshShopUI()
      this.cb.captureAndSave()
    }

    const cardW = 184
    const cardH = 330
    const gap = 24
    const totalW = choices.length * cardW + (choices.length - 1) * gap
    const startX = (CANVAS_W - totalW) / 2
    const cardY = 520

    let selectedIdx = -1
    const redrawList: Array<() => void> = []

    choices.forEach((choice, idx) => {
      const card = new Container()
      card.x = startX + idx * (cardW + gap)
      card.y = cardY
      card.eventMode = 'static'
      card.cursor = 'pointer'
      card.hitArea = new Rectangle(0, 0, cardW, cardH)

      const bg = new Graphics()
      card.addChild(bg)

      const iconFallback = new Text({
        text: choice.title.slice(0, 1),
        style: { fontSize: 64, fill: 0xeaf4ff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      iconFallback.anchor.set(0.5)
      iconFallback.x = cardW / 2
      iconFallback.y = 116
      card.addChild(iconFallback)
      _mountEventIconSprite(card, choice.icon, choice.icon, cardW / 2, 116, 156, iconFallback)

      const name = new Text({
        text: choice.cardLabel,
        style: { fontSize: 34, fill: 0xeaf4ff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      name.anchor.set(0.5)
      name.x = cardW / 2
      name.y = 228
      card.addChild(name)

      const pick = new Text({
        text: '点击选择',
        style: { fontSize: 24, fill: 0x8fe6b2, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      pick.anchor.set(0.5)
      pick.x = cardW / 2
      pick.y = 286
      pick.visible = false
      card.addChild(pick)

      const redraw = () => {
        const selected = selectedIdx === idx
        bg.clear()
        bg.roundRect(0, 0, cardW, cardH, 20)
        bg.fill({ color: selected ? 0x223a5f : 0x18263e, alpha: 0.96 })
        bg.stroke({ color: selected ? 0xaee0ff : 0x8ec6ff, width: selected ? 4 : 3, alpha: 1 })
        pick.visible = selected
      }
      redraw()
      redrawList.push(redraw)

      card.on('pointerdown', (e: FederatedPointerEvent) => {
        e.stopPropagation()
        if (selectedIdx !== idx) {
          selectedIdx = idx
          redrawList.forEach((fn) => fn())
          return
        }
        const roll = this._pickMedalArchetypeItem(choice.archetype)
        if (!roll) {
          const baseMax = this.cb.getMaxQuickBuyLevelForDay(this.ctx.currentDay)
          const targetLevel = Math.min(7, baseMax + 2)
          this.cb.showHintToast('no_gold_buy', `勋章：该职业无Lv${targetLevel}可用物品`, 0xffb27a)
          closeOverlay()
          return
        }
        const ok = this.cb.placeItemToInventoryOrBattle(roll.item, roll.tier, roll.star)
        if (!ok) this.cb.showHintToast('backpack_full_buy', '上阵区和背包已满，无法获得该物品', 0xff8f8f)
        closeOverlay()
      })

      overlay.addChild(card)
    })

    const actionBtnW = 186
    const actionBtnH = 96
    const actionBtnGap = 18
    const actionBtnFontSize = 22
    const actionBtnStartX = Math.round((CANVAS_W - (actionBtnW * 3 + actionBtnGap * 2)) / 2)
    const actionBtnY = CANVAS_H - 146

    const holdBtn = new Container()
    holdBtn.x = actionBtnStartX
    holdBtn.y = actionBtnY
    holdBtn.eventMode = 'static'
    holdBtn.cursor = 'pointer'
    const holdBg = new Graphics()
    holdBg.roundRect(0, 0, actionBtnW, actionBtnH, 20)
    holdBg.fill({ color: 0x29436e, alpha: 0.94 })
    holdBg.stroke({ color: 0x84b7ff, width: 3, alpha: 0.95 })
    const holdTxt = new Text({
      text: '按住查看布局',
      style: { fontSize: actionBtnFontSize, fill: 0xeaf4ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    holdTxt.anchor.set(0.5)
    holdTxt.x = actionBtnW / 2
    holdTxt.y = actionBtnH / 2
    holdBtn.addChild(holdBg, holdTxt)

    const setHoldView = (holding: boolean): void => {
      this.cb.setBaseShopPrimaryButtonsVisible(false)
      title.visible = !holding
      mask.alpha = holding ? 0.16 : 0.92
      for (const c of overlay.children) {
        if (c === mask || c === holdBtn) continue
        c.visible = !holding
      }
    }

    holdBtn.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      setHoldView(true)
    })
    holdBtn.on('pointerup', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      setHoldView(false)
    })
    holdBtn.on('pointerupoutside', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      setHoldView(false)
    })
    overlay.addChild(holdBtn)

    stage.addChild(overlay)
    return true
  }

  // ---- Medal archetype item pick ----

  private _pickArchetypeItemAtLevel(
    archetype: EventArchetype,
    level: 1 | 2 | 3 | 4 | 5 | 6 | 7,
  ): { item: ItemDef; level: 1 | 2 | 3 | 4 | 5 | 6 | 7; tier: TierKey; star: 1 | 2; price: number } | null {
    const pool = this.cb.collectPoolCandidatesByLevel(level)
      .filter((c) => toSkillArchetype(getPrimaryArchetype(c.item.tags)) === archetype)
    if (pool.length <= 0) return null
    return pool[Math.floor(Math.random() * pool.length)] ?? null
  }

  private _pickMedalArchetypeItem(
    archetype: EventArchetype,
  ): { item: ItemDef; tier: TierKey; star: 1 | 2 } | null {
    const baseMax = this.cb.getMaxQuickBuyLevelForDay(this.ctx.currentDay)
    const targetLevel = Math.min(7, baseMax + 2) as 1 | 2 | 3 | 4 | 5 | 6 | 7
    return this._pickArchetypeItemAtLevel(archetype, targetLevel)
  }

  // ---- Lv7 morph confirm overlay ----

  private _showLv7MorphSynthesisConfirmOverlay(
    stage: Container,
    onConfirm: () => void,
    onCancel?: () => void,
  ): void {
    this.cb.setTransitionInputEnabled(false)
    this.cb.setBaseShopPrimaryButtonsVisible(false)

    const overlay = new Container()
    overlay.zIndex = 3600
    overlay.eventMode = 'static'
    overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

    const mask = new Graphics()
    mask.rect(0, 0, CANVAS_W, CANVAS_H)
    mask.fill({ color: 0x070d1d, alpha: 0.92 })
    overlay.addChild(mask)

    const panel = new Graphics()
    const panelW = 548
    const panelH = 390
    panel.roundRect((CANVAS_W - panelW) / 2, 430, panelW, panelH, 24)
    panel.fill({ color: 0x13233d, alpha: 0.98 })
    panel.stroke({ color: 0x79b6ff, width: 3, alpha: 0.98 })
    overlay.addChild(panel)

    const title = new Text({
      text: 'Lv7顶级转化确认',
      style: { fontSize: 42, fill: 0xfff2cf, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    title.anchor.set(0.5)
    title.x = CANVAS_W / 2
    title.y = 500
    overlay.addChild(title)

    const desc = new Text({
      text: '将消耗两个Lv7物品，并触发变化石效果\n从同职业Lv7候选中选择1个进行转化',
      style: { fontSize: 28, fill: 0xcfe2ff, fontFamily: 'Arial', fontWeight: 'bold', align: 'center', lineHeight: 40 },
    })
    desc.anchor.set(0.5)
    desc.x = CANVAS_W / 2
    desc.y = 610
    overlay.addChild(desc)

    const closeOverlay = (confirmed: boolean) => {
      if (overlay.parent) overlay.parent.removeChild(overlay)
      overlay.destroy({ children: true })
      this.cb.setTransitionInputEnabled(true)
      this.cb.applyPhaseInputLock()
      if (confirmed) onConfirm()
      else onCancel?.()
    }

    const confirmBtn = new Container()
    confirmBtn.eventMode = 'static'
    confirmBtn.cursor = 'pointer'
    confirmBtn.x = CANVAS_W / 2 - 108
    confirmBtn.y = 742
    const confirmBg = new Graphics()
    confirmBg.roundRect(0, 0, 216, 74, 16)
    confirmBg.fill({ color: 0x6dd3ff, alpha: 0.96 })
    confirmBg.stroke({ color: 0xb8e8ff, width: 3, alpha: 1 })
    const confirmTxt = new Text({
      text: '确认转化',
      style: { fontSize: 30, fill: 0x10203a, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    confirmTxt.anchor.set(0.5)
    confirmTxt.x = 108
    confirmTxt.y = 37
    confirmBtn.addChild(confirmBg, confirmTxt)
    confirmBtn.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      closeOverlay(true)
    })
    overlay.addChild(confirmBtn)

    const cancelBtn = new Container()
    cancelBtn.eventMode = 'static'
    cancelBtn.cursor = 'pointer'
    cancelBtn.x = CANVAS_W / 2 - 108
    cancelBtn.y = 826
    const cancelBg = new Graphics()
    cancelBg.roundRect(0, 0, 216, 74, 16)
    cancelBg.fill({ color: 0x25344d, alpha: 0.9 })
    cancelBg.stroke({ color: 0x5d7597, width: 3, alpha: 1 })
    const cancelTxt = new Text({
      text: '取消',
      style: { fontSize: 30, fill: 0xc9d6ef, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    cancelTxt.anchor.set(0.5)
    cancelTxt.x = 108
    cancelTxt.y = 37
    cancelBtn.addChild(cancelBg, cancelTxt)
    cancelBtn.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      closeOverlay(false)
    })
    overlay.addChild(cancelBtn)

    overlay.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      closeOverlay(false)
    })

    stage.addChild(overlay)
  }

  // ---- Tier chest candidates ----

  private _buildTierChestChoiceCandidates(tier: TierKey): NeutralChoiceCandidate[] {
    const allTierNonNeutral = getAllItems()
      .filter((it) => !isNeutralItemDef(it))
      .filter((it) => this.cb.parseAvailableTiers(it.available_tiers).includes(tier))

    const byArchetype = new Map<SkillArchetype, ItemDef[]>()
    for (const item of allTierNonNeutral) {
      const archetype = toSkillArchetype(getPrimaryArchetype(item.tags))
      if (archetype !== 'warrior' && archetype !== 'archer' && archetype !== 'assassin') continue
      const arr = byArchetype.get(archetype) ?? []
      arr.push(item)
      byArchetype.set(archetype, arr)
    }

    const picks: ItemDef[] = []
    const usedDef = new Set<string>()
    const archetypes = Array.from(byArchetype.keys())

    for (let i = archetypes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = archetypes[i]
      archetypes[i] = archetypes[j]!
      archetypes[j] = tmp!
    }

    for (const arch of archetypes) {
      if (picks.length >= 3) break
      const pool = byArchetype.get(arch) ?? []
      const one = pool[Math.floor(Math.random() * pool.length)]
      if (!one || usedDef.has(one.id)) continue
      usedDef.add(one.id)
      picks.push(one)
    }

    if (picks.length < 3) {
      const fallback = [...allTierNonNeutral]
      for (let i = fallback.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const tmp = fallback[i]
        fallback[i] = fallback[j]!
        fallback[j] = tmp!
      }
      for (const one of fallback) {
        if (picks.length >= 3) break
        if (usedDef.has(one.id)) continue
        usedDef.add(one.id)
        picks.push(one)
      }
    }

    return picks.slice(0, 3).map((item) => ({ item, tier, star: 1 as const }))
  }

  // ---- applyNeutralDiscardEffect ----

  private _applyNeutralDiscardEffect(source: ItemDef, stage: Container): boolean {
    const kind = getNeutralSpecialKind(source)
    if (!kind) return false

    if (kind === 'upgrade_stone') {
      const nonNeutralCount = this.cb.getAllOwnedPlacedItems().filter((it) => {
        const def = getItemDefById(it.item.defId)
        return !!def && !isNeutralItemDef(def)
      }).length
      if (nonNeutralCount < 5) {
        this.cb.showHintToast('no_gold_buy', '升级石：非中立物品不足5个，丢弃失败', 0xffb27a)
        return false
      }
      const targets = this.cb.collectUpgradeableOwnedPlacedItems()
      const picked = targets[Math.floor(Math.random() * targets.length)]
      if (!picked) {
        this.cb.showHintToast('no_gold_buy', '升级石：没有可升级的目标', 0xffb27a)
        return true
      }
      const ok = this.cb.upgradePlacedItem(picked.item.instanceId, picked.zone, true)
      if (ok) this.cb.showHintToast('no_gold_buy', '升级石：已升级1个随机物品', 0x9be5ff)
      return true
    }

    if (isNeutralTargetStone(source)) return true

    if (kind === 'skill_scroll') {
      const ok = this._openSkillDraftFromNeutralScrollByItem(stage, source)
      if (!ok) this.cb.showHintToast('no_gold_buy', '技能卷轴：当前无法打开技能选择', 0xffb27a)
      return true
    }
    if (kind === 'shop_scroll') {
      const ok = this._openSpecialShopFromNeutralScroll(stage)
      if (!ok) this.cb.showHintToast('no_gold_buy', '购物卷轴：当前无法打开折扣商店', 0xffb27a)
      return true
    }
    if (kind === 'event_scroll') {
      const ok = this._openEventDraftFromNeutralScroll(stage)
      if (!ok) this.cb.showHintToast('no_gold_buy', '冒险卷轴：当前无法打开事件选择', 0xffb27a)
      return true
    }
    if (kind === 'raw_stone') {
      const picks = _pickCandidateItemsByNames(['升级石', '转职石', '变化石'])
        .filter((item) => {
          const oneKind = getNeutralSpecialKind(item)
          return oneKind ? this._isNeutralKindRandomAvailable(oneKind) : true
        })
        .map((item) => ({ item, tier: 'Bronze' as TierKey, star: 1 as const }))
      if (picks.length <= 0) {
        this.cb.showHintToast('no_gold_buy', '原石：当前无可选物品', 0xffb27a)
        return true
      }
      const ok = this._showNeutralChoiceOverlay(stage, '选择一块石头', picks)
      if (!ok) this.cb.showHintToast('no_gold_buy', '原石：当前无可选物品', 0xffb27a)
      return true
    }
    if (kind === 'blank_scroll') {
      const picks = _pickCandidateItemsByNames(['青铜卷轴', '购物卷轴', '冒险卷轴'])
        .filter((item) => {
          const oneKind = getNeutralSpecialKind(item)
          return oneKind ? this._isNeutralKindRandomAvailable(oneKind) : true
        })
        .map((item) => ({ item, tier: 'Bronze' as TierKey, star: 1 as const }))
      if (picks.length <= 0) {
        this.cb.showHintToast('no_gold_buy', '空白卷轴：当前无可选物品', 0xffb27a)
        return true
      }
      const ok = this._showNeutralChoiceOverlay(stage, '选择一张卷轴', picks)
      if (!ok) this.cb.showHintToast('no_gold_buy', '空白卷轴：当前无可选物品', 0xffb27a)
      return true
    }
    if (kind === 'medal') {
      const ok = this._showMedalArchetypeChoiceOverlay(stage)
      if (!ok) this.cb.showHintToast('no_gold_buy', '勋章：当前无法打开职业选择', 0xffb27a)
      return true
    }

    if (kind === 'silver_chest') {
      const picks = this._buildTierChestChoiceCandidates('Silver')
      if (picks.length <= 0) {
        this.cb.showHintToast('no_gold_buy', '白银宝箱：当前无可选白银物品', 0xffb27a)
        return true
      }
      const ok = this._showNeutralChoiceOverlay(stage, '白银宝箱：选择白银物品', picks, undefined, 'special_shop_like')
      if (!ok) this.cb.showHintToast('no_gold_buy', '白银宝箱：当前无可选白银物品', 0xffb27a)
      return true
    }

    if (kind === 'golden_chest') {
      const picks = this._buildTierChestChoiceCandidates('Gold')
      if (picks.length <= 0) {
        this.cb.showHintToast('no_gold_buy', '黄金宝箱：当前无可选黄金物品', 0xffb27a)
        return true
      }
      const ok = this._showNeutralChoiceOverlay(stage, '黄金宝箱：选择黄金物品', picks, undefined, 'special_shop_like')
      if (!ok) this.cb.showHintToast('no_gold_buy', '黄金宝箱：当前无可选黄金物品', 0xffb27a)
      return true
    }

    if (kind === 'diamond_chest') {
      const picks = this._buildTierChestChoiceCandidates('Diamond')
      if (picks.length <= 0) {
        this.cb.showHintToast('no_gold_buy', '钻石宝箱：当前无可选钻石物品', 0xffb27a)
        return true
      }
      const ok = this._showNeutralChoiceOverlay(stage, '钻石宝箱：选择钻石物品', picks, undefined, 'special_shop_like')
      if (!ok) this.cb.showHintToast('no_gold_buy', '钻石宝箱：当前无可选钻石物品', 0xffb27a)
      return true
    }

    return false
  }

  // ---- Scroll open helpers ----

  private _openEventDraftFromNeutralScroll(_stage: Container): boolean {
    const choices = this.cb.pickRandomEventDraftChoices(this.ctx.currentDay).slice(0, 2)
    if (choices.length < 2) return false
    this.ctx.pendingEventDraft = { day: this.ctx.currentDay, choices: choices as never[], rerolled: false }
    this.cb.openEventDraftPanel()
    return true
  }

  private _openSpecialShopFromNeutralScroll(_stage: Container): boolean {
    return this.cb.openSpecialShopPanel()
  }

  private _getNeutralSkillTierByItem(item: ItemDef): SkillTier {
    const tier = parseTierName(item.starting_tier) ?? 'Bronze'
    if (tier === 'Silver') return 'silver'
    if (tier === 'Gold' || tier === 'Diamond') return 'gold'
    return 'bronze'
  }

  private _openSkillDraftFromNeutralScrollByItem(_stage: Container, source: ItemDef): boolean {
    const tier = this._getNeutralSkillTierByItem(source)
    const choices = this.cb.pickSkillChoicesExactTier(tier).slice(0, 2)
    if (choices.length < 2) return false
    this.ctx.pendingSkillDraft = { day: this.ctx.currentDay, tier, choices: choices as never[], rerolled: false, fixedTier: true }
    return this.cb.openSkillDraftPanel(tier)
  }

  // ---- Stone transform ----

  private _collectArchetypeRuleTransformCandidates(
    instanceId: string,
    zone: 'battle' | 'backpack',
    rule: 'same' | 'other',
    minBaseTier?: TierKey,
  ): ItemDef[] {
    const system = zone === 'battle' ? this.ctx.battleSystem : this.ctx.backpackSystem
    const placed = system?.getItem(instanceId)
    if (!placed) return []
    const srcDef = getItemDefById(placed.defId)
    if (!srcDef || isNeutralItemDef(srcDef)) return []
    const srcArch = toSkillArchetype(getPrimaryArchetype(srcDef.tags))
    if (srcArch !== 'warrior' && srcArch !== 'archer' && srcArch !== 'assassin') return []
    return getAllItems()
      .filter((it) => it.id !== placed.defId)
      .filter((it) => !isNeutralItemDef(it))
      .filter((it) => normalizeSize(it.size) === placed.size)
      .filter((it) => {
        if (!minBaseTier) return true
        const tier = parseTierName(it.starting_tier) ?? 'Bronze'
        return this.cb.compareTier(tier, minBaseTier) >= 0
      })
      .filter((it) => {
        const arch = toSkillArchetype(getPrimaryArchetype(it.tags))
        if (arch !== 'warrior' && arch !== 'archer' && arch !== 'assassin') return false
        return rule === 'same' ? arch === srcArch : arch !== srcArch
      })
  }

  private _transformPlacedItemKeepLevelTo(
    instanceId: string,
    zone: 'battle' | 'backpack',
    nextDef: ItemDef,
    withFx = false,
  ): boolean {
    const system = zone === 'battle' ? this.ctx.battleSystem : this.ctx.backpackSystem
    const view = zone === 'battle' ? this.ctx.battleView : this.ctx.backpackView
    if (!system || !view) return false
    const placed = system.getItem(instanceId)
    if (!placed) return false
    if (normalizeSize(nextDef.size) !== placed.size) return false
    const level = this.cb.getInstanceLevel(instanceId)
    const legacy = _levelToTierStar(level)
    const tier = legacy?.tier ?? 'Bronze'
    const star = legacy?.star ?? 1
    system.remove(instanceId)
    if (!system.place(placed.col, placed.row, placed.size, nextDef.id, instanceId)) {
      system.place(placed.col, placed.row, placed.size, placed.defId, instanceId)
      return false
    }
    view.removeItem(instanceId)
    void view.addItem(instanceId, nextDef.id, placed.size, placed.col, placed.row, this.cb.toVisualTier(tier, star)).then(() => {
      const visualTier = this.cb.getInstanceTier(instanceId) ?? tier
      const visualStar = this.cb.getInstanceTierStar(instanceId)
      view.setItemTier(instanceId, this.cb.toVisualTier(visualTier, visualStar))
      this.ctx.drag?.refreshZone(view)
    })
    this.cb.instanceToDefId.set(instanceId, nextDef.id)
    this.cb.setInstanceQualityLevel(instanceId, nextDef.id, parseTierName(nextDef.starting_tier) ?? 'Bronze', level)
    this.cb.unlockItemToPool(nextDef.id)
    if (withFx) this.cb.playTransformOrUpgradeFlashEffect(instanceId, zone)
    return true
  }

  private _buildStoneTransformChoices(
    target: SynthesisTarget,
    rule: 'same' | 'other',
    opts?: { rollLevel?: number; displayTier?: TierKey; displayStar?: 1 | 2; choiceCount?: number },
  ): NeutralChoiceCandidate[] {
    const targetTier = this.cb.getInstanceTier(target.instanceId) ?? 'Bronze'
    const targetLevel = this.cb.getInstanceLevel(target.instanceId)
    const targetStar = this.cb.getInstanceTierStar(target.instanceId)
    const rollLevel = Math.max(1, Math.min(7, Math.round(opts?.rollLevel ?? targetLevel))) as 1 | 2 | 3 | 4 | 5 | 6 | 7
    const displayTier = opts?.displayTier ?? targetTier
    const displayStar = opts?.displayStar ?? targetStar
    const choiceCount = Math.max(1, Math.min(3, Math.round(opts?.choiceCount ?? 2)))
    const poolAllTier = this._collectArchetypeRuleTransformCandidates(target.instanceId, target.zone, rule)
    const picked: ItemDef[] = []
    let remaining = [...poolAllTier]
    for (let i = 0; i < choiceCount && remaining.length > 0; i++) {
      const availableTiers = Array.from(new Set(remaining.map((it) => parseTierName(it.starting_tier) ?? 'Bronze')))
      const selectedTier = availableTiers.length > 0
        ? this.cb.pickQualityByPseudoRandomBag(rollLevel, availableTiers)
        : null
      const tierPool = selectedTier
        ? remaining.filter((it) => (parseTierName(it.starting_tier) ?? 'Bronze') === selectedTier)
        : remaining
      const one = _pickRandomElements(tierPool.length > 0 ? tierPool : remaining, 1)[0]
      if (!one) break
      picked.push(one)
      remaining = remaining.filter((it) => it.id !== one.id)
    }
    return picked.map((item) => ({ item, tier: displayTier, star: displayStar }))
  }

  private _rollStoneTransformCandidate(
    target: SynthesisTarget,
    rule: 'same' | 'other',
    opts?: { rollLevel?: number; displayTier?: TierKey; displayStar?: 1 | 2 },
  ): NeutralChoiceCandidate | null {
    const targetTier = this.cb.getInstanceTier(target.instanceId) ?? 'Bronze'
    const targetLevel = this.cb.getInstanceLevel(target.instanceId)
    const targetStar = this.cb.getInstanceTierStar(target.instanceId)
    const rollLevel = Math.max(1, Math.min(7, Math.round(opts?.rollLevel ?? targetLevel))) as 1 | 2 | 3 | 4 | 5 | 6 | 7
    const displayTier = opts?.displayTier ?? targetTier
    const displayStar = opts?.displayStar ?? targetStar
    const poolAllTier = this._collectArchetypeRuleTransformCandidates(target.instanceId, target.zone, rule)
    if (poolAllTier.length <= 0) return null
    const availableTiers = Array.from(new Set(poolAllTier.map((it) => parseTierName(it.starting_tier) ?? 'Bronze')))
    const pickedTier = availableTiers.length > 0 ? this.cb.pickQualityByPseudoRandomBag(rollLevel, availableTiers) : null
    const pool = pickedTier
      ? poolAllTier.filter((it) => (parseTierName(it.starting_tier) ?? 'Bronze') === pickedTier)
      : poolAllTier
    const picked = _pickRandomElements(pool, 1)[0]
    if (!picked) return null
    return { item: picked, tier: displayTier, star: displayStar }
  }

  // ---- applyNeutralStoneTargetEffect ----

  private _applyNeutralStoneTargetEffect(sourceDef: ItemDef, target: SynthesisTarget, stage: Container): boolean {
    const kind = getNeutralSpecialKind(sourceDef)
    if (!kind) return false
    if (!isNeutralTargetStone(sourceDef)) return false
    const system = target.zone === 'battle' ? this.ctx.battleSystem : this.ctx.backpackSystem
    const placed = system?.getItem(target.instanceId)
    if (!placed) return false
    const targetLevel = this.cb.getInstanceLevel(target.instanceId)
    const minLevelByKind: Partial<Record<NeutralSpecialKind, number>> = {
      warrior_stone: 2,
      archer_stone: 2,
      assassin_stone: 2,
      gold_morph_stone: 4,
      diamond_morph_stone: 6,
    }
    const minLevel = minLevelByKind[kind] ?? 1
    if (targetLevel < minLevel) {
      this.cb.showHintToast('no_gold_buy', `${sourceDef.name_cn}：该目标等级太低，无法转化`, 0xffb27a)
      return false
    }
    const targetDef = getItemDefById(placed.defId)
    if (!targetDef || !isValidNeutralStoneTarget(sourceDef, targetDef)) return false

    const targetArch = toSkillArchetype(getPrimaryArchetype(targetDef.tags))
    if (targetArch !== 'warrior' && targetArch !== 'archer' && targetArch !== 'assassin') return false

    const titleByKind: Partial<Record<NeutralSpecialKind, string>> = {
      class_shift_stone: '选择转职方向',
      class_morph_stone: '选择变化方向',
      warrior_stone: '选择战士方向',
      archer_stone: '选择弓手方向',
      assassin_stone: '选择刺客方向',
      gold_morph_stone: '选择黄金方向',
      diamond_morph_stone: '选择钻石方向',
    }
    const title = titleByKind[kind] ?? '选择变化方向'

    const buildChoices = (): NeutralChoiceCandidate[] => {
      if (kind === 'gold_morph_stone' || kind === 'diamond_morph_stone') {
        const targetTier = kind === 'gold_morph_stone' ? 'Gold' : 'Diamond'
        const lvTierStar = _levelToTierStar(targetLevel)
        const displayTier = lvTierStar?.tier ?? 'Bronze'
        const displayStar = lvTierStar?.star ?? 1
        const filteredDirect = getAllItems()
          .filter((it) => !isNeutralItemDef(it))
          .filter((it) => normalizeSize(it.size) === placed.size)
          .filter((it) => it.id !== placed.defId)
          .filter((it) => (parseTierName(it.starting_tier) ?? 'Bronze') === targetTier)
        return _pickRandomElements(filteredDirect, 3).map((one) => ({ item: one, tier: displayTier, star: displayStar }))
      }

      const lvTierStar = _levelToTierStar(targetLevel)
      const displayTier = lvTierStar?.tier ?? 'Bronze'
      const displayStar = lvTierStar?.star ?? 1
      const picks: NeutralChoiceCandidate[] = []
      const usedIds = new Set<string>([placed.defId])

      const passKindFilter = (item: ItemDef): boolean => {
        const arch = toSkillArchetype(getPrimaryArchetype(item.tags))
        if (arch !== 'warrior' && arch !== 'archer' && arch !== 'assassin') return false
        if (kind === 'class_shift_stone') return arch !== targetArch
        if (kind === 'class_morph_stone') return true
        if (kind === 'warrior_stone') return arch === 'warrior'
        if (kind === 'archer_stone') return arch === 'archer'
        if (kind === 'assassin_stone') return arch === 'assassin'
        return false
      }

      let remaining = getAllItems()
        .filter((it) => !isNeutralItemDef(it))
        .filter((it) => normalizeSize(it.size) === placed.size)
        .filter((it) => !usedIds.has(it.id))
        .filter(passKindFilter)

      for (let attempt = 0; attempt < 120 && picks.length < 3; attempt++) {
        if (remaining.length <= 0) break
        const availableTiers = Array.from(new Set(remaining.map((it) => parseTierName(it.starting_tier) ?? 'Bronze')))
        const selectedTier = availableTiers.length > 0 ? this.cb.pickQualityByPseudoRandomBag(targetLevel, availableTiers) : null
        const tierPool = selectedTier
          ? remaining.filter((it) => (parseTierName(it.starting_tier) ?? 'Bronze') === selectedTier)
          : remaining
        const pickedItem = _pickRandomElements(tierPool.length > 0 ? tierPool : remaining, 1)[0]
        if (!pickedItem) break
        picks.push({ item: pickedItem, tier: displayTier, star: displayStar })
        usedIds.add(pickedItem.id)
        remaining = remaining.filter((it) => !usedIds.has(it.id))
      }
      return picks
    }

    const choices = buildChoices()
    if (choices.length < 3) {
      this.cb.showHintToast('no_gold_buy', `${sourceDef.name_cn}：该目标当前无法转化`, 0xffb27a)
      return false
    }

    return this._showNeutralChoiceOverlay(stage, title, choices, (picked) => {
      const ok = this._transformPlacedItemKeepLevelTo(target.instanceId, target.zone, picked.item, true)
      if (!ok) {
        this.cb.showHintToast('no_gold_buy', `${sourceDef.name_cn}：该目标当前无法转化`, 0xffb27a)
        return false
      }
      this.cb.showHintToast('no_gold_buy', `${sourceDef.name_cn}：已转化目标物品`, 0x9be5ff)
      return true
    }, 'special_shop_like')
  }

  // ---- Hero synthesis choices ----

  private _tryRunHeroSameItemSynthesisChoice(
    stage: Container,
    sourceDefId: string,
    sourceTier: TierKey,
    sourceStar: 1 | 2,
    target: SynthesisTarget,
    consumeSource: () => boolean,
  ): boolean {
    if (!this.cb.canTriggerHeroSameItemSynthesisChoice()) return false
    const system = target.zone === 'battle' ? this.ctx.battleSystem : this.ctx.backpackSystem
    const targetItem = system?.getItem(target.instanceId)
    if (!targetItem || targetItem.defId !== sourceDefId) return false
    const upgradeTo = nextTierLevel(sourceTier, sourceStar)
    if (!upgradeTo) return false
    const nextLevel = Math.max(1, Math.min(7, tierStarLevelIndex(upgradeTo.tier, upgradeTo.star) + 1)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
    const sourceDef = getItemDefById(sourceDefId)
    if (!sourceDef) return false
    const all = this.cb.collectPoolCandidatesByLevel(nextLevel)
    const altPool = all.filter((one) => one.item.id !== sourceDefId)
    if (altPool.length <= 0) return false
    const altPicks = _pickRandomElements(altPool, 2)
    const choices: NeutralChoiceCandidate[] = [
      { item: sourceDef, tier: upgradeTo.tier, star: upgradeTo.star },
      ...altPicks.map((one) => ({ item: one.item, tier: one.tier, star: one.star })),
    ]
    const opened = this._showNeutralChoiceOverlay(stage, '戏法师：选择合成结果', choices, (picked) => {
      if (!consumeSource()) return false
      const ok = this._transformPlacedItemKeepLevelTo(target.instanceId, target.zone, picked.item, true)
      if (!ok) {
        this.cb.showHintToast('backpack_full_buy', '戏法师：转化失败', 0xff8f8f)
        return false
      }
      this.cb.setInstanceQualityLevel(target.instanceId, picked.item.id, parseTierName(picked.item.starting_tier) ?? 'Bronze', nextLevel)
      this.cb.applyInstanceTierVisuals()
      this.cb.syncShopOwnedTierRules()
      this.cb.refreshUpgradeHints()
      this.cb.markHeroSameItemSynthesisChoiceTriggered()
      this.cb.grantSynthesisExp(1, { instanceId: target.instanceId, zone: target.zone })
      this.cb.showHintToast('no_gold_buy', '戏法师：本次同物合成可选其他物品', 0x9be5ff)
      this.cb.refreshShopUI()
      return true
    }, 'special_shop_like')
    return opened
  }

  private _tryRunSameArchetypeDiffItemStoneSynthesis(
    sourceInstanceId: string,
    sourceDefId: string,
    sourceTier: TierKey,
    sourceStar: 1 | 2,
    target: SynthesisTarget,
    restore: () => void,
  ): boolean {
    if (this.cb.canUseHeroDailyCardReroll()) return false
    const system = target.zone === 'battle' ? this.ctx.battleSystem : this.ctx.backpackSystem
    const targetItem = system?.getItem(target.instanceId)
    if (!targetItem) return false
    const targetTier = this.cb.getInstanceTier(target.instanceId) ?? sourceTier
    const targetStar = this.cb.getInstanceTierStar(target.instanceId)
    if (!this.cb.canUseSameArchetypeDiffItemStoneSynthesis(sourceDefId, targetItem.defId, sourceTier, sourceStar, targetTier, targetStar)) {
      return false
    }
    const upgradeTo = nextTierLevel(sourceTier, sourceStar)
    if (!upgradeTo) return false
    const nextLevel = Math.max(1, Math.min(7, tierStarLevelIndex(upgradeTo.tier, upgradeTo.star) + 1)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
    const rolled = this._rollStoneTransformCandidate(target, 'other', {
      rollLevel: nextLevel,
      displayTier: upgradeTo.tier,
      displayStar: upgradeTo.star,
    })
    if (!rolled) {
      this.cb.showHintToast('backpack_full_buy', '同职业合成：当前无可用候选', 0xffb27a)
      restore()
      return true
    }
    const ok = this._transformPlacedItemKeepLevelTo(target.instanceId, target.zone, rolled.item, true)
    if (!ok) {
      this.cb.showHintToast('backpack_full_buy', '同职业合成：转化失败', 0xff8f8f)
      restore()
      return true
    }
    this.cb.setInstanceQualityLevel(target.instanceId, rolled.item.id, parseTierName(rolled.item.starting_tier) ?? 'Bronze', nextLevel)
    this.cb.applyInstanceTierVisuals()
    this.cb.syncShopOwnedTierRules()
    this.cb.refreshUpgradeHints()
    this.cb.removeInstanceMeta(sourceInstanceId)
    this.cb.grantSynthesisExp(1, { instanceId: target.instanceId, zone: target.zone })
    this.cb.showHintToast('no_gold_buy', `同职业合成：随机转化为${rolled.item.name_cn}`, 0x9be5ff)
    this.cb.refreshShopUI()
    return true
  }
}

// ============================================================
// 模塊級純 utility 函數（不依賴 ctx，可被模塊外直接引用）
// ============================================================

function _getNeutralDailyRollCap(day: number): number {
  const d = Math.max(1, Math.min(20, Math.round(day)))
  return Math.max(0, Math.round(NEUTRAL_DAILY_ROLL_CAP_BY_DAY[d - 1] ?? NEUTRAL_DAILY_ROLL_CAP_BY_DAY[NEUTRAL_DAILY_ROLL_CAP_BY_DAY.length - 1] ?? 0))
}

export { _getNeutralDailyRollCap as getNeutralDailyRollCap }

function _neutralRandomCategoryOfKind(kind: NeutralSpecialKind): NeutralRandomCategory | null {
  if (
    kind === 'upgrade_stone'
    || kind === 'class_shift_stone'
    || kind === 'class_morph_stone'
    || kind === 'warrior_stone'
    || kind === 'archer_stone'
    || kind === 'assassin_stone'
    || kind === 'gold_morph_stone'
    || kind === 'diamond_morph_stone'
    || kind === 'raw_stone'
  ) return 'stone'
  if (kind === 'skill_scroll' || kind === 'shop_scroll' || kind === 'event_scroll' || kind === 'blank_scroll') return 'scroll'
  if (kind === 'medal') return 'medal'
  return null
}

function _neutralRandomCategoryOfItem(item: ItemDef): NeutralRandomCategory | null {
  const kind = getNeutralSpecialKind(item)
  if (!kind) return null
  return _neutralRandomCategoryOfKind(kind)
}

export { _neutralRandomCategoryOfItem as neutralRandomCategoryOfItem }

function _getItemDefByCn(nameCn: string): ItemDef | null {
  const all = getAllItems()
  return all.find((it) => it.name_cn === nameCn) ?? null
}

function _pickCandidateItemsByNames(names: string[]): ItemDef[] {
  const all = getAllItems()
  const out: ItemDef[] = []
  for (const name of names) {
    const hit = all.find((it) => it.name_cn === name)
    if (hit) out.push(hit)
  }
  return out
}

function _pickRandomElements<T>(list: T[], count: number): T[] {
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

function _levelToTierStar(level: number): { tier: TierKey; star: 1 | 2 } | null {
  if (level === 1) return { tier: 'Bronze', star: 1 }
  if (level === 2) return { tier: 'Silver', star: 1 }
  if (level === 3) return { tier: 'Silver', star: 2 }
  if (level === 4) return { tier: 'Gold', star: 1 }
  if (level === 5) return { tier: 'Gold', star: 2 }
  if (level === 6) return { tier: 'Diamond', star: 1 }
  if (level === 7) return { tier: 'Diamond', star: 2 }
  return null
}

function _tierCnFromTier(tier: TierKey): string {
  if (tier === 'Bronze') return '铜'
  if (tier === 'Silver') return '银'
  if (tier === 'Gold') return '金'
  if (tier === 'Diamond') return '钻'
  return tier
}

function _mountEventIconSprite(
  parent: Container,
  eventId: string,
  iconStem: string | undefined,
  centerX: number,
  centerY: number,
  iconSize: number,
  fallback: Text,
): void {
  const stem = String(iconStem || eventId || '').replace(/\.png$/i, '').trim()
  if (!stem) return
  const iconUrl = getEventIconUrl(stem)
  const sprite = new Sprite(Texture.WHITE)
  sprite.anchor.set(0.5)
  sprite.x = centerX
  sprite.y = centerY
  sprite.alpha = 0
  parent.addChild(sprite)

  void Assets.load<Texture>(iconUrl).then((tex) => {
    const side = Math.round(iconSize * 0.82)
    const sw = Math.max(1, tex.width)
    const sh = Math.max(1, tex.height)
    const scale = Math.min(side / sw, side / sh)
    sprite.texture = tex
    sprite.width = Math.max(1, Math.round(sw * scale))
    sprite.height = Math.max(1, Math.round(sh * scale))
    sprite.alpha = 1
    fallback.visible = false
  }).catch(() => {
    sprite.destroy()
  })
}
