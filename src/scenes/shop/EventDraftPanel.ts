// ============================================================
// EventDraftPanel — 事件草稿選擇覆蓋層面板
// 從 ShopScene.ts 提取，使用 Class 方式（繼承 Container）
// 包含：
//   ensureEventDraftSelection（主入口，含完整 overlay 建構）
//   closeEventDraftOverlay
// ============================================================

import {
  Container, Graphics, Text, Sprite,
  Assets, Texture, Rectangle,
  type FederatedPointerEvent,
} from 'pixi.js'
import { getEventIconUrl } from '@/core/assetPath'
import type { ShopSceneCtx, EventChoice, ToastReason } from './ShopSceneContext'

import { CANVAS_W, CANVAS_H } from '@/config/layoutConstants'

// ============================================================
// Callbacks interface
// ============================================================

export interface EventDraftCallbacks {
  captureAndSave: () => void
  clearSelection: () => void
  setTransitionInputEnabled: (enabled: boolean) => void
  setBaseShopPrimaryButtonsVisible: (visible: boolean) => void
  applyPhaseInputLock: () => void
  applyEventEffect: (event: EventChoice, fromTest: boolean) => boolean
  markEventSelected: (eventId: string) => void
  getDailyPlanRow: (day: number) => Record<string, unknown> | null
  pickRandomEventDraftChoices: (day: number) => EventChoice[]
  pickRandomEventDraftChoicesNoOverlap: (day: number, blockedIds: Set<string>) => EventChoice[]
  resolveEventDescText: (event: EventChoice, detailed: boolean) => string
  shouldShowSimpleDescriptions: () => boolean
  isEventDraftRerollEnabled: () => boolean
  showHintToast: (reason: ToastReason, msg: string, color?: number) => void
}

// ============================================================
// EventDraftPanel class
// ============================================================

export class EventDraftPanel extends Container {
  private ctx: ShopSceneCtx
  private stage: Container
  private cb: EventDraftCallbacks

  constructor(ctx: ShopSceneCtx, stage: Container, callbacks: EventDraftCallbacks) {
    super()
    this.ctx = ctx
    this.stage = stage
    this.cb = callbacks
  }

  // ============================================================
  // 事件草稿覆蓋層
  // ============================================================

  closeEventDraftOverlay(): void {
    const ctx = this.ctx
    if (!ctx.eventDraftOverlay) return
    if (ctx.eventDraftOverlay.parent) ctx.eventDraftOverlay.parent.removeChild(ctx.eventDraftOverlay)
    ctx.eventDraftOverlay.destroy({ children: true })
    ctx.eventDraftOverlay = null
  }

  ensureEventDraftSelection(): void {
    const ctx = this.ctx
    const stage = this.stage
    const cb = this.cb

    if (ctx.classSelectOverlay) return
    if (ctx.starterGuideOverlay) return
    if (ctx.skillDraftOverlay) return
    if (ctx.eventDraftOverlay) return

    const hasPendingDraft = !!(ctx.pendingEventDraft && ctx.pendingEventDraft.day === ctx.currentDay)
    if (!hasPendingDraft) {
      const plan = cb.getDailyPlanRow(ctx.currentDay)
      const shouldEvent = (Number(plan?.shouldEvent) || 0) >= 0.5
      if (!shouldEvent) {
        ctx.pendingEventDraft = null
        this.closeEventDraftOverlay()
        return
      }
      if (ctx.draftedEventDays.includes(ctx.currentDay)) return
    }

    let draft = ctx.pendingEventDraft
    if (!draft || draft.day !== ctx.currentDay) {
      const choices = cb.pickRandomEventDraftChoices(ctx.currentDay)
      if (choices.length <= 0) {
        ctx.draftedEventDays = Array.from(new Set([...ctx.draftedEventDays, ctx.currentDay])).sort((a, b) => a - b)
        cb.captureAndSave()
        return
      }
      draft = { day: ctx.currentDay, choices: choices.slice(0, 2), rerolled: false }
      ctx.pendingEventDraft = draft
    }

    cb.setTransitionInputEnabled(false)
    cb.clearSelection()

    const overlay = new Container()
    overlay.zIndex = 3520
    overlay.eventMode = 'static'
    overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

    const bg = new Graphics()
    bg.rect(0, 0, CANVAS_W, CANVAS_H)
    bg.fill({ color: 0x070d1d, alpha: 0.92 })
    overlay.addChild(bg)

    const title = new Text({
      text: '事件选择',
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
    let selectedEventId: string | null = null
    const selectedFrameById = new Map<string, Graphics>()
    const descTextById = new Map<string, Text>()
    const confirmAreaById = new Map<string, Container>()
    const cardW = 238
    const cardH = 470
    const gapX = shownChoices.length === 2 ? 50 : 16
    const totalW = cardW * shownChoices.length + gapX * Math.max(0, shownChoices.length - 1)
    const cardX = (CANVAS_W - totalW) / 2
    const cardY = 580

    const commitEventPick = (event: EventChoice): void => {
      cb.markEventSelected(event.id)
      ctx.draftedEventDays = Array.from(new Set([...ctx.draftedEventDays, draft!.day])).sort((a, b) => a - b)
      ctx.pendingEventDraft = null
      this.closeEventDraftOverlay()
      cb.setBaseShopPrimaryButtonsVisible(true)
      cb.applyEventEffect(event, false)
      cb.setTransitionInputEnabled(true)
      cb.applyPhaseInputLock()
      ctx.events.emit('REFRESH_SHOP_UI')
      cb.captureAndSave()
    }

    const applyEventSelection = (eventId: string): void => {
      selectedEventId = eventId
      for (const choice of shownChoices) {
        const selected = choice.id === selectedEventId
        const frame = selectedFrameById.get(choice.id)
        if (frame) frame.visible = selected
        const desc = descTextById.get(choice.id)
        if (desc) desc.text = cb.resolveEventDescText(choice, selected || !cb.shouldShowSimpleDescriptions())
        const confirm = confirmAreaById.get(choice.id)
        if (confirm) confirm.visible = selected
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
      border.stroke({ color: 0x7cc6ff, width: 3, alpha: 1 })
      con.addChild(border)

      const selectedFrame = new Graphics()
      selectedFrame.roundRect(3, 3, cardW - 6, cardH - 6, 22)
      selectedFrame.stroke({ color: 0xffe28a, width: 5, alpha: 1 })
      selectedFrame.visible = false
      con.addChild(selectedFrame)
      selectedFrameById.set(choice.id, selectedFrame)

      const iconText = new Text({
        text: choice.id.replace('event', 'E'),
        style: { fontSize: 36, fill: 0xf5f8ff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      iconText.anchor.set(0.5)
      iconText.x = cardW / 2
      iconText.y = 108
      con.addChild(iconText)
      this._mountEventIconSprite(con, choice.id, choice.icon, cardW / 2, 108, 160, iconText)

      const detail = new Text({
        text: cb.resolveEventDescText(choice, !cb.shouldShowSimpleDescriptions()),
        style: {
          fontSize: 24,
          fill: 0xffefc8,
          fontFamily: 'Arial',
          fontWeight: 'bold',
          wordWrap: true,
          breakWords: true,
          wordWrapWidth: cardW - 28,
          lineHeight: 32,
          align: 'center',
        },
      })
      detail.anchor.set(0.5, 0)
      detail.x = cardW / 2
      detail.y = 216
      con.addChild(detail)
      descTextById.set(choice.id, detail)

      const confirmArea = new Container()
      confirmArea.visible = false
      const pickBtnTxt = new Text({
        text: '点击选择',
        style: { fontSize: 28, fill: 0x8fe6b2, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      pickBtnTxt.anchor.set(0.5)
      pickBtnTxt.x = cardW / 2
      pickBtnTxt.y = cardH - 46
      confirmArea.addChild(pickBtnTxt)
      con.addChild(confirmArea)
      confirmAreaById.set(choice.id, confirmArea)

      con.on('pointerdown', (e: FederatedPointerEvent) => {
        e.stopPropagation()
        if (selectedEventId === choice.id) commitEventPick(choice)
        else applyEventSelection(choice.id)
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
    holdBtn.x = actionBtnStartX
    holdBtn.y = actionBtnY
    holdBtn.eventMode = 'static'
    holdBtn.cursor = 'pointer'
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
      for (const c of overlay.children) {
        if (c === bg || c === holdBtn) continue
        c.visible = !holding
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
      layer.zIndex = 3530
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
        ctx.draftedEventDays = Array.from(new Set([...ctx.draftedEventDays, draft!.day])).sort((a, b) => a - b)
        ctx.pendingEventDraft = null
        closeForceLeaveConfirm()
        this.closeEventDraftOverlay()
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
      const canReroll = cb.isEventDraftRerollEnabled() && !(draft?.rerolled === true)
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
    void redrawRerollBtn

    rerollBtn.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      if (!cb.isEventDraftRerollEnabled()) return
      if (draft?.rerolled === true) return
      const blocked = new Set(shownChoices.map((it) => it.id))
      const nextChoices = cb.pickRandomEventDraftChoicesNoOverlap(ctx.currentDay, blocked)
      if (nextChoices.length < 2) {
        cb.showHintToast('no_gold_refresh', '可刷新候选不足', 0xff8f8f)
        return
      }
      ctx.pendingEventDraft = { day: ctx.currentDay, choices: nextChoices, rerolled: true }
      this.closeEventDraftOverlay()
      ctx.events.emit('REFRESH_SHOP_UI')
      cb.captureAndSave()
      this.ensureEventDraftSelection()
    })

    redrawOverlayStatus()

    stage.addChild(overlay)
    ctx.eventDraftOverlay = overlay
  }

  // ============================================================
  // Private helpers
  // ============================================================

  private _mountEventIconSprite(
    parent: Container,
    eventId: string,
    iconStem: string | undefined,
    centerX: number,
    centerY: number,
    iconSize: number,
    fallback: Text,
  ): void {
    const stem = String(iconStem || eventId || '').replace(/\.png$/i, '').trim()
    if (!stem) return
    const iconUrl = getEventIconUrl(stem)
    const sprite = new Sprite(Texture.WHITE)
    sprite.anchor.set(0.5)
    sprite.x = centerX
    sprite.y = centerY
    sprite.alpha = 0
    parent.addChild(sprite)

    void Assets.load<Texture>(iconUrl).then((tex) => {
      const side = Math.round(iconSize * 0.82)
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
