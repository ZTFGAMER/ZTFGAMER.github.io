// ============================================================
// ItemTriggerSystem — 物品触发系统（class 模式，持有 CombatState 引用）
// 处理物品相邻触发、武器攻击触发、冻结/减速/加速等控制效果
// ============================================================

import { EventBus } from '@/core/EventBus'
import { getConfig } from '@/core/DataLoader'
import type { CombatState, CombatItemRunner } from './CombatTypes'
import type { ICombatEngineBase } from './SkillTriggerSystem'
import type { ControlSpec } from './CombatTypes'
import {
  findItemDef, skillLines, tierIndexFromRaw, tierValueFromLine,
  parseControlSpecsFromDef, isAdjacentByFootprint, itemWidth, isDamageBonusEligible,
  seedFrom, shuffleDeterministic,
} from './CombatHelpers'

// IItemTriggerEngineBase 复用 ICombatEngineBase，新增 enqueueOneAttackFrom
export interface IItemTriggerEngineBase extends ICombatEngineBase {
  enqueueOneAttackFrom(source: CombatItemRunner): void
}

export class ItemTriggerSystem {
  constructor(
    private state: CombatState,
    private engine: IItemTriggerEngineBase,
  ) {}

  // ── 私有辅助 ──────────────────────────────────────────────

  applyHasteToTargetItems(source: CombatItemRunner, targets: CombatItemRunner[], durationMs: number): void {
    for (const target of targets) {
      target.runtime.modifiers.hasteMs = Math.max(target.runtime.modifiers.hasteMs, durationMs)
      EventBus.emit('battle:status_apply', {
        targetId: target.id,
        sourceItemId: source.id,
        status: 'haste',
        amount: durationMs,
        targetType: 'item',
        targetSide: target.side,
        sourceType: 'item',
        sourceSide: source.side,
      })
    }
  }

  pickControlTargets(params: {
    side: 'player' | 'enemy'
    count: number
    mode: ControlSpec['targetMode']
    source: CombatItemRunner
    excludeId?: string
  }): CombatItemRunner[] {
    const { side, count, mode, source, excludeId } = params
    const base = this.state.items
      .filter((it) => it.side === side && it.id !== excludeId)
      .sort((a, b) => (a.col - b.col) || a.id.localeCompare(b.id))
    if (base.length === 0) return []
    const limitedCount = Math.max(0, Math.min(count, base.length))
    if (limitedCount === 0) return []
    if (mode === 'adjacent') {
      const adjacent = base.filter((it) => isAdjacentByFootprint(it, source))
      if (adjacent.length <= limitedCount) return adjacent
      return adjacent.slice(0, limitedCount)
    }
    if (mode === 'left') {
      const sourceLeft = source.col
      const left = base
        .filter((it) => it.col + itemWidth(it.size) - 1 === sourceLeft - 1)
        .sort((a, b) => a.id.localeCompare(b.id))
      return left.slice(0, limitedCount)
    }
    if (mode === 'fastest') {
      const ordered = [...base].sort((a, b) => {
        const ar = Math.max(0, a.baseStats.cooldownMs - a.runtime.currentChargeMs)
        const br = Math.max(0, b.baseStats.cooldownMs - b.runtime.currentChargeMs)
        return ar - br || a.id.localeCompare(b.id)
      })
      return ordered.slice(0, limitedCount)
    }
    if (mode === 'random') {
      const seed = seedFrom(source.id, this.state.tickIndex)
      const shuffled = shuffleDeterministic(base, seed)
      return shuffled.slice(0, limitedCount)
    }
    if (limitedCount >= base.length) return base
    return base.slice(0, limitedCount)
  }

  applyCardEffects(source: CombatItemRunner, def: import('@/common/items/ItemDef').ItemDef | null): { freeze: number; slow: number; haste: number } {
    if (!def) return { freeze: 0, slow: 0, haste: 0 }
    const out = { freeze: 0, slow: 0, haste: 0 }
    const specs = parseControlSpecsFromDef(def, getConfig().combatRuntime)
    for (const spec of specs) {
      const side: 'player' | 'enemy' =
        spec.targetSide === 'ally'
          ? source.side
          : (source.side === 'player' ? 'enemy' : 'player')
      const targets = this.pickControlTargets({
        side,
        count: spec.targetAll ? 999 : spec.count,
        mode: spec.targetMode,
        source,
        excludeId: spec.targetSide === 'ally' ? source.id : undefined,
      })
      for (const target of targets) {
        if (spec.status === 'freeze') target.runtime.modifiers.freezeMs = Math.max(target.runtime.modifiers.freezeMs, spec.durationMs)
        if (spec.status === 'slow') target.runtime.modifiers.slowMs = Math.max(target.runtime.modifiers.slowMs, spec.durationMs)
        if (spec.status === 'haste') target.runtime.modifiers.hasteMs = Math.max(target.runtime.modifiers.hasteMs, spec.durationMs)
        if (spec.status === 'freeze') out.freeze += 1
        if (spec.status === 'slow') out.slow += 1
        if (spec.status === 'haste') out.haste += 1
        EventBus.emit('battle:status_apply', {
          targetId: target.id,
          sourceItemId: source.id,
          status: spec.status,
          amount: spec.durationMs,
          targetType: 'item',
          targetSide: target.side,
          sourceType: 'item',
          sourceSide: source.side,
        })
      }
    }
    return out
  }


  // ── 物品触发方法（public）────────────────────────────────────

  applyAdjacentUseHasteTriggers(fired: CombatItemRunner): void {
    for (const owner of this.state.items) {
      if (owner.side !== fired.side || owner.id === fired.id) continue
      if (!isAdjacentByFootprint(owner, fired)) continue
      const def = findItemDef(owner.defId)
      if (!def) continue
      const line = skillLines(def).find((s) => /相邻物品使用时.*加速另一侧的物品/.test(s))
      if (!line) continue
      const sec = tierValueFromLine(line, tierIndexFromRaw(def, owner.tier))
      if (sec <= 0) continue

      const ownerStart = owner.col
      const ownerEnd = owner.col + itemWidth(owner.size) - 1
      const firedCenter = fired.col + itemWidth(fired.size) / 2
      const ownerCenter = owner.col + itemWidth(owner.size) / 2
      const wantRight = firedCenter < ownerCenter

      const target = this.state.items
        .filter((it) => it.side === owner.side && it.id !== owner.id && it.id !== fired.id)
        .find((it) => {
          const s = it.col
          const e = it.col + itemWidth(it.size) - 1
          return wantRight ? s === ownerEnd + 1 : e === ownerStart - 1
        })
      if (target) this.applyHasteToTargetItems(owner, [target], Math.round(sec * 1000))
    }
  }

  applyAdjacentUseBurnTriggers(fired: CombatItemRunner): void {
    const targetHero = fired.side === 'player' ? this.state.enemyHero : this.state.playerHero
    if (targetHero.hp <= 0) return
    for (const owner of this.state.items) {
      if (owner.side !== fired.side || owner.id === fired.id) continue
      if (!isAdjacentByFootprint(owner, fired)) continue
      const def = findItemDef(owner.defId)
      if (!def) continue
      const line = skillLines(def).find((s) => /使用相邻物品时.*造成\d+(?:\/\d+)*灼烧/.test(s))
      if (!line) continue
      const burn = Math.round(tierValueFromLine(line, tierIndexFromRaw(def, owner.tier)))
      if (burn <= 0) continue
      targetHero.burn += burn
      EventBus.emit('battle:status_apply', {
        targetId: targetHero.id,
        sourceItemId: owner.id,
        status: 'burn',
        amount: burn,
        targetType: 'hero',
        targetSide: targetHero.side,
        sourceType: 'item',
        sourceSide: owner.side,
      })
    }
  }

  applyAdjacentUseExtraFireTriggers(fired: CombatItemRunner): void {
    for (const owner of this.state.items) {
      if (owner.side !== fired.side || owner.id === fired.id) continue
      if (!isAdjacentByFootprint(owner, fired)) continue
      const def = findItemDef(owner.defId)
      if (!def) continue
      if (!skillLines(def).some((s) => /使用相邻物品时(?:额外|立即)使用此物品/.test(s))) continue
      this.engine.enqueueExtraTriggeredUse(owner)
    }
  }

  applyBurnUseSlowTriggers(fired: CombatItemRunner): void {
    if (fired.baseStats.burn <= 0) return
    for (const owner of this.state.items) {
      if (owner.side !== fired.side || owner.id === fired.id) continue
      const def = findItemDef(owner.defId)
      if (!def) continue
      const line = skillLines(def).find((s) => /使用灼烧物品时.*减速敌方\d+件敌方物品\d+(?:\/\d+)*秒/.test(s))
      if (!line) continue
      const sec = tierValueFromLine(line, tierIndexFromRaw(def, owner.tier))
      if (sec <= 0) continue
      const targets = this.pickControlTargets({
        side: fired.side === 'player' ? 'enemy' : 'player',
        count: 1,
        mode: 'leftmost',
        source: owner,
      })
      for (const target of targets) {
        const durationMs = Math.max(1, Math.round(sec * 1000))
        target.runtime.modifiers.slowMs = Math.max(target.runtime.modifiers.slowMs, durationMs)
        EventBus.emit('battle:status_apply', {
          targetId: target.id,
          sourceItemId: owner.id,
          status: 'slow',
          amount: durationMs,
          targetType: 'item',
          targetSide: target.side,
          sourceType: 'item',
          sourceSide: owner.side,
        })
      }
    }
  }

  applyOnWeaponAttackTriggers(attacker: CombatItemRunner): void {
    if (attacker.baseStats.damage <= 0) return
    for (const owner of this.state.items) {
      if (owner.side !== attacker.side || owner.id === attacker.id) continue
      const def = findItemDef(owner.defId)
      if (!def) continue
      const lines = skillLines(def)
      const tIdx = tierIndexFromRaw(def, owner.tier)

      const allWeaponBuffLine = lines.find((s) => /相邻的?武器攻击时.*所有武器伤害\+\d+(?:\/\d+)*/.test(s))
      if (allWeaponBuffLine && isAdjacentByFootprint(owner, attacker)) {
        const v = Math.round(tierValueFromLine(allWeaponBuffLine, tIdx))
        if (v > 0) {
          for (const ally of this.state.items) {
            if (ally.side !== owner.side || !isDamageBonusEligible(ally)) continue
            ally.baseStats.damage += v
          }
        }
      }

      const selfGrowLine = lines.find((s) => /其他武器攻击时该武器伤害\+\d+(?:\/\d+)*/.test(s))
      if (selfGrowLine) {
        const v = Math.round(tierValueFromLine(selfGrowLine, tIdx))
        if (v > 0 && isDamageBonusEligible(owner)) owner.runtime.tempDamageBonus += v
      }

      const extraFireLine = lines.find((s) => /相邻武器攻击时额外触发此武器攻击/.test(s))
      if (extraFireLine && isAdjacentByFootprint(owner, attacker)) {
        this.engine.enqueueOneAttackFrom(owner)
      }

      const ammoTriggerLine = lines.find((s) => /使用(?:其他)?弹药物品时.*(?:攻击|连发)次数(?:\+[\d|/]+|增加)/.test(s))
      if (ammoTriggerLine && attacker.runtime.ammoMax > 0) {
        const parsed = Math.round(tierValueFromLine(ammoTriggerLine, tIdx))
        const v = Math.max(1, Math.abs(parsed || 1))
        owner.runtime.bonusMulticast += v
      }
    }
  }

  applyFreezeTriggeredAdjacentAttackBuff(source: CombatItemRunner): void {
    const def = findItemDef(source.defId)
    if (!def) return
    const line = skillLines(def).find((s) => /冻结敌方时.*相邻攻击物品\+\d+(?:\/\d+)*伤害/.test(s))
    if (!line) return
    const v = Math.round(tierValueFromLine(line, tierIndexFromRaw(def, source.tier)))
    if (v <= 0) return
    for (const ally of this.state.items) {
      if (ally.side !== source.side || ally.id === source.id) continue
      if (!isDamageBonusEligible(ally)) continue
      if (!isAdjacentByFootprint(ally, source)) continue
      ally.runtime.tempDamageBonus += v
    }
  }

  applyAdjacentAttackDamageGrowth(attacker: CombatItemRunner): void {
    for (const owner of this.state.items) {
      if (owner.side !== attacker.side || owner.id === attacker.id) continue
      if (!isAdjacentByFootprint(owner, attacker)) continue
      const def = findItemDef(owner.defId)
      if (!def) continue
      const line = skillLines(def).find((s) => /相邻物品攻击造成伤害时.*该物品\+\d+(?:\/\d+)*伤害/.test(s))
      if (!line) continue
      const v = Math.round(tierValueFromLine(line, tierIndexFromRaw(def, owner.tier)))
      if (v > 0 && isDamageBonusEligible(owner)) owner.runtime.tempDamageBonus += v
    }
  }
}
