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
  setLifeState,
  setPlayerProgressState,
  SHOP_STATE_STORAGE_KEY,
} from '@/core/RunState'
import { GridSystem }        from '@/grid/GridSystem'
import type { ItemSizeNorm, PlacedItem } from '@/grid/GridSystem'
import { GridZone, CELL_SIZE, CELL_HEIGHT } from '@/grid/GridZone'
import { DragController }    from '@/grid/DragController'
import { planAutoPack, type PackItem, type PackPlacement } from '@/grid/AutoPack'
import { planUnifiedSqueeze } from '@/grid/SqueezeLogic'
import { normalizeSize, type ItemDef, type SkillArchetype, type SkillTier } from '@/items/ItemDef'
import { resolveItemTierBaseStats } from '@/items/itemTierStats'
import { ShopManager, getDailyGoldForDay, type ShopSlot, type TierKey } from '@/shop/ShopManager'
import { ShopPanelView }     from '@/shop/ShopPanelView'
import { SellPopup, type ItemInfoMode, type ItemInfoCustomDisplay } from '@/shop/SellPopup'
import { getConfig as getDebugCfg, setConfig as setDebugCfg, onConfigChange as onDebugCfgChange } from '@/config/debugConfig'
import { getEventIconUrl, getItemIconUrl, getSkillIconUrl } from '@/core/assetPath'
import { getTierColor } from '@/config/colorPalette'
import { createItemStatBadges } from '@/ui/itemStatBadges'
import { PhaseManager } from '@/core/PhaseManager'
import { clearBattleSnapshot, getBattleSnapshot, setBattleSnapshot, type BattleSnapshotBundle } from '@/combat/BattleSnapshotStore'
import { PvpContext } from '@/pvp/PvpContext'
import { getOpponentFromAlive } from '@/pvp/PvpTypes'
import { clearBattleOutcome, consumeBattleOutcome } from '@/combat/BattleOutcomeStore'
import { BRONZE_SKILL_PICKS, getBronzeSkillById } from '@/skills/bronzeSkillConfig'
import { SILVER_SKILL_PICKS, getSilverSkillById } from '@/skills/silverSkillConfig'
import { GOLD_SKILL_PICKS, getGoldSkillById } from '@/skills/goldSkillConfig'
import { calcSkill94DailyGoldBonus, shouldTriggerSkill48ExtraUpgrade } from '@/skills/goldSkillRules'
import {
  Container, Graphics, Text, Sprite,
  Assets, Texture, Rectangle, Ticker,
  type FederatedPointerEvent,
} from 'pixi.js'

// ---- 布局常量（640×1384 画布）----
const CANVAS_W      = 640
const CANVAS_H      = 1384
const BTN_RADIUS    = 52
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
const BACKPACK_GAP_FROM_BATTLE = 52
const SHOP_STATE_STORAGE_VERSION = 2

// ---- 场景级状态 ----
let shopManager:    ShopManager    | null = null
let shopPanel:      ShopPanelView  | null = null
let sellPopup:      SellPopup      | null = null
let battleSystem:   GridSystem     | null = null
let backpackSystem: GridSystem     | null = null
let battleView:     GridZone       | null = null
let backpackView:   GridZone       | null = null
let drag:           DragController | null = null
let btnRow:         Container      | null = null
let showingBackpack = true

// 按钮/UI 引用（动画需要）
let goldText:       Text      | null = null
let livesText:      Text      | null = null
let trophyText:     Text      | null = null
let playerStatusCon: Container | null = null
let playerStatusAvatar: Sprite | null = null
let playerStatusAvatarClickHit: Graphics | null = null
let playerStatusDailySkillStar: Text | null = null
let playerStatusLvText: Text | null = null
let playerStatusExpBg: Graphics | null = null
let playerStatusExpBar: Graphics | null = null
let playerStatusAvatarUrl = ''
const HERO_DETAIL_POPUP_ID = '__hero_passive__'
let miniMapGfx:     Graphics  | null = null
let miniMapCon:     Container | null = null
let bpBtnHandle:      CircleBtnHandle | null = null
let refreshBtnHandle: CircleBtnHandle | null = null
let sellBtnHandle:    CircleBtnHandle | null = null
let phaseBtnHandle:   CircleBtnHandle | null = null
let refreshCostText:  Text            | null = null
let settingsBtn:      Container       | null = null
let settingsOverlay:  Container       | null = null
let skillTestOverlay: Container       | null = null
let eventTestOverlay: Container       | null = null
let itemTestOverlay:  Container       | null = null
let pvpPlayerListOverlay:   Container | null = null
let pvpWaitingPanel:        Container | null = null
let pvpBackpackReturnBtn:   Container | null = null
let pvpOpponentBadge:       Container | null = null
let pvpOpponentHeroLayer:   Container | null = null
let hintToastCon:     Container       | null = null
let hintToastBg:      Graphics        | null = null
let hintToastText:    Text            | null = null
let battleZoneTitleText: Text | null = null
let backpackZoneTitleText: Text | null = null
let hintToastHideTimer: ReturnType<typeof setTimeout> | null = null
let battleGuideHandCon: Container | null = null
let battleGuideHandTick: (() => void) | null = null
let unlockRevealLayer: Container | null = null
let unlockRevealTickFn: (() => void) | null = null
let unlockRevealActive = false

type ToastReason = 'no_gold_buy' | 'no_gold_refresh' | 'backpack_full_buy' | 'backpack_full_transfer' | 'pvp_urge'

// 商店拖拽状态
let shopDragFloater:   Container    | null = null
let shopDragSlotIdx    = -1
let shopDragHiddenSlot = -1
let shopDragSize:      ItemSizeNorm | null = null
let shopDragPointerId  = -1

// 特效 ticker
let flashTickFn:    (() => void) | null = null
let expandTickFn:   (() => void) | null = null
let flashOverlay:   Graphics     | null = null
const itemTransformFlashLastAtMs = new Map<string, number>()
let gridDragFlashTick: (() => void) | null = null
let gridDragFlashOverlay: Graphics | null = null
let gridDragSellZoneCon: Container | null = null
let gridDragSellZoneBg: Graphics | null = null
let gridDragSellZoneText: Text | null = null
let gridDragCanSell = false
let gridDragCanToBackpack = false
let gridDragSellHot = false
let synthHoverInfoKey = ''
let offDebugCfg:    (() => void) | null = null
let offPhaseChange: (() => void) | null = null
let onStageTapHidePopup: ((e: FederatedPointerEvent) => void) | null = null
let onStageShopPointerMove: ((e: FederatedPointerEvent) => void) | null = null
let onStageShopPointerUp: ((e: FederatedPointerEvent) => void) | null = null
let onStageShopPointerUpOutside: ((e: FederatedPointerEvent) => void) | null = null
let shopAreaBg: Graphics | null = null
let backpackAreaBg: Graphics | null = null
let battleAreaBg: Graphics | null = null
let restartBtn: Container | null = null
let passiveJumpLayer: Container | null = null
type PassiveResolvedStat = {
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
const battlePassivePrevStats = new Map<string, PassiveResolvedStat>()
const battlePassiveResolvedStats = new Map<string, PassiveResolvedStat>()

// Day 状态
let currentDay    = 1
let dayDebugText: Text | null = null
let dayPrevBtn: Text | null = null
let dayNextBtn: Text | null = null
let dayDebugCon: Container | null = null

type CircleBtnHandle = {
  container: Container
  redraw: (active: boolean) => void
  setCenter: (cx: number, cy: number) => void
  setLabel: (label: string) => void
  setSubLabel: (text: string) => void
}

type SelectionState =
  | { kind: 'none' }
  | { kind: 'shop'; slotIndex: number }
  | { kind: 'battle'; instanceId: string }
  | { kind: 'backpack'; instanceId: string }

let currentSelection: SelectionState = { kind: 'none' }
let selectedSellAction: (() => void) | null = null
let selectedInfoKey: string | null = null
let selectedInfoMode: ItemInfoMode = 'detailed'

function shouldShowSimpleDescriptions(): boolean {
  return getDebugCfg('gameplayShowSimpleDescriptions') >= 0.5
}

function isSkillDraftRerollEnabled(): boolean {
  return getDebugCfg('gameplaySkillDraftRerollEnabled') >= 0.5
}

function isEventDraftRerollEnabled(): boolean {
  return getDebugCfg('gameplayEventDraftRerollEnabled') >= 0.5
}

function getDefaultItemInfoMode(): ItemInfoMode {
  return shouldShowSimpleDescriptions() ? 'simple' : 'detailed'
}

function getDefaultSkillDetailMode(): 'simple' | 'detailed' {
  return shouldShowSimpleDescriptions() ? 'simple' : 'detailed'
}

function resetInfoModeSelection(): void {
  selectedInfoKey = null
  selectedInfoMode = getDefaultItemInfoMode()
}

function resolveInfoMode(nextKey: string): ItemInfoMode {
  if (!shouldShowSimpleDescriptions()) {
    selectedInfoKey = nextKey
    selectedInfoMode = 'detailed'
    return 'detailed'
  }
  if (!sellPopup?.visible) {
    selectedInfoKey = nextKey
    selectedInfoMode = 'simple'
    return selectedInfoMode
  }
  if (selectedInfoKey === nextKey) {
    selectedInfoMode = selectedInfoMode === 'simple' ? 'detailed' : 'simple'
  } else {
    selectedInfoKey = nextKey
    selectedInfoMode = 'simple'
  }
  return selectedInfoMode
}

type SavedPlacedItem = {
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

type SavedShopState = {
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
  specialShopOffers?: Array<{ itemId: string; tier: TierKey; star: 1 | 2; basePrice?: number; price: number; purchased: boolean }> | null
  neutralObtainedCounts?: Array<{ kind: string; count: number }>
  neutralRandomCategoryPool?: Array<'stone' | 'scroll' | 'medal'>
  neutralDailyRollCounts?: Array<{ day: number; count: number }>
  levelRewardCategoryPool?: Array<'stone' | 'scroll' | 'medal'>
  pendingLevelRewards?: string[]
  pendingHeroPeriodicRewards?: Array<{ itemId: string; level: 1 | 2 | 3 | 4 | 5 | 6 | 7; tier: TierKey; star: 1 | 2; source: string }>
  levelRewardObtainedCounts?: Array<{ kind: string; count: number }>
  heroDailyCardRerollUsedDays?: number[]
  heroFirstDiscardRewardedDays?: number[]
  heroFirstSameItemSynthesisChoiceDays?: number[]
  heroSmithStoneGrantedDays?: number[]
  heroAdventurerScrollGrantedDays?: number[]
  heroCommanderMedalGrantedDays?: number[]
  heroHeirGoldEquipGrantedDays?: number[]
  heroTycoonGoldGrantedDays?: number[]
}

type PendingHeroPeriodicReward = {
  itemId: string
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7
  tier: TierKey
  star: 1 | 2
  source: string
}

let pendingBattleTransition = false
let pendingAdvanceToNextDay = false
let pvpReadyLocked = false
// sync-a 臭鸡蛋：无冷却，可无限扔
let pvpUrgeCooldownSet = new Set<number>()
let pendingSkillBarMoveStartAtMs: number | null = null
let savedShopState: SavedShopState | null = null

const HERO_STARTER_POOL: StarterClass[] = ['hero1', 'hero2', 'hero3', 'hero4', 'hero5', 'hero6', 'hero7', 'hero8', 'hero9', 'hero10']

type StarterClass =
  | 'swordsman' | 'archer' | 'assassin'
  | 'hero1' | 'hero2' | 'hero3' | 'hero4' | 'hero5'
  | 'hero6' | 'hero7' | 'hero8' | 'hero9' | 'hero10'
let starterClass: StarterClass | null = null
let starterHeroChoiceOptions: StarterClass[] = []
let starterGranted = false
let starterBattleGuideShown = false
let hasBoughtOnce = false
let classSelectOverlay: Container | null = null
let starterGuideOverlay: Container | null = null
let skillDraftOverlay: Container | null = null
let eventDraftOverlay: Container | null = null
let specialShopOverlay: Container | null = null
let crossSynthesisConfirmOverlay: Container | null = null
let crossSynthesisConfirmTick: (() => void) | null = null
let crossSynthesisConfirmUnlockInput: (() => void) | null = null
let crossSynthesisConfirmAction: (() => void) | null = null
let crossSynthesisConfirmCloseTimer: ReturnType<typeof setTimeout> | null = null
let skillIconBarCon: Container | null = null
let skillDetailPopupCon: Container | null = null
let skillDetailSkillId: string | null = null
let skillDetailMode: 'simple' | 'detailed' = getDefaultSkillDetailMode()

type SkillPick = {
  id: string
  name: string
  archetype: SkillArchetype
  desc: string
  detailDesc?: string
  tier: SkillTier
  icon?: string
}

type PendingSkillDraft = {
  day: number
  tier: SkillTier
  choices: SkillPick[]
  rerolled?: boolean
  fixedTier?: boolean
}

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

type PendingEventDraft = {
  day: number
  choices: EventChoice[]
  rerolled?: boolean
}

type SpecialShopOffer = {
  itemId: string
  tier: TierKey
  star: 1 | 2
  basePrice: number
  price: number
  purchased: boolean
}

let pickedSkills: SkillPick[] = []
let draftedSkillDays: number[] = []
let pendingSkillDraft: PendingSkillDraft | null = null
let draftedEventDays: number[] = []
let pendingEventDraft: PendingEventDraft | null = null
let draftedSpecialShopDays: number[] = []
let specialShopRefreshCount = 0
let specialShopOffers: SpecialShopOffer[] = []
let specialShopBackpackViewActive = false
const specialShopCheckedInstanceIds = new Set<string>()
let specialShopCheckLayer: Container | null = null
let specialShopOverlayActionRefresh: (() => void) | null = null
const selectedEventCountById = new Map<string, number>()
let dayEventState: {
  forceBuyArchetype: EventArchetype | null
  forceBuyRemaining: number
  forceSynthesisArchetype: EventArchetype | null
  forceSynthesisRemaining: number
  extraUpgradeRemaining: number
  allSynthesisRandom: boolean
} = {
  forceBuyArchetype: null,
  forceBuyRemaining: 0,
  forceSynthesisArchetype: null,
  forceSynthesisRemaining: 0,
  extraUpgradeRemaining: 0,
  allSynthesisRandom: false,
}
const blockedBaseIncomeDays = new Set<number>()
const pendingGoldByDay = new Map<number, number>()
const pendingBattleUpgradeByDay = new Map<number, number>()
const skill20GrantedDays = new Set<number>()
const heroDailyCardRerollUsedDays = new Set<number>()
const heroFirstDiscardRewardedDays = new Set<number>()
const heroFirstSameItemSynthesisChoiceDays = new Set<number>()
const heroSmithStoneGrantedDays = new Set<number>()
const heroAdventurerScrollGrantedDays = new Set<number>()
const heroCommanderMedalGrantedDays = new Set<number>()
const heroHeirGoldEquipGrantedDays = new Set<number>()
const heroTycoonGoldGrantedDays = new Set<number>()
const unlockedItemIds = new Set<string>()
const neutralObtainedCountByKind = new Map<string, number>()
const neutralDailyRollCountByDay = new Map<number, number>()
void neutralDailyRollCountByDay
const guaranteedNewUnlockTriggeredLevels = new Set<number>()
let skill15NextBuyDiscountPrepared = false
let skill15NextBuyDiscount = false
let skill30BuyCounter = 0
let skill30NextBuyFree = false
let quickBuyNoSynthRefreshStreak = 0
let quickBuyNeutralMissStreak = 0
let neutralRandomCategoryPool: Array<'stone' | 'scroll' | 'medal'> = []
// 升级奖励状态（持久化）
let levelRewardCategoryPool: Array<'stone' | 'scroll' | 'medal'> = []
let pendingLevelRewards: string[] = []
let pendingHeroPeriodicRewards: PendingHeroPeriodicReward[] = []
let pendingHeroPeriodicRewardDispatching = false
const levelRewardObtainedByKind = new Map<string, number>()
let nextQuickBuyOffer: {
  itemId: string
  tier: TierKey
  star: 1 | 2
  price: number
} | null = null

// 临时开关：屏蔽技能三选一流程（保留配置与存档字段，便于后续恢复）
const SKILL_DRAFT_ENABLED = true

type BattleStartTransitionState = {
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

let battleStartTransition: BattleStartTransitionState | null = null

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function easeOutCubic(t: number): number {
  const p = clamp01(t)
  return 1 - Math.pow(1 - p, 3)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function setTransitionInputEnabled(enabled: boolean): void {
  drag?.setEnabled(enabled)
  if (shopPanel) shopPanel.interactiveChildren = enabled
  if (btnRow) btnRow.interactiveChildren = enabled
  if (dayDebugCon) dayDebugCon.interactiveChildren = enabled
}

function beginBattleStartTransition(): void {
  if (battleStartTransition) return
  const transitionMs = Math.max(1, getDebugCfg('shopToBattleTransitionMs'))
  const battleDropPx = Math.max(0, getDebugCfg('battleZoneYInBattleOffset'))
  const backpackDropPx = Math.max(0, getDebugCfg('shopToBattleBackpackDropPx'))
  const backpackTargetAlpha = clamp01(getDebugCfg('shopToBattleBackpackAlpha'))
  const buttonsTargetAlpha = clamp01(getDebugCfg('shopToBattleButtonsAlpha'))
  const currentBattleY = battleView?.y ?? (getDebugCfg('battleZoneY') + (CELL_HEIGHT * (1 - getBattleItemScale())) / 2)
  const currentBackpackY = backpackView?.y ?? getBackpackZoneYByBattle()

  clearSelection()
  hideSkillDetailPopup()
  if (skillIconBarCon) skillIconBarCon.visible = false
  stopGridDragButtonFlash()
  stopFlashEffect()
  battleView?.clearHighlight()
  backpackView?.clearHighlight()
  setTransitionInputEnabled(false)
  setBaseShopPrimaryButtonsVisible(false)
  if (battleZoneTitleText) {
    battleZoneTitleText.alpha = 0
    battleZoneTitleText.visible = false
  }
  if (backpackZoneTitleText) {
    backpackZoneTitleText.alpha = 0
    backpackZoneTitleText.visible = false
  }

  battleStartTransition = {
    elapsedMs: 0,
    durationMs: transitionMs,
    battleStartY: currentBattleY,
    battleTargetY: currentBattleY + battleDropPx,
    backpackStartY: currentBackpackY,
    backpackTargetY: currentBackpackY + backpackDropPx,
    backpackStartAlpha: backpackView?.alpha ?? 1,
    backpackTargetAlpha,
    buttonsStartAlpha: btnRow?.alpha ?? 1,
    buttonsTargetAlpha,
  }
}

function tickBattleStartTransition(dt: number): void {
  if (!battleStartTransition) return
  battleStartTransition.elapsedMs += Math.max(0, dt * 1000)
  const t = clamp01(battleStartTransition.elapsedMs / battleStartTransition.durationMs)
  const eased = easeOutCubic(t)

  if (battleView) {
    battleView.y = lerp(battleStartTransition.battleStartY, battleStartTransition.battleTargetY, eased)
  }
  if (backpackView) {
    backpackView.y = lerp(battleStartTransition.backpackStartY, battleStartTransition.backpackTargetY, eased)
    backpackView.alpha = lerp(battleStartTransition.backpackStartAlpha, battleStartTransition.backpackTargetAlpha, eased)
  }
  if (backpackAreaBg) {
    backpackAreaBg.alpha = lerp(1, battleStartTransition.backpackTargetAlpha, eased)
  }
  if (btnRow) {
    btnRow.alpha = lerp(battleStartTransition.buttonsStartAlpha, battleStartTransition.buttonsTargetAlpha, eased)
  }
  if (refreshCostText) {
    refreshCostText.alpha = lerp(1, battleStartTransition.buttonsTargetAlpha, eased)
  }
  if (dayDebugCon) {
    dayDebugCon.alpha = lerp(1, battleStartTransition.buttonsTargetAlpha, eased)
  }
  if (hintToastCon) {
    hintToastCon.alpha = lerp(1, battleStartTransition.buttonsTargetAlpha, eased)
  }

  if (t >= 1) {
    battleStartTransition = null
    SceneManager.goto('battle')
  }
}

function saveShopStateToStorage(state: SavedShopState | null): void {
  if (!state) return
  try {
    localStorage.setItem(SHOP_STATE_STORAGE_KEY, JSON.stringify({
      version: SHOP_STATE_STORAGE_VERSION,
      state,
    }))
  } catch (err) {
    console.warn('[ShopScene] 保存商店状态失败', err)
  }
}

function loadShopStateFromStorage(): SavedShopState | null {
  try {
    const raw = localStorage.getItem(SHOP_STATE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { version?: unknown, state?: unknown } | Partial<SavedShopState> | null
    if (!parsed || typeof parsed !== 'object') return null

    const candidate = ('state' in parsed)
      ? (
          typeof (parsed as { version?: unknown }).version === 'number'
          && (parsed as { version?: number }).version === SHOP_STATE_STORAGE_VERSION
          ? (parsed as { state?: unknown }).state
          : null
        )
      : parsed

    if (!candidate || typeof candidate !== 'object') return null
    const state = candidate as Partial<SavedShopState>
    if (typeof state.day !== 'number') return null
    if (typeof state.gold !== 'number') return null
    if (typeof state.refreshIndex !== 'number') return null
    if (typeof state.instCounter !== 'number') return null
    if (!Array.isArray(state.pool) || !Array.isArray(state.battleItems) || !Array.isArray(state.backpackItems)) return null
    return state as SavedShopState
  } catch (err) {
    console.warn('[ShopScene] 读取商店状态失败', err)
    return null
  }
}

function restartRunFromBeginning(): void {
  clearCurrentRunState()
  resetLifeState()
  clearBattleSnapshot()
  clearBattleOutcome()
  savedShopState = null
  pendingBattleTransition = false
  pendingAdvanceToNextDay = false
  pvpReadyLocked = false
  window.location.reload()
}

function isShopInputEnabled(): boolean {
  if (pvpReadyLocked) return false
  return PhaseManager.isShopInputEnabled()
}

function createHintToast(stage: Container): void {
  if (hintToastCon) return
  const cfg = getConfig()
  const con = new Container()
  const bg = new Graphics()
  const txt = new Text({
    text: '',
    style: {
      fontSize: cfg.textSizes.refreshCost,
      fill: 0xffe8a3,
      fontFamily: 'Arial',
      fontWeight: 'bold',
    },
  })
  con.visible = false
  con.addChild(bg)
  con.addChild(txt)
  con.zIndex = 9999
  stage.addChild(con)
  hintToastCon = con
  hintToastBg = bg
  hintToastText = txt
}

function shouldShowToast(reason: ToastReason): boolean {
  if (getDebugCfg('toastEnabled') < 0.5) return false
  if (reason === 'no_gold_buy') return getDebugCfg('toastShowNoGoldBuy') >= 0.5
  if (reason === 'no_gold_refresh') return getDebugCfg('toastShowNoGoldRefresh') >= 0.5
  if (reason === 'backpack_full_buy') return getDebugCfg('toastShowBackpackFullBuy') >= 0.5
  return getDebugCfg('toastShowBackpackFullTransfer') >= 0.5
}

function showHintToast(reason: ToastReason, message: string, color = 0xffe8a3): void {
  if (!shouldShowToast(reason)) return
  if (!hintToastCon || !hintToastBg || !hintToastText) return
  if (hintToastCon.parent) hintToastCon.parent.addChild(hintToastCon)
  if (hintToastHideTimer) {
    clearTimeout(hintToastHideTimer)
    hintToastHideTimer = null
  }
  hintToastText.text = message
  hintToastText.style.fill = color
  hintToastText.style.fontSize = Math.max(28, Math.round(getConfig().textSizes.refreshCost * 1.25))
  const padX = 36
  const padY = 18
  const boxW = hintToastText.width + padX * 2
  const boxH = hintToastText.height + padY * 2
  const boxX = (CANVAS_W - boxW) / 2
  const boxY = (CANVAS_H - boxH) / 2
  const corner = Math.max(10, Math.round(getDebugCfg('gridItemCornerRadius')))
  hintToastBg.clear()
  hintToastBg.roundRect(boxX, boxY, boxW, boxH, corner)
  hintToastBg.fill({ color: 0x0f1a2f, alpha: 0.96 })
  hintToastBg.stroke({ color: 0xffe08a, width: 4, alpha: 1 })
  hintToastText.x = boxX + padX
  hintToastText.y = boxY + padY
  hintToastCon.visible = true
  hintToastHideTimer = setTimeout(() => {
    if (hintToastCon) hintToastCon.visible = false
    hintToastHideTimer = null
  }, 1700)
}

function stopBattleGuideHandAnim(): void {
  if (battleGuideHandTick) {
    Ticker.shared.remove(battleGuideHandTick)
    battleGuideHandTick = null
  }
  if (battleGuideHandCon) {
    if (battleGuideHandCon.parent) battleGuideHandCon.parent.removeChild(battleGuideHandCon)
    battleGuideHandCon.destroy({ children: true })
    battleGuideHandCon = null
  }
}

function getSizeCols(size: ItemSizeNorm): number {
  if (size === '2x1') return 2
  if (size === '3x1') return 3
  return 1
}

function showMoveToBattleGuideHand(): void {
  if (!backpackSystem || !backpackView || !battleView) return
  const backpackItems = backpackSystem
    .getAllItems()
    .slice()
    .sort((a, b) => (a.row - b.row) || (a.col - b.col))
  const first = backpackItems[0]
  if (!first) return

  stopBattleGuideHandAnim()

  const fromLocal = backpackView.cellToLocal(first.col, first.row)
  const fromGlobal = backpackView.toGlobal({
    x: fromLocal.x + (getSizeCols(first.size) * CELL_SIZE) / 2,
    y: fromLocal.y + CELL_HEIGHT / 2,
  })
  const toLocal = battleView.cellToLocal(0, 0)
  const toGlobal = battleView.toGlobal({
    x: toLocal.x + CELL_SIZE / 2,
    y: toLocal.y + CELL_HEIGHT / 2,
  })

  const { stage } = getApp()
  const from = stage.toLocal(fromGlobal)
  const to = stage.toLocal(toGlobal)
  const handFontSize = Math.round(CELL_SIZE)
  const fingertipOffsetX = 0
  const fingertipOffsetY = Math.round(handFontSize * 0.34)
  const hand = new Text({
    text: '👆',
    style: {
      fontSize: handFontSize,
      fill: 0xffffff,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      stroke: { color: 0x0b1222, width: 3 },
    },
  })
  hand.anchor.set(0.5)

  const ghost = new Sprite(Texture.WHITE)
  const ghostCols = getSizeCols(first.size)
  const ghostW = Math.max(1, Math.round(ghostCols * CELL_SIZE * 0.9))
  const ghostH = Math.max(1, Math.round(CELL_HEIGHT * 0.9))
  ghost.anchor.set(0.5)
  ghost.width = ghostW
  ghost.height = ghostH
  ghost.y = -fingertipOffsetY
  ghost.alpha = 0.5

  void Assets.load<Texture>(getItemIconUrl(first.defId)).then((tex) => {
    const sw = Math.max(1, tex.width)
    const sh = Math.max(1, tex.height)
    const scale = Math.min(ghostW / sw, ghostH / sh)
    ghost.texture = tex
    ghost.width = Math.max(1, Math.round(sw * scale))
    ghost.height = Math.max(1, Math.round(sh * scale))
  }).catch(() => {
    // keep translucent placeholder when icon missing
  })

  const con = new Container()
  con.eventMode = 'none'
  con.zIndex = 10020
  const fromAnchorX = from.x + fingertipOffsetX
  const fromAnchorY = from.y + fingertipOffsetY
  const toAnchorX = to.x + fingertipOffsetX
  const toAnchorY = to.y + fingertipOffsetY
  con.x = fromAnchorX
  con.y = fromAnchorY
  con.addChild(ghost)
  con.addChild(hand)
  stage.addChild(con)
  battleGuideHandCon = con

  const startAt = Date.now()
  const durationMs = 720
  const arcY = Math.max(18, Math.round(CELL_SIZE * 0.28))
  battleGuideHandTick = () => {
    const tRaw = (Date.now() - startAt) / durationMs
    const t = Math.max(0, Math.min(1, tRaw))
    const ease = t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2
    con.x = fromAnchorX + (toAnchorX - fromAnchorX) * ease
    con.y = fromAnchorY + (toAnchorY - fromAnchorY) * ease - Math.sin(Math.PI * t) * arcY
    con.alpha = t < 0.75 ? 1 : Math.max(0, 1 - (t - 0.75) / 0.25)
    if (t >= 1) stopBattleGuideHandAnim()
  }
  Ticker.shared.add(battleGuideHandTick)
}

function canAffordQuickBuyNow(): boolean {
  if (!shopManager) return false
  const offer = rollNextQuickBuyOffer(false)
  if (!offer) return false
  if (!canBuyItemUnderFirstPurchaseRule(offer.item)) return false
  const price = resolveBuyPriceWithSkills(offer.price).finalPrice
  return shopManager.gold >= price
}

function showBuyGuideHand(): void {
  stopBattleGuideHandAnim()

  const { stage } = getApp()
  const centerX = getDebugCfg('refreshBtnX') + 20
  const centerY = getDebugCfg('refreshBtnY') + 48

  const hand = new Text({
    text: '👆',
    style: {
      fontSize: Math.max(64, Math.round(CELL_SIZE * 0.9)),
      fill: 0xffffff,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      stroke: { color: 0x0b1222, width: 3 },
    },
  })
  hand.anchor.set(0.5)

  const con = new Container()
  con.eventMode = 'none'
  con.zIndex = 10020
  con.x = centerX
  con.y = centerY
  con.addChild(hand)
  stage.addChild(con)
  battleGuideHandCon = con

  const startAt = Date.now()
  const durationMs = 1000
  battleGuideHandTick = () => {
    const tRaw = (Date.now() - startAt) / durationMs
    const t = Math.max(0, Math.min(1, tRaw))
    const pulse = Math.sin(t * Math.PI * 3)
    con.y = centerY + pulse * 10
    con.alpha = 0.7 + 0.3 * Math.max(0, pulse)
    if (t >= 1) stopBattleGuideHandAnim()
  }
  Ticker.shared.add(battleGuideHandTick)
}

function stopUnlockRevealPlayback(): void {
  if (unlockRevealTickFn) {
    Ticker.shared.remove(unlockRevealTickFn)
    unlockRevealTickFn = null
  }
  unlockRevealActive = false
  if (!unlockRevealLayer) return
  unlockRevealLayer.visible = false
  unlockRevealLayer.removeChildren().forEach((ch) => ch.destroy({ children: true }))
}

function updatePhaseToggleButton(): void {
  if (!phaseBtnHandle) return
  const inShop = isShopInputEnabled()
  // PVP 模式下用「准备」替代「战斗」，语义更清晰
  const battleLabel = PvpContext.isActive() ? '准备' : '战斗'
  phaseBtnHandle.setLabel(inShop ? battleLabel : '商店')
  phaseBtnHandle.redraw(true)
}

function applyPhaseUiVisibility(): void {
  const inShop = isShopInputEnabled()

  if (!inShop) {
    showingBackpack = true
    shopPanel?.setSelectedSlot(-1)
    battleView?.setSelected(null)
    backpackView?.setSelected(null)
    clearSelection()
    applySellButtonState()
  }

  if (shopPanel) shopPanel.visible = false
  if (backpackView) backpackView.visible = inShop && showingBackpack
  if (shopAreaBg) shopAreaBg.visible = inShop && !showingBackpack
  if (backpackAreaBg) backpackAreaBg.visible = inShop && showingBackpack
  if (battleAreaBg) battleAreaBg.visible = inShop
  if (battleZoneTitleText) battleZoneTitleText.visible = inShop
  if (backpackZoneTitleText) backpackZoneTitleText.visible = inShop && showingBackpack
  if (battleZoneTitleText && inShop) battleZoneTitleText.alpha = 1
  if (backpackZoneTitleText && inShop) backpackZoneTitleText.alpha = 1

  if (specialShopBackpackViewActive) {
    if (bpBtnHandle) bpBtnHandle.container.visible = false
    if (refreshBtnHandle) refreshBtnHandle.container.visible = false
    if (sellBtnHandle) sellBtnHandle.container.visible = false
    if (phaseBtnHandle) phaseBtnHandle.container.visible = false
  } else {
    if (bpBtnHandle) bpBtnHandle.container.visible = false
    if (refreshBtnHandle) refreshBtnHandle.container.visible = inShop
    if (sellBtnHandle) sellBtnHandle.container.visible = inShop
    if (phaseBtnHandle) phaseBtnHandle.container.visible = true
  }

  if (refreshCostText) refreshCostText.visible = inShop
  if (goldText) goldText.visible = inShop
  if (livesText) livesText.visible = inShop
  if (playerStatusCon) playerStatusCon.visible = inShop
  if (miniMapCon) miniMapCon.visible = inShop
  if (dayDebugCon) dayDebugCon.visible = inShop
  if (sellPopup) sellPopup.visible = inShop && currentSelection.kind !== 'none'
  if (hintToastCon && !inShop) hintToastCon.visible = false
  if (unlockRevealLayer) unlockRevealLayer.visible = inShop && unlockRevealActive

  if (!inShop) {
    stopGridDragButtonFlash()
    stopFlashEffect()
    battleView?.clearHighlight()
    backpackView?.clearHighlight()
  }

  updatePhaseToggleButton()
}

function applyPhaseInputLock(): void {
  teardownCrossSynthesisConfirmOverlay()
  const enabled = isShopInputEnabled()
  drag?.setEnabled(enabled)

  if (shopDragFloater) {
    if (shopDragFloater.parent) shopDragFloater.parent.removeChild(shopDragFloater)
    shopDragFloater.destroy({ children: true })
    shopDragFloater = null
  }
  _resetDrag()
  applyPhaseUiVisibility()
}

function buildBattleSnapshot(skillBarMoveStartAtMs?: number): BattleSnapshotBundle | null {
  if (!battleSystem || !battleView) return null
  const activeColCount = battleView.activeColCount
  const snap = battleSystem.exportCombatSnapshot(activeColCount)
  const playerBackpackItemCount = backpackSystem?.getAllItems().length ?? 0
  const trophyTarget = getConfig().runRules?.trophyWinsToFinalVictory ?? 10
  const trophy = getWinTrophyState(trophyTarget)
  const progress = getPlayerProgressState()
  const playerLevel = clampPlayerLevel(progress.level)
  let playerBattleHp = getPlayerMaxLifeByLevel(playerLevel)
  if (isSelectedHero('hero10')) {
    playerBattleHp = Math.max(1, Math.round(playerBattleHp * 1.3))
  }
  return {
    day: currentDay,
    activeColCount: snap.activeColCount,
    createdAtMs: snap.createdAtMs,
    skillBarMoveStartAtMs: typeof skillBarMoveStartAtMs === 'number' ? skillBarMoveStartAtMs : undefined,
    playerBackpackItemCount,
    playerGold: Math.max(0, Math.round(shopManager?.gold ?? 0)),
    playerTrophyWins: Math.max(0, Math.round(trophy.wins)),
    playerBattleHp,
    ownerSkillIds: pickedSkills.map((s) => s.id),
    ownerHeroId: starterClass ?? undefined,
    entities: snap.entities.map((it) => ({
      ...it,
      tier: getInstanceTier(it.instanceId) ?? 'Bronze',
      tierStar: getInstanceTierStar(it.instanceId),
      quality: getInstanceQuality(it.instanceId),
      level: getInstanceLevel(it.instanceId),
      permanentDamageBonus: Math.max(0, Math.round(instanceToPermanentDamageBonus.get(it.instanceId) ?? 0)),
      baseStats: resolveInstanceBaseStats(it.instanceId),
    })),
  }
}

function resolveInstanceBaseStats(instanceId: string): BattleSnapshotBundle['entities'][number]['baseStats'] {
  const defId = instanceToDefId.get(instanceId)
  if (!defId) return undefined
  const def = getAllItems().find((it) => it.id === defId)
  if (!def) return undefined
  const level = getInstanceLevel(instanceId)
  const legacy = levelToTierStar(level)
  const tier = legacy?.tier ?? 'Bronze'
  const star = legacy?.star ?? 1
  const stats = resolveItemTierBaseStats(def, `${tier}#${star}`)
  const permanentBonus = Math.max(0, Math.round(instanceToPermanentDamageBonus.get(instanceId) ?? 0))
  return {
    cooldownMs: Math.max(0, Math.round(stats.cooldownMs)),
    damage: Math.max(0, Math.round(stats.damage + permanentBonus)),
    heal: Math.max(0, Math.round(stats.heal)),
    shield: Math.max(0, Math.round(stats.shield)),
    burn: Math.max(0, Math.round(stats.burn)),
    poison: Math.max(0, Math.round(stats.poison)),
    regen: Math.max(0, Math.round(stats.regen)),
    crit: Math.max(0, stats.crit),
    multicast: Math.max(1, Math.round(stats.multicast)),
  }
}

function captureShopState(): SavedShopState | null {
  if (!shopManager || !battleSystem || !backpackSystem) return null
  const captureItems = (items: ReturnType<GridSystem['getAllItems']>): SavedPlacedItem[] => items.map((it) => ({
    instanceId: it.instanceId,
    defId: it.defId,
    size: it.size,
    col: it.col,
    row: it.row,
    quality: getInstanceQuality(it.instanceId),
    level: getInstanceLevel(it.instanceId),
    tier: getInstanceTier(it.instanceId) ?? 'Bronze',
    tierStar: getInstanceTierStar(it.instanceId),
    permanentDamageBonus: Math.max(0, Math.round(instanceToPermanentDamageBonus.get(it.instanceId) ?? 0)),
  }))

  return {
    day: currentDay,
    gold: shopManager.gold,
    refreshIndex: shopManager.refreshIndex,
    pool: shopManager.pool.map((slot: ShopSlot) => ({
      itemId: slot.item.id,
      tier: slot.tier,
      price: slot.price,
      purchased: slot.purchased,
    })),
    battleItems: captureItems(battleSystem.getAllItems()),
    backpackItems: captureItems(backpackSystem.getAllItems()),
    instCounter,
    starterClass,
    starterGranted,
    starterBattleGuideShown,
    pickedSkills,
    draftedSkillDays,
    pendingSkillDraft,
    unlockedItemIds: Array.from(unlockedItemIds),
    nextQuickBuyOffer,
    guaranteedNewUnlockTriggeredLevels: Array.from(guaranteedNewUnlockTriggeredLevels),
    skill20GrantedDays: Array.from(skill20GrantedDays),
    hasBoughtOnce,
    skill15NextBuyDiscountPrepared,
    skill15NextBuyDiscount,
    skill30BuyCounter,
    skill30NextBuyFree,
    quickBuyNoSynthRefreshStreak,
    quickBuyNeutralMissStreak,
    draftedEventDays,
    pendingEventDraft,
    selectedEventCounts: Array.from(selectedEventCountById.entries()).map(([id, count]) => ({ id, count })),
    dayEventState: {
      forceBuyArchetype: dayEventState.forceBuyArchetype,
      forceBuyRemaining: dayEventState.forceBuyRemaining,
      forceSynthesisArchetype: dayEventState.forceSynthesisArchetype,
      forceSynthesisRemaining: dayEventState.forceSynthesisRemaining,
      extraUpgradeRemaining: dayEventState.extraUpgradeRemaining,
      allSynthesisRandom: dayEventState.allSynthesisRandom,
    },
    futureEventState: {
      blockedBaseIncomeDays: Array.from(blockedBaseIncomeDays.values()),
      pendingGoldByDay: Array.from(pendingGoldByDay.entries()).map(([day, amount]) => ({ day, amount })),
      pendingBattleUpgradeByDay: Array.from(pendingBattleUpgradeByDay.entries()).map(([day, count]) => ({ day, count })),
    },
    draftedSpecialShopDays,
    specialShopRefreshCount,
    specialShopOffers,
    neutralObtainedCounts: Array.from(neutralObtainedCountByKind.entries()).map(([kind, count]) => ({ kind, count })),
    neutralRandomCategoryPool,
    neutralDailyRollCounts: Array.from(neutralDailyRollCountByDay.entries()).map(([day, count]) => ({ day, count })),
    levelRewardCategoryPool: [...levelRewardCategoryPool],
    pendingLevelRewards: [...pendingLevelRewards],
    pendingHeroPeriodicRewards: pendingHeroPeriodicRewards.map((one) => ({
      itemId: one.itemId,
      level: one.level,
      tier: one.tier,
      star: one.star,
      source: one.source,
    })),
    levelRewardObtainedCounts: Array.from(levelRewardObtainedByKind.entries()).map(([kind, count]) => ({ kind, count })),
    heroDailyCardRerollUsedDays: Array.from(heroDailyCardRerollUsedDays),
    heroFirstDiscardRewardedDays: Array.from(heroFirstDiscardRewardedDays),
    heroFirstSameItemSynthesisChoiceDays: Array.from(heroFirstSameItemSynthesisChoiceDays),
    heroSmithStoneGrantedDays: Array.from(heroSmithStoneGrantedDays),
    heroAdventurerScrollGrantedDays: Array.from(heroAdventurerScrollGrantedDays),
    heroCommanderMedalGrantedDays: Array.from(heroCommanderMedalGrantedDays),
    heroHeirGoldEquipGrantedDays: Array.from(heroHeirGoldEquipGrantedDays),
    heroTycoonGoldGrantedDays: Array.from(heroTycoonGoldGrantedDays),
  }
}

function applySavedShopState(state: SavedShopState): void {
  if (!shopManager || !battleSystem || !backpackSystem || !battleView || !backpackView) return
  const all = getAllItems()
  const byId = new Map(all.map((it) => [it.id, it] as const))

  currentDay = state.day
  starterClass = state.starterClass ?? null
  starterGranted = state.starterGranted ?? false
  starterBattleGuideShown = state.starterBattleGuideShown ?? false
  hasBoughtOnce = state.hasBoughtOnce
    ?? ((state.battleItems?.length ?? 0) + (state.backpackItems?.length ?? 0) > 0)
  pickedSkills = Array.isArray(state.pickedSkills) ? state.pickedSkills : []
  draftedSkillDays = Array.isArray(state.draftedSkillDays)
    ? state.draftedSkillDays.filter((d) => Number.isFinite(d)).map((d) => Math.max(1, Math.round(d)))
    : []
  pendingSkillDraft = (state.pendingSkillDraft && typeof state.pendingSkillDraft === 'object')
    ? state.pendingSkillDraft
    : null
  draftedEventDays = Array.isArray(state.draftedEventDays)
    ? state.draftedEventDays.filter((d) => Number.isFinite(d)).map((d) => Math.max(1, Math.round(d)))
    : []
  pendingEventDraft = (state.pendingEventDraft && typeof state.pendingEventDraft === 'object')
    ? state.pendingEventDraft
    : null
  draftedSpecialShopDays = Array.isArray(state.draftedSpecialShopDays)
    ? state.draftedSpecialShopDays.filter((d) => Number.isFinite(d)).map((d) => Math.max(1, Math.round(d)))
    : []
  specialShopRefreshCount = Math.max(0, Math.round(Number(state.specialShopRefreshCount ?? 0) || 0))
  specialShopOffers = Array.isArray(state.specialShopOffers)
    ? state.specialShopOffers
      .filter((it) => it && typeof it.itemId === 'string')
      .map((it) => ({
        itemId: it.itemId,
        tier: it.tier,
        star: normalizeTierStar(it.tier, it.star),
        basePrice: Math.max(1, Math.round(Number(it.basePrice ?? it.price) || 1)),
        price: Math.max(0, Math.round(Number(it.price) || 0)),
        purchased: it.purchased === true,
      }))
    : []
  selectedEventCountById.clear()
  const savedEventCounts = Array.isArray(state.selectedEventCounts) ? state.selectedEventCounts : []
  for (const row of savedEventCounts) {
    if (!row || typeof row.id !== 'string') continue
    const count = Math.max(0, Math.round(Number(row.count) || 0))
    if (count > 0) selectedEventCountById.set(row.id, count)
  }
  dayEventState = {
    forceBuyArchetype: state.dayEventState?.forceBuyArchetype ?? null,
    forceBuyRemaining: Math.max(0, Math.round(Number(state.dayEventState?.forceBuyRemaining ?? 0) || 0)),
    forceSynthesisArchetype: state.dayEventState?.forceSynthesisArchetype ?? null,
    forceSynthesisRemaining: Math.max(0, Math.round(Number(state.dayEventState?.forceSynthesisRemaining ?? 0) || 0)),
    extraUpgradeRemaining: Math.max(0, Math.round(Number(state.dayEventState?.extraUpgradeRemaining ?? 0) || 0)),
    allSynthesisRandom: state.dayEventState?.allSynthesisRandom === true,
  }
  blockedBaseIncomeDays.clear()
  for (const day of state.futureEventState?.blockedBaseIncomeDays ?? []) {
    const one = Math.max(1, Math.round(Number(day) || 0))
    if (one > 0) blockedBaseIncomeDays.add(one)
  }
  pendingGoldByDay.clear()
  for (const row of state.futureEventState?.pendingGoldByDay ?? []) {
    const day = Math.max(1, Math.round(Number(row?.day) || 0))
    const amount = Math.max(0, Math.round(Number(row?.amount) || 0))
    if (day > 0 && amount > 0) pendingGoldByDay.set(day, (pendingGoldByDay.get(day) ?? 0) + amount)
  }
  pendingBattleUpgradeByDay.clear()
  for (const row of state.futureEventState?.pendingBattleUpgradeByDay ?? []) {
    const day = Math.max(1, Math.round(Number(row?.day) || 0))
    const count = Math.max(0, Math.round(Number(row?.count) || 0))
    if (day > 0 && count > 0) pendingBattleUpgradeByDay.set(day, (pendingBattleUpgradeByDay.get(day) ?? 0) + count)
  }
  unlockedItemIds.clear()
  const savedUnlocks = Array.isArray(state.unlockedItemIds)
    ? state.unlockedItemIds.filter((id): id is string => typeof id === 'string')
    : []
  if (savedUnlocks.length > 0) {
    for (const id of savedUnlocks) unlockedItemIds.add(id)
  }
  guaranteedNewUnlockTriggeredLevels.clear()
  QUALITY_PSEUDO_RANDOM_STATE.clear()
  QUICK_BUY_LEVEL_PSEUDO_RANDOM_STATE.clear()
  const savedGuaranteed = Array.isArray(state.guaranteedNewUnlockTriggeredLevels)
    ? state.guaranteedNewUnlockTriggeredLevels.filter((lv): lv is number => Number.isFinite(lv)).map((lv) => Math.round(lv))
    : []
  for (const lv of savedGuaranteed) guaranteedNewUnlockTriggeredLevels.add(lv)
  skill20GrantedDays.clear()
  const savedSkill20Days = Array.isArray(state.skill20GrantedDays)
    ? state.skill20GrantedDays.filter((d): d is number => Number.isFinite(d)).map((d) => Math.max(1, Math.round(d)))
    : []
  for (const day of savedSkill20Days) skill20GrantedDays.add(day)
  heroDailyCardRerollUsedDays.clear()
  for (const day of state.heroDailyCardRerollUsedDays ?? []) {
    const one = Math.max(1, Math.round(Number(day) || 0))
    if (one > 0) heroDailyCardRerollUsedDays.add(one)
  }
  heroFirstDiscardRewardedDays.clear()
  for (const day of state.heroFirstDiscardRewardedDays ?? []) {
    const one = Math.max(1, Math.round(Number(day) || 0))
    if (one > 0) heroFirstDiscardRewardedDays.add(one)
  }
  heroFirstSameItemSynthesisChoiceDays.clear()
  for (const day of state.heroFirstSameItemSynthesisChoiceDays ?? []) {
    const one = Math.max(1, Math.round(Number(day) || 0))
    if (one > 0) heroFirstSameItemSynthesisChoiceDays.add(one)
  }
  heroSmithStoneGrantedDays.clear()
  for (const day of state.heroSmithStoneGrantedDays ?? []) {
    const one = Math.max(1, Math.round(Number(day) || 0))
    if (one > 0) heroSmithStoneGrantedDays.add(one)
  }
  heroAdventurerScrollGrantedDays.clear()
  for (const day of state.heroAdventurerScrollGrantedDays ?? []) {
    const one = Math.max(1, Math.round(Number(day) || 0))
    if (one > 0) heroAdventurerScrollGrantedDays.add(one)
  }
  heroCommanderMedalGrantedDays.clear()
  for (const day of state.heroCommanderMedalGrantedDays ?? []) {
    const one = Math.max(1, Math.round(Number(day) || 0))
    if (one > 0) heroCommanderMedalGrantedDays.add(one)
  }
  heroHeirGoldEquipGrantedDays.clear()
  for (const day of state.heroHeirGoldEquipGrantedDays ?? []) {
    const one = Math.max(1, Math.round(Number(day) || 0))
    if (one > 0) heroHeirGoldEquipGrantedDays.add(one)
  }
  heroTycoonGoldGrantedDays.clear()
  for (const day of state.heroTycoonGoldGrantedDays ?? []) {
    const one = Math.max(1, Math.round(Number(day) || 0))
    if (one > 0) heroTycoonGoldGrantedDays.add(one)
  }
  neutralObtainedCountByKind.clear()
  for (const row of state.neutralObtainedCounts ?? []) {
    const kind = String(row?.kind ?? '').trim()
    const count = Math.max(0, Math.round(Number(row?.count) || 0))
    if (!kind || count <= 0) continue
    neutralObtainedCountByKind.set(kind, count)
  }
  const savedNeutralPool = Array.isArray(state.neutralRandomCategoryPool)
    ? state.neutralRandomCategoryPool
    : []
  neutralRandomCategoryPool = savedNeutralPool
    .filter((v): v is 'stone' | 'scroll' | 'medal' => v === 'stone' || v === 'scroll' || v === 'medal')
  neutralDailyRollCountByDay.clear()
  for (const row of state.neutralDailyRollCounts ?? []) {
    const day = Math.max(1, Math.round(Number(row?.day) || 0))
    const count = Math.max(0, Math.round(Number(row?.count) || 0))
    if (day <= 0 || count <= 0) continue
    neutralDailyRollCountByDay.set(day, count)
  }
  neutralDailyRollCountByDay.clear()
  for (const row of state.neutralDailyRollCounts ?? []) {
    const day = Math.max(1, Math.round(Number(row?.day) || 0))
    const count = Math.max(0, Math.round(Number(row?.count) || 0))
    if (day <= 0 || count <= 0) continue
    neutralDailyRollCountByDay.set(day, count)
  }
  // 升级奖励持久化恢复
  levelRewardCategoryPool = Array.isArray(state.levelRewardCategoryPool)
    ? state.levelRewardCategoryPool.filter((v): v is 'stone' | 'scroll' | 'medal' => v === 'stone' || v === 'scroll' || v === 'medal')
    : []
  pendingLevelRewards = Array.isArray(state.pendingLevelRewards)
    ? state.pendingLevelRewards.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : []
  pendingHeroPeriodicRewards = Array.isArray(state.pendingHeroPeriodicRewards)
    ? state.pendingHeroPeriodicRewards
      .map((row) => {
        const itemId = String(row?.itemId ?? '').trim()
        const source = String(row?.source ?? '').trim() || '英雄奖励'
        const level = clampLevel(Number(row?.level ?? 1))
        const tier = (String(row?.tier ?? 'Bronze') as TierKey)
        const star = Math.max(1, Math.min(2, Math.round(Number(row?.star ?? 1)))) as 1 | 2
        if (!itemId) return null
        return { itemId, level, tier, star, source }
      })
      .filter((v): v is PendingHeroPeriodicReward => !!v)
    : []
  pendingHeroPeriodicRewardDispatching = false
  levelRewardObtainedByKind.clear()
  for (const row of state.levelRewardObtainedCounts ?? []) {
    const kind = String(row?.kind ?? '').trim()
    const count = Math.max(0, Math.round(Number(row?.count) || 0))
    if (!kind || count <= 0) continue
    levelRewardObtainedByKind.set(kind, count)
  }
  skill15NextBuyDiscountPrepared = state.skill15NextBuyDiscountPrepared === true
  skill15NextBuyDiscount = state.skill15NextBuyDiscount === true
  skill30BuyCounter = Math.max(0, Math.round(Number(state.skill30BuyCounter ?? 0) || 0))
  skill30NextBuyFree = state.skill30NextBuyFree === true
  quickBuyNoSynthRefreshStreak = Math.max(0, Math.round(Number(state.quickBuyNoSynthRefreshStreak ?? 0) || 0))
  quickBuyNeutralMissStreak = Math.max(0, Math.round(Number(state.quickBuyNeutralMissStreak ?? 0) || 0))
  if (!hasPickedSkill('skill15')) resetSkill15NextBuyDiscountState()
  if (!hasPickedSkill('skill30')) resetSkill30BundleState()
  nextQuickBuyOffer = (state.nextQuickBuyOffer && typeof state.nextQuickBuyOffer === 'object')
    ? {
      itemId: state.nextQuickBuyOffer.itemId,
      tier: state.nextQuickBuyOffer.tier,
      star: state.nextQuickBuyOffer.star,
      price: state.nextQuickBuyOffer.price,
    }
    : null
  shopManager.day = state.day
  shopManager.gold = state.gold
  shopManager.refreshIndex = state.refreshIndex
  syncUnlockPoolToManager()
  shopManager.pool = state.pool
    .map((s) => {
      const item = byId.get(s.itemId)
      if (!item) return null
      return { item, tier: s.tier, price: s.price, purchased: s.purchased }
    })
    .filter((v): v is ShopSlot => !!v)

  const oldBattle = battleSystem.getAllItems()
  const oldBackpack = backpackSystem.getAllItems()
  for (const it of oldBattle) battleView.removeItem(it.instanceId)
  for (const it of oldBackpack) backpackView.removeItem(it.instanceId)
  battleSystem.clear()
  backpackSystem.clear()
  instanceToDefId.clear()
  instanceToQuality.clear()
  instanceToLevel.clear()
  instanceToTier.clear()
  instanceToTierStar.clear()
  instanceToPermanentDamageBonus.clear()

  const restoreOne = (it: SavedPlacedItem, system: GridSystem, view: GridZone) => {
    system.place(it.col, it.row, it.size, it.defId, it.instanceId)
    instanceToDefId.set(it.instanceId, it.defId)
    const migratedLevel = typeof it.level === 'number'
      ? clampLevel(it.level)
      : levelFromLegacyTierStar(it.tier, normalizeTierStar(it.tier, it.tierStar))
    const migratedQuality = it.quality ?? deriveQualityByDefId(it.defId)
    setInstanceQualityLevel(it.instanceId, it.defId, migratedQuality, migratedLevel)
    instanceToPermanentDamageBonus.set(it.instanceId, Math.max(0, Math.round(it.permanentDamageBonus ?? 0)))
    const restoredTier = getInstanceTier(it.instanceId) ?? it.tier
    const restoredStar = getInstanceTierStar(it.instanceId)
    view.addItem(it.instanceId, it.defId, it.size, it.col, it.row, toVisualTier(restoredTier, restoredStar)).then(() => {
      view.setItemTier(it.instanceId, toVisualTier(restoredTier, restoredStar))
      drag?.refreshZone(view)
    })
  }

  for (const it of state.battleItems) restoreOne(it, battleSystem, battleView)
  for (const it of state.backpackItems) restoreOne(it, backpackSystem, backpackView)
  for (const defId of instanceToDefId.values()) unlockedItemIds.add(defId)
  syncUnlockPoolToManager()

  const maxId = Math.max(0, ...Array.from(instanceToDefId.keys()).map((id) => {
    const n = Number(id.replace('inst-', ''))
    return Number.isFinite(n) ? n : 0
  }))
  instCounter = Math.max(state.instCounter, maxId + 1)
}

let instCounter = 1
const nextId = () => `inst-${instCounter++}`

const instanceToDefId = new Map<string, string>()
const instanceToQuality = new Map<string, TierKey>()
const instanceToLevel = new Map<string, 1 | 2 | 3 | 4 | 5 | 6 | 7>()
const instanceToTier = new Map<string, TierKey>()
const instanceToTierStar = new Map<string, 1 | 2>()
const instanceToPermanentDamageBonus = new Map<string, number>()

function removeInstanceMeta(instanceId: string): void {
  instanceToDefId.delete(instanceId)
  instanceToQuality.delete(instanceId)
  instanceToLevel.delete(instanceId)
  instanceToTier.delete(instanceId)
  instanceToTierStar.delete(instanceId)
  instanceToPermanentDamageBonus.delete(instanceId)
}

function clampLevel(level: number): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return Math.max(1, Math.min(7, Math.round(level))) as 1 | 2 | 3 | 4 | 5 | 6 | 7
}

function getQualityLevelRange(quality: TierKey): { min: 1 | 2 | 3 | 4 | 5 | 6 | 7; max: 1 | 2 | 3 | 4 | 5 | 6 | 7 } {
  const cfg = getConfig().shopRules?.qualityLevelRange?.[quality]
  const defaultMin = quality === 'Bronze' ? 1 : quality === 'Silver' ? 2 : quality === 'Gold' ? 4 : 6
  const min = clampLevel(Number(cfg?.min ?? defaultMin))
  const max = clampLevel(Number(cfg?.max ?? 7))
  return { min, max: Math.max(min, max) as 1 | 2 | 3 | 4 | 5 | 6 | 7 }
}

function levelFromLegacyTierStar(tier: TierKey, star: 1 | 2): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return clampLevel(tierStarLevelIndex(tier, star) + 1)
}

function deriveQualityByDefId(defId: string): TierKey {
  const def = getItemDefById(defId)
  return parseTierName(def?.starting_tier ?? 'Bronze') ?? 'Bronze'
}

function setInstanceQualityLevel(instanceId: string, defId: string, quality?: TierKey, level?: number): void {
  const q = quality ?? deriveQualityByDefId(defId)
  const range = getQualityLevelRange(q)
  const lv = clampLevel(level ?? range.min)
  const boundedLevel = Math.max(range.min, Math.min(range.max, lv)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  instanceToQuality.set(instanceId, q)
  instanceToLevel.set(instanceId, boundedLevel)
  const legacy = levelToTierStar(boundedLevel)
  if (legacy) {
    instanceToTier.set(instanceId, legacy.tier)
    instanceToTierStar.set(instanceId, legacy.star)
  }
}

function getInstanceQuality(instanceId: string): TierKey {
  const q = instanceToQuality.get(instanceId)
  if (q) return q
  const defId = instanceToDefId.get(instanceId)
  if (!defId) return 'Bronze'
  const derived = deriveQualityByDefId(defId)
  instanceToQuality.set(instanceId, derived)
  return derived
}

function getInstanceLevel(instanceId: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const lv = instanceToLevel.get(instanceId)
  if (lv) return lv
  const legacyTier = instanceToTier.get(instanceId) ?? 'Bronze'
  const legacyStar = normalizeTierStar(legacyTier, instanceToTierStar.get(instanceId))
  const migrated = levelFromLegacyTierStar(legacyTier, legacyStar)
  instanceToLevel.set(instanceId, migrated)
  return migrated
}

type UpgradeMatch = {
  shopSlots: number[]
  battleIds: string[]
  backpackIds: string[]
  hasBackpackMatch: boolean
}

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

type SynthesisPreviewItem = {
  def: ItemDef
  tier: TierKey
  star: 1 | 2
}

const SYNTH_HIGHLIGHT_COLOR = 0xffcc44
const NEUTRAL_TAG_CN = '中立'

function getItemDefById(defId: string): ItemDef | undefined {
  return getAllItems().find((it) => it.id === defId)
}

function getPrimaryArchetype(rawTags: string): string {
  const first = String(rawTags || '').split('|')[0]?.trim() ?? ''
  return first.split('/')[0]?.trim() ?? ''
}

function getArchetypeCornerBadge(item: ItemDef): { label: string; fill: number; stroke: number } {
  const key = toSkillArchetype(getPrimaryArchetype(item.tags))
  if (key === 'warrior') return { label: '战士', fill: 0xc54a4a, stroke: 0xffc0c0 }
  if (key === 'archer') return { label: '弓手', fill: 0x2c8b50, stroke: 0xb5ffd0 }
  if (key === 'assassin') return { label: '刺客', fill: 0x3f5fb2, stroke: 0xc5d5ff }
  return { label: '中立', fill: 0x8d6a2f, stroke: 0xffe3ac }
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

function isNeutralArchetypeKey(raw: string): boolean {
  const key = String(raw || '').trim()
  return key === NEUTRAL_TAG_CN || key.toLowerCase() === 'neutral'
}

function isNeutralItemDef(item?: ItemDef | null): boolean {
  if (!item) return false
  return isNeutralArchetypeKey(getPrimaryArchetype(item.tags))
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

function hasPickedSkill(skillId: string): boolean {
  return pickedSkills.some((s) => s.id === skillId)
}

function resetSkill15NextBuyDiscountState(): void {
  skill15NextBuyDiscountPrepared = false
  skill15NextBuyDiscount = false
}

function resetSkill30BundleState(): void {
  skill30BuyCounter = 0
  skill30NextBuyFree = false
}

function ensureSkill15NextBuyDiscountReady(): void {
  if (!hasPickedSkill('skill15')) {
    resetSkill15NextBuyDiscountState()
    return
  }
  if (skill15NextBuyDiscountPrepared) return
  skill15NextBuyDiscountPrepared = true
  skill15NextBuyDiscount = Math.random() < 0.25
}

function resolveBuyPriceWithSkills(basePrice: number): { finalPrice: number; discount: number; freeBySkill30: boolean } {
  const safeBase = Math.max(1, Math.round(basePrice))

  if (hasPickedSkill('skill30') && skill30NextBuyFree) {
    return {
      finalPrice: 0,
      discount: safeBase,
      freeBySkill30: true,
    }
  }

  ensureSkill15NextBuyDiscountReady()
  if (!hasPickedSkill('skill15')) return { finalPrice: safeBase, discount: 0, freeBySkill30: false }
  if (!skill15NextBuyDiscount) return { finalPrice: safeBase, discount: 0, freeBySkill30: false }
  const finalPrice = Math.max(1, safeBase - 1)
  return { finalPrice, discount: safeBase - finalPrice, freeBySkill30: false }
}

function consumeSkill15NextBuyDiscountAfterSuccess(): boolean {
  if (!hasPickedSkill('skill15')) {
    resetSkill15NextBuyDiscountState()
    return false
  }
  ensureSkill15NextBuyDiscountReady()
  const consumedDiscount = skill15NextBuyDiscount
  skill15NextBuyDiscountPrepared = false
  skill15NextBuyDiscount = false
  ensureSkill15NextBuyDiscountReady()
  return consumedDiscount
}

function consumeSkill30BundleAfterSuccess(consumedFreeBuy: boolean): boolean {
  if (!hasPickedSkill('skill30')) {
    resetSkill30BundleState()
    return false
  }

  if (consumedFreeBuy) {
    skill30NextBuyFree = false
    skill30BuyCounter = 1
    return true
  }

  skill30BuyCounter += 1
  if (skill30BuyCounter >= 4) {
    skill30BuyCounter = 0
    skill30NextBuyFree = true
    return true
  }
  return false
}

function getShopSlotPreviewPrice(slot: ShopSlot): number {
  return resolveBuyPriceWithSkills(slot.price).finalPrice
}

function canAffordShopSlot(slot: ShopSlot): boolean {
  if (!shopManager || slot.purchased) return false
  return shopManager.gold >= getShopSlotPreviewPrice(slot)
}

function upsertPickedSkill(skillId: string): void {
  const found = getBronzeSkillById(skillId) ?? getSilverSkillById(skillId) ?? getGoldSkillById(skillId)
  if (!found) return
  if (hasPickedSkill(skillId)) return
  pickedSkills = [...pickedSkills, {
    id: found.id,
    name: found.name,
    archetype: found.archetype,
    desc: found.desc,
    detailDesc: found.detailDesc,
    tier: found.tier,
    icon: found.icon,
  }]
  if (skillId === 'skill15') ensureSkill15NextBuyDiscountReady()
  if (skillId === 'skill20') grantSkill20DailyBronzeItemIfNeeded()
}

function removePickedSkill(skillId: string): void {
  pickedSkills = pickedSkills.filter((s) => s.id !== skillId)
  if (skillDetailSkillId === skillId) {
    skillDetailSkillId = null
    skillDetailMode = getDefaultSkillDetailMode()
  }
  if (skillId === 'skill15') resetSkill15NextBuyDiscountState()
  if (skillId === 'skill30') resetSkill30BundleState()
}

function tryBuyShopSlotWithSkill(slot: ShopSlot): { ok: boolean; finalPrice: number; discount: number } {
  if (!shopManager || slot.purchased) return { ok: false, finalPrice: slot.price, discount: 0 }
  if (dayEventState.forceBuyArchetype && dayEventState.forceBuyRemaining > 0) {
    const currentArch = toSkillArchetype(getPrimaryArchetype(slot.item.tags))
    if (currentArch !== dayEventState.forceBuyArchetype) {
      const candidates = getAllItems().filter((it) => {
        if (!parseAvailableTiers(it.available_tiers).includes(slot.tier)) return false
        return toSkillArchetype(getPrimaryArchetype(it.tags)) === dayEventState.forceBuyArchetype
      })
      const replacement = candidates[Math.floor(Math.random() * candidates.length)]
      if (replacement) {
        slot.item = replacement
        slot.price = shopManager.getItemPrice(replacement, slot.tier)
      }
    }
  }
  const priced = resolveBuyPriceWithSkills(slot.price)
  if (shopManager.gold < priced.finalPrice) return { ok: false, finalPrice: priced.finalPrice, discount: priced.discount }
  shopManager.gold -= priced.finalPrice
  slot.purchased = true
  if (dayEventState.forceBuyRemaining > 0) {
    dayEventState.forceBuyRemaining = Math.max(0, dayEventState.forceBuyRemaining - 1)
    if (dayEventState.forceBuyRemaining <= 0) dayEventState.forceBuyArchetype = null
  }
  if (consumeSkill15NextBuyDiscountAfterSuccess()) showHintToast('no_gold_buy', '砍价高手触发：本次-1G', 0x8ff0b0)
  const skill30Ready = consumeSkill30BundleAfterSuccess(priced.freeBySkill30)
  if (priced.freeBySkill30) showHintToast('no_gold_buy', '打包购买触发：本次0金币', 0x9be5ff)
  else if (skill30Ready) showHintToast('no_gold_buy', '打包购买就绪：下次购买0金币', 0x9be5ff)
  updateNeutralPseudoRandomCounterOnPurchase(slot.item)
  return { ok: true, finalPrice: priced.finalPrice, discount: priced.discount }
}

function closeSkillTestOverlay(): void {
  if (!skillTestOverlay) return
  if (skillTestOverlay.parent) skillTestOverlay.parent.removeChild(skillTestOverlay)
  skillTestOverlay.destroy({ children: true })
  skillTestOverlay = null
}

function closeEventTestOverlay(): void {
  if (!eventTestOverlay) return
  if (eventTestOverlay.parent) eventTestOverlay.parent.removeChild(eventTestOverlay)
  eventTestOverlay.destroy({ children: true })
  eventTestOverlay = null
}

function closeItemTestOverlay(): void {
  if (!itemTestOverlay) return
  if (itemTestOverlay.parent) itemTestOverlay.parent.removeChild(itemTestOverlay)
  itemTestOverlay.destroy({ children: true })
  itemTestOverlay = null
}

function closeEventDraftOverlay(): void {
  if (!eventDraftOverlay) return
  if (eventDraftOverlay.parent) eventDraftOverlay.parent.removeChild(eventDraftOverlay)
  eventDraftOverlay.destroy({ children: true })
  eventDraftOverlay = null
}

function closeSpecialShopOverlay(): void {
  setSpecialShopBackpackViewActive(false)
  specialShopOverlayActionRefresh = null
  if (!specialShopOverlay) return
  if (specialShopOverlay.parent) specialShopOverlay.parent.removeChild(specialShopOverlay)
  specialShopOverlay.destroy({ children: true })
  specialShopOverlay = null
}

function setBaseShopPrimaryButtonsVisible(visible: boolean): void {
  if (bpBtnHandle) bpBtnHandle.container.visible = visible
  if (refreshBtnHandle) refreshBtnHandle.container.visible = visible
  if (sellBtnHandle) sellBtnHandle.container.visible = visible
  if (phaseBtnHandle) phaseBtnHandle.container.visible = visible
}

function getSpecialBulkSellUnitPriceByLevel(level: number): number {
  if (level <= 1) return 3
  if (level === 2) return 5
  if (level === 3) return 10
  if (level === 4) return 18
  if (level === 5) return 36
  if (level === 6) return 64
  return 128
}

function getSpecialBulkSellPriceByInstance(instanceId: string): number {
  const tier = getInstanceTier(instanceId) ?? 'Bronze'
  const star = getInstanceTierStar(instanceId)
  const level = tierStarLevelIndex(tier, star) + 1
  return getSpecialBulkSellUnitPriceByLevel(level)
}

function getSpecialBulkSellTotalPrice(): number {
  let sum = 0
  for (const id of specialShopCheckedInstanceIds) {
    sum += getSpecialBulkSellPriceByInstance(id)
  }
  return Math.max(0, Math.round(sum))
}

function clearSpecialShopCheckLayer(): void {
  if (!specialShopCheckLayer) return
  if (specialShopCheckLayer.parent) specialShopCheckLayer.parent.removeChild(specialShopCheckLayer)
  specialShopCheckLayer.destroy({ children: true })
  specialShopCheckLayer = null
}

function renderSpecialShopCheckMarks(): void {
  clearSpecialShopCheckLayer()
  if (!specialShopBackpackViewActive) return
  const stage = getApp().stage
  const layer = new Container()
  layer.zIndex = 3490
  layer.eventMode = 'none'

  for (const id of specialShopCheckedInstanceIds) {
    const inBattle = !!battleSystem?.getItem(id)
    const system = inBattle ? battleSystem : backpackSystem
    const view = inBattle ? battleView : backpackView
    const placed = system?.getItem(id)
    if (!system || !view || !placed) continue
    const topLeft = view.cellToLocal(placed.col, placed.row)
    const cols = getSizeCols(placed.size)
    const gpos = view.toGlobal({
      x: topLeft.x + cols * CELL_SIZE - 18,
      y: topLeft.y + 16,
    })
    const spos = stage.toLocal(gpos)

    const mark = new Container()
    mark.x = spos.x
    mark.y = spos.y
    const dot = new Graphics()
    dot.circle(0, 0, 16)
    dot.fill({ color: 0x2ac96b, alpha: 0.96 })
    dot.stroke({ color: 0x0b2b1a, width: 2, alpha: 0.95 })
    const txt = new Text({
      text: '✓',
      style: { fontSize: 22, fill: 0xf6fff9, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    txt.anchor.set(0.5)
    txt.y = -1
    mark.addChild(dot, txt)
    layer.addChild(mark)
  }

  stage.addChild(layer)
  specialShopCheckLayer = layer
}

function setSpecialShopBackpackViewActive(active: boolean): void {
  specialShopBackpackViewActive = active
  if (!active) {
    specialShopCheckedInstanceIds.clear()
    clearSpecialShopCheckLayer()
  }
}

function handleSpecialShopBackpackItemTap(instanceId: string, kind: 'battle' | 'backpack'): void {
  if (!shopManager || !sellPopup) return
  const defId = instanceToDefId.get(instanceId)
  if (!defId) return
  const item = getItemDefById(defId)
  if (!item) return
  const tier = getInstanceTier(instanceId)
  const star = getInstanceTierStar(instanceId)

  if (specialShopCheckedInstanceIds.has(instanceId)) specialShopCheckedInstanceIds.delete(instanceId)
  else specialShopCheckedInstanceIds.add(instanceId)

  battleView?.setSelected(kind === 'battle' ? instanceId : null)
  backpackView?.setSelected(kind === 'backpack' ? instanceId : null)
  shopPanel?.setSelectedSlot(-1)
  currentSelection = kind === 'battle' ? { kind: 'battle', instanceId } : { kind: 'backpack', instanceId }
  selectedSellAction = null

  const picked = specialShopCheckedInstanceIds.has(instanceId)
  const onePrice = getSpecialBulkSellPriceByInstance(instanceId)
  const total = getSpecialBulkSellTotalPrice()
  const customDisplay: ItemInfoCustomDisplay = {
    overrideName: `${item.name_cn}${picked ? '（已勾选）' : '（未勾选）'}`,
    lines: [`点击${picked ? '取消勾选' : '勾选'}该物品`, `单价 ${onePrice}G`, `当前总价 ${total}G`],
  }
  sellPopup.show(item, 0, 'none', toVisualTier(tier, star), undefined, 'detailed', undefined, customDisplay)
  renderSpecialShopCheckMarks()
  specialShopOverlayActionRefresh?.()
  refreshShopUI()
}

function executeSpecialShopBulkSell(): void {
  if (!shopManager) return
  if (specialShopCheckedInstanceIds.size <= 0) {
    showHintToast('no_gold_buy', '请先勾选要出售的物品', 0xffd48f)
    return
  }
  let sold = 0
  let total = 0
  for (const id of [...specialShopCheckedInstanceIds]) {
    const inBattle = !!battleSystem?.getItem(id)
    const system = inBattle ? battleSystem : backpackSystem
    const view = inBattle ? battleView : backpackView
    const placed = system?.getItem(id)
    if (!system || !view || !placed) continue
    total += getSpecialBulkSellPriceByInstance(id)
    system.remove(id)
    view.removeItem(id)
    removeInstanceMeta(id)
    sold += 1
  }
  if (sold > 0) {
    shopManager.gold += Math.max(0, Math.round(total))
    specialShopCheckedInstanceIds.clear()
    clearSelection()
    renderSpecialShopCheckMarks()
    specialShopOverlayActionRefresh?.()
    refreshShopUI()
    showHintToast('no_gold_buy', `已批量出售${sold}件，获得${Math.round(total)}G`, 0xa8f0b6)
    saveShopStateToStorage(captureShopState())
    checkAndPopPendingRewards()
  }
}
void getSpecialBulkSellTotalPrice
void renderSpecialShopCheckMarks
void setSpecialShopBackpackViewActive

function closeSettingsOverlay(): void {
  closeSkillTestOverlay()
  closeEventTestOverlay()
  closeItemTestOverlay()
  if (!settingsOverlay) return
  if (settingsOverlay.parent) settingsOverlay.parent.removeChild(settingsOverlay)
  settingsOverlay.destroy({ children: true })
  settingsOverlay = null
}

function setupOverlayListDragScroll(
  panel: Container,
  listCon: Container,
  viewportRect: { x: number; y: number; w: number; h: number },
  getContentBottomY: () => number,
): () => void {
  const clip = new Graphics()
  clip.rect(viewportRect.x, viewportRect.y, viewportRect.w, viewportRect.h)
  clip.fill({ color: 0xffffff, alpha: 1 })
  panel.addChild(clip)
  listCon.mask = clip

  let scrollOffsetY = 0
  let maybeDragging = false
  let dragging = false
  let dragStartY = 0
  let dragStartOffsetY = 0

  const isInViewport = (gx: number, gy: number): boolean => {
    const p = panel.toLocal({ x: gx, y: gy })
    return p.x >= viewportRect.x && p.x <= viewportRect.x + viewportRect.w
      && p.y >= viewportRect.y && p.y <= viewportRect.y + viewportRect.h
  }

  const clampScroll = () => {
    const contentBottomY = getContentBottomY()
    const contentHeight = Math.max(0, contentBottomY - viewportRect.y)
    const maxScroll = Math.max(0, contentHeight - viewportRect.h)
    scrollOffsetY = Math.max(-maxScroll, Math.min(0, scrollOffsetY))
    listCon.y = scrollOffsetY
  }

  panel.on('pointerdown', (e: FederatedPointerEvent) => {
    if (!isInViewport(e.global.x, e.global.y)) return
    maybeDragging = true
    dragging = false
    dragStartY = e.global.y
    dragStartOffsetY = scrollOffsetY
  })
  panel.on('pointermove', (e: FederatedPointerEvent) => {
    if (!maybeDragging && !dragging) return
    if (!dragging && Math.abs(e.global.y - dragStartY) >= 8) dragging = true
    if (!dragging) return
    scrollOffsetY = dragStartOffsetY + (e.global.y - dragStartY)
    clampScroll()
  })
  const stopDrag = () => {
    maybeDragging = false
    dragging = false
  }
  panel.on('pointerup', stopDrag)
  panel.on('pointerupoutside', stopDrag)
  panel.on('wheel', (e: any) => {
    const gx = Number(e?.global?.x ?? e?.x ?? 0)
    const gy = Number(e?.global?.y ?? e?.y ?? 0)
    if (!isInViewport(gx, gy)) return
    e.stopPropagation?.()
    const dy = Number(e?.deltaY ?? 0)
    if (!Number.isFinite(dy) || dy === 0) return
    scrollOffsetY -= dy * 0.9
    clampScroll()
  })

  clampScroll()
  return clampScroll
}

function openSkillTestOverlay(): void {
  closeSkillTestOverlay()
  const stage = getApp().stage
  const overlay = new Container()
  overlay.zIndex = 7400
  overlay.eventMode = 'static'
  overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

  const mask = new Graphics()
  mask.rect(0, 0, CANVAS_W, CANVAS_H)
  mask.fill({ color: 0x020409, alpha: 0.68 })
  overlay.addChild(mask)

  const panel = new Container()
  panel.x = CANVAS_W / 2
  panel.y = CANVAS_H / 2
  panel.eventMode = 'static'
  panel.on('pointerdown', (e) => e.stopPropagation())
  overlay.addChild(panel)

  const panelW = 600
  const panelH = 1180
  const bg = new Graphics()
  bg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 24)
  bg.fill({ color: 0x121d34, alpha: 0.98 })
  bg.stroke({ color: 0x9ec2ff, width: 3, alpha: 0.95 })
  panel.addChild(bg)

  const title = new Text({
    text: '技能测试（青铜/白银/黄金）',
    style: { fontSize: 38, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  title.anchor.set(0.5)
  title.y = -442
  panel.addChild(title)

  const subtitle = new Text({
    text: '点击开关可即时加/去技能（仅本局）',
    style: { fontSize: 20, fill: 0xa8bddf, fontFamily: 'Arial' },
  })
  subtitle.anchor.set(0.5)
  subtitle.y = -398
  panel.addChild(subtitle)

  let selectedTier: 'bronze' | 'silver' | 'gold' = 'bronze'
  const tierTabsCon = new Container()
  tierTabsCon.y = -352
  panel.addChild(tierTabsCon)

  const listCon = new Container()
  panel.addChild(listCon)
  let listBottomY = -300
  const refreshListScroll = setupOverlayListDragScroll(
    panel,
    listCon,
    { x: -276, y: -320, w: 552, h: 820 },
    () => listBottomY,
  )

  const drawTabs = () => {
    tierTabsCon.removeChildren().forEach((c) => c.destroy({ children: true }))
    const makeTab = (x: number, key: 'bronze' | 'silver' | 'gold', label: string) => {
      const on = selectedTier === key
      const tab = new Container()
      tab.x = x
      tab.eventMode = 'static'
      tab.cursor = 'pointer'
      const bgTab = new Graphics()
      bgTab.roundRect(-90, -20, 180, 40, 12)
      bgTab.fill({ color: on ? 0x6da7ff : 0x304a76, alpha: 0.96 })
      bgTab.stroke({ color: 0xcfe1ff, width: on ? 3 : 2, alpha: 0.9 })
      const tx = new Text({
        text: label,
        style: { fontSize: 20, fill: 0xf5fbff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      tx.anchor.set(0.5)
      tab.on('pointerdown', (e) => {
        e.stopPropagation()
        if (selectedTier === key) return
        selectedTier = key
        drawTabs()
        drawRows()
      })
      tab.addChild(bgTab, tx)
      tierTabsCon.addChild(tab)
    }
    makeTab(-180, 'bronze', '青铜')
    makeTab(0, 'silver', '白银')
    makeTab(180, 'gold', '黄金')
  }

  const drawRows = () => {
    listCon.removeChildren().forEach((c) => c.destroy({ children: true }))
    const list = selectedTier === 'bronze'
      ? BRONZE_SKILL_PICKS
      : selectedTier === 'silver'
        ? SILVER_SKILL_PICKS
        : GOLD_SKILL_PICKS
    const listTop = -300
    const rowH = 40
    listBottomY = listTop + Math.max(0, list.length - 1) * rowH + 18
    list.forEach((skill, idx) => {
      const y = listTop + idx * rowH
      const rowBg = new Graphics()
      rowBg.roundRect(-268, y - 18, 536, 34, 10)
      rowBg.fill({ color: idx % 2 === 0 ? 0x172844 : 0x15233c, alpha: 0.72 })
      listCon.addChild(rowBg)

      const label = new Text({
        text: `${skill.id} ${skill.name}`,
        style: { fontSize: 18, fill: 0xe0ebff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      label.x = -248
      label.y = y - label.height / 2
      listCon.addChild(label)

      const btn = new Container()
      btn.x = 195
      btn.y = y
      btn.eventMode = 'static'
      btn.cursor = 'pointer'
      const b = new Graphics()
      const t = new Text({
        text: '',
        style: { fontSize: 18, fill: 0x0f1c33, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      t.anchor.set(0.5)
      const redraw = () => {
        const on = hasPickedSkill(skill.id)
        b.clear()
        b.roundRect(-52, -14, 104, 28, 10)
        b.fill({ color: on ? 0x74dc9b : 0xa8b6cc, alpha: 0.98 })
        b.stroke({ color: 0x0d1426, width: 2, alpha: 0.95 })
        t.text = on ? '已开启' : '已关闭'
      }
      redraw()
      btn.on('pointerdown', (e) => {
        e.stopPropagation()
        if (hasPickedSkill(skill.id)) removePickedSkill(skill.id)
        else upsertPickedSkill(skill.id)
        redraw()
        refreshSkillIconBar()
        refreshShopUI()
        saveShopStateToStorage(captureShopState())
      })
      btn.addChild(b, t)
      listCon.addChild(btn)
    })
    refreshListScroll()
  }

  drawTabs()
  drawRows()

  const closeBtn = new Container()
  closeBtn.x = 0
  closeBtn.y = 540
  closeBtn.eventMode = 'static'
  closeBtn.cursor = 'pointer'
  const closeBg = new Graphics()
  closeBg.roundRect(-122, -30, 244, 60, 18)
  closeBg.fill({ color: 0x2d446c, alpha: 0.96 })
  closeBg.stroke({ color: 0xa7c6ff, width: 3, alpha: 0.95 })
  const closeText = new Text({ text: '关闭', style: { fontSize: 28, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' } })
  closeText.anchor.set(0.5)
  closeBtn.on('pointerdown', (e) => {
    e.stopPropagation()
    closeSkillTestOverlay()
  })
  closeBtn.addChild(closeBg, closeText)
  panel.addChild(closeBtn)

  overlay.on('pointerdown', () => closeSkillTestOverlay())
  stage.addChild(overlay)
  skillTestOverlay = overlay
}

function openEventTestOverlay(): void {
  closeEventTestOverlay()
  const stage = getApp().stage
  const overlay = new Container()
  overlay.zIndex = 7420
  overlay.eventMode = 'static'
  overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

  const mask = new Graphics()
  mask.rect(0, 0, CANVAS_W, CANVAS_H)
  mask.fill({ color: 0x020409, alpha: 0.7 })
  overlay.addChild(mask)

  const panel = new Container()
  panel.x = CANVAS_W / 2
  panel.y = CANVAS_H / 2
  panel.eventMode = 'static'
  panel.on('pointerdown', (e) => e.stopPropagation())
  overlay.addChild(panel)

  const panelW = 610
  const panelH = 1180
  const bg = new Graphics()
  bg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 24)
  bg.fill({ color: 0x13213a, alpha: 0.98 })
  bg.stroke({ color: 0x9ec2ff, width: 3, alpha: 0.95 })
  panel.addChild(bg)

  const title = new Text({
    text: '事件测试（按钮触发）',
    style: { fontSize: 38, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  title.anchor.set(0.5)
  title.y = -446
  panel.addChild(title)

  const subtitle = new Text({
    text: '点击“触发”执行事件；可重置已选次数',
    style: { fontSize: 20, fill: 0xa8bddf, fontFamily: 'Arial' },
  })
  subtitle.anchor.set(0.5)
  subtitle.y = -402
  panel.addChild(subtitle)

  const resetBtn = new Container()
  resetBtn.y = -356
  resetBtn.eventMode = 'static'
  resetBtn.cursor = 'pointer'
  const resetBg = new Graphics()
  resetBg.roundRect(-188, -22, 376, 44, 12)
  resetBg.fill({ color: 0x3d5d93, alpha: 0.96 })
  resetBg.stroke({ color: 0xbad6ff, width: 2, alpha: 0.95 })
  const resetTxt = new Text({
    text: '重置事件已选次数（本局）',
    style: { fontSize: 20, fill: 0xf5faff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  resetTxt.anchor.set(0.5)
  resetBtn.addChild(resetBg, resetTxt)
  panel.addChild(resetBtn)

  const listCon = new Container()
  panel.addChild(listCon)
  let listBottomY = -304
  const refreshListScroll = setupOverlayListDragScroll(
    panel,
    listCon,
    { x: -276, y: -322, w: 552, h: 820 },
    () => listBottomY,
  )

  const drawRows = () => {
    listCon.removeChildren().forEach((c) => c.destroy({ children: true }))
    const rows = getEventPoolRows()
    const topY = -304
    const rowH = 42
    listBottomY = topY + Math.max(0, rows.length - 1) * rowH + 18
    rows.forEach((event, idx) => {
      const y = topY + idx * rowH
      const rowBg = new Graphics()
      rowBg.roundRect(-276, y - 18, 552, 34, 10)
      rowBg.fill({ color: idx % 2 === 0 ? 0x172844 : 0x15233c, alpha: 0.72 })
      listCon.addChild(rowBg)

      const cnt = getSelectedEventCount(event.id)
      const limit = event.limits?.maxSelectionsPerRun
      const right = event.lane === 'left' ? '左' : '右'
      const suffix = typeof limit === 'number' && limit > 0 ? ` ${cnt}/${Math.round(limit)}` : ` ${cnt}`
      const label = new Text({
        text: `${event.id} [${right}] ${event.shortDesc}${suffix}`,
        style: { fontSize: 16, fill: 0xe0ebff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      label.x = -248
      label.y = y - label.height / 2
      listCon.addChild(label)

      const btn = new Container()
      btn.x = 214
      btn.y = y
      btn.eventMode = 'static'
      btn.cursor = 'pointer'
      const b = new Graphics()
      const t = new Text({
        text: '触发',
        style: { fontSize: 16, fill: 0x0f1c33, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      t.anchor.set(0.5)
      const canPick = isEventChoiceAvailable(event, currentDay)
      b.roundRect(-40, -14, 80, 28, 10)
      b.fill({ color: canPick ? 0x74dc9b : 0xa8b6cc, alpha: 0.98 })
      b.stroke({ color: 0x0d1426, width: 2, alpha: 0.95 })
      btn.on('pointerdown', (e) => {
        e.stopPropagation()
        const ok = applyEventEffect(event, true)
        if (ok) {
          markEventSelected(event.id)
          refreshShopUI()
          saveShopStateToStorage(captureShopState())
        } else {
          showHintToast('no_gold_buy', `[测试] 事件未生效：${event.shortDesc}`, 0xffb27a)
        }
        drawRows()
      })
      btn.addChild(b, t)
      listCon.addChild(btn)
    })
    refreshListScroll()
  }

  resetBtn.on('pointerdown', (e) => {
    e.stopPropagation()
    resetEventSelectionCounters()
    draftedEventDays = []
    pendingEventDraft = null
    saveShopStateToStorage(captureShopState())
    showHintToast('no_gold_buy', '[测试] 已重置事件次数', 0x9be5ff)
    drawRows()
  })

  drawRows()

  const closeBtn = new Container()
  closeBtn.x = 0
  closeBtn.y = 540
  closeBtn.eventMode = 'static'
  closeBtn.cursor = 'pointer'
  const closeBg = new Graphics()
  closeBg.roundRect(-122, -30, 244, 60, 18)
  closeBg.fill({ color: 0x2d446c, alpha: 0.96 })
  closeBg.stroke({ color: 0xa7c6ff, width: 3, alpha: 0.95 })
  const closeText = new Text({ text: '关闭', style: { fontSize: 28, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' } })
  closeText.anchor.set(0.5)
  closeBtn.on('pointerdown', (e) => {
    e.stopPropagation()
    closeEventTestOverlay()
  })
  closeBtn.addChild(closeBg, closeText)
  panel.addChild(closeBtn)

  overlay.on('pointerdown', () => closeEventTestOverlay())
  stage.addChild(overlay)
  eventTestOverlay = overlay
}

function addAllPossibleLevelsForTest(def: ItemDef): boolean {
  const quality = parseTierName(def.starting_tier) ?? 'Bronze'
  const range = getQualityLevelRange(quality)
  let okCount = 0
  for (let lv = range.min; lv <= range.max; lv++) {
    const legacy = levelToTierStar(lv)
    if (!legacy) continue
    if (placeItemToInventoryOrBattle(def, legacy.tier, legacy.star)) okCount += 1
  }
  if (okCount <= 0) {
    showHintToast('backpack_full_buy', `[测试] 添加失败：${def.name_cn}（空间不足）`, 0xffb27a)
    return false
  }
  const totalNeed = range.max - range.min + 1
  const msg = okCount >= totalNeed
    ? `[测试] 已添加：${def.name_cn} 全等级（Lv${range.min}-Lv${range.max}）`
    : `[测试] 已添加：${def.name_cn} ${okCount}/${totalNeed} 个等级（空间不足）`
  showHintToast('no_gold_buy', msg, 0x9be5ff)
  refreshShopUI()
  saveShopStateToStorage(captureShopState())
  return true
}

function addMinLevelForTest(def: ItemDef): boolean {
  const quality = parseTierName(def.starting_tier) ?? 'Bronze'
  const range = getQualityLevelRange(quality)
  const legacy = levelToTierStar(range.min)
  if (!legacy) return false
  const ok = placeItemToInventoryOrBattle(def, legacy.tier, legacy.star)
  if (!ok) {
    showHintToast('backpack_full_buy', `[测试] 添加失败：${def.name_cn}（空间不足）`, 0xffb27a)
    return false
  }
  showHintToast('no_gold_buy', `[测试] 已添加：${def.name_cn} 最低等级（Lv${range.min}）`, 0x9be5ff)
  refreshShopUI()
  saveShopStateToStorage(captureShopState())
  return true
}

function openItemTestOverlay(): void {
  closeItemTestOverlay()
  const stage = getApp().stage
  const overlay = new Container()
  overlay.zIndex = 7440
  overlay.eventMode = 'static'
  overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

  const mask = new Graphics()
  mask.rect(0, 0, CANVAS_W, CANVAS_H)
  mask.fill({ color: 0x020409, alpha: 0.7 })
  overlay.addChild(mask)

  const panel = new Container()
  panel.x = CANVAS_W / 2
  panel.y = CANVAS_H / 2
  panel.eventMode = 'static'
  panel.on('pointerdown', (e) => e.stopPropagation())
  overlay.addChild(panel)

  const panelW = 610
  const panelH = 1180
  const bg = new Graphics()
  bg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 24)
  bg.fill({ color: 0x13213a, alpha: 0.98 })
  bg.stroke({ color: 0x9ec2ff, width: 3, alpha: 0.95 })
  panel.addChild(bg)

  const title = new Text({
    text: '物品测试（手动添加）',
    style: { fontSize: 38, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  title.anchor.set(0.5)
  title.y = -446
  panel.addChild(title)

  const subtitle = new Text({
    text: '按职业分页后，点击“最低级/全等级”可添加物品',
    style: { fontSize: 20, fill: 0xa8bddf, fontFamily: 'Arial' },
  })
  subtitle.anchor.set(0.5)
  subtitle.y = -402
  panel.addChild(subtitle)

  const listCon = new Container()
  panel.addChild(listCon)
  let listBottomY = -300
  const refreshListScroll = setupOverlayListDragScroll(
    panel,
    listCon,
    { x: -276, y: -316, w: 552, h: 816 },
    () => listBottomY,
  )

  type ItemTestPage = 'all' | 'warrior' | 'archer' | 'assassin' | 'neutral'
  let activePage: ItemTestPage = 'all'

  const all = [...getAllItems()].sort((a, b) => {
    const ta = parseTierName(a.starting_tier) ?? 'Bronze'
    const tb = parseTierName(b.starting_tier) ?? 'Bronze'
    const order = { Bronze: 0, Silver: 1, Gold: 2, Diamond: 3 }
    const diff = (order[ta] ?? 0) - (order[tb] ?? 0)
    if (diff !== 0) return diff
    return a.name_cn.localeCompare(b.name_cn, 'zh-Hans-CN')
  })

  const pageTabs: Array<{ key: ItemTestPage; label: string }> = [
    { key: 'all', label: '全部' },
    { key: 'warrior', label: '战士' },
    { key: 'archer', label: '弓手' },
    { key: 'assassin', label: '刺客' },
    { key: 'neutral', label: '中立' },
  ]

  const pageBtnByKey = new Map<ItemTestPage, { bg: Graphics; text: Text }>()
  const pageCon = new Container()
  pageCon.y = -352
  panel.addChild(pageCon)

  const getPageItems = (): ItemDef[] => {
    if (activePage === 'all') return all
    return all.filter((def) => {
      const arch = getPrimaryArchetype(def.tags)
      if (activePage === 'warrior') return arch === '战士'
      if (activePage === 'archer') return arch === '弓手'
      if (activePage === 'assassin') return arch === '刺客'
      return isNeutralArchetypeKey(arch)
    })
  }

  const topY = -300
  const rowH = 38
  const drawList = () => {
    const old = listCon.removeChildren()
    old.forEach((child) => child.destroy())
    const items = getPageItems()
    listBottomY = topY + Math.max(0, items.length - 1) * rowH + 16
    for (let idx = 0; idx < items.length; idx++) {
      const def = items[idx]!
      const y = topY + idx * rowH
      const rowBg = new Graphics()
      rowBg.roundRect(-276, y - 16, 552, 32, 10)
      rowBg.fill({ color: idx % 2 === 0 ? 0x172844 : 0x15233c, alpha: 0.72 })
      listCon.addChild(rowBg)

      const tier = parseTierName(def.starting_tier) ?? 'Bronze'
      const label = new Text({
        text: `${def.name_cn}（${tier}）`,
        style: { fontSize: 16, fill: 0xe0ebff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      label.x = -248
      label.y = y - label.height / 2
      listCon.addChild(label)

      const minBtn = new Container()
      minBtn.x = 136
      minBtn.y = y
      minBtn.eventMode = 'static'
      minBtn.cursor = 'pointer'
      const minBg = new Graphics()
      minBg.roundRect(-36, -14, 72, 28, 10)
      minBg.fill({ color: 0x96c7ff, alpha: 0.98 })
      minBg.stroke({ color: 0x0d1426, width: 2, alpha: 0.95 })
      const minText = new Text({
        text: '最低级',
        style: { fontSize: 14, fill: 0x0f1c33, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      minText.anchor.set(0.5)
      minBtn.on('pointerdown', (e) => {
        e.stopPropagation()
        addMinLevelForTest(def)
      })
      minBtn.addChild(minBg, minText)
      listCon.addChild(minBtn)

      const allBtn = new Container()
      allBtn.x = 220
      allBtn.y = y
      allBtn.eventMode = 'static'
      allBtn.cursor = 'pointer'
      const allBg = new Graphics()
      allBg.roundRect(-40, -14, 80, 28, 10)
      allBg.fill({ color: 0x74dc9b, alpha: 0.98 })
      allBg.stroke({ color: 0x0d1426, width: 2, alpha: 0.95 })
      const allText = new Text({
        text: '全等级',
        style: { fontSize: 16, fill: 0x0f1c33, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      allText.anchor.set(0.5)
      allBtn.on('pointerdown', (e) => {
        e.stopPropagation()
        addAllPossibleLevelsForTest(def)
      })
      allBtn.addChild(allBg, allText)
      listCon.addChild(allBtn)
    }
    refreshListScroll()
  }

  const redrawPageTabs = () => {
    for (const row of pageTabs) {
      const view = pageBtnByKey.get(row.key)
      if (!view) continue
      const selected = row.key === activePage
      view.bg.clear()
      view.bg.roundRect(-50, -17, 100, 34, 12)
      view.bg.fill({ color: selected ? 0x7cc6ff : 0x2a4068, alpha: 0.96 })
      view.bg.stroke({ color: selected ? 0xe9f6ff : 0x9ec2ff, width: selected ? 3 : 2, alpha: 0.95 })
      view.text.style.fill = selected ? 0x0f1c33 : 0xeaf3ff
    }
  }

  const totalW = pageTabs.length * 108 - 8
  pageTabs.forEach((row, idx) => {
    const btn = new Container()
    btn.x = -totalW / 2 + idx * 108 + 50
    btn.y = 0
    btn.eventMode = 'static'
    btn.cursor = 'pointer'

    const tabBg = new Graphics()
    const tabText = new Text({
      text: row.label,
      style: { fontSize: 16, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    tabText.anchor.set(0.5)
    btn.addChild(tabBg, tabText)
    pageCon.addChild(btn)
    pageBtnByKey.set(row.key, { bg: tabBg, text: tabText })

    btn.on('pointerdown', (e) => {
      e.stopPropagation()
      if (activePage === row.key) return
      activePage = row.key
      drawList()
      redrawPageTabs()
    })
  })

  drawList()
  redrawPageTabs()

  const closeBtn = new Container()
  closeBtn.x = 0
  closeBtn.y = 540
  closeBtn.eventMode = 'static'
  closeBtn.cursor = 'pointer'
  const closeBg = new Graphics()
  closeBg.roundRect(-122, -30, 244, 60, 18)
  closeBg.fill({ color: 0x2d446c, alpha: 0.96 })
  closeBg.stroke({ color: 0xa7c6ff, width: 3, alpha: 0.95 })
  const closeText = new Text({ text: '关闭', style: { fontSize: 28, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' } })
  closeText.anchor.set(0.5)
  closeBtn.on('pointerdown', (e) => {
    e.stopPropagation()
    closeItemTestOverlay()
  })
  closeBtn.addChild(closeBg, closeText)
  panel.addChild(closeBtn)

  overlay.on('pointerdown', () => closeItemTestOverlay())
  stage.addChild(overlay)
  itemTestOverlay = overlay
}

function openSettingsOverlay(): void {
  closeSettingsOverlay()
  const stage = getApp().stage
  const overlay = new Container()
  overlay.zIndex = 7200
  overlay.eventMode = 'static'
  overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

  const mask = new Graphics()
  mask.rect(0, 0, CANVAS_W, CANVAS_H)
  mask.fill({ color: 0x05070d, alpha: 0.58 })
  overlay.addChild(mask)

  const panel = new Container()
  panel.x = CANVAS_W / 2
  panel.y = 418
  panel.eventMode = 'static'
  panel.on('pointerdown', (e) => e.stopPropagation())
  overlay.addChild(panel)

  const panelW = 612
  const panelH = 980
  const panelBg = new Graphics()
  panelBg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 24)
  panelBg.fill({ color: 0x121c33, alpha: 0.98 })
  panelBg.stroke({ color: 0x9ec2ff, width: 3, alpha: 0.95 })
  panel.addChild(panelBg)

  const panelGlow = new Graphics()
  panelGlow.roundRect(-panelW / 2 + 8, -panelH / 2 + 8, panelW - 16, panelH - 16, 20)
  panelGlow.stroke({ color: 0x4b6ea8, width: 2, alpha: 0.45 })
  panel.addChild(panelGlow)

  const title = new Text({
    text: '设置',
    style: { fontSize: 40, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  title.anchor.set(0.5)
  title.y = -210
  panel.addChild(title)

  const subtitle = new Text({
    text: '本局即时生效',
    style: { fontSize: 18, fill: 0xa8bddf, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  subtitle.anchor.set(0.5)
  subtitle.y = -166
  panel.addChild(subtitle)

  type ToggleRow = {
    key: 'gameplayCrossSynthesisConfirm' | 'gameplayShowSpeedButton' | 'gameplayBattleZoneNoSynthesis' | 'gameplaySameArchetypeDiffItemStoneSynthesis'
    label: string
  }
  const rows: ToggleRow[] = [
    { key: 'gameplayBattleZoneNoSynthesis', label: '上阵区禁止合成' },
    { key: 'gameplayCrossSynthesisConfirm', label: '合成二次弹窗' },
    { key: 'gameplaySameArchetypeDiffItemStoneSynthesis', label: '同职异物合成选转化' },
    { key: 'gameplayShowSpeedButton', label: '战斗加速按钮' },
  ]

  const drawRow = (y: number, row: ToggleRow): void => {
    const rowBg = new Graphics()
    rowBg.roundRect(-268, y - 36, 536, 72, 16)
    rowBg.fill({ color: 0x1a2946, alpha: 0.72 })
    rowBg.stroke({ color: 0x2f4f82, width: 2, alpha: 0.7 })
    panel.addChild(rowBg)

    const label = new Text({
      text: row.label,
      style: { fontSize: 30, fill: 0xe0ebff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    label.x = -240
    label.y = y - label.height / 2
    panel.addChild(label)

    const on = () => getDebugCfg(row.key) >= 0.5
    const btn = new Container()
    btn.x = 176
    btn.y = y
    btn.eventMode = 'static'
    btn.cursor = 'pointer'

    const bg = new Graphics()
    const txt = new Text({
      text: '',
      style: { fontSize: 24, fill: 0x0f1c33, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    txt.anchor.set(0.5)
    const redraw = () => {
      const enabled = on()
      bg.clear()
      bg.roundRect(-76, -27, 152, 54, 18)
      bg.fill({ color: enabled ? 0x74dc9b : 0xa8b6cc, alpha: 0.98 })
      bg.stroke({ color: 0x0d1426, width: 2, alpha: 0.95 })
      txt.text = enabled ? '开启' : '关闭'
    }
    redraw()

    btn.on('pointerdown', (e) => {
      e.stopPropagation()
      const next = on() ? 0 : 1
      setDebugCfg(row.key, next)
      redraw()
    })
    btn.addChild(bg, txt)
    panel.addChild(btn)
  }

  const controlBaseY = -118
  const controlGapY = 92
  rows.forEach((row, idx) => {
    drawRow(controlBaseY + controlGapY * idx, row)
  })

  const testBtn = new Container()
  testBtn.x = 0
  testBtn.y = controlBaseY + controlGapY * rows.length
  testBtn.eventMode = 'static'
  testBtn.cursor = 'pointer'
  const testBg = new Graphics()
  testBg.roundRect(-172, -28, 344, 56, 16)
  testBg.fill({ color: 0x3a5b93, alpha: 0.96 })
  testBg.stroke({ color: 0xb9d4ff, width: 3, alpha: 0.95 })
  const testText = new Text({
    text: '技能测试',
    style: { fontSize: 26, fill: 0xf3f9ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  testText.anchor.set(0.5)
  testBtn.on('pointerdown', (e) => {
    e.stopPropagation()
    openSkillTestOverlay()
  })
  testBtn.addChild(testBg, testText)
  panel.addChild(testBtn)

  const eventTestBtn = new Container()
  eventTestBtn.x = 0
  eventTestBtn.y = controlBaseY + controlGapY * (rows.length + 1)
  eventTestBtn.eventMode = 'static'
  eventTestBtn.cursor = 'pointer'
  const eventTestBg = new Graphics()
  eventTestBg.roundRect(-172, -28, 344, 56, 16)
  eventTestBg.fill({ color: 0x3a5b93, alpha: 0.96 })
  eventTestBg.stroke({ color: 0xb9d4ff, width: 3, alpha: 0.95 })
  const eventTestText = new Text({
    text: '事件测试',
    style: { fontSize: 26, fill: 0xf3f9ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  eventTestText.anchor.set(0.5)
  eventTestBtn.on('pointerdown', (e) => {
    e.stopPropagation()
    openEventTestOverlay()
  })
  eventTestBtn.addChild(eventTestBg, eventTestText)
  panel.addChild(eventTestBtn)

  const itemTestBtn = new Container()
  itemTestBtn.x = 0
  itemTestBtn.y = controlBaseY + controlGapY * (rows.length + 2)
  itemTestBtn.eventMode = 'static'
  itemTestBtn.cursor = 'pointer'
  const itemTestBg = new Graphics()
  itemTestBg.roundRect(-172, -28, 344, 56, 16)
  itemTestBg.fill({ color: 0x3a5b93, alpha: 0.96 })
  itemTestBg.stroke({ color: 0xb9d4ff, width: 3, alpha: 0.95 })
  const itemTestText = new Text({
    text: '物品测试',
    style: { fontSize: 26, fill: 0xf3f9ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  itemTestText.anchor.set(0.5)
  itemTestBtn.on('pointerdown', (e) => {
    e.stopPropagation()
    openItemTestOverlay()
  })
  itemTestBtn.addChild(itemTestBg, itemTestText)
  panel.addChild(itemTestBtn)

  const closeBtn = new Container()
  closeBtn.x = 0
  closeBtn.y = controlBaseY + controlGapY * (rows.length + 3)
  closeBtn.eventMode = 'static'
  closeBtn.cursor = 'pointer'
  const closeBg = new Graphics()
  closeBg.roundRect(-122, -30, 244, 60, 18)
  closeBg.fill({ color: 0x2d446c, alpha: 0.96 })
  closeBg.stroke({ color: 0xa7c6ff, width: 3, alpha: 0.95 })
  const closeText = new Text({ text: '关闭', style: { fontSize: 28, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' } })
  closeText.anchor.set(0.5)
  closeBtn.on('pointerdown', (e) => {
    e.stopPropagation()
    closeSettingsOverlay()
  })
  closeBtn.addChild(closeBg, closeText)
  panel.addChild(closeBtn)

  overlay.on('pointerdown', () => closeSettingsOverlay())
  stage.addChild(overlay)
  settingsOverlay = overlay
}

function createSettingsButton(stage: Container): void {
  if (settingsBtn) return
  const cfg = getConfig()
  const con = new Container()
  con.x = 16
  con.y = 82
  con.zIndex = 7050
  con.eventMode = 'static'
  con.cursor = 'pointer'

  const label = new Text({
    text: '设置',
    style: {
      fontSize: cfg.textSizes.refreshCost,
      fill: 0xffe8a3,
      fontFamily: 'Arial',
      fontWeight: 'bold',
    },
  })
  const padX = 18
  const padY = 10
  const w = label.width + padX * 2
  const h = label.height + padY * 2

  const bg = new Graphics()
  bg.roundRect(0, 0, w, h, 14)
  bg.fill({ color: 0x1f2940, alpha: 0.88 })
  bg.stroke({ color: 0xffd25a, width: 2, alpha: 0.95 })
  con.addChild(bg)

  label.x = padX
  label.y = padY
  con.addChild(label)
  con.hitArea = new Rectangle(0, 0, w, h)

  con.on('pointerdown', (e) => {
    e.stopPropagation()
    if (settingsOverlay) closeSettingsOverlay()
    else openSettingsOverlay()
  })
  stage.addChild(con)
  settingsBtn = con
}

function canSynthesizePair(
  sourceDefId: string,
  targetDefId: string,
  sourceTier: TierKey,
  sourceStar: 1 | 2,
  targetTier: TierKey,
  targetStar: 1 | 2,
): boolean {
  const sourceDef = getItemDefById(sourceDefId)
  const targetDef = getItemDefById(targetDefId)
  if (!sourceDef || !targetDef) return false
  if (isNeutralItemDef(sourceDef) || isNeutralItemDef(targetDef)) return false
  if (sourceTier !== targetTier || sourceStar !== targetStar) return false
  if (!nextTierLevel(sourceTier, sourceStar)) {
    return canUseLv7MorphSynthesis(sourceDefId, targetDefId, sourceTier, sourceStar, targetTier, targetStar)
  }
  if (sourceDefId === targetDefId) return true
  const sourceArch = getPrimaryArchetype(sourceDef.tags)
  const targetArch = getPrimaryArchetype(targetDef.tags)
  if (!sourceArch || !targetArch) return false
  return sourceArch === targetArch
}

const TIER_ORDER: TierKey[] = ['Bronze', 'Silver', 'Gold', 'Diamond']
function maxStarForTier(tier: TierKey): 1 | 2 {
  return tier === 'Bronze' ? 1 : 2
}

function normalizeTierStar(tier: TierKey, star?: number): 1 | 2 {
  const max = maxStarForTier(tier)
  const value = Number.isFinite(star) ? Math.round(star as number) : 1
  if (value <= 1) return 1
  return max
}

function isLv7TierStar(tier: TierKey, star: 1 | 2): boolean {
  return tier === 'Diamond' && normalizeTierStar(tier, star) === 2
}

function canUseLv7MorphSynthesis(
  sourceDefId: string,
  targetDefId: string,
  sourceTier: TierKey,
  sourceStar: 1 | 2,
  targetTier: TierKey,
  targetStar: 1 | 2,
): boolean {
  if (!isLv7TierStar(sourceTier, sourceStar) || !isLv7TierStar(targetTier, targetStar)) return false
  const sourceDef = getItemDefById(sourceDefId)
  const targetDef = getItemDefById(targetDefId)
  if (!sourceDef || !targetDef) return false
  if (isNeutralItemDef(sourceDef) || isNeutralItemDef(targetDef)) return false
  if (sourceDefId === targetDefId) return true
  const sourceArch = toSkillArchetype(getPrimaryArchetype(sourceDef.tags))
  const targetArch = toSkillArchetype(getPrimaryArchetype(targetDef.tags))
  if (sourceArch !== 'warrior' && sourceArch !== 'archer' && sourceArch !== 'assassin') return false
  if (targetArch !== 'warrior' && targetArch !== 'archer' && targetArch !== 'assassin') return false
  return sourceArch === targetArch
}

function nextTierLevel(tier: TierKey, star: 1 | 2): { tier: TierKey, star: 1 | 2 } | null {
  if (tier === 'Diamond') {
    const s = normalizeTierStar(tier, star)
    return s < maxStarForTier(tier) ? { tier, star: 2 } : null
  }
  if (star < maxStarForTier(tier)) return { tier, star: 2 }
  const idx = TIER_ORDER.indexOf(tier)
  if (idx < 0 || idx >= TIER_ORDER.length - 1) return null
  const next = TIER_ORDER[idx + 1] ?? null
  if (!next) return null
  return { tier: next, star: 1 }
}

function tierStarLevelIndex(tier: TierKey, star: 1 | 2): number {
  const s = normalizeTierStar(tier, star)
  if (tier === 'Bronze') return 0
  if (tier === 'Silver' && s === 1) return 1
  if (tier === 'Silver' && s === 2) return 2
  if (tier === 'Gold' && s === 1) return 3
  if (tier === 'Gold' && s === 2) return 4
  if (tier === 'Diamond' && s === 1) return 5
  return 6
}

function getMinTierDropWeight(item: ItemDef, resultTier: TierKey, resultStar: 1 | 2): number {
  const cfg = getConfig().shopRules?.synthesisMinTierDropWeightsByResultLevel
    ?? getConfig().shopRules?.minTierDropWeightsByResultLevel
  if (!cfg) return 1
  const minTier = parseTierName(item.starting_tier) ?? 'Bronze'
  const list = cfg[minTier]
  if (!Array.isArray(list) || list.length <= 0) return 1
  const idx = tierStarLevelIndex(resultTier, resultStar)
  const raw = list[idx]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1
  return Math.max(0, raw)
}

const QUALITY_PSEUDO_RANDOM_STATE = new Map<string, { bag: TierKey[]; cursor: number }>()
const QUICK_BUY_LEVEL_PSEUDO_RANDOM_STATE = new Map<string, { bag: Array<1 | 2 | 3 | 4 | 5 | 6 | 7>; cursor: number }>()

function pickQuickBuyLevelByPseudoRandomBucket(
  effectiveWeights: [number, number, number, number, number, number, number],
): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const active = effectiveWeights
    .map((w, i) => ({ level: (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7, weight: Math.max(0, Number(w || 0)) }))
    .filter((it) => it.weight > 0)

  if (active.length <= 0) return 1
  if (active.length === 1) return active[0]!.level

  const nonZeroLevels = active.map((it) => it.level)
  const low = Math.min(...nonZeroLevels) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  const high = Math.max(...nonZeroLevels) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  const lowW = active.find((it) => it.level === low)?.weight ?? 0
  const highW = active.find((it) => it.level === high)?.weight ?? 0
  const isTwoLevelFiftyFifty = active.length === 2 && Math.abs(lowW - highW) <= 1e-6
  if (isTwoLevelFiftyFifty) {
    const key = `50_50:${low}-${high}`
    let state = QUICK_BUY_LEVEL_PSEUDO_RANDOM_STATE.get(key)
    if (!state || state.cursor >= state.bag.length) {
      state = { bag: [low, low, high, high], cursor: 0 }
      QUICK_BUY_LEVEL_PSEUDO_RANDOM_STATE.set(key, state)
    }
    const picked = state.bag[state.cursor] ?? low
    state.cursor += 1
    return picked
  }

  let totalWeight = 0
  for (let i = 0; i < effectiveWeights.length; i++) totalWeight += Math.max(0, effectiveWeights[i] ?? 0)
  if (totalWeight <= 0) return 1
  let levelRoll = Math.random() * totalWeight
  let pickedLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7 = 1
  for (let i = 0; i < effectiveWeights.length; i++) {
    levelRoll -= effectiveWeights[i] ?? 0
    if (levelRoll <= 0) {
      pickedLevel = (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7
      break
    }
  }
  return pickedLevel
}

function pickCrossSynthesisDesiredMinTier(resultTier: TierKey, resultStar: 1 | 2, available?: TierKey[]): TierKey {
  const level = Math.max(1, Math.min(7, tierStarLevelIndex(resultTier, resultStar) + 1)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  return pickQualityByPseudoRandomBag(level, available ?? ['Bronze', 'Silver', 'Gold', 'Diamond'])
}

function pickItemByMinTierWeight(candidates: ItemDef[], resultTier: TierKey, resultStar: 1 | 2): ItemDef | null {
  if (candidates.length <= 0) return null
  let total = 0
  const ws = candidates.map((it) => {
    const w = getMinTierDropWeight(it, resultTier, resultStar)
    total += w
    return w
  })
  if (total <= 0) return candidates[Math.floor(Math.random() * candidates.length)] ?? null
  let r = Math.random() * total
  for (let i = 0; i < candidates.length; i++) {
    r -= ws[i] ?? 0
    if (r <= 0) return candidates[i] ?? null
  }
  return candidates[candidates.length - 1] ?? null
}

function pickSynthesisResultWithGuarantee(candidates: ItemDef[], resultTier: TierKey, resultStar: 1 | 2): ItemDef | null {
  return pickItemByMinTierWeight(candidates, resultTier, resultStar)
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

function compareTier(a: TierKey, b: TierKey): number {
  return TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b)
}

function maxTier(a: TierKey, b: TierKey): TierKey {
  return compareTier(a, b) >= 0 ? a : b
}

function getInstanceTier(instanceId: string): TierKey | undefined {
  const level = getInstanceLevel(instanceId)
  const legacy = levelToTierStar(level)
  return legacy?.tier
}

function getInstanceTierStar(instanceId: string): 1 | 2 {
  const level = getInstanceLevel(instanceId)
  const legacy = levelToTierStar(level)
  return legacy?.star ?? 1
}

function toVisualTier(tier?: TierKey, star?: 1 | 2): string | undefined {
  if (!tier) return undefined
  return `${tier}#${normalizeTierStar(tier, star)}`
}

function applyInstanceTierVisuals(): void {
  if (battleView) {
    for (const id of instanceToDefId.keys()) {
      battleView.setItemTier(id, toVisualTier(getInstanceTier(id), getInstanceTierStar(id)))
    }
  }
  if (backpackView) {
    for (const id of instanceToDefId.keys()) {
      backpackView.setItemTier(id, toVisualTier(getInstanceTier(id), getInstanceTierStar(id)))
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

function syncShopOwnedTierRules(): void {
  if (!shopManager) return
  shopManager.setOwnedTiers(collectOwnedTierByDef())
}

function syncUnlockPoolToManager(): void {
  if (!shopManager) return
  shopManager.setUnlockedItemIds(Array.from(unlockedItemIds))
}

function unlockItemToPool(defId: string): boolean {
  const item = getItemDefById(defId)
  if (!item) return false
  if (unlockedItemIds.has(defId)) return false
  unlockedItemIds.add(defId)
  shopManager?.unlockItem(defId)
  return true
}

function seedInitialUnlockPoolByStarterClass(_pick: StarterClass): void {
  unlockedItemIds.clear()
  neutralObtainedCountByKind.clear()
  neutralRandomCategoryPool = []
  neutralDailyRollCountByDay.clear()
  levelRewardCategoryPool = []
  pendingLevelRewards = []
  pendingHeroPeriodicRewards = []
  pendingHeroPeriodicRewardDispatching = false
  levelRewardObtainedByKind.clear()
  resetSkill15NextBuyDiscountState()
  resetSkill30BundleState()
  quickBuyNoSynthRefreshStreak = 0
  quickBuyNeutralMissStreak = 0
  nextQuickBuyOffer = null
  heroDailyCardRerollUsedDays.clear()
  heroFirstDiscardRewardedDays.clear()
  heroFirstSameItemSynthesisChoiceDays.clear()
  heroSmithStoneGrantedDays.clear()
  heroAdventurerScrollGrantedDays.clear()
  heroCommanderMedalGrantedDays.clear()
  heroHeirGoldEquipGrantedDays.clear()
  heroTycoonGoldGrantedDays.clear()
  // 按当前规则：开局解锁“所有青铜物品”，不再仅限所选职业
  const bronzeIds = getAllItems()
    .filter((it) => (parseTierName(it.starting_tier) ?? 'Bronze') === 'Bronze')
    .map((it) => it.id)
  for (const id of bronzeIds) unlockedItemIds.add(id)
  syncUnlockPoolToManager()
}

function getStarterClassTag(): string {
  if (starterClass === 'swordsman') return '战士'
  if (starterClass === 'archer') return '弓手'
  if (starterClass === 'assassin') return '刺客'
  return ''
}

function isSelectedHero(id: StarterClass): boolean {
  return starterClass === id
}

function canUseHeroDailyCardReroll(): boolean {
  return isSelectedHero('hero1') && !heroDailyCardRerollUsedDays.has(currentDay)
}

function markHeroDailyCardRerollUsed(): void {
  if (isSelectedHero('hero1')) {
    heroDailyCardRerollUsedDays.add(currentDay)
    refreshPlayerStatusUI()
  }
}

function tryRunHeroCrossSynthesisReroll(stage: Container, synth: SynthesizeResult): boolean {
  if (!canUseHeroDailyCardReroll()) return false
  const system = synth.targetZone === 'battle' ? battleSystem : backpackSystem
  const current = system?.getItem(synth.instanceId)
  if (!current) return false
  const targetLevel = Math.max(1, Math.min(7, tierStarLevelIndex(synth.toTier, synth.toStar) + 1)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  const currentDefId = current.defId
  const currentDef = getItemDefById(currentDefId)
  if (!currentDef) return false
  const targetSize = synth.targetSize
  const pool = collectPoolCandidatesByLevel(targetLevel)
    .filter((one) => normalizeSize(one.item.size) === targetSize && one.item.id !== currentDefId)
  const altPicks = pickRandomElements(pool, 2)
  if (altPicks.length < 2) return false
  const choices: NeutralChoiceCandidate[] = [
    { item: currentDef, tier: synth.toTier, star: synth.toStar },
    ...altPicks.map((one) => ({ item: one.item, tier: one.tier, star: one.star })),
  ]

  return showNeutralChoiceOverlay(stage, '占卜师：选择合成结果', choices, (picked) => {
    if (picked.item.id !== currentDefId) {
      const ok = transformPlacedItemKeepLevelTo(synth.instanceId, synth.targetZone, picked.item, true)
      if (!ok) {
        showHintToast('backpack_full_buy', '占卜师：转化失败', 0xff8f8f)
        return false
      }
      setInstanceQualityLevel(synth.instanceId, picked.item.id, parseTierName(picked.item.starting_tier) ?? 'Bronze', targetLevel)
      applyInstanceTierVisuals()
      syncShopOwnedTierRules()
      refreshUpgradeHints()
    }
    markHeroDailyCardRerollUsed()
    showHintToast('no_gold_buy', '占卜师：本次异物合成可选结果', 0x9be5ff)
    refreshShopUI()
    return true
  }, 'special_shop_like')
}

void tryRunHeroCrossSynthesisReroll

function canTriggerHeroFirstDiscardReward(): boolean {
  return isSelectedHero('hero3') && !heroFirstDiscardRewardedDays.has(currentDay)
}

function markHeroFirstDiscardRewardTriggered(): void {
  if (isSelectedHero('hero3')) {
    heroFirstDiscardRewardedDays.add(currentDay)
    refreshPlayerStatusUI()
  }
}

function canTriggerHeroSameItemSynthesisChoice(): boolean {
  return isSelectedHero('hero4') && !heroFirstSameItemSynthesisChoiceDays.has(currentDay)
}

function markHeroSameItemSynthesisChoiceTriggered(): void {
  if (isSelectedHero('hero4')) {
    heroFirstSameItemSynthesisChoiceDays.add(currentDay)
    refreshPlayerStatusUI()
  }
}

function shouldShowHeroDailySkillReadyStar(): boolean {
  if (
    pendingHeroPeriodicRewards.length > 0
    && (isSelectedHero('hero5') || isSelectedHero('hero6') || isSelectedHero('hero7') || isSelectedHero('hero8'))
  ) {
    return true
  }
  if (isSelectedHero('hero1')) return canUseHeroDailyCardReroll()
  if (isSelectedHero('hero3')) return canTriggerHeroFirstDiscardReward()
  if (isSelectedHero('hero4')) return canTriggerHeroSameItemSynthesisChoice()
  return false
}

function grantHeroDiscardSameLevelReward(discardedDefId: string, level: 1 | 2 | 3 | 4 | 5 | 6 | 7): void {
  if (!canTriggerHeroFirstDiscardReward()) return
  const discardedDef = getItemDefById(discardedDefId)
  if (!discardedDef || isNeutralItemDef(discardedDef)) return
  const candidates = collectPoolCandidatesByLevel(level).filter((one) => one.item.id !== discardedDefId)
  if (candidates.length <= 0) return
  const picked = candidates[Math.floor(Math.random() * candidates.length)]
  if (!picked) return
  if (grantPoolCandidateToBoardOrBackpack(picked, '魔术师', { flyFromHeroAvatar: true })) {
    markHeroFirstDiscardRewardTriggered()
  }
}

function isStarterClassItem(item: ItemDef): boolean {
  const tag = getStarterClassTag()
  if (!tag) return true
  return `${item.tags ?? ''}`.includes(tag)
}

function isFirstPurchaseLockedToStarterClass(): boolean {
  return false
}

function canBuyItemUnderFirstPurchaseRule(item: ItemDef): boolean {
  if (!isFirstPurchaseLockedToStarterClass()) return true
  return isStarterClassItem(item)
}

function showFirstPurchaseRuleHint(): void {
  const tag = getStarterClassTag()
  const label = tag || '本职业'
  showHintToast('no_gold_buy', `首次购买需为${label}物品`, 0xffd48f)
}

function markShopPurchaseDone(): void {
  hasBoughtOnce = true
}

function getPlayerExpToNextLevelTable(): number[] {
  const raw = getConfig().runRules?.playerExpToNextLevel
  if (!Array.isArray(raw) || raw.length <= 0) return [3, 4, 5, 6, 7, 8, 9, 10, 12]
  return raw.map((n) => Math.max(1, Math.round(Number(n) || 1)))
}

function getPlayerMaxLifeByLevelTable(): number[] {
  const raw = getConfig().runRules?.playerMaxLifeByLevel
  if (!Array.isArray(raw) || raw.length <= 0) return [30, 34, 38, 42, 46, 50, 54, 58, 62, 66]
  return raw.map((n) => Math.max(1, Math.round(Number(n) || 1)))
}

function getPlayerLevelCap(): number {
  return Math.max(1, getPlayerMaxLifeByLevelTable().length)
}

function clampPlayerLevel(level: number): number {
  const cap = getPlayerLevelCap()
  if (!Number.isFinite(level)) return 1
  return Math.max(1, Math.min(cap, Math.round(level)))
}

function getPlayerExpNeedByLevel(level: number): number {
  const table = getPlayerExpToNextLevelTable()
  const idx = Math.max(0, Math.min(table.length - 1, clampPlayerLevel(level) - 1))
  return Math.max(1, Math.round(table[idx] ?? table[table.length - 1] ?? 1))
}

function getPlayerMaxLifeByLevel(level: number): number {
  const table = getPlayerMaxLifeByLevelTable()
  const idx = Math.max(0, Math.min(table.length - 1, clampPlayerLevel(level) - 1))
  return Math.max(1, Math.round(table[idx] ?? table[table.length - 1] ?? 1))
}

function getPlacedItemCenterOnStage(instanceId: string, zone: 'battle' | 'backpack'): { x: number; y: number } | null {
  if (!battleSystem || !backpackSystem || !battleView || !backpackView) return null
  const system = zone === 'battle' ? battleSystem : backpackSystem
  const view = zone === 'battle' ? battleView : backpackView
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

function getPlayerExpCenterOnStage(): { x: number; y: number } | null {
  if (!playerStatusExpBg) return null
  const stage = getApp().stage
  const b = playerStatusExpBg.getBounds()
  return stage.toLocal({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
}

function playSynthesisExpFlyEffect(from: { x: number; y: number } | null): void {
  const to = getPlayerExpCenterOnStage()
  if (!to) return
  const startPos = from ?? { x: to.x, y: to.y - 120 }
  const stage = getApp().stage
  const orb = new Graphics()
  orb.eventMode = 'none'
  stage.addChild(orb)

  const durationMs = 420
  const startAt = Date.now()
  const tick = () => {
    const t = Math.min(1, (Date.now() - startAt) / durationMs)
    const u = 1 - t
    const x = startPos.x * u + to.x * t
    const y = startPos.y * u + to.y * t - Math.sin(Math.PI * t) * 26
    const r = 5 + Math.sin(Math.PI * t) * 2

    orb.clear()
    orb.circle(x, y, r)
    orb.fill({ color: 0x8fd8ff, alpha: 0.95 })
    orb.circle(x, y, Math.max(2, r - 2.2))
    orb.fill({ color: 0xffffff, alpha: 0.9 })

    if (t >= 1) {
      Ticker.shared.remove(tick)
      orb.parent?.removeChild(orb)
      orb.destroy()
    }
  }
  Ticker.shared.add(tick)
}

function playPlayerLevelUpFx(): void {
  if (!playerStatusAvatar || !playerStatusLvText) return
  const avatar = playerStatusAvatar
  const lvText = playerStatusLvText
  const stage = getApp().stage
  const flash = new Graphics()
  flash.eventMode = 'none'
  stage.addChild(flash)

  const baseX = avatar.x
  const baseY = avatar.y
  const baseW = avatar.width
  const baseH = avatar.height
  const avatarBounds = avatar.getBounds()
  const flashPos = stage.toLocal({ x: avatarBounds.x, y: avatarBounds.y })

  const durationMs = 280
  const startAt = Date.now()
  const tick = () => {
    const t = Math.min(1, (Date.now() - startAt) / durationMs)
    const pulse = Math.sin(Math.PI * t)
    const scale = 1 + pulse * 0.16

    const nextW = baseW * scale
    const nextH = baseH * scale
    avatar.width = nextW
    avatar.height = nextH
    avatar.x = baseX - (nextW - baseW) / 2
    avatar.y = baseY - (nextH - baseH) / 2
    lvText.scale.set(1 + pulse * 0.22)

    flash.clear()
    flash.roundRect(flashPos.x, flashPos.y, avatarBounds.width, avatarBounds.height, 18)
    flash.fill({ color: 0xffffff, alpha: pulse * 0.75 })

    if (t >= 1) {
      Ticker.shared.remove(tick)
      flash.parent?.removeChild(flash)
      flash.destroy()
      avatar.width = baseW
      avatar.height = baseH
      avatar.x = baseX
      avatar.y = baseY
      lvText.scale.set(1)
    }
  }
  Ticker.shared.add(tick)
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
): void {
  if (!playerStatusAvatar) { onLand(); return }
  const stage = getApp().stage

  // 起点：头像中心（舞台坐标）
  const avatarBounds = playerStatusAvatar.getBounds()
  const startPos = stage.toLocal({ x: avatarBounds.x + avatarBounds.width / 2, y: avatarBounds.y + avatarBounds.height / 2 })

  // 终点：目标格中心（舞台坐标）
  const targetGlobal = targetView.toGlobal({
    x: targetSlotCol * CELL_SIZE + CELL_SIZE / 2,
    y: targetSlotRow * CELL_HEIGHT + CELL_HEIGHT / 2,
  })
  const endPos = stage.toLocal(targetGlobal)

  // 与背包区物品图标观感对齐（原先过大，约缩小一半）
  const iconSize = Math.round(CELL_SIZE * 0.36)
  const durationMs = 440

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
): void {
  if (!backpackView) { onLand(); return }
  flyRewardToGridSlot(defId, backpackView, targetSlotCol, targetSlotRow, onLand)
}

/** 记录升级奖励获得计数 */
function recordLevelRewardObtained(kind: NeutralSpecialKind): void {
  const prev = levelRewardObtainedByKind.get(kind) ?? 0
  levelRewardObtainedByKind.set(kind, Math.max(0, Math.round(prev + 1)))
}

/** 检查背包是否有空位可放1x1物品并执行待领取奖励发放 */
function checkAndPopPendingRewards(): void {
  if (pendingLevelRewards.length === 0) {
    checkAndPopPendingHeroPeriodicRewards()
    return
  }
  if (!backpackSystem || !backpackView) return

  while (pendingLevelRewards.length > 0) {
    const slot = findFirstBackpackPlace('1x1')
    if (!slot) break  // 背包满，等待空格

    const defId = pendingLevelRewards[0]!
    const def = getItemDefById(defId)
    if (!def) { pendingLevelRewards.shift(); continue }

    // 逻辑先占位（alpha=0，防止拖拽占用）
    const id = nextId()
    backpackSystem.place(slot.col, slot.row, '1x1', defId, id)
    instanceToDefId.set(id, defId)
    setInstanceQualityLevel(id, defId, 'Bronze', 1)
    instanceToPermanentDamageBonus.set(id, 0)
    const kind = getNeutralSpecialKind(def)
    if (kind) recordLevelRewardObtained(kind)
    recordNeutralItemObtained(defId)
    unlockItemToPool(defId)
    pendingLevelRewards.shift()

    // 飞行动画结束后再显示物品（addItem触发acquireFx），然后继续派发下一个待领取
    const capturedId = id
    const capturedDef = def
    const capturedSlot = { ...slot }
    flyRewardToBackpack(defId, slot.col, slot.row, () => {
      if (!backpackView || !backpackSystem) return
      // 检查物品还在（没被移除）
      if (!backpackSystem.getItem(capturedId)) {
        checkAndPopPendingRewards()
        return
      }
      void backpackView.addItem(capturedId, capturedDef.id, '1x1', capturedSlot.col, capturedSlot.row, 'Bronze#1').then(() => {
        backpackView!.setItemTier(capturedId, 'Bronze#1')
        drag?.refreshZone(backpackView!)
        // 动画落地后检查是否还有更多待领取
        checkAndPopPendingRewards()
      })
    })

    saveShopStateToStorage(captureShopState())
    break  // 每次只发一个，等动画结束后再检查下一个
  }

  if (pendingLevelRewards.length === 0) {
    checkAndPopPendingHeroPeriodicRewards()
  }
}

/** 处理升级奖励：抽取物品加入待领取队列 */
function handleLevelReward(level: number): void {
  const rewards = rollLevelRewardDefIds(level)
  if (rewards.length <= 0) {
    if (shopManager) {
      const goldFallback = 3
      shopManager.gold += goldFallback
      showHintToast('no_gold_buy', `升级奖励：中立物品已满，获得${goldFallback}G`, 0xffd700)
    }
    saveShopStateToStorage(captureShopState())
    return
  }
  pendingLevelRewards.push(...rewards)
  checkAndPopPendingRewards()
}

function grantSynthesisExp(amount = 1, from?: { instanceId: string; zone: 'battle' | 'backpack' }): void {
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
  playSynthesisExpFlyEffect(from ? getPlacedItemCenterOnStage(from.instanceId, from.zone) : null)
  if (leveled) {
    showHintToast('no_gold_buy', `升级到 Lv${level}`, 0x8ff0b0)
    playPlayerLevelUpFx()
    handleLevelReward(levelBeforeUpgrade)
  }
}

function getHeroIconByStarterClass(): string {
  if (starterClass === 'hero1') return '/resource/hero/hero1icon.png'
  if (starterClass === 'hero2') return '/resource/hero/hero2icon.png'
  if (starterClass === 'hero3') return '/resource/hero/hero3icon.png'
  if (starterClass === 'hero4') return '/resource/hero/hero4icon.png'
  if (starterClass === 'hero5') return '/resource/hero/hero5icon.png'
  if (starterClass === 'hero6') return '/resource/hero/hero6icon.png'
  if (starterClass === 'hero7') return '/resource/hero/hero7icon.png'
  if (starterClass === 'hero8') return '/resource/hero/hero8icon.png'
  if (starterClass === 'hero9') return '/resource/hero/hero9icon.png'
  if (starterClass === 'hero10') return '/resource/hero/hero10icon.png'
  if (starterClass === 'archer') return '/resource/hero/archericon.png'
  if (starterClass === 'assassin') return '/resource/hero/assassinicon.png'
  return '/resource/hero/warrioricon.png'
}

function getHeroPassiveDetailData(): { name: string; desc: string; icon: string } {
  if (!starterClass) {
    return {
      name: '未选择英雄',
      desc: '暂无技能效果',
      icon: '/resource/hero/warrioricon.png',
    }
  }
  const preset = STARTER_CLASS_PRESETS[starterClass]
  if (!preset) {
    return {
      name: '未选择英雄',
      desc: '暂无技能效果',
      icon: '/resource/hero/warrioricon.png',
    }
  }
  return {
    name: preset.title,
    desc: (preset.subtitle || '暂无技能效果').trim(),
    icon: getHeroIconByStarterClass(),
  }
}

function showHeroPassiveDetailPopup(): void {
  const stage = getApp().stage
  if (!skillDetailPopupCon) {
    const con = new Container()
    con.zIndex = 220
    con.eventMode = 'none'
    con.visible = false
    stage.addChild(con)
    skillDetailPopupCon = con
  }
  const con = skillDetailPopupCon
  con.removeChildren().forEach((c) => c.destroy({ children: true }))

  const detail = getHeroPassiveDetailData()
  const panelW = Math.max(360, Math.min(CANVAS_W - 24, getDebugCfg('itemInfoWidth')))
  const pad = 16
  const iconSize = 128
  const iconX = pad
  const iconY = pad
  const textX = iconX + iconSize + 16
  const textW = panelW - textX - pad
  const titleFontSize = getDebugCfg('itemInfoNameFontSize')
  const descFontSize = getDebugCfg('itemInfoSimpleDescFontSize')

  const title = new Text({
    text: detail.name,
    style: { fontSize: titleFontSize, fill: 0xffefc8, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  const desc = new Text({
    text: detail.desc,
    style: {
      fontSize: descFontSize,
      fill: 0xd7e2fa,
      fontFamily: 'Arial',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: textW,
      lineHeight: Math.round(descFontSize * 1.25),
    },
  })

  const dividerY = iconY + 44
  const descY = dividerY + 12
  const contentBottom = Math.max(iconY + iconSize, descY + desc.height)
  const panelH = Math.max(getDebugCfg('itemInfoMinHSmall'), contentBottom + pad)
  const px = CANVAS_W / 2 - panelW / 2
  let panelBottomY = getDebugCfg('shopAreaY') - getDebugCfg('itemInfoBottomGapToShop') - 92
  if (skillIconBarCon?.visible) {
    panelBottomY = Math.min(panelBottomY, skillIconBarCon.y - 44)
  }
  const py = panelBottomY - panelH

  const bg = new Graphics()
  bg.roundRect(px, py, panelW, panelH, Math.max(0, getDebugCfg('gridItemCornerRadius')))
  bg.fill({ color: 0x1e1e30, alpha: 0.97 })
  bg.stroke({ color: 0x5566aa, width: 2, alpha: 1 })
  con.addChild(bg)

  const iconLetter = new Text({
    text: detail.name.slice(0, 1),
    style: { fontSize: 56, fill: 0xf5f7ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  iconLetter.anchor.set(0.5)
  iconLetter.x = px + iconX + iconSize / 2
  iconLetter.y = py + iconY + iconSize / 2 + 2
  con.addChild(iconLetter)

  const iconSprite = new Sprite(Texture.WHITE)
  iconSprite.x = px + iconX
  iconSprite.y = py + iconY
  iconSprite.width = iconSize
  iconSprite.height = iconSize
  iconSprite.alpha = 0
  con.addChild(iconSprite)
  const iconUrl = detail.icon
  void Assets.load<Texture>(iconUrl).then((tex) => {
    if (!skillDetailPopupCon || skillDetailSkillId !== HERO_DETAIL_POPUP_ID || iconSprite.destroyed) return
    iconSprite.texture = tex
    iconSprite.alpha = 1
    iconLetter.visible = false
  }).catch(() => {
    // ignore runtime missing icon
  })

  title.x = px + textX
  title.y = py + iconY + 2
  con.addChild(title)

  const divider = new Graphics()
  divider.moveTo(px + textX, py + dividerY)
  divider.lineTo(px + panelW - pad, py + dividerY)
  divider.stroke({ color: 0x5a628f, width: 1, alpha: 0.9 })
  con.addChild(divider)

  desc.x = px + textX
  desc.y = py + descY
  con.addChild(desc)

  skillDetailSkillId = HERO_DETAIL_POPUP_ID
  con.visible = true
}

function toggleHeroPassiveDetailPopup(): void {
  if (skillDetailSkillId === HERO_DETAIL_POPUP_ID) {
    hideSkillDetailPopup()
    return
  }
  currentSelection = { kind: 'none' }
  selectedSellAction = null
  resetInfoModeSelection()
  shopPanel?.setSelectedSlot(-1)
  battleView?.setSelected(null)
  backpackView?.setSelected(null)
  sellPopup?.hide()
  applySellButtonState()
  showHeroPassiveDetailPopup()
}

function parseTierName(raw: string): TierKey | null {
  if (raw.includes('Bronze')) return 'Bronze'
  if (raw.includes('Silver')) return 'Silver'
  if (raw.includes('Gold')) return 'Gold'
  if (raw.includes('Diamond')) return 'Diamond'
  return null
}

function parseAvailableTiers(raw: string): TierKey[] {
  const s = (raw || '').trim()
  if (!s) return ['Bronze', 'Silver', 'Gold', 'Diamond']
  const out = s
    .split('/')
    .map((v) => parseTierName(v.trim()))
    .filter((v): v is TierKey => !!v)
  return out.length > 0 ? out : ['Bronze', 'Silver', 'Gold', 'Diamond']
}

function pickTierSeriesValueByTier(series: string, tier: TierKey, availableTiersRaw: string): number {
  const parts = series.split(/[\/|]/).map((v) => v.trim()).filter(Boolean)
  if (parts.length === 0) return 0
  const tiers = parseAvailableTiers(availableTiersRaw)
  const tierIdx = Math.max(0, tiers.indexOf(tier))
  const idx = Math.max(0, Math.min(parts.length - 1, tierIdx))
  const n = Number(parts[idx])
  return Number.isFinite(n) ? n : 0
}

function tierValueFromSkillLine(item: ReturnType<typeof getAllItems>[number], tier: TierKey, line: string): number {
  const m = line.match(/(\d+(?:\.\d+)?(?:[\/|]\d+(?:\.\d+)?)+)/)
  if (!m?.[1]) return 0
  return pickTierSeriesValueByTier(m[1], tier, item.available_tiers)
}

function tierValueFromSkillLineByStar(item: ReturnType<typeof getAllItems>[number], tier: TierKey, star: 1 | 2, line: string): number {
  const m = line.match(/(\d+(?:\.\d+)?(?:[\/|]\d+(?:\.\d+)?)+)/)
  if (!m?.[1]) return 0
  const parts = m[1].split(/[\/|]/).map((v) => v.trim()).filter(Boolean)
  if (parts.length === 0) return 0
  const tiers = parseAvailableTiers(item.available_tiers)
  const base = Math.max(0, tiers.indexOf(tier))
  const idx = Math.max(0, Math.min(parts.length - 1, base + (star - 1)))
  const n = Number(parts[idx])
  return Number.isFinite(n) ? n : 0
}

function ammoValueFromLineByStar(item: ReturnType<typeof getAllItems>[number], tier: TierKey, star: 1 | 2, line: string): number {
  const m = line.match(/弹药\s*[:：]\s*(\d+(?:[\/|]\d+)*)/)
  if (!m?.[1]) return 0
  const parts = m[1].split(/[\/|]/).map((v) => v.trim()).filter(Boolean)
  if (parts.length === 0) return 0
  const tiers = parseAvailableTiers(item.available_tiers)
  const base = Math.max(0, tiers.indexOf(tier))
  const idx = Math.max(0, Math.min(parts.length - 1, base + (star - 1)))
  const n = Number(parts[idx])
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
}

function spawnPassiveJumpText(instanceId: string, text: string, color: number, offsetRow = 0): void {
  if (!battleView || !passiveJumpLayer) return
  const node = battleView.getNode(instanceId)
  if (!node) return
  const w = node.size === '1x1' ? CELL_SIZE : node.size === '2x1' ? CELL_SIZE * 2 : CELL_SIZE * 3
  const x = node.container.x + w / 2
  const y = node.container.y + CELL_HEIGHT * 0.3 + 40 - offsetRow * 24
  const label = new Text({
    text,
    style: {
      fontSize: Math.max(8, getDebugCfg('shopPassiveJumpFontSize')),
      fontFamily: 'Arial',
      fontWeight: 'bold',
      fill: color,
      stroke: { color: 0x101018, width: 4 },
    },
  })
  label.anchor.set(0.5, 0.5)
  label.x = x
  label.y = y
  passiveJumpLayer.addChild(label)

  const start = Date.now()
  const moveMs = Math.max(0, getDebugCfg('shopPassiveJumpMoveMs'))
  const holdMs = Math.max(0, getDebugCfg('shopPassiveJumpHoldMs'))
  const fadeMs = Math.max(0, getDebugCfg('shopPassiveJumpFadeMs'))
  const risePx = 42
  const total = Math.max(1, moveMs + holdMs + fadeMs)
  const tick = () => {
    const elapsed = Date.now() - start
    if (elapsed <= moveMs) {
      const p = moveMs <= 0 ? 1 : Math.min(1, elapsed / moveMs)
      const eased = 1 - Math.pow(1 - p, 3)
      label.y = y - eased * risePx
      label.alpha = 1
    } else if (elapsed <= moveMs + holdMs) {
      label.y = y - risePx
      label.alpha = 1
    } else {
      const t = elapsed - moveMs - holdMs
      const p = fadeMs <= 0 ? 1 : Math.min(1, t / fadeMs)
      label.y = y - risePx
      label.alpha = 1 - p
    }
    if (elapsed >= total) {
      Ticker.shared.remove(tick)
      label.parent?.removeChild(label)
      label.destroy()
    }
  }
  Ticker.shared.add(tick)
}

function setZoneItemAmmo(view: GridZone, instanceId: string, current: number, max: number): void {
  const v = view as GridZone & { setItemAmmo?: (id: string, c: number, m: number) => void }
  v.setItemAmmo?.(instanceId, current, max)
}

function refreshBattlePassiveStatBadges(showJump = true): void {
  if (!battleSystem || !battleView) return
  const allItems = getAllItems()
  const byId = new Map(allItems.map((it) => [it.id, it] as const))
  const placed = battleSystem.getAllItems()
  const next = new Map<string, PassiveResolvedStat>()

  for (const it of placed) {
    const def = byId.get(it.defId)
    if (!def) continue
    const tier = getInstanceTier(it.instanceId) ?? 'Bronze'
    const star = getInstanceTierStar(it.instanceId)
    const stats = resolveItemTierBaseStats(def, `${tier}#${star}`)
    const permanent = Math.max(0, Math.round(instanceToPermanentDamageBonus.get(it.instanceId) ?? 0))
    const ammoLine = (def.skills ?? []).map((s) => s.cn ?? '').find((s) => /弹药\s*[:：]\s*\d+/.test(s))
    const ammoMax = ammoLine ? ammoValueFromLineByStar(def, tier, star, ammoLine) : 0
    next.set(it.instanceId, {
      damage: Math.max(0, Math.round(stats.damage + permanent)),
      shield: Math.max(0, Math.round(stats.shield)),
      heal: Math.max(0, Math.round(stats.heal)),
      burn: Math.max(0, Math.round(stats.burn)),
      poison: Math.max(0, Math.round(stats.poison)),
      multicast: Math.max(1, Math.round(stats.multicast)),
      cooldownMs: Math.max(0, Math.round(stats.cooldownMs)),
      ammoCurrent: ammoMax,
      ammoMax,
    })
  }

  const baseBeforePassive = new Map<string, PassiveResolvedStat>()
  for (const [id, st] of next) baseBeforePassive.set(id, { ...st })

  const isWeapon = (id: string): boolean => (next.get(id)?.damage ?? 0) > 0
  const isShield = (id: string): boolean => (next.get(id)?.shield ?? 0) > 0
  const isDamageBonusEligible = (id: string): boolean => isWeapon(id) && !isShield(id)

  for (const owner of placed) {
    const def = byId.get(owner.defId)
    if (!def) continue
    const tier = getInstanceTier(owner.instanceId) ?? 'Bronze'
    const star = getInstanceTierStar(owner.instanceId)
    const lines = (def.skills ?? []).map((s) => s.cn ?? '')
    const adjacentIds = battleSystem.getAdjacentItems(owner.instanceId)

    const shortSwordLine = lines.find((s) => /相邻的护盾物品护盾\+\d+(?:\/\d+)*/.test(s))
    if (shortSwordLine) {
      const v = Math.round(tierValueFromSkillLineByStar(def, tier, star, shortSwordLine))
      if (v > 0) {
        for (const aid of adjacentIds) {
          if (!isShield(aid)) continue
          const st = next.get(aid)
          if (!st) continue
          st.shield += v
        }
      }
    }

    const roundShieldLine = lines.find((s) => /相邻的?武器伤害\+\d+(?:\/\d+)*/.test(s))
    if (roundShieldLine) {
      const v = Math.round(tierValueFromSkillLineByStar(def, tier, star, roundShieldLine))
      if (v > 0) {
        for (const aid of adjacentIds) {
          if (!isDamageBonusEligible(aid)) continue
          const st = next.get(aid)
          if (!st) continue
          st.damage += v
        }
      }
    }

    const boomerangLine = lines.find(
      (s) => /武器伤害\+\d+(?:\/\d+)*/.test(s)
        && !/相邻/.test(s)
        && !/其他武器攻击时该(?:武器|物品)伤害\+/.test(s),
    )
    if (boomerangLine) {
      const v = Math.round(tierValueFromSkillLineByStar(def, tier, star, boomerangLine))
      if (v > 0) {
        for (const st of next.values()) {
          if (st.damage <= 0 || st.shield > 0) continue
          st.damage += v
        }
      }
    }

    const adjacentAmmoCapLine = lines.find((s) => /相邻物品\+\d+(?:\/\d+)*最大弹药量/.test(s))
    if (adjacentAmmoCapLine) {
      const v = Math.round(tierValueFromSkillLineByStar(def, tier, star, adjacentAmmoCapLine))
      if (v > 0) {
        for (const aid of adjacentIds) {
          const st = next.get(aid)
          if (!st || st.ammoMax <= 0) continue
          st.ammoMax += v
          st.ammoCurrent = Math.min(st.ammoMax, st.ammoCurrent + v)
        }
      }
    }
  }

  for (const it of placed) {
    const st = next.get(it.instanceId)
    if (!st) {
      battleView.setItemStatOverride(it.instanceId, null)
      setZoneItemAmmo(battleView, it.instanceId, 0, 0)
      continue
    }
    battleView.setItemStatOverride(it.instanceId, {
      damage: st.damage,
      shield: st.shield,
      heal: st.heal,
      burn: st.burn,
      poison: st.poison,
      multicast: st.multicast,
    })
    setZoneItemAmmo(battleView, it.instanceId, st.ammoCurrent, st.ammoMax)

    const prev = battlePassivePrevStats.get(it.instanceId) ?? baseBeforePassive.get(it.instanceId)
    if (showJump && prev) {
      const deltas: Array<{ text: string; color: number }> = []
      const dDmg = st.damage - prev.damage
      const dShield = st.shield - prev.shield
      if (dDmg !== 0) deltas.push({ text: `⚔ ${dDmg > 0 ? '+' : ''}${dDmg}`, color: dDmg > 0 ? 0xff7b7b : 0xbfc7f5 })
      if (dShield !== 0) deltas.push({ text: `🛡 ${dShield > 0 ? '+' : ''}${dShield}`, color: dShield > 0 ? 0xffd86b : 0xbfc7f5 })
      for (let i = 0; i < deltas.length; i++) {
        const d = deltas[i]!
        spawnPassiveJumpText(it.instanceId, d.text, d.color, i)
      }
    }
    battlePassivePrevStats.set(it.instanceId, { ...st })
  }

  for (const id of Array.from(battlePassivePrevStats.keys())) {
    if (!next.has(id)) battlePassivePrevStats.delete(id)
  }
  for (const id of Array.from(battlePassiveResolvedStats.keys())) {
    if (!next.has(id)) setZoneItemAmmo(battleView, id, 0, 0)
  }
  battlePassiveResolvedStats.clear()
  for (const [id, st] of next) battlePassiveResolvedStats.set(id, st)
}

function isAttackItemForBattle(item: ReturnType<typeof getAllItems>[number]): boolean {
  if (item.damage > 0) return true
  const lines = (item.skills ?? []).map((s) => s.cn ?? '')
  return lines.some((line) => /攻击造成|掷出造成|最大生命值.*%.*伤害|等同于当前自身护盾值/.test(line))
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

function applyPostBattleAutoCopy(snapshot: BattleSnapshotBundle): boolean {
  if (!backpackSystem || !backpackView) return false
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
    backpackSystem.place(place.col, place.row, size, item.id, newId)
    backpackView.addItem(newId, item.id, size, place.col, place.row, toVisualTier(entity.tier, 1)).then(() => {
      backpackView!.setItemTier(newId, toVisualTier(entity.tier, 1))
      drag?.refreshZone(backpackView!)
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

function computeUpgradeMatch(): UpgradeMatch {
  const battleIds: string[] = []
  const backpackIds: string[] = []
  const shopSlots: number[] = []
  let hasBackpackMatch = false

  if (!shopManager || !battleSystem || !backpackSystem) {
    return { shopSlots, battleIds, backpackIds, hasBackpackMatch }
  }

  const ownedByKey = new Map<string, { inBattle: string[]; inBackpack: string[]; defIds: Set<string> }>()
  const ownedByArchetypeKey = new Map<string, { inBattle: string[]; inBackpack: string[]; defIds: Set<string> }>()
  for (const it of battleSystem.getAllItems()) {
    const tier = instanceToTier.get(it.instanceId) ?? 'Bronze'
    const star = getInstanceTierStar(it.instanceId)
    const key = `${it.defId}:${tier}:${star}`
    const obj = ownedByKey.get(key) ?? { inBattle: [], inBackpack: [], defIds: new Set<string>() }
    obj.inBattle.push(it.instanceId)
    obj.defIds.add(it.defId)
    ownedByKey.set(key, obj)

    const def = getItemDefById(it.defId)
    const archetype = getPrimaryArchetype(def?.tags ?? '')
    const archKey = `${archetype}:${tier}:${star}`
    const archObj = ownedByArchetypeKey.get(archKey) ?? { inBattle: [], inBackpack: [], defIds: new Set<string>() }
    archObj.inBattle.push(it.instanceId)
    archObj.defIds.add(it.defId)
    ownedByArchetypeKey.set(archKey, archObj)
  }
  for (const it of backpackSystem.getAllItems()) {
    const tier = instanceToTier.get(it.instanceId) ?? 'Bronze'
    const star = getInstanceTierStar(it.instanceId)
    const key = `${it.defId}:${tier}:${star}`
    const obj = ownedByKey.get(key) ?? { inBattle: [], inBackpack: [], defIds: new Set<string>() }
    obj.inBackpack.push(it.instanceId)
    obj.defIds.add(it.defId)
    ownedByKey.set(key, obj)

    const def = getItemDefById(it.defId)
    const archetype = getPrimaryArchetype(def?.tags ?? '')
    const archKey = `${archetype}:${tier}:${star}`
    const archObj = ownedByArchetypeKey.get(archKey) ?? { inBattle: [], inBackpack: [], defIds: new Set<string>() }
    archObj.inBackpack.push(it.instanceId)
    archObj.defIds.add(it.defId)
    ownedByArchetypeKey.set(archKey, archObj)
  }

  for (const [key, match] of ownedByKey) {
    const parts = key.split(':')
    const tier = (parts[1] ?? 'Bronze') as TierKey
    const star = Number(parts[2]) === 2 ? 2 : 1
    if (!nextTierLevel(tier, star)) continue
    const count = match.inBattle.length + match.inBackpack.length
    if (count < 2) continue
    battleIds.push(...match.inBattle)
    backpackIds.push(...match.inBackpack)
    if (match.inBackpack.length > 0) hasBackpackMatch = true
  }

  for (const [key, match] of ownedByArchetypeKey) {
    const parts = key.split(':')
    const archetype = parts[0] ?? ''
    const tier = (parts[1] ?? 'Bronze') as TierKey
    const star = Number(parts[2]) === 2 ? 2 : 1
    if (!archetype || !nextTierLevel(tier, star)) continue
    if (match.defIds.size < 2) continue
    const count = match.inBattle.length + match.inBackpack.length
    if (count < 2) continue
    battleIds.push(...match.inBattle)
    backpackIds.push(...match.inBackpack)
    if (match.inBackpack.length > 0) hasBackpackMatch = true
  }

  for (let i = 0; i < shopManager.pool.length; i++) {
    const slot = shopManager.pool[i]
    if (!slot || slot.purchased || slot.tier === 'Diamond') continue
    const directMatch = ownedByKey.get(`${slot.item.id}:${slot.tier}:1`)
    const slotArch = getPrimaryArchetype(slot.item.tags)
    const archMatch = ownedByArchetypeKey.get(`${slotArch}:${slot.tier}:1`)
    const canDirect = !!directMatch && (directMatch.inBattle.length + directMatch.inBackpack.length > 0)
    const canCross = !!archMatch
      && (archMatch.inBattle.length + archMatch.inBackpack.length > 0)
      && (archMatch.defIds.size > 1 || !archMatch.defIds.has(slot.item.id))
    if (!canDirect && !canCross) continue
    shopSlots.push(i)
  }

  return {
    shopSlots,
    battleIds: Array.from(new Set(battleIds)),
    backpackIds: Array.from(new Set(backpackIds)),
    hasBackpackMatch,
  }
}

function refreshUpgradeHints(): void {
  const match = computeUpgradeMatch()
  shopPanel?.setUpgradeHints(match.shopSlots)
  battleView?.setUpgradeHints(match.battleIds)
  backpackView?.setUpgradeHints(match.backpackIds)
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
): void {
  if (!backpackView || !battleView) return
  const canLv7Morph = !!defId && !!tier && canUseLv7MorphSynthesis(defId, defId, tier, star, tier, star)
  if (!defId || !tier || (!nextTierLevel(tier, star) && !canLv7Morph)) {
    backpackView.setDragGuideArrows([])
    battleView.setDragGuideArrows([])
    return
  }
  const backpackGuide = collectSynthesisGuideIds(backpackSystem, defId, tier, star, excludeInstanceId)
  const battleGuide = isBattleZoneNoSynthesisEnabled()
    ? { sameIds: [], crossIds: [] }
    : collectSynthesisGuideIds(battleSystem, defId, tier, star, excludeInstanceId)
  if (canLv7Morph) {
    backpackView.setDragGuideArrows([], [...backpackGuide.sameIds, ...backpackGuide.crossIds], 'convert')
    battleView.setDragGuideArrows([], [...battleGuide.sameIds, ...battleGuide.crossIds], 'convert')
    return
  }
  backpackView.setDragGuideArrows(backpackGuide.sameIds, backpackGuide.crossIds)
  battleView.setDragGuideArrows(battleGuide.sameIds, battleGuide.crossIds)
}

function clearBackpackSynthesisGuideArrows(): void {
  backpackView?.setDragGuideArrows([])
  battleView?.setDragGuideArrows([])
}

function findSynthesisTargetAtPointer(
  defId: string,
  tier: TierKey,
  star: 1 | 2,
  gx: number,
  gy: number,
  _dragSize?: ItemSizeNorm,
): SynthesisTarget | null {
  if (!isBattleZoneNoSynthesisEnabled() && battleView && battleSystem) {
    for (const it of battleSystem.getAllItems()) {
      const itTier = instanceToTier.get(it.instanceId) ?? 'Bronze'
      const itStar = getInstanceTierStar(it.instanceId)
      if (!canSynthesizePair(defId, it.defId, tier, star, itTier, itStar)) continue
      if (isPointInItemBounds(battleView, it, gx, gy)) {
        return { instanceId: it.instanceId, zone: 'battle' }
      }
    }
  }

  if (backpackView && backpackView.visible && backpackSystem) {
    for (const it of backpackSystem.getAllItems()) {
      const itTier = instanceToTier.get(it.instanceId) ?? 'Bronze'
      const itStar = getInstanceTierStar(it.instanceId)
      if (!canSynthesizePair(defId, it.defId, tier, star, itTier, itStar)) continue
      if (isPointInItemBounds(backpackView, it, gx, gy)) {
        return { instanceId: it.instanceId, zone: 'backpack' }
      }
    }
  }

  return null
}

function getSizeCellDim(size: ItemSizeNorm): { w: number; h: number } {
  if (size === '1x1') return { w: 1, h: 1 }
  if (size === '2x1') return { w: 2, h: 1 }
  return { w: 3, h: 1 }
}

function findSynthesisTargetByFootprint(
  defId: string,
  tier: TierKey,
  star: 1 | 2,
  gx: number,
  gy: number,
  dragSize?: ItemSizeNorm,
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
    (isBattleZoneNoSynthesisEnabled() ? null : tryZone(battleView, battleSystem, 'battle'))
    ?? tryZone(backpackView, backpackSystem, 'backpack')
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
): SynthesisTarget | null {
  if (!battleSystem || !battleView) return null
  const battleSystemRef = battleSystem
  const battleViewRef = battleView

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

function getSynthesisTargetItem(target: SynthesisTarget): PlacedItem | null {
  if (!battleSystem || !backpackSystem) return null
  const system = target.zone === 'battle' ? battleSystem : backpackSystem
  return system.getItem(target.instanceId) ?? null
}

function getCrossSynthesisMinStartingTier(sourceDef: ItemDef, targetDef: ItemDef): TierKey {
  const sourceMinTier = parseTierName(sourceDef.starting_tier) ?? 'Bronze'
  const targetMinTier = parseTierName(targetDef.starting_tier) ?? 'Bronze'
  return maxTier(sourceMinTier, targetMinTier)
}

function getCrossIdEvolvePool(
  sourceDef: ItemDef,
  targetSize: ItemSizeNorm,
  resultTier: TierKey,
  minStartingTier: TierKey,
): {
  basePool: ItemDef[]
  sameArchPool: ItemDef[]
  otherArchPool: ItemDef[]
} {
  const basePool = getAllItems().filter((it) =>
    normalizeSize(it.size) === targetSize
    && !isNeutralItemDef(it)
    && parseAvailableTiers(it.available_tiers).includes(resultTier)
    && compareTier(parseTierName(it.starting_tier) ?? 'Bronze', minStartingTier) >= 0
  )
  const sourceArch = getPrimaryArchetype(sourceDef.tags)
  if (!sourceArch) {
    return { basePool, sameArchPool: basePool, otherArchPool: basePool }
  }
  const sameArchPool = basePool.filter((it) => getPrimaryArchetype(it.tags) === sourceArch)
  const otherArchPool = basePool.filter((it) => getPrimaryArchetype(it.tags) !== sourceArch)
  return { basePool, sameArchPool, otherArchPool }
}

function pickCrossIdEvolveCandidates(
  sourceDef: ItemDef,
  targetSize: ItemSizeNorm,
  resultTier: TierKey,
  minStartingTier: TierKey,
  preferOtherArchetype = false,
): ItemDef[] {
  const { basePool, otherArchPool } = getCrossIdEvolvePool(sourceDef, targetSize, resultTier, minStartingTier)
  if (preferOtherArchetype) return otherArchPool
  if (basePool.length > 0) return basePool
  return []
}

function getCrossIdPreviewCandidates(
  sourceDef: ItemDef,
  targetSize: ItemSizeNorm,
  resultTier: TierKey,
  minStartingTier: TierKey,
  preferOtherArchetype = false,
): ItemDef[] {
  const { basePool, otherArchPool } = getCrossIdEvolvePool(sourceDef, targetSize, resultTier, minStartingTier)
  if (preferOtherArchetype) return otherArchPool
  return basePool
}

function shouldCrossSynthesisPreferOtherArchetype(sourceDef: ItemDef, targetDef: ItemDef): boolean {
  if (sourceDef.id === targetDef.id) return false
  const sourceArch = toSkillArchetype(getPrimaryArchetype(sourceDef.tags))
  const targetArch = toSkillArchetype(getPrimaryArchetype(targetDef.tags))
  if (sourceArch !== targetArch) return false
  return sourceArch === 'warrior' || sourceArch === 'archer' || sourceArch === 'assassin'
}

function highlightSynthesisTarget(target: SynthesisTarget | null): void {
  if (!target || !battleSystem || !backpackSystem || !battleView || !backpackView) {
    battleView?.clearHighlight()
    backpackView?.clearHighlight()
    return
  }

  const inBattle = target.zone === 'battle'
  const system = inBattle ? battleSystem : backpackSystem
  const view = inBattle ? battleView : backpackView
  const item = system.getItem(target.instanceId)
  if (!item) {
    battleView?.clearHighlight()
    backpackView?.clearHighlight()
    return
  }

  view.highlightCells(item.col, item.row, item.size, true, SYNTH_HIGHLIGHT_COLOR)
  if (inBattle) backpackView.clearHighlight()
  else battleView.clearHighlight()
}

function synthesizeTarget(
  defId: string,
  tier: TierKey,
  star: 1 | 2,
  targetInstanceId: string,
  zone: 'battle' | 'backpack',
): SynthesizeResult | null {
  if (!battleSystem || !backpackSystem || !battleView || !backpackView) return null
  const baseUpgrade = nextTierLevel(tier, star)
  if (!baseUpgrade) return null
  let upgradeTo = baseUpgrade
  const eventExtra = dayEventState.extraUpgradeRemaining > 0
  if (eventExtra) {
    const extra = nextTierLevel(upgradeTo.tier, upgradeTo.star)
    if (extra) upgradeTo = extra
  }
  const skillExtra = nextTierLevel(upgradeTo.tier, upgradeTo.star)
  const wantsSkillExtra = shouldTriggerSkill48ExtraUpgrade(hasPickedSkill('skill48'), !!skillExtra, Math.random())
  if (wantsSkillExtra && skillExtra) upgradeTo = skillExtra

  const targetItem = zone === 'battle'
    ? battleSystem.getItem(targetInstanceId)
    : backpackSystem.getItem(targetInstanceId)
  if (!targetItem) return null
  const targetTier = instanceToTier.get(targetInstanceId) ?? 'Bronze'
  const targetStar = getInstanceTierStar(targetInstanceId)
  if (!canSynthesizePair(defId, targetItem.defId, tier, star, targetTier, targetStar)) return null

  const sourceDef = getItemDefById(defId)
  if (!sourceDef) return null
  const targetDef = getItemDefById(targetItem.defId)
  if (!targetDef) return null

  const isSameIdSynthesis = defId === targetItem.defId
  const forceSynthesisActive = !!(dayEventState.forceSynthesisArchetype && dayEventState.forceSynthesisRemaining > 0)
  const minStartingTier = getCrossSynthesisMinStartingTier(sourceDef, targetDef)
  const preferOtherArchetype = shouldCrossSynthesisPreferOtherArchetype(sourceDef, targetDef) && !forceSynthesisActive
  let guaranteeNewUnlock = shouldGuaranteeNewUnlock(upgradeTo.tier, upgradeTo.star)
  let resultLevel = tierStarLevelIndex(upgradeTo.tier, upgradeTo.star) + 1
  const buildCandidates = (targetTier: TierKey) => {
    const all = pickCrossIdEvolveCandidates(sourceDef, targetItem.size, targetTier, minStartingTier, preferOtherArchetype)
    if (forceSynthesisActive) {
      const forced = all.filter((it) => toSkillArchetype(getPrimaryArchetype(it.tags)) === dayEventState.forceSynthesisArchetype)
      if (forced.length > 0) return forced
      if (all.length > 0) return all
      return [sourceDef]
    }
    if (dayEventState.allSynthesisRandom) {
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

  const system = zone === 'battle' ? battleSystem : backpackSystem
  const view = zone === 'battle' ? battleView : backpackView
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
    drag?.refreshZone(view)
  })

  instanceToDefId.set(targetInstanceId, evolvedDef.id)
  setInstanceQualityLevel(targetInstanceId, evolvedDef.id, parseTierName(evolvedDef.starting_tier) ?? 'Bronze', resultLevel)
  if (eventExtra && dayEventState.extraUpgradeRemaining > 0) {
    dayEventState.extraUpgradeRemaining = Math.max(0, dayEventState.extraUpgradeRemaining - 1)
  }
  if (forceSynthesisActive && dayEventState.forceSynthesisRemaining > 0) {
    dayEventState.forceSynthesisRemaining = Math.max(0, dayEventState.forceSynthesisRemaining - 1)
    if (dayEventState.forceSynthesisRemaining <= 0) dayEventState.forceSynthesisArchetype = null
  }
  unlockItemToPool(evolvedDef.id)
  if (guaranteeNewUnlock && (resultLevel === 3 || resultLevel === 5 || resultLevel === 7)) {
    guaranteedNewUnlockTriggeredLevels.add(resultLevel)
  }
  applyInstanceTierVisuals()
  syncShopOwnedTierRules()
  refreshUpgradeHints()
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

function hideSynthesisHoverInfo(): void {
  synthHoverInfoKey = ''
}

function showSynthesisHoverInfo(
  sourceDefId: string,
  sourceTier: TierKey,
  sourceStar: 1 | 2,
  target: SynthesisTarget,
): void {
  if (!battleSystem || !backpackSystem || !sellPopup || !shopManager) return
  const sourceDef = getItemDefById(sourceDefId)
  if (!sourceDef) return
  const system = target.zone === 'battle' ? battleSystem : backpackSystem
  const targetItem = system.getItem(target.instanceId)
  if (!targetItem) return
  const targetTier = getInstanceTier(target.instanceId) ?? sourceTier
  const targetStar = getInstanceTierStar(target.instanceId)
  const lv7MorphMode = canUseLv7MorphSynthesis(sourceDefId, targetItem.defId, sourceTier, sourceStar, targetTier, targetStar)
  if (lv7MorphMode) {
    const morphStone = getItemDefByCn('变化石') ?? sourceDef
    const customDisplay: ItemInfoCustomDisplay = {
      overrideName: '变化石（Lv7转化）',
      lines: ['将两个Lv7物品转化为同职业其他Lv7物品', '松手后需二次确认，再进入2选1变化'],
      suppressStats: true,
    }
    sellPopup.show(morphStone, 0, 'none', 'Bronze#1', undefined, 'detailed', undefined, customDisplay)
    return
  }
  const upgradeTo = nextTierLevel(sourceTier, sourceStar)
  if (!upgradeTo) return
  const isSameItem = sourceDefId === targetItem.defId
  const mode = isSameItem ? 'same_archetype' : 'cross_archetype'
  const key = `${sourceDefId}|${sourceTier}|${sourceStar}|${target.instanceId}|${mode}`
  if (synthHoverInfoKey === key) return
  synthHoverInfoKey = key

  const buyPrice = shopManager.getItemPrice(sourceDef, sourceTier)
  if (isSameItem) {
    sellPopup.show(sourceDef, buyPrice, 'buy', toVisualTier(upgradeTo.tier, upgradeTo.star), undefined, 'detailed')
    return
  }

  if (canUseSameArchetypeDiffItemStoneSynthesis(sourceDefId, targetItem.defId, sourceTier, sourceStar, targetTier, targetStar)) {
    const customDisplay: ItemInfoCustomDisplay = {
      hideName: true,
      lines: ['升级为 +1 级其他非中立职业物品（同等级桶随机）'],
      suppressStats: true,
      hideTierBadge: true,
      centerRichLineInFrame: true,
    }
    sellPopup.show(sourceDef, buyPrice, 'buy', toVisualTier(upgradeTo.tier, upgradeTo.star), undefined, 'detailed', undefined, customDisplay)
    return
  }

  const customDisplay: ItemInfoCustomDisplay = {
    hideName: true,
    lines: ['升级为 随机 物品'],
    richLineSegments: [
      { text: '升级为 ', fontSize: 28, fill: 0xbfc7f5 },
      { text: '随机', fontSize: 40, fill: 0xffd86b },
      { text: ' 物品', fontSize: 28, fill: 0xbfc7f5 },
    ],
    suppressStats: true,
    hideTierBadge: true,
    useQuestionIcon: true,
    centerRichLineInFrame: true,
  }
  sellPopup.show(sourceDef, buyPrice, 'buy', toVisualTier(sourceTier, sourceStar), undefined, 'detailed', undefined, customDisplay)
}

function synthesisLevelLabel(tier: TierKey, star: 1 | 2): string {
  return String(tierStarLevelIndex(tier, star) + 1)
}

function createCrossSynthesisPreviewCard(
  item: ItemDef,
  frameTier: TierKey,
  badgeTier: TierKey,
  badgeStar: 1 | 2,
): Container {
  const con = new Container()
  const cardScale = 0.76
  const cardW = CELL_SIZE
  const cardH = CELL_HEIGHT
  const cornerRadius = Math.max(0, Math.round(getDebugCfg('gridItemCornerRadius')))
  const borderW = Math.max(1, 8 / cardScale)
  const frameInset = Math.max(3, 2 + Math.ceil(borderW / 2))
  const frameW = Math.max(1, cardW - frameInset * 2)
  const frameH = Math.max(1, cardH - frameInset * 2)
  const frameRadius = Math.max(0, cornerRadius - (frameInset - 3))
  const spriteInset = frameInset + Math.max(2, Math.ceil(borderW / 2))

  const frame = new Graphics()
  frame.roundRect(frameInset, frameInset, frameW, frameH, frameRadius)
  frame.fill({ color: 0x000000, alpha: 0.001 })
  frame.stroke({ color: getTierColor(frameTier), width: borderW, alpha: 0.98 })
  con.addChild(frame)

  const icon = new Sprite(Texture.WHITE)
  const baseCellInner = Math.max(1, CELL_SIZE - spriteInset * 2)
  const spriteSide = Math.max(1, Math.min(frameW, baseCellInner))
  icon.width = spriteSide
  icon.height = spriteSide
  icon.x = frameInset + (frameW - spriteSide) / 2
  icon.y = frameInset + (frameH - spriteSide) / 2
  icon.alpha = 0
  con.addChild(icon)

  void Assets.load<Texture>(getItemIconUrl(item.id)).then((tex) => {
    const sw = Math.max(1, tex.width)
    const sh = Math.max(1, tex.height)
    const scale = Math.min(spriteSide / sw, spriteSide / sh)
    icon.texture = tex
    icon.width = Math.max(1, Math.round(sw * scale))
    icon.height = Math.max(1, Math.round(sh * scale))
    icon.x = frameInset + (frameW - icon.width) / 2
    icon.y = frameInset + (frameH - icon.height) / 2
    icon.alpha = 1
  }).catch(() => {
    // ignore runtime missing icon
  })

  const badges = createItemStatBadges(
    item,
    getDebugCfg('itemStatBadgeFontSize'),
    Math.max(44, cardW - 8),
    undefined,
    'archetype',
    { archetypeSuffix: synthesisLevelLabel(badgeTier, badgeStar) },
  )
  badges.x = cardW / 2
  badges.y = getDebugCfg('itemStatBadgeOffsetY') + 14
  con.addChild(badges)
  con.scale.set(cardScale)
  return con
}

function teardownCrossSynthesisConfirmOverlay(): void {
  if (crossSynthesisConfirmCloseTimer) {
    clearTimeout(crossSynthesisConfirmCloseTimer)
    crossSynthesisConfirmCloseTimer = null
  }
  if (crossSynthesisConfirmTick) {
    Ticker.shared.remove(crossSynthesisConfirmTick)
    crossSynthesisConfirmTick = null
  }
  if (crossSynthesisConfirmOverlay?.parent) {
    crossSynthesisConfirmOverlay.parent.removeChild(crossSynthesisConfirmOverlay)
  }
  crossSynthesisConfirmOverlay?.destroy({ children: true })
  crossSynthesisConfirmOverlay = null
  crossSynthesisConfirmAction = null
  const unlock = crossSynthesisConfirmUnlockInput
  crossSynthesisConfirmUnlockInput = null
  unlock?.()
}

function showCrossSynthesisConfirmOverlay(
  stage: Container,
  sourcePreview: SynthesisPreviewItem,
  targetPreview: SynthesisPreviewItem,
  resultTier: TierKey,
  resultStar: 1 | 2,
  onConfirm: () => void,
  onCancel?: () => void,
): void {
  teardownCrossSynthesisConfirmOverlay()

  const prevDragEnabled = drag?.isEnabled() ?? true
  const prevShopInteractive = shopPanel?.interactiveChildren ?? false
  const prevBtnInteractive = btnRow?.interactiveChildren ?? false
  const prevDayInteractive = dayDebugCon?.interactiveChildren ?? false
  drag?.setEnabled(false)
  if (shopPanel) shopPanel.interactiveChildren = false
  if (btnRow) btnRow.interactiveChildren = false
  if (dayDebugCon) dayDebugCon.interactiveChildren = false
  crossSynthesisConfirmUnlockInput = () => {
    if (drag) drag.setEnabled(prevDragEnabled)
    if (shopPanel) shopPanel.interactiveChildren = prevShopInteractive
    if (btnRow) btnRow.interactiveChildren = prevBtnInteractive
    if (dayDebugCon) dayDebugCon.interactiveChildren = prevDayInteractive
  }

  const minStartingTier = getCrossSynthesisMinStartingTier(sourcePreview.def, targetPreview.def)
  const forceSynthesisActive = !!(dayEventState.forceSynthesisArchetype && dayEventState.forceSynthesisRemaining > 0)
  const preferOtherArchetype = shouldCrossSynthesisPreferOtherArchetype(sourcePreview.def, targetPreview.def) && !forceSynthesisActive
  const candidates = getCrossIdPreviewCandidates(
    sourcePreview.def,
    normalizeSize(targetPreview.def.size),
    resultTier,
    minStartingTier,
    preferOtherArchetype,
  )
  crossSynthesisConfirmAction = onConfirm

  const overlay = new Container()
  overlay.zIndex = 4100
  overlay.eventMode = 'static'
  overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

  const mask = new Graphics()
  mask.rect(0, 0, CANVAS_W, CANVAS_H)
  mask.fill({ color: 0x060a12, alpha: 0.82 })
  overlay.addChild(mask)

  const panel = new Container()
  panel.x = CANVAS_W / 2
  panel.y = CANVAS_H / 2
  panel.eventMode = 'static'
  panel.on('pointerdown', (e) => e.stopPropagation())
  overlay.addChild(panel)

  const panelW = 592
  const panelH = 700
  const titleY = -268
  const viewportY = -90
  const dontShowAgainY = 62
  const actionBtnStartY = 157
  const actionBtnGap = 34
  const panelBg = new Graphics()
  panelBg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 22)
  panelBg.fill({ color: 0x151c2d, alpha: 0.98 })
  panelBg.stroke({ color: 0x82b6ff, width: 3, alpha: 0.98 })
  panel.addChild(panelBg)

  const title = new Text({
    text: '随机升级',
    style: {
      fontSize: getDebugCfg('synthTitleFontSize'),
      fill: 0xffefc8,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      stroke: { color: 0x0a1020, width: 4 },
    },
  })
  title.anchor.set(0.5)
  title.y = titleY
  panel.addChild(title)

  const viewport = new Container()
  viewport.x = 0
  viewport.y = viewportY
  panel.addChild(viewport)

  const viewportW = panelW - 70
  const viewportH = 236
  const viewportBg = new Graphics()
  viewportBg.roundRect(-viewportW / 2, -viewportH / 2, viewportW, viewportH, 18)
  viewportBg.fill({ color: 0x0e1730, alpha: 0.9 })
  viewportBg.stroke({ color: 0x3a5f95, width: 2, alpha: 0.98 })
  viewport.addChild(viewportBg)

  const previewCardVisualSize = Math.round(CELL_SIZE * 0.76)
  const flowCenterY = 8
  const inputACenterX = -166
  const inputBCenterX = -34
  const plusCenterX = Math.round((inputACenterX + inputBCenterX) / 2)
  const resultCenterX = 166
  const arrowCenterX = Math.round((inputBCenterX + resultCenterX) / 2)

  const sourceCardA = createCrossSynthesisPreviewCard(sourcePreview.def, sourcePreview.tier, sourcePreview.tier, sourcePreview.star)
  sourceCardA.x = inputACenterX - previewCardVisualSize / 2
  sourceCardA.y = flowCenterY - previewCardVisualSize / 2
  viewport.addChild(sourceCardA)

  const plusText = new Text({
    text: '+',
    style: { fontSize: 58, fill: 0x79b4ff, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x0b1933, width: 4 } },
  })
  plusText.anchor.set(0.5)
  plusText.x = plusCenterX
  plusText.y = flowCenterY
  viewport.addChild(plusText)

  const sourceCardB = createCrossSynthesisPreviewCard(targetPreview.def, targetPreview.tier, targetPreview.tier, targetPreview.star)
  sourceCardB.x = inputBCenterX - previewCardVisualSize / 2
  sourceCardB.y = flowCenterY - previewCardVisualSize / 2
  viewport.addChild(sourceCardB)

  const arrowText = new Text({
    text: '→',
    style: { fontSize: 66, fill: 0x8bc3ff, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x0b1933, width: 4 } },
  })
  arrowText.anchor.set(0.5)
  arrowText.x = arrowCenterX
  arrowText.y = flowCenterY
  viewport.addChild(arrowText)

  const resultSlot = new Container()
  resultSlot.x = resultCenterX
  resultSlot.y = flowCenterY
  viewport.addChild(resultSlot)

  const resultMaskFrame = new Graphics()
  resultMaskFrame.roundRect(-64, -94, 128, 188, 16)
  resultMaskFrame.fill({ color: 0x0b1222, alpha: 0.55 })
  resultMaskFrame.stroke({ color: 0x3a5685, width: 2, alpha: 0.95 })
  resultSlot.addChild(resultMaskFrame)

  const resultTrack = new Container()
  resultSlot.addChild(resultTrack)

  const maskRect = new Graphics()
  maskRect.roundRect(-56, -86, 112, 172, 14)
  maskRect.fill({ color: 0xffffff, alpha: 1 })
  resultSlot.addChild(maskRect)
  resultTrack.mask = maskRect

  const resultPool = candidates.length > 0 ? candidates : [sourcePreview.def]
  const cardStep = previewCardVisualSize + 52
  const cardBaseY = -previewCardVisualSize / 2
  const resultCards = resultPool.map((def) => {
    const displayTier = parseTierName(def.starting_tier) ?? 'Bronze'
    const card = createCrossSynthesisPreviewCard(def, displayTier, resultTier, resultStar)
    card.x = -previewCardVisualSize / 2
    card.y = cardBaseY
    resultTrack.addChild(card)
    return card
  })

  for (let i = 0; i < resultCards.length; i++) {
    resultCards[i]!.y = cardBaseY - i * cardStep
  }

  if (resultCards.length > 1) {
    let prevTs = Date.now()
    const wrapThreshold = cardBaseY + cardStep
    crossSynthesisConfirmTick = () => {
      const now = Date.now()
      const dtMs = Math.max(0, now - prevTs)
      prevTs = now
      const speed = Math.max(40, getDebugCfg('crossSynthesisCarouselSpeedPx'))
      const dy = dtMs * (speed / 1000)
      for (const card of resultCards) {
        card.y += dy
        if (card.y > wrapThreshold) {
          card.y -= cardStep * resultCards.length
        }
      }
    }
    Ticker.shared.add(crossSynthesisConfirmTick)
  }

  let dontShowAgainChecked = false
  const dontShowAgainRow = new Container()
  dontShowAgainRow.y = dontShowAgainY
  dontShowAgainRow.eventMode = 'static'
  dontShowAgainRow.cursor = 'pointer'
  panel.addChild(dontShowAgainRow)

  const dontShowAgainBox = new Graphics()
  const dontShowAgainMark = new Text({
    text: '✓',
    style: { fontSize: 28, fill: 0xeaf4ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  dontShowAgainMark.anchor.set(0.5)
  dontShowAgainMark.x = -154
  dontShowAgainMark.y = 1
  const dontShowAgainLabel = new Text({
    text: '不再显示此提示',
    style: { fontSize: 24, fill: 0xd6e4ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  dontShowAgainLabel.anchor.set(0, 0.5)
  dontShowAgainLabel.x = -130
  dontShowAgainLabel.y = 0

  const redrawDontShowAgain = () => {
    const checked = dontShowAgainChecked
    dontShowAgainBox.clear()
    dontShowAgainBox.roundRect(-172, -18, 34, 34, 8)
    dontShowAgainBox.fill({ color: checked ? 0x4d79b9 : 0x202f49, alpha: 0.98 })
    dontShowAgainBox.stroke({ color: checked ? 0xaed3ff : 0x6e86aa, width: 2, alpha: 0.95 })
    dontShowAgainMark.visible = checked
  }
  redrawDontShowAgain()

  dontShowAgainRow.on('pointerdown', (e: FederatedPointerEvent) => {
    e.stopPropagation()
    dontShowAgainChecked = !dontShowAgainChecked
    setDebugCfg('gameplayCrossSynthesisConfirm', dontShowAgainChecked ? 0 : 1)
    redrawDontShowAgain()
  })
  dontShowAgainRow.addChild(dontShowAgainBox, dontShowAgainMark, dontShowAgainLabel)

  const closeAsCancel = () => {
    teardownCrossSynthesisConfirmOverlay()
    onCancel?.()
  }

  const actionBtnW = 376
  const actionBtnH = 88
  const actionBtnRadius = 18
  const confirmBtn = new Container()
  confirmBtn.y = actionBtnStartY
  confirmBtn.eventMode = 'static'
  confirmBtn.cursor = 'pointer'
  panel.addChild(confirmBtn)

  const confirmBg = new Graphics()
  confirmBtn.addChild(confirmBg)
  const confirmText = new Text({
    text: '确认合成',
    style: { fontSize: getDebugCfg('shopButtonLabelFontSize'), fill: 0x10203a, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  confirmText.anchor.set(0.5)
  confirmBtn.addChild(confirmText)

  let confirmEnabled = false
  const redrawConfirm = () => {
    confirmBg.clear()
    confirmBg.roundRect(-actionBtnW / 2, -actionBtnH / 2, actionBtnW, actionBtnH, actionBtnRadius)
    confirmBg.fill({ color: confirmEnabled ? 0x6dd3ff : 0x536480, alpha: confirmEnabled ? 0.96 : 0.74 })
    confirmBg.stroke({ color: confirmEnabled ? 0xb8e8ff : 0x7f8ea9, width: 3, alpha: 1 })
    confirmText.style.fill = confirmEnabled ? 0x10203a : 0xdbe6ff
  }
  redrawConfirm()

  crossSynthesisConfirmCloseTimer = setTimeout(() => {
    confirmEnabled = true
    redrawConfirm()
    crossSynthesisConfirmCloseTimer = null
  }, 360)

  confirmBtn.on('pointerdown', (e: FederatedPointerEvent) => {
    e.stopPropagation()
    if (!confirmEnabled) return
    const action = crossSynthesisConfirmAction
    teardownCrossSynthesisConfirmOverlay()
    action?.()
  })

  const cancelBtn = new Container()
  cancelBtn.y = confirmBtn.y + actionBtnH + actionBtnGap
  cancelBtn.eventMode = 'static'
  cancelBtn.cursor = 'pointer'
  panel.addChild(cancelBtn)

  const cancelBg = new Graphics()
  cancelBg.roundRect(-actionBtnW / 2, -actionBtnH / 2, actionBtnW, actionBtnH, actionBtnRadius)
  cancelBg.fill({ color: 0x25344d, alpha: 0.9 })
  cancelBg.stroke({ color: 0x5d7597, width: 3, alpha: 1 })
  cancelBtn.addChild(cancelBg)
  const cancelText = new Text({
    text: '取消',
    style: { fontSize: getDebugCfg('shopButtonLabelFontSize'), fill: 0xc9d6ef, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  cancelText.anchor.set(0.5)
  cancelBtn.addChild(cancelText)
  cancelBtn.on('pointerdown', (e: FederatedPointerEvent) => {
    e.stopPropagation()
    closeAsCancel()
  })

  overlay.on('pointerdown', (e: FederatedPointerEvent) => {
    e.stopPropagation()
    closeAsCancel()
  })

  crossSynthesisConfirmOverlay = overlay
  stage.addChild(overlay)
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
    drag?.refreshZone(homeView)
  })
}

function playSynthesisFlashEffect(stage: Container, result: SynthesizeResult): void {
  if (!battleSystem || !backpackSystem || !battleView || !backpackView) return
  const system = result.targetZone === 'battle' ? battleSystem : backpackSystem
  const view = result.targetZone === 'battle' ? battleView : backpackView
  const item = system.getItem(result.instanceId)
  if (!item) return

  const w = item.size === '1x1' ? CELL_SIZE : item.size === '2x1' ? CELL_SIZE * 2 : CELL_SIZE * 3
  const h = CELL_HEIGHT
  const a = view.toGlobal({ x: item.col * CELL_SIZE, y: item.row * CELL_HEIGHT })
  const b = view.toGlobal({ x: item.col * CELL_SIZE + w, y: item.row * CELL_HEIGHT + h })
  const p0 = stage.toLocal(a)
  const p1 = stage.toLocal(b)
  const x = Math.min(p0.x, p1.x)
  const y = Math.min(p0.y, p1.y)
  const rectW = Math.abs(p1.x - p0.x)
  const rectH = Math.abs(p1.y - p0.y)
  const flash = new Graphics()
  flash.eventMode = 'none'
  stage.addChild(flash)

  const durationMs = 220
  const start = Date.now()
  const tick = () => {
    const t = Math.min(1, (Date.now() - start) / durationMs)
    const alpha = Math.sin(Math.PI * t) * 0.78
    const corner = Math.max(6, Math.round(getDebugCfg('gridItemCornerRadius') * (view.scale.x || 1)))
    flash.clear()
    flash.roundRect(x + 2, y + 2, Math.max(4, rectW - 4), Math.max(4, rectH - 4), corner)
    flash.fill({ color: 0xffffff, alpha })
    flash.roundRect(x + 1, y + 1, Math.max(2, rectW - 2), Math.max(2, rectH - 2), corner)
    flash.stroke({ color: 0xffffff, width: 2, alpha: Math.max(0, alpha * 0.9) })
    if (t >= 1) {
      Ticker.shared.remove(tick)
      flash.parent?.removeChild(flash)
      flash.destroy()
    }
  }
  Ticker.shared.add(tick)
}

function playTransformOrUpgradeFlashEffect(instanceId: string, zone: 'battle' | 'backpack'): void {
  if (!battleSystem || !backpackSystem || !battleView || !backpackView) return
  const flashKey = `${zone}:${instanceId}`
  const now = Date.now()
  const lastAt = itemTransformFlashLastAtMs.get(flashKey) ?? 0
  if (now - lastAt < 80) return
  itemTransformFlashLastAtMs.set(flashKey, now)

  const system = zone === 'battle' ? battleSystem : backpackSystem
  const view = zone === 'battle' ? battleView : backpackView
  const item = system.getItem(instanceId)
  if (!item) return
  const stage = getApp().stage

  const w = item.size === '1x1' ? CELL_SIZE : item.size === '2x1' ? CELL_SIZE * 2 : CELL_SIZE * 3
  const h = CELL_HEIGHT
  const a = view.toGlobal({ x: item.col * CELL_SIZE, y: item.row * CELL_HEIGHT })
  const b = view.toGlobal({ x: item.col * CELL_SIZE + w, y: item.row * CELL_HEIGHT + h })
  const p0 = stage.toLocal(a)
  const p1 = stage.toLocal(b)
  const x = Math.min(p0.x, p1.x)
  const y = Math.min(p0.y, p1.y)
  const rectW = Math.abs(p1.x - p0.x)
  const rectH = Math.abs(p1.y - p0.y)

  const flash = new Graphics()
  flash.eventMode = 'none'
  stage.addChild(flash)
  const durationMs = 220
  const start = Date.now()
  const tick = () => {
    const t = Math.min(1, (Date.now() - start) / durationMs)
    const alpha = Math.sin(Math.PI * t) * 0.78
    const corner = Math.max(6, Math.round(getDebugCfg('gridItemCornerRadius') * (view.scale.x || 1)))
    flash.clear()
    flash.roundRect(x + 2, y + 2, Math.max(4, rectW - 4), Math.max(4, rectH - 4), corner)
    flash.fill({ color: 0xffffff, alpha })
    flash.roundRect(x + 1, y + 1, Math.max(2, rectW - 2), Math.max(2, rectH - 2), corner)
    flash.stroke({ color: 0xffffff, width: 2, alpha: Math.max(0, alpha * 0.9) })
    if (t >= 1) {
      Ticker.shared.remove(tick)
      flash.parent?.removeChild(flash)
      flash.destroy()
    }
  }
  Ticker.shared.add(tick)
}

function findFirstBackpackPlace(size: ItemSizeNorm): { col: number; row: number } | null {
  if (!backpackSystem || !backpackView) return null
  for (let row = 0; row < backpackSystem.rows; row++) {
    for (let col = 0; col < backpackView.activeColCount; col++) {
      const finalRow = row
      if (canPlaceInVisibleCols(backpackSystem, backpackView, col, finalRow, size)) {
        return { col, row: finalRow }
      }
    }
  }
  return null
}

function findFirstBattlePlace(size: ItemSizeNorm): { col: number; row: number } | null {
  if (!battleSystem || !battleView) return null
  for (let row = 0; row < battleSystem.rows; row++) {
    for (let col = 0; col < battleView.activeColCount; col++) {
      if (canPlaceInVisibleCols(battleSystem, battleView, col, row, size)) {
        return { col, row }
      }
    }
  }
  return null
}

const STARTER_CLASS_PRESETS: Record<StarterClass, {
  title: string
  subtitle: string
  gifts: [string, string]
  heroImage: string
}> = {
  swordsman: {
    title: '剑士',
    subtitle: '稳扎稳打，\n护盾连携持续输出。',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/warrior.png',
  },
  archer: {
    title: '弓手',
    subtitle: '管理弹药节奏，\n打出高频远程火力。',
    gifts: ['木弓', '弹药袋'],
    heroImage: '/resource/hero/archer.png',
  },
  assassin: {
    title: '刺客',
    subtitle: '低冷却连击，\n快速压制并终结对手。',
    gifts: ['匕首', '连发镖'],
    heroImage: '/resource/hero/assassin.png',
  },
  hero1: {
    title: '占卜师',
    subtitle: '不同物品合成，可以选择合成结果（每天限1次）',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero1.png',
  },
  hero2: {
    title: '大亨',
    subtitle: '每天额外获得天数*3的金币',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero2.png',
  },
  hero3: {
    title: '魔术师',
    subtitle: '每天首次丢弃物品，获得同等级的随机物品',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero3.png',
  },
  hero4: {
    title: '戏法师',
    subtitle: '相同物品合成，可以选择合成结果（每天限1次）',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero4.png',
  },
  hero5: {
    title: '铁匠',
    subtitle: '每隔3天获得1颗升级石：丢弃时随机升级1个物品',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero5.png',
  },
  hero6: {
    title: '冒险家',
    subtitle: '每隔3天获得1张冒险券：丢弃时进行一次冒险',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero6.png',
  },
  hero7: {
    title: '指挥官',
    subtitle: '每隔3天获得1枚勋章：选择1个职业，获得该职业随机物品',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero7.png',
  },
  hero8: {
    title: '继承者',
    subtitle: '第3天获得1个黄金宝箱：选择1个黄金物品',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero8.png',
  },
  hero9: {
    title: '大胃王',
    subtitle: '初始红心设置为40点',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero9.png',
  },
  hero10: {
    title: '大力士',
    subtitle: '战斗中最大生命值+30%',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero10.png',
  },
}

function getItemDefByCn(nameCn: string): ItemDef | null {
  return getAllItems().find((it) => it.name_cn === nameCn) ?? null
}

function pickGuideOtherArchetypeResultItem(pick: StarterClass): ItemDef | null {
  const targetTagByPick: Partial<Record<StarterClass, string>> = {
    swordsman: '弓手',
    archer: '刺客',
    assassin: '战士',
  }
  const preferredByPick: Partial<Record<StarterClass, string[]>> = {
    swordsman: ['木弓'],
    archer: ['匕首', '刺客匕首'],
    assassin: ['短剑'],
  }

  for (const nameCn of (preferredByPick[pick] ?? [])) {
    const hit = getItemDefByCn(nameCn)
    if (hit && parseTierName(hit.starting_tier) === 'Bronze') return hit
  }
  const targetTag = targetTagByPick[pick] ?? '战士'
  return getAllItems().find((it) => `${it.tags ?? ''}`.includes(targetTag) && parseTierName(it.starting_tier) === 'Bronze')
    ?? getAllItems().find((it) => `${it.tags ?? ''}`.includes(targetTag))
    ?? null
}

function pickGuideSameArchetypeResultItem(pick: StarterClass, sourceItem: ItemDef): ItemDef | null {
  void pick
  return sourceItem
}

function grantStarterItemsByClass(pick: StarterClass): void {
  if (!battleSystem || !battleView || !backpackSystem || !backpackView) return
  const preset = STARTER_CLASS_PRESETS[pick]
  if (!preset) return

  const grantAllByClass = getDebugCfg('gameplayGrantAllClassItems') >= 0.5
  const classTag = pick === 'swordsman' ? '战士' : pick === 'archer' ? '弓手' : '刺客'
  const grantList: Array<{ item: ItemDef; tier: TierKey; star: 1 | 2 }> = grantAllByClass
    ? getAllItems()
      .filter((it) => String(it.tags || '').includes(classTag))
      .map((it) => ({
        item: it,
        tier: parseTierName(it.starting_tier) ?? 'Bronze',
        star: 1,
      }))
    : preset.gifts
      .map((nameCn) => getItemDefByCn(nameCn))
      .filter((it): it is ItemDef => !!it)
      .map((it) => ({ item: it, tier: 'Bronze' as TierKey, star: 1 as const }))

  for (const grant of grantList) {
    const item = grant.item
    if (!item) continue
    const size = normalizeSize(item.size)
    const battleSlot = findFirstBattlePlace(size)
    const backpackSlot = battleSlot ? null : findFirstBackpackPlace(size)
    if (!battleSlot && !backpackSlot) continue

    const id = nextId()
    const visualTier = toVisualTier(grant.tier, grant.star)
    if (battleSlot) {
      battleSystem.place(battleSlot.col, battleSlot.row, size, item.id, id)
      void battleView.addItem(id, item.id, size, battleSlot.col, battleSlot.row, visualTier).then(() => {
        battleView!.setItemTier(id, visualTier)
        drag?.refreshZone(battleView!)
      })
    } else if (backpackSlot) {
      backpackSystem.place(backpackSlot.col, backpackSlot.row, size, item.id, id)
      void backpackView.addItem(id, item.id, size, backpackSlot.col, backpackSlot.row, visualTier).then(() => {
        backpackView!.setItemTier(id, visualTier)
        drag?.refreshZone(backpackView!)
      })
    }

    instanceToDefId.set(id, item.id)
    setInstanceQualityLevel(id, item.id, parseTierName(item.starting_tier) ?? 'Bronze', levelFromLegacyTierStar(grant.tier, grant.star))
    instanceToPermanentDamageBonus.set(id, 0)
    recordNeutralItemObtained(item.id)
    unlockedItemIds.add(item.id)
  }
  syncUnlockPoolToManager()
}

function getGuideArchetypeBadge(item: ItemDef): { text: string; color: number } {
  const tags = `${item.tags ?? ''}`
  if (tags.includes('战')) return { text: '战', color: 0xc74444 }
  if (tags.includes('弓')) return { text: '弓', color: 0x4d9e52 }
  if (tags.includes('刺')) return { text: '刺', color: 0x3f73bf }
  return { text: '通', color: 0x7b6ad2 }
}

function createGuideItemCard(item: ItemDef, levelText: string, tierForFrame: 'Bronze' | 'Silver' | 'Gold' | 'Diamond' = 'Bronze'): Container {
  const con = new Container()
  const scale = 0.72
  const cardW = CELL_SIZE
  const cardH = CELL_HEIGHT
  const cornerRadius = Math.max(0, Math.round(getDebugCfg('gridItemCornerRadius')))
  const guideStrokePx = 8
  const borderW = Math.max(2, Math.round(guideStrokePx / scale))
  const frameInset = Math.max(3, 2 + Math.ceil(borderW / 2))
  const frameW = Math.max(1, cardW - frameInset * 2)
  const frameH = Math.max(1, cardH - frameInset * 2)
  const frameRadius = Math.max(0, cornerRadius - (frameInset - 3))
  const spriteInset = frameInset + Math.max(2, Math.ceil(borderW / 2))

  const levelNum = Math.max(1, Math.round(Number(levelText) || 1))
  const tierColor = getTierColor(tierForFrame)

  const frame = new Graphics()
  frame.roundRect(frameInset, frameInset, frameW, frameH, frameRadius)
  frame.fill({ color: 0x000000, alpha: 0.001 })
  frame.stroke({ color: tierColor, width: borderW, alpha: 0.98 })
  con.addChild(frame)

  const icon = new Sprite(Texture.WHITE)
  const baseCellInner = Math.max(1, CELL_SIZE - spriteInset * 2)
  const spriteSide = Math.max(1, Math.min(frameW, baseCellInner))
  icon.width = spriteSide
  icon.height = spriteSide
  icon.x = frameInset + (frameW - spriteSide) / 2
  icon.y = frameInset + (frameH - spriteSide) / 2
  icon.alpha = 0
  con.addChild(icon)
  const url = getItemIconUrl(item.id)
  void Assets.load<Texture>(url).then((tex) => {
    const sw = Math.max(1, tex.width)
    const sh = Math.max(1, tex.height)
    const side = spriteSide
    const scale = Math.min(side / sw, side / sh)
    icon.texture = tex
    icon.width = Math.max(1, Math.round(sw * scale))
    icon.height = Math.max(1, Math.round(sh * scale))
    icon.x = frameInset + (frameW - icon.width) / 2
    icon.y = frameInset + (frameH - icon.height) / 2
    icon.alpha = 1
  }).catch(() => {
    // ignore missing icon in runtime
  })

  const archetype = getGuideArchetypeBadge(item)
  const badges = createItemStatBadges(
    item,
    getDebugCfg('itemStatBadgeFontSize'),
    Math.max(44, cardW - 8),
    undefined,
    'archetype',
    { archetypeSuffix: String(Math.min(7, Math.max(1, levelNum))) },
  )
  badges.x = cardW / 2
  badges.y = getDebugCfg('itemStatBadgeOffsetY') + 14
  // 兜底：若被配置隐藏，则强制给出一枚同风格角标
  if (badges.children.length === 0) {
    const fallback = new Graphics()
    fallback.roundRect(4, 4, 48, 34, 8)
    fallback.fill({ color: archetype.color, alpha: 0.95 })
    fallback.stroke({ color: 0x000000, width: 2, alpha: 0.88 })
    con.addChild(fallback)
    const t = new Text({ text: `${archetype.text}${levelNum}`, style: { fontSize: 24, fill: 0xffffff, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 2 } } })
    t.anchor.set(0.5)
    t.x = 28
    t.y = 22
    con.addChild(t)
  } else {
    con.addChild(badges)
  }

  con.scale.set(scale)

  return con
}

function getGuideFrameTierByLevel(levelText: string): 'Bronze' | 'Silver' | 'Gold' | 'Diamond' {
  const levelNum = Math.max(1, Math.round(Number(levelText) || 1))
  if (levelNum >= 7) return 'Diamond'
  if (levelNum >= 5) return 'Gold'
  if (levelNum >= 3) return 'Silver'
  return 'Bronze'
}

function showStarterSynthesisGuide(stage: Container, pick: StarterClass): void {
  if (starterGuideOverlay) return
  const preset = STARTER_CLASS_PRESETS[pick]
  if (!preset) return
  const itemA = getItemDefByCn(preset.gifts[0])
  const itemB = getItemDefByCn(preset.gifts[1])
  const sameArchetypeResultItem = itemA ? pickGuideSameArchetypeResultItem(pick, itemA) : null
  const otherArchetypeResultItem = pickGuideOtherArchetypeResultItem(pick)
  if (!itemA || !itemB || !sameArchetypeResultItem || !otherArchetypeResultItem) return

  starterBattleGuideShown = true
  saveShopStateToStorage(captureShopState())

  const overlay = new Container()
  overlay.zIndex = 3200
  overlay.eventMode = 'static'
  overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

  const mask = new Graphics()
  mask.rect(0, 0, CANVAS_W, CANVAS_H)
  mask.fill({ color: 0x090d18, alpha: 0.84 })
  overlay.addChild(mask)

  const panel = new Container()
  panel.x = CANVAS_W / 2
  panel.y = CANVAS_H / 2
  panel.eventMode = 'static'
  panel.on('pointerdown', (e) => e.stopPropagation())
  overlay.addChild(panel)

  const panelW = 586
  const panelH = 860
  const panelBg = new Graphics()
  panelBg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 24)
  panelBg.fill({ color: 0x171b2c, alpha: 0.97 })
  panelBg.stroke({ color: 0x7ea7ff, width: 3, alpha: 1 })
  panel.addChild(panelBg)

  const title = new Text({
    text: '合成规则',
    style: { fontSize: 52, fill: 0xffefc8, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  title.anchor.set(0.5)
  title.y = -354
  panel.addChild(title)

  const verticalDivider = new Graphics()
  verticalDivider.moveTo(0, -304)
  verticalDivider.lineTo(0, 260)
  verticalDivider.stroke({ color: 0x5b6790, width: 2, alpha: 0.95 })
  panel.addChild(verticalDivider)

  const createGuideColumn = (
    centerX: number,
    label: string,
    leftDef: ItemDef,
    leftLv: string,
    rightDef: ItemDef,
    rightLv: string,
    resultDef: ItemDef,
    resultLv: string,
  ): Container => {
    const col = new Container()
    col.x = centerX

    const line = new Text({
      text: label,
      style: { fontSize: 28, fill: 0xdce8ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    line.anchor.set(0.5)
    line.y = -266
    col.addChild(line)

    const topRow = new Container()
    topRow.y = -176
    const a = createGuideItemCard(leftDef, leftLv, 'Bronze')
    a.x = -114
    topRow.addChild(a)
    const plus = new Text({ text: '+', style: { fontSize: 50, fill: 0x8ec6ff, fontFamily: 'Arial', fontWeight: 'bold' } })
    plus.anchor.set(0.5)
    plus.x = 0
    plus.y = 42
    topRow.addChild(plus)
    const b = createGuideItemCard(rightDef, rightLv, 'Bronze')
    b.x = 22
    topRow.addChild(b)
    col.addChild(topRow)

    const downArrow = new Text({ text: '↓', style: { fontSize: 60, fill: 0x8ec6ff, fontFamily: 'Arial', fontWeight: 'bold' } })
    downArrow.anchor.set(0.5)
    downArrow.y = -12
    col.addChild(downArrow)

    const resultRow = new Container()
    resultRow.y = 66
    const result = createGuideItemCard(resultDef, resultLv, getGuideFrameTierByLevel(resultLv))
    result.x = -46
    resultRow.addChild(result)
    col.addChild(resultRow)

    return col
  }

  panel.addChild(createGuideColumn(-145, '相同物品 → 升级', itemA, '1', itemA, '1', sameArchetypeResultItem, '2'))
  panel.addChild(createGuideColumn(145, '相同职业 → 其他职业', itemA, '1', itemB, '1', otherArchetypeResultItem, '2'))

  const closeBtn = new Container()
  closeBtn.eventMode = 'static'
  closeBtn.cursor = 'pointer'
  closeBtn.y = 352
  const closeBg = new Graphics()
  closeBg.roundRect(-158, -40, 316, 80, 18)
  closeBg.fill({ color: 0x315a94, alpha: 0.95 })
  closeBg.stroke({ color: 0x89c3ff, width: 3, alpha: 1 })
  closeBtn.addChild(closeBg)
  const closeTxt = new Text({
    text: '我知道了',
    style: { fontSize: 34, fill: 0xeaf4ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  closeTxt.anchor.set(0.5)
  closeBtn.addChild(closeTxt)
  closeBtn.on('pointerdown', (e) => {
    e.stopPropagation()
    if (starterGuideOverlay?.parent) starterGuideOverlay.parent.removeChild(starterGuideOverlay)
    starterGuideOverlay?.destroy({ children: true })
    starterGuideOverlay = null
    ensureDailyChoiceSelection(stage)
  })
  panel.addChild(closeBtn)

  starterGuideOverlay = overlay
  stage.addChild(overlay)
}

void grantStarterItemsByClass
void showStarterSynthesisGuide

function ensureStarterClassSelection(stage: Container): void {
  if (starterGranted) return
  if (classSelectOverlay) return
  if (!shopManager) return

  setTransitionInputEnabled(false)

  const overlay = new Container()
  overlay.zIndex = 3000
  overlay.eventMode = 'static'
  overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

  const bg = new Graphics()
  bg.rect(0, 0, CANVAS_W, CANVAS_H)
  bg.fill({ color: 0x0a1020, alpha: 0.94 })
  overlay.addChild(bg)

  const title = new Text({
    text: '选择你的初始英雄',
    style: { fontSize: 42, fill: 0xfff2cf, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  title.anchor.set(0.5)
  title.x = CANVAS_W / 2
  title.y = 150
  overlay.addChild(title)

  const subtitle = new Text({
    text: '仅影响头像展示，不附带初始物品',
    style: { fontSize: 24, fill: 0xb9c8e8, fontFamily: 'Arial' },
  })
  subtitle.anchor.set(0.5)
  subtitle.x = CANVAS_W / 2
  subtitle.y = 202
  overlay.addChild(subtitle)

  const cards: Array<{ key: StarterClass; border: Graphics; pick: Text }> = []
  const showAllHeroes = getDebugCfg('gameplayStarterHeroShowAll') >= 0.5
  if (!showAllHeroes && (starterHeroChoiceOptions.length !== 3 || starterHeroChoiceOptions.some((id) => !HERO_STARTER_POOL.includes(id)))) {
    const pool = HERO_STARTER_POOL.slice()
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const t = pool[i]
      pool[i] = pool[j]!
      pool[j] = t!
    }
    starterHeroChoiceOptions = pool.slice(0, 3)
  }
  const order: StarterClass[] = showAllHeroes ? HERO_STARTER_POOL : starterHeroChoiceOptions
  const compact = order.length > 3
  const cols = compact ? 5 : 3
  const cardW = compact ? 114 : 190
  const cardH = compact ? 250 : 504
  const gapX = compact ? 10 : 16
  const gapY = compact ? 12 : 0
  const cardX = (CANVAS_W - (cardW * cols + gapX * (cols - 1))) / 2
  const startY = compact ? 340 : 460
  let selected: StarterClass | null = starterClass

  const confirmSelection = () => {
    if (!selected) return
    starterClass = selected
    starterGranted = true
    starterBattleGuideShown = false
    if (selected === 'hero9') {
      setLifeState(40, 40)
    }
    seedInitialUnlockPoolByStarterClass(selected)
    grantHeroStartDayEffectsIfNeeded()
    saveShopStateToStorage(captureShopState())
    if (classSelectOverlay?.parent) classSelectOverlay.parent.removeChild(classSelectOverlay)
    classSelectOverlay?.destroy({ children: true })
    classSelectOverlay = null
    setTransitionInputEnabled(true)
    applyPhaseInputLock()
    refreshShopUI()
    ensureDailyChoiceSelection(stage)
  }

  const redrawCards = () => {
    for (const c of cards) {
      const active = c.key === selected
      c.border.clear()
      c.border.roundRect(0, 0, cardW, cardH, 24)
      c.border.stroke({ color: active ? 0x5fd3ff : 0x6d7791, width: active ? 4 : 2, alpha: 1 })
      c.border.fill({ color: active ? 0x132a46 : 0x1b2438, alpha: active ? 0.95 : 0.85 })
      c.pick.visible = active
    }
  }

  for (let i = 0; i < order.length; i++) {
    const key = order[i]!
    const preset = STARTER_CLASS_PRESETS[key]
    const con = new Container()
    const col = i % cols
    const row = Math.floor(i / cols)
    con.x = cardX + col * (cardW + gapX)
    con.y = startY + row * (cardH + gapY)
    con.eventMode = 'static'
    con.cursor = 'pointer'
    con.hitArea = new Rectangle(0, 0, cardW, cardH)

    const border = new Graphics()
    con.addChild(border)

    const t = new Text({
      text: preset.title,
      style: { fontSize: compact ? 20 : 36, fill: 0xfff2cf, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    t.x = compact ? 12 : 32
    t.y = compact ? 10 : 24
    con.addChild(t)

    const d = new Text({
      text: preset.subtitle,
      style: {
        fontSize: compact ? 14 : 22,
        fill: 0xc7d5f2,
        fontFamily: 'Arial',
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: compact ? (cardW - 14) : (cardW - 30),
        lineHeight: compact ? 18 : 30,
      },
    })
    d.x = compact ? 7 : 18
    d.y = compact ? 182 : 352
    con.addChild(d)

    const pick = new Text({
      text: '点击选择',
      style: { fontSize: compact ? 16 : 28, fill: 0x8fe6b2, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    pick.anchor.set(0.5)
    pick.x = cardW / 2
    pick.y = cardH - (compact ? 52 : 64)
    pick.visible = false
    con.addChild(pick)

    const hero = new Sprite(Texture.WHITE)
    const heroMaxW = compact ? 96 : 154
    const heroMaxH = compact ? 120 : 230
    hero.visible = false
    hero.x = (cardW - heroMaxW) / 2
    hero.y = compact ? 56 : 102
    void Assets.load<Texture>(preset.heroImage).then((tex) => {
      hero.texture = tex
      const sw = Math.max(1, tex.width)
      const sh = Math.max(1, tex.height)
      const scale = Math.min(heroMaxW / sw, heroMaxH / sh)
      hero.width = Math.max(1, Math.round(sw * scale))
      hero.height = Math.max(1, Math.round(sh * scale))
      hero.x = (cardW - hero.width) / 2
      hero.y = (compact ? 56 : 102) + (heroMaxH - hero.height) / 2
      hero.visible = true
    }).catch(() => {
      // ignore missing asset in runtime
    })
    con.addChild(hero)

    con.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      if (selected !== key) {
        selected = key
        redrawCards()
        return
      }
      confirmSelection()
    })

    overlay.addChild(con)
    cards.push({ key, border, pick })
  }

  redrawCards()

  classSelectOverlay = overlay
  stage.addChild(overlay)
}

function skillTierLabelCn(tier: SkillTier): string {
  if (tier === 'bronze') return '青铜'
  if (tier === 'silver') return '白银'
  return '黄金'
}

function skillTierColor(tier: SkillTier): number {
  if (tier === 'bronze') return 0xbe8b46
  if (tier === 'silver') return 0x9aafc8
  return 0xd0ac43
}

function mountSkillIconSprite(
  parent: Container,
  skillId: string,
  iconStem: string | undefined,
  centerX: number,
  centerY: number,
  iconSize: number,
  fallback: Text,
): void {
  const stemRaw = iconStem
    ?? getBronzeSkillById(skillId)?.icon
    ?? getSilverSkillById(skillId)?.icon
    ?? getGoldSkillById(skillId)?.icon
    ?? (/^skill\d+$/.test(skillId) ? skillId : undefined)
  const stem = stemRaw ? stemRaw.replace(/\.png$/i, '').trim() : ''
  if (!stem) return
  const iconUrl = getSkillIconUrl(stem)
  const sprite = new Sprite(Texture.WHITE)
  sprite.anchor.set(0.5)
  sprite.x = centerX
  sprite.y = centerY
  sprite.alpha = 0
  parent.addChild(sprite)

  void Assets.load<Texture>(iconUrl).then((tex) => {
    const side = Math.round(iconSize * 0.78)
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

function mountEventIconSprite(
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

function getEventArchetypeCn(arch: EventArchetype): string {
  if (arch === 'warrior') return '战士'
  if (arch === 'archer') return '弓手'
  return '刺客'
}

type OwnedPlacedItem = { item: PlacedItem; zone: 'battle' | 'backpack' }

function getAllOwnedPlacedItems(): OwnedPlacedItem[] {
  const out: OwnedPlacedItem[] = []
  if (battleSystem) {
    for (const it of battleSystem.getAllItems()) out.push({ item: it, zone: 'battle' })
  }
  if (backpackSystem) {
    for (const it of backpackSystem.getAllItems()) out.push({ item: it, zone: 'backpack' })
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

function removePlacedItemById(instanceId: string, zone: 'battle' | 'backpack'): void {
  const system = zone === 'battle' ? battleSystem : backpackSystem
  const view = zone === 'battle' ? battleView : backpackView
  if (!system || !view) return
  system.remove(instanceId)
  view.removeItem(instanceId)
  removeInstanceMeta(instanceId)
}

function placeItemToInventoryOrBattle(def: ItemDef, tier: TierKey, star: 1 | 2): boolean {
  if (!battleSystem || !battleView || !backpackSystem || !backpackView) return false
  const size = normalizeSize(def.size)
  const battleSlot = findFirstBattlePlace(size)
  const backpackSlot = battleSlot ? null : findFirstBackpackPlace(size)
  if (!battleSlot && !backpackSlot) return false

  const id = nextId()
  const visualTier = toVisualTier(tier, star)
  if (battleSlot) {
    battleSystem.place(battleSlot.col, battleSlot.row, size, def.id, id)
    void battleView.addItem(id, def.id, size, battleSlot.col, battleSlot.row, visualTier).then(() => {
      battleView!.setItemTier(id, visualTier)
      drag?.refreshZone(battleView!)
    })
  } else if (backpackSlot) {
    backpackSystem.place(backpackSlot.col, backpackSlot.row, size, def.id, id)
    void backpackView.addItem(id, def.id, size, backpackSlot.col, backpackSlot.row, visualTier).then(() => {
      backpackView!.setItemTier(id, visualTier)
      drag?.refreshZone(backpackView!)
    })
  }
  instanceToDefId.set(id, def.id)
  setInstanceQualityLevel(id, def.id, parseTierName(def.starting_tier) ?? 'Bronze', levelFromLegacyTierStar(tier, star))
  instanceToPermanentDamageBonus.set(id, 0)
  recordNeutralItemObtained(def.id)
  unlockItemToPool(def.id)
  return true
}

function upgradePlacedItem(instanceId: string, zone: 'battle' | 'backpack', withFx = false): boolean {
  const system = zone === 'battle' ? battleSystem : backpackSystem
  const view = zone === 'battle' ? battleView : backpackView
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
    drag?.refreshZone(view)
  })
  setInstanceQualityLevel(instanceId, defId, quality, nextLevel)
  if (withFx) playTransformOrUpgradeFlashEffect(instanceId, zone)
  return true
}

function convertAndUpgradePlacedItem(instanceId: string, zone: 'battle' | 'backpack', withFx = false): boolean {
  const system = zone === 'battle' ? battleSystem : backpackSystem
  const view = zone === 'battle' ? battleView : backpackView
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
    drag?.refreshZone(view)
  })
  instanceToDefId.set(instanceId, picked.id)
  setInstanceQualityLevel(instanceId, picked.id, parseTierName(picked.starting_tier) ?? 'Bronze', nextLevel)
  unlockItemToPool(picked.id)
  if (withFx) playTransformOrUpgradeFlashEffect(instanceId, zone)
  return true
}

function canUpgradePlacedItem(instanceId: string, zone: 'battle' | 'backpack'): boolean {
  const system = zone === 'battle' ? battleSystem : backpackSystem
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

function canConvertAndUpgradePlacedItem(instanceId: string, zone: 'battle' | 'backpack'): boolean {
  const system = zone === 'battle' ? battleSystem : backpackSystem
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

function schedulePendingGold(day: number, amount: number): void {
  const d = Math.max(1, Math.round(day))
  const a = Math.max(0, Math.round(amount))
  if (d <= 0 || a <= 0) return
  pendingGoldByDay.set(d, (pendingGoldByDay.get(d) ?? 0) + a)
}

function schedulePendingBattleUpgrade(day: number, count: number): void {
  const d = Math.max(1, Math.round(day))
  const c = Math.max(0, Math.round(count))
  if (d <= 0 || c <= 0) return
  pendingBattleUpgradeByDay.set(d, (pendingBattleUpgradeByDay.get(d) ?? 0) + c)
}

function convertPlacedItemKeepLevel(instanceId: string, zone: 'battle' | 'backpack', withFx = false): boolean {
  const system = zone === 'battle' ? battleSystem : backpackSystem
  const view = zone === 'battle' ? battleView : backpackView
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
    drag?.refreshZone(view)
  })
  instanceToDefId.set(instanceId, picked.id)
  setInstanceQualityLevel(instanceId, picked.id, parseTierName(picked.starting_tier) ?? 'Bronze', level)
  unlockItemToPool(picked.id)
  if (withFx) playTransformOrUpgradeFlashEffect(instanceId, zone)
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

type NeutralSpecialKind =
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

type NeutralChoiceCandidate = {
  item: ItemDef
  tier: TierKey
  star: 1 | 2
}

function getNeutralSpecialKind(item: ItemDef): NeutralSpecialKind | null {
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

const NEUTRAL_RANDOM_CAP_BY_DAY: Record<NeutralSpecialKind, number[]> = {
  upgrade_stone: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  class_shift_stone: [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10],
  class_morph_stone: [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10],
  warrior_stone: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  archer_stone: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  assassin_stone: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  gold_morph_stone: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  diamond_morph_stone: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  skill_scroll: [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  shop_scroll: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  event_scroll: [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10],
  raw_stone: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  medal: [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10],
  blank_scroll: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  silver_chest: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  golden_chest: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  diamond_chest: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
}

const NEUTRAL_DAILY_ROLL_CAP_BY_DAY: number[] = [
  0, 2, 3, 3, 4, 4, 5, 5, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
]

type NeutralRandomCategory = 'stone' | 'scroll' | 'medal'
const NEUTRAL_RANDOM_RATIO_BUCKET_TEMPLATE: NeutralRandomCategory[] = ['stone', 'stone', 'scroll', 'scroll', 'medal']

function refillNeutralRandomCategoryPool(): void {
  neutralRandomCategoryPool = [...NEUTRAL_RANDOM_RATIO_BUCKET_TEMPLATE]
  for (let i = neutralRandomCategoryPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = neutralRandomCategoryPool[i]
    neutralRandomCategoryPool[i] = neutralRandomCategoryPool[j]!
    neutralRandomCategoryPool[j] = tmp!
  }
}

function pickNeutralRandomCategoryByPool(candidates: PoolCandidate[]): NeutralRandomCategory {
  if (neutralRandomCategoryPool.length <= 0) refillNeutralRandomCategoryPool()
  const available = new Set(
    candidates
      .map((one) => neutralRandomCategoryOfItem(one.item))
      .filter((v): v is NeutralRandomCategory => v === 'stone' || v === 'scroll' || v === 'medal'),
  )
  for (let i = 0; i < neutralRandomCategoryPool.length; i++) {
    const one = neutralRandomCategoryPool[i]!
    if (!available.has(one)) continue
    neutralRandomCategoryPool.splice(i, 1)
    return one
  }
  const fallback = candidates
    .map((one) => neutralRandomCategoryOfItem(one.item))
    .find((v): v is NeutralRandomCategory => v === 'stone' || v === 'scroll' || v === 'medal')
  if (fallback) return fallback
  return 'stone'
}

function neutralRandomCategoryOfKind(kind: NeutralSpecialKind): NeutralRandomCategory | null {
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

function neutralRandomCategoryOfItem(item: ItemDef): NeutralRandomCategory | null {
  const kind = getNeutralSpecialKind(item)
  if (!kind) return null
  return neutralRandomCategoryOfKind(kind)
}

function getNeutralRandomMinDay(kind: NeutralSpecialKind): number {
  const shopRulesCfg = (getConfig().shopRules ?? {}) as { quickBuyNeutralStartDay?: number }
  const defaultDay = Math.max(1, Math.round(Number(shopRulesCfg.quickBuyNeutralStartDay ?? 2) || 2))
  if (kind === 'raw_stone') return Math.max(defaultDay, 5)
  if (kind === 'blank_scroll') return Math.max(defaultDay, 5)
  return defaultDay
}

function getNeutralDailyRollCap(day: number): number {
  const d = Math.max(1, Math.min(20, Math.round(day)))
  return Math.max(0, Math.round(NEUTRAL_DAILY_ROLL_CAP_BY_DAY[d - 1] ?? NEUTRAL_DAILY_ROLL_CAP_BY_DAY[NEUTRAL_DAILY_ROLL_CAP_BY_DAY.length - 1] ?? 0))
}

function getNeutralRandomCapByDay(day: number, kind: NeutralSpecialKind): number {
  const row = NEUTRAL_RANDOM_CAP_BY_DAY[kind]
  const d = Math.max(1, Math.min(20, Math.round(day)))
  return Math.max(0, Math.round(row[d - 1] ?? row[row.length - 1] ?? 0))
}

function getNeutralObtainedCount(kind: NeutralSpecialKind): number {
  return Math.max(0, Math.round(neutralObtainedCountByKind.get(kind) ?? 0))
}

function isNeutralKindOwnCapAvailable(kind: NeutralSpecialKind): boolean {
  return getNeutralObtainedCount(kind) < getNeutralRandomCapByDay(currentDay, kind)
}

function isNeutralKindRandomAvailable(kind: NeutralSpecialKind): boolean {
  if (currentDay < getNeutralRandomMinDay(kind)) return false
  if (!isNeutralKindOwnCapAvailable(kind)) return false
  if (kind === 'blank_scroll') {
    const hasAnyScrollAvailable = isNeutralKindOwnCapAvailable('skill_scroll')
      || isNeutralKindOwnCapAvailable('shop_scroll')
      || isNeutralKindOwnCapAvailable('event_scroll')
    if (!hasAnyScrollAvailable) return false
  }
  if (kind === 'raw_stone') {
    const hasAnyStoneAvailable = isNeutralKindOwnCapAvailable('upgrade_stone')
      || isNeutralKindOwnCapAvailable('class_shift_stone')
      || isNeutralKindOwnCapAvailable('class_morph_stone')
    if (!hasAnyStoneAvailable) return false
  }
  return true
}

// ============================================================
// 升级奖励：固定等级表发奖
// ============================================================

type LevelRewardStoneWeights = {
  classStone: number
  randomStone: number
  goldStone: number
  diamondStone: number
}

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
  2, 2, 2, 2,
  3, 3, 3, 3, 3, 3,
  3, 3, 3, 3, 3, 3, 3, 3,
]

function getLevelRewardStoneWeights(level: number): LevelRewardStoneWeights {
  if (level <= 6) return { classStone: 0.75, randomStone: 0.25, goldStone: 0, diamondStone: 0 }
  if (level <= 10) return { classStone: 0.6, randomStone: 0.2, goldStone: 0.2, diamondStone: 0 }
  if (level <= 14) return { classStone: 0.6, randomStone: 0.1, goldStone: 0.2, diamondStone: 0.1 }
  if (level <= 18) return { classStone: 0.6, randomStone: 0.1, goldStone: 0.1, diamondStone: 0.2 }
  return { classStone: 0.6, randomStone: 0, goldStone: 0, diamondStone: 0.4 }
}

function rollRandomTransformStoneDefId(weights: LevelRewardStoneWeights): string | null {
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

function rollLevelRewardDefIds(level: number): string[] {
  const lv = Math.max(1, Math.min(26, Math.round(level)))
  const out: string[] = []

  const baseDefId = FIXED_LEVEL_REWARD_BASE_ITEM_IDS_BY_LEVEL[lv - 1]
  if (baseDefId && getItemDefById(baseDefId)) out.push(baseDefId)

  const randomStoneCount = Math.max(0, Math.round(FIXED_LEVEL_REWARD_RANDOM_STONE_COUNT_BY_LEVEL[lv - 1] ?? 0))
  if (randomStoneCount <= 0) return out

  const weights = getLevelRewardStoneWeights(lv)
  for (let i = 0; i < randomStoneCount; i++) {
    const one = rollRandomTransformStoneDefId(weights)
    if (one) out.push(one)
  }
  return out
}

function canRandomNeutralItem(item: ItemDef): boolean {
  if (!isNeutralItemDef(item)) return true
  const kind = getNeutralSpecialKind(item)
  if (!kind) return true
  return isNeutralKindRandomAvailable(kind)
}

function getNeutralReplacementKindForRandom(kind: NeutralSpecialKind): NeutralSpecialKind | null {
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

function rewriteNeutralRandomPick(item: ItemDef): ItemDef {
  if (!isNeutralItemDef(item)) return item
  const kind = getNeutralSpecialKind(item)
  if (!kind) return item

  if (kind === 'blank_scroll') {
    const scrollKinds: NeutralSpecialKind[] = ['skill_scroll', 'shop_scroll', 'event_scroll']
    const availableScrollKinds = scrollKinds.filter((k) => isNeutralKindRandomAvailable(k))
    if (availableScrollKinds.length === 1) {
      const only = availableScrollKinds[0]
      const onlyName = only === 'skill_scroll'
        ? '青铜卷轴'
        : only === 'shop_scroll'
          ? '购物卷轴'
          : '冒险卷轴'
      return getItemDefByCn(onlyName) ?? item
    }
  }

  const replacementKind = getNeutralReplacementKindForRandom(kind)
  if (!replacementKind) return item
  if (!isNeutralKindRandomAvailable(replacementKind)) return item
  const replacementName = replacementKind === 'blank_scroll' ? '空白卷轴' : '原石'
  return getItemDefByCn(replacementName) ?? item
}

function recordNeutralItemObtained(defId: string): void {
  const item = getItemDefById(defId)
  if (!item || !isNeutralItemDef(item)) return
  const kind = getNeutralSpecialKind(item)
  if (!kind) return
  const prev = neutralObtainedCountByKind.get(kind) ?? 0
  neutralObtainedCountByKind.set(kind, Math.max(0, Math.round(prev + 1)))
}

function isNeutralTargetStone(item: ItemDef | null | undefined): boolean {
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

function isValidNeutralStoneTarget(sourceDef: ItemDef, targetDef: ItemDef): boolean {
  if (!isNeutralTargetStone(sourceDef)) return false
  if (isNeutralItemDef(targetDef)) return false
  const sourceKind = getNeutralSpecialKind(sourceDef)
  const srcArch = toSkillArchetype(getPrimaryArchetype(targetDef.tags))
  if (srcArch !== 'warrior' && srcArch !== 'archer' && srcArch !== 'assassin') return false
  void sourceKind
  return true
}

function collectNeutralStoneGuideIds(
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

function refreshNeutralStoneGuideArrows(sourceDef: ItemDef | null | undefined, excludeInstanceId?: string): void {
  if (!backpackView || !battleView) return
  if (!sourceDef || !isNeutralTargetStone(sourceDef)) {
    clearBackpackSynthesisGuideArrows()
    return
  }
  const backpackIds = collectNeutralStoneGuideIds(backpackSystem, sourceDef, excludeInstanceId)
  const battleIds = collectNeutralStoneGuideIds(battleSystem, sourceDef, excludeInstanceId)
  backpackView.setDragGuideArrows([], backpackIds, 'convert')
  battleView.setDragGuideArrows([], battleIds, 'convert')
}

function findNeutralStoneTargetWithDragProbe(
  sourceDef: ItemDef,
  gx: number,
  gy: number,
  dragSize?: ItemSizeNorm,
): SynthesisTarget | null {
  const matchAtPointer = (
    system: GridSystem | null,
    view: GridZone | null,
    zone: 'battle' | 'backpack',
    probeY: number,
  ): SynthesisTarget | null => {
    if (!system || !view || (zone === 'backpack' && !view.visible)) return null
    for (const it of system.getAllItems()) {
      const targetDef = getItemDefById(it.defId)
      if (!targetDef) continue
      if (!isValidNeutralStoneTarget(sourceDef, targetDef)) continue
      if (isPointInItemBounds(view, it, gx, probeY)) return { instanceId: it.instanceId, zone }
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
    const { w, h } = getSizeCellDim(dragSize)
    const cell = view.pixelToCellForItem(gx, probeY, dragSize, 0)
    if (!cell) return null
    const l = cell.col
    const r = cell.col + w
    const t = cell.row
    const b = cell.row + h
    for (const it of system.getAllItems()) {
      const targetDef = getItemDefById(it.defId)
      if (!targetDef) continue
      if (!isValidNeutralStoneTarget(sourceDef, targetDef)) continue
      const d = getSizeCellDim(it.size)
      const il = it.col
      const ir = it.col + d.w
      const itop = it.row
      const ib = it.row + d.h
      if (l < ir && r > il && t < ib && b > itop) return { instanceId: it.instanceId, zone }
    }
    return null
  }

  const direct =
    matchAtPointer(battleSystem, battleView, 'battle', gy)
    ?? matchAtPointer(backpackSystem, backpackView, 'backpack', gy)
    ?? matchByFootprint(battleSystem, battleView, 'battle', gy)
    ?? matchByFootprint(backpackSystem, backpackView, 'backpack', gy)
  if (direct) return direct
  const probeY = gy + (dragSize ? getDebugCfg('dragYOffset') : 0)
  if (probeY === gy) return null
  return (
    matchAtPointer(battleSystem, battleView, 'battle', probeY)
    ?? matchAtPointer(backpackSystem, backpackView, 'backpack', probeY)
    ?? matchByFootprint(battleSystem, battleView, 'battle', probeY)
    ?? matchByFootprint(backpackSystem, backpackView, 'backpack', probeY)
  )
}

function showNeutralStoneHoverInfo(sourceDef: ItemDef, target: SynthesisTarget): void {
  if (!sellPopup || !shopManager) return
  const system = target.zone === 'battle' ? battleSystem : backpackSystem
  const targetItem = system?.getItem(target.instanceId)
  if (!targetItem) return
  const targetDef = getItemDefById(targetItem.defId)
  if (!targetDef) return
  const kind = getNeutralSpecialKind(sourceDef)
  if (kind !== 'class_shift_stone' && kind !== 'class_morph_stone') return
  const desc = kind === 'class_shift_stone'
    ? `拖到目标：将${targetDef.name_cn}转化为其他职业同等级物品`
    : `拖到目标：将${targetDef.name_cn}转化为本职业其他同等级物品`
  const customDisplay: ItemInfoCustomDisplay = {
    overrideName: `${sourceDef.name_cn}（作用于目标）`,
    lines: [desc],
    suppressStats: true,
  }
  sellPopup.show(sourceDef, 0, 'none', 'Bronze#1', undefined, 'detailed', undefined, customDisplay)
}

function pickCandidateItemsByNames(names: string[]): ItemDef[] {
  const all = getAllItems()
  const out: ItemDef[] = []
  for (const name of names) {
    const hit = all.find((it) => it.name_cn === name)
    if (hit) out.push(hit)
  }
  return out
}

function showMedalArchetypeChoiceOverlay(stage: Container): boolean {
  const choices: Array<{ archetype: EventArchetype; title: string; cardLabel: string; icon: string }> = [
    { archetype: 'warrior', title: '战士', cardLabel: '战士物品', icon: 'event4' },
    { archetype: 'archer', title: '弓手', cardLabel: '弓手物品', icon: 'event5' },
    { archetype: 'assassin', title: '刺客', cardLabel: '刺客物品', icon: 'event6' },
  ]

  setTransitionInputEnabled(false)
  setBaseShopPrimaryButtonsVisible(false)

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
    setTransitionInputEnabled(true)
    applyPhaseInputLock()
    refreshShopUI()
    saveShopStateToStorage(captureShopState())
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
    mountEventIconSprite(card, choice.icon, choice.icon, cardW / 2, 116, 156, iconFallback)

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
      const roll = pickMedalArchetypeItem(choice.archetype)
      if (!roll) {
        const baseMax = getMaxQuickBuyLevelForDay(currentDay)
        const targetLevel = Math.min(7, baseMax + 2)
        showHintToast('no_gold_buy', `勋章：该职业无Lv${targetLevel}可用物品`, 0xffb27a)
        closeOverlay()
        return
      }
      const ok = placeItemToInventoryOrBattle(roll.item, roll.tier, roll.star)
      if (!ok) showHintToast('backpack_full_buy', '上阵区和背包已满，无法获得该物品', 0xff8f8f)
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
    setBaseShopPrimaryButtonsVisible(false)
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

function getNeutralChoiceSimpleDesc(item: ItemDef): string {
  const normalize = (raw: string): string => raw.trim().replace(/[。！!；;，,\s]+$/g, '')
  const simple = String(item.simple_desc || '').trim()
  if (simple) return normalize(simple)
  const line = (item.skills ?? []).map((s) => String(s.cn || '').trim()).find((v) => v.length > 0)
  return line ? normalize(line) : '点击查看详细效果'
}

function getNeutralChoiceDetailDesc(item: ItemDef): string {
  const normalize = (raw: string): string => raw.trim().replace(/[。！!；;，,\s]+$/g, '')
  const detailByConfig = String(item.simple_desc_tiered || '').trim()
  if (detailByConfig) return normalize(detailByConfig)
  const lines = (item.skills ?? [])
    .map((s) => String(s.cn || '').trim())
    .filter((v) => v.length > 0)
  if (lines.length <= 0) return getNeutralChoiceSimpleDesc(item)
  return normalize(lines[0] || '') || getNeutralChoiceSimpleDesc(item)
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
  const showSimple = shouldShowSimpleDescriptions()
  const normalizeCandidates = (list: NeutralChoiceCandidate[]) =>
    list.filter((one, idx, arr) => arr.findIndex((it) => it.item.id === one.item.id) === idx).slice(0, 3)
  const uniq = normalizeCandidates(candidates)
  if (uniq.length <= 0) return false

  setTransitionInputEnabled(false)
  setBaseShopPrimaryButtonsVisible(false)

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
    setTransitionInputEnabled(true)
    applyPhaseInputLock()
    if (withRefresh) {
      refreshShopUI()
      saveShopStateToStorage(captureShopState())
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
      addArchetypeCornerBadge(card, cand.item, cardW, icon.y)
      void Assets.load<Texture>(getItemIconUrl(cand.item.id)).then((tex) => {
        icon.texture = tex
        icon.alpha = 1
      }).catch(() => {
        // ignore load error in runtime
      })
    } else {
      const level = String(Math.max(1, Math.min(7, levelNum)))
      const icon = createGuideItemCard(cand.item, level, getGuideFrameTierByLevel(level))
      icon.x = Math.round((cardW - icon.width) / 2)
      icon.y = 108
      card.addChild(icon)
      addArchetypeCornerBadge(card, cand.item, cardW, icon.y)
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
        text: `${tierCnFromTier(baseTier)}Lv${levelNum}`,
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
      const speedText = cooldownMs > 0 ? `⏱速度${getSpecialShopSpeedTierText(cooldownMs)}` : ''

      const ammoLine = (cand.item.skills ?? [])
        .map((s) => String(s.cn ?? '').trim())
        .find((s) => /弹药\s*[:：]\s*\d+/.test(s))
      const ammo = ammoLine ? ammoValueFromLineByStar(cand.item, cand.tier, cand.star, ammoLine) : 0

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
        ? getSpecialShopShownDesc(cand.item, cand.tier, cand.star, false)
        : getNeutralChoiceSimpleDesc(cand.item),
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
        ? getSpecialShopShownDesc(cand.item, cand.tier, cand.star, true)
        : getNeutralChoiceDetailDesc(cand.item),
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
        : placeItemToInventoryOrBattle(cand.item, cand.tier, cand.star)
      if (!ok && !onConfirmPick) showHintToast('backpack_full_buy', '上阵区和背包已满，无法获得该物品', 0xff8f8f)
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
    setBaseShopPrimaryButtonsVisible(false)
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
        showHintToast('backpack_full_buy', '占卜师：当前无可重选候选', 0xffb27a)
        return
      }
      options.onRerollUsed?.()
      closeOverlay(false)
      showNeutralChoiceOverlay(stage, titleText, next, onConfirmPick, displayMode, options)
    })

    overlay.addChild(rerollBtn)
  }

  stage.addChild(overlay)
  return true
}

function collectArchetypeRuleTransformCandidates(
  instanceId: string,
  zone: 'battle' | 'backpack',
  rule: 'same' | 'other',
  minBaseTier?: TierKey,
): ItemDef[] {
  const system = zone === 'battle' ? battleSystem : backpackSystem
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
      return compareTier(tier, minBaseTier) >= 0
    })
    .filter((it) => {
      const arch = toSkillArchetype(getPrimaryArchetype(it.tags))
      if (arch !== 'warrior' && arch !== 'archer' && arch !== 'assassin') return false
      return rule === 'same' ? arch === srcArch : arch !== srcArch
    })
}

function transformPlacedItemKeepLevelTo(
  instanceId: string,
  zone: 'battle' | 'backpack',
  nextDef: ItemDef,
  withFx = false,
): boolean {
  const system = zone === 'battle' ? battleSystem : backpackSystem
  const view = zone === 'battle' ? battleView : backpackView
  if (!system || !view) return false
  const placed = system.getItem(instanceId)
  if (!placed) return false
  if (normalizeSize(nextDef.size) !== placed.size) return false
  const level = getInstanceLevel(instanceId)
  const legacy = levelToTierStar(level)
  const tier = legacy?.tier ?? 'Bronze'
  const star = legacy?.star ?? 1
  system.remove(instanceId)
  if (!system.place(placed.col, placed.row, placed.size, nextDef.id, instanceId)) {
    system.place(placed.col, placed.row, placed.size, placed.defId, instanceId)
    return false
  }
  view.removeItem(instanceId)
  void view.addItem(instanceId, nextDef.id, placed.size, placed.col, placed.row, toVisualTier(tier, star)).then(() => {
    const visualTier = getInstanceTier(instanceId) ?? tier
    const visualStar = getInstanceTierStar(instanceId)
    view.setItemTier(instanceId, toVisualTier(visualTier, visualStar))
    drag?.refreshZone(view)
  })
  instanceToDefId.set(instanceId, nextDef.id)
  setInstanceQualityLevel(instanceId, nextDef.id, parseTierName(nextDef.starting_tier) ?? 'Bronze', level)
  unlockItemToPool(nextDef.id)
  if (withFx) playTransformOrUpgradeFlashEffect(instanceId, zone)
  return true
}

function openEventDraftFromNeutralScroll(stage: Container): boolean {
  const choices = pickRandomEventDraftChoices(currentDay).slice(0, 2)
  if (choices.length < 2) return false
  pendingEventDraft = { day: currentDay, choices, rerolled: false }
  closeEventDraftOverlay()
  ensureEventDraftSelection(stage)
  return true
}

function openSpecialShopFromNeutralScroll(stage: Container): boolean {
  const prevOffers = specialShopOffers.length > 0 ? [...specialShopOffers] : undefined
  specialShopRefreshCount = 0
  specialShopOffers = rollSpecialShopOffers(prevOffers)
  if (specialShopOffers.length !== 3) {
    specialShopOffers = rollSpecialShopOffers()
  }
  if (specialShopOffers.length !== 3) return false
  openSpecialShopOverlay(stage)
  return true
}

function getNeutralSkillTierByItem(item: ItemDef): SkillTier {
  const tier = parseTierName(item.starting_tier) ?? 'Bronze'
  if (tier === 'Silver') return 'silver'
  if (tier === 'Gold' || tier === 'Diamond') return 'gold'
  return 'bronze'
}

function openSkillDraftFromNeutralScrollByItem(stage: Container, source: ItemDef): boolean {
  const tier = getNeutralSkillTierByItem(source)
  const choices = pickSkillChoicesExactTier(tier).slice(0, 2)
  if (choices.length < 2) return false
  pendingSkillDraft = { day: currentDay, tier, choices, rerolled: false, fixedTier: true }
  closeSkillDraftOverlay()
  ensureSkillDraftSelection(stage)
  return true
}

function buildTierChestChoiceCandidates(tier: TierKey): NeutralChoiceCandidate[] {
  const allTierNonNeutral = getAllItems()
    .filter((it) => !isNeutralItemDef(it))
    .filter((it) => parseAvailableTiers(it.available_tiers).includes(tier))

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

function applyNeutralDiscardEffect(source: ItemDef, stage: Container): boolean {
  const kind = getNeutralSpecialKind(source)
  if (!kind) return false

  if (kind === 'upgrade_stone') {
    const nonNeutralCount = getAllOwnedPlacedItems().filter((it) => {
      const def = getItemDefById(it.item.defId)
      return !!def && !isNeutralItemDef(def)
    }).length
    if (nonNeutralCount < 5) {
      showHintToast('no_gold_buy', '升级石：非中立物品不足5个，丢弃失败', 0xffb27a)
      return false
    }
    const targets = collectUpgradeableOwnedPlacedItems()
    const picked = targets[Math.floor(Math.random() * targets.length)]
    if (!picked) {
      showHintToast('no_gold_buy', '升级石：没有可升级的目标', 0xffb27a)
      return true
    }
    const ok = upgradePlacedItem(picked.item.instanceId, picked.zone, true)
    if (ok) showHintToast('no_gold_buy', '升级石：已升级1个随机物品', 0x9be5ff)
    return true
  }

  if (isNeutralTargetStone(source)) return true

  if (kind === 'skill_scroll') {
    const ok = openSkillDraftFromNeutralScrollByItem(stage, source)
    if (!ok) showHintToast('no_gold_buy', '技能卷轴：当前无法打开技能选择', 0xffb27a)
    return true
  }
  if (kind === 'shop_scroll') {
    const ok = openSpecialShopFromNeutralScroll(stage)
    if (!ok) showHintToast('no_gold_buy', '购物卷轴：当前无法打开折扣商店', 0xffb27a)
    return true
  }
  if (kind === 'event_scroll') {
    const ok = openEventDraftFromNeutralScroll(stage)
    if (!ok) showHintToast('no_gold_buy', '冒险卷轴：当前无法打开事件选择', 0xffb27a)
    return true
  }
  if (kind === 'raw_stone') {
    const picks = pickCandidateItemsByNames(['升级石', '转职石', '变化石'])
      .filter((item) => {
        const oneKind = getNeutralSpecialKind(item)
        return oneKind ? isNeutralKindRandomAvailable(oneKind) : true
      })
      .map((item) => ({ item, tier: 'Bronze' as TierKey, star: 1 as const }))
    if (picks.length <= 0) {
      showHintToast('no_gold_buy', '原石：当前无可选物品', 0xffb27a)
      return true
    }
    const ok = showNeutralChoiceOverlay(stage, '选择一块石头', picks)
    if (!ok) showHintToast('no_gold_buy', '原石：当前无可选物品', 0xffb27a)
    return true
  }
  if (kind === 'blank_scroll') {
    const picks = pickCandidateItemsByNames(['青铜卷轴', '购物卷轴', '冒险卷轴'])
      .filter((item) => {
        const oneKind = getNeutralSpecialKind(item)
        return oneKind ? isNeutralKindRandomAvailable(oneKind) : true
      })
      .map((item) => ({ item, tier: 'Bronze' as TierKey, star: 1 as const }))
    if (picks.length <= 0) {
      showHintToast('no_gold_buy', '空白卷轴：当前无可选物品', 0xffb27a)
      return true
    }
    const ok = showNeutralChoiceOverlay(stage, '选择一张卷轴', picks)
    if (!ok) showHintToast('no_gold_buy', '空白卷轴：当前无可选物品', 0xffb27a)
    return true
  }
  if (kind === 'medal') {
    const ok = showMedalArchetypeChoiceOverlay(stage)
    if (!ok) showHintToast('no_gold_buy', '勋章：当前无法打开职业选择', 0xffb27a)
    return true
  }

  if (kind === 'silver_chest') {
    const picks = buildTierChestChoiceCandidates('Silver')
    if (picks.length <= 0) {
      showHintToast('no_gold_buy', '白银宝箱：当前无可选白银物品', 0xffb27a)
      return true
    }
    const ok = showNeutralChoiceOverlay(stage, '白银宝箱：选择白银物品', picks, undefined, 'special_shop_like')
    if (!ok) showHintToast('no_gold_buy', '白银宝箱：当前无可选白银物品', 0xffb27a)
    return true
  }

  if (kind === 'golden_chest') {
    const picks = buildTierChestChoiceCandidates('Gold')
    if (picks.length <= 0) {
      showHintToast('no_gold_buy', '黄金宝箱：当前无可选黄金物品', 0xffb27a)
      return true
    }
    const ok = showNeutralChoiceOverlay(stage, '黄金宝箱：选择黄金物品', picks, undefined, 'special_shop_like')
    if (!ok) showHintToast('no_gold_buy', '黄金宝箱：当前无可选黄金物品', 0xffb27a)
    return true
  }

  if (kind === 'diamond_chest') {
    const picks = buildTierChestChoiceCandidates('Diamond')
    if (picks.length <= 0) {
      showHintToast('no_gold_buy', '钻石宝箱：当前无可选钻石物品', 0xffb27a)
      return true
    }
    const ok = showNeutralChoiceOverlay(stage, '钻石宝箱：选择钻石物品', picks, undefined, 'special_shop_like')
    if (!ok) showHintToast('no_gold_buy', '钻石宝箱：当前无可选钻石物品', 0xffb27a)
    return true
  }

  return false
}

function buildStoneTransformChoices(
  target: SynthesisTarget,
  rule: 'same' | 'other',
  opts?: { rollLevel?: number; displayTier?: TierKey; displayStar?: 1 | 2; choiceCount?: number },
): NeutralChoiceCandidate[] {
  const targetTier = getInstanceTier(target.instanceId) ?? 'Bronze'
  const targetLevel = getInstanceLevel(target.instanceId)
  const targetStar = getInstanceTierStar(target.instanceId)
  const rollLevel = Math.max(1, Math.min(7, Math.round(opts?.rollLevel ?? targetLevel))) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  const displayTier = opts?.displayTier ?? targetTier
  const displayStar = opts?.displayStar ?? targetStar
  const choiceCount = Math.max(1, Math.min(3, Math.round(opts?.choiceCount ?? 2)))
  const poolAllTier = collectArchetypeRuleTransformCandidates(target.instanceId, target.zone, rule)
  const picked: ItemDef[] = []
  let remaining = [...poolAllTier]
  for (let i = 0; i < choiceCount && remaining.length > 0; i++) {
    const availableTiers = Array.from(new Set(remaining.map((it) => parseTierName(it.starting_tier) ?? 'Bronze')))
    const selectedTier = availableTiers.length > 0
      ? pickQualityByPseudoRandomBag(rollLevel, availableTiers)
      : null
    const tierPool = selectedTier
      ? remaining.filter((it) => (parseTierName(it.starting_tier) ?? 'Bronze') === selectedTier)
      : remaining
    const one = pickRandomElements(tierPool.length > 0 ? tierPool : remaining, 1)[0]
    if (!one) break
    picked.push(one)
    remaining = remaining.filter((it) => it.id !== one.id)
  }
  return picked.map((item) => ({ item, tier: displayTier, star: displayStar }))
}

function rollStoneTransformCandidate(
  target: SynthesisTarget,
  rule: 'same' | 'other',
  opts?: { rollLevel?: number; displayTier?: TierKey; displayStar?: 1 | 2 },
): NeutralChoiceCandidate | null {
  const targetTier = getInstanceTier(target.instanceId) ?? 'Bronze'
  const targetLevel = getInstanceLevel(target.instanceId)
  const targetStar = getInstanceTierStar(target.instanceId)
  const rollLevel = Math.max(1, Math.min(7, Math.round(opts?.rollLevel ?? targetLevel))) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  const displayTier = opts?.displayTier ?? targetTier
  const displayStar = opts?.displayStar ?? targetStar
  const poolAllTier = collectArchetypeRuleTransformCandidates(target.instanceId, target.zone, rule)
  if (poolAllTier.length <= 0) return null
  const availableTiers = Array.from(new Set(poolAllTier.map((it) => parseTierName(it.starting_tier) ?? 'Bronze')))
  const pickedTier = availableTiers.length > 0 ? pickQualityByPseudoRandomBag(rollLevel, availableTiers) : null
  const pool = pickedTier
    ? poolAllTier.filter((it) => (parseTierName(it.starting_tier) ?? 'Bronze') === pickedTier)
    : poolAllTier
  const picked = pickRandomElements(pool, 1)[0]
  if (!picked) return null
  return { item: picked, tier: displayTier, star: displayStar }
}

function showLv7MorphSynthesisConfirmOverlay(
  stage: Container,
  onConfirm: () => void,
  onCancel?: () => void,
): void {
  setTransitionInputEnabled(false)
  setBaseShopPrimaryButtonsVisible(false)

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
    setTransitionInputEnabled(true)
    applyPhaseInputLock()
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

function applyNeutralStoneTargetEffect(sourceDef: ItemDef, target: SynthesisTarget, stage: Container): boolean {
  const kind = getNeutralSpecialKind(sourceDef)
  if (!kind) return false
  if (!isNeutralTargetStone(sourceDef)) return false
  const system = target.zone === 'battle' ? battleSystem : backpackSystem
  const placed = system?.getItem(target.instanceId)
  if (!placed) return false
  const targetLevel = getInstanceLevel(target.instanceId)
  const minLevelByKind: Partial<Record<NeutralSpecialKind, number>> = {
    warrior_stone: 2,
    archer_stone: 2,
    assassin_stone: 2,
    gold_morph_stone: 4,
    diamond_morph_stone: 6,
  }
  const minLevel = minLevelByKind[kind] ?? 1
  if (targetLevel < minLevel) {
    showHintToast('no_gold_buy', `${sourceDef.name_cn}：该目标等级太低，无法转化`, 0xffb27a)
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

  const buildChoices = () => {
    const all = collectPoolCandidatesByLevel(targetLevel)
      .filter((one) => normalizeSize(one.item.size) === placed.size)
      .filter((one) => one.item.id !== placed.defId)

    const filtered = all.filter((one) => {
      const arch = toSkillArchetype(getPrimaryArchetype(one.item.tags))
      if (arch !== 'warrior' && arch !== 'archer' && arch !== 'assassin') return false
      if (kind === 'class_shift_stone') return arch !== targetArch
      if (kind === 'class_morph_stone') return true
      if (kind === 'warrior_stone') return arch === 'warrior'
      if (kind === 'archer_stone') return arch === 'archer'
      if (kind === 'assassin_stone') return arch === 'assassin'
      if (kind === 'gold_morph_stone') return parseAvailableTiers(one.item.available_tiers).includes('Gold')
      if (kind === 'diamond_morph_stone') return parseAvailableTiers(one.item.available_tiers).includes('Diamond')
      return false
    })
    return pickRandomElements(filtered, 3).map((one) => ({ item: one.item, tier: one.tier, star: one.star }))
  }

  const choices = buildChoices()
  if (choices.length < 3) {
    showHintToast('no_gold_buy', `${sourceDef.name_cn}：该目标当前无法转化`, 0xffb27a)
    return false
  }

  return showNeutralChoiceOverlay(stage, title, choices, (picked) => {
    const ok = transformPlacedItemKeepLevelTo(target.instanceId, target.zone, picked.item, true)
    if (!ok) {
      showHintToast('no_gold_buy', `${sourceDef.name_cn}：该目标当前无法转化`, 0xffb27a)
      return false
    }
    showHintToast('no_gold_buy', `${sourceDef.name_cn}：已转化目标物品`, 0x9be5ff)
    return true
  }, 'special_shop_like')
}

function tryRunHeroSameItemSynthesisChoice(
  stage: Container,
  sourceDefId: string,
  sourceTier: TierKey,
  sourceStar: 1 | 2,
  target: SynthesisTarget,
  consumeSource: () => boolean,
): boolean {
  if (!canTriggerHeroSameItemSynthesisChoice()) return false
  const system = target.zone === 'battle' ? battleSystem : backpackSystem
  const targetItem = system?.getItem(target.instanceId)
  if (!targetItem || targetItem.defId !== sourceDefId) return false
  const upgradeTo = nextTierLevel(sourceTier, sourceStar)
  if (!upgradeTo) return false
  const nextLevel = Math.max(1, Math.min(7, tierStarLevelIndex(upgradeTo.tier, upgradeTo.star) + 1)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  const sourceDef = getItemDefById(sourceDefId)
  if (!sourceDef) return false
  const all = collectPoolCandidatesByLevel(nextLevel)
  const altPool = all.filter((one) => one.item.id !== sourceDefId)
  if (altPool.length <= 0) return false
  const altPicks = pickRandomElements(altPool, 2)
  const choices: NeutralChoiceCandidate[] = [
    { item: sourceDef, tier: upgradeTo.tier, star: upgradeTo.star },
    ...altPicks.map((one) => ({ item: one.item, tier: one.tier, star: one.star })),
  ]
  const opened = showNeutralChoiceOverlay(stage, '戏法师：选择合成结果', choices, (picked) => {
    if (!consumeSource()) return false
    const ok = transformPlacedItemKeepLevelTo(target.instanceId, target.zone, picked.item, true)
    if (!ok) {
      showHintToast('backpack_full_buy', '戏法师：转化失败', 0xff8f8f)
      return false
    }
    setInstanceQualityLevel(target.instanceId, picked.item.id, parseTierName(picked.item.starting_tier) ?? 'Bronze', nextLevel)
    applyInstanceTierVisuals()
    syncShopOwnedTierRules()
    refreshUpgradeHints()
    markHeroSameItemSynthesisChoiceTriggered()
    grantSynthesisExp(1, { instanceId: target.instanceId, zone: target.zone })
    showHintToast('no_gold_buy', '戏法师：本次同物合成可选其他物品', 0x9be5ff)
    refreshShopUI()
    return true
  }, 'special_shop_like')
  return opened
}

function tryRunSameArchetypeDiffItemStoneSynthesis(
  sourceInstanceId: string,
  sourceDefId: string,
  sourceTier: TierKey,
  sourceStar: 1 | 2,
  target: SynthesisTarget,
  restore: () => void,
): boolean {
  if (canUseHeroDailyCardReroll()) return false
  const system = target.zone === 'battle' ? battleSystem : backpackSystem
  const targetItem = system?.getItem(target.instanceId)
  if (!targetItem) return false
  const targetTier = getInstanceTier(target.instanceId) ?? sourceTier
  const targetStar = getInstanceTierStar(target.instanceId)
  if (!canUseSameArchetypeDiffItemStoneSynthesis(sourceDefId, targetItem.defId, sourceTier, sourceStar, targetTier, targetStar)) {
    return false
  }
  const upgradeTo = nextTierLevel(sourceTier, sourceStar)
  if (!upgradeTo) return false
  const nextLevel = Math.max(1, Math.min(7, tierStarLevelIndex(upgradeTo.tier, upgradeTo.star) + 1)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  const rolled = rollStoneTransformCandidate(target, 'other', {
    rollLevel: nextLevel,
    displayTier: upgradeTo.tier,
    displayStar: upgradeTo.star,
  })
  if (!rolled) {
    showHintToast('backpack_full_buy', '同职业合成：当前无可用候选', 0xffb27a)
    restore()
    return true
  }
  const ok = transformPlacedItemKeepLevelTo(target.instanceId, target.zone, rolled.item, true)
  if (!ok) {
    showHintToast('backpack_full_buy', '同职业合成：转化失败', 0xff8f8f)
    restore()
    return true
  }
  setInstanceQualityLevel(target.instanceId, rolled.item.id, parseTierName(rolled.item.starting_tier) ?? 'Bronze', nextLevel)
  applyInstanceTierVisuals()
  syncShopOwnedTierRules()
  refreshUpgradeHints()
  removeInstanceMeta(sourceInstanceId)
  grantSynthesisExp(1, { instanceId: target.instanceId, zone: target.zone })
  showHintToast('no_gold_buy', `同职业合成：随机转化为${rolled.item.name_cn}`, 0x9be5ff)
  refreshShopUI()
  return true
}

function applyFutureEventEffectsOnNewDay(day: number): void {
  if (!shopManager) return
  const pendingGold = Math.max(0, Math.round(pendingGoldByDay.get(day) ?? 0))
  if (pendingGold > 0) {
    shopManager.gold += pendingGold
    pendingGoldByDay.delete(day)
    showHintToast('no_gold_buy', `事件结算：获得${pendingGold}金币`, 0xa8f0b6)
  }
  const pendingBattleUp = Math.max(0, Math.round(pendingBattleUpgradeByDay.get(day) ?? 0))
  if (pendingBattleUp > 0) {
    pendingBattleUpgradeByDay.delete(day)
    let changed = 0
    for (let i = 0; i < pendingBattleUp; i++) {
      const battleItems = collectUpgradeableOwnedPlacedItems('battle')
      if (battleItems.length <= 0) break
      for (const one of battleItems) {
        if (upgradePlacedItem(one.item.instanceId, 'battle', true)) changed += 1
      }
    }
    if (changed > 0) showHintToast('no_gold_buy', `事件结算：上阵区升级${changed}个物品`, 0x9be5ff)
    else showHintToast('no_gold_buy', '事件结算：没有可升级的目标', 0xffb27a)
  }
}

function randomArchetypeItemsByDay(archetype: EventArchetype, count: number): PoolCandidate[] {
  const byLevel: Record<1 | 2 | 3 | 4 | 5 | 6 | 7, PoolCandidate[]> = {
    1: collectPoolCandidatesByLevel(1),
    2: collectPoolCandidatesByLevel(2),
    3: collectPoolCandidatesByLevel(3),
    4: collectPoolCandidatesByLevel(4),
    5: collectPoolCandidatesByLevel(5),
    6: collectPoolCandidatesByLevel(6),
    7: collectPoolCandidatesByLevel(7),
  }
  const weights = getQuickBuyLevelWeightsByDay(currentDay)
  const out: PoolCandidate[] = []
  const levels: Array<1 | 2 | 3 | 4 | 5 | 6 | 7> = [1, 2, 3, 4, 5, 6, 7]
  for (let i = 0; i < count; i++) {
    const leveled: Array<{ level: 1 | 2 | 3 | 4 | 5 | 6 | 7; weight: number }> = []
    for (const lv of levels) {
      const pool = byLevel[lv].filter((c) => toSkillArchetype(getPrimaryArchetype(c.item.tags)) === archetype)
      if (pool.length <= 0) continue
      const w = Math.max(0, Number(weights[lv - 1] ?? 0))
      if (w <= 0) continue
      leveled.push({ level: lv, weight: w })
    }
    if (leveled.length <= 0) break
    const total = leveled.reduce((sum, it) => sum + it.weight, 0)
    let roll = Math.random() * total
    let levelNum = leveled[leveled.length - 1]!.level
    for (const one of leveled) {
      roll -= one.weight
      if (roll <= 0) {
        levelNum = one.level
        break
      }
    }
    const pool = byLevel[levelNum].filter((c) => toSkillArchetype(getPrimaryArchetype(c.item.tags)) === archetype)
    const picked = pool[Math.floor(Math.random() * pool.length)]
    if (picked) out.push(picked)
  }
  return out
}

function getMaxQuickBuyLevelForDay(day: number): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const weights = getQuickBuyLevelWeightsByDay(day)
  let maxLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7 = 1
  for (let i = 0; i < weights.length; i++) {
    if (Number(weights[i] ?? 0) > 0) maxLevel = (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  }
  return maxLevel
}

function getMinQuickBuyLevelForDay(day: number): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const weights = getQuickBuyLevelWeightsByDay(day)
  for (let i = 0; i < weights.length; i++) {
    if (Number(weights[i] ?? 0) > 0) return (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  }
  return 1
}

function pickForcedLowLevelPairCandidate(day: number): PoolCandidate | null {
  if (!battleSystem || !backpackSystem) return null
  const minAllowedLevel = getMinQuickBuyLevelForDay(day)
  if (minAllowedLevel <= 1) return null

  const oddBuckets = new Map<string, {
    defId: string
    level: 1 | 2 | 3 | 4 | 5 | 6 | 7
    tier: TierKey
    star: 1 | 2
    count: number
  }>()

  const collect = (items: ReturnType<GridSystem['getAllItems']>) => {
    for (const it of items) {
      const def = getItemDefById(it.defId)
      if (!def || isNeutralItemDef(def)) continue
      const level = getInstanceLevel(it.instanceId)
      if (level >= minAllowedLevel) continue
      const tier = getInstanceTier(it.instanceId)
      const star = getInstanceTierStar(it.instanceId)
      if (!tier) continue
      const key = `${it.defId}|${tier}|${star}`
      const prev = oddBuckets.get(key)
      if (prev) prev.count += 1
      else oddBuckets.set(key, { defId: it.defId, level, tier, star, count: 1 })
    }
  }
  collect(battleSystem.getAllItems())
  collect(backpackSystem.getAllItems())

  const pending = Array.from(oddBuckets.values())
    .filter((it) => (it.count % 2) === 1)
    .sort((a, b) => (a.level - b.level) || a.defId.localeCompare(b.defId))
  if (pending.length <= 0) return null

  for (const one of pending) {
    const item = getItemDefById(one.defId)
    if (!item) continue
    const size = normalizeSize(item.size)
    if (!findFirstBattlePlace(size) && !findFirstBackpackPlace(size)) continue
    return {
      item,
      level: one.level,
      tier: one.tier,
      star: one.star,
      price: getUnlockPoolBuyPriceByLevel(one.level),
    }
  }
  return null
}

function pickArchetypeItemAtLevel(archetype: EventArchetype, level: 1 | 2 | 3 | 4 | 5 | 6 | 7): PoolCandidate | null {
  const pool = collectPoolCandidatesByLevel(level)
    .filter((c) => toSkillArchetype(getPrimaryArchetype(c.item.tags)) === archetype)
  if (pool.length <= 0) return null
  return pool[Math.floor(Math.random() * pool.length)] ?? null
}

function pickMedalArchetypeItem(archetype: EventArchetype): PoolCandidate | null {
  const baseMax = getMaxQuickBuyLevelForDay(currentDay)
  const targetLevel = Math.min(7, baseMax + 2) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  return pickArchetypeItemAtLevel(archetype, targetLevel)
}

function applyEventEffect(event: EventChoice, fromTest = false): boolean {
  if (!shopManager) return false
  const day = currentDay
  const toastPrefix = fromTest ? '[测试] ' : ''

  if (event.id === 'event1') {
    const targets = collectUpgradeableOwnedPlacedItems('battle')
    if (targets.length <= 0) {
      showHintToast('no_gold_buy', `${toastPrefix}没有可升级的目标`, 0xffb27a)
      return false
    }
    const picked = pickRandomElements(targets, 1)
    const ok = picked.some((it) => upgradePlacedItem(it.item.instanceId, it.zone, true))
    if (ok) showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0x9be5ff)
    return ok
  }
  if (event.id === 'event2') {
    const targets = collectUpgradeableOwnedPlacedItems('backpack')
    if (targets.length <= 0) {
      showHintToast('no_gold_buy', `${toastPrefix}没有可升级的目标`, 0xffb27a)
      return false
    }
    const picked = pickRandomElements(targets, 2)
    let okCount = 0
    for (const it of picked) {
      if (upgradePlacedItem(it.item.instanceId, it.zone, true)) okCount += 1
    }
    if (okCount > 0) showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}（${okCount}/2）`, 0x9be5ff)
    return okCount > 0
  }
  if (event.id === 'event3') {
    const targets = getAllOwnedPlacedItems()
      .filter((it) => it.zone === 'backpack')
      .filter((it) => canConvertAndUpgradePlacedItem(it.item.instanceId, it.zone))
    const picked = pickRandomElements(targets, 3)
    let okCount = 0
    for (const it of picked) {
      if (convertAndUpgradePlacedItem(it.item.instanceId, it.zone, true)) okCount += 1
    }
    if (okCount > 0) showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}（${okCount}/3）`, 0x9be5ff)
    return okCount > 0
  }
  if (event.id === 'event4' || event.id === 'event5' || event.id === 'event6') {
    const archetype: EventArchetype = event.id === 'event4' ? 'warrior' : event.id === 'event5' ? 'archer' : 'assassin'
    const items = randomArchetypeItemsByDay(archetype, 2)
    let okCount = 0
    for (const one of items) {
      if (placeItemToInventoryOrBattle(one.item, one.tier, one.star)) okCount++
    }
    if (okCount > 0) showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0x9be5ff)
    return okCount > 0
  }
  if (event.id === 'event7' || event.id === 'event8' || event.id === 'event9') {
    dayEventState.forceBuyArchetype = event.id === 'event7' ? 'warrior' : event.id === 'event8' ? 'archer' : 'assassin'
    dayEventState.forceBuyRemaining = 3
    showHintToast('no_gold_buy', `${toastPrefix}前3次购买锁定${getEventArchetypeCn(dayEventState.forceBuyArchetype)}`, 0x8ff0b0)
    return true
  }
  if (event.id === 'event10' || event.id === 'event12' || event.id === 'event13') {
    dayEventState.forceSynthesisArchetype = event.id === 'event10' ? 'warrior' : event.id === 'event12' ? 'archer' : 'assassin'
    dayEventState.forceSynthesisRemaining = 2
    showHintToast('no_gold_buy', `${toastPrefix}前2次合成锁定${getEventArchetypeCn(dayEventState.forceSynthesisArchetype)}`, 0x8ff0b0)
    return true
  }
  if (event.id === 'event14') {
    dayEventState.extraUpgradeRemaining = 1
    showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0x8ff0b0)
    return true
  }
  if (event.id === 'event15' || event.id === 'event16' || event.id === 'event17') {
    const targetArch: EventArchetype = event.id === 'event15' ? 'warrior' : event.id === 'event16' ? 'archer' : 'assassin'
    const owned = getAllOwnedPlacedItems().filter((it) => {
      const def = getItemDefById(it.item.defId)
      return toSkillArchetype(getPrimaryArchetype(def?.tags ?? '')) === targetArch
    })
    const picked = owned[Math.floor(Math.random() * owned.length)]
    if (!picked) return false
    const def = getItemDefById(picked.item.defId)
    if (!def) return false
    const tier = instanceToTier.get(picked.item.instanceId) ?? 'Bronze'
    const star = getInstanceTierStar(picked.item.instanceId)
    const ok = placeItemToInventoryOrBattle(def, tier, star)
    if (ok) showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0x9be5ff)
    return ok
  }
  if (event.id === 'event18') {
    if (!backpackSystem) return false
    const picked = pickRandomElements(backpackSystem.getAllItems(), 2)
    let ok = false
    for (const one of picked) {
      const def = getItemDefById(one.defId)
      if (!def) continue
      const tier = instanceToTier.get(one.instanceId) ?? 'Bronze'
      const star = getInstanceTierStar(one.instanceId)
      ok = placeItemToInventoryOrBattle(def, tier, star) || ok
    }
    if (ok) showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0x9be5ff)
    return ok
  }
  if (event.id === 'event19') {
    if (!backpackSystem) return false
    const all = [...backpackSystem.getAllItems()]
    let sold = 0
    for (const one of all) {
      const def = getItemDefById(one.defId)
      if (!def) continue
      const tier = instanceToTier.get(one.instanceId) ?? 'Bronze'
      const star = getInstanceTierStar(one.instanceId)
      shopManager.gold += shopManager.getTierStarPrice(def, tier, star) + 1
      removePlacedItemById(one.instanceId, 'backpack')
      sold++
    }
    if (sold > 0) showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0xa8f0b6)
    return sold > 0
  }
  if (event.id === 'event20') {
    const gain = day * 4
    shopManager.gold += gain
    showHintToast('no_gold_buy', `${toastPrefix}获得${gain}金币`, 0xa8f0b6)
    return true
  }
  if (event.id === 'event21') {
    if (!backpackSystem) return false
    const all = [...backpackSystem.getAllItems()]
    if (all.length <= 0) return false
    for (const one of all) removePlacedItemById(one.instanceId, 'backpack')
    const gain = day * 8
    shopManager.gold += gain
    showHintToast('no_gold_buy', `${toastPrefix}清空背包并获得${gain}金币`, 0xa8f0b6)
    return true
  }
  if (event.id === 'event22') {
    const life = getLifeState()
    const newMax = Math.max(life.max + 1, Math.round(life.max * 1.1))
    setLifeState(life.current, newMax)
    showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0xa8f0b6)
    return true
  }
  if (event.id === 'event23') {
    const life = getLifeState()
    if (life.current >= life.max) return false
    setLifeState(life.current + 1, life.max)
    showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0xa8f0b6)
    return true
  }
  if (event.id === 'event24') {
    const all = getAllOwnedPlacedItems()
    let changed = false
    for (const one of all) {
      changed = convertAndUpgradePlacedItem(one.item.instanceId, one.zone, true) || changed
    }
    if (changed) showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0x9be5ff)
    else showHintToast('no_gold_buy', `${toastPrefix}没有可升级的目标`, 0xffb27a)
    return changed
  }
  if (event.id === 'event25') {
    const invested = Math.max(0, Math.round(shopManager.gold))
    shopManager.gold = 0
    schedulePendingGold(day + 1, invested * 2)
    showHintToast('no_gold_buy', `${toastPrefix}已投资${invested}金币，明日返还${invested * 2}`, 0xa8f0b6)
    return true
  }
  if (event.id === 'event26') {
    if (!battleSystem) return false
    const all = [...battleSystem.getAllItems()]
    let sold = 0
    for (const one of all) {
      const def = getItemDefById(one.defId)
      if (!def) continue
      const tier = instanceToTier.get(one.instanceId) ?? 'Bronze'
      const star = getInstanceTierStar(one.instanceId)
      shopManager.gold += shopManager.getSellPrice(def, tier, star) * 2
      removePlacedItemById(one.instanceId, 'battle')
      sold++
    }
    if (sold > 0) showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0xa8f0b6)
    return sold > 0
  }
  if (event.id === 'event27') {
    dayEventState.allSynthesisRandom = true
    showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0x8ff0b0)
    return true
  }
  if (event.id === 'event28') {
    const gain = day * 12
    schedulePendingGold(day + 3, gain)
    showHintToast('no_gold_buy', `${toastPrefix}已预约3天后获得${gain}金币`, 0xa8f0b6)
    return true
  }
  if (event.id === 'event29') {
    schedulePendingBattleUpgrade(day + 5, 1)
    showHintToast('no_gold_buy', `${toastPrefix}已预约5天后上阵区升级`, 0x9be5ff)
    return true
  }
  if (event.id === 'event34') {
    const day1 = day + 1
    const day2 = day + 2
    const futureBase1 = getDailyGoldForDay(getConfig(), day1)
    const futureBase2 = getDailyGoldForDay(getConfig(), day2)
    const gain = Math.max(0, Math.round((futureBase1 + futureBase2) * 0.6))
    shopManager.gold += gain
    blockedBaseIncomeDays.add(day1)
    blockedBaseIncomeDays.add(day2)
    showHintToast('no_gold_buy', `${toastPrefix}获得${gain}金币，未来2天基础收入已透支`, 0xa8f0b6)
    return true
  }
  if (event.id === 'event35') {
    const changed = convertHighestLevelItemsOnce()
    if (changed > 0) showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0x9be5ff)
    return changed > 0
  }
  if (event.id === 'event36') {
    const changed = upgradeLowestLevelItemsOnce()
    if (changed > 0) showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0x9be5ff)
    else showHintToast('no_gold_buy', `${toastPrefix}没有可升级的目标`, 0xffb27a)
    return changed > 0
  }
  return false
}

function getSkillDailyDraftPlanRows(): Array<Record<string, unknown>> {
  const skillCfg = getConfig().skillSystem as { dailyDraftPlan?: Array<Record<string, unknown>> } | undefined
  if (!skillCfg || !Array.isArray(skillCfg.dailyDraftPlan)) return []
  return skillCfg.dailyDraftPlan
}

function getDailyPlanRow(day: number): Record<string, unknown> | null {
  return getSkillDailyDraftPlanRows().find((it) => Math.round(Number(it.day) || 0) === day) ?? null
}

function resetDayEventState(): void {
  dayEventState = {
    forceBuyArchetype: null,
    forceBuyRemaining: 0,
    forceSynthesisArchetype: null,
    forceSynthesisRemaining: 0,
    extraUpgradeRemaining: 0,
    allSynthesisRandom: false,
  }
}
void resetDayEventState

function resetFutureEventState(): void {
  blockedBaseIncomeDays.clear()
  pendingGoldByDay.clear()
  pendingBattleUpgradeByDay.clear()
}
void resetFutureEventState

function getEventPoolRows(): EventChoice[] {
  const rows = getConfig().eventSystem?.eventPool
  if (!Array.isArray(rows)) return []
  return rows
}

function getSelectedEventCount(eventId: string): number {
  return Math.max(0, Math.round(selectedEventCountById.get(eventId) ?? 0))
}

function markEventSelected(eventId: string): void {
  const next = getSelectedEventCount(eventId) + 1
  selectedEventCountById.set(eventId, next)
}

function resetEventSelectionCounters(): void {
  selectedEventCountById.clear()
}

function getOwnedArchetypeSet(): Set<EventArchetype> {
  const out = new Set<EventArchetype>()
  const collect = (system: GridSystem | null) => {
    if (!system) return
    for (const it of system.getAllItems()) {
      const def = getItemDefById(it.defId)
      const archetype = toSkillArchetype(getPrimaryArchetype(def?.tags ?? ''))
      if (!archetype || archetype === 'utility') continue
      out.add(archetype)
    }
  }
  collect(battleSystem)
  collect(backpackSystem)
  return out
}

function getBattleArchetypeCounts(): Record<EventArchetype, number> {
  const out: Record<EventArchetype, number> = { warrior: 0, archer: 0, assassin: 0 }
  if (!battleSystem) return out
  for (const it of battleSystem.getAllItems()) {
    const def = getItemDefById(it.defId)
    const archetype = toSkillArchetype(getPrimaryArchetype(def?.tags ?? ''))
    if (archetype === 'warrior' || archetype === 'archer' || archetype === 'assassin') {
      out[archetype] += 1
    }
  }
  return out
}

function isBattleArchetypeTopTie(archetype: EventArchetype): boolean {
  const counts = getBattleArchetypeCounts()
  const self = counts[archetype]
  const maxCount = Math.max(counts.warrior, counts.archer, counts.assassin)
  return self > 0 && self === maxCount
}

function isEventChoiceAvailable(event: EventChoice, day: number): boolean {
  if (event.enabled === false) return false
  if (day < event.dayStart || day > event.dayEnd) return false
  const maxSelections = event.limits?.maxSelectionsPerRun
  if (typeof maxSelections === 'number' && Number.isFinite(maxSelections) && maxSelections > 0) {
    if (getSelectedEventCount(event.id) >= Math.round(maxSelections)) return false
  }
  const requiredArch = event.conditions?.requireArchetypeOwned
  if (requiredArch) {
    const owned = getOwnedArchetypeSet()
    if (!owned.has(requiredArch)) return false
  }
  if (event.conditions?.requireHeartNotFull) {
    const life = getLifeState()
    if (life.current >= life.max) return false
  }
  if (event.conditions?.requireBackpackNotEmpty) {
    const count = backpackSystem?.getAllItems().length ?? 0
    if (count <= 0) return false
  }
  if (event.conditions?.requireBattleNotEmpty) {
    const count = battleSystem?.getAllItems().length ?? 0
    if (count <= 0) return false
  }
  const topTieArch = event.conditions?.requireBattleArchetypeTopTie
  if (topTieArch && !isBattleArchetypeTopTie(topTieArch)) return false
  return true
}

function pickRandomEventDraftChoices(day: number): EventChoice[] {
  const pool = getEventPoolRows().filter((event) => isEventChoiceAvailable(event, day))
  if (pool.length <= 0) return []
  const left = pool.filter((it) => it.lane === 'left')
  const right = pool.filter((it) => it.lane === 'right')
  const picks: EventChoice[] = []
  const pickOne = (list: EventChoice[]): EventChoice | null => list[Math.floor(Math.random() * list.length)] ?? null
  const leftPicked = pickOne(left)
  const rightPicked = pickOne(right)
  if (leftPicked) picks.push(leftPicked)
  if (rightPicked && rightPicked.id !== leftPicked?.id) picks.push(rightPicked)
  if (picks.length >= 2) return picks
  const leftovers = pool.filter((it) => !picks.some((p) => p.id === it.id))
  while (picks.length < 2 && leftovers.length > 0) {
    const idx = Math.floor(Math.random() * leftovers.length)
    const picked = leftovers[idx]
    if (picked) picks.push(picked)
    leftovers.splice(idx, 1)
  }
  return picks
}

function pickRandomEventDraftChoicesNoOverlap(day: number, blockedIds: Set<string>): EventChoice[] {
  for (let i = 0; i < 60; i++) {
    const next = pickRandomEventDraftChoices(day).slice(0, 2)
    if (next.length < 2) continue
    const hasOverlap = next.some((it) => blockedIds.has(it.id))
    if (!hasOverlap) return next
  }
  return []
}

function resolveEventDescText(event: EventChoice, detailed: boolean): string {
  const useDetailed = detailed || !shouldShowSimpleDescriptions()
  const raw = useDetailed ? event.detailDesc : event.shortDesc
  if (event.id === 'event20') {
    return raw.replace(/x/g, String(currentDay * 4))
  }
  if (event.id === 'event21') {
    return raw.replace(/x/g, String(currentDay * 8))
  }
  if (event.id === 'event28') {
    const gain = currentDay * 12
    return `3天后获得${gain}金币`
  }
  return raw
}

function getSkillTierForDay(day: number): SkillTier | null {
  const skillCfg = getConfig().skillSystem
  if (!skillCfg) return null
  const plan = getSkillDailyDraftPlanRows().find((it) => Math.round(Number(it.day) || 0) === day)
  if (plan) {
    if ((Number(plan.shouldDraft) || 0) < 0.5) return null
    const bronze = Math.max(0, Number(plan.bronzeProb) || 0)
    const silver = Math.max(0, Number(plan.silverProb) || 0)
    const gold = Math.max(0, Number(plan.goldProb) || 0)
    if (bronze >= silver && bronze >= gold) return 'bronze'
    if (silver >= bronze && silver >= gold) return 'silver'
    return 'gold'
  }
  if ((skillCfg.triggerDaysByTier.bronze ?? []).includes(day)) return 'bronze'
  if ((skillCfg.triggerDaysByTier.silver ?? []).includes(day)) return 'silver'
  if ((skillCfg.triggerDaysByTier.gold ?? []).includes(day)) return 'gold'
  return null
}

function makeSkillPoolByTier(tier: SkillTier): SkillPick[] {
  if (tier === 'bronze') return [...BRONZE_SKILL_PICKS]
  if (tier === 'silver') return [...SILVER_SKILL_PICKS]
  if (tier === 'gold') return [...GOLD_SKILL_PICKS]
  return []
}

function randomByWeight(entries: Array<{ key: SkillTier; weight: number }>): SkillTier {
  const valid = entries.filter((it) => Number.isFinite(it.weight) && it.weight > 0)
  if (valid.length <= 0) return 'bronze'
  const sum = valid.reduce((acc, it) => acc + it.weight, 0)
  let roll = Math.random() * sum
  for (const one of valid) {
    roll -= one.weight
    if (roll <= 0) return one.key
  }
  return valid[valid.length - 1]!.key
}

function pickMixedSkillTier(baseTier: SkillTier, day: number): SkillTier {
  const plan = getSkillDailyDraftPlanRows().find((it) => Math.round(Number(it.day) || 0) === day)
  if (plan) {
    const bronze = Math.max(0, Number(plan.bronzeProb) || 0)
    const silver = Math.max(0, Number(plan.silverProb) || 0)
    const gold = Math.max(0, Number(plan.goldProb) || 0)
    if (bronze + silver + gold > 0) {
      return randomByWeight([
        { key: 'bronze', weight: bronze },
        { key: 'silver', weight: silver },
        { key: 'gold', weight: gold },
      ])
    }
  }

  if (baseTier === 'bronze') {
    return randomByWeight([
      { key: 'bronze', weight: 70 },
      { key: 'silver', weight: 25 },
      { key: 'gold', weight: 5 },
    ])
  }
  if (baseTier === 'silver') {
    return randomByWeight([
      { key: 'bronze', weight: 20 },
      { key: 'silver', weight: 60 },
      { key: 'gold', weight: 20 },
    ])
  }
  return randomByWeight([
    { key: 'bronze', weight: 10 },
    { key: 'silver', weight: 30 },
    { key: 'gold', weight: 60 },
  ])
}

function toSkillArchetype(raw: string): SkillArchetype | null {
  const key = String(raw || '').trim().toLowerCase()
  if (key === 'warrior' || key === '战士') return 'warrior'
  if (key === 'archer' || key === '弓手') return 'archer'
  if (key === 'assassin' || key === '刺客') return 'assassin'
  if (key === 'utility' || key === '通用') return 'utility'
  return null
}

function getDominantBattleArchetype(): SkillArchetype | null {
  if (!battleSystem) return null
  const counts = new Map<SkillArchetype, number>()
  for (const it of battleSystem.getAllItems()) {
    const def = getItemDefById(it.defId)
    const archetype = toSkillArchetype(getPrimaryArchetype(def?.tags ?? ''))
    if (!archetype || archetype === 'utility') continue
    counts.set(archetype, (counts.get(archetype) ?? 0) + 1)
  }
  if (counts.size <= 0) return null
  let maxCount = 0
  const top: SkillArchetype[] = []
  for (const [archetype, count] of counts) {
    if (count > maxCount) {
      maxCount = count
      top.length = 0
      top.push(archetype)
      continue
    }
    if (count === maxCount) top.push(archetype)
  }
  if (top.length <= 0) return null
  return top[Math.floor(Math.random() * top.length)] ?? null
}

function pickSkillChoices(baseTier: SkillTier, day: number): SkillPick[] {
  const picks: SkillPick[] = []
  const usedIds = new Set<string>()
  const alreadyPicked = new Set(pickedSkills.map((s) => s.id))
  const chooseCount = 2
  const firstDayArchetype: SkillArchetype | null = null
  const dominantBattleArchetype = firstDayArchetype ? null : getDominantBattleArchetype()

  const tryPickOne = (
    forcedArchetype: SkillArchetype | null,
    blockedArchetype: SkillArchetype | null,
  ): boolean => {
    for (let attempt = 0; attempt < 24; attempt++) {
      const tier = pickMixedSkillTier(baseTier, day)
      let source = makeSkillPoolByTier(tier).filter((s) => !usedIds.has(s.id) && !alreadyPicked.has(s.id))
      if (forcedArchetype) source = source.filter((s) => s.archetype === forcedArchetype)
      if (blockedArchetype) source = source.filter((s) => s.archetype !== blockedArchetype)
      if (source.length <= 0) continue
      const picked = source[Math.floor(Math.random() * source.length)]
      if (!picked) continue
      picks.push(picked)
      usedIds.add(picked.id)
      return true
    }
    return false
  }

  if (firstDayArchetype) {
    while (picks.length < chooseCount) {
      const ok = tryPickOne(firstDayArchetype, null)
      if (!ok) break
    }
  } else {
    if (dominantBattleArchetype) {
      const pickedDominant = tryPickOne(dominantBattleArchetype, null)
      if (!pickedDominant) {
        const fallbackFirst = tryPickOne(null, null)
        if (!fallbackFirst) return picks
      }
    } else {
      const first = tryPickOne(null, null)
      if (!first) return picks
    }

    while (picks.length < chooseCount) {
      const blockedArchetype = picks[0]?.archetype ?? null
      const ok = tryPickOne(null, blockedArchetype)
      if (!ok) {
        const fallback = tryPickOne(null, null)
        if (!fallback) break
      }
    }
  }

  const allSameArchetype = picks.length >= 3 && picks.every((s) => s.archetype === picks[0]!.archetype)
  const allUtility = picks.length >= 3 && picks.every((s) => s.archetype === 'utility')
  if (!firstDayArchetype && (allSameArchetype || allUtility)) {
    for (let i = 0; i < 18; i++) {
      const idx = Math.floor(Math.random() * picks.length)
      const current = picks[idx]
      if (!current) continue
      const replacementTier = pickMixedSkillTier(baseTier, day)
      const replacementPool = makeSkillPoolByTier(replacementTier).filter((s) => {
        if (s.id === current.id) return false
        if (usedIds.has(s.id)) return false
        if (alreadyPicked.has(s.id)) return false
        if (s.archetype === current.archetype) return false
        return true
      })
      if (replacementPool.length <= 0) continue
      const replacement = replacementPool[Math.floor(Math.random() * replacementPool.length)]
      if (!replacement) continue
      usedIds.delete(current.id)
      picks[idx] = replacement
      usedIds.add(replacement.id)
      break
    }
  }

  return picks.slice(0, chooseCount)
}

function pickSkillChoicesNoOverlap(baseTier: SkillTier, day: number, blockedIds: Set<string>): SkillPick[] {
  for (let i = 0; i < 80; i++) {
    const next = pickSkillChoices(baseTier, day).slice(0, 2)
    if (next.length < 2) continue
    const hasOverlap = next.some((it) => blockedIds.has(it.id))
    if (!hasOverlap) return next
  }
  return []
}

function pickSkillChoicesExactTier(baseTier: SkillTier, blockedIds?: Set<string>): SkillPick[] {
  const alreadyPicked = new Set(pickedSkills.map((s) => s.id))
  const blocked = blockedIds ?? new Set<string>()
  const pool = makeSkillPoolByTier(baseTier).filter((s) => !alreadyPicked.has(s.id) && !blocked.has(s.id))
  if (pool.length <= 0) return []
  const shuffled = [...pool]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = shuffled[i]
    shuffled[i] = shuffled[j]!
    shuffled[j] = tmp!
  }
  const picks: SkillPick[] = []
  for (const one of shuffled) {
    if (picks.length >= 2) break
    picks.push(one)
  }
  return picks
}

function layoutSkillIconBar(): void {
  if (!skillIconBarCon || !battleView) return
  const battleWidth = battleView.activeColCount * CELL_SIZE * battleView.scale.x
  skillIconBarCon.x = battleView.x + battleWidth / 2
  skillIconBarCon.y = battleView.y - 92
}

function refreshSkillIconBar(): void {
  if (!battleView) return
  const stage = getApp().stage
  if (!skillIconBarCon) {
    skillIconBarCon = new Container()
    skillIconBarCon.zIndex = 180
    stage.addChild(skillIconBarCon)
  }
  const con = skillIconBarCon
  // 关闭技能三选一时，仍允许显示“已持有技能”（例如测试面板手动添加）
  con.removeChildren().forEach((c) => c.destroy({ children: true }))
  if (pickedSkills.length <= 0) {
    con.visible = false
    return
  }

  const gap = -30
  const iconSize = 128
  const rowW = pickedSkills.length * iconSize + Math.max(0, pickedSkills.length - 1) * gap

  for (let i = 0; i < pickedSkills.length; i++) {
    const s = pickedSkills[i]!
    const cell = new Container()
    cell.eventMode = 'static'
    cell.cursor = 'pointer'
    const x = -rowW / 2 + i * (iconSize + gap) + iconSize / 2
    const hit = new Graphics()
    hit.roundRect(x - iconSize / 2, -iconSize / 2, iconSize, iconSize, 14)
    hit.fill({ color: 0x000000, alpha: 0.001 })
    cell.addChild(hit)

    const letter = new Text({
      text: s.name.slice(0, 1),
      style: { fontSize: 24, fill: 0xf5f7ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    letter.anchor.set(0.5)
    letter.x = x
    letter.y = 0
    cell.addChild(letter)
    mountSkillIconSprite(cell, s.id, s.icon, x, 0, iconSize, letter)

    cell.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      if (skillDetailSkillId === s.id) {
        if (shouldShowSimpleDescriptions()) {
          skillDetailMode = skillDetailMode === 'simple' ? 'detailed' : 'simple'
        } else {
          skillDetailMode = 'detailed'
        }
        showSkillDetailPopup(s)
      } else {
        currentSelection = { kind: 'none' }
        selectedSellAction = null
        resetInfoModeSelection()
        shopPanel?.setSelectedSlot(-1)
        battleView?.setSelected(null)
        backpackView?.setSelected(null)
        sellPopup?.hide()
        applySellButtonState()
        skillDetailMode = getDefaultSkillDetailMode()
        showSkillDetailPopup(s)
      }
    })

    con.addChild(cell)
  }

  con.visible = true
  layoutSkillIconBar()
}

function hideSkillDetailPopup(): void {
  skillDetailSkillId = null
  skillDetailMode = getDefaultSkillDetailMode()
  if (skillDetailPopupCon) skillDetailPopupCon.visible = false
}

function showSkillDetailPopup(skill: SkillPick): void {
  const stage = getApp().stage
  if (!skillDetailPopupCon) {
    const con = new Container()
    con.zIndex = 220
    con.eventMode = 'none'
    con.visible = false
    stage.addChild(con)
    skillDetailPopupCon = con
  }
  const con = skillDetailPopupCon
  con.removeChildren().forEach((c) => c.destroy({ children: true }))

  const panelW = Math.max(360, Math.min(CANVAS_W - 24, getDebugCfg('itemInfoWidth')))
  const pad = 16
  const iconSize = 128
  const iconX = pad
  const iconY = pad
  const textX = iconX + iconSize + 16
  const textW = panelW - textX - pad
  const titleFontSize = getDebugCfg('itemInfoNameFontSize')
  const descFontSize = getDebugCfg('itemInfoSimpleDescFontSize')
  const mode = shouldShowSimpleDescriptions() ? skillDetailMode : 'detailed'
  const shownDesc = mode === 'detailed' ? (skill.detailDesc ?? skill.desc) : skill.desc

  const title = new Text({
    text: skill.name,
    style: { fontSize: titleFontSize, fill: 0xffefc8, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  const tierBadge = new Text({
    text: skillTierLabelCn(skill.tier),
    style: {
      fontSize: Math.max(16, Math.round(titleFontSize * 0.7)),
      fill: 0xfff3cf,
      fontFamily: 'Arial',
      fontWeight: 'bold',
    },
  })
  const desc = new Text({
    text: shownDesc,
    style: {
      fontSize: descFontSize,
      fill: 0xd7e2fa,
      fontFamily: 'Arial',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: textW,
      lineHeight: Math.round(descFontSize * 1.25),
    },
  })

  const dividerY = iconY + 44
  const descY = dividerY + 12
  const contentBottom = Math.max(iconY + iconSize, descY + desc.height)
  const panelH = Math.max(getDebugCfg('itemInfoMinHSmall'), contentBottom + pad)
  const px = CANVAS_W / 2 - panelW / 2
  let panelBottomY = getDebugCfg('shopAreaY') - getDebugCfg('itemInfoBottomGapToShop') - 92
  if (skillIconBarCon?.visible) {
    panelBottomY = Math.min(panelBottomY, skillIconBarCon.y - 44)
  }
  const py = panelBottomY - panelH

  const bg = new Graphics()
  bg.roundRect(px, py, panelW, panelH, Math.max(0, getDebugCfg('gridItemCornerRadius')))
  bg.fill({ color: 0x1e1e30, alpha: 0.97 })
  bg.stroke({ color: 0x5566aa, width: 2, alpha: 1 })
  con.addChild(bg)

  const iconLetter = new Text({
    text: skill.name.slice(0, 1),
    style: { fontSize: 56, fill: 0xf5f7ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  iconLetter.anchor.set(0.5)
  iconLetter.x = px + iconX + iconSize / 2
  iconLetter.y = py + iconY + iconSize / 2 + 2
  con.addChild(iconLetter)
  mountSkillIconSprite(con, skill.id, skill.icon, px + iconX + iconSize / 2, py + iconY + iconSize / 2 + 2, iconSize, iconLetter)

  title.x = px + textX
  title.y = py + iconY + 2
  con.addChild(title)
  if (mode === 'detailed') {
    const badgePadX = 10
    const badgePadY = 4
    const badgeX = title.x + title.width + 12
    const badgeY = title.y + 2
    const badgeBg = new Graphics()
    badgeBg.roundRect(
      badgeX - badgePadX,
      badgeY - badgePadY,
      tierBadge.width + badgePadX * 2,
      tierBadge.height + badgePadY * 2,
      8,
    )
    badgeBg.fill({ color: skillTierColor(skill.tier), alpha: 0.45 })
    con.addChild(badgeBg)
    tierBadge.x = badgeX
    tierBadge.y = badgeY
    con.addChild(tierBadge)
  }

  const divider = new Graphics()
  divider.moveTo(px + textX, py + dividerY)
  divider.lineTo(px + panelW - pad, py + dividerY)
  divider.stroke({ color: 0x5a628f, width: 1, alpha: 0.9 })
  con.addChild(divider)

  desc.x = px + textX
  desc.y = py + descY
  con.addChild(desc)

  skillDetailSkillId = skill.id
  con.visible = true
}

function closeSkillDraftOverlay(): void {
  if (skillDraftOverlay?.parent) skillDraftOverlay.parent.removeChild(skillDraftOverlay)
  skillDraftOverlay?.destroy({ children: true })
  skillDraftOverlay = null
}

function ensureEventDraftSelection(stage: Container): void {
  if (classSelectOverlay) return
  if (starterGuideOverlay) return
  if (skillDraftOverlay) return
  if (eventDraftOverlay) return

  const hasPendingDraft = !!(pendingEventDraft && pendingEventDraft.day === currentDay)
  if (!hasPendingDraft) {
    const plan = getDailyPlanRow(currentDay)
    const shouldEvent = (Number(plan?.shouldEvent) || 0) >= 0.5
    if (!shouldEvent) {
      pendingEventDraft = null
      closeEventDraftOverlay()
      return
    }
    if (draftedEventDays.includes(currentDay)) return
  }

  let draft = pendingEventDraft
  if (!draft || draft.day !== currentDay) {
    const choices = pickRandomEventDraftChoices(currentDay)
    if (choices.length <= 0) {
      draftedEventDays = Array.from(new Set([...draftedEventDays, currentDay])).sort((a, b) => a - b)
      saveShopStateToStorage(captureShopState())
      return
    }
    draft = { day: currentDay, choices: choices.slice(0, 2), rerolled: false }
    pendingEventDraft = draft
  }

  setTransitionInputEnabled(false)
  clearSelection()

  const overlay = new Container()
  overlay.zIndex = 3520
  overlay.eventMode = 'static'
  overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

  const bg = new Graphics()
  bg.rect(0, 0, CANVAS_W, CANVAS_H)
  bg.fill({ color: 0x070d1d, alpha: 0.92 })
  overlay.addChild(bg)

  const title = new Text({
    text: '事件选择',
    style: { fontSize: 42, fill: 0xfff2cf, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  title.anchor.set(0.5)
  title.x = CANVAS_W / 2
  title.y = 228
  overlay.addChild(title)

  const goldInfo = new Text({
    text: '',
    style: { fontSize: 30, fill: 0xffd86b, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  goldInfo.anchor.set(0.5)
  goldInfo.x = CANVAS_W / 2
  goldInfo.y = 390
  goldInfo.visible = false
  overlay.addChild(goldInfo)

  const shownChoices = draft.choices.slice(0, 2)
  let selectedEventId: string | null = null
  const selectedFrameById = new Map<string, Graphics>()
  const descTextById = new Map<string, Text>()
  const confirmAreaById = new Map<string, Container>()
  const cardW = 238
  const cardH = 470
  const gapX = shownChoices.length === 2 ? 50 : 16
  const totalW = cardW * shownChoices.length + gapX * Math.max(0, shownChoices.length - 1)
  const cardX = (CANVAS_W - totalW) / 2
  const cardY = 580

  const commitEventPick = (event: EventChoice): void => {
    markEventSelected(event.id)
    draftedEventDays = Array.from(new Set([...draftedEventDays, draft!.day])).sort((a, b) => a - b)
    pendingEventDraft = null
    closeEventDraftOverlay()
    setBaseShopPrimaryButtonsVisible(true)
    applyEventEffect(event, false)
    setTransitionInputEnabled(true)
    applyPhaseInputLock()
    refreshShopUI()
    saveShopStateToStorage(captureShopState())
  }

  const applyEventSelection = (eventId: string): void => {
    selectedEventId = eventId
    for (const choice of shownChoices) {
      const selected = choice.id === selectedEventId
      const frame = selectedFrameById.get(choice.id)
      if (frame) frame.visible = selected
      const desc = descTextById.get(choice.id)
      if (desc) desc.text = resolveEventDescText(choice, selected || !shouldShowSimpleDescriptions())
      const confirm = confirmAreaById.get(choice.id)
      if (confirm) confirm.visible = selected
    }
  }

  shownChoices.forEach((choice, idx) => {
    const con = new Container()
    con.x = cardX + idx * (cardW + gapX)
    con.y = cardY
    con.eventMode = 'static'
    con.cursor = 'pointer'
    con.hitArea = new Rectangle(0, 0, cardW, cardH)

    const border = new Graphics()
    border.roundRect(0, 0, cardW, cardH, 24)
    border.fill({ color: 0x18263e, alpha: 0.96 })
    border.stroke({ color: 0x7cc6ff, width: 3, alpha: 1 })
    con.addChild(border)

    const selectedFrame = new Graphics()
    selectedFrame.roundRect(3, 3, cardW - 6, cardH - 6, 22)
    selectedFrame.stroke({ color: 0xffe28a, width: 5, alpha: 1 })
    selectedFrame.visible = false
    con.addChild(selectedFrame)
    selectedFrameById.set(choice.id, selectedFrame)

    const iconText = new Text({
      text: choice.id.replace('event', 'E'),
      style: { fontSize: 36, fill: 0xf5f8ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    iconText.anchor.set(0.5)
    iconText.x = cardW / 2
    iconText.y = 108
    con.addChild(iconText)
    mountEventIconSprite(con, choice.id, choice.icon, cardW / 2, 108, 160, iconText)

    const detail = new Text({
      text: resolveEventDescText(choice, !shouldShowSimpleDescriptions()),
      style: {
        fontSize: 24,
        fill: 0xffefc8,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: cardW - 28,
        lineHeight: 32,
        align: 'center',
      },
    })
    detail.anchor.set(0.5, 0)
    detail.x = cardW / 2
    detail.y = 216
    con.addChild(detail)
    descTextById.set(choice.id, detail)

    const confirmArea = new Container()
    confirmArea.visible = false
    const pickBtnTxt = new Text({
      text: '点击选择',
      style: { fontSize: 28, fill: 0x8fe6b2, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    pickBtnTxt.anchor.set(0.5)
    pickBtnTxt.x = cardW / 2
    pickBtnTxt.y = cardH - 46
    confirmArea.addChild(pickBtnTxt)
    con.addChild(confirmArea)
    confirmAreaById.set(choice.id, confirmArea)

    con.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      if (selectedEventId === choice.id) commitEventPick(choice)
      else applyEventSelection(choice.id)
    })

    overlay.addChild(con)
  })

  const actionBtnW = 186
  const actionBtnH = 96
  const actionBtnGap = 18
  const actionBtnFontSize = 22
  const actionBtnStartX = Math.round((CANVAS_W - (actionBtnW * 3 + actionBtnGap * 2)) / 2)
  const actionBtnY = CANVAS_H - 146
  goldInfo.y = actionBtnY - 140

  const rerollBtn = new Container()
  rerollBtn.eventMode = 'static'
  rerollBtn.cursor = 'pointer'
  rerollBtn.x = actionBtnStartX + actionBtnW + actionBtnGap
  rerollBtn.y = actionBtnY
  const rerollBg = new Graphics()
  const rerollText = new Text({
    text: '',
    style: { fontSize: actionBtnFontSize, fill: 0x10213a, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  rerollText.anchor.set(0.5)
  rerollBtn.addChild(rerollBg, rerollText)
  overlay.addChild(rerollBtn)

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
    setBaseShopPrimaryButtonsVisible(false)
    title.visible = !holding
    bg.alpha = holding ? 0.16 : 0.92
    for (const c of overlay.children) {
      if (c === bg || c === holdBtn) continue
      c.visible = !holding
    }
    if (!holding) {
      goldInfo.visible = false
      forceLeaveBtn.visible = false
      redrawOverlayStatus()
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

  const forceLeaveBtn = new Container()
  forceLeaveBtn.eventMode = 'static'
  forceLeaveBtn.cursor = 'pointer'
  forceLeaveBtn.x = actionBtnStartX + (actionBtnW + actionBtnGap) * 2
  forceLeaveBtn.y = actionBtnY
  const forceLeaveBg = new Graphics()
  forceLeaveBg.roundRect(0, 0, actionBtnW, actionBtnH, 20)
  forceLeaveBg.fill({ color: 0x4d6f99, alpha: 0.95 })
  forceLeaveBg.stroke({ color: 0xa5cfff, width: 3, alpha: 0.95 })
  const forceLeaveText = new Text({
    text: '强行离开',
    style: { fontSize: actionBtnFontSize, fill: 0xeaf4ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  forceLeaveText.anchor.set(0.5)
  forceLeaveText.x = actionBtnW / 2
  forceLeaveText.y = actionBtnH / 2
  forceLeaveBtn.addChild(forceLeaveBg, forceLeaveText)
  forceLeaveBtn.visible = false
  overlay.addChild(forceLeaveBtn)

  let forceLeaveConfirmLayer: Container | null = null
  const closeForceLeaveConfirm = () => {
    if (!forceLeaveConfirmLayer) return
    if (forceLeaveConfirmLayer.parent) forceLeaveConfirmLayer.parent.removeChild(forceLeaveConfirmLayer)
    forceLeaveConfirmLayer.destroy({ children: true })
    forceLeaveConfirmLayer = null
  }
  const openForceLeaveConfirm = () => {
    closeForceLeaveConfirm()
    const layer = new Container()
    layer.zIndex = 3530
    layer.eventMode = 'static'
    layer.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

    const dim = new Graphics()
    dim.rect(0, 0, CANVAS_W, CANVAS_H)
    dim.fill({ color: 0x000000, alpha: 0.45 })
    layer.addChild(dim)

    const panel = new Container()
    panel.x = CANVAS_W / 2
    panel.y = CANVAS_H / 2
    panel.eventMode = 'static'
    panel.on('pointerdown', (e) => e.stopPropagation())
    const pbg = new Graphics()
    pbg.roundRect(-250, -130, 500, 260, 24)
    pbg.fill({ color: 0x13213a, alpha: 0.98 })
    pbg.stroke({ color: 0x9ec2ff, width: 3, alpha: 0.95 })
    panel.addChild(pbg)

    const msg = new Text({
      text: '是否不进行任何选择就离开？',
      style: { fontSize: 30, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    msg.anchor.set(0.5)
    msg.y = -42
    panel.addChild(msg)

    const cancelBtn = new Container()
    cancelBtn.x = -120
    cancelBtn.y = 54
    cancelBtn.eventMode = 'static'
    cancelBtn.cursor = 'pointer'
    const cancelBg = new Graphics()
    cancelBg.roundRect(-100, -34, 200, 68, 16)
    cancelBg.fill({ color: 0x4d6f99, alpha: 0.96 })
    cancelBg.stroke({ color: 0xa5cfff, width: 3, alpha: 0.95 })
    const cancelText = new Text({ text: '取消', style: { fontSize: 28, fill: 0xeaf4ff, fontFamily: 'Arial', fontWeight: 'bold' } })
    cancelText.anchor.set(0.5)
    cancelBtn.addChild(cancelBg, cancelText)
    cancelBtn.on('pointerdown', (e) => {
      e.stopPropagation()
      closeForceLeaveConfirm()
    })
    panel.addChild(cancelBtn)

    const okBtn = new Container()
    okBtn.x = 120
    okBtn.y = 54
    okBtn.eventMode = 'static'
    okBtn.cursor = 'pointer'
    const okBg = new Graphics()
    okBg.roundRect(-100, -34, 200, 68, 16)
    okBg.fill({ color: 0xffd86b, alpha: 0.96 })
    okBg.stroke({ color: 0xffefad, width: 3, alpha: 0.95 })
    const okText = new Text({ text: '确认离开', style: { fontSize: 28, fill: 0x10213a, fontFamily: 'Arial', fontWeight: 'bold' } })
    okText.anchor.set(0.5)
    okBtn.addChild(okBg, okText)
    okBtn.on('pointerdown', (e) => {
      e.stopPropagation()
      draftedEventDays = Array.from(new Set([...draftedEventDays, draft!.day])).sort((a, b) => a - b)
      pendingEventDraft = null
      closeForceLeaveConfirm()
      closeEventDraftOverlay()
      setBaseShopPrimaryButtonsVisible(true)
      setTransitionInputEnabled(true)
      applyPhaseInputLock()
      refreshShopUI()
      saveShopStateToStorage(captureShopState())
    })
    panel.addChild(okBtn)

    layer.addChild(panel)
    layer.on('pointerdown', () => closeForceLeaveConfirm())
    overlay.addChild(layer)
    forceLeaveConfirmLayer = layer
  }
  forceLeaveBtn.on('pointerdown', (e) => {
    e.stopPropagation()
    openForceLeaveConfirm()
  })

  const redrawRerollBtn = () => {
    const canReroll = isEventDraftRerollEnabled() && !(draft?.rerolled === true)
    const can = canReroll
    rerollBg.clear()
    rerollBg.roundRect(0, 0, actionBtnW, actionBtnH, 20)
    rerollBg.fill({ color: can ? 0xffd86b : 0x8a6e4b, alpha: 0.95 })
    rerollBg.stroke({ color: can ? 0xffefad : 0xb89d78, width: 3, alpha: 0.95 })
    rerollText.style.fill = can ? 0x10213a : 0xd7c4a8
    rerollBtn.visible = canReroll
    rerollText.text = '刷新'
    rerollText.x = actionBtnW / 2
    rerollText.y = actionBtnH / 2
  }

  const redrawGoldInfo = () => {
    goldInfo.text = `当前持有金币：${Math.max(0, Math.round(shopManager?.gold ?? 0))}`
  }

  const redrawOverlayStatus = () => {
    redrawGoldInfo()
    redrawRerollBtn()
  }
  void redrawRerollBtn

  rerollBtn.on('pointerdown', (e: FederatedPointerEvent) => {
    e.stopPropagation()
    if (!isEventDraftRerollEnabled()) return
    if (draft?.rerolled === true) return
    const blocked = new Set(shownChoices.map((it) => it.id))
    const nextChoices = pickRandomEventDraftChoicesNoOverlap(currentDay, blocked)
    if (nextChoices.length < 2) {
      showHintToast('no_gold_refresh', '可刷新候选不足', 0xff8f8f)
      return
    }
    pendingEventDraft = { day: currentDay, choices: nextChoices, rerolled: true }
    closeEventDraftOverlay()
    refreshShopUI()
    saveShopStateToStorage(captureShopState())
    ensureEventDraftSelection(stage)
  })

  redrawOverlayStatus()

  stage.addChild(overlay)
  eventDraftOverlay = overlay
}

function findPoolCandidateBySpecialOffer(offer: SpecialShopOffer): PoolCandidate | null {
  return findCandidateByOffer({ itemId: offer.itemId, tier: offer.tier, star: offer.star, price: offer.price })
}

function resolveTierSeriesTextByStar(item: ItemDef, tier: TierKey, star: 1 | 2, series: string): string {
  const parts = series.split(/[\/|]/).map((v) => v.trim()).filter(Boolean)
  if (parts.length <= 0) return series
  const tiers = parseAvailableTiers(item.available_tiers)
  const base = Math.max(0, tiers.indexOf(tier))
  const idx = Math.max(0, Math.min(parts.length - 1, base + (star - 1)))
  const resolved = parts[idx] ?? series
  const trimmed = String(series).trim()
  if (/^[+\-]/.test(trimmed) && !/^[+\-]/.test(resolved)) {
    const sign = trimmed.startsWith('-') ? '-' : '+'
    return `${sign}${resolved}`
  }
  return resolved
}

function resolveSkillLineByTierStar(item: ItemDef, tier: TierKey, star: 1 | 2, line: string): string {
  return line.replace(/([+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)+)/g, (raw) => resolveTierSeriesTextByStar(item, tier, star, raw))
}

function getSpecialShopSimpleDesc(item: ItemDef, tier: TierKey, star: 1 | 2): string {
  const fromSimple = String(item.simple_desc ?? '').trim()
  if (fromSimple) return fromSimple
  const fromTiered = String(item.simple_desc_tiered ?? '').trim()
  if (fromTiered) {
    const parts = fromTiered.split('|').map((v) => v.trim()).filter(Boolean)
    if (parts.length > 0) {
      const levelIdx = Math.max(0, Math.min(parts.length - 1, tierStarLevelIndex(tier, star)))
      return parts[levelIdx] ?? parts[0]!
    }
  }
  const first = (item.skills ?? []).map((s) => String(s.cn ?? '').trim()).find(Boolean)
  if (!first) return '(暂无描述)'
  return resolveSkillLineByTierStar(item, tier, star, first)
}

function getSpecialShopDetailDesc(item: ItemDef, tier: TierKey, star: 1 | 2): string {
  const fromTiered = String(item.simple_desc_tiered ?? '').trim()
  if (fromTiered) return resolveSkillLineByTierStar(item, tier, star, fromTiered)
  const fromSimple = String(item.simple_desc ?? '').trim()
  if (fromSimple) return fromSimple
  return getSpecialShopSimpleDesc(item, tier, star)
}

function getSpecialShopShownDesc(item: ItemDef, tier: TierKey, star: 1 | 2, detailed: boolean): string {
  if (!shouldShowSimpleDescriptions() || detailed) return getSpecialShopDetailDesc(item, tier, star)
  return getSpecialShopSimpleDesc(item, tier, star)
}

function getSpecialShopSpeedTierText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '无'
  if (ms <= 600) return '极快'
  if (ms <= 1000) return '很快'
  if (ms <= 1500) return '快'
  if (ms <= 2500) return '中等'
  if (ms <= 4000) return '慢'
  return '很慢'
}

function formatSpecialShopCooldownSec(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0.0'
  return (Math.round((ms / 1000) * 10) / 10).toFixed(1)
}

function tierCnFromTier(tier: TierKey): string {
  if (tier === 'Bronze') return '青铜'
  if (tier === 'Silver') return '白银'
  if (tier === 'Gold') return '黄金'
  return '钻石'
}

function tryBuySpecialShopOffer(offerIndex: number): boolean {
  if (!shopManager || !battleSystem || !battleView || !backpackSystem || !backpackView) return false
  const offer = specialShopOffers[offerIndex]
  if (!offer || offer.purchased) return false
  const candidate = findPoolCandidateBySpecialOffer(offer)
  if (!candidate) {
    showHintToast('no_gold_buy', '该商品当前不可购买', 0xff8f8f)
    return false
  }

  if (!canBuyItemUnderFirstPurchaseRule(candidate.item)) {
    showFirstPurchaseRuleHint()
    return false
  }

  const priced = resolveBuyPriceWithSkills(candidate.price)
  if (shopManager.gold < priced.finalPrice) {
    showHintToast('no_gold_buy', `金币不足，需${priced.finalPrice}G`, 0xff8f8f)
    return false
  }

  const size = normalizeSize(candidate.item.size)
  const battleSlot = findFirstBattlePlace(size)
  const backpackSlot = battleSlot ? null : findFirstBackpackPlace(size)
  if (!battleSlot && !backpackSlot) {
    showHintToast('backpack_full_buy', '背包已满，无法购买', 0xff8f8f)
    return false
  }

  shopManager.gold -= priced.finalPrice
  if (consumeSkill15NextBuyDiscountAfterSuccess()) showHintToast('no_gold_buy', '砍价高手触发：本次-1G', 0x8ff0b0)
  const skill30Ready = consumeSkill30BundleAfterSuccess(priced.freeBySkill30)
  if (priced.freeBySkill30) showHintToast('no_gold_buy', '打包购买触发：本次0金币', 0x9be5ff)
  else if (skill30Ready) showHintToast('no_gold_buy', '打包购买就绪：下次购买0金币', 0x9be5ff)

  const id = nextId()
  const visualTier = toVisualTier(candidate.tier, candidate.star)
  if (battleSlot) {
    battleSystem.place(battleSlot.col, battleSlot.row, size, candidate.item.id, id)
    void battleView.addItem(id, candidate.item.id, size, battleSlot.col, battleSlot.row, visualTier).then(() => {
      battleView!.setItemTier(id, visualTier)
      drag?.refreshZone(battleView!)
    })
  } else if (backpackSlot) {
    backpackSystem.place(backpackSlot.col, backpackSlot.row, size, candidate.item.id, id)
    void backpackView.addItem(id, candidate.item.id, size, backpackSlot.col, backpackSlot.row, visualTier).then(() => {
      backpackView!.setItemTier(id, visualTier)
      drag?.refreshZone(backpackView!)
    })
    showHintToast('backpack_full_buy', '上阵区已满，已放入背包', 0xffd48f)
  }

  markShopPurchaseDone()
  offer.purchased = true
  instanceToDefId.set(id, candidate.item.id)
  setInstanceQualityLevel(id, candidate.item.id, parseTierName(candidate.item.starting_tier) ?? 'Bronze', candidate.level)
  instanceToPermanentDamageBonus.set(id, 0)
  recordNeutralItemObtained(candidate.item.id)
  unlockItemToPool(candidate.item.id)
  refreshShopUI()
  return true
}

function openSpecialShopOverlay(stage: Container): void {
  closeSpecialShopOverlay()
  setTransitionInputEnabled(false)
  setBaseShopPrimaryButtonsVisible(false)
  clearSelection()
  let selectedOfferIndex: number | null = null

  const overlay = new Container()
  overlay.zIndex = 3510
  overlay.eventMode = 'static'
  overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

  const bg = new Graphics()
  bg.rect(0, 0, CANVAS_W, CANVAS_H)
  bg.fill({ color: 0x070d1d, alpha: 0.92 })
  overlay.addChild(bg)

  const title = new Text({
    text: '折扣商店',
    style: { fontSize: 42, fill: 0xfff2cf, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  title.anchor.set(0.5)
  title.x = CANVAS_W / 2
  title.y = 150
  overlay.addChild(title)

  const goldInfo = new Text({
    text: '',
    style: { fontSize: 30, fill: 0xffd86b, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  goldInfo.anchor.set(0.5)
  goldInfo.x = CANVAS_W / 2
  goldInfo.y = 390
  goldInfo.visible = false
  overlay.addChild(goldInfo)

  const cardsLayer = new Container()
  cardsLayer.x = 0
  cardsLayer.y = 0
  overlay.addChild(cardsLayer)

  const actionBtnW = 186
  const actionBtnH = 96
  const actionBtnGap = 18
  const actionBtnFontSize = 22
  const actionBtnStartX = Math.round((CANVAS_W - (actionBtnW * 3 + actionBtnGap * 2)) / 2)
  const actionBtnY = CANVAS_H - 146
  goldInfo.y = actionBtnY - 140

  const rerollBtn = new Container()
  rerollBtn.eventMode = 'static'
  rerollBtn.cursor = 'pointer'
  rerollBtn.x = actionBtnStartX + actionBtnW + actionBtnGap
  rerollBtn.y = actionBtnY
  const rerollBg = new Graphics()
  const rerollText = new Text({
    text: '',
    style: { fontSize: actionBtnFontSize, fill: 0x10213a, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  rerollText.anchor.set(0.5)
  rerollBtn.addChild(rerollBg, rerollText)
  overlay.addChild(rerollBtn)

  const closeBtn = new Container()
  closeBtn.eventMode = 'static'
  closeBtn.cursor = 'pointer'
  closeBtn.x = actionBtnStartX + (actionBtnW + actionBtnGap) * 2
  closeBtn.y = actionBtnY
  const closeBg = new Graphics()
  closeBg.roundRect(0, 0, actionBtnW, actionBtnH, 20)
  closeBg.fill({ color: 0x4d6f99, alpha: 0.95 })
  closeBg.stroke({ color: 0xa5cfff, width: 3, alpha: 0.95 })
  const closeText = new Text({
    text: '离开商店',
    style: { fontSize: actionBtnFontSize, fill: 0xeaf4ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  closeText.anchor.set(0.5)
  closeText.x = actionBtnW / 2
  closeText.y = actionBtnH / 2
  closeBtn.addChild(closeBg, closeText)
  overlay.addChild(closeBtn)

  const holdBtn = new Container()
  holdBtn.eventMode = 'static'
  holdBtn.cursor = 'pointer'
  holdBtn.x = actionBtnStartX
  holdBtn.y = actionBtnY
  const holdBg = new Graphics()
  holdBg.roundRect(0, 0, actionBtnW, actionBtnH, 20)
  holdBg.fill({ color: 0x29436e, alpha: 0.94 })
  holdBg.stroke({ color: 0x84b7ff, width: 3, alpha: 0.95 })
  const holdTxt = new Text({
    text: '出售物品',
    style: { fontSize: actionBtnFontSize, fill: 0xeaf4ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  holdTxt.anchor.set(0.5)
  holdTxt.x = actionBtnW / 2
  holdTxt.y = actionBtnH / 2
  holdBtn.addChild(holdBg, holdTxt)

  const setSpecialShopOverlayVisible = (visible: boolean): void => {
    title.visible = visible
    goldInfo.visible = visible
    cardsLayer.visible = visible
    rerollBtn.visible = visible && specialShopRefreshCount < 1
    closeBtn.visible = visible
    bg.alpha = visible ? 0.92 : 0
  }

  const setBackpackViewMode = (active: boolean): void => {
    const bindTapOnly = () => {
      backpackView?.makeItemsInteractive((id, e) => {
        e.stopPropagation()
        handleSpecialShopBackpackItemTap(id, 'backpack')
      })
      battleView?.makeItemsInteractive((id, e) => {
        e.stopPropagation()
        handleSpecialShopBackpackItemTap(id, 'battle')
      })
    }
    const restoreDragInteractive = () => {
      if (!drag) return
      if (backpackView) drag.refreshZone(backpackView)
      if (battleView) drag.refreshZone(battleView)
    }

    setSpecialShopBackpackViewActive(active)
    overlay.eventMode = 'static'
    overlay.hitArea = active
      ? new Rectangle(0, actionBtnY, CANVAS_W, Math.max(1, CANVAS_H - actionBtnY))
      : new Rectangle(0, 0, CANVAS_W, CANVAS_H)
    bg.eventMode = 'none'
    holdTxt.text = active ? '回到折扣商店' : '出售物品'
    holdBg.clear()
    holdBg.roundRect(0, 0, actionBtnW, actionBtnH, 20)
    if (active) {
      holdBg.fill({ color: 0x3b5f96, alpha: 0.94 })
      holdBg.stroke({ color: 0xb4d2ff, width: 3, alpha: 0.95 })
      setSpecialShopOverlayVisible(false)
      setBaseShopPrimaryButtonsVisible(false)
      if (refreshBtnHandle) refreshBtnHandle.container.visible = true
      drag?.setEnabled(false)
      bindTapOnly()
      showHintToast('backpack_full_buy', '已切换到出售物品模式', 0x9be5ff)
    } else {
      holdBg.fill({ color: 0x29436e, alpha: 0.94 })
      holdBg.stroke({ color: 0x84b7ff, width: 3, alpha: 0.95 })
      setSpecialShopOverlayVisible(true)
      setBaseShopPrimaryButtonsVisible(false)
      drag?.setEnabled(false)
      restoreDragInteractive()
    }
    specialShopOverlayActionRefresh?.()
    refreshShopUI()
    saveShopStateToStorage(captureShopState())
  }

  holdBtn.on('pointerdown', (e: FederatedPointerEvent) => {
    e.stopPropagation()
    setBackpackViewMode(!specialShopBackpackViewActive)
  })
  overlay.addChild(holdBtn)

  const redrawRerollBtn = () => {
    if (specialShopBackpackViewActive) {
      rerollBtn.visible = true
      closeBtn.visible = false
      rerollBg.clear()
      rerollBg.roundRect(0, 0, actionBtnW, actionBtnH, 20)
      rerollBg.fill({ color: 0x9a3a3a, alpha: 0.95 })
      rerollBg.stroke({ color: 0xffb1b1, width: 3, alpha: 0.95 })
      rerollText.style.fill = 0xffe8e8
      rerollText.text = specialShopCheckedInstanceIds.size > 0
        ? `出售\n💰 ${getSpecialBulkSellTotalPrice()}`
        : '点击物品出售'
      rerollText.x = actionBtnW / 2
      rerollText.y = actionBtnH / 2
      return
    }
    const canReroll = specialShopRefreshCount < 1
    const cost = getSpecialShopRefreshCost()
    const canAfford = (shopManager?.gold ?? 0) >= cost
    const can = canReroll && canAfford
    rerollBtn.visible = canReroll
    rerollBg.clear()
    rerollBg.roundRect(0, 0, actionBtnW, actionBtnH, 20)
    rerollBg.fill({ color: can ? 0xffd86b : 0x8a6e4b, alpha: 0.95 })
    rerollBg.stroke({ color: can ? 0xffefad : 0xb89d78, width: 3, alpha: 0.95 })
    rerollText.style.fill = can ? 0x10213a : 0xd7c4a8
    rerollText.text = `刷新  ${cost}G`
    rerollText.x = actionBtnW / 2
    rerollText.y = actionBtnH / 2
  }
  const redrawSpecialShopOverlay = () => {
    redrawGoldInfo()
    redrawCards()
    redrawRerollBtn()
  }
  specialShopOverlayActionRefresh = redrawSpecialShopOverlay

  const redrawGoldInfo = () => {
    goldInfo.text = `当前持有金币：${Math.max(0, Math.round(shopManager?.gold ?? 0))}`
  }

  const redrawCards = () => {
    cardsLayer.removeChildren().forEach((c) => c.destroy({ children: true }))
    const cardW = 188
    const cardH = 580
    const gapX = 14
    const totalW = cardW * 3 + gapX * 2
    const startX = (CANVAS_W - totalW) / 2
    const y = 420

    for (let i = 0; i < 3; i++) {
      const offer = specialShopOffers[i]
      if (!offer) continue
      const candidate = findPoolCandidateBySpecialOffer(offer)
      if (!candidate) continue

      const card = new Container()
      card.x = startX + i * (cardW + gapX)
      card.y = y
      card.eventMode = 'static'
      card.cursor = offer.purchased ? 'default' : 'pointer'
      card.hitArea = new Rectangle(0, 0, cardW, cardH)

      const border = new Graphics()
      border.roundRect(0, 0, cardW, cardH, 24)
      border.fill({ color: 0x18263e, alpha: 0.96 })
      const selected = selectedOfferIndex === i
      border.stroke({ color: offer.purchased ? 0x6d7791 : (selected ? 0xffe28a : 0x7cc6ff), width: selected ? 4 : 3, alpha: 1 })
      card.addChild(border)

      const icon = new Sprite(Texture.WHITE)
      icon.width = 132
      icon.height = 132
      icon.x = (cardW - icon.width) / 2
      icon.y = 20
      icon.alpha = 0
      card.addChild(icon)
      addArchetypeCornerBadge(card, candidate.item, cardW, icon.y)
      void Assets.load<Texture>(getItemIconUrl(candidate.item.id)).then((tex) => {
        icon.texture = tex
        icon.alpha = offer.purchased ? 0.35 : 1
      }).catch(() => {
        // ignore load error in runtime
      })

      const name = new Text({
        text: candidate.item.name_cn,
        style: { fontSize: 26, fill: 0xf5f8ff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      name.anchor.set(0.5, 0)
      name.x = cardW / 2
      name.y = 168
      card.addChild(name)

      const baseTier = parseTierName(candidate.item.starting_tier) ?? 'Bronze'
      const level = tierStarLevelIndex(candidate.tier, candidate.star) + 1

      const tierPill = new Graphics()
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
        text: `${tierCnFromTier(baseTier)}Lv${level}`,
        style: { fontSize: 24, fill: 0xfff4d0, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      tier.anchor.set(0.5)
      tier.x = cardW / 2
      tier.y = tierPill.y + 19
      card.addChild(tier)

      const tierStats = resolveItemTierBaseStats(candidate.item, `${candidate.tier}#${candidate.star}`)
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
      const speedText = cooldownMs > 0
        ? (selected ? `⏱间隔${formatSpecialShopCooldownSec(cooldownMs)}秒` : `⏱速度${getSpecialShopSpeedTierText(cooldownMs)}`)
        : ''

      const ammoLine = (candidate.item.skills ?? [])
        .map((s) => String(s.cn ?? '').trim())
        .find((s) => /弹药\s*[:：]\s*\d+/.test(s))
      const ammo = ammoLine ? ammoValueFromLineByStar(candidate.item, candidate.tier, candidate.star, ammoLine) : 0

      const statEntries: Array<{ text: string; color: number }> = [
        { text: mainStatText, color: mainStatColor },
      ]
      if (speedText) statEntries.push({ text: speedText, color: 0x70b2ff })
      if (ammo > 0) {
        statEntries.push({ text: `◉弹药${ammo}`, color: 0xffd36b })
      }

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

      const desc = new Text({
        text: getSpecialShopShownDesc(candidate.item, candidate.tier, candidate.star, selected),
        style: {
          fontSize: 20,
          fill: selected ? 0xf2f7ff : 0xcad7f5,
          fontFamily: 'Arial',
          wordWrap: true,
          breakWords: true,
          wordWrapWidth: cardW - 24,
          lineHeight: 28,
        },
      })
      desc.x = 12
      desc.y = dividerY + 14
      card.addChild(desc)

      const basePriceY = cardH - 96
      if (selected && !offer.purchased) {
        const buyHint = new Text({
          text: '点击购买',
          style: { fontSize: 22, fill: 0x9be5ff, fontFamily: 'Arial', fontWeight: 'bold' },
        })
        buyHint.anchor.set(0.5)
        buyHint.x = cardW / 2
        buyHint.y = cardH - 30
        card.addChild(buyHint)
      }

      const price = resolveBuyPriceWithSkills(candidate.price).finalPrice
      if (offer.purchased) {
        const priceText = new Text({
          text: '已购买',
          style: {
            fontSize: 32,
            fill: 0x9ba8bf,
            fontFamily: 'Arial',
            fontWeight: 'bold',
          },
        })
      priceText.anchor.set(0.5, 0)
      priceText.x = cardW / 2
      priceText.y = basePriceY
      card.addChild(priceText)
      } else if (offer.price < offer.basePrice) {
        const oldPrice = new Text({
          text: `💰 ${offer.basePrice}`,
          style: {
            fontSize: 22,
            fill: 0x90a0bd,
            fontFamily: 'Arial',
            fontWeight: 'bold',
          },
        })
        oldPrice.anchor.set(0.5, 0)
        oldPrice.x = cardW / 2
        oldPrice.y = basePriceY - 30
        card.addChild(oldPrice)

        const strike = new Graphics()
        strike.moveTo(oldPrice.x - oldPrice.width / 2 + 2, oldPrice.y + oldPrice.height / 2)
        strike.lineTo(oldPrice.x + oldPrice.width / 2 - 2, oldPrice.y + oldPrice.height / 2)
        strike.stroke({ color: 0x90a0bd, width: 3, alpha: 0.95 })
        card.addChild(strike)

        const newPrice = new Text({
          text: `💰 ${price}`,
          style: {
            fontSize: 32,
            fill: (shopManager?.gold ?? 0) >= price ? 0xffd86b : 0xff7a7a,
            fontFamily: 'Arial',
            fontWeight: 'bold',
          },
        })
        newPrice.anchor.set(0.5, 0)
        newPrice.x = cardW / 2
        newPrice.y = basePriceY
        card.addChild(newPrice)
      } else {
        const priceText = new Text({
          text: `💰 ${price}`,
          style: {
            fontSize: 32,
            fill: (shopManager?.gold ?? 0) >= price ? 0xffd86b : 0xff7a7a,
            fontFamily: 'Arial',
            fontWeight: 'bold',
          },
        })
        priceText.anchor.set(0.5, 0)
        priceText.x = cardW / 2
        priceText.y = basePriceY
        card.addChild(priceText)
      }

      card.on('pointerdown', (e) => {
        e.stopPropagation()
        if (offer.purchased) return
        if (selectedOfferIndex !== i) {
          selectedOfferIndex = i
          redrawCards()
          return
        }
        if (!tryBuySpecialShopOffer(i)) {
          redrawSpecialShopOverlay()
          return
        }
        selectedOfferIndex = null
        redrawSpecialShopOverlay()
        saveShopStateToStorage(captureShopState())
      })

      cardsLayer.addChild(card)
    }
  }

  rerollBtn.on('pointerdown', (e) => {
    e.stopPropagation()
    if (!shopManager) return
    if (specialShopBackpackViewActive) {
      executeSpecialShopBulkSell()
      return
    }
    if (specialShopRefreshCount >= 1) return
    const cost = getSpecialShopRefreshCost()
    if (shopManager.gold < cost) {
      showHintToast('no_gold_refresh', `金币不足，需${cost}G`, 0xff8f8f)
      return
    }
    const next = rollSpecialShopOffers(specialShopOffers)
    if (next.length < 3) {
      showHintToast('no_gold_refresh', '无可用刷新池', 0xff8f8f)
      return
    }
    shopManager.gold -= cost
    specialShopRefreshCount += 1
    specialShopOffers = next
    selectedOfferIndex = null
    redrawSpecialShopOverlay()
    refreshShopUI()
    saveShopStateToStorage(captureShopState())
  })

  closeBtn.on('pointerdown', (e) => {
    e.stopPropagation()
    draftedSpecialShopDays = Array.from(new Set([...draftedSpecialShopDays, currentDay])).sort((a, b) => a - b)
    closeSpecialShopOverlay()
    setBaseShopPrimaryButtonsVisible(true)
    setTransitionInputEnabled(true)
    applyPhaseInputLock()
    refreshShopUI()
    saveShopStateToStorage(captureShopState())
  })

  redrawSpecialShopOverlay()
  stage.addChild(overlay)
  specialShopOverlay = overlay
}

function ensureSpecialShopSelection(stage: Container): void {
  if (classSelectOverlay) return
  if (starterGuideOverlay) return
  if (skillDraftOverlay || eventDraftOverlay || specialShopOverlay) return
  if (!isSpecialShopPlannedForDay(currentDay)) {
    specialShopRefreshCount = 0
    specialShopOffers = []
    return
  }
  if (draftedSpecialShopDays.includes(currentDay)) return
  if (specialShopOffers.length !== 3) {
    specialShopRefreshCount = 0
    specialShopOffers = rollSpecialShopOffers()
  }
  if (specialShopOffers.length !== 3) {
    draftedSpecialShopDays = Array.from(new Set([...draftedSpecialShopDays, currentDay])).sort((a, b) => a - b)
    return
  }
  normalizeSpecialShopOfferPrices()
  openSpecialShopOverlay(stage)
}
void ensureSpecialShopSelection

function ensureDailyChoiceSelection(stage: Container): void {
  if (classSelectOverlay) return
  if (starterGuideOverlay) return
  if (skillDraftOverlay || eventDraftOverlay || specialShopOverlay) return
  const hasPendingSkillDraft = !!(pendingSkillDraft && pendingSkillDraft.day === currentDay)
  if (hasPendingSkillDraft) {
    ensureSkillDraftSelection(stage)
    return
  }
  const hasPendingEventDraft = !!(pendingEventDraft && pendingEventDraft.day === currentDay)
  if (hasPendingEventDraft) {
    ensureEventDraftSelection(stage)
    return
  }
}
void ensureDailyChoiceSelection

function ensureSkillDraftSelection(stage: Container): void {
  if (!SKILL_DRAFT_ENABLED) {
    pendingSkillDraft = null
    closeSkillDraftOverlay()
    return
  }
  if (classSelectOverlay) return
  if (starterGuideOverlay) return
  if (skillDraftOverlay) return
  const skillCfg = getConfig().skillSystem
  if (!skillCfg) return

  let draft = pendingSkillDraft
  if (!draft) {
    const tier = getSkillTierForDay(currentDay)
    if (!tier) return
    if (draftedSkillDays.includes(currentDay)) return
    const choices = pickSkillChoices(tier, currentDay)
    if (choices.length <= 0) return
    draft = { day: currentDay, tier, choices, rerolled: false }
    pendingSkillDraft = draft
  }

  if (draft.choices.length <= 0) return

  setTransitionInputEnabled(false)
  setBaseShopPrimaryButtonsVisible(false)
  clearSelection()

  const overlay = new Container()
  overlay.zIndex = 3500
  overlay.eventMode = 'static'
  overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

  const bg = new Graphics()
  bg.rect(0, 0, CANVAS_W, CANVAS_H)
  bg.fill({ color: 0x070d1d, alpha: 0.92 })
  overlay.addChild(bg)

  const title = new Text({
    text: '技能选择',
    style: { fontSize: 42, fill: 0xfff2cf, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  title.anchor.set(0.5)
  title.x = CANVAS_W / 2
  title.y = 228
  overlay.addChild(title)

  const goldInfo = new Text({
    text: '',
    style: { fontSize: 30, fill: 0xffd86b, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  goldInfo.anchor.set(0.5)
  goldInfo.x = CANVAS_W / 2
  goldInfo.y = 390
  goldInfo.visible = false
  overlay.addChild(goldInfo)

  const shownChoices = draft.choices.slice(0, 2)
  let selectedSkillId: string | null = null
  const selectedFrameById = new Map<string, Graphics>()
  const descTextById = new Map<string, Text>()
  const confirmAreaById = new Map<string, Container>()
  const cardW = 238
  const cardH = 470
  const gapX = shownChoices.length === 2 ? 50 : 16
  const totalW = cardW * shownChoices.length + gapX * Math.max(0, shownChoices.length - 1)
  const cardX = (CANVAS_W - totalW) / 2
  const cardY = 580

  const commitDraftSkillPick = (skillId: string): void => {
    upsertPickedSkill(skillId)
    draftedSkillDays = Array.from(new Set([...draftedSkillDays, draft!.day])).sort((a, b) => a - b)
    pendingSkillDraft = null
    closeSkillDraftOverlay()
    refreshSkillIconBar()
    setBaseShopPrimaryButtonsVisible(true)
    setTransitionInputEnabled(true)
    applyPhaseInputLock()
    refreshShopUI()
    saveShopStateToStorage(captureShopState())
  }

  const applyDraftSelection = (skillId: string): void => {
    selectedSkillId = skillId
    for (const choice of shownChoices) {
      const selected = choice.id === selectedSkillId
      const frame = selectedFrameById.get(choice.id)
      if (frame) frame.visible = selected
      const desc = descTextById.get(choice.id)
      if (desc) desc.text = selected || !shouldShowSimpleDescriptions() ? (choice.detailDesc ?? choice.desc) : choice.desc
      const confirmArea = confirmAreaById.get(choice.id)
      if (confirmArea) confirmArea.visible = selected
    }
  }

  shownChoices.forEach((choice, idx) => {
    const con = new Container()
    con.x = cardX + idx * (cardW + gapX)
    con.y = cardY
    con.eventMode = 'static'
    con.cursor = 'pointer'
    con.hitArea = new Rectangle(0, 0, cardW, cardH)

    const border = new Graphics()
    border.roundRect(0, 0, cardW, cardH, 24)
    border.fill({ color: 0x18263e, alpha: 0.96 })
    border.stroke({ color: skillTierColor(choice.tier), width: 3, alpha: 1 })
    con.addChild(border)

    const selectedFrame = new Graphics()
    selectedFrame.roundRect(3, 3, cardW - 6, cardH - 6, 22)
    selectedFrame.stroke({ color: 0xffe28a, width: 5, alpha: 1 })
    selectedFrame.visible = false
    con.addChild(selectedFrame)
    selectedFrameById.set(choice.id, selectedFrame)

    const iconText = new Text({
      text: choice.name.slice(0, 1),
      style: { fontSize: 54, fill: 0xf5f8ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    iconText.anchor.set(0.5)
    iconText.x = cardW / 2
    iconText.y = 108
    con.addChild(iconText)
    mountSkillIconSprite(con, choice.id, choice.icon, cardW / 2, 108, 160, iconText)

    const name = new Text({
      text: choice.name,
      style: {
        fontSize: 30,
        fill: 0xf5e7bf,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        wordWrap: true,
        wordWrapWidth: cardW - 30,
        breakWords: true,
      },
    })
    name.anchor.set(0.5, 0)
    name.x = cardW / 2
    name.y = 184
    con.addChild(name)

    const qualityText = new Text({
      text: skillTierLabelCn(choice.tier),
      style: {
        fontSize: 20,
        fill: 0xfff3cf,
        fontFamily: 'Arial',
        fontWeight: 'bold',
      },
    })
    qualityText.anchor.set(0.5, 0)
    qualityText.x = cardW / 2
    qualityText.y = 246
    const qualityPadX = 10
    const qualityPadY = 4
    const qualityBg = new Graphics()
    qualityBg.roundRect(
      qualityText.x - qualityText.width / 2 - qualityPadX,
      qualityText.y - qualityPadY,
      qualityText.width + qualityPadX * 2,
      qualityText.height + qualityPadY * 2,
      8,
    )
    qualityBg.fill({ color: skillTierColor(choice.tier), alpha: 0.45 })
    qualityBg.stroke({ color: 0xe8f0ff, width: 1, alpha: 0.6 })
    con.addChild(qualityBg)
    con.addChild(qualityText)

    const desc = new Text({
      text: shouldShowSimpleDescriptions() ? choice.desc : (choice.detailDesc ?? choice.desc),
      style: {
        fontSize: 22,
        fill: 0xd4def1,
        fontFamily: 'Arial',
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: cardW - 28,
        lineHeight: 29,
      },
    })
    desc.x = 14
    desc.y = 308
    con.addChild(desc)
    descTextById.set(choice.id, desc)

    const confirmArea = new Container()
    confirmArea.eventMode = 'none'
    confirmArea.visible = false
    const confirmAreaText = new Text({
      text: '点击选择',
      style: { fontSize: 22, fill: 0xdce6ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    confirmAreaText.anchor.set(0.5)
    confirmAreaText.x = cardW / 2
    confirmAreaText.y = cardH - 42
    confirmArea.addChild(confirmAreaText)
    con.addChild(confirmArea)
    confirmAreaById.set(choice.id, confirmArea)

    con.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      if (selectedSkillId === choice.id) {
        commitDraftSkillPick(choice.id)
        return
      }
      applyDraftSelection(choice.id)
    })

    overlay.addChild(con)
  })

  const actionBtnW = 186
  const actionBtnH = 96
  const actionBtnGap = 18
  const actionBtnFontSize = 22
  const actionBtnStartX = Math.round((CANVAS_W - (actionBtnW * 3 + actionBtnGap * 2)) / 2)
  const actionBtnY = CANVAS_H - 146
  goldInfo.y = actionBtnY - 140

  const rerollBtn = new Container()
  rerollBtn.eventMode = 'static'
  rerollBtn.cursor = 'pointer'
  rerollBtn.x = actionBtnStartX + actionBtnW + actionBtnGap
  rerollBtn.y = actionBtnY
  const rerollBg = new Graphics()
  const rerollText = new Text({
    text: '',
    style: { fontSize: actionBtnFontSize, fill: 0x10213a, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  rerollText.anchor.set(0.5)
  rerollBtn.addChild(rerollBg, rerollText)
  overlay.addChild(rerollBtn)

  const holdBtn = new Container()
  holdBtn.eventMode = 'static'
  holdBtn.cursor = 'pointer'
  holdBtn.x = actionBtnStartX
  holdBtn.y = actionBtnY
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
    setBaseShopPrimaryButtonsVisible(false)
    title.visible = !holding
    bg.alpha = holding ? 0.16 : 0.92
    for (const child of overlay.children) {
      if (child === bg || child === holdBtn) continue
      child.visible = !holding
    }
    if (!holding) {
      goldInfo.visible = false
      forceLeaveBtn.visible = false
      redrawOverlayStatus()
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

  const forceLeaveBtn = new Container()
  forceLeaveBtn.eventMode = 'static'
  forceLeaveBtn.cursor = 'pointer'
  forceLeaveBtn.x = actionBtnStartX + (actionBtnW + actionBtnGap) * 2
  forceLeaveBtn.y = actionBtnY
  const forceLeaveBg = new Graphics()
  forceLeaveBg.roundRect(0, 0, actionBtnW, actionBtnH, 20)
  forceLeaveBg.fill({ color: 0x4d6f99, alpha: 0.95 })
  forceLeaveBg.stroke({ color: 0xa5cfff, width: 3, alpha: 0.95 })
  const forceLeaveText = new Text({
    text: '强行离开',
    style: { fontSize: actionBtnFontSize, fill: 0xeaf4ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  forceLeaveText.anchor.set(0.5)
  forceLeaveText.x = actionBtnW / 2
  forceLeaveText.y = actionBtnH / 2
  forceLeaveBtn.addChild(forceLeaveBg, forceLeaveText)
  forceLeaveBtn.visible = false
  overlay.addChild(forceLeaveBtn)

  let forceLeaveConfirmLayer: Container | null = null
  const closeForceLeaveConfirm = () => {
    if (!forceLeaveConfirmLayer) return
    if (forceLeaveConfirmLayer.parent) forceLeaveConfirmLayer.parent.removeChild(forceLeaveConfirmLayer)
    forceLeaveConfirmLayer.destroy({ children: true })
    forceLeaveConfirmLayer = null
  }
  const openForceLeaveConfirm = () => {
    closeForceLeaveConfirm()
    const layer = new Container()
    layer.zIndex = 3510
    layer.eventMode = 'static'
    layer.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

    const dim = new Graphics()
    dim.rect(0, 0, CANVAS_W, CANVAS_H)
    dim.fill({ color: 0x000000, alpha: 0.45 })
    layer.addChild(dim)

    const panel = new Container()
    panel.x = CANVAS_W / 2
    panel.y = CANVAS_H / 2
    panel.eventMode = 'static'
    panel.on('pointerdown', (e) => e.stopPropagation())
    const pbg = new Graphics()
    pbg.roundRect(-250, -130, 500, 260, 24)
    pbg.fill({ color: 0x13213a, alpha: 0.98 })
    pbg.stroke({ color: 0x9ec2ff, width: 3, alpha: 0.95 })
    panel.addChild(pbg)

    const msg = new Text({
      text: '是否不进行任何选择就离开？',
      style: { fontSize: 30, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    msg.anchor.set(0.5)
    msg.y = -42
    panel.addChild(msg)

    const cancelBtn = new Container()
    cancelBtn.x = -120
    cancelBtn.y = 54
    cancelBtn.eventMode = 'static'
    cancelBtn.cursor = 'pointer'
    const cancelBg = new Graphics()
    cancelBg.roundRect(-100, -34, 200, 68, 16)
    cancelBg.fill({ color: 0x4d6f99, alpha: 0.96 })
    cancelBg.stroke({ color: 0xa5cfff, width: 3, alpha: 0.95 })
    const cancelText = new Text({ text: '取消', style: { fontSize: 28, fill: 0xeaf4ff, fontFamily: 'Arial', fontWeight: 'bold' } })
    cancelText.anchor.set(0.5)
    cancelBtn.addChild(cancelBg, cancelText)
    cancelBtn.on('pointerdown', (e) => {
      e.stopPropagation()
      closeForceLeaveConfirm()
    })
    panel.addChild(cancelBtn)

    const okBtn = new Container()
    okBtn.x = 120
    okBtn.y = 54
    okBtn.eventMode = 'static'
    okBtn.cursor = 'pointer'
    const okBg = new Graphics()
    okBg.roundRect(-100, -34, 200, 68, 16)
    okBg.fill({ color: 0xffd86b, alpha: 0.96 })
    okBg.stroke({ color: 0xffefad, width: 3, alpha: 0.95 })
    const okText = new Text({ text: '确认离开', style: { fontSize: 28, fill: 0x10213a, fontFamily: 'Arial', fontWeight: 'bold' } })
    okText.anchor.set(0.5)
    okBtn.addChild(okBg, okText)
    okBtn.on('pointerdown', (e) => {
      e.stopPropagation()
      draftedSkillDays = Array.from(new Set([...draftedSkillDays, draft!.day])).sort((a, b) => a - b)
      pendingSkillDraft = null
      closeForceLeaveConfirm()
      closeSkillDraftOverlay()
      setBaseShopPrimaryButtonsVisible(true)
      setTransitionInputEnabled(true)
      applyPhaseInputLock()
      refreshShopUI()
      saveShopStateToStorage(captureShopState())
    })
    panel.addChild(okBtn)

    layer.addChild(panel)
    layer.on('pointerdown', () => closeForceLeaveConfirm())
    overlay.addChild(layer)
    forceLeaveConfirmLayer = layer
  }
  forceLeaveBtn.on('pointerdown', (e) => {
    e.stopPropagation()
    openForceLeaveConfirm()
  })

  const redrawRerollBtn = () => {
    const canReroll = isSkillDraftRerollEnabled() && !(draft?.rerolled === true)
    const can = canReroll
    rerollBg.clear()
    rerollBg.roundRect(0, 0, actionBtnW, actionBtnH, 20)
    rerollBg.fill({ color: can ? 0xffd86b : 0x8a6e4b, alpha: 0.95 })
    rerollBg.stroke({ color: can ? 0xffefad : 0xb89d78, width: 3, alpha: 0.95 })
    rerollText.style.fill = can ? 0x10213a : 0xd7c4a8
    rerollBtn.visible = canReroll
    rerollText.text = '刷新'
    rerollText.x = actionBtnW / 2
    rerollText.y = actionBtnH / 2
  }

  const redrawGoldInfo = () => {
    goldInfo.text = `当前持有金币：${Math.max(0, Math.round(shopManager?.gold ?? 0))}`
  }

  const redrawOverlayStatus = () => {
    redrawGoldInfo()
    redrawRerollBtn()
  }

  rerollBtn.on('pointerdown', (e: FederatedPointerEvent) => {
    e.stopPropagation()
    if (!isSkillDraftRerollEnabled()) return
    if (draft?.rerolled === true) return
    const blocked = new Set(shownChoices.map((it) => it.id))
    const nextChoices = draft?.fixedTier
      ? pickSkillChoicesExactTier(draft.tier, blocked)
      : pickSkillChoicesNoOverlap(draft!.tier, currentDay, blocked)
    if (nextChoices.length < 2) {
      showHintToast('no_gold_refresh', '可刷新候选不足', 0xff8f8f)
      return
    }
    pendingSkillDraft = {
      day: currentDay,
      tier: draft!.tier,
      choices: nextChoices,
      rerolled: true,
      fixedTier: draft?.fixedTier === true,
    }
    closeSkillDraftOverlay()
    refreshShopUI()
    saveShopStateToStorage(captureShopState())
    ensureSkillDraftSelection(stage)
  })

  redrawOverlayStatus()

  skillDraftOverlay = overlay
  stage.addChild(overlay)
}

// ============================================================
// 小地图
// ============================================================
function updateMiniMap(): void {
  if (!miniMapGfx || !backpackSystem) return
  const g = miniMapGfx
  g.clear()
  const rows = backpackSystem.rows
  const cols = backpackView?.activeColCount ?? 6
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x    = c * MINI_CELL
      const y    = r * MINI_CELL
      const free = backpackSystem.canPlace(c, r, '1x1')
      g.rect(x + 1, y + 1, MINI_CELL - 2, MINI_CELL - 2)
      g.fill({ color: free ? 0x2a2a40 : 0xffcc44, alpha: free ? 0.35 : 0.75 })
      g.rect(x, y, MINI_CELL, MINI_CELL)
      g.stroke({ color: 0x555577, width: 1 })
    }
  }
}

function refreshPlayerStatusUI(): void {
  if (!playerStatusCon || !playerStatusLvText || !playerStatusExpBar) return
  const progress = getPlayerProgressState()
  const level = clampPlayerLevel(progress.level)
  const levelCap = getPlayerLevelCap()
  const expNeed = getPlayerExpNeedByLevel(level)
  const exp = level >= levelCap ? 0 : Math.max(0, Math.min(expNeed, Math.round(progress.exp)))

  playerStatusLvText.text = `Lv${level}`

  playerStatusExpBar.clear()
  {
    const areaW = Math.max(8, getDebugCfg('shopPlayerStatusExpBarWidth') - 4)
    const areaH = Math.max(8, getDebugCfg('shopPlayerStatusExpBarHeight') - 4)
    const totalBeans = Math.max(1, expNeed)
    const filledBeans = level >= levelCap ? totalBeans : Math.max(0, Math.min(totalBeans, exp))
    let gap = 3
    const minBeanW = 2
    let beanW = (areaW - gap * (totalBeans - 1)) / totalBeans
    while (gap > 0 && beanW < minBeanW) {
      gap -= 1
      beanW = (areaW - gap * (totalBeans - 1)) / totalBeans
    }
    if (beanW > 0) {
      const radius = Math.min(8, Math.max(2, beanW / 2))
      for (let i = 0; i < totalBeans; i++) {
        const x = i * (beanW + gap)
        playerStatusExpBar.roundRect(x, 0, beanW, areaH, radius)
        playerStatusExpBar.fill({ color: i < filledBeans ? 0x5db5ff : 0x2d3f63, alpha: 0.98 })
      }
    }
  }

  const nextAvatarUrl = getHeroIconByStarterClass()
  if (playerStatusAvatar && playerStatusAvatarUrl !== nextAvatarUrl) {
    playerStatusAvatarUrl = nextAvatarUrl
    void Assets.load<Texture>(nextAvatarUrl).then((tex) => {
      if (!playerStatusAvatar || playerStatusAvatarUrl !== nextAvatarUrl) return
      playerStatusAvatar.texture = tex
      playerStatusAvatar.alpha = 1
    }).catch(() => {
      // ignore runtime missing icon
    })
  }

  if (playerStatusDailySkillStar) {
    playerStatusDailySkillStar.visible = shouldShowHeroDailySkillReadyStar()
  }
}

function layoutPlayerStatusPanel(): void {
  if (!playerStatusCon || !playerStatusAvatar || !playerStatusLvText || !playerStatusExpBg || !playerStatusExpBar) return
  const avatarX = 260
  const avatarY = 10
  const avatarW = 120
  const avatarH = 120
  const avatarCenterX = avatarX + avatarW / 2
  const expW = Math.max(40, getDebugCfg('shopPlayerStatusExpBarWidth'))
  const expH = Math.max(12, getDebugCfg('shopPlayerStatusExpBarHeight'))
  const expOffsetX = getDebugCfg('shopPlayerStatusExpBarOffsetX')
  const expOffsetY = getDebugCfg('shopPlayerStatusExpBarOffsetY')
  const expX = avatarCenterX - expW / 2 + expOffsetX
  const expY = avatarY + avatarH + expOffsetY

  playerStatusCon.x = 0
  playerStatusCon.y = PvpContext.isActive() ? getDebugCfg('battleZoneY') - 200 : getDebugCfg('shopPlayerStatusY')

  playerStatusAvatar.x = avatarX
  playerStatusAvatar.y = avatarY
  playerStatusAvatar.width = avatarW
  playerStatusAvatar.height = avatarH
  playerStatusAvatar.hitArea = new Rectangle(0, 0, avatarW, avatarH)
  if (playerStatusAvatarClickHit) {
    playerStatusAvatarClickHit.clear()
    playerStatusAvatarClickHit.rect(avatarX, avatarY, avatarW, avatarH)
    playerStatusAvatarClickHit.fill({ color: 0xffffff, alpha: 0.001 })
  }

  if (playerStatusDailySkillStar) {
    playerStatusDailySkillStar.x = avatarX + avatarW - 8
    playerStatusDailySkillStar.y = avatarY + avatarH - 38
  }

  playerStatusLvText.x = avatarCenterX
  playerStatusLvText.y = getDebugCfg('shopPlayerStatusLvY')

  playerStatusExpBg.clear()
  playerStatusExpBg.roundRect(0, 0, expW, expH, 10)
  playerStatusExpBg.fill({ color: 0x1a243d, alpha: 0.9 })
  playerStatusExpBg.stroke({ color: 0x5a78aa, width: 2, alpha: 0.9 })
  playerStatusExpBg.x = expX
  playerStatusExpBg.y = expY

  playerStatusExpBar.x = expX + 2
  playerStatusExpBar.y = expY + 2

}

// ============================================================
// 刷新商店 UI
// ============================================================
function refreshShopUI(): void {
  if (!shopManager) return
  syncShopOwnedTierRules()
  if (shopPanel) {
    shopPanel.update([], shopManager.gold)
  }
  if (goldText) {
    goldText.text = `💰 ${shopManager.gold}G`
    goldText.x    = getDebugCfg('goldTextCenterX') - goldText.width / 2
    goldText.y    = getDebugCfg('goldTextY')
  }
  if (livesText) {
    if (PvpContext.isActive()) {
      // PVP 模式：显示 PVP HP，不显示 PVE 生命
      const pvpSession = PvpContext.getSession()
      const myHp = pvpSession?.playerHps?.[pvpSession?.myIndex ?? -1] ?? 30
      const initHp = pvpSession?.initialHp ?? 30
      livesText.text = `❤️ ${myHp}/${initHp}`
      livesText.style.fill = myHp <= 2 ? 0xff6a6a : 0xffd4d4
    } else {
      const lives = getLifeState()
      livesText.text = `❤️ ${lives.current}/${lives.max}`
      livesText.style.fill = lives.current <= 1 ? 0xff6a6a : 0xffd4d4
    }
    livesText.x = CANVAS_W - livesText.width - 18
    livesText.y = 18
  }
  if (trophyText) {
    if (PvpContext.isActive()) {
      // PVP 模式：隐藏奖杯
      trophyText.visible = false
    } else {
      trophyText.visible = true
      const target = getConfig().runRules?.trophyWinsToFinalVictory ?? 10
      const trophy = getWinTrophyState(target)
      trophyText.text = `🏆 ${trophy.wins}/${trophy.target}`
      trophyText.style.fill = trophy.wins >= trophy.target ? 0xffde79 : 0xffe8b4
      trophyText.x = CANVAS_W - trophyText.width - 18
      trophyText.y = (livesText?.y ?? 18) + (livesText?.height ?? 0) + 6
    }
  }
  if (refreshCostText) {
    refreshCostText.text = `💰 ${shopManager.gold}/${getQuickBuyPricePreviewLabel()}`
    refreshCostText.x    = getDebugCfg('refreshBtnX') - refreshCostText.width / 2
    refreshCostText.style.fill = shopManager.gold >= getQuickBuyMinPrice() ? 0xffd700 : 0xff4444
  }
  if (refreshBtnHandle) {
    refreshBtnHandle.setLabel('购买')
    refreshBtnHandle.setSubLabel(`💰 ${shopManager.gold}/${getQuickBuyPricePreviewLabel()}`)
    const sub = refreshBtnHandle.container.getChildByName('sell-price') as Text | null
    if (sub) sub.style.fill = shopManager.gold >= getQuickBuyMinPrice() ? 0xffd700 : 0xff6666
  }
  refreshPlayerStatusUI()
  if (specialShopBackpackViewActive) {
    setBaseShopPrimaryButtonsVisible(false)
    drag?.setEnabled(false)
    renderSpecialShopCheckMarks()
  }
  if ((skillDraftOverlay || eventDraftOverlay || specialShopOverlay) && !specialShopBackpackViewActive) {
    setBaseShopPrimaryButtonsVisible(false)
  }
  updateMiniMap()
  refreshUpgradeHints()
  refreshBattlePassiveStatBadges(true)
  layoutSkillIconBar()
  checkAndPopPendingRewards()
  saveShopStateToStorage(captureShopState())
}
void executeSpecialShopBulkSell

type PoolCandidate = {
  item: ItemDef
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7
  tier: TierKey
  star: 1 | 2
  price: number
}

function levelToTierStar(level: number): { tier: TierKey; star: 1 | 2 } | null {
  if (level === 1) return { tier: 'Bronze', star: 1 }
  if (level === 2) return { tier: 'Silver', star: 1 }
  if (level === 3) return { tier: 'Silver', star: 2 }
  if (level === 4) return { tier: 'Gold', star: 1 }
  if (level === 5) return { tier: 'Gold', star: 2 }
  if (level === 6) return { tier: 'Diamond', star: 1 }
  if (level === 7) return { tier: 'Diamond', star: 2 }
  return null
}

function getAllowedLevelsByStartingTier(tier: TierKey): Array<1 | 2 | 3 | 4 | 5 | 6 | 7> {
  if (tier === 'Bronze') return [1, 2, 3, 4, 5, 6, 7]
  if (tier === 'Silver') return [2, 3, 4, 5, 6, 7]
  if (tier === 'Gold') return [4, 5, 6, 7]
  return [6, 7]
}

function getUnlockPoolBuyPriceByLevel(level: 1 | 2 | 3 | 4 | 5 | 6 | 7): number {
  const tierStar = levelToTierStar(level)
  const key = `${tierStar?.tier ?? 'Bronze'}#${tierStar?.star ?? 1}`
  const raw = getConfig().shopRules?.quickBuyFixedPrice?.[key]
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.max(1, Math.round(raw))
  }
  const byLevel: [number, number, number, number, number, number, number] = [3, 6, 12, 24, 48, 96, 192]
  return byLevel[level - 1] ?? 3
}

function collectPoolCandidatesByLevel(level: 1 | 2 | 3 | 4 | 5 | 6 | 7): PoolCandidate[] {
  if (!shopManager || !battleSystem || !backpackSystem) return []
  const tierStar = levelToTierStar(level)
  if (!tierStar) return []
  const allById = new Map(getAllItems().map((it) => [it.id, it] as const))
  const out: PoolCandidate[] = []
  for (const item of allById.values()) {
    if (!item) continue
    if (isNeutralItemDef(item)) continue
    const minTier = parseTierName(item.starting_tier) ?? 'Bronze'
    if (!getAllowedLevelsByStartingTier(minTier).includes(level)) continue
    if (!parseAvailableTiers(item.available_tiers).includes(tierStar.tier)) continue
    const size = normalizeSize(item.size)
    if (!findFirstBattlePlace(size) && !findFirstBackpackPlace(size)) continue
    out.push({
      item,
      level,
      tier: tierStar.tier,
      star: tierStar.star,
      price: getUnlockPoolBuyPriceByLevel(level),
    })
  }
  return out
}

function getSpecialShopRefreshCost(): number {
  return Math.max(1, currentDay)
}

function getSpecialShopPriceByLevel(level: 1 | 2 | 3 | 4 | 5 | 6 | 7): number {
  const clamped = Math.max(1, Math.min(7, level)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  const tierStar = levelToTierStar(clamped)
  const key = `${tierStar?.tier ?? 'Bronze'}#${tierStar?.star ?? 1}`
  const raw = getConfig().shopRules?.quickBuyFixedPrice?.[key]
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.max(1, Math.round(raw))
  }
  const byLevel: [number, number, number, number, number, number, number] = [3, 6, 12, 24, 48, 96, 192]
  return byLevel[clamped - 1] ?? 3
}

function applyFixedSpecialOfferDiscounts(offers: SpecialShopOffer[]): SpecialShopOffer[] {
  const rates = [0.9, 0.8, 0.7]
  return offers.map((it, idx) => {
    const rate = rates[idx] ?? 0.7
    return {
      ...it,
      price: Math.max(1, Math.floor(it.basePrice * rate)),
    }
  })
}

function normalizeSpecialShopOfferPrices(): void {
  const normalized = specialShopOffers.map((one) => {
    const level = Math.max(1, Math.min(7, tierStarLevelIndex(one.tier, one.star) + 1)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
    const basePrice = getSpecialShopPriceByLevel(level)
    return {
      ...one,
      basePrice,
      price: basePrice,
    }
  })
  specialShopOffers = applyFixedSpecialOfferDiscounts(normalized)
}

function isSpecialShopPlannedForDay(day: number): boolean {
  const plan = getDailyPlanRow(day)
  return (Number(plan?.shouldShop) || 0) >= 0.5
}

function getCurrentMaxOwnedLevel(): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  let maxLevel = 1
  const collect = (items: Array<{ instanceId: string }>) => {
    for (const it of items) {
      const tier = instanceToTier.get(it.instanceId) ?? 'Bronze'
      const star = getInstanceTierStar(it.instanceId)
      const lv = tierStarLevelIndex(tier, star) + 1
      if (lv > maxLevel) maxLevel = lv
    }
  }
  collect(battleSystem?.getAllItems() ?? [])
  collect(backpackSystem?.getAllItems() ?? [])
  return Math.max(1, Math.min(7, maxLevel)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
}

function getDominantBattleArchetypeForSpecialShop(): SkillArchetype | null {
  if (!battleSystem) return null
  type Stat = { count: number; levelSum: number }
  const stats = new Map<SkillArchetype, Stat>()
  for (const one of battleSystem.getAllItems()) {
    const def = getItemDefById(one.defId)
    const arch = toSkillArchetype(getPrimaryArchetype(def?.tags ?? ''))
    if (!arch || arch === 'utility') continue
    const tier = instanceToTier.get(one.instanceId) ?? 'Bronze'
    const star = getInstanceTierStar(one.instanceId)
    const level = tierStarLevelIndex(tier, star) + 1
    const prev = stats.get(arch) ?? { count: 0, levelSum: 0 }
    prev.count += 1
    prev.levelSum += level
    stats.set(arch, prev)
  }
  if (stats.size <= 0) return null
  let top = Array.from(stats.keys())
  let maxCount = Math.max(...top.map((k) => stats.get(k)?.count ?? 0))
  top = top.filter((k) => (stats.get(k)?.count ?? 0) === maxCount)
  if (top.length === 1) return top[0] ?? null

  let maxLevelSum = Math.max(...top.map((k) => stats.get(k)?.levelSum ?? 0))
  top = top.filter((k) => (stats.get(k)?.levelSum ?? 0) === maxLevelSum)
  if (top.length === 1) return top[0] ?? null

  const skillCount = new Map<SkillArchetype, number>()
  for (const skill of pickedSkills) {
    if (!top.includes(skill.archetype)) continue
    skillCount.set(skill.archetype, (skillCount.get(skill.archetype) ?? 0) + 1)
  }
  let maxSkill = Math.max(...top.map((k) => skillCount.get(k) ?? 0))
  top = top.filter((k) => (skillCount.get(k) ?? 0) === maxSkill)
  if (top.length === 1) return top[0] ?? null
  return top[Math.floor(Math.random() * top.length)] ?? null
}

function pickSpecialShopCandidateWeighted(candidates: PoolCandidate[]): PoolCandidate | null {
  if (candidates.length <= 0) return null
  let total = 0
  const ws = candidates.map((c) => {
    const w = getMinTierDropWeight(c.item, c.tier, c.star)
    total += w
    return w
  })
  if (total <= 0) return candidates[Math.floor(Math.random() * candidates.length)] ?? null
  let roll = Math.random() * total
  for (let i = 0; i < candidates.length; i++) {
    roll -= ws[i] ?? 0
    if (roll <= 0) return candidates[i] ?? null
  }
  return candidates[candidates.length - 1] ?? null
}

function countSameOfferDefIds(a: SpecialShopOffer[], b: SpecialShopOffer[]): number {
  const set = new Set(a.map((it) => it.itemId))
  let same = 0
  for (const one of b) {
    if (set.has(one.itemId)) same += 1
  }
  return same
}

function areAllSpecialOffersSameArchetype(offers: SpecialShopOffer[]): boolean {
  if (offers.length < 3) return false
  let first: string | null = null
  for (const one of offers) {
    const def = getItemDefById(one.itemId)
    const arch = getPrimaryArchetype(def?.tags ?? '')
    if (!arch) return false
    if (first == null) {
      first = arch
      continue
    }
    if (arch !== first) return false
  }
  return true
}

function rollSpecialShopOffers(prevOffers?: SpecialShopOffer[]): SpecialShopOffer[] {
  const actualMaxLevel = getCurrentMaxOwnedLevel()
  const maxLevel = Math.max(3, actualMaxLevel) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  const minLevel = (actualMaxLevel < 3 ? 2 : Math.max(1, maxLevel - 1)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  const levels: Array<1 | 2 | 3 | 4 | 5 | 6 | 7> = []
  for (let lv = minLevel; lv <= maxLevel; lv++) levels.push(lv as 1 | 2 | 3 | 4 | 5 | 6 | 7)
  let pool = levels.flatMap((lv) => collectPoolCandidatesByLevel(lv))
  if (pool.length <= 0) return []

  const dominant = getDominantBattleArchetypeForSpecialShop()
  let best: SpecialShopOffer[] = []
  let bestSame = Number.POSITIVE_INFINITY
  let bestAny: SpecialShopOffer[] = []
  let bestAnySame = Number.POSITIVE_INFINITY

  for (let attempt = 0; attempt < 120; attempt++) {
    const offers: SpecialShopOffer[] = []
    const usedDef = new Set<string>()
    const workingPool = [...pool]

    const takeOne = (source: PoolCandidate[]): PoolCandidate | null => {
      const picked = pickSpecialShopCandidateWeighted(source.filter((c) => !usedDef.has(c.item.id)))
      if (!picked) return null
      usedDef.add(picked.item.id)
      const basePrice = getSpecialShopPriceByLevel(picked.level)
      offers.push({
        itemId: picked.item.id,
        tier: picked.tier,
        star: picked.star,
        basePrice,
        price: basePrice,
        purchased: false,
      })
      return picked
    }

    if (dominant) {
      const forcedPool = workingPool.filter((c) => toSkillArchetype(getPrimaryArchetype(c.item.tags)) === dominant)
      if (forcedPool.length > 0) takeOne(forcedPool)
    }

    while (offers.length < 3) {
      const picked = takeOne(workingPool)
      if (!picked) break
    }
    if (offers.length < 3) continue

    const pricedOffers = applyFixedSpecialOfferDiscounts(offers)
    const same = prevOffers && prevOffers.length > 0 ? countSameOfferDefIds(prevOffers, pricedOffers) : 0
    if (same < bestAnySame) {
      bestAny = pricedOffers
      bestAnySame = same
    }

    if (areAllSpecialOffersSameArchetype(pricedOffers)) continue

    if (same < bestSame) {
      best = pricedOffers
      bestSame = same
    }
    if (!prevOffers || prevOffers.length <= 0 || same <= 1) return pricedOffers
  }

  return best.length > 0 ? best : bestAny
}

function findCandidateByOffer(offer: { itemId: string; tier: TierKey; star: 1 | 2; price: number } | null): PoolCandidate | null {
  if (!offer) return null
  const item = getItemDefById(offer.itemId)
  if (!item) return null
  if (isNeutralItemDef(item)) {
    const rewrittenItem = rewriteNeutralRandomPick(item)
    if (!canRandomNeutralItem(rewrittenItem)) return null
    const size = normalizeSize(rewrittenItem.size)
    if (!findFirstBattlePlace(size) && !findFirstBackpackPlace(size)) return null
    return {
      item: rewrittenItem,
      level: 1,
      tier: 'Bronze',
      star: 1,
      price: Math.max(1, Math.round(Number(offer.price) || currentDay + 1)),
    }
  }
  const level = tierStarLevelIndex(offer.tier, offer.star) + 1
  if (level < 1 || level > 7) return null
  const levelKey = level as 1 | 2 | 3 | 4 | 5 | 6 | 7
  const size = normalizeSize(item.size)
  if (!findFirstBattlePlace(size) && !findFirstBackpackPlace(size)) return null
  const minTier = parseTierName(item.starting_tier) ?? 'Bronze'
  if (!getAllowedLevelsByStartingTier(minTier).includes(levelKey)) return null
  if (!parseAvailableTiers(item.available_tiers).includes(offer.tier)) return null
  return {
    item,
    level: levelKey,
    tier: offer.tier,
    star: offer.star,
    price: offer.price,
  }
}

function canOfferImmediateSynthesis(candidate: PoolCandidate): boolean {
  if (!battleSystem || !backpackSystem) return false
  const scan = (items: ReturnType<GridSystem['getAllItems']>): boolean => {
    for (const it of items) {
      const itTier = instanceToTier.get(it.instanceId) ?? 'Bronze'
      const itStar = getInstanceTierStar(it.instanceId)
      if (canSynthesizePair(candidate.item.id, it.defId, candidate.tier, candidate.star, itTier, itStar)) {
        return true
      }
    }
    return false
  }
  return scan(battleSystem.getAllItems()) || scan(backpackSystem.getAllItems())
}

function applyQuickBuySynthesisRewrite(picked: PoolCandidate, levelCandidates: PoolCandidate[]): PoolCandidate {
  if (!battleSystem || !backpackSystem) return picked
  const backpackSameDefCount = new Map<string, number>()
  const sameArchetypeDefs = new Map<string, Set<string>>()
  const collect = (items: ReturnType<GridSystem['getAllItems']>) => {
    for (const it of items) {
      const itTier = instanceToTier.get(it.instanceId) ?? 'Bronze'
      const itStar = getInstanceTierStar(it.instanceId)
      if (itTier !== picked.tier || itStar !== picked.star) continue
      const def = getItemDefById(it.defId)
      const arch = getPrimaryArchetype(def?.tags ?? '')
      if (!arch) continue
      const set = sameArchetypeDefs.get(arch) ?? new Set<string>()
      set.add(it.defId)
      sameArchetypeDefs.set(arch, set)
    }
  }
  collect(battleSystem.getAllItems())
  collect(backpackSystem.getAllItems())
  for (const it of backpackSystem.getAllItems()) {
    backpackSameDefCount.set(it.defId, (backpackSameDefCount.get(it.defId) ?? 0) + 1)
  }

  const pickedArch = getPrimaryArchetype(picked.item.tags)
  if (!pickedArch) return picked

  const backpackSameDefOwnedCount = backpackSameDefCount.get(picked.item.id) ?? 0
  if (backpackSameDefOwnedCount >= 3) {
    const sameArchetypeOther = levelCandidates.filter((c) =>
      c.item.id !== picked.item.id
      && c.tier === picked.tier
      && c.star === picked.star
      && getPrimaryArchetype(c.item.tags) === pickedArch,
    )
    const swapped = sameArchetypeOther[Math.floor(Math.random() * sameArchetypeOther.length)] ?? null
    if (swapped) return swapped
  }

  const sameArchDefSet = sameArchetypeDefs.get(pickedArch)
  if ((sameArchDefSet?.size ?? 0) >= 3) {
    const ownedSameItemCandidates = levelCandidates.filter((c) =>
      c.tier === picked.tier
      && c.star === picked.star
      && sameArchDefSet!.has(c.item.id),
    )
    const swapped = ownedSameItemCandidates[Math.floor(Math.random() * ownedSameItemCandidates.length)] ?? null
    if (swapped) return swapped
  }

  return picked
}

function getQuickBuyLevelWeightsByDay(day: number): [number, number, number, number, number, number, number] {
  const rows = getConfig().shopRules?.quickBuyLevelChancesByDay
  const idx = Math.max(0, Math.min((rows?.length ?? 1) - 1, day - 1))
  const row = rows?.[idx] ?? [1, 0, 0, 0, 0, 0, 0]
  return [
    Math.max(0, Number(row[0] ?? 0)),
    Math.max(0, Number(row[1] ?? 0)),
    Math.max(0, Number(row[2] ?? 0)),
    Math.max(0, Number(row[3] ?? 0)),
    Math.max(0, Number(row[4] ?? 0)),
    Math.max(0, Number(row[5] ?? 0)),
    Math.max(0, Number(row[6] ?? 0)),
  ]
}

function getQuickBuyQualityWeightsByLevel(level: 1 | 2 | 3 | 4 | 5 | 6 | 7): Record<TierKey, number> {
  const rules = getConfig().shopRules as {
    qualityPseudoRandomWeightsByLevel?: Record<TierKey, number[]>
    quickBuyQualityWeightsByLevel?: Record<TierKey, number[]>
  } | undefined
  const rows = rules?.qualityPseudoRandomWeightsByLevel ?? rules?.quickBuyQualityWeightsByLevel
  if (!rows) {
    return { Bronze: 1, Silver: 1, Gold: 1, Diamond: 1 }
  }
  return {
    Bronze: Math.max(0, Number(rows.Bronze?.[level - 1] ?? 0)),
    Silver: Math.max(0, Number(rows.Silver?.[level - 1] ?? 0)),
    Gold: Math.max(0, Number(rows.Gold?.[level - 1] ?? 0)),
    Diamond: Math.max(0, Number(rows.Diamond?.[level - 1] ?? 0)),
  }
}

function buildQualityPseudoRandomBag(level: 1 | 2 | 3 | 4 | 5 | 6 | 7, available: TierKey[]): TierKey[] {
  const qualityOrder: TierKey[] = ['Bronze', 'Silver', 'Gold', 'Diamond']
  const availableSet = new Set(available)
  const base = getQuickBuyQualityWeightsByLevel(level)
  const weighted = qualityOrder
    .map((q) => ({ q, w: availableSet.has(q) ? Math.max(0, Number(base[q] ?? 0)) : 0 }))
    .filter((it) => it.w > 0)
  if (weighted.length <= 0) return available.length > 0 ? [...available] : ['Bronze']

  const windowSizeRaw = Number((getConfig().shopRules as { qualityPseudoRandomWindowSize?: number } | undefined)?.qualityPseudoRandomWindowSize ?? 10)
  const windowSize = Math.max(1, Math.round(windowSizeRaw))
  const total = weighted.reduce((sum, it) => sum + it.w, 0)
  const rawCounts = weighted.map((it) => (it.w / total) * windowSize)
  const counts = rawCounts.map((v) => Math.floor(v))
  let remain = windowSize - counts.reduce((sum, n) => sum + n, 0)
  const fracOrder = rawCounts
    .map((v, i) => ({ i, f: v - Math.floor(v) }))
    .sort((a, b) => b.f - a.f)
  for (let i = 0; i < fracOrder.length && remain > 0; i++, remain--) {
    counts[fracOrder[i]!.i] = (counts[fracOrder[i]!.i] ?? 0) + 1
  }

  const bag: TierKey[] = []
  for (let i = 0; i < weighted.length; i++) {
    const q = weighted[i]!.q
    const c = Math.max(0, counts[i] ?? 0)
    for (let k = 0; k < c; k++) bag.push(q)
  }
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = bag[i]
    bag[i] = bag[j]!
    bag[j] = t!
  }
  return bag.length > 0 ? bag : [weighted[0]!.q]
}

function pickQualityByPseudoRandomBag(
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7,
  available: TierKey[],
): TierKey {
  const qualityOrder: TierKey[] = ['Bronze', 'Silver', 'Gold', 'Diamond']
  const filteredAvailable = qualityOrder.filter((q) => available.includes(q))
  const availableList: TierKey[] = filteredAvailable.length > 0 ? filteredAvailable : ['Bronze']
  const key = `${level}:${availableList.join('|')}`
  let state = QUALITY_PSEUDO_RANDOM_STATE.get(key)
  if (!state || state.cursor >= state.bag.length) {
    state = { bag: buildQualityPseudoRandomBag(level, availableList), cursor: 0 }
    QUALITY_PSEUDO_RANDOM_STATE.set(key, state)
  }
  const picked = state.bag[state.cursor] ?? state.bag[0] ?? 'Bronze'
  state.cursor += 1
  if (availableList.includes(picked)) return picked
  return availableList[0]!
}

function collectNeutralQuickBuyCandidates(): PoolCandidate[] {
  return []
}

function updateNeutralPseudoRandomCounterOnPurchase(item: ItemDef): void {
  if (isNeutralItemDef(item)) {
    quickBuyNeutralMissStreak = 0
    return
  }
  const shopRulesCfg = (getConfig().shopRules ?? {}) as { quickBuyNeutralPseudoRandomChances?: number[] }
  const pseudoChanceSource = shopRulesCfg.quickBuyNeutralPseudoRandomChances
  const pseudoChanceRows = Array.isArray(pseudoChanceSource)
    ? pseudoChanceSource
      .map((v: number) => clamp01(Number(v)))
      .filter((v: number) => Number.isFinite(v))
    : []
  if (pseudoChanceRows.length > 0) {
    quickBuyNeutralMissStreak = Math.min(quickBuyNeutralMissStreak + 1, pseudoChanceRows.length - 1)
  } else {
    quickBuyNeutralMissStreak = Math.min(quickBuyNeutralMissStreak + 1, 999)
  }
}

function rollNextQuickBuyOffer(force = false): PoolCandidate | null {
  const forcedLowLevelPair = pickForcedLowLevelPairCandidate(currentDay)
  if (forcedLowLevelPair) {
    nextQuickBuyOffer = {
      itemId: forcedLowLevelPair.item.id,
      tier: forcedLowLevelPair.tier,
      star: forcedLowLevelPair.star,
      price: forcedLowLevelPair.price,
    }
    return forcedLowLevelPair
  }

  if (!force) {
    const keep = findCandidateByOffer(nextQuickBuyOffer)
    if (keep) return keep
  }
  const byLevel: Record<1 | 2 | 3 | 4 | 5 | 6 | 7, PoolCandidate[]> = {
    1: collectPoolCandidatesByLevel(1),
    2: collectPoolCandidatesByLevel(2),
    3: collectPoolCandidatesByLevel(3),
    4: collectPoolCandidatesByLevel(4),
    5: collectPoolCandidatesByLevel(5),
    6: collectPoolCandidatesByLevel(6),
    7: collectPoolCandidatesByLevel(7),
  }
  if (isFirstPurchaseLockedToStarterClass()) {
    byLevel[1] = byLevel[1].filter((c) => isStarterClassItem(c.item))
    byLevel[2] = byLevel[2].filter((c) => isStarterClassItem(c.item))
    byLevel[3] = byLevel[3].filter((c) => isStarterClassItem(c.item))
    byLevel[4] = byLevel[4].filter((c) => isStarterClassItem(c.item))
    byLevel[5] = byLevel[5].filter((c) => isStarterClassItem(c.item))
    byLevel[6] = byLevel[6].filter((c) => isStarterClassItem(c.item))
    byLevel[7] = byLevel[7].filter((c) => isStarterClassItem(c.item))
  }

  const neutralCandidates = collectNeutralQuickBuyCandidates()
  const shopRulesCfg = (getConfig().shopRules ?? {}) as {
    quickBuyNeutralStartDay?: number
    quickBuyNeutralChance?: number
    quickBuyNeutralPseudoRandomChances?: number[]
  }
  const neutralStartDay = Math.max(1, Math.round(Number(shopRulesCfg.quickBuyNeutralStartDay ?? 2) || 2))
  const neutralChance = clamp01(Number(shopRulesCfg.quickBuyNeutralChance ?? 0.25))
  const pseudoChanceRows = Array.isArray(shopRulesCfg.quickBuyNeutralPseudoRandomChances)
    ? shopRulesCfg.quickBuyNeutralPseudoRandomChances
      .map((v: number) => clamp01(Number(v)))
      .filter((v: number) => Number.isFinite(v))
    : []
  const neutralDailyCap = getNeutralDailyRollCap(currentDay)
  const neutralRolledToday = Math.max(0, Math.round(neutralDailyRollCountByDay.get(currentDay) ?? 0))
  const neutralEligible = currentDay >= neutralStartDay
    && neutralCandidates.length > 0
    && neutralRolledToday < neutralDailyCap
  const neutralRollChance = pseudoChanceRows.length > 0
    ? pseudoChanceRows[Math.min(quickBuyNeutralMissStreak, pseudoChanceRows.length - 1)]
    : neutralChance
  const shouldTryNeutral = neutralEligible && Math.random() < neutralRollChance
  if (shouldTryNeutral) {
    const neutralPicked = neutralCandidates[Math.floor(Math.random() * neutralCandidates.length)] ?? null
    if (neutralPicked) {
      const rewrittenCandidates = neutralCandidates.map((one) => ({ ...one, item: rewriteNeutralRandomPick(one.item) }))
      const targetCategory = pickNeutralRandomCategoryByPool(rewrittenCandidates)
      const sameCategory = rewrittenCandidates.filter((one) => neutralRandomCategoryOfItem(one.item) === targetCategory)
      const pickedAfterRatio = (sameCategory[Math.floor(Math.random() * sameCategory.length)]
        ?? rewrittenCandidates[Math.floor(Math.random() * rewrittenCandidates.length)]
        ?? neutralPicked)
      nextQuickBuyOffer = {
        itemId: pickedAfterRatio.item.id,
        tier: pickedAfterRatio.tier,
        star: pickedAfterRatio.star,
        price: pickedAfterRatio.price,
      }
      neutralDailyRollCountByDay.set(currentDay, neutralRolledToday + 1)
      return pickedAfterRatio
    }
  }

  const baseWeights = getQuickBuyLevelWeightsByDay(currentDay)
  const effectiveWeights: [number, number, number, number, number, number, number] = [
    byLevel[1].length > 0 ? baseWeights[0] : 0,
    byLevel[2].length > 0 ? baseWeights[1] : 0,
    byLevel[3].length > 0 ? baseWeights[2] : 0,
    byLevel[4].length > 0 ? baseWeights[3] : 0,
    byLevel[5].length > 0 ? baseWeights[4] : 0,
    byLevel[6].length > 0 ? baseWeights[5] : 0,
    byLevel[7].length > 0 ? baseWeights[6] : 0,
  ]
  const totalWeight = effectiveWeights.reduce((sum, n) => sum + n, 0)
  if (totalWeight <= 0) {
    nextQuickBuyOffer = null
    return null
  }

  const pickedLevel = pickQuickBuyLevelByPseudoRandomBucket(effectiveWeights)

  const levelCandidates = byLevel[pickedLevel]
  if (levelCandidates.length <= 0) {
    nextQuickBuyOffer = null
    return null
  }
  const byQuality: Record<TierKey, PoolCandidate[]> = { Bronze: [], Silver: [], Gold: [], Diamond: [] }
  for (const c of levelCandidates) {
    const q = parseTierName(c.item.starting_tier) ?? 'Bronze'
    byQuality[q].push(c)
  }
  const availableQualities = (Object.keys(byQuality) as TierKey[]).filter((q) => byQuality[q].length > 0)
  const pickedQuality = pickQualityByPseudoRandomBag(pickedLevel, availableQualities)
  const qualityPool = byQuality[pickedQuality].length > 0 ? byQuality[pickedQuality] : levelCandidates
  const rawPicked = qualityPool[Math.floor(Math.random() * qualityPool.length)] ?? null
  if (!rawPicked) {
    nextQuickBuyOffer = null
    return null
  }
  let picked = applyQuickBuySynthesisRewrite(rawPicked, levelCandidates)

  if (force && quickBuyNoSynthRefreshStreak >= 2 && !canOfferImmediateSynthesis(picked)) {
    const synthCandidates: PoolCandidate[] = []
    const levels: Array<1 | 2 | 3 | 4 | 5 | 6 | 7> = [1, 2, 3, 4, 5, 6, 7]
    for (const lv of levels) {
      if (effectiveWeights[lv - 1] <= 0) continue
      for (const one of byLevel[lv]) {
        const rewritten = applyQuickBuySynthesisRewrite(one, byLevel[lv])
        if (!canOfferImmediateSynthesis(rewritten)) continue
        synthCandidates.push(rewritten)
      }
    }
    const forced = synthCandidates[Math.floor(Math.random() * synthCandidates.length)] ?? null
    if (forced) picked = forced
  }

  if (force) {
    if (canOfferImmediateSynthesis(picked)) quickBuyNoSynthRefreshStreak = 0
    else quickBuyNoSynthRefreshStreak = Math.min(3, quickBuyNoSynthRefreshStreak + 1)
  }

  nextQuickBuyOffer = {
    itemId: picked.item.id,
    tier: picked.tier,
    star: picked.star,
    price: picked.price,
  }
  return picked
}

function getQuickBuyMinPrice(): number {
  const offer = rollNextQuickBuyOffer(false)
  if (!offer) return SHOP_QUICK_BUY_PRICE
  return resolveBuyPriceWithSkills(offer.price).finalPrice
}

function getQuickBuyPricePreviewLabel(): string {
  const offer = rollNextQuickBuyOffer(false)
  if (!offer) return '-'
  return `${resolveBuyPriceWithSkills(offer.price).finalPrice}`
}

function buyRandomBronzeToBoardOrBackpack(): void {
  if (!shopManager || !battleSystem || !battleView || !backpackSystem || !backpackView) return
  const manager = shopManager

  syncShopOwnedTierRules()
  let picked = rollNextQuickBuyOffer(false)
  if (!picked) {
    showHintToast('no_gold_buy', '无可用购买池', 0xff8f8f)
    refreshShopUI()
    return
  }

  if (!findCandidateByOffer(nextQuickBuyOffer)) {
    picked = rollNextQuickBuyOffer(true)
    if (!picked) {
      showHintToast('no_gold_buy', '无可用购买池', 0xff8f8f)
      refreshShopUI()
      return
    }
  }

  const tier = picked.tier
  const star = picked.star
  if (dayEventState.forceBuyArchetype && dayEventState.forceBuyRemaining > 0) {
    const level = tierStarLevelIndex(tier, star) + 1
    const levelKey = Math.max(1, Math.min(7, level)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
    const forcePool = collectPoolCandidatesByLevel(levelKey).filter((one) =>
      toSkillArchetype(getPrimaryArchetype(one.item.tags)) === dayEventState.forceBuyArchetype,
    )
    const forced = forcePool[Math.floor(Math.random() * forcePool.length)]
    if (forced) {
      picked = forced
    }
  }
  const itemForced = picked.item
  const tierForced = picked.tier
  const starForced = picked.star
  const buyPrice = picked.price
  const priced = resolveBuyPriceWithSkills(buyPrice)

  if (!canBuyItemUnderFirstPurchaseRule(itemForced)) {
    showFirstPurchaseRuleHint()
    refreshShopUI()
    return
  }

  const size = normalizeSize(itemForced.size)
  const battleSlot = findFirstBattlePlace(size)
  const backpackSlot = battleSlot ? null : findFirstBackpackPlace(size)
  if (!battleSlot && !backpackSlot) {
    showHintToast('backpack_full_buy', '背包已满，无法购买', 0xff8f8f)
    refreshShopUI()
    return
  }

  if (manager.gold < priced.finalPrice) {
    showHintToast('no_gold_buy', `金币不足，需${priced.finalPrice}G`, 0xff8f8f)
    refreshShopUI()
    return
  }

  manager.gold -= priced.finalPrice
  if (consumeSkill15NextBuyDiscountAfterSuccess()) showHintToast('no_gold_buy', '砍价高手触发：本次-1G', 0x8ff0b0)
  const skill30Ready = consumeSkill30BundleAfterSuccess(priced.freeBySkill30)
  if (priced.freeBySkill30) showHintToast('no_gold_buy', '打包购买触发：本次0金币', 0x9be5ff)
  else if (skill30Ready) showHintToast('no_gold_buy', '打包购买就绪：下次购买0金币', 0x9be5ff)
  if (dayEventState.forceBuyRemaining > 0) {
    dayEventState.forceBuyRemaining = Math.max(0, dayEventState.forceBuyRemaining - 1)
    if (dayEventState.forceBuyRemaining <= 0) dayEventState.forceBuyArchetype = null
  }
  markShopPurchaseDone()
  const id = nextId()
  const visualTier = toVisualTier(tierForced, starForced)
  if (battleSlot && battleSystem && battleView) {
    battleSystem.place(battleSlot.col, battleSlot.row, size, itemForced.id, id)
    void battleView.addItem(id, itemForced.id, size, battleSlot.col, battleSlot.row, visualTier).then(() => {
      battleView!.setItemTier(id, visualTier)
      drag?.refreshZone(battleView!)
    })
    console.log(`[ShopScene] 购买(${tierForced}#${starForced})→上阵区 ${itemForced.name_cn} -${priced.finalPrice}G，金币: ${manager.gold}`)
  } else if (backpackSlot) {
    backpackSystem.place(backpackSlot.col, backpackSlot.row, size, itemForced.id, id)
    void backpackView.addItem(id, itemForced.id, size, backpackSlot.col, backpackSlot.row, visualTier).then(() => {
      backpackView!.setItemTier(id, visualTier)
      drag?.refreshZone(backpackView!)
    })
    showHintToast('backpack_full_buy', '上阵区已满，已放入背包', 0xffd48f)
    console.log(`[ShopScene] 购买(${tierForced}#${starForced})→背包 ${itemForced.name_cn} -${priced.finalPrice}G，金币: ${manager.gold}`)
  }
  instanceToDefId.set(id, itemForced.id)
  setInstanceQualityLevel(id, itemForced.id, parseTierName(itemForced.starting_tier) ?? 'Bronze', levelFromLegacyTierStar(tierForced, starForced))
  instanceToPermanentDamageBonus.set(id, 0)
  recordNeutralItemObtained(itemForced.id)
  updateNeutralPseudoRandomCounterOnPurchase(itemForced)
  unlockItemToPool(itemForced.id)
  rollNextQuickBuyOffer(true)
  refreshShopUI()
}

// ---- Day 辅助 ----

function getDayActiveCols(day: number): number {
  const slots = getConfig().dailyBattleSlots
  if (day <= 2) return slots[0] ?? 4
  if (day <= 4) return slots[1] ?? 5
  return slots[2] ?? 6
}

function getShopItemScale(): number {
  return getDebugCfg('shopItemScale')
}

function getBattleItemScale(): number {
  return showingBackpack
    ? getDebugCfg('battleItemScaleBackpackOpen')
    : getDebugCfg('battleItemScale')
}

function getBattleZoneX(activeCols: number): number {
  const s = getBattleItemScale()
  return getDebugCfg('battleZoneX') + (CANVAS_W - activeCols * CELL_SIZE * s) / 2
}

function getBackpackZoneX(activeCols: number): number {
  const s = getBattleItemScale()
  return (CANVAS_W - activeCols * CELL_SIZE * s) / 2
}

function getBackpackZoneYByBattle(): number {
  const s = getBattleItemScale()
  return getDebugCfg('battleZoneY') + CELL_HEIGHT * s + BACKPACK_GAP_FROM_BATTLE + (CELL_HEIGHT * (1 - s)) / 2
}

function grantSkill20DailyBronzeItemIfNeeded(): void {
  if (!hasPickedSkill('skill20')) return
  if (skill20GrantedDays.has(currentDay)) return
  if (!backpackSystem || !backpackView) return

  const candidate = getAllItems().filter((it) => String(it.starting_tier || '').includes('Bronze') && !isNeutralItemDef(it))
  if (candidate.length <= 0) return

  skill20GrantedDays.add(currentDay)
  const picked = candidate[Math.floor(Math.random() * candidate.length)]
  if (!picked) return
  const place = findFirstBackpackPlace(normalizeSize(picked.size))
  if (!place) {
    showHintToast('backpack_full_buy', '背包大师：背包已满，今日赠送作废', 0xffb27a)
    return
  }

  const id = nextId()
  backpackSystem.place(place.col, place.row, normalizeSize(picked.size), picked.id, id)
  void backpackView.addItem(id, picked.id, normalizeSize(picked.size), place.col, place.row, toVisualTier('Bronze', 1)).then(() => {
    backpackView!.setItemTier(id, toVisualTier('Bronze', 1))
    drag?.refreshZone(backpackView!)
  })
  instanceToDefId.set(id, picked.id)
  setInstanceQualityLevel(id, picked.id, parseTierName(picked.starting_tier) ?? 'Bronze', 1)
  instanceToPermanentDamageBonus.set(id, 0)
  recordNeutralItemObtained(picked.id)
  unlockItemToPool(picked.id)
  showHintToast('backpack_full_buy', `背包大师：获得 ${picked.name_cn}（青铜1星）`, 0x86e1ff)
}

function grantPoolCandidateToBoardOrBackpack(
  candidate: PoolCandidate,
  toastPrefix: string,
  opts?: { flyFromHeroAvatar?: boolean; silentNoSpaceToast?: boolean; onSettled?: () => void },
): boolean {
  if (!battleSystem || !battleView || !backpackSystem || !backpackView) return false
  const size = normalizeSize(candidate.item.size)
  const battleSlot = findFirstBattlePlace(size)
  const backpackSlot = battleSlot ? null : findFirstBackpackPlace(size)
  if (!battleSlot && !backpackSlot) {
    if (!opts?.silentNoSpaceToast) {
      showHintToast('backpack_full_buy', `${toastPrefix}：空间不足，发放失败`, 0xffb27a)
    }
    return false
  }
  const id = nextId()
  const visualTier = toVisualTier(candidate.tier, candidate.star)
  if (battleSlot) {
    battleSystem.place(battleSlot.col, battleSlot.row, size, candidate.item.id, id)
    const onLand = () => {
      if (!battleSystem?.getItem(id) || !battleView) { opts?.onSettled?.(); return }
      void battleView.addItem(id, candidate.item.id, size, battleSlot.col, battleSlot.row, visualTier).then(() => {
        battleView!.setItemTier(id, visualTier)
        drag?.refreshZone(battleView!)
        opts?.onSettled?.()
      })
    }
    if (opts?.flyFromHeroAvatar) flyRewardToGridSlot(candidate.item.id, battleView, battleSlot.col, battleSlot.row, onLand)
    else onLand()
  } else if (backpackSlot) {
    backpackSystem.place(backpackSlot.col, backpackSlot.row, size, candidate.item.id, id)
    const onLand = () => {
      if (!backpackSystem?.getItem(id) || !backpackView) { opts?.onSettled?.(); return }
      void backpackView.addItem(id, candidate.item.id, size, backpackSlot.col, backpackSlot.row, visualTier).then(() => {
        backpackView!.setItemTier(id, visualTier)
        drag?.refreshZone(backpackView!)
        opts?.onSettled?.()
      })
    }
    if (opts?.flyFromHeroAvatar) flyRewardToGridSlot(candidate.item.id, backpackView, backpackSlot.col, backpackSlot.row, onLand)
    else onLand()
  }
  instanceToDefId.set(id, candidate.item.id)
  setInstanceQualityLevel(id, candidate.item.id, parseTierName(candidate.item.starting_tier) ?? 'Bronze', candidate.level)
  instanceToPermanentDamageBonus.set(id, 0)
  recordNeutralItemObtained(candidate.item.id)
  unlockItemToPool(candidate.item.id)
  showHintToast('backpack_full_buy', `${toastPrefix}：获得 ${candidate.item.name_cn}`, 0x86e1ff)
  return true
}

function buildNamedPoolCandidate(nameCn: string): PoolCandidate | null {
  const item = getItemDefByCn(nameCn)
  if (!item) return null
  const tier = parseTierName(item.starting_tier) ?? 'Bronze'
  const level = (tier === 'Bronze' ? 1 : tier === 'Silver' ? 2 : tier === 'Gold' ? 4 : 6) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  return { item, level, tier, star: 1, price: getUnlockPoolBuyPriceByLevel(level) }
}

function enqueueHeroPeriodicReward(candidate: PoolCandidate, source: string): void {
  pendingHeroPeriodicRewards.push({
    itemId: candidate.item.id,
    level: candidate.level,
    tier: candidate.tier,
    star: candidate.star,
    source,
  })
  refreshPlayerStatusUI()
  saveShopStateToStorage(captureShopState())
}

function checkAndPopPendingHeroPeriodicRewards(): void {
  if (pendingHeroPeriodicRewardDispatching) return
  if (pendingHeroPeriodicRewards.length <= 0) return

  const next = pendingHeroPeriodicRewards[0]
  if (!next) return
  const item = getItemDefById(next.itemId)
  if (!item) {
    pendingHeroPeriodicRewards.shift()
    refreshPlayerStatusUI()
    saveShopStateToStorage(captureShopState())
    checkAndPopPendingHeroPeriodicRewards()
    return
  }

  const candidate: PoolCandidate = {
    item,
    level: next.level,
    tier: next.tier,
    star: next.star,
    price: getUnlockPoolBuyPriceByLevel(next.level),
  }
  pendingHeroPeriodicRewardDispatching = true
  const ok = grantPoolCandidateToBoardOrBackpack(candidate, `${next.source}补发`, {
    flyFromHeroAvatar: true,
    silentNoSpaceToast: true,
    onSettled: () => {
      pendingHeroPeriodicRewardDispatching = false
      checkAndPopPendingHeroPeriodicRewards()
    },
  })
  if (!ok) {
    pendingHeroPeriodicRewardDispatching = false
    return
  }
  pendingHeroPeriodicRewards.shift()
  refreshPlayerStatusUI()
  saveShopStateToStorage(captureShopState())
}

function grantHeroPeriodicRewardOrQueue(nameCn: string, source: string): boolean {
  const candidate = buildNamedPoolCandidate(nameCn)
  if (!candidate) return false
  const ok = grantPoolCandidateToBoardOrBackpack(candidate, source, {
    flyFromHeroAvatar: true,
    silentNoSpaceToast: true,
  })
  if (ok) return true
  enqueueHeroPeriodicReward(candidate, source)
  showHintToast('backpack_full_buy', `${source}：空间不足，已暂存待补发`, 0xffd48f)
  return true
}

function grantHeroStartDayEffectsIfNeeded(): void {
  if (!shopManager) return
  if (isSelectedHero('hero2') && !heroTycoonGoldGrantedDays.has(currentDay)) {
    const bonus = Math.max(0, currentDay * 3)
    if (bonus > 0) {
      shopManager.gold += bonus
      heroTycoonGoldGrantedDays.add(currentDay)
      showHintToast('no_gold_buy', `大亨：额外获得${bonus}金币`, 0xf4d67d)
    }
  }
}

function grantHeroPeriodicEffectsOnNewDay(day: number): void {
  if (!shopManager) return
  if (isSelectedHero('hero2') && !heroTycoonGoldGrantedDays.has(day)) {
    const bonus = Math.max(0, day * 3)
    if (bonus > 0) {
      shopManager.gold += bonus
      heroTycoonGoldGrantedDays.add(day)
      showHintToast('no_gold_buy', `大亨：额外获得${bonus}金币`, 0xf4d67d)
    }
  }
  if (day % 3 === 0) {
    if (isSelectedHero('hero5') && !heroSmithStoneGrantedDays.has(day)) {
      if (grantHeroPeriodicRewardOrQueue('升级石', '铁匠')) heroSmithStoneGrantedDays.add(day)
    }
    if (isSelectedHero('hero6') && !heroAdventurerScrollGrantedDays.has(day)) {
      if (grantHeroPeriodicRewardOrQueue('冒险卷轴', '冒险家')) heroAdventurerScrollGrantedDays.add(day)
    }
    if (isSelectedHero('hero7') && !heroCommanderMedalGrantedDays.has(day)) {
      if (grantHeroPeriodicRewardOrQueue('勋章', '指挥官')) heroCommanderMedalGrantedDays.add(day)
    }
  }
  if (day === 3 && isSelectedHero('hero8') && !heroHeirGoldEquipGrantedDays.has(day)) {
    if (grantHeroPeriodicRewardOrQueue('黄金宝箱', '继承者')) heroHeirGoldEquipGrantedDays.add(day)
    else showHintToast('backpack_full_buy', '继承者：当前无可发放黄金宝箱', 0xffb27a)
  }
}

function grantSilverDailyGoldBonusesOnNewDay(): void {
  if (!shopManager) return
  if (hasPickedSkill('skill29')) {
    const bonus = Math.max(0, currentDay * 2)
    if (bonus > 0) {
      shopManager.gold += bonus
      showHintToast('no_gold_buy', `投资达人：额外获得${bonus}金币`, 0x9be5ff)
    }
  }
  if (hasPickedSkill('skill34')) {
    const interest = Math.min(30, Math.max(0, Math.floor(shopManager.gold / 5)))
    if (interest > 0) {
      shopManager.gold += interest
      showHintToast('no_gold_buy', `利息循环：获得${interest}金币`, 0xa8f0b6)
    }
  }
  if (hasPickedSkill('skill94')) {
    const bonus = calcSkill94DailyGoldBonus(shopManager.gold)
    if (bonus > 0) {
      shopManager.gold += bonus
      showHintToast('no_gold_buy', `财富密码：额外获得${bonus}金币`, 0xf4d67d)
    }
  }
}

function setDay(day: number): void {
  const prevDay = currentDay
  currentDay = Math.max(1, Math.min(20, day))
  if (currentDay !== prevDay) {
    resetDayEventState()
    pendingEventDraft = null
    closeEventDraftOverlay()
    closeSpecialShopOverlay()
    specialShopRefreshCount = 0
    specialShopOffers = []
    QUALITY_PSEUDO_RANDOM_STATE.clear()
    QUICK_BUY_LEVEL_PSEUDO_RANDOM_STATE.clear()
    nextQuickBuyOffer = null
  }
  const newCols = getDayActiveCols(currentDay)

  // 1. 更新 GridZone 格子背景（立即重绘）
  if (battleView) battleView.setActiveColCount(newCols)

  // 2. 动画：battleView.x 从当前值平滑移至新居中位置
  if (battleView) {
    const fromX = battleView.x
    const toX   = getBattleZoneX(newCols)
    if (expandTickFn) { Ticker.shared.remove(expandTickFn); expandTickFn = null }
    if (Math.abs(toX - fromX) > 1) {
      const durationMs = getDebugCfg('battleZoneExpandMs')
      const startMs    = Date.now()
      expandTickFn = () => {
        const t    = Math.min((Date.now() - startMs) / durationMs, 1)
        const ease = 1 - Math.pow(1 - t, 3)
        battleView!.x = fromX + (toX - fromX) * ease
        applyAreaLabelLeftAlign()
        layoutSkillIconBar()
        if (t >= 1) { Ticker.shared.remove(expandTickFn!); expandTickFn = null }
      }
      Ticker.shared.add(expandTickFn)
    } else {
      battleView.x = toX
      applyAreaLabelLeftAlign()
      layoutSkillIconBar()
    }
  }

  // 3. 同步 ShopManager 天数并刷新商店卡池
  if (shopManager) {
    syncShopOwnedTierRules()
    shopManager.setDay(currentDay)
    // Debug 改天数：每次实际变更天数都发放一次当日金币
    if (currentDay !== prevDay) {
      if (!blockedBaseIncomeDays.has(currentDay)) {
        shopManager.gold += getDailyGoldForDay(getConfig(), currentDay)
      } else {
        blockedBaseIncomeDays.delete(currentDay)
        showHintToast('no_gold_buy', '事件效果：今日基础收入已被透支', 0xffd48f)
      }
      grantSilverDailyGoldBonusesOnNewDay()
      applyFutureEventEffectsOnNewDay(currentDay)
      grantHeroPeriodicEffectsOnNewDay(currentDay)
    }
  }
  if (currentDay !== prevDay) grantSkill20DailyBronzeItemIfNeeded()
  refreshShopUI()

  // 4. 更新 Debug 天数文字
  if (dayDebugText) {
    dayDebugText.text = `Day ${currentDay}`
    layoutDayDebugControls()
  }
  ensureDailyChoiceSelection(getApp().stage)
}

function layoutDayDebugControls(): void {
  if (!dayPrevBtn || !dayNextBtn || !dayDebugText) return
  const gap = Math.max(16, Math.round(dayDebugText.style.fontSize as number))

  // 预留左右等宽箭头槽位，确保 Day 文本始终几何居中
  const arrowSlotW = Math.max(dayPrevBtn.width, dayNextBtn.width)
  dayPrevBtn.x = 0
  dayDebugText.x = arrowSlotW + gap
  dayNextBtn.x = dayDebugText.x + dayDebugText.width + gap + (arrowSlotW - dayNextBtn.width)

  // 垂直也对齐到同一中线
  const maxH = Math.max(dayPrevBtn.height, dayDebugText.height, dayNextBtn.height)
  dayPrevBtn.y = (maxH - dayPrevBtn.height) / 2
  dayDebugText.y = (maxH - dayDebugText.height) / 2
  dayNextBtn.y = (maxH - dayNextBtn.height) / 2

  // 以 Day 文本中心作为容器 pivot，便于全局精确居中
  if (dayDebugCon) {
    dayDebugCon.pivot.x = dayDebugText.x + dayDebugText.width / 2
  }
}

function applyItemInfoPanelLayout(): void {
  if (!sellPopup) return
  sellPopup.setWidth(getDebugCfg('itemInfoWidth'))
  sellPopup.setMinHeight(getDebugCfg('itemInfoMinH'))
  sellPopup.setSmallMinHeight(getDebugCfg('itemInfoMinHSmall'))
  sellPopup.setCornerRadius(getDebugCfg('gridItemCornerRadius'))
  sellPopup.setTextSizes({
    name:  getDebugCfg('itemInfoNameFontSize'),
    tier:  getDebugCfg('itemInfoTierFontSize'),
    cooldown: getDebugCfg('itemInfoCooldownFontSize'),
    priceCorner: getDebugCfg('itemInfoPriceCornerFontSize'),
    desc:  getDebugCfg('itemInfoDescFontSize'),
    simpleDesc: getDebugCfg('itemInfoSimpleDescFontSize'),
  })
  let panelBottomY = getDebugCfg('shopAreaY') - getDebugCfg('itemInfoBottomGapToShop') - 92
  if (skillIconBarCon?.visible) {
    panelBottomY = Math.min(panelBottomY, skillIconBarCon.y - 44)
  }
  sellPopup.setBottomAnchor(panelBottomY)
}

function applyTextSizesFromDebug(): void {
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

  setBtnTextSize(bpBtnHandle, showingBackpack)
  setBtnTextSize(refreshBtnHandle, true)
  setBtnTextSize(sellBtnHandle, false)
  setBtnTextSize(phaseBtnHandle, true)

  if (refreshBtnHandle) {
    const main = refreshBtnHandle.container.getChildByName('btn-main') as Text | null
    if (main) main.style.fontSize = phaseButtonSize
    refreshBtnHandle.redraw(true)
  }

  if (phaseBtnHandle) {
    const main = phaseBtnHandle.container.getChildByName('btn-main') as Text | null
    if (main) main.style.fontSize = buttonSize
    phaseBtnHandle.redraw(true)
  }

  if (refreshCostText) refreshCostText.style.fontSize = getDebugCfg('refreshCostFontSize')
  if (hintToastText) hintToastText.style.fontSize = getDebugCfg('refreshCostFontSize')
  if (livesText) livesText.style.fontSize = getDebugCfg('refreshCostFontSize')
  if (goldText) {
    goldText.style.fontSize = getDebugCfg('goldFontSize')
    const s = getBattleItemScale()
    goldText.scale.set(s)
    goldText.x = getDebugCfg('goldTextCenterX') - goldText.width / 2
    goldText.y = getDebugCfg('goldTextY')
  }
  if (dayPrevBtn) dayPrevBtn.style.fontSize = getDebugCfg('dayDebugArrowFontSize')
  if (dayNextBtn) dayNextBtn.style.fontSize = getDebugCfg('dayDebugArrowFontSize')
  if (dayDebugText) dayDebugText.style.fontSize = getDebugCfg('dayDebugLabelFontSize')
  if (playerStatusLvText) playerStatusLvText.style.fontSize = getDebugCfg('shopPlayerStatusLvFontSize')
  layoutDayDebugControls()

  battleView?.setLabelFontSize(areaLabelSize / (battleView.scale.x || 1))
  backpackView?.setLabelFontSize(areaLabelSize / (backpackView.scale.x || 1))
  shopPanel?.setLabelFontSize(areaLabelSize)
  battleView?.setLabelVisible(false)
  backpackView?.setLabelVisible(false)
  if (battleZoneTitleText) {
    battleZoneTitleText.style.fontSize = areaLabelSize
  }
  if (backpackZoneTitleText) {
    backpackZoneTitleText.style.fontSize = areaLabelSize
  }
  battleView?.setStatBadgeFontSize(getDebugCfg('itemStatBadgeFontSize'))
  backpackView?.setStatBadgeFontSize(getDebugCfg('itemStatBadgeFontSize'))
  battleView?.setTierStarFontSize(getDebugCfg('itemTierStarFontSize'))
  backpackView?.setTierStarFontSize(getDebugCfg('itemTierStarFontSize'))
  battleView?.setTierStarStrokeWidth(getDebugCfg('itemTierStarStrokeWidth'))
  backpackView?.setTierStarStrokeWidth(getDebugCfg('itemTierStarStrokeWidth'))
  battleView?.setTierStarOffsetX(getDebugCfg('itemTierStarOffsetX'))
  backpackView?.setTierStarOffsetX(getDebugCfg('itemTierStarOffsetX'))
  battleView?.setTierStarOffsetY(getDebugCfg('itemTierStarOffsetY'))
  backpackView?.setTierStarOffsetY(getDebugCfg('itemTierStarOffsetY'))
  battleView?.setStatBadgeOffsetY(getDebugCfg('itemStatBadgeOffsetY'))
  backpackView?.setStatBadgeOffsetY(getDebugCfg('itemStatBadgeOffsetY'))
  shopPanel?.setStatBadgeFontSize(getDebugCfg('itemStatBadgeFontSize'))
  shopPanel?.setStatBadgeOffsetY(getDebugCfg('itemStatBadgeOffsetY'))

  shopPanel?.setTextSizes({
    itemName: getDebugCfg('shopItemNameFontSize'),
    itemPrice: getDebugCfg('shopItemPriceFontSize'),
    itemBought: getDebugCfg('shopItemBoughtFontSize'),
  })

  sellPopup?.setTextSizes({
    name: getDebugCfg('itemInfoNameFontSize'),
    tier: getDebugCfg('itemInfoTierFontSize'),
    cooldown: getDebugCfg('itemInfoCooldownFontSize'),
    priceCorner: getDebugCfg('itemInfoPriceCornerFontSize'),
    desc: getDebugCfg('itemInfoDescFontSize'),
    simpleDesc: getDebugCfg('itemInfoSimpleDescFontSize'),
  })
}

function applyAreaLabelLeftAlign(): void {
  battleView?.setLabelGlobalLeft(AREA_LABEL_LEFT_X)
  backpackView?.setLabelGlobalLeft(AREA_LABEL_LEFT_X)
  shopPanel?.setLabelGlobalLeft(AREA_LABEL_LEFT_X)
}

function applyLayoutFromDebug(): void {
  const s = getBattleItemScale()
  const shopScale = getShopItemScale()

  if (shopPanel) {
    shopPanel.x = getDebugCfg('shopAreaX')
    shopPanel.y = getDebugCfg('shopAreaY')
    shopPanel.setItemScale(shopScale)
    shopPanel.setTierBorderWidth(getDebugCfg('tierBorderWidth'))
    shopPanel.setCornerRadius(getDebugCfg('gridItemCornerRadius'))
  }
  if (battleView) {
    battleView.scale.set(s)
    battleView.x = getBattleZoneX(getDayActiveCols(currentDay))
    battleView.y = getDebugCfg('battleZoneY') + (CELL_HEIGHT * (1 - s)) / 2
    battleView.setTierBorderWidth(getDebugCfg('tierBorderWidth'))
    battleView.setCornerRadius(getDebugCfg('gridItemCornerRadius'))
    battleView.setCellBorderWidth(getDebugCfg('gridCellBorderWidth'))
  }
  if (backpackView) {
    backpackView.scale.set(s)
    backpackView.x = getBackpackZoneX(backpackView.activeColCount)
    backpackView.y = getBackpackZoneYByBattle()
    backpackView.setTierBorderWidth(getDebugCfg('tierBorderWidth'))
    backpackView.setCornerRadius(getDebugCfg('gridItemCornerRadius'))
    backpackView.setCellBorderWidth(getDebugCfg('gridCellBorderWidth'))
    backpackView.setLabelGlobalTop(backpackView.y - BACKPACK_LABEL_GLOBAL_Y_GAP)
  }
  if (battleZoneTitleText && battleView) {
    battleZoneTitleText.x = battleView.x + (battleView.activeColCount * CELL_SIZE * s) / 2
    battleZoneTitleText.y = battleView.y - BATTLE_ZONE_TITLE_TOP_GAP
  }
  if (backpackZoneTitleText && backpackView) {
    backpackZoneTitleText.x = backpackView.x + (backpackView.activeColCount * CELL_SIZE * s) / 2
    backpackZoneTitleText.y = backpackView.y - BACKPACK_ZONE_TITLE_TOP_GAP
  }
  if (bpBtnHandle) {
    bpBtnHandle.setCenter(getDebugCfg('backpackBtnX'), getDebugCfg('backpackBtnY'))
  }
  if (sellBtnHandle) {
    sellBtnHandle.setCenter(getDebugCfg('sellBtnX'), getDebugCfg('sellBtnY'))
  }
  if (refreshBtnHandle) {
    refreshBtnHandle.setCenter(getDebugCfg('refreshBtnX'), getDebugCfg('refreshBtnY'))
  }
  if (phaseBtnHandle) {
    phaseBtnHandle.setCenter(getDebugCfg('phaseBtnX'), getDebugCfg('phaseBtnY'))
  }
  if (goldText) {
    goldText.x = getDebugCfg('goldTextCenterX') - goldText.width / 2
    goldText.y = getDebugCfg('goldTextY')
  }
  if (dayDebugCon) {
    dayDebugCon.x = CANVAS_W / 2
    dayDebugCon.y = getDebugCfg('dayDebugY')
  }
  if (livesText) {
    livesText.x = CANVAS_W - livesText.width - 18
    livesText.y = 18
  }
  layoutPlayerStatusPanel()
  if (miniMapCon) {
    miniMapCon.x = getDebugCfg('backpackBtnX') - MINI_W / 2
    miniMapCon.y = getDebugCfg('backpackBtnY') + BTN_RADIUS + 8
  }
  layoutSkillIconBar()

  // 商店/背包/战斗区半透背景：按需求移除
  if (shopAreaBg) { shopAreaBg.clear(); shopAreaBg.visible = false }
  if (backpackAreaBg) { backpackAreaBg.clear(); backpackAreaBg.visible = false }
  if (battleAreaBg) { battleAreaBg.clear(); battleAreaBg.visible = false }

  applyTextSizesFromDebug()
  applyItemInfoPanelLayout()
  applyAreaLabelLeftAlign()
  applyPhaseUiVisibility()
}

function ensureBottomHudVisibleAndOnTop(stage: Container): void {
  if (btnRow) {
    btnRow.visible = true
    stage.addChild(btnRow)
  }
  if (goldText) goldText.visible = true
  applySellButtonState()
}

function applySellButtonState(): void {
  if (specialShopBackpackViewActive) {
    if (sellBtnHandle) {
      sellBtnHandle.container.visible = false
      sellBtnHandle.setSubLabel('')
    }
    if (refreshBtnHandle) refreshBtnHandle.container.visible = false
    if (refreshCostText) refreshCostText.visible = false
    return
  }

  if (!isShopInputEnabled()) {
    if (sellBtnHandle) {
      sellBtnHandle.container.visible = false
      sellBtnHandle.setSubLabel('')
    }
    if (refreshBtnHandle) refreshBtnHandle.container.visible = false
    if (refreshCostText) refreshCostText.visible = false
    return
  }

  if (sellBtnHandle) {
    sellBtnHandle.container.visible = true
    sellBtnHandle.redraw(true)
    sellBtnHandle.setSubLabel('')
  }

  if (refreshBtnHandle) refreshBtnHandle.container.visible = true
  if (refreshCostText) refreshCostText.visible = true
}

function canPlaceInVisibleCols(
  system: GridSystem,
  view: GridZone,
  col: number,
  row: number,
  size: ItemSizeNorm,
): boolean {
  const { w, h } = system.getSizeDim(size)
  if (col < 0 || row < 0) return false
  if (col + w > view.activeColCount) return false
  if (row + h > system.rows) return false
  return system.canPlace(col, row, size)
}

function hasAnyPlaceInVisibleCols(system: GridSystem, view: GridZone, size: ItemSizeNorm): boolean {
  const { w, h } = system.getSizeDim(size)
  const maxCol = view.activeColCount - w
  if (maxCol < 0) return false
  const maxRow = system.rows - h
  if (maxRow < 0) return false
  for (let r = 0; r <= maxRow; r++)
    for (let c = 0; c <= maxCol; c++)
      if (system.canPlace(c, r, size)) return true
  return false
}

function canBattleAcceptShopItem(size: ItemSizeNorm): boolean {
  if (!battleSystem || !battleView) return false
  const w = size === '1x1' ? 1 : size === '2x1' ? 2 : 3
  const h = 1
  const maxCol = battleView.activeColCount - w
  const maxRow = 1 - h
  if (maxCol < 0 || maxRow < 0) return false

  for (let row = 0; row <= maxRow; row++) {
    for (let col = 0; col <= maxCol; col++) {
      const finalRow = row
      if (canPlaceInVisibleCols(battleSystem, battleView, col, finalRow, size)) return true
      const unified = planUnifiedSqueeze(
        { system: battleSystem, activeColCount: battleView.activeColCount },
        col,
        finalRow,
        size,
        '__shop_drag__',
        backpackSystem && backpackView
          ? { system: backpackSystem, activeColCount: backpackView.activeColCount }
          : undefined,
      )
      if (unified) return true
    }
  }
  return false
}

function clearSelection(): void {
  currentSelection = { kind: 'none' }
  selectedSellAction = null
  resetInfoModeSelection()
  hideSkillDetailPopup()
  hideSynthesisHoverInfo()
  shopPanel?.setSelectedSlot(-1)
  battleView?.setSelected(null)
  backpackView?.setSelected(null)
  sellPopup?.hide()
  applySellButtonState()
}

function setSellButtonPrice(price: number): void {
  if (!sellBtnHandle) return
  void price
  sellBtnHandle.setSubLabel('')
}

// ============================================================
// 区域闪光特效
// ============================================================
function startFlashEffect(stage: Container, size: ItemSizeNorm, forceBothZones = false): void {
  stopFlashEffect()

  // 判断各区域是否有空间，无空间则不闪
  const flashBattle = (() => {
    if (forceBothZones) return true
    if (!battleSystem || !battleView) return false
    return canBattleAcceptShopItem(size)
  })()
  const flashBackpack = (() => {
    if (forceBothZones) return true
    if (!backpackSystem || !backpackView) return false
    return hasAnyPlaceInVisibleCols(backpackSystem, backpackView, size)
  })()

  if (!flashBattle && !flashBackpack) return  // 两者都满，不启动特效

  const overlay = new Graphics()
  // 插入到拖拽浮层下方，保证浮层始终在最上层
  const floaterIdx = shopDragFloater ? stage.getChildIndex(shopDragFloater) : stage.children.length
  stage.addChildAt(overlay, floaterIdx)
  flashOverlay = overlay
  let t = 0
  flashTickFn = () => {
    t += 0.05
    const a = 0.10 + 0.10 * Math.sin(t * 3)
    overlay.clear()
    if (flashBattle && battleView) {
      const bx  = battleView.x, by = battleView.y
      const s   = battleView.scale.x
      const bw  = battleView.activeColCount * CELL_SIZE * s
      const bh  = CELL_HEIGHT * s
      const pad = 6  // 略大于格子边框
      overlay.rect(bx - pad + 2, by - pad + 2, bw + pad * 2 - 4, bh + pad * 2 - 4)
      overlay.fill({ color: 0xffcc44, alpha: a * 0.5 })
      overlay.rect(bx - pad, by - pad, bw + pad * 2, bh + pad * 2)
      overlay.stroke({ color: 0xffcc44, width: 4, alpha: a * 2.5 })
    }
    if (flashBackpack) {
      const bpCx = getDebugCfg('backpackBtnX')
      const bpCy = getDebugCfg('backpackBtnY')
      overlay.circle(bpCx, bpCy, BTN_RADIUS + 10)
      overlay.fill({ color: 0xffcc44, alpha: a * 0.4 })
      overlay.circle(bpCx, bpCy, BTN_RADIUS + 14)
      overlay.stroke({ color: 0xffcc44, width: 3, alpha: a * 2.5 })
    }
  }
  Ticker.shared.add(flashTickFn)
}

function stopFlashEffect(): void {
  if (flashTickFn) { Ticker.shared.remove(flashTickFn); flashTickFn = null }
  if (flashOverlay) { flashOverlay.destroy(); flashOverlay = null }
}

const BACKPACK_INCOMING_TMP_ID = '__backpack_incoming__'

type AutoPackCacheEntry = {
  atMs: number
  plan: PackPlacement[] | null
}

type BackpackTransferAnimSeed = {
  defId: string
  size: ItemSizeNorm
  fromGlobal: { x: number; y: number }
  toCol: number
  toRow: number
}

const autoPackPlanCache = new Map<string, AutoPackCacheEntry>()
const AUTO_PACK_CACHE_LIMIT = 80

function clearAutoPackCache(): void {
  autoPackPlanCache.clear()
}

function clonePackPlan(plan: PackPlacement[] | null): PackPlacement[] | null {
  if (!plan) return null
  return plan.map((p) => ({ ...p }))
}

function playBackpackTransferMiniAnim(seeds: BackpackTransferAnimSeed[]): void {
  if (seeds.length === 0 || !miniMapCon || !miniMapCon.visible) return
  const miniCon = miniMapCon
  const { stage } = getApp()
  const layer = new Container()
  layer.eventMode = 'none'
  stage.addChild(layer)

  const durationMs = getDebugCfg('transferToBackpackAnimMs')
  const arcY = getDebugCfg('transferToBackpackArcY')
  const visualScale = getConfig().itemVisualScale
  const iconScale = getDebugCfg('transferToBackpackIconScale')
  const morphStart = Math.max(0.01, Math.min(0.99, getDebugCfg('transferToBackpackMorphStartPct')))
  const holdMs = getDebugCfg('transferToBackpackHoldMs')
  const startAt = Date.now()

  const nodes = seeds.map((seed) => {
    const wrap = new Container()
    wrap.eventMode = 'none'
    const icon = new Sprite(Texture.WHITE)
    const chip = new Graphics()
    const chipSize = MINI_CELL - 2
    chip.roundRect(-chipSize / 2, -chipSize / 2, chipSize, chipSize, 4)
    chip.fill({ color: 0xffcc44, alpha: 0.95 })
    chip.stroke({ color: 0x665022, width: 1, alpha: 0.7 })
    chip.alpha = 0

    const sizeCols = seed.size === '1x1' ? 1 : seed.size === '2x1' ? 2 : 3
    const baseW = Math.max(10, sizeCols * CELL_SIZE * visualScale * iconScale)
    const baseH = Math.max(10, CELL_SIZE * 2 * visualScale * iconScale)
    icon.width = baseW
    icon.height = baseH
    icon.anchor.set(0.5)
    icon.alpha = 0
    wrap.addChild(icon)
    wrap.addChild(chip)

    const from = stage.toLocal(seed.fromGlobal)
    const toGlobal = miniCon.toGlobal({
      x: seed.toCol * MINI_CELL + MINI_CELL / 2,
      y: seed.toRow * MINI_CELL + MINI_CELL / 2,
    })
    const to = stage.toLocal(toGlobal)
    const endScale = Math.min(1, (MINI_CELL - 4) / Math.max(baseW, baseH))

    wrap.x = from.x
    wrap.y = from.y
    wrap.scale.set(1)
    layer.addChild(wrap)

    Assets.load<Texture>(getItemIconUrl(seed.defId))
      .then((tex) => {
        icon.texture = tex
        icon.alpha = 1
      })
      .catch((err) => {
        icon.alpha = 0
        console.warn('[ShopScene] 背包转移动画图标加载失败', seed.defId, err)
      })

    return { wrap, icon, chip, from, to, endScale }
  })

  const tick = () => {
    const tRaw = (Date.now() - startAt) / durationMs
    const t = Math.max(0, Math.min(1, tRaw))
    const ease = 1 - Math.pow(1 - t, 3)
    const swapT = Math.max(0, Math.min(1, (t - morphStart) / (1 - morphStart)))

    for (const n of nodes) {
      n.wrap.x = n.from.x + (n.to.x - n.from.x) * ease
      n.wrap.y = n.from.y + (n.to.y - n.from.y) * ease - Math.sin(Math.PI * t) * arcY
      const s = 1 + (n.endScale - 1) * ease
      n.wrap.scale.set(s)
      n.icon.alpha = 1 - swapT
      n.chip.alpha = swapT
    }

    if (t >= 1) {
      Ticker.shared.remove(tick)
      const holdStart = Date.now()
      const holdTick = () => {
        const p = Math.max(0, Math.min(1, (Date.now() - holdStart) / Math.max(1, holdMs)))
        for (const n of nodes) n.chip.alpha = 1 - p
        if (p >= 1) {
          Ticker.shared.remove(holdTick)
          if (layer.parent) layer.parent.removeChild(layer)
          layer.destroy({ children: true })
        }
      }
      Ticker.shared.add(holdTick)
    }
  }

  Ticker.shared.add(tick)
}

function compactAutoPackCache(): void {
  if (autoPackPlanCache.size <= AUTO_PACK_CACHE_LIMIT) return
  const entries = Array.from(autoPackPlanCache.entries())
  entries.sort((a, b) => a[1].atMs - b[1].atMs)
  const removeCount = autoPackPlanCache.size - AUTO_PACK_CACHE_LIMIT
  for (let i = 0; i < removeCount; i++) {
    const key = entries[i]?.[0]
    if (key) autoPackPlanCache.delete(key)
  }
}

function getBackpackStateSignature(): string {
  if (!backpackSystem || !backpackView) return 'none'
  const items = backpackSystem
    .getAllItems()
    .map((it) => `${it.instanceId}@${it.defId}@${it.size}@${it.col},${it.row}`)
    .sort()
  return `ac${backpackView.activeColCount}|rows${backpackSystem.rows}|${items.join(';')}`
}

function getAutoPackPlanCached(cacheKey: string, build: () => PackPlacement[] | null): PackPlacement[] | null {
  const now = Date.now()
  const throttleMs = getDebugCfg('autoPackThrottleMs')
  const hit = autoPackPlanCache.get(cacheKey)
  if (hit && now - hit.atMs <= throttleMs) {
    hit.atMs = now
    return clonePackPlan(hit.plan)
  }
  const plan = build()
  autoPackPlanCache.set(cacheKey, { atMs: now, plan: clonePackPlan(plan) })
  compactAutoPackCache()
  return clonePackPlan(plan)
}

type BackpackAutoPackPlan = {
  existing: PackPlacement[]
  incoming: { col: number; row: number }
}

function buildBackpackAutoPackPlan(incomingDefId: string, incomingSize: ItemSizeNorm): BackpackAutoPackPlan | null {
  if (!backpackSystem || !backpackView) return null
  const bpSystem = backpackSystem
  const bpView = backpackView
  const signature = getBackpackStateSignature()
  const cacheKey = `incoming|${signature}|${incomingDefId}|${incomingSize}`
  const items: PackItem[] = bpSystem.getAllItems().map(item => ({
    instanceId: item.instanceId,
    defId: item.defId,
    size: item.size,
    preferredCol: item.col,
    preferredRow: item.row,
  }))
  items.push({
    instanceId: BACKPACK_INCOMING_TMP_ID,
    defId: incomingDefId,
    size: incomingSize,
  })
  const plan = getAutoPackPlanCached(cacheKey, () => planAutoPack(items, bpView.activeColCount, bpSystem.rows))
  if (!plan) return null
  const incoming = plan.find(p => p.instanceId === BACKPACK_INCOMING_TMP_ID)
  if (!incoming) return null
  return {
    existing: plan.filter(p => p.instanceId !== BACKPACK_INCOMING_TMP_ID),
    incoming: { col: incoming.col, row: incoming.row },
  }
}

function applyBackpackAutoPackExisting(existingPlan: PackPlacement[]): void {
  if (!backpackSystem || !backpackView) return
  clearAutoPackCache()
  const oldItems = backpackSystem.getAllItems()
  const oldById = new Map(oldItems.map(item => [item.instanceId, item] as const))

  backpackSystem.clear()
  for (const p of existingPlan) {
    backpackSystem.place(p.col, p.row, p.size, p.defId, p.instanceId)
  }

  const moveMs = getDebugCfg('squeezeMs')
  for (const p of existingPlan) {
    const old = oldById.get(p.instanceId)
    if (!old) {
      const tier = getInstanceTier(p.instanceId)
      const star = getInstanceTierStar(p.instanceId)
      backpackView.addItem(p.instanceId, p.defId, p.size, p.col, p.row, toVisualTier(tier, star)).then(() => {
        backpackView!.setItemTier(p.instanceId, toVisualTier(tier, star))
        drag?.refreshZone(backpackView!)
      })
      continue
    }
    if (old.col !== p.col || old.row !== p.row) {
      backpackView.animateToCell(p.instanceId, p.col, p.row, moveMs)
    }
  }
  drag?.refreshZone(backpackView)
}

function canBackpackAcceptByAutoPack(incomingDefId: string, incomingSize: ItemSizeNorm): boolean {
  return buildBackpackAutoPackPlan(incomingDefId, incomingSize) !== null
}

function getOverlapBlockersInBattle(col: number, row: number, size: ItemSizeNorm): Array<{ instanceId: string; defId: string; size: ItemSizeNorm }> {
  if (!battleSystem) return []
  const w = size === '1x1' ? 1 : size === '2x1' ? 2 : 3
  const h = 1
  const blockers = new Set<string>()
  for (let c = col; c < col + w; c++) {
    for (let r = row; r < row + h; r++) {
      for (const it of battleSystem.getAllItems()) {
        const iw = it.size === '1x1' ? 1 : it.size === '2x1' ? 2 : 3
        const ih = 1
        const hit = c >= it.col && c < it.col + iw && r >= it.row && r < it.row + ih
        if (hit) blockers.add(it.instanceId)
      }
    }
  }
  return Array.from(blockers).map((id) => {
    const it = battleSystem!.getItem(id)!
    return { instanceId: id, defId: it.defId, size: it.size }
  })
}

function buildBackpackPlanForTransferred(itemsToTransfer: Array<{ instanceId: string; defId: string; size: ItemSizeNorm }>): PackPlacement[] | null {
  if (!backpackSystem || !backpackView) return null
  const bpSystem = backpackSystem
  const bpView = backpackView
  const signature = getBackpackStateSignature()
  const transferSig = itemsToTransfer
    .map((it) => `${it.instanceId}@${it.defId}@${it.size}`)
    .sort()
    .join(';')
  const cacheKey = `transfer|${signature}|${transferSig}`
  const base: PackItem[] = bpSystem.getAllItems().map((it) => ({
    instanceId: it.instanceId,
    defId: it.defId,
    size: it.size,
    preferredCol: it.col,
    preferredRow: it.row,
  }))
  for (const tr of itemsToTransfer) {
    if (base.some((b) => b.instanceId === tr.instanceId)) continue
    base.push({ instanceId: tr.instanceId, defId: tr.defId, size: tr.size })
  }
  return getAutoPackPlanCached(cacheKey, () => planAutoPack(base, bpView.activeColCount, bpSystem.rows))
}

function applyBackpackPlanWithTransferred(plan: PackPlacement[], transferredIds: Set<string>): void {
  if (!backpackSystem || !backpackView || !battleSystem || !battleView) return
  clearAutoPackCache()

  const transferAnimSeeds: BackpackTransferAnimSeed[] = []
  for (const id of transferredIds) {
    const node = battleView.getNode(id)
    const placed = battleSystem.getItem(id)
    const target = plan.find((p) => p.instanceId === id)
    if (!node || !placed || !target) continue
    const w = placed.size === '1x1' ? CELL_SIZE : placed.size === '2x1' ? CELL_SIZE * 2 : CELL_SIZE * 3
    const h = CELL_HEIGHT
    const fromGlobal = battleView.toGlobal({
      x: node.container.x + w / 2,
      y: node.container.y + h / 2,
    })
    transferAnimSeeds.push({
      defId: placed.defId,
      size: placed.size,
      fromGlobal,
      toCol: target.col,
      toRow: target.row,
    })
  }

  // 先把转移来源从战斗区移除
  for (const id of transferredIds) {
    battleSystem.remove(id)
    battleView.removeItem(id)
  }

  // 重建背包逻辑网格
  backpackSystem.clear()
  for (const p of plan) {
    backpackSystem.place(p.col, p.row, p.size, p.defId, p.instanceId)
  }

  const moveMs = getDebugCfg('squeezeMs')
  for (const p of plan) {
    const tier = getInstanceTier(p.instanceId)
    const star = getInstanceTierStar(p.instanceId)
    if (backpackView.hasItem(p.instanceId)) {
      backpackView.animateToCell(p.instanceId, p.col, p.row, moveMs)
      backpackView.setItemTier(p.instanceId, toVisualTier(tier, star))
    } else {
      backpackView.addItem(p.instanceId, p.defId, p.size, p.col, p.row, toVisualTier(tier, star)).then(() => {
        backpackView!.setItemTier(p.instanceId, toVisualTier(tier, star))
        drag?.refreshZone(backpackView!)
      })
    }
  }

  drag?.refreshZone(backpackView)
  drag?.refreshZone(battleView)
  playBackpackTransferMiniAnim(transferAnimSeeds)
}

function getArchetypeSortOrder(defId: string): number {
  const def = getItemDefById(defId)
  const arch = toSkillArchetype(getPrimaryArchetype(def?.tags ?? ''))
  if (arch === 'warrior') return 0
  if (arch === 'archer') return 1
  if (arch === 'assassin') return 2
  if (arch === 'utility') return 3
  return 4
}

function sortBackpackItemsByRule(): void {
  if (!backpackSystem || !backpackView) return
  const items = backpackSystem.getAllItems()
  if (items.length <= 1) {
    showHintToast('backpack_full_buy', '背包已整理', 0x9be5ff)
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
  for (let row = 0; row < backpackSystem.rows; row++) {
    for (let col = 0; col < backpackView.activeColCount; col++) {
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

  const plan = planAutoPack(packItems, backpackView.activeColCount, backpackSystem.rows)
  if (!plan) {
    showHintToast('backpack_full_buy', '整理失败：背包空间异常', 0xff8f8f)
    return
  }

  applyBackpackAutoPackExisting(plan)
  refreshShopUI()
  showHintToast('backpack_full_buy', '背包已按规则整理', 0x9be5ff)
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

function isOverAnyGridDropTarget(gx: number, gy: number, size: ItemSizeNorm): boolean {
  const dragOffsetY = getDebugCfg('dragYOffset')
  const overBattle = battleView?.pixelToCellForItem(gx, gy, size, dragOffsetY)
  if (overBattle) return true
  const overBackpack = backpackView?.pixelToCellForItem(gx, gy, size, dragOffsetY)
  return !!overBackpack
}

function updateGridDragSellAreaHover(gx: number, gy: number, size: ItemSizeNorm): void {
  if (!gridDragCanSell) {
    gridDragSellHot = false
    return
  }
  const hot = isOverGridDragSellArea(gx, gy) && !isOverAnyGridDropTarget(gx, gy, size)
  gridDragSellHot = hot
}

function startGridDragButtonFlash(stage: Container, canSell: boolean, canToBackpack: boolean, sellPrice = 0): void {
  stopGridDragButtonFlash()
  gridDragCanSell = canSell
  gridDragCanToBackpack = canToBackpack
  void sellPrice
  gridDragSellHot = false
  if (!gridDragCanSell && !gridDragCanToBackpack) return

  if (gridDragCanSell) {
    if (refreshBtnHandle) refreshBtnHandle.container.visible = false
    if (sellBtnHandle) sellBtnHandle.container.visible = false
    if (phaseBtnHandle) phaseBtnHandle.container.visible = false
  }

  const overlay = new Graphics()
  const dragIdx = stage.children.length - 1
  stage.addChildAt(overlay, Math.max(0, dragIdx))
  gridDragFlashOverlay = overlay

  if (gridDragCanSell) {
    const zone = new Container()
    const bg = new Graphics()
    const txt = new Text({
      text: '',
      style: {
        fontSize: getDebugCfg('shopButtonLabelFontSize'),
        fill: 0xffb3b3,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        align: 'center',
      },
    })
    txt.anchor.set(0.5)
    zone.addChild(bg)
    zone.addChild(txt)
    stage.addChildAt(zone, Math.max(0, dragIdx))
    gridDragSellZoneCon = zone
    gridDragSellZoneBg = bg
    gridDragSellZoneText = txt
  }

  let t = 0
  gridDragFlashTick = () => {
    if (!gridDragFlashOverlay) return
    t += 0.05
    const a = 0.12 + 0.10 * Math.sin(t * 3)
    overlay.clear()

    if (gridDragCanSell && sellBtnHandle?.container.visible) {
      const cx = getDebugCfg('sellBtnX')
      const cy = getDebugCfg('sellBtnY')
      overlay.circle(cx, cy, BTN_RADIUS + 10)
      overlay.fill({ color: 0xff4b4b, alpha: a * 0.45 })
      overlay.circle(cx, cy, BTN_RADIUS + 14)
      overlay.stroke({ color: 0xff4b4b, width: 3, alpha: a * 2.4 })
    }
    if (gridDragCanToBackpack) {
      const cx = getDebugCfg('backpackBtnX')
      const cy = getDebugCfg('backpackBtnY')
      overlay.circle(cx, cy, BTN_RADIUS + 10)
      overlay.fill({ color: 0xffcc44, alpha: a * 0.4 })
      overlay.circle(cx, cy, BTN_RADIUS + 14)
      overlay.stroke({ color: 0xffcc44, width: 3, alpha: a * 2.4 })
    }

    if (gridDragSellZoneBg && gridDragSellZoneText) {
      const top = getGridDragSellAreaTopLocalY()
      const h = Math.max(40, CANVAS_H - top)
      const hot = gridDragSellHot
      gridDragSellZoneBg.clear()
      gridDragSellZoneBg.roundRect(0, top, CANVAS_W, h, 16)
      gridDragSellZoneBg.fill({ color: 0xaa2222, alpha: hot ? 0.46 : 0.28 })
      gridDragSellZoneBg.stroke({ color: 0xff5f5f, width: hot ? 4 : 2, alpha: hot ? 0.9 : 0.55 })

      gridDragSellZoneText.style.fill = hot ? 0xfff0f0 : 0xffb3b3
      gridDragSellZoneText.style.fontSize = getDebugCfg('shopButtonLabelFontSize')
      gridDragSellZoneText.text = '拖动到此处丢弃'
      gridDragSellZoneText.x = CANVAS_W / 2
      gridDragSellZoneText.y = top + h / 2
    }
  }
  Ticker.shared.add(gridDragFlashTick)
}

function stopGridDragButtonFlash(): void {
  if (gridDragFlashTick) { Ticker.shared.remove(gridDragFlashTick); gridDragFlashTick = null }
  if (gridDragFlashOverlay) { gridDragFlashOverlay.destroy(); gridDragFlashOverlay = null }
  if (gridDragSellZoneCon) { gridDragSellZoneCon.destroy({ children: true }); gridDragSellZoneCon = null }
  gridDragSellZoneBg = null
  gridDragSellZoneText = null
  gridDragCanSell = false
  gridDragCanToBackpack = false
  gridDragSellHot = false

  const inShop = isShopInputEnabled()
  if (refreshBtnHandle) refreshBtnHandle.container.visible = inShop
  if (sellBtnHandle) sellBtnHandle.container.visible = inShop
  if (phaseBtnHandle) phaseBtnHandle.container.visible = true
  applySellButtonState()
}


// ============================================================
// 商店拖拽：开始
// ============================================================
function startShopDrag(
  slotIndex: number,
  e: FederatedPointerEvent,
  stage: Container,
): void {
  if (!isShopInputEnabled()) return
  if (!shopManager) return
  clearSelection()
  const slot = shopManager.pool[slotIndex]
  if (!slot || slot.purchased || !canAffordShopSlot(slot)) return

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

  shopDragFloater   = floater
  shopDragSlotIdx   = slotIndex
  shopDragHiddenSlot = slotIndex
  shopDragSize      = size
  shopDragPointerId = e.pointerId
  shopPanel?.setSlotDragging(slotIndex, true)

  // 拖拽中视为选中：显示物品详情
  currentSelection = { kind: 'shop', slotIndex }
  selectedSellAction = null
  sellPopup?.show(slot.item, getShopSlotPreviewPrice(slot), 'buy', slot.tier)
  applySellButtonState()

  startFlashEffect(stage, size)
}

// ============================================================
// 商店拖拽：移动
// ============================================================
function onShopDragMove(e: FederatedPointerEvent): void {
  if (!isShopInputEnabled()) return
  if (!shopDragFloater || !shopDragSize) return
  if (e.pointerId !== shopDragPointerId) return

  const dragSlot = shopManager?.pool[shopDragSlotIdx]
  refreshBackpackSynthesisGuideArrows(dragSlot?.item.id ?? null, dragSlot?.tier ?? null, 1)

  const s = 1

  const iconW   = shopDragSize === '1x1' ? CELL_SIZE : shopDragSize === '2x1' ? CELL_SIZE * 2 : CELL_SIZE * 3
  const iconH   = iconW
  const offsetY = getDebugCfg('dragYOffset')
  const stage = getApp().stage
  const p = stage.toLocal(e.global)
  shopDragFloater.scale.set(s)
  shopDragFloater.x = p.x - (iconW * s) / 2
  shopDragFloater.y = p.y + offsetY - (iconH * s) / 2

  const gx = e.globalX, gy = e.globalY
  const battleCell = battleView?.pixelToCellForItem(gx, gy, shopDragSize, 0)
  let synthTarget = dragSlot
    ? findSynthesisTargetWithDragProbe(dragSlot.item.id, dragSlot.tier, 1, gx, gy, shopDragSize)
    : null

  if (synthTarget) {
    highlightSynthesisTarget(synthTarget)
    if (dragSlot) showSynthesisHoverInfo(dragSlot.item.id, dragSlot.tier, 1, synthTarget)
    return
  }
  hideSynthesisHoverInfo()

  if (dragSlot && sellPopup) {
    sellPopup.show(dragSlot.item, getShopSlotPreviewPrice(dragSlot), 'buy', toVisualTier(dragSlot.tier, 1), undefined, getDefaultItemInfoMode())
  }

  if (battleCell && battleSystem) {
    const finalRow = battleCell.row
    let canDirect = canPlaceInVisibleCols(battleSystem, battleView!, battleCell.col, finalRow, shopDragSize)

    if (!canDirect) {
      const unified = planUnifiedSqueeze(
        { system: battleSystem, activeColCount: battleView!.activeColCount },
        battleCell.col,
        finalRow,
        shopDragSize,
        '__shop_drag__',
        backpackSystem && backpackView
          ? { system: backpackSystem, activeColCount: backpackView.activeColCount }
          : undefined,
      )
      if (unified?.mode === 'local' && unified.moves.length > 0) {
        const squeezeMs = getDebugCfg('squeezeMs')
        for (const move of unified.moves) {
          const movedItem = battleSystem.getItem(move.instanceId)
          if (!movedItem) continue
          battleSystem.remove(move.instanceId)
          battleSystem.place(move.newCol, move.newRow, movedItem.size, movedItem.defId, move.instanceId)
          battleView!.animateToCell(move.instanceId, move.newCol, move.newRow, squeezeMs)
        }
        canDirect = canPlaceInVisibleCols(battleSystem, battleView!, battleCell.col, finalRow, shopDragSize)
      }
    }

    let canReplaceToBackpack = false
    if (!canDirect) {
      const blockers = getOverlapBlockersInBattle(battleCell.col, finalRow, shopDragSize)
      if (blockers.length > 0) {
        const transferPlan = buildBackpackPlanForTransferred(blockers)
        canReplaceToBackpack = transferPlan !== null
      }
    }

    battleView!.highlightCells(
      battleCell.col,
      battleCell.row,
      shopDragSize,
      canDirect || canReplaceToBackpack,
      undefined,
    )
  } else {
    battleView?.clearHighlight()
  }

  if (backpackView?.visible) {
    const bpCell = backpackView.pixelToCellForItem(gx, gy, shopDragSize, 0)
    if (bpCell && backpackSystem) {
      backpackView.highlightCells(bpCell.col, bpCell.row, shopDragSize,
        canPlaceInVisibleCols(backpackSystem, backpackView, bpCell.col, bpCell.row, shopDragSize))
    } else {
      backpackView.clearHighlight()
    }
  }
}

// ============================================================
// 商店拖拽：结束
// ============================================================
async function onShopDragEnd(e: FederatedPointerEvent, stage: Container): Promise<void> {
  if (!isShopInputEnabled()) {
    applyPhaseInputLock()
    return
  }
  if (!shopDragFloater || shopDragSlotIdx < 0 || !shopDragSize) return
  if (e.pointerId !== shopDragPointerId) return

  const slot = shopManager?.pool[shopDragSlotIdx]

  stopFlashEffect()
  battleView?.clearHighlight()
  backpackView?.clearHighlight()
  hideSynthesisHoverInfo()
  clearBackpackSynthesisGuideArrows()

  if (!slot || !shopManager || !shopDragSize) { _resetDrag(); return }
  if (!canBuyItemUnderFirstPurchaseRule(slot.item)) {
    showFirstPurchaseRuleHint()
    _resetDrag(); return
  }

  const gx = e.globalX, gy = e.globalY
  const size = shopDragSize
  let synthTarget = findSynthesisTargetWithDragProbe(slot.item.id, slot.tier, 1, gx, gy, size)
  const battleCell = battleView?.pixelToCellForItem(gx, gy, size, 0)
  const bpCell = backpackView?.visible ? backpackView.pixelToCellForItem(gx, gy, size, 0) : null
  const overBattleArea = isPointInZoneArea(battleView, gx, gy)
  const onBpBtn = _isOverBpBtn(gx, gy)

  if (synthTarget) {
    const targetItem = getSynthesisTargetItem(synthTarget)
    const targetTier = getInstanceTier(synthTarget.instanceId) ?? slot.tier
    const targetStar = getInstanceTierStar(synthTarget.instanceId)
    const lv7MorphMode = !!targetItem && canUseLv7MorphSynthesis(slot.item.id, targetItem.defId, slot.tier, 1, targetTier, targetStar)
    if (lv7MorphMode) {
      showLv7MorphSynthesisConfirmOverlay(stage, () => {
        const choices = buildStoneTransformChoices(synthTarget, 'same')
        if (choices.length <= 0) {
          showHintToast('backpack_full_buy', 'Lv7转化：当前无可用候选', 0xffb27a)
          refreshShopUI()
          return
        }
        const opened = showNeutralChoiceOverlay(stage, '选择变化方向', choices, (picked) => {
          const buyRet = tryBuyShopSlotWithSkill(slot)
          if (!buyRet.ok) {
            showHintToast('no_gold_buy', '金币不足，无法购买', 0xff8f8f)
            refreshShopUI()
            return false
          }
          markShopPurchaseDone()
          const ok = transformPlacedItemKeepLevelTo(synthTarget.instanceId, synthTarget.zone, picked.item, true)
          if (!ok) {
            showHintToast('backpack_full_buy', 'Lv7转化失败', 0xff8f8f)
            refreshShopUI()
            return false
          }
          grantSynthesisExp(1, { instanceId: synthTarget.instanceId, zone: synthTarget.zone })
          showHintToast('no_gold_buy', 'Lv7合成：已触发变化石效果', 0x9be5ff)
          refreshShopUI()
          return true
        }, 'special_shop_like')
        if (!opened) {
          showHintToast('backpack_full_buy', 'Lv7转化：当前无可用候选', 0xffb27a)
          refreshShopUI()
        }
      })
      _resetDrag()
      return
    }
    const isCrossId = !!targetItem && targetItem.defId !== slot.item.id
    if (isCrossId) {
      const targetDef = targetItem ? getItemDefById(targetItem.defId) : null
      if (!targetItem || !targetDef) {
        _resetDrag()
        return
      }
      const upgradeTo = nextTierLevel(slot.tier, 1)
      if (!upgradeTo) {
        _resetDrag()
        return
      }
      const runCrossSynthesis = () => {
        const buyRet = tryBuyShopSlotWithSkill(slot)
        if (!buyRet.ok) {
          showHintToast('no_gold_buy', '金币不足，无法购买', 0xff8f8f)
          refreshShopUI()
          return
        }
        markShopPurchaseDone()
        const synth = synthesizeTarget(slot.item.id, slot.tier, 1, synthTarget.instanceId, synthTarget.zone)
        if (!synth) {
          showHintToast('backpack_full_buy', '合成目标无效', 0xff8f8f)
          refreshShopUI()
          return
        }
        playSynthesisFlashEffect(stage, synth)
        if (!tryRunHeroCrossSynthesisReroll(stage, synth)) {
          refreshShopUI()
        }
      }
      if (isCrossIdSynthesisConfirmEnabled()) {
        showCrossSynthesisConfirmOverlay(
          stage,
          { def: slot.item, tier: slot.tier, star: 1 },
          { def: targetDef, tier: targetTier, star: targetStar },
          upgradeTo.tier,
          upgradeTo.star,
          runCrossSynthesis,
        )
      } else {
        runCrossSynthesis()
      }
      _resetDrag()
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
          showHintToast('no_gold_buy', '金币不足，无法购买', 0xff8f8f)
          return false
        }
        markShopPurchaseDone()
        return true
      },
    )) {
      _resetDrag(); return
    }

    if (!tryBuyShopSlotWithSkill(slot).ok) {
      showHintToast('no_gold_buy', '金币不足，无法购买', 0xff8f8f)
      _resetDrag(); return
    }
    markShopPurchaseDone()
    const synth = synthesizeTarget(slot.item.id, slot.tier, 1, synthTarget.instanceId, synthTarget.zone)
    if (!synth) {
      showHintToast('backpack_full_buy', '合成目标无效', 0xff8f8f)
      refreshShopUI()
      _resetDrag(); return
    }
    playSynthesisFlashEffect(stage, synth)
    refreshShopUI()
    _resetDrag(); return
  }

  // 仅当落点在战斗区（含合成范围）/背包格子/背包按钮时才允许购买
  if (!overBattleArea && !bpCell && !onBpBtn) {
    _resetDrag()
    return
  }

  // 战斗区放置
  const battleFinalRow = battleCell ? battleCell.row : 0
  const battleCanDirect = !!(battleCell && battleSystem && battleView
    && canPlaceInVisibleCols(battleSystem, battleView, battleCell.col, battleFinalRow, size))
  let battleSqueezeMoves: { instanceId: string; newCol: number; newRow: number }[] = []
  const battleUnified = (!battleCanDirect && battleCell && battleSystem && battleView)
    ? planUnifiedSqueeze(
      { system: battleSystem, activeColCount: battleView.activeColCount },
      battleCell.col,
      battleFinalRow,
      size,
      '__shop_drag__',
      backpackSystem && backpackView
        ? { system: backpackSystem, activeColCount: backpackView.activeColCount }
        : undefined,
    )
    : null
  if (battleUnified?.mode === 'local') battleSqueezeMoves = battleUnified.moves

  let battleTransferPlan: PackPlacement[] | null = null
  let battleTransferredIds = new Set<string>()
  if (!battleCanDirect && battleSqueezeMoves.length === 0 && battleCell && battleSystem && battleView) {
    if (battleUnified?.mode === 'cross') {
      const blockersById = new Map(getOverlapBlockersInBattle(battleCell.col, battleFinalRow, size).map(b => [b.instanceId, b] as const))
      const transfers = battleUnified.transfers.map(t => blockersById.get(t.instanceId)).filter((v): v is { instanceId: string; defId: string; size: ItemSizeNorm } => !!v)
      const plan = buildBackpackPlanForTransferred(transfers)
      if (plan) {
        battleTransferPlan = plan
        battleTransferredIds = new Set(transfers.map((b) => b.instanceId))
      }
    }
  }
  if (!battleCanDirect && battleSqueezeMoves.length === 0 && battleCell && battleSystem && battleView && battleTransferPlan === null) {
    const blockers = getOverlapBlockersInBattle(battleCell.col, battleFinalRow, size)
    if (blockers.length > 0) {
      const plan = buildBackpackPlanForTransferred(blockers)
      if (plan) {
        battleTransferPlan = plan
        battleTransferredIds = new Set(blockers.map((b) => b.instanceId))
      }
    }
  }
  if (
    battleSystem && battleView
    && (
      (battleCell && (battleCanDirect || battleSqueezeMoves.length > 0))
      || (battleCell && battleTransferPlan !== null)
    )
  ) {
    if (tryBuyShopSlotWithSkill(slot).ok) {
      markShopPurchaseDone()
      if (!battleCell) { _resetDrag(); return }
      if (battleSqueezeMoves.length > 0) {
        const squeezeMs = getDebugCfg('squeezeMs')
        for (const move of battleSqueezeMoves) {
          const movedItem = battleSystem.getItem(move.instanceId)
          if (!movedItem) continue
          battleSystem.remove(move.instanceId)
          battleSystem.place(move.newCol, move.newRow, movedItem.size, movedItem.defId, move.instanceId)
          battleView.animateToCell(move.instanceId, move.newCol, move.newRow, squeezeMs)
        }
      }
      if (battleTransferPlan && battleTransferredIds.size > 0) {
        applyBackpackPlanWithTransferred(battleTransferPlan, battleTransferredIds)
      }
      const id = nextId()
      battleSystem.place(battleCell.col, battleFinalRow, size, slot.item.id, id)
      battleView!.addItem(id, slot.item.id, size, battleCell.col, battleFinalRow, toVisualTier(slot.tier, 1))
        .then(() => {
          battleView!.setItemTier(id, toVisualTier(slot.tier, 1))
          drag?.refreshZone(battleView!)
        })
      instanceToDefId.set(id, slot.item.id)
      setInstanceQualityLevel(id, slot.item.id, parseTierName(slot.item.starting_tier) ?? 'Bronze', 1)
      instanceToPermanentDamageBonus.set(id, 0)
      recordNeutralItemObtained(slot.item.id)
      unlockItemToPool(slot.item.id)
      refreshShopUI()
    } else {
      showHintToast('no_gold_buy', '金币不足，无法购买', 0xff8f8f)
    }
    _resetDrag(); return
  }

  // 背包区放置
  if (bpCell || onBpBtn) {
    const directCell = bpCell && backpackSystem && backpackView
      ? (() => {
        const finalRow = bpCell.row
        return canPlaceInVisibleCols(backpackSystem, backpackView, bpCell.col, finalRow, size)
          ? { col: bpCell.col, row: finalRow }
          : null
      })()
      : null
    const buttonCell = onBpBtn ? findFirstBackpackPlace(size) : null
    const targetCell = directCell ?? buttonCell
    if (!targetCell) {
      showHintToast('backpack_full_buy', '背包已满，无法购买', 0xff8f8f)
      _resetDrag(); return
    }

    if (!tryBuyShopSlotWithSkill(slot).ok) {
      showHintToast('no_gold_buy', '金币不足，无法购买', 0xff8f8f)
      _resetDrag(); return
    }
    markShopPurchaseDone()

    const id = nextId()
    backpackSystem!.place(targetCell.col, targetCell.row, size, slot.item.id, id)
    backpackView!.addItem(id, slot.item.id, size, targetCell.col, targetCell.row, toVisualTier(slot.tier, 1))
      .then(() => {
        backpackView!.setItemTier(id, toVisualTier(slot.tier, 1))
        drag?.refreshZone(backpackView!)
      })
    instanceToDefId.set(id, slot.item.id)
    setInstanceQualityLevel(id, slot.item.id, parseTierName(slot.item.starting_tier) ?? 'Bronze', 1)
    instanceToPermanentDamageBonus.set(id, 0)
    recordNeutralItemObtained(slot.item.id)
    unlockItemToPool(slot.item.id)
    refreshShopUI()
  }

  _resetDrag()
}

function _resetDrag(): void {
  if (shopDragFloater) {
    const p = shopDragFloater.parent
    if (p) p.removeChild(shopDragFloater)
    shopDragFloater.destroy({ children: true })
    shopDragFloater = null
  }
  if (shopDragHiddenSlot >= 0) {
    shopPanel?.setSlotDragging(shopDragHiddenSlot, false)
  }
  shopDragHiddenSlot = -1
  shopDragSlotIdx = -1; shopDragSize = null; shopDragPointerId = -1
  hideSynthesisHoverInfo()
  clearBackpackSynthesisGuideArrows()
  clearSelection()
}

function _isOverBpBtn(gx: number, gy: number): boolean {
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
// PVP 玩家列表 Overlay（商店阶段点击 HP 文字弹出）
// ============================================================

/** 展开的玩家 index（-1 = 无） */
let pvpPlayerListExpandedIndex = -1

function openPvpPlayerListOverlay(): void {
  if (!pvpPlayerListOverlay) {
    const { stage } = getApp()
    const overlay = new Container()
    overlay.zIndex = 200
    overlay.visible = false
    stage.addChild(overlay)
    pvpPlayerListOverlay = overlay
  }
  pvpPlayerListExpandedIndex = -1
  buildPvpPlayerListContent(pvpPlayerListOverlay)
  pvpPlayerListOverlay.visible = true
}

function closePvpPlayerListOverlay(): void {
  if (pvpPlayerListOverlay) pvpPlayerListOverlay.visible = false
}

function buildPvpPlayerListContent(overlay: Container): void {
  overlay.removeChildren()

  const session = PvpContext.getSession()
  if (!session) return

  const snapshots = PvpContext.getLastPlayerSnapshots()

  // 布局常量
  const PANEL_W2 = 580
  const PANEL_X = (CANVAS_W - PANEL_W2) / 2
  const PANEL_Y = 100
  const HEADER_H = 72         // 标题区高度
  const ROW_H = 100           // 每行高度（三行内容：昵称/HP/操作）
  const ROW_GAP = 6
  const SNAP_H = 170
  const BOTTOM_PAD = 24
  const ROW_W = PANEL_W2 - 32
  const initHp = session.initialHp ?? 30

  const players = [...session.players].sort((a, b) => {
    const elimA = session.eliminatedPlayers.includes(a.index) ? 1 : 0
    const elimB = session.eliminatedPlayers.includes(b.index) ? 1 : 0
    if (elimA !== elimB) return elimA - elimB
    return (session.playerHps?.[b.index] ?? 0) - (session.playerHps?.[a.index] ?? 0)
  })

  // 预算面板高度（内容自适应）
  let contentH = HEADER_H
  for (const p of players) {
    contentH += ROW_H + ROW_GAP
    if (pvpPlayerListExpandedIndex === p.index && !!snapshots[p.index]) {
      contentH += SNAP_H + 4
    }
  }
  contentH += BOTTOM_PAD
  const panelH = Math.min(contentH, CANVAS_H - PANEL_Y - 80)

  // 背景遮罩（点击关闭）
  const mask = new Graphics()
  mask.rect(0, 0, CANVAS_W, CANVAS_H).fill({ color: 0x000000, alpha: 0.68 })
  mask.eventMode = 'static'
  mask.on('pointerdown', closePvpPlayerListOverlay)
  overlay.addChild(mask)

  // 面板背景
  const panelBg = new Graphics()
  panelBg.roundRect(PANEL_X, PANEL_Y, PANEL_W2, panelH, 20).fill({ color: 0x0d1520 })
  panelBg.roundRect(PANEL_X, PANEL_Y, PANEL_W2, panelH, 20).stroke({ color: 0x2a3d5c, width: 1.5 })
  panelBg.eventMode = 'static'
  overlay.addChild(panelBg)

  // 标题
  const titleT = new Text({
    text: '玩家状态',
    style: { fill: 0xffd86b, fontSize: 32, fontWeight: 'bold', align: 'center' },
  })
  titleT.anchor.set(0.5, 0.5)
  titleT.x = CANVAS_W / 2
  titleT.y = PANEL_Y + HEADER_H / 2
  overlay.addChild(titleT)

  // 标题分隔线
  const divG = new Graphics()
  divG.rect(PANEL_X + 20, PANEL_Y + HEADER_H - 1, PANEL_W2 - 40, 1).fill({ color: 0x1e2e44 })
  overlay.addChild(divG)

  // 关闭按钮（右上角）
  const closeBtn = new Container()
  const closeBg = new Graphics()
  closeBg.roundRect(-28, -28, 56, 56, 10).fill({ color: 0x162035 })
  closeBtn.addChild(closeBg)
  const closeT = new Text({ text: '✕', style: { fill: 0x8899bb, fontSize: 26, fontWeight: 'bold' } })
  closeT.anchor.set(0.5)
  closeBtn.addChild(closeT)
  closeBtn.x = PANEL_X + PANEL_W2 - 36
  closeBtn.y = PANEL_Y + HEADER_H / 2
  closeBtn.eventMode = 'static'
  closeBtn.cursor = 'pointer'
  closeBtn.on('pointerdown', closePvpPlayerListOverlay)
  closeBtn.on('pointerover', () => { closeBtn.alpha = 0.7 })
  closeBtn.on('pointerout', () => { closeBtn.alpha = 1 })
  overlay.addChild(closeBtn)

  // 行列表（动态 Y 累加）
  let cursorY = PANEL_Y + HEADER_H + 8

  players.forEach((player, i) => {
    const hp = session.playerHps?.[player.index] ?? 0
    const eliminated = session.eliminatedPlayers.includes(player.index)
    const isMe = player.index === session.myIndex
    const hasSnap = !!snapshots[player.index]
    const isExpanded = pvpPlayerListExpandedIndex === player.index && hasSnap

    // HP 颜色
    const hpColor = eliminated ? 0x554433
      : hp <= 2 ? 0xff7766
      : hp <= Math.ceil(initHp / 2) ? 0xffd86b
      : 0x7fff7f

    // ── 行容器 ──────────────────────────────────────────
    const rowCon = new Container()
    rowCon.x = PANEL_X + 16
    rowCon.y = cursorY
    rowCon.eventMode = 'static'

    const rowBg = new Graphics()
    rowBg.roundRect(0, 0, ROW_W, ROW_H, 12)
      .fill({ color: isMe ? 0x18102e : (eliminated ? 0x0c1018 : 0x10192a) })
    rowBg.roundRect(0, 0, ROW_W, ROW_H, 12)
      .stroke({ color: isMe ? 0x6644aa : (eliminated ? 0x1c2230 : 0x1c2e44), width: 1 })
    rowCon.addChild(rowBg)

    // 左侧彩色条
    const stripe = new Graphics()
    stripe.roundRect(0, 8, 4, ROW_H - 16, 2)
      .fill({ color: eliminated ? 0x443322 : (isMe ? 0x8855cc : 0x3a66aa) })
    rowCon.addChild(stripe)

    // 排名序号（居中左侧列）
    const rankT = new Text({
      text: String(i + 1),
      style: { fill: eliminated ? 0x445566 : 0x5577aa, fontSize: 22, fontWeight: 'bold' },
    })
    rankT.anchor.set(0.5, 0.5)
    rankT.x = 26
    rankT.y = ROW_H / 2
    rowCon.addChild(rankT)

    // ── 左侧内容（昵称 + 状态）──
    const nameT = new Text({
      text: player.nickname + (isMe ? ' (我)' : ''),
      style: {
        fill: isMe ? 0xffd86b : (eliminated ? 0x445566 : 0xccddf0),
        fontSize: 26,
        fontWeight: isMe ? 'bold' : 'normal',
      },
    })
    nameT.anchor.set(0, 0)
    nameT.x = 52
    nameT.y = 14
    rowCon.addChild(nameT)

    const gold = snapshots[player.index]?.playerGold
    const goldStr = gold !== undefined ? `  💰 ${gold}G` : ''
    const statusT = new Text({
      text: (eliminated ? '已淘汰' : '存活中') + goldStr,
      style: { fill: eliminated ? 0x665544 : 0x4a9966, fontSize: 17 },
    })
    statusT.anchor.set(0, 0)
    statusT.x = 52
    statusT.y = 50
    rowCon.addChild(statusT)

    if (hasSnap && !eliminated) {
      const hintT = new Text({
        text: isExpanded ? '收起 ▴' : '查看阵容 ▾',
        style: { fill: 0x4488cc, fontSize: 17 },
      })
      hintT.anchor.set(0, 0)
      hintT.x = 52
      hintT.y = 74
      rowCon.addChild(hintT)
    }

    // ── 右侧内容（HP 数字 + 格子）──
    const hpT = new Text({
      text: eliminated ? '0 HP' : `${hp} HP`,
      style: { fill: hpColor, fontSize: 28, fontWeight: 'bold' },
    })
    hpT.anchor.set(1, 0)
    hpT.x = ROW_W - 14
    hpT.y = 14
    rowCon.addChild(hpT)

    // HP 格子
    const maxDots = Math.min(initHp, 12)
    const dotSize = 13
    const dotGap = 4
    const dotsW = maxDots * (dotSize + dotGap) - dotGap
    const dotsStartX = ROW_W - 14 - dotsW
    for (let d = 0; d < maxDots; d++) {
      const filled = !eliminated && d < hp
      const dot = new Graphics()
      dot.roundRect(dotsStartX + d * (dotSize + dotGap), 54, dotSize, dotSize, 3)
        .fill({ color: filled ? hpColor : 0x1a2535 })
      rowCon.addChild(dot)
    }

    // 点击展开/收起
    if (hasSnap && !eliminated) {
      rowCon.cursor = 'pointer'
      rowCon.on('pointerdown', () => {
        pvpPlayerListExpandedIndex = pvpPlayerListExpandedIndex === player.index ? -1 : player.index
        buildPvpPlayerListContent(overlay)
      })
      rowCon.on('pointerover', () => { rowBg.alpha = 0.78 })
      rowCon.on('pointerout', () => { rowBg.alpha = 1 })
    }

    overlay.addChild(rowCon)
    cursorY += ROW_H + ROW_GAP

    // ── 展开阵容面板 ──────────────────────────────────
    if (isExpanded) {
      const snap = snapshots[player.index]!
      const snapCon = new Container()
      snapCon.x = PANEL_X + 16
      snapCon.y = cursorY - ROW_GAP + 2

      const snapBg = new Graphics()
      snapBg.roundRect(0, 0, ROW_W, SNAP_H, 10).fill({ color: 0x0a1420 })
      snapBg.roundRect(0, 0, ROW_W, SNAP_H, 10).stroke({ color: 0x223344, width: 1 })
      snapCon.addChild(snapBg)

      const snapLabel = new Text({ text: '上局阵容', style: { fill: 0x4477aa, fontSize: 17 } })
      snapLabel.x = 14
      snapLabel.y = 10
      snapCon.addChild(snapLabel)

      const ICON_SIZE = 60
      const ICON_GAP = 8
      const ICON_START_X = 14
      const ICON_START_Y = 38
      let col = 0
      let iconRow = 0
      const maxCols = Math.floor((ROW_W - 28) / (ICON_SIZE + ICON_GAP))

      for (const entity of snap.entities) {
        if (!entity.defId) continue
        const ix = ICON_START_X + col * (ICON_SIZE + ICON_GAP)
        const iy = ICON_START_Y + iconRow * (ICON_SIZE + ICON_GAP)

        const iconBg = new Graphics()
        iconBg.roundRect(ix, iy, ICON_SIZE, ICON_SIZE, 8).fill({ color: 0x162030 })
        snapCon.addChild(iconBg)

        Assets.load(getItemIconUrl(entity.defId)).then((tex: Texture) => {
          if (!snapCon.destroyed) {
            const sprite = new Sprite(tex)
            sprite.x = ix
            sprite.y = iy
            sprite.width = ICON_SIZE
            sprite.height = ICON_SIZE
            snapCon.addChild(sprite)
          }
        }).catch(() => {})

        col++
        if (col >= maxCols) { col = 0; iconRow++ }
      }

      if (snap.entities.filter(e => e.defId).length === 0) {
        const emptyT = new Text({ text: '（空阵容）', style: { fill: 0x3a4e60, fontSize: 18 } })
        emptyT.anchor.set(0.5)
        emptyT.x = ROW_W / 2
        emptyT.y = SNAP_H / 2
        snapCon.addChild(emptyT)
      }

      overlay.addChild(snapCon)
      cursorY += SNAP_H + 4
    }
  })
}

// ============================================================
// 臭鸡蛋动效
// ============================================================

/** 扔蛋方：从按钮位置飞出一颗旋转上升的鸡蛋 */
function spawnFloatingEggFx(stageRef: Container, fromX: number, fromY: number): void {
  const eggT = new Text({ text: '🥚', style: { fontSize: 52 } })
  eggT.anchor.set(0.5)
  eggT.x = fromX
  eggT.y = fromY
  eggT.zIndex = 350
  stageRef.addChild(eggT)

  const totalMs = 750
  let elapsed = 0
  const tick = (ticker: { deltaMS: number }): void => {
    elapsed += ticker.deltaMS
    const t = Math.min(1, elapsed / totalMs)
    eggT.y = fromY - 200 * t
    eggT.x = fromX + Math.sin(t * Math.PI * 3) * 28
    eggT.rotation = t * Math.PI * 4
    eggT.scale.set(1 + Math.sin(t * Math.PI) * 0.35)
    eggT.alpha = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45
    if (t >= 1) {
      Ticker.shared.remove(tick)
      if (eggT.parent) eggT.parent.removeChild(eggT)
      eggT.destroy()
    }
  }
  Ticker.shared.add(tick)
}

/** 被扔方：全屏大字特效 + 背景闪烁 */
function showEggSplatOverlay(fromNickname: string): void {
  const stageRef = getApp().stage
  const con = new Container()
  con.zIndex = 400
  con.sortableChildren = true
  stageRef.addChild(con)


  // 大鸡蛋
  const bigEgg = new Text({ text: '🥚', style: { fontSize: 128 } })
  bigEgg.anchor.set(0.5)
  bigEgg.x = CANVAS_W / 2
  bigEgg.y = CANVAS_H / 2 - 200
  bigEgg.scale.set(0.1)
  con.addChild(bigEgg)

  // 爆炸符
  const boomT = new Text({ text: '💥', style: { fontSize: 72 } })
  boomT.anchor.set(0.5)
  boomT.x = CANVAS_W / 2 + 60
  boomT.y = CANVAS_H / 2 - 230
  boomT.alpha = 0
  con.addChild(boomT)

  // 说明文字
  const msgT = new Text({
    text: `${fromNickname} 向你扔了一个臭鸡蛋！`,
    style: {
      fill: 0xffee55,
      fontSize: 28,
      fontWeight: 'bold',
      stroke: { color: 0x000000, width: 5 },
      align: 'center',
      wordWrap: true,
      wordWrapWidth: CANVAS_W - 80,
    },
  })
  msgT.anchor.set(0.5)
  msgT.x = CANVAS_W / 2
  msgT.y = CANVAS_H / 2 - 60
  msgT.alpha = 0
  con.addChild(msgT)

  const SCALE_IN_MS = 300
  const HOLD_MS = 700
  const FADE_MS = 400
  let elapsed = 0

  const tick = (ticker: { deltaMS: number }): void => {
    elapsed += ticker.deltaMS
    if (elapsed <= SCALE_IN_MS) {
      const t = elapsed / SCALE_IN_MS
      // 弹性弹入：超出后回弹
      const scale = t < 0.65
        ? 1.5 * (t / 0.65)
        : 1.5 - 0.5 * ((t - 0.65) / 0.35)
      bigEgg.scale.set(scale)
      bigEgg.rotation = (1 - t) * 0.6 * (Math.sin(t * Math.PI * 6) > 0 ? 1 : -1)
      boomT.alpha = t > 0.4 ? (t - 0.4) / 0.6 : 0
      boomT.scale.set(0.5 + t * 0.7)
      msgT.alpha = t > 0.5 ? (t - 0.5) / 0.5 : 0
    } else if (elapsed <= SCALE_IN_MS + HOLD_MS) {
      bigEgg.scale.set(1)
      bigEgg.rotation = 0
      boomT.alpha = 1
      msgT.alpha = 1
    } else {
      const t = (elapsed - SCALE_IN_MS - HOLD_MS) / FADE_MS
      con.alpha = Math.max(0, 1 - t)
      if (t >= 1) {
        Ticker.shared.remove(tick)
        if (con.parent) con.parent.removeChild(con)
        con.destroy({ children: true })
      }
    }
  }
  Ticker.shared.add(tick)
}

// ============================================================
// sync-a 等待面板：按准备后显示，所有人就绪后自动消失
// 展示玩家就绪状态 + 臭鸡蛋 + 偷看上局阵容
// ============================================================

function showPvpWaitingPanel(stage: Container): void {
  if (pvpWaitingPanel) {
    pvpWaitingPanel.destroy({ children: true })
    stage.removeChild(pvpWaitingPanel)
  }
  const panel = new Container()
  panel.zIndex = 200
  pvpWaitingPanel = panel
  stage.addChild(panel)
  buildPvpWaitingPanelContent(panel)
}

function refreshPvpWaitingPanel(): void {
  if (!pvpWaitingPanel) return
  buildPvpWaitingPanelContent(pvpWaitingPanel)
}

function buildPvpWaitingPanelContent(panel: Container): void {
  panel.removeChildren()

  const session = PvpContext.getSession()
  if (!session) return

  const readySet = new Set(PvpContext.getSyncReadyIndices())
  const snapshots = PvpContext.getLastPlayerSnapshots()
  const alivePlayers = session.players.filter(p => !session.eliminatedPlayers.includes(p.index))
  const totalAlive = alivePlayers.length
  const readyCount = alivePlayers.filter(p => readySet.has(p.index)).length

  // ── 半透明背景遮罩（阻止商店交互）──
  const mask = new Graphics()
  mask.rect(0, 0, CANVAS_W, CANVAS_H).fill({ color: 0x000000, alpha: 0.6 })
  mask.eventMode = 'static'  // 拦截点击，锁定商店
  panel.addChild(mask)

  // ── 本轮对手计算 ──
  const aliveIndices = alivePlayers.map(p => p.index)
  const opponentIdx = session.currentOpponentPlayerIndex
    ?? getOpponentFromAlive(session.myIndex, aliveIndices, session.currentDay - 1)
  const opponentPlayer = opponentIdx >= 0 ? session.players.find(p => p.index === opponentIdx) : null
  const opponentHp = opponentIdx >= 0 ? (session.playerHps?.[opponentIdx] ?? session.initialHp) : 0
  const opponentLastSnap = opponentIdx >= 0 ? snapshots[opponentIdx] : undefined

  // ── 面板主体 ──
  const OPPONENT_CARD_H = 88
  const BOTTOM_BTN_H = 68
  const PANEL_H = Math.min(66 + OPPONENT_CARD_H + 14 + alivePlayers.length * 90 + BOTTOM_BTN_H + 24, CANVAS_H - 80)
  const PANEL_Y = (CANVAS_H - PANEL_H) / 2
  const PANEL_X = 30
  const PANEL_W = CANVAS_W - 60

  const panelBg = new Graphics()
  panelBg.roundRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 20)
    .fill({ color: 0x080f1a })
  panelBg.roundRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 20)
    .stroke({ color: readyCount === totalAlive ? 0x44cc88 : 0x2a3d5c, width: 2 })
  panelBg.eventMode = 'static'
  panel.addChild(panelBg)

  // ── 标题 ──
  const titleT = new Text({
    text: readyCount === totalAlive ? '全员就绪！' : `等待其他玩家... (${readyCount}/${totalAlive})`,
    style: {
      fill: readyCount === totalAlive ? 0x44ee99 : 0xffd86b,
      fontSize: 30,
      fontWeight: 'bold',
    },
  })
  titleT.anchor.set(0.5, 0)
  titleT.x = CANVAS_W / 2
  titleT.y = PANEL_Y + 18
  panel.addChild(titleT)

  // ── 本轮对手预告卡 ──
  const ROW_W = PANEL_W - 32
  const OPP_CARD_X = PANEL_X + 16
  const OPP_CARD_Y = PANEL_Y + 62

  const oppCardG = new Graphics()
  oppCardG.roundRect(OPP_CARD_X, OPP_CARD_Y, ROW_W, OPPONENT_CARD_H, 12)
    .fill({ color: 0x14102e })
  oppCardG.roundRect(OPP_CARD_X, OPP_CARD_Y, ROW_W, OPPONENT_CARD_H, 12)
    .stroke({ color: 0x5544aa, width: 1.5 })
  panel.addChild(oppCardG)

  const oppLabelT = new Text({ text: '⚔️ 本轮对手', style: { fill: 0x8877cc, fontSize: 18 } })
  oppLabelT.anchor.set(0, 0.5)
  oppLabelT.x = OPP_CARD_X + 14
  oppLabelT.y = OPP_CARD_Y + 24
  panel.addChild(oppLabelT)

  if (opponentPlayer) {
    const oppNameT = new Text({
      text: opponentPlayer.nickname,
      style: { fill: 0xddeeff, fontSize: 26, fontWeight: 'bold' },
    })
    oppNameT.anchor.set(0, 0.5)
    oppNameT.x = OPP_CARD_X + 14
    oppNameT.y = OPP_CARD_Y + 60
    panel.addChild(oppNameT)

    const oppHpT = new Text({
      text: `❤️ ${opponentHp}/${session.initialHp}`,
      style: { fill: 0xff9999, fontSize: 20 },
    })
    oppHpT.anchor.set(0, 0.5)
    oppHpT.x = OPP_CARD_X + 14 + oppNameT.width + 16
    oppHpT.y = OPP_CARD_Y + 60
    panel.addChild(oppHpT)

    if (opponentLastSnap) {
      const oppSnapT = new Text({
        text: `${opponentLastSnap.entities.length} 单位（上轮）`,
        style: { fill: 0x6688aa, fontSize: 18 },
      })
      oppSnapT.anchor.set(1, 0.5)
      oppSnapT.x = OPP_CARD_X + ROW_W - 14
      oppSnapT.y = OPP_CARD_Y + 60
      panel.addChild(oppSnapT)
    }
  } else {
    // 对手未知（轮空/镜像尚未到达）：显示占位，等待 onOpponentKnown 触发刷新
    const oppPendingT = new Text({
      text: '对手信息加载中...',
      style: { fill: 0x556688, fontSize: 20 },
    })
    oppPendingT.anchor.set(0, 0.5)
    oppPendingT.x = OPP_CARD_X + 14
    oppPendingT.y = OPP_CARD_Y + OPPONENT_CARD_H / 2
    panel.addChild(oppPendingT)
  }

  // ── 玩家列表 ──
  const ROW_H = 76
  const ROW_GAP = 8
  let cursorY = OPP_CARD_Y + OPPONENT_CARD_H + 14

  alivePlayers.forEach((player) => {
    const isReady = readySet.has(player.index)
    const isMe = player.index === session.myIndex
    const hasSnap = !!snapshots[player.index]

    const rowCon = new Container()
    rowCon.x = PANEL_X + 16
    rowCon.y = cursorY

    // 行背景
    const rowBg = new Graphics()
    rowBg.roundRect(0, 0, ROW_W, ROW_H, 12)
      .fill({ color: isMe ? 0x14102a : (isReady ? 0x0d1e12 : 0x10192a) })
    rowBg.roundRect(0, 0, ROW_W, ROW_H, 12)
      .stroke({ color: isMe ? 0x6644aa : (isReady ? 0x336644 : 0x1c2e44), width: 1 })
    rowCon.addChild(rowBg)

    // 就绪状态图标
    const iconT = new Text({
      text: isReady ? '✅' : '⏳',
      style: { fontSize: 28 },
    })
    iconT.anchor.set(0.5, 0.5)
    iconT.x = 28
    iconT.y = ROW_H / 2
    rowCon.addChild(iconT)

    // 名字
    const nameT = new Text({
      text: player.nickname + (isMe ? ' (我)' : ''),
      style: {
        fill: isMe ? 0xffd86b : (isReady ? 0x88eebb : 0xccddf0),
        fontSize: 26,
        fontWeight: isMe ? 'bold' : 'normal',
      },
    })
    nameT.anchor.set(0, 0.5)
    nameT.x = 56
    nameT.y = ROW_H / 2
    rowCon.addChild(nameT)

    // 右侧按钮区
    const BTN_W = 88
    const BTN_H = 40
    const btnX = ROW_W - BTN_W - 10

    if (!isMe && !isReady) {
      // 臭鸡蛋按钮（无冷却，可无限扔）
      const urgeBtnCon = new Container()
      urgeBtnCon.x = btnX
      urgeBtnCon.y = (ROW_H - BTN_H) / 2

      const urgeBg = new Graphics()
      urgeBg.roundRect(0, 0, BTN_W, BTN_H, 10)
        .fill({ color: 0x3a3010, alpha: 0.95 })
      urgeBg.roundRect(0, 0, BTN_W, BTN_H, 10)
        .stroke({ color: 0xaaaa22, width: 1.5 })
      urgeBtnCon.addChild(urgeBg)

      const urgeT = new Text({
        text: '🥚 扔蛋',
        style: {
          fill: 0xffee55,
          fontSize: 20,
          fontWeight: 'bold',
        },
      })
      urgeT.anchor.set(0.5, 0.5)
      urgeT.x = BTN_W / 2
      urgeT.y = BTN_H / 2
      urgeBtnCon.addChild(urgeT)

      urgeBtnCon.eventMode = 'static'
      urgeBtnCon.cursor = 'pointer'
      urgeBtnCon.on('pointerdown', (e) => {
        e.stopPropagation()
        PvpContext.sendUrge(player.index)
        // 按钮弹跳
        let bounceElapsed = 0
        const bounceTick = (ticker: { deltaMS: number }): void => {
          bounceElapsed += ticker.deltaMS
          const t = Math.min(1, bounceElapsed / 220)
          const scale = t < 0.4 ? 1 - 0.22 * (t / 0.4) : 0.78 + 0.22 * ((t - 0.4) / 0.6)
          urgeBtnCon.scale.set(scale)
          if (t >= 1) { Ticker.shared.remove(bounceTick); urgeBtnCon.scale.set(1) }
        }
        Ticker.shared.add(bounceTick)
        // 飞蛋特效：从按钮中心飞出
        const btnStageX = rowCon.x + btnX + BTN_W / 2
        const btnStageY = rowCon.y + ROW_H / 2
        spawnFloatingEggFx(getApp().stage, btnStageX, btnStageY)
      })
      urgeBtnCon.on('pointerover', () => { urgeBg.alpha = 0.75 })
      urgeBtnCon.on('pointerout', () => { urgeBg.alpha = 1 })
      rowCon.addChild(urgeBtnCon)
    } else if (!isMe && hasSnap) {
      // 偷看阵容按钮（已就绪 or 自己）
      const peekBtnCon = new Container()
      peekBtnCon.x = btnX
      peekBtnCon.y = (ROW_H - BTN_H) / 2

      const peekBg = new Graphics()
      peekBg.roundRect(0, 0, BTN_W, BTN_H, 10)
        .fill({ color: 0x0f2238, alpha: 0.95 })
      peekBg.roundRect(0, 0, BTN_W, BTN_H, 10)
        .stroke({ color: 0x2255aa, width: 1.5 })
      peekBtnCon.addChild(peekBg)

      const peekT = new Text({
        text: '看阵容 👀',
        style: { fill: 0x5599ee, fontSize: 18, fontWeight: 'bold' },
      })
      peekT.anchor.set(0.5, 0.5)
      peekT.x = BTN_W / 2
      peekT.y = BTN_H / 2
      peekBtnCon.addChild(peekT)

      peekBtnCon.eventMode = 'static'
      peekBtnCon.cursor = 'pointer'
      peekBtnCon.on('pointerdown', (e) => {
        e.stopPropagation()
        pvpPlayerListExpandedIndex = pvpPlayerListExpandedIndex === player.index ? -1 : player.index
        openPvpPlayerListOverlay()
      })
      peekBtnCon.on('pointerover', () => { peekBg.alpha = 0.75 })
      peekBtnCon.on('pointerout', () => { peekBg.alpha = 1 })
      rowCon.addChild(peekBtnCon)
    }

    panel.addChild(rowCon)
    cursorY += ROW_H + ROW_GAP
  })

  // ── 底部按钮：查看全员阵容 + 查看我的背包 ──
  const BTN_Y = cursorY + 12
  const HALF_BTN_W = Math.floor((ROW_W - 12) / 2)
  const BTN_H = 52

  // 查看全员阵容
  const viewAllCon = new Container()
  const viewAllBg = new Graphics()
  viewAllBg.roundRect(0, 0, HALF_BTN_W, BTN_H, 10).fill({ color: 0x0e1d35 })
  viewAllBg.roundRect(0, 0, HALF_BTN_W, BTN_H, 10).stroke({ color: 0x3355aa, width: 1.5 })
  viewAllCon.addChild(viewAllBg)
  const viewAllT = new Text({ text: '查看全员阵容', style: { fill: 0x5588dd, fontSize: 19, fontWeight: 'bold' } })
  viewAllT.anchor.set(0.5, 0.5)
  viewAllT.x = HALF_BTN_W / 2
  viewAllT.y = BTN_H / 2
  viewAllCon.addChild(viewAllT)
  viewAllCon.x = PANEL_X + 16
  viewAllCon.y = BTN_Y
  viewAllCon.eventMode = 'static'
  viewAllCon.cursor = 'pointer'
  viewAllCon.on('pointerdown', (e) => { e.stopPropagation(); openPvpPlayerListOverlay() })
  viewAllCon.on('pointerover', () => { viewAllBg.alpha = 0.75 })
  viewAllCon.on('pointerout', () => { viewAllBg.alpha = 1 })
  panel.addChild(viewAllCon)

  // 查看我的背包
  const bpViewCon = new Container()
  const bpViewBg = new Graphics()
  bpViewBg.roundRect(0, 0, HALF_BTN_W, BTN_H, 10).fill({ color: 0x0e2218 })
  bpViewBg.roundRect(0, 0, HALF_BTN_W, BTN_H, 10).stroke({ color: 0x226644, width: 1.5 })
  bpViewCon.addChild(bpViewBg)
  const bpViewT = new Text({ text: '查看我的背包', style: { fill: 0x44bb88, fontSize: 19, fontWeight: 'bold' } })
  bpViewT.anchor.set(0.5, 0.5)
  bpViewT.x = HALF_BTN_W / 2
  bpViewT.y = BTN_H / 2
  bpViewCon.addChild(bpViewT)
  bpViewCon.x = PANEL_X + 16 + HALF_BTN_W + 12
  bpViewCon.y = BTN_Y
  bpViewCon.eventMode = 'static'
  bpViewCon.cursor = 'pointer'
  bpViewCon.on('pointerdown', (e) => { e.stopPropagation(); showBackpackFromWaitingPanel() })
  bpViewCon.on('pointerover', () => { bpViewBg.alpha = 0.75 })
  bpViewCon.on('pointerout', () => { bpViewBg.alpha = 1 })
  panel.addChild(bpViewCon)
}

// ── 本轮对手徽章（可重复调用：先销毁旧的，再按当前 session 状态重建）──
function buildPvpOpponentBadge(): void {
  const { stage } = getApp()
  if (pvpOpponentBadge) {
    stage.removeChild(pvpOpponentBadge)
    pvpOpponentBadge.destroy({ children: true })
    pvpOpponentBadge = null
  }

  const sess = PvpContext.getSession()
  if (!sess) return

  const aliveForBadge = sess.players.filter(p => !sess.eliminatedPlayers.includes(p.index))
  const aliveIdxForBadge = aliveForBadge.map(p => p.index)
  const oppIdxForBadge = sess.currentOpponentPlayerIndex
    ?? getOpponentFromAlive(sess.myIndex, aliveIdxForBadge, sess.currentDay - 1)
  if (oppIdxForBadge < 0) return

  const oppForBadge = sess.players.find(p => p.index === oppIdxForBadge)
  if (!oppForBadge) return

  const oppHpForBadge = sess.playerHps?.[oppIdxForBadge] ?? sess.initialHp
  const BW = 138, BH = 54
  const badge = new Container()
  badge.zIndex = 96

  const badgeGlow = new Graphics()
  badgeGlow.roundRect(-1, -1, BW + 2, BH + 2, 13).fill({ color: 0x9966ff, alpha: 0.18 })
  badge.addChild(badgeGlow)

  const badgeBg = new Graphics()
  badgeBg.roundRect(0, 0, BW, BH, 12).fill({ color: 0x0d1020 })
  badgeBg.roundRect(0, 0, BW, BH, 12).stroke({ color: 0x7755cc, width: 1.5 })
  badgeBg.roundRect(2, 2, BW - 4, BH / 2 - 2, 10).fill({ color: 0xffffff, alpha: 0.04 })
  badge.addChild(badgeBg)

  const labelT = new Text({ text: '本轮对手', style: { fill: 0x9977cc, fontSize: 13 } })
  labelT.anchor.set(0, 0.5)
  labelT.x = 10
  labelT.y = 15
  badge.addChild(labelT)

  const hpT = new Text({ text: `♥ ${oppHpForBadge}/${sess.initialHp}`, style: { fill: 0xff7777, fontSize: 13, fontWeight: 'bold' } })
  hpT.anchor.set(1, 0.5)
  hpT.x = BW - 10
  hpT.y = 15
  badge.addChild(hpT)

  const divG = new Graphics()
  divG.rect(8, 27, BW - 16, 1).fill({ color: 0x4433aa, alpha: 0.7 })
  badge.addChild(divG)

  const nameT = new Text({ text: oppForBadge.nickname, style: { fill: 0xeeddff, fontSize: 20, fontWeight: 'bold' } })
  nameT.anchor.set(0.5, 0.5)
  nameT.x = BW / 2
  nameT.y = 41
  badge.addChild(nameT)

  badge.x = CANVAS_W - BW - 8
  badge.y = 94
  badge.eventMode = 'static'
  badge.cursor = 'pointer'
  badge.on('pointerdown', openPvpPlayerListOverlay)
  badge.on('pointerover', () => { badge.alpha = 0.8 })
  badge.on('pointerout', () => { badge.alpha = 1 })

  pvpOpponentBadge = badge
  stage.addChild(badge)
}

// ── 对手英雄立绘背景层（PVP 商店阶段，半透明置底）──
async function buildPvpOpponentHeroLayer(): Promise<void> {
  const { stage } = getApp()
  if (pvpOpponentHeroLayer) {
    stage.removeChild(pvpOpponentHeroLayer)
    pvpOpponentHeroLayer.destroy({ children: true })
    pvpOpponentHeroLayer = null
  }

  const sess = PvpContext.getSession()
  if (!sess) return

  // 获取对手 index（与 badge 逻辑保持一致）
  const aliveIdx = sess.players
    .filter(p => !sess.eliminatedPlayers.includes(p.index))
    .map(p => p.index)
  const oppIdx = sess.currentOpponentPlayerIndex
    ?? getOpponentFromAlive(sess.myIndex, aliveIdx, sess.currentDay - 1)

  const lastSnaps = PvpContext.getLastPlayerSnapshots()
  const heroId = lastSnaps[oppIdx]?.ownerHeroId

  if (oppIdx < 0 || !heroId) return

  // 对手昵称和 HP（供立绘下方标签使用）
  const oppPlayer = sess.players.find(p => p.index === oppIdx)
  const oppHp = sess.playerHps?.[oppIdx] ?? sess.initialHp

  try {
    const tex = await Assets.load<Texture>(`/resource/hero/${heroId}.png`)
    // 场景已切换则丢弃
    if (!PvpContext.isActive()) return

    const layer = new Container()
    layer.zIndex = 5
    layer.eventMode = 'none'

    // 立绘：上移到石墙区，放大，更不透明
    const sprite = new Sprite(tex)
    sprite.anchor.set(0.5, 1)
    const maxW = 310
    if (sprite.width > maxW) sprite.scale.set(maxW / tex.width)
    sprite.x = CANVAS_W / 2
    sprite.y = 520   // 石墙/沙地分界处
    sprite.alpha = 0.5
    layer.addChild(sprite)

    // 对手昵称 + HP 标签（立绘上方）
    if (oppPlayer) {
      const labelY = sprite.y - sprite.height - 44
      const nameBg = new Graphics()
      nameBg.roundRect(-90, 0, 180, 40, 10).fill({ color: 0x0d0d1a, alpha: 0.65 })
      nameBg.x = CANVAS_W / 2
      nameBg.y = labelY
      layer.addChild(nameBg)

      const nameT = new Text({
        text: `${oppPlayer.nickname}  ♥${oppHp}`,
        style: { fill: 0xffdde0, fontSize: 20, fontWeight: 'bold', align: 'center' },
      })
      nameT.anchor.set(0.5, 0)
      nameT.x = CANVAS_W / 2
      nameT.y = labelY + 3
      layer.addChild(nameT)
    }

    pvpOpponentHeroLayer = layer
    stage.addChild(layer)
  } catch {
    // 贴图加载失败静默忽略
  }
}

// ── 查看背包（等待面板临时隐藏，展示背包，浮层返回按钮）──
function showBackpackFromWaitingPanel(): void {
  if (!pvpWaitingPanel) return
  pvpWaitingPanel.visible = false
  if (backpackView) backpackView.visible = true

  // 清理旧返回按钮
  if (pvpBackpackReturnBtn) {
    pvpBackpackReturnBtn.parent?.removeChild(pvpBackpackReturnBtn)
    pvpBackpackReturnBtn.destroy({ children: true })
    pvpBackpackReturnBtn = null
  }

  const { stage } = getApp()
  const returnBtn = new Container()
  returnBtn.zIndex = 300

  const btnBg = new Graphics()
  btnBg.roundRect(0, 0, 300, 72, 16).fill({ color: 0x1a0a2e })
  btnBg.roundRect(0, 0, 300, 72, 16).stroke({ color: 0x7755cc, width: 2 })
  returnBtn.addChild(btnBg)

  const btnT = new Text({ text: '← 返回等待面板', style: { fill: 0xbb99ff, fontSize: 22, fontWeight: 'bold' } })
  btnT.anchor.set(0.5, 0.5)
  btnT.x = 150
  btnT.y = 36
  returnBtn.addChild(btnT)

  returnBtn.x = (CANVAS_W - 300) / 2
  returnBtn.y = CANVAS_H - 112
  returnBtn.eventMode = 'static'
  returnBtn.cursor = 'pointer'
  returnBtn.on('pointerdown', () => {
    if (pvpBackpackReturnBtn) {
      pvpBackpackReturnBtn.parent?.removeChild(pvpBackpackReturnBtn)
      pvpBackpackReturnBtn.destroy({ children: true })
      pvpBackpackReturnBtn = null
    }
    if (pvpWaitingPanel) pvpWaitingPanel.visible = true
  })
  returnBtn.on('pointerover', () => { btnBg.alpha = 0.8 })
  returnBtn.on('pointerout', () => { btnBg.alpha = 1 })

  pvpBackpackReturnBtn = returnBtn
  stage.addChild(returnBtn)
}

// ============================================================
// PVP 结束后清理残留的 in-memory 状态，防止 PVP 存档污染 PVE 商店
// 由 PvpContext.endSession() 调用
// ============================================================
export function clearPvpShopState(): void {
  savedShopState = null
  pendingBattleTransition = false
  pendingAdvanceToNextDay = false
  pvpReadyLocked = false
  if (pvpBackpackReturnBtn) {
    pvpBackpackReturnBtn.parent?.removeChild(pvpBackpackReturnBtn)
    pvpBackpackReturnBtn.destroy({ children: true })
    pvpBackpackReturnBtn = null
  }
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
    const canvas = app.canvas as HTMLCanvasElement

    // PVP 模式：注册自动提交回调（倒计时结束时若未手动提交则自动触发）
    if (PvpContext.isActive()) {
      PvpContext.registerAutoSubmit(() => {
        clearBattleOutcome()
        pendingSkillBarMoveStartAtMs = Date.now()
        const snapshot = buildBattleSnapshot(pendingSkillBarMoveStartAtMs)
        if (snapshot) {
          setBattleSnapshot(snapshot)
          pendingBattleTransition = true
          pendingAdvanceToNextDay = true
          pvpReadyLocked = true
          if (PvpContext.getPvpMode() === 'sync-a') showPvpWaitingPanel(stage)
          PvpContext.onPlayerReady()
        }
      })
      // sync-a：通知 host 本玩家已进入商店（所有人到齐后才开始倒计时）
      PvpContext.notifyShopEntered()
      // sync-a：注册回调
      if (PvpContext.getPvpMode() === 'sync-a') {
        pvpUrgeCooldownSet.clear()
        PvpContext.onUrgeReceived = (fromPlayerIndex, fromNickname) => {
          const session = PvpContext.getSession()
          const fromPlayer = session?.players.find(p => p.index === fromPlayerIndex)
          const name = fromPlayer?.nickname ?? fromNickname
          showEggSplatOverlay(name)
        }
        // 跳转战斗前主动清理等待面板（防止面板残留到战斗场景）
        PvpContext.onBeforeBattleTransition = () => {
          if (pvpWaitingPanel) {
            pvpWaitingPanel.parent?.removeChild(pvpWaitingPanel)
            pvpWaitingPanel.destroy({ children: true })
            pvpWaitingPanel = null
          }
          if (pvpBackpackReturnBtn) {
            pvpBackpackReturnBtn.parent?.removeChild(pvpBackpackReturnBtn)
            pvpBackpackReturnBtn.destroy({ children: true })
            pvpBackpackReturnBtn = null
          }
        }
        // eliminatedPlayers 变化时立即刷新等待面板（round_summary 延迟到达时的兜底）
        PvpContext.onEliminatedPlayersUpdate = () => {
          refreshPvpWaitingPanel()
        }
        // 对手 index 确认后刷新等待面板对手卡（轮空/镜像场景：host 下发 opponent_snapshot 后触发）
        PvpContext.onOpponentKnown = () => {
          refreshPvpWaitingPanel()
        }
      }
    }

    battlePassivePrevStats.clear()
    battlePassiveResolvedStats.clear()
    passiveJumpLayer = new Container()
    passiveJumpLayer.eventMode = 'none'

    createHintToast(stage)
    showingBackpack = true

    shopManager = new ShopManager(cfg, items, 1)

    // 顶部分区背景（商店 / 背包）
    shopAreaBg = new Graphics()
    stage.addChild(shopAreaBg)
    backpackAreaBg = new Graphics()
    stage.addChild(backpackAreaBg)
    battleAreaBg = new Graphics()
    stage.addChild(battleAreaBg)

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
      restartRunFromBeginning()
    })
    restartBtn = restartCon
    stage.addChild(restartCon)

    playerStatusCon = new Container()
    playerStatusCon.zIndex = 95
    playerStatusCon.x = 0
    playerStatusCon.y = getDebugCfg('shopPlayerStatusY')

    playerStatusAvatar = new Sprite(Texture.WHITE)
    playerStatusAvatar.x = 260
    playerStatusAvatar.y = 10
    playerStatusAvatar.width = 120
    playerStatusAvatar.height = 120
    playerStatusAvatar.alpha = 0
    playerStatusAvatar.eventMode = 'static'
    playerStatusAvatar.cursor = 'pointer'
    playerStatusAvatar.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      toggleHeroPassiveDetailPopup()
    })
    playerStatusCon.addChild(playerStatusAvatar)

    playerStatusAvatarClickHit = new Graphics()
    playerStatusAvatarClickHit.eventMode = 'static'
    playerStatusAvatarClickHit.cursor = 'pointer'
    playerStatusAvatarClickHit.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      toggleHeroPassiveDetailPopup()
    })
    playerStatusCon.addChild(playerStatusAvatarClickHit)

    playerStatusDailySkillStar = new Text({
      text: '★',
      style: {
        fontSize: 28,
        fill: 0xffd24a,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x4a2d00, width: 3 },
      },
    })
    playerStatusDailySkillStar.anchor.set(0.5)
    playerStatusDailySkillStar.visible = false
    playerStatusCon.addChild(playerStatusDailySkillStar)

    playerStatusExpBg = new Graphics()
    playerStatusCon.addChild(playerStatusExpBg)

    playerStatusExpBar = new Graphics()
    playerStatusCon.addChild(playerStatusExpBar)

    playerStatusLvText = new Text({
      text: 'Lv1',
      style: {
        fontSize: getDebugCfg('shopPlayerStatusLvFontSize'),
        fill: 0xf3f8ff,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x0f172b, width: 3 },
      },
    })
    playerStatusLvText.anchor.set(0.5)
    playerStatusCon.addChild(playerStatusLvText)

    layoutPlayerStatusPanel()

    stage.addChild(playerStatusCon)

    livesText = new Text({
      text: '❤️ 5/5',
      style: {
        fontSize: cfg.textSizes.refreshCost,
        fill: 0xffd4d4,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x000000, width: 3 },
      },
    })
    livesText.zIndex = 95
    stage.addChild(livesText)

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
      pvpPlayersBtn.on('pointerdown', openPvpPlayerListOverlay)
      pvpPlayersBtn.on('pointerover', () => { pvpPlayersBtn.alpha = 0.75 })
      pvpPlayersBtn.on('pointerout', () => { pvpPlayersBtn.alpha = 1 })
      stage.addChild(pvpPlayersBtn)

      // ── 本轮对手徽章 + 英雄背景立绘（sync-a：商店阶段始终可见）──
      if (PvpContext.getPvpMode() === 'sync-a') {
        buildPvpOpponentBadge()
        void buildPvpOpponentHeroLayer()
        // day_ready 携带轮空预分配时（onEnter 之后 ~300ms 到达），补建徽章
        PvpContext.onOpponentPreAssigned = () => {
          buildPvpOpponentBadge()
          void buildPvpOpponentHeroLayer()
        }
        // round_summary 比 onEnter 晚到时，补建英雄立绘
        PvpContext.onRoundSummaryReceived = () => {
          void buildPvpOpponentHeroLayer()
        }
      }
    }

    trophyText = new Text({
      text: '🏆 0/10',
      style: {
        fontSize: cfg.textSizes.refreshCost,
        fill: 0xffe8b4,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x000000, width: 3 },
      },
    })
    trophyText.zIndex = 95
    stage.addChild(trophyText)

    // 商店面板
    shopPanel = new ShopPanelView()
    shopPanel.x = getDebugCfg('shopAreaX')
    shopPanel.y = getDebugCfg('shopAreaY')
    shopPanel.onDragStart = (slotIndex, e) => startShopDrag(slotIndex, e, stage)
    shopPanel.visible = false
    stage.addChild(shopPanel)

    // 格子系统
    const compactMode = cfg.gameplayModeValues?.compactMode
    const activeCols = compactMode?.enabled
      ? (compactMode.battleCols ?? 6)
      : (cfg.dailyBattleSlots[0] ?? 4)
    const backpackRows = compactMode?.enabled
      ? (compactMode.backpackRows ?? 3)
      : 2
    battleSystem   = new GridSystem(6)
    backpackSystem = new GridSystem(6, backpackRows)
    battleView     = new GridZone('上阵区', 6, activeCols, 1)
    backpackView   = new GridZone('背包', 6, 6, backpackRows)
    backpackView.setAutoPackEnabled(false)
    battleView.setStatBadgeMode('archetype')
    backpackView.setStatBadgeMode('archetype')
    battleView.x   = getBattleZoneX(activeCols)
    battleView.y   = getDebugCfg('battleZoneY')
    backpackView.x = getBackpackZoneX(backpackView.activeColCount)
    backpackView.y = getBackpackZoneYByBattle()
    backpackView.visible = true

    stage.addChild(battleView)
    stage.addChild(backpackView)
    battleZoneTitleText = new Text({
      text: '上阵区',
      style: {
        fontSize: cfg.textSizes.gridZoneLabel,
        fill: 0xd8e5ff,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x0f1a3a, width: 4 },
      },
    })
    battleZoneTitleText.anchor.set(0.5)
    battleZoneTitleText.zIndex = 14
    stage.addChild(battleZoneTitleText)

    backpackZoneTitleText = new Text({
      text: '背包区',
      style: {
        fontSize: cfg.textSizes.gridZoneLabel,
        fill: 0xd8e5ff,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x0f1a3a, width: 4 },
      },
    })
    backpackZoneTitleText.anchor.set(0.5)
    backpackZoneTitleText.zIndex = 14
    stage.addChild(backpackZoneTitleText)
    if (passiveJumpLayer) battleView.addChild(passiveJumpLayer)

    drag = new DragController(stage, canvas)
    drag.addZone(battleSystem,  battleView)
    drag.addZone(backpackSystem, backpackView)
    drag.onDragStart = (instanceId: string) => {
      clearSelection()
      const defId = instanceToDefId.get(instanceId)
      if (!defId || !sellPopup || !shopManager) return
      const item = getAllItems().find(i => i.id === defId)
      if (!item) return
      const tier = getInstanceTier(instanceId)
      const star = getInstanceTierStar(instanceId)
      const sellPrice = 0
      if (isNeutralTargetStone(item)) refreshNeutralStoneGuideArrows(item, instanceId)
      else refreshBackpackSynthesisGuideArrows(defId, tier ?? null, star, instanceId)
      // 拖拽中视为选中：显示物品详情（不设置区域高亮，因物品已脱离格子）
      const inBattle = !!battleView?.hasItem(instanceId)
      currentSelection = { kind: inBattle ? 'battle' : 'backpack', instanceId }
      selectedSellAction = null  // 拖拽中暂不执行出售
      sellPopup.show(item, sellPrice, 'none', toVisualTier(tier, star), undefined, getDefaultItemInfoMode())
      setSellButtonPrice(sellPrice)
      applySellButtonState()

      // 按钮闪烁提示：可出售则闪出售；战斗区->背包（背包未打开且有空位）则闪背包按钮
      const canSell = true
      const canToBackpack = inBattle && !showingBackpack
        && canBackpackAcceptByAutoPack(item.id, normalizeSize(item.size))
      startGridDragButtonFlash(stage, canSell, canToBackpack, 0)
    }
    drag.onSpecialDrop = ({ instanceId, anchorGx, anchorGy, size, originCol, originRow, homeSystem, homeView, defId }) => {
      if (!shopManager) return false
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
        showHintToast('no_gold_buy', `已丢弃：${sourceDef?.name_cn ?? item.name_cn}`, 0x9be5ff)
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
        && homeView === backpackView
        && (!!nextTierLevel(fromTier, fromStar) || canUseLv7MorphSynthesis(defId, defId, fromTier, fromStar, fromTier, fromStar))
        && isPointInZoneArea(battleView, anchorGx, anchorGy)
      ) {
        const blockedBattleSynth = findBattleSynthesisTargetWithDragProbeIgnoringNoSynthesis(defId, fromTier, fromStar, anchorGx, anchorGy, size)
        if (blockedBattleSynth) {
          showHintToast('backpack_full_buy', '上阵区内无法合成', 0xffd48f)
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
                showHintToast('backpack_full_buy', 'Lv7转化：当前无可用候选', 0xffb27a)
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
                  showHintToast('backpack_full_buy', 'Lv7转化失败', 0xff8f8f)
                  return false
                }
                removeInstanceMeta(instanceId)
                grantSynthesisExp(1, { instanceId: synthTarget.instanceId, zone: synthTarget.zone })
                showHintToast('no_gold_buy', 'Lv7合成：已触发变化石效果', 0x9be5ff)
                refreshShopUI()
                return true
              }, 'special_shop_like')
              if (!opened) {
                showHintToast('backpack_full_buy', 'Lv7转化：当前无可用候选', 0xffb27a)
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
                showHintToast('backpack_full_buy', '合成目标无效', 0xff8f8f)
                restoreDragToHome()
                return
              }
              removeInstanceMeta(instanceId)
              playSynthesisFlashEffect(stage, synth)
              if (!tryRunHeroCrossSynthesisReroll(stage, synth)) {
                refreshShopUI()
              }
            }
            if (isCrossIdSynthesisConfirmEnabled()) {
              showCrossSynthesisConfirmOverlay(
                stage,
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
            playSynthesisFlashEffect(stage, synth)
            refreshShopUI()
            return true
          }
        }
      }

      // 2) 战斗区拖到背包按钮：背包未打开时执行自动整理后放入
      if (
        homeView === battleView
        && !showingBackpack
        && _isOverBpBtn(anchorGx, anchorGy)
        && backpackSystem
        && backpackView
      ) {
        const autoPlan = buildBackpackAutoPackPlan(defId, size)
        if (!autoPlan) {
          showHintToast('backpack_full_transfer', '背包已满，无法转移', 0xff8f8f)
          return false
        }
        homeSystem.remove(instanceId)
        applyBackpackAutoPackExisting(autoPlan.existing)
        backpackSystem.place(autoPlan.incoming.col, autoPlan.incoming.row, size, defId, instanceId)
        const tier = getInstanceTier(instanceId)
        const star = getInstanceTierStar(instanceId)
        backpackView.addItem(instanceId, defId, size, autoPlan.incoming.col, autoPlan.incoming.row, toVisualTier(tier, star)).then(() => {
          backpackView!.setItemTier(instanceId, toVisualTier(tier, star))
          drag?.refreshZone(backpackView!)
        })
        refreshShopUI()
        return true
      }

      return false
    }
    drag.onDragMove = ({ instanceId, anchorGx, anchorGy, size }) => {
      updateGridDragSellAreaHover(anchorGx, anchorGy, size)

      // 可用状态随时重算（例如拖拽过程中背包可见状态变化）
      if (gridDragCanToBackpack) {
        gridDragCanToBackpack = !showingBackpack
      }

      const defId = instanceToDefId.get(instanceId)
      const tier = getInstanceTier(instanceId)
      const star = getInstanceTierStar(instanceId)
      const item = defId ? getItemDefById(defId) : null
      if (isNeutralTargetStone(item)) refreshNeutralStoneGuideArrows(item, instanceId)
      else refreshBackpackSynthesisGuideArrows(defId ?? null, tier ?? null, star, instanceId)

      const sellPrice = 0
      const overSell = gridDragCanSell && gridDragSellHot
      if (item && sellPopup && tier && overSell) {
        const stoneHint = isNeutralTargetStone(item)
          ? (item.name_cn === '转职石' ? '拖到目标物品上触发转职效果' : '拖到目标物品上触发变化效果')
          : '丢弃后不会获得金币'
        const customDisplay: ItemInfoCustomDisplay = {
          overrideName: `${item.name_cn}（拖拽丢弃）`,
          lines: [stoneHint],
          suppressStats: true,
        }
        sellPopup.show(item, sellPrice, 'none', toVisualTier(tier, star), undefined, 'detailed', undefined, customDisplay)
        drag?.setSqueezeSuppressed(false)
        hideSynthesisHoverInfo()
        return
      }

      const canLv7Morph = !!defId && !!tier && canUseLv7MorphSynthesis(defId, defId, tier, star, tier, star)
      if (!defId || !tier || (!nextTierLevel(tier, star) && !canLv7Morph)) {
        drag?.setSqueezeSuppressed(false)
        clearBackpackSynthesisGuideArrows()
        if (item && sellPopup) {
          sellPopup.show(item, sellPrice, 'none', toVisualTier(tier, star), undefined, getDefaultItemInfoMode())
        }
        return
      }

      if (item && isNeutralTargetStone(item)) {
        const target = findNeutralStoneTargetWithDragProbe(item, anchorGx, anchorGy, size)
        if (target) {
          drag?.setSqueezeSuppressed(true, true)
          highlightSynthesisTarget(target)
          showNeutralStoneHoverInfo(item, target)
        } else {
          drag?.setSqueezeSuppressed(false)
          hideSynthesisHoverInfo()
          if (sellPopup) {
            const customDisplay: ItemInfoCustomDisplay = {
              lines: ['拖到目标物品上触发效果'],
              suppressStats: true,
            }
            sellPopup.show(item, sellPrice, 'none', toVisualTier(tier, star), undefined, 'detailed', undefined, customDisplay)
          }
        }
        return
      }

      const synthTarget = findSynthesisTargetWithDragProbe(defId, tier, star, anchorGx, anchorGy, size)
      if (synthTarget) {
        drag?.setSqueezeSuppressed(true, true)
        highlightSynthesisTarget(synthTarget)
        showSynthesisHoverInfo(defId, tier, star, synthTarget)
      } else {
        drag?.setSqueezeSuppressed(false)
        hideSynthesisHoverInfo()
        if (item && sellPopup) {
          sellPopup.show(item, sellPrice, 'none', toVisualTier(tier, star), undefined, getDefaultItemInfoMode())
        }
      }
    }
    drag.onDragEnd = () => {
      drag?.setSqueezeSuppressed(false)
      hideSynthesisHoverInfo()
      clearBackpackSynthesisGuideArrows()
      stopGridDragButtonFlash()
      applyInstanceTierVisuals()
      updateMiniMap()
      refreshBattlePassiveStatBadges(true)
      clearSelection()
    }

    // ---- 按钮行 ----
    btnRow = new Container()
    btnRow.x = 0
    btnRow.y = 0

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

    bpBtnHandle = null

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
      if (!isShopInputEnabled()) return
      clearSelection()
      buyRandomBronzeToBoardOrBackpack()
      refreshBtn.redraw(false)
    })
    refreshBtnHandle = refreshBtn
    btnRow.addChild(refreshBtn.container)

    refreshBtn.setSubLabel(`💰 ${shopManager.gold}/${getQuickBuyPricePreviewLabel()}`)

    // 保留占位引用，避免旧流程空指针
    refreshCostText = null

    goldText = null

    // 整理按钮（右）
    const sellBtn = makeCircleBtn(getDebugCfg('sellBtnX'), getDebugCfg('sellBtnY'), '整理', 0x3b74ff, 0x3b74ff)
    sellBtn.container.on('pointerdown', () => {
      if (!isShopInputEnabled()) return
      // 选中点击“整理”只执行整理，不再触发丢弃。
      if (selectedSellAction) selectedSellAction = null
      clearSelection()
      sortBackpackItemsByRule()
    })
    sellBtnHandle = sellBtn
    btnRow.addChild(sellBtn.container)

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
      if (!isShopInputEnabled()) {
        SceneManager.goto('shop')
        return
      }
      if (battleStartTransition) return
      const boardItemCount = battleSystem?.getAllItems().length ?? 0
      const backpackItemCount = backpackSystem?.getAllItems().length ?? 0
      if (boardItemCount <= 0 && canAffordQuickBuyNow()) {
        showHintToast('no_gold_buy', '请先购买物品作战', 0xffd48f)
        showBuyGuideHand()
        return
      }
      if (boardItemCount <= 0 && backpackItemCount > 0) {
        // PVP 模式：允许直接提交（背包物品不参与战斗，但快照交换正常工作）
        if (!PvpContext.isActive()) {
          showHintToast('no_gold_buy', '请将物品拖入上阵区', 0xffd48f)
          showMoveToBattleGuideHand()
          return
        }
      }
      clearBattleOutcome()
      pendingSkillBarMoveStartAtMs = Date.now()
      const snapshot = buildBattleSnapshot(pendingSkillBarMoveStartAtMs)
      if (snapshot) {
        setBattleSnapshot(snapshot)
        console.log(`[ShopScene] 战斗快照已生成 day=${snapshot.day} entities=${snapshot.entities.length} cols=${snapshot.activeColCount}`)
      }
      pendingBattleTransition = true
      pendingAdvanceToNextDay = true
      // PVP 模式：提交快照给对手，等待对方快照，不走本地过渡动画
      if (PvpContext.isActive()) {
        pvpReadyLocked = true
        phaseBtnHandle?.setLabel('等待...')
        phaseBtnHandle?.redraw(true)
        // sync-a：先建面板再调 onPlayerReady，防止 host 同步触发 goto('battle') 后面板才加入
        if (PvpContext.getPvpMode() === 'sync-a') showPvpWaitingPanel(stage)
        PvpContext.onPlayerReady()
        return
      }
      beginBattleStartTransition()
    })
    phaseBtnHandle = phaseBtn
    btnRow.addChild(phaseBtn.container)

    miniMapGfx = null
    miniMapCon = null

    stage.addChild(btnRow)
    ensureBottomHudVisibleAndOnTop(stage)

    // 丢弃弹窗
    const selectGridItem = (
      instanceId: string,
      system: GridSystem,
      view: GridZone,
      kind: 'battle' | 'backpack',
    ) => {
      const defId = instanceToDefId.get(instanceId)
      if (!defId || !sellPopup || !shopManager) return
      const item = getAllItems().find(i => i.id === defId)
      if (!item) return

      battleView?.setSelected(kind === 'battle' ? instanceId : null)
      backpackView?.setSelected(kind === 'backpack' ? instanceId : null)
      shopPanel?.setSelectedSlot(-1)

      currentSelection = kind === 'battle'
        ? { kind: 'battle', instanceId }
        : { kind: 'backpack', instanceId }

      hideSkillDetailPopup()
      if (kind === 'battle') refreshBattlePassiveStatBadges(false)
      const tier = getInstanceTier(instanceId)
      const star = getInstanceTierStar(instanceId)
      const sellPrice = 0
      const infoMode = resolveInfoMode(`${kind}:${instanceId}:${tier}:${star}`)
      sellPopup.show(item, sellPrice, 'none', toVisualTier(tier, star), undefined, infoMode)

      selectedSellAction = () => {
        system.remove(instanceId)
        view.removeItem(instanceId)
        removeInstanceMeta(instanceId)
        drag?.refreshZone(view)
      }

      setSellButtonPrice(sellPrice)
      applySellButtonState()
    }

    const handleShopSlotTap = (slotIndex: number) => {
      if (!isShopInputEnabled()) return
      if (!shopManager || !sellPopup) return
      const slot = shopManager.pool[slotIndex]
      if (!slot) return

      shopPanel?.setSelectedSlot(slotIndex)
      battleView?.setSelected(null)
      backpackView?.setSelected(null)
      currentSelection = { kind: 'shop', slotIndex }
      selectedSellAction = null

      const infoMode = resolveInfoMode(`shop:${slotIndex}:${slot.item.id}:${slot.tier}`)
      hideSkillDetailPopup()
      sellPopup.show(slot.item, getShopSlotPreviewPrice(slot), 'buy', toVisualTier(slot.tier, 1), undefined, infoMode)
      applySellButtonState()
    }

    backpackView.onTap = (id) => {
      if (!isShopInputEnabled()) return
      if (specialShopBackpackViewActive) {
        handleSpecialShopBackpackItemTap(id, 'backpack')
        return
      }
      selectGridItem(id, backpackSystem!, backpackView!, 'backpack')
    }
    battleView.onTap   = (id) => {
      if (!isShopInputEnabled()) return
      if (specialShopBackpackViewActive) {
        handleSpecialShopBackpackItemTap(id, 'battle')
        return
      }
      selectGridItem(id, battleSystem!, battleView!, 'battle')
    }
    shopPanel.onTap    = (slotIndex) => handleShopSlotTap(slotIndex)

    sellPopup = new SellPopup(CANVAS_W, CANVAS_H)
    sellPopup.zIndex = 20
    stage.addChild(sellPopup)
    applyLayoutFromDebug()

    offDebugCfg = onDebugCfgChange((key) => {
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
    onStageTapHidePopup = () => {
      if (shopDragFloater) return
      clearSelection()
    }
    stage.on('pointerdown', onStageTapHidePopup)

    // Stage 级指针事件（商店拖拽）
    onStageShopPointerMove = (e: FederatedPointerEvent) => {
      if (shopDragFloater) onShopDragMove(e)
    }
    onStageShopPointerUp = (e: FederatedPointerEvent) => {
      if (shopDragFloater) void onShopDragEnd(e, stage)
    }
    onStageShopPointerUpOutside = (e: FederatedPointerEvent) => {
      if (shopDragFloater) void onShopDragEnd(e, stage)
    }
    stage.on('pointermove', onStageShopPointerMove)
    stage.on('pointerup', onStageShopPointerUp)
    stage.on('pointerupoutside', onStageShopPointerUpOutside)

    // Debug 天数控制
    dayDebugCon = new Container()
    dayDebugCon.x = CANVAS_W / 2
    dayDebugCon.y = getDebugCfg('dayDebugY')

    const prevDayBtn = new Text({ text: '◀', style: { fontSize: cfg.textSizes.dayDebugArrow, fill: 0x888888 } })
    prevDayBtn.eventMode = 'static'
    prevDayBtn.cursor    = 'pointer'
    prevDayBtn.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      if (!isShopInputEnabled()) return
      setDay(currentDay - 1)
    })

    dayDebugText = new Text({
      text: `Day ${currentDay}`,
      style: { fontSize: cfg.textSizes.dayDebugLabel, fill: 0xcccccc, fontFamily: 'Arial' },
    })

    const nextDayBtn = new Text({ text: '▶', style: { fontSize: cfg.textSizes.dayDebugArrow, fill: 0x888888 } })
    nextDayBtn.eventMode = 'static'
    nextDayBtn.cursor    = 'pointer'
    nextDayBtn.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      if (!isShopInputEnabled()) return
      setDay(currentDay + 1)
    })

    dayDebugCon.addChild(prevDayBtn, dayDebugText, nextDayBtn)
    stage.addChild(dayDebugCon)
    dayPrevBtn = prevDayBtn
    dayNextBtn = nextDayBtn
    layoutDayDebugControls()
    createSettingsButton(stage)
    // Day 调试文字在此处才创建，需要再应用一次字号配置以覆盖 game_config 默认值
    applyTextSizesFromDebug()

    offPhaseChange = PhaseManager.onChange((next, prev) => {
      if (next === 'COMBAT') {
        const snapshot = buildBattleSnapshot(pendingSkillBarMoveStartAtMs ?? undefined)
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

    const restoredState = savedShopState ?? loadShopStateFromStorage()
    const battleOutcome = consumeBattleOutcome()
    if (restoredState) {
      applySavedShopState(restoredState)
      savedShopState = null
      if (pendingAdvanceToNextDay || PvpContext.isActive()) {
        if (PvpContext.isActive() && PvpContext.isMidDayShopPhase()) {
          // PVP 中间商店阶段（shop2/shop3）：刷新卡池但不发放基础日收入
          setDay(currentDay)  // 同一天 → setDay 内部不触发收入逻辑
          const wildBonus = PvpContext.consumePendingWildGoldBonus()
          if (wildBonus > 0 && shopManager) {
            shopManager.gold += wildBonus
            console.log('[ShopScene] 野怪奖励 +' + wildBonus + 'G')
          }
        } else {
          setDay(currentDay + 1)
        }
        applyPostBattleEffects(battleOutcome?.snapshot ?? null)
        pendingAdvanceToNextDay = false
      }
      grantSkill20DailyBronzeItemIfNeeded()
    } else {
      pendingAdvanceToNextDay = false
      starterClass = null
      starterHeroChoiceOptions = []
      starterGranted = false
      starterBattleGuideShown = false
      hasBoughtOnce = false
      resetSkill15NextBuyDiscountState()
      resetSkill30BundleState()
      quickBuyNoSynthRefreshStreak = 0
      quickBuyNeutralMissStreak = 0
      pickedSkills = []
      draftedSkillDays = []
      pendingSkillDraft = null
      draftedEventDays = []
      pendingEventDraft = null
      draftedSpecialShopDays = []
      specialShopRefreshCount = 0
      specialShopOffers = []
      resetEventSelectionCounters()
      resetDayEventState()
      resetFutureEventState()
      skillDetailMode = getDefaultSkillDetailMode()
      skill20GrantedDays.clear()
      unlockedItemIds.clear()
      neutralObtainedCountByKind.clear()
      neutralRandomCategoryPool = []
      neutralDailyRollCountByDay.clear()
      guaranteedNewUnlockTriggeredLevels.clear()
      QUALITY_PSEUDO_RANDOM_STATE.clear()
      QUICK_BUY_LEVEL_PSEUDO_RANDOM_STATE.clear()
      nextQuickBuyOffer = null
      heroDailyCardRerollUsedDays.clear()
      heroFirstDiscardRewardedDays.clear()
      heroFirstSameItemSynthesisChoiceDays.clear()
      heroSmithStoneGrantedDays.clear()
      heroAdventurerScrollGrantedDays.clear()
      heroCommanderMedalGrantedDays.clear()
      heroHeirGoldEquipGrantedDays.clear()
      heroTycoonGoldGrantedDays.clear()
      pendingHeroPeriodicRewards = []
      pendingHeroPeriodicRewardDispatching = false
      syncUnlockPoolToManager()
      grantSkill20DailyBronzeItemIfNeeded()
    }
    refreshSkillIconBar()
    refreshShopUI()
    applyPhaseInputLock()
    ensureStarterClassSelection(stage)
    ensureDailyChoiceSelection(stage)
  },

  onExit() {
    console.log('[ShopScene] 离开商店场景')
    const { stage } = getApp()

    teardownCrossSynthesisConfirmOverlay()
    stopFlashEffect()
    stopGridDragButtonFlash()
    stopBattleGuideHandAnim()
    stopUnlockRevealPlayback()

    if (shopDragFloater) {
      stage.removeChild(shopDragFloater)
      shopDragFloater.destroy({ children: true })
      shopDragFloater = null
    }
    _resetDrag()

    if (shopPanel)    { stage.removeChild(shopPanel); shopPanel.destroy({ children: true }); shopPanel = null }
    if (sellPopup)    stage.removeChild(sellPopup)
    if (battleView)   { stage.removeChild(battleView); battleView.destroy({ children: true }); battleView = null }
    if (backpackView) { stage.removeChild(backpackView); backpackView.destroy({ children: true }); backpackView = null }
    if (battleZoneTitleText) stage.removeChild(battleZoneTitleText)
    if (backpackZoneTitleText) stage.removeChild(backpackZoneTitleText)
    if (shopAreaBg)   stage.removeChild(shopAreaBg)
    if (backpackAreaBg) stage.removeChild(backpackAreaBg)
    if (battleAreaBg) stage.removeChild(battleAreaBg)
    if (restartBtn)   stage.removeChild(restartBtn)
    if (playerStatusCon) stage.removeChild(playerStatusCon)
    if (livesText)    stage.removeChild(livesText)
    if (trophyText)   stage.removeChild(trophyText)
    if (pvpPlayerListOverlay) {
      stage.removeChild(pvpPlayerListOverlay)
      pvpPlayerListOverlay.destroy({ children: true })
      pvpPlayerListOverlay = null
    }
    if (pvpWaitingPanel) {
      stage.removeChild(pvpWaitingPanel)
      pvpWaitingPanel.destroy({ children: true })
      pvpWaitingPanel = null
    }
    if (pvpOpponentBadge) {
      stage.removeChild(pvpOpponentBadge)
      pvpOpponentBadge.destroy({ children: true })
      pvpOpponentBadge = null
    }
    if (pvpOpponentHeroLayer) {
      stage.removeChild(pvpOpponentHeroLayer)
      pvpOpponentHeroLayer.destroy({ children: true })
      pvpOpponentHeroLayer = null
    }
    if (pvpBackpackReturnBtn) {
      pvpBackpackReturnBtn.parent?.removeChild(pvpBackpackReturnBtn)
      pvpBackpackReturnBtn.destroy({ children: true })
      pvpBackpackReturnBtn = null
    }
    PvpContext.onUrgeReceived = null
    PvpContext.onBeforeBattleTransition = null
    PvpContext.onEliminatedPlayersUpdate = null
    PvpContext.onOpponentKnown = null
    PvpContext.onOpponentPreAssigned = null
    PvpContext.onRoundSummaryReceived = null
    pvpUrgeCooldownSet.clear()
    if (btnRow)       stage.removeChild(btnRow)
    if (dayDebugCon)  stage.removeChild(dayDebugCon)
    if (settingsBtn)  stage.removeChild(settingsBtn)
    if (hintToastCon) stage.removeChild(hintToastCon)
    if (unlockRevealLayer) stage.removeChild(unlockRevealLayer)
    closeSettingsOverlay()
    if (passiveJumpLayer?.parent) passiveJumpLayer.parent.removeChild(passiveJumpLayer)
    if (classSelectOverlay?.parent) classSelectOverlay.parent.removeChild(classSelectOverlay)
    classSelectOverlay?.destroy({ children: true })
    classSelectOverlay = null
    if (starterGuideOverlay?.parent) starterGuideOverlay.parent.removeChild(starterGuideOverlay)
    starterGuideOverlay?.destroy({ children: true })
    starterGuideOverlay = null
    if (skillDraftOverlay?.parent) skillDraftOverlay.parent.removeChild(skillDraftOverlay)
    skillDraftOverlay?.destroy({ children: true })
    skillDraftOverlay = null
    if (eventDraftOverlay?.parent) eventDraftOverlay.parent.removeChild(eventDraftOverlay)
    eventDraftOverlay?.destroy({ children: true })
    eventDraftOverlay = null
    if (specialShopOverlay?.parent) specialShopOverlay.parent.removeChild(specialShopOverlay)
    specialShopOverlay?.destroy({ children: true })
    specialShopOverlay = null
    playerStatusCon?.destroy({ children: true })
    playerStatusCon = null
    playerStatusAvatar = null
    playerStatusAvatarClickHit = null
    playerStatusDailySkillStar = null
    playerStatusLvText = null
    playerStatusExpBg = null
    playerStatusExpBar = null
    playerStatusAvatarUrl = ''
    if (skillIconBarCon?.parent) skillIconBarCon.parent.removeChild(skillIconBarCon)
    skillIconBarCon?.destroy({ children: true })
    skillIconBarCon = null
    synthHoverInfoKey = ''

    if (onStageTapHidePopup) {
      stage.off('pointerdown', onStageTapHidePopup)
      onStageTapHidePopup = null
    }
    if (onStageShopPointerMove) {
      stage.off('pointermove', onStageShopPointerMove)
      onStageShopPointerMove = null
    }
    if (onStageShopPointerUp) {
      stage.off('pointerup', onStageShopPointerUp)
      onStageShopPointerUp = null
    }
    if (onStageShopPointerUpOutside) {
      stage.off('pointerupoutside', onStageShopPointerUpOutside)
      onStageShopPointerUpOutside = null
    }

    if (bpBtnHandle?.container) {
      const upTick = (bpBtnHandle.container as any)._upgradeTick as (() => void) | undefined
      if (upTick) {
        Ticker.shared.remove(upTick)
        ;(bpBtnHandle.container as any)._upgradeTick = undefined
      }
    }
    offDebugCfg?.()
    offDebugCfg = null
    offPhaseChange?.()
    offPhaseChange = null
    pvpReadyLocked = false
    if (pendingBattleTransition || PvpContext.isActive() || getBattleSnapshot()) {
      savedShopState = captureShopState()
      saveShopStateToStorage(savedShopState)
      pendingBattleTransition = false
    } else {
      clearBattleSnapshot()
      clearBattleOutcome()
      savedShopState = null
      pendingAdvanceToNextDay = false
    }
    clearAutoPackCache()
    if (hintToastHideTimer) {
      clearTimeout(hintToastHideTimer)
      hintToastHideTimer = null
    }

    battleStartTransition = null

    drag?.destroy()
    shopManager   = null; shopPanel    = null; sellPopup = null
    btnRow        = null
    goldText      = null; miniMapGfx   = null; miniMapCon = null
    shopAreaBg    = null; backpackAreaBg = null; battleAreaBg = null
    battleZoneTitleText = null
    backpackZoneTitleText = null
    restartBtn    = null
    livesText     = null
    trophyText    = null
    bpBtnHandle   = null; refreshBtnHandle = null; sellBtnHandle = null
    phaseBtnHandle = null
    refreshCostText = null
    hintToastCon = null
    hintToastBg = null
    hintToastText = null
    battleGuideHandCon = null
    battleGuideHandTick = null
    unlockRevealLayer = null
    unlockRevealTickFn = null
    unlockRevealActive = false
    crossSynthesisConfirmOverlay = null
    crossSynthesisConfirmTick = null
    crossSynthesisConfirmUnlockInput = null
    crossSynthesisConfirmAction = null
    crossSynthesisConfirmCloseTimer = null
    passiveJumpLayer = null
    battlePassivePrevStats.clear()
    battlePassiveResolvedStats.clear()
    if (expandTickFn) { Ticker.shared.remove(expandTickFn); expandTickFn = null }
    dayDebugText    = null
    dayPrevBtn      = null
    dayNextBtn      = null
    dayDebugCon     = null
    settingsBtn     = null
    currentDay      = 1
    unlockedItemIds.clear()
    neutralObtainedCountByKind.clear()
    neutralRandomCategoryPool = []
    neutralDailyRollCountByDay.clear()
    guaranteedNewUnlockTriggeredLevels.clear()
    QUALITY_PSEUDO_RANDOM_STATE.clear()
    QUICK_BUY_LEVEL_PSEUDO_RANDOM_STATE.clear()
    nextQuickBuyOffer = null
    starterClass    = null
    starterHeroChoiceOptions = []
    starterGranted  = false
    starterBattleGuideShown = false
    hasBoughtOnce = false
    resetSkill15NextBuyDiscountState()
    resetSkill30BundleState()
    quickBuyNoSynthRefreshStreak = 0
    quickBuyNeutralMissStreak = 0
    pickedSkills    = []
    draftedSkillDays = []
    pendingSkillDraft = null
    draftedEventDays = []
    pendingEventDraft = null
    draftedSpecialShopDays = []
    specialShopRefreshCount = 0
    specialShopOffers = []
    resetEventSelectionCounters()
    resetDayEventState()
    resetFutureEventState()
    itemTransformFlashLastAtMs.clear()
    skillDetailMode = getDefaultSkillDetailMode()
    skill20GrantedDays.clear()
    heroDailyCardRerollUsedDays.clear()
    heroFirstDiscardRewardedDays.clear()
    heroFirstSameItemSynthesisChoiceDays.clear()
    heroSmithStoneGrantedDays.clear()
    heroAdventurerScrollGrantedDays.clear()
    heroCommanderMedalGrantedDays.clear()
    heroHeirGoldEquipGrantedDays.clear()
    heroTycoonGoldGrantedDays.clear()
    pendingHeroPeriodicRewards = []
    pendingHeroPeriodicRewardDispatching = false
    showingBackpack = false
    battleSystem = backpackSystem = battleView = backpackView = drag = null
    instanceToDefId.clear()
    instanceToTier.clear()
    instanceToTierStar.clear()
    instanceToPermanentDamageBonus.clear()
    battlePassiveResolvedStats.clear()
  },

  update(dt: number) {
    tickBattleStartTransition(dt)
    // PVP 倒计时：实时更新 Day 标签旁的秒数
    if (PvpContext.isActive() && dayDebugText) {
      const remain = PvpContext.getCountdownRemainMs()
      const secs = Math.ceil(remain / 1000)
      const next = remain > 0 ? `Day ${currentDay} · ${secs}s` : `Day ${currentDay}`
      if (dayDebugText.text !== next) {
        dayDebugText.text = next
        layoutDayDebugControls()
      }
      const color = remain <= 0 ? 0xcccccc : remain < 30000 ? 0xff6b6b : 0xffd86b
      if (dayDebugText.style.fill !== color) dayDebugText.style.fill = color
    }
    // PVP HP：实时响应 round_summary 更新右上角血量显示
    if (PvpContext.isActive() && livesText) {
      const pvpSession = PvpContext.getSession()
      const myHp = pvpSession?.playerHps?.[pvpSession?.myIndex ?? -1] ?? 30
      const initHp = pvpSession?.initialHp ?? 30
      const next = `❤️ ${myHp}/${initHp}`
      if (livesText.text !== next) {
        livesText.text = next
        livesText.style.fill = myHp <= 2 ? 0xff6a6a : 0xffd4d4
        livesText.x = CANVAS_W - livesText.width - 18
      }
    }
    // sync-a 等待面板：就绪状态变化时刷新
    if (pvpWaitingPanel) {
      const cur = PvpContext.getSyncReadyIndices()
      const curKey = cur.slice().sort().join(',')
      if ((pvpWaitingPanel as any)._lastReadyKey !== curKey) {
        ;(pvpWaitingPanel as any)._lastReadyKey = curKey
        refreshPvpWaitingPanel()
      }
    }
  },
}
