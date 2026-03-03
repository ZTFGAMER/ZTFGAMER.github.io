import { describe, it, expect } from 'vitest'
import { GridSystem } from './GridSystem'
import { BackpackLogic } from './BackpackLogic'

describe('BackpackLogic', () => {
  it('keeps preferred drop when slot is free', () => {
    const system = new GridSystem(6, 2)
    system.place(0, 0, '2x1', 'a', 'A')
    const logic = new BackpackLogic()

    const plan = logic.buildDropPlan(
      system,
      6,
      { instanceId: 'IN', defId: 'x', size: '1x1' },
      { col: 5, row: 1 },
    )

    expect(plan).not.toBeNull()
    expect(plan?.incoming).toEqual({ col: 5, row: 1 })
  })

  it('re-packs backpack to absorb incoming item', () => {
    const system = new GridSystem(6, 2)
    system.place(0, 0, '3x1', 'a', 'A')
    system.place(3, 0, '2x1', 'b', 'B')
    system.place(5, 0, '1x1', 'c', 'C')
    system.place(0, 1, '3x1', 'd', 'D')
    system.place(3, 1, '2x1', 'e', 'E')
    const logic = new BackpackLogic()

    const plan = logic.buildDropPlan(
      system,
      6,
      { instanceId: 'IN', defId: 'x', size: '1x1' },
      { col: 5, row: 1 },
    )

    expect(plan).not.toBeNull()
    expect(plan?.placements.some((p) => p.instanceId === 'IN')).toBe(true)
  })

  it('applies plan and returns moved entries', () => {
    const system = new GridSystem(6, 2)
    system.place(0, 0, '3x1', 'a', 'A')
    system.place(3, 0, '3x1', 'b', 'B')
    const logic = new BackpackLogic()
    const plan = logic.buildDropPlan(
      system,
      6,
      { instanceId: 'IN', defId: 'x', size: '1x1' },
      { col: 0, row: 0 },
    )
    expect(plan).not.toBeNull()

    const moved = logic.applyDropPlan(system, plan!)
    expect(system.getItem('IN')).toBeTruthy()
    expect(system.getAllItems()).toHaveLength(3)
    const placed = system.getItem('IN')!
    expect(placed.col).toBe(plan!.incoming.col)
    expect(placed.row).toBe(plan!.incoming.row)
    expect(Array.isArray(moved)).toBe(true)
  })
})
