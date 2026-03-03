import { describe, it, expect } from 'vitest'
import { GridSystem, type ItemSizeNorm } from './GridSystem'
import { trySqueezePlace, planUnifiedSqueeze, planCrossZoneSwap } from './SqueezeLogic'

function setup(items: Array<[string, string, ItemSizeNorm, number, number]>, rows = 1): GridSystem {
  const g = new GridSystem(6, rows)
  for (const [id, defId, size, col, row] of items) {
    g.place(col, row, size, defId, id)
  }
  return g
}

describe('SqueezeLogic (1D)', () => {
  it('returns empty moves when target is free', () => {
    const g = setup([['DRAG', 'd', '1x1', 0, 0]])
    const plan = trySqueezePlace(g, 'DRAG', 2, 0, '1x1')
    expect(plan).not.toBeNull()
    expect(plan?.moves).toEqual([])
  })

  it('rearranges blockers when overlap exists', () => {
    const g = setup([['DRAG', 'd', '1x1', 0, 0], ['B', 'd', '1x1', 2, 0]])
    const plan = trySqueezePlace(g, 'DRAG', 2, 0, '1x1')
    expect(plan).not.toBeNull()
    expect(plan!.moves.some((m) => m.instanceId === 'B')).toBe(true)
  })

  it('planUnifiedSqueeze keeps local mode when visible move exists', () => {
    const target = setup([['DRAG', 'd', '1x1', 0, 0], ['B', 'd', '1x1', 2, 0]])
    const plan = planUnifiedSqueeze(
      { system: target, activeColCount: 4 },
      2,
      0,
      '1x1',
      'DRAG',
    )
    expect(plan).not.toBeNull()
    expect(plan?.mode).toBe('local')
  })

  it('planUnifiedSqueeze falls back to cross transfer', () => {
    const target = setup([['S0', 'd', '1x1', 0, 0], ['B', 'd', '1x1', 1, 0]])
    const home = setup([])
    const plan = planUnifiedSqueeze(
      { system: target, activeColCount: 2 },
      1,
      0,
      '1x1',
      'DRAG',
      { system: home, activeColCount: 6 },
    )
    expect(plan).not.toBeNull()
    expect(plan?.mode).toBe('cross')
  })

  it('planCrossZoneSwap can map blockers to drag footprint', () => {
    const home = setup([['DRAG', 'd', '2x1', 0, 0]])
    const target = setup([['B1', 'd', '1x1', 2, 0], ['B2', 'd', '1x1', 3, 0]])
    const plan = planCrossZoneSwap(
      { system: target, activeColCount: 6 },
      { system: home, activeColCount: 6 },
      2,
      0,
      '2x1',
      'DRAG',
      0,
      0,
      '2x1',
    )
    expect(plan).not.toBeNull()
    expect(plan?.transfers).toHaveLength(2)
  })

  it('prefers filling dragged origin footprint when moving medium right', () => {
    const g = setup([
      ['DRAG', 'd', '2x1', 0, 0],
      ['B1', 'd', '1x1', 2, 0],
      ['B2', 'd', '1x1', 3, 0],
      ['R', 'd', '1x1', 4, 0],
    ])
    const plan = trySqueezePlace(g, 'DRAG', 2, 0, '2x1')
    expect(plan).not.toBeNull()
    expect(plan!.moves).toContainEqual({ instanceId: 'B1', newCol: 0, newRow: 0 })
    expect(plan!.moves).toContainEqual({ instanceId: 'B2', newCol: 1, newRow: 0 })
  })

  it('supports squeezing on backpack lower row', () => {
    const g = setup([
      ['DRAG', 'd', '1x1', 0, 1],
      ['B', 'd', '1x1', 2, 1],
    ], 2)
    const plan = trySqueezePlace(g, 'DRAG', 2, 1, '1x1')
    expect(plan).not.toBeNull()
    expect(plan!.moves.some((m) => m.instanceId === 'B')).toBe(true)
  })

  it('supports cross swap when dropping to backpack lower row', () => {
    const home = setup([['DRAG', 'd', '2x1', 2, 0]], 1)
    const target = setup([['B1', 'd', '1x1', 2, 1], ['B2', 'd', '1x1', 3, 1]], 2)
    const plan = planCrossZoneSwap(
      { system: target, activeColCount: 6 },
      { system: home, activeColCount: 4 },
      2,
      1,
      '2x1',
      'DRAG',
      2,
      0,
      '2x1',
    )
    expect(plan).not.toBeNull()
    expect(plan?.transfers).toHaveLength(2)
  })
})
