declare module '@/vendor/haptic-module.js' {
  type HapticBackend = 'corehaptics' | 'vibration' | 'none'

  type HapticInitResult = {
    backend: HapticBackend
    haptics: boolean
  }

  interface HapticModuleApi {
    init(): Promise<HapticInitResult>
    impact(style?: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void
    notification(type?: 'success' | 'warning' | 'error'): void
    selection(): void
    playTransient(params?: { intensity?: number; sharpness?: number }): void
    playContinuous(params?: { intensity?: number; sharpness?: number; duration?: number }): void
    stop(): void
    setEnabled(enabled: boolean): void
    readonly isEnabled: boolean
    readonly isSupported: boolean
    readonly backend: HapticBackend
  }

  const HapticModule: HapticModuleApi
  export default HapticModule
}
