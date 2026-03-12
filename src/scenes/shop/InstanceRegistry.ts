// ============================================================
// InstanceRegistry — 物品實例元數據倉庫
// ============================================================
// 職責：
//   - 維護所有 instanceTo* 映射（defId / quality / level / tier / tierStar / permanentDamageBonus）
//   - 提供 instCounter / nextId 計數器
//   - 提供訪問 / 修改 / 清理函數
// 無 ctx 依賴，可被 ShopScene、ShopStateStorage 等直接 import。
// ============================================================

import type { TierKey } from '@/shop/ShopManager'
import {
  normalizeTierStar, parseTierName, getItemDefById,
} from './SynthesisLogic'
import {
  clampLevel as _PSU_clampLevel,
  getQualityLevelRange as _PSU_getQualityLevelRange,
  levelFromLegacyTierStar as _PSU_levelFromLegacyTierStar,
} from './PlayerStatusUI'
import { levelToTierStar as _QBS_levelToTierStar } from './QuickBuySystem'

// ============================================================
// 計數器
// ============================================================

export let instCounter = 1

export function nextId(): string {
  return `inst-${instCounter++}`
}

export function setInstCounter(value: number): void {
  instCounter = value
}

// ============================================================
// 實例元數據映射
// ============================================================

export const instanceToDefId = new Map<string, string>()
export const instanceToQuality = new Map<string, TierKey>()
export const instanceToLevel = new Map<string, 1 | 2 | 3 | 4 | 5 | 6 | 7>()
export const instanceToTier = new Map<string, TierKey>()
export const instanceToTierStar = new Map<string, 1 | 2>()
export const instanceToPermanentDamageBonus = new Map<string, number>()

// ============================================================
// 工具函數（本地 shim，避免重複引用）
// ============================================================

function clampLevel(level: number): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return _PSU_clampLevel(level)
}

function getQualityLevelRange(quality: TierKey): { min: 1 | 2 | 3 | 4 | 5 | 6 | 7; max: 1 | 2 | 3 | 4 | 5 | 6 | 7 } {
  return _PSU_getQualityLevelRange(quality)
}

export function levelFromLegacyTierStar(tier: TierKey, star: 1 | 2): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return _PSU_levelFromLegacyTierStar(tier, star)
}

function levelToTierStar(level: number): { tier: TierKey; star: 1 | 2 } | null {
  return _QBS_levelToTierStar(level)
}

// ============================================================
// defId 派生輔助
// ============================================================

export function deriveQualityByDefId(defId: string): TierKey {
  const def = getItemDefById(defId)
  return parseTierName(def?.starting_tier ?? 'Bronze') ?? 'Bronze'
}

// ============================================================
// 批量清理
// ============================================================

export function removeInstanceMeta(instanceId: string): void {
  instanceToDefId.delete(instanceId)
  instanceToQuality.delete(instanceId)
  instanceToLevel.delete(instanceId)
  instanceToTier.delete(instanceId)
  instanceToTierStar.delete(instanceId)
  instanceToPermanentDamageBonus.delete(instanceId)
}

export function clearAllInstanceMaps(): void {
  instanceToDefId.clear()
  instanceToQuality.clear()
  instanceToLevel.clear()
  instanceToTier.clear()
  instanceToTierStar.clear()
  instanceToPermanentDamageBonus.clear()
}

// ============================================================
// Quality / Level 讀寫
// ============================================================

export function setInstanceQualityLevel(
  instanceId: string,
  defId: string,
  quality?: TierKey,
  level?: number,
): void {
  const q = quality ?? deriveQualityByDefId(defId)
  const range = getQualityLevelRange(q)
  const lv = clampLevel(level ?? range.min)
  const boundedLevel = Math.max(range.min, Math.min(range.max, lv)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  instanceToQuality.set(instanceId, q)
  instanceToLevel.set(instanceId, boundedLevel)
  const legacy = levelToTierStar(boundedLevel)
  if (legacy) {
    instanceToTier.set(instanceId, legacy.tier)
    instanceToTierStar.set(instanceId, legacy.star)
  }
}

export function getInstanceQuality(instanceId: string): TierKey {
  const q = instanceToQuality.get(instanceId)
  if (q) return q
  const defId = instanceToDefId.get(instanceId)
  if (!defId) return 'Bronze'
  const derived = deriveQualityByDefId(defId)
  instanceToQuality.set(instanceId, derived)
  return derived
}

export function getInstanceLevel(instanceId: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const lv = instanceToLevel.get(instanceId)
  if (lv) return lv
  const legacyTier = instanceToTier.get(instanceId) ?? 'Bronze'
  const legacyStar = normalizeTierStar(legacyTier, instanceToTierStar.get(instanceId))
  const migrated = levelFromLegacyTierStar(legacyTier, legacyStar)
  instanceToLevel.set(instanceId, migrated)
  return migrated
}

// ============================================================
// Tier / TierStar（由 level 派生，通過 levelToTierStar 計算）
// ============================================================

export function getInstanceTier(instanceId: string): TierKey | undefined {
  const level = getInstanceLevel(instanceId)
  const legacy = levelToTierStar(level)
  return legacy?.tier
}

export function getInstanceTierStar(instanceId: string): 1 | 2 {
  const level = getInstanceLevel(instanceId)
  const legacy = levelToTierStar(level)
  return legacy?.star ?? 1
}
