// ============================================================
// SkillDraftPanel — 技能草稿三選一覆蓋層面板
// 從 ShopScene.ts 提取，使用 Class 方式（繼承 Container）
// 包含：
//   ensureSkillDraftSelection（主入口，含完整 overlay 建構）
//   closeSkillDraftOverlay
//   layoutSkillIconBar
//   refreshSkillIconBar
//   showSkillDetailPopup / hideSkillDetailPopup
// ============================================================

import {
  Container, Graphics, Text, Sprite,
  Assets, Texture, Rectangle,
  type FederatedPointerEvent,
} from 'pixi.js'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { getConfig } from '@/core/DataLoader'
import { getSkillIconUrl } from '@/core/AssetPath'
import { getBronzeSkillById } from '@/common/skills/BronzeSkillConfig'
import { getSilverSkillById } from '@/common/skills/SilverSkillConfig'
import { getGoldSkillById } from '@/common/skills/GoldSkillConfig'
import { CELL_SIZE } from '@/common/grid/GridZone'
import type { SkillTier } from '@/common/items/ItemDef'
import type { ShopSceneCtx, SkillPick, ToastReason } from '../ShopSceneContext'

import { CANVAS_W, CANVAS_H } from '@/config/layoutConstants'
import { getItemInfoPanelBottomAnchorByBattle } from '../ShopMathHelpers'

// ---- 技能草稿功能開關（與 ShopScene.ts 保持一致）----
const SKILL_DRAFT_ENABLED = true

// ============================================================
// Callbacks interface
// ============================================================

export interface SkillDraftCallbacks {
  captureAndSave: () => void
  clearSelection: () => void
  setTransitionInputEnabled: (enabled: boolean) => void
  setBaseShopPrimaryButtonsVisible: (visible: boolean) => void
  applyPhaseInputLock: () => void
  upsertPickedSkill: (skillId: string) => void
  getSkillTierForDay: (day: number) => SkillTier | null
  pickSkillChoices: (baseTier: SkillTier, day: number) => SkillPick[]
  pickSkillChoicesNoOverlap: (baseTier: SkillTier, day: number, blockedIds: Set<string>) => SkillPick[]
  pickSkillChoicesExactTier: (baseTier: SkillTier, blockedIds?: Set<string>) => SkillPick[]
  shouldShowSimpleDescriptions: () => boolean
  isSkillDraftRerollEnabled: () => boolean
  getDefaultSkillDetailMode: () => 'simple' | 'detailed'
  showHintToast: (reason: ToastReason, msg: string, color?: number) => void
  resetInfoModeSelection: () => void
  applySellButtonState: () => void
}

// ============================================================
// SkillDraftPanel class
// ============================================================

export class SkillDraftPanel extends Container {
  private ctx: ShopSceneCtx
  private stage: Container
  private cb: SkillDraftCallbacks

  constructor(ctx: ShopSceneCtx, stage: Container, callbacks: SkillDraftCallbacks) {
    super()
    this.ctx = ctx
    this.stage = stage
    this.cb = callbacks
  }

  // ============================================================
  // 技能圖標欄
  // ============================================================

  layoutSkillIconBar(): void {
    const ctx = this.ctx
    if (!ctx.skillIconBarCon || !ctx.battleView) return
    const battleWidth = ctx.battleView.activeColCount * CELL_SIZE * ctx.battleView.scale.x
    ctx.skillIconBarCon.x = ctx.battleView.x + battleWidth / 2
    ctx.skillIconBarCon.y = ctx.battleView.y - 92
  }

  refreshSkillIconBar(): void {
    const ctx = this.ctx
    const stage = this.stage
    if (!ctx.battleView) return
    if (!ctx.skillIconBarCon) {
      ctx.skillIconBarCon = new Container()
      ctx.skillIconBarCon.zIndex = 180
      stage.addChild(ctx.skillIconBarCon)
    }
    const con = ctx.skillIconBarCon
    // 关闭技能三选一时，仍允许显示"已持有技能"（例如测试面板手动添加）
    con.removeChildren().forEach((c) => c.destroy({ children: true }))
    if (ctx.pickedSkills.length <= 0) {
      con.visible = false
      return
    }

    const gap = -30
    const iconSize = 128
    const rowW = ctx.pickedSkills.length * iconSize + Math.max(0, ctx.pickedSkills.length - 1) * gap

    for (let i = 0; i < ctx.pickedSkills.length; i++) {
      const s = ctx.pickedSkills[i]!
      const cell = new Container()
      cell.eventMode = 'static'
      cell.cursor = 'pointer'
      const x = -rowW / 2 + i * (iconSize + gap) + iconSize / 2
      const hit = new Graphics()
      hit.roundRect(x - iconSize / 2, -iconSize / 2, iconSize, iconSize, 14)
      hit.fill({ color: 0x000000, alpha: 0.001 })
      cell.addChild(hit)

      const letter = new Text({
        text: s.name.slice(0, 1),
        style: { fontSize: 24, fill: 0xf5f7ff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      letter.anchor.set(0.5)
      letter.x = x
      letter.y = 0
      cell.addChild(letter)
      this._mountSkillIconSprite(cell, s.id, s.icon, x, 0, iconSize, letter)

      cell.on('pointerdown', (e: FederatedPointerEvent) => {
        e.stopPropagation()
        if (ctx.skillDetailSkillId === s.id) {
          if (this.cb.shouldShowSimpleDescriptions()) {
            ctx.skillDetailMode = ctx.skillDetailMode === 'simple' ? 'detailed' : 'simple'
          } else {
            ctx.skillDetailMode = 'detailed'
          }
          this.showSkillDetailPopup(s)
        } else {
          ctx.currentSelection = { kind: 'none' }
          ctx.selectedSellAction = null
          this.cb.resetInfoModeSelection()
          ctx.shopPanel?.setSelectedSlot(-1)
          ctx.battleView?.setSelected(null)
          ctx.backpackView?.setSelected(null)
          ctx.sellPopup?.hide()
          this.cb.applySellButtonState()
          ctx.skillDetailMode = this.cb.getDefaultSkillDetailMode()
          this.showSkillDetailPopup(s)
        }
      })

      con.addChild(cell)
    }

    con.visible = true
    this.layoutSkillIconBar()
  }

  // ============================================================
  // 技能詳情彈窗
  // ============================================================

  hideSkillDetailPopup(): void {
    const ctx = this.ctx
    ctx.skillDetailSkillId = null
    ctx.skillDetailMode = this.cb.getDefaultSkillDetailMode()
    if (ctx.skillDetailPopupCon) ctx.skillDetailPopupCon.visible = false
  }

  showSkillDetailPopup(skill: SkillPick): void {
    const ctx = this.ctx
    const stage = this.stage
    if (!ctx.skillDetailPopupCon) {
      const con = new Container()
      con.zIndex = 220
      con.eventMode = 'none'
      con.visible = false
      stage.addChild(con)
      ctx.skillDetailPopupCon = con
    }
    const con = ctx.skillDetailPopupCon
    con.removeChildren().forEach((c) => c.destroy({ children: true }))

    const panelW = Math.max(360, Math.min(CANVAS_W - 24, getDebugCfg('itemInfoWidth')))
    const pad = 16
    const iconSize = 128
    const iconX = pad
    const iconY = pad
    const textX = iconX + iconSize + 16
    const textW = panelW - textX - pad
    const titleFontSize = getDebugCfg('itemInfoNameFontSize')
    const descFontSize = getDebugCfg('itemInfoSimpleDescFontSize')
    const mode = this.cb.shouldShowSimpleDescriptions() ? ctx.skillDetailMode : 'detailed'
    const shownDesc = mode === 'detailed' ? (skill.detailDesc ?? skill.desc) : skill.desc

    const title = new Text({
      text: skill.name,
      style: { fontSize: titleFontSize, fill: 0xffefc8, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    const tierBadge = new Text({
      text: this._skillTierLabelCn(skill.tier),
      style: {
        fontSize: Math.max(16, Math.round(titleFontSize * 0.7)),
        fill: 0xfff3cf,
        fontFamily: 'Arial',
        fontWeight: 'bold',
      },
    })
    const desc = new Text({
      text: shownDesc,
      style: {
        fontSize: descFontSize,
        fill: 0xd7e2fa,
        fontFamily: 'Arial',
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: textW,
        lineHeight: Math.round(descFontSize * 1.25),
      },
    })

    const dividerY = iconY + 44
    const descY = dividerY + 12
    const contentBottom = Math.max(iconY + iconSize, descY + desc.height)
    const panelH = Math.max(getDebugCfg('itemInfoMinHSmall'), contentBottom + pad)
    const px = CANVAS_W / 2 - panelW / 2
    let panelBottomY = getItemInfoPanelBottomAnchorByBattle(ctx)
    if (ctx.skillIconBarCon?.visible) {
      panelBottomY = Math.min(panelBottomY, ctx.skillIconBarCon.y - 44)
    }
    const py = panelBottomY - panelH

    const bg = new Graphics()
    bg.roundRect(px, py, panelW, panelH, Math.max(0, getDebugCfg('gridItemCornerRadius')))
    bg.fill({ color: 0x1e1e30, alpha: 0.97 })
    bg.stroke({ color: 0x5566aa, width: 2, alpha: 1 })
    con.addChild(bg)

    const iconLetter = new Text({
      text: skill.name.slice(0, 1),
      style: { fontSize: 56, fill: 0xf5f7ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    iconLetter.anchor.set(0.5)
    iconLetter.x = px + iconX + iconSize / 2
    iconLetter.y = py + iconY + iconSize / 2 + 2
    con.addChild(iconLetter)
    this._mountSkillIconSprite(con, skill.id, skill.icon, px + iconX + iconSize / 2, py + iconY + iconSize / 2 + 2, iconSize, iconLetter)

    title.x = px + textX
    title.y = py + iconY + 2
    con.addChild(title)
    if (mode === 'detailed') {
      const badgePadX = 10
      const badgePadY = 4
      const badgeX = title.x + title.width + 12
      const badgeY = title.y + 2
      const badgeBg = new Graphics()
      badgeBg.roundRect(
        badgeX - badgePadX,
        badgeY - badgePadY,
        tierBadge.width + badgePadX * 2,
        tierBadge.height + badgePadY * 2,
        8,
      )
      badgeBg.fill({ color: this._skillTierColor(skill.tier), alpha: 0.45 })
      con.addChild(badgeBg)
      tierBadge.x = badgeX
      tierBadge.y = badgeY
      con.addChild(tierBadge)
    }

    const divider = new Graphics()
    divider.moveTo(px + textX, py + dividerY)
    divider.lineTo(px + panelW - pad, py + dividerY)
    divider.stroke({ color: 0x5a628f, width: 1, alpha: 0.9 })
    con.addChild(divider)

    desc.x = px + textX
    desc.y = py + descY
    con.addChild(desc)

    ctx.skillDetailSkillId = skill.id
    con.visible = true
  }

  // ============================================================
  // 技能草稿覆蓋層
  // ============================================================

  closeSkillDraftOverlay(): void {
    const ctx = this.ctx
    if (ctx.skillDraftOverlay?.parent) ctx.skillDraftOverlay.parent.removeChild(ctx.skillDraftOverlay)
    ctx.skillDraftOverlay?.destroy({ children: true })
    ctx.skillDraftOverlay = null
  }

  ensureSkillDraftSelection(): void {
    const ctx = this.ctx
    const stage = this.stage
    const cb = this.cb

    if (!SKILL_DRAFT_ENABLED) {
      ctx.pendingSkillDraft = null
      this.closeSkillDraftOverlay()
      return
    }
    if (ctx.classSelectOverlay) return
    if (ctx.starterGuideOverlay) return
    if (ctx.skillDraftOverlay) return
    const skillCfg = getConfig().skillSystem
    if (!skillCfg) return

    let draft = ctx.pendingSkillDraft
    if (!draft) {
      const tier = cb.getSkillTierForDay(ctx.currentDay)
      if (!tier) return
      if (ctx.draftedSkillDays.includes(ctx.currentDay)) return
      const choices = cb.pickSkillChoices(tier, ctx.currentDay)
      if (choices.length <= 0) return
      draft = { day: ctx.currentDay, tier, choices, rerolled: false }
      ctx.pendingSkillDraft = draft
    }

    if (draft.choices.length <= 0) return

    cb.setTransitionInputEnabled(false)
    cb.setBaseShopPrimaryButtonsVisible(false)
    cb.clearSelection()

    const overlay = new Container()
    overlay.zIndex = 3500
    overlay.eventMode = 'static'
    overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

    const bg = new Graphics()
    bg.rect(0, 0, CANVAS_W, CANVAS_H)
    bg.fill({ color: 0x070d1d, alpha: 0.92 })
    overlay.addChild(bg)

    const title = new Text({
      text: '技能选择',
      style: { fontSize: 42, fill: 0xfff2cf, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    title.anchor.set(0.5)
    title.x = CANVAS_W / 2
    title.y = 228
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

    const shownChoices = draft.choices.slice(0, 2)
    let selectedSkillId: string | null = null
    const selectedFrameById = new Map<string, Graphics>()
    const descTextById = new Map<string, Text>()
    const confirmAreaById = new Map<string, Container>()
    const cardW = 238
    const cardH = 470
    const gapX = shownChoices.length === 2 ? 50 : 16
    const totalW = cardW * shownChoices.length + gapX * Math.max(0, shownChoices.length - 1)
    const cardX = (CANVAS_W - totalW) / 2
    const cardY = 580

    const commitDraftSkillPick = (skillId: string): void => {
      cb.upsertPickedSkill(skillId)
      ctx.draftedSkillDays = Array.from(new Set([...ctx.draftedSkillDays, draft!.day])).sort((a, b) => a - b)
      ctx.pendingSkillDraft = null
      this.closeSkillDraftOverlay()
      this.refreshSkillIconBar()
      cb.setBaseShopPrimaryButtonsVisible(true)
      cb.setTransitionInputEnabled(true)
      cb.applyPhaseInputLock()
      ctx.events.emit('REFRESH_SHOP_UI')
      cb.captureAndSave()
    }

    const applyDraftSelection = (skillId: string): void => {
      selectedSkillId = skillId
      for (const choice of shownChoices) {
        const selected = choice.id === selectedSkillId
        const frame = selectedFrameById.get(choice.id)
        if (frame) frame.visible = selected
        const desc = descTextById.get(choice.id)
        if (desc) desc.text = selected || !cb.shouldShowSimpleDescriptions() ? (choice.detailDesc ?? choice.desc) : choice.desc
        const confirmArea = confirmAreaById.get(choice.id)
        if (confirmArea) confirmArea.visible = selected
      }
    }

    shownChoices.forEach((choice, idx) => {
      const con = new Container()
      con.x = cardX + idx * (cardW + gapX)
      con.y = cardY
      con.eventMode = 'static'
      con.cursor = 'pointer'
      con.hitArea = new Rectangle(0, 0, cardW, cardH)

      const border = new Graphics()
      border.roundRect(0, 0, cardW, cardH, 24)
      border.fill({ color: 0x18263e, alpha: 0.96 })
      border.stroke({ color: this._skillTierColor(choice.tier), width: 3, alpha: 1 })
      con.addChild(border)

      const selectedFrame = new Graphics()
      selectedFrame.roundRect(3, 3, cardW - 6, cardH - 6, 22)
      selectedFrame.stroke({ color: 0xffe28a, width: 5, alpha: 1 })
      selectedFrame.visible = false
      con.addChild(selectedFrame)
      selectedFrameById.set(choice.id, selectedFrame)

      const iconText = new Text({
        text: choice.name.slice(0, 1),
        style: { fontSize: 54, fill: 0xf5f8ff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      iconText.anchor.set(0.5)
      iconText.x = cardW / 2
      iconText.y = 108
      con.addChild(iconText)
      this._mountSkillIconSprite(con, choice.id, choice.icon, cardW / 2, 108, 160, iconText)

      const name = new Text({
        text: choice.name,
        style: {
          fontSize: 30,
          fill: 0xf5e7bf,
          fontFamily: 'Arial',
          fontWeight: 'bold',
          wordWrap: true,
          wordWrapWidth: cardW - 30,
          breakWords: true,
        },
      })
      name.anchor.set(0.5, 0)
      name.x = cardW / 2
      name.y = 184
      con.addChild(name)

      const qualityText = new Text({
        text: this._skillTierLabelCn(choice.tier),
        style: {
          fontSize: 20,
          fill: 0xfff3cf,
          fontFamily: 'Arial',
          fontWeight: 'bold',
        },
      })
      qualityText.anchor.set(0.5, 0)
      qualityText.x = cardW / 2
      qualityText.y = 246
      const qualityPadX = 10
      const qualityPadY = 4
      const qualityBg = new Graphics()
      qualityBg.roundRect(
        qualityText.x - qualityText.width / 2 - qualityPadX,
        qualityText.y - qualityPadY,
        qualityText.width + qualityPadX * 2,
        qualityText.height + qualityPadY * 2,
        8,
      )
      qualityBg.fill({ color: this._skillTierColor(choice.tier), alpha: 0.45 })
      qualityBg.stroke({ color: 0xe8f0ff, width: 1, alpha: 0.6 })
      con.addChild(qualityBg)
      con.addChild(qualityText)

      const desc = new Text({
        text: cb.shouldShowSimpleDescriptions() ? choice.desc : (choice.detailDesc ?? choice.desc),
        style: {
          fontSize: 22,
          fill: 0xd4def1,
          fontFamily: 'Arial',
          wordWrap: true,
          breakWords: true,
          wordWrapWidth: cardW - 28,
          lineHeight: 29,
        },
      })
      desc.x = 14
      desc.y = 308
      con.addChild(desc)
      descTextById.set(choice.id, desc)

      const confirmArea = new Container()
      confirmArea.eventMode = 'none'
      confirmArea.visible = false
      const confirmAreaText = new Text({
        text: '点击选择',
        style: { fontSize: 22, fill: 0xdce6ff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      confirmAreaText.anchor.set(0.5)
      confirmAreaText.x = cardW / 2
      confirmAreaText.y = cardH - 42
      confirmArea.addChild(confirmAreaText)
      con.addChild(confirmArea)
      confirmAreaById.set(choice.id, confirmArea)

      con.on('pointerdown', (e: FederatedPointerEvent) => {
        e.stopPropagation()
        if (selectedSkillId === choice.id) {
          commitDraftSkillPick(choice.id)
          return
        }
        applyDraftSelection(choice.id)
      })

      overlay.addChild(con)
    })

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
      text: '按住查看布局',
      style: { fontSize: actionBtnFontSize, fill: 0xeaf4ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    holdTxt.anchor.set(0.5)
    holdTxt.x = actionBtnW / 2
    holdTxt.y = actionBtnH / 2
    holdBtn.addChild(holdBg, holdTxt)

    const setHoldView = (holding: boolean): void => {
      cb.setBaseShopPrimaryButtonsVisible(false)
      title.visible = !holding
      bg.alpha = holding ? 0.16 : 0.92
      for (const child of overlay.children) {
        if (child === bg || child === holdBtn) continue
        child.visible = !holding
      }
      if (!holding) {
        goldInfo.visible = false
        forceLeaveBtn.visible = false
        redrawOverlayStatus()
      }
    }

    holdBtn.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      setHoldView(true)
    })
    holdBtn.on('pointerup', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      setHoldView(false)
    })
    holdBtn.on('pointerupoutside', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      setHoldView(false)
    })
    overlay.addChild(holdBtn)

    const forceLeaveBtn = new Container()
    forceLeaveBtn.eventMode = 'static'
    forceLeaveBtn.cursor = 'pointer'
    forceLeaveBtn.x = actionBtnStartX + (actionBtnW + actionBtnGap) * 2
    forceLeaveBtn.y = actionBtnY
    const forceLeaveBg = new Graphics()
    forceLeaveBg.roundRect(0, 0, actionBtnW, actionBtnH, 20)
    forceLeaveBg.fill({ color: 0x4d6f99, alpha: 0.95 })
    forceLeaveBg.stroke({ color: 0xa5cfff, width: 3, alpha: 0.95 })
    const forceLeaveText = new Text({
      text: '强行离开',
      style: { fontSize: actionBtnFontSize, fill: 0xeaf4ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    forceLeaveText.anchor.set(0.5)
    forceLeaveText.x = actionBtnW / 2
    forceLeaveText.y = actionBtnH / 2
    forceLeaveBtn.addChild(forceLeaveBg, forceLeaveText)
    forceLeaveBtn.visible = false
    overlay.addChild(forceLeaveBtn)

    let forceLeaveConfirmLayer: Container | null = null
    const closeForceLeaveConfirm = () => {
      if (!forceLeaveConfirmLayer) return
      if (forceLeaveConfirmLayer.parent) forceLeaveConfirmLayer.parent.removeChild(forceLeaveConfirmLayer)
      forceLeaveConfirmLayer.destroy({ children: true })
      forceLeaveConfirmLayer = null
    }
    const openForceLeaveConfirm = () => {
      closeForceLeaveConfirm()
      const layer = new Container()
      layer.zIndex = 3510
      layer.eventMode = 'static'
      layer.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

      const dim = new Graphics()
      dim.rect(0, 0, CANVAS_W, CANVAS_H)
      dim.fill({ color: 0x000000, alpha: 0.45 })
      layer.addChild(dim)

      const panel = new Container()
      panel.x = CANVAS_W / 2
      panel.y = CANVAS_H / 2
      panel.eventMode = 'static'
      panel.on('pointerdown', (e) => e.stopPropagation())
      const pbg = new Graphics()
      pbg.roundRect(-250, -130, 500, 260, 24)
      pbg.fill({ color: 0x13213a, alpha: 0.98 })
      pbg.stroke({ color: 0x9ec2ff, width: 3, alpha: 0.95 })
      panel.addChild(pbg)

      const msg = new Text({
        text: '是否不进行任何选择就离开？',
        style: { fontSize: 30, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      msg.anchor.set(0.5)
      msg.y = -42
      panel.addChild(msg)

      const cancelBtn = new Container()
      cancelBtn.x = -120
      cancelBtn.y = 54
      cancelBtn.eventMode = 'static'
      cancelBtn.cursor = 'pointer'
      const cancelBg = new Graphics()
      cancelBg.roundRect(-100, -34, 200, 68, 16)
      cancelBg.fill({ color: 0x4d6f99, alpha: 0.96 })
      cancelBg.stroke({ color: 0xa5cfff, width: 3, alpha: 0.95 })
      const cancelText = new Text({ text: '取消', style: { fontSize: 28, fill: 0xeaf4ff, fontFamily: 'Arial', fontWeight: 'bold' } })
      cancelText.anchor.set(0.5)
      cancelBtn.addChild(cancelBg, cancelText)
      cancelBtn.on('pointerdown', (e) => {
        e.stopPropagation()
        closeForceLeaveConfirm()
      })
      panel.addChild(cancelBtn)

      const okBtn = new Container()
      okBtn.x = 120
      okBtn.y = 54
      okBtn.eventMode = 'static'
      okBtn.cursor = 'pointer'
      const okBg = new Graphics()
      okBg.roundRect(-100, -34, 200, 68, 16)
      okBg.fill({ color: 0xffd86b, alpha: 0.96 })
      okBg.stroke({ color: 0xffefad, width: 3, alpha: 0.95 })
      const okText = new Text({ text: '确认离开', style: { fontSize: 28, fill: 0x10213a, fontFamily: 'Arial', fontWeight: 'bold' } })
      okText.anchor.set(0.5)
      okBtn.addChild(okBg, okText)
      okBtn.on('pointerdown', (e) => {
        e.stopPropagation()
        ctx.draftedSkillDays = Array.from(new Set([...ctx.draftedSkillDays, draft!.day])).sort((a, b) => a - b)
        ctx.pendingSkillDraft = null
        closeForceLeaveConfirm()
        this.closeSkillDraftOverlay()
        cb.setBaseShopPrimaryButtonsVisible(true)
        cb.setTransitionInputEnabled(true)
        cb.applyPhaseInputLock()
        ctx.events.emit('REFRESH_SHOP_UI')
        cb.captureAndSave()
      })
      panel.addChild(okBtn)

      layer.addChild(panel)
      layer.on('pointerdown', () => closeForceLeaveConfirm())
      overlay.addChild(layer)
      forceLeaveConfirmLayer = layer
    }
    forceLeaveBtn.on('pointerdown', (e) => {
      e.stopPropagation()
      openForceLeaveConfirm()
    })

    const redrawRerollBtn = () => {
      const canReroll = cb.isSkillDraftRerollEnabled() && !(draft?.rerolled === true)
      const can = canReroll
      rerollBg.clear()
      rerollBg.roundRect(0, 0, actionBtnW, actionBtnH, 20)
      rerollBg.fill({ color: can ? 0xffd86b : 0x8a6e4b, alpha: 0.95 })
      rerollBg.stroke({ color: can ? 0xffefad : 0xb89d78, width: 3, alpha: 0.95 })
      rerollText.style.fill = can ? 0x10213a : 0xd7c4a8
      rerollBtn.visible = canReroll
      rerollText.text = '刷新'
      rerollText.x = actionBtnW / 2
      rerollText.y = actionBtnH / 2
    }

    const redrawGoldInfo = () => {
      goldInfo.text = `当前持有金币：${Math.max(0, Math.round(ctx.shopManager?.gold ?? 0))}`
    }

    const redrawOverlayStatus = () => {
      redrawGoldInfo()
      redrawRerollBtn()
    }

    rerollBtn.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      if (!cb.isSkillDraftRerollEnabled()) return
      if (draft?.rerolled === true) return
      const blocked = new Set(shownChoices.map((it) => it.id))
      const nextChoices = draft?.fixedTier
        ? cb.pickSkillChoicesExactTier(draft.tier, blocked)
        : cb.pickSkillChoicesNoOverlap(draft!.tier, ctx.currentDay, blocked)
      if (nextChoices.length < 2) {
        cb.showHintToast('no_gold_refresh', '可刷新候选不足', 0xff8f8f)
        return
      }
      ctx.pendingSkillDraft = {
        day: ctx.currentDay,
        tier: draft!.tier,
        choices: nextChoices,
        rerolled: true,
        fixedTier: draft?.fixedTier === true,
      }
      this.closeSkillDraftOverlay()
      ctx.events.emit('REFRESH_SHOP_UI')
      cb.captureAndSave()
      this.ensureSkillDraftSelection()
    })

    redrawOverlayStatus()

    ctx.skillDraftOverlay = overlay
    stage.addChild(overlay)
  }

  // ============================================================
  // Private helpers
  // ============================================================

  private _skillTierLabelCn(tier: SkillTier): string {
    if (tier === 'bronze') return '青铜'
    if (tier === 'silver') return '白银'
    return '黄金'
  }

  private _skillTierColor(tier: SkillTier): number {
    if (tier === 'bronze') return 0xbe8b46
    if (tier === 'silver') return 0x9aafc8
    return 0xd0ac43
  }

  private _mountSkillIconSprite(
    parent: Container,
    skillId: string,
    iconStem: string | undefined,
    centerX: number,
    centerY: number,
    iconSize: number,
    fallback: Text,
  ): void {
    const stemRaw = iconStem
      ?? getBronzeSkillById(skillId)?.icon
      ?? getSilverSkillById(skillId)?.icon
      ?? getGoldSkillById(skillId)?.icon
      ?? (/^skill\d+$/.test(skillId) ? skillId : undefined)
    const stem = stemRaw ? stemRaw.replace(/\.png$/i, '').trim() : ''
    if (!stem) return
    const iconUrl = getSkillIconUrl(stem)
    const sprite = new Sprite(Texture.WHITE)
    sprite.anchor.set(0.5)
    sprite.x = centerX
    sprite.y = centerY
    sprite.alpha = 0
    parent.addChild(sprite)

    void Assets.load<Texture>(iconUrl).then((tex) => {
      const side = Math.round(iconSize * 0.78)
      const sw = Math.max(1, tex.width)
      const sh = Math.max(1, tex.height)
      const scale = Math.min(side / sw, side / sh)
      sprite.texture = tex
      sprite.width = Math.max(1, Math.round(sw * scale))
      sprite.height = Math.max(1, Math.round(sh * scale))
      sprite.alpha = 1
      fallback.visible = false
    }).catch(() => {
      sprite.destroy()
    })
  }
}
