// ============================================================
// SettingsDebugPanel — Settings/Debug 覆蓋層面板
// 從 ShopScene.ts 提取，使用 Class 方式（繼承 Container）
// 包含：openSettingsOverlay / closeSettingsOverlay
//       openSkillTestOverlay / closeSkillTestOverlay
//       openEventTestOverlay / closeEventTestOverlay
//       openItemTestOverlay / closeItemTestOverlay
//       setupOverlayListDragScroll
//       addMinLevelForTest / addAllPossibleLevelsForTest
//       createSettingsButton
// ============================================================

import {
  Container, Graphics, Text, Rectangle,
  type FederatedPointerEvent,
} from 'pixi.js'
import { getConfig as getDebugCfg, setConfig as setDebugCfg } from '@/config/debugConfig'
import { getConfig } from '@/core/DataLoader'
import type { ItemDef } from '@/common/items/ItemDef'
import type { TierKey } from '@/shop/ShopManager'
import { parseTierName } from '../systems/ShopSynthesisLogic'
import { BRONZE_SKILL_PICKS } from '@/common/skills/BronzeSkillConfig'
import { SILVER_SKILL_PICKS } from '@/common/skills/SilverSkillConfig'
import { GOLD_SKILL_PICKS } from '@/common/skills/GoldSkillConfig'
import type { ShopSceneCtx, ToastReason, EventChoice } from '../ShopSceneContext'

import { CANVAS_W, CANVAS_H } from '@/config/layoutConstants'

// ============================================================
// Callbacks interface
// ============================================================

export interface SettingsDebugCallbacks {
  refreshShopUI: () => void
  captureAndSave: () => void
  refreshSkillIconBar: () => void
  hasPickedSkill: (id: string) => boolean
  upsertPickedSkill: (id: string) => void
  removePickedSkill: (id: string) => void
  applyEventEffect: (choice: EventChoice, fromTest: boolean) => boolean
  markEventSelected: (id: string) => void
  resetEventSelectionCounters: () => void
  showHintToast: (reason: ToastReason, msg: string, color?: number) => void
  placeItemToInventoryOrBattle: (def: ItemDef, tier: TierKey, star: 1 | 2) => boolean
  getQualityLevelRange: (quality: TierKey) => { min: 1 | 2 | 3 | 4 | 5 | 6 | 7; max: 1 | 2 | 3 | 4 | 5 | 6 | 7 }
  levelToTierStar: (level: number) => { tier: TierKey; star: 1 | 2 } | null
  getEventPoolRows: () => EventChoice[]
  getSelectedEventCount: (eventId: string) => number
  isEventChoiceAvailable: (event: EventChoice, day: number) => boolean
  getPrimaryArchetype: (tags: string) => string
  isNeutralArchetypeKey: (arch: string) => boolean
  getAllItems: () => ItemDef[]
}

// ============================================================
// SettingsDebugPanel class
// ============================================================

export class SettingsDebugPanel extends Container {
  constructor(
    private ctx: ShopSceneCtx,
    private stage: Container,
    private cb: SettingsDebugCallbacks,
  ) {
    super()
  }

  // ============================================================
  // Close helpers
  // ============================================================

  closeSkillTestOverlay(): void {
    const ctx = this.ctx
    if (!ctx.skillTestOverlay) return
    if (ctx.skillTestOverlay.parent) ctx.skillTestOverlay.parent.removeChild(ctx.skillTestOverlay)
    ctx.skillTestOverlay.destroy({ children: true })
    ctx.skillTestOverlay = null
  }

  closeEventTestOverlay(): void {
    const ctx = this.ctx
    if (!ctx.eventTestOverlay) return
    if (ctx.eventTestOverlay.parent) ctx.eventTestOverlay.parent.removeChild(ctx.eventTestOverlay)
    ctx.eventTestOverlay.destroy({ children: true })
    ctx.eventTestOverlay = null
  }

  closeItemTestOverlay(): void {
    const ctx = this.ctx
    if (!ctx.itemTestOverlay) return
    if (ctx.itemTestOverlay.parent) ctx.itemTestOverlay.parent.removeChild(ctx.itemTestOverlay)
    ctx.itemTestOverlay.destroy({ children: true })
    ctx.itemTestOverlay = null
  }

  closeSettingsOverlay(): void {
    this.closeSkillTestOverlay()
    this.closeEventTestOverlay()
    this.closeItemTestOverlay()
    const ctx = this.ctx
    if (!ctx.settingsOverlay) return
    if (ctx.settingsOverlay.parent) ctx.settingsOverlay.parent.removeChild(ctx.settingsOverlay)
    ctx.settingsOverlay.destroy({ children: true })
    ctx.settingsOverlay = null
  }

  // ============================================================
  // Scroll helper
  // ============================================================

  private setupOverlayListDragScroll(
    panel: Container,
    listCon: Container,
    viewportRect: { x: number; y: number; w: number; h: number },
    getContentBottomY: () => number,
  ): () => void {
    const clip = new Graphics()
    clip.rect(viewportRect.x, viewportRect.y, viewportRect.w, viewportRect.h)
    clip.fill({ color: 0xffffff, alpha: 1 })
    panel.addChild(clip)
    listCon.mask = clip

    let scrollOffsetY = 0
    let maybeDragging = false
    let dragging = false
    let dragStartY = 0
    let dragStartOffsetY = 0

    const isInViewport = (gx: number, gy: number): boolean => {
      const p = panel.toLocal({ x: gx, y: gy })
      return p.x >= viewportRect.x && p.x <= viewportRect.x + viewportRect.w
        && p.y >= viewportRect.y && p.y <= viewportRect.y + viewportRect.h
    }

    const clampScroll = () => {
      const contentBottomY = getContentBottomY()
      const contentHeight = Math.max(0, contentBottomY - viewportRect.y)
      const maxScroll = Math.max(0, contentHeight - viewportRect.h)
      scrollOffsetY = Math.max(-maxScroll, Math.min(0, scrollOffsetY))
      listCon.y = scrollOffsetY
    }

    panel.on('pointerdown', (e: FederatedPointerEvent) => {
      if (!isInViewport(e.global.x, e.global.y)) return
      maybeDragging = true
      dragging = false
      dragStartY = e.global.y
      dragStartOffsetY = scrollOffsetY
    })
    panel.on('pointermove', (e: FederatedPointerEvent) => {
      if (!maybeDragging && !dragging) return
      if (!dragging && Math.abs(e.global.y - dragStartY) >= 8) dragging = true
      if (!dragging) return
      scrollOffsetY = dragStartOffsetY + (e.global.y - dragStartY)
      clampScroll()
    })
    const stopDrag = () => {
      maybeDragging = false
      dragging = false
    }
    panel.on('pointerup', stopDrag)
    panel.on('pointerupoutside', stopDrag)
    panel.on('wheel', (e: any) => {
      const gx = Number(e?.global?.x ?? e?.x ?? 0)
      const gy = Number(e?.global?.y ?? e?.y ?? 0)
      if (!isInViewport(gx, gy)) return
      e.stopPropagation?.()
      const dy = Number(e?.deltaY ?? 0)
      if (!Number.isFinite(dy) || dy === 0) return
      scrollOffsetY -= dy * 0.9
      clampScroll()
    })

    clampScroll()
    return clampScroll
  }

  // ============================================================
  // Item test helpers
  // ============================================================

  private addAllPossibleLevelsForTest(def: ItemDef): boolean {
    const cb = this.cb
    const quality = parseTierName(def.starting_tier) ?? 'Bronze'
    const range = cb.getQualityLevelRange(quality)
    let okCount = 0
    for (let lv = range.min; lv <= range.max; lv++) {
      const legacy = cb.levelToTierStar(lv)
      if (!legacy) continue
      if (cb.placeItemToInventoryOrBattle(def, legacy.tier, legacy.star)) okCount += 1
    }
    if (okCount <= 0) {
      cb.showHintToast('backpack_full_buy', `[测试] 添加失败：${def.name_cn}（空间不足）`, 0xffb27a)
      return false
    }
    const totalNeed = range.max - range.min + 1
    const msg = okCount >= totalNeed
      ? `[测试] 已添加：${def.name_cn} 全等级（Lv${range.min}-Lv${range.max}）`
      : `[测试] 已添加：${def.name_cn} ${okCount}/${totalNeed} 个等级（空间不足）`
    cb.showHintToast('no_gold_buy', msg, 0x9be5ff)
    cb.refreshShopUI()
    cb.captureAndSave()
    return true
  }

  private addMinLevelForTest(def: ItemDef): boolean {
    const cb = this.cb
    const quality = parseTierName(def.starting_tier) ?? 'Bronze'
    const range = cb.getQualityLevelRange(quality)
    const legacy = cb.levelToTierStar(range.min)
    if (!legacy) return false
    const ok = cb.placeItemToInventoryOrBattle(def, legacy.tier, legacy.star)
    if (!ok) {
      cb.showHintToast('backpack_full_buy', `[测试] 添加失败：${def.name_cn}（空间不足）`, 0xffb27a)
      return false
    }
    cb.showHintToast('no_gold_buy', `[测试] 已添加：${def.name_cn} 最低等级（Lv${range.min}）`, 0x9be5ff)
    cb.refreshShopUI()
    cb.captureAndSave()
    return true
  }

  // ============================================================
  // openSkillTestOverlay
  // ============================================================

  openSkillTestOverlay(): void {
    this.closeSkillTestOverlay()
    const stage = this.stage
    const ctx = this.ctx
    const cb = this.cb
    const overlay = new Container()
    overlay.zIndex = 7400
    overlay.eventMode = 'static'
    overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

    const mask = new Graphics()
    mask.rect(0, 0, CANVAS_W, CANVAS_H)
    mask.fill({ color: 0x020409, alpha: 0.68 })
    overlay.addChild(mask)

    const panel = new Container()
    panel.x = CANVAS_W / 2
    panel.y = CANVAS_H / 2
    panel.eventMode = 'static'
    panel.on('pointerdown', (e) => e.stopPropagation())
    overlay.addChild(panel)

    const panelW = 600
    const panelH = 1180
    const bg = new Graphics()
    bg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 24)
    bg.fill({ color: 0x121d34, alpha: 0.98 })
    bg.stroke({ color: 0x9ec2ff, width: 3, alpha: 0.95 })
    panel.addChild(bg)

    const title = new Text({
      text: '技能测试（青铜/白银/黄金）',
      style: { fontSize: 38, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    title.anchor.set(0.5)
    title.y = -442
    panel.addChild(title)

    const subtitle = new Text({
      text: '点击开关可即时加/去技能（仅本局）',
      style: { fontSize: 20, fill: 0xa8bddf, fontFamily: 'Arial' },
    })
    subtitle.anchor.set(0.5)
    subtitle.y = -398
    panel.addChild(subtitle)

    let selectedTier: 'bronze' | 'silver' | 'gold' = 'bronze'
    const tierTabsCon = new Container()
    tierTabsCon.y = -352
    panel.addChild(tierTabsCon)

    const listCon = new Container()
    panel.addChild(listCon)
    let listBottomY = -300
    const refreshListScroll = this.setupOverlayListDragScroll(
      panel,
      listCon,
      { x: -276, y: -320, w: 552, h: 820 },
      () => listBottomY,
    )

    const drawTabs = () => {
      tierTabsCon.removeChildren().forEach((c) => c.destroy({ children: true }))
      const makeTab = (x: number, key: 'bronze' | 'silver' | 'gold', label: string) => {
        const on = selectedTier === key
        const tab = new Container()
        tab.x = x
        tab.eventMode = 'static'
        tab.cursor = 'pointer'
        const bgTab = new Graphics()
        bgTab.roundRect(-90, -20, 180, 40, 12)
        bgTab.fill({ color: on ? 0x6da7ff : 0x304a76, alpha: 0.96 })
        bgTab.stroke({ color: 0xcfe1ff, width: on ? 3 : 2, alpha: 0.9 })
        const tx = new Text({
          text: label,
          style: { fontSize: 20, fill: 0xf5fbff, fontFamily: 'Arial', fontWeight: 'bold' },
        })
        tx.anchor.set(0.5)
        tab.on('pointerdown', (e) => {
          e.stopPropagation()
          if (selectedTier === key) return
          selectedTier = key
          drawTabs()
          drawRows()
        })
        tab.addChild(bgTab, tx)
        tierTabsCon.addChild(tab)
      }
      makeTab(-180, 'bronze', '青铜')
      makeTab(0, 'silver', '白银')
      makeTab(180, 'gold', '黄金')
    }

    const drawRows = () => {
      listCon.removeChildren().forEach((c) => c.destroy({ children: true }))
      const list = selectedTier === 'bronze'
        ? BRONZE_SKILL_PICKS
        : selectedTier === 'silver'
          ? SILVER_SKILL_PICKS
          : GOLD_SKILL_PICKS
      const listTop = -300
      const rowH = 40
      listBottomY = listTop + Math.max(0, list.length - 1) * rowH + 18
      list.forEach((skill, idx) => {
        const y = listTop + idx * rowH
        const rowBg = new Graphics()
        rowBg.roundRect(-268, y - 18, 536, 34, 10)
        rowBg.fill({ color: idx % 2 === 0 ? 0x172844 : 0x15233c, alpha: 0.72 })
        listCon.addChild(rowBg)

        const label = new Text({
          text: `${skill.id} ${skill.name}`,
          style: { fontSize: 18, fill: 0xe0ebff, fontFamily: 'Arial', fontWeight: 'bold' },
        })
        label.x = -248
        label.y = y - label.height / 2
        listCon.addChild(label)

        const btn = new Container()
        btn.x = 195
        btn.y = y
        btn.eventMode = 'static'
        btn.cursor = 'pointer'
        const b = new Graphics()
        const t = new Text({
          text: '',
          style: { fontSize: 18, fill: 0x0f1c33, fontFamily: 'Arial', fontWeight: 'bold' },
        })
        t.anchor.set(0.5)
        const redraw = () => {
          const on = cb.hasPickedSkill(skill.id)
          b.clear()
          b.roundRect(-52, -14, 104, 28, 10)
          b.fill({ color: on ? 0x74dc9b : 0xa8b6cc, alpha: 0.98 })
          b.stroke({ color: 0x0d1426, width: 2, alpha: 0.95 })
          t.text = on ? '已开启' : '已关闭'
        }
        redraw()
        btn.on('pointerdown', (e) => {
          e.stopPropagation()
          if (cb.hasPickedSkill(skill.id)) cb.removePickedSkill(skill.id)
          else cb.upsertPickedSkill(skill.id)
          redraw()
          cb.refreshSkillIconBar()
          cb.refreshShopUI()
          cb.captureAndSave()
        })
        btn.addChild(b, t)
        listCon.addChild(btn)
      })
      refreshListScroll()
    }

    drawTabs()
    drawRows()

    const closeBtn = new Container()
    closeBtn.x = 0
    closeBtn.y = 540
    closeBtn.eventMode = 'static'
    closeBtn.cursor = 'pointer'
    const closeBg = new Graphics()
    closeBg.roundRect(-122, -30, 244, 60, 18)
    closeBg.fill({ color: 0x2d446c, alpha: 0.96 })
    closeBg.stroke({ color: 0xa7c6ff, width: 3, alpha: 0.95 })
    const closeText = new Text({ text: '关闭', style: { fontSize: 28, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' } })
    closeText.anchor.set(0.5)
    closeBtn.on('pointerdown', (e) => {
      e.stopPropagation()
      this.closeSkillTestOverlay()
    })
    closeBtn.addChild(closeBg, closeText)
    panel.addChild(closeBtn)

    overlay.on('pointerdown', () => this.closeSkillTestOverlay())
    stage.addChild(overlay)
    ctx.skillTestOverlay = overlay
  }

  // ============================================================
  // openEventTestOverlay
  // ============================================================

  openEventTestOverlay(): void {
    this.closeEventTestOverlay()
    const stage = this.stage
    const ctx = this.ctx
    const cb = this.cb
    const overlay = new Container()
    overlay.zIndex = 7420
    overlay.eventMode = 'static'
    overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

    const mask = new Graphics()
    mask.rect(0, 0, CANVAS_W, CANVAS_H)
    mask.fill({ color: 0x020409, alpha: 0.7 })
    overlay.addChild(mask)

    const panel = new Container()
    panel.x = CANVAS_W / 2
    panel.y = CANVAS_H / 2
    panel.eventMode = 'static'
    panel.on('pointerdown', (e) => e.stopPropagation())
    overlay.addChild(panel)

    const panelW = 610
    const panelH = 1180
    const bg = new Graphics()
    bg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 24)
    bg.fill({ color: 0x13213a, alpha: 0.98 })
    bg.stroke({ color: 0x9ec2ff, width: 3, alpha: 0.95 })
    panel.addChild(bg)

    const title = new Text({
      text: '事件测试（按钮触发）',
      style: { fontSize: 38, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    title.anchor.set(0.5)
    title.y = -446
    panel.addChild(title)

    const subtitle = new Text({
      text: '点击"触发"执行事件；可重置已选次数',
      style: { fontSize: 20, fill: 0xa8bddf, fontFamily: 'Arial' },
    })
    subtitle.anchor.set(0.5)
    subtitle.y = -402
    panel.addChild(subtitle)

    const resetBtn = new Container()
    resetBtn.y = -356
    resetBtn.eventMode = 'static'
    resetBtn.cursor = 'pointer'
    const resetBg = new Graphics()
    resetBg.roundRect(-188, -22, 376, 44, 12)
    resetBg.fill({ color: 0x3d5d93, alpha: 0.96 })
    resetBg.stroke({ color: 0xbad6ff, width: 2, alpha: 0.95 })
    const resetTxt = new Text({
      text: '重置事件已选次数（本局）',
      style: { fontSize: 20, fill: 0xf5faff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    resetTxt.anchor.set(0.5)
    resetBtn.addChild(resetBg, resetTxt)
    panel.addChild(resetBtn)

    const listCon = new Container()
    panel.addChild(listCon)
    let listBottomY = -304
    const refreshListScroll = this.setupOverlayListDragScroll(
      panel,
      listCon,
      { x: -276, y: -322, w: 552, h: 820 },
      () => listBottomY,
    )

    const drawRows = () => {
      listCon.removeChildren().forEach((c) => c.destroy({ children: true }))
      const rows = cb.getEventPoolRows()
      const topY = -304
      const rowH = 42
      listBottomY = topY + Math.max(0, rows.length - 1) * rowH + 18
      rows.forEach((event, idx) => {
        const y = topY + idx * rowH
        const rowBg = new Graphics()
        rowBg.roundRect(-276, y - 18, 552, 34, 10)
        rowBg.fill({ color: idx % 2 === 0 ? 0x172844 : 0x15233c, alpha: 0.72 })
        listCon.addChild(rowBg)

        const cnt = cb.getSelectedEventCount(event.id)
        const limit = event.limits?.maxSelectionsPerRun
        const right = event.lane === 'left' ? '左' : '右'
        const suffix = typeof limit === 'number' && limit > 0 ? ` ${cnt}/${Math.round(limit)}` : ` ${cnt}`
        const label = new Text({
          text: `${event.id} [${right}] ${event.shortDesc}${suffix}`,
          style: { fontSize: 16, fill: 0xe0ebff, fontFamily: 'Arial', fontWeight: 'bold' },
        })
        label.x = -248
        label.y = y - label.height / 2
        listCon.addChild(label)

        const btn = new Container()
        btn.x = 214
        btn.y = y
        btn.eventMode = 'static'
        btn.cursor = 'pointer'
        const b = new Graphics()
        const t = new Text({
          text: '触发',
          style: { fontSize: 16, fill: 0x0f1c33, fontFamily: 'Arial', fontWeight: 'bold' },
        })
        t.anchor.set(0.5)
        const canPick = cb.isEventChoiceAvailable(event, ctx.currentDay)
        b.roundRect(-40, -14, 80, 28, 10)
        b.fill({ color: canPick ? 0x74dc9b : 0xa8b6cc, alpha: 0.98 })
        b.stroke({ color: 0x0d1426, width: 2, alpha: 0.95 })
        btn.on('pointerdown', (e) => {
          e.stopPropagation()
          const ok = cb.applyEventEffect(event, true)
          if (ok) {
            cb.markEventSelected(event.id)
            cb.refreshShopUI()
            cb.captureAndSave()
          } else {
            cb.showHintToast('no_gold_buy', `[测试] 事件未生效：${event.shortDesc}`, 0xffb27a)
          }
          drawRows()
        })
        btn.addChild(b, t)
        listCon.addChild(btn)
      })
      refreshListScroll()
    }

    resetBtn.on('pointerdown', (e) => {
      e.stopPropagation()
      cb.resetEventSelectionCounters()
      ctx.draftedEventDays = []
      ctx.pendingEventDraft = null
      cb.captureAndSave()
      cb.showHintToast('no_gold_buy', '[测试] 已重置事件次数', 0x9be5ff)
      drawRows()
    })

    drawRows()

    const closeBtn = new Container()
    closeBtn.x = 0
    closeBtn.y = 540
    closeBtn.eventMode = 'static'
    closeBtn.cursor = 'pointer'
    const closeBg = new Graphics()
    closeBg.roundRect(-122, -30, 244, 60, 18)
    closeBg.fill({ color: 0x2d446c, alpha: 0.96 })
    closeBg.stroke({ color: 0xa7c6ff, width: 3, alpha: 0.95 })
    const closeText = new Text({ text: '关闭', style: { fontSize: 28, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' } })
    closeText.anchor.set(0.5)
    closeBtn.on('pointerdown', (e) => {
      e.stopPropagation()
      this.closeEventTestOverlay()
    })
    closeBtn.addChild(closeBg, closeText)
    panel.addChild(closeBtn)

    overlay.on('pointerdown', () => this.closeEventTestOverlay())
    stage.addChild(overlay)
    ctx.eventTestOverlay = overlay
  }

  // ============================================================
  // openItemTestOverlay
  // ============================================================

  openItemTestOverlay(): void {
    this.closeItemTestOverlay()
    const stage = this.stage
    const ctx = this.ctx
    const cb = this.cb
    const overlay = new Container()
    overlay.zIndex = 7440
    overlay.eventMode = 'static'
    overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

    const mask = new Graphics()
    mask.rect(0, 0, CANVAS_W, CANVAS_H)
    mask.fill({ color: 0x020409, alpha: 0.7 })
    overlay.addChild(mask)

    const panel = new Container()
    panel.x = CANVAS_W / 2
    panel.y = CANVAS_H / 2
    panel.eventMode = 'static'
    panel.on('pointerdown', (e) => e.stopPropagation())
    overlay.addChild(panel)

    const panelW = 610
    const panelH = 1180
    const bg = new Graphics()
    bg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 24)
    bg.fill({ color: 0x13213a, alpha: 0.98 })
    bg.stroke({ color: 0x9ec2ff, width: 3, alpha: 0.95 })
    panel.addChild(bg)

    const title = new Text({
      text: '物品测试（手动添加）',
      style: { fontSize: 38, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    title.anchor.set(0.5)
    title.y = -446
    panel.addChild(title)

    const subtitle = new Text({
      text: '按职业分页后，点击"最低级/全等级"可添加物品',
      style: { fontSize: 20, fill: 0xa8bddf, fontFamily: 'Arial' },
    })
    subtitle.anchor.set(0.5)
    subtitle.y = -402
    panel.addChild(subtitle)

    const listCon = new Container()
    panel.addChild(listCon)
    let listBottomY = -300
    const refreshListScroll = this.setupOverlayListDragScroll(
      panel,
      listCon,
      { x: -276, y: -316, w: 552, h: 816 },
      () => listBottomY,
    )

    type ItemTestPage = 'all' | 'warrior' | 'archer' | 'assassin' | 'neutral'
    let activePage: ItemTestPage = 'all'

    const all = [...cb.getAllItems()].sort((a, b) => {
      const ta = parseTierName(a.starting_tier) ?? 'Bronze'
      const tb = parseTierName(b.starting_tier) ?? 'Bronze'
      const order = { Bronze: 0, Silver: 1, Gold: 2, Diamond: 3 }
      const diff = (order[ta] ?? 0) - (order[tb] ?? 0)
      if (diff !== 0) return diff
      return a.name_cn.localeCompare(b.name_cn, 'zh-Hans-CN')
    })

    const pageTabs: Array<{ key: ItemTestPage; label: string }> = [
      { key: 'all', label: '全部' },
      { key: 'warrior', label: '战士' },
      { key: 'archer', label: '弓手' },
      { key: 'assassin', label: '刺客' },
      { key: 'neutral', label: '中立' },
    ]

    const pageBtnByKey = new Map<ItemTestPage, { bg: Graphics; text: Text }>()
    const pageCon = new Container()
    pageCon.y = -352
    panel.addChild(pageCon)

    const getPageItems = (): ItemDef[] => {
      if (activePage === 'all') return all
      return all.filter((def) => {
        const arch = cb.getPrimaryArchetype(def.tags)
        if (activePage === 'warrior') return arch === '战士'
        if (activePage === 'archer') return arch === '弓手'
        if (activePage === 'assassin') return arch === '刺客'
        return cb.isNeutralArchetypeKey(arch)
      })
    }

    const topY = -300
    const rowH = 38
    const drawList = () => {
      const old = listCon.removeChildren()
      old.forEach((child) => child.destroy())
      const items = getPageItems()
      listBottomY = topY + Math.max(0, items.length - 1) * rowH + 16
      for (let idx = 0; idx < items.length; idx++) {
        const def = items[idx]!
        const y = topY + idx * rowH
        const rowBg = new Graphics()
        rowBg.roundRect(-276, y - 16, 552, 32, 10)
        rowBg.fill({ color: idx % 2 === 0 ? 0x172844 : 0x15233c, alpha: 0.72 })
        listCon.addChild(rowBg)

        const tier = parseTierName(def.starting_tier) ?? 'Bronze'
        const label = new Text({
          text: `${def.name_cn}（${tier}）`,
          style: { fontSize: 16, fill: 0xe0ebff, fontFamily: 'Arial', fontWeight: 'bold' },
        })
        label.x = -248
        label.y = y - label.height / 2
        listCon.addChild(label)

        const minBtn = new Container()
        minBtn.x = 136
        minBtn.y = y
        minBtn.eventMode = 'static'
        minBtn.cursor = 'pointer'
        const minBg = new Graphics()
        minBg.roundRect(-36, -14, 72, 28, 10)
        minBg.fill({ color: 0x96c7ff, alpha: 0.98 })
        minBg.stroke({ color: 0x0d1426, width: 2, alpha: 0.95 })
        const minText = new Text({
          text: '最低级',
          style: { fontSize: 14, fill: 0x0f1c33, fontFamily: 'Arial', fontWeight: 'bold' },
        })
        minText.anchor.set(0.5)
        minBtn.on('pointerdown', (e) => {
          e.stopPropagation()
          this.addMinLevelForTest(def)
        })
        minBtn.addChild(minBg, minText)
        listCon.addChild(minBtn)

        const allBtn = new Container()
        allBtn.x = 220
        allBtn.y = y
        allBtn.eventMode = 'static'
        allBtn.cursor = 'pointer'
        const allBg = new Graphics()
        allBg.roundRect(-40, -14, 80, 28, 10)
        allBg.fill({ color: 0x74dc9b, alpha: 0.98 })
        allBg.stroke({ color: 0x0d1426, width: 2, alpha: 0.95 })
        const allText = new Text({
          text: '全等级',
          style: { fontSize: 16, fill: 0x0f1c33, fontFamily: 'Arial', fontWeight: 'bold' },
        })
        allText.anchor.set(0.5)
        allBtn.on('pointerdown', (e) => {
          e.stopPropagation()
          this.addAllPossibleLevelsForTest(def)
        })
        allBtn.addChild(allBg, allText)
        listCon.addChild(allBtn)
      }
      refreshListScroll()
    }

    const redrawPageTabs = () => {
      for (const row of pageTabs) {
        const view = pageBtnByKey.get(row.key)
        if (!view) continue
        const selected = row.key === activePage
        view.bg.clear()
        view.bg.roundRect(-50, -17, 100, 34, 12)
        view.bg.fill({ color: selected ? 0x7cc6ff : 0x2a4068, alpha: 0.96 })
        view.bg.stroke({ color: selected ? 0xe9f6ff : 0x9ec2ff, width: selected ? 3 : 2, alpha: 0.95 })
        view.text.style.fill = selected ? 0x0f1c33 : 0xeaf3ff
      }
    }

    const totalW = pageTabs.length * 108 - 8
    pageTabs.forEach((row, idx) => {
      const btn = new Container()
      btn.x = -totalW / 2 + idx * 108 + 50
      btn.y = 0
      btn.eventMode = 'static'
      btn.cursor = 'pointer'

      const tabBg = new Graphics()
      const tabText = new Text({
        text: row.label,
        style: { fontSize: 16, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      tabText.anchor.set(0.5)
      btn.addChild(tabBg, tabText)
      pageCon.addChild(btn)
      pageBtnByKey.set(row.key, { bg: tabBg, text: tabText })

      btn.on('pointerdown', (e) => {
        e.stopPropagation()
        if (activePage === row.key) return
        activePage = row.key
        drawList()
        redrawPageTabs()
      })
    })

    drawList()
    redrawPageTabs()

    const closeBtn = new Container()
    closeBtn.x = 0
    closeBtn.y = 540
    closeBtn.eventMode = 'static'
    closeBtn.cursor = 'pointer'
    const closeBg = new Graphics()
    closeBg.roundRect(-122, -30, 244, 60, 18)
    closeBg.fill({ color: 0x2d446c, alpha: 0.96 })
    closeBg.stroke({ color: 0xa7c6ff, width: 3, alpha: 0.95 })
    const closeText = new Text({ text: '关闭', style: { fontSize: 28, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' } })
    closeText.anchor.set(0.5)
    closeBtn.on('pointerdown', (e) => {
      e.stopPropagation()
      this.closeItemTestOverlay()
    })
    closeBtn.addChild(closeBg, closeText)
    panel.addChild(closeBtn)

    overlay.on('pointerdown', () => this.closeItemTestOverlay())
    stage.addChild(overlay)
    ctx.itemTestOverlay = overlay
  }

  // ============================================================
  // openSettingsOverlay
  // ============================================================

  openSettingsOverlay(): void {
    this.closeSettingsOverlay()
    const stage = this.stage
    const ctx = this.ctx
    const overlay = new Container()
    overlay.zIndex = 7200
    overlay.eventMode = 'static'
    overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

    const mask = new Graphics()
    mask.rect(0, 0, CANVAS_W, CANVAS_H)
    mask.fill({ color: 0x05070d, alpha: 0.58 })
    overlay.addChild(mask)

    const panel = new Container()
    panel.x = CANVAS_W / 2
    panel.y = 418
    panel.eventMode = 'static'
    panel.on('pointerdown', (e) => e.stopPropagation())
    overlay.addChild(panel)

    const panelW = 612
    const panelH = 980
    const panelBg = new Graphics()
    panelBg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 24)
    panelBg.fill({ color: 0x121c33, alpha: 0.98 })
    panelBg.stroke({ color: 0x9ec2ff, width: 3, alpha: 0.95 })
    panel.addChild(panelBg)

    const panelGlow = new Graphics()
    panelGlow.roundRect(-panelW / 2 + 8, -panelH / 2 + 8, panelW - 16, panelH - 16, 20)
    panelGlow.stroke({ color: 0x4b6ea8, width: 2, alpha: 0.45 })
    panel.addChild(panelGlow)

    const title = new Text({
      text: '设置',
      style: { fontSize: 40, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    title.anchor.set(0.5)
    title.y = -210
    panel.addChild(title)

    const subtitle = new Text({
      text: '本局即时生效',
      style: { fontSize: 18, fill: 0xa8bddf, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    subtitle.anchor.set(0.5)
    subtitle.y = -166
    panel.addChild(subtitle)

    type ToggleRow = {
      key: 'gameplayCrossSynthesisConfirm' | 'gameplayShowSpeedButton' | 'gameplayBattleZoneNoSynthesis' | 'gameplaySameArchetypeDiffItemStoneSynthesis'
      label: string
    }
    const rows: ToggleRow[] = [
      { key: 'gameplayBattleZoneNoSynthesis', label: '上阵区禁止合成' },
      { key: 'gameplayCrossSynthesisConfirm', label: '合成二次弹窗' },
      { key: 'gameplaySameArchetypeDiffItemStoneSynthesis', label: '同职异物合成选转化' },
      { key: 'gameplayShowSpeedButton', label: '战斗加速按钮' },
    ]

    const drawRow = (y: number, row: ToggleRow): void => {
      const rowBg = new Graphics()
      rowBg.roundRect(-268, y - 36, 536, 72, 16)
      rowBg.fill({ color: 0x1a2946, alpha: 0.72 })
      rowBg.stroke({ color: 0x2f4f82, width: 2, alpha: 0.7 })
      panel.addChild(rowBg)

      const label = new Text({
        text: row.label,
        style: { fontSize: 30, fill: 0xe0ebff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      label.x = -240
      label.y = y - label.height / 2
      panel.addChild(label)

      const on = () => getDebugCfg(row.key) >= 0.5
      const btn = new Container()
      btn.x = 176
      btn.y = y
      btn.eventMode = 'static'
      btn.cursor = 'pointer'

      const bg = new Graphics()
      const txt = new Text({
        text: '',
        style: { fontSize: 24, fill: 0x0f1c33, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      txt.anchor.set(0.5)
      const redraw = () => {
        const enabled = on()
        bg.clear()
        bg.roundRect(-76, -27, 152, 54, 18)
        bg.fill({ color: enabled ? 0x74dc9b : 0xa8b6cc, alpha: 0.98 })
        bg.stroke({ color: 0x0d1426, width: 2, alpha: 0.95 })
        txt.text = enabled ? '开启' : '关闭'
      }
      redraw()

      btn.on('pointerdown', (e) => {
        e.stopPropagation()
        const next = on() ? 0 : 1
        setDebugCfg(row.key, next)
        redraw()
      })
      btn.addChild(bg, txt)
      panel.addChild(btn)
    }

    const controlBaseY = -118
    const controlGapY = 92
    rows.forEach((row, idx) => {
      drawRow(controlBaseY + controlGapY * idx, row)
    })

    const testBtn = new Container()
    testBtn.x = 0
    testBtn.y = controlBaseY + controlGapY * rows.length
    testBtn.eventMode = 'static'
    testBtn.cursor = 'pointer'
    const testBg = new Graphics()
    testBg.roundRect(-172, -28, 344, 56, 16)
    testBg.fill({ color: 0x3a5b93, alpha: 0.96 })
    testBg.stroke({ color: 0xb9d4ff, width: 3, alpha: 0.95 })
    const testText = new Text({
      text: '技能测试',
      style: { fontSize: 26, fill: 0xf3f9ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    testText.anchor.set(0.5)
    testBtn.on('pointerdown', (e) => {
      e.stopPropagation()
      this.openSkillTestOverlay()
    })
    testBtn.addChild(testBg, testText)
    panel.addChild(testBtn)

    const eventTestBtn = new Container()
    eventTestBtn.x = 0
    eventTestBtn.y = controlBaseY + controlGapY * (rows.length + 1)
    eventTestBtn.eventMode = 'static'
    eventTestBtn.cursor = 'pointer'
    const eventTestBg = new Graphics()
    eventTestBg.roundRect(-172, -28, 344, 56, 16)
    eventTestBg.fill({ color: 0x3a5b93, alpha: 0.96 })
    eventTestBg.stroke({ color: 0xb9d4ff, width: 3, alpha: 0.95 })
    const eventTestText = new Text({
      text: '事件测试',
      style: { fontSize: 26, fill: 0xf3f9ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    eventTestText.anchor.set(0.5)
    eventTestBtn.on('pointerdown', (e) => {
      e.stopPropagation()
      this.openEventTestOverlay()
    })
    eventTestBtn.addChild(eventTestBg, eventTestText)
    panel.addChild(eventTestBtn)

    const itemTestBtn = new Container()
    itemTestBtn.x = 0
    itemTestBtn.y = controlBaseY + controlGapY * (rows.length + 2)
    itemTestBtn.eventMode = 'static'
    itemTestBtn.cursor = 'pointer'
    const itemTestBg = new Graphics()
    itemTestBg.roundRect(-172, -28, 344, 56, 16)
    itemTestBg.fill({ color: 0x3a5b93, alpha: 0.96 })
    itemTestBg.stroke({ color: 0xb9d4ff, width: 3, alpha: 0.95 })
    const itemTestText = new Text({
      text: '物品测试',
      style: { fontSize: 26, fill: 0xf3f9ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    itemTestText.anchor.set(0.5)
    itemTestBtn.on('pointerdown', (e) => {
      e.stopPropagation()
      this.openItemTestOverlay()
    })
    itemTestBtn.addChild(itemTestBg, itemTestText)
    panel.addChild(itemTestBtn)

    const closeBtn = new Container()
    closeBtn.x = 0
    closeBtn.y = controlBaseY + controlGapY * (rows.length + 3)
    closeBtn.eventMode = 'static'
    closeBtn.cursor = 'pointer'
    const closeBg = new Graphics()
    closeBg.roundRect(-122, -30, 244, 60, 18)
    closeBg.fill({ color: 0x2d446c, alpha: 0.96 })
    closeBg.stroke({ color: 0xa7c6ff, width: 3, alpha: 0.95 })
    const closeText = new Text({ text: '关闭', style: { fontSize: 28, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' } })
    closeText.anchor.set(0.5)
    closeBtn.on('pointerdown', (e) => {
      e.stopPropagation()
      this.closeSettingsOverlay()
    })
    closeBtn.addChild(closeBg, closeText)
    panel.addChild(closeBtn)

    overlay.on('pointerdown', () => this.closeSettingsOverlay())
    stage.addChild(overlay)
    ctx.settingsOverlay = overlay
  }

  // ============================================================
  // createSettingsButton
  // ============================================================

  createSettingsButton(): void {
    const ctx = this.ctx
    const stage = this.stage
    if (ctx.settingsBtn) return
    const cfg = getConfig()
    const con = new Container()
    con.x = 16
    con.y = 82
    con.zIndex = 7050
    con.eventMode = 'static'
    con.cursor = 'pointer'

    const label = new Text({
      text: '设置',
      style: {
        fontSize: cfg.textSizes.refreshCost,
        fill: 0xffe8a3,
        fontFamily: 'Arial',
        fontWeight: 'bold',
      },
    })
    const padX = 18
    const padY = 10
    const w = label.width + padX * 2
    const h = label.height + padY * 2

    const bg = new Graphics()
    bg.roundRect(0, 0, w, h, 14)
    bg.fill({ color: 0x1f2940, alpha: 0.88 })
    bg.stroke({ color: 0xffd25a, width: 2, alpha: 0.95 })
    con.addChild(bg)

    label.x = padX
    label.y = padY
    con.addChild(label)
    con.hitArea = new Rectangle(0, 0, w, h)

    con.on('pointerdown', (e) => {
      e.stopPropagation()
      if (ctx.settingsOverlay) this.closeSettingsOverlay()
      else this.openSettingsOverlay()
    })
    stage.addChild(con)
    ctx.settingsBtn = con
  }
}
