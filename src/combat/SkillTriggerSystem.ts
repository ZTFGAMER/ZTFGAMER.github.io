// ============================================================
// SkillTriggerSystem — 技能触发系统（class 模式，持有 CombatState 引用）
// 主程方案：constructor(private state: CombatState, private engine: ICombatEngineBase)
// 内部方法互调无需传参，外部 Engine 操作通过 ICombatEngineBase 接口回调
// ============================================================

import { EventBus } from '@/core/EventBus'
import type { BattleSnapshotBundle } from '@/combat/BattleSnapshotStore'
import { getConfig } from '@/core/DataLoader'
import type { SkillArchetype } from '@/items/ItemDef'
import type {
  CombatState, CombatItemRunner, HeroState,
  SkillTierLite, DraftSkillLite
} from './CombatTypes'
import {
  DEBUG_SHIELD_CHARGE, MIN_REDUCED_CD_MS,
  pickTierSeriesValue, tierIndexFromRaw, tierValueFromLine,
  makeSeededRng, getPrimaryArchetypeTag, normalizeSkillArchetype, ALL_DRAFT_SKILLS,
  findItemDef, skillLines, isDamageBonusEligible, isAmmoItem, isShieldItem, isAdjacentByFootprint,
  itemWidth, isWeaponItem, itemArchetype
} from './CombatHelpers'

// ── ICombatEngineBase — SkillTriggerSystem 需要回调 CombatEngine 的方法 ──
export interface ICombatEngineBase {
  chargeItemByMs(owner: CombatItemRunner, gainMs: number): void
  enqueueExtraTriggeredUse(source: CombatItemRunner): void
  effectiveCooldownMs(item: CombatItemRunner): number
}

export class SkillTriggerSystem {
  constructor(
    private state: CombatState,
    private engine: ICombatEngineBase,
  ) {}

  private debugLog(msg: string, extra?: Record<string, unknown>): void {
    if (!DEBUG_SHIELD_CHARGE) return
    const payload = extra ? ` ${JSON.stringify(extra)}` : ''
    console.warn(`[SkillTriggerSystem][shield-charge] ${msg}${payload}`)
  }

  // ── 状态查询辅助（private）─────────────────────────────────

  private hasPlayerSkill(id: string): boolean {
    return this.state.playerSkillIds.has(id)
  }

  private hasEnemySkill(id: string): boolean {
    return this.state.enemySkillIds.has(id)
  }

  private hasSkill(side: 'player' | 'enemy', id: string): boolean {
    return side === 'player' ? this.hasPlayerSkill(id) : this.hasEnemySkill(id)
  }

  private heroOf(side: 'player' | 'enemy'): HeroState {
    return side === 'player' ? this.state.playerHero : this.state.enemyHero
  }

  private oppositeSide(side: 'player' | 'enemy'): 'player' | 'enemy' {
    return side === 'player' ? 'enemy' : 'player'
  }

  private isHeroInvincible(side: 'player' | 'enemy'): boolean {
    return (this.state.heroInvincibleMsBySide[side] ?? 0) > 0
  }

  private leftmostDamageItem(side: 'player' | 'enemy'): CombatItemRunner | null {
    const all = this.sortedItemsBySide(side, (it) => isDamageBonusEligible(it))
    return all[0] ?? null
  }

  private occupiedColsBySide(side: 'player' | 'enemy'): number {
    const occupied = new Set<number>()
    for (const one of this.state.items) {
      if (one.side !== side) continue
      const width = itemWidth(one.size)
      for (let c = 0; c < width; c++) occupied.add(one.col + c)
    }
    return occupied.size
  }

  private sortedItemsBySide(side: 'player' | 'enemy', filterFn: (item: CombatItemRunner) => boolean): CombatItemRunner[] {
    return this.state.items
      .filter((it) => it.side === side && filterFn(it))
      .sort((a, b) => (a.col - b.col) || a.id.localeCompare(b.id))
  }

  minReducedCdMsFor(item: CombatItemRunner): number {
    return this.hasSkill(item.side, 'skill40') ? 100 : MIN_REDUCED_CD_MS
  }

  scaleShieldGain(side: 'player' | 'enemy', amount: number): number {
    const base = Math.max(0, Math.round(amount))
    if (base <= 0) return 0
    if (this.hasSkill(side, 'skill39') && this.state.elapsedMs <= 10000) {
      return Math.max(0, Math.round(base * 2))
    }
    return base
  }

  applyOnShieldGainCharge(side: 'player' | 'enemy'): void {
    for (const owner of this.state.items) {
      if (owner.side !== side) continue
      const def = findItemDef(owner.defId)
      if (!def) continue
      const line = skillLines(def).find((s) => /获得护盾时.*充能\d+(?:\/\d+)*秒/.test(s))
      if (!line) continue
      const gainMs = Math.max(0, Math.round(tierValueFromLine(line, tierIndexFromRaw(def, owner.tier)) * 1000))
      if (gainMs <= 0) continue

      this.debugLog('on_shield_gain_detected', {
        tick: this.state.tickIndex,
        itemId: owner.id,
        defId: owner.defId,
        side: owner.side,
        gainMs,
        currentChargeMs: owner.runtime.currentChargeMs,
        pendingChargeMs: owner.runtime.pendingChargeMs,
        cooldownMs: this.engine.effectiveCooldownMs(owner),
      })

      this.engine.chargeItemByMs(owner, gainMs)
    }
  }

  applyOnAmmoRefilledDamageGrowth(target: CombatItemRunner, gainedAmmo: number): void {
    const gained = Math.max(0, Math.round(gainedAmmo))
    if (gained <= 0) return
    const def = findItemDef(target.defId)
    if (!def) return
    if (!isDamageBonusEligible(target)) return
    const line = skillLines(def).find((s) => /补充弹药时伤害\+\d+(?:[\/|]\d+)*/.test(s))
    if (!line) return
    const perAmmo = Math.max(0, Math.round(tierValueFromLine(line, tierIndexFromRaw(def, target.tier))))
    if (perAmmo <= 0) return
    target.baseStats.damage += perAmmo * gained
  }


  // ── 技能触发方法（public）────────────────────────────────────

  rollEnemySkillIds(snapshot: BattleSnapshotBundle): Set<string> {
    const out = new Set<string>()
    const skillCfg = getConfig().skillSystem
    if (!skillCfg?.enemyMirrorDraft?.enabled) return out

    const planRows = Array.isArray(skillCfg.dailyDraftPlan) ? skillCfg.dailyDraftPlan : []
    const draftedPlans = planRows
      .filter((it) => Math.round(Number(it.day) || 0) <= this.state.day && (Number(it.shouldDraft) || 0) >= 0.5)
      .sort((a, b) => (Math.round(Number(a.day) || 0) - Math.round(Number(b.day) || 0)))
    if (draftedPlans.length <= 0) return out

    const pickByDay = skillCfg.enemyMirrorDraft.pickCountByDay ?? []
    const configuredPick = Math.max(0, Math.round(Number(pickByDay[Math.max(0, this.state.day - 1)] ?? 0) || 0))
    const pickCount = Math.max(configuredPick, draftedPlans.length)
    if (pickCount <= 0) return out

    const rngSeed = this.state.day * 1619 + Math.max(1, Math.round(snapshot.createdAtMs % 1000000)) * 13 + this.state.items.length * 97
    const rng = makeSeededRng(rngSeed)

    const enemyItems = this.state.items.filter((it) => it.side === 'enemy')
    const archCount = new Map<SkillArchetype, number>()
    for (const one of enemyItems) {
      const def = findItemDef(one.defId)
      const tag = normalizeSkillArchetype(getPrimaryArchetypeTag(def?.tags ?? ''))
      if (!tag) continue
      archCount.set(tag, (archCount.get(tag) ?? 0) + 1)
    }

    const archetypes: SkillArchetype[] = ['warrior', 'archer', 'assassin', 'utility']
    const maxCount = Math.max(...archetypes.map((k) => archCount.get(k) ?? 0), 0)
    const preferredPool = archetypes.filter((k) => (archCount.get(k) ?? 0) === maxCount)
    const preferredArchetype = preferredPool.length > 0
      ? preferredPool[Math.floor(rng() * preferredPool.length)]!
      : 'utility'

    const minRatioRaw = Number(skillCfg.enemyMirrorDraft.mainArchetypeRatioMin ?? 0.4)
    const maxRatioRaw = Number(skillCfg.enemyMirrorDraft.mainArchetypeRatioMax ?? 0.8)
    const minRatio = Math.max(0, Math.min(1, Math.min(minRatioRaw, maxRatioRaw)))
    const maxRatio = Math.max(0, Math.min(1, Math.max(minRatioRaw, maxRatioRaw)))
    const minMain = Math.max(0, Math.min(pickCount, Math.ceil(pickCount * minRatio)))
    const maxMain = Math.max(minMain, Math.min(pickCount, Math.floor(pickCount * maxRatio)))
    const targetMain = minMain + Math.floor(rng() * (maxMain - minMain + 1))

    const used = new Set<string>()
    const pickTierByPlan = (plan: Record<string, unknown>): SkillTierLite => {
      const bronzeProb = Math.max(0, Number(plan.bronzeProb) || 0)
      const silverProb = Math.max(0, Number(plan.silverProb) || 0)
      const goldProb = Math.max(0, Number(plan.goldProb) || 0)
      const tierSum = bronzeProb + silverProb + goldProb
      if (tierSum <= 0) return 'bronze'
      let roll = rng() * tierSum
      if (roll < bronzeProb) return 'bronze'
      roll -= bronzeProb
      if (roll < silverProb) return 'silver'
      return 'gold'
    }

    const pickOne = (tier: SkillTierLite, forcedArch: SkillArchetype | null): DraftSkillLite | null => {
      const tierPool = ALL_DRAFT_SKILLS.filter((s) => s.tier === tier && !used.has(s.id))
      const forcePool = forcedArch ? tierPool.filter((s) => s.archetype === forcedArch) : tierPool
      const primary = forcePool.length > 0 ? forcePool : tierPool
      if (primary.length <= 0) return null
      return primary[Math.floor(rng() * primary.length)] ?? null
    }

    const slotPlans: Array<Record<string, unknown>> = [...draftedPlans]
    while (slotPlans.length < pickCount) {
      const idx = Math.max(0, draftedPlans.length - 1 - ((slotPlans.length - draftedPlans.length) % draftedPlans.length))
      slotPlans.push(draftedPlans[idx]!)
    }

    const slotMustMain = Array.from({ length: slotPlans.length }, (_, i) => i < targetMain)
    for (let i = slotMustMain.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const t = slotMustMain[i]
      slotMustMain[i] = slotMustMain[j]!
      slotMustMain[j] = t!
    }

    for (let i = 0; i < slotPlans.length; i++) {
      const tier = pickTierByPlan(slotPlans[i]!)
      const mustMain = slotMustMain[i] === true
      const picked = pickOne(tier, mustMain ? preferredArchetype : null)
      if (!picked) continue
      used.add(picked.id)
      out.add(picked.id)
    }

    return out
  }

  applyPickedSkillBattleStartEffects(): void {
    const isZoneNotFull = (side: 'player' | 'enemy'): boolean => {
      const cap = Math.max(1, this.state.playerActiveColCount)
      return this.occupiedColsBySide(side) < cap
    }

    const applySide = (side: 'player' | 'enemy'): void => {
      const hasAnySkill = side === 'player' ? this.state.playerSkillIds.size > 0 : this.state.enemySkillIds.size > 0
      if (!hasAnySkill) return
      const hero = this.heroOf(side)
      const shieldItems = this.sortedItemsBySide(side, (it) => isShieldItem(it))
      const ammoItems = this.sortedItemsBySide(side, (it) => isAmmoItem(it))
      const weaponItems = this.sortedItemsBySide(side, (it) => isWeaponItem(it))

      if (this.hasSkill(side, 'skill1') && shieldItems.length > 0) shieldItems[0]!.baseStats.shield += 25
      if (this.hasSkill(side, 'skill2') && shieldItems.length > 0) shieldItems[shieldItems.length - 1]!.baseStats.shield += 25
      if (this.hasSkill(side, 'skill3')) {
        for (const one of shieldItems) one.baseStats.shield += 10
      }

      if (this.hasSkill(side, 'skill7')) {
        hero.maxHp = Math.max(1, Math.round(hero.maxHp * 1.1))
        hero.hp = Math.min(hero.maxHp, Math.round(hero.hp * 1.1))
      }

      if (this.hasSkill(side, 'skill49') && isZoneNotFull(side)) {
        hero.maxHp = Math.max(1, Math.round(hero.maxHp * 2))
        hero.hp = Math.min(hero.maxHp, Math.round(hero.hp * 2))
      }

      if (this.hasSkill(side, 'skill36')) {
        const gainShield = this.scaleShieldGain(side, Math.round(hero.maxHp * 0.3))
        if (gainShield > 0) {
          hero.shield += gainShield
          EventBus.emit('battle:gain_shield', {
            targetId: hero.id,
            sourceItemId: 'skill36',
            amount: gainShield,
            targetType: 'hero',
            targetSide: hero.side,
            sourceType: 'system',
            sourceSide: side,
          })
          this.applyOnShieldGainCharge(side)
          this.applyShieldGainSkillTriggers(side, 'skill36', gainShield, false)
        }
      }

      if (this.hasSkill(side, 'skill8') && ammoItems.length > 0) {
        const one = ammoItems[0]!
        one.runtime.ammoMax += 2
        one.runtime.ammoCurrent = Math.min(one.runtime.ammoMax, one.runtime.ammoCurrent + 2)
      }
      if (this.hasSkill(side, 'skill51')) {
        for (const one of ammoItems) {
          one.runtime.ammoMax += 2
          one.runtime.ammoCurrent = Math.min(one.runtime.ammoMax, one.runtime.ammoCurrent + 2)
        }
      }
      if (this.hasSkill(side, 'skill44') && ammoItems.length === 1) {
        const one = ammoItems[0]!
        one.runtime.ammoMax += 10
        one.runtime.ammoCurrent = Math.min(one.runtime.ammoMax, one.runtime.ammoCurrent + 10)
      }

      if (this.hasSkill(side, 'skill10')) {
        for (const one of ammoItems) {
          if (isDamageBonusEligible(one)) one.baseStats.damage += 10
        }
      }

      if (this.hasSkill(side, 'skill16')) {
        for (const one of weaponItems) one.baseStats.damage += 8
      }

      if (this.hasSkill(side, 'skill19') && weaponItems.length > 0) {
        const first = weaponItems[0]!
        const last = weaponItems[weaponItems.length - 1]!
        first.baseStats.damage += 12
        if (last.id !== first.id) last.baseStats.damage += 12
      }

      if (this.hasSkill(side, 'skill59')) {
        const countByDef = new Map<string, number>()
        for (const one of this.state.items) {
          if (one.side !== side) continue
          countByDef.set(one.defId, (countByDef.get(one.defId) ?? 0) + 1)
        }
        for (const one of this.state.items) {
          if (one.side !== side) continue
          if (one.baseStats.damage <= 0) continue
          if ((countByDef.get(one.defId) ?? 0) < 2) continue
          one.baseStats.damage += 20
        }
      }

      const backpackCount = side === 'player' ? this.state.playerBackpackItemCount : this.state.enemyBackpackItemCount
      if (this.hasSkill(side, 'skill35') && backpackCount > 0) {
        const mul = 1 + backpackCount * 0.02
        hero.maxHp = Math.max(1, Math.round(hero.maxHp * mul))
        hero.hp = Math.min(hero.maxHp, Math.round(hero.hp * mul))
      }

      const trophyWins = side === 'player' ? this.state.playerTrophyWinsAtBattleStart : this.state.enemyTrophyWinsAtBattleStart
      const goldAtStart = side === 'player' ? this.state.playerGoldAtBattleStart : this.state.enemyGoldAtBattleStart
      if (this.hasSkill(side, 'skill46') && trophyWins > 0) {
        if (side === 'player') this.state.skillExecuteDamageBonus += trophyWins * 15
        else this.state.skillEnemyExecuteDamageBonus += trophyWins * 15
      }
      if (this.hasSkill(side, 'skill95') && goldAtStart > 0) {
        if (side === 'player') this.state.skillExecuteDamageBonus += Math.floor(goldAtStart / 3)
        else this.state.skillEnemyExecuteDamageBonus += Math.floor(goldAtStart / 3)
      }

      if (this.hasSkill(side, 'skill33')) {
        const regenPerTick = Math.max(1, Math.round(hero.maxHp * 0.03))
        if (side === 'player') this.state.skill33RegenPerTick = regenPerTick
        else this.state.skillEnemy33RegenPerTick = regenPerTick
      }
    }

    applySide('player')
    applySide('enemy')
  }

  handleHeroHpThresholdTriggers(side: 'player' | 'enemy', hpBefore: number, hpAfter: number): void {
    const hero = side === 'player' ? this.state.playerHero : this.state.enemyHero
    if (hpBefore > 0 && hpAfter <= 0 && !this.state.unyieldingTriggeredBySide[side]) {
      const guard = this.state.items.find((it) => {
        if (it.side !== side) return false
        const def = findItemDef(it.defId)
        return skillLines(def).some((s) => /濒死时获得\d+秒无敌.*最大生命值.*%.*护盾/.test(s))
      })
      if (guard) {
        const def = findItemDef(guard.defId)
        const line = skillLines(def).find((s) => /濒死时获得\d+秒无敌.*最大生命值.*%.*护盾/.test(s))
        let pct = 0
        let invincibleMs = 3000
        if (line) {
          const tIdx = tierIndexFromRaw(def, guard.tier)
          const secMatch = line.match(/濒死时获得\s*(\d+)\s*秒无敌/)
          if (secMatch?.[1]) {
            const sec = Number(secMatch[1])
            if (Number.isFinite(sec) && sec > 0) invincibleMs = Math.round(sec * 1000)
          }
          const m = line.match(/最大生命值\s*([+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)*)\s*的护盾/)
          if (m?.[1]) {
            pct = /[\/|]/.test(m[1]) ? pickTierSeriesValue(m[1], tIdx) : Number(m[1].replace(/%$/u, ''))
            pct = Math.max(0, pct)
          }
        }
        this.state.unyieldingTriggeredBySide[side] = true
        hero.hp = 1
        this.state.heroInvincibleMsBySide[side] = Math.max(this.state.heroInvincibleMsBySide[side], invincibleMs)
        if (pct > 0) {
          const gainShield = this.scaleShieldGain(side, Math.round(hero.maxHp * (pct / 100)))
          if (gainShield > 0) {
            hero.shield += gainShield
            EventBus.emit('battle:gain_shield', {
              targetId: hero.id,
              sourceItemId: guard.id,
              amount: gainShield,
              targetType: 'hero',
              targetSide: hero.side,
              sourceType: 'item',
              sourceSide: side,
            })
          }
        }
        hpAfter = hero.hp
      }
    }

    const threshold = hero.maxHp * 0.5
    if (!(hpBefore > threshold && hpAfter <= threshold)) return

    const owner = this.oppositeSide(side)
    if (owner === 'player') {
      if (!this.state.skillEnemyHalfTriggered && (this.hasPlayerSkill('skill18') || this.hasPlayerSkill('skill45'))) {
        this.state.skillEnemyHalfTriggered = true
        if (this.hasPlayerSkill('skill18')) this.state.skillExecuteDamageBonus += 15
        if (this.hasPlayerSkill('skill45')) {
          for (const it of this.state.items) {
            if (it.side !== 'player') continue
            this.engine.chargeItemByMs(it, 2000)
          }
        }
      }
    } else {
      if (!this.state.skillEnemyHalfTriggeredFromEnemy && (this.hasEnemySkill('skill18') || this.hasEnemySkill('skill45'))) {
        this.state.skillEnemyHalfTriggeredFromEnemy = true
        if (this.hasEnemySkill('skill18')) this.state.skillEnemyExecuteDamageBonus += 15
        if (this.hasEnemySkill('skill45')) {
          for (const it of this.state.items) {
            if (it.side !== 'enemy') continue
            this.engine.chargeItemByMs(it, 2000)
          }
        }
      }
    }

    if (side === 'player') {
      if (!this.state.skillPlayerHalfTriggered && this.hasPlayerSkill('skill21')) {
        this.state.skillPlayerHalfTriggered = true
        const heal = Math.max(0, Math.round(hero.maxHp * 0.15))
        const real = Math.max(0, Math.min(hero.maxHp - hero.hp, heal))
        if (real > 0) {
          hero.hp += real
          EventBus.emit('battle:heal', {
            targetId: hero.id,
            sourceItemId: 'skill21',
            amount: real,
            isRegen: false,
            targetType: 'hero',
            targetSide: hero.side,
            sourceType: 'system',
            sourceSide: 'player',
          })
        }
      }

      if (!this.state.skillPlayerHalfShieldTriggered && this.hasPlayerSkill('skill25')) {
        this.state.skillPlayerHalfShieldTriggered = true
        const gainShield = this.scaleShieldGain('player', Math.round(hero.maxHp * 0.2))
        if (gainShield > 0) {
          hero.shield += gainShield
          EventBus.emit('battle:gain_shield', {
            targetId: hero.id,
            sourceItemId: 'skill25',
            amount: gainShield,
            targetType: 'hero',
            targetSide: hero.side,
            sourceType: 'system',
            sourceSide: 'player',
          })
          this.applyOnShieldGainCharge('player')
          this.applyShieldGainSkillTriggers('player', 'skill25', gainShield, false)
        }
      }

      if (!this.state.skillPlayerHalfShieldCdTriggered && this.hasPlayerSkill('skill26')) {
        this.state.skillPlayerHalfShieldCdTriggered = true
      }
      return
    }

    if (!this.state.skillEnemySelfHalfTriggered && this.hasEnemySkill('skill21')) {
      this.state.skillEnemySelfHalfTriggered = true
      const heal = Math.max(0, Math.round(hero.maxHp * 0.15))
      const real = Math.max(0, Math.min(hero.maxHp - hero.hp, heal))
      if (real > 0) {
        hero.hp += real
        EventBus.emit('battle:heal', {
          targetId: hero.id,
          sourceItemId: 'skill21',
          amount: real,
          isRegen: false,
          targetType: 'hero',
          targetSide: hero.side,
          sourceType: 'system',
          sourceSide: 'enemy',
        })
      }
    }

    if (!this.state.skillEnemyHalfShieldTriggered && this.hasEnemySkill('skill25')) {
      this.state.skillEnemyHalfShieldTriggered = true
      const gainShield = this.scaleShieldGain('enemy', Math.round(hero.maxHp * 0.2))
      if (gainShield > 0) {
        hero.shield += gainShield
        EventBus.emit('battle:gain_shield', {
          targetId: hero.id,
          sourceItemId: 'skill25',
          amount: gainShield,
          targetType: 'hero',
          targetSide: hero.side,
          sourceType: 'system',
          sourceSide: 'enemy',
        })
        this.applyOnShieldGainCharge('enemy')
        this.applyShieldGainSkillTriggers('enemy', 'skill25', gainShield, false)
      }
    }

    if (!this.state.skillEnemyHalfShieldCdTriggered && this.hasEnemySkill('skill26')) {
      this.state.skillEnemyHalfShieldCdTriggered = true
    }
  }

  applyDirectSkillDamage(
    sourceSide: 'player' | 'enemy',
    panel: number,
    sourceSkillId: string,
    sourceType: 'system' | 'item' = 'system',
  ): void {
    const targetHero = sourceSide === 'player' ? this.state.enemyHero : this.state.playerHero
    if (panel <= 0 || targetHero.hp <= 0) return
    if (this.isHeroInvincible(targetHero.side)) {
      EventBus.emit('battle:take_damage', {
        targetId: targetHero.id,
        sourceItemId: sourceSkillId,
        amount: panel,
        isCrit: false,
        type: 'normal',
        targetType: 'hero',
        targetSide: targetHero.side,
        sourceType,
        sourceSide,
        baseDamage: panel,
        finalDamage: 0,
      })
      return
    }
    let remaining = panel
    const hpBefore = targetHero.hp
    if (targetHero.shield > 0) {
      const blocked = Math.min(targetHero.shield, remaining)
      targetHero.shield -= blocked
      remaining -= blocked
    }
    if (remaining > 0) {
      targetHero.hp = Math.max(0, targetHero.hp - remaining)
      this.handleHeroHpThresholdTriggers(targetHero.side, hpBefore, targetHero.hp)
    }
    EventBus.emit('battle:take_damage', {
      targetId: targetHero.id,
      sourceItemId: sourceSkillId,
      amount: panel,
      isCrit: false,
      type: 'normal',
      targetType: 'hero',
      targetSide: targetHero.side,
      sourceType,
      sourceSide,
      baseDamage: panel,
      finalDamage: remaining,
    })
    if (panel > 0) {
      this.applyWanJianGrowthOnAnyDamage(sourceSide)
    }
    if (targetHero.hp === 0) {
      EventBus.emit('battle:unit_die', {
        unitId: targetHero.id,
        side: targetHero.side,
      })
    }
  }

  applyShieldGainSkillTriggers(side: 'player' | 'enemy', sourceItemId: string, gainedShield = 0, fromShieldItem = false): void {
    if (!this.hasSkill(side, 'skill22') && !this.hasSkill(side, 'skill23') && !this.hasSkill(side, 'skill24') && !this.hasSkill(side, 'skill82')) return

    if (this.hasSkill(side, 'skill22')) {
      const leftmostDamage = this.leftmostDamageItem(side)
      if (leftmostDamage) leftmostDamage.baseStats.damage += 15
    }

    if (this.hasSkill(side, 'skill23')) {
      this.applyDirectSkillDamage(side, 30, 'skill23')
    }

    if (this.hasSkill(side, 'skill24')) {
      const source = this.state.items.find((it) => it.id === sourceItemId && it.side === side)
      if (source) {
        for (const ally of this.state.items) {
          if (ally.side !== side || ally.id === source.id) continue
          if (!isAdjacentByFootprint(ally, source)) continue
          if (!isShieldItem(ally)) continue
          ally.baseStats.shield += 15
        }
      }
    }

    if (this.hasSkill(side, 'skill82') && fromShieldItem && gainedShield > 0) {
      this.applyDirectSkillDamage(side, gainedShield, 'skill82')
    }
  }

  applySkill33RegenTick(): void {
    const applyOne = (side: 'player' | 'enemy', perTick: number): void => {
      if (!this.hasSkill(side, 'skill33')) return
      if (perTick <= 0) return
      const hero = this.heroOf(side)
      if (hero.hp <= 0) return
      const healed = Math.max(0, Math.min(hero.maxHp - hero.hp, perTick))
      if (healed <= 0) return
      hero.hp += healed
      EventBus.emit('battle:heal', {
        targetId: hero.id,
        sourceItemId: 'skill33',
        amount: healed,
        isRegen: true,
        targetType: 'hero',
        targetSide: hero.side,
        sourceType: 'system',
        sourceSide: side,
      })
    }
    applyOne('player', this.state.skill33RegenPerTick)
    applyOne('enemy', this.state.skillEnemy33RegenPerTick)
  }

  applyOnDealDamageSkillTriggers(attacker: CombatItemRunner): void {
    if (this.hasSkill(attacker.side, 'skill58') && isDamageBonusEligible(attacker)) {
      attacker.baseStats.damage += 2
    }
    if (this.hasSkill(attacker.side, 'skill57')) {
      attacker.baseStats.cooldownMs = Math.max(
        this.minReducedCdMsFor(attacker),
        Math.round(attacker.baseStats.cooldownMs * 0.98),
      )
    }
  }

  applyWanJianGrowthOnAnyDamage(sourceSide: 'player' | 'enemy'): void {
    for (const owner of this.state.items) {
      if (owner.side !== sourceSide) continue
      if (!isDamageBonusEligible(owner)) continue
      const def = findItemDef(owner.defId)
      const line = skillLines(def).find((s) => /造成任意伤害(?:时)?此物品伤害\+\d+(?:[\/|]\d+)*/.test(s))
      if (!line) continue
      const v = Math.max(0, Math.round(tierValueFromLine(line, tierIndexFromRaw(def, owner.tier))))
      if (v > 0) owner.baseStats.damage += v
    }
  }

  tryDeathMarkExecution(sourceSide: 'player' | 'enemy', targetHero: HeroState): void {
    if (this.state.deathMarkCheckUsedBySide[sourceSide]) return
    const marker = this.state.items.find((it) => {
      if (it.side !== sourceSide) return false
      const def = findItemDef(it.defId)
      return skillLines(def).some((s) => /生命值低于.*直接斩杀/.test(s))
    })
    if (!marker) return
    const def = findItemDef(marker.defId)
    const line = skillLines(def).find((s) => /生命值低于.*直接斩杀/.test(s))
    if (!line) return
    const pct = Math.max(0, tierValueFromLine(line, tierIndexFromRaw(def, marker.tier)))
    if (pct <= 0) return
    if (targetHero.maxHp <= 0 || targetHero.hp <= 0) return
    if (targetHero.hp / targetHero.maxHp > pct / 100) return
    this.state.deathMarkCheckUsedBySide[sourceSide] = true
    this.engine.enqueueExtraTriggeredUse(marker)
  }

  applyBattleStartPassiveGrowths(): void {
    for (const owner of this.state.items) {
      const def = findItemDef(owner.defId)
      if (!def) continue
      const lines = skillLines(def)
      const tIdx = tierIndexFromRaw(def, owner.tier)

      const shieldLine = lines.find((s) => /护盾物品护盾值\+\d+(?:\/\d+)*/.test(s))
      if (shieldLine) {
        const v = Math.round(tierValueFromLine(shieldLine, tIdx))
        if (v > 0) {
          for (const ally of this.state.items) {
            if (ally.side !== owner.side) continue
            if (ally.baseStats.shield <= 0) continue
            ally.baseStats.shield += v
          }
        }
      }

      const burnLine = lines.find((s) => /灼烧物品\+\d+(?:\/\d+)*灼烧/.test(s))
      if (burnLine) {
        const v = Math.round(tierValueFromLine(burnLine, tIdx))
        if (v > 0) {
          for (const ally of this.state.items) {
            if (ally.side !== owner.side) continue
            if (ally.baseStats.burn <= 0) continue
            ally.baseStats.burn += v
          }
        }
      }

      const adjacentPoisonLine = lines.find((s) => /相邻剧毒物品\+\d+(?:\/\d+)*剧毒/.test(s))
      if (adjacentPoisonLine) {
        const v = Math.round(tierValueFromLine(adjacentPoisonLine, tIdx))
        if (v > 0) {
          for (const ally of this.state.items) {
            if (ally.side !== owner.side || ally.id === owner.id) continue
            if (ally.baseStats.poison <= 0) continue
            if (!isAdjacentByFootprint(ally, owner)) continue
            ally.baseStats.poison += v
          }
        }
      }

      const adjacentWeaponDamageLine = lines.find((s) => /相邻的?武器伤害\+\d+(?:\/\d+)*/.test(s))
      if (adjacentWeaponDamageLine) {
        const v = Math.round(tierValueFromLine(adjacentWeaponDamageLine, tIdx))
        if (v > 0) {
          for (const ally of this.state.items) {
            if (ally.side !== owner.side || ally.id === owner.id) continue
            if (!isDamageBonusEligible(ally)) continue
            if (!isAdjacentByFootprint(ally, owner)) continue
            ally.baseStats.damage += v
          }
        }
      }

      const allWeaponDamageLine = lines.find(
        (s) => /(?:武器|物品)伤害\+\d+(?:[\/|]\d+)*/.test(s)
          && !/相邻/.test(s)
          && !/所有刺客物品/.test(s)
          && !/其他武器攻击时该(?:武器|物品)伤害\+/.test(s),
      )
      if (allWeaponDamageLine) {
        const v = Math.round(tierValueFromLine(allWeaponDamageLine, tIdx))
        if (v > 0) {
          for (const ally of this.state.items) {
            if (ally.side !== owner.side) continue
            if (!isDamageBonusEligible(ally)) continue
            ally.baseStats.damage += v
          }
        }
      }

      const allAssassinDamageLine = lines.find((s) => /所有刺客物品伤害\+\d+(?:[\/|]\d+)*/.test(s))
      if (allAssassinDamageLine) {
        const v = Math.round(tierValueFromLine(allAssassinDamageLine, tIdx))
        if (v > 0) {
          for (const ally of this.state.items) {
            if (ally.side !== owner.side) continue
            if (!isDamageBonusEligible(ally)) continue
            const allyDef = findItemDef(ally.defId)
            if (itemArchetype(allyDef) !== '刺客') continue
            ally.baseStats.damage += v
          }
        }
      }

      const scoutLine = lines.find((s) => /上阵区每有1件其他刺客物品[，,]?连发次数\+1/.test(s))
      if (scoutLine) {
        const n = this.state.items.filter((ally) => {
          if (ally.side !== owner.side || ally.id === owner.id) return false
          const allyDef = findItemDef(ally.defId)
          return itemArchetype(allyDef) === '刺客'
        }).length
        if (n > 0) owner.baseStats.multicast += n
      }

      const adjacentAmmoCapLine = lines.find((s) => /相邻物品\+\d+(?:[\/|]\+?\d+)*最大弹药量/.test(s))
      if (adjacentAmmoCapLine) {
        const v = Math.round(tierValueFromLine(adjacentAmmoCapLine, tIdx))
        if (v > 0) {
          for (const ally of this.state.items) {
            if (ally.side !== owner.side || ally.id === owner.id) continue
            if (!isAdjacentByFootprint(ally, owner)) continue
            if (ally.runtime.ammoMax <= 0) continue
            const beforeCurrent = ally.runtime.ammoCurrent
            const beforeMax = ally.runtime.ammoMax
            ally.runtime.ammoMax += v
            if (beforeCurrent < beforeMax) {
              ally.runtime.ammoCurrent = Math.min(ally.runtime.ammoMax, beforeCurrent + v)
              const gained = Math.max(0, ally.runtime.ammoCurrent - beforeCurrent)
              if (gained > 0) this.applyOnAmmoRefilledDamageGrowth(ally, gained)
            }
          }
        }
      }

      const adjacentAmmoCapLine2 = lines.find((s) => /相邻弹药物品最大弹药量\+\d+(?:[\/|]\d+)*/.test(s))
      if (adjacentAmmoCapLine2) {
        const v = Math.round(tierValueFromLine(adjacentAmmoCapLine2, tIdx))
        if (v > 0) {
          for (const ally of this.state.items) {
            if (ally.side !== owner.side || ally.id === owner.id) continue
            if (!isAdjacentByFootprint(ally, owner)) continue
            if (ally.runtime.ammoMax <= 0) continue
            ally.runtime.ammoMax += v
            ally.runtime.ammoCurrent = Math.min(ally.runtime.ammoMax, ally.runtime.ammoCurrent + v)
          }
        }
      }

      const scopeLine = lines.find((s) => /相邻伤害物品伤害\+\d+(?:[\/|]\d+)*%/.test(s))
      if (scopeLine) {
        const pct = Math.max(0, tierValueFromLine(scopeLine, tIdx)) / 100
        if (pct > 0) {
          for (const ally of this.state.items) {
            if (ally.side !== owner.side || ally.id === owner.id) continue
            if (!isAdjacentByFootprint(ally, owner)) continue
            if (!isDamageBonusEligible(ally)) continue
            ally.runtime.damageScale *= (1 + pct)
          }
        }
      }

      const phantomLine = lines.find((s) => /弹药物品伤害\+\d+(?:[\/|]\d+)*/.test(s) && /弹药消耗翻倍/.test(s))
      if (phantomLine) {
        const v = Math.round(tierValueFromLine(phantomLine, tIdx))
        if (v > 0) {
          for (const ally of this.state.items) {
            if (ally.side !== owner.side) continue
            if (!isAmmoItem(ally)) continue
            if (!isDamageBonusEligible(ally)) continue
            ally.baseStats.damage += v
          }
        }
      }

      const hpBoostLine = lines.find((s) => /最大生命值\+\d+(?:[\/|]\d+)*%/.test(s))
      if (hpBoostLine) {
        const pct = Math.max(0, tierValueFromLine(hpBoostLine, tIdx)) / 100
        if (pct > 0) {
          const hero = this.heroOf(owner.side)
          hero.maxHp = Math.max(1, Math.round(hero.maxHp * (1 + pct)))
          hero.hp = Math.max(1, Math.round(hero.hp * (1 + pct)))
        }
      }

      const rightMulticastLine = lines.find((s) => /右侧的(?:攻击|伤害)物品连发次数\+\d+(?:[\/|]\d+)*/.test(s))
      if (rightMulticastLine) {
        const v = Math.max(0, Math.round(tierValueFromLine(rightMulticastLine, tIdx)))
        if (v > 0) {
          const ownerRightEdge = owner.col + itemWidth(owner.size) - 1
          const rightTarget = this.state.items
            .filter((ally) => ally.side === owner.side && ally.id !== owner.id)
            .find((ally) => ally.col === ownerRightEdge + 1 && isDamageBonusEligible(ally))
          if (rightTarget) rightTarget.baseStats.multicast += v
        }
      }
    }
  }

  applyReviveIfPossible(side: 'player' | 'enemy'): boolean {
    const hero = side === 'player' ? this.state.playerHero : this.state.enemyHero
    if (hero.hp > 0) return false
    if (this.hasSkill(side, 'skill47') && !this.state.skill47ReviveTriggeredBySide[side]) {
      this.state.skill47ReviveTriggeredBySide[side] = true
      hero.hp = Math.max(1, Math.round(hero.maxHp * 0.5))
      EventBus.emit('battle:heal', {
        targetId: hero.id,
        sourceItemId: 'skill47',
        amount: hero.hp,
        isRegen: false,
        targetType: 'hero',
        targetSide: hero.side,
        sourceType: 'system',
        sourceSide: side,
      })
      return true
    }
    const candidates = this.state.items.filter((it) => it.side === side && !it.reviveUsed)
    for (const item of candidates) {
      const def = findItemDef(item.defId)
      if (!def) continue
      const line = skillLines(def).find((s) => /首次被击败时复活并恢复\d+(?:\/\d+)*生命值/.test(s))
      if (!line) continue
      const heal = Math.round(tierValueFromLine(line, tierIndexFromRaw(def, item.tier)))
      if (heal <= 0) continue
      item.reviveUsed = true
      hero.hp = Math.min(hero.maxHp, heal)
      EventBus.emit('battle:heal', {
        targetId: hero.id,
        sourceItemId: item.id,
        amount: hero.hp,
        isRegen: false,
        targetType: 'hero',
        targetSide: hero.side,
        sourceType: 'item',
        sourceSide: side,
      })
      return true
    }
    return false
  }

  applyOnHeroDamagedReactions(side: 'player' | 'enemy'): void {
    const hero = side === 'player' ? this.state.playerHero : this.state.enemyHero
    if (hero.hp <= 0) return
    for (const item of this.state.items) {
      if (item.side !== side) continue
      const def = findItemDef(item.defId)
      if (!def) continue
      const lines = skillLines(def)
      const tIdx = tierIndexFromRaw(def, item.tier)

      const gainShieldLine = lines.find((s) => /受到攻击伤害时获得\d+(?:\/\d+)*护盾/.test(s))
      if (gainShieldLine) {
        const rawAmount = Math.round(tierValueFromLine(gainShieldLine, tIdx))
        const amount = this.scaleShieldGain(side, rawAmount)
        if (amount > 0) {
          hero.shield += amount
          EventBus.emit('battle:gain_shield', {
            targetId: hero.id,
            sourceItemId: item.id,
            amount,
            targetType: 'hero',
            targetSide: hero.side,
            sourceType: 'item',
            sourceSide: item.side,
          })
          this.applyOnShieldGainCharge(side)
          this.applyShieldGainSkillTriggers(side, item.id, amount, false)
        }
      }

      const selfChargeLine = lines.find((s) => /受到攻击时为此物品充能\d+(?:[\/|]\d+)*秒/.test(s))
      if (selfChargeLine) {
        const gainMs = Math.max(0, Math.round(tierValueFromLine(selfChargeLine, tIdx) * 1000))
        if (gainMs > 0) this.engine.chargeItemByMs(item, gainMs)
      }

      if (lines.some((s) => /受到攻击时(?:额外|立即)使用此物品/.test(s))) {
        this.engine.enqueueExtraTriggeredUse(item)
      }
    }
  }
}
