import type { ItemSizeNorm } from './GridSystem'

export interface PackItem {
  instanceId: string
  defId: string
  size: ItemSizeNorm
  preferredCol?: number
  preferredRow?: number
}

export interface PackPlacement {
  instanceId: string
  defId: string
  size: ItemSizeNorm
  col: number
  row: number
}

const SIZE_DIM: Record<ItemSizeNorm, { w: number; h: number }> = {
  '1x1': { w: 1, h: 1 },
  '2x1': { w: 2, h: 1 },
  '3x1': { w: 3, h: 1 },
}

function canPlace(
  occ: boolean[][],
  cols: number,
  rows: number,
  col: number,
  row: number,
  size: ItemSizeNorm,
): boolean {
  const { w, h } = SIZE_DIM[size]
  if (col < 0 || row < 0 || col + w > cols || row + h > rows) return false
  for (let c = col; c < col + w; c++)
    for (let r = row; r < row + h; r++)
      if (occ[c][r]) return false
  return true
}

function fillOcc(
  occ: boolean[][],
  col: number,
  row: number,
  size: ItemSizeNorm,
  value: boolean,
): void {
  const { w, h } = SIZE_DIM[size]
  for (let c = col; c < col + w; c++)
    for (let r = row; r < row + h; r++)
      occ[c][r] = value
}

function itemOrderScore(item: PackItem): number {
  const { w, h } = SIZE_DIM[item.size]
  const area = w * h
  return area * 10 + h
}

export function planAutoPack(items: PackItem[], cols: number, rows = 1): PackPlacement[] | null {
  const normalized = items.map(i => ({ ...i }))
  const sorted = [...normalized].sort((a, b) => {
    const sa = itemOrderScore(a)
    const sb = itemOrderScore(b)
    if (sa !== sb) return sb - sa
    return a.instanceId.localeCompare(b.instanceId)
  })

  const occ = Array.from({ length: cols }, () => Array<boolean>(rows).fill(false))
  const placed = new Map<string, PackPlacement>()

  const candidatesFor = (item: PackItem): Array<{ col: number; row: number }> => {
    const { w, h } = SIZE_DIM[item.size]
    const maxCol = cols - w
    const maxRow = rows - h
    if (maxCol < 0 || maxRow < 0) return []

    const result: Array<{ col: number; row: number }> = []
    if (item.preferredCol != null && item.preferredRow != null) {
      result.push({ col: item.preferredCol, row: item.preferredRow })
    }
    for (let r = 0; r <= maxRow; r++) {
      for (let c = 0; c <= maxCol; c++) {
        if (item.preferredCol === c && item.preferredRow === r) continue
        result.push({ col: c, row: r })
      }
    }
    return result
  }

  const dfs = (idx: number): boolean => {
    if (idx >= sorted.length) return true
    const item = sorted[idx]
    for (const cand of candidatesFor(item)) {
      if (!canPlace(occ, cols, rows, cand.col, cand.row, item.size)) continue
      fillOcc(occ, cand.col, cand.row, item.size, true)
      placed.set(item.instanceId, {
        instanceId: item.instanceId,
        defId: item.defId,
        size: item.size,
        col: cand.col,
        row: cand.row,
      })
      if (dfs(idx + 1)) return true
      placed.delete(item.instanceId)
      fillOcc(occ, cand.col, cand.row, item.size, false)
    }
    return false
  }

  if (!dfs(0)) return null
  return normalized.map(item => placed.get(item.instanceId)!)
}
