// ============================================================
// ShopRewardSystem — 升级奖励、经验飞行、待领取队列
// 提取自 ShopScene.ts Phase 8 Batch D
// 包含：flyRewardToGridSlot、checkAndPopPendingRewards、grantSynthesisExp
// ============================================================

import type { ShopSceneCtx } from './ShopSceneContext'
import { getApp } from '@/core/AppContext'
import { GridZone } from '@/grid/GridZone'
import { CELL_SIZE, CELL_HEIGHT } from '@/grid/GridZone'
import { Graphics, Ticker } from 'pixi.js'
import {
  nextId,
  instanceToDefId,
  instanceToPermanentDamageBonus,
  setInstanceQualityLevel,
} from './InstanceRegistry'
import { getItemDefById } from './SynthesisLogic'
import { getNeutralSpecialKind } from './NeutralItemPanel'
import type { NeutralSpecialKind } from './NeutralItemPanel'
import { captureShopState, saveShopStateToStorage } from './ShopStateStorage'
import {
  clampPlayerLevel,
  getPlayerLevelCap,
  getPlayerExpNeedByLevel,
  playPlayerLevelUpFx,
  playSynthesisExpFlyEffect,
} from './PlayerStatusUI'
import { getPlayerProgressState, setPlayerProgressState } from '@/core/RunState'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { type ToastReason, showHintToast } from './ShopToastSystem'
import { findFirstBackpackPlace } from './ShopGridInventory'

// ---- 公共类型 ----

export type RewardSystemCallbacks = {
  lockBackpackRewardCell: (col: number, row: number) => void
  unlockBackpackRewardCell: (col: number, row: number) => void
  recordLevelRewardObtained: (kind: NeutralSpecialKind) => void
  recordNeutralItemObtained: (defId: string) => void
  unlockItemToPool: (defId: string) => void
  checkAndPopPendingHeroPeriodicRewards: () => void
  rollLevelRewardDefIds: (level: number) => string[]
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

export function handleLevelReward(level: number, ctx: ShopSceneCtx, callbacks: RewardSystemCallbacks): void {
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
