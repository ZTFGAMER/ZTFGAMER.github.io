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
import { ShopManager, type ShopSlot, type TierKey } from '@/shop/ShopManager'
import { ShopPanelView }     from '@/shop/ShopPanelView'
import { SellPopup }         from '@/shop/SellPopup'
import { getConfig as getDebugCfg, onConfigChange as onDebugCfgChange } from '@/config/debugConfig'
import { getTierColor } from '@/config/colorPalette'
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
const UPGRADE_HIGHLIGHT_COLOR = 0xffcc44

// ---- 背包小地图 ----
const MINI_CELL = 20
const MINI_W    = 6 * MINI_CELL
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
let showingBackpack = false

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
let gridDragCanSell = false
let gridDragCanToBackpack = false
let offDebugCfg:    (() => void) | null = null
let offPhaseChange: (() => void) | null = null
let onStageTapHidePopup: ((e: FederatedPointerEvent) => void) | null = null
let onStageShopPointerMove: ((e: FederatedPointerEvent) => void) | null = null
let onStageShopPointerUp: ((e: FederatedPointerEvent) => void) | null = null
let onStageShopPointerUpOutside: ((e: FederatedPointerEvent) => void) | null = null
let shopAreaBg: Graphics | null = null
let backpackAreaBg: Graphics | null = null
let battleAreaBg: Graphics | null = null

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

type SavedPlacedItem = {
  instanceId: string
  defId: string
  size: ItemSizeNorm
  col: number
  row: number
  tier: TierKey
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
    showingBackpack = false
    shopPanel?.setSelectedSlot(-1)
    battleView?.setSelected(null)
    backpackView?.setSelected(null)
    clearSelection()
    applySellButtonState()
  }

  if (shopPanel) shopPanel.visible = inShop && !showingBackpack
  if (backpackView) backpackView.visible = inShop && showingBackpack
  if (shopAreaBg) shopAreaBg.visible = inShop && !showingBackpack
  if (backpackAreaBg) backpackAreaBg.visible = inShop && showingBackpack
  if (battleAreaBg) battleAreaBg.visible = inShop

  if (bpBtnHandle) bpBtnHandle.container.visible = inShop
  if (refreshBtnHandle) refreshBtnHandle.container.visible = inShop
  if (sellBtnHandle) sellBtnHandle.container.visible = inShop && (currentSelection.kind === 'battle' || currentSelection.kind === 'backpack')
  if (phaseBtnHandle) phaseBtnHandle.container.visible = true

  if (refreshCostText) refreshCostText.visible = inShop && !showingBackpack && currentSelection.kind === 'none'
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
      permanentDamageBonus: Math.max(0, Math.round(instanceToPermanentDamageBonus.get(it.instanceId) ?? 0)),
    })),
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
  instanceToPermanentDamageBonus.clear()

  const restoreOne = (it: SavedPlacedItem, system: GridSystem, view: GridZone) => {
    system.place(it.col, it.row, it.size, it.defId, it.instanceId)
    instanceToDefId.set(it.instanceId, it.defId)
    instanceToTier.set(it.instanceId, it.tier)
    instanceToPermanentDamageBonus.set(it.instanceId, Math.max(0, Math.round(it.permanentDamageBonus ?? 0)))
    view.addItem(it.instanceId, it.defId, it.size, it.col, it.row, it.tier).then(() => {
      view.setItemTier(it.instanceId, it.tier)
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
const instanceToPermanentDamageBonus = new Map<string, number>()

function removeInstanceMeta(instanceId: string): void {
  instanceToDefId.delete(instanceId)
  instanceToTier.delete(instanceId)
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
  toTier: TierKey
  targetSize: ItemSizeNorm
}

type SynthesisTarget = {
  instanceId: string
  zone: 'battle' | 'backpack'
}

const TIER_ORDER: TierKey[] = ['Bronze', 'Silver', 'Gold', 'Diamond']
const TIER_LABEL_CN: Record<TierKey, string> = {
  Bronze: '青铜',
  Silver: '白银',
  Gold: '黄金',
  Diamond: '钻石',
}

function nextTier(tier: TierKey): TierKey | null {
  const idx = TIER_ORDER.indexOf(tier)
  if (idx < 0 || idx >= TIER_ORDER.length - 1) return null
  return TIER_ORDER[idx + 1] ?? null
}

function compareTier(a: TierKey, b: TierKey): number {
  return TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b)
}

function getInstanceTier(instanceId: string): TierKey | undefined {
  return instanceToTier.get(instanceId)
}

function applyInstanceTierVisuals(): void {
  if (battleView) {
    for (const id of instanceToDefId.keys()) {
      battleView.setItemTier(id, getInstanceTier(id))
    }
  }
  if (backpackView) {
    for (const id of instanceToDefId.keys()) {
      backpackView.setItemTier(id, getInstanceTier(id))
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
    backpackView.addItem(newId, item.id, size, place.col, place.row, entity.tier).then(() => {
      backpackView!.setItemTier(newId, entity.tier)
      drag?.refreshZone(backpackView!)
    })
    instanceToDefId.set(newId, item.id)
    instanceToTier.set(newId, entity.tier)
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

function applyBackpackUpgradeButtonHint(enabled: boolean): void {
  if (!bpBtnHandle) return
  const existing = bpBtnHandle.container.getChildByName('bp-upgrade-arrow') as Graphics | null
  let arrow = existing
  if (!arrow) {
    arrow = new Graphics()
    arrow.name = 'bp-upgrade-arrow'
    // 2x 箭头（40x48）
    arrow.moveTo(0, 24)
    arrow.lineTo(20, 0)
    arrow.lineTo(40, 24)
    arrow.lineTo(28, 24)
    arrow.lineTo(28, 48)
    arrow.lineTo(12, 48)
    arrow.lineTo(12, 24)
    arrow.fill({ color: 0xffffff, alpha: 0.95 })
    arrow.stroke({ color: 0x1a1a2a, width: 3, alpha: 0.85 })
    // 放在背包按钮中心
    arrow.x = getDebugCfg('backpackBtnX') - 20
    arrow.y = getDebugCfg('backpackBtnY') - 24
    bpBtnHandle.container.addChild(arrow)
  }
  arrow.visible = enabled
  const prev = (bpBtnHandle.container as any)._upgradeTick as (() => void) | undefined
  if (enabled && !prev) {
    let t = 0
    const tick = () => {
      t += 0.08
      arrow!.alpha = 0.55 + ((Math.sin(t) + 1) / 2) * 0.45
      arrow!.x = getDebugCfg('backpackBtnX') - 20
      arrow!.y = getDebugCfg('backpackBtnY') - 24 + Math.sin(t * 1.6) * 3
    }
    ;(bpBtnHandle.container as any)._upgradeTick = tick
    Ticker.shared.add(tick)
  }
  if (!enabled && prev) {
    Ticker.shared.remove(prev)
    ;(bpBtnHandle.container as any)._upgradeTick = undefined
  }
}

function refreshUpgradeHints(): void {
  const match = computeUpgradeMatch()
  shopPanel?.setUpgradeHints(match.shopSlots)
  battleView?.setUpgradeHints(match.battleIds)
  backpackView?.setUpgradeHints(match.backpackIds)
  applyBackpackUpgradeButtonHint(!showingBackpack && match.hasBackpackMatch)
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

function getCellSize(size: ItemSizeNorm): { w: number; h: number } {
  if (size === '1x1') return { w: 1, h: 1 }
  if (size === '2x1') return { w: 2, h: 1 }
  return { w: 3, h: 1 }
}

function isCellFootprintOverlap(
  aCol: number,
  aRow: number,
  aSize: ItemSizeNorm,
  bCol: number,
  bRow: number,
  bSize: ItemSizeNorm,
): boolean {
  const a = getCellSize(aSize)
  const b = getCellSize(bSize)
  const aR = aCol + a.w
  const aB = aRow + a.h
  const bR = bCol + b.w
  const bB = bRow + b.h
  return aCol < bR && aR > bCol && aRow < bB && aB > bRow
}

function findSynthesisTargetAtPointer(defId: string, tier: TierKey, gx: number, gy: number, dragSize?: ItemSizeNorm): SynthesisTarget | null {
  if (battleView && battleSystem && isPointInZoneArea(battleView, gx, gy)) {
    const battleCell = dragSize ? battleView.pixelToCellForItem(gx, gy, dragSize, 0) : null
    const battleRow = battleCell ? (dragSize !== '1x1' ? 0 : battleCell.row) : 0
    for (const it of battleSystem.getAllItems()) {
      if (it.defId !== defId) continue
      if ((instanceToTier.get(it.instanceId) ?? 'Bronze') !== tier) continue
      const hit = battleCell
        ? isCellFootprintOverlap(it.col, it.row, it.size, battleCell.col, battleRow, dragSize!)
        : isPointInItemBounds(battleView, it, gx, gy)
      if (hit) {
        return { instanceId: it.instanceId, zone: 'battle' }
      }
    }
  }

  if (backpackView && backpackView.visible && backpackSystem && isPointInZoneArea(backpackView, gx, gy)) {
    const bpCell = dragSize ? backpackView.pixelToCellForItem(gx, gy, dragSize, 0) : null
    const bpRow = bpCell ? (dragSize !== '1x1' ? 0 : bpCell.row) : 0
    for (const it of backpackSystem.getAllItems()) {
      if (it.defId !== defId) continue
      if ((instanceToTier.get(it.instanceId) ?? 'Bronze') !== tier) continue
      const hit = bpCell
        ? isCellFootprintOverlap(it.col, it.row, it.size, bpCell.col, bpRow, dragSize!)
        : isPointInItemBounds(backpackView, it, gx, gy)
      if (hit) {
        return { instanceId: it.instanceId, zone: 'backpack' }
      }
    }
  }

  return null
}

function synthesizeTarget(defId: string, tier: TierKey, targetInstanceId: string, zone: 'battle' | 'backpack'): SynthesizeResult | null {
  if (!battleSystem || !backpackSystem || !battleView || !backpackView) return null
  const upgradeTo = nextTier(tier)
  if (!upgradeTo) return null

  const targetItem = zone === 'battle'
    ? battleSystem.getItem(targetInstanceId)
    : backpackSystem.getItem(targetInstanceId)
  if (!targetItem) return null
  if (targetItem.defId !== defId) return null
  if ((instanceToTier.get(targetInstanceId) ?? 'Bronze') !== tier) return null

  instanceToTier.set(targetInstanceId, upgradeTo)
  if (zone === 'battle') {
    battleView.setItemTier(targetInstanceId, upgradeTo)
    drag?.refreshZone(battleView)
  } else {
    backpackView.setItemTier(targetInstanceId, upgradeTo)
    drag?.refreshZone(backpackView)
  }
  applyInstanceTierVisuals()
  syncShopOwnedTierRules()
  refreshUpgradeHints()
  return {
    instanceId: targetInstanceId,
    targetZone: zone,
    fromTier: tier,
    toTier: upgradeTo,
    targetSize: targetItem.size,
  }
}

function highlightSynthesisTarget(target: SynthesisTarget): void {
  battleView?.clearHighlight()
  backpackView?.clearHighlight()
  if (target.zone === 'battle' && battleSystem && battleView) {
    const item = battleSystem.getItem(target.instanceId)
    if (!item) return
    battleView.highlightCells(item.col, item.row, item.size, true, UPGRADE_HIGHLIGHT_COLOR)
    return
  }
  if (target.zone === 'backpack' && backpackSystem && backpackView?.visible) {
    const item = backpackSystem.getItem(target.instanceId)
    if (!item) return
    backpackView.highlightCells(item.col, item.row, item.size, true, UPGRADE_HIGHLIGHT_COLOR)
  }
}

async function playSynthesisAnimation(
  stage: Container,
  slot: { item: { id: string; name_cn: string } },
  result: SynthesizeResult,
): Promise<void> {
  const layer = new Container()
  const mask = new Graphics()
  mask.rect(0, 0, CANVAS_W, CANVAS_H)
  mask.fill({ color: 0x000000, alpha: 0.55 })
  mask.eventMode = 'static'
  layer.addChild(mask)

  const upColor = getTierColor(result.toTier)
  const title = new Text({
    text: `合成升级  ${TIER_LABEL_CN[result.fromTier]} -> ${TIER_LABEL_CN[result.toTier]}`,
    style: {
      fontSize: getDebugCfg('synthTitleFontSize'),
      fill: upColor,
      fontFamily: 'Arial',
      fontWeight: 'bold',
    },
  })
  title.x = (CANVAS_W - title.width) / 2
  title.y = CANVAS_H * 0.35
  layer.addChild(title)

  const nameT = new Text({
    text: slot.item.name_cn,
    style: {
      fontSize: getDebugCfg('synthNameFontSize'),
      fill: 0xdde3ff,
      fontFamily: 'Arial',
      fontWeight: 'bold',
    },
  })
  nameT.x = (CANVAS_W - nameT.width) / 2
  nameT.y = title.y + 48
  layer.addChild(nameT)

  const iconWrap = new Container()
  const visualScale = getConfig().itemVisualScale
  const baseW = result.targetSize === '1x1' ? CELL_SIZE : result.targetSize === '2x1' ? CELL_SIZE * 2 : CELL_SIZE * 3
  const baseH = CELL_SIZE * 2
  const iconW = Math.max(48, Math.round(baseW * visualScale))
  const iconH = Math.max(48, Math.round(baseH * visualScale))
  const bg = new Graphics()
  bg.roundRect(0, 0, iconW, iconH, 16)
  bg.fill({ color: 0x1f2238, alpha: 0.96 })
  bg.stroke({ color: upColor, width: 3, alpha: 0.95 })
  iconWrap.addChild(bg)

  const sp = new Sprite(Texture.WHITE)
  sp.width = iconW - 12
  sp.height = iconH - 12
  sp.x = 6
  sp.y = 6
  sp.alpha = 0
  iconWrap.addChild(sp)

  iconWrap.x = (CANVAS_W - iconW) / 2
  iconWrap.y = nameT.y + 56
  layer.addChild(iconWrap)
  stage.addChild(layer)

  Assets.load<Texture>(getItemIconUrl(slot.item.id))
    .then((tex) => { sp.texture = tex; sp.alpha = 1 })
    .catch((err) => { console.warn('[ShopScene] 合成图标加载失败', slot.item.id, err) })

  const holdMs = getDebugCfg('synthHoldMs')
  if (holdMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, holdMs))
  }

  const fadeMs = getDebugCfg('synthFadeOutMs')
  if (fadeMs <= 0) {
    stage.removeChild(layer)
    layer.destroy({ children: true })
    return
  }

  const start = Date.now()
  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = Math.min((Date.now() - start) / fadeMs, 1)
      const ease = 1 - Math.pow(1 - t, 3)
      mask.alpha = 0.55 * (1 - ease)
      title.alpha = 1 - ease
      nameT.alpha = 1 - ease
      iconWrap.alpha = 1 - ease
      if (t >= 1) {
        Ticker.shared.remove(tick)
        stage.removeChild(layer)
        layer.destroy({ children: true })
        resolve()
      }
    }
    Ticker.shared.add(tick)
  })
}

function findFirstBackpackPlace(size: ItemSizeNorm): { col: number; row: number } | null {
  if (!backpackSystem || !backpackView) return null
  for (let row = 0; row < backpackSystem.rows; row++) {
    for (let col = 0; col < backpackView.activeColCount; col++) {
      const finalRow = size !== '1x1' ? 0 : row
      if (canPlaceInVisibleCols(backpackSystem, backpackView, col, finalRow, size)) {
        return { col, row: finalRow }
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
  for (let r = 0; r < 1; r++) {
    for (let c = 0; c < 6; c++) {
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
  if (!shopManager || !shopPanel) return
  syncShopOwnedTierRules()
  shopPanel.update(shopManager.pool, shopManager.gold)
  if (goldText) {
    goldText.text = `💰 ${shopManager.gold}G`
    goldText.x    = getDebugCfg('goldTextCenterX') - goldText.width / 2
    goldText.y    = getDebugCfg('goldTextY')
  }
  if (refreshCostText) {
    refreshCostText.text = `💰 ${shopManager.getRefreshPrice()}G`
    refreshCostText.x    = getDebugCfg('refreshBtnX') - refreshCostText.width / 2
    // 金币不足：刷新价格显示红色
    refreshCostText.style.fill = shopManager.canRefresh() ? 0xffd700 : 0xff4444
  }
  updateMiniMap()
  refreshUpgradeHints()
  saveShopStateToStorage(captureShopState())
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
  setBtnTextSize(refreshBtnHandle, false)
  setBtnTextSize(sellBtnHandle, false)
  setBtnTextSize(phaseBtnHandle, true)

  if (phaseBtnHandle) {
    const main = phaseBtnHandle.container.getChildByName('btn-main') as Text | null
    if (main) main.style.fontSize = phaseButtonSize
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
  battleView?.setStatBadgeFontSize(getDebugCfg('itemStatBadgeFontSize'))
  backpackView?.setStatBadgeFontSize(getDebugCfg('itemStatBadgeFontSize'))
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
    backpackView.y = getDebugCfg('backpackZoneY') + (CELL_HEIGHT * (1 - s)) / 2
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
    sellBtnHandle.container.visible = showSell
    sellBtnHandle.redraw(showSell)
    if (!showSell) sellBtnHandle.setSubLabel('')
  }

  // 显示优先级：出售 > 刷新
  // 刷新保持原逻辑（背包打开时隐藏），但当出售可见时强制隐藏。
  const canShowRefresh = !showingBackpack
  const showRefresh = canShowRefresh && !showSell
  if (refreshBtnHandle) refreshBtnHandle.container.visible = showRefresh
  if (refreshCostText) refreshCostText.visible = showRefresh
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
  const maxRow = 2 - h
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
      backpackView.addItem(p.instanceId, p.defId, p.size, p.col, p.row, tier).then(() => {
        backpackView!.setItemTier(p.instanceId, tier)
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
    if (backpackView.hasItem(p.instanceId)) {
      backpackView.animateToCell(p.instanceId, p.col, p.row, moveMs)
      backpackView.setItemTier(p.instanceId, tier)
    } else {
      backpackView.addItem(p.instanceId, p.defId, p.size, p.col, p.row, tier).then(() => {
        backpackView!.setItemTier(p.instanceId, tier)
        drag?.refreshZone(backpackView!)
      })
    }
  }

  drag?.refreshZone(backpackView)
  drag?.refreshZone(battleView)
  playBackpackTransferMiniAnim(transferAnimSeeds)
}

function _isOverSellBtn(gx: number, gy: number): boolean {
  const cx = getDebugCfg('sellBtnX')
  const cy = getDebugCfg('sellBtnY')
  const r  = BTN_RADIUS + 24
  const c = getApp().stage.toGlobal({ x: cx, y: cy })
  return (gx - c.x) ** 2 + (gy - c.y) ** 2 <= r * r
}

function startGridDragButtonFlash(stage: Container, canSell: boolean, canToBackpack: boolean): void {
  stopGridDragButtonFlash()
  gridDragCanSell = canSell
  gridDragCanToBackpack = canToBackpack
  if (!gridDragCanSell && !gridDragCanToBackpack) return

  const overlay = new Graphics()
  const dragIdx = stage.children.length - 1
  stage.addChildAt(overlay, Math.max(0, dragIdx))
  gridDragFlashOverlay = overlay

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
  }
  Ticker.shared.add(gridDragFlashTick)
}

function stopGridDragButtonFlash(): void {
  if (gridDragFlashTick) { Ticker.shared.remove(gridDragFlashTick); gridDragFlashTick = null }
  if (gridDragFlashOverlay) { gridDragFlashOverlay.destroy(); gridDragFlashOverlay = null }
  gridDragCanSell = false
  gridDragCanToBackpack = false
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
    ? findSynthesisTargetAtPointer(dragSlot.item.id, dragSlot.tier, gx, gy, shopDragSize)
    : null

  if (synthTarget) {
    if (dragSlot && sellPopup) {
      const toTier = nextTier(dragSlot.tier)
      if (toTier) sellPopup.showUpgradePreview(dragSlot.item, dragSlot.price, dragSlot.tier, toTier, 'buy')
    }
    battleView?.clearHighlight()
    backpackView?.clearHighlight()
    if (synthTarget.zone === 'battle' && battleSystem && battleView) {
      const target = battleSystem.getItem(synthTarget.instanceId)
      if (target) {
        battleView.highlightCells(target.col, target.row, target.size, true, UPGRADE_HIGHLIGHT_COLOR)
      }
    } else if (synthTarget.zone === 'backpack' && backpackSystem && backpackView?.visible) {
      const target = backpackSystem.getItem(synthTarget.instanceId)
      if (target) {
        backpackView.highlightCells(target.col, target.row, target.size, true, UPGRADE_HIGHLIGHT_COLOR)
      }
    }
    return
  }

  if (dragSlot && sellPopup) {
    sellPopup.show(dragSlot.item, dragSlot.price, 'buy', dragSlot.tier)
  }

  if (battleCell && battleSystem) {
    const finalRow = shopDragSize !== '1x1' ? 0 : battleCell.row
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
  let synthTarget = findSynthesisTargetAtPointer(slot.item.id, slot.tier, gx, gy, size)
  const battleCell = battleView?.pixelToCellForItem(gx, gy, size, 0)
  const bpCell = backpackView?.visible ? backpackView.pixelToCellForItem(gx, gy, size, 0) : null
  const overBattleArea = isPointInZoneArea(battleView, gx, gy)
  const onBpBtn = _isOverBpBtn(gx, gy)

  if (synthTarget) {
    if (!shopManager.buy(slot)) {
      showHintToast('no_gold_buy', '金币不足，无法购买', 0xff8f8f)
      _resetDrag(); return
    }
    const synth = synthesizeTarget(slot.item.id, slot.tier, synthTarget.instanceId, synthTarget.zone)
    if (!synth) {
      showHintToast('backpack_full_buy', '合成目标无效', 0xff8f8f)
      refreshShopUI()
      _resetDrag(); return
    }
    await playSynthesisAnimation(stage, slot, synth)
    console.log(`[ShopScene] 合成升级 ${slot.item.name_cn} ${slot.tier} -> ${synth.toTier}`)
    refreshShopUI()
    _resetDrag(); return
  }

  // 仅当落点在战斗区（含合成范围）/背包格子/背包按钮时才允许购买
  if (!overBattleArea && !bpCell && !onBpBtn) {
    _resetDrag()
    return
  }

  // 战斗区放置
  const battleFinalRow = battleCell ? (size !== '1x1' ? 0 : battleCell.row) : 0
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
      battleView!.addItem(id, slot.item.id, size, battleCell.col, battleFinalRow, slot.tier)
        .then(() => {
          battleView!.setItemTier(id, slot.tier)
          drag?.refreshZone(battleView!)
        })
      instanceToDefId.set(id, slot.item.id)
      instanceToTier.set(id, slot.tier)
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
        const finalRow = size !== '1x1' ? 0 : bpCell.row
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
    backpackView!.addItem(id, slot.item.id, size, targetCell.col, targetCell.row, slot.tier)
      .then(() => {
        backpackView!.setItemTier(id, slot.tier)
        drag?.refreshZone(backpackView!)
      })
    instanceToDefId.set(id, slot.item.id)
    instanceToTier.set(id, slot.tier)
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
// 测试物品：背包预置初始物品
// ============================================================
function placeInitialItems(): void {
  const items  = getAllItems()
  const pick   = (s: string, n: number) =>
    items.filter(i => i.size.toLowerCase().includes(s)).slice(0, n)

  const small  = pick('small',  2)
  const medium = pick('medium', 1)

  const bpItems = [
    { defId: small[0]?.id ?? '',  rawSize: 'Small / 小型',  col: 0, row: 0 },
    { defId: small[1]?.id ?? '',  rawSize: 'Small / 小型',  col: 1, row: 0 },
    { defId: medium[0]?.id ?? '', rawSize: 'Medium / 中型', col: 2, row: 0 },
  ]

  for (const bp of bpItems) {
    if (!bp.defId) continue
    const id   = nextId()
    const norm = normalizeSize(bp.rawSize)
    const tier: TierKey = 'Bronze'
    backpackSystem!.place(bp.col, bp.row, norm, bp.defId, id)
    backpackView!.addItem(id, bp.defId, norm, bp.col, bp.row, tier)
      .then(() => {
        backpackView!.setItemTier(id, tier)
        drag?.refreshZone(backpackView!)
      })
    instanceToDefId.set(id, bp.defId)
    instanceToTier.set(id, tier)
    instanceToPermanentDamageBonus.set(id, 0)
  }

  console.log('[ShopScene] 背包初始物品:', backpackSystem!.getAllItems().length)
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

    createHintToast(stage)

    shopManager = new ShopManager(cfg, items, 1)

    // 顶部分区背景（商店 / 背包）
    shopAreaBg = new Graphics()
    stage.addChild(shopAreaBg)
    backpackAreaBg = new Graphics()
    stage.addChild(backpackAreaBg)
    battleAreaBg = new Graphics()
    stage.addChild(battleAreaBg)

    // 商店面板
    shopPanel = new ShopPanelView()
    shopPanel.x = getDebugCfg('shopAreaX')
    shopPanel.y = getDebugCfg('shopAreaY')
    shopPanel.onDragStart = (slotIndex, e) => startShopDrag(slotIndex, e, stage)
    stage.addChild(shopPanel)

    // 格子系统
    const activeCols = cfg.dailyBattleSlots[0] ?? 4
    battleSystem   = new GridSystem(6)
    backpackSystem = new GridSystem(6)
    battleView     = new GridZone('战斗区', 6, activeCols, 1)
    backpackView   = new GridZone('背包', 6, 6, 1)
    backpackView.setAutoPackEnabled(false)
    battleView.x   = getBattleZoneX(activeCols)
    battleView.y   = getDebugCfg('battleZoneY')
    backpackView.x = getBackpackZoneX(backpackView.activeColCount)
    backpackView.y = getDebugCfg('backpackZoneY')
    backpackView.visible = false

    stage.addChild(battleView)
    stage.addChild(backpackView)

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
      const sellPrice = shopManager.getSellPrice(item, tier)
      // 拖拽中视为选中：显示物品详情（不设置区域高亮，因物品已脱离格子）
      const inBattle = !!battleView?.hasItem(instanceId)
      currentSelection = { kind: inBattle ? 'battle' : 'backpack', instanceId }
      selectedSellAction = null  // 拖拽中暂不执行出售
      sellPopup.show(item, sellPrice, 'sell', tier)
      setSellButtonPrice(sellPrice)
      applySellButtonState()

      // 按钮闪烁提示：可出售则闪出售；战斗区->背包（背包未打开且有空位）则闪背包按钮
      const canSell = true
      const canToBackpack = inBattle && !showingBackpack
        && canBackpackAcceptByAutoPack(item.id, normalizeSize(item.size))
      startGridDragButtonFlash(stage, canSell, canToBackpack)
    }
    drag.onSpecialDrop = ({ instanceId, anchorGx, anchorGy, size, homeSystem, homeView, defId }) => {
      if (!shopManager) return false
      const item = getAllItems().find(i => i.id === defId)
      if (!item) return false

      // 1) 拖到出售按钮：直接出售
      if (_isOverSellBtn(anchorGx, anchorGy)) {
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
      if (fromTier !== 'Diamond') {
        const synthTarget = findSynthesisTargetAtPointer(defId, fromTier, anchorGx, anchorGy, size)
        if (synthTarget) {
          const synth = synthesizeTarget(defId, fromTier, synthTarget.instanceId, synthTarget.zone)
          if (synth) {
            removeInstanceMeta(instanceId)
            console.log(`[ShopScene] 拖拽合成 ${item.name_cn} ${fromTier} -> ${synth.toTier}`)
            void playSynthesisAnimation(stage, { item: { id: item.id, name_cn: item.name_cn } }, synth)
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
        backpackView.addItem(instanceId, defId, size, autoPlan.incoming.col, autoPlan.incoming.row, tier).then(() => {
          backpackView!.setItemTier(instanceId, tier)
          drag?.refreshZone(backpackView!)
        })
        console.log(`[ShopScene] 拖拽转移→背包 ${item.name_cn}`)
        refreshShopUI()
        return true
      }

      return false
    }
    drag.onDragMove = ({ instanceId, anchorGx, anchorGy, size }) => {
      // 可用状态随时重算（例如拖拽过程中背包可见状态变化）
      if (gridDragCanToBackpack) {
        gridDragCanToBackpack = !showingBackpack
      }

      const defId = instanceToDefId.get(instanceId)
      const tier = getInstanceTier(instanceId)
      if (!defId || !tier || tier === 'Diamond') {
        drag?.setSqueezeSuppressed(false)
        return
      }

      const synthTarget = findSynthesisTargetAtPointer(defId, tier, anchorGx, anchorGy, size)
      if (synthTarget) {
        drag?.setSqueezeSuppressed(true)
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
        txt.x = curCx - txt.width / 2
        txt.y = curCy - txt.height / 2
        sub.x = curCx - sub.width / 2
        sub.y = curCy + BTN_RADIUS + 6
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
        txt.x = curCx - txt.width / 2
        txt.y = curCy - txt.height / 2
        sub.x = curCx - sub.width / 2
        sub.y = top + PHASE_BTN_H + 6
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

    // 背包按钮（左）
    const bpBtn = makeCircleBtn(getDebugCfg('backpackBtnX'), getDebugCfg('backpackBtnY'), '背包', 0xffcc44, 0x44aaff)
    bpBtn.container.on('pointerdown', () => {
      if (!isShopInputEnabled()) return
      showingBackpack = !showingBackpack
      shopPanel!.visible    = !showingBackpack
      backpackView!.visible = showingBackpack
      bpBtn.redraw(showingBackpack)
      ensureBottomHudVisibleAndOnTop(stage)
      clearSelection()
      applyLayoutFromDebug()
      refreshUpgradeHints()
    })
    bpBtnHandle = bpBtn
    btnRow.addChild(bpBtn.container)

    // 刷新按钮（中）
    const refreshBtn = makeCircleBtn(getDebugCfg('refreshBtnX'), getDebugCfg('refreshBtnY'), '刷新', 0x44aaff, 0x44aaff)
    refreshBtn.container.on('pointerdown', () => {
      if (!isShopInputEnabled()) return
      clearSelection()
      syncShopOwnedTierRules()
      if (shopManager!.refresh()) {
        console.log(`[ShopScene] 刷新，剩余: ${shopManager!.gold}G`)
      } else {
        showHintToast('no_gold_refresh', '金币不足，无法刷新', 0xff8f8f)
      }
      refreshShopUI()
      // 视觉：按钮默认都保持红色描边（不因一次点击变色）
      refreshBtn.redraw(false)
    })
    refreshBtnHandle = refreshBtn
    btnRow.addChild(refreshBtn.container)

    // 刷新费用（刷新按钮圆圈正下方）
    refreshCostText = new Text({
      text: `💰 ${shopManager.getRefreshPrice()}G`,
      style: { fontSize: cfg.textSizes.refreshCost, fill: 0xffd700, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    refreshCostText.x = getDebugCfg('refreshBtnX') - refreshCostText.width / 2
    refreshCostText.y = getDebugCfg('refreshBtnY') + BTN_RADIUS + 6
    btnRow.addChild(refreshCostText)

    // 金币（刷新按钮正下方）
    goldText = new Text({
      text: `💰 ${shopManager.gold}G`,
      style: { fontSize: cfg.textSizes.gold, fill: 0xffd700, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    goldText.x = getDebugCfg('goldTextCenterX') - goldText.width / 2
    goldText.y = getDebugCfg('goldTextY')
    btnRow.addChild(goldText)

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

    // 战斗切换按钮（阶段2.5 临时入口）
    const phaseBtn = makePhaseRectBtn(
      getDebugCfg('phaseBtnX'),
      getDebugCfg('phaseBtnY'),
      '战斗',
      0xffcc44,
      0xffcc44,
      cfg.textSizes.phaseButtonLabel,
    )
    phaseBtn.container.on('pointerdown', () => {
      if (!isShopInputEnabled()) {
        SceneManager.goto('shop')
        return
      }
      clearBattleOutcome()
      const snapshot = buildBattleSnapshot()
      if (snapshot) {
        setBattleSnapshot(snapshot)
        console.log(`[ShopScene] 战斗快照已生成 day=${snapshot.day} entities=${snapshot.entities.length} cols=${snapshot.activeColCount}`)
      }
      pendingBattleTransition = true
      pendingAdvanceToNextDay = true
      SceneManager.goto('battle')
    })
    phaseBtnHandle = phaseBtn
    btnRow.addChild(phaseBtn.container)

    // 背包小地图（背包按钮正下方）
    const miniCon = new Container()
    miniCon.x = getDebugCfg('backpackBtnX') - MINI_W / 2
    miniCon.y = getDebugCfg('backpackBtnY') + BTN_RADIUS + 8
    miniMapGfx = new Graphics()
    miniCon.addChild(miniMapGfx)
    miniMapCon = miniCon
    btnRow.addChild(miniCon)

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
      const tier = getInstanceTier(instanceId)
      const sellPrice = manager.getSellPrice(item, tier)
      sellPopup.show(item, sellPrice, 'sell', tier)

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

      sellPopup.show(slot.item, slot.price, 'buy', slot.tier)
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
        || key === 'itemStatBadgeOffsetY'
        || key === 'itemInfoNameFontSize'
        || key === 'itemInfoTierFontSize'
        || key === 'itemInfoPriceFontSize'
        || key === 'itemInfoPriceCornerFontSize'
        || key === 'itemInfoCooldownFontSize'
        || key === 'itemInfoDescFontSize'
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
      placeInitialItems()
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
    if (btnRow)       stage.removeChild(btnRow)
    if (dayDebugCon)  stage.removeChild(dayDebugCon)
    if (hintToastCon) stage.removeChild(hintToastCon)

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

    drag?.destroy()
    shopManager   = null; shopPanel    = null; sellPopup = null
    btnRow        = null
    goldText      = null; miniMapGfx   = null; miniMapCon = null
    shopAreaBg    = null; backpackAreaBg = null; battleAreaBg = null
    bpBtnHandle   = null; refreshBtnHandle = null; sellBtnHandle = null
    phaseBtnHandle = null
    refreshCostText = null
    hintToastCon = null
    hintToastBg = null
    hintToastText = null
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
    instanceToPermanentDamageBonus.clear()
  },

  update(_dt: number) {},
}
