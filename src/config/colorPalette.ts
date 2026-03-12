import { getConfig } from '@/config/debugConfig'

function clampColor(value: number): number {
  const n = Math.round(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(0xffffff, n))
}

export function getTierColor(tier: string): number {
  if (tier === 'Bronze') return clampColor(getConfig('tierColorBronze'))
  if (tier === 'Silver') return clampColor(getConfig('tierColorSilver'))
  if (tier === 'Gold') return clampColor(getConfig('tierColorGold'))
  if (tier === 'Diamond') return clampColor(getConfig('tierColorDiamond'))
  return clampColor(getConfig('tierColorBronze'))
}

export function getBattleEffectColor(effect: 'hp' | 'hpBar' | 'hpText' | 'shield' | 'burn' | 'poison' | 'regen'): number {
  if (effect === 'hp') return clampColor(getConfig('battleColorHp'))
  if (effect === 'hpBar') return clampColor(getConfig('battleColorHpBar'))
  if (effect === 'hpText') return clampColor(getConfig('battleColorHpText'))
  if (effect === 'shield') return clampColor(getConfig('battleColorShield'))
  if (effect === 'burn') return clampColor(getConfig('battleColorBurn'))
  if (effect === 'poison') return clampColor(getConfig('battleColorPoison'))
  return clampColor(getConfig('battleColorRegen'))
}

export function getBattleOrbColor(effect: 'hp' | 'shield' | 'burn' | 'poison' | 'regen' | 'freeze' | 'slow' | 'haste'): number {
  if (effect === 'hp') return clampColor(getConfig('battleOrbColorHp'))
  if (effect === 'shield') return clampColor(getConfig('battleOrbColorShield'))
  if (effect === 'burn') return clampColor(getConfig('battleOrbColorBurn'))
  if (effect === 'poison') return clampColor(getConfig('battleOrbColorPoison'))
  if (effect === 'regen') return clampColor(getConfig('battleOrbColorRegen'))
  if (effect === 'freeze') return clampColor(getConfig('battleOrbColorFreeze'))
  if (effect === 'haste') return clampColor(getConfig('battleOrbColorHaste'))
  return clampColor(getConfig('battleOrbColorSlow'))
}

export function getBattleFloatTextColor(effect: 'damage' | 'crit' | 'shield' | 'burn' | 'poison' | 'regen'): number {
  if (effect === 'damage') return clampColor(getConfig('battleTextColorDamage'))
  if (effect === 'crit') return clampColor(getConfig('battleTextColorCrit'))
  if (effect === 'shield') return clampColor(getConfig('battleTextColorShield'))
  if (effect === 'burn') return clampColor(getConfig('battleTextColorBurn'))
  if (effect === 'poison') return clampColor(getConfig('battleTextColorPoison'))
  return clampColor(getConfig('battleTextColorRegen'))
}

export function getShopToastColors(): { bg: number; border: number } {
  return {
    bg:     clampColor(getConfig('shopToastBg')),
    border: clampColor(getConfig('shopToastBorder')),
  }
}

export function getShopUiColor(key: 'gold' | 'danger' | 'highlight'): number {
  if (key === 'gold')      return clampColor(getConfig('shopGoldColor'))
  if (key === 'danger')    return clampColor(getConfig('shopDangerColor'))
  return clampColor(getConfig('shopHighlightColor'))
}

export function getClassColor(className: string): number {
  if (className === 'Warrior' || className === '战士') return clampColor(getConfig('classColorWarrior'))
  if (className === 'Archer'  || className === '弓手') return clampColor(getConfig('classColorArcher'))
  if (className === 'Assassin'|| className === '刺客') return clampColor(getConfig('classColorAssassin'))
  return clampColor(getConfig('classColorNeutral'))
}
