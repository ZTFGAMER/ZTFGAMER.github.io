import rawTowerItems from '../../data/tower_items.json'

export type TowerWeaponClass = 'ninja' | 'archer' | 'mage' | 'warrior'

type TowerItemEntry = {
  id?: unknown
  tags?: unknown
}

function resolveWeaponClassFromTags(tags: string): TowerWeaponClass | null {
  if (tags.includes('忍者')) return 'ninja'
  if (tags.includes('弓手')) return 'archer'
  if (tags.includes('冰法师')) return 'mage'
  if (tags.includes('剑士')) return 'warrior'
  return null
}

function buildDefIdToWeaponClassMap(): Map<string, TowerWeaponClass> {
  const out = new Map<string, TowerWeaponClass>()
  const list = Array.isArray(rawTowerItems) ? (rawTowerItems as TowerItemEntry[]) : []
  for (const one of list) {
    const id = typeof one.id === 'string' ? one.id.trim() : ''
    if (!id) continue
    const tags = typeof one.tags === 'string' ? one.tags : ''
    const weaponClass = resolveWeaponClassFromTags(tags)
    if (!weaponClass) continue
    out.set(id, weaponClass)
  }
  return out
}

const DEF_ID_TO_WEAPON_CLASS = buildDefIdToWeaponClassMap()

export function resolveTowerWeaponClass(defId: string): TowerWeaponClass | null {
  return DEF_ID_TO_WEAPON_CLASS.get(defId) ?? null
}
