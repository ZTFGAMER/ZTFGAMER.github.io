// ============================================================
// DataLoader — 加载并类型化 JSON 配置
// 所有数值从配置文件读取，无硬编码魔法数字
// ============================================================

import type { GameConfig, ItemDef } from '@/items/ItemDef'

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

function extractConfig(entries: ConfigEntry[]): GameConfig {
  const get = <T>(name: string): T => {
    const entry = entries.find(e => e.name === name)
    if (!entry) throw new Error(`[DataLoader] Missing config key: ${name}`)
    return entry.value as T
  }

  return {
    dailyGold:          get<number>('daily_gold'),
    shopRefreshPrices:  get<number[]>('shop_refresh_prices'),
    dailyBattleSlots:   get<number[]>('daily_battle_area_slots'),
    backpackSlots:      get<number>('backpack_slots'),
    dailyHealth:        get<number[]>('daily_health'),
    sellPriceRatio:     get<number>('sell_price_ratio'),
    smallItemPrices:    get<number[]>('small_item_prices'),
    mediumItemPrices:   get<number[]>('medium_item_prices'),
    largeItemPrices:    get<number[]>('large_item_prices'),
    sellMinDaysByRarity:get<number[]>('sell_min_days_by_rarity'),
    itemVisualScale:    get<number>('item_visual_scale'),
    shopTierChancesByDay:get<number[][]>('shop_tier_chances_by_day'),
    textSizes:          get<GameConfig['textSizes']>('text_sizes'),
    combatRuntime:      get<GameConfig['combatRuntime']>('combat_runtime'),
  }
}

// ---- 导出 ---- //
let _config: GameConfig | null = null
let _items:  ItemDef[]  | null = null

export function getConfig(): GameConfig {
  if (!_config) _config = extractConfig(rawConfig as ConfigEntry[])
  return _config
}

export function getAllItems(): ItemDef[] {
  if (!_items) {
    const all = rawItems as unknown as ItemDef[]
    // 过滤模板占位符（name_en 含方括号）和缺少中文名的残缺数据
    _items = all.filter(item =>
      item.id &&
      item.size &&
      !item.name_en.startsWith('[') &&
      item.name_en.trim() !== '' &&
      item.name_cn.trim() !== ''
    )
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
