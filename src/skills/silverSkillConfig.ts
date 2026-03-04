import silverSkillRaw from '../../data/skill_effects_silver_draft.json'

export type SilverSkillArchetype = 'warrior' | 'archer' | 'assassin' | 'utility'

export type SilverSkillPick = {
  id: string
  name: string
  icon: string
  archetype: SilverSkillArchetype
  desc: string
  detailDesc: string
  tier: 'silver'
}

function toArchetype(raw: unknown): SilverSkillArchetype {
  if (raw === 'warrior' || raw === 'archer' || raw === 'assassin' || raw === 'utility') return raw
  return 'utility'
}

const parsedSkills: SilverSkillPick[] = (() => {
  const root = silverSkillRaw as { skills?: Array<Record<string, unknown>> }
  const list = Array.isArray(root.skills) ? root.skills : []
  const out: SilverSkillPick[] = []
  for (const one of list) {
    const id = String(one.id ?? '').trim()
    if (!/^skill\d+$/.test(id)) continue
    const name = String(one.name ?? '').trim()
    if (!name) continue
    const icon = String(one.icon ?? id).trim() || id
    const tier = String(one.tier ?? '').trim()
    if (tier !== 'silver') continue
    const archetype = toArchetype(one.archetype)
    const desc = String(one.summary ?? '').trim()
    const detailRaw = String(one.detail ?? one.detailDesc ?? '').trim()
    const detailDesc = detailRaw || desc
    out.push({ id, name, icon, archetype, desc, detailDesc, tier: 'silver' })
  }
  return out
})()

export const SILVER_SKILL_PICKS: SilverSkillPick[] = parsedSkills
export const SILVER_SKILL_IDS = new Set<string>(parsedSkills.map((s) => s.id))

export function getSilverSkillById(id: string): SilverSkillPick | null {
  return SILVER_SKILL_PICKS.find((s) => s.id === id) ?? null
}
