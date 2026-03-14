import { describe, expect, it } from 'vitest'
import { getAllItems } from '@/core/DataLoader'
import { resolveItemEnchantmentEffectCn, type ItemEnchantmentKey } from '@/common/items/ItemEnchantment'
import { CombatEngine } from './CombatEngine'
import type { CombatItemRunner, HeroState } from './CombatTypes'

function pickDefByEnchantEffect(key: ItemEnchantmentKey, pattern: RegExp): { id: string } {
  const all = getAllItems()
  const hit = all.find((def) => pattern.test(resolveItemEnchantmentEffectCn(def, key)))
  if (!hit) throw new Error(`Cannot find item def for enchantment ${key} with pattern ${pattern}`)
  return { id: hit.id }
}

function makeHero(side: 'player' | 'enemy', hp: number, maxHp = 100): HeroState {
  return { id: `${side}-hero`, side, hp, maxHp, shield: 0, burn: 0, poison: 0, regen: 0 }
}

type RunnerInput = {
  id: string
  side: 'player' | 'enemy'
  defId: string
  baseStats?: Partial<CombatItemRunner['baseStats']>
  runtime?: Partial<Omit<CombatItemRunner['runtime'], 'modifiers'>> & { modifiers?: Partial<CombatItemRunner['runtime']['modifiers']> }
  col?: number
  row?: number
  size?: CombatItemRunner['size']
  tier?: string
  tierStar?: 1 | 2
  enchantment?: CombatItemRunner['enchantment']
  reviveUsed?: boolean
}

function makeRunner(input: RunnerInput): CombatItemRunner {
  return {
    id: input.id,
    side: input.side,
    defId: input.defId,
    baseStats: {
      cooldownMs: 1000,
      damage: 0,
      heal: 0,
      shield: 0,
      burn: 0,
      poison: 0,
      regen: 0,
      crit: 0,
      multicast: 1,
      ...(input.baseStats ?? {}),
    },
    runtime: {
      currentChargeMs: 0,
      pendingChargeMs: 0,
      tempDamageBonus: 0,
      damageScale: 1,
      finalDamageBonusPct: 0,
      bonusMulticast: 0,
      executeCount: 0,
      ammoMax: 0,
      ammoCurrent: 0,
      ...(input.runtime ?? {}),
      modifiers: {
        freezeMs: 0,
        slowMs: 0,
        hasteMs: 0,
        ...(input.runtime?.modifiers ?? {}),
      },
    },
    col: input.col ?? 0,
    row: input.row ?? 0,
    size: input.size ?? '1x1',
    tier: input.tier ?? 'Bronze#1',
    tierStar: input.tierStar ?? 1,
    enchantment: input.enchantment,
    reviveUsed: input.reviveUsed,
  }
}

describe('Combat enchantment final multiplier', () => {
  it('adds self-double + adjacent +50% + scope bucket as additive final multiplier', () => {
    const damageDoubleDef = pickDefByEnchantEffect('damage', /翻倍/)
    const adjacentDamageDef = pickDefByEnchantEffect('damage', /相邻物品伤害\+50%/)
    const engine = new CombatEngine() as any

    const target = makeRunner({
      id: 'target',
      side: 'player',
      defId: damageDoubleDef.id,
      enchantment: 'damage',
      runtime: { finalDamageBonusPct: 0.5 },
      col: 1,
    })
    const owner = makeRunner({
      id: 'owner',
      side: 'player',
      defId: adjacentDamageDef.id,
      enchantment: 'damage',
      col: 0,
    })

    engine.state.items = [target, owner]
    const mul = engine.enchantmentFinalMultiplier(target, 'damage')
    expect(mul).toBeCloseTo(3)
  })

  it('applies adjacent shield/heal +50% as final multiplier', () => {
    const adjacentShieldDef = pickDefByEnchantEffect('shield', /相邻物品护盾\+50%/)
    const adjacentHealDef = pickDefByEnchantEffect('heal', /相邻物品加血\+50%/)
    const shieldTargetDef = pickDefByEnchantEffect('shield', /翻倍/)
    const healTargetDef = pickDefByEnchantEffect('heal', /翻倍/)
    const engine = new CombatEngine() as any

    const shieldTarget = makeRunner({ id: 'shield-target', side: 'player', defId: shieldTargetDef.id, col: 1 })
    const healTarget = makeRunner({ id: 'heal-target', side: 'player', defId: healTargetDef.id, col: 3 })
    const shieldOwner = makeRunner({ id: 'shield-owner', side: 'player', defId: adjacentShieldDef.id, enchantment: 'shield', col: 0 })
    const healOwner = makeRunner({ id: 'heal-owner', side: 'player', defId: adjacentHealDef.id, enchantment: 'heal', col: 2 })

    engine.state.items = [shieldTarget, shieldOwner, healTarget, healOwner]
    expect(engine.enchantmentFinalMultiplier(shieldTarget, 'shield')).toBeCloseTo(1.5)
    expect(engine.enchantmentFinalMultiplier(healTarget, 'heal')).toBeCloseTo(1.5)
  })
})

describe('Combat resolveFire uses final multiplier at end', () => {
  it('multiplies final damage/heal/shield outputs', () => {
    const engine = new CombatEngine() as any
    const item = makeRunner({
      id: 'attacker',
      side: 'player',
      defId: 'missing-def-for-test',
      baseStats: { damage: 10, shield: 8, heal: 6, crit: 0 },
    })
    engine.state.tickIndex = 1
    engine.state.playerHero = makeHero('player', 50, 100)
    engine.state.enemyHero = makeHero('enemy', 100, 100)
    engine.state.items = [item]
    engine.state.pendingHits = []
    engine.state.pendingItemFires = []
    engine.state.pendingChargePulses = []
    engine.state.pendingAmmoRefills = []

    engine.enchantmentFinalMultiplier = (_it: CombatItemRunner, stat: 'damage' | 'shield' | 'heal') => (stat === 'damage' || stat === 'shield' || stat === 'heal' ? 2 : 1)

    engine.resolveFire(item, false)
    expect(engine.state.playerHero.shield).toBe(16)
    expect(engine.state.playerHero.hp).toBe(62)

    engine.resolvePendingHitsForCurrentTick()
    expect(engine.state.enemyHero.hp).toBe(80)
  })
})
