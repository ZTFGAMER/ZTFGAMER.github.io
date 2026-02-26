// ============================================================
// VirtualGrid — 用于挤出算法的试验性网格（不修改真实 GridSystem）
// ============================================================

import type { GridSystem, ItemSizeNorm, PlacedItem } from './GridSystem'

export const VSIZE_MAP: Record<ItemSizeNorm, { w: number; h: number }> = {
  '1x1': { w: 1, h: 1 },
  '1x2': { w: 1, h: 2 },
  '2x2': { w: 2, h: 2 },
}

export interface Move {
  instanceId: string
  newCol:     number
  newRow:     number
}

export interface SqueezePlan {
  moves: Move[]   // 空数组 = 无需挤出，直接放置
}

// ============================================================
export class VirtualGrid {
  readonly cols = 5
  // grid[col][row] = instanceId | null
  grid: (string | null)[][]
  items: Map<string, PlacedItem>

  private constructor(
    grid:  (string | null)[][],
    items: Map<string, PlacedItem>,
  ) {
    this.grid  = grid
    this.items = items
  }

  static from(system: GridSystem): VirtualGrid {
    const { grid, items } = system.snapshot()
    return new VirtualGrid(grid, items)
  }

  clone(): VirtualGrid {
    return new VirtualGrid(
      this.grid.map(col => [...col]),
      new Map(Array.from(this.items.entries()).map(([k, v]) => [k, { ...v }])),
    )
  }

  getItem(instanceId: string): PlacedItem | undefined {
    return this.items.get(instanceId)
  }

  remove(instanceId: string): boolean {
    const item = this.items.get(instanceId)
    if (!item) return false
    const { w, h } = VSIZE_MAP[item.size]
    for (let c = item.col; c < item.col + w; c++)
      for (let r = item.row; r < item.row + h; r++)
        if (this.grid[c][r] === instanceId) this.grid[c][r] = null
    this.items.delete(instanceId)
    return true
  }

  /** 放置物品（不做冲突检测，由调用方保证目标格已清空） */
  place(col: number, row: number, size: ItemSizeNorm, defId: string, instanceId: string): boolean {
    const { w, h } = VSIZE_MAP[size]
    if (col < 0 || col + w > this.cols || row < 0 || row + h > 2) return false
    for (let c = col; c < col + w; c++)
      for (let r = row; r < row + h; r++)
        this.grid[c][r] = instanceId
    this.items.set(instanceId, { instanceId, defId, size, col, row })
    return true
  }

  /** 检测 col/row 处能否放置 size，排除 excludeId 自身 */
  canPlaceExcluding(col: number, row: number, size: ItemSizeNorm, excludeId: string): boolean {
    const { w, h } = VSIZE_MAP[size]
    if (col < 0 || col + w > this.cols || row < 0 || row + h > 2) return false
    for (let c = col; c < col + w; c++)
      for (let r = row; r < row + h; r++) {
        const cell = this.grid[c][r]
        if (cell !== null && cell !== excludeId) return false
      }
    return true
  }
}
