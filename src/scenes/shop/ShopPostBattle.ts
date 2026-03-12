// ============================================================
// ShopPostBattle — 战斗结束后处理逻辑
// 提取自 ShopScene.ts Phase 8 Batch C
// 包含：永久成长、自动复制、战后效果统一入口
// ============================================================

import type { ShopSceneCtx } from './ShopSceneContext'
import type { BattleSnapshotBundle } from '@/combat/BattleSnapshotStore'
import { getAllItems } from '@/core/DataLoader'
import { normalizeSize } from '@/items/ItemDef'
import {
  nextId,
  instanceToDefId,
  instanceToPermanentDamageBonus,
  setInstanceQualityLevel,
  levelFromLegacyTierStar,
} from './InstanceRegistry'
import { parseTierName } from './SynthesisLogic'
import { tierValueFromSkillLine, isAttackItemForBattle } from './SpecialShopDesc'
import { toVisualTier } from './ShopMathHelpers'
import { findFirstBackpackPlace } from './ShopGridInventory'

export type PostBattleCallbacks = {
  recordNeutralItemObtained: (defId: string) => void
  syncShopOwnedTierRules: () => void
  refreshShopUI: () => void
}

export function applyPostBattlePermanentGrowth(snapshot: BattleSnapshotBundle): boolean {
  const allItems = getAllItems()
  const byId = new Map(allItems.map((it) => [it.id, it] as const))
  const playerEntities = snapshot.entities
  const attackerCount = playerEntities
    .map((e) => byId.get(e.defId))
    .filter((v): v is ReturnType<typeof getAllItems>[number] => !!v)
    .filter((it) => isAttackItemForBattle(it))
    .length

  if (attackerCount !== 1) return false

  let changed = false
  for (const entity of playerEntities) {
    const item = byId.get(entity.defId)
    if (!item) continue
    const line = (item.skills ?? []).map((s) => s.cn ?? '').find((s) => /唯一的攻击物品.*战斗结束后永久\+\d+(?:\/\d+)*伤害/.test(s))
    if (!line) continue
    const bonus = Math.round(tierValueFromSkillLine(item, entity.tier, line))
    if (bonus <= 0) continue
    const prev = Math.max(0, Math.round(instanceToPermanentDamageBonus.get(entity.instanceId) ?? 0))
    instanceToPermanentDamageBonus.set(entity.instanceId, prev + bonus)
    changed = true
    console.log(`[ShopScene] 战后永久成长 ${item.name_cn} +${bonus}伤害（累计 ${prev + bonus}）`)
  }
  return changed
}

export function applyPostBattleAutoCopy(
  snapshot: BattleSnapshotBundle,
  ctx: ShopSceneCtx,
  callbacks: PostBattleCallbacks,
): boolean {
  if (!ctx.backpackSystem || !ctx.backpackView) return false
  const allItems = getAllItems()
  const byId = new Map(allItems.map((it) => [it.id, it] as const))
  let changed = false

  for (const entity of snapshot.entities) {
    const item = byId.get(entity.defId)
    if (!item) continue
    const hasAutoCopy = (item.skills ?? []).some((s) => /每次战斗后自动复制/.test(s.cn ?? ''))
    if (!hasAutoCopy) continue
    const size = normalizeSize(item.size)
    const place = findFirstBackpackPlace(size, ctx)
    if (!place) continue

    const newId = nextId()
    ctx.backpackSystem.place(place.col, place.row, size, item.id, newId)
    void ctx.backpackView.addItem(newId, item.id, size, place.col, place.row, toVisualTier(entity.tier, 1)).then(() => {
      ctx.backpackView!.setItemTier(newId, toVisualTier(entity.tier, 1))
      ctx.drag?.refreshZone(ctx.backpackView!)
    })
    instanceToDefId.set(newId, item.id)
    setInstanceQualityLevel(newId, item.id, parseTierName(item.starting_tier) ?? 'Bronze', levelFromLegacyTierStar(entity.tier, 1))
    instanceToPermanentDamageBonus.set(newId, 0)
    callbacks.recordNeutralItemObtained(item.id)
    changed = true
    console.log(`[ShopScene] 战后复制 ${item.name_cn} -> 背包`)
  }

  return changed
}

export function applyPostBattleEffects(
  snapshot: BattleSnapshotBundle | null,
  ctx: ShopSceneCtx,
  callbacks: PostBattleCallbacks,
): void {
  if (!snapshot) return
  const changedGrowth = applyPostBattlePermanentGrowth(snapshot)
  const changedCopy = applyPostBattleAutoCopy(snapshot, ctx, callbacks)
  if (changedGrowth || changedCopy) {
    callbacks.syncShopOwnedTierRules()
    callbacks.refreshShopUI()
  }
}
