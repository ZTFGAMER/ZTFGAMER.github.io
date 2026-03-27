import type { BattleSnapshotBundle } from '@/tower/battle/BattleSnapshotStore'
import { EventBus } from '@/tower/core/EventBus'
import { getConfig } from '@/tower/core/DataLoader'
import { getConfig as getDebugCfg } from '@/tower/config/debugConfig'
import { CANVAS_W } from '@/tower/config/layoutConstants'
import { emitDiagEvent } from '@/perf/DiagRuntime'
import type { CombatBoardItem, CombatItemRuntimeState, CombatResult } from '@/tower/battle/CombatEngine'
import type { CombatItemRunner } from '@/tower/battle/CombatTypes'
import { toRunner } from '@/tower/battle/EnemyBuilder'
import { findItemDef, itemArchetype, pickTierSeriesValue, skillLines, tierIndexFromRaw } from '@/tower/battle/CombatHelpers'
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
  burstCount?: number
  splitTargets?: boolean
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
  slowMs: number
  freezeMs: number
  poisonMs: number
  poisonTickCarryMs: number
  bleedMs: number
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
  private currentWaveSpawnTotal = 0
  private currentWaveSpawned = 0
  private currentWaveHasBoss = false
  private runtimeCalls = 0
  private runtimeCacheHits = 0
  private lastRuntimeTick = -1
  private runtimeCache: CombatItemRuntimeState[] = []
  private pendingPlayerFires: PendingPlayerFire[] = []
  private pendingPlayerHits: PendingPlayerHit[] = []
  private pendingEnemyHits: PendingEnemyHit[] = []
  private pendingPlayerMeleeTriggers: string[] = []
  private nextPlayerMeleeTriggerAtMs = -1
  private playerAttackDistanceByItemId = new Map<string, number>()
  private towerClassAttackDistances: TowerClassAttackDistanceView = { swordsman: 0, archer: 0, assassin: 0, mage: 0 }
  private playerUseDamageBonusByItemId = new Map<string, number>()
  private playerRangeBlockedByItemId = new Map<string, boolean>()
  private playerBounceCountByItemId = new Map<string, number>()
  private playerFirstBounceSplitBonus = 0
  private playerBounceDamageBonusPerHopByItemId = new Map<string, number>()
  private playerBounceDamageFactorByItemId = new Map<string, number>()
  private playerNinjaDamagePenaltyPct = 0
  private playerArcherDamagePenaltyPct = 0
  private playerWarriorDamagePenaltyPct = 0
  private bloodBowComboByTargetId = new Map<string, number>()
  private playerShieldDecayCarryMs = 0
  private towerSkillPickCounts = new Map<string, number>()
  private towerNinjaVsSlowedMul = 1
  private towerNinjaCrystalBounceBonusPct = 0
  private towerNinjaSuperBounceExtraCount = 0
  private towerNinjaSplitDamageMul = 1
  private towerArcherPoisonUseMaxHp = false
  private towerArcherSniperBonusMul = 1
  private towerArcherFlatDamageBonus = 0
  private towerArcherBloodBonusMul = 1
  private towerMageFreezeChanceBonusPct = 0
  private towerMageFreezeDurationMul = 1
  private towerSlowSpeedMul = 0.5
  private towerMageExplosionRadiusMeters = 6
  private towerMageCounterChargeMul = 1
  private towerWarriorShieldNoDecayBelow = 0
  private towerWarriorBleedMulNormal = 1.5
  private towerWarriorBleedMulBoss = 1.2
  private towerWarriorDualShieldGainMul = 1
  private towerWarriorRangeBonusMeters = 0
  private towerWarriorReflectMul = 1
  private diagLastAnomalyEmitAtMs = 0

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
    this.currentWaveSpawnTotal = 0
    this.currentWaveSpawned = 0
    this.currentWaveHasBoss = false
    this.runtimeCalls = 0
    this.runtimeCacheHits = 0
    this.lastRuntimeTick = -1
    this.runtimeCache = []
    this.pendingPlayerFires = []
    this.pendingPlayerHits = []
    this.pendingEnemyHits = []
    this.pendingPlayerMeleeTriggers = []
    this.nextPlayerMeleeTriggerAtMs = -1
    this.bloodBowComboByTargetId.clear()
    this.playerShieldDecayCarryMs = 0
    this.towerSkillPickCounts.clear()
    if (snapshot.towerBattleSkillPickCounts && typeof snapshot.towerBattleSkillPickCounts === 'object') {
      for (const [k, v] of Object.entries(snapshot.towerBattleSkillPickCounts)) {
        const n = Math.max(0, Math.round(Number(v) || 0))
        if (n > 0) this.towerSkillPickCounts.set(k, n)
      }
    }
    this.rebuildPlayerDerivedParams()

    const playerHp = this.getFixedPlayerHp()
    const snapshotHpRaw = Number(snapshot.playerBattleHp)
    const startHp = Number.isFinite(snapshotHpRaw) ? Math.max(1, Math.round(snapshotHpRaw)) : playerHp
    const startShield = Math.max(0, Math.round(Number(snapshot.playerShield) || 0))
    this.playerHero = {
      id: 'hero_player',
      side: 'player',
      maxHp: playerHp,
      hp: Math.max(1, Math.min(startHp, playerHp)),
      shield: startShield,
      burn: 0,
      poison: 0,
      regen: 0,
    }
    this.enemyHero = { id: 'hero_enemy', side: 'enemy', maxHp: 1, hp: 1, shield: 0, burn: 0, poison: 0, regen: 0 }

    this.buildSpawnPlan()
    this.refreshEnemyHeroHp()
  }

  syncPlayerEntities(entities: BattleSnapshotBundle['entities'], options?: { resetChargeIds?: string[] }): void {
    const resetIds = new Set(options?.resetChargeIds ?? [])
    const oldById = new Map(this.playerItems.map((it) => [it.id, it] as const))
    const replacedIds = new Set<string>()
    this.playerItems = entities.map((it, idx) => {
      const runner = toRunner(it, `P-${idx}`)
      runner.side = 'player'
      const old = oldById.get(runner.id)
      if (old && old.defId === runner.defId) {
        runner.runtime.currentChargeMs = old.runtime.currentChargeMs
        runner.runtime.pendingChargeMs = old.runtime.pendingChargeMs
        runner.runtime.executeCount = old.runtime.executeCount
        runner.runtime.tempDamageBonus = old.runtime.tempDamageBonus
        runner.runtime.ammoAutoReloadRemainingMs = old.runtime.ammoAutoReloadRemainingMs
        runner.runtime.modifiers.freezeMs = old.runtime.modifiers.freezeMs
        runner.runtime.modifiers.slowMs = old.runtime.modifiers.slowMs
        runner.runtime.modifiers.hasteMs = old.runtime.modifiers.hasteMs
        runner.runtime.ammoCurrent = old.runtime.ammoCurrent
        runner.runtime.ammoMax = old.runtime.ammoMax
      } else if (old && old.defId !== runner.defId) {
        replacedIds.add(runner.id)
      }
      if (resetIds.has(runner.id)) {
        runner.runtime.currentChargeMs = 0
        runner.runtime.pendingChargeMs = 0
      }
      return runner
    })

    const validIds = new Set(this.playerItems.map((it) => it.id))
    this.pendingPlayerFires = this.pendingPlayerFires.filter((it) => validIds.has(it.sourceItemId) && !replacedIds.has(it.sourceItemId))
    this.pendingPlayerHits = this.pendingPlayerHits.filter((it) => validIds.has(it.sourceItemId) && !replacedIds.has(it.sourceItemId))
    this.pendingPlayerMeleeTriggers = this.pendingPlayerMeleeTriggers.filter((id) => validIds.has(id) && !replacedIds.has(id))
    void validIds
    void replacedIds
    if (this.pendingPlayerMeleeTriggers.length <= 0) this.nextPlayerMeleeTriggerAtMs = -1

    // 战斗中阵容变化后，按“在场即生效”口径重算被动（购买/合成/移动/消失都即时生效）
    this.applyPassiveAurasOnBattleStart()
    this.rebuildPlayerDerivedParams()
    this.lastRuntimeTick = -1
    this.runtimeCache = []
  }

  syncTowerBattleSkillPickCounts(pickCounts: Record<string, number>): void {
    this.towerSkillPickCounts.clear()
    for (const [k, v] of Object.entries(pickCounts ?? {})) {
      const n = Math.max(0, Math.round(Number(v) || 0))
      if (n > 0) this.towerSkillPickCounts.set(k, n)
    }
    this.applyPassiveAurasOnBattleStart()
    this.rebuildPlayerDerivedParams()
    this.lastRuntimeTick = -1
    this.runtimeCache = []
  }

  update(dt: number): void {
    if (this.finished) return
    if (!Number.isFinite(dt)) {
      this.emitDiagAnomaly('tower_engine_invalid_dt', { dt })
      return
    }
    const dtMs = Math.max(0, dt * 1000)
    if (dtMs <= 0) return
    if (dtMs >= 250) {
      emitDiagEvent('tower_engine_large_dt', {
        dtMs: Math.round(dtMs),
        tickIndex: this.tickIndex,
        day: this.day,
      }, { throttleMs: 1200, level: 'verbose' })
    }
    this.elapsedMs += dtMs
    this.tickIndex += 1
    this.tickPlayerShieldDecay(dtMs)

    this.spawnDueEnemies()
    this.tickEnemyStatusEffects(dtMs)
    this.tickEnemyMoveAndAttack(dtMs)
    this.tickPlayerItems(dtMs)
    this.consumePendingPlayerFires()
    this.consumePendingPlayerHits()
    this.consumePendingEnemyHits()
    this.cleanupDeadEnemies()
    this.refreshEnemyHeroHp()
    const fixedHp = this.getFixedPlayerHp()
    this.playerHero.maxHp = fixedHp
    this.playerHero.hp = Math.max(0, Math.min(this.playerHero.hp, fixedHp))
    if (!Number.isFinite(this.playerHero.hp) || !Number.isFinite(this.playerHero.shield) || !Number.isFinite(this.elapsedMs)) {
      this.emitDiagAnomaly('tower_engine_invalid_state', {
        playerHp: this.playerHero.hp,
        playerShield: this.playerHero.shield,
        elapsedMs: this.elapsedMs,
        tickIndex: this.tickIndex,
      })
    }
    if (
      this.pendingPlayerHits.length + this.pendingEnemyHits.length > this.getQueuePendingHitsSoftCap()
      || this.pendingPlayerFires.length > this.getQueuePendingFiresSoftCap()
    ) {
      emitDiagEvent('tower_engine_queue_spike', {
        pendingPlayerHits: this.pendingPlayerHits.length,
        pendingEnemyHits: this.pendingEnemyHits.length,
        pendingPlayerFires: this.pendingPlayerFires.length,
        pendingMelee: this.pendingPlayerMeleeTriggers.length,
        day: this.day,
        tickIndex: this.tickIndex,
      }, { throttleMs: 1500 })
    }
    this.checkFinish()
  }

  private getFixedPlayerHp(): number {
    const raw = Number((getConfig().towerDefenseRules as { fixedPlayerHp?: number } | undefined)?.fixedPlayerHp)
    if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.round(raw))
    return 500
  }

  private tickPlayerShieldDecay(dtMs: number): void {
    if (dtMs <= 0 || this.playerHero.shield <= 0) {
      if (this.playerHero.shield <= 0) this.playerShieldDecayCarryMs = 0
      return
    }
    this.playerShieldDecayCarryMs += dtMs
    while (this.playerShieldDecayCarryMs >= 1000 && this.playerHero.shield > 0) {
      this.playerShieldDecayCarryMs -= 1000
      if (this.playerHero.shield < Math.max(20, this.towerWarriorShieldNoDecayBelow)) continue
      const decay = Math.floor(this.playerHero.shield / 20)
      if (decay <= 0) continue
      this.playerHero.shield = Math.max(0, this.playerHero.shield - decay)
    }
  }

  private isBossEnemyUnit(enemy: EnemyUnit): boolean {
    if (Math.max(1, Math.round(enemy.laneOccupyCount || 1)) >= 3) return true
    return String(enemy.enemyId || '').includes('boss')
  }

  private getMeterToDistance(): number {
    const cfg = getConfig().towerDefenseRules
    return Math.max(1, Number(cfg?.moveDistancePerSecAtSpeed1) || 1)
  }

  private tickEnemyStatusEffects(dtMs: number): void {
    if (dtMs <= 0) return
    for (const enemy of this.enemyUnits) {
      if (enemy.hp <= 0) continue
      enemy.slowMs = Math.max(0, enemy.slowMs - dtMs)
      enemy.freezeMs = Math.max(0, enemy.freezeMs - dtMs)
      enemy.bleedMs = Math.max(0, enemy.bleedMs - dtMs)
      if (enemy.poisonMs > 0) {
        enemy.poisonMs = Math.max(0, enemy.poisonMs - dtMs)
        enemy.poisonTickCarryMs += dtMs
        while (enemy.poisonTickCarryMs >= 1000 && enemy.hp > 0 && enemy.poisonMs > 0) {
          enemy.poisonTickCarryMs -= 1000
          const rateBase = this.isBossEnemyUnit(enemy) ? 0.01 : 0.05
          const rate = rateBase
          const poisonDamageBaseHp = this.towerArcherPoisonUseMaxHp
            ? Math.max(1, enemy.maxHp)
            : Math.max(1, enemy.hp)
          const poisonDamage = Math.max(1, Math.round(poisonDamageBaseHp * rate))
          enemy.hp = Math.max(0, enemy.hp - poisonDamage)
          EventBus.emit('battle:take_damage', {
            targetId: enemy.id,
            sourceItemId: 'tower_poison',
            amount: poisonDamage,
            isCrit: false,
            type: 'poison',
            targetType: 'item',
            targetSide: 'enemy',
            sourceType: 'item',
            sourceSide: 'player',
            baseDamage: poisonDamage,
            finalDamage: poisonDamage,
          })
          if (enemy.hp <= 0) {
            this.totalWaveHpKilled += enemy.maxHp
            EventBus.emit('battle:unit_die', {
              unitId: enemy.id,
              side: 'enemy',
            })
            break
          }
        }
      } else {
        enemy.poisonTickCarryMs = 0
      }
    }
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
        level: (it as { level?: number }).level,
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
    return Math.max(0, Math.round(item.baseStats.shield))
  }

  private applyPassiveAurasOnBattleStart(): void {
    for (let i = 0; i < this.playerItems.length; i++) {
      const one = this.playerItems[i]
      if (!one) continue
      const normalizedTier = one.tier.startsWith('Diamond')
        ? 'Diamond'
        : one.tier.startsWith('Gold')
          ? 'Gold'
          : one.tier.startsWith('Silver')
            ? 'Silver'
            : 'Bronze'
      const normalizedLevel = Math.max(1, Math.min(8, Math.round(Number(one.level) || 1))) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
      const refreshed = toRunner({
        instanceId: one.id,
        defId: one.defId,
        col: one.col,
        row: one.row,
        size: one.size,
        level: normalizedLevel,
        tier: normalizedTier,
        tierStar: one.tierStar,
        quality: normalizedTier,
        permanentDamageBonus: 0,
        enchantment: one.enchantment,
      }, `P-reset-${i}`)
      one.baseStats = { ...refreshed.baseStats }
    }

    this.playerNinjaDamagePenaltyPct = 0
    this.playerArcherDamagePenaltyPct = 0
    this.playerWarriorDamagePenaltyPct = 0
    this.towerNinjaVsSlowedMul = 1
    this.towerNinjaCrystalBounceBonusPct = 0
    this.towerNinjaSuperBounceExtraCount = 0
    this.towerNinjaSplitDamageMul = 1
    this.towerArcherPoisonUseMaxHp = false
    this.towerArcherSniperBonusMul = 1
    this.towerArcherFlatDamageBonus = 0
    this.towerArcherBloodBonusMul = 1
    this.towerMageFreezeChanceBonusPct = 0
    this.towerMageFreezeDurationMul = 1
    this.towerSlowSpeedMul = 0.5
    this.towerMageExplosionRadiusMeters = 6
    this.towerMageCounterChargeMul = 1
    this.towerWarriorShieldNoDecayBelow = 0
    this.towerWarriorBleedMulNormal = 1.5
    this.towerWarriorBleedMulBoss = 1.2
    this.towerWarriorDualShieldGainMul = 1
    this.towerWarriorRangeBonusMeters = 0
    this.towerWarriorReflectMul = 1

    const skillCount = (id: string): number => Math.max(0, Math.round(this.towerSkillPickCounts.get(id) ?? 0))
    const hasSkill = (id: string): boolean => skillCount(id) > 0
    const itemIconSet = new Set(this.playerItems.map((it) => this.getItemIcon(it)))

    this.towerNinjaVsSlowedMul = (hasSkill('td_skill_ninja_super_heavy') && itemIconSet.has('toweritem4')) ? 2 : 1
    this.towerNinjaSuperBounceExtraCount = (hasSkill('td_skill_ninja_super_bounce') && itemIconSet.has('toweritem2')) ? 2 : 0
    this.towerNinjaCrystalBounceBonusPct = (hasSkill('td_skill_ninja_super_crystal') && itemIconSet.has('toweritem5')) ? 10 : 0
    this.towerNinjaSplitDamageMul = (hasSkill('td_skill_ninja_super_split') && itemIconSet.has('toweritem6')) ? 1.5 : 1

    this.towerArcherFlatDamageBonus = (hasSkill('td_skill_archer_super_high_damage') && itemIconSet.has('toweritem8')) ? 5 : 0
    this.towerArcherPoisonUseMaxHp = hasSkill('td_skill_archer_super_poison') && itemIconSet.has('toweritem10')
    this.towerArcherSniperBonusMul = (hasSkill('td_skill_archer_super_sniper') && itemIconSet.has('toweritem11')) ? 2 : 1
    this.towerArcherBloodBonusMul = (hasSkill('td_skill_archer_super_blood') && itemIconSet.has('toweritem12')) ? 2 : 1

    this.towerSlowSpeedMul = (hasSkill('td_skill_mage_super_slow') && itemIconSet.has('toweritem14')) ? 0.34 : 0.5
    this.towerMageFreezeChanceBonusPct = 0
    this.towerMageFreezeDurationMul = (hasSkill('td_skill_mage_super_freeze') && itemIconSet.has('toweritem16')) ? 2 : 1
    this.towerMageExplosionRadiusMeters = (hasSkill('td_skill_mage_super_explode') && itemIconSet.has('toweritem17')) ? 9 : 6
    this.towerMageCounterChargeMul = (hasSkill('td_skill_mage_super_counter') && itemIconSet.has('toweritem18')) ? 2 : 1

    this.towerWarriorRangeBonusMeters = (hasSkill('td_skill_warrior_super_range') && itemIconSet.has('toweritem20')) ? 3 : 0
    this.towerWarriorShieldNoDecayBelow = (hasSkill('td_skill_warrior_super_guard') && itemIconSet.has('toweritem22')) ? 50 : 0
    const hasSuperBleed = hasSkill('td_skill_warrior_super_bleed') && itemIconSet.has('toweritem21')
    this.towerWarriorBleedMulNormal = hasSuperBleed ? 2 : 1.5
    this.towerWarriorBleedMulBoss = hasSuperBleed ? 1.4 : 1.2
    this.towerWarriorDualShieldGainMul = (hasSkill('td_skill_warrior_super_dual') && itemIconSet.has('toweritem23')) ? 2 : 1
    this.towerWarriorReflectMul = (hasSkill('td_skill_warrior_super_counter') && itemIconSet.has('toweritem24')) ? 2 : 1

    const ninjaDamagePct = Math.min(100, skillCount('td_skill_ninja_damage') * 20)
    const archerDamagePct = Math.min(100, skillCount('td_skill_archer_damage') * 20)
    const mageDamagePct = Math.min(100, skillCount('td_skill_mage_damage') * 20)
    const warriorDamagePct = Math.min(100, skillCount('td_skill_warrior_damage') * 20)
    const ninjaCdReducePct = Math.min(50, skillCount('td_skill_ninja_cd') * 10)
    const archerCdReducePct = Math.min(50, skillCount('td_skill_archer_cd') * 10)
    const mageCdReducePct = Math.min(50, skillCount('td_skill_mage_cd') * 10)
    const warriorCdReducePct = Math.min(50, skillCount('td_skill_warrior_cd') * 10)

    const ninjaSuperMulticast = hasSkill('td_skill_ninja_super_multicast') ? 1 : 0
    const archerSuperMulticast = hasSkill('td_skill_archer_super_multicast') ? 1 : 0
    const mageSuperExtraTargets = hasSkill('td_skill_mage_super_multitarget') ? 2 : 0

    const applyPercentDamage = (base: number, pct: number): number => {
      if (pct <= 0 || base <= 0) return base
      return Math.max(1, Math.round(base * (1 + pct / 100)))
    }
    const applyReduceCooldown = (base: number, pct: number): number => {
      if (pct <= 0 || base <= 0) return base
      return Math.max(1, Math.round(base * Math.max(0, 1 - pct / 100)))
    }

    for (const aura of this.playerItems) {
      const icon = this.getItemIcon(aura)
      const arch = itemArchetype(findItemDef(aura.defId))
      if (arch === '忍者') {
        aura.baseStats.damage = applyPercentDamage(aura.baseStats.damage, ninjaDamagePct)
        aura.baseStats.cooldownMs = applyReduceCooldown(aura.baseStats.cooldownMs, ninjaCdReducePct)
        if (aura.baseStats.damage > 0 && ninjaSuperMulticast > 0) {
          aura.baseStats.multicast = Math.max(1, aura.baseStats.multicast + ninjaSuperMulticast)
        }
      } else if (arch === '弓手') {
        aura.baseStats.damage = applyPercentDamage(aura.baseStats.damage, archerDamagePct)
        aura.baseStats.cooldownMs = applyReduceCooldown(aura.baseStats.cooldownMs, archerCdReducePct)
        if (aura.baseStats.damage > 0 && this.towerArcherFlatDamageBonus > 0) {
          aura.baseStats.damage = Math.max(1, Math.round(aura.baseStats.damage + this.towerArcherFlatDamageBonus))
        }
        if (aura.baseStats.damage > 0 && archerSuperMulticast > 0) {
          aura.baseStats.multicast = Math.max(1, aura.baseStats.multicast + archerSuperMulticast)
        }
      } else if (arch === '冰法师') {
        aura.baseStats.damage = applyPercentDamage(aura.baseStats.damage, mageDamagePct)
        aura.baseStats.cooldownMs = applyReduceCooldown(aura.baseStats.cooldownMs, mageCdReducePct)
        if (aura.baseStats.damage > 0 && mageSuperExtraTargets > 0) {
          aura.baseStats.multicast = Math.max(1, aura.baseStats.multicast + mageSuperExtraTargets)
        }
      } else if (arch === '剑士') {
        aura.baseStats.damage = applyPercentDamage(aura.baseStats.damage, warriorDamagePct)
        aura.baseStats.cooldownMs = applyReduceCooldown(aura.baseStats.cooldownMs, warriorCdReducePct)
      }

      if (icon === 'toweritem8') {
        const bonus = Math.max(0, Math.round(this.resolveNumericValueFromItemLine(aura, /弓箭伤害\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)/)))
        if (bonus > 0) {
          for (const target of this.playerItems) {
            if (itemArchetype(findItemDef(target.defId)) !== '弓手') continue
            if (target.baseStats.damage <= 0) continue
            target.baseStats.damage += bonus
          }
        }
        continue
      }
      if (icon === 'toweritem9') {
        const multicastBonus = Math.max(0, Math.round(this.resolveNumericValueFromItemLine(aura, /连发次数\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)/)))
        const penaltyRaw = this.resolveNumericValueFromItemLine(aura, /伤害\s*([+\-]?\d+(?:\.\d+)?(?:%?[\/|][+\-]?\d+(?:\.\d+)?)*%?)\s*%?/)
        const damagePenaltyPct = Math.max(0, Math.round(Math.abs(penaltyRaw)))
        for (const target of this.playerItems) {
          if (itemArchetype(findItemDef(target.defId)) !== '弓手') continue
          if (target.baseStats.damage <= 0) continue
          target.baseStats.multicast = Math.max(1, target.baseStats.multicast + multicastBonus)
        }
        this.playerArcherDamagePenaltyPct += damagePenaltyPct
        continue
      }
      if (icon === 'toweritem3') {
        const multicastBonus = Math.max(0, Math.round(this.resolveNumericValueFromItemLine(aura, /连发次数\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)/)))
        const penaltyRaw = this.resolveNumericValueFromItemLine(aura, /伤害\s*([+\-]?\d+(?:\.\d+)?(?:%?[\/|][+\-]?\d+(?:\.\d+)?)*%?)\s*%?/)
        const damagePenaltyPct = Math.max(0, Math.round(Math.abs(penaltyRaw)))
        for (const target of this.playerItems) {
          if (itemArchetype(findItemDef(target.defId)) !== '忍者') continue
          if (target.baseStats.damage <= 0) continue
          target.baseStats.multicast = Math.max(1, target.baseStats.multicast + multicastBonus)
        }
        this.playerNinjaDamagePenaltyPct += damagePenaltyPct
        continue
      }
      if (icon === 'toweritem15') {
        const multicastBonus = Math.max(0, Math.round(this.resolveNumericValueFromItemLine(aura, /发射目标\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)/)))
        for (const target of this.playerItems) {
          if (itemArchetype(findItemDef(target.defId)) !== '冰法师') continue
          if (target.baseStats.damage <= 0) continue
          target.baseStats.multicast = Math.max(1, target.baseStats.multicast + multicastBonus)
        }
        continue
      }
      if (icon === 'toweritem23') continue
    }

    for (const one of this.playerItems) {
      if (itemArchetype(findItemDef(one.defId)) !== '剑士') continue
      const shieldGain = Math.max(0, this.resolveNumericValueFromItemLine(one, /护盾\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)/))
      if (shieldGain > 0) {
        const scaledGain = Math.max(0, Math.round(shieldGain * this.towerWarriorDualShieldGainMul))
        one.baseStats.shield = Math.max(0, Math.round(one.baseStats.shield + scaledGain))
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
      maxPendingHits: this.getQueuePendingHitsSoftCap(),
      maxPendingItemFires: this.getQueuePendingFiresSoftCap(),
      maxPendingChargePulses: 1,
      maxPendingAmmoRefills: 1,
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
      allEnemiesSpawnedAtMs: this.allEnemiesSpawnedAtMs,
      elapsedMs: this.elapsedMs,
      currentWaveHasBoss: this.currentWaveHasBoss,
    }
  }

  getTowerClassAttackDistances(): TowerClassAttackDistanceView {
    return {
      swordsman: Math.max(0, Math.round(this.towerClassAttackDistances.swordsman || 0)),
      archer: Math.max(0, Math.round(this.towerClassAttackDistances.archer || 0)),
      assassin: Math.max(0, Math.round(this.towerClassAttackDistances.assassin || 0)),
      mage: Math.max(0, Math.round(this.towerClassAttackDistances.mage || 0)),
    }
  }

  private recomputeTowerClassAttackDistances(): void {
    const next: TowerClassAttackDistanceView = { swordsman: 0, archer: 0, assassin: 0, mage: 0 }
    for (const item of this.playerItems) {
      const distance = Math.max(0, Math.round(this.playerAttackDistanceByItemId.get(item.id) ?? 0))
      if (distance <= 0) continue
      const archetype = itemArchetype(findItemDef(item.defId))
      if (archetype === '战士' || archetype === '剑士') next.swordsman = Math.max(next.swordsman, distance)
      else if (archetype === '弓手') next.archer = Math.max(next.archer, distance)
      else if (archetype === '刺客' || archetype === '忍者') next.assassin = Math.max(next.assassin, distance)
      else if (archetype === '冰法师') next.mage = Math.max(next.mage, distance)
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
    const enemyById = new Map<string, EnemyDef>()
    for (const one of cfg.enemyDefs ?? []) {
      enemyById.set(one.id, one)
    }

    const { jobs, totalHp, totalCount } = this.buildWaveSpawnJobs(wave, enemyById, 0)
    jobs.sort((a, b) => {
      if (a.isBoss !== b.isBoss) return a.isBoss ? 1 : -1
      return a.spawnAtMs - b.spawnAtMs
    })
    this.spawnJobs = jobs
    this.currentWaveSpawnTotal = totalCount
    this.currentWaveSpawned = 0
    this.currentWaveHasBoss = jobs.some((it) => it.isBoss)
    this.totalWaveHp = Math.max(1, totalHp)
    this.totalWaveCount = Math.max(0, totalCount)
  }

  queueNextTowerWave(nextDay: number): void {
    const cfg = getConfig().towerDefenseRules
    if (!cfg || cfg.enabled === false) return
    const safeDay = Math.max(1, Math.round(nextDay || (this.day + 1)))
    emitDiagEvent('tower_engine_queue_wave_start', {
      fromDay: this.day,
      nextDay: safeDay,
      finished: this.finished,
      elapsedMs: Math.round(this.elapsedMs),
      pendingJobs: Math.max(0, this.spawnJobs.length - this.nextSpawnIdx),
    })
    const picked = this.pickWaveByDay(cfg.dayWaves ?? [], safeDay)
    if (!picked) return
    const wave = ('wave' in picked ? picked.wave : picked)
    const hpMultiplier = ('hpMultiplier' in picked ? picked.hpMultiplier : 1)
    const attackMultiplier = ('attackMultiplier' in picked ? picked.attackMultiplier : 1)
    this.waveHpMultiplier = Math.max(1, hpMultiplier)
    this.waveAttackMultiplier = Math.max(1, attackMultiplier)

    const enemyById = new Map<string, EnemyDef>()
    for (const one of cfg.enemyDefs ?? []) enemyById.set(one.id, one)

    const spawnBaseMs = this.elapsedMs
    const { jobs: appendJobs, totalHp: appendTotalHp, totalCount: appendTotalCount } = this.buildWaveSpawnJobs(wave, enemyById, spawnBaseMs)
    appendJobs.sort((a, b) => {
      if (a.isBoss !== b.isBoss) return a.isBoss ? 1 : -1
      return a.spawnAtMs - b.spawnAtMs
    })

    const pendingOldJobs = this.spawnJobs.slice(this.nextSpawnIdx)
    this.spawnJobs = [...pendingOldJobs, ...appendJobs]
    this.nextSpawnIdx = 0
    this.allEnemiesSpawnedAtMs = null
    this.currentWaveSpawnTotal = appendTotalCount
    this.currentWaveSpawned = 0
    this.currentWaveHasBoss = appendJobs.some((it) => it.isBoss)
    this.finished = false
    this.result = null
    this.day = safeDay

    const aliveCount = this.enemyUnits.filter((it) => it.hp > 0).length
    const aliveHp = this.enemyUnits.reduce((sum, it) => sum + Math.max(0, it.hp), 0)
    this.totalWaveCount = Math.max(0, aliveCount + this.spawnJobs.length)
    this.totalWaveHp = Math.max(1, aliveHp + appendTotalHp)
    this.refreshEnemyHeroHp()
    emitDiagEvent('tower_engine_queue_wave_done', {
      day: this.day,
      totalWaveCount: this.totalWaveCount,
      totalWaveHp: this.totalWaveHp,
      aliveCarryCount: aliveCount,
      appendCount: appendTotalCount,
      pendingJobsAfterMerge: this.spawnJobs.length,
    })
  }

  private emitDiagAnomaly(type: string, payload: Record<string, unknown>): void {
    const now = Date.now()
    if (now - this.diagLastAnomalyEmitAtMs < 1200) return
    this.diagLastAnomalyEmitAtMs = now
    emitDiagEvent(type, {
      day: this.day,
      tickIndex: this.tickIndex,
      ...payload,
    })
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
      this.currentWaveSpawned += 1
      if (this.currentWaveSpawnTotal > 0 && this.currentWaveSpawned >= this.currentWaveSpawnTotal && this.allEnemiesSpawnedAtMs === null) {
        this.allEnemiesSpawnedAtMs = this.elapsedMs
      }
    }
    if (this.currentWaveSpawnTotal <= 0 && this.nextSpawnIdx >= this.spawnJobs.length && this.allEnemiesSpawnedAtMs === null) {
      this.allEnemiesSpawnedAtMs = this.elapsedMs
    }
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
      slowMs: 0,
      freezeMs: 0,
      poisonMs: 0,
      poisonTickCarryMs: 0,
      bleedMs: 0,
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
      if (enemy.freezeMs > 0) {
        enemy.isMoving = false
        continue
      }
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
        const speedMul = enemy.slowMs > 0 ? this.towerSlowSpeedMul : 1
        const step = movePerSpeed * Math.max(0, enemy.moveSpeed) * speedMul * dtSec
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
    const panel = Math.max(0, Math.round(enemy.attack))
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
    const maxDue = this.getMaxConsumeEnemyHitsPerTick()
    const due: PendingEnemyHit[] = []
    const pending: PendingEnemyHit[] = []
    for (const one of this.pendingEnemyHits) {
      if (one.dueAtMs <= this.elapsedMs && due.length < maxDue) due.push(one)
      else pending.push(one)
    }
    this.pendingEnemyHits = pending
    for (const one of due) {
      if (this.playerHero.hp <= 0) return
      const source = this.enemyUnits.find((it) => it.id === one.sourceEnemyUnitId && it.hp > 0)
      if (!source) continue
      this.applyEnemyDamageToPlayer(source, one.damage)
      if (source.attackType === 'melee' && source.hp > 0) {
        source.hp = 0
        EventBus.emit('battle:unit_die', {
          unitId: source.id,
          side: 'enemy',
          reason: 'impact_player',
        })
      }
      if (this.finished) return
    }
  }

  private resolveLaneOccupyCount(def: EnemyDef, lanes: number): number {
    const want = Math.max(1, Math.round(Number(def.laneOccupyCount) || 1))
    return Math.max(1, Math.min(lanes, want))
  }

  private pickSpawnLane(lanes: number, laneOccupyCount: number): number {
    if (lanes <= 1) return 0
    if (laneOccupyCount <= 1) return Math.floor(Math.random() * lanes)
    const half = Math.floor(laneOccupyCount / 2)
    const minCenter = half
    const maxCenter = Math.max(minCenter, lanes - 1 - half)
    const centerCount = Math.max(1, maxCenter - minCenter + 1)
    return minCenter + Math.floor(Math.random() * centerCount)
  }

  private getSpawnLaneCandidates(lanes: number, laneOccupyCount: number): number[] {
    if (lanes <= 1) return [0]
    if (laneOccupyCount <= 1) {
      const out = Array.from({ length: lanes }, (_, i) => i)
      this.shuffleInPlace(out)
      return out
    }
    const half = Math.floor(laneOccupyCount / 2)
    const minCenter = half
    const maxCenter = Math.max(minCenter, lanes - 1 - half)
    const out: number[] = []
    for (let lane = minCenter; lane <= maxCenter; lane++) out.push(lane)
    this.shuffleInPlace(out)
    return out
  }

  private buildWaveSpawnJobs(
    wave: { spawnDurationMs?: number; enemies?: Array<{ id: string; count: number }> },
    enemyById: Map<string, EnemyDef>,
    spawnBaseMs: number,
  ): { jobs: SpawnJob[]; totalHp: number; totalCount: number } {
    const cfg = getConfig().towerDefenseRules
    const spawnDurationMs = Math.max(100, Math.round(wave.spawnDurationMs ?? cfg?.defaultSpawnDurationMs ?? 10000))
    const normalPool: string[] = []
    const bossPool: string[] = []
    let totalHp = 0
    let totalCount = 0

    for (const rule of wave.enemies ?? []) {
      const def = enemyById.get(rule.id)
      if (!def) continue
      const count = Math.max(0, Math.round(rule.count || 0))
      if (count <= 0) continue
      const unitHp = Math.max(1, Math.round(def.hp * this.waveHpMultiplier))
      totalCount += count
      totalHp += unitHp * count
      const pool = this.isBossEnemyDef(def) ? bossPool : normalPool
      for (let i = 0; i < count; i++) pool.push(def.id)
    }

    this.shuffleInPlace(normalPool)
    this.shuffleInPlace(bossPool)

    const jobs: SpawnJob[] = []
    jobs.push(...this.buildRandomBurstJobs(normalPool, spawnDurationMs, spawnBaseMs, false))

    if (bossPool.length > 0) {
      const bossStart = Math.round(spawnDurationMs * 0.82)
      const bossWindow = Math.max(200, spawnDurationMs - bossStart)
      jobs.push(...this.buildRandomBurstJobs(bossPool, bossWindow, spawnBaseMs + bossStart, true))
    }
    return { jobs, totalHp, totalCount }
  }

  private buildRandomBurstJobs(enemyPool: string[], durationMs: number, spawnBaseMs: number, isBoss: boolean): SpawnJob[] {
    if (enemyPool.length <= 0) return []
    const jobs: SpawnJob[] = []
    const batches: Array<{ atMs: number; count: number }> = []
    const remainingTotal = enemyPool.length
    const baseGapMs = Math.max(80, durationMs / Math.max(1, remainingTotal))
    let remaining = remainingTotal
    let cursorMs = 0

    while (remaining > 0) {
      const batchCap = Math.min(remaining, isBoss ? 1 : 3)
      const batchSize = batchCap <= 1 ? 1 : (Math.floor(Math.random() * batchCap) + 1)
      batches.push({ atMs: Math.round(cursorMs), count: batchSize })
      remaining -= batchSize
      if (remaining <= 0) break
      const intervalMul = 1 + Math.floor(Math.random() * 3)
      cursorMs += baseGapMs * intervalMul
    }

    const lastAtMs = batches.length > 0 ? batches[batches.length - 1]!.atMs : 0
    const scale = lastAtMs > 0 ? durationMs / lastAtMs : 1
    let poolIdx = 0
    for (const batch of batches) {
      const spawnAtMs = spawnBaseMs + Math.round(batch.atMs * scale)
      for (let i = 0; i < batch.count; i++) {
        const enemyId = enemyPool[poolIdx++]
        if (!enemyId) continue
        jobs.push({ spawnAtMs, enemyId, isBoss })
      }
    }
    return jobs
  }

  private shuffleInPlace<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = arr[i]
      arr[i] = arr[j] as T
      arr[j] = tmp as T
    }
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
    const allowOutOfRangeAttack = this.isPlayerOutOfRangeAttackEnabled()
    for (const item of this.playerItems) {
      this.playerRangeBlockedByItemId.set(item.id, false)
      if (item.baseStats.cooldownMs <= 0) continue
      item.runtime.currentChargeMs += dtMs
      const cooldown = Math.max(1, item.baseStats.cooldownMs)
      const attackDistance = this.playerAttackDistanceByItemId.get(item.id)
      let triggerCount = Math.floor(item.runtime.currentChargeMs / cooldown)
      if (triggerCount <= 0) continue
      if (triggerCount > 4) triggerCount = 4
      const attackType = this.resolvePlayerAttackType(item)
      if (attackType === 'melee_sweep') {
        if (!hasAliveEnemy) {
          if (item.runtime.currentChargeMs > cooldown) item.runtime.currentChargeMs = cooldown
          continue
        }
        const hasTargetInRange = Boolean(this.pickNearestEnemy(attackDistance))
        if (!hasTargetInRange) {
          this.playerRangeBlockedByItemId.set(item.id, true)
          if (!allowOutOfRangeAttack) {
            if (item.runtime.currentChargeMs > cooldown) item.runtime.currentChargeMs = cooldown
            continue
          }
        }
        for (let i = 0; i < triggerCount; i++) {
          item.runtime.currentChargeMs -= cooldown
          this.pendingPlayerMeleeTriggers.push(item.id)
        }
        if (item.runtime.currentChargeMs > cooldown) item.runtime.currentChargeMs = cooldown
        continue
      }
      const hasTargetInRange = Boolean(this.pickNearestEnemy(attackDistance))
      if (!hasTargetInRange) {
        if (hasAliveEnemy) this.playerRangeBlockedByItemId.set(item.id, true)
        if (!allowOutOfRangeAttack) {
          if (item.runtime.currentChargeMs > cooldown) item.runtime.currentChargeMs = cooldown
          continue
        }
      }
      for (let i = 0; i < triggerCount; i++) {
        item.runtime.currentChargeMs -= cooldown
        this.firePlayerItemTrigger(item)
      }
      if (item.runtime.currentChargeMs > cooldown) item.runtime.currentChargeMs = cooldown
    }
    this.consumePendingPlayerMeleeTriggers()
  }

  private getPlayerMeleeQueueTriggerIntervalMs(): number {
    const cfg = getConfig().towerDefenseRules
    const raw = Number(cfg?.playerMeleeQueueTriggerIntervalMs)
    if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.round(raw))
    return this.getLogicTickMs()
  }

  private isPlayerOutOfRangeAttackEnabled(): boolean {
    return getDebugCfg('gameplayAttackOutOfRangeEnabled') >= 0.5
  }

  private consumePendingPlayerMeleeTriggers(): void {
    if (this.pendingPlayerMeleeTriggers.length <= 0) {
      this.nextPlayerMeleeTriggerAtMs = -1
      return
    }
    const stepMs = this.getPlayerMeleeQueueTriggerIntervalMs()
    const maxConsume = this.getMaxConsumeMeleeTriggersPerTick()
    let consumed = 0
    if (this.nextPlayerMeleeTriggerAtMs < 0) this.nextPlayerMeleeTriggerAtMs = this.elapsedMs
    while (this.pendingPlayerMeleeTriggers.length > 0 && this.elapsedMs >= this.nextPlayerMeleeTriggerAtMs && consumed < maxConsume) {
      const sourceItemId = this.pendingPlayerMeleeTriggers.shift()
      if (!sourceItemId) break
      const source = this.playerItems.find((it) => it.id === sourceItemId)
      if (source) this.firePlayerItemTrigger(source)
      this.nextPlayerMeleeTriggerAtMs += stepMs
      consumed += 1
    }
  }

  private firePlayerItemTrigger(item: CombatItemRunner): void {
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
    this.enqueuePlayerFireBurst(item, multicast)
    const shieldGain = this.resolveShieldGainOnItemUse(item)
    if (shieldGain > 0 && this.playerHero.hp > 0) {
      this.gainPlayerShield(item.id, shieldGain)
    }
    const heal = Math.max(0, Math.round(item.baseStats.heal))
    if (heal <= 0 || this.playerHero.hp <= 0) return
    const realHeal = Math.max(0, Math.min(this.playerHero.maxHp - this.playerHero.hp, heal))
    if (realHeal <= 0) return
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

  private resolveShieldGainOnItemUse(source: CombatItemRunner): number {
    const sourceArch = itemArchetype(findItemDef(source.defId))
    const baseShield = Math.max(0, Math.round(source.baseStats.shield))
    if (sourceArch !== '剑士') return baseShield
    let bonus = 0
    for (const swordAura of this.getPlayerItemsByIcon('toweritem22')) {
      bonus += Math.max(0, Math.round(this.resolveNumericValueFromItemLine(swordAura, /使用(?:所有)?长剑时获得护盾(?:值)?\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)/)))
    }
    const scaledBonus = Math.max(0, Math.round(bonus * this.towerWarriorDualShieldGainMul))
    return Math.max(0, baseShield + scaledBonus)
  }

  private rebuildPlayerDerivedParams(): void {
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
  }

  private getPlayerItemMulticast(item: CombatItemRunner): number {
    return Math.max(1, Math.round(item.baseStats.multicast || 1))
  }

  private resolveFinalShotDamage(source: CombatItemRunner, target: EnemyUnit, baseDamage: number, attackDistance?: number): number {
    let out = Math.max(0, Math.round(baseDamage))
    if (out <= 0) return 0
    const isArcher = itemArchetype(findItemDef(source.defId)) === '弓手'
    if (isArcher && this.getPlayerItemsByIcon('toweritem11').length > 0) {
      const maxDistance = Math.max(4, Number(attackDistance) || 60)
      const clamped = Math.max(4, Math.min(maxDistance, Number(target.distance) || 0))
      const p = maxDistance <= 4 ? 1 : (clamped - 4) / (maxDistance - 4)
      let maxBonusPct = 100
      for (const one of this.getPlayerItemsByIcon('toweritem11')) {
        const bonus = Math.max(0, this.resolveNumericValueFromItemLine(one, /最高\+\s*([+\-]?\d+(?:\.\d+)?(?:%?[\/|][+\-]?\d+(?:\.\d+)?)*%?)\s*%/))
        if (bonus > 0) maxBonusPct = Math.max(maxBonusPct, bonus)
      }
      const mul = 1 + ((maxBonusPct * Math.max(1, this.towerArcherSniperBonusMul)) / 100) * Math.max(0, Math.min(1, p))
      out = Math.max(0, Math.round(out * mul))
    }
    return out
  }

  private resolvePlayerItemAttackDistance(item: CombatItemRunner): number {
    const cfg = getConfig().towerDefenseRules
    const meterToDistance = this.getMeterToDistance()
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
        const tierIndex = this.resolveSeriesTierIndex(item, def)
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
      if (this.getItemIcon(one) !== 'toweritem20') continue
      rangeBonusMeters += Math.max(0, this.resolveNumericValueFromItemLine(one, /长剑攻击距离\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)/))
    }
    return Math.max(0, Math.round(baseDistance + (rangeBonusMeters + this.towerWarriorRangeBonusMeters) * meterToDistance))
  }

  private resolvePlayerItemUseDamageBonus(item: CombatItemRunner): number {
    const def = findItemDef(item.defId)
    if (!def) return 0
    const lines = skillLines(def)
    if (lines.length <= 0) return 0
    const tierIndex = this.resolveSeriesTierIndex(item, def)
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

  private resolveSeriesTierIndex(item: CombatItemRunner, def: ReturnType<typeof findItemDef>): number {
    const rawLevel = Number(item.level)
    if (Number.isFinite(rawLevel) && rawLevel > 0) {
      return Math.max(0, Math.min(4, Math.round(rawLevel) - 1))
    }
    return tierIndexFromRaw(def, item.tier)
  }

  private resolvePlayerAttackType(item: CombatItemRunner): 'melee_sweep' | 'line_projectile' | 'spin_projectile' {
    const style = String(findItemDef(item.defId)?.attack_style || '').trim()
    if (style.includes('近战') || style.includes('挥动')) return 'melee_sweep'
    if (style.includes('旋转')) return 'spin_projectile'
    if (style.includes('直线')) return 'line_projectile'
    return 'line_projectile'
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
      const tierIdx = this.resolveSeriesTierIndex(item, def)
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
  }

  private applyPostItemUseEffects(source: CombatItemRunner): void {
    void source
  }

  private applyPostPlayerFireEffects(source: CombatItemRunner): void {
    void source
  }

  private applyPostPlayerDamageEffects(source: CombatItemRunner, damageRaw: number, target?: EnemyUnit): void {
    const damage = Math.max(0, Math.round(damageRaw))
    if (damage <= 0) return
    const sourceArch = itemArchetype(findItemDef(source.defId))

    if (target && sourceArch === '忍者') {
      const slowMs = this.resolveNinjaSlowDurationMs()
      if (slowMs > 0) target.slowMs = Math.max(target.slowMs, slowMs)
    }

    if (target && sourceArch === '弓手') {
      const poisonMs = this.resolveArcherPoisonDurationMs()
      if (poisonMs > 0) target.poisonMs = Math.max(target.poisonMs, poisonMs)
    }

    if (target && sourceArch === '冰法师') {
      const slowMs = this.resolveIceSlowDurationMs(source)
      if (slowMs > 0) target.slowMs = Math.max(target.slowMs, slowMs)

      const freezeChance = this.resolveIceFreezeChance(target)
      if (freezeChance > 0 && target.freezeMs <= 0 && Math.random() < freezeChance) {
        target.freezeMs = Math.max(target.freezeMs, this.getIceFreezeDurationMs())
      }
    }

    if (target && sourceArch === '剑士') {
      const bleedMs = this.resolveSwordBleedDurationMs()
      if (bleedMs > 0) target.bleedMs = Math.max(target.bleedMs, bleedMs)
    }

  }

  private applySpikeShieldReflect(attacker: EnemyUnit, shieldBeforeHit: number): void {
    const shieldNow = Math.max(0, Math.round(shieldBeforeHit))
    if (shieldNow <= 0) return
    const spikedShields = this.getPlayerItemsByIcon('toweritem24')
    if (spikedShields.length <= 0) return
    let totalPct = 0
    for (const one of spikedShields) {
      totalPct += Math.max(0, this.resolveNumericValueFromItemLine(one, /护盾值\s*([+\-]?\d+(?:\.\d+)?(?:%?[\/|][+\-]?\d+(?:\.\d+)?)*%?)\s*%?\s*的反伤/))
    }
    if (totalPct <= 0) return
    const reflectDamage = Math.max(0, Math.round(shieldNow * totalPct / 100 * this.towerWarriorReflectMul))
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

    let extraBounceCount = this.towerNinjaSuperBounceExtraCount
    for (const one of this.getPlayerItemsByIcon('toweritem2')) {
      extraBounceCount += Math.max(0, Math.round(this.resolveNumericValueFromItemLine(one, /弹射次数\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)/)))
    }
    const hasNoDecayBounce = this.getPlayerItemsByIcon('toweritem5').length > 0
    for (const one of this.getPlayerItemsByIcon('toweritem6')) {
      this.playerFirstBounceSplitBonus += Math.max(0, Math.round(this.resolveNumericValueFromItemLine(one, /(?:分裂\D*额外\+?|分裂\s*)([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)\s*(?:次|目标)/)))
    }

    for (const item of this.playerItems) {
      const icon = this.getItemIcon(item)
      const archetype = itemArchetype(findItemDef(item.defId))
      const isNinjaDamage = archetype === '忍者' && item.baseStats.damage > 0
      const baseBounce = isNinjaDamage ? 1 : 0
      const totalBounce = baseBounce + (isNinjaDamage ? extraBounceCount : 0)
      this.playerBounceCountByItemId.set(item.id, Math.max(0, totalBounce))
      this.playerBounceDamageBonusPerHopByItemId.set(item.id, 0)
      const bounceFactor = hasNoDecayBounce
        ? (1 + Math.max(0, this.towerNinjaCrystalBounceBonusPct) / 100)
        : 0.7
      this.playerBounceDamageFactorByItemId.set(item.id, isNinjaDamage ? bounceFactor : 1)
      void icon
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

  private pickNearestEnemyByPredictedHp(predictedHpById: Map<string, number>, maxDistance?: number, prioritizeBoss = false): EnemyUnit | null {
    let hit: EnemyUnit | null = null
    const useRange = typeof maxDistance === 'number' && Number.isFinite(maxDistance) && maxDistance > 0
    for (const enemy of this.enemyUnits) {
      const hpLeft = predictedHpById.get(enemy.id)
      if (typeof hpLeft !== 'number' || hpLeft <= 0) continue
      if (useRange && enemy.distance > maxDistance) continue
      if (!hit) {
        hit = enemy
        continue
      }
      if (prioritizeBoss) {
        const enemyBoss = this.isBossEnemyUnit(enemy)
        const hitBoss = this.isBossEnemyUnit(hit)
        if (enemyBoss !== hitBoss) {
          if (enemyBoss) hit = enemy
          continue
        }
      }
      if (enemy.distance < hit.distance) hit = enemy
    }
    return hit
  }

  private pickNearestEnemiesByPredictedHp(predictedHpById: Map<string, number>, count: number, maxDistance?: number, prioritizeBoss = false): EnemyUnit[] {
    const want = Math.max(1, Math.round(count || 1))
    const useRange = typeof maxDistance === 'number' && Number.isFinite(maxDistance) && maxDistance > 0
    const candidates = this.enemyUnits.filter((enemy) => {
      const hpLeft = predictedHpById.get(enemy.id)
      if (typeof hpLeft !== 'number' || hpLeft <= 0) return false
      if (useRange && enemy.distance > maxDistance) return false
      return true
    })
    candidates.sort((a, b) => {
      if (prioritizeBoss) {
        const aBoss = this.isBossEnemyUnit(a)
        const bBoss = this.isBossEnemyUnit(b)
        if (aBoss !== bBoss) return aBoss ? -1 : 1
      }
      if (a.distance !== b.distance) return a.distance - b.distance
      return a.id.localeCompare(b.id)
    })
    return candidates.slice(0, want)
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

  private getQueuePendingHitsSoftCap(): number {
    const rules = getConfig().towerDefenseRules as unknown as Record<string, unknown>
    const raw = Number(rules.queuePendingHitsSoftCap)
    if (Number.isFinite(raw) && raw > 0) return Math.max(20, Math.round(raw))
    return 220
  }

  private getQueuePendingFiresSoftCap(): number {
    const rules = getConfig().towerDefenseRules as unknown as Record<string, unknown>
    const raw = Number(rules.queuePendingFiresSoftCap)
    if (Number.isFinite(raw) && raw > 0) return Math.max(10, Math.round(raw))
    return 120
  }

  private getMaxConsumePlayerFiresPerTick(): number {
    const rules = getConfig().towerDefenseRules as unknown as Record<string, unknown>
    const raw = Number(rules.queueConsumePlayerFiresPerTickMax)
    if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.round(raw))
    return 36
  }

  private getMaxConsumePlayerHitsPerTick(): number {
    const rules = getConfig().towerDefenseRules as unknown as Record<string, unknown>
    const raw = Number(rules.queueConsumePlayerHitsPerTickMax)
    if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.round(raw))
    return 80
  }

  private getMaxConsumeEnemyHitsPerTick(): number {
    const rules = getConfig().towerDefenseRules as unknown as Record<string, unknown>
    const raw = Number(rules.queueConsumeEnemyHitsPerTickMax)
    if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.round(raw))
    return 64
  }

  private getMaxConsumeMeleeTriggersPerTick(): number {
    const rules = getConfig().towerDefenseRules as unknown as Record<string, unknown>
    const raw = Number(rules.queueConsumeMeleeTriggersPerTickMax)
    if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.round(raw))
    return 24
  }

  private enqueuePlayerFireBurst(source: CombatItemRunner, repeatCount: number): void {
    const count = Math.max(1, Math.round(repeatCount || 1))
    const sourceArch = itemArchetype(findItemDef(source.defId))
    if (sourceArch === '冰法师' && count > 1) {
      this.pendingPlayerFires.push({
        dueAtMs: this.elapsedMs,
        sourceItemId: source.id,
        burstCount: count,
        splitTargets: true,
      })
      return
    }
    const stepMs = this.getLogicTickMs()
    for (let i = 0; i < count; i++) {
      this.pendingPlayerFires.push({
        dueAtMs: this.elapsedMs + i * stepMs,
        sourceItemId: source.id,
      })
    }
  }

  private consumePendingPlayerFires(): void {
    if (this.pendingPlayerFires.length <= 0) return
    const maxDue = this.getMaxConsumePlayerFiresPerTick()
    const due: PendingPlayerFire[] = []
    const pending: PendingPlayerFire[] = []
    for (const one of this.pendingPlayerFires) {
      if (one.dueAtMs <= this.elapsedMs && due.length < maxDue) due.push(one)
      else pending.push(one)
    }
    this.pendingPlayerFires = pending
    const predictedHpById = this.buildPredictedEnemyHpById()
    for (const one of due) {
      const source = this.playerItems.find((it) => it.id === one.sourceItemId)
      if (!source) continue
      const sourceArch = itemArchetype(findItemDef(source.defId))
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
        const dualSword = itemArchetype(findItemDef(source.defId)) === '剑士' && this.getPlayerItemsByIcon('toweritem23').length > 0
        const sweepDirections: Array<'ltr' | 'rtl'> = dualSword ? ['ltr', 'rtl'] : ['ltr']
        for (const sweepDirection of sweepDirections) {
          EventBus.emit('battle:item_fire', {
            itemId: source.defId,
            sourceItemId: source.id,
            side: 'player',
            multicast: 1,
            targetId: sweepTargets[0]?.id,
            targetSide: 'enemy',
            attackType: 'melee_sweep',
            attackDistance,
            meleeSweepDirection: sweepDirection,
          })
        }
        if (sweepTargets.length <= 0) {
          this.applyPostItemUseEffects(source)
          this.applyPostPlayerFireEffects(source)
          const useDamageBonus = this.playerUseDamageBonusByItemId.get(source.id)
          if (useDamageBonus && useDamageBonus > 0) {
            source.baseStats.damage += useDamageBonus
          }
          continue
        }
        for (const sweepDirection of sweepDirections) {
          const laneOrder = [...new Set(sweepTargets.map((it) => it.lane))].sort((a, b) => {
            return sweepDirection === 'rtl' ? (b - a) : (a - b)
          })
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
        }
      } else {
        const burstCount = Math.max(1, Math.round(one.burstCount || 1))
        const splitTargets = one.splitTargets === true
        const prioritizeBossTarget = sourceArch === '冰法师'
        const targets = splitTargets
          ? this.pickNearestEnemiesByPredictedHp(predictedHpById, burstCount, attackDistance, prioritizeBossTarget)
          : ((): EnemyUnit[] => {
              const oneTarget = this.pickNearestEnemyByPredictedHp(predictedHpById, attackDistance, prioritizeBossTarget)
              return oneTarget ? [oneTarget] : []
            })()
        if (targets.length <= 0) {
          EventBus.emit('battle:item_fire', {
            itemId: source.defId,
            sourceItemId: source.id,
            side: 'player',
            multicast: 1,
            targetSide: 'enemy',
            projectileFlyMs: this.getPlayerProjectileFlyMs(),
            attackType,
            attackDistance,
          })
          this.applyPostItemUseEffects(source)
          this.applyPostPlayerFireEffects(source)
          const useDamageBonus = this.playerUseDamageBonusByItemId.get(source.id)
          if (useDamageBonus && useDamageBonus > 0) {
            source.baseStats.damage += useDamageBonus
          }
          continue
        }
        for (const target of targets) {
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
    const maxDue = this.getMaxConsumePlayerHitsPerTick()
    const due: PendingPlayerHit[] = []
    const pending: PendingPlayerHit[] = []
    for (const one of this.pendingPlayerHits) {
      if (one.dueAtMs <= this.elapsedMs && due.length < maxDue) due.push(one)
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
    const sourceArch = itemArchetype(findItemDef(source.defId))
    if (sourceArch === '忍者' && damage > 0) {
      const factor = Math.max(0, 1 - (this.playerNinjaDamagePenaltyPct / 100))
      damage = Math.max(1, Math.round(damage * factor))
    }
    if (sourceArch === '弓手' && damage > 0) {
      const factor = Math.max(0, 1 - (this.playerArcherDamagePenaltyPct / 100))
      damage = Math.max(1, Math.round(damage * factor))
    }
    if (sourceArch === '剑士' && damage > 0) {
      const factor = Math.max(0, 1 - (this.playerWarriorDamagePenaltyPct / 100))
      damage = Math.max(1, Math.round(damage * factor))
    }
    if (sourceArch === '弓手' && this.getPlayerItemsByIcon('toweritem12').length > 0) {
      // 由命中目标时按“全体弓箭共享目标连击层数”结算，发射前不预加成
    }
    if (damage <= 0) return 0
    return Math.max(0, Math.round(damage))
  }

  private resolveArcherComboBonusPerHit(): number {
    let bonus = 0
    for (const one of this.getPlayerItemsByIcon('toweritem12')) {
      bonus += Math.max(0, Math.round(this.resolveNumericValueFromItemLine(one, /伤害\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)/)))
    }
    return Math.max(0, bonus)
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
      let nextDamage = Math.max(0, bounced + bonus)
      if (nextHop === 1 && currentHit.firstBounceSplitBonus > 0 && this.towerNinjaSplitDamageMul > 1) {
        nextDamage = Math.max(0, Math.round(nextDamage * this.towerNinjaSplitDamageMul))
      }
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

  private resolveNinjaSlowDurationMs(): number {
    let sec = 0
    for (const one of this.getPlayerItemsByIcon('toweritem4')) {
      sec += Math.max(0, this.resolveNumericValueFromItemLine(one, /减速\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)\s*秒/))
    }
    return Math.max(0, Math.round(sec * 1000))
  }

  private resolveArcherPoisonDurationMs(): number {
    let sec = 0
    for (const one of this.getPlayerItemsByIcon('toweritem10')) {
      sec += Math.max(0, this.resolveNumericValueFromItemLine(one, /中毒\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)\s*秒/))
    }
    return Math.max(0, Math.round(sec * 1000))
  }

  private resolveIceSlowDurationMs(source: CombatItemRunner): number {
    let sec = Math.max(0, this.resolveNumericValueFromItemLine(source, /减速\s*[:：]\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)\s*秒/))
    for (const one of this.getPlayerItemsByIcon('toweritem14')) {
      sec += Math.max(0, this.resolveNumericValueFromItemLine(one, /减速时间\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)\s*秒/))
    }
    return Math.max(0, Math.round(sec * 1000))
  }

  private resolveIceExtraDamageVsSlowed(): number {
    let total = 0
    for (const one of this.getPlayerItemsByIcon('toweritem14')) {
      total += Math.max(0, Math.round(this.resolveNumericValueFromItemLine(one, /额外伤害\+\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)/)))
    }
    return Math.max(0, total)
  }

  private resolveIceFreezeChance(target: EnemyUnit): number {
    let totalPct = 0
    for (const one of this.getPlayerItemsByIcon('toweritem16')) {
      totalPct += Math.max(0, this.resolveNumericValueFromItemLine(one, /([+\-]?\d+(?:\.\d+)?(?:%?[\/|][+\-]?\d+(?:\.\d+)?)*%?)\s*%?\s*几率冰冻/))
    }
    totalPct += Math.max(0, this.towerMageFreezeChanceBonusPct)
    if (totalPct <= 0) return 0
    const chance = this.isBossEnemyUnit(target) ? (totalPct * 0.2 / 100) : (totalPct / 100)
    return Math.max(0, Math.min(1, chance))
  }

  private getIceFreezeDurationMs(): number {
    const baseSec = this.resolveIceFreezeBaseDurationSec()
    return Math.max(200, Math.round(baseSec * 1000 * Math.max(1, this.towerMageFreezeDurationMul)))
  }

  private resolveIceFreezeBaseDurationSec(): number {
    let sec = 0
    for (const one of this.getPlayerItemsByIcon('toweritem16')) {
      sec = Math.max(sec, Math.max(0, this.resolveNumericValueFromItemLine(one, /几率冰冻\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)\s*秒/)))
    }
    if (sec <= 0) return 1
    return sec
  }

  private resolveSwordBleedDurationMs(): number {
    let sec = 0
    for (const one of this.getPlayerItemsByIcon('toweritem21')) {
      sec += Math.max(0, this.resolveNumericValueFromItemLine(one, /流血\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)\s*秒/))
    }
    return Math.max(0, Math.round(sec * 1000))
  }

  private applyIceExplosionSplash(source: CombatItemRunner, primaryTarget: EnemyUnit, damage: number): void {
    if (itemArchetype(findItemDef(source.defId)) !== '冰法师') return
    if (this.getPlayerItemsByIcon('toweritem17').length <= 0) return
    const meterToDistance = this.getMeterToDistance()
    const radiusMeters = Math.max(1, this.towerMageExplosionRadiusMeters)
    const laneMeters = 3
    const centerX = primaryTarget.lane * laneMeters
    const centerY = primaryTarget.distance / meterToDistance
    for (const enemy of this.enemyUnits) {
      if (enemy.id === primaryTarget.id || enemy.hp <= 0) continue
      const dx = (enemy.lane * laneMeters) - centerX
      const dy = (enemy.distance / meterToDistance) - centerY
      if (Math.hypot(dx, dy) > radiusMeters) continue
      this.applyPlayerDamageToEnemy(source, enemy, damage, true)
      if (this.finished) return
    }
  }

  private applyPlayerDamageToEnemy(source: CombatItemRunner, enemy: EnemyUnit, damage: number, fromSplash = false): void {
    const baseDamage = Math.max(0, Math.round(damage))
    if (baseDamage <= 0) return
    let finalDamage = baseDamage
    const sourceArch = itemArchetype(findItemDef(source.defId))
    if (sourceArch === '忍者' && enemy.slowMs > 0 && this.towerNinjaVsSlowedMul > 1) {
      finalDamage = Math.max(1, Math.round(finalDamage * this.towerNinjaVsSlowedMul))
    }
    if (sourceArch === '弓手' && this.getPlayerItemsByIcon('toweritem12').length > 0) {
      const nextComboCount = (this.bloodBowComboByTargetId.get(enemy.id) ?? 0) + 1
      this.bloodBowComboByTargetId.set(enemy.id, nextComboCount)
      const bonusPerHit = Math.max(0, Math.round(this.resolveArcherComboBonusPerHit() * this.towerArcherBloodBonusMul))
      const comboBonus = Math.max(0, nextComboCount - 1) * bonusPerHit
      if (comboBonus > 0) finalDamage += comboBonus
    }
    if (sourceArch === '冰法师' && enemy.slowMs > 0) {
      const bonus = this.resolveIceExtraDamageVsSlowed()
      if (bonus > 0) finalDamage += bonus
    }
    if (enemy.bleedMs > 0) {
      const bleedMul = this.isBossEnemyUnit(enemy) ? this.towerWarriorBleedMulBoss : this.towerWarriorBleedMulNormal
      finalDamage = Math.max(1, Math.round(finalDamage * bleedMul))
    }
    enemy.hp = Math.max(0, enemy.hp - finalDamage)
    EventBus.emit('battle:take_damage', {
      targetId: enemy.id,
      sourceItemId: source.id,
      amount: finalDamage,
      isCrit: false,
      type: 'normal',
      targetType: 'item',
      targetSide: 'enemy',
      sourceType: 'item',
      sourceSide: 'player',
      baseDamage,
      finalDamage,
    })
    this.applyPostPlayerDamageEffects(source, finalDamage, enemy)
    if (!fromSplash) this.applyIceExplosionSplash(source, enemy, finalDamage)
    if (enemy.hp <= 0) {
      this.bloodBowComboByTargetId.delete(enemy.id)
      this.totalWaveHpKilled += enemy.maxHp
      EventBus.emit('battle:unit_die', {
        unitId: enemy.id,
        side: 'enemy',
          bonusGoldPct: 0,
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
    if (this.getPlayerItemsByIcon('toweritem18').length > 0) {
      let chargeMs = 0
      for (const one of this.getPlayerItemsByIcon('toweritem18')) {
        const sec = Math.max(0, this.resolveNumericValueFromItemLine(one, /充能\s*([+\-]?\d+(?:\.\d+)?(?:[\/|][+\-]?\d+(?:\.\d+)?)*)\s*秒/))
        chargeMs += Math.round(sec * 1000)
      }
      if (chargeMs <= 0) chargeMs = 1000
      chargeMs = Math.max(0, Math.round(chargeMs * this.towerMageCounterChargeMul))
      for (const one of this.playerItems) {
        if (itemArchetype(findItemDef(one.defId)) !== '冰法师') continue
        this.addChargeToItem(one, chargeMs)
      }
    }
    this.applySpikeShieldReflect(enemy, shieldBeforeHit)
  }

  private cleanupDeadEnemies(): void {
    if (this.enemyUnits.length <= 0) return
    const aliveIds = new Set(this.enemyUnits.filter((it) => it.hp > 0).map((it) => it.id))
    for (const targetId of this.bloodBowComboByTargetId.keys()) {
      if (!aliveIds.has(targetId)) this.bloodBowComboByTargetId.delete(targetId)
    }
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
