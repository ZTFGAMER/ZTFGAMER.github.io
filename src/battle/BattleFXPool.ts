import { Assets, Container, Graphics, Sprite, Texture, Text } from 'pixi.js'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { getBattleOrbColor } from '@/config/colorPalette'
import { getItemIconUrl, getItemIconUrlByName } from '@/core/AssetPath'
import { getAllItems } from '@/core/DataLoader'
import { CELL_SIZE, CELL_HEIGHT, type GridZone } from '@/common/grid/GridZone'
import type { ItemDef } from '@/common/items/ItemDef'
import type { ItemSizeNorm } from '@/common/items/ItemDef'
import type { CombatEngine } from './CombatEngine'

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

const FX_MAX_PROJECTILES = 40
const FX_MAX_FLOATING_NUMBERS = 30
const FX_MAX_ACTIVE_TOTAL = 80
const FX_POOL_MAX_PROJECTILES = 48
const FX_POOL_MAX_FLOATING_NUMBERS = 40
const FX_POOL_MAX_PULSE_FLASHES = 32

type TickAnim = (dtMs: number) => boolean

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

function sizeToWH(size: ItemSizeNorm): { w: number; h: number } {
  if (size === '2x1') return { w: 2, h: 1 }
  if (size === '3x1') return { w: 3, h: 1 }
  return { w: 1, h: 1 }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function formatStatusSec(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(1)
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

const ITEM_BY_ID = new Map(getAllItems().map((it) => [it.id, it] as const))

export class BattleFXPool {
  private fxLayer: Container | null = null
  private playerZone: GridZone | null = null
  private enemyZone: GridZone | null = null
  private engine: CombatEngine | null = null
  private activeFx: TickAnim[] = []
  private projectileSpritePool: Sprite[] = []
  private projectileDotPool: Graphics[] = []
  private floatingNumberPool: Text[] = []
  private pulseFlashPool: Graphics[] = []
  private activeProjectileCount = 0
  private activeFloatingNumberCount = 0
  private pendingDelayedDamageVisualCount = 0
  private droppedProjectileCount = 0
  private droppedFloatingNumberCount = 0
  private projectileUseCursor = 1
  readonly sourceNextDamageVisualAtMs = new Map<string, number>()
  readonly playerMountedItemIds = new Set<string>()
  readonly enemyMountedItemIds = new Set<string>()
  readonly pendingDestroyedItemDueMs = new Map<string, number>()

  private pulseStates = new Map<string, PulseState>()
  private pulseDedupAtMs = new Map<string, number>()
  private projectileVariantCursor = new Map<string, number>()
  private projectileTextureCache = new Map<string, Texture>()
  private projectileMissingUrls = new Set<string>()
  private statusFxByKey = new Map<string, StatusFx>()

  setContext(
    fxLayer: Container,
    playerZone: GridZone | null,
    enemyZone: GridZone | null,
    engine: CombatEngine | null,
  ): void {
    this.fxLayer = fxLayer
    this.playerZone = playerZone
    this.enemyZone = enemyZone
    this.engine = engine
  }

  private resolveItemSide(sourceItemId: string, preferred?: 'player' | 'enemy'): 'player' | 'enemy' | null {
    if (preferred === 'player' || preferred === 'enemy') return preferred
    if (this.playerZone?.getNode(sourceItemId)) return 'player'
    if (this.enemyZone?.getNode(sourceItemId)) return 'enemy'
    return null
  }

  getItemCenterById(sourceItemId: string, side: 'player' | 'enemy'): { x: number; y: number } | null {
    if (!this.enemyZone || !this.playerZone) return null
    const zone = side === 'enemy' ? this.enemyZone : this.playerZone
    const node = zone.getNode(sourceItemId)
    if (!node) return null
    const { w, h } = sizeToWH(node.size)
    return {
      x: zone.x + (node.container.x + (w * CELL_SIZE) / 2) * zone.scale.x,
      y: zone.y + (node.container.y + (h * CELL_HEIGHT) / 2) * zone.scale.y,
    }
  }

  getItemCenterAnySide(sourceItemId: string): { pos: { x: number; y: number }; side: 'player' | 'enemy' } | null {
    const p = this.getItemCenterById(sourceItemId, 'player')
    if (p) return { pos: p, side: 'player' }
    const e = this.getItemCenterById(sourceItemId, 'enemy')
    if (e) return { pos: e, side: 'enemy' }
    return null
  }

  private getDefBySourceInstance(sourceItemId: string): ItemDef | null {
    if (!this.engine) return null
    const board = this.engine.getBoardState()
    const hit = board.items.find((it) => it.id === sourceItemId)
    if (!hit) return null
    return ITEM_BY_ID.get(hit.defId) ?? null
  }

  private isFlyableProjectile(def: ItemDef | null): boolean {
    if (!def) return false
    const style = def.attack_style ?? ''
    if (!style || style.includes('不飞行')) return false
    return style.includes('飞行')
  }

  private collectProjectileIconUrls(def: ItemDef, sourceItemId?: string): string[] {
    const out: string[] = []
    let stems = (def.attack_variants ?? []).filter(Boolean)
    if (stems.length === 0 && def.icon) {
      stems = [`${def.icon}_a`, `${def.icon}_a2`]
    }
    if (stems.length > 0) {
      const key = sourceItemId || def.id
      const cursor = this.projectileVariantCursor.get(key) ?? 0
      const idx = ((cursor % stems.length) + stems.length) % stems.length
      this.projectileVariantCursor.set(key, cursor + 1)

      const first = stems[idx]
      if (first) out.push(getItemIconUrlByName(first))
      for (let i = 0; i < stems.length; i++) {
        if (i !== idx) out.push(getItemIconUrlByName(stems[i]!))
      }
    }
    out.push(getItemIconUrl(def.id))
    return Array.from(new Set(out))
  }

  private canSpawnProjectileFx(): boolean {
    if (this.activeFx.length >= FX_MAX_ACTIVE_TOTAL) {
      this.droppedProjectileCount += 1
      return false
    }
    if (this.activeProjectileCount >= FX_MAX_PROJECTILES) {
      this.droppedProjectileCount += 1
      return false
    }
    return true
  }

  private canSpawnFloatingNumberFx(): boolean {
    if (this.activeFx.length >= FX_MAX_ACTIVE_TOTAL) {
      this.droppedFloatingNumberCount += 1
      return false
    }
    if (this.activeFloatingNumberCount >= FX_MAX_FLOATING_NUMBERS) {
      this.droppedFloatingNumberCount += 1
      return false
    }
    return true
  }

  private acquireProjectileSprite(from: { x: number; y: number }): Sprite {
    const sprite = this.projectileSpritePool.pop() ?? new Sprite(Texture.WHITE)
    sprite.anchor.set(0.5)
    sprite.x = from.x
    sprite.y = from.y
    sprite.alpha = 1
    sprite.rotation = 0
    sprite.scale.set(1)
    sprite.texture = Texture.WHITE
    return sprite
  }

  private releaseProjectileSprite(sprite: Sprite): void {
    if (sprite.parent) sprite.parent.removeChild(sprite)
    ;(sprite as Sprite & { __fxUseId?: number }).__fxUseId = 0
    sprite.alpha = 1
    sprite.rotation = 0
    sprite.scale.set(1)
    sprite.texture = Texture.WHITE
    if (this.projectileSpritePool.length < FX_POOL_MAX_PROJECTILES) {
      this.projectileSpritePool.push(sprite)
    } else {
      sprite.destroy()
    }
  }

  private acquireProjectileDot(from: { x: number; y: number }, color: number): Graphics {
    const dot = this.projectileDotPool.pop() ?? new Graphics()
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

  private releaseProjectileDot(dot: Graphics): void {
    if (dot.parent) dot.parent.removeChild(dot)
    dot.clear()
    dot.alpha = 1
    dot.rotation = 0
    dot.scale.set(1)
    if (this.projectileDotPool.length < FX_POOL_MAX_PROJECTILES) {
      this.projectileDotPool.push(dot)
    } else {
      dot.destroy()
    }
  }

  private acquireFloatingNumber(text: string, color: number, fontSize: number): Text {
    const t = this.floatingNumberPool.pop() ?? new Text({ text: '' })
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

  private releaseFloatingNumber(t: Text): void {
    if (t.parent) t.parent.removeChild(t)
    t.text = ''
    t.alpha = 1
    t.rotation = 0
    t.scale.set(1)
    if (this.floatingNumberPool.length < FX_POOL_MAX_FLOATING_NUMBERS) {
      this.floatingNumberPool.push(t)
    } else {
      t.destroy()
    }
  }

  private async resolveProjectileTexture(urls: string[]): Promise<Texture | null> {
    for (const url of urls) {
      if (this.projectileMissingUrls.has(url)) continue
      const cached = this.projectileTextureCache.get(url)
      if (cached) return cached
      try {
        const tex = await Assets.load<Texture>(url)
        this.projectileTextureCache.set(url, tex)
        return tex
      } catch {
        this.projectileMissingUrls.add(url)
        // continue fallback url list
      }
    }
    return null
  }

  spawnProjectile(from: { x: number; y: number }, to: { x: number; y: number }, color: number, onHit?: () => void, sourceItemId?: string): void {
    if (!this.fxLayer) {
      onHit?.()
      return
    }
    if (!this.canSpawnProjectileFx()) {
      onHit?.()
      return
    }
    this.activeProjectileCount += 1

    const useItemSprite = true
    const sourceDef = sourceItemId ? this.getDefBySourceInstance(sourceItemId) : null
    const useSprite = useItemSprite && this.isFlyableProjectile(sourceDef)

    let visual: Graphics | Sprite
    let recycle: (() => void) | null = null
    let spinRadPerSec = 0
    let spinDir = -1
    let lockFacingRad: number | null = null
    let forceLinearFlight = false
    const travelDx = to.x - from.x
    const travelDy = to.y - from.y
    if (useSprite && sourceDef) {
      const sprite = this.acquireProjectileSprite(from)
      const sourceSide = sourceItemId ? this.resolveItemSide(sourceItemId) : null
      const sourceItemScale = sourceSide === 'enemy' ? getDebugCfg('enemyAreaScale') : getDebugCfg('battleItemScale')
      const px = Math.max(8, Math.round(getDebugCfg('battleProjectileItemSizePx') * Math.max(0.25, sourceItemScale)))
      sprite.width = px
      sprite.height = px
      this.fxLayer.addChild(sprite)
      visual = sprite
      recycle = () => this.releaseProjectileSprite(sprite)
      const useId = this.projectileUseCursor++
      ;(sprite as Sprite & { __fxUseId?: number }).__fxUseId = useId

      const attackStyle = sourceDef.attack_style ?? ''
      if (attackStyle.includes('旋转')) {
        spinRadPerSec = Math.abs(getDebugCfg('battleProjectileSpinDegPerSec')) * Math.PI / 180
        spinDir = travelDx >= 0 ? -1 : 1
      } else if (attackStyle.includes('直线')) {
        // 资源默认朝上；Pixi 0 弧度朝右，需补 +90° 对齐前向
        lockFacingRad = Math.atan2(to.y - from.y, to.x - from.x) + Math.PI / 2
        forceLinearFlight = true
      }

      const urls = this.collectProjectileIconUrls(sourceDef, sourceItemId)
      ;(async () => {
        const tex = await this.resolveProjectileTexture(urls)
        if (tex && (sprite as Sprite & { __fxUseId?: number }).__fxUseId === useId) sprite.texture = tex
      })()
    } else {
      const dot = this.acquireProjectileDot(from, color)
      this.fxLayer.addChild(dot)
      visual = dot
      recycle = () => this.releaseProjectileDot(dot)
    }

    const durationMinRaw = Math.max(1, getDebugCfg('battleProjectileFlyMsMin'))
    const durationMaxRaw = Math.max(1, getDebugCfg('battleProjectileFlyMsMax'))
    const durationMin = Math.min(durationMinRaw, durationMaxRaw)
    const durationMax = Math.max(durationMinRaw, durationMaxRaw)
    const duration = durationMax > durationMin
      ? durationMin + Math.random() * (durationMax - durationMin)
      : durationMin
    const arcH = forceLinearFlight ? 0 : getDebugCfg('battleProjectileArcHeight')
    const sideArcMax = Math.max(0, getDebugCfg('battleProjectileSideArcMax'))
    const dx = travelDx
    const dy = travelDy
    const dist = Math.max(1, Math.hypot(dx, dy))
    const nx = -dy / dist
    const ny = dx / dist
    const sideArcSign = Math.random() < 0.5 ? -1 : 1
    const sideArcAmplitude = forceLinearFlight ? 0 : sideArcSign * (Math.random() * sideArcMax)
    const scaleStart = useSprite ? getDebugCfg('battleProjectileScaleStart') : 1
    const scalePeak = useSprite ? getDebugCfg('battleProjectileScalePeak') : 1
    const scaleEnd = useSprite ? getDebugCfg('battleProjectileScaleEnd') : 1
    const peakT = Math.max(0.05, Math.min(0.95, getDebugCfg('battleProjectileScalePeakT')))
    let t = 0
    this.activeFx.push((dtMs) => {
      t += dtMs
      const p = Math.min(1, t / duration)
      const parabola = 4 * p * (1 - p)
      const sideOffset = sideArcAmplitude * parabola
      visual.x = from.x + (to.x - from.x) * p + nx * sideOffset
      visual.y = from.y + (to.y - from.y) * p + ny * sideOffset - arcH * parabola

      const k = p <= peakT
        ? lerp(scaleStart, scalePeak, p / peakT)
        : lerp(scalePeak, scaleEnd, (p - peakT) / (1 - peakT))
      visual.scale.set(k)
      if (spinRadPerSec > 0) {
        visual.rotation += spinRadPerSec * spinDir * (dtMs / 1000)
      } else if (lockFacingRad !== null) {
        visual.rotation = lockFacingRad
      }

      if (p >= 1) {
        recycle?.()
        this.activeProjectileCount = Math.max(0, this.activeProjectileCount - 1)
        onHit?.()
        return false
      }
      return true
    })
  }

  spawnFloatingNumber(to: { x: number; y: number }, text: string, color: number, fontSize?: number): void {
    if (!this.fxLayer) return
    if (!this.canSpawnFloatingNumberFx()) return
    this.activeFloatingNumberCount += 1
    const actualFontSize = fontSize ?? getDebugCfg('battleHpTextFontSize')
    const t = this.acquireFloatingNumber(text, color, actualFontSize)
    const randomX = getDebugCfg('battleDamageFloatRandomX')
    t.x = to.x - t.width / 2 + (Math.random() * 2 - 1) * randomX
    t.y = to.y - t.height / 2
    this.fxLayer.addChild(t)

    const riseMs = getDebugCfg('battleDamageFloatRiseMs')
    const riseY = getDebugCfg('battleDamageFloatRiseY')
    const holdMs = getDebugCfg('battleDamageFloatHoldMs')
    const fadeMs = getDebugCfg('battleDamageFloatFadeMs')
    let elapsed = 0
    this.activeFx.push((dtMs) => {
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
        this.releaseFloatingNumber(t)
        this.activeFloatingNumberCount = Math.max(0, this.activeFloatingNumberCount - 1)
        return false
      }
      return true
    })
  }

  offsetFloatingNumberTarget(side: 'player' | 'enemy', to: { x: number; y: number }): { x: number; y: number } {
    if (side !== 'player') return to
    return { x: to.x, y: to.y - 50 }
  }

  scheduleDamageVisual(delayMs: number, fn: () => void): void {
    if (delayMs <= 0) {
      fn()
      return
    }
    this.pendingDelayedDamageVisualCount += 1
    let elapsed = 0
    this.activeFx.push((dtMs) => {
      elapsed += dtMs
      if (elapsed >= delayMs) {
        this.pendingDelayedDamageVisualCount = Math.max(0, this.pendingDelayedDamageVisualCount - 1)
        fn()
        return false
      }
      return true
    })
  }

  hasPendingDamageImpactPresentation(): boolean {
    return this.pendingDelayedDamageVisualCount > 0 || this.activeProjectileCount > 0
  }

  animateItemFirePulse(sourceItemId: string, side: 'player' | 'enemy'): void {
    const zone = side === 'enemy' ? this.enemyZone : this.playerZone
    if (!zone) return
    const node = zone.getNode(sourceItemId)
    if (!node) return

    const maxScale = getDebugCfg('battleFirePulseScaleMax')
    const totalMs = getDebugCfg('battleFirePulseMs')
    const existing = this.pulseStates.get(sourceItemId)
    if (existing && existing.node) {
      existing.elapsedMs = 0
      existing.durationMs = totalMs
      existing.maxScale = maxScale
      existing.node.visual.scale.set(1)
      existing.flash.alpha = 0
      return
    }

    const flash = this.pulseFlashPool.pop() ?? new Graphics()
    flash.clear()
    flash.roundRect(4, 4, node.container.width - 8, node.container.height - 8, Math.max(4, getDebugCfg('gridItemCornerRadius')))
    flash.stroke({ color: 0xffdf66, width: 3, alpha: 0.95 })
    flash.alpha = 0
    node.visual.addChild(flash)
    node.visual.scale.set(1)
    this.pulseStates.set(sourceItemId, {
      node,
      flash,
      elapsedMs: 0,
      durationMs: totalMs,
      maxScale,
    })
  }

  tryPulseItem(sourceItemId: string, preferredSide?: 'player' | 'enemy'): void {
    if (!sourceItemId || sourceItemId === 'fatigue' || sourceItemId.startsWith('status_')) return
    const side = this.resolveItemSide(sourceItemId, preferredSide)
    if (!side) return

    const now = Date.now()
    const dedupMs = Math.max(1, Math.min(80, Math.round(getDebugCfg('battleFirePulseMs') * 0.4)))
    const lastAt = this.pulseDedupAtMs.get(sourceItemId) ?? 0
    if (now - lastAt < dedupMs) return

    this.pulseDedupAtMs.set(sourceItemId, now)
    this.animateItemFirePulse(sourceItemId, side)
  }

  private tickPulseStates(dtMs: number): void {
    for (const [id, st] of this.pulseStates) {
      if (!st.node) {
        this.pulseStates.delete(id)
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
        st.flash.clear()
        st.flash.alpha = 1
        if (this.pulseFlashPool.length < FX_POOL_MAX_PULSE_FLASHES) this.pulseFlashPool.push(st.flash)
        else st.flash.destroy()
        this.pulseStates.delete(id)
      }
    }
  }

  tick(dtMs: number): void {
    this.tickPulseStates(dtMs)
    for (let i = this.activeFx.length - 1; i >= 0; i--) {
      if (!this.activeFx[i]!(dtMs)) this.activeFx.splice(i, 1)
    }
  }

  getPulseStatesSize(): number {
    return this.pulseStates.size
  }

  getActiveFxLength(): number {
    return this.activeFx.length
  }

  getActiveProjectileCount(): number {
    return this.activeProjectileCount
  }

  getActiveFloatingNumberCount(): number {
    return this.activeFloatingNumberCount
  }

  getDroppedProjectileCount(): number {
    return this.droppedProjectileCount
  }

  getDroppedFloatingNumberCount(): number {
    return this.droppedFloatingNumberCount
  }

  getPlayerMountedIds(): Set<string> {
    return this.playerMountedItemIds
  }

  getEnemyMountedIds(): Set<string> {
    return this.enemyMountedItemIds
  }

  getPendingDestroyedItems(): Map<string, number> {
    return this.pendingDestroyedItemDueMs
  }

  updateStatusFx(
    playerZone: GridZone,
    enemyZone: GridZone,
    engine: CombatEngine,
    playerStatusLayer: Container,
    enemyStatusLayer: Container,
    playerFreezeOverlay: Graphics,
    enemyFreezeOverlay: Graphics,
  ): void {
    const board = engine.getBoardState()
    const runtime = engine.getRuntimeState()
    const playerItems = board.items.filter((it) => it.side === 'player')
    const enemyItems = board.items.filter((it) => it.side === 'enemy')
    const runtimeById = new Map(runtime.map((it) => [it.id, it]))
    this.updateZoneStatusFx(playerZone, 'player', playerItems, runtimeById, playerFreezeOverlay, playerStatusLayer)
    this.updateZoneStatusFx(enemyZone, 'enemy', enemyItems, runtimeById, enemyFreezeOverlay, enemyStatusLayer)
  }

  private ensureStatusFx(key: string, zone: GridZone, instanceId: string, statusLayer: Container): StatusFx | null {
    const existing = this.statusFxByKey.get(key)
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
    this.statusFxByKey.set(key, fx)
    return fx
  }

  private updateZoneStatusFx(
    zone: GridZone,
    zoneKey: 'player' | 'enemy',
    items: import('@/battle/CombatEngine').CombatBoardItem[],
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
      const fx = this.ensureStatusFx(key, zone, it.id, statusLayer)
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
      const scale = this.pulseStates.get(it.id)?.node?.visual.scale.x ?? 1
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

    for (const [key, fx] of this.statusFxByKey) {
      if (!key.startsWith(`${zoneKey}:`)) continue
      if (activeKeys.has(key)) continue
      if (fx.root.parent) fx.root.parent.removeChild(fx.root)
      fx.root.destroy({ children: true })
      this.statusFxByKey.delete(key)
    }
  }

  getPerfStats(): BattleFxPerfStats {
    return {
      activeFx: this.activeFx.length,
      activeProjectiles: this.activeProjectileCount,
      activeFloatingNumbers: this.activeFloatingNumberCount,
      droppedProjectiles: this.droppedProjectileCount,
      droppedFloatingNumbers: this.droppedFloatingNumberCount,
      pooledProjectileSprites: this.projectileSpritePool.length,
      pooledProjectileDots: this.projectileDotPool.length,
      pooledFloatingNumbers: this.floatingNumberPool.length,
    }
  }

  reset(): void {
    this.activeProjectileCount = 0
    this.activeFloatingNumberCount = 0
    this.pendingDelayedDamageVisualCount = 0
    this.droppedProjectileCount = 0
    this.droppedFloatingNumberCount = 0
    this.activeFx.length = 0
    this.sourceNextDamageVisualAtMs.clear()
    this.playerMountedItemIds.clear()
    this.enemyMountedItemIds.clear()
    this.pendingDestroyedItemDueMs.clear()
    for (const [, st] of this.pulseStates) {
      st.node?.visual.scale.set(1)
      if (st.flash.parent) st.flash.parent.removeChild(st.flash)
      st.flash.clear()
      st.flash.alpha = 1
      if (this.pulseFlashPool.length < FX_POOL_MAX_PULSE_FLASHES) this.pulseFlashPool.push(st.flash)
      else st.flash.destroy()
    }
    this.pulseStates.clear()
    this.pulseDedupAtMs.clear()
    this.projectileVariantCursor.clear()
    for (const [, fx] of this.statusFxByKey) {
      if (fx.root.parent) fx.root.parent.removeChild(fx.root)
      fx.root.destroy({ children: true })
    }
    this.statusFxByKey.clear()
    while (this.pulseFlashPool.length > 0) {
      this.pulseFlashPool.pop()?.destroy()
    }
    this.fxLayer = null
    this.playerZone = null
    this.enemyZone = null
    this.engine = null
  }
}

export function getBattleFxPerfStats(pool: BattleFXPool): BattleFxPerfStats {
  return pool.getPerfStats()
}
