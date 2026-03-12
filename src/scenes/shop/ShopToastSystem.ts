// ============================================================
// ShopToastSystem — 商店提示 Toast 系统
// ============================================================

import { Container, Graphics, Text } from 'pixi.js'
import { getConfig } from '@/core/DataLoader'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { CANVAS_W, CANVAS_H } from '@/config/layoutConstants'
import { getShopToastColors } from '@/config/colorPalette'
import type { ShopSceneCtx } from './ShopSceneContext'

export type ToastReason = 'no_gold_buy' | 'no_gold_refresh' | 'backpack_full_buy' | 'backpack_full_transfer' | 'pvp_urge'

export function createHintToast(stage: Container, ctx: ShopSceneCtx): void {
  if (ctx.hintToastCon) return
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
  ctx.hintToastCon = con
  ctx.hintToastBg = bg
  ctx.hintToastText = txt
}

export function shouldShowToast(reason: ToastReason): boolean {
  if (getDebugCfg('toastEnabled') < 0.5) return false
  if (reason === 'no_gold_buy') return getDebugCfg('toastShowNoGoldBuy') >= 0.5
  if (reason === 'no_gold_refresh') return getDebugCfg('toastShowNoGoldRefresh') >= 0.5
  if (reason === 'backpack_full_buy') return getDebugCfg('toastShowBackpackFullBuy') >= 0.5
  return getDebugCfg('toastShowBackpackFullTransfer') >= 0.5
}

export function showHintToast(reason: ToastReason, message: string, color = 0xffe8a3, ctx: ShopSceneCtx): void {
  if (!shouldShowToast(reason)) return
  if (!ctx.hintToastCon || !ctx.hintToastBg || !ctx.hintToastText) return
  if (ctx.hintToastCon.parent) ctx.hintToastCon.parent.addChild(ctx.hintToastCon)
  if (ctx.hintToastHideTimer) {
    clearTimeout(ctx.hintToastHideTimer)
    ctx.hintToastHideTimer = null
  }
  ctx.hintToastText.text = message
  ctx.hintToastText.style.fill = color
  ctx.hintToastText.style.fontSize = Math.max(28, Math.round(getConfig().textSizes.refreshCost * 1.25))
  const padX = 36
  const padY = 18
  const boxW = ctx.hintToastText.width + padX * 2
  const boxH = ctx.hintToastText.height + padY * 2
  const boxX = (CANVAS_W - boxW) / 2
  const boxY = (CANVAS_H - boxH) / 2
  const corner = Math.max(10, Math.round(getDebugCfg('gridItemCornerRadius')))
  ctx.hintToastBg.clear()
  ctx.hintToastBg.roundRect(boxX, boxY, boxW, boxH, corner)
  const _toastColors = getShopToastColors()
  ctx.hintToastBg.fill({ color: _toastColors.bg, alpha: 0.96 })
  ctx.hintToastBg.stroke({ color: _toastColors.border, width: 4, alpha: 1 })
  ctx.hintToastText.x = boxX + padX
  ctx.hintToastText.y = boxY + padY
  ctx.hintToastCon.visible = true
  ctx.hintToastHideTimer = setTimeout(() => {
    if (ctx.hintToastCon) ctx.hintToastCon.visible = false
    ctx.hintToastHideTimer = null
  }, 1700)
}
