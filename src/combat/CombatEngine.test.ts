import { describe, expect, it } from 'vitest'
import { CombatEngine } from '@/combat/CombatEngine'
import type { BattleSnapshotBundle } from '@/combat/BattleSnapshotStore'
import { getAllItems } from '@/core/DataLoader'

function makeSnapshot(): BattleSnapshotBundle {
  const items = getAllItems()
  const a = items[0]?.id ?? 'a'
  const b = items[1]?.id ?? a
  return {
    day: 3,
    activeColCount: 3,
    createdAtMs: 123,
    entities: [
      { instanceId: 'i-1', defId: a, tier: 'Bronze', size: '1x1', col: 0, row: 0 },
      { instanceId: 'i-2', defId: b, tier: 'Silver', size: '2x1', col: 1, row: 0 },
    ],
  }
}

describe('CombatEngine', () => {
  it('start 后进入 INIT 并可推进到 END', () => {
    const engine = new CombatEngine()
    engine.start(makeSnapshot())
    expect(engine.getPhase()).toBe('INIT')

    let guard = 0
    while (!engine.isFinished() && guard < 4000) {
      engine.update(1 / 60)
      guard += 1
    }

    expect(engine.isFinished()).toBe(true)
    expect(engine.getPhase()).toBe('END')
    expect(engine.getResult()).not.toBeNull()
  })

  it('debug state 能反映 tick 与存活数', () => {
    const engine = new CombatEngine()
    engine.start(makeSnapshot())
    for (let i = 0; i < 30; i++) engine.update(1 / 60)
    const state = engine.getDebugState()
    expect(state.tickIndex).toBeGreaterThanOrEqual(0)
    expect(state.playerAlive).toBeGreaterThanOrEqual(0)
    expect(state.enemyAlive).toBeGreaterThanOrEqual(0)
  })
})
