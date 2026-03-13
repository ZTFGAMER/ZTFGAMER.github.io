// ============================================================
// DataLoader — 加载并类型化 JSON 配置
// 所有数值从配置文件读取，无硬编码魔法数字
// ============================================================

import type { GameConfig, ItemDef } from '@/common/items/ItemDef'

// Vite 支持直接 import JSON（resolveJsonModule）
import rawConfig   from '../../data/game_config.json'
import rawItems    from '../../data/vanessa_items.json'

// ---- GameConfig ---- //
// game_config.json 是一个数组，每条是一个 ConfigEntry
interface ConfigEntry {
  id: number
  name: string
  value: unknown
  note?: string
}

// ── 运行时类型校验（防止 JSON 配置错误静默转为 NaN）────────────

function validateCombatRuntime(v: unknown): void {
  const loc = '[DataLoader] combat_runtime'
  if (!v || typeof v !== 'object') throw new Error(`${loc}: 不是对象`)
  const r = v as Record<string, unknown>
  const required = [
    'tickMs', 'fatigueStartMs', 'fatigueTickMs', 'fatigueBaseValue',
    'fatigueDoubleEveryMs', 'critMultiplier',
    'burnTickMs', 'poisonTickMs', 'regenTickMs',
    'burnShieldFactor', 'burnDecayPct', 'healCleansePct',
    'maxPendingHits', 'maxPendingItemFires', 'maxPendingChargePulses', 'maxPendingAmmoRefills',
    'fxDegradeProjectileScaleL1', 'fxDegradeProjectileScaleL2',
    'fxDegradeFloatingScaleL1', 'fxDegradeFloatingScaleL2',
    'fxDegradeActiveScaleL1', 'fxDegradeActiveScaleL2',
    'memoryMonitorSampleMs', 'memoryMonitorEscalateSamples', 'memoryMonitorRecoverSamples',
    'memoryMonitorHighPendingRatio', 'memoryMonitorRecoverPendingRatio',
    'memoryMonitorHighFxRatio', 'memoryMonitorRecoverFxRatio',
    'memoryMonitorHighHeapMb', 'memoryMonitorRecoverHeapMb',
  ]
  const bad = required.filter(k => typeof r[k] !== 'number' || !Number.isFinite(r[k] as number))
  if (bad.length > 0) throw new Error(`${loc}: 缺少或非法字段 [${bad.join(', ')}]`)
}

function validateSkillSystem(v: unknown): void {
  if (v == null) return  // optional 字段，未配置时跳过
  const loc = '[DataLoader] skill_system'
  if (typeof v !== 'object') throw new Error(`${loc}: 不是对象`)
  const r = v as Record<string, unknown>
  const pools = r.pools as Record<string, unknown> | undefined
  if (!pools || typeof pools !== 'object') throw new Error(`${loc}: 缺少 pools 字段`)
  for (const tier of ['bronze', 'silver', 'gold'] as const) {
    const pool = (pools as Record<string, unknown>)[tier]
    if (!Array.isArray(pool) || pool.length === 0) {
      throw new Error(`${loc}: pools.${tier} 为空或不是数组`)
    }
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i] as Record<string, unknown> | null
      if (!item?.id || !item?.archetype) {
        throw new Error(`${loc}: pools.${tier}[${i}] 缺少 id 或 archetype`)
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────

function extractConfig(entries: ConfigEntry[]): GameConfig {
  const get = <T>(name: string): T => {
    const entry = entries.find(e => e.name === name)
    if (!entry) throw new Error(`[DataLoader] Missing config key: ${name}`)
    return entry.value as T
  }
  const getOptional = <T>(name: string): T | undefined => {
    const entry = entries.find(e => e.name === name)
    return entry ? (entry.value as T) : undefined
  }

  const cfg = {
    dailyGold:          get<number>('daily_gold'),
    dailyGoldByDay:     getOptional<number[]>('daily_gold_by_day'),
    shopRefreshPrices:  get<number[]>('shop_refresh_prices'),
    dailyBattleSlots:   get<number[]>('daily_battle_area_slots'),
    backpackSlots:      get<number>('backpack_slots'),
    dailyHealth:        get<number[]>('daily_health'),
    dailyEnemyHealth:   getOptional<number[]>('daily_enemy_health'),
    dailyPlayerHealth:  getOptional<number[]>('daily_player_health'),
    sellPriceRatio:     get<number>('sell_price_ratio'),
    smallItemPrices:    get<number[]>('small_item_prices'),
    mediumItemPrices:   get<number[]>('medium_item_prices'),
    largeItemPrices:    get<number[]>('large_item_prices'),
    sellMinDaysByRarity:get<number[]>('sell_min_days_by_rarity'),
    itemVisualScale:    get<number>('item_visual_scale'),
    shopTierChancesByDay:getOptional<number[][]>('shop_tier_chances_by_day') ?? [[100, 0, 0, 0]],
    gameplayModeValues: getOptional<GameConfig['gameplayModeValues']>('gameplay_mode_values'),
    runRules:           getOptional<GameConfig['runRules']>('run_rules'),
    skillSystem:        getOptional<GameConfig['skillSystem']>('skill_system'),
    eventSystem:        getOptional<GameConfig['eventSystem']>('event_system'),
    shopRules:          getOptional<GameConfig['shopRules']>('shop_rules'),
    textSizes:          get<GameConfig['textSizes']>('text_sizes'),
    combatRuntime:      get<GameConfig['combatRuntime']>('combat_runtime'),
    pvpRules:           getOptional<GameConfig['pvpRules']>('pvp_rules'),
  }

  validateCombatRuntime(cfg.combatRuntime)
  validateSkillSystem(cfg.skillSystem)

  return cfg
}

// ---- 导出 ---- //
let _config: GameConfig | null = null
let _items:  ItemDef[]  | null = null

// ---- Items normalize ---- //
function toSafeString(v: unknown): string {
  if (typeof v === 'string') return v
  if (v == null) return ''
  return String(v)
}

function toNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const m = v.match(/-?\d+(?:\.\d+)?/)
    if (m) {
      const n = Number(m[0])
      if (Number.isFinite(n)) return n
    }
  }
  return fallback
}

function parseFirstTier(series: string): number {
  // "5/10/15/20" -> 5
  const first = series.split('/')[0]?.trim() ?? ''
  const n = Number(first)
  return Number.isFinite(n) ? n : 0
}

function deriveStatsFromSkills(skills: Array<{ cn: string }>): {
  damage?: number
  heal?: number
  shield?: number
  multicast?: number
  burn?: number
  poison?: number
  regen?: number
} {
  const text = skills.map(s => s.cn).filter(Boolean).join('\n')
  const out: {
    damage?: number
    heal?: number
    shield?: number
    multicast?: number
    burn?: number
    poison?: number
    regen?: number
  } = {}

  const dmg = text.match(/造成\s*([0-9]+(?:\/[0-9]+){0,3})\s*伤害/)
  if (dmg?.[1]) out.damage = parseFirstTier(dmg[1])

  const heal = text.match(/(?:治疗|回复)\s*([0-9]+(?:\/[0-9]+){0,3})/)
  if (heal?.[1]) out.heal = parseFirstTier(heal[1])

  const shield = text.match(/(?:获得|提供)\s*([0-9]+(?:\/[0-9]+){0,3})\s*护盾/)
  if (shield?.[1]) out.shield = parseFirstTier(shield[1])

  const mc = text.match(/触发\s*(\d+)\s*次/)
  if (mc?.[1]) {
    const n = Number(mc[1])
    if (Number.isFinite(n) && n >= 1) out.multicast = Math.round(n)
  }

  const burn = text.match(/(?:造成|附加|获得)?\s*([0-9]+(?:\/[0-9]+){0,3})\s*灼烧/)
  if (burn?.[1]) out.burn = parseFirstTier(burn[1])

  const poison = text.match(/(?:造成|附加|获得)?\s*([0-9]+(?:\/[0-9]+){0,3})\s*(?:剧毒|中毒)/)
  if (poison?.[1]) out.poison = parseFirstTier(poison[1])

  const regen = text.match(/(?:获得|提供)\s*([0-9]+(?:\/[0-9]+){0,3})\s*(?:再生|生命回复)/)
  if (regen?.[1]) out.regen = parseFirstTier(regen[1])

  return out
}

function normalizeItem(raw: unknown): ItemDef | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const id = toSafeString(r.id).trim()
  const size = toSafeString(r.size).trim()
  const nameCn = toSafeString(r.name_cn).trim()
  if (!id || !size || !nameCn) return null

  // 约束为已知三种尺寸（避免后续 normalizeSize 抛错）
  if (size !== 'Small / 小型' && size !== 'Medium / 中型' && size !== 'Large / 大型') return null
  const sizeRaw = size as ItemDef['size']

  const rawSkills = Array.isArray(r.skills) ? r.skills : []
  const skills = rawSkills.map((s: any) => ({
    en: toSafeString(s?.en),
    cn: toSafeString(s?.cn),
  }))
  const derived = deriveStatsFromSkills(skills)

  const enchantments = (r.enchantments && typeof r.enchantments === 'object')
    ? (r.enchantments as ItemDef['enchantments'])
    : {}

  return {
    id,
    name_en: toSafeString(r.name_en).trim(),
    name_cn: nameCn,
    type: toSafeString(r.type).trim(),
    size: sizeRaw,
    starting_tier: toSafeString(r.starting_tier).trim(),
    available_tiers: toSafeString(r.available_tiers).trim(),
    heroes: toSafeString(r.heroes).trim(),
    tags: toSafeString(r.tags).trim(),
    hidden_tags: toSafeString(r.hidden_tags).trim(),
    icon: toSafeString(r.icon).trim(),
    attack_style: toSafeString(r.attack_style).trim(),
    attack_variants: Array.isArray(r.attack_variants)
      ? r.attack_variants.map(v => toSafeString(v).trim()).filter(Boolean)
      : [],

    cooldown: Math.max(0, toNumber(r.cooldown, 0)),
    cooldown_tiers: toSafeString(r.cooldown_tiers).trim(),
    damage: Math.max(0, toNumber(r.damage, derived.damage ?? 0)),
    heal: Math.max(0, toNumber(r.heal, derived.heal ?? 0)),
    shield: Math.max(0, toNumber(r.shield, derived.shield ?? 0)),
    ammo: Math.max(0, toNumber(r.ammo, 0)),
    crit: Math.max(0, toNumber(r.crit, 0)),
    multicast: Math.max(1, Math.round(toNumber(r.multicast, derived.multicast ?? 1))),
    burn: Math.max(0, toNumber(r.burn, derived.burn ?? 0)),
    poison: Math.max(0, toNumber(r.poison, derived.poison ?? 0)),
    regen: Math.max(0, toNumber(r.regen, derived.regen ?? 0)),
    lifesteal: Math.max(0, toNumber(r.lifesteal, 0)),

    buy_price: Math.max(0, toNumber(r.buy_price, 0)),
    sell_price: Math.max(0, toNumber(r.sell_price, 0)),

    skills,
    simple_desc: toSafeString(r.simple_desc).trim(),
    simple_desc_tiered: toSafeString(r.simple_desc_tiered).trim(),
    enchantments,
  }
}

export function getConfig(): GameConfig {
  if (!_config) _config = extractConfig(rawConfig as ConfigEntry[])
  return _config
}

export function getAllItems(): ItemDef[] {
  if (!_items) {
    const all = rawItems as unknown as unknown[]
    const out: ItemDef[] = []
    for (const raw of all) {
      const it = normalizeItem(raw)
      if (!it) continue
      // 过滤模板占位符（旧库：name_en 含方括号）
      if (it.name_en.startsWith('[')) continue
      out.push(it)
    }
    _items = out
  }
  return _items
}

/** 按 Hero 筛选（Demo 阶段只有 Vanessa） */
export function getItemsByHero(hero: string): ItemDef[] {
  return getAllItems().filter(item =>
    item.heroes.toLowerCase().includes(hero.toLowerCase())
  )
}

/** 验证数据完整性，返回报告字符串 */
export function validateData(): { ok: boolean; report: string } {
  const lines: string[] = []
  let ok = true

  try {
    const cfg = getConfig()
    lines.push(`✅ game_config.json 读取成功`)
    lines.push(`   - dailyGold: ${cfg.dailyGold}`)
    lines.push(`   - backpackSlots: ${cfg.backpackSlots}`)
    lines.push(`   - dailyBattleSlots: [${cfg.dailyBattleSlots.join(',')}]`)
    lines.push(`   - shopRefreshPrices: ${cfg.shopRefreshPrices.length} tiers`)
    lines.push(`   - sellPriceRatio: ${cfg.sellPriceRatio}`)
  } catch (e) {
    lines.push(`❌ game_config.json 错误: ${e}`)
    ok = false
  }

  try {
    const items = getAllItems()
    lines.push(`✅ vanessa_items.json 读取成功`)
    lines.push(`   - 总物品数: ${items.length}`)

    const sizes = { '1x1': 0, '2x1': 0, '3x1': 0, other: 0 }
    for (const item of items) {
      const s = item.size.toLowerCase()
      if      (s.includes('small'))  sizes['1x1']++
      else if (s.includes('medium')) sizes['2x1']++
      else if (s.includes('large'))  sizes['3x1']++
      else                           sizes['other']++
    }
    lines.push(`   - 小型(1x1): ${sizes['1x1']}  中型(2x1): ${sizes['2x1']}  大型(3x1): ${sizes['3x1']}`)

    // 检查必填字段
    const missing = items.filter(i => !i.id || !i.name_cn || !i.size)
    if (missing.length > 0) {
      lines.push(`⚠️  有 ${missing.length} 个物品缺少必填字段 (id/name_cn/size)`)
    } else {
      lines.push(`✅ 所有物品必填字段完整`)
    }
  } catch (e) {
    lines.push(`❌ vanessa_items.json 错误: ${e}`)
    ok = false
  }

  return { ok, report: lines.join('\n') }
}
