// ============================================================
// ItemDef — 物品数据类型定义（对应 vanessa_items.json 结构）
// ============================================================

export interface SkillText {
  en: string
  cn: string
}

export type ItemTier = 'Bronze' | 'Silver' | 'Gold' | 'Diamond'
export type ItemSizeRaw = 'Small / 小型' | 'Medium / 中型' | 'Large / 大型'
export type ItemSizeNorm = '1x1' | '1x2' | '2x2'

export interface ItemDef {
  id:               string
  name_en:          string
  name_cn:          string
  type:             string
  size:             ItemSizeRaw
  starting_tier:    string
  available_tiers:  string
  heroes:           string
  tags:             string          // "Aquatic / 水系 | Weapon / 武器" 格式
  hidden_tags:      string

  // 基础数值（毫秒 or 百分比 or 整数）
  cooldown:    number
  damage:      number
  heal:        number
  shield:      number
  ammo:        number               // 0 表示无限
  crit:        number
  multicast:   number
  burn:        number
  poison:      number
  regen:       number
  lifesteal:   number

  // 价格（由 DataLoader 结合 game_config 计算最终价格）
  buy_price:   number
  sell_price:  number

  skills:       SkillText[]
  enchantments: Record<string, { name_cn: string; effect_en: string; effect_cn: string }>
}

/** 将原始 size 字段标准化为 1x1 / 1x2 / 2x2 */
export function normalizeSize(raw: string): ItemSizeNorm {
  const s = raw.toLowerCase()
  if (s.includes('small'))  return '1x1'
  if (s.includes('medium')) return '1x2'
  if (s.includes('large'))  return '2x2'
  throw new Error(`Unknown item size: ${raw}`)
}

/** 解析 tags 字段为标签数组 */
export function parseTags(raw: string): string[] {
  if (!raw) return []
  return raw.split('|').map(t => {
    // "Aquatic / 水系" → "Aquatic"
    const parts = t.split('/').map(p => p.trim())
    return parts[0] ?? ''
  }).filter(Boolean)
}

// ---- GameConfig 类型（对应 game_config.json）---- //
export interface GameConfig {
  dailyGold:           number
  shopRefreshPrices:   number[]
  dailyBattleSlots:    number[]    // 随 Day 解锁的格数
  backpackSlots:       number
  dailyHealth:         number[]    // 每天敌方 HP
  sellPriceRatio:      number      // 0.5
  smallItemPrices:     number[]    // [铜,银,金,钻]
  mediumItemPrices:    number[]
  largeItemPrices:     number[]
  sellMinDaysByRarity: number[]    // 各品质最早可出售的 Day
  itemVisualScale:     number      // 装备显示缩放（5/6）
  shopTierChancesByDay: number[][] // Day -> [Bronze, Silver, Gold, Diamond] 百分比
  textSizes: {
    gridZoneLabel:    number
    shopButtonLabel:  number
    sellButtonSubPrice:number
    refreshCost:      number
    gold:             number
    dayDebugArrow:    number
    dayDebugLabel:    number
    shopItemName:     number
    shopItemPrice:    number
    shopItemBought:   number
    itemInfoName:     number
    itemInfoTier:     number
    itemInfoPrice:    number
    itemInfoDesc:     number
    synthTitle:       number
    synthName:        number
  }
}
