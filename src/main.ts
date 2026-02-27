// ============================================================
// main.ts — 游戏入口
// 初始化 PixiJS → 注册场景 → 启动第一个场景
// ============================================================

import { Application } from 'pixi.js'
import { SceneManager } from '@/scenes/SceneManager'
import { ShopScene }    from '@/scenes/ShopScene'
import { BattleScene }  from '@/scenes/BattleScene'
import { validateData } from '@/core/DataLoader'
import { setApp }       from '@/core/AppContext'
import { clearStoredConfig } from '@/config/debugConfig'
import { PhaseManager, type GamePhase } from '@/core/PhaseManager'

// 基准分辨率（单格 128px × 5列 = 640，等比对应 390×844 物理屏）
const BASE_W = 640
const BASE_H = 1384

function showFatalError(message: string): void {
  const body = document.body
  if (!body) return
  body.innerHTML = ''
  const box = document.createElement('pre')
  box.style.whiteSpace = 'pre-wrap'
  box.style.padding = '16px'
  box.style.color = '#ffb4b4'
  box.style.background = '#190f16'
  box.style.fontSize = '14px'
  box.style.lineHeight = '1.4'
  box.textContent = `启动失败\n${message}`
  body.appendChild(box)
}

async function bootstrap(): Promise<void> {
  if (window.location.protocol === 'app:') {
    clearStoredConfig()
  }

  // 1. 验证数据完整性
  const { ok, report } = validateData()
  console.log('\n=== 数据验证 ===\n' + report)
  if (!ok) {
    console.error('数据验证失败，游戏无法启动')
    showFatalError(report)
    return
  }

  // 2. 初始化 PixiJS Application（WebGPU 优先，不支持时自动回退 WebGL）
  const app = new Application()
  await app.init({
    preference:      'webgpu',
    width:           BASE_W,
    height:          BASE_H,
    backgroundColor: 0x1a1a2e,
    resolution:      window.devicePixelRatio || 1,
    autoDensity:     true,
    antialias:       true,
  })
  console.log(`   渲染后端: ${app.renderer.type === 2 ? 'WebGPU' : 'WebGL'}`)
  setApp(app)

  // 3. 挂载 Canvas
  const container = document.getElementById('app')!
  container.appendChild(app.canvas as HTMLCanvasElement)

  // 4. 竖屏适配（保持比例，居中显示）
  function resize(): void {
    const scaleX = window.innerWidth  / BASE_W
    const scaleY = window.innerHeight / BASE_H
    const scale  = Math.min(scaleX, scaleY)
    const canvas  = app.canvas as HTMLCanvasElement
    canvas.style.width  = `${BASE_W * scale}px`
    canvas.style.height = `${BASE_H * scale}px`
    canvas.style.display = 'block'
    canvas.style.margin  = 'auto'
  }
  window.addEventListener('resize', resize)
  resize()

  // 5. 注册场景 & 启动
  SceneManager.register(ShopScene)
  SceneManager.register(BattleScene)
  SceneManager.goto('shop')

  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    ;(window as Window & {
      __setGamePhase?: (phase: GamePhase) => void
      __getGamePhase?: () => GamePhase
    }).__setGamePhase = (phase: GamePhase) => {
      PhaseManager.setPhase(phase)
      console.log(`[Debug] phase -> ${PhaseManager.getPhase()}`)
    }
    ;(window as Window & {
      __setGamePhase?: (phase: GamePhase) => void
      __getGamePhase?: () => GamePhase
    }).__getGamePhase = () => PhaseManager.getPhase()
  }

  // 6. 接入 PixiJS Ticker（取代手写 RAF）
  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000
    SceneManager.update(dt)
  })

  console.log(`\n✅ 游戏启动成功 (${BASE_W}×${BASE_H}, 分辨率x${window.devicePixelRatio})`)
  console.log('   当前场景:', SceneManager.currentName())
}

bootstrap().catch((err) => {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
  console.error(err)
  showFatalError(msg)
})
