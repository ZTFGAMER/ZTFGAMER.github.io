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
//   - 2x1 / 3x1 在多行区域可落任意合法 row（不再强制 row=0）
// ============================================================

import { Container } from 'pixi.js'
import type { FederatedPointerEvent } from 'pixi.js'
import type { GridSystem }     from './GridSystem'
import type { GridZone }       from './GridZone'
import { CELL_HEIGHT } from './GridZone'
import type { ItemSizeNorm }   from './GridSystem'
import { getConfig } from '@/config/debugConfig'
import { trySqueezePlace, planUnifiedSqueeze, planCrossZoneSwap } from './SqueezeLogic'
import type { SqueezePlan } from './VirtualGrid'
import { BackpackLogic } from './BackpackLogic'

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

interface CrossSwapRepackPlan {
  transfers: Array<{ instanceId: string; newCol: number; newRow: number }>
  existing: Array<{ instanceId: string; defId: string; size: ItemSizeNorm; col: number; row: number }>
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
  originCol: number
  originRow: number
  homeSystem: GridSystem
  homeView: GridZone
  defId: string
}

// ============================================================
export class DragController {
  private pairs: ZonePair[] = []
  private backpackLogic = new BackpackLogic()
  private enabled = true
  onDragStart: (instanceId: string) => void = () => {}
  onDragMove:  (payload: DragMovePayload) => void = () => {}
  onSpecialDrop: (payload: SpecialDropPayload) => boolean = () => false
  onDragEnd:   ()               => void = () => {}
  private suppressSqueeze = false
  private inSpecialDropDispatch = false

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

  // ---- 挤出状态（悬停提交，可按需回滚） ----
  private squeezePreview: {
    pair: ZonePair
    col: number
    row: number
    plan: SqueezePlan
    revert?: Array<{ instanceId: string; fromCol: number; fromRow: number; toCol: number; toRow: number }>
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

  private isDragDebugEnabled(): boolean {
    return false
  }

  private dragDebug(event: string, payload: Record<string, unknown>): void {
    if (!this.isDragDebugEnabled()) return
    console.log(`[DragDebug] ${event}`, payload)
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
      if (this.inSpecialDropDispatch) return
      this.doSnapBack()
      this.reset()
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setSqueezeSuppressed(suppressed: boolean, rollbackCommitted = false): void {
    this.suppressSqueeze = suppressed
    if (suppressed) this.clearSqueezePreview(rollbackCommitted)
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
    const home = this.homeZone
    if (!home) {
      this.reset()
      return
    }
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
    let specialHandled = false
    this.inSpecialDropDispatch = true
    try {
      specialHandled = this.onSpecialDrop({
        instanceId: id,
        anchorGx,
        anchorGy,
        size: item.size,
        originCol: this.dragOrigItem.col,
        originRow: this.dragOrigItem.row,
        homeSystem: home.system,
        homeView: home.view,
        defId: item.defId,
      })
    } finally {
      this.inSpecialDropDispatch = false
    }
    if (specialHandled) {
      this.clearSqueezePreview()
      const dragged = this.dragContainer
      if (dragged && !(dragged as { destroyed?: boolean }).destroyed) {
        if (dragged.parent) dragged.parent.removeChild(dragged)
        dragged.destroy({ children: true })
      }
      home.view.forgetDraggedItem(id)
      if (this.dragContainer === dragged) {
        this.dragContainer = null
      }
      this.onDragEnd()
      return
    }

    if (!best) { this.doSnapBack(); return }
    const { pair: targetPair, cell } = best
    const container = this.dragContainer

    // 行号按命中格 cell.row 走（背包 2 行允许自由重排）
    const finalRow = cell.row
    const isLogicalSameZone = targetPair === home

    if (targetPair.system.rows > 1 && targetPair === home) {
      const handled = this.tryDropToBackpack(targetPair, home, item, container, finalRow, cell.col)
      if (!handled) this.doSnapBack()
      return
    }

    const canDrop  = this.canPlaceInVisibleCols(targetPair, cell.col, finalRow, item.size, id)
    this.dragDebug('target', {
      id,
      mode: 'battle',
      isLogicalSameZone,
      col: cell.col,
      row: finalRow,
      canDrop,
      size: item.size,
    })

    // 无法直接放置时，尝试统一挤出（本区挤出优先，其次跨区域挤出）
    // 注：若挤出已在计时器中提交，目标格应已清空，canDrop 应为 true，此分支通常不走
    let squeezeMoves: { instanceId: string; newCol: number; newRow: number }[] = []
    let crossTransfers: { instanceId: string; newCol: number; newRow: number }[] = []
    let swapTransfers: { instanceId: string; newCol: number; newRow: number }[] = []
    let swapRepackPlan: CrossSwapRepackPlan | null = null
    const localCommits: Array<{ pair: ZonePair; revert: Array<{ instanceId: string; fromCol: number; fromRow: number; toCol: number; toRow: number }> }> = []
    let plannedDropCol = cell.col
    let plannedDropRow = finalRow
    if (!canDrop) {
      const squeezeEnabled = getConfig('dragSqueezeEnabled') >= 0.5 && !this.suppressSqueeze
      const backpackToBattle = home.system.rows > 1 && targetPair.system.rows === 1
      const allowCrossSqueeze = !backpackToBattle
      const canUseLocalSqueeze = targetPair === home
        ? (targetPair.system.rows > 1 ? isLogicalSameZone : squeezeEnabled)
        : (backpackToBattle && squeezeEnabled)
      const unifiedHomeZone = allowCrossSqueeze
        ? { system: home.system, activeColCount: home.view.activeColCount }
        : undefined
      const unifiedRaw = planUnifiedSqueeze(
        { system: targetPair.system, activeColCount: targetPair.view.activeColCount },
        cell.col,
        finalRow,
        item.size,
        id,
        unifiedHomeZone,
        this.dragOrigItem,
        targetPair.system.rows > 1 ? finalRow : undefined,
        undefined,
      )
      const unified = unifiedRaw && (
        (unifiedRaw.mode === 'local' && canUseLocalSqueeze)
        || (unifiedRaw.mode === 'cross' && targetPair !== home && allowCrossSqueeze)
      )
        ? unifiedRaw
        : null

      if (!unified) {
        const swap = this.planSwapWithFlexibleAnchor(
          { system: targetPair.system, activeColCount: targetPair.view.activeColCount },
          { system: home.system, activeColCount: home.view.activeColCount },
          cell.col,
          finalRow,
          item.size,
          id,
          this.dragOrigItem.col,
          this.dragOrigItem.row,
          this.dragOrigItem.size,
          targetPair.system.rows > 1,
        )
        if (swap) {
          swapTransfers = swap.transfers
          plannedDropCol = swap.dropCol
          plannedDropRow = swap.dropRow
        }
      }

      if (!unified && swapTransfers.length === 0) {
        const repackPlan = this.planCrossSwapViaBackpackRepack(
          targetPair,
          home,
          cell.col,
          finalRow,
          item.size,
          id,
          this.dragOrigItem.row,
        )
        if (repackPlan && repackPlan.transfers.length > 0) {
          swapTransfers = repackPlan.transfers
          swapRepackPlan = repackPlan
        }
      }

      if (!unified && swapTransfers.length === 0) {
        this.dragDebug('plan_none', {
          reason: this.suppressSqueeze ? 'suppress_squeeze' : 'no_unified_and_no_swap',
          col: cell.col,
          row: finalRow,
          size: item.size,
          isLogicalSameZone,
        })
        this.doSnapBack()
        return
      }
      this.dragDebug('plan', {
        unifiedMode: unified?.mode ?? null,
        squeezeMoves: squeezeMoves.length,
        crossTransfers: crossTransfers.length,
        swapTransfers: swapTransfers.length,
        plannedDropCol,
        plannedDropRow,
      })
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
      const committed = this.commitLocalSqueezeMoves(targetPair, squeezeMoves, squeezeMs)
      if (!committed.ok) { this.doSnapBack(); return }
      localCommits.push({ pair: targetPair, revert: committed.revert })
    }

    if (crossTransfers.length > 0 && !isLogicalSameZone) {
      if (targetPair === home) {
        // 同一物理区（背包两行）的逻辑跨区：按本区重排提交，避免 remove/add 同 view 抖动
        const squeezeMs = getConfig('squeezeMs')
        const committed = this.commitLocalSqueezeMoves(targetPair, crossTransfers, squeezeMs)
        if (!committed.ok) { this.doSnapBack(); return }
        localCommits.push({ pair: targetPair, revert: committed.revert })
      } else {
        const sourcePair = targetPair
        const destPair = home
        for (const tr of crossTransfers) {
          const movedItem = sourcePair.system.getItem(tr.instanceId)
          if (!movedItem) continue
          const tier = sourcePair.view.getItemTier(tr.instanceId)
          sourcePair.system.remove(tr.instanceId)
          if (!destPair.system.place(tr.newCol, tr.newRow, movedItem.size, movedItem.defId, tr.instanceId)) {
            this.doSnapBack()
            return
          }
          sourcePair.view.removeItem(tr.instanceId)
          destPair.view.addItem(tr.instanceId, movedItem.defId, movedItem.size, tr.newCol, tr.newRow, tier, { playAcquireFx: false }).then(() => {
            destPair.view.setItemTier(tr.instanceId, tier)
            this.refreshZone(destPair.view)
          })
        }
      }
    }

    if (swapTransfers.length > 0) {
      if (isLogicalSameZone || targetPair === home) {
        const squeezeMs = getConfig('squeezeMs')
        const committed = this.commitLocalSqueezeMoves(targetPair, swapTransfers, squeezeMs)
        if (!committed.ok) { this.doSnapBack(); return }
        localCommits.push({ pair: targetPair, revert: committed.revert })
      } else {
        const sourcePair = targetPair
        const destPair = home
        if (swapRepackPlan && destPair.system.rows > 1) {
          const moved = this.backpackLogic.applyPlacementPlan(destPair.system, swapRepackPlan.existing)
          const squeezeMs = getConfig('squeezeMs')
          for (const mv of moved) {
            destPair.view.animateToCell(mv.instanceId, mv.toCol, mv.toRow, squeezeMs)
          }
        }
        for (const tr of swapTransfers) {
          const movedItem = sourcePair.system.getItem(tr.instanceId)
          if (!movedItem) continue
          const tier = sourcePair.view.getItemTier(tr.instanceId)
          sourcePair.system.remove(tr.instanceId)
          if (!destPair.system.place(tr.newCol, tr.newRow, movedItem.size, movedItem.defId, tr.instanceId)) {
            this.doSnapBack()
            return
          }
          sourcePair.view.removeItem(tr.instanceId)
          destPair.view.addItem(tr.instanceId, movedItem.defId, movedItem.size, tr.newCol, tr.newRow, tier, { playAcquireFx: false }).then(() => {
            destPair.view.setItemTier(tr.instanceId, tier)
            this.refreshZone(destPair.view)
          })
        }
      }
    }

    // 3. 放置 DRAG 到目标位置
    let dropCol = plannedDropCol
    let dropRow = plannedDropRow
    this.dragDebug('pre_place_state', {
      id,
      dropCol,
      dropRow,
      blockers: this.listOverlapIds(targetPair, dropCol, dropRow, item.size, id),
    })
    if (!targetPair.system.canPlace(dropCol, dropRow, item.size)) {
      const cleanup = trySqueezePlace(
        targetPair.system,
        id,
        dropCol,
        dropRow,
        item.size,
        this.dragOrigItem ?? undefined,
        targetPair.system.rows > 1 ? dropRow : undefined,
      )
      if (cleanup?.moves && cleanup.moves.length > 0) {
        const committed = this.commitLocalSqueezeMoves(targetPair, cleanup.moves, getConfig('squeezeMs'))
        if (committed.ok) {
          localCommits.push({ pair: targetPair, revert: committed.revert })
          this.dragDebug('pre_place_cleanup_ok', { moves: cleanup.moves.length })
        } else {
          this.dragDebug('pre_place_cleanup_failed', { reason: 'commit_failed' })
        }
      }
    }
    if (!targetPair.system.place(dropCol, dropRow, item.size, item.defId, id)) {
      this.dragDebug('place_failed', { id, dropCol, dropRow, size: item.size })
      const fallback = this.findNearestVisiblePlace(
        targetPair,
        dropCol,
        dropRow,
        item.size,
        id,
        targetPair.system.rows > 1 ? dropRow : undefined,
      )
      if (!fallback) {
        for (let i = localCommits.length - 1; i >= 0; i--) {
          const c = localCommits[i]!
          this.rollbackLocalMoves(c.pair, c.revert)
        }
        this.doSnapBack()
        return
      }
      if (!targetPair.system.place(fallback.col, fallback.row, item.size, item.defId, id)) {
        for (let i = localCommits.length - 1; i >= 0; i--) {
          const c = localCommits[i]!
          this.rollbackLocalMoves(c.pair, c.revert)
        }
        this.dragDebug('fallback_failed', { id, col: fallback.col, row: fallback.row, size: item.size })
        this.doSnapBack()
        return
      }
      this.dragDebug('fallback_ok', { id, col: fallback.col, row: fallback.row, size: item.size })
      dropCol = fallback.col
      dropRow = fallback.row
    }

    if (targetPair !== home) {
      // 跨区域：销毁旧 container，在目标 zone 创建新 container
      const draggedTier = home.view.getItemTier(id)
      this.dragLayer.removeChild(container)
      container.destroy({ children: true })
      home.view.forgetDraggedItem(id)

      targetPair.view.addItem(id, item.defId, item.size, dropCol, dropRow, draggedTier, { playAcquireFx: false }).then(() => {
        targetPair.view.setItemTier(id, draggedTier)
        this.refreshZone(targetPair.view)
      })
    } else {
      // 同区域：从 dragLayer 归还给 zone.itemLayer，吸附到新格子
      this.dragLayer.removeChild(container)
      home.view.snapToCellFromDrag(id, container, dropCol, dropRow)
    }
    this.onDragEnd()
  }

  private doSnapBack(): void {
    // 放置失败回弹时回滚已提交的挤出，避免原位被占导致物品卡死
    this.clearSqueezePreview(true)

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
      if (home.system.canPlace(origItem.col, origItem.row, origItem.size)) {
        home.system.place(origItem.col, origItem.row, origItem.size, origItem.defId, id)
        snapCol = origItem.col
        snapRow = origItem.row
        useNewCell = true
      } else {
        const rows = Array.from({ length: home.system.rows }, (_, i) => i)
        outer: for (let c = 0; c < home.system.cols; c++) {
          for (const r of rows) {
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

  private tryDropToBackpack(
    targetPair: ZonePair,
    home: ZonePair,
    item: { instanceId: string; defId: string; size: ItemSizeNorm },
    container: Container,
    preferredRow: number,
    preferredCol: number,
  ): boolean {
    const plan = this.backpackLogic.buildDropPlan(
      targetPair.system,
      targetPair.view.activeColCount,
      {
        instanceId: item.instanceId,
        defId: item.defId,
        size: item.size,
      },
      { col: preferredCol, row: preferredRow },
    )
    if (!plan) return false

    this.clearSqueezePreview()
    this.dragContainer = null

    home.system.remove(item.instanceId)
    const moved = this.backpackLogic.applyDropPlan(targetPair.system, plan)

    const squeezeMs = getConfig('squeezeMs')
    for (const mv of moved) {
      if (mv.instanceId === item.instanceId) continue
      targetPair.view.animateToCell(mv.instanceId, mv.toCol, mv.toRow, squeezeMs)
    }

    if (targetPair !== home) {
      const draggedTier = home.view.getItemTier(item.instanceId)
      this.dragLayer.removeChild(container)
      container.destroy({ children: true })
      home.view.forgetDraggedItem(item.instanceId)
      targetPair.view.addItem(
        item.instanceId,
        item.defId,
        item.size,
        plan.incoming.col,
        plan.incoming.row,
        draggedTier,
        { playAcquireFx: false },
      ).then(() => {
        targetPair.view.setItemTier(item.instanceId, draggedTier)
        this.refreshZone(targetPair.view)
      })
    } else {
      this.dragLayer.removeChild(container)
      home.view.snapToCellFromDrag(item.instanceId, container, plan.incoming.col, plan.incoming.row)
    }

    this.onDragEnd()
    return true
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
      const finalRow = cell.row
      const isLogicalSameZone = pair === this.homeZone
      if (pair.system.rows > 1 && pair === this.homeZone) {
        this.clearSqueezePreview()
        const plan = this.backpackLogic.buildDropPlan(
          pair.system,
          pair.view.activeColCount,
          {
            instanceId: this.activeId,
            defId: item.defId,
            size: item.size,
          },
          { col: cell.col, row: finalRow },
        )
        for (const other of this.pairs)
          if (other !== pair) other.view.clearHighlight()
        pair.view.highlightCells(cell.col, finalRow, item.size, !!plan)
        return
      }
      const canDrop  = this.canPlaceInVisibleCols(pair, cell.col, finalRow, item.size, this.activeId)
      for (const other of this.pairs)
        if (other !== pair) other.view.clearHighlight()

      if (!canDrop) {
        const squeezeEnabled = getConfig('dragSqueezeEnabled') >= 0.5 && !this.suppressSqueeze
        const backpackToBattle = this.homeZone.system.rows > 1 && pair.system.rows === 1
        const allowCrossSqueeze = !backpackToBattle
        const canUseLocalSqueeze = pair === this.homeZone
          ? (pair.system.rows > 1 ? isLogicalSameZone : squeezeEnabled)
          : (backpackToBattle && squeezeEnabled)
        const unifiedHomeZone = allowCrossSqueeze
          ? { system: this.homeZone.system, activeColCount: this.homeZone.view.activeColCount }
          : undefined
        const unifiedRaw = planUnifiedSqueeze(
          { system: pair.system, activeColCount: pair.view.activeColCount },
          cell.col,
          finalRow,
          item.size,
          this.activeId,
          unifiedHomeZone,
          this.dragOrigItem,
          pair.system.rows > 1 ? finalRow : undefined,
          undefined,
        )
        const unified = unifiedRaw && (
          (unifiedRaw.mode === 'local' && canUseLocalSqueeze)
          || (unifiedRaw.mode === 'cross' && pair !== this.homeZone && allowCrossSqueeze)
        )
          ? unifiedRaw
          : null
        if (unified?.mode === 'cross') {
          this.clearSqueezePreview()
          pair.view.highlightCells(cell.col, finalRow, item.size, true)
          return
        }
        if (unified?.mode === 'local' && unified.moves.length > 0) {
          const squeezable = this.updateSqueezePreview(pair, cell.col, finalRow, item.size, unified.moves)
          pair.view.highlightCells(cell.col, finalRow, item.size, squeezable)
          return
        }

        const home = this.homeZone
        const swap = this.planSwapWithFlexibleAnchor(
          { system: pair.system, activeColCount: pair.view.activeColCount },
          { system: home.system, activeColCount: home.view.activeColCount },
          cell.col,
          finalRow,
          item.size,
          this.activeId,
          this.dragOrigItem.col,
          this.dragOrigItem.row,
          this.dragOrigItem.size,
          pair.system.rows > 1,
        )
        if (swap) {
          this.clearSqueezePreview()
          pair.view.highlightCells(swap.dropCol, swap.dropRow, item.size, true)
          return
        }

        const repackTransfers = this.planCrossSwapViaBackpackRepack(
          pair,
          home,
          cell.col,
          finalRow,
          item.size,
          this.activeId,
          this.dragOrigItem.row,
        )
        if (repackTransfers && repackTransfers.transfers.length > 0) {
          this.clearSqueezePreview()
          pair.view.highlightCells(cell.col, finalRow, item.size, true)
          return
        }

        if (!canUseLocalSqueeze) {
          this.clearSqueezePreview()
          pair.view.highlightCells(cell.col, finalRow, item.size, false)
          return
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

  private commitLocalSqueezeMoves(
    pair: ZonePair,
    moves: Array<{ instanceId: string; newCol: number; newRow: number }>,
    durationMs: number,
  ): { ok: boolean; revert: Array<{ instanceId: string; fromCol: number; fromRow: number; toCol: number; toRow: number }> } {
    const captured: Array<{
      instanceId: string
      defId: string
      size: ItemSizeNorm
      fromCol: number
      fromRow: number
      toCol: number
      toRow: number
    }> = []

    for (const move of moves) {
      const it = pair.system.getItem(move.instanceId)
      if (!it) return { ok: false, revert: [] }
      captured.push({
        instanceId: it.instanceId,
        defId: it.defId,
        size: it.size,
        fromCol: it.col,
        fromRow: it.row,
        toCol: move.newCol,
        toRow: move.newRow,
      })
    }

    for (const c of captured) pair.system.remove(c.instanceId)

    const placed: typeof captured = []
    for (const c of captured) {
      if (!pair.system.place(c.toCol, c.toRow, c.size, c.defId, c.instanceId)) {
        for (const p of placed) pair.system.remove(p.instanceId)
        for (const r of captured) {
          pair.system.place(r.fromCol, r.fromRow, r.size, r.defId, r.instanceId)
        }
        return { ok: false, revert: [] }
      }
      placed.push(c)
    }

    for (const c of captured) {
      pair.view.animateToCell(c.instanceId, c.toCol, c.toRow, durationMs)
    }

    return {
      ok: true,
      revert: captured.map((c) => ({
        instanceId: c.instanceId,
        fromCol: c.fromCol,
        fromRow: c.fromRow,
        toCol: c.toCol,
        toRow: c.toRow,
      })),
    }
  }

  private rollbackLocalMoves(
    pair: ZonePair,
    revert: Array<{ instanceId: string; fromCol: number; fromRow: number; toCol: number; toRow: number }>,
  ): void {
    for (const step of revert) {
      const movedItem = pair.system.getItem(step.instanceId)
      if (!movedItem) continue
      pair.system.remove(step.instanceId)
      if (!pair.system.place(step.fromCol, step.fromRow, movedItem.size, movedItem.defId, movedItem.instanceId)) continue
      pair.view.animateToCell(step.instanceId, step.fromCol, step.fromRow, getConfig('squeezeMs'))
    }
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

    const committed = this.commitLocalSqueezeMoves(pair, planMoves, squeezeMs)
    if (!committed.ok) return false

    // 挤出一旦提交，拖拽物的“逻辑锚点”更新到当前目标位。
    // 这样后续继续移动时，可基于新位置再次发生互换/挤出（支持来回连续挤出）。
    if (this.dragOrigItem && pair.system.rows === 1) {
      this.dragOrigItem = {
        ...this.dragOrigItem,
        col,
        row,
      }
    }

    this.squeezePreview = { pair, col, row, plan: { moves: planMoves }, revert: committed.revert }
    return true
  }

  /**
   * 清理挤出记录。
   * 已提交的挤出不还原——物品保持其已提交的新位置。
   */
  private clearSqueezePreview(rollbackCommitted = false): void {
    if (rollbackCommitted && this.squeezePreview?.revert && this.squeezePreview.revert.length > 0) {
      const preview = this.squeezePreview
      const squeezeMs = getConfig('squeezeMs')
      const revertMoves = preview.revert ?? []
      for (const step of revertMoves) {
        const movedItem = preview.pair.system.getItem(step.instanceId)
        if (!movedItem) continue
        preview.pair.system.remove(step.instanceId)
        if (!preview.pair.system.place(step.fromCol, step.fromRow, movedItem.size, movedItem.defId, movedItem.instanceId)) continue
        preview.pair.view.animateToCell(step.instanceId, step.fromCol, step.fromRow, squeezeMs)
      }
    }
    this.squeezePreview = null
  }

  // ---- 工具 ----

  private findZoneOf(instanceId: string): ZonePair | null {
    return this.pairs.find(p => p.view.hasItem(instanceId)) ?? null
  }

  /**
   * 查找最佳放置区域，同时返回目标格子。
   * - 1x1：取第一个锚点落在区域内的 zone
   * - 2x1 / 3x1（宽物品）：在所有锚点有效的 zone 中，取物品视觉中心 Y 距 zone 中心 Y 最近的
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
      const cell = pair.view.pixelToCellForItem(anchorGx, anchorGy, size, getConfig('dragYOffset'))
      if (cell) return { pair, cell }
    }
      return null
    }

    // 宽物品：收集所有有效候选，按距离排序取最近
    const candidates: Array<{
      pair: ZonePair
      cell: { col: number; row: number }
      dist: number
    }> = []
    for (const pair of this.pairs) {
      if (!pair.view.visible) continue  // 隐藏的区域不参与拖放
      const cell = pair.view.pixelToCellForItem(anchorGx, anchorGy, size, getConfig('dragYOffset'))
      if (cell) {
        const cellCenterY = pair.view.y + ((cell.row + 0.5) * CELL_HEIGHT * pair.view.scale.y)
        candidates.push({ pair, cell, dist: Math.abs(anchorGy - cellCenterY) })
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

  private findNearestVisiblePlace(
    pair: ZonePair,
    preferredCol: number,
    preferredRow: number,
    size: ItemSizeNorm,
    excludeId?: string,
    rowLock?: number,
  ): { col: number; row: number } | null {
    const { w, h } = getSizeCellDim(size)
    const maxCol = pair.view.activeColCount - w
    const maxRow = pair.system.rows - h
    if (maxCol < 0 || maxRow < 0) return null

    let best: { col: number; row: number; score: number } | null = null
    const rows = rowLock != null ? [rowLock] : Array.from({ length: maxRow + 1 }, (_, i) => i)
    for (const row of rows) {
      for (let col = 0; col <= maxCol; col++) {
        if (!this.canPlaceInVisibleCols(pair, col, row, size, excludeId)) continue
        const dRow = Math.abs(row - preferredRow)
        const dCol = Math.abs(col - preferredCol)
        const score = dRow * 100 + dCol
        if (!best || score < best.score) best = { col, row, score }
      }
    }
    return best ? { col: best.col, row: best.row } : null
  }

  private planSwapWithFlexibleAnchor(
    targetZone: { system: GridSystem; activeColCount: number },
    homeZone: { system: GridSystem; activeColCount: number },
    targetCol: number,
    targetRow: number,
    draggedSize: ItemSizeNorm,
    draggedId: string,
    footprintCol: number,
    footprintRow: number,
    footprintSize: ItemSizeNorm,
    lockTargetRow = false,
  ): { transfers: Array<{ instanceId: string; newCol: number; newRow: number }>; dropCol: number; dropRow: number } | null {
    const { w } = getSizeCellDim(draggedSize)
    const maxCol = targetZone.activeColCount - w
    const maxRow = Math.max(0, targetZone.system.rows - 1)
    const candidates = [targetCol, targetCol - 1, targetCol + 1, targetCol - 2, targetCol + 2]
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .filter((col) => col >= 0 && col <= maxCol)
    const rowCandidates = lockTargetRow
      ? [targetRow]
      : [targetRow, targetRow - 1, targetRow + 1].filter((v, i, arr) => arr.indexOf(v) === i)
    const legalRows = rowCandidates.filter((row) => row >= 0 && row <= maxRow)

    for (const row of legalRows) {
      for (const col of candidates) {
        const swap = planCrossZoneSwap(
          targetZone,
          homeZone,
          col,
          row,
          draggedSize,
          draggedId,
          footprintCol,
          footprintRow,
          footprintSize,
        )
        if (swap) return { transfers: swap.transfers, dropCol: col, dropRow: row }
      }
    }
    return null
  }

  private planCrossSwapViaBackpackRepack(
    targetPair: ZonePair,
    homePair: ZonePair,
    dropCol: number,
    dropRow: number,
    draggedSize: ItemSizeNorm,
    draggedId: string,
    preferredIncomingRow?: number,
  ): CrossSwapRepackPlan | null {
    if (targetPair === homePair) return null
    if (targetPair.system.rows !== 1) return null
    if (homePair.system.rows <= 1) return null

    const blockerIds = this.listOverlapIds(targetPair, dropCol, dropRow, draggedSize, draggedId)
    if (blockerIds.length === 0) return null

    const incoming = blockerIds.flatMap((id) => {
      const it = targetPair.system.getItem(id)
      if (!it) return []
      return [{ instanceId: it.instanceId, defId: it.defId, size: it.size }]
    })
    if (incoming.length === 0) return null

    const plan = this.backpackLogic.buildTransferPlan(
      homePair.system,
      homePair.view.activeColCount,
      incoming,
      preferredIncomingRow,
    )
    if (!plan) return null

    const posById = new Map(plan.map((p) => [p.instanceId, p] as const))
    const transfers: Array<{ instanceId: string; newCol: number; newRow: number }> = []
    for (const it of incoming) {
      const p = posById.get(it.instanceId)
      if (!p) return null
      transfers.push({ instanceId: it.instanceId, newCol: p.col, newRow: p.row })
    }

    const incomingSet = new Set(incoming.map((it) => it.instanceId))
    const existing = plan
      .filter((p) => !incomingSet.has(p.instanceId))
      .map((p) => ({ instanceId: p.instanceId, defId: p.defId, size: p.size, col: p.col, row: p.row }))
    return { transfers, existing }
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

  private listOverlapIds(
    pair: ZonePair,
    col: number,
    row: number,
    size: ItemSizeNorm,
    excludeId?: string,
  ): string[] {
    const out: string[] = []
    const { w, h } = getSizeCellDim(size)
    const l = col
    const r = col + w
    const t = row
    const b = row + h
    for (const it of pair.system.getAllItems()) {
      if (excludeId && it.instanceId === excludeId) continue
      const d = getSizeCellDim(it.size)
      const il = it.col
      const ir = it.col + d.w
      const itop = it.row
      const ib = it.row + d.h
      if (l < ir && r > il && t < ib && b > itop) out.push(it.instanceId)
    }
    return out
  }
}
