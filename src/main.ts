// ============================================================
// main.ts — 游戏入口
// 初始化 PixiJS → 注册场景 → 启动第一个场景
// ============================================================

import { Application, Assets, Sprite, Texture } from 'pixi.js'
import { SceneManager } from '@/scenes/SceneManager'
import { ShopScene }    from '@/scenes/ShopScene'
import { BattleScene, getBattleFxPerfStats }  from '@/scenes/BattleScene'
import { MenuScene }    from '@/scenes/MenuScene'
import { PvpLobbyScene } from '@/scenes/PvpLobbyScene'
import { PvpResultScene } from '@/scenes/PvpResultScene'
import { PvpSpectatorScene } from '@/scenes/PvpSpectatorScene'
import { validateData, getAllItems, getConfig } from '@/core/DataLoader'
import { setApp, setStageLayout } from '@/core/AppContext'
import { clearStoredConfig } from '@/config/debugConfig'
import { PhaseManager, type GamePhase } from '@/core/PhaseManager'
import { Rectangle } from 'pixi.js'
import { getSceneImageUrl } from '@/core/assetPath'
import { setBattleSnapshot, type BattleSnapshotBundle } from '@/combat/BattleSnapshotStore'
import { normalizeSize } from '@/items/ItemDef'

// 基准分辨率（单格 128px × 5列 = 640，等比对应 390×844 物理屏）
const BASE_W = 640
const BASE_H = 1384

type SoakTestOptions = {
  rounds: number
  shopMs: number
  battleMs: number
  dayMin: number
  dayMax: number
}

type SoakTestStats = {
  running: boolean
  roundsPlanned: number
  roundsDone: number
  startedAtMs: number
  maxActiveFx: number
  maxActiveProjectiles: number
  maxActiveFloatingNumbers: number
  droppedProjectiles: number
  droppedFloatingNumbers: number
  lastBattleDay: number
}

type ItemBattleTarget = {
  id: string
  name_cn: string
  tier: 'Bronze' | 'Silver' | 'Gold' | 'Diamond'
}

let soakRoundTimer: number | null = null
let soakBattleEndTimer: number | null = null
let soakPollTimer: number | null = null
let soakState: SoakTestStats | null = null

const DEFAULT_SOAK_OPTIONS: SoakTestOptions = {
  rounds: 20,
  shopMs: 1200,
  battleMs: 20000,
  dayMin: 6,
  dayMax: 20,
}

function clearSoakTimers(): void {
  if (soakRoundTimer !== null) {
    window.clearTimeout(soakRoundTimer)
    soakRoundTimer = null
  }
  if (soakBattleEndTimer !== null) {
    window.clearTimeout(soakBattleEndTimer)
    soakBattleEndTimer = null
  }
  if (soakPollTimer !== null) {
    window.clearInterval(soakPollTimer)
    soakPollTimer = null
  }
}

function pickSoakDay(minDay: number, maxDay: number): number {
  const a = Math.max(1, Math.floor(minDay))
  const b = Math.max(a, Math.floor(maxDay))
  if (a === b) return a
  return a + Math.floor(Math.random() * (b - a + 1))
}

function parseTierName(raw: string): 'Bronze' | 'Silver' | 'Gold' | 'Diamond' {
  if (raw.includes('Silver')) return 'Silver'
  if (raw.includes('Gold')) return 'Gold'
  if (raw.includes('Diamond')) return 'Diamond'
  return 'Bronze'
}

function levelToTierStar(level: number): { tier: 'Bronze' | 'Silver' | 'Gold' | 'Diamond'; star: 1 | 2 } {
  const lv = Math.max(1, Math.min(7, Math.round(level)))
  if (lv <= 1) return { tier: 'Bronze', star: 1 }
  if (lv === 2) return { tier: 'Silver', star: 1 }
  if (lv === 3) return { tier: 'Silver', star: 2 }
  if (lv === 4) return { tier: 'Gold', star: 1 }
  if (lv === 5) return { tier: 'Gold', star: 2 }
  if (lv === 6) return { tier: 'Diamond', star: 1 }
  return { tier: 'Diamond', star: 2 }
}

function listItemBattleTargets(): ItemBattleTarget[] {
  const order: Record<'Bronze' | 'Silver' | 'Gold' | 'Diamond', number> = { Bronze: 0, Silver: 1, Gold: 2, Diamond: 3 }
  return getAllItems()
    .map((it) => ({ id: it.id, name_cn: it.name_cn, tier: parseTierName(it.starting_tier) }))
    .sort((a, b) => {
      const diff = (order[a.tier] ?? 0) - (order[b.tier] ?? 0)
      if (diff !== 0) return diff
      return a.name_cn.localeCompare(b.name_cn, 'zh-Hans-CN')
    })
}

function startItemBattleTest(defId: string, level = 7, allyDefId?: string, enemyDefId?: string): boolean {
  try {
    const player = getAllItems().find((it) => it.id === defId)
    if (!player) return false
    const ally = allyDefId ? (getAllItems().find((it) => it.id === allyDefId) ?? null) : null
    const enemy = (enemyDefId ? (getAllItems().find((it) => it.id === enemyDefId) ?? null) : null)
      ?? getAllItems().find((it) => it.id !== defId && (it.damage + it.heal + it.shield + it.burn + it.poison + it.regen) > 0)
      ?? player
    const playerSize = normalizeSize(player.size)
    const allySize = ally ? normalizeSize(ally.size) : null
    const enemySize = normalizeSize(enemy.size)
    const toW = (size: '1x1' | '2x1' | '3x1'): number => (size === '1x1' ? 1 : size === '2x1' ? 2 : 3)
    const activeColCount = 6
    const playerTier = levelToTierStar(level)
    const enemyTier = levelToTierStar(Math.max(1, Math.min(7, Math.round(level))))
    const normalizedLevel = Math.max(1, Math.min(7, Math.round(level))) as 1 | 2 | 3 | 4 | 5 | 6 | 7
    const playerEntities: BattleSnapshotBundle['entities'] = [
      {
        instanceId: `item-test-player-${player.id}`,
        defId: player.id,
        size: playerSize,
        col: 0,
        row: 0,
        tier: playerTier.tier,
        tierStar: playerTier.star,
        quality: parseTierName(player.starting_tier),
        level: normalizedLevel,
      },
    ]
    if (ally && allySize) {
      const playerW = toW(playerSize)
      const allyCol = Math.min(activeColCount - toW(allySize), Math.max(0, playerW))
      playerEntities.push({
        instanceId: `item-test-ally-${ally.id}`,
        defId: ally.id,
        size: allySize,
        col: allyCol,
        row: 0,
        tier: playerTier.tier,
        tierStar: playerTier.star,
        quality: parseTierName(ally.starting_tier),
        level: normalizedLevel,
      })
    }

    const snapshot: BattleSnapshotBundle = {
      day: 20,
      activeColCount,
      createdAtMs: Date.now(),
      entities: [
        ...playerEntities,
        {
          instanceId: `item-test-enemy-${enemy.id}`,
          defId: enemy.id,
          size: enemySize,
          col: Math.max(0, activeColCount - toW(enemySize)),
          row: 0,
          tier: enemyTier.tier,
          tierStar: enemyTier.star,
          quality: parseTierName(enemy.starting_tier),
          level: normalizedLevel,
        },
      ],
    }
    if (SceneManager.currentName() !== 'shop') SceneManager.goto('shop')
    setBattleSnapshot(snapshot)
    SceneManager.goto('battle')
    return true
  } catch (err) {
    console.warn('[ItemBattleTest] start failed', err)
    return false
  }
}

function createSoakSnapshot(day: number): BattleSnapshotBundle {
  const items = getAllItems()
  const activeColCount = 6
  const toW = (size: '1x1' | '2x1' | '3x1'): number => (size === '1x1' ? 1 : size === '2x1' ? 2 : 3)

  const candidates = items
    .filter((it) => (it.damage + it.heal + it.shield + it.burn + it.poison + it.regen) > 0)
    .sort((a, b) => {
      const as = normalizeSize(a.size)
      const bs = normalizeSize(b.size)
      const aw = toW(as)
      const bw = toW(bs)
      if (aw !== bw) return aw - bw
      return (a.cooldown || 0) - (b.cooldown || 0)
    })

  const entities: BattleSnapshotBundle['entities'] = []
  const placeSide = (side: 'player' | 'enemy', seedOffset: number): void => {
    let col = 0
    let idx = seedOffset % Math.max(1, candidates.length)
    let guard = 0
    while (col < activeColCount && guard < candidates.length * 2) {
      const def = candidates[idx % candidates.length]
      idx += 1
      guard += 1
      if (!def) continue
      const size = normalizeSize(def.size)
      const w = toW(size)
      if (col + w > activeColCount) continue
      entities.push({
        instanceId: `soak-${side}-${entities.length + 1}`,
        defId: def.id,
        size,
        col,
        row: 0,
        tier: 'Bronze',
      })
      col += w
      if (entities.length >= 12) break
    }
  }

  placeSide('player', day)
  placeSide('enemy', day + 3)

  return {
    day,
    activeColCount,
    createdAtMs: Date.now(),
    entities,
  }
}

function stopSoakTestInternal(report: boolean): void {
  clearSoakTimers()
  if (!soakState) return
  const snapshot = { ...soakState }
  soakState = null
  if (SceneManager.currentName() !== 'shop') SceneManager.goto('shop')
  if (report) {
    const sec = Math.round((Date.now() - snapshot.startedAtMs) / 1000)
    console.log(`[SoakTest] stop rounds=${snapshot.roundsDone}/${snapshot.roundsPlanned} elapsed=${sec}s maxFx=${snapshot.maxActiveFx} maxP=${snapshot.maxActiveProjectiles} maxT=${snapshot.maxActiveFloatingNumbers} dropP=${snapshot.droppedProjectiles} dropT=${snapshot.droppedFloatingNumbers}`)
  }
}

function startSoakPolling(): void {
  if (soakPollTimer !== null) {
    window.clearInterval(soakPollTimer)
    soakPollTimer = null
  }
  soakPollTimer = window.setInterval(() => {
    if (!soakState || SceneManager.currentName() !== 'battle') return
    const fx = getBattleFxPerfStats()
    soakState.maxActiveFx = Math.max(soakState.maxActiveFx, fx.activeFx)
    soakState.maxActiveProjectiles = Math.max(soakState.maxActiveProjectiles, fx.activeProjectiles)
    soakState.maxActiveFloatingNumbers = Math.max(soakState.maxActiveFloatingNumbers, fx.activeFloatingNumbers)
    soakState.droppedProjectiles = Math.max(soakState.droppedProjectiles, fx.droppedProjectiles)
    soakState.droppedFloatingNumbers = Math.max(soakState.droppedFloatingNumbers, fx.droppedFloatingNumbers)
  }, 500)
}

function runSoakRound(options: SoakTestOptions): void {
  if (!soakState || !soakState.running) return
  if (soakState.roundsDone >= soakState.roundsPlanned) {
    stopSoakTestInternal(true)
    return
  }

  if (SceneManager.currentName() !== 'shop') SceneManager.goto('shop')
  soakRoundTimer = window.setTimeout(() => {
    if (!soakState || !soakState.running) return
    const day = pickSoakDay(options.dayMin, options.dayMax)
    const snapshot = createSoakSnapshot(day)
    setBattleSnapshot(snapshot)
    soakState.lastBattleDay = day
    soakState.roundsDone += 1
    SceneManager.goto('battle')
    startSoakPolling()
    console.log(`[SoakTest] round=${soakState.roundsDone}/${soakState.roundsPlanned} day=${day} entities=${snapshot.entities.length}`)
    soakBattleEndTimer = window.setTimeout(() => {
      if (!soakState || !soakState.running) return
      runSoakRound(options)
    }, options.battleMs)
  }, options.shopMs)
}

function startSoakTest(options?: Partial<SoakTestOptions>): void {
  const merged: SoakTestOptions = {
    rounds: Math.max(1, Math.floor(options?.rounds ?? DEFAULT_SOAK_OPTIONS.rounds)),
    shopMs: Math.max(300, Math.floor(options?.shopMs ?? DEFAULT_SOAK_OPTIONS.shopMs)),
    battleMs: Math.max(1000, Math.floor(options?.battleMs ?? DEFAULT_SOAK_OPTIONS.battleMs)),
    dayMin: Math.max(1, Math.floor(options?.dayMin ?? DEFAULT_SOAK_OPTIONS.dayMin)),
    dayMax: Math.max(1, Math.floor(options?.dayMax ?? DEFAULT_SOAK_OPTIONS.dayMax)),
  }
  if (soakState?.running) stopSoakTestInternal(true)
  soakState = {
    running: true,
    roundsPlanned: merged.rounds,
    roundsDone: 0,
    startedAtMs: Date.now(),
    maxActiveFx: 0,
    maxActiveProjectiles: 0,
    maxActiveFloatingNumbers: 0,
    droppedProjectiles: 0,
    droppedFloatingNumbers: 0,
    lastBattleDay: 1,
  }
  console.log(`[SoakTest] start rounds=${merged.rounds} shopMs=${merged.shopMs} battleMs=${merged.battleMs} day=[${merged.dayMin},${merged.dayMax}]`)
  runSoakRound(merged)
}

function getSoakStats(): SoakTestStats | null {
  return soakState ? { ...soakState } : null
}

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

function applyReleaseLogSwitch(): void {
  const env = (import.meta as { env?: { DEV?: boolean } }).env
  if (env?.DEV) return
  if (window.location.protocol !== 'app:') return
  if (!getConfig().runRules?.muteLogsInMobileRelease) return
  const muted: (..._args: unknown[]) => void = () => {}
  console.log = muted
  console.info = muted
  console.warn = muted
  console.debug = muted
  console.error = muted
}

async function bootstrap(): Promise<void> {
  applyReleaseLogSwitch()
  if (window.location.protocol === 'app:') {
    clearStoredConfig()
  }

  // 1. 验证数据完整性
  const { ok, report } = validateData()
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

  // 全局背景（跨场景常驻）
  const bgSprite = new Sprite(Texture.WHITE)
  bgSprite.width = BASE_W
  bgSprite.height = BASE_H
  bgSprite.zIndex = -100
  bgSprite.eventMode = 'none'
  app.stage.addChildAt(bgSprite, 0)
  try {
    const tex = await Assets.load<Texture>(getSceneImageUrl('background.png'))
    bgSprite.texture = tex
  } catch (err) {
    console.warn('[main] 背景图加载失败，使用纯色背景兜底', err)
    bgSprite.tint = 0x1a1a2e
  }

  // 5. 注册场景 & 启动
  SceneManager.register(MenuScene)
  SceneManager.register(ShopScene)
  SceneManager.register(BattleScene)
  SceneManager.register(PvpLobbyScene)
  SceneManager.register(PvpResultScene)
  SceneManager.register(PvpSpectatorScene)
  SceneManager.goto('menu')

  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    ;(window as Window & {
      __setGamePhase?: (phase: GamePhase) => void
      __getGamePhase?: () => GamePhase
      __startSoakTest?: (options?: Partial<SoakTestOptions>) => void
      __stopSoakTest?: () => void
      __getSoakStats?: () => SoakTestStats | null
      __listItemBattleTargets?: () => ItemBattleTarget[]
      __startItemBattleTest?: (defId: string, level?: number) => boolean
    }).__setGamePhase = (phase: GamePhase) => {
      PhaseManager.setPhase(phase)
      console.log(`[Debug] phase -> ${PhaseManager.getPhase()}`)
    }
    ;(window as Window & {
      __setGamePhase?: (phase: GamePhase) => void
      __getGamePhase?: () => GamePhase
      __startSoakTest?: (options?: Partial<SoakTestOptions>) => void
      __stopSoakTest?: () => void
      __getSoakStats?: () => SoakTestStats | null
      __listItemBattleTargets?: () => ItemBattleTarget[]
      __startItemBattleTest?: (defId: string, level?: number) => boolean
    }).__getGamePhase = () => PhaseManager.getPhase()
    ;(window as Window & {
      __setGamePhase?: (phase: GamePhase) => void
      __getGamePhase?: () => GamePhase
      __startSoakTest?: (options?: Partial<SoakTestOptions>) => void
      __stopSoakTest?: () => void
      __getSoakStats?: () => SoakTestStats | null
      __listItemBattleTargets?: () => ItemBattleTarget[]
      __startItemBattleTest?: (defId: string, level?: number) => boolean
    }).__startSoakTest = (options?: Partial<SoakTestOptions>) => startSoakTest(options)
    ;(window as Window & {
      __setGamePhase?: (phase: GamePhase) => void
      __getGamePhase?: () => GamePhase
      __startSoakTest?: (options?: Partial<SoakTestOptions>) => void
      __stopSoakTest?: () => void
      __getSoakStats?: () => SoakTestStats | null
      __listItemBattleTargets?: () => ItemBattleTarget[]
      __startItemBattleTest?: (defId: string, level?: number) => boolean
    }).__stopSoakTest = () => stopSoakTestInternal(true)
    ;(window as Window & {
      __setGamePhase?: (phase: GamePhase) => void
      __getGamePhase?: () => GamePhase
      __startSoakTest?: (options?: Partial<SoakTestOptions>) => void
      __stopSoakTest?: () => void
      __getSoakStats?: () => SoakTestStats | null
      __listItemBattleTargets?: () => ItemBattleTarget[]
      __startItemBattleTest?: (defId: string, level?: number) => boolean
    }).__getSoakStats = () => getSoakStats()
    ;(window as Window & {
      __setGamePhase?: (phase: GamePhase) => void
      __getGamePhase?: () => GamePhase
      __startSoakTest?: (options?: Partial<SoakTestOptions>) => void
      __stopSoakTest?: () => void
      __getSoakStats?: () => SoakTestStats | null
      __listItemBattleTargets?: () => ItemBattleTarget[]
      __startItemBattleTest?: (defId: string, level?: number) => boolean
    }).__listItemBattleTargets = () => listItemBattleTargets()
    ;(window as Window & {
      __setGamePhase?: (phase: GamePhase) => void
      __getGamePhase?: () => GamePhase
      __startSoakTest?: (options?: Partial<SoakTestOptions>) => void
      __stopSoakTest?: () => void
      __getSoakStats?: () => SoakTestStats | null
      __listItemBattleTargets?: () => ItemBattleTarget[]
      __startItemBattleTest?: (defId: string, level?: number) => boolean
    }).__startItemBattleTest = (defId: string, level?: number) => startItemBattleTest(defId, level)

    const params = new URLSearchParams(window.location.search)
    const itemBattleId = String(params.get('itemBattleId') ?? '').trim()
    const itemBattleLvRaw = Number(params.get('itemBattleLv') ?? '')
    const itemBattleAllyId = String(params.get('itemBattleAllyId') ?? '').trim()
    const itemBattleEnemyId = String(params.get('itemBattleEnemyId') ?? '').trim()
    const itemBattleLv = Number.isFinite(itemBattleLvRaw) ? itemBattleLvRaw : 7
    if (itemBattleId) {
      window.setTimeout(() => {
        const ok = startItemBattleTest(itemBattleId, itemBattleLv, itemBattleAllyId || undefined, itemBattleEnemyId || undefined)
        if (!ok) console.warn('[ItemBattleTest] auto start failed itemBattleId=', itemBattleId)
      }, 60)
    }
    if (params.get('soak') === '1' && params.get('soakAuto') === '1') {
      const rounds = Number(params.get('rounds') ?? '')
      const battleMs = Number(params.get('battleMs') ?? '')
      const shopMs = Number(params.get('shopMs') ?? '')
      startSoakTest({
        rounds: Number.isFinite(rounds) && rounds > 0 ? rounds : undefined,
        battleMs: Number.isFinite(battleMs) && battleMs > 0 ? battleMs : undefined,
        shopMs: Number.isFinite(shopMs) && shopMs > 0 ? shopMs : undefined,
      })
    } else if (params.get('soak') === '1') {
      console.log('[SoakTest] 检测到 soak=1，已忽略自动启动；如需自动压测请追加 soakAuto=1')
    }
  }

  // 6. 接入 PixiJS Ticker（取代手写 RAF）
  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000
    SceneManager.update(dt)
  })

}

bootstrap().catch((err) => {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
  console.error(err)
  showFatalError(msg)
})
