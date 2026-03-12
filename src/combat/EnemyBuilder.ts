// ============================================================
// EnemyBuilder — 敌方战斗单元构建逻辑
// ============================================================

import type { BattleSnapshotBundle, BattleSnapshotEntity } from '@/combat/BattleSnapshotStore'
import type { ItemDef, ItemSizeNorm } from '@/items/ItemDef'
import { normalizeSize } from '@/items/ItemDef'
import { resolveItemTierBaseStats } from '@/items/itemTierStats'
import { getAllItems, getConfig } from '@/core/DataLoader'
import { getLifeState, getPlayerWinStreakState } from '@/core/RunState'
import type { CombatItemRunner, EnemyTier, EnemyStar } from './CombatTypes'
import {
  validCooldown, skillLines, findItemDef, isNeutralItemDef,
  tierIndexFromRaw, ammoFromSkillLines, multicastFromSkillLines,
  tierStarToRaw, parseAvailableTiers, getPrimaryArchetypeTag,
  buildQualityScores, makeSeededRng, dailyCurveValue, qualityScoreToTierStar,
  rv, rvBool,
} from './CombatHelpers'

// ── 玩家快照 → CombatItemRunner ──────────────────────────────

export function toRunner(entity: BattleSnapshotEntity, idPrefix: string): CombatItemRunner {
  const def = findItemDef(entity.defId)
  const level = Math.max(1, Math.min(7, Math.round(entity.level ?? 0)))
  const tierStarFromLevel = qualityScoreToTierStar(level)
  const fallbackTierStar: { tier: EnemyTier; star: EnemyStar } = {
    tier: (entity.tier ?? 'Bronze') as EnemyTier,
    star: (entity.tier === 'Bronze' ? 1 : (entity.tierStar === 2 ? 2 : 1)) as EnemyStar,
  }
  const tierStarResolved = entity.level ? tierStarFromLevel : fallbackTierStar
  const tierStar: 1 | 2 = tierStarResolved.star
  const tierRaw = `${tierStarResolved.tier}#${tierStarResolved.star}`
  const snapBase = entity.baseStats
  const tierStats = def ? resolveItemTierBaseStats(def, tierRaw) : null
  const tierIndex = tierIndexFromRaw(def, tierRaw)
  const lines = skillLines(def)
  const ammoMax = ammoFromSkillLines(lines, tierIndex)
  const baseMulticast = Math.max(1, Math.round(snapBase?.multicast ?? tierStats?.multicast ?? def?.multicast ?? 1))
  const parsedMulticast = multicastFromSkillLines(lines, tierIndex, baseMulticast)
  const permanentBonus = ('permanentDamageBonus' in entity && typeof entity.permanentDamageBonus === 'number')
    ? Math.max(0, entity.permanentDamageBonus)
    : 0
  return {
    id: `${idPrefix}-${entity.instanceId}`,
    side: 'player',
    defId: entity.defId,
    baseStats: {
      cooldownMs: validCooldown(snapBase?.cooldownMs ?? tierStats?.cooldownMs ?? def?.cooldown ?? 0),
      damage: Math.max(0, snapBase?.damage ?? ((tierStats?.damage ?? def?.damage ?? 0) + permanentBonus)),
      heal: Math.max(0, snapBase?.heal ?? tierStats?.heal ?? def?.heal ?? 0),
      shield: Math.max(0, snapBase?.shield ?? tierStats?.shield ?? def?.shield ?? 0),
      burn: Math.max(0, snapBase?.burn ?? tierStats?.burn ?? def?.burn ?? 0),
      poison: Math.max(0, snapBase?.poison ?? tierStats?.poison ?? def?.poison ?? 0),
      regen: Math.max(0, snapBase?.regen ?? tierStats?.regen ?? def?.regen ?? 0),
      crit: Math.max(0, snapBase?.crit ?? tierStats?.crit ?? def?.crit ?? 0),
      multicast: Math.max(1, parsedMulticast),
    },
    runtime: {
      currentChargeMs: 0,
      pendingChargeMs: 0,
      tempDamageBonus: 0,
      damageScale: 1,
      bonusMulticast: 0,
      executeCount: 0,
      ammoMax,
      ammoCurrent: ammoMax,
      modifiers: {
        freezeMs: 0,
        slowMs: 0,
        hasteMs: 0,
      },
    },
    col: entity.col,
    row: entity.row,
    size: entity.size,
    tier: tierRaw,
    tierStar,
  }
}

// ── 敌方 Runner 主入口 ────────────────────────────────────────

export function makeEnemyRunners(day: number, snapshot: BattleSnapshotBundle): CombatItemRunner[] {
  const all = getAllItems()
  if (!all.length) return []
  const nonNeutralAll = all.filter((def) => !isNeutralItemDef(def))
  if (!nonNeutralAll.length) return []
  const cfg = getConfig()
  const labCfg = cfg.gameplayModeValues?.enemyDraftLab
  const labEnabled = rvBool('enemyDraftEnabled', labCfg?.enabled === true)
  const configuredDefs = pickEnemyDefsByDay(day, nonNeutralAll)
  const seedDefs = configuredDefs.length > 0 ? configuredDefs : nonNeutralAll
  if (seedDefs.length === 0) return []

  const rng = makeSeededRng(day * 977 + snapshot.activeColCount * 131 + seedDefs.length * 17)

  if (!labEnabled) {
    const teaching = buildEnemyTeachingRunners(day, snapshot, nonNeutralAll, rng)
    if (teaching && teaching.length > 0) return teaching
  }

  const sameArchetypeBias = Math.max(0, Math.min(1, rv('enemyDraftSameArchetypeBias', labCfg?.sameArchetypeBias ?? 0.85)))
  const targetCount = Math.max(1, Math.min(
    snapshot.activeColCount,
    Math.round(dailyCurveValue(labCfg?.dailyItemCount, day, 5)),
  ))
  const baseTargetAvgQuality = Math.max(1, Math.min(7, dailyCurveValue(labCfg?.dailyAvgQuality, day, 3)))
  const playerWinStreak = Math.max(0, Math.round(getPlayerWinStreakState().count))
  const playerHp = Math.max(1, Math.round(getLifeState().current))
  const streakIdx = Math.min(9, playerWinStreak)
  const streakBonusByHp: Record<1 | 2 | 3 | 4 | 5, number[]> = {
    5: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25],
    4: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25],
    3: [0, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
    2: [0, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
    1: [-0.25, 0, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75],
  }
  const hpKey: 1 | 2 | 3 | 4 | 5 = playerHp >= 5 ? 5 : playerHp >= 4 ? 4 : playerHp >= 3 ? 3 : playerHp >= 2 ? 2 : 1
  const streakQualityBonus = streakBonusByHp[hpKey][streakIdx] ?? 0
  const targetAvgQuality = Math.max(1, Math.min(7, baseTargetAvgQuality + streakQualityBonus))
  const qualityScores = buildQualityScores(targetCount, targetAvgQuality)

  const byArchetype = new Map<string, ItemDef[]>()
  for (const def of seedDefs) {
    const size = normalizeSize(def.size)
    if (size !== '1x1') continue
    const tag = getPrimaryArchetypeTag(def.tags)
    if (!tag) continue
    const bucket = byArchetype.get(tag) ?? []
    bucket.push(def)
    byArchetype.set(tag, bucket)
  }
  const archetypes = Array.from(byArchetype.keys())
  const preferredArchetype = archetypes.length > 0
    ? archetypes[Math.floor(rng() * archetypes.length)]!
    : ''

  const order = Array.from({ length: snapshot.activeColCount }, (_, i) => i)
    .sort((a, b) => Math.abs(a - (snapshot.activeColCount - 1) / 2) - Math.abs(b - (snapshot.activeColCount - 1) / 2))

  const out: CombatItemRunner[] = []
  let serial = 0
  const poolBase = seedDefs.filter((d) => normalizeSize(d.size) === '1x1')
  for (let i = 0; i < qualityScores.length && i < order.length; i++) {
    const score = qualityScores[i]!
    const desired = qualityScoreToTierStar(score)
    const tierPool = poolBase.filter((def) => parseAvailableTiers(def.available_tiers).includes(desired.tier))
    const sameArchPool = preferredArchetype
      ? tierPool.filter((def) => getPrimaryArchetypeTag(def.tags) === preferredArchetype)
      : []
    const chosenPool = (sameArchPool.length > 0 && rng() < sameArchetypeBias) ? sameArchPool : tierPool
    const picked = chosenPool[Math.floor(rng() * chosenPool.length)] ?? tierPool[Math.floor(rng() * tierPool.length)] ?? poolBase[Math.floor(rng() * poolBase.length)]
    if (!picked) continue
    serial++
    out.push(buildEnemyRunner(picked, `E-${day}-${serial}-${picked.id}`, order[i]!, 0, '1x1', desired.tier, desired.star))
  }

  if (out.length === 0) {
    const fallback = poolBase[Math.floor(rng() * poolBase.length)] ?? seedDefs[0]
    if (!fallback) return []
    const slot = order[0] ?? 0
    out.push(buildEnemyRunner(fallback, `E-fallback-${fallback.id}`, slot, 0, '1x1', 'Bronze', 1))
  }
  return out
}

// ── 单个敌方 Runner 构建 ────────────────────────────────────

function buildEnemyRunner(
  def: ItemDef,
  id: string,
  col: number,
  row: number,
  size: ItemSizeNorm,
  tier: EnemyTier,
  star: EnemyStar,
): CombatItemRunner {
  const tierRaw = tierStarToRaw(tier, star)
  const tierStats = resolveItemTierBaseStats(def, tierRaw)
  const tierIdx = tierIndexFromRaw(def, tierRaw)
  const lines = skillLines(def)
  const ammoMax = ammoFromSkillLines(lines, tierIdx)
  const multicast = multicastFromSkillLines(lines, tierIdx, Math.max(1, Math.round(tierStats.multicast)))
  return {
    id,
    side: 'enemy',
    defId: def.id,
    baseStats: {
      cooldownMs: validCooldown(tierStats.cooldownMs),
      damage: Math.max(0, tierStats.damage),
      heal: Math.max(0, tierStats.heal),
      shield: Math.max(0, tierStats.shield),
      burn: Math.max(0, tierStats.burn),
      poison: Math.max(0, tierStats.poison),
      regen: Math.max(0, tierStats.regen),
      crit: Math.max(0, tierStats.crit),
      multicast: Math.max(1, multicast),
    },
    runtime: {
      currentChargeMs: 0,
      pendingChargeMs: 0,
      tempDamageBonus: 0,
      damageScale: 1,
      bonusMulticast: 0,
      executeCount: 0,
      ammoMax,
      ammoCurrent: ammoMax,
      modifiers: { freezeMs: 0, slowMs: 0, hasteMs: 0 },
    },
    col,
    row,
    size,
    tier: tierRaw,
    tierStar: star,
  }
}

// ── Teaching 模式敌方构建 ────────────────────────────────────

function buildEnemyTeachingRunners(
  day: number,
  snapshot: BattleSnapshotBundle,
  all: ItemDef[],
  rng: () => number,
): CombatItemRunner[] | null {
  const rules = getConfig().combatRuntime.enemyTeachingByDay ?? []
  const matched = rules.find((r) => day >= r.dayStart && day <= r.dayEnd)
  if (!matched || !matched.templates || matched.templates.length === 0) return null

  const sizeWidth = (size: ItemSizeNorm): number => (size === '1x1' ? 1 : size === '2x1' ? 2 : 3)
  const byName = new Map<string, ItemDef>()
  for (const it of all) {
    byName.set(it.id, it)
    byName.set(it.name_cn, it)
    byName.set(it.name_en, it)
  }

  const template = matched.templates[Math.floor(rng() * matched.templates.length)]
  if (!template) return null

  const occ = Array.from({ length: snapshot.activeColCount }, () => false)
  const out: CombatItemRunner[] = []
  let serial = 0

  for (const p of template.placements) {
    const def = byName.get(p.itemName)
    if (!def) continue
    const size = normalizeSize(def.size)
    const w = sizeWidth(size)
    if (p.col < 0 || p.col + w > snapshot.activeColCount) continue
    let blocked = false
    for (let k = 0; k < w; k++) if (occ[p.col + k]) blocked = true
    if (blocked) continue

    const available = parseAvailableTiers(def.available_tiers)
    const desiredTier = (p.tier ?? 'Bronze') as EnemyTier
    const tier = (available.includes(desiredTier) ? desiredTier : (available[0] ?? 'Bronze')) as EnemyTier
    const star = (tier === 'Bronze' ? 1 : (p.star === 2 ? 2 : 1)) as EnemyStar

    for (let k = 0; k < w; k++) occ[p.col + k] = true
    serial++
    out.push(buildEnemyRunner(def, `E-template-${day}-${serial}-${def.id}`, p.col, 0, size, tier, star))
  }

  return out.length > 0 ? out : null
}

// ── 按天数过滤敌方物品 ────────────────────────────────────────

function pickEnemyDefsByDay(day: number, all: ItemDef[]): ItemDef[] {
  const rules = getConfig().combatRuntime.enemyByDay ?? []
  const matched = rules.find((r) => day >= r.dayStart && day <= r.dayEnd)
  if (!matched || !matched.itemNames.length) return []
  const byName = new Map<string, ItemDef>()
  for (const it of all) {
    byName.set(it.name_cn, it)
    byName.set(it.name_en, it)
    byName.set(it.id, it)
  }
  const out: ItemDef[] = []
  for (const key of matched.itemNames) {
    const hit = byName.get(key)
    if (hit && !isNeutralItemDef(hit)) out.push(hit)
  }
  return out
}
