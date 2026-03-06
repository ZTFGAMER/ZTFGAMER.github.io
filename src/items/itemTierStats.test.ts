import { describe, it, expect } from 'vitest'
import { getAllItems } from '@/core/DataLoader'
import { resolveItemTierBaseStats } from './itemTierStats'

describe('itemTierStats', () => {
  it('resolves base stats by tier safely', () => {
    const sword = getAllItems().find((it) => it.id === 'ab108c45-bd0b-4129-8b92-19d17c798164')
    expect(sword).toBeTruthy()
    if (!sword) return

    const bronze = resolveItemTierBaseStats(sword, 'Bronze').damage
    const silver = resolveItemTierBaseStats(sword, 'Silver').damage
    expect(bronze).toBeGreaterThan(0)
    expect(silver).toBeGreaterThan(0)
  })

  it('parses multicast from 连续发射 text', () => {
    const shuriken = getAllItems().find((it) => it.id === '4e61c6f3-4d31-4b29-97fb-691537b3a3a0')
    expect(shuriken).toBeTruthy()
    if (!shuriken) return

    expect(resolveItemTierBaseStats(shuriken, 'Bronze').multicast).toBe(3)
  })

  it('maps Bronze starter lv3 to the 3rd tier value', () => {
    const bow = getAllItems().find((it) => it.name_cn === '木弓')
    expect(bow).toBeTruthy()
    if (!bow) return

    expect(resolveItemTierBaseStats(bow, 'Silver#1').damage).toBe(150)
  })

  it('maps Silver starter lv5 to the 3rd tier value', () => {
    const boomerang = getAllItems().find((it) => it.name_cn === '回旋镖')
    expect(boomerang).toBeTruthy()
    if (!boomerang) return

    expect(resolveItemTierBaseStats(boomerang, 'Gold#1').damage).toBe(65)
  })
})
