import { planAutoPack, type PackItem, type PackPlacement } from './AutoPack'
import type { GridSystem, ItemSizeNorm } from './GridSystem'

export interface BackpackIncoming {
  instanceId: string
  defId: string
  size: ItemSizeNorm
}

export interface BackpackDropPlan {
  placements: PackPlacement[]
  incoming: { col: number; row: number }
}

export interface BackpackMoveResult {
  instanceId: string
  fromCol: number
  fromRow: number
  toCol: number
  toRow: number
}

export interface BackpackPlacementEntry {
  instanceId: string
  defId: string
  size: ItemSizeNorm
  col: number
  row: number
}

export class BackpackLogic {
  buildDropPlan(
    system: GridSystem,
    activeColCount: number,
    incoming: BackpackIncoming,
    preferred: { col: number; row: number },
  ): BackpackDropPlan | null {
    const items: PackItem[] = system.getAllItems()
      .filter((it) => it.instanceId !== incoming.instanceId)
      .map((it) => ({
        instanceId: it.instanceId,
        defId: it.defId,
        size: it.size,
        preferredCol: it.col,
        preferredRow: it.row,
      }))

    items.push({
      instanceId: incoming.instanceId,
      defId: incoming.defId,
      size: incoming.size,
      preferredCol: preferred.col,
      preferredRow: preferred.row,
    })

    const placements = planAutoPack(items, activeColCount, system.getActiveRows())
    if (!placements) return null
    const incomingPlacement = placements.find((p) => p.instanceId === incoming.instanceId)
    if (!incomingPlacement) return null
    return {
      placements,
      incoming: { col: incomingPlacement.col, row: incomingPlacement.row },
    }
  }

  applyDropPlan(system: GridSystem, plan: BackpackDropPlan): BackpackMoveResult[] {
    const before = new Map(
      system.getAllItems().map((it) => [it.instanceId, { col: it.col, row: it.row }] as const),
    )
    const oldItems = new Map(system.getAllItems().map((it) => [it.instanceId, it] as const))

    system.clear()
    for (const p of plan.placements) {
      const old = oldItems.get(p.instanceId)
      const size = old?.size ?? p.size
      const defId = old?.defId ?? p.defId
      system.place(p.col, p.row, size, defId, p.instanceId)
    }

    const moves: BackpackMoveResult[] = []
    for (const p of plan.placements) {
      const prev = before.get(p.instanceId)
      if (!prev) continue
      if (prev.col === p.col && prev.row === p.row) continue
      moves.push({
        instanceId: p.instanceId,
        fromCol: prev.col,
        fromRow: prev.row,
        toCol: p.col,
        toRow: p.row,
      })
    }
    return moves
  }

  buildTransferPlan(
    system: GridSystem,
    activeColCount: number,
    incomingItems: BackpackIncoming[],
    lockedIncomingRow?: number,
  ): PackPlacement[] | null {
    if (lockedIncomingRow == null) {
      const items: PackItem[] = system.getAllItems().map((it) => ({
        instanceId: it.instanceId,
        defId: it.defId,
        size: it.size,
        preferredCol: it.col,
        preferredRow: it.row,
      }))

      for (const incoming of incomingItems) {
        if (items.some((it) => it.instanceId === incoming.instanceId)) continue
        items.push({
          instanceId: incoming.instanceId,
          defId: incoming.defId,
          size: incoming.size,
        })
      }

      return planAutoPack(items, activeColCount, system.getActiveRows())
    }

    const SIZE: Record<ItemSizeNorm, { w: number; h: number }> = {
      '1x1': { w: 1, h: 1 },
      '2x1': { w: 2, h: 1 },
      '3x1': { w: 3, h: 1 },
    }

    const existing = system.getAllItems().map((it) => ({
      instanceId: it.instanceId,
      defId: it.defId,
      size: it.size,
      preferredCol: it.col,
      preferredRow: it.row,
      incoming: false,
    }))
    const incoming = incomingItems
      .filter((it) => !existing.some((e) => e.instanceId === it.instanceId))
      .map((it) => ({
        instanceId: it.instanceId,
        defId: it.defId,
        size: it.size,
        preferredCol: undefined as number | undefined,
        preferredRow: lockedIncomingRow,
        incoming: true,
      }))
    const all = [...existing, ...incoming]

    const order = [...all].sort((a, b) => {
      const aa = SIZE[a.size].w * SIZE[a.size].h
      const bb = SIZE[b.size].w * SIZE[b.size].h
      if (aa !== bb) return bb - aa
      if (a.incoming !== b.incoming) return a.incoming ? -1 : 1
      return a.instanceId.localeCompare(b.instanceId)
    })

    const occ = Array.from({ length: activeColCount }, () => Array<boolean>(system.getActiveRows()).fill(false))
    const placed = new Map<string, PackPlacement>()

    const canPlace = (col: number, row: number, size: ItemSizeNorm): boolean => {
      const dim = SIZE[size]
      if (col < 0 || row < 0 || col + dim.w > activeColCount || row + dim.h > system.getActiveRows()) return false
      for (let c = col; c < col + dim.w; c++) {
        for (let r = row; r < row + dim.h; r++) {
          if (occ[c][r]) return false
        }
      }
      return true
    }

    const fill = (col: number, row: number, size: ItemSizeNorm, value: boolean): void => {
      const dim = SIZE[size]
      for (let c = col; c < col + dim.w; c++) {
        for (let r = row; r < row + dim.h; r++) occ[c][r] = value
      }
    }

    const candidates = (it: typeof all[number]): Array<{ col: number; row: number }> => {
      const dim = SIZE[it.size]
      const maxCol = activeColCount - dim.w
      const maxRow = system.getActiveRows() - dim.h
      if (maxCol < 0 || maxRow < 0) return []
      const rows = it.incoming
        ? [lockedIncomingRow]
        : Array.from({ length: maxRow + 1 }, (_, i) => i)

      const out: Array<{ col: number; row: number }> = []
      if (it.preferredCol != null && it.preferredRow != null && rows.includes(it.preferredRow)) {
        out.push({ col: it.preferredCol, row: it.preferredRow })
      }
      for (const row of rows) {
        for (let col = 0; col <= maxCol; col++) {
          if (it.preferredCol === col && it.preferredRow === row) continue
          out.push({ col, row })
        }
      }
      return out
    }

    const dfs = (idx: number): boolean => {
      if (idx >= order.length) return true
      const it = order[idx]!
      for (const c of candidates(it)) {
        if (!canPlace(c.col, c.row, it.size)) continue
        fill(c.col, c.row, it.size, true)
        placed.set(it.instanceId, {
          instanceId: it.instanceId,
          defId: it.defId,
          size: it.size,
          col: c.col,
          row: c.row,
        })
        if (dfs(idx + 1)) return true
        placed.delete(it.instanceId)
        fill(c.col, c.row, it.size, false)
      }
      return false
    }

    if (!dfs(0)) return null
    return all.map((it) => placed.get(it.instanceId)!)
  }

  applyPlacementPlan(system: GridSystem, placements: BackpackPlacementEntry[]): BackpackMoveResult[] {
    const before = new Map(
      system.getAllItems().map((it) => [it.instanceId, { col: it.col, row: it.row }] as const),
    )
    const oldItems = new Map(system.getAllItems().map((it) => [it.instanceId, it] as const))

    system.clear()
    for (const p of placements) {
      const old = oldItems.get(p.instanceId)
      const size = old?.size ?? p.size
      const defId = old?.defId ?? p.defId
      system.place(p.col, p.row, size, defId, p.instanceId)
    }

    const moves: BackpackMoveResult[] = []
    for (const p of placements) {
      const prev = before.get(p.instanceId)
      if (!prev) continue
      if (prev.col === p.col && prev.row === p.row) continue
      moves.push({
        instanceId: p.instanceId,
        fromCol: prev.col,
        fromRow: prev.row,
        toCol: p.col,
        toRow: p.row,
      })
    }
    return moves
  }
}
