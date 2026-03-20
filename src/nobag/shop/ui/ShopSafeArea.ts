import { getStageLayout } from '@/nobag/core/NobagAppContext'

function isTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches
}

function readSafeAreaInsetTopPx(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 0
  const probe = document.createElement('div')
  probe.style.position = 'fixed'
  probe.style.top = '0'
  probe.style.left = '0'
  probe.style.width = '0'
  probe.style.height = '0'
  probe.style.pointerEvents = 'none'
  probe.style.visibility = 'hidden'
  probe.style.paddingTop = 'env(safe-area-inset-top)'
  document.body.appendChild(probe)
  const px = Number.parseFloat(window.getComputedStyle(probe).paddingTop || '0')
  probe.remove()
  return Number.isFinite(px) ? Math.max(0, px) : 0
}

export function getTopLeftControlYOffset(minTouchOffset = 34): number {
  let offset = isTouchDevice() ? minTouchOffset : 0
  const safeTopPx = readSafeAreaInsetTopPx()
  if (safeTopPx <= 0) return offset

  let scale = 1
  try {
    scale = Math.max(0.001, getStageLayout().scale)
  } catch {
    scale = 1
  }
  const safeTopDesignUnits = safeTopPx / scale
  offset = Math.max(offset, Math.ceil(safeTopDesignUnits + 10))
  return offset
}
