import { describe, it, expect } from 'vitest'
import { getConfig, getAllItems, getItemsByHero, validateData } from './DataLoader'
import { normalizeSize, parseTags } from '@/items/ItemDef'

describe('DataLoader — game_config.json', () => {
  it('读取 dailyGold 为 6', () => {
    expect(getConfig().dailyGold).toBe(6)
  })

  it('dailyGoldByDay 配置为 20 天且逐日不下降', () => {
    const byDay = getConfig().dailyGoldByDay
    expect(byDay).toBeTruthy()
    expect(byDay).toHaveLength(20)
    for (let i = 1; i < (byDay?.length ?? 0); i++) {
      expect(byDay![i]).toBeGreaterThanOrEqual(byDay![i - 1]!)
    }
  })

  it('backpackSlots 为 6', () => {
    expect(getConfig().backpackSlots).toBe(6)
  })

  it('dailyBattleSlots 固定 5 格配置', () => {
    const slots = getConfig().dailyBattleSlots
    expect(slots).toHaveLength(3)
    expect(slots).toEqual([5, 5, 5])
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

  it('shopTierChancesByDay 配置存在（兼容旧配置）', () => {
    const chances = getConfig().shopTierChancesByDay
    expect(chances.length).toBeGreaterThanOrEqual(1)
    expect(chances[0]).toEqual([100, 0, 0, 0])
  })

  it('shopRules 已配置初始解锁池与起始品质权重', () => {
    const rules = getConfig().shopRules
    expect(rules?.initialUnlocksByStarterClass?.swordsman?.length).toBe(2)
    expect(rules?.initialUnlocksByStarterClass?.archer?.length).toBe(2)
    expect(rules?.initialUnlocksByStarterClass?.assassin?.length).toBe(2)
    expect(rules?.unlockStartingTierWeights?.Bronze).toBe(75)
    expect(rules?.unlockStartingTierWeights?.Silver).toBe(20)
    expect(rules?.unlockStartingTierWeights?.Gold).toBe(4)
    expect(rules?.unlockStartingTierWeights?.Diamond).toBe(1)
  })

  it('shopRules 已配置按关卡的 lv1~lv7 概率表', () => {
    const rows = getConfig().shopRules?.quickBuyLevelChancesByDay
    expect(rows).toBeTruthy()
    expect(rows).toHaveLength(20)
    expect(rows?.[0]).toEqual([1, 0, 0, 0, 0, 0, 0])
    expect(rows?.[19]).toEqual([0.05, 0.95, 0, 0, 0, 0, 0])
  })

  it('敌我 daily health 都配置为 20 天', () => {
    const cfg = getConfig()
    expect(cfg.dailyEnemyHealth).toBeTruthy()
    expect(cfg.dailyPlayerHealth).toBeTruthy()
    expect(cfg.dailyEnemyHealth).toHaveLength(20)
    expect(cfg.dailyPlayerHealth).toHaveLength(20)
  })

  it('skillSystem 已配置偶数日三选一', () => {
    const skill = getConfig().skillSystem
    expect(skill).toBeTruthy()
    expect(skill?.chooseCount).toBe(3)
    expect(skill?.triggerDaysByTier.bronze).toEqual([2, 4])
    expect(skill?.triggerDaysByTier.silver).toEqual([6, 8])
    expect(skill?.triggerDaysByTier.gold).toEqual([10, 14])
    expect((skill?.pools.bronze.length ?? 0)).toBeGreaterThanOrEqual(3)
    expect((skill?.pools.silver.length ?? 0)).toBeGreaterThanOrEqual(3)
    expect((skill?.pools.gold.length ?? 0)).toBeGreaterThanOrEqual(3)
  })

  it('shopRules 已配置最低品质掉落权重矩阵', () => {
    const m = getConfig().shopRules?.minTierDropWeightsByResultLevel
    expect(m).toBeTruthy()
    expect(m?.Bronze).toHaveLength(7)
    expect(m?.Silver).toHaveLength(7)
    expect(m?.Gold).toHaveLength(7)
    expect(m?.Diamond).toHaveLength(7)
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

  it('紧凑模式下物品尺寸符合模式配置', () => {
    const items = getAllItems()
    const sizes = new Set(items.map(i => normalizeSize(i.size)))
    const compact = getConfig().gameplayModeValues?.compactMode
    if (compact?.enabled && compact.itemSet === 'compact') {
      expect(sizes.size).toBe(1)
      expect(sizes.has('1x1')).toBe(true)
    } else {
      expect(sizes.has('1x1')).toBe(true)
      expect(sizes.has('2x1')).toBe(true)
    }
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
