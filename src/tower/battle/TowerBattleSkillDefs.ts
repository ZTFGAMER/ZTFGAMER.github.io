import type { ItemDef } from '@/tower/common/items/ItemDef'
import { getItemDefById } from '@/tower/shop/systems/ShopSynthesisLogic'

export type TowerSkillArchetype = '忍者' | '弓手' | '冰法师' | '剑士'

export type TowerBattleSkillDef = {
  id: string
  name: string
  archetype: TowerSkillArchetype
  maxPick: number
  icon: string
  requiresItemIcon?: string
}

export const TOWER_BATTLE_SKILL_DEFS: TowerBattleSkillDef[] = [
  { id: 'td_skill_ninja_damage', name: '手里剑·伤害', archetype: '忍者', maxPick: 5, icon: 'toweritem1' },
  { id: 'td_skill_ninja_cd', name: '手里剑·间隔', archetype: '忍者', maxPick: 5, icon: 'toweritem1' },
  { id: 'td_skill_ninja_super_bounce', name: '手里剑·超级弹射', archetype: '忍者', maxPick: 1, icon: 'toweritem1', requiresItemIcon: 'toweritem2' },
  { id: 'td_skill_ninja_super_multicast', name: '手里剑·超级连发', archetype: '忍者', maxPick: 1, icon: 'toweritem1', requiresItemIcon: 'toweritem3' },
  { id: 'td_skill_ninja_super_heavy', name: '手里剑·超级重型', archetype: '忍者', maxPick: 1, icon: 'toweritem1', requiresItemIcon: 'toweritem4' },
  { id: 'td_skill_ninja_super_crystal', name: '手里剑·超级水晶', archetype: '忍者', maxPick: 1, icon: 'toweritem1', requiresItemIcon: 'toweritem5' },
  { id: 'td_skill_ninja_super_split', name: '手里剑·超级分裂', archetype: '忍者', maxPick: 1, icon: 'toweritem1', requiresItemIcon: 'toweritem6' },

  { id: 'td_skill_archer_damage', name: '弓箭·伤害', archetype: '弓手', maxPick: 5, icon: 'toweritem7' },
  { id: 'td_skill_archer_cd', name: '弓箭·间隔', archetype: '弓手', maxPick: 5, icon: 'toweritem7' },
  { id: 'td_skill_archer_super_high_damage', name: '弓箭·超级高伤', archetype: '弓手', maxPick: 1, icon: 'toweritem7', requiresItemIcon: 'toweritem8' },
  { id: 'td_skill_archer_super_multicast', name: '弓箭·超级连发', archetype: '弓手', maxPick: 1, icon: 'toweritem7', requiresItemIcon: 'toweritem9' },
  { id: 'td_skill_archer_super_poison', name: '弓箭·超级中毒', archetype: '弓手', maxPick: 1, icon: 'toweritem7', requiresItemIcon: 'toweritem10' },
  { id: 'td_skill_archer_super_sniper', name: '弓箭·超级狙击', archetype: '弓手', maxPick: 1, icon: 'toweritem7', requiresItemIcon: 'toweritem11' },
  { id: 'td_skill_archer_super_blood', name: '弓箭·超级嗜血', archetype: '弓手', maxPick: 1, icon: 'toweritem7', requiresItemIcon: 'toweritem12' },

  { id: 'td_skill_mage_damage', name: '冰锥·伤害', archetype: '冰法师', maxPick: 5, icon: 'toweritem13' },
  { id: 'td_skill_mage_cd', name: '冰锥·间隔', archetype: '冰法师', maxPick: 5, icon: 'toweritem13' },
  { id: 'td_skill_mage_super_slow', name: '冰锥·超级减速', archetype: '冰法师', maxPick: 1, icon: 'toweritem13', requiresItemIcon: 'toweritem14' },
  { id: 'td_skill_mage_super_multitarget', name: '冰锥·超级多发', archetype: '冰法师', maxPick: 1, icon: 'toweritem13', requiresItemIcon: 'toweritem15' },
  { id: 'td_skill_mage_super_freeze', name: '冰锥·超级冰冻', archetype: '冰法师', maxPick: 1, icon: 'toweritem13', requiresItemIcon: 'toweritem16' },
  { id: 'td_skill_mage_super_explode', name: '冰锥·超级爆炸', archetype: '冰法师', maxPick: 1, icon: 'toweritem13', requiresItemIcon: 'toweritem17' },
  { id: 'td_skill_mage_super_counter', name: '冰锥·超级反击', archetype: '冰法师', maxPick: 1, icon: 'toweritem13', requiresItemIcon: 'toweritem18' },

  { id: 'td_skill_warrior_damage', name: '长剑·伤害', archetype: '剑士', maxPick: 5, icon: 'toweritem19' },
  { id: 'td_skill_warrior_cd', name: '长剑·间隔', archetype: '剑士', maxPick: 5, icon: 'toweritem19' },
  { id: 'td_skill_warrior_super_range', name: '长剑·超级伸缩', archetype: '剑士', maxPick: 1, icon: 'toweritem19', requiresItemIcon: 'toweritem20' },
  { id: 'td_skill_warrior_super_guard', name: '长剑·超级守护', archetype: '剑士', maxPick: 1, icon: 'toweritem19', requiresItemIcon: 'toweritem22' },
  { id: 'td_skill_warrior_super_bleed', name: '长剑·超级重伤', archetype: '剑士', maxPick: 1, icon: 'toweritem19', requiresItemIcon: 'toweritem21' },
  { id: 'td_skill_warrior_super_dual', name: '长剑·超级双持', archetype: '剑士', maxPick: 1, icon: 'toweritem19', requiresItemIcon: 'toweritem23' },
  { id: 'td_skill_warrior_super_counter', name: '长剑·超级反击', archetype: '剑士', maxPick: 1, icon: 'toweritem19', requiresItemIcon: 'toweritem24' },
]

const TOWER_SKILL_ARCHETYPES: TowerSkillArchetype[] = ['忍者', '弓手', '冰法师', '剑士']

const SKILL_BY_ID = new Map(TOWER_BATTLE_SKILL_DEFS.map((s) => [s.id, s] as const))

export function getTowerBattleSkillById(id: string): TowerBattleSkillDef | null {
  return SKILL_BY_ID.get(id) ?? null
}

export function getTowerBattleSkillCountByArchetype(counts: Map<string, number>): Record<TowerSkillArchetype, number> {
  const out: Record<TowerSkillArchetype, number> = { 忍者: 0, 弓手: 0, 冰法师: 0, 剑士: 0 }
  for (const one of TOWER_BATTLE_SKILL_DEFS) {
    out[one.archetype] += Math.max(0, Math.round(counts.get(one.id) ?? 0))
  }
  return out
}

export function getHighestArchetypeByTotalItemLevel(metaByInstanceId: Map<string, { defId: string; level?: number; tier?: string; tierStar?: 1 | 2 }>): TowerSkillArchetype {
  return getTopArchetypesByTotalItemLevel(metaByInstanceId)[0] ?? '忍者'
}

export function getTopArchetypesByTotalItemLevel(metaByInstanceId: Map<string, { defId: string; level?: number; tier?: string; tierStar?: 1 | 2 }>): TowerSkillArchetype[] {
  const totals: Record<TowerSkillArchetype, number> = { 忍者: 0, 弓手: 0, 冰法师: 0, 剑士: 0 }
  for (const meta of metaByInstanceId.values()) {
    const def = getItemDefById(meta.defId)
    if (!def) continue
    const arch = getArchetypeFromDef(def)
    if (!arch) continue
    const lv = Math.max(1, Math.round(Number(meta.level) || 1))
    totals[arch] += lv
  }
  const active = TOWER_SKILL_ARCHETYPES.filter((arch) => totals[arch] > 0)
  const source = active.length > 0 ? active : TOWER_SKILL_ARCHETYPES
  return source.slice().sort((a, b) => {
    const dv = totals[b] - totals[a]
    if (dv !== 0) return dv
    return TOWER_SKILL_ARCHETYPES.indexOf(a) - TOWER_SKILL_ARCHETYPES.indexOf(b)
  })
}

export function canPickTowerBattleSkill(def: TowerBattleSkillDef, pickedCounts: Map<string, number>, itemIconsOnBoard: Set<string>): boolean {
  const cur = Math.max(0, Math.round(pickedCounts.get(def.id) ?? 0))
  if (cur >= def.maxPick) return false
  if (def.requiresItemIcon && !itemIconsOnBoard.has(def.requiresItemIcon)) return false
  if (isBaseDamageOrCdSkill(def.id) && !hasAnyArchetypeIconOnBoard(def.archetype, itemIconsOnBoard)) return false
  return true
}

function isBaseDamageOrCdSkill(id: string): boolean {
  return id === 'td_skill_ninja_damage'
    || id === 'td_skill_ninja_cd'
    || id === 'td_skill_archer_damage'
    || id === 'td_skill_archer_cd'
    || id === 'td_skill_mage_damage'
    || id === 'td_skill_mage_cd'
    || id === 'td_skill_warrior_damage'
    || id === 'td_skill_warrior_cd'
}

function hasAnyArchetypeIconOnBoard(archetype: TowerSkillArchetype, itemIconsOnBoard: Set<string>): boolean {
  const iconList = archetype === '忍者'
    ? ['toweritem1', 'toweritem2', 'toweritem3', 'toweritem4', 'toweritem5', 'toweritem6']
    : archetype === '弓手'
      ? ['toweritem7', 'toweritem8', 'toweritem9', 'toweritem10', 'toweritem11', 'toweritem12']
      : archetype === '冰法师'
        ? ['toweritem13', 'toweritem14', 'toweritem15', 'toweritem16', 'toweritem17', 'toweritem18']
        : ['toweritem19', 'toweritem20', 'toweritem21', 'toweritem22', 'toweritem23', 'toweritem24']
  return iconList.some((icon) => itemIconsOnBoard.has(icon))
}

export function pickTowerBattleSkillChoices(
  pickedCounts: Map<string, number>,
  guaranteedArchetype: TowerSkillArchetype,
  secondaryGuaranteedArchetype: TowerSkillArchetype,
  itemIconsOnBoard: Set<string>,
  random: () => number,
): TowerBattleSkillDef[] {
  const all = TOWER_BATTLE_SKILL_DEFS.filter((s) => canPickTowerBattleSkill(s, pickedCounts, itemIconsOnBoard))
  if (all.length <= 0) return []
  const pickRandom = (pool: TowerBattleSkillDef[]): TowerBattleSkillDef | null => {
    if (pool.length <= 0) return null
    const idx = Math.max(0, Math.min(pool.length - 1, Math.floor(random() * pool.length)))
    return pool[idx] ?? null
  }
  const out: TowerBattleSkillDef[] = []
  const pickGuaranteedByArchetype = (archetype: TowerSkillArchetype): TowerBattleSkillDef | null => {
    const pool = all.filter((s) => s.archetype === archetype && !out.some((x) => x.id === s.id))
    return pickRandom(pool)
  }
  const firstGuaranteed = pickGuaranteedByArchetype(guaranteedArchetype)
  if (firstGuaranteed) out.push(firstGuaranteed)
  if (out.length < 2) {
    let secondGuaranteed = pickGuaranteedByArchetype(secondaryGuaranteedArchetype)
    if (!secondGuaranteed && secondaryGuaranteedArchetype !== guaranteedArchetype) {
      secondGuaranteed = pickGuaranteedByArchetype(guaranteedArchetype)
    }
    if (secondGuaranteed) out.push(secondGuaranteed)
  }
  const remainPool = all.filter((s) => !out.some((x) => x.id === s.id))
  while (out.length < 3 && remainPool.length > 0) {
    const one = pickRandom(remainPool)
    if (!one) break
    out.push(one)
    const idx = remainPool.findIndex((x) => x.id === one.id)
    if (idx >= 0) remainPool.splice(idx, 1)
  }
  return out
}

export function getTowerBattleSkillBuyCost(nextBuyCount: number, table: number[]): number {
  const n = Math.max(1, Math.round(nextBuyCount))
  const list = Array.isArray(table) && table.length > 0 ? table : [10, 14, 20, 27, 38, 54, 75, 105, 148, 207, 289, 405, 567, 794, 1112]
  const idx = Math.max(0, Math.min(list.length - 1, n - 1))
  return Math.max(1, Math.round(Number(list[idx]) || 1))
}

function getArchetypeFromDef(def: ItemDef): TowerSkillArchetype | null {
  const tags = `${def.tags ?? ''}`
  if (tags.includes('忍者')) return '忍者'
  if (tags.includes('弓手')) return '弓手'
  if (tags.includes('冰法师')) return '冰法师'
  if (tags.includes('剑士') || tags.includes('战士')) return '剑士'
  return null
}
