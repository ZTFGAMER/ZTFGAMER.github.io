// ============================================================
// ShopRewardSystem — 升级奖励、经验飞行、待领取队列
// 提取自 ShopScene.ts Phase 8 Batch D
// 包含：flyRewardToGridSlot、checkAndPopPendingRewards、grantSynthesisExp
// ============================================================

import type {
  ShopSceneCtx,
  SavedLevelQuickDraftEntry,
  SavedLevelQuickDraftCandidate,
} from '../ShopSceneContext'
import { getApp } from '@/core/AppContext'
import { GridSystem } from '@/common/grid/GridSystem'
import { GridZone } from '@/common/grid/GridZone'
import { CELL_SIZE, CELL_HEIGHT } from '@/common/grid/GridZone'
import { Graphics, Ticker, Container, Text } from 'pixi.js'
import { getConfig as getGameConfig } from '@/core/DataLoader'
import { normalizeSize } from '@/common/items/ItemDef'
import {
  nextId,
  instanceToDefId,
  instanceToPermanentDamageBonus,
  getInstanceTier,
  getInstanceTierStar,
  levelFromLegacyTierStar,
  setInstanceQualityLevel,
} from './ShopInstanceRegistry'
import { getItemDefById, getMinTierDropWeight } from './ShopSynthesisLogic'
import { getNeutralSpecialKind } from '../panels/NeutralItemPanel'
import type { NeutralSpecialKind, NeutralChoiceCandidate } from '../panels/NeutralItemPanel'
import { captureShopState, saveShopStateToStorage } from '../ShopStateStorage'
import {
  clampPlayerLevel,
  getPlayerLevelCap,
  getPlayerExpNeedByLevel,
  playPlayerLevelUpFx,
  playSynthesisExpFlyEffect,
} from '../ui/PlayerStatusUI'
import { getPlayerProgressState, setPlayerProgressState } from '@/core/RunState'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { CANVAS_W, CANVAS_H } from '@/config/layoutConstants'
import { type ToastReason, showHintToast } from '../ui/ShopToastSystem'
import { findFirstBackpackPlace } from './ShopGridInventory'
import { collectPoolCandidatesByLevel } from './QuickBuySystem'
import { toVisualTier } from '../ShopMathHelpers'
import { stopFlashEffect } from '../ui/ShopAnimationEffects'
import { applySellButtonState } from './ShopDragSystem'
import { getDefaultItemInfoMode } from '../ShopModeHelpers'

// ---- 公共类型 ----

export type RewardSystemCallbacks = {
  lockBackpackRewardCell: (col: number, row: number) => void
  unlockBackpackRewardCell: (col: number, row: number) => void
  recordLevelRewardObtained: (kind: NeutralSpecialKind) => void
  recordNeutralItemObtained: (defId: string) => void
  unlockItemToPool: (defId: string) => void
  checkAndPopPendingHeroPeriodicRewards: () => void
  rollLevelRewardDefIds: (level: number) => string[]
  findFirstBattlePlace: (size: ReturnType<typeof normalizeSize>) => { col: number; row: number } | null
  findFirstBackpackPlace: (size: ReturnType<typeof normalizeSize>) => { col: number; row: number } | null
  setTransitionInputEnabled: (enabled: boolean) => void
  setBaseShopPrimaryButtonsVisible: (visible: boolean) => void
  applyPhaseInputLock: () => void
}

type QuickDraftCandidate = {
  defId: string
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7
  tier: 'Bronze' | 'Silver' | 'Gold' | 'Diamond'
  star: 1 | 2
}

type QuickDraftQueueEntry = {
  picks: QuickDraftCandidate[]
  title: string
  consumePickedAsReward: boolean
  onPicked?: (picked: QuickDraftCandidate) => void
}

function isPersistableQuickDraftEntry(entry: QuickDraftQueueEntry | null | undefined): entry is QuickDraftQueueEntry {
  return !!entry && entry.consumePickedAsReward === true && !entry.onPicked && entry.picks.length > 0
}

function toSavedQuickDraftCandidate(pick: QuickDraftCandidate): SavedLevelQuickDraftCandidate {
  return {
    defId: pick.defId,
    level: pick.level,
    tier: pick.tier,
    star: pick.star,
  }
}

function toSavedQuickDraftEntry(entry: QuickDraftQueueEntry): SavedLevelQuickDraftEntry {
  return {
    title: entry.title.trim().length > 0 ? entry.title.trim() : '升级奖励',
    picks: entry.picks.slice(0, 3).map((pick) => toSavedQuickDraftCandidate(pick)),
  }
}

function fromSavedQuickDraftEntry(entry: SavedLevelQuickDraftEntry): QuickDraftQueueEntry {
  return {
    title: entry.title.trim().length > 0 ? entry.title.trim() : '升级奖励',
    picks: entry.picks.slice(0, 3).map((pick) => ({
      defId: pick.defId,
      level: pick.level,
      tier: pick.tier,
      star: pick.star,
    })),
    consumePickedAsReward: true,
  }
}

function syncPersistedQuickDraftEntries(ctx: ShopSceneCtx): void {
  const out: SavedLevelQuickDraftEntry[] = []
  if (ctx.levelQuickRewardInstanceIds.size > 0) {
    const active = getLevelQuickRewardActiveEntry(ctx)
    if (isPersistableQuickDraftEntry(active)) out.push(toSavedQuickDraftEntry(active))
  }
  const queue = getLevelQuickRewardQueue(ctx)
  for (const entry of queue) {
    if (!isPersistableQuickDraftEntry(entry)) continue
    out.push(toSavedQuickDraftEntry(entry))
  }
  ctx.levelQuickDraftSavedEntries = out
}

const levelQuickRewardQueueByCtx = new WeakMap<ShopSceneCtx, QuickDraftQueueEntry[]>()
const levelQuickRewardActiveEntryByCtx = new WeakMap<ShopSceneCtx, QuickDraftQueueEntry | null>()
const levelQuickRewardActivePickByInstanceIdByCtx = new WeakMap<ShopSceneCtx, Map<string, QuickDraftCandidate>>()

function getLevelQuickRewardQueue(ctx: ShopSceneCtx): QuickDraftQueueEntry[] {
  const existing = levelQuickRewardQueueByCtx.get(ctx)
  if (existing) return existing
  const created: QuickDraftQueueEntry[] = []
  levelQuickRewardQueueByCtx.set(ctx, created)
  return created
}

function setLevelQuickRewardActiveEntry(ctx: ShopSceneCtx, entry: QuickDraftQueueEntry | null): void {
  levelQuickRewardActiveEntryByCtx.set(ctx, entry)
}

function getLevelQuickRewardActiveEntry(ctx: ShopSceneCtx): QuickDraftQueueEntry | null {
  return levelQuickRewardActiveEntryByCtx.get(ctx) ?? null
}

function setLevelQuickRewardActivePickByInstanceId(ctx: ShopSceneCtx, map: Map<string, QuickDraftCandidate>): void {
  levelQuickRewardActivePickByInstanceIdByCtx.set(ctx, map)
}

function getLevelQuickRewardActivePickByInstanceId(ctx: ShopSceneCtx): Map<string, QuickDraftCandidate> {
  const existing = levelQuickRewardActivePickByInstanceIdByCtx.get(ctx)
  if (existing) return existing
  const created = new Map<string, QuickDraftCandidate>()
  levelQuickRewardActivePickByInstanceIdByCtx.set(ctx, created)
  return created
}

function toQuickDraftCandidate(choice: NeutralChoiceCandidate): QuickDraftCandidate {
  return {
    defId: choice.item.id,
    level: levelFromLegacyTierStar(choice.tier, choice.star),
    tier: choice.tier,
    star: choice.star,
  }
}

export function isLevelQuickDraftEnabled(): boolean {
  return getDebugCfg('gameplayLevelQuickDraft') >= 0.5
}

// ---- 物品中心坐标（供 grantSynthesisExp 使用）----

export function getPlacedItemCenterOnStage(
  instanceId: string,
  zone: 'battle' | 'backpack',
  ctx: ShopSceneCtx,
): { x: number; y: number } | null {
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

// ---- 飞行动画 ----

export function flyRewardToGridSlot(
  defId: string,
  targetView: GridZone,
  targetSlotCol: number,
  targetSlotRow: number,
  onLand: () => void,
  ctx: ShopSceneCtx,
): void {
  if (!ctx.playerStatusAvatar) { onLand(); return }
  const stage = getApp().stage

  const avatarBounds = ctx.playerStatusAvatar.getBounds()
  const startPos = stage.toLocal({ x: avatarBounds.x + avatarBounds.width / 2, y: avatarBounds.y + avatarBounds.height / 2 })

  const targetGlobal = targetView.toGlobal({
    x: targetSlotCol * CELL_SIZE + CELL_SIZE / 2,
    y: targetSlotRow * CELL_HEIGHT + CELL_HEIGHT / 2,
  })
  const endPos = stage.toLocal(targetGlobal)

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
      const ease = 1 - Math.pow(1 - t, 3)
      proxy.x = startPos.x + (endPos.x - startPos.x) * ease
      proxy.y = startPos.y + (endPos.y - startPos.y) * ease - Math.sin(Math.PI * t) * 60
      proxy.alpha = t < 0.85 ? 1 : (1 - t) / 0.15
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

export function flyRewardToBackpack(
  defId: string,
  targetSlotCol: number,
  targetSlotRow: number,
  onLand: () => void,
  ctx: ShopSceneCtx,
): void {
  if (!ctx.backpackView) { onLand(); return }
  flyRewardToGridSlot(defId, ctx.backpackView, targetSlotCol, targetSlotRow, onLand, ctx)
}

// ---- 待领取奖励队列 ----

export function checkAndPopPendingRewards(ctx: ShopSceneCtx, callbacks: RewardSystemCallbacks): void {
  if (ctx.pendingLevelRewards.length === 0) {
    callbacks.checkAndPopPendingHeroPeriodicRewards()
    return
  }
  if (!ctx.backpackSystem || !ctx.backpackView) return

  while (ctx.pendingLevelRewards.length > 0) {
    const slot = findFirstBackpackPlace('1x1', ctx)
    if (!slot) break
    callbacks.lockBackpackRewardCell(slot.col, slot.row)

    const defId = ctx.pendingLevelRewards[0]!
    const def = getItemDefById(defId)
    if (!def) { ctx.pendingLevelRewards.shift(); continue }

    const id = nextId()
    ctx.backpackSystem.place(slot.col, slot.row, '1x1', defId, id)
    instanceToDefId.set(id, defId)
    setInstanceQualityLevel(id, defId, 'Bronze', 1)
    instanceToPermanentDamageBonus.set(id, 0)
    const kind = getNeutralSpecialKind(def)
    if (kind) callbacks.recordLevelRewardObtained(kind)
    callbacks.recordNeutralItemObtained(defId)
    callbacks.unlockItemToPool(defId)
    ctx.pendingLevelRewards.shift()

    const capturedId = id
    const capturedDef = def
    const capturedSlot = { ...slot }
    flyRewardToBackpack(defId, slot.col, slot.row, () => {
      if (!ctx.backpackView || !ctx.backpackSystem) {
        callbacks.unlockBackpackRewardCell(capturedSlot.col, capturedSlot.row)
        return
      }
      if (!ctx.backpackSystem.getItem(capturedId)) {
        callbacks.unlockBackpackRewardCell(capturedSlot.col, capturedSlot.row)
        checkAndPopPendingRewards(ctx, callbacks)
        return
      }
      void ctx.backpackView.addItem(capturedId, capturedDef.id, '1x1', capturedSlot.col, capturedSlot.row, 'Bronze#1').then(() => {
        ctx.backpackView!.setItemTier(capturedId, 'Bronze#1')
        ctx.drag?.refreshZone(ctx.backpackView!)
        checkAndPopPendingRewards(ctx, callbacks)
      }).finally(() => {
        callbacks.unlockBackpackRewardCell(capturedSlot.col, capturedSlot.row)
      })
    }, ctx)

    saveShopStateToStorage(captureShopState(ctx))
    break
  }

  if (ctx.pendingLevelRewards.length === 0) {
    callbacks.checkAndPopPendingHeroPeriodicRewards()
  }
}

function getQuickDraftWeightsByPlayerLevel(level: number): number[] {
  const rows = getGameConfig().shopRules?.levelQuickDraftLevelWeightsByPlayerLevel
  if (!Array.isArray(rows) || rows.length <= 0) return [1, 0, 0, 0, 0, 0]
  const idx = Math.max(0, Math.min(rows.length - 1, Math.round(level) - 1))
  const row = rows[idx] ?? rows[rows.length - 1] ?? [1, 0, 0, 0, 0, 0]
  return [
    Math.max(0, Number(row[0] ?? 0)),
    Math.max(0, Number(row[1] ?? 0)),
    Math.max(0, Number(row[2] ?? 0)),
    Math.max(0, Number(row[3] ?? 0)),
    Math.max(0, Number(row[4] ?? 0)),
    Math.max(0, Number(row[5] ?? 0)),
  ]
}

function pickQuickDraftLevelByWeights(weights: number[]): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const total = weights.reduce((sum, one) => sum + Math.max(0, Number(one || 0)), 0)
  if (total <= 0) return 2
  let roll = Math.random() * total
  for (let i = 0; i < 6; i++) {
    roll -= Math.max(0, Number(weights[i] ?? 0))
    if (roll <= 0) return (i + 2) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  }
  return 7
}

function pickWeightedQuickDraftCandidate(cands: QuickDraftCandidate[]): QuickDraftCandidate | null {
  if (cands.length <= 0) return null
  let total = 0
  const ws = cands.map((one) => {
    const item = getItemDefById(one.defId)
    const w = item ? Math.max(0, Number(getMinTierDropWeight(item, one.tier, one.star) || 0)) : 0
    total += w
    return w
  })
  if (total <= 0) return cands[Math.floor(Math.random() * cands.length)] ?? null
  let roll = Math.random() * total
  for (let i = 0; i < cands.length; i++) {
    roll -= ws[i] ?? 0
    if (roll <= 0) return cands[i] ?? null
  }
  return cands[cands.length - 1] ?? null
}

function buildQuickDraftCandidates(playerLevel: number, ctx: ShopSceneCtx, callbacks: RewardSystemCallbacks): QuickDraftCandidate[] {
  const out: QuickDraftCandidate[] = []
  const blockedDefIds = new Set<string>()
  const weights = getQuickDraftWeightsByPlayerLevel(playerLevel)
  for (let i = 0; i < 3; i++) {
    const level = pickQuickDraftLevelByWeights(weights)
    const pool = collectPoolCandidatesByLevel(ctx, level, {
      findFirstBattlePlace: (size) => callbacks.findFirstBattlePlace(size),
      findFirstBackpackPlace: (size) => callbacks.findFirstBackpackPlace(size),
    })
      .filter((one) => !blockedDefIds.has(one.item.id))
      .map((one) => ({
        defId: one.item.id,
        level: one.level,
        tier: one.tier,
        star: one.star,
      }))
    const picked = pickWeightedQuickDraftCandidate(pool)
    if (!picked) continue
    out.push(picked)
    blockedDefIds.add(picked.defId)
  }
  return out
}

function clearLevelQuickRewardGridItems(ctx: ShopSceneCtx): void {
  if (!ctx.levelQuickRewardSystem || !ctx.levelQuickRewardView) return
  const oldIds = Array.from(ctx.levelQuickRewardInstanceIds)
  for (const id of oldIds) {
    ctx.levelQuickRewardSystem.remove(id)
    ctx.levelQuickRewardView.removeItem(id)
    instanceToDefId.delete(id)
    instanceToPermanentDamageBonus.delete(id)
  }
  ctx.levelQuickRewardInstanceIds.clear()
}

function computeLevelQuickRewardPosition(ctx: ShopSceneCtx, battleScale: number): { quickX: number; quickY: number; quickW: number; quickH: number } {
  const quickW = CELL_SIZE * 3 * battleScale
  const quickH = CELL_HEIGHT * battleScale
  const rawX = (ctx.battleView?.x ?? 0) + getDebugCfg('levelQuickRewardOffsetX')
  const rawY = (ctx.battleView?.y ?? 0) + getDebugCfg('levelQuickRewardOffsetY')
  const quickX = Math.round(Math.max(8, Math.min(CANVAS_W - quickW - 8, rawX)))
  const quickY = Math.round(Math.max(8, Math.min(CANVAS_H - quickH - 8, rawY)))
  return { quickX, quickY, quickW, quickH }
}

function applyLevelQuickRewardItemSpacing(ctx: ShopSceneCtx, battleScale: number): void {
  if (!ctx.levelQuickRewardSystem || !ctx.levelQuickRewardView) return
  const items = ctx.levelQuickRewardSystem.getAllItems().slice().sort((a, b) => a.col - b.col)
  if (items.length <= 0) return
  const gapPx = 30
  const shift = gapPx / Math.max(0.1, battleScale)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    let offset = 0
    if (items.length >= 3) {
      if (i === 0) offset = -shift
      else if (i === items.length - 1) offset = shift
    }
    ctx.levelQuickRewardView.setItemOffsetX(item.instanceId, offset)
  }
}

function refreshLevelQuickRewardBackdrop(quickX: number, quickY: number, _quickW: number, quickH: number, ctx: ShopSceneCtx): void {
  if (ctx.levelQuickRewardBackdrop?.parent) ctx.levelQuickRewardBackdrop.parent.removeChild(ctx.levelQuickRewardBackdrop)
  ctx.levelQuickRewardBackdrop?.destroy()
  ctx.levelQuickRewardBackdrop = null

  const battleScale = Math.max(0.1, Number(ctx.backpackView?.scale.x || ctx.battleView?.scale.x || 1))
  const cellW = CELL_SIZE * battleScale
  const slotXs = [quickX - 30, quickX + cellW, quickX + cellW * 2 + 30]
  const r = Math.max(8, getDebugCfg('gridItemCornerRadius'))
  const g = new Graphics()
  g.zIndex = 17
  g.eventMode = 'none'
  for (const x of slotXs) {
    g.roundRect(x, quickY, cellW, quickH, r)
    g.fill({ color: 0x2a2a3e, alpha: 1 })
  }
  ctx.levelQuickRewardBackdrop = g
  getApp().stage.addChild(g)
}

function refreshLevelQuickRewardOverlayTitle(quickX: number, quickW: number, quickY: number, ctx: ShopSceneCtx): void {
  const active = getLevelQuickRewardActiveEntry(ctx)
  const battleScale = Math.max(0.1, Number(ctx.backpackView?.scale.x || ctx.battleView?.scale.x || 1))
  refreshLevelQuickRewardBackdrop(quickX, quickY, quickW, CELL_HEIGHT * battleScale, ctx)
  if (ctx.levelQuickRewardOverlay?.parent) ctx.levelQuickRewardOverlay.parent.removeChild(ctx.levelQuickRewardOverlay)
  ctx.levelQuickRewardOverlay?.destroy({ children: true })
  ctx.levelQuickRewardOverlay = null
  const overlay = new Container()
  overlay.zIndex = 19
  overlay.eventMode = 'none'
  const bubbleX = Math.round(quickX + quickW / 2)
  const labelFontSize = Math.max(20, Math.round(getDebugCfg('gridZoneLabelFontSize')))
  const baseTitle = active?.title ?? '升级奖励'
  const title = new Text({
    text: baseTitle,
    style: {
      fontSize: labelFontSize,
      fill: 0xd8e5ff,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      stroke: { color: 0x0f1a3a, width: 4 },
      align: 'center',
    },
  })
  title.anchor.set(0.5)
  title.x = bubbleX
  title.y = Math.round(quickY - 22)
  overlay.addChild(title)

  const center1 = quickX + CELL_SIZE * 0.5 * battleScale - 30
  const center2 = quickX + CELL_SIZE * 1.5 * battleScale
  const center3 = quickX + CELL_SIZE * 2.5 * battleScale + 30
  const orY = Math.round(quickY + (CELL_HEIGHT * battleScale) / 2)
  const makeOr = (x: number): Text => {
    const t = new Text({
      text: 'or',
      style: {
        fontSize: Math.max(18, Math.round(labelFontSize * 0.9)),
        fill: 0xd8e5ff,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x0f1a3a, width: 4 },
        align: 'center',
      },
    })
    t.anchor.set(0.5)
    t.x = Math.round(x)
    t.y = orY
    return t
  }
  overlay.addChild(makeOr((center1 + center2) / 2))
  overlay.addChild(makeOr((center2 + center3) / 2))

  ctx.levelQuickRewardOverlay = overlay
  getApp().stage.addChild(overlay)
}

function tryShowNextQueuedQuickDraft(ctx: ShopSceneCtx): boolean {
  if (!ctx.levelQuickRewardSystem || !ctx.levelQuickRewardView || !ctx.drag || !ctx.backpackView || !ctx.battleView) {
    syncPersistedQuickDraftEntries(ctx)
    return false
  }
  const queue = getLevelQuickRewardQueue(ctx)
  while (queue.length > 0) {
    const entry = queue.shift() ?? null
    if (!entry || entry.picks.length <= 0) continue
    clearLevelQuickRewardGridItems(ctx)
    const activeById = new Map<string, QuickDraftCandidate>()
    for (let i = 0; i < entry.picks.length; i++) {
      const pick = entry.picks[i]!
      const def = getItemDefById(pick.defId)
      if (!def) continue
      const id = nextId()
      ctx.levelQuickRewardSystem.place(i, 0, '1x1', pick.defId, id)
      instanceToDefId.set(id, pick.defId)
      setInstanceQualityLevel(id, pick.defId, pick.tier, levelFromLegacyTierStar(pick.tier, pick.star))
      instanceToPermanentDamageBonus.set(id, 0)
      ctx.levelQuickRewardInstanceIds.add(id)
      activeById.set(id, pick)
      void ctx.levelQuickRewardView.addItem(id, pick.defId, '1x1', i, 0, `${pick.tier}#${pick.star}`).then(() => {
        ctx.levelQuickRewardView?.setItemTier(id, `${pick.tier}#${pick.star}`)
        ctx.drag?.refreshZone(ctx.levelQuickRewardView!)
      })
    }
    if (ctx.levelQuickRewardInstanceIds.size <= 0) continue
    setLevelQuickRewardActiveEntry(ctx, entry)
    setLevelQuickRewardActivePickByInstanceId(ctx, activeById)
    const battleScale = Math.max(0.1, Number(ctx.backpackView.scale.x || ctx.battleView.scale.x || 1))
    const { quickX, quickY, quickW } = computeLevelQuickRewardPosition(ctx, battleScale)
    ctx.levelQuickRewardView.x = quickX
    ctx.levelQuickRewardView.y = quickY
    ctx.levelQuickRewardView.visible = true
    applyLevelQuickRewardItemSpacing(ctx, battleScale)
    ctx.drag.refreshZone(ctx.levelQuickRewardView)
    refreshLevelQuickRewardOverlayTitle(quickX, quickW, quickY, ctx)
    syncPersistedQuickDraftEntries(ctx)
    return true
  }
  syncPersistedQuickDraftEntries(ctx)
  return false
}

function ensureLevelQuickRewardUi(ctx: ShopSceneCtx): boolean {
  if (!ctx.battleView || !ctx.backpackView || !ctx.sellPopup || !ctx.drag) return false
  const stage = getApp().stage
  const battleScale = Math.max(0.1, Number(ctx.backpackView.scale.x || ctx.battleView.scale.x || 1))
  const tierBorderWidth = getDebugCfg('tierBorderWidth')
  const cornerRadius = getDebugCfg('gridItemCornerRadius')
  const cellBorderWidth = getDebugCfg('gridCellBorderWidth')
  const useArchetypeFrameColor = getDebugCfg('gameplayItemFrameColorByArchetype') >= 0.5
  if (!ctx.levelQuickRewardSystem) ctx.levelQuickRewardSystem = new GridSystem(3, 1)
  if (!ctx.levelQuickRewardView) {
    ctx.levelQuickRewardView = new GridZone('升级奖励', 3, 3, 1)
    ctx.levelQuickRewardView.setAutoPackEnabled(false)
    ctx.levelQuickRewardView.setStatBadgeMode('archetype')
    ctx.levelQuickRewardView.setLabelVisible(false)
    ctx.levelQuickRewardView.setCellBackgroundVisible(false)
    ctx.levelQuickRewardView.onTap = (instanceId) => {
      const defId = instanceToDefId.get(instanceId)
      const def = defId ? getItemDefById(defId) : null
      if (!def || !ctx.sellPopup) return
      ctx.battleView?.setSelected(null)
      ctx.backpackView?.setSelected(null)
      ctx.levelQuickRewardView?.setSelected(instanceId)
      ctx.shopPanel?.setSelectedSlot(-1)
      ctx.currentSelection = { kind: 'backpack', instanceId }
      ctx.selectedSellAction = null
      const level = getInstanceTier(instanceId)
      const star = getInstanceTierStar(instanceId)
      ctx.sellPopup.show(def, 0, 'none', toVisualTier(level, star), undefined, getDefaultItemInfoMode())
      applySellButtonState(ctx)
    }
    ctx.levelQuickRewardView.zIndex = 18
    stage.addChild(ctx.levelQuickRewardView)
  }
  ctx.levelQuickRewardView.scale.set(battleScale)
  ctx.levelQuickRewardView.setTierBorderWidth(tierBorderWidth)
  ctx.levelQuickRewardView.setCornerRadius(cornerRadius)
  ctx.levelQuickRewardView.setCellBorderWidth(cellBorderWidth)
  ctx.levelQuickRewardView.setStatBadgeFontSize(getDebugCfg('itemStatBadgeFontSize'))
  ctx.levelQuickRewardView.setTierStarFontSize(getDebugCfg('itemTierStarFontSize'))
  ctx.levelQuickRewardView.setTierStarStrokeWidth(getDebugCfg('itemTierStarStrokeWidth'))
  ctx.levelQuickRewardView.setTierStarOffsetX(getDebugCfg('itemTierStarOffsetX'))
  ctx.levelQuickRewardView.setTierStarOffsetY(getDebugCfg('itemTierStarOffsetY'))
  ctx.levelQuickRewardView.setStatBadgeOffsetY(getDebugCfg('itemStatBadgeOffsetY'))
  ctx.levelQuickRewardView.setItemFrameUseArchetypeColor(useArchetypeFrameColor)
  if (!ctx.levelQuickRewardZoneAdded) {
    ctx.drag.addZone(ctx.levelQuickRewardSystem, ctx.levelQuickRewardView)
    ctx.levelQuickRewardZoneAdded = true
  }
  const { quickX, quickY, quickW } = computeLevelQuickRewardPosition(ctx, battleScale)
  ctx.levelQuickRewardView.x = quickX
  ctx.levelQuickRewardView.y = quickY
  ctx.levelQuickRewardView.visible = true
  applyLevelQuickRewardItemSpacing(ctx, battleScale)
  ctx.drag.refreshZone(ctx.levelQuickRewardView)
  refreshLevelQuickRewardOverlayTitle(quickX, quickW, quickY, ctx)
  return true
}

function enqueueLevelQuickRewardEntry(ctx: ShopSceneCtx, entry: QuickDraftQueueEntry): boolean {
  if (!ensureLevelQuickRewardUi(ctx)) return false
  const queue = getLevelQuickRewardQueue(ctx)
  queue.push(entry)
  if (ctx.levelQuickRewardInstanceIds.size <= 0) {
    void tryShowNextQueuedQuickDraft(ctx)
  } else {
    const battleScale = Math.max(0.1, Number(ctx.backpackView?.scale.x || ctx.battleView?.scale.x || 1))
    const { quickX, quickY, quickW } = computeLevelQuickRewardPosition(ctx, battleScale)
    refreshLevelQuickRewardOverlayTitle(quickX, quickW, quickY, ctx)
  }
  syncPersistedQuickDraftEntries(ctx)
  saveShopStateToStorage(captureShopState(ctx))
  return true
}

export function enqueueLevelQuickDraftChoices(
  ctx: ShopSceneCtx,
  title: string,
  choices: NeutralChoiceCandidate[],
  opts?: {
    consumePickedAsReward?: boolean
    onPicked?: (picked: NeutralChoiceCandidate) => void
  },
): boolean {
  if (!isLevelQuickDraftEnabled()) return false
  const picks = choices.map((one) => toQuickDraftCandidate(one)).slice(0, 3)
  if (picks.length <= 0) return false
  return enqueueLevelQuickRewardEntry(ctx, {
    picks,
    title: title.trim().length > 0 ? title.trim() : '升级奖励',
    consumePickedAsReward: opts?.consumePickedAsReward !== false,
    onPicked: opts?.onPicked
      ? (picked) => {
        const item = getItemDefById(picked.defId)
        if (!item) return
        opts.onPicked?.({ item, tier: picked.tier, star: picked.star })
      }
      : undefined,
  })
}

export function restoreSavedLevelQuickDraftQueue(ctx: ShopSceneCtx): void {
  if (!isLevelQuickDraftEnabled()) {
    ctx.levelQuickDraftSavedEntries = []
    return
  }
  const savedEntries = Array.isArray(ctx.levelQuickDraftSavedEntries) ? ctx.levelQuickDraftSavedEntries : []
  if (savedEntries.length <= 0) return
  if (!ensureLevelQuickRewardUi(ctx)) return
  clearLevelQuickRewardGridItems(ctx)
  setLevelQuickRewardActiveEntry(ctx, null)
  getLevelQuickRewardActivePickByInstanceId(ctx).clear()
  const queue = getLevelQuickRewardQueue(ctx)
  queue.length = 0
  for (const entry of savedEntries) {
    if (!entry || !Array.isArray(entry.picks) || entry.picks.length <= 0) continue
    queue.push(fromSavedQuickDraftEntry(entry))
  }
  if (queue.length <= 0) {
    ctx.levelQuickDraftSavedEntries = []
    return
  }
  if (!tryShowNextQueuedQuickDraft(ctx)) {
    ctx.levelQuickDraftSavedEntries = []
    return
  }
  syncPersistedQuickDraftEntries(ctx)
}

function openQuickDraftLevelRewardOverlay(level: number, ctx: ShopSceneCtx, callbacks: RewardSystemCallbacks): boolean {
  const picks = buildQuickDraftCandidates(level, ctx, callbacks)
  if (picks.length <= 0) return false
  return enqueueLevelQuickRewardEntry(ctx, {
    picks,
    title: '升级奖励',
    consumePickedAsReward: true,
  })
}

function clearLevelQuickRewardOverlay(ctx: ShopSceneCtx): void {
  stopFlashEffect(ctx)
  const queue = getLevelQuickRewardQueue(ctx)
  queue.length = 0
  setLevelQuickRewardActiveEntry(ctx, null)
  getLevelQuickRewardActivePickByInstanceId(ctx).clear()
  clearLevelQuickRewardGridItems(ctx)
  if (ctx.levelQuickRewardOverlay?.parent) ctx.levelQuickRewardOverlay.parent.removeChild(ctx.levelQuickRewardOverlay)
  ctx.levelQuickRewardOverlay?.destroy({ children: true })
  ctx.levelQuickRewardOverlay = null
  if (ctx.levelQuickRewardBackdrop?.parent) ctx.levelQuickRewardBackdrop.parent.removeChild(ctx.levelQuickRewardBackdrop)
  ctx.levelQuickRewardBackdrop?.destroy()
  ctx.levelQuickRewardBackdrop = null
  if (ctx.levelQuickRewardView) {
    ctx.levelQuickRewardView.clearHighlight()
    ctx.levelQuickRewardView.setSelected(null)
    ctx.levelQuickRewardView.visible = false
  }
  syncPersistedQuickDraftEntries(ctx)
}

export function tryFinalizeLevelQuickRewardPick(ctx: ShopSceneCtx): void {
  if (!ctx.levelQuickRewardSystem || !ctx.levelQuickRewardView) return
  if (ctx.levelQuickRewardInstanceIds.size <= 0) return
  const activeEntry = getLevelQuickRewardActiveEntry(ctx)
  const activeById = getLevelQuickRewardActivePickByInstanceId(ctx)
  const live = ctx.levelQuickRewardSystem.getAllItems().map((it) => it.instanceId)
  if (live.length >= ctx.levelQuickRewardInstanceIds.size) return
  const liveSet = new Set(live)
  let pickedInstanceId: string | null = null
  for (const id of ctx.levelQuickRewardInstanceIds) {
    if (!liveSet.has(id)) {
      pickedInstanceId = id
      break
    }
  }
  const picked = pickedInstanceId ? activeById.get(pickedInstanceId) ?? null : null
  if (picked && activeEntry && activeEntry.consumePickedAsReward === false && pickedInstanceId) {
    const battlePicked = ctx.battleSystem?.getItem(pickedInstanceId)
    if (battlePicked && ctx.battleView) {
      ctx.battleSystem?.remove(pickedInstanceId)
      ctx.battleView.removeItem(pickedInstanceId)
      ctx.drag?.refreshZone(ctx.battleView)
    }
    const backpackPicked = ctx.backpackSystem?.getItem(pickedInstanceId)
    if (backpackPicked && ctx.backpackView) {
      ctx.backpackSystem?.remove(pickedInstanceId)
      ctx.backpackView.removeItem(pickedInstanceId)
      ctx.drag?.refreshZone(ctx.backpackView)
    }
    instanceToDefId.delete(pickedInstanceId)
    instanceToPermanentDamageBonus.delete(pickedInstanceId)
  }
  if (picked && activeEntry) activeEntry.onPicked?.(picked)

  for (const instanceId of live) {
    ctx.levelQuickRewardSystem.remove(instanceId)
    ctx.levelQuickRewardView.removeItem(instanceId)
    instanceToDefId.delete(instanceId)
    instanceToPermanentDamageBonus.delete(instanceId)
  }
  setLevelQuickRewardActiveEntry(ctx, null)
  activeById.clear()
  ctx.levelQuickRewardInstanceIds.clear()
  if (!tryShowNextQueuedQuickDraft(ctx)) clearLevelQuickRewardOverlay(ctx)
  syncPersistedQuickDraftEntries(ctx)
  saveShopStateToStorage(captureShopState(ctx))
}

export function refreshLevelQuickRewardLayout(ctx: ShopSceneCtx): void {
  if (!ctx.levelQuickRewardView || !ctx.levelQuickRewardView.visible || !ctx.drag) return
  const battleScale = Math.max(0.1, Number(ctx.backpackView?.scale.x || ctx.battleView?.scale.x || 1))
  const { quickX, quickY, quickW } = computeLevelQuickRewardPosition(ctx, battleScale)
  ctx.levelQuickRewardView.x = quickX
  ctx.levelQuickRewardView.y = quickY
  applyLevelQuickRewardItemSpacing(ctx, battleScale)
  ctx.drag.refreshZone(ctx.levelQuickRewardView)
  refreshLevelQuickRewardOverlayTitle(quickX, quickW, quickY, ctx)
}

export function handleLevelReward(level: number, ctx: ShopSceneCtx, callbacks: RewardSystemCallbacks): void {
  const enabled = getDebugCfg('gameplayLevelRewardPreset') >= 0.5
  if (!enabled) {
    saveShopStateToStorage(captureShopState(ctx))
    return
  }
  const quickDraftEnabled = getDebugCfg('gameplayLevelQuickDraft') >= 0.5
  if (quickDraftEnabled) {
    const opened = openQuickDraftLevelRewardOverlay(level, ctx, callbacks)
    if (opened) return
  }
  const rewards = callbacks.rollLevelRewardDefIds(level)
  if (rewards.length <= 0) {
    if (ctx.shopManager) {
      const goldFallback = 3
      ctx.shopManager.gold += goldFallback
      showHintToast('no_gold_buy' as ToastReason, `升级奖励：中立物品已满，获得${goldFallback}G`, 0xffd700, ctx)
    }
    saveShopStateToStorage(captureShopState(ctx))
    return
  }
  ctx.pendingLevelRewards.push(...rewards)
  checkAndPopPendingRewards(ctx, callbacks)
}

// ---- 合成经验 ----

export function grantSynthesisExp(
  amount: number,
  from: { instanceId: string; zone: 'battle' | 'backpack' } | undefined,
  ctx: ShopSceneCtx,
  callbacks: RewardSystemCallbacks,
): void {
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
    showHintToast('no_gold_buy' as ToastReason, `升级到 Lv${level}`, 0x8ff0b0, ctx)
    playPlayerLevelUpFx(ctx)
    handleLevelReward(levelBeforeUpgrade, ctx, callbacks)
  }
}
