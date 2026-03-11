// ============================================================
// ItemDef — 物品数据类型定义（对应 vanessa_items.json 结构）
// ============================================================

export interface SkillText {
  en: string
  cn: string
}

export type ItemTier = 'Bronze' | 'Silver' | 'Gold' | 'Diamond'
export type ItemSizeRaw = 'Small / 小型' | 'Medium / 中型' | 'Large / 大型'
export type ItemSizeNorm = '1x1' | '2x1' | '3x1'
export type SkillArchetype = 'warrior' | 'archer' | 'assassin' | 'utility'
export type SkillTier = 'bronze' | 'silver' | 'gold'

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
  icon?:            string
  attack_style?:    string
  attack_variants?: string[]

  // 基础数值（毫秒 or 百分比 or 整数）
  cooldown:    number
  cooldown_tiers?: string
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
  simple_desc?: string
  simple_desc_tiered?: string
  enchantments: Record<string, { name_cn: string; effect_en: string; effect_cn: string }>
}

/** 将原始 size 字段标准化为 1x1 / 2x1 / 3x1 */
export function normalizeSize(raw: string): ItemSizeNorm {
  const s = raw.toLowerCase()
  if (s.includes('small'))  return '1x1'
  if (s.includes('medium')) return '2x1'
  if (s.includes('large'))  return '3x1'
  throw new Error(`Unknown item size: ${raw}`)
}

/** 解析 tags 字段为标签数组 */
export function parseTags(raw: string): string[] {
  if (!raw) return []

  // 兼容两种来源：
  // - 旧格式："Aquatic / 水系 | Weapon / 武器"
  // - 新格式："多武器/加速"（使用 / 作为分隔）
  const parts = raw.includes('|')
    ? raw.split('|')
    : raw.split('/')

  return parts
    .map(t => t.trim())
    .map(t => {
      // 旧格式里单段仍可能含语言分隔："Aquatic / 水系" → "Aquatic"
      if (t.includes('/') && raw.includes('|')) {
        const segs = t.split('/').map(p => p.trim())
        return segs[0] ?? ''
      }
      return t
    })
    .filter(Boolean)
}

// ---- GameConfig 类型（对应 game_config.json）---- //
export interface GameConfig {
  dailyGold:           number
  dailyGoldByDay?:     number[]
  shopRefreshPrices:   number[]
  dailyBattleSlots:    number[]    // 随 Day 解锁的格数
  backpackSlots:       number
  dailyHealth:         number[]    // 每天敌方 HP
  dailyEnemyHealth?:   number[]
  dailyPlayerHealth?:  number[]
  sellPriceRatio:      number      // 0.5
  smallItemPrices:     number[]    // [铜,银,金,钻]
  mediumItemPrices:    number[]
  largeItemPrices:     number[]
  sellMinDaysByRarity: number[]    // 各品质最早可出售的 Day
  itemVisualScale:     number      // 装备显示缩放（5/6）
  shopTierChancesByDay: number[][] // Day -> [Bronze, Silver, Gold, Diamond] 百分比
  gameplayModeValues?: {
    compactMode?: {
      enabled?: boolean
      itemSet?: 'default' | 'compact'
      cellScale?: number
      cellHeightRatio?: number
      squareCell?: boolean
      backpackRows?: number
      battleCols?: number
      mediumValueScale?: number
    }
    enemyDraftLab?: {
      enabled?: boolean
      sameArchetypeBias?: number
      dailyItemCount?: number[]
      dailyAvgQuality?: number[]
    }
    battleUi?: {
      showSpeedButton?: boolean
    }
  }
  runRules?: {
    trophyWinsToFinalVictory?: number
    muteLogsInMobileRelease?: boolean
    playerExpToNextLevel?: number[]
    playerMaxLifeByLevel?: number[]
    playerRoundDamageByLevel?: number[]
  }
  skillSystem?: {
    dailyDraftPlan?: Array<{
      day: number
      shouldDraft: number
      bronzeProb: number
      silverProb: number
      goldProb: number
      onlyStarterArchetype: number
      shouldEvent?: number
      shouldShop?: number
    }>
    triggerDaysByTier: {
      bronze: number[]
      silver: number[]
      gold: number[]
    }
    chooseCount: number
    enemyMirrorDraft?: {
      enabled?: boolean
      pickCountByDay?: number[]
      mainArchetypeRatioMin?: number
      mainArchetypeRatioMax?: number
    }
    pools: {
      bronze: Array<{
        id: string
        name: string
        archetype: SkillArchetype
        desc: string
      }>
      silver: Array<{
        id: string
        name: string
        archetype: SkillArchetype
        desc: string
      }>
      gold: Array<{
        id: string
        name: string
        archetype: SkillArchetype
        desc: string
      }>
    }
  }
  eventSystem?: {
    eventPool?: Array<{
      id: string
      enabled?: boolean
      dayStart: number
      dayEnd: number
      icon: string
      lane: 'left' | 'right'
      shortDesc: string
      detailDesc: string
      note?: string
      limits?: {
        maxSelectionsPerRun?: number
      }
      conditions?: {
        requireArchetypeOwned?: 'warrior' | 'archer' | 'assassin'
        requireHeartNotFull?: boolean
        requireBackpackNotEmpty?: boolean
        requireBattleNotEmpty?: boolean
        requireBattleArchetypeTopTie?: 'warrior' | 'archer' | 'assassin'
      }
    }>
  }
  shopRules?: {
    ammoSupportRequiresAmmoOwned?: boolean
    ammoSupportItemNames?: string[]
    day1ThirdItemMatchExistingArchetype?: boolean
    shopSizeWeights?: {
      small?: number
      medium?: number
      large?: number
    }
    quickBuyByDay?: Array<{
      dayStart: number
      dayEnd: number
      weights: {
        bronze1: number
        bronze2: number
        silver1: number
      }
      ownedWeightMultiplier?: number
    }>
    quickBuyLevelChancesByDay?: number[][]
    qualityLevelRange?: {
      Bronze?: { min?: number; max?: number }
      Silver?: { min?: number; max?: number }
      Gold?: { min?: number; max?: number }
      Diamond?: { min?: number; max?: number }
    }
    qualityPseudoRandomWindowSize?: number
    qualityPseudoRandomWeightsByLevel?: {
      Bronze?: number[]
      Silver?: number[]
      Gold?: number[]
      Diamond?: number[]
    }
    quickBuyQualityWeightsByLevel?: {
      Bronze?: number[]
      Silver?: number[]
      Gold?: number[]
      Diamond?: number[]
    }
    quickBuyNeutralChance?: number
    quickBuyNeutralStartDay?: number
    quickBuyNeutralPseudoRandomChances?: number[]
    quickBuyPriceMultiplier?: {
      [tierStar: string]: number
    }
    quickBuyFixedPrice?: {
      [tierStar: string]: number
    }
    itemPrerequisites?: {
      [itemKey: string]: string[]
    }
    sellRatioByTier?: {
      Bronze?: number
      Silver?: number
      Gold?: number
      Diamond?: number
    }
    initialUnlocksByStarterClass?: {
      swordsman?: string[]
      archer?: string[]
      assassin?: string[]
    }
    unlockStartingTierWeights?: {
      Bronze?: number
      Silver?: number
      Gold?: number
      Diamond?: number
    }
    crossIdSynthesisSameArchetypeChance?: number
    minTierDropWeightsByResultLevel?: {
      Bronze?: number[]
      Silver?: number[]
      Gold?: number[]
      Diamond?: number[]
    }
    synthesisMinTierDropWeightsByResultLevel?: {
      Bronze?: number[]
      Silver?: number[]
      Gold?: number[]
      Diamond?: number[]
    }
    crossIdSynthesisRequireConfirm?: boolean
    sellFixedPriceBySize?: {
      small?: number[]
      medium?: number[]
      large?: number[]
    }
  }
  textSizes: {
    gridZoneLabel:    number
    shopButtonLabel:  number
    phaseButtonLabel: number
    battleBackButtonLabel: number
    battleTextDamage: number
    battleTextCrit: number
    battleStatusTimer: number
    sellButtonSubPrice:number
    refreshCost:      number
    gold:             number
    dayDebugArrow:    number
    dayDebugLabel:    number
    shopItemName:     number
    shopItemPrice:    number
    shopItemBought:   number
    itemStatBadge:    number
    itemTierStar:     number
    itemInfoName:     number
    itemInfoTier:     number
    itemInfoPrice:    number
    itemInfoPriceCorner: number
    itemInfoCooldown: number
    itemInfoDesc:     number
    itemInfoSimpleDesc: number
    synthTitle:       number
    synthName:        number
  }
  pvpRules?: {
    initialHp: number
    maxRounds: number
    baseDamage: number
    tierDamageWeights: { Bronze: number; Silver: number; Gold: number; Diamond: number }
  }
  combatRuntime: {
    tickMs: number
    fatigueStartMs: number
    fatigueTickMs: number
    fatigueBaseValue: number
    fatigueDoubleEveryMs: number
    fatigueIntervalMs?: number
    fatigueDamagePctPerInterval?: number
    fatigueDamageFixedPerInterval?: number
    fatigueDamagePctRampPerInterval?: number
    fatigueDamageFixedRampPerInterval?: number
    timeoutMs?: number
    fatigueDamagePctPerSec?: number
    critMultiplier: number
    burnTickMs: number
    poisonTickMs: number
    regenTickMs: number
    burnShieldFactor: number
    burnDecayPct: number
    healCleansePct: number
    cardSlowMs?: number
    cardFreezeMs?: number
    cardHasteMs?: number
    cardSlowFactor?: number
    cardHasteFactor?: number
    enemyByDay?: Array<{
      dayStart: number
      dayEnd: number
      itemNames: string[]
    }>
    enemyTeachingByDay?: Array<{
      dayStart: number
      dayEnd: number
      templates: Array<{
        name?: string
        focus?: string
        placements: Array<{
          itemName: string
          col: number
          tier?: 'Bronze' | 'Silver' | 'Gold' | 'Diamond'
          star?: 1 | 2
        }>
      }>
    }>
  }
}
