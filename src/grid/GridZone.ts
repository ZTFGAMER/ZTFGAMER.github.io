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
import { getItemIconUrl, getUiImageUrl } from '@/core/assetPath'
import { getTierColor } from '@/config/colorPalette'
import {
  createItemStatBadges,
  type ItemBadgeDisplayMode,
  type ItemStatBadgeOverride,
} from '@/ui/itemStatBadges'
import { resolveItemTierBaseStats } from '@/items/itemTierStats'

const gameplayMode = getGameConfig().gameplayModeValues?.compactMode
const compactEnabled = gameplayMode?.enabled === true
const cellScale = compactEnabled ? Math.max(0.25, Number(gameplayMode?.cellScale ?? 0.5)) : 1
const configuredRatio = Number(gameplayMode?.cellHeightRatio)
const cellHeightRatio = compactEnabled
  ? (Number.isFinite(configuredRatio) && configuredRatio > 0
    ? configuredRatio
    : (gameplayMode?.squareCell !== false ? 1 : 2))
  : 2
export const CELL_SIZE = Math.round(128 * cellScale)
export const CELL_HEIGHT = Math.round(CELL_SIZE * cellHeightRatio)

// ---- 尺寸表 ----

const SIZE_PX: Record<ItemSizeNorm, { pw: number; ph: number }> = {
  '1x1': { pw: CELL_SIZE,     ph: CELL_HEIGHT },
  '2x1': { pw: CELL_SIZE * 2, ph: CELL_HEIGHT },
  '3x1': { pw: CELL_SIZE * 3, ph: CELL_HEIGHT },
}

const MULTI_ROW_PICKUP_BOTTOM_TRIM = Math.round(CELL_SIZE * 0.32)
const UPGRADE_ARROW_SCALE = 1.5
const UPGRADE_ARROW_BASE_W = 40
const UPGRADE_ARROW_BASE_H = 48
const UPGRADE_ARROW_FILL_COLOR = 0xffd25a
const SAME_ARROW_FILE = 'arrow2.png'
const CROSS_ARROW_FILE = 'arrow1.png'
const CONVERT_ARROW_FILE = 'arrow3.png'

let guideArrowTexturesPromise: Promise<{ same: Texture; cross: Texture; convert: Texture }> | null = null

function ensureGuideArrowTextures(): Promise<{ same: Texture; cross: Texture; convert: Texture }> {
  if (guideArrowTexturesPromise) return guideArrowTexturesPromise
  guideArrowTexturesPromise = Promise.all([
    Assets.load<Texture>(getUiImageUrl(SAME_ARROW_FILE)),
    Assets.load<Texture>(getUiImageUrl(CROSS_ARROW_FILE)),
    Assets.load<Texture>(getUiImageUrl(CONVERT_ARROW_FILE)),
  ]).then(([same, cross, convert]) => ({ same, cross, convert }))
  return guideArrowTexturesPromise
}

interface ArrowNodeView extends Container {
  _fill: Sprite
}

function createArrowNode(): ArrowNodeView {
  const con = new Container() as ArrowNodeView
  con.eventMode = 'none'
  con.visible = false

  const fill = new Sprite(Texture.EMPTY)
  fill.anchor.set(0.5)
  fill.tint = UPGRADE_ARROW_FILL_COLOR
  fill.alpha = 0.98
  fill.visible = false
  con.addChild(fill)

  con._fill = fill
  return con
}

function applyArrowTexture(node: ArrowNodeView, texture: Texture): void {
  node._fill.texture = texture
  node._fill.visible = true
  node._fill.width = UPGRADE_ARROW_BASE_W
  node._fill.height = UPGRADE_ARROW_BASE_H
}

/** 每种尺寸占用的格子数 [cols, rows] */
const SIZE_DIMS: Record<ItemSizeNorm, [number, number]> = {
  '1x1': [1, 1],
  '2x1': [2, 1],
  '3x1': [3, 1],
}

let tierByDefId: Map<string, string> | null = null

function getTier(defId: string, tierOverride?: string): string {
  if (tierOverride) return tierOverride.split('#')[0] ?? tierOverride
  if (!tierByDefId) {
    tierByDefId = new Map<string, string>()
    for (const item of getAllItems()) {
      const tier = item.starting_tier.split('/')[0]?.trim() ?? 'Bronze'
      tierByDefId.set(item.id, tier)
    }
  }
  return tierByDefId.get(defId) ?? 'Bronze'
}

function getBaseTier(defId: string): string {
  if (!tierByDefId) {
    tierByDefId = new Map<string, string>()
    for (const item of getAllItems()) {
      const tier = item.starting_tier.split('/')[0]?.trim() ?? 'Bronze'
      tierByDefId.set(item.id, tier)
    }
  }
  return tierByDefId.get(defId) ?? 'Bronze'
}

function parseTierStar(tierRaw?: string): number {
  if (!tierRaw) return 1
  const m = tierRaw.match(/#(\d+)/)
  if (!m?.[1]) return 1
  const n = Number(m[1])
  return Number.isFinite(n) ? Math.max(1, Math.min(2, Math.round(n))) : 1
}

function tierToLevelLabel(tierRaw?: string): string {
  const tier = getTier('', tierRaw)
  const star = parseTierStar(tierRaw)
  if (tier === 'Bronze') return '1'
  if (tier === 'Silver') return String(star + 1)
  if (tier === 'Gold') return String(star + 3)
  return String(star + 5)
}

// ---- ItemNode ----

interface ItemNode {
  container:  Container
  visual:     Container
  bg:         Graphics
  selectedG:  Graphics
  statBadges: Container
  ammoBadge: Container
  ammoBadgeBg: Graphics
  ammoIconText: Text
  ammoText: Text
  starBadgeBg: Graphics
  starText: Text
  upgradeArrow: ArrowNodeView
  crossUpgradeArrow: ArrowNodeView
  upgradeBaseY: number
  sprite:     Sprite | null
  defId:      string
  tier?:      string
  statOverride: ItemStatBadgeOverride | null
  ammoOverride: { current: number; max: number } | null
  col:        number
  row:        number
  size:       ItemSizeNorm
  /** 放置时的像素原点 X（相对于 GridZone） */
  origX:      number
  /** 放置时的像素原点 Y（相对于 GridZone） */
  origY:      number
}

function getArchetypeBadgeByDefId(defId: string): { label: string; color: number; showLevel: boolean } {
  const item = getAllItems().find((it) => it.id === defId)
  const tags = `${item?.tags ?? ''}`
  if (tags.includes('战士')) return { label: '战', color: 0xcc4b4b, showLevel: true }
  if (tags.includes('弓手')) return { label: '弓', color: 0x34a853, showLevel: true }
  if (tags.includes('刺客')) return { label: '刺', color: 0x4b7bcc, showLevel: true }
  if (tags.includes('中立')) return { label: '中立', color: 0xb07a27, showLevel: false }
  return { label: '?', color: 0x7b6ad2, showLevel: true }
}

function parseTierName(raw: string): string {
  if (raw.includes('Silver')) return 'Silver'
  if (raw.includes('Gold')) return 'Gold'
  if (raw.includes('Diamond')) return 'Diamond'
  return 'Bronze'
}

function tierScoreFromRaw(raw?: string): number {
  const tier = parseTierName(raw ?? 'Bronze')
  const star = parseTierStar(raw)
  if (tier === 'Bronze') return 1
  if (tier === 'Silver') return star === 2 ? 3 : 2
  if (tier === 'Gold') return star === 2 ? 5 : 4
  return star === 2 ? 7 : 6
}

function startTierScore(raw?: string): number {
  const tier = parseTierName(raw ?? 'Bronze')
  if (tier === 'Silver') return 2
  if (tier === 'Gold') return 4
  if (tier === 'Diamond') return 6
  return 1
}

function tierIndexFromRaw(item: { available_tiers: string; starting_tier?: string }, tierRaw?: string): number {
  const score = tierScoreFromRaw(tierRaw)
  const start = startTierScore(item.starting_tier)
  return Math.max(0, score - start)
}

function pickTierSeriesValue(series: string, tierIndex: number): number {
  const parts = series.split('/').map((v) => v.trim()).filter(Boolean)
  if (parts.length === 0) return 0
  const idx = Math.max(0, Math.min(parts.length - 1, tierIndex))
  const n = Number(parts[idx])
  return Number.isFinite(n) ? n : 0
}

function ammoFromSkillLines(lines: string[], tierIndex: number): number {
  for (const line of lines) {
    const m = line.match(/弹药\s*[:：]\s*(\d+(?:\/\d+)*)/)
    if (!m?.[1]) continue
    const v = Math.round(pickTierSeriesValue(m[1], tierIndex))
    if (v > 0) return v
  }
  return 0
}

export interface GridItemNodeView {
  container: Container
  visual: Container
  col: number
  row: number
  size: ItemSizeNorm
}

// ============================================================
export class GridZone extends Container {
  readonly zoneCols:        number
  readonly zoneRows:        number
  private _activeColCount:  number   // 已解锁的列数（其余显示为暗格）
  get activeColCount(): number { return this._activeColCount }
  autoPackEnabled = false

  private cellBg:     Graphics   // 静态格子背景
  itemLayer:          Container  // 物品层（DragController 归还物品时需访问）
  private hlOverlay:  Graphics   // 拖拽高亮层
  private badgeLayer: Container  // 顶部数值徽标层（需高于 CD 遮罩）
  private labelText:  Text

  private nodes = new Map<string, ItemNode>()
  private tierBorderWidth = 4
  private cornerRadius = 10
  private cellBorderWidth = 1
  private selectedId: string | null = null
  private statBadgeFontSize = getGameConfig().textSizes.itemStatBadge
  private statBadgeMode: ItemBadgeDisplayMode = 'stats'
  private statBadgeOffsetY = 0
  private tierStarFontSize = getGameConfig().textSizes.itemTierStar
  private tierStarStrokeWidth = 2
  private tierStarOffsetX = 0
  private tierStarOffsetY = 0
  private ammoBadgeOffsetY = 0
  private upgradeHintIds = new Set<string>()
  private crossUpgradeHintIds = new Set<string>()
  private crossGuideArrowMode: 'cross' | 'convert' = 'cross'
  private upgradeHintTick: (() => void) | null = null

  // 当前被拖拽的节点（状态追踪；位置由 DragController/dragLayer 管理）
  dragNode: ItemNode | null = null

  // 活跃的挤出动画 tick 函数（key = instanceId，可随时打断）
  private squeezeTicks = new Map<string, () => void>()
  // 活跃的预览动画 tick 函数（仅视觉，不更新逻辑坐标）
  private previewTicks = new Map<string, () => void>()
  private itemFxTicks = new Set<() => void>()

  /** Tap 回调，外部设置 */
  onTap: (instanceId: string) => void = () => {}

  constructor(label: string, zoneCols = 6, activeColCount = 6, zoneRows = 1) {
    super()
    this.zoneCols        = zoneCols
    this.zoneRows        = zoneRows
    this._activeColCount = activeColCount

    // 分层：bg → itemLayer → hlOverlay
    this.cellBg    = new Graphics()
    this.itemLayer = new Container()
    this.hlOverlay = new Graphics()
    this.badgeLayer = new Container()

    this.addChild(this.cellBg)
    this.addChild(this.itemLayer)
    this.addChild(this.hlOverlay)
    this.addChild(this.badgeLayer)

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

    // 背包/战斗区背景：一整块底板（不按每格单独填充）
    const w = this._activeColCount * CELL_SIZE
    const h = this.zoneRows * CELL_HEIGHT
    const inset = Math.max(1, Math.ceil(borderWidth / 2))

    // 底板 fill
    g.roundRect(inset, inset, Math.max(1, w - inset * 2), Math.max(1, h - inset * 2), Math.max(0, radius - inset))
    g.fill({ color: 0x2a2a3e })

    // 外边框 stroke
    g.roundRect(0, 0, w, h, radius)
    g.stroke({ color: 0x4a4a6e, width: borderWidth })

    // 内部格线（更弱的分隔线，非圆角）
    const lineAlpha = 0.35
    for (let c = 1; c < this._activeColCount; c++) {
      const x = c * CELL_SIZE
      g.moveTo(x, 0)
      g.lineTo(x, h)
      g.stroke({ color: 0x4a4a6e, width: borderWidth, alpha: lineAlpha })
    }
    for (let r = 1; r < this.zoneRows; r++) {
      const y = r * CELL_HEIGHT
      g.moveTo(0, y)
      g.lineTo(w, y)
      g.stroke({ color: 0x4a4a6e, width: borderWidth, alpha: lineAlpha })
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
    const row   = Math.floor(local.y / CELL_HEIGHT)
    if (col < 0 || col >= this._activeColCount || row < 0 || row >= this.zoneRows) return null
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
    const [w] = SIZE_DIMS[size]
    const { ph } = SIZE_PX[size]

    // 先转为本地坐标，再按宽物品向左偏移锚点：
    // 2x1 偏 0.5 格，3x1 偏 1 格（与手感要求一致）
    const pointerLocal = this.toLocal({ x: globalX, y: globalY + dragOffsetY })
    const anchorLocalX = pointerLocal.x - ((w - 1) * CELL_SIZE) / 2
    const col   = Math.floor(anchorLocalX / CELL_SIZE)
    if (col < 0 || col + w > this._activeColCount) return null

    const row = Math.floor(pointerLocal.y / CELL_HEIGHT)
    if (row < 0 || row >= this.zoneRows) return null
    if (pointerLocal.y < -(ph / 2) || pointerLocal.y > CELL_HEIGHT * this.zoneRows + ph / 2) return null
    return { col, row }
  }

  /** 格子坐标 → 本区域像素原点（左上角） */
  cellToLocal(col: number, row: number): { x: number; y: number } {
    return { x: col * CELL_SIZE, y: row * CELL_HEIGHT }
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
    options?:   { playAcquireFx?: boolean },
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

     // 多行区域适当缩小下边缘拾取范围，减少下方误触
     const hitH = this.zoneRows > 1 ? Math.max(CELL_SIZE, ph - MULTI_ROW_PICKUP_BOTTOM_TRIM) : ph
     container.hitArea = new Rectangle(0, 0, pw, hitH)

     // 视觉层：整体缩放并居中留白
    const visual = new Container()
    visual.scale.set(visualScale)
    visual.pivot.set(pw / 2, ph / 2)
    visual.x = pw / 2
    visual.y = ph / 2
    container.addChild(visual)

    // 占位背景
    const bg = new Graphics()
    visual.addChild(bg)

    const selectedG = new Graphics()
    selectedG.visible = false
    visual.addChild(selectedG)

    const statBadges = new Container()
    statBadges.eventMode = 'none'
    this.badgeLayer.addChild(statBadges)

    const ammoBadge = new Container()
    ammoBadge.eventMode = 'none'
    const ammoBadgeBg = new Graphics()
    const ammoIconText = new Text({
      text: '✹',
      style: {
        fontSize: Math.max(10, Math.round(this.statBadgeFontSize * 0.85)),
        fill: 0xffd36b,
        fontFamily: 'Arial',
        fontWeight: 'bold',
      },
    })
    const ammoText = new Text({
      text: '',
      style: {
        fontSize: Math.max(10, Math.round(this.statBadgeFontSize * 0.85)),
        fill: 0xffffff,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x000000, width: 2 },
      },
    })
    ammoBadge.addChild(ammoBadgeBg)
    ammoBadge.addChild(ammoIconText)
    ammoBadge.addChild(ammoText)
    this.badgeLayer.addChild(ammoBadge)

    const starText = new Text({
      text: '',
      style: {
        fontSize: this.tierStarFontSize,
        fill: 0xffffff,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0xffffff, width: this.tierStarStrokeWidth },
      },
    })
    const starBadgeBg = new Graphics()
    starBadgeBg.eventMode = 'none'
    this.badgeLayer.addChild(starBadgeBg)
    starText.eventMode = 'none'
    this.badgeLayer.addChild(starText)

    const upgradeArrow = createArrowNode()
    upgradeArrow.scale.set(UPGRADE_ARROW_SCALE)

    const crossUpgradeArrow = createArrowNode()
    crossUpgradeArrow.scale.set(UPGRADE_ARROW_SCALE)

    // 占位 Sprite（异步替换为真实图片）
    const sprite = new Sprite(Texture.WHITE)
    sprite.alpha  = 0
    visual.addChild(sprite)
    visual.addChild(upgradeArrow)
    visual.addChild(crossUpgradeArrow)

    this.itemLayer.addChild(container)

    const node: ItemNode = {
      container,
      visual,
      bg,
      selectedG,
      statBadges,
      ammoBadge,
      ammoBadgeBg,
      ammoIconText,
      ammoText,
      starBadgeBg,
      starText,
      upgradeArrow,
      crossUpgradeArrow,
      upgradeBaseY: 0,
      sprite,
      defId,
      tier,
      statOverride: null,
      ammoOverride: null,
      col,
      row,
      size,
      origX: ox,
      origY: oy,
    }
    this.redrawItemBorder(node)
    this.updateStatBadgePosition(node)
    this.nodes.set(instanceId, node)
    if (options?.playAcquireFx !== false) this.playItemAcquireFx(node)

    this.loadIcon(instanceId, defId, node)
    this.loadGuideArrows(instanceId, node)
  }

  private rootContainer(): Container | null {
    let cur: Container | null = this
    while (cur?.parent) cur = cur.parent as Container
    return cur
  }

  private playItemAcquireFx(node: ItemNode): void {
    const stage = this.rootContainer()
    if (!stage) return
    const [cols] = SIZE_DIMS[node.size]
    const w = cols * CELL_SIZE
    const h = CELL_HEIGHT
    const g0 = this.toGlobal({ x: node.col * CELL_SIZE, y: node.row * CELL_HEIGHT })
    const g1 = this.toGlobal({ x: node.col * CELL_SIZE + w, y: node.row * CELL_HEIGHT + h })
    const p0 = stage.toLocal(g0)
    const p1 = stage.toLocal(g1)
    const x = Math.min(p0.x, p1.x)
    const y = Math.min(p0.y, p1.y)
    const rw = Math.abs(p1.x - p0.x)
    const rh = Math.abs(p1.y - p0.y)
    if (rw <= 0 || rh <= 0) return

    const fx = new Graphics()
    fx.eventMode = 'none'
    stage.addChild(fx)
    node.container.alpha = 0
    node.container.scale.set(0.9)

    const durationMs = 240
    const start = Date.now()
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / durationMs)
      const ease = 1 - Math.pow(1 - t, 3)
      node.container.alpha = Math.min(1, 0.18 + ease * 0.82)
      const scale = 0.9 + ease * 0.1
      node.container.scale.set(scale)
      const pulse = Math.sin(Math.PI * t)
      const corner = Math.max(6, Math.round(this.cornerRadius * (this.scale.x || 1)))
      fx.clear()
      fx.roundRect(x + 2, y + 2, Math.max(4, rw - 4), Math.max(4, rh - 4), corner)
      fx.fill({ color: 0x9fe8ff, alpha: pulse * 0.22 })
      fx.roundRect(x + 1, y + 1, Math.max(2, rw - 2), Math.max(2, rh - 2), corner)
      fx.stroke({ color: 0xbbeeff, width: 2, alpha: pulse * 0.95 })
      if (t >= 1) {
        node.container.alpha = 1
        node.container.scale.set(1)
        Ticker.shared.remove(tick)
        this.itemFxTicks.delete(tick)
        fx.parent?.removeChild(fx)
        fx.destroy()
      }
    }
    this.itemFxTicks.add(tick)
    Ticker.shared.add(tick)
  }

  private playItemDisappearFx(node: ItemNode): void {
    const stage = this.rootContainer()
    if (!stage) return
    const [cols] = SIZE_DIMS[node.size]
    const w = cols * CELL_SIZE
    const h = CELL_HEIGHT
    const g0 = this.toGlobal({ x: node.col * CELL_SIZE, y: node.row * CELL_HEIGHT })
    const g1 = this.toGlobal({ x: node.col * CELL_SIZE + w, y: node.row * CELL_HEIGHT + h })
    const p0 = stage.toLocal(g0)
    const p1 = stage.toLocal(g1)
    const x = Math.min(p0.x, p1.x)
    const y = Math.min(p0.y, p1.y)
    const rw = Math.abs(p1.x - p0.x)
    const rh = Math.abs(p1.y - p0.y)
    if (rw <= 0 || rh <= 0) return

    const fx = new Graphics()
    fx.eventMode = 'none'
    stage.addChild(fx)

    const durationMs = 200
    const start = Date.now()
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / durationMs)
      const fade = 1 - t
      const corner = Math.max(6, Math.round(this.cornerRadius * (this.scale.x || 1)))
      fx.clear()
      fx.roundRect(x + 2, y + 2, Math.max(4, rw - 4), Math.max(4, rh - 4), corner)
      fx.fill({ color: 0xff9f9f, alpha: fade * 0.24 })
      fx.roundRect(x + 1, y + 1, Math.max(2, rw - 2), Math.max(2, rh - 2), corner)
      fx.stroke({ color: 0xffc0c0, width: 2, alpha: fade * 0.95 })
      const cx = x + rw / 2
      const cy = y + rh / 2
      const len = Math.max(10, Math.min(rw, rh) * 0.24) * (0.8 + 0.2 * fade)
      fx.moveTo(cx - len, cy - len)
      fx.lineTo(cx + len, cy + len)
      fx.moveTo(cx + len, cy - len)
      fx.lineTo(cx - len, cy + len)
      fx.stroke({ color: 0xffdede, width: 3, alpha: fade * 0.9 })
      if (t >= 1) {
        Ticker.shared.remove(tick)
        this.itemFxTicks.delete(tick)
        fx.parent?.removeChild(fx)
        fx.destroy()
      }
    }
    this.itemFxTicks.add(tick)
    Ticker.shared.add(tick)
  }

  private async loadGuideArrows(instanceId: string, node: ItemNode): Promise<void> {
    try {
      const textures = await ensureGuideArrowTextures()
      if (!this.nodes.has(instanceId)) return
      applyArrowTexture(node.upgradeArrow, textures.same)
      applyArrowTexture(node.crossUpgradeArrow, this.crossGuideArrowMode === 'convert' ? textures.convert : textures.cross)
    } catch (err) {
      console.warn('[GridZone] 提示箭头加载失败', err)
    }
  }

  private async setCrossGuideArrowMode(mode: 'cross' | 'convert'): Promise<void> {
    this.crossGuideArrowMode = mode
    try {
      const textures = await ensureGuideArrowTextures()
      const tex = mode === 'convert' ? textures.convert : textures.cross
      for (const node of this.nodes.values()) applyArrowTexture(node.crossUpgradeArrow, tex)
    } catch {
      // noop
    }
  }

  private async loadIcon(
    instanceId: string,
    defId:      string,
    node:       ItemNode,
  ): Promise<void> {
    const url = getItemIconUrl(defId)
    try {
      const tex = await Assets.load<Texture>(url)
      if (!this.nodes.has(instanceId)) return
      const sp   = node.sprite!
      sp.texture = tex
      sp.alpha   = 1
      node.bg.alpha = 0.6
      this.applyNodeVisualLayout(node)
    } catch (err) {
      console.warn('[GridZone] 图标加载失败', url, err)
    }
  }

  removeItem(instanceId: string): void {
    const node = this.nodes.get(instanceId)
    if (!node) return
    this.playItemDisappearFx(node)
    // container 可能在 itemLayer 或已被 DragController 摘出，安全移除
    if (node.container.parent === this.itemLayer) {
      this.itemLayer.removeChild(node.container)
    } else {
      node.container.parent?.removeChild(node.container)
    }
    node.container.destroy({ children: true })
    if (node.statBadges.parent) node.statBadges.parent.removeChild(node.statBadges)
    node.statBadges.destroy({ children: true })
    if (node.ammoBadge.parent) node.ammoBadge.parent.removeChild(node.ammoBadge)
    node.ammoBadge.destroy({ children: true })
    if (node.starBadgeBg.parent) node.starBadgeBg.parent.removeChild(node.starBadgeBg)
    node.starBadgeBg.destroy()
    if (node.starText.parent) node.starText.parent.removeChild(node.starText)
    node.starText.destroy()
    if (this.dragNode === node) this.dragNode = null
    if (this.selectedId === instanceId) this.selectedId = null
    this.upgradeHintIds.delete(instanceId)
    this.crossUpgradeHintIds.delete(instanceId)
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

    // 拖拽时仅显示图片本体（隐藏边框/底板/选中/升级箭头）
    node.bg.visible = false
    node.selectedG.visible = false
    node.statBadges.visible = false
    node.ammoBadge.visible = false
    node.starBadgeBg.visible = false
    node.starText.visible = false
    node.upgradeArrow.visible = false
    node.crossUpgradeArrow.visible = false

    // 拖拽视觉：固定 100% 大小 + 半透明
    node.container.scale.set(1)
    node.container.alpha = 0.88

    // stage 坐标（考虑 zone 的缩放；zone 通常直接挂在 stage 下）
    const stageX = this.x + node.container.x * this.scale.x
    const stageY = this.y + node.container.y * this.scale.y

    // 从 itemLayer 摘出（此后由 DragController/dragLayer 管理）
    this.itemLayer.removeChild(node.container)

    // 物品被移入 dragLayer 后固定使用 100%（设计坐标）尺寸
    node.container.scale.set(1)

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

    // 恢复静态展示
    node.bg.visible = true
    node.selectedG.visible = this.selectedId === instanceId
    node.statBadges.visible = true
    node.starBadgeBg.visible = this.statBadgeMode !== 'archetype'
    node.starText.visible = this.statBadgeMode !== 'archetype'
    node.upgradeArrow.visible = this.upgradeHintIds.has(instanceId)
    node.crossUpgradeArrow.visible = this.crossUpgradeHintIds.has(instanceId)
    this.updateNodeAmmoBadge(node)
    this.updateStatBadgePosition(node)

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

    // 恢复静态展示
    node.bg.visible = true
    node.selectedG.visible = this.selectedId === instanceId
    node.statBadges.visible = true
    node.starBadgeBg.visible = this.statBadgeMode !== 'archetype'
    node.starText.visible = this.statBadgeMode !== 'archetype'
    node.upgradeArrow.visible = this.upgradeHintIds.has(instanceId)
    node.crossUpgradeArrow.visible = this.crossUpgradeHintIds.has(instanceId)
    this.updateNodeAmmoBadge(node)

    node.origX     = x
    node.origY     = y
    node.col       = col
    node.row       = row
    this.updateStatBadgePosition(node)
    this.itemLayer.addChild(container)
    this.dragNode  = null
  }

  /**
   * 跨区域放置时，源 Zone 只需移除节点记录（container 由 DragController 销毁）。
   */
  forgetDraggedItem(instanceId: string): void {
    const node = this.nodes.get(instanceId)
    if (this.dragNode === node) this.dragNode = null
    if (node?.statBadges.parent) node.statBadges.parent.removeChild(node.statBadges)
    node?.statBadges.destroy({ children: true })
    if (node?.ammoBadge.parent) node.ammoBadge.parent.removeChild(node.ammoBadge)
    node?.ammoBadge.destroy({ children: true })
    if (node?.starBadgeBg.parent) node.starBadgeBg.parent.removeChild(node.starBadgeBg)
    node?.starBadgeBg.destroy()
    if (node?.starText.parent) node.starText.parent.removeChild(node.starText)
    node?.starText.destroy()
    this.upgradeHintIds.delete(instanceId)
    this.crossUpgradeHintIds.delete(instanceId)
    this.nodes.delete(instanceId)
  }

  // ---- 高亮层 ----

  highlightCells(col: number, row: number, size: ItemSizeNorm, valid: boolean, colorOverride?: number): void {
    const { pw, ph } = SIZE_PX[size]
    const { x, y }   = this.cellToLocal(col, row)
    const color = colorOverride ?? (valid ? 0x00ff88 : 0xff3333)
    this.hlOverlay.clear()

    // 高亮圆角与装备一致
    const rFill = Math.max(0, this.cornerRadius - 2)
    const rStroke = Math.max(0, this.cornerRadius - 1)

    this.hlOverlay.roundRect(x + 2, y + 2, pw - 4, ph - 4, rFill)
    this.hlOverlay.fill({ color, alpha: 0.28 })
    this.hlOverlay.roundRect(x + 1, y + 1, pw - 2, ph - 2, rStroke)
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
    this.updateStatBadgePosition(node)
  }

  bringStatBadgesToFront(): void {
    if (this.badgeLayer.parent === this) this.addChild(this.badgeLayer)
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

  setLabelVisible(visible: boolean): void {
    this.labelText.visible = visible
  }

  setStatBadgeFontSize(size: number): void {
    this.statBadgeFontSize = Math.max(8, size)
    for (const node of this.nodes.values()) {
      this.redrawItemBorder(node)
    }
  }

  setStatBadgeMode(mode: ItemBadgeDisplayMode): void {
    this.statBadgeMode = mode
    for (const node of this.nodes.values()) {
      this.redrawItemBorder(node)
    }
  }

  setStatBadgeOffsetY(offsetY: number): void {
    this.statBadgeOffsetY = offsetY
    for (const node of this.nodes.values()) {
      this.redrawItemBorder(node)
    }
  }

  setTierStarFontSize(size: number): void {
    this.tierStarFontSize = Math.max(8, size)
    for (const node of this.nodes.values()) {
      this.redrawItemBorder(node)
    }
  }

  setTierStarStrokeWidth(_width: number): void {
    this.tierStarStrokeWidth = Math.max(0, Math.round(_width))
    for (const node of this.nodes.values()) {
      this.redrawItemBorder(node)
    }
  }

  setTierStarOffsetX(offsetX: number): void {
    this.tierStarOffsetX = Math.round(offsetX)
    for (const node of this.nodes.values()) {
      this.updateStatBadgePosition(node)
    }
  }

  setTierStarOffsetY(offsetY: number): void {
    this.tierStarOffsetY = Math.round(offsetY)
    for (const node of this.nodes.values()) {
      this.updateStatBadgePosition(node)
    }
  }

  setAmmoBadgeOffsetY(offsetY: number): void {
    this.ammoBadgeOffsetY = Math.round(offsetY)
    for (const node of this.nodes.values()) {
      this.updateStatBadgePosition(node)
    }
  }

  setLabelGlobalLeft(globalX: number): void {
    const sx = this.scale.x || 1
    this.labelText.x = (globalX - this.x) / sx
  }

  setLabelGlobalTop(globalY: number): void {
    const sy = this.scale.y || 1
    this.labelText.y = (globalY - this.y) / sy
  }

  setItemTier(instanceId: string, tier?: string): void {
    const node = this.nodes.get(instanceId)
    if (!node) return
    node.tier = tier
    this.redrawItemBorder(node)
  }

  setItemStatOverride(instanceId: string, override: ItemStatBadgeOverride | null): void {
    const node = this.nodes.get(instanceId)
    if (!node) return
    node.statOverride = override
    this.updateNodeStatBadges(node)
  }

  setItemAmmo(instanceId: string, current: number, max: number): void {
    const node = this.nodes.get(instanceId)
    if (!node) return
    if (!Number.isFinite(max) || max <= 0) {
      node.ammoOverride = null
    } else {
      node.ammoOverride = {
        current: Math.max(0, Math.round(current)),
        max: Math.max(1, Math.round(max)),
      }
    }
    this.updateNodeAmmoBadge(node)
    this.updateStatBadgePosition(node)
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
    void instanceIds
    // 用户要求：关闭可升级箭头显示
    this.upgradeHintIds = new Set()
    this.crossUpgradeHintIds = new Set()
    for (const [id, node] of this.nodes) {
      node.upgradeArrow.visible = this.upgradeHintIds.has(id)
      node.crossUpgradeArrow.visible = this.crossUpgradeHintIds.has(id)
    }
    if (this.upgradeHintTick) this.stopUpgradeHintAnim()
  }

  setDragGuideArrows(instanceIds: string[], crossInstanceIds: string[] = [], crossMode: 'cross' | 'convert' = 'cross'): void {
    if (this.crossGuideArrowMode !== crossMode) void this.setCrossGuideArrowMode(crossMode)
    const cross = new Set(crossInstanceIds.filter((id) => this.nodes.has(id)))
    const next = new Set(instanceIds.filter((id) => this.nodes.has(id) && !cross.has(id)))
    this.upgradeHintIds = next
    this.crossUpgradeHintIds = cross
    for (const [id, node] of this.nodes) {
      const showDefault = next.has(id)
      const showCross = cross.has(id)
      node.upgradeArrow.visible = showDefault
      node.crossUpgradeArrow.visible = showCross
      if (!showDefault && !showCross) {
        node.upgradeArrow.y = node.upgradeBaseY
        node.upgradeArrow.alpha = 1
        node.upgradeArrow.scale.set(UPGRADE_ARROW_SCALE)
        node.crossUpgradeArrow.y = node.upgradeBaseY
        node.crossUpgradeArrow.alpha = 1
        node.crossUpgradeArrow.scale.set(UPGRADE_ARROW_SCALE)
      }
    }
    if (next.size > 0 || cross.size > 0) this.startUpgradeHintAnim()
    else this.stopUpgradeHintAnim()
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
    const tier = getBaseTier(node.defId)
    const tierColor = getTierColor(tier)
    const frameInset = this.getItemFrameInset()
    const frameW = Math.max(1, pw - frameInset * 2)
    const frameH = Math.max(1, ph - frameInset * 2)
    const frameRadius = Math.max(0, this.cornerRadius - (frameInset - 3))

    node.bg.clear()
    node.bg.roundRect(frameInset, frameInset, frameW, frameH, frameRadius)
    // 物品底色不应染色图标；保留极低透明 fill 以确保 stroke 稳定渲染
    node.bg.fill({ color: 0x000000, alpha: 0.001 })
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
      const baseCellInner = Math.max(1, CELL_SIZE - spriteInset * 2)
      const spriteSide = Math.max(1, Math.min(frameW, baseCellInner))
      node.sprite.width = spriteSide
      node.sprite.height = spriteSide
      node.sprite.x = frameInset + (frameW - spriteSide) / 2
      node.sprite.y = frameInset + (frameH - spriteSide) / 2
    }

    this.updateNodeStatBadges(node)
    this.updateNodeAmmoBadge(node)
    this.updateStatBadgePosition(node)

    const levelText = tierToLevelLabel(node.tier)
    const arch = getArchetypeBadgeByDefId(node.defId)
    node.starText.text = arch.showLevel ? `${arch.label}${levelText}` : arch.label
    node.starText.style.fill = 0xffffff
    node.starText.style.stroke = { color: 0x000000, width: 2 }
    node.starText.style.fontSize = this.statBadgeFontSize
    node.starBadgeBg.clear()
    const padX = 8
    const padY = 3
    const badgeW = Math.max(44, node.starText.width + padX * 2)
    const badgeH = Math.max(16, node.starText.height + padY * 2)
    node.starBadgeBg.roundRect(0, 0, badgeW, badgeH, 6)
    node.starBadgeBg.fill({ color: arch.color, alpha: 0.95 })
    node.starBadgeBg.roundRect(0, 0, badgeW, badgeH, 6)
    node.starBadgeBg.stroke({ color: 0x000000, width: 2, alpha: 0.88 })
    node.starBadgeBg.visible = this.statBadgeMode !== 'archetype'
    node.starText.visible = this.statBadgeMode !== 'archetype'

    // 箭头位于物品可视区域中心
    node.upgradeArrow.x = frameInset + frameW / 2
    node.crossUpgradeArrow.x = frameInset + frameW / 2
    node.upgradeBaseY = frameInset + frameH / 2
    node.upgradeArrow.y = node.upgradeBaseY
    node.crossUpgradeArrow.y = node.upgradeBaseY

    if (node.selectedG.visible) this.redrawSelection(node)
  }

  private updateNodeStatBadges(node: ItemNode): void {
    const { pw } = SIZE_PX[node.size]
    const itemDef = getAllItems().find((it) => it.id === node.defId)
    node.statBadges.removeChildren()
    if (itemDef) {
      const tierStats = resolveItemTierBaseStats(itemDef, node.tier)
      const badges = createItemStatBadges(
        itemDef,
        this.statBadgeFontSize,
        Math.max(44, pw - 8),
        {
          damage: tierStats.damage,
          shield: tierStats.shield,
          heal: tierStats.heal,
          burn: tierStats.burn,
          poison: tierStats.poison,
          multicast: tierStats.multicast,
          ...(node.statOverride ?? {}),
        },
        this.statBadgeMode,
        {
          archetypeSuffix: this.statBadgeMode === 'archetype' ? tierToLevelLabel(node.tier) : '',
        },
      )
      node.statBadges.addChild(badges)
    }
    this.updateStatBadgePosition(node)
  }

  private updateNodeAmmoBadge(node: ItemNode): void {
    if (this.statBadgeMode === 'archetype') {
      node.ammoBadge.visible = false
      return
    }
    const itemDef = getAllItems().find((it) => it.id === node.defId)
    if (!itemDef) {
      node.ammoBadge.visible = false
      return
    }

    let maxAmmo = 0
    let currentAmmo = 0
    if (node.ammoOverride) {
      maxAmmo = node.ammoOverride.max
      currentAmmo = Math.min(maxAmmo, node.ammoOverride.current)
    } else {
      const tierIdx = tierIndexFromRaw(itemDef, node.tier)
      maxAmmo = ammoFromSkillLines((itemDef.skills ?? []).map((s) => s.cn ?? ''), tierIdx)
      currentAmmo = maxAmmo
    }

    if (!Number.isFinite(maxAmmo) || maxAmmo <= 0) {
      node.ammoBadge.visible = false
      return
    }

    node.ammoBadge.visible = true
    node.ammoText.text = `${Math.max(0, currentAmmo)}/${Math.max(1, maxAmmo)}`
    const padX = 6
    const padY = 3
    const gap = 4
    node.ammoIconText.x = padX
    node.ammoIconText.y = padY
    node.ammoText.x = node.ammoIconText.x + node.ammoIconText.width + gap
    node.ammoText.y = padY
    const w = Math.ceil(node.ammoText.x + node.ammoText.width + padX)
    const h = Math.ceil(Math.max(node.ammoIconText.height, node.ammoText.height) + padY * 2)
    node.ammoBadgeBg.clear()
    node.ammoBadgeBg.roundRect(0, 0, Math.max(24, w), Math.max(16, h), 7)
    node.ammoBadgeBg.fill({ color: 0x000000, alpha: 0.45 })
  }

  private stopUpgradeHintAnim(): void {
    if (!this.upgradeHintTick) return
    Ticker.shared.remove(this.upgradeHintTick)
    this.upgradeHintTick = null
    for (const node of this.nodes.values()) {
      node.upgradeArrow.y = node.upgradeBaseY
      node.upgradeArrow.alpha = 1
      node.upgradeArrow.scale.set(UPGRADE_ARROW_SCALE)
      node.crossUpgradeArrow.y = node.upgradeBaseY
      node.crossUpgradeArrow.alpha = 1
      node.crossUpgradeArrow.scale.set(UPGRADE_ARROW_SCALE)
    }
  }

  private startUpgradeHintAnim(): void {
    if (this.upgradeHintTick) return
    this.upgradeHintTick = () => {
      const p = (Date.now() % 640) / 640
      const bob = Math.sin(p * Math.PI * 2)
      const offsetY = -8 * bob
      const scale = UPGRADE_ARROW_SCALE * (1 + 0.12 * bob)
      for (const [id, node] of this.nodes) {
        const showDefault = this.upgradeHintIds.has(id) && node.upgradeArrow.visible
        const showCross = this.crossUpgradeHintIds.has(id) && node.crossUpgradeArrow.visible
        if (!showDefault && !showCross) continue
        if (showDefault) {
          node.upgradeArrow.y = node.upgradeBaseY + offsetY
          node.upgradeArrow.alpha = 1
          node.upgradeArrow.scale.set(scale)
        }
        if (showCross) {
          node.crossUpgradeArrow.y = node.upgradeBaseY + offsetY
          node.crossUpgradeArrow.alpha = 1
          node.crossUpgradeArrow.scale.set(scale)
        }
      }
    }
    Ticker.shared.add(this.upgradeHintTick)
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

  getNode(instanceId: string): GridItemNodeView | null {
    const node = this.nodes.get(instanceId)
    if (!node) return null
    return {
      container: node.container,
      visual: node.visual,
      col: node.col,
      row: node.row,
      size: node.size,
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
      this.updateStatBadgePosition(node)
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
      this.updateStatBadgePosition(node)
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
    this.updateStatBadgePosition(node)
  }

  private updateStatBadgePosition(node: ItemNode): void {
    const { pw, ph } = SIZE_PX[node.size]
    const frameInset = this.getItemFrameInset()
    const frameW = Math.max(1, pw - frameInset * 2)
    const frameH = Math.max(1, ph - frameInset * 2)
    const badgeYOffset = this.statBadgeMode === 'archetype' ? 14 : 0
    node.statBadges.x = node.container.x + pw / 2
    node.statBadges.y = node.container.y + this.statBadgeOffsetY + badgeYOffset
    const badgeW = node.starBadgeBg.width
    const badgeH = node.starBadgeBg.height
    node.starBadgeBg.x = node.container.x + frameInset + frameW / 2 - badgeW / 2 + this.tierStarOffsetX
    node.starBadgeBg.y = node.container.y + frameInset + frameH - 1 + this.tierStarOffsetY
    node.starText.x = node.starBadgeBg.x + (badgeW - node.starText.width) / 2
    node.starText.y = node.starBadgeBg.y + (badgeH - node.starText.height) / 2
    const ammoBaseY = node.container.y + frameInset + frameH - node.ammoBadge.height - 4 + this.ammoBadgeOffsetY
    const ammoMaxY = node.starBadgeBg.y - node.ammoBadge.height - 4
    node.ammoBadge.x = node.container.x + frameInset + (frameW - node.ammoBadge.width) / 2
    node.ammoBadge.y = node.starBadgeBg.visible ? Math.min(ammoBaseY, ammoMaxY) : ammoBaseY
  }

}
