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
  const ext = protocol === 'app:' ? 'png' : 'webp'
  return `${base}/itemicon/vanessa/${defId}.${ext}`
}
