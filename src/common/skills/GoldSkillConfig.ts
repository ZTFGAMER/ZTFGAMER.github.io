import goldSkillRaw from '../../../data/skill_effects_gold_draft.json'

export type GoldSkillArchetype = 'warrior' | 'archer' | 'assassin' | 'utility'

export type GoldSkillPick = {
  id: string
  name: string
  icon: string
  archetype: GoldSkillArchetype
  desc: string
  detailDesc: string
  tier: 'gold'
}

function toArchetype(raw: unknown): GoldSkillArchetype {
  if (raw === 'warrior' || raw === 'archer' || raw === 'assassin' || raw === 'utility') return raw
  return 'utility'
}

const parsedSkills: GoldSkillPick[] = (() => {
  const root = goldSkillRaw as { skills?: Array<Record<string, unknown>> }
  const list = Array.isArray(root.skills) ? root.skills : []
  const out: GoldSkillPick[] = []
  for (const one of list) {
    const id = String(one.id ?? '').trim()
    if (!/^skill\d+$/.test(id)) continue
    const name = String(one.name ?? '').trim()
    if (!name) continue
    const icon = String(one.icon ?? id).trim() || id
    const tier = String(one.tier ?? '').trim()
    if (tier !== 'gold') continue
    const archetype = toArchetype(one.archetype)
    const desc = String(one.summary ?? '').trim()
    const detailRaw = String(one.detail ?? one.detailDesc ?? '').trim()
    const detailDesc = detailRaw || desc
    out.push({ id, name, icon, archetype, desc, detailDesc, tier: 'gold' })
  }
  return out
})()

export const GOLD_SKILL_PICKS: GoldSkillPick[] = parsedSkills
export const GOLD_SKILL_IDS = new Set<string>(parsedSkills.map((s) => s.id))

export function getGoldSkillById(id: string): GoldSkillPick | null {
  return GOLD_SKILL_PICKS.find((s) => s.id === id) ?? null
}
