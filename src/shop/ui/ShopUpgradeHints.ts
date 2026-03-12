// ============================================================
// ShopUpgradeHints — 升级/合成提示计算
// ============================================================

import type { TierKey } from '@/shop/ShopManager'
import {
  instanceToTier,
  getInstanceTierStar,
} from '../systems/ShopInstanceRegistry'
import {
  getItemDefById, getPrimaryArchetype, nextTierLevel,
} from '../systems/ShopSynthesisLogic'
import type { ShopSceneCtx } from '../ShopSceneContext'

export type UpgradeMatch = {
  shopSlots: number[]
  battleIds: string[]
  backpackIds: string[]
  hasBackpackMatch: boolean
}

export function computeUpgradeMatch(ctx: ShopSceneCtx): UpgradeMatch {
  const battleIds: string[] = []
  const backpackIds: string[] = []
  const shopSlots: number[] = []
  let hasBackpackMatch = false

  if (!ctx.shopManager || !ctx.battleSystem || !ctx.backpackSystem) {
    return { shopSlots, battleIds, backpackIds, hasBackpackMatch }
  }

  const ownedByKey = new Map<string, { inBattle: string[]; inBackpack: string[]; defIds: Set<string> }>()
  const ownedByArchetypeKey = new Map<string, { inBattle: string[]; inBackpack: string[]; defIds: Set<string> }>()
  for (const it of ctx.battleSystem.getAllItems()) {
    const tier = instanceToTier.get(it.instanceId) ?? 'Bronze'
    const star = getInstanceTierStar(it.instanceId)
    const key = `${it.defId}:${tier}:${star}`
    const obj = ownedByKey.get(key) ?? { inBattle: [], inBackpack: [], defIds: new Set<string>() }
    obj.inBattle.push(it.instanceId)
    obj.defIds.add(it.defId)
    ownedByKey.set(key, obj)

    const def = getItemDefById(it.defId)
    const archetype = getPrimaryArchetype(def?.tags ?? '')
    const archKey = `${archetype}:${tier}:${star}`
    const archObj = ownedByArchetypeKey.get(archKey) ?? { inBattle: [], inBackpack: [], defIds: new Set<string>() }
    archObj.inBattle.push(it.instanceId)
    archObj.defIds.add(it.defId)
    ownedByArchetypeKey.set(archKey, archObj)
  }
  for (const it of ctx.backpackSystem.getAllItems()) {
    const tier = instanceToTier.get(it.instanceId) ?? 'Bronze'
    const star = getInstanceTierStar(it.instanceId)
    const key = `${it.defId}:${tier}:${star}`
    const obj = ownedByKey.get(key) ?? { inBattle: [], inBackpack: [], defIds: new Set<string>() }
    obj.inBackpack.push(it.instanceId)
    obj.defIds.add(it.defId)
    ownedByKey.set(key, obj)

    const def = getItemDefById(it.defId)
    const archetype = getPrimaryArchetype(def?.tags ?? '')
    const archKey = `${archetype}:${tier}:${star}`
    const archObj = ownedByArchetypeKey.get(archKey) ?? { inBattle: [], inBackpack: [], defIds: new Set<string>() }
    archObj.inBackpack.push(it.instanceId)
    archObj.defIds.add(it.defId)
    ownedByArchetypeKey.set(archKey, archObj)
  }

  for (const [key, match] of ownedByKey) {
    const parts = key.split(':')
    const tier = (parts[1] ?? 'Bronze') as TierKey
    const star = Number(parts[2]) === 2 ? 2 : 1
    if (!nextTierLevel(tier, star)) continue
    const count = match.inBattle.length + match.inBackpack.length
    if (count < 2) continue
    battleIds.push(...match.inBattle)
    backpackIds.push(...match.inBackpack)
    if (match.inBackpack.length > 0) hasBackpackMatch = true
  }

  for (const [key, match] of ownedByArchetypeKey) {
    const parts = key.split(':')
    const archetype = parts[0] ?? ''
    const tier = (parts[1] ?? 'Bronze') as TierKey
    const star = Number(parts[2]) === 2 ? 2 : 1
    if (!archetype || !nextTierLevel(tier, star)) continue
    if (match.defIds.size < 2) continue
    const count = match.inBattle.length + match.inBackpack.length
    if (count < 2) continue
    battleIds.push(...match.inBattle)
    backpackIds.push(...match.inBackpack)
    if (match.inBackpack.length > 0) hasBackpackMatch = true
  }

  for (let i = 0; i < ctx.shopManager.pool.length; i++) {
    const slot = ctx.shopManager.pool[i]
    if (!slot || slot.purchased || slot.tier === 'Diamond') continue
    const directMatch = ownedByKey.get(`${slot.item.id}:${slot.tier}:1`)
    const slotArch = getPrimaryArchetype(slot.item.tags)
    const archMatch = ownedByArchetypeKey.get(`${slotArch}:${slot.tier}:1`)
    const canDirect = !!directMatch && (directMatch.inBattle.length + directMatch.inBackpack.length > 0)
    const canCross = !!archMatch
      && (archMatch.inBattle.length + archMatch.inBackpack.length > 0)
      && (archMatch.defIds.size > 1 || !archMatch.defIds.has(slot.item.id))
    if (!canDirect && !canCross) continue
    shopSlots.push(i)
  }

  return {
    shopSlots,
    battleIds: Array.from(new Set(battleIds)),
    backpackIds: Array.from(new Set(backpackIds)),
    hasBackpackMatch,
  }
}

export function refreshUpgradeHints(ctx: ShopSceneCtx): void {
  const match = computeUpgradeMatch(ctx)
  ctx.shopPanel?.setUpgradeHints(match.shopSlots)
  ctx.battleView?.setUpgradeHints(match.battleIds)
  ctx.backpackView?.setUpgradeHints(match.backpackIds)
}
