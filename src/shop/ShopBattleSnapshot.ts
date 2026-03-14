// ============================================================
// ShopBattleSnapshot — 战斗快照构建逻辑
// ============================================================

import { getConfig, getAllItems } from '@/core/DataLoader'
import { getWinTrophyState, getPlayerProgressState } from '@/core/RunState'
import { resolveItemTierBaseStats } from '@/common/items/ItemTierStats'
import type { BattleSnapshotBundle } from '@/battle/BattleSnapshotStore'
import {
  instanceToDefId, instanceToPermanentDamageBonus, instanceToEnchantment,
  getInstanceTier, getInstanceTierStar, getInstanceQuality, getInstanceLevel,
} from './systems/ShopInstanceRegistry'
import { clampPlayerLevel, getPlayerMaxLifeByLevel } from './ui/PlayerStatusUI'
import { levelToTierStar } from './systems/QuickBuySystem'
import { isSelectedHero } from './systems/ShopHeroSystem'
import type { ShopSceneCtx } from './ShopSceneContext'
import type { ItemEnchantmentKey } from '@/common/items/ItemEnchantment'
import { resolveItemEnchantmentEffectCn } from '@/common/items/ItemEnchantment'

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
    ownerLevel: playerLevel,
    entities: snap.entities.map((it) => ({
      ...it,
      tier: getInstanceTier(it.instanceId) ?? 'Bronze',
      tierStar: getInstanceTierStar(it.instanceId),
      quality: getInstanceQuality(it.instanceId),
      level: getInstanceLevel(it.instanceId),
      permanentDamageBonus: Math.max(0, Math.round(instanceToPermanentDamageBonus.get(it.instanceId) ?? 0)),
      enchantment: instanceToEnchantment.get(it.instanceId),
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
  const enchantment = instanceToEnchantment.get(instanceId)
  let damage = Math.max(0, Math.round(stats.damage + permanentBonus))
  let heal = Math.max(0, Math.round(stats.heal))
  let shield = Math.max(0, Math.round(stats.shield))
  let multicast = Math.max(1, Math.round(stats.multicast))
  applyEnchantmentPreview(def, enchantment, { damageRef: () => damage, setDamage: (v) => { damage = v }, healRef: () => heal, setHeal: (v) => { heal = v }, shieldRef: () => shield, setShield: (v) => { shield = v }, multicastRef: () => multicast, setMulticast: (v) => { multicast = v } })
  return {
    cooldownMs: Math.max(0, Math.round(stats.cooldownMs)),
    damage,
    heal,
    shield,
    burn: Math.max(0, Math.round(stats.burn)),
    poison: Math.max(0, Math.round(stats.poison)),
    regen: Math.max(0, Math.round(stats.regen)),
    crit: Math.max(0, stats.crit),
    multicast,
  }
}

function applyEnchantmentPreview(
  item: import('@/common/items/ItemDef').ItemDef,
  enchantment: ItemEnchantmentKey | undefined,
  state: {
    damageRef: () => number
    setDamage: (v: number) => void
    healRef: () => number
    setHeal: (v: number) => void
    shieldRef: () => number
    setShield: (v: number) => void
    multicastRef: () => number
    setMulticast: (v: number) => void
  },
): void {
  if (!enchantment) return
  const effectCn = resolveItemEnchantmentEffectCn(item, enchantment)
  const damage = state.damageRef()
  const heal = state.healRef()
  const shield = state.shieldRef()
  if (enchantment === 'damage') {
    if (/等同于护盾/.test(effectCn)) state.setDamage(Math.max(0, Math.round(shield)))
    else if (/等同于(?:加血|生命值)/.test(effectCn)) state.setDamage(Math.max(0, Math.round(heal)))
    return
  }
  if (enchantment === 'shield') {
    if (/等同于伤害/.test(effectCn)) state.setShield(Math.max(0, Math.round(damage)))
    else if (/等同于(?:加血|生命值)/.test(effectCn)) state.setShield(Math.max(0, Math.round(heal)))
    return
  }
  if (enchantment === 'heal') {
    if (/等同于伤害/.test(effectCn)) state.setHeal(Math.max(0, Math.round(damage)))
    else if (/等同于护盾/.test(effectCn)) state.setHeal(Math.max(0, Math.round(shield)))
    return
  }
  if (enchantment === 'shiny') {
    if (/连发次数\+1/.test(effectCn)) state.setMulticast(Math.max(1, Math.round(state.multicastRef() + 1)))
  }
}
