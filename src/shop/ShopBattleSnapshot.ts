// ============================================================
// ShopBattleSnapshot — 战斗快照构建逻辑
// ============================================================

import { getConfig, getAllItems } from '@/core/DataLoader'
import { getWinTrophyState, getPlayerProgressState } from '@/core/RunState'
import { resolveItemTierBaseStats } from '@/common/items/ItemTierStats'
import type { BattleSnapshotBundle } from '@/battle/BattleSnapshotStore'
import {
  instanceToDefId, instanceToPermanentDamageBonus,
  getInstanceTier, getInstanceTierStar, getInstanceQuality, getInstanceLevel,
} from './systems/ShopInstanceRegistry'
import { clampPlayerLevel, getPlayerMaxLifeByLevel } from './ui/PlayerStatusUI'
import { levelToTierStar } from './systems/QuickBuySystem'
import { isSelectedHero } from './systems/ShopHeroSystem'
import type { ShopSceneCtx } from './ShopSceneContext'

export function buildBattleSnapshot(ctx: ShopSceneCtx, skillBarMoveStartAtMs?: number): BattleSnapshotBundle | null {
  if (!ctx.battleSystem || !ctx.battleView) return null
  const activeColCount = ctx.battleView.activeColCount
  const snap = ctx.battleSystem.exportCombatSnapshot(activeColCount)
  const playerBackpackItemCount = ctx.backpackSystem?.getAllItems().length ?? 0
  const trophyTarget = getConfig().runRules?.trophyWinsToFinalVictory ?? 10
  const trophy = getWinTrophyState(trophyTarget)
  const progress = getPlayerProgressState()
  const playerLevel = clampPlayerLevel(progress.level)
  let playerBattleHp = getPlayerMaxLifeByLevel(playerLevel)
  if (isSelectedHero(ctx, 'hero10')) {
    playerBattleHp = Math.max(1, Math.round(playerBattleHp * 1.3))
  }
  return {
    day: ctx.currentDay,
    activeColCount: snap.activeColCount,
    createdAtMs: snap.createdAtMs,
    skillBarMoveStartAtMs: typeof skillBarMoveStartAtMs === 'number' ? skillBarMoveStartAtMs : undefined,
    playerBackpackItemCount,
    playerGold: Math.max(0, Math.round(ctx.shopManager?.gold ?? 0)),
    playerTrophyWins: Math.max(0, Math.round(trophy.wins)),
    playerBattleHp,
    ownerSkillIds: ctx.pickedSkills.map((s) => s.id),
    ownerHeroId: ctx.starterClass ?? undefined,
    entities: snap.entities.map((it) => ({
      ...it,
      tier: getInstanceTier(it.instanceId) ?? 'Bronze',
      tierStar: getInstanceTierStar(it.instanceId),
      quality: getInstanceQuality(it.instanceId),
      level: getInstanceLevel(it.instanceId),
      permanentDamageBonus: Math.max(0, Math.round(instanceToPermanentDamageBonus.get(it.instanceId) ?? 0)),
      baseStats: resolveInstanceBaseStats(it.instanceId),
    })),
  }
}

export function resolveInstanceBaseStats(instanceId: string): BattleSnapshotBundle['entities'][number]['baseStats'] {
  const defId = instanceToDefId.get(instanceId)
  if (!defId) return undefined
  const def = getAllItems().find((it) => it.id === defId)
  if (!def) return undefined
  const level = getInstanceLevel(instanceId)
  const legacy = levelToTierStar(level)
  const tier = legacy?.tier ?? 'Bronze'
  const star = legacy?.star ?? 1
  const stats = resolveItemTierBaseStats(def, `${tier}#${star}`)
  const permanentBonus = Math.max(0, Math.round(instanceToPermanentDamageBonus.get(instanceId) ?? 0))
  return {
    cooldownMs: Math.max(0, Math.round(stats.cooldownMs)),
    damage: Math.max(0, Math.round(stats.damage + permanentBonus)),
    heal: Math.max(0, Math.round(stats.heal)),
    shield: Math.max(0, Math.round(stats.shield)),
    burn: Math.max(0, Math.round(stats.burn)),
    poison: Math.max(0, Math.round(stats.poison)),
    regen: Math.max(0, Math.round(stats.regen)),
    crit: Math.max(0, stats.crit),
    multicast: Math.max(1, Math.round(stats.multicast)),
  }
}
