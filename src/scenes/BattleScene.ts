import type { Scene } from './SceneManager'

export const BattleScene: Scene = {
  name: 'battle',
  onEnter() {
    console.log('[BattleScene] 进入战斗场景')
    // TODO Phase 3: 启动战斗引擎
  },
  onExit() {
    console.log('[BattleScene] 离开战斗场景')
  },
  update(_dt: number) {
    // TODO Phase 3: 委托给 BattleEngine.update(dt)
  },
}
