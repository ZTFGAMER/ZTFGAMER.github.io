import { describe, it, expect } from 'vitest'
import { getConfig, getAllItems, getItemsByHero, validateData } from './DataLoader'
import { normalizeSize, parseTags } from '@/items/ItemDef'

describe('DataLoader — game_config.json', () => {
  it('读取 dailyGold 为 15', () => {
    expect(getConfig().dailyGold).toBe(15)
  })

  it('backpackSlots 为 6', () => {
    expect(getConfig().backpackSlots).toBe(6)
  })

  it('dailyBattleSlots 按 4/5/6 配置', () => {
    const slots = getConfig().dailyBattleSlots
    expect(slots).toHaveLength(3)
    expect(slots).toEqual([4, 5, 6])
  })

  it('shopRefreshPrices 有 10 级递增', () => {
    const prices = getConfig().shopRefreshPrices
    expect(prices).toHaveLength(10)
    expect(prices[0]).toBe(1)
    expect(prices[9]).toBe(10)
    // 验证递增
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeGreaterThan(prices[i - 1])
    }
  })

  it('sellPriceRatio 为 0.5', () => {
    expect(getConfig().sellPriceRatio).toBe(0.5)
  })

  it('小型物品价格有 4 个品质（铜/银/金/钻）', () => {
    const p = getConfig().smallItemPrices
    expect(p).toHaveLength(4)
    expect(p[0]).toBe(2)   // 铜 2 金
    expect(p[3]).toBe(16)  // 钻 16 金
  })

  it('shopTierChancesByDay 配置为 20 天并匹配预期关键节点', () => {
    const chances = getConfig().shopTierChancesByDay
    expect(chances).toHaveLength(20)
    expect(chances[0]).toEqual([100, 0, 0, 0])
    expect(chances[8]).toEqual([10, 40, 40, 10])
    expect(chances[9]).toEqual([0, 30, 50, 20])
    expect(chances[19]).toEqual([0, 30, 50, 20])
  })
})

describe('DataLoader — vanessa_items.json', () => {
  it('物品数量 > 0', () => {
    expect(getAllItems().length).toBeGreaterThan(0)
  })

  it('每个物品都有 id, name_cn, size', () => {
    getAllItems().forEach(item => {
      expect(item.id, `物品缺少 id`).toBeTruthy()
      expect(item.name_cn, `${item.id} 缺少 name_cn`).toBeTruthy()
      expect(item.size,    `${item.id} 缺少 size`).toBeTruthy()
    })
  })

  it('getItemsByHero("Vanessa") 筛选出 Vanessa 专属物品', () => {
    const all = getAllItems()
    const expected = all.filter(item => item.heroes.toLowerCase().includes('vanessa'))
    const items = getItemsByHero('Vanessa')
    expect(items).toEqual(expected)
  })

  it('包含三种尺寸物品', () => {
    const items = getAllItems()
    const sizes = new Set(items.map(i => normalizeSize(i.size)))
    expect(sizes.has('1x1')).toBe(true)
    expect(sizes.has('2x1')).toBe(true)
    expect(sizes.has('3x1')).toBe(true)
  })

  it('cooldown 均为非负数', () => {
    getAllItems().forEach(item => {
      expect(item.cooldown, `${item.name_cn} cooldown 非法`).toBeGreaterThanOrEqual(0)
    })
  })
})

describe('DataLoader — validateData()', () => {
  it('整体验证通过', () => {
    const { ok, report } = validateData()
    console.log('\n' + report)  // 直接打印到测试输出
    expect(ok).toBe(true)
  })
})

describe('ItemDef 工具函数', () => {
  it('normalizeSize 正确映射三种尺寸', () => {
    expect(normalizeSize('Small / 小型')).toBe('1x1')
    expect(normalizeSize('Medium / 中型')).toBe('2x1')
    expect(normalizeSize('Large / 大型')).toBe('3x1')
  })

  it('normalizeSize 遇到未知尺寸抛出错误', () => {
    expect(() => normalizeSize('Unknown')).toThrow()
  })

  it('parseTags 正确解析多标签', () => {
    const tags = parseTags('Aquatic / 水系 | Weapon / 武器 | Tool / 工具')
    expect(tags).toEqual(['Aquatic', 'Weapon', 'Tool'])
  })

  it('parseTags 处理空字符串', () => {
    expect(parseTags('')).toEqual([])
  })
})
