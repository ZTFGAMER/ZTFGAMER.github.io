// ============================================================
// ShopModeHelpers — 商店显示模式与输入状态辅助
// ============================================================

import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { PhaseManager } from '@/core/PhaseManager'
import type { ItemInfoMode } from '@/common/ui/SellPopup'
import type { ShopSceneCtx } from './ShopSceneContext'

// ── 显示模式：简洁 / 详细 ─────────────────────────────────────

export function shouldShowSimpleDescriptions(): boolean {
  return getDebugCfg('gameplayShowSimpleDescriptions') >= 0.5
}

export function isSkillDraftRerollEnabled(): boolean {
  return getDebugCfg('gameplaySkillDraftRerollEnabled') >= 0.5
}

export function isEventDraftRerollEnabled(): boolean {
  return getDebugCfg('gameplayEventDraftRerollEnabled') >= 0.5
}

export function getDefaultItemInfoMode(): ItemInfoMode {
  return shouldShowSimpleDescriptions() ? 'simple' : 'detailed'
}

export function getDefaultSkillDetailMode(): 'simple' | 'detailed' {
  return shouldShowSimpleDescriptions() ? 'simple' : 'detailed'
}

export function resetInfoModeSelection(ctx: ShopSceneCtx): void {
  ctx.selectedInfoKey = null
  ctx.selectedInfoMode = getDefaultItemInfoMode()
}

export function resolveInfoMode(nextKey: string, ctx: ShopSceneCtx): ItemInfoMode {
  if (!shouldShowSimpleDescriptions()) {
    ctx.selectedInfoKey = nextKey
    ctx.selectedInfoMode = 'detailed'
    return 'detailed'
  }
  if (!ctx.sellPopup?.visible) {
    ctx.selectedInfoKey = nextKey
    ctx.selectedInfoMode = 'simple'
    return ctx.selectedInfoMode
  }
  if (ctx.selectedInfoKey === nextKey) {
    ctx.selectedInfoMode = ctx.selectedInfoMode === 'simple' ? 'detailed' : 'simple'
  } else {
    ctx.selectedInfoKey = nextKey
    ctx.selectedInfoMode = 'simple'
  }
  return ctx.selectedInfoMode
}

// ── 输入状态 ───────────────────────────────────────────────────

export function isShopInputEnabled(ctx: ShopSceneCtx): boolean {
  if (ctx.pvpReadyLocked) return false
  return PhaseManager.isShopInputEnabled()
}
