// ============================================================
// GridSystem — 5×2 网格纯逻辑层
// 无 PixiJS 依赖，可独立 Vitest 测试
// ============================================================

export type ItemSizeNorm = '1x1' | '1x2' | '2x2'

interface SizeDim { w: number; h: number }

const SIZE_MAP: Record<ItemSizeNorm, SizeDim> = {
  '1x1': { w: 1, h: 1 },
  '1x2': { w: 1, h: 2 },
  '2x2': { w: 2, h: 2 },
}

export interface PlacedItem {
  instanceId: string
  defId:      string
  size:       ItemSizeNorm
  col:        number   // 左上角列
  row:        number   // 左上角行
}

export class GridSystem {
  readonly cols: number
  readonly rows: number = 2

  // grid[col][row] = instanceId | null
  private grid: (string | null)[][]
  private items = new Map<string, PlacedItem>()

  constructor(cols: number = 5) {
    this.cols = cols
    this.grid = Array.from({ length: cols }, () => Array<string | null>(2).fill(null))
  }

  // ---- 放置检测 ----

  canPlace(col: number, row: number, size: ItemSizeNorm): boolean {
    const { w, h } = SIZE_MAP[size]
    if (col < 0 || row < 0 || col + w > this.cols || row + h > this.rows) return false
    for (let c = col; c < col + w; c++)
      for (let r = row; r < row + h; r++)
        if (this.grid[c][r] !== null) return false
    return true
  }

  /** 同 canPlace，但忽略指定物品自身占据的格子（拖拽中校验用） */
  canPlaceExcluding(col: number, row: number, size: ItemSizeNorm, excludeId: string): boolean {
    const { w, h } = SIZE_MAP[size]
    if (col < 0 || row < 0 || col + w > this.cols || row + h > this.rows) return false
    for (let c = col; c < col + w; c++)
      for (let r = row; r < row + h; r++) {
        const cell = this.grid[c][r]
        if (cell !== null && cell !== excludeId) return false
      }
    return true
  }

  // ---- 放置 / 移除 ----

  place(col: number, row: number, size: ItemSizeNorm, defId: string, instanceId: string): boolean {
    if (!this.canPlace(col, row, size)) return false
    const { w, h } = SIZE_MAP[size]
    for (let c = col; c < col + w; c++)
      for (let r = row; r < row + h; r++)
        this.grid[c][r] = instanceId
    this.items.set(instanceId, { instanceId, defId, size, col, row })
    return true
  }

  remove(instanceId: string): boolean {
    const item = this.items.get(instanceId)
    if (!item) return false
    const { w, h } = SIZE_MAP[item.size]
    for (let c = item.col; c < item.col + w; c++)
      for (let r = item.row; r < item.row + h; r++)
        this.grid[c][r] = null
    this.items.delete(instanceId)
    return true
  }

  // ---- 查询 ----

  getItem(instanceId: string): PlacedItem | undefined {
    return this.items.get(instanceId)
  }

  getAllItems(): PlacedItem[] {
    return Array.from(this.items.values())
  }

  /**
   * 获取左右相邻物品 ID（col±1 方向）。
   * 1x2 / 2x2 跨行，两行都参与计算，结果去重。
   */
  getAdjacentItems(instanceId: string): string[] {
    const item = this.items.get(instanceId)
    if (!item) return []
    const { w, h } = SIZE_MAP[item.size]
    const result = new Set<string>()

    // 左侧整列
    const leftCol = item.col - 1
    if (leftCol >= 0)
      for (let r = item.row; r < item.row + h; r++) {
        const n = this.grid[leftCol][r]
        if (n && n !== instanceId) result.add(n)
      }

    // 右侧整列
    const rightCol = item.col + w
    if (rightCol < this.cols)
      for (let r = item.row; r < item.row + h; r++) {
        const n = this.grid[rightCol][r]
        if (n && n !== instanceId) result.add(n)
      }

    return Array.from(result)
  }

  getSizeDim(size: ItemSizeNorm): SizeDim {
    return SIZE_MAP[size]
  }

  clear(): void {
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++)
        this.grid[c][r] = null
    this.items.clear()
  }

  /** 返回内部 grid + items 的深拷贝，供 VirtualGrid 构造使用 */
  snapshot(): { grid: (string | null)[][]; items: Map<string, PlacedItem> } {
    return {
      grid:  this.grid.map(col => [...col]),
      items: new Map(Array.from(this.items.entries()).map(([k, v]) => [k, { ...v }])),
    }
  }
}
