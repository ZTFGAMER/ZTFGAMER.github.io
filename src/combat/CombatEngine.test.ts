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
    if (!freezeItem) return

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
    if (!freezeItem) return

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
    if (!poisonItem) return

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
    if (!poisonItem || !damageItem) return

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

  it('战斗开始时可对灼烧物品施加本场战斗增益', () => {
    const burnAuraItem = getAllItems().find((it) =>
      it.skills.some((s) => /灼烧物品\+\d+(?:\/\d+)*灼烧/.test(s.cn)),
    )
    const burnItem = getAllItems().find((it) =>
      it.burn > 0 && it.cooldown > 0 && it.skills.length === 1,
    )
    if (!burnAuraItem || !burnItem) return

    const snapshot: BattleSnapshotBundle = {
      day: 3,
      activeColCount: 4,
      createdAtMs: 123,
      entities: [
        { instanceId: 'burn-aura', defId: burnAuraItem!.id, tier: 'Gold', size: '2x1', col: 0, row: 0 },
        { instanceId: 'burn-src', defId: burnItem!.id, tier: 'Gold', size: '1x1', col: 2, row: 0 },
      ],
    }

    let burnApplied = -1
    const off = EventBus.on('battle:status_apply', (e) => {
      if (e.status === 'burn' && e.sourceItemId.includes('burn-src')) {
        burnApplied = e.amount
      }
    })

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 1200; i++) {
      engine.update(1 / 60)
      if (burnApplied >= 0) break
    }
    off()

    expect(burnApplied).toBeGreaterThanOrEqual((burnItem?.burn ?? 0) + 8)
  })

  it('战斗开始时仅相邻剧毒物品获得本场战斗增益', () => {
    const poisonAdjAuraItem = getAllItems().find((it) =>
      it.skills.some((s) => /相邻剧毒物品\+\d+(?:\/\d+)*剧毒/.test(s.cn)),
    )
    const poisonItem = getAllItems().find((it) =>
      it.skills.some((s) => /造成\d+(?:\/\d+)*剧毒/.test(s.cn)) && it.skills.length === 1,
    )
    if (!poisonAdjAuraItem || !poisonItem) return

    const snapshot: BattleSnapshotBundle = {
      day: 3,
      activeColCount: 6,
      createdAtMs: 123,
      entities: [
        { instanceId: 'poison-left', defId: poisonItem!.id, tier: 'Gold', size: '1x1', col: 0, row: 0 },
        { instanceId: 'poison-aura', defId: poisonAdjAuraItem!.id, tier: 'Gold', size: '1x1', col: 1, row: 0 },
        { instanceId: 'poison-right', defId: poisonItem!.id, tier: 'Gold', size: '1x1', col: 5, row: 0 },
      ],
    }

    const amountBySource = new Map<string, number>()
    const off = EventBus.on('battle:status_apply', (e) => {
      if (e.status !== 'poison' || !e.sourceItemId.startsWith('P-')) return
      if (e.sourceItemId.includes('poison-left')) amountBySource.set('left', e.amount)
      if (e.sourceItemId.includes('poison-right')) amountBySource.set('right', e.amount)
    })

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 1400; i++) {
      engine.update(1 / 60)
      if (amountBySource.has('left') && amountBySource.has('right')) break
    }
    off()

    expect(amountBySource.has('left')).toBe(true)
    expect(amountBySource.has('right')).toBe(true)
    expect((amountBySource.get('left') ?? 0)).toBeGreaterThan((amountBySource.get('right') ?? 0))
  })

  it('使用灼烧物品时可触发减速敌方物品', () => {
    const burnUseSlowItem = getAllItems().find((it) =>
      it.skills.some((s) => /使用灼烧物品时.*减速敌方\d+件敌方物品/.test(s.cn)),
    )
    const burnItem = getAllItems().find((it) =>
      it.burn > 0 && it.cooldown > 0,
    )
    if (!burnUseSlowItem || !burnItem) return

    const snapshot: BattleSnapshotBundle = {
      day: 6,
      activeColCount: 6,
      createdAtMs: 123,
      entities: [
        { instanceId: 'burn-slow-owner', defId: burnUseSlowItem!.id, tier: 'Gold', size: '1x1', col: 0, row: 0 },
        { instanceId: 'burn-slow-src', defId: burnItem!.id, tier: 'Gold', size: '1x1', col: 1, row: 0 },
      ],
    }

    let seenSlow = false
    const off = EventBus.on('battle:status_apply', (e) => {
      if (e.status === 'slow' && e.targetType === 'item' && e.sourceItemId.includes('burn-slow-owner')) {
        seenSlow = true
      }
    })

    const engine = new CombatEngine()
    engine.start(snapshot)
    for (let i = 0; i < 2000; i++) {
      engine.update(1 / 60)
      if (seenSlow) break
    }
    off()

    expect(seenSlow).toBe(true)
  })

  it('快照中的永久伤害加成会进入直伤基值', () => {
    const damageItem = getAllItems().find((it) => it.damage > 0 && it.cooldown > 0)
    expect(damageItem).toBeTruthy()

    const bonus = 37
    const snapshot: BattleSnapshotBundle = {
      day: 3,
      activeColCount: 3,
      createdAtMs: 123,
      entities: [
        {
          instanceId: 'perm-dmg-1',
          defId: damageItem!.id,
          tier: 'Gold',
          size: '1x1',
          col: 0,
          row: 0,
          permanentDamageBonus: bonus,
        },
      ],
    }

    let baseDamage = -1
    const off = EventBus.on('battle:take_damage', (e) => {
      if (e.type === 'normal' && e.sourceItemId.startsWith('P-')) {
        baseDamage = e.baseDamage ?? -1
      }
    })

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 1200; i++) {
      engine.update(1 / 60)
      if (baseDamage >= 0) break
    }
    off()

    expect(baseDamage).toBeGreaterThanOrEqual((damageItem?.damage ?? 0) + bonus)
  })

  it('同品质星级会影响物品基础伤害（短剑青铜2星=20）', () => {
    const shortSword = getAllItems().find((it) => it.name_cn === '短剑')
    expect(shortSword).toBeTruthy()

    const snapshot: BattleSnapshotBundle = {
      day: 1,
      activeColCount: 3,
      createdAtMs: 123,
      entities: [
        {
          instanceId: 'bronze2-sword',
          defId: shortSword!.id,
          tier: 'Bronze',
          tierStar: 2,
          size: '1x1',
          col: 0,
          row: 0,
        },
      ],
    }

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    const runtime = engine.getRuntimeState()
    const sword = runtime.find((it) => it.id.includes('bronze2-sword'))
    expect(sword).toBeTruthy()
    expect(sword?.damage).toBe(20)
  })

  it('手弩会一次打出全部弹药（青铜2星应为2发）', () => {
    const handCrossbow = getAllItems().find((it) => it.name_cn === '手弩')
    expect(handCrossbow).toBeTruthy()

    const snapshot: BattleSnapshotBundle = {
      day: 3,
      activeColCount: 3,
      createdAtMs: 123,
      entities: [
        { instanceId: 'hand-xbow', defId: handCrossbow!.id, tier: 'Silver', tierStar: 2, size: '1x1', col: 0, row: 0 },
      ],
    }

    let hitCount = 0
    const off = EventBus.on('battle:take_damage', (e) => {
      if (e.sourceItemId.includes('hand-xbow')) hitCount += 1
    })

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 1200; i++) {
      engine.update(1 / 60)
      if (hitCount >= 2) break
    }
    off()

    expect(hitCount).toBe(2)
  })

  it('圆盾会在开场给相邻武器增加伤害', () => {
    const sword = getAllItems().find((it) => it.name_cn === '短剑')
    const shield = getAllItems().find((it) => it.name_cn === '圆盾')
    expect(sword).toBeTruthy()
    expect(shield).toBeTruthy()

    const snapshot: BattleSnapshotBundle = {
      day: 1,
      activeColCount: 4,
      createdAtMs: 123,
      entities: [
        { instanceId: 'short-sword', defId: sword!.id, tier: 'Bronze', tierStar: 1, size: '1x1', col: 0, row: 0 },
        { instanceId: 'round-shield', defId: shield!.id, tier: 'Bronze', tierStar: 1, size: '2x1', col: 1, row: 0 },
      ],
    }

    let baseDamage = -1
    const off = EventBus.on('battle:take_damage', (e) => {
      if (e.sourceItemId.includes('short-sword') && e.type === 'normal') {
        baseDamage = e.baseDamage ?? -1
      }
    })
    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 1200; i++) {
      engine.update(1 / 60)
      if (baseDamage >= 0) break
    }
    off()

    expect(baseDamage).toBeGreaterThanOrEqual(20)
  })

  it('超级手雷每次使用后伤害翻倍', () => {
    const grenade = getAllItems().find((it) => it.name_cn === '超级手雷')
    expect(grenade).toBeTruthy()

    const snapshot: BattleSnapshotBundle = {
      day: 6,
      activeColCount: 3,
      createdAtMs: 123,
      entities: [
        { instanceId: 'super-grenade', defId: grenade!.id, tier: 'Gold', tierStar: 1, size: '1x1', col: 0, row: 0 },
      ],
    }

    const baseDamages: number[] = []
    const off = EventBus.on('battle:take_damage', (e) => {
      if (e.sourceItemId.includes('super-grenade') && e.type === 'normal') {
        baseDamages.push(e.baseDamage ?? 0)
      }
    })
    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 2200; i++) {
      engine.update(1 / 60)
      if (baseDamages.length >= 2) break
    }
    off()

    expect(baseDamages.length).toBeGreaterThanOrEqual(2)
    expect(baseDamages[1]).toBeGreaterThan(baseDamages[0] ?? 0)
  })

  it('连发飞镖3连发会触发3次“相邻物品攻击后全体增伤”', () => {
    const dagger = getAllItems().find((it) => it.name_cn === '匕首')
    const darts = getAllItems().find((it) => it.name_cn === '连发飞镖')
    const sword = getAllItems().find((it) => it.name_cn === '短剑')
    expect(dagger).toBeTruthy()
    expect(darts).toBeTruthy()
    expect(sword).toBeTruthy()

    const snapshot: BattleSnapshotBundle = {
      day: 1,
      activeColCount: 6,
      createdAtMs: 123,
      entities: [
        { instanceId: 'dmg-dagger', defId: dagger!.id, tier: 'Bronze', tierStar: 1, size: '1x1', col: 0, row: 0 },
        { instanceId: 'multi-darts', defId: darts!.id, tier: 'Bronze', tierStar: 1, size: '2x1', col: 1, row: 0 },
        { instanceId: 'main-sword', defId: sword!.id, tier: 'Bronze', tierStar: 1, size: '1x1', col: 3, row: 0 },
      ],
    }

    let maxSwordBaseDamage = -1
    const off = EventBus.on('battle:take_damage', (e) => {
      if (e.type !== 'normal') return
      if (e.sourceItemId.includes('main-sword')) {
        maxSwordBaseDamage = Math.max(maxSwordBaseDamage, e.baseDamage ?? -1)
      }
    })

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 3000; i++) {
      engine.update(1 / 60)
    }
    off()

    // 短剑青铜1星基础10；匕首相邻攻击增伤+2，飞镖3连发应累计+6
    expect(maxSwordBaseDamage).toBeGreaterThanOrEqual(16)
  })

  it('连发触发按实际发射tick逐次生效（10->12->14->16）', () => {
    const dagger = getAllItems().find((it) => it.name_cn === '匕首')
    const darts = getAllItems().find((it) => it.name_cn === '连发飞镖')
    const sword = getAllItems().find((it) => it.name_cn === '短剑')
    expect(dagger).toBeTruthy()
    expect(darts).toBeTruthy()
    expect(sword).toBeTruthy()

    const snapshot: BattleSnapshotBundle = {
      day: 1,
      activeColCount: 6,
      createdAtMs: 123,
      entities: [
        { instanceId: 'tick-dagger', defId: dagger!.id, tier: 'Bronze', tierStar: 1, size: '1x1', col: 0, row: 0 },
        { instanceId: 'tick-darts', defId: darts!.id, tier: 'Bronze', tierStar: 1, size: '2x1', col: 1, row: 0 },
        { instanceId: 'tick-sword', defId: sword!.id, tier: 'Bronze', tierStar: 1, size: '1x1', col: 3, row: 0 },
      ],
    }

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })

    const seen: number[] = []
    for (let i = 0; i < 2200; i++) {
      engine.update(1 / 60)
      const rt = engine.getRuntimeState().find((it) => it.id.includes('tick-sword'))
      if (!rt) continue
      if (seen.length === 0 || seen[seen.length - 1] !== rt.damage) {
        seen.push(rt.damage)
      }
      if (seen.includes(10) && seen.includes(12) && seen.includes(14) && seen.includes(16)) break
    }

    const i10 = seen.indexOf(10)
    const i12 = seen.indexOf(12)
    const i14 = seen.indexOf(14)
    const i16 = seen.indexOf(16)
    expect(i10).toBeGreaterThanOrEqual(0)
    expect(i12).toBeGreaterThan(i10)
    expect(i14).toBeGreaterThan(i12)
    expect(i16).toBeGreaterThan(i14)
  })

  it('连发飞镖三发伤害逐发变化（同轮内不应完全相同）', () => {
    const dagger = getAllItems().find((it) => it.name_cn === '匕首')
    const darts = getAllItems().find((it) => it.name_cn === '连发飞镖')
    expect(dagger).toBeTruthy()
    expect(darts).toBeTruthy()

    const snapshot: BattleSnapshotBundle = {
      day: 1,
      activeColCount: 4,
      createdAtMs: 123,
      entities: [
        { instanceId: 'shot-dagger', defId: dagger!.id, tier: 'Bronze', tierStar: 1, size: '1x1', col: 0, row: 0 },
        { instanceId: 'shot-darts', defId: darts!.id, tier: 'Bronze', tierStar: 1, size: '2x1', col: 1, row: 0 },
      ],
    }

    const amounts: number[] = []
    const off = EventBus.on('battle:take_damage', (e) => {
      if (e.type !== 'normal') return
      if (!e.sourceItemId.includes('shot-darts')) return
      amounts.push(e.amount)
    })

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 1800; i++) {
      engine.update(1 / 60)
      if (amounts.length >= 3) break
    }
    off()

    expect(amounts.length).toBeGreaterThanOrEqual(3)
    expect(amounts[1]).toBeGreaterThan(amounts[0] ?? 0)
    expect(amounts[2]).toBeGreaterThan(amounts[1] ?? 0)
  })

  it('切割镰刀不会在开场给所有武器自动+100伤害', () => {
    const sword = getAllItems().find((it) => it.name_cn === '短剑')
    const scythe = getAllItems().find((it) => it.name_cn === '切割镰刀')
    expect(sword).toBeTruthy()
    expect(scythe).toBeTruthy()

    const snapshot: BattleSnapshotBundle = {
      day: 6,
      activeColCount: 5,
      createdAtMs: 123,
      entities: [
        { instanceId: 'sword-no-global-buff', defId: sword!.id, tier: 'Bronze', tierStar: 1, size: '1x1', col: 0, row: 0 },
        { instanceId: 'scythe-owner', defId: scythe!.id, tier: 'Gold', tierStar: 1, size: '2x1', col: 2, row: 0 },
      ],
    }

    let swordBaseDamage = -1
    const off = EventBus.on('battle:take_damage', (e) => {
      if (e.type !== 'normal') return
      if (!e.sourceItemId.includes('sword-no-global-buff')) return
      swordBaseDamage = e.baseDamage ?? -1
    })

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 1400; i++) {
      engine.update(1 / 60)
      if (swordBaseDamage >= 0) break
    }
    off()

    expect(swordBaseDamage).toBe(10)
  })

  it('超级弩机会因其他弹药物品使用而提高实时连发显示', () => {
    const superCrossbow = getAllItems().find((it) => it.name_cn === '超级弩机')
    const ammoUser = getAllItems().find((it) => it.name_cn === '木弓')
    expect(superCrossbow).toBeTruthy()
    expect(ammoUser).toBeTruthy()
    if (!superCrossbow || !ammoUser) return

    const snapshot: BattleSnapshotBundle = {
      day: 10,
      activeColCount: 6,
      createdAtMs: 123,
      entities: [
        { instanceId: 'super-xbow', defId: superCrossbow.id, tier: 'Bronze', size: '2x1', col: 0, row: 0 },
        { instanceId: 'ammo-user', defId: ammoUser.id, tier: 'Bronze', size: '2x1', col: 2, row: 0 },
      ],
    }

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })

    let boosted = 1
    for (let i = 0; i < 1600; i++) {
      engine.update(1 / 60)
      const rt = engine.getRuntimeState().find((it) => it.id.includes('super-xbow'))
      if (!rt) continue
      boosted = Math.max(boosted, rt.multicast)
      if (boosted >= 2) break
    }

    expect(boosted).toBeGreaterThanOrEqual(2)
  })

  it('黄金袖箭每次使用后CD固定-1秒且最低1秒', () => {
    const sleeve = getAllItems().find((it) => it.name_cn === '黄金袖箭')
    expect(sleeve).toBeTruthy()
    if (!sleeve) return

    const snapshot: BattleSnapshotBundle = {
      day: 10,
      activeColCount: 3,
      createdAtMs: 123,
      entities: [
        { instanceId: 'gold-sleeve-1', defId: sleeve.id, tier: 'Gold', size: '1x1', col: 0, row: 0 },
      ],
    }

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })

    let fireCount = 0
    const cooldownAfterFire: number[] = []
    const off = EventBus.on('battle:take_damage', (e) => {
      if (e.type !== 'normal') return
      if (!e.sourceItemId.includes('gold-sleeve-1')) return
      fireCount += 1
      const rt = engine.getRuntimeState().find((r) => r.id.includes('gold-sleeve-1'))
      if (!rt) return
      cooldownAfterFire.push(rt.cooldownMs)
    })

    for (let i = 0; i < 3000; i++) {
      engine.update(1 / 60)
      if (fireCount >= 5) break
    }
    off()

    expect(fireCount).toBeGreaterThanOrEqual(5)
    expect(cooldownAfterFire[0]).toBe(1500)
    expect(cooldownAfterFire[1]).toBe(1000)
    expect(cooldownAfterFire[4]).toBe(1000)
  })

  it('长盾触发护盾后，长剑触发频率应高于长盾', () => {
    const longSword = getAllItems().find((it) => it.name_cn === '长剑')
    const longShield = getAllItems().find((it) => it.name_cn === '长盾')
    expect(longSword).toBeTruthy()
    expect(longShield).toBeTruthy()
    if (!longSword || !longShield) return

    const snapshot: BattleSnapshotBundle = {
      day: 6,
      activeColCount: 4,
      createdAtMs: 123,
      entities: [
        { instanceId: 'long-sword-cd', defId: longSword.id, tier: 'Silver', tierStar: 1, size: '2x1', col: 0, row: 0 },
        { instanceId: 'long-shield-cd', defId: longShield.id, tier: 'Silver', tierStar: 1, size: '1x1', col: 2, row: 0 },
      ],
    }

    let swordFire = 0
    let shieldFire = 0
    const off = EventBus.on('battle:item_fire', (e) => {
      if (e.sourceItemId.includes('long-sword-cd')) swordFire += 1
      if (e.sourceItemId.includes('long-shield-cd')) shieldFire += 1
    })

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 3600; i++) {
      engine.update(1 / 60)
    }
    off()

    expect(swordFire - shieldFire).toBeGreaterThanOrEqual(2)
  })

  it('护盾充能触发的额外释放会按100ms排队而非同tick立即连续触发', () => {
    const longSword = getAllItems().find((it) => it.name_cn === '长剑')
    const longShield = getAllItems().find((it) => it.name_cn === '长盾')
    expect(longSword).toBeTruthy()
    expect(longShield).toBeTruthy()
    if (!longSword || !longShield) return

    const snapshot: BattleSnapshotBundle = {
      day: 6,
      activeColCount: 4,
      createdAtMs: 123,
      entities: [
        { instanceId: 'q-long-sword', defId: longSword.id, tier: 'Silver', tierStar: 1, size: '2x1', col: 0, row: 0 },
        { instanceId: 'q-long-shield', defId: longShield.id, tier: 'Silver', tierStar: 1, size: '1x1', col: 2, row: 0 },
      ],
    }

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })

    const swordExecute: number[] = []
    for (let i = 0; i < 2000; i++) {
      engine.update(1 / 60)
      const rt = engine.getRuntimeState().find((it) => it.id.includes('q-long-sword'))
      if (!rt) continue
      if (swordExecute.length === 0 || swordExecute[swordExecute.length - 1] !== rt.executeCount) {
        swordExecute.push(rt.executeCount)
      }
      if (swordExecute.length >= 4) break
    }

    // executeCount 只能逐tick增加，不应出现同次 update 内跳增多个档位
    for (let i = 1; i < swordExecute.length; i++) {
      expect((swordExecute[i] ?? 0) - (swordExecute[i - 1] ?? 0)).toBe(1)
    }
  })

})
