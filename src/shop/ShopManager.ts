// ============================================================
// ShopManager — 商店经济逻辑（纯 TS，无 PixiJS 依赖）
// 负责：金币管理、三选一卡池、购买、出售、刷新
// ============================================================

import type { ItemDef }    from '@/items/ItemDef'
import type { GameConfig } from '@/items/ItemDef'
import { normalizeSize }   from '@/items/ItemDef'

const TIER_ORDER = ['Bronze', 'Silver', 'Gold', 'Diamond'] as const
export type TierKey = typeof TIER_ORDER[number]

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

  constructor(config: GameConfig, allItems: ItemDef[], day = 1) {
    this.config    = config
    this.allItems  = allItems
    this.day       = day
    this.gold      = config.dailyGold   // 每天开始时发放金币
    this.refreshIndex = 0
    this.pool      = this.rollPool()
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
  getSellPrice(item: ItemDef, tierOverride?: TierKey): number {
    return Math.floor(this.getItemPrice(item, tierOverride) * this.config.sellPriceRatio)
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
    this.pool         = this.rollPool()
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
  sellItem(item: ItemDef, tierOverride?: TierKey): number {
    const gained = this.getSellPrice(item, tierOverride)
    this.gold   += gained
    return gained
  }

  // ---- 新的一天 ----

  /** 进入下一天：发金币、重置刷新价格、重滚卡池 */
  startNewDay(): void {
    this.day++
    this.gold        += this.config.dailyGold
    this.refreshIndex = 0
    this.pool         = this.rollPool()
  }

  /** Debug/切天用：直接跳到指定天数并重滚卡池（不发金币；刷新价格重置为首档） */
  setDay(day: number): void {
    this.day  = Math.max(1, Math.min(20, day))
    this.refreshIndex = 0
    this.pool = this.rollPool()
  }

  /** 兼容调用链：当前版本刷新不再按已持有品质过滤 */
  setOwnedTiers(map: Map<string, TierKey>): void {
    void map
  }

  // ---- 卡池滚动 ----

  private getShopWidthCells(item: ItemDef): number {
    const size = normalizeSize(item.size)
    if (size === '1x1') return 1
    if (size === '2x1') return 2
    return 3
  }

  private rollPool(): ShopSlot[] {
    const slots: ShopSlot[]  = []
    const usedItemIds        = new Set<string>()
    let usedWidthCells = 0

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
        feasibleByTier[tier] = pool.filter((it) => !usedItemIds.has(it.id) && this.getShopWidthCells(it) <= maxWidthForCurrent)
      }

      const tier = pickTier(feasibleByTier)
      if (!tier) break

      const candidates = feasibleByTier[tier]
      if (!candidates || candidates.length === 0) continue

      const item = candidates[Math.floor(Math.random() * candidates.length)]!
      if (usedItemIds.has(item.id)) continue

      usedItemIds.add(item.id)
      usedWidthCells += this.getShopWidthCells(item)
      slots.push({ item, tier, price: this.getItemPrice(item, tier), purchased: false })
    }

    return slots
  }
}
