// ============================================================
// SynthesisPanel — 合成確認覆蓋層面板
// 從 ShopScene.ts 提取，使用 Class 方式（繼承 Container）
// 包含：
//   showCrossSynthesisConfirmOverlay（跨 ID 合成確認彈窗，~305 行）
//   teardownCrossSynthesisConfirmOverlay（清理覆蓋層）
//   createCrossSynthesisPreviewCard（合成預覽卡片，~63 行）
//   synthesisLevelLabel（等級標籤 helper）
//   showSynthesisHoverInfo（合成懸停信息，~67 行）
//   hideSynthesisHoverInfo（清除懸停 key）
//   getCrossSynthesisMinStartingTier（純函數，也 export 供 ShopScene.ts 用）
//   getCrossIdEvolvePool（純函數，內部 helper）
//   getCrossIdPreviewCandidates（純函數，也 export 供 ShopScene.ts 用）
//   pickCrossIdEvolveCandidates（純函數，也 export 供 ShopScene.ts 用）
//   shouldCrossSynthesisPreferOtherArchetype（純函數，也 export 供 ShopScene.ts 用）
// ============================================================

import {
  Container, Graphics, Text, Sprite,
  Assets, Texture, Rectangle, Ticker,
  type FederatedPointerEvent,
} from 'pixi.js'
import { getAllItems } from '@/core/DataLoader'
import { getItemIconUrl } from '@/core/AssetPath'
import { getTierColor } from '@/config/colorPalette'
import { getConfig as getDebugCfg, setConfig as setDebugCfg } from '@/config/debugConfig'
import { createItemStatBadges } from '@/common/ui/ItemStatBadges'
import { normalizeSize, type ItemDef } from '@/common/items/ItemDef'
import type { ItemSizeNorm } from '@/common/grid/GridSystem'
import { CELL_SIZE, CELL_HEIGHT } from '@/common/grid/GridZone'
import type { TierKey } from '@/shop/ShopManager'
import type { ItemInfoCustomDisplay } from '@/common/ui/SellPopup'
import type { ShopSceneCtx } from '../ShopSceneContext'
import {
  parseTierName,
  getPrimaryArchetype,
  toSkillArchetype,
  isNeutralItemDef,
  getItemDefById,
  tierStarLevelIndex,
  nextTierLevel,
  canUseLv7MorphSynthesis,
} from '../systems/ShopSynthesisLogic'

import { CANVAS_W, CANVAS_H } from '@/config/layoutConstants'

// ============================================================
// 類型定義（export 供 ShopScene.ts 使用）
// ============================================================

export type SynthesisPreviewItem = {
  def: ItemDef
  tier: TierKey
  star: 1 | 2
}

// ============================================================
// Callbacks interface
// ============================================================

export interface SynthesisPanelCallbacks {
  refreshShopUI: () => void
  captureAndSave: () => void
  refreshPlayerStatusUI: () => void
  canUseSameArchetypeDiffItemStoneSynthesis: (
    sourceDefId: string,
    targetDefId: string,
    sourceTier: TierKey,
    sourceStar: 1 | 2,
    targetTier: TierKey,
    targetStar: 1 | 2,
  ) => boolean
  getInstanceTier: (instanceId: string) => TierKey | undefined
  getInstanceTierStar: (instanceId: string) => 1 | 2
  toVisualTier: (tier?: TierKey, star?: 1 | 2) => string | undefined
  getItemDefByCn: (nameCn: string) => ItemDef | null
}

// ============================================================
// 純函數工具（export 供 ShopScene.ts 繼續使用）
// ============================================================

export function getCrossSynthesisMinStartingTier(sourceDef: ItemDef, targetDef: ItemDef): TierKey {
  const sourceMinTier = parseTierName(sourceDef.starting_tier) ?? 'Bronze'
  const targetMinTier = parseTierName(targetDef.starting_tier) ?? 'Bronze'
  return maxTierLocal(sourceMinTier, targetMinTier)
}

export function shouldCrossSynthesisPreferOtherArchetype(sourceDef: ItemDef, targetDef: ItemDef): boolean {
  if (sourceDef.id === targetDef.id) return false
  const sourceArch = toSkillArchetype(getPrimaryArchetype(sourceDef.tags))
  const targetArch = toSkillArchetype(getPrimaryArchetype(targetDef.tags))
  if (sourceArch !== targetArch) return false
  return sourceArch === 'warrior' || sourceArch === 'archer' || sourceArch === 'assassin'
}

export function getCrossIdEvolvePool(
  sourceDef: ItemDef,
  targetSize: ItemSizeNorm,
  resultTier: TierKey,
  minStartingTier: TierKey,
): {
  basePool: ItemDef[]
  sameArchPool: ItemDef[]
  otherArchPool: ItemDef[]
} {
  const basePool = getAllItems().filter((it) =>
    normalizeSize(it.size) === targetSize
    && !isNeutralItemDef(it)
    && parseAvailableTiersLocal(it.available_tiers).includes(resultTier)
    && compareTierLocal(parseTierName(it.starting_tier) ?? 'Bronze', minStartingTier) >= 0
  )
  const sourceArch = getPrimaryArchetype(sourceDef.tags)
  if (!sourceArch) {
    return { basePool, sameArchPool: basePool, otherArchPool: basePool }
  }
  const sameArchPool = basePool.filter((it) => getPrimaryArchetype(it.tags) === sourceArch)
  const otherArchPool = basePool.filter((it) => getPrimaryArchetype(it.tags) !== sourceArch)
  return { basePool, sameArchPool, otherArchPool }
}

export function pickCrossIdEvolveCandidates(
  sourceDef: ItemDef,
  targetSize: ItemSizeNorm,
  resultTier: TierKey,
  minStartingTier: TierKey,
  preferOtherArchetype = false,
): ItemDef[] {
  const { basePool, otherArchPool } = getCrossIdEvolvePool(sourceDef, targetSize, resultTier, minStartingTier)
  if (preferOtherArchetype) return otherArchPool
  if (basePool.length > 0) return basePool
  return []
}

export function getCrossIdPreviewCandidates(
  sourceDef: ItemDef,
  targetSize: ItemSizeNorm,
  resultTier: TierKey,
  minStartingTier: TierKey,
  preferOtherArchetype = false,
): ItemDef[] {
  const { basePool, otherArchPool } = getCrossIdEvolvePool(sourceDef, targetSize, resultTier, minStartingTier)
  if (preferOtherArchetype) return otherArchPool
  return basePool
}

// ============================================================
// 模塊私有工具函數
// ============================================================

const TIER_ORDER_LOCAL: TierKey[] = ['Bronze', 'Silver', 'Gold', 'Diamond']

function compareTierLocal(a: TierKey, b: TierKey): number {
  return TIER_ORDER_LOCAL.indexOf(a) - TIER_ORDER_LOCAL.indexOf(b)
}

function maxTierLocal(a: TierKey, b: TierKey): TierKey {
  return compareTierLocal(a, b) >= 0 ? a : b
}

function parseAvailableTiersLocal(raw: string): TierKey[] {
  const s = (raw || '').trim()
  if (!s) return ['Bronze', 'Silver', 'Gold', 'Diamond']
  const out = s
    .split('/')
    .map((v) => parseTierName(v.trim()))
    .filter((v): v is TierKey => !!v)
  return out.length > 0 ? out : ['Bronze', 'Silver', 'Gold', 'Diamond']
}

function synthesisLevelLabel(tier: TierKey, star: 1 | 2): string {
  return String(tierStarLevelIndex(tier, star) + 1)
}

// ============================================================
// SynthesisPanel 類
// ============================================================

export class SynthesisPanel extends Container {
  constructor(
    private ctx: ShopSceneCtx,
    private stage: Container,
    private callbacks: SynthesisPanelCallbacks,
  ) {
    super()
  }

  // ----------------------------------------------------------
  // 合成懸停信息
  // ----------------------------------------------------------

  hideSynthesisHoverInfo(): void {
    this.ctx.synthHoverInfoKey = ''
  }

  showSynthesisHoverInfo(
    sourceDefId: string,
    sourceTier: TierKey,
    sourceStar: 1 | 2,
    target: { instanceId: string; zone: 'battle' | 'backpack' },
  ): void {
    const { ctx, callbacks } = this
    if (!ctx.battleSystem || !ctx.backpackSystem || !ctx.sellPopup || !ctx.shopManager) return
    const sourceDef = getItemDefById(sourceDefId)
    if (!sourceDef) return
    const system = target.zone === 'battle' ? ctx.battleSystem : ctx.backpackSystem
    const targetItem = system.getItem(target.instanceId)
    if (!targetItem) return
    const targetTier = callbacks.getInstanceTier(target.instanceId) ?? sourceTier
    const targetStar = callbacks.getInstanceTierStar(target.instanceId)
    const lv7MorphMode = canUseLv7MorphSynthesis(sourceDefId, targetItem.defId, sourceTier, sourceStar, targetTier, targetStar)
    if (lv7MorphMode) {
      const morphStone = callbacks.getItemDefByCn('变化石') ?? sourceDef
      const customDisplay: ItemInfoCustomDisplay = {
        overrideName: '变化石（Lv7转化）',
        lines: ['将两个Lv7物品转化为同职业其他Lv7物品', '松手后需二次确认，再进入2选1变化'],
        suppressStats: true,
      }
      ctx.sellPopup.show(morphStone, 0, 'none', 'Bronze#1', undefined, 'detailed', undefined, customDisplay)
      return
    }
    const upgradeTo = nextTierLevel(sourceTier, sourceStar)
    if (!upgradeTo) return
    const isSameItem = sourceDefId === targetItem.defId
    const mode = isSameItem ? 'same_archetype' : 'cross_archetype'
    const key = `${sourceDefId}|${sourceTier}|${sourceStar}|${target.instanceId}|${mode}`
    if (ctx.synthHoverInfoKey === key) return
    ctx.synthHoverInfoKey = key

    const buyPrice = ctx.shopManager.getItemPrice(sourceDef, sourceTier)
    if (isSameItem) {
      ctx.sellPopup.show(sourceDef, buyPrice, 'buy', callbacks.toVisualTier(upgradeTo.tier, upgradeTo.star), undefined, 'detailed')
      return
    }

    if (callbacks.canUseSameArchetypeDiffItemStoneSynthesis(sourceDefId, targetItem.defId, sourceTier, sourceStar, targetTier, targetStar)) {
      const customDisplay: ItemInfoCustomDisplay = {
        hideName: true,
        lines: ['升级为 +1 级其他非中立职业物品（同等级桶随机）'],
        suppressStats: true,
        hideTierBadge: true,
        centerRichLineInFrame: true,
      }
      ctx.sellPopup.show(sourceDef, buyPrice, 'buy', callbacks.toVisualTier(upgradeTo.tier, upgradeTo.star), undefined, 'detailed', undefined, customDisplay)
      return
    }

    const customDisplay: ItemInfoCustomDisplay = {
      hideName: true,
      lines: ['升级为 随机 物品'],
      richLineSegments: [
        { text: '升级为 ', fontSize: 28, fill: 0xbfc7f5 },
        { text: '随机', fontSize: 40, fill: 0xffd86b },
        { text: ' 物品', fontSize: 28, fill: 0xbfc7f5 },
      ],
      suppressStats: true,
      hideTierBadge: true,
      useQuestionIcon: true,
      centerRichLineInFrame: true,
    }
    ctx.sellPopup.show(sourceDef, buyPrice, 'buy', callbacks.toVisualTier(sourceTier, sourceStar), undefined, 'detailed', undefined, customDisplay)
  }

  // ----------------------------------------------------------
  // 合成預覽卡片
  // ----------------------------------------------------------

  private createCrossSynthesisPreviewCard(
    item: ItemDef,
    frameTier: TierKey,
    badgeTier: TierKey,
    badgeStar: 1 | 2,
  ): Container {
    const con = new Container()
    const cardScale = 0.76
    const cardW = CELL_SIZE
    const cardH = CELL_HEIGHT
    const cornerRadius = Math.max(0, Math.round(getDebugCfg('gridItemCornerRadius')))
    const borderW = Math.max(1, 8 / cardScale)
    const frameInset = Math.max(3, 2 + Math.ceil(borderW / 2))
    const frameW = Math.max(1, cardW - frameInset * 2)
    const frameH = Math.max(1, cardH - frameInset * 2)
    const frameRadius = Math.max(0, cornerRadius - (frameInset - 3))
    const spriteInset = frameInset + Math.max(2, Math.ceil(borderW / 2))

    const frame = new Graphics()
    frame.roundRect(frameInset, frameInset, frameW, frameH, frameRadius)
    frame.fill({ color: 0x000000, alpha: 0.001 })
    frame.stroke({ color: getTierColor(frameTier), width: borderW, alpha: 0.98 })
    con.addChild(frame)

    const icon = new Sprite(Texture.WHITE)
    const baseCellInner = Math.max(1, CELL_SIZE - spriteInset * 2)
    const spriteSide = Math.max(1, Math.min(frameW, baseCellInner))
    icon.width = spriteSide
    icon.height = spriteSide
    icon.x = frameInset + (frameW - spriteSide) / 2
    icon.y = frameInset + (frameH - spriteSide) / 2
    icon.alpha = 0
    con.addChild(icon)

    void Assets.load<Texture>(getItemIconUrl(item.id)).then((tex) => {
      const sw = Math.max(1, tex.width)
      const sh = Math.max(1, tex.height)
      const scale = Math.min(spriteSide / sw, spriteSide / sh)
      icon.texture = tex
      icon.width = Math.max(1, Math.round(sw * scale))
      icon.height = Math.max(1, Math.round(sh * scale))
      icon.x = frameInset + (frameW - icon.width) / 2
      icon.y = frameInset + (frameH - icon.height) / 2
      icon.alpha = 1
    }).catch(() => {
      // ignore runtime missing icon
    })

    const badges = createItemStatBadges(
      item,
      getDebugCfg('itemStatBadgeFontSize'),
      Math.max(44, cardW - 8),
      undefined,
      'archetype',
      { archetypeSuffix: synthesisLevelLabel(badgeTier, badgeStar) },
    )
    badges.x = cardW / 2
    badges.y = getDebugCfg('itemStatBadgeOffsetY') + 14
    con.addChild(badges)
    con.scale.set(cardScale)
    return con
  }

  // ----------------------------------------------------------
  // 跨 ID 合成確認覆蓋層
  // ----------------------------------------------------------

  teardownCrossSynthesisConfirmOverlay(): void {
    const { ctx } = this
    if (ctx.crossSynthesisConfirmCloseTimer) {
      clearTimeout(ctx.crossSynthesisConfirmCloseTimer)
      ctx.crossSynthesisConfirmCloseTimer = null
    }
    if (ctx.crossSynthesisConfirmTick) {
      Ticker.shared.remove(ctx.crossSynthesisConfirmTick)
      ctx.crossSynthesisConfirmTick = null
    }
    if (ctx.crossSynthesisConfirmOverlay?.parent) {
      ctx.crossSynthesisConfirmOverlay.parent.removeChild(ctx.crossSynthesisConfirmOverlay)
    }
    ctx.crossSynthesisConfirmOverlay?.destroy({ children: true })
    ctx.crossSynthesisConfirmOverlay = null
    ctx.crossSynthesisConfirmAction = null
    const unlock = ctx.crossSynthesisConfirmUnlockInput
    ctx.crossSynthesisConfirmUnlockInput = null
    unlock?.()
  }

  showCrossSynthesisConfirmOverlay(
    sourcePreview: SynthesisPreviewItem,
    targetPreview: SynthesisPreviewItem,
    resultTier: TierKey,
    resultStar: 1 | 2,
    onConfirm: () => void,
    onCancel?: () => void,
  ): void {
    const { ctx, stage } = this
    this.teardownCrossSynthesisConfirmOverlay()

    const prevDragEnabled = ctx.drag?.isEnabled() ?? true
    const prevShopInteractive = ctx.shopPanel?.interactiveChildren ?? false
    const prevBtnInteractive = ctx.btnRow?.interactiveChildren ?? false
    const prevDayInteractive = ctx.dayDebugCon?.interactiveChildren ?? false
    ctx.drag?.setEnabled(false)
    if (ctx.shopPanel) ctx.shopPanel.interactiveChildren = false
    if (ctx.btnRow) ctx.btnRow.interactiveChildren = false
    if (ctx.dayDebugCon) ctx.dayDebugCon.interactiveChildren = false
    ctx.crossSynthesisConfirmUnlockInput = () => {
      if (ctx.drag) ctx.drag.setEnabled(prevDragEnabled)
      if (ctx.shopPanel) ctx.shopPanel.interactiveChildren = prevShopInteractive
      if (ctx.btnRow) ctx.btnRow.interactiveChildren = prevBtnInteractive
      if (ctx.dayDebugCon) ctx.dayDebugCon.interactiveChildren = prevDayInteractive
    }

    const minStartingTier = getCrossSynthesisMinStartingTier(sourcePreview.def, targetPreview.def)
    const forceSynthesisActive = !!(ctx.dayEventState.forceSynthesisArchetype && ctx.dayEventState.forceSynthesisRemaining > 0)
    const preferOtherArchetype = shouldCrossSynthesisPreferOtherArchetype(sourcePreview.def, targetPreview.def) && !forceSynthesisActive
    const candidates = getCrossIdPreviewCandidates(
      sourcePreview.def,
      normalizeSize(targetPreview.def.size),
      resultTier,
      minStartingTier,
      preferOtherArchetype,
    )
    ctx.crossSynthesisConfirmAction = onConfirm

    const overlay = new Container()
    overlay.zIndex = 4100
    overlay.eventMode = 'static'
    overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

    const mask = new Graphics()
    mask.rect(0, 0, CANVAS_W, CANVAS_H)
    mask.fill({ color: 0x060a12, alpha: 0.82 })
    overlay.addChild(mask)

    const panel = new Container()
    panel.x = CANVAS_W / 2
    panel.y = CANVAS_H / 2
    panel.eventMode = 'static'
    panel.on('pointerdown', (e) => e.stopPropagation())
    overlay.addChild(panel)

    const panelW = 592
    const panelH = 700
    const titleY = -268
    const viewportY = -90
    const dontShowAgainY = 62
    const actionBtnStartY = 157
    const actionBtnGap = 34
    const panelBg = new Graphics()
    panelBg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 22)
    panelBg.fill({ color: 0x151c2d, alpha: 0.98 })
    panelBg.stroke({ color: 0x82b6ff, width: 3, alpha: 0.98 })
    panel.addChild(panelBg)

    const title = new Text({
      text: '随机升级',
      style: {
        fontSize: getDebugCfg('synthTitleFontSize'),
        fill: 0xffefc8,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x0a1020, width: 4 },
      },
    })
    title.anchor.set(0.5)
    title.y = titleY
    panel.addChild(title)

    const viewport = new Container()
    viewport.x = 0
    viewport.y = viewportY
    panel.addChild(viewport)

    const viewportW = panelW - 70
    const viewportH = 236
    const viewportBg = new Graphics()
    viewportBg.roundRect(-viewportW / 2, -viewportH / 2, viewportW, viewportH, 18)
    viewportBg.fill({ color: 0x0e1730, alpha: 0.9 })
    viewportBg.stroke({ color: 0x3a5f95, width: 2, alpha: 0.98 })
    viewport.addChild(viewportBg)

    const previewCardVisualSize = Math.round(CELL_SIZE * 0.76)
    const flowCenterY = 8
    const inputACenterX = -166
    const inputBCenterX = -34
    const plusCenterX = Math.round((inputACenterX + inputBCenterX) / 2)
    const resultCenterX = 166
    const arrowCenterX = Math.round((inputBCenterX + resultCenterX) / 2)

    const sourceCardA = this.createCrossSynthesisPreviewCard(sourcePreview.def, sourcePreview.tier, sourcePreview.tier, sourcePreview.star)
    sourceCardA.x = inputACenterX - previewCardVisualSize / 2
    sourceCardA.y = flowCenterY - previewCardVisualSize / 2
    viewport.addChild(sourceCardA)

    const plusText = new Text({
      text: '+',
      style: { fontSize: 58, fill: 0x79b4ff, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x0b1933, width: 4 } },
    })
    plusText.anchor.set(0.5)
    plusText.x = plusCenterX
    plusText.y = flowCenterY
    viewport.addChild(plusText)

    const sourceCardB = this.createCrossSynthesisPreviewCard(targetPreview.def, targetPreview.tier, targetPreview.tier, targetPreview.star)
    sourceCardB.x = inputBCenterX - previewCardVisualSize / 2
    sourceCardB.y = flowCenterY - previewCardVisualSize / 2
    viewport.addChild(sourceCardB)

    const arrowText = new Text({
      text: '→',
      style: { fontSize: 66, fill: 0x8bc3ff, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x0b1933, width: 4 } },
    })
    arrowText.anchor.set(0.5)
    arrowText.x = arrowCenterX
    arrowText.y = flowCenterY
    viewport.addChild(arrowText)

    const resultSlot = new Container()
    resultSlot.x = resultCenterX
    resultSlot.y = flowCenterY
    viewport.addChild(resultSlot)

    const resultMaskFrame = new Graphics()
    resultMaskFrame.roundRect(-64, -94, 128, 188, 16)
    resultMaskFrame.fill({ color: 0x0b1222, alpha: 0.55 })
    resultMaskFrame.stroke({ color: 0x3a5685, width: 2, alpha: 0.95 })
    resultSlot.addChild(resultMaskFrame)

    const resultTrack = new Container()
    resultSlot.addChild(resultTrack)

    const maskRect = new Graphics()
    maskRect.roundRect(-56, -86, 112, 172, 14)
    maskRect.fill({ color: 0xffffff, alpha: 1 })
    resultSlot.addChild(maskRect)
    resultTrack.mask = maskRect

    const resultPool = candidates.length > 0 ? candidates : [sourcePreview.def]
    const cardStep = previewCardVisualSize + 52
    const cardBaseY = -previewCardVisualSize / 2
    const resultCards = resultPool.map((def) => {
      const displayTier = parseTierName(def.starting_tier) ?? 'Bronze'
      const card = this.createCrossSynthesisPreviewCard(def, displayTier, resultTier, resultStar)
      card.x = -previewCardVisualSize / 2
      card.y = cardBaseY
      resultTrack.addChild(card)
      return card
    })

    for (let i = 0; i < resultCards.length; i++) {
      resultCards[i]!.y = cardBaseY - i * cardStep
    }

    if (resultCards.length > 1) {
      let prevTs = Date.now()
      const wrapThreshold = cardBaseY + cardStep
      ctx.crossSynthesisConfirmTick = () => {
        const now = Date.now()
        const dtMs = Math.max(0, now - prevTs)
        prevTs = now
        const speed = Math.max(40, getDebugCfg('crossSynthesisCarouselSpeedPx'))
        const dy = dtMs * (speed / 1000)
        for (const card of resultCards) {
          card.y += dy
          if (card.y > wrapThreshold) {
            card.y -= cardStep * resultCards.length
          }
        }
      }
      Ticker.shared.add(ctx.crossSynthesisConfirmTick)
    }

    let dontShowAgainChecked = false
    const dontShowAgainRow = new Container()
    dontShowAgainRow.y = dontShowAgainY
    dontShowAgainRow.eventMode = 'static'
    dontShowAgainRow.cursor = 'pointer'
    panel.addChild(dontShowAgainRow)

    const dontShowAgainBox = new Graphics()
    const dontShowAgainMark = new Text({
      text: '✓',
      style: { fontSize: 28, fill: 0xeaf4ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    dontShowAgainMark.anchor.set(0.5)
    dontShowAgainMark.x = -154
    dontShowAgainMark.y = 1
    const dontShowAgainLabel = new Text({
      text: '不再显示此提示',
      style: { fontSize: 24, fill: 0xd6e4ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    dontShowAgainLabel.anchor.set(0, 0.5)
    dontShowAgainLabel.x = -130
    dontShowAgainLabel.y = 0

    const redrawDontShowAgain = () => {
      const checked = dontShowAgainChecked
      dontShowAgainBox.clear()
      dontShowAgainBox.roundRect(-172, -18, 34, 34, 8)
      dontShowAgainBox.fill({ color: checked ? 0x4d79b9 : 0x202f49, alpha: 0.98 })
      dontShowAgainBox.stroke({ color: checked ? 0xaed3ff : 0x6e86aa, width: 2, alpha: 0.95 })
      dontShowAgainMark.visible = checked
    }
    redrawDontShowAgain()

    dontShowAgainRow.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      dontShowAgainChecked = !dontShowAgainChecked
      setDebugCfg('gameplayCrossSynthesisConfirm', dontShowAgainChecked ? 0 : 1)
      redrawDontShowAgain()
    })
    dontShowAgainRow.addChild(dontShowAgainBox, dontShowAgainMark, dontShowAgainLabel)

    const closeAsCancel = () => {
      this.teardownCrossSynthesisConfirmOverlay()
      onCancel?.()
    }

    const actionBtnW = 376
    const actionBtnH = 88
    const actionBtnRadius = 18
    const confirmBtn = new Container()
    confirmBtn.y = actionBtnStartY
    confirmBtn.eventMode = 'static'
    confirmBtn.cursor = 'pointer'
    panel.addChild(confirmBtn)

    const confirmBg = new Graphics()
    confirmBtn.addChild(confirmBg)
    const confirmText = new Text({
      text: '确认合成',
      style: { fontSize: getDebugCfg('shopButtonLabelFontSize'), fill: 0x10203a, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    confirmText.anchor.set(0.5)
    confirmBtn.addChild(confirmText)

    let confirmEnabled = false
    const redrawConfirm = () => {
      confirmBg.clear()
      confirmBg.roundRect(-actionBtnW / 2, -actionBtnH / 2, actionBtnW, actionBtnH, actionBtnRadius)
      confirmBg.fill({ color: confirmEnabled ? 0x6dd3ff : 0x536480, alpha: confirmEnabled ? 0.96 : 0.74 })
      confirmBg.stroke({ color: confirmEnabled ? 0xb8e8ff : 0x7f8ea9, width: 3, alpha: 1 })
      confirmText.style.fill = confirmEnabled ? 0x10203a : 0xdbe6ff
    }
    redrawConfirm()

    ctx.crossSynthesisConfirmCloseTimer = setTimeout(() => {
      confirmEnabled = true
      redrawConfirm()
      ctx.crossSynthesisConfirmCloseTimer = null
    }, 360)

    confirmBtn.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      if (!confirmEnabled) return
      const action = ctx.crossSynthesisConfirmAction
      this.teardownCrossSynthesisConfirmOverlay()
      action?.()
    })

    const cancelBtn = new Container()
    cancelBtn.y = confirmBtn.y + actionBtnH + actionBtnGap
    cancelBtn.eventMode = 'static'
    cancelBtn.cursor = 'pointer'
    panel.addChild(cancelBtn)

    const cancelBg = new Graphics()
    cancelBg.roundRect(-actionBtnW / 2, -actionBtnH / 2, actionBtnW, actionBtnH, actionBtnRadius)
    cancelBg.fill({ color: 0x25344d, alpha: 0.9 })
    cancelBg.stroke({ color: 0x5d7597, width: 3, alpha: 1 })
    cancelBtn.addChild(cancelBg)
    const cancelText = new Text({
      text: '取消',
      style: { fontSize: getDebugCfg('shopButtonLabelFontSize'), fill: 0xc9d6ef, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    cancelText.anchor.set(0.5)
    cancelBtn.addChild(cancelText)
    cancelBtn.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      closeAsCancel()
    })

    overlay.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      closeAsCancel()
    })

    ctx.crossSynthesisConfirmOverlay = overlay
    stage.addChild(overlay)
  }
}
