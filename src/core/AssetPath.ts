import { getAllItemsRaw } from '@/core/DataLoader'
import { getSkillIconStemById, isSkillItemDefId } from '@/common/skills/SkillItemDefs'

function getItemIconBasePath(): string {
  const protocol = typeof window !== 'undefined' ? window.location.protocol : ''
  let base = '/resource'
  if (protocol && protocol !== 'http:' && protocol !== 'https:' && protocol !== 'file:') {
    base = './resource'
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
  if (protocol && protocol !== 'http:' && protocol !== 'https:' && protocol !== 'file:') {
    base = './resource'
  }
  if (protocol === 'file:') {
    const path = typeof window !== 'undefined' ? window.location.pathname : ''
    base = path.includes('/dist-ios/') ? '../resource' : './resource'
  }
  return base
}

let itemIconStemByDefId: Map<string, string> | null = null

function getItemIconStem(defId: string): string {
  if (!itemIconStemByDefId) {
    itemIconStemByDefId = new Map()
    for (const item of getAllItemsRaw()) {
      const stem = String(item.icon || '').trim()
      if (!stem) continue
      itemIconStemByDefId.set(item.id, stem)
    }
  }
  const hit = itemIconStemByDefId.get(defId)
  if (hit) return hit
  const fallback = getAllItemsRaw().find((it) => it.id === defId)
  const fallbackStem = String(fallback?.icon || '').trim()
  if (fallbackStem) {
    itemIconStemByDefId.set(defId, fallbackStem)
    return fallbackStem
  }
  return 'item1'
}

export function getItemIconUrl(defId: string): string {
  if (isSkillItemDefId(defId)) {
    const stem = getSkillIconStemById(defId) ?? defId
    return getSkillIconUrl(stem)
  }
  return `${getItemIconBasePath()}/${getItemIconStem(defId)}.png`
}

export function getItemIconUrlByName(fileStem: string): string {
  return `${getItemIconBasePath()}/${fileStem}.png`
}

export function getSceneImageUrl(fileName: string): string {
  return `${getResourceBasePath()}/scene/${fileName}`
}

export function getSkillIconUrl(fileStem: string): string {
  return `${getResourceBasePath()}/skills/${fileStem}.png`
}

export function getUiImageUrl(fileName: string): string {
  return `${getResourceBasePath()}/ui/${fileName}`
}

export function getEventIconUrl(fileStem: string): string {
  return `${getResourceBasePath()}/events/${fileStem}.png`
}

export function getBuffIconUrl(fileStem: string): string {
  return `${getResourceBasePath()}/bufficon/${fileStem}.png`
}

export function getHeroImageUrl(fileName: string): string {
  return `${getResourceBasePath()}/hero/${fileName}`
}
