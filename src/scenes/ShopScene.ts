// ============================================================
// ShopScene — 商店/准备场景（Phase 2 视觉验收版）
// 布局（640×1384 画布）：
//   y=430  商店面板 / 背包（互斥显示）
//   y=840  按钮行：背包 | 刷新(金币) | 出售
//   y=1020 我的战斗区 5×2
// 拖拽购买：从商店卡片拖到战斗区/背包按钮完成购买
// ============================================================

import { SceneManager, type Scene } from './SceneManager'
import { getApp } from '@/core/AppContext'
import { getConfig, getAllItems } from '@/core/DataLoader'
import { clearCurrentRunState, getLifeState, getWinTrophyState, resetLifeState, SHOP_STATE_STORAGE_KEY } from '@/core/RunState'
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
import { getItemIconUrl } from '@/core/assetPath'
import { getTierColor } from '@/config/colorPalette'
import { createItemStatBadges } from '@/ui/itemStatBadges'
import { PhaseManager } from '@/core/PhaseManager'
import { clearBattleSnapshot, setBattleSnapshot, type BattleSnapshotBundle } from '@/combat/BattleSnapshotStore'
import { clearBattleOutcome, consumeBattleOutcome } from '@/combat/BattleOutcomeStore'
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
const UNLOCK_REVEAL_TOTAL_MS = 2500

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
let miniMapGfx:     Graphics  | null = null
let miniMapCon:     Container | null = null
let bpBtnHandle:      CircleBtnHandle | null = null
let refreshBtnHandle: CircleBtnHandle | null = null
let sellBtnHandle:    CircleBtnHandle | null = null
let phaseBtnHandle:   CircleBtnHandle | null = null
let refreshCostText:  Text            | null = null
let settingsBtn:      Container       | null = null
let settingsOverlay:  Container       | null = null
let hintToastCon:     Container       | null = null
let hintToastBg:      Graphics        | null = null
let hintToastText:    Text            | null = null
let battleZoneTitleText: Text | null = null
let backpackZoneTitleText: Text | null = null
let hintToastHideTimer: ReturnType<typeof setTimeout> | null = null
let unlockRevealLayer: Container | null = null
let unlockRevealQueue: string[] = []
let unlockRevealTickFn: (() => void) | null = null
let unlockRevealActive = false

type ToastReason = 'no_gold_buy' | 'no_gold_refresh' | 'backpack_full_buy' | 'backpack_full_transfer'

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
let gridDragFlashTick: (() => void) | null = null
let gridDragFlashOverlay: Graphics | null = null
let gridDragSellZoneCon: Container | null = null
let gridDragSellZoneBg: Graphics | null = null
let gridDragSellZoneText: Text | null = null
let gridDragCanSell = false
let gridDragCanToBackpack = false
let gridDragSellPrice = 0
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
let selectedInfoMode: ItemInfoMode = 'simple'

function resetInfoModeSelection(): void {
  selectedInfoKey = null
  selectedInfoMode = 'simple'
}

function resolveInfoMode(nextKey: string): ItemInfoMode {
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
  starterClass?: 'swordsman' | 'archer' | 'assassin' | null
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
  hasBoughtOnce?: boolean
}

let pendingBattleTransition = false
let pendingAdvanceToNextDay = false
let savedShopState: SavedShopState | null = null

type StarterClass = 'swordsman' | 'archer' | 'assassin'
let starterClass: StarterClass | null = null
let starterGranted = false
let starterBattleGuideShown = false
let hasBoughtOnce = false
let classSelectOverlay: Container | null = null
let starterGuideOverlay: Container | null = null
let skillDraftOverlay: Container | null = null
let crossSynthesisConfirmOverlay: Container | null = null
let crossSynthesisConfirmTick: (() => void) | null = null
let crossSynthesisConfirmUnlockInput: (() => void) | null = null
let crossSynthesisConfirmAction: (() => void) | null = null
let crossSynthesisConfirmCloseTimer: ReturnType<typeof setTimeout> | null = null
let skillIconBarCon: Container | null = null
let skillDetailPopupCon: Container | null = null
let skillDetailSkillId: string | null = null

type SkillPick = {
  id: string
  name: string
  archetype: SkillArchetype
  desc: string
  tier: SkillTier
}

type PendingSkillDraft = {
  day: number
  tier: SkillTier
  choices: SkillPick[]
}

let pickedSkills: SkillPick[] = []
let draftedSkillDays: number[] = []
let pendingSkillDraft: PendingSkillDraft | null = null
const unlockedItemIds = new Set<string>()
const guaranteedNewUnlockTriggeredLevels = new Set<number>()
let nextQuickBuyOffer: {
  itemId: string
  tier: TierKey
  star: 1 | 2
  price: number
} | null = null

// 临时开关：屏蔽技能三选一流程（保留配置与存档字段，便于后续恢复）
const SKILL_DRAFT_ENABLED = false

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
  stopGridDragButtonFlash()
  stopFlashEffect()
  battleView?.clearHighlight()
  backpackView?.clearHighlight()
  setTransitionInputEnabled(false)
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
  window.location.reload()
}

function isShopInputEnabled(): boolean {
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
  const padX = 24
  const padY = 12
  const boxW = hintToastText.width + padX * 2
  const boxH = hintToastText.height + padY * 2
  const boxX = (CANVAS_W - boxW) / 2
  const boxY = 120
  const corner = Math.max(10, Math.round(getDebugCfg('gridItemCornerRadius')))
  hintToastBg.clear()
  hintToastBg.roundRect(boxX, boxY, boxW, boxH, corner)
  hintToastBg.fill({ color: 0x1a2238, alpha: 0.88 })
  hintToastBg.stroke({ color: 0xffd25a, width: 2, alpha: 0.9 })
  hintToastText.x = boxX + padX
  hintToastText.y = boxY + padY
  hintToastCon.visible = true
  hintToastHideTimer = setTimeout(() => {
    if (hintToastCon) hintToastCon.visible = false
    hintToastHideTimer = null
  }, 1200)
}

function stopUnlockRevealPlayback(clearQueue = false): void {
  if (unlockRevealTickFn) {
    Ticker.shared.remove(unlockRevealTickFn)
    unlockRevealTickFn = null
  }
  unlockRevealActive = false
  if (clearQueue) unlockRevealQueue = []
  if (!unlockRevealLayer) return
  unlockRevealLayer.visible = false
  unlockRevealLayer.removeChildren().forEach((ch) => ch.destroy({ children: true }))
}

function ensureUnlockRevealLayer(stage: Container): Container {
  if (unlockRevealLayer) return unlockRevealLayer
  const layer = new Container()
  layer.eventMode = 'none'
  layer.visible = false
  layer.zIndex = 11000
  stage.addChild(layer)
  unlockRevealLayer = layer
  return layer
}

function playNextUnlockReveal(): void {
  if (unlockRevealActive) return
  const nextDefId = unlockRevealQueue.shift()
  if (!nextDefId) return
  const def = getItemDefById(nextDefId)
  if (!def) {
    playNextUnlockReveal()
    return
  }

  const stage = getApp().stage
  const layer = ensureUnlockRevealLayer(stage)
  layer.removeChildren().forEach((ch) => ch.destroy({ children: true }))
  layer.visible = true
  if (layer.parent) layer.parent.addChild(layer)

  const panelW = 520
  const panelH = 248
  const panelX = (CANVAS_W - panelW) / 2
  const panelY = 132
  const tier = parseTierName(def.starting_tier) ?? 'Bronze'
  const tierColor = getTierColor(tier)
  const baseLevel = tier === 'Bronze' ? 1 : tier === 'Silver' ? 3 : tier === 'Gold' ? 5 : 7
  const previewScale = Math.max(0.55, Math.min(1.2, getBattleItemScale()))

  const con = new Container()
  con.x = panelX + panelW / 2
  con.y = panelY + panelH / 2
  con.alpha = 0
  con.scale.set(0.86)

  const bg = new Graphics()
  bg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 24)
  bg.fill({ color: 0x10182b, alpha: 0.92 })
  bg.stroke({ color: tierColor, width: 3, alpha: 0.95 })
  con.addChild(bg)

  const tierBorderWidth = Math.max(1, Math.round(getDebugCfg('tierBorderWidth')))
  const cardW = Math.max(72, Math.round(CELL_SIZE * previewScale))
  const cardH = Math.max(72, Math.round(CELL_HEIGHT * previewScale))
  const cardX = -cardW / 2
  const cardY = -Math.round(panelH * 0.42)
  const frameInset = Math.max(3, 2 + Math.ceil(tierBorderWidth / 2))
  const frameW = Math.max(1, cardW - frameInset * 2)
  const frameH = Math.max(1, cardH - frameInset * 2)
  const frameRadius = Math.max(0, Math.round(getDebugCfg('gridItemCornerRadius')) - (frameInset - 3))

  const iconFrame = new Graphics()
  iconFrame.roundRect(cardX + frameInset, cardY + frameInset, frameW, frameH, frameRadius)
  iconFrame.fill({ color: 0x0b1222, alpha: 0.95 })
  iconFrame.stroke({ color: tierColor, width: tierBorderWidth, alpha: 0.98 })
  con.addChild(iconFrame)

  const glow = new Graphics()
  glow.roundRect(cardX + frameInset + tierBorderWidth + 2, cardY + frameInset + tierBorderWidth + 2, Math.max(1, frameW - (tierBorderWidth + 2) * 2), Math.max(1, frameH - (tierBorderWidth + 2) * 2), Math.max(8, frameRadius - 4))
  glow.fill({ color: tierColor, alpha: 0.24 })
  glow.stroke({ color: 0xffffff, width: 2, alpha: 0.22 })
  glow.blendMode = 'add'
  con.addChild(glow)

  const badgeCon = createItemStatBadges(
    def,
    Math.max(12, Math.round(getDebugCfg('itemStatBadgeFontSize') * previewScale)),
    Math.max(44, cardW - 8),
    undefined,
    'archetype',
    { archetypeSuffix: String(baseLevel) },
  )
  badgeCon.x = 0
  badgeCon.y = cardY + Math.round(getDebugCfg('itemStatBadgeOffsetY') * previewScale) + Math.round(14 * previewScale)

  const icon = new Sprite(Texture.WHITE)
  icon.anchor.set(0.5)
  icon.x = 0
  const spriteInset = frameInset + Math.max(2, Math.ceil(tierBorderWidth / 2))
  const baseCellInner = Math.max(1, cardW - spriteInset * 2)
  const spriteSide = Math.max(1, Math.min(frameW, baseCellInner))
  icon.y = cardY + frameInset + frameH / 2
  icon.width = spriteSide
  icon.height = spriteSide
  con.addChild(icon)
  con.addChild(badgeCon)
  void Assets.load<Texture>(getItemIconUrl(def.id)).then((tex) => {
    icon.texture = tex
  }).catch(() => {
    // ignore missing icon
  })

  const title = new Text({
    text: `解锁物品 ${def.name_cn}`,
    style: {
      fontSize: getConfig().textSizes.itemInfoName,
      fill: 0xfff2cf,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      stroke: { color: 0x000000, width: 4 },
    },
  })
  title.anchor.set(0.5)
  title.x = 0
  const frameBottom = cardY + frameInset + frameH
  const titleGap = Math.max(16, Math.round(22 * previewScale))
  title.y = frameBottom + titleGap + title.height / 2
  const titleBottom = title.y + title.height / 2 + 12
  const panelBottom = panelH / 2
  if (titleBottom > panelBottom) {
    title.y -= (titleBottom - panelBottom)
  }
  const minTitleY = frameBottom + 10 + title.height / 2
  if (title.y < minTitleY) title.y = minTitleY
  con.addChild(title)

  layer.addChild(con)
  unlockRevealActive = true
  const startMs = Date.now()
  unlockRevealTickFn = () => {
    const elapsed = Date.now() - startMs
    const p = Math.max(0, Math.min(1, elapsed / UNLOCK_REVEAL_TOTAL_MS))
    const fadeIn = Math.min(1, p / 0.18)
    const fadeOut = p > 0.82 ? (1 - p) / 0.18 : 1
    con.alpha = Math.max(0, Math.min(1, fadeIn * Math.max(0, Math.min(1, fadeOut))))
    const scaleIn = Math.min(1, p / 0.2)
    con.scale.set(0.86 + (1 - Math.pow(1 - scaleIn, 3)) * 0.14)
    glow.rotation += 0.05
    glow.alpha = 0.2 + 0.12 * Math.sin(elapsed / 120)

    if (elapsed >= UNLOCK_REVEAL_TOTAL_MS) {
      stopUnlockRevealPlayback(false)
      playNextUnlockReveal()
    }
  }
  Ticker.shared.add(unlockRevealTickFn)
}

function enqueueUnlockReveal(defId: string): void {
  unlockRevealQueue.push(defId)
  playNextUnlockReveal()
}

function updatePhaseToggleButton(): void {
  if (!phaseBtnHandle) return
  const inShop = isShopInputEnabled()
  phaseBtnHandle.setLabel(inShop ? '战斗' : '商店')
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

  if (bpBtnHandle) bpBtnHandle.container.visible = false
  if (refreshBtnHandle) refreshBtnHandle.container.visible = inShop
  if (sellBtnHandle) sellBtnHandle.container.visible = inShop
  if (phaseBtnHandle) phaseBtnHandle.container.visible = true

  if (refreshCostText) refreshCostText.visible = inShop
  if (goldText) goldText.visible = inShop
  if (livesText) livesText.visible = inShop
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

function buildBattleSnapshot(): BattleSnapshotBundle | null {
  if (!battleSystem || !battleView) return null
  const activeColCount = battleView.activeColCount
  const snap = battleSystem.exportCombatSnapshot(activeColCount)
  return {
    day: currentDay,
    activeColCount: snap.activeColCount,
    createdAtMs: snap.createdAtMs,
    entities: snap.entities.map((it) => ({
      ...it,
      tier: instanceToTier.get(it.instanceId) ?? 'Bronze',
      tierStar: getInstanceTierStar(it.instanceId),
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
  const tier = instanceToTier.get(instanceId) ?? 'Bronze'
  const star = getInstanceTierStar(instanceId)
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
    tier: instanceToTier.get(it.instanceId) ?? 'Bronze',
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
    hasBoughtOnce,
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
  unlockedItemIds.clear()
  const savedUnlocks = Array.isArray(state.unlockedItemIds)
    ? state.unlockedItemIds.filter((id): id is string => typeof id === 'string')
    : []
  if (savedUnlocks.length > 0) {
    for (const id of savedUnlocks) unlockedItemIds.add(id)
  }
  guaranteedNewUnlockTriggeredLevels.clear()
  CROSS_SYNTH_MIN_TIER_CYCLE_CURSOR.clear()
  CROSS_SYNTH_MIN_TIER_CYCLE_BAG.clear()
  const savedGuaranteed = Array.isArray(state.guaranteedNewUnlockTriggeredLevels)
    ? state.guaranteedNewUnlockTriggeredLevels.filter((lv): lv is number => Number.isFinite(lv)).map((lv) => Math.round(lv))
    : []
  for (const lv of savedGuaranteed) guaranteedNewUnlockTriggeredLevels.add(lv)
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
  instanceToTier.clear()
  instanceToTierStar.clear()
  instanceToPermanentDamageBonus.clear()

  const restoreOne = (it: SavedPlacedItem, system: GridSystem, view: GridZone) => {
    system.place(it.col, it.row, it.size, it.defId, it.instanceId)
    instanceToDefId.set(it.instanceId, it.defId)
    instanceToTier.set(it.instanceId, it.tier)
    instanceToTierStar.set(it.instanceId, normalizeTierStar(it.tier, it.tierStar))
    instanceToPermanentDamageBonus.set(it.instanceId, Math.max(0, Math.round(it.permanentDamageBonus ?? 0)))
    view.addItem(it.instanceId, it.defId, it.size, it.col, it.row, toVisualTier(it.tier, normalizeTierStar(it.tier, it.tierStar))).then(() => {
      view.setItemTier(it.instanceId, toVisualTier(it.tier, normalizeTierStar(it.tier, it.tierStar)))
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
const instanceToTier = new Map<string, TierKey>()
const instanceToTierStar = new Map<string, 1 | 2>()
const instanceToPermanentDamageBonus = new Map<string, number>()

function removeInstanceMeta(instanceId: string): void {
  instanceToDefId.delete(instanceId)
  instanceToTier.delete(instanceId)
  instanceToTierStar.delete(instanceId)
  instanceToPermanentDamageBonus.delete(instanceId)
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

function getItemDefById(defId: string): ItemDef | undefined {
  return getAllItems().find((it) => it.id === defId)
}

function getPrimaryArchetype(rawTags: string): string {
  const first = String(rawTags || '').split('|')[0]?.trim() ?? ''
  return first.split('/')[0]?.trim() ?? ''
}

function isCrossIdSynthesisConfirmEnabled(): boolean {
  const runtimeToggle = getDebugCfg('gameplayCrossSynthesisConfirm') >= 0.5
  if (runtimeToggle) return true
  const raw = getConfig().shopRules?.crossIdSynthesisRequireConfirm
  return raw === true
}

function closeSettingsOverlay(): void {
  if (!settingsOverlay) return
  if (settingsOverlay.parent) settingsOverlay.parent.removeChild(settingsOverlay)
  settingsOverlay.destroy({ children: true })
  settingsOverlay = null
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
  panel.y = 318
  panel.eventMode = 'static'
  panel.on('pointerdown', (e) => e.stopPropagation())
  overlay.addChild(panel)

  const panelW = 612
  const panelH = 384
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
  title.y = -146
  panel.addChild(title)

  const subtitle = new Text({
    text: '本局即时生效',
    style: { fontSize: 18, fill: 0xa8bddf, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  subtitle.anchor.set(0.5)
  subtitle.y = -106
  panel.addChild(subtitle)

  type ToggleRow = {
    key: 'gameplayCrossSynthesisConfirm' | 'gameplayShowSpeedButton'
    label: string
  }
  const rows: ToggleRow[] = [
    { key: 'gameplayCrossSynthesisConfirm', label: '合成二次弹窗' },
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

  drawRow(4, rows[0])
  drawRow(104, rows[1])

  const closeBtn = new Container()
  closeBtn.x = 0
  closeBtn.y = 166
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
  if (sourceTier !== targetTier || sourceStar !== targetStar) return false
  if (!nextTierLevel(sourceTier, sourceStar)) return false
  if (sourceDefId === targetDefId) return true
  const sourceDef = getItemDefById(sourceDefId)
  const targetDef = getItemDefById(targetDefId)
  if (!sourceDef || !targetDef) return false
  const sourceArch = getPrimaryArchetype(sourceDef.tags)
  const targetArch = getPrimaryArchetype(targetDef.tags)
  return !!sourceArch && sourceArch === targetArch
}

const TIER_ORDER: TierKey[] = ['Bronze', 'Silver', 'Gold', 'Diamond']
const TIER_LABEL_CN: Record<TierKey, string> = {
  Bronze: '青铜',
  Silver: '白银',
  Gold: '黄金',
  Diamond: '钻石',
}

function tierStarLabelCn(tier: TierKey, star: 1 | 2): string {
  const actualStar = tier === 'Diamond' ? 1 : star
  return `${TIER_LABEL_CN[tier]}${actualStar}星`
}

function maxStarForTier(tier: TierKey): 1 | 2 {
  return tier === 'Diamond' ? 1 : 2
}

function normalizeTierStar(tier: TierKey, star?: number): 1 | 2 {
  const max = maxStarForTier(tier)
  const value = Number.isFinite(star) ? Math.round(star as number) : 1
  if (value <= 1) return 1
  return max
}

function nextTierLevel(tier: TierKey, star: 1 | 2): { tier: TierKey, star: 1 | 2 } | null {
  if (tier === 'Diamond') return null
  if (star < maxStarForTier(tier)) return { tier, star: 2 }
  const idx = TIER_ORDER.indexOf(tier)
  if (idx < 0 || idx >= TIER_ORDER.length - 1) return null
  const next = TIER_ORDER[idx + 1] ?? null
  if (!next) return null
  return { tier: next, star: 1 }
}

function tierStarLevelIndex(tier: TierKey, star: 1 | 2): number {
  const s = tier === 'Diamond' ? 1 : star
  if (tier === 'Bronze' && s === 1) return 0
  if (tier === 'Bronze' && s === 2) return 1
  if (tier === 'Silver' && s === 1) return 2
  if (tier === 'Silver' && s === 2) return 3
  if (tier === 'Gold' && s === 1) return 4
  if (tier === 'Gold' && s === 2) return 5
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

const CROSS_SYNTH_MIN_TIER_CYCLE_CURSOR = new Map<number, number>()
const CROSS_SYNTH_MIN_TIER_CYCLE_BAG = new Map<number, TierKey[]>()

function gcd2(a: number, b: number): number {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y !== 0) {
    const t = x % y
    x = y
    y = t
  }
  return x || 1
}

function getCrossSynthesisMinTierCycle(resultTier: TierKey, resultStar: 1 | 2): TierKey[] {
  const cfg = getConfig().shopRules?.synthesisMinTierDropWeightsByResultLevel
    ?? getConfig().shopRules?.minTierDropWeightsByResultLevel
  const idx = tierStarLevelIndex(resultTier, resultStar)
  const tiers: TierKey[] = ['Bronze', 'Silver', 'Gold', 'Diamond']
  const scaled = tiers.map((tier) => {
    const list = cfg?.[tier]
    const raw = Array.isArray(list) ? list[idx] : undefined
    const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : 0
    return Math.round(n * 100)
  })
  const positive = scaled.filter((v) => v > 0)
  if (positive.length <= 0) return ['Bronze']
  let g = positive[0]!
  for (let i = 1; i < positive.length; i++) g = gcd2(g, positive[i]!)
  const out: TierKey[] = []
  for (let i = 0; i < tiers.length; i++) {
    const cnt = Math.max(0, Math.round(scaled[i]! / g))
    for (let k = 0; k < cnt; k++) out.push(tiers[i]!)
  }
  return out.length > 0 ? out : ['Bronze']
}

function pickCrossSynthesisDesiredMinTier(resultTier: TierKey, resultStar: 1 | 2): TierKey {
  const level = tierStarLevelIndex(resultTier, resultStar) + 1
  const cycle = getCrossSynthesisMinTierCycle(resultTier, resultStar)
  if (cycle.length <= 0) return 'Bronze'
  let cursor = CROSS_SYNTH_MIN_TIER_CYCLE_CURSOR.get(level) ?? 0
  let bag = CROSS_SYNTH_MIN_TIER_CYCLE_BAG.get(level)
  if (!bag || bag.length !== cycle.length || cursor >= bag.length) {
    bag = [...cycle]
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const t = bag[i]
      bag[i] = bag[j]!
      bag[j] = t!
    }
    CROSS_SYNTH_MIN_TIER_CYCLE_BAG.set(level, bag)
    cursor = 0
  }
  const picked = bag[cursor] ?? bag[0] ?? 'Bronze'
  CROSS_SYNTH_MIN_TIER_CYCLE_CURSOR.set(level, cursor + 1)
  return picked
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
  const resultLevel = tierStarLevelIndex(resultTier, resultStar) + 1
  const shouldGuarantee = (resultLevel === 3 || resultLevel === 5 || resultLevel === 7)
    && !guaranteedNewUnlockTriggeredLevels.has(resultLevel)

  if (!shouldGuarantee) return pickItemByMinTierWeight(candidates, resultTier, resultStar)
  const lockedCandidates = candidates.filter((it) => !unlockedItemIds.has(it.id))
  if (lockedCandidates.length > 0) {
    return pickItemByMinTierWeight(lockedCandidates, resultTier, resultStar)
  }
  return pickItemByMinTierWeight(candidates, resultTier, resultStar)
}

function pickCrossSynthesisResultWithCycle(
  candidates: ItemDef[],
  resultTier: TierKey,
  resultStar: 1 | 2,
  minStartingTier: TierKey,
): ItemDef | null {
  if (candidates.length <= 0) return null
  const desiredMinTier = pickCrossSynthesisDesiredMinTier(resultTier, resultStar)
  let targetMinTier = maxTier(desiredMinTier, minStartingTier)
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
  const level = tierStarLevelIndex(resultTier, resultStar) + 1
  return (level === 3 || level === 5 || level === 7) && !guaranteedNewUnlockTriggeredLevels.has(level)
}

function compareTier(a: TierKey, b: TierKey): number {
  return TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b)
}

function maxTier(a: TierKey, b: TierKey): TierKey {
  return compareTier(a, b) >= 0 ? a : b
}

function getInstanceTier(instanceId: string): TierKey | undefined {
  return instanceToTier.get(instanceId)
}

function getInstanceTierStar(instanceId: string): 1 | 2 {
  const tier = instanceToTier.get(instanceId) ?? 'Bronze'
  return normalizeTierStar(tier, instanceToTierStar.get(instanceId))
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
  enqueueUnlockReveal(defId)
  return true
}

function seedInitialUnlockPoolByStarterClass(_pick: StarterClass): void {
  unlockedItemIds.clear()
  nextQuickBuyOffer = null
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

function isStarterClassItem(item: ItemDef): boolean {
  const tag = getStarterClassTag()
  if (!tag) return true
  return `${item.tags ?? ''}`.includes(tag)
}

function isFirstPurchaseLockedToStarterClass(): boolean {
  return !hasBoughtOnce && !!starterClass
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
          if (!isWeapon(aid)) continue
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
          if (st.damage <= 0) continue
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
    instanceToTier.set(newId, entity.tier)
    instanceToTierStar.set(newId, 1)
    instanceToPermanentDamageBonus.set(newId, 0)
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

function findSynthesisTargetAtPointer(
  defId: string,
  tier: TierKey,
  star: 1 | 2,
  gx: number,
  gy: number,
  _dragSize?: ItemSizeNorm,
): SynthesisTarget | null {
  if (battleView && battleSystem) {
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
    tryZone(battleView, battleSystem, 'battle')
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
    && parseAvailableTiers(it.available_tiers).includes(resultTier)
    && compareTier(parseTierName(it.starting_tier) ?? 'Bronze', minStartingTier) >= 0
  )
  const sourceArch = getPrimaryArchetype(sourceDef.tags)
  if (!sourceArch) {
    return { basePool, sameArchPool: [], otherArchPool: basePool }
  }
  const sameArchPool = basePool.filter((it) => getPrimaryArchetype(it.tags) === sourceArch)
  const otherArchPool = basePool.filter((it) => getPrimaryArchetype(it.tags) !== sourceArch)
  return { basePool, sameArchPool, otherArchPool }
}

function pickCrossIdEvolveCandidates(sourceDef: ItemDef, targetSize: ItemSizeNorm, resultTier: TierKey, minStartingTier: TierKey): ItemDef[] {
  const { otherArchPool } = getCrossIdEvolvePool(sourceDef, targetSize, resultTier, minStartingTier)
  if (otherArchPool.length > 0) return otherArchPool
  return []
}

function getCrossIdPreviewCandidates(sourceDef: ItemDef, targetSize: ItemSizeNorm, resultTier: TierKey, minStartingTier: TierKey): ItemDef[] {
  const { otherArchPool } = getCrossIdEvolvePool(sourceDef, targetSize, resultTier, minStartingTier)
  return otherArchPool
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
  const upgradeTo = nextTierLevel(tier, star)
  if (!upgradeTo) return null

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

  const isCrossIdSynthesis = defId !== targetItem.defId
  const minStartingTier = getCrossSynthesisMinStartingTier(sourceDef, targetDef)
  const guaranteeNewUnlock = shouldGuaranteeNewUnlock(upgradeTo.tier, upgradeTo.star)
  const resultLevel = tierStarLevelIndex(upgradeTo.tier, upgradeTo.star) + 1
  const evolveCandidates = (() => {
    if (defId === targetItem.defId) {
      return getAllItems().filter((it) => it.id === defId && parseAvailableTiers(it.available_tiers).includes(upgradeTo.tier))
    }
    if (guaranteeNewUnlock) {
      return getCrossIdEvolvePool(sourceDef, targetItem.size, upgradeTo.tier, minStartingTier).otherArchPool
    }
    return pickCrossIdEvolveCandidates(sourceDef, targetItem.size, upgradeTo.tier, minStartingTier)
  })()
  const evolvedDef = isCrossIdSynthesis
    ? pickCrossSynthesisResultWithCycle(evolveCandidates, upgradeTo.tier, upgradeTo.star, minStartingTier)
    : pickSynthesisResultWithGuarantee(evolveCandidates, upgradeTo.tier, upgradeTo.star)
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
  instanceToTier.set(targetInstanceId, upgradeTo.tier)
  instanceToTierStar.set(targetInstanceId, upgradeTo.star)
  unlockItemToPool(evolvedDef.id)
  if (guaranteeNewUnlock && (resultLevel === 3 || resultLevel === 5 || resultLevel === 7)) {
    guaranteedNewUnlockTriggeredLevels.add(resultLevel)
  }
  applyInstanceTierVisuals()
  syncShopOwnedTierRules()
  refreshUpgradeHints()
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
  const upgradeTo = nextTierLevel(sourceTier, sourceStar)
  if (!upgradeTo) return

  const system = target.zone === 'battle' ? battleSystem : backpackSystem
  const targetItem = system.getItem(target.instanceId)
  if (!targetItem) return
  const isSameItem = sourceDefId === targetItem.defId
  const key = `${sourceDefId}|${sourceTier}|${sourceStar}|${target.instanceId}|${isSameItem}`
  if (synthHoverInfoKey === key) return
  synthHoverInfoKey = key

  const buyPrice = shopManager.getItemPrice(sourceDef, sourceTier)
  if (isSameItem) {
    const customDisplay: ItemInfoCustomDisplay = {
      overrideName: `${sourceDef.name_cn}（可合成）`,
      suppressStats: false,
    }
    sellPopup.show(
      sourceDef,
      buyPrice,
      'buy',
      toVisualTier(upgradeTo.tier, upgradeTo.star),
      toVisualTier(sourceTier, sourceStar),
      'detailed',
      undefined,
      customDisplay,
    )
  } else {
    const customDisplay: ItemInfoCustomDisplay = {
      overrideName: '随机合成',
      lines: [
        `等级 ${tierStarLabelCn(sourceTier, sourceStar)} -> ${tierStarLabelCn(upgradeTo.tier, upgradeTo.star)}`,
        '随机获得更高等级的物品',
      ],
      suppressStats: true,
      hideTierBadge: true,
      useQuestionIcon: true,
    }
    sellPopup.show(sourceDef, buyPrice, 'buy', toVisualTier(sourceTier, sourceStar), undefined, 'detailed', undefined, customDisplay)
  }
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
  const candidates = getCrossIdPreviewCandidates(sourcePreview.def, normalizeSize(targetPreview.def.size), resultTier, minStartingTier)
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
  const panelH = 640
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
  title.y = -248
  panel.addChild(title)

  const viewport = new Container()
  viewport.x = 0
  viewport.y = -62
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

  const closeAsCancel = () => {
    teardownCrossSynthesisConfirmOverlay()
    onCancel?.()
  }

  const actionBtnW = 376
  const actionBtnH = 88
  const actionBtnRadius = 18
  const actionBtnGap = 18
  const actionBtnStartY = 146
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
    gifts: ['匕首', '连发飞镖'],
    heroImage: '/resource/hero/assassin.png',
  },
}

function getItemDefByCn(nameCn: string): ItemDef | null {
  return getAllItems().find((it) => it.name_cn === nameCn) ?? null
}

function pickGuideCrossArchetypeItem(pick: StarterClass): ItemDef | null {
  // 展示用“其他职业”示例：优先选择目标职业“最低品质=白银”的物品
  const preferredByPick: Record<StarterClass, string[]> = {
    swordsman: ['手弩'],
    archer: ['回旋镖'],
    assassin: ['长盾'],
  }
  const targetTagByPick: Record<StarterClass, string> = {
    swordsman: '弓手',
    archer: '刺客',
    assassin: '战士',
  }

  for (const nameCn of preferredByPick[pick]) {
    const hit = getItemDefByCn(nameCn)
    if (hit && parseTierName(hit.starting_tier) === 'Silver') return hit
  }
  const targetTag = targetTagByPick[pick]
  return getAllItems().find((it) => `${it.tags ?? ''}`.includes(targetTag) && parseTierName(it.starting_tier) === 'Silver')
    ?? getAllItems().find((it) => `${it.tags ?? ''}`.includes(targetTag))
    ?? null
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
    if (battleSlot) {
      battleSystem.place(battleSlot.col, battleSlot.row, size, item.id, id)
      void battleView.addItem(id, item.id, size, battleSlot.col, battleSlot.row, toVisualTier(grant.tier, grant.star)).then(() => {
        battleView!.setItemTier(id, toVisualTier(grant.tier, grant.star))
        drag?.refreshZone(battleView!)
      })
    } else if (backpackSlot) {
      backpackSystem.place(backpackSlot.col, backpackSlot.row, size, item.id, id)
      void backpackView.addItem(id, item.id, size, backpackSlot.col, backpackSlot.row, toVisualTier(grant.tier, grant.star)).then(() => {
        backpackView!.setItemTier(id, toVisualTier(grant.tier, grant.star))
        drag?.refreshZone(backpackView!)
      })
    }

    instanceToDefId.set(id, item.id)
    instanceToTier.set(id, grant.tier)
    instanceToTierStar.set(id, grant.star)
    instanceToPermanentDamageBonus.set(id, 0)
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

function showStarterSynthesisGuide(stage: Container, pick: StarterClass): void {
  if (starterGuideOverlay) return
  const preset = STARTER_CLASS_PRESETS[pick]
  if (!preset) return
  const itemA = getItemDefByCn(preset.gifts[0])
  const itemB = getItemDefByCn(preset.gifts[1])
  const otherArchetypeItem = pickGuideCrossArchetypeItem(pick)
  if (!itemA || !itemB || !otherArchetypeItem) return

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
    text: '基础合成规则',
    style: { fontSize: 52, fill: 0xffefc8, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  title.anchor.set(0.5)
  title.y = -354
  panel.addChild(title)

  const line1 = new Text({
    text: '相同物品合成  →  升级为更高级',
    style: { fontSize: 32, fill: 0xdce8ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  line1.anchor.set(0.5)
  line1.y = -268
  panel.addChild(line1)

  const row1 = new Container()
  row1.y = -186
  const r1a = createGuideItemCard(itemA, '1')
  r1a.x = -216
  row1.addChild(r1a)
  const plus1 = new Text({ text: '+', style: { fontSize: 52, fill: 0x8ec6ff, fontFamily: 'Arial', fontWeight: 'bold' } })
  plus1.x = -104
  plus1.y = 22
  row1.addChild(plus1)
  const r1b = createGuideItemCard(itemA, '1')
  r1b.x = -44
  row1.addChild(r1b)
  const arrow1 = new Text({ text: '→', style: { fontSize: 58, fill: 0x8ec6ff, fontFamily: 'Arial', fontWeight: 'bold' } })
  arrow1.x = 84
  arrow1.y = 18
  row1.addChild(arrow1)
  const r1c = createGuideItemCard(itemA, '2')
  r1c.x = 166
  row1.addChild(r1c)
  panel.addChild(row1)

  const divider = new Graphics()
  divider.moveTo(-248, -22)
  divider.lineTo(248, -22)
  divider.stroke({ color: 0x5b6790, width: 1, alpha: 0.9 })
  panel.addChild(divider)

  const line2 = new Text({
    text: '同职业物品合成  →  随机升级',
    style: { fontSize: 32, fill: 0xdce8ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  line2.anchor.set(0.5)
  line2.y = 48
  panel.addChild(line2)

  const line2Sub = new Text({
    text: '可能获得更高品质的物品',
    style: { fontSize: 24, fill: 0xaec8f5, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  line2Sub.anchor.set(0.5)
  line2Sub.y = 92
  panel.addChild(line2Sub)

  const row2 = new Container()
  row2.y = 130
  const r2a = createGuideItemCard(itemA, '2', 'Bronze')
  r2a.x = -216
  row2.addChild(r2a)
  const plus2 = new Text({ text: '+', style: { fontSize: 52, fill: 0x8ec6ff, fontFamily: 'Arial', fontWeight: 'bold' } })
  plus2.x = -104
  plus2.y = 22
  row2.addChild(plus2)
  const r2b = createGuideItemCard(itemB, '2', 'Bronze')
  r2b.x = -44
  row2.addChild(r2b)
  const arrow2 = new Text({ text: '→', style: { fontSize: 58, fill: 0x8ec6ff, fontFamily: 'Arial', fontWeight: 'bold' } })
  arrow2.x = 84
  arrow2.y = 18
  row2.addChild(arrow2)
  const r2c = createGuideItemCard(otherArchetypeItem, '3', 'Silver')
  r2c.x = 166
  row2.addChild(r2c)
  panel.addChild(row2)

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
  })
  panel.addChild(closeBtn)

  starterGuideOverlay = overlay
  stage.addChild(overlay)
}

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
    text: '选择你的初始职业',
    style: { fontSize: 42, fill: 0xfff2cf, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  title.anchor.set(0.5)
  title.x = CANVAS_W / 2
  title.y = 150
  overlay.addChild(title)

  const subtitle = new Text({
    text: '请选择一条开局战斗风格',
    style: { fontSize: 24, fill: 0xb9c8e8, fontFamily: 'Arial' },
  })
  subtitle.anchor.set(0.5)
  subtitle.x = CANVAS_W / 2
  subtitle.y = 202
  overlay.addChild(subtitle)

  const cards: Array<{ key: StarterClass; border: Graphics }> = []
  const order: StarterClass[] = ['swordsman', 'archer', 'assassin']
  const cardW = 190
  const cardH = 504
  const gapX = 16
  const cardX = (CANVAS_W - (cardW * 3 + gapX * 2)) / 2
  const startY = 310
  let selected: StarterClass | null = starterClass

  const confirm = new Container()
  confirm.eventMode = 'static'
  confirm.cursor = 'pointer'
  const cBg = new Graphics()
  const cText = new Text({
    text: selected ? '进入大巴扎' : '请选择职业',
    style: { fontSize: 32, fill: 0x10162a, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  confirm.addChild(cBg)
  confirm.addChild(cText)

  const redrawConfirm = () => {
    cBg.clear()
    const enabled = !!selected
    cBg.roundRect((CANVAS_W - 500) / 2, CANVAS_H - 184, 500, 100, 24)
    cBg.fill({ color: enabled ? 0x52c0ff : 0x5f6b82, alpha: enabled ? 0.95 : 0.7 })
    cBg.stroke({ color: enabled ? 0x9be0ff : 0x8f9ab1, width: 3, alpha: 1 })
    cText.text = enabled ? '进入大巴扎' : '请选择职业'
    cText.style.fill = enabled ? 0x10162a : 0xdce4ff
    cText.x = CANVAS_W / 2 - cText.width / 2
    cText.y = CANVAS_H - 184 + (100 - cText.height) / 2
  }

  const redrawCards = () => {
    for (const c of cards) {
      const active = c.key === selected
      c.border.clear()
      c.border.roundRect(0, 0, cardW, cardH, 24)
      c.border.stroke({ color: active ? 0x5fd3ff : 0x6d7791, width: active ? 4 : 2, alpha: 1 })
      c.border.fill({ color: active ? 0x132a46 : 0x1b2438, alpha: active ? 0.95 : 0.85 })
    }
    redrawConfirm()
  }

  for (let i = 0; i < order.length; i++) {
    const key = order[i]!
    const preset = STARTER_CLASS_PRESETS[key]
    const con = new Container()
    con.x = cardX + i * (cardW + gapX)
    con.y = startY
    con.eventMode = 'static'
    con.cursor = 'pointer'
    con.hitArea = new Rectangle(0, 0, cardW, cardH)

    const border = new Graphics()
    con.addChild(border)

    const t = new Text({
      text: preset.title,
      style: { fontSize: 36, fill: 0xfff2cf, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    t.x = 32
    t.y = 24
    con.addChild(t)

    const d = new Text({
      text: preset.subtitle,
      style: {
        fontSize: 22,
        fill: 0xc7d5f2,
        fontFamily: 'Arial',
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: cardW - 30,
        lineHeight: 30,
      },
    })
    d.x = 18
    d.y = 352
    con.addChild(d)

    const hero = new Sprite(Texture.WHITE)
    const heroMaxW = 154
    const heroMaxH = 230
    hero.visible = false
    hero.x = (cardW - heroMaxW) / 2
    hero.y = 102
    void Assets.load<Texture>(preset.heroImage).then((tex) => {
      hero.texture = tex
      const sw = Math.max(1, tex.width)
      const sh = Math.max(1, tex.height)
      const scale = Math.min(heroMaxW / sw, heroMaxH / sh)
      hero.width = Math.max(1, Math.round(sw * scale))
      hero.height = Math.max(1, Math.round(sh * scale))
      hero.x = (cardW - hero.width) / 2
      hero.y = 102 + (heroMaxH - hero.height) / 2
      hero.visible = true
    }).catch(() => {
      // ignore missing asset in runtime
    })
    con.addChild(hero)

    con.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      selected = key
      redrawCards()
    })

    overlay.addChild(con)
    cards.push({ key, border })
  }

  confirm.on('pointerdown', (e: FederatedPointerEvent) => {
    e.stopPropagation()
    if (!selected) return
    starterClass = selected
    starterGranted = true
    starterBattleGuideShown = false
    seedInitialUnlockPoolByStarterClass(selected)
    grantStarterItemsByClass(selected)
    saveShopStateToStorage(captureShopState())
    if (classSelectOverlay?.parent) classSelectOverlay.parent.removeChild(classSelectOverlay)
    classSelectOverlay?.destroy({ children: true })
    classSelectOverlay = null
    setTransitionInputEnabled(true)
    applyPhaseInputLock()
    refreshShopUI()
    ensureSkillDraftSelection(stage)
    showStarterSynthesisGuide(stage, selected)
  })

  overlay.addChild(confirm)
  redrawCards()

  classSelectOverlay = overlay
  stage.addChild(overlay)
}

function skillTierLabelCn(tier: SkillTier): string {
  if (tier === 'bronze') return '青铜'
  if (tier === 'silver') return '白银'
  return '黄金'
}

function skillArchetypeLabelCn(archetype: SkillArchetype): string {
  if (archetype === 'warrior') return '战士'
  if (archetype === 'archer') return '弓手'
  if (archetype === 'assassin') return '刺客'
  return '通用'
}

function skillArchetypeColor(archetype: SkillArchetype): number {
  if (archetype === 'warrior') return 0xc45f3a
  if (archetype === 'archer') return 0x4f9f57
  if (archetype === 'assassin') return 0x3d74bd
  return 0x8a6bb5
}

function skillTierColor(tier: SkillTier): number {
  if (tier === 'bronze') return 0xbe8b46
  if (tier === 'silver') return 0x9aafc8
  return 0xd0ac43
}

function getSkillTierForDay(day: number): SkillTier | null {
  const skillCfg = getConfig().skillSystem
  if (!skillCfg) return null
  if ((skillCfg.triggerDaysByTier.bronze ?? []).includes(day)) return 'bronze'
  if ((skillCfg.triggerDaysByTier.silver ?? []).includes(day)) return 'silver'
  if ((skillCfg.triggerDaysByTier.gold ?? []).includes(day)) return 'gold'
  return null
}

function makeSkillPoolByTier(tier: SkillTier): SkillPick[] {
  const skillCfg = getConfig().skillSystem
  if (!skillCfg) return []
  const pool = skillCfg.pools[tier] ?? []
  return pool
    .map((it) => ({
      id: `${it.id}`,
      name: `${it.name}`,
      archetype: it.archetype,
      desc: `${it.desc}`,
      tier,
    }))
    .filter((it) => !!it.id && !!it.name && !!it.desc)
}

function pickSkillChoices(tier: SkillTier): SkillPick[] {
  const skillCfg = getConfig().skillSystem
  const chooseCount = Math.max(1, skillCfg?.chooseCount ?? 3)
  const source = makeSkillPoolByTier(tier)
  if (source.length <= chooseCount) return source
  const bag = [...source]
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = bag[i]
    bag[i] = bag[j]!
    bag[j] = t!
  }
  return bag.slice(0, chooseCount)
}

function layoutSkillIconBar(): void {
  if (!skillIconBarCon || !battleView) return
  const battleWidth = battleView.activeColCount * CELL_SIZE * battleView.scale.x
  skillIconBarCon.x = battleView.x + battleWidth / 2
  skillIconBarCon.y = battleView.y - 72
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
  if (!SKILL_DRAFT_ENABLED) {
    con.visible = false
    return
  }
  con.removeChildren().forEach((c) => c.destroy({ children: true }))
  if (pickedSkills.length <= 0) {
    con.visible = false
    return
  }

  const gap = 12
  const iconSize = 54
  const rowW = pickedSkills.length * iconSize + Math.max(0, pickedSkills.length - 1) * gap
  const bg = new Graphics()
  bg.roundRect(-rowW / 2 - 16, -38, rowW + 32, 78, 18)
  bg.fill({ color: 0x0f1728, alpha: 0.88 })
  bg.stroke({ color: 0x6f809e, width: 2, alpha: 0.9 })
  con.addChild(bg)

  for (let i = 0; i < pickedSkills.length; i++) {
    const s = pickedSkills[i]!
    const cell = new Container()
    cell.eventMode = 'static'
    cell.cursor = 'pointer'
    const x = -rowW / 2 + i * (iconSize + gap)
    const tierColor = skillTierColor(s.tier)
    const mainColor = skillArchetypeColor(s.archetype)

    const iconBg = new Graphics()
    iconBg.roundRect(x, -26, iconSize, iconSize, 14)
    iconBg.fill({ color: 0x1d2a45, alpha: 1 })
    iconBg.stroke({ color: tierColor, width: 3, alpha: 1 })
    cell.addChild(iconBg)

    const badge = new Graphics()
    badge.circle(x + iconSize - 9, -18, 7)
    badge.fill({ color: mainColor, alpha: 1 })
    cell.addChild(badge)

    const letter = new Text({
      text: s.name.slice(0, 1),
      style: { fontSize: 24, fill: 0xf5f7ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    letter.anchor.set(0.5)
    letter.x = x + iconSize / 2
    letter.y = 0
    cell.addChild(letter)

    cell.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      if (skillDetailSkillId === s.id) {
        hideSkillDetailPopup()
      } else {
        currentSelection = { kind: 'none' }
        selectedSellAction = null
        resetInfoModeSelection()
        shopPanel?.setSelectedSlot(-1)
        battleView?.setSelected(null)
        backpackView?.setSelected(null)
        sellPopup?.hide()
        applySellButtonState()
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
  const iconSize = Math.max(72, Math.round(CELL_SIZE * 0.66))
  const iconX = pad
  const iconY = pad
  const tierColor = skillTierColor(skill.tier)
  const mainColor = skillArchetypeColor(skill.archetype)
  const textX = iconX + iconSize + 16
  const textW = panelW - textX - pad
  const titleFontSize = getDebugCfg('itemInfoNameFontSize')
  const descFontSize = getDebugCfg('itemInfoSimpleDescFontSize')

  const title = new Text({
    text: skill.name,
    style: { fontSize: titleFontSize, fill: 0xffefc8, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  const desc = new Text({
    text: skill.desc,
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

  const iconBg = new Graphics()
  iconBg.roundRect(px + iconX, py + iconY, iconSize, iconSize, 18)
  iconBg.fill({ color: 0x1d2a45, alpha: 1 })
  iconBg.stroke({ color: tierColor, width: 3, alpha: 1 })
  con.addChild(iconBg)

  const iconBadge = new Graphics()
  iconBadge.circle(px + iconX + iconSize - 10, py + iconY + 10, 8)
  iconBadge.fill({ color: mainColor, alpha: 1 })
  con.addChild(iconBadge)

  const iconLetter = new Text({
    text: skill.name.slice(0, 1),
    style: { fontSize: 56, fill: 0xf5f7ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  iconLetter.anchor.set(0.5)
  iconLetter.x = px + iconX + iconSize / 2
  iconLetter.y = py + iconY + iconSize / 2 + 2
  con.addChild(iconLetter)

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

  skillDetailSkillId = skill.id
  con.visible = true
}

function closeSkillDraftOverlay(): void {
  if (skillDraftOverlay?.parent) skillDraftOverlay.parent.removeChild(skillDraftOverlay)
  skillDraftOverlay?.destroy({ children: true })
  skillDraftOverlay = null
}

function ensureSkillDraftSelection(stage: Container): void {
  if (!SKILL_DRAFT_ENABLED) {
    pendingSkillDraft = null
    closeSkillDraftOverlay()
    return
  }
  if (classSelectOverlay) return
  if (skillDraftOverlay) return
  const skillCfg = getConfig().skillSystem
  if (!skillCfg) return

  let draft = pendingSkillDraft
  if (!draft) {
    const tier = getSkillTierForDay(currentDay)
    if (!tier) return
    if (draftedSkillDays.includes(currentDay)) return
    const choices = pickSkillChoices(tier)
    if (choices.length <= 0) return
    draft = { day: currentDay, tier, choices }
    pendingSkillDraft = draft
  }

  if (draft.choices.length <= 0) return

  setTransitionInputEnabled(false)

  const overlay = new Container()
  overlay.zIndex = 3500
  overlay.eventMode = 'static'
  overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

  const bg = new Graphics()
  bg.rect(0, 0, CANVAS_W, CANVAS_H)
  bg.fill({ color: 0x070d1d, alpha: 0.92 })
  overlay.addChild(bg)

  const title = new Text({
    text: `Day ${draft.day} 技能选择`,
    style: { fontSize: 42, fill: 0xfff2cf, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  title.anchor.set(0.5)
  title.x = CANVAS_W / 2
  title.y = 154
  overlay.addChild(title)

  const subtitle = new Text({
    text: `${skillTierLabelCn(draft.tier)}技能（三选一）`,
    style: { fontSize: 24, fill: 0xb8c8e5, fontFamily: 'Arial' },
  })
  subtitle.anchor.set(0.5)
  subtitle.x = CANVAS_W / 2
  subtitle.y = 206
  overlay.addChild(subtitle)

  const cardW = 188
  const cardH = 470
  const gapX = 16
  const cardX = (CANVAS_W - (cardW * 3 + gapX * 2)) / 2
  const cardY = 286

  draft.choices.slice(0, 3).forEach((choice, idx) => {
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

    const icon = new Graphics()
    icon.circle(cardW / 2, 86, 40)
    icon.fill({ color: skillArchetypeColor(choice.archetype), alpha: 1 })
    con.addChild(icon)

    const iconText = new Text({
      text: choice.name.slice(0, 1),
      style: { fontSize: 38, fill: 0xf5f8ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    iconText.anchor.set(0.5)
    iconText.x = cardW / 2
    iconText.y = 86
    con.addChild(iconText)

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
    name.y = 150
    con.addChild(name)

    const tags = new Text({
      text: `${skillTierLabelCn(choice.tier)} · ${skillArchetypeLabelCn(choice.archetype)}`,
      style: { fontSize: 20, fill: 0xbecde8, fontFamily: 'Arial' },
    })
    tags.anchor.set(0.5, 0)
    tags.x = cardW / 2
    tags.y = 204
    con.addChild(tags)

    const desc = new Text({
      text: choice.desc,
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
    desc.y = 252
    con.addChild(desc)

    const hint = new Text({
      text: '点击选择',
      style: { fontSize: 22, fill: 0x8fd5ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    hint.anchor.set(0.5)
    hint.x = cardW / 2
    hint.y = cardH - 42
    con.addChild(hint)

    con.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      pickedSkills = [...pickedSkills, choice]
      draftedSkillDays = Array.from(new Set([...draftedSkillDays, draft!.day])).sort((a, b) => a - b)
      pendingSkillDraft = null
      closeSkillDraftOverlay()
      refreshSkillIconBar()
      setTransitionInputEnabled(true)
      applyPhaseInputLock()
      refreshShopUI()
      saveShopStateToStorage(captureShopState())
    })

    overlay.addChild(con)
  })

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
    const lives = getLifeState()
    livesText.text = `❤️ ${lives.current}/${lives.max}`
    livesText.style.fill = lives.current <= 1 ? 0xff6a6a : 0xffd4d4
    livesText.x = CANVAS_W - livesText.width - 18
    livesText.y = 18
  }
  if (trophyText) {
    const target = getConfig().runRules?.trophyWinsToFinalVictory ?? 10
    const trophy = getWinTrophyState(target)
    trophyText.text = `🏆 ${trophy.wins}/${trophy.target}`
    trophyText.style.fill = trophy.wins >= trophy.target ? 0xffde79 : 0xffe8b4
    trophyText.x = CANVAS_W - trophyText.width - 18
    trophyText.y = (livesText?.y ?? 18) + (livesText?.height ?? 0) + 6
  }
  if (refreshCostText) {
    refreshCostText.text = `💰 ${shopManager.gold}/${getQuickBuyPricePreviewLabel()}`
    refreshCostText.x    = getDebugCfg('refreshBtnX') - refreshCostText.width / 2
    refreshCostText.style.fill = shopManager.gold >= getQuickBuyMinPrice() ? 0xffd700 : 0xff4444
  }
  if (refreshBtnHandle) {
    refreshBtnHandle.setSubLabel(`💰 ${shopManager.gold}/${getQuickBuyPricePreviewLabel()}`)
    const sub = refreshBtnHandle.container.getChildByName('sell-price') as Text | null
    if (sub) sub.style.fill = shopManager.gold >= getQuickBuyMinPrice() ? 0xffd700 : 0xff6666
  }
  updateMiniMap()
  refreshUpgradeHints()
  refreshBattlePassiveStatBadges(true)
  layoutSkillIconBar()
  saveShopStateToStorage(captureShopState())
}

type PoolCandidate = {
  item: ItemDef
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7
  tier: TierKey
  star: 1 | 2
  price: number
}

function levelToTierStar(level: number): { tier: TierKey; star: 1 | 2 } | null {
  if (level === 1) return { tier: 'Bronze', star: 1 }
  if (level === 2) return { tier: 'Bronze', star: 2 }
  if (level === 3) return { tier: 'Silver', star: 1 }
  if (level === 4) return { tier: 'Silver', star: 2 }
  if (level === 5) return { tier: 'Gold', star: 1 }
  if (level === 6) return { tier: 'Gold', star: 2 }
  if (level === 7) return { tier: 'Diamond', star: 1 }
  return null
}

function getAllowedLevelsByStartingTier(tier: TierKey): Array<1 | 2 | 3 | 4 | 5 | 6 | 7> {
  if (tier === 'Bronze') return [1, 2]
  if (tier === 'Silver') return [3, 4]
  if (tier === 'Gold') return [5, 6]
  return [7]
}

function getUnlockPoolBuyPriceByTier(tier: TierKey): number {
  const key = `${tier}#1`
  const raw = getConfig().shopRules?.quickBuyFixedPrice?.[key]
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.max(1, Math.round(raw))
  }
  if (tier === 'Bronze') return 3
  if (tier === 'Silver') return 12
  if (tier === 'Gold') return 48
  return 192
}

function collectPoolCandidatesByLevel(level: 1 | 2 | 3 | 4 | 5 | 6 | 7): PoolCandidate[] {
  if (!shopManager || !battleSystem || !backpackSystem) return []
  const tierStar = levelToTierStar(level)
  if (!tierStar) return []
  const allById = new Map(getAllItems().map((it) => [it.id, it] as const))
  const out: PoolCandidate[] = []
  for (const defId of unlockedItemIds) {
    const item = allById.get(defId)
    if (!item) continue
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
      price: getUnlockPoolBuyPriceByTier(tierStar.tier),
    })
  }
  return out
}

function findCandidateByOffer(offer: { itemId: string; tier: TierKey; star: 1 | 2; price: number } | null): PoolCandidate | null {
  if (!offer) return null
  const level = tierStarLevelIndex(offer.tier, offer.star) + 1
  if (level < 1 || level > 7) return null
  const levelKey = level as 1 | 2 | 3 | 4 | 5 | 6 | 7
  const item = getItemDefById(offer.itemId)
  if (!item) return null
  const size = normalizeSize(item.size)
  if (!findFirstBattlePlace(size) && !findFirstBackpackPlace(size)) return null
  if (!unlockedItemIds.has(offer.itemId)) return null
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

function rollNextQuickBuyOffer(force = false): PoolCandidate | null {
  if (!force) {
    const keep = findCandidateByOffer(nextQuickBuyOffer)
    if (keep) return keep
  }
  const byLevel = {
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

  let levelRoll = Math.random() * totalWeight
  let pickedLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7 = 1
  for (let i = 0; i < effectiveWeights.length; i++) {
    levelRoll -= effectiveWeights[i] ?? 0
    if (levelRoll <= 0) {
      pickedLevel = (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7
      break
    }
  }

  const levelCandidates = byLevel[pickedLevel]
  if (levelCandidates.length <= 0) {
    nextQuickBuyOffer = null
    return null
  }
  const picked = levelCandidates[Math.floor(Math.random() * levelCandidates.length)] ?? null
  if (!picked) {
    nextQuickBuyOffer = null
    return null
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
  return Math.max(1, Math.round(offer.price))
}

function getQuickBuyPricePreviewLabel(): string {
  const offer = rollNextQuickBuyOffer(false)
  if (!offer) return '-'
  return `${Math.max(1, Math.round(offer.price))}`
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

  const item = picked.item
  const tier = picked.tier
  const star = picked.star
  const buyPrice = picked.price

  if (!canBuyItemUnderFirstPurchaseRule(item)) {
    showFirstPurchaseRuleHint()
    refreshShopUI()
    return
  }

  const size = normalizeSize(item.size)
  const battleSlot = findFirstBattlePlace(size)
  const backpackSlot = battleSlot ? null : findFirstBackpackPlace(size)
  if (!battleSlot && !backpackSlot) {
    showHintToast('backpack_full_buy', '格子不够，无法购买', 0xff8f8f)
    refreshShopUI()
    return
  }

  if (manager.gold < buyPrice) {
    showHintToast('no_gold_buy', `金币不足，需${buyPrice}G`, 0xff8f8f)
    refreshShopUI()
    return
  }

  manager.gold -= buyPrice
  markShopPurchaseDone()
  const id = nextId()
  const visualTier = toVisualTier(tier, star)
  if (battleSlot) {
    battleSystem.place(battleSlot.col, battleSlot.row, size, item.id, id)
    void battleView.addItem(id, item.id, size, battleSlot.col, battleSlot.row, visualTier).then(() => {
      battleView!.setItemTier(id, visualTier)
      drag?.refreshZone(battleView!)
    })
    console.log(`[ShopScene] 购买(${tier}#${star})→战斗区 ${item.name_cn} -${buyPrice}G，金币: ${manager.gold}`)
  } else if (backpackSlot) {
    backpackSystem.place(backpackSlot.col, backpackSlot.row, size, item.id, id)
    void backpackView.addItem(id, item.id, size, backpackSlot.col, backpackSlot.row, visualTier).then(() => {
      backpackView!.setItemTier(id, visualTier)
      drag?.refreshZone(backpackView!)
    })
    console.log(`[ShopScene] 购买(${tier}#${star})→背包 ${item.name_cn} -${buyPrice}G，金币: ${manager.gold}`)
  }
  instanceToDefId.set(id, item.id)
  instanceToTier.set(id, tier)
  instanceToTierStar.set(id, star)
  instanceToPermanentDamageBonus.set(id, 0)
  unlockItemToPool(item.id)
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

function setDay(day: number): void {
  const prevDay = currentDay
  currentDay = Math.max(1, Math.min(20, day))
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
      shopManager.gold += getDailyGoldForDay(getConfig(), currentDay)
    }
  }
  refreshShopUI()

  // 4. 更新 Debug 天数文字
  if (dayDebugText) {
    dayDebugText.text = `Day ${currentDay}`
    layoutDayDebugControls()
  }
  ensureSkillDraftSelection(getApp().stage)
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
  if (!isShopInputEnabled()) {
    if (sellBtnHandle) {
      sellBtnHandle.container.visible = false
      sellBtnHandle.setSubLabel('')
    }
    if (refreshBtnHandle) refreshBtnHandle.container.visible = false
    if (refreshCostText) refreshCostText.visible = false
    return
  }

  const showSell = currentSelection.kind === 'battle' || currentSelection.kind === 'backpack'
  if (sellBtnHandle) {
    sellBtnHandle.container.visible = true
    sellBtnHandle.redraw(showSell)
    if (!showSell) sellBtnHandle.setSubLabel('')
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
  sellBtnHandle.setSubLabel(`💰 ${price}G`)
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
  gridDragSellPrice = sellPrice
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
      gridDragSellZoneText.text = `拖动到此处出售\n💰 ${gridDragSellPrice}G`
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
  gridDragSellPrice = 0
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
  if (!slot || slot.purchased || !shopManager.canBuy(slot)) return

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
  sellPopup?.show(slot.item, slot.price, 'buy', slot.tier)
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
    sellPopup.show(dragSlot.item, dragSlot.price, 'buy', toVisualTier(dragSlot.tier, 1), undefined, 'simple')
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
    const isCrossId = !!targetItem && targetItem.defId !== slot.item.id
    if (isCrossId) {
      const targetDef = targetItem ? getItemDefById(targetItem.defId) : null
      if (!targetItem || !targetDef) {
        _resetDrag()
        return
      }
      const targetTier = getInstanceTier(synthTarget.instanceId) ?? slot.tier
      const targetStar = getInstanceTierStar(synthTarget.instanceId)
      const upgradeTo = nextTierLevel(slot.tier, 1)
      if (!upgradeTo) {
        _resetDrag()
        return
      }
      const runCrossSynthesis = () => {
        if (!shopManager?.buy(slot)) {
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
        console.log(`[ShopScene] 合成升级 ${slot.item.name_cn} ${tierStarLabelCn(slot.tier, 1)} -> ${tierStarLabelCn(synth.toTier, synth.toStar)}`)
        refreshShopUI()
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

    if (!shopManager.buy(slot)) {
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
    console.log(`[ShopScene] 合成升级 ${slot.item.name_cn} ${tierStarLabelCn(slot.tier, 1)} -> ${tierStarLabelCn(synth.toTier, synth.toStar)}`)
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
    if (shopManager.buy(slot)) {
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
      instanceToTier.set(id, slot.tier)
      instanceToTierStar.set(id, 1)
      instanceToPermanentDamageBonus.set(id, 0)
      unlockItemToPool(slot.item.id)
      console.log(`[ShopScene] 购买→战斗区 ${slot.item.name_cn}，金币: ${shopManager.gold}`)
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
      console.log('[ShopScene] 背包已满')
      showHintToast('backpack_full_buy', '背包已满，无法购买', 0xff8f8f)
      _resetDrag(); return
    }

    if (!shopManager.buy(slot)) {
      console.log('[ShopScene] 金币不足')
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
    instanceToTier.set(id, slot.tier)
    instanceToTierStar.set(id, 1)
    instanceToPermanentDamageBonus.set(id, 0)
    unlockItemToPool(slot.item.id)
    console.log(`[ShopScene] 购买→背包 ${slot.item.name_cn}，金币: ${shopManager.gold}`)

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
      const sellPrice = shopManager.getSellPrice(item, tier, star)
      // 拖拽中视为选中：显示物品详情（不设置区域高亮，因物品已脱离格子）
      const inBattle = !!battleView?.hasItem(instanceId)
      currentSelection = { kind: inBattle ? 'battle' : 'backpack', instanceId }
      selectedSellAction = null  // 拖拽中暂不执行出售
      sellPopup.show(item, sellPrice, 'sell', toVisualTier(tier, star), undefined, 'simple')
      setSellButtonPrice(sellPrice)
      applySellButtonState()

      // 按钮闪烁提示：可出售则闪出售；战斗区->背包（背包未打开且有空位）则闪背包按钮
      const canSell = true
      const canToBackpack = inBattle && !showingBackpack
        && canBackpackAcceptByAutoPack(item.id, normalizeSize(item.size))
      startGridDragButtonFlash(stage, canSell, canToBackpack, sellPrice)
    }
    drag.onSpecialDrop = ({ instanceId, anchorGx, anchorGy, size, originCol, originRow, homeSystem, homeView, defId }) => {
      if (!shopManager) return false
      const item = getAllItems().find(i => i.id === defId)
      if (!item) return false

      // 1) 拖到下方出售区域：直接出售（若命中任意格子候选，优先走落位/换位）
      if (isOverGridDragSellArea(anchorGx, anchorGy) && !isOverAnyGridDropTarget(anchorGx, anchorGy, size)) {
        homeSystem.remove(instanceId)
        const tier = getInstanceTier(instanceId)
        const star = getInstanceTierStar(instanceId)
        removeInstanceMeta(instanceId)
        const gained = shopManager.sellItem(item, tier, star)
        console.log(`[ShopScene] 拖拽出售 ${item.name_cn} +${gained}G，金币: ${shopManager.gold}`)
        refreshShopUI()
        return true
      }

      // 1.5) 拖到同装备同品质目标物品：执行合成（优先于挤出/普通落位）
      const fromTier = getInstanceTier(instanceId) ?? 'Bronze'
      const fromStar = getInstanceTierStar(instanceId)
      if (fromTier !== 'Diamond') {
        const synthTarget = findSynthesisTargetWithDragProbe(defId, fromTier, fromStar, anchorGx, anchorGy, size)
        if (synthTarget) {
          const targetItem = getSynthesisTargetItem(synthTarget)
          if (targetItem && targetItem.defId !== defId) {
            const targetDef = getItemDefById(targetItem.defId)
            if (!targetDef) return false
            const targetTier = getInstanceTier(synthTarget.instanceId) ?? fromTier
            const targetStar = getInstanceTierStar(synthTarget.instanceId)
            const upgradeTo = nextTierLevel(fromTier, fromStar)
            if (!upgradeTo) return false
            const runCrossSynthesis = () => {
              const synth = synthesizeTarget(defId, fromTier, fromStar, synthTarget.instanceId, synthTarget.zone)
              if (!synth) {
                showHintToast('backpack_full_buy', '合成目标无效', 0xff8f8f)
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
              removeInstanceMeta(instanceId)
              console.log(`[ShopScene] 拖拽合成 ${item.name_cn} ${tierStarLabelCn(fromTier, fromStar)} -> ${tierStarLabelCn(synth.toTier, synth.toStar)}`)
              playSynthesisFlashEffect(stage, synth)
              refreshShopUI()
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
                },
              )
            } else {
              runCrossSynthesis()
            }
            return true
          }

          const synth = synthesizeTarget(defId, fromTier, fromStar, synthTarget.instanceId, synthTarget.zone)
          if (synth) {
            removeInstanceMeta(instanceId)
            console.log(`[ShopScene] 拖拽合成 ${item.name_cn} ${tierStarLabelCn(fromTier, fromStar)} -> ${tierStarLabelCn(synth.toTier, synth.toStar)}`)
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
        console.log(`[ShopScene] 拖拽转移→背包 ${item.name_cn}`)
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
      const sellPrice = (item && tier && shopManager) ? shopManager.getSellPrice(item, tier, star) : 0
      const overSell = gridDragCanSell && gridDragSellHot
      if (item && sellPopup && tier && overSell) {
        const customDisplay: ItemInfoCustomDisplay = {
          overrideName: `${item.name_cn}（拖拽出售）`,
          lines: [`以 ${sellPrice}G 价格出售`],
          suppressStats: true,
        }
        sellPopup.show(item, sellPrice, 'sell', toVisualTier(tier, star), undefined, 'detailed', undefined, customDisplay)
        drag?.setSqueezeSuppressed(false)
        hideSynthesisHoverInfo()
        return
      }

      if (!defId || !tier || tier === 'Diamond') {
        drag?.setSqueezeSuppressed(false)
        if (item && sellPopup) {
          sellPopup.show(item, sellPrice, 'sell', toVisualTier(tier, star), undefined, 'simple')
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
          sellPopup.show(item, sellPrice, 'sell', toVisualTier(tier, star), undefined, 'simple')
        }
      }
    }
    drag.onDragEnd = () => {
      drag?.setSqueezeSuppressed(false)
      hideSynthesisHoverInfo()
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

    // 出售按钮（右）
    const sellBtn = makeCircleBtn(getDebugCfg('sellBtnX'), getDebugCfg('sellBtnY'), '出售', 0xcc3333, 0xcc3333)
    sellBtn.container.on('pointerdown', () => {
      if (!isShopInputEnabled()) return
      if (!selectedSellAction) return
      selectedSellAction()
      clearSelection()
      refreshShopUI()
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
      clearBattleOutcome()
      const snapshot = buildBattleSnapshot()
      if (snapshot) {
        setBattleSnapshot(snapshot)
        console.log(`[ShopScene] 战斗快照已生成 day=${snapshot.day} entities=${snapshot.entities.length} cols=${snapshot.activeColCount}`)
      }
      pendingBattleTransition = true
      pendingAdvanceToNextDay = true
      beginBattleStartTransition()
    })
    phaseBtnHandle = phaseBtn
    btnRow.addChild(phaseBtn.container)

    miniMapGfx = null
    miniMapCon = null

    stage.addChild(btnRow)
    ensureBottomHudVisibleAndOnTop(stage)

    // 出售弹窗
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

      const manager = shopManager
      hideSkillDetailPopup()
      if (kind === 'battle') refreshBattlePassiveStatBadges(false)
      const tier = getInstanceTier(instanceId)
      const star = getInstanceTierStar(instanceId)
      const sellPrice = manager.getSellPrice(item, tier, star)
      const infoMode = resolveInfoMode(`${kind}:${instanceId}:${tier}:${star}`)
      sellPopup.show(item, sellPrice, 'sell', toVisualTier(tier, star), undefined, infoMode)

      selectedSellAction = () => {
        system.remove(instanceId)
        view.removeItem(instanceId)
        removeInstanceMeta(instanceId)
        manager.sellItem(item, tier, star)
        drag?.refreshZone(view)
        console.log(`[ShopScene] 出售 ${item.name_cn} +${sellPrice}G，金币: ${manager.gold}`)
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
      sellPopup.show(slot.item, slot.price, 'buy', toVisualTier(slot.tier, 1), undefined, infoMode)
      applySellButtonState()
    }

    backpackView.onTap = (id) => {
      if (!isShopInputEnabled()) return
      selectGridItem(id, backpackSystem!, backpackView!, 'backpack')
    }
    battleView.onTap   = (id) => {
      if (!isShopInputEnabled()) return
      selectGridItem(id, battleSystem!, battleView!, 'battle')
    }
    shopPanel.onTap    = (slotIndex) => handleShopSlotTap(slotIndex)

    sellPopup = new SellPopup(CANVAS_W, CANVAS_H)
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
        const snapshot = buildBattleSnapshot()
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
      if (pendingAdvanceToNextDay) {
        setDay(currentDay + 1)
        applyPostBattleEffects(battleOutcome?.snapshot ?? null)
        pendingAdvanceToNextDay = false
      }
    } else {
      pendingAdvanceToNextDay = false
      starterClass = null
      starterGranted = false
      starterBattleGuideShown = false
      hasBoughtOnce = false
      pickedSkills = []
      draftedSkillDays = []
      pendingSkillDraft = null
      unlockedItemIds.clear()
      guaranteedNewUnlockTriggeredLevels.clear()
      CROSS_SYNTH_MIN_TIER_CYCLE_CURSOR.clear()
      CROSS_SYNTH_MIN_TIER_CYCLE_BAG.clear()
      nextQuickBuyOffer = null
      syncUnlockPoolToManager()
    }
    refreshSkillIconBar()
    refreshShopUI()
    applyPhaseInputLock()
    ensureStarterClassSelection(stage)
    ensureSkillDraftSelection(stage)
  },

  onExit() {
    console.log('[ShopScene] 离开商店场景')
    const { stage } = getApp()

    teardownCrossSynthesisConfirmOverlay()
    stopFlashEffect()
    stopGridDragButtonFlash()
    stopUnlockRevealPlayback(true)

    if (shopDragFloater) {
      stage.removeChild(shopDragFloater)
      shopDragFloater.destroy({ children: true })
      shopDragFloater = null
    }
    _resetDrag()

    if (shopPanel)    stage.removeChild(shopPanel)
    if (sellPopup)    stage.removeChild(sellPopup)
    if (battleView)   stage.removeChild(battleView)
    if (backpackView) stage.removeChild(backpackView)
    if (battleZoneTitleText) stage.removeChild(battleZoneTitleText)
    if (backpackZoneTitleText) stage.removeChild(backpackZoneTitleText)
    if (shopAreaBg)   stage.removeChild(shopAreaBg)
    if (backpackAreaBg) stage.removeChild(backpackAreaBg)
    if (battleAreaBg) stage.removeChild(battleAreaBg)
    if (restartBtn)   stage.removeChild(restartBtn)
    if (livesText)    stage.removeChild(livesText)
    if (trophyText)   stage.removeChild(trophyText)
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
    if (pendingBattleTransition) {
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
    unlockRevealLayer = null
    unlockRevealQueue = []
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
    guaranteedNewUnlockTriggeredLevels.clear()
    CROSS_SYNTH_MIN_TIER_CYCLE_CURSOR.clear()
    CROSS_SYNTH_MIN_TIER_CYCLE_BAG.clear()
    nextQuickBuyOffer = null
    starterClass    = null
    starterGranted  = false
    starterBattleGuideShown = false
    hasBoughtOnce = false
    pickedSkills    = []
    draftedSkillDays = []
    pendingSkillDraft = null
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
  },
}
