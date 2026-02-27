import type { SceneName } from '@/core/EventBus'

export type GamePhase = 'SHOP' | 'COMBAT' | 'REWARD'

type PhaseListener = (phase: GamePhase, prev: GamePhase) => void

function toPhase(scene: SceneName): GamePhase {
  if (scene === 'shop') return 'SHOP'
  if (scene === 'battle') return 'COMBAT'
  return 'REWARD'
}

class PhaseManagerImpl {
  private phase: GamePhase = 'SHOP'
  private listeners = new Set<PhaseListener>()

  getPhase(): GamePhase {
    return this.phase
  }

  setPhase(next: GamePhase): void {
    if (this.phase === next) return
    const prev = this.phase
    this.phase = next
    for (const cb of this.listeners) cb(next, prev)
  }

  setPhaseByScene(scene: SceneName): void {
    this.setPhase(toPhase(scene))
  }

  isShopInputEnabled(): boolean {
    return this.phase === 'SHOP'
  }

  onChange(cb: PhaseListener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  resetForTests(): void {
    this.phase = 'SHOP'
    this.listeners.clear()
  }
}

export const PhaseManager = new PhaseManagerImpl()
