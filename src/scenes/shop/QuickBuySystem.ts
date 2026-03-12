// ============================================================
// QuickBuySystem — 快速购买系统（函数集合模式）
// 职责：
//   - 生成下一个快速购买 offer（rollNextQuickBuyOffer）
//   - 快速购买合成改写（applyQuickBuySynthesisRewrite）
//   - 伪随机等级选择（pickQuickBuyLevelByPseudoRandomBucket）
//   - 品质伪随机袋（buildQualityPseudoRandomBag / pickQualityByPseudoRandomBag）
//   - 等级权重查询（getQuickBuyLevelWeightsByDay / getQuickBuyQualityWeightsByLevel）
//   - 强制低等级配对候选（pickForcedLowLevelPairCandidate）
//   - 等级范围查询（getMaxQuickBuyLevelForDay / getMinQuickBuyLevelForDay）
//   - 等级到品阶映射（levelToTierStar / getAllowedLevelsByStartingTier / getUnlockPoolBuyPriceByLevel）
//   - 候选池（collectPoolCandidatesByLevel / findCandidateByOffer / canOfferImmediateSynthesis）
//   - 伪随机状态（QUALITY_PSEUDO_RANDOM_STATE / QUICK_BUY_LEVEL_PSEUDO_RANDOM_STATE）
// ============================================================

import { getConfig, getAllItems } from '@/core/DataLoader'
import { normalizeSize, type ItemDef } from '@/items/ItemDef'
import type { TierKey } from '@/shop/ShopManager'
import {
  parseTierName,
  getPrimaryArchetype,
  getItemDefById,
  isNeutralItemDef,
  canSynthesizePair,
  tierStarLevelIndex,
} from './SynthesisLogic'
import type { ShopSceneCtx } from './ShopSceneContext'
import type { GridSystem } from '@/grid/GridSystem'
import type { ItemSizeNorm } from '@/grid/GridSystem'

// ============================================================
// 类型
// ============================================================

export type PoolCandidate = {
  item: ItemDef
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7
  tier: TierKey
  star: 1 | 2
  price: number
}

// ============================================================
// 伪随机状态（模块级，供 ShopScene 在 restoreState 时清空）
// ============================================================

export const QUALITY_PSEUDO_RANDOM_STATE = new Map<string, { bag: TierKey[]; cursor: number }>()
export const QUICK_BUY_LEVEL_PSEUDO_RANDOM_STATE = new Map<string, { bag: Array<1 | 2 | 3 | 4 | 5 | 6 | 7>; cursor: number }>()

// ============================================================
// Callbacks 接口
// ============================================================

export type RollNextQuickBuyOfferCallbacks = {
  findFirstBattlePlace: (size: ItemSizeNorm) => { col: number; row: number } | null
  findFirstBackpackPlace: (size: ItemSizeNorm) => { col: number; row: number } | null
  isFirstPurchaseLockedToStarterClass: () => boolean
  isStarterClassItem: (item: ItemDef) => boolean
  collectNeutralQuickBuyCandidates: () => PoolCandidate[]
  rewriteNeutralRandomPick: (item: ItemDef) => ItemDef
  canRandomNeutralItem: (item: ItemDef) => boolean
  pickNeutralRandomCategoryByPool: (candidates: PoolCandidate[]) => 'stone' | 'scroll' | 'medal'
  neutralRandomCategoryOfItem: (item: ItemDef) => 'stone' | 'scroll' | 'medal' | null
  getNeutralDailyRollCap: (day: number) => number
  getInstanceLevel: (instanceId: string) => 1 | 2 | 3 | 4 | 5 | 6 | 7
  getInstanceTier: (instanceId: string) => TierKey | undefined
  getInstanceTierMap: () => Map<string, TierKey>
  getInstanceTierStar: (instanceId: string) => 1 | 2
}

export type PickForcedLowLevelCallbacks = {
  findFirstBattlePlace: (size: ItemSizeNorm) => { col: number; row: number } | null
  findFirstBackpackPlace: (size: ItemSizeNorm) => { col: number; row: number } | null
  getInstanceLevel: (instanceId: string) => number
  getInstanceTier: (instanceId: string) => TierKey | undefined
  getInstanceTierStar: (instanceId: string) => 1 | 2
}

// ============================================================
// 本地工具
// ============================================================

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function parseAvailableTiers(raw: string): TierKey[] {
  const s = (raw || '').trim()
  if (!s) return ['Bronze', 'Silver', 'Gold', 'Diamond']
  const out = s
    .split('/')
    .map((v) => parseTierName(v.trim()))
    .filter((v): v is TierKey => !!v)
  return out.length > 0 ? out : ['Bronze', 'Silver', 'Gold', 'Diamond']
}

// ============================================================
// 等级 <-> 品阶映射
// ============================================================

export function levelToTierStar(level: number): { tier: TierKey; star: 1 | 2 } | null {
  if (level === 1) return { tier: 'Bronze', star: 1 }
  if (level === 2) return { tier: 'Silver', star: 1 }
  if (level === 3) return { tier: 'Silver', star: 2 }
  if (level === 4) return { tier: 'Gold', star: 1 }
  if (level === 5) return { tier: 'Gold', star: 2 }
  if (level === 6) return { tier: 'Diamond', star: 1 }
  if (level === 7) return { tier: 'Diamond', star: 2 }
  return null
}

export function getAllowedLevelsByStartingTier(tier: TierKey): Array<1 | 2 | 3 | 4 | 5 | 6 | 7> {
  if (tier === 'Bronze') return [1, 2, 3, 4, 5, 6, 7]
  if (tier === 'Silver') return [2, 3, 4, 5, 6, 7]
  if (tier === 'Gold') return [4, 5, 6, 7]
  return [6, 7]
}

export function getUnlockPoolBuyPriceByLevel(level: 1 | 2 | 3 | 4 | 5 | 6 | 7): number {
  const tierStar = levelToTierStar(level)
  const key = `${tierStar?.tier ?? 'Bronze'}#${tierStar?.star ?? 1}`
  const raw = getConfig().shopRules?.quickBuyFixedPrice?.[key]
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.max(1, Math.round(raw))
  }
  // 配置缺失时的最小保底（正常不应触发）
  return 3
}

// ============================================================
// 等级权重
// ============================================================

export function getQuickBuyLevelWeightsByDay(day: number): [number, number, number, number, number, number, number] {
  const rows = getConfig().shopRules?.quickBuyLevelChancesByDay
  const idx = Math.max(0, Math.min((rows?.length ?? 1) - 1, day - 1))
  const row = rows?.[idx] ?? [1, 0, 0, 0, 0, 0, 0]
  return [
    Math.max(0, Number(row[0] ?? 0)),
    Math.max(0, Number(row[1] ?? 0)),
    Math.max(0, Number(row[2] ?? 0)),
    Math.max(0, Number(row[3] ?? 0)),
    Math.max(0, Number(row[4] ?? 0)),
    Math.max(0, Number(row[5] ?? 0)),
    Math.max(0, Number(row[6] ?? 0)),
  ]
}

export function getMaxQuickBuyLevelForDay(day: number): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const weights = getQuickBuyLevelWeightsByDay(day)
  let maxLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7 = 1
  for (let i = 0; i < weights.length; i++) {
    if (Number(weights[i] ?? 0) > 0) maxLevel = (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  }
  return maxLevel
}

export function getMinQuickBuyLevelForDay(day: number): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const weights = getQuickBuyLevelWeightsByDay(day)
  for (let i = 0; i < weights.length; i++) {
    if (Number(weights[i] ?? 0) > 0) return (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  }
  return 1
}

// ============================================================
// 品质权重 & 伪随机袋
// ============================================================

export function getQuickBuyQualityWeightsByLevel(level: 1 | 2 | 3 | 4 | 5 | 6 | 7): Record<TierKey, number> {
  const rules = getConfig().shopRules as {
    qualityPseudoRandomWeightsByLevel?: Record<TierKey, number[]>
    quickBuyQualityWeightsByLevel?: Record<TierKey, number[]>
  } | undefined
  const rows = rules?.qualityPseudoRandomWeightsByLevel ?? rules?.quickBuyQualityWeightsByLevel
  if (!rows) {
    return { Bronze: 1, Silver: 1, Gold: 1, Diamond: 1 }
  }
  return {
    Bronze: Math.max(0, Number(rows.Bronze?.[level - 1] ?? 0)),
    Silver: Math.max(0, Number(rows.Silver?.[level - 1] ?? 0)),
    Gold: Math.max(0, Number(rows.Gold?.[level - 1] ?? 0)),
    Diamond: Math.max(0, Number(rows.Diamond?.[level - 1] ?? 0)),
  }
}

export function buildQualityPseudoRandomBag(level: 1 | 2 | 3 | 4 | 5 | 6 | 7, available: TierKey[]): TierKey[] {
  const qualityOrder: TierKey[] = ['Bronze', 'Silver', 'Gold', 'Diamond']
  const availableSet = new Set(available)
  const base = getQuickBuyQualityWeightsByLevel(level)
  const weighted = qualityOrder
    .map((q) => ({ q, w: availableSet.has(q) ? Math.max(0, Number(base[q] ?? 0)) : 0 }))
    .filter((it) => it.w > 0)
  if (weighted.length <= 0) return available.length > 0 ? [...available] : ['Bronze']

  const windowSizeRaw = Number((getConfig().shopRules as { qualityPseudoRandomWindowSize?: number } | undefined)?.qualityPseudoRandomWindowSize ?? 10)
  const windowSize = Math.max(1, Math.round(windowSizeRaw))
  const total = weighted.reduce((sum, it) => sum + it.w, 0)
  const rawCounts = weighted.map((it) => (it.w / total) * windowSize)
  const counts = rawCounts.map((v) => Math.floor(v))
  let remain = windowSize - counts.reduce((sum, n) => sum + n, 0)
  const fracOrder = rawCounts
    .map((v, i) => ({ i, f: v - Math.floor(v) }))
    .sort((a, b) => b.f - a.f)
  for (let i = 0; i < fracOrder.length && remain > 0; i++, remain--) {
    counts[fracOrder[i]!.i] = (counts[fracOrder[i]!.i] ?? 0) + 1
  }

  const bag: TierKey[] = []
  for (let i = 0; i < weighted.length; i++) {
    const q = weighted[i]!.q
    const c = Math.max(0, counts[i] ?? 0)
    for (let k = 0; k < c; k++) bag.push(q)
  }
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = bag[i]
    bag[i] = bag[j]!
    bag[j] = t!
  }
  return bag.length > 0 ? bag : [weighted[0]!.q]
}

export function pickQualityByPseudoRandomBag(
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7,
  available: TierKey[],
): TierKey {
  const qualityOrder: TierKey[] = ['Bronze', 'Silver', 'Gold', 'Diamond']
  const filteredAvailable = qualityOrder.filter((q) => available.includes(q))
  const availableList: TierKey[] = filteredAvailable.length > 0 ? filteredAvailable : ['Bronze']
  const key = `${level}:${availableList.join('|')}`
  let state = QUALITY_PSEUDO_RANDOM_STATE.get(key)
  if (!state || state.cursor >= state.bag.length) {
    state = { bag: buildQualityPseudoRandomBag(level, availableList), cursor: 0 }
    QUALITY_PSEUDO_RANDOM_STATE.set(key, state)
  }
  const picked = state.bag[state.cursor] ?? state.bag[0] ?? 'Bronze'
  state.cursor += 1
  if (availableList.includes(picked)) return picked
  return availableList[0]!
}

// ============================================================
// 伪随机等级选择
// ============================================================

export function pickQuickBuyLevelByPseudoRandomBucket(
  effectiveWeights: [number, number, number, number, number, number, number],
): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const active = effectiveWeights
    .map((w, i) => ({ level: (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7, weight: Math.max(0, Number(w || 0)) }))
    .filter((it) => it.weight > 0)

  if (active.length <= 0) return 1
  if (active.length === 1) return active[0]!.level

  const nonZeroLevels = active.map((it) => it.level)
  const low = Math.min(...nonZeroLevels) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  const high = Math.max(...nonZeroLevels) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  const lowW = active.find((it) => it.level === low)?.weight ?? 0
  const highW = active.find((it) => it.level === high)?.weight ?? 0
  const isTwoLevelFiftyFifty = active.length === 2 && Math.abs(lowW - highW) <= 1e-6
  if (isTwoLevelFiftyFifty) {
    const key = `50_50:${low}-${high}`
    let state = QUICK_BUY_LEVEL_PSEUDO_RANDOM_STATE.get(key)
    if (!state || state.cursor >= state.bag.length) {
      state = { bag: [low, low, high, high], cursor: 0 }
      QUICK_BUY_LEVEL_PSEUDO_RANDOM_STATE.set(key, state)
    }
    const picked = state.bag[state.cursor] ?? low
    state.cursor += 1
    return picked
  }

  let totalWeight = 0
  for (let i = 0; i < effectiveWeights.length; i++) totalWeight += Math.max(0, effectiveWeights[i] ?? 0)
  if (totalWeight <= 0) return 1
  let levelRoll = Math.random() * totalWeight
  let pickedLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7 = 1
  for (let i = 0; i < effectiveWeights.length; i++) {
    levelRoll -= effectiveWeights[i] ?? 0
    if (levelRoll <= 0) {
      pickedLevel = (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7
      break
    }
  }
  return pickedLevel
}

// ============================================================
// 候选池
// ============================================================

export function collectPoolCandidatesByLevel(
  ctx: ShopSceneCtx,
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7,
  callbacks: Pick<RollNextQuickBuyOfferCallbacks, 'findFirstBattlePlace' | 'findFirstBackpackPlace'>,
): PoolCandidate[] {
  if (!ctx.shopManager || !ctx.battleSystem || !ctx.backpackSystem) return []
  const tierStar = levelToTierStar(level)
  if (!tierStar) return []
  const allById = new Map(getAllItems().map((it) => [it.id, it] as const))
  const out: PoolCandidate[] = []
  for (const item of allById.values()) {
    if (!item) continue
    if (isNeutralItemDef(item)) continue
    const minTier = parseTierName(item.starting_tier) ?? 'Bronze'
    if (!getAllowedLevelsByStartingTier(minTier).includes(level)) continue
    if (!parseAvailableTiers(item.available_tiers).includes(tierStar.tier)) continue
    const size = normalizeSize(item.size)
    if (!callbacks.findFirstBattlePlace(size) && !callbacks.findFirstBackpackPlace(size)) continue
    out.push({
      item,
      level,
      tier: tierStar.tier,
      star: tierStar.star,
      price: getUnlockPoolBuyPriceByLevel(level),
    })
  }
  return out
}

export function findCandidateByOffer(
  ctx: ShopSceneCtx,
  offer: { itemId: string; tier: TierKey; star: 1 | 2; price: number } | null,
  callbacks: Pick<RollNextQuickBuyOfferCallbacks, 'findFirstBattlePlace' | 'findFirstBackpackPlace' | 'rewriteNeutralRandomPick' | 'canRandomNeutralItem'>,
): PoolCandidate | null {
  if (!offer) return null
  const item = getItemDefById(offer.itemId)
  if (!item) return null
  if (isNeutralItemDef(item)) {
    const rewrittenItem = callbacks.rewriteNeutralRandomPick(item)
    if (!callbacks.canRandomNeutralItem(rewrittenItem)) return null
    const size = normalizeSize(rewrittenItem.size)
    if (!callbacks.findFirstBattlePlace(size) && !callbacks.findFirstBackpackPlace(size)) return null
    return {
      item: rewrittenItem,
      level: 1,
      tier: 'Bronze',
      star: 1,
      price: Math.max(1, Math.round(Number(offer.price) || ctx.currentDay + 1)),
    }
  }
  const level = tierStarLevelIndex(offer.tier, offer.star) + 1
  if (level < 1 || level > 7) return null
  const levelKey = level as 1 | 2 | 3 | 4 | 5 | 6 | 7
  const size = normalizeSize(item.size)
  if (!callbacks.findFirstBattlePlace(size) && !callbacks.findFirstBackpackPlace(size)) return null
  const minTier = parseTierName(item.starting_tier) ?? 'Bronze'
  if (!getAllowedLevelsByStartingTier(minTier).includes(levelKey)) return null
  if (!parseAvailableTiers(item.available_tiers).includes(offer.tier)) return null
  return {
    item,
    level: levelKey,
    tier: offer.tier,
    star: offer.star,
    price: offer.price,
  }
}

export function canOfferImmediateSynthesis(
  ctx: ShopSceneCtx,
  candidate: PoolCandidate,
  callbacks: Pick<RollNextQuickBuyOfferCallbacks, 'getInstanceTierMap' | 'getInstanceTierStar'>,
): boolean {
  if (!ctx.battleSystem || !ctx.backpackSystem) return false
  const instanceTierMap = callbacks.getInstanceTierMap()
  const scan = (items: ReturnType<GridSystem['getAllItems']>): boolean => {
    for (const it of items) {
      const itTier = instanceTierMap.get(it.instanceId) ?? 'Bronze'
      const itStar = callbacks.getInstanceTierStar(it.instanceId)
      if (canSynthesizePair(candidate.item.id, it.defId, candidate.tier, candidate.star, itTier, itStar)) {
        return true
      }
    }
    return false
  }
  return scan(ctx.battleSystem.getAllItems()) || scan(ctx.backpackSystem.getAllItems())
}

// ============================================================
// 强制低等级配对候选
// ============================================================

export function pickForcedLowLevelPairCandidate(
  ctx: ShopSceneCtx,
  day: number,
  callbacks: PickForcedLowLevelCallbacks,
): PoolCandidate | null {
  if (!ctx.battleSystem || !ctx.backpackSystem) return null
  const minAllowedLevel = getMinQuickBuyLevelForDay(day)
  if (minAllowedLevel <= 1) return null

  const oddBuckets = new Map<string, {
    defId: string
    level: 1 | 2 | 3 | 4 | 5 | 6 | 7
    tier: TierKey
    star: 1 | 2
    count: number
  }>()

  const collect = (items: ReturnType<GridSystem['getAllItems']>) => {
    for (const it of items) {
      const def = getItemDefById(it.defId)
      if (!def || isNeutralItemDef(def)) continue
      const level = callbacks.getInstanceLevel(it.instanceId)
      if (level >= minAllowedLevel) continue
      const tier = callbacks.getInstanceTier(it.instanceId)
      const star = callbacks.getInstanceTierStar(it.instanceId)
      if (!tier) continue
      const key = `${it.defId}|${tier}|${star}`
      const prev = oddBuckets.get(key)
      if (prev) prev.count += 1
      else oddBuckets.set(key, { defId: it.defId, level: level as 1 | 2 | 3 | 4 | 5 | 6 | 7, tier, star, count: 1 })
    }
  }
  collect(ctx.battleSystem.getAllItems())
  collect(ctx.backpackSystem.getAllItems())

  const pending = Array.from(oddBuckets.values())
    .filter((it) => (it.count % 2) === 1)
    .sort((a, b) => (a.level - b.level) || a.defId.localeCompare(b.defId))
  if (pending.length <= 0) return null

  for (const one of pending) {
    const item = getItemDefById(one.defId)
    if (!item) continue
    const size = normalizeSize(item.size)
    if (!callbacks.findFirstBattlePlace(size) && !callbacks.findFirstBackpackPlace(size)) continue
    return {
      item,
      level: one.level,
      tier: one.tier,
      star: one.star,
      price: getUnlockPoolBuyPriceByLevel(one.level),
    }
  }
  return null
}

// ============================================================
// 快速购买合成改写
// ============================================================

export function applyQuickBuySynthesisRewrite(
  ctx: ShopSceneCtx,
  picked: PoolCandidate,
  levelCandidates: PoolCandidate[],
  callbacks: Pick<RollNextQuickBuyOfferCallbacks, 'getInstanceTierMap' | 'getInstanceTierStar'>,
): PoolCandidate {
  if (!ctx.battleSystem || !ctx.backpackSystem) return picked
  const instanceTierMap = callbacks.getInstanceTierMap()
  const backpackSameDefCount = new Map<string, number>()
  const sameArchetypeDefs = new Map<string, Set<string>>()
  const collect = (items: ReturnType<GridSystem['getAllItems']>) => {
    for (const it of items) {
      const itTier = instanceTierMap.get(it.instanceId) ?? 'Bronze'
      const itStar = callbacks.getInstanceTierStar(it.instanceId)
      if (itTier !== picked.tier || itStar !== picked.star) continue
      const def = getItemDefById(it.defId)
      const arch = getPrimaryArchetype(def?.tags ?? '')
      if (!arch) continue
      const set = sameArchetypeDefs.get(arch) ?? new Set<string>()
      set.add(it.defId)
      sameArchetypeDefs.set(arch, set)
    }
  }
  collect(ctx.battleSystem.getAllItems())
  collect(ctx.backpackSystem.getAllItems())
  for (const it of ctx.backpackSystem.getAllItems()) {
    backpackSameDefCount.set(it.defId, (backpackSameDefCount.get(it.defId) ?? 0) + 1)
  }

  const pickedArch = getPrimaryArchetype(picked.item.tags)
  if (!pickedArch) return picked

  const backpackSameDefOwnedCount = backpackSameDefCount.get(picked.item.id) ?? 0
  if (backpackSameDefOwnedCount >= 3) {
    const sameArchetypeOther = levelCandidates.filter((c) =>
      c.item.id !== picked.item.id
      && c.tier === picked.tier
      && c.star === picked.star
      && getPrimaryArchetype(c.item.tags) === pickedArch,
    )
    const swapped = sameArchetypeOther[Math.floor(Math.random() * sameArchetypeOther.length)] ?? null
    if (swapped) return swapped
  }

  const sameArchDefSet = sameArchetypeDefs.get(pickedArch)
  if ((sameArchDefSet?.size ?? 0) >= 3) {
    const ownedSameItemCandidates = levelCandidates.filter((c) =>
      c.tier === picked.tier
      && c.star === picked.star
      && sameArchDefSet!.has(c.item.id),
    )
    const swapped = ownedSameItemCandidates[Math.floor(Math.random() * ownedSameItemCandidates.length)] ?? null
    if (swapped) return swapped
  }

  return picked
}

// ============================================================
// 生成下一个快速购买 offer（主函数，~144 行）
// ============================================================

export function rollNextQuickBuyOffer(
  ctx: ShopSceneCtx,
  force: boolean,
  callbacks: RollNextQuickBuyOfferCallbacks,
): PoolCandidate | null {
  const forcedLowLevelPair = pickForcedLowLevelPairCandidate(ctx, ctx.currentDay, {
    findFirstBattlePlace: callbacks.findFirstBattlePlace,
    findFirstBackpackPlace: callbacks.findFirstBackpackPlace,
    getInstanceLevel: callbacks.getInstanceLevel,
    getInstanceTier: callbacks.getInstanceTier,
    getInstanceTierStar: callbacks.getInstanceTierStar,
  })
  if (forcedLowLevelPair) {
    ctx.nextQuickBuyOffer = {
      itemId: forcedLowLevelPair.item.id,
      tier: forcedLowLevelPair.tier,
      star: forcedLowLevelPair.star,
      price: forcedLowLevelPair.price,
    }
    return forcedLowLevelPair
  }

  if (!force) {
    const keep = findCandidateByOffer(ctx, ctx.nextQuickBuyOffer, callbacks)
    if (keep) return keep
  }

  const collectLevel = (level: 1 | 2 | 3 | 4 | 5 | 6 | 7) => collectPoolCandidatesByLevel(ctx, level, callbacks)
  const byLevel: Record<1 | 2 | 3 | 4 | 5 | 6 | 7, PoolCandidate[]> = {
    1: collectLevel(1),
    2: collectLevel(2),
    3: collectLevel(3),
    4: collectLevel(4),
    5: collectLevel(5),
    6: collectLevel(6),
    7: collectLevel(7),
  }

  if (callbacks.isFirstPurchaseLockedToStarterClass()) {
    byLevel[1] = byLevel[1].filter((c) => callbacks.isStarterClassItem(c.item))
    byLevel[2] = byLevel[2].filter((c) => callbacks.isStarterClassItem(c.item))
    byLevel[3] = byLevel[3].filter((c) => callbacks.isStarterClassItem(c.item))
    byLevel[4] = byLevel[4].filter((c) => callbacks.isStarterClassItem(c.item))
    byLevel[5] = byLevel[5].filter((c) => callbacks.isStarterClassItem(c.item))
    byLevel[6] = byLevel[6].filter((c) => callbacks.isStarterClassItem(c.item))
    byLevel[7] = byLevel[7].filter((c) => callbacks.isStarterClassItem(c.item))
  }

  const neutralCandidates = callbacks.collectNeutralQuickBuyCandidates()
  const shopRulesCfg = (getConfig().shopRules ?? {}) as {
    quickBuyNeutralStartDay?: number
    quickBuyNeutralChance?: number
    quickBuyNeutralPseudoRandomChances?: number[]
  }
  const neutralStartDay = Math.max(1, Math.round(Number(shopRulesCfg.quickBuyNeutralStartDay ?? 2) || 2))
  const neutralChance = clamp01(Number(shopRulesCfg.quickBuyNeutralChance ?? 0.25))
  const pseudoChanceRows = Array.isArray(shopRulesCfg.quickBuyNeutralPseudoRandomChances)
    ? shopRulesCfg.quickBuyNeutralPseudoRandomChances
      .map((v: number) => clamp01(Number(v)))
      .filter((v: number) => Number.isFinite(v))
    : []
  const neutralDailyCap = callbacks.getNeutralDailyRollCap(ctx.currentDay)
  const neutralRolledToday = Math.max(0, Math.round(ctx.neutralDailyRollCountByDay.get(ctx.currentDay) ?? 0))
  const neutralEligible = ctx.currentDay >= neutralStartDay
    && neutralCandidates.length > 0
    && neutralRolledToday < neutralDailyCap
  const neutralRollChance = pseudoChanceRows.length > 0
    ? pseudoChanceRows[Math.min(ctx.quickBuyNeutralMissStreak, pseudoChanceRows.length - 1)]
    : neutralChance
  const shouldTryNeutral = neutralEligible && Math.random() < neutralRollChance
  if (shouldTryNeutral) {
    const neutralPicked = neutralCandidates[Math.floor(Math.random() * neutralCandidates.length)] ?? null
    if (neutralPicked) {
      const rewrittenCandidates = neutralCandidates.map((one) => ({ ...one, item: callbacks.rewriteNeutralRandomPick(one.item) }))
      const targetCategory = callbacks.pickNeutralRandomCategoryByPool(rewrittenCandidates)
      const sameCategory = rewrittenCandidates.filter((one) => callbacks.neutralRandomCategoryOfItem(one.item) === targetCategory)
      const pickedAfterRatio = (sameCategory[Math.floor(Math.random() * sameCategory.length)]
        ?? rewrittenCandidates[Math.floor(Math.random() * rewrittenCandidates.length)]
        ?? neutralPicked)
      ctx.nextQuickBuyOffer = {
        itemId: pickedAfterRatio.item.id,
        tier: pickedAfterRatio.tier,
        star: pickedAfterRatio.star,
        price: pickedAfterRatio.price,
      }
      ctx.neutralDailyRollCountByDay.set(ctx.currentDay, neutralRolledToday + 1)
      return pickedAfterRatio
    }
  }

  const baseWeights = getQuickBuyLevelWeightsByDay(ctx.currentDay)
  const effectiveWeights: [number, number, number, number, number, number, number] = [
    byLevel[1].length > 0 ? baseWeights[0] : 0,
    byLevel[2].length > 0 ? baseWeights[1] : 0,
    byLevel[3].length > 0 ? baseWeights[2] : 0,
    byLevel[4].length > 0 ? baseWeights[3] : 0,
    byLevel[5].length > 0 ? baseWeights[4] : 0,
    byLevel[6].length > 0 ? baseWeights[5] : 0,
    byLevel[7].length > 0 ? baseWeights[6] : 0,
  ]
  const totalWeight = effectiveWeights.reduce((sum, n) => sum + n, 0)
  if (totalWeight <= 0) {
    ctx.nextQuickBuyOffer = null
    return null
  }

  const pickedLevel = pickQuickBuyLevelByPseudoRandomBucket(effectiveWeights)

  const levelCandidates = byLevel[pickedLevel]
  if (levelCandidates.length <= 0) {
    ctx.nextQuickBuyOffer = null
    return null
  }
  const byQuality: Record<TierKey, PoolCandidate[]> = { Bronze: [], Silver: [], Gold: [], Diamond: [] }
  for (const c of levelCandidates) {
    const q = parseTierName(c.item.starting_tier) ?? 'Bronze'
    byQuality[q].push(c)
  }
  const availableQualities = (Object.keys(byQuality) as TierKey[]).filter((q) => byQuality[q].length > 0)
  const pickedQuality = pickQualityByPseudoRandomBag(pickedLevel, availableQualities)
  const qualityPool = byQuality[pickedQuality].length > 0 ? byQuality[pickedQuality] : levelCandidates
  const rawPicked = qualityPool[Math.floor(Math.random() * qualityPool.length)] ?? null
  if (!rawPicked) {
    ctx.nextQuickBuyOffer = null
    return null
  }
  let picked = applyQuickBuySynthesisRewrite(ctx, rawPicked, levelCandidates, callbacks)

  if (force && ctx.quickBuyNoSynthRefreshStreak >= 2 && !canOfferImmediateSynthesis(ctx, picked, callbacks)) {
    const synthCandidates: PoolCandidate[] = []
    const levels: Array<1 | 2 | 3 | 4 | 5 | 6 | 7> = [1, 2, 3, 4, 5, 6, 7]
    for (const lv of levels) {
      if (effectiveWeights[lv - 1] <= 0) continue
      for (const one of byLevel[lv]) {
        const rewritten = applyQuickBuySynthesisRewrite(ctx, one, byLevel[lv], callbacks)
        if (!canOfferImmediateSynthesis(ctx, rewritten, callbacks)) continue
        synthCandidates.push(rewritten)
      }
    }
    const forced = synthCandidates[Math.floor(Math.random() * synthCandidates.length)] ?? null
    if (forced) picked = forced
  }

  if (force) {
    if (canOfferImmediateSynthesis(ctx, picked, callbacks)) ctx.quickBuyNoSynthRefreshStreak = 0
    else ctx.quickBuyNoSynthRefreshStreak = Math.min(3, ctx.quickBuyNoSynthRefreshStreak + 1)
  }

  ctx.nextQuickBuyOffer = {
    itemId: picked.item.id,
    tier: picked.tier,
    star: picked.star,
    price: picked.price,
  }
  return picked
}
