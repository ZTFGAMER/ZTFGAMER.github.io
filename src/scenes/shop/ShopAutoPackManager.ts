// ============================================================
// ShopAutoPackManager — 背包自动整理 / AutoPack 逻辑
// ============================================================

import { planAutoPack, type PackItem, type PackPlacement } from '@/grid/AutoPack'
import type { ItemSizeNorm } from '@/grid/GridSystem'
import { CELL_SIZE, CELL_HEIGHT } from '@/grid/GridZone'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { getInstanceTier, getInstanceTierStar } from './InstanceRegistry'
import { toVisualTier } from './ShopMathHelpers'
import {
  playBackpackTransferMiniAnim,
  type BackpackTransferAnimSeed,
} from './AnimationEffects'
import type { ShopSceneCtx } from './ShopSceneContext'

// ── 模块级缓存（不属于 ctx，生命周期跟随模块）──────────────────

const BACKPACK_INCOMING_TMP_ID = '__backpack_incoming__'

type AutoPackCacheEntry = {
  atMs: number
  plan: PackPlacement[] | null
}

const autoPackPlanCache = new Map<string, AutoPackCacheEntry>()
const AUTO_PACK_CACHE_LIMIT = 80

export type BackpackAutoPackPlan = {
  existing: PackPlacement[]
  incoming: { col: number; row: number }
}

// ── 缓存管理 ──────────────────────────────────────────────────

export function clearAutoPackCache(): void {
  autoPackPlanCache.clear()
}

export function clonePackPlan(plan: PackPlacement[] | null): PackPlacement[] | null {
  if (!plan) return null
  return plan.map((p) => ({ ...p }))
}

function compactAutoPackCache(): void {
  if (autoPackPlanCache.size <= AUTO_PACK_CACHE_LIMIT) return
  const entries = Array.from(autoPackPlanCache.entries())
  entries.sort((a, b) => a[1].atMs - b[1].atMs)
  const removeCount = autoPackPlanCache.size - AUTO_PACK_CACHE_LIMIT
  for (let i = 0; i < removeCount; i++) {
    const key = entries[i]?.[0]
    if (key) autoPackPlanCache.delete(key)
  }
}

export function getBackpackStateSignature(ctx: ShopSceneCtx): string {
  if (!ctx.backpackSystem || !ctx.backpackView) return 'none'
  const items = ctx.backpackSystem
    .getAllItems()
    .map((it) => `${it.instanceId}@${it.defId}@${it.size}@${it.col},${it.row}`)
    .sort()
  return `ac${ctx.backpackView.activeColCount}|rows${ctx.backpackSystem.rows}|${items.join(';')}`
}

export function getAutoPackPlanCached(cacheKey: string, build: () => PackPlacement[] | null): PackPlacement[] | null {
  const now = Date.now()
  const throttleMs = getDebugCfg('autoPackThrottleMs')
  const hit = autoPackPlanCache.get(cacheKey)
  if (hit && now - hit.atMs <= throttleMs) {
    hit.atMs = now
    return clonePackPlan(hit.plan)
  }
  const plan = build()
  autoPackPlanCache.set(cacheKey, { atMs: now, plan: clonePackPlan(plan) })
  compactAutoPackCache()
  return clonePackPlan(plan)
}

// ── AutoPack 计划构建 ──────────────────────────────────────────

export function buildBackpackAutoPackPlan(incomingDefId: string, incomingSize: ItemSizeNorm, ctx: ShopSceneCtx): BackpackAutoPackPlan | null {
  if (!ctx.backpackSystem || !ctx.backpackView) return null
  const bpSystem = ctx.backpackSystem
  const bpView = ctx.backpackView
  const signature = getBackpackStateSignature(ctx)
  const cacheKey = `incoming|${signature}|${incomingDefId}|${incomingSize}`
  const items: PackItem[] = bpSystem.getAllItems().map(item => ({
    instanceId: item.instanceId,
    defId: item.defId,
    size: item.size,
    preferredCol: item.col,
    preferredRow: item.row,
  }))
  items.push({
    instanceId: BACKPACK_INCOMING_TMP_ID,
    defId: incomingDefId,
    size: incomingSize,
  })
  const plan = getAutoPackPlanCached(cacheKey, () => planAutoPack(items, bpView.activeColCount, bpSystem.rows))
  if (!plan) return null
  const incoming = plan.find(p => p.instanceId === BACKPACK_INCOMING_TMP_ID)
  if (!incoming) return null
  return {
    existing: plan.filter(p => p.instanceId !== BACKPACK_INCOMING_TMP_ID),
    incoming: { col: incoming.col, row: incoming.row },
  }
}

export function applyBackpackAutoPackExisting(existingPlan: PackPlacement[], ctx: ShopSceneCtx): void {
  if (!ctx.backpackSystem || !ctx.backpackView) return
  clearAutoPackCache()
  const oldItems = ctx.backpackSystem.getAllItems()
  const oldById = new Map(oldItems.map(item => [item.instanceId, item] as const))

  ctx.backpackSystem.clear()
  for (const p of existingPlan) {
    ctx.backpackSystem.place(p.col, p.row, p.size, p.defId, p.instanceId)
  }

  const moveMs = getDebugCfg('squeezeMs')
  for (const p of existingPlan) {
    const old = oldById.get(p.instanceId)
    if (!old) {
      const tier = getInstanceTier(p.instanceId)
      const star = getInstanceTierStar(p.instanceId)
      ctx.backpackView.addItem(p.instanceId, p.defId, p.size, p.col, p.row, toVisualTier(tier, star)).then(() => {
        ctx.backpackView!.setItemTier(p.instanceId, toVisualTier(tier, star))
        ctx.drag?.refreshZone(ctx.backpackView!)
      })
      continue
    }
    if (old.col !== p.col || old.row !== p.row) {
      ctx.backpackView.animateToCell(p.instanceId, p.col, p.row, moveMs)
    }
  }
  ctx.drag?.refreshZone(ctx.backpackView)
}

export function canBackpackAcceptByAutoPack(incomingDefId: string, incomingSize: ItemSizeNorm, ctx: ShopSceneCtx): boolean {
  return buildBackpackAutoPackPlan(incomingDefId, incomingSize, ctx) !== null
}

export function getOverlapBlockersInBattle(col: number, row: number, size: ItemSizeNorm, ctx: ShopSceneCtx): Array<{ instanceId: string; defId: string; size: ItemSizeNorm }> {
  if (!ctx.battleSystem) return []
  const w = size === '1x1' ? 1 : size === '2x1' ? 2 : 3
  const h = 1
  const blockers = new Set<string>()
  for (let c = col; c < col + w; c++) {
    for (let r = row; r < row + h; r++) {
      for (const it of ctx.battleSystem.getAllItems()) {
        const iw = it.size === '1x1' ? 1 : it.size === '2x1' ? 2 : 3
        const ih = 1
        const hit = c >= it.col && c < it.col + iw && r >= it.row && r < it.row + ih
        if (hit) blockers.add(it.instanceId)
      }
    }
  }
  return Array.from(blockers).map((id) => {
    const it = ctx.battleSystem!.getItem(id)!
    return { instanceId: id, defId: it.defId, size: it.size }
  })
}

export function buildBackpackPlanForTransferred(
  itemsToTransfer: Array<{ instanceId: string; defId: string; size: ItemSizeNorm }>,
  ctx: ShopSceneCtx,
): PackPlacement[] | null {
  if (!ctx.backpackSystem || !ctx.backpackView) return null
  const bpSystem = ctx.backpackSystem
  const bpView = ctx.backpackView
  const signature = getBackpackStateSignature(ctx)
  const transferSig = itemsToTransfer
    .map((it) => `${it.instanceId}@${it.defId}@${it.size}`)
    .sort()
    .join(';')
  const cacheKey = `transfer|${signature}|${transferSig}`
  const base: PackItem[] = bpSystem.getAllItems().map((it) => ({
    instanceId: it.instanceId,
    defId: it.defId,
    size: it.size,
    preferredCol: it.col,
    preferredRow: it.row,
  }))
  for (const tr of itemsToTransfer) {
    if (base.some((b) => b.instanceId === tr.instanceId)) continue
    base.push({ instanceId: tr.instanceId, defId: tr.defId, size: tr.size })
  }
  return getAutoPackPlanCached(cacheKey, () => planAutoPack(base, bpView.activeColCount, bpSystem.rows))
}

export function applyBackpackPlanWithTransferred(
  plan: PackPlacement[],
  transferredIds: Set<string>,
  ctx: ShopSceneCtx,
): void {
  if (!ctx.backpackSystem || !ctx.backpackView || !ctx.battleSystem || !ctx.battleView) return
  clearAutoPackCache()

  const transferAnimSeeds: BackpackTransferAnimSeed[] = []
  for (const id of transferredIds) {
    const node = ctx.battleView.getNode(id)
    const placed = ctx.battleSystem.getItem(id)
    const target = plan.find((p) => p.instanceId === id)
    if (!node || !placed || !target) continue
    const w = placed.size === '1x1' ? CELL_SIZE : placed.size === '2x1' ? CELL_SIZE * 2 : CELL_SIZE * 3
    const h = CELL_HEIGHT
    const fromGlobal = ctx.battleView.toGlobal({
      x: node.container.x + w / 2,
      y: node.container.y + h / 2,
    })
    transferAnimSeeds.push({
      defId: placed.defId,
      size: placed.size,
      fromGlobal,
      toCol: target.col,
      toRow: target.row,
    })
  }

  for (const id of transferredIds) {
    ctx.battleSystem.remove(id)
    ctx.battleView.removeItem(id)
  }

  ctx.backpackSystem.clear()
  for (const p of plan) {
    ctx.backpackSystem.place(p.col, p.row, p.size, p.defId, p.instanceId)
  }

  const moveMs = getDebugCfg('squeezeMs')
  for (const p of plan) {
    const tier = getInstanceTier(p.instanceId)
    const star = getInstanceTierStar(p.instanceId)
    if (ctx.backpackView.hasItem(p.instanceId)) {
      ctx.backpackView.animateToCell(p.instanceId, p.col, p.row, moveMs)
      ctx.backpackView.setItemTier(p.instanceId, toVisualTier(tier, star))
    } else {
      ctx.backpackView.addItem(p.instanceId, p.defId, p.size, p.col, p.row, toVisualTier(tier, star)).then(() => {
        ctx.backpackView!.setItemTier(p.instanceId, toVisualTier(tier, star))
        ctx.drag?.refreshZone(ctx.backpackView!)
      })
    }
  }

  ctx.drag?.refreshZone(ctx.backpackView)
  ctx.drag?.refreshZone(ctx.battleView)
  playBackpackTransferMiniAnim(ctx, transferAnimSeeds)
}
