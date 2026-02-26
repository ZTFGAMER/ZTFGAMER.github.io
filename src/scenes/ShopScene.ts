// ============================================================
// ShopScene — 商店/准备场景（Phase 2 视觉验收版）
// 布局（640×1384 画布）：
//   y=430  商店面板 / 背包（互斥显示）
//   y=840  按钮行：背包 | 刷新(金币) | 出售
//   y=1020 我的战斗区 5×2
// 拖拽购买：从商店卡片拖到战斗区/背包按钮完成购买
// ============================================================

import type { Scene }        from './SceneManager'
import { getApp }            from '@/core/AppContext'
import { getConfig, getAllItems } from '@/core/DataLoader'
import { GridSystem }        from '@/grid/GridSystem'
import type { ItemSizeNorm } from '@/grid/GridSystem'
import { GridZone, CELL_SIZE } from '@/grid/GridZone'
import { DragController }    from '@/grid/DragController'
import { planAutoPack, type PackItem, type PackPlacement } from '@/grid/AutoPack'
import { planUnifiedSqueeze } from '@/grid/SqueezeLogic'
import { normalizeSize }     from '@/items/ItemDef'
import { ShopManager, type TierKey } from '@/shop/ShopManager'
import { ShopPanelView }     from '@/shop/ShopPanelView'
import { SellPopup }         from '@/shop/SellPopup'
import { getConfig as getDebugCfg, onConfigChange as onDebugCfgChange } from '@/config/debugConfig'
import { getItemIconUrl } from '@/core/assetPath'
import {
  Container, Graphics, Text, Sprite,
  Assets, Texture, Rectangle, Ticker,
  type FederatedPointerEvent,
} from 'pixi.js'

// ---- 布局常量（640×1384 画布）----
const CANVAS_W      = 640
const CANVAS_H      = 1384
const BTN_RADIUS    = 52
const AREA_LABEL_LEFT_X = 0
const SWAP_HIGHLIGHT_COLOR = 0xffcc44

// ---- 背包小地图 ----
const MINI_CELL = 20
const MINI_W    = 5 * MINI_CELL  // 100px

// ---- 品质颜色（商店拖拽浮层用）----
const TIER_COLORS: Record<string, number> = {
  Bronze: 0xcd7f32, Silver: 0xaaaacc, Gold: 0xffbf1f, Diamond: 0x48e9ff,
}

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
let refreshCostText:  Text            | null = null

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
let onStageTapHidePopup: ((e: FederatedPointerEvent) => void) | null = null
let shopAreaBg: Graphics | null = null
let backpackAreaBg: Graphics | null = null

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

let instCounter = 1
const nextId = () => `inst-${instCounter++}`

const instanceToDefId = new Map<string, string>()
const instanceToTier = new Map<string, TierKey>()

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

function hasSynthesisTarget(defId: string, tier: TierKey): boolean {
  if (!battleSystem || !backpackSystem) return false
  for (const it of battleSystem.getAllItems()) {
    if (it.defId === defId && (instanceToTier.get(it.instanceId) ?? 'Bronze') === tier) return true
  }
  for (const it of backpackSystem.getAllItems()) {
    if (it.defId === defId && (instanceToTier.get(it.instanceId) ?? 'Bronze') === tier) return true
  }
  return false
}

function trySynthesizeOwned(defId: string, tier: TierKey): SynthesizeResult | null {
  if (!battleSystem || !backpackSystem || !battleView || !backpackView) return null
  const upgradeTo = nextTier(tier)
  if (!upgradeTo) return null

  const candidates: Array<{ id: string; inBattle: boolean; size: ItemSizeNorm }> = []
  for (const it of battleSystem.getAllItems()) {
    if (it.defId === defId && (instanceToTier.get(it.instanceId) ?? 'Bronze') === tier) {
      candidates.push({ id: it.instanceId, inBattle: true, size: it.size })
    }
  }
  for (const it of backpackSystem.getAllItems()) {
    if (it.defId === defId && (instanceToTier.get(it.instanceId) ?? 'Bronze') === tier) {
      candidates.push({ id: it.instanceId, inBattle: false, size: it.size })
    }
  }
  if (candidates.length === 0) return null

  const target = candidates[0]!
  instanceToTier.set(target.id, upgradeTo)
  if (target.inBattle) {
    battleView.setItemTier(target.id, upgradeTo)
    drag?.refreshZone(battleView)
  } else {
    backpackView.setItemTier(target.id, upgradeTo)
    drag?.refreshZone(backpackView)
  }
  applyInstanceTierVisuals()
  syncShopOwnedTierRules()
  refreshUpgradeHints()
  return {
    instanceId: target.id,
    targetZone: target.inBattle ? 'battle' : 'backpack',
    fromTier: tier,
    toTier: upgradeTo,
    targetSize: target.size,
  }
}

function getItemStageCenter(
  system: GridSystem,
  view: GridZone,
  instanceId: string,
): { x: number; y: number } | null {
  const it = system.getItem(instanceId)
  if (!it) return null
  const w = it.size === '2x2' ? CELL_SIZE * 2 : CELL_SIZE
  const h = (it.size === '1x2' || it.size === '2x2') ? CELL_SIZE * 2 : CELL_SIZE
  const sx = view.scale.x || 1
  const sy = view.scale.y || 1
  return {
    x: view.x + (it.col * CELL_SIZE + w / 2) * sx,
    y: view.y + (it.row * CELL_SIZE + h / 2) * sy,
  }
}

function getSynthesisFlyTarget(result: SynthesizeResult): { x: number; y: number } {
  if (result.targetZone === 'battle' && battleSystem && battleView) {
    return getItemStageCenter(battleSystem, battleView, result.instanceId)
      ?? { x: battleView.x + battleView.activeColCount * CELL_SIZE * (battleView.scale.x || 1) * 0.5, y: battleView.y + CELL_SIZE * (battleView.scale.y || 1) }
  }
  if (result.targetZone === 'backpack' && backpackSystem && backpackView && showingBackpack) {
    return getItemStageCenter(backpackSystem, backpackView, result.instanceId)
      ?? { x: backpackView.x + 2.5 * CELL_SIZE * (backpackView.scale.x || 1), y: backpackView.y + CELL_SIZE * (backpackView.scale.y || 1) }
  }
  return { x: getDebugCfg('backpackBtnX'), y: getDebugCfg('backpackBtnY') }
}

async function playSynthesisAnimation(stage: Container, slot: { item: { id: string; name_cn: string } }, result: SynthesizeResult): Promise<void> {
  const layer = new Container()
  const mask = new Graphics()
  mask.rect(0, 0, CANVAS_W, CANVAS_H)
  mask.fill({ color: 0x000000, alpha: 0.55 })
  mask.eventMode = 'static'
  layer.addChild(mask)

  const upColor = TIER_COLORS[result.toTier] ?? 0xffe88a
  const synthTitleFontSize = getDebugCfg('synthTitleFontSize')
  const synthNameFontSize = getDebugCfg('synthNameFontSize')

  const title = new Text({
    text: `合成升级  ${TIER_LABEL_CN[result.fromTier]} → ${TIER_LABEL_CN[result.toTier]}`,
    style: { fontSize: synthTitleFontSize, fill: upColor, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  title.x = (CANVAS_W - title.width) / 2
  title.y = CANVAS_H * 0.35
  layer.addChild(title)

  const nameT = new Text({
    text: slot.item.name_cn,
    style: { fontSize: synthNameFontSize, fill: 0xdde3ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  nameT.x = (CANVAS_W - nameT.width) / 2
  nameT.y = title.y + 48
  layer.addChild(nameT)

  const iconWrap = new Container()
  const targetScale = result.targetZone === 'battle'
    ? (battleView?.scale.x ?? 1)
    : (backpackView?.scale.x ?? 1)
  const targetW = (result.targetSize === '2x2' ? CELL_SIZE * 2 : CELL_SIZE) * targetScale
  const targetH = ((result.targetSize === '1x2' || result.targetSize === '2x2') ? CELL_SIZE * 2 : CELL_SIZE) * targetScale
  const iconW = Math.min(220, Math.max(72, targetW))
  const iconH = Math.min(220, Math.max(72, targetH))

  const bg = new Graphics()
  bg.roundRect(0, 0, iconW, iconH, 12)
  bg.fill({ color: 0x1f2238, alpha: 0.96 })
  bg.stroke({ color: upColor, width: 3, alpha: 0.95 })
  iconWrap.addChild(bg)

  const sp = new Sprite(Texture.WHITE)
  sp.width = Math.max(1, iconW - 12)
  sp.height = Math.max(1, iconH - 12)
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

  const target = getSynthesisFlyTarget(result)
  const startX = iconWrap.x
  const startY = iconWrap.y
  const pauseMs = getDebugCfg('synthPauseMs')
  const flyMs = getDebugCfg('synthFlyMs')
  const startMs = Date.now()
  const total = pauseMs + flyMs

  await new Promise<void>((resolve) => {
    const tick = () => {
      const elapsed = Date.now() - startMs
      if (elapsed <= pauseMs) {
        const p = pauseMs <= 0 ? 1 : Math.min(elapsed / pauseMs, 1)
        iconWrap.scale.set(1 + 0.12 * Math.sin(p * Math.PI))
      } else {
        const p = Math.min((elapsed - pauseMs) / Math.max(1, flyMs), 1)
        const ease = 1 - Math.pow(1 - p, 3)
        iconWrap.scale.set(1 - 0.45 * ease)
        iconWrap.x = startX + (target.x - iconW / 2 - startX) * ease
        iconWrap.y = startY + (target.y - iconH / 2 - startY) * ease
        mask.alpha = 0.55 - 0.45 * ease
        title.alpha = 1 - ease
        nameT.alpha = 1 - ease
      }
      if (elapsed >= total) {
        Ticker.shared.remove(tick)
        stage.removeChild(layer)
        layer.destroy({ children: true })
        resolve()
      }
    }
    Ticker.shared.add(tick)
  })
}

// ============================================================
// 小地图
// ============================================================
function updateMiniMap(): void {
  if (!miniMapGfx || !backpackSystem) return
  const g = miniMapGfx
  g.clear()
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 5; c++) {
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
}

// ---- Day 辅助 ----

function getDayActiveCols(day: number): number {
  const slots = getConfig().dailyBattleSlots
  if (day <= 2) return slots[0]! / 2   // Day1-2 → 2列
  if (day <= 5) return slots[1]! / 2   // Day3-5 → 3列
  if (day <= 8) return slots[2]! / 2   // Day6-8 → 4列
  return             slots[3]! / 2     // Day9-10 → 5列
}

function getBattleZoneX(activeCols: number): number {
  const s = getConfig().itemVisualScale
  // 先把缩小后的 5x2 区域居中在原 5x2 盒子内，再对 activeCols 做居中偏移
  const base = getDebugCfg('battleZoneX') + (5 * CELL_SIZE * (1 - s)) / 2
  return base + (5 - activeCols) / 2 * CELL_SIZE * s
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
  dayPrevBtn.x = 0
  dayDebugText.x = dayPrevBtn.width + gap
  dayNextBtn.x = dayDebugText.x + dayDebugText.width + gap
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
    price: getDebugCfg('itemInfoPriceFontSize'),
    desc:  getDebugCfg('itemInfoDescFontSize'),
  })
  const panelBottomY = getDebugCfg('shopAreaY') - getDebugCfg('itemInfoBottomGapToShop')
  sellPopup.setBottomAnchor(panelBottomY)
}

function applyTextSizesFromDebug(): void {
  const buttonSize = getDebugCfg('shopButtonLabelFontSize')
  const sellSubSize = getDebugCfg('sellButtonSubPriceFontSize')
  const areaLabelSize = getDebugCfg('gridZoneLabelFontSize')

  const setBtnTextSize = (handle: CircleBtnHandle | null): void => {
    if (!handle) return
    const main = handle.container.getChildByName('btn-main') as Text | null
    const sub = handle.container.getChildByName('sell-price') as Text | null
    if (main) main.style.fontSize = buttonSize
    if (sub) sub.style.fontSize = sellSubSize
    handle.redraw(handle.container.visible)
  }

  setBtnTextSize(bpBtnHandle)
  setBtnTextSize(refreshBtnHandle)
  setBtnTextSize(sellBtnHandle)

  if (refreshCostText) refreshCostText.style.fontSize = getDebugCfg('refreshCostFontSize')
  if (goldText) goldText.style.fontSize = getDebugCfg('goldFontSize')
  if (dayPrevBtn) dayPrevBtn.style.fontSize = getDebugCfg('dayDebugArrowFontSize')
  if (dayNextBtn) dayNextBtn.style.fontSize = getDebugCfg('dayDebugArrowFontSize')
  if (dayDebugText) dayDebugText.style.fontSize = getDebugCfg('dayDebugLabelFontSize')
  layoutDayDebugControls()

  battleView?.setLabelFontSize(areaLabelSize / (battleView.scale.x || 1))
  backpackView?.setLabelFontSize(areaLabelSize / (backpackView.scale.x || 1))
  shopPanel?.setLabelFontSize(areaLabelSize / (shopPanel.scale.x || 1))

  shopPanel?.setTextSizes({
    itemName: getDebugCfg('shopItemNameFontSize'),
    itemPrice: getDebugCfg('shopItemPriceFontSize'),
    itemBought: getDebugCfg('shopItemBoughtFontSize'),
  })

  sellPopup?.setTextSizes({
    name: getDebugCfg('itemInfoNameFontSize'),
    tier: getDebugCfg('itemInfoTierFontSize'),
    price: getDebugCfg('itemInfoPriceFontSize'),
    desc: getDebugCfg('itemInfoDescFontSize'),
  })
}

function applyAreaLabelLeftAlign(): void {
  battleView?.setLabelGlobalLeft(AREA_LABEL_LEFT_X)
  backpackView?.setLabelGlobalLeft(AREA_LABEL_LEFT_X)
  shopPanel?.setLabelGlobalLeft(AREA_LABEL_LEFT_X)
}

function applyLayoutFromDebug(): void {
  const s = getConfig().itemVisualScale

  if (shopPanel) {
    shopPanel.x = getDebugCfg('shopAreaX')
    shopPanel.y = getDebugCfg('shopAreaY')
    shopPanel.setTierBorderWidth(getDebugCfg('tierBorderWidth'))
    shopPanel.setCornerRadius(getDebugCfg('gridItemCornerRadius'))
  }
  if (battleView) {
    battleView.scale.set(s)
    battleView.x = getBattleZoneX(getDayActiveCols(currentDay))
    battleView.y = getDebugCfg('battleZoneY') + (2 * CELL_SIZE * (1 - s)) / 2
    battleView.setTierBorderWidth(getDebugCfg('tierBorderWidth'))
    battleView.setCornerRadius(getDebugCfg('gridItemCornerRadius'))
    battleView.setCellBorderWidth(getDebugCfg('gridCellBorderWidth'))
  }
  if (backpackView) {
    backpackView.scale.set(s)
    backpackView.x = getDebugCfg('backpackZoneX') + (5 * CELL_SIZE * (1 - s)) / 2
    backpackView.y = getDebugCfg('backpackZoneY') + (2 * CELL_SIZE * (1 - s)) / 2
    backpackView.setTierBorderWidth(getDebugCfg('tierBorderWidth'))
    backpackView.setCornerRadius(getDebugCfg('gridItemCornerRadius'))
    backpackView.setCellBorderWidth(getDebugCfg('gridCellBorderWidth'))
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
  if (goldText) {
    goldText.x = getDebugCfg('goldTextCenterX') - goldText.width / 2
    goldText.y = getDebugCfg('goldTextY')
  }
  if (dayDebugCon) {
    dayDebugCon.x = getDebugCfg('dayDebugX')
    dayDebugCon.y = getDebugCfg('dayDebugY')
  }
  if (miniMapCon) {
    miniMapCon.x = getDebugCfg('backpackBtnX') - MINI_W / 2
    miniMapCon.y = getDebugCfg('backpackBtnY') + BTN_RADIUS + 8
  }

  // 商店区 / 背包区轻色背景（整块区域罩住：含标题 + 内容）
  const bgCorner = getDebugCfg('gridItemCornerRadius') + 8
  if (shopAreaBg && shopPanel) {
    const left   = AREA_LABEL_LEFT_X - 10
    const top    = shopPanel.y - 42
    const width  = getDebugCfg('shopAreaBgWidth')
    const height = getDebugCfg('shopAreaBgHeight')
    shopAreaBg.clear()
    shopAreaBg.roundRect(left, top, Math.max(1, width), Math.max(1, height), bgCorner)
    shopAreaBg.fill({ color: 0x3a456a, alpha: 0.20 })
    shopAreaBg.visible = !showingBackpack
  }
  if (backpackAreaBg && backpackView) {
    const left   = AREA_LABEL_LEFT_X - 10
    const top    = backpackView.y - 42
    const width  = getDebugCfg('backpackAreaBgWidth')
    const height = getDebugCfg('backpackAreaBgHeight')
    backpackAreaBg.clear()
    backpackAreaBg.roundRect(left, top, Math.max(1, width), Math.max(1, height), bgCorner)
    backpackAreaBg.fill({ color: 0x3a456a, alpha: 0.20 })
    backpackAreaBg.visible = showingBackpack
  }

  applyTextSizesFromDebug()
  applyItemInfoPanelLayout()
  applyAreaLabelLeftAlign()
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
  if (row + h > 2) return false
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
  const w = size === '2x2' ? 2 : 1
  const h = (size === '1x2' || size === '2x2') ? 2 : 1
  const maxCol = battleView.activeColCount - w
  const maxRow = 2 - h
  if (maxCol < 0 || maxRow < 0) return false

  for (let row = 0; row <= maxRow; row++) {
    for (let col = 0; col <= maxCol; col++) {
      const finalRow = size !== '1x1' ? 0 : row
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
    if (hasAnyPlaceInVisibleCols(backpackSystem, backpackView, size)) return true
    return canBackpackAcceptByAutoPack('__incoming__', size)
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
      const bh  = 2 * CELL_SIZE * s
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

type BackpackAutoPackPlan = {
  existing: PackPlacement[]
  incoming: { col: number; row: number }
}

function buildBackpackAutoPackPlan(incomingDefId: string, incomingSize: ItemSizeNorm): BackpackAutoPackPlan | null {
  if (!backpackSystem || !backpackView) return null
  const items: PackItem[] = backpackSystem.getAllItems().map(item => ({
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
  const plan = planAutoPack(items, backpackView.activeColCount, backpackSystem.rows)
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
  const w = size === '2x2' ? 2 : 1
  const h = (size === '1x2' || size === '2x2') ? 2 : 1
  const blockers = new Set<string>()
  for (let c = col; c < col + w; c++) {
    for (let r = row; r < row + h; r++) {
      for (const it of battleSystem.getAllItems()) {
        const iw = it.size === '2x2' ? 2 : 1
        const ih = (it.size === '1x2' || it.size === '2x2') ? 2 : 1
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
  const base: PackItem[] = backpackSystem.getAllItems().map((it) => ({
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
  return planAutoPack(base, backpackView.activeColCount, backpackSystem.rows)
}

function applyBackpackPlanWithTransferred(plan: PackPlacement[], transferredIds: Set<string>): void {
  if (!backpackSystem || !backpackView || !battleSystem || !battleView) return

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
}

function _isOverSellBtn(gx: number, gy: number): boolean {
  const cx = getDebugCfg('sellBtnX')
  const cy = getDebugCfg('sellBtnY')
  const r  = BTN_RADIUS + 24
  return (gx - cx) ** 2 + (gy - cy) ** 2 <= r * r
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
  if (!shopManager) return
  clearSelection()
  const slot = shopManager.pool[slotIndex]
  if (!slot || slot.purchased || !shopManager.canBuy(slot)) return

  const visScale = getConfig().itemVisualScale

  const size  = normalizeSize(slot.item.size)
  const iconW = size === '2x2' ? CELL_SIZE * 2 : CELL_SIZE
  const iconH = (size === '1x2' || size === '2x2') ? CELL_SIZE * 2 : CELL_SIZE

  const floater   = new Container()
  const tier      = slot.tier
  const tierColor = TIER_COLORS[tier] ?? 0x4a6fa5

  const bg = new Graphics()
  bg.roundRect(0, 0, iconW, iconH, getDebugCfg('gridItemCornerRadius'))
  bg.fill({ color: 0x1e1e2e, alpha: 0.92 })
  bg.stroke({ color: tierColor, width: 2.5, alpha: 0.9 })
  floater.addChild(bg)

  const sp = new Sprite(Texture.WHITE)
  sp.width = iconW - 10; sp.height = iconH - 10
  sp.x = 5; sp.y = 5; sp.alpha = 0
  floater.addChild(sp)
  Assets.load<Texture>(getItemIconUrl(slot.item.id))
    .then(tex => { sp.texture = tex; sp.alpha = 0.9 })
    .catch((err) => { console.warn('[ShopScene] 拖拽浮层图标加载失败', slot.item.id, err) })

  const offsetY = getDebugCfg('dragYOffset')
  const s = visScale * 1.06
  floater.scale.set(s)
  floater.x = e.globalX - (iconW * s) / 2
  floater.y = e.globalY + offsetY - (iconH * s) / 2
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

  const canSynth = hasSynthesisTarget(slot.item.id, slot.tier)
  startFlashEffect(stage, size, canSynth)
}

// ============================================================
// 商店拖拽：移动
// ============================================================
function onShopDragMove(e: FederatedPointerEvent): void {
  if (!shopDragFloater || !shopDragSize) return
  if (e.pointerId !== shopDragPointerId) return

  const dragSlot = shopManager?.pool[shopDragSlotIdx]
  const canSynth = !!(dragSlot && hasSynthesisTarget(dragSlot.item.id, dragSlot.tier))

  const visScale = getConfig().itemVisualScale
  const s = visScale * 1.06

  const iconW   = shopDragSize === '2x2' ? CELL_SIZE * 2 : CELL_SIZE
  const iconH   = shopDragSize === '1x2' ? CELL_SIZE * 2 : CELL_SIZE
  const offsetY = getDebugCfg('dragYOffset')
  shopDragFloater.scale.set(s)
  shopDragFloater.x = e.globalX - (iconW * s) / 2
  shopDragFloater.y = e.globalY + offsetY - (iconH * s) / 2

  const gx = e.globalX, gy = e.globalY
  const battleCell = battleView?.pixelToCellForItem(gx, gy, shopDragSize, 0)
  if (battleCell && battleSystem) {
    const finalRow = shopDragSize !== '1x1' ? 0 : battleCell.row
    let canDirect = canPlaceInVisibleCols(battleSystem, battleView!, battleCell.col, finalRow, shopDragSize)
    let usedSwapFlow = false

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
        usedSwapFlow = true
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
        if (canReplaceToBackpack) usedSwapFlow = true
      }
    }

    battleView!.highlightCells(
      battleCell.col,
      battleCell.row,
      shopDragSize,
      canDirect || canReplaceToBackpack,
      (canSynth || usedSwapFlow) ? SWAP_HIGHLIGHT_COLOR : undefined,
    )
  } else {
    battleView?.clearHighlight()
  }

  if (backpackView?.visible) {
    const bpCell = backpackView.pixelToCellForItem(gx, gy, shopDragSize, 0)
    if (bpCell && backpackSystem) {
      const canAutoPack = canBackpackAcceptByAutoPack('__incoming__', shopDragSize)
      backpackView.highlightCells(bpCell.col, bpCell.row, shopDragSize,
        canPlaceInVisibleCols(backpackSystem, backpackView, bpCell.col, bpCell.row, shopDragSize) || canAutoPack)
    } else {
      backpackView.clearHighlight()
    }
  }
}

// ============================================================
// 商店拖拽：结束
// ============================================================
async function onShopDragEnd(e: FederatedPointerEvent, stage: Container): Promise<void> {
  if (!shopDragFloater || shopDragSlotIdx < 0 || !shopDragSize) return
  if (e.pointerId !== shopDragPointerId) return

  const slot = shopManager?.pool[shopDragSlotIdx]

  stage.removeChild(shopDragFloater)
  shopDragFloater.destroy({ children: true })
  shopDragFloater = null
  stopFlashEffect()
  battleView?.clearHighlight()
  backpackView?.clearHighlight()

  if (!slot || !shopManager || !shopDragSize) { _resetDrag(); return }

  const gx = e.globalX, gy = e.globalY
  const size = shopDragSize
  const canSynth = hasSynthesisTarget(slot.item.id, slot.tier)
  const battleCell = battleView?.pixelToCellForItem(gx, gy, size, 0)
  const bpCell = backpackView?.visible ? backpackView.pixelToCellForItem(gx, gy, size, 0) : null
  const overBattleArea = isPointInZoneArea(battleView, gx, gy)
  const onBpBtn = _isOverBpBtn(gx, gy)

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
      || (canSynth && overBattleArea)
    )
  ) {
    if (shopManager.buy(slot)) {
      const synth = trySynthesizeOwned(slot.item.id, slot.tier)
      if (synth) {
        console.log(`[ShopScene] 合成升级 ${slot.item.name_cn} ${slot.tier} -> ${synth.toTier}`)
        await playSynthesisAnimation(stage, slot, synth)
      } else {
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
        console.log(`[ShopScene] 购买→战斗区 ${slot.item.name_cn}，金币: ${shopManager.gold}`)
      }
      refreshShopUI()
    }
    _resetDrag(); return
  }

  // 背包区放置
  if (bpCell || onBpBtn) {
    let autoPlan: ReturnType<typeof buildBackpackAutoPackPlan> | null = null
    if (!canSynth) {
      autoPlan = buildBackpackAutoPackPlan(slot.item.id, size)
      if (!autoPlan) {
        console.log('[ShopScene] 背包已满')
        _resetDrag(); return
      }
    }

    if (!shopManager.buy(slot)) {
      console.log('[ShopScene] 金币不足')
      _resetDrag(); return
    }

    const synth = canSynth ? trySynthesizeOwned(slot.item.id, slot.tier) : null
    if (synth) {
      console.log(`[ShopScene] 合成升级 ${slot.item.name_cn} ${slot.tier} -> ${synth.toTier}`)
      await playSynthesisAnimation(stage, slot, synth)
    } else {
      const resolvedPlan = autoPlan ?? buildBackpackAutoPackPlan(slot.item.id, size)
      if (!resolvedPlan) {
        // 理论上不应发生（已在 buy 前校验）；兜底处理
        console.log('[ShopScene] 背包已满（购买后兜底）')
        refreshShopUI()
        _resetDrag(); return
      }
      const id = nextId()
      applyBackpackAutoPackExisting(resolvedPlan.existing)
      backpackSystem!.place(resolvedPlan.incoming.col, resolvedPlan.incoming.row, size, slot.item.id, id)
      backpackView!.addItem(id, slot.item.id, size, resolvedPlan.incoming.col, resolvedPlan.incoming.row, slot.tier)
        .then(() => {
          backpackView!.setItemTier(id, slot.tier)
          drag?.refreshZone(backpackView!)
        })
      instanceToDefId.set(id, slot.item.id)
      instanceToTier.set(id, slot.tier)
      console.log(`[ShopScene] 自动整理后购买→背包 ${slot.item.name_cn}，金币: ${shopManager.gold}`)
    }

    refreshShopUI()
  }

  _resetDrag()
}

function _resetDrag(): void {
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
  return (gx - cx) ** 2 + (gy - cy) ** 2 <= r * r
}

function isPointInZoneArea(view: GridZone | null, gx: number, gy: number): boolean {
  if (!view || !view.visible) return false
  const sx = view.scale.x || 1
  const sy = view.scale.y || 1
  const w = view.activeColCount * CELL_SIZE * sx
  const h = 2 * CELL_SIZE * sy
  return gx >= view.x && gx <= view.x + w && gy >= view.y && gy <= view.y + h
}

// ============================================================
// 测试物品：背包预置初始物品
// ============================================================
function placeInitialItems(): void {
  const items  = getAllItems()
  const pick   = (s: string, n: number) =>
    items.filter(i => i.size.toLowerCase().includes(s)).slice(0, n)

  const small  = pick('small',  4)
  const medium = pick('medium', 1)

  const bpItems = [
    { defId: small[0]?.id ?? '',  rawSize: 'Small / 小型',  col: 0, row: 0 },
    { defId: small[1]?.id ?? '',  rawSize: 'Small / 小型',  col: 1, row: 0 },
    { defId: small[2]?.id ?? '',  rawSize: 'Small / 小型',  col: 2, row: 0 },
    { defId: medium[0]?.id ?? '', rawSize: 'Medium / 中型', col: 3, row: 0 },
    { defId: small[3]?.id ?? '',  rawSize: 'Small / 小型',  col: 0, row: 1 },
  ]

  for (const bp of bpItems) {
    if (!bp.defId) continue
    const id   = nextId()
    const norm = normalizeSize(bp.rawSize)
    backpackSystem!.place(bp.col, bp.row, norm, bp.defId, id)
    backpackView!.addItem(id, bp.defId, norm, bp.col, bp.row)
      .then(() => drag?.refreshZone(backpackView!))
    instanceToDefId.set(id, bp.defId)
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

    shopManager = new ShopManager(cfg, items, 1)

    // 顶部分区背景（商店 / 背包）
    shopAreaBg = new Graphics()
    stage.addChild(shopAreaBg)
    backpackAreaBg = new Graphics()
    stage.addChild(backpackAreaBg)

    // 商店面板
    shopPanel = new ShopPanelView()
    shopPanel.x = getDebugCfg('shopAreaX')
    shopPanel.y = getDebugCfg('shopAreaY')
    shopPanel.onDragStart = (slotIndex, e) => startShopDrag(slotIndex, e, stage)
    stage.addChild(shopPanel)

    // 格子系统
    const activeCols = cfg.dailyBattleSlots[0]! / 2
    battleSystem   = new GridSystem(5)
    backpackSystem = new GridSystem(5)
    battleView     = new GridZone('战斗区', 5, activeCols)
    backpackView   = new GridZone('背包', 5, 5)
    backpackView.setAutoPackEnabled(false)
    battleView.x   = getBattleZoneX(activeCols)
    battleView.y   = getDebugCfg('battleZoneY')
    backpackView.x = getDebugCfg('backpackZoneX')
    backpackView.y = getDebugCfg('backpackZoneY')
    backpackView.visible = false

    GridZone.makeStageInteractive(stage, CANVAS_W, CANVAS_H)
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
        instanceToDefId.delete(instanceId)
        const tier = getInstanceTier(instanceId)
        instanceToTier.delete(instanceId)
        const gained = shopManager.sellItem(item, tier)
        console.log(`[ShopScene] 拖拽出售 ${item.name_cn} +${gained}G，金币: ${shopManager.gold}`)
        refreshShopUI()
        return true
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
        if (!autoPlan) return false
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
    drag.onDragMove = () => {
      // 可用状态随时重算（例如拖拽过程中背包可见状态变化）
      if (gridDragCanToBackpack) {
        gridDragCanToBackpack = !showingBackpack
      }
    }
    drag.onDragEnd = () => {
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
    ): CircleBtnHandle {
      const g   = new Graphics()
      const txt = new Text({
        text: label,
        style: { fontSize: cfg.textSizes.shopButtonLabel, fill: 0xeebbbb, fontFamily: 'Arial', fontWeight: 'bold' },
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

    // 背包按钮（左）
    const bpBtn = makeCircleBtn(getDebugCfg('backpackBtnX'), getDebugCfg('backpackBtnY'), '背包', 0x44aaff, 0x44aaff)
    bpBtn.container.on('pointerdown', () => {
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
      clearSelection()
      syncShopOwnedTierRules()
      if (shopManager!.refresh()) {
        console.log(`[ShopScene] 刷新，剩余: ${shopManager!.gold}G`)
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
      if (!selectedSellAction) return
      selectedSellAction()
      clearSelection()
      refreshShopUI()
    })
    sellBtnHandle = sellBtn
    btnRow.addChild(sellBtn.container)

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
        instanceToDefId.delete(instanceId)
        instanceToTier.delete(instanceId)
        manager.sellItem(item, tier)
        drag?.refreshZone(view)
        console.log(`[ShopScene] 出售 ${item.name_cn} +${sellPrice}G，金币: ${manager.gold}`)
      }

      setSellButtonPrice(sellPrice)
      applySellButtonState()
    }

    const handleShopSlotTap = (slotIndex: number) => {
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

    backpackView.onTap = (id) => selectGridItem(id, backpackSystem!, backpackView!, 'backpack')
    battleView.onTap   = (id) => selectGridItem(id, battleSystem!,   battleView!, 'battle')
    shopPanel.onTap    = (slotIndex) => handleShopSlotTap(slotIndex)

    sellPopup = new SellPopup(CANVAS_W, CANVAS_H)
    stage.addChild(sellPopup)
    applyLayoutFromDebug()

    offDebugCfg = onDebugCfgChange((key) => {
      if (
        key === 'shopAreaX' || key === 'shopAreaY'
        || key === 'battleZoneX' || key === 'battleZoneY'
        || key === 'backpackZoneX' || key === 'backpackZoneY'
        || key === 'backpackBtnX' || key === 'backpackBtnY'
        || key === 'sellBtnX' || key === 'sellBtnY'
        || key === 'refreshBtnX' || key === 'refreshBtnY'
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
        || key === 'sellButtonSubPriceFontSize'
        || key === 'refreshCostFontSize'
        || key === 'goldFontSize'
        || key === 'dayDebugArrowFontSize'
        || key === 'dayDebugLabelFontSize'
        || key === 'shopItemNameFontSize'
        || key === 'shopItemPriceFontSize'
        || key === 'shopItemBoughtFontSize'
        || key === 'itemInfoNameFontSize'
        || key === 'itemInfoTierFontSize'
        || key === 'itemInfoPriceFontSize'
        || key === 'itemInfoDescFontSize'
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
    stage.on('pointermove',      (e: FederatedPointerEvent) => { if (shopDragFloater) onShopDragMove(e) })
    stage.on('pointerup',        (e: FederatedPointerEvent) => { if (shopDragFloater) void onShopDragEnd(e, stage) })
    stage.on('pointerupoutside', (e: FederatedPointerEvent) => { if (shopDragFloater) void onShopDragEnd(e, stage) })

    // Debug 天数控制
    dayDebugCon = new Container()
    dayDebugCon.x = getDebugCfg('dayDebugX')
    dayDebugCon.y = getDebugCfg('dayDebugY')

    const prevDayBtn = new Text({ text: '◀', style: { fontSize: cfg.textSizes.dayDebugArrow, fill: 0x888888 } })
    prevDayBtn.eventMode = 'static'
    prevDayBtn.cursor    = 'pointer'
    prevDayBtn.on('pointerdown', (e: FederatedPointerEvent) => { e.stopPropagation(); setDay(currentDay - 1) })

    dayDebugText = new Text({
      text: `Day ${currentDay}`,
      style: { fontSize: cfg.textSizes.dayDebugLabel, fill: 0xcccccc, fontFamily: 'Arial' },
    })

    const nextDayBtn = new Text({ text: '▶', style: { fontSize: cfg.textSizes.dayDebugArrow, fill: 0x888888 } })
    nextDayBtn.eventMode = 'static'
    nextDayBtn.cursor    = 'pointer'
    nextDayBtn.on('pointerdown', (e: FederatedPointerEvent) => { e.stopPropagation(); setDay(currentDay + 1) })

    dayDebugCon.addChild(prevDayBtn, dayDebugText, nextDayBtn)
    stage.addChild(dayDebugCon)
    dayPrevBtn = prevDayBtn
    dayNextBtn = nextDayBtn
    layoutDayDebugControls()

    placeInitialItems()
    refreshShopUI()
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
    if (btnRow)       stage.removeChild(btnRow)
    if (dayDebugCon)  stage.removeChild(dayDebugCon)

    if (onStageTapHidePopup) {
      stage.off('pointerdown', onStageTapHidePopup)
      onStageTapHidePopup = null
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

    drag?.destroy()
    shopManager   = null; shopPanel    = null; sellPopup = null
    btnRow        = null
    goldText      = null; miniMapGfx   = null; miniMapCon = null
    shopAreaBg    = null; backpackAreaBg = null
    bpBtnHandle   = null; refreshBtnHandle = null; sellBtnHandle = null
    refreshCostText = null
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
  },

  update(_dt: number) {},
}
