// ============================================================
// ShopPanelView — 商店面板 PixiJS UI
// 布局（y=0 起，canvas 宽 640px）：
//   3 个商品槽，图标显示风格与背包一致（仅底部增加名称/价格）
//   不绘制外层卡片边框
// ============================================================

import {
  Container, Graphics, Text, Sprite,
  Assets, Texture, Rectangle, Ticker, type FederatedPointerEvent,
} from 'pixi.js'
import type { ShopSlot } from './ShopManager'
import { normalizeSize } from '@/items/ItemDef'
import { CELL_SIZE, CELL_HEIGHT } from '@/grid/GridZone'
import { getConfig as getGameConfig } from '@/core/DataLoader'
import { getItemIconUrl } from '@/core/assetPath'
import { getTierColor } from '@/config/colorPalette'
import { createItemStatBadges } from '@/ui/itemStatBadges'

// ---- 布局常量 ----
const CARDS_Y  = 8
const ICON_AREA_H = CELL_HEIGHT
const CARD_GAP_MAX = 4

// 统一底部区域（名称 + 价格）
const BOTTOM_H = 72
const SHOP_DRAG_START_PX = 8

export class ShopPanelView extends Container {
  private cards: Container[] = []
  private tierBorderWidth = 4
  private cornerRadius = 10
  private labelText: Text
  private lastPool: ShopSlot[] | null = null
  private lastGold: number | null = null
  private selectedSlot = -1
  private textSize = {
    itemName: getGameConfig().textSizes.shopItemName,
    itemPrice: getGameConfig().textSizes.shopItemPrice,
    itemBought: getGameConfig().textSizes.shopItemBought,
    itemStatBadge: getGameConfig().textSizes.itemStatBadge,
  }
  private itemStatBadgeOffsetY = 0
  private upgradeHintSlots = new Set<number>()
  private upgradeHintTick: (() => void) | null = null
  private upgradeHintT = 0

  // 内容容器：用于整体缩放（5/6）+ 居中
  private content: Container
  private itemScale = getGameConfig().itemVisualScale

  /** 拖拽开始回调（ShopScene 负责创建浮层和购买逻辑） */
  onDragStart: (slotIndex: number, e: FederatedPointerEvent) => void = () => {}
  /** 轻触回调（用于显示物品详情） */
  onTap: (slotIndex: number) => void = () => {}

  constructor() {
    super()
    this.labelText = new Text({
      text: '商店',
      style: { fontSize: getGameConfig().textSizes.gridZoneLabel, fill: 0xaaaacc, fontFamily: 'Arial' },
    })
    this.labelText.y = -32
    this.addChild(this.labelText)

    this.content = new Container()
    this.addChild(this.content)
  }

  // ---- 公共更新 API ----

  /** 刷新卡片显示（在购买/刷新后调用） */
  update(pool: ShopSlot[], gold: number): void {
    this.lastPool = pool
    this.lastGold = gold
    this._rebuildCards(pool, gold)
  }

  setTierBorderWidth(width: number): void {
    this.tierBorderWidth = Math.max(1, width)
    if (this.lastPool && this.lastGold !== null) {
      this._rebuildCards(this.lastPool, this.lastGold)
    }
  }

  setSlotDragging(slotIndex: number, dragging: boolean): void {
    const card = this.cards[slotIndex]
    if (!card) return
    card.visible = !dragging
  }

  setSelectedSlot(slotIndex: number): void {
    this.selectedSlot = slotIndex
    for (let i = 0; i < this.cards.length; i++) {
      const frame = this.cards[i]?.getChildByName('shop-selected-frame') as Graphics | null
      if (frame) frame.visible = i === slotIndex
    }
  }

  setTextSizes(sizes: { itemName: number; itemPrice: number; itemBought: number }): void {
    this.textSize = { ...this.textSize, ...sizes }
    if (this.lastPool && this.lastGold !== null) {
      this._rebuildCards(this.lastPool, this.lastGold)
    }
  }

  setStatBadgeFontSize(size: number): void {
    this.textSize.itemStatBadge = size
    if (this.lastPool && this.lastGold !== null) {
      this._rebuildCards(this.lastPool, this.lastGold)
    }
  }

  setStatBadgeOffsetY(offsetY: number): void {
    this.itemStatBadgeOffsetY = offsetY
    if (this.lastPool && this.lastGold !== null) {
      this._rebuildCards(this.lastPool, this.lastGold)
    }
  }

  setLabelFontSize(size: number): void {
    this.labelText.style.fontSize = size
  }

  setLabelGlobalLeft(globalX: number): void {
    const sx = this.scale.x || 1
    this.labelText.x = (globalX - this.x) / sx
  }

  setUpgradeHints(slotIndexes: number[]): void {
    this.upgradeHintSlots = new Set(slotIndexes)
    for (let i = 0; i < this.cards.length; i++) {
      const arrow = this.cards[i]?.getChildByName('shop-upgrade-arrow') as Graphics | null
      if (!arrow) continue
      arrow.visible = this.upgradeHintSlots.has(i)
    }
    if (this.upgradeHintSlots.size > 0 && !this.upgradeHintTick) {
      this.startUpgradeHintAnim()
    }
    if (this.upgradeHintSlots.size === 0 && this.upgradeHintTick) {
      this.stopUpgradeHintAnim()
    }
  }

  setCornerRadius(radius: number): void {
    this.cornerRadius = Math.max(0, radius)
    if (this.lastPool && this.lastGold !== null) {
      this._rebuildCards(this.lastPool, this.lastGold)
    }
  }

  setItemScale(scale: number): void {
    this.itemScale = Math.max(0.5, Math.min(1.2, scale))
    if (this.lastPool && this.lastGold !== null) {
      this._rebuildCards(this.lastPool, this.lastGold)
    }
  }

  // ---- 私有：卡片区 ----

  private _rebuildCards(pool: ShopSlot[], gold: number): void {
    for (const c of this.cards) this.content.removeChild(c)
    this.cards = []

    const scale = this.itemScale
    this.content.scale.set(scale)

    const widths = pool.map((slot) => {
      const size = normalizeSize(slot.item.size)
      const wCells = size === '1x1' ? 1 : size === '2x1' ? 2 : 3
      return wCells * CELL_SIZE
    })
    const widthSum = widths.reduce((a, b) => a + b, 0)
    const gapCount = Math.max(0, pool.length - 1)
    const availableGap = gapCount > 0 ? Math.floor((640 / scale - widthSum) / gapCount) : 0
    const gap = Math.max(0, Math.min(CARD_GAP_MAX, availableGap))
    const totalW = widthSum + gapCount * gap
    this.content.x = (640 - totalW * scale) / 2
    this.content.y = CARDS_Y / scale

    let cursorX = 0
    for (let i = 0; i < pool.length; i++) {
      const slot = pool[i]!
      const card = this._buildCard(slot, i, gold)
      card.x = cursorX
      card.y = 0
      cursorX += widths[i]! + gap

      this.content.addChild(card)
      this.cards.push(card)
    }
  }

  private _buildCard(slot: ShopSlot, slotIndex: number, gold: number): Container {
    const card      = new Container()
    const tier      = slot.tier
    const tierColor = getTierColor(tier)
    const canAfford = gold >= slot.price
    const bought    = slot.purchased

    // ---- 物品图标区（实际格子尺寸）----
    const size  = normalizeSize(slot.item.size)
    const wCells = size === '1x1' ? 1 : size === '2x1' ? 2 : 3
    const hCells = 1
    const iconW  = wCells * CELL_SIZE
    const iconH  = hCells * CELL_HEIGHT

    const tileW = iconW
    const tileH = ICON_AREA_H + BOTTOM_H

    const iconX = 0
    const iconY = 0

    // 点击/拖拽命中区域：与物品图标宽度一致（从图标顶部延伸至卡片底部，含名称/价格区）
    card.hitArea = new Rectangle(iconX, iconY, iconW, tileH - iconY)

    // 图标背景（与背包一致）+ 品质外框
    const iconBg = new Graphics()
    const frameInset = Math.max(3, 2 + Math.ceil(this.tierBorderWidth / 2))
    const frameW = Math.max(1, iconW - frameInset * 2)
    const frameH = Math.max(1, iconH - frameInset * 2)
    const frameRadius = Math.max(0, this.cornerRadius - Math.floor(frameInset / 2))
    iconBg.roundRect(iconX + frameInset, iconY + frameInset, frameW, frameH, frameRadius)
    iconBg.fill({ color: 0x2a2a3e, alpha: 0.85 })
    iconBg.stroke({ color: tierColor, width: this.tierBorderWidth, alpha: bought ? 0.55 : 0.98 })
    if (tier === 'Diamond') {
      const innerInset = frameInset + this.tierBorderWidth + 1
      const innerW = Math.max(1, iconW - innerInset * 2)
      const innerH = Math.max(1, iconH - innerInset * 2)
      iconBg.roundRect(iconX + innerInset, iconY + innerInset, innerW, innerH, Math.max(0, frameRadius - 2))
      iconBg.stroke({ color: 0xe8fbff, width: 2, alpha: bought ? 0.45 : 0.92 })
    }
    card.addChild(iconBg)

    const statBadges = createItemStatBadges(slot.item, this.textSize.itemStatBadge, Math.max(44, iconW - 8))
    statBadges.x = iconX + iconW / 2
    statBadges.y = iconY + this.itemStatBadgeOffsetY

    // 图标 Sprite（异步加载）
    const iconSprite = new Sprite(Texture.WHITE)
    iconSprite.width  = iconW - 12
    iconSprite.height = iconH - 12
    iconSprite.x      = iconX + 6
    iconSprite.y      = iconY + 6
    iconSprite.alpha  = 0
    card.addChild(iconSprite)

    const url = getItemIconUrl(slot.item.id)
    Assets.load<Texture>(url).then(tex => {
      iconSprite.texture = tex
      iconSprite.alpha   = bought ? 0.4 : (canAfford ? 1 : 0.55)
    }).catch((err) => {
      console.warn('[ShopPanelView] 图标加载失败', url, err)
    })

    // ---- 物品名称 ----
    const nameText = new Text({
        text: slot.item.name_cn,
        style: {
        fontSize: this.textSize.itemName,
        fill: bought ? 0x555566 : 0xddddee,
        fontFamily: 'Arial',
        wordWrap: true,
        wordWrapWidth: tileW - 8,
        align: 'center',
      },
    })
    nameText.x = (tileW - nameText.width) / 2
    nameText.y = ICON_AREA_H + 4
    card.addChild(nameText)

    // ---- 价格标签 ----
    const priceRow = new Container()
    const priceBg  = new Graphics()
    const priceW   = 74
    const priceH   = 28
    priceBg.roundRect(0, 0, priceW, priceH, 8)
    const priceColor = bought ? 0x222233 : (canAfford ? 0x2a4a2a : 0x3a1a1a)
    priceBg.fill({ color: priceColor, alpha: 0.9 })
    priceRow.addChild(priceBg)

    const priceText = new Text({
        text: `${slot.price}G`,
        style: {
        fontSize: this.textSize.itemPrice,
        fill: bought ? 0x444455 : (canAfford ? 0xffd700 : 0xff6666),
        fontFamily: 'Arial',
        fontWeight: 'bold',
      },
    })
    priceText.x = (priceW - priceText.width) / 2
    priceText.y = (priceH - priceText.height) / 2
    priceRow.addChild(priceText)

    priceRow.x = (tileW - priceW) / 2
    priceRow.y = tileH - priceH - 6
    card.addChild(priceRow)

    // ---- 已购遮罩 ----
    if (bought) {
      const overlay = new Graphics()
      overlay.roundRect(iconX + frameInset, iconY + frameInset, frameW, frameH, frameRadius)
      overlay.fill({ color: 0x000000, alpha: 0.42 })
      card.addChild(overlay)

      const boughtText = new Text({
        text: '已购',
        style: { fontSize: this.textSize.itemBought, fill: 0x8888aa, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      boughtText.x = (tileW - boughtText.width) / 2
      boughtText.y = iconY + (iconH - boughtText.height) / 2
      card.addChild(boughtText)
    }

    const upArrow = new Graphics()
    upArrow.name = 'shop-upgrade-arrow'
    upArrow.visible = this.upgradeHintSlots.has(slotIndex)
    // 2x 放大箭头（40x48）
    upArrow.moveTo(0, 24)
    upArrow.lineTo(20, 0)
    upArrow.lineTo(40, 24)
    upArrow.lineTo(28, 24)
    upArrow.lineTo(28, 48)
    upArrow.lineTo(12, 48)
    upArrow.lineTo(12, 24)
    upArrow.fill({ color: 0xffffff, alpha: 0.95 })
    upArrow.stroke({ color: 0x1a1a2a, width: 3, alpha: 0.85 })
    // 箭头位于物品可视区域中心
    upArrow.x = iconX + iconW / 2 - 20
    upArrow.y = iconY + iconH / 2 - 24
    ;(upArrow as any)._baseY = upArrow.y
    card.addChild(upArrow)

    // 选中框：贴合物品图标区（透明 fill 确保 PixiJS v8 正确渲染 stroke-only 形状）
    const selectedFrame = new Graphics()
    selectedFrame.name = 'shop-selected-frame'
    selectedFrame.roundRect(iconX + 1, iconY + 1, iconW - 2, iconH - 2, this.cornerRadius)
    selectedFrame.fill({ color: 0x000000, alpha: 0 })
    selectedFrame.stroke({ color: 0xffffff, width: 4, alpha: 0.95 })
    selectedFrame.visible = this.selectedSlot === slotIndex
    card.addChild(selectedFrame)

    // 数值徽标保持在选中框之上
    card.addChild(statBadges)

    // ---- 交互：拖拽开始 ----
    if (!bought) {
      card.eventMode = 'static'
      card.cursor    = canAfford ? 'grab' : 'pointer'

      let pressedId = -1
      let pressX = 0
      let pressY = 0
      let dragging = false

      card.on('pointerdown', (e: FederatedPointerEvent) => {
        e.stopPropagation()
        pressedId = e.pointerId
        pressX = e.globalX
        pressY = e.globalY
        dragging = false
      })

      card.on('pointermove', (e: FederatedPointerEvent) => {
        if (!canAfford || pressedId !== e.pointerId || dragging) return
        const dx = e.globalX - pressX
        const dy = e.globalY - pressY
        if (Math.hypot(dx, dy) >= SHOP_DRAG_START_PX) {
          dragging = true
          this.onDragStart(slotIndex, e)
        }
      })

      const onRelease = (e: FederatedPointerEvent) => {
        if (pressedId !== e.pointerId) return
        if (!dragging) this.onTap(slotIndex)
        pressedId = -1
        dragging = false
      }

      card.on('pointerup', onRelease)
      card.on('pointerupoutside', onRelease)

    }

    return card
  }

  private startUpgradeHintAnim(): void {
    this.upgradeHintT = 0
    this.upgradeHintTick = () => {
      this.upgradeHintT += 0.08
      const wave = (Math.sin(this.upgradeHintT) + 1) / 2
      for (const idx of this.upgradeHintSlots) {
        const arrow = this.cards[idx]?.getChildByName('shop-upgrade-arrow') as Graphics | null
        if (!arrow) continue
        arrow.alpha = 0.55 + wave * 0.45
        const baseY = (arrow as any)._baseY ?? arrow.y
        arrow.y = baseY + Math.sin(this.upgradeHintT * 1.6 + idx) * 6
      }
    }
    Ticker.shared.add(this.upgradeHintTick)
  }

  private stopUpgradeHintAnim(): void {
    if (!this.upgradeHintTick) return
    Ticker.shared.remove(this.upgradeHintTick)
    this.upgradeHintTick = null
  }
}
