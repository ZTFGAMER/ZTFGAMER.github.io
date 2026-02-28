import { EventBus } from '@/core/EventBus'
import type { BattleSnapshotBundle, BattleSnapshotEntity } from '@/combat/BattleSnapshotStore'
import { getAllItems, getConfig } from '@/core/DataLoader'
import type { ItemDef, ItemSizeNorm } from '@/items/ItemDef'
import { normalizeSize } from '@/items/ItemDef'

export type CombatPhase = 'IDLE' | 'INIT' | 'SETUP' | 'TICK' | 'RESOLVE' | 'END'

export interface CombatResult {
  winner: 'player' | 'enemy' | 'draw'
  ticks: number
}

interface HeroState {
  id: string
  side: 'player' | 'enemy'
  maxHp: number
  hp: number
  shield: number
  burn: number
  poison: number
  regen: number
}

interface CombatItemRunner {
  id: string
  side: 'player' | 'enemy'
  defId: string
  cooldownMs: number
  chargeMs: number
  damage: number
  heal: number
  shield: number
  burn: number
  poison: number
  regen: number
  crit: number
  multicast: number
  col: number
  row: number
  size: ItemSizeNorm
  tier: string
  freezeMs: number
  slowMs: number
  hasteMs: number
}

interface PendingHit {
  dueTick: number
  side: 'player' | 'enemy'
  sourceItemId: string
  defId: string
  damage: number
  crit: number
}

interface CombatStartOptions {
  enemyDisabled?: boolean
}

type ControlStatus = 'freeze' | 'slow' | 'haste'

interface ControlSpec {
  status: ControlStatus
  durationMs: number
  count: number
  targetSide: 'ally' | 'enemy'
  targetAll: boolean
}

export interface CombatBoardItem {
  id: string
  side: 'player' | 'enemy'
  defId: string
  col: number
  row: number
  size: ItemSizeNorm
  tier: string
  chargeRatio: number
}

const FALLBACK_CD_MS = 3000

type CombatRuntimeOverride = {
  burnTickMs?: number
  poisonTickMs?: number
  regenTickMs?: number
  burnShieldFactor?: number
  burnDecayPct?: number
  healCleansePct?: number
}

let runtimeOverride: CombatRuntimeOverride = {}

export function setCombatRuntimeOverride(next: CombatRuntimeOverride): void {
  runtimeOverride = { ...next }
}

function rv<K extends keyof CombatRuntimeOverride>(key: K, fallback: number): number {
  const v = runtimeOverride[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function parseControlSpecsFromDef(def: ItemDef, cr: ReturnType<typeof getConfig>['combatRuntime']): ControlSpec[] {
  const lines = [
    ...def.skills.map((s) => s.cn),
    ...def.skills.map((s) => s.en),
    def.hidden_tags,
    def.tags,
  ].join('\n')

  const collect = (status: ControlStatus): ControlSpec[] => {
    const keyword = status === 'freeze' ? /冻结|freeze/i : status === 'slow' ? /减速|slow/i : /加速|haste/i
    if (!keyword.test(lines)) return []

    const statusLines = lines.split(/\n+/).filter((line) => keyword.test(line))
    if (statusLines.length === 0) return []

    return statusLines.map((line) => {
      const all = /所有|all/i.test(line)
      const countMatch = line.match(/(\d+)\s*(?:件|个)/) ?? line.match(/(\d+)\s*(items?)/i)
      const secondMatch = line.match(/(\d+(?:\.\d+)?)\s*秒/) ?? line.match(/(\d+(?:\.\d+)?)\s*s(ec)?/i)
      const count = all ? 999 : Math.max(1, Number(countMatch?.[1] ?? 1))
      const sec = Math.max(0.1, Number(secondMatch?.[1] ?? (status === 'freeze' ? 1 : 1.5)))
      const targetSide: 'ally' | 'enemy' = /己方|我方|ally|friendly/i.test(line)
        ? 'ally'
        : status === 'haste'
          ? 'ally'
          : 'enemy'
      const defaultMs = status === 'freeze'
        ? (cr.cardFreezeMs ?? 1000)
        : status === 'slow'
          ? (cr.cardSlowMs ?? 1500)
          : (cr.cardHasteMs ?? 1500)
      const durationMs = Math.max(1, Math.round(sec * 1000)) || defaultMs
      return {
        status,
        durationMs,
        count,
        targetSide,
        targetAll: all,
      }
    })
  }

  return [
    ...collect('freeze'),
    ...collect('slow'),
    ...collect('haste'),
  ]
}

export class CombatEngine {
  private phase: CombatPhase = 'IDLE'
  private day = 1
  private elapsedMs = 0
  private tickAccumulatorMs = 0
  private fatigueAccumulatorMs = 0
  private tickIndex = 0
  private inFatigue = false
  private finished = false
  private result: CombatResult | null = null

  private playerHero: HeroState = { id: 'hero_player', side: 'player', maxHp: 1, hp: 1, shield: 0, burn: 0, poison: 0, regen: 0 }
  private enemyHero: HeroState = { id: 'hero_enemy', side: 'enemy', maxHp: 1, hp: 1, shield: 0, burn: 0, poison: 0, regen: 0 }
  private items: CombatItemRunner[] = []
  private pendingHits: PendingHit[] = []

  start(snapshot: BattleSnapshotBundle, options?: CombatStartOptions): void {
    this.reset()
    const cfg = getConfig()
    this.day = snapshot.day
    const hpRow = cfg.dailyHealth
    const enemyHp = hpRow[Math.max(0, Math.min(hpRow.length - 1, snapshot.day - 1))] ?? hpRow[0] ?? 300
    const playerHp = enemyHp

    this.playerHero = { id: 'hero_player', side: 'player', maxHp: playerHp, hp: playerHp, shield: 0, burn: 0, poison: 0, regen: 0 }
    this.enemyHero = { id: 'hero_enemy', side: 'enemy', maxHp: enemyHp, hp: enemyHp, shield: 0, burn: 0, poison: 0, regen: 0 }

    this.items = [
      ...snapshot.entities.map((it, idx) => this.toRunner(it, `P-${idx}`)),
      ...(options?.enemyDisabled ? [] : this.makeEnemyRunners(snapshot)),
    ]

    this.phase = 'INIT'
  }

  update(dt: number): void {
    if (this.phase === 'IDLE' || this.phase === 'END') return
    const cfg = getConfig().combatRuntime
    const deltaMs = dt * 1000
    this.elapsedMs += deltaMs

    if (this.phase === 'INIT') {
      this.phase = 'SETUP'
      return
    }
    if (this.phase === 'SETUP') {
      this.phase = 'TICK'
      return
    }

    if (this.phase === 'TICK') {
      if (!this.inFatigue && this.elapsedMs >= cfg.timeoutMs) this.inFatigue = true

      if (this.shouldResolve()) {
        this.phase = 'RESOLVE'
      }
      if (this.phase === 'RESOLVE') {
        this.finishCombat()
        return
      }

      if (this.inFatigue) {
        this.fatigueAccumulatorMs += deltaMs
        while (this.fatigueAccumulatorMs >= cfg.fatigueTickMs) {
          this.fatigueAccumulatorMs -= cfg.fatigueTickMs
          this.stepFatigue()
          if (this.shouldResolve()) {
            this.phase = 'RESOLVE'
            break
          }
        }
      } else {
        this.tickAccumulatorMs += deltaMs
        while (this.tickAccumulatorMs >= cfg.tickMs) {
          this.tickAccumulatorMs -= cfg.tickMs
          this.stepOneTick(cfg.tickMs)
          if (this.shouldResolve()) {
            this.phase = 'RESOLVE'
            break
          }
        }
      }
    }

    if (this.phase === 'RESOLVE') this.finishCombat()
  }

  getPhase(): CombatPhase {
    return this.phase
  }

  isFinished(): boolean {
    return this.finished
  }

  getResult(): CombatResult | null {
    return this.result ? { ...this.result } : null
  }

  getDebugState(): { tickIndex: number; playerAlive: number; enemyAlive: number; playerHp: number; enemyHp: number; inFatigue: boolean } {
    return {
      tickIndex: this.tickIndex,
      playerAlive: this.playerHero.hp > 0 ? 1 : 0,
      enemyAlive: this.enemyHero.hp > 0 ? 1 : 0,
      playerHp: this.playerHero.hp,
      enemyHp: this.enemyHero.hp,
      inFatigue: this.inFatigue,
    }
  }

  getBoardState(): { player: HeroState; enemy: HeroState; items: CombatBoardItem[] } {
    return {
      player: { ...this.playerHero },
      enemy: { ...this.enemyHero },
      items: this.items.map((it) => ({
        id: it.id,
        side: it.side,
        defId: it.defId,
        col: it.col,
        row: it.row,
        size: it.size,
        tier: it.tier,
        chargeRatio: Math.max(0, Math.min(1, it.chargeMs / it.cooldownMs)),
      })),
    }
  }

  private reset(): void {
    this.phase = 'IDLE'
    this.elapsedMs = 0
    this.tickAccumulatorMs = 0
    this.fatigueAccumulatorMs = 0
    this.tickIndex = 0
    this.inFatigue = false
    this.finished = false
    this.result = null
    this.items = []
    this.pendingHits = []
  }

  private toRunner(entity: BattleSnapshotEntity, idPrefix: string): CombatItemRunner {
    const def = this.findItemDef(entity.defId)
    return {
      id: `${idPrefix}-${entity.instanceId}`,
      side: 'player',
      defId: entity.defId,
      cooldownMs: this.validCooldown(def?.cooldown ?? 0),
      chargeMs: 0,
      damage: Math.max(0, def?.damage ?? 0),
      heal: Math.max(0, def?.heal ?? 0),
      shield: Math.max(0, def?.shield ?? 0),
      burn: Math.max(0, def?.burn ?? 0),
      poison: Math.max(0, def?.poison ?? 0),
      regen: Math.max(0, def?.regen ?? 0),
      crit: Math.max(0, def?.crit ?? 0),
      multicast: Math.max(1, Math.round(def?.multicast ?? 1)),
      col: entity.col,
      row: entity.row,
      size: entity.size,
      tier: entity.tier,
      freezeMs: 0,
      slowMs: 0,
      hasteMs: 0,
    }
  }

  private makeEnemyRunners(snapshot: BattleSnapshotBundle): CombatItemRunner[] {
    const all = getAllItems()
    if (!all.length) return []
    const configuredDefs = this.pickEnemyDefsByDay(all)
    const seedDefs = configuredDefs.length > 0 ? configuredDefs : all
    const occ: boolean[][] = Array.from({ length: 1 }, () => Array.from({ length: 6 }, () => false))
    const out: CombatItemRunner[] = []
    const targetWidth = Math.max(1, Math.min(
      snapshot.activeColCount,
      this.day <= 2 ? 3 : this.day <= 4 ? 4 : 5,
    ))

    const sizeWidth = (size: ItemSizeNorm): number => {
      if (size === '1x1') return 1
      if (size === '2x1') return 2
      return 3
    }

    const canPlace = (col: number, row: number, size: ItemSizeNorm): boolean => {
      if (size === '1x1') return col >= 0 && col < snapshot.activeColCount && row === 0 && !occ[0]![col]
      if (size === '2x1') return col >= 0 && col + 1 < snapshot.activeColCount && !occ[0]![col] && !occ[0]![col + 1]
      return col >= 0 && col + 2 < snapshot.activeColCount
        && !occ[0]![col] && !occ[0]![col + 1] && !occ[0]![col + 2]
    }

    const markPlace = (col: number, _row: number, size: ItemSizeNorm): void => {
      if (size === '1x1') { occ[0]![col] = true; return }
      if (size === '2x1') { occ[0]![col] = true; occ[0]![col + 1] = true; return }
      occ[0]![col] = true; occ[0]![col + 1] = true; occ[0]![col + 2] = true
    }

    const findSlot = (size: ItemSizeNorm): { col: number; row: number } | null => {
      if (size === '1x1') {
        for (let c = 0; c < snapshot.activeColCount; c++) {
          if (canPlace(c, 0, size)) return { col: c, row: 0 }
        }
        return null
      }
      for (let c = 0; c < snapshot.activeColCount; c++) {
        if (canPlace(c, 0, size)) return { col: c, row: 0 }
      }
      return null
    }

    let usedWidth = 0
    let i = 0
    const maxRoll = Math.max(seedDefs.length * 6, 24)
    while (usedWidth < targetWidth && i < maxRoll) {
      const idx = (this.day * 7 + i * 11) % seedDefs.length
      i++
      const def = seedDefs[idx]!
      const size = normalizeSize(def.size)
      const w = sizeWidth(size)
      if (usedWidth + w > targetWidth) continue
      const slot = findSlot(size)
      if (!slot) continue
      markPlace(slot.col, slot.row, size)
      usedWidth += w
      out.push({
        id: `E-${i}-${def.id}`,
        side: 'enemy',
        defId: def.id,
        cooldownMs: this.validCooldown(def.cooldown),
        chargeMs: 0,
        damage: Math.max(0, def.damage),
        heal: Math.max(0, def.heal),
        shield: Math.max(0, def.shield),
        burn: Math.max(0, def.burn),
        poison: Math.max(0, def.poison),
        regen: Math.max(0, def.regen),
        crit: Math.max(0, def.crit),
        multicast: Math.max(1, Math.round(def.multicast || 1)),
        col: slot.col,
        row: slot.row,
        size,
        tier: 'Bronze',
        freezeMs: 0,
        slowMs: 0,
        hasteMs: 0,
      })
    }

    if (out.length === 0) {
      const fallback = seedDefs[(this.day * 7) % seedDefs.length]!
      const slot = findSlot('1x1')
      if (slot) {
        out.push({
          id: `E-fallback-${fallback.id}`,
          side: 'enemy',
          defId: fallback.id,
          cooldownMs: this.validCooldown(fallback.cooldown),
          chargeMs: 0,
          damage: Math.max(0, fallback.damage),
          heal: Math.max(0, fallback.heal),
          shield: Math.max(0, fallback.shield),
          burn: Math.max(0, fallback.burn),
          poison: Math.max(0, fallback.poison),
          regen: Math.max(0, fallback.regen),
          crit: Math.max(0, fallback.crit),
          multicast: Math.max(1, Math.round(fallback.multicast || 1)),
          col: slot.col,
          row: slot.row,
          size: '1x1',
          tier: 'Bronze',
          freezeMs: 0,
          slowMs: 0,
          hasteMs: 0,
        })
      }
    }
    return out
  }

  private pickEnemyDefsByDay(all: ItemDef[]): ItemDef[] {
    const rules = getConfig().combatRuntime.enemyByDay ?? []
    const matched = rules.find((r) => this.day >= r.dayStart && this.day <= r.dayEnd)
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
      if (hit) out.push(hit)
    }
    return out
  }

  private validCooldown(cd: number): number {
    if (!Number.isFinite(cd) || cd <= 0) return FALLBACK_CD_MS
    return Math.round(cd)
  }

  private findItemDef(defId: string): ItemDef | null {
    return getAllItems().find((it) => it.id === defId) ?? null
  }

  private stepOneTick(tickMs: number): void {
    this.tickIndex += 1
    const queue: CombatItemRunner[] = []
    for (const item of this.items) {
      const freezeBefore = item.freezeMs
      const slowBefore = item.slowMs
      const hasteBefore = item.hasteMs
      if (item.freezeMs > 0) {
        item.freezeMs = Math.max(0, item.freezeMs - tickMs)
        if (freezeBefore > 0 && item.freezeMs === 0) {
          EventBus.emit('battle:status_remove', {
            targetId: item.id,
            status: 'freeze',
            targetType: 'item',
            targetSide: item.side,
          })
        }
      }
      if (item.slowMs > 0) {
        item.slowMs = Math.max(0, item.slowMs - tickMs)
        if (slowBefore > 0 && item.slowMs === 0) {
          EventBus.emit('battle:status_remove', {
            targetId: item.id,
            status: 'slow',
            targetType: 'item',
            targetSide: item.side,
          })
        }
      }
      if (item.hasteMs > 0) {
        item.hasteMs = Math.max(0, item.hasteMs - tickMs)
        if (hasteBefore > 0 && item.hasteMs === 0) {
          EventBus.emit('battle:status_remove', {
            targetId: item.id,
            status: 'haste',
            targetType: 'item',
            targetSide: item.side,
          })
        }
      }

      if (item.freezeMs > 0) continue

      const cr = getConfig().combatRuntime
      const slowFactor = Math.max(0, Math.min(0.95, cr.cardSlowFactor ?? 0.4))
      const hasteFactor = Math.max(0, cr.cardHasteFactor ?? 0.4)
      let gain = tickMs
      if (item.slowMs > 0) gain *= Math.max(0.05, 1 - slowFactor)
      if (item.hasteMs > 0) gain *= 1 + hasteFactor

      item.chargeMs += gain
      if (item.chargeMs >= item.cooldownMs) {
        item.chargeMs = 0
        queue.push(item)
      }
    }

    const playerQueue = queue.filter((q) => q.side === 'player')
    const enemyQueue = queue.filter((q) => q.side === 'enemy')
    for (const q of playerQueue) this.resolveFire(q)
    for (const q of enemyQueue) this.resolveFire(q)

    this.processStatusPeriodicByTick()
    this.resolvePendingHitsForCurrentTick()
  }

  private resolveFire(item: CombatItemRunner): void {
    const sourceHero = item.side === 'player' ? this.playerHero : this.enemyHero
    const targetHero = item.side === 'player' ? this.enemyHero : this.playerHero
    const def = this.findItemDef(item.defId)

    this.applyCardEffects(item, def)

    if (item.shield > 0 && sourceHero.hp > 0) {
      sourceHero.shield += item.shield
      EventBus.emit('battle:gain_shield', {
        targetId: sourceHero.id,
        sourceItemId: item.id,
        amount: item.shield,
        targetType: 'hero',
        targetSide: sourceHero.side,
        sourceType: 'item',
        sourceSide: item.side,
      })
    }
    if (item.heal > 0 && sourceHero.hp > 0) {
      sourceHero.hp = Math.min(sourceHero.maxHp, sourceHero.hp + item.heal)
      EventBus.emit('battle:heal', {
        targetId: sourceHero.id,
        sourceItemId: item.id,
        amount: item.heal,
        isRegen: false,
        targetType: 'hero',
        targetSide: sourceHero.side,
        sourceType: 'item',
        sourceSide: item.side,
      })
      const cleansePct = Math.max(0, rv('healCleansePct', getConfig().combatRuntime.healCleansePct))
      const clearLayer = Math.max(0, Math.ceil(item.heal * cleansePct))
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

    if (item.burn > 0) {
      targetHero.burn += item.burn
      EventBus.emit('battle:status_apply', {
        targetId: targetHero.id,
        sourceItemId: item.id,
        status: 'burn',
        amount: item.burn,
        targetType: 'hero',
        targetSide: targetHero.side,
        sourceType: 'item',
        sourceSide: item.side,
      })
    }
    if (item.poison > 0) {
      targetHero.poison += item.poison
      EventBus.emit('battle:status_apply', {
        targetId: targetHero.id,
        sourceItemId: item.id,
        status: 'poison',
        amount: item.poison,
        targetType: 'hero',
        targetSide: targetHero.side,
        sourceType: 'item',
        sourceSide: item.side,
      })
    }
    if (item.regen > 0) {
      sourceHero.regen += item.regen
      EventBus.emit('battle:status_apply', {
        targetId: sourceHero.id,
        sourceItemId: item.id,
        status: 'regen',
        amount: item.regen,
        targetType: 'hero',
        targetSide: sourceHero.side,
        sourceType: 'item',
        sourceSide: item.side,
      })
    }

    if (item.damage > 0) {
      for (let i = 0; i < item.multicast; i++) {
        this.pendingHits.push({
          dueTick: this.tickIndex + i,
          side: item.side,
          sourceItemId: item.id,
          defId: item.defId,
          damage: item.damage,
          crit: item.crit,
        })
      }
    }
  }

  private applyCardEffects(source: CombatItemRunner, def: ItemDef | null): void {
    if (!def) return
    const specs = parseControlSpecsFromDef(def, getConfig().combatRuntime)
    for (const spec of specs) {
      const side: 'player' | 'enemy' =
        spec.targetSide === 'ally'
          ? source.side
          : (source.side === 'player' ? 'enemy' : 'player')
      const targets = this.pickControlTargets(side, spec.targetAll ? 999 : spec.count, spec.targetSide === 'ally' ? source.id : undefined)
      for (const target of targets) {
        if (spec.status === 'freeze') target.freezeMs = Math.max(target.freezeMs, spec.durationMs)
        if (spec.status === 'slow') target.slowMs = Math.max(target.slowMs, spec.durationMs)
        if (spec.status === 'haste') target.hasteMs = Math.max(target.hasteMs, spec.durationMs)
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
  }

  private pickControlTargets(side: 'player' | 'enemy', count: number, excludeId?: string): CombatItemRunner[] {
    const candidates = this.items
      .filter((it) => it.side === side && it.id !== excludeId)
      .sort((a, b) => (a.col - b.col) || a.id.localeCompare(b.id))
    if (count >= candidates.length) return candidates
    return candidates.slice(0, Math.max(0, count))
  }

  private resolvePendingHitsForCurrentTick(): void {
    if (!this.pendingHits.length) return
    const due = this.pendingHits.filter((h) => h.dueTick <= this.tickIndex)
    this.pendingHits = this.pendingHits.filter((h) => h.dueTick > this.tickIndex)

    for (const hit of due) {
      EventBus.emit('battle:item_fire', {
        itemId: hit.defId,
        sourceItemId: hit.sourceItemId,
        side: hit.side,
        multicast: 1,
      })
      const targetHero = hit.side === 'player' ? this.enemyHero : this.playerHero
      if (targetHero.hp <= 0) continue
      const critRoll = Math.random() * 100
      const isCrit = critRoll < hit.crit
      const critMult = getConfig().combatRuntime.critMultiplier
      const panel = isCrit ? Math.round(hit.damage * critMult) : hit.damage

      let remaining = panel
      if (targetHero.shield > 0) {
        const blocked = Math.min(targetHero.shield, remaining)
        targetHero.shield -= blocked
        remaining -= blocked
      }
      if (remaining > 0) {
        targetHero.hp = Math.max(0, targetHero.hp - remaining)
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
      })

      if (targetHero.hp === 0) {
        EventBus.emit('battle:unit_die', {
          unitId: targetHero.id,
          side: targetHero.side,
        })
      }
    }
  }

  private stepFatigue(): void {
    const pct = getConfig().combatRuntime.fatigueDamagePctPerSec
    const pDmg = Math.max(1, Math.round(this.playerHero.maxHp * pct))
    const eDmg = Math.max(1, Math.round(this.enemyHero.maxHp * pct))
    this.playerHero.hp = Math.max(0, this.playerHero.hp - pDmg)
    this.enemyHero.hp = Math.max(0, this.enemyHero.hp - eDmg)

    EventBus.emit('battle:take_damage', {
      targetId: this.playerHero.id,
      sourceItemId: 'fatigue',
      amount: pDmg,
      isCrit: false,
      type: 'normal',
      targetType: 'hero',
      targetSide: 'player',
      sourceType: 'system',
      sourceSide: 'system',
    })
    EventBus.emit('battle:take_damage', {
      targetId: this.enemyHero.id,
      sourceItemId: 'fatigue',
      amount: eDmg,
      isCrit: false,
      type: 'normal',
      targetType: 'hero',
      targetSide: 'enemy',
      sourceType: 'system',
      sourceSide: 'system',
    })
  }

  private processStatusPeriodicByTick(): void {
    const cr = getConfig().combatRuntime
    const tickMs = Math.max(1, cr.tickMs)
    const burnTickEvery = Math.max(1, Math.round(Math.max(1, rv('burnTickMs', cr.burnTickMs)) / tickMs))
    const poisonTickEvery = Math.max(1, Math.round(Math.max(1, rv('poisonTickMs', cr.poisonTickMs)) / tickMs))
    const regenTickEvery = Math.max(1, Math.round(Math.max(1, rv('regenTickMs', cr.regenTickMs)) / tickMs))

    if (this.tickIndex % burnTickEvery === 0) {
      this.applyBurnTick(this.playerHero)
      this.applyBurnTick(this.enemyHero)
    }

    if (this.tickIndex % poisonTickEvery === 0) {
      this.applyPoisonTick(this.playerHero)
      this.applyPoisonTick(this.enemyHero)
    }

    if (this.tickIndex % regenTickEvery === 0) {
      this.applyRegenTick(this.playerHero)
      this.applyRegenTick(this.enemyHero)
    }
  }

  private applyBurnTick(hero: HeroState): void {
    const layer = hero.burn
    if (layer <= 0 || hero.hp <= 0) return
    let hpDamage = layer
    const shieldFactor = Math.max(0, rv('burnShieldFactor', getConfig().combatRuntime.burnShieldFactor))
    if (hero.shield > 0) {
      const shieldCost = Math.min(hero.shield, Math.ceil(layer * shieldFactor))
      hero.shield -= shieldCost
      const protectedValue = shieldFactor > 0 ? shieldCost / shieldFactor : 0
      hpDamage = Math.max(0, Math.round(layer - protectedValue))
    }
    if (hpDamage > 0) {
      hero.hp = Math.max(0, hero.hp - hpDamage)
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
    hero.hp = Math.max(0, hero.hp - layer)
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
    return this.playerHero.hp <= 0 || this.enemyHero.hp <= 0
  }

  private finishCombat(): void {
    if (this.finished) return
    this.finished = true
    this.phase = 'END'
    let winner: 'player' | 'enemy' | 'draw' = 'draw'
    if (this.playerHero.hp > 0 && this.enemyHero.hp <= 0) winner = 'player'
    if (this.enemyHero.hp > 0 && this.playerHero.hp <= 0) winner = 'enemy'
    this.result = { winner, ticks: this.tickIndex }
    EventBus.emit('battle:end', {
      winner,
      blameLog: [
        `day=${this.day}`,
        `ticks=${this.tickIndex}`,
        `playerHp=${this.playerHero.hp}`,
        `enemyHp=${this.enemyHero.hp}`,
        `fatigue=${this.inFatigue ? '1' : '0'}`,
      ],
    })
  }
}
