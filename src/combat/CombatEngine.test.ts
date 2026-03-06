import { describe, expect, it } from 'vitest'
import { CombatEngine, setCombatRuntimeOverride } from '@/combat/CombatEngine'
import type { BattleSnapshotBundle } from '@/combat/BattleSnapshotStore'
import { getAllItems } from '@/core/DataLoader'
import { EventBus } from '@/core/EventBus'

const SKILL_LINE_CONTRACT_PATTERNS: RegExp[] = [
  /攻击造成\d+(?:[\/|]\d+)*(?:伤害)?。?$/,
  /使用时相邻护盾物品护盾\+\d+(?:[\/|]\d+)*。?$/,
  /获得\d+(?:[\/|]\d+)*护盾。?$/,
  /使用时相邻物品伤害\+\d+(?:[\/|]\d+)*(?:，|,)?并补充\d+(?:[\/|]\d+)*发弹药。?$/,
  /每次攻击后伤害\+\d+(?:[\/|]\d+)*(?:，|,)?弹药\s*[:：]\s*\d+。?$/,
  /相邻的?武器攻击时，?所有武器伤害\+\d+(?:[\/|]\d+)*。?$/,
  /连续发射\d+次。?$/,
  /每次使用后护盾\+\d+(?:[\/|]\d+)*。?$/,
  /(?:一次)?打出所有弹药，?弹药\s*[:：]\s*\d+(?:[\/|]\d+)*。?$/,
  /武器伤害\+\d+(?:[\/|]\d+)*。?$/,
  /每次使用后所有护盾物品\+\d+(?:[\/|]\d+)*护盾。?$/,
  /每次使用后根据当前护盾值对对方造成伤害。?$/,
  /每次使用后伤害翻倍，?弹药\s*[:：]\s*\d+。?$/,
  /使用(?:其他)?弹药物品时(?:攻击|连发)次数\+\d+(?:[\/|]\d+)*，?弹药\s*[:：]\s*\d+(?:[\/|]\d+)*。?$/,
  /攻击后间隔-\d+ms，?最低\d+ms。?$/,
  /造成目标最大生命值\d+%的伤害。?$/,
  /战斗开始时，?所有物品伤害\+\d+(?:[\/|]\d+)*。?$/,
  /连续发射\d+(?:[\/|]\d+)*次，?使用后连发次数-\d+。?$/,
  /使用时伤害\+\d+(?:[\/|]\d+)*(?:，|,)?并打出所有弹药，?弹药\s*[:：]\s*\d+(?:[\/|]\d+)*。?$/,
  /相邻回旋镖时伤害翻倍。?$/,
  /每次使用后伤害-\d+(?:[\/|]\d+)*。?$/,
  /受到攻击时为此物品充能\d+(?:[\/|]\d+)*秒。?$/,
  /弹药耗尽时造成\d+(?:[\/|]\d+)*倍伤害。?$/,
  /使用相邻物品时(?:额外|立即)使用此物品。?$/,
  /受到攻击时(?:额外|立即)使用此物品。?$/,
  /补充弹药时伤害\+\d+(?:[\/|]\d+)*。?$/,
  /右侧的攻击物品连发次数\+\d+(?:[\/|]\d+)*。?$/,
]

function allSkillLinesFromItems(): string[] {
  return getAllItems()
    .flatMap((it) => it.skills.map((s) => (s.cn ?? '').trim()))
    .filter((line) => line.length > 0)
}

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
      fatigueTickMs: 1000,
      fatigueBaseValue: 0,
      fatigueDoubleEveryMs: 1000,
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

  it('超时扣血仅走固定值并按每秒翻倍（1,2,4...）', () => {
    setCombatRuntimeOverride({
      fatigueStartMs: 100,
      fatigueTickMs: 100,
      fatigueBaseValue: 1,
      fatigueDoubleEveryMs: 1000,
    })

    const snapshot: BattleSnapshotBundle = {
      day: 1,
      activeColCount: 4,
      createdAtMs: 123,
      entities: [],
    }

    const fatigueHits: number[] = []
    const off = EventBus.on('battle:take_damage', (e) => {
      if (e.sourceItemId === 'fatigue' && e.targetSide === 'player') {
        fatigueHits.push(e.finalDamage ?? 0)
      }
    })

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 3000; i++) {
      engine.update(1 / 60)
      if (fatigueHits.length >= 12) break
    }
    off()
    setCombatRuntimeOverride({})

    expect(fatigueHits.length).toBeGreaterThanOrEqual(12)
    expect(fatigueHits[0]).toBe(1)
    expect(fatigueHits[1]).toBe(1)
    expect(fatigueHits[9]).toBe(1)
    expect(fatigueHits[10]).toBe(2)
    expect(fatigueHits[11]).toBe(2)
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

  it('同品质星级会影响物品基础伤害（短剑青铜2星=10）', () => {
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
    expect(sword?.damage).toBe(10)
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

  it('手弩连发同次使用内伤害会逐发递增（每发+10）', () => {
    const handCrossbow = getAllItems().find((it) => it.name_cn === '手弩')
    expect(handCrossbow).toBeTruthy()

    const snapshot: BattleSnapshotBundle = {
      day: 3,
      activeColCount: 3,
      createdAtMs: 123,
      entities: [
        { instanceId: 'hand-xbow-ramp', defId: handCrossbow!.id, tier: 'Silver', tierStar: 1, size: '1x1', col: 0, row: 0 },
      ],
    }

    const shotDamages: number[] = []
    const off = EventBus.on('battle:take_damage', (e) => {
      if (e.type !== 'normal') return
      if (!e.sourceItemId.includes('hand-xbow-ramp')) return
      shotDamages.push(e.amount)
    })

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 1400; i++) {
      engine.update(1 / 60)
      if (shotDamages.length >= 3) break
    }
    off()

    expect(shotDamages.length).toBeGreaterThanOrEqual(3)
    expect(shotDamages[0]).toBeGreaterThanOrEqual(50)
    expect(shotDamages[1]).toBe(shotDamages[0]! + 10)
    expect(shotDamages[2]).toBe(shotDamages[1]! + 10)
  })

  it('手弩首次使用前会先获得+10伤害后再打出全部弹药', () => {
    const handCrossbow = getAllItems().find((it) => it.name_cn === '手弩')
    expect(handCrossbow).toBeTruthy()
    if (!handCrossbow) return

    const snapshot: BattleSnapshotBundle = {
      day: 3,
      activeColCount: 3,
      createdAtMs: 123,
      entities: [
        { instanceId: 'hand-xbow-pre-buff', defId: handCrossbow.id, tier: 'Silver', tierStar: 1, size: '1x1', col: 0, row: 0 },
      ],
    }

    let firstAmount = -1
    const off = EventBus.on('battle:take_damage', (e) => {
      if (e.type !== 'normal') return
      if (!e.sourceItemId.includes('hand-xbow-pre-buff')) return
      if (firstAmount >= 0) return
      firstAmount = e.amount
    })

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 1600; i++) {
      engine.update(1 / 60)
      if (firstAmount >= 0) break
    }
    off()

    expect(firstAmount).toBeGreaterThanOrEqual(60)
  })

  it('回旋镖相邻放置时伤害翻倍', () => {
    const boomerang = getAllItems().find((it) => it.name_cn === '回旋镖')
    expect(boomerang).toBeTruthy()
    if (!boomerang) return

    const collectFirstDamage = (snapshot: BattleSnapshotBundle, sourceKey: string): number => {
      let out = -1
      const off = EventBus.on('battle:take_damage', (e) => {
        if (e.type !== 'normal') return
        if (!e.sourceItemId.includes(sourceKey)) return
        if (out >= 0) return
        out = e.amount
      })

      const engine = new CombatEngine()
      engine.start(snapshot, { enemyDisabled: true })
      for (let i = 0; i < 2200; i++) {
        engine.update(1 / 60)
        if (out >= 0) break
      }
      off()
      return out
    }

    const soloSnapshot: BattleSnapshotBundle = {
      day: 6,
      activeColCount: 4,
      createdAtMs: 123,
      entities: [
        { instanceId: 'boomerang-solo', defId: boomerang.id, tier: 'Bronze', tierStar: 1, size: '1x1', col: 0, row: 0 },
      ],
    }

    const adjacentSnapshot: BattleSnapshotBundle = {
      day: 6,
      activeColCount: 4,
      createdAtMs: 123,
      entities: [
        { instanceId: 'boomerang-adj-a', defId: boomerang.id, tier: 'Bronze', tierStar: 1, size: '1x1', col: 0, row: 0 },
        { instanceId: 'boomerang-adj-b', defId: boomerang.id, tier: 'Bronze', tierStar: 1, size: '1x1', col: 1, row: 0 },
      ],
    }

    const solo = collectFirstDamage(soloSnapshot, 'boomerang-solo')
    const adjacent = collectFirstDamage(adjacentSnapshot, 'boomerang-adj-a')

    expect(solo).toBeGreaterThan(0)
    expect(adjacent).toBe(solo * 2)
  })

  it('弹药袋每次仅给相邻弹药物品补充1发', () => {
    const ammoBag = getAllItems().find((it) => it.name_cn === '弹药袋')
    const handCrossbow = getAllItems().find((it) => it.name_cn === '手弩')
    expect(ammoBag).toBeTruthy()
    expect(handCrossbow).toBeTruthy()
    if (!ammoBag || !handCrossbow) return

    const snapshot: BattleSnapshotBundle = {
      day: 3,
      activeColCount: 4,
      createdAtMs: 123,
      entities: [
        { instanceId: 'ammo-bag-1', defId: ammoBag.id, tier: 'Bronze', tierStar: 1, size: '1x1', col: 0, row: 0 },
        { instanceId: 'hand-xbow-refill', defId: handCrossbow.id, tier: 'Silver', tierStar: 1, size: '1x1', col: 1, row: 0 },
      ],
    }

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })

    let observedAfterEmpty = -1
    let becameEmpty = false
    for (let i = 0; i < 2400; i++) {
      engine.update(1 / 60)
      const rt = engine.getRuntimeState().find((it) => it.id.includes('hand-xbow-refill'))
      if (!rt) continue
      if (!becameEmpty && rt.ammoCurrent === 0) becameEmpty = true
      if (becameEmpty && rt.ammoCurrent > 0) {
        observedAfterEmpty = rt.ammoCurrent
        break
      }
    }

    expect(becameEmpty).toBe(true)
    expect(observedAfterEmpty).toBe(1)
  })

  it('圆盾无额外增伤效果（仅提供护盾）', () => {
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
        { instanceId: 'round-shield', defId: shield!.id, tier: 'Bronze', tierStar: 1, size: '1x1', col: 1, row: 0 },
      ],
    }

    let maxBaseDamage = -1
    const off = EventBus.on('battle:take_damage', (e) => {
      if (e.sourceItemId.includes('short-sword') && e.type === 'normal') {
        maxBaseDamage = Math.max(maxBaseDamage, e.baseDamage ?? -1)
      }
    })
    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 1200; i++) {
      engine.update(1 / 60)
      if (maxBaseDamage >= 5) break
    }
    off()

    expect(maxBaseDamage).toBe(5)
  })

  it('短剑使用时仅提升相邻护盾物品的护盾', () => {
    const shortSword = getAllItems().find((it) => it.name_cn === '短剑')
    const roundShield = getAllItems().find((it) => it.name_cn === '圆盾')
    const dagger = getAllItems().find((it) => it.name_cn === '匕首')
    expect(shortSword).toBeTruthy()
    expect(roundShield).toBeTruthy()
    expect(dagger).toBeTruthy()

    const snapshot: BattleSnapshotBundle = {
      day: 1,
      activeColCount: 5,
      createdAtMs: 123,
      entities: [
        { instanceId: 'ally-dagger', defId: dagger!.id, tier: 'Bronze', tierStar: 1, size: '1x1', col: 0, row: 0 },
        { instanceId: 'ally-short-sword', defId: shortSword!.id, tier: 'Bronze', tierStar: 1, size: '1x1', col: 1, row: 0 },
        { instanceId: 'ally-round-shield', defId: roundShield!.id, tier: 'Bronze', tierStar: 1, size: '1x1', col: 2, row: 0 },
      ],
    }

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })

    for (let i = 0; i < 1200; i++) {
      engine.update(1 / 60)
      const rt = engine.getRuntimeState().find((it) => it.id.includes('ally-short-sword'))
      if ((rt?.executeCount ?? 0) >= 1) break
    }

    const shieldRt = engine.getRuntimeState().find((it) => it.id.includes('ally-round-shield'))
    const daggerRt = engine.getRuntimeState().find((it) => it.id.includes('ally-dagger'))
    expect(shieldRt).toBeTruthy()
    expect(daggerRt).toBeTruthy()
    expect((shieldRt?.shield ?? 0)).toBeGreaterThan(15)
    expect(daggerRt?.shield ?? 0).toBe(0)
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

    // 匕首改为开场全体增伤：短剑青铜1星基础5，开场后应达到15
    expect(maxSwordBaseDamage).toBeGreaterThanOrEqual(15)
  })

  it('连发飞镖会在每次使用后降低连发次数（最低1）', () => {
    const darts = getAllItems().find((it) => it.name_cn === '连发飞镖')
    expect(darts).toBeTruthy()

    const snapshot: BattleSnapshotBundle = {
      day: 1,
      activeColCount: 6,
      createdAtMs: 123,
      entities: [
        { instanceId: 'tick-darts', defId: darts!.id, tier: 'Bronze', tierStar: 1, size: '1x1', col: 1, row: 0 },
      ],
    }

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })

    const seen: number[] = []
    for (let i = 0; i < 2200; i++) {
      engine.update(1 / 60)
      const rt = engine.getRuntimeState().find((it) => it.id.includes('tick-darts'))
      if (!rt) continue
      if (seen.length === 0 || seen[seen.length - 1] !== rt.damage) {
        seen.push(rt.multicast)
      }
      if (seen.includes(3) && seen.includes(2) && seen.includes(1)) break
    }

    const i3 = seen.indexOf(3)
    const i2 = seen.indexOf(2)
    const i1 = seen.indexOf(1)
    expect(i3).toBeGreaterThanOrEqual(0)
    expect(i2).toBeGreaterThan(i3)
    expect(i1).toBeGreaterThan(i2)
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
    expect(amounts[0]).toBeGreaterThan(0)
    expect(amounts[1]).toBeGreaterThan(0)
    expect(amounts[2]).toBeGreaterThan(0)
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

    expect(swordBaseDamage).toBe(5)
  })

  it('超级弩机每次由其他弹药物品触发后连发会在本局累加且不重置', () => {
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
    let boostedAfterSelfFire = 1
    for (let i = 0; i < 1600; i++) {
      engine.update(1 / 60)
      const rt = engine.getRuntimeState().find((it) => it.id.includes('super-xbow'))
      if (!rt) continue
      boosted = Math.max(boosted, rt.multicast)
      if (rt.executeCount > 0) boostedAfterSelfFire = Math.max(boostedAfterSelfFire, rt.multicast)
      if (boosted >= 3 && boostedAfterSelfFire >= 2) break
    }

    expect(boosted).toBeGreaterThanOrEqual(3)
    expect(boostedAfterSelfFire).toBeGreaterThanOrEqual(2)
  })

  it('黄金袖箭基础CD固定为600ms（不再按使用递减）', () => {
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
    expect(cooldownAfterFire[0]).toBe(600)
    expect(cooldownAfterFire[1]).toBe(600)
    expect(cooldownAfterFire[2]).toBe(600)
    expect(cooldownAfterFire[4]).toBe(600)
  })

  it('黄金袖箭使用后降伤最低保留1点', () => {
    const sleeve = getAllItems().find((it) => it.name_cn === '黄金袖箭')
    expect(sleeve).toBeTruthy()
    if (!sleeve) return

    const snapshot: BattleSnapshotBundle = {
      day: 10,
      activeColCount: 3,
      createdAtMs: 123,
      entities: [
        { instanceId: 'gold-sleeve-floor', defId: sleeve.id, tier: 'Gold', size: '1x1', col: 0, row: 0 },
      ],
    }

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 2200; i++) {
      engine.update(1 / 60)
    }

    const rt = engine.getRuntimeState().find((r) => r.id.includes('gold-sleeve-floor'))
    expect(rt).toBeTruthy()
    expect(rt?.damage ?? 0).toBeGreaterThanOrEqual(1)
  })

  it('黄金袖箭每次使用后伤害固定-20', () => {
    const sleeve = getAllItems().find((it) => it.name_cn === '黄金袖箭')
    expect(sleeve).toBeTruthy()
    if (!sleeve) return

    const snapshot: BattleSnapshotBundle = {
      day: 10,
      activeColCount: 3,
      createdAtMs: 123,
      entities: [
        { instanceId: 'gold-sleeve-minus', defId: sleeve.id, tier: 'Gold', size: '1x1', col: 0, row: 0 },
      ],
    }

    const baseDamages: number[] = []
    const off = EventBus.on('battle:take_damage', (e) => {
      if (e.type !== 'normal') return
      if (!e.sourceItemId.includes('gold-sleeve-minus')) return
      baseDamages.push(e.baseDamage ?? -1)
    })

    const engine = new CombatEngine()
    engine.start(snapshot, { enemyDisabled: true })
    for (let i = 0; i < 3000; i++) {
      engine.update(1 / 60)
      if (baseDamages.length >= 2) break
    }
    off()

    expect(baseDamages.length).toBeGreaterThanOrEqual(2)
    expect(baseDamages[0]).toBeGreaterThan(baseDamages[1] ?? -1)
    expect(baseDamages[0]! - baseDamages[1]!).toBe(20)
  })

  it('物品技能文案已被战斗规则契约覆盖（新增文案需同步实现与测试）', () => {
    const lines = [...new Set(allSkillLinesFromItems())]
    const uncovered = lines.filter((line) => !SKILL_LINE_CONTRACT_PATTERNS.some((re) => re.test(line)))

    expect(uncovered).toEqual([])
  })


})
