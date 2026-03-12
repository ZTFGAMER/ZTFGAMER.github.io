// ============================================================
// ShopStateStorage — 商店狀態存取（純 I/O 模塊）
// ============================================================
// 職責：
//   - saveShopStateToStorage：序列化並寫入 localStorage
//   - loadShopStateFromStorage：從 localStorage 讀取並反序列化
//   - captureShopState：從 ctx + InstanceRegistry 構建 SavedShopState 快照
//   - applySavedShopState：將 SavedShopState 恢復到 ctx + InstanceRegistry
// ============================================================

import { SHOP_STATE_STORAGE_KEY } from '@/core/RunState'
import { getAllItems } from '@/core/DataLoader'
import type { ShopSlot } from '@/shop/ShopManager'
import type { GridSystem } from '@/common/grid/GridSystem'
import type { GridZone } from '@/common/grid/GridZone'
import { normalizeTierStar } from './systems/ShopSynthesisLogic'
import {
  clampLevel as _PSU_clampLevel,
} from './ui/PlayerStatusUI'
import {
  QUALITY_PSEUDO_RANDOM_STATE,
  QUICK_BUY_LEVEL_PSEUDO_RANDOM_STATE,
} from './systems/QuickBuySystem'
import {
  instCounter, setInstCounter,
  instanceToDefId, instanceToPermanentDamageBonus,
  clearAllInstanceMaps, setInstanceQualityLevel,
  getInstanceQuality, getInstanceLevel,
  getInstanceTier, getInstanceTierStar,
  deriveQualityByDefId, levelFromLegacyTierStar,
} from './systems/ShopInstanceRegistry'
import type {
  ShopSceneCtx,
  SavedShopState, SavedPlacedItem,
  PendingHeroPeriodicReward,
} from './ShopSceneContext'
import { getBackpackRowsByDay } from './ShopMathHelpers'

const SHOP_STATE_STORAGE_VERSION = 2

// ============================================================
// localStorage I/O
// ============================================================

export function saveShopStateToStorage(state: SavedShopState | null): void {
  if (!state) return
  try {
    localStorage.setItem(SHOP_STATE_STORAGE_KEY, JSON.stringify({
      version: SHOP_STATE_STORAGE_VERSION,
      state,
    }))
  } catch (err) {
    console.warn('[ShopStateStorage] 保存商店狀態失敗', err)
  }
}

export function loadShopStateFromStorage(): SavedShopState | null {
  try {
    const raw = localStorage.getItem(SHOP_STATE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as
      | { version?: unknown; state?: unknown }
      | Partial<SavedShopState>
      | null

    if (!parsed || typeof parsed !== 'object') return null

    const candidate = ('state' in parsed)
      ? (
          typeof (parsed as { version?: unknown }).version === 'number'
          && (parsed as { version?: number }).version === SHOP_STATE_STORAGE_VERSION
            ? (parsed as { state?: unknown }).state
            : null
        )
      : parsed

    if (!candidate || typeof candidate !== 'object') return null
    const state = candidate as Partial<SavedShopState>
    if (typeof state.day         !== 'number') return null
    if (typeof state.gold        !== 'number') return null
    if (typeof state.refreshIndex !== 'number') return null
    if (typeof state.instCounter  !== 'number') return null
    if (
      !Array.isArray(state.pool)         ||
      !Array.isArray(state.battleItems)  ||
      !Array.isArray(state.backpackItems)
    ) return null
    return state as SavedShopState
  } catch (err) {
    console.warn('[ShopStateStorage] 讀取商店狀態失敗', err)
    return null
  }
}

// ============================================================
// 本地工具
// ============================================================

function clampLevel(level: number): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return _PSU_clampLevel(level)
}

// ============================================================
// captureShopState — 快照序列化
// ============================================================

export function captureShopState(ctx: ShopSceneCtx): SavedShopState | null {
  if (!ctx.shopManager || !ctx.battleSystem || !ctx.backpackSystem) return null
  const captureItems = (items: ReturnType<GridSystem['getAllItems']>): SavedPlacedItem[] => items.map((it) => ({
    instanceId: it.instanceId,
    defId: it.defId,
    size: it.size,
    col: it.col,
    row: it.row,
    quality: getInstanceQuality(it.instanceId),
    level: getInstanceLevel(it.instanceId),
    tier: getInstanceTier(it.instanceId) ?? 'Bronze',
    tierStar: getInstanceTierStar(it.instanceId),
    permanentDamageBonus: Math.max(0, Math.round(instanceToPermanentDamageBonus.get(it.instanceId) ?? 0)),
  }))

  return {
    day: ctx.currentDay,
    gold: ctx.shopManager.gold,
    refreshIndex: ctx.shopManager.refreshIndex,
    pool: ctx.shopManager.pool.map((slot: ShopSlot) => ({
      itemId: slot.item.id,
      tier: slot.tier,
      price: slot.price,
      purchased: slot.purchased,
    })),
    battleItems: captureItems(ctx.battleSystem.getAllItems()),
    backpackItems: captureItems(ctx.backpackSystem.getAllItems()),
    instCounter,
    starterClass: ctx.starterClass,
    starterGranted: ctx.starterGranted,
    starterBattleGuideShown: ctx.starterBattleGuideShown,
    pickedSkills: ctx.pickedSkills,
    draftedSkillDays: ctx.draftedSkillDays,
    pendingSkillDraft: ctx.pendingSkillDraft,
    unlockedItemIds: Array.from(ctx.unlockedItemIds),
    nextQuickBuyOffer: ctx.nextQuickBuyOffer,
    guaranteedNewUnlockTriggeredLevels: Array.from(ctx.guaranteedNewUnlockTriggeredLevels),
    skill20GrantedDays: Array.from(ctx.skill20GrantedDays),
    hasBoughtOnce: ctx.hasBoughtOnce,
    skill15NextBuyDiscountPrepared: ctx.skill15NextBuyDiscountPrepared,
    skill15NextBuyDiscount: ctx.skill15NextBuyDiscount,
    skill30BuyCounter: ctx.skill30BuyCounter,
    skill30NextBuyFree: ctx.skill30NextBuyFree,
    quickBuyNoSynthRefreshStreak: ctx.quickBuyNoSynthRefreshStreak,
    quickBuyNeutralMissStreak: ctx.quickBuyNeutralMissStreak,
    draftedEventDays: ctx.draftedEventDays,
    pendingEventDraft: ctx.pendingEventDraft,
    selectedEventCounts: Array.from(ctx.selectedEventCountById.entries()).map(([id, count]) => ({ id, count })),
    dayEventState: {
      forceBuyArchetype: ctx.dayEventState.forceBuyArchetype,
      forceBuyRemaining: ctx.dayEventState.forceBuyRemaining,
      forceSynthesisArchetype: ctx.dayEventState.forceSynthesisArchetype,
      forceSynthesisRemaining: ctx.dayEventState.forceSynthesisRemaining,
      extraUpgradeRemaining: ctx.dayEventState.extraUpgradeRemaining,
      allSynthesisRandom: ctx.dayEventState.allSynthesisRandom,
    },
    futureEventState: {
      blockedBaseIncomeDays: Array.from(ctx.blockedBaseIncomeDays.values()),
      pendingGoldByDay: Array.from(ctx.pendingGoldByDay.entries()).map(([day, amount]) => ({ day, amount })),
      pendingBattleUpgradeByDay: Array.from(ctx.pendingBattleUpgradeByDay.entries()).map(([day, count]) => ({ day, count })),
    },
    draftedSpecialShopDays: ctx.draftedSpecialShopDays,
    specialShopRefreshCount: ctx.specialShopRefreshCount,
    specialShopOffers: ctx.specialShopOffers,
    neutralObtainedCounts: Array.from(ctx.neutralObtainedCountByKind.entries()).map(([kind, count]) => ({ kind, count })),
    neutralRandomCategoryPool: ctx.neutralRandomCategoryPool,
    neutralDailyRollCounts: Array.from(ctx.neutralDailyRollCountByDay.entries()).map(([day, count]) => ({ day, count })),
    levelRewardCategoryPool: [...ctx.levelRewardCategoryPool],
    pendingLevelRewards: [...ctx.pendingLevelRewards],
    pendingHeroPeriodicRewards: ctx.pendingHeroPeriodicRewards.map((one) => ({
      itemId: one.itemId,
      level: one.level,
      tier: one.tier,
      star: one.star,
      source: one.source,
    })),
    levelRewardObtainedCounts: Array.from(ctx.levelRewardObtainedByKind.entries()).map(([kind, count]) => ({ kind, count })),
    heroDailyCardRerollUsedDays: Array.from(ctx.heroDailyCardRerollUsedDays),
    heroFirstDiscardRewardedDays: Array.from(ctx.heroFirstDiscardRewardedDays),
    heroFirstSameItemSynthesisChoiceDays: Array.from(ctx.heroFirstSameItemSynthesisChoiceDays),
    heroSmithStoneGrantedDays: Array.from(ctx.heroSmithStoneGrantedDays),
    heroAdventurerScrollGrantedDays: Array.from(ctx.heroAdventurerScrollGrantedDays),
    heroCommanderMedalGrantedDays: Array.from(ctx.heroCommanderMedalGrantedDays),
    heroHeirGoldEquipGrantedDays: Array.from(ctx.heroHeirGoldEquipGrantedDays),
    heroTycoonGoldGrantedDays: Array.from(ctx.heroTycoonGoldGrantedDays),
    levelQuickDraftSavedEntries: ctx.levelQuickDraftSavedEntries.map((entry) => ({
      title: String(entry.title ?? '').trim() || '奖励区',
      picks: (entry.picks ?? []).slice(0, 3).map((pick) => ({
        defId: String(pick.defId ?? ''),
        level: clampLevel(Number(pick.level ?? 1)),
        tier: pick.tier,
        star: Math.max(1, Math.min(2, Math.round(Number(pick.star ?? 1)))) as 1 | 2,
      })).filter((pick) => pick.defId.length > 0),
    })).filter((entry) => entry.picks.length > 0),
  }
}

// ============================================================
// applySavedShopState callbacks 類型
// ============================================================

export type ApplySavedShopStateCallbacks = {
  toVisualTier: (tier?: import('@/shop/ShopManager').TierKey, star?: 1 | 2) => string | undefined
  syncUnlockPoolToManager: () => void
  hasPickedSkill: (id: string) => boolean
  resetSkill15NextBuyDiscountState: () => void
  resetSkill30BundleState: () => void
}

// ============================================================
// applySavedShopState — 狀態恢復
// ============================================================

export function applySavedShopState(
  state: SavedShopState,
  ctx: ShopSceneCtx,
  callbacks: ApplySavedShopStateCallbacks,
): void {
  if (!ctx.shopManager || !ctx.battleSystem || !ctx.backpackSystem || !ctx.battleView || !ctx.backpackView) return
  const { toVisualTier, syncUnlockPoolToManager, hasPickedSkill,
    resetSkill15NextBuyDiscountState, resetSkill30BundleState } = callbacks
  const all = getAllItems()
  const byId = new Map(all.map((it) => [it.id, it] as const))

  ctx.currentDay = state.day
  const restoredBackpackRows = getBackpackRowsByDay(ctx.currentDay)
  ctx.backpackSystem.setActiveRows(restoredBackpackRows)
  ctx.backpackView.setActiveRowCount(restoredBackpackRows)
  ctx.starterClass = state.starterClass ?? null
  ctx.starterGranted = state.starterGranted ?? false
  ctx.starterBattleGuideShown = state.starterBattleGuideShown ?? false
  ctx.hasBoughtOnce = state.hasBoughtOnce
    ?? ((state.battleItems?.length ?? 0) + (state.backpackItems?.length ?? 0) > 0)
  ctx.pickedSkills = Array.isArray(state.pickedSkills) ? state.pickedSkills : []
  ctx.draftedSkillDays = Array.isArray(state.draftedSkillDays)
    ? state.draftedSkillDays.filter((d) => Number.isFinite(d)).map((d) => Math.max(1, Math.round(d)))
    : []
  ctx.pendingSkillDraft = (state.pendingSkillDraft && typeof state.pendingSkillDraft === 'object')
    ? state.pendingSkillDraft
    : null
  ctx.draftedEventDays = Array.isArray(state.draftedEventDays)
    ? state.draftedEventDays.filter((d) => Number.isFinite(d)).map((d) => Math.max(1, Math.round(d)))
    : []
  ctx.pendingEventDraft = (state.pendingEventDraft && typeof state.pendingEventDraft === 'object')
    ? state.pendingEventDraft
    : null
  ctx.draftedSpecialShopDays = Array.isArray(state.draftedSpecialShopDays)
    ? state.draftedSpecialShopDays.filter((d) => Number.isFinite(d)).map((d) => Math.max(1, Math.round(d)))
    : []
  ctx.specialShopRefreshCount = Math.max(0, Math.round(Number(state.specialShopRefreshCount ?? 0) || 0))
  ctx.specialShopOffers = Array.isArray(state.specialShopOffers)
    ? state.specialShopOffers
      .filter((it) => it && typeof it.itemId === 'string')
      .map((it) => ({
        itemId: it.itemId,
        tier: it.tier,
        star: normalizeTierStar(it.tier, it.star),
        basePrice: Math.max(1, Math.round(Number(it.basePrice ?? it.price) || 1)),
        price: Math.max(0, Math.round(Number(it.price) || 0)),
        purchased: it.purchased === true,
      }))
    : []
  ctx.selectedEventCountById.clear()
  const savedEventCounts = Array.isArray(state.selectedEventCounts) ? state.selectedEventCounts : []
  for (const row of savedEventCounts) {
    if (!row || typeof row.id !== 'string') continue
    const count = Math.max(0, Math.round(Number(row.count) || 0))
    if (count > 0) ctx.selectedEventCountById.set(row.id, count)
  }
  ctx.dayEventState = {
    forceBuyArchetype: state.dayEventState?.forceBuyArchetype ?? null,
    forceBuyRemaining: Math.max(0, Math.round(Number(state.dayEventState?.forceBuyRemaining ?? 0) || 0)),
    forceSynthesisArchetype: state.dayEventState?.forceSynthesisArchetype ?? null,
    forceSynthesisRemaining: Math.max(0, Math.round(Number(state.dayEventState?.forceSynthesisRemaining ?? 0) || 0)),
    extraUpgradeRemaining: Math.max(0, Math.round(Number(state.dayEventState?.extraUpgradeRemaining ?? 0) || 0)),
    allSynthesisRandom: state.dayEventState?.allSynthesisRandom === true,
  }
  ctx.blockedBaseIncomeDays.clear()
  for (const day of state.futureEventState?.blockedBaseIncomeDays ?? []) {
    const one = Math.max(1, Math.round(Number(day) || 0))
    if (one > 0) ctx.blockedBaseIncomeDays.add(one)
  }
  ctx.pendingGoldByDay.clear()
  for (const row of state.futureEventState?.pendingGoldByDay ?? []) {
    const day = Math.max(1, Math.round(Number(row?.day) || 0))
    const amount = Math.max(0, Math.round(Number(row?.amount) || 0))
    if (day > 0 && amount > 0) ctx.pendingGoldByDay.set(day, (ctx.pendingGoldByDay.get(day) ?? 0) + amount)
  }
  ctx.pendingBattleUpgradeByDay.clear()
  for (const row of state.futureEventState?.pendingBattleUpgradeByDay ?? []) {
    const day = Math.max(1, Math.round(Number(row?.day) || 0))
    const count = Math.max(0, Math.round(Number(row?.count) || 0))
    if (day > 0 && count > 0) ctx.pendingBattleUpgradeByDay.set(day, (ctx.pendingBattleUpgradeByDay.get(day) ?? 0) + count)
  }
  ctx.unlockedItemIds.clear()
  const savedUnlocks = Array.isArray(state.unlockedItemIds)
    ? state.unlockedItemIds.filter((id): id is string => typeof id === 'string')
    : []
  if (savedUnlocks.length > 0) {
    for (const id of savedUnlocks) ctx.unlockedItemIds.add(id)
  }
  ctx.guaranteedNewUnlockTriggeredLevels.clear()
  QUALITY_PSEUDO_RANDOM_STATE.clear()
  QUICK_BUY_LEVEL_PSEUDO_RANDOM_STATE.clear()
  const savedGuaranteed = Array.isArray(state.guaranteedNewUnlockTriggeredLevels)
    ? state.guaranteedNewUnlockTriggeredLevels.filter((lv): lv is number => Number.isFinite(lv)).map((lv) => Math.round(lv))
    : []
  for (const lv of savedGuaranteed) ctx.guaranteedNewUnlockTriggeredLevels.add(lv)
  ctx.skill20GrantedDays.clear()
  const savedSkill20Days = Array.isArray(state.skill20GrantedDays)
    ? state.skill20GrantedDays.filter((d): d is number => Number.isFinite(d)).map((d) => Math.max(1, Math.round(d)))
    : []
  for (const day of savedSkill20Days) ctx.skill20GrantedDays.add(day)
  ctx.heroDailyCardRerollUsedDays.clear()
  for (const day of state.heroDailyCardRerollUsedDays ?? []) {
    const one = Math.max(1, Math.round(Number(day) || 0))
    if (one > 0) ctx.heroDailyCardRerollUsedDays.add(one)
  }
  ctx.heroFirstDiscardRewardedDays.clear()
  for (const day of state.heroFirstDiscardRewardedDays ?? []) {
    const one = Math.max(1, Math.round(Number(day) || 0))
    if (one > 0) ctx.heroFirstDiscardRewardedDays.add(one)
  }
  ctx.heroFirstSameItemSynthesisChoiceDays.clear()
  for (const day of state.heroFirstSameItemSynthesisChoiceDays ?? []) {
    const one = Math.max(1, Math.round(Number(day) || 0))
    if (one > 0) ctx.heroFirstSameItemSynthesisChoiceDays.add(one)
  }
  ctx.heroSmithStoneGrantedDays.clear()
  for (const day of state.heroSmithStoneGrantedDays ?? []) {
    const one = Math.max(1, Math.round(Number(day) || 0))
    if (one > 0) ctx.heroSmithStoneGrantedDays.add(one)
  }
  ctx.heroAdventurerScrollGrantedDays.clear()
  for (const day of state.heroAdventurerScrollGrantedDays ?? []) {
    const one = Math.max(1, Math.round(Number(day) || 0))
    if (one > 0) ctx.heroAdventurerScrollGrantedDays.add(one)
  }
  ctx.heroCommanderMedalGrantedDays.clear()
  for (const day of state.heroCommanderMedalGrantedDays ?? []) {
    const one = Math.max(1, Math.round(Number(day) || 0))
    if (one > 0) ctx.heroCommanderMedalGrantedDays.add(one)
  }
  ctx.heroHeirGoldEquipGrantedDays.clear()
  for (const day of state.heroHeirGoldEquipGrantedDays ?? []) {
    const one = Math.max(1, Math.round(Number(day) || 0))
    if (one > 0) ctx.heroHeirGoldEquipGrantedDays.add(one)
  }
  ctx.heroTycoonGoldGrantedDays.clear()
  for (const day of state.heroTycoonGoldGrantedDays ?? []) {
    const one = Math.max(1, Math.round(Number(day) || 0))
    if (one > 0) ctx.heroTycoonGoldGrantedDays.add(one)
  }
  ctx.neutralObtainedCountByKind.clear()
  for (const row of state.neutralObtainedCounts ?? []) {
    const kind = String(row?.kind ?? '').trim()
    const count = Math.max(0, Math.round(Number(row?.count) || 0))
    if (!kind || count <= 0) continue
    ctx.neutralObtainedCountByKind.set(kind, count)
  }
  const savedNeutralPool = Array.isArray(state.neutralRandomCategoryPool)
    ? state.neutralRandomCategoryPool
    : []
  ctx.neutralRandomCategoryPool = savedNeutralPool
    .filter((v): v is 'stone' | 'scroll' | 'medal' => v === 'stone' || v === 'scroll' || v === 'medal')
  ctx.neutralDailyRollCountByDay.clear()
  for (const row of state.neutralDailyRollCounts ?? []) {
    const day = Math.max(1, Math.round(Number(row?.day) || 0))
    const count = Math.max(0, Math.round(Number(row?.count) || 0))
    if (day <= 0 || count <= 0) continue
    ctx.neutralDailyRollCountByDay.set(day, count)
  }
  ctx.neutralDailyRollCountByDay.clear()
  for (const row of state.neutralDailyRollCounts ?? []) {
    const day = Math.max(1, Math.round(Number(row?.day) || 0))
    const count = Math.max(0, Math.round(Number(row?.count) || 0))
    if (day <= 0 || count <= 0) continue
    ctx.neutralDailyRollCountByDay.set(day, count)
  }
  // 升级奖励持久化恢复
  ctx.levelRewardCategoryPool = Array.isArray(state.levelRewardCategoryPool)
    ? state.levelRewardCategoryPool.filter((v): v is 'stone' | 'scroll' | 'medal' => v === 'stone' || v === 'scroll' || v === 'medal')
    : []
  ctx.pendingLevelRewards = Array.isArray(state.pendingLevelRewards)
    ? state.pendingLevelRewards.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : []
  ctx.pendingHeroPeriodicRewards = Array.isArray(state.pendingHeroPeriodicRewards)
    ? state.pendingHeroPeriodicRewards
      .map((row) => {
        const itemId = String(row?.itemId ?? '').trim()
        const source = String(row?.source ?? '').trim() || '英雄奖励'
        const level = clampLevel(Number(row?.level ?? 1))
        const tier = (String(row?.tier ?? 'Bronze') as import('@/shop/ShopManager').TierKey)
        const star = Math.max(1, Math.min(2, Math.round(Number(row?.star ?? 1)))) as 1 | 2
        if (!itemId) return null
        return { itemId, level, tier, star, source }
      })
      .filter((v): v is PendingHeroPeriodicReward => !!v)
    : []
  ctx.pendingHeroPeriodicRewardDispatching = false
  ctx.levelQuickDraftSavedEntries = Array.isArray(state.levelQuickDraftSavedEntries)
    ? state.levelQuickDraftSavedEntries
      .map((entry) => {
        const title = String(entry?.title ?? '').trim() || '奖励区'
        const picks = Array.isArray(entry?.picks)
          ? entry.picks
            .map((pick) => {
              const defId = String(pick?.defId ?? '').trim()
              if (!defId) return null
              const level = clampLevel(Number(pick?.level ?? 1))
              const tier = (String(pick?.tier ?? 'Bronze') as import('@/shop/ShopManager').TierKey)
              if (tier !== 'Bronze' && tier !== 'Silver' && tier !== 'Gold' && tier !== 'Diamond') return null
              const star = Math.max(1, Math.min(2, Math.round(Number(pick?.star ?? 1)))) as 1 | 2
              return { defId, level, tier, star }
            })
            .filter((v): v is { defId: string; level: 1 | 2 | 3 | 4 | 5 | 6 | 7; tier: 'Bronze' | 'Silver' | 'Gold' | 'Diamond'; star: 1 | 2 } => !!v)
            .slice(0, 3)
          : []
        if (picks.length <= 0) return null
        return { title, picks }
      })
      .filter((v): v is NonNullable<typeof v> => !!v)
    : []
  ctx.levelRewardObtainedByKind.clear()
  for (const row of state.levelRewardObtainedCounts ?? []) {
    const kind = String(row?.kind ?? '').trim()
    const count = Math.max(0, Math.round(Number(row?.count) || 0))
    if (!kind || count <= 0) continue
    ctx.levelRewardObtainedByKind.set(kind, count)
  }
  ctx.skill15NextBuyDiscountPrepared = state.skill15NextBuyDiscountPrepared === true
  ctx.skill15NextBuyDiscount = state.skill15NextBuyDiscount === true
  ctx.skill30BuyCounter = Math.max(0, Math.round(Number(state.skill30BuyCounter ?? 0) || 0))
  ctx.skill30NextBuyFree = state.skill30NextBuyFree === true
  ctx.quickBuyNoSynthRefreshStreak = Math.max(0, Math.round(Number(state.quickBuyNoSynthRefreshStreak ?? 0) || 0))
  ctx.quickBuyNeutralMissStreak = Math.max(0, Math.round(Number(state.quickBuyNeutralMissStreak ?? 0) || 0))
  if (!hasPickedSkill('skill15')) resetSkill15NextBuyDiscountState()
  if (!hasPickedSkill('skill30')) resetSkill30BundleState()
  ctx.nextQuickBuyOffer = (state.nextQuickBuyOffer && typeof state.nextQuickBuyOffer === 'object')
    ? {
      itemId: state.nextQuickBuyOffer.itemId,
      tier: state.nextQuickBuyOffer.tier,
      star: state.nextQuickBuyOffer.star,
      price: state.nextQuickBuyOffer.price,
    }
    : null
  ctx.shopManager.day = state.day
  ctx.shopManager.gold = state.gold
  ctx.shopManager.refreshIndex = state.refreshIndex
  syncUnlockPoolToManager()
  ctx.shopManager.pool = state.pool
    .map((s) => {
      const item = byId.get(s.itemId)
      if (!item) return null
      return { item, tier: s.tier, price: s.price, purchased: s.purchased }
    })
    .filter((v): v is ShopSlot => !!v)

  const oldBattle = ctx.battleSystem.getAllItems()
  const oldBackpack = ctx.backpackSystem.getAllItems()
  for (const it of oldBattle) ctx.battleView.removeItem(it.instanceId)
  for (const it of oldBackpack) ctx.backpackView.removeItem(it.instanceId)
  ctx.battleSystem.clear()
  ctx.backpackSystem.clear()
  clearAllInstanceMaps()

  const restoreOne = (it: SavedPlacedItem, system: GridSystem, view: GridZone) => {
    const placed = system.place(it.col, it.row, it.size, it.defId, it.instanceId)
    if (!placed) return
    instanceToDefId.set(it.instanceId, it.defId)
    const migratedLevel = typeof it.level === 'number'
      ? clampLevel(it.level)
      : levelFromLegacyTierStar(it.tier, normalizeTierStar(it.tier, it.tierStar))
    const migratedQuality = it.quality ?? deriveQualityByDefId(it.defId)
    setInstanceQualityLevel(it.instanceId, it.defId, migratedQuality, migratedLevel)
    instanceToPermanentDamageBonus.set(it.instanceId, Math.max(0, Math.round(it.permanentDamageBonus ?? 0)))
    const restoredTier = getInstanceTier(it.instanceId) ?? it.tier
    const restoredStar = getInstanceTierStar(it.instanceId)
    view.addItem(it.instanceId, it.defId, it.size, it.col, it.row, toVisualTier(restoredTier, restoredStar), { playAcquireFx: false }).then(() => {
      view.setItemTier(it.instanceId, toVisualTier(restoredTier, restoredStar))
      ctx.drag?.refreshZone(view)
    })
  }

  for (const it of state.battleItems) restoreOne(it, ctx.battleSystem, ctx.battleView)
  for (const it of state.backpackItems) restoreOne(it, ctx.backpackSystem, ctx.backpackView)
  for (const defId of instanceToDefId.values()) ctx.unlockedItemIds.add(defId)
  syncUnlockPoolToManager()

  const maxId = Math.max(0, ...Array.from(instanceToDefId.keys()).map((id) => {
    const n = Number(id.replace('inst-', ''))
    return Number.isFinite(n) ? n : 0
  }))
  setInstCounter(Math.max(state.instCounter, maxId + 1))
}
