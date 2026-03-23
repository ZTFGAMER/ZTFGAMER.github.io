import { Texture } from 'pixi.js'

const downscaledTextureCache = new Map<string, Promise<Texture>>()
const downscaleBypassUrls = new Set<string>()

function buildDownscaleCacheKey(url: string, scale: number): string {
  return `${scale.toFixed(3)}|${url}`
}

export function isMobileImageDownscaleBypassed(url: string): boolean {
  return downscaleBypassUrls.has(url)
}

export function markMobileImageDownscaleBypass(url: string): void {
  if (!url) return
  downscaleBypassUrls.add(url)
}

export function clearMobileImageDownscaleRuntimeCache(): void {
  downscaledTextureCache.clear()
  downscaleBypassUrls.clear()
}

export function loadImageTextureDownscaled(url: string, scale: number): Promise<Texture> {
  const key = buildDownscaleCacheKey(url, scale)
  const hit = downscaledTextureCache.get(key)
  if (hit) return hit

  const task = new Promise<Texture>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const w = Math.max(1, Math.round(img.naturalWidth * scale))
      const h = Math.max(1, Math.round(img.naturalHeight * scale))
      if (w >= img.naturalWidth && h >= img.naturalHeight) {
        resolve(Texture.from(img))
        return
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('[main] 2d canvas context unavailable while downscaling texture'))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(Texture.from(canvas))
    }
    img.onerror = reject
    img.src = url
  })

  downscaledTextureCache.set(key, task)
  return task
}
