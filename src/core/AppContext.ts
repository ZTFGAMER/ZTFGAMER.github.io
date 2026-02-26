// ============================================================
// AppContext — PixiJS Application 全局单例访问器
// 在 main.ts bootstrap() 中调用 setApp()，场景中通过 getApp() 取用
// ============================================================

import type { Application } from 'pixi.js'

let _app: Application | null = null

export function setApp(app: Application): void {
  _app = app
}

export function getApp(): Application {
  if (!_app) throw new Error('[AppContext] App not initialized. Call setApp() first.')
  return _app
}
