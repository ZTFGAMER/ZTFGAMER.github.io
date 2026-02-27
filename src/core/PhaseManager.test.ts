import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PhaseManager } from './PhaseManager'

beforeEach(() => {
  PhaseManager.resetForTests()
})

describe('PhaseManager', () => {
  it('默认处于 SHOP 阶段且允许商店输入', () => {
    expect(PhaseManager.getPhase()).toBe('SHOP')
    expect(PhaseManager.isShopInputEnabled()).toBe(true)
  })

  it('setPhase 会更新阶段并触发监听', () => {
    const handler = vi.fn()
    PhaseManager.onChange(handler)

    PhaseManager.setPhase('COMBAT')

    expect(PhaseManager.getPhase()).toBe('COMBAT')
    expect(PhaseManager.isShopInputEnabled()).toBe(false)
    expect(handler).toHaveBeenCalledWith('COMBAT', 'SHOP')
  })

  it('设置同一阶段不会重复触发监听', () => {
    const handler = vi.fn()
    PhaseManager.onChange(handler)

    PhaseManager.setPhase('SHOP')

    expect(handler).not.toHaveBeenCalled()
  })

  it('setPhaseByScene 按场景映射阶段', () => {
    PhaseManager.setPhaseByScene('battle')
    expect(PhaseManager.getPhase()).toBe('COMBAT')

    PhaseManager.setPhaseByScene('result')
    expect(PhaseManager.getPhase()).toBe('REWARD')
  })
})
