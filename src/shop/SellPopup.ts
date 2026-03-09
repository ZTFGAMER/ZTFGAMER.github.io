// ============================================================
// SellPopup — 物品信息浮层（仅展示，不含操作按钮）
// 非模态：不使用全屏遮罩，可放在指定位置
// ============================================================

import {
  Container, Graphics, Text, Sprite,
  Assets, Texture,
} from 'pixi.js'
import type { ItemDef } from '@/items/ItemDef'
import { getConfig as getGameConfig } from '@/core/DataLoader'
import { normalizeSize } from '@/items/ItemDef'
import { CELL_SIZE } from '@/grid/GridZone'
import { getItemIconUrl } from '@/core/assetPath'
import { getTierColor } from '@/config/colorPalette'

const DEFAULT_POPUP_W = 400
const POPUP_MIN_H = 240
const POPUP_MIN_W = 360

const TIER_ORDER = ['Bronze', 'Silver', 'Gold', 'Diamond'] as const

export type ItemInfoMode = 'simple' | 'detailed'

export interface ItemInfoRuntimeOverride {
  cooldownMs?: number
  damage?: number
  shield?: number
  heal?: number
  burn?: number
  poison?: number
  multicast?: number
  ammoCurrent?: number
  ammoMax?: number
}

export interface ItemInfoCustomDisplay {
  overrideName?: string
  lines?: string[]
  richLineSegments?: Array<{
    text: string
    fontSize?: number
    fill?: number
  }>
  lineStyles?: Array<{
    fontSize?: number
    fill?: number
  }>
  suppressStats?: boolean
  hideTierBadge?: boolean
  useQuestionIcon?: boolean
  hideName?: boolean
  centerRichLineInFrame?: boolean
}

function parseTierName(raw: string): string {
  for (const t of TIER_ORDER) {
    if (raw.includes(t)) return t
  }
  return ''
}

function parseTierStar(raw: string): 1 | 2 {
  const m = raw.match(/#(\d+)/)
  const n = Number(m?.[1] ?? '1')
  if (!Number.isFinite(n) || n <= 1) return 1
  return 2
}

function tierScoreFromRaw(raw: string): number {
  const tier = parseTierName(raw)
  const star = parseTierStar(raw)
  if (tier === 'Bronze') return 1
  if (tier === 'Silver') return star === 2 ? 3 : 2
  if (tier === 'Gold') return star === 2 ? 5 : 4
  return star === 2 ? 7 : 6
}

function startTierScoreFromItem(item: ItemDef): number {
  const tier = parseTierName(item.starting_tier || 'Bronze')
  if (tier === 'Silver') return 2
  if (tier === 'Gold') return 4
  if (tier === 'Diamond') return 6
  return 1
}

function formatTierLabel(baseTierRaw: string, rawTier: string): string {
  const baseTier = parseTierName(baseTierRaw) || 'Bronze'
  const level = Math.max(1, Math.min(7, tierScoreFromRaw(rawTier)))
  if (baseTier === 'Bronze') return `青铜Lv${level}`
  if (baseTier === 'Silver') return `白银Lv${level}`
  if (baseTier === 'Gold') return `黄金Lv${level}`
  return `钻石Lv${level}`
}

function pickTierValue(series: string, tierIndex: number): string {
  const parts = series.split(/[\/|]/).map(v => v.trim()).filter(Boolean)
  if (parts.length <= 1) return series
  const idx = Math.max(0, Math.min(parts.length - 1, tierIndex))
  const picked = parts[idx] ?? parts[0] ?? series
  const head = parts[0] ?? ''
  const headSign = head.match(/^[+\-]/)?.[0] ?? ''
  if (headSign && !/^[+\-]/.test(picked)) return `${headSign}${picked}`
  return picked
}

function formatDescByTier(raw: string, tierIndex: number): string {
  // 支持分档串：10/20/30、10|20|30、20%|30%
  return raw.replace(/[+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)+/g, (m) => pickTierValue(m, tierIndex))
}

function formatDescArrowByTier(raw: string, fromTierIndex: number, toTierIndex: number): string {
  return raw.replace(/[+\-]?\d+(?:\.\d+)?%?(?:[\/|][+\-]?\d+(?:\.\d+)?%?)+/g, (m) => {
    const from = pickTierValue(m, fromTierIndex)
    const to = pickTierValue(m, toTierIndex)
    return `${from}->${to}`
  })
}

function formatCooldownLine(item: ItemDef, tierIndex: number): string | null {
  const sec = getCooldownSecText(item, tierIndex)
  if (!sec) return null
  return `间隔：${sec}秒`
}

function getCooldownSecText(item: ItemDef, tierIndex: number): string | null {
  const ms = getCooldownMsByTier(item, tierIndex)
  if (!Number.isFinite(ms) || ms <= 0) return null
  const sec = ms / 1000
  return (Math.round(sec * 10) / 10).toFixed(1)
}

function getCooldownMsByTier(item: ItemDef, tierIndex: number): number {
  const rawTier = (item.cooldown_tiers ?? '').trim()

  let ms = Number.NaN
  if (rawTier && rawTier !== '无') {
    const picked = pickTierValue(rawTier, tierIndex)
    const n = Number(picked)
    if (Number.isFinite(n)) ms = n
  }
  if (!Number.isFinite(ms)) ms = Number(item.cooldown)

  return ms
}

type SimpleStatEntry = {
  label: string
  value: string
  color: number
  icon: string
}

function speedTierText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '无'
  if (ms <= 600) return '极快'
  if (ms <= 1000) return '很快'
  if (ms <= 1500) return '快'
  if (ms <= 2500) return '中等'
  if (ms <= 4000) return '慢'
  return '很慢'
}

function extractSimpleStatEntries(
  lines: string[],
  item: ItemDef,
  tierIndex: number,
  rt?: ItemInfoRuntimeOverride,
  displayMode: ItemInfoMode = 'simple',
): SimpleStatEntry[] {
  if (String(item.tags || '').includes('中立')) return []
  const out: SimpleStatEntry[] = []
  const find = (regex: RegExp): string | null => {
    for (const line of lines) {
      const m = line.match(regex)
      if (m?.[1]) return m[1]
    }
    return null
  }

  const damage = find(/(?:造成|攻击造成)\s*([+\-]?\d+(?:\.\d+)?)\s*伤害/)
  const multicast = (() => {
    if (typeof rt?.multicast === 'number') return Math.max(1, Math.round(rt.multicast))
    for (const line of lines) {
      const m = line.match(/(?:连发次数|连续发射)\s*[:：]?\s*(\d+)\s*次?/)
      if (m?.[1]) return Math.max(1, Math.round(Number(m[1])))
    }
    if (Number.isFinite(item.multicast) && item.multicast > 1) return Math.max(1, Math.round(item.multicast))
    return 1
  })()

  if (damage) {
    out.push({
      label: '伤害',
      value: multicast > 1 ? `${damage}*${multicast}` : damage,
      color: 0xff6b6b,
      icon: '✦',
    })
  }

  const shield = find(/(?:获得|提供)\s*([+\-]?\d+(?:\.\d+)?)\s*护盾/)
  if (shield) {
    out.push({
      label: '护盾',
      value: shield,
      color: 0xf5d46b,
      icon: '🛡',
    })
  }

  const ms = typeof rt?.cooldownMs === 'number'
    ? Math.max(0, rt.cooldownMs)
    : getCooldownMsByTier(item, tierIndex)
  if (!Number.isFinite(ms) || ms <= 0) {
    out.push({
      label: '',
      value: '被动物品',
      color: 0x62a8ff,
      icon: '◈',
    })
  } else {
    if (displayMode === 'simple') {
      out.push({
        label: '速度',
        value: speedTierText(ms),
        color: 0x62a8ff,
        icon: '⏱',
      })
    } else {
      const sec = (Math.round((ms / 1000) * 10) / 10).toFixed(1)
      out.push({
        label: '间隔',
        value: `${sec}秒`,
        color: 0x62a8ff,
        icon: '⏱',
      })
    }
  }

  const ammoValue = (() => {
    if (typeof rt?.ammoMax === 'number' && rt.ammoMax > 0) {
      if (typeof rt.ammoCurrent === 'number') {
        return `${Math.max(0, Math.round(rt.ammoCurrent))}/${Math.max(1, Math.round(rt.ammoMax))}`
      }
      return `${Math.max(1, Math.round(rt.ammoMax))}`
    }
    for (const line of lines) {
      const m = line.match(/弹药\s*[:：]\s*(\d+(?:\s*\/\s*\d+)?)/)
      if (m?.[1]) return m[1].replace(/\s+/g, '')
    }
    return null
  })()

  if (ammoValue) {
    out.push({
      label: '弹药',
      value: ammoValue,
      color: 0xffd36b,
      icon: '◉',
    })
  }

  return out
}

function stripTierNumbersFromGameplayLine(line: string): string {
  let out = line
  out = out.replace(/\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)+/g, '')
  out = out.replace(/[+\-]?\d+(?:\.\d+)?/g, '')
  out = out.replace(/\+\s*/g, '提升')
  out = out.replace(/\s+/g, '')
  out = out.replace(/[：:,，]\s*[。；;.!！?？]?$/g, '')
  out = out.replace(/[。；;.!！?？]+$/g, '')
  out = out.replace(/提升提升/g, '提升')
  out = out.replace(/次$/g, '')
  return out
}

function formatSimpleGameplayLine(lines: string[], preferred?: string): string {
  if (preferred && preferred.trim()) return preferred.trim().replace(/^玩法\s*[：:]\s*/u, '')
  const base = lines[1] ?? lines[0] ?? ''
  const text = stripTierNumbersFromGameplayLine(base)
  return (text || '(暂无玩法描述)').replace(/^玩法\s*[：:]\s*/u, '')
}

function isPureStatLine(line: string): boolean {
  const s = line.replace(/\s+/g, '').replace(/[。；;!！?？]+$/g, '')
  if (!s) return false
  if (/^(攻击)?造成[+\-]?\d+(?:\.\d+)?伤害$/.test(s)) return true
  if (/^(获得|提供|回复|治疗)[+\-]?\d+(?:\.\d+)?(护盾|生命|治疗)?$/.test(s)) return true
  if (/^造成[+\-]?\d+(?:\.\d+)?(灼烧|剧毒|中毒)$/.test(s)) return true
  if (/^(冷却|间隔)[:：]?[+\-]?\d+(?:\.\d+)?秒$/.test(s)) return true
  return false
}

function applyRuntimeValueToLine(line: string, rt?: ItemInfoRuntimeOverride): string {
  if (!rt) return line
  let out = line
  const damage = typeof rt.damage === 'number' ? Math.max(0, Math.round(rt.damage)) : null
  const shield = typeof rt.shield === 'number' ? Math.max(0, Math.round(rt.shield)) : null
  const burn = typeof rt.burn === 'number' ? Math.max(0, Math.round(rt.burn)) : null
  const poison = typeof rt.poison === 'number' ? Math.max(0, Math.round(rt.poison)) : null
  const multicast = typeof rt.multicast === 'number' ? Math.max(1, Math.round(rt.multicast)) : null
  if (damage !== null) out = out.replace(/(?:攻击造成|造成)\s*\d+(?:\.\d+)?\s*伤害/g, (m) => m.replace(/\d+(?:\.\d+)?/, `${damage}`))
  if (shield !== null) out = out.replace(/(?:获得|提供)\s*\d+(?:\.\d+)?\s*护盾/g, (m) => m.replace(/\d+(?:\.\d+)?/, `${shield}`))
  if (burn !== null) out = out.replace(/造成\s*\d+(?:\.\d+)?\s*灼烧/g, (m) => m.replace(/\d+(?:\.\d+)?/, `${burn}`))
  if (poison !== null) out = out.replace(/造成\s*\d+(?:\.\d+)?\s*剧毒/g, (m) => m.replace(/\d+(?:\.\d+)?/, `${poison}`))
  if (multicast !== null) {
    out = out.replace(/(?:连续发射|连发次数[:：]?|攻击次数\+)\s*\d+(?:\.\d+)?\s*次?/g, (m) => m.replace(/\d+(?:\.\d+)?/, `${multicast}`))
  }
  if (typeof rt.ammoMax === 'number') {
    const ammoText = typeof rt.ammoCurrent === 'number'
      ? `${Math.max(0, Math.round(rt.ammoCurrent))}/${Math.max(0, Math.round(rt.ammoMax))}`
      : `${Math.max(0, Math.round(rt.ammoMax))}`
    out = out.replace(/弹药\s*[:：]\s*\d+(?:\/\d+)?/g, `弹药:${ammoText}`)
  }
  return out
}

export class SellPopup extends Container {
  private canvasW: number
  private panelW = DEFAULT_POPUP_W
  private minH = POPUP_MIN_H
  private minHSmall = 180
  private currentMinH = POPUP_MIN_H
  private panelH = POPUP_MIN_H
  private anchorY = 100
  private anchorBottomY: number | null = null
  private anchorCenterY: number | null = null
  private panel:   Container      // 弹窗主体
  private panelBg: Graphics
  private iconSp:  Sprite
  private iconQuestionT: Text
  private iconFrame: Graphics
  private nameT:   Text
  private tierBadgeBg: Graphics
  private tierBadgeT: Text
  private cooldownT: Text
  private priceT:  Text
  private descCon: Container
  private descDividerG: Graphics
  private descTexts: Text[] = []
  private lastItem: ItemDef | null = null
  private lastPrice = 0
  private lastPriceMode: 'sell' | 'buy' | 'none' = 'sell'
  private lastTierOverride: string | undefined = undefined
  private lastUpgradeFromTier: string | undefined = undefined
  private lastInfoMode: ItemInfoMode = 'detailed'
  private lastRuntimeOverride: ItemInfoRuntimeOverride | undefined = undefined
  private lastCustomDisplay: ItemInfoCustomDisplay | undefined = undefined
  private textSize = { name: 22, tier: 14, cooldown: 16, priceCorner: 20, desc: 16, simpleDesc: 16 }
  private cornerRadius = 10

  constructor(canvasW: number, _canvasH: number) {
    super()
    this.canvasW = canvasW

    const ts = getGameConfig().textSizes
    this.textSize = {
      name: ts.itemInfoName,
      tier: ts.itemInfoTier,
      cooldown: ts.itemInfoCooldown,
      priceCorner: ts.itemInfoPriceCorner,
      desc: ts.itemInfoDesc,
      simpleDesc: ts.itemInfoDesc,
    }

    // 弹窗面板
    this.panel = new Container()
    this.panel.x = (canvasW - this.panelW) / 2
    this.panel.y = 100
    this.panel.eventMode = 'static'
    this.panel.on('pointerdown', (e) => e.stopPropagation())

    // 面板背景
    this.panelBg = new Graphics()
    this.panel.addChild(this.panelBg)
    this.redrawPanel(POPUP_MIN_H)

    // 物品图标（按实际尺寸 + item_visual_scale）
    this.iconSp         = new Sprite(Texture.WHITE)
    this.iconSp.width   = 1
    this.iconSp.height  = 1
    this.iconSp.x       = 0
    this.iconSp.y       = 0
    this.iconSp.alpha   = 0
    this.panel.addChild(this.iconSp)

    this.iconQuestionT = new Text({
      text: '?',
      style: {
        fontSize: 72,
        fill: 0xe6ecff,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x000000, width: 4 },
      },
    })
    this.iconQuestionT.anchor.set(0.5)
    this.iconQuestionT.visible = false
    this.panel.addChild(this.iconQuestionT)

    this.iconFrame = new Graphics()
    this.panel.addChild(this.iconFrame)

    // 物品名
    this.nameT = new Text({
        text: '',
        style: {
        fontSize: this.textSize.name,
        fill: 0xddddee,
        fontFamily: 'Arial',
        align: 'left',
        wordWrap: true,
        wordWrapWidth: this.panelW - 24,
        breakWords: true,
        lineHeight: 28,
      },
    })
    this.panel.addChild(this.nameT)

    this.tierBadgeBg = new Graphics()
    this.panel.addChild(this.tierBadgeBg)

    this.tierBadgeT = new Text({
      text: '',
      style: {
        fontSize: this.textSize.tier,
        fill: 0xffffff,
        fontFamily: 'Arial',
        fontWeight: 'bold',
      },
    })
    this.panel.addChild(this.tierBadgeT)

    this.cooldownT = new Text({
      text: '',
      style: {
        fontSize: this.textSize.cooldown,
        fill: 0x62a8ff,
        fontFamily: 'Arial',
        fontWeight: 'bold',
      },
    })
    this.panel.addChild(this.cooldownT)

    // 出售价格
    this.priceT = new Text({
      text: '',
      style: { fontSize: this.textSize.priceCorner, fill: 0xffd700, fontFamily: 'Arial', align: 'left', fontWeight: 'bold' },
    })
    this.panel.addChild(this.priceT)

    // 技能描述（分行渲染 + 分隔线）
    this.descCon = new Container()
    this.descDividerG = new Graphics()
    this.descCon.addChild(this.descDividerG)
    this.panel.addChild(this.descCon)

    this.addChild(this.panel)
    this.visible = false
  }

  setAnchor(x: number, y: number): void {
    void x
    this.anchorY = y
    this.anchorCenterY = null
    this.applyPanelPosition()
  }

  setBottomAnchor(bottomY: number): void {
    this.anchorBottomY = bottomY
    this.anchorCenterY = null
    this.applyPanelPosition()
  }

  clearBottomAnchor(): void {
    this.anchorBottomY = null
    this.applyPanelPosition()
  }

  setCenterY(centerY: number): void {
    this.anchorBottomY = null
    this.anchorCenterY = centerY
    this.applyPanelPosition()
  }

  setMinHeight(height: number): void {
    this.minH = Math.max(0, height)
    this.currentMinH = this.minH
    if (this.lastItem) {
      this.show(this.lastItem, this.lastPrice, this.lastPriceMode, this.lastTierOverride, this.lastUpgradeFromTier, this.lastInfoMode, this.lastRuntimeOverride, this.lastCustomDisplay)
    } else {
      this.redrawPanel(this.minH)
      this.setAnchor(0, this.anchorY)
    }
  }

  setSmallMinHeight(height: number): void {
    this.minHSmall = Math.max(0, height)
    if (this.lastItem) {
      this.show(this.lastItem, this.lastPrice, this.lastPriceMode, this.lastTierOverride, this.lastUpgradeFromTier, this.lastInfoMode, this.lastRuntimeOverride, this.lastCustomDisplay)
    }
  }

  setTextSizes(sizes: { name?: number; tier?: number; cooldown?: number; priceCorner?: number; desc?: number; simpleDesc?: number }): void {
    const n = (v: unknown, fallback: number) => {
      const x = Number(v)
      return Number.isFinite(x) ? Math.max(1, x) : fallback
    }
    this.textSize = {
      name:  n(sizes.name,  this.textSize.name),
      tier:  n(sizes.tier,  this.textSize.tier),
      cooldown: n(sizes.cooldown, this.textSize.cooldown),
      priceCorner: n(sizes.priceCorner, this.textSize.priceCorner),
      desc:  n(sizes.desc,  this.textSize.desc),
      simpleDesc: n(sizes.simpleDesc, this.textSize.simpleDesc),
    }
    this.nameT.style.fontSize  = this.textSize.name
    this.tierBadgeT.style.fontSize = this.textSize.tier
    this.cooldownT.style.fontSize = this.textSize.cooldown
    this.priceT.style.fontSize = this.textSize.priceCorner
    if (this.lastItem) this.show(this.lastItem, this.lastPrice, this.lastPriceMode, this.lastTierOverride, this.lastUpgradeFromTier, this.lastInfoMode, this.lastRuntimeOverride, this.lastCustomDisplay)
  }

  setCornerRadius(radius: number): void {
    this.cornerRadius = Math.max(0, radius)
    if (this.lastItem) this.show(this.lastItem, this.lastPrice, this.lastPriceMode, this.lastTierOverride, this.lastUpgradeFromTier, this.lastInfoMode, this.lastRuntimeOverride, this.lastCustomDisplay)
  }

  setWidth(width: number): void {
    this.panelW = Math.max(POPUP_MIN_W, Math.min(this.canvasW, width))
    this.nameT.style.wordWrapWidth = this.panelW - 24
    if (this.lastItem) {
      this.show(this.lastItem, this.lastPrice, this.lastPriceMode, this.lastTierOverride, this.lastUpgradeFromTier, this.lastInfoMode, this.lastRuntimeOverride, this.lastCustomDisplay)
    } else {
      this.redrawPanel(POPUP_MIN_H)
      this.setAnchor(0, this.anchorY)
    }
  }

  /** 展示弹窗（需传入物品信息及出售价格） */
  show(item: ItemDef, price: number, priceMode: 'sell' | 'buy' | 'none' = 'sell', tierOverride?: string, upgradeFromTier?: string, infoMode: ItemInfoMode = 'detailed', runtimeOverride?: ItemInfoRuntimeOverride, customDisplay?: ItemInfoCustomDisplay): void {
    this.lastItem = item
    this.lastPrice = price
    this.lastPriceMode = priceMode
    this.lastTierOverride = tierOverride
    this.lastUpgradeFromTier = upgradeFromTier
    this.lastInfoMode = infoMode
    this.lastRuntimeOverride = runtimeOverride
    this.lastCustomDisplay = customDisplay
    const cfg = getGameConfig()
    const visualScale = cfg.itemVisualScale
    const size = normalizeSize(item.size)
    const baseIconW = (size === '1x1' ? CELL_SIZE : size === '2x1' ? CELL_SIZE * 2 : CELL_SIZE * 3) * visualScale
    const baseIconH = baseIconW
    const iconW = baseIconW
    const iconH = baseIconH
    this.currentMinH = size === '1x1' ? this.minHSmall : this.minH

    const pad = 16
    const gap = 14
    const top = 14

    const tierRaw = tierOverride ?? (parseTierName(item.starting_tier) || 'Bronze')
    const tier = parseTierName(tierRaw) || 'Bronze'
    const baseTier = parseTierName(item.starting_tier || 'Bronze') || 'Bronze'
    const tierColor = getTierColor(baseTier)
    const tierLabel = formatTierLabel(baseTier, tierRaw)
    const fromTierLabel = formatTierLabel(baseTier, upgradeFromTier ?? tierRaw)
    const startScore = startTierScoreFromItem(item)
    const tierIndex = Math.max(0, tierScoreFromRaw(tierRaw) - startScore)
    const fromTier = parseTierName(upgradeFromTier ?? tierRaw) || tier
    const fromStar = fromTier === 'Bronze' ? 1 : parseTierStar(upgradeFromTier ?? tierRaw)
    const fromRaw = `${fromTier}#${fromStar}`
    const fromTierIndex = Math.max(0, tierScoreFromRaw(fromRaw) - startScore)
    const inUpgradePreview = Boolean(upgradeFromTier && fromTier !== tier)
    // 先更新字体，再计算布局
    this.nameT.style.fontSize  = this.textSize.name
    this.tierBadgeT.style.fontSize = this.textSize.tier
    this.cooldownT.style.fontSize = this.textSize.cooldown
    this.priceT.style.fontSize = this.textSize.priceCorner

    const overrideName = customDisplay?.overrideName
    this.nameT.text  = (typeof overrideName === 'string') ? overrideName.trim() : item.name_cn
    this.priceT.text = ''
    this.priceT.visible = false
    const cooldownLine = (() => {
      if (runtimeOverride && typeof runtimeOverride.cooldownMs === 'number') {
        const sec = Math.max(0, runtimeOverride.cooldownMs) / 1000
        return `间隔：${(Math.round(sec * 10) / 10).toFixed(1)}秒`
      }
      if (!inUpgradePreview) return formatCooldownLine(item, tierIndex)
      const oldSec = getCooldownSecText(item, fromTierIndex)
      const newSec = getCooldownSecText(item, tierIndex)
      if (oldSec && newSec) return `间隔：${oldSec}秒 -> ${newSec}秒`
      return formatCooldownLine(item, tierIndex)
    })()
    this.cooldownT.text = cooldownLine ?? ''
    this.cooldownT.visible = false

    const skillLinesRaw = item.skills
      .map((s) => s.cn?.trim())
      .filter((s): s is string => Boolean(s))
    const descGuideSimple = item.simple_desc?.trim() || undefined
    const descGuideTiered = item.simple_desc_tiered?.trim() || undefined

    const statLines = skillLinesRaw.map((s) => applyRuntimeValueToLine(formatDescByTier(s, tierIndex), runtimeOverride))
    const simpleStats = customDisplay?.suppressStats
      ? []
      : (() => {
        if (!inUpgradePreview) return extractSimpleStatEntries(statLines, item, tierIndex, runtimeOverride, infoMode)
        const fromLines = skillLinesRaw.map((s) => applyRuntimeValueToLine(formatDescByTier(s, fromTierIndex), runtimeOverride))
        const fromStats = extractSimpleStatEntries(fromLines, item, fromTierIndex, runtimeOverride, infoMode)
        const toStats = extractSimpleStatEntries(statLines, item, tierIndex, runtimeOverride, infoMode)
        const fromMap = new Map(fromStats.map((s) => [`${s.label}|${s.icon}`, s.value]))
        return toStats.map((s) => {
          const key = `${s.label}|${s.icon}`
          const fromValue = fromMap.get(key) ?? s.value
          return { ...s, value: `${fromValue}->${s.value}` }
        })
      })()
    const descLines = (() => {
      if (customDisplay?.lines && customDisplay.lines.length > 0) {
        return customDisplay.lines
      }
      if (infoMode === 'simple') {
        return [
          formatSimpleGameplayLine(statLines, descGuideSimple),
        ]
      }

      if (!inUpgradePreview) {
        if (descGuideTiered) {
          return [applyRuntimeValueToLine(formatDescByTier(descGuideTiered, tierIndex), runtimeOverride)]
        }
        const lines = skillLinesRaw
          .map((s) => applyRuntimeValueToLine(formatDescByTier(s, tierIndex), runtimeOverride))
          .filter((line) => !isPureStatLine(line))
        return lines.length > 0 ? lines : []
      }

      if (descGuideTiered) {
        return [formatDescArrowByTier(descGuideTiered, fromTierIndex, tierIndex)]
      }

      return skillLinesRaw.map((s) => formatDescArrowByTier(s, fromTierIndex, tierIndex))
    })()

    const isSimple = infoMode === 'simple'

    const frameX = pad
    const frameY = top
    // 边框与图标一致，按物品基础可视尺寸展示
    const frameW = iconW
    const frameH = iconH

    const iconInset = 6
    this.iconSp.width = Math.max(1, frameW - iconInset * 2)
    this.iconSp.height = Math.max(1, frameH - iconInset * 2)
    this.iconSp.x = frameX + iconInset
    this.iconSp.y = frameY + iconInset
    this.iconSp.visible = !customDisplay?.useQuestionIcon
    this.iconQuestionT.visible = Boolean(customDisplay?.useQuestionIcon)
    this.iconQuestionT.style.fontSize = Math.max(28, Math.round(frameH * 0.56))
    this.iconQuestionT.x = frameX + frameW / 2
    this.iconQuestionT.y = frameY + frameH / 2

    this.iconFrame.clear()
    this.iconFrame.roundRect(frameX, frameY, frameW, frameH, this.cornerRadius)
    this.iconFrame.stroke({ color: tierColor, width: 4, alpha: 0.98 })
    this.iconFrame.visible = true

    let rightX = frameX + frameW + gap
    let rightW = Math.max(120, this.panelW - rightX - pad)
    const simpleNarrowLayout = isSimple && (rightX + 120 > this.panelW - pad)
    if (simpleNarrowLayout) {
      rightX = pad
      rightW = Math.max(120, this.panelW - pad * 2)
    }
    this.nameT.style.wordWrap = false
    this.nameT.style.wordWrapWidth = rightW

    this.nameT.x = rightX
    this.nameT.y = top
    this.nameT.visible = !isSimple && !customDisplay?.hideName

    this.tierBadgeT.text = inUpgradePreview ? `${fromTierLabel}->${tierLabel}` : tierLabel
    const badgePadX = 10
    const badgePadY = 4
    const badgeW = this.tierBadgeT.width + badgePadX * 2
    const badgeH = this.tierBadgeT.height + badgePadY * 2
    const nameTierGap = Math.max(8, Math.round(this.textSize.tier * 0.8))
    this.cooldownT.x = this.panelW - pad - this.cooldownT.width
    this.cooldownT.y = top
    this.cooldownT.visible = false

    const tierMaxX = (this.cooldownT.visible ? this.cooldownT.x - 8 : (this.panelW - pad)) - badgeW + badgePadX
    this.tierBadgeT.x = Math.max(rightX + badgePadX, Math.min(tierMaxX, rightX + this.nameT.width + nameTierGap + badgePadX))
    this.tierBadgeT.y = this.nameT.y + 2
    this.tierBadgeBg.clear()
    if (!isSimple) {
      this.tierBadgeBg.roundRect(this.tierBadgeT.x - badgePadX, this.tierBadgeT.y - badgePadY, badgeW, badgeH, 8)
      this.tierBadgeBg.fill({ color: tierColor, alpha: 0.92 })
      this.tierBadgeBg.stroke({ color: 0xffffff, width: 1, alpha: 0.5 })
    }
    const isNeutral = String(item.tags || '').includes('中立')
    const forceWhiteDesc = item.name_cn === '原石' || item.name_cn === '空白卷轴'
    const showTierBadge = !isSimple && !customDisplay?.hideTierBadge && !isNeutral
    this.tierBadgeBg.visible = showTierBadge
    this.tierBadgeT.visible = showTierBadge

    // 描述区布局
    this.descCon.x = rightX
    const headerH = Math.max(
      this.nameT.visible ? this.nameT.height : 0,
      this.tierBadgeT.visible ? this.tierBadgeT.height : 0,
      this.cooldownT.visible ? this.cooldownT.height : 0,
    )
    this.descCon.y = isSimple
      ? (simpleNarrowLayout ? (frameY + frameH + 8) : top)
      : (top + headerH + 10)
    this.descDividerG.clear()
    for (const t of this.descTexts) {
      if (t.parent) t.parent.removeChild(t)
      t.destroy()
    }
    this.descTexts = []

    let cursorY = 0
    const lineGap = 6
    if (simpleStats.length > 0) {
      let statX = 0
      let statLineH = 0
      for (const entry of simpleStats) {
        const t = new Text({
          text: `${entry.icon} ${entry.label}${entry.value}`,
          style: {
            fontSize: this.textSize.simpleDesc,
            fill: entry.color,
            fontFamily: 'Arial',
            fontWeight: 'bold',
          },
        })
        if (statX > 0 && statX + t.width > rightW) {
          statX = 0
          cursorY += statLineH + 4
          statLineH = 0
        }
        t.x = statX
        t.y = cursorY
        this.descCon.addChild(t)
        this.descTexts.push(t)
        statX += t.width + 16
        statLineH = Math.max(statLineH, t.height)
      }
      cursorY += statLineH
      if (descLines.length > 0) {
        const y = cursorY + 5
        this.descDividerG.moveTo(0, y)
        this.descDividerG.lineTo(rightW, y)
        this.descDividerG.stroke({ color: 0x5a628f, width: 1, alpha: 0.9 })
        cursorY += 10
      }
    }

    const richLineSegments = customDisplay?.richLineSegments
    if (richLineSegments && richLineSegments.length > 0) {
      const row = new Container()
      row.x = 0
      let rowY = cursorY
      this.descCon.addChild(row)

      const baseFontSize = isSimple ? this.textSize.simpleDesc : this.textSize.desc
      const parts: Text[] = []
      let rowW = 0
      let rowH = 0
      for (const seg of richLineSegments) {
        const t = new Text({
          text: seg.text,
          style: {
            fontSize: seg.fontSize ?? baseFontSize,
            fill: seg.fill ?? (forceWhiteDesc ? 0xffffff : 0xbfc7f5),
            fontFamily: 'Arial',
            wordWrap: false,
          },
        })
        parts.push(t)
        rowW += t.width
        rowH = Math.max(rowH, t.height)
      }
      let x = Math.max(0, (rightW - rowW) / 2)
      for (const t of parts) {
        t.x = x
        t.y = Math.max(0, (rowH - t.height) / 2)
        row.addChild(t)
        this.descTexts.push(t)
        x += t.width
      }
      if (customDisplay?.centerRichLineInFrame) {
        const centeredY = Math.round(frameY + (frameH - rowH) / 2 - this.descCon.y)
        rowY = Math.max(cursorY, centeredY)
      }
      row.y = rowY
      cursorY = rowY + rowH
    } else {
      for (let i = 0; i < descLines.length; i++) {
        const lineStyle = customDisplay?.lineStyles?.[i]
        const t = new Text({
          text: descLines[i] ?? '',
          style: {
            fontSize: lineStyle?.fontSize ?? (isSimple ? this.textSize.simpleDesc : this.textSize.desc),
            fill: lineStyle?.fill ?? (forceWhiteDesc ? 0xffffff : 0xbfc7f5),
            fontFamily: 'Arial',
            wordWrap: true,
            wordWrapWidth: rightW,
            breakWords: true,
            lineHeight: Math.round((isSimple ? this.textSize.simpleDesc : this.textSize.desc) * 1.25),
          },
        })
        t.x = 0
        t.y = cursorY
        this.descCon.addChild(t)
        this.descTexts.push(t)
        cursorY += t.height
        if (descLines.length >= 2 && i < descLines.length - 1) {
          const y = cursorY + Math.max(2, Math.round(lineGap / 2))
          this.descDividerG.moveTo(0, y)
          this.descDividerG.lineTo(rightW, y)
          this.descDividerG.stroke({ color: 0x5a628f, width: 1, alpha: 0.9 })
          cursorY += lineGap + 2
        } else if (i < descLines.length - 1) {
          cursorY += lineGap
        }
      }
    }

    this.priceT.x = this.panelW - pad - this.priceT.width
    const contentBottomPad = 12
    this.priceT.y = Math.max(this.descCon.y + cursorY + 8, frameY + frameH - this.priceT.height)

    const iconBottom = frameY + frameH
    const textBottom = this.priceT.visible
      ? (this.priceT.y + this.priceT.height + contentBottomPad)
      : (this.descCon.y + cursorY + contentBottomPad)
    const panelH = Math.max(this.currentMinH, Math.max(iconBottom + pad, textBottom))
    this.redrawPanel(panelH)
    this.applyPanelPosition()

    // 异步加载图标
    if (!customDisplay?.useQuestionIcon) {
      const url = getItemIconUrl(item.id)
      this.iconSp.alpha = 0
      Assets.load<Texture>(url).then(tex => {
        this.iconSp.texture = tex
        this.iconSp.alpha   = 1
      }).catch((err) => {
        console.warn('[SellPopup] 图标加载失败', url, err)
      })
    }

    this.visible = true
  }

  showUpgradePreview(item: ItemDef, price: number, fromTier: string, toTier: string, priceMode: 'sell' | 'buy' | 'none' = 'buy'): void {
    this.show(item, price, priceMode, toTier, fromTier, 'detailed')
  }

  hide(): void {
    this.visible = false
  }

  private redrawPanel(height: number): void {
    this.panelH = height
    this.panelBg.clear()
    this.panelBg.roundRect(0, 0, this.panelW, height, 18)
    this.panelBg.fill({ color: 0x1e1e30, alpha: 0.97 })
    this.panelBg.stroke({ color: 0x5566aa, width: 2 })
  }

  private applyPanelPosition(): void {
    this.panel.x = (this.canvasW - this.panelW) / 2
    if (this.anchorCenterY !== null) {
      this.panel.y = this.anchorCenterY - this.panelH / 2
    } else if (this.anchorBottomY !== null) {
      this.panel.y = this.anchorBottomY - this.panelH
    } else {
      this.panel.y = this.anchorY + (this.currentMinH - this.panelH)
    }
  }
}
