export const SHOP_STATE_STORAGE_KEY = 'bigbazzar_shop_state_v1'

const LIFE_STATE_STORAGE_KEY = 'bigbazzar_life_state_v1'
const LIFE_STATE_STORAGE_VERSION = 1
const DEFAULT_MAX_LIVES = 5

export type LifeState = {
  current: number
  max: number
}

function clampLives(current: number, max: number): LifeState {
  const safeMax = Number.isFinite(max) ? Math.max(1, Math.round(max)) : DEFAULT_MAX_LIVES
  const safeCurrent = Number.isFinite(current)
    ? Math.max(0, Math.min(safeMax, Math.round(current)))
    : safeMax
  return { current: safeCurrent, max: safeMax }
}

function saveLifeState(state: LifeState): LifeState {
  const normalized = clampLives(state.current, state.max)
  try {
    localStorage.setItem(LIFE_STATE_STORAGE_KEY, JSON.stringify({
      version: LIFE_STATE_STORAGE_VERSION,
      state: normalized,
    }))
  } catch {
    // ignore
  }
  return normalized
}

export function getLifeState(): LifeState {
  try {
    const raw = localStorage.getItem(LIFE_STATE_STORAGE_KEY)
    if (!raw) return saveLifeState({ current: DEFAULT_MAX_LIVES, max: DEFAULT_MAX_LIVES })
    const parsed = JSON.parse(raw) as {
      version?: unknown
      state?: { current?: unknown; max?: unknown }
    } | null
    if (!parsed || parsed.version !== LIFE_STATE_STORAGE_VERSION || !parsed.state) {
      return saveLifeState({ current: DEFAULT_MAX_LIVES, max: DEFAULT_MAX_LIVES })
    }
    const current = Number(parsed.state.current)
    const max = Number(parsed.state.max)
    return saveLifeState(clampLives(current, max))
  } catch {
    return saveLifeState({ current: DEFAULT_MAX_LIVES, max: DEFAULT_MAX_LIVES })
  }
}

export function setLifeState(current: number, max: number): LifeState {
  return saveLifeState({ current, max })
}

export function deductLife(): LifeState {
  const state = getLifeState()
  return saveLifeState({ current: state.current - 1, max: state.max })
}

export function resetLifeState(max = DEFAULT_MAX_LIVES): LifeState {
  return saveLifeState({ current: max, max })
}

export function clearCurrentRunState(): void {
  try {
    localStorage.removeItem(SHOP_STATE_STORAGE_KEY)
    localStorage.removeItem(LIFE_STATE_STORAGE_KEY)
  } catch {
    // ignore
  }
}
