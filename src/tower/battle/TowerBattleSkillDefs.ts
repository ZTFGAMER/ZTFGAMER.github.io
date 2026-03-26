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
  { id: 'td_skill_ninja_super_multicast', name: '手里剑·超级连发', archetype: '忍者', maxPick: 1, icon: 'toweritem1' },
  { id: 'td_skill_ninja_super_bounty', name: '手里剑·超级赏金', archetype: '忍者', maxPick: 1, icon: 'toweritem1' },
  { id: 'td_skill_ninja_super_heavy', name: '手里剑·超级重刃', archetype: '忍者', maxPick: 1, icon: 'toweritem1', requiresItemIcon: 'toweritem4' },
  { id: 'td_skill_ninja_super_bounce', name: '手里剑·超级弹射', archetype: '忍者', maxPick: 1, icon: 'toweritem1', requiresItemIcon: 'toweritem5' },

  { id: 'td_skill_archer_damage', name: '弓箭·伤害', archetype: '弓手', maxPick: 5, icon: 'toweritem7' },
  { id: 'td_skill_archer_cd', name: '弓箭·间隔', archetype: '弓手', maxPick: 5, icon: 'toweritem7' },
  { id: 'td_skill_archer_super_multicast', name: '弓箭·超级连发', archetype: '弓手', maxPick: 1, icon: 'toweritem7' },
  { id: 'td_skill_archer_super_zero', name: '弓箭·超级零射', archetype: '弓手', maxPick: 1, icon: 'toweritem7' },
  { id: 'td_skill_archer_super_poison', name: '弓箭·超级剧毒', archetype: '弓手', maxPick: 1, icon: 'toweritem7', requiresItemIcon: 'toweritem10' },
  { id: 'td_skill_archer_super_sniper', name: '弓箭·超级狙击', archetype: '弓手', maxPick: 1, icon: 'toweritem7', requiresItemIcon: 'toweritem11' },

  { id: 'td_skill_mage_damage', name: '冰锥·伤害', archetype: '冰法师', maxPick: 5, icon: 'toweritem13' },
  { id: 'td_skill_mage_cd', name: '冰锥·间隔', archetype: '冰法师', maxPick: 5, icon: 'toweritem13' },
  { id: 'td_skill_mage_super_multicast', name: '冰锥·超级减速', archetype: '冰法师', maxPick: 1, icon: 'toweritem13' },
  { id: 'td_skill_mage_super_multitarget', name: '冰锥·超级多发', archetype: '冰法师', maxPick: 1, icon: 'toweritem13' },
  { id: 'td_skill_mage_super_freeze', name: '冰锥·超级冰冻', archetype: '冰法师', maxPick: 1, icon: 'toweritem13', requiresItemIcon: 'toweritem16' },
  { id: 'td_skill_mage_super_explode', name: '冰锥·超级爆炸', archetype: '冰法师', maxPick: 1, icon: 'toweritem13', requiresItemIcon: 'toweritem17' },

  { id: 'td_skill_warrior_damage', name: '长剑·伤害', archetype: '剑士', maxPick: 5, icon: 'toweritem19' },
  { id: 'td_skill_warrior_cd', name: '长剑·间隔', archetype: '剑士', maxPick: 5, icon: 'toweritem19' },
  { id: 'td_skill_warrior_super_multicast', name: '长剑·超级连发', archetype: '剑士', maxPick: 1, icon: 'toweritem19' },
  { id: 'td_skill_warrior_super_guard', name: '长剑·超级守护', archetype: '剑士', maxPick: 1, icon: 'toweritem19' },
  { id: 'td_skill_warrior_super_bleed', name: '长剑·超级重伤', archetype: '剑士', maxPick: 1, icon: 'toweritem19', requiresItemIcon: 'toweritem21' },
  { id: 'td_skill_warrior_super_dual', name: '长剑·超级双持', archetype: '剑士', maxPick: 1, icon: 'toweritem19', requiresItemIcon: 'toweritem23' },
]

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
  const totals: Record<TowerSkillArchetype, number> = { 忍者: 0, 弓手: 0, 冰法师: 0, 剑士: 0 }
  for (const meta of metaByInstanceId.values()) {
    const def = getItemDefById(meta.defId)
    if (!def) continue
    const arch = getArchetypeFromDef(def)
    if (!arch) continue
    const lv = Math.max(1, Math.round(Number(meta.level) || 1))
    totals[arch] += lv
  }
  let best: TowerSkillArchetype = '忍者'
  let bestVal = -1
  for (const one of ['忍者', '弓手', '冰法师', '剑士'] as const) {
    const v = totals[one]
    if (v > bestVal) {
      bestVal = v
      best = one
    }
  }
  return best
}

export function canPickTowerBattleSkill(def: TowerBattleSkillDef, pickedCounts: Map<string, number>, itemIconsOnBoard: Set<string>): boolean {
  const cur = Math.max(0, Math.round(pickedCounts.get(def.id) ?? 0))
  if (cur >= def.maxPick) return false
  if (def.id.includes('_super_')) {
    let totalPicked = 0
    for (const v of pickedCounts.values()) totalPicked += Math.max(0, Math.round(Number(v) || 0))
    if (totalPicked <= 2) return false
  }
  if (def.requiresItemIcon && !itemIconsOnBoard.has(def.requiresItemIcon)) return false
  return true
}

export function pickTowerBattleSkillChoices(
  pickedCounts: Map<string, number>,
  guaranteedArchetype: TowerSkillArchetype,
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
  let totalPicked = 0
  for (const v of pickedCounts.values()) totalPicked += Math.max(0, Math.round(Number(v) || 0))
  if (totalPicked < 3) {
    const guaranteedPool = all.filter((s) => s.archetype === guaranteedArchetype)
    const guaranteed = pickRandom(guaranteedPool)
    if (guaranteed) out.push(guaranteed)
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
