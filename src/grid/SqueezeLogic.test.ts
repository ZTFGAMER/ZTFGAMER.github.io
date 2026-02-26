// ============================================================
// SqueezeLogic.test.ts — 挤出算法单元测试
// ============================================================

import { describe, it, expect } from 'vitest'
import { GridSystem } from './GridSystem'
import { trySqueezePlace, planUnifiedSqueeze, planCrossZoneSwap } from './SqueezeLogic'

// ---- 辅助：快速布局 ----

function setup(...placements: Array<[string, string, import('./GridSystem').ItemSizeNorm, number, number]>) {
  const g = new GridSystem(5)
  for (const [id, defId, size, col, row] of placements) {
    g.place(col, row, size, defId, id)
  }
  return g
}

function zone(system: GridSystem, activeColCount: number) {
  return { system, activeColCount }
}

// ============================================================
describe('SqueezeLogic — trySqueezePlace', () => {

  // ---- 无冲突：直接返回空 moves ----

  it('目标格完全空：返回 moves=[]', () => {
    const g = new GridSystem(5)
    g.place(0, 0, '1x1', 'd', 'DRAG')
    const plan = trySqueezePlace(g, 'DRAG', 2, 0, '1x1')
    expect(plan).not.toBeNull()
    expect(plan!.moves).toHaveLength(0)
  })

  // ---- 单个 1x1 blocker ----

  it('1x1 拖到被 1x1 占据的格子 → 就近方向挤出', () => {
    // DRAG 在 col=0, 目标 col=2；blocker 在 col=2，左移1格到 col=1
    const g = setup(['DRAG', 'd', '1x1', 0, 0], ['B', 'd', '1x1', 2, 0])
    const plan = trySqueezePlace(g, 'DRAG', 2, 0, '1x1')
    expect(plan).not.toBeNull()
    expect(plan!.moves).toHaveLength(1)
    expect(plan!.moves[0]).toMatchObject({ instanceId: 'B', newCol: 1, newRow: 0 })
  })

  it('blocker 紧贴左边界 → 只能向右挤出', () => {
    // B 在 col=0，左侧无空间；DRAG 目标 col=0
    const g = setup(['DRAG', 'd', '1x1', 4, 0], ['B', 'd', '1x1', 0, 0])
    const plan = trySqueezePlace(g, 'DRAG', 0, 0, '1x1')
    expect(plan).not.toBeNull()
    expect(plan!.moves[0].newCol).toBeGreaterThan(0)
  })

  it('blocker 紧贴右边界 → 只能向左挤出', () => {
    // B 在 col=4，右侧无空间；DRAG 目标 col=4
    const g = setup(['DRAG', 'd', '1x1', 0, 0], ['B', 'd', '1x1', 4, 0])
    const plan = trySqueezePlace(g, 'DRAG', 4, 0, '1x1')
    expect(plan).not.toBeNull()
    expect(plan!.moves[0].newCol).toBeLessThan(4)
  })

  // ---- 1x2 dragged，目标格被多个 1x1 占用 ----

  it('1x2 目标列有两个独立 1x1（row0+row1）→ 两个 blocker 都被挤出', () => {
    // col=2 上下各一个 1x1；DRAG 目标 col=2
    const g = setup(
      ['DRAG', 'd', '1x2', 0, 0],
      ['A', 'd', '1x1', 2, 0],
      ['B', 'd', '1x1', 2, 1],
    )
    const plan = trySqueezePlace(g, 'DRAG', 2, 0, '1x2')
    expect(plan).not.toBeNull()
    // 两个 blocker 都需要移动
    const ids = plan!.moves.map(m => m.instanceId)
    expect(ids).toContain('A')
    expect(ids).toContain('B')
    // 都不再在 col=2
    for (const m of plan!.moves) {
      expect(m.newCol).not.toBe(2)
    }
  })

  // ---- 2x2 dragged ----

  it('2x2 目标格被 1x1 占用 → 挤出', () => {
    // DRAG 目标 col=2（占 col 2,3）；blocker 在 col=2
    const g = setup(['DRAG', 'd', '2x2', 0, 0], ['B', 'd', '1x1', 2, 0])
    const plan = trySqueezePlace(g, 'DRAG', 2, 0, '2x2')
    expect(plan).not.toBeNull()
    expect(plan!.moves.some(m => m.instanceId === 'B')).toBe(true)
  })

  it('2x2 目标格被另一个 2x2 占用 → DRAG 原位空出后 BIG 左推到原位', () => {
    // DRAG(2x2) 在 col=0；BIG(2x2) 在 col=2；目标 col=2
    // 算法先移除 DRAG → col 0,1 空出 → BIG 左推 idealCol=0 → 合法
    const g = setup(['DRAG', 'd', '2x2', 0, 0], ['BIG', 'd', '2x2', 2, 0])
    const plan = trySqueezePlace(g, 'DRAG', 2, 0, '2x2')
    expect(plan).not.toBeNull()
    expect(plan!.moves[0]).toMatchObject({ instanceId: 'BIG', newCol: 0 })
  })

  it('小/中拖到大型左半区：仅当大型右侧有 1 列空位时向右挤出', () => {
    const g = setup(['DRAG', 'd', '1x1', 0, 0], ['BIG', 'd', '2x2', 2, 0])
    const plan = trySqueezePlace(g, 'DRAG', 2, 0, '1x1')
    expect(plan).not.toBeNull()
    expect(plan!.moves).toContainEqual({ instanceId: 'BIG', newCol: 3, newRow: 0 })
  })

  it('小/中拖到大型右半区：仅当大型左侧有 1 列空位时向左挤出', () => {
    const g = setup(['DRAG', 'd', '1x2', 0, 0], ['BIG', 'd', '2x2', 2, 0])
    const plan = trySqueezePlace(g, 'DRAG', 3, 0, '1x2')
    expect(plan).not.toBeNull()
    expect(plan!.moves).toContainEqual({ instanceId: 'BIG', newCol: 1, newRow: 0 })
  })

  it('小/中拖到大型半区但对侧无 1 列空位：判定不可挤出', () => {
    const g = setup(
      ['DRAG', 'd', '1x1', 0, 0],
      ['LOCK', 'd', '1x2', 4, 0],
      ['BIG', 'd', '2x2', 2, 0],
    )
    const plan = trySqueezePlace(g, 'DRAG', 2, 0, '1x1')
    expect(plan).toBeNull()
  })

  it('2x2 目标格被 1x2 占用 → 可挤出', () => {
    // DRAG 目标 col=1（占 1,2）；blocker 1x2 在 col=1；右侧 col=3 空
    const g = setup(['DRAG', 'd', '2x2', 3, 0], ['MED', 'd', '1x2', 1, 0])
    const plan = trySqueezePlace(g, 'DRAG', 1, 0, '2x2')
    expect(plan).not.toBeNull()
  })

  // ---- 连锁挤出 ----

  it('blocker A 和 B 紧靠，A 被推后撞上 B，B 被连锁推', () => {
    // col=2: DRAG 目标；col=2: A；col=1: B（A 推左要到 col=1，撞 B，B 再推到 col=0）
    const g = setup(
      ['DRAG', 'd', '1x1', 4, 0],
      ['A', 'd', '1x1', 2, 0],
      ['B', 'd', '1x1', 1, 0],
    )
    const plan = trySqueezePlace(g, 'DRAG', 2, 0, '1x1')
    expect(plan).not.toBeNull()
    const aMove = plan!.moves.find(m => m.instanceId === 'A')
    const bMove = plan!.moves.find(m => m.instanceId === 'B')
    expect(aMove).toBeDefined()
    expect(bMove).toBeDefined()
    // B 应该移到 col=0（被连锁推最远）
    expect(bMove!.newCol).toBe(0)
  })

  // ---- 空间不足：返回 null ----

  it('目标行全满时，小型可走上下挤出（新规则）', () => {
    // DRAG(1x1) 在 row=0，目标 row=1；row=1 所有5格全被其他物品占满
    // DRAG 离开 row=0，不释放 row=1 的任何空间 → blocker 在 row=1 无处可挤 → null
    const g = new GridSystem(5)
    g.place(0, 0, '1x1', 'd', 'DRAG')
    g.place(0, 1, '1x1', 'd', 'R0')
    g.place(1, 1, '1x1', 'd', 'R1')
    g.place(2, 1, '1x1', 'd', 'R2')
    g.place(3, 1, '1x1', 'd', 'R3')
    g.place(4, 1, '1x1', 'd', 'R4')
    // DRAG 想移到 col=2 row=1（row=1 全满）
    // 新规则允许小型向上下方向挤出，R2 可被挤到 row=0
    const plan = trySqueezePlace(g, 'DRAG', 2, 1, '1x1')
    expect(plan).not.toBeNull()
    expect(plan!.moves.some(m => m.instanceId === 'R2' && m.newRow === 0)).toBe(true)
  })

  it('两侧都没有足够连续空间 → null', () => {
    // DRAG 目标 col=2（2x2 占 col2,3）；col0,1 全满；col4 只有1列不够放 2x2 的 blocker
    const g = new GridSystem(5)
    g.place(0, 0, '2x2', 'd', 'LEFT1')   // 占 col0,1
    g.place(2, 0, '2x2', 'd', 'TARGET')  // blocker 在 col2,3
    g.place(4, 0, '1x2', 'd', 'DRAG')    // DRAG 想移到 col2
    const plan = trySqueezePlace(g, 'DRAG', 2, 0, '2x2')
    expect(plan).toBeNull()
  })

  // ---- DRAG 拖回原位不触发挤出 ----

  it('DRAG 拖到自身原位 → moves=[] 无需挤出', () => {
    const g = setup(['DRAG', 'd', '1x1', 2, 0])
    const plan = trySqueezePlace(g, 'DRAG', 2, 0, '1x1')
    expect(plan).not.toBeNull()
    expect(plan!.moves).toHaveLength(0)
  })

  // ---- 就近方向：左右位移相等时偏左 ----

  it('blocker 位于目标格中心，左右位移相等 → 偏向左侧', () => {
    // 目标 col=2（1x1）；blocker 在 col=2；左侧 col=1 空，右侧 col=3 空
    const g = setup(['DRAG', 'd', '1x1', 0, 0], ['B', 'd', '1x1', 2, 0])
    const plan = trySqueezePlace(g, 'DRAG', 2, 0, '1x1')
    expect(plan).not.toBeNull()
    // leftDisp = 2+1-2=1, rightDisp=2+1-2=1，相等 → preferDir='LEFT' → newCol=1
    expect(plan!.moves[0].newCol).toBe(1)
  })

  it('两个 1x1 处于上下关系时，拖动可直接互换', () => {
    const g = setup(
      ['DRAG', 'd', '1x1', 2, 0],
      ['B', 'd', '1x1', 2, 1],
    )
    const plan = trySqueezePlace(g, 'DRAG', 2, 1, '1x1')
    expect(plan).not.toBeNull()
    expect(plan!.moves).toContainEqual({ instanceId: 'B', newCol: 2, newRow: 0 })
  })

  it('小型最低优先级支持上下/斜向挤出', () => {
    const g = new GridSystem(5)
    g.place(4, 1, '1x1', 'd', 'DRAG')
    g.place(2, 0, '1x1', 'd', 'B')
    // 横向都堵死，逼迫走“上下/斜向”分支
    g.place(0, 0, '1x1', 'd', 'L0')
    g.place(1, 0, '1x1', 'd', 'L1')
    g.place(3, 0, '1x1', 'd', 'R3')
    g.place(4, 0, '1x1', 'd', 'R4')
    // 正下方堵住，只能斜向 (1,1) 或 (3,1)
    g.place(2, 1, '1x1', 'd', 'DOWN')

    const plan = trySqueezePlace(g, 'DRAG', 2, 0, '1x1')
    expect(plan).not.toBeNull()
    const b = plan!.moves.find(m => m.instanceId === 'B')
    expect(b).toBeDefined()
    expect(b!.newRow).toBe(1)
    expect([1, 3]).toContain(b!.newCol)
  })

})

describe('SqueezeLogic — trySqueezePlace (更多场景覆盖)', () => {
  it('拖拽到 row=1 的冲突格子，也可正常挤出', () => {
    const g = setup(['DRAG', 'd', '1x1', 4, 1], ['B', 'd', '1x1', 2, 1])
    const plan = trySqueezePlace(g, 'DRAG', 2, 1, '1x1')
    expect(plan).not.toBeNull()
    expect(plan!.moves).toHaveLength(1)
    expect(plan!.moves[0]).toMatchObject({ instanceId: 'B', newRow: 1 })
  })

  it('中型(1x2)拖到中型(1x2)占位处，blocker 被整列挤开', () => {
    const g = setup(['DRAG', 'd', '1x2', 4, 0], ['M', 'd', '1x2', 2, 0])
    const plan = trySqueezePlace(g, 'DRAG', 2, 0, '1x2')
    expect(plan).not.toBeNull()
    expect(plan!.moves.some(m => m.instanceId === 'M')).toBe(true)
  })

  it('大型(2x2)目标区域同时覆盖两个 blocker，返回两个移动计划', () => {
    const g = setup(
      ['DRAG', 'd', '2x2', 0, 0],
      ['A', 'd', '1x1', 2, 0],
      ['B', 'd', '1x1', 3, 1],
    )
    const plan = trySqueezePlace(g, 'DRAG', 2, 0, '2x2')
    expect(plan).not.toBeNull()
    const ids = new Set(plan!.moves.map(m => m.instanceId))
    expect(ids.has('A')).toBe(true)
    expect(ids.has('B')).toBe(true)
  })

  it('多米诺连锁：算法会给出可行连锁位移方案', () => {
    const g = setup(
      ['DRAG', 'd', '1x1', 0, 0],
      ['B1', 'd', '1x1', 2, 0],
      ['B2', 'd', '1x1', 3, 0],
      ['B3', 'd', '1x1', 4, 0],
      ['LOCK', 'd', '1x1', 1, 0],
    )
    const plan = trySqueezePlace(g, 'DRAG', 2, 0, '1x1')
    expect(plan).not.toBeNull()
    const ids = new Set(plan!.moves.map(m => m.instanceId))
    expect(ids.has('B1')).toBe(true)
  })

  it('row0 满但 row1 空时，拖拽到 row1 不受 row0 影响', () => {
    const g = new GridSystem(5)
    g.place(0, 0, '1x1', 'd', 'R0')
    g.place(1, 0, '1x1', 'd', 'R1')
    g.place(2, 0, '1x1', 'd', 'R2')
    g.place(3, 0, '1x1', 'd', 'R3')
    g.place(4, 0, '1x1', 'd', 'R4')
    g.place(0, 1, '1x1', 'd', 'DRAG')
    const plan = trySqueezePlace(g, 'DRAG', 2, 1, '1x1')
    expect(plan).not.toBeNull()
    expect(plan!.moves).toHaveLength(0)
  })
})

describe('SqueezeLogic — planUnifiedSqueeze (不同区域/可见列)', () => {
  it('同区可见列内可挤出时，返回 local 模式', () => {
    const target = setup(['DRAG', 'd', '1x1', 0, 0], ['B', 'd', '1x1', 2, 0])
    const plan = planUnifiedSqueeze(zone(target, 5), 2, 0, '1x1', 'DRAG')
    expect(plan).not.toBeNull()
    expect(plan!.mode).toBe('local')
  })

  it('active=2 且可在可见行内重排时，优先返回 local（不强制 cross）', () => {
    const target = setup(
      ['DRAG', 'd', '1x1', 4, 0],
      ['LOCK', 'd', '1x1', 0, 0],
      ['B', 'd', '1x1', 1, 0],
    )
    const plan = planUnifiedSqueeze(zone(target, 2), 1, 0, '1x1', 'DRAG')
    expect(plan).not.toBeNull()
    if (!plan) return
    expect(plan.mode).toBe('local')
  })

  it('即使提供 homeZone，只要 target 仍可 local 重排，就保持 local 优先', () => {
    const target = setup(
      ['DRAG', 'd', '1x1', 4, 0],
      ['LOCK', 'd', '1x1', 0, 0],
      ['B', 'd', '1x1', 1, 0],
    )
    const home = setup()
    const plan = planUnifiedSqueeze(zone(target, 2), 1, 0, '1x1', 'DRAG', zone(home, 5))
    expect(plan).not.toBeNull()
    if (!plan) return
    expect(plan.mode).toBe('local')
  })

  it('cross 模式会把 blocker 放到 homeZone 的第一个可见空位', () => {
    const target = setup(['DRAG', 'd', '2x2', 3, 0], ['BIG', 'd', '2x2', 0, 0])
    const home = setup(['H0', 'd', '1x1', 0, 0], ['H1', 'd', '1x1', 1, 0])
    const plan = planUnifiedSqueeze(zone(target, 2), 0, 0, '2x2', 'DRAG', zone(home, 5))
    expect(plan).not.toBeNull()
    if (!plan) return
    expect(plan.mode).toBe('cross')
    if (plan.mode === 'cross') {
      expect(plan.transfers[0]).toMatchObject({ instanceId: 'BIG', newCol: 2, newRow: 0 })
    }
  })

  it('homeZone 满但 target 可 local 重排时，仍返回 local', () => {
    const target = setup(['DRAG', 'd', '1x1', 4, 0], ['B', 'd', '1x1', 0, 0])
    const home = new GridSystem(5)
    for (let c = 0; c < 5; c++) {
      home.place(c, 0, '1x1', 'd', `R0-${c}`)
      home.place(c, 1, '1x1', 'd', `R1-${c}`)
    }
    // 新规则优先 local：row1 可见位可重排，不依赖 homeZone
    const plan = planUnifiedSqueeze(zone(target, 1), 0, 0, '1x1', 'DRAG', zone(home, 5))
    expect(plan).not.toBeNull()
    if (!plan) return
    expect(plan.mode).toBe('local')
  })

  it('目标区 activeColCount 过小 + 有 blocker 时，计划应返回 null（不可见落点）', () => {
    const target = setup(['DRAG', 'd', '2x2', 3, 0], ['B', 'd', '1x1', 0, 0])
    const plan = planUnifiedSqueeze(zone(target, 1), 0, 0, '2x2', 'DRAG')
    expect(plan).toBeNull()
  })

  it('不同区域互拖（battle -> backpack 模拟）：target 可见列约束生效', () => {
    const battle = setup(['DRAG', 'd', '1x2', 4, 0], ['B', 'd', '1x2', 1, 0])
    const backpack = setup(['H', 'd', '1x1', 0, 0])
    const plan = planUnifiedSqueeze(zone(battle, 2), 1, 0, '1x2', 'DRAG', zone(backpack, 5))
    // battle 仅 2 列，1x2 拖到 col=1 会占到 col=1，仅可行；但 blocker 无可见去处，需 cross 或失败
    if (plan) {
      expect(['local', 'cross']).toContain(plan.mode)
      if (plan.mode === 'local') {
        for (const m of plan.moves) {
          const moved = battle.getItem(m.instanceId)
          const w = moved?.size === '2x2' ? 2 : 1
          expect(m.newCol + w).toBeLessThanOrEqual(2)
        }
      }
    }
  })

  it('不同区域互拖（backpack -> battle 模拟）：home activeColCount 也会限制转移位置', () => {
    const target = setup(['DRAG', 'd', '1x1', 4, 0], ['B', 'd', '1x1', 1, 0])
    const home = setup()
    const plan = planUnifiedSqueeze(zone(target, 2), 1, 0, '1x1', 'DRAG', zone(home, 2))
    expect(plan).not.toBeNull()
    if (!plan) return
    if (plan.mode === 'cross') {
      for (const t of plan.transfers) {
        const moved = target.getItem(t.instanceId)
        const w = moved?.size === '2x2' ? 2 : 1
        expect(t.newCol + w).toBeLessThanOrEqual(2)
      }
    }
  })

  it('2x2 可见列内左右互换两个中型(1x2)时，local 方案应成立', () => {
    const target = setup(
      ['DRAG', 'd', '1x2', 0, 0],
      ['MID', 'd', '1x2', 1, 0],
    )
    const plan = planUnifiedSqueeze(zone(target, 2), 1, 0, '1x2', 'DRAG')
    expect(plan).not.toBeNull()
    if (!plan) return
    expect(plan.mode).toBe('local')
    if (plan.mode === 'local') {
      expect(plan.moves).toContainEqual({ instanceId: 'MID', newCol: 0, newRow: 0 })
    }
  })
})

describe('SqueezeLogic — planCrossZoneSwap (跨区互换兜底)', () => {
  it('拖拽 1x1：可与目标 1x1 互换到原位', () => {
    const home = setup(['DRAG', 'd', '1x1', 0, 0])
    const target = setup(['B', 'd', '1x1', 2, 0])
    const plan = planCrossZoneSwap(zone(target, 5), zone(home, 5), 2, 0, '1x1', 'DRAG', 0, 0, '1x1')
    expect(plan).not.toBeNull()
    expect(plan!.transfers).toContainEqual({ instanceId: 'B', newCol: 0, newRow: 0 })
  })

  it('拖拽 1x2：可与两个 1x1 互换到原 footprint', () => {
    const home = setup(['DRAG', 'd', '1x2', 1, 0])
    const target = setup(['A', 'd', '1x1', 2, 0], ['B', 'd', '1x1', 2, 1])
    const plan = planCrossZoneSwap(zone(target, 5), zone(home, 5), 2, 0, '1x2', 'DRAG', 1, 0, '1x2')
    expect(plan).not.toBeNull()
    if (!plan) return
    expect(plan.transfers).toHaveLength(2)
    for (const tr of plan.transfers) {
      expect(tr.newCol).toBe(1)
      expect([0, 1]).toContain(tr.newRow)
    }
  })

  it('拖拽 2x2：可与 1x2 + 1x1 混合互换到原 footprint', () => {
    const home = setup(['DRAG', 'd', '2x2', 0, 0])
    const target = setup(['M', 'd', '1x2', 2, 0], ['S', 'd', '1x1', 3, 1])
    const plan = planCrossZoneSwap(zone(target, 5), zone(home, 5), 2, 0, '2x2', 'DRAG', 0, 0, '2x2')
    expect(plan).not.toBeNull()
    if (!plan) return
    const ids = new Set(plan.transfers.map(t => t.instanceId))
    expect(ids.has('M')).toBe(true)
    expect(ids.has('S')).toBe(true)
    for (const tr of plan.transfers) {
      expect(tr.newCol).toBeGreaterThanOrEqual(0)
      expect(tr.newCol).toBeLessThanOrEqual(1)
      expect(tr.newRow).toBeGreaterThanOrEqual(0)
      expect(tr.newRow).toBeLessThanOrEqual(1)
    }
  })

  it('拖拽 1x1：目标为 1x2 时无法互换（原 footprint 放不下）', () => {
    const home = setup(['DRAG', 'd', '1x1', 0, 0])
    const target = setup(['M', 'd', '1x2', 2, 0])
    const plan = planCrossZoneSwap(zone(target, 5), zone(home, 5), 2, 0, '1x1', 'DRAG', 0, 0, '1x1')
    expect(plan).toBeNull()
  })
})
