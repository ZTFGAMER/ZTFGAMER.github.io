// ============================================================
// SkillSystem — 技能业务逻辑（函数集合模式）
// 职责：
//   - 技能持有查询（hasPickedSkill / upsertPickedSkill / removePickedSkill）
//   - 购买价格计算（resolveBuyPriceWithSkills）
//   - 技能消耗（consumeSkill15 / consumeSkill30）
//   - Skill20 每日赠品（grantSkill20DailyBronzeItemIfNeeded）
//   - 技能草稿选项生成（pickSkillChoices / pickSkillChoicesNoOverlap / pickSkillChoicesExactTier）
//   - 技能池辅助（makeSkillPoolByTier / pickMixedSkillTier / getDominantBattleArchetype）
//   - 快速购买（buyRandomBronzeToBoardOrBackpack）
// ============================================================

import { getConfig, getAllItems } from '@/core/DataLoader'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { normalizeSize, type ItemDef, type SkillArchetype, type SkillTier } from '@/common/items/ItemDef'
import type { TierKey } from '@/shop/ShopManager'
import { getMinQuickBuyLevelForDay, getUnlockPoolBuyPriceByLevel, levelToTierStar } from './QuickBuySystem'
import { getInstanceLevel } from './ShopInstanceRegistry'
import { BRONZE_SKILL_PICKS, getBronzeSkillById } from '@/common/skills/BronzeSkillConfig'
import { SILVER_SKILL_PICKS, getSilverSkillById } from '@/common/skills/SilverSkillConfig'
import { GOLD_SKILL_PICKS, getGoldSkillById } from '@/common/skills/GoldSkillConfig'
import {
  parseTierName,
  toSkillArchetype,
  getPrimaryArchetype,
  isNeutralItemDef,
  getItemDefById,
  tierStarLevelIndex,
} from './ShopSynthesisLogic'
import type { ShopSceneCtx, SkillPick } from '../ShopSceneContext'

// ============================================================
// 技能持有查询
// ============================================================

export function hasPickedSkill(ctx: ShopSceneCtx, skillId: string): boolean {
  return ctx.pickedSkills.some((s) => s.id === skillId)
}

export function upsertPickedSkill(
  ctx: ShopSceneCtx,
  skillId: string,
  deps: { grantSkill20DailyBronzeItemIfNeeded: () => void },
): void {
  const found = getBronzeSkillById(skillId) ?? getSilverSkillById(skillId) ?? getGoldSkillById(skillId)
  if (!found) return
  if (hasPickedSkill(ctx, skillId)) return
  ctx.pickedSkills = [...ctx.pickedSkills, {
    id: found.id,
    name: found.name,
    archetype: found.archetype,
    desc: found.desc,
    detailDesc: found.detailDesc,
    tier: found.tier,
    icon: found.icon,
  }]
  if (skillId === 'skill15') ensureSkill15NextBuyDiscountReady(ctx)
  if (skillId === 'skill20') deps.grantSkill20DailyBronzeItemIfNeeded()
}

export function removePickedSkill(
  ctx: ShopSceneCtx,
  skillId: string,
  deps: { getDefaultSkillDetailMode: () => 'simple' | 'detailed' },
): void {
  ctx.pickedSkills = ctx.pickedSkills.filter((s) => s.id !== skillId)
  if (ctx.skillDetailSkillId === skillId) {
    ctx.skillDetailSkillId = null
    ctx.skillDetailMode = deps.getDefaultSkillDetailMode()
  }
  if (skillId === 'skill15') resetSkill15NextBuyDiscountState(ctx)
  if (skillId === 'skill30') resetSkill30BundleState(ctx)
}

// ============================================================
// Skill15 / Skill30 状态管理
// ============================================================

export function resetSkill15NextBuyDiscountState(ctx: ShopSceneCtx): void {
  ctx.skill15NextBuyDiscountPrepared = false
  ctx.skill15NextBuyDiscount = false
}

export function resetSkill30BundleState(ctx: ShopSceneCtx): void {
  ctx.skill30BuyCounter = 0
  ctx.skill30NextBuyFree = false
}

export function ensureSkill15NextBuyDiscountReady(ctx: ShopSceneCtx): void {
  if (!hasPickedSkill(ctx, 'skill15')) {
    resetSkill15NextBuyDiscountState(ctx)
    return
  }
  if (ctx.skill15NextBuyDiscountPrepared) return
  ctx.skill15NextBuyDiscountPrepared = true
  ctx.skill15NextBuyDiscount = Math.random() < 0.25
}

export function resolveBuyPriceWithSkills(ctx: ShopSceneCtx, basePrice: number): { finalPrice: number; discount: number; freeBySkill30: boolean } {
  const safeBase = Math.max(1, Math.round(basePrice))

  if (hasPickedSkill(ctx, 'skill30') && ctx.skill30NextBuyFree) {
    return {
      finalPrice: 0,
      discount: safeBase,
      freeBySkill30: true,
    }
  }

  ensureSkill15NextBuyDiscountReady(ctx)
  if (!hasPickedSkill(ctx, 'skill15')) return { finalPrice: safeBase, discount: 0, freeBySkill30: false }
  if (!ctx.skill15NextBuyDiscount) return { finalPrice: safeBase, discount: 0, freeBySkill30: false }
  const finalPrice = Math.max(1, safeBase - 1)
  return { finalPrice, discount: safeBase - finalPrice, freeBySkill30: false }
}

export function consumeSkill15NextBuyDiscountAfterSuccess(ctx: ShopSceneCtx): boolean {
  if (!hasPickedSkill(ctx, 'skill15')) {
    resetSkill15NextBuyDiscountState(ctx)
    return false
  }
  ensureSkill15NextBuyDiscountReady(ctx)
  const consumedDiscount = ctx.skill15NextBuyDiscount
  ctx.skill15NextBuyDiscountPrepared = false
  ctx.skill15NextBuyDiscount = false
  ensureSkill15NextBuyDiscountReady(ctx)
  return consumedDiscount
}

export function consumeSkill30BundleAfterSuccess(ctx: ShopSceneCtx, consumedFreeBuy: boolean): boolean {
  if (!hasPickedSkill(ctx, 'skill30')) {
    resetSkill30BundleState(ctx)
    return false
  }

  if (consumedFreeBuy) {
    ctx.skill30NextBuyFree = false
    ctx.skill30BuyCounter = 1
    return true
  }

  ctx.skill30BuyCounter += 1
  if (ctx.skill30BuyCounter >= 4) {
    ctx.skill30BuyCounter = 0
    ctx.skill30NextBuyFree = true
    return true
  }
  return false
}

// ============================================================
// Skill20 每日赠送青铜物品
// ============================================================

export type GrantSkill20Callbacks = {
  findFirstBackpackPlace: (size: ReturnType<typeof normalizeSize>) => { col: number; row: number } | null
  nextId: () => string
  toVisualTier: (tier: TierKey, star: 1 | 2) => string | undefined
  setInstanceQualityLevel: (instanceId: string, defId: string, quality: TierKey, level: number) => void
  instanceToDefId: Map<string, string>
  instanceToPermanentDamageBonus: Map<string, number>
  recordNeutralItemObtained: (itemId: string) => void
  unlockItemToPool: (itemId: string) => void
  showHintToast: (reason: string, message: string, color?: number) => void
}

export function grantSkill20DailyBronzeItemIfNeeded(ctx: ShopSceneCtx, deps: GrantSkill20Callbacks): void {
  if (!hasPickedSkill(ctx, 'skill20')) return
  if (ctx.skill20GrantedDays.has(ctx.currentDay)) return
  if (!ctx.backpackSystem || !ctx.backpackView) return

  const candidate = getAllItems().filter((it) => String(it.starting_tier || '').includes('Bronze') && !isNeutralItemDef(it))
  if (candidate.length <= 0) return

  ctx.skill20GrantedDays.add(ctx.currentDay)
  const picked = candidate[Math.floor(Math.random() * candidate.length)]
  if (!picked) return
  const place = deps.findFirstBackpackPlace(normalizeSize(picked.size))
  if (!place) {
    deps.showHintToast('backpack_full_buy', '背包大师：背包已满，今日赠送作废', 0xffb27a)
    return
  }

  const id = deps.nextId()
  ctx.backpackSystem.place(place.col, place.row, normalizeSize(picked.size), picked.id, id)
  void ctx.backpackView.addItem(id, picked.id, normalizeSize(picked.size), place.col, place.row, deps.toVisualTier('Bronze', 1)).then(() => {
    ctx.backpackView!.setItemTier(id, deps.toVisualTier('Bronze', 1))
    ctx.drag?.refreshZone(ctx.backpackView!)
  })
  deps.instanceToDefId.set(id, picked.id)
  deps.setInstanceQualityLevel(id, picked.id, parseTierName(picked.starting_tier) ?? 'Bronze', 1)
  deps.instanceToPermanentDamageBonus.set(id, 0)
  deps.recordNeutralItemObtained(picked.id)
  deps.unlockItemToPool(picked.id)
  deps.showHintToast('backpack_full_buy', `背包大师：获得 ${picked.name_cn}（青铜1星）`, 0x86e1ff)
}

// ============================================================
// 技能草稿：每日计划 / 池 / 选项生成
// ============================================================

export function getSkillDailyDraftPlanRows(): Array<Record<string, unknown>> {
  const skillCfg = getConfig().skillSystem as { dailyDraftPlan?: Array<Record<string, unknown>> } | undefined
  if (!skillCfg || !Array.isArray(skillCfg.dailyDraftPlan)) return []
  return skillCfg.dailyDraftPlan
}

export function getDailyPlanRow(day: number): Record<string, unknown> | null {
  return getSkillDailyDraftPlanRows().find((it) => Math.round(Number(it.day) || 0) === day) ?? null
}

export function getSkillTierForDay(day: number): SkillTier | null {
  const skillCfg = getConfig().skillSystem
  if (!skillCfg) return null
  const plan = getSkillDailyDraftPlanRows().find((it) => Math.round(Number(it.day) || 0) === day)
  if (plan) {
    if ((Number(plan.shouldDraft) || 0) < 0.5) return null
    const bronze = Math.max(0, Number(plan.bronzeProb) || 0)
    const silver = Math.max(0, Number(plan.silverProb) || 0)
    const gold = Math.max(0, Number(plan.goldProb) || 0)
    if (bronze >= silver && bronze >= gold) return 'bronze'
    if (silver >= bronze && silver >= gold) return 'silver'
    return 'gold'
  }
  if ((skillCfg.triggerDaysByTier.bronze ?? []).includes(day)) return 'bronze'
  if ((skillCfg.triggerDaysByTier.silver ?? []).includes(day)) return 'silver'
  if ((skillCfg.triggerDaysByTier.gold ?? []).includes(day)) return 'gold'
  return null
}

export function makeSkillPoolByTier(tier: SkillTier): SkillPick[] {
  if (tier === 'bronze') return [...BRONZE_SKILL_PICKS]
  if (tier === 'silver') return [...SILVER_SKILL_PICKS]
  if (tier === 'gold') return [...GOLD_SKILL_PICKS]
  return []
}

export function randomByWeight(entries: Array<{ key: SkillTier; weight: number }>): SkillTier {
  const valid = entries.filter((it) => Number.isFinite(it.weight) && it.weight > 0)
  if (valid.length <= 0) return 'bronze'
  const sum = valid.reduce((acc, it) => acc + it.weight, 0)
  let roll = Math.random() * sum
  for (const one of valid) {
    roll -= one.weight
    if (roll <= 0) return one.key
  }
  return valid[valid.length - 1]!.key
}

export function pickMixedSkillTier(baseTier: SkillTier, day: number): SkillTier {
  const plan = getSkillDailyDraftPlanRows().find((it) => Math.round(Number(it.day) || 0) === day)
  if (plan) {
    const bronze = Math.max(0, Number(plan.bronzeProb) || 0)
    const silver = Math.max(0, Number(plan.silverProb) || 0)
    const gold = Math.max(0, Number(plan.goldProb) || 0)
    if (bronze + silver + gold > 0) {
      return randomByWeight([
        { key: 'bronze', weight: bronze },
        { key: 'silver', weight: silver },
        { key: 'gold', weight: gold },
      ])
    }
  }

  if (baseTier === 'bronze') {
    return randomByWeight([
      { key: 'bronze', weight: 70 },
      { key: 'silver', weight: 25 },
      { key: 'gold', weight: 5 },
    ])
  }
  if (baseTier === 'silver') {
    return randomByWeight([
      { key: 'bronze', weight: 20 },
      { key: 'silver', weight: 60 },
      { key: 'gold', weight: 20 },
    ])
  }
  return randomByWeight([
    { key: 'bronze', weight: 10 },
    { key: 'silver', weight: 30 },
    { key: 'gold', weight: 60 },
  ])
}

export function getDominantBattleArchetype(ctx: ShopSceneCtx): SkillArchetype | null {
  if (!ctx.battleSystem) return null
  const counts = new Map<SkillArchetype, number>()
  for (const it of ctx.battleSystem.getAllItems()) {
    const def = getItemDefById(it.defId)
    const archetype = toSkillArchetype(getPrimaryArchetype(def?.tags ?? ''))
    if (!archetype || archetype === 'utility') continue
    counts.set(archetype, (counts.get(archetype) ?? 0) + 1)
  }
  if (counts.size <= 0) return null
  let maxCount = 0
  const top: SkillArchetype[] = []
  for (const [archetype, count] of counts) {
    if (count > maxCount) {
      maxCount = count
      top.length = 0
      top.push(archetype)
      continue
    }
    if (count === maxCount) top.push(archetype)
  }
  if (top.length <= 0) return null
  return top[Math.floor(Math.random() * top.length)] ?? null
}

export function pickSkillChoices(ctx: ShopSceneCtx, baseTier: SkillTier, day: number): SkillPick[] {
  const picks: SkillPick[] = []
  const usedIds = new Set<string>()
  const alreadyPicked = new Set(ctx.pickedSkills.map((s) => s.id))
  const chooseCount = 2
  const firstDayArchetype: SkillArchetype | null = null
  const dominantBattleArchetype = firstDayArchetype ? null : getDominantBattleArchetype(ctx)

  const tryPickOne = (
    forcedArchetype: SkillArchetype | null,
    blockedArchetype: SkillArchetype | null,
  ): boolean => {
    for (let attempt = 0; attempt < 24; attempt++) {
      const tier = pickMixedSkillTier(baseTier, day)
      let source = makeSkillPoolByTier(tier).filter((s) => !usedIds.has(s.id) && !alreadyPicked.has(s.id))
      if (forcedArchetype) source = source.filter((s) => s.archetype === forcedArchetype)
      if (blockedArchetype) source = source.filter((s) => s.archetype !== blockedArchetype)
      if (source.length <= 0) continue
      const picked = source[Math.floor(Math.random() * source.length)]
      if (!picked) continue
      picks.push(picked)
      usedIds.add(picked.id)
      return true
    }
    return false
  }

  if (firstDayArchetype) {
    while (picks.length < chooseCount) {
      const ok = tryPickOne(firstDayArchetype, null)
      if (!ok) break
    }
  } else {
    if (dominantBattleArchetype) {
      const pickedDominant = tryPickOne(dominantBattleArchetype, null)
      if (!pickedDominant) {
        const fallbackFirst = tryPickOne(null, null)
        if (!fallbackFirst) return picks
      }
    } else {
      const first = tryPickOne(null, null)
      if (!first) return picks
    }

    while (picks.length < chooseCount) {
      const blockedArchetype = picks[0]?.archetype ?? null
      const ok = tryPickOne(null, blockedArchetype)
      if (!ok) {
        const fallback = tryPickOne(null, null)
        if (!fallback) break
      }
    }
  }

  const allSameArchetype = picks.length >= 3 && picks.every((s) => s.archetype === picks[0]!.archetype)
  const allUtility = picks.length >= 3 && picks.every((s) => s.archetype === 'utility')
  if (!firstDayArchetype && (allSameArchetype || allUtility)) {
    for (let i = 0; i < 18; i++) {
      const idx = Math.floor(Math.random() * picks.length)
      const current = picks[idx]
      if (!current) continue
      const replacementTier = pickMixedSkillTier(baseTier, day)
      const replacementPool = makeSkillPoolByTier(replacementTier).filter((s) => {
        if (s.id === current.id) return false
        if (usedIds.has(s.id)) return false
        if (alreadyPicked.has(s.id)) return false
        if (s.archetype === current.archetype) return false
        return true
      })
      if (replacementPool.length <= 0) continue
      const replacement = replacementPool[Math.floor(Math.random() * replacementPool.length)]
      if (!replacement) continue
      usedIds.delete(current.id)
      picks[idx] = replacement
      usedIds.add(replacement.id)
      break
    }
  }

  return picks.slice(0, chooseCount)
}

export function pickSkillChoicesNoOverlap(ctx: ShopSceneCtx, baseTier: SkillTier, day: number, blockedIds: Set<string>): SkillPick[] {
  for (let i = 0; i < 80; i++) {
    const next = pickSkillChoices(ctx, baseTier, day).slice(0, 2)
    if (next.length < 2) continue
    const hasOverlap = next.some((it) => blockedIds.has(it.id))
    if (!hasOverlap) return next
  }
  return []
}

export function pickSkillChoicesExactTier(ctx: ShopSceneCtx, baseTier: SkillTier, blockedIds?: Set<string>): SkillPick[] {
  const alreadyPicked = new Set(ctx.pickedSkills.map((s) => s.id))
  const blocked = blockedIds ?? new Set<string>()
  const pool = makeSkillPoolByTier(baseTier).filter((s) => !alreadyPicked.has(s.id) && !blocked.has(s.id))
  if (pool.length <= 0) return []
  const shuffled = [...pool]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = shuffled[i]
    shuffled[i] = shuffled[j]!
    shuffled[j] = tmp!
  }
  const picks: SkillPick[] = []
  const dominantBattleArchetype = getDominantBattleArchetype(ctx)
  if (dominantBattleArchetype) {
    const dominantPool = shuffled.filter((s) => s.archetype === dominantBattleArchetype)
    const preferred = dominantPool[Math.floor(Math.random() * dominantPool.length)]
    if (preferred) {
      picks.push(preferred)
      const idx = shuffled.findIndex((s) => s.id === preferred.id)
      if (idx >= 0) shuffled.splice(idx, 1)
    }
  }
  for (const one of shuffled) {
    if (picks.length >= 2) break
    picks.push(one)
  }
  return picks
}

// ============================================================
// 快速购买（buyRandomBronzeToBoardOrBackpack）
// ============================================================

export type BuyRandomBronzeCallbacks = {
  syncShopOwnedTierRules: () => void
  rollNextQuickBuyOffer: (force: boolean) => { item: ItemDef; tier: TierKey; star: 1 | 2; price: number } | null
  findCandidateByOffer: (offer: { itemId: string; tier: TierKey; star: 1 | 2; price: number } | null) => { item: ItemDef; tier: TierKey; star: 1 | 2; price: number; level: number } | null
  collectPoolCandidatesByLevel: (level: 1 | 2 | 3 | 4 | 5 | 6 | 7) => Array<{ item: ItemDef; tier: TierKey; star: 1 | 2; price: number; level: number }>
  canBuyItemUnderFirstPurchaseRule: (item: ItemDef) => boolean
  showFirstPurchaseRuleHint: () => void
  findFirstBattlePlace: (size: ReturnType<typeof normalizeSize>) => { col: number; row: number } | null
  findFirstBackpackPlace: (size: ReturnType<typeof normalizeSize>) => { col: number; row: number } | null
  showHintToast: (reason: string, message: string, color?: number) => void
  refreshShopUI: () => void
  markShopPurchaseDone: () => void
  nextId: () => string
  toVisualTier: (tier: TierKey, star: 1 | 2) => string | undefined
  instanceToDefId: Map<string, string>
  setInstanceQualityLevel: (instanceId: string, defId: string, quality: TierKey, level: number) => void
  forceInstanceLevel: (instanceId: string, level: number) => void
  levelFromLegacyTierStar: (tier: TierKey, star: 1 | 2) => 1 | 2 | 3 | 4 | 5 | 6 | 7
  instanceToPermanentDamageBonus: Map<string, number>
  recordNeutralItemObtained: (itemId: string) => void
  updateNeutralPseudoRandomCounterOnPurchase: (item: ItemDef) => void
  unlockItemToPool: (itemId: string) => void
}

function pickBronzeOnlyLowLevelOddTarget(
  ctx: ShopSceneCtx,
): { level: 1 | 2 | 3 | 4 | 5 | 6 | 7; archetype: SkillArchetype } | null {
  if (!ctx.battleSystem || !ctx.backpackSystem) return null
  const dayMinLevel = getMinQuickBuyLevelForDay(ctx.currentDay)
  const lowLevelArchetypeCount = new Map<string, number>()
  const collectLowLevelArchetypeCounts = (items: ReturnType<NonNullable<ShopSceneCtx['battleSystem']>['getAllItems']>) => {
    for (const it of items) {
      const lv = getInstanceLevel(it.instanceId)
      if (lv >= dayMinLevel) continue
      const def = getItemDefById(it.defId)
      const arch = toSkillArchetype(getPrimaryArchetype(def?.tags ?? ''))
      if (!arch || arch === 'utility') continue
      const key = `${lv}|${arch}`
      lowLevelArchetypeCount.set(key, (lowLevelArchetypeCount.get(key) ?? 0) + 1)
    }
  }
  collectLowLevelArchetypeCounts(ctx.battleSystem.getAllItems())
  collectLowLevelArchetypeCounts(ctx.backpackSystem.getAllItems())

  const pending = Array.from(lowLevelArchetypeCount.entries())
    .map(([key, count]) => {
      const [lvRaw, archRaw] = key.split('|')
      return {
        level: Math.max(1, Math.min(7, Number(lvRaw) || 1)) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
        archetype: archRaw as SkillArchetype,
        count,
      }
    })
    .filter((it) => (it.count % 2) === 1)
    .sort((a, b) => (a.level - b.level) || (a.count - b.count))

  const firstPending = pending[0]
  return firstPending ? { level: firstPending.level, archetype: firstPending.archetype } : null
}

export function getBronzeOnlyForcedLowLevelPrice(ctx: ShopSceneCtx): number | null {
  if (getDebugCfg('gameplayBaseBuyBronzeOnly') < 0.5) return null
  const target = pickBronzeOnlyLowLevelOddTarget(ctx)
  return target ? getUnlockPoolBuyPriceByLevel(target.level) : null
}

export function buyRandomBronzeToBoardOrBackpack(ctx: ShopSceneCtx, deps: BuyRandomBronzeCallbacks): void {
  if (!ctx.shopManager || !ctx.battleSystem || !ctx.battleView || !ctx.backpackSystem || !ctx.backpackView) return
  const manager = ctx.shopManager
  const bronzeOnly = getDebugCfg('gameplayBaseBuyBronzeOnly') >= 0.5

  deps.syncShopOwnedTierRules()
  let picked = deps.rollNextQuickBuyOffer(false)
  if (!picked) {
    deps.showHintToast('no_gold_buy', '无可用购买池', 0xff8f8f)
    deps.refreshShopUI()
    return
  }

  if (!deps.findCandidateByOffer(ctx.nextQuickBuyOffer)) {
    picked = deps.rollNextQuickBuyOffer(true)
    if (!picked) {
      deps.showHintToast('no_gold_buy', '无可用购买池', 0xff8f8f)
      deps.refreshShopUI()
      return
    }
  }

  let sourceTier: TierKey = picked.tier
  let sourceStar: 1 | 2 = picked.star
  let tierForced: TierKey = bronzeOnly ? 'Bronze' : picked.tier
  let starForced: 1 | 2 = bronzeOnly ? 1 : picked.star
  let forceLowLevelArchetype: SkillArchetype | null = null
  let forceLowLevelLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7 | null = null

  if (bronzeOnly) {
    const forcedTarget = pickBronzeOnlyLowLevelOddTarget(ctx)
    if (forcedTarget) {
      forceLowLevelArchetype = forcedTarget.archetype
      forceLowLevelLevel = forcedTarget.level
      const legacy = levelToTierStar(forceLowLevelLevel)
      if (legacy) {
        sourceTier = legacy.tier
        sourceStar = legacy.star
        tierForced = 'Bronze'
        starForced = 1
      }
    }
  }

  if (!forceLowLevelArchetype && ctx.dayEventState.forceBuyArchetype && ctx.dayEventState.forceBuyRemaining > 0) {
    const level = tierStarLevelIndex(sourceTier, sourceStar) + 1
    const levelKey = Math.max(1, Math.min(7, level)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
    const forcePool = deps.collectPoolCandidatesByLevel(levelKey).filter((one) =>
      toSkillArchetype(getPrimaryArchetype(one.item.tags)) === ctx.dayEventState.forceBuyArchetype,
    )
    const forced = forcePool[Math.floor(Math.random() * forcePool.length)]
    if (forced) {
      picked = forced
      sourceTier = forced.tier
      sourceStar = forced.star
      tierForced = bronzeOnly ? 'Bronze' : forced.tier
      starForced = bronzeOnly ? 1 : forced.star
    }
  }
  let itemForced = picked.item
  if (bronzeOnly) {
    const sourceLevel = deps.levelFromLegacyTierStar(sourceTier, sourceStar)
    const sameLevelCountByDef = new Map<string, number>()
    const collectLevelCounts = (items: ReturnType<NonNullable<ShopSceneCtx['battleSystem']>['getAllItems']>) => {
      for (const it of items) {
        const lv = getInstanceLevel(it.instanceId)
        if (lv !== sourceLevel) continue
        sameLevelCountByDef.set(it.defId, (sameLevelCountByDef.get(it.defId) ?? 0) + 1)
      }
    }
    collectLevelCounts(ctx.battleSystem.getAllItems())
    collectLevelCounts(ctx.backpackSystem.getAllItems())

    const allBronze = deps.collectPoolCandidatesByLevel(1)
      .filter((one) => (parseTierName(one.item.starting_tier) ?? 'Bronze') === 'Bronze')
    if (forceLowLevelArchetype) {
      const sameArchetypePool = allBronze.filter((one) =>
        toSkillArchetype(getPrimaryArchetype(one.item.tags)) === forceLowLevelArchetype,
      )
      const bronzePool = sameArchetypePool.length > 0 ? sameArchetypePool : allBronze
      const pickedBronze = bronzePool[Math.floor(Math.random() * bronzePool.length)]
      if (pickedBronze) itemForced = pickedBronze.item
    } else {
      const scored = allBronze.map((one) => ({ one, count: sameLevelCountByDef.get(one.item.id) ?? 0 }))
      const underTwoPool = scored.filter((it) => it.count < 2).map((it) => it.one)
      const bronzePool = underTwoPool.length > 0
        ? underTwoPool
        : (() => {
          const minCount = scored.reduce((min, it) => Math.min(min, it.count), Number.MAX_SAFE_INTEGER)
          return scored.filter((it) => it.count === minCount).map((it) => it.one)
        })()
      const pickedBronze = bronzePool[Math.floor(Math.random() * bronzePool.length)]
      if (pickedBronze) itemForced = pickedBronze.item
    }
  }
  const forcedPrice = forceLowLevelLevel ? getUnlockPoolBuyPriceByLevel(forceLowLevelLevel) : null
  const buyPrice = forcedPrice ?? picked.price
  const priced = resolveBuyPriceWithSkills(ctx, buyPrice)

  if (!deps.canBuyItemUnderFirstPurchaseRule(itemForced)) {
    deps.showFirstPurchaseRuleHint()
    deps.refreshShopUI()
    return
  }

  const size = normalizeSize(itemForced.size)
  const battleSlot = deps.findFirstBattlePlace(size)
  const backpackSlot = battleSlot ? null : deps.findFirstBackpackPlace(size)
  if (!battleSlot && !backpackSlot) {
    deps.showHintToast('backpack_full_buy', '背包已满，无法购买', 0xff8f8f)
    deps.refreshShopUI()
    return
  }

  if (manager.gold < priced.finalPrice) {
    deps.showHintToast('no_gold_buy', `金币不足，需${priced.finalPrice}G`, 0xff8f8f)
    deps.refreshShopUI()
    return
  }

  manager.gold -= priced.finalPrice
  if (consumeSkill15NextBuyDiscountAfterSuccess(ctx)) deps.showHintToast('no_gold_buy', '砍价高手触发：本次-1G', 0x8ff0b0)
  const skill30Ready = consumeSkill30BundleAfterSuccess(ctx, priced.freeBySkill30)
  if (priced.freeBySkill30) deps.showHintToast('no_gold_buy', '打包购买触发：本次0金币', 0x9be5ff)
  else if (skill30Ready) deps.showHintToast('no_gold_buy', '打包购买就绪：下次购买0金币', 0x9be5ff)
  if (ctx.dayEventState.forceBuyRemaining > 0) {
    ctx.dayEventState.forceBuyRemaining = Math.max(0, ctx.dayEventState.forceBuyRemaining - 1)
    if (ctx.dayEventState.forceBuyRemaining <= 0) ctx.dayEventState.forceBuyArchetype = null
  }
  deps.markShopPurchaseDone()
  const id = deps.nextId()
  const visualTier = deps.toVisualTier(bronzeOnly ? sourceTier : tierForced, bronzeOnly ? sourceStar : starForced)
  if (battleSlot && ctx.battleSystem && ctx.battleView) {
    ctx.battleSystem.place(battleSlot.col, battleSlot.row, size, itemForced.id, id)
    void ctx.battleView.addItem(id, itemForced.id, size, battleSlot.col, battleSlot.row, visualTier).then(() => {
      ctx.battleView!.setItemTier(id, visualTier)
      ctx.drag?.refreshZone(ctx.battleView!)
    })
    console.log(`[SkillSystem] 购买(${tierForced}#${starForced})→上阵区 ${itemForced.name_cn} -${priced.finalPrice}G，金币: ${manager.gold}`)
  } else if (backpackSlot) {
    ctx.backpackSystem.place(backpackSlot.col, backpackSlot.row, size, itemForced.id, id)
    void ctx.backpackView.addItem(id, itemForced.id, size, backpackSlot.col, backpackSlot.row, visualTier).then(() => {
      ctx.backpackView!.setItemTier(id, visualTier)
      ctx.drag?.refreshZone(ctx.backpackView!)
    })
    console.log(`[SkillSystem] 购买(${tierForced}#${starForced})→背包 ${itemForced.name_cn} -${priced.finalPrice}G，金币: ${manager.gold}`)
  }
  deps.instanceToDefId.set(id, itemForced.id)
  const sourceLevel = deps.levelFromLegacyTierStar(sourceTier, sourceStar)
  deps.setInstanceQualityLevel(
    id,
    itemForced.id,
    bronzeOnly ? 'Bronze' : (parseTierName(itemForced.starting_tier) ?? 'Bronze'),
    sourceLevel,
  )
  if (bronzeOnly) deps.forceInstanceLevel(id, sourceLevel)
  deps.instanceToPermanentDamageBonus.set(id, 0)
  deps.recordNeutralItemObtained(itemForced.id)
  deps.updateNeutralPseudoRandomCounterOnPurchase(itemForced)
  deps.unlockItemToPool(itemForced.id)
  deps.rollNextQuickBuyOffer(true)
  deps.refreshShopUI()
}
