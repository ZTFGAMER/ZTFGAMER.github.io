import type { Scene } from './SceneManager'
import { clearBattleSnapshot, getBattleSnapshot } from '@/combat/BattleSnapshotStore'
import { clearBattleOutcome, setBattleOutcome } from '@/combat/BattleOutcomeStore'
import { CombatEngine, setCombatRuntimeOverride, type CombatBoardItem } from '@/combat/CombatEngine'
import { SceneManager } from '@/scenes/SceneManager'
import { getApp } from '@/core/AppContext'
import { clearCurrentRunState, deductLife, getLifeState, resetLifeState } from '@/core/RunState'
import { Assets, Container, Graphics, Sprite, Texture, Text } from 'pixi.js'
import { GridZone, CELL_SIZE, CELL_HEIGHT } from '@/grid/GridZone'
import { getAllItems, getConfig as getGameCfg } from '@/core/DataLoader'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import type { ItemDef, ItemSizeNorm } from '@/items/ItemDef'
import { EventBus } from '@/core/EventBus'
import { SellPopup, type ItemInfoMode, type ItemInfoRuntimeOverride } from '@/shop/SellPopup'
import { getBattleEffectColor, getBattleFloatTextColor, getBattleOrbColor } from '@/config/colorPalette'
import { getItemIconUrl, getItemIconUrlByName, getSceneImageUrl } from '@/core/assetPath'

const CANVAS_W = 640
const CANVAS_H = 1384

let root: Container | null = null
let titleText: Text | null = null
let statusText: Text | null = null
let backBtn: Container | null = null
let speedBtn: Container | null = null
let speedBtnText: Text | null = null
let battleEndMask: Graphics | null = null
let settlementPanel: Container | null = null
let settlementTitleText: Text | null = null
let settlementLifeText: Text | null = null
let settlementDescText: Text | null = null
let settlementActionBtn: Container | null = null
let settlementActionLabel: Text | null = null
let sceneFadeOverlay: Graphics | null = null
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
let offFatigueStartEvent: (() => void) | null = null
let onStageTapHidePopup: (() => void) | null = null
let itemInfoPopup: SellPopup | null = null
let selectedItemId: string | null = null
let selectedItemSide: 'player' | 'enemy' | null = null
let selectedItemInfoKey: string | null = null
let selectedItemInfoMode: ItemInfoMode = 'simple'
let fatigueToastCon: Container | null = null
let fatigueToastBg: Graphics | null = null
let fatigueToastText: Text | null = null
let fatigueToastUntilMs = 0
let enemyBossSprite: Sprite | null = null
let enemyBossFlashSprite: Sprite | null = null
let enemyBossBaseScale = 1
let enemyBossHitElapsedMs = -1
let enemyBossDeathElapsedMs = -1
let enemyBossIdleElapsedMs = 0
let playerHeroSprite: Sprite | null = null
let playerHeroFlashSprite: Sprite | null = null
let playerHeroBaseScale = 1
let playerHeroHitElapsedMs = -1
let playerHeroIdleElapsedMs = 0
let enemyPresentationVisible = true
let battleSpeed = 1
let battleDay = 1
let enteredSnapshot: ReturnType<typeof getBattleSnapshot> = null
let battleIntroElapsedMs = 0
let battleIntroDurationMs = 0
let battleExitTransitionElapsedMs = 0
let battleExitTransitionDurationMs = 0
let settlementResolved = false
let settlementGameOver = false
const BATTLE_SPEED_STEPS = [1, 2, 4, 8] as const
const FX_MAX_PROJECTILES = 40
const FX_MAX_FLOATING_NUMBERS = 30
const FX_MAX_ACTIVE_TOTAL = 80
const FX_POOL_MAX_PROJECTILES = 48
const FX_POOL_MAX_FLOATING_NUMBERS = 40

type TickAnim = (dtMs: number) => boolean
const activeFx: TickAnim[] = []
const projectileSpritePool: Sprite[] = []
const projectileDotPool: Graphics[] = []
const floatingNumberPool: Text[] = []
let activeProjectileCount = 0
let activeFloatingNumberCount = 0
let droppedProjectileCount = 0
let droppedFloatingNumberCount = 0
let projectileUseCursor = 1

export type BattleFxPerfStats = {
  activeFx: number
  activeProjectiles: number
  activeFloatingNumbers: number
  droppedProjectiles: number
  droppedFloatingNumbers: number
  pooledProjectileSprites: number
  pooledProjectileDots: number
  pooledFloatingNumbers: number
}

export function getBattleFxPerfStats(): BattleFxPerfStats {
  return {
    activeFx: activeFx.length,
    activeProjectiles: activeProjectileCount,
    activeFloatingNumbers: activeFloatingNumberCount,
    droppedProjectiles: droppedProjectileCount,
    droppedFloatingNumbers: droppedFloatingNumberCount,
    pooledProjectileSprites: projectileSpritePool.length,
    pooledProjectileDots: projectileDotPool.length,
    pooledFloatingNumbers: floatingNumberPool.length,
  }
}

type StatusBadgeFx = {
  box: Graphics
  text: Text
  lastText: string
}

type StatusFx = {
  root: Container
  haste: StatusBadgeFx
  slow: StatusBadgeFx
  freeze: StatusBadgeFx
}

type PulseState = {
  node: ReturnType<GridZone['getNode']>
  flash: Graphics
  elapsedMs: number
  durationMs: number
  maxScale: number
}
const pulseStates = new Map<string, PulseState>()
const pulseDedupAtMs = new Map<string, number>()
const projectileVariantCursor = new Map<string, number>()
const projectileTextureCache = new Map<string, Texture>()
const projectileMissingUrls = new Set<string>()
const statusFxByKey = new Map<string, StatusFx>()
let enemyFreezeOverlay: Graphics | null = null
let playerFreezeOverlay: Graphics | null = null
let enemyStatusLayer: Container | null = null
let playerStatusLayer: Container | null = null

function resolveItemSide(sourceItemId: string, preferred?: 'player' | 'enemy'): 'player' | 'enemy' | null {
  if (preferred === 'player' || preferred === 'enemy') return preferred
  if (playerZone?.getNode(sourceItemId)) return 'player'
  if (enemyZone?.getNode(sourceItemId)) return 'enemy'
  return null
}

function tryPulseItem(sourceItemId: string, preferredSide?: 'player' | 'enemy'): void {
  if (!sourceItemId || sourceItemId === 'fatigue' || sourceItemId.startsWith('status_')) return
  const side = resolveItemSide(sourceItemId, preferredSide)
  if (!side) return

  const now = Date.now()
  const dedupMs = Math.max(1, Math.min(80, Math.round(getDebugCfg('battleFirePulseMs') * 0.4)))
  const lastAt = pulseDedupAtMs.get(sourceItemId) ?? 0
  if (now - lastAt < dedupMs) return

  pulseDedupAtMs.set(sourceItemId, now)
  animateItemFirePulse(sourceItemId, side)
}

function getDayActiveCols(day: number): number {
  const slots = getGameCfg().dailyBattleSlots
  if (day <= 2) return slots[0] ?? 4
  if (day <= 4) return slots[1] ?? 5
  return slots[2] ?? 6
}

function getBattleItemScale(): number {
  return getDebugCfg('battleItemScale')
}

function getEnemyAreaScale(): number {
  return getDebugCfg('enemyAreaScale')
}

function getEnemyHpBarScale(): number {
  return getDebugCfg('enemyHpBarScale')
}

function tickBattleIntro(dtMs: number): boolean {
  if (!root) return true
  if (battleIntroDurationMs <= 0) {
    root.alpha = 1
    return true
  }
  battleIntroElapsedMs += Math.max(0, dtMs)
  const p = Math.max(0, Math.min(1, battleIntroElapsedMs / battleIntroDurationMs))
  const eased = 1 - Math.pow(1 - p, 3)
  root.alpha = eased
  return p >= 1
}

function beginBattleExitTransition(): void {
  if (battleExitTransitionDurationMs > 0) return
  setBattleOutcome({
    result: engine?.getResult() ?? null,
    snapshot: enteredSnapshot,
    finishedAtMs: Date.now(),
  })
  battleExitTransitionElapsedMs = 0
  battleExitTransitionDurationMs = Math.max(1, getDebugCfg('battleToShopTransitionMs'))
  if (sceneFadeOverlay) {
    sceneFadeOverlay.visible = true
    sceneFadeOverlay.alpha = 0
  }
  if (backBtn) {
    backBtn.eventMode = 'none'
    backBtn.cursor = 'default'
  }
  if (speedBtn) {
    speedBtn.eventMode = 'none'
  }
}

function tickBattleExitTransition(dtMs: number): boolean {
  if (battleExitTransitionDurationMs <= 0) return false
  battleExitTransitionElapsedMs += Math.max(0, dtMs)
  const p = Math.max(0, Math.min(1, battleExitTransitionElapsedMs / battleExitTransitionDurationMs))
  const eased = 1 - Math.pow(1 - p, 3)
  if (sceneFadeOverlay) sceneFadeOverlay.alpha = eased
  if (p >= 1) {
    battleExitTransitionElapsedMs = 0
    battleExitTransitionDurationMs = 0
    SceneManager.goto('shop')
    return true
  }
  return true
}

function getPlayerZoneX(activeCols: number): number {
  const s = getBattleItemScale()
  return getDebugCfg('battleZoneX') + (CANVAS_W - activeCols * CELL_SIZE * s) / 2
}

function getEnemyZoneX(activeCols: number): number {
  const s = getEnemyAreaScale()
  return getDebugCfg('battleZoneX') + (CANVAS_W - activeCols * CELL_SIZE * s) / 2
}

function sizeToWH(size: ItemSizeNorm): { w: number; h: number } {
  if (size === '2x1') return { w: 2, h: 1 }
  if (size === '3x1') return { w: 3, h: 1 }
  return { w: 1, h: 1 }
}

function getHeroBarCenter(side: 'player' | 'enemy'): { x: number; y: number } {
  const hpScale = side === 'enemy' ? getEnemyHpBarScale() : 1
  const barW = getDebugCfg('battleHpBarWidth') * hpScale
  const barH = getDebugCfg('battleHpBarH') * hpScale
  const x = (CANVAS_W - barW) / 2 + barW / 2
  const y = (side === 'enemy' ? getDebugCfg('enemyHpBarY') : getDebugCfg('playerHpBarY')) + barH / 2
  return { x, y }
}

function getEnemyPortraitHitPoint(): { x: number; y: number } | null {
  if (!enemyBossSprite || !enemyBossSprite.visible) return null
  const yFactor = Math.max(0, Math.min(1, getDebugCfg('battleEnemyPortraitHitYFactor')))
  const top = enemyBossSprite.y - enemyBossSprite.height
  return {
    x: enemyBossSprite.x,
    y: top + enemyBossSprite.height * yFactor,
  }
}

function triggerEnemyPortraitHitFx(): void {
  if (!enemyBossSprite || !enemyBossSprite.visible) return
  enemyBossHitElapsedMs = 0
}

function getPlayerPortraitHitPoint(): { x: number; y: number } | null {
  if (!playerHeroSprite || !playerHeroSprite.visible) return null
  const yFactor = Math.max(0, Math.min(1, getDebugCfg('battlePlayerPortraitHitYFactor')))
  const top = playerHeroSprite.y - playerHeroSprite.height
  return {
    x: playerHeroSprite.x,
    y: top + playerHeroSprite.height * yFactor,
  }
}

function triggerPlayerPortraitHitFx(): void {
  if (!playerHeroSprite || !playerHeroSprite.visible) return
  playerHeroHitElapsedMs = 0
}

function tickPlayerPortraitFx(dtMs: number): void {
  if (!playerHeroSprite || !playerHeroSprite.visible) return

  const loopMs = Math.max(1, getDebugCfg('battlePlayerPortraitIdleLoopMs'))
  playerHeroIdleElapsedMs = (playerHeroIdleElapsedMs + dtMs) % loopMs
  const loopP = playerHeroIdleElapsedMs / loopMs
  const loopWave = (Math.sin(loopP * Math.PI * 2 - Math.PI / 2) + 1) / 2
  const idleScaleMax = Math.max(1, getDebugCfg('battlePlayerPortraitIdleScaleMax'))
  const idleScale = 1 + (idleScaleMax - 1) * loopWave

  if (playerHeroHitElapsedMs < 0) {
    playerHeroSprite.scale.set(playerHeroBaseScale * idleScale)
    if (playerHeroFlashSprite) playerHeroFlashSprite.alpha = 0
    return
  }

  const hitMs = Math.max(1, getDebugCfg('battlePlayerPortraitHitPulseMs'))
  playerHeroHitElapsedMs += dtMs
  const p = Math.max(0, Math.min(1, playerHeroHitElapsedMs / hitMs))
  const pulse = Math.sin(Math.PI * p)
  const maxScale = Math.max(1, getDebugCfg('battlePlayerPortraitHitScaleMax'))
  playerHeroSprite.scale.set(playerHeroBaseScale * idleScale * (1 + (maxScale - 1) * pulse))
  if (playerHeroFlashSprite) {
    const flashMs = Math.max(1, getDebugCfg('battlePlayerPortraitFlashMs'))
    const flashP = Math.max(0, Math.min(1, playerHeroHitElapsedMs / flashMs))
    playerHeroFlashSprite.visible = true
    playerHeroFlashSprite.tint = Math.max(0, Math.min(0xffffff, Math.round(getDebugCfg('battlePlayerPortraitFlashColor'))))
    playerHeroFlashSprite.alpha = Math.max(0, getDebugCfg('battlePlayerPortraitFlashAlpha') * (1 - flashP))
    playerHeroFlashSprite.scale.copyFrom(playerHeroSprite.scale)
    playerHeroFlashSprite.x = playerHeroSprite.x
    playerHeroFlashSprite.y = playerHeroSprite.y
  }

  if (p >= 1) {
    playerHeroHitElapsedMs = -1
    playerHeroSprite.scale.set(playerHeroBaseScale * idleScale)
    if (playerHeroFlashSprite) playerHeroFlashSprite.alpha = 0
  }
}

function tickEnemyPortraitFx(dtMs: number): void {
  if (!enemyBossSprite || !enemyBossSprite.visible) return

  const loopMs = Math.max(1, getDebugCfg('battleEnemyPortraitIdleLoopMs'))
  enemyBossIdleElapsedMs = (enemyBossIdleElapsedMs + dtMs) % loopMs
  const loopP = enemyBossIdleElapsedMs / loopMs
  const loopWave = (Math.sin(loopP * Math.PI * 2 - Math.PI / 2) + 1) / 2
  const idleScaleMax = Math.max(1, getDebugCfg('battleEnemyPortraitIdleScaleMax'))
  const idleScale = 1 + (idleScaleMax - 1) * loopWave

  if (enemyBossDeathElapsedMs >= 0) {
    const deathMs = Math.max(1, getDebugCfg('battleEnemyPortraitDeathFadeMs'))
    enemyBossDeathElapsedMs += dtMs
    const p = Math.max(0, Math.min(1, enemyBossDeathElapsedMs / deathMs))
    enemyBossSprite.alpha = 1 - p
    if (enemyBossFlashSprite) enemyBossFlashSprite.alpha = 0
    enemyBossSprite.scale.set(enemyBossBaseScale * idleScale * (1 - 0.08 * p))
    if (p >= 1) {
      enemyBossSprite.visible = false
      enemyBossSprite.alpha = 1
      enemyBossSprite.scale.set(enemyBossBaseScale)
      enemyBossDeathElapsedMs = -1
    }
    return
  }

  if (enemyBossHitElapsedMs < 0) {
    enemyBossSprite.scale.set(enemyBossBaseScale * idleScale)
    if (enemyBossFlashSprite) enemyBossFlashSprite.alpha = 0
    return
  }

  const hitMs = Math.max(1, getDebugCfg('battleEnemyPortraitHitPulseMs'))
  enemyBossHitElapsedMs += dtMs
  const p = Math.max(0, Math.min(1, enemyBossHitElapsedMs / hitMs))
  const pulse = Math.sin(Math.PI * p)
  const maxScale = Math.max(1, getDebugCfg('battleEnemyPortraitHitScaleMax'))
  enemyBossSprite.scale.set(enemyBossBaseScale * idleScale * (1 + (maxScale - 1) * pulse))
  if (enemyBossFlashSprite) {
    const flashMs = Math.max(1, getDebugCfg('battleEnemyPortraitFlashMs'))
    const flashP = Math.max(0, Math.min(1, enemyBossHitElapsedMs / flashMs))
    enemyBossFlashSprite.visible = true
    enemyBossFlashSprite.tint = Math.max(0, Math.min(0xffffff, Math.round(getDebugCfg('battleEnemyPortraitFlashColor'))))
    enemyBossFlashSprite.alpha = Math.max(0, getDebugCfg('battleEnemyPortraitFlashAlpha') * (1 - flashP))
    enemyBossFlashSprite.scale.copyFrom(enemyBossSprite.scale)
    enemyBossFlashSprite.x = enemyBossSprite.x
    enemyBossFlashSprite.y = enemyBossSprite.y
  }

  if (p >= 1) {
    enemyBossHitElapsedMs = -1
    enemyBossSprite.scale.set(enemyBossBaseScale * idleScale)
    if (enemyBossFlashSprite) enemyBossFlashSprite.alpha = 0
  }
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

const ITEM_BY_ID = new Map(getAllItems().map((it) => [it.id, it] as const))

function getDefBySourceInstance(sourceItemId: string): ItemDef | null {
  if (!engine) return null
  const board = engine.getBoardState()
  const hit = board.items.find((it) => it.id === sourceItemId)
  if (!hit) return null
  return ITEM_BY_ID.get(hit.defId) ?? null
}

function isFlyableProjectile(def: ItemDef | null): boolean {
  if (!def) return false
  const style = def.attack_style ?? ''
  if (!style || style.includes('不飞行')) return false
  return style.includes('飞行')
}

function collectProjectileIconUrls(def: ItemDef, sourceItemId?: string): string[] {
  const out: string[] = []
  let stems = (def.attack_variants ?? []).filter(Boolean)
  if (stems.length === 0 && def.icon) {
    stems = [`${def.icon}_a`, `${def.icon}_a2`]
  }
  if (stems.length > 0) {
    const key = sourceItemId || def.id
    const cursor = projectileVariantCursor.get(key) ?? 0
    const idx = ((cursor % stems.length) + stems.length) % stems.length
    projectileVariantCursor.set(key, cursor + 1)

    const first = stems[idx]
    if (first) out.push(getItemIconUrlByName(first))
    for (let i = 0; i < stems.length; i++) {
      if (i !== idx) out.push(getItemIconUrlByName(stems[i]!))
    }
  }
  out.push(getItemIconUrl(def.id))
  return Array.from(new Set(out))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function makeStatusBadge(): StatusBadgeFx {
  const box = new Graphics()
  const text = new Text({
    text: '',
    style: {
      fontSize: 16,
      fill: 0xffffff,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      stroke: { color: 0x000000, width: 3 },
    },
  })
  box.visible = false
  text.visible = false
  return { box, text, lastText: '' }
}

function formatStatusSec(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(1)
}

function ensureStatusFx(key: string, zone: GridZone, instanceId: string, statusLayer: Container): StatusFx | null {
  const existing = statusFxByKey.get(key)
  if (existing) return existing
  const node = zone.getNode(instanceId)
  if (!node) return null

  const root = new Container()
  root.zIndex = 80
  const haste = makeStatusBadge()
  const slow = makeStatusBadge()
  const freeze = makeStatusBadge()

  root.addChild(haste.box, haste.text)
  root.addChild(slow.box, slow.text)
  root.addChild(freeze.box, freeze.text)
  statusLayer.addChild(root)

  const fx: StatusFx = { root, haste, slow, freeze }
  statusFxByKey.set(key, fx)
  return fx
}

function drawStatusBadge(
  badge: StatusBadgeFx,
  textValue: string,
  color: number,
  centerX: number,
  centerY: number,
  fontSize: number,
): void {
  if (!textValue) {
    badge.box.visible = false
    badge.text.visible = false
    badge.lastText = ''
    return
  }

  if (badge.lastText !== textValue) {
    badge.text.text = textValue
    badge.lastText = textValue
  }
  badge.text.style.fontSize = fontSize
  badge.text.style.stroke = { color: 0x000000, width: Math.max(1, getDebugCfg('battleStatusTextStrokeWidth')), join: 'round' }

  const padX = getDebugCfg('battleStatusBadgePadX')
  const padY = getDebugCfg('battleStatusBadgePadY')
  const radius = getDebugCfg('battleStatusBadgeRadius')
  const w = Math.max(getDebugCfg('battleStatusBadgeMinWidth'), badge.text.width + padX * 2)
  const h = badge.text.height + padY * 2
  const x = centerX - w / 2
  const y = centerY - h / 2

  badge.box.clear()
  badge.box.roundRect(x, y, w, h, radius)
  badge.box.fill({ color, alpha: getDebugCfg('battleStatusBadgeAlpha') })
  badge.box.stroke({ color: 0xffffff, width: 1, alpha: 0.32 })
  badge.box.visible = true

  badge.text.x = centerX - badge.text.width / 2
  badge.text.y = centerY - badge.text.height / 2
  badge.text.visible = true
}

function updateZoneStatusFx(
  zone: GridZone,
  zoneKey: 'player' | 'enemy',
  items: CombatBoardItem[],
  runtimeById: Map<string, ReturnType<CombatEngine['getRuntimeState']>[number]>,
  freezeOverlay: Graphics,
  statusLayer: Container,
): void {
  const activeKeys = new Set<string>()
  // 状态计时字号跟随战斗区缩放（敌方区域缩放时同步变大/变小）
  const fontSize = Math.max(8, getDebugCfg('battleStatusTimerFontSize'))
  freezeOverlay.clear()

  for (const it of items) {
    const key = `${zoneKey}:${it.id}`
    activeKeys.add(key)
    const fx = ensureStatusFx(key, zone, it.id, statusLayer)
    const node = zone.getNode(it.id)
    if (!fx || !node) continue

    const rt = runtimeById.get(it.id)
    const hasteMs = rt?.hasteMs ?? 0
    const slowMs = rt?.slowMs ?? 0
    const freezeMs = rt?.freezeMs ?? 0

    const { w: gw, h: gh } = sizeToWH(it.size)
    const w = gw * CELL_SIZE
    const h = gh * CELL_HEIGHT
    const x = node.container.x
    const y = node.container.y
    const scale = pulseStates.get(it.id)?.node?.visual.scale.x ?? 1
    const cx = x + w / 2
    const cy = y + h / 2

    const baseHasteY = y + h * getDebugCfg('battleStatusHasteYFactor') + getDebugCfg('battleStatusHasteOffsetY')
    const baseSlowY = y + h * getDebugCfg('battleStatusSlowYFactor') + getDebugCfg('battleStatusSlowOffsetY')
    const baseFreezeY = y + h * getDebugCfg('battleStatusFreezeYFactor') + getDebugCfg('battleStatusFreezeOffsetY')

    const hasteY = cy + (baseHasteY - cy) * scale
    const slowY = cy + (baseSlowY - cy) * scale
    const freezeY = cy + (baseFreezeY - cy) * scale

    fx.root.x = 0
    fx.root.y = 0

    drawStatusBadge(fx.haste, hasteMs > 0 ? formatStatusSec(hasteMs) : '', getBattleOrbColor('haste'), cx, hasteY, fontSize)
    drawStatusBadge(fx.slow, slowMs > 0 ? formatStatusSec(slowMs) : '', getBattleOrbColor('slow'), cx, slowY, fontSize)
    drawStatusBadge(fx.freeze, freezeMs > 0 ? formatStatusSec(freezeMs) : '', getBattleOrbColor('freeze'), cx, freezeY, fontSize)

    if (freezeMs > 0) {
      const r = Math.max(4, getDebugCfg('gridItemCornerRadius') - 1)
      const sx = cx + (x - cx) * scale
      const sy = cy + (y - cy) * scale
      const sw = w * scale
      const sh = h * scale
      freezeOverlay.roundRect(sx, sy, sw, sh, r)
      freezeOverlay.fill({ color: 0xeef5ff, alpha: getDebugCfg('battleFreezeOverlayAlpha') })
      freezeOverlay.stroke({ color: 0xffffff, width: 1, alpha: 0.35 })
    }
  }

  for (const [key, fx] of statusFxByKey) {
    if (!key.startsWith(`${zoneKey}:`)) continue
    if (activeKeys.has(key)) continue
    if (fx.root.parent) fx.root.parent.removeChild(fx.root)
    fx.root.destroy({ children: true })
    statusFxByKey.delete(key)
  }
}

async function resolveProjectileTexture(urls: string[]): Promise<Texture | null> {
  for (const url of urls) {
    if (projectileMissingUrls.has(url)) continue
    const cached = projectileTextureCache.get(url)
    if (cached) return cached
    try {
      const tex = await Assets.load<Texture>(url)
      projectileTextureCache.set(url, tex)
      return tex
    } catch {
      projectileMissingUrls.add(url)
      // continue fallback url list
    }
  }
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

function canSpawnProjectileFx(): boolean {
  if (activeFx.length >= FX_MAX_ACTIVE_TOTAL) {
    droppedProjectileCount += 1
    return false
  }
  if (activeProjectileCount >= FX_MAX_PROJECTILES) {
    droppedProjectileCount += 1
    return false
  }
  return true
}

function canSpawnFloatingNumberFx(): boolean {
  if (activeFx.length >= FX_MAX_ACTIVE_TOTAL) {
    droppedFloatingNumberCount += 1
    return false
  }
  if (activeFloatingNumberCount >= FX_MAX_FLOATING_NUMBERS) {
    droppedFloatingNumberCount += 1
    return false
  }
  return true
}

function acquireProjectileSprite(from: { x: number; y: number }): Sprite {
  const sprite = projectileSpritePool.pop() ?? new Sprite(Texture.WHITE)
  sprite.anchor.set(0.5)
  sprite.x = from.x
  sprite.y = from.y
  sprite.alpha = 1
  sprite.rotation = 0
  sprite.scale.set(1)
  sprite.texture = Texture.WHITE
  return sprite
}

function releaseProjectileSprite(sprite: Sprite): void {
  if (sprite.parent) sprite.parent.removeChild(sprite)
  ;(sprite as Sprite & { __fxUseId?: number }).__fxUseId = 0
  sprite.alpha = 1
  sprite.rotation = 0
  sprite.scale.set(1)
  sprite.texture = Texture.WHITE
  if (projectileSpritePool.length < FX_POOL_MAX_PROJECTILES) {
    projectileSpritePool.push(sprite)
  } else {
    sprite.destroy()
  }
}

function acquireProjectileDot(from: { x: number; y: number }, color: number): Graphics {
  const dot = projectileDotPool.pop() ?? new Graphics()
  dot.clear()
  dot.circle(0, 0, 5)
  dot.fill({ color, alpha: 0.95 })
  dot.x = from.x
  dot.y = from.y
  dot.alpha = 1
  dot.rotation = 0
  dot.scale.set(1)
  return dot
}

function releaseProjectileDot(dot: Graphics): void {
  if (dot.parent) dot.parent.removeChild(dot)
  dot.clear()
  dot.alpha = 1
  dot.rotation = 0
  dot.scale.set(1)
  if (projectileDotPool.length < FX_POOL_MAX_PROJECTILES) {
    projectileDotPool.push(dot)
  } else {
    dot.destroy()
  }
}

function acquireFloatingNumber(text: string, color: number, fontSize: number): Text {
  const t = floatingNumberPool.pop() ?? new Text({ text: '' })
  t.text = text
  t.style.fill = color
  t.style.fontSize = fontSize
  t.style.fontFamily = 'Arial'
  t.style.fontWeight = 'bold'
  t.style.stroke = { color: 0x000000, width: 3 }
  t.alpha = 1
  t.rotation = 0
  t.scale.set(1)
  return t
}

function releaseFloatingNumber(t: Text): void {
  if (t.parent) t.parent.removeChild(t)
  t.text = ''
  t.alpha = 1
  t.rotation = 0
  t.scale.set(1)
  if (floatingNumberPool.length < FX_POOL_MAX_FLOATING_NUMBERS) {
    floatingNumberPool.push(t)
  } else {
    t.destroy()
  }
}

function spawnProjectile(from: { x: number; y: number }, to: { x: number; y: number }, color: number, onHit?: () => void, sourceItemId?: string): void {
  if (!fxLayer) {
    onHit?.()
    return
  }
  if (!canSpawnProjectileFx()) {
    onHit?.()
    return
  }
  activeProjectileCount += 1

  const useItemSprite = true
  const sourceDef = sourceItemId ? getDefBySourceInstance(sourceItemId) : null
  const useSprite = useItemSprite && isFlyableProjectile(sourceDef)

  let visual: Graphics | Sprite
  let recycle: (() => void) | null = null
  let spinRadPerSec = 0
  let lockFacingRad: number | null = null
  if (useSprite && sourceDef) {
    const sprite = acquireProjectileSprite(from)
    const px = Math.max(8, getDebugCfg('battleProjectileItemSizePx'))
    sprite.width = px
    sprite.height = px
    fxLayer.addChild(sprite)
    visual = sprite
    recycle = () => releaseProjectileSprite(sprite)
    const useId = projectileUseCursor++
    ;(sprite as Sprite & { __fxUseId?: number }).__fxUseId = useId

    const attackStyle = sourceDef.attack_style ?? ''
    if (attackStyle.includes('旋转')) {
      spinRadPerSec = Math.abs(getDebugCfg('battleProjectileSpinDegPerSec')) * Math.PI / 180
    } else if (attackStyle.includes('直线')) {
      // 资源默认朝上；Pixi 0 弧度朝右，需补 +90° 对齐前向
      lockFacingRad = Math.atan2(to.y - from.y, to.x - from.x) + Math.PI / 2
    }

    const urls = collectProjectileIconUrls(sourceDef, sourceItemId)
    ;(async () => {
      const tex = await resolveProjectileTexture(urls)
      if (tex && (sprite as Sprite & { __fxUseId?: number }).__fxUseId === useId) sprite.texture = tex
    })()
  } else {
    const dot = acquireProjectileDot(from, color)
    fxLayer.addChild(dot)
    visual = dot
    recycle = () => releaseProjectileDot(dot)
  }

  const duration = getDebugCfg('battleProjectileFlyMs')
  const arcH = getDebugCfg('battleProjectileArcHeight')
  const scaleStart = useSprite ? getDebugCfg('battleProjectileScaleStart') : 1
  const scalePeak = useSprite ? getDebugCfg('battleProjectileScalePeak') : 1
  const scaleEnd = useSprite ? getDebugCfg('battleProjectileScaleEnd') : 1
  const peakT = Math.max(0.05, Math.min(0.95, getDebugCfg('battleProjectileScalePeakT')))
  let t = 0
  activeFx.push((dtMs) => {
    t += dtMs
    const p = Math.min(1, t / duration)
    visual.x = from.x + (to.x - from.x) * p
    visual.y = from.y + (to.y - from.y) * p - arcH * 4 * p * (1 - p)

    const k = p <= peakT
      ? lerp(scaleStart, scalePeak, p / peakT)
      : lerp(scalePeak, scaleEnd, (p - peakT) / (1 - peakT))
    visual.scale.set(k)
    if (spinRadPerSec > 0) {
      // 向左旋转
      visual.rotation -= spinRadPerSec * (dtMs / 1000)
    } else if (lockFacingRad !== null) {
      visual.rotation = lockFacingRad
    }

    if (p >= 1) {
      recycle?.()
      activeProjectileCount = Math.max(0, activeProjectileCount - 1)
      onHit?.()
      return false
    }
    return true
  })
}

function spawnFloatingNumber(to: { x: number; y: number }, text: string, color: number, fontSize?: number): void {
  if (!fxLayer) return
  if (!canSpawnFloatingNumberFx()) return
  activeFloatingNumberCount += 1
  const actualFontSize = fontSize ?? getDebugCfg('battleHpTextFontSize')
  const t = acquireFloatingNumber(text, color, actualFontSize)
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
      releaseFloatingNumber(t)
      activeFloatingNumberCount = Math.max(0, activeFloatingNumberCount - 1)
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
  bg.roundRect(-w / 2, -h / 2, w, h, 18)
  bg.stroke({ color: 0xffcc44, width: 3 })
  bg.fill({ color: 0x3f3322, alpha: 0.9 })
  con.addChild(bg)

  const txt = new Text({
    text: '回到商店',
    style: { fontSize: getDebugCfg('battleBackButtonLabelFontSize'), fill: 0xffcc44, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  txt.anchor.set(0.5)
  txt.x = 0
  txt.y = 0
  con.addChild(txt)
  con.x = getDebugCfg('battleBackBtnX')
  con.y = getDebugCfg('battleBackBtnY')
  con.eventMode = 'static'
  con.cursor = 'pointer'
  con.on('pointerdown', () => {
    beginBattleExitTransition()
  })
  return con
}

function makeSettlementPanel(): Container {
  const panel = new Container()
  const bg = new Graphics()
  const panelW = 560
  const panelH = 400
  bg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 24)
  bg.fill({ color: 0x141824, alpha: 0.95 })
  bg.stroke({ color: 0xf2ce72, width: 3, alpha: 0.95 })
  panel.addChild(bg)

  settlementTitleText = new Text({
    text: '战斗结束',
    style: { fontSize: 48, fill: 0xffe2a0, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 4 } },
  })
  settlementTitleText.anchor.set(0.5)
  settlementTitleText.y = -124
  panel.addChild(settlementTitleText)

  settlementLifeText = new Text({
    text: '❤️ 5/5',
    style: { fontSize: 34, fill: 0xffd4d4, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 3 } },
  })
  settlementLifeText.anchor.set(0.5)
  settlementLifeText.y = -38
  panel.addChild(settlementLifeText)

  settlementDescText = new Text({
    text: '准备下一步行动',
    style: { fontSize: 26, fill: 0xe7edf9, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 2 } },
  })
  settlementDescText.anchor.set(0.5)
  settlementDescText.y = 24
  panel.addChild(settlementDescText)

  settlementActionBtn = new Container()
  const actionBg = new Graphics()
  actionBg.roundRect(-170, -40, 340, 80, 18)
  actionBg.fill({ color: 0x22406a, alpha: 0.92 })
  actionBg.stroke({ color: 0x8ac4ff, width: 3, alpha: 0.95 })
  settlementActionLabel = new Text({
    text: '返回商店',
    style: { fontSize: getDebugCfg('battleBackButtonLabelFontSize'), fill: 0xe9f4ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  settlementActionLabel.anchor.set(0.5)
  settlementActionBtn.addChild(actionBg)
  settlementActionBtn.addChild(settlementActionLabel)
  settlementActionBtn.y = 132
  settlementActionBtn.eventMode = 'static'
  settlementActionBtn.cursor = 'pointer'
  settlementActionBtn.on('pointerdown', () => {
    if (battleExitTransitionDurationMs > 0) return
    if (settlementGameOver) {
      clearCurrentRunState()
      resetLifeState()
      clearBattleSnapshot()
      clearBattleOutcome()
      window.location.reload()
      return
    }
    beginBattleExitTransition()
  })
  panel.addChild(settlementActionBtn)

  panel.x = CANVAS_W / 2
  panel.y = CANVAS_H / 2
  panel.zIndex = 190
  panel.visible = false
  return panel
}

function resolveBattleSettlement(): void {
  if (!engine || settlementResolved) return
  const result = engine.getResult()
  const winner = result?.winner ?? 'draw'
  const before = getLifeState()
  const after = winner === 'enemy' ? deductLife() : before
  const delta = after.current - before.current
  settlementResolved = true
  settlementGameOver = winner === 'enemy' && after.current <= 0

  if (!settlementTitleText || !settlementLifeText || !settlementDescText || !settlementActionLabel) return

  if (winner === 'player') {
    settlementTitleText.text = '战斗胜利'
    settlementTitleText.style.fill = 0xffe2a0
  } else if (winner === 'enemy') {
    settlementTitleText.text = settlementGameOver ? '游戏失败' : '战斗失败'
    settlementTitleText.style.fill = 0xff8e8e
  } else {
    settlementTitleText.text = '平局'
    settlementTitleText.style.fill = 0xb9d5ff
  }

  settlementLifeText.text = delta < 0
    ? `❤️ ${before.current}/${before.max} -> ${after.current}/${after.max} (-1)`
    : `❤️ ${after.current}/${after.max}`
  settlementLifeText.style.fill = after.current <= 1 ? 0xff6a6a : 0xffd4d4

  if (settlementGameOver) {
    settlementDescText.text = '❤️ 已耗尽，点击重新开始'
    settlementActionLabel.text = '重新开始'
  } else {
    settlementDescText.text = winner === 'enemy' ? '调整阵容后再战' : '继续前往商店'
    settlementActionLabel.text = '返回商店'
  }
}

function makeSpeedButton(): Container {
  const con = new Container()
  const bg = new Graphics()
  const w = 116
  const h = 58
  bg.roundRect(-w / 2, -h / 2, w, h, 14)
  bg.stroke({ color: 0x96b2ff, width: 2, alpha: 0.95 })
  bg.fill({ color: 0x1f2945, alpha: 0.9 })
  con.addChild(bg)

  speedBtnText = new Text({
    text: 'x1',
    style: { fontSize: 26, fill: 0xd9e4ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  speedBtnText.anchor.set(0.5)
  con.addChild(speedBtnText)

  con.x = CANVAS_W - 84
  con.y = getDebugCfg('battleSpeedBtnY')
  con.zIndex = 185
  con.eventMode = 'static'
  con.cursor = 'pointer'
  con.on('pointerdown', () => {
    const idx = BATTLE_SPEED_STEPS.indexOf(battleSpeed as (typeof BATTLE_SPEED_STEPS)[number])
    const next = BATTLE_SPEED_STEPS[(idx + 1) % BATTLE_SPEED_STEPS.length] ?? 1
    battleSpeed = next
    if (speedBtnText) speedBtnText.text = `x${battleSpeed}`
    pushBattleLog(`战斗倍速切换 x${battleSpeed}`)
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
  const baseBarH = getDebugCfg('battleHpBarH')
  const barR = getDebugCfg('battleHpBarRadius')
  const baseBarW = getDebugCfg('battleHpBarWidth')
  const baseFontSize = getDebugCfg('battleHpTextFontSize')

  const drawOne = (y: number, hp: number, maxHp: number, shield: number, hpColor: number, areaScale: number) => {
    const barW = baseBarW * areaScale
    const barH = baseBarH * areaScale
    const x = (CANVAS_W - barW) / 2
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
  const enemyHpScale = getEnemyHpBarScale()
  if (enemyPresentationVisible) {
    drawOne(yEnemy, enemy.hp, enemy.maxHp, enemy.shield, getBattleEffectColor('hpBar'), enemyHpScale)
  }
  drawOne(yPlayer, player.hp, player.maxHp, player.shield, getBattleEffectColor('hpBar'), 1)

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

  enemyHpInfoCon.visible = enemyPresentationVisible
  if (enemyPresentationVisible) {
    drawInfoText(enemyHpInfoCon, CANVAS_W / 2, yEnemy + (baseBarH * enemyHpScale) / 2, enemyParts, baseFontSize * enemyHpScale)
  }
  drawInfoText(playerHpInfoCon, CANVAS_W / 2, yPlayer + baseBarH / 2, playerParts, baseFontSize)
}

function applyZoneVisualStyle(zone: GridZone): void {
  zone.setTierBorderWidth(getDebugCfg('tierBorderWidth'))
  zone.setCornerRadius(getDebugCfg('gridItemCornerRadius'))
  zone.setCellBorderWidth(getDebugCfg('gridCellBorderWidth'))
  zone.setLabelVisible(false)
  zone.setStatBadgeFontSize(getDebugCfg('itemStatBadgeFontSize'))
  zone.setTierStarFontSize(getDebugCfg('itemTierStarFontSize'))
  zone.setTierStarStrokeWidth(getDebugCfg('itemTierStarStrokeWidth'))
  zone.setStatBadgeOffsetY(getDebugCfg('itemStatBadgeOffsetY'))
}

async function mountZoneItems(zone: GridZone, items: CombatBoardItem[]): Promise<void> {
  for (const it of items) {
    await zone.addItem(it.id, it.defId, it.size, it.col, it.row, it.tier)
  }
}

function drawCooldownOverlay(
  zone: GridZone,
  overlay: Graphics,
  items: CombatBoardItem[],
  runtimeChargePercentById: Map<string, number>,
): void {
  overlay.clear()
  for (const it of items) {
    const { w, h } = sizeToWH(it.size)
    const pw = w * CELL_SIZE
    const ph = h * CELL_HEIGHT
    const pos = zone.cellToLocal(it.col, it.row)
    const inset = Math.max(2, getDebugCfg('tierBorderWidth') + 2)
    const fullH = Math.max(1, ph - inset * 2)
    const chargePercent = runtimeChargePercentById.get(it.id) ?? it.chargeRatio
    const coverRatio = Math.max(0, Math.min(1, 1 - chargePercent))
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

function updateRuntimeStatBadges(
  zone: GridZone,
  items: CombatBoardItem[],
  runtimeById: Map<string, ReturnType<CombatEngine['getRuntimeState']>[number]>,
): void {
  for (const it of items) {
    const rt = runtimeById.get(it.id)
    if (!rt) {
      zone.setItemStatOverride(it.id, null)
      zone.setItemAmmo(it.id, 0, 0)
      continue
    }
    zone.setItemStatOverride(it.id, {
      damage: Math.max(0, rt.damage),
      heal: Math.max(0, rt.heal),
      shield: Math.max(0, rt.shield),
      burn: Math.max(0, rt.burn),
      poison: Math.max(0, rt.poison),
      multicast: Math.max(1, rt.multicast),
    })
    zone.setItemAmmo(it.id, Math.max(0, rt.ammoCurrent), Math.max(0, rt.ammoMax))
  }
}

function applyLayout(activeCols: number): void {
  const playerScale = getBattleItemScale()
  const enemyScale = getEnemyAreaScale()
  if (enemyZone) {
    enemyZone.scale.set(enemyScale)
    enemyZone.x = getEnemyZoneX(activeCols)
    enemyZone.y = getDebugCfg('enemyBattleZoneY')
  }
  if (playerZone) {
    playerZone.scale.set(playerScale)
    playerZone.x = getPlayerZoneX(activeCols)
    playerZone.y = getDebugCfg('battleZoneY') + getDebugCfg('battleZoneYInBattleOffset') + (CELL_HEIGHT * (1 - playerScale)) / 2
  }
  if (enemyBossSprite) {
    const widthRatio = Math.max(0.2, getDebugCfg('battleEnemyPortraitWidthRatio'))
    const offsetY = getDebugCfg('battleEnemyPortraitOffsetY')
    enemyBossSprite.x = CANVAS_W / 2
    const topY = getDebugCfg('enemyHpBarY') + getDebugCfg('battleHpBarH') * getEnemyHpBarScale() + offsetY
    const tex = enemyBossSprite.texture
    if (tex?.width) {
      const targetW = CANVAS_W * widthRatio
      enemyBossBaseScale = targetW / Math.max(1, tex.width)
      if (enemyBossHitElapsedMs < 0 && enemyBossDeathElapsedMs < 0) {
        enemyBossSprite.scale.set(enemyBossBaseScale)
      }
    }
    enemyBossSprite.y = topY + enemyBossSprite.height
  }
  if (enemyBossFlashSprite && enemyBossSprite) {
    enemyBossFlashSprite.x = enemyBossSprite.x
    enemyBossFlashSprite.y = enemyBossSprite.y
    if (enemyBossHitElapsedMs < 0 && enemyBossDeathElapsedMs < 0) {
      enemyBossFlashSprite.scale.copyFrom(enemyBossSprite.scale)
    }
  }

  if (playerHeroSprite) {
    playerHeroSprite.x = CANVAS_W / 2
    const tex = playerHeroSprite.texture
    if (tex?.width) {
      const targetW = CANVAS_W * Math.max(0.2, getDebugCfg('battlePlayerPortraitWidthRatio'))
      playerHeroBaseScale = targetW / Math.max(1, tex.width)
      if (playerHeroHitElapsedMs < 0) {
        playerHeroSprite.scale.set(playerHeroBaseScale)
      }
    }
    const offsetY = getDebugCfg('battlePlayerPortraitOffsetY')
    playerHeroSprite.y = CANVAS_H + offsetY
  }
  if (playerHeroFlashSprite && playerHeroSprite) {
    playerHeroFlashSprite.x = playerHeroSprite.x
    playerHeroFlashSprite.y = playerHeroSprite.y
    if (playerHeroHitElapsedMs < 0) {
      playerHeroFlashSprite.scale.copyFrom(playerHeroSprite.scale)
    }
  }
}

function pushBattleLog(line: string): void {
  console.log(`[BattleLog] ${line}`)
}

function showFatigueToast(message: string, durationMs = 1300): void {
  if (!fatigueToastCon || !fatigueToastBg || !fatigueToastText) return
  fatigueToastText.text = message
  fatigueToastText.style.fill = 0xfff1a8
  fatigueToastText.x = (CANVAS_W - fatigueToastText.width) / 2
  fatigueToastText.y = 260

  const padX = 16
  const padY = 10
  const bgX = fatigueToastText.x - padX
  const bgY = fatigueToastText.y - padY
  const bgW = fatigueToastText.width + padX * 2
  const bgH = fatigueToastText.height + padY * 2

  fatigueToastBg.clear()
  fatigueToastBg.roundRect(bgX, bgY, bgW, bgH, 12)
  fatigueToastBg.fill({ color: 0x392516, alpha: 0.9 })
  fatigueToastBg.stroke({ color: 0xffcc44, width: 2, alpha: 0.92 })

  fatigueToastCon.visible = true
  fatigueToastCon.alpha = 1
  fatigueToastUntilMs = Date.now() + Math.max(100, durationMs)
}

function getBattleInfoPanelCenterY(): number {
  const top = getDebugCfg('enemyHpBarY') + getDebugCfg('battleHpBarH') * getEnemyHpBarScale() + 24
  const bottom = getDebugCfg('playerHpBarY') - 24
  return (top + bottom) / 2
}

function clearBattleItemSelection(): void {
  selectedItemId = null
  selectedItemSide = null
  selectedItemInfoKey = null
  selectedItemInfoMode = 'simple'
  enemyZone?.setSelected(null)
  playerZone?.setSelected(null)
  itemInfoPopup?.hide()
}

function showBattleItemInfo(instanceId: string, side: 'player' | 'enemy', keepMode = false): void {
  if (!engine || !itemInfoPopup) return
  const board = engine.getBoardState()
  const hit = board.items.find((it) => it.id === instanceId && it.side === side)
  if (!hit) return
  const item = getAllItems().find((it) => it.id === hit.defId)
  if (!item) return

  selectedItemId = instanceId
  selectedItemSide = side
  const runtimeState = engine.getRuntimeState().find((it) => it.id === instanceId)
  const runtimeOverride: ItemInfoRuntimeOverride | undefined = runtimeState
    ? {
      cooldownMs: Math.max(0, runtimeState.cooldownMs),
      damage: Math.max(0, runtimeState.damage),
      shield: Math.max(0, runtimeState.shield),
      heal: Math.max(0, runtimeState.heal),
      burn: Math.max(0, runtimeState.burn),
      poison: Math.max(0, runtimeState.poison),
      multicast: Math.max(1, runtimeState.multicast),
      ammoCurrent: Math.max(0, runtimeState.ammoCurrent),
      ammoMax: Math.max(0, runtimeState.ammoMax),
    }
    : undefined
  const nextKey = `${side}:${instanceId}:${hit.tier}:${runtimeOverride?.damage ?? -1}:${runtimeOverride?.shield ?? -1}:${runtimeOverride?.multicast ?? -1}:${runtimeOverride?.ammoCurrent ?? -1}:${runtimeOverride?.ammoMax ?? -1}`
  if (keepMode && selectedItemInfoKey === nextKey) return
  if (!keepMode) {
    if (selectedItemInfoKey === nextKey) {
      selectedItemInfoMode = selectedItemInfoMode === 'simple' ? 'detailed' : 'simple'
    } else {
      selectedItemInfoKey = nextKey
      selectedItemInfoMode = 'simple'
    }
  } else {
    selectedItemInfoKey = nextKey
  }
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
    simpleDesc: getDebugCfg('itemInfoSimpleDescFontSize'),
  })
  itemInfoPopup.setCenterY(getBattleInfoPanelCenterY())
  itemInfoPopup.show(item, 0, 'none', hit.tier, undefined, selectedItemInfoMode, runtimeOverride)
}

export const BattleScene: Scene = {
  name: 'battle',
  async onEnter() {
    const { stage } = getApp()
    const snapshot = getBattleSnapshot()
    if (!snapshot) {
      console.warn('[BattleScene] 缺少战斗快照，回退商店并尝试恢复进度')
      SceneManager.goto('shop')
      return
    }
    enteredSnapshot = snapshot
    battleDay = Math.max(1, snapshot.day)
    settlementResolved = false
    settlementGameOver = false
    battleSpeed = 1
    activeProjectileCount = 0
    activeFloatingNumberCount = 0
    droppedProjectileCount = 0
    droppedFloatingNumberCount = 0
    root = new Container()
    root.sortableChildren = true
    stage.addChild(root)
    battleIntroElapsedMs = 0
    battleIntroDurationMs = Math.max(0, getDebugCfg('battleIntroFadeInMs'))
    battleExitTransitionElapsedMs = 0
    battleExitTransitionDurationMs = 0
    root.alpha = battleIntroDurationMs > 0 ? 0 : 1

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

    enemyBossSprite = new Sprite(Texture.WHITE)
    enemyBossSprite.anchor.set(0.5, 1)
    enemyBossSprite.zIndex = 30
    enemyBossSprite.eventMode = 'none'
    enemyBossSprite.visible = true
    root.addChild(enemyBossSprite)

    enemyBossFlashSprite = new Sprite(Texture.WHITE)
    enemyBossFlashSprite.anchor.set(0.5, 1)
    enemyBossFlashSprite.zIndex = 31
    enemyBossFlashSprite.eventMode = 'none'
    enemyBossFlashSprite.visible = true
    enemyBossFlashSprite.tint = 0xffffff
    enemyBossFlashSprite.blendMode = 'add'
    enemyBossFlashSprite.alpha = 0
    root.addChild(enemyBossFlashSprite)

    playerHeroSprite = new Sprite(Texture.WHITE)
    playerHeroSprite.anchor.set(0.5, 1)
    playerHeroSprite.zIndex = 10
    playerHeroSprite.eventMode = 'none'
    playerHeroSprite.visible = true
    root.addChild(playerHeroSprite)

    playerHeroFlashSprite = new Sprite(Texture.WHITE)
    playerHeroFlashSprite.anchor.set(0.5, 1)
    playerHeroFlashSprite.zIndex = 11
    playerHeroFlashSprite.eventMode = 'none'
    playerHeroFlashSprite.visible = true
    playerHeroFlashSprite.tint = 0xffffff
    playerHeroFlashSprite.blendMode = 'add'
    playerHeroFlashSprite.alpha = 0
    root.addChild(playerHeroFlashSprite)

    try {
      const tex = await Assets.load<Texture>(getSceneImageUrl('boss.png'))
      if (enemyBossSprite) {
        enemyBossSprite.texture = tex
      }
      if (enemyBossFlashSprite) {
        enemyBossFlashSprite.texture = tex
      }
    enemyBossDeathElapsedMs = -1
    enemyBossHitElapsedMs = -1
    enemyBossIdleElapsedMs = 0
    } catch (err) {
      console.warn('[BattleScene] 敌人立绘加载失败', err)
      if (enemyBossSprite) enemyBossSprite.visible = false
      if (enemyBossFlashSprite) enemyBossFlashSprite.visible = false
    }
    enemyPresentationVisible = true

    try {
      const tex = await Assets.load<Texture>(getSceneImageUrl('hero.png'))
      if (playerHeroSprite) playerHeroSprite.texture = tex
      if (playerHeroFlashSprite) playerHeroFlashSprite.texture = tex
      playerHeroHitElapsedMs = -1
      playerHeroIdleElapsedMs = 0
    } catch (err) {
      console.warn('[BattleScene] 英雄立绘加载失败', err)
      if (playerHeroSprite) playerHeroSprite.visible = false
      if (playerHeroFlashSprite) playerHeroFlashSprite.visible = false
    }
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
    enemyFreezeOverlay = new Graphics()
    playerFreezeOverlay = new Graphics()
    enemyFreezeOverlay.eventMode = 'none'
    playerFreezeOverlay.eventMode = 'none'
    enemyStatusLayer = new Container()
    playerStatusLayer = new Container()
    enemyStatusLayer.eventMode = 'none'
    playerStatusLayer.eventMode = 'none'
    enemyZone.addChild(enemyCdOverlay)
    playerZone.addChild(playerCdOverlay)

    // CD 遮罩应在物品角标下方
    enemyZone.bringStatBadgesToFront()
    playerZone.bringStatBadgesToFront()

    enemyZone.addChild(enemyFreezeOverlay)
    playerZone.addChild(playerFreezeOverlay)
    enemyZone.addChild(enemyStatusLayer)
    playerZone.addChild(playerStatusLayer)

    fxLayer = new Container()
    fxLayer.zIndex = 60
    root.addChild(fxLayer)

    fatigueToastCon = new Container()
    fatigueToastCon.zIndex = 90
    fatigueToastCon.visible = false
    fatigueToastCon.eventMode = 'none'
    fatigueToastBg = new Graphics()
    fatigueToastText = new Text({
      text: '',
      style: { fontSize: 28, fill: 0xfff1a8, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 3 } },
    })
    fatigueToastCon.addChild(fatigueToastBg)
    fatigueToastCon.addChild(fatigueToastText)
    root.addChild(fatigueToastCon)

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

    battleEndMask = new Graphics()
    battleEndMask.zIndex = 180
    battleEndMask.eventMode = 'static'
    battleEndMask.visible = false
    root.addChild(battleEndMask)

    sceneFadeOverlay = new Graphics()
    sceneFadeOverlay.zIndex = 220
    sceneFadeOverlay.eventMode = 'none'
    sceneFadeOverlay.rect(0, 0, CANVAS_W, CANVAS_H)
    sceneFadeOverlay.fill({ color: 0x000000, alpha: 1 })
    sceneFadeOverlay.alpha = 0
    sceneFadeOverlay.visible = false
    root.addChild(sceneFadeOverlay)

    speedBtn = makeSpeedButton()
    root.addChild(speedBtn)

    backBtn = makeBackButton()
    backBtn.zIndex = 190
    backBtn.visible = false
    root.addChild(backBtn)

    settlementPanel = makeSettlementPanel()
    root.addChild(settlementPanel)

    engine = new CombatEngine()
    setCombatRuntimeOverride({
      burnTickMs: getDebugCfg('gameplayBurnTickMs'),
      poisonTickMs: getDebugCfg('gameplayPoisonTickMs'),
      regenTickMs: getDebugCfg('gameplayRegenTickMs'),
      fatigueStartMs: getDebugCfg('gameplayFatigueStartMs'),
      fatigueIntervalMs: getDebugCfg('gameplayFatigueIntervalMs'),
      fatigueDamagePctPerInterval: getDebugCfg('gameplayFatigueDamagePctPerInterval'),
      fatigueDamageFixedPerInterval: getDebugCfg('gameplayFatigueDamageFixedPerInterval'),
      fatigueDamagePctRampPerInterval: getDebugCfg('gameplayFatigueDamagePctRampPerInterval'),
      fatigueDamageFixedRampPerInterval: getDebugCfg('gameplayFatigueDamageFixedRampPerInterval'),
      burnShieldFactor: getDebugCfg('gameplayBurnShieldFactor'),
      burnDecayPct: getDebugCfg('gameplayBurnDecayPct'),
      healCleansePct: getDebugCfg('gameplayHealCleansePct'),
    })
    engine.start(snapshot)
    console.log(`[BattleScene] 进入战斗场景 day=${snapshot.day} entities=${snapshot.entities.length} cols=${snapshot.activeColCount}`)

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
      tryPulseItem(e.sourceItemId, e.side)
      pushBattleLog(`开火 ${e.side === 'player' ? '我方' : '敌方'} ${e.itemId} x${e.multicast}`)
    })
    offDamageEvent = EventBus.on('battle:take_damage', (e) => {
      const side = e.targetSide ?? (e.targetId === 'hero_enemy' ? 'enemy' : 'player')
      const fromSide = e.sourceSide === 'player' || e.sourceSide === 'enemy'
        ? e.sourceSide
        : (side === 'enemy' ? 'player' : 'enemy')
      const enemyAttackToPlayer = side === 'player' && fromSide === 'enemy'
      const from = (e.sourceItemId === 'fatigue' || e.sourceItemId.startsWith('status_'))
        ? getHeroBarCenter(fromSide)
        : (getItemCenterById(e.sourceItemId, fromSide) ?? getHeroBarCenter(fromSide))
      const to = getHeroBarCenter(side)
      const projectileTarget = side === 'enemy'
        ? (getEnemyPortraitHitPoint() ?? to)
        : enemyAttackToPlayer
          ? (getPlayerPortraitHitPoint() ?? to)
          : to
      const damageShown = e.type === 'normal' ? (e.finalDamage ?? e.amount) : e.amount
      const bulletColor = e.type === 'burn' ? getBattleOrbColor('burn') : e.type === 'poison' ? getBattleOrbColor('poison') : getBattleOrbColor('hp')
      const isFatigueDamage = e.sourceItemId === 'fatigue'
      const isCritDamage = e.type === 'normal' && e.isCrit
      const textColor = e.type === 'burn'
        ? getBattleFloatTextColor('burn')
        : e.type === 'poison'
          ? getBattleFloatTextColor('poison')
          : isCritDamage
            ? getBattleFloatTextColor('crit')
            : getBattleFloatTextColor('damage')
      const textSize = isCritDamage ? getDebugCfg('battleTextFontSizeCrit') : getDebugCfg('battleTextFontSizeDamage')
      if (e.sourceItemId.startsWith('status_') || isFatigueDamage) {
        if (enemyAttackToPlayer) triggerPlayerPortraitHitFx()
        spawnFloatingNumber(to, `-${damageShown}`, textColor, textSize)
        pushBattleLog(`结算 ${e.type} ${side === 'enemy' ? '敌方' : '我方'} ${damageShown}`)
      } else {
        spawnProjectile(from, projectileTarget, bulletColor, () => {
          if (side === 'enemy') {
            triggerEnemyPortraitHitFx()
            spawnFloatingNumber(projectileTarget, `-${damageShown}`, textColor, textSize)
          } else if (enemyAttackToPlayer) {
            triggerPlayerPortraitHitFx()
          }
        }, e.sourceItemId)
        pushBattleLog(`伤害 ${side === 'enemy' ? '敌方' : '我方'} ${damageShown}`)
      }
    })
    offShieldEvent = EventBus.on('battle:gain_shield', (e) => {
      const side = e.targetSide ?? (e.targetId === 'hero_enemy' ? 'enemy' : 'player')
      const from = getItemCenterById(e.sourceItemId, side) ?? getHeroBarCenter(side)
      const to = getHeroBarCenter(side)
      const projectileTarget = side === 'enemy' ? (getEnemyPortraitHitPoint() ?? to) : to
      const shieldColor = getBattleFloatTextColor('shield')
      const shieldOrbColor = getBattleOrbColor('shield')
      spawnProjectile(from, projectileTarget, shieldOrbColor, () => {
        if (side === 'enemy') {
          triggerEnemyPortraitHitFx()
          spawnFloatingNumber(projectileTarget, `+${e.amount}`, shieldColor)
        }
      }, e.sourceItemId)
      pushBattleLog(`护盾 ${side === 'enemy' ? '敌方' : '我方'} ${e.amount}`)
    })
    offHealEvent = EventBus.on('battle:heal', (e) => {
      const side = e.targetSide ?? (e.targetId === 'hero_enemy' ? 'enemy' : 'player')
      const from = e.sourceItemId.startsWith('status_') ? getHeroBarCenter(side) : (getItemCenterById(e.sourceItemId, side) ?? getHeroBarCenter(side))
      const to = getHeroBarCenter(side)
      const projectileTarget = side === 'enemy' ? (getEnemyPortraitHitPoint() ?? to) : to
      if (e.sourceItemId.startsWith('status_')) {
        spawnFloatingNumber(to, `+${e.amount}`, getBattleFloatTextColor('regen'))
        pushBattleLog(`回复 ${side === 'enemy' ? '敌方' : '我方'} ${e.amount}`)
      } else {
        const regenColor = getBattleFloatTextColor('regen')
        const regenOrbColor = getBattleOrbColor('regen')
        spawnProjectile(from, projectileTarget, regenOrbColor, () => {
          if (side === 'enemy') {
            triggerEnemyPortraitHitFx()
            spawnFloatingNumber(projectileTarget, `+${e.amount}`, regenColor)
          }
        }, e.sourceItemId)
        pushBattleLog(`治疗 ${side === 'enemy' ? '敌方' : '我方'} ${e.amount}`)
      }
    })
    offStatusApplyEvent = EventBus.on('battle:status_apply', (e) => {
      tryPulseItem(e.sourceItemId, e.sourceSide === 'player' || e.sourceSide === 'enemy' ? e.sourceSide : undefined)
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
        ? (targetSide === 'enemy'
            ? (getEnemyPortraitHitPoint() ?? getHeroBarCenter(targetSide))
            : (getPlayerPortraitHitPoint() ?? getHeroBarCenter(targetSide)))
        : (targetResolved ?? getHeroBarCenter(targetSide))
      const color =
        e.status === 'burn' ? getBattleOrbColor('burn')
          : e.status === 'poison' ? getBattleOrbColor('poison')
            : e.status === 'freeze' ? getBattleOrbColor('freeze')
              : e.status === 'slow' ? getBattleOrbColor('slow')
                : e.status === 'haste' ? getBattleOrbColor('haste')
                  : getBattleOrbColor('regen')
      spawnProjectile(from, to, color, () => {
        if (targetIsHero && targetSide === 'enemy') triggerEnemyPortraitHitFx()
        if (targetIsHero && targetSide === 'player') triggerPlayerPortraitHitFx()
      }, e.sourceItemId)
      pushBattleLog(`施加 ${e.status} ${targetSide === 'enemy' ? '敌方' : '我方'} +${e.amount}`)
    })
    offStatusRemoveEvent = EventBus.on('battle:status_remove', (e) => {
      const side = e.targetSide ?? (e.targetId === 'hero_enemy' ? 'enemy' : 'player')
      pushBattleLog(`移除 ${e.status} ${side === 'enemy' ? '敌方' : '我方'}`)
    })
    offFatigueStartEvent = EventBus.on('battle:fatigue_start', () => {
      if (getDebugCfg('toastEnabled') < 0.5 || getDebugCfg('toastShowFatigueStart') < 0.5) return
      showFatigueToast('加时赛风暴来袭')
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
    settlementPanel = null
    settlementTitleText = null
    settlementLifeText = null
    settlementDescText = null
    settlementActionBtn = null
    settlementActionLabel = null
    speedBtn = null
    speedBtnText = null
    battleEndMask = null
    sceneFadeOverlay = null
    heroHudG = null
    enemyHpInfoCon = null
    playerHpInfoCon = null
    enemyZone = null
    playerZone = null
    enemyCdOverlay = null
    playerCdOverlay = null
    enemyFreezeOverlay = null
    playerFreezeOverlay = null
    enemyStatusLayer = null
    playerStatusLayer = null
    fxLayer = null
    offFireEvent?.(); offFireEvent = null
    offDamageEvent?.(); offDamageEvent = null
    offShieldEvent?.(); offShieldEvent = null
    offHealEvent?.(); offHealEvent = null
    offStatusApplyEvent?.(); offStatusApplyEvent = null
    offStatusRemoveEvent?.(); offStatusRemoveEvent = null
    offFatigueStartEvent?.(); offFatigueStartEvent = null
    itemInfoPopup = null
    selectedItemId = null
    selectedItemSide = null
    selectedItemInfoKey = null
    selectedItemInfoMode = 'simple'
    fatigueToastCon = null
    fatigueToastBg = null
    fatigueToastText = null
    fatigueToastUntilMs = 0
    enemyBossSprite = null
    enemyBossFlashSprite = null
    enemyBossBaseScale = 1
    enemyBossHitElapsedMs = -1
    enemyBossDeathElapsedMs = -1
    enemyBossIdleElapsedMs = 0
    enemyPresentationVisible = true
    playerHeroSprite = null
    playerHeroFlashSprite = null
    playerHeroBaseScale = 1
    playerHeroHitElapsedMs = -1
    playerHeroIdleElapsedMs = 0
    battleDay = 1
    battleIntroElapsedMs = 0
    battleIntroDurationMs = 0
    battleExitTransitionElapsedMs = 0
    battleExitTransitionDurationMs = 0
    settlementResolved = false
    settlementGameOver = false
    enteredSnapshot = null
    battleSpeed = 1
    activeProjectileCount = 0
    activeFloatingNumberCount = 0
    droppedProjectileCount = 0
    droppedFloatingNumberCount = 0
    activeFx.length = 0
    for (const [, st] of pulseStates) {
      st.node?.visual.scale.set(1)
      if (st.flash.parent) st.flash.parent.removeChild(st.flash)
      st.flash.destroy()
    }
    pulseStates.clear()
    pulseDedupAtMs.clear()
    projectileVariantCursor.clear()
    for (const [, fx] of statusFxByKey) {
      if (fx.root.parent) fx.root.parent.removeChild(fx.root)
      fx.root.destroy({ children: true })
    }
    statusFxByKey.clear()
    engine = null
    console.log('[BattleScene] 离开战斗场景')
  },
  update(dt: number) {
    if (!engine || !enemyZone || !playerZone || !enemyCdOverlay || !playerCdOverlay || !enemyFreezeOverlay || !playerFreezeOverlay || !enemyStatusLayer || !playerStatusLayer) return
    if (tickBattleExitTransition(dt * 1000)) return
    const speed = Math.max(1, battleSpeed)
    const simDt = dt * speed
    const introDone = tickBattleIntro(simDt * 1000)
    if (introDone) engine.update(simDt)
    enemyPresentationVisible = !engine.isFinished()
    enemyZone.visible = enemyPresentationVisible
    if (enemyBossSprite) enemyBossSprite.visible = enemyPresentationVisible
    if (enemyBossFlashSprite) enemyBossFlashSprite.visible = enemyPresentationVisible
    const board = engine.getBoardState()
    const runtime = engine.getRuntimeState()
    const runtimeChargePercentById = new Map(runtime.map((it) => [it.id, it.chargePercent]))
    const activeCols = getDayActiveCols(battleDay)
    enemyZone.setActiveColCount(activeCols)
    playerZone.setActiveColCount(activeCols)
    applyZoneVisualStyle(enemyZone)
    applyZoneVisualStyle(playerZone)
    applyLayout(activeCols)

    const playerItems = board.items.filter((it) => it.side === 'player')
    const enemyItems = board.items.filter((it) => it.side === 'enemy')
    drawCooldownOverlay(playerZone, playerCdOverlay, playerItems, runtimeChargePercentById)
    drawCooldownOverlay(enemyZone, enemyCdOverlay, enemyItems, runtimeChargePercentById)
    const runtimeById = new Map(runtime.map((it) => [it.id, it]))
    updateRuntimeStatBadges(playerZone, playerItems, runtimeById)
    updateRuntimeStatBadges(enemyZone, enemyItems, runtimeById)
    updateZoneStatusFx(playerZone, 'player', playerItems, runtimeById, playerFreezeOverlay, playerStatusLayer)
    updateZoneStatusFx(enemyZone, 'enemy', enemyItems, runtimeById, enemyFreezeOverlay, enemyStatusLayer)

    drawHeroBars(board.player, board.enemy)

    const dtMs = simDt * 1000
    tickPulseStates(dtMs)
    tickEnemyPortraitFx(dtMs)
    tickPlayerPortraitFx(dtMs)
    for (let i = activeFx.length - 1; i >= 0; i--) {
      if (!activeFx[i]!(dtMs)) activeFx.splice(i, 1)
    }

    if (statusText) {
      const s = engine.getDebugState()
      statusText.text = `phase:${engine.getPhase()} ticks:${s.tickIndex} fatigue:${s.inFatigue ? 'on' : 'off'} fx:${activeFx.length} p:${activeProjectileCount}/${FX_MAX_PROJECTILES} t:${activeFloatingNumberCount}/${FX_MAX_FLOATING_NUMBERS} drop:${droppedProjectileCount + droppedFloatingNumberCount}`
    }

    if (battleEndMask) {
      if (engine.isFinished()) {
        resolveBattleSettlement()
        battleEndMask.visible = true
        battleEndMask.clear()
        battleEndMask.rect(0, 0, CANVAS_W, CANVAS_H)
        battleEndMask.fill({ color: 0x000000, alpha: 0.45 })
      } else if (battleEndMask.visible) {
        battleEndMask.visible = false
      }
    }

    if (speedBtn) {
      speedBtn.visible = !engine.isFinished()
      speedBtn.y = getDebugCfg('battleSpeedBtnY')
      if (speedBtnText) speedBtnText.text = `x${battleSpeed}`
    }

    if (backBtn) {
      backBtn.x = getDebugCfg('battleBackBtnX')
      backBtn.y = getDebugCfg('battleBackBtnY')
      backBtn.visible = false
    }

    if (settlementPanel) {
      settlementPanel.visible = engine.isFinished()
    }

    if (fatigueToastCon?.visible) {
      const remain = fatigueToastUntilMs - Date.now()
      if (remain <= 0) {
        fatigueToastCon.visible = false
      } else if (remain < 220) {
        fatigueToastCon.alpha = remain / 220
      }
    }

    if (itemInfoPopup?.visible) {
      itemInfoPopup.setCenterY(getBattleInfoPanelCenterY())
      if (selectedItemId && selectedItemSide) {
        const boardHit = board.items.find((it) => it.id === selectedItemId && it.side === selectedItemSide)
        if (!boardHit) clearBattleItemSelection()
        else showBattleItemInfo(selectedItemId, selectedItemSide, true)
      }
    }
  },
}
