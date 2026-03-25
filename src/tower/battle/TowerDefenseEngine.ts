import type { BattleSnapshotBundle } from '@/tower/battle/BattleSnapshotStore'
import { EventBus } from '@/tower/core/EventBus'
import { getConfig } from '@/tower/core/DataLoader'
import { getConfig as getDebugCfg } from '@/tower/config/debugConfig'
import { CANVAS_W } from '@/tower/config/layoutConstants'
import type { CombatBoardItem, CombatItemRuntimeState, CombatResult } from '@/tower/battle/CombatEngine'
import type { CombatItemRunner } from '@/tower/battle/CombatTypes'
import { toRunner } from '@/tower/battle/EnemyBuilder'
import { findItemDef, isAdjacentByFootprint, itemArchetype, itemWidth, pickTierSeriesValue, skillLines, tierIndexFromRaw, tierValueFromLine } from '@/tower/battle/CombatHelpers'
import type { BattleEngineLike, BattleQueuePerfStats, BattleRuntimeCachePerfStats, TowerClassAttackDistanceView, TowerEnemyStatsView, TowerEnemyUnitView } from '@/tower/battle/BattleEngineTypes'

type EnemyDef = {
  id: string
  name: string
  hp: number
  attack: number
  moveSpeed: number
  attackIntervalMs: number
  attackDistance?: number
  laneOccupyCount?: number
  attackType?: string
  projectileIcon?: string
  projectileScale?: number
  projectileFlyMs?: number
  projectileReturnMs?: number
  meleeDashOutMs?: number
  meleeDashBackMs?: number
  icon: string
  enemyHpBarYOffset?: number
  enemyHpBarScale?: number
  enemyShadowYOffset?: number
  enemyShadowScale?: number
  isFlying?: boolean
}

type SpawnJob = {
  spawnAtMs: number
  enemyId: string
  isBoss: boolean
}

type PendingPlayerHit = {
  dueAtMs: number
  sourceItemId: string
  targetEnemyUnitId: string
  damage: number
  baseDamage: number
  bounceRemaining: number
  bounceHop: number
  bounceDamageBonusPerHop: number
  firstBounceSplitBonus: number
  chainedEnemyUnitIds: string[]
  projectileFlyMs: number
  projectileFromEnemyUnitId?: string
}

type PendingPlayerFire = {
  dueAtMs: number
  sourceItemId: string
}

type PendingEnemyHit = {
  dueAtMs: number
  sourceEnemyUnitId: string
  damage: number
}

type EnemyUnit = {
  id: string
  enemyId: string
  icon: string
  lane: number
  isFlying: boolean
  hp: number
  maxHp: number
  attack: number
  moveSpeed: number
  attackIntervalMs: number
  attackDistance: number
  laneOccupyCount: number
  attackType: 'melee' | 'line_projectile' | 'spin_projectile'
  projectileIcon: string
  projectileScale: number
  projectileFlyMs: number
  projectileReturnMs: number
  meleeDashOutMs: number
  meleeDashBackMs: number
  nextAttackAtMs: number
  attackCycleArmed: boolean
  prepareTriggeredForAttackAtMs: number
  distance: number
  maxDistance: number
  isBlockedByFront: boolean
  isMoving: boolean
}

const EMPTY_QUEUE_STATS: BattleQueuePerfStats = {
  pendingHits: 0,
  pendingItemFires: 0,
  pendingChargePulses: 0,
  pendingAmmoRefills: 0,
  maxPendingHits: 1,
  maxPendingItemFires: 1,
  maxPendingChargePulses: 1,
  maxPendingAmmoRefills: 1,
}

export class TowerDefenseEngine implements BattleEngineLike {
  private day = 1
  private elapsedMs = 0
  private tickIndex = 0
  private finished = false
  private result: CombatResult | null = null
  private playerHero = { id: 'hero_player', side: 'player' as const, maxHp: 100, hp: 100, shield: 0, burn: 0, poison: 0, regen: 0 }
  private enemyHero = { id: 'hero_enemy', side: 'enemy' as const, maxHp: 1, hp: 1, shield: 0, burn: 0, poison: 0, regen: 0 }
  private playerItems: CombatItemRunner[] = []
  private enemyUnits: EnemyUnit[] = []
  private spawnJobs: SpawnJob[] = []
  private nextSpawnIdx = 0
  private enemySerial = 0
  private totalWaveHp = 0
  private totalWaveHpKilled = 0
  private totalWaveCount = 0
  private waveHpMultiplier = 1
  private waveAttackMultiplier = 1
  private allEnemiesSpawnedAtMs: number | null = null
  private runtimeCalls = 0
  private runtimeCacheHits = 0
  private lastRuntimeTick = -1
  private runtimeCache: CombatItemRuntimeState[] = []
  private pendingPlayerFires: PendingPlayerFire[] = []
  private pendingPlayerHits: PendingPlayerHit[] = []
  private pendingEnemyHits: PendingEnemyHit[] = []
  private playerAttackDistanceByItemId = new Map<string, number>()
  private towerClassAttackDistances: TowerClassAttackDistanceView = { swordsman: 0, archer: 0, assassin: 0 }
  private playerUseDamageBonusByItemId = new Map<string, number>()
  private playerRangeBlockedByItemId = new Map<string, boolean>()
  private playerBounceCountByItemId = new Map<string, number>()
  private playerFirstBounceSplitBonus = 0
  private playerBounceDamageBonusPerHopByItemId = new Map<string, number>()
  private playerBounceDamageFactorByItemId = new Map<string, number>()

  start(snapshot: BattleSnapshotBundle): void {
    this.day = Math.max(1, Math.round(snapshot.day || 1))
    this.elapsedMs = 0
    this.tickIndex = 0
    this.finished = false
    this.result = null
    this.playerItems = snapshot.entities.map((it, idx) => {
      const runner = toRunner(it, `P-${idx}`)
      runner.side = 'player'
      runner.runtime.currentChargeMs = 0
      runner.runtime.pendingChargeMs = 0
      runner.runtime.modifiers.freezeMs = 0
      runner.runtime.modifiers.slowMs = 0
      runner.runtime.modifiers.hasteMs = 0
      return runner
    })
    this.applyPassiveAurasOnBattleStart()
    this.enemyUnits = []
    this.spawnJobs = []
    this.nextSpawnIdx = 0
    this.enemySerial = 0
    this.totalWaveHp = 0
    this.totalWaveHpKilled = 0
    this.totalWaveCount = 0
    this.waveHpMultiplier = 1
    this.waveAttackMultiplier = 1
    this.allEnemiesSpawnedAtMs = null
    this.runtimeCalls = 0
    this.runtimeCacheHits = 0
    this.lastRuntimeTick = -1
    this.runtimeCache = []
    this.pendingPlayerFires = []
    this.pendingPlayerHits = []
    this.pendingEnemyHits = []
    this.playerAttackDistanceByItemId.clear()
    this.playerUseDamageBonusByItemId.clear()
    this.playerRangeBlockedByItemId.clear()
    this.playerBounceCountByItemId.clear()
    this.playerFirstBounceSplitBonus = 0
    this.playerBounceDamageBonusPerHopByItemId.clear()
    this.playerBounceDamageFactorByItemId.clear()
    for (const item of this.playerItems) {
      const attackDistance = this.resolvePlayerItemAttackDistance(item)
      if (attackDistance > 0) this.playerAttackDistanceByItemId.set(item.id, attackDistance)
      const useDamageBonus = this.resolvePlayerItemUseDamageBonus(item)
      if (useDamageBonus > 0) this.playerUseDamageBonusByItemId.set(item.id, useDamageBonus)
      this.playerRangeBlockedByItemId.set(item.id, false)
    }
    this.recomputeTowerClassAttackDistances()
    this.rebuildPlayerBounceParams()

    const cfg = getConfig()
    const playerHpByDay = cfg.dailyPlayerHealth ?? cfg.dailyHealth
    const playerHpIdx = Math.max(0, Math.min(playerHpByDay.length - 1, this.day - 1))
    const playerHp = Math.max(1, Math.round(Number(snapshot.playerBattleHp ?? playerHpByDay[playerHpIdx]) || playerHpByDay[playerHpIdx] || 100))
    this.playerHero = { id: 'hero_player', side: 'player', maxHp: playerHp, hp: playerHp, shield: 0, burn: 0, poison: 0, regen: 0 }
    this.enemyHero = { id: 'hero_enemy', side: 'enemy', maxHp: 1, hp: 1, shield: 0, burn: 0, poison: 0, regen: 0 }

    this.buildSpawnPlan()
    this.refreshEnemyHeroHp()
  }

  update(dt: number): void {
    if (this.finished) return
    const dtMs = Math.max(0, dt * 1000)
    if (dtMs <= 0) return
    this.elapsedMs += dtMs
    this.tickIndex += 1

    this.spawnDueEnemies()
    this.tickEnemyMoveAndAttack(dtMs)
    this.tickPlayerItems(dtMs)
    this.consumePendingPlayerFires()
    this.consumePendingPlayerHits()
    this.consumePendingEnemyHits()
    this.cleanupDeadEnemies()
    this.refreshEnemyHeroHp()
    this.checkFinish()
  }

  getEnemySkillIds(): string[] {
    return []
  }

  getBoardState(): { player: { id: string; side: 'player' | 'enemy'; maxHp: number; hp: number; shield: number; burn: number; poison: number; regen: number }; enemy: { id: string; side: 'player' | 'enemy'; maxHp: number; hp: number; shield: number; burn: number; poison: number; regen: number }; items: CombatBoardItem[] } {
    return {
      player: { ...this.playerHero },
      enemy: { ...this.enemyHero },
      items: this.playerItems.map((it) => ({
        id: it.id,
        side: it.side,
        defId: it.defId,
        col: it.col,
        row: it.row,
        size: it.size,
        tier: it.tier,
        tierStar: it.tierStar,
        enchantment: it.enchantment,
        chargeRatio: Math.max(0, Math.min(1, it.runtime.currentChargeMs / Math.max(1, it.baseStats.cooldownMs))),
      })),
    }
  }

  getRuntimeState(): CombatItemRuntimeState[] {
    this.runtimeCalls += 1
    if (this.lastRuntimeTick === this.tickIndex) {
      this.runtimeCacheHits += 1
      return this.runtimeCache
    }
    this.runtimeCache = this.playerItems.map((it) => ({
      id: it.id,
      side: it.side,
      currentChargeMs: Math.max(0, it.runtime.currentChargeMs),
      cooldownMs: Math.max(0, Math.round(it.baseStats.cooldownMs)),
      chargePercent: Math.max(0, Math.min(1, it.runtime.currentChargeMs / Math.max(1, it.baseStats.cooldownMs))),
      executeCount: it.runtime.executeCount,
      tempDamageBonus: it.runtime.tempDamageBonus,
      ammoMax: it.runtime.ammoMax,
      ammoCurrent: it.runtime.ammoCurrent,
      ammoAutoReloadRemainingMs: it.runtime.ammoAutoReloadRemainingMs,
      freezeMs: 0,
      slowMs: 0,
      hasteMs: 0,
      damage: this.resolveSourceDamageForThisFire(it),
      heal: Math.max(0, Math.round(it.baseStats.heal)),
      shield: this.resolveRuntimeShieldDisplay(it),
      burn: 0,
      poison: 0,
      multicast: this.getPlayerItemMulticast(it),
      bounceCount: Math.max(0, Math.round(this.playerBounceCountByItemId.get(it.id) ?? 0)),
      rangeBlocked: this.playerRangeBlockedByItemId.get(it.id) === true,
    }))
    this.lastRuntimeTick = this.tickIndex
    return this.runtimeCache
  }

  private resolveRuntimeShieldDisplay(item: CombatItemRunner): number {
    if (this.getItemIcon(item) === 'item56') {
      return Math.max(0, Math.round(this.playerHero.hp))
    }
    return Math.max(0, Math.round(item.baseStats.shield))
  }

  private applyPassiveAurasOnBattleStart(): void {
    const reducedCooldownMinMs = Math.max(100, Math.round(Number(getConfig().towerDefenseRules?.reducedCooldownMinMs) || 500))
    for (const aura of this.playerItems) {
      if (this.getItemIcon(aura) === 'item46') {
        const pctBase = Math.max(0, this.resolveNumericValueFromItemLine(
          aura,
          /所有物品间隔缩短\s*([+\-]?\d+(?:\.\d+)?(?:%?[\/|][+\-]?\d+(?:\.\d+)?%?)*)\s*%?/,
        )) / 100
        if (pctBase > 0) {
          for (const target of this.playerItems) {
            if (target.baseStats.cooldownMs <= 0) continue
            const targetDef = findItemDef(target.defId)
            const isArcher = itemArchetype(targetDef) === '弓手'
            const pct = Math.min(0.95, pctBase * (isArcher ? 2 : 1))
            if (pct <= 0) continue
            target.baseStats.cooldownMs = Math.max(
              reducedCooldownMinMs,
              Math.round(target.baseStats.cooldownMs * (1 - pct)),
            )
          }
        }
        continue
      }
      const auraDef = findItemDef(aura.defId)
      if (!auraDef) continue
      const lines = skillLines(auraDef)
      if (lines.length <= 0) continue
      const tierIndex = tierIndexFromRaw(auraDef, aura.tier)
      const auraLine = lines.find((line) => /物品伤害\+/.test(line) && /弓手物品/.test(line))
      if (!auraLine) continue

      const damageMatch = auraLine.match(/物品伤害\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)/)
      const multicastMatch = auraLine.match(/弓手物品.*?\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)\s*连发次数/)
      const multicastAfterLabelMatch = auraLine.match(/弓手物品.*?连发次数\s*\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)/)
      const damageBonus = damageMatch?.[1] ? Math.max(0, Math.round(pickTierSeriesValue(damageMatch[1], tierIndex))) : 0
      const multicastSeries = multicastMatch?.[1] || multicastAfterLabelMatch?.[1] || ''
      const multicastBonus = multicastSeries ? Math.max(0, Math.round(pickTierSeriesValue(multicastSeries, tierIndex))) : 0
      if (damageBonus <= 0 && multicastBonus <= 0) continue
      const isGlobalAura = /所有物品/.test(auraLine)
      const archerDamageDouble = /弓手物品.*翻倍/.test(auraLine)
      const multicastLeftAdjacentOnly = /左侧/.test(auraLine)
      const multicastAdjacentOnly = multicastLeftAdjacentOnly || /相邻/.test(auraLine)

      for (const target of this.playerItems) {
        const targetEnd = target.col + itemWidth(target.size) - 1
        const isLeftAdjacentTarget = aura.col === targetEnd + 1
        const isAdjacentTarget = isAdjacentByFootprint(aura, target)
        if (!isGlobalAura) {
          if (target.id === aura.id) continue
          if (!isAdjacentTarget) continue
        }
        const targetDef = findItemDef(target.defId)
        if (damageBonus > 0) {
          if (target.baseStats.damage > 0) {
            const add = archerDamageDouble && itemArchetype(targetDef) === '弓手'
              ? damageBonus * 2
              : damageBonus
            target.baseStats.damage += add
          }
        }
        if (multicastBonus > 0) {
          if (multicastLeftAdjacentOnly && !isLeftAdjacentTarget) continue
          if (multicastAdjacentOnly && !isAdjacentTarget) continue
          if (itemArchetype(targetDef) === '弓手') {
            target.baseStats.multicast = Math.max(1, target.baseStats.multicast + multicastBonus)
          }
        }
      }

      const globalIntervalReduceLine = lines.find((line) => /所有物品间隔缩短/.test(line))
      if (globalIntervalReduceLine) {
        const pctMatch = globalIntervalReduceLine.match(/缩短\s*([+\-]?\d+(?:\.\d+)?(?:%?\s*[\/|]\s*[+\-]?\d+(?:\.\d+)?)*%?)\s*%?/)
        const pctSeries = (pctMatch?.[1] || '').replace(/%/g, '')
        const pctBase = pctSeries
          ? Math.max(0, pickTierSeriesValue(pctSeries, tierIndex)) / 100
          : Math.max(0, tierValueFromLine(globalIntervalReduceLine, tierIndex)) / 100
        if (pctBase > 0) {
          for (const target of this.playerItems) {
            if (target.baseStats.cooldownMs <= 0) continue
            const targetDef = findItemDef(target.defId)
            const isArcher = itemArchetype(targetDef) === '弓手'
            const pct = Math.min(0.95, pctBase * (isArcher ? 2 : 1))
            if (pct <= 0) continue
            target.baseStats.cooldownMs = Math.max(
              reducedCooldownMinMs,
              Math.round(target.baseStats.cooldownMs * (1 - pct)),
            )
          }
        }
      }
    }
  }

  getDebugState(): { tickIndex: number; playerAlive: number; enemyAlive: number; playerHp: number; enemyHp: number; inFatigue: boolean; enemySkillCount: number } {
    const aliveEnemyCount = this.enemyUnits.filter((it) => it.hp > 0).length
    const enemyAlive = (aliveEnemyCount > 0 || this.nextSpawnIdx < this.spawnJobs.length || this.enemyHero.hp > 0) ? 1 : 0
    return {
      tickIndex: this.tickIndex,
      playerAlive: this.playerHero.hp > 0 ? 1 : 0,
      enemyAlive,
      playerHp: this.playerHero.hp,
      enemyHp: this.enemyHero.hp,
      inFatigue: false,
      enemySkillCount: 0,
    }
  }

  isFinished(): boolean {
    return this.finished
  }

  getResult(): CombatResult | null {
    return this.result ? { ...this.result } : null
  }

  getQueuePerfStats(): BattleQueuePerfStats {
    return {
      ...EMPTY_QUEUE_STATS,
      pendingHits: this.pendingPlayerHits.length + this.pendingEnemyHits.length,
      pendingItemFires: this.pendingPlayerFires.length,
    }
  }

  getRuntimeCachePerfStats(): BattleRuntimeCachePerfStats {
    return {
      calls: this.runtimeCalls,
      cacheHits: this.runtimeCacheHits,
    }
  }

  getTowerEnemyUnits(): TowerEnemyUnitView[] {
    return this.enemyUnits
      .filter((it) => it.hp > 0)
      .map((it) => ({
        id: it.id,
        enemyId: it.enemyId,
        icon: it.icon,
        lane: it.lane,
        isFlying: it.isFlying,
        hp: it.hp,
        maxHp: it.maxHp,
        distance: it.distance,
        maxDistance: it.maxDistance,
        isBlockedByFront: it.isBlockedByFront,
        isMoving: it.isMoving,
      }))
  }

  getTowerEnemyStats(): TowerEnemyStatsView {
    return {
      remainingCount: this.getRemainingEnemyCount(),
      totalCount: Math.max(0, this.totalWaveCount),
    }
  }

  getTowerClassAttackDistances(): TowerClassAttackDistanceView {
    return {
      swordsman: Math.max(0, Math.round(this.towerClassAttackDistances.swordsman || 0)),
      archer: Math.max(0, Math.round(this.towerClassAttackDistances.archer || 0)),
      assassin: Math.max(0, Math.round(this.towerClassAttackDistances.assassin || 0)),
    }
  }

  private recomputeTowerClassAttackDistances(): void {
    const next: TowerClassAttackDistanceView = { swordsman: 0, archer: 0, assassin: 0 }
    for (const item of this.playerItems) {
      const distance = Math.max(0, Math.round(this.playerAttackDistanceByItemId.get(item.id) ?? 0))
      if (distance <= 0) continue
      const archetype = itemArchetype(findItemDef(item.defId))
      if (archetype === '战士') next.swordsman = Math.max(next.swordsman, distance)
      else if (archetype === '弓手') next.archer = Math.max(next.archer, distance)
      else if (archetype === '刺客') next.assassin = Math.max(next.assassin, distance)
    }
    this.towerClassAttackDistances = next
  }

  private buildSpawnPlan(): void {
    const cfg = getConfig().towerDefenseRules
    if (!cfg || cfg.enabled === false) return
    const picked = this.pickWaveByDay(cfg.dayWaves ?? [], this.day)
    if (!picked) return
    const wave = ('wave' in picked ? picked.wave : picked)
    const hpMultiplier = ('hpMultiplier' in picked ? picked.hpMultiplier : 1)
    const attackMultiplier = ('attackMultiplier' in picked ? picked.attackMultiplier : 1)
    this.waveHpMultiplier = Math.max(1, hpMultiplier)
    this.waveAttackMultiplier = Math.max(1, attackMultiplier)
    const spawnDurationMs = Math.max(100, Math.round(wave.spawnDurationMs ?? cfg.defaultSpawnDurationMs ?? 10000))
    const enemyById = new Map<string, EnemyDef>()
    for (const one of cfg.enemyDefs ?? []) {
      enemyById.set(one.id, one)
    }

    const jobs: SpawnJob[] = []
    let totalHp = 0
    let totalCount = 0
    for (const rule of wave.enemies ?? []) {
      const def = enemyById.get(rule.id)
      if (!def) continue
      const count = Math.max(0, Math.round(rule.count || 0))
      const unitHp = Math.max(1, Math.round(def.hp * this.waveHpMultiplier))
      totalCount += count
      totalHp += unitHp * count
      for (let i = 0; i < count; i++) {
        const p = count <= 1 ? 0 : (i / Math.max(1, count - 1))
        jobs.push({
          spawnAtMs: Math.round(p * spawnDurationMs),
          enemyId: def.id,
          isBoss: this.isBossEnemyDef(def),
        })
      }
    }
    jobs.sort((a, b) => {
      if (a.isBoss !== b.isBoss) return a.isBoss ? 1 : -1
      return a.spawnAtMs - b.spawnAtMs
    })
    this.spawnJobs = jobs
    this.totalWaveHp = Math.max(1, totalHp)
    this.totalWaveCount = Math.max(0, totalCount)
  }

  private spawnDueEnemies(): void {
    while (this.nextSpawnIdx < this.spawnJobs.length) {
      const one = this.spawnJobs[this.nextSpawnIdx]
      if (!one || one.spawnAtMs > this.elapsedMs) break
      const placement = this.resolveSpawnPlacement(one)
      if (!placement) break
      this.nextSpawnIdx += 1
      const unit = this.makeEnemyUnit(one.enemyId, placement.lane, placement.laneOccupyCount)
      if (!unit) continue
      this.enemyUnits.push(unit)
    }
    if (this.nextSpawnIdx >= this.spawnJobs.length && this.allEnemiesSpawnedAtMs === null) {
      this.allEnemiesSpawnedAtMs = this.elapsedMs
    }
  }

  private getEnemyAttackDoublingIntervalMs(): number {
    const cfg = getConfig().towerDefenseRules as { enemyAttackDoubleAfterAllSpawnMs?: number } | undefined
    const raw = Number(cfg?.enemyAttackDoubleAfterAllSpawnMs)
    if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.round(raw))
    return 20000
  }

  private getPostSpawnEnemyAttackMultiplier(): number {
    if (this.allEnemiesSpawnedAtMs === null) return 1
    const intervalMs = this.getEnemyAttackDoublingIntervalMs()
    if (intervalMs <= 0) return 1
    const elapsed = Math.max(0, this.elapsedMs - this.allEnemiesSpawnedAtMs)
    const rounds = Math.max(0, Math.floor(elapsed / intervalMs))
    return Math.max(1, Math.pow(2, rounds))
  }

  private isBossEnemyDef(def: EnemyDef): boolean {
    if (Math.max(1, Math.round(Number(def.laneOccupyCount) || 1)) >= 3) return true
    if (def.id.includes('boss')) return true
    return String(def.name || '').includes('首领')
  }

  private getSpawnFrontGapDistance(): number {
    const cfg = getConfig().towerDefenseRules
    if (!cfg) return 0
    const movePerSpeed = Math.max(1, Number(cfg.moveDistancePerSecAtSpeed1) || 100)
    const gapMetersRaw = Number((cfg as { spawnFrontGapDistance?: number }).spawnFrontGapDistance)
    const fallbackMeters = Math.max(0, Number((cfg as { laneEnemyMinGapDistance?: number }).laneEnemyMinGapDistance) || 2)
    const gapMeters = Math.max(0, Number.isFinite(gapMetersRaw) ? gapMetersRaw : fallbackMeters)
    return gapMeters * movePerSpeed
  }

  private getSpawnLineDistance(): number {
    const cfg = getConfig().towerDefenseRules
    return Math.max(1, Number(cfg?.levelDistance) || 1000)
  }

  private getBackDistanceForLaneIndex(laneIndex: number, lanes: number, isFlying: boolean): number {
    let backDistance = Number.NEGATIVE_INFINITY
    for (const one of this.enemyUnits) {
      if (one.hp <= 0) continue
      if (one.isFlying !== isFlying) continue
      const oneRange = this.getOccupiedLaneRange(one, lanes)
      if (laneIndex < oneRange.start || laneIndex > oneRange.end) continue
      if (one.distance > backDistance) backDistance = one.distance
    }
    return backDistance
  }

  private canSpawnAtLane(lane: number, laneOccupyCount: number, lanes: number, isFlying: boolean): boolean {
    const spawnRange = this.getLaneRangeByLaneAndOccupyCount(lane, laneOccupyCount, lanes)
    const spawnLine = this.getSpawnLineDistance()
    const requiredGap = this.getSpawnFrontGapDistance()
    for (let i = spawnRange.start; i <= spawnRange.end; i++) {
      const backDistance = this.getBackDistanceForLaneIndex(i, lanes, isFlying)
      if (!Number.isFinite(backDistance)) continue
      if (spawnLine - backDistance < requiredGap) return false
    }
    return true
  }

  private resolveSpawnPlacement(job: SpawnJob): { lane: number; laneOccupyCount: number } | null {
    const cfg = getConfig().towerDefenseRules
    if (!cfg) return null
    const def = (cfg.enemyDefs ?? []).find((it) => it.id === job.enemyId)
    if (!def) return null
    const lanes = Math.max(1, Math.round(cfg.spawnLanes || 5))
    const laneOccupyCount = this.resolveLaneOccupyCount(def, lanes)
    const isFlying = this.isEnemyDefFlying(def)
    const laneCandidates = this.getSpawnLaneCandidates(lanes, laneOccupyCount)
    for (const lane of laneCandidates) {
      if (!this.canSpawnAtLane(lane, laneOccupyCount, lanes, isFlying)) continue
      return { lane, laneOccupyCount }
    }
    return null
  }

  private makeEnemyUnit(enemyId: string, laneOverride?: number, laneOccupyOverride?: number): EnemyUnit | null {
    const cfg = getConfig().towerDefenseRules
    if (!cfg) return null
    const def = (cfg.enemyDefs ?? []).find((it) => it.id === enemyId)
    if (!def) return null
    const lanes = Math.max(1, Math.round(cfg.spawnLanes || 5))
    const laneOccupyCount = laneOccupyOverride ?? this.resolveLaneOccupyCount(def, lanes)
    this.enemySerial += 1
    const lane = laneOverride ?? this.pickSpawnLane(lanes, laneOccupyCount)
    const startDistance = this.getSpawnLineDistance()
    return {
      id: `td-enemy-${this.day}-${this.enemySerial}`,
      enemyId: def.id,
      icon: def.icon,
      lane,
      isFlying: this.isEnemyDefFlying(def),
      maxHp: Math.max(1, Math.round(def.hp * this.waveHpMultiplier)),
      hp: Math.max(1, Math.round(def.hp * this.waveHpMultiplier)),
      attack: Math.max(0, Math.round(def.attack * this.waveAttackMultiplier)),
      moveSpeed: Math.max(0, Number(def.moveSpeed) || 0),
      attackIntervalMs: Math.max(100, Math.round(def.attackIntervalMs || 1000)),
      attackDistance: Math.max(0, Number(def.attackDistance) || Number(cfg.attackDistance) || 120),
      laneOccupyCount,
      attackType: this.resolveEnemyAttackType(def),
      projectileIcon: String(def.projectileIcon || '').trim(),
      projectileScale: this.resolveEnemyProjectileScale(def),
      projectileFlyMs: this.resolveEnemyProjectileFlyMs(def),
      projectileReturnMs: this.resolveEnemyProjectileReturnMs(def),
      meleeDashOutMs: this.resolveEnemyMeleeDashOutMs(def),
      meleeDashBackMs: this.resolveEnemyMeleeDashBackMs(def),
      nextAttackAtMs: -1,
      attackCycleArmed: false,
      prepareTriggeredForAttackAtMs: -1,
      distance: startDistance,
      maxDistance: Math.max(1, Number(cfg.levelDistance) || 1000),
      isBlockedByFront: false,
      isMoving: false,
    }
  }

  private getEnemyAttackPrepareLeadMs(enemy: EnemyUnit): number {
    const interval = Math.max(100, Math.round(enemy.attackIntervalMs))
    return Math.max(120, Math.round(interval * 0.5))
  }

  private tickEnemyMoveAndAttack(dtMs: number): void {
    const cfg = getConfig().towerDefenseRules
    if (!cfg) return
    const dtSec = dtMs / 1000
    const movePerSpeed = Math.max(1, Number(cfg.moveDistancePerSecAtSpeed1) || 100)
    const minLaneGapMeters = Math.max(0, Number((cfg as { laneEnemyMinGapDistance?: number }).laneEnemyMinGapDistance) || 2)
    const minLaneGap = minLaneGapMeters * movePerSpeed
    const lanes = Math.max(1, Math.round(cfg.spawnLanes || 5))
    const aliveUnits: EnemyUnit[] = []

    for (const enemy of this.enemyUnits) {
      if (enemy.hp <= 0) continue
      enemy.isMoving = false
      aliveUnits.push(enemy)
    }

    aliveUnits.sort((a, b) => a.distance - b.distance)
    const movedUnits: EnemyUnit[] = []

    for (const enemy of aliveUnits) {
      const enemyAttackDistance = Math.max(0, enemy.attackDistance)
      let blockingReachDistance = Number.NEGATIVE_INFINITY
      const enemyRange = this.getOccupiedLaneRange(enemy, lanes)

      for (const front of movedUnits) {
        if (front.isFlying !== enemy.isFlying) continue
        const frontRange = this.getOccupiedLaneRange(front, lanes)
        if (!this.isLaneRangeOverlap(enemyRange.start, enemyRange.end, frontRange.start, frontRange.end)) continue
        const oneReach = front.distance + minLaneGap
        if (oneReach > blockingReachDistance) blockingReachDistance = oneReach
      }

      const minReachDistance = Math.max(
        enemyAttackDistance,
        Number.isFinite(blockingReachDistance) ? blockingReachDistance : enemyAttackDistance,
      )
      enemy.isBlockedByFront = Number.isFinite(blockingReachDistance) && blockingReachDistance > enemyAttackDistance

      const prevDistance = enemy.distance
      if (enemy.distance > minReachDistance) {
        const step = movePerSpeed * Math.max(0, enemy.moveSpeed) * dtSec
        enemy.distance = Math.max(minReachDistance, enemy.distance - step)
      }
      enemy.isMoving = Math.abs(enemy.distance - prevDistance) > 0.001

      movedUnits.push(enemy)
      if (enemy.distance > enemyAttackDistance) continue
      if (!enemy.attackCycleArmed) {
        enemy.attackCycleArmed = true
        enemy.nextAttackAtMs = this.elapsedMs + Math.max(100, Math.round(enemy.attackIntervalMs))
        enemy.prepareTriggeredForAttackAtMs = -1
      }
      const prepareLeadMs = this.getEnemyAttackPrepareLeadMs(enemy)
      if (enemy.prepareTriggeredForAttackAtMs !== enemy.nextAttackAtMs
        && enemy.nextAttackAtMs - this.elapsedMs <= prepareLeadMs) {
        enemy.prepareTriggeredForAttackAtMs = enemy.nextAttackAtMs
        EventBus.emit('battle:tower_enemy_attack_prepare', {
          enemyUnitId: enemy.id,
          prepareLeadMs,
        })
      }
      if (this.elapsedMs < enemy.nextAttackAtMs) continue
      enemy.prepareTriggeredForAttackAtMs = -1
      enemy.nextAttackAtMs = this.elapsedMs + enemy.attackIntervalMs
      this.emitEnemyAttackFire(enemy)
      this.enqueueEnemyDamageHit(enemy)
      if (this.playerHero.hp <= 0) return
    }
  }

  private resolveEnemyAttackType(def: EnemyDef): 'melee' | 'line_projectile' | 'spin_projectile' {
    const raw = String((def as { attackType?: string }).attackType || '').trim()
    if (raw.includes('旋转')) return 'spin_projectile'
    if (raw.includes('直线') || raw.includes('远程')) return 'line_projectile'
    return 'melee'
  }

  private isEnemyDefFlying(def: EnemyDef): boolean {
    if (def.isFlying === true) return true
    return def.id === 'enemy4' || def.id === 'enemy12'
  }

  private resolveEnemyProjectileFlyMs(def: EnemyDef): number {
    const raw = Number((def as { projectileFlyMs?: number }).projectileFlyMs)
    if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.round(raw))
    const type = this.resolveEnemyAttackType(def)
    if (type === 'spin_projectile') return Math.max(1, Math.round(this.getPlayerProjectileFlyMs() * 2))
    return this.getPlayerProjectileFlyMs()
  }

  private resolveEnemyProjectileScale(def: EnemyDef): number {
    const raw = Number((def as { projectileScale?: number }).projectileScale)
    if (!Number.isFinite(raw)) return 1
    return Math.max(0.1, raw)
  }

  private resolveEnemyProjectileReturnMs(def: EnemyDef): number {
    const raw = Number((def as { projectileReturnMs?: number }).projectileReturnMs)
    if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.round(raw))
    return 500
  }

  private resolveEnemyMeleeDashOutMs(def: EnemyDef): number {
    const raw = Number((def as { meleeDashOutMs?: number }).meleeDashOutMs)
    if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.round(raw))
    return 140
  }

  private resolveEnemyMeleeDashBackMs(def: EnemyDef): number {
    const raw = Number((def as { meleeDashBackMs?: number }).meleeDashBackMs)
    if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.round(raw))
    return 220
  }

  private emitEnemyAttackFire(enemy: EnemyUnit): void {
    EventBus.emit('battle:item_fire', {
      itemId: enemy.enemyId,
      sourceItemId: enemy.id,
      side: 'enemy',
      multicast: 1,
      targetId: this.playerHero.id,
      targetSide: 'player',
      attackType: enemy.attackType,
      projectileIcon: enemy.projectileIcon || undefined,
      projectileScale: enemy.projectileScale,
      projectileStyle: enemy.attackType === 'spin_projectile' ? 'spin' : 'linear',
      projectileFlyMs: enemy.projectileFlyMs,
      projectileReturnMs: enemy.projectileReturnMs,
      meleeDashOutMs: enemy.meleeDashOutMs,
      meleeDashBackMs: enemy.meleeDashBackMs,
    })
  }

  private enqueueEnemyDamageHit(enemy: EnemyUnit): void {
    const panel = Math.max(0, Math.round(enemy.attack * this.getPostSpawnEnemyAttackMultiplier()))
    if (panel <= 0) return
    const hitDelay = enemy.attackType === 'melee'
      ? Math.max(1, enemy.meleeDashOutMs)
      : Math.max(1, enemy.projectileFlyMs)
    this.pendingEnemyHits.push({
      dueAtMs: this.elapsedMs + hitDelay,
      sourceEnemyUnitId: enemy.id,
      damage: panel,
    })
  }

  private consumePendingEnemyHits(): void {
    if (this.pendingEnemyHits.length <= 0) return
    const due: PendingEnemyHit[] = []
    const pending: PendingEnemyHit[] = []
    for (const one of this.pendingEnemyHits) {
      if (one.dueAtMs <= this.elapsedMs) due.push(one)
      else pending.push(one)
    }
    this.pendingEnemyHits = pending
    for (const one of due) {
      if (this.playerHero.hp <= 0) return
      const source = this.enemyUnits.find((it) => it.id === one.sourceEnemyUnitId && it.hp > 0)
      if (!source) continue
      this.applyEnemyDamageToPlayer(source, one.damage)
      if (this.finished) return
    }
  }

  private resolveLaneOccupyCount(def: EnemyDef, lanes: number): number {
    const want = Math.max(1, Math.round(Number(def.laneOccupyCount) || 1))
    return Math.max(1, Math.min(lanes, want))
  }

  private pickSpawnLane(lanes: number, laneOccupyCount: number): number {
    if (laneOccupyCount <= 1 || lanes <= 1) return this.enemySerial % lanes
    const half = Math.floor(laneOccupyCount / 2)
    const minCenter = half
    const maxCenter = Math.max(minCenter, lanes - 1 - half)
    const centerCount = Math.max(1, maxCenter - minCenter + 1)
    return minCenter + (this.enemySerial % centerCount)
  }

  private getSpawnLaneCandidates(lanes: number, laneOccupyCount: number): number[] {
    if (lanes <= 1) return [0]
    if (laneOccupyCount <= 1) {
      const out: number[] = []
      const start = ((this.enemySerial % lanes) + lanes) % lanes
      for (let i = 0; i < lanes; i++) {
        out.push((start + i) % lanes)
      }
      return out
    }
    const half = Math.floor(laneOccupyCount / 2)
    const minCenter = half
    const maxCenter = Math.max(minCenter, lanes - 1 - half)
    const centerCount = Math.max(1, maxCenter - minCenter + 1)
    const out: number[] = []
    const start = ((this.enemySerial % centerCount) + centerCount) % centerCount
    for (let i = 0; i < centerCount; i++) {
      out.push(minCenter + ((start + i) % centerCount))
    }
    return out
  }

  private getOccupiedLaneRange(unit: EnemyUnit, lanes: number): { start: number; end: number } {
    return this.getLaneRangeByLaneAndOccupyCount(unit.lane, unit.laneOccupyCount, lanes)
  }

  private getLaneRangeByLaneAndOccupyCount(lane: number, laneOccupyCount: number, lanes: number): { start: number; end: number } {
    const occupy = Math.max(1, Math.min(lanes, Math.round(laneOccupyCount || 1)))
    if (occupy <= 1) {
      const safeLane = Math.max(0, Math.min(lanes - 1, Math.round(lane)))
      return { start: safeLane, end: safeLane }
    }
    const half = Math.floor(occupy / 2)
    let start = Math.round(lane) - half
    let end = start + occupy - 1
    if (start < 0) {
      end += -start
      start = 0
    }
    if (end > lanes - 1) {
      const over = end - (lanes - 1)
      start = Math.max(0, start - over)
      end = lanes - 1
    }
    return { start, end }
  }

  private isLaneRangeOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    return aStart <= bEnd && bStart <= aEnd
  }

  private tickPlayerItems(dtMs: number): void {
    const hasAliveEnemy = this.enemyUnits.some((it) => it.hp > 0)
    for (const item of this.playerItems) {
      this.playerRangeBlockedByItemId.set(item.id, false)
      if (item.baseStats.cooldownMs <= 0) continue
      item.runtime.currentChargeMs += dtMs
      const cooldown = Math.max(1, item.baseStats.cooldownMs)
      const attackDistance = this.playerAttackDistanceByItemId.get(item.id)
      let triggerCount = Math.floor(item.runtime.currentChargeMs / cooldown)
      if (triggerCount <= 0) continue
      if (triggerCount > 4) triggerCount = 4
      for (let i = 0; i < triggerCount; i++) {
        const attackType = this.resolvePlayerAttackType(item)
        if (attackType === 'melee_sweep') {
          if (!hasAliveEnemy) break
          item.runtime.currentChargeMs -= cooldown
          item.runtime.executeCount += 1
          const multicast = this.getPlayerItemMulticast(item)
          EventBus.emit('battle:item_trigger', {
            itemId: item.defId,
            sourceItemId: item.id,
            side: 'player',
            triggerCount: 1,
            multicast,
            extraTriggered: false,
          })
          this.enqueuePlayerFireBurst(item.id, multicast)
          const shieldGain = Math.max(0, Math.round(item.baseStats.shield))
          if (shieldGain > 0 && this.playerHero.hp > 0) {
            this.gainPlayerShield(item.id, shieldGain)
          }
          const heal = Math.max(0, Math.round(item.baseStats.heal))
          if (heal > 0 && this.playerHero.hp > 0) {
            const realHeal = Math.max(0, Math.min(this.playerHero.maxHp - this.playerHero.hp, heal))
            if (realHeal > 0) {
              this.playerHero.hp += realHeal
              EventBus.emit('battle:heal', {
                targetId: this.playerHero.id,
                sourceItemId: item.id,
                amount: realHeal,
                isRegen: false,
                targetType: 'hero',
                targetSide: 'player',
                sourceType: 'item',
                sourceSide: 'player',
              })
            }
          }
          continue
        }
        const target = this.pickNearestEnemy(attackDistance)
        if (!target) {
          if (hasAliveEnemy) this.playerRangeBlockedByItemId.set(item.id, true)
          break
        }
        item.runtime.currentChargeMs -= cooldown
        item.runtime.executeCount += 1
        const multicast = this.getPlayerItemMulticast(item)

        EventBus.emit('battle:item_trigger', {
          itemId: item.defId,
          sourceItemId: item.id,
          side: 'player',
          triggerCount: 1,
          multicast,
          extraTriggered: false,
        })

        this.enqueuePlayerFireBurst(item.id, multicast)

        const shieldGain = Math.max(0, Math.round(item.baseStats.shield))
        if (shieldGain > 0 && this.playerHero.hp > 0) {
          this.gainPlayerShield(item.id, shieldGain)
        }
        const heal = Math.max(0, Math.round(item.baseStats.heal))
        if (heal > 0 && this.playerHero.hp > 0) {
          const realHeal = Math.max(0, Math.min(this.playerHero.maxHp - this.playerHero.hp, heal))
          if (realHeal > 0) {
            this.playerHero.hp += realHeal
            EventBus.emit('battle:heal', {
              targetId: this.playerHero.id,
              sourceItemId: item.id,
              amount: realHeal,
              isRegen: false,
              targetType: 'hero',
              targetSide: 'player',
              sourceType: 'item',
              sourceSide: 'player',
            })
          }
        }
      }
      if (item.runtime.currentChargeMs > cooldown) item.runtime.currentChargeMs = cooldown
    }
  }

  private getPlayerItemMulticast(item: CombatItemRunner): number {
    const baseMulticast = Math.max(1, Math.round(item.baseStats.multicast || 1))
    if (this.getItemIcon(item) !== 'item6') return baseMulticast
    const bounceCount = Math.max(0, Math.round(this.playerBounceCountByItemId.get(item.id) ?? 0))
    if (bounceCount <= 0) return baseMulticast
    return Math.max(baseMulticast, 3)
  }

  private resolveFinalShotDamage(source: CombatItemRunner, target: EnemyUnit, baseDamage: number, attackDistance?: number): number {
    let out = Math.max(0, Math.round(baseDamage))
    if (out <= 0) return 0
    if (this.getItemIcon(source) === 'item20') {
      const maxDistance = Math.max(4, Number(attackDistance) || 36)
      const clamped = Math.max(4, Math.min(maxDistance, Number(target.distance) || 0))
      const p = maxDistance <= 4 ? 1 : (clamped - 4) / (maxDistance - 4)
      const mul = 1 + 2 * Math.max(0, Math.min(1, p))
      out = Math.max(0, Math.round(out * mul))
    }
    return out
  }

  private resolvePlayerItemAttackDistance(item: CombatItemRunner): number {
    const cfg = getConfig().towerDefenseRules
    const meterToDistance = Math.max(1, Number(cfg?.moveDistancePerSecAtSpeed1) || 1)
    const def = findItemDef(item.defId)
    const byIcon = cfg?.playerItemAttackDistanceByIcon
    const iconKey = String(def?.icon || '').trim()
    let baseDistance = 0
    if (byIcon && iconKey) {
      const raw = Number(byIcon[iconKey])
      if (Number.isFinite(raw) && raw > 0) baseDistance = raw * meterToDistance
    }
    if (baseDistance <= 0 && def) {
      const lines = skillLines(def)
      if (lines.length > 0) {
        const tierIndex = tierIndexFromRaw(def, item.tier)
        for (const line of lines) {
          const m = line.match(/攻击距离\s*[:：]\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)/)
          if (!m?.[1]) continue
          const value = pickTierSeriesValue(m[1], tierIndex)
          if (Number.isFinite(value) && value > 0) {
            baseDistance = value * meterToDistance
            break
          }
        }
      }
    }
    if (baseDistance <= 0) return 0
    if (this.resolvePlayerAttackType(item) !== 'melee_sweep') return baseDistance
    let rangeBonusMeters = 0
    for (const one of this.playerItems) {
      if (this.getItemIcon(one) !== 'item50') continue
      rangeBonusMeters += Math.max(0, this.resolveNumericValueFromItemLine(one, /所有近战武器攻击范围\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)/))
    }
    return Math.max(0, Math.round(baseDistance + rangeBonusMeters * meterToDistance))
  }

  private resolvePlayerItemUseDamageBonus(item: CombatItemRunner): number {
    const def = findItemDef(item.defId)
    if (!def) return 0
    const lines = skillLines(def)
    if (lines.length <= 0) return 0
    const tierIndex = tierIndexFromRaw(def, item.tier)
    for (const line of lines) {
      const m = line.match(/(?:每次)?使用(?:后|时)伤害\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)/)
      if (!m?.[1]) continue
      const value = Math.round(pickTierSeriesValue(m[1], tierIndex))
      if (Number.isFinite(value) && value > 0) return value
    }
    return 0
  }

  private getItemIcon(item: CombatItemRunner): string {
    return String(findItemDef(item.defId)?.icon || '').trim()
  }

  private resolvePlayerAttackType(item: CombatItemRunner): 'melee_sweep' | 'line_projectile' | 'spin_projectile' {
    const style = String(findItemDef(item.defId)?.attack_style || '').trim()
    if (style.includes('近战') || style.includes('挥动')) return 'melee_sweep'
    if (style.includes('旋转')) return 'spin_projectile'
    if (style.includes('直线')) return 'line_projectile'
    return 'line_projectile'
  }

  private isAssassinDamageItem(item: CombatItemRunner): boolean {
    if (item.baseStats.damage <= 0) return false
    const def = findItemDef(item.defId)
    return itemArchetype(def) === '刺客'
  }

  private resolveTieredValueFromItem(item: CombatItemRunner, regex: RegExp): number {
    const def = findItemDef(item.defId)
    if (!def) return 0
    const line = skillLines(def).find((it) => regex.test(it))
    if (!line) return 0
    const tierIdx = tierIndexFromRaw(def, item.tier)
    const value = Math.round(tierValueFromLine(line, tierIdx))
    return Number.isFinite(value) ? value : 0
  }

  private resolveNumericValueFromItemLine(item: CombatItemRunner, regex: RegExp): number {
    const def = findItemDef(item.defId)
    if (!def) return 0
    const line = skillLines(def).find((it) => regex.test(it))
    if (!line) return 0
    const m = line.match(regex)
    if (!m?.[1]) return 0
    const raw = String(m[1]).trim()
    if (!raw) return 0
    let value = 0
    if (raw.includes('/') || raw.includes('|')) {
      const tierIdx = tierIndexFromRaw(def, item.tier)
      value = pickTierSeriesValue(raw, tierIdx)
    } else {
      value = Number(raw.replace(/^\+/, '').replace(/%$/u, ''))
    }
    return Number.isFinite(value) ? value : 0
  }

  private addChargeToItem(item: CombatItemRunner, gainMs: number): void {
    const gain = Math.max(0, Math.round(gainMs))
    if (gain <= 0) return
    const cooldown = Math.max(1, Math.round(item.baseStats.cooldownMs || 1))
    item.runtime.currentChargeMs = Math.min(cooldown, item.runtime.currentChargeMs + gain)
  }

  private getPlayerItemsByIcon(icon: string): CombatItemRunner[] {
    if (!icon) return []
    return this.playerItems.filter((it) => this.getItemIcon(it) === icon)
  }

  private onPlayerGainShield(): void {
    for (const charger of this.getPlayerItemsByIcon('item52')) {
      const sec = this.resolveNumericValueFromItemLine(charger, /获得护盾时为此物品充能\s*([+\-]?\d+(?:\.\d+)?)\s*秒/)
      const chargeMs = Math.max(0, Math.round((sec > 0 ? sec : 2) * 1000))
      this.addChargeToItem(charger, chargeMs)
    }
  }

  private gainPlayerShield(sourceItemId: string, amountRaw: number): void {
    const amount = Math.max(0, Math.round(amountRaw))
    if (amount <= 0 || this.playerHero.hp <= 0) return
    this.playerHero.shield += amount
    EventBus.emit('battle:gain_shield', {
      targetId: this.playerHero.id,
      sourceItemId,
      amount,
      targetType: 'hero',
      targetSide: 'player',
      sourceType: 'item',
      sourceSide: 'player',
    })
    this.onPlayerGainShield()
  }

  private applyPostItemUseEffects(source: CombatItemRunner): void {
    const icon = this.getItemIcon(source)
    if (icon === 'item2') {
      const meleeBonus = Math.max(0, Math.round(this.resolveNumericValueFromItemLine(source, /每次使用后近战武器伤害\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)/)))
      if (meleeBonus > 0) {
        for (const one of this.playerItems) {
          if (this.resolvePlayerAttackType(one) !== 'melee_sweep') continue
          if (one.baseStats.damage <= 0) continue
          one.baseStats.damage += meleeBonus
        }
      }
    }
    if (icon === 'item7') {
      const bonus = Math.max(0, Math.round(this.resolveNumericValueFromItemLine(source, /每次使用后护盾\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)/)))
      if (bonus > 0) source.baseStats.shield += bonus
    }
    if (icon === 'item15') {
      // 手雷翻倍改为“每次发射后”处理，见 applyPostPlayerFireEffects
    }
    if (icon === 'item13') {
      const shieldBonus = Math.max(0, Math.round(this.resolveNumericValueFromItemLine(source, /所有护盾物品\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)\s*护盾/)))
      const chargeSec = this.resolveNumericValueFromItemLine(source, /充能\s*([+\-]?\d+(?:\.\d+)?)\s*秒/)
      const chargeMs = Math.max(0, Math.round((chargeSec > 0 ? chargeSec : 1) * 1000))
      for (const one of this.playerItems) {
        if (one.baseStats.shield <= 0) continue
        if (shieldBonus > 0) one.baseStats.shield += shieldBonus
        this.addChargeToItem(one, chargeMs)
      }
    }
    if (icon === 'item56') {
      this.gainPlayerShield(source.id, this.playerHero.hp)
    }
    const sourceArchetype = itemArchetype(findItemDef(source.defId))
    if (sourceArchetype === '战士') {
      for (const dragonHeart of this.getPlayerItemsByIcon('item56')) {
        const sec = this.resolveNumericValueFromItemLine(dragonHeart, /使用战士物品时充能\s*([+\-]?\d+(?:\.\d+)?)\s*秒/)
        const chargeMs = Math.max(0, Math.round((sec > 0 ? sec : 1) * 1000))
        this.addChargeToItem(dragonHeart, chargeMs)
      }
    }
  }

  private applyPostPlayerFireEffects(source: CombatItemRunner): void {
    if (this.getItemIcon(source) === 'item15') {
      source.baseStats.damage = Math.max(0, Math.round(source.baseStats.damage * 2))
    }
    if (this.getItemIcon(source) !== 'item48') return
    const reduced = Math.round(source.baseStats.cooldownMs * 0.98)
    source.baseStats.cooldownMs = Math.max(500, reduced)
    if (source.runtime.currentChargeMs > source.baseStats.cooldownMs) {
      source.runtime.currentChargeMs = source.baseStats.cooldownMs
    }
  }

  private applyPostPlayerDamageEffects(source: CombatItemRunner, damageRaw: number): void {
    const damage = Math.max(0, Math.round(damageRaw))
    if (damage <= 0) return
    const sourceIcon = this.getItemIcon(source)
    if (sourceIcon === 'item18') {
      const heal = Math.max(0, Math.min(this.playerHero.maxHp - this.playerHero.hp, damage))
      if (heal > 0 && this.playerHero.hp > 0) {
        this.playerHero.hp += heal
        EventBus.emit('battle:heal', {
          targetId: this.playerHero.id,
          sourceItemId: source.id,
          amount: heal,
          isRegen: false,
          targetType: 'hero',
          targetSide: 'player',
          sourceType: 'item',
          sourceSide: 'player',
        })
      }
    }
    for (const king of this.getPlayerItemsByIcon('item40')) {
      const plus = Math.max(0, Math.round(this.resolveNumericValueFromItemLine(king, /造成任意伤害时此物品伤害\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)/)))
      if (plus > 0) king.baseStats.damage += plus
    }
    for (const scythe of this.getPlayerItemsByIcon('item18')) {
      const sec = this.resolveNumericValueFromItemLine(scythe, /造成任意伤害时充能\s*([+\-]?\d+(?:\.\d+)?)\s*秒/)
      const chargeMs = Math.max(0, Math.round((sec > 0 ? sec : 0.5) * 1000))
      this.addChargeToItem(scythe, chargeMs)
    }
  }

  private applySpikeShieldReflect(attacker: EnemyUnit, shieldBeforeHit: number): void {
    const shieldNow = Math.max(0, Math.round(shieldBeforeHit))
    if (shieldNow <= 0) return
    const spikedShields = this.getPlayerItemsByIcon('item14')
    if (spikedShields.length <= 0) return
    let totalPct = 0
    for (const one of spikedShields) {
      totalPct += Math.max(0, this.resolveNumericValueFromItemLine(one, /当前护盾值\*\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)\s*%/))
    }
    if (totalPct <= 0) return
    const reflectDamage = Math.max(0, Math.round(shieldNow * totalPct / 100))
    if (reflectDamage <= 0) return
    const source = spikedShields[0]
    if (!source || attacker.hp <= 0) return
    this.applyPlayerDamageToEnemy(source, attacker, reflectDamage)
  }

  private rebuildPlayerBounceParams(): void {
    this.playerBounceCountByItemId.clear()
    this.playerFirstBounceSplitBonus = 0
    this.playerBounceDamageBonusPerHopByItemId.clear()
    this.playerBounceDamageFactorByItemId.clear()

    const cfg = getConfig().towerDefenseRules
    const baseBounceByIcon = cfg?.playerItemBaseBounceByIcon
    const baseBounceByItemId = new Map<string, number>()

    for (const item of this.playerItems) {
      const icon = this.getItemIcon(item)
      const raw = Number(baseBounceByIcon?.[icon])
      const base = Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0
      baseBounceByItemId.set(item.id, base)
      this.playerBounceCountByItemId.set(item.id, base)
      this.playerBounceDamageBonusPerHopByItemId.set(item.id, 0)
      this.playerBounceDamageFactorByItemId.set(item.id, this.isAssassinDamageItem(item) ? 0.75 : 1)
    }

    let globalAssassinExtraBounce = 0
    let globalBoomerangExtraBounce = 0
    for (const item of this.playerItems) {
      const icon = this.getItemIcon(item)
      if (icon === 'item24') {
        globalAssassinExtraBounce += Math.max(0, this.resolveTieredValueFromItem(item, /额外\+\d+(?:[\/|]\+\d+)*弹射次数/))
      }
      if (icon === 'item17') {
        this.playerFirstBounceSplitBonus += Math.max(0, this.resolveTieredValueFromItem(item, /首次弹射时[，,]?分裂数量\+\d+/))
      }
      if (icon === 'item21') {
        for (const ally of this.playerItems) {
          if (!this.isAssassinDamageItem(ally)) continue
          this.playerBounceDamageFactorByItemId.set(ally.id, 1)
        }
        const bonus = Math.max(0, this.resolveTieredValueFromItem(item, /每次弹射伤害(?:额外)?\+\d+(?:[\/|]\+?\d+)*/))
        if (bonus > 0) {
          for (const ally of this.playerItems) {
            if (!this.isAssassinDamageItem(ally)) continue
            const now = this.playerBounceDamageBonusPerHopByItemId.get(ally.id) ?? 0
            this.playerBounceDamageBonusPerHopByItemId.set(ally.id, now + bonus)
          }
        }
      }
      if (icon === 'item11') {
        globalBoomerangExtraBounce += Math.max(0, this.resolveTieredValueFromItem(item, /回旋镖弹射次数\+\d+(?:[\/|]\+?\d+)*/))
      }
    }

    if (globalAssassinExtraBounce > 0) {
      for (const item of this.playerItems) {
        if (!this.isAssassinDamageItem(item)) continue
        const now = this.playerBounceCountByItemId.get(item.id) ?? 0
        this.playerBounceCountByItemId.set(item.id, now + globalAssassinExtraBounce)
      }
    }

    if (globalBoomerangExtraBounce > 0) {
      for (const item of this.playerItems) {
        if (this.getItemIcon(item) !== 'item11') continue
        const now = this.playerBounceCountByItemId.get(item.id) ?? 0
        this.playerBounceCountByItemId.set(item.id, now + globalBoomerangExtraBounce)
      }
    }

    for (const source of this.playerItems) {
      if (this.getItemIcon(source) !== 'item5') continue
      for (const ally of this.playerItems) {
        if (!this.isAssassinDamageItem(ally)) continue
        const now = this.playerBounceCountByItemId.get(ally.id) ?? 0
        this.playerBounceCountByItemId.set(ally.id, now + 1)
      }
    }

    for (const item of this.playerItems) {
      const total = Math.max(0, this.playerBounceCountByItemId.get(item.id) ?? (baseBounceByItemId.get(item.id) ?? 0))
      this.playerBounceCountByItemId.set(item.id, total)
    }
  }

  private pickNearestEnemy(maxDistance?: number): EnemyUnit | null {
    let hit: EnemyUnit | null = null
    const useRange = typeof maxDistance === 'number' && Number.isFinite(maxDistance) && maxDistance > 0
    for (const enemy of this.enemyUnits) {
      if (enemy.hp <= 0) continue
      if (useRange && enemy.distance > maxDistance) continue
      if (!hit || enemy.distance < hit.distance) hit = enemy
    }
    return hit
  }

  private buildPredictedEnemyHpById(): Map<string, number> {
    const out = new Map<string, number>()
    for (const enemy of this.enemyUnits) {
      if (enemy.hp <= 0) continue
      out.set(enemy.id, Math.max(0, enemy.hp))
    }
    for (const one of this.pendingPlayerHits) {
      const left = out.get(one.targetEnemyUnitId)
      if (typeof left !== 'number') continue
      out.set(one.targetEnemyUnitId, Math.max(0, left - Math.max(0, Math.round(one.damage || 0))))
    }
    return out
  }

  private pickNearestEnemyByPredictedHp(predictedHpById: Map<string, number>, maxDistance?: number): EnemyUnit | null {
    let hit: EnemyUnit | null = null
    const useRange = typeof maxDistance === 'number' && Number.isFinite(maxDistance) && maxDistance > 0
    for (const enemy of this.enemyUnits) {
      const hpLeft = predictedHpById.get(enemy.id)
      if (typeof hpLeft !== 'number' || hpLeft <= 0) continue
      if (useRange && enemy.distance > maxDistance) continue
      if (!hit || enemy.distance < hit.distance) hit = enemy
    }
    return hit
  }

  private pickMeleeSweepTargetsByPredictedHp(predictedHpById: Map<string, number>, maxDistance?: number): EnemyUnit[] {
    const useRange = typeof maxDistance === 'number' && Number.isFinite(maxDistance) && maxDistance > 0
    const out = this.enemyUnits.filter((enemy) => {
      const hpLeft = predictedHpById.get(enemy.id)
      if (typeof hpLeft !== 'number' || hpLeft <= 0) return false
      if (useRange && enemy.distance > maxDistance) return false
      return true
    })
    out.sort((a, b) => {
      if (a.lane !== b.lane) return a.lane - b.lane
      if (a.distance !== b.distance) return a.distance - b.distance
      return a.id.localeCompare(b.id)
    })
    return out
  }

  private getPlayerMeleeSweepHitStepMs(): number {
    const cfg = getConfig().towerDefenseRules
    const raw = Number(cfg?.playerMeleeSweepHitStepMs)
    if (Number.isFinite(raw) && raw >= 0) return Math.max(0, Math.round(raw))
    return 30
  }

  private getPlayerProjectileFlyMs(): number {
    const minRaw = Math.max(1, Math.round(Number(getDebugCfg('battleProjectileFlyMsMin')) || 1))
    const maxRaw = Math.max(1, Math.round(Number(getDebugCfg('battleProjectileFlyMsMax')) || 1))
    const minMs = Math.min(minRaw, maxRaw)
    const maxMs = Math.max(minRaw, maxRaw)
    return Math.round((minMs + maxMs) * 0.5)
  }

  private getPlayerBounceProjectileFlyMs(defaultFlyMs: number): number {
    const cfg = getConfig().towerDefenseRules
    const raw = Number(cfg?.playerBounceProjectileFlyMs)
    if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.round(raw))
    return Math.max(1, Math.round(defaultFlyMs))
  }

  private getPlayerBounceProjectileSpeedPxPerSec(): number {
    const cfg = getConfig().towerDefenseRules
    const raw = Number(cfg?.playerBounceProjectileSpeedPxPerSec)
    if (Number.isFinite(raw) && raw > 0) return raw
    return 0
  }

  private estimateEnemyScreenPos(enemy: EnemyUnit): { x: number; y: number } {
    const cfg = getConfig().towerDefenseRules
    const farY = Number(cfg?.farY) || 320
    const nearY = Number(cfg?.nearY) || 940
    const maxDistance = Math.max(1, Number(cfg?.levelDistance) || 1000)
    const lanes = Math.max(1, Math.round(cfg?.spawnLanes || 5))
    const farWidthRatio = Math.max(0.1, Math.min(1.2, Number(cfg?.roadFarWidthRatio) || 0.5))
    const nearWidthRatio = Math.max(0.2, Math.min(1.4, Number(cfg?.roadNearWidthRatio) || 1))
    const roadFarCenterX = Number(cfg?.roadFarCenterX) || CANVAS_W / 2
    const roadNearCenterX = Number(cfg?.roadNearCenterX) || CANVAS_W / 2
    const laneP = ((enemy.lane % lanes) + lanes) % lanes
    const progress = Math.max(0, Math.min(1, 1 - enemy.distance / Math.max(1, enemy.maxDistance || maxDistance)))
    const laneNorm = lanes <= 1 ? 0 : (laneP / Math.max(1, lanes - 1)) * 2 - 1
    const roadWidthRatio = farWidthRatio + (nearWidthRatio - farWidthRatio) * progress
    const roadCenterX = roadFarCenterX + (roadNearCenterX - roadFarCenterX) * progress
    return {
      x: roadCenterX + laneNorm * (CANVAS_W * roadWidthRatio * 0.5),
      y: farY + (nearY - farY) * progress,
    }
  }

  private getBounceFlightMs(fromEnemy: EnemyUnit, toEnemy: EnemyUnit, defaultFlyMs: number): number {
    const speedPxPerSec = this.getPlayerBounceProjectileSpeedPxPerSec()
    if (speedPxPerSec > 0) {
      const from = this.estimateEnemyScreenPos(fromEnemy)
      const to = this.estimateEnemyScreenPos(toEnemy)
      const dist = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y))
      return Math.max(1, Math.round((dist / speedPxPerSec) * 1000))
    }
    return this.getPlayerBounceProjectileFlyMs(defaultFlyMs)
  }

  private getLogicTickMs(): number {
    return Math.max(1, Math.round(Number(getConfig().combatRuntime.tickMs) || 100))
  }

  private enqueuePlayerFireBurst(sourceItemId: string, repeatCount: number): void {
    const count = Math.max(1, Math.round(repeatCount || 1))
    const stepMs = this.getLogicTickMs()
    for (let i = 0; i < count; i++) {
      this.pendingPlayerFires.push({
        dueAtMs: this.elapsedMs + i * stepMs,
        sourceItemId,
      })
    }
  }

  private consumePendingPlayerFires(): void {
    if (this.pendingPlayerFires.length <= 0) return
    const due: PendingPlayerFire[] = []
    const pending: PendingPlayerFire[] = []
    for (const one of this.pendingPlayerFires) {
      if (one.dueAtMs <= this.elapsedMs) due.push(one)
      else pending.push(one)
    }
    this.pendingPlayerFires = pending
    const predictedHpById = this.buildPredictedEnemyHpById()
    for (const one of due) {
      const source = this.playerItems.find((it) => it.id === one.sourceItemId)
      if (!source) continue
      const attackDistance = this.playerAttackDistanceByItemId.get(source.id)
      const attackType = this.resolvePlayerAttackType(source)
      const damage = this.resolveSourceDamageForThisFire(source)
      if (damage <= 0) {
        this.applyPostItemUseEffects(source)
        this.applyPostPlayerFireEffects(source)
        const useDamageBonus = this.playerUseDamageBonusByItemId.get(source.id)
        if (useDamageBonus && useDamageBonus > 0) {
          source.baseStats.damage += useDamageBonus
        }
        continue
      }

      if (attackType === 'melee_sweep') {
        const sweepTargets = this.pickMeleeSweepTargetsByPredictedHp(predictedHpById, attackDistance)
        const hitStepMs = this.getPlayerMeleeSweepHitStepMs()
        EventBus.emit('battle:item_fire', {
          itemId: source.defId,
          sourceItemId: source.id,
          side: 'player',
          multicast: 1,
          targetId: sweepTargets[0]?.id,
          targetSide: 'enemy',
          attackType: 'melee_sweep',
          attackDistance,
        })
        if (sweepTargets.length <= 0) {
          this.applyPostItemUseEffects(source)
          this.applyPostPlayerFireEffects(source)
          const useDamageBonus = this.playerUseDamageBonusByItemId.get(source.id)
          if (useDamageBonus && useDamageBonus > 0) {
            source.baseStats.damage += useDamageBonus
          }
          continue
        }
        const laneOrder = [...new Set(sweepTargets.map((it) => it.lane))].sort((a, b) => a - b)
        const laneDelayByLane = new Map<number, number>()
        for (let i = 0; i < laneOrder.length; i++) {
          const lane = laneOrder[i]!
          laneDelayByLane.set(lane, (i + 1) * hitStepMs)
        }
        for (let idx = 0; idx < sweepTargets.length; idx++) {
          const target = sweepTargets[idx]!
          const hitDelayMs = Math.max(0, laneDelayByLane.get(target.lane) ?? ((idx + 1) * hitStepMs))
          this.enqueuePlayerDamageHit({
            sourceItemId: source.id,
            targetEnemyUnitId: target.id,
            damage,
            baseDamage: damage,
            bounceRemaining: 0,
            bounceHop: 0,
            bounceDamageBonusPerHop: 0,
            firstBounceSplitBonus: 0,
            chainedEnemyUnitIds: [target.id],
            projectileFlyMs: hitDelayMs,
            projectileFromEnemyUnitId: undefined,
          })
          const left = predictedHpById.get(target.id)
          if (typeof left === 'number') {
            predictedHpById.set(target.id, Math.max(0, left - damage))
          }
        }
      } else {
        const target = this.pickNearestEnemyByPredictedHp(predictedHpById, attackDistance)
        if (!target) continue
        const shotDamage = this.resolveFinalShotDamage(source, target, damage, attackDistance)
        if (shotDamage <= 0) continue
        const flyMs = this.getPlayerProjectileFlyMs()
        EventBus.emit('battle:item_fire', {
          itemId: source.defId,
          sourceItemId: source.id,
          side: 'player',
          multicast: 1,
          targetId: target.id,
          targetSide: 'enemy',
          projectileFlyMs: flyMs,
          attackType,
          attackDistance,
        })
        this.enqueuePlayerDamageHit({
          sourceItemId: source.id,
          targetEnemyUnitId: target.id,
          damage: shotDamage,
          baseDamage: shotDamage,
          bounceRemaining: Math.max(0, this.playerBounceCountByItemId.get(source.id) ?? 0),
          bounceHop: 0,
          bounceDamageBonusPerHop: Math.max(0, this.playerBounceDamageBonusPerHopByItemId.get(source.id) ?? 0),
          firstBounceSplitBonus: Math.max(0, this.playerFirstBounceSplitBonus),
          chainedEnemyUnitIds: [target.id],
          projectileFlyMs: flyMs,
          projectileFromEnemyUnitId: undefined,
        })
        const left = predictedHpById.get(target.id)
        if (typeof left === 'number') {
          predictedHpById.set(target.id, Math.max(0, left - shotDamage))
        }
      }
      this.applyPostItemUseEffects(source)
      this.applyPostPlayerFireEffects(source)
      const useDamageBonus = this.playerUseDamageBonusByItemId.get(source.id)
      if (useDamageBonus && useDamageBonus > 0) {
        source.baseStats.damage += useDamageBonus
      }
    }
  }

  private enqueuePlayerDamageHit(hit: Omit<PendingPlayerHit, 'dueAtMs'>): void {
    const panel = Math.max(0, Math.round(hit.damage))
    if (panel <= 0) return
    const flyMs = Math.max(1, Math.round(hit.projectileFlyMs || this.getPlayerProjectileFlyMs()))
    this.pendingPlayerHits.push({
      dueAtMs: this.elapsedMs + flyMs,
      sourceItemId: hit.sourceItemId,
      targetEnemyUnitId: hit.targetEnemyUnitId,
      damage: panel,
      baseDamage: Math.max(0, Math.round(hit.baseDamage)),
      bounceRemaining: Math.max(0, Math.round(hit.bounceRemaining || 0)),
      bounceHop: Math.max(0, Math.round(hit.bounceHop || 0)),
      bounceDamageBonusPerHop: Math.max(0, Math.round(hit.bounceDamageBonusPerHop || 0)),
      firstBounceSplitBonus: Math.max(0, Math.round(hit.firstBounceSplitBonus || 0)),
      chainedEnemyUnitIds: [...(hit.chainedEnemyUnitIds ?? [])],
      projectileFlyMs: flyMs,
      projectileFromEnemyUnitId: hit.projectileFromEnemyUnitId,
    })
  }

  private consumePendingPlayerHits(): void {
    if (this.pendingPlayerHits.length <= 0) return
    const due: PendingPlayerHit[] = []
    const pending: PendingPlayerHit[] = []
    for (const one of this.pendingPlayerHits) {
      if (one.dueAtMs <= this.elapsedMs) due.push(one)
      else pending.push(one)
    }
    this.pendingPlayerHits = pending
    for (const one of due) {
      const target = this.enemyUnits.find((it) => it.id === one.targetEnemyUnitId && it.hp > 0)
      if (!target) continue
      const source = this.playerItems.find((it) => it.id === one.sourceItemId)
      if (!source) continue
      this.applyPlayerDamageToEnemy(source, target, one.damage)
      this.enqueueBounceHitsAfterImpact(source, target, one)
      if (this.finished) return
    }
  }

  private resolveSourceDamageForThisFire(source: CombatItemRunner): number {
    let damage = Math.max(0, Math.round(source.baseStats.damage + source.runtime.tempDamageBonus))
    if (damage <= 0) return 0
    if (this.getItemIcon(source) === 'item44') {
      const damageItemCount = this.playerItems.filter((it) => Math.max(0, Math.round(it.baseStats.damage + it.runtime.tempDamageBonus)) > 0).length
      if (damageItemCount <= 1) damage *= 3
    }
    return Math.max(0, Math.round(damage))
  }

  private enqueueBounceHitsAfterImpact(source: CombatItemRunner, currentTarget: EnemyUnit, currentHit: PendingPlayerHit): void {
    if (currentHit.bounceRemaining <= 0) return
    const nextHop = currentHit.bounceHop + 1
    const branchCount = 1 + (currentHit.bounceHop === 0 ? Math.max(0, currentHit.firstBounceSplitBonus) : 0)
    const picked = this.pickNearestBounceTargets(currentTarget, new Set(currentHit.chainedEnemyUnitIds), branchCount)
    if (picked.length <= 0) return
    for (const one of picked) {
      const decayFactor = Math.max(0, this.playerBounceDamageFactorByItemId.get(source.id) ?? 1)
      const bounced = Math.max(0, Math.round(currentHit.damage * decayFactor))
      const bonus = Math.max(0, Math.round(currentHit.bounceDamageBonusPerHop * nextHop))
      const nextDamage = Math.max(0, bounced + bonus)
      if (nextDamage <= 0) continue
      EventBus.emit('battle:item_fire', {
        itemId: source.defId,
        sourceItemId: source.id,
        side: 'player',
        multicast: 1,
        targetId: one.id,
        targetSide: 'enemy',
        projectileFlyMs: this.getBounceFlightMs(currentTarget, one, currentHit.projectileFlyMs),
        projectileFromEnemyUnitId: currentTarget.id,
        projectileStyle: 'linear',
      })
      const bounceFlyMs = this.getBounceFlightMs(currentTarget, one, currentHit.projectileFlyMs)
      this.enqueuePlayerDamageHit({
        sourceItemId: source.id,
        targetEnemyUnitId: one.id,
        damage: nextDamage,
        baseDamage: currentHit.baseDamage,
        bounceRemaining: currentHit.bounceRemaining - 1,
        bounceHop: nextHop,
        bounceDamageBonusPerHop: currentHit.bounceDamageBonusPerHop,
        firstBounceSplitBonus: currentHit.firstBounceSplitBonus,
        chainedEnemyUnitIds: [...currentHit.chainedEnemyUnitIds, one.id],
        projectileFlyMs: bounceFlyMs,
        projectileFromEnemyUnitId: currentTarget.id,
      })
    }
  }

  private pickNearestBounceTargets(from: EnemyUnit, excludedIds: Set<string>, count: number): EnemyUnit[] {
    if (count <= 0) return []
    const fromPos = this.estimateEnemyScreenPos(from)
    const candidates = this.enemyUnits
      .filter((it) => it.hp > 0 && it.id !== from.id && !excludedIds.has(it.id))
      .map((it) => ({
        enemy: it,
        visualDistance: Math.hypot(
          this.estimateEnemyScreenPos(it).x - fromPos.x,
          this.estimateEnemyScreenPos(it).y - fromPos.y,
        ),
      }))
    candidates.sort((a, b) => {
      if (a.visualDistance !== b.visualDistance) return a.visualDistance - b.visualDistance
      return a.enemy.distance - b.enemy.distance
    })
    return candidates.slice(0, count).map((it) => it.enemy)
  }

  private applyPlayerDamageToEnemy(source: CombatItemRunner, enemy: EnemyUnit, damage: number): void {
    enemy.hp = Math.max(0, enemy.hp - damage)
    EventBus.emit('battle:take_damage', {
      targetId: enemy.id,
      sourceItemId: source.id,
      amount: damage,
      isCrit: false,
      type: 'normal',
      targetType: 'item',
      targetSide: 'enemy',
      sourceType: 'item',
      sourceSide: 'player',
      baseDamage: damage,
      finalDamage: damage,
    })
    this.applyPostPlayerDamageEffects(source, damage)
    if (enemy.hp <= 0) {
      this.totalWaveHpKilled += enemy.maxHp
      EventBus.emit('battle:unit_die', {
        unitId: enemy.id,
        side: 'enemy',
      })
    }
  }

  private applyEnemyDamageToPlayer(enemy: EnemyUnit, damageRaw?: number): void {
    const panel = Math.max(0, Math.round(typeof damageRaw === 'number' ? damageRaw : enemy.attack))
    if (panel <= 0 || this.playerHero.hp <= 0) return
    const shieldBeforeHit = this.playerHero.shield
    let left = panel
    if (this.playerHero.shield > 0) {
      const absorb = Math.min(this.playerHero.shield, left)
      this.playerHero.shield -= absorb
      left -= absorb
    }
    if (left > 0) {
      this.playerHero.hp = Math.max(0, this.playerHero.hp - left)
    }
    EventBus.emit('battle:take_damage', {
      targetId: this.playerHero.id,
      sourceItemId: enemy.id,
      amount: panel,
      isCrit: false,
      type: 'normal',
      targetType: 'hero',
      targetSide: 'player',
      sourceType: 'item',
      sourceSide: 'enemy',
      baseDamage: panel,
      finalDamage: panel,
    })
    this.applySpikeShieldReflect(enemy, shieldBeforeHit)
  }

  private cleanupDeadEnemies(): void {
    if (this.enemyUnits.length <= 0) return
    this.enemyUnits = this.enemyUnits.filter((it) => it.hp > 0)
  }

  private refreshEnemyHeroHp(): void {
    let aliveHp = 0
    for (const one of this.enemyUnits) aliveHp += Math.max(0, one.hp)
    let unspawnedHp = 0
    const cfg = getConfig().towerDefenseRules
    const byId = new Map((cfg?.enemyDefs ?? []).map((it) => [it.id, it]))
    for (let i = this.nextSpawnIdx; i < this.spawnJobs.length; i++) {
      const job = this.spawnJobs[i]
      if (!job) continue
      const def = byId.get(job.enemyId)
      if (!def) continue
      unspawnedHp += Math.max(0, Math.round(def.hp))
    }
    const hp = Math.max(0, aliveHp + unspawnedHp)
    this.enemyHero.maxHp = Math.max(1, this.totalWaveHp)
    this.enemyHero.hp = Math.min(this.enemyHero.maxHp, hp)
  }

  private getRemainingEnemyCount(): number {
    let alive = 0
    for (const one of this.enemyUnits) if (one.hp > 0) alive += 1
    const unspawned = Math.max(0, this.spawnJobs.length - this.nextSpawnIdx)
    return alive + unspawned
  }

  private checkFinish(): void {
    if (this.finished) return
    if (this.playerHero.hp <= 0) {
      this.finish('enemy')
      return
    }
    const hasAliveEnemy = this.enemyUnits.some((it) => it.hp > 0)
    const hasUnspawned = this.nextSpawnIdx < this.spawnJobs.length
    if (!hasAliveEnemy && !hasUnspawned) {
      this.finish('player')
    }
  }

  private finish(winner: 'player' | 'enemy'): void {
    if (this.finished) return
    this.finished = true
    const survivingDamage = winner === 'player'
      ? Math.max(1, Math.round(Math.max(0, this.playerHero.hp) / 100))
      : Math.max(1, Math.round(Math.max(0, this.enemyHero.hp) / 100))
    this.result = {
      winner,
      ticks: this.tickIndex,
      survivingDamage,
    }
    EventBus.emit('battle:end', {
      winner,
      blameLog: winner === 'player' ? ['tower-defense-clear'] : ['tower-defense-fail'],
    })
  }

  private pickWaveByDay(
    waves: Array<{
      day: number
      spawnDurationMs?: number
      hpMultiplier?: number
      attackMultiplier?: number
      enemies: Array<{ id: string; count: number }>
    }>,
    day: number,
  ): {
    wave: {
      day: number
      spawnDurationMs?: number
      hpMultiplier?: number
      attackMultiplier?: number
      enemies: Array<{ id: string; count: number }>
    }
    hpMultiplier: number
    attackMultiplier: number
  } | null {
    if (!waves.length) return null
    const sorted = [...waves].sort((a, b) => a.day - b.day)
    const safeDay = Math.max(1, Math.min(30, Math.round(day || 1)))
    const pickByDayAtMost = (targetDay: number): {
      day: number
      spawnDurationMs?: number
      hpMultiplier?: number
      attackMultiplier?: number
      enemies: Array<{ id: string; count: number }>
    } | null => {
      let oneHit = sorted[0] ?? null
      for (const one of sorted) {
        if (one.day <= targetDay) oneHit = one
        else break
      }
      return oneHit
    }

    const hit = pickByDayAtMost(safeDay)
    if (!hit) return null
    return {
      wave: hit,
      hpMultiplier: Math.max(1, Number(hit.hpMultiplier) || 1),
      attackMultiplier: Math.max(1, Number(hit.attackMultiplier) || 1),
    }
  }
}
