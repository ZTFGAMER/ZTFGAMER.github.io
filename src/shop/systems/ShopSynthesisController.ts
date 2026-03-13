// ============================================================
// ShopSynthesisController — 合成目标查找与合成执行
// 提取自 ShopScene.ts Phase 8 Batch B
// 包含：目标查找、高亮、synthesizeTarget、cross 辅助
// ============================================================

import type { ShopSceneCtx } from '../ShopSceneContext'
import { GridSystem } from '@/common/grid/GridSystem'
import type { ItemSizeNorm, PlacedItem } from '@/common/grid/GridSystem'
import { GridZone } from '@/common/grid/GridZone'
import { CELL_SIZE, CELL_HEIGHT } from '@/common/grid/GridZone'
import type { ItemDef } from '@/common/items/ItemDef'
import type { TierKey } from '@/shop/ShopManager'
import {
  TIER_ORDER,
  nextTierLevel,
  tierStarLevelIndex,
  parseTierName,
  toSkillArchetype,
  getPrimaryArchetype,
  canSynthesizePair,
  canUseLv7MorphSynthesis,
  getItemDefById,
} from './ShopSynthesisLogic'
import {
  instanceToDefId,
  instanceToTier,
  setInstanceQualityLevel,
  getInstanceTierStar,
} from './ShopInstanceRegistry'
import {
  pickCrossIdEvolveCandidates,
  getCrossSynthesisMinStartingTier,
  shouldCrossSynthesisPreferOtherArchetype,
} from '../panels/SynthesisPanel'
import { hasPickedSkill } from './ShopSkillSystem'
import { shouldTriggerSkill48ExtraUpgrade } from '@/common/skills/GoldSkillRules'
import { toVisualTier, getSizeCellDim } from '../ShopMathHelpers'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { getShopUiColor } from '@/config/colorPalette'
import { pickQualityByPseudoRandomBag } from './QuickBuySystem'
import { refreshUpgradeHints } from '../ui/ShopUpgradeHints'
import type { SynthesisTarget } from '../panels/NeutralItemPanel'
export type { SynthesisTarget }

// ---- 公共类型 ----

export type SynthesizeResult = {
  instanceId: string
  targetZone: 'battle' | 'backpack'
  fromTier: TierKey
  fromStar: 1 | 2
  toTier: TierKey
  toStar: 1 | 2
  targetSize: ItemSizeNorm
}

export type SynthesisCallbacks = {
  isBackpackDropLocked: (col: number, row: number, size: ItemSizeNorm) => boolean
  unlockItemToPool: (defId: string) => boolean
  applyInstanceTierVisuals: () => void
  syncShopOwnedTierRules: () => void
  grantSynthesisExp: (amount?: number, from?: { instanceId: string; zone: 'battle' | 'backpack' }) => void
  checkAndPopPendingRewards: () => void
}

// ---- 合成标志（从 debugConfig 读取）----

export function isBattleZoneNoSynthesisEnabled(): boolean {
  return getDebugCfg('gameplayBattleZoneNoSynthesis') >= 0.5
}

// ---- 合成结果选取辅助 ----

export function pickCrossSynthesisDesiredMinTier(resultTier: TierKey, resultStar: 1 | 2, available?: TierKey[]): TierKey {
  const level = Math.max(1, Math.min(7, tierStarLevelIndex(resultTier, resultStar) + 1)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  return pickQualityByPseudoRandomBag(level, available ?? ['Bronze', 'Silver', 'Gold', 'Diamond'])
}

export function pickCrossSynthesisResultWithCycle(
  candidates: ItemDef[],
  resultTier: TierKey,
  resultStar: 1 | 2,
  _minStartingTier: TierKey,
): ItemDef | null {
  if (candidates.length <= 0) return null
  const availableMinTiers = Array.from(new Set(candidates.map((it) => parseTierName(it.starting_tier) ?? 'Bronze')))
  const desiredMinTier = pickCrossSynthesisDesiredMinTier(resultTier, resultStar, availableMinTiers)
  let targetMinTier = desiredMinTier
  let pool = candidates.filter((it) => (parseTierName(it.starting_tier) ?? 'Bronze') === targetMinTier)
  if (pool.length <= 0) {
    const startIdx = Math.max(0, TIER_ORDER.indexOf(targetMinTier))
    for (let i = startIdx + 1; i < TIER_ORDER.length; i++) {
      const higher = TIER_ORDER[i]!
      const p = candidates.filter((it) => (parseTierName(it.starting_tier) ?? 'Bronze') === higher)
      if (p.length > 0) {
        targetMinTier = higher
        pool = p
        break
      }
    }
  }
  if (pool.length <= 0) pool = candidates
  return pool[Math.floor(Math.random() * pool.length)] ?? null
}

export function shouldGuaranteeNewUnlock(resultTier: TierKey, resultStar: 1 | 2): boolean {
  void resultTier
  void resultStar
  return false
}

// ---- 碰撞检测 ----

export function isPointInItemBounds(view: GridZone, item: PlacedItem, gx: number, gy: number): boolean {
  const w = item.size === '1x1' ? CELL_SIZE : item.size === '2x1' ? CELL_SIZE * 2 : CELL_SIZE * 3
  const h = CELL_HEIGHT
  const left = item.col * CELL_SIZE
  const top = item.row * CELL_HEIGHT
  const a = view.toGlobal({ x: left, y: top })
  const b = view.toGlobal({ x: left + w, y: top + h })
  const x0 = Math.min(a.x, b.x)
  const x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const y1 = Math.max(a.y, b.y)
  return gx >= x0 && gx <= x1 && gy >= y0 && gy <= y1
}

// ---- 引导箭头 ----

export function collectSynthesisGuideIds(
  system: GridSystem | null,
  defId: string,
  tier: TierKey,
  star: 1 | 2,
  excludeInstanceId?: string,
): { sameIds: string[]; crossIds: string[] } {
  if (!system) return { sameIds: [], crossIds: [] }
  const sameIds: string[] = []
  const crossIds: string[] = []
  for (const it of system.getAllItems()) {
    if (excludeInstanceId && it.instanceId === excludeInstanceId) continue
    const itTier = instanceToTier.get(it.instanceId) ?? 'Bronze'
    const itStar = getInstanceTierStar(it.instanceId)
    if (!canSynthesizePair(defId, it.defId, tier, star, itTier, itStar)) continue
    if (it.defId === defId) sameIds.push(it.instanceId)
    else crossIds.push(it.instanceId)
  }
  return { sameIds, crossIds }
}

export function refreshBackpackSynthesisGuideArrows(
  defId: string | null,
  tier: TierKey | null,
  star: 1 | 2,
  ctx: ShopSceneCtx,
  excludeInstanceId?: string,
): void {
  if (!ctx.backpackView || !ctx.battleView) return
  const canLv7Morph = !!defId && !!tier && canUseLv7MorphSynthesis(defId, defId, tier, star, tier, star)
  if (!defId || !tier || (!nextTierLevel(tier, star) && !canLv7Morph)) {
    ctx.backpackView.setDragGuideArrows([])
    ctx.battleView.setDragGuideArrows([])
    return
  }
  const backpackGuide = collectSynthesisGuideIds(ctx.backpackSystem, defId, tier, star, excludeInstanceId)
  const battleGuide = isBattleZoneNoSynthesisEnabled()
    ? { sameIds: [], crossIds: [] }
    : collectSynthesisGuideIds(ctx.battleSystem, defId, tier, star, excludeInstanceId)
  if (canLv7Morph) {
    ctx.backpackView.setDragGuideArrows([], [...backpackGuide.sameIds, ...backpackGuide.crossIds], 'convert')
    ctx.battleView.setDragGuideArrows([], [...battleGuide.sameIds, ...battleGuide.crossIds], 'convert')
    return
  }
  ctx.backpackView.setDragGuideArrows(backpackGuide.sameIds, backpackGuide.crossIds)
  ctx.battleView.setDragGuideArrows(battleGuide.sameIds, battleGuide.crossIds)
}

export function clearBackpackSynthesisGuideArrows(ctx: ShopSceneCtx): void {
  ctx.backpackView?.setDragGuideArrows([])
  ctx.battleView?.setDragGuideArrows([])
}

// ---- 合成目标查找 ----

export function findSynthesisTargetAtPointer(
  defId: string,
  tier: TierKey,
  star: 1 | 2,
  gx: number,
  gy: number,
  _dragSize: ItemSizeNorm | undefined,
  ctx: ShopSceneCtx,
  callbacks: SynthesisCallbacks,
): SynthesisTarget | null {
  if (!isBattleZoneNoSynthesisEnabled() && ctx.battleView && ctx.battleSystem) {
    for (const it of ctx.battleSystem.getAllItems()) {
      const itTier = instanceToTier.get(it.instanceId) ?? 'Bronze'
      const itStar = getInstanceTierStar(it.instanceId)
      if (!canSynthesizePair(defId, it.defId, tier, star, itTier, itStar)) continue
      if (isPointInItemBounds(ctx.battleView, it, gx, gy)) {
        return { instanceId: it.instanceId, zone: 'battle' }
      }
    }
  }

  if (ctx.backpackView && ctx.backpackView.visible && ctx.backpackSystem) {
    for (const it of ctx.backpackSystem.getAllItems()) {
      if (callbacks.isBackpackDropLocked(it.col, it.row, it.size)) continue
      const itTier = instanceToTier.get(it.instanceId) ?? 'Bronze'
      const itStar = getInstanceTierStar(it.instanceId)
      if (!canSynthesizePair(defId, it.defId, tier, star, itTier, itStar)) continue
      if (isPointInItemBounds(ctx.backpackView, it, gx, gy)) {
        return { instanceId: it.instanceId, zone: 'backpack' }
      }
    }
  }

  return null
}

export function findSynthesisTargetByFootprint(
  defId: string,
  tier: TierKey,
  star: 1 | 2,
  gx: number,
  gy: number,
  dragSize: ItemSizeNorm | undefined,
  ctx: ShopSceneCtx,
  callbacks: SynthesisCallbacks,
): SynthesisTarget | null {
  if (!dragSize) return null
  const { w, h } = getSizeCellDim(dragSize)
  const tryZone = (
    view: GridZone | null,
    system: GridSystem | null,
    zone: 'battle' | 'backpack',
  ): SynthesisTarget | null => {
    if (!view || !system || (zone === 'backpack' && !view.visible)) return null
    const cell = view.pixelToCellForItem(gx, gy, dragSize, 0)
    if (!cell) return null
    const l = cell.col
    const r = cell.col + w
    const t = cell.row
    const b = cell.row + h
    for (const it of system.getAllItems()) {
      if (zone === 'backpack' && callbacks.isBackpackDropLocked(it.col, it.row, it.size)) continue
      const itTier = instanceToTier.get(it.instanceId) ?? 'Bronze'
      const itStar = getInstanceTierStar(it.instanceId)
      if (!canSynthesizePair(defId, it.defId, tier, star, itTier, itStar)) continue
      const d = getSizeCellDim(it.size)
      const il = it.col
      const ir = it.col + d.w
      const itop = it.row
      const ib = it.row + d.h
      if (l < ir && r > il && t < ib && b > itop) {
        return { instanceId: it.instanceId, zone }
      }
    }
    return null
  }

  return (
    (isBattleZoneNoSynthesisEnabled() ? null : tryZone(ctx.battleView, ctx.battleSystem, 'battle'))
    ?? tryZone(ctx.backpackView, ctx.backpackSystem, 'backpack')
  )
}

export function findSynthesisTargetWithDragProbe(
  defId: string,
  tier: TierKey,
  star: 1 | 2,
  gx: number,
  gy: number,
  dragSize: ItemSizeNorm | undefined,
  ctx: ShopSceneCtx,
  callbacks: SynthesisCallbacks,
): SynthesisTarget | null {
  const direct = findSynthesisTargetAtPointer(defId, tier, star, gx, gy, dragSize, ctx, callbacks)
  if (direct) return direct
  const byFootprint = findSynthesisTargetByFootprint(defId, tier, star, gx, gy, dragSize, ctx, callbacks)
  if (byFootprint) return byFootprint
  const probeY = gy + (dragSize ? getDebugCfg('dragYOffset') : 0)
  if (probeY === gy) return null
  return (
    findSynthesisTargetAtPointer(defId, tier, star, gx, probeY, dragSize, ctx, callbacks)
    ?? findSynthesisTargetByFootprint(defId, tier, star, gx, probeY, dragSize, ctx, callbacks)
  )
}

export function findBattleSynthesisTargetWithDragProbeIgnoringNoSynthesis(
  defId: string,
  tier: TierKey,
  star: 1 | 2,
  gx: number,
  gy: number,
  dragSize: ItemSizeNorm | undefined,
  ctx: ShopSceneCtx,
): SynthesisTarget | null {
  if (!ctx.battleSystem || !ctx.battleView) return null
  const battleSystemRef = ctx.battleSystem
  const battleViewRef = ctx.battleView

  const matchAtPointer = (probeY: number): SynthesisTarget | null => {
    for (const it of battleSystemRef.getAllItems()) {
      const itTier = instanceToTier.get(it.instanceId) ?? 'Bronze'
      const itStar = getInstanceTierStar(it.instanceId)
      if (!canSynthesizePair(defId, it.defId, tier, star, itTier, itStar)) continue
      if (isPointInItemBounds(battleViewRef, it, gx, probeY)) {
        return { instanceId: it.instanceId, zone: 'battle' }
      }
    }
    return null
  }

  const matchByFootprint = (probeY: number): SynthesisTarget | null => {
    if (!dragSize) return null
    const { w, h } = getSizeCellDim(dragSize)
    const cell = battleViewRef.pixelToCellForItem(gx, probeY, dragSize, 0)
    if (!cell) return null
    const l = cell.col
    const r = cell.col + w
    const t = cell.row
    const b = cell.row + h
    for (const it of battleSystemRef.getAllItems()) {
      const itTier = instanceToTier.get(it.instanceId) ?? 'Bronze'
      const itStar = getInstanceTierStar(it.instanceId)
      if (!canSynthesizePair(defId, it.defId, tier, star, itTier, itStar)) continue
      const d = getSizeCellDim(it.size)
      const il = it.col
      const ir = it.col + d.w
      const itop = it.row
      const ib = it.row + d.h
      if (l < ir && r > il && t < ib && b > itop) {
        return { instanceId: it.instanceId, zone: 'battle' }
      }
    }
    return null
  }

  const direct = matchAtPointer(gy) ?? matchByFootprint(gy)
  if (direct) return direct
  const probeY = gy + (dragSize ? getDebugCfg('dragYOffset') : 0)
  if (probeY === gy) return null
  return matchAtPointer(probeY) ?? matchByFootprint(probeY)
}

// ---- 目标物品获取与高亮 ----

export function getSynthesisTargetItem(target: SynthesisTarget, ctx: ShopSceneCtx): PlacedItem | null {
  if (!ctx.battleSystem || !ctx.backpackSystem) return null
  const system = target.zone === 'battle' ? ctx.battleSystem : ctx.backpackSystem
  return system.getItem(target.instanceId) ?? null
}

export function highlightSynthesisTarget(target: SynthesisTarget | null, ctx: ShopSceneCtx): void {
  if (!target || !ctx.battleSystem || !ctx.backpackSystem || !ctx.battleView || !ctx.backpackView) {
    ctx.battleView?.clearHighlight()
    ctx.backpackView?.clearHighlight()
    return
  }

  const inBattle = target.zone === 'battle'
  const system = inBattle ? ctx.battleSystem : ctx.backpackSystem
  const view = inBattle ? ctx.battleView : ctx.backpackView
  const item = system.getItem(target.instanceId)
  if (!item) {
    ctx.battleView?.clearHighlight()
    ctx.backpackView?.clearHighlight()
    return
  }

  view.highlightCells(item.col, item.row, item.size, true, getShopUiColor('highlight'))
  if (inBattle) ctx.backpackView.clearHighlight()
  else ctx.battleView.clearHighlight()
}

// ---- 合成执行 ----

export function synthesizeTarget(
  defId: string,
  tier: TierKey,
  star: 1 | 2,
  targetInstanceId: string,
  zone: 'battle' | 'backpack',
  ctx: ShopSceneCtx,
  callbacks: SynthesisCallbacks,
): SynthesizeResult | null {
  if (!ctx.battleSystem || !ctx.backpackSystem || !ctx.battleView || !ctx.backpackView) return null
  const baseUpgrade = nextTierLevel(tier, star)
  if (!baseUpgrade) return null
  let upgradeTo = baseUpgrade
  const eventExtra = ctx.dayEventState.extraUpgradeRemaining > 0
  if (eventExtra) {
    const extra = nextTierLevel(upgradeTo.tier, upgradeTo.star)
    if (extra) upgradeTo = extra
  }
  const skillExtra = nextTierLevel(upgradeTo.tier, upgradeTo.star)
  const wantsSkillExtra = shouldTriggerSkill48ExtraUpgrade(hasPickedSkill(ctx, 'skill48'), !!skillExtra, Math.random())
  if (wantsSkillExtra && skillExtra) upgradeTo = skillExtra

  const targetItem = zone === 'battle'
    ? ctx.battleSystem.getItem(targetInstanceId)
    : ctx.backpackSystem.getItem(targetInstanceId)
  if (!targetItem) return null
  const targetTier = instanceToTier.get(targetInstanceId) ?? 'Bronze'
  const targetStar = getInstanceTierStar(targetInstanceId)
  if (!canSynthesizePair(defId, targetItem.defId, tier, star, targetTier, targetStar)) return null

  const sourceDef = getItemDefById(defId)
  if (!sourceDef) return null
  const targetDef = getItemDefById(targetItem.defId)
  if (!targetDef) return null

  const isSameIdSynthesis = defId === targetItem.defId
  const forceSynthesisActive = !!(ctx.dayEventState.forceSynthesisArchetype && ctx.dayEventState.forceSynthesisRemaining > 0)
  const minStartingTier = getCrossSynthesisMinStartingTier(sourceDef, targetDef)
  const preferOtherArchetype = shouldCrossSynthesisPreferOtherArchetype(sourceDef, targetDef) && !forceSynthesisActive
  let guaranteeNewUnlock = shouldGuaranteeNewUnlock(upgradeTo.tier, upgradeTo.star)
  let resultLevel = tierStarLevelIndex(upgradeTo.tier, upgradeTo.star) + 1
  const buildCandidates = (targetTierKey: TierKey) => {
    const all = pickCrossIdEvolveCandidates(sourceDef, targetItem.size, targetTierKey, minStartingTier, preferOtherArchetype)
    if (forceSynthesisActive) {
      const forced = all.filter((it) => toSkillArchetype(getPrimaryArchetype(it.tags)) === ctx.dayEventState.forceSynthesisArchetype)
      if (forced.length > 0) return forced
      if (all.length > 0) return all
      return [sourceDef]
    }
    if (ctx.dayEventState.allSynthesisRandom) {
      if (all.length > 0) return all
      return [sourceDef]
    }
    if (isSameIdSynthesis) return [sourceDef]
    return all
  }
  let evolveCandidates = buildCandidates(upgradeTo.tier)
  let evolvedDef = pickCrossSynthesisResultWithCycle(evolveCandidates, upgradeTo.tier, upgradeTo.star, minStartingTier)
  if (!evolvedDef && (upgradeTo.tier !== baseUpgrade.tier || upgradeTo.star !== baseUpgrade.star)) {
    upgradeTo = baseUpgrade
    guaranteeNewUnlock = shouldGuaranteeNewUnlock(upgradeTo.tier, upgradeTo.star)
    resultLevel = tierStarLevelIndex(upgradeTo.tier, upgradeTo.star) + 1
    evolveCandidates = buildCandidates(upgradeTo.tier)
    evolvedDef = pickCrossSynthesisResultWithCycle(evolveCandidates, upgradeTo.tier, upgradeTo.star, minStartingTier)
  }
  if (!evolvedDef) return null

  const system = zone === 'battle' ? ctx.battleSystem : ctx.backpackSystem
  const view = zone === 'battle' ? ctx.battleView : ctx.backpackView
  system.remove(targetInstanceId)
  if (!system.place(targetItem.col, targetItem.row, targetItem.size, evolvedDef.id, targetInstanceId)) {
    system.place(targetItem.col, targetItem.row, targetItem.size, targetItem.defId, targetInstanceId)
    return null
  }
  view.removeItem(targetInstanceId)
  void view.addItem(
    targetInstanceId,
    evolvedDef.id,
    targetItem.size,
    targetItem.col,
    targetItem.row,
    toVisualTier(upgradeTo.tier, upgradeTo.star),
  ).then(() => {
    view.setItemTier(targetInstanceId, toVisualTier(upgradeTo.tier, upgradeTo.star))
    ctx.drag?.refreshZone(view)
  })

  instanceToDefId.set(targetInstanceId, evolvedDef.id)
  setInstanceQualityLevel(targetInstanceId, evolvedDef.id, parseTierName(evolvedDef.starting_tier) ?? 'Bronze', resultLevel)
  if (eventExtra && ctx.dayEventState.extraUpgradeRemaining > 0) {
    ctx.dayEventState.extraUpgradeRemaining = Math.max(0, ctx.dayEventState.extraUpgradeRemaining - 1)
  }
  if (forceSynthesisActive && ctx.dayEventState.forceSynthesisRemaining > 0) {
    ctx.dayEventState.forceSynthesisRemaining = Math.max(0, ctx.dayEventState.forceSynthesisRemaining - 1)
    if (ctx.dayEventState.forceSynthesisRemaining <= 0) ctx.dayEventState.forceSynthesisArchetype = null
  }
  callbacks.unlockItemToPool(evolvedDef.id)
  if (guaranteeNewUnlock && (resultLevel === 3 || resultLevel === 5 || resultLevel === 7)) {
    ctx.guaranteedNewUnlockTriggeredLevels.add(resultLevel)
  }
  callbacks.applyInstanceTierVisuals()
  callbacks.syncShopOwnedTierRules()
  refreshUpgradeHints(ctx)
  callbacks.grantSynthesisExp(1, { instanceId: targetInstanceId, zone })
  callbacks.checkAndPopPendingRewards()
  return {
    instanceId: targetInstanceId,
    targetZone: zone,
    fromTier: tier,
    fromStar: star,
    toTier: upgradeTo.tier,
    toStar: upgradeTo.star,
    targetSize: targetItem.size,
  }
}
