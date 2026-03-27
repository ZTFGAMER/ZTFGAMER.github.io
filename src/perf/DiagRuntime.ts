export type DiagLevel = 'basic' | 'verbose'

export type DiagEventDetail = {
  type: string
  payload?: Record<string, unknown>
  level?: DiagLevel
  atMs: number
}

const DIAG_EVENT_NAME = 'bigbazzar:diag-event'
const DEFAULT_THROTTLE_MS = 0
let diagEnabledCached: boolean | null = null
let diagLevelCached: DiagLevel | null = null
const diagLastEmitAtByType = new Map<string, number>()

function readDiagFlagFromQuery(): { enabled: boolean; level: DiagLevel } {
  if (typeof window === 'undefined') return { enabled: false, level: 'basic' }
  const params = new URLSearchParams(window.location.search)
  const raw = String(params.get('diag') ?? '').trim().toLowerCase()
  const enabled = raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes'
  const rawLevel = String(params.get('diagLevel') ?? '').trim().toLowerCase()
  const level: DiagLevel = rawLevel === 'verbose' ? 'verbose' : 'basic'
  return { enabled, level }
}

export function isDiagEnabled(): boolean {
  if (diagEnabledCached === null) {
    const parsed = readDiagFlagFromQuery()
    diagEnabledCached = parsed.enabled
    diagLevelCached = parsed.level
  }
  return diagEnabledCached
}

export function getDiagLevel(): DiagLevel {
  if (diagLevelCached === null) {
    const parsed = readDiagFlagFromQuery()
    diagEnabledCached = parsed.enabled
    diagLevelCached = parsed.level
  }
  return diagLevelCached
}

export function emitDiagEvent(
  type: string,
  payload?: Record<string, unknown>,
  options?: { throttleMs?: number; level?: DiagLevel },
): void {
  if (!isDiagEnabled()) return
  if (typeof window === 'undefined') return
  const safeType = String(type || '').trim()
  if (!safeType) return
  const now = Date.now()
  const throttleMs = Math.max(0, Math.round(options?.throttleMs ?? DEFAULT_THROTTLE_MS))
  if (throttleMs > 0) {
    const key = `${safeType}|${options?.level ?? 'basic'}`
    const prev = diagLastEmitAtByType.get(key) ?? 0
    if (now - prev < throttleMs) return
    diagLastEmitAtByType.set(key, now)
  }
  const detail: DiagEventDetail = {
    type: safeType,
    payload,
    level: options?.level ?? 'basic',
    atMs: now,
  }
  window.dispatchEvent(new CustomEvent<DiagEventDetail>(DIAG_EVENT_NAME, { detail }))
}

export function getDiagEventName(): string {
  return DIAG_EVENT_NAME
}
