export function getItemIconUrl(defId: string): string {
  const protocol = typeof window !== 'undefined' ? window.location.protocol : ''
  let base = '/resource'
  if (protocol === 'app:') {
    base = 'app://dist-ios/resource'
  }
  if (protocol === 'file:') {
    const path = typeof window !== 'undefined' ? window.location.pathname : ''
    base = path.includes('/dist-ios/') ? '../resource' : './resource'
  }
  // 统一使用 PNG：新资源为 PNG，且 iOS WKWebView 对 WEBP 兼容性不稳定
  const ext = 'png'
  return `${base}/itemicon/vanessa/${defId}.${ext}`
}
