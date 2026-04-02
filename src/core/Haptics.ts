import HapticModule from '@/vendor/haptic-module.js'
import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'

let initPromise: Promise<void> | null = null
let initialized = false
let lastSelectionAt = 0
let nativeMode = false
let enabled = true

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
    enabled = shouldEnableHaptics()
    nativeMode = Capacitor.isNativePlatform()
    console.log('[Haptics] init start', { enabled, nativeMode })
    if (nativeMode) {
      initialized = true
      console.log('[Haptics] init ready (native)')
      return
    }

    HapticModule.setEnabled(enabled)
    const result = await HapticModule.init()
    initialized = true
    console.log('[Haptics] init ready (web)', result)
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
  void ensureInit().then(() => {
    console.log('[Haptics] selection trigger', { enabled, nativeMode })
    if (!enabled) return
    if (nativeMode) {
      void Haptics.impact({ style: ImpactStyle.Light }).catch((err) => {
        console.warn('[Haptics] native selection impact failed', err)
      })
      return
    }
    HapticModule.selection()
  })
}

export function hapticImpact(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'light'): void {
  void ensureInit().then(() => {
    console.log('[Haptics] impact trigger', { style, enabled, nativeMode })
    if (!enabled) return
    if (nativeMode) {
      const impactStyle = style === 'heavy' ? ImpactStyle.Heavy : style === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light
      void Haptics.impact({ style: impactStyle }).catch((err) => {
        console.warn('[Haptics] native impact failed', err)
      })
      return
    }
    HapticModule.impact(style)
  })
}

export function hapticNotification(type: 'success' | 'warning' | 'error' = 'success'): void {
  void ensureInit().then(() => {
    console.log('[Haptics] notification trigger', { type, enabled, nativeMode })
    if (!enabled) return
    if (nativeMode) {
      const notificationType = type === 'warning'
        ? NotificationType.Warning
        : type === 'error'
          ? NotificationType.Error
          : NotificationType.Success
      void Haptics.notification({ type: notificationType }).catch((err) => {
        console.warn('[Haptics] native notification failed', err)
      })
      return
    }
    HapticModule.notification(type)
  })
}

export function setHapticsEnabled(isEnabled: boolean): void {
  const nextEnabled = !!isEnabled
  try {
    localStorage.setItem('bb_haptics_enabled', nextEnabled ? '1' : '0')
  } catch {
    // ignore
  }
  enabled = nextEnabled
  HapticModule.setEnabled(nextEnabled)
}
