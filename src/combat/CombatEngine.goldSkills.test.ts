import { describe, expect, it } from 'vitest'
import { CombatEngine, setCombatRuntimeOverride } from '@/combat/CombatEngine'
import type { BattleSnapshotBundle } from '@/combat/BattleSnapshotStore'
import { getAllItems } from '@/core/DataLoader'
import { EventBus } from '@/core/EventBus'

const DEFAULT_DEF_ID = getAllItems()[0]?.id ?? 'missing_def'

function findAmmoDefId(): string {
  const hit = getAllItems().find((it) =>
    it.skills.some((s) => /弹药\s*[:：]|ammo\s*:/i.test(s.cn ?? '') || /ammo\s*:/i.test(s.en ?? '')),
  )
  return hit?.id ?? DEFAULT_DEF_ID
}

function mkEntity(
  instanceId: string,
  col: number,
  baseStats: Partial<NonNullable<BattleSnapshotBundle['entities'][number]['baseStats']>>,
  defId = DEFAULT_DEF_ID,
): BattleSnapshotBundle['entities'][number] {
  return {
    instanceId,
    defId,
    tier: 'Bronze',
    size: '1x1',
    col,
    row: 0,
    baseStats: {
      cooldownMs: 1000,
      damage: 0,
      heal: 0,
      shield: 0,
      burn: 0,
      poison: 0,
      regen: 0,
      crit: 0,
      multicast: 1,
      ...baseStats,
    },
  }
}

function mkSnapshot(
  entities: BattleSnapshotBundle['entities'],
  extra?: Partial<BattleSnapshotBundle>,
): BattleSnapshotBundle {
  return {
    day: 1,
    activeColCount: 6,
    createdAtMs: 123,
    entities,
    ...extra,
  }
}

function tick(engine: CombatEngine, ticks: number): void {
  for (let i = 0; i < ticks; i++) engine.update(1 / 60)
}

function runtimeByInstance(engine: CombatEngine, instanceId: string) {
  return engine.getRuntimeState().find((it) => it.id.includes(instanceId))
}

describe('CombatEngine gold skills', () => {
  it('skill36: 开场获得30%最大生命护盾', () => {
    const engine = new CombatEngine()
    engine.start(mkSnapshot([mkEntity('g36', 0, { damage: 10 })]), { playerSkillIds: ['skill36'], enemyDisabled: true })
    const board = engine.getBoardState()
    expect(board.player.shield).toBe(Math.round(board.player.maxHp * 0.3))
  })

  it('skill37: 每10点护盾提升1点全体伤害（实时）', () => {
    const engine = new CombatEngine()
    engine.start(mkSnapshot([mkEntity('g37', 0, { damage: 10 })]), { playerSkillIds: ['skill36', 'skill37'], enemyDisabled: true })
    const board = engine.getBoardState()
    const rt = runtimeByInstance(engine, 'g37')
    expect(rt).toBeTruthy()
    expect(rt?.damage).toBe(10 + Math.floor(board.player.shield / 10))
  })

  it('skill38: 我方血量高于敌方时全体CD-20%', () => {
    const engine = new CombatEngine()
    engine.start(mkSnapshot([mkEntity('g38', 0, { cooldownMs: 1000, damage: 10 })]), { playerSkillIds: ['skill38'], enemyDisabled: true })
    const rt = runtimeByInstance(engine, 'g38')
    expect(rt?.cooldownMs).toBe(800)
  })

  it('skill39: 前10秒新增护盾翻倍', () => {
    const engine = new CombatEngine()
    engine.start(mkSnapshot([mkEntity('g39', 0, { cooldownMs: 1000, shield: 20 })]), { playerSkillIds: ['skill39'], enemyDisabled: true })
    tick(engine, 80)
    const board = engine.getBoardState()
    expect(board.player.shield).toBe(40)
  })

  it('skill82: 护盾物品触发时造成等额伤害', () => {
    const engine = new CombatEngine()
    let dmg = 0
    const off = EventBus.on('battle:take_damage', (e) => {
      if (e.sourceItemId === 'skill82') dmg += e.amount
    })
    engine.start(mkSnapshot([mkEntity('g82', 0, { cooldownMs: 1000, shield: 30 })]), { playerSkillIds: ['skill82'], enemyDisabled: true })
    tick(engine, 90)
    off()
    expect(dmg).toBe(30)
  })

  it('skill43: 唯一伤害物品伤害翻倍', () => {
    const engine = new CombatEngine()
    engine.start(mkSnapshot([mkEntity('g43', 0, { damage: 10 })]), { playerSkillIds: ['skill43'], enemyDisabled: true })
    expect(runtimeByInstance(engine, 'g43')?.damage).toBe(20)
  })

  it('skill44: 唯一弹药物品伤害+50%且弹药上限+10', () => {
    const ammoDefId = findAmmoDefId()
    const baseEngine = new CombatEngine()
    baseEngine.start(mkSnapshot([mkEntity('g44b', 0, { damage: 10 }, ammoDefId)]), { enemyDisabled: true })
    const baseRt = runtimeByInstance(baseEngine, 'g44b')

    const engine = new CombatEngine()
    engine.start(mkSnapshot([mkEntity('g44', 0, { damage: 10 }, ammoDefId)]), { playerSkillIds: ['skill44'], enemyDisabled: true })
    const rt = runtimeByInstance(engine, 'g44')
    expect(rt).toBeTruthy()
    expect(baseRt).toBeTruthy()
    expect(rt?.damage).toBe(Math.round((baseRt?.damage ?? 0) * 1.5))
    expect(rt?.ammoMax).toBe((baseRt?.ammoMax ?? 0) + 10)
  })

  it('skill84: 全部为弹药物品时全体伤害+50%', () => {
    const ammoDefId = findAmmoDefId()
    const engine = new CombatEngine()
    engine.start(mkSnapshot([
      mkEntity('g84a', 0, { damage: 10 }, ammoDefId),
      mkEntity('g84b', 1, { damage: 20 }, ammoDefId),
    ]), { playerSkillIds: ['skill84'], enemyDisabled: true })
    expect(runtimeByInstance(engine, 'g84a')?.damage).toBe(15)
    expect(runtimeByInstance(engine, 'g84b')?.damage).toBe(30)
  })

  it('skill85: 弹药耗尽时相邻物品伤害+50', () => {
    const ammoDefId = findAmmoDefId()
    const engine = new CombatEngine()
    engine.start(mkSnapshot([
      mkEntity('g85-ammo', 0, { cooldownMs: 300, damage: 10 }, ammoDefId),
      mkEntity('g85-adj', 1, { cooldownMs: 2000, damage: 10 }),
    ]), { playerSkillIds: ['skill85'], enemyDisabled: true })

    let boosted = false
    for (let i = 0; i < 4000; i++) {
      engine.update(1 / 60)
      const ammo = runtimeByInstance(engine, 'g85-ammo')
      const adj = runtimeByInstance(engine, 'g85-adj')
      if ((ammo?.ammoCurrent ?? 1) <= 0 && (adj?.damage ?? 0) >= 60) {
        boosted = true
        break
      }
    }
    expect(boosted).toBe(true)
  })

  it('skill86: 前5次使用会给弹药物品充能1秒', () => {
    const ammoDefId = findAmmoDefId()
    const baseline = new CombatEngine()
    baseline.start(mkSnapshot([
      mkEntity('g86-trigger-base', 0, { cooldownMs: 100, damage: 0 }),
      mkEntity('g86-ammo-base', 1, { cooldownMs: 5000, damage: 10 }, ammoDefId),
    ]), { enemyDisabled: true })
    tick(baseline, 120)
    const baseExec = runtimeByInstance(baseline, 'g86-ammo-base')?.executeCount ?? 0

    const engine = new CombatEngine()
    engine.start(mkSnapshot([
      mkEntity('g86-trigger', 0, { cooldownMs: 100, damage: 0 }),
      mkEntity('g86-ammo', 1, { cooldownMs: 5000, damage: 10 }, ammoDefId),
    ]), { playerSkillIds: ['skill86'], enemyDisabled: true })
    tick(engine, 180)
    const skillExec = runtimeByInstance(engine, 'g86-ammo')?.executeCount ?? 0
    expect(baseExec).toBe(0)
    expect(skillExec).toBeGreaterThan(0)
  })

  it('skill40: CD-10% 且最小下限降到100ms', () => {
    const engine = new CombatEngine()
    engine.start(mkSnapshot([mkEntity('g40', 0, { cooldownMs: 200, damage: 10 })]), { playerSkillIds: ['skill40'], enemyDisabled: true })
    const rt = runtimeByInstance(engine, 'g40')
    expect(rt?.cooldownMs).toBe(180)
    expect(rt?.cooldownMs ?? 9999).toBeLessThan(500)
  })

  it('skill45: 敌方首次半血时全体充能2秒', () => {
    const engine = new CombatEngine()
    engine.start(mkSnapshot([
      mkEntity('g45-killer', 0, { cooldownMs: 100, damage: 40 }),
      mkEntity('g45-slow', 1, { cooldownMs: 2000, damage: 50 }),
    ]), { playerSkillIds: ['skill45'], enemyDisabled: true })
    tick(engine, 240)
    const slowExec = runtimeByInstance(engine, 'g45-slow')?.executeCount ?? 0
    expect(slowExec).toBeGreaterThan(0)
  })

  it('skill46: 开场按奖杯数增加全体伤害', () => {
    const engine = new CombatEngine()
    engine.start(mkSnapshot([mkEntity('g46', 0, { damage: 10 })], { playerTrophyWins: 3 }), {
      playerSkillIds: ['skill46'],
      enemyDisabled: true,
    })
    expect(runtimeByInstance(engine, 'g46')?.damage).toBe(70)
  })

  it('skill88: 前5秒全体连发+1', () => {
    const engine = new CombatEngine()
    engine.start(mkSnapshot([mkEntity('g88', 0, { damage: 10, multicast: 1 })]), { playerSkillIds: ['skill88'], enemyDisabled: true })
    const early = runtimeByInstance(engine, 'g88')
    expect(early?.multicast).toBe(2)
    tick(engine, 360)
    const late = runtimeByInstance(engine, 'g88')
    expect(late?.multicast).toBe(1)
  })

  it('skill87: 左侧物品使用时为最右侧充能1秒', () => {
    const baseline = new CombatEngine()
    baseline.start(mkSnapshot([
      mkEntity('g87-left-base', 0, { cooldownMs: 100, damage: 0 }),
      mkEntity('g87-right-base', 1, { cooldownMs: 5000, damage: 10 }),
    ]), { enemyDisabled: true })
    tick(baseline, 120)
    const baseExec = runtimeByInstance(baseline, 'g87-right-base')?.executeCount ?? 0

    const engine = new CombatEngine()
    engine.start(mkSnapshot([
      mkEntity('g87-left', 0, { cooldownMs: 100, damage: 0 }),
      mkEntity('g87-right', 1, { cooldownMs: 5000, damage: 10 }),
    ]), { playerSkillIds: ['skill87'], enemyDisabled: true })
    tick(engine, 180)
    const rightExec = runtimeByInstance(engine, 'g87-right')?.executeCount ?? 0
    expect(baseExec).toBe(0)
    expect(rightExec).toBeGreaterThan(0)
  })

  it('skill47: 濒死时复活并恢复50%最大生命（每场一次）', () => {
    const engine = new CombatEngine()
    let skill47Healed = 0
    const off = EventBus.on('battle:heal', (e) => {
      if (e.sourceItemId === 'skill47') skill47Healed += e.amount
    })
    setCombatRuntimeOverride({
      fatigueStartMs: 100,
      fatigueTickMs: 100,
      fatigueBaseValue: 999,
      fatigueDoubleEveryMs: 1000,
    })
    engine.start(mkSnapshot([]), { playerSkillIds: ['skill47'], enemyDisabled: true })
    for (let i = 0; i < 20000; i++) {
      engine.update(1 / 60)
      if (engine.isFinished() && skill47Healed > 0) break
    }
    off()
    setCombatRuntimeOverride({})
    expect(skill47Healed).toBeGreaterThan(0)
  })

  it('skill49: 背包为空时开场最大生命翻倍', () => {
    const base = new CombatEngine()
    base.start(mkSnapshot([]), { enemyDisabled: true, playerBackpackItemCount: 0 })
    const baseHp = base.getBoardState().player.maxHp

    const engine = new CombatEngine()
    engine.start(mkSnapshot([]), { playerSkillIds: ['skill49'], enemyDisabled: true, playerBackpackItemCount: 0 })
    const hp = engine.getBoardState().player.maxHp
    expect(hp).toBe(baseHp * 2)
  })

  it('skill95: 开场按金币增加全体伤害', () => {
    const engine = new CombatEngine()
    engine.start(mkSnapshot([mkEntity('g95', 0, { damage: 10 })], { playerGold: 10 }), {
      playerSkillIds: ['skill95'],
      enemyDisabled: true,
    })
    expect(runtimeByInstance(engine, 'g95')?.damage).toBe(60)
  })
})
