// ============================================================
// GameLoop — 固定时间步主循环（Fix Your Timestep）
// 逻辑帧 60FPS，渲染帧跟随 requestAnimationFrame
// 防止"死亡螺旋"：单帧最大时间 250ms
// ============================================================

import { SceneManager } from '@/scenes/SceneManager'

const FIXED_DT      = 1 / 60        // 逻辑步长 ≈16.67ms
const MAX_FRAME_TIME = 0.25          // 防死亡螺旋

let running       = false
let currentTime   = 0
let accumulator   = 0
let rafHandle     = 0

function loop(timestamp: number): void {
  const newTime   = timestamp / 1000
  let   frameTime = newTime - currentTime

  if (frameTime > MAX_FRAME_TIME) frameTime = MAX_FRAME_TIME
  currentTime  = newTime
  accumulator += frameTime

  // 消耗累加器 → 固定步长逻辑更新
  while (accumulator >= FIXED_DT) {
    SceneManager.update(FIXED_DT)
    accumulator -= FIXED_DT
  }

  // 渲染插值因子（供 PixiJS 渲染层使用）
  // const alpha = accumulator / FIXED_DT

  if (running) rafHandle = requestAnimationFrame(loop)
}

export const GameLoop = {
  start(): void {
    if (running) return
    running     = true
    currentTime = performance.now() / 1000
    accumulator = 0
    rafHandle   = requestAnimationFrame(loop)
  },

  stop(): void {
    running = false
    cancelAnimationFrame(rafHandle)
  },

  isRunning(): boolean {
    return running
  },
}
