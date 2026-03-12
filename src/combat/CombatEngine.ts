import { EventBus } from '@/core/EventBus'
import type { BattleSnapshotBundle } from '@/combat/BattleSnapshotStore'
import { getConfig } from '@/core/DataLoader'
export type { CombatPhase, CombatResult, CombatBoardItem, CombatItemRuntimeState } from './CombatTypes'
import type {
  CombatPhase, CombatResult, HeroState, CombatItemRunner, CombatItemRuntimeState,

  CombatStartOptions,
  CombatBoardItem, CombatState
} from './CombatTypes'
import { createCombatState } from './CombatTypes'
import {
  DEBUG_SHIELD_CHARGE, HERO_MAX_HP_CAP, HERO_SHIELD_CAP, ITEM_DAMAGE_CAP,
  pickTierSeriesValue, makeSeededRng, tierIndexFromRaw, parseControlSpecsFromDef, rv,
  findItemDef, skillLines, tierValueFromLine, isAdjacentByFootprint, isShieldItem, isAmmoItem,
  isDamageBonusEligible, itemArchetype, hasLine, isItemDestroyImmune,
  seedFrom,
} from './CombatHelpers'
export { setCombatRuntimeOverride } from './CombatHelpers'
import { makeEnemyRunners, toRunner } from './EnemyBuilder'
import { SkillTriggerSystem, type ICombatEngineBase } from './SkillTriggerSystem'
import { ItemTriggerSystem, type IItemTriggerEngineBase } from './ItemTriggerSystem'

export class CombatEngine {
  private state: CombatState = createCombatState()
  private skillSystem: SkillTriggerSystem = new SkillTriggerSystem(this.state, this as unknown as ICombatEngineBase)
  private itemSystem: ItemTriggerSystem = new ItemTriggerSystem(this.state, this as unknown as IItemTriggerEngineBase)
  // ── 技能/英雄辅助（CombatEngine 内部使用，与 SkillTriggerSystem 共享逻辑）
  private hasPlayerSkill(id: string): boolean { return this.state.playerSkillIds.has(id) }
  private hasEnemySkill(id: string): boolean { return this.state.enemySkillIds.has(id) }
  private hasSkill(side: 'player' | 'enemy', id: string): boolean {
    return side === 'player' ? this.state.playerSkillIds.has(id) : this.state.enemySkillIds.has(id)
  }
  private heroOf(side: 'player' | 'enemy'): HeroState {
    return side === 'player' ? this.state.playerHero : this.state.enemyHero
  }
  private(side: 'player' | 'enemy'): 'player' | 'enemy' {
    return side === 'player' ? 'enemy' : 'player'
  }
  private isHeroInvincible(side: 'player' | 'enemy'): boolean {
    return this.state.heroInvincibleMsBySide[side] > 0
  }


  private debugShieldChargeLog(msg: string, extra?: Record<string, unknown>): void {
    if (!DEBUG_SHIELD_CHARGE) return
    const payload = extra ? ` ${JSON.stringify(extra)}` : ''
    const line = `[CombatEngine][shield-charge][护盾充能] ${msg}${payload}`
    console.warn(line)
  }

  start(snapshot: BattleSnapshotBundle, options?: CombatStartOptions): void {
    this.reset()
    const cfg = getConfig()
    this.state.day = snapshot.day
    const enemyHpRow = cfg.dailyEnemyHealth ?? cfg.dailyHealth
    const playerHpRow = cfg.dailyPlayerHealth ?? enemyHpRow
    const hpIdx = Math.max(0, Math.min(enemyHpRow.length - 1, snapshot.day - 1))
    const enemyHpBase = enemyHpRow[hpIdx] ?? enemyHpRow[0] ?? 300
    const playerHpByDay = playerHpRow[Math.max(0, Math.min(playerHpRow.length - 1, snapshot.day - 1))] ?? playerHpRow[0] ?? enemyHpBase
    const playerHp = Math.max(1, Math.round(Number(snapshot.playerBattleHp ?? playerHpByDay) || playerHpByDay))
    // PVP 时使用对手快照中已含英雄加成的 pvpEnemyBattleHp，确保双端 HP 一致
    const enemyHp = snapshot.pvpEnemyEntities
      ? Math.max(1, Math.round(Number(snapshot.pvpEnemyBattleHp ?? enemyHpBase) || enemyHpBase))
      : enemyHpBase

    this.state.playerHero = { id: 'hero_player', side: 'player', maxHp: playerHp, hp: playerHp, shield: 0, burn: 0, poison: 0, regen: 0 }
    this.state.enemyHero = { id: 'hero_enemy', side: 'enemy', maxHp: enemyHp, hp: enemyHp, shield: 0, burn: 0, poison: 0, regen: 0 }

    const enemyRunners = options?.enemyDisabled ? [] :
      (snapshot.pvpEnemyEntities
        ? snapshot.pvpEnemyEntities.map((it, idx) => ({ ...toRunner(it, `E-${idx}`), side: 'enemy' as const }))
        : makeEnemyRunners(this.state.day, snapshot))
    this.state.items = [
      ...snapshot.entities.map((it, idx) => toRunner(it, `P-${idx}`)),
      ...enemyRunners,
    ]

    this.state.playerSkillIds = new Set((options?.playerSkillIds ?? []).map((id) => `${id}`.trim()).filter(Boolean))
    this.state.enemySkillIds = new Set((options?.enemySkillIds ?? []).map((id) => `${id}`.trim()).filter(Boolean))
    // PVP 模式（pvpEnemyEntities 存在）时不随机生成敌方技能，使用对手传来的 pvpEnemySkillIds（可能为空）
    const isPvpBattle = !!snapshot.pvpEnemyEntities
    if (!options?.enemyDisabled && this.state.enemySkillIds.size <= 0 && !isPvpBattle) {
      this.state.enemySkillIds = this.skillSystem.rollEnemySkillIds(snapshot)
    }
    this.state.skillEnemyHalfTriggered = false
    this.state.skillPlayerHalfTriggered = false
    this.state.skillEnemySelfHalfTriggered = false
    this.state.skillEnemyHalfTriggeredFromEnemy = false
    this.state.skillPlayerHalfShieldTriggered = false
    this.state.skillEnemyHalfShieldTriggered = false
    this.state.skillPlayerHalfShieldCdTriggered = false
    this.state.skillEnemyHalfShieldCdTriggered = false
    this.state.skillFirstAmmoEmptyTriggeredBySide = { player: false, enemy: false }
    this.state.skill47ReviveTriggeredBySide = { player: false, enemy: false }
    this.state.deathMarkCheckUsedBySide = { player: false, enemy: false }
    this.state.unyieldingTriggeredBySide = { player: false, enemy: false }
    this.state.heroInvincibleMsBySide = { player: 0, enemy: 0 }
    this.state.skill86UseCountBySide = { player: 0, enemy: 0 }
    this.state.skillExecuteDamageBonus = 0
    this.state.skillEnemyExecuteDamageBonus = 0
    this.state.skill33RegenPerTick = 0
    this.state.skillEnemy33RegenPerTick = 0
    this.state.playerBackpackItemCount = Math.max(
      0,
      Math.round(options?.playerBackpackItemCount ?? snapshot.playerBackpackItemCount ?? 0),
    )
    this.state.playerActiveColCount = Math.max(1, Math.round(snapshot.activeColCount || 1))
    this.state.playerGoldAtBattleStart = Math.max(0, Math.round(options?.playerGold ?? snapshot.playerGold ?? 0))
    this.state.playerTrophyWinsAtBattleStart = Math.max(0, Math.round(options?.playerTrophyWins ?? snapshot.playerTrophyWins ?? 0))
    this.state.enemyBackpackItemCount = Math.max(0, Math.round(options?.enemyBackpackItemCount ?? snapshot.pvpEnemyBackpackItemCount ?? 0))
    this.state.enemyGoldAtBattleStart = Math.max(0, Math.round(options?.enemyGold ?? snapshot.pvpEnemyGold ?? 0))
    this.state.enemyTrophyWinsAtBattleStart = Math.max(0, Math.round(options?.enemyTrophyWins ?? snapshot.pvpEnemyTrophyWins ?? 0))

    this.skillSystem.applyPickedSkillBattleStartEffects()
    this.applyBattleStartEffects()
    this.clampCombatCaps()

    this.state.phase = 'INIT'
  }

  update(dt: number): void {
    if (this.state.phase === 'IDLE' || this.state.phase === 'END') return
    const cfg = getConfig().combatRuntime
    const deltaMs = dt * 1000
    this.state.elapsedMs += deltaMs

    if (this.state.phase === 'INIT') {
      this.state.phase = 'SETUP'
      return
    }
    if (this.state.phase === 'SETUP') {
      this.state.phase = 'TICK'
      return
    }

    if (this.state.phase === 'TICK') {
      const fatigueStartMs = Math.max(0, rv('fatigueStartMs', cfg.fatigueStartMs ?? cfg.timeoutMs ?? 40000))
      const fatigueIntervalMs = Math.max(1, rv('fatigueTickMs', cfg.fatigueTickMs ?? cfg.fatigueIntervalMs ?? 1000))

      if (!this.state.inFatigue && this.state.elapsedMs >= fatigueStartMs) {
        this.state.inFatigue = true
        EventBus.emit('battle:fatigue_start', { elapsedMs: this.state.elapsedMs })
      }

      if (this.shouldResolve()) {
        this.state.phase = 'RESOLVE'
      }
      if (this.state.phase === 'RESOLVE') {
        this.finishCombat()
        return
      }

      this.state.tickAccumulatorMs += deltaMs
      while (this.state.tickAccumulatorMs >= cfg.tickMs) {
        this.state.tickAccumulatorMs -= cfg.tickMs
        this.stepOneTick(cfg.tickMs)
        if (this.shouldResolve()) {
          this.state.phase = 'RESOLVE'
          break
        }
        if (this.state.inFatigue) {
          this.state.fatigueAccumulatorMs += cfg.tickMs
          while (this.state.fatigueAccumulatorMs >= fatigueIntervalMs) {
            this.state.fatigueAccumulatorMs -= fatigueIntervalMs
            this.stepFatigue()
            if (this.shouldResolve()) {
              this.state.phase = 'RESOLVE'
              break
            }
          }
          if (this.state.phase === 'RESOLVE') break
        }
      }
    }

    if (this.state.phase === 'RESOLVE') this.finishCombat()
  }

  getPhase(): CombatPhase {
    return this.state.phase
  }

  isFinished(): boolean {
    return this.state.finished
  }

  getResult(): CombatResult | null {
    return this.state.result ? { ...this.state.result } : null
  }

  getEnemySkillIds(): string[] {
    return Array.from(this.state.enemySkillIds)
  }

  getDebugState(): { tickIndex: number; playerAlive: number; enemyAlive: number; playerHp: number; enemyHp: number; inFatigue: boolean; enemySkillCount: number } {
    return {
      tickIndex: this.state.tickIndex,
      playerAlive: this.state.playerHero.hp > 0 ? 1 : 0,
      enemyAlive: this.state.enemyHero.hp > 0 ? 1 : 0,
      playerHp: this.state.playerHero.hp,
      enemyHp: this.state.enemyHero.hp,
      inFatigue: this.state.inFatigue,
      enemySkillCount: this.state.enemySkillIds.size,
    }
  }

  getBoardState(): { player: HeroState; enemy: HeroState; items: CombatBoardItem[] } {
    const playerRegenDisplay = this.state.playerHero.regen + (this.hasPlayerSkill('skill33') ? Math.max(0, this.state.skill33RegenPerTick) : 0)
    const enemyRegenDisplay = this.state.enemyHero.regen + (this.hasEnemySkill('skill33') ? Math.max(0, this.state.skillEnemy33RegenPerTick) : 0)
    return {
      player: { ...this.state.playerHero, regen: playerRegenDisplay },
      enemy: { ...this.state.enemyHero, regen: enemyRegenDisplay },
      items: this.state.items.map((it) => ({
        id: it.id,
        side: it.side,
        defId: it.defId,
        col: it.col,
        row: it.row,
        size: it.size,
        tier: it.tier,
        tierStar: it.tierStar,
        chargeRatio: Math.max(0, Math.min(1, it.runtime.currentChargeMs / Math.max(1, this.effectiveCooldownMs(it)))),
      })),
    }
  }

  getRuntimeState(): CombatItemRuntimeState[] {
    return this.state.items.map((it) => ({
      ...(() => {
        const skillMul = this.skillDamageMultiplier(it)
        const baseDamageRaw = Math.max(0, it.baseStats.damage + this.runtimeGlobalDamageBonus(it))
        const baseDamageUnscaled = Math.max(0, Math.round(baseDamageRaw * skillMul))
        let runtimeDamage = this.scaledDamage(it, baseDamageUnscaled + it.runtime.tempDamageBonus)
        const def = findItemDef(it.defId)
        if (def && skillLines(def).some((s) => /相邻回旋镖时伤害翻倍/.test(s))) {
          const hasAdjacentSame = this.state.items.some((other) =>
            other.id !== it.id
            && other.side === it.side
            && other.defId === it.defId
            && isAdjacentByFootprint(other, it),
          )
          if (hasAdjacentSame) runtimeDamage *= 2
        }
        if (def) {
          const tIdx = tierIndexFromRaw(def, it.tier)
          const lines = skillLines(def)
          const sourceHero = it.side === 'player' ? this.state.playerHero : this.state.enemyHero
          const targetHero = it.side === 'player' ? this.state.enemyHero : this.state.playerHero
          if (lines.some((s) => /等同于当前自身护盾值|根据当前护盾值对对方造成伤害/.test(s))) {
            runtimeDamage += Math.max(0, sourceHero.shield)
          }
          const maxHpLine = lines.find((s) => /最大生命值.*%.*伤害/.test(s) && !/摧毁自身/.test(s) && !/第一次攻击/.test(s))
          if (maxHpLine) {
            const m = maxHpLine.match(/最大生命值\s*([+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*)\s*的伤害/)
            if (m?.[1]) {
              const pct = /[\/|]/.test(m[1]) ? pickTierSeriesValue(m[1], tIdx) : Number(m[1].replace(/%$/u, ''))
              if (Number.isFinite(pct) && pct > 0) {
                runtimeDamage += Math.round(targetHero.maxHp * (pct / 100))
              }
            }
          }
          const firstHitLine = lines.find((s) => /第一次攻击额外造成目标最大生命值[+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*的伤害/.test(s))
          if (firstHitLine && it.runtime.executeCount < 1) {
            const pct = Math.max(0, tierValueFromLine(firstHitLine, tIdx))
            if (pct > 0) runtimeDamage += Math.round(targetHero.maxHp * (pct / 100))
          }
          const selfHpPctLine = lines.find((s) => /额外造成自身当前生命值\d+(?:[\/|]\d+)*%的伤害/.test(s))
          if (selfHpPctLine) {
            const pct = Math.max(0, tierValueFromLine(selfHpPctLine, tIdx))
            if (pct > 0) runtimeDamage += Math.round(sourceHero.hp * (pct / 100))
          }
          const selfMaxHpPctLine = lines.find((s) => /额外造成自身最大生命值\d+(?:[\/|]\d+)*%的伤害/.test(s))
          if (selfMaxHpPctLine) {
            const pct = Math.max(0, tierValueFromLine(selfMaxHpPctLine, tIdx))
            if (pct > 0) runtimeDamage += Math.round(sourceHero.maxHp * (pct / 100))
          }
          if (lines.some((s) => /如果这是唯一的伤害物品[，,]?造成3倍伤害/.test(s))) {
            const attackers = this.state.items.filter((other) => other.side === it.side && this.isDamageItemForUniqueCheck(other))
            if (attackers.length === 1) runtimeDamage = Math.max(0, runtimeDamage * 3)
          }
          const emptyAmmoBurstLine = lines.find((s) => /弹药耗尽时造成\d+(?:[\/|]\d+)*倍伤害/.test(s))
          if (emptyAmmoBurstLine && it.runtime.ammoMax > 0 && it.runtime.ammoCurrent > 0) {
            const emptyAmmoBurstMul = Math.max(1, tierValueFromLine(emptyAmmoBurstLine, tIdx))
            const phantomCount = this.state.items.filter((other) => {
              if (other.side !== it.side) return false
              if (other.id === it.id) return false
              const otherDef = findItemDef(other.defId)
              return skillLines(otherDef).some((line) => /弹药物品伤害\+\d+(?:[\/|]\d+)*，弹药消耗翻倍/.test(line))
            }).length
            const ammoSpendPerUse = 1 + phantomCount
            const willEmptyAmmoThisUse = it.runtime.ammoCurrent - ammoSpendPerUse <= 0
            if (willEmptyAmmoThisUse && emptyAmmoBurstMul > 1) {
              runtimeDamage = Math.max(0, Math.round(runtimeDamage * emptyAmmoBurstMul))
            }
          }
          const explode = lines.find((s) => /弹药耗尽时摧毁自身.*最大生命值.*%.*伤害/.test(s))
          if (explode) {
            const pctSeries = explode.match(/最大生命值\s*([+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*)\s*的伤害/)
            const pct = pctSeries?.[1]
              ? (/[\/|]/.test(pctSeries[1]) ? pickTierSeriesValue(pctSeries[1], tIdx) : Number(pctSeries[1].replace(/%$/u, '')))
              : 0
            if (pct > 0) runtimeDamage = Math.max(runtimeDamage, Math.round(targetHero.maxHp * (pct / 100)))
          }
        }
        runtimeDamage = Math.max(0, Math.min(ITEM_DAMAGE_CAP, Math.round(runtimeDamage)))
        let runtimeHeal = Math.max(0, it.baseStats.heal)
        let runtimeShield = Math.max(0, it.baseStats.shield + this.shieldGainBonusForItem(it))
        if (def) {
          const tIdx = tierIndexFromRaw(def, it.tier)
          const lines = skillLines(def)
          const sourceHero = it.side === 'player' ? this.state.playerHero : this.state.enemyHero
          const maxHpHealLine = lines.find((s) => /恢复最大生命值\s*[+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*\s*的生命值/.test(s))
          if (maxHpHealLine) {
            const pct = Math.max(0, tierValueFromLine(maxHpHealLine, tIdx)) / 100
            if (pct > 0) runtimeHeal += Math.max(0, Math.round(sourceHero.maxHp * pct))
          }
          const currentHpShieldLine = lines.find((s) => /获得护盾[，,]?等于当前生命值/.test(s))
          if (currentHpShieldLine) {
            const pctRaw = tierValueFromLine(currentHpShieldLine, tIdx)
            const pct = pctRaw > 0 ? pctRaw : 100
            runtimeShield = Math.max(0, Math.round(sourceHero.hp * (pct / 100)))
          } else {
            runtimeShield = Math.max(0, this.skillSystem.scaleShieldGain(it.side, runtimeShield))
          }
          const unyieldingLine = lines.find((s) => /濒死时获得\d+秒无敌.*最大生命值.*%.*护盾/.test(s))
          if (unyieldingLine) {
            const m = unyieldingLine.match(/最大生命值\s*([+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*)\s*的护盾/)
            if (m?.[1]) {
              const pct = /[\/|]/.test(m[1]) ? pickTierSeriesValue(m[1], tIdx) : Number(m[1].replace(/%$/u, ''))
              if (Number.isFinite(pct) && pct > 0) {
                const shield = this.skillSystem.scaleShieldGain(it.side, Math.round(sourceHero.maxHp * (pct / 100)))
                runtimeShield = Math.max(runtimeShield, Math.max(0, shield))
              }
            }
          }
        }
        return {
          id: it.id,
          side: it.side,
          currentChargeMs: it.runtime.currentChargeMs,
          cooldownMs: Math.max(0, this.effectiveCooldownMs(it)),
          chargePercent: Math.max(0, Math.min(1, it.runtime.currentChargeMs / Math.max(1, this.effectiveCooldownMs(it)))),
          executeCount: it.runtime.executeCount,
          tempDamageBonus: it.runtime.tempDamageBonus,
          ammoMax: it.runtime.ammoMax,
          ammoCurrent: it.runtime.ammoCurrent,
          freezeMs: it.runtime.modifiers.freezeMs,
          slowMs: it.runtime.modifiers.slowMs,
          hasteMs: it.runtime.modifiers.hasteMs,
          damage: runtimeDamage,
          heal: Math.max(0, runtimeHeal),
          shield: Math.max(0, Math.min(HERO_SHIELD_CAP, runtimeShield)),
          burn: Math.max(0, it.baseStats.burn),
          poison: Math.max(0, it.baseStats.poison),
          multicast: (() => {
            const base = Math.max(1, Math.round(it.baseStats.multicast))
            const goldMulticast = this.hasSkill(it.side, 'skill88') && this.state.elapsedMs <= 5000 ? 1 : 0
            const boosted = Math.max(1, base + Math.max(0, Math.round(it.runtime.bonusMulticast)) + goldMulticast)
            const localDef = findItemDef(it.defId)
            if (!localDef) return boosted
            const allAmmoShot = skillLines(localDef).some((s) => /(?:一次)?打出所有弹药/.test(s))
            if (!allAmmoShot || it.runtime.ammoMax <= 0) return boosted
            return Math.max(boosted, Math.max(1, it.runtime.ammoCurrent))
          })(),
        }
      })(),
    }))
  }

  private reset(): void {
    this.state.phase = 'IDLE'
    this.state.elapsedMs = 0
    this.state.tickAccumulatorMs = 0
    this.state.fatigueAccumulatorMs = 0
    this.state.fatigueTickCount = 0
    this.state.tickIndex = 0
    this.state.inFatigue = false
    this.state.finished = false
    this.state.result = null
    this.state.items = []
    this.state.pendingHits = []
    this.state.pendingItemFires = []
    this.state.pendingChargePulses = []
    this.state.pendingAmmoRefills = []
    this.state.lastQueuedFireTickByItem.clear()
    this.state.playerSkillIds.clear()
    this.state.enemySkillIds.clear()
    this.state.skillEnemyHalfTriggered = false
    this.state.skillPlayerHalfTriggered = false
    this.state.skillEnemySelfHalfTriggered = false
    this.state.skillEnemyHalfTriggeredFromEnemy = false
    this.state.skillPlayerHalfShieldTriggered = false
    this.state.skillEnemyHalfShieldTriggered = false
    this.state.skillPlayerHalfShieldCdTriggered = false
    this.state.skillEnemyHalfShieldCdTriggered = false
    this.state.skillFirstAmmoEmptyTriggeredBySide = { player: false, enemy: false }
    this.state.skill47ReviveTriggeredBySide = { player: false, enemy: false }
    this.state.deathMarkCheckUsedBySide = { player: false, enemy: false }
    this.state.unyieldingTriggeredBySide = { player: false, enemy: false }
    this.state.heroInvincibleMsBySide = { player: 0, enemy: 0 }
    this.state.skill86UseCountBySide = { player: 0, enemy: 0 }
    this.state.skillExecuteDamageBonus = 0
    this.state.skillEnemyExecuteDamageBonus = 0
    this.state.skill33RegenPerTick = 0
    this.state.skillEnemy33RegenPerTick = 0
    this.state.playerBackpackItemCount = 0
    this.state.playerActiveColCount = 0
    this.state.playerGoldAtBattleStart = 0
    this.state.playerTrophyWinsAtBattleStart = 0
    this.state.enemyBackpackItemCount = 0
    this.state.enemyGoldAtBattleStart = 0
    this.state.enemyTrophyWinsAtBattleStart = 0
  }
  private isDamageItemForUniqueCheck(item: CombatItemRunner): boolean {
    if (isDamageBonusEligible(item)) return true
    const def = findItemDef(item.defId)
    return skillLines(def).some((s) => /弹药耗尽时摧毁自身.*最大生命值.*%.*伤害/.test(s))
  }

  private cooldownReductionPct(item: CombatItemRunner): number {
    const side = item.side
    let pct = 0
    if (this.hasSkill(side, 'skill6')) pct += 0.05
    if (this.hasSkill(side, 'skill12') && isAmmoItem(item)) pct += 0.1
    if (this.hasSkill(side, 'skill14') && this.state.elapsedMs <= 5000) pct += 0.1
    if (this.hasSkill(side, 'skill38') && this.heroOf(side).shield > 0) pct += 0.2
    if (this.hasSkill(side, 'skill40')) pct += 0.1
    if (this.hasSkill(side, 'skill26') && ((side === 'player' ? this.state.skillPlayerHalfShieldCdTriggered : this.state.skillEnemyHalfShieldCdTriggered)) && isShieldItem(item)) pct += 0.15
    if (this.hasSkill(side, 'skill60') && !this.hasAnyShieldItems(side)) pct += 0.1

    const selfDef = findItemDef(item.defId)
    const selfArch = itemArchetype(selfDef)
    for (const owner of this.state.items) {
      if (owner.side !== side) continue
      const def = findItemDef(owner.defId)
      const lines = skillLines(def)
      const tIdx = tierIndexFromRaw(def, owner.tier)
      for (const line of lines) {
        if (/所有物品间隔缩短[+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*/.test(line)) {
          pct += Math.max(0, tierValueFromLine(line, tIdx)) / 100
          continue
        }
        if (selfArch === '刺客' && /刺客物品间隔缩短[+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*/.test(line)) {
          pct += Math.max(0, tierValueFromLine(line, tIdx)) / 100
        }
      }
    }
    return Math.max(0, Math.min(0.95, pct))
  }

  effectiveCooldownMs(item: CombatItemRunner): number {
    if (item.baseStats.cooldownMs <= 0) return 0
    const pct = this.cooldownReductionPct(item)
    const reduced = Math.round(item.baseStats.cooldownMs * (1 - pct))
    return Math.max(this.skillSystem.minReducedCdMsFor(item), reduced)
  }
  private runtimeGlobalDamageBonus(item: CombatItemRunner): number {
    if (!isDamageBonusEligible(item)) return 0
    const side = item.side
    let bonus = side === 'player' ? this.state.skillExecuteDamageBonus : this.state.skillEnemyExecuteDamageBonus
    if (this.hasSkill(side, 'skill13') && this.state.elapsedMs <= 5000) bonus += 12
    if (this.hasSkill(side, 'skill53')) bonus += this.totalAmmoCurrent(side) * 4
    if (this.hasSkill(side, 'skill27') && this.effectiveCooldownMs(item) < 2500) bonus += 20
    if (this.hasSkill(side, 'skill37')) bonus += Math.floor(Math.max(0, this.heroOf(side).shield) / 10)
    return bonus
  }

  private itemDamageScale(item: CombatItemRunner): number {
    return Math.max(0, item.runtime.damageScale || 1)
  }

  private scaledDamage(item: CombatItemRunner, value: number): number {
    const scaled = Math.max(0, Math.round(Math.max(0, value) * this.itemDamageScale(item)))
    return Math.min(ITEM_DAMAGE_CAP, scaled)
  }

  private clampHeroState(hero: HeroState): void {
    hero.maxHp = Math.max(1, Math.min(HERO_MAX_HP_CAP, Math.round(hero.maxHp)))
    hero.hp = Math.max(0, Math.min(hero.maxHp, Math.round(hero.hp)))
    hero.shield = Math.max(0, Math.min(HERO_SHIELD_CAP, Math.round(hero.shield)))
  }

  private clampCombatCaps(): void {
    this.clampHeroState(this.state.playerHero)
    this.clampHeroState(this.state.enemyHero)
    for (const item of this.state.items) {
      item.baseStats.damage = Math.max(0, Math.min(ITEM_DAMAGE_CAP, Math.round(item.baseStats.damage)))
    }
  }

  private uniqueDamageItem(side: 'player' | 'enemy'): CombatItemRunner | null {
    const items = this.state.items.filter((it) => it.side === side && isDamageBonusEligible(it))
    return items.length === 1 ? items[0]! : null
  }

  private uniqueAmmoItem(side: 'player' | 'enemy'): CombatItemRunner | null {
    const items = this.state.items.filter((it) => it.side === side && isAmmoItem(it))
    return items.length === 1 ? items[0]! : null
  }

  private allItemsAreAmmo(side: 'player' | 'enemy'): boolean {
    const items = this.state.items.filter((it) => it.side === side)
    if (items.length <= 0) return false
    return items.every((it) => isAmmoItem(it))
  }

  private skillDamageMultiplier(item: CombatItemRunner): number {
    const side = item.side
    let mul = 1
    if (this.hasSkill(side, 'skill43') && this.uniqueDamageItem(side)?.id === item.id) mul *= 1.5
    if (this.hasSkill(side, 'skill44') && this.uniqueAmmoItem(side)?.id === item.id) mul *= 1.5
    if (this.hasSkill(side, 'skill84') && this.allItemsAreAmmo(side)) mul *= 1.5
    return Math.max(0, mul)
  }

  private applyOnDealDamageLifesteal(attacker: CombatItemRunner, dealtHpDamage: number): void {
    const dealt = Math.max(0, Math.round(dealtHpDamage))
    if (dealt <= 0) return
    const hasSkill43Lifesteal = this.hasSkill(attacker.side, 'skill43') && this.uniqueDamageItem(attacker.side)?.id === attacker.id
    if (!hasSkill43Lifesteal) return
    const hero = this.heroOf(attacker.side)
    if (hero.hp <= 0) return
    const healAmount = Math.max(1, Math.round(dealt))
    const healed = Math.max(0, Math.min(hero.maxHp - hero.hp, healAmount))
    if (healed <= 0) return
    hero.hp += healed
    EventBus.emit('battle:heal', {
      targetId: hero.id,
      sourceItemId: attacker.id,
      amount: healed,
      isRegen: false,
      targetType: 'hero',
      targetSide: hero.side,
      sourceType: 'item',
      sourceSide: attacker.side,
    })
  }

  private hasAnyShieldItems(side: 'player' | 'enemy'): boolean {
    return this.state.items.some((it) => it.side === side && isShieldItem(it))
  }
  private totalAmmoCurrent(side: 'player' | 'enemy'): number {
    let total = 0
    for (const it of this.state.items) {
      if (it.side !== side) continue
      total += Math.max(0, it.runtime.ammoCurrent)
    }
    return total
  }  private isAdjacentById(aId: string, bId: string): boolean {
    const a = this.state.items.find((it) => it.id === aId)
    const b = this.state.items.find((it) => it.id === bId)
    if (!a || !b) return false
    return isAdjacentByFootprint(a, b)
  }
  chargeItemByMs(owner: CombatItemRunner, gainMs: number): void {
    const gain = Math.max(0, Math.round(gainMs))
    if (gain <= 0) return
    const lastDue = this.state.lastQueuedFireTickByItem.get(owner.id)
    const hasQueuedFire = Number.isFinite(lastDue) && (lastDue as number) >= this.state.tickIndex
    if (hasQueuedFire) {
      owner.runtime.pendingChargeMs += gain
      return
    }

    const before = owner.runtime.currentChargeMs
    const ownerCooldown = this.effectiveCooldownMs(owner)
    owner.runtime.currentChargeMs = Math.min(ownerCooldown, owner.runtime.currentChargeMs + gain)
    const consumed = Math.max(0, owner.runtime.currentChargeMs - before)
    const overflow = Math.max(0, gain - consumed)
    if (overflow > 0) owner.runtime.pendingChargeMs += overflow

    const needsAmmo = owner.runtime.ammoMax > 0
    const hasAmmo = owner.runtime.ammoCurrent > 0
    if (owner.runtime.currentChargeMs >= ownerCooldown && (!needsAmmo || hasAmmo)) {
      const baseDue = this.state.tickIndex + 1
      const prevDue = this.state.lastQueuedFireTickByItem.get(owner.id) ?? (this.state.tickIndex - 1)
      const dueTick = Math.max(baseDue, prevDue + 1)
      this.state.pendingItemFires.push({ dueTick, sourceItemId: owner.id })
      this.state.lastQueuedFireTickByItem.set(owner.id, dueTick)
    }
  }

  private scheduleRepeatedChargePulses(
    source: CombatItemRunner,
    target: CombatItemRunner,
    times: number,
    gainMs: number,
    intervalTick: number,
  ): void {
    const count = Math.max(1, Math.round(times))
    const step = Math.max(1, Math.round(intervalTick))
    const gain = Math.max(1, Math.round(gainMs))
    for (let i = 0; i < count; i++) {
      this.state.pendingChargePulses.push({
        dueTick: this.state.tickIndex + i * step,
        sourceItemId: source.id,
        targetItemId: target.id,
        gainMs: gain,
      })
    }
  }

  enqueueExtraTriggeredUse(source: CombatItemRunner): void {
    const nextTick = this.state.tickIndex + 1
    this.state.pendingItemFires.push({
      dueTick: nextTick,
      sourceItemId: source.id,
      extraTriggered: true,
    })
  }

  private removeItemFromBattle(itemId: string): void {
    const removed = this.state.items.find((it) => it.id === itemId)
    this.state.items = this.state.items.filter((it) => it.id !== itemId)
    this.state.pendingItemFires = this.state.pendingItemFires.filter((f) => f.sourceItemId !== itemId)
    this.state.pendingChargePulses = this.state.pendingChargePulses.filter((p) => p.sourceItemId !== itemId && p.targetItemId !== itemId)
    this.state.pendingAmmoRefills = this.state.pendingAmmoRefills.filter((p) => p.sourceItemId !== itemId && p.targetItemId !== itemId)
    this.state.pendingHits = this.state.pendingHits.filter((h) => h.sourceItemId !== itemId)
    this.state.lastQueuedFireTickByItem.delete(itemId)
    if (removed) {
      EventBus.emit('battle:unit_die', {
        unitId: itemId,
        side: removed.side,
      })
    }
  }
  private refillAmmoAndTriggerGrowth(target: CombatItemRunner, gainAmmo: number): number {
    const gain = Math.max(0, Math.round(gainAmmo))
    if (gain <= 0) return 0
    if (target.runtime.ammoMax <= 0) return 0
    const beforeCurrent = target.runtime.ammoCurrent
    const beforeMax = target.runtime.ammoMax
    if (beforeCurrent >= beforeMax) return 0
    target.runtime.ammoCurrent = Math.min(beforeMax, beforeCurrent + gain)
    const actualGained = Math.max(0, target.runtime.ammoCurrent - beforeCurrent)
    if (actualGained > 0) this.skillSystem.applyOnAmmoRefilledDamageGrowth(target, actualGained)
    return actualGained
  }
  private applyPendingChargeToFreshCycle(owner: CombatItemRunner): void {
    if (owner.runtime.pendingChargeMs <= 0) return
    const gain = owner.runtime.pendingChargeMs
    owner.runtime.pendingChargeMs = 0
    const ownerCooldown = this.effectiveCooldownMs(owner)
    owner.runtime.currentChargeMs = Math.min(ownerCooldown, owner.runtime.currentChargeMs + gain)
    this.debugShieldChargeLog('apply_pending_to_fresh_cycle', {
      tick: this.state.tickIndex,
      itemId: owner.id,
      gain,
      currentChargeMs: owner.runtime.currentChargeMs,
      cooldownMs: ownerCooldown,
    })

    const needsAmmo = owner.runtime.ammoMax > 0
    const hasAmmo = owner.runtime.ammoCurrent > 0
    if (owner.runtime.currentChargeMs >= ownerCooldown && (!needsAmmo || hasAmmo)) {
      const baseDue = this.state.tickIndex + 1
      const lastDue = this.state.lastQueuedFireTickByItem.get(owner.id) ?? (this.state.tickIndex - 1)
      const dueTick = Math.max(baseDue, lastDue + 1)
      this.state.pendingItemFires.push({ dueTick, sourceItemId: owner.id })
      this.state.lastQueuedFireTickByItem.set(owner.id, dueTick)
      this.debugShieldChargeLog('queue_from_pending_charge', {
        tick: this.state.tickIndex,
        itemId: owner.id,
        dueTick,
      })
    }
  }

  enqueueOneAttackFrom(source: CombatItemRunner): void {
    const baseDamage = this.scaledDamage(source, source.baseStats.damage + this.runtimeGlobalDamageBonus(source))
    const damage = this.scaledDamage(source, source.baseStats.damage + source.runtime.tempDamageBonus + this.runtimeGlobalDamageBonus(source))
    if (damage <= 0) return
    this.state.pendingHits.push({
      dueTick: this.state.tickIndex,
      side: source.side,
      sourceItemId: source.id,
      defId: source.defId,
      baseDamage,
      damage,
      attackerDamageAtQueue: this.scaledDamage(source, source.baseStats.damage + source.runtime.tempDamageBonus + this.runtimeGlobalDamageBonus(source)),
      crit: source.baseStats.crit,
    })
  }

  private shieldGainBonusForItem(source: CombatItemRunner): number {
    if (source.baseStats.shield <= 0) return 0
    let bonus = 0
    for (const owner of this.state.items) {
      if (owner.side !== source.side || owner.id === source.id) continue
      if (!isAdjacentByFootprint(owner, source)) continue
      const def = findItemDef(owner.defId)
      if (!def) continue
      const line = skillLines(def).find((s) =>
        /相邻(?:的)?护盾物品(?:护盾)?\+\d+(?:\/\d+)*/.test(s)
        && !/每次使用后|使用后/.test(s),
      )
      if (!line) continue
      bonus += Math.round(tierValueFromLine(line, tierIndexFromRaw(def, owner.tier)))
    }
    return Math.max(0, bonus)
  }
  private stepOneTick(tickMs: number): void {
    this.state.tickIndex += 1
    this.state.heroInvincibleMsBySide.player = Math.max(0, this.state.heroInvincibleMsBySide.player - tickMs)
    this.state.heroInvincibleMsBySide.enemy = Math.max(0, this.state.heroInvincibleMsBySide.enemy - tickMs)
    this.resolveQueuedItemFiresForCurrentTick()
    this.resolveQueuedChargePulsesForCurrentTick()
    this.resolveQueuedAmmoRefillsForCurrentTick()
    const queue: CombatItemRunner[] = []
    for (const item of this.state.items) {
      if (item.baseStats.cooldownMs <= 0) continue
      const freezeBefore = item.runtime.modifiers.freezeMs
      const slowBefore = item.runtime.modifiers.slowMs
      const hasteBefore = item.runtime.modifiers.hasteMs
      if (item.runtime.modifiers.freezeMs > 0) {
        item.runtime.modifiers.freezeMs = Math.max(0, item.runtime.modifiers.freezeMs - tickMs)
        if (freezeBefore > 0 && item.runtime.modifiers.freezeMs === 0) {
          EventBus.emit('battle:status_remove', {
            targetId: item.id,
            status: 'freeze',
            targetType: 'item',
            targetSide: item.side,
          })
        }
      }
      if (item.runtime.modifiers.slowMs > 0) {
        item.runtime.modifiers.slowMs = Math.max(0, item.runtime.modifiers.slowMs - tickMs)
        if (slowBefore > 0 && item.runtime.modifiers.slowMs === 0) {
          EventBus.emit('battle:status_remove', {
            targetId: item.id,
            status: 'slow',
            targetType: 'item',
            targetSide: item.side,
          })
        }
      }
      if (item.runtime.modifiers.hasteMs > 0) {
        item.runtime.modifiers.hasteMs = Math.max(0, item.runtime.modifiers.hasteMs - tickMs)
        if (hasteBefore > 0 && item.runtime.modifiers.hasteMs === 0) {
          EventBus.emit('battle:status_remove', {
            targetId: item.id,
            status: 'haste',
            targetType: 'item',
            targetSide: item.side,
          })
        }
      }

      if (item.runtime.modifiers.freezeMs > 0) continue

      const cr = getConfig().combatRuntime
      const slowFactor = Math.max(0, Math.min(0.95, cr.cardSlowFactor ?? 0.4))
      const hasteFactor = Math.max(0, cr.cardHasteFactor ?? 0.4)
      let gain = tickMs
      if (item.runtime.modifiers.slowMs > 0) gain *= Math.max(0.05, 1 - slowFactor)
      if (item.runtime.modifiers.hasteMs > 0) gain *= 1 + hasteFactor

      const effectiveCooldown = this.effectiveCooldownMs(item)
      item.runtime.currentChargeMs += gain
      if (item.runtime.currentChargeMs >= effectiveCooldown) {
        const needsAmmo = item.runtime.ammoMax > 0
        const hasAmmo = item.runtime.ammoCurrent > 0
        if (needsAmmo && !hasAmmo) {
          // 弹药武器无弹时：停在“已充能完成”状态，等待补弹后立刻可发射
          item.runtime.currentChargeMs = effectiveCooldown
        } else {
          item.runtime.currentChargeMs = 0
          item.runtime.executeCount += 1
          this.applyPendingChargeToFreshCycle(item)
          queue.push(item)
        }
      }
    }

    const playerQueue = queue.filter((q) => q.side === 'player')
    const enemyQueue = queue.filter((q) => q.side === 'enemy')
    for (const q of playerQueue) this.resolveFire(q)
    for (const q of enemyQueue) this.resolveFire(q)

    this.processStatusPeriodicByTick()
    this.resolvePendingHitsForCurrentTick()
    this.skillSystem.tryDeathMarkExecution('player', this.state.enemyHero)
    this.skillSystem.tryDeathMarkExecution('enemy', this.state.playerHero)
    this.clampCombatCaps()
  }

  private resolveQueuedChargePulsesForCurrentTick(): void {
    if (!this.state.pendingChargePulses.length) return
    const due = this.state.pendingChargePulses.filter((p) => p.dueTick <= this.state.tickIndex)
    this.state.pendingChargePulses = this.state.pendingChargePulses.filter((p) => p.dueTick > this.state.tickIndex)
    for (const one of due) {
      const target = this.state.items.find((it) => it.id === one.targetItemId)
      if (!target) continue
      this.chargeItemByMs(target, one.gainMs)
    }
  }

  private resolveQueuedAmmoRefillsForCurrentTick(): void {
    if (!this.state.pendingAmmoRefills.length) return
    const due = this.state.pendingAmmoRefills.filter((p) => p.dueTick <= this.state.tickIndex)
    this.state.pendingAmmoRefills = this.state.pendingAmmoRefills.filter((p) => p.dueTick > this.state.tickIndex)
    for (const one of due) {
      const target = this.state.items.find((it) => it.id === one.targetItemId)
      if (!target) continue
      this.refillAmmoAndTriggerGrowth(target, one.gainAmmo)
      if (one.chargeMs > 0) this.chargeItemByMs(target, one.chargeMs)
    }
  }

  private resolveQueuedItemFiresForCurrentTick(): void {
    if (!this.state.pendingItemFires.length) return
    const due = this.state.pendingItemFires.filter((f) => f.dueTick <= this.state.tickIndex)
    this.state.pendingItemFires = this.state.pendingItemFires.filter((f) => f.dueTick > this.state.tickIndex)
    for (const one of due) {
      const owner = this.state.items.find((it) => it.id === one.sourceItemId)
      if (!owner) continue
      this.debugShieldChargeLog('dequeue_fire', {
        tick: this.state.tickIndex,
        itemId: one.sourceItemId,
        dueTick: one.dueTick,
      })
      if (owner.runtime.modifiers.freezeMs > 0) {
        const nextTick = this.state.tickIndex + 1
        this.state.pendingItemFires.push({ dueTick: nextTick, sourceItemId: owner.id })
        this.state.lastQueuedFireTickByItem.set(owner.id, nextTick)
        this.debugShieldChargeLog('dequeue_frozen_requeue', {
          tick: this.state.tickIndex,
          itemId: owner.id,
          nextTick,
        })
        continue
      }
      const needsAmmo = owner.runtime.ammoMax > 0
      const hasAmmo = owner.runtime.ammoCurrent > 0
      if (needsAmmo && !hasAmmo) continue
      owner.runtime.currentChargeMs = 0
      owner.runtime.executeCount += 1
      this.applyPendingChargeToFreshCycle(owner)
      this.debugShieldChargeLog('dequeue_fire_resolve', {
        tick: this.state.tickIndex,
        itemId: owner.id,
        executeCount: owner.runtime.executeCount,
      })
      this.resolveFire(owner, one.extraTriggered === true)
    }
  }

  private resolveFire(item: CombatItemRunner, fromExtraTrigger = false): void {
    const sourceHero = item.side === 'player' ? this.state.playerHero : this.state.enemyHero
    const targetHero = item.side === 'player' ? this.state.enemyHero : this.state.playerHero
    const def = findItemDef(item.defId)
    const lines = skillLines(def)
    const tIdx = tierIndexFromRaw(def, item.tier)
    const sourceArch = itemArchetype(def)
    const isAllAmmoShot = lines.some((s) => /(?:一次)?打出所有弹药/.test(s))
    const emptyAmmoBurstLine = lines.find((s) => /弹药耗尽时造成\d+(?:[\/|]\d+)*倍伤害/.test(s))
    const emptyAmmoBurstMul = emptyAmmoBurstLine
      ? Math.max(1, tierValueFromLine(emptyAmmoBurstLine, tIdx))
      : 1
    const useDamageLine = lines.find((s) => /使用时伤害\+\d+(?:[\/|]\d+)*/.test(s))
    const useDamageBonus = useDamageLine ? Math.round(tierValueFromLine(useDamageLine, tIdx)) : 0
    const canGrowDamageOnUse = useDamageBonus > 0 && isDamageBonusEligible(item)
    const skill88Multicast = this.hasSkill(item.side, 'skill88') && this.state.elapsedMs <= 5000 ? 1 : 0
    let fireCount = Math.max(1, item.baseStats.multicast + item.runtime.bonusMulticast + skill88Multicast)
    const ammoBeforeUse = item.runtime.ammoCurrent
    if (item.runtime.ammoMax > 0) {
      if (item.runtime.ammoCurrent <= 0) return
      fireCount = isAllAmmoShot
        ? Math.max(1, item.runtime.ammoCurrent)
        : fireCount
    }
    const willEmptyAmmoThisUse = item.runtime.ammoMax > 0
      && ((isAllAmmoShot && ammoBeforeUse > 0 && ammoBeforeUse <= fireCount) || (!isAllAmmoShot && ammoBeforeUse === 1))
    const useRepeatCount = Math.max(1, fireCount)
    const tickMsCfg = Math.max(1, getConfig().combatRuntime.tickMs)
    const shotIntervalMs = useRepeatCount > 1
      ? tickMsCfg
      : Math.max(tickMsCfg, this.effectiveCooldownMs(item) / Math.max(1, useRepeatCount))
    const shotIntervalTick = Math.max(1, Math.round(shotIntervalMs / tickMsCfg))

    const sourceIsAssassinBoot = hasLine(def, /使用刺客物品时立即使用此物品/)
    if (sourceArch === '刺客' && !sourceIsAssassinBoot) {
      for (const ally of this.state.items) {
        if (ally.side !== item.side || ally.id === item.id) continue
        const allyDef = findItemDef(ally.defId)
        if (!hasLine(allyDef, /使用刺客物品时立即使用此物品/)) continue
        for (let n = 0; n < useRepeatCount; n++) this.enqueueExtraTriggeredUse(ally)
      }
    }

    EventBus.emit('battle:item_trigger', {
      itemId: item.defId,
      sourceItemId: item.id,
      side: item.side,
      triggerCount: 1,
      multicast: useRepeatCount,
      extraTriggered: fromExtraTrigger,
    })

    for (let i = 0; i < useRepeatCount; i++) {
      this.itemSystem.applyAdjacentUseHasteTriggers(item)
      if (!fromExtraTrigger) this.itemSystem.applyAdjacentUseExtraFireTriggers(item)
      this.itemSystem.applyAdjacentUseBurnTriggers(item)
      this.itemSystem.applyBurnUseSlowTriggers(item)
    }

    if (this.hasSkill(item.side, 'skill86') && this.state.skill86UseCountBySide[item.side] < 8) {
      const triggerCount = Math.min(useRepeatCount, 8 - this.state.skill86UseCountBySide[item.side])
      this.state.skill86UseCountBySide[item.side] += triggerCount
      const ammoCandidates = this.state.items
        .filter((it) => it.side === item.side && isAmmoItem(it))
        .sort((a, b) => (a.col - b.col) || a.id.localeCompare(b.id))
      const target = ammoCandidates.find((it) => it.runtime.currentChargeMs < this.effectiveCooldownMs(it)) ?? ammoCandidates[0]
      if (target) this.scheduleRepeatedChargePulses(item, target, triggerCount, 1000, shotIntervalTick)
    }

    if (this.hasSkill(item.side, 'skill87')) {
      const ordered = this.state.items
        .filter((it) => it.side === item.side)
        .sort((a, b) => (a.col - b.col) || a.id.localeCompare(b.id))
      const leftmost = ordered[0]
      const rightmost = ordered[ordered.length - 1]
      if (leftmost && rightmost && leftmost.id === item.id) {
          this.scheduleRepeatedChargePulses(item, rightmost, useRepeatCount, 500, shotIntervalTick)
        }
      }

    if (this.hasSkill(item.side, 'skill4') && isShieldItem(item)) {
      for (const ally of this.state.items) {
        if (ally.side !== item.side || ally.id === item.id) continue
        if (!isAdjacentByFootprint(ally, item)) continue
        if (!isDamageBonusEligible(ally)) continue
        ally.baseStats.damage += 4 * useRepeatCount
      }
    }
    if (this.hasSkill(item.side, 'skill5') && isShieldItem(item)) {
      item.baseStats.shield += 7 * useRepeatCount
    }
    if (this.hasSkill(item.side, 'skill11') && isAmmoItem(item)) {
      for (const ally of this.state.items) {
        if (ally.side !== item.side || ally.id === item.id) continue
        if (!isAdjacentByFootprint(ally, item)) continue
        if (!isDamageBonusEligible(ally)) continue
        ally.baseStats.damage += 5 * useRepeatCount
      }
    }

    const ctrl = this.itemSystem.applyCardEffects(item, def)

    // 控制触发增益（本场战斗内）
    if (ctrl.freeze > 0) {
      this.itemSystem.applyFreezeTriggeredAdjacentAttackBuff(item)
      for (const line of lines) {
        const v = Math.round(tierValueFromLine(line, tIdx))
        if (v <= 0) continue
        if (/冻结.*\+\d+(?:[\/|]\d+)*伤害/.test(line) && isDamageBonusEligible(item)) item.runtime.tempDamageBonus += v
        if (/冻结.*\+\d+(?:[\/|]\d+)*灼烧/.test(line)) item.baseStats.burn += v
        if (/冻结.*\+\d+(?:[\/|]\d+)*剧毒/.test(line)) item.baseStats.poison += v
      }
    }
    if (ctrl.slow > 0) {
      for (const line of lines) {
        const v = Math.round(tierValueFromLine(line, tIdx))
        if (v <= 0) continue
        if (/减速.*\+\d+(?:[\/|]\d+)*伤害/.test(line) && isDamageBonusEligible(item)) item.runtime.tempDamageBonus += v
        if (/减速.*\+\d+(?:[\/|]\d+)*灼烧/.test(line)) item.baseStats.burn += v
      }
    }
    if (ctrl.haste > 0) {
      const line = lines.find((s) => /触发加速时.*额外造成\d+(?:[\/|]\d+)*伤害/.test(s))
      if (line) {
        const v = Math.round(tierValueFromLine(line, tIdx))
        if (v > 0) {
          this.state.pendingHits.push({
            dueTick: this.state.tickIndex,
            side: item.side,
            sourceItemId: item.id,
            defId: item.defId,
            baseDamage: v,
            damage: v,
            crit: item.baseStats.crit,
          })
        }
      }
    }

    if (item.baseStats.shield > 0 && sourceHero.hp > 0) {
      const rawShieldPanel = item.baseStats.shield + this.shieldGainBonusForItem(item)
      let shieldPanel = this.skillSystem.scaleShieldGain(item.side, rawShieldPanel)
      const currentHpShieldLine = lines.find((s) => /获得护盾[，,]?等于当前生命值/.test(s))
      if (currentHpShieldLine) {
        const pctRaw = tierValueFromLine(currentHpShieldLine, tIdx)
        const pct = pctRaw > 0 ? pctRaw : 100
        shieldPanel = Math.max(0, Math.round(sourceHero.hp * (pct / 100)))
      }
      sourceHero.shield += shieldPanel
      this.debugShieldChargeLog('shield_gain_happened', {
        tick: this.state.tickIndex,
        sourceItemId: item.id,
        side: item.side,
        amount: shieldPanel,
      })
      EventBus.emit('battle:gain_shield', {
        targetId: sourceHero.id,
        sourceItemId: item.id,
        amount: shieldPanel,
        targetType: 'hero',
        targetSide: sourceHero.side,
        sourceType: 'item',
        sourceSide: item.side,
      })
      this.skillSystem.applyOnShieldGainCharge(item.side)
      this.skillSystem.applyShieldGainSkillTriggers(item.side, item.id, shieldPanel, isShieldItem(item))

      // 获得护盾时加速 1 件物品
      const shieldHasteLine = lines.find((s) => /获得护盾时.*加速.*件物品/.test(s))
      if (shieldHasteLine) {
        const sec = tierValueFromLine(shieldHasteLine, tIdx)
        if (sec > 0) {
          const targets = this.itemSystem.pickControlTargets({
            side: item.side,
            count: 1,
            mode: 'leftmost',
            source: item,
            excludeId: item.id,
          })
          this.itemSystem.applyHasteToTargetItems(item, targets, Math.round(sec * 1000))
        }
      }
    }

    const adjacentShieldUseLine = lines.find((s) => /使用时相邻(?:的)?(?:护盾物品)?护盾\+\d+(?:[\/|]\d+)*/.test(s))
    if (adjacentShieldUseLine) {
      const v = Math.round(tierValueFromLine(adjacentShieldUseLine, tIdx)) * useRepeatCount
      if (v > 0) {
        for (const ally of this.state.items) {
          if (ally.side !== item.side || ally.id === item.id) continue
          if (!isAdjacentByFootprint(ally, item)) continue
          if (ally.baseStats.shield <= 0) continue
          ally.baseStats.shield += v
        }
      }
    }

    const adjacentDamageUseLine = lines.find((s) => /使用时相邻物品伤害\+\d+(?:[\/|]\d+)*/.test(s))
    if (adjacentDamageUseLine) {
      const v = Math.round(tierValueFromLine(adjacentDamageUseLine, tIdx)) * useRepeatCount
      if (v > 0) {
        for (const ally of this.state.items) {
          if (ally.side !== item.side || ally.id === item.id) continue
          if (!isAdjacentByFootprint(ally, item)) continue
          if (!isDamageBonusEligible(ally)) continue
          ally.baseStats.damage += v
        }
      }
    }

    const allShieldUseLine = lines.find((s) => /使用后所有护盾物品\+\d+(?:[\/|]\d+)*护盾/.test(s))
    if (allShieldUseLine) {
      const v = Math.round(tierValueFromLine(allShieldUseLine, tIdx)) * useRepeatCount
      if (v > 0) {
        for (const ally of this.state.items) {
          if (ally.side !== item.side) continue
          if (ally.baseStats.shield <= 0) continue
          ally.baseStats.shield += v
        }
      }
    }
    const maxHpHealLine = lines.find((s) => /恢复最大生命值\s*[+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*\s*的生命值/.test(s))
    const maxHpHealAmount = (() => {
      if (!maxHpHealLine) return 0
      const pct = Math.max(0, tierValueFromLine(maxHpHealLine, tIdx)) / 100
      if (pct <= 0) return 0
      return Math.max(0, Math.round(sourceHero.maxHp * pct))
    })()

    if ((item.baseStats.heal > 0 || maxHpHealAmount > 0) && sourceHero.hp > 0) {
      const totalHeal = Math.max(0, item.baseStats.heal + maxHpHealAmount)
      const realHeal = Math.max(0, Math.min(sourceHero.maxHp - sourceHero.hp, totalHeal))
      if (realHeal > 0) {
        sourceHero.hp += realHeal
        EventBus.emit('battle:heal', {
          targetId: sourceHero.id,
          sourceItemId: item.id,
          amount: realHeal,
          isRegen: false,
          targetType: 'hero',
          targetSide: sourceHero.side,
          sourceType: 'item',
          sourceSide: item.side,
        })
      }
      const cleansePct = Math.max(0, rv('healCleansePct', getConfig().combatRuntime.healCleansePct))
      const clearLayer = Math.max(0, Math.ceil(item.baseStats.heal * cleansePct))
      if (clearLayer > 0) {
        const burnBefore = sourceHero.burn
        const poisonBefore = sourceHero.poison
        sourceHero.burn = Math.max(0, sourceHero.burn - clearLayer)
        sourceHero.poison = Math.max(0, sourceHero.poison - clearLayer)
        if (burnBefore > 0 && sourceHero.burn === 0) {
          EventBus.emit('battle:status_remove', {
            targetId: sourceHero.id,
            status: 'burn',
            targetType: 'hero',
            targetSide: sourceHero.side,
          })
        }
        if (poisonBefore > 0 && sourceHero.poison === 0) {
          EventBus.emit('battle:status_remove', {
            targetId: sourceHero.id,
            status: 'poison',
            targetType: 'hero',
            targetSide: sourceHero.side,
          })
        }
      }
    }

    if (item.baseStats.burn > 0) {
      targetHero.burn += item.baseStats.burn
      EventBus.emit('battle:status_apply', {
        targetId: targetHero.id,
        sourceItemId: item.id,
        status: 'burn',
        amount: item.baseStats.burn,
        targetType: 'hero',
        targetSide: targetHero.side,
        sourceType: 'item',
        sourceSide: item.side,
      })

      // 造成灼烧时：剧毒物品 +X 剧毒
      const line = lines.find((s) => /造成灼烧时.*剧毒物品\+\d+(?:[\/|]\d+)*/.test(s))
      if (line) {
        const v = Math.round(tierValueFromLine(line, tIdx))
        if (v > 0) {
          for (const ally of this.state.items) {
            if (ally.side !== item.side) continue
            if (ally.baseStats.poison <= 0) continue
            ally.baseStats.poison += v
          }
        }
      }
    }
    if (item.baseStats.poison > 0) {
      targetHero.poison += item.baseStats.poison
      EventBus.emit('battle:status_apply', {
        targetId: targetHero.id,
        sourceItemId: item.id,
        status: 'poison',
        amount: item.baseStats.poison,
        targetType: 'hero',
        targetSide: targetHero.side,
        sourceType: 'item',
        sourceSide: item.side,
      })

      if (lines.some((s) => /并使目标身上的剧毒层数翻倍/.test(s))) {
        const extra = Math.max(0, targetHero.poison)
        if (extra > 0) {
          targetHero.poison += extra
          EventBus.emit('battle:status_apply', {
            targetId: targetHero.id,
            sourceItemId: item.id,
            status: 'poison',
            amount: extra,
            targetType: 'hero',
            targetSide: targetHero.side,
            sourceType: 'item',
            sourceSide: item.side,
          })
        }
      }

      // 造成剧毒时恢复
      const healLine = lines.find((s) => /造成剧毒时恢复\+?\d+(?:[\/|]\d+)*/.test(s))
      if (healLine) {
        const heal = Math.round(tierValueFromLine(healLine, tIdx))
        if (heal > 0 && sourceHero.hp > 0) {
          const real = Math.max(0, Math.min(sourceHero.maxHp - sourceHero.hp, heal))
          if (real > 0) {
            sourceHero.hp += real
            EventBus.emit('battle:heal', {
              targetId: sourceHero.id,
              sourceItemId: item.id,
              amount: real,
              isRegen: false,
              targetType: 'hero',
              targetSide: sourceHero.side,
              sourceType: 'item',
              sourceSide: item.side,
            })
          }
        }
      }

      // 造成剧毒时：灼烧物品 +X 灼烧
      const poisonToBurnLine = lines.find((s) => /造成剧毒时.*灼烧物品\+\d+(?:[\/|]\d+)*/.test(s))
      if (poisonToBurnLine) {
        const v = Math.round(tierValueFromLine(poisonToBurnLine, tIdx))
        if (v > 0) {
          for (const ally of this.state.items) {
            if (ally.side !== item.side) continue
            if (ally.baseStats.burn <= 0) continue
            ally.baseStats.burn += v
          }
        }
      }
    }
    if (item.baseStats.regen > 0) {
      sourceHero.regen += item.baseStats.regen
      EventBus.emit('battle:status_apply', {
        targetId: sourceHero.id,
        sourceItemId: item.id,
        status: 'regen',
        amount: item.baseStats.regen,
        targetType: 'hero',
        targetSide: sourceHero.side,
        sourceType: 'item',
        sourceSide: item.side,
      })
    }

    const baseDamageRaw = Math.max(0, item.baseStats.damage + this.runtimeGlobalDamageBonus(item))
    const skillMul = this.skillDamageMultiplier(item)
    const baseDamageUnscaled = Math.max(0, Math.round(baseDamageRaw * skillMul))
    const baseDamage = this.scaledDamage(item, baseDamageUnscaled)
    let damageAfterBonus = this.scaledDamage(item, baseDamageUnscaled + item.runtime.tempDamageBonus)

    const adjacentBoomerangDouble = lines.some((s) => /相邻回旋镖时伤害翻倍/.test(s))
    if (adjacentBoomerangDouble) {
      const hasAdjacentSame = this.state.items.some((ally) =>
        ally.side === item.side
        && ally.id !== item.id
        && ally.defId === item.defId
        && isAdjacentByFootprint(ally, item),
      )
      if (hasAdjacentSame) damageAfterBonus *= 2
    }

    // 等同当前自身护盾值
    if (lines.some((s) => /等同于当前自身护盾值|根据当前护盾值对对方造成伤害/.test(s))) {
      damageAfterBonus += Math.max(0, sourceHero.shield)
    }
    // 目标最大生命值百分比伤害
    const maxHpLine = lines.find((s) => /最大生命值.*%.*伤害/.test(s) && !/摧毁自身/.test(s) && !/第一次攻击/.test(s))
    if (maxHpLine) {
      const m = maxHpLine.match(/最大生命值\s*([+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*)\s*的伤害/)
      if (m?.[1]) {
        const pct = /[\/|]/.test(m[1]) ? pickTierSeriesValue(m[1], tIdx) : Number(m[1].replace(/%$/u, ''))
        if (Number.isFinite(pct) && pct > 0) {
          damageAfterBonus += Math.round(targetHero.maxHp * (pct / 100))
        }
      }
    }

    const firstHitLine = lines.find((s) => /第一次攻击额外造成目标最大生命值[+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*的伤害/.test(s))
    const firstHitBonus = (() => {
      if (!firstHitLine || item.runtime.executeCount > 1) return 0
      const pct = Math.max(0, tierValueFromLine(firstHitLine, tIdx))
      if (pct <= 0) return 0
      return Math.round(targetHero.maxHp * (pct / 100))
    })()

    const selfHpPctLine = lines.find((s) => /额外造成自身当前生命值\d+(?:[\/|]\d+)*%的伤害/.test(s))
    if (selfHpPctLine) {
      const pct = Math.max(0, tierValueFromLine(selfHpPctLine, tIdx))
      if (pct > 0) damageAfterBonus += Math.round(sourceHero.hp * (pct / 100))
    }

    const selfMaxHpPctLine = lines.find((s) => /额外造成自身最大生命值\d+(?:[\/|]\d+)*%的伤害/.test(s))
    if (selfMaxHpPctLine) {
      const pct = Math.max(0, tierValueFromLine(selfMaxHpPctLine, tIdx))
      if (pct > 0) damageAfterBonus += Math.round(sourceHero.maxHp * (pct / 100))
    }

    // 邻接被动：相邻物品攻击时，攻击造成 X 伤害
    for (const ally of this.state.items) {
      if (ally.side !== item.side || ally.id === item.id) continue
      if (!this.isAdjacentById(ally.id, item.id)) continue
      const allyDef = findItemDef(ally.defId)
      const allyLine = skillLines(allyDef).find((s) => /相邻物品攻击时.*造成\d+(?:[\/|]\d+)*伤害/.test(s))
      if (!allyLine) continue
      const v = Math.round(tierValueFromLine(allyLine, tierIndexFromRaw(allyDef, ally.tier)))
      if (v > 0) damageAfterBonus += v
    }

    if (damageAfterBonus > 0) {
      const isLastShotDoubleTriggered = this.hasSkill(item.side, 'skill50')
        && item.runtime.ammoMax > 0
        && ((isAllAmmoShot && ammoBeforeUse > 0) || (!isAllAmmoShot && ammoBeforeUse === 1))
      if (lines.some((s) => /唯一的攻击物品.*触发2次/.test(s))) {
        const attackers = this.state.items.filter((it) => it.side === item.side && it.baseStats.damage > 0)
        if (attackers.length === 1) fireCount = Math.max(fireCount, 2)
      }
      let progressiveUseBonus = 0
      for (let i = 0; i < fireCount; i++) {
        let shotDamage = Math.max(0, damageAfterBonus + this.scaledDamage(item, progressiveUseBonus))
        if (i === 0 && firstHitBonus > 0) {
          shotDamage = Math.max(0, shotDamage + firstHitBonus)
        }
        if (isLastShotDoubleTriggered && i === fireCount - 1) {
          shotDamage = Math.max(0, shotDamage * 2)
        }
        if (lines.some((s) => /如果这是唯一的伤害物品[，,]?造成3倍伤害/.test(s))) {
          const attackers = this.state.items.filter((it) => it.side === item.side && this.isDamageItemForUniqueCheck(it))
          if (attackers.length === 1) shotDamage = Math.max(0, shotDamage * 3)
        }
        if (willEmptyAmmoThisUse && emptyAmmoBurstMul > 1) {
          shotDamage = Math.max(0, Math.round(shotDamage * emptyAmmoBurstMul))
        }
          this.state.pendingHits.push({
          dueTick: this.state.tickIndex + i * shotIntervalTick,
          side: item.side,
          sourceItemId: item.id,
          defId: item.defId,
          baseDamage,
          damage: shotDamage,
          attackerDamageAtQueue: this.scaledDamage(item, item.baseStats.damage + item.runtime.tempDamageBonus + this.runtimeGlobalDamageBonus(item)),
          lockAttackerDelta: true,
          crit: item.baseStats.crit,
        })
        if (canGrowDamageOnUse) {
          item.baseStats.damage += useDamageBonus
          progressiveUseBonus += useDamageBonus
        }
      }
    }

    if (lines.some((s) => /摧毁敌人的1件物品/.test(s))) {
      const enemies = this.state.items
        .filter((it) => it.side !== item.side)
        .filter((it) => !isItemDestroyImmune(it))
      if (enemies.length > 0) {
        const rng = makeSeededRng(seedFrom(item.id, this.state.tickIndex))
        const picked = enemies[Math.floor(rng() * enemies.length)]
        if (picked) {
          EventBus.emit('battle:item_destroy', {
            sourceItemId: item.id,
            sourceSide: item.side,
            targetItemId: picked.id,
            targetSide: picked.side,
          })
          this.removeItemFromBattle(picked.id)
        }
      }
    }

    if (item.runtime.ammoMax > 0) {
      const ammoBefore = item.runtime.ammoCurrent
      const phantomCount = this.state.items.filter((it) => {
        if (it.side !== item.side) return false
        const def2 = findItemDef(it.defId)
        return hasLine(def2, /弹药物品伤害\+\d+(?:[\/|]\d+)*[，,]?弹药消耗翻倍/)
      }).length
      const singleUseCost = Math.max(1, 1 + phantomCount)
      if (isAllAmmoShot) item.runtime.ammoCurrent = Math.max(0, item.runtime.ammoCurrent - fireCount)
      else item.runtime.ammoCurrent = Math.max(0, item.runtime.ammoCurrent - singleUseCost)
      const ammoSpent = Math.max(0, ammoBefore - item.runtime.ammoCurrent)
      const becameEmpty = ammoBefore > 0 && item.runtime.ammoCurrent <= 0
      if (this.hasSkill(item.side, 'skill9') && !this.state.skillFirstAmmoEmptyTriggeredBySide[item.side] && becameEmpty) {
        this.state.skillFirstAmmoEmptyTriggeredBySide[item.side] = true
        this.refillAmmoAndTriggerGrowth(item, 3)
      }
      if (this.hasSkill(item.side, 'skill52') && becameEmpty) {
        if (makeSeededRng(seedFrom(item.defId, this.state.tickIndex))() < 0.5) {
          this.refillAmmoAndTriggerGrowth(item, item.runtime.ammoMax)
        }
      }
      if (this.hasSkill(item.side, 'skill54') && ammoSpent > 0) {
        for (const ally of this.state.items) {
          if (ally.side !== item.side) continue
          if (!isDamageBonusEligible(ally)) continue
          ally.baseStats.damage += 5
        }
      }
      if (this.hasSkill(item.side, 'skill85') && becameEmpty) {
        for (const ally of this.state.items) {
          if (ally.side !== item.side || ally.id === item.id) continue
          if (!isAdjacentByFootprint(ally, item)) continue
          if (!isDamageBonusEligible(ally)) continue
          ally.baseStats.damage += 50
        }
      }

      if (becameEmpty) {
        for (const owner of this.state.items) {
          if (owner.side !== item.side) continue
          const ownerDef = findItemDef(owner.defId)
          const line = skillLines(ownerDef).find((s) => /任意物品弹药耗尽时为其补充\d+(?:[\/|]\d+)*发弹药并充能\d+(?:[\/|]\d+)*秒/.test(s))
          if (!line) continue
          const gain = Math.max(0, Math.round(tierValueFromLine(line, tierIndexFromRaw(ownerDef, owner.tier))))
          if (gain <= 0) continue
          this.state.pendingAmmoRefills.push({
            dueTick: this.state.tickIndex + 1,
            sourceItemId: owner.id,
            targetItemId: item.id,
            gainAmmo: gain,
            chargeMs: 1000,
          })
        }
      }
    }

    if (lines.some((s) => /连发次数-1/.test(s))) {
      item.baseStats.multicast = Math.max(1, item.baseStats.multicast - 1)
    }

    const refillAmmoLine = lines.find((s) => /补充\d+(?:[\/|]\d+)*(?:发)?弹药/.test(s))
    if (refillAmmoLine) {
      const gain = (() => {
        const m = refillAmmoLine.match(/补充\s*(\d+(?:[\/|]\d+)*)\s*(?:发)?弹药/)
        if (!m?.[1]) return 0
        return Math.max(0, Math.round(pickTierSeriesValue(m[1], tIdx))) * useRepeatCount
      })()
      if (gain > 0) {
        const allTeamRefill = /为其他物品补充\d+(?:[\/|]\d+)*发弹药/.test(refillAmmoLine)
        for (const ally of this.state.items) {
          if (ally.side !== item.side || ally.id === item.id) continue
          if (!allTeamRefill && !isAdjacentByFootprint(ally, item)) continue
          if (ally.runtime.ammoMax <= 0) continue
          this.refillAmmoAndTriggerGrowth(ally, gain)
        }
      }
    }

    const selfDestroyExplodeLine = lines.find((s) => /弹药耗尽时摧毁自身.*伤害/.test(s))
    if (selfDestroyExplodeLine && item.runtime.ammoMax > 0 && item.runtime.ammoCurrent <= 0) {
      const pctSeries = selfDestroyExplodeLine.match(/最大生命值\s*([+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*)\s*的伤害/)
      const pct = pctSeries?.[1]
        ? (/[\/|]/.test(pctSeries[1]) ? pickTierSeriesValue(pctSeries[1], tIdx) : Number(pctSeries[1].replace(/%$/u, '')))
        : 0
      const fixedSeries = selfDestroyExplodeLine.match(/造成\s*(\d+(?:[\/|]\d+)*)\s*伤害/)
      const fixedDamage = fixedSeries?.[1] ? Math.max(0, Math.round(pickTierSeriesValue(fixedSeries[1], tIdx))) : 0
      const explodeDamage = pct > 0 ? Math.round(targetHero.maxHp * (pct / 100)) : fixedDamage
      if (explodeDamage > 0) this.skillSystem.applyDirectSkillDamage(item.side, explodeDamage, item.id, 'item')
      this.removeItemFromBattle(item.id)
      return
    }

    const postAttackDamageLine = lines.find((s) => /每次攻击后伤害\+\d+(?:[\/|]\d+)*/.test(s))
    if (postAttackDamageLine) {
      const v = Math.round(tierValueFromLine(postAttackDamageLine, tIdx)) * useRepeatCount
      if (v > 0 && isDamageBonusEligible(item)) item.baseStats.damage += v
    }

    // 文案型口径兼容：如「每次使用后伤害提升，弹药:1」未给出明确增量时，按该物品当前档位基础攻击值增长
    if (!postAttackDamageLine && lines.some((s) => /每次使用后伤害提升/.test(s)) && isDamageBonusEligible(item)) {
      const attackLine = lines.find((s) => /攻击造成\d+(?:[\/|]\d+)*伤害/.test(s))
      if (attackLine) {
        const grow = Math.max(0, Math.round(tierValueFromLine(attackLine, tIdx))) * useRepeatCount
        if (grow > 0) item.baseStats.damage += grow
      }
    }

    const postUseShieldLine = lines.find((s) => /每次使用后护盾\+\d+(?:[\/|]\d+)*/.test(s))
    if (postUseShieldLine) {
      const v = Math.round(tierValueFromLine(postUseShieldLine, tIdx)) * useRepeatCount
      if (v > 0) item.baseStats.shield += v
    }

    const adjacentShieldGrowLine = lines.find((s) => /每次使用后相邻护盾物品\+\d+(?:[\/|]\d+)*护盾/.test(s))
    if (adjacentShieldGrowLine) {
      const v = Math.round(tierValueFromLine(adjacentShieldGrowLine, tIdx)) * useRepeatCount
      if (v > 0) {
        for (const ally of this.state.items) {
          if (ally.side !== item.side || ally.id === item.id) continue
          if (ally.baseStats.shield <= 0) continue
          if (!isAdjacentByFootprint(ally, item)) continue
          ally.baseStats.shield += v
        }
      }
    }

    if (lines.some((s) => /(?:每次)?使用后伤害翻倍/.test(s)) && isDamageBonusEligible(item)) {
      for (let i = 0; i < useRepeatCount; i++) item.baseStats.damage = Math.max(0, item.baseStats.damage * 2)
    }

    // 每次使用后自身 CD 减少 1 秒（本场战斗内）
    if (lines.some((s) => /每次使用后自身CD减少1秒/.test(s))) {
      item.baseStats.cooldownMs = Math.max(this.skillSystem.minReducedCdMsFor(item), item.baseStats.cooldownMs - 1000 * useRepeatCount)
    }
    const postUseCooldownLine = lines.find((s) => /攻击后间隔/.test(s))
    if (postUseCooldownLine) {
      const pctMatch = postUseCooldownLine.match(/间隔(?:缩短|减少)\s*(\d+(?:\.\d+)?(?:[\/|]\d+(?:\.\d+)?)*)\s*%/)
      if (pctMatch?.[1]) {
        const pct = Math.max(0, Math.min(0.95, tierValueFromLine(pctMatch[1], tIdx) / 100))
        if (pct > 0) {
          const factor = Math.pow(1 - pct, useRepeatCount)
          item.baseStats.cooldownMs = Math.max(
            this.skillSystem.minReducedCdMsFor(item),
            Math.round(item.baseStats.cooldownMs * factor),
          )
        }
      } else {
        let reduceMs = 1000
        let minMs = 1000
        const matched = postUseCooldownLine.match(/间隔[^\d]*(\d+)\s*ms[^\d]*最低[^\d]*(\d+)\s*ms/i)
        if (matched) {
          const parsedReduce = Number(matched[1])
          const parsedMin = Number(matched[2])
          if (Number.isFinite(parsedReduce) && parsedReduce > 0) reduceMs = parsedReduce
          if (Number.isFinite(parsedMin) && parsedMin > 0) minMs = parsedMin
        }
        item.baseStats.cooldownMs = Math.max(
          Math.max(minMs, this.skillSystem.minReducedCdMsFor(item)),
          item.baseStats.cooldownMs - reduceMs * useRepeatCount,
        )
      }
    }

    const postUseDamageReduceLine = lines.find((s) => /(?:每次)?使用后伤害-[\d|/]+/.test(s))
    if (postUseDamageReduceLine) {
      const v = Math.abs(Math.round(tierValueFromLine(postUseDamageReduceLine, tIdx))) * useRepeatCount
      if (v > 0) item.baseStats.damage = Math.max(1, item.baseStats.damage - v)
    }

    // 飞出时加速相邻物品
    const flyHasteLine = lines.find((s) => /飞出时加速相邻物品/.test(s))
    if (flyHasteLine) {
      const sec = tierValueFromLine(flyHasteLine, tIdx)
      if (sec > 0) {
        const targets = this.state.items.filter((it) => it.side === item.side && it.id !== item.id && isAdjacentByFootprint(it, item))
        this.itemSystem.applyHasteToTargetItems(item, targets, Math.round(sec * 1000 * useRepeatCount))
      }
    }
  }

  private applyBattleStartEffects(): void {
    this.skillSystem.applyBattleStartPassiveGrowths()
    for (const item of this.state.items) {
      const def = findItemDef(item.defId)
      if (!def) continue
      const lines = skillLines(def)
      if (!lines.some((s) => s.includes('开场时'))) continue

      const auto = lines.some((s) => /开场时自动触发/.test(s))
      if (auto) this.resolveFire(item)

      const ctrlSpecs = parseControlSpecsFromDef(def, getConfig().combatRuntime)
      const startSpecs = ctrlSpecs.filter((spec) => lines.some((ln) => {
        if (!ln.includes('开场时')) return false
        if (spec.status === 'freeze') return ln.includes('冻结')
        if (spec.status === 'slow') return ln.includes('减速')
        return ln.includes('加速')
      }))
      for (const spec of startSpecs) {
        const side: 'player' | 'enemy' = spec.targetSide === 'ally' ? item.side : (item.side === 'player' ? 'enemy' : 'player')
        const targets = this.itemSystem.pickControlTargets({
          side,
          count: spec.targetAll ? 999 : spec.count,
          mode: spec.targetMode,
          source: item,
          excludeId: spec.targetSide === 'ally' ? item.id : undefined,
        })
        for (const target of targets) {
          if (spec.status === 'freeze') target.runtime.modifiers.freezeMs = Math.max(target.runtime.modifiers.freezeMs, spec.durationMs)
          if (spec.status === 'slow') target.runtime.modifiers.slowMs = Math.max(target.runtime.modifiers.slowMs, spec.durationMs)
          if (spec.status === 'haste') target.runtime.modifiers.hasteMs = Math.max(target.runtime.modifiers.hasteMs, spec.durationMs)
          EventBus.emit('battle:status_apply', {
            targetId: target.id,
            sourceItemId: item.id,
            status: spec.status,
            amount: spec.durationMs,
            targetType: 'item',
            targetSide: target.side,
            sourceType: 'item',
            sourceSide: item.side,
          })
        }
      }
    }
  }

  private resolvePendingHitsForCurrentTick(): void {
    if (!this.state.pendingHits.length) return
    const due = this.state.pendingHits.filter((h) => h.dueTick <= this.state.tickIndex)
    this.state.pendingHits = this.state.pendingHits.filter((h) => h.dueTick > this.state.tickIndex)

    for (let hitIdx = 0; hitIdx < due.length; hitIdx++) {
      const hit = due[hitIdx]!
      EventBus.emit('battle:item_fire', {
        itemId: hit.defId,
        sourceItemId: hit.sourceItemId,
        side: hit.side,
        multicast: 1,
      })
      const attacker = this.state.items.find((it) => it.id === hit.sourceItemId)
      if (attacker) this.itemSystem.applyOnWeaponAttackTriggers(attacker)

      let resolvedBaseDamage = hit.baseDamage
      let resolvedDamage = hit.damage
      if (attacker && !hit.lockAttackerDelta && typeof hit.attackerDamageAtQueue === 'number') {
        const currentAttackerDamage = this.scaledDamage(attacker, attacker.baseStats.damage + attacker.runtime.tempDamageBonus + this.runtimeGlobalDamageBonus(attacker))
        const delta = currentAttackerDamage - hit.attackerDamageAtQueue
        if (delta !== 0) {
          resolvedBaseDamage = Math.max(0, hit.baseDamage + delta)
          resolvedDamage = Math.max(0, hit.damage + delta)
        }
      }
      resolvedBaseDamage = Math.max(0, Math.min(ITEM_DAMAGE_CAP, Math.round(resolvedBaseDamage)))
      resolvedDamage = Math.max(0, Math.min(ITEM_DAMAGE_CAP, Math.round(resolvedDamage)))
      const targetHero = hit.side === 'player' ? this.state.enemyHero : this.state.playerHero
      if (targetHero.hp <= 0) continue
      const critRoll = makeSeededRng(seedFrom(hit.defId, this.state.tickIndex * 1000 + hitIdx))() * 100
      const isCrit = critRoll < hit.crit
      const critMult = getConfig().combatRuntime.critMultiplier
      const panel = Math.max(0, Math.min(ITEM_DAMAGE_CAP, isCrit ? Math.round(resolvedDamage * critMult) : resolvedDamage))

      let remaining = panel
      const hpBefore = targetHero.hp
      if (!this.isHeroInvincible(targetHero.side)) {
        if (targetHero.shield > 0) {
          const blocked = Math.min(targetHero.shield, remaining)
          targetHero.shield -= blocked
          remaining -= blocked
        }
        if (remaining > 0) {
          targetHero.hp = Math.max(0, targetHero.hp - remaining)
          this.skillSystem.handleHeroHpThresholdTriggers(targetHero.side, hpBefore, targetHero.hp)
        }
      } else {
        remaining = 0
      }

      EventBus.emit('battle:take_damage', {
        targetId: targetHero.id,
        sourceItemId: hit.sourceItemId,
        amount: panel,
        isCrit,
        type: 'normal',
        targetType: 'hero',
        targetSide: targetHero.side,
        sourceType: 'item',
        sourceSide: hit.side,
        baseDamage: resolvedBaseDamage,
        finalDamage: remaining,
      })

      if (panel > 0) {
        this.skillSystem.applyOnHeroDamagedReactions(targetHero.side)
      }

      if (panel > 0) {
        this.skillSystem.applyWanJianGrowthOnAnyDamage(hit.side)
        if (attacker) {
          this.applyOnDealDamageLifesteal(attacker, remaining)
          this.skillSystem.applyOnDealDamageSkillTriggers(attacker)
          this.itemSystem.applyAdjacentAttackDamageGrowth(attacker)
        }
        this.skillSystem.tryDeathMarkExecution(hit.side, targetHero)
      }

      if (targetHero.hp === 0) {
        EventBus.emit('battle:unit_die', {
          unitId: targetHero.id,
          side: targetHero.side,
        })
      }
    }
  }
  private stepFatigue(): void {
    const cr = getConfig().combatRuntime
    const tickMs = Math.max(1, rv('fatigueTickMs', cr.fatigueTickMs ?? cr.fatigueIntervalMs ?? 1000))
    const fixedBase = Math.max(0, rv('fatigueBaseValue', cr.fatigueBaseValue ?? cr.fatigueDamageFixedPerInterval ?? 1))
    const doubleEveryMs = Math.max(1, rv('fatigueDoubleEveryMs', cr.fatigueDoubleEveryMs ?? 1000))
    const elapsedFatigueMs = this.state.fatigueTickCount * tickMs
    const stack = Math.floor(elapsedFatigueMs / doubleEveryMs)
    const factor = Math.pow(2, Math.min(30, stack))
    const panelDamage = Math.max(1, Math.round(fixedBase * factor))

    const pPanel = panelDamage
    const ePanel = panelDamage

    const applyOne = (hero: HeroState, panel: number): { panel: number; hpDamage: number } => {
      if (this.isHeroInvincible(hero.side)) return { panel, hpDamage: 0 }
      const hpBefore = hero.hp
      let remaining = panel
      if (hero.shield > 0) {
        const blocked = Math.min(hero.shield, remaining)
        hero.shield -= blocked
        remaining -= blocked
      }
      if (remaining > 0) {
        hero.hp = Math.max(0, hero.hp - remaining)
        this.skillSystem.handleHeroHpThresholdTriggers(hero.side, hpBefore, hero.hp)
      }
      return { panel, hpDamage: remaining }
    }

    const p = applyOne(this.state.playerHero, pPanel)
    const e = applyOne(this.state.enemyHero, ePanel)

    this.state.fatigueTickCount += 1

    EventBus.emit('battle:fatigue_tick', {
      elapsedMs: this.state.elapsedMs,
      tick: this.state.fatigueTickCount,
      playerDamage: p.hpDamage,
      enemyDamage: e.hpDamage,
    })

    EventBus.emit('battle:take_damage', {
      targetId: this.state.playerHero.id,
      sourceItemId: 'fatigue',
      amount: p.panel,
      isCrit: false,
      type: 'normal',
      targetType: 'hero',
      targetSide: 'player',
      sourceType: 'system',
      sourceSide: 'system',
      finalDamage: p.hpDamage,
    })
    EventBus.emit('battle:take_damage', {
      targetId: this.state.enemyHero.id,
      sourceItemId: 'fatigue',
      amount: e.panel,
      isCrit: false,
      type: 'normal',
      targetType: 'hero',
      targetSide: 'enemy',
      sourceType: 'system',
      sourceSide: 'system',
      finalDamage: e.hpDamage,
    })
    this.clampCombatCaps()
  }

  private processStatusPeriodicByTick(): void {
    const cr = getConfig().combatRuntime
    const tickMs = Math.max(1, cr.tickMs)
    const burnTickEvery = Math.max(1, Math.round(Math.max(1, rv('burnTickMs', cr.burnTickMs)) / tickMs))
    const poisonTickEvery = Math.max(1, Math.round(Math.max(1, rv('poisonTickMs', cr.poisonTickMs)) / tickMs))
    const regenTickEvery = Math.max(1, Math.round(Math.max(1, rv('regenTickMs', cr.regenTickMs)) / tickMs))
    const skill33TickEvery = Math.max(1, Math.round(1000 / tickMs))

    if (this.state.tickIndex % burnTickEvery === 0) {
      this.applyBurnTick(this.state.playerHero)
      this.applyBurnTick(this.state.enemyHero)
    }

    if (this.state.tickIndex % poisonTickEvery === 0) {
      this.applyPoisonTick(this.state.playerHero)
      this.applyPoisonTick(this.state.enemyHero)
    }

    if (this.state.tickIndex % regenTickEvery === 0) {
      this.applyRegenTick(this.state.playerHero)
      this.applyRegenTick(this.state.enemyHero)
    }

    if (this.state.tickIndex % skill33TickEvery === 0) {
      this.skillSystem.applySkill33RegenTick()
    }
  }

  private applyBurnTick(hero: HeroState): void {
    const layer = hero.burn
    if (layer <= 0 || hero.hp <= 0) return
    if (this.isHeroInvincible(hero.side)) return
    let hpDamage = layer
    const shieldFactor = Math.max(0, rv('burnShieldFactor', getConfig().combatRuntime.burnShieldFactor))
    if (hero.shield > 0) {
      const shieldCost = Math.min(hero.shield, Math.ceil(layer * shieldFactor))
      hero.shield -= shieldCost
      const protectedValue = shieldFactor > 0 ? shieldCost / shieldFactor : 0
      hpDamage = Math.max(0, Math.round(layer - protectedValue))
    }
    if (hpDamage > 0) {
      const hpBefore = hero.hp
      hero.hp = Math.max(0, hero.hp - hpDamage)
      this.skillSystem.handleHeroHpThresholdTriggers(hero.side, hpBefore, hero.hp)
      EventBus.emit('battle:take_damage', {
        targetId: hero.id,
        sourceItemId: 'status_burn',
        amount: hpDamage,
        isCrit: false,
        type: 'burn',
        targetType: 'hero',
        targetSide: hero.side,
        sourceType: 'system',
        sourceSide: 'system',
      })
    }

    const decayPct = Math.max(0, rv('burnDecayPct', getConfig().combatRuntime.burnDecayPct))
    const decay = Math.ceil(layer * decayPct)
    if (decay > 0) {
      const burnBefore = hero.burn
      hero.burn = Math.max(0, hero.burn - decay)
      if (burnBefore > 0 && hero.burn === 0) {
        EventBus.emit('battle:status_remove', {
          targetId: hero.id,
          status: 'burn',
          targetType: 'hero',
          targetSide: hero.side,
        })
      }
    }
  }

  private applyPoisonTick(hero: HeroState): void {
    const layer = hero.poison
    if (layer <= 0 || hero.hp <= 0) return
    if (this.isHeroInvincible(hero.side)) return
    const hpBefore = hero.hp
    hero.hp = Math.max(0, hero.hp - layer)
    this.skillSystem.handleHeroHpThresholdTriggers(hero.side, hpBefore, hero.hp)
    EventBus.emit('battle:take_damage', {
      targetId: hero.id,
      sourceItemId: 'status_poison',
      amount: layer,
      isCrit: false,
      type: 'poison',
      targetType: 'hero',
      targetSide: hero.side,
      sourceType: 'system',
      sourceSide: 'system',
    })
  }

  private applyRegenTick(hero: HeroState): void {
    const layer = hero.regen
    if (layer <= 0 || hero.hp <= 0) return
    const healed = Math.max(0, Math.min(hero.maxHp - hero.hp, layer))
    if (healed <= 0) return
    hero.hp += healed
    EventBus.emit('battle:heal', {
      targetId: hero.id,
      sourceItemId: 'status_regen',
      amount: healed,
      isRegen: true,
      targetType: 'hero',
      targetSide: hero.side,
      sourceType: 'system',
      sourceSide: 'system',
    })
  }

  private shouldResolve(): boolean {
    this.skillSystem.applyReviveIfPossible('player')
    this.skillSystem.applyReviveIfPossible('enemy')
    return this.state.playerHero.hp <= 0 || this.state.enemyHero.hp <= 0
  }

  private computeSurvivingDamage(_winnerSide: 'player' | 'enemy'): number {
    // 固定扣血：每次失败扣 baseDamage 点，不计算存活物品权重
    return getConfig().pvpRules?.baseDamage ?? 1
  }

  private finishCombat(): void {
    if (this.state.finished) return
    this.state.finished = true
    this.state.phase = 'END'
    let winner: 'player' | 'enemy' | 'draw' = 'draw'
    if (this.state.playerHero.hp > 0 && this.state.enemyHero.hp <= 0) winner = 'player'
    if (this.state.enemyHero.hp > 0 && this.state.playerHero.hp <= 0) winner = 'enemy'
    const survivingDamage = winner === 'draw' ? 0
      : winner === 'player' ? this.computeSurvivingDamage('player')
      : this.computeSurvivingDamage('enemy')
    this.state.result = { winner, ticks: this.state.tickIndex, survivingDamage }
    EventBus.emit('battle:end', {
      winner,
      blameLog: [
        `day=${this.state.day}`,
        `ticks=${this.state.tickIndex}`,
        `playerHp=${this.state.playerHero.hp}`,
        `enemyHp=${this.state.enemyHero.hp}`,
        `fatigue=${this.state.inFatigue ? '1' : '0'}`,
      ],
    })
  }
}
