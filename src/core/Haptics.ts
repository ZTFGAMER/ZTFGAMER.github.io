import HapticModule from '@/vendor/haptic-module.js'

let initPromise: Promise<void> | null = null
let initialized = false
let lastSelectionAt = 0

function shouldEnableHaptics(): boolean {
  try {
    const cfg = localStorage.getItem('bb_haptics_enabled')
    return cfg !== '0'
  } catch {
    return true
  }
}

function ensureInit(): Promise<void> {
  if (initialized) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => {
    HapticModule.setEnabled(shouldEnableHaptics())
    await HapticModule.init()
    initialized = true
  })().catch((err) => {
    console.warn('[Haptics] init failed', err)
  }).finally(() => {
    if (!initialized) initPromise = null
  })
  return initPromise
}

export async function initHaptics(): Promise<void> {
  await ensureInit()
}

export function hapticSelection(): void {
  const now = performance.now()
  if (now - lastSelectionAt < 60) return
  lastSelectionAt = now
  void ensureInit().then(() => HapticModule.selection())
}

export function hapticImpact(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'light'): void {
  void ensureInit().then(() => HapticModule.impact(style))
}

export function hapticNotification(type: 'success' | 'warning' | 'error' = 'success'): void {
  void ensureInit().then(() => HapticModule.notification(type))
}

export function setHapticsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem('bb_haptics_enabled', enabled ? '1' : '0')
  } catch {
    // ignore
  }
  HapticModule.setEnabled(enabled)
}
