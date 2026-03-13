export const SHOP_STATE_STORAGE_KEY = 'bigbazzar_shop_state_v1'

const LIFE_STATE_STORAGE_KEY = 'bigbazzar_life_state_v1'
const LIFE_STATE_STORAGE_VERSION = 1
const DEFAULT_MAX_LIVES = 30
const TROPHY_STATE_STORAGE_KEY = 'bigbazzar_trophy_state_v1'
const TROPHY_STATE_STORAGE_VERSION = 1
const DEFAULT_WIN_TARGET = 10
const WIN_STREAK_STORAGE_KEY = 'bigbazzar_win_streak_v1'
const WIN_STREAK_STORAGE_VERSION = 1
const PLAYER_PROGRESS_STORAGE_KEY = 'bigbazzar_player_progress_v1'
const PLAYER_PROGRESS_STORAGE_VERSION = 1
const LAST_STAND_STATE_STORAGE_KEY = 'bigbazzar_last_stand_state_v1'
const LAST_STAND_STATE_STORAGE_VERSION = 1
const DEFAULT_PLAYER_LEVEL = 1
const DEFAULT_PLAYER_EXP = 0

// PVP 模式内存覆盖：激活时读写均走内存，不碰 localStorage
// 由 PvpContext.startSession / endSession 管理
let pvpPlayerProgressOverride: PlayerProgressState | null = null

export function setPvpPlayerProgressOverride(state: PlayerProgressState | null): void {
  pvpPlayerProgressOverride = state
}

export type LifeState = {
  current: number
  max: number
}

export type TrophyState = {
  wins: number
  target: number
}

export type WinStreakState = {
  count: number
}

export type PlayerProgressState = {
  level: number
  exp: number
}

export type LastStandState = {
  used: boolean
  pendingReward: boolean
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

function clampTrophies(wins: number, target: number): TrophyState {
  const safeTarget = Number.isFinite(target) ? Math.max(1, Math.round(target)) : DEFAULT_WIN_TARGET
  const safeWins = Number.isFinite(wins)
    ? Math.max(0, Math.min(safeTarget, Math.round(wins)))
    : 0
  return { wins: safeWins, target: safeTarget }
}

function saveTrophyState(state: TrophyState): TrophyState {
  const normalized = clampTrophies(state.wins, state.target)
  try {
    localStorage.setItem(TROPHY_STATE_STORAGE_KEY, JSON.stringify({
      version: TROPHY_STATE_STORAGE_VERSION,
      state: normalized,
    }))
  } catch {
    // ignore
  }
  return normalized
}

function clampWinStreak(count: number): WinStreakState {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0
  return { count: safeCount }
}

function saveWinStreakState(state: WinStreakState): WinStreakState {
  const normalized = clampWinStreak(state.count)
  try {
    localStorage.setItem(WIN_STREAK_STORAGE_KEY, JSON.stringify({
      version: WIN_STREAK_STORAGE_VERSION,
      state: normalized,
    }))
  } catch {
    // ignore
  }
  return normalized
}

function clampPlayerProgress(level: number, exp: number): PlayerProgressState {
  const safeLevel = Number.isFinite(level) ? Math.max(1, Math.round(level)) : DEFAULT_PLAYER_LEVEL
  const safeExp = Number.isFinite(exp) ? Math.max(0, Math.round(exp)) : DEFAULT_PLAYER_EXP
  return { level: safeLevel, exp: safeExp }
}

function savePlayerProgressState(state: PlayerProgressState): PlayerProgressState {
  const normalized = clampPlayerProgress(state.level, state.exp)
  try {
    localStorage.setItem(PLAYER_PROGRESS_STORAGE_KEY, JSON.stringify({
      version: PLAYER_PROGRESS_STORAGE_VERSION,
      state: normalized,
    }))
  } catch {
    // ignore
  }
  return normalized
}

function clampLastStandState(used: unknown, pendingReward: unknown): LastStandState {
  return {
    used: used === true,
    pendingReward: pendingReward === true,
  }
}

function saveLastStandState(state: LastStandState): LastStandState {
  const normalized = clampLastStandState(state.used, state.pendingReward)
  try {
    localStorage.setItem(LAST_STAND_STATE_STORAGE_KEY, JSON.stringify({
      version: LAST_STAND_STATE_STORAGE_VERSION,
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
    const normalized = clampLives(current, max)
    if (normalized.max < DEFAULT_MAX_LIVES) {
      return saveLifeState({ current: DEFAULT_MAX_LIVES, max: DEFAULT_MAX_LIVES })
    }
    return saveLifeState(normalized)
  } catch {
    return saveLifeState({ current: DEFAULT_MAX_LIVES, max: DEFAULT_MAX_LIVES })
  }
}

export function setLifeState(current: number, max: number): LifeState {
  return saveLifeState({ current, max })
}

export function deductLife(amount = 1): LifeState {
  const state = getLifeState()
  const dmg = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 1
  return saveLifeState({ current: state.current - dmg, max: state.max })
}

export function resetLifeState(max = DEFAULT_MAX_LIVES): LifeState {
  return saveLifeState({ current: max, max })
}

export function clearCurrentRunState(): void {
  try {
    localStorage.removeItem(SHOP_STATE_STORAGE_KEY)
    localStorage.removeItem(LIFE_STATE_STORAGE_KEY)
    localStorage.removeItem(TROPHY_STATE_STORAGE_KEY)
    localStorage.removeItem(WIN_STREAK_STORAGE_KEY)
    localStorage.removeItem(PLAYER_PROGRESS_STORAGE_KEY)
    localStorage.removeItem(LAST_STAND_STATE_STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function getLastStandState(): LastStandState {
  try {
    const raw = localStorage.getItem(LAST_STAND_STATE_STORAGE_KEY)
    if (!raw) return saveLastStandState({ used: false, pendingReward: false })
    const parsed = JSON.parse(raw) as {
      version?: unknown
      state?: { used?: unknown; pendingReward?: unknown }
    } | null
    if (!parsed || parsed.version !== LAST_STAND_STATE_STORAGE_VERSION || !parsed.state) {
      return saveLastStandState({ used: false, pendingReward: false })
    }
    return saveLastStandState(clampLastStandState(parsed.state.used, parsed.state.pendingReward))
  } catch {
    return saveLastStandState({ used: false, pendingReward: false })
  }
}

export function applyLifeDamageWithLastStand(amount = 1): { life: LifeState; triggered: boolean } {
  const state = getLifeState()
  const lastStand = getLastStandState()
  const dmg = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 1
  const next = state.current - dmg
  if (next <= 0 && !lastStand.used) {
    saveLastStandState({ used: true, pendingReward: true })
    return { life: saveLifeState({ current: 1, max: state.max }), triggered: true }
  }
  return { life: saveLifeState({ current: next, max: state.max }), triggered: false }
}

export function consumeLastStandPendingReward(): boolean {
  const state = getLastStandState()
  if (!state.pendingReward) return false
  saveLastStandState({ used: state.used, pendingReward: false })
  return true
}

export function getPlayerProgressState(): PlayerProgressState {
  if (pvpPlayerProgressOverride !== null) {
    return clampPlayerProgress(pvpPlayerProgressOverride.level, pvpPlayerProgressOverride.exp)
  }
  try {
    const raw = localStorage.getItem(PLAYER_PROGRESS_STORAGE_KEY)
    if (!raw) return savePlayerProgressState({ level: DEFAULT_PLAYER_LEVEL, exp: DEFAULT_PLAYER_EXP })
    const parsed = JSON.parse(raw) as {
      version?: unknown
      state?: { level?: unknown; exp?: unknown }
    } | null
    if (!parsed || parsed.version !== PLAYER_PROGRESS_STORAGE_VERSION || !parsed.state) {
      return savePlayerProgressState({ level: DEFAULT_PLAYER_LEVEL, exp: DEFAULT_PLAYER_EXP })
    }
    const level = Number(parsed.state.level)
    const exp = Number(parsed.state.exp)
    return savePlayerProgressState({ level, exp })
  } catch {
    return savePlayerProgressState({ level: DEFAULT_PLAYER_LEVEL, exp: DEFAULT_PLAYER_EXP })
  }
}

export function setPlayerProgressState(level: number, exp: number): PlayerProgressState {
  if (pvpPlayerProgressOverride !== null) {
    pvpPlayerProgressOverride = clampPlayerProgress(level, exp)
    return { ...pvpPlayerProgressOverride }
  }
  return savePlayerProgressState({ level, exp })
}

export function resetPlayerProgressState(level = DEFAULT_PLAYER_LEVEL, exp = DEFAULT_PLAYER_EXP): PlayerProgressState {
  return savePlayerProgressState({ level, exp })
}

export function getWinTrophyState(defaultTarget = DEFAULT_WIN_TARGET): TrophyState {
  try {
    const raw = localStorage.getItem(TROPHY_STATE_STORAGE_KEY)
    if (!raw) return saveTrophyState({ wins: 0, target: defaultTarget })
    const parsed = JSON.parse(raw) as {
      version?: unknown
      state?: { wins?: unknown; target?: unknown }
    } | null
    if (!parsed || parsed.version !== TROPHY_STATE_STORAGE_VERSION || !parsed.state) {
      return saveTrophyState({ wins: 0, target: defaultTarget })
    }
    const wins = Number(parsed.state.wins)
    const target = Number(parsed.state.target)
    return saveTrophyState(clampTrophies(wins, Number.isFinite(target) ? target : defaultTarget))
  } catch {
    return saveTrophyState({ wins: 0, target: defaultTarget })
  }
}

export function setWinTrophyState(wins: number, target = DEFAULT_WIN_TARGET): TrophyState {
  return saveTrophyState({ wins, target })
}

export function addWinTrophy(defaultTarget = DEFAULT_WIN_TARGET): TrophyState {
  const state = getWinTrophyState(defaultTarget)
  return saveTrophyState({ wins: state.wins + 1, target: state.target })
}

export function resetWinTrophyState(target = DEFAULT_WIN_TARGET): TrophyState {
  return saveTrophyState({ wins: 0, target })
}

export function getPlayerWinStreakState(): WinStreakState {
  try {
    const raw = localStorage.getItem(WIN_STREAK_STORAGE_KEY)
    if (!raw) return saveWinStreakState({ count: 0 })
    const parsed = JSON.parse(raw) as {
      version?: unknown
      state?: { count?: unknown }
    } | null
    if (!parsed || parsed.version !== WIN_STREAK_STORAGE_VERSION || !parsed.state) {
      return saveWinStreakState({ count: 0 })
    }
    return saveWinStreakState(clampWinStreak(Number(parsed.state.count)))
  } catch {
    return saveWinStreakState({ count: 0 })
  }
}

export function setPlayerWinStreak(count: number): WinStreakState {
  return saveWinStreakState({ count })
}

export function resetPlayerWinStreak(): WinStreakState {
  return saveWinStreakState({ count: 0 })
}
