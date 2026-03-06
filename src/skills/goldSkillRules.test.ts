import { describe, expect, it } from 'vitest'
import { calcSkill94DailyGoldBonus, shouldTriggerSkill48ExtraUpgrade } from '@/skills/goldSkillRules'

describe('gold skill shop rules', () => {
  it('skill48 仅在拥有技能且存在额外等级时按25%触发', () => {
    expect(shouldTriggerSkill48ExtraUpgrade(false, true, 0.01)).toBe(false)
    expect(shouldTriggerSkill48ExtraUpgrade(true, false, 0.01)).toBe(false)
    expect(shouldTriggerSkill48ExtraUpgrade(true, true, 0.24)).toBe(true)
    expect(shouldTriggerSkill48ExtraUpgrade(true, true, 0.25)).toBe(false)
  })

  it('skill94 每日金币+15%并向下取整', () => {
    expect(calcSkill94DailyGoldBonus(0)).toBe(0)
    expect(calcSkill94DailyGoldBonus(1)).toBe(0)
    expect(calcSkill94DailyGoldBonus(10)).toBe(1)
    expect(calcSkill94DailyGoldBonus(19)).toBe(2)
    expect(calcSkill94DailyGoldBonus(99)).toBe(14)
  })
})
