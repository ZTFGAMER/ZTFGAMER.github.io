// ============================================================
// GridZone — 单块网格区域的 PixiJS 渲染容器
// 负责：格子线框 / 物品 Sprite / 拖拽高亮 / 坐标转换
//
// 拖拽生命周期（与 DragController 协作）：
//   1. DragController 调用 startDragDetach → 物品从 itemLayer 摘出，返回信息
//   2. DragController 将物品放入 dragLayer，接管位置控制
//   3a. 成功放置同区域：DragController 调用 snapToCellFromDrag
//   3b. 成功放置跨区域：DragController 调用 forgetDraggedItem，再 addItem 到目标
//   3c. 放置失败弹回：DragController 动画结束后调用 restoreFromDrag
// ============================================================

import {
  Container, Graphics, Sprite, Text,
  Assets, Texture, Rectangle, Ticker,
  type FederatedPointerEvent,
} from 'pixi.js'
import type { ItemSizeNorm, PlacedItem } from './GridSystem'
import { getAllItems, getConfig as getGameConfig } from '@/core/DataLoader'

export const CELL_SIZE = 128

// ---- 尺寸表 ----

const SIZE_PX: Record<ItemSizeNorm, { pw: number; ph: number }> = {
  '1x1': { pw: CELL_SIZE,     ph: CELL_SIZE     },
  '1x2': { pw: CELL_SIZE,     ph: CELL_SIZE * 2 },
  '2x2': { pw: CELL_SIZE * 2, ph: CELL_SIZE * 2 },
}

/** 每种尺寸占用的格子数 [cols, rows] */
const SIZE_DIMS: Record<ItemSizeNorm, [number, number]> = {
  '1x1': [1, 1],
  '1x2': [1, 2],
  '2x2': [2, 2],
}

// 物品尺寸对应背景色（占位色，后期换真实卡牌背景）
const SIZE_COLOR: Record<ItemSizeNorm, number> = {
  '1x1': 0x4a6fa5,
  '1x2': 0x5a8a5a,
  '2x2': 0x8a5a3a,
}

const TIER_COLORS: Record<string, number> = {
  Bronze: 0xcd7f32,
  Silver: 0xaaaacc,
  Gold: 0xffbf1f,
  Diamond: 0x48e9ff,
}

let tierByDefId: Map<string, string> | null = null

function getTier(defId: string, tierOverride?: string): string {
  if (tierOverride) return tierOverride
  if (!tierByDefId) {
    tierByDefId = new Map<string, string>()
    for (const item of getAllItems()) {
      const tier = item.starting_tier.split('/')[0]?.trim() ?? 'Bronze'
      tierByDefId.set(item.id, tier)
    }
  }
  return tierByDefId.get(defId) ?? 'Bronze'
}

function getTierColor(tier: string): number {
  return TIER_COLORS[tier] ?? 0xaaaaaa
}

// ---- ItemNode ----

interface ItemNode {
  container:  Container
  visual:     Container
  bg:         Graphics
  selectedG:  Graphics
  upgradeArrow: Graphics
  upgradeBaseY: number
  sprite:     Sprite | null
  defId:      string
  tier?:      string
  col:        number
  row:        number
  size:       ItemSizeNorm
  /** 放置时的像素原点 X（相对于 GridZone） */
  origX:      number
  /** 放置时的像素原点 Y（相对于 GridZone） */
  origY:      number
}

// ============================================================
export class GridZone extends Container {
  readonly zoneCols:        number
  private _activeColCount:  number   // 已解锁的列数（其余显示为暗格）
  get activeColCount(): number { return this._activeColCount }
  autoPackEnabled = false

  private cellBg:     Graphics   // 静态格子背景
  itemLayer:          Container  // 物品层（DragController 归还物品时需访问）
  private hlOverlay:  Graphics   // 拖拽高亮层
  private labelText:  Text

  private nodes = new Map<string, ItemNode>()
  private tierBorderWidth = 4
  private cornerRadius = 10
  private cellBorderWidth = 1
  private selectedId: string | null = null
  private upgradeHintIds = new Set<string>()
  private upgradeHintTick: (() => void) | null = null
  private upgradeHintT = 0

  // 当前被拖拽的节点（状态追踪；位置由 DragController/dragLayer 管理）
  dragNode: ItemNode | null = null

  // 活跃的挤出动画 tick 函数（key = instanceId，可随时打断）
  private squeezeTicks = new Map<string, () => void>()
  // 活跃的预览动画 tick 函数（仅视觉，不更新逻辑坐标）
  private previewTicks = new Map<string, () => void>()

  /** Tap 回调，外部设置 */
  onTap: (instanceId: string) => void = () => {}

  constructor(label: string, zoneCols = 5, activeColCount = 5) {
    super()
    this.zoneCols        = zoneCols
    this._activeColCount = activeColCount

    // 分层：bg → itemLayer → hlOverlay
    this.cellBg    = new Graphics()
    this.itemLayer = new Container()
    this.hlOverlay = new Graphics()

    this.addChild(this.cellBg)
    this.addChild(this.itemLayer)
    this.addChild(this.hlOverlay)

    // 区域标签
    this.labelText = new Text({
      text: label,
      style: { fontSize: getGameConfig().textSizes.gridZoneLabel, fill: 0xaaaacc, fontFamily: 'Arial' },
    })
    this.labelText.y = -32
    this.addChild(this.labelText)

    this.drawCells()
  }

  // ---- 格子绘制 ----

  private drawCells(): void {
    const g = this.cellBg
    g.clear()
    const radius = this.cornerRadius
    const borderWidth = this.cellBorderWidth
    const inset = Math.max(1, Math.ceil(borderWidth / 2))
    for (let c = 0; c < this._activeColCount; c++) {
      for (let row = 0; row < 2; row++) {
        const x = c * CELL_SIZE
        const y = row * CELL_SIZE
        g.roundRect(x + inset, y + inset, CELL_SIZE - inset * 2, CELL_SIZE - inset * 2, Math.max(0, radius - inset))
        g.fill({ color: 0x2a2a3e })
        g.roundRect(x, y, CELL_SIZE, CELL_SIZE, radius)
        g.stroke({ color: 0x4a4a6e, width: borderWidth })
      }
    }
  }

  /** 动态更新活跃列数并重绘格子背景 */
  setActiveColCount(cols: number): void {
    this._activeColCount = Math.max(1, Math.min(this.zoneCols, cols))
    this.drawCells()
  }

  setAutoPackEnabled(enabled: boolean): void {
    this.autoPackEnabled = enabled
  }

  // ---- 坐标转换 ----

  /** 画布坐标 → 格子坐标（超出区域返回 null） */
  pixelToCell(globalX: number, globalY: number): { col: number; row: number } | null {
    const local = this.toLocal({ x: globalX, y: globalY })
    const col   = Math.floor(local.x / CELL_SIZE)
    const row   = Math.floor(local.y / CELL_SIZE)
    if (col < 0 || col >= this._activeColCount || row < 0 || row >= 2) return null
    return { col, row }
  }

  /**
   * 基于物品视觉位置（含拖拽偏移）计算应落在的格子。
   *
   * X 锚点规则（统一 = 物品左侧 CELL_SIZE/2 处）：
   *   - 1x1 / 1x2（宽=CELL_SIZE=128px）→ 物品水平中心
   *   - 2x2（宽=CELL_SIZE*2=256px）     → 物品左1/4处
   *
   * Y 规则：
   *   - 1x1：中心点检测 row（row 0 或 row 1）
   *   - 1x2 / 2x2：强制 row=0，只检测视觉中心 Y 是否在区域范围内
   */
  /**
   * 基于物品视觉位置（含拖拽偏移）计算应落在的格子。
   *
   * X 锚点规则：
   *   - 1x1 / 1x2（单列宽）: 手指坐标即物品水平中心，直接检测手指所在列
   *   - 2x2（双列宽）:       手指在物品中心，以 (手指 - CELL_SIZE/2) 检测左1/4列
   *
   * Y 规则：
   *   - 1x1：手指视觉中心 Y 检测 row
   *   - 1x2 / 2x2：强制 row=0，只宽松检测视觉中心 Y 在区域范围内
   */
  pixelToCellForItem(
    globalX:    number,
    globalY:    number,
    size:       ItemSizeNorm,
    dragOffsetY = 0,
  ): { col: number; row: number } | null {
    const [w, h] = SIZE_DIMS[size]
    const { ph } = SIZE_PX[size]

    // X：1x1/1x2 直接用手指位置（= 物品中心）；2x2 用手指 - CELL_SIZE/2（= 物品左1/4）
    const anchorGx = w === 1 ? globalX : globalX - CELL_SIZE / 2

    // Y：手指视觉中心 Y（含拖拽偏移）
    const anchorGy = globalY + dragOffsetY

    const local = this.toLocal({ x: anchorGx, y: anchorGy })
    const col   = Math.floor(local.x / CELL_SIZE)
    if (col < 0 || col + w > this._activeColCount) return null

    if (h > 1) {
      // 多行物品：强制 row=0，宽松检测视觉中心 Y 在区域内（±ph/2 容差）
      if (local.y < -(ph / 2) || local.y > CELL_SIZE * 2 + ph / 2) return null
      return { col, row: 0 }
    } else {
      // 1x1：手指所在行 = floor(视觉中心Y / CELL_SIZE)
      const row = Math.floor(local.y / CELL_SIZE)
      if (row < 0 || row + 1 > 2) return null
      return { col, row }
    }
  }

  /** 格子坐标 → 本区域像素原点（左上角） */
  cellToLocal(col: number, row: number): { x: number; y: number } {
    return { x: col * CELL_SIZE, y: row * CELL_SIZE }
  }

  // ---- 物品 Sprite 管理 ----

  /**
   * 添加物品到指定格子（异步加载图片）。
   * 放置后立刻显示占位色块，图片加载完替换。
   */
  async addItem(
    instanceId: string,
    defId:      string,
    size:       ItemSizeNorm,
    col:        number,
    row:        number,
    tier?:      string,
  ): Promise<void> {
    if (this.nodes.has(instanceId)) return

    const { pw, ph }       = SIZE_PX[size]
    const { x: ox, y: oy } = this.cellToLocal(col, row)

    // 物品缩放：由 game_config 的 item_visual_scale 控制。
    // 注：战斗区/背包区 GridZone 本身也会按该比例缩放，因此这里不再二次缩放。
    const visualScale = 1

    const container = new Container()
    container.x     = ox
    container.y     = oy

     // 交互 hitArea 保持为完整占格尺寸（视觉缩小后仍易于点击/拖拽）
     container.hitArea = new Rectangle(0, 0, pw, ph)

     // 视觉层：整体缩放并居中留白
     const visual = new Container()
    visual.scale.set(visualScale)
    visual.x = (pw - pw * visualScale) / 2
    visual.y = (ph - ph * visualScale) / 2
    container.addChild(visual)

    // 占位背景
    const bg = new Graphics()
    visual.addChild(bg)

    const selectedG = new Graphics()
    selectedG.visible = false
    visual.addChild(selectedG)

    const upgradeArrow = new Graphics()
    upgradeArrow.visible = false
    // 2x 放大箭头（40x48）
    upgradeArrow.moveTo(0, 24)
    upgradeArrow.lineTo(20, 0)
    upgradeArrow.lineTo(40, 24)
    upgradeArrow.lineTo(28, 24)
    upgradeArrow.lineTo(28, 48)
    upgradeArrow.lineTo(12, 48)
    upgradeArrow.lineTo(12, 24)
    upgradeArrow.fill({ color: 0xffffff, alpha: 0.95 })
    upgradeArrow.stroke({ color: 0x1a1a2a, width: 3, alpha: 0.85 })

    // 占位 Sprite（异步替换为真实图片）
    const sprite = new Sprite(Texture.WHITE)
    sprite.alpha  = 0
    visual.addChild(sprite)
    visual.addChild(upgradeArrow)

    this.itemLayer.addChild(container)

    const node: ItemNode = {
      container,
      visual,
      bg,
      selectedG,
      upgradeArrow,
      upgradeBaseY: 0,
      sprite,
      defId,
      tier,
      col,
      row,
      size,
      origX: ox,
      origY: oy,
    }
    this.redrawItemBorder(node)
    this.nodes.set(instanceId, node)

    this.loadIcon(instanceId, defId, node)
  }

  private async loadIcon(
    instanceId: string,
    defId:      string,
    node:       ItemNode,
  ): Promise<void> {
    const url = `/resource/itemicon/vanessa/${defId}.webp`
    try {
      const tex = await Assets.load<Texture>(url)
      if (!this.nodes.has(instanceId)) return
      const sp   = node.sprite!
      sp.texture = tex
      sp.alpha   = 1
      node.bg.alpha = 0.6
      this.applyNodeVisualLayout(node)
    } catch {
      // 图片加载失败：保持占位色块
    }
  }

  removeItem(instanceId: string): void {
    const node = this.nodes.get(instanceId)
    if (!node) return
    // container 可能在 itemLayer 或已被 DragController 摘出，安全移除
    if (node.container.parent === this.itemLayer) {
      this.itemLayer.removeChild(node.container)
    } else {
      node.container.parent?.removeChild(node.container)
    }
    node.container.destroy({ children: true })
    if (this.dragNode === node) this.dragNode = null
    if (this.selectedId === instanceId) this.selectedId = null
    this.upgradeHintIds.delete(instanceId)
    this.nodes.delete(instanceId)
  }

  // ---- 拖拽协作 API（供 DragController 调用）----

  /**
   * 开始拖拽：应用视觉效果，从 itemLayer 摘出 container，
   * 返回位置信息供 DragController 放入 dragLayer。
   */
  startDragDetach(instanceId: string): {
    container: Container
    size:      ItemSizeNorm
    stageX:    number    // 物品左上角在 stage 坐标系的 X
    stageY:    number
  } | null {
    const node = this.nodes.get(instanceId)
    if (!node) return null

    this.dragNode = node

    // 拖拽视觉：放大 + 半透明
    node.container.scale.set(1.08)
    node.container.alpha = 0.88

    // stage 坐标（考虑 zone 的缩放；zone 通常直接挂在 stage 下）
    const stageX = this.x + node.container.x * this.scale.x
    const stageY = this.y + node.container.y * this.scale.y
    const worldScaleX = node.container.scale.x * this.scale.x
    const worldScaleY = node.container.scale.y * this.scale.y

    // 从 itemLayer 摘出（此后由 DragController/dragLayer 管理）
    this.itemLayer.removeChild(node.container)

    // 物品被移入 dragLayer 后不再受 zone 缩放影响，需将缩放烘焙为世界缩放
    node.container.scale.set(worldScaleX, worldScaleY)

    return { container: node.container, size: node.size, stageX, stageY }
  }

  /**
   * 弹回归位：动画结束后 DragController 调用，将 container 归还 itemLayer。
   */
  restoreFromDrag(instanceId: string, container: Container): void {
    const node = this.nodes.get(instanceId)
    if (!node) return
    container.x = node.origX
    container.y = node.origY
    container.scale.set(1)
    container.alpha = 1
    this.itemLayer.addChild(container)
    this.dragNode = null
  }

  /**
   * 成功放置（同区域）：从 dragLayer 归还 itemLayer，吸附到目标格子。
   */
  snapToCellFromDrag(instanceId: string, container: Container, col: number, row: number): void {
    const node = this.nodes.get(instanceId)
    if (!node) return
    const { x, y } = this.cellToLocal(col, row)
    container.x    = x
    container.y    = y
    container.scale.set(1)
    container.alpha = 1
    node.origX     = x
    node.origY     = y
    node.col       = col
    node.row       = row
    this.itemLayer.addChild(container)
    this.dragNode  = null
  }

  /**
   * 跨区域放置时，源 Zone 只需移除节点记录（container 由 DragController 销毁）。
   */
  forgetDraggedItem(instanceId: string): void {
    const node = this.nodes.get(instanceId)
    if (this.dragNode === node) this.dragNode = null
    this.nodes.delete(instanceId)
  }

  // ---- 高亮层 ----

  highlightCells(col: number, row: number, size: ItemSizeNorm, valid: boolean, colorOverride?: number): void {
    const { pw, ph } = SIZE_PX[size]
    const { x, y }   = this.cellToLocal(col, row)
    const color = colorOverride ?? (valid ? 0x00ff88 : 0xff3333)
    this.hlOverlay.clear()
    this.hlOverlay.rect(x + 2, y + 2, pw - 4, ph - 4)
    this.hlOverlay.fill({ color, alpha: 0.28 })
    this.hlOverlay.rect(x + 1, y + 1, pw - 2, ph - 2)
    this.hlOverlay.stroke({ color, width: 2, alpha: 0.7 })
  }

  clearHighlight(): void {
    this.hlOverlay.clear()
  }

  // ---- 对外工具 ----

  hasItem(instanceId: string): boolean {
    return this.nodes.has(instanceId)
  }

  syncItemPosition(item: PlacedItem): void {
    const node = this.nodes.get(item.instanceId)
    if (!node) return
    const { x, y } = this.cellToLocal(item.col, item.row)
    node.container.x = x
    node.container.y = y
    node.origX       = x
    node.origY       = y
    node.col         = item.col
    node.row         = item.row
  }

  static makeStageInteractive(stage: Container, w: number, h: number): void {
    stage.eventMode = 'static'
    stage.hitArea   = new Rectangle(0, 0, w, h)
  }

  setTierBorderWidth(width: number): void {
    this.tierBorderWidth = Math.max(1, width)
    for (const node of this.nodes.values()) {
      this.redrawItemBorder(node)
    }
  }

  setCornerRadius(radius: number): void {
    this.cornerRadius = Math.max(0, radius)
    this.drawCells()
    for (const node of this.nodes.values()) {
      this.redrawItemBorder(node)
      this.redrawSelection(node)
    }
  }

  setCellBorderWidth(width: number): void {
    this.cellBorderWidth = Math.max(1, width)
    this.drawCells()
  }

  setLabelFontSize(size: number): void {
    this.labelText.style.fontSize = size
  }

  setLabelGlobalLeft(globalX: number): void {
    const sx = this.scale.x || 1
    this.labelText.x = (globalX - this.x) / sx
  }

  setItemTier(instanceId: string, tier?: string): void {
    const node = this.nodes.get(instanceId)
    if (!node) return
    node.tier = tier
    this.redrawItemBorder(node)
  }

  getItemTier(instanceId: string): string | undefined {
    const node = this.nodes.get(instanceId)
    return node?.tier
  }

  setSelected(instanceId: string | null): void {
    this.selectedId = instanceId
    for (const [id, node] of this.nodes) {
      node.selectedG.visible = id === instanceId
      if (node.selectedG.visible) this.redrawSelection(node)
    }
  }

  setUpgradeHints(instanceIds: string[]): void {
    this.upgradeHintIds = new Set(instanceIds)
    for (const [id, node] of this.nodes) {
      node.upgradeArrow.visible = this.upgradeHintIds.has(id)
    }
    if (this.upgradeHintIds.size > 0 && !this.upgradeHintTick) this.startUpgradeHintAnim()
    if (this.upgradeHintIds.size === 0 && this.upgradeHintTick) this.stopUpgradeHintAnim()
  }

  private redrawItemBorder(node: ItemNode): void {
    this.applyNodeVisualLayout(node)
  }

  private getItemFrameInset(): number {
    return Math.max(3, 2 + Math.ceil(this.tierBorderWidth / 2))
  }

  private getItemSpriteInset(frameInset: number): number {
    return frameInset + Math.max(2, Math.ceil(this.tierBorderWidth / 2))
  }

  private applyNodeVisualLayout(node: ItemNode): void {
    const { pw, ph } = SIZE_PX[node.size]
    const tier = getTier(node.defId, node.tier)
    const tierColor = getTierColor(tier)
    const frameInset = this.getItemFrameInset()
    const frameW = Math.max(1, pw - frameInset * 2)
    const frameH = Math.max(1, ph - frameInset * 2)
    const frameRadius = Math.max(0, this.cornerRadius - (frameInset - 3))

    node.bg.clear()
    node.bg.roundRect(frameInset, frameInset, frameW, frameH, frameRadius)
    node.bg.fill({ color: SIZE_COLOR[node.size], alpha: 0.85 })
    node.bg.stroke({
      color: tierColor,
      width: this.tierBorderWidth,
      alpha: 0.98,
    })
    if (tier === 'Diamond') {
      const innerInset = frameInset + this.tierBorderWidth + 1
      const innerW = Math.max(1, pw - innerInset * 2)
      const innerH = Math.max(1, ph - innerInset * 2)
      node.bg.roundRect(innerInset, innerInset, innerW, innerH, Math.max(0, frameRadius - 2))
      node.bg.stroke({ color: 0xe8fbff, width: 2, alpha: 0.95 })
    }

    if (node.sprite) {
      const spriteInset = this.getItemSpriteInset(frameInset)
      node.sprite.x = spriteInset
      node.sprite.y = spriteInset
      node.sprite.width = Math.max(1, pw - spriteInset * 2)
      node.sprite.height = Math.max(1, ph - spriteInset * 2)
    }

    // 箭头位于物品可视区域中心
    node.upgradeArrow.x = frameInset + frameW / 2 - 20
    node.upgradeBaseY = frameInset + frameH / 2 - 24
    node.upgradeArrow.y = node.upgradeBaseY

    if (node.selectedG.visible) this.redrawSelection(node)
  }

  private startUpgradeHintAnim(): void {
    this.upgradeHintT = 0
    this.upgradeHintTick = () => {
      this.upgradeHintT += 0.08
      const wave = (Math.sin(this.upgradeHintT) + 1) / 2
      for (const id of this.upgradeHintIds) {
        const node = this.nodes.get(id)
        if (!node) continue
        node.upgradeArrow.alpha = 0.55 + wave * 0.45
        node.upgradeArrow.y = node.upgradeBaseY + Math.sin(this.upgradeHintT * 1.6) * 8
      }
    }
    Ticker.shared.add(this.upgradeHintTick)
  }

  private stopUpgradeHintAnim(): void {
    if (!this.upgradeHintTick) return
    Ticker.shared.remove(this.upgradeHintTick)
    this.upgradeHintTick = null
  }

  private redrawSelection(node: ItemNode): void {
    const { pw, ph } = SIZE_PX[node.size]
    node.selectedG.clear()
    node.selectedG.roundRect(1, 1, pw - 2, ph - 2, this.cornerRadius + 2)
    node.selectedG.stroke({ color: 0xffffff, width: 4, alpha: 0.95 })
  }

  makeItemsInteractive(
    onDown: (instanceId: string, e: FederatedPointerEvent) => void,
  ): void {
    for (const [id, node] of this.nodes) {
      node.container.eventMode = 'static'
      node.container.cursor    = 'pointer'
      node.container.removeAllListeners('pointerdown')
      node.container.on('pointerdown', (e: FederatedPointerEvent) => onDown(id, e))
    }
  }

  /**
   * 将物品从当前像素位置平滑滑动到目标格子。
   * 逻辑上立即更新 origX/Y（数据已提交），视觉上异步补间。
   * 若同一物品已有进行中的动画，打断并从当前位置重新开始。
   */
  animateToCell(instanceId: string, col: number, row: number, durationMs: number): void {
    const node = this.nodes.get(instanceId)
    if (!node) return

    const { x: toX, y: toY } = this.cellToLocal(col, row)

    // 打断旧挤出动画
    const oldTick = this.squeezeTicks.get(instanceId)
    if (oldTick) { Ticker.shared.remove(oldTick); this.squeezeTicks.delete(instanceId) }

    // 更新逻辑坐标（立即提交）
    node.origX = toX
    node.origY = toY
    node.col   = col
    node.row   = row

    const fromX  = node.container.x
    const fromY  = node.container.y
    const startMs = Date.now()

    const tick = (): void => {
      const t    = Math.min((Date.now() - startMs) / durationMs, 1)
      const ease = 1 - Math.pow(1 - t, 3)  // cubic ease-out
      node.container.x = fromX + (toX - fromX) * ease
      node.container.y = fromY + (toY - fromY) * ease
      if (t >= 1) {
        Ticker.shared.remove(tick)
        this.squeezeTicks.delete(instanceId)
      }
    }

    this.squeezeTicks.set(instanceId, tick)
    Ticker.shared.add(tick)
  }

  /**
   * 拖拽预览挤出：仅视觉移动，不更新逻辑坐标（origX/Y/col/row 不变）。
   * 抬手取消时调用 snapPreviewBack 还原。
   */
  previewMoveToCell(instanceId: string, col: number, row: number, durationMs: number): void {
    const node = this.nodes.get(instanceId)
    if (!node) return

    const { x: toX, y: toY } = this.cellToLocal(col, row)

    const oldP = this.previewTicks.get(instanceId)
    if (oldP) { Ticker.shared.remove(oldP); this.previewTicks.delete(instanceId) }
    const oldS = this.squeezeTicks.get(instanceId)
    if (oldS) { Ticker.shared.remove(oldS); this.squeezeTicks.delete(instanceId) }

    const fromX   = node.container.x
    const fromY   = node.container.y
    const startMs = Date.now()

    const tick = (): void => {
      const t    = Math.min((Date.now() - startMs) / durationMs, 1)
      const ease = 1 - Math.pow(1 - t, 3)
      node.container.x = fromX + (toX - fromX) * ease
      node.container.y = fromY + (toY - fromY) * ease
      if (t >= 1) { Ticker.shared.remove(tick); this.previewTicks.delete(instanceId) }
    }
    this.previewTicks.set(instanceId, tick)
    Ticker.shared.add(tick)
  }

  /**
   * 取消预览：立即将物品归位到逻辑坐标（origX/Y），无动画。
   */
  snapPreviewBack(instanceId: string): void {
    const oldP = this.previewTicks.get(instanceId)
    if (oldP) { Ticker.shared.remove(oldP); this.previewTicks.delete(instanceId) }
    const node = this.nodes.get(instanceId)
    if (!node) return
    node.container.x = node.origX
    node.container.y = node.origY
  }

}
