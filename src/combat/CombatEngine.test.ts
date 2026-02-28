import { describe, expect, it } from 'vitest'
import { CombatEngine, setCombatRuntimeOverride } from '@/combat/CombatEngine'
import type { BattleSnapshotBundle } from '@/combat/BattleSnapshotStore'
import { getAllItems } from '@/core/DataLoader'
import { EventBus } from '@/core/EventBus'

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

  it('runtime state 返回充能与控制状态', () => {
    const engine = new CombatEngine()
    engine.start(makeSnapshot())
    for (let i = 0; i < 60; i++) engine.update(1 / 60)
    const runtime = engine.getRuntimeState()
    expect(runtime.length).toBeGreaterThan(0)
    expect(runtime[0]?.chargePercent).toBeGreaterThanOrEqual(0)
    expect(runtime[0]?.chargePercent).toBeLessThanOrEqual(1)
  })

  it('控制效果事件携带 item 目标类型', () => {
    const freezeItem = getAllItems().find((it) =>
      it.skills.some((s) => /冻结|freeze/i.test(s.cn) || /冻结|freeze/i.test(s.en)),
    )
    expect(freezeItem).toBeTruthy()

    const snapshot: BattleSnapshotBundle = {
      day: 3,
      activeColCount: 3,
      createdAtMs: 123,
      entities: [
        { instanceId: 'freeze-1', defId: freezeItem!.id, tier: 'Gold', size: '2x1', col: 0, row: 0 },
      ],
    }

    const events: Array<{ targetType?: 'hero' | 'item'; status: string }> = []
    const off = EventBus.on('battle:status_apply', (e) => {
      if (e.status === 'freeze' || e.status === 'slow' || e.status === 'haste') {
        events.push({ targetType: e.targetType, status: e.status })
      }
    })

    const engine = new CombatEngine()
    engine.start(snapshot)
    for (let i = 0; i < 800; i++) {
      engine.update(1 / 60)
      if (events.length > 0) break
    }
    off()

    expect(events.length).toBeGreaterThan(0)
    expect(events[0]?.targetType).toBe('item')
  })

  it('控制效果会在持续时间结束后发出 remove 事件', () => {
    const freezeItem = getAllItems().find((it) =>
      it.skills.some((s) => /冻结|freeze/i.test(s.cn) || /冻结|freeze/i.test(s.en)),
    )
    expect(freezeItem).toBeTruthy()

    const snapshot: BattleSnapshotBundle = {
      day: 3,
      activeColCount: 3,
      createdAtMs: 123,
      entities: [
        { instanceId: 'freeze-2', defId: freezeItem!.id, tier: 'Gold', size: '2x1', col: 0, row: 0 },
      ],
    }

    let applied = false
    let removed = false
    const offApply = EventBus.on('battle:status_apply', (e) => {
      if (e.targetType === 'item' && e.status === 'freeze') applied = true
    })
    const offRemove = EventBus.on('battle:status_remove', (e) => {
      if (e.targetType === 'item' && e.status === 'freeze') removed = true
    })

    const engine = new CombatEngine()
    engine.start(snapshot)
    for (let i = 0; i < 2000; i++) {
      engine.update(1 / 60)
      if (applied && removed) break
    }
    offApply()
    offRemove()

    expect(applied).toBe(true)
    expect(removed).toBe(true)
  })

  it('剧毒状态会在后续 tick 触发持续伤害', () => {
    const poisonItem = getAllItems().find((it) =>
      it.skills.some((s) => /剧毒|中毒|poison/i.test(s.cn) || /poison/i.test(s.en)),
    )
    expect(poisonItem).toBeTruthy()

    const snapshot: BattleSnapshotBundle = {
      day: 3,
      activeColCount: 3,
      createdAtMs: 123,
      entities: [
        { instanceId: 'poison-1', defId: poisonItem!.id, tier: 'Gold', size: '2x1', col: 0, row: 0 },
      ],
    }

    const sequence: string[] = []
    const offApply = EventBus.on('battle:status_apply', (e) => {
      if (e.status === 'poison') sequence.push('apply')
    })
    const offDmg = EventBus.on('battle:take_damage', (e) => {
      if (e.sourceItemId === 'status_poison') sequence.push('tick')
    })

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 1200; i++) {
      engine.update(1 / 60)
      if (sequence.includes('apply') && sequence.includes('tick')) break
    }
    offApply()
    offDmg()

    expect(sequence.includes('apply')).toBe(true)
    expect(sequence.includes('tick')).toBe(true)
    expect(sequence.indexOf('apply')).toBeLessThan(sequence.indexOf('tick'))
  })

  it('同 tick 下状态伤害先于直伤结算', () => {
    const poisonItem = getAllItems().find((it) => it.poison > 0)
    const damageItem = getAllItems().find((it) => it.damage > 0 && it.cooldown === (poisonItem?.cooldown ?? -1))
    expect(poisonItem).toBeTruthy()
    expect(damageItem).toBeTruthy()

    setCombatRuntimeOverride({ poisonTickMs: 100 })

    const snapshot: BattleSnapshotBundle = {
      day: 3,
      activeColCount: 3,
      createdAtMs: 123,
      entities: [
        { instanceId: 'mix-poison', defId: poisonItem!.id, tier: 'Gold', size: '2x1', col: 0, row: 0 },
        { instanceId: 'mix-damage', defId: damageItem!.id, tier: 'Gold', size: '1x1', col: 2, row: 0 },
      ],
    }

    const order: string[] = []
    const offDmg = EventBus.on('battle:take_damage', (e) => {
      if (e.sourceItemId === 'status_poison') order.push('dot')
      else if (e.sourceItemId.startsWith('P-')) order.push('hit')
    })

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 1200; i++) {
      engine.update(1 / 60)
      if (order.includes('dot') && order.includes('hit')) break
    }
    offDmg()
    setCombatRuntimeOverride({})

    expect(order.includes('dot')).toBe(true)
    expect(order.includes('hit')).toBe(true)
    expect(order.indexOf('dot')).toBeLessThan(order.indexOf('hit'))
  })

  it('直伤事件携带 baseDamage 与 finalDamage', () => {
    const damageItem = getAllItems().find((it) => it.damage > 0 && it.cooldown > 0)
    expect(damageItem).toBeTruthy()

    const snapshot: BattleSnapshotBundle = {
      day: 3,
      activeColCount: 3,
      createdAtMs: 123,
      entities: [
        { instanceId: 'hit-1', defId: damageItem!.id, tier: 'Gold', size: '1x1', col: 0, row: 0 },
      ],
    }

    let hitSeen = false
    let baseDamage = -1
    let finalDamage = -1
    const off = EventBus.on('battle:take_damage', (e) => {
      if (e.type === 'normal' && e.sourceItemId.startsWith('P-')) {
        hitSeen = true
        baseDamage = e.baseDamage ?? -1
        finalDamage = e.finalDamage ?? -1
      }
    })

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 1200; i++) {
      engine.update(1 / 60)
      if (hitSeen) break
    }
    off()

    expect(hitSeen).toBe(true)
    expect(baseDamage).toBeGreaterThanOrEqual(0)
    expect(finalDamage).toBeGreaterThanOrEqual(0)
  })

  it('进入超时扣血后物品CD仍持续并继续触发', () => {
    const damageItem = getAllItems().find((it) => it.damage > 0 && it.cooldown > 0)
    expect(damageItem).toBeTruthy()

    setCombatRuntimeOverride({
      fatigueStartMs: 200,
      fatigueIntervalMs: 100,
      fatigueDamagePctPerInterval: 0,
      fatigueDamageFixedPerInterval: 1,
      fatigueDamagePctRampPerInterval: 0,
      fatigueDamageFixedRampPerInterval: 0,
    })

    const snapshot: BattleSnapshotBundle = {
      day: 3,
      activeColCount: 3,
      createdAtMs: 123,
      entities: [
        { instanceId: 'fatigue-fire-1', defId: damageItem!.id, tier: 'Gold', size: '1x1', col: 0, row: 0 },
      ],
    }

    let fatigueStarted = false
    let fireAfterFatigue = 0
    const offStart = EventBus.on('battle:fatigue_start', () => {
      fatigueStarted = true
    })
    const offFire = EventBus.on('battle:item_fire', () => {
      if (fatigueStarted) fireAfterFatigue += 1
    })

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 2400; i++) {
      engine.update(1 / 60)
      if (fatigueStarted && fireAfterFatigue > 0) break
    }
    offStart()
    offFire()
    setCombatRuntimeOverride({})

    expect(fatigueStarted).toBe(true)
    expect(fireAfterFatigue).toBeGreaterThan(0)
  })
})
