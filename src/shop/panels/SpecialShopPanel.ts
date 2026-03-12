// ============================================================
// SpecialShopPanel — 特殊商店覆蓋層面板
// 從 ShopScene.ts 提取，使用 Class 方式（繼承 Container）
// 包含：
//   openSpecialShopOverlay（主入口，含完整 overlay 建構）
//   closeSpecialShopOverlay
//   ensureSpecialShopSelection
//   openSpecialShopFromNeutralScroll
//   rollSpecialShopOffers 及所有 helper
//   backpack 多選批量出售相關
// ============================================================

import {
  Container, Graphics, Text, Sprite,
  Assets, Texture, Rectangle,
  type FederatedPointerEvent,
} from 'pixi.js'
import { getApp } from '@/core/AppContext'
import { getConfig, getAllItems } from '@/core/DataLoader'
import { getItemIconUrl } from '@/core/AssetPath'
import { getTierColor } from '@/config/colorPalette'
import { resolveItemTierBaseStats } from '@/common/items/ItemTierStats'
import { normalizeSize, type ItemDef, type SkillArchetype } from '@/common/items/ItemDef'
import type { TierKey } from '@/shop/ShopManager'
import type { ShopSceneCtx, SpecialShopOffer, ToastReason } from '../ShopSceneContext'
import {
  parseTierName,
  getPrimaryArchetype,
  toSkillArchetype,
  isNeutralItemDef,
  getItemDefById,
  tierStarLevelIndex,
  getMinTierDropWeight,
} from '../systems/ShopSynthesisLogic'

// ---- 布局常量（CANVAS_W/H 来自 layoutConstants）----
import { CANVAS_W, CANVAS_H } from '@/config/layoutConstants'
const CELL_SIZE = 128

// ============================================================
// 類型定義
// ============================================================

type PoolCandidate = {
  item: ItemDef
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7
  tier: TierKey
  star: 1 | 2
  price: number
}

// ============================================================
// Callbacks interface
// ============================================================

export interface SpecialShopCallbacks {
  captureAndSave: () => void
  clearSelection: () => void
  setTransitionInputEnabled: (enabled: boolean) => void
  setBaseShopPrimaryButtonsVisible: (visible: boolean) => void
  applyPhaseInputLock: () => void
  refreshShopUI: () => void
  refreshPlayerStatusUI: () => void
  showHintToast: (reason: ToastReason, msg: string, color?: number) => void
  checkAndPopPendingRewards: () => void
  getDailyPlanRow: (day: number) => Record<string, unknown> | null
  parseAvailableTiers: (raw: string) => TierKey[]
  getSizeCols: (size: ReturnType<typeof normalizeSize>) => number
  getInstanceTier: (instanceId: string) => TierKey | undefined
  getInstanceTierStar: (instanceId: string) => 1 | 2
  toVisualTier: (tier?: TierKey, star?: 1 | 2) => string | undefined
  removeInstanceMeta: (instanceId: string) => void
  setInstanceQualityLevel: (instanceId: string, defId: string, quality?: TierKey, level?: number) => void
  instanceToDefId: Map<string, string>
  instanceToTier: Map<string, TierKey>
  instanceToPermanentDamageBonus: Map<string, number>
  nextId: () => string
  markShopPurchaseDone: () => void
  recordNeutralItemObtained: (defId: string) => void
  unlockItemToPool: (defId: string) => boolean
  resolveBuyPriceWithSkills: (basePrice: number) => { finalPrice: number; discount: number; freeBySkill30: boolean }
  consumeSkill15NextBuyDiscountAfterSuccess: () => boolean
  consumeSkill30BundleAfterSuccess: (consumedFreeBuy: boolean) => boolean
  canBuyItemUnderFirstPurchaseRule: (item: ItemDef) => boolean
  showFirstPurchaseRuleHint: () => void
  findFirstBattlePlace: (size: ReturnType<typeof normalizeSize>) => { col: number; row: number } | null
  findFirstBackpackPlace: (size: ReturnType<typeof normalizeSize>) => { col: number; row: number } | null
  shouldShowSimpleDescriptions: () => boolean
  addArchetypeCornerBadge: (card: Container, item: ItemDef, cardW: number, iconTopY: number) => void
  ammoValueFromLineByStar: (item: ItemDef, tier: TierKey, star: 1 | 2, line: string) => number
  rewriteNeutralRandomPick: (item: ItemDef) => ItemDef
  canRandomNeutralItem: (item: ItemDef) => boolean
}

// ============================================================
// SpecialShopPanel class
// ============================================================

export class SpecialShopPanel extends Container {
  private ctx: ShopSceneCtx
  private stage: Container
  private cb: SpecialShopCallbacks

  constructor(ctx: ShopSceneCtx, stage: Container, callbacks: SpecialShopCallbacks) {
    super()
    this.ctx = ctx
    this.stage = stage
    this.cb = callbacks
  }

  // ============================================================
  // 公開 API
  // ============================================================

  openSpecialShopOverlay(): void {
    this._openSpecialShopOverlay(this.stage)
  }

  closeSpecialShopOverlay(): void {
    this._closeSpecialShopOverlay()
  }

  ensureSpecialShopSelection(): void {
    this._ensureSpecialShopSelection(this.stage)
  }

  openSpecialShopFromNeutralScroll(): boolean {
    return this._openSpecialShopFromNeutralScroll(this.stage)
  }

  renderSpecialShopCheckMarks(): void {
    this._renderSpecialShopCheckMarks()
  }

  handleSpecialShopBackpackItemTap(instanceId: string, kind: 'battle' | 'backpack'): void {
    this._handleSpecialShopBackpackItemTap(instanceId, kind)
  }

  executeSpecialShopBulkSell(): void {
    this._executeSpecialShopBulkSell()
  }

  // ============================================================
  // 内部 helper — rollSpecialShopOffers 相關
  // ============================================================

  private _levelToTierStar(level: number): { tier: TierKey; star: 1 | 2 } | null {
    if (level === 1) return { tier: 'Bronze', star: 1 }
    if (level === 2) return { tier: 'Silver', star: 1 }
    if (level === 3) return { tier: 'Silver', star: 2 }
    if (level === 4) return { tier: 'Gold', star: 1 }
    if (level === 5) return { tier: 'Gold', star: 2 }
    if (level === 6) return { tier: 'Diamond', star: 1 }
    if (level === 7) return { tier: 'Diamond', star: 2 }
    return null
  }

  private _getAllowedLevelsByStartingTier(tier: TierKey): Array<1 | 2 | 3 | 4 | 5 | 6 | 7> {
    if (tier === 'Bronze') return [1, 2, 3, 4, 5, 6, 7]
    if (tier === 'Silver') return [2, 3, 4, 5, 6, 7]
    if (tier === 'Gold') return [4, 5, 6, 7]
    return [6, 7]
  }

  private _getSpecialShopPriceByLevel(level: 1 | 2 | 3 | 4 | 5 | 6 | 7): number {
    const clamped = Math.max(1, Math.min(7, level)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
    const tierStar = this._levelToTierStar(clamped)
    const key = `${tierStar?.tier ?? 'Bronze'}#${tierStar?.star ?? 1}`
    const raw = getConfig().shopRules?.quickBuyFixedPrice?.[key]
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return Math.max(1, Math.round(raw))
    }
    const byLevel: [number, number, number, number, number, number, number] = [3, 6, 12, 24, 48, 96, 192]
    return byLevel[clamped - 1] ?? 3
  }

  private _getSpecialShopRefreshCost(): number {
    return Math.max(1, this.ctx.currentDay)
  }

  private _applyFixedSpecialOfferDiscounts(offers: SpecialShopOffer[]): SpecialShopOffer[] {
    const rates = [0.9, 0.8, 0.7]
    return offers.map((it, idx) => {
      const rate = rates[idx] ?? 0.7
      return {
        ...it,
        price: Math.max(1, Math.floor(it.basePrice * rate)),
      }
    })
  }

  private _normalizeSpecialShopOfferPrices(): void {
    const normalized = this.ctx.specialShopOffers.map((one) => {
      const level = Math.max(1, Math.min(7, tierStarLevelIndex(one.tier, one.star) + 1)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
      const basePrice = this._getSpecialShopPriceByLevel(level)
      return {
        ...one,
        basePrice,
        price: basePrice,
      }
    })
    this.ctx.specialShopOffers = this._applyFixedSpecialOfferDiscounts(normalized)
  }

  private _isSpecialShopPlannedForDay(day: number): boolean {
    const plan = this.cb.getDailyPlanRow(day)
    return (Number(plan?.shouldShop) || 0) >= 0.5
  }

  private _getCurrentMaxOwnedLevel(): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
    const ctx = this.ctx
    const cb = this.cb
    let maxLevel = 1
    const collect = (items: Array<{ instanceId: string }>) => {
      for (const it of items) {
        const tier = cb.instanceToTier.get(it.instanceId) ?? 'Bronze'
        const star = cb.getInstanceTierStar(it.instanceId)
        const lv = tierStarLevelIndex(tier, star) + 1
        if (lv > maxLevel) maxLevel = lv
      }
    }
    collect(ctx.battleSystem?.getAllItems() ?? [])
    collect(ctx.backpackSystem?.getAllItems() ?? [])
    return Math.max(1, Math.min(7, maxLevel)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  }

  private _getDominantBattleArchetypeForSpecialShop(): SkillArchetype | null {
    const ctx = this.ctx
    const cb = this.cb
    if (!ctx.battleSystem) return null
    type Stat = { count: number; levelSum: number }
    const stats = new Map<SkillArchetype, Stat>()
    for (const one of ctx.battleSystem.getAllItems()) {
      const def = getItemDefById(one.defId)
      const arch = toSkillArchetype(getPrimaryArchetype(def?.tags ?? ''))
      if (!arch || arch === 'utility') continue
      const tier = cb.instanceToTier.get(one.instanceId) ?? 'Bronze'
      const star = cb.getInstanceTierStar(one.instanceId)
      const level = tierStarLevelIndex(tier, star) + 1
      const prev = stats.get(arch) ?? { count: 0, levelSum: 0 }
      prev.count += 1
      prev.levelSum += level
      stats.set(arch, prev)
    }
    if (stats.size <= 0) return null
    let top = Array.from(stats.keys())
    const maxCount = Math.max(...top.map((k) => stats.get(k)?.count ?? 0))
    top = top.filter((k) => (stats.get(k)?.count ?? 0) === maxCount)
    if (top.length === 1) return top[0] ?? null

    const maxLevelSum = Math.max(...top.map((k) => stats.get(k)?.levelSum ?? 0))
    top = top.filter((k) => (stats.get(k)?.levelSum ?? 0) === maxLevelSum)
    if (top.length === 1) return top[0] ?? null

    const skillCount = new Map<SkillArchetype, number>()
    for (const skill of ctx.pickedSkills) {
      if (!top.includes(skill.archetype)) continue
      skillCount.set(skill.archetype, (skillCount.get(skill.archetype) ?? 0) + 1)
    }
    const maxSkill = Math.max(...top.map((k) => skillCount.get(k) ?? 0))
    top = top.filter((k) => (skillCount.get(k) ?? 0) === maxSkill)
    if (top.length === 1) return top[0] ?? null
    return top[Math.floor(Math.random() * top.length)] ?? null
  }

  private _pickSpecialShopCandidateWeighted(candidates: PoolCandidate[]): PoolCandidate | null {
    if (candidates.length <= 0) return null
    let total = 0
    const ws = candidates.map((c) => {
      const w = getMinTierDropWeight(c.item, c.tier, c.star)
      total += w
      return w
    })
    if (total <= 0) return candidates[Math.floor(Math.random() * candidates.length)] ?? null
    let roll = Math.random() * total
    for (let i = 0; i < candidates.length; i++) {
      roll -= ws[i] ?? 0
      if (roll <= 0) return candidates[i] ?? null
    }
    return candidates[candidates.length - 1] ?? null
  }

  private _countSameOfferDefIds(a: SpecialShopOffer[], b: SpecialShopOffer[]): number {
    const set = new Set(a.map((it) => it.itemId))
    let same = 0
    for (const one of b) {
      if (set.has(one.itemId)) same += 1
    }
    return same
  }

  private _areAllSpecialOffersSameArchetype(offers: SpecialShopOffer[]): boolean {
    if (offers.length < 3) return false
    let first: string | null = null
    for (const one of offers) {
      const def = getItemDefById(one.itemId)
      const arch = getPrimaryArchetype(def?.tags ?? '')
      if (!arch) return false
      if (first == null) {
        first = arch
        continue
      }
      if (arch !== first) return false
    }
    return true
  }

  private _collectPoolCandidatesByLevel(level: 1 | 2 | 3 | 4 | 5 | 6 | 7): PoolCandidate[] {
    const ctx = this.ctx
    const cb = this.cb
    if (!ctx.shopManager || !ctx.battleSystem || !ctx.backpackSystem) return []
    const tierStar = this._levelToTierStar(level)
    if (!tierStar) return []
    const allById = new Map(getAllItems().map((it) => [it.id, it] as const))
    const out: PoolCandidate[] = []
    for (const item of allById.values()) {
      if (!item) continue
      if (isNeutralItemDef(item)) continue
      const minTier = parseTierName(item.starting_tier) ?? 'Bronze'
      if (!this._getAllowedLevelsByStartingTier(minTier).includes(level)) continue
      if (!cb.parseAvailableTiers(item.available_tiers).includes(tierStar.tier)) continue
      const size = normalizeSize(item.size)
      if (!cb.findFirstBattlePlace(size) && !cb.findFirstBackpackPlace(size)) continue
      out.push({
        item,
        level,
        tier: tierStar.tier,
        star: tierStar.star,
        price: this._getSpecialShopPriceByLevel(level),
      })
    }
    return out
  }

  rollSpecialShopOffers(prevOffers?: SpecialShopOffer[]): SpecialShopOffer[] {
    const actualMaxLevel = this._getCurrentMaxOwnedLevel()
    const maxLevel = Math.max(3, actualMaxLevel) as 1 | 2 | 3 | 4 | 5 | 6 | 7
    const minLevel = (actualMaxLevel < 3 ? 2 : Math.max(1, maxLevel - 1)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
    const levels: Array<1 | 2 | 3 | 4 | 5 | 6 | 7> = []
    for (let lv = minLevel; lv <= maxLevel; lv++) levels.push(lv as 1 | 2 | 3 | 4 | 5 | 6 | 7)
    const pool = levels.flatMap((lv) => this._collectPoolCandidatesByLevel(lv))
    if (pool.length <= 0) return []

    const dominant = this._getDominantBattleArchetypeForSpecialShop()
    let best: SpecialShopOffer[] = []
    let bestSame = Number.POSITIVE_INFINITY
    let bestAny: SpecialShopOffer[] = []
    let bestAnySame = Number.POSITIVE_INFINITY

    for (let attempt = 0; attempt < 120; attempt++) {
      const offers: SpecialShopOffer[] = []
      const usedDef = new Set<string>()
      const workingPool = [...pool]

      const takeOne = (source: PoolCandidate[]): PoolCandidate | null => {
        const picked = this._pickSpecialShopCandidateWeighted(source.filter((c) => !usedDef.has(c.item.id)))
        if (!picked) return null
        usedDef.add(picked.item.id)
        const basePrice = this._getSpecialShopPriceByLevel(picked.level)
        offers.push({
          itemId: picked.item.id,
          tier: picked.tier,
          star: picked.star,
          basePrice,
          price: basePrice,
          purchased: false,
        })
        return picked
      }

      if (dominant) {
        const forcedPool = workingPool.filter((c) => toSkillArchetype(getPrimaryArchetype(c.item.tags)) === dominant)
        if (forcedPool.length > 0) takeOne(forcedPool)
      }

      while (offers.length < 3) {
        const picked = takeOne(workingPool)
        if (!picked) break
      }
      if (offers.length < 3) continue

      const pricedOffers = this._applyFixedSpecialOfferDiscounts(offers)
      const same = prevOffers && prevOffers.length > 0 ? this._countSameOfferDefIds(prevOffers, pricedOffers) : 0
      if (same < bestAnySame) {
        bestAny = pricedOffers
        bestAnySame = same
      }

      if (this._areAllSpecialOffersSameArchetype(pricedOffers)) continue

      if (same < bestSame) {
        best = pricedOffers
        bestSame = same
      }
      if (!prevOffers || prevOffers.length <= 0 || same <= 1) return pricedOffers
    }

    return best.length > 0 ? best : bestAny
  }

  // ============================================================
  // 内部 helper — offer 解析
  // ============================================================

  private _findCandidateByOffer(offer: { itemId: string; tier: TierKey; star: 1 | 2; price: number } | null): PoolCandidate | null {
    const cb = this.cb
    if (!offer) return null
    const item = getItemDefById(offer.itemId)
    if (!item) return null
    if (isNeutralItemDef(item)) {
      const rewrittenItem = cb.rewriteNeutralRandomPick(item)
      if (!cb.canRandomNeutralItem(rewrittenItem)) return null
      const size = normalizeSize(rewrittenItem.size)
      if (!cb.findFirstBattlePlace(size) && !cb.findFirstBackpackPlace(size)) return null
      return {
        item: rewrittenItem,
        level: 1,
        tier: 'Bronze',
        star: 1,
        price: Math.max(1, Math.round(Number(offer.price) || this.ctx.currentDay + 1)),
      }
    }
    const level = tierStarLevelIndex(offer.tier, offer.star) + 1
    if (level < 1 || level > 7) return null
    const levelKey = level as 1 | 2 | 3 | 4 | 5 | 6 | 7
    const size = normalizeSize(item.size)
    if (!cb.findFirstBattlePlace(size) && !cb.findFirstBackpackPlace(size)) return null
    const minTier = parseTierName(item.starting_tier) ?? 'Bronze'
    if (!this._getAllowedLevelsByStartingTier(minTier).includes(levelKey)) return null
    if (!cb.parseAvailableTiers(item.available_tiers).includes(offer.tier)) return null
    return {
      item,
      level: levelKey,
      tier: offer.tier,
      star: offer.star,
      price: offer.price,
    }
  }

  // ============================================================
  // 内部 helper — 描述文本
  // ============================================================

  private _resolveTierSeriesTextByStar(item: ItemDef, tier: TierKey, star: 1 | 2, series: string): string {
    const cb = this.cb
    const parts = series.split(/[\/|]/).map((v) => v.trim()).filter(Boolean)
    if (parts.length <= 0) return series
    const tiers = cb.parseAvailableTiers(item.available_tiers)
    const base = Math.max(0, tiers.indexOf(tier))
    const idx = Math.max(0, Math.min(parts.length - 1, base + (star - 1)))
    const resolved = parts[idx] ?? series
    const trimmed = String(series).trim()
    if (/^[+\-]/.test(trimmed) && !/^[+\-]/.test(resolved)) {
      const sign = trimmed.startsWith('-') ? '-' : '+'
      return `${sign}${resolved}`
    }
    return resolved
  }

  private _resolveSkillLineByTierStar(item: ItemDef, tier: TierKey, star: 1 | 2, line: string): string {
    return line.replace(/([+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)+)/g, (raw) => this._resolveTierSeriesTextByStar(item, tier, star, raw))
  }

  private _getSpecialShopSimpleDesc(item: ItemDef, tier: TierKey, star: 1 | 2): string {
    const fromSimple = String(item.simple_desc ?? '').trim()
    if (fromSimple) return fromSimple
    const fromTiered = String(item.simple_desc_tiered ?? '').trim()
    if (fromTiered) {
      const parts = fromTiered.split('|').map((v) => v.trim()).filter(Boolean)
      if (parts.length > 0) {
        const levelIdx = Math.max(0, Math.min(parts.length - 1, tierStarLevelIndex(tier, star)))
        return parts[levelIdx] ?? parts[0]!
      }
    }
    const first = (item.skills ?? []).map((s) => String(s.cn ?? '').trim()).find(Boolean)
    if (!first) return '(暂无描述)'
    return this._resolveSkillLineByTierStar(item, tier, star, first)
  }

  private _getSpecialShopDetailDesc(item: ItemDef, tier: TierKey, star: 1 | 2): string {
    const fromTiered = String(item.simple_desc_tiered ?? '').trim()
    if (fromTiered) return this._resolveSkillLineByTierStar(item, tier, star, fromTiered)
    const fromSimple = String(item.simple_desc ?? '').trim()
    if (fromSimple) return fromSimple
    return this._getSpecialShopSimpleDesc(item, tier, star)
  }

  private _getSpecialShopShownDesc(item: ItemDef, tier: TierKey, star: 1 | 2, detailed: boolean): string {
    if (!this.cb.shouldShowSimpleDescriptions() || detailed) return this._getSpecialShopDetailDesc(item, tier, star)
    return this._getSpecialShopSimpleDesc(item, tier, star)
  }

  private _getSpecialShopSpeedTierText(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '无'
    if (ms <= 600) return '极快'
    if (ms <= 1000) return '很快'
    if (ms <= 1500) return '快'
    if (ms <= 2500) return '中等'
    if (ms <= 4000) return '慢'
    return '很慢'
  }

  private _formatSpecialShopCooldownSec(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '0.0'
    return (Math.round((ms / 1000) * 10) / 10).toFixed(1)
  }

  private _tierCnFromTier(tier: TierKey): string {
    if (tier === 'Bronze') return '青铜'
    if (tier === 'Silver') return '白银'
    if (tier === 'Gold') return '黄金'
    return '钻石'
  }

  // ============================================================
  // 内部 helper — 背包批量出售
  // ============================================================

  private _getSpecialBulkSellUnitPriceByLevel(level: number): number {
    if (level <= 1) return 3
    if (level === 2) return 5
    if (level === 3) return 10
    if (level === 4) return 18
    if (level === 5) return 36
    if (level === 6) return 64
    return 128
  }

  private _getSpecialBulkSellPriceByInstance(instanceId: string): number {
    const cb = this.cb
    const tier = cb.getInstanceTier(instanceId) ?? 'Bronze'
    const star = cb.getInstanceTierStar(instanceId)
    const level = tierStarLevelIndex(tier, star) + 1
    return this._getSpecialBulkSellUnitPriceByLevel(level)
  }

  private _getSpecialBulkSellTotalPrice(): number {
    const ctx = this.ctx
    let sum = 0
    for (const id of ctx.specialShopCheckedInstanceIds) {
      sum += this._getSpecialBulkSellPriceByInstance(id)
    }
    return Math.max(0, Math.round(sum))
  }

  // ============================================================
  // clearSpecialShopCheckLayer / setSpecialShopBackpackViewActive
  // ============================================================

  private _clearSpecialShopCheckLayer(): void {
    const ctx = this.ctx
    if (!ctx.specialShopCheckLayer) return
    if (ctx.specialShopCheckLayer.parent) ctx.specialShopCheckLayer.parent.removeChild(ctx.specialShopCheckLayer)
    ctx.specialShopCheckLayer.destroy({ children: true })
    ctx.specialShopCheckLayer = null
  }

  private _renderSpecialShopCheckMarks(): void {
    const ctx = this.ctx
    const cb = this.cb
    this._clearSpecialShopCheckLayer()
    if (!ctx.specialShopBackpackViewActive) return
    const stage = getApp().stage
    const layer = new Container()
    layer.zIndex = 3490
    layer.eventMode = 'none'

    for (const id of ctx.specialShopCheckedInstanceIds) {
      const inBattle = !!ctx.battleSystem?.getItem(id)
      const system = inBattle ? ctx.battleSystem : ctx.backpackSystem
      const view = inBattle ? ctx.battleView : ctx.backpackView
      const placed = system?.getItem(id)
      if (!system || !view || !placed) continue
      const topLeft = view.cellToLocal(placed.col, placed.row)
      const cols = cb.getSizeCols(placed.size)
      const gpos = view.toGlobal({
        x: topLeft.x + cols * CELL_SIZE - 18,
        y: topLeft.y + 16,
      })
      const spos = stage.toLocal(gpos)

      const mark = new Container()
      mark.x = spos.x
      mark.y = spos.y
      const dot = new Graphics()
      dot.circle(0, 0, 16)
      dot.fill({ color: 0x2ac96b, alpha: 0.96 })
      dot.stroke({ color: 0x0b2b1a, width: 2, alpha: 0.95 })
      const txt = new Text({
        text: '✓',
        style: { fontSize: 22, fill: 0xf6fff9, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      txt.anchor.set(0.5)
      txt.y = -1
      mark.addChild(dot, txt)
      layer.addChild(mark)
    }

    stage.addChild(layer)
    ctx.specialShopCheckLayer = layer
  }

  private _setSpecialShopBackpackViewActive(active: boolean): void {
    const ctx = this.ctx
    ctx.specialShopBackpackViewActive = active
    if (!active) {
      ctx.specialShopCheckedInstanceIds.clear()
      this._clearSpecialShopCheckLayer()
    }
  }

  // ============================================================
  // handleSpecialShopBackpackItemTap
  // ============================================================

  private _handleSpecialShopBackpackItemTap(instanceId: string, kind: 'battle' | 'backpack'): void {
    const ctx = this.ctx
    const cb = this.cb
    if (!ctx.shopManager || !ctx.sellPopup) return
    const defId = cb.instanceToDefId.get(instanceId)
    if (!defId) return
    const item = getItemDefById(defId)
    if (!item) return
    const tier = cb.getInstanceTier(instanceId)
    const star = cb.getInstanceTierStar(instanceId)

    if (ctx.specialShopCheckedInstanceIds.has(instanceId)) ctx.specialShopCheckedInstanceIds.delete(instanceId)
    else ctx.specialShopCheckedInstanceIds.add(instanceId)

    ctx.battleView?.setSelected(kind === 'battle' ? instanceId : null)
    ctx.backpackView?.setSelected(kind === 'backpack' ? instanceId : null)
    ctx.shopPanel?.setSelectedSlot(-1)
    ctx.currentSelection = kind === 'battle' ? { kind: 'battle', instanceId } : { kind: 'backpack', instanceId }
    ctx.selectedSellAction = null

    const picked = ctx.specialShopCheckedInstanceIds.has(instanceId)
    const onePrice = this._getSpecialBulkSellPriceByInstance(instanceId)
    const total = this._getSpecialBulkSellTotalPrice()
    const customDisplay = {
      overrideName: `${item.name_cn}${picked ? '（已勾选）' : '（未勾选）'}`,
      lines: [`点击${picked ? '取消勾选' : '勾选'}该物品`, `单价 ${onePrice}G`, `当前总价 ${total}G`],
    }
    ctx.sellPopup.show(item, 0, 'none', cb.toVisualTier(tier, star), undefined, 'detailed', undefined, customDisplay)
    this._renderSpecialShopCheckMarks()
    ctx.specialShopOverlayActionRefresh?.()
    cb.refreshShopUI()
  }

  // ============================================================
  // executeSpecialShopBulkSell
  // ============================================================

  private _executeSpecialShopBulkSell(): void {
    const ctx = this.ctx
    const cb = this.cb
    if (!ctx.shopManager) return
    if (ctx.specialShopCheckedInstanceIds.size <= 0) {
      cb.showHintToast('no_gold_buy', '请先勾选要出售的物品', 0xffd48f)
      return
    }
    let sold = 0
    let total = 0
    for (const id of [...ctx.specialShopCheckedInstanceIds]) {
      const inBattle = !!ctx.battleSystem?.getItem(id)
      const system = inBattle ? ctx.battleSystem : ctx.backpackSystem
      const view = inBattle ? ctx.battleView : ctx.backpackView
      const placed = system?.getItem(id)
      if (!system || !view || !placed) continue
      total += this._getSpecialBulkSellPriceByInstance(id)
      system.remove(id)
      view.removeItem(id)
      cb.removeInstanceMeta(id)
      sold += 1
    }
    if (sold > 0) {
      ctx.shopManager.gold += Math.max(0, Math.round(total))
      ctx.specialShopCheckedInstanceIds.clear()
      cb.clearSelection()
      this._renderSpecialShopCheckMarks()
      ctx.specialShopOverlayActionRefresh?.()
      cb.refreshShopUI()
      cb.showHintToast('no_gold_buy', `已批量出售${sold}件，获得${Math.round(total)}G`, 0xa8f0b6)
      cb.captureAndSave()
      cb.checkAndPopPendingRewards()
    }
  }

  // ============================================================
  // tryBuySpecialShopOffer
  // ============================================================

  private _tryBuySpecialShopOffer(offerIndex: number): boolean {
    const ctx = this.ctx
    const cb = this.cb
    if (!ctx.shopManager || !ctx.battleSystem || !ctx.battleView || !ctx.backpackSystem || !ctx.backpackView) return false
    const offer = ctx.specialShopOffers[offerIndex]
    if (!offer || offer.purchased) return false
    const candidate = this._findCandidateByOffer(offer)
    if (!candidate) {
      cb.showHintToast('no_gold_buy', '该商品当前不可购买', 0xff8f8f)
      return false
    }

    if (!cb.canBuyItemUnderFirstPurchaseRule(candidate.item)) {
      cb.showFirstPurchaseRuleHint()
      return false
    }

    const priced = cb.resolveBuyPriceWithSkills(candidate.price)
    if (ctx.shopManager.gold < priced.finalPrice) {
      cb.showHintToast('no_gold_buy', `金币不足，需${priced.finalPrice}G`, 0xff8f8f)
      return false
    }

    const size = normalizeSize(candidate.item.size)
    const battleSlot = cb.findFirstBattlePlace(size)
    const backpackSlot = battleSlot ? null : cb.findFirstBackpackPlace(size)
    if (!battleSlot && !backpackSlot) {
      cb.showHintToast('backpack_full_buy', '背包已满，无法购买', 0xff8f8f)
      return false
    }

    ctx.shopManager.gold -= priced.finalPrice
    if (cb.consumeSkill15NextBuyDiscountAfterSuccess()) cb.showHintToast('no_gold_buy', '砍价高手触发：本次-1G', 0x8ff0b0)
    const skill30Ready = cb.consumeSkill30BundleAfterSuccess(priced.freeBySkill30)
    if (priced.freeBySkill30) cb.showHintToast('no_gold_buy', '打包购买触发：本次0金币', 0x9be5ff)
    else if (skill30Ready) cb.showHintToast('no_gold_buy', '打包购买就绪：下次购买0金币', 0x9be5ff)

    const id = cb.nextId()
    const visualTier = cb.toVisualTier(candidate.tier, candidate.star)
    if (battleSlot) {
      ctx.battleSystem.place(battleSlot.col, battleSlot.row, size, candidate.item.id, id)
      void ctx.battleView.addItem(id, candidate.item.id, size, battleSlot.col, battleSlot.row, visualTier).then(() => {
        ctx.battleView!.setItemTier(id, visualTier)
        ctx.drag?.refreshZone(ctx.battleView!)
      })
    } else if (backpackSlot) {
      ctx.backpackSystem.place(backpackSlot.col, backpackSlot.row, size, candidate.item.id, id)
      void ctx.backpackView.addItem(id, candidate.item.id, size, backpackSlot.col, backpackSlot.row, visualTier).then(() => {
        ctx.backpackView!.setItemTier(id, visualTier)
        ctx.drag?.refreshZone(ctx.backpackView!)
      })
    }

    cb.markShopPurchaseDone()
    offer.purchased = true
    cb.instanceToDefId.set(id, candidate.item.id)
    cb.setInstanceQualityLevel(id, candidate.item.id, parseTierName(candidate.item.starting_tier) ?? 'Bronze', candidate.level)
    cb.instanceToPermanentDamageBonus.set(id, 0)
    cb.recordNeutralItemObtained(candidate.item.id)
    cb.unlockItemToPool(candidate.item.id)
    cb.refreshShopUI()
    return true
  }

  // ============================================================
  // closeSpecialShopOverlay
  // ============================================================

  private _closeSpecialShopOverlay(): void {
    const ctx = this.ctx
    this._setSpecialShopBackpackViewActive(false)
    ctx.specialShopOverlayActionRefresh = null
    if (!ctx.specialShopOverlay) return
    if (ctx.specialShopOverlay.parent) ctx.specialShopOverlay.parent.removeChild(ctx.specialShopOverlay)
    ctx.specialShopOverlay.destroy({ children: true })
    ctx.specialShopOverlay = null
  }

  // ============================================================
  // openSpecialShopOverlay（主入口）
  // ============================================================

  private _openSpecialShopOverlay(stage: Container): void {
    const ctx = this.ctx
    const cb = this.cb
    this._closeSpecialShopOverlay()
    cb.setTransitionInputEnabled(false)
    cb.setBaseShopPrimaryButtonsVisible(false)
    cb.clearSelection()
    let selectedOfferIndex: number | null = null

    const overlay = new Container()
    overlay.zIndex = 3510
    overlay.eventMode = 'static'
    overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

    const bg = new Graphics()
    bg.rect(0, 0, CANVAS_W, CANVAS_H)
    bg.fill({ color: 0x070d1d, alpha: 0.92 })
    overlay.addChild(bg)

    const title = new Text({
      text: '折扣商店',
      style: { fontSize: 42, fill: 0xfff2cf, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    title.anchor.set(0.5)
    title.x = CANVAS_W / 2
    title.y = 150
    overlay.addChild(title)

    const goldInfo = new Text({
      text: '',
      style: { fontSize: 30, fill: 0xffd86b, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    goldInfo.anchor.set(0.5)
    goldInfo.x = CANVAS_W / 2
    goldInfo.y = 390
    goldInfo.visible = false
    overlay.addChild(goldInfo)

    const cardsLayer = new Container()
    cardsLayer.x = 0
    cardsLayer.y = 0
    overlay.addChild(cardsLayer)

    const actionBtnW = 186
    const actionBtnH = 96
    const actionBtnGap = 18
    const actionBtnFontSize = 22
    const actionBtnStartX = Math.round((CANVAS_W - (actionBtnW * 3 + actionBtnGap * 2)) / 2)
    const actionBtnY = CANVAS_H - 146
    goldInfo.y = actionBtnY - 140

    const rerollBtn = new Container()
    rerollBtn.eventMode = 'static'
    rerollBtn.cursor = 'pointer'
    rerollBtn.x = actionBtnStartX + actionBtnW + actionBtnGap
    rerollBtn.y = actionBtnY
    const rerollBg = new Graphics()
    const rerollText = new Text({
      text: '',
      style: { fontSize: actionBtnFontSize, fill: 0x10213a, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    rerollText.anchor.set(0.5)
    rerollBtn.addChild(rerollBg, rerollText)
    overlay.addChild(rerollBtn)

    const closeBtn = new Container()
    closeBtn.eventMode = 'static'
    closeBtn.cursor = 'pointer'
    closeBtn.x = actionBtnStartX + (actionBtnW + actionBtnGap) * 2
    closeBtn.y = actionBtnY
    const closeBg = new Graphics()
    closeBg.roundRect(0, 0, actionBtnW, actionBtnH, 20)
    closeBg.fill({ color: 0x4d6f99, alpha: 0.95 })
    closeBg.stroke({ color: 0xa5cfff, width: 3, alpha: 0.95 })
    const closeText = new Text({
      text: '离开商店',
      style: { fontSize: actionBtnFontSize, fill: 0xeaf4ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    closeText.anchor.set(0.5)
    closeText.x = actionBtnW / 2
    closeText.y = actionBtnH / 2
    closeBtn.addChild(closeBg, closeText)
    overlay.addChild(closeBtn)

    const holdBtn = new Container()
    holdBtn.eventMode = 'static'
    holdBtn.cursor = 'pointer'
    holdBtn.x = actionBtnStartX
    holdBtn.y = actionBtnY
    const holdBg = new Graphics()
    holdBg.roundRect(0, 0, actionBtnW, actionBtnH, 20)
    holdBg.fill({ color: 0x29436e, alpha: 0.94 })
    holdBg.stroke({ color: 0x84b7ff, width: 3, alpha: 0.95 })
    const holdTxt = new Text({
      text: '出售物品',
      style: { fontSize: actionBtnFontSize, fill: 0xeaf4ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    holdTxt.anchor.set(0.5)
    holdTxt.x = actionBtnW / 2
    holdTxt.y = actionBtnH / 2
    holdBtn.addChild(holdBg, holdTxt)

    const setSpecialShopOverlayVisible = (visible: boolean): void => {
      title.visible = visible
      goldInfo.visible = visible
      cardsLayer.visible = visible
      rerollBtn.visible = visible && ctx.specialShopRefreshCount < 1
      closeBtn.visible = visible
      bg.alpha = visible ? 0.92 : 0
    }

    const setBackpackViewMode = (active: boolean): void => {
      const bindTapOnly = () => {
        ctx.backpackView?.makeItemsInteractive((id, e) => {
          e.stopPropagation()
          this._handleSpecialShopBackpackItemTap(id, 'backpack')
        })
        ctx.battleView?.makeItemsInteractive((id, e) => {
          e.stopPropagation()
          this._handleSpecialShopBackpackItemTap(id, 'battle')
        })
      }
      const restoreDragInteractive = () => {
        if (!ctx.drag) return
        if (ctx.backpackView) ctx.drag.refreshZone(ctx.backpackView)
        if (ctx.battleView) ctx.drag.refreshZone(ctx.battleView)
      }

      this._setSpecialShopBackpackViewActive(active)
      overlay.eventMode = 'static'
      overlay.hitArea = active
        ? new Rectangle(0, actionBtnY, CANVAS_W, Math.max(1, CANVAS_H - actionBtnY))
        : new Rectangle(0, 0, CANVAS_W, CANVAS_H)
      bg.eventMode = 'none'
      holdTxt.text = active ? '回到折扣商店' : '出售物品'
      holdBg.clear()
      holdBg.roundRect(0, 0, actionBtnW, actionBtnH, 20)
      if (active) {
        holdBg.fill({ color: 0x3b5f96, alpha: 0.94 })
        holdBg.stroke({ color: 0xb4d2ff, width: 3, alpha: 0.95 })
        setSpecialShopOverlayVisible(false)
        cb.setBaseShopPrimaryButtonsVisible(false)
        if (ctx.refreshBtnHandle) ctx.refreshBtnHandle.container.visible = true
        ctx.drag?.setEnabled(false)
        bindTapOnly()
        cb.showHintToast('backpack_full_buy', '已切换到出售物品模式', 0x9be5ff)
      } else {
        holdBg.fill({ color: 0x29436e, alpha: 0.94 })
        holdBg.stroke({ color: 0x84b7ff, width: 3, alpha: 0.95 })
        setSpecialShopOverlayVisible(true)
        cb.setBaseShopPrimaryButtonsVisible(false)
        ctx.drag?.setEnabled(false)
        restoreDragInteractive()
      }
      ctx.specialShopOverlayActionRefresh?.()
      cb.refreshShopUI()
      cb.captureAndSave()
    }

    holdBtn.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      setBackpackViewMode(!ctx.specialShopBackpackViewActive)
    })
    overlay.addChild(holdBtn)

    const redrawRerollBtn = () => {
      if (ctx.specialShopBackpackViewActive) {
        rerollBtn.visible = true
        closeBtn.visible = false
        rerollBg.clear()
        rerollBg.roundRect(0, 0, actionBtnW, actionBtnH, 20)
        rerollBg.fill({ color: 0x9a3a3a, alpha: 0.95 })
        rerollBg.stroke({ color: 0xffb1b1, width: 3, alpha: 0.95 })
        rerollText.style.fill = 0xffe8e8
        rerollText.text = ctx.specialShopCheckedInstanceIds.size > 0
          ? `出售\n💰 ${this._getSpecialBulkSellTotalPrice()}`
          : '点击物品出售'
        rerollText.x = actionBtnW / 2
        rerollText.y = actionBtnH / 2
        return
      }
      const canReroll = ctx.specialShopRefreshCount < 1
      const cost = this._getSpecialShopRefreshCost()
      const canAfford = (ctx.shopManager?.gold ?? 0) >= cost
      const can = canReroll && canAfford
      rerollBtn.visible = canReroll
      rerollBg.clear()
      rerollBg.roundRect(0, 0, actionBtnW, actionBtnH, 20)
      rerollBg.fill({ color: can ? 0xffd86b : 0x8a6e4b, alpha: 0.95 })
      rerollBg.stroke({ color: can ? 0xffefad : 0xb89d78, width: 3, alpha: 0.95 })
      rerollText.style.fill = can ? 0x10213a : 0xd7c4a8
      rerollText.text = `刷新  ${cost}G`
      rerollText.x = actionBtnW / 2
      rerollText.y = actionBtnH / 2
    }

    const redrawGoldInfo = () => {
      goldInfo.text = `当前持有金币：${Math.max(0, Math.round(ctx.shopManager?.gold ?? 0))}`
    }

    const redrawCards = () => {
      cardsLayer.removeChildren().forEach((c) => c.destroy({ children: true }))
      const cardW = 188
      const cardH = 580
      const gapX = 14
      const totalW = cardW * 3 + gapX * 2
      const startX = (CANVAS_W - totalW) / 2
      const y = 420

      for (let i = 0; i < 3; i++) {
        const offer = ctx.specialShopOffers[i]
        if (!offer) continue
        const candidate = this._findCandidateByOffer(offer)
        if (!candidate) continue

        const card = new Container()
        card.x = startX + i * (cardW + gapX)
        card.y = y
        card.eventMode = 'static'
        card.cursor = offer.purchased ? 'default' : 'pointer'
        card.hitArea = new Rectangle(0, 0, cardW, cardH)

        const border = new Graphics()
        border.roundRect(0, 0, cardW, cardH, 24)
        border.fill({ color: 0x18263e, alpha: 0.96 })
        const selected = selectedOfferIndex === i
        border.stroke({ color: offer.purchased ? 0x6d7791 : (selected ? 0xffe28a : 0x7cc6ff), width: selected ? 4 : 3, alpha: 1 })
        card.addChild(border)

        const icon = new Sprite(Texture.WHITE)
        icon.width = 132
        icon.height = 132
        icon.x = (cardW - icon.width) / 2
        icon.y = 20
        icon.alpha = 0
        card.addChild(icon)
        cb.addArchetypeCornerBadge(card, candidate.item, cardW, icon.y)
        void Assets.load<Texture>(getItemIconUrl(candidate.item.id)).then((tex) => {
          icon.texture = tex
          icon.alpha = offer.purchased ? 0.35 : 1
        }).catch(() => {
          // ignore load error in runtime
        })

        const name = new Text({
          text: candidate.item.name_cn,
          style: { fontSize: 26, fill: 0xf5f8ff, fontFamily: 'Arial', fontWeight: 'bold' },
        })
        name.anchor.set(0.5, 0)
        name.x = cardW / 2
        name.y = 168
        card.addChild(name)

        const baseTier = parseTierName(candidate.item.starting_tier) ?? 'Bronze'
        const level = tierStarLevelIndex(candidate.tier, candidate.star) + 1

        const tierPill = new Graphics()
        const tierFill = baseTier === 'Bronze'
          ? 0x7f6839
          : baseTier === 'Silver'
            ? 0x5c6678
            : baseTier === 'Gold'
              ? 0x8f6a2d
              : 0x2f5f86
        tierPill.roundRect(0, 0, 116, 38, 12)
        tierPill.fill({ color: tierFill, alpha: 0.96 })
        tierPill.stroke({ color: getTierColor(baseTier), width: 2, alpha: 0.95 })
        tierPill.x = (cardW - 116) / 2
        tierPill.y = 208
        card.addChild(tierPill)

        const tierText = new Text({
          text: `${this._tierCnFromTier(baseTier)}Lv${level}`,
          style: { fontSize: 24, fill: 0xfff4d0, fontFamily: 'Arial', fontWeight: 'bold' },
        })
        tierText.anchor.set(0.5)
        tierText.x = cardW / 2
        tierText.y = tierPill.y + 19
        card.addChild(tierText)

        const tierStats = resolveItemTierBaseStats(candidate.item, `${candidate.tier}#${candidate.star}`)
        const damageValue = Math.max(0, Math.round(tierStats.damage))
        const shieldValue = Math.max(0, Math.round(tierStats.shield))
        const healValue = Math.max(0, Math.round(tierStats.heal))
        const cooldownMs = Math.max(0, Math.round(tierStats.cooldownMs))
        const mainStatText = damageValue > 0
          ? `✦伤害${damageValue}`
          : shieldValue > 0
            ? `🛡护盾${shieldValue}`
            : healValue > 0
              ? `✚回血${healValue}`
              : '◈被动'
        const mainStatColor = damageValue > 0 ? 0xff7a82 : shieldValue > 0 ? 0xffd983 : healValue > 0 ? 0x73e6a6 : 0x86b8ff
        const speedText = cooldownMs > 0
          ? (selected ? `⏱间隔${this._formatSpecialShopCooldownSec(cooldownMs)}秒` : `⏱速度${this._getSpecialShopSpeedTierText(cooldownMs)}`)
          : ''

        const ammoLine = (candidate.item.skills ?? [])
          .map((s) => String(s.cn ?? '').trim())
          .find((s) => /弹药\s*[:：]\s*\d+/.test(s))
        const ammo = ammoLine ? cb.ammoValueFromLineByStar(candidate.item, candidate.tier, candidate.star, ammoLine) : 0

        const statEntries: Array<{ text: string; color: number }> = [
          { text: mainStatText, color: mainStatColor },
        ]
        if (speedText) statEntries.push({ text: speedText, color: 0x70b2ff })
        if (ammo > 0) {
          statEntries.push({ text: `◉弹药${ammo}`, color: 0xffd36b })
        }

        const statStartY = 258
        const statGapY = 34
        for (let si = 0; si < statEntries.length; si++) {
          const entry = statEntries[si]!
          const line = new Text({
            text: entry.text,
            style: { fontSize: 24, fill: entry.color, fontFamily: 'Arial', fontWeight: 'bold' },
          })
          line.anchor.set(0.5, 0)
          line.x = cardW / 2
          line.y = statStartY + si * statGapY
          card.addChild(line)
        }

        const divider = new Graphics()
        const dividerY = statStartY + statEntries.length * statGapY + 2
        divider.moveTo(12, dividerY)
        divider.lineTo(cardW - 12, dividerY)
        divider.stroke({ color: 0x4a5f88, width: 1.5, alpha: 0.95 })
        card.addChild(divider)

        const desc = new Text({
          text: this._getSpecialShopShownDesc(candidate.item, candidate.tier, candidate.star, selected),
          style: {
            fontSize: 20,
            fill: selected ? 0xf2f7ff : 0xcad7f5,
            fontFamily: 'Arial',
            wordWrap: true,
            breakWords: true,
            wordWrapWidth: cardW - 24,
            lineHeight: 28,
          },
        })
        desc.x = 12
        desc.y = dividerY + 14
        card.addChild(desc)

        const basePriceY = cardH - 96
        if (selected && !offer.purchased) {
          const buyHint = new Text({
            text: '点击购买',
            style: { fontSize: 22, fill: 0x9be5ff, fontFamily: 'Arial', fontWeight: 'bold' },
          })
          buyHint.anchor.set(0.5)
          buyHint.x = cardW / 2
          buyHint.y = cardH - 30
          card.addChild(buyHint)
        }

        const price = cb.resolveBuyPriceWithSkills(candidate.price).finalPrice
        if (offer.purchased) {
          const priceText = new Text({
            text: '已购买',
            style: {
              fontSize: 32,
              fill: 0x9ba8bf,
              fontFamily: 'Arial',
              fontWeight: 'bold',
            },
          })
          priceText.anchor.set(0.5, 0)
          priceText.x = cardW / 2
          priceText.y = basePriceY
          card.addChild(priceText)
        } else if (offer.price < offer.basePrice) {
          const oldPrice = new Text({
            text: `💰 ${offer.basePrice}`,
            style: {
              fontSize: 22,
              fill: 0x90a0bd,
              fontFamily: 'Arial',
              fontWeight: 'bold',
            },
          })
          oldPrice.anchor.set(0.5, 0)
          oldPrice.x = cardW / 2
          oldPrice.y = basePriceY - 30
          card.addChild(oldPrice)

          const strike = new Graphics()
          strike.moveTo(oldPrice.x - oldPrice.width / 2 + 2, oldPrice.y + oldPrice.height / 2)
          strike.lineTo(oldPrice.x + oldPrice.width / 2 - 2, oldPrice.y + oldPrice.height / 2)
          strike.stroke({ color: 0x90a0bd, width: 3, alpha: 0.95 })
          card.addChild(strike)

          const newPrice = new Text({
            text: `💰 ${price}`,
            style: {
              fontSize: 32,
              fill: (ctx.shopManager?.gold ?? 0) >= price ? 0xffd86b : 0xff7a7a,
              fontFamily: 'Arial',
              fontWeight: 'bold',
            },
          })
          newPrice.anchor.set(0.5, 0)
          newPrice.x = cardW / 2
          newPrice.y = basePriceY
          card.addChild(newPrice)
        } else {
          const priceText = new Text({
            text: `💰 ${price}`,
            style: {
              fontSize: 32,
              fill: (ctx.shopManager?.gold ?? 0) >= price ? 0xffd86b : 0xff7a7a,
              fontFamily: 'Arial',
              fontWeight: 'bold',
            },
          })
          priceText.anchor.set(0.5, 0)
          priceText.x = cardW / 2
          priceText.y = basePriceY
          card.addChild(priceText)
        }

        card.on('pointerdown', (e) => {
          e.stopPropagation()
          if (offer.purchased) return
          if (selectedOfferIndex !== i) {
            selectedOfferIndex = i
            redrawCards()
            return
          }
          if (!this._tryBuySpecialShopOffer(i)) {
            redrawSpecialShopOverlay()
            return
          }
          selectedOfferIndex = null
          redrawSpecialShopOverlay()
          cb.captureAndSave()
        })

        cardsLayer.addChild(card)
      }
    }

    const redrawSpecialShopOverlay = () => {
      redrawGoldInfo()
      redrawCards()
      redrawRerollBtn()
    }
    ctx.specialShopOverlayActionRefresh = redrawSpecialShopOverlay

    rerollBtn.on('pointerdown', (e) => {
      e.stopPropagation()
      if (!ctx.shopManager) return
      if (ctx.specialShopBackpackViewActive) {
        this._executeSpecialShopBulkSell()
        return
      }
      if (ctx.specialShopRefreshCount >= 1) return
      const cost = this._getSpecialShopRefreshCost()
      if (ctx.shopManager.gold < cost) {
        cb.showHintToast('no_gold_refresh', `金币不足，需${cost}G`, 0xff8f8f)
        return
      }
      const next = this.rollSpecialShopOffers(ctx.specialShopOffers)
      if (next.length < 3) {
        cb.showHintToast('no_gold_refresh', '无可用刷新池', 0xff8f8f)
        return
      }
      ctx.shopManager.gold -= cost
      ctx.specialShopRefreshCount += 1
      ctx.specialShopOffers = next
      selectedOfferIndex = null
      redrawSpecialShopOverlay()
      cb.refreshShopUI()
      cb.captureAndSave()
    })

    closeBtn.on('pointerdown', (e) => {
      e.stopPropagation()
      ctx.draftedSpecialShopDays = Array.from(new Set([...ctx.draftedSpecialShopDays, ctx.currentDay])).sort((a, b) => a - b)
      this._closeSpecialShopOverlay()
      cb.setBaseShopPrimaryButtonsVisible(true)
      cb.setTransitionInputEnabled(true)
      cb.applyPhaseInputLock()
      cb.refreshShopUI()
      cb.captureAndSave()
    })

    redrawSpecialShopOverlay()
    stage.addChild(overlay)
    ctx.specialShopOverlay = overlay
  }

  // ============================================================
  // ensureSpecialShopSelection
  // ============================================================

  private _ensureSpecialShopSelection(stage: Container): void {
    const ctx = this.ctx
    if (ctx.classSelectOverlay) return
    if (ctx.starterGuideOverlay) return
    if (ctx.skillDraftOverlay || ctx.eventDraftOverlay || ctx.specialShopOverlay) return
    if (!this._isSpecialShopPlannedForDay(ctx.currentDay)) {
      ctx.specialShopRefreshCount = 0
      ctx.specialShopOffers = []
      return
    }
    if (ctx.draftedSpecialShopDays.includes(ctx.currentDay)) return
    if (ctx.specialShopOffers.length !== 3) {
      ctx.specialShopRefreshCount = 0
      ctx.specialShopOffers = this.rollSpecialShopOffers()
    }
    if (ctx.specialShopOffers.length !== 3) {
      ctx.draftedSpecialShopDays = Array.from(new Set([...ctx.draftedSpecialShopDays, ctx.currentDay])).sort((a, b) => a - b)
      return
    }
    this._normalizeSpecialShopOfferPrices()
    this._openSpecialShopOverlay(stage)
  }

  // ============================================================
  // openSpecialShopFromNeutralScroll
  // ============================================================

  private _openSpecialShopFromNeutralScroll(stage: Container): boolean {
    const ctx = this.ctx
    const prevOffers = ctx.specialShopOffers.length > 0 ? [...ctx.specialShopOffers] : undefined
    ctx.specialShopRefreshCount = 0
    ctx.specialShopOffers = this.rollSpecialShopOffers(prevOffers)
    if (ctx.specialShopOffers.length !== 3) {
      ctx.specialShopOffers = this.rollSpecialShopOffers()
    }
    if (ctx.specialShopOffers.length !== 3) return false
    this._openSpecialShopOverlay(stage)
    return true
  }
}
