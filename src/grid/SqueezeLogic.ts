// ============================================================
// SqueezeLogic — 挤出算法
//
// 规则：
//   1. 只在同一 Zone 内挤出（不跨 Zone）
//   2. 每个 blocker 优先向"就近方向"推（位移最小的方向）
//   3. 连锁推：目标位置已被占则继续向同方向推
//   4. 全在 VirtualGrid 上试验，成功后一次性提交
//   5. 失败则返回 null（调用方负责弹回）
// ============================================================

import type { GridSystem, ItemSizeNorm, PlacedItem } from './GridSystem'
import { VirtualGrid, VSIZE_MAP, type Move, type SqueezePlan } from './VirtualGrid'

export interface SqueezeZoneView {
  system: GridSystem
  activeColCount: number
}

export interface CrossZoneTransfer {
  instanceId: string
  newCol: number
  newRow: number
}

export interface SwapFallbackPlan {
  transfers: CrossZoneTransfer[]
}

export type UnifiedSqueezePlan =
  | { mode: 'local'; moves: Move[] }
  | { mode: 'cross'; transfers: CrossZoneTransfer[] }

// ---- 内部类型 ----

interface BlockerInfo {
  id:        string
  w:         number
  leftDisp:  number   // 向左推出目标区域所需最小位移（列数）
  rightDisp: number   // 向右推出目标区域所需最小位移（列数）
  preferDir: 'LEFT' | 'RIGHT'
}

interface CellPos {
  col: number
  row: number
}

function areaOf(size: ItemSizeNorm): number {
  const { w, h } = VSIZE_MAP[size]
  return w * h
}

function canPlaceRaw(vg: VirtualGrid, col: number, row: number, size: ItemSizeNorm, maxCols = 6): boolean {
  const { w, h } = VSIZE_MAP[size]
  const maxRows = vg.grid[0]?.length ?? 1
  if (col < 0 || row < 0 || col + w > maxCols || row + h > maxRows) return false
  for (let c = col; c < col + w; c++)
    for (let r = row; r < row + h; r++)
      if (vg.grid[c][r] !== null) return false
  return true
}

function attemptRelocateBlockersAnyLayout(
  baseVg: VirtualGrid,
  blockerIds: Set<string>,
  targetCol: number,
  targetRow: number,
  draggedSize: ItemSizeNorm,
  maxCols = 6,
): Move[] | null {
  if (blockerIds.size === 0) return []

  const vg = baseVg.clone()
  const blockers: PlacedItem[] = []
  for (const id of blockerIds) {
    const it = vg.getItem(id)
    if (!it) continue
    blockers.push({ ...it })
    vg.remove(id)
  }

  // 预占拖拽物目标区域，确保 blocker 不会回填到目标覆盖区
  const { w: dw, h: dh } = VSIZE_MAP[draggedSize]
  const maxRows = vg.grid[0]?.length ?? 1
  for (let c = targetCol; c < targetCol + dw; c++) {
    for (let r = targetRow; r < targetRow + dh; r++) {
      if (c < 0 || c >= maxCols || r < 0 || r >= maxRows) return null
      if (vg.grid[c][r] !== null) return null
      vg.grid[c][r] = '__TARGET__'
    }
  }

  const sorted = [...blockers].sort((a, b) => areaOf(b.size) - areaOf(a.size))
  const moves = new Map<string, Move>()

  const dfs = (idx: number): boolean => {
    if (idx >= sorted.length) return true
    const item = sorted[idx]!

    const candidates: CellPos[] = []
    // 优先原位（若不与 target 重叠）
    candidates.push({ col: item.col, row: item.row })
      for (let r = 0; r < 1; r++) {
      for (let c = 0; c < maxCols; c++) {
        if (c === item.col && r === item.row) continue
        candidates.push({ col: c, row: r })
      }
    }

    for (const cand of candidates) {
      if (!canPlaceRaw(vg, cand.col, cand.row, item.size, maxCols)) continue
      vg.place(cand.col, cand.row, item.size, item.defId, item.instanceId)
      moves.set(item.instanceId, { instanceId: item.instanceId, newCol: cand.col, newRow: cand.row })
      if (dfs(idx + 1)) return true
      vg.remove(item.instanceId)
      moves.delete(item.instanceId)
    }
    return false
  }

  if (!dfs(0)) return null
  return blockers.map(b => moves.get(b.instanceId)!).filter(m => !!m)
}

function canPackBlockersIntoFootprint(
  baseVg: VirtualGrid,
  blockerIds: Set<string>,
  footprintCol: number,
  footprintRow: number,
  footprintSize: ItemSizeNorm,
  draggedId: string,
): Move[] | null {
  if (blockerIds.size === 0) return []

  const vg = baseVg.clone()
  const blockers = [...blockerIds]
    .map((id) => vg.getItem(id))
    .filter((it): it is PlacedItem => !!it)
    .sort((a, b) => getCellArea(b.size) - getCellArea(a.size))

  for (const blocker of blockers) vg.remove(blocker.instanceId)

  const moves: Move[] = []
  const dfs = (idx: number): boolean => {
    if (idx >= blockers.length) return true
    const blocker = blockers[idx]!
    const candidates = enumerateFootprintPlacements(footprintCol, footprintRow, footprintSize, blocker.size)
    for (const pos of candidates) {
      if (!vg.canPlaceExcluding(pos.col, pos.row, blocker.size, draggedId)) continue
      if (!vg.place(pos.col, pos.row, blocker.size, blocker.defId, blocker.instanceId)) continue
      moves.push({ instanceId: blocker.instanceId, newCol: pos.col, newRow: pos.row })
      if (dfs(idx + 1)) return true
      moves.pop()
      vg.remove(blocker.instanceId)
    }
    return false
  }

  if (!dfs(0)) return null
  return moves
}

function footprintsOverlap(
  aCol: number,
  aRow: number,
  aSize: ItemSizeNorm,
  bCol: number,
  bRow: number,
  bSize: ItemSizeNorm,
): boolean {
  const a = VSIZE_MAP[aSize]
  const b = VSIZE_MAP[bSize]
  return aCol < bCol + b.w && aCol + a.w > bCol && aRow < bRow + b.h && aRow + a.h > bRow
}

// ---- 辅助：检测物品是否仍与目标区域重叠 ----

function overlapsTarget(
  item:      PlacedItem,
  targetCol: number,
  targetRow: number,
  w_d:       number,
  h_d:       number,
): boolean {
  const { w, h } = VSIZE_MAP[item.size]
  return (
    item.col     < targetCol + w_d &&
    item.col + w > targetCol       &&
    item.row     < targetRow + h_d &&
    item.row + h > targetRow
  )
}

function trySmallVerticalSwap(
  baseVg: VirtualGrid,
  draggedOrigin: { col: number; row: number; size: ItemSizeNorm } | undefined,
  blockerIds: Set<string>,
): Move[] | null {
  if (blockerIds.size !== 1) return null
  const dragged = draggedOrigin
  if (!dragged || dragged.size !== '1x1') return null
  const blockerId = [...blockerIds][0]!
  const blocker = baseVg.getItem(blockerId)
  if (!blocker || blocker.size !== '1x1') return null
  if (dragged.col !== blocker.col) return null
  if (Math.abs(dragged.row - blocker.row) !== 1) return null
  if (!baseVg.canPlaceExcluding(dragged.col, dragged.row, '1x1', '__drag__')) return null
  return [{ instanceId: blockerId, newCol: dragged.col, newRow: dragged.row }]
}

function trySmallVerticalDiagonal(
  baseVg: VirtualGrid,
  draggedId: string,
  blockerIds: Set<string>,
): Move[] | null {
  if (blockerIds.size !== 1) return null
  const blockerId = [...blockerIds][0]!
  const blocker = baseVg.getItem(blockerId)
  if (!blocker || blocker.size !== '1x1') return null

  const otherRow = blocker.row === 0 ? 1 : 0
  const candidates: CellPos[] = [
    { col: blocker.col, row: otherRow },
    { col: blocker.col - 1, row: otherRow },
    { col: blocker.col + 1, row: otherRow },
  ]

  for (const c of candidates) {
    if (c.col < 0 || c.col >= 6) continue
    if (baseVg.canPlaceExcluding(c.col, c.row, '1x1', draggedId)) {
      return [{ instanceId: blockerId, newCol: c.col, newRow: c.row }]
    }
  }
  return null
}

function trySingleBigSideAwarePush(
  baseVg: VirtualGrid,
  blockerIds: Set<string>,
  targetCol: number,
  draggedSize: ItemSizeNorm,
  draggedId: string,
): Move[] | null | undefined {
  if (draggedSize !== '1x1' && draggedSize !== '2x1') return undefined
  if (blockerIds.size !== 1) return undefined

  const blockerId = [...blockerIds][0]!
  const blocker = baseVg.getItem(blockerId)
  if (!blocker || blocker.size !== '3x1') return undefined

  const leftCol = blocker.col
  const rightCol = blocker.col + 1
  if (targetCol !== leftCol && targetCol !== rightCol) return undefined

  const pushRight = targetCol === leftCol
  const newCol = pushRight ? blocker.col + 1 : blocker.col - 1
  const testVg = baseVg.clone()
  testVg.remove(blocker.instanceId)
  if (testVg.canPlaceExcluding(newCol, blocker.row, blocker.size, draggedId)) {
    return [{ instanceId: blocker.instanceId, newCol, newRow: blocker.row }]
  }

  // 该场景命中但对侧无 1 列空间时，按需求直接判定不可挤出。
  return null
}

function canPlaceInVisibleColsOnVirtual(
  vg: VirtualGrid,
  activeColCount: number,
  col: number,
  row: number,
  size: ItemSizeNorm,
  excludeId: string,
): boolean {
  const { w, h } = VSIZE_MAP[size]
  if (col < 0 || row < 0) return false
  if (col + w > activeColCount) return false
  if (row + h > 1) return false
  return vg.canPlaceExcluding(col, row, size, excludeId)
}

function findFirstVisiblePlace(
  vg: VirtualGrid,
  activeColCount: number,
  size: ItemSizeNorm,
  excludeId: string,
): { col: number; row: number } | null {
  const { w, h } = VSIZE_MAP[size]
  const maxCol = activeColCount - w
  const maxRow = 1 - h
  if (maxCol < 0 || maxRow < 0) return null
  for (let r = 0; r <= maxRow; r++) {
    for (let c = 0; c <= maxCol; c++) {
      if (vg.canPlaceExcluding(c, r, size, excludeId)) return { col: c, row: r }
    }
  }
  return null
}

function collectTargetBlockerIds(
  vg: VirtualGrid,
  targetCol: number,
  targetRow: number,
  draggedSize: ItemSizeNorm,
): string[] {
  const { w, h } = VSIZE_MAP[draggedSize]
  const ids = new Set<string>()
  for (let c = targetCol; c < targetCol + w; c++) {
    for (let r = targetRow; r < targetRow + h; r++) {
      const id = vg.grid[c]?.[r]
      if (id) ids.add(id)
    }
  }
  return [...ids]
}

function enumerateFootprintPlacements(
  footprintCol: number,
  footprintRow: number,
  footprintSize: ItemSizeNorm,
  itemSize: ItemSizeNorm,
): Array<{ col: number; row: number }> {
  const out: Array<{ col: number; row: number }> = []
  const { w: fw, h: fh } = VSIZE_MAP[footprintSize]
  const { w, h } = VSIZE_MAP[itemSize]
  const maxCol = footprintCol + fw - w
  const maxRow = footprintRow + fh - h
  for (let row = footprintRow; row <= maxRow; row++) {
    for (let col = footprintCol; col <= maxCol; col++) {
      out.push({ col, row })
    }
  }
  return out
}

function getCellArea(size: ItemSizeNorm): number {
  const dim = VSIZE_MAP[size]
  return dim.w * dim.h
}

// ---- 核心：将单个物品推向 idealCol（连锁递归）----
//
// 先递归推开目标位置上的障碍物，再将自身放入 idealCol。
// depth 防止无限递归（最大深度 = 5 列，实际不可能超过 6）。

function pushToIdeal(
  vg:        VirtualGrid,
  itemId:    string,
  idealCol:  number,
  dir:       'LEFT' | 'RIGHT',
  draggedId: string,
  collected: Move[],
  depth:     number,
): boolean {
  if (depth > 6) return false

  const item = vg.getItem(itemId)
  if (!item) return true  // 已被之前的连锁移走

  const { w, h } = VSIZE_MAP[item.size]

  // 越界检测
    if (idealCol < 0 || idealCol + w > 6) return false

  // 收集目标位置上的冲突物品（排除自身和 dragged）
  const conflicts = new Set<string>()
  for (let c = idealCol; c < idealCol + w; c++)
    for (let r = item.row; r < item.row + h; r++) {
      const cell = vg.grid[c][r]
      if (cell && cell !== itemId && cell !== draggedId) conflicts.add(cell)
    }

  // 先递归推开所有冲突物品
  for (const cId of conflicts) {
    const ci = vg.getItem(cId)
    if (!ci) continue
    const { w: cw } = VSIZE_MAP[ci.size]
    const chainIdeal = dir === 'LEFT' ? idealCol - cw : idealCol + w
    if (!pushToIdeal(vg, cId, chainIdeal, dir, draggedId, collected, depth + 1)) return false
  }

  // 将自身移至 idealCol
  vg.remove(itemId)
  if (!vg.place(idealCol, item.row, item.size, item.defId, itemId)) return false

  collected.push({ instanceId: itemId, newCol: idealCol, newRow: item.row })
  return true
}

// ---- 策略 A：每个 blocker 按就近方向推 ----

function attemptPreferred(
  baseVg:      VirtualGrid,
  blockers:    BlockerInfo[],
  targetCol:   number,
  targetRow:   number,
  w_d:         number,
  h_d:         number,
  draggedId:   string,
): Move[] | null {
  const vg    = baseVg.clone()
  const moves: Move[] = []

  for (const { id, w, preferDir } of blockers) {
    const cur = vg.getItem(id)
    if (!cur) continue
    if (!overlapsTarget(cur, targetCol, targetRow, w_d, h_d)) continue

    const idealCol = preferDir === 'LEFT' ? targetCol - w : targetCol + w_d
    if (!pushToIdeal(vg, id, idealCol, preferDir, draggedId, moves, 0)) return null
  }
  return moves
}

// ---- 策略 B：所有 blocker 统一方向 ----

function attemptAllDir(
  baseVg:    VirtualGrid,
  blockers:  BlockerInfo[],
  dir:       'LEFT' | 'RIGHT',
  targetCol: number,
  targetRow: number,
  w_d:       number,
  h_d:       number,
  draggedId: string,
): Move[] | null {
  const vg    = baseVg.clone()
  const moves: Move[] = []

  // 向左推时先处理最靠左的 blocker，避免连锁碰撞
  const sorted = [...blockers].sort((a, b) =>
    dir === 'LEFT'
      ? vg.getItem(a.id)!.col - vg.getItem(b.id)!.col
      : vg.getItem(b.id)!.col - vg.getItem(a.id)!.col,
  )

  for (const { id, w } of sorted) {
    const cur = vg.getItem(id)
    if (!cur) continue
    if (!overlapsTarget(cur, targetCol, targetRow, w_d, h_d)) continue

    const idealCol = dir === 'LEFT' ? targetCol - w : targetCol + w_d
    if (!pushToIdeal(vg, id, idealCol, dir, draggedId, moves, 0)) return null
  }
  return moves
}

// ---- 公开入口 ----

/**
 * 在虚拟网格上尝试挤出 blockers 为 dragged 腾出空间。
 * 返回 SqueezePlan（含 moves 列表）或 null（空间不足，弹回）。
 *
 * 策略优先级：
 *   1. 每个 blocker 各自按就近方向推（位移最小）
 *   2. 全部向左
 *   3. 全部向右
 */
export function trySqueezePlace(
  system:      GridSystem,
  draggedId:   string,
  targetCol:   number,
  targetRow:   number,
  draggedSize: ItemSizeNorm,
  draggedOriginOverride?: { col: number; row: number; size: ItemSizeNorm },
): SqueezePlan | null {
  const { w: w_d, h: h_d } = VSIZE_MAP[draggedSize]

  const draggedOrigin = draggedOriginOverride ?? system.getItem(draggedId)
  const baseVg = VirtualGrid.from(system)
  baseVg.remove(draggedId)

  // 收集所有 blockers（目标格子里的物品）
  const blockerIds = new Set<string>()
  for (let c = targetCol; c < targetCol + w_d; c++)
    for (let r = targetRow; r < targetRow + h_d; r++) {
      const cell = baseVg.grid[c][r]
      if (cell) blockerIds.add(cell)
    }

  if (blockerIds.size === 0) return { moves: [] }

  // 特例：两个 1x1 处于上下关系时优先互换
  const swap = trySmallVerticalSwap(baseVg, draggedOrigin, blockerIds)
  if (swap) return { moves: swap }

  // 特例：小/中拖到大型(3x1)左/右半区时，仅允许把大型推向对侧 1 列。
  const sideAwareBig = trySingleBigSideAwarePush(baseVg, blockerIds, targetCol, draggedSize, draggedId)
  if (sideAwareBig) return { moves: sideAwareBig }
  if (sideAwareBig === null) return null

  // 优先尝试把 blocker 填入拖拽物来源 footprint（玩家体感：向右拖时右侧优先回填左侧空位）
  if (
    draggedOrigin
    && !footprintsOverlap(draggedOrigin.col, draggedOrigin.row, draggedOrigin.size, targetCol, targetRow, draggedSize)
  ) {
    const originPack = canPackBlockersIntoFootprint(
      baseVg,
      blockerIds,
      draggedOrigin.col,
      draggedOrigin.row,
      draggedOrigin.size,
      draggedId,
    )
    if (originPack) return { moves: originPack }
  }

  // 构建 BlockerInfo（就近方向）
  const blockers: BlockerInfo[] = [...blockerIds].map(id => {
    const item      = baseVg.getItem(id)!
    const { w }     = VSIZE_MAP[item.size]
    const leftDisp  = item.col + w - targetCol        // 向左推出所需位移
    const rightDisp = targetCol + w_d - item.col      // 向右推出所需位移
    return { id, w, leftDisp, rightDisp, preferDir: leftDisp <= rightDisp ? 'LEFT' : 'RIGHT' }
  })

  // 策略 1：各自就近
  const r1 = attemptPreferred(baseVg, blockers, targetCol, targetRow, w_d, h_d, draggedId)
  if (r1 !== null) return { moves: r1 }

  // 策略 2：全左
  const r2 = attemptAllDir(baseVg, blockers, 'LEFT', targetCol, targetRow, w_d, h_d, draggedId)
  if (r2 !== null) return { moves: r2 }

  // 策略 3：全右
  const r3 = attemptAllDir(baseVg, blockers, 'RIGHT', targetCol, targetRow, w_d, h_d, draggedId)
  if (r3 !== null) return { moves: r3 }

  // 最低优先级：1x1 允许向上下/斜向（另一行）挤出
  if (draggedSize === '1x1') {
    const v = trySmallVerticalDiagonal(baseVg, draggedId, blockerIds)
    if (v) return { moves: v }
  }

  // 最终兜底：只要 blocker 可在当前区域重排并腾出目标区域，即视为可挤出
  const anyLayout = attemptRelocateBlockersAnyLayout(baseVg, blockerIds, targetCol, targetRow, draggedSize)
  if (anyLayout) return { moves: anyLayout }

  return null
}

export function planUnifiedSqueeze(
  targetZone: SqueezeZoneView,
  targetCol: number,
  targetRow: number,
  draggedSize: ItemSizeNorm,
  draggedId: string,
  homeZone?: SqueezeZoneView,
  draggedOriginOverride?: { col: number; row: number; size: ItemSizeNorm },
): UnifiedSqueezePlan | null {
  const local = trySqueezePlace(
    targetZone.system,
    draggedId,
    targetCol,
    targetRow,
    draggedSize,
    draggedOriginOverride,
  )
  if (local) {
    let visible = true
    for (const move of local.moves) {
      const movedItem = targetZone.system.getItem(move.instanceId)
      if (!movedItem) {
        visible = false
        break
      }
      const { w, h } = VSIZE_MAP[movedItem.size]
      if (
        move.newCol < 0
        || move.newRow < 0
        || move.newCol + w > targetZone.activeColCount
        || move.newRow + h > 1
      ) {
        visible = false
        break
      }
    }
    if (visible) return { mode: 'local', moves: local.moves }
  }

  const targetVg = VirtualGrid.from(targetZone.system)
  const homeVg = homeZone ? VirtualGrid.from(homeZone.system) : null

  const blockerIds = new Set(collectTargetBlockerIds(targetVg, targetCol, targetRow, draggedSize))
  if (blockerIds.size === 0) return null

  // 优先：在目标区可见列内尝试重排 blocker（仍属于 local 挤出）
  const visibleLocal = attemptRelocateBlockersAnyLayout(
    targetVg,
    blockerIds,
    targetCol,
    targetRow,
    draggedSize,
    targetZone.activeColCount,
  )
  if (visibleLocal) return { mode: 'local', moves: visibleLocal }

  if (!homeZone || !homeVg) return null
  homeVg.remove(draggedId)

  const transfers: CrossZoneTransfer[] = []
  for (const id of blockerIds) {
    const blocker = targetVg.getItem(id)
    if (!blocker) continue
    targetVg.remove(id)
    const pos = findFirstVisiblePlace(homeVg, homeZone.activeColCount, blocker.size, draggedId)
    if (!pos) return null
    homeVg.place(pos.col, pos.row, blocker.size, blocker.defId, blocker.instanceId)
    transfers.push({ instanceId: blocker.instanceId, newCol: pos.col, newRow: pos.row })
  }

  if (!canPlaceInVisibleColsOnVirtual(targetVg, targetZone.activeColCount, targetCol, targetRow, draggedSize, draggedId)) {
    return null
  }
  return { mode: 'cross', transfers }
}

export function planCrossZoneSwap(
  targetZone: SqueezeZoneView,
  homeZone: SqueezeZoneView,
  targetCol: number,
  targetRow: number,
  draggedSize: ItemSizeNorm,
  draggedId: string,
  footprintCol: number,
  footprintRow: number,
  footprintSize: ItemSizeNorm = draggedSize,
): SwapFallbackPlan | null {
  const targetVg = VirtualGrid.from(targetZone.system)
  const homeVg = VirtualGrid.from(homeZone.system)
  targetVg.remove(draggedId)
  homeVg.remove(draggedId)

  const { w: fw, h: fh } = VSIZE_MAP[footprintSize]
  if (footprintCol < 0 || footprintRow < 0) return null
  if (footprintCol + fw > homeZone.activeColCount) return null
  if (footprintRow + fh > 1) return null

  const blockerIds = collectTargetBlockerIds(targetVg, targetCol, targetRow, draggedSize)
  if (blockerIds.length === 0) return null

  const blockers = blockerIds
    .map(id => targetVg.getItem(id))
    .filter((it): it is PlacedItem => !!it)
    .sort((a, b) => getCellArea(b.size) - getCellArea(a.size))

  for (const blocker of blockers) targetVg.remove(blocker.instanceId)

  if (!canPlaceInVisibleColsOnVirtual(targetVg, targetZone.activeColCount, targetCol, targetRow, draggedSize, draggedId)) {
    return null
  }

  const transfers: CrossZoneTransfer[] = []

  const dfs = (index: number): boolean => {
    if (index >= blockers.length) return true
    const blocker = blockers[index]!
    const candidates = enumerateFootprintPlacements(footprintCol, footprintRow, footprintSize, blocker.size)
    for (const pos of candidates) {
      if (!canPlaceInVisibleColsOnVirtual(homeVg, homeZone.activeColCount, pos.col, pos.row, blocker.size, draggedId)) continue
      if (!homeVg.place(pos.col, pos.row, blocker.size, blocker.defId, blocker.instanceId)) continue
      transfers.push({ instanceId: blocker.instanceId, newCol: pos.col, newRow: pos.row })
      if (dfs(index + 1)) return true
      transfers.pop()
      homeVg.remove(blocker.instanceId)
    }
    return false
  }

  if (!dfs(0)) return null
  return { transfers }
}
