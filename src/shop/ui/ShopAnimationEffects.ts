// ============================================================
// AnimationEffects — 动画与视觉特效（函数集合模式）
// 职责：
//   - 格子拖拽按钮闪烁（startGridDragButtonFlash / stopGridDragButtonFlash）
//   - 拖拽目标区域闪烁（startFlashEffect / stopFlashEffect）
//   - 背包转移小动画（playBackpackTransferMiniAnim）
//   - 合成闪光特效（playSynthesisFlashEffect）
//   - 变形/升级闪光特效（playTransformOrUpgradeFlashEffect）
//   - 引导手势动画（showMoveToBattleGuideHand / stopBattleGuideHandAnim）
//   - 解锁揭示动画（stopUnlockRevealPlayback）
// ============================================================

import { getConfig } from '@/core/DataLoader'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { getItemIconUrl } from '@/core/AssetPath'
import { getApp } from '@/core/AppContext'
import { CELL_SIZE, CELL_HEIGHT } from '@/common/grid/GridZone'
import type { ItemSizeNorm } from '@/common/grid/GridSystem'
import { Assets, Container, Graphics, Sprite, Text, Texture, Ticker } from 'pixi.js'
import type { ShopSceneCtx } from '../ShopSceneContext'
import { CANVAS_W, CANVAS_H, BTN_RADIUS } from '@/config/layoutConstants'

// ============================================================
// 常量（CANVAS_W/H/BTN_RADIUS 来自 layoutConstants）
// ============================================================

const MINI_CELL  = 20

// ============================================================
// 合成闪光特效（需要传入 SynthesizeResult 类型）
// ============================================================

export type SynthesizeResultForFx = {
  instanceId: string
  targetZone: 'battle' | 'backpack'
}

export function playSynthesisFlashEffect(ctx: ShopSceneCtx, stage: Container, result: SynthesizeResultForFx): void {
  if (!ctx.battleSystem || !ctx.backpackSystem || !ctx.battleView || !ctx.backpackView) return
  const system = result.targetZone === 'battle' ? ctx.battleSystem : ctx.backpackSystem
  const view = result.targetZone === 'battle' ? ctx.battleView : ctx.backpackView
  if (!system.getItem(result.instanceId)) return
  const flash = new Graphics()
  flash.eventMode = 'none'
  stage.addChild(flash)

  const durationMs = getDebugCfg('synthFlashDurationMs')
  const start = Date.now()
  const tick = () => {
    const it = system.getItem(result.instanceId)
    if (!it) {
      Ticker.shared.remove(tick)
      flash.parent?.removeChild(flash)
      flash.destroy()
      return
    }
    const w = it.size === '1x1' ? CELL_SIZE : it.size === '2x1' ? CELL_SIZE * 2 : CELL_SIZE * 3
    const h = CELL_HEIGHT
    const a = view.toGlobal({ x: it.col * CELL_SIZE, y: it.row * CELL_HEIGHT })
    const b = view.toGlobal({ x: it.col * CELL_SIZE + w, y: it.row * CELL_HEIGHT + h })
    const p0 = stage.toLocal(a)
    const p1 = stage.toLocal(b)
    const x = Math.min(p0.x, p1.x)
    const y = Math.min(p0.y, p1.y)
    const rectW = Math.abs(p1.x - p0.x)
    const rectH = Math.abs(p1.y - p0.y)
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

// ============================================================
// 变形/升级闪光特效
// ============================================================

export function playTransformOrUpgradeFlashEffect(ctx: ShopSceneCtx, instanceId: string, zone: 'battle' | 'backpack'): void {
  if (!ctx.battleSystem || !ctx.backpackSystem || !ctx.battleView || !ctx.backpackView) return
  const flashKey = `${zone}:${instanceId}`
  const now = Date.now()
  const lastAt = ctx.itemTransformFlashLastAtMs.get(flashKey) ?? 0
  if (now - lastAt < 80) return
  ctx.itemTransformFlashLastAtMs.set(flashKey, now)

  const system = zone === 'battle' ? ctx.battleSystem : ctx.backpackSystem
  const view = zone === 'battle' ? ctx.battleView : ctx.backpackView
  if (!system.getItem(instanceId)) return
  const stage = getApp().stage

  const flash = new Graphics()
  flash.eventMode = 'none'
  stage.addChild(flash)
  const durationMs = getDebugCfg('synthFlashDurationMs')
  const start = Date.now()
  const tick = () => {
    const it = system.getItem(instanceId)
    if (!it) {
      Ticker.shared.remove(tick)
      flash.parent?.removeChild(flash)
      flash.destroy()
      return
    }
    const w = it.size === '1x1' ? CELL_SIZE : it.size === '2x1' ? CELL_SIZE * 2 : CELL_SIZE * 3
    const h = CELL_HEIGHT
    const a = view.toGlobal({ x: it.col * CELL_SIZE, y: it.row * CELL_HEIGHT })
    const b = view.toGlobal({ x: it.col * CELL_SIZE + w, y: it.row * CELL_HEIGHT + h })
    const p0 = stage.toLocal(a)
    const p1 = stage.toLocal(b)
    const x = Math.min(p0.x, p1.x)
    const y = Math.min(p0.y, p1.y)
    const rectW = Math.abs(p1.x - p0.x)
    const rectH = Math.abs(p1.y - p0.y)
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

// ============================================================
// 拖拽目标区域闪烁（购买时高亮战斗区/背包按钮）
// ============================================================

export type StartFlashEffectDeps = {
  canBattleAcceptShopItem: (size: ItemSizeNorm) => boolean
  hasAnyPlaceInVisibleCols: (size: ItemSizeNorm) => boolean
}

export function startFlashEffect(
  ctx: ShopSceneCtx,
  stage: Container,
  size: ItemSizeNorm,
  forceBothZones: boolean,
  deps: StartFlashEffectDeps,
): void {
  stopFlashEffect(ctx)

  const flashBattle = (() => {
    if (forceBothZones) return true
    if (!ctx.battleSystem || !ctx.battleView) return false
    return deps.canBattleAcceptShopItem(size)
  })()
  const flashBackpack = (() => {
    if (forceBothZones) return true
    if (!ctx.backpackSystem || !ctx.backpackView) return false
    return deps.hasAnyPlaceInVisibleCols(size)
  })()

  if (!flashBattle && !flashBackpack) return

  const overlay = new Graphics()
  const floaterIdx = ctx.shopDragFloater ? stage.getChildIndex(ctx.shopDragFloater) : stage.children.length
  stage.addChildAt(overlay, floaterIdx)
  ctx.flashOverlay = overlay
  let t = 0
  ctx.flashTickFn = () => {
    t += 0.05
    const a = 0.10 + 0.10 * Math.sin(t * 3)
    overlay.clear()
    if (flashBattle && ctx.battleView) {
      const bx  = ctx.battleView.x, by = ctx.battleView.y
      const s   = ctx.battleView.scale.x
      const bw  = ctx.battleView.activeColCount * CELL_SIZE * s
      const bh  = CELL_HEIGHT * s
      const pad = 6
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
  Ticker.shared.add(ctx.flashTickFn)
}

export function stopFlashEffect(ctx: ShopSceneCtx): void {
  if (ctx.flashTickFn) { Ticker.shared.remove(ctx.flashTickFn); ctx.flashTickFn = null }
  if (ctx.flashOverlay) { ctx.flashOverlay.destroy(); ctx.flashOverlay = null }
}

// ============================================================
// 格子拖拽按钮闪烁
// ============================================================

export type StartGridDragButtonFlashDeps = {
  isShopInputEnabled: () => boolean
  applySellButtonState: () => void
  getGridDragSellAreaTopLocalY: () => number
}

export function startGridDragButtonFlash(
  ctx: ShopSceneCtx,
  stage: Container,
  canSell: boolean,
  canToBackpack: boolean,
  sellPrice: number,
  deps: StartGridDragButtonFlashDeps,
): void {
  stopGridDragButtonFlash(ctx, deps)
  ctx.gridDragCanSell = canSell
  ctx.gridDragCanToBackpack = canToBackpack
  void sellPrice
  ctx.gridDragSellHot = false
  if (!ctx.gridDragCanSell && !ctx.gridDragCanToBackpack) return

  if (ctx.gridDragCanSell) {
    if (ctx.refreshBtnHandle) ctx.refreshBtnHandle.container.visible = false
    if (ctx.sellBtnHandle) ctx.sellBtnHandle.container.visible = false
    if (ctx.phaseBtnHandle) ctx.phaseBtnHandle.container.visible = false
  }

  const overlay = new Graphics()
  const dragIdx = stage.children.length - 1
  stage.addChildAt(overlay, Math.max(0, dragIdx))
  ctx.gridDragFlashOverlay = overlay

  if (ctx.gridDragCanSell) {
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
    ctx.gridDragSellZoneCon = zone
    ctx.gridDragSellZoneBg = bg
    ctx.gridDragSellZoneText = txt
  }

  let t = 0
  ctx.gridDragFlashTick = () => {
    if (!ctx.gridDragFlashOverlay) return
    t += 0.05
    const a = 0.12 + 0.10 * Math.sin(t * 3)
    overlay.clear()

    if (ctx.gridDragCanSell && ctx.sellBtnHandle?.container.visible) {
      const cx = getDebugCfg('sellBtnX')
      const cy = getDebugCfg('sellBtnY')
      overlay.circle(cx, cy, BTN_RADIUS + 10)
      overlay.fill({ color: 0xff4b4b, alpha: a * 0.45 })
      overlay.circle(cx, cy, BTN_RADIUS + 14)
      overlay.stroke({ color: 0xff4b4b, width: 3, alpha: a * 2.4 })
    }
    if (ctx.gridDragCanToBackpack) {
      const cx = getDebugCfg('backpackBtnX')
      const cy = getDebugCfg('backpackBtnY')
      overlay.circle(cx, cy, BTN_RADIUS + 10)
      overlay.fill({ color: 0xffcc44, alpha: a * 0.4 })
      overlay.circle(cx, cy, BTN_RADIUS + 14)
      overlay.stroke({ color: 0xffcc44, width: 3, alpha: a * 2.4 })
    }

    if (ctx.gridDragSellZoneBg && ctx.gridDragSellZoneText) {
      const top = deps.getGridDragSellAreaTopLocalY()
      const h = Math.max(40, CANVAS_H - top)
      const hot = ctx.gridDragSellHot
      ctx.gridDragSellZoneBg.clear()
      ctx.gridDragSellZoneBg.roundRect(0, top, CANVAS_W, h, 16)
      ctx.gridDragSellZoneBg.fill({ color: 0xaa2222, alpha: hot ? 0.46 : 0.28 })
      ctx.gridDragSellZoneBg.stroke({ color: 0xff5f5f, width: hot ? 4 : 2, alpha: hot ? 0.9 : 0.55 })

      ctx.gridDragSellZoneText.style.fill = hot ? 0xfff0f0 : 0xffb3b3
      ctx.gridDragSellZoneText.style.fontSize = getDebugCfg('shopButtonLabelFontSize')
      ctx.gridDragSellZoneText.text = '拖动到此处丢弃'
      ctx.gridDragSellZoneText.x = CANVAS_W / 2
      ctx.gridDragSellZoneText.y = top + h / 2
    }
  }
  Ticker.shared.add(ctx.gridDragFlashTick)
}

export function stopGridDragButtonFlash(ctx: ShopSceneCtx, deps: StartGridDragButtonFlashDeps): void {
  if (ctx.gridDragFlashTick) { Ticker.shared.remove(ctx.gridDragFlashTick); ctx.gridDragFlashTick = null }
  if (ctx.gridDragFlashOverlay) { ctx.gridDragFlashOverlay.destroy(); ctx.gridDragFlashOverlay = null }
  if (ctx.gridDragSellZoneCon) { ctx.gridDragSellZoneCon.destroy({ children: true }); ctx.gridDragSellZoneCon = null }
  ctx.gridDragSellZoneBg = null
  ctx.gridDragSellZoneText = null
  ctx.gridDragCanSell = false
  ctx.gridDragCanToBackpack = false
  ctx.gridDragSellHot = false

  const inShop = deps.isShopInputEnabled()
  if (ctx.refreshBtnHandle) ctx.refreshBtnHandle.container.visible = inShop
  if (ctx.sellBtnHandle) ctx.sellBtnHandle.container.visible = inShop
  if (ctx.phaseBtnHandle) ctx.phaseBtnHandle.container.visible = true
  deps.applySellButtonState()
}

// ============================================================
// 背包转移小动画
// ============================================================

export type BackpackTransferAnimSeed = {
  defId: string
  size: ItemSizeNorm
  fromGlobal: { x: number; y: number }
  toCol: number
  toRow: number
}

export function playBackpackTransferMiniAnim(ctx: ShopSceneCtx, seeds: BackpackTransferAnimSeed[]): void {
  if (seeds.length === 0 || !ctx.miniMapCon || !ctx.miniMapCon.visible) return
  const miniCon = ctx.miniMapCon
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

    void Assets.load<Texture>(getItemIconUrl(seed.defId))
      .then((tex) => {
        icon.texture = tex
        icon.alpha = 1
      })
      .catch((err) => {
        icon.alpha = 0
        console.warn('[AnimationEffects] 背包转移动画图标加载失败', seed.defId, err)
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

// ============================================================
// 引导手势动画（移动到战斗区）
// ============================================================

function getSizeCols(size: ItemSizeNorm): number {
  if (size === '2x1') return 2
  if (size === '3x1') return 3
  return 1
}

export function stopBattleGuideHandAnim(ctx: ShopSceneCtx): void {
  if (ctx.battleGuideHandTick) {
    Ticker.shared.remove(ctx.battleGuideHandTick)
    ctx.battleGuideHandTick = null
  }
  if (ctx.battleGuideHandCon) {
    if (ctx.battleGuideHandCon.parent) ctx.battleGuideHandCon.parent.removeChild(ctx.battleGuideHandCon)
    ctx.battleGuideHandCon.destroy({ children: true })
    ctx.battleGuideHandCon = null
  }
}

export function showMoveToBattleGuideHand(ctx: ShopSceneCtx): void {
  if (!ctx.backpackSystem || !ctx.backpackView || !ctx.battleView) return
  const backpackItems = ctx.backpackSystem
    .getAllItems()
    .slice()
    .sort((a, b) => (a.row - b.row) || (a.col - b.col))
  const first = backpackItems[0]
  if (!first) return

  stopBattleGuideHandAnim(ctx)

  const fromLocal = ctx.backpackView.cellToLocal(first.col, first.row)
  const fromGlobal = ctx.backpackView.toGlobal({
    x: fromLocal.x + (getSizeCols(first.size) * CELL_SIZE) / 2,
    y: fromLocal.y + CELL_HEIGHT / 2,
  })
  const toLocal = ctx.battleView.cellToLocal(0, 0)
  const toGlobal = ctx.battleView.toGlobal({
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
  ctx.battleGuideHandCon = con

  const startAt = Date.now()
  const durationMs = getDebugCfg('guideHandDurationMs')
  const arcYOffset = Math.max(18, Math.round(CELL_SIZE * 0.28))
  ctx.battleGuideHandTick = () => {
    const tRaw = (Date.now() - startAt) / durationMs
    const t = Math.max(0, Math.min(1, tRaw))
    const ease = t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2
    con.x = fromAnchorX + (toAnchorX - fromAnchorX) * ease
    con.y = fromAnchorY + (toAnchorY - fromAnchorY) * ease - Math.sin(Math.PI * t) * arcYOffset
    con.alpha = t < 0.75 ? 1 : Math.max(0, 1 - (t - 0.75) / 0.25)
    if (t >= 1) stopBattleGuideHandAnim(ctx)
  }
  Ticker.shared.add(ctx.battleGuideHandTick)
}

export function showBuyGuideHand(ctx: ShopSceneCtx): void {
  stopBattleGuideHandAnim(ctx)

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
  ctx.battleGuideHandCon = con

  const startAt = Date.now()
  const durationMs = 1000
  ctx.battleGuideHandTick = () => {
    const tRaw = (Date.now() - startAt) / durationMs
    const t = Math.max(0, Math.min(1, tRaw))
    const pulse = Math.sin(t * Math.PI * 3)
    con.y = centerY + pulse * 10
    con.alpha = 0.7 + 0.3 * Math.max(0, pulse)
    if (t >= 1) stopBattleGuideHandAnim(ctx)
  }
  Ticker.shared.add(ctx.battleGuideHandTick)
}

// ============================================================
// 解锁揭示动画停止
// ============================================================

export function stopUnlockRevealPlayback(ctx: ShopSceneCtx): void {
  if (ctx.unlockRevealTickFn) {
    Ticker.shared.remove(ctx.unlockRevealTickFn)
    ctx.unlockRevealTickFn = null
  }
  ctx.unlockRevealActive = false
  if (!ctx.unlockRevealLayer) return
  ctx.unlockRevealLayer.visible = false
  ctx.unlockRevealLayer.removeChildren().forEach((ch) => ch.destroy({ children: true }))
}
