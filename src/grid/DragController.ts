// ============================================================
// DragController — 拖拽输入层
//
// 交互规则：
//   - 手指移动超过 DRAG_THRESHOLD_PX 即进入拖拽模式（无需长按）
//   - 未超出阈值抬起手指 = 轻触（onTap 查看详情）
//   - setPointerCapture：手指滑出 canvas 也不中断拖拽
//
// 视觉规则：
//   - dragLayer 始终在所有 GridZone 上方（构造时 addChild 到 stage 最上层）
//   - 拖拽时物品向上偏移 DRAG_Y_OFFSET 像素，让手指不遮挡物品
//   - 物品以手指为视觉中心（加偏移后）
//
// 放置规则：
//   - 以物品视觉左上角为落点检测依据（而非手指原始坐标）
//   - 1x2 / 2x2 多行物品强制从 row=0 放置（占满上下两行）
// ============================================================

import { Container } from 'pixi.js'
import type { FederatedPointerEvent } from 'pixi.js'
import type { GridSystem }     from './GridSystem'
import type { GridZone }       from './GridZone'
import { CELL_SIZE } from './GridZone'
import type { ItemSizeNorm }   from './GridSystem'
import { getConfig } from '@/config/debugConfig'
import { trySqueezePlace, planUnifiedSqueeze, planCrossZoneSwap } from './SqueezeLogic'
import type { SqueezePlan } from './VirtualGrid'

// ---- 内部工具 ----

function getSizeCellDim(size: ItemSizeNorm): { w: number; h: number } {
  if (size === '1x1') return { w: 1, h: 1 }
  if (size === '2x1') return { w: 2, h: 1 }
  return { w: 3, h: 1 }
}

interface ZonePair {
  system: GridSystem
  view:   GridZone
}

export interface DragMovePayload {
  instanceId: string
  anchorGx: number
  anchorGy: number
  size: ItemSizeNorm
}

export interface SpecialDropPayload {
  instanceId: string
  anchorGx: number
  anchorGy: number
  size: ItemSizeNorm
  homeSystem: GridSystem
  homeView: GridZone
  defId: string
}

// ============================================================
export class DragController {
  private pairs: ZonePair[] = []
  private enabled = true
  onDragStart: (instanceId: string) => void = () => {}
  onDragMove:  (payload: DragMovePayload) => void = () => {}
  onSpecialDrop: (payload: SpecialDropPayload) => boolean = () => false
  onDragEnd:   ()               => void = () => {}
  private suppressSqueeze = false

  /** 顶层拖拽容器：构造时添加到 stage 末尾，确保最高 z-order */
  private dragLayer: Container

  // ---- 按下阶段状态 ----
  private activeId:  string   | null = null
  private homeZone:  ZonePair | null = null
  private startX     = 0
  private startY     = 0

  // ---- 拖拽阶段状态 ----
  private isDragging      = false
  private dragContainer:  Container    | null = null
  private dragSize:       ItemSizeNorm | null = null
  /** 按下时手指在物品左上角坐标系内的 X 偏移（保持点击位置不跳变） */
  private pointerOffsetX  = 0
  /** 按下时手指在物品左上角坐标系内的 Y 偏移（保持点击位置不跳变） */
  private pointerOffsetY  = 0
  /** 最新手指全局坐标（用于拖放判定，避免大型物品锚点左偏） */
  private pointerGlobalX = 0
  private pointerGlobalY = 0

  /** 拖拽开始前的物品数据（挤出提交后 DRAG 可能不在 system，用此字段兜底） */
  private dragOrigItem: { col: number; row: number; size: ItemSizeNorm; defId: string } | null = null

  // ---- 挤出状态（悬停即提交，不回滚） ----
  private squeezePreview: {
    pair: ZonePair
    col: number
    row: number
    plan: SqueezePlan
  } | null = null

  constructor(
    private stage:  Container,
    private canvas: HTMLCanvasElement,
  ) {
    // dragLayer 必须在所有 GridZone addChild 之后加入，以确保渲染在最上层
    this.dragLayer = new Container()
    stage.addChild(this.dragLayer)

    stage.on('pointermove',      (e: FederatedPointerEvent) => this.onMove(e))
    stage.on('pointerup',        (e: FederatedPointerEvent) => this.onUp(e))
    stage.on('pointerupoutside', (e: FederatedPointerEvent) => this.onUp(e))
  }

  // ---- 注册区域 ----

  addZone(system: GridSystem, view: GridZone): void {
    this.pairs.push({ system, view })
    view.makeItemsInteractive((id, e) => this.onDown(id, e))
  }

  refreshZone(view: GridZone): void {
    view.makeItemsInteractive((id, e) => this.onDown(id, e))
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    if (!enabled) {
      this.clearAllHighlight()
      this.doSnapBack()
      this.reset()
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setSqueezeSuppressed(suppressed: boolean): void {
    this.suppressSqueeze = suppressed
    if (suppressed) this.clearSqueezePreview()
  }

  // ---- 事件处理 ----

  private onDown(instanceId: string, e: FederatedPointerEvent): void {
    if (!this.enabled) return
    e.stopPropagation()
    this.reset()
    this.activeId = instanceId
    this.homeZone = this.findZoneOf(instanceId)
    const p = this.stage.toLocal(e.global)
    this.startX   = p.x
    this.startY   = p.y
    this.pointerGlobalX = e.global.x
    this.pointerGlobalY = e.global.y

    try {
      this.canvas.setPointerCapture((e.nativeEvent as PointerEvent).pointerId)
    } catch { /* 某些环境不支持 */ }
  }

  private onMove(e: FederatedPointerEvent): void {
    if (!this.enabled) return
    if (!this.activeId) return
    const p = this.stage.toLocal(e.global)
    this.pointerGlobalX = e.global.x
    this.pointerGlobalY = e.global.y
    const dx   = p.x - this.startX
    const dy   = p.y - this.startY
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (!this.isDragging) {
      if (dist > getConfig('dragThresholdPx')) {
        this.enterDrag(this.activeId)
        // enterDrag 失败（物品不存在）则取消
        if (!this.isDragging) { this.reset(); return }
      } else {
        return  // 未达阈值，继续等待
      }
    }

    // 拖拽中：保持点击位置相对物品不变，仅 Y 轴追加向上偏移
    if (this.dragContainer) {
      this.dragContainer.x = p.x - this.pointerOffsetX
      this.dragContainer.y = p.y - this.pointerOffsetY + getConfig('dragYOffset')

      if (this.activeId && this.dragSize) {
        this.onDragMove({
          instanceId: this.activeId,
          anchorGx: this.pointerGlobalX,
          anchorGy: this.pointerGlobalY,
          size: this.dragSize,
        })
      }
    }

    this.updateHighlight()
  }

  private onUp(_e: FederatedPointerEvent): void {
    if (!this.enabled) return
    if (!this.activeId) return

    if (this.isDragging) {
      this.tryDrop()
    } else {
      // 轻触：查看详情
      this.homeZone?.view.onTap(this.activeId)
    }

    this.clearAllHighlight()
    this.reset()
  }

  // ---- 拖拽核心 ----

  private enterDrag(instanceId: string): void {
    const home    = this.homeZone!
    const sysItem = home.system.getItem(instanceId)
    if (!sysItem) return

    const result = home.view.startDragDetach(instanceId)
    if (!result) return

    // 记录拖拽前的物品数据（挤出提交后 DRAG 可能不在 system，用此字段兜底）
    this.dragOrigItem = { col: sysItem.col, row: sysItem.row, size: sysItem.size, defId: sysItem.defId }

    this.isDragging     = true
    this.dragContainer  = result.container
    this.dragSize       = result.size
    // 记录按下时手指在物品左上角坐标系内的偏移（startX/Y = onDown 时的手指位置）
    this.pointerOffsetX = this.startX - result.stageX
    this.pointerOffsetY = this.startY - result.stageY

    // 将 container 放入 dragLayer（dragLayer 在 stage 0,0，坐标系与 stage 一致）
    // 重新置顶 dragLayer，避免被后续加入的 HUD/按钮遮挡
    this.stage.addChild(this.dragLayer)
    result.container.x = result.stageX
    result.container.y = result.stageY
    this.dragLayer.addChild(result.container)

    // 一旦进入拖拽，逻辑上立即腾空原位置
    home.system.remove(instanceId)

    this.onDragStart(instanceId)
  }

  private tryDrop(): void {
    if (!this.dragContainer || !this.dragSize || !this.activeId || !this.homeZone || !this.dragOrigItem) {
      this.doSnapBack(); return
    }

    const id   = this.activeId
    const home = this.homeZone
    // 优先从 system 读取，fallback 到 dragOrigItem（挤出计时器提交后 DRAG 可能不在 system）
    const item = home.system.getItem(id) ?? { instanceId: id, ...this.dragOrigItem }

    // 从容器实际位置推算锚点
    const anchorGx = this.pointerGlobalX
    const anchorGy = this.pointerGlobalY

    const best = this.findBestDropTarget(anchorGx, anchorGy, item.size)

    // 先尝试外部特殊落点（如出售按钮、背包按钮）
    if (this.onSpecialDrop({
      instanceId: id,
      anchorGx,
      anchorGy,
      size: item.size,
      homeSystem: home.system,
      homeView: home.view,
      defId: item.defId,
    })) {
      this.clearSqueezePreview()
      this.dragLayer.removeChild(this.dragContainer)
      this.dragContainer.destroy({ children: true })
      this.dragContainer = null
      home.view.forgetDraggedItem(id)
      this.onDragEnd()
      return
    }

    if (!best) { this.doSnapBack(); return }
    const { pair: targetPair, cell } = best
    const container = this.dragContainer

    // 多行物品（1x2 / 2x2）强制从 row=0 放置
    const finalRow = cell.row
    const canDrop  = this.canPlaceInVisibleCols(targetPair, cell.col, finalRow, item.size, id)

    // 无法直接放置时，尝试统一挤出（本区挤出优先，其次跨区域挤出）
    // 注：若挤出已在计时器中提交，目标格应已清空，canDrop 应为 true，此分支通常不走
    let squeezeMoves: { instanceId: string; newCol: number; newRow: number }[] = []
    let crossTransfers: { instanceId: string; newCol: number; newRow: number }[] = []
    let swapTransfers: { instanceId: string; newCol: number; newRow: number }[] = []
    if (!canDrop) {
      const unified = planUnifiedSqueeze(
        { system: targetPair.system, activeColCount: targetPair.view.activeColCount },
        cell.col,
        finalRow,
        item.size,
        id,
        undefined,
        this.dragOrigItem,
      )

      if (!unified && targetPair !== home) {
        const swap = planCrossZoneSwap(
          { system: targetPair.system, activeColCount: targetPair.view.activeColCount },
          { system: home.system, activeColCount: home.view.activeColCount },
          cell.col,
          finalRow,
          item.size,
          id,
          this.dragOrigItem.col,
          this.dragOrigItem.row,
          this.dragOrigItem.size,
        )
        if (swap) swapTransfers = swap.transfers
      }

      if (!unified && swapTransfers.length === 0) { this.doSnapBack(); return }
      if (unified) {
        if (unified.mode === 'local') squeezeMoves = unified.moves
        else crossTransfers = unified.transfers
      }
    }

    // 清理预览计时器（已提交的挤出不还原）
    this.clearSqueezePreview()

    // ---- 成功放置 ----
    this.dragContainer = null

    // 1. 确保 DRAG 从源系统移除（计时器可能已移除；remove 幂等返回 false 无副作用）
    home.system.remove(id)

    // 2. 执行未提交的挤出（若计时器已提交则 squeezeMoves 为空，此处跳过）
    if (squeezeMoves.length > 0) {
      const squeezeMs = getConfig('squeezeMs')
      for (const move of squeezeMoves) {
        const movedItem = targetPair.system.getItem(move.instanceId)
        if (!movedItem) continue
        targetPair.system.remove(move.instanceId)
        targetPair.system.place(move.newCol, move.newRow, movedItem.size, movedItem.defId, move.instanceId)
        targetPair.view.animateToCell(move.instanceId, move.newCol, move.newRow, squeezeMs)
      }
    }

    if (crossTransfers.length > 0 && targetPair !== home) {
      for (const tr of crossTransfers) {
        const movedItem = targetPair.system.getItem(tr.instanceId)
        if (!movedItem) continue
        const tier = targetPair.view.getItemTier(tr.instanceId)
        targetPair.system.remove(tr.instanceId)
        if (!home.system.place(tr.newCol, tr.newRow, movedItem.size, movedItem.defId, tr.instanceId)) {
          this.doSnapBack()
          return
        }
        targetPair.view.removeItem(tr.instanceId)
        home.view.addItem(tr.instanceId, movedItem.defId, movedItem.size, tr.newCol, tr.newRow, tier).then(() => {
          home.view.setItemTier(tr.instanceId, tier)
          this.refreshZone(home.view)
        })
      }
    }

    if (swapTransfers.length > 0 && targetPair !== home) {
      for (const tr of swapTransfers) {
        const movedItem = targetPair.system.getItem(tr.instanceId)
        if (!movedItem) continue
        const tier = targetPair.view.getItemTier(tr.instanceId)
        targetPair.system.remove(tr.instanceId)
        if (!home.system.place(tr.newCol, tr.newRow, movedItem.size, movedItem.defId, tr.instanceId)) {
          this.doSnapBack()
          return
        }
        targetPair.view.removeItem(tr.instanceId)
        home.view.addItem(tr.instanceId, movedItem.defId, movedItem.size, tr.newCol, tr.newRow, tier).then(() => {
          home.view.setItemTier(tr.instanceId, tier)
          this.refreshZone(home.view)
        })
      }
    }

    // 3. 放置 DRAG 到目标位置
    if (targetPair !== home) {
      // 跨区域：销毁旧 container，在目标 zone 创建新 container
      const draggedTier = home.view.getItemTier(id)
      this.dragLayer.removeChild(container)
      container.destroy({ children: true })
      home.view.forgetDraggedItem(id)

      targetPair.system.place(cell.col, finalRow, item.size, item.defId, id)
      targetPair.view.addItem(id, item.defId, item.size, cell.col, finalRow, draggedTier).then(() => {
        targetPair.view.setItemTier(id, draggedTier)
        this.refreshZone(targetPair.view)
      })
    } else {
      // 同区域：从 dragLayer 归还给 zone.itemLayer，吸附到新格子
      targetPair.system.place(cell.col, finalRow, item.size, item.defId, id)
      this.dragLayer.removeChild(container)
      home.view.snapToCellFromDrag(id, container, cell.col, finalRow)
    }
    this.onDragEnd()
  }

  private doSnapBack(): void {
    // 仅清理状态；已提交的挤出保持提交状态，不还原
    this.clearSqueezePreview()

    const container = this.dragContainer
    const home      = this.homeZone
    const id        = this.activeId
    const origItem  = this.dragOrigItem
    if (!container || !home || !id || !origItem) return

    this.dragContainer = null  // 立即清除，避免 reset() 后重复操作

    // 确定弹回格子：
    // 1) 若同区域已提交过挤出，优先弹到该挤出目标位（视为拖拽物已换位）
    // 2) 否则优先原始位置（进入拖拽后原位已腾空）
    // 3) 若原位被占，再扫描第一个可放置空位
    let snapCol  = origItem.col
    let snapRow  = origItem.row
    let useNewCell = false

    if (!home.system.getItem(id)) {
      const committed = this.squeezePreview
      if (committed && committed.pair === home && home.system.canPlace(committed.col, committed.row, origItem.size)) {
        home.system.place(committed.col, committed.row, origItem.size, origItem.defId, id)
        snapCol = committed.col
        snapRow = committed.row
        useNewCell = true
      } else if (home.system.canPlace(origItem.col, origItem.row, origItem.size)) {
        home.system.place(origItem.col, origItem.row, origItem.size, origItem.defId, id)
        snapCol = origItem.col
        snapRow = origItem.row
        useNewCell = true
      } else {
        outer: for (let c = 0; c < home.system.cols; c++) {
          for (let r = 0; r < home.system.rows; r++) {
            if (home.system.canPlace(c, r, origItem.size)) {
              home.system.place(c, r, origItem.size, origItem.defId, id)
              snapCol    = c
              snapRow    = r
              useNewCell = true
              break outer
            }
          }
        }
      }
    }

    // 直接归还（无回弹动画）
    this.dragLayer.removeChild(container)
    if (useNewCell) {
      home.view.snapToCellFromDrag(id, container, snapCol, snapRow)
    } else {
      home.view.restoreFromDrag(id, container)
    }
    this.onDragEnd()
  }

  // ---- 高亮层 ----

  private updateHighlight(): void {
    if (!this.dragSize || !this.activeId || !this.homeZone || !this.dragContainer || !this.dragOrigItem) return
    if (this.suppressSqueeze) {
      this.clearSqueezePreview()
      return
    }
    // 优先从 system 读取，fallback 到 dragOrigItem（挤出计时器提交后 DRAG 可能不在 system）
    const item = this.homeZone.system.getItem(this.activeId) ?? { instanceId: this.activeId, ...this.dragOrigItem }

    const anchorGx = this.pointerGlobalX
    const anchorGy = this.pointerGlobalY

    const best = this.findBestDropTarget(anchorGx, anchorGy, item.size)
    if (best) {
      const { pair, cell } = best
      const finalRow = item.size !== '1x1' ? 0 : cell.row
      const canDrop  = this.canPlaceInVisibleCols(pair, cell.col, finalRow, item.size, this.activeId)
      for (const other of this.pairs)
        if (other !== pair) other.view.clearHighlight()

      if (!canDrop) {
        const unified = planUnifiedSqueeze(
          { system: pair.system, activeColCount: pair.view.activeColCount },
          cell.col,
          finalRow,
          item.size,
          this.activeId,
          undefined,
          this.dragOrigItem,
        )
        if (unified?.mode === 'cross') {
           const ok = this.applyCrossSqueezeNow(pair, cell.col, finalRow, unified.transfers)
           pair.view.highlightCells(cell.col, finalRow, item.size, ok)
           return
         }
        if (unified?.mode === 'local' && unified.moves.length > 0) {
          const squeezable = this.updateSqueezePreview(pair, cell.col, finalRow, item.size, unified.moves)
           pair.view.highlightCells(cell.col, finalRow, item.size, squeezable)
           return
         }
        if (!unified && pair !== this.homeZone) {
          const home = this.homeZone
          const swap = planCrossZoneSwap(
            { system: pair.system, activeColCount: pair.view.activeColCount },
            { system: home.system, activeColCount: home.view.activeColCount },
            cell.col,
            finalRow,
            item.size,
            this.activeId,
            this.dragOrigItem.col,
            this.dragOrigItem.row,
            this.dragOrigItem.size,
          )
           if (swap) {
             this.clearSqueezePreview()
             pair.view.highlightCells(cell.col, finalRow, item.size, true)
             return
           }
         }
         // 挤出预览：可行→绿色，不可行→红色
         const squeezable = this.updateSqueezePreview(pair, cell.col, finalRow, item.size)
         pair.view.highlightCells(cell.col, finalRow, item.size, squeezable)
       } else {
         this.clearSqueezePreview()
         pair.view.highlightCells(cell.col, finalRow, item.size, true)
       }
    } else {
      this.clearAllHighlight()
      this.clearSqueezePreview()
    }
  }

  private clearAllHighlight(): void {
    for (const p of this.pairs) p.view.clearHighlight()
  }

  // ---- 挤出即时提交 ----

  /**
   * 悬停在被占格子上时直接提交挤出（无预览、无回滚）。
   * 挤出提交后物品位置永久改变，不在拖拽失败时还原。
   * 若目标位置未变化则不重复处理。
   * 返回 true 表示挤出可行（高亮显示绿色），false 表示不可行（红色）。
   */
  private updateSqueezePreview(
    pair: ZonePair,
    col: number,
    row: number,
    size: ItemSizeNorm,
    movesOverride?: { instanceId: string; newCol: number; newRow: number }[],
  ): boolean {
    const p = this.squeezePreview
    // 同位置已有记录（已提交）→ 可行
    if (p && p.pair === pair && p.col === col && p.row === row) return true

    // 位置变化：清理记录（已提交的保持，不还原）
    this.clearSqueezePreview()

    // 计算挤出方案（允许使用上游已计算好的可见方案）
    const planMoves = movesOverride
      ?? trySqueezePlace(pair.system, this.activeId!, col, row, size, this.dragOrigItem ?? undefined)?.moves
    if (!planMoves || planMoves.length === 0) return false
    if (!this.isSqueezePlanVisible(pair, planMoves)) return false

    const dragId    = this.activeId!
    const squeezeMs = getConfig('squeezeMs')

    // 临时从 system 移除 DRAG，允许挤出物品落入 DRAG 原格
    const homeSystem = this.homeZone!.system
    homeSystem.remove(dragId)

    for (const move of planMoves) {
      const movedItem = pair.system.getItem(move.instanceId)
      if (!movedItem) continue
      pair.system.remove(move.instanceId)
      pair.system.place(move.newCol, move.newRow, movedItem.size, movedItem.defId, move.instanceId)
      pair.view.animateToCell(move.instanceId, move.newCol, move.newRow, squeezeMs)
    }

    // 挤出一旦提交，拖拽物的“逻辑锚点”更新到当前目标位。
    // 这样后续继续移动时，可基于新位置再次发生互换/挤出（支持来回连续挤出）。
    if (this.dragOrigItem) {
      this.dragOrigItem = {
        ...this.dragOrigItem,
        col,
        row,
      }
    }

    this.squeezePreview = { pair, col, row, plan: { moves: planMoves } }
    return true
  }

  /**
   * 清理挤出记录。
   * 已提交的挤出不还原——物品保持其已提交的新位置。
   */
  private clearSqueezePreview(): void {
    this.squeezePreview = null
  }

  private applyCrossSqueezeNow(
    targetPair: ZonePair,
    col: number,
    row: number,
    transfers: { instanceId: string; newCol: number; newRow: number }[],
  ): boolean {
    const p = this.squeezePreview
    if (p && p.pair === targetPair && p.col === col && p.row === row) return true

    if (!this.homeZone || !this.activeId) return false
    this.clearSqueezePreview()

    const home = this.homeZone
    const dragId = this.activeId
    home.system.remove(dragId)

    for (const tr of transfers) {
      const movedItem = targetPair.system.getItem(tr.instanceId)
      if (!movedItem) continue
      const tier = targetPair.view.getItemTier(tr.instanceId)
      targetPair.system.remove(tr.instanceId)
      if (!home.system.place(tr.newCol, tr.newRow, movedItem.size, movedItem.defId, tr.instanceId)) return false
      targetPair.view.removeItem(tr.instanceId)
      home.view.addItem(tr.instanceId, movedItem.defId, movedItem.size, tr.newCol, tr.newRow, tier).then(() => {
        home.view.setItemTier(tr.instanceId, tier)
        this.refreshZone(home.view)
      })
    }

    if (this.dragOrigItem) {
      this.dragOrigItem = {
        ...this.dragOrigItem,
        col,
        row,
      }
    }

    this.squeezePreview = { pair: targetPair, col, row, plan: { moves: [] } }
    this.refreshZone(targetPair.view)
    return true
  }

  // ---- 工具 ----

  private findZoneOf(instanceId: string): ZonePair | null {
    return this.pairs.find(p => p.view.hasItem(instanceId)) ?? null
  }

  /**
   * 查找最佳放置区域，同时返回目标格子。
   * - 1x1：取第一个锚点落在区域内的 zone
   * - 1x2 / 2x2（多行）：在所有锚点有效的 zone 中，取物品视觉中心 Y 距 zone 中心 Y 最近的
   *   → 实现"更靠近哪个区域就放到哪个区域"
   */
  private findBestDropTarget(
    anchorGx: number,
    anchorGy: number,
    size: ItemSizeNorm,
  ): { pair: ZonePair; cell: { col: number; row: number } } | null {
    if (size === '1x1') {
      for (const pair of this.pairs) {
        if (!pair.view.visible) continue  // 隐藏的区域不参与拖放
        const cell = pair.view.pixelToCellForItem(anchorGx, anchorGy, size, 0)
        if (cell) return { pair, cell }
      }
      return null
    }

    // 多行物品：收集所有有效候选，按距离排序取最近
    const candidates: Array<{
      pair: ZonePair
      cell: { col: number; row: number }
      dist: number
    }> = []
    for (const pair of this.pairs) {
      if (!pair.view.visible) continue  // 隐藏的区域不参与拖放
      const cell = pair.view.pixelToCellForItem(anchorGx, anchorGy, size, 0)
      if (cell) {
        // zone 共 2 行，中心 Y = zone.y + CELL_SIZE
        const zoneCenterY = pair.view.y + CELL_SIZE * pair.view.scale.y
        candidates.push({ pair, cell, dist: Math.abs(anchorGy - zoneCenterY) })
      }
    }
    if (candidates.length === 0) return null
    candidates.sort((a, b) => a.dist - b.dist)
    return { pair: candidates[0].pair, cell: candidates[0].cell }
  }

  private reset(): void {
    this.activeId       = null
    this.homeZone       = null
    this.isDragging     = false
    this.pointerOffsetX = 0
    this.pointerOffsetY = 0
    this.pointerGlobalX = 0
    this.pointerGlobalY = 0
    this.dragOrigItem   = null
    // squeezePreview 在 tryDrop/doSnapBack 中已清理；此处兜底
    this.squeezePreview = null
    this.suppressSqueeze = false
    // dragContainer 由 doSnapBack / tryDrop 单独清理
  }

  destroy(): void {
    this.stage.removeAllListeners('pointermove')
    this.stage.removeAllListeners('pointerup')
    this.stage.removeAllListeners('pointerupoutside')
    if (this.dragLayer.parent) this.dragLayer.parent.removeChild(this.dragLayer)
  }

  private canPlaceInVisibleCols(
    pair: ZonePair,
    col: number,
    row: number,
    size: ItemSizeNorm,
    excludeId?: string,
  ): boolean {
    const { w, h } = getSizeCellDim(size)
    if (col < 0 || row < 0) return false
    if (col + w > pair.view.activeColCount) return false
    if (row + h > pair.system.rows) return false
    if (excludeId) return pair.system.canPlaceExcluding(col, row, size, excludeId)
    return pair.system.canPlace(col, row, size)
  }

  private isSqueezePlanVisible(
    pair: ZonePair,
    moves: { instanceId: string; newCol: number; newRow: number }[],
  ): boolean {
    for (const move of moves) {
      const movedItem = pair.system.getItem(move.instanceId)
      if (!movedItem) return false
      if (!this.canPlaceInVisibleCols(pair, move.newCol, move.newRow, movedItem.size, move.instanceId)) return false
    }
    return true
  }
}
