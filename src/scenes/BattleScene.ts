import type { Scene } from './SceneManager'
import { getBattleSnapshot } from '@/combat/BattleSnapshotStore'
import { CombatEngine, setCombatRuntimeOverride, type CombatBoardItem } from '@/combat/CombatEngine'
import { SceneManager } from '@/scenes/SceneManager'
import { getApp } from '@/core/AppContext'
import { Container, Graphics, Text } from 'pixi.js'
import { GridZone, CELL_SIZE, CELL_HEIGHT } from '@/grid/GridZone'
import { getAllItems, getConfig as getGameCfg } from '@/core/DataLoader'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import type { ItemSizeNorm } from '@/items/ItemDef'
import { EventBus } from '@/core/EventBus'
import { SellPopup } from '@/shop/SellPopup'
import { getBattleEffectColor, getBattleFloatTextColor, getBattleOrbColor } from '@/config/colorPalette'

const CANVAS_W = 640

let root: Container | null = null
let titleText: Text | null = null
let statusText: Text | null = null
let backBtn: Container | null = null
let heroHudG: Graphics | null = null
let enemyHpInfoCon: Container | null = null
let playerHpInfoCon: Container | null = null
let enemyZone: GridZone | null = null
let playerZone: GridZone | null = null
let enemyCdOverlay: Graphics | null = null
let playerCdOverlay: Graphics | null = null
let engine: CombatEngine | null = null
let fxLayer: Container | null = null
let offFireEvent: (() => void) | null = null
let offDamageEvent: (() => void) | null = null
let offShieldEvent: (() => void) | null = null
let offHealEvent: (() => void) | null = null
let offStatusApplyEvent: (() => void) | null = null
let offStatusRemoveEvent: (() => void) | null = null
let onStageTapHidePopup: (() => void) | null = null
let itemInfoPopup: SellPopup | null = null
let selectedItemId: string | null = null

type TickAnim = (dtMs: number) => boolean
const activeFx: TickAnim[] = []

type PulseState = {
  node: ReturnType<GridZone['getNode']>
  flash: Graphics
  elapsedMs: number
  durationMs: number
  maxScale: number
}
const pulseStates = new Map<string, PulseState>()

function getDayActiveCols(day: number): number {
  const slots = getGameCfg().dailyBattleSlots
  if (day <= 2) return slots[0] ?? 4
  if (day <= 4) return slots[1] ?? 5
  return slots[2] ?? 6
}

function getZoneX(activeCols: number): number {
  const s = getGameCfg().itemVisualScale
  return getDebugCfg('battleZoneX') + (6 - activeCols) / 2 * CELL_SIZE * s
}

function sizeToWH(size: ItemSizeNorm): { w: number; h: number } {
  if (size === '2x1') return { w: 2, h: 1 }
  if (size === '3x1') return { w: 3, h: 1 }
  return { w: 1, h: 1 }
}

function getHeroBarCenter(side: 'player' | 'enemy'): { x: number; y: number } {
  const barW = getDebugCfg('battleHpBarWidth')
  const barH = getDebugCfg('battleHpBarH')
  const x = (CANVAS_W - barW) / 2 + barW / 2
  const y = (side === 'enemy' ? getDebugCfg('enemyHpBarY') : getDebugCfg('playerHpBarY')) + barH / 2
  return { x, y }
}

function getItemCenterById(sourceItemId: string, side: 'player' | 'enemy'): { x: number; y: number } | null {
  if (!enemyZone || !playerZone) return null
  const zone = side === 'enemy' ? enemyZone : playerZone
  const node = zone.getNode(sourceItemId)
  if (!node) return null
  const { w, h } = sizeToWH(node.size)
  return {
    x: zone.x + (node.container.x + (w * CELL_SIZE) / 2) * zone.scale.x,
    y: zone.y + (node.container.y + (h * CELL_HEIGHT) / 2) * zone.scale.y,
  }
}

function getItemCenterAnySide(sourceItemId: string): { pos: { x: number; y: number }; side: 'player' | 'enemy' } | null {
  const p = getItemCenterById(sourceItemId, 'player')
  if (p) return { pos: p, side: 'player' }
  const e = getItemCenterById(sourceItemId, 'enemy')
  if (e) return { pos: e, side: 'enemy' }
  return null
}

function animateItemFirePulse(sourceItemId: string, side: 'player' | 'enemy'): void {
  const zone = side === 'enemy' ? enemyZone : playerZone
  if (!zone) return
  const node = zone.getNode(sourceItemId)
  if (!node) return

  const maxScale = getDebugCfg('battleFirePulseScaleMax')
  const totalMs = getDebugCfg('battleFirePulseMs')
  const existing = pulseStates.get(sourceItemId)
  if (existing && existing.node) {
    existing.elapsedMs = 0
    existing.durationMs = totalMs
    existing.maxScale = maxScale
    existing.node.visual.scale.set(1)
    existing.flash.alpha = 0
    return
  }

  const flash = new Graphics()
  flash.roundRect(4, 4, node.container.width - 8, node.container.height - 8, Math.max(4, getDebugCfg('gridItemCornerRadius')))
  flash.stroke({ color: 0xffdf66, width: 3, alpha: 0.95 })
  flash.alpha = 0
  node.visual.addChild(flash)
  node.visual.scale.set(1)
  pulseStates.set(sourceItemId, {
    node,
    flash,
    elapsedMs: 0,
    durationMs: totalMs,
    maxScale,
  })
}

function tickPulseStates(dtMs: number): void {
  for (const [id, st] of pulseStates) {
    if (!st.node) {
      pulseStates.delete(id)
      continue
    }
    st.elapsedMs += dtMs
    const p = Math.min(1, st.elapsedMs / Math.max(1, st.durationMs))
    const wave = p < 0.5 ? p / 0.5 : 1 - (p - 0.5) / 0.5
    const cur = 1 + (st.maxScale - 1) * wave
    st.node.visual.scale.set(cur)
    st.flash.alpha = wave
    if (p >= 1) {
      st.node.visual.scale.set(1)
      if (st.flash.parent) st.flash.parent.removeChild(st.flash)
      st.flash.destroy()
      pulseStates.delete(id)
    }
  }
}

function spawnProjectile(from: { x: number; y: number }, to: { x: number; y: number }, color: number, onHit?: () => void): void {
  if (!fxLayer) return
  const dot = new Graphics()
  dot.circle(0, 0, 5)
  dot.fill({ color, alpha: 0.95 })
  dot.x = from.x
  dot.y = from.y
  fxLayer.addChild(dot)

  const duration = getDebugCfg('battleProjectileFlyMs')
  let t = 0
  activeFx.push((dtMs) => {
    t += dtMs
    const p = Math.min(1, t / duration)
    dot.x = from.x + (to.x - from.x) * p
    dot.y = from.y + (to.y - from.y) * p
    if (p >= 1) {
      if (dot.parent) dot.parent.removeChild(dot)
      dot.destroy()
      onHit?.()
      return false
    }
    return true
  })
}

function spawnFloatingNumber(to: { x: number; y: number }, text: string, color: number, fontSize?: number): void {
  if (!fxLayer) return
  const t = new Text({
    text,
    style: {
      fontSize: fontSize ?? getDebugCfg('battleHpTextFontSize'),
      fill: color,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      stroke: { color: 0x000000, width: 3 },
    },
  })
  const randomX = getDebugCfg('battleDamageFloatRandomX')
  t.x = to.x - t.width / 2 + (Math.random() * 2 - 1) * randomX
  t.y = to.y - t.height / 2
  fxLayer.addChild(t)

  const riseMs = getDebugCfg('battleDamageFloatRiseMs')
  const riseY = getDebugCfg('battleDamageFloatRiseY')
  const holdMs = getDebugCfg('battleDamageFloatHoldMs')
  const fadeMs = getDebugCfg('battleDamageFloatFadeMs')
  let elapsed = 0
  activeFx.push((dtMs) => {
    elapsed += dtMs
    if (elapsed <= riseMs) {
      const p = elapsed / Math.max(1, riseMs)
      t.y = to.y - t.height / 2 - riseY * p
      return true
    }
    if (elapsed <= riseMs + holdMs) return true
    const fadeT = elapsed - riseMs - holdMs
    t.alpha = Math.max(0, 1 - fadeT / Math.max(1, fadeMs))
    if (fadeT >= fadeMs) {
      if (t.parent) t.parent.removeChild(t)
      t.destroy()
      return false
    }
    return true
  })
}

function makeBackButton(): Container {
  const con = new Container()
  const bg = new Graphics()
  const w = 208
  const h = 104
  const x = (CANVAS_W - w) / 2
  const y = 1200
  bg.roundRect(x, y, w, h, 18)
  bg.stroke({ color: 0xffcc44, width: 3 })
  bg.fill({ color: 0x3f3322, alpha: 0.9 })
  con.addChild(bg)

  const txt = new Text({
    text: '回到商店',
    style: { fontSize: getDebugCfg('battleBackButtonLabelFontSize'), fill: 0xffcc44, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  txt.x = 320 - txt.width / 2
  txt.y = y + (h - txt.height) / 2
  con.addChild(txt)
  con.eventMode = 'static'
  con.cursor = 'pointer'
  con.on('pointerdown', () => {
    SceneManager.goto('shop')
  })
  return con
}

function drawInfoText(con: Container, centerX: number, centerY: number, parts: Array<{ text: string; color: number }>, fontSize: number): void {
  con.removeChildren()
  let x = 0
  const nodes: Text[] = []
  for (const p of parts) {
    const t = new Text({
      text: p.text,
      style: {
        fontSize,
        fill: p.color,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x000000, width: 3 },
      },
    })
    t.x = x
    t.y = 0
    x += t.width + 4
    nodes.push(t)
    con.addChild(t)
  }
  const totalW = Math.max(0, x - 4)
  con.x = centerX - totalW / 2
  const maxH = nodes.reduce((m, n) => Math.max(m, n.height), 0)
  con.y = centerY - maxH / 2
}

function drawHeroBars(
  player: { hp: number; maxHp: number; shield: number; burn: number; poison: number; regen: number },
  enemy: { hp: number; maxHp: number; shield: number; burn: number; poison: number; regen: number },
): void {
  if (!heroHudG || !enemyHpInfoCon || !playerHpInfoCon) return
  const yEnemy = getDebugCfg('enemyHpBarY')
  const yPlayer = getDebugCfg('playerHpBarY')
  const barH = getDebugCfg('battleHpBarH')
  const barR = getDebugCfg('battleHpBarRadius')
  const barW = getDebugCfg('battleHpBarWidth')
  const fontSize = getDebugCfg('battleHpTextFontSize')
  const x = (CANVAS_W - barW) / 2

  const drawOne = (y: number, hp: number, maxHp: number, shield: number, hpColor: number) => {
    const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0
    heroHudG!.roundRect(x, y, barW, barH, barR)
    heroHudG!.fill({ color: 0x1f2436, alpha: 0.95 })
    heroHudG!.roundRect(x, y, Math.max(2, barW * ratio), barH, barR)
    heroHudG!.fill({ color: hpColor, alpha: 0.95 })
    if (shield > 0) {
      const shieldRatio = maxHp > 0 ? Math.max(0, Math.min(1, shield / maxHp)) : 0
      const shieldW = Math.max(4, barW * shieldRatio)
      // 护盾条与血条等高，半透覆盖在血条上方
      const shieldH = barH
      const shieldY = y
      heroHudG!.roundRect(x, shieldY, shieldW, shieldH, Math.max(2, barR - 6))
      heroHudG!.fill({ color: getBattleEffectColor('shield'), alpha: 0.45 })
    }
    heroHudG!.roundRect(x, y, barW, barH, barR)
    heroHudG!.stroke({ color: 0x8b94b5, width: 2, alpha: 0.95 })
  }

  heroHudG.clear()
  drawOne(yEnemy, enemy.hp, enemy.maxHp, enemy.shield, getBattleEffectColor('hpBar'))
  drawOne(yPlayer, player.hp, player.maxHp, player.shield, getBattleEffectColor('hpBar'))

  const enemyParts: Array<{ text: string; color: number }> = [{ text: `${enemy.hp}`, color: getBattleEffectColor('hpText') }]
  if (enemy.shield > 0) enemyParts.push({ text: `${enemy.shield}`, color: getBattleEffectColor('shield') })
  if (enemy.regen > 0) enemyParts.push({ text: `${enemy.regen}`, color: getBattleEffectColor('regen') })
  if (enemy.poison > 0) enemyParts.push({ text: `${enemy.poison}`, color: getBattleEffectColor('poison') })
  if (enemy.burn > 0) enemyParts.push({ text: `${enemy.burn}`, color: getBattleEffectColor('burn') })

  const playerParts: Array<{ text: string; color: number }> = [{ text: `${player.hp}`, color: getBattleEffectColor('hpText') }]
  if (player.shield > 0) playerParts.push({ text: `${player.shield}`, color: getBattleEffectColor('shield') })
  if (player.regen > 0) playerParts.push({ text: `${player.regen}`, color: getBattleEffectColor('regen') })
  if (player.poison > 0) playerParts.push({ text: `${player.poison}`, color: getBattleEffectColor('poison') })
  if (player.burn > 0) playerParts.push({ text: `${player.burn}`, color: getBattleEffectColor('burn') })

  drawInfoText(enemyHpInfoCon, x + barW / 2, yEnemy + barH / 2, enemyParts, fontSize)
  drawInfoText(playerHpInfoCon, x + barW / 2, yPlayer + barH / 2, playerParts, fontSize)
}

function applyZoneVisualStyle(zone: GridZone): void {
  zone.setTierBorderWidth(getDebugCfg('tierBorderWidth'))
  zone.setCornerRadius(getDebugCfg('gridItemCornerRadius'))
  zone.setCellBorderWidth(getDebugCfg('gridCellBorderWidth'))
  zone.setLabelFontSize(getDebugCfg('gridZoneLabelFontSize'))
}

async function mountZoneItems(zone: GridZone, items: CombatBoardItem[]): Promise<void> {
  for (const it of items) {
    await zone.addItem(it.id, it.defId, it.size, it.col, it.row, it.tier)
  }
}

function drawCooldownOverlay(zone: GridZone, overlay: Graphics, items: CombatBoardItem[]): void {
  overlay.clear()
  for (const it of items) {
    const { w, h } = sizeToWH(it.size)
    const pw = w * CELL_SIZE
    const ph = h * CELL_HEIGHT
    const pos = zone.cellToLocal(it.col, it.row)
    const inset = Math.max(2, getDebugCfg('tierBorderWidth') + 2)
    const fullH = Math.max(1, ph - inset * 2)
    const coverRatio = Math.max(0, Math.min(1, 1 - it.chargeRatio))
    const coverH = Math.round(fullH * coverRatio)
    if (coverH <= 0) continue

    const x = pos.x + inset
    const y = pos.y + inset
    const wPx = Math.max(2, pw - inset * 2)
    const scale = pulseStates.get(it.id)?.node?.visual.scale.x ?? 1
    const cx = pos.x + pw / 2
    const cy = pos.y + ph / 2
    const sx = cx + (x - cx) * scale
    const sy = cy + (y - cy) * scale
    const sw = wPx * scale
    const sh = coverH * scale
    overlay.roundRect(sx, sy, sw, sh, 8)
    overlay.fill({ color: 0x0b1020, alpha: 0.48 })
  }
}

function applyLayout(activeCols: number): void {
  const s = getGameCfg().itemVisualScale
  const x = getZoneX(activeCols)
  if (enemyZone) {
    enemyZone.scale.set(s)
    enemyZone.x = x
    enemyZone.y = getDebugCfg('enemyBattleZoneY')
  }
  if (playerZone) {
    playerZone.scale.set(s)
    playerZone.x = x
    playerZone.y = getDebugCfg('battleZoneY')
  }
}

function pushBattleLog(line: string): void {
  console.log(`[BattleLog] ${line}`)
}

function getBattleInfoPanelCenterY(): number {
  const top = getDebugCfg('enemyHpBarY') + getDebugCfg('battleHpBarH') + 24
  const bottom = getDebugCfg('playerHpBarY') - 24
  return (top + bottom) / 2
}

function clearBattleItemSelection(): void {
  selectedItemId = null
  enemyZone?.setSelected(null)
  playerZone?.setSelected(null)
  itemInfoPopup?.hide()
}

function showBattleItemInfo(instanceId: string, side: 'player' | 'enemy'): void {
  if (!engine || !itemInfoPopup) return
  const board = engine.getBoardState()
  const hit = board.items.find((it) => it.id === instanceId && it.side === side)
  if (!hit) return
  const item = getAllItems().find((it) => it.id === hit.defId)
  if (!item) return

  selectedItemId = instanceId
  enemyZone?.setSelected(side === 'enemy' ? instanceId : null)
  playerZone?.setSelected(side === 'player' ? instanceId : null)

  itemInfoPopup.setWidth(getDebugCfg('itemInfoWidth'))
  itemInfoPopup.setMinHeight(getDebugCfg('itemInfoMinH'))
  itemInfoPopup.setSmallMinHeight(getDebugCfg('itemInfoMinHSmall'))
  itemInfoPopup.setCornerRadius(getDebugCfg('gridItemCornerRadius'))
  itemInfoPopup.setTextSizes({
    name: getDebugCfg('itemInfoNameFontSize'),
    tier: getDebugCfg('itemInfoTierFontSize'),
    cooldown: getDebugCfg('itemInfoCooldownFontSize'),
    priceCorner: getDebugCfg('itemInfoPriceCornerFontSize'),
    desc: getDebugCfg('itemInfoDescFontSize'),
  })
  itemInfoPopup.setCenterY(getBattleInfoPanelCenterY())
  itemInfoPopup.show(item, 0, 'none', hit.tier)
}

export const BattleScene: Scene = {
  name: 'battle',
  async onEnter() {
    const { stage } = getApp()
    const snapshot = getBattleSnapshot()
    root = new Container()
    root.sortableChildren = true
    stage.addChild(root)

    titleText = new Text({
      text: '战斗阶段',
      style: { fontSize: 36, fill: 0xffe2a8, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    titleText.x = CANVAS_W / 2 - titleText.width / 2
    titleText.y = 40
    root.addChild(titleText)

    heroHudG = new Graphics()
    heroHudG.zIndex = 40
    root.addChild(heroHudG)
    enemyHpInfoCon = new Container()
    playerHpInfoCon = new Container()
    enemyHpInfoCon.zIndex = 41
    playerHpInfoCon.zIndex = 41
    root.addChild(enemyHpInfoCon)
    root.addChild(playerHpInfoCon)

    const day = snapshot?.day ?? 1
    const activeCols = getDayActiveCols(day)

    enemyZone = new GridZone('敌方战斗区', 6, activeCols, 1)
    playerZone = new GridZone('战斗区', 6, activeCols, 1)
    enemyZone.zIndex = 20
    playerZone.zIndex = 20
    applyZoneVisualStyle(enemyZone)
    applyZoneVisualStyle(playerZone)
    applyLayout(activeCols)
    root.addChild(enemyZone)
    root.addChild(playerZone)

    enemyCdOverlay = new Graphics()
    playerCdOverlay = new Graphics()
    enemyCdOverlay.eventMode = 'none'
    playerCdOverlay.eventMode = 'none'
    enemyZone.addChild(enemyCdOverlay)
    playerZone.addChild(playerCdOverlay)

    fxLayer = new Container()
    fxLayer.zIndex = 60
    root.addChild(fxLayer)

    itemInfoPopup = new SellPopup(CANVAS_W, 1384)
    itemInfoPopup.zIndex = 55
    itemInfoPopup.visible = false
    root.addChild(itemInfoPopup)

    statusText = new Text({
      text: '初始化中...',
      style: { fontSize: 18, fill: 0xcdd3ff, fontFamily: 'Arial' },
    })
    statusText.x = 20
    statusText.y = 1140
    root.addChild(statusText)

    backBtn = makeBackButton()
    root.addChild(backBtn)

    engine = new CombatEngine()
    setCombatRuntimeOverride({
      burnTickMs: getDebugCfg('gameplayBurnTickMs'),
      poisonTickMs: getDebugCfg('gameplayPoisonTickMs'),
      regenTickMs: getDebugCfg('gameplayRegenTickMs'),
      burnShieldFactor: getDebugCfg('gameplayBurnShieldFactor'),
      burnDecayPct: getDebugCfg('gameplayBurnDecayPct'),
      healCleansePct: getDebugCfg('gameplayHealCleansePct'),
    })
    if (snapshot) {
      engine.start(snapshot)
      console.log(`[BattleScene] 进入战斗场景 day=${snapshot.day} entities=${snapshot.entities.length} cols=${snapshot.activeColCount}`)
    } else {
      engine.start({ day: 1, activeColCount: 2, createdAtMs: Date.now(), entities: [] })
      console.log('[BattleScene] 进入战斗场景（未找到战斗快照）')
    }

    const board = engine.getBoardState()
    await mountZoneItems(playerZone, board.items.filter((it) => it.side === 'player'))
    await mountZoneItems(enemyZone, board.items.filter((it) => it.side === 'enemy'))

    enemyZone.makeItemsInteractive((id, e) => {
      e.stopPropagation()
      showBattleItemInfo(id, 'enemy')
    })
    playerZone.makeItemsInteractive((id, e) => {
      e.stopPropagation()
      showBattleItemInfo(id, 'player')
    })

    onStageTapHidePopup = () => {
      clearBattleItemSelection()
    }
    stage.on('pointerdown', onStageTapHidePopup)

    offFireEvent = EventBus.on('battle:item_fire', (e) => {
      animateItemFirePulse(e.sourceItemId, e.side)
      pushBattleLog(`开火 ${e.side === 'player' ? '我方' : '敌方'} ${e.itemId} x${e.multicast}`)
    })
    offDamageEvent = EventBus.on('battle:take_damage', (e) => {
      const side = e.targetSide ?? (e.targetId === 'hero_enemy' ? 'enemy' : 'player')
      const fromSide = e.sourceSide === 'player' || e.sourceSide === 'enemy'
        ? e.sourceSide
        : (side === 'enemy' ? 'player' : 'enemy')
      const from = (e.sourceItemId === 'fatigue' || e.sourceItemId.startsWith('status_'))
        ? getHeroBarCenter(fromSide)
        : (getItemCenterById(e.sourceItemId, fromSide) ?? getHeroBarCenter(fromSide))
      const to = getHeroBarCenter(side)
      const bulletColor = e.type === 'burn' ? getBattleOrbColor('burn') : e.type === 'poison' ? getBattleOrbColor('poison') : getBattleOrbColor('hp')
      const isCritDamage = e.type === 'normal' && e.isCrit
      const textColor = e.type === 'burn'
        ? getBattleFloatTextColor('burn')
        : e.type === 'poison'
          ? getBattleFloatTextColor('poison')
          : isCritDamage
            ? getBattleFloatTextColor('crit')
            : getBattleFloatTextColor('damage')
      const textSize = isCritDamage ? getDebugCfg('battleTextFontSizeCrit') : getDebugCfg('battleTextFontSizeDamage')
      if (e.sourceItemId.startsWith('status_')) {
        spawnFloatingNumber(to, `-${e.amount}`, textColor, textSize)
        pushBattleLog(`结算 ${e.type} ${side === 'enemy' ? '敌方' : '我方'} ${e.amount}`)
      } else {
        spawnProjectile(from, to, bulletColor, () => {
          if (side === 'enemy') spawnFloatingNumber(to, `-${e.amount}`, textColor, textSize)
        })
        pushBattleLog(`伤害 ${side === 'enemy' ? '敌方' : '我方'} ${e.amount}`)
      }
    })
    offShieldEvent = EventBus.on('battle:gain_shield', (e) => {
      const side = e.targetSide ?? (e.targetId === 'hero_enemy' ? 'enemy' : 'player')
      const from = getItemCenterById(e.sourceItemId, side) ?? getHeroBarCenter(side)
      const to = getHeroBarCenter(side)
      const shieldColor = getBattleFloatTextColor('shield')
      const shieldOrbColor = getBattleOrbColor('shield')
      spawnProjectile(from, to, shieldOrbColor, () => {
        if (side === 'enemy') spawnFloatingNumber(to, `+${e.amount}`, shieldColor)
      })
      pushBattleLog(`护盾 ${side === 'enemy' ? '敌方' : '我方'} ${e.amount}`)
    })
    offHealEvent = EventBus.on('battle:heal', (e) => {
      const side = e.targetSide ?? (e.targetId === 'hero_enemy' ? 'enemy' : 'player')
      const from = e.sourceItemId.startsWith('status_') ? getHeroBarCenter(side) : (getItemCenterById(e.sourceItemId, side) ?? getHeroBarCenter(side))
      const to = getHeroBarCenter(side)
      if (e.sourceItemId.startsWith('status_')) {
        spawnFloatingNumber(to, `+${e.amount}`, getBattleFloatTextColor('regen'))
        pushBattleLog(`回复 ${side === 'enemy' ? '敌方' : '我方'} ${e.amount}`)
      } else {
        const regenColor = getBattleFloatTextColor('regen')
        const regenOrbColor = getBattleOrbColor('regen')
        spawnProjectile(from, to, regenOrbColor, () => {
          if (side === 'enemy') spawnFloatingNumber(to, `+${e.amount}`, regenColor)
        })
        pushBattleLog(`治疗 ${side === 'enemy' ? '敌方' : '我方'} ${e.amount}`)
      }
    })
    offStatusApplyEvent = EventBus.on('battle:status_apply', (e) => {
      const fromResolved = e.sourceSide === 'player' || e.sourceSide === 'enemy'
        ? getItemCenterById(e.sourceItemId, e.sourceSide)
        : getItemCenterAnySide(e.sourceItemId)?.pos
      const targetIsHero = e.targetType === 'hero' || e.targetId === 'hero_enemy' || e.targetId === 'hero_player'
      const targetResolved = targetIsHero
        ? null
        : (e.targetSide === 'player' || e.targetSide === 'enemy'
            ? getItemCenterById(e.targetId, e.targetSide)
            : getItemCenterAnySide(e.targetId)?.pos)
      const targetSide = e.targetSide
        ?? (targetIsHero ? (e.targetId === 'hero_enemy' ? 'enemy' : 'player') : 'enemy')
      const from = fromResolved ?? getHeroBarCenter(targetSide === 'enemy' ? 'player' : 'enemy')
      const to = targetIsHero
        ? getHeroBarCenter(targetSide)
        : (targetResolved ?? getHeroBarCenter(targetSide))
      const color =
        e.status === 'burn' ? getBattleOrbColor('burn')
          : e.status === 'poison' ? getBattleOrbColor('poison')
            : e.status === 'freeze' ? getBattleOrbColor('freeze')
              : e.status === 'slow' ? getBattleOrbColor('slow')
                : e.status === 'haste' ? getBattleOrbColor('haste')
                  : getBattleOrbColor('regen')
      spawnProjectile(from, to, color)
      pushBattleLog(`施加 ${e.status} ${targetSide === 'enemy' ? '敌方' : '我方'} +${e.amount}`)
    })
    offStatusRemoveEvent = EventBus.on('battle:status_remove', (e) => {
      const side = e.targetSide ?? (e.targetId === 'hero_enemy' ? 'enemy' : 'player')
      pushBattleLog(`移除 ${e.status} ${side === 'enemy' ? '敌方' : '我方'}`)
    })
    pushBattleLog('战斗开始')
  },
  onExit() {
    const { stage } = getApp()
    if (onStageTapHidePopup) {
      stage.off('pointerdown', onStageTapHidePopup)
      onStageTapHidePopup = null
    }
    if (root) stage.removeChild(root)
    root?.destroy({ children: true })
    root = null
    titleText = null
    statusText = null
    backBtn = null
    heroHudG = null
    enemyHpInfoCon = null
    playerHpInfoCon = null
    enemyZone = null
    playerZone = null
    enemyCdOverlay = null
    playerCdOverlay = null
    fxLayer = null
    offFireEvent?.(); offFireEvent = null
    offDamageEvent?.(); offDamageEvent = null
    offShieldEvent?.(); offShieldEvent = null
    offHealEvent?.(); offHealEvent = null
    offStatusApplyEvent?.(); offStatusApplyEvent = null
    offStatusRemoveEvent?.(); offStatusRemoveEvent = null
    itemInfoPopup = null
    selectedItemId = null
    activeFx.length = 0
    for (const [, st] of pulseStates) {
      st.node?.visual.scale.set(1)
      if (st.flash.parent) st.flash.parent.removeChild(st.flash)
      st.flash.destroy()
    }
    pulseStates.clear()
    engine = null
    console.log('[BattleScene] 离开战斗场景')
  },
  update(dt: number) {
    if (!engine || !enemyZone || !playerZone || !enemyCdOverlay || !playerCdOverlay) return
    engine.update(dt)
    const board = engine.getBoardState()
    const activeCols = getDayActiveCols((getBattleSnapshot()?.day ?? 1))
    enemyZone.setActiveColCount(activeCols)
    playerZone.setActiveColCount(activeCols)
    applyZoneVisualStyle(enemyZone)
    applyZoneVisualStyle(playerZone)
    applyLayout(activeCols)

    const playerItems = board.items.filter((it) => it.side === 'player')
    const enemyItems = board.items.filter((it) => it.side === 'enemy')
    drawCooldownOverlay(playerZone, playerCdOverlay, playerItems)
    drawCooldownOverlay(enemyZone, enemyCdOverlay, enemyItems)

    drawHeroBars(board.player, board.enemy)

    const dtMs = dt * 1000
    tickPulseStates(dtMs)
    for (let i = activeFx.length - 1; i >= 0; i--) {
      if (!activeFx[i]!(dtMs)) activeFx.splice(i, 1)
    }

    if (statusText) {
      const s = engine.getDebugState()
      statusText.text = `phase:${engine.getPhase()}  ticks:${s.tickIndex}  fatigue:${s.inFatigue ? 'on' : 'off'}`
    }

    if (itemInfoPopup?.visible) {
      itemInfoPopup.setCenterY(getBattleInfoPanelCenterY())
      if (selectedItemId) {
        const boardItem = board.items.find((it) => it.id === selectedItemId)
        if (!boardItem) clearBattleItemSelection()
      }
    }
  },
}
