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

function getTierStarLevelIndex(tier: TierKey, star: TierStar): number {
  const actualStar = tier === 'Bronze' ? 1 : (star === 2 ? 2 : 1)
  if (tier === 'Bronze') return 0
  if (tier === 'Silver' && actualStar === 1) return 1
  if (tier === 'Silver' && actualStar === 2) return 2
  if (tier === 'Gold' && actualStar === 1) return 3
  if (tier === 'Gold' && actualStar === 2) return 4
  if (tier === 'Diamond' && actualStar === 1) return 5
  return 6 // Diamond#2
}

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
  private unlockedDefIds = new Set<string>()

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

  /** 计算出售价格（优先固定表；缺失时回退旧比例） */
  getSellPrice(item: ItemDef, tierOverride?: TierKey, starOverride: TierStar = 1): number {
    const tier = tierOverride ?? 'Bronze'
    const star = tier === 'Bronze' ? 1 : (starOverride === 2 ? 2 : 1)
    const fixedBySize = this.config.shopRules?.sellFixedPriceBySize
    const size = normalizeSize(item.size)
    const sizeKey = size === '1x1' ? 'small' : size === '2x1' ? 'medium' : 'large'
    const fixedList = fixedBySize?.[sizeKey]
    if (Array.isArray(fixedList) && fixedList.length > 0) {
      const idx = getTierStarLevelIndex(tier, star)
      const fixed = fixedList[idx]
      if (typeof fixed === 'number' && Number.isFinite(fixed) && fixed > 0) {
        return Math.max(1, Math.round(fixed))
      }
    }

    const buyLike = this.getTierStarPrice(item, tier, star)
    const ratioCfg = this.config.shopRules?.sellRatioByTier
    const ratio = (() => {
      if (tier === 'Bronze') return ratioCfg?.Bronze ?? (2 / 3)
      if (tier === 'Silver') return ratioCfg?.Silver ?? 0.5
      if (tier === 'Gold') return ratioCfg?.Gold ?? (1 / 3)
      return ratioCfg?.Diamond ?? 0.25
    })()
    return Math.max(1, Math.floor(buyLike * ratio))
  }

  /** 计算指定品质/星级购买价（用于快捷购买与出售回收估值） */
  getTierStarPrice(item: ItemDef, tier: TierKey, star: TierStar = 1): number {
    const base = this.getItemPrice(item, tier)
    const actualStar = tier === 'Bronze' ? 1 : (star === 2 ? 2 : 1)
    const key = `${tier}#${actualStar}`
    const mulCfg = this.config.shopRules?.quickBuyPriceMultiplier
    const mulRaw = mulCfg?.[key]
    const defaultMul = actualStar === 2 ? 2 : 1
    const mul = (typeof mulRaw === 'number' && Number.isFinite(mulRaw) && mulRaw > 0) ? mulRaw : defaultMul
    return Math.max(1, Math.round(base * mul))
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

  setUnlockedItemIds(ids: string[]): void {
    this.unlockedDefIds.clear()
    for (const id of ids) {
      if (this.allItems.some((it) => it.id === id)) this.unlockedDefIds.add(id)
    }
    this.pool = this.rollPool(false)
  }

  getUnlockedItemIds(): string[] {
    return Array.from(this.unlockedDefIds)
  }

  unlockItem(defId: string): boolean {
    if (!this.allItems.some((it) => it.id === defId)) return false
    if (this.unlockedDefIds.has(defId)) return false
    this.unlockedDefIds.add(defId)
    return true
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

  private isNeutralItem(item: ItemDef): boolean {
    const tags = `${item.tags ?? ''}`.split(/[，,\/\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    if (tags.includes('中立') || tags.includes('neutral')) return true
    return item.id.startsWith('neutral_')
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

  private hasAnyOwnedByKeys(keys: string[]): boolean {
    if (keys.length === 0) return true
    const keySet = new Set(keys.map((k) => k.trim()).filter(Boolean))
    if (keySet.size === 0) return true
    for (const defId of this.ownedDefIds) {
      const item = this.allItems.find((it) => it.id === defId)
      if (!item) continue
      if (keySet.has(item.id) || keySet.has(item.name_cn) || keySet.has(item.name_en)) return true
    }
    return false
  }

  private getItemPrerequisites(item: ItemDef): string[] {
    const cfg = this.config.shopRules?.itemPrerequisites
    if (!cfg) return []
    return cfg[item.id] ?? cfg[item.name_cn] ?? cfg[item.name_en] ?? []
  }

  private isBlockedByPrerequisites(item: ItemDef): boolean {
    const prereq = this.getItemPrerequisites(item)
    if (prereq.length === 0) return false
    return !this.hasAnyOwnedByKeys(prereq)
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

  private getMinTierDropWeight(item: ItemDef, resultTier: TierKey, resultStar: TierStar): number {
    const cfg = this.config.shopRules?.minTierDropWeightsByResultLevel
    if (!cfg) return 1
    const minTier = extractTier(item.starting_tier)
    const list = cfg[minTier]
    if (!Array.isArray(list) || list.length <= 0) return 1
    const levelIdx = getTierStarLevelIndex(resultTier, resultTier === 'Bronze' ? 1 : resultStar)
    const raw = list[levelIdx]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1
    return Math.max(0, raw)
  }

  private getUnlockStartingTierWeight(item: ItemDef): number {
    const cfg = this.config.shopRules?.unlockStartingTierWeights
    const tier = extractTier(item.starting_tier)
    const raw = cfg?.[tier]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      if (tier === 'Bronze') return 75
      if (tier === 'Silver') return 20
      if (tier === 'Gold') return 4
      return 1
    }
    return Math.max(0, raw)
  }

  private pickItemWeightedByResultLevel(candidates: ItemDef[], resultTier: TierKey, resultStar: TierStar): ItemDef | null {
    if (candidates.length === 0) return null
    let total = 0
    const ws = candidates.map((it) => {
      const w = this.getShopSizeWeight(it) * this.getMinTierDropWeight(it, resultTier, resultStar)
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
    const replacementTier = useSameTier
      ? thirdTier
      : ((parseAvailableTiers(fallbackAnyTier[0]?.available_tiers ?? '')[0] ?? 'Bronze') as TierKey)
    const replacement = this.pickItemWeightedByResultLevel(useSameTier ? sameTier : fallbackAnyTier, replacementTier, 1)
    if (!replacement) return slots
    const resolvedTier = useSameTier
      ? thirdTier
      : (parseAvailableTiers(replacement.available_tiers)[0] ?? 'Bronze')
    slots[2] = { item: replacement, tier: resolvedTier, price: this.getItemPrice(replacement, resolvedTier), purchased: false }
    return slots
  }

  private rollPool(isInitialRoll: boolean): ShopSlot[] {
    const slots: ShopSlot[]  = []
    const usedItemIds        = new Set<string>()
    let usedWidthCells = 0
    const hasAmmoOwned = this.hasOwnedAmmoItem()
    const restrictAmmoSupport = this.config.shopRules?.ammoSupportRequiresAmmoOwned === true
    const enforceDay1ThirdArchetype = this.config.shopRules?.day1ThirdItemMatchExistingArchetype === true
    const unlockedItems = this.allItems.filter((it) => this.unlockedDefIds.has(it.id))
    const allowDuplicate = unlockedItems.length < 3
    const sourceItems = unlockedItems.length > 0 ? unlockedItems : []
    if (sourceItems.length === 0) return []

    let attempts = 0
    while (slots.length < 3 && attempts < 5000) {
      attempts++
      const remainSlots = 3 - slots.length
      const remainWidth = 6 - usedWidthCells
      const maxWidthForCurrent = remainWidth - (remainSlots - 1)
      if (maxWidthForCurrent < 1) break

      const candidates = sourceItems.filter((it) => {
        if (this.isNeutralItem(it)) return false
        if (!allowDuplicate && usedItemIds.has(it.id)) return false
        if (this.getShopWidthCells(it) > maxWidthForCurrent) return false
        if (restrictAmmoSupport && !hasAmmoOwned && this.isAmmoSupportItem(it)) return false
        if (this.isBlockedByPrerequisites(it)) return false
        if (enforceDay1ThirdArchetype && isInitialRoll && this.day === 1 && slots.length === 2) {
          const a1 = this.parsePrimaryArchetype(slots[0]?.item ?? it)
          const a2 = this.parsePrimaryArchetype(slots[1]?.item ?? it)
          const allowed = new Set([a1, a2].filter(Boolean))
          const current = this.parsePrimaryArchetype(it)
          if (allowed.size > 0 && (!current || !allowed.has(current))) return false
        }
        return true
      })
      if (!candidates || candidates.length === 0) continue

      let total = 0
      const weights = candidates.map((it) => {
        const w = this.getShopSizeWeight(it) * this.getUnlockStartingTierWeight(it)
        total += w
        return w
      })
      const item = (() => {
        if (total <= 0) return candidates[Math.floor(Math.random() * candidates.length)] ?? null
        let r = Math.random() * total
        for (let i = 0; i < candidates.length; i++) {
          r -= weights[i] ?? 0
          if (r <= 0) return candidates[i] ?? null
        }
        return candidates[candidates.length - 1] ?? null
      })()
      if (!item) continue
      if (!allowDuplicate && usedItemIds.has(item.id)) continue

      usedItemIds.add(item.id)
      usedWidthCells += this.getShopWidthCells(item)
      const tier = extractTier(item.starting_tier)
      slots.push({ item, tier, price: this.getItemPrice(item, tier), purchased: false })
    }

    return this.enforceDay1ThirdArchetypeIfNeeded(slots)
  }
}
