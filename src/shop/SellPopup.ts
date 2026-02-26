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

const DEFAULT_POPUP_W = 400
const POPUP_MIN_H = 240
const POPUP_MIN_W = 360

const TIER_COLORS: Record<string, number> = {
  Bronze: 0xcd7f32,
  Silver: 0xaaaacc,
  Gold: 0xffbf1f,
  Diamond: 0x48e9ff,
}

const TIER_LABELS: Record<string, string> = {
  Bronze: '青铜',
  Silver: '白银',
  Gold: '黄金',
  Diamond: '钻石',
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
  private panel:   Container      // 弹窗主体
  private panelBg: Graphics
  private iconSp:  Sprite
  private iconFrame: Graphics
  private nameT:   Text
  private tierBadgeBg: Graphics
  private tierBadgeT: Text
  private priceT:  Text
  private descT:   Text
  private lastItem: ItemDef | null = null
  private lastPrice = 0
  private lastPriceMode: 'sell' | 'buy' = 'sell'
  private lastTierOverride: string | undefined = undefined
  private textSize = { name: 22, tier: 14, price: 20, desc: 16 }
  private cornerRadius = 10

  constructor(canvasW: number, _canvasH: number) {
    super()
    this.canvasW = canvasW

    const ts = getGameConfig().textSizes
    this.textSize = {
      name: ts.itemInfoName,
      tier: ts.itemInfoTier,
      price: ts.itemInfoPrice,
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

    // 出售价格
    this.priceT = new Text({
      text: '',
      style: { fontSize: this.textSize.price, fill: 0xffd700, fontFamily: 'Arial', align: 'left' },
    })
    this.panel.addChild(this.priceT)

    // 技能描述
    this.descT = new Text({
        text: '',
        style: {
        fontSize: this.textSize.desc,
        fill: 0xbfc7f5,
        fontFamily: 'Arial',
        wordWrap: true,
        wordWrapWidth: this.panelW - 36,
        breakWords: true,
        lineHeight: 22,
      },
    })
    this.panel.addChild(this.descT)

    this.addChild(this.panel)
    this.visible = false
  }

  setAnchor(x: number, y: number): void {
    void x
    this.anchorY = y
    this.applyPanelPosition()
  }

  setBottomAnchor(bottomY: number): void {
    this.anchorBottomY = bottomY
    this.applyPanelPosition()
  }

  clearBottomAnchor(): void {
    this.anchorBottomY = null
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

  setTextSizes(sizes: { name?: number; tier?: number; price?: number; desc?: number }): void {
    const n = (v: unknown, fallback: number) => {
      const x = Number(v)
      return Number.isFinite(x) ? Math.max(1, x) : fallback
    }
    this.textSize = {
      name:  n(sizes.name,  this.textSize.name),
      tier:  n(sizes.tier,  this.textSize.tier),
      price: n(sizes.price, this.textSize.price),
      desc:  n(sizes.desc,  this.textSize.desc),
    }
    this.nameT.style.fontSize  = this.textSize.name
    this.tierBadgeT.style.fontSize = this.textSize.tier
    this.priceT.style.fontSize = this.textSize.price
    this.descT.style.fontSize  = this.textSize.desc
    if (this.lastItem) this.show(this.lastItem, this.lastPrice, this.lastPriceMode, this.lastTierOverride)
  }

  setCornerRadius(radius: number): void {
    this.cornerRadius = Math.max(0, radius)
    if (this.lastItem) this.show(this.lastItem, this.lastPrice, this.lastPriceMode, this.lastTierOverride)
  }

  setWidth(width: number): void {
    this.panelW = Math.max(POPUP_MIN_W, Math.min(this.canvasW, width))
    this.descT.style.wordWrapWidth = this.panelW - 36
    this.nameT.style.wordWrapWidth = this.panelW - 24
    if (this.lastItem) {
      this.show(this.lastItem, this.lastPrice, this.lastPriceMode, this.lastTierOverride)
    } else {
      this.redrawPanel(POPUP_MIN_H)
      this.setAnchor(0, this.anchorY)
    }
  }

  /** 展示弹窗（需传入物品信息及出售价格） */
  show(item: ItemDef, price: number, priceMode: 'sell' | 'buy' = 'sell', tierOverride?: string): void {
    this.lastItem = item
    this.lastPrice = price
    this.lastPriceMode = priceMode
    this.lastTierOverride = tierOverride
    const cfg = getGameConfig()
    const visualScale = cfg.itemVisualScale
    const size = normalizeSize(item.size)
    const iconW = (size === '2x2' ? CELL_SIZE * 2 : CELL_SIZE) * visualScale
    const iconH = ((size === '1x2' || size === '2x2') ? CELL_SIZE * 2 : CELL_SIZE) * visualScale
    this.currentMinH = size === '1x1' ? this.minHSmall : this.minH

    const pad = 16
    const gap = 14
    const top = 16

    this.iconSp.width = iconW - 8
    this.iconSp.height = iconH - 8
    this.iconSp.x = pad + 4
    this.iconSp.y = top + 4

    const tier = tierOverride ?? item.starting_tier.split('/')[0]?.trim() ?? 'Bronze'
    const tierColor = TIER_COLORS[tier] ?? 0xaaaaaa
    const tierLabel = TIER_LABELS[tier] ?? '青铜'
    this.iconFrame.clear()
    this.iconFrame.roundRect(this.iconSp.x - 4, this.iconSp.y - 4, this.iconSp.width + 8, this.iconSp.height + 8, this.cornerRadius)
    this.iconFrame.stroke({ color: tierColor, width: 4, alpha: 0.98 })

    const rightX = this.iconSp.x + this.iconSp.width + 8 + gap
    const rightW = Math.max(120, this.panelW - rightX - pad)
    this.nameT.style.wordWrapWidth = rightW
    this.descT.style.wordWrapWidth = rightW

    // 先更新字体与换行宽度，再赋值文本，确保自动换行生效且换行位置正确
    this.nameT.style.fontSize  = this.textSize.name
    this.tierBadgeT.style.fontSize = this.textSize.tier
    this.priceT.style.fontSize = this.textSize.price
    this.descT.style.fontSize  = this.textSize.desc

    this.nameT.text  = item.name_cn
    this.priceT.text = `${priceMode === 'buy' ? '购买价格' : '出售价格'}：💰 ${price}G`

    const skillLines = item.skills
      .map((s) => s.cn?.trim())
      .filter((s) => Boolean(s))
    this.descT.text = skillLines.length > 0
      ? skillLines.join('\n')
      : '(暂无文本)'

    this.nameT.x = rightX
    this.nameT.y = top + 2

    this.tierBadgeT.text = tierLabel
    const badgePadX = 10
    const badgePadY = 4
    const badgeW = this.tierBadgeT.width + badgePadX * 2
    const badgeH = this.tierBadgeT.height + badgePadY * 2
    const nameTierGap = Math.max(16, Math.round(this.textSize.tier * 2))
    this.tierBadgeT.x = Math.min(this.panelW - pad - badgeW + badgePadX, rightX + this.nameT.width + nameTierGap + badgePadX)
    this.tierBadgeT.y = this.nameT.y + 2
    this.tierBadgeBg.clear()
    this.tierBadgeBg.roundRect(this.tierBadgeT.x - badgePadX, this.tierBadgeT.y - badgePadY, badgeW, badgeH, 8)
    this.tierBadgeBg.fill({ color: tierColor, alpha: 0.92 })
    this.tierBadgeBg.stroke({ color: 0xffffff, width: 1, alpha: 0.5 })

    this.priceT.x = rightX
    this.priceT.y = Math.max(this.nameT.y + this.nameT.height, this.tierBadgeT.y + this.tierBadgeT.height) + 8
    this.descT.x = rightX
    this.descT.y = this.priceT.y + this.priceT.height + 12

    const iconBottom = this.iconFrame.y + this.iconFrame.height
    const textBottom = this.descT.y + this.descT.height + pad
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
    if (this.anchorBottomY !== null) {
      this.panel.y = this.anchorBottomY - this.panelH
    } else {
      this.panel.y = this.anchorY + (this.currentMinH - this.panelH)
    }
  }
}
