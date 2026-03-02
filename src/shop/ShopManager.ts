// ============================================================
// ShopManager — 商店经济逻辑（纯 TS，无 PixiJS 依赖）
// 负责：金币管理、三选一卡池、购买、出售、刷新
// ============================================================

import type { ItemDef }    from '@/items/ItemDef'
import type { GameConfig } from '@/items/ItemDef'
import { normalizeSize }   from '@/items/ItemDef'

const TIER_ORDER = ['Bronze', 'Silver', 'Gold', 'Diamond'] as const
export type TierKey = typeof TIER_ORDER[number]
export type TierStar = 1 | 2

export function getDailyGoldForDay(config: GameConfig, day: number): number {
  const byDay = config.dailyGoldByDay
  if (Array.isArray(byDay) && byDay.length > 0) {
    const idx = Math.max(0, Math.min(byDay.length - 1, Math.floor(day) - 1))
    return byDay[idx] ?? byDay[0] ?? config.dailyGold
  }
  return config.dailyGold
}

/** 从原始 tier 字段提取英文品质名，例如 "Bronze / 青铜" → "Bronze" */
export function extractTier(raw: string): TierKey {
  const key = raw.split('/')[0].trim()
  return (TIER_ORDER.includes(key as TierKey) ? key : 'Bronze') as TierKey
}

export function parseAvailableTiers(raw: string): TierKey[] {
  const tiers = raw
    .split('/')
    .map((s) => s.trim())
    .filter((s): s is TierKey => TIER_ORDER.includes(s as TierKey))
  return tiers.length > 0 ? tiers : ['Bronze']
}

// ---- 商店槽位 ----
export interface ShopSlot {
  item:       ItemDef
  tier:       TierKey
  price:      number
  purchased:  boolean
}

// ---- ShopManager ----
export class ShopManager {
  gold:         number
  day:          number
  refreshIndex: number   // 指向 shopRefreshPrices 数组的当前下标
  pool:         ShopSlot[]

  private config:   GameConfig
  private allItems: ItemDef[]
  private ownedDefIds = new Set<string>()

  constructor(config: GameConfig, allItems: ItemDef[], day = 1) {
    this.config    = config
    this.allItems  = allItems
    this.day       = day
    this.gold      = getDailyGoldForDay(config, day)   // 每天开始时发放金币
    this.refreshIndex = 0
    this.pool      = this.rollPool(true)
  }

  // ---- 价格计算 ----

  /** 计算物品购买价格（从 config 按品质/尺寸查表） */
  getItemPrice(item: ItemDef, tierOverride?: TierKey): number {
    const tier    = tierOverride ?? extractTier(item.starting_tier)
    const tierIdx = TIER_ORDER.indexOf(tier)
    const idx     = tierIdx < 0 ? 0 : tierIdx
    const size    = normalizeSize(item.size)
    if (size === '1x1') return this.config.smallItemPrices[idx]  ?? 2
    if (size === '2x1') return this.config.mediumItemPrices[idx] ?? 4
    return                     this.config.largeItemPrices[idx]  ?? 6
  }

  /** 计算出售价格（购买价 × sellPriceRatio，向下取整） */
  getSellPrice(item: ItemDef, tierOverride?: TierKey, starOverride: TierStar = 1): number {
    void item
    const tier = tierOverride ?? 'Bronze'
    const star = tier === 'Diamond' ? 1 : starOverride
    const tierIdx = TIER_ORDER.indexOf(tier)
    if (tierIdx < 0) return 1
    const level = tierIdx * 2 + (star === 2 ? 1 : 0)
    return 2 ** level
  }

  // ---- 刷新 ----

  /** 当前刷新价格 */
  getRefreshPrice(): number {
    const prices = this.config.shopRefreshPrices
    return prices[Math.min(this.refreshIndex, prices.length - 1)] ?? 10
  }

  canRefresh(): boolean {
    return this.gold >= this.getRefreshPrice()
  }

  /** 花费金币刷新卡池，返回 false 表示金币不足 */
  refresh(): boolean {
    if (!this.canRefresh()) return false
    this.gold        -= this.getRefreshPrice()
    this.refreshIndex = Math.min(this.refreshIndex + 1, this.config.shopRefreshPrices.length - 1)
    this.pool         = this.rollPool(false)
    return true
  }

  // ---- 购买 ----

  canBuy(slot: ShopSlot): boolean {
    return !slot.purchased && this.gold >= slot.price
  }

  /** 购买槽位物品，返回 false 表示无法购买 */
  buy(slot: ShopSlot): boolean {
    if (!this.canBuy(slot)) return false
    this.gold      -= slot.price
    slot.purchased  = true
    return true
  }

  // ---- 出售 ----

  /** 出售物品，增加金币，返回获得金币数 */
  sellItem(item: ItemDef, tierOverride?: TierKey, starOverride: TierStar = 1): number {
    const gained = this.getSellPrice(item, tierOverride, starOverride)
    this.gold   += gained
    return gained
  }

  // ---- 新的一天 ----

  /** 进入下一天：发金币、重置刷新价格、重滚卡池 */
  startNewDay(): void {
    this.day++
    this.gold        += getDailyGoldForDay(this.config, this.day)
    this.refreshIndex = 0
    this.pool         = this.rollPool(false)
  }

  /** Debug/切天用：直接跳到指定天数并重滚卡池（不发金币；刷新价格重置为首档） */
  setDay(day: number): void {
    this.day  = Math.max(1, Math.min(20, day))
    this.refreshIndex = 0
    this.pool = this.rollPool(false)
  }

  /** 兼容调用链：当前版本刷新不再按已持有品质过滤 */
  setOwnedTiers(map: Map<string, TierKey>): void {
    this.ownedDefIds = new Set(map.keys())
  }

  // ---- 卡池滚动 ----

  private getShopWidthCells(item: ItemDef): number {
    const size = normalizeSize(item.size)
    if (size === '1x1') return 1
    if (size === '2x1') return 2
    return 3
  }

  private parsePrimaryArchetype(item?: ItemDef): string {
    if (!item) return ''
    const raw = (item.tags || '').trim()
    if (!raw) return ''
    const first = raw.split(/[，,\/\s]+/).map((s) => s.trim()).filter(Boolean)[0]
    return first ?? ''
  }

  private hasOwnedAmmoItem(): boolean {
    for (const defId of this.ownedDefIds) {
      const item = this.allItems.find((it) => it.id === defId)
      if (!item) continue
      const text = (item.skills ?? []).map((s) => s.cn ?? '').join(' ')
      if (/弹药/.test(text)) return true
    }
    return false
  }

  private isAmmoSupportItem(item: ItemDef): boolean {
    const names = this.config.shopRules?.ammoSupportItemNames ?? []
    if (names.includes(item.name_cn)) return true
    return false
  }

  private getShopSizeWeight(item: ItemDef): number {
    const weights = this.config.shopRules?.shopSizeWeights
    const size = normalizeSize(item.size)
    const v = size === '1x1' ? weights?.small : size === '2x1' ? weights?.medium : weights?.large
    const n = typeof v === 'number' ? v : 1
    return Number.isFinite(n) && n > 0 ? n : 1
  }

  private pickItemWeighted(candidates: ItemDef[]): ItemDef | null {
    if (candidates.length === 0) return null
    let total = 0
    const ws = candidates.map((it) => {
      const w = this.getShopSizeWeight(it)
      total += w
      return w
    })
    if (total <= 0) return candidates[Math.floor(Math.random() * candidates.length)] ?? null
    let r = Math.random() * total
    for (let i = 0; i < candidates.length; i++) {
      r -= ws[i] ?? 0
      if (r <= 0) return candidates[i] ?? null
    }
    return candidates[candidates.length - 1] ?? null
  }

  private enforceDay1ThirdArchetypeIfNeeded(slots: ShopSlot[]): ShopSlot[] {
    if (!(this.config.shopRules?.day1ThirdItemMatchExistingArchetype)) return slots
    if (this.day !== 1 || slots.length < 3) return slots

    const a1 = this.parsePrimaryArchetype(slots[0]?.item)
    const a2 = this.parsePrimaryArchetype(slots[1]?.item)
    const a3 = this.parsePrimaryArchetype(slots[2]?.item)
    if (!a1 || !a2 || !a3) return slots
    if (a3 === a1 || a3 === a2) return slots

    const used = new Set(slots.map((s) => s.item.id))
    const widthUsedByFirstTwo = this.getShopWidthCells(slots[0].item) + this.getShopWidthCells(slots[1].item)
    const maxWidthForThird = 6 - widthUsedByFirstTwo
    const thirdTier = slots[2].tier

    const sameTier = this.allItems.filter((it) => {
      if (used.has(it.id)) return false
      if (this.getShopWidthCells(it) > maxWidthForThird) return false
      if (!parseAvailableTiers(it.available_tiers).includes(thirdTier)) return false
      const a = this.parsePrimaryArchetype(it)
      return a === a1 || a === a2
    })
    const fallbackAnyTier = this.allItems.filter((it) => {
      if (used.has(it.id)) return false
      if (this.getShopWidthCells(it) > maxWidthForThird) return false
      const a = this.parsePrimaryArchetype(it)
      return a === a1 || a === a2
    })
    const useSameTier = sameTier.length > 0
    const replacement = this.pickItemWeighted(useSameTier ? sameTier : fallbackAnyTier)
    if (!replacement) return slots
    const replacementTier = useSameTier
      ? thirdTier
      : (parseAvailableTiers(replacement.available_tiers)[0] ?? 'Bronze')
    slots[2] = { item: replacement, tier: replacementTier, price: this.getItemPrice(replacement, replacementTier), purchased: false }
    return slots
  }

  private rollPool(isInitialRoll: boolean): ShopSlot[] {
    const slots: ShopSlot[]  = []
    const usedItemIds        = new Set<string>()
    let usedWidthCells = 0
    const hasAmmoOwned = this.hasOwnedAmmoItem()
    const restrictAmmoSupport = this.config.shopRules?.ammoSupportRequiresAmmoOwned === true
    const enforceDay1ThirdArchetype = this.config.shopRules?.day1ThirdItemMatchExistingArchetype === true

    // 构建当天品质权重（青铜/白银/黄金/钻石）
    const chances = this.config.shopTierChancesByDay
    const rowIdx  = Math.max(0, Math.min(chances.length - 1, this.day - 1))
    const row     = chances[rowIdx] ?? [100, 0, 0, 0]
    const tierWeights: Record<TierKey, number> = {
      Bronze: Math.max(0, row[0] ?? 0),
      Silver: Math.max(0, row[1] ?? 0),
      Gold: Math.max(0, row[2] ?? 0),
      Diamond: Math.max(0, row[3] ?? 0),
    }

    const candidatesByTier: Record<TierKey, ItemDef[]> = {
      Bronze: [],
      Silver: [],
      Gold: [],
      Diamond: [],
    }
    for (const item of this.allItems) {
      for (const tier of parseAvailableTiers(item.available_tiers)) {
        candidatesByTier[tier].push(item)
      }
    }

    const pickTier = (feasibleByTier: Record<TierKey, ItemDef[]>): TierKey | null => {
      const available = TIER_ORDER.filter((tier) => (tierWeights[tier] ?? 0) > 0 && feasibleByTier[tier].length > 0)
      if (available.length === 0) return null
      const total = available.reduce((acc, tier) => acc + (tierWeights[tier] ?? 0), 0)
      if (total <= 0) return null
      let r = Math.random() * total
      for (const tier of available) {
        r -= tierWeights[tier] ?? 0
        if (r <= 0) return tier
      }
      return available[available.length - 1] ?? null
    }

    let attempts = 0
    while (slots.length < 3 && attempts < 5000) {
      attempts++
      const remainSlots = 3 - slots.length
      const remainWidth = 6 - usedWidthCells
      const maxWidthForCurrent = remainWidth - (remainSlots - 1)
      if (maxWidthForCurrent < 1) break

      const feasibleByTier: Record<TierKey, ItemDef[]> = {
        Bronze: [],
        Silver: [],
        Gold: [],
        Diamond: [],
      }
      for (const tier of TIER_ORDER) {
        const pool = candidatesByTier[tier]
        feasibleByTier[tier] = pool.filter((it) => {
          if (usedItemIds.has(it.id)) return false
          if (this.getShopWidthCells(it) > maxWidthForCurrent) return false
          if (restrictAmmoSupport && !hasAmmoOwned && this.isAmmoSupportItem(it)) return false

          if (enforceDay1ThirdArchetype && isInitialRoll && this.day === 1 && slots.length === 2) {
            const a1 = this.parsePrimaryArchetype(slots[0]?.item ?? it)
            const a2 = this.parsePrimaryArchetype(slots[1]?.item ?? it)
            const allowed = new Set([a1, a2].filter(Boolean))
            const current = this.parsePrimaryArchetype(it)
            if (allowed.size > 0 && (!current || !allowed.has(current))) return false
          }

          return true
        })
      }

      const tier = pickTier(feasibleByTier)
      if (!tier) break

      const candidates = feasibleByTier[tier]
      if (!candidates || candidates.length === 0) continue

      const item = this.pickItemWeighted(candidates)
      if (!item) continue
      if (usedItemIds.has(item.id)) continue

      usedItemIds.add(item.id)
      usedWidthCells += this.getShopWidthCells(item)
      slots.push({ item, tier, price: this.getItemPrice(item, tier), purchased: false })
    }

    return this.enforceDay1ThirdArchetypeIfNeeded(slots)
  }
}
