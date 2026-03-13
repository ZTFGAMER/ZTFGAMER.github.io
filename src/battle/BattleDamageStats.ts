import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { getAllItems, getConfig as getGameCfg } from '@/core/DataLoader'
import { getTierColor } from '@/config/colorPalette'
import { getItemIconUrl } from '@/core/AssetPath'
import { CANVAS_W, CANVAS_H } from '@/config/layoutConstants'
import type { CombatEngine } from './CombatEngine'

// suppress unused warning for getGameCfg which may be needed in future
void getGameCfg

type ItemBattleStat = {
  sourceItemId: string
  side: 'player' | 'enemy'
  defId: string
  itemName: string
  baseTier: 'Bronze' | 'Silver' | 'Gold' | 'Diamond'
  tierRaw: string
  level: number
  triggerCount: number
  damage: number
  shield: number
}

type DamageStatsRowView = {
  root: Container
  iconFrame: Graphics
  icon: Sprite
  name: Text
  triggerText: Text
  damageFill: Graphics
  damageText: Text
  shieldFill: Graphics
  shieldText: Text
}

const DAMAGE_STATS_PANEL_W = 560
const DAMAGE_STATS_PANEL_H = 700

// ---- module-level private helpers ----

function parseTierLevel(tierRaw: string): number {
  const tier = `${tierRaw}`
  const m = tier.match(/#(\d+)/)
  const star = Math.max(1, Math.min(2, Number(m?.[1] ?? 1) || 1)) as 1 | 2
  if (tier.includes('Diamond')) return star + 5
  if (tier.includes('Gold')) return star + 3
  if (tier.includes('Silver')) return star + 1
  return 1
}

function parseBaseTier(raw?: string): 'Bronze' | 'Silver' | 'Gold' | 'Diamond' {
  const s = `${raw ?? ''}`
  if (s.includes('Diamond')) return 'Diamond'
  if (s.includes('Gold')) return 'Gold'
  if (s.includes('Silver')) return 'Silver'
  return 'Bronze'
}

function tierCn(tier: 'Bronze' | 'Silver' | 'Gold' | 'Diamond'): string {
  if (tier === 'Silver') return '白银'
  if (tier === 'Gold') return '黄金'
  if (tier === 'Diamond') return '钻石'
  return '青铜'
}

function getClampedStatsPanelY(panelH: number): number {
  const y = getDebugCfg('battleStatsPanelY')
  const halfH = panelH / 2
  const pad = 12
  const minY = halfH + pad
  const maxY = CANVAS_H - halfH - pad
  return Math.max(minY, Math.min(maxY, y))
}

const TOP_ACTION_BTN_H = 58
const TOP_ACTION_BTN_HALF_H = TOP_ACTION_BTN_H / 2
const TOP_ACTION_BTN_SAFE_PAD = 8

function getClampedTopActionBtnY(): number {
  const y = getDebugCfg('battleSpeedBtnY')
  const minY = TOP_ACTION_BTN_HALF_H + TOP_ACTION_BTN_SAFE_PAD
  const maxY = CANVAS_H - TOP_ACTION_BTN_HALF_H - TOP_ACTION_BTN_SAFE_PAD
  return Math.max(minY, Math.min(maxY, y))
}

// ---- BattleDamageStats class ----

export class BattleDamageStats {
  // stat data
  private battleStatsByItemId = new Map<string, ItemBattleStat>()
  private battleStatLastTriggerTickByItemId = new Map<string, number>()

  // state flags
  private damageStatsDirty = false
  private damageStatsPanelVisible = false
  private damageStatsLastRenderAtMs = 0
  private damageStatsTab: 'player' | 'enemy' = 'player'

  // UI containers/nodes
  private damageStatsMask: Graphics | null = null
  private damageStatsPanel: Container | null = null
  private damageStatsTitleText: Text | null = null
  private damageStatsRowsCon: Container | null = null
  private damageStatsTabPlayerBtn: Container | null = null
  private damageStatsTabEnemyBtn: Container | null = null
  private statsBtnText: Text | null = null
  private damageStatsRowViews: DamageStatsRowView[] = []
  private damageStatsEmptyText: Text | null = null

  // ---- private helpers ----

  private currentBattleTickIndex(engine: CombatEngine | null): number {
    const tick = engine?.getDebugState().tickIndex
    if (typeof tick !== 'number' || !Number.isFinite(tick)) return -1
    return Math.max(0, Math.round(tick))
  }

  private ensureBattleStatEntry(
    sourceItemId: string,
    side: 'player' | 'enemy',
    engine: CombatEngine | null,
    defId = '',
  ): ItemBattleStat {
    const prev = this.battleStatsByItemId.get(sourceItemId)
    if (prev) return prev
    const boardItem = engine?.getBoardState().items.find((it) => it.id === sourceItemId)
    const resolvedDefId = defId
      || boardItem?.defId
      || ''
    const tierRaw = boardItem?.tier ?? 'Bronze#1'
    const itemDef = getAllItems().find((it) => it.id === resolvedDefId)
    const itemName = itemDef?.name_cn
      ?? resolvedDefId
      ?? sourceItemId
    const stat: ItemBattleStat = {
      sourceItemId,
      side,
      defId: resolvedDefId,
      itemName,
      baseTier: parseBaseTier(itemDef?.starting_tier),
      tierRaw,
      level: parseTierLevel(tierRaw),
      triggerCount: 0,
      damage: 0,
      shield: 0,
    }
    this.battleStatsByItemId.set(sourceItemId, stat)
    return stat
  }

  private refreshDamageStatsPanel(
    battlePresentationMs: number,
    engine: CombatEngine | null,
    force = false,
  ): void {
    if (!this.damageStatsPanel || !this.damageStatsTitleText || !this.damageStatsRowsCon) return
    if (!force && !this.damageStatsDirty && battlePresentationMs - this.damageStatsLastRenderAtMs < 180) return
    const rows = Array.from(this.battleStatsByItemId.values())
      .filter((it) => it.side === this.damageStatsTab)
      .sort((a, b) => b.triggerCount - a.triggerCount || (b.damage + b.shield) - (a.damage + a.shield) || b.damage - a.damage)
    const maxStatValue = Math.max(1, ...rows.map((r) => Math.max(r.damage, r.shield)))

    this.damageStatsTitleText.text = engine?.isFinished() ? '战斗统计（已结束）' : '战斗统计（进行中）'
    this.ensureDamageStatsRowsBuilt()
    const visibleCount = Math.min(this.damageStatsRowViews.length, rows.length)
    if (this.damageStatsEmptyText) this.damageStatsEmptyText.visible = visibleCount <= 0
    for (let i = 0; i < this.damageStatsRowViews.length; i++) {
      const view = this.damageStatsRowViews[i]!
      const stat = i < visibleCount ? rows[i] : null
      view.root.visible = !!stat
      if (!stat) continue
      this.updateDamageStatsRowView(view, i, stat, maxStatValue)
    }

    this.damageStatsDirty = false
    this.damageStatsLastRenderAtMs = battlePresentationMs
  }

  private ensureDamageStatsRowsBuilt(): void {
    if (!this.damageStatsRowsCon) return
    if (this.damageStatsRowViews.length > 0) return

    this.damageStatsEmptyText = new Text({
      text: '暂无统计',
      style: { fontSize: 24, fill: 0xbfd0ef, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    this.damageStatsEmptyText.anchor.set(0.5)
    this.damageStatsEmptyText.x = 0
    this.damageStatsEmptyText.y = 40
    this.damageStatsRowsCon.addChild(this.damageStatsEmptyText)

    const rowW = 520
    const rowH = 88
    const iconSide = 46
    const barW = 228
    const barH = 13
    const barX = -rowW / 2 + 64

    for (let i = 0; i < 6; i++) {
      const row = new Container()
      row.y = -210 + i * (rowH + 10)

      const rowBg = new Graphics()
      rowBg.roundRect(-rowW / 2, 0, rowW, rowH, 12)
      rowBg.fill({ color: 0x1a2744, alpha: 0.88 })
      rowBg.stroke({ color: 0x5f79a8, width: 1, alpha: 0.9 })
      row.addChild(rowBg)

      const iconX = -rowW / 2 + 36
      const iconY = rowH / 2
      const iconFrame = new Graphics()
      iconFrame.roundRect(iconX - iconSide / 2, iconY - iconSide / 2, iconSide, iconSide, 9)
      iconFrame.fill({ color: 0x1d2a45, alpha: 1 })
      iconFrame.stroke({ color: getTierColor('Bronze'), width: 2, alpha: 0.98 })
      row.addChild(iconFrame)

      const icon = new Sprite(Texture.WHITE)
      icon.anchor.set(0.5)
      icon.x = iconX
      icon.y = iconY
      icon.width = 42
      icon.height = 42
      row.addChild(icon)

      const name = new Text({
        text: '',
        style: { fontSize: 21, fill: 0xeaf2ff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      name.x = -rowW / 2 + 64
      name.y = 8
      row.addChild(name)

      const triggerText = new Text({
        text: '',
        style: { fontSize: 18, fill: 0xfff0bf, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      triggerText.x = barX + barW + 10
      triggerText.y = 10
      row.addChild(triggerText)

      const dmgBg = new Graphics()
      dmgBg.roundRect(barX, 42, barW, barH, 6)
      dmgBg.fill({ color: 0x2a3557, alpha: 1 })
      row.addChild(dmgBg)

      const damageFill = new Graphics()
      row.addChild(damageFill)

      const damageText = new Text({
        text: '',
        style: { fontSize: 18, fill: 0xffd6d6, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      damageText.x = barX + barW + 10
      damageText.y = 34
      row.addChild(damageText)

      const shBg = new Graphics()
      shBg.roundRect(barX, 62, barW, barH, 6)
      shBg.fill({ color: 0x2a3557, alpha: 1 })
      row.addChild(shBg)

      const shieldFill = new Graphics()
      row.addChild(shieldFill)

      const shieldText = new Text({
        text: '',
        style: { fontSize: 18, fill: 0xd8ebff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      shieldText.x = barX + barW + 10
      shieldText.y = 54
      row.addChild(shieldText)

      this.damageStatsRowsCon.addChild(row)
      this.damageStatsRowViews.push({
        root: row,
        iconFrame,
        icon,
        name,
        triggerText,
        damageFill,
        damageText,
        shieldFill,
        shieldText,
      })
    }
  }

  private updateFillBar(fill: Graphics, x: number, y: number, width: number, height: number, color: number, ratio: number): void {
    const clampedRatio = Math.max(0, Math.min(1, ratio))
    const fillW = clampedRatio > 0 ? Math.max(2, Math.round(width * clampedRatio)) : 0
    fill.clear()
    if (fillW <= 0) return
    fill.roundRect(x, y, fillW, height, 6)
    fill.fill({ color, alpha: 1 })
  }

  private updateDamageStatsRowView(view: DamageStatsRowView, rowIndex: number, stat: ItemBattleStat, maxStatValue: number): void {
    const rowW = 520
    const barW = 228
    const barH = 13
    const barX = -rowW / 2 + 64
    const iconSide = 46
    const iconX = -rowW / 2 + 36
    const iconY = 88 / 2

    view.iconFrame.clear()
    view.iconFrame.roundRect(iconX - iconSide / 2, iconY - iconSide / 2, iconSide, iconSide, 9)
    view.iconFrame.fill({ color: 0x1d2a45, alpha: 1 })
    view.iconFrame.stroke({ color: getTierColor(stat.baseTier), width: 2, alpha: 0.98 })

    view.icon.texture = Texture.from(getItemIconUrl(stat.defId))
    view.name.text = `${rowIndex + 1}. ${stat.itemName} ${tierCn(stat.baseTier)}Lv${stat.level}`
    view.triggerText.text = `触发 ${Math.max(0, Math.round(stat.triggerCount))}次`
    view.damageText.text = `伤害 ${Math.round(stat.damage)}`
    view.shieldText.text = `护盾 ${Math.round(stat.shield)}`

    this.updateFillBar(view.damageFill, barX, 42, barW, barH, 0xe95d5d, stat.damage / maxStatValue)
    this.updateFillBar(view.shieldFill, barX, 62, barW, barH, Math.round(getDebugCfg('battleColorShield')), stat.shield / maxStatValue)
  }

  private setDamageStatsTab(tab: 'player' | 'enemy', battlePresentationMs: number, engine: CombatEngine | null): void {
    this.damageStatsTab = tab
    const activeFill = 0x4969a8
    const idleFill = 0x253455
    const updateBtn = (btn: Container | null, active: boolean) => {
      if (!btn) return
      const bg = btn.getChildAt(0)
      if (bg instanceof Graphics) {
        bg.clear()
        bg.roundRect(-62, -20, 124, 40, 12)
        bg.fill({ color: active ? activeFill : idleFill, alpha: 0.95 })
        bg.stroke({ color: 0x8ab2ef, width: 2, alpha: 0.95 })
      }
    }
    updateBtn(this.damageStatsTabPlayerBtn, tab === 'player')
    updateBtn(this.damageStatsTabEnemyBtn, tab === 'enemy')
    this.damageStatsDirty = true
    this.refreshDamageStatsPanel(battlePresentationMs, engine, true)
  }

  private makeStatsTabButton(label: string, tab: 'player' | 'enemy'): Container {
    const con = new Container()
    const bg = new Graphics()
    bg.roundRect(-62, -20, 124, 40, 12)
    bg.fill({ color: 0x253455, alpha: 0.95 })
    bg.stroke({ color: 0x8ab2ef, width: 2, alpha: 0.95 })
    con.addChild(bg)
    const txt = new Text({
      text: label,
      style: { fontSize: 20, fill: 0xe3edff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    txt.anchor.set(0.5)
    con.addChild(txt)
    con.eventMode = 'static'
    con.cursor = 'pointer'
    con.on('pointerdown', (e) => {
      e.stopPropagation()
      this.setDamageStatsTab(tab, 0, null)
    })
    return con
  }

  // ---- public API ----

  addDamage(sourceItemId: string, side: 'player' | 'enemy', amount: number, engine: CombatEngine | null): void {
    const stat = this.ensureBattleStatEntry(sourceItemId, side, engine)
    stat.damage += Math.max(0, amount)
    this.damageStatsDirty = true
  }

  addShield(sourceItemId: string, side: 'player' | 'enemy', amount: number, engine: CombatEngine | null): void {
    const stat = this.ensureBattleStatEntry(sourceItemId, side, engine)
    stat.shield += Math.max(0, amount)
    this.damageStatsDirty = true
  }

  addTriggerCount(
    sourceItemId: string,
    side: 'player' | 'enemy',
    amount: number,
    engine: CombatEngine | null,
    dedupeWithinTick = false,
  ): void {
    if (!sourceItemId) return
    const add = Math.max(1, Math.round(Number(amount) || 1))
    if (dedupeWithinTick) {
      const tick = this.currentBattleTickIndex(engine)
      if (tick >= 0) {
        const last = this.battleStatLastTriggerTickByItemId.get(sourceItemId)
        if (last === tick) return
        this.battleStatLastTriggerTickByItemId.set(sourceItemId, tick)
      }
    }
    const stat = this.ensureBattleStatEntry(sourceItemId, side, engine)
    stat.triggerCount += add
    this.damageStatsDirty = true
  }

  bootstrapFromBoard(engine: CombatEngine | null): void {
    if (!engine) return
    for (const it of engine.getBoardState().items) {
      this.ensureBattleStatEntry(it.id, it.side, engine, it.defId)
    }
    this.damageStatsDirty = true
  }

  buildPanel(root: Container): void {
    // Build mask
    const mask = new Graphics()
    mask.rect(0, 0, CANVAS_W, CANVAS_H)
    mask.fill({ color: 0x000000, alpha: 0.6 })
    mask.zIndex = 230
    mask.visible = false
    mask.eventMode = 'static'
    mask.cursor = 'pointer'
    mask.on('pointerdown', (e) => {
      e.stopPropagation()
      this.setVisible(false)
    })
    this.damageStatsMask = mask
    root.addChild(mask)

    // Build panel
    const panel = new Container()
    const panelW = DAMAGE_STATS_PANEL_W
    const panelH = DAMAGE_STATS_PANEL_H
    const bg = new Graphics()
    bg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 20)
    bg.fill({ color: 0x121a2f, alpha: 0.94 })
    bg.stroke({ color: 0x7ea6e3, width: 2, alpha: 0.95 })
    panel.addChild(bg)

    this.damageStatsTitleText = new Text({
      text: '战斗统计',
      style: { fontSize: 28, fill: 0xffefc8, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    this.damageStatsTitleText.anchor.set(0.5, 0)
    this.damageStatsTitleText.x = 0
    this.damageStatsTitleText.y = -panelH / 2 + 14
    panel.addChild(this.damageStatsTitleText)

    this.damageStatsTabPlayerBtn = this.makeStatsTabButton('我方', 'player')
    this.damageStatsTabPlayerBtn.x = -70
    this.damageStatsTabPlayerBtn.y = -panelH / 2 + 76
    panel.addChild(this.damageStatsTabPlayerBtn)

    this.damageStatsTabEnemyBtn = this.makeStatsTabButton('敌方', 'enemy')
    this.damageStatsTabEnemyBtn.x = 70
    this.damageStatsTabEnemyBtn.y = -panelH / 2 + 76
    panel.addChild(this.damageStatsTabEnemyBtn)

    this.damageStatsRowsCon = new Container()
    this.damageStatsRowsCon.y = 34
    panel.addChild(this.damageStatsRowsCon)

    panel.x = CANVAS_W / 2
    panel.y = getClampedStatsPanelY(panelH)
    panel.zIndex = 231
    panel.visible = false
    panel.eventMode = 'static'
    panel.on('pointerdown', (e) => e.stopPropagation())
    this.damageStatsPanel = panel
    // Initialize tab visuals
    this.setDamageStatsTab('player', 0, null)
    root.addChild(panel)
  }

  buildButton(root: Container, onToggle: () => void): Container {
    const con = new Container()
    const bg = new Graphics()
    const w = 116
    const h = TOP_ACTION_BTN_H
    bg.roundRect(-w / 2, -h / 2, w, h, 14)
    bg.stroke({ color: 0x96b2ff, width: 2, alpha: 0.95 })
    bg.fill({ color: 0x1f2945, alpha: 0.9 })
    con.addChild(bg)

    this.statsBtnText = new Text({
      text: '统计',
      style: { fontSize: 26, fill: 0xd9e4ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    this.statsBtnText.anchor.set(0.5)
    con.addChild(this.statsBtnText)

    con.x = 92
    con.y = getClampedTopActionBtnY()
    con.zIndex = 185
    con.eventMode = 'static'
    con.cursor = 'pointer'
    con.on('pointerdown', (e) => {
      e.stopPropagation()
      onToggle()
    })
    root.addChild(con)
    return con
  }

  buildSettlementButton(onToggle: () => void): Container {
    const con = new Container()
    const bg = new Graphics()
    const w = 116
    const h = TOP_ACTION_BTN_H
    bg.roundRect(-w / 2, -h / 2, w, h, 14)
    bg.stroke({ color: 0x96b2ff, width: 2, alpha: 0.95 })
    bg.fill({ color: 0x1f2945, alpha: 0.9 })
    con.addChild(bg)

    const btnText = new Text({
      text: '统计',
      style: { fontSize: 26, fill: 0xd9e4ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    btnText.anchor.set(0.5)
    con.addChild(btnText)

    con.x = -220
    con.y = -160
    con.visible = false
    con.eventMode = 'static'
    con.cursor = 'pointer'
    con.on('pointerdown', (e) => {
      e.stopPropagation()
      onToggle()
    })
    return con
  }

  setVisible(v: boolean): void {
    this.damageStatsPanelVisible = v
    if (this.damageStatsMask) this.damageStatsMask.visible = v
    if (this.damageStatsPanel) this.damageStatsPanel.visible = v
    if (this.statsBtnText) this.statsBtnText.text = v ? '关统计' : '统计'
    if (v) this.refreshDamageStatsPanel(this.damageStatsLastRenderAtMs, null, true)
  }

  isVisible(): boolean {
    return this.damageStatsPanelVisible
  }

  tick(battlePresentationMs: number, engine: CombatEngine | null): void {
    if (this.damageStatsPanel?.visible) {
      this.refreshDamageStatsPanel(battlePresentationMs, engine)
    }
    if (this.damageStatsPanel) {
      this.damageStatsPanel.y = getClampedStatsPanelY(DAMAGE_STATS_PANEL_H)
    }
  }

  reset(): void {
    this.battleStatsByItemId.clear()
    this.battleStatLastTriggerTickByItemId.clear()
    this.damageStatsPanelVisible = false
    this.damageStatsDirty = false
    this.damageStatsLastRenderAtMs = 0
    this.damageStatsMask = null
    this.damageStatsPanel = null
    this.damageStatsTitleText = null
    this.damageStatsRowsCon = null
    this.damageStatsTabPlayerBtn = null
    this.damageStatsTabEnemyBtn = null
    this.statsBtnText = null
    this.damageStatsRowViews = []
    this.damageStatsEmptyText = null
  }

  getPanel(): Container | null {
    return this.damageStatsPanel
  }

  getMask(): Graphics | null {
    return this.damageStatsMask
  }
}
