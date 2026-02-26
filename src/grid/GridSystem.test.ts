import { describe, it, expect, beforeEach } from 'vitest'
import { GridSystem } from './GridSystem'

describe('GridSystem', () => {
  let g: GridSystem

  beforeEach(() => { g = new GridSystem(5) })

  // ---- canPlace ----
  describe('canPlace', () => {
    it('空格可放置 1x1', () => {
      expect(g.canPlace(0, 0, '1x1')).toBe(true)
      expect(g.canPlace(4, 1, '1x1')).toBe(true)
    })

    it('越界返回 false', () => {
      expect(g.canPlace(-1, 0, '1x1')).toBe(false)
      expect(g.canPlace(5,  0, '1x1')).toBe(false)
      expect(g.canPlace(0,  2, '1x1')).toBe(false)
      expect(g.canPlace(4,  0, '2x2')).toBe(false)  // 需要第 5 列
      expect(g.canPlace(0,  1, '1x2')).toBe(false)  // 需要第 2 行
    })

    it('已占用格子返回 false', () => {
      g.place(2, 0, '1x1', 'def', 'A')
      expect(g.canPlace(2, 0, '1x1')).toBe(false)
    })

    it('1x2 只能从 row=0 放', () => {
      expect(g.canPlace(0, 0, '1x2')).toBe(true)
      expect(g.canPlace(0, 1, '1x2')).toBe(false)
    })

    it('2x2 在右边界刚好放/越界', () => {
      expect(g.canPlace(3, 0, '2x2')).toBe(true)   // 占 col 3,4
      expect(g.canPlace(4, 0, '2x2')).toBe(false)  // 需要 col 5
    })
  })

  // ---- canPlaceExcluding ----
  describe('canPlaceExcluding', () => {
    it('排除自身后可检测原位置', () => {
      g.place(2, 0, '1x1', 'def', 'A')
      // 不排除 → 被占
      expect(g.canPlace(2, 0, '1x1')).toBe(false)
      // 排除 A → 视为空
      expect(g.canPlaceExcluding(2, 0, '1x1', 'A')).toBe(true)
    })

    it('其他物品仍然阻挡', () => {
      g.place(2, 0, '1x1', 'def', 'A')
      g.place(3, 0, '1x1', 'def', 'B')
      expect(g.canPlaceExcluding(3, 0, '1x1', 'A')).toBe(false)
    })
  })

  // ---- place / remove ----
  describe('place and remove', () => {
    it('放置后可查到物品信息', () => {
      g.place(1, 0, '1x1', 'def-a', 'A')
      expect(g.getItem('A')).toEqual({ instanceId: 'A', defId: 'def-a', size: '1x1', col: 1, row: 0 })
    })

    it('1x2 占满两行', () => {
      g.place(2, 0, '1x2', 'def', 'B')
      expect(g.canPlace(2, 0, '1x1')).toBe(false)
      expect(g.canPlace(2, 1, '1x1')).toBe(false)
    })

    it('2x2 占满 4 格', () => {
      g.place(1, 0, '2x2', 'def', 'C')
      expect(g.canPlace(1, 0, '1x1')).toBe(false)
      expect(g.canPlace(1, 1, '1x1')).toBe(false)
      expect(g.canPlace(2, 0, '1x1')).toBe(false)
      expect(g.canPlace(2, 1, '1x1')).toBe(false)
      expect(g.canPlace(0, 0, '1x1')).toBe(true)  // 左侧未占
    })

    it('remove 后格子释放', () => {
      g.place(1, 0, '1x2', 'def', 'D')
      g.remove('D')
      expect(g.canPlace(1, 0, '1x2')).toBe(true)
      expect(g.getItem('D')).toBeUndefined()
    })

    it('重复 remove 返回 false', () => {
      g.place(0, 0, '1x1', 'def', 'E')
      expect(g.remove('E')).toBe(true)
      expect(g.remove('E')).toBe(false)
    })

    it('不可放则 place 返回 false', () => {
      g.place(0, 0, '1x1', 'def', 'F')
      expect(g.place(0, 0, '1x1', 'def', 'G')).toBe(false)
      expect(g.getItem('G')).toBeUndefined()
    })
  })

  // ---- getAdjacentItems ----
  describe('getAdjacentItems', () => {
    it('孤立物品无相邻', () => {
      g.place(2, 0, '1x1', 'def', 'A')
      expect(g.getAdjacentItems('A')).toHaveLength(0)
    })

    it('1x1 找到左右邻居', () => {
      g.place(1, 0, '1x1', 'def', 'L')
      g.place(2, 0, '1x1', 'def', 'M')
      g.place(3, 0, '1x1', 'def', 'R')
      expect(g.getAdjacentItems('M')).toContain('L')
      expect(g.getAdjacentItems('M')).toContain('R')
      expect(g.getAdjacentItems('M')).toHaveLength(2)
    })

    it('同列不同行不算相邻', () => {
      g.place(2, 0, '1x1', 'def', 'T')
      g.place(2, 1, '1x1', 'def', 'B')
      expect(g.getAdjacentItems('T')).not.toContain('B')
      expect(g.getAdjacentItems('B')).not.toContain('T')
    })

    it('1x2 跨两行，左右邻居去重', () => {
      // inst-left 是 1x2 占 col1 全两行
      // inst-mid  是 1x2 占 col2 全两行
      // left 在 col2 的两行邻居中出现两次，应去重为 1
      g.place(1, 0, '1x2', 'def', 'Left')
      g.place(2, 0, '1x2', 'def', 'Mid')
      const adj = g.getAdjacentItems('Mid')
      expect(adj).toContain('Left')
      expect(adj.filter(x => x === 'Left')).toHaveLength(1) // 确保去重
    })

    it('2x2 找到左右整列邻居', () => {
      g.place(0, 0, '1x2', 'def', 'Left')   // col 0
      g.place(1, 0, '2x2', 'def', 'Big')    // col 1-2
      g.place(3, 0, '1x2', 'def', 'Right')  // col 3
      const adj = g.getAdjacentItems('Big')
      expect(adj).toContain('Left')
      expect(adj).toContain('Right')
      expect(adj).toHaveLength(2)
    })

    it('不存在的 instanceId 返回空数组', () => {
      expect(g.getAdjacentItems('ghost')).toHaveLength(0)
    })
  })

  // ---- clear ----
  it('clear 后所有格子为空', () => {
    g.place(0, 0, '2x2', 'def', 'A')
    g.place(3, 0, '1x2', 'def', 'B')
    g.clear()
    expect(g.getAllItems()).toHaveLength(0)
    expect(g.canPlace(0, 0, '2x2')).toBe(true)
  })
})
