// ============================================================
// ShopSceneContext — 商店场景共享状态、类型定义与事件总线
// ============================================================
// 职责：
//   - 集中持有原 ShopScene.ts 中所有 80+ 个模块级变量
//   - 定义跨模块共享的类型
//   - 提供简易 EventBus 解耦循环依赖
//   - 提供 createShopSceneCtx() 工厂函数
// ============================================================

import {
  Container, Graphics, Text, Sprite,
  type FederatedPointerEvent,
} from 'pixi.js'
import type { ShopManager, TierKey } from '@/shop/ShopManager'
import type { ShopPanelView } from '@/shop/ui/ShopPanelView'
import type { SellPopup, ItemInfoMode } from '@/common/ui/SellPopup'
import type { GridSystem, ItemSizeNorm } from '@/common/grid/GridSystem'
import type { GridZone } from '@/common/grid/GridZone'
import type { DragController } from '@/common/grid/DragController'
import type { SkillArchetype, SkillTier } from '@/common/items/ItemDef'

// ============================================================
// 简易类型化 EventBus
// ============================================================

type EventMap = Record<string, unknown[]>

export class TypedEventBus<Events extends EventMap> {
  private _listeners = new Map<keyof Events, ((...args: unknown[]) => void)[]>()

  on<K extends keyof Events>(event: K, cb: (...args: Events[K]) => void): void {
    if (!this._listeners.has(event)) this._listeners.set(event, [])
    this._listeners.get(event)!.push(cb as (...args: unknown[]) => void)
  }

  off<K extends keyof Events>(event: K, cb: (...args: Events[K]) => void): void {
    const arr = this._listeners.get(event)
    if (arr) this._listeners.set(event, arr.filter(f => f !== cb))
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    this._listeners.get(event)?.forEach(cb => cb(...(args as unknown[])))
  }

  removeAll(): void {
    this._listeners.clear()
  }
}

// ============================================================
// 场景事件类型（面板向主场景通信用）
// ============================================================

export type ShopSceneEventMap = {
  // 面板请求主场景执行购买
  REQUEST_BUY_ITEM: [itemId: string, tier: TierKey, star: 1 | 2, price: number]
  // 请求刷新 UI
  REFRESH_SHOP_UI: []
  REFRESH_PLAYER_STATUS_UI: []
  // Toast 提示
  SHOW_TOAST: [reason: ToastReason]
  // 选择状态清除
  SELECTION_CLEARED: []
  // 日期变更
  DAY_CHANGED: [day: number]
}

// ============================================================
// 共享类型定义
// ============================================================

export type CircleBtnHandle = {
  container: Container
  redraw: (active: boolean) => void
  setCenter: (cx: number, cy: number) => void
  setLabel: (label: string) => void
  setSubLabel: (text: string) => void
}

export type SelectionState =
  | { kind: 'none' }
  | { kind: 'shop'; slotIndex: number }
  | { kind: 'battle'; instanceId: string }
  | { kind: 'backpack'; instanceId: string }

export type ToastReason =
  | 'no_gold_buy'
  | 'no_gold_refresh'
  | 'backpack_full_buy'
  | 'backpack_full_transfer'
  | 'pvp_urge'

export type PassiveResolvedStat = {
  damage: number
  shield: number
  heal: number
  burn: number
  poison: number
  multicast: number
  cooldownMs: number
  ammoCurrent: number
  ammoMax: number
}

export type StarterClass =
  | 'swordsman' | 'archer' | 'assassin'
  | 'hero1' | 'hero2' | 'hero3' | 'hero4' | 'hero5'
  | 'hero6' | 'hero7' | 'hero8' | 'hero9' | 'hero10'

export type SkillPick = {
  id: string
  name: string
  archetype: SkillArchetype
  desc: string
  detailDesc?: string
  tier: SkillTier
  icon?: string
}

export type PendingSkillDraft = {
  day: number
  tier: SkillTier
  choices: SkillPick[]
  rerolled?: boolean
  fixedTier?: boolean
}

export type EventLane = 'left' | 'right'
export type EventArchetype = 'warrior' | 'archer' | 'assassin'

export type EventChoice = {
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

export type PendingEventDraft = {
  day: number
  choices: EventChoice[]
  rerolled?: boolean
}

export type SpecialShopOffer = {
  itemId: string
  tier: TierKey
  star: 1 | 2
  basePrice: number
  price: number
  purchased: boolean
}

export type BattleStartTransitionState = {
  elapsedMs: number
  durationMs: number
  battleStartY: number
  battleTargetY: number
  backpackStartY: number
  backpackTargetY: number
  backpackStartAlpha: number
  backpackTargetAlpha: number
  buttonsStartAlpha: number
  buttonsTargetAlpha: number
}

export type PendingHeroPeriodicReward = {
  itemId: string
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7
  tier: TierKey
  star: 1 | 2
  source: string
}

export type SavedLevelQuickDraftCandidate = {
  defId: string
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7
  tier: 'Bronze' | 'Silver' | 'Gold' | 'Diamond'
  star: 1 | 2
}

export type SavedLevelQuickDraftEntry = {
  picks: SavedLevelQuickDraftCandidate[]
  title: string
}

export type SavedPlacedItem = {
  instanceId: string
  defId: string
  size: ItemSizeNorm
  col: number
  row: number
  quality?: TierKey
  level?: 1 | 2 | 3 | 4 | 5 | 6 | 7
  tier: TierKey
  tierStar: 1 | 2
  permanentDamageBonus: number
}

export type SavedShopState = {
  day: number
  gold: number
  refreshIndex: number
  pool: Array<{ itemId: string; tier: TierKey; price: number; purchased: boolean }>
  battleItems: SavedPlacedItem[]
  backpackItems: SavedPlacedItem[]
  instCounter: number
  starterClass?: StarterClass | null
  starterGranted?: boolean
  starterBattleGuideShown?: boolean
  pickedSkills?: SkillPick[]
  draftedSkillDays?: number[]
  pendingSkillDraft?: PendingSkillDraft | null
  unlockedItemIds?: string[]
  nextQuickBuyOffer?: {
    itemId: string
    tier: TierKey
    star: 1 | 2
    price: number
  } | null
  guaranteedNewUnlockTriggeredLevels?: number[]
  skill20GrantedDays?: number[]
  hasBoughtOnce?: boolean
  skill15NextBuyDiscountPrepared?: boolean
  skill15NextBuyDiscount?: boolean
  skill30BuyCounter?: number
  skill30NextBuyFree?: boolean
  quickBuyNoSynthRefreshStreak?: number
  quickBuyNeutralMissStreak?: number
  draftedEventDays?: number[]
  pendingEventDraft?: PendingEventDraft | null
  selectedEventCounts?: Array<{ id: string; count: number }>
  dayEventState?: {
    forceBuyArchetype?: 'warrior' | 'archer' | 'assassin' | null
    forceBuyRemaining?: number
    forceSynthesisArchetype?: 'warrior' | 'archer' | 'assassin' | null
    forceSynthesisRemaining?: number
    extraUpgradeRemaining?: number
    allSynthesisRandom?: boolean
  }
  futureEventState?: {
    blockedBaseIncomeDays?: number[]
    pendingGoldByDay?: Array<{ day: number; amount: number }>
    pendingBattleUpgradeByDay?: Array<{ day: number; count: number }>
  }
  draftedSpecialShopDays?: number[]
  specialShopRefreshCount?: number
  specialShopOffers?: Array<{
    itemId: string
    tier: TierKey
    star: 1 | 2
    basePrice?: number
    price: number
    purchased: boolean
  }> | null
  neutralObtainedCounts?: Array<{ kind: string; count: number }>
  neutralRandomCategoryPool?: Array<'stone' | 'scroll' | 'medal'>
  neutralDailyRollCounts?: Array<{ day: number; count: number }>
  levelRewardCategoryPool?: Array<'stone' | 'scroll' | 'medal'>
  pendingLevelRewards?: string[]
  pendingHeroPeriodicRewards?: Array<{
    itemId: string
    level: 1 | 2 | 3 | 4 | 5 | 6 | 7
    tier: TierKey
    star: 1 | 2
    source: string
  }>
  levelRewardObtainedCounts?: Array<{ kind: string; count: number }>
  heroDailyCardRerollUsedDays?: number[]
  heroFirstDiscardRewardedDays?: number[]
  heroFirstSameItemSynthesisChoiceDays?: number[]
  heroSmithStoneGrantedDays?: number[]
  heroAdventurerScrollGrantedDays?: number[]
  heroCommanderMedalGrantedDays?: number[]
  heroHeirGoldEquipGrantedDays?: number[]
  heroTycoonGoldGrantedDays?: number[]
  levelQuickDraftSavedEntries?: SavedLevelQuickDraftEntry[]
}

// ============================================================
// 上下文接口（平铺结构，便于逐步迁移）
// ============================================================

export interface ShopSceneCtx {
  // ---- EventBus ----
  events: TypedEventBus<ShopSceneEventMap>

  // ---- 核心系统 ----
  shopManager:    ShopManager    | null
  shopPanel:      ShopPanelView  | null
  sellPopup:      SellPopup      | null
  battleSystem:   GridSystem     | null
  backpackSystem: GridSystem     | null
  battleView:     GridZone       | null
  backpackView:   GridZone       | null
  drag:           DragController | null
  btnRow:         Container      | null
  showingBackpack: boolean

  // ---- 文本组件 ----
  goldText:              Text | null
  livesText:             Text | null
  trophyText:            Text | null
  refreshCostText:       Text | null
  battleZoneTitleText:   Text | null
  backpackZoneTitleText: Text | null
  dayDebugText:          Text | null
  dayPrevBtn:            Text | null
  dayNextBtn:            Text | null

  // ---- 玩家状态面板 ----
  playerStatusCon:            Container | null
  playerStatusAvatar:         Sprite    | null
  playerStatusAvatarClickHit: Graphics  | null
  playerStatusDailySkillStar: Text      | null
  playerStatusLvText:         Text      | null
  playerStatusExpBg:          Graphics  | null
  playerStatusExpBar:         Graphics  | null
  playerStatusAvatarUrl:      string

  // ---- 圆形按钮句柄 ----
  bpBtnHandle:      CircleBtnHandle | null
  refreshBtnHandle: CircleBtnHandle | null
  sellBtnHandle:    CircleBtnHandle | null
  phaseBtnHandle:   CircleBtnHandle | null

  // ---- 覆盖层 / 面板 ----
  settingsBtn:      Container | null
  settingsOverlay:  Container | null
  skillTestOverlay: Container | null
  eventTestOverlay: Container | null
  itemTestOverlay:  Container | null

  pvpPlayerListOverlay:  Container | null
  pvpWaitingPanel:       Container | null
  pvpBackpackReturnBtn:  Container | null
  pvpOpponentBadge:      Container | null
  pvpOpponentHeroLayer:  Container | null
  pvpAllPlayersLayer:    Container | null

  classSelectOverlay:        Container | null
  starterGuideOverlay:       Container | null
  skillDraftOverlay:         Container | null
  eventDraftOverlay:         Container | null
  specialShopOverlay:        Container | null
  levelQuickRewardOverlay:   Container | null
  levelQuickRewardBackdrop:  Graphics  | null
  levelQuickRewardView:      GridZone | null
  levelQuickRewardSystem:    GridSystem | null
  levelQuickRewardInstanceIds: Set<string>
  levelQuickRewardZoneAdded: boolean

  crossSynthesisConfirmOverlay:    Container                         | null
  crossSynthesisConfirmTick:       (() => void)                      | null
  crossSynthesisConfirmUnlockInput: (() => void)                     | null
  crossSynthesisConfirmAction:     (() => void)                      | null
  crossSynthesisConfirmCloseTimer: ReturnType<typeof setTimeout>     | null

  skillIconBarCon:                 Container | null
  skillDetailPopupCon:             Container | null
  skillDetailSkillId:              string    | null
  skillDetailMode:                 'simple' | 'detailed'

  specialShopCheckLayer:           Container     | null
  specialShopOverlayActionRefresh: (() => void)  | null

  dayDebugCon:       Container | null
  passiveJumpLayer:  Container | null
  unlockRevealLayer: Container | null
  restartBtn:        Container | null

  // ---- Toast ----
  hintToastCon:       Container                             | null
  hintToastBg:        Graphics                              | null
  hintToastText:      Text                                  | null
  hintToastHideTimer: ReturnType<typeof setTimeout>         | null

  // ---- 引导 / 动画 ----
  battleGuideHandCon:  Container     | null
  battleGuideHandTick: (() => void)  | null
  miniMapGfx:          Graphics      | null
  miniMapCon:          Container     | null

  flashTickFn:   (() => void) | null
  expandTickFn:  (() => void) | null
  flashOverlay:  Graphics     | null

  itemTransformFlashLastAtMs: Map<string, number>

  gridDragFlashTick:     (() => void) | null
  gridDragFlashOverlay:  Graphics     | null
  gridDragSellZoneCon:   Container    | null
  gridDragSellZoneBg:    Graphics     | null
  gridDragSellZoneText:  Text         | null

  // ---- 商店拖拽状态 ----
  shopDragFloater:   Container    | null
  shopDragSlotIdx:   number
  shopDragHiddenSlot: number
  shopDragSize:      ItemSizeNorm | null
  shopDragPointerId: number

  // ---- 拖拽标志 ----
  gridDragCanSell:       boolean
  gridDragCanToBackpack: boolean
  gridDragSellHot:       boolean
  synthHoverInfoKey:     string

  // ---- 事件监听器（析构用）----
  offDebugCfg:               (() => void)                      | null
  offPhaseChange:            (() => void)                      | null
  onStageTapHidePopup:       ((e: FederatedPointerEvent) => void) | null
  onStageShopPointerMove:    ((e: FederatedPointerEvent) => void) | null
  onStageShopPointerUp:      ((e: FederatedPointerEvent) => void) | null
  onStageShopPointerUpOutside: ((e: FederatedPointerEvent) => void) | null

  // ---- 背景图形 ----
  shopAreaBg:    Graphics | null
  backpackAreaBg: Graphics | null
  battleAreaBg:   Graphics | null

  // ---- 被动属性统计 ----
  battlePassivePrevStats:     Map<string, PassiveResolvedStat>
  battlePassiveResolvedStats: Map<string, PassiveResolvedStat>

  // ---- 解锁揭示 ----
  unlockRevealTickFn: (() => void) | null
  unlockRevealActive: boolean

  // ---- 战斗过渡 ----
  battleStartTransition:  BattleStartTransitionState | null
  pendingBattleTransition: boolean
  pendingAdvanceToNextDay: boolean

  // ---- PVP ----
  pvpReadyLocked:           boolean
  pvpUrgeCooldownSet:       Set<number>
  pendingSkillBarMoveStartAtMs: number | null

  // ---- 存档状态 ----
  savedShopState: SavedShopState | null

  // ---- 选择状态 ----
  currentSelection:  SelectionState
  selectedSellAction: (() => void) | null
  selectedInfoKey:    string       | null
  selectedInfoMode:   ItemInfoMode

  // ---- 日期 ----
  currentDay: number

  // ---- 起始职业 / 英雄 ----
  starterClass:              StarterClass | null
  starterHeroChoiceOptions:  StarterClass[]
  starterGranted:            boolean
  starterBattleGuideShown:   boolean
  hasBoughtOnce:             boolean

  // ---- 技能系统 ----
  pickedSkills:     SkillPick[]
  draftedSkillDays: number[]
  pendingSkillDraft: PendingSkillDraft | null

  // ---- 事件系统 ----
  draftedEventDays:     number[]
  pendingEventDraft:    PendingEventDraft | null
  selectedEventCountById: Map<string, number>
  dayEventState: {
    forceBuyArchetype:      EventArchetype | null
    forceBuyRemaining:      number
    forceSynthesisArchetype: EventArchetype | null
    forceSynthesisRemaining: number
    extraUpgradeRemaining:  number
    allSynthesisRandom:     boolean
  }
  blockedBaseIncomeDays:    Set<number>
  pendingGoldByDay:         Map<number, number>
  pendingBattleUpgradeByDay: Map<number, number>

  // ---- 特殊商店 ----
  draftedSpecialShopDays:       number[]
  specialShopRefreshCount:      number
  specialShopOffers:            SpecialShopOffer[]
  specialShopBackpackViewActive: boolean
  specialShopCheckedInstanceIds: Set<string>

  // ---- 英雄效果（已使用天数） ----
  skill20GrantedDays:                    Set<number>
  heroDailyCardRerollUsedDays:           Set<number>
  heroFirstDiscardRewardedDays:          Set<number>
  heroFirstSameItemSynthesisChoiceDays:  Set<number>
  heroSmithStoneGrantedDays:             Set<number>
  heroAdventurerScrollGrantedDays:       Set<number>
  heroCommanderMedalGrantedDays:         Set<number>
  heroHeirGoldEquipGrantedDays:          Set<number>
  heroTycoonGoldGrantedDays:             Set<number>

  // ---- 解锁 / 物品池 ----
  unlockedItemIds:                   Set<string>
  neutralObtainedCountByKind:        Map<string, number>
  neutralDailyRollCountByDay:        Map<number, number>
  guaranteedNewUnlockTriggeredLevels: Set<number>
  neutralRandomCategoryPool:         Array<'stone' | 'scroll' | 'medal'>
  levelRewardCategoryPool:           Array<'stone' | 'scroll' | 'medal'>
  pendingLevelRewards:               string[]
  pendingHeroPeriodicRewards:        PendingHeroPeriodicReward[]
  pendingHeroPeriodicRewardDispatching: boolean
  lockedBackpackRewardCells:         Set<string>
  levelRewardObtainedByKind:         Map<string, number>
  nextQuickBuyOffer: {
    itemId: string
    tier:   TierKey
    star:   1 | 2
    price:  number
  } | null
  levelQuickDraftSavedEntries: SavedLevelQuickDraftEntry[]

  // ---- 技能折扣状态 ----
  skill15NextBuyDiscountPrepared: boolean
  skill15NextBuyDiscount:         boolean
  skill30BuyCounter:              number
  skill30NextBuyFree:             boolean
  quickBuyNoSynthRefreshStreak:   number
  quickBuyNeutralMissStreak:      number
}

// ============================================================
// 工厂函数 — 初始值与原模块级声明保持一致
// ============================================================

export function createShopSceneCtx(): ShopSceneCtx {
  return {
    events: new TypedEventBus<ShopSceneEventMap>(),

    // 核心系统
    shopManager:    null,
    shopPanel:      null,
    sellPopup:      null,
    battleSystem:   null,
    backpackSystem: null,
    battleView:     null,
    backpackView:   null,
    drag:           null,
    btnRow:         null,
    showingBackpack: true,

    // 文本组件
    goldText:              null,
    livesText:             null,
    trophyText:            null,
    refreshCostText:       null,
    battleZoneTitleText:   null,
    backpackZoneTitleText: null,
    dayDebugText:          null,
    dayPrevBtn:            null,
    dayNextBtn:            null,

    // 玩家状态面板
    playerStatusCon:            null,
    playerStatusAvatar:         null,
    playerStatusAvatarClickHit: null,
    playerStatusDailySkillStar: null,
    playerStatusLvText:         null,
    playerStatusExpBg:          null,
    playerStatusExpBar:         null,
    playerStatusAvatarUrl:      '',

    // 按钮句柄
    bpBtnHandle:      null,
    refreshBtnHandle: null,
    sellBtnHandle:    null,
    phaseBtnHandle:   null,

    // 覆盖层
    settingsBtn:      null,
    settingsOverlay:  null,
    skillTestOverlay: null,
    eventTestOverlay: null,
    itemTestOverlay:  null,

    pvpPlayerListOverlay: null,
    pvpWaitingPanel:      null,
    pvpBackpackReturnBtn: null,
    pvpOpponentBadge:     null,
    pvpOpponentHeroLayer: null,
    pvpAllPlayersLayer:   null,

    classSelectOverlay:   null,
    starterGuideOverlay:  null,
    skillDraftOverlay:    null,
    eventDraftOverlay:    null,
    specialShopOverlay:   null,
    levelQuickRewardOverlay: null,
    levelQuickRewardBackdrop: null,
    levelQuickRewardView: null,
    levelQuickRewardSystem: null,
    levelQuickRewardInstanceIds: new Set(),
    levelQuickRewardZoneAdded: false,

    crossSynthesisConfirmOverlay:    null,
    crossSynthesisConfirmTick:       null,
    crossSynthesisConfirmUnlockInput: null,
    crossSynthesisConfirmAction:     null,
    crossSynthesisConfirmCloseTimer: null,

    skillIconBarCon:                 null,
    skillDetailPopupCon:             null,
    skillDetailSkillId:              null,
    skillDetailMode:                 'simple',

    specialShopCheckLayer:           null,
    specialShopOverlayActionRefresh: null,

    dayDebugCon:       null,
    passiveJumpLayer:  null,
    unlockRevealLayer: null,
    restartBtn:        null,

    // Toast
    hintToastCon:       null,
    hintToastBg:        null,
    hintToastText:      null,
    hintToastHideTimer: null,

    // 引导 / 动画
    battleGuideHandCon:  null,
    battleGuideHandTick: null,
    miniMapGfx:          null,
    miniMapCon:          null,
    flashTickFn:         null,
    expandTickFn:        null,
    flashOverlay:        null,

    itemTransformFlashLastAtMs: new Map(),

    gridDragFlashTick:    null,
    gridDragFlashOverlay: null,
    gridDragSellZoneCon:  null,
    gridDragSellZoneBg:   null,
    gridDragSellZoneText: null,

    // 商店拖拽
    shopDragFloater:    null,
    shopDragSlotIdx:    -1,
    shopDragHiddenSlot: -1,
    shopDragSize:       null,
    shopDragPointerId:  -1,

    // 拖拽标志
    gridDragCanSell:       false,
    gridDragCanToBackpack: false,
    gridDragSellHot:       false,
    synthHoverInfoKey:     '',

    // 事件监听器
    offDebugCfg:               null,
    offPhaseChange:            null,
    onStageTapHidePopup:       null,
    onStageShopPointerMove:    null,
    onStageShopPointerUp:      null,
    onStageShopPointerUpOutside: null,

    // 背景
    shopAreaBg:     null,
    backpackAreaBg: null,
    battleAreaBg:   null,

    // 被动统计
    battlePassivePrevStats:     new Map(),
    battlePassiveResolvedStats: new Map(),

    // 解锁揭示
    unlockRevealTickFn: null,
    unlockRevealActive: false,

    // 过渡
    battleStartTransition:   null,
    pendingBattleTransition: false,
    pendingAdvanceToNextDay: false,

    // PVP
    pvpReadyLocked:           false,
    pvpUrgeCooldownSet:       new Set(),
    pendingSkillBarMoveStartAtMs: null,

    // 存档
    savedShopState: null,

    // 选择
    currentSelection:   { kind: 'none' },
    selectedSellAction: null,
    selectedInfoKey:    null,
    selectedInfoMode:   'simple',

    // 日期
    currentDay: 1,

    // 起始职业
    starterClass:             null,
    starterHeroChoiceOptions: [],
    starterGranted:           false,
    starterBattleGuideShown:  false,
    hasBoughtOnce:            false,

    // 技能
    pickedSkills:     [],
    draftedSkillDays: [],
    pendingSkillDraft: null,

    // 事件
    draftedEventDays:     [],
    pendingEventDraft:    null,
    selectedEventCountById: new Map(),
    dayEventState: {
      forceBuyArchetype:       null,
      forceBuyRemaining:       0,
      forceSynthesisArchetype: null,
      forceSynthesisRemaining: 0,
      extraUpgradeRemaining:   0,
      allSynthesisRandom:      false,
    },
    blockedBaseIncomeDays:    new Set(),
    pendingGoldByDay:         new Map(),
    pendingBattleUpgradeByDay: new Map(),

    // 特殊商店
    draftedSpecialShopDays:       [],
    specialShopRefreshCount:      0,
    specialShopOffers:            [],
    specialShopBackpackViewActive: false,
    specialShopCheckedInstanceIds: new Set(),

    // 英雄效果
    skill20GrantedDays:                   new Set(),
    heroDailyCardRerollUsedDays:          new Set(),
    heroFirstDiscardRewardedDays:         new Set(),
    heroFirstSameItemSynthesisChoiceDays: new Set(),
    heroSmithStoneGrantedDays:            new Set(),
    heroAdventurerScrollGrantedDays:      new Set(),
    heroCommanderMedalGrantedDays:        new Set(),
    heroHeirGoldEquipGrantedDays:         new Set(),
    heroTycoonGoldGrantedDays:            new Set(),

    // 解锁 / 物品池
    unlockedItemIds:                   new Set(),
    neutralObtainedCountByKind:        new Map(),
    neutralDailyRollCountByDay:        new Map(),
    guaranteedNewUnlockTriggeredLevels: new Set(),
    neutralRandomCategoryPool:         [],
    levelRewardCategoryPool:           [],
    pendingLevelRewards:               [],
    pendingHeroPeriodicRewards:        [],
    pendingHeroPeriodicRewardDispatching: false,
    lockedBackpackRewardCells:         new Set(),
    levelRewardObtainedByKind:         new Map(),
    nextQuickBuyOffer:                 null,
    levelQuickDraftSavedEntries:       [],

    // 技能折扣
    skill15NextBuyDiscountPrepared: false,
    skill15NextBuyDiscount:         false,
    skill30BuyCounter:              0,
    skill30NextBuyFree:             false,
    quickBuyNoSynthRefreshStreak:   0,
    quickBuyNeutralMissStreak:      0,
  }
}
