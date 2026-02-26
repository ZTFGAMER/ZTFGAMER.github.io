import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventBus } from './EventBus'

beforeEach(() => { EventBus.clear() })

describe('EventBus — 基础订阅/发布', () => {
  it('emit 触发对应监听器', () => {
    const handler = vi.fn()
    EventBus.on('shop:gold_changed', handler)
    EventBus.emit('shop:gold_changed', { gold: 10, delta: -5 })
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith({ gold: 10, delta: -5 })
  })

  it('多个监听器都被触发', () => {
    const h1 = vi.fn(), h2 = vi.fn()
    EventBus.on('battle:unit_die', h1)
    EventBus.on('battle:unit_die', h2)
    EventBus.emit('battle:unit_die', { unitId: 'u1', side: 'enemy' })
    expect(h1).toHaveBeenCalledOnce()
    expect(h2).toHaveBeenCalledOnce()
  })

  it('off 取消订阅后不再触发', () => {
    const handler = vi.fn()
    EventBus.on('shop:item_bought', handler)
    EventBus.off('shop:item_bought', handler)
    EventBus.emit('shop:item_bought', { itemId: 'x', cost: 2 })
    expect(handler).not.toHaveBeenCalled()
  })

  it('on 返回的取消函数有效', () => {
    const handler = vi.fn()
    const unsub = EventBus.on('shop:refresh', handler)
    unsub()
    EventBus.emit('shop:refresh', { cost: 3 })
    expect(handler).not.toHaveBeenCalled()
  })

  it('clear 后所有监听器被移除', () => {
    const handler = vi.fn()
    EventBus.on('battle:take_damage', handler)
    expect(EventBus.listenerCount('battle:take_damage')).toBe(1)
    EventBus.clear()
    expect(EventBus.listenerCount('battle:take_damage')).toBe(0)
  })

  it('listenerCount 返回正确数量', () => {
    EventBus.on('game:day_start', vi.fn())
    EventBus.on('game:day_start', vi.fn())
    expect(EventBus.listenerCount('game:day_start')).toBe(2)
  })
})
