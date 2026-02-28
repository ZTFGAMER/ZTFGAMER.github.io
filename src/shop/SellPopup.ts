// ============================================================
// SellPopup — 物品信息浮层（仅展示，不含操作按钮）
// 非模态：不使用全屏遮罩，可放在指定位置
// ============================================================

import {
  Container, Graphics, Text, Sprite,
  Assets, Texture,
} from 'pixi.js'
import type { ItemDef } from '@/items/ItemDef'
import { getConfig as getGameConfig } from '@/core/DataLoader'
import { normalizeSize } from '@/items/ItemDef'
import { CELL_SIZE } from '@/grid/GridZone'
import { getItemIconUrl } from '@/core/assetPath'
import { getTierColor } from '@/config/colorPalette'

const DEFAULT_POPUP_W = 400
const POPUP_MIN_H = 240
const POPUP_MIN_W = 360

const TIER_LABELS: Record<string, string> = {
  Bronze: '青铜',
  Silver: '白银',
  Gold: '黄金',
  Diamond: '钻石',
}

const TIER_ORDER = ['Bronze', 'Silver', 'Gold', 'Diamond'] as const

function parseTierName(raw: string): string {
  for (const t of TIER_ORDER) {
    if (raw.includes(t)) return t
  }
  return ''
}

function parseAvailableTiers(raw: string): string[] {
  const s = (raw || '').trim()
  if (!s) return [...TIER_ORDER]
  const out = s
    .split('/')
    .map(v => parseTierName(v.trim()))
    .filter((v): v is string => Boolean(v))
  const uniq = Array.from(new Set(out))
  return uniq.length > 0 ? uniq : [...TIER_ORDER]
}

function pickTierValue(series: string, tierIndex: number): string {
  const parts = series.split('/').map(v => v.trim()).filter(Boolean)
  if (parts.length <= 1) return series
  const idx = Math.max(0, Math.min(parts.length - 1, tierIndex))
  return parts[idx] ?? parts[0] ?? series
}

function formatDescByTier(raw: string, tierIndex: number): string {
  // 仅替换纯数值分档：10/20/30(/40)、1.5/2/2.5
  return raw.replace(/\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)+/g, (m) => pickTierValue(m, tierIndex))
}

function formatCooldownLine(item: ItemDef, tierIndex: number): string | null {
  const rawTier = (item.cooldown_tiers ?? '').trim()

  let ms = Number.NaN
  if (rawTier && rawTier !== '无') {
    const picked = pickTierValue(rawTier, tierIndex)
    const n = Number(picked)
    if (Number.isFinite(n)) ms = n
  }
  if (!Number.isFinite(ms)) ms = Number(item.cooldown)

  if (!Number.isFinite(ms) || ms <= 0) return null
  const sec = ms / 1000
  const text = (Math.round(sec * 10) / 10).toFixed(1)
  return `冷却：${text}秒`
}

export class SellPopup extends Container {
  private canvasW: number
  private panelW = DEFAULT_POPUP_W
  private minH = POPUP_MIN_H
  private minHSmall = 180
  private currentMinH = POPUP_MIN_H
  private panelH = POPUP_MIN_H
  private anchorY = 100
  private anchorBottomY: number | null = null
  private anchorCenterY: number | null = null
  private panel:   Container      // 弹窗主体
  private panelBg: Graphics
  private iconSp:  Sprite
  private iconFrame: Graphics
  private nameT:   Text
  private tierBadgeBg: Graphics
  private tierBadgeT: Text
  private cooldownT: Text
  private priceT:  Text
  private descCon: Container
  private descDividerG: Graphics
  private descTexts: Text[] = []
  private lastItem: ItemDef | null = null
  private lastPrice = 0
  private lastPriceMode: 'sell' | 'buy' | 'none' = 'sell'
  private lastTierOverride: string | undefined = undefined
  private textSize = { name: 22, tier: 14, cooldown: 16, priceCorner: 20, desc: 16 }
  private cornerRadius = 10

  constructor(canvasW: number, _canvasH: number) {
    super()
    this.canvasW = canvasW

    const ts = getGameConfig().textSizes
    this.textSize = {
      name: ts.itemInfoName,
      tier: ts.itemInfoTier,
      cooldown: ts.itemInfoCooldown,
      priceCorner: ts.itemInfoPriceCorner,
      desc: ts.itemInfoDesc,
    }

    // 弹窗面板
    this.panel = new Container()
    this.panel.x = (canvasW - this.panelW) / 2
    this.panel.y = 100
    this.panel.eventMode = 'static'
    this.panel.on('pointerdown', (e) => e.stopPropagation())

    // 面板背景
    this.panelBg = new Graphics()
    this.panel.addChild(this.panelBg)
    this.redrawPanel(POPUP_MIN_H)

    // 物品图标（按实际尺寸 + item_visual_scale）
    this.iconSp         = new Sprite(Texture.WHITE)
    this.iconSp.width   = 1
    this.iconSp.height  = 1
    this.iconSp.x       = 0
    this.iconSp.y       = 0
    this.iconSp.alpha   = 0
    this.panel.addChild(this.iconSp)

    this.iconFrame = new Graphics()
    this.panel.addChild(this.iconFrame)

    // 物品名
    this.nameT = new Text({
        text: '',
        style: {
        fontSize: this.textSize.name,
        fill: 0xddddee,
        fontFamily: 'Arial',
        align: 'left',
        wordWrap: true,
        wordWrapWidth: this.panelW - 24,
        breakWords: true,
        lineHeight: 28,
      },
    })
    this.panel.addChild(this.nameT)

    this.tierBadgeBg = new Graphics()
    this.panel.addChild(this.tierBadgeBg)

    this.tierBadgeT = new Text({
      text: '',
      style: {
        fontSize: this.textSize.tier,
        fill: 0xffffff,
        fontFamily: 'Arial',
        fontWeight: 'bold',
      },
    })
    this.panel.addChild(this.tierBadgeT)

    this.cooldownT = new Text({
      text: '',
      style: {
        fontSize: this.textSize.cooldown,
        fill: 0x62a8ff,
        fontFamily: 'Arial',
        fontWeight: 'bold',
      },
    })
    this.panel.addChild(this.cooldownT)

    // 出售价格
    this.priceT = new Text({
      text: '',
      style: { fontSize: this.textSize.priceCorner, fill: 0xffd700, fontFamily: 'Arial', align: 'left', fontWeight: 'bold' },
    })
    this.panel.addChild(this.priceT)

    // 技能描述（分行渲染 + 分隔线）
    this.descCon = new Container()
    this.descDividerG = new Graphics()
    this.descCon.addChild(this.descDividerG)
    this.panel.addChild(this.descCon)

    this.addChild(this.panel)
    this.visible = false
  }

  setAnchor(x: number, y: number): void {
    void x
    this.anchorY = y
    this.anchorCenterY = null
    this.applyPanelPosition()
  }

  setBottomAnchor(bottomY: number): void {
    this.anchorBottomY = bottomY
    this.anchorCenterY = null
    this.applyPanelPosition()
  }

  clearBottomAnchor(): void {
    this.anchorBottomY = null
    this.applyPanelPosition()
  }

  setCenterY(centerY: number): void {
    this.anchorBottomY = null
    this.anchorCenterY = centerY
    this.applyPanelPosition()
  }

  setMinHeight(height: number): void {
    this.minH = Math.max(0, height)
    this.currentMinH = this.minH
    if (this.lastItem) {
      this.show(this.lastItem, this.lastPrice, this.lastPriceMode, this.lastTierOverride)
    } else {
      this.redrawPanel(this.minH)
      this.setAnchor(0, this.anchorY)
    }
  }

  setSmallMinHeight(height: number): void {
    this.minHSmall = Math.max(0, height)
    if (this.lastItem) {
      this.show(this.lastItem, this.lastPrice, this.lastPriceMode, this.lastTierOverride)
    }
  }

  setTextSizes(sizes: { name?: number; tier?: number; cooldown?: number; priceCorner?: number; desc?: number }): void {
    const n = (v: unknown, fallback: number) => {
      const x = Number(v)
      return Number.isFinite(x) ? Math.max(1, x) : fallback
    }
    this.textSize = {
      name:  n(sizes.name,  this.textSize.name),
      tier:  n(sizes.tier,  this.textSize.tier),
      cooldown: n(sizes.cooldown, this.textSize.cooldown),
      priceCorner: n(sizes.priceCorner, this.textSize.priceCorner),
      desc:  n(sizes.desc,  this.textSize.desc),
    }
    this.nameT.style.fontSize  = this.textSize.name
    this.tierBadgeT.style.fontSize = this.textSize.tier
    this.cooldownT.style.fontSize = this.textSize.cooldown
    this.priceT.style.fontSize = this.textSize.priceCorner
    if (this.lastItem) this.show(this.lastItem, this.lastPrice, this.lastPriceMode, this.lastTierOverride)
  }

  setCornerRadius(radius: number): void {
    this.cornerRadius = Math.max(0, radius)
    if (this.lastItem) this.show(this.lastItem, this.lastPrice, this.lastPriceMode, this.lastTierOverride)
  }

  setWidth(width: number): void {
    this.panelW = Math.max(POPUP_MIN_W, Math.min(this.canvasW, width))
    this.nameT.style.wordWrapWidth = this.panelW - 24
    if (this.lastItem) {
      this.show(this.lastItem, this.lastPrice, this.lastPriceMode, this.lastTierOverride)
    } else {
      this.redrawPanel(POPUP_MIN_H)
      this.setAnchor(0, this.anchorY)
    }
  }

  /** 展示弹窗（需传入物品信息及出售价格） */
  show(item: ItemDef, price: number, priceMode: 'sell' | 'buy' | 'none' = 'sell', tierOverride?: string): void {
    this.lastItem = item
    this.lastPrice = price
    this.lastPriceMode = priceMode
    this.lastTierOverride = tierOverride
    const cfg = getGameConfig()
    const visualScale = cfg.itemVisualScale
    const size = normalizeSize(item.size)
    const baseIconW = (size === '1x1' ? CELL_SIZE : size === '2x1' ? CELL_SIZE * 2 : CELL_SIZE * 3) * visualScale
    const baseIconH = (CELL_SIZE * 2) * visualScale
    const iconW = baseIconW * (2 / 3)
    const iconH = baseIconH * (2 / 3)
    this.currentMinH = size === '1x1' ? this.minHSmall : this.minH

    const pad = 16
    const gap = 14
    const top = 14

    const tier = tierOverride ?? (parseTierName(item.starting_tier) || 'Bronze')
    const tierColor = getTierColor(tier)
    const tierLabel = TIER_LABELS[tier] ?? '青铜'
    const availableTiers = parseAvailableTiers(item.available_tiers)
    const tierIndex = Math.max(0, availableTiers.indexOf(tier))
    // 先更新字体，再计算布局
    this.nameT.style.fontSize  = this.textSize.name
    this.tierBadgeT.style.fontSize = this.textSize.tier
    this.cooldownT.style.fontSize = this.textSize.cooldown
    this.priceT.style.fontSize = this.textSize.priceCorner

    this.nameT.text  = item.name_cn
    this.priceT.text = priceMode === 'none' ? '' : `${priceMode === 'buy' ? '购买价格' : '出售价格'}：💰 ${price}G`
    this.priceT.visible = priceMode !== 'none'
    const cooldownLine = formatCooldownLine(item, tierIndex)
    this.cooldownT.text = cooldownLine ?? ''
    this.cooldownT.visible = Boolean(cooldownLine)

    const skillLines = item.skills
      .map((s) => s.cn?.trim())
      .filter((s) => Boolean(s))
      .map((s) => formatDescByTier(s, tierIndex))
    const descLines = skillLines.length > 0 ? skillLines : ['(暂无文本)']

    const frameX = pad
    const frameY = top
    // 边框与图标一致，统一缩小到 2/3
    const frameW = iconW
    const frameH = iconH

    const iconInset = 6
    this.iconSp.width = Math.max(1, frameW - iconInset * 2)
    this.iconSp.height = Math.max(1, frameH - iconInset * 2)
    this.iconSp.x = frameX + iconInset
    this.iconSp.y = frameY + iconInset

    this.iconFrame.clear()
    this.iconFrame.roundRect(frameX, frameY, frameW, frameH, this.cornerRadius)
    this.iconFrame.stroke({ color: tierColor, width: 4, alpha: 0.98 })

    const rightX = frameX + frameW + gap
    const rightW = Math.max(120, this.panelW - rightX - pad)
    this.nameT.style.wordWrap = false
    this.nameT.style.wordWrapWidth = rightW

    this.nameT.x = rightX
    this.nameT.y = top

    this.tierBadgeT.text = tierLabel
    const badgePadX = 10
    const badgePadY = 4
    const badgeW = this.tierBadgeT.width + badgePadX * 2
    const badgeH = this.tierBadgeT.height + badgePadY * 2
    const nameTierGap = Math.max(8, Math.round(this.textSize.tier * 0.8))
    this.cooldownT.x = this.panelW - pad - this.cooldownT.width
    this.cooldownT.y = top

    const tierMaxX = (this.cooldownT.visible ? this.cooldownT.x - 8 : (this.panelW - pad)) - badgeW + badgePadX
    this.tierBadgeT.x = Math.max(rightX + badgePadX, Math.min(tierMaxX, rightX + this.nameT.width + nameTierGap + badgePadX))
    this.tierBadgeT.y = this.nameT.y + 2
    this.tierBadgeBg.clear()
    this.tierBadgeBg.roundRect(this.tierBadgeT.x - badgePadX, this.tierBadgeT.y - badgePadY, badgeW, badgeH, 8)
    this.tierBadgeBg.fill({ color: tierColor, alpha: 0.92 })
    this.tierBadgeBg.stroke({ color: 0xffffff, width: 1, alpha: 0.5 })

    // 描述区布局
    this.descCon.x = rightX
    const headerH = Math.max(this.nameT.height, this.tierBadgeT.height, this.cooldownT.visible ? this.cooldownT.height : 0)
    this.descCon.y = top + headerH + 10
    this.descDividerG.clear()
    for (const t of this.descTexts) {
      if (t.parent) t.parent.removeChild(t)
      t.destroy()
    }
    this.descTexts = []

    let cursorY = 0
    const lineGap = 6
    for (let i = 0; i < descLines.length; i++) {
      const t = new Text({
        text: descLines[i] ?? '',
        style: {
          fontSize: this.textSize.desc,
          fill: 0xbfc7f5,
          fontFamily: 'Arial',
          wordWrap: true,
          wordWrapWidth: rightW,
          breakWords: true,
          lineHeight: Math.round(this.textSize.desc * 1.25),
        },
      })
      t.x = 0
      t.y = cursorY
      this.descCon.addChild(t)
      this.descTexts.push(t)
      cursorY += t.height
      if (descLines.length >= 2 && i < descLines.length - 1) {
        const y = cursorY + Math.max(2, Math.round(lineGap / 2))
        this.descDividerG.moveTo(0, y)
        this.descDividerG.lineTo(rightW, y)
        this.descDividerG.stroke({ color: 0x5a628f, width: 1, alpha: 0.9 })
        cursorY += lineGap + 2
      } else if (i < descLines.length - 1) {
        cursorY += lineGap
      }
    }

    this.priceT.x = this.panelW - pad - this.priceT.width
    const contentBottomPad = 12
    this.priceT.y = Math.max(this.descCon.y + cursorY + 8, frameY + frameH - this.priceT.height)

    const iconBottom = frameY + frameH
    const textBottom = this.priceT.visible
      ? (this.priceT.y + this.priceT.height + contentBottomPad)
      : (this.descCon.y + cursorY + contentBottomPad)
    const panelH = Math.max(this.currentMinH, Math.max(iconBottom + pad, textBottom))
    this.redrawPanel(panelH)
    this.applyPanelPosition()

    // 异步加载图标
    const url = getItemIconUrl(item.id)
    this.iconSp.alpha = 0
    Assets.load<Texture>(url).then(tex => {
      this.iconSp.texture = tex
      this.iconSp.alpha   = 1
    }).catch((err) => {
      console.warn('[SellPopup] 图标加载失败', url, err)
    })

    this.visible = true
  }

  hide(): void {
    this.visible = false
  }

  private redrawPanel(height: number): void {
    this.panelH = height
    this.panelBg.clear()
    this.panelBg.roundRect(0, 0, this.panelW, height, 18)
    this.panelBg.fill({ color: 0x1e1e30, alpha: 0.97 })
    this.panelBg.stroke({ color: 0x5566aa, width: 2 })
  }

  private applyPanelPosition(): void {
    this.panel.x = (this.canvasW - this.panelW) / 2
    if (this.anchorCenterY !== null) {
      this.panel.y = this.anchorCenterY - this.panelH / 2
    } else if (this.anchorBottomY !== null) {
      this.panel.y = this.anchorBottomY - this.panelH
    } else {
      this.panel.y = this.anchorY + (this.currentMinH - this.panelH)
    }
  }
}
