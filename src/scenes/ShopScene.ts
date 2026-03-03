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
import { GridSystem }        from '@/grid/GridSystem'
import type { ItemSizeNorm, PlacedItem } from '@/grid/GridSystem'
import { GridZone, CELL_SIZE, CELL_HEIGHT } from '@/grid/GridZone'
import { DragController }    from '@/grid/DragController'
import { planAutoPack, type PackItem, type PackPlacement } from '@/grid/AutoPack'
import { planUnifiedSqueeze } from '@/grid/SqueezeLogic'
import { normalizeSize }     from '@/items/ItemDef'
import { resolveItemTierBaseStats } from '@/items/itemTierStats'
import { ShopManager, type ShopSlot, type TierKey } from '@/shop/ShopManager'
import { ShopPanelView }     from '@/shop/ShopPanelView'
import { SellPopup, type ItemInfoMode } from '@/shop/SellPopup'
import { getConfig as getDebugCfg, onConfigChange as onDebugCfgChange } from '@/config/debugConfig'
import { getItemIconUrl } from '@/core/assetPath'
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

// ---- 背包小地图 ----
const MINI_CELL = 20
const MINI_W    = 6 * MINI_CELL
const SHOP_QUICK_BUY_PRICE = 3
const BACKPACK_GAP_FROM_BATTLE = 28
const SHOP_STATE_STORAGE_KEY = 'bigbazzar_shop_state_v1'
const SHOP_STATE_STORAGE_VERSION = 1

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
let miniMapGfx:     Graphics  | null = null
let miniMapCon:     Container | null = null
let bpBtnHandle:      CircleBtnHandle | null = null
let refreshBtnHandle: CircleBtnHandle | null = null
let sellBtnHandle:    CircleBtnHandle | null = null
let phaseBtnHandle:   CircleBtnHandle | null = null
let refreshCostText:  Text            | null = null
let hintToastCon:     Container       | null = null
let hintToastBg:      Graphics        | null = null
let hintToastText:    Text            | null = null
let hintToastHideTimer: ReturnType<typeof setTimeout> | null = null

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
}

let pendingBattleTransition = false
let pendingAdvanceToNextDay = false
let savedShopState: SavedShopState | null = null

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

function clearShopStateFromStorage(): void {
  try {
    localStorage.removeItem(SHOP_STATE_STORAGE_KEY)
  } catch (err) {
    console.warn('[ShopScene] 清理商店状态失败', err)
  }
}

function restartRunFromBeginning(): void {
  clearShopStateFromStorage()
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

  if (bpBtnHandle) bpBtnHandle.container.visible = false
  if (refreshBtnHandle) refreshBtnHandle.container.visible = inShop
  if (sellBtnHandle) sellBtnHandle.container.visible = inShop
  if (phaseBtnHandle) phaseBtnHandle.container.visible = true

  if (refreshCostText) refreshCostText.visible = inShop
  if (goldText) goldText.visible = inShop
  if (miniMapCon) miniMapCon.visible = inShop
  if (dayDebugCon) dayDebugCon.visible = inShop
  if (sellPopup) sellPopup.visible = inShop && currentSelection.kind !== 'none'
  if (hintToastCon && !inShop) hintToastCon.visible = false

  if (!inShop) {
    stopGridDragButtonFlash()
    stopFlashEffect()
    battleView?.clearHighlight()
    backpackView?.clearHighlight()
  }

  updatePhaseToggleButton()
}

function applyPhaseInputLock(): void {
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
  }
}

function applySavedShopState(state: SavedShopState): void {
  if (!shopManager || !battleSystem || !backpackSystem || !battleView || !backpackView) return
  const all = getAllItems()
  const byId = new Map(all.map((it) => [it.id, it] as const))

  currentDay = state.day
  shopManager.day = state.day
  shopManager.gold = state.gold
  shopManager.refreshIndex = state.refreshIndex
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

const SYNTH_HIGHLIGHT_COLOR = 0xffcc44

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

function compareTier(a: TierKey, b: TierKey): number {
  return TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b)
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
  const parts = series.split('/').map((v) => v.trim()).filter(Boolean)
  if (parts.length === 0) return 0
  const tiers = parseAvailableTiers(availableTiersRaw)
  const tierIdx = Math.max(0, tiers.indexOf(tier))
  const idx = Math.max(0, Math.min(parts.length - 1, tierIdx))
  const n = Number(parts[idx])
  return Number.isFinite(n) ? n : 0
}

function tierValueFromSkillLine(item: ReturnType<typeof getAllItems>[number], tier: TierKey, line: string): number {
  const m = line.match(/(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)+)/)
  if (!m?.[1]) return 0
  return pickTierSeriesValueByTier(m[1], tier, item.available_tiers)
}

function tierValueFromSkillLineByStar(item: ReturnType<typeof getAllItems>[number], tier: TierKey, star: 1 | 2, line: string): number {
  const m = line.match(/(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)+)/)
  if (!m?.[1]) return 0
  const parts = m[1].split('/').map((v) => v.trim()).filter(Boolean)
  if (parts.length === 0) return 0
  const tiers = parseAvailableTiers(item.available_tiers)
  const base = Math.max(0, tiers.indexOf(tier))
  const idx = Math.max(0, Math.min(parts.length - 1, base + (star - 1)))
  const n = Number(parts[idx])
  return Number.isFinite(n) ? n : 0
}

function ammoValueFromLineByStar(item: ReturnType<typeof getAllItems>[number], tier: TierKey, star: 1 | 2, line: string): number {
  const m = line.match(/弹药\s*[:：]\s*(\d+(?:\/\d+)*)/)
  if (!m?.[1]) return 0
  const parts = m[1].split('/').map((v) => v.trim()).filter(Boolean)
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

  const ownedByKey = new Map<string, { inBattle: string[]; inBackpack: string[] }>()
  for (const it of battleSystem.getAllItems()) {
    const tier = instanceToTier.get(it.instanceId) ?? 'Bronze'
    const key = `${it.defId}:${tier}`
    const obj = ownedByKey.get(key) ?? { inBattle: [], inBackpack: [] }
    obj.inBattle.push(it.instanceId)
    ownedByKey.set(key, obj)
  }
  for (const it of backpackSystem.getAllItems()) {
    const tier = instanceToTier.get(it.instanceId) ?? 'Bronze'
    const key = `${it.defId}:${tier}`
    const obj = ownedByKey.get(key) ?? { inBattle: [], inBackpack: [] }
    obj.inBackpack.push(it.instanceId)
    ownedByKey.set(key, obj)
  }

  for (let i = 0; i < shopManager.pool.length; i++) {
    const slot = shopManager.pool[i]
    if (!slot || slot.purchased || slot.tier === 'Diamond') continue
    const match = ownedByKey.get(`${slot.item.id}:${slot.tier}`)
    if (!match) continue
    shopSlots.push(i)
    battleIds.push(...match.inBattle)
    backpackIds.push(...match.inBackpack)
    if (match.inBackpack.length > 0) hasBackpackMatch = true
  }

  return {
    shopSlots,
    battleIds: Array.from(new Set(battleIds)),
    backpackIds: Array.from(new Set(backpackIds)),
    hasBackpackMatch,
  }
}

function refreshUpgradeHints(): void {
  void computeUpgradeMatch()
  shopPanel?.setUpgradeHints([])
  battleView?.setUpgradeHints([])
  backpackView?.setUpgradeHints([])
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
      if (it.defId !== defId) continue
      if ((instanceToTier.get(it.instanceId) ?? 'Bronze') !== tier) continue
      if (getInstanceTierStar(it.instanceId) !== star) continue
      if (isPointInItemBounds(battleView, it, gx, gy)) {
        return { instanceId: it.instanceId, zone: 'battle' }
      }
    }
  }

  if (backpackView && backpackView.visible && backpackSystem) {
    for (const it of backpackSystem.getAllItems()) {
      if (it.defId !== defId) continue
      if ((instanceToTier.get(it.instanceId) ?? 'Bronze') !== tier) continue
      if (getInstanceTierStar(it.instanceId) !== star) continue
      if (isPointInItemBounds(backpackView, it, gx, gy)) {
        return { instanceId: it.instanceId, zone: 'backpack' }
      }
    }
  }

  return null
}

function findSynthesisTargetWithDragProbe(
  defId: string,
  tier: TierKey,
  star: 1 | 2,
  gx: number,
  gy: number,
  dragSize?: ItemSizeNorm,
): SynthesisTarget | null {
  const probeY = gy + (dragSize ? getDebugCfg('dragYOffset') : 0)
  return findSynthesisTargetAtPointer(defId, tier, star, gx, probeY, dragSize)
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
  if (targetItem.defId !== defId) return null
  if ((instanceToTier.get(targetInstanceId) ?? 'Bronze') !== tier) return null
  if (getInstanceTierStar(targetInstanceId) !== star) return null

  const evolveCandidates = getAllItems().filter((it) =>
    normalizeSize(it.size) === targetItem.size
    && parseAvailableTiers(it.available_tiers).includes(upgradeTo.tier),
  )
  const evolvedDef = evolveCandidates[Math.floor(Math.random() * evolveCandidates.length)]
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
  if (refreshCostText) {
    refreshCostText.text = `💰 ${shopManager.gold}/${SHOP_QUICK_BUY_PRICE}`
    refreshCostText.x    = getDebugCfg('refreshBtnX') - refreshCostText.width / 2
    refreshCostText.style.fill = shopManager.gold >= SHOP_QUICK_BUY_PRICE ? 0xffd700 : 0xff4444
  }
  if (refreshBtnHandle) {
    refreshBtnHandle.setSubLabel(`💰 ${shopManager.gold}/${SHOP_QUICK_BUY_PRICE}`)
    const sub = refreshBtnHandle.container.getChildByName('sell-price') as Text | null
    if (sub) sub.style.fill = shopManager.gold >= SHOP_QUICK_BUY_PRICE ? 0xffd700 : 0xff6666
  }
  updateMiniMap()
  refreshUpgradeHints()
  refreshBattlePassiveStatBadges(true)
  saveShopStateToStorage(captureShopState())
}

function buyRandomBronzeToBoardOrBackpack(): void {
  if (!shopManager || !battleSystem || !battleView || !backpackSystem || !backpackView) return
  if (shopManager.gold < SHOP_QUICK_BUY_PRICE) {
    showHintToast('no_gold_buy', '金币不足，无法购买', 0xff8f8f)
    refreshShopUI()
    return
  }

  const candidates = getAllItems().filter((it) => parseAvailableTiers(it.available_tiers).includes('Bronze'))
  if (candidates.length === 0) {
    refreshShopUI()
    return
  }

  const placeableCandidates = candidates.filter((it) => {
    const size = normalizeSize(it.size)
    return !!findFirstBattlePlace(size) || !!findFirstBackpackPlace(size)
  })
  if (placeableCandidates.length === 0) {
    showHintToast('backpack_full_buy', '格子不够，无法购买', 0xff8f8f)
    refreshShopUI()
    return
  }

  const item = placeableCandidates[Math.floor(Math.random() * placeableCandidates.length)]
  if (!item) {
    refreshShopUI()
    return
  }

  const size = normalizeSize(item.size)
  const battleSlot = findFirstBattlePlace(size)
  const backpackSlot = battleSlot ? null : findFirstBackpackPlace(size)
  if (!battleSlot && !backpackSlot) {
    showHintToast('backpack_full_buy', '战斗区与背包已满，无法购买', 0xff8f8f)
    refreshShopUI()
    return
  }

  shopManager.gold -= SHOP_QUICK_BUY_PRICE
  const id = nextId()
  if (battleSlot) {
    battleSystem.place(battleSlot.col, battleSlot.row, size, item.id, id)
    void battleView.addItem(id, item.id, size, battleSlot.col, battleSlot.row, 'Bronze').then(() => {
      battleView!.setItemTier(id, toVisualTier('Bronze', 1))
      drag?.refreshZone(battleView!)
    })
    console.log(`[ShopScene] 购买随机青铜→战斗区 ${item.name_cn}，金币: ${shopManager.gold}`)
  } else if (backpackSlot) {
    backpackSystem.place(backpackSlot.col, backpackSlot.row, size, item.id, id)
    void backpackView.addItem(id, item.id, size, backpackSlot.col, backpackSlot.row, 'Bronze').then(() => {
      backpackView!.setItemTier(id, toVisualTier('Bronze', 1))
      drag?.refreshZone(backpackView!)
    })
    console.log(`[ShopScene] 购买随机青铜→背包 ${item.name_cn}，金币: ${shopManager.gold}`)
  }
  instanceToDefId.set(id, item.id)
  instanceToTier.set(id, 'Bronze')
  instanceToTierStar.set(id, 1)
  instanceToPermanentDamageBonus.set(id, 0)
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
        if (t >= 1) { Ticker.shared.remove(expandTickFn!); expandTickFn = null }
      }
      Ticker.shared.add(expandTickFn)
    } else {
      battleView.x = toX
      applyAreaLabelLeftAlign()
    }
  }

  // 3. 同步 ShopManager 天数并刷新商店卡池
  if (shopManager) {
    syncShopOwnedTierRules()
    shopManager.setDay(currentDay)
    // Debug 改天数：每次实际变更天数都发放一次当日金币
    if (currentDay !== prevDay) {
      shopManager.gold += getConfig().dailyGold
    }
  }
  refreshShopUI()

  // 4. 更新 Debug 天数文字
  if (dayDebugText) {
    dayDebugText.text = `Day ${currentDay}`
    layoutDayDebugControls()
  }
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
  const panelBottomY = getDebugCfg('shopAreaY') - getDebugCfg('itemInfoBottomGapToShop')
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
  battleView?.setStatBadgeFontSize(getDebugCfg('itemStatBadgeFontSize'))
  backpackView?.setStatBadgeFontSize(getDebugCfg('itemStatBadgeFontSize'))
  battleView?.setTierStarFontSize(getDebugCfg('itemTierStarFontSize'))
  backpackView?.setTierStarFontSize(getDebugCfg('itemTierStarFontSize'))
  battleView?.setTierStarStrokeWidth(getDebugCfg('itemTierStarStrokeWidth'))
  backpackView?.setTierStarStrokeWidth(getDebugCfg('itemTierStarStrokeWidth'))
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
  if (miniMapCon) {
    miniMapCon.x = getDebugCfg('backpackBtnX') - MINI_W / 2
    miniMapCon.y = getDebugCfg('backpackBtnY') + BTN_RADIUS + 8
  }

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
  const iconH = CELL_SIZE * 2

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
  const iconH   = CELL_SIZE * 2
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
    return
  }

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

  if (!slot || !shopManager || !shopDragSize) { _resetDrag(); return }

  const gx = e.globalX, gy = e.globalY
  const size = shopDragSize
  let synthTarget = findSynthesisTargetWithDragProbe(slot.item.id, slot.tier, 1, gx, gy, size)
  const battleCell = battleView?.pixelToCellForItem(gx, gy, size, 0)
  const bpCell = backpackView?.visible ? backpackView.pixelToCellForItem(gx, gy, size, 0) : null
  const overBattleArea = isPointInZoneArea(battleView, gx, gy)
  const onBpBtn = _isOverBpBtn(gx, gy)

  if (synthTarget) {
    if (!shopManager.buy(slot)) {
      showHintToast('no_gold_buy', '金币不足，无法购买', 0xff8f8f)
      _resetDrag(); return
    }
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

    // 商店面板
    shopPanel = new ShopPanelView()
    shopPanel.x = getDebugCfg('shopAreaX')
    shopPanel.y = getDebugCfg('shopAreaY')
    shopPanel.onDragStart = (slotIndex, e) => startShopDrag(slotIndex, e, stage)
    shopPanel.visible = false
    stage.addChild(shopPanel)

    // 格子系统
    const activeCols = cfg.dailyBattleSlots[0] ?? 4
    battleSystem   = new GridSystem(6)
    backpackSystem = new GridSystem(6, 2)
    battleView     = new GridZone('战斗区', 6, activeCols, 1)
    backpackView   = new GridZone('背包', 6, 6, 2)
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
      const sellPrice = shopManager.getSellPrice(item, tier)
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
    drag.onSpecialDrop = ({ instanceId, anchorGx, anchorGy, size, homeSystem, homeView, defId }) => {
      if (!shopManager) return false
      const item = getAllItems().find(i => i.id === defId)
      if (!item) return false

      // 1) 拖到下方出售区域：直接出售（若命中任意格子候选，优先走落位/换位）
      if (isOverGridDragSellArea(anchorGx, anchorGy) && !isOverAnyGridDropTarget(anchorGx, anchorGy, size)) {
        homeSystem.remove(instanceId)
        const tier = getInstanceTier(instanceId)
        removeInstanceMeta(instanceId)
        const gained = shopManager.sellItem(item, tier)
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
      if (!defId || !tier || tier === 'Diamond') {
        drag?.setSqueezeSuppressed(false)
        return
      }

      const synthTarget = findSynthesisTargetWithDragProbe(defId, tier, star, anchorGx, anchorGy, size)
      if (synthTarget) {
        drag?.setSqueezeSuppressed(true, true)
        highlightSynthesisTarget(synthTarget)
      } else {
        drag?.setSqueezeSuppressed(false)
      }
    }
    drag.onDragEnd = () => {
      drag?.setSqueezeSuppressed(false)
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

    refreshBtn.setSubLabel(`💰 ${shopManager.gold}/${SHOP_QUICK_BUY_PRICE}`)

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
      if (kind === 'battle') refreshBattlePassiveStatBadges(false)
      const tier = getInstanceTier(instanceId)
      const star = getInstanceTierStar(instanceId)
      const sellPrice = manager.getSellPrice(item, tier)
      const infoMode = resolveInfoMode(`${kind}:${instanceId}:${tier}:${star}`)
      sellPopup.show(item, sellPrice, 'sell', toVisualTier(tier, star), undefined, infoMode)

      selectedSellAction = () => {
        system.remove(instanceId)
        view.removeItem(instanceId)
        removeInstanceMeta(instanceId)
        manager.sellItem(item, tier)
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
    }
    refreshShopUI()
    applyPhaseInputLock()
  },

  onExit() {
    console.log('[ShopScene] 离开商店场景')
    const { stage } = getApp()

    stopFlashEffect()
    stopGridDragButtonFlash()

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
    if (shopAreaBg)   stage.removeChild(shopAreaBg)
    if (backpackAreaBg) stage.removeChild(backpackAreaBg)
    if (battleAreaBg) stage.removeChild(battleAreaBg)
    if (restartBtn)   stage.removeChild(restartBtn)
    if (btnRow)       stage.removeChild(btnRow)
    if (dayDebugCon)  stage.removeChild(dayDebugCon)
    if (hintToastCon) stage.removeChild(hintToastCon)
    if (passiveJumpLayer?.parent) passiveJumpLayer.parent.removeChild(passiveJumpLayer)

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
    restartBtn    = null
    bpBtnHandle   = null; refreshBtnHandle = null; sellBtnHandle = null
    phaseBtnHandle = null
    refreshCostText = null
    hintToastCon = null
    hintToastBg = null
    hintToastText = null
    passiveJumpLayer = null
    battlePassivePrevStats.clear()
    battlePassiveResolvedStats.clear()
    if (expandTickFn) { Ticker.shared.remove(expandTickFn); expandTickFn = null }
    dayDebugText    = null
    dayPrevBtn      = null
    dayNextBtn      = null
    dayDebugCon     = null
    currentDay      = 1
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
