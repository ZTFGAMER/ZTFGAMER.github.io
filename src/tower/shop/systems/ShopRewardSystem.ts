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
import { getApp } from '@/tower/core/AppContext'
import { GridSystem } from '@/tower/common/grid/GridSystem'
import { GridZone } from '@/tower/common/grid/GridZone'
import { CELL_SIZE, CELL_HEIGHT } from '@/tower/common/grid/GridZone'
import { Graphics, Ticker, Container, Text } from 'pixi.js'
import { normalizeSize } from '@/tower/common/items/ItemDef'
import {
  nextId,
  instanceToDefId,
  instanceToPermanentDamageBonus,
  getInstanceTier,
  getInstanceTierStar,
  levelFromLegacyTierStar,
  setInstanceQualityLevel,
} from './ShopInstanceRegistry'
import { getItemDefById } from './ShopSynthesisLogic'
import { getNeutralSpecialKind } from '../panels/NeutralItemPanel'
import type { NeutralSpecialKind, NeutralChoiceCandidate } from '../panels/NeutralItemPanel'
import { captureShopState, saveShopStateToStorage } from '../ShopStateStorage'
import { getConfig as getDebugCfg } from '@/tower/config/debugConfig'
import { CANVAS_W, CANVAS_H } from '@/tower/config/layoutConstants'
import { findFirstBackpackPlace } from './ShopGridInventory'
import { toVisualTier } from '../ShopMathHelpers'
import { stopFlashEffect } from '../ui/ShopAnimationEffects'
import { applySellButtonState } from './ShopDragSystem'
import { getDefaultItemInfoMode } from '../ShopModeHelpers'
import { isSkillItemDefId } from '@/tower/common/skills/SkillItemDefs'

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
  refreshPlayerStatusUI: () => void
}

type QuickDraftCandidate = {
  defId: string
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
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

function getLevelQuickDraftRemainingCount(ctx: ShopSceneCtx): number {
  const active = getLevelQuickRewardActiveEntry(ctx)
  return getLevelQuickRewardQueue(ctx).length + (active ? 1 : 0)
}

function stopLevelQuickRewardGuideFrameFx(ctx: ShopSceneCtx): void {
  if (ctx.levelQuickRewardGuideTick) {
    Ticker.shared.remove(ctx.levelQuickRewardGuideTick)
    ctx.levelQuickRewardGuideTick = null
  }
  if (ctx.levelQuickRewardGuideFrame?.parent) {
    ctx.levelQuickRewardGuideFrame.parent.removeChild(ctx.levelQuickRewardGuideFrame)
  }
  ctx.levelQuickRewardGuideFrame?.destroy()
  ctx.levelQuickRewardGuideFrame = null
}

function playLevelQuickRewardGuideFrameFx(quickX: number, quickY: number, quickW: number, quickH: number, ctx: ShopSceneCtx): void {
  stopLevelQuickRewardGuideFrameFx(ctx)
  const g = new Graphics()
  g.zIndex = 20
  g.eventMode = 'none'
  const startAt = performance.now()
  const durationMs = 760
  const pad = 10
  const baseX = Math.round(quickX - pad)
  const baseY = Math.round(quickY - pad)
  const boxW = Math.round(quickW + pad * 2)
  const boxH = Math.round(quickH + pad * 2)
  const corner = Math.max(12, Math.round(getDebugCfg('gridItemCornerRadius') + 4))
  const tick = () => {
    const p = Math.max(0, Math.min(1, (performance.now() - startAt) / durationMs))
    const amp = Math.round((1 - p) * 12)
    const shakeX = Math.round(Math.sin(p * Math.PI * 12) * amp)
    const shakeY = Math.round(Math.sin(p * Math.PI * 10) * Math.max(1, Math.round(amp * 0.35)))
    const pulse = 0.75 + 0.25 * Math.sin(p * Math.PI * 8)
    g.clear()
    g.roundRect(baseX + shakeX + 2, baseY + shakeY + 2, boxW, boxH, corner)
    g.fill({ color: 0xffd84f, alpha: 0.16 * pulse })
    g.roundRect(baseX + shakeX, baseY + shakeY, boxW, boxH, corner)
    g.stroke({ color: 0xffdf66, width: 6, alpha: 0.95 * pulse })
    if (p >= 1) stopLevelQuickRewardGuideFrameFx(ctx)
  }
  ctx.levelQuickRewardGuideFrame = g
  ctx.levelQuickRewardGuideTick = tick
  getApp().stage.addChild(g)
  Ticker.shared.add(tick)
}

function getLevelQuickRewardGuideBounds(quickX: number, battleScale: number, itemCountRaw: number): { x: number; w: number } {
  const cellW = CELL_SIZE * battleScale
  const itemCount = Math.max(1, Math.min(3, itemCountRaw))
  const centers = getLevelQuickRewardCentersLocal(itemCount, battleScale).map((x) => quickX + x)
  const left = Math.min(...centers) - cellW * 0.5
  const right = Math.max(...centers) + cellW * 0.5
  return { x: left, w: Math.max(cellW, right - left) }
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
  if (isLevelQuickDraftEnabled() && ctx.pendingLevelRewards.length > 0) {
    ctx.pendingLevelRewards.length = 0
    saveShopStateToStorage(captureShopState(ctx))
  }
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

function getLevelQuickRewardCentersLocal(itemCount: number, battleScale: number): number[] {
  const cellW = CELL_SIZE * battleScale
  const center = cellW * 1.5
  const gapPx = 30
  if (itemCount <= 1) return [center]
  if (itemCount === 2) {
    const delta = (cellW + gapPx) * 0.5
    return [center - delta, center + delta]
  }
  return [cellW * 0.5 - gapPx, cellW * 1.5, cellW * 2.5 + gapPx]
}

function applyLevelQuickRewardItemSpacing(ctx: ShopSceneCtx, battleScale: number): void {
  if (!ctx.levelQuickRewardSystem || !ctx.levelQuickRewardView) return
  const items = ctx.levelQuickRewardSystem.getAllItems().slice().sort((a, b) => a.col - b.col)
  if (items.length <= 0) return
  const cellW = CELL_SIZE * battleScale
  const centers = getLevelQuickRewardCentersLocal(Math.min(3, items.length), battleScale)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const desiredCenter = centers[Math.min(i, centers.length - 1)] ?? (cellW * (item.col + 0.5))
    const baseCenter = cellW * (item.col + 0.5)
    const offset = (desiredCenter - baseCenter) / Math.max(0.1, battleScale)
    ctx.levelQuickRewardView.setItemOffsetX(item.instanceId, offset)
  }
}

function refreshLevelQuickRewardBackdrop(quickX: number, quickY: number, _quickW: number, quickH: number, ctx: ShopSceneCtx): void {
  if (ctx.levelQuickRewardBackdrop?.parent) ctx.levelQuickRewardBackdrop.parent.removeChild(ctx.levelQuickRewardBackdrop)
  ctx.levelQuickRewardBackdrop?.destroy()
  ctx.levelQuickRewardBackdrop = null

  const battleScale = Math.max(0.1, Number(ctx.backpackView?.scale.x || ctx.battleView?.scale.x || 1))
  const cellW = CELL_SIZE * battleScale
  const active = getLevelQuickRewardActiveEntry(ctx)
  const itemCount = Math.max(1, Math.min(3, (active?.picks.length ?? ctx.levelQuickRewardInstanceIds.size) || 3))
  const centers = getLevelQuickRewardCentersLocal(itemCount, battleScale)
  const r = Math.max(8, getDebugCfg('gridItemCornerRadius'))
  const g = new Graphics()
  g.zIndex = 3
  g.eventMode = 'none'
  for (const center of centers) {
    const x = quickX + center - cellW * 0.5
    g.roundRect(x, quickY, cellW, quickH, r)
    g.fill({ color: 0x2a2a3e, alpha: 1 })
  }
  ctx.levelQuickRewardBackdrop = g
  const stage = getApp().stage
  const rewardView = ctx.levelQuickRewardView
  if (rewardView?.parent === stage) {
    const rewardIndex = stage.getChildIndex(rewardView)
    stage.addChildAt(g, Math.max(0, rewardIndex))
  } else {
    stage.addChildAt(g, 0)
  }
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
  const remaining = Math.max(1, getLevelQuickDraftRemainingCount(ctx))
  const titleText = `请选择奖励（剩余${remaining}个）`
  const title = new Text({
    text: titleText,
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

  const itemCount = Math.max(1, Math.min(3, (active?.picks.length ?? ctx.levelQuickRewardInstanceIds.size) || 3))
  const centers = getLevelQuickRewardCentersLocal(itemCount, battleScale).map((x) => quickX + x)
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
  for (let i = 0; i < centers.length - 1; i++) {
    const left = centers[i]!
    const right = centers[i + 1]!
    overlay.addChild(makeOr((left + right) / 2))
  }

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
      const placeCol = entry.picks.length === 1 ? 1 : entry.picks.length === 2 ? i * 2 : i
      ctx.levelQuickRewardSystem.place(placeCol, 0, '1x1', pick.defId, id)
      instanceToDefId.set(id, pick.defId)
      setInstanceQualityLevel(id, pick.defId, pick.tier, levelFromLegacyTierStar(pick.tier, pick.star))
      instanceToPermanentDamageBonus.set(id, 0)
      ctx.levelQuickRewardInstanceIds.add(id)
      activeById.set(id, pick)
      void ctx.levelQuickRewardView.addItem(id, pick.defId, '1x1', placeCol, 0, `${pick.tier}#${pick.star}`).then(() => {
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
    const itemCount = Math.max(1, Math.min(3, entry.picks.length || ctx.levelQuickRewardInstanceIds.size))
    const guide = getLevelQuickRewardGuideBounds(quickX, battleScale, itemCount)
    playLevelQuickRewardGuideFrameFx(guide.x, quickY, guide.w, Math.round(CELL_HEIGHT * battleScale), ctx)
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
      const infoMode = isSkillItemDefId(def.id) ? 'detailed' : getDefaultItemInfoMode()
      ctx.sellPopup.show(def, 0, 'none', toVisualTier(level, star), undefined, infoMode)
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
    const { quickX, quickY, quickW, quickH } = computeLevelQuickRewardPosition(ctx, battleScale)
    refreshLevelQuickRewardOverlayTitle(quickX, quickW, quickY, ctx)
    const active = getLevelQuickRewardActiveEntry(ctx)
    const itemCount = Math.max(1, Math.min(3, (active?.picks.length ?? ctx.levelQuickRewardInstanceIds.size) || 1))
    const guide = getLevelQuickRewardGuideBounds(quickX, battleScale, itemCount)
    playLevelQuickRewardGuideFrameFx(guide.x, quickY, guide.w, quickH, ctx)
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
    force?: boolean
  },
): boolean {
  if (!opts?.force && !isLevelQuickDraftEnabled()) return false
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
  stopLevelQuickRewardGuideFrameFx(ctx)
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
  void level
  void callbacks
  saveShopStateToStorage(captureShopState(ctx))
}

// ---- 合成经验 ----

export function grantSynthesisExp(
  amount: number,
  from: { instanceId: string; zone: 'battle' | 'backpack' } | undefined,
  ctx: ShopSceneCtx,
  callbacks: RewardSystemCallbacks,
): void {
  void amount
  void from
  void ctx
  void callbacks
}
