import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SceneManager, type Scene } from './SceneManager'
import { EventBus } from '@/core/EventBus'

function makeScene(name: 'shop' | 'battle'): Scene & { enterCount: number; exitCount: number } {
  return {
    name,
    enterCount: 0,
    exitCount:  0,
    onEnter() { this.enterCount++ },
    onExit()  { this.exitCount++ },
    update(_dt: number) {},
  }
}

beforeEach(() => {
  // 每次测试前重置 SceneManager 内部状态
  // 通过重新注册覆盖
  EventBus.clear()
})

describe('SceneManager — 场景切换', () => {
  it('注册场景后 registeredCount 正确', () => {
    const mgr = SceneManager
    const s1 = makeScene('shop')
    const s2 = makeScene('battle')
    mgr.register(s1)
    mgr.register(s2)
    expect(mgr.registeredCount()).toBeGreaterThanOrEqual(2)
  })

  it('goto 调用 onEnter，currentName 更新', () => {
    const shop = makeScene('shop')
    SceneManager.register(shop)
    SceneManager.goto('shop')
    expect(SceneManager.currentName()).toBe('shop')
    expect(shop.enterCount).toBe(1)
  })

  it('场景切换时旧场景 onExit 被调用', () => {
    const shop   = makeScene('shop')
    const battle = makeScene('battle')
    SceneManager.register(shop)
    SceneManager.register(battle)

    SceneManager.goto('shop')
    SceneManager.goto('battle')

    expect(shop.exitCount).toBe(1)
    expect(battle.enterCount).toBe(1)
    expect(SceneManager.currentName()).toBe('battle')
  })

  it('goto 不存在的场景抛出错误', () => {
    // 强制转型测试错误路径
    expect(() => SceneManager.goto('result' as 'shop')).toThrow()
  })

  it('goto 触发 game:scene_change 事件', () => {
    const shop   = makeScene('shop')
    const battle = makeScene('battle')
    SceneManager.register(shop)
    SceneManager.register(battle)

    // 先 goto('shop')：如果有旧场景会触发 EventBus.clear()
    // 所以 handler 必须在 goto('shop') 之后注册
    SceneManager.goto('shop')

    const handler = vi.fn()
    EventBus.on('game:scene_change', handler)

    SceneManager.goto('battle')  // 从 shop → battle，发事件

    expect(handler).toHaveBeenCalledWith({ from: 'shop', to: 'battle' })
  })
})
