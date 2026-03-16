import type { ItemDef, SkillTier } from '@/common/items/ItemDef'
import { BRONZE_SKILL_PICKS } from './BronzeSkillConfig'
import { SILVER_SKILL_PICKS } from './SilverSkillConfig'
import { GOLD_SKILL_PICKS } from './GoldSkillConfig'

type SkillPickLite = {
  id: string
  name: string
  icon?: string
  archetype: 'warrior' | 'archer' | 'assassin' | 'utility'
  desc: string
  detailDesc?: string
  tier: SkillTier
}

const ALL_SKILL_PICKS: SkillPickLite[] = [
  ...BRONZE_SKILL_PICKS,
  ...SILVER_SKILL_PICKS,
  ...GOLD_SKILL_PICKS,
]

const SKILL_PICK_BY_ID = new Map<string, SkillPickLite>(ALL_SKILL_PICKS.map((it) => [it.id, it]))

const SKILL_ITEM_DEF_BY_ID = new Map<string, ItemDef>(ALL_SKILL_PICKS.map((pick) => [pick.id, toSkillItemDef(pick)]))

function toTierLabel(tier: SkillTier): string {
  if (tier === 'bronze') return 'Bronze'
  if (tier === 'silver') return 'Silver'
  return 'Gold'
}

function toSkillItemDef(pick: SkillPickLite): ItemDef {
  const tierLabel = toTierLabel(pick.tier)
  return {
    id: pick.id,
    name_en: pick.name,
    name_cn: pick.name,
    type: 'SkillItem / 技能物品',
    size: 'Small / 小型',
    starting_tier: tierLabel,
    available_tiers: tierLabel,
    heroes: 'Vanessa',
    tags: '中立/技能',
    hidden_tags: `skill_item/${pick.archetype}`,
    icon: pick.icon ?? pick.id,
    attack_style: '',
    attack_variants: [],
    cooldown: 0,
    cooldown_tiers: '',
    damage: 0,
    heal: 0,
    shield: 0,
    ammo: 0,
    crit: 0,
    multicast: 1,
    burn: 0,
    poison: 0,
    regen: 0,
    lifesteal: 0,
    buy_price: 0,
    sell_price: 0,
    skills: [{ en: pick.detailDesc ?? pick.desc, cn: pick.detailDesc ?? pick.desc }],
    simple_desc: pick.desc,
    simple_desc_tiered: pick.desc,
    enchantments: {},
  }
}

export function getAllSkillItemDefs(): ItemDef[] {
  return Array.from(SKILL_ITEM_DEF_BY_ID.values())
}

export function getSkillItemDefById(defId: string): ItemDef | null {
  return SKILL_ITEM_DEF_BY_ID.get(defId) ?? null
}

export function isSkillItemDefId(defId: string): boolean {
  return SKILL_ITEM_DEF_BY_ID.has(defId)
}

export function getSkillPickById(skillId: string): SkillPickLite | null {
  return SKILL_PICK_BY_ID.get(skillId) ?? null
}

export function getSkillIconStemById(skillId: string): string | null {
  const pick = getSkillPickById(skillId)
  if (!pick) return null
  const stem = String(pick.icon ?? pick.id).replace(/\.png$/i, '').trim()
  return stem || null
}
