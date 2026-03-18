type PerfPoint = {
	ts?: number
	scene?: string
	fps?: number
	frameMsAvg?: number
	frameMsP95?: number
	longFrameCount?: number
	heapMb?: number | null
	renderer?: string
	battle?: unknown
}

interface Env {
	DB: D1Database
	PERF_TOKEN: string
	ALLOWED_ORIGIN?: string
}

type PerfPayload = {
	meta?: {
		sessionId?: string
	}
	points?: PerfPoint[]
	events?: unknown[]
}

type PerfLogRow = {
	id: number
	ts: number
	received_at: number
	token_hint: string
	session_id: string
	scene: string
	fps: number
	frame_ms_avg: number
	frame_ms_p95: number
	long_frame_count: number
	heap_mb: number | null
	renderer: string
	payload_json: string
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function allowOriginFor(requestOrigin: string | null, fallback: string): string {
	if (!requestOrigin) return fallback
	if (requestOrigin === fallback) return requestOrigin
	return fallback
}

function corsHeaders(request: Request, env: Env): HeadersInit {
	const fallback = env.ALLOWED_ORIGIN || 'https://ztfgamer.github.io'
	const origin = allowOriginFor(request.headers.get('Origin'), fallback)
	return {
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type,Authorization',
		'Access-Control-Max-Age': '86400',
		'Vary': 'Origin',
	}
}

function json(request: Request, env: Env, data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			...corsHeaders(request, env),
		},
	})
}

function tokenFromAuthHeader(request: Request): string {
	const auth = request.headers.get('Authorization') || ''
	const m = auth.match(/^Bearer\s+(.+)$/i)
	return (m?.[1] || '').trim()
}

function isAuthorized(request: Request, env: Env): boolean {
	const token = tokenFromAuthHeader(request)
	if (!token) return false
	return token === env.PERF_TOKEN
}

function parseIntSafe(raw: string | null, fallback: number): number {
	const n = Number(raw)
	if (!Number.isFinite(n)) return fallback
	return Math.round(n)
}

function clampInt(v: number, min: number, max: number): number {
	if (!Number.isFinite(v)) return min
	return Math.max(min, Math.min(max, Math.round(v)))
}

function normalizePoint(point: PerfPoint, now: number): Omit<PerfLogRow, 'id'> {
	const tsRaw = Number(point.ts)
	const ts = Number.isFinite(tsRaw) && tsRaw > 0 ? Math.round(tsRaw) : now
	const heapRaw = point.heapMb
	const heapMb = heapRaw == null ? null : Number(heapRaw)
	return {
		ts,
		received_at: now,
		token_hint: 'present',
		session_id: '',
		scene: String(point.scene || 'unknown'),
		fps: Number(point.fps || 0),
		frame_ms_avg: Number(point.frameMsAvg || 0),
		frame_ms_p95: Number(point.frameMsP95 || 0),
		long_frame_count: Number(point.longFrameCount || 0),
		heap_mb: Number.isFinite(heapMb) ? heapMb : null,
		renderer: String(point.renderer || 'unknown'),
		payload_json: JSON.stringify(point),
	}
}

async function ingestPerf(request: Request, env: Env): Promise<Response> {
	let payload: PerfPayload
	try {
		payload = await request.json<PerfPayload>()
	} catch {
		return json(request, env, { ok: false, error: 'invalid_json' }, 400)
	}

	const now = Date.now()
	const sessionId = String(payload.meta?.sessionId || '')
	const points = Array.isArray(payload.points) ? payload.points : []
	if (points.length <= 0) {
		return json(request, env, { ok: true, inserted: 0, pruned: 0 })
	}

	const insertSql = `
		INSERT INTO perf_logs
		(ts, received_at, token_hint, session_id, scene, fps, frame_ms_avg, frame_ms_p95, long_frame_count, heap_mb, renderer, payload_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`
	const stmt = env.DB.prepare(insertSql)
	const batch = points.map((point) => {
		const normalized = normalizePoint(point, now)
		normalized.session_id = sessionId
		return stmt.bind(
			normalized.ts,
			normalized.received_at,
			normalized.token_hint,
			normalized.session_id,
			normalized.scene,
			normalized.fps,
			normalized.frame_ms_avg,
			normalized.frame_ms_p95,
			normalized.long_frame_count,
			normalized.heap_mb,
			normalized.renderer,
			normalized.payload_json,
		)
	})

	await env.DB.batch(batch)
	const cutoff = now - ONE_DAY_MS
	const prune = await env.DB.prepare('DELETE FROM perf_logs WHERE ts < ?').bind(cutoff).run()

	return json(request, env, {
		ok: true,
		inserted: batch.length,
		pruned: Number(prune.meta.changes || 0),
	})
}

async function queryPerf(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url)
	const now = Date.now()
	const from = parseIntSafe(url.searchParams.get('from'), now - ONE_DAY_MS)
	const to = parseIntSafe(url.searchParams.get('to'), now)
	const scene = (url.searchParams.get('scene') || '').trim()
	const sessionId = (url.searchParams.get('sessionId') || '').trim()
	const limit = clampInt(parseIntSafe(url.searchParams.get('limit'), 1000), 1, 5000)

	let sql = 'SELECT * FROM perf_logs WHERE ts >= ? AND ts <= ?'
	const binds: Array<number | string> = [from, to]
	if (scene) {
		sql += ' AND scene = ?'
		binds.push(scene)
	}
	if (sessionId) {
		sql += ' AND session_id = ?'
		binds.push(sessionId)
	}
	sql += ' ORDER BY ts ASC LIMIT ?'
	binds.push(limit)

	const out = await env.DB.prepare(sql).bind(...binds).all<PerfLogRow>()
	return json(request, env, { ok: true, rows: out.results || [] })
}

export default {
	async fetch(request, env): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: corsHeaders(request, env) })
		}

		const url = new URL(request.url)
		if (url.pathname === '/healthz') {
			return json(request, env, { ok: true, service: 'perf-ingest-worker' })
		}

		if (!isAuthorized(request, env)) {
			return json(request, env, { ok: false, error: 'unauthorized' }, 401)
		}

		if (request.method === 'POST' && url.pathname === '/perf/ingest') {
			return ingestPerf(request, env)
		}
		if (request.method === 'GET' && url.pathname === '/perf/query') {
			return queryPerf(request, env)
		}

		return json(request, env, { ok: false, error: 'not_found' }, 404)
	},
} satisfies ExportedHandler<Env>
