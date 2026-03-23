const loadedAssetUrls = new Set<string>()

export function markAssetUrlLoaded(url: string): void {
  if (!url) return
  loadedAssetUrls.add(url)
}

export function markAssetUrlUnloaded(url: string): void {
  if (!url) return
  loadedAssetUrls.delete(url)
}

export function hasAssetUrlLoaded(url: string): boolean {
  return loadedAssetUrls.has(url)
}

export function getLoadedAssetUrls(): string[] {
  return Array.from(loadedAssetUrls)
}

export function clearLoadedAssetUrls(): void {
  loadedAssetUrls.clear()
}
