import type { ItemDef } from '@/common/items/ItemDef'

export type ItemEnchantmentKey =
  | 'damage'
  | 'shield'
  | 'heal'
  | 'shiny'
  | 'haste'
  | 'slow'
  | 'freeze'
  | 'immune'

export type ItemEnchantmentDisplay = {
  key: ItemEnchantmentKey
  nameCn: string
  titleSuffixCn: string
  stoneNameCn: string
  icon: string
}

const ENCHANTMENT_DISPLAY_MAP: Record<ItemEnchantmentKey, ItemEnchantmentDisplay> = {
  damage: { key: 'damage', nameCn: '伤害附魔', titleSuffixCn: '伤害', stoneNameCn: '伤害宝石', icon: 'buff1' },
  shield: { key: 'shield', nameCn: '护盾附魔', titleSuffixCn: '护盾', stoneNameCn: '护盾宝石', icon: 'buff2' },
  heal: { key: 'heal', nameCn: '回复附魔', titleSuffixCn: '回复', stoneNameCn: '回复宝石', icon: 'buff3' },
  shiny: { key: 'shiny', nameCn: '闪亮附魔', titleSuffixCn: '闪亮', stoneNameCn: '闪亮宝石', icon: 'buff4' },
  haste: { key: 'haste', nameCn: '加速附魔', titleSuffixCn: '加速', stoneNameCn: '加速宝石', icon: 'buff5' },
  slow: { key: 'slow', nameCn: '减速附魔', titleSuffixCn: '减速', stoneNameCn: '减速宝石', icon: 'buff6' },
  freeze: { key: 'freeze', nameCn: '冰冻附魔', titleSuffixCn: '冰冻', stoneNameCn: '冰冻宝石', icon: 'buff7' },
  immune: { key: 'immune', nameCn: '免疫附魔', titleSuffixCn: '免疫', stoneNameCn: '免疫宝石', icon: 'buff8' },
}

const STONE_NAME_TO_KEY: Record<string, ItemEnchantmentKey> = {
  伤害宝石: 'damage',
  护盾宝石: 'shield',
  回复宝石: 'heal',
  闪亮宝石: 'shiny',
  加速宝石: 'haste',
  减速宝石: 'slow',
  冰冻宝石: 'freeze',
  免疫宝石: 'immune',
}

type EnchantBaseType = 'damage' | 'shield' | 'heal' | 'support'

function getEnchantBaseType(item: ItemDef): EnchantBaseType {
  const damage = Math.max(0, Number(item.damage || 0))
  const shield = Math.max(0, Number(item.shield || 0))
  const heal = Math.max(0, Number(item.heal || 0))
  if (damage > 0 && damage >= shield && damage >= heal) return 'damage'
  if (shield > 0 && shield >= damage && shield >= heal) return 'shield'
  if (heal > 0 && heal >= damage && heal >= shield) return 'heal'
  return 'support'
}

export function isEnchantmentStoneName(nameCn: string): boolean {
  return Boolean(STONE_NAME_TO_KEY[String(nameCn || '').trim()])
}

export function getEnchantmentKeyByStoneName(nameCn: string): ItemEnchantmentKey | null {
  return STONE_NAME_TO_KEY[String(nameCn || '').trim()] ?? null
}

export function getItemEnchantmentDisplay(key: ItemEnchantmentKey): ItemEnchantmentDisplay {
  return ENCHANTMENT_DISPLAY_MAP[key]
}

export function resolveItemEnchantmentEffectCn(item: ItemDef, key: ItemEnchantmentKey): string {
  const fromConfig = item.enchantments?.[key]?.effect_cn
  if (typeof fromConfig === 'string' && fromConfig.trim()) return fromConfig.trim()
  const baseType = getEnchantBaseType(item)
  if (key === 'haste') return '加速1件物品2秒'
  if (key === 'slow') return '减速1件物品2秒'
  if (key === 'freeze') return '冰冻1件物品1秒'
  if (key === 'immune') return '免疫减速、冰冻和摧毁'
  if (key === 'shiny') {
    if (baseType === 'support') return '技能效果翻倍'
    return '连发次数+1'
  }
  if (key === 'damage') {
    if (baseType === 'shield') return '获得等同于护盾的伤害'
    if (baseType === 'heal') return '获得等同于加血值的伤害'
    if (baseType === 'support') return '相邻物品伤害+50%'
    return '造成伤害翻倍'
  }
  if (key === 'shield') {
    if (baseType === 'damage') return '获得等同于伤害的护盾'
    if (baseType === 'heal') return '获得等同于加血值的护盾'
    if (baseType === 'support') return '相邻物品护盾+50%'
    return '获得护盾翻倍'
  }
  if (baseType === 'damage') return '获得等同于伤害的加血'
  if (baseType === 'shield') return '获得等同于护盾的加血'
  if (baseType === 'support') return '相邻物品加血+50%'
  return '获得加血翻倍'
}
