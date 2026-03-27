type PerfBody = {
  meta?: {
    sessionId?: string
    href?: string
    ua?: string
    renderer?: string
    deviceMemory?: number
    hardwareConcurrency?: number
    screen?: { w?: number; h?: number; dpr?: number }
  }
  points?: Array<{
    ts?: number
    scene?: string
    fps?: number
    frameMsP95?: number
    frameDropRate?: number
    battleDropRate?: number | null
    perfLevel?: string
    battle?: {
      battleUpdateMsP95?: number
      battleFrameDtMsP95?: number
      battleQueuePendingRatioMax?: number
      battleTickDeltaMax?: number
      activeFx?: number
      droppedProjectiles?: number
      droppedFloatingNumbers?: number
    }
  }>
  events?: Array<{ type?: string; scene?: string; ts?: number; payload?: Record<string, unknown> }>
}

function setCors(res: any): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Perf-Schema')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
}

function safeString(raw: unknown, fallback = ''): string {
  const v = String(raw ?? '').trim()
  return v || fallback
}

function parseBearerToken(req: any): string {
  const auth = safeString(req?.headers?.authorization)
  const m = auth.match(/^Bearer\s+(.+)$/i)
  return safeString(m?.[1])
}

function normalizeBody(raw: unknown): PerfBody | null {
  if (!raw) return null
  if (typeof raw === 'object') return raw as PerfBody
  if (typeof raw !== 'string') return null
  try {
    return JSON.parse(raw) as PerfBody
  } catch {
    return null
  }
}

export default function handler(req: any, res: any): void {
  setCors(res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' })
    return
  }

  const body = normalizeBody(req.body)
  if (!body || typeof body !== 'object') {
    res.status(400).json({ ok: false, error: 'invalid_body' })
    return
  }
  const points = Array.isArray(body.points) ? body.points : []
  const events = Array.isArray(body.events) ? body.events : []
  const sessionId = safeString(body.meta?.sessionId, 'unknown')
  const token = parseBearerToken(req)
  const interestingEvents = events
    .filter((it) => {
      const t = safeString(it?.type)
      return !!t && (
        t.includes('diag_')
        || t.includes('window_error')
        || t.includes('unhandled_rejection')
      )
    })
    .slice(-30)
    .map((it) => {
      const t = safeString(it?.type)
      const p = (it?.payload && typeof it.payload === 'object') ? it.payload : {}
      const compact: Record<string, unknown> = {}
      if (t === 'window_error') {
        compact.message = safeString((p as Record<string, unknown>).message)
        compact.filename = safeString((p as Record<string, unknown>).filename)
        compact.lineno = Number((p as Record<string, unknown>).lineno ?? 0)
        compact.colno = Number((p as Record<string, unknown>).colno ?? 0)
      } else if (t === 'unhandled_rejection') {
        compact.reason = safeString((p as Record<string, unknown>).reason)
      } else {
        const keys = [
          'day',
          'nextDay',
          'tickIndex',
          'stallMs',
          'dtMs',
          'queuePendingRatio',
          'pendingPlayerHits',
          'pendingEnemyHits',
          'pendingPlayerFires',
          'pendingMelee',
          'isFinished',
          'playerHp',
          'enemyHp',
          'frameUpdateMs',
          'frameDtMs',
          'updateCostMs',
          'engineUpdateMs',
          'runtimeBuildMs',
          'layoutMs',
          'statusFxMs',
          'fxTickMs',
        ]
        for (const k of keys) {
          if (k in p) compact[k] = (p as Record<string, unknown>)[k]
        }
        const topPhases = (p as Record<string, unknown>).topPhases
        if (Array.isArray(topPhases) && topPhases.length > 0) {
          compact.topPhases = topPhases.slice(0, 3)
        }
      }
      return { type: t, payload: compact }
    })
  const lastPoint = points.length > 0 ? points[points.length - 1] : null

  console.log('[perf-ingest]', JSON.stringify({
    at: Date.now(),
    sessionId,
    points: points.length,
    events: events.length,
    sceneHint: safeString(events[events.length - 1]?.scene, ''),
    renderer: safeString(body.meta?.renderer, ''),
    ua: safeString(body.meta?.ua, ''),
    deviceMemory: Number(body.meta?.deviceMemory ?? 0) || 0,
    hardwareConcurrency: Number(body.meta?.hardwareConcurrency ?? 0) || 0,
    screen: {
      w: Number(body.meta?.screen?.w ?? 0) || 0,
      h: Number(body.meta?.screen?.h ?? 0) || 0,
      dpr: Number(body.meta?.screen?.dpr ?? 0) || 0,
    },
    tokenPresent: token.length > 0,
    href: safeString(body.meta?.href, ''),
    interestingEvents,
    lastPoint: lastPoint
      ? {
          ts: Number(lastPoint.ts ?? 0),
          scene: safeString(lastPoint.scene),
          fps: Number(lastPoint.fps ?? 0),
          frameMsP95: Number(lastPoint.frameMsP95 ?? 0),
          frameDropRate: Number(lastPoint.frameDropRate ?? 0),
          battleDropRate: Number(lastPoint.battleDropRate ?? 0),
          perfLevel: safeString(lastPoint.perfLevel),
          battleUpdateMsP95: Number(lastPoint.battle?.battleUpdateMsP95 ?? 0),
          battleFrameDtMsP95: Number(lastPoint.battle?.battleFrameDtMsP95 ?? 0),
          battleQueuePendingRatioMax: Number(lastPoint.battle?.battleQueuePendingRatioMax ?? 0),
          battleTickDeltaMax: Number(lastPoint.battle?.battleTickDeltaMax ?? 0),
          activeFx: Number(lastPoint.battle?.activeFx ?? 0),
          droppedProjectiles: Number(lastPoint.battle?.droppedProjectiles ?? 0),
          droppedFloatingNumbers: Number(lastPoint.battle?.droppedFloatingNumbers ?? 0),
        }
      : null,
  }))

  res.status(200).json({
    ok: true,
    accepted: points.length,
    events: events.length,
    sessionId,
  })
}
