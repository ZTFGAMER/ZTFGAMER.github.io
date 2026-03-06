import bronzeSkillRaw from '../../data/skill_effects_bronze_draft.json'

export type BronzeSkillArchetype = 'warrior' | 'archer' | 'assassin' | 'utility'

export type BronzeSkillId =
  | 'skill1'
  | 'skill2'
  | 'skill3'
  | 'skill4'
  | 'skill5'
  | 'skill6'
  | 'skill7'
  | 'skill8'
  | 'skill9'
  | 'skill10'
  | 'skill11'
  | 'skill12'
  | 'skill13'
  | 'skill14'
  | 'skill15'
  | 'skill16'
  | 'skill18'
  | 'skill19'
  | 'skill20'
  | 'skill21'

export type BronzeSkillPick = {
  id: BronzeSkillId
  name: string
  icon: string
  archetype: BronzeSkillArchetype
  desc: string
  detailDesc: string
  tier: 'bronze'
}

const BRONZE_DETAIL_DESC_BY_ID: Partial<Record<BronzeSkillId, string>> = {
  skill1: '战斗开始时，最左侧的护盾物品+25护盾。',
  skill2: '战斗开始时，最右侧的护盾物品+25护盾。',
  skill3: '战斗开始时，所有护盾物品+10护盾。',
  skill4: '使用护盾物品时，相邻物品伤害+4。',
  skill5: '使用护盾物品时该物品护盾+7。',
  skill6: '所有物品的间隔时间缩短5%。',
  skill7: '最大生命值增加10%。',
  skill8: '战斗开始时，最左侧的弹药物品+2最大弹药量。',
  skill9: '每场战斗首次弹药耗尽时，装填3发弹药。',
  skill10: '战斗开始时，拥有弹药的物品伤害+10。',
  skill11: '使用弹药物品时，相邻的物品伤害+5。',
  skill12: '弹药物品间隔时间缩短10%。',
  skill13: '每场战斗前5秒内，所有物品伤害+12。',
  skill14: '每场战斗前5秒内，所有物品间隔时间缩短10%。',
  skill15: '购买物品价格有25%几率减少1。',
  skill16: '战斗开始时，物品伤害+8。',
  skill18: '每场战斗敌人生命值首次降至一半时，所有物品伤害+15。',
  skill19: '战斗开始时，最左侧和最右侧的物品伤害+12。',
  skill20: '每天随机获得1个青铜Lv1物品。',
  skill21: '每场战斗己方生命值首次降至一半时，回复15%生命。',
}

function toArchetype(raw: unknown): BronzeSkillArchetype {
  if (raw === 'warrior' || raw === 'archer' || raw === 'assassin' || raw === 'utility') return raw
  return 'utility'
}

const parsedSkills: BronzeSkillPick[] = (() => {
  const root = bronzeSkillRaw as { skills?: Array<Record<string, unknown>> }
  const list = Array.isArray(root.skills) ? root.skills : []
  const out: BronzeSkillPick[] = []
  for (const one of list) {
    const idRaw = String(one.id ?? '').trim()
    if (!/^skill\d+$/.test(idRaw)) continue
    if (idRaw === 'skill17') continue
    const id = idRaw as BronzeSkillId
    const name = String(one.name ?? '').trim()
    if (!name) continue
    const icon = String(one.icon ?? id).trim() || id
    const tier = String(one.tier ?? '').trim()
    if (tier !== 'bronze') continue
    const archetype = toArchetype(one.archetype)
    const desc = String(one.summary ?? '').trim()
    const detailRaw = String(one.detail ?? one.detailDesc ?? '').trim()
    const detailDesc = detailRaw || BRONZE_DETAIL_DESC_BY_ID[id] || desc
    out.push({ id, name, icon, archetype, desc, detailDesc, tier: 'bronze' })
  }
  return out
})()

export const BRONZE_SKILL_PICKS: BronzeSkillPick[] = parsedSkills
export const BRONZE_SKILL_IDS = new Set<string>(parsedSkills.map((s) => s.id))

export function isBronzeSkillId(id: string): id is BronzeSkillId {
  return BRONZE_SKILL_IDS.has(id)
}

export function getBronzeSkillById(id: string): BronzeSkillPick | null {
  return BRONZE_SKILL_PICKS.find((s) => s.id === id) ?? null
}

export function getBronzeSkillByName(name: string): BronzeSkillPick | null {
  const n = `${name}`.trim()
  if (!n) return null
  return BRONZE_SKILL_PICKS.find((s) => s.name === n) ?? null
}
