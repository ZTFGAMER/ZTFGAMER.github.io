// ============================================================
// SynthesisLogic — 合成邏輯純函數模塊
// ============================================================
// 職責：
//   - 合成配對校驗（canSynthesizePair / canUseLv7MorphSynthesis）
//   - 品質/等級計算（nextTierLevel / tierStarLevelIndex 等）
//   - 合成結果隨機選取（pickSynthesisResultWithGuarantee）
//   - 物品查找/分類工具（getItemDefById / isNeutralItemDef 等）
// 全部為純函數，不依賴 ctx，可直接接收參數調用。
// ============================================================

import { getConfig, getAllItems } from '@/core/DataLoader'
import type { ItemDef, SkillArchetype } from '@/common/items/ItemDef'
import type { TierKey } from '@/shop/ShopManager'

// ============================================================
// 常量
// ============================================================

export const TIER_ORDER: TierKey[] = ['Bronze', 'Silver', 'Gold', 'Diamond']

/** 中立職業標籤（中文） */
export const NEUTRAL_TAG_CN = '中立'

// ============================================================
// 物品工具函數
// ============================================================

export function getItemDefById(defId: string): ItemDef | undefined {
  return getAllItems().find((it) => it.id === defId)
}

/** 從 tags 字符串中提取主要 archetype 標識（取第一個 | 的第一個 / 段） */
export function getPrimaryArchetype(rawTags: string): string {
  const first = String(rawTags || '').split('|')[0]?.trim() ?? ''
  return first.split('/')[0]?.trim() ?? ''
}

export function toSkillArchetype(raw: string): SkillArchetype | null {
  const key = String(raw || '').trim().toLowerCase()
  if (key === 'warrior'  || key === '战士') return 'warrior'
  if (key === 'archer'   || key === '弓手') return 'archer'
  if (key === 'assassin' || key === '刺客') return 'assassin'
  if (key === 'utility'  || key === '通用') return 'utility'
  return null
}

export function isNeutralArchetypeKey(raw: string): boolean {
  const key = String(raw || '').trim()
  return key === NEUTRAL_TAG_CN || key.toLowerCase() === 'neutral'
}

export function isNeutralItemDef(item?: ItemDef | null): boolean {
  if (!item) return false
  return isNeutralArchetypeKey(getPrimaryArchetype(item.tags))
}

// ============================================================
// Tier 工具函數
// ============================================================

export function parseTierName(raw: string): TierKey | null {
  if (raw.includes('Bronze'))  return 'Bronze'
  if (raw.includes('Silver'))  return 'Silver'
  if (raw.includes('Gold'))    return 'Gold'
  if (raw.includes('Diamond')) return 'Diamond'
  return null
}

export function maxStarForTier(tier: TierKey): 1 | 2 {
  return tier === 'Bronze' ? 1 : 2
}

export function normalizeTierStar(tier: TierKey, star?: number): 1 | 2 {
  const max   = maxStarForTier(tier)
  const value = Number.isFinite(star) ? Math.round(star as number) : 1
  if (value <= 1) return 1
  return max
}

export function isLv7TierStar(tier: TierKey, star: 1 | 2): boolean {
  return tier === 'Diamond' && normalizeTierStar(tier, star) === 2
}

export function nextTierLevel(tier: TierKey, star: 1 | 2): { tier: TierKey; star: 1 | 2 } | null {
  if (tier === 'Diamond') {
    const s = normalizeTierStar(tier, star)
    return s < maxStarForTier(tier) ? { tier, star: 2 } : null
  }
  if (star < maxStarForTier(tier)) return { tier, star: 2 }
  const idx = TIER_ORDER.indexOf(tier)
  if (idx < 0 || idx >= TIER_ORDER.length - 1) return null
  const next = TIER_ORDER[idx + 1] ?? null
  if (!next) return null
  return { tier: next, star: 1 }
}

export function tierStarLevelIndex(tier: TierKey, star: 1 | 2): number {
  const s = normalizeTierStar(tier, star)
  if (tier === 'Bronze')                return 0
  if (tier === 'Silver'  && s === 1)    return 1
  if (tier === 'Silver'  && s === 2)    return 2
  if (tier === 'Gold'    && s === 1)    return 3
  if (tier === 'Gold'    && s === 2)    return 4
  if (tier === 'Diamond' && s === 1)    return 5
  return 6
}

// ============================================================
// 合成配對校驗
// ============================================================

export function canSynthesizePair(
  sourceDefId: string,
  targetDefId: string,
  sourceTier: TierKey,
  sourceStar: 1 | 2,
  targetTier: TierKey,
  targetStar: 1 | 2,
): boolean {
  const sourceDef = getItemDefById(sourceDefId)
  const targetDef = getItemDefById(targetDefId)
  if (!sourceDef || !targetDef) return false
  if (isNeutralItemDef(sourceDef) || isNeutralItemDef(targetDef)) return false
  if (sourceTier !== targetTier || sourceStar !== targetStar) return false
  if (!nextTierLevel(sourceTier, sourceStar)) {
    return canUseLv7MorphSynthesis(sourceDefId, targetDefId, sourceTier, sourceStar, targetTier, targetStar)
  }
  if (sourceDefId === targetDefId) return true
  const sourceArch = getPrimaryArchetype(sourceDef.tags)
  const targetArch = getPrimaryArchetype(targetDef.tags)
  if (!sourceArch || !targetArch) return false
  return sourceArch === targetArch
}

export function canUseLv7MorphSynthesis(
  sourceDefId: string,
  targetDefId: string,
  sourceTier: TierKey,
  sourceStar: 1 | 2,
  targetTier: TierKey,
  targetStar: 1 | 2,
): boolean {
  if (!isLv7TierStar(sourceTier, sourceStar) || !isLv7TierStar(targetTier, targetStar)) return false
  const sourceDef = getItemDefById(sourceDefId)
  const targetDef = getItemDefById(targetDefId)
  if (!sourceDef || !targetDef) return false
  if (isNeutralItemDef(sourceDef) || isNeutralItemDef(targetDef)) return false
  if (sourceDefId === targetDefId) return true
  const sourceArch = toSkillArchetype(getPrimaryArchetype(sourceDef.tags))
  const targetArch = toSkillArchetype(getPrimaryArchetype(targetDef.tags))
  if (sourceArch !== 'warrior' && sourceArch !== 'archer' && sourceArch !== 'assassin') return false
  if (targetArch !== 'warrior' && targetArch !== 'archer' && targetArch !== 'assassin') return false
  return sourceArch === targetArch
}

// ============================================================
// 合成結果隨機選取
// ============================================================

export function getMinTierDropWeight(item: ItemDef, resultTier: TierKey, resultStar: 1 | 2): number {
  const cfg = getConfig().shopRules?.synthesisMinTierDropWeightsByResultLevel
    ?? getConfig().shopRules?.minTierDropWeightsByResultLevel
  if (!cfg) return 1
  const minTier = parseTierName(item.starting_tier) ?? 'Bronze'
  const list = (cfg as Record<string, number[]>)[minTier]
  if (!Array.isArray(list) || list.length <= 0) return 1
  const idx = tierStarLevelIndex(resultTier, resultStar)
  const raw = list[idx]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1
  return Math.max(0, raw)
}

export function pickItemByMinTierWeight(
  candidates: ItemDef[],
  resultTier: TierKey,
  resultStar: 1 | 2,
): ItemDef | null {
  if (candidates.length <= 0) return null
  let total = 0
  const ws = candidates.map((it) => {
    const w = getMinTierDropWeight(it, resultTier, resultStar)
    total += w
    return w
  })
  if (total <= 0) return candidates[Math.floor(Math.random() * candidates.length)] ?? null
  let r = Math.random() * total
  for (let i = 0; i < candidates.length; i++) {
    r -= ws[i] ?? 0
    if (r <= 0) return candidates[i] ?? null
  }
  return candidates[candidates.length - 1] ?? null
}

export function pickSynthesisResultWithGuarantee(
  candidates: ItemDef[],
  resultTier: TierKey,
  resultStar: 1 | 2,
): ItemDef | null {
  return pickItemByMinTierWeight(candidates, resultTier, resultStar)
}
