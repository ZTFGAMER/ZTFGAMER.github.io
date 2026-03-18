import type { SceneName } from '@/core/EventBus'

type PerfReporterConfig = {
  enabled: boolean
  endpoint: string
  bearerToken: string
  sampleMs: number
  flushMs: number
  batchSize: number
  maxPoints: number
  maxEvents: number
  autoFlushOnSceneChange: boolean
  warnFrameMsP95: number
  criticalFrameMsP95: number
  warnLongTasksPerMinute: number
  criticalLongTasksPerMinute: number
  warnFrameDropRate: number
  criticalFrameDropRate: number
  warnBattleDropRate: number
  criticalBattleDropRate: number
}

type PerfBattleSnapshot = {
  activeFx: number
  activeProjectiles: number
  activeFloatingNumbers: number
  attemptedProjectiles: number
  attemptedFloatingNumbers: number
  droppedProjectiles: number
  droppedFloatingNumbers: number
}

type PerfSamplePoint = {
  ts: number
  scene: SceneName | 'unknown'
  fps: number
  frameMsAvg: number
  frameMsP95: number
  longFrameCount: number
  longTaskCount: number
  longTaskTotalMs: number
  longTasksPerMinute: number
  frameDropCount: number
  frameDropRate: number
  battleDropRate: number | null
  perfLevel: 'ok' | 'warning' | 'critical'
  heapMb: number | null
  renderer: 'webgpu' | 'webgl' | 'unknown'
  battle?: PerfBattleSnapshot
}

type PerfEventPoint = {
  ts: number
  scene: SceneName | 'unknown'
  type: string
  payload?: Record<string, unknown>
}

type PerfPayload = {
  meta: {
    sessionId: string
    sentAt: number
    href: string
    ua: string
    deviceMemory: number | null
    hardwareConcurrency: number | null
    renderer: 'webgpu' | 'webgl' | 'unknown'
    screen: { w: number; h: number; dpr: number }
  }
  points: PerfSamplePoint[]
  events: PerfEventPoint[]
}

type PerfReporterDeps = {
  getScene: () => SceneName | null
  getRendererType: () => 'webgpu' | 'webgl' | 'unknown'
  getBattlePerf: () => PerfBattleSnapshot | null
}

function percentile95(values: number[]): number {
  if (values.length <= 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.95)))
  return sorted[idx] ?? 0
}

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, Math.round(v)))
}

function makeSessionId(): string {
  const t = Date.now().toString(36)
  const r = Math.floor(Math.random() * 0x7fffffff).toString(36)
  return `perf-${t}-${r}`
}

export class PerfReporter {
  private cfg: PerfReporterConfig
  private deps: PerfReporterDeps
  private sessionId = makeSessionId()
  private points: PerfSamplePoint[] = []
  private events: PerfEventPoint[] = []
  private frameMsWindow: number[] = []
  private sampleElapsedMs = 0
  private sampleFrames = 0
  private sampleFrameMsSum = 0
  private sampleLongFrames = 0
  private sampleDroppedFrames = 0
  private flushElapsedMs = 0
  private sampleLongTaskCount = 0
  private sampleLongTaskTotalMs = 0
  private prevDroppedProjectiles = 0
  private prevDroppedFloatingNumbers = 0
  private prevAttemptedProjectiles = 0
  private prevAttemptedFloatingNumbers = 0
  private perfLevel: 'ok' | 'warning' | 'critical' = 'ok'
  private longTaskObserver: PerformanceObserver | null = null
  private sending = false

  constructor(cfg: PerfReporterConfig, deps: PerfReporterDeps) {
    this.cfg = cfg
    this.deps = deps
    this.installLongTaskObserver()
  }

  private installLongTaskObserver(): void {
    if (typeof PerformanceObserver === 'undefined') return
    try {
      const supports = Array.isArray(PerformanceObserver.supportedEntryTypes)
        && PerformanceObserver.supportedEntryTypes.includes('longtask')
      if (!supports) return
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!Number.isFinite(entry.duration) || entry.duration <= 0) continue
          if (entry.duration < 50) continue
          this.sampleLongTaskCount += 1
          this.sampleLongTaskTotalMs += entry.duration
        }
      })
      this.longTaskObserver.observe({ type: 'longtask', buffered: true })
    } catch {
      this.longTaskObserver = null
    }
  }

  private calcBattleDropRate(scene: SceneName | 'unknown', battle?: PerfBattleSnapshot): number | null {
    if (scene !== 'battle' || !battle) return null
    const droppedDelta = Math.max(0,
      (battle.droppedProjectiles - this.prevDroppedProjectiles)
      + (battle.droppedFloatingNumbers - this.prevDroppedFloatingNumbers),
    )
    const attemptedDelta = Math.max(0,
      (battle.attemptedProjectiles - this.prevAttemptedProjectiles)
      + (battle.attemptedFloatingNumbers - this.prevAttemptedFloatingNumbers),
    )
    this.prevDroppedProjectiles = battle.droppedProjectiles
    this.prevDroppedFloatingNumbers = battle.droppedFloatingNumbers
    this.prevAttemptedProjectiles = battle.attemptedProjectiles
    this.prevAttemptedFloatingNumbers = battle.attemptedFloatingNumbers
    if (attemptedDelta <= 0) return 0
    return droppedDelta / attemptedDelta
  }

  private resolvePerfLevel(frameMsP95: number, longTasksPerMinute: number, frameDropRate: number, battleDropRate: number | null): 'ok' | 'warning' | 'critical' {
    const critical = frameMsP95 >= this.cfg.criticalFrameMsP95
      || longTasksPerMinute >= this.cfg.criticalLongTasksPerMinute
      || frameDropRate >= this.cfg.criticalFrameDropRate
      || ((battleDropRate ?? 0) >= this.cfg.criticalBattleDropRate)
    if (critical) return 'critical'
    const warning = frameMsP95 >= this.cfg.warnFrameMsP95
      || longTasksPerMinute >= this.cfg.warnLongTasksPerMinute
      || frameDropRate >= this.cfg.warnFrameDropRate
      || ((battleDropRate ?? 0) >= this.cfg.warnBattleDropRate)
    if (warning) return 'warning'
    return 'ok'
  }

  setEnabled(enabled: boolean): void {
    this.cfg.enabled = enabled
  }

  isEnabled(): boolean {
    return this.cfg.enabled
  }

  markEvent(type: string, payload?: Record<string, unknown>): void {
    if (!this.cfg.enabled) return
    const scene = this.deps.getScene() ?? 'unknown'
    this.events.push({ ts: Date.now(), scene, type, payload })
    if (this.events.length > this.cfg.maxEvents) this.events.splice(0, this.events.length - this.cfg.maxEvents)
  }

  tick(dtMs: number): void {
    if (!this.cfg.enabled) return
    const safeDt = Math.max(0, dtMs)
    this.sampleElapsedMs += safeDt
    this.flushElapsedMs += safeDt
    this.sampleFrames += 1
    this.sampleFrameMsSum += safeDt
    if (safeDt >= 50) this.sampleLongFrames += 1
    if (safeDt > 34) this.sampleDroppedFrames += 1
    this.frameMsWindow.push(safeDt)
    if (this.frameMsWindow.length > 180) this.frameMsWindow.shift()

    if (this.sampleElapsedMs >= this.cfg.sampleMs) {
      this.captureSample()
      this.sampleElapsedMs = 0
      this.sampleFrames = 0
      this.sampleFrameMsSum = 0
      this.sampleLongFrames = 0
      this.sampleDroppedFrames = 0
      this.sampleLongTaskCount = 0
      this.sampleLongTaskTotalMs = 0
    }

    if (this.flushElapsedMs >= this.cfg.flushMs || this.points.length >= this.cfg.batchSize) {
      this.flushElapsedMs = 0
      void this.flush(false)
    }
  }

  exportSnapshot(): { sessionId: string; points: PerfSamplePoint[]; events: PerfEventPoint[] } {
    return {
      sessionId: this.sessionId,
      points: [...this.points],
      events: [...this.events],
    }
  }

  async flush(forceIncludeAll: boolean): Promise<void> {
    if (!this.cfg.enabled) return
    if (this.sending) return
    const endpoint = this.cfg.endpoint.trim()
    const token = this.cfg.bearerToken.trim()
    if (!endpoint || !token) return
    if (this.points.length <= 0 && this.events.length <= 0) return

    const points = forceIncludeAll
      ? [...this.points]
      : this.points.slice(0, this.cfg.batchSize)
    const events = forceIncludeAll
      ? [...this.events]
      : this.events.slice(0, Math.max(8, Math.floor(this.cfg.batchSize / 2)))

    const payload: PerfPayload = {
      meta: {
        sessionId: this.sessionId,
        sentAt: Date.now(),
        href: window.location.href,
        ua: navigator.userAgent,
        deviceMemory: Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory) || null,
        hardwareConcurrency: Number(navigator.hardwareConcurrency) || null,
        renderer: this.deps.getRendererType(),
        screen: {
          w: window.screen?.width ?? 0,
          h: window.screen?.height ?? 0,
          dpr: window.devicePixelRatio || 1,
        },
      },
      points,
      events,
    }

    this.sending = true
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Perf-Schema': '1',
        },
        body: JSON.stringify(payload),
      })
      if (!res.ok) return
      this.points.splice(0, points.length)
      this.events.splice(0, events.length)
    } catch {
      // noop: 保留本地缓冲，等待下次重试
    } finally {
      this.sending = false
    }
  }

  flushByBeacon(): void {
    if (!this.cfg.enabled) return
    const endpoint = this.cfg.endpoint.trim()
    const token = this.cfg.bearerToken.trim()
    if (!endpoint || !token) return
    if (this.points.length <= 0 && this.events.length <= 0) return
    const payload: PerfPayload = {
      meta: {
        sessionId: this.sessionId,
        sentAt: Date.now(),
        href: window.location.href,
        ua: navigator.userAgent,
        deviceMemory: Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory) || null,
        hardwareConcurrency: Number(navigator.hardwareConcurrency) || null,
        renderer: this.deps.getRendererType(),
        screen: {
          w: window.screen?.width ?? 0,
          h: window.screen?.height ?? 0,
          dpr: window.devicePixelRatio || 1,
        },
      },
      points: this.points.slice(0, this.cfg.batchSize),
      events: this.events.slice(0, Math.max(8, Math.floor(this.cfg.batchSize / 2))),
    }
    try {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
      navigator.sendBeacon(endpoint, blob)
    } catch {
      // noop
    }
  }

  private captureSample(): void {
    const scene = this.deps.getScene() ?? 'unknown'
    const fps = this.sampleElapsedMs > 0
      ? (this.sampleFrames * 1000) / this.sampleElapsedMs
      : 0
    const frameMsAvg = this.sampleFrames > 0
      ? this.sampleFrameMsSum / this.sampleFrames
      : 0
    const frameMsP95 = percentile95(this.frameMsWindow)
    const frameDropCount = this.sampleDroppedFrames
    const frameDropRate = this.sampleFrames > 0 ? frameDropCount / this.sampleFrames : 0
    const longTasksPerMinute = this.sampleElapsedMs > 0
      ? (this.sampleLongTaskCount * 60000) / this.sampleElapsedMs
      : 0
    const mem = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory
    const heapMb = (mem && typeof mem.usedJSHeapSize === 'number')
      ? Math.round((mem.usedJSHeapSize / (1024 * 1024)) * 10) / 10
      : null
    const battle = scene === 'battle' ? this.deps.getBattlePerf() ?? undefined : undefined
    const battleDropRate = this.calcBattleDropRate(scene, battle)
    const nextPerfLevel = this.resolvePerfLevel(frameMsP95, longTasksPerMinute, frameDropRate, battleDropRate)
    if (nextPerfLevel !== this.perfLevel) {
      this.perfLevel = nextPerfLevel
      this.markEvent(`perf:${nextPerfLevel}`, {
        frameMsP95: Math.round(frameMsP95 * 100) / 100,
        longTasksPerMinute: Math.round(longTasksPerMinute * 10) / 10,
        frameDropRate: Math.round(frameDropRate * 1000) / 1000,
        battleDropRate: battleDropRate == null ? null : Math.round(battleDropRate * 1000) / 1000,
      })
    }
    this.points.push({
      ts: Date.now(),
      scene,
      fps: Math.round(fps * 10) / 10,
      frameMsAvg: Math.round(frameMsAvg * 100) / 100,
      frameMsP95: Math.round(frameMsP95 * 100) / 100,
      longFrameCount: this.sampleLongFrames,
      longTaskCount: this.sampleLongTaskCount,
      longTaskTotalMs: Math.round(this.sampleLongTaskTotalMs * 100) / 100,
      longTasksPerMinute: Math.round(longTasksPerMinute * 10) / 10,
      frameDropCount,
      frameDropRate: Math.round(frameDropRate * 1000) / 1000,
      battleDropRate: battleDropRate == null ? null : Math.round(battleDropRate * 1000) / 1000,
      perfLevel: this.perfLevel,
      heapMb,
      renderer: this.deps.getRendererType(),
      battle,
    })

    if (this.points.length > this.cfg.maxPoints) {
      this.points.splice(0, this.points.length - this.cfg.maxPoints)
    }
  }
}

export function resolvePerfReporterConfig(raw: unknown): PerfReporterConfig {
  const obj = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {}
  const warnFrameMsP95 = Math.max(8, Number(obj.warnFrameMsP95) || 12)
  const criticalFrameMsP95 = Math.max(warnFrameMsP95, Number(obj.criticalFrameMsP95) || 16)
  const warnLongTasksPerMinute = Math.max(0, Number(obj.warnLongTasksPerMinute) || 2)
  const criticalLongTasksPerMinute = Math.max(warnLongTasksPerMinute, Number(obj.criticalLongTasksPerMinute) || 6)
  const warnFrameDropRate = Math.max(0, Math.min(1, Number(obj.warnFrameDropRate) || 0.15))
  const criticalFrameDropRate = Math.max(warnFrameDropRate, Math.min(1, Number(obj.criticalFrameDropRate) || 0.3))
  const warnBattleDropRate = Math.max(0, Math.min(1, Number(obj.warnBattleDropRate) || 0.05))
  const criticalBattleDropRate = Math.max(warnBattleDropRate, Math.min(1, Number(obj.criticalBattleDropRate) || 0.1))
  return {
    enabled: obj.enabled === true,
    endpoint: typeof obj.endpoint === 'string' ? obj.endpoint.trim() : '',
    bearerToken: typeof obj.bearerToken === 'string' ? obj.bearerToken.trim() : '',
    sampleMs: clampInt(Number(obj.sampleMs), 100, 5000),
    flushMs: clampInt(Number(obj.flushMs), 500, 15000),
    batchSize: clampInt(Number(obj.batchSize), 10, 300),
    maxPoints: clampInt(Number(obj.maxPoints), 100, 12000),
    maxEvents: clampInt(Number(obj.maxEvents), 50, 5000),
    autoFlushOnSceneChange: obj.autoFlushOnSceneChange !== false,
    warnFrameMsP95,
    criticalFrameMsP95,
    warnLongTasksPerMinute,
    criticalLongTasksPerMinute,
    warnFrameDropRate,
    criticalFrameDropRate,
    warnBattleDropRate,
    criticalBattleDropRate,
  }
}
