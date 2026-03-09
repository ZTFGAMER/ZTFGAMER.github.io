import type { Scene } from './SceneManager'
import { PvpContext } from '@/pvp/PvpContext'
import { clearBattleSnapshot, getBattleSnapshot } from '@/combat/BattleSnapshotStore'
import { clearBattleOutcome, setBattleOutcome } from '@/combat/BattleOutcomeStore'
import { CombatEngine, setCombatRuntimeOverride, type CombatBoardItem } from '@/combat/CombatEngine'
import { SceneManager } from '@/scenes/SceneManager'
import { getApp } from '@/core/AppContext'
import {
  addWinTrophy,
  clearCurrentRunState,
  deductLife,
  getLifeState,
  getPlayerWinStreakState,
  getWinTrophyState,
  resetLifeState,
  setPlayerWinStreak,
  resetWinTrophyState,
  SHOP_STATE_STORAGE_KEY,
} from '@/core/RunState'
import { Assets, Container, Graphics, Sprite, Texture, Text } from 'pixi.js'
import { GridZone, CELL_SIZE, CELL_HEIGHT } from '@/grid/GridZone'
import { getAllItems, getConfig as getGameCfg } from '@/core/DataLoader'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import type { ItemDef, ItemSizeNorm } from '@/items/ItemDef'
import { EventBus } from '@/core/EventBus'
import { SellPopup, type ItemInfoMode, type ItemInfoRuntimeOverride } from '@/shop/SellPopup'
import { getBattleEffectColor, getBattleFloatTextColor, getBattleOrbColor, getTierColor } from '@/config/colorPalette'
import { getItemIconUrl, getItemIconUrlByName, getSceneImageUrl, getSkillIconUrl } from '@/core/assetPath'
import { getBronzeSkillById, getBronzeSkillByName } from '@/skills/bronzeSkillConfig'
import { getSilverSkillById } from '@/skills/silverSkillConfig'
import { getGoldSkillById } from '@/skills/goldSkillConfig'

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
let settlementTrophyText: Text | null = null
let settlementDescText: Text | null = null
let settlementActionBtn: Container | null = null
let settlementActionLabel: Text | null = null
let settlementStatsBtn: Container | null = null
let statsBtn: Container | null = null
let statsBtnText: Text | null = null
let damageStatsMask: Graphics | null = null
let damageStatsPanel: Container | null = null
let damageStatsTitleText: Text | null = null
let damageStatsRowsCon: Container | null = null
let damageStatsTabPlayerBtn: Container | null = null
let damageStatsTabEnemyBtn: Container | null = null
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
let offTriggerEvent: (() => void) | null = null
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
// PVP sync mode state
let syncAStarted = false        // Mode A: true after sync_start received
let enteredSnapshot: ReturnType<typeof getBattleSnapshot> = null
let battleIntroElapsedMs = 0
let battleIntroDurationMs = 0
let skillBarIntroElapsedMs = 0
const SKILL_BAR_INTRO_DURATION_MS = 500
let battleExitTransitionElapsedMs = 0
let battleExitTransitionDurationMs = 0
let settlementResolved = false
let settlementGameOver = false
let settlementFinalVictory = false
let settlementRevealAtMs: number | null = null
let battlePresentationMs = 0
let damageStatsPanelVisible = false
let damageStatsDirty = false
let damageStatsLastRenderAtMs = 0
let damageStatsTab: 'player' | 'enemy' = 'player'
const BATTLE_SPEED_STEPS = [1, 2, 4, 8] as const
const TOP_ACTION_BTN_H = 58
const TOP_ACTION_BTN_HALF_H = TOP_ACTION_BTN_H / 2
const TOP_ACTION_BTN_SAFE_PAD = 8
const DAMAGE_STATS_PANEL_W = 560
const DAMAGE_STATS_PANEL_H = 700
const FX_MAX_PROJECTILES = 40
const FX_MAX_FLOATING_NUMBERS = 30
const FX_MAX_ACTIVE_TOTAL = 80
const FX_POOL_MAX_PROJECTILES = 48
const FX_POOL_MAX_FLOATING_NUMBERS = 40
const FX_POOL_MAX_PULSE_FLASHES = 32

type TickAnim = (dtMs: number) => boolean
const activeFx: TickAnim[] = []
const projectileSpritePool: Sprite[] = []
const projectileDotPool: Graphics[] = []
const floatingNumberPool: Text[] = []
const pulseFlashPool: Graphics[] = []
let activeProjectileCount = 0
let activeFloatingNumberCount = 0
let pendingDelayedDamageVisualCount = 0
let droppedProjectileCount = 0
let droppedFloatingNumberCount = 0
let projectileUseCursor = 1
const sourceNextDamageVisualAtMs = new Map<string, number>()

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
let playerSkillIconBarCon: Container | null = null
let enemySkillIconBarCon: Container | null = null
let battleSkillDetailPopupCon: Container | null = null
let battleSkillDetailSkillId: string | null = null
let battleSkillIconBarKey = ''
let enemySkillIconBarKey = ''
let lastHudTickIndex = -1
type BattleSkillPick = {
  id: string
  name: string
  desc: string
  detailDesc?: string
  icon?: string
  archetype: 'warrior' | 'archer' | 'assassin' | 'utility'
  tier: 'bronze' | 'silver' | 'gold'
}
let battlePickedSkills: BattleSkillPick[] = []
let enemyPickedSkills: BattleSkillPick[] = []
let battleSkillDetailMode: 'simple' | 'detailed' = 'simple'

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

const battleStatsByItemId = new Map<string, ItemBattleStat>()
const battleStatLastTriggerTickByItemId = new Map<string, number>()

function currentBattleTickIndex(): number {
  const tick = engine?.getDebugState().tickIndex
  if (typeof tick !== 'number' || !Number.isFinite(tick)) return -1
  return Math.max(0, Math.round(tick))
}

function addBattleItemTriggerCount(
  sourceItemId: string,
  side: 'player' | 'enemy',
  amount: number,
  dedupeWithinTick = false,
): void {
  if (!sourceItemId) return
  const add = Math.max(1, Math.round(Number(amount) || 1))
  if (dedupeWithinTick) {
    const tick = currentBattleTickIndex()
    if (tick >= 0) {
      const last = battleStatLastTriggerTickByItemId.get(sourceItemId)
      if (last === tick) return
      battleStatLastTriggerTickByItemId.set(sourceItemId, tick)
    }
  }
  const stat = ensureBattleStatEntry(sourceItemId, side)
  stat.triggerCount += add
  damageStatsDirty = true
}

function parseTierLevel(tierRaw: string): number {
  const tier = `${tierRaw}`
  const m = tier.match(/#(\d+)/)
  const star = Math.max(1, Math.min(2, Number(m?.[1] ?? 1) || 1))
  if (tier.includes('Silver')) return star + 2
  if (tier.includes('Gold')) return star + 4
  if (tier.includes('Diamond')) return 7
  return star
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

function loadPickedSkillsFromShopState(): BattleSkillPick[] {
  try {
    const raw = localStorage.getItem(SHOP_STATE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { state?: { pickedSkills?: unknown } } | null
    const state = parsed && typeof parsed === 'object' && parsed.state && typeof parsed.state === 'object'
      ? parsed.state
      : parsed
    const list = (state as { pickedSkills?: unknown } | null)?.pickedSkills
    if (!Array.isArray(list)) return []
    return list
      .map((it): BattleSkillPick | null => {
        const rec = it as Record<string, unknown>
        const id = String(rec.id ?? '').trim()
        const name = String(rec.name ?? '').trim()
        const desc = String(rec.desc ?? '').trim()
        const detailDesc = String(rec.detailDesc ?? '').trim()
        const icon = String(rec.icon ?? '').trim()
        const archetype = String(rec.archetype ?? '') as BattleSkillPick['archetype']
        const tier = String(rec.tier ?? '') as BattleSkillPick['tier']
        if (!id || !name) return null
        if (archetype !== 'warrior' && archetype !== 'archer' && archetype !== 'assassin' && archetype !== 'utility') return null
        if (tier !== 'bronze' && tier !== 'silver' && tier !== 'gold') return null
        const one: BattleSkillPick = { id, name, desc, archetype, tier }
        if (detailDesc) one.detailDesc = detailDesc
        if (icon) one.icon = icon
        return one
      })
      .filter((v): v is BattleSkillPick => !!v)
  } catch {
    return []
  }
}

function battleSkillTierColor(tier: BattleSkillPick['tier']): number {
  if (tier === 'bronze') return 0xbe8b46
  if (tier === 'silver') return 0x9aafc8
  return 0xd0ac43
}

function battleSkillTierLabelCn(tier: BattleSkillPick['tier']): string {
  if (tier === 'bronze') return '青铜'
  if (tier === 'silver') return '白银'
  return '黄金'
}

function getBattleSkillIconStem(skill: BattleSkillPick): string | null {
  const normalize = (raw: string): string => raw.replace(/\.png$/i, '').trim()
  const fromSkill = normalize(`${skill.icon ?? ''}`)
  if (fromSkill) return fromSkill
  if (/^skill\d+$/.test(skill.id)) return skill.id
  const fromIdCfg = getBronzeSkillById(skill.id)?.icon
    ?? getSilverSkillById(skill.id)?.icon
    ?? getGoldSkillById(skill.id)?.icon
  if (fromIdCfg) return normalize(fromIdCfg)
  const fromNameCfg = getBronzeSkillByName(skill.name)?.icon
  if (fromNameCfg) return normalize(fromNameCfg)
  return null
}

function toBattleSkillPickById(id: string): BattleSkillPick | null {
  const hit = getBronzeSkillById(id) ?? getSilverSkillById(id) ?? getGoldSkillById(id)
  if (!hit) return null
  return {
    id: hit.id,
    name: hit.name,
    desc: hit.desc,
    detailDesc: hit.detailDesc,
    icon: hit.icon,
    archetype: hit.archetype,
    tier: hit.tier,
  }
}

function mountBattleSkillIconSprite(
  parent: Container,
  skill: BattleSkillPick,
  centerX: number,
  centerY: number,
  iconSize: number,
  fallback: Text,
): void {
  const stem = getBattleSkillIconStem(skill)
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

function layoutBattleSkillIconBar(): void {
  if (!playerSkillIconBarCon) return
  const hpCenter = getHeroBarCenter('player')
  const hpTopY = hpCenter.y - getDebugCfg('battleHpBarH') / 2
  const introP = Math.max(0, Math.min(1, skillBarIntroElapsedMs / SKILL_BAR_INTRO_DURATION_MS))
  const eased = 1 - Math.pow(1 - introP, 3)
  const targetY = hpTopY - 54
  const baseY = targetY - 70
  playerSkillIconBarCon.x = hpCenter.x
  playerSkillIconBarCon.y = baseY + (targetY - baseY) * eased
}

function layoutEnemySkillIconBar(): void {
  if (!enemySkillIconBarCon) return
  const hpCenter = getHeroBarCenter('enemy')
  const hpTopY = hpCenter.y - getDebugCfg('battleHpBarH') / 2
  enemySkillIconBarCon.x = hpCenter.x
  enemySkillIconBarCon.y = hpTopY - 54
}

function resolveSkillBarIntroElapsedMs(snapshot: ReturnType<typeof getBattleSnapshot>): number {
  const startedAt = snapshot?.skillBarMoveStartAtMs
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return 0
  const elapsed = Date.now() - startedAt
  return Math.max(0, Math.min(SKILL_BAR_INTRO_DURATION_MS, elapsed))
}

function handleBattleSkillIconTap(skill: BattleSkillPick): void {
  clearBattleItemSelection()
  if (battleSkillDetailSkillId === skill.id) {
    battleSkillDetailMode = battleSkillDetailMode === 'simple' ? 'detailed' : 'simple'
    showBattleSkillDetailPopup(skill)
  } else {
    battleSkillDetailMode = 'simple'
    showBattleSkillDetailPopup(skill)
  }
  refreshBattleSkillIconBar(true)
  refreshEnemySkillIconBar(true)
}

function hideBattleSkillDetailPopup(): void {
  const hadSelection = battleSkillDetailSkillId !== null
  battleSkillDetailSkillId = null
  battleSkillDetailMode = 'simple'
  if (battleSkillDetailPopupCon) battleSkillDetailPopupCon.visible = false
  if (hadSelection) {
    refreshBattleSkillIconBar(true)
    refreshEnemySkillIconBar(true)
  }
}

function showBattleSkillDetailPopup(skill: BattleSkillPick): void {
  if (!root) return
  if (!battleSkillDetailPopupCon) {
    battleSkillDetailPopupCon = new Container()
    battleSkillDetailPopupCon.zIndex = 90
    root.addChild(battleSkillDetailPopupCon)
  }
  const con = battleSkillDetailPopupCon
  con.removeChildren().forEach((c) => c.destroy({ children: true }))

  const panelW = Math.max(360, Math.min(CANVAS_W - 24, getDebugCfg('itemInfoWidth')))
  const pad = 16
  const iconSize = 128
  const textX = pad + iconSize + 16
  const textW = panelW - textX - pad
  const mode = battleSkillDetailMode
  const shownDesc = mode === 'detailed' ? (skill.detailDesc ?? skill.desc) : skill.desc

  const title = new Text({
    text: skill.name,
    style: {
      fontSize: getDebugCfg('itemInfoNameFontSize'),
      fill: 0xffefc8,
      fontFamily: 'Arial',
      fontWeight: 'bold',
    },
  })
  const desc = new Text({
    text: shownDesc,
    style: {
      fontSize: getDebugCfg('itemInfoSimpleDescFontSize'),
      fill: 0xd7e2fa,
      fontFamily: 'Arial',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: textW,
      lineHeight: Math.round(getDebugCfg('itemInfoSimpleDescFontSize') * 1.25),
    },
  })

  const dividerY = pad + 44
  const descY = dividerY + 12
  const contentBottom = Math.max(pad + iconSize, descY + desc.height)
  const panelH = Math.max(getDebugCfg('itemInfoMinHSmall'), contentBottom + pad)
  const px = CANVAS_W / 2 - panelW / 2
  const py = getBattleInfoPanelCenterY() - panelH / 2

  const bg = new Graphics()
  bg.roundRect(px, py, panelW, panelH, Math.max(0, getDebugCfg('gridItemCornerRadius')))
  bg.fill({ color: 0x1e1e30, alpha: 0.97 })
  bg.stroke({ color: 0x5566aa, width: 2 })
  con.addChild(bg)

  const letter = new Text({
    text: skill.name.slice(0, 1),
    style: { fontSize: 56, fill: 0xf5f7ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  letter.anchor.set(0.5)
  letter.x = px + pad + iconSize / 2
  letter.y = py + pad + iconSize / 2 + 2
  con.addChild(letter)
  mountBattleSkillIconSprite(con, skill, px + pad + iconSize / 2, py + pad + iconSize / 2 + 2, iconSize, letter)

  title.x = px + textX
  title.y = py + pad + 2
  con.addChild(title)
  if (mode === 'detailed') {
    const tierText = new Text({
      text: battleSkillTierLabelCn(skill.tier),
      style: {
        fontSize: Math.max(16, Math.round(getDebugCfg('itemInfoNameFontSize') * 0.7)),
        fill: 0xfff3cf,
        fontFamily: 'Arial',
        fontWeight: 'bold',
      },
    })
    const badgeX = title.x + title.width + 12
    const badgeY = title.y + 2
    const badgeBg = new Graphics()
    badgeBg.roundRect(badgeX - 10, badgeY - 4, tierText.width + 20, tierText.height + 8, 8)
    badgeBg.fill({ color: battleSkillTierColor(skill.tier), alpha: 0.45 })
    con.addChild(badgeBg)
    tierText.x = badgeX
    tierText.y = badgeY
    con.addChild(tierText)
  }

  const divider = new Graphics()
  divider.moveTo(px + textX, py + dividerY)
  divider.lineTo(px + panelW - pad, py + dividerY)
  divider.stroke({ color: 0x5a628f, width: 1, alpha: 0.9 })
  con.addChild(divider)

  desc.x = px + textX
  desc.y = py + descY
  con.addChild(desc)

  battleSkillDetailSkillId = skill.id
  con.visible = true
}

function refreshBattleSkillIconBar(forceRebuild = false): void {
  if (!root || !playerZone) return
  if (!playerSkillIconBarCon) {
    playerSkillIconBarCon = new Container()
    playerSkillIconBarCon.zIndex = 75
    root.addChild(playerSkillIconBarCon)
  }
  const con = playerSkillIconBarCon
  if (battlePickedSkills.length <= 0) {
    con.visible = false
    battleSkillIconBarKey = ''
    return
  }

  const nextKey = battlePickedSkills.map((s) => `${s.id}:${s.tier}:${s.archetype}`).join('|')
  if (!forceRebuild && battleSkillIconBarKey === nextKey) {
    con.visible = true
    layoutBattleSkillIconBar()
    return
  }

  con.removeChildren().forEach((c) => c.destroy({ children: true }))
  battleSkillIconBarKey = nextKey

  const gap = -30
  const iconSize = 128
  const rowW = battlePickedSkills.length * iconSize + Math.max(0, battlePickedSkills.length - 1) * gap

  for (let i = 0; i < battlePickedSkills.length; i++) {
    const s = battlePickedSkills[i]!
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
      style: { fontSize: 32, fill: 0xf5f7ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    letter.anchor.set(0.5)
    letter.x = x
    letter.y = 0
    cell.addChild(letter)
    mountBattleSkillIconSprite(cell, s, x, 0, iconSize, letter)

    cell.on('pointerdown', (e) => {
      e.stopPropagation()
      handleBattleSkillIconTap(s)
    })

    con.addChild(cell)
  }

  layoutBattleSkillIconBar()
  con.visible = true
}

function refreshEnemySkillIconBar(forceRebuild = false): void {
  if (!root || !enemyZone) return
  if (!enemySkillIconBarCon) {
    enemySkillIconBarCon = new Container()
    enemySkillIconBarCon.zIndex = 75
    root.addChild(enemySkillIconBarCon)
  }
  const con = enemySkillIconBarCon
  if (enemyPickedSkills.length <= 0) {
    con.visible = false
    enemySkillIconBarKey = ''
    return
  }

  const nextKey = enemyPickedSkills.map((s) => `${s.id}:${s.tier}:${s.archetype}`).join('|')
  if (!forceRebuild && enemySkillIconBarKey === nextKey) {
    con.visible = true
    layoutEnemySkillIconBar()
    return
  }

  con.removeChildren().forEach((c) => c.destroy({ children: true }))
  enemySkillIconBarKey = nextKey
  const gap = -30
  const iconSize = 128
  const rowW = enemyPickedSkills.length * iconSize + Math.max(0, enemyPickedSkills.length - 1) * gap

  for (let i = 0; i < enemyPickedSkills.length; i++) {
    const s = enemyPickedSkills[i]!
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
      style: { fontSize: 32, fill: 0xf5f7ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    letter.anchor.set(0.5)
    letter.x = x
    letter.y = 0
    cell.addChild(letter)
    mountBattleSkillIconSprite(cell, s, x, 0, iconSize, letter)
    cell.on('pointerdown', (e) => {
      e.stopPropagation()
      handleBattleSkillIconTap(s)
    })
    con.addChild(cell)
  }

  con.visible = true
  layoutEnemySkillIconBar()
}

function ensureBattleStatEntry(sourceItemId: string, side: 'player' | 'enemy', defId = ''): ItemBattleStat {
  const prev = battleStatsByItemId.get(sourceItemId)
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
  battleStatsByItemId.set(sourceItemId, stat)
  return stat
}

function bootstrapBattleStatEntriesFromBoard(): void {
  if (!engine) return
  for (const it of engine.getBoardState().items) {
    ensureBattleStatEntry(it.id, it.side, it.defId)
  }
  damageStatsDirty = true
}

function refreshDamageStatsPanel(force = false): void {
  if (!damageStatsPanel || !damageStatsTitleText || !damageStatsRowsCon) return
  if (!force && !damageStatsDirty && battlePresentationMs - damageStatsLastRenderAtMs < 180) return
  const rows = Array.from(battleStatsByItemId.values())
    .filter((it) => it.side === damageStatsTab)
    .sort((a, b) => b.triggerCount - a.triggerCount || (b.damage + b.shield) - (a.damage + a.shield) || b.damage - a.damage)
  const maxStatValue = Math.max(1, ...rows.map((r) => Math.max(r.damage, r.shield)))

  damageStatsTitleText.text = engine?.isFinished() ? '战斗统计（已结束）' : '战斗统计（进行中）'
  damageStatsRowsCon.removeChildren().forEach((c) => c.destroy({ children: true }))

  if (rows.length <= 0) {
    const empty = new Text({
      text: '暂无统计',
      style: { fontSize: 24, fill: 0xbfd0ef, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    empty.anchor.set(0.5)
    empty.x = 0
    empty.y = 40
    damageStatsRowsCon.addChild(empty)
  } else {
    const rowW = 520
    const rowH = 88
    for (let i = 0; i < Math.min(6, rows.length); i++) {
      const stat = rows[i]!
      const y = -210 + i * (rowH + 10)
      const row = new Container()

      const rowBg = new Graphics()
      rowBg.roundRect(-rowW / 2, y, rowW, rowH, 12)
      rowBg.fill({ color: 0x1a2744, alpha: 0.88 })
      rowBg.stroke({ color: 0x5f79a8, width: 1, alpha: 0.9 })
      row.addChild(rowBg)

      const iconSide = 46
      const iconX = -rowW / 2 + 36
      const iconY = y + rowH / 2
      const iconFrame = new Graphics()
      iconFrame.roundRect(iconX - iconSide / 2, iconY - iconSide / 2, iconSide, iconSide, 9)
      iconFrame.fill({ color: 0x1d2a45, alpha: 1 })
      iconFrame.stroke({ color: getTierColor(stat.baseTier), width: 2, alpha: 0.98 })
      row.addChild(iconFrame)

      const iconUrl = getItemIconUrl(stat.defId)
      const icon = new Sprite(Texture.from(iconUrl))
      icon.anchor.set(0.5)
      icon.x = iconX
      icon.y = iconY
      icon.width = 42
      icon.height = 42
      row.addChild(icon)

      const name = new Text({
        text: `${i + 1}. ${stat.itemName} ${tierCn(stat.baseTier)}Lv${stat.level}`,
        style: { fontSize: 21, fill: 0xeaf2ff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      name.x = -rowW / 2 + 64
      name.y = y + 8
      row.addChild(name)

      const barW = 228
      const barH = 13
      const barX = -rowW / 2 + 64

      const triggerText = new Text({
        text: `触发 ${Math.max(0, Math.round(stat.triggerCount))}次`,
        style: { fontSize: 18, fill: 0xfff0bf, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      triggerText.x = barX + barW + 10
      triggerText.y = y + 10
      row.addChild(triggerText)

      const dmgBg = new Graphics()
      dmgBg.roundRect(barX, y + 42, barW, barH, 6)
      dmgBg.fill({ color: 0x2a3557, alpha: 1 })
      row.addChild(dmgBg)
      const dmgRatio = Math.min(1, Math.max(0, stat.damage / maxStatValue))
      const dmgFillW = stat.damage > 0 ? Math.max(2, Math.round(barW * dmgRatio)) : 0
      if (dmgFillW > 0) {
        const dmgFg = new Graphics()
        dmgFg.roundRect(barX, y + 42, dmgFillW, barH, 6)
        dmgFg.fill({ color: 0xe95d5d, alpha: 1 })
        row.addChild(dmgFg)
      }
      const dmgText = new Text({
        text: `伤害 ${Math.round(stat.damage)}`,
        style: { fontSize: 18, fill: 0xffd6d6, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      dmgText.x = barX + barW + 10
      dmgText.y = y + 34
      row.addChild(dmgText)

      const shBg = new Graphics()
      shBg.roundRect(barX, y + 62, barW, barH, 6)
      shBg.fill({ color: 0x2a3557, alpha: 1 })
      row.addChild(shBg)
      const shieldRatio = Math.min(1, Math.max(0, stat.shield / maxStatValue))
      const shieldFillW = stat.shield > 0 ? Math.max(2, Math.round(barW * shieldRatio)) : 0
      if (shieldFillW > 0) {
        const shFg = new Graphics()
        shFg.roundRect(barX, y + 62, shieldFillW, barH, 6)
        shFg.fill({ color: Math.round(getDebugCfg('battleColorShield')), alpha: 1 })
        row.addChild(shFg)
      }
      const shText = new Text({
        text: `护盾 ${Math.round(stat.shield)}`,
        style: { fontSize: 18, fill: 0xd8ebff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      shText.x = barX + barW + 10
      shText.y = y + 54
      row.addChild(shText)

      damageStatsRowsCon.addChild(row)
    }
  }

  damageStatsDirty = false
  damageStatsLastRenderAtMs = battlePresentationMs
}

function setDamageStatsPanelVisible(v: boolean): void {
  damageStatsPanelVisible = v
  if (damageStatsMask) damageStatsMask.visible = v
  if (damageStatsPanel) damageStatsPanel.visible = v
  if (statsBtnText) statsBtnText.text = v ? '关统计' : '统计'
  if (v) refreshDamageStatsPanel(true)
}

function makeDamageStatsButton(): Container {
  const con = new Container()
  const bg = new Graphics()
  const w = 116
  const h = TOP_ACTION_BTN_H
  bg.roundRect(-w / 2, -h / 2, w, h, 14)
  bg.stroke({ color: 0x96b2ff, width: 2, alpha: 0.95 })
  bg.fill({ color: 0x1f2945, alpha: 0.9 })
  con.addChild(bg)

  statsBtnText = new Text({
    text: '统计',
    style: { fontSize: 26, fill: 0xd9e4ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  statsBtnText.anchor.set(0.5)
  con.addChild(statsBtnText)

  con.x = 92
  con.y = getClampedTopActionBtnY()
  con.zIndex = 185
  con.eventMode = 'static'
  con.cursor = 'pointer'
  con.on('pointerdown', (e) => {
    e.stopPropagation()
    setDamageStatsPanelVisible(!damageStatsPanelVisible)
  })
  return con
}

function makeSettlementStatsButton(): Container {
  const con = makeDamageStatsButton()
  con.x = -220
  con.y = -160
  con.visible = false
  return con
}

function setDamageStatsTab(tab: 'player' | 'enemy'): void {
  damageStatsTab = tab
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
  updateBtn(damageStatsTabPlayerBtn, tab === 'player')
  updateBtn(damageStatsTabEnemyBtn, tab === 'enemy')
  damageStatsDirty = true
  refreshDamageStatsPanel(true)
}

function makeStatsTabButton(label: string, tab: 'player' | 'enemy'): Container {
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
    setDamageStatsTab(tab)
  })
  return con
}

function makeDamageStatsMask(): Graphics {
  const mask = new Graphics()
  mask.rect(0, 0, CANVAS_W, CANVAS_H)
  mask.fill({ color: 0x000000, alpha: 0.6 })
  mask.zIndex = 230
  mask.visible = false
  mask.eventMode = 'static'
  mask.cursor = 'pointer'
  mask.on('pointerdown', (e) => {
    e.stopPropagation()
    setDamageStatsPanelVisible(false)
  })
  return mask
}

function makeDamageStatsPanel(): Container {
  const panel = new Container()
  const panelW = DAMAGE_STATS_PANEL_W
  const panelH = DAMAGE_STATS_PANEL_H
  const bg = new Graphics()
  bg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 20)
  bg.fill({ color: 0x121a2f, alpha: 0.94 })
  bg.stroke({ color: 0x7ea6e3, width: 2, alpha: 0.95 })
  panel.addChild(bg)

  damageStatsTitleText = new Text({
    text: '战斗统计',
    style: { fontSize: 28, fill: 0xffefc8, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  damageStatsTitleText.anchor.set(0.5, 0)
  damageStatsTitleText.x = 0
  damageStatsTitleText.y = -panelH / 2 + 14
  panel.addChild(damageStatsTitleText)

  damageStatsTabPlayerBtn = makeStatsTabButton('我方', 'player')
  damageStatsTabPlayerBtn.x = -70
  damageStatsTabPlayerBtn.y = -panelH / 2 + 76
  panel.addChild(damageStatsTabPlayerBtn)

  damageStatsTabEnemyBtn = makeStatsTabButton('敌方', 'enemy')
  damageStatsTabEnemyBtn.x = 70
  damageStatsTabEnemyBtn.y = -panelH / 2 + 76
  panel.addChild(damageStatsTabEnemyBtn)

  damageStatsRowsCon = new Container()
  damageStatsRowsCon.y = 34
  panel.addChild(damageStatsRowsCon)

  panel.x = CANVAS_W / 2
  panel.y = getClampedStatsPanelY(panelH)
  panel.zIndex = 231
  panel.visible = false
  panel.eventMode = 'static'
  panel.on('pointerdown', (e) => e.stopPropagation())
  setDamageStatsTab('player')
  return panel
}

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
    if (PvpContext.isActive()) {
      PvpContext.onBattleComplete()
    } else {
      SceneManager.goto('shop')
    }
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

  const flash = pulseFlashPool.pop() ?? new Graphics()
  flash.clear()
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
      st.flash.clear()
      st.flash.alpha = 1
      if (pulseFlashPool.length < FX_POOL_MAX_PULSE_FLASHES) pulseFlashPool.push(st.flash)
      else st.flash.destroy()
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
  let spinDir = -1
  let lockFacingRad: number | null = null
  let forceLinearFlight = false
  const travelDx = to.x - from.x
  const travelDy = to.y - from.y
  if (useSprite && sourceDef) {
    const sprite = acquireProjectileSprite(from)
    const sourceSide = sourceItemId ? resolveItemSide(sourceItemId) : null
    const sourceItemScale = sourceSide === 'enemy' ? getEnemyAreaScale() : getBattleItemScale()
    const px = Math.max(8, Math.round(getDebugCfg('battleProjectileItemSizePx') * Math.max(0.25, sourceItemScale)))
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
      spinDir = travelDx >= 0 ? -1 : 1
    } else if (attackStyle.includes('直线')) {
      // 资源默认朝上；Pixi 0 弧度朝右，需补 +90° 对齐前向
      lockFacingRad = Math.atan2(to.y - from.y, to.x - from.x) + Math.PI / 2
      forceLinearFlight = true
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
  activeFx.push((dtMs) => {
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

function offsetFloatingNumberTarget(side: 'player' | 'enemy', to: { x: number; y: number }): { x: number; y: number } {
  if (side !== 'player') return to
  return { x: to.x, y: to.y - 50 }
}

function scheduleDamageVisual(delayMs: number, fn: () => void): void {
  if (delayMs <= 0) {
    fn()
    return
  }
  pendingDelayedDamageVisualCount += 1
  let elapsed = 0
  activeFx.push((dtMs) => {
    elapsed += dtMs
    if (elapsed >= delayMs) {
      pendingDelayedDamageVisualCount = Math.max(0, pendingDelayedDamageVisualCount - 1)
      fn()
      return false
    }
    return true
  })
}

function hasPendingDamageImpactPresentation(): boolean {
  return pendingDelayedDamageVisualCount > 0 || activeProjectileCount > 0
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

  settlementTrophyText = new Text({
    text: '🏆 0/10',
    style: { fontSize: 30, fill: 0xffe8b4, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 3 } },
  })
  settlementTrophyText.anchor.set(0.5)
  settlementTrophyText.y = 14
  panel.addChild(settlementTrophyText)

  settlementDescText = new Text({
    text: '准备下一步行动',
    style: { fontSize: 26, fill: 0xe7edf9, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 2 } },
  })
  settlementDescText.anchor.set(0.5)
  settlementDescText.y = 62
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
    if (settlementGameOver || settlementFinalVictory) {
      clearCurrentRunState()
      resetLifeState()
      resetWinTrophyState(getGameCfg().runRules?.trophyWinsToFinalVictory ?? 10)
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
  const trophyTarget = getGameCfg().runRules?.trophyWinsToFinalVictory ?? 10
  const trophyBefore = getWinTrophyState(trophyTarget)
  const winStreakBefore = getPlayerWinStreakState().count
  // PVP 模式：记录胜负，不修改 PVE 生命/奖杯
  if (PvpContext.isActive()) {
    PvpContext.recordBattleResult(winner, engine?.getResult()?.survivingDamage ?? 1)
  }
  const after = (!PvpContext.isActive() && winner === 'enemy') ? deductLife() : before
  const trophyAfter = (!PvpContext.isActive() && winner === 'player') ? addWinTrophy(trophyTarget) : trophyBefore
  if (!PvpContext.isActive()) {
    if (winner === 'player') setPlayerWinStreak(winStreakBefore + 1)
    else setPlayerWinStreak(0)
  }
  const delta = after.current - before.current
  settlementResolved = true
  // PVP 模式不触发 PVE 的游戏结束/最终胜利逻辑，防止意外调用 window.location.reload()
  settlementGameOver = !PvpContext.isActive() && winner === 'enemy' && after.current <= 0
  settlementFinalVictory = !PvpContext.isActive() && winner === 'player' && trophyAfter.wins >= trophyAfter.target

  if (!settlementTitleText || !settlementLifeText || !settlementTrophyText || !settlementDescText || !settlementActionLabel) return

  if (settlementFinalVictory) {
    settlementTitleText.text = '最终胜利'
    settlementTitleText.style.fill = 0xffe2a0
  } else if (winner === 'player') {
    settlementTitleText.text = '战斗胜利'
    settlementTitleText.style.fill = 0xffe2a0
  } else if (winner === 'enemy') {
    settlementTitleText.text = settlementGameOver ? '游戏失败' : '战斗失败'
    settlementTitleText.style.fill = 0xff8e8e
  } else {
    settlementTitleText.text = '平局'
    settlementTitleText.style.fill = 0xb9d5ff
  }

  if (PvpContext.isActive()) {
    const pvpSession = PvpContext.getSession()
    const myHp = pvpSession?.playerHps?.[pvpSession?.myIndex ?? -1] ?? 6
    const damage = winner === 'enemy' ? (result?.survivingDamage ?? 1) : 0
    const hpAfter = Math.max(0, myHp - damage)
    settlementLifeText.text = '⚔️ PVP 对战'
    settlementLifeText.style.fill = 0x99bbdd
    if (damage > 0) {
      settlementTrophyText.text = hpAfter <= 0
        ? `❤️ ${myHp} → 0  已淘汰`
        : `❤️ ${myHp} → ${hpAfter}  (-${damage})`
      settlementTrophyText.style.fill = hpAfter <= 0 ? 0xff4444 : 0xff9999
    } else {
      settlementTrophyText.text = `❤️ ${myHp} HP`
      settlementTrophyText.style.fill = 0x7fff7f
    }
  } else {
    settlementLifeText.text = delta < 0
      ? `❤️ ${before.current}/${before.max} -> ${after.current}/${after.max} (-1)`
      : `❤️ ${after.current}/${after.max}`
    settlementLifeText.style.fill = after.current <= 1 ? 0xff6a6a : 0xffd4d4
    settlementTrophyText.text = winner === 'player'
      ? `🏆 ${trophyBefore.wins}/${trophyBefore.target} -> ${trophyAfter.wins}/${trophyAfter.target} (+1)`
      : `🏆 ${trophyAfter.wins}/${trophyAfter.target}`
    settlementTrophyText.style.fill = trophyAfter.wins >= trophyAfter.target ? 0xffde79 : 0xffe8b4
  }

  if (settlementFinalVictory) {
    settlementDescText.text = `🏆 已达成${trophyAfter.target}场胜利，点击重新开始`
    settlementActionLabel.text = '重新开始'
  } else if (settlementGameOver) {
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
  const h = TOP_ACTION_BTN_H
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
  con.y = getClampedTopActionBtnY()
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

function getClampedTopActionBtnY(): number {
  const y = getDebugCfg('battleSpeedBtnY')
  const minY = TOP_ACTION_BTN_HALF_H + TOP_ACTION_BTN_SAFE_PAD
  const maxY = CANVAS_H - TOP_ACTION_BTN_HALF_H - TOP_ACTION_BTN_SAFE_PAD
  return Math.max(minY, Math.min(maxY, y))
}

function isBattleSpeedButtonEnabled(): boolean {
  return getDebugCfg('gameplayShowSpeedButton') >= 0.5
}

function getClampedStatsPanelY(panelH: number): number {
  const y = getDebugCfg('battleStatsPanelY')
  const halfH = panelH / 2
  const pad = 12
  const minY = halfH + pad
  const maxY = CANVAS_H - halfH - pad
  return Math.max(minY, Math.min(maxY, y))
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
  zone.setTierStarOffsetX(getDebugCfg('itemTierStarOffsetX'))
  zone.setTierStarOffsetY(getDebugCfg('itemTierStarOffsetY'))
  zone.setStatBadgeOffsetY(getDebugCfg('itemStatBadgeOffsetY'))
  zone.setAmmoBadgeOffsetY(6)
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
    enemyBossSprite.y = topY + enemyBossSprite.height - 50
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
  hideBattleSkillDetailPopup()
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
    battlePickedSkills = loadPickedSkillsFromShopState()
    settlementResolved = false
    settlementGameOver = false
    settlementFinalVictory = false
    settlementRevealAtMs = null
    battlePresentationMs = 0
    sourceNextDamageVisualAtMs.clear()
    battleSpeed = 1
    lastHudTickIndex = -1
    activeProjectileCount = 0
    activeFloatingNumberCount = 0
    pendingDelayedDamageVisualCount = 0
    droppedProjectileCount = 0
    droppedFloatingNumberCount = 0
    battleStatsByItemId.clear()
    battleStatLastTriggerTickByItemId.clear()
    damageStatsPanelVisible = false
    damageStatsDirty = false
    damageStatsLastRenderAtMs = 0
    root = new Container()
    root.sortableChildren = true
    stage.addChild(root)
    battleIntroElapsedMs = 0
    battleIntroDurationMs = Math.max(0, getDebugCfg('battleIntroFadeInMs'))
    skillBarIntroElapsedMs = 0
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

    // PVP 模式：在双方 HP 条左侧显示昵称
    if (PvpContext.isActive()) {
      const yEnemy = getDebugCfg('enemyHpBarY')
      const yPlayer = getDebugCfg('playerHpBarY')
      const barH = getDebugCfg('battleHpBarH')
      const baseBarW = getDebugCfg('battleHpBarWidth')

      const opponentName = PvpContext.getOpponentNickname() ?? '对手'
      const myName = PvpContext.getMyNickname() ?? '我'

      const makeNameTag = (name: string, barY: number, areaScale: number): Text => {
        const t = new Text({
          text: name,
          style: { fill: 0xffd86b, fontSize: 20, fontWeight: 'bold',
            stroke: { color: 0x000000, width: 3 } },
        })
        t.anchor.set(0, 0.5)
        t.x = (CANVAS_W - baseBarW * areaScale) / 2
        t.y = barY + (barH * areaScale) / 2
        t.zIndex = 41
        t.eventMode = 'none'
        return t
      }

      root.addChild(makeNameTag(opponentName, yEnemy, getEnemyHpBarScale()))
      root.addChild(makeNameTag(myName, yPlayer, 1))
    }

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
    skillBarIntroElapsedMs = resolveSkillBarIntroElapsedMs(snapshot)
    root.addChild(enemyZone)
    root.addChild(playerZone)
    refreshBattleSkillIconBar()
    refreshEnemySkillIconBar(true)

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

    if (isBattleSpeedButtonEnabled()) {
      speedBtn = makeSpeedButton()
      root.addChild(speedBtn)
    }

    statsBtn = makeDamageStatsButton()
    root.addChild(statsBtn)

    damageStatsMask = makeDamageStatsMask()
    root.addChild(damageStatsMask)

    backBtn = makeBackButton()
    backBtn.zIndex = 190
    backBtn.visible = false
    root.addChild(backBtn)

    settlementPanel = makeSettlementPanel()
    settlementStatsBtn = makeSettlementStatsButton()
    settlementPanel.addChild(settlementStatsBtn)
    root.addChild(settlementPanel)

    damageStatsPanel = makeDamageStatsPanel()
    root.addChild(damageStatsPanel)

    engine = new CombatEngine()
    setCombatRuntimeOverride({
      burnTickMs: getDebugCfg('gameplayBurnTickMs'),
      poisonTickMs: getDebugCfg('gameplayPoisonTickMs'),
      regenTickMs: getDebugCfg('gameplayRegenTickMs'),
      fatigueStartMs: getDebugCfg('gameplayFatigueStartMs'),
      fatigueTickMs: getDebugCfg('gameplayFatigueTickMs'),
      fatigueBaseValue: getDebugCfg('gameplayFatigueBaseValue'),
      fatigueDoubleEveryMs: getDebugCfg('gameplayFatigueDoubleEveryMs'),
      burnShieldFactor: getDebugCfg('gameplayBurnShieldFactor'),
      burnDecayPct: getDebugCfg('gameplayBurnDecayPct'),
      healCleansePct: getDebugCfg('gameplayHealCleansePct'),
      enemyDraftEnabled: getDebugCfg('enemyDraftEnabled'),
      enemyDraftSameArchetypeBias: getDebugCfg('enemyDraftSameArchetypeBias'),
    })
    engine.start(snapshot, {
      playerSkillIds: battlePickedSkills.map((s) => s.id),
      enemySkillIds: snapshot.pvpEnemySkillIds ?? [],
      enemyBackpackItemCount: snapshot.pvpEnemyBackpackItemCount,
      enemyGold: snapshot.pvpEnemyGold,
      enemyTrophyWins: snapshot.pvpEnemyTrophyWins,
    })
    enemyPickedSkills = engine.getEnemySkillIds()
      .map((id) => toBattleSkillPickById(id))
      .filter((v): v is BattleSkillPick => !!v)
    refreshEnemySkillIconBar(true)
    console.log(`[BattleScene] 进入战斗场景 day=${snapshot.day} entities=${snapshot.entities.length} cols=${snapshot.activeColCount}`)

    // PVP sync mode setup
    const pvpMode = PvpContext.getPvpMode()
    syncAStarted = pvpMode !== 'sync-a'  // false only for sync-a; true for all others (allows engine.update)

    if (pvpMode === 'sync-a') {
      // Notify PvpContext we're ready; start battle when all players are ready
      PvpContext.notifyBattleSyncReady(battleDay, () => {
        syncAStarted = true
        battleIntroElapsedMs = 0  // reset intro so it starts fresh
      })
    }

    const board = engine.getBoardState()
    bootstrapBattleStatEntriesFromBoard()
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
      hideBattleSkillDetailPopup()
    }
    stage.on('pointerdown', onStageTapHidePopup)

    offTriggerEvent = EventBus.on('battle:item_trigger', (e) => {
      addBattleItemTriggerCount(e.sourceItemId, e.side, Math.max(1, Math.round(e.triggerCount || 1)))
    })

    offFireEvent = EventBus.on('battle:item_fire', (e) => {
      tryPulseItem(e.sourceItemId, e.side)
      pushBattleLog(`开火 ${e.side === 'player' ? '我方' : '敌方'} ${e.itemId} x${e.multicast}`)
    })
    offDamageEvent = EventBus.on('battle:take_damage', (e) => {
      if (engine) {
        const boardNow = engine.getBoardState()
        drawHeroBars(boardNow.player, boardNow.enemy)
      }
      const side = e.targetSide ?? (e.targetId === 'hero_enemy' ? 'enemy' : 'player')
      const fromSide = e.sourceSide === 'player' || e.sourceSide === 'enemy'
        ? e.sourceSide
        : (side === 'enemy' ? 'player' : 'enemy')
      if (e.sourceItemId && e.sourceType !== 'system' && !e.sourceItemId.startsWith('status_') && e.sourceItemId !== 'fatigue') {
        const stat = ensureBattleStatEntry(e.sourceItemId, fromSide)
        stat.damage += Math.max(0, e.amount)
        damageStatsDirty = true
      }
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
      const damageShown = e.amount
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
      const textSize = getDebugCfg('battleTextFontSizeDamage')
      const floatingTarget = offsetFloatingNumberTarget(side, projectileTarget)
      const playDamageVisual = () => {
        if (e.sourceItemId.startsWith('status_') || isFatigueDamage) {
          if (enemyAttackToPlayer) triggerPlayerPortraitHitFx()
          spawnFloatingNumber(offsetFloatingNumberTarget(side, to), `-${damageShown}`, textColor, textSize)
          pushBattleLog(`结算 ${e.type} ${side === 'enemy' ? '敌方' : '我方'} ${damageShown}`)
          return
        }
        spawnProjectile(from, projectileTarget, bulletColor, () => {
          if (side === 'enemy') {
            triggerEnemyPortraitHitFx()
          } else if (enemyAttackToPlayer) {
            triggerPlayerPortraitHitFx()
          }
          spawnFloatingNumber(floatingTarget, `-${damageShown}`, textColor, textSize)
        }, e.sourceItemId)
        pushBattleLog(`伤害 ${side === 'enemy' ? '敌方' : '我方'} ${damageShown}`)
      }

      if (e.sourceItemId.startsWith('status_') || isFatigueDamage) {
        playDamageVisual()
      } else {
        const gapMs = Math.max(0, getDebugCfg('battleMulticastVisualGapMs'))
        const dueMs = Math.max(battlePresentationMs, sourceNextDamageVisualAtMs.get(e.sourceItemId) ?? battlePresentationMs)
        sourceNextDamageVisualAtMs.set(e.sourceItemId, dueMs + gapMs)
        scheduleDamageVisual(dueMs - battlePresentationMs, playDamageVisual)
      }
    })
    offShieldEvent = EventBus.on('battle:gain_shield', (e) => {
      const side = e.targetSide ?? (e.targetId === 'hero_enemy' ? 'enemy' : 'player')
      if (e.sourceItemId && !e.sourceItemId.startsWith('status_')) {
        const stat = ensureBattleStatEntry(e.sourceItemId, side)
        stat.shield += Math.max(0, e.amount)
        damageStatsDirty = true
      }
      const from = getItemCenterById(e.sourceItemId, side) ?? getHeroBarCenter(side)
      const to = getHeroBarCenter(side)
      const projectileTarget = side === 'enemy' ? (getEnemyPortraitHitPoint() ?? to) : to
      const shieldColor = getBattleFloatTextColor('shield')
      const shieldOrbColor = getBattleOrbColor('shield')
      const textSize = getDebugCfg('battleTextFontSizeDamage')
      const floatingTarget = offsetFloatingNumberTarget(side, projectileTarget)
      spawnProjectile(from, projectileTarget, shieldOrbColor, () => {
        if (side === 'enemy') {
          triggerEnemyPortraitHitFx()
        }
        spawnFloatingNumber(floatingTarget, `+${e.amount}`, shieldColor, textSize)
      }, e.sourceItemId)
      pushBattleLog(`护盾 ${side === 'enemy' ? '敌方' : '我方'} ${e.amount}`)
    })
    offHealEvent = EventBus.on('battle:heal', (e) => {
      const side = e.targetSide ?? (e.targetId === 'hero_enemy' ? 'enemy' : 'player')
      const from = e.sourceItemId.startsWith('status_') ? getHeroBarCenter(side) : (getItemCenterById(e.sourceItemId, side) ?? getHeroBarCenter(side))
      const to = getHeroBarCenter(side)
      const projectileTarget = side === 'enemy' ? (getEnemyPortraitHitPoint() ?? to) : to
      const textSize = getDebugCfg('battleTextFontSizeDamage')
      const floatingTarget = offsetFloatingNumberTarget(side, projectileTarget)
      if (e.sourceItemId.startsWith('status_')) {
        spawnFloatingNumber(offsetFloatingNumberTarget(side, to), `+${e.amount}`, getBattleFloatTextColor('regen'), textSize)
        pushBattleLog(`回复 ${side === 'enemy' ? '敌方' : '我方'} ${e.amount}`)
      } else {
        const regenColor = getBattleFloatTextColor('regen')
        const regenOrbColor = getBattleOrbColor('regen')
        spawnProjectile(from, projectileTarget, regenOrbColor, () => {
          if (side === 'enemy') {
            triggerEnemyPortraitHitFx()
          }
          spawnFloatingNumber(floatingTarget, `+${e.amount}`, regenColor, textSize)
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
    settlementTrophyText = null
    settlementDescText = null
    settlementActionBtn = null
    settlementActionLabel = null
    speedBtn = null
    speedBtnText = null
    statsBtn = null
    statsBtnText = null
    settlementStatsBtn = null
    damageStatsMask = null
    damageStatsPanel = null
    damageStatsTitleText = null
    damageStatsRowsCon = null
    damageStatsTabPlayerBtn = null
    damageStatsTabEnemyBtn = null
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
    playerSkillIconBarCon = null
    enemySkillIconBarCon = null
    battleSkillDetailPopupCon = null
    battleSkillDetailSkillId = null
    battlePickedSkills = []
    enemyPickedSkills = []
    fxLayer = null
    offTriggerEvent?.(); offTriggerEvent = null
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
    skillBarIntroElapsedMs = 0
    battleExitTransitionElapsedMs = 0
    battleExitTransitionDurationMs = 0
    settlementResolved = false
    settlementGameOver = false
    settlementFinalVictory = false
    settlementRevealAtMs = null
    battlePresentationMs = 0
    enteredSnapshot = null
    battleSpeed = 1
    activeProjectileCount = 0
    activeFloatingNumberCount = 0
    pendingDelayedDamageVisualCount = 0
    droppedProjectileCount = 0
    droppedFloatingNumberCount = 0
    activeFx.length = 0
    sourceNextDamageVisualAtMs.clear()
    for (const [, st] of pulseStates) {
      st.node?.visual.scale.set(1)
      if (st.flash.parent) st.flash.parent.removeChild(st.flash)
      st.flash.clear()
      st.flash.alpha = 1
      if (pulseFlashPool.length < FX_POOL_MAX_PULSE_FLASHES) pulseFlashPool.push(st.flash)
      else st.flash.destroy()
    }
    pulseStates.clear()
    pulseDedupAtMs.clear()
    projectileVariantCursor.clear()
    for (const [, fx] of statusFxByKey) {
      if (fx.root.parent) fx.root.parent.removeChild(fx.root)
      fx.root.destroy({ children: true })
    }
    statusFxByKey.clear()
    while (pulseFlashPool.length > 0) {
      pulseFlashPool.pop()?.destroy()
    }
    battleSkillIconBarKey = ''
    enemySkillIconBarKey = ''
    lastHudTickIndex = -1
    battleStatsByItemId.clear()
    battleStatLastTriggerTickByItemId.clear()
    damageStatsPanelVisible = false
    damageStatsDirty = false
    damageStatsLastRenderAtMs = 0
    // PVP sync cleanup
    syncAStarted = false
    engine = null
    console.log('[BattleScene] 离开战斗场景')
  },
  update(dt: number) {
    if (!engine || !enemyZone || !playerZone || !enemyCdOverlay || !playerCdOverlay || !enemyFreezeOverlay || !playerFreezeOverlay || !enemyStatusLayer || !playerStatusLayer) return
    if (tickBattleExitTransition(dt * 1000)) return
    const speed = Math.max(1, battleSpeed)
    const simDt = dt * speed
    const dtMs = simDt * 1000
    battlePresentationMs += dtMs
    skillBarIntroElapsedMs = Math.min(SKILL_BAR_INTRO_DURATION_MS, skillBarIntroElapsedMs + dtMs)
    const introDone = tickBattleIntro(simDt * 1000)
    if (introDone && syncAStarted) {
      engine.update(simDt)
    }
    const pendingDamageImpactFx = hasPendingDamageImpactPresentation()
    enemyPresentationVisible = !engine.isFinished() || pendingDamageImpactFx
    enemyZone.visible = enemyPresentationVisible
    if (enemyBossSprite) enemyBossSprite.visible = enemyPresentationVisible
    if (enemyBossFlashSprite) enemyBossFlashSprite.visible = enemyPresentationVisible
    const board = engine.getBoardState()
    const runtime = engine.getRuntimeState()
    const debugState = engine.getDebugState()
    const tickChanged = debugState.tickIndex !== lastHudTickIndex
    const pulseActive = pulseStates.size > 0
    const runtimeChargePercentById = new Map(runtime.map((it) => [it.id, it.chargePercent]))
    const activeCols = getDayActiveCols(battleDay)
    enemyZone.setActiveColCount(activeCols)
    playerZone.setActiveColCount(activeCols)
    applyZoneVisualStyle(enemyZone)
    applyZoneVisualStyle(playerZone)
    applyLayout(activeCols)
    layoutBattleSkillIconBar()
    layoutEnemySkillIconBar()

    const playerItems = board.items.filter((it) => it.side === 'player')
    const enemyItems = board.items.filter((it) => it.side === 'enemy')
    if (enemySkillIconBarCon) {
      enemySkillIconBarCon.visible = enemyPresentationVisible && enemyPickedSkills.length > 0
      if (!enemyPresentationVisible && battleSkillDetailPopupCon?.visible) hideBattleSkillDetailPopup()
    }
    const runtimeById = new Map(runtime.map((it) => [it.id, it]))
    if (tickChanged || pulseActive) {
      drawCooldownOverlay(playerZone, playerCdOverlay, playerItems, runtimeChargePercentById)
      drawCooldownOverlay(enemyZone, enemyCdOverlay, enemyItems, runtimeChargePercentById)
      updateZoneStatusFx(playerZone, 'player', playerItems, runtimeById, playerFreezeOverlay, playerStatusLayer)
      updateZoneStatusFx(enemyZone, 'enemy', enemyItems, runtimeById, enemyFreezeOverlay, enemyStatusLayer)
    }
    if (tickChanged) {
      updateRuntimeStatBadges(playerZone, playerItems, runtimeById)
      updateRuntimeStatBadges(enemyZone, enemyItems, runtimeById)
      drawHeroBars(board.player, board.enemy)
      lastHudTickIndex = debugState.tickIndex
    }

    tickPulseStates(dtMs)
    tickEnemyPortraitFx(dtMs)
    tickPlayerPortraitFx(dtMs)
    for (let i = activeFx.length - 1; i >= 0; i--) {
      if (!activeFx[i]!(dtMs)) activeFx.splice(i, 1)
    }

    if (statusText) {
      statusText.text = `phase:${engine.getPhase()} ticks:${debugState.tickIndex} fatigue:${debugState.inFatigue ? 'on' : 'off'} fx:${activeFx.length} p:${activeProjectileCount}/${FX_MAX_PROJECTILES} t:${activeFloatingNumberCount}/${FX_MAX_FLOATING_NUMBERS} drop:${droppedProjectileCount + droppedFloatingNumberCount}`
    }

    if (battleEndMask) {
      if (engine.isFinished()) {
        if (!settlementResolved) {
          if (!pendingDamageImpactFx) {
            const extraDelayMs = Math.max(0, getDebugCfg('battleSettlementDelayMs'))
            if (settlementRevealAtMs === null) settlementRevealAtMs = battlePresentationMs + extraDelayMs
            if (battlePresentationMs >= settlementRevealAtMs) resolveBattleSettlement()
          } else {
            settlementRevealAtMs = null
          }
        }
        battleEndMask.visible = settlementResolved
        if (battleEndMask.visible) {
          battleEndMask.clear()
          battleEndMask.rect(0, 0, CANVAS_W, CANVAS_H)
          battleEndMask.fill({ color: 0x000000, alpha: 0.45 })
        }
      } else if (battleEndMask.visible) {
        battleEndMask.visible = false
      }
    }

    if (speedBtn) {
      speedBtn.visible = !engine.isFinished()
      speedBtn.y = getClampedTopActionBtnY()
      if (speedBtnText) speedBtnText.text = `x${battleSpeed}`
    }

    if (statsBtn) {
      statsBtn.visible = !engine.isFinished()
      statsBtn.y = getClampedTopActionBtnY()
    }

    if (settlementStatsBtn) {
      settlementStatsBtn.visible = settlementResolved
    }

    if (damageStatsPanel?.visible) {
      refreshDamageStatsPanel()
    }
    if (damageStatsPanel) {
      damageStatsPanel.y = getClampedStatsPanelY(DAMAGE_STATS_PANEL_H)
    }

    if (backBtn) {
      backBtn.x = getDebugCfg('battleBackBtnX')
      backBtn.y = getDebugCfg('battleBackBtnY')
      backBtn.visible = false
    }

    if (settlementPanel) {
      settlementPanel.visible = settlementResolved
    }

    if (engine.isFinished() && !settlementResolved && damageStatsPanelVisible) {
      setDamageStatsPanelVisible(false)
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

    if (battleSkillDetailPopupCon?.visible) {
      const active = battlePickedSkills.find((s) => s.id === battleSkillDetailSkillId)
        ?? enemyPickedSkills.find((s) => s.id === battleSkillDetailSkillId)
      if (!active) hideBattleSkillDetailPopup()
    }
  },
}
