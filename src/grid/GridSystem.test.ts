import { describe, it, expect, beforeEach } from 'vitest'
import { GridSystem } from './GridSystem'

describe('GridSystem (1x6 single row)', () => {
  let g: GridSystem

  beforeEach(() => {
    g = new GridSystem(6)
  })

  it('places 1x1/2x1/3x1 within bounds', () => {
    expect(g.canPlace(0, 0, '1x1')).toBe(true)
    expect(g.canPlace(4, 0, '2x1')).toBe(true)
    expect(g.canPlace(3, 0, '3x1')).toBe(true)
    expect(g.canPlace(4, 0, '3x1')).toBe(false)
  })

  it('row 1 is always invalid', () => {
    expect(g.canPlace(0, 1, '1x1')).toBe(false)
    expect(g.canPlace(0, 1, '2x1')).toBe(false)
  })

  it('place/remove updates occupancy', () => {
    expect(g.place(1, 0, '2x1', 'd', 'A')).toBe(true)
    expect(g.canPlace(1, 0, '1x1')).toBe(false)
    expect(g.remove('A')).toBe(true)
    expect(g.canPlace(1, 0, '2x1')).toBe(true)
  })

  it('canPlaceExcluding ignores self', () => {
    g.place(2, 0, '2x1', 'd', 'A')
    expect(g.canPlaceExcluding(2, 0, '2x1', 'A')).toBe(true)
    expect(g.canPlaceExcluding(2, 0, '2x1', 'B')).toBe(false)
  })

  it('adjacent items are left/right only', () => {
    g.place(0, 0, '1x1', 'd', 'L')
    g.place(1, 0, '2x1', 'd', 'M')
    g.place(3, 0, '1x1', 'd', 'R')
    expect(new Set(g.getAdjacentItems('M'))).toEqual(new Set(['L', 'R']))
  })

  it('combat snapshot filters by active cols', () => {
    g.place(0, 0, '1x1', 'd', 'A')
    g.place(3, 0, '3x1', 'd', 'B')
    const snap4 = g.exportCombatSnapshot(4)
    expect(snap4.entities.map((e) => e.instanceId)).toEqual(['A'])
    const snap6 = g.exportCombatSnapshot(6)
    expect(new Set(snap6.entities.map((e) => e.instanceId))).toEqual(new Set(['A', 'B']))
  })
})
