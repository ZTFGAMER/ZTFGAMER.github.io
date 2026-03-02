import { describe, it, expect, vi } from 'vitest'
import { ShopManager } from './ShopManager'
import { getConfig } from '@/core/DataLoader'
import type { ItemDef } from '@/items/ItemDef'

function mkItem(id: string, name: string, tags: string, skills: string[]): ItemDef {
  return {
    id,
    name_en: name,
    name_cn: name,
    type: 'Item / 物品',
    size: 'Small / 小型',
    starting_tier: 'Bronze / 青铜',
    available_tiers: 'Bronze',
    heroes: '',
    tags,
    hidden_tags: '',
    cooldown: 3000,
    cooldown_tiers: '3000',
    damage: 0,
    heal: 0,
    shield: 0,
    ammo: 0,
    crit: 0,
    multicast: 1,
    burn: 0,
    poison: 0,
    regen: 0,
    lifesteal: 0,
    buy_price: 0,
    sell_price: 0,
    skills: skills.map((cn) => ({ cn, en: '' })),
    enchantments: {},
  }
}

describe('ShopManager custom rules', () => {
  it('ammo support items require owned ammo item', () => {
    const cfg = {
      ...getConfig(),
      shopTierChancesByDay: [[100, 0, 0, 0]],
      shopRules: {
        ammoSupportRequiresAmmoOwned: true,
        ammoSupportItemNames: ['弹药袋'],
        day1ThirdItemMatchExistingArchetype: false,
      },
    }
    const items: ItemDef[] = [
      mkItem('a1', '短剑', '战士', ['攻击造成10伤害。']),
      mkItem('a2', '木弓', '弓手', ['攻击造成10伤害。', '弹药:2。']),
      mkItem('a3', '弹药袋', '弓手', ['使用时给相邻的物品补充1发弹药。']),
      mkItem('a4', '回旋镖', '刺客', ['攻击造成10伤害。']),
    ]

    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const m1 = new ShopManager(cfg, items, 1)
    expect(m1.pool.some((s) => s.item.name_cn === '弹药袋')).toBe(false)

    m1.setOwnedTiers(new Map([['a2', 'Bronze']]))
    m1.refresh()
    expect(m1.pool.some((s) => s.item.name_cn === '弹药袋')).toBe(true)
    spy.mockRestore()
  })

  it('day1 initial third item matches first two archetypes', () => {
    const cfg = {
      ...getConfig(),
      shopTierChancesByDay: [[100, 0, 0, 0]],
      shopRules: {
        ammoSupportRequiresAmmoOwned: false,
        ammoSupportItemNames: [],
        day1ThirdItemMatchExistingArchetype: true,
      },
    }
    const items: ItemDef[] = [
      mkItem('b1', '战A', '战士', ['攻击造成10伤害。']),
      mkItem('b2', '弓B', '弓手', ['攻击造成10伤害。']),
      mkItem('b3', '刺C', '刺客', ['攻击造成10伤害。']),
      mkItem('b4', '战D', '战士', ['攻击造成10伤害。']),
    ]
    const seq = [0, 0, 0, 0, 0, 0]
    let idx = 0
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => seq[idx++] ?? 0)

    const m = new ShopManager(cfg, items, 1)
    expect(m.pool.length).toBe(3)
    const a1 = (m.pool[0]?.item.tags ?? '').split(/[，,\/\s]+/).filter(Boolean)[0]
    const a2 = (m.pool[1]?.item.tags ?? '').split(/[，,\/\s]+/).filter(Boolean)[0]
    const a3 = (m.pool[2]?.item.tags ?? '').split(/[，,\/\s]+/).filter(Boolean)[0]
    expect(new Set([a1, a2]).has(a3)).toBe(true)
    spy.mockRestore()
  })

  it('prefers small items over medium around 2:1', () => {
    const cfg = {
      ...getConfig(),
      shopTierChancesByDay: [[100, 0, 0, 0]],
      shopRules: {
        ammoSupportRequiresAmmoOwned: false,
        ammoSupportItemNames: [],
        day1ThirdItemMatchExistingArchetype: false,
        shopSizeWeights: { small: 2, medium: 1, large: 1 },
      },
    }
    const items: ItemDef[] = [
      mkItem('s1', '小1', '战士', ['攻击造成10伤害。']),
      mkItem('s2', '小2', '弓手', ['攻击造成10伤害。']),
      mkItem('s3', '小3', '刺客', ['攻击造成10伤害。']),
      { ...mkItem('m1', '中1', '战士', ['攻击造成10伤害。']), size: 'Medium / 中型' },
      { ...mkItem('m2', '中2', '弓手', ['攻击造成10伤害。']), size: 'Medium / 中型' },
      { ...mkItem('m3', '中3', '刺客', ['攻击造成10伤害。']), size: 'Medium / 中型' },
    ]

    let small = 0
    let medium = 0
    for (let i = 0; i < 200; i++) {
      const m = new ShopManager(cfg, items, 2)
      for (const slot of m.pool) {
        if (slot.item.size.includes('Small')) small += 1
        if (slot.item.size.includes('Medium')) medium += 1
      }
    }
    expect(small).toBeGreaterThan(medium)
    expect(small / Math.max(1, medium)).toBeGreaterThan(1.5)
  })
})
