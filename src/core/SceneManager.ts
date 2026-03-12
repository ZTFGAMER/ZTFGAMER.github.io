// ============================================================
// SceneManager — 场景切换框架
// 管理 ShopScene ↔ BattleScene 的生命周期
// ============================================================

import { EventBus, type SceneName } from '@/core/EventBus'
import { PhaseManager } from '@/core/PhaseManager'

export interface Scene {
  name:    SceneName
  onEnter(): void
  onExit():  void
  update(dt: number): void
}

class SceneManagerImpl {
  private current: Scene | null = null
  private registry = new Map<SceneName, Scene>()

  register(scene: Scene): void {
    this.registry.set(scene.name, scene)
  }

  goto(name: SceneName): void {
    const prev = this.current?.name ?? null
    if (this.current) {
      this.current.onExit()
      // 不在这里 clear EventBus：各场景在 onExit() 中自行取消订阅
    }

    const next = this.registry.get(name)
    if (!next) throw new Error(`[SceneManager] Scene not registered: ${name}`)

    PhaseManager.setPhaseByScene(name)
    this.current = next
    this.current.onEnter()

    if (prev) {
      EventBus.emit('game:scene_change', {
        from: prev as SceneName,
        to:   name,
      })
    }
  }

  update(dt: number): void {
    this.current?.update(dt)
  }

  currentName(): SceneName | null {
    return this.current?.name ?? null
  }

  /** 已注册场景数（用于测试） */
  registeredCount(): number {
    return this.registry.size
  }
}

export const SceneManager = new SceneManagerImpl()
