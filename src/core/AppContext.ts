// ============================================================
// AppContext — PixiJS Application 全局单例访问器
// 在 main.ts bootstrap() 中调用 setApp()，场景中通过 getApp() 取用
// ============================================================

import type { Application } from 'pixi.js'

let _app: Application | null = null

export type StageLayout = {
  baseW: number
  baseH: number
  viewW: number
  viewH: number
  scale: number
  offsetX: number
  offsetY: number
  bleedX: number
  bleedY: number
}

let _layout: StageLayout | null = null

export function setApp(app: Application): void {
  _app = app
}

export function getApp(): Application {
  if (!_app) throw new Error('[AppContext] App not initialized. Call setApp() first.')
  return _app
}

export function setStageLayout(layout: StageLayout): void {
  _layout = layout
}

export function getStageLayout(): StageLayout {
  if (!_layout) {
    // bootstrap() resize 前不应读取
    throw new Error('[AppContext] StageLayout not initialized. Call setStageLayout() first.')
  }
  return _layout
}
