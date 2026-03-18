import { createServer } from 'node:http'
import { appendFile, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.PORT || 8787)
const PERF_INGEST_TOKEN = String(process.env.PERF_INGEST_TOKEN || '').trim()
const STORE_DIR = String(process.env.PERF_STORE_DIR || './perf-logs').trim()
const ALLOW_ORIGIN = String(process.env.PERF_ALLOW_ORIGIN || '*').trim()
const MAX_BODY_BYTES = Math.max(64 * 1024, Number(process.env.PERF_MAX_BODY_BYTES || 512 * 1024))

if (!PERF_INGEST_TOKEN) {
  console.error('[perf-server] missing PERF_INGEST_TOKEN')
  process.exit(1)
}

const SESSIONS_DIR = join(STORE_DIR, 'sessions')

function writeJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Perf-Schema',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  })
  res.end(body)
}

function getBearerToken(req) {
  const auth = String(req.headers.authorization || '')
  const m = auth.match(/^Bearer\s+(.+)$/i)
  return m?.[1]?.trim() || ''
}

async function ensureStore() {
  if (!existsSync(STORE_DIR)) await mkdir(STORE_DIR, { recursive: true })
  if (!existsSync(SESSIONS_DIR)) await mkdir(SESSIONS_DIR, { recursive: true })
}

function sanitizeSessionId(raw) {
  const safe = String(raw || '').trim().replace(/[^a-zA-Z0-9_-]/g, '')
  return safe.slice(0, 120)
}

async function readRequestJson(req) {
  let bytes = 0
  const chunks = []
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > MAX_BODY_BYTES) {
      throw new Error('payload_too_large')
    }
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return JSON.parse(text)
}

function validatePayload(body) {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'invalid_body' }
  const meta = body.meta && typeof body.meta === 'object' ? body.meta : null
  const points = Array.isArray(body.points) ? body.points : null
  const events = Array.isArray(body.events) ? body.events : null
  if (!meta || !points || !events) return { ok: false, reason: 'invalid_shape' }
  const sessionId = sanitizeSessionId(meta.sessionId)
  if (!sessionId) return { ok: false, reason: 'missing_session_id' }
  return { ok: true, sessionId, points, events, meta }
}

async function ingest(req, res) {
  const token = getBearerToken(req)
  if (token !== PERF_INGEST_TOKEN) {
    writeJson(res, 401, { ok: false, error: 'unauthorized' })
    return
  }

  let body
  try {
    body = await readRequestJson(req)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'invalid_json'
    const status = msg === 'payload_too_large' ? 413 : 400
    writeJson(res, status, { ok: false, error: msg })
    return
  }

  const checked = validatePayload(body)
  if (!checked.ok) {
    writeJson(res, 400, { ok: false, error: checked.reason })
    return
  }

  const now = Date.now()
  const line = JSON.stringify({
    ingestId: randomUUID(),
    receivedAt: now,
    ...body,
  }) + '\n'

  const dayKey = new Date(now).toISOString().slice(0, 10)
  const dayFile = join(STORE_DIR, `${dayKey}.ndjson`)
  const sessionFile = join(SESSIONS_DIR, `${checked.sessionId}.ndjson`)

  try {
    await appendFile(dayFile, line, 'utf8')
    await appendFile(sessionFile, line, 'utf8')
  } catch (err) {
    console.error('[perf-server] write failed', err)
    writeJson(res, 500, { ok: false, error: 'write_failed' })
    return
  }

  writeJson(res, 200, {
    ok: true,
    accepted: checked.points.length,
    events: checked.events.length,
    sessionId: checked.sessionId,
  })
}

async function listSessions(_req, res) {
  try {
    const files = await readdir(SESSIONS_DIR)
    const rows = []
    for (const file of files) {
      if (!file.endsWith('.ndjson')) continue
      const p = join(SESSIONS_DIR, file)
      const st = await stat(p)
      rows.push({
        sessionId: file.replace(/\.ndjson$/u, ''),
        updatedAt: st.mtimeMs,
        sizeBytes: st.size,
      })
    }
    rows.sort((a, b) => b.updatedAt - a.updatedAt)
    writeJson(res, 200, { ok: true, sessions: rows.slice(0, 200) })
  } catch (err) {
    console.error('[perf-server] list sessions failed', err)
    writeJson(res, 500, { ok: false, error: 'list_failed' })
  }
}

async function getSession(req, res, sessionId) {
  const safeId = sanitizeSessionId(sessionId)
  if (!safeId) {
    writeJson(res, 400, { ok: false, error: 'bad_session_id' })
    return
  }
  const file = join(SESSIONS_DIR, `${safeId}.ndjson`)
  if (!existsSync(file)) {
    writeJson(res, 404, { ok: false, error: 'session_not_found' })
    return
  }
  try {
    const raw = await readFile(file, 'utf8')
    const lines = raw.split('\n').filter(Boolean)
    const points = []
    const events = []
    let meta = null
    for (const line of lines) {
      const row = JSON.parse(line)
      if (!meta && row?.meta) meta = row.meta
      if (Array.isArray(row?.points)) points.push(...row.points)
      if (Array.isArray(row?.events)) events.push(...row.events)
    }
    writeJson(res, 200, {
      ok: true,
      sessionId: safeId,
      meta,
      points,
      events,
      chunkCount: lines.length,
    })
  } catch (err) {
    console.error('[perf-server] read session failed', err)
    writeJson(res, 500, { ok: false, error: 'read_failed' })
  }
}

async function start() {
  await ensureStore()
  const server = createServer(async (req, res) => {
    if (!req.url || !req.method) {
      writeJson(res, 400, { ok: false, error: 'bad_request' })
      return
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': ALLOW_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Perf-Schema',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      })
      res.end()
      return
    }

    const url = new URL(req.url, `http://localhost:${PORT}`)
    if (req.method === 'POST' && url.pathname === '/perf/ingest') {
      await ingest(req, res)
      return
    }
    if (req.method === 'GET' && url.pathname === '/perf/sessions') {
      await listSessions(req, res)
      return
    }
    if (req.method === 'GET' && url.pathname.startsWith('/perf/sessions/')) {
      const sid = url.pathname.replace('/perf/sessions/', '')
      await getSession(req, res, sid)
      return
    }
    if (req.method === 'GET' && url.pathname === '/perf/health') {
      writeJson(res, 200, { ok: true, service: 'perf-ingest', now: Date.now() })
      return
    }

    writeJson(res, 404, { ok: false, error: 'not_found' })
  })

  server.listen(PORT, () => {
    console.log(`[perf-server] listening on :${PORT}`)
    console.log(`[perf-server] store dir: ${STORE_DIR}`)
  })
}

void start()
