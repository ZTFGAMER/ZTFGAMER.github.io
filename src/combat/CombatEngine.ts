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
  baseStats: {
    cooldownMs: number
    damage: number
    heal: number
    shield: number
    burn: number
    poison: number
    regen: number
    crit: number
    multicast: number
  }
  runtime: {
    currentChargeMs: number
    tempDamageBonus: number
    executeCount: number
    modifiers: {
      freezeMs: number
      slowMs: number
      hasteMs: number
    }
  }
  col: number
  row: number
  size: ItemSizeNorm
  tier: string
  reviveUsed?: boolean
}

export interface CombatItemRuntimeState {
  id: string
  side: 'player' | 'enemy'
  currentChargeMs: number
  chargePercent: number
  executeCount: number
  tempDamageBonus: number
  freezeMs: number
  slowMs: number
  hasteMs: number
}

interface PendingHit {
  dueTick: number
  side: 'player' | 'enemy'
  sourceItemId: string
  defId: string
  baseDamage: number
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
  targetMode: 'leftmost' | 'adjacent' | 'random' | 'fastest' | 'left'
}

function parseTierName(raw: string): string {
  if (raw.includes('Bronze')) return 'Bronze'
  if (raw.includes('Silver')) return 'Silver'
  if (raw.includes('Gold')) return 'Gold'
  if (raw.includes('Diamond')) return 'Diamond'
  return ''
}

function parseAvailableTiers(raw: string): string[] {
  const s = (raw || '').trim()
  if (!s) return ['Bronze', 'Silver', 'Gold', 'Diamond']
  const out = s
    .split('/')
    .map((v) => parseTierName(v.trim()))
    .filter((v): v is string => Boolean(v))
  return out.length > 0 ? out : ['Bronze', 'Silver', 'Gold', 'Diamond']
}

function pickTierSeriesValue(series: string, tierIndex: number): number {
  const parts = series.split('/').map((v) => v.trim()).filter(Boolean)
  if (parts.length === 0) return 0
  const idx = Math.max(0, Math.min(parts.length - 1, tierIndex))
  const n = Number(parts[idx])
  return Number.isFinite(n) ? n : 0
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
  fatigueStartMs?: number
  fatigueIntervalMs?: number
  fatigueDamagePctPerInterval?: number
  fatigueDamageFixedPerInterval?: number
  fatigueDamagePctRampPerInterval?: number
  fatigueDamageFixedRampPerInterval?: number
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
      const targetMode: ControlSpec['targetMode'] = /左侧|left\s+side|to\s+the\s+left/i.test(line)
        ? 'left'
        : /相邻|adjacent/i.test(line)
        ? 'adjacent'
        : /随机|random/i.test(line)
          ? 'random'
          : /最快|fastest/i.test(line)
            ? 'fastest'
            : 'leftmost'
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
        targetMode,
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
  private fatigueTickCount = 0
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

    this.applyBattleStartEffects()

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
      const fatigueStartMs = Math.max(0, rv('fatigueStartMs', cfg.fatigueStartMs ?? cfg.timeoutMs ?? 40000))
      const fatigueIntervalMs = Math.max(1, rv('fatigueIntervalMs', cfg.fatigueIntervalMs ?? cfg.fatigueTickMs ?? 1000))

      if (!this.inFatigue && this.elapsedMs >= fatigueStartMs) {
        this.inFatigue = true
        EventBus.emit('battle:fatigue_start', { elapsedMs: this.elapsedMs })
      }

      if (this.shouldResolve()) {
        this.phase = 'RESOLVE'
      }
      if (this.phase === 'RESOLVE') {
        this.finishCombat()
        return
      }

      this.tickAccumulatorMs += deltaMs
      while (this.tickAccumulatorMs >= cfg.tickMs) {
        this.tickAccumulatorMs -= cfg.tickMs
        this.stepOneTick(cfg.tickMs)
        if (this.shouldResolve()) {
          this.phase = 'RESOLVE'
          break
        }
        if (this.inFatigue) {
          this.fatigueAccumulatorMs += cfg.tickMs
          while (this.fatigueAccumulatorMs >= fatigueIntervalMs) {
            this.fatigueAccumulatorMs -= fatigueIntervalMs
            this.stepFatigue()
            if (this.shouldResolve()) {
              this.phase = 'RESOLVE'
              break
            }
          }
          if (this.phase === 'RESOLVE') break
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
        chargeRatio: Math.max(0, Math.min(1, it.runtime.currentChargeMs / it.baseStats.cooldownMs)),
      })),
    }
  }

  getRuntimeState(): CombatItemRuntimeState[] {
    return this.items.map((it) => ({
      id: it.id,
      side: it.side,
      currentChargeMs: it.runtime.currentChargeMs,
      chargePercent: Math.max(0, Math.min(1, it.runtime.currentChargeMs / Math.max(1, it.baseStats.cooldownMs))),
      executeCount: it.runtime.executeCount,
      tempDamageBonus: it.runtime.tempDamageBonus,
      freezeMs: it.runtime.modifiers.freezeMs,
      slowMs: it.runtime.modifiers.slowMs,
      hasteMs: it.runtime.modifiers.hasteMs,
    }))
  }

  private reset(): void {
    this.phase = 'IDLE'
    this.elapsedMs = 0
    this.tickAccumulatorMs = 0
    this.fatigueAccumulatorMs = 0
    this.fatigueTickCount = 0
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
      baseStats: {
        cooldownMs: this.validCooldown(def?.cooldown ?? 0),
        damage: Math.max(0, (def?.damage ?? 0) + Math.max(0, entity.permanentDamageBonus ?? 0)),
        heal: Math.max(0, def?.heal ?? 0),
        shield: Math.max(0, def?.shield ?? 0),
        burn: Math.max(0, def?.burn ?? 0),
        poison: Math.max(0, def?.poison ?? 0),
        regen: Math.max(0, def?.regen ?? 0),
        crit: Math.max(0, def?.crit ?? 0),
        multicast: Math.max(1, Math.round(def?.multicast ?? 1)),
      },
      runtime: {
        currentChargeMs: 0,
        tempDamageBonus: 0,
        executeCount: 0,
        modifiers: {
          freezeMs: 0,
          slowMs: 0,
          hasteMs: 0,
        },
      },
      col: entity.col,
      row: entity.row,
      size: entity.size,
      tier: entity.tier,
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
        baseStats: {
          cooldownMs: this.validCooldown(def.cooldown),
          damage: Math.max(0, def.damage),
          heal: Math.max(0, def.heal),
          shield: Math.max(0, def.shield),
          burn: Math.max(0, def.burn),
          poison: Math.max(0, def.poison),
          regen: Math.max(0, def.regen),
          crit: Math.max(0, def.crit),
          multicast: Math.max(1, Math.round(def.multicast || 1)),
        },
        runtime: {
          currentChargeMs: 0,
          tempDamageBonus: 0,
          executeCount: 0,
          modifiers: { freezeMs: 0, slowMs: 0, hasteMs: 0 },
        },
        col: slot.col,
        row: slot.row,
        size,
        tier: 'Bronze',
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
          baseStats: {
            cooldownMs: this.validCooldown(fallback.cooldown),
            damage: Math.max(0, fallback.damage),
            heal: Math.max(0, fallback.heal),
            shield: Math.max(0, fallback.shield),
            burn: Math.max(0, fallback.burn),
            poison: Math.max(0, fallback.poison),
            regen: Math.max(0, fallback.regen),
            crit: Math.max(0, fallback.crit),
            multicast: Math.max(1, Math.round(fallback.multicast || 1)),
          },
          runtime: {
            currentChargeMs: 0,
            tempDamageBonus: 0,
            executeCount: 0,
            modifiers: { freezeMs: 0, slowMs: 0, hasteMs: 0 },
          },
          col: slot.col,
          row: slot.row,
          size: '1x1',
          tier: 'Bronze',
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

  private skillLines(def: ItemDef | null): string[] {
    if (!def) return []
    return (def.skills ?? []).map((s) => s.cn?.trim() ?? '').filter(Boolean)
  }

  private tierIndex(def: ItemDef | null, tier: string): number {
    if (!def) return 0
    const tiers = parseAvailableTiers(def.available_tiers)
    const idx = tiers.indexOf(tier)
    return idx >= 0 ? idx : 0
  }

  private tierValueFromLine(line: string, tierIndex: number): number {
    const m = line.match(/(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)+)/)
    if (!m?.[1]) return 0
    return pickTierSeriesValue(m[1], tierIndex)
  }

  private isAdjacentById(aId: string, bId: string): boolean {
    const a = this.items.find((it) => it.id === aId)
    const b = this.items.find((it) => it.id === bId)
    if (!a || !b) return false
    return this.isAdjacentByFootprint(a, b)
  }

  private applyHasteToTargetItems(source: CombatItemRunner, targets: CombatItemRunner[], durationMs: number): void {
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

  private applyAdjacentUseHasteTriggers(fired: CombatItemRunner): void {
    for (const owner of this.items) {
      if (owner.side !== fired.side || owner.id === fired.id) continue
      if (!this.isAdjacentByFootprint(owner, fired)) continue
      const def = this.findItemDef(owner.defId)
      if (!def) continue
      const line = this.skillLines(def).find((s) => /相邻物品使用时.*加速另一侧的物品/.test(s))
      if (!line) continue
      const sec = this.tierValueFromLine(line, this.tierIndex(def, owner.tier))
      if (sec <= 0) continue

      const ownerStart = owner.col
      const ownerEnd = owner.col + this.itemWidth(owner.size) - 1
      const firedCenter = fired.col + this.itemWidth(fired.size) / 2
      const ownerCenter = owner.col + this.itemWidth(owner.size) / 2
      const wantRight = firedCenter < ownerCenter

      const target = this.items
        .filter((it) => it.side === owner.side && it.id !== owner.id && it.id !== fired.id)
        .find((it) => {
          const s = it.col
          const e = it.col + this.itemWidth(it.size) - 1
          return wantRight ? s === ownerEnd + 1 : e === ownerStart - 1
        })
      if (target) this.applyHasteToTargetItems(owner, [target], Math.round(sec * 1000))
    }
  }

  private applyAdjacentUseBurnTriggers(fired: CombatItemRunner): void {
    const targetHero = fired.side === 'player' ? this.enemyHero : this.playerHero
    if (targetHero.hp <= 0) return
    for (const owner of this.items) {
      if (owner.side !== fired.side || owner.id === fired.id) continue
      if (!this.isAdjacentByFootprint(owner, fired)) continue
      const def = this.findItemDef(owner.defId)
      if (!def) continue
      const line = this.skillLines(def).find((s) => /使用相邻物品时.*造成\d+(?:\/\d+)*灼烧/.test(s))
      if (!line) continue
      const burn = Math.round(this.tierValueFromLine(line, this.tierIndex(def, owner.tier)))
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

  private applyBurnUseSlowTriggers(fired: CombatItemRunner): void {
    if (fired.baseStats.burn <= 0) return
    for (const owner of this.items) {
      if (owner.side !== fired.side || owner.id === fired.id) continue
      const def = this.findItemDef(owner.defId)
      if (!def) continue
      const line = this.skillLines(def).find((s) => /使用灼烧物品时.*减速敌方\d+件敌方物品\d+(?:\/\d+)*秒/.test(s))
      if (!line) continue
      const sec = this.tierValueFromLine(line, this.tierIndex(def, owner.tier))
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

  private applyBattleStartPassiveGrowths(): void {
    for (const owner of this.items) {
      const def = this.findItemDef(owner.defId)
      if (!def) continue
      const lines = this.skillLines(def)
      const tIdx = this.tierIndex(def, owner.tier)

      const shieldLine = lines.find((s) => /护盾物品护盾值\+\d+(?:\/\d+)*/.test(s))
      if (shieldLine) {
        const v = Math.round(this.tierValueFromLine(shieldLine, tIdx))
        if (v > 0) {
          for (const ally of this.items) {
            if (ally.side !== owner.side) continue
            if (ally.baseStats.shield <= 0) continue
            ally.baseStats.shield += v
          }
        }
      }

      const burnLine = lines.find((s) => /灼烧物品\+\d+(?:\/\d+)*灼烧/.test(s))
      if (burnLine) {
        const v = Math.round(this.tierValueFromLine(burnLine, tIdx))
        if (v > 0) {
          for (const ally of this.items) {
            if (ally.side !== owner.side) continue
            if (ally.baseStats.burn <= 0) continue
            ally.baseStats.burn += v
          }
        }
      }

      const adjacentPoisonLine = lines.find((s) => /相邻剧毒物品\+\d+(?:\/\d+)*剧毒/.test(s))
      if (adjacentPoisonLine) {
        const v = Math.round(this.tierValueFromLine(adjacentPoisonLine, tIdx))
        if (v > 0) {
          for (const ally of this.items) {
            if (ally.side !== owner.side || ally.id === owner.id) continue
            if (ally.baseStats.poison <= 0) continue
            if (!this.isAdjacentByFootprint(ally, owner)) continue
            ally.baseStats.poison += v
          }
        }
      }
    }
  }

  private applyFreezeTriggeredAdjacentAttackBuff(source: CombatItemRunner): void {
    const def = this.findItemDef(source.defId)
    if (!def) return
    const line = this.skillLines(def).find((s) => /冻结敌方时.*相邻攻击物品\+\d+(?:\/\d+)*伤害/.test(s))
    if (!line) return
    const v = Math.round(this.tierValueFromLine(line, this.tierIndex(def, source.tier)))
    if (v <= 0) return
    for (const ally of this.items) {
      if (ally.side !== source.side || ally.id === source.id) continue
      if (ally.baseStats.damage <= 0) continue
      if (!this.isAdjacentByFootprint(ally, source)) continue
      ally.runtime.tempDamageBonus += v
    }
  }

  private applyAdjacentAttackDamageGrowth(attacker: CombatItemRunner): void {
    for (const owner of this.items) {
      if (owner.side !== attacker.side || owner.id === attacker.id) continue
      if (!this.isAdjacentByFootprint(owner, attacker)) continue
      const def = this.findItemDef(owner.defId)
      if (!def) continue
      const line = this.skillLines(def).find((s) => /相邻物品攻击造成伤害时.*该物品\+\d+(?:\/\d+)*伤害/.test(s))
      if (!line) continue
      const v = Math.round(this.tierValueFromLine(line, this.tierIndex(def, owner.tier)))
      if (v > 0) owner.runtime.tempDamageBonus += v
    }
  }

  private shieldGainBonusForItem(source: CombatItemRunner): number {
    if (source.baseStats.shield <= 0) return 0
    let bonus = 0
    for (const owner of this.items) {
      if (owner.side !== source.side || owner.id === source.id) continue
      if (!this.isAdjacentByFootprint(owner, source)) continue
      const def = this.findItemDef(owner.defId)
      if (!def) continue
      const line = this.skillLines(def).find((s) => /相邻护盾物品.*\+\d+(?:\/\d+)*护盾/.test(s))
      if (!line) continue
      bonus += Math.round(this.tierValueFromLine(line, this.tierIndex(def, owner.tier)))
    }
    return Math.max(0, bonus)
  }

  private applyReviveIfPossible(side: 'player' | 'enemy'): boolean {
    const hero = side === 'player' ? this.playerHero : this.enemyHero
    if (hero.hp > 0) return false
    const candidates = this.items.filter((it) => it.side === side && !it.reviveUsed)
    for (const item of candidates) {
      const def = this.findItemDef(item.defId)
      if (!def) continue
      const line = this.skillLines(def).find((s) => /首次被击败时复活并恢复\d+(?:\/\d+)*生命值/.test(s))
      if (!line) continue
      const heal = Math.round(this.tierValueFromLine(line, this.tierIndex(def, item.tier)))
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

  private stepOneTick(tickMs: number): void {
    this.tickIndex += 1
    const queue: CombatItemRunner[] = []
    for (const item of this.items) {
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

      item.runtime.currentChargeMs += gain
      if (item.runtime.currentChargeMs >= item.baseStats.cooldownMs) {
        item.runtime.currentChargeMs = 0
        item.runtime.executeCount += 1
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
    const lines = this.skillLines(def)
    const tIdx = this.tierIndex(def, item.tier)
    this.applyAdjacentUseHasteTriggers(item)
    this.applyAdjacentUseBurnTriggers(item)
    this.applyBurnUseSlowTriggers(item)

    const ctrl = this.applyCardEffects(item, def)

    // 控制触发增益（本场战斗内）
    if (ctrl.freeze > 0) {
      this.applyFreezeTriggeredAdjacentAttackBuff(item)
      for (const line of lines) {
        const v = Math.round(this.tierValueFromLine(line, tIdx))
        if (v <= 0) continue
        if (/冻结.*\+\d+(?:\/\d+)*伤害/.test(line)) item.runtime.tempDamageBonus += v
        if (/冻结.*\+\d+(?:\/\d+)*灼烧/.test(line)) item.baseStats.burn += v
        if (/冻结.*\+\d+(?:\/\d+)*剧毒/.test(line)) item.baseStats.poison += v
      }
    }
    if (ctrl.slow > 0) {
      for (const line of lines) {
        const v = Math.round(this.tierValueFromLine(line, tIdx))
        if (v <= 0) continue
        if (/减速.*\+\d+(?:\/\d+)*伤害/.test(line)) item.runtime.tempDamageBonus += v
        if (/减速.*\+\d+(?:\/\d+)*灼烧/.test(line)) item.baseStats.burn += v
      }
    }
    if (ctrl.haste > 0) {
      const line = lines.find((s) => /触发加速时.*额外造成\d+(?:\/\d+)*伤害/.test(s))
      if (line) {
        const v = Math.round(this.tierValueFromLine(line, tIdx))
        if (v > 0) {
          this.pendingHits.push({
            dueTick: this.tickIndex,
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
      const shieldPanel = item.baseStats.shield + this.shieldGainBonusForItem(item)
      sourceHero.shield += shieldPanel
      EventBus.emit('battle:gain_shield', {
        targetId: sourceHero.id,
        sourceItemId: item.id,
        amount: shieldPanel,
        targetType: 'hero',
        targetSide: sourceHero.side,
        sourceType: 'item',
        sourceSide: item.side,
      })

      // 获得护盾时加速 1 件物品
      const shieldHasteLine = lines.find((s) => /获得护盾时.*加速.*件物品/.test(s))
      if (shieldHasteLine) {
        const sec = this.tierValueFromLine(shieldHasteLine, tIdx)
        if (sec > 0) {
          const targets = this.pickControlTargets({
            side: item.side,
            count: 1,
            mode: 'leftmost',
            source: item,
            excludeId: item.id,
          })
          this.applyHasteToTargetItems(item, targets, Math.round(sec * 1000))
        }
      }
    }
    if (item.baseStats.heal > 0 && sourceHero.hp > 0) {
      sourceHero.hp = Math.min(sourceHero.maxHp, sourceHero.hp + item.baseStats.heal)
      EventBus.emit('battle:heal', {
        targetId: sourceHero.id,
        sourceItemId: item.id,
        amount: item.baseStats.heal,
        isRegen: false,
        targetType: 'hero',
        targetSide: sourceHero.side,
        sourceType: 'item',
        sourceSide: item.side,
      })
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
      const line = lines.find((s) => /造成灼烧时.*剧毒物品\+\d+(?:\/\d+)*/.test(s))
      if (line) {
        const v = Math.round(this.tierValueFromLine(line, tIdx))
        if (v > 0) {
          for (const ally of this.items) {
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
      const healLine = lines.find((s) => /造成剧毒时恢复\+?\d+(?:\/\d+)*/.test(s))
      if (healLine) {
        const heal = Math.round(this.tierValueFromLine(healLine, tIdx))
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
      const poisonToBurnLine = lines.find((s) => /造成剧毒时.*灼烧物品\+\d+(?:\/\d+)*/.test(s))
      if (poisonToBurnLine) {
        const v = Math.round(this.tierValueFromLine(poisonToBurnLine, tIdx))
        if (v > 0) {
          for (const ally of this.items) {
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

    const baseDamage = Math.max(0, item.baseStats.damage)
    let damageAfterBonus = Math.max(0, baseDamage + item.runtime.tempDamageBonus)

    // 等同当前自身护盾值
    if (lines.some((s) => /等同于当前自身护盾值/.test(s))) {
      damageAfterBonus += Math.max(0, sourceHero.shield)
    }
    // 目标最大生命值百分比伤害
    const maxHpLine = lines.find((s) => /最大生命值.*%.*伤害/.test(s))
    if (maxHpLine) {
      const m = maxHpLine.match(/(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*)%/)
      if (m?.[1]) {
        const pct = m[1].includes('/') ? pickTierSeriesValue(m[1], tIdx) : Number(m[1])
        if (Number.isFinite(pct) && pct > 0) {
          damageAfterBonus += Math.round(targetHero.maxHp * (pct / 100))
        }
      }
    }

    // 邻接被动：相邻物品攻击时，攻击造成 X 伤害
    for (const ally of this.items) {
      if (ally.side !== item.side || ally.id === item.id) continue
      if (!this.isAdjacentById(ally.id, item.id)) continue
      const allyDef = this.findItemDef(ally.defId)
      const allyLine = this.skillLines(allyDef).find((s) => /相邻物品攻击时.*造成\d+(?:\/\d+)*伤害/.test(s))
      if (!allyLine) continue
      const v = Math.round(this.tierValueFromLine(allyLine, this.tierIndex(allyDef, ally.tier)))
      if (v > 0) damageAfterBonus += v
    }

    if (damageAfterBonus > 0) {
      let fireCount = item.baseStats.multicast
      if (lines.some((s) => /唯一的攻击物品.*触发2次/.test(s))) {
        const attackers = this.items.filter((it) => it.side === item.side && it.baseStats.damage > 0)
        if (attackers.length === 1) fireCount = Math.max(fireCount, 2)
      }
      for (let i = 0; i < fireCount; i++) {
        this.pendingHits.push({
          dueTick: this.tickIndex + i,
          side: item.side,
          sourceItemId: item.id,
          defId: item.defId,
          baseDamage,
          damage: damageAfterBonus,
          crit: item.baseStats.crit,
        })
      }
    }

    // 每次使用后自身 CD 减少 1 秒（本场战斗内）
    if (lines.some((s) => /每次使用后自身CD减少1秒/.test(s))) {
      item.baseStats.cooldownMs = Math.max(300, item.baseStats.cooldownMs - 1000)
    }

    // 飞出时加速相邻物品
    const flyHasteLine = lines.find((s) => /飞出时加速相邻物品/.test(s))
    if (flyHasteLine) {
      const sec = this.tierValueFromLine(flyHasteLine, tIdx)
      if (sec > 0) {
        const targets = this.items.filter((it) => it.side === item.side && it.id !== item.id && this.isAdjacentByFootprint(it, item))
        this.applyHasteToTargetItems(item, targets, Math.round(sec * 1000))
      }
    }
  }

  private applyBattleStartEffects(): void {
    this.applyBattleStartPassiveGrowths()
    for (const item of this.items) {
      const def = this.findItemDef(item.defId)
      if (!def) continue
      const lines = this.skillLines(def)
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
        const targets = this.pickControlTargets({
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

  private applyCardEffects(source: CombatItemRunner, def: ItemDef | null): { freeze: number; slow: number; haste: number } {
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

  private pickControlTargets(params: {
    side: 'player' | 'enemy'
    count: number
    mode: ControlSpec['targetMode']
    source: CombatItemRunner
    excludeId?: string
  }): CombatItemRunner[] {
    const { side, count, mode, source, excludeId } = params
    const base = this.items
      .filter((it) => it.side === side && it.id !== excludeId)
      .sort((a, b) => (a.col - b.col) || a.id.localeCompare(b.id))
    if (base.length === 0) return []

    const limitedCount = Math.max(0, Math.min(count, base.length))
    if (limitedCount === 0) return []

    if (mode === 'adjacent') {
      const adjacent = base.filter((it) => this.isAdjacentByFootprint(it, source))
      if (adjacent.length <= limitedCount) return adjacent
      return adjacent.slice(0, limitedCount)
    }

    if (mode === 'left') {
      const sourceLeft = source.col
      const left = base
        .filter((it) => it.col + this.itemWidth(it.size) - 1 === sourceLeft - 1)
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
      const seed = this.seedFrom(source.id, this.tickIndex)
      const shuffled = this.shuffleDeterministic(base, seed)
      return shuffled.slice(0, limitedCount)
    }

    if (limitedCount >= base.length) return base
    return base.slice(0, limitedCount)
  }

  private itemWidth(size: ItemSizeNorm): number {
    if (size === '3x1') return 3
    if (size === '2x1') return 2
    return 1
  }

  private isAdjacentByFootprint(a: CombatItemRunner, b: CombatItemRunner): boolean {
    const aStart = a.col
    const aEnd = a.col + this.itemWidth(a.size) - 1
    const bStart = b.col
    const bEnd = b.col + this.itemWidth(b.size) - 1
    return aStart === bEnd + 1 || bStart === aEnd + 1
  }

  private seedFrom(key: string, salt: number): number {
    let h = 2166136261 ^ salt
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return h >>> 0
  }

  private shuffleDeterministic<T>(arr: T[], seed: number): T[] {
    const out = [...arr]
    let s = seed || 1
    const next = (): number => {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0
      return s / 0x100000000
    }
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1))
      const t = out[i]
      out[i] = out[j]!
      out[j] = t!
    }
    return out
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
        baseDamage: hit.baseDamage,
        finalDamage: remaining,
      })

      if (remaining > 0) {
        this.applyOnHeroDamagedReactions(targetHero.side)
        const attacker = this.items.find((it) => it.id === hit.sourceItemId)
        if (attacker) this.applyAdjacentAttackDamageGrowth(attacker)
      }

      if (targetHero.hp === 0) {
        EventBus.emit('battle:unit_die', {
          unitId: targetHero.id,
          side: targetHero.side,
        })
      }
    }
  }

  private applyOnHeroDamagedReactions(side: 'player' | 'enemy'): void {
    const hero = side === 'player' ? this.playerHero : this.enemyHero
    if (hero.hp <= 0) return
    for (const item of this.items) {
      if (item.side !== side) continue
      const def = this.findItemDef(item.defId)
      if (!def) continue
      const line = this.skillLines(def).find((s) => /受到攻击伤害时获得\d+(?:\/\d+)*护盾/.test(s))
      if (!line) continue
      const amount = Math.round(this.tierValueFromLine(line, this.tierIndex(def, item.tier)))
      if (amount <= 0) continue
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
    }
  }

  private stepFatigue(): void {
    const cr = getConfig().combatRuntime
    const pctBase = Math.max(0, rv('fatigueDamagePctPerInterval', cr.fatigueDamagePctPerInterval ?? cr.fatigueDamagePctPerSec ?? 0.1))
    const fixedBase = Math.max(0, rv('fatigueDamageFixedPerInterval', cr.fatigueDamageFixedPerInterval ?? 0))
    const pctRamp = Math.max(0, rv('fatigueDamagePctRampPerInterval', cr.fatigueDamagePctRampPerInterval ?? 0))
    const fixedRamp = Math.max(0, rv('fatigueDamageFixedRampPerInterval', cr.fatigueDamageFixedRampPerInterval ?? 0))
    const stack = this.fatigueTickCount
    const pct = pctBase + pctRamp * stack
    const fixed = fixedBase + fixedRamp * stack

    const pPanel = Math.max(1, Math.round(this.playerHero.maxHp * pct + fixed))
    const ePanel = Math.max(1, Math.round(this.enemyHero.maxHp * pct + fixed))

    const applyOne = (hero: HeroState, panel: number): { panel: number; hpDamage: number } => {
      let remaining = panel
      if (hero.shield > 0) {
        const blocked = Math.min(hero.shield, remaining)
        hero.shield -= blocked
        remaining -= blocked
      }
      if (remaining > 0) {
        hero.hp = Math.max(0, hero.hp - remaining)
      }
      return { panel, hpDamage: remaining }
    }

    const p = applyOne(this.playerHero, pPanel)
    const e = applyOne(this.enemyHero, ePanel)

    this.fatigueTickCount += 1

    EventBus.emit('battle:fatigue_tick', {
      elapsedMs: this.elapsedMs,
      tick: this.fatigueTickCount,
      playerDamage: p.hpDamage,
      enemyDamage: e.hpDamage,
    })

    EventBus.emit('battle:take_damage', {
      targetId: this.playerHero.id,
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
      targetId: this.enemyHero.id,
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
    this.applyReviveIfPossible('player')
    this.applyReviveIfPossible('enemy')
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
