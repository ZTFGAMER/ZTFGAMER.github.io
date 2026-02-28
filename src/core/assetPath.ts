function getItemIconBasePath(): string {
  const protocol = typeof window !== 'undefined' ? window.location.protocol : ''
  let base = '/resource'
  if (protocol === 'app:') {
    base = 'app://resource'
  }
  if (protocol === 'file:') {
    const path = typeof window !== 'undefined' ? window.location.pathname : ''
    base = path.includes('/dist-ios/') ? '../resource' : './resource'
  }
  return `${base}/itemicon/vanessa`
}

function getResourceBasePath(): string {
  const protocol = typeof window !== 'undefined' ? window.location.protocol : ''
  let base = '/resource'
  if (protocol === 'app:') {
    base = 'app://resource'
  }
  if (protocol === 'file:') {
    const path = typeof window !== 'undefined' ? window.location.pathname : ''
    base = path.includes('/dist-ios/') ? '../resource' : './resource'
  }
  return base
}

export function getItemIconUrl(defId: string): string {
  return `${getItemIconBasePath()}/${defId}.png`
}

export function getItemIconUrlByName(fileStem: string): string {
  return `${getItemIconBasePath()}/${fileStem}.png`
}

export function getSceneImageUrl(fileName: string): string {
  return `${getResourceBasePath()}/scene/${fileName}`
}
