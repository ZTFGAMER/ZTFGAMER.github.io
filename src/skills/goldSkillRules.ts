export function shouldTriggerSkill48ExtraUpgrade(hasSkill48: boolean, hasExtraUpgrade: boolean, rng: number): boolean {
  if (!hasSkill48) return false
  if (!hasExtraUpgrade) return false
  return rng < 0.2
}

export function calcSkill94DailyGoldBonus(currentGold: number): number {
  const safe = Math.max(0, Math.round(currentGold))
  return Math.max(0, Math.floor(safe * 0.15))
}
