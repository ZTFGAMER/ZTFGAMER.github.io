// ============================================================
// EventSystem — 事件系统（函数集合模式）
// 职责：
//   - 事件效果执行（applyEventEffect）
//   - 每日未来事件效果（applyFutureEventEffectsOnNewDay）
//   - 事件选中状态管理（markEventSelected / resetEventSelectionCounters）
//   - 事件池查询（getSelectedEventCount / getEventPoolRows）
//   - 事件可用性检查（isEventChoiceAvailable）
//   - 随机草稿选择（pickRandomEventDraftChoices / pickRandomEventDraftChoicesNoOverlap）
//   - 状态重置（resetDayEventState / resetFutureEventState）
//   - 事件描述文本解析（resolveEventDescText）
//   - 职业工具（getEventArchetypeCn）
// ============================================================

import { getConfig, getAllItems } from '@/core/DataLoader'
import { getLifeState, setLifeState } from '@/core/RunState'
import { getDailyGoldForDay } from '@/shop/ShopManager'
import type { TierKey } from '@/shop/ShopManager'
import type { ItemDef } from '@/common/items/ItemDef'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import {
  toSkillArchetype,
  getPrimaryArchetype,
  getItemDefById,
} from './ShopSynthesisLogic'
import type { ShopSceneCtx, EventChoice, EventArchetype } from '../ShopSceneContext'
import type { PlacedItem } from '@/common/grid/GridSystem'

// ============================================================
// 本地类型
// ============================================================

export type OwnedPlacedItem = { item: PlacedItem; zone: 'battle' | 'backpack' }

export type PoolCandidate = {
  item: ItemDef
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7
  tier: TierKey
  star: 1 | 2
  price: number
}

// ============================================================
// Callbacks 接口
// ============================================================

export type ApplyEventEffectCallbacks = {
  showHintToast: (reason: string, message: string, color?: number) => void
  collectUpgradeableOwnedPlacedItems: (zone?: 'battle' | 'backpack') => OwnedPlacedItem[]
  upgradePlacedItem: (instanceId: string, zone: 'battle' | 'backpack', withFx?: boolean) => boolean
  convertAndUpgradePlacedItem: (instanceId: string, zone: 'battle' | 'backpack', withFx?: boolean) => boolean
  canConvertAndUpgradePlacedItem: (instanceId: string, zone: 'battle' | 'backpack') => boolean
  getAllOwnedPlacedItems: () => OwnedPlacedItem[]
  placeItemToInventoryOrBattle: (def: ItemDef, tier: TierKey, star: 1 | 2) => boolean
  removePlacedItemById: (instanceId: string, zone: 'battle' | 'backpack') => void
  schedulePendingGold: (day: number, amount: number) => void
  schedulePendingBattleUpgrade: (day: number, count: number) => void
  convertHighestLevelItemsOnce: () => number
  upgradeLowestLevelItemsOnce: () => number
  collectPoolCandidatesByLevel: (level: 1 | 2 | 3 | 4 | 5 | 6 | 7) => PoolCandidate[]
  getQuickBuyLevelWeightsByDay: (day: number) => [number, number, number, number, number, number, number]
  getInstanceTierMap: () => Map<string, TierKey>
  getInstanceTierStar: (instanceId: string) => 1 | 2
}

export type ApplyFutureEventCallbacks = {
  showHintToast: (reason: string, message: string, color?: number) => void
  collectUpgradeableOwnedPlacedItems: (zone?: 'battle' | 'backpack') => OwnedPlacedItem[]
  upgradePlacedItem: (instanceId: string, zone: 'battle' | 'backpack', withFx?: boolean) => boolean
}

// ============================================================
// 本地工具
// ============================================================

function pickRandomElements<T>(list: T[], count: number): T[] {
  const arr = [...list]
  const out: T[] = []
  while (out.length < count && arr.length > 0) {
    const idx = Math.floor(Math.random() * arr.length)
    const picked = arr[idx]
    if (picked !== undefined) out.push(picked)
    arr.splice(idx, 1)
  }
  return out
}

function shouldShowSimpleDescriptions(): boolean {
  return getDebugCfg('gameplayShowSimpleDescriptions') >= 0.5
}

// ============================================================
// 导出函数
// ============================================================

export function getEventArchetypeCn(arch: EventArchetype): string {
  if (arch === 'warrior') return '战士'
  if (arch === 'archer') return '弓手'
  return '刺客'
}

export function getEventPoolRows(): EventChoice[] {
  const rows = getConfig().eventSystem?.eventPool
  if (!Array.isArray(rows)) return []
  return rows
}

export function getSelectedEventCount(ctx: ShopSceneCtx, eventId: string): number {
  return Math.max(0, Math.round(ctx.selectedEventCountById.get(eventId) ?? 0))
}

export function markEventSelected(ctx: ShopSceneCtx, eventId: string): void {
  const next = getSelectedEventCount(ctx, eventId) + 1
  ctx.selectedEventCountById.set(eventId, next)
}

export function resetEventSelectionCounters(ctx: ShopSceneCtx): void {
  ctx.selectedEventCountById.clear()
}

export function resetDayEventState(ctx: ShopSceneCtx): void {
  ctx.dayEventState = {
    forceBuyArchetype: null,
    forceBuyRemaining: 0,
    forceSynthesisArchetype: null,
    forceSynthesisRemaining: 0,
    extraUpgradeRemaining: 0,
    allSynthesisRandom: false,
  }
}

export function resetFutureEventState(ctx: ShopSceneCtx): void {
  ctx.blockedBaseIncomeDays.clear()
  ctx.pendingGoldByDay.clear()
  ctx.pendingBattleUpgradeByDay.clear()
}

function getOwnedArchetypeSet(ctx: ShopSceneCtx): Set<EventArchetype> {
  const out = new Set<EventArchetype>()
  const collect = (system: { getAllItems(): Array<{ defId: string }> } | null) => {
    if (!system) return
    for (const it of system.getAllItems()) {
      const def = getItemDefById(it.defId)
      const archetype = toSkillArchetype(getPrimaryArchetype(def?.tags ?? ''))
      if (!archetype || archetype === 'utility') continue
      out.add(archetype)
    }
  }
  collect(ctx.battleSystem)
  collect(ctx.backpackSystem)
  return out
}

function getBattleArchetypeCounts(ctx: ShopSceneCtx): Record<EventArchetype, number> {
  const out: Record<EventArchetype, number> = { warrior: 0, archer: 0, assassin: 0 }
  if (!ctx.battleSystem) return out
  for (const it of ctx.battleSystem.getAllItems()) {
    const def = getItemDefById(it.defId)
    const archetype = toSkillArchetype(getPrimaryArchetype(def?.tags ?? ''))
    if (archetype === 'warrior' || archetype === 'archer' || archetype === 'assassin') {
      out[archetype] += 1
    }
  }
  return out
}

function isBattleArchetypeTopTie(ctx: ShopSceneCtx, archetype: EventArchetype): boolean {
  const counts = getBattleArchetypeCounts(ctx)
  const self = counts[archetype]
  const maxCount = Math.max(counts.warrior, counts.archer, counts.assassin)
  return self > 0 && self === maxCount
}

export function isEventChoiceAvailable(ctx: ShopSceneCtx, event: EventChoice, day: number): boolean {
  if (event.enabled === false) return false
  if (day < event.dayStart || day > event.dayEnd) return false
  const maxSelections = event.limits?.maxSelectionsPerRun
  if (typeof maxSelections === 'number' && Number.isFinite(maxSelections) && maxSelections > 0) {
    if (getSelectedEventCount(ctx, event.id) >= Math.round(maxSelections)) return false
  }
  const requiredArch = event.conditions?.requireArchetypeOwned
  if (requiredArch) {
    const owned = getOwnedArchetypeSet(ctx)
    if (!owned.has(requiredArch)) return false
  }
  if (event.conditions?.requireHeartNotFull) {
    const life = getLifeState()
    if (life.current >= life.max) return false
  }
  if (event.conditions?.requireBackpackNotEmpty) {
    const count = ctx.backpackSystem?.getAllItems().length ?? 0
    if (count <= 0) return false
  }
  if (event.conditions?.requireBattleNotEmpty) {
    const count = ctx.battleSystem?.getAllItems().length ?? 0
    if (count <= 0) return false
  }
  const topTieArch = event.conditions?.requireBattleArchetypeTopTie
  if (topTieArch && !isBattleArchetypeTopTie(ctx, topTieArch)) return false
  return true
}

export function pickRandomEventDraftChoices(ctx: ShopSceneCtx, day: number): EventChoice[] {
  const pool = getEventPoolRows().filter((event) => isEventChoiceAvailable(ctx, event, day))
  if (pool.length <= 0) return []
  const left = pool.filter((it) => it.lane === 'left')
  const right = pool.filter((it) => it.lane === 'right')
  const picks: EventChoice[] = []
  const pickOne = (list: EventChoice[]): EventChoice | null => list[Math.floor(Math.random() * list.length)] ?? null
  const leftPicked = pickOne(left)
  const rightPicked = pickOne(right)
  if (leftPicked) picks.push(leftPicked)
  if (rightPicked && rightPicked.id !== leftPicked?.id) picks.push(rightPicked)
  if (picks.length >= 2) return picks
  const leftovers = pool.filter((it) => !picks.some((p) => p.id === it.id))
  while (picks.length < 2 && leftovers.length > 0) {
    const idx = Math.floor(Math.random() * leftovers.length)
    const picked = leftovers[idx]
    if (picked) picks.push(picked)
    leftovers.splice(idx, 1)
  }
  return picks
}

export function pickRandomEventDraftChoicesNoOverlap(
  ctx: ShopSceneCtx,
  day: number,
  blockedIds: Set<string>,
): EventChoice[] {
  for (let i = 0; i < 60; i++) {
    const next = pickRandomEventDraftChoices(ctx, day).slice(0, 2)
    if (next.length < 2) continue
    const hasOverlap = next.some((it) => blockedIds.has(it.id))
    if (!hasOverlap) return next
  }
  return []
}

export function resolveEventDescText(ctx: ShopSceneCtx, event: EventChoice, detailed: boolean): string {
  const useDetailed = detailed || !shouldShowSimpleDescriptions()
  const raw = useDetailed ? event.detailDesc : event.shortDesc
  if (event.id === 'event20') {
    return raw.replace(/x/g, String(ctx.currentDay * 2))
  }
  if (event.id === 'event21') {
    return raw.replace(/x/g, String(ctx.currentDay * 4))
  }
  if (event.id === 'event28') {
    const gain = ctx.currentDay * 6
    return `3天后获得${gain}金币`
  }
  return raw
}

// ============================================================
// randomArchetypeItemsByDay — 按职业随机选取物品（内部使用，applyEventEffect 依赖）
// ============================================================

function randomArchetypeItemsByDay(
  ctx: ShopSceneCtx,
  archetype: EventArchetype,
  count: number,
  callbacks: Pick<ApplyEventEffectCallbacks, 'collectPoolCandidatesByLevel' | 'getQuickBuyLevelWeightsByDay'>,
): PoolCandidate[] {
  void getAllItems // 确保模块已加载
  const byLevel: Record<1 | 2 | 3 | 4 | 5 | 6 | 7, PoolCandidate[]> = {
    1: callbacks.collectPoolCandidatesByLevel(1),
    2: callbacks.collectPoolCandidatesByLevel(2),
    3: callbacks.collectPoolCandidatesByLevel(3),
    4: callbacks.collectPoolCandidatesByLevel(4),
    5: callbacks.collectPoolCandidatesByLevel(5),
    6: callbacks.collectPoolCandidatesByLevel(6),
    7: callbacks.collectPoolCandidatesByLevel(7),
  }
  const weights = callbacks.getQuickBuyLevelWeightsByDay(ctx.currentDay)
  const out: PoolCandidate[] = []
  const levels: Array<1 | 2 | 3 | 4 | 5 | 6 | 7> = [1, 2, 3, 4, 5, 6, 7]
  for (let i = 0; i < count; i++) {
    const leveled: Array<{ level: 1 | 2 | 3 | 4 | 5 | 6 | 7; weight: number }> = []
    for (const lv of levels) {
      const pool = byLevel[lv].filter((c) => toSkillArchetype(getPrimaryArchetype(c.item.tags)) === archetype)
      if (pool.length <= 0) continue
      const w = Math.max(0, Number(weights[lv - 1] ?? 0))
      if (w <= 0) continue
      leveled.push({ level: lv, weight: w })
    }
    if (leveled.length <= 0) break
    const total = leveled.reduce((sum, it) => sum + it.weight, 0)
    let roll = Math.random() * total
    let levelNum = leveled[leveled.length - 1]!.level
    for (const one of leveled) {
      roll -= one.weight
      if (roll <= 0) {
        levelNum = one.level
        break
      }
    }
    const pool = byLevel[levelNum].filter((c) => toSkillArchetype(getPrimaryArchetype(c.item.tags)) === archetype)
    const picked = pool[Math.floor(Math.random() * pool.length)]
    if (picked) out.push(picked)
  }
  return out
}

// ============================================================
// applyFutureEventEffectsOnNewDay
// ============================================================

export function applyFutureEventEffectsOnNewDay(
  ctx: ShopSceneCtx,
  day: number,
  callbacks: ApplyFutureEventCallbacks,
): void {
  if (!ctx.shopManager) return
  const pendingGold = Math.max(0, Math.round(ctx.pendingGoldByDay.get(day) ?? 0))
  if (pendingGold > 0) {
    ctx.shopManager.gold += pendingGold
    ctx.pendingGoldByDay.delete(day)
    callbacks.showHintToast('no_gold_buy', `事件结算：获得${pendingGold}金币`, 0xa8f0b6)
  }
  const pendingBattleUp = Math.max(0, Math.round(ctx.pendingBattleUpgradeByDay.get(day) ?? 0))
  if (pendingBattleUp > 0) {
    ctx.pendingBattleUpgradeByDay.delete(day)
    let changed = 0
    for (let i = 0; i < pendingBattleUp; i++) {
      const battleItems = callbacks.collectUpgradeableOwnedPlacedItems('battle')
      if (battleItems.length <= 0) break
      for (const one of battleItems) {
        if (callbacks.upgradePlacedItem(one.item.instanceId, 'battle', true)) changed += 1
      }
    }
    if (changed > 0) callbacks.showHintToast('no_gold_buy', `事件结算：上阵区升级${changed}个物品`, 0x9be5ff)
    else callbacks.showHintToast('no_gold_buy', '事件结算：没有可升级的目标', 0xffb27a)
  }
}

// ============================================================
// applyEventEffect — 事件效果主函数（约 220 行）
// ============================================================

export function applyEventEffect(
  ctx: ShopSceneCtx,
  event: EventChoice,
  callbacks: ApplyEventEffectCallbacks,
  fromTest = false,
): boolean {
  if (!ctx.shopManager) return false
  const day = ctx.currentDay
  const toastPrefix = fromTest ? '[测试] ' : ''

  if (event.id === 'event1') {
    const targets = callbacks.collectUpgradeableOwnedPlacedItems('battle')
    if (targets.length <= 0) {
      callbacks.showHintToast('no_gold_buy', `${toastPrefix}没有可升级的目标`, 0xffb27a)
      return false
    }
    const picked = pickRandomElements(targets, 1)
    const ok = picked.some((it) => callbacks.upgradePlacedItem(it.item.instanceId, it.zone, true))
    if (ok) callbacks.showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0x9be5ff)
    return ok
  }
  if (event.id === 'event2') {
    const targets = callbacks.collectUpgradeableOwnedPlacedItems('backpack')
    if (targets.length <= 0) {
      callbacks.showHintToast('no_gold_buy', `${toastPrefix}没有可升级的目标`, 0xffb27a)
      return false
    }
    const picked = pickRandomElements(targets, 2)
    let okCount = 0
    for (const it of picked) {
      if (callbacks.upgradePlacedItem(it.item.instanceId, it.zone, true)) okCount += 1
    }
    if (okCount > 0) callbacks.showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}（${okCount}/2）`, 0x9be5ff)
    return okCount > 0
  }
  if (event.id === 'event3') {
    const targets = callbacks.getAllOwnedPlacedItems()
      .filter((it) => it.zone === 'backpack')
      .filter((it) => callbacks.canConvertAndUpgradePlacedItem(it.item.instanceId, it.zone))
    const picked = pickRandomElements(targets, 3)
    let okCount = 0
    for (const it of picked) {
      if (callbacks.convertAndUpgradePlacedItem(it.item.instanceId, it.zone, true)) okCount += 1
    }
    if (okCount > 0) callbacks.showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}（${okCount}/3）`, 0x9be5ff)
    return okCount > 0
  }
  if (event.id === 'event4' || event.id === 'event5' || event.id === 'event6') {
    const archetype: EventArchetype = event.id === 'event4' ? 'warrior' : event.id === 'event5' ? 'archer' : 'assassin'
    const items = randomArchetypeItemsByDay(ctx, archetype, 2, callbacks)
    let okCount = 0
    for (const one of items) {
      if (callbacks.placeItemToInventoryOrBattle(one.item, one.tier, one.star)) okCount++
    }
    if (okCount > 0) callbacks.showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0x9be5ff)
    return okCount > 0
  }
  if (event.id === 'event7' || event.id === 'event8' || event.id === 'event9') {
    ctx.dayEventState.forceBuyArchetype = event.id === 'event7' ? 'warrior' : event.id === 'event8' ? 'archer' : 'assassin'
    ctx.dayEventState.forceBuyRemaining = 3
    callbacks.showHintToast('no_gold_buy', `${toastPrefix}前3次购买锁定${getEventArchetypeCn(ctx.dayEventState.forceBuyArchetype)}`, 0x8ff0b0)
    return true
  }
  if (event.id === 'event10' || event.id === 'event12' || event.id === 'event13') {
    ctx.dayEventState.forceSynthesisArchetype = event.id === 'event10' ? 'warrior' : event.id === 'event12' ? 'archer' : 'assassin'
    ctx.dayEventState.forceSynthesisRemaining = 2
    callbacks.showHintToast('no_gold_buy', `${toastPrefix}前2次合成锁定${getEventArchetypeCn(ctx.dayEventState.forceSynthesisArchetype)}`, 0x8ff0b0)
    return true
  }
  if (event.id === 'event14') {
    ctx.dayEventState.extraUpgradeRemaining = 1
    callbacks.showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0x8ff0b0)
    return true
  }
  if (event.id === 'event15' || event.id === 'event16' || event.id === 'event17') {
    const targetArch: EventArchetype = event.id === 'event15' ? 'warrior' : event.id === 'event16' ? 'archer' : 'assassin'
    const owned = callbacks.getAllOwnedPlacedItems().filter((it) => {
      const def = getItemDefById(it.item.defId)
      return toSkillArchetype(getPrimaryArchetype(def?.tags ?? '')) === targetArch
    })
    const picked = owned[Math.floor(Math.random() * owned.length)]
    if (!picked) return false
    const def = getItemDefById(picked.item.defId)
    if (!def) return false
    const instanceTierMap = callbacks.getInstanceTierMap()
    const tier = instanceTierMap.get(picked.item.instanceId) ?? 'Bronze'
    const star = callbacks.getInstanceTierStar(picked.item.instanceId)
    const ok = callbacks.placeItemToInventoryOrBattle(def, tier, star)
    if (ok) callbacks.showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0x9be5ff)
    return ok
  }
  if (event.id === 'event18') {
    if (!ctx.backpackSystem) return false
    const picked = pickRandomElements(ctx.backpackSystem.getAllItems(), 2)
    let ok = false
    for (const one of picked) {
      const def = getItemDefById(one.defId)
      if (!def) continue
      const instanceTierMap = callbacks.getInstanceTierMap()
      const tier = instanceTierMap.get(one.instanceId) ?? 'Bronze'
      const star = callbacks.getInstanceTierStar(one.instanceId)
      ok = callbacks.placeItemToInventoryOrBattle(def, tier, star) || ok
    }
    if (ok) callbacks.showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0x9be5ff)
    return ok
  }
  if (event.id === 'event19') {
    if (!ctx.backpackSystem) return false
    const all = [...ctx.backpackSystem.getAllItems()]
    let sold = 0
    for (const one of all) {
      const def = getItemDefById(one.defId)
      if (!def) continue
      const instanceTierMap = callbacks.getInstanceTierMap()
      const tier = instanceTierMap.get(one.instanceId) ?? 'Bronze'
      const star = callbacks.getInstanceTierStar(one.instanceId)
      ctx.shopManager.gold += ctx.shopManager.getTierStarPrice(def, tier, star) + 1
      callbacks.removePlacedItemById(one.instanceId, 'backpack')
      sold++
    }
    if (sold > 0) callbacks.showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0xa8f0b6)
    return sold > 0
  }
  if (event.id === 'event20') {
    const gain = day * 2
    ctx.shopManager.gold += gain
    callbacks.showHintToast('no_gold_buy', `${toastPrefix}获得${gain}金币`, 0xa8f0b6)
    return true
  }
  if (event.id === 'event21') {
    if (!ctx.backpackSystem) return false
    const all = [...ctx.backpackSystem.getAllItems()]
    if (all.length <= 0) return false
    for (const one of all) callbacks.removePlacedItemById(one.instanceId, 'backpack')
    const gain = day * 4
    ctx.shopManager.gold += gain
    callbacks.showHintToast('no_gold_buy', `${toastPrefix}清空背包并获得${gain}金币`, 0xa8f0b6)
    return true
  }
  if (event.id === 'event22') {
    const life = getLifeState()
    const newMax = Math.max(life.max + 1, Math.round(life.max * 1.1))
    setLifeState(life.current, newMax)
    callbacks.showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0xa8f0b6)
    return true
  }
  if (event.id === 'event23') {
    const life = getLifeState()
    if (life.current >= life.max) return false
    setLifeState(life.current + 1, life.max)
    callbacks.showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0xa8f0b6)
    return true
  }
  if (event.id === 'event24') {
    const all = callbacks.getAllOwnedPlacedItems()
    let changed = false
    for (const one of all) {
      changed = callbacks.convertAndUpgradePlacedItem(one.item.instanceId, one.zone, true) || changed
    }
    if (changed) callbacks.showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0x9be5ff)
    else callbacks.showHintToast('no_gold_buy', `${toastPrefix}没有可升级的目标`, 0xffb27a)
    return changed
  }
  if (event.id === 'event25') {
    const invested = Math.max(0, Math.round(ctx.shopManager.gold))
    ctx.shopManager.gold = 0
    callbacks.schedulePendingGold(day + 1, invested * 2)
    callbacks.showHintToast('no_gold_buy', `${toastPrefix}已投资${invested}金币，明日返还${invested * 2}`, 0xa8f0b6)
    return true
  }
  if (event.id === 'event26') {
    if (!ctx.battleSystem) return false
    const all = [...ctx.battleSystem.getAllItems()]
    let sold = 0
    for (const one of all) {
      const def = getItemDefById(one.defId)
      if (!def) continue
      const instanceTierMap = callbacks.getInstanceTierMap()
      const tier = instanceTierMap.get(one.instanceId) ?? 'Bronze'
      const star = callbacks.getInstanceTierStar(one.instanceId)
      ctx.shopManager.gold += ctx.shopManager.getSellPrice(def, tier, star) * 2
      callbacks.removePlacedItemById(one.instanceId, 'battle')
      sold++
    }
    if (sold > 0) callbacks.showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0xa8f0b6)
    return sold > 0
  }
  if (event.id === 'event27') {
    ctx.dayEventState.allSynthesisRandom = true
    callbacks.showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0x8ff0b0)
    return true
  }
  if (event.id === 'event28') {
    const gain = day * 6
    callbacks.schedulePendingGold(day + 3, gain)
    callbacks.showHintToast('no_gold_buy', `${toastPrefix}已预约3天后获得${gain}金币`, 0xa8f0b6)
    return true
  }
  if (event.id === 'event29') {
    callbacks.schedulePendingBattleUpgrade(day + 5, 1)
    callbacks.showHintToast('no_gold_buy', `${toastPrefix}已预约5天后上阵区升级`, 0x9be5ff)
    return true
  }
  if (event.id === 'event34') {
    const day1 = day + 1
    const day2 = day + 2
    const futureBase1 = getDailyGoldForDay(getConfig(), day1)
    const futureBase2 = getDailyGoldForDay(getConfig(), day2)
    const gain = Math.max(0, Math.round((futureBase1 + futureBase2) * 0.6))
    ctx.shopManager.gold += gain
    ctx.blockedBaseIncomeDays.add(day1)
    ctx.blockedBaseIncomeDays.add(day2)
    callbacks.showHintToast('no_gold_buy', `${toastPrefix}获得${gain}金币，未来2天基础收入已透支`, 0xa8f0b6)
    return true
  }
  if (event.id === 'event35') {
    const changed = callbacks.convertHighestLevelItemsOnce()
    if (changed > 0) callbacks.showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0x9be5ff)
    return changed > 0
  }
  if (event.id === 'event36') {
    const changed = callbacks.upgradeLowestLevelItemsOnce()
    if (changed > 0) callbacks.showHintToast('no_gold_buy', `${toastPrefix}${event.shortDesc}`, 0x9be5ff)
    else callbacks.showHintToast('no_gold_buy', `${toastPrefix}没有可升级的目标`, 0xffb27a)
    return changed > 0
  }
  return false
}
