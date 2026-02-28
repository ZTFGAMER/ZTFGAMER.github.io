// ============================================================
// main.ts — 游戏入口
// 初始化 PixiJS → 注册场景 → 启动第一个场景
// ============================================================

import { Application } from 'pixi.js'
import { SceneManager } from '@/scenes/SceneManager'
import { ShopScene }    from '@/scenes/ShopScene'
import { BattleScene }  from '@/scenes/BattleScene'
import { validateData } from '@/core/DataLoader'
import { setApp, setStageLayout } from '@/core/AppContext'
import { clearStoredConfig } from '@/config/debugConfig'
import { PhaseManager, type GamePhase } from '@/core/PhaseManager'
import { Rectangle } from 'pixi.js'

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
    width:           window.innerWidth,
    height:          window.innerHeight,
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

  // 4. 适配（Canvas 全屏，stage 等比缩放并居中）
  function resize(): void {
    const vw = Math.max(1, Math.floor(window.innerWidth))
    const vh = Math.max(1, Math.floor(window.innerHeight))
    app.renderer.resize(vw, vh)

    const scaleX = vw / BASE_W
    const scaleY = vh / BASE_H
    const scale  = Math.min(scaleX, scaleY)

    const offsetX = (vw - BASE_W * scale) / 2
    const offsetY = (vh - BASE_H * scale) / 2

    // 将设计坐标系缩放并居中到全屏 renderer 内
    app.stage.scale.set(scale)
    app.stage.position.set(offsetX, offsetY)

    // stage 在设计坐标系下可交互的区域：覆盖可视区域（含左右/上下留白）
    const bleedX = offsetX / scale
    const bleedY = offsetY / scale
    app.stage.eventMode = 'static'
    app.stage.hitArea = new Rectangle(-bleedX, -bleedY, BASE_W + bleedX * 2, BASE_H + bleedY * 2)

    setStageLayout({
      baseW: BASE_W,
      baseH: BASE_H,
      viewW: vw,
      viewH: vh,
      scale,
      offsetX,
      offsetY,
      bleedX,
      bleedY,
    })

    const canvas = app.canvas as HTMLCanvasElement
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
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
