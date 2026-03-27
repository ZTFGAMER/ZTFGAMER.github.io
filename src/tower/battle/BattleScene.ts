import type { Scene } from '@/tower/core/SceneManager'
import { PvpContext } from '@/tower/pvp/PvpContext'
import { clearBattleSnapshot, getBattleSnapshot, setBattleSnapshot } from './BattleSnapshotStore'
import { clearBattleOutcome } from './BattleOutcomeStore'
import { consumeRequestedBattleReplay, hasBattleReplayRecord, requestBattleReplay, saveBattleReplayRecord } from './BattleReplayStore'
import { setCombatRuntimeOverride, type CombatBoardItem, type CombatItemRuntimeState } from './CombatEngine'
import { TowerDefenseEngine } from './TowerDefenseEngine'
import type { BattleEngineLike } from './BattleEngineTypes'
import { SceneManager } from '@/tower/core/SceneManager'
import { getApp, getRenderRuntimeFlags } from '@/tower/core/AppContext'
import {
  clearCurrentRunState,
  resetLifeState,
  resetWinTrophyState,
  SHOP_STATE_STORAGE_KEY,
} from '@/tower/core/RunState'
import { Assets, Container, Graphics, Sprite, Texture, Text } from 'pixi.js'
import { GridZone, CELL_SIZE, CELL_HEIGHT } from '@/tower/common/grid/GridZone'
import { GridSystem, type ItemSizeNorm as GridItemSizeNorm } from '@/tower/common/grid/GridSystem'
import { planAutoPack, type PackItem } from '@/tower/common/grid/AutoPack'
import { DragController } from '@/tower/common/grid/DragController'
import { getAllItems, getAllItemsRaw, getConfig as getGameCfg, getRunClassItemPoolIds } from '@/tower/core/DataLoader'
import { getConfig as getDebugCfg } from '@/tower/config/debugConfig'
import { normalizeSize, type ItemDef, type ItemSizeNorm } from '@/tower/common/items/ItemDef'
import { EventBus } from '@/tower/core/EventBus'
import { SellPopup, type ItemInfoCustomDisplay, type ItemInfoEnchantmentDisplay, type ItemInfoMode, type ItemInfoRuntimeOverride } from '@/tower/common/ui/SellPopup'
import { getItemEnchantmentDisplay, resolveItemEnchantmentEffectCn } from '@/tower/common/items/ItemEnchantment'
import { getBattleEffectColor, getBattleFloatTextColor, getBattleOrbColor, getClassColor, getShopUiColor } from '@/tower/config/colorPalette'
import { getHeroImageUrl, getItemIconUrl, getTowerBattleImageUrl } from '@/tower/core/AssetPath'
import { BattlePortraitFX } from './BattlePortraitFX'
import { BattleSkillUI } from './BattleSkillUI'
import { BattleDamageStats } from './BattleDamageStats'
import { BattleFXPool, type BattleFxPerfStats } from './BattleFXPool'
import { BattleTransition } from './BattleTransition'
import { BattleSettlement } from './BattleSettlement'
import { emitDiagEvent } from '@/perf/DiagRuntime'
import { CANVAS_W, CANVAS_H, BTN_RADIUS } from '@/tower/config/layoutConstants'
import { getAdjustedBattleZoneY, getAdjustedBattleZoneYInBattleOffset } from '@/tower/shop/ShopMathHelpers'
import { getTopLeftControlYOffset } from '@/tower/shop/ui/ShopSafeArea'
import { clearLoadedAssetUrls, getLoadedAssetUrls, hasAssetUrlLoaded, markAssetUrlUnloaded } from '@/tower/core/AssetRuntimeTracker'
import { clearMobileImageDownscaleRuntimeCache } from '@/tower/core/MobileImageDownscaleCache'
import type { TierKey } from '@/tower/shop/ShopManager'
import { getItemDefById, getPrimaryArchetype, parseTierName, tierStarLevelIndex, TIER_ORDER, toSkillArchetype } from '@/tower/shop/systems/ShopSynthesisLogic'
import { getCrossSynthesisMinStartingTier, pickCrossIdEvolveCandidates } from '@/tower/shop/panels/SynthesisPanel'
import { pickCrossSynthesisResultWithCycle } from '@/tower/shop/systems/ShopSynthesisController'
import { getArchetypeSortOrder } from '@/tower/shop/systems/ShopAutoPackManager'
import {
  TOWER_BATTLE_SKILL_DEFS,
  getTopArchetypesByTotalItemLevel,
  getTowerBattleSkillBuyCost as calcTowerBattleSkillBuyCost,
  getTowerBattleSkillCountByArchetype,
  pickTowerBattleSkillChoices,
  type TowerBattleSkillDef,
  type TowerSkillArchetype,
} from '@/tower/battle/TowerBattleSkillDefs'

const ENEMY_HERO_VISUAL_IDS = ['hero1', 'hero2', 'hero3', 'hero4', 'hero5', 'hero6', 'hero7', 'hero8', 'hero9', 'hero10'] as const
const HERO_VISUAL_IDS = [...ENEMY_HERO_VISUAL_IDS, 'warrior', 'archer', 'assassin'] as const
type HeroVisualId = typeof HERO_VISUAL_IDS[number]

type TowerZoneExpandStage = {
  rows: number
  cols: number
  price: number
}

const DEFAULT_TOWER_ZONE_EXPAND_STAGES: TowerZoneExpandStage[] = [
  { rows: 1, cols: 2, price: 2 },
  { rows: 2, cols: 2, price: 5 },
  { rows: 2, cols: 3, price: 10 },
  { rows: 3, cols: 3, price: 15 },
  { rows: 3, cols: 4, price: 20 },
  { rows: 3, cols: 5, price: 25 },
  { rows: 3, cols: 6, price: 30 },
]

const HERO_VISUAL_ALIAS: Record<string, HeroVisualId> = {
  swordsman: 'warrior',
  warrior: 'warrior',
  archer: 'archer',
  assassin: 'assassin',
}

const PLAYER_FOUR_HERO_PORTRAIT_STEMS = ['maga', 'archer', 'assassin', 'warrior'] as const
type PlayerFourHeroPortraitStem = typeof PLAYER_FOUR_HERO_PORTRAIT_STEMS[number]
type PlayerFourHeroPortraitSlot = 0 | 1 | 2 | 3
const PLAYER_FOUR_HERO_SLOT_STEMS_DEFAULT: PlayerFourHeroPortraitStem[] = ['warrior', 'maga', 'assassin', 'archer']
const PLAYER_FOUR_HERO_SWAP_MS = 1000

const TOWER_AUTO_START_ON_ENTER_FLAG_KEY = 'bigbazzar_tower_auto_start_on_enter_once'

const IS_MOBILE_DEVICE = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)

function randomHeroVisualId(): HeroVisualId {
  return ENEMY_HERO_VISUAL_IDS[Math.floor(nextBattleRandom('hero_visual_pick') * ENEMY_HERO_VISUAL_IDS.length)]!
}

function resolveHeroVisualId(raw: unknown): HeroVisualId | null {
  const key = String(raw ?? '').trim()
  if (!key) return null
  const mapped = HERO_VISUAL_ALIAS[key] ?? key
  return (HERO_VISUAL_IDS as readonly string[]).includes(mapped) ? mapped as HeroVisualId : null
}

function readPlayerHeroVisualId(): HeroVisualId {
  try {
    const raw = localStorage.getItem(SHOP_STATE_STORAGE_KEY)
    if (!raw) return 'warrior'
    const parsed = JSON.parse(raw) as { state?: { starterClass?: unknown }; starterClass?: unknown } | null
    const stateObj = (parsed && typeof parsed === 'object' && 'state' in parsed && parsed.state && typeof parsed.state === 'object')
      ? parsed.state
      : parsed
    const mapped = resolveHeroVisualId((stateObj as { starterClass?: unknown } | null | undefined)?.starterClass)
    if (mapped) return mapped
    return 'warrior'
  } catch {
    return 'warrior'
  }
}

function isBattlePlayerFourHeroPortraitEnabled(): boolean {
  return getDebugCfg('battlePlayerPortraitFourHeroEnabled') >= 0.5
}

async function loadPlayerFourHeroPortraitTextures(): Promise<void> {
  const jobs = playerFourHeroPortraitUnits.map(async (unit) => {
    let preferredTexture: Texture | null = null
    try {
      preferredTexture = await Assets.load<Texture>(getHeroImageUrl(`${unit.stem}b.png`))
    } catch {
      preferredTexture = null
    }
    if (!preferredTexture) {
      try {
        preferredTexture = await Assets.load<Texture>(getHeroImageUrl(`${unit.stem}.png`))
      } catch {
        preferredTexture = null
      }
    }
    unit.normalTexture = preferredTexture
    unit.hitTexture = preferredTexture
    if (preferredTexture) {
      unit.sprite.texture = preferredTexture
      unit.sprite.visible = true
    } else {
      unit.sprite.visible = false
    }
  })
  await Promise.all(jobs)
}

function setPlayerFourHeroPortraitUseHit(useHit: boolean): void {
  const hitStem = useHit ? (playerFourHeroHitStem ?? playerFourHeroSlotStems[0] ?? null) : null
  for (const unit of playerFourHeroPortraitUnits) {
    const applyHit = !!hitStem && unit.stem === hitStem
    const tex = applyHit ? (unit.hitTexture ?? unit.normalTexture) : unit.normalTexture
    if (tex) {
      unit.sprite.texture = tex
      unit.sprite.visible = true
    } else {
      unit.sprite.visible = false
    }
  }
}

function triggerPlayerPortraitHitFx(): void {
  portraitFX.triggerPlayerHit()
  if (!isBattlePlayerFourHeroPortraitEnabled()) return
  playerFourHeroHitStem = playerFourHeroSlotStems[0] ?? null
  playerFourHeroHitElapsedMs = 0
  setPlayerFourHeroPortraitUseHit(true)
}

function tickPlayerFourHeroPortrait(dtMs: number): void {
  if (playerFourHeroPortraitUnits.length <= 0) return
  const enabled = isBattlePlayerFourHeroPortraitEnabled()
  if (!enabled) {
    if (playerFourHeroPortraitLayer) playerFourHeroPortraitLayer.visible = false
    playerFourHeroHitElapsedMs = -1
    playerFourHeroHitStem = null
    setPlayerFourHeroPortraitUseHit(false)
    return
  }
  if (playerFourHeroPortraitLayer) playerFourHeroPortraitLayer.visible = true
  const loopMs = Math.max(1, getDebugCfg('battlePlayerPortraitIdleLoopMs'))
  const loopP = (battlePresentationMs % loopMs) / loopMs
  const loopWave = (Math.sin(loopP * Math.PI * 2 - Math.PI / 2) + 1) / 2
  const idleScaleMax = Math.max(1, getDebugCfg('battlePlayerPortraitIdleScaleMax'))
  const idleScale = 1 + (idleScaleMax - 1) * loopWave
  let hitScaleMul = 1
  if (playerFourHeroHitElapsedMs >= 0) {
    const hitMs = Math.max(1, getDebugCfg('battlePlayerPortraitHitPulseMs'))
    playerFourHeroHitElapsedMs += dtMs
    const p = Math.max(0, Math.min(1, playerFourHeroHitElapsedMs / hitMs))
    const pulse = Math.sin(Math.PI * p)
    const maxScale = Math.max(1, getDebugCfg('battlePlayerPortraitHitScaleMax'))
    hitScaleMul = 1 + (maxScale - 1) * pulse
    if (p >= 1) {
      playerFourHeroHitElapsedMs = -1
      playerFourHeroHitStem = null
      setPlayerFourHeroPortraitUseHit(false)
      hitScaleMul = 1
    }
  }
  for (const unit of playerFourHeroPortraitUnits) {
    const applyHit = playerFourHeroHitElapsedMs >= 0 && !!playerFourHeroHitStem && unit.stem === playerFourHeroHitStem
    unit.sprite.scale.set(unit.baseScale * idleScale * (applyHit ? hitScaleMul : 1))
  }
}

function getPlayerFourHeroPortraitSlotByStem(stems: PlayerFourHeroPortraitStem[]): Record<PlayerFourHeroPortraitStem, PlayerFourHeroPortraitSlot> {
  const out: Record<PlayerFourHeroPortraitStem, PlayerFourHeroPortraitSlot> = {
    maga: 1,
    archer: 3,
    assassin: 2,
    warrior: 0,
  }
  for (let i = 0; i < stems.length; i++) {
    const stem = stems[i]
    if (!stem) continue
    out[stem] = Math.max(0, Math.min(3, i)) as PlayerFourHeroPortraitSlot
  }
  return out
}

function getPlayerFourHeroPortraitAdjust(slot: PlayerFourHeroPortraitSlot): { offsetX: number; offsetY: number; scale: number } {
  if (slot === 0) {
    return {
      offsetX: getDebugCfg('battlePlayerPortraitFourHeroFrontOffsetX'),
      offsetY: getDebugCfg('battlePlayerPortraitFourHeroFrontOffsetY'),
      scale: getDebugCfg('battlePlayerPortraitFourHeroFrontScale'),
    }
  }
  if (slot === 1) {
    return {
      offsetX: getDebugCfg('battlePlayerPortraitFourHeroBack1OffsetX'),
      offsetY: getDebugCfg('battlePlayerPortraitFourHeroBack1OffsetY'),
      scale: getDebugCfg('battlePlayerPortraitFourHeroBack1Scale'),
    }
  }
  if (slot === 2) {
    return {
      offsetX: getDebugCfg('battlePlayerPortraitFourHeroBack2OffsetX'),
      offsetY: getDebugCfg('battlePlayerPortraitFourHeroBack2OffsetY'),
      scale: getDebugCfg('battlePlayerPortraitFourHeroBack2Scale'),
    }
  }
  return {
    offsetX: getDebugCfg('battlePlayerPortraitFourHeroBack3OffsetX'),
    offsetY: getDebugCfg('battlePlayerPortraitFourHeroBack3OffsetY'),
    scale: getDebugCfg('battlePlayerPortraitFourHeroBack3Scale'),
  }
}

function getPlayerFourHeroPortraitStyle(slot: PlayerFourHeroPortraitSlot): { alpha: number; grayMul: number } {
  if (slot === 0) return { alpha: 1, grayMul: 1 }
  const alpha = Math.max(0, Math.min(1, getDebugCfg('battlePlayerPortraitFourHeroBackAlpha')))
  const darken = Math.max(0, Math.min(1, getDebugCfg('battlePlayerPortraitFourHeroBackDarken')))
  return { alpha, grayMul: 1 - darken }
}

function getPlayerFourHeroItemTotalLevelsByStem(): Record<PlayerFourHeroPortraitStem, number> {
  const totals: Record<PlayerFourHeroPortraitStem, number> = { maga: 0, archer: 0, assassin: 0, warrior: 0 }
  if (!engine) return totals
  const items = engine.getBoardState().items
  for (const it of items) {
    if (it.side !== 'player') continue
    const def = getItemDefById(it.defId)
    if (!def) continue
    const arch = toSkillArchetype(getPrimaryArchetype(def.tags ?? ''))
    const stem = arch === 'warrior'
      ? 'warrior'
      : arch === 'archer'
        ? 'archer'
        : arch === 'assassin'
          ? 'assassin'
          : arch === 'mage'
            ? 'maga'
            : null
    if (!stem) continue
    const tier = parseTierName(it.tier) ?? 'Bronze'
    const starRaw = Number(String(it.tier ?? '').split('#')[1] ?? 1)
    const star: 1 | 2 = starRaw >= 2 ? 2 : 1
    totals[stem] += Math.max(1, tierStarLevelIndex(tier, star) + 1)
  }
  return totals
}

function updatePlayerFourHeroFrontSlotByPower(): void {
  if (playerFourHeroPortraitUnits.length <= 0 || playerFourHeroSwapAnim) return
  const slotByStem = getPlayerFourHeroPortraitSlotByStem(playerFourHeroSlotStems)
  const totals = getPlayerFourHeroItemTotalLevelsByStem()
  const maxTotal = Math.max(totals.maga, totals.archer, totals.assassin, totals.warrior)
  const topStems = (PLAYER_FOUR_HERO_PORTRAIT_STEMS as readonly PlayerFourHeroPortraitStem[]).filter((stem) => totals[stem] === maxTotal)
  if (topStems.length <= 0) return
  const currentFront = playerFourHeroSlotStems[0] ?? 'warrior'
  const desiredFront = topStems.includes(currentFront)
    ? currentFront
    : (topStems[Math.max(0, Math.min(topStems.length - 1, Math.floor(nextBattleRandom('player_four_hero_front_pick') * topStems.length)))] ?? currentFront)
  if (desiredFront === currentFront) return
  const desiredIdx = slotByStem[desiredFront]
  if (desiredIdx <= 0) return
  const next = [...playerFourHeroSlotStems]
  const oldFront = next[0]
  next[0] = desiredFront
  if (oldFront) next[desiredIdx] = oldFront
  playerFourHeroSwapAnim = {
    fromSlotByStem: slotByStem,
    toSlotByStem: getPlayerFourHeroPortraitSlotByStem(next),
    startAtMs: battlePresentationMs,
    durationMs: PLAYER_FOUR_HERO_SWAP_MS,
  }
  playerFourHeroSlotStems = next
}

function runRendererTextureGcNow(): void {
  const renderer = getApp().renderer as unknown as { gc?: { run?: () => void }; textureGC?: { run?: () => void } }
  if (renderer.gc?.run) {
    renderer.gc.run()
    return
  }
  renderer.textureGC?.run?.()
}

function hasAssetInPixiCache(url: string): boolean {
  if (!url) return false
  if (Assets.cache.has(url)) return true
  try {
    const absolute = new URL(url, window.location.href).toString()
    if (Assets.cache.has(absolute)) return true
    const pathname = new URL(absolute).pathname
    if (Assets.cache.has(pathname)) return true
  } catch {
    return false
  }
  return false
}

async function purgeMobileBattleAssetCacheIfEnabled(): Promise<void> {
  const cfg = getGameCfg().runRules?.battleCacheCleanup
  if (!IS_MOBILE_DEVICE) return
  if (!(cfg?.enabled ?? false)) return
  if (!(cfg?.purgeItemIconsOnBattleEnter ?? false)) return

  const urls = new Set<string>()
  for (const it of getAllItems()) {
    urls.add(getItemIconUrl(it.id))
  }
  if (urls.size <= 0) return

  const trackedUrls = new Set<string>(getLoadedAssetUrls())
  for (const url of urls) trackedUrls.add(url)

  const loadedUrls = Array.from(trackedUrls).filter((url) => hasAssetUrlLoaded(url) && hasAssetInPixiCache(url))

  clearMobileImageDownscaleRuntimeCache()

  if (loadedUrls.length > 0) {
    const jobs = loadedUrls.map((url) => Assets.unload(url).then(() => {
      markAssetUrlUnloaded(url)
    }).catch(() => undefined))
    await Promise.all(jobs)
  }
  clearLoadedAssetUrls()
  console.log(`[BattleScene] mobile battle assets purged: ${loadedUrls.length}, downscale cache reset`)
}

let root: Container | null = null
let towerDayText: Text | null = null
let towerDayTextBg: Graphics | null = null
let backBtn: Container | null = null
let continueBtn: Container | null = null
let continueBtnText: Text | null = null
let restartBtn: Container | null = null
let buyBtn: Container | null = null
let buyBtnBg: Graphics | null = null
let buyBtnPulseFrame: Graphics | null = null
let buyBtnText: Text | null = null
let sellDropZone: Graphics | null = null
let speedBtn: Container | null = null
let speedBtnText: Text | null = null
let battleEndMask: Graphics | null = null
let organizeBtn: Container | null = null
let topLeftFoldBtn: Container | null = null
let topLeftFoldBtnText: Text | null = null
let topLeftButtonsExpanded = false
let skillTestBtn: Container | null = null
let itemTestBtn: Container | null = null
let battleItemTestOverlay: Container | null = null
let battleSkillTestOverlay: Container | null = null
let heroHudG: Graphics | null = null
let enemyHpInfoCon: Container | null = null
let playerHpInfoCon: Container | null = null
let enemyZone: GridZone | null = null
let playerZone: GridZone | null = null
let enemyCdOverlay: Graphics | null = null
let playerCdOverlay: Graphics | null = null
let engine: BattleEngineLike | null = null
let offFireEvent: (() => void) | null = null
let offTriggerEvent: (() => void) | null = null
let offItemEffectTriggerEvent: (() => void) | null = null
let offDamageEvent: (() => void) | null = null
let offShieldEvent: (() => void) | null = null
let offHealEvent: (() => void) | null = null
let offStatusApplyEvent: (() => void) | null = null
let offStatusRemoveEvent: (() => void) | null = null
let offFatigueStartEvent: (() => void) | null = null
let offUnitDieEvent: (() => void) | null = null
let offItemDestroyEvent: (() => void) | null = null
let offBattleEndEvent: (() => void) | null = null
let offTowerEnemyAttackPrepareEvent: (() => void) | null = null
let onStageTapHidePopup: (() => void) | null = null
let itemInfoPopup: SellPopup | null = null
let selectedItemId: string | null = null
let selectedItemSide: 'player' | 'enemy' | null = null
let selectedItemInfoKey: string | null = null
let selectedItemInfoMode: ItemInfoMode = 'detailed'
let fatigueToastCon: Container | null = null
let fatigueToastBg: Graphics | null = null
let fatigueToastText: Text | null = null
let fatigueToastUntilMs = 0
let towerRemainBarG: Graphics | null = null
let towerRemainBarTextBg: Graphics | null = null
let towerRemainBarText: Text | null = null
let towerBottomFocusBg: Graphics | null = null
let towerGoldBadgeBg: Graphics | null = null
let towerGoldBadgeText: Text | null = null
const portraitFX = new BattlePortraitFX()
let enemyPresentationVisible = true
let battleSpeed = 1
let battleDay = 1
// PVP sync mode state
let syncAStarted = false        // Mode A: true after sync_start received
let earlyReportDone = false     // 本场结算面板已触发提前上报，防止重复调用
let enteredSnapshot: ReturnType<typeof getBattleSnapshot> = null
const transition = new BattleTransition()
const settlement = new BattleSettlement()
let settlementRevealAtMs: number | null = null
let battlePresentationMs = 0
let chargeUiElapsedSinceTickMs = 0
let ammoReloadUiElapsedSinceTickMs = 0
const damageStats = new BattleDamageStats()
const BATTLE_SPEED_STEPS = [1, 1.3, 1.8, 2.5] as const
const TOP_ACTION_BTN_H = 58
const TOP_ACTION_BTN_W = BTN_RADIUS * 2
const TOP_ACTION_BTN_HALF_H = TOP_ACTION_BTN_H / 2
const TOP_ACTION_BTN_SAFE_PAD = 8
const TOWER_BOTTOM_ACTION_BTN_W = Math.max(1, Math.round(BTN_RADIUS * 4 * 0.8))
const TOWER_BOTTOM_ACTION_BTN_H = Math.max(24, BTN_RADIUS * 2 - 30)
const TOWER_BOTTOM_ACTION_BTN_GAP = 24
const fxPool = new BattleFXPool()

function isTowerDefenseBattle(): boolean {
  return getGameCfg().towerDefenseRules?.enabled === true
}

function getDefaultBattleSpeed(): number {
  return 1
}

function percentile95(values: number[]): number {
  if (values.length <= 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.95)))
  return sorted[idx] ?? 0
}

function avg(values: number[]): number {
  if (values.length <= 0) return 0
  return values.reduce((s, v) => s + v, 0) / values.length
}

let battlePerfSampleElapsedMs = 0
const battleFrameDtMsSamples: number[] = []
const battleUpdateMsSamples: number[] = []
const battleEngineUpdateMsSamples: number[] = []
const battleRuntimeBuildMsSamples: number[] = []
const battleQueueConsumeMsSamples: number[] = []
const battleOverlayMsSamples: number[] = []
const battleStatusFxMsSamples: number[] = []
const battleLayoutMsSamples: number[] = []
const battleSyncRemovedMsSamples: number[] = []
const battleBadgesMsSamples: number[] = []
const battleHeroBarsMsSamples: number[] = []
const battlePortraitMsSamples: number[] = []
const battleSettlementMsSamples: number[] = []
const battleDamageStatsMsSamples: number[] = []
const battleMainResidualMsSamples: number[] = []
const battleFxTickMsSamples: number[] = []
const battleTickDeltaSamples: number[] = []
const battleQueuePendingRatioSamples: number[] = []
let battleRuntimeCallsAccum = 0
let battleRuntimeCacheHitsAccum = 0
let battleRuntimeFramesAccum = 0
let battleLastTickIndexForPerf = -1
let replayMode = false
let replayRandomSourceValues: number[] | null = null
let replayRandomCursor = 0
let battleRandomValues: number[] = []
let battleRandomTags: string[] = []
let battleEnemyHeroVisualId: HeroVisualId | null = null
let battleReplaySaved = false
let editableSystem: GridSystem | null = null
let editableDrag: DragController | null = null
let editableGold = 0
let editableMergeHoverTargetId: string | null = null
let draggingPlayerItemId: string | null = null
let draggingPlayerItemFirePoint: { x: number; y: number } | null = null
let towerWaveAdvanceInProgress = false
let towerNextWaveAutoStartAtMs: number | null = null
let towerWaveStartAtMs = 0
let towerWaveTriggerConsumed = false
let towerForceAutoStartOnEnter = false
let towerBattleBuyCount = 0
let towerBattleSkillBuyCount = 0
let towerBattleZoneExpandStep = 0
const towerBattleSkillPickCounts = new Map<string, number>()
let towerHasPlayerItemFiredOnce = false
let towerPreFirstAttackSpeedBoostActive = false
let towerPreFirstAttackOriginalSpeed: number | null = null
type BattleBuyOffer = { item: ItemDef; level: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8; tier: TierKey; star: 1 | 2 }
let pendingBattleBuyOffer: BattleBuyOffer | null = null
let buyBtnLastCanAfford: boolean | null = null
let buyBtnAffordPulseStartAtMs: number | null = null
let buyBtnAffordVisualState: boolean | null = null
let towerZoneExpandBtnBg: Graphics | null = null
let towerZoneExpandBtnPulseFrame: Graphics | null = null
let towerZoneExpandBtnText: Text | null = null
let towerZoneExpandBtnLastCanAfford: boolean | null = null
let towerZoneExpandBtnAffordPulseStartAtMs: number | null = null
let towerZoneExpandBtnAffordVisualState: boolean | null = null
let skillBuyBtn: Container | null = null
let skillBuyBtnBg: Graphics | null = null
let skillBuyBtnText: Text | null = null
let skillBuyBtnPulseFrame: Graphics | null = null
let skillBuyBtnLastCanAfford: boolean | null = null
let skillBuyBtnAffordPulseStartAtMs: number | null = null
let towerSkillDraftOverlay: Container | null = null
let towerSkillDisplayCon: Container | null = null
let towerSkillDisplayKey = ''
type PlayerFourHeroPortraitUnit = {
  stem: PlayerFourHeroPortraitStem
  sprite: Sprite
  normalTexture: Texture | null
  hitTexture: Texture | null
  baseScale: number
}
let playerFourHeroPortraitLayer: Container | null = null
const playerFourHeroPortraitUnits: PlayerFourHeroPortraitUnit[] = []
let playerFourHeroHitElapsedMs = -1
let playerFourHeroHitStem: PlayerFourHeroPortraitStem | null = null
let playerFourHeroSlotStems: PlayerFourHeroPortraitStem[] = [...PLAYER_FOUR_HERO_SLOT_STEMS_DEFAULT]
let playerFourHeroSwapAnim: {
  fromSlotByStem: Record<PlayerFourHeroPortraitStem, PlayerFourHeroPortraitSlot>
  toSlotByStem: Record<PlayerFourHeroPortraitStem, PlayerFourHeroPortraitSlot>
  startAtMs: number
  durationMs: number
} | null = null
const editableMeta = new Map<string, {
  defId: string
  size: GridItemSizeNorm
  tier: TierKey
  tierStar: 1 | 2
  quality: TierKey
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  permanentDamageBonus: number
}>()

type TowerEnemySpritePack = {
  root: Container
  shadow: Graphics
  body: Sprite
  flash: Sprite
  hpBg: Graphics
  hpFill: Graphics
}

type TowerEnemyAnimState = {
  moveOffsetMs: number
  prepareStartMs: number
  prepareUntilMs: number
  attackStartMs: number
  hitStartMs: number
  meleeDashStartMs: number
  meleeDashOutMs: number
  meleeDashBackMs: number
}

type TowerEnemyDeathFlyState = {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  rotSpeed: number
  bounced: boolean
  lastMs: number
  elapsedMs: number
  startScale: number
}

type TowerGoldDropFxState = {
  con: Container
  bornMs: number
  lifeMs: number
  risePx: number
  startY: number
}

let towerEnemyLayer: Container | null = null
let towerClassRangeLayer: Container | null = null
let towerGoldDropLayer: Container | null = null
const towerEnemyTexByIcon = new Map<string, Texture>()
const towerEnemySpriteById = new Map<string, TowerEnemySpritePack>()
const towerEnemyAnimStateById = new Map<string, TowerEnemyAnimState>()
const towerEnemyPosById = new Map<string, { x: number; y: number }>()
const towerEnemyHpAnchorById = new Map<string, { x: number; y: number; scale: number; distance: number; lane: number }>()
const towerEnemyDefIdByUnitId = new Map<string, string>()
const towerEnemyDeathFlyById = new Map<string, TowerEnemyDeathFlyState>()
const towerEnemyLastHitDirById = new Map<string, { x: number; y: number }>()
const towerGoldDropFxStates: TowerGoldDropFxState[] = []
const towerClassRangeLineByRole = new Map<'swordsman' | 'archer' | 'assassin' | 'mage', Graphics>()
let towerClassRangeLastLogSignature = ''

function resetBattleRandomSession(): void {
  replayRandomCursor = 0
  battleRandomValues = []
  battleRandomTags = []
}

function nextBattleRandom(tag: string): number {
  let value: number
  if (replayRandomSourceValues && replayRandomCursor < replayRandomSourceValues.length) {
    value = replayRandomSourceValues[replayRandomCursor++] ?? 0.5
  } else {
    value = Math.random()
  }
  if (!Number.isFinite(value)) value = 0.5
  if (value < 0) value = 0
  if (value >= 1) value = 0.999999
  battleRandomValues.push(value)
  battleRandomTags.push(tag)
  return value
}
let battleRuntimePerfSnapshot: Partial<BattleFxPerfStats> = {}

function clearBattleRuntimePerfSampleWindow(): void {
  battlePerfSampleElapsedMs = 0
  battleFrameDtMsSamples.length = 0
  battleUpdateMsSamples.length = 0
  battleEngineUpdateMsSamples.length = 0
  battleRuntimeBuildMsSamples.length = 0
  battleQueueConsumeMsSamples.length = 0
  battleOverlayMsSamples.length = 0
  battleStatusFxMsSamples.length = 0
  battleLayoutMsSamples.length = 0
  battleSyncRemovedMsSamples.length = 0
  battleBadgesMsSamples.length = 0
  battleHeroBarsMsSamples.length = 0
  battlePortraitMsSamples.length = 0
  battleSettlementMsSamples.length = 0
  battleDamageStatsMsSamples.length = 0
  battleMainResidualMsSamples.length = 0
  battleFxTickMsSamples.length = 0
  battleTickDeltaSamples.length = 0
  battleQueuePendingRatioSamples.length = 0
  battleRuntimeCallsAccum = 0
  battleRuntimeCacheHitsAccum = 0
  battleRuntimeFramesAccum = 0
}

function flushBattleRuntimePerfSampleWindow(): void {
  if (battleUpdateMsSamples.length <= 0) return
  const calls = battleRuntimeCallsAccum
  const hits = battleRuntimeCacheHitsAccum
  const frames = Math.max(1, battleRuntimeFramesAccum)
  battleRuntimePerfSnapshot = {
    battleFrameDtMsAvg: Math.round(avg(battleFrameDtMsSamples) * 100) / 100,
    battleFrameDtMsP95: Math.round(percentile95(battleFrameDtMsSamples) * 100) / 100,
    battleUpdateMsAvg: Math.round(avg(battleUpdateMsSamples) * 100) / 100,
    battleUpdateMsP95: Math.round(percentile95(battleUpdateMsSamples) * 100) / 100,
    battleUpdateMsMax: Math.round(Math.max(...battleUpdateMsSamples) * 100) / 100,
    battleEngineUpdateMsAvg: Math.round(avg(battleEngineUpdateMsSamples) * 100) / 100,
    battleEngineUpdateMsP95: Math.round(percentile95(battleEngineUpdateMsSamples) * 100) / 100,
    battleEngineUpdateMsMax: Math.round(Math.max(...battleEngineUpdateMsSamples) * 100) / 100,
    battleRuntimeBuildMsAvg: Math.round(avg(battleRuntimeBuildMsSamples) * 100) / 100,
    battleRuntimeBuildMsP95: Math.round(percentile95(battleRuntimeBuildMsSamples) * 100) / 100,
    battleRuntimeBuildMsMax: Math.round(Math.max(...battleRuntimeBuildMsSamples) * 100) / 100,
    battleQueueConsumeMsAvg: Math.round(avg(battleQueueConsumeMsSamples) * 100) / 100,
    battleQueueConsumeMsP95: Math.round(percentile95(battleQueueConsumeMsSamples) * 100) / 100,
    battleQueueConsumeMsMax: Math.round(Math.max(...battleQueueConsumeMsSamples) * 100) / 100,
    battleOverlayMsAvg: Math.round(avg(battleOverlayMsSamples) * 100) / 100,
    battleOverlayMsP95: Math.round(percentile95(battleOverlayMsSamples) * 100) / 100,
    battleOverlayMsMax: Math.round(Math.max(...battleOverlayMsSamples) * 100) / 100,
    battleStatusFxMsAvg: Math.round(avg(battleStatusFxMsSamples) * 100) / 100,
    battleStatusFxMsP95: Math.round(percentile95(battleStatusFxMsSamples) * 100) / 100,
    battleStatusFxMsMax: Math.round(Math.max(...battleStatusFxMsSamples) * 100) / 100,
    battleLayoutMsAvg: Math.round(avg(battleLayoutMsSamples) * 100) / 100,
    battleLayoutMsP95: Math.round(percentile95(battleLayoutMsSamples) * 100) / 100,
    battleLayoutMsMax: Math.round(Math.max(...battleLayoutMsSamples) * 100) / 100,
    battleSyncRemovedMsAvg: Math.round(avg(battleSyncRemovedMsSamples) * 100) / 100,
    battleSyncRemovedMsP95: Math.round(percentile95(battleSyncRemovedMsSamples) * 100) / 100,
    battleSyncRemovedMsMax: Math.round(Math.max(...battleSyncRemovedMsSamples) * 100) / 100,
    battleBadgesMsAvg: Math.round(avg(battleBadgesMsSamples) * 100) / 100,
    battleBadgesMsP95: Math.round(percentile95(battleBadgesMsSamples) * 100) / 100,
    battleBadgesMsMax: Math.round(Math.max(...battleBadgesMsSamples) * 100) / 100,
    battleHeroBarsMsAvg: Math.round(avg(battleHeroBarsMsSamples) * 100) / 100,
    battleHeroBarsMsP95: Math.round(percentile95(battleHeroBarsMsSamples) * 100) / 100,
    battleHeroBarsMsMax: Math.round(Math.max(...battleHeroBarsMsSamples) * 100) / 100,
    battlePortraitMsAvg: Math.round(avg(battlePortraitMsSamples) * 100) / 100,
    battlePortraitMsP95: Math.round(percentile95(battlePortraitMsSamples) * 100) / 100,
    battlePortraitMsMax: Math.round(Math.max(...battlePortraitMsSamples) * 100) / 100,
    battleSettlementMsAvg: Math.round(avg(battleSettlementMsSamples) * 100) / 100,
    battleSettlementMsP95: Math.round(percentile95(battleSettlementMsSamples) * 100) / 100,
    battleSettlementMsMax: Math.round(Math.max(...battleSettlementMsSamples) * 100) / 100,
    battleDamageStatsMsAvg: Math.round(avg(battleDamageStatsMsSamples) * 100) / 100,
    battleDamageStatsMsP95: Math.round(percentile95(battleDamageStatsMsSamples) * 100) / 100,
    battleDamageStatsMsMax: Math.round(Math.max(...battleDamageStatsMsSamples) * 100) / 100,
    battleMainResidualMsAvg: Math.round(avg(battleMainResidualMsSamples) * 100) / 100,
    battleMainResidualMsP95: Math.round(percentile95(battleMainResidualMsSamples) * 100) / 100,
    battleMainResidualMsMax: Math.round(Math.max(...battleMainResidualMsSamples) * 100) / 100,
    battleFxTickMsAvg: Math.round(avg(battleFxTickMsSamples) * 100) / 100,
    battleFxTickMsP95: Math.round(percentile95(battleFxTickMsSamples) * 100) / 100,
    battleFxTickMsMax: Math.round(Math.max(...battleFxTickMsSamples) * 100) / 100,
    battleTickDeltaAvg: Math.round(avg(battleTickDeltaSamples) * 100) / 100,
    battleTickDeltaMax: Math.round(Math.max(...battleTickDeltaSamples) * 100) / 100,
    battleQueuePendingRatioMax: Math.round(Math.max(...battleQueuePendingRatioSamples) * 1000) / 1000,
    battleRuntimeCallsPerFrame: Math.round((calls / frames) * 100) / 100,
    battleRuntimeCacheHitRate: calls > 0 ? Math.round((hits / calls) * 1000) / 1000 : 0,
  }
  clearBattleRuntimePerfSampleWindow()
}

function recordBattleRuntimePerfFrame(
  frameDtMs: number,
  frameUpdateMs: number,
  engineUpdateMs: number,
  runtimeBuildMs: number,
  queueConsumeMs: number,
  overlayMs: number,
  statusFxMs: number,
  layoutMs: number,
  syncRemovedMs: number,
  badgesMs: number,
  heroBarsMs: number,
  portraitMs: number,
  settlementMs: number,
  damageStatsMs: number,
  mainResidualMs: number,
  fxTickMs: number,
  tickDelta: number,
  queuePendingRatio: number,
  runtimeCallsDelta: number,
  runtimeCacheHitsDelta: number,
): void {
  battlePerfSampleElapsedMs += Math.max(0, frameDtMs)
  battleFrameDtMsSamples.push(Math.max(0, frameDtMs))
  battleUpdateMsSamples.push(Math.max(0, frameUpdateMs))
  battleEngineUpdateMsSamples.push(Math.max(0, engineUpdateMs))
  battleRuntimeBuildMsSamples.push(Math.max(0, runtimeBuildMs))
  battleQueueConsumeMsSamples.push(Math.max(0, queueConsumeMs))
  battleOverlayMsSamples.push(Math.max(0, overlayMs))
  battleStatusFxMsSamples.push(Math.max(0, statusFxMs))
  battleLayoutMsSamples.push(Math.max(0, layoutMs))
  battleSyncRemovedMsSamples.push(Math.max(0, syncRemovedMs))
  battleBadgesMsSamples.push(Math.max(0, badgesMs))
  battleHeroBarsMsSamples.push(Math.max(0, heroBarsMs))
  battlePortraitMsSamples.push(Math.max(0, portraitMs))
  battleSettlementMsSamples.push(Math.max(0, settlementMs))
  battleDamageStatsMsSamples.push(Math.max(0, damageStatsMs))
  battleMainResidualMsSamples.push(Math.max(0, mainResidualMs))
  battleFxTickMsSamples.push(Math.max(0, fxTickMs))
  battleTickDeltaSamples.push(Math.max(0, tickDelta))
  battleQueuePendingRatioSamples.push(Math.max(0, queuePendingRatio))
  battleRuntimeCallsAccum += Math.max(0, runtimeCallsDelta)
  battleRuntimeCacheHitsAccum += Math.max(0, runtimeCacheHitsDelta)
  battleRuntimeFramesAccum += 1
  if (battlePerfSampleElapsedMs >= 1000) flushBattleRuntimePerfSampleWindow()
}

export type { BattleFxPerfStats }
export function getBattleFxPerfStats(): BattleFxPerfStats {
  return {
    ...fxPool.getPerfStats(),
    ...battleRuntimePerfSnapshot,
  }
}
let enemyFreezeOverlay: Graphics | null = null
let playerFreezeOverlay: Graphics | null = null
let enemyStatusLayer: Container | null = null
let playerStatusLayer: Container | null = null
let lastHudTickIndex = -1
let skillUI: BattleSkillUI | null = null
const runtimeChargePercentByIdScratch = new Map<string, number>()
const runtimeAmmoReloadMsByIdScratch = new Map<string, number>()
const runtimeByIdScratch = new Map<string, CombatItemRuntimeState>()
const runtimeRangeBlockedByIdScratch = new Map<string, boolean>()
const playerItemsScratch: CombatBoardItem[] = []
const enemyItemsScratch: CombatBoardItem[] = []
const playerAliveIdsScratch = new Set<string>()
const enemyAliveIdsScratch = new Set<string>()
let playerRangeBlockedHintLayer: Container | null = null
const playerRangeBlockedHintTextById = new Map<string, Text>()
let enemyItemRoundStatLayer: Container | null = null
let playerItemRoundStatLayer: Container | null = null
const enemyItemRoundStatTextById = new Map<string, Text>()
const playerItemRoundStatTextById = new Map<string, Text>()
const enemyItemRoundDamageById = new Map<string, number>()
const playerItemRoundDamageById = new Map<string, number>()
const enemyItemRoundShieldById = new Map<string, number>()
const playerItemRoundShieldById = new Map<string, number>()
let monitorSampleElapsedMs = 0
let monitorHighStreak = 0
let monitorRecoverStreak = 0
let autoFxDegradeLevel = 0
let diagTickStallElapsedMs = 0
let diagTickStallLastTick = -1
let diagTickStallLastEmitAtMs = 0
let diagBattleSampleElapsedMs = 0
let fpsHudText: Text | null = null
let fpsSampleElapsedMs = 0
let fpsSampleFrames = 0
let fpsShown = 0
let topSafeYOffset = 0
let appliedActiveCols = -1
type PlayerZoneResizeTransition = {
  fromCols: number
  toCols: number
  fromRows: number
  toRows: number
  fromX: number
  toX: number
  fromY: number
  toY: number
  bgScaleFromX: number
  bgScaleToX: number
  bgScaleFromY: number
  bgScaleToY: number
  durationMs: number
  elapsedMs: number
}
let playerZoneResizeTransition: PlayerZoneResizeTransition | null = null
type TowerPlayerHpBarYOffsetTransition = {
  from: number
  to: number
  durationMs: number
  elapsedMs: number
}
let towerPlayerHpBarRowYOffset = 0
let towerPlayerHpBarRowYOffsetTransition: TowerPlayerHpBarYOffsetTransition | null = null

function updateFpsHud(dt: number): void {
  if (!fpsHudText) return
  const dtMs = Math.max(0, dt * 1000)
  fpsSampleElapsedMs += dtMs
  fpsSampleFrames += 1
  if (fpsSampleElapsedMs >= 250) {
    fpsShown = Math.max(0, Math.round((fpsSampleFrames * 1000) / Math.max(1, fpsSampleElapsedMs)))
    fpsSampleElapsedMs = 0
    fpsSampleFrames = 0
  }
  fpsHudText.text = `FPS ${fpsShown}`
  fpsHudText.x = CANVAS_W - fpsHudText.width - 10
  fpsHudText.y = 8 + topSafeYOffset
}
type QueuedFxTask = {
  run: () => void
  mergeKey?: string
  mergeWith?: (incoming: QueuedFxTask) => void
}
let visualFxQueue: QueuedFxTask[] = []
let visualFxMergeMap = new Map<string, QueuedFxTask>()
let visualFxDroppedCount = 0
const visualFrameSeenTicks = new Set<number>()
let visualFrameHasCatchUp = false
const isMobileBattleRuntime = /Mobi|Android|iPhone|iPad/i.test(
  typeof navigator !== 'undefined' ? navigator.userAgent : '',
)

function markVisualEventTick(): boolean {
  const tick = engine?.getDebugState().tickIndex ?? -1
  if (tick < 0) return visualFrameHasCatchUp
  if (!visualFrameSeenTicks.has(tick)) {
    if (visualFrameSeenTicks.size > 0) visualFrameHasCatchUp = true
    visualFrameSeenTicks.add(tick)
  }
  return visualFrameHasCatchUp
}

async function loadTowerEnemyTexture(icon: string): Promise<Texture | null> {
  const key = String(icon || '').trim()
  if (!key) return null
  const hit = towerEnemyTexByIcon.get(key)
  if (hit) return hit
  const candidates = [`${key}.png`]
  if (key === 'bossbattle') candidates.push('boss.png')
  for (const fileName of candidates) {
    try {
      const tex = await Assets.load<Texture>(getTowerBattleImageUrl(fileName))
      towerEnemyTexByIcon.set(key, tex)
      return tex
    } catch {
      continue
    }
  }
  return null
}

async function ensureTowerEnemyAssetWarmup(): Promise<void> {
  const cfg = getGameCfg().towerDefenseRules
  if (!cfg || cfg.enabled === false) return
  const jobs = (cfg.enemyDefs ?? []).map((it) => loadTowerEnemyTexture(it.icon))
  await Promise.all(jobs)
}

function pickTowerWaveForDay(
  waves: Array<{
    day: number
    spawnDurationMs?: number
    hpMultiplier?: number
    attackMultiplier?: number
    enemies: Array<{ id: string; count: number }>
  }>,
  day: number,
): {
  day: number
  spawnDurationMs?: number
  hpMultiplier?: number
  attackMultiplier?: number
  enemies: Array<{ id: string; count: number }>
} | null {
  if (waves.length <= 0) return null
  const sorted = [...waves].sort((a, b) => a.day - b.day)
  const safeDay = Math.max(1, Math.min(30, Math.round(day || 1)))
  const pickByDayAtMost = (targetDay: number): {
    day: number
    spawnDurationMs?: number
    hpMultiplier?: number
    attackMultiplier?: number
    enemies: Array<{ id: string; count: number }>
  } | null => {
    let oneHit = sorted[0] ?? null
    for (const one of sorted) {
      if (one.day <= targetDay) oneHit = one
      else break
    }
    return oneHit
  }
  return pickByDayAtMost(safeDay)
}

async function ensureTowerEnemyProjectileAssetWarmupForDay(day: number): Promise<void> {
  const cfg = getGameCfg().towerDefenseRules
  if (!cfg || cfg.enabled === false) return
  const wave = pickTowerWaveForDay(cfg.dayWaves ?? [], day)
  if (!wave) return

  const enemyDefById = new Map((cfg.enemyDefs ?? []).map((it) => [it.id, it]))
  const projectileIcons = new Set<string>()
  for (const one of wave.enemies ?? []) {
    if (Math.max(0, Math.round(one.count || 0)) <= 0) continue
    const def = enemyDefById.get(one.id)
    const icon = String(def?.projectileIcon || '').trim()
    if (!icon) continue
    projectileIcons.add(icon)
  }
  if (projectileIcons.size <= 0) return

  const jobs = Array.from(projectileIcons).map((icon) => Assets.load<Texture>(getTowerBattleImageUrl(`${icon}.png`)).catch(() => null))
  await Promise.all(jobs)
}

function ensureTowerEnemyAnimState(enemyUnitId: string): TowerEnemyAnimState {
  const prev = towerEnemyAnimStateById.get(enemyUnitId)
  if (prev) return prev
  const st: TowerEnemyAnimState = {
    moveOffsetMs: Math.round(nextBattleRandom('tower_enemy_move_offset') * 1000),
    prepareStartMs: -1,
    prepareUntilMs: -1,
    attackStartMs: -1,
    hitStartMs: -1,
    meleeDashStartMs: -1,
    meleeDashOutMs: 0,
    meleeDashBackMs: 0,
  }
  towerEnemyAnimStateById.set(enemyUnitId, st)
  return st
}

function triggerTowerEnemyAttackPrepare(enemyUnitId: string, prepareLeadMs: number): void {
  const st = ensureTowerEnemyAnimState(enemyUnitId)
  const leadMs = Math.max(120, Math.round(prepareLeadMs || 0))
  st.prepareStartMs = battlePresentationMs
  st.prepareUntilMs = battlePresentationMs + leadMs
}

function triggerTowerEnemyAttack(enemyUnitId: string): void {
  const st = ensureTowerEnemyAnimState(enemyUnitId)
  st.attackStartMs = battlePresentationMs
  st.prepareStartMs = -1
  st.prepareUntilMs = -1
}

function triggerTowerEnemyMeleeDash(enemyUnitId: string, outMs: number, backMs: number): void {
  const st = ensureTowerEnemyAnimState(enemyUnitId)
  st.meleeDashStartMs = battlePresentationMs
  st.meleeDashOutMs = Math.max(1, Math.round(outMs))
  st.meleeDashBackMs = Math.max(1, Math.round(backMs))
}

function triggerTowerEnemyDeathFly(enemyUnitId: string, lastHitDir?: { x: number; y: number } | null): void {
  if (towerEnemyDeathFlyById.has(enemyUnitId)) return
  const spritePack = towerEnemySpriteById.get(enemyUnitId)
  if (!spritePack) return
  const tdCfg = getGameCfg().towerDefenseRules
  const angleMin = Math.max(0, Number((tdCfg as { enemyDeathFlyAngleMinDeg?: number } | undefined)?.enemyDeathFlyAngleMinDeg) || 30)
  const angleMax = Math.max(angleMin, Number((tdCfg as { enemyDeathFlyAngleMaxDeg?: number } | undefined)?.enemyDeathFlyAngleMaxDeg) || 45)
  const speedMin = Math.max(1, Number((tdCfg as { enemyDeathFlySpeedMin?: number } | undefined)?.enemyDeathFlySpeedMin) || 760)
  const speedMax = Math.max(speedMin, Number((tdCfg as { enemyDeathFlySpeedMax?: number } | undefined)?.enemyDeathFlySpeedMax) || 980)
  const rotMinDeg = Math.max(0, Number((tdCfg as { enemyDeathFlyRotMinDegPerSec?: number } | undefined)?.enemyDeathFlyRotMinDegPerSec) || 240)
  const rotMaxDeg = Math.max(rotMinDeg, Number((tdCfg as { enemyDeathFlyRotMaxDegPerSec?: number } | undefined)?.enemyDeathFlyRotMaxDegPerSec) || 480)
  const side = nextBattleRandom('tower_enemy_death_side') < 0.5 ? -1 : 1
  const speed = speedMin + nextBattleRandom('tower_enemy_death_speed') * (speedMax - speedMin)
  let vx = 0
  let vy = 0
  if (lastHitDir && Number.isFinite(lastHitDir.x) && Number.isFinite(lastHitDir.y)) {
    const mag = Math.hypot(lastHitDir.x, lastHitDir.y)
    if (mag > 0.001) {
      vx = (lastHitDir.x / mag) * speed
      vy = (lastHitDir.y / mag) * speed
    }
  }
  if (Math.abs(vx) < 0.001 && Math.abs(vy) < 0.001) {
    const angleDeg = angleMin + nextBattleRandom('tower_enemy_death_angle') * (angleMax - angleMin)
    const angleRad = angleDeg * (Math.PI / 180)
    vx = side * Math.cos(angleRad) * speed
    vy = -Math.sin(angleRad) * speed
  }
  const rotSpeedDeg = rotMinDeg + nextBattleRandom('tower_enemy_death_rot') * (rotMaxDeg - rotMinDeg)
  const rotSpeed = rotSpeedDeg * (Math.PI / 180) * (side < 0 ? -1 : 1)
  towerEnemyDeathFlyById.set(enemyUnitId, {
    x: spritePack.root.x,
    y: spritePack.root.y,
    vx,
    vy,
    rot: spritePack.body.rotation,
    rotSpeed,
    bounced: false,
    lastMs: battlePresentationMs,
    elapsedMs: 0,
    startScale: Math.max(0.1, spritePack.root.scale.x || 1),
  })
}

function removeTowerEnemyImmediately(enemyUnitId: string): void {
  const spritePack = towerEnemySpriteById.get(enemyUnitId)
  if (spritePack) {
    spritePack.root.visible = false
    spritePack.flash.alpha = 0
  }
  towerEnemyDeathFlyById.delete(enemyUnitId)
  towerEnemyAnimStateById.delete(enemyUnitId)
  towerEnemyPosById.delete(enemyUnitId)
  towerEnemyHpAnchorById.delete(enemyUnitId)
  towerEnemyDefIdByUnitId.delete(enemyUnitId)
  towerEnemyLastHitDirById.delete(enemyUnitId)
}

function triggerTowerEnemyHit(enemyUnitId: string): void {
  const st = ensureTowerEnemyAnimState(enemyUnitId)
  st.hitStartMs = battlePresentationMs
}

function getTowerEnemyMoveWave(nowMs: number, offsetMs: number): { rotDeg: number; yOff: number; scaleMul: number } {
  const loopMs = 1333
  const p = ((nowMs + offsetMs) % loopMs) / loopMs
  const swing = Math.sin(p * Math.PI * 2)
  const arch = Math.abs(swing)
  return {
    rotDeg: 5 * swing,
    yOff: -8 * arch,
    scaleMul: 1 + 0.08 * arch,
  }
}

function getTowerEnemyFlyingMoveWave(nowMs: number, offsetMs: number): { rotDeg: number; yOff: number; scaleMul: number } {
  const loopMs = 1333
  const p = ((nowMs + offsetMs) % loopMs) / loopMs
  const swing = Math.sin(p * Math.PI * 2)
  return {
    rotDeg: 0,
    yOff: -14 * swing,
    scaleMul: 1,
  }
}

function syncTowerEnemyPresentation(activeCols: number): void {
  if (!towerEnemyLayer || !engine?.getTowerEnemyUnits) return
  const cfg = getGameCfg().towerDefenseRules
  if (!cfg || cfg.enabled === false) {
    towerEnemyPosById.clear()
    towerEnemyDefIdByUnitId.clear()
    for (const one of towerEnemySpriteById.values()) one.root.visible = false
    return
  }
  const farY = Number(cfg.farY) || 320
  const nearY = Number(cfg.nearY) || 940
  const farScale = Math.max(0.1, Number(cfg.farScale) || 0.55)
  const nearScale = Math.max(0.1, Number(cfg.nearScale) || 1)
  const farAlpha = Math.max(0, Math.min(1, Number(cfg.farAlpha) || 0.35))
  const fullAlphaDistance = Math.max(0, Number(cfg.fullAlphaDistance ?? cfg.opaqueWithinDistance) || 220)
  const maxDistance = Math.max(1, Number(cfg.levelDistance) || 1000)
  const units = engine.getTowerEnemyUnits()
  const lanes = Math.max(1, Math.round(cfg.spawnLanes || activeCols || 5))
  const farWidthRatio = Math.max(0.1, Math.min(1.2, Number(cfg.roadFarWidthRatio) || 0.5))
  const nearWidthRatio = Math.max(0.2, Math.min(1.4, Number(cfg.roadNearWidthRatio) || 1))
  const roadFarCenterX = Number(cfg.roadFarCenterX) || CANVAS_W / 2
  const roadNearCenterX = Number(cfg.roadNearCenterX) || CANVAS_W / 2
  const enemyDefById = new Map((cfg.enemyDefs ?? []).map((it) => [it.id, it]))
  const defaultEnemyHpBarYOffsetRaw = Number(cfg.enemyHpBarYOffset)
  const defaultEnemyHpBarYOffset = Number.isFinite(defaultEnemyHpBarYOffsetRaw) ? defaultEnemyHpBarYOffsetRaw : -107
  const defaultEnemyHpBarScaleRaw = Number(cfg.enemyHpBarScale)
  const defaultEnemyHpBarScale = Math.max(0.2, Number.isFinite(defaultEnemyHpBarScaleRaw) ? defaultEnemyHpBarScaleRaw : 1)
  const defaultShadowYOffsetRaw = Number(cfg.enemyShadowYOffset)
  const defaultShadowYOffset = Number.isFinite(defaultShadowYOffsetRaw) ? defaultShadowYOffsetRaw : -10
  const defaultShadowScaleRaw = Number(cfg.enemyShadowScale)
  const defaultShadowScale = Math.max(0.2, Number.isFinite(defaultShadowScaleRaw) ? defaultShadowScaleRaw : 0.7)
  const aliveIds = new Set<string>()
  towerEnemyPosById.clear()

  for (const one of units) {
    aliveIds.add(one.id)
    towerEnemyDefIdByUnitId.set(one.id, one.enemyId)
    const unitDef = enemyDefById.get(one.enemyId)
    const unitShadowYOffsetRaw = Number(unitDef?.enemyShadowYOffset)
    const unitShadowYOffset = Number.isFinite(unitShadowYOffsetRaw) ? unitShadowYOffsetRaw : defaultShadowYOffset
    const unitShadowScaleRaw = Number(unitDef?.enemyShadowScale)
    const unitShadowScale = Math.max(0.2, Number.isFinite(unitShadowScaleRaw) ? unitShadowScaleRaw : defaultShadowScale)
    const unitHpBarYOffsetRaw = Number(unitDef?.enemyHpBarYOffset)
    const unitHpBarYOffset = Number.isFinite(unitHpBarYOffsetRaw) ? unitHpBarYOffsetRaw : defaultEnemyHpBarYOffset
    const unitHpBarScaleRaw = Number(unitDef?.enemyHpBarScale)
    const unitHpBarScale = Math.max(0.2, Number.isFinite(unitHpBarScaleRaw) ? unitHpBarScaleRaw : defaultEnemyHpBarScale)
    const flyingLiftNearRaw = Number(cfg.flyingEnemyLiftNear)
    const flyingLiftNear = Math.max(0, Number.isFinite(flyingLiftNearRaw) ? flyingLiftNearRaw : 0)
    let spritePack = towerEnemySpriteById.get(one.id)
    if (!spritePack) {
      const rootNode = new Container()
      rootNode.zIndex = 0
      const shadow = new Graphics()
      shadow.ellipse(0, 0, 37, 12)
      shadow.fill({ color: 0x000000, alpha: 1 })
      shadow.alpha = 0.45
      shadow.scale.set(unitShadowScale)
      shadow.y = unitShadowYOffset
      const body = new Sprite(Texture.WHITE)
      body.anchor.set(0.5, 1)
      const flash = new Sprite(Texture.WHITE)
      flash.anchor.set(0.5, 1)
      flash.tint = 0xffffff
      flash.blendMode = 'add'
      flash.alpha = 0
      const hpBg = new Graphics()
      const hpFill = new Graphics()
      rootNode.addChild(shadow)
      rootNode.addChild(body)
      rootNode.addChild(flash)
      rootNode.addChild(hpBg)
      rootNode.addChild(hpFill)
      towerEnemyLayer.addChild(rootNode)
      spritePack = { root: rootNode, shadow, body, flash, hpBg, hpFill }
      towerEnemySpriteById.set(one.id, spritePack)
      ensureTowerEnemyAnimState(one.id)
      void loadTowerEnemyTexture(one.icon).then((tex) => {
        if (!tex) return
        const hitPack = towerEnemySpriteById.get(one.id)
        if (!hitPack) return
        hitPack.body.texture = tex
        hitPack.flash.texture = tex
      })
    }
    const laneP = ((one.lane % lanes) + lanes) % lanes
    const progress = Math.max(0, Math.min(1, 1 - one.distance / Math.max(1, one.maxDistance || maxDistance)))
    const laneNorm = lanes <= 1 ? 0 : (laneP / Math.max(1, lanes - 1)) * 2 - 1
    const roadWidthRatio = farWidthRatio + (nearWidthRatio - farWidthRatio) * progress
    const roadCenterX = roadFarCenterX + (roadNearCenterX - roadFarCenterX) * progress
    const laneX = roadCenterX + laneNorm * (CANVAS_W * roadWidthRatio * 0.5)
    const y = farY + (nearY - farY) * progress
    const scale = farScale + (nearScale - farScale) * progress
    const alphaProgress = one.distance <= fullAlphaDistance
      ? 1
      : Math.max(0, Math.min(1, 1 - (one.distance - fullAlphaDistance) / Math.max(1, maxDistance - fullAlphaDistance)))
    const alpha = farAlpha + (1 - farAlpha) * alphaProgress

    const anim = ensureTowerEnemyAnimState(one.id)
    const isFlying = (one as { isFlying?: boolean }).isFlying === true
    const isMoving = (one as { isMoving?: boolean }).isMoving === true
    const prevHpAnchor = towerEnemyHpAnchorById.get(one.id)
    const shouldRefreshHpAnchor = !prevHpAnchor
      || Math.abs((one.distance ?? 0) - prevHpAnchor.distance) > 0.05
      || Math.round(one.lane ?? 0) !== prevHpAnchor.lane
    const hpAnchor = shouldRefreshHpAnchor
      ? { x: laneX, y, scale, distance: one.distance ?? 0, lane: Math.round(one.lane ?? 0) }
      : prevHpAnchor
    towerEnemyHpAnchorById.set(one.id, hpAnchor)
    const useStandAnim = !isMoving
    const moveWave = useStandAnim
      ? { rotDeg: 0, yOff: 0, scaleMul: 1 }
      : (isFlying
        ? getTowerEnemyFlyingMoveWave(battlePresentationMs, anim.moveOffsetMs)
        : getTowerEnemyMoveWave(battlePresentationMs, anim.moveOffsetMs))
    let animScaleMul = moveWave.scaleMul
    let animYOff = moveWave.yOff
    let animRotRad = moveWave.rotDeg * (Math.PI / 180)
    let animXOff = 0
    let flyingDiveP = 0
    let preparePulse = 0

    if (useStandAnim) {
      const standP = (battlePresentationMs % 1000) / 1000
      const standWave = (Math.sin(standP * Math.PI * 2 - Math.PI / 2) + 1) * 0.5
      animScaleMul *= 1 + 0.03 * standWave
      animRotRad = 0
    }

    if (anim.prepareUntilMs > battlePresentationMs) {
      const prepareP = Math.max(0, (battlePresentationMs - anim.prepareStartMs) / 300)
      preparePulse = (Math.sin(prepareP * Math.PI * 2) + 1) * 0.5
      animScaleMul *= 1 + 0.12 * preparePulse
      animYOff -= 2 * preparePulse
      animRotRad = 0
    }

    if (anim.attackStartMs >= 0) {
      const attackElapsed = battlePresentationMs - anim.attackStartMs
      if (attackElapsed < 240) {
        if (attackElapsed < 80) {
          const p = attackElapsed / 80
          animScaleMul *= 1 + 0.25 * p
          animYOff -= 10 * p
        } else if (attackElapsed < 150) {
          animScaleMul *= 1.25
          animYOff -= 10
        } else {
          const p = (attackElapsed - 150) / 90
          animScaleMul *= 1.25 - 0.25 * p
          animYOff -= 10 * (1 - p)
        }
        animRotRad = 0
      } else {
        anim.attackStartMs = -1
      }
    }

    if (anim.meleeDashStartMs >= 0) {
      const dashElapsed = battlePresentationMs - anim.meleeDashStartMs
      const dashOutMs = Math.max(1, anim.meleeDashOutMs)
      const dashBackMs = Math.max(1, anim.meleeDashBackMs)
      const dashTotalMs = dashOutMs + dashBackMs
      if (dashElapsed < dashTotalMs) {
        const towardP = dashElapsed < dashOutMs
          ? (dashElapsed / dashOutMs)
          : Math.max(0, 1 - (dashElapsed - dashOutMs) / dashBackMs)
        const playerHit = portraitFX.getPlayerHitPoint() ?? getHeroBarCenter('player')
        const dx = playerHit.x - laneX
        const dy = playerHit.y - y
        const dist = Math.max(1, Math.hypot(dx, dy))
        const lungePx = Math.min(160, dist * 0.4)
        animXOff += (dx / dist) * lungePx * towardP
        animYOff += (dy / dist) * lungePx * towardP
        if (isFlying) flyingDiveP = Math.max(flyingDiveP, towardP)
        animRotRad = 0
      } else {
        anim.meleeDashStartMs = -1
      }
    }

    let hitScaleMul = 1
    let hitScaleMaxMul = Number.POSITIVE_INFINITY
    if (anim.hitStartMs >= 0) {
      const hitElapsed = battlePresentationMs - anim.hitStartMs
      const hitMs = Math.max(1, Number((cfg as { enemyHitPopMs?: number }).enemyHitPopMs) || getDebugCfg('battleEnemyPortraitHitPulseMs'))
      const hitP = Math.max(0, Math.min(1, hitElapsed / hitMs))
      const maxScale = Math.max(1, Number((cfg as { enemyHitPopScale?: number }).enemyHitPopScale) || getDebugCfg('battleEnemyPortraitHitScaleMax'))
      hitScaleMaxMul = maxScale
      const canPlayHitShake = anim.attackStartMs < 0 && anim.meleeDashStartMs < 0
      if (canPlayHitShake) {
        const popP = hitP < 0.5
          ? (hitP / 0.5)
          : Math.max(0, 1 - (hitP - 0.5) / 0.5)
        hitScaleMul = 1 + (maxScale - 1) * popP
      }
      const flashMs = Math.max(1, getDebugCfg('battleEnemyPortraitFlashMs'))
      const flashP = Math.max(0, Math.min(1, hitElapsed / flashMs))
      spritePack.flash.visible = true
      spritePack.flash.tint = Math.max(0, Math.min(0xffffff, Math.round(getDebugCfg('battleEnemyPortraitFlashColor'))))
      spritePack.flash.alpha = Math.max(0, getDebugCfg('battleEnemyPortraitFlashAlpha') * (1 - flashP)) * alpha
      if (hitP >= 1) {
        anim.hitStartMs = -1
        spritePack.flash.alpha = 0
      }
    } else {
      spritePack.flash.alpha = 0
    }

    let finalAnimScaleMul = animScaleMul * hitScaleMul
    if (Number.isFinite(hitScaleMaxMul)) {
      finalAnimScaleMul = Math.min(finalAnimScaleMul, hitScaleMaxMul)
    }
    const finalScale = scale * finalAnimScaleMul
    const flyingLift = isFlying ? flyingLiftNear : 0
    const effectiveFlyingLift = flyingLift * (1 - flyingDiveP)
    spritePack.root.visible = true
    spritePack.body.anchor.set(0.5, 1)
    spritePack.flash.anchor.set(0.5, 1)
    spritePack.body.y = -effectiveFlyingLift
    spritePack.flash.y = -effectiveFlyingLift
    spritePack.root.x = laneX + animXOff
    spritePack.root.y = y + animYOff
    spritePack.root.scale.set(finalScale)
    spritePack.body.rotation = animRotRad
    spritePack.flash.rotation = animRotRad
    spritePack.root.alpha = alpha
    const isFrontRow = (one as { isBlockedByFront?: boolean }).isBlockedByFront !== true
    const useDashDepthSort = isFrontRow && anim.meleeDashStartMs >= 0
    spritePack.root.zIndex = Math.round((useDashDepthSort ? (y + animYOff) : y) * 1000)
    const showShadow = !isFlying
    spritePack.shadow.visible = showShadow
    if (showShadow) {
      const animScaleSafe = Math.max(0.01, finalAnimScaleMul)
      const shadowSizeByLift = Math.max(0.72, Math.min(1.28, 1 + animYOff * 0.012))
      const shadowWorldYOffset = scale * unitShadowYOffset
      spritePack.shadow.x = -animXOff / Math.max(0.01, finalScale)
      spritePack.shadow.y = (shadowWorldYOffset - animYOff) / Math.max(0.01, finalScale)
      spritePack.shadow.scale.set((unitShadowScale * shadowSizeByLift) / animScaleSafe)
      spritePack.shadow.rotation = 0
      spritePack.shadow.alpha = 0.4 * alpha
    }
    const hpRatio = one.maxHp > 0 ? Math.max(0, Math.min(1, one.hp / one.maxHp)) : 0
    const showHpBar = one.hp > 0 && one.maxHp > 0 && one.hp < one.maxHp
    if (showHpBar) {
      const barW = 52 * unitHpBarScale
      const barH = 8
      const radius = 4
      const desiredBarWorldX = hpAnchor.x
      const desiredBarWorldY = hpAnchor.y + unitHpBarYOffset * hpAnchor.scale - (isFlying ? flyingLift : 0) * hpAnchor.scale
      const desiredBarWorldXRounded = Math.round(desiredBarWorldX)
      const desiredBarWorldYRounded = Math.round(desiredBarWorldY)
      // 注意：血条几何坐标要用基础远近 scale 反推，不能用 finalScale（含受击/动作放缩），
      // 否则受击时会产生明显上下抖动。
      const localBarX = (desiredBarWorldXRounded - spritePack.root.x) / Math.max(0.01, scale)
      const localBarY = (desiredBarWorldYRounded - spritePack.root.y) / Math.max(0.01, scale)
      // 仅抵消动作/受击等临时放缩；保留近大远小的基础 scale
      const invScale = 1 / Math.max(0.01, finalAnimScaleMul)
      spritePack.hpBg.scale.set(invScale)
      spritePack.hpFill.scale.set(invScale)
      spritePack.hpBg.clear()
      spritePack.hpBg.roundRect(localBarX - barW / 2, localBarY, barW, barH, radius)
      spritePack.hpBg.fill({ color: 0x220000, alpha: 0.9 * alpha })
      spritePack.hpBg.stroke({ color: 0x000000, width: 2, alpha })
      spritePack.hpFill.clear()
      const fillW = Math.max(0, Math.min(barW, barW * hpRatio))
      if (fillW > 0.001) {
        spritePack.hpFill.roundRect(localBarX - barW / 2, localBarY, fillW, barH, radius)
        spritePack.hpFill.fill({ color: 0xe24848, alpha: 0.98 * alpha })
      }
      spritePack.hpBg.visible = true
      spritePack.hpFill.visible = true
    } else {
      spritePack.hpBg.scale.set(1)
      spritePack.hpFill.scale.set(1)
      spritePack.hpBg.visible = false
      spritePack.hpFill.visible = false
    }
    const red = Math.round(0xff * (1 - 0.25 * preparePulse))
    const gb = Math.round(0xff * (1 - 0.55 * preparePulse))
    spritePack.body.tint = (red << 16) | (gb << 8) | gb
    towerEnemyPosById.set(one.id, {
      x: laneX + animXOff,
      y: y + animYOff - effectiveFlyingLift * finalScale - 36 * finalScale,
    })
  }

  for (const [id, one] of towerEnemySpriteById.entries()) {
    if (aliveIds.has(id)) continue
    const death = towerEnemyDeathFlyById.get(id)
    if (!death) {
      one.root.visible = false
      one.flash.alpha = 0
      towerEnemyAnimStateById.delete(id)
      towerEnemyHpAnchorById.delete(id)
      towerEnemyDefIdByUnitId.delete(id)
      towerEnemyLastHitDirById.delete(id)
      continue
    }
    const dtMs = Math.max(0, battlePresentationMs - death.lastMs)
    death.lastMs = battlePresentationMs
    death.elapsedMs += dtMs
    const dtSec = dtMs / 1000
    const tdCfg = getGameCfg().towerDefenseRules
    const outMargin = Math.max(40, Number((tdCfg as { enemyDeathFlyOutMargin?: number } | undefined)?.enemyDeathFlyOutMargin) || 180)
    const fadeStartMs = Math.max(0, Number((tdCfg as { enemyDeathFlyFadeStartMs?: number } | undefined)?.enemyDeathFlyFadeStartMs) || 0)
    const fadeEndMsRaw = Math.max(0, Number((tdCfg as { enemyDeathFlyFadeEndMs?: number } | undefined)?.enemyDeathFlyFadeEndMs) || 600)
    const fadeEndMs = Math.max(fadeStartMs, fadeEndMsRaw)
    const fadeFinalAlpha = Math.max(0, Math.min(1, Number((tdCfg as { enemyDeathFlyFinalAlpha?: number } | undefined)?.enemyDeathFlyFinalAlpha) || 0.35))
    const scaleEndMs = Math.max(0, Number((tdCfg as { enemyDeathFlyScaleEndMs?: number } | undefined)?.enemyDeathFlyScaleEndMs) || 900)
    const finalScaleMul = Math.max(0.1, Number((tdCfg as { enemyDeathFlyFinalScaleMul?: number } | undefined)?.enemyDeathFlyFinalScaleMul) || 0.9)
    const deathFlyTopZ = Math.max(
      2_000_000,
      Math.round(Math.max(CANVAS_H, nearY, farY) * 1000) + 100_000,
    )
    death.x += death.vx * dtSec
    death.y += death.vy * dtSec
    death.rot += death.rotSpeed * dtSec

    if (!death.bounced && (death.x <= 0 || death.x >= CANVAS_W)) {
      death.vx = -death.vx
      death.x = Math.max(0, Math.min(CANVAS_W, death.x))
      death.bounced = true
    }

    const outOfScreen = death.x < -outMargin
      || death.x > CANVAS_W + outMargin
      || death.y < -outMargin
      || death.y > CANVAS_H + outMargin
    if (outOfScreen) {
      towerEnemyDeathFlyById.delete(id)
      one.root.visible = false
      one.flash.alpha = 0
      towerEnemyAnimStateById.delete(id)
      towerEnemyPosById.delete(id)
      towerEnemyHpAnchorById.delete(id)
      towerEnemyDefIdByUnitId.delete(id)
      towerEnemyLastHitDirById.delete(id)
      continue
    }

    let flyScale = death.startScale
    if (scaleEndMs > 0) {
      const scaleP = Math.max(0, Math.min(1, death.elapsedMs / scaleEndMs))
      flyScale = death.startScale * (1 + (finalScaleMul - 1) * scaleP)
    } else {
      flyScale = death.startScale * finalScaleMul
    }
    one.root.visible = true
    one.root.x = death.x
    one.root.y = death.y
    one.root.scale.set(flyScale)
    let deathAlpha = 1
    if (fadeEndMs > fadeStartMs && death.elapsedMs > fadeStartMs) {
      const fadeP = Math.max(0, Math.min(1, (death.elapsedMs - fadeStartMs) / Math.max(1, fadeEndMs - fadeStartMs)))
      deathAlpha = 1 + (fadeFinalAlpha - 1) * fadeP
    } else if (fadeEndMs === fadeStartMs && death.elapsedMs >= fadeStartMs) {
      deathAlpha = fadeFinalAlpha
    }
    one.root.alpha = deathAlpha
    one.root.zIndex = deathFlyTopZ + Math.round(death.y)
    one.body.anchor.set(0.5, 0.5)
    one.flash.anchor.set(0.5, 0.5)
    one.body.y = -36 * flyScale
    one.flash.y = -36 * flyScale
    one.body.rotation = death.rot
    one.flash.rotation = death.rot
    one.flash.alpha = 0
    one.hpBg.visible = false
    one.hpFill.visible = false
    one.shadow.alpha = 0
    one.body.tint = 0xffffff
    towerEnemyPosById.set(id, { x: death.x, y: death.y - 36 * flyScale })
  }
}

function drawTowerClassAttackDistanceGuides(): void {
  if (!towerClassRangeLayer) return
  const distances = engine?.getTowerClassAttackDistances?.()
  const cfg = getGameCfg().towerDefenseRules
  const showAllRangeGuides = getDebugCfg('gameplayShowTowerClassAttackDistance') >= 0.5
  let selectedRoleKey: 'swordsman' | 'archer' | 'assassin' | 'mage' | null = null
  if (!showAllRangeGuides && engine && selectedItemId && selectedItemSide) {
    const selected = engine.getBoardState().items.find((it) => it.id === selectedItemId && it.side === selectedItemSide)
    const selectedDef = selected ? getItemDefById(selected.defId) : null
    const selectedArch = selectedDef ? toSkillArchetype(getPrimaryArchetype(selectedDef.tags)) : null
    if (selectedArch === 'warrior') selectedRoleKey = 'swordsman'
    else if (selectedArch === 'archer') selectedRoleKey = 'archer'
    else if (selectedArch === 'assassin') selectedRoleKey = 'assassin'
    else if (selectedArch === 'mage') selectedRoleKey = 'mage'
  }
  if ((!showAllRangeGuides && !selectedRoleKey) || !isTowerDefenseBattle() || !cfg || cfg.enabled === false || !distances) {
    towerClassRangeLayer.visible = false
    return
  }
  const farY = Number(cfg.farY) || 320
  const nearY = Number(cfg.nearY) || 940
  const maxDistance = Math.max(1, Number(cfg.levelDistance) || 1000)
  const farWidthRatio = Math.max(0.1, Math.min(1.2, Number(cfg.roadFarWidthRatio) || 0.5))
  const nearWidthRatio = Math.max(0.2, Math.min(1.4, Number(cfg.roadNearWidthRatio) || 1))
  const roadFarCenterX = Number(cfg.roadFarCenterX) || CANVAS_W / 2
  const roadNearCenterX = Number(cfg.roadNearCenterX) || CANVAS_W / 2
  const meterToDistance = Math.max(1, Number(cfg.moveDistancePerSecAtSpeed1) || 1)
  const lineWidthScale = Math.max(0.5, Number((cfg as { classRangeGuideWidthScale?: number }).classRangeGuideWidthScale) || 1.5)
  const nearThicknessPx = Math.max(1, Number((cfg as { classRangeGuideNearThicknessPx?: number }).classRangeGuideNearThicknessPx) || 10)
  const roles: Array<{ key: 'swordsman' | 'archer' | 'assassin' | 'mage'; cn: string; color: number }> = [
    { key: 'swordsman', cn: '剑士', color: getClassColor('剑士') },
    { key: 'archer', cn: '弓手', color: getClassColor('弓手') },
    { key: 'assassin', cn: '忍者', color: getClassColor('忍者') },
    { key: 'mage', cn: '冰法师', color: getClassColor('冰法师') },
  ]
  let hasVisible = false
  const logParts: string[] = []
  for (const role of roles) {
    const line = towerClassRangeLineByRole.get(role.key)
    if (!line) continue
    if (!showAllRangeGuides && selectedRoleKey && role.key !== selectedRoleKey) {
      line.visible = false
      continue
    }
    const distance = Math.max(0, Math.round(distances[role.key] || 0))
    if (distance <= 0) {
      line.visible = false
      logParts.push(`${role.cn}=0m`)
      continue
    }
    const progress = Math.max(0, Math.min(1, 1 - distance / maxDistance))
    const y = farY + (nearY - farY) * progress
    const roadWidthRatio = farWidthRatio + (nearWidthRatio - farWidthRatio) * progress
    const roadCenterX = roadFarCenterX + (roadNearCenterX - roadFarCenterX) * progress
    const halfW = Math.max(20, CANVAS_W * roadWidthRatio * 0.5 * lineWidthScale)
    const thicknessPx = Math.max(1, Math.round(nearThicknessPx * (roadWidthRatio / Math.max(0.01, nearWidthRatio))))
    const lineHalf = Math.floor(thicknessPx / 2)
    const yPx = Math.round(y)
    const xPx = Math.round(roadCenterX - halfW)
    const wPx = Math.max(1, Math.round(halfW * 2))
    line.clear()
    line.rect(xPx, yPx - lineHalf, wPx, thicknessPx)
    line.fill({ color: role.color, alpha: 0.75 })
    line.visible = true
    hasVisible = true
    logParts.push(`${role.cn}=${(distance / meterToDistance).toFixed(1)}m`)
  }
  towerClassRangeLayer.visible = hasVisible
  const signature = logParts.join('|')
  if (signature && signature !== towerClassRangeLastLogSignature) {
    towerClassRangeLastLogSignature = signature
    console.log(`[TowerRange] ${signature}`)
  }
}

function enqueueVisualFx(task: QueuedFxTask | null | undefined): void {
  if (!task) return
  if (task.mergeKey) {
    const existing = visualFxMergeMap.get(task.mergeKey)
    if (existing && existing.mergeWith) {
      existing.mergeWith(task)
      return
    }
  }
  const runtimeCfg = getGameCfg().combatRuntime
  const queueMax = Math.max(1, Math.round(runtimeCfg.visualFxQueueMax || 1))
  if (visualFxQueue.length >= queueMax) {
    visualFxDroppedCount += 1
    return
  }
  visualFxQueue.push(task)
  if (task.mergeKey) visualFxMergeMap.set(task.mergeKey, task)
}

function consumeVisualFxQueue(frameDtMs: number): void {
  const runtimeCfg = getGameCfg().combatRuntime
  const baseBudget = Math.max(1, Math.round(runtimeCfg.visualFxConsumePerFrame || 1))
  const budget = frameDtMs > 24
    ? 1
    : (frameDtMs > 16 ? Math.max(1, Math.round(baseBudget * 0.5)) : baseBudget)
  for (let i = 0; i < budget; i++) {
    const one = visualFxQueue.shift()
    if (!one) break
    if (one.mergeKey && visualFxMergeMap.get(one.mergeKey) === one) visualFxMergeMap.delete(one.mergeKey)
    one.run()
  }
}

function readUsedHeapMb(): number {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory
  const used = mem?.usedJSHeapSize
  if (typeof used !== 'number' || !Number.isFinite(used) || used <= 0) return 0
  return used / (1024 * 1024)
}

function tickAutoFxDegrade(dtMs: number): void {
  if (!engine) return
  const runtimeCfg = getGameCfg().combatRuntime
  monitorSampleElapsedMs += dtMs
  const sampleEveryMs = Math.max(
    100,
    Math.round(runtimeCfg.memoryMonitorSampleMs * (isMobileBattleRuntime ? 0.6 : 1)),
  )
  if (monitorSampleElapsedMs < sampleEveryMs) return
  monitorSampleElapsedMs = 0

  const fxStats = fxPool.getPerfStats()
  const fxLimits = fxPool.getCurrentFxLimits()
  const queueStats = engine.getQueuePerfStats()

  const pendingRatio = Math.max(
    queueStats.pendingHits / Math.max(1, queueStats.maxPendingHits),
    queueStats.pendingItemFires / Math.max(1, queueStats.maxPendingItemFires),
    queueStats.pendingChargePulses / Math.max(1, queueStats.maxPendingChargePulses),
    queueStats.pendingAmmoRefills / Math.max(1, queueStats.maxPendingAmmoRefills),
  )
  const fxRatio = Math.max(
    fxStats.activeProjectiles / Math.max(1, fxLimits.maxProjectiles),
    fxStats.activeFloatingNumbers / Math.max(1, fxLimits.maxFloatingNumbers),
    fxStats.activeFx / Math.max(1, fxLimits.maxActiveTotal),
  )
  const heapMb = readUsedHeapMb()
  const droppedVisualInWindow = visualFxDroppedCount
  visualFxDroppedCount = 0

  const highPendingRatio = runtimeCfg.memoryMonitorHighPendingRatio * (isMobileBattleRuntime ? 0.85 : 1)
  const recoverPendingRatio = runtimeCfg.memoryMonitorRecoverPendingRatio * (isMobileBattleRuntime ? 0.85 : 1)
  const highFxRatio = runtimeCfg.memoryMonitorHighFxRatio * (isMobileBattleRuntime ? 0.85 : 1)
  const recoverFxRatio = runtimeCfg.memoryMonitorRecoverFxRatio * (isMobileBattleRuntime ? 0.85 : 1)
  const highHeapMb = runtimeCfg.memoryMonitorHighHeapMb * (isMobileBattleRuntime ? 0.8 : 1)
  const recoverHeapMb = runtimeCfg.memoryMonitorRecoverHeapMb * (isMobileBattleRuntime ? 0.8 : 1)

  const isHigh = pendingRatio >= highPendingRatio
    || fxRatio >= highFxRatio
    || (heapMb > 0 && heapMb >= highHeapMb)
    || droppedVisualInWindow >= Math.max(4, Math.round(runtimeCfg.visualFxConsumePerFrame))
  const canRecoverByHeap = heapMb <= 0 || heapMb <= recoverHeapMb
  const isRecover = pendingRatio <= recoverPendingRatio
    && fxRatio <= recoverFxRatio
    && canRecoverByHeap

  if (isHigh) {
    monitorHighStreak += 1
    monitorRecoverStreak = 0
  } else if (isRecover) {
    monitorRecoverStreak += 1
    monitorHighStreak = 0
  } else {
    monitorHighStreak = 0
    monitorRecoverStreak = 0
  }

  const escalateSamples = Math.max(
    1,
    Math.round(runtimeCfg.memoryMonitorEscalateSamples + (isMobileBattleRuntime ? -1 : 0)),
  )
  const recoverSamples = Math.max(
    1,
    Math.round(runtimeCfg.memoryMonitorRecoverSamples + (isMobileBattleRuntime ? 1 : 0)),
  )

  if (monitorHighStreak >= escalateSamples && autoFxDegradeLevel < 2) {
    autoFxDegradeLevel += 1
    monitorHighStreak = 0
    monitorRecoverStreak = 0
    fxPool.setAutoDegradeLevel(autoFxDegradeLevel)
    console.warn(`[BattleScene] Auto FX degrade escalated to L${autoFxDegradeLevel}`)
  }

  if (monitorRecoverStreak >= recoverSamples && autoFxDegradeLevel > 0) {
    autoFxDegradeLevel -= 1
    monitorHighStreak = 0
    monitorRecoverStreak = 0
    fxPool.setAutoDegradeLevel(autoFxDegradeLevel)
    console.warn(`[BattleScene] Auto FX degrade recovered to L${autoFxDegradeLevel}`)
  }
}

function shouldShowSimpleDescriptions(): boolean {
  return false
}

function getDefaultItemInfoMode(): ItemInfoMode {
  return shouldShowSimpleDescriptions() ? 'simple' : 'detailed'
}

function getTowerZoneExpandStages(): TowerZoneExpandStage[] {
  const raw = getGameCfg().towerDefenseRules?.towerBattleZoneExpandStages
  const list = Array.isArray(raw) ? raw : []
  const normalized = list
    .map((one) => {
      const rows = Math.max(1, Math.min(3, Math.round(Number(one?.rows) || 0)))
      const cols = Math.max(1, Math.min(6, Math.round(Number(one?.cols) || 0)))
      const price = Math.max(0, Math.round(Number(one?.price) || 0))
      if (!Number.isFinite(rows) || !Number.isFinite(cols)) return null
      return { rows, cols, price }
    })
    .filter((one): one is TowerZoneExpandStage => !!one)
  if (normalized.length <= 0) return DEFAULT_TOWER_ZONE_EXPAND_STAGES
  return normalized
}

function getTowerZoneExpandCurrentStep(): number {
  const maxStep = Math.max(0, getTowerZoneExpandStages().length - 1)
  return Math.max(0, Math.min(maxStep, Math.round(Number(towerBattleZoneExpandStep) || 0)))
}

function getTowerZoneExpandCurrentStage(): TowerZoneExpandStage {
  const stages = getTowerZoneExpandStages()
  const step = getTowerZoneExpandCurrentStep()
  return stages[step] ?? stages[0] ?? DEFAULT_TOWER_ZONE_EXPAND_STAGES[0]
}

function getTowerZoneExpandNextStage(): TowerZoneExpandStage | null {
  const stages = getTowerZoneExpandStages()
  const next = getTowerZoneExpandCurrentStep() + 1
  return next < stages.length ? (stages[next] ?? null) : null
}

function inferTowerZoneExpandStepFromSnapshot(snapshot: ReturnType<typeof getBattleSnapshot> | null): number {
  const stages = getTowerZoneExpandStages()
  const explicit = Number(snapshot?.towerBattleZoneExpandStep)
  if (Number.isFinite(explicit)) {
    return Math.max(0, Math.min(stages.length - 1, Math.round(explicit)))
  }
  let requiredCols = 1
  let requiredRows = 1
  const entities = snapshot?.entities ?? []
  for (const it of entities) {
    const sizeRaw = String((it as { size?: string }).size ?? '1x1')
    let width = 1
    try {
      const normalized = normalizeSize(sizeRaw)
      width = normalized === '3x1' ? 3 : (normalized === '2x1' ? 2 : 1)
    } catch {
      width = sizeRaw === '3x1' ? 3 : (sizeRaw === '2x1' ? 2 : 1)
    }
    const colEnd = Math.max(1, Math.round(Number(it.col) || 0) + width)
    const rowEnd = Math.max(1, Math.round(Number(it.row) || 0) + 1)
    requiredCols = Math.max(requiredCols, colEnd)
    requiredRows = Math.max(requiredRows, rowEnd)
  }
  for (let i = 0; i < stages.length; i++) {
    const one = stages[i]
    if (!one) continue
    if (one.cols >= requiredCols && one.rows >= requiredRows) return i
  }
  return Math.max(0, stages.length - 1)
}

function getTowerBattleColsForCurrentExpandStep(): number {
  return getTowerZoneExpandCurrentStage().cols
}

function getTowerBattleRowsForCurrentExpandStep(): number {
  return getTowerZoneExpandCurrentStage().rows
}

function getTowerZoneExpandBuyUnlockItemCount(): number {
  const raw = Number(getGameCfg().towerDefenseRules?.towerBattleZoneExpandUnlockItemCount)
  if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.round(raw))
  return 2
}

function getTowerZoneExpandBuyCost(): number {
  const next = getTowerZoneExpandNextStage()
  if (!next) return 0
  const current = getTowerZoneExpandCurrentStage()
  return Math.max(0, Math.round(current.price || 0))
}



function getDayActiveCols(day: number): number {
  if (getGameCfg().towerDefenseRules?.enabled === true) return getTowerBattleColsForCurrentExpandStep()
  const slots = getGameCfg().dailyBattleSlots
  if (day <= 2) return slots[0] ?? 4
  if (day <= 4) return slots[1] ?? 5
  return slots[2] ?? 6
}

function getTowerPlayerZoneResizeAnimMs(): number {
  const raw = Number(getGameCfg().towerDefenseRules?.playerZoneResizeAnimMs)
  if (Number.isFinite(raw)) return Math.max(0, Math.round(raw))
  return 1000
}

function startPlayerZoneResizeTransition(toCols: number, toRows: number, options?: { countsAlreadyApplied?: boolean }): void {
  if (!playerZone) return
  const fromCols = Math.max(1, playerZone.activeColCount)
  const fromRows = Math.max(1, playerZone.activeRowCount)
  if (fromCols === toCols && fromRows === toRows) {
    playerZoneResizeTransition = null
    playerZone.setCellBackgroundScale(1, 1)
    return
  }
  const durationMs = getTowerPlayerZoneResizeAnimMs()
  if (durationMs <= 0) {
    playerZoneResizeTransition = null
    playerZone.setCellBackgroundScale(1, 1)
    playerZone.setActiveColCount(toCols)
    playerZone.setActiveRowCount(toRows)
    return
  }
  const countsAlreadyApplied = options?.countsAlreadyApplied === true
  const bgScaleFromX = countsAlreadyApplied ? (fromCols / Math.max(1, toCols)) : 1
  const bgScaleToX = countsAlreadyApplied ? 1 : (toCols / Math.max(1, fromCols))
  const bgScaleFromY = countsAlreadyApplied ? (fromRows / Math.max(1, toRows)) : 1
  const bgScaleToY = countsAlreadyApplied ? 1 : (toRows / Math.max(1, fromRows))
  playerZone.setCellBackgroundScale(bgScaleFromX, bgScaleFromY)
  playerZoneResizeTransition = {
    fromCols,
    toCols,
    fromRows,
    toRows,
    fromX: playerZone.x,
    toX: getPlayerZoneX(toCols),
    fromY: playerZone.y,
    toY: getPlayerZoneY(battleDay),
    bgScaleFromX,
    bgScaleToX,
    bgScaleFromY,
    bgScaleToY,
    durationMs,
    elapsedMs: 0,
  }
}

function updatePlayerZoneResizeTransition(dtMs: number): void {
  if (!playerZoneResizeTransition || !playerZone) return
  const state = playerZoneResizeTransition
  state.elapsedMs = Math.min(state.durationMs, state.elapsedMs + Math.max(0, dtMs))
  const t = state.durationMs <= 0 ? 1 : Math.min(1, state.elapsedMs / state.durationMs)
  const ease = 1 - Math.pow(1 - t, 3)
  playerZone.x = state.fromX + (state.toX - state.fromX) * ease
  playerZone.y = state.fromY + (state.toY - state.fromY) * ease
  playerZone.setCellBackgroundScale(
    state.bgScaleFromX + (state.bgScaleToX - state.bgScaleFromX) * ease,
    state.bgScaleFromY + (state.bgScaleToY - state.bgScaleFromY) * ease,
  )
  if (t < 1) return
  playerZone.setCellBackgroundScale(1, 1)
  playerZone.setActiveColCount(state.toCols)
  playerZone.setActiveRowCount(state.toRows)
  applyZoneVisualStyle(playerZone, 'player')
  applyLayout(state.toCols)
  playerZoneResizeTransition = null
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

function getPlayerZoneX(activeCols: number): number {
  const s = getBattleItemScale()
  return getDebugCfg('battleZoneX') + (CANVAS_W - activeCols * CELL_SIZE * s) / 2
}

function getTowerExpandExtraLiftPx(rows: number): number {
  const rowCount = Math.max(1, Math.round(Number(rows) || 1))
  return Math.max(0, rowCount - 1) * 10
}

function getPlayerZoneY(day: number): number {
  const playerScale = getBattleItemScale()
  if (isTowerDefenseBattle()) {
    const rows = getTowerBattleRowsForCurrentExpandStep()
    const baseY = getDebugCfg('battleZoneY') + (3 - rows) * 120 - getTowerExpandExtraLiftPx(rows)
    return baseY + getAdjustedBattleZoneYInBattleOffset(day) + (CELL_HEIGHT * (1 - playerScale)) / 2
  }
  return getAdjustedBattleZoneY(day) + getAdjustedBattleZoneYInBattleOffset(day) + (CELL_HEIGHT * (1 - playerScale)) / 2
}

function getTowerPlayerHpBarTargetRowYOffset(): number {
  if (!isTowerDefenseBattle()) return 0
  const rows = getTowerBattleRowsForCurrentExpandStep()
  return (3 - rows) * 120 - getTowerExpandExtraLiftPx(rows)
}

function syncTowerPlayerHpBarRowYOffset(animate: boolean): void {
  const target = getTowerPlayerHpBarTargetRowYOffset()
  if (!animate) {
    towerPlayerHpBarRowYOffsetTransition = null
    towerPlayerHpBarRowYOffset = target
    return
  }
  const from = towerPlayerHpBarRowYOffset
  if (Math.abs(from - target) < 0.01) {
    towerPlayerHpBarRowYOffsetTransition = null
    towerPlayerHpBarRowYOffset = target
    return
  }
  const durationMs = getTowerPlayerZoneResizeAnimMs()
  if (durationMs <= 0) {
    towerPlayerHpBarRowYOffsetTransition = null
    towerPlayerHpBarRowYOffset = target
    return
  }
  towerPlayerHpBarRowYOffsetTransition = {
    from,
    to: target,
    durationMs,
    elapsedMs: 0,
  }
}

function updateTowerPlayerHpBarRowYOffsetTransition(dtMs: number): void {
  if (!towerPlayerHpBarRowYOffsetTransition) return
  const state = towerPlayerHpBarRowYOffsetTransition
  state.elapsedMs = Math.min(state.durationMs, state.elapsedMs + Math.max(0, dtMs))
  const t = state.durationMs <= 0 ? 1 : Math.min(1, state.elapsedMs / state.durationMs)
  const ease = 1 - Math.pow(1 - t, 3)
  towerPlayerHpBarRowYOffset = state.from + (state.to - state.from) * ease
  if (t < 1) return
  towerPlayerHpBarRowYOffset = state.to
  towerPlayerHpBarRowYOffsetTransition = null
}

function getTowerPlayerHpBarRowYOffset(): number {
  if (!isTowerDefenseBattle()) return 0
  return towerPlayerHpBarRowYOffset
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
    enteredSnapshot = buildEditableSnapshotFromBoard(battleDay)
    transition.beginExit(engine, enteredSnapshot, backBtn, speedBtn)
  })
  return con
}

function makeContinueBattleButton(): Container {
  const con = new Container()
  const bg = new Graphics()
  const w = 260
  const h = 78
  bg.roundRect(-w / 2, -h / 2, w, h, 16)
  bg.stroke({ color: 0xb7d0ff, width: 3, alpha: 0.95 })
  bg.fill({ color: 0x20345a, alpha: 0.92 })
  con.addChild(bg)

  const txt = new Text({
    text: '开始下一波',
    style: { fontSize: 34, fill: 0xe6f0ff, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x08142a, width: 3 } },
  })
  txt.anchor.set(0.5)
  con.addChild(txt)
  continueBtnText = txt

  con.x = CANVAS_W / 2
  con.y = 92 + topSafeYOffset + 50
  con.zIndex = 190
  con.eventMode = 'static'
  con.cursor = 'pointer'
  con.on('pointerdown', () => {
    if (isTowerDefenseBattle()) {
      void startNextTowerWaveInPlace()
      return
    }
    transition.beginExit(engine, enteredSnapshot, backBtn, speedBtn)
  })
  return con
}

function makeRestartButton(): Container {
  const con = new Container()
  const bg = new Graphics()
  const corner = Math.max(10, Math.round(getDebugCfg('gridItemCornerRadius') + 8))
  bg.roundRect(-TOP_ACTION_BTN_W / 2, -TOP_ACTION_BTN_H / 2, TOP_ACTION_BTN_W, TOP_ACTION_BTN_H, corner)
  bg.stroke({ color: 0x44aaff, width: 3 })
  bg.fill({ color: 0x44aaff, alpha: 0.18 })
  con.addChild(bg)

  const txt = new Text({
    text: '重置',
    style: { fontSize: getGameCfg().textSizes.phaseButtonLabel, fill: 0x44aaff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  txt.anchor.set(0.5)
  con.addChild(txt)

  con.eventMode = 'static'
  con.cursor = 'pointer'
  con.on('pointerdown', () => {
    clearCurrentRunState()
    resetLifeState()
    resetWinTrophyState(getGameCfg().runRules?.trophyWinsToFinalVictory ?? 10)
    clearBattleSnapshot()
    clearBattleOutcome()
    if (isTowerDefenseBattle()) {
      markTowerAutoStartOnEnter()
      SceneManager.goto('tower-battle')
    }
    else window.location.reload()
  })
  return con
}

function pickFirstEmptyCell(system: GridSystem, size: GridItemSizeNorm, activeCols: number): { col: number; row: number } | null {
  const { w, h } = system.getSizeDim(size)
  const maxCol = Math.max(0, activeCols - w)
  const maxRow = Math.max(0, system.getActiveRows() - h)
  for (let row = 0; row <= maxRow; row++) {
    for (let col = 0; col <= maxCol; col++) {
      if (system.canPlace(col, row, size)) return { col, row }
    }
  }
  return null
}

function getItemMaxActiveCount(def: ItemDef | null | undefined): number {
  const raw = Number(def?.max_active_count)
  if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.round(raw))
  return Number.POSITIVE_INFINITY
}

function buildCurrentBattleItemCountByDefId(excludeInstanceIds?: Set<string>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const [instanceId, meta] of editableMeta.entries()) {
    if (!meta?.defId) continue
    if (excludeInstanceIds?.has(instanceId)) continue
    counts.set(meta.defId, (counts.get(meta.defId) ?? 0) + 1)
  }
  return counts
}

function reachesMaxActiveCount(def: ItemDef, currentCountByDefId: Map<string, number>): boolean {
  const maxCount = getItemMaxActiveCount(def)
  if (!Number.isFinite(maxCount)) return false
  const cur = currentCountByDefId.get(def.id) ?? 0
  return cur >= maxCount
}

function getEditableStartGold(day: number): number {
  if (isTowerDefenseBattle()) {
    return day <= 1 ? 5 : 0
  }
  const cfg = getGameCfg()
  const byDay = cfg.dailyGoldByDay
  if (Array.isArray(byDay) && byDay.length > 0) {
    const idx = Math.max(0, Math.min(byDay.length - 1, Math.round(day) - 1))
    return Math.max(0, Math.round(byDay[idx] ?? byDay[0] ?? cfg.dailyGold ?? 3))
  }
  return Math.max(0, Math.round(cfg.dailyGold ?? 3))
}

function rollBattleBuyOffer(day: number): BattleBuyOffer | null {
  const _day = day
  void _day
  const level: 1 = 1
  const tierStar = levelToTowerTierStar(level)
  if (!tierStar) return null

  const allItems = getAllItems()
  const currentCountByDefId = buildCurrentBattleItemCountByDefId()
  const candidates = allItems.filter((it) => {
    if (String(it.id).startsWith('skill_')) return false
    if (reachesMaxActiveCount(it, currentCountByDefId)) return false
    const minTier = parseTierName(it.starting_tier) ?? 'Bronze'
    if (!getTowerAllowedLevelsByStartingTier(minTier).includes(level)) return false
    const avail = String(it.available_tiers || '')
      .split('/')
      .map((s) => parseTierName(s.trim()))
      .filter((v): v is TierKey => !!v)
    return avail.includes(tierStar.tier)
  })
  if (candidates.length <= 0) return null
  const item = candidates[Math.floor(nextBattleRandom('battle_buy_pick') * candidates.length)]
  if (!item) return null
  return {
    item,
    level,
    tier: tierStar.tier,
    star: tierStar.star,
  }
}

function levelToTowerTierStar(level: 1 | 2 | 3 | 4 | 5): { tier: TierKey; star: 1 | 2 } | null {
  if (level === 1) return { tier: 'Bronze', star: 1 }
  if (level === 2) return { tier: 'Silver', star: 1 }
  if (level === 3) return { tier: 'Gold', star: 1 }
  if (level === 4) return { tier: 'Diamond', star: 1 }
  if (level === 5) return { tier: 'Diamond', star: 2 }
  return null
}

function getTowerItemSynthesisMaxLevel(): 1 | 2 | 3 | 4 | 5 {
  const raw = Number(getDebugCfg('gameplayItemSynthesisMaxLevel'))
  if (!Number.isFinite(raw)) return 5
  return Math.max(1, Math.min(5, Math.round(raw))) as 1 | 2 | 3 | 4 | 5
}

function tierStarToTowerLevel(tier: TierKey, star: 1 | 2): 1 | 2 | 3 | 4 | 5 {
  if (tier === 'Bronze') return star >= 2 ? 2 : 1
  if (tier === 'Silver') return star >= 2 ? 3 : 2
  if (tier === 'Gold') return star >= 2 ? 4 : 3
  return star >= 2 ? 5 : 4
}

function getTowerAllowedLevelsByStartingTier(tier: TierKey): Array<1 | 2 | 3 | 4 | 5> {
  const cap = getTowerItemSynthesisMaxLevel()
  const all = tier === 'Bronze'
    ? [1, 2, 3, 4, 5]
    : tier === 'Silver'
      ? [2, 3, 4, 5]
      : tier === 'Gold'
        ? [3, 4, 5]
        : [4, 5]
  return all.filter((lv): lv is 1 | 2 | 3 | 4 | 5 => lv <= cap)
}

function buildEditableSnapshotFromBoard(day: number): ReturnType<typeof getBattleSnapshot> {
  if (!editableSystem) return enteredSnapshot
  const maxLevel = getTowerItemSynthesisMaxLevel()
  const playerHp = Math.max(1, Math.round(engine?.getBoardState().player.hp ?? enteredSnapshot?.playerBattleHp ?? 1))
  const playerShield = Math.max(0, Math.round(engine?.getBoardState().player.shield ?? enteredSnapshot?.playerShield ?? 0))
  const entities = editableSystem.getCombatEntities(6).map((it) => {
    const meta = editableMeta.get(it.instanceId)
    const level = Math.max(
      1,
      Math.min(maxLevel, Number(meta?.level) || tierStarToTowerLevel((meta?.tier ?? 'Bronze') as TierKey, (meta?.tierStar ?? 1) as 1 | 2)),
    ) as 1 | 2 | 3 | 4 | 5
    const byLevel = levelToTowerTierStar(level)
    const tier = (byLevel?.tier ?? meta?.tier ?? 'Bronze') as TierKey
    const tierStar = (byLevel?.star ?? meta?.tierStar ?? 1) as 1 | 2
    return {
      ...it,
      tier,
      tierStar,
      quality: meta?.quality ?? 'Bronze',
      level,
      permanentDamageBonus: meta?.permanentDamageBonus ?? 0,
    }
  })
  return {
    ...(enteredSnapshot ?? { day, activeColCount: 6, createdAtMs: Date.now(), entities: [] }),
    day,
    activeColCount: 6,
    createdAtMs: Date.now(),
    entities,
    playerGold: Math.max(0, Math.round(editableGold)),
    playerBattleHp: playerHp,
    playerShield,
    towerBattleBuyCount: Math.max(0, Math.round(towerBattleBuyCount)),
    towerBattleSkillBuyCount: Math.max(0, Math.round(towerBattleSkillBuyCount)),
    towerBattleZoneExpandStep: getTowerZoneExpandCurrentStep(),
    towerBattleSkillPickCounts: serializeTowerBattleSkillPickCounts(),
  }
}

function canSynthesizePairInBattle(sourceInstanceId: string, targetInstanceId: string): boolean {
  const sourceMeta = editableMeta.get(sourceInstanceId)
  const targetMeta = editableMeta.get(targetInstanceId)
  if (!sourceMeta || !targetMeta) return false
  if (sourceMeta.size !== targetMeta.size) return false
  const sourceDef = getItemDefById(sourceMeta.defId)
  const targetDef = getItemDefById(targetMeta.defId)
  if (!sourceDef || !targetDef) return false
  const maxLevel = getTowerItemSynthesisMaxLevel()
  const sourceLevel = Math.max(1, Math.min(maxLevel, Number(sourceMeta.level) || tierStarToTowerLevel(sourceMeta.tier, sourceMeta.tierStar))) as 1 | 2 | 3 | 4 | 5
  const targetLevel = Math.max(1, Math.min(maxLevel, Number(targetMeta.level) || tierStarToTowerLevel(targetMeta.tier, targetMeta.tierStar))) as 1 | 2 | 3 | 4 | 5
  if (sourceLevel !== targetLevel) return false
  if (sourceLevel >= maxLevel) return false
  if (sourceMeta.defId === targetMeta.defId) return true
  const sourceArch = toSkillArchetype(getPrimaryArchetype(sourceDef.tags))
  const targetArch = toSkillArchetype(getPrimaryArchetype(targetDef.tags))
  if (!sourceArch || !targetArch) return false
  return sourceArch === targetArch
}

function refreshBattleSynthesisGuideArrows(sourceInstanceId: string | null): void {
  if (!playerZone || !editableSystem) return
  if (!sourceInstanceId) {
    playerZone.setDragGuideArrows([])
    return
  }
  const sameIds: string[] = []
  for (const it of editableSystem.getAllItems()) {
    if (it.instanceId === sourceInstanceId) continue
    if (!canSynthesizePairInBattle(sourceInstanceId, it.instanceId)) continue
    sameIds.push(it.instanceId)
  }
  playerZone.setDragGuideArrows(sameIds)
}

function isPointInBattleItemBounds(instanceId: string, gx: number, gy: number): boolean {
  if (!playerZone || !editableSystem) return false
  const item = editableSystem.getItem(instanceId)
  if (!item) return false
  const dim = editableSystem.getSizeDim(item.size)
  const left = item.col * CELL_SIZE
  const top = item.row * CELL_HEIGHT
  const a = playerZone.toGlobal({ x: left, y: top })
  const b = playerZone.toGlobal({ x: left + dim.w * CELL_SIZE, y: top + dim.h * CELL_HEIGHT })
  const x0 = Math.min(a.x, b.x)
  const x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const y1 = Math.max(a.y, b.y)
  return gx >= x0 && gx <= x1 && gy >= y0 && gy <= y1
}

function findSynthesisHoverTargetInBattle(sourceInstanceId: string, anchorGx: number, anchorGy: number, size: GridItemSizeNorm): string | null {
  if (!playerZone || !editableSystem) return null
  const probeYs = [anchorGy, anchorGy + getDebugCfg('dragYOffset')]

  for (const py of probeYs) {
    for (const it of editableSystem.getAllItems()) {
      if (it.instanceId === sourceInstanceId) continue
      if (!canSynthesizePairInBattle(sourceInstanceId, it.instanceId)) continue
      if (isPointInBattleItemBounds(it.instanceId, anchorGx, py)) return it.instanceId
    }
  }

  for (const py of probeYs) {
    const cell = playerZone.pixelToCellForItem(anchorGx, py, size, 0)
    if (!cell) continue
    const srcDim = editableSystem.getSizeDim(size)
    const l = cell.col
    const r = cell.col + srcDim.w
    const t = cell.row
    const b = cell.row + srcDim.h
    for (const it of editableSystem.getAllItems()) {
      if (it.instanceId === sourceInstanceId) continue
      if (!canSynthesizePairInBattle(sourceInstanceId, it.instanceId)) continue
      const d = editableSystem.getSizeDim(it.size)
      const il = it.col
      const ir = it.col + d.w
      const itop = it.row
      const ib = it.row + d.h
      if (l < ir && r > il && t < ib && b > itop) return it.instanceId
    }
  }
  return null
}

function pickBattleSynthesisResultDef(
  sourceDef: ItemDef,
  targetDef: ItemDef,
  targetSize: GridItemSizeNorm,
  resultTier: TierKey,
  resultStar: 1 | 2,
  sourceInstanceId?: string,
  targetInstanceId?: string,
): ItemDef | null {
  const runPoolSet = new Set(getRunClassItemPoolIds())
  const isSameIdSynthesis = sourceDef.id === targetDef.id
  const sameItemRandomSynthesis = getDebugCfg('gameplaySameItemRandomSynthesis') >= 0.5
  const minStartingTier = getCrossSynthesisMinStartingTier(sourceDef, targetDef)
  const excludedInstanceIds = new Set<string>()
  if (sourceInstanceId) excludedInstanceIds.add(sourceInstanceId)
  if (targetInstanceId) excludedInstanceIds.add(targetInstanceId)
  const currentCountByDefId = buildCurrentBattleItemCountByDefId(excludedInstanceIds)

  const resultTierIndex = (tier: TierKey): number => Math.max(0, TIER_ORDER.indexOf(tier))
  const filterByResultTierCeiling = (list: ItemDef[], targetTierKey: TierKey): ItemDef[] => {
    const maxIdx = resultTierIndex(targetTierKey)
    return list.filter((it) => {
      const startTier = parseTierName(it.starting_tier) ?? 'Bronze'
      return resultTierIndex(startTier) <= maxIdx
    })
  }
  const filterCrossSynthesisPool = (list: ItemDef[]): ItemDef[] => {
    let out = list.filter((it) => it.id !== sourceDef.id && it.id !== targetDef.id)
    if (sameItemRandomSynthesis) return out
    const sourceArch = toSkillArchetype(getPrimaryArchetype(sourceDef.tags))
    const targetArch = toSkillArchetype(getPrimaryArchetype(targetDef.tags))
    const shouldExcludeSameArch = (
      sourceArch === 'warrior' || sourceArch === 'archer' || sourceArch === 'assassin' || sourceArch === 'mage'
    ) && sourceArch === targetArch
    if (shouldExcludeSameArch) {
      out = out.filter((it) => toSkillArchetype(getPrimaryArchetype(it.tags)) !== sourceArch)
    }
    if (runPoolSet.size > 0) out = out.filter((it) => runPoolSet.has(it.id))
    out = out.filter((it) => !reachesMaxActiveCount(it, currentCountByDefId))
    return out
  }

  const allRaw = pickCrossIdEvolveCandidates(sourceDef, targetSize, resultTier, 'Bronze', false)
  const allByTier = filterByResultTierCeiling(allRaw, resultTier)
  let candidates: ItemDef[] = []
  if (isSameIdSynthesis) {
    candidates = sameItemRandomSynthesis
      ? allByTier.filter((it) => it.id !== sourceDef.id && it.id !== targetDef.id)
      : [sourceDef]
  } else {
    candidates = filterCrossSynthesisPool(allByTier)
  }
  candidates = candidates.filter((it) => !reachesMaxActiveCount(it, currentCountByDefId))
  const qualityBucketLevel = tierStarToTowerLevel(resultTier, resultStar)
  const evolvedDef = pickCrossSynthesisResultWithCycle(candidates, resultTier, resultStar, minStartingTier, qualityBucketLevel)
  return evolvedDef
}

function applyBattleSynthesis(sourceInstanceId: string, targetInstanceId: string, homeSystem: GridSystem, homeView: GridZone): boolean {
  if (!canSynthesizePairInBattle(sourceInstanceId, targetInstanceId)) return false
  const sourceMeta = editableMeta.get(sourceInstanceId)
  const targetMeta = editableMeta.get(targetInstanceId)
  const targetItem = homeSystem.getItem(targetInstanceId)
  if (!sourceMeta || !targetMeta || !targetItem) return false
  const sourceDef = getItemDefById(sourceMeta.defId)
  const targetDef = getItemDefById(targetMeta.defId)
  if (!sourceDef || !targetDef) return false
  const maxLevel = getTowerItemSynthesisMaxLevel()
  const sourceLevel = Math.max(1, Math.min(maxLevel, Number(sourceMeta.level) || tierStarToTowerLevel(sourceMeta.tier, sourceMeta.tierStar))) as 1 | 2 | 3 | 4 | 5
  const targetLevel = Math.max(1, Math.min(maxLevel, Number(targetMeta.level) || tierStarToTowerLevel(targetMeta.tier, targetMeta.tierStar))) as 1 | 2 | 3 | 4 | 5
  if (sourceLevel !== targetLevel) return false
  if (sourceLevel >= maxLevel) return false
  const resultLevel = (sourceLevel + 1) as 1 | 2 | 3 | 4 | 5
  const upgradeTo = levelToTowerTierStar(resultLevel)
  if (!upgradeTo) return false
  const evolvedDef = pickBattleSynthesisResultDef(sourceDef, targetDef, targetMeta.size, upgradeTo.tier, upgradeTo.star, sourceInstanceId, targetInstanceId)
  if (!evolvedDef) {
    showFatigueToast('可合成物品已达上限')
    return false
  }

  homeSystem.remove(sourceInstanceId)
  homeView.removeItem(sourceInstanceId)
  editableMeta.delete(sourceInstanceId)

  homeSystem.remove(targetInstanceId)
  if (!homeSystem.place(targetItem.col, targetItem.row, targetItem.size, evolvedDef.id, targetInstanceId)) return false
  homeView.removeItem(targetInstanceId)
  void homeView.addItem(targetInstanceId, evolvedDef.id, targetItem.size, targetItem.col, targetItem.row, `${upgradeTo.tier}#${upgradeTo.star}`).then(() => {
    homeView.setItemTier(targetInstanceId, `${upgradeTo.tier}#${upgradeTo.star}`)
    editableDrag?.refreshZone(homeView)
  })

  editableMeta.set(targetInstanceId, {
    ...targetMeta,
    defId: evolvedDef.id,
    level: resultLevel,
    tier: upgradeTo.tier,
    tierStar: upgradeTo.star,
    quality: parseTierName(evolvedDef.starting_tier) ?? targetMeta.quality,
  })
  clearItemRoundStatForPlayerIds([sourceInstanceId, targetInstanceId])
  syncEngineWithEditable([targetInstanceId])
  pendingBattleBuyOffer = null
  return true
}

function showBattleSynthesisPreviewInfo(sourceInstanceId: string, targetInstanceId: string): void {
  if (!itemInfoPopup) return
  const sourceMeta = editableMeta.get(sourceInstanceId)
  const targetMeta = editableMeta.get(targetInstanceId)
  if (!sourceMeta || !targetMeta) return
  const sourceDef = getItemDefById(sourceMeta.defId)
  if (!sourceDef) return
  const maxLevel = getTowerItemSynthesisMaxLevel()
  const sourceLevel = Math.max(1, Math.min(maxLevel, Number(sourceMeta.level) || tierStarToTowerLevel(sourceMeta.tier, sourceMeta.tierStar))) as 1 | 2 | 3 | 4 | 5
  const next = sourceLevel >= maxLevel ? null : levelToTowerTierStar((sourceLevel + 1) as 1 | 2 | 3 | 4 | 5)
  const custom: ItemInfoCustomDisplay = {
    useQuestionIcon: true,
    hideName: true,
    suppressStats: true,
    hideCooldownBadge: true,
    lines: [
      next
        ? `升级为随机物品（${next.tier}#${next.star}）`
        : '升级为随机物品',
    ],
  }
  itemInfoPopup.show(
    sourceDef,
    0,
    'none',
    `${sourceMeta.tier}#${sourceMeta.tierStar}`,
    undefined,
    'detailed',
    undefined,
    custom,
    undefined,
    sourceLevel,
  )
}

function getDraggingPlayerSourcePoint(sourceItemId: string, side: 'player' | 'enemy'): { x: number; y: number } | null {
  if (side !== 'player') return null
  if (!sourceItemId || sourceItemId !== draggingPlayerItemId) return null
  return draggingPlayerItemFirePoint
}

function syncEngineWithEditable(resetChargeIds?: string[]): void {
  if (!engine || !editableSystem) return
  const snap = buildEditableSnapshotFromBoard(battleDay)
  if (!snap) return
  enteredSnapshot = snap
  setBattleSnapshot(snap)
  engine.syncPlayerEntities?.(snap.entities, { resetChargeIds })
  syncTowerBattleSkillPickCountsToEngine()
  fxPool.refreshSourceDefMap()
}

function resetTowerEnemyPresentationForNextWave(): void {
  for (const one of towerEnemySpriteById.values()) {
    one.root.destroy({ children: true })
  }
  towerEnemySpriteById.clear()
  towerEnemyAnimStateById.clear()
  towerEnemyPosById.clear()
  towerEnemyHpAnchorById.clear()
  towerEnemyDefIdByUnitId.clear()
  towerEnemyDeathFlyById.clear()
  towerEnemyLastHitDirById.clear()
}

function getTowerBattleBuyCost(): number {
  const table = getGameCfg().towerDefenseRules?.battleBuyCostByPurchaseCount
  const list = Array.isArray(table) ? table : []
  const nextBuyCount = Math.max(1, Math.round(towerBattleBuyCount) + 1)
  if (list.length > 0) {
    const idx = Math.max(0, Math.min(list.length - 1, nextBuyCount - 1))
    const raw = Number(list[idx])
    if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.round(raw))
  }
  const fallback = Number(getGameCfg().shopRules?.quickBuyFixedPrice?.['Bronze#1'])
  if (Number.isFinite(fallback) && fallback > 0) return Math.max(1, Math.round(fallback))
  return 1
}

function getTowerBattleSkillBuyUnlockItemCount(): number {
  const raw = Number(getGameCfg().towerDefenseRules?.battleSkillBuyUnlockItemCount)
  if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.round(raw))
  return 5
}

function getTowerBattleSkillBuyCost(): number {
  const table = getGameCfg().towerDefenseRules?.battleSkillBuyCostByPurchaseCount
  const list = Array.isArray(table) ? table : []
  const nextBuyCount = Math.max(1, Math.round(towerBattleSkillBuyCount) + 1)
  return calcTowerBattleSkillBuyCost(nextBuyCount, list)
}

function serializeTowerBattleSkillPickCounts(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of towerBattleSkillPickCounts.entries()) {
    const n = Math.max(0, Math.round(Number(v) || 0))
    if (n > 0) out[k] = n
  }
  return out
}

function getTowerBattleItemIconSet(): Set<string> {
  const out = new Set<string>()
  for (const meta of editableMeta.values()) {
    const defId = String(meta?.defId || '').trim()
    if (!defId) continue
    const def = getItemDefById(defId)
    const icon = String(def?.icon || '').trim()
    if (icon) out.add(icon)
  }
  return out
}

function getTowerTopArchetypesForSkillDraft(): [TowerSkillArchetype, TowerSkillArchetype] {
  const metaLite = new Map<string, { defId: string; level?: number; tier?: string; tierStar?: 1 | 2 }>()
  for (const [instanceId, meta] of editableMeta.entries()) {
    metaLite.set(instanceId, {
      defId: meta.defId,
      level: meta.level,
      tier: meta.tier,
      tierStar: meta.tierStar,
    })
  }
  const sorted = getTopArchetypesByTotalItemLevel(metaLite)
  const top1 = sorted[0] ?? '忍者'
  const top2 = sorted[1] ?? top1
  return [top1, top2]
}

function pickTowerBattleSkillDraftChoices(): TowerBattleSkillDef[] {
  const [guaranteed, secondGuaranteed] = getTowerTopArchetypesForSkillDraft()
  const itemIcons = getTowerBattleItemIconSet()
  return pickTowerBattleSkillChoices(
    towerBattleSkillPickCounts,
    guaranteed,
    secondGuaranteed,
    itemIcons,
    () => nextBattleRandom('tower_skill_draft_choice'),
  )
}

function syncTowerBattleSkillPickCountsToEngine(): void {
  if (!engine?.syncTowerBattleSkillPickCounts) return
  engine.syncTowerBattleSkillPickCounts(serializeTowerBattleSkillPickCounts())
}

function closeTowerSkillDraftOverlay(): void {
  if (towerSkillDraftOverlay?.parent) towerSkillDraftOverlay.parent.removeChild(towerSkillDraftOverlay)
  towerSkillDraftOverlay?.destroy({ children: true })
  towerSkillDraftOverlay = null
}

function mountTowerItemIconSprite(
  parent: Container,
  itemId: string,
  centerX: number,
  centerY: number,
  iconSize: number,
  fallback: Text,
): void {
  const iconUrls = [
    getItemIconUrl(itemId),
    `/resource/itemicon/vanessa/${itemId}.webp`,
    `/resource/itemicon/vanessa/${itemId}.png`,
    `/resource/toweritem/${itemId}.png`,
  ]
  const sprite = new Sprite(Texture.WHITE)
  sprite.anchor.set(0.5)
  sprite.x = centerX
  sprite.y = centerY
  sprite.alpha = 0
  parent.addChild(sprite)
  void (async () => {
    for (const url of iconUrls) {
      try {
        const tex = await Assets.load<Texture>(url)
        const sw = Math.max(1, tex.width)
        const sh = Math.max(1, tex.height)
        const scale = Math.min(iconSize / sw, iconSize / sh)
        sprite.texture = tex
        sprite.width = Math.max(1, Math.round(sw * scale))
        sprite.height = Math.max(1, Math.round(sh * scale))
        sprite.alpha = 1
        fallback.visible = false
        return
      } catch {
        continue
      }
    }
    sprite.destroy({ children: false })
  })()
}

function getTowerSkillDisplayName(id: string, name: string): string {
  const map: Record<string, string> = {
    td_skill_ninja_damage: '手里剑\n伤害',
    td_skill_ninja_cd: '手里剑\n间隔',
    td_skill_ninja_super_bounce: '手里剑\n超级弹射',
    td_skill_ninja_super_multicast: '手里剑\n超级连发',
    td_skill_ninja_super_heavy: '手里剑\n超级重型',
    td_skill_ninja_super_crystal: '手里剑\n超级水晶',
    td_skill_ninja_super_split: '手里剑\n超级分裂',
    td_skill_archer_damage: '弓箭\n伤害',
    td_skill_archer_cd: '弓箭\n间隔',
    td_skill_archer_super_high_damage: '弓箭\n超级高伤',
    td_skill_archer_super_multicast: '弓箭\n超级连发',
    td_skill_archer_super_poison: '弓箭\n超级中毒',
    td_skill_archer_super_sniper: '弓箭\n超级狙击',
    td_skill_archer_super_blood: '弓箭\n超级嗜血',
    td_skill_mage_damage: '冰锥\n伤害',
    td_skill_mage_cd: '冰锥\n间隔',
    td_skill_mage_super_slow: '冰锥\n超级减速',
    td_skill_mage_super_multitarget: '冰锥\n超级多发',
    td_skill_mage_super_freeze: '冰锥\n超级冰冻',
    td_skill_mage_super_explode: '冰锥\n超级爆炸',
    td_skill_mage_super_counter: '冰锥\n超级反击',
    td_skill_warrior_damage: '长剑\n伤害',
    td_skill_warrior_cd: '长剑\n间隔',
    td_skill_warrior_super_range: '长剑\n超级伸缩',
    td_skill_warrior_super_guard: '长剑\n超级守护',
    td_skill_warrior_super_bleed: '长剑\n超级重伤',
    td_skill_warrior_super_dual: '长剑\n超级双持',
    td_skill_warrior_super_counter: '长剑\n超级反击',
  }
  const mapped = map[id]
  if (mapped) return mapped
  const text = String(name || '').trim()
  const idx = text.indexOf('·')
  if (idx >= 0 && idx < text.length - 1) return `${text.slice(0, idx)}\n${text.slice(idx + 1)}`
  return text
}

function formatTowerSkillSeriesDetail(
  id: string,
  prefix: string,
  series: number[],
  suffix: string,
): string {
  const picked = Math.max(0, Math.round(towerBattleSkillPickCounts.get(id) ?? 0))
  const next = picked < series.length ? Math.max(0, Math.round(Number(series[picked]) || 0)) : 0
  if (next > 0) return `${prefix}${next}${suffix}`
  const fallback = Math.max(0, Math.round(Number(series[Math.max(0, series.length - 1)]) || 0))
  if (fallback > 0) return `${prefix}${fallback}${suffix}`
  return `${prefix}${suffix}`
}

function getTowerSkillDetailById(id: string): string {
  if (id === 'td_skill_ninja_damage') {
    return formatTowerSkillSeriesDetail(id, '所有手里剑伤害+', [20, 15, 10, 5, 3], '%')
  }
  if (id === 'td_skill_archer_damage') {
    return formatTowerSkillSeriesDetail(id, '所有弓箭伤害+', [20, 15, 10, 5, 3], '%')
  }
  if (id === 'td_skill_mage_damage') {
    return formatTowerSkillSeriesDetail(id, '所有冰锥伤害+', [20, 15, 10, 5, 3], '%')
  }
  if (id === 'td_skill_warrior_damage') {
    return formatTowerSkillSeriesDetail(id, '所有长剑伤害+', [20, 15, 10, 5, 3], '%')
  }
  if (id === 'td_skill_ninja_cd') {
    return formatTowerSkillSeriesDetail(id, '所有手里剑间隔缩短', [10, 8, 6, 4, 2], '%')
  }
  if (id === 'td_skill_archer_cd') {
    return formatTowerSkillSeriesDetail(id, '所有弓箭间隔缩短', [10, 8, 6, 4, 2], '%')
  }
  if (id === 'td_skill_mage_cd') {
    return formatTowerSkillSeriesDetail(id, '所有冰锥间隔缩短', [10, 8, 6, 4, 2], '%')
  }
  if (id === 'td_skill_warrior_cd') {
    return formatTowerSkillSeriesDetail(id, '所有长剑间隔缩短', [10, 8, 6, 4, 2], '%')
  }

  const map: Record<string, string> = {
    td_skill_ninja_super_bounce: '所有手里剑弹射次数额外+1',
    td_skill_ninja_super_multicast: '所有手里剑连发次数+1，伤害-25%',
    td_skill_ninja_super_heavy: '手里剑命中减速目标造成额外50%伤害',
    td_skill_ninja_super_crystal: '水晶手里剑弹射后伤害增加10%',
    td_skill_ninja_super_split: '分裂手里剑分裂后伤害增加50%',
    td_skill_archer_super_high_damage: '所有弓箭伤害额外+5',
    td_skill_archer_super_multicast: '所有弓箭连发次数+1，伤害-25%',
    td_skill_archer_super_poison: '所有弓箭中毒按目标最大生命值百分比结算',
    td_skill_archer_super_sniper: '狙击弓箭效果翻倍',
    td_skill_archer_super_blood: '嗜血弓箭效果翻倍',
    td_skill_mage_super_slow: '冰锥减速效果提升为减速66%',
    td_skill_mage_super_multitarget: '所有冰锥同时发射目标+1，伤害-25%',
    td_skill_mage_super_freeze: '冰冻持续时间翻倍',
    td_skill_mage_super_explode: '爆炸冰锥半径提升50%（6m→9m）',
    td_skill_mage_super_counter: '反击冰锥受击获得的充能值翻倍',
    td_skill_warrior_super_range: '所有长剑攻击距离+3',
    td_skill_warrior_super_guard: '护盾值低于50时不自动下降',
    td_skill_warrior_super_bleed: '长剑重伤效果翻倍',
    td_skill_warrior_super_dual: '双持长剑获得护盾翻倍',
    td_skill_warrior_super_counter: '反击长剑反弹伤害翻倍',
  }
  return map[id] ?? '强化对应职业技能效果'
}

function formatTowerBattleSkillBuyButtonText(gold: number, cost: number, unlockCount: number): string {
  void gold
  const unlocked = towerBattleBuyCount >= unlockCount
  if (!unlocked) return `技能购买\n解锁:${towerBattleBuyCount}/${unlockCount}`
  return `技能购买\n💰${Math.max(0, Math.round(cost))}`
}

function tickTowerBattleSkillBuyAffordPulse(): void {
  if (!skillBuyBtnPulseFrame) return
  if (skillBuyBtnAffordPulseStartAtMs === null) {
    skillBuyBtnPulseFrame.visible = false
    return
  }
  const durationMs = getTowerBattleBuyAffordPulseDurationMs()
  const elapsed = Math.max(0, battlePresentationMs - skillBuyBtnAffordPulseStartAtMs)
  const p = Math.max(0, Math.min(1, elapsed / Math.max(1, durationMs)))
  if (p >= 1) {
    skillBuyBtnAffordPulseStartAtMs = null
    skillBuyBtnPulseFrame.visible = false
    return
  }
  const w = TOWER_BOTTOM_ACTION_BTN_W
  const h = TOWER_BOTTOM_ACTION_BTN_H
  const pad = getTowerBattleBuyAffordPulsePaddingPx()
  const corner = Math.max(10, Math.round(getDebugCfg('gridItemCornerRadius') + 8)) + pad
  const scaleMax = Math.max(1.01, getTowerBattleBuyAffordPulseScaleMax())
  const wave = Math.sin(p * Math.PI)
  const alpha = (1 - p) * 0.95
  const scale = 1 + (scaleMax - 1) * wave
  skillBuyBtnPulseFrame.visible = true
  skillBuyBtnPulseFrame.clear()
  skillBuyBtnPulseFrame.roundRect(-w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2, corner)
  skillBuyBtnPulseFrame.stroke({ color: 0xffda67, width: 4, alpha })
  skillBuyBtnPulseFrame.scale.set(scale)
}

function redrawTowerBattleSkillBuyButtonVisual(canAfford: boolean, unlocked: boolean): void {
  if (!skillBuyBtnBg) return
  const w = TOWER_BOTTOM_ACTION_BTN_W
  const h = TOWER_BOTTOM_ACTION_BTN_H
  const corner = Math.max(10, Math.round(getDebugCfg('gridItemCornerRadius') + 8))
  const strokeColor = !unlocked ? 0x7f8ca8 : (canAfford ? 0xffcf4a : 0x6fd0ff)
  const fillColor = !unlocked ? 0x5f6a80 : (canAfford ? 0xffcf4a : 0x6fd0ff)
  const fillAlpha = !unlocked ? 0.2 : (canAfford ? 0.32 : 0.16)
  skillBuyBtnBg.clear()
  skillBuyBtnBg.roundRect(-w / 2, -h / 2, w, h, corner)
  skillBuyBtnBg.stroke({ color: strokeColor, width: 3 })
  skillBuyBtnBg.fill({ color: fillColor, alpha: fillAlpha })
  if (skillBuyBtnText) {
    skillBuyBtnText.style.fill = !unlocked ? 0xc6d2ea : (canAfford ? 0xffffff : 0x6fd0ff)
    skillBuyBtnText.style.stroke = canAfford && unlocked ? { color: 0x000000, width: 3 } : { color: 0x000000, width: 0 }
  }
}

function refreshTowerBattleSkillDisplay(forceRebuild = false): void {
  if (!towerSkillDisplayCon) return
  const byArch = getTowerBattleSkillCountByArchetype(towerBattleSkillPickCounts)
  const activeSlots = [
    { arch: '忍者' as const, icon: 'toweritem1', count: byArch.忍者, color: getClassColor('忍者') },
    { arch: '弓手' as const, icon: 'toweritem7', count: byArch.弓手, color: getClassColor('弓手') },
    { arch: '冰法师' as const, icon: 'toweritem13', count: byArch.冰法师, color: getClassColor('冰法师') },
    { arch: '剑士' as const, icon: 'toweritem19', count: byArch.剑士, color: getClassColor('剑士') },
  ].filter((it) => it.count > 0)
  const key = activeSlots.map((s) => `${s.arch}:${s.count}`).join('|')
  if (!forceRebuild && key === towerSkillDisplayKey) return
  towerSkillDisplayKey = key
  towerSkillDisplayCon.removeChildren().forEach((c) => c.destroy({ children: true }))

  towerSkillDisplayCon.visible = activeSlots.length > 0
  if (activeSlots.length <= 0) return
  const iconR = 30
  const gapY = -6
  const slotH = iconR * 2 + 26
  for (let i = 0; i < activeSlots.length; i++) {
    const one = activeSlots[i]!
    const cell = new Container()
    cell.x = 0
    cell.y = i * (slotH + gapY)
    const ring = new Graphics()
    ring.circle(0, 0, iconR + 4)
    ring.circle(0, 0, iconR + 4)
    ring.stroke({ color: one.color, width: 5, alpha: 0.95 })
    cell.addChild(ring)

    const fallback = new Text({
      text: one.arch.slice(0, 1),
      style: { fontSize: 24, fill: 0xeef4ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    fallback.anchor.set(0.5)
    cell.addChild(fallback)
    mountTowerItemIconSprite(cell, one.icon, 0, 0, iconR * 1.7, fallback)

    const countTxt = new Text({
      text: `x${Math.max(0, Math.round(one.count))}`,
      style: {
        fontSize: 24,
        fill: 0xffefc2,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x000000, width: 3 },
      },
    })
    countTxt.anchor.set(0.5, 0)
    countTxt.x = 0
    countTxt.y = iconR - 14
    cell.addChild(countTxt)
    towerSkillDisplayCon.addChild(cell)
  }
}

function openTowerSkillDraftOverlay(choices: TowerBattleSkillDef[], onPick: (picked: TowerBattleSkillDef) => void): void {
  if (!root) return
  closeTowerSkillDraftOverlay()
  const overlay = new Container()
  overlay.zIndex = 3600
  overlay.eventMode = 'static'

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
  title.y = 378
  overlay.addChild(title)

  const shownChoices = choices.slice(0, 3)
  const cardW = 196
  const cardH = 430
  const gapX = 18
  const totalW = cardW * shownChoices.length + gapX * Math.max(0, shownChoices.length - 1)
  const cardX = (CANVAS_W - totalW) / 2
  const cardY = 560

  const commitPick = (def: TowerBattleSkillDef): void => {
    onPick(def)
    closeTowerSkillDraftOverlay()
  }

  shownChoices.forEach((choice, idx) => {
    const con = new Container()
    con.x = cardX + idx * (cardW + gapX)
    con.y = cardY
    con.eventMode = 'static'
    con.cursor = 'pointer'

    const border = new Graphics()
    border.roundRect(0, 0, cardW, cardH, 24)
    border.fill({ color: 0x18263e, alpha: 0.96 })
    border.stroke({ color: 0x84b7ff, width: 3, alpha: 1 })
    con.addChild(border)

    const ring = new Graphics()
    const archetypeRingColor = getClassColor(choice.archetype)
    ring.circle(cardW / 2, 106, 58)
    ring.fill({ color: 0x000000, alpha: 0.82 })
    ring.circle(cardW / 2, 106, 58)
    ring.stroke({ color: archetypeRingColor, width: 5, alpha: 0.95 })
    con.addChild(ring)

    const iconText = new Text({
      text: choice.name.slice(0, 1),
      style: { fontSize: 54, fill: 0xf5f8ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    iconText.anchor.set(0.5)
    iconText.x = cardW / 2
    iconText.y = 106
    con.addChild(iconText)
    mountTowerItemIconSprite(con, choice.icon, cardW / 2, 106, 92, iconText)

    const name = new Text({
      text: getTowerSkillDisplayName(choice.id, choice.name),
      style: {
        fontSize: 32,
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
    name.y = 186
    con.addChild(name)

    const desc = new Text({
      text: getTowerSkillDetailById(choice.id),
      style: {
        fontSize: 24,
        fill: 0xd4def1,
        fontFamily: 'Arial',
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: cardW - 28,
        lineHeight: 30,
      },
    })
    desc.anchor.set(0.5, 0)
    desc.x = cardW / 2
    desc.y = 274
    con.addChild(desc)

    con.on('pointerdown', (e) => {
      e.stopPropagation()
      commitPick(choice)
    })
    overlay.addChild(con)
  })

  root.addChild(overlay)
  towerSkillDraftOverlay = overlay
}

function getTowerBattleBuyOfferLevel(): number {
  const offer = pendingBattleBuyOffer ?? rollBattleBuyOffer(battleDay)
  if (!offer) return 0
  if (!pendingBattleBuyOffer) pendingBattleBuyOffer = offer
  return offer.level
}

function activateTowerPreFirstAttackSpeedBoost(): void {
  if (!isTowerDefenseBattle()) return
  if (towerHasPlayerItemFiredOnce) return
  if (towerPreFirstAttackSpeedBoostActive) return
  towerPreFirstAttackOriginalSpeed = battleSpeed
  towerPreFirstAttackSpeedBoostActive = true
  battleSpeed = 2.5
  if (speedBtnText) speedBtnText.text = `倍速:${battleSpeed}x`
}

function restoreTowerPreFirstAttackSpeed(): void {
  if (!towerPreFirstAttackSpeedBoostActive) return
  towerPreFirstAttackSpeedBoostActive = false
  if (towerPreFirstAttackOriginalSpeed !== null) {
    battleSpeed = Math.max(1, towerPreFirstAttackOriginalSpeed)
  }
  towerPreFirstAttackOriginalSpeed = null
  if (speedBtnText) speedBtnText.text = `倍速:${battleSpeed}x`
}

function formatTowerBattleBuyButtonText(gold: number, cost: number, level: number): string {
  void gold
  void level
  if (cost <= 0 || level <= 0) return '物品购买\n暂无'
  return `物品购买\n💰${Math.max(0, Math.round(cost))}`
}

function formatTowerZoneExpandButtonText(gold: number, cost: number, unlockCount: number): string {
  void gold
  const unlocked = towerBattleBuyCount >= unlockCount
  const next = getTowerZoneExpandNextStage()
  if (!next) return '背包扩容\n已满级'
  if (!unlocked) return `背包扩容\n解锁:${towerBattleBuyCount}/${unlockCount}`
  return `背包扩容\n💰${Math.max(0, Math.round(cost))}`
}

function getTowerBattleBuyAffordPulseDurationMs(): number {
  const raw = Number(getGameCfg().towerDefenseRules?.battleBuyAffordPulseDurationMs)
  if (Number.isFinite(raw) && raw > 0) return Math.round(raw)
  return 750
}

function getTowerBattleBuyAffordPulseScaleMax(): number {
  const raw = Number(getGameCfg().towerDefenseRules?.battleBuyAffordPulseScaleMax)
  if (Number.isFinite(raw) && raw > 1) return raw
  return 1.18
}

function getTowerBattleBuyAffordPulsePaddingPx(): number {
  const raw = Number(getGameCfg().towerDefenseRules?.battleBuyAffordPulsePaddingPx)
  if (Number.isFinite(raw) && raw >= 0) return Math.round(raw)
  return 10
}

function getTowerBattleBuyButtonY(): number {
  const raw = Number(getGameCfg().towerDefenseRules?.battleBuyButtonY)
  if (Number.isFinite(raw)) return Math.round(raw) + 15
  return CANVAS_H - 48
}

function drawTowerGoldBadgeAtExpandButton(): void {
  if (!towerGoldBadgeBg || !towerGoldBadgeText || !organizeBtn || !isTowerDefenseBattle()) return
  const text = `💰 ${Math.max(0, Math.round(editableGold))}`
  towerGoldBadgeText.text = text
  const x = organizeBtn.x - TOWER_BOTTOM_ACTION_BTN_W / 2 - 23
  const y = organizeBtn.y - TOWER_BOTTOM_ACTION_BTN_H / 2 - towerGoldBadgeText.height - 18
  towerGoldBadgeText.x = x
  towerGoldBadgeText.y = y
  towerGoldBadgeBg.clear()
  towerGoldBadgeBg.visible = false
  towerGoldBadgeText.visible = true
}

function getTowerPlayerZoneBackgroundAlpha(): number {
  const raw = Number(getGameCfg().towerDefenseRules?.playerZoneBackgroundAlpha)
  if (Number.isFinite(raw)) return Math.max(0, Math.min(1, raw))
  return 0.58
}

function redrawTowerBattleBuyButtonVisual(canAfford: boolean): void {
  if (!buyBtnBg) return
  const w = TOWER_BOTTOM_ACTION_BTN_W
  const h = TOWER_BOTTOM_ACTION_BTN_H
  const corner = Math.max(10, Math.round(getDebugCfg('gridItemCornerRadius') + 8))
  const strokeColor = canAfford ? 0xffcf4a : 0x44aaff
  const fillColor = canAfford ? 0xffcf4a : 0x44aaff
  const fillAlpha = canAfford ? 0.34 : 0.18
  buyBtnBg.clear()
  buyBtnBg.roundRect(-w / 2, -h / 2, w, h, corner)
  buyBtnBg.stroke({ color: strokeColor, width: 3 })
  buyBtnBg.fill({ color: fillColor, alpha: fillAlpha })
  if (buyBtnText) {
    buyBtnText.style.fill = canAfford ? 0xffffff : 0x44aaff
    buyBtnText.style.stroke = canAfford ? { color: 0x000000, width: 3 } : { color: 0x000000, width: 0 }
  }
}

function tickTowerBattleBuyAffordPulse(): void {
  if (!buyBtnPulseFrame) return
  if (buyBtnAffordPulseStartAtMs === null) {
    buyBtnPulseFrame.visible = false
    return
  }
  const durationMs = getTowerBattleBuyAffordPulseDurationMs()
  const elapsed = Math.max(0, battlePresentationMs - buyBtnAffordPulseStartAtMs)
  const p = Math.max(0, Math.min(1, elapsed / Math.max(1, durationMs)))
  if (p >= 1) {
    buyBtnAffordPulseStartAtMs = null
    buyBtnPulseFrame.visible = false
    return
  }
  const w = TOWER_BOTTOM_ACTION_BTN_W
  const h = TOWER_BOTTOM_ACTION_BTN_H
  const pad = getTowerBattleBuyAffordPulsePaddingPx()
  const corner = Math.max(10, Math.round(getDebugCfg('gridItemCornerRadius') + 8)) + pad
  const scaleMax = Math.max(1.01, getTowerBattleBuyAffordPulseScaleMax())
  const wave = Math.sin(p * Math.PI)
  const alpha = (1 - p) * 0.95
  const scale = 1 + (scaleMax - 1) * wave
  buyBtnPulseFrame.visible = true
  buyBtnPulseFrame.clear()
  buyBtnPulseFrame.roundRect(-w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2, corner)
  buyBtnPulseFrame.stroke({ color: 0xffda67, width: 4, alpha })
  buyBtnPulseFrame.scale.set(scale)
}

function redrawTowerZoneExpandButtonVisual(canAfford: boolean, unlocked: boolean, upgradable: boolean): void {
  if (!towerZoneExpandBtnBg) return
  const w = TOWER_BOTTOM_ACTION_BTN_W
  const h = TOWER_BOTTOM_ACTION_BTN_H
  const corner = Math.max(10, Math.round(getDebugCfg('gridItemCornerRadius') + 8))
  const strokeColor = !upgradable
    ? 0x8da3c4
    : (!unlocked ? 0x7f8ca8 : (canAfford ? 0xffcf4a : 0x44aaff))
  const fillColor = !upgradable
    ? 0x8da3c4
    : (!unlocked ? 0x5f6a80 : (canAfford ? 0xffcf4a : 0x44aaff))
  const fillAlpha = !upgradable
    ? 0.16
    : (!unlocked ? 0.2 : (canAfford ? 0.34 : 0.18))
  towerZoneExpandBtnBg.clear()
  towerZoneExpandBtnBg.roundRect(-w / 2, -h / 2, w, h, corner)
  towerZoneExpandBtnBg.stroke({ color: strokeColor, width: 3 })
  towerZoneExpandBtnBg.fill({ color: fillColor, alpha: fillAlpha })
  if (towerZoneExpandBtnText) {
    towerZoneExpandBtnText.style.fill = !upgradable
      ? 0xc9d8ea
      : (!unlocked ? 0xc6d2ea : (canAfford ? 0xffffff : 0x44aaff))
    towerZoneExpandBtnText.style.stroke = canAfford && unlocked && upgradable
      ? { color: 0x000000, width: 3 }
      : { color: 0x000000, width: 0 }
  }
}

function tickTowerZoneExpandAffordPulse(): void {
  if (!towerZoneExpandBtnPulseFrame) return
  if (towerZoneExpandBtnAffordPulseStartAtMs === null) {
    towerZoneExpandBtnPulseFrame.visible = false
    return
  }
  const durationMs = getTowerBattleBuyAffordPulseDurationMs()
  const elapsed = Math.max(0, battlePresentationMs - towerZoneExpandBtnAffordPulseStartAtMs)
  const p = Math.max(0, Math.min(1, elapsed / Math.max(1, durationMs)))
  if (p >= 1) {
    towerZoneExpandBtnAffordPulseStartAtMs = null
    towerZoneExpandBtnPulseFrame.visible = false
    return
  }
  const w = TOWER_BOTTOM_ACTION_BTN_W
  const h = TOWER_BOTTOM_ACTION_BTN_H
  const pad = getTowerBattleBuyAffordPulsePaddingPx()
  const corner = Math.max(10, Math.round(getDebugCfg('gridItemCornerRadius') + 8)) + pad
  const scaleMax = Math.max(1.01, getTowerBattleBuyAffordPulseScaleMax())
  const wave = Math.sin(p * Math.PI)
  const alpha = (1 - p) * 0.95
  const scale = 1 + (scaleMax - 1) * wave
  towerZoneExpandBtnPulseFrame.visible = true
  towerZoneExpandBtnPulseFrame.clear()
  towerZoneExpandBtnPulseFrame.roundRect(-w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2, corner)
  towerZoneExpandBtnPulseFrame.stroke({ color: 0xffda67, width: 4, alpha })
  towerZoneExpandBtnPulseFrame.scale.set(scale)
}

function getTowerForceNextWaveAfterLastSpawnMs(): number {
  const rules = getGameCfg().towerDefenseRules as { enemyForceNextWaveAfterAllSpawnMs?: number; enemyAttackDoubleAfterAllSpawnMs?: number } | undefined
  const raw = Number(rules?.enemyForceNextWaveAfterAllSpawnMs)
  if (Number.isFinite(raw) && raw >= 0) return Math.round(raw)
  const legacy = Number(rules?.enemyAttackDoubleAfterAllSpawnMs)
  if (Number.isFinite(legacy) && legacy >= 0) return Math.round(legacy)
  return 30000
}

function markTowerAutoStartOnEnter(): void {
  try {
    sessionStorage.setItem(TOWER_AUTO_START_ON_ENTER_FLAG_KEY, '1')
  } catch {
    // ignore
  }
}

function consumeTowerAutoStartOnEnterFlag(): boolean {
  try {
    const hit = sessionStorage.getItem(TOWER_AUTO_START_ON_ENTER_FLAG_KEY) === '1'
    if (hit) sessionStorage.removeItem(TOWER_AUTO_START_ON_ENTER_FLAG_KEY)
    return hit
  } catch {
    return false
  }
}

function getTowerEnemyKillGoldByUnitId(unitId: string): number {
  const tdCfg = getGameCfg().towerDefenseRules
  if (!tdCfg || tdCfg.enabled === false) return 0
  const defId = towerEnemyDefIdByUnitId.get(unitId)
  const enemyDef = (tdCfg.enemyDefs ?? []).find((it) => it.id === defId)
  const defDrop = Number(enemyDef?.killGold)
  if (Number.isFinite(defDrop)) return Math.max(0, Math.round(defDrop))
  const isBoss = Math.max(1, Math.round(Number(enemyDef?.laneOccupyCount) || 1)) >= 3
    || String(enemyDef?.id || '').includes('boss')
    || String(enemyDef?.name || '').includes('首领')
  return Math.max(0, Math.round(isBoss ? tdCfg.enemyKillGoldBoss : tdCfg.enemyKillGold))
}

function spawnTowerEnemyGoldDropFx(x: number, y: number, amount: number): void {
  if (!towerGoldDropLayer || amount <= 0) return
  const tdCfg = getGameCfg().towerDefenseRules
  const lifeMs = Math.max(120, Math.round(Number(tdCfg?.enemyKillGoldFxMs) || 700))
  const risePx = Math.max(8, Math.round(Number(tdCfg?.enemyKillGoldFxRisePx) || 44))
  const con = new Container()
  con.eventMode = 'none'
  con.x = x
  con.y = y
  con.zIndex = 0
  const icon = new Text({
    text: '💰',
    style: {
      fontSize: getGameCfg().textSizes.gold,
      fill: 0xffd45a,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      stroke: { color: 0x000000, width: 3 },
    },
  })
  icon.anchor.set(0.5)
  const add = new Text({
    text: `+${Math.max(0, Math.round(amount))}`,
    style: {
      fontSize: getGameCfg().textSizes.battleTextDamage,
      fill: 0xffe28a,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      stroke: { color: 0x000000, width: 3 },
    },
  })
  add.anchor.set(0, 0.5)
  add.x = Math.max(4, icon.width * 0.55)
  con.addChild(icon)
  con.addChild(add)
  towerGoldDropLayer.addChild(con)
  towerGoldDropFxStates.push({ con, bornMs: battlePresentationMs, lifeMs, risePx, startY: y })
}

function tickTowerEnemyGoldDropFx(): void {
  if (towerGoldDropFxStates.length <= 0) return
  for (let i = towerGoldDropFxStates.length - 1; i >= 0; i--) {
    const one = towerGoldDropFxStates[i]
    if (!one) continue
    const elapsed = Math.max(0, battlePresentationMs - one.bornMs)
    const p = Math.max(0, Math.min(1, elapsed / Math.max(1, one.lifeMs)))
    const eased = 1 - Math.pow(1 - p, 3)
    one.con.y = one.startY - one.risePx * eased
    one.con.alpha = 1 - p
    if (p < 1) continue
    one.con.parent?.removeChild(one.con)
    one.con.destroy({ children: true })
    towerGoldDropFxStates.splice(i, 1)
  }
}

function clearTowerEnemyGoldDropFx(): void {
  while (towerGoldDropFxStates.length > 0) {
    const one = towerGoldDropFxStates.pop()
    if (!one) continue
    one.con.parent?.removeChild(one.con)
    one.con.destroy({ children: true })
  }
}

async function startNextTowerWaveInPlace(options?: { showNewEnemyToast?: boolean }): Promise<void> {
  if (!engine || towerWaveAdvanceInProgress) return
  if (draggingPlayerItemId) {
    if (towerNextWaveAutoStartAtMs !== null) {
      towerNextWaveAutoStartAtMs = battlePresentationMs + 250
    }
    return
  }
  towerNextWaveAutoStartAtMs = null
  towerWaveTriggerConsumed = false
  towerWaveStartAtMs = battlePresentationMs
  const preserveExistingEnemies = !engine.isFinished()
  const baseSnapshot = buildEditableSnapshotFromBoard(battleDay)
  if (!baseSnapshot) return
  const nextDay = Math.max(1, Math.round((baseSnapshot.day || 1) + 1))
  const zoneExpanded = false
  const useTowerQueueWave = isTowerDefenseBattle() && !!engine.queueNextTowerWave
  emitDiagEvent('tower_wave_advance_start', {
    fromDay: battleDay,
    nextDay,
    preserveExistingEnemies,
    useTowerQueueWave,
    zoneExpanded,
    draggingPlayerItemId: draggingPlayerItemId ?? '',
  })
  const nextSnapshot = {
    ...baseSnapshot,
    day: nextDay,
    createdAtMs: Date.now(),
    playerGold: Math.max(0, Math.round(baseSnapshot.playerGold ?? 0)),
  }

  towerWaveAdvanceInProgress = true
  try {
    const warmupStartedAt = performance.now()
    emitDiagEvent('tower_wave_warmup_start', { nextDay }, { level: 'verbose' })
    if (useTowerQueueWave) {
      void ensureTowerEnemyProjectileAssetWarmupForDay(nextDay)
        .then(() => {
          emitDiagEvent('tower_wave_warmup_done', {
            nextDay,
            elapsedMs: Math.round(performance.now() - warmupStartedAt),
            background: true,
          }, { level: 'verbose' })
        })
        .catch((err) => {
          emitDiagEvent('tower_wave_warmup_error', {
            nextDay,
            background: true,
            message: err instanceof Error ? err.message : String(err),
          })
        })
    } else {
      await ensureTowerEnemyProjectileAssetWarmupForDay(nextDay)
      emitDiagEvent('tower_wave_warmup_done', {
        nextDay,
        elapsedMs: Math.round(performance.now() - warmupStartedAt),
        background: false,
      }, { level: 'verbose' })
    }
    setBattleSnapshot(nextSnapshot)
    enteredSnapshot = nextSnapshot
    battleDay = nextDay
    editableSystem?.setActiveRows(getTowerBattleRowsForCurrentExpandStep())
    editableGold = Math.max(0, Math.round(nextSnapshot.playerGold ?? 0))
    clearBattleItemSelection()
    if (settlement.isResolved()) settlement.prepareForNextWave()
    settlementRevealAtMs = null
    if (!preserveExistingEnemies) battleReplaySaved = false
    if (!preserveExistingEnemies) resetTowerEnemyPresentationForNextWave()
    clearTowerEnemyGoldDropFx()
    if (!preserveExistingEnemies) clearItemRoundStatTracking()

    if (useTowerQueueWave && engine.queueNextTowerWave) {
      engine.queueNextTowerWave(nextDay)
      emitDiagEvent('tower_wave_queued', {
        nextDay,
        queueMode: true,
      })
    } else {
      const playerSkillIds = (PvpContext.isActive() && nextSnapshot.ownerSkillIds != null)
        ? nextSnapshot.ownerSkillIds
        : (skillUI?.getPickedSkills().map((s) => s.id) ?? [])
      engine.start(nextSnapshot, {
        playerSkillIds,
        enemySkillIds: nextSnapshot.pvpEnemySkillIds ?? [],
        enemyBackpackItemCount: nextSnapshot.pvpEnemyBackpackItemCount,
        enemyGold: nextSnapshot.pvpEnemyGold,
        enemyTrophyWins: nextSnapshot.pvpEnemyTrophyWins,
      })
      syncTowerBattleSkillPickCountsToEngine()
      damageStats.bootstrapFromBoard(engine)
      emitDiagEvent('tower_wave_queued', {
        nextDay,
        queueMode: false,
      })
    }
    if (options?.showNewEnemyToast) {
      showFatigueToast('新的敌人刷新了', 1200)
    }
    ensureEditableBuildMode(getApp().stage)
    fxPool.refreshSourceDefMap()
    emitDiagEvent('tower_wave_advance_done', {
      day: battleDay,
      nextDay,
      preserveExistingEnemies,
      zoneExpanded,
      playerGold: editableGold,
    })
  } catch (err) {
    emitDiagEvent('tower_wave_advance_error', {
      day: battleDay,
      message: err instanceof Error ? err.message : String(err),
    })
    throw err
  } finally {
    towerWaveAdvanceInProgress = false
  }
}

function makeBuyButton(): Container {
  const con = new Container()
  const pulse = new Graphics()
  pulse.visible = false
  con.addChild(pulse)
  buyBtnPulseFrame = pulse
  const bg = new Graphics()
  buyBtnBg = bg
  const w = TOWER_BOTTOM_ACTION_BTN_W
  const h = TOWER_BOTTOM_ACTION_BTN_H
  const corner = Math.max(10, Math.round(getDebugCfg('gridItemCornerRadius') + 8))
  bg.roundRect(-w / 2, -h / 2, w, h, corner)
  bg.stroke({ color: 0x44aaff, width: 3 })
  bg.fill({ color: 0x44aaff, alpha: 0.18 })
  con.addChild(bg)
  const txt = new Text({
    text: formatTowerBattleBuyButtonText(editableGold, getTowerBattleBuyCost(), getTowerBattleBuyOfferLevel()),
    style: {
      fontSize: getGameCfg().textSizes.phaseButtonLabel,
      fill: 0x44aaff,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      align: 'center',
    },
  })
  txt.anchor.set(0.5)
  con.addChild(txt)
  buyBtnAffordVisualState = null
  redrawTowerBattleBuyButtonVisual(false)
  buyBtnText = txt
  con.eventMode = 'static'
  con.cursor = 'pointer'
  con.on('pointerdown', async () => {
    if (!engine || !playerZone || !editableSystem) return
    if (transition.battleExitTransitionDurationMs > 0) return
    const offer = pendingBattleBuyOffer ?? rollBattleBuyOffer(battleDay)
    if (!offer) return
    pendingBattleBuyOffer = offer
    const cost = getTowerBattleBuyCost()
    if (editableGold < cost) {
      showFatigueToast('金币不足')
      return
    }
    const size = normalizeSize(offer.item.size)
    const slot = pickFirstEmptyCell(editableSystem, size, playerZone.activeColCount)
    if (!slot) {
      showFatigueToast('上阵区已满')
      return
    }
    const id = `b-${Date.now()}-${Math.floor(Math.random() * 9999)}`
    if (!editableSystem.place(slot.col, slot.row, size, offer.item.id, id)) return
    editableGold -= cost
    towerBattleBuyCount += 1
    activateTowerPreFirstAttackSpeedBoost()
    editableMeta.set(id, {
      defId: offer.item.id,
      size,
      tier: offer.tier,
      tierStar: offer.star,
      quality: offer.tier,
      level: offer.level,
      permanentDamageBonus: 0,
    })
    const persistNow = buildEditableSnapshotFromBoard(battleDay)
    if (persistNow) {
      enteredSnapshot = persistNow
      setBattleSnapshot(persistNow)
    }
    await playerZone.addItem(id, offer.item.id, size, slot.col, slot.row, `${offer.tier}#${offer.star}`)
    playerZone.setItemTier(id, `${offer.tier}#${offer.star}`)
    editableDrag?.refreshZone(playerZone)
    syncEngineWithEditable([id])
    pendingBattleBuyOffer = null
    void getTowerBattleBuyCost()
  })
  return con
}

function makeSkillBuyButton(): Container {
  const con = new Container()
  const pulse = new Graphics()
  pulse.visible = false
  con.addChild(pulse)
  skillBuyBtnPulseFrame = pulse
  const bg = new Graphics()
  skillBuyBtnBg = bg
  const w = TOWER_BOTTOM_ACTION_BTN_W
  const h = TOWER_BOTTOM_ACTION_BTN_H
  const corner = Math.max(10, Math.round(getDebugCfg('gridItemCornerRadius') + 8))
  bg.roundRect(-w / 2, -h / 2, w, h, corner)
  bg.stroke({ color: 0x6fd0ff, width: 3 })
  bg.fill({ color: 0x6fd0ff, alpha: 0.16 })
  con.addChild(bg)

  const txt = new Text({
    text: formatTowerBattleSkillBuyButtonText(editableGold, getTowerBattleSkillBuyCost(), getTowerBattleSkillBuyUnlockItemCount()),
    style: {
      fontSize: getGameCfg().textSizes.phaseButtonLabel,
      fill: 0x6fd0ff,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      align: 'center',
    },
  })
  txt.anchor.set(0.5)
  con.addChild(txt)
  skillBuyBtnText = txt
  skillBuyBtnLastCanAfford = null
  skillBuyBtnAffordPulseStartAtMs = null
  redrawTowerBattleSkillBuyButtonVisual(false, false)

  con.eventMode = 'static'
  con.cursor = 'pointer'
  con.on('pointerdown', () => {
    if (!engine || !editableSystem || !playerZone || towerSkillDraftOverlay) return
    if (transition.battleExitTransitionDurationMs > 0) return
    const unlockCount = getTowerBattleSkillBuyUnlockItemCount()
    if (towerBattleBuyCount < unlockCount) {
      showFatigueToast(`购买${unlockCount}件后解锁`) 
      return
    }
    const cost = getTowerBattleSkillBuyCost()
    if (editableGold < cost) {
      showFatigueToast('金币不足')
      return
    }
    const choices = pickTowerBattleSkillDraftChoices()
    if (choices.length <= 0) {
      showFatigueToast('暂无可选技能')
      return
    }
    editableGold -= cost
    towerBattleSkillBuyCount += 1
    const persistBuy = buildEditableSnapshotFromBoard(battleDay)
    if (persistBuy) {
      enteredSnapshot = persistBuy
      setBattleSnapshot(persistBuy)
    }
    openTowerSkillDraftOverlay(choices, (picked) => {
      const cur = Math.max(0, Math.round(towerBattleSkillPickCounts.get(picked.id) ?? 0))
      towerBattleSkillPickCounts.set(picked.id, cur + 1)
      syncTowerBattleSkillPickCountsToEngine()
      const persistAfterPick = buildEditableSnapshotFromBoard(battleDay)
      if (persistAfterPick) {
        enteredSnapshot = persistAfterPick
        setBattleSnapshot(persistAfterPick)
      }
      refreshTowerBattleSkillDisplay(true)
    })
  })
  return con
}

function ensureEditableBuildMode(stage: Container): void {
  if (!playerZone) return
  const battleRows = isTowerDefenseBattle() ? getTowerBattleRowsForCurrentExpandStep() : 3
  if (!editableSystem) editableSystem = new GridSystem(6, 3)
  editableSystem.setActiveRows(battleRows)
  editableSystem.clear()
  editableMeta.clear()
  const maxLevel = getTowerItemSynthesisMaxLevel()
  const sourceEntities = enteredSnapshot?.entities ?? []
  for (const one of sourceEntities) {
    editableSystem.place(one.col, one.row, one.size as GridItemSizeNorm, one.defId, one.instanceId)
    const tier = (one.tier ?? 'Bronze') as TierKey
    const tierStar = (one.tierStar ?? 1) as 1 | 2
    const normalizedLevel = Math.max(1, Math.min(maxLevel, Number(one.level) || tierStarToTowerLevel(tier, tierStar))) as 1 | 2 | 3 | 4 | 5
    editableMeta.set(one.instanceId, {
      defId: one.defId,
      size: one.size as GridItemSizeNorm,
      tier,
      tierStar,
      quality: one.quality ?? tier,
      level: normalizedLevel,
      permanentDamageBonus: one.permanentDamageBonus ?? 0,
    })
  }
  editableGold = Math.max(0, Math.round(enteredSnapshot?.playerGold ?? getEditableStartGold(battleDay)))
  towerBattleBuyCount = Math.max(0, Math.round(enteredSnapshot?.towerBattleBuyCount ?? 0))
  towerBattleSkillBuyCount = Math.max(0, Math.round(enteredSnapshot?.towerBattleSkillBuyCount ?? 0))
  towerBattleZoneExpandStep = inferTowerZoneExpandStepFromSnapshot(enteredSnapshot)
  syncTowerPlayerHpBarRowYOffset(false)
  towerBattleSkillPickCounts.clear()
  if (enteredSnapshot?.towerBattleSkillPickCounts && typeof enteredSnapshot.towerBattleSkillPickCounts === 'object') {
    for (const [k, v] of Object.entries(enteredSnapshot.towerBattleSkillPickCounts)) {
      const n = Math.max(0, Math.round(Number(v) || 0))
      if (n > 0) towerBattleSkillPickCounts.set(k, n)
    }
  }
  pendingBattleBuyOffer = null
  buyBtnLastCanAfford = editableGold >= getTowerBattleBuyCost()
  buyBtnAffordPulseStartAtMs = null
  buyBtnAffordVisualState = null
  towerZoneExpandBtnLastCanAfford = null
  towerZoneExpandBtnAffordPulseStartAtMs = null
  towerZoneExpandBtnAffordVisualState = null
  skillBuyBtnLastCanAfford = editableGold >= getTowerBattleSkillBuyCost() && towerBattleBuyCount >= getTowerBattleSkillBuyUnlockItemCount()
  skillBuyBtnAffordPulseStartAtMs = null
  void getTowerBattleBuyCost()

  if (!editableDrag) {
    editableDrag = new DragController(stage, getApp().canvas)
    editableDrag.setRearrangeSuppressed(true)
    editableDrag.addZone(editableSystem, playerZone)
    editableDrag.onDragStart = (instanceId) => {
      draggingPlayerItemId = instanceId
      draggingPlayerItemFirePoint = fxPool.getItemCenterById(instanceId, 'player') ?? null
      editableMergeHoverTargetId = null
      playerZone?.setSelected(null)
      playerZone?.clearHighlight()
      refreshBattleSynthesisGuideArrows(null)
      showBattleItemInfo(instanceId, 'player', true)
      playerZone?.setSelected(null)
    }
    editableDrag.onDragMove = ({ instanceId, anchorGx, anchorGy, size }) => {
      refreshBattleSynthesisGuideArrows(instanceId)
      const hoverTargetId = findSynthesisHoverTargetInBattle(instanceId, anchorGx, anchorGy, size)
      if (hoverTargetId !== editableMergeHoverTargetId) {
        editableMergeHoverTargetId = hoverTargetId
        if (hoverTargetId && editableSystem) {
          const t = editableSystem.getItem(hoverTargetId)
          if (t) {
            playerZone?.highlightCells(t.col, t.row, t.size, true, getShopUiColor('gold'))
            showBattleSynthesisPreviewInfo(instanceId, hoverTargetId)
          }
        } else {
          playerZone?.setSelected(null)
          playerZone?.clearHighlight()
          showBattleItemInfo(instanceId, 'player', false)
          playerZone?.setSelected(null)
        }
      }
    }
    editableDrag.onMergeDrop = ({ sourceInstanceId, targetInstanceId, homeSystem, homeView }) => {
      if (transition.battleExitTransitionDurationMs > 0) return false
      return applyBattleSynthesis(sourceInstanceId, targetInstanceId, homeSystem, homeView)
    }
    editableDrag.onSpecialDrop = ({ instanceId, anchorGx, anchorGy, size, homeSystem, homeView }) => {
      if (transition.battleExitTransitionDurationMs > 0) return false
      const targetId = findSynthesisHoverTargetInBattle(instanceId, anchorGx, anchorGy, size)
      if (!targetId) return false
      return applyBattleSynthesis(instanceId, targetId, homeSystem, homeView)
    }
    editableDrag.onDragEnd = () => {
      draggingPlayerItemId = null
      draggingPlayerItemFirePoint = null
      editableMergeHoverTargetId = null
      playerZone?.setSelected(null)
      playerZone?.clearHighlight()
      refreshBattleSynthesisGuideArrows(null)
      clearBattleItemSelection()
      syncEngineWithEditable()
    }
  } else {
    editableDrag.refreshZone(playerZone)
  }
  playerZone.onTap = (id) => showBattleItemInfo(id, 'player')

  const normalized = buildEditableSnapshotFromBoard(battleDay)
  if (normalized) {
    enteredSnapshot = normalized
    setBattleSnapshot(normalized)
    syncEngineWithEditable()
  }
  refreshTowerBattleSkillDisplay(true)
}

function organizeBattleZoneItemsByRule(): void {
  if (!editableSystem || !playerZone) return
  const getItemLevel = (instanceId: string): number => {
    const meta = editableMeta.get(instanceId)
    const fromLevel = Math.max(1, Math.round(Number(meta?.level) || 0))
    if (fromLevel > 0) return fromLevel
    return tierStarLevelIndex(meta?.tier ?? 'Bronze', meta?.tierStar ?? 1) + 1
  }
  const getItemArchetypeKey = (defId: string): string => {
    const def = getItemDefById(defId)
    return toSkillArchetype(getPrimaryArchetype(def?.tags ?? '')) ?? 'unknown'
  }
  const getBaseTierRank = (defId: string): number => {
    const def = getItemDefById(defId)
    const baseTier = parseTierName(def?.starting_tier ?? '') ?? 'Bronze'
    const idx = TIER_ORDER.indexOf(baseTier)
    return idx >= 0 ? idx : 0
  }
  const items = editableSystem.getAllItems()
  if (items.length <= 1) {
    showFatigueToast('上阵区已整理')
    return
  }
  const archetypeTotalLevels = new Map<string, number>()
  for (const it of items) {
    const arch = getItemArchetypeKey(it.defId)
    archetypeTotalLevels.set(arch, (archetypeTotalLevels.get(arch) ?? 0) + getItemLevel(it.instanceId))
  }
  const sorted = [...items].sort((a, b) => {
    const aArch = getItemArchetypeKey(a.defId)
    const bArch = getItemArchetypeKey(b.defId)
    const aArchTotal = archetypeTotalLevels.get(aArch) ?? 0
    const bArchTotal = archetypeTotalLevels.get(bArch) ?? 0
    if (aArchTotal !== bArchTotal) return bArchTotal - aArchTotal
    const archCmp = getArchetypeSortOrder(a.defId) - getArchetypeSortOrder(b.defId)
    if (archCmp !== 0) return archCmp
    const aLv = getItemLevel(a.instanceId)
    const bLv = getItemLevel(b.instanceId)
    if (aLv !== bLv) return bLv - aLv
    const aBaseTierRank = getBaseTierRank(a.defId)
    const bBaseTierRank = getBaseTierRank(b.defId)
    if (aBaseTierRank !== bBaseTierRank) return bBaseTierRank - aBaseTierRank
    const idCmp = a.defId.localeCompare(b.defId)
    if (idCmp !== 0) return idCmp
    return a.instanceId.localeCompare(b.instanceId)
  })
  const cols = Math.max(1, playerZone.activeColCount)
  const rows = Math.max(1, editableSystem.getActiveRows())
  const maxSlots = cols * rows
  const packItems: PackItem[] = sorted.map((it, idx) => ({
    instanceId: it.instanceId,
    defId: it.defId,
    size: it.size,
    preferredCol: idx % cols,
    preferredRow: Math.min(rows - 1, Math.floor(idx / cols)),
  }))
  if (packItems.length > maxSlots) {
    showFatigueToast('整理失败：上阵区空间不足')
    return
  }
  const plan = planAutoPack(packItems, cols, rows)
  if (!plan) {
    showFatigueToast('整理失败')
    return
  }
  const oldById = new Map(items.map((it) => [it.instanceId, it] as const))
  editableSystem.clear()
  for (const p of plan) {
    editableSystem.place(p.col, p.row, p.size, p.defId, p.instanceId)
  }
  const moveMs = Math.max(1, getDebugCfg('squeezeMs'))
  for (const p of plan) {
    const old = oldById.get(p.instanceId)
    if (!old) continue
    if (old.col !== p.col || old.row !== p.row) playerZone.animateToCell(p.instanceId, p.col, p.row, moveMs)
  }
  editableDrag?.refreshZone(playerZone)
  syncEngineWithEditable()
  showFatigueToast('上阵区已按职业总等级整理')
}

function makeTopRectActionButton(label: string, onTap: () => void): { container: Container; labelText: Text } {
  const con = new Container()
  const bg = new Graphics()
  const corner = Math.max(10, Math.round(getDebugCfg('gridItemCornerRadius') + 8))
  bg.roundRect(-TOP_ACTION_BTN_W / 2, -TOP_ACTION_BTN_H / 2, TOP_ACTION_BTN_W, TOP_ACTION_BTN_H, corner)
  bg.stroke({ color: 0x44aaff, width: 3 })
  bg.fill({ color: 0x44aaff, alpha: 0.18 })
  con.addChild(bg)
  const txt = new Text({
    text: label,
    style: { fontSize: getGameCfg().textSizes.phaseButtonLabel, fill: 0x44aaff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  txt.anchor.set(0.5)
  con.addChild(txt)
  con.y = getClampedTopActionBtnY()
  con.zIndex = 185
  con.eventMode = 'static'
  con.cursor = 'pointer'
  con.on('pointerdown', onTap)
  return { container: con, labelText: txt }
}

function makeSpeedButton(): Container {
  const ui = makeTopRectActionButton(`倍速:${battleSpeed}x`, () => {
    if (towerPreFirstAttackSpeedBoostActive) return
    const idx = BATTLE_SPEED_STEPS.indexOf(battleSpeed as (typeof BATTLE_SPEED_STEPS)[number])
    const next = BATTLE_SPEED_STEPS[(idx + 1) % BATTLE_SPEED_STEPS.length] ?? 1
    battleSpeed = next
    if (speedBtnText) speedBtnText.text = `倍速:${battleSpeed}x`
  })
  speedBtnText = ui.labelText
  ui.container.x = CANVAS_W - 92
  return ui.container
}

function makeOrganizeButton(): Container {
  if (isTowerDefenseBattle()) {
    const con = new Container()
    const pulse = new Graphics()
    pulse.visible = false
    con.addChild(pulse)
    towerZoneExpandBtnPulseFrame = pulse
    const bg = new Graphics()
    towerZoneExpandBtnBg = bg
    const w = TOWER_BOTTOM_ACTION_BTN_W
    const h = TOWER_BOTTOM_ACTION_BTN_H
    const corner = Math.max(10, Math.round(getDebugCfg('gridItemCornerRadius') + 8))
    bg.roundRect(-w / 2, -h / 2, w, h, corner)
    bg.stroke({ color: 0x44aaff, width: 3 })
    bg.fill({ color: 0x44aaff, alpha: 0.18 })
    con.addChild(bg)
    const txt = new Text({
      text: formatTowerZoneExpandButtonText(editableGold, getTowerZoneExpandBuyCost(), getTowerZoneExpandBuyUnlockItemCount()),
      style: { fontSize: getGameCfg().textSizes.phaseButtonLabel, fill: 0x44aaff, fontFamily: 'Arial', fontWeight: 'bold', align: 'center' },
    })
    txt.anchor.set(0.5)
    con.addChild(txt)
    towerZoneExpandBtnText = txt
    redrawTowerZoneExpandButtonVisual(false, false, true)
    con.eventMode = 'static'
    con.cursor = 'pointer'
    con.zIndex = 190
    con.on('pointerdown', () => {
      if (!isTowerDefenseBattle() || !playerZone) return
      const unlockCount = getTowerZoneExpandBuyUnlockItemCount()
      if (towerBattleBuyCount < unlockCount) {
        showFatigueToast(`购买${unlockCount}件后解锁`)
        return
      }
      const next = getTowerZoneExpandNextStage()
      if (!next) {
        showFatigueToast('背包扩容已满级')
        return
      }
      const cost = getTowerZoneExpandBuyCost()
      if (editableGold < cost) {
        showFatigueToast('金币不足')
        return
      }
      editableGold -= cost
      const prevCols = Math.max(1, playerZone.activeColCount)
      const prevRows = Math.max(1, playerZone.activeRowCount)
      towerBattleZoneExpandStep = getTowerZoneExpandCurrentStep() + 1
      const expandedCols = getTowerBattleColsForCurrentExpandStep()
      const expandedRows = getTowerBattleRowsForCurrentExpandStep()
      editableSystem?.setActiveRows(expandedRows)
      if (prevCols !== expandedCols || prevRows !== expandedRows) {
        startPlayerZoneResizeTransition(expandedCols, expandedRows, { countsAlreadyApplied: true })
      }
      playerZone.setActiveColCount(expandedCols)
      playerZone.setActiveRowCount(expandedRows)
      applyZoneVisualStyle(playerZone, 'player')
      syncTowerPlayerHpBarRowYOffset(true)
      const persistNow = buildEditableSnapshotFromBoard(battleDay)
      if (persistNow) {
        enteredSnapshot = persistNow
        setBattleSnapshot(persistNow)
      }
      showFatigueToast('背包扩容成功', 900)
    })
    return con
  }
  const ui = makeTopRectActionButton('整理', () => {
    organizeBattleZoneItemsByRule()
  })
  ui.container.x = 92
  ui.container.y = getClampedTopActionBtnY('battleOrganizeBtnY')
  return ui.container
}

function closeBattleItemTestOverlay(): void {
  if (!battleItemTestOverlay) return
  if (battleItemTestOverlay.parent) battleItemTestOverlay.parent.removeChild(battleItemTestOverlay)
  battleItemTestOverlay.destroy({ children: true })
  battleItemTestOverlay = null
}

function closeBattleSkillTestOverlay(): void {
  if (!battleSkillTestOverlay) return
  if (battleSkillTestOverlay.parent) battleSkillTestOverlay.parent.removeChild(battleSkillTestOverlay)
  battleSkillTestOverlay.destroy({ children: true })
  battleSkillTestOverlay = null
}

function applyBattleSkillTestSync(): void {
  syncTowerBattleSkillPickCountsToEngine()
  const snap = buildEditableSnapshotFromBoard(battleDay)
  if (snap) {
    enteredSnapshot = snap
    setBattleSnapshot(snap)
  }
  refreshTowerBattleSkillDisplay(true)
}

function makeSkillTestButton(): Container {
  const con = new Container()
  const bg = new Graphics()
  const corner = Math.max(10, Math.round(getDebugCfg('gridItemCornerRadius') + 8))
  bg.roundRect(-TOP_ACTION_BTN_W / 2, -TOP_ACTION_BTN_H / 2, TOP_ACTION_BTN_W, TOP_ACTION_BTN_H, corner)
  bg.fill({ color: 0x44aaff, alpha: 0.18 })
  bg.stroke({ color: 0x44aaff, width: 3 })
  const txt = new Text({ text: '技能测试', style: { fontSize: getGameCfg().textSizes.phaseButtonLabel, fill: 0x44aaff, fontFamily: 'Arial', fontWeight: 'bold' } })
  txt.anchor.set(0.5)
  con.addChild(bg, txt)
  con.eventMode = 'static'
  con.cursor = 'pointer'
  con.zIndex = 195
  con.on('pointerdown', (e) => {
    e.stopPropagation()
    if (!root) return
    if (battleSkillTestOverlay) {
      closeBattleSkillTestOverlay()
      return
    }

    const overlay = new Container()
    overlay.zIndex = 7601
    overlay.eventMode = 'static'
    const mask = new Graphics()
    mask.rect(0, 0, CANVAS_W, CANVAS_H)
    mask.fill({ color: 0x020409, alpha: 0.72 })
    overlay.addChild(mask)

    const panel = new Container()
    panel.x = CANVAS_W / 2
    panel.y = CANVAS_H / 2 + 8
    panel.eventMode = 'static'
    panel.on('pointerdown', (pe) => pe.stopPropagation())
    overlay.addChild(panel)

    const panelW = 620
    const panelH = 1080
    const panelBg = new Graphics()
    panelBg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 22)
    panelBg.fill({ color: 0x20153a, alpha: 0.98 })
    panelBg.stroke({ color: 0xcfb2ff, width: 3, alpha: 0.95 })
    panel.addChild(panelBg)

    const title = new Text({ text: '技能测试（塔防战斗）', style: { fontSize: 34, fill: 0xf2eaff, fontFamily: 'Arial', fontWeight: 'bold' } })
    title.anchor.set(0.5)
    title.y = -486
    panel.addChild(title)

    const hint = new Text({ text: '点击技能行 +1（超上限会回到0）', style: { fontSize: 20, fill: 0xcfc0ef, fontFamily: 'Arial', fontWeight: 'bold' } })
    hint.anchor.set(0.5)
    hint.y = -446
    panel.addChild(hint)

    const makeActionBtn = (label: string, x: number, y: number, fill: number, stroke: number, onTap: () => void) => {
      const btn = new Container()
      btn.x = x
      btn.y = y
      btn.eventMode = 'static'
      btn.cursor = 'pointer'
      const g = new Graphics()
      g.roundRect(-90, -28, 180, 56, 14)
      g.fill({ color: fill, alpha: 0.95 })
      g.stroke({ color: stroke, width: 3, alpha: 0.95 })
      const t = new Text({ text: label, style: { fontSize: 24, fill: 0xf3f7ff, fontFamily: 'Arial', fontWeight: 'bold' } })
      t.anchor.set(0.5)
      btn.addChild(g, t)
      btn.on('pointerdown', (evt) => {
        evt.stopPropagation()
        onTap()
      })
      panel.addChild(btn)
    }

    const listCon = new Container()
    listCon.y = -382
    panel.addChild(listCon)

    const rowsPerPage = 11
    let pageIndex = 0
    let pagePrevBtn: Container | null = null
    let pageNextBtn: Container | null = null
    let pageLabel: Text | null = null

    const makePageBtn = (label: string, x: number, onTap: () => void): Container => {
      const btn = new Container()
      btn.x = x
      btn.y = -410
      btn.eventMode = 'static'
      btn.cursor = 'pointer'
      const g = new Graphics()
      g.roundRect(-42, -22, 84, 44, 12)
      g.fill({ color: 0x3f2f62, alpha: 0.95 })
      g.stroke({ color: 0xbda6e8, width: 2, alpha: 0.95 })
      const t = new Text({ text: label, style: { fontSize: 26, fill: 0xf2eaff, fontFamily: 'Arial', fontWeight: 'bold' } })
      t.anchor.set(0.5)
      btn.addChild(g, t)
      btn.on('pointerdown', (evt) => {
        evt.stopPropagation()
        onTap()
      })
      panel.addChild(btn)
      return btn
    }

    pagePrevBtn = makePageBtn('上一页', -110, () => {
      pageIndex = Math.max(0, pageIndex - 1)
      redrawList()
    })
    pageNextBtn = makePageBtn('下一页', 110, () => {
      pageIndex += 1
      redrawList()
    })
    pageLabel = new Text({ text: '1/1', style: { fontSize: 22, fill: 0xd7e4ff, fontFamily: 'Arial', fontWeight: 'bold' } })
    pageLabel.anchor.set(0.5)
    pageLabel.y = -410
    panel.addChild(pageLabel)

    const redrawList = () => {
      listCon.removeChildren().forEach((c) => c.destroy({ children: true }))
      const rows = TOWER_BATTLE_SKILL_DEFS
      const pageCount = Math.max(1, Math.ceil(rows.length / rowsPerPage))
      pageIndex = Math.max(0, Math.min(pageCount - 1, pageIndex))
      const start = pageIndex * rowsPerPage
      const pageRows = rows.slice(start, start + rowsPerPage)
      if (pageLabel) pageLabel.text = `${pageIndex + 1}/${pageCount}`
      if (pagePrevBtn) {
        pagePrevBtn.alpha = pageIndex > 0 ? 1 : 0.45
        pagePrevBtn.cursor = pageIndex > 0 ? 'pointer' : 'default'
      }
      if (pageNextBtn) {
        pageNextBtn.alpha = pageIndex < pageCount - 1 ? 1 : 0.45
        pageNextBtn.cursor = pageIndex < pageCount - 1 ? 'pointer' : 'default'
      }
      const rowH = 72
      for (let i = 0; i < pageRows.length; i++) {
        const one = pageRows[i]!
        const y = i * rowH
        const row = new Container()
        row.y = y
        row.eventMode = 'static'
        row.cursor = 'pointer'
        const bgRow = new Graphics()
        bgRow.roundRect(-280, 0, 560, 62, 12)
        bgRow.fill({ color: i % 2 === 0 ? 0x34244f : 0x2a1d41, alpha: 0.95 })
        bgRow.stroke({ color: 0x8f73c8, width: 2, alpha: 0.8 })
        row.addChild(bgRow)

        const iconRing = new Graphics()
        iconRing.circle(-246, 31, 23)
        iconRing.fill({ color: 0x000000, alpha: 0.8 })
        row.addChild(iconRing)
        const iconFallback = new Text({ text: one.archetype.slice(0, 1), style: { fontSize: 18, fill: 0xeef4ff, fontFamily: 'Arial', fontWeight: 'bold' } })
        iconFallback.anchor.set(0.5)
        iconFallback.x = -246
        iconFallback.y = 31
        row.addChild(iconFallback)
        mountTowerItemIconSprite(row, one.icon, -246, 31, 34, iconFallback)

        const name = new Text({ text: getTowerSkillDisplayName(one.id, one.name), style: { fontSize: 24, fill: 0xf5e7bf, fontFamily: 'Arial', fontWeight: 'bold' } })
        name.x = -206
        name.y = 15
        row.addChild(name)

        const cur = Math.max(0, Math.round(towerBattleSkillPickCounts.get(one.id) ?? 0))
        const countTxt = new Text({ text: `${cur}/${one.maxPick}`, style: { fontSize: 24, fill: 0xd7e4ff, fontFamily: 'Arial', fontWeight: 'bold' } })
        countTxt.anchor.set(1, 0.5)
        countTxt.x = 250
        countTxt.y = 31
        row.addChild(countTxt)

        row.on('pointerdown', (evt) => {
          evt.stopPropagation()
          const now = Math.max(0, Math.round(towerBattleSkillPickCounts.get(one.id) ?? 0))
          const next = now >= one.maxPick ? 0 : now + 1
          if (next <= 0) towerBattleSkillPickCounts.delete(one.id)
          else towerBattleSkillPickCounts.set(one.id, next)
          applyBattleSkillTestSync()
          redrawList()
        })
        listCon.addChild(row)
      }
    }

    makeActionBtn('全部点满', -180, 472, 0x6a4fa8, 0xcfb2ff, () => {
      for (const one of TOWER_BATTLE_SKILL_DEFS) towerBattleSkillPickCounts.set(one.id, one.maxPick)
      applyBattleSkillTestSync()
      redrawList()
    })
    makeActionBtn('全部清空', 0, 472, 0x5f4f73, 0xb9a7d0, () => {
      towerBattleSkillPickCounts.clear()
      applyBattleSkillTestSync()
      redrawList()
    })
    makeActionBtn('关闭', 180, 472, 0x3f5f8f, 0x9fc5ff, () => {
      closeBattleSkillTestOverlay()
    })

    redrawList()
    overlay.on('pointerdown', () => closeBattleSkillTestOverlay())
    root.addChild(overlay)
    battleSkillTestOverlay = overlay
  })
  return con
}

function makeTopLeftFoldButton(): Container {
  const con = new Container()
  const bg = new Graphics()
  const corner = Math.max(10, Math.round(getDebugCfg('gridItemCornerRadius') + 8))
  bg.roundRect(-TOP_ACTION_BTN_W / 2, -TOP_ACTION_BTN_H / 2, TOP_ACTION_BTN_W, TOP_ACTION_BTN_H, corner)
  bg.stroke({ color: 0x44aaff, width: 3 })
  bg.fill({ color: 0x44aaff, alpha: 0.18 })
  const txt = new Text({ text: '▶', style: { fontSize: getGameCfg().textSizes.phaseButtonLabel, fill: 0x44aaff, fontFamily: 'Arial', fontWeight: 'bold' } })
  txt.anchor.set(0.5)
  con.addChild(bg, txt)
  topLeftFoldBtnText = txt
  con.eventMode = 'static'
  con.cursor = 'pointer'
  con.zIndex = 196
  con.on('pointerdown', (e) => {
    e.stopPropagation()
    topLeftButtonsExpanded = !topLeftButtonsExpanded
    if (topLeftFoldBtnText) topLeftFoldBtnText.text = topLeftButtonsExpanded ? '◀' : '▶'
  })
  return con
}

function addBattleTestItemAtLevel(def: ItemDef, level: 1 | 2 | 3 | 4 | 5): boolean {
  if (!playerZone || !editableSystem) return false
  const safeLevel = Math.min(level, getTowerItemSynthesisMaxLevel()) as 1 | 2 | 3 | 4 | 5
  const tierStar = levelToTowerTierStar(safeLevel)
  if (!tierStar) return false
  const size = normalizeSize(def.size)
  const slot = pickFirstEmptyCell(editableSystem, size, playerZone.activeColCount)
  if (!slot) return false
  const id = `t-${Date.now()}-${Math.floor(Math.random() * 99999)}`
  if (!editableSystem.place(slot.col, slot.row, size, def.id, id)) return false
  const quality = parseTierName(def.starting_tier) ?? tierStar.tier
  editableMeta.set(id, {
    defId: def.id,
    size,
    tier: tierStar.tier,
    tierStar: tierStar.star,
    quality,
    level: safeLevel,
    permanentDamageBonus: 0,
  })
  void playerZone.addItem(id, def.id, size, slot.col, slot.row, `${tierStar.tier}#${tierStar.star}`).then(() => {
    if (!playerZone || playerZone.destroyed) return
    playerZone.setItemTier(id, `${tierStar.tier}#${tierStar.star}`)
    editableDrag?.refreshZone(playerZone)
  }).catch(() => undefined)
  syncEngineWithEditable([id])
  return true
}

function makeItemTestButton(): Container {
  const con = new Container()
  const bg = new Graphics()
  const corner = Math.max(10, Math.round(getDebugCfg('gridItemCornerRadius') + 8))
  bg.roundRect(-TOP_ACTION_BTN_W / 2, -TOP_ACTION_BTN_H / 2, TOP_ACTION_BTN_W, TOP_ACTION_BTN_H, corner)
  bg.fill({ color: 0x44aaff, alpha: 0.18 })
  bg.stroke({ color: 0x44aaff, width: 3 })
  const txt = new Text({ text: '物品测试', style: { fontSize: getGameCfg().textSizes.phaseButtonLabel, fill: 0x44aaff, fontFamily: 'Arial', fontWeight: 'bold' } })
  txt.anchor.set(0.5)
  con.addChild(bg, txt)
  con.eventMode = 'static'
  con.cursor = 'pointer'
  con.zIndex = 195
  con.on('pointerdown', (e) => {
    e.stopPropagation()
    if (!root) return
    if (battleItemTestOverlay) {
      closeBattleItemTestOverlay()
      return
    }

    const overlay = new Container()
    overlay.zIndex = 7600
    overlay.eventMode = 'static'
    const mask = new Graphics()
    mask.rect(0, 0, CANVAS_W, CANVAS_H)
    mask.fill({ color: 0x020409, alpha: 0.72 })
    overlay.addChild(mask)

    const panel = new Container()
    panel.x = CANVAS_W / 2
    panel.y = CANVAS_H / 2 + 8
    panel.eventMode = 'static'
    panel.on('pointerdown', (pe) => pe.stopPropagation())
    overlay.addChild(panel)

    const panelW = 620
    const panelH = 1080
    const panelBg = new Graphics()
    panelBg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 22)
    panelBg.fill({ color: 0x13213a, alpha: 0.98 })
    panelBg.stroke({ color: 0x9ec2ff, width: 3, alpha: 0.95 })
    panel.addChild(panelBg)

    const title = new Text({ text: '物品测试（塔防战斗）', style: { fontSize: 34, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' } })
    title.anchor.set(0.5)
    title.y = -476
    panel.addChild(title)

    type ItemTestPage = 'all' | 'swordsman' | 'archer' | 'ninja' | 'icemage'
    const tabs: Array<{ key: ItemTestPage; label: string }> = [
      { key: 'all', label: '全部' },
      { key: 'swordsman', label: '剑士' },
      { key: 'archer', label: '弓手' },
      { key: 'ninja', label: '忍者' },
      { key: 'icemage', label: '冰法师' },
    ]
    let activePage: ItemTestPage = 'all'
    let pageIndex = 0
    const rowsPerPage = 16

    const allDefs = [...getAllItemsRaw()].filter((it) => !String(it.id).startsWith('skill_')).sort((a, b) => a.name_cn.localeCompare(b.name_cn, 'zh-Hans-CN'))
    const getPageItems = (): ItemDef[] => {
      if (activePage === 'all') return allDefs
      return allDefs.filter((def) => {
        const tags = `${def.tags ?? ''}`
        if (activePage === 'swordsman') return tags.includes('剑士')
        if (activePage === 'archer') return tags.includes('弓手')
        if (activePage === 'ninja') return tags.includes('忍者')
        return tags.includes('冰法师')
      })
    }

    const pageCon = new Container()
    pageCon.y = -422
    panel.addChild(pageCon)
    const tabW = 104
    const tabStep = 112
    const totalW = tabs.length * tabStep - (tabStep - tabW)
    const tabViews = new Map<ItemTestPage, { bg: Graphics; text: Text }>()

    const listCon = new Container()
    panel.addChild(listCon)
    const pageHint = new Text({ text: '', style: { fontSize: 20, fill: 0xb9d4ff, fontFamily: 'Arial', fontWeight: 'bold' } })
    pageHint.anchor.set(0.5)
    pageHint.y = 434
    panel.addChild(pageHint)

    const redrawTabs = () => {
      for (const one of tabs) {
        const v = tabViews.get(one.key)
        if (!v) continue
        const selected = one.key === activePage
        v.bg.clear()
        v.bg.roundRect(-tabW / 2, -17, tabW, 34, 12)
        v.bg.fill({ color: selected ? 0x7cc6ff : 0x2a4068, alpha: 0.96 })
        v.bg.stroke({ color: selected ? 0xe9f6ff : 0x9ec2ff, width: selected ? 3 : 2, alpha: 0.95 })
        v.text.style.fill = selected ? 0x0f1c33 : 0xeaf3ff
      }
    }

    const drawRows = () => {
      const old = listCon.removeChildren()
      old.forEach((ch) => ch.destroy())
      const items = getPageItems()
      const totalPages = Math.max(1, Math.ceil(items.length / rowsPerPage))
      pageIndex = Math.max(0, Math.min(totalPages - 1, pageIndex))
      pageHint.text = `第 ${pageIndex + 1}/${totalPages} 页（共 ${items.length} 个）`
      const start = pageIndex * rowsPerPage
      const end = Math.min(items.length, start + rowsPerPage)
      const topY = -352
      const rowH = 50
      for (let i = start; i < end; i++) {
        const def = items[i]!
        const y = topY + (i - start) * rowH
        const rowBg = new Graphics()
        rowBg.roundRect(-286, y - 20, 572, 40, 10)
        rowBg.fill({ color: i % 2 === 0 ? 0x172844 : 0x15233c, alpha: 0.72 })
        listCon.addChild(rowBg)

        const tier = parseTierName(def.starting_tier) ?? 'Bronze'
        const label = new Text({
          text: `${def.name_cn}（${tier}）`,
          style: { fontSize: 18, fill: 0xe0ebff, fontFamily: 'Arial', fontWeight: 'bold' },
        })
        label.x = -270
        label.y = y - label.height / 2
        listCon.addChild(label)

        const minBtn = new Container()
        minBtn.x = 168
        minBtn.y = y
        minBtn.eventMode = 'static'
        minBtn.cursor = 'pointer'
        const minBg = new Graphics()
        minBg.roundRect(-44, -16, 88, 32, 10)
        minBg.fill({ color: 0x96c7ff, alpha: 0.98 })
        minBg.stroke({ color: 0x0d1426, width: 2, alpha: 0.95 })
        const minText = new Text({ text: '最低级', style: { fontSize: 14, fill: 0x0f1c33, fontFamily: 'Arial', fontWeight: 'bold' } })
        minText.anchor.set(0.5)
        minBtn.addChild(minBg, minText)
        minBtn.on('pointerdown', (pe) => {
          pe.stopPropagation()
          const startTier = parseTierName(def.starting_tier) ?? 'Bronze'
          const levels = getTowerAllowedLevelsByStartingTier(startTier)
          const minLevel = levels[0] ?? 1
          if (!addBattleTestItemAtLevel(def, minLevel)) showFatigueToast('上阵区已满')
        })
        listCon.addChild(minBtn)

        const allBtn = new Container()
        allBtn.x = 254
        allBtn.y = y
        allBtn.eventMode = 'static'
        allBtn.cursor = 'pointer'
        const allBg = new Graphics()
        allBg.roundRect(-44, -16, 88, 32, 10)
        allBg.fill({ color: 0x74dc9b, alpha: 0.98 })
        allBg.stroke({ color: 0x0d1426, width: 2, alpha: 0.95 })
        const allText = new Text({ text: '全等级', style: { fontSize: 14, fill: 0x0f1c33, fontFamily: 'Arial', fontWeight: 'bold' } })
        allText.anchor.set(0.5)
        allBtn.addChild(allBg, allText)
        allBtn.on('pointerdown', (pe) => {
          pe.stopPropagation()
          const startTier = parseTierName(def.starting_tier) ?? 'Bronze'
          const levels = getTowerAllowedLevelsByStartingTier(startTier)
          let added = 0
          for (const lv of levels) {
            if (!addBattleTestItemAtLevel(def, lv)) break
            added += 1
          }
          if (added <= 0) showFatigueToast('上阵区已满')
        })
        listCon.addChild(allBtn)
      }
    }

    tabs.forEach((one, idx) => {
      const btn = new Container()
      btn.x = -totalW / 2 + idx * tabStep + tabW / 2
      btn.y = 0
      btn.eventMode = 'static'
      btn.cursor = 'pointer'
      const bgTab = new Graphics()
      const textTab = new Text({ text: one.label, style: { fontSize: 16, fill: 0xeaf3ff, fontFamily: 'Arial', fontWeight: 'bold' } })
      textTab.anchor.set(0.5)
      btn.addChild(bgTab, textTab)
      pageCon.addChild(btn)
      tabViews.set(one.key, { bg: bgTab, text: textTab })
      btn.on('pointerdown', (pe) => {
        pe.stopPropagation()
        if (activePage === one.key) return
        activePage = one.key
        pageIndex = 0
        redrawTabs()
        drawRows()
      })
    })

    const prevBtn = makeTopRectActionButton('上一页', () => {
      pageIndex -= 1
      drawRows()
    }).container
    prevBtn.x = -150
    prevBtn.y = 488
    prevBtn.scale.set(0.72)
    panel.addChild(prevBtn)

    const nextBtn = makeTopRectActionButton('下一页', () => {
      pageIndex += 1
      drawRows()
    }).container
    nextBtn.x = 150
    nextBtn.y = 488
    nextBtn.scale.set(0.72)
    panel.addChild(nextBtn)

    const closeBtn = makeTopRectActionButton('关闭', () => {
      closeBattleItemTestOverlay()
    }).container
    closeBtn.x = 0
    closeBtn.y = 542
    closeBtn.scale.set(0.86)
    panel.addChild(closeBtn)

    overlay.on('pointerdown', () => closeBattleItemTestOverlay())
    root.addChild(overlay)
    battleItemTestOverlay = overlay
    redrawTabs()
    drawRows()
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

function drawTowerRemainingBar(): void {
  if (!towerRemainBarG || !towerRemainBarText || !engine?.getTowerEnemyStats || !isTowerDefenseBattle()) return
  const stat = engine.getTowerEnemyStats()
  const total = Math.max(1, stat.totalCount)
  const remaining = Math.max(0, Math.min(total, stat.remainingCount))
  const rightPad = 16
  towerRemainBarG.clear()
  towerRemainBarG.visible = false
  towerRemainBarText.text = `剩余敌人：${remaining}`
  towerRemainBarText.x = CANVAS_W - rightPad - towerRemainBarText.width
  towerRemainBarText.y = 157 + topSafeYOffset
  if (towerRemainBarTextBg) {
    const padX = 14
    const padY = 8
    towerRemainBarTextBg.clear()
    towerRemainBarTextBg.roundRect(
      towerRemainBarText.x - padX,
      towerRemainBarText.y - padY,
      towerRemainBarText.width + padX * 2,
      towerRemainBarText.height + padY * 2,
      12,
    )
    towerRemainBarTextBg.fill({ color: 0x000000, alpha: 0.45 })
  }
}

function getTowerFinalDay(): number {
  const raw = Number(getGameCfg().towerDefenseRules?.finalDay)
  if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.round(raw))
  return 15
}

function getClampedTopActionBtnY(key: 'battleSpeedBtnY' | 'battleOrganizeBtnY' = 'battleSpeedBtnY'): number {
  const y = getDebugCfg(key)
  const minY = TOP_ACTION_BTN_HALF_H + TOP_ACTION_BTN_SAFE_PAD
  const maxY = CANVAS_H - TOP_ACTION_BTN_HALF_H - TOP_ACTION_BTN_SAFE_PAD
  return Math.max(minY, Math.min(maxY, y))
}

function getTowerTopLeftActionBtnX(): number {
  return 92
}

function getTowerTopLeftActionBtnY(order: number): number {
  const startY = TOP_ACTION_BTN_HALF_H + 18 + topSafeYOffset
  const gap = TOP_ACTION_BTN_H + 14
  return startY + Math.max(0, order) * gap
}

function isBattleSpeedButtonEnabled(): boolean {
  if (isPvpSpeedupDisabled()) return false
  return getDebugCfg('gameplayShowSpeedButton') >= 0.5
}

function isPvpSpeedupDisabled(): boolean {
  return PvpContext.isActive() && getDebugCfg('gameplayPvpDisableSpeedup') >= 0.5
}

function drawHeroBars(
  player: { hp: number; maxHp: number; shield: number; burn: number; poison: number; regen: number },
  enemy: { hp: number; maxHp: number; shield: number; burn: number; poison: number; regen: number },
): void {
  if (!heroHudG || !enemyHpInfoCon || !playerHpInfoCon) return
  const towerMode = isTowerDefenseBattle()
  const yEnemy = getDebugCfg('enemyHpBarY')
  const towerRowYOffset = towerMode ? getTowerPlayerHpBarRowYOffset() : 0
  const yPlayer = getDebugCfg('playerHpBarY') + towerRowYOffset
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
  if (!towerMode && enemyPresentationVisible) {
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

  enemyHpInfoCon.visible = !towerMode && enemyPresentationVisible
  if (!towerMode && enemyPresentationVisible) {
    drawInfoText(enemyHpInfoCon, CANVAS_W / 2, yEnemy + (baseBarH * enemyHpScale) / 2, enemyParts, baseFontSize * enemyHpScale)
  } else {
    enemyHpInfoCon.removeChildren()
  }
  drawInfoText(playerHpInfoCon, CANVAS_W / 2, yPlayer + baseBarH / 2, playerParts, baseFontSize)
}

function applyZoneVisualStyle(zone: GridZone, side: 'player' | 'enemy'): void {
  const towerMode = isTowerDefenseBattle()
  const showClassName = getDebugCfg('gameplayShowClassName') >= 0.5
  zone.setItemQualityMarkerEnabled(towerMode)
  zone.setQualityDiamondMarkerScale(towerMode ? 0.69 : 1)
  zone.setTierBadgeVisible(!towerMode)
  zone.setItemFrameUseArchetypeColor(towerMode ? true : (getDebugCfg('gameplayItemFrameColorByArchetype') >= 0.5))
  zone.setArchetypeBadgeShowClassPrefix(towerMode && showClassName)
  zone.setStatBadgeMode(towerMode ? 'archetype' : 'stats')
  zone.setTierBorderWidth(getDebugCfg('tierBorderWidth'))
  zone.setCornerRadius(getDebugCfg('gridItemCornerRadius'))
  zone.setCellBorderWidth(getDebugCfg('gridCellBorderWidth'))
  zone.setCellBackgroundAlpha(towerMode && side === 'player' ? getTowerPlayerZoneBackgroundAlpha() : 1)
  zone.setLabelVisible(false)
  zone.setStatBadgeFontSize(getDebugCfg('itemStatBadgeFontSize'))
  zone.setTierStarFontSize(towerMode ? 56 : getDebugCfg('itemTierStarFontSize'))
  zone.setTierStarStrokeWidth(towerMode ? 5 : getDebugCfg('itemTierStarStrokeWidth'))
  const sideOffsetX = side === 'enemy'
    ? getDebugCfg('battleEnemyTierStarOffsetX')
    : getDebugCfg('battlePlayerTierStarOffsetX')
  const sideOffsetY = side === 'enemy'
    ? getDebugCfg('battleEnemyTierStarOffsetY')
    : getDebugCfg('battlePlayerTierStarOffsetY')
  zone.setTierStarOffsetX(getDebugCfg('itemTierStarOffsetX') + sideOffsetX)
  zone.setTierStarOffsetY(getDebugCfg('itemTierStarOffsetY') + sideOffsetY)
  zone.setStatBadgeOffsetY(getDebugCfg('itemStatBadgeOffsetY'))
  zone.setAmmoBadgeOffsetY(6)
}

async function mountZoneItems(zone: GridZone, items: CombatBoardItem[]): Promise<void> {
  for (const it of items) {
    await zone.addItem(it.id, it.defId, it.size, it.col, it.row, it.tier)
    zone.setItemEnchantment(it.id, it.enchantment)
    if (it.side === 'player') fxPool.playerMountedItemIds.add(it.id)
    else fxPool.enemyMountedItemIds.add(it.id)
  }
}

function syncRemovedZoneItems(zone: GridZone, side: 'player' | 'enemy', aliveIds: Set<string>): void {
  const mounted = side === 'player' ? fxPool.playerMountedItemIds : fxPool.enemyMountedItemIds
  for (const id of Array.from(mounted)) {
    if (aliveIds.has(id)) continue
    const due = fxPool.pendingDestroyedItemDueMs.get(id)
    if (typeof due === 'number' && battlePresentationMs < due) continue
    zone.removeItem(id)
    fxPool.cancelPulse(id)
    mounted.delete(id)
    fxPool.pendingDestroyedItemDueMs.delete(id)
  }
}

function drawCooldownOverlay(
  zone: GridZone,
  overlay: Graphics,
  items: CombatBoardItem[],
  runtimeChargePercentById: Map<string, number>,
): void {
  const roundedRectInsetAtY = (localY: number, rectH: number, radius: number): number => {
    if (radius <= 0 || rectH <= 0) return 0
    const y = Math.max(0, Math.min(rectH, localY))
    const edgeDist = Math.min(y, rectH - y)
    if (edgeDist >= radius) return 0
    const dy = radius - edgeDist
    const dx = Math.sqrt(Math.max(0, radius * radius - dy * dy))
    return radius - dx
  }

  const roundedRectInsetForBand = (localCenterY: number, bandH: number, rectH: number, radius: number): number => {
    if (bandH <= 0) return roundedRectInsetAtY(localCenterY, rectH, radius)
    const topY = localCenterY - bandH / 2
    const bottomY = localCenterY + bandH / 2
    return Math.max(
      roundedRectInsetAtY(topY, rectH, radius),
      roundedRectInsetAtY(bottomY, rectH, radius),
    )
  }

  overlay.clear()
  const coverAlpha = Math.max(0, Math.min(1, getDebugCfg('battleCooldownOverlayAlpha')))
  const lineColor = Math.max(0, Math.min(0xffffff, Math.round(getDebugCfg('battleCooldownProgressLineColor'))))
  const lineAlpha = Math.max(0, Math.min(1, getDebugCfg('battleCooldownProgressLineAlpha')))
  const lineGlowAlpha = Math.max(0, Math.min(1, getDebugCfg('battleCooldownProgressLineGlowAlpha')))
  const lineHRaw = Math.max(1, getDebugCfg('battleCooldownProgressLineHeight'))
  const lineGlowHRaw = Math.max(0, getDebugCfg('battleCooldownProgressLineGlowHeight'))
  for (const it of items) {
    const { w, h } = sizeToWH(it.size)
    const pw = w * CELL_SIZE
    const ph = h * CELL_HEIGHT
    const nodeView = zone.getNode(it.id)
    if (nodeView?.container.parent) {
      let cur: Container | null = nodeView.container.parent as Container | null
      let attachedToZone = false
      while (cur) {
        if (cur === zone) {
          attachedToZone = true
          break
        }
        cur = cur.parent as Container | null
      }
      if (!attachedToZone) continue
    }
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
    const scale = nodeView?.visual.scale.x ?? 1
    const cx = pos.x + pw / 2
    const cy = pos.y + ph / 2
    const sx = cx + (x - cx) * scale
    const sy = cy + (y - cy) * scale
    const sw = wPx * scale
    const fullSh = fullH * scale
    const sh = coverH * scale
    const itemRadius = Math.max(0, getDebugCfg('gridItemCornerRadius') * scale)
    overlay.roundRect(sx, sy, sw, sh, Math.min(itemRadius, sw / 2, sh / 2))
    overlay.fill({ color: 0x0b1020, alpha: coverAlpha })

    const lineY = sy + sh
    const lineH = Math.max(1, lineHRaw * scale)
    const lineGlowH = Math.max(lineH, lineGlowHRaw * scale)
    if (lineGlowH > 0 && lineGlowAlpha > 0) {
      const localCenterY = lineY - sy
      const insetGlow = roundedRectInsetForBand(localCenterY, lineGlowH, fullSh, itemRadius)
      const glowW = Math.max(0, sw - insetGlow * 2)
      if (glowW > 0.5) {
        const glowY = lineY - lineGlowH / 2
        overlay.roundRect(sx + insetGlow, glowY, glowW, lineGlowH, Math.min(6, lineGlowH / 2))
        overlay.fill({ color: lineColor, alpha: lineGlowAlpha })
      }
    }
    if (lineAlpha > 0) {
      const localCenterY = lineY - sy
      const insetCore = roundedRectInsetForBand(localCenterY, lineH, fullSh, itemRadius)
      const coreW = Math.max(0, sw - insetCore * 2)
      if (coreW > 0.5) {
        const coreY = lineY - lineH / 2
        overlay.roundRect(sx + insetCore, coreY, coreW, lineH, Math.min(6, lineH / 2))
        overlay.fill({ color: lineColor, alpha: lineAlpha })
      }
    }
  }
}

function updateRuntimeStatBadges(
  zone: GridZone,
  items: CombatBoardItem[],
  runtimeById: Map<string, CombatItemRuntimeState>,
  runtimeAmmoReloadMsById?: Map<string, number>,
): void {
  for (const it of items) {
    const rt = runtimeById.get(it.id)
    if (!rt) {
      zone.setItemStatOverride(it.id, null)
      zone.setItemAmmo(it.id, 0, 0)
      zone.setItemAmmoReloading(it.id, 0)
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
    zone.setItemAmmoReloading(
      it.id,
      Math.max(0, runtimeAmmoReloadMsById?.get(it.id) ?? rt.ammoAutoReloadRemainingMs),
    )
  }
}

function updatePlayerRangeBlockedHints(
  zone: GridZone,
  items: CombatBoardItem[],
  runtimeRangeBlockedById: Map<string, boolean>,
): void {
  void zone
  void items
  void runtimeRangeBlockedById
  if (!playerRangeBlockedHintLayer) return
  for (const label of playerRangeBlockedHintTextById.values()) label.visible = false
}

function addItemRoundDamage(side: 'player' | 'enemy', sourceItemId: string, amount: number): void {
  if (!sourceItemId) return
  const add = Math.max(0, Math.round(Number(amount) || 0))
  if (add <= 0) return
  const map = side === 'enemy' ? enemyItemRoundDamageById : playerItemRoundDamageById
  map.set(sourceItemId, (map.get(sourceItemId) ?? 0) + add)
}

function addItemRoundShield(side: 'player' | 'enemy', sourceItemId: string, amount: number): void {
  if (!sourceItemId) return
  const add = Math.max(0, Math.round(Number(amount) || 0))
  if (add <= 0) return
  const map = side === 'enemy' ? enemyItemRoundShieldById : playerItemRoundShieldById
  map.set(sourceItemId, (map.get(sourceItemId) ?? 0) + add)
}

function clearItemRoundStatTracking(): void {
  playerItemRoundDamageById.clear()
  enemyItemRoundDamageById.clear()
  playerItemRoundShieldById.clear()
  enemyItemRoundShieldById.clear()
  for (const one of playerItemRoundStatTextById.values()) one.visible = false
  for (const one of enemyItemRoundStatTextById.values()) one.visible = false
}

function clearItemRoundStatForPlayerIds(ids: string[]): void {
  for (const id of ids) {
    playerItemRoundDamageById.delete(id)
    playerItemRoundShieldById.delete(id)
    const label = playerItemRoundStatTextById.get(id)
    if (label) label.visible = false
  }
}

function formatCompactRoundStatValue(value: number): string {
  if (value > 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value > 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

function updateItemRoundStatHints(
  zone: GridZone,
  layer: Container | null,
  labelsById: Map<string, Text>,
  items: CombatBoardItem[],
  damageById: Map<string, number>,
  shieldById: Map<string, number>,
): void {
  if (!layer) return
  if (getDebugCfg('gameplayShowItemDamageShieldOnIcon') < 0.5) {
    for (const one of labelsById.values()) one.visible = false
    return
  }
  const fontSize = Math.max(8, getDebugCfg('itemRoundStatFontSize'))
  const visibleIds = new Set<string>()
  for (const it of items) {
    const dmg = Math.max(0, Math.round(damageById.get(it.id) ?? 0))
    const shd = Math.max(0, Math.round(shieldById.get(it.id) ?? 0))
    if (dmg <= 0 && shd <= 0) continue
    let label = labelsById.get(it.id)
    if (!label) {
      label = new Text({
        text: '',
        style: {
          fontSize,
          fill: 0xff4b4b,
          fontFamily: 'Arial',
          fontWeight: 'bold',
          align: 'center',
          stroke: { color: 0x000000, width: 3, join: 'round' },
        },
      })
      label.anchor.set(0.5)
      label.eventMode = 'none'
      labelsById.set(it.id, label)
      layer.addChild(label)
    }
    const node = zone.getNode(it.id)
    if (!node?.container.parent) {
      label.visible = false
      continue
    }
    let cur: Container | null = node.container.parent as Container | null
    let attachedToZone = false
    while (cur) {
      if (cur === zone) {
        attachedToZone = true
        break
      }
      cur = cur.parent as Container | null
    }
    if (!attachedToZone) {
      label.visible = false
      continue
    }
    const useDamage = dmg > 0
    label.text = formatCompactRoundStatValue(useDamage ? dmg : shd)
    label.style.fontSize = fontSize
    label.style.fill = useDamage ? 0xff4b4b : 0xffd84d
    const { w, h } = sizeToWH(it.size)
    const pw = w * CELL_SIZE
    const ph = h * CELL_HEIGHT
    const maxTextWidth = Math.max(8, pw - 10)
    const scaleX = label.width > maxTextWidth ? (maxTextWidth / label.width) : 1
    label.scale.set(scaleX, 1)
    label.x = node.container.x + pw / 2
    label.y = node.container.y + ph / 2
    label.visible = true
    visibleIds.add(it.id)
  }
  for (const [id, label] of labelsById) {
    if (!visibleIds.has(id)) label.visible = false
  }
}

function applyLayout(activeCols: number, options?: { keepPlayerZoneX?: boolean; keepPlayerZoneY?: boolean }): void {
  const playerScale = getBattleItemScale()
  const enemyScale = getEnemyAreaScale()
  if (enemyZone) {
    enemyZone.scale.set(enemyScale)
    enemyZone.x = getEnemyZoneX(activeCols)
    enemyZone.y = getDebugCfg('enemyBattleZoneY')
  }
  if (playerZone) {
    playerZone.scale.set(playerScale)
    if (!options?.keepPlayerZoneX) playerZone.x = getPlayerZoneX(activeCols)
    if (!options?.keepPlayerZoneY) playerZone.y = getPlayerZoneY(battleDay)
  }
  if (portraitFX.enemyBossSprite) {
    const widthRatio = Math.max(0.2, getDebugCfg('battleEnemyPortraitWidthRatio'))
    const offsetY = getDebugCfg('battleEnemyPortraitOffsetY')
    portraitFX.enemyBossSprite.x = CANVAS_W / 2
    const topY = getDebugCfg('enemyHpBarY') + getDebugCfg('battleHpBarH') * getEnemyHpBarScale() + offsetY
    const tex = portraitFX.enemyBossSprite.texture
    if (tex?.width) {
      const targetW = CANVAS_W * widthRatio
      portraitFX.enemyBossBaseScale = targetW / Math.max(1, tex.width)
      if (portraitFX.enemyBossDeathElapsedMs < 0) {
        portraitFX.enemyBossSprite.scale.set(portraitFX.enemyBossBaseScale)
      }
    }
    portraitFX.enemyBossSprite.y = topY + portraitFX.enemyBossSprite.height - 50
  }
  if (portraitFX.enemyBossFlashSprite && portraitFX.enemyBossSprite) {
    portraitFX.enemyBossFlashSprite.x = portraitFX.enemyBossSprite.x
    portraitFX.enemyBossFlashSprite.y = portraitFX.enemyBossSprite.y
    if (portraitFX.enemyBossDeathElapsedMs < 0) {
      portraitFX.enemyBossFlashSprite.scale.copyFrom(portraitFX.enemyBossSprite.scale)
    }
  }

  const useFourHeroPortrait = isBattlePlayerFourHeroPortraitEnabled()
  if (portraitFX.playerHeroSprite) portraitFX.playerHeroSprite.visible = !useFourHeroPortrait
  if (portraitFX.playerHeroFlashSprite) portraitFX.playerHeroFlashSprite.visible = !useFourHeroPortrait
  if (!useFourHeroPortrait) {
    if (portraitFX.playerHeroSprite) {
      portraitFX.playerHeroSprite.x = CANVAS_W / 2
      const tex = portraitFX.playerHeroSprite.texture
      if (tex?.width) {
        const targetW = CANVAS_W * Math.max(0.2, getDebugCfg('battlePlayerPortraitWidthRatio'))
        portraitFX.playerHeroBaseScale = targetW / Math.max(1, tex.width)
        if (portraitFX.playerHeroSprite) {
          portraitFX.playerHeroSprite.scale.set(portraitFX.playerHeroBaseScale)
        }
      }
      const offsetY = getDebugCfg('battlePlayerPortraitOffsetY')
      portraitFX.playerHeroSprite.y = CANVAS_H + offsetY
    }
    if (portraitFX.playerHeroFlashSprite && portraitFX.playerHeroSprite) {
      portraitFX.playerHeroFlashSprite.x = portraitFX.playerHeroSprite.x
      portraitFX.playerHeroFlashSprite.y = portraitFX.playerHeroSprite.y
      portraitFX.playerHeroFlashSprite.scale.copyFrom(portraitFX.playerHeroSprite.scale)
    }
  }
  if (playerFourHeroPortraitLayer) {
    playerFourHeroPortraitLayer.visible = useFourHeroPortrait
  }
  if (useFourHeroPortrait && playerFourHeroPortraitUnits.length > 0) {
    updatePlayerFourHeroFrontSlotByPower()
    const orderedUnits = [...playerFourHeroPortraitUnits]
    const slotByStem = getPlayerFourHeroPortraitSlotByStem(playerFourHeroSlotStems)
    const perPortraitW = CANVAS_W * 0.22
    const fourHeroBaseScale = Math.max(0.2, getDebugCfg('battlePlayerPortraitFourHeroScale'))
    const baseY = CANVAS_H + getDebugCfg('battlePlayerPortraitOffsetY')
    const swapAnim = playerFourHeroSwapAnim
    const swapP = swapAnim
      ? Math.max(0, Math.min(1, (battlePresentationMs - swapAnim.startAtMs) / Math.max(1, swapAnim.durationMs)))
      : 1
    const swapEase = 1 - Math.pow(1 - swapP, 3)
    if (swapAnim && swapP >= 1) playerFourHeroSwapAnim = null
    for (const unit of orderedUnits) {
      if (!unit) continue
      const targetSlot = slotByStem[unit.stem]
      const fromSlot = swapAnim ? swapAnim.fromSlotByStem[unit.stem] : targetSlot
      const toSlot = swapAnim ? swapAnim.toSlotByStem[unit.stem] : targetSlot
      const fromAdjust = getPlayerFourHeroPortraitAdjust(fromSlot)
      const toAdjust = getPlayerFourHeroPortraitAdjust(toSlot)
      const fromStyle = getPlayerFourHeroPortraitStyle(fromSlot)
      const toStyle = getPlayerFourHeroPortraitStyle(toSlot)
      const offsetX = fromAdjust.offsetX + (toAdjust.offsetX - fromAdjust.offsetX) * swapEase
      const offsetY = fromAdjust.offsetY + (toAdjust.offsetY - fromAdjust.offsetY) * swapEase
      const scaleAdjust = fromAdjust.scale + (toAdjust.scale - fromAdjust.scale) * swapEase
      const alpha = fromStyle.alpha + (toStyle.alpha - fromStyle.alpha) * swapEase
      const grayMul = fromStyle.grayMul + (toStyle.grayMul - fromStyle.grayMul) * swapEase
      const tex = unit.sprite.texture
      if (tex?.width) {
        unit.baseScale = (perPortraitW / Math.max(1, tex.width)) * fourHeroBaseScale * Math.max(0.1, scaleAdjust)
        unit.sprite.scale.set(unit.baseScale)
      }
      unit.sprite.x = CANVAS_W * 0.5 + offsetX
      unit.sprite.y = baseY + offsetY
      unit.sprite.alpha = alpha
      const gray = Math.max(0, Math.min(255, Math.round(255 * grayMul)))
      unit.sprite.tint = (gray << 16) | (gray << 8) | gray
      unit.sprite.zIndex = 80 + Math.round(unit.sprite.y)
    }
  }
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
  return getDebugCfg('battleItemInfoCenterY')
}

function resolveTowerRoleLabelAndColor(item: ItemDef): { label: '剑士' | '弓手' | '忍者' | '冰法师'; color: number } | null {
  const tags = `${item.tags ?? ''}`
  if (tags.includes('剑士') || tags.includes('战士')) return { label: '剑士', color: getClassColor('剑士') }
  if (tags.includes('弓手')) return { label: '弓手', color: getClassColor('弓手') }
  if (tags.includes('忍者') || tags.includes('刺客')) return { label: '忍者', color: getClassColor('忍者') }
  if (tags.includes('冰法师')) return { label: '冰法师', color: getClassColor('冰法师') }
  return null
}

function clearBattleItemSelection(): void {
  selectedItemId = null
  selectedItemSide = null
  selectedItemInfoKey = null
  selectedItemInfoMode = getDefaultItemInfoMode()
  enemyZone?.setSelected(null)
  playerZone?.setSelected(null)
  playerZone?.clearHighlight()
  playerZone?.setDragGuideArrows([])
  itemInfoPopup?.hide()
}

function showBattleItemInfo(instanceId: string, side: 'player' | 'enemy', keepMode = false): void {
  if (!engine || !itemInfoPopup) return
  skillUI?.hideDetailPopup()
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
      bounceCount: Math.max(0, runtimeState.bounceCount ?? 0),
      ammoCurrent: Math.max(0, runtimeState.ammoCurrent),
      ammoMax: Math.max(0, runtimeState.ammoMax),
    }
    : undefined
  const nextKey = `${side}:${instanceId}:${hit.tier}:${runtimeOverride?.cooldownMs ?? -1}:${runtimeOverride?.damage ?? -1}:${runtimeOverride?.shield ?? -1}:${runtimeOverride?.heal ?? -1}:${runtimeOverride?.multicast ?? -1}:${runtimeOverride?.bounceCount ?? -1}:${runtimeOverride?.ammoCurrent ?? -1}:${runtimeOverride?.ammoMax ?? -1}`
  if (keepMode && selectedItemInfoKey === nextKey) return
  if (!shouldShowSimpleDescriptions()) {
    selectedItemInfoKey = nextKey
    selectedItemInfoMode = 'detailed'
  } else if (!keepMode) {
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
  if (side === 'player') refreshBattleSynthesisGuideArrows(instanceId)

  itemInfoPopup.setWidth(getDebugCfg('itemInfoWidth'))
  itemInfoPopup.setMinHeight(getDebugCfg('itemInfoMinH'))
  itemInfoPopup.setSmallMinHeight(getDebugCfg('itemInfoMinHSmall'))
  itemInfoPopup.setCornerRadius(getDebugCfg('gridItemCornerRadius'))
  itemInfoPopup.setTextSizes({
    name: isTowerDefenseBattle() ? 28 : getDebugCfg('itemInfoNameFontSize'),
    tier: getDebugCfg('itemInfoTierFontSize'),
    cooldown: getDebugCfg('itemInfoCooldownFontSize'),
    priceCorner: getDebugCfg('itemInfoPriceCornerFontSize'),
    desc: getDebugCfg('itemInfoDescFontSize'),
    simpleDesc: getDebugCfg('itemInfoSimpleDescFontSize'),
  })
  itemInfoPopup.setCenterY(getBattleInfoPanelCenterY())
  const enchantmentDisplay: ItemInfoEnchantmentDisplay | undefined = hit.enchantment
    ? {
      ...getItemEnchantmentDisplay(hit.enchantment),
      effectCn: resolveItemEnchantmentEffectCn(item, hit.enchantment),
    }
    : undefined
  const towerRoleDisplay = isTowerDefenseBattle() ? resolveTowerRoleLabelAndColor(item) : null
  const showClassName = getDebugCfg('gameplayShowClassName') >= 0.5
  const customDisplay: ItemInfoCustomDisplay | undefined = towerRoleDisplay
    ? {
      iconFrameColorOverride: towerRoleDisplay.color,
      iconFrameWidthOverride: 6,
      ...(showClassName
        ? {
          iconRoleBadgeLabel: towerRoleDisplay.label,
          iconRoleBadgeBgColor: towerRoleDisplay.color,
          iconRoleBadgeFontSize: 24,
        }
        : {}),
    }
    : undefined
  const infoLevel = (!isTowerDefenseBattle() || side !== 'player')
    ? undefined
    : (Math.max(1, Math.min(getTowerItemSynthesisMaxLevel(), Number((hit as { level?: number }).level) || Number(editableMeta.get(instanceId)?.level) || 1)) as 1 | 2 | 3 | 4 | 5)
  const displayTier = (() => {
    if (!isTowerDefenseBattle() || side !== 'player') return hit.tier
    const byLevel = infoLevel ? levelToTowerTierStar(infoLevel) : null
    return byLevel ? `${byLevel.tier}#${byLevel.star}` : hit.tier
  })()
  itemInfoPopup.show(item, 0, 'none', displayTier, undefined, selectedItemInfoMode, runtimeOverride, customDisplay, enchantmentDisplay, infoLevel)
}

export const BattleScene: Scene = {
  name: 'tower-battle',
  async onEnter() {
    const { stage } = getApp()
    const requestedReplay = consumeRequestedBattleReplay()
    replayMode = requestedReplay != null
    replayRandomSourceValues = requestedReplay ? [...requestedReplay.randomValues] : null
    towerForceAutoStartOnEnter = consumeTowerAutoStartOnEnterFlag()
    resetBattleRandomSession()
    let snapshot = getBattleSnapshot()
    if (!snapshot) {
      if (getGameCfg().towerDefenseRules?.enabled === true) {
        const fallbackDay = 1
        snapshot = {
          day: fallbackDay,
          activeColCount: 6,
          createdAtMs: Date.now(),
          playerGold: getEditableStartGold(fallbackDay),
          towerBattleZoneExpandStep: 0,
          entities: [],
        }
        setBattleSnapshot(snapshot)
      } else {
        console.warn('[BattleScene] 缺少战斗快照，回退商店并尝试恢复进度')
        SceneManager.goto('tower-shop')
        return
      }
    }
    if (getGameCfg().towerDefenseRules?.enabled === true) {
      const normalizedEntities = snapshot.entities.map((one) => {
        const tier = (one.tier ?? 'Bronze') as TierKey
        const tierStar = (one.tierStar ?? 1) as 1 | 2
        const level = Math.max(1, Math.min(getTowerItemSynthesisMaxLevel(), Number(one.level) || tierStarToTowerLevel(tier, tierStar))) as 1 | 2 | 3 | 4 | 5
        const normalizedTierStar = levelToTowerTierStar(level) ?? { tier, star: tierStar }
        return {
          ...one,
          tier: normalizedTierStar.tier,
          tierStar: normalizedTierStar.star,
          level,
        }
      })
      snapshot = {
        ...snapshot,
        entities: normalizedEntities,
      }
      setBattleSnapshot(snapshot)
    }
    enteredSnapshot = snapshot
    towerBattleZoneExpandStep = inferTowerZoneExpandStepFromSnapshot(snapshot)
    syncTowerPlayerHpBarRowYOffset(false)
    towerBattleSkillBuyCount = Math.max(0, Math.round(snapshot.towerBattleSkillBuyCount ?? 0))
    towerBattleSkillPickCounts.clear()
    if (snapshot.towerBattleSkillPickCounts && typeof snapshot.towerBattleSkillPickCounts === 'object') {
      for (const [k, v] of Object.entries(snapshot.towerBattleSkillPickCounts)) {
        const n = Math.max(0, Math.round(Number(v) || 0))
        if (n > 0) towerBattleSkillPickCounts.set(k, n)
      }
    }
    battleEnemyHeroVisualId = null
    battleReplaySaved = false
    towerEnemyLayer = null
    towerClassRangeLayer = null
    for (const one of towerEnemySpriteById.values()) {
      one.root.destroy({ children: true })
    }
    towerEnemySpriteById.clear()
    towerEnemyAnimStateById.clear()
    towerEnemyPosById.clear()
    towerEnemyDefIdByUnitId.clear()
    towerEnemyDeathFlyById.clear()
    towerEnemyLastHitDirById.clear()
    clearTowerEnemyGoldDropFx()
    towerGoldDropLayer = null
    towerEnemyTexByIcon.clear()
    towerClassRangeLineByRole.clear()
    towerClassRangeLastLogSignature = ''
    const cleanupCfg = getGameCfg().runRules?.battleCacheCleanup
    await purgeMobileBattleAssetCacheIfEnabled()
    if (cleanupCfg?.enabled && cleanupCfg?.forceTextureGcOnBattleEnter) runRendererTextureGcNow()
    battleDay = Math.max(1, snapshot.day)
    settlementRevealAtMs = null
    battlePresentationMs = 0
    chargeUiElapsedSinceTickMs = 0
    ammoReloadUiElapsedSinceTickMs = 0
    towerHasPlayerItemFiredOnce = false
    towerPreFirstAttackSpeedBoostActive = false
    towerPreFirstAttackOriginalSpeed = null
    fxPool.sourceNextDamageVisualAtMs.clear()
    fxPool.setRandomProvider(() => nextBattleRandom('fx_random'))
    battleSpeed = getDefaultBattleSpeed()
    lastHudTickIndex = -1
    monitorSampleElapsedMs = 0
    monitorHighStreak = 0
    monitorRecoverStreak = 0
    autoFxDegradeLevel = 0
    fxPool.setAutoDegradeLevel(0)
    damageStats.reset()
    clearBattleRuntimePerfSampleWindow()
    battleRuntimePerfSnapshot = {}
    battleLastTickIndexForPerf = -1
    appliedActiveCols = -1
    playerZoneResizeTransition = null
    towerPlayerHpBarRowYOffsetTransition = null
    towerPlayerHpBarRowYOffset = 0
    root = new Container()
    root.sortableChildren = true
    stage.addChild(root)
    skillUI = new BattleSkillUI(root, clearBattleItemSelection)
    skillUI.loadPlayerSkills()
    transition.battleIntroDurationMs = Math.max(0, getDebugCfg('battleIntroFadeInMs'))
    skillUI.skillBarIntroElapsedMs = 0
    transition.battleExitTransitionDurationMs = 0
    root.alpha = transition.battleIntroDurationMs > 0 ? 0 : 1

    // 入场遮罩：覆盖底层 bgSprite，与 root 淡入交叉渐变，防止背景闪现
    if (transition.battleIntroDurationMs > 0) {
      transition.battleIntroCover = new Graphics()
      transition.battleIntroCover.rect(0, 0, CANVAS_W, CANVAS_H)
      transition.battleIntroCover.fill({ color: 0x000000 })
      transition.battleIntroCover.eventMode = 'none'
      stage.addChild(transition.battleIntroCover)
    }

    towerDayText = new Text({
      text: '',
      style: {
        fontSize: 32,
        fill: 0xffe8a3,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x000000, width: 3 },
      },
    })
    towerDayTextBg = new Graphics()
    towerDayTextBg.zIndex = 189
    towerDayTextBg.eventMode = 'none'
    root.addChild(towerDayTextBg)
    towerDayText.anchor.set(1, 0)
    towerDayText.zIndex = 190
    towerDayText.eventMode = 'none'
    root.addChild(towerDayText)

    towerRemainBarG = new Graphics()
    towerRemainBarG.zIndex = 42
    towerRemainBarG.eventMode = 'none'
    root.addChild(towerRemainBarG)
    towerRemainBarTextBg = new Graphics()
    towerRemainBarTextBg.zIndex = 42
    towerRemainBarTextBg.eventMode = 'none'
    root.addChild(towerRemainBarTextBg)
    towerRemainBarText = new Text({
      text: '',
      style: { fontSize: 24, fill: 0xfff2f2, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 3 } },
    })
    towerRemainBarText.zIndex = 43
    towerRemainBarText.eventMode = 'none'
    root.addChild(towerRemainBarText)

    towerBottomFocusBg = new Graphics()
    towerBottomFocusBg.zIndex = 187
    towerBottomFocusBg.eventMode = 'none'
    towerBottomFocusBg.visible = isTowerDefenseBattle()
    if (towerBottomFocusBg.visible) {
      towerBottomFocusBg.clear()
      towerBottomFocusBg.rect(0, CANVAS_H - 150, CANVAS_W, 150)
      towerBottomFocusBg.fill({ color: 0x000000, alpha: 0.62 })
    }
    root.addChild(towerBottomFocusBg)

    towerGoldBadgeBg = new Graphics()
    towerGoldBadgeBg.zIndex = 188
    towerGoldBadgeBg.eventMode = 'none'
    towerGoldBadgeBg.visible = false
    root.addChild(towerGoldBadgeBg)
    towerGoldBadgeText = new Text({
      text: '',
      style: { fontSize: 31, fill: 0xfff2f2, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 4 } },
    })
    towerGoldBadgeText.zIndex = 189
    towerGoldBadgeText.eventMode = 'none'
    towerGoldBadgeText.visible = false
    root.addChild(towerGoldBadgeText)

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

    portraitFX.enemyBossSprite = new Sprite(Texture.WHITE)
    portraitFX.enemyBossSprite.anchor.set(0.5, 1)
    portraitFX.enemyBossSprite.zIndex = 31
    portraitFX.enemyBossSprite.eventMode = 'none'
    portraitFX.enemyBossSprite.visible = true
    root.addChild(portraitFX.enemyBossSprite)

    portraitFX.enemyBossFlashSprite = new Sprite(Texture.WHITE)
    portraitFX.enemyBossFlashSprite.anchor.set(0.5, 1)
    portraitFX.enemyBossFlashSprite.zIndex = 32
    portraitFX.enemyBossFlashSprite.eventMode = 'none'
    portraitFX.enemyBossFlashSprite.visible = true
    portraitFX.enemyBossFlashSprite.tint = 0xffffff
    portraitFX.enemyBossFlashSprite.blendMode = 'add'
    portraitFX.enemyBossFlashSprite.alpha = 0
    root.addChild(portraitFX.enemyBossFlashSprite)

    portraitFX.playerHeroSprite = new Sprite(Texture.WHITE)
    portraitFX.playerHeroSprite.anchor.set(0.5, 1)
    portraitFX.playerHeroSprite.zIndex = 35
    portraitFX.playerHeroSprite.eventMode = 'none'
    portraitFX.playerHeroSprite.visible = true
    root.addChild(portraitFX.playerHeroSprite)

    portraitFX.playerHeroFlashSprite = new Sprite(Texture.WHITE)
    portraitFX.playerHeroFlashSprite.anchor.set(0.5, 1)
    portraitFX.playerHeroFlashSprite.zIndex = 36
    portraitFX.playerHeroFlashSprite.eventMode = 'none'
    portraitFX.playerHeroFlashSprite.visible = true
    portraitFX.playerHeroFlashSprite.tint = 0xffffff
    portraitFX.playerHeroFlashSprite.blendMode = 'add'
    portraitFX.playerHeroFlashSprite.alpha = 0
    root.addChild(portraitFX.playerHeroFlashSprite)

    playerFourHeroPortraitLayer = new Container()
    playerFourHeroPortraitLayer.zIndex = 35
    playerFourHeroPortraitLayer.sortableChildren = true
    playerFourHeroPortraitLayer.eventMode = 'none'
    playerFourHeroPortraitLayer.visible = false
    root.addChild(playerFourHeroPortraitLayer)
    playerFourHeroPortraitUnits.length = 0
    playerFourHeroSlotStems = [...PLAYER_FOUR_HERO_SLOT_STEMS_DEFAULT]
    playerFourHeroSwapAnim = null
    for (const stem of PLAYER_FOUR_HERO_PORTRAIT_STEMS) {
      const sprite = new Sprite(Texture.WHITE)
      sprite.anchor.set(0.5, 1)
      sprite.eventMode = 'none'
      playerFourHeroPortraitLayer.addChild(sprite)
      playerFourHeroPortraitUnits.push({
        stem,
        sprite,
        normalTexture: null,
        hitTexture: null,
        baseScale: 1,
      })
    }
    await loadPlayerFourHeroPortraitTextures()
    playerFourHeroHitElapsedMs = -1
    playerFourHeroHitStem = null
    setPlayerFourHeroPortraitUseHit(false)

    if (isTowerDefenseBattle()) {
      if (portraitFX.enemyBossSprite) portraitFX.enemyBossSprite.visible = false
      if (portraitFX.enemyBossFlashSprite) portraitFX.enemyBossFlashSprite.visible = false
    } else {
      try {
        const snap = getBattleSnapshot()
        const pvpEnemyHeroId = snap?.pvpEnemyHeroId
        const isPvpRealBattle = PvpContext.isActive()
        const replayEnemyHeroId = replayMode && requestedReplay && (HERO_VISUAL_IDS as readonly string[]).includes(requestedReplay.enemyHeroId)
          ? requestedReplay.enemyHeroId as HeroVisualId
          : null
        const enemyHeroId = replayEnemyHeroId || (isPvpRealBattle && pvpEnemyHeroId && (HERO_VISUAL_IDS as readonly string[]).includes(pvpEnemyHeroId)
          ? pvpEnemyHeroId as HeroVisualId
          : randomHeroVisualId())
        battleEnemyHeroVisualId = enemyHeroId
        const tex = await Assets.load<Texture>(getHeroImageUrl(`${enemyHeroId}.png`))
        if (portraitFX.enemyBossSprite) {
          portraitFX.enemyBossSprite.texture = tex
        }
        if (portraitFX.enemyBossFlashSprite) {
          portraitFX.enemyBossFlashSprite.texture = tex
        }
        portraitFX.enemyBossDeathElapsedMs = -1
      } catch (err) {
        console.warn('[BattleScene] 敌人立绘加载失败', err)
        if (portraitFX.enemyBossSprite) portraitFX.enemyBossSprite.visible = false
        if (portraitFX.enemyBossFlashSprite) portraitFX.enemyBossFlashSprite.visible = false
      }
    }
    enemyPresentationVisible = !isTowerDefenseBattle()

    try {
      // 优先使用快照的 ownerHeroId（PVP 多标签测试时 localStorage 为共享，snapshot 才是本玩家的准确值）
      const snap = getBattleSnapshot()
      const snapshotHeroId = snap?.ownerHeroId
      const playerHeroId = resolveHeroVisualId(snapshotHeroId) ?? readPlayerHeroVisualId()
      let tex: Texture
      try {
        tex = await Assets.load<Texture>(getHeroImageUrl(`${playerHeroId}b.png`))
      } catch {
        tex = await Assets.load<Texture>(getHeroImageUrl(`${playerHeroId}.png`))
      }
      if (portraitFX.playerHeroSprite) portraitFX.playerHeroSprite.texture = tex
      if (portraitFX.playerHeroFlashSprite) portraitFX.playerHeroFlashSprite.texture = tex
    } catch (err) {
      console.warn('[BattleScene] 英雄立绘加载失败', err)
      if (portraitFX.playerHeroSprite) portraitFX.playerHeroSprite.visible = false
      if (portraitFX.playerHeroFlashSprite) portraitFX.playerHeroFlashSprite.visible = false
    }
    enemyHpInfoCon = new Container()
    playerHpInfoCon = new Container()
    enemyHpInfoCon.zIndex = 41
    playerHpInfoCon.zIndex = 41
    root.addChild(enemyHpInfoCon)
    root.addChild(playerHpInfoCon)

    const day = snapshot?.day ?? 1
    const activeCols = getDayActiveCols(day)
    const towerMode = getGameCfg().towerDefenseRules?.enabled === true
    const playerRows = towerMode
      ? getTowerBattleRowsForCurrentExpandStep()
      : Math.max(1, Math.min(3,
        snapshot.entities.reduce((maxRow, one) => Math.max(maxRow, Math.max(0, Math.round(one.row ?? 0))), 0) + 1,
      ))
    const playerMaxRows = towerMode ? 3 : playerRows

    enemyZone = new GridZone('敌方战斗区', 6, activeCols, 1)
    playerZone = new GridZone('战斗区', 6, activeCols, playerMaxRows)
    playerZone.setActiveRowCount(playerRows)
    const zoneZIndex = isTowerDefenseBattle() ? 38 : 20
    enemyZone.zIndex = zoneZIndex
    playerZone.zIndex = zoneZIndex
    applyZoneVisualStyle(enemyZone, 'enemy')
    applyZoneVisualStyle(playerZone, 'player')
    enemyZone.setRuntimeValueFxEnabled(true)
    playerZone.setRuntimeValueFxEnabled(true)
    applyLayout(activeCols)
    enemyZone.visible = !isTowerDefenseBattle()
    skillUI!.resolveIntroFromSnapshot(snapshot)
    root.addChild(enemyZone)
    root.addChild(playerZone)
    towerEnemyLayer = new Container()
    towerEnemyLayer.zIndex = 30
    towerEnemyLayer.sortableChildren = true
    towerEnemyLayer.eventMode = 'none'
    root.addChild(towerEnemyLayer)
    towerClassRangeLayer = new Container()
    towerClassRangeLayer.zIndex = 29
    towerClassRangeLayer.eventMode = 'none'
    root.addChild(towerClassRangeLayer)
    towerClassRangeLineByRole.clear()
    for (const key of ['swordsman', 'archer', 'assassin', 'mage'] as const) {
      const line = new Graphics()
      towerClassRangeLayer.addChild(line)
      towerClassRangeLineByRole.set(key, line)
    }
    const meleeSweepLayerContainer = new Container()
    meleeSweepLayerContainer.zIndex = 34
    meleeSweepLayerContainer.eventMode = 'none'
    root.addChild(meleeSweepLayerContainer)
    skillUI!.refresh(playerZone, enemyZone)
    skillUI!.refreshEnemy(playerZone, enemyZone, true)

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
    playerRangeBlockedHintLayer = new Container()
    enemyItemRoundStatLayer = new Container()
    playerItemRoundStatLayer = new Container()
    enemyStatusLayer.eventMode = 'none'
    playerStatusLayer.eventMode = 'none'
    playerRangeBlockedHintLayer.eventMode = 'none'
    enemyItemRoundStatLayer.eventMode = 'none'
    playerItemRoundStatLayer.eventMode = 'none'
    enemyZone.addChild(enemyCdOverlay)
    playerZone.addChild(playerCdOverlay)

    // CD 遮罩应在物品角标下方
    enemyZone.bringStatBadgesToFront()
    playerZone.bringStatBadgesToFront()

    enemyZone.addChild(enemyFreezeOverlay)
    playerZone.addChild(playerFreezeOverlay)
    enemyZone.addChild(enemyStatusLayer)
    playerZone.addChild(playerStatusLayer)
    enemyZone.addChild(enemyItemRoundStatLayer)
    playerZone.addChild(playerItemRoundStatLayer)
    playerZone.addChild(playerRangeBlockedHintLayer)
    enemyZone.bringStatBadgesToFront()
    playerZone.bringStatBadgesToFront()

    const fxLayerContainer = new Container()
    fxLayerContainer.zIndex = 60
    fxLayerContainer.eventMode = 'none'
    root.addChild(fxLayerContainer)

    towerGoldDropLayer = new Container()
    towerGoldDropLayer.zIndex = 61
    towerGoldDropLayer.eventMode = 'none'
    root.addChild(towerGoldDropLayer)

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
    itemInfoPopup.zIndex = 120
    itemInfoPopup.visible = false
    root.addChild(itemInfoPopup)

    fpsSampleElapsedMs = 0
    fpsSampleFrames = 0
    fpsShown = 0
    topSafeYOffset = getTopLeftControlYOffset()
    fpsHudText = new Text({
      text: 'FPS 0',
      style: {
        fontSize: 20,
        fill: 0xbde8ff,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x102136, width: 3 },
      },
    })
    fpsHudText.zIndex = 260
    root.addChild(fpsHudText)
    updateFpsHud(0)

    battleEndMask = new Graphics()
    battleEndMask.zIndex = 180
    battleEndMask.eventMode = 'static'
    battleEndMask.visible = false
    root.addChild(battleEndMask)

    transition.sceneFadeOverlay = new Graphics()
    transition.sceneFadeOverlay.zIndex = 220
    transition.sceneFadeOverlay.eventMode = 'none'
    transition.sceneFadeOverlay.rect(0, 0, CANVAS_W, CANVAS_H)
    transition.sceneFadeOverlay.fill({ color: 0x000000, alpha: 1 })
    transition.sceneFadeOverlay.alpha = 0
    transition.sceneFadeOverlay.visible = false
    root.addChild(transition.sceneFadeOverlay)

    if (isBattleSpeedButtonEnabled()) {
      speedBtn = makeSpeedButton()
      root.addChild(speedBtn)
    }

    organizeBtn = makeOrganizeButton()
    root.addChild(organizeBtn)

    topLeftButtonsExpanded = false
    topLeftFoldBtn = makeTopLeftFoldButton()
    root.addChild(topLeftFoldBtn)

    skillTestBtn = makeSkillTestButton()
    root.addChild(skillTestBtn)

    itemTestBtn = makeItemTestButton()
    root.addChild(itemTestBtn)

    backBtn = makeBackButton()
    backBtn.zIndex = 190
    backBtn.visible = false
    root.addChild(backBtn)

    continueBtn = makeContinueBattleButton()
    continueBtn.visible = false
    root.addChild(continueBtn)

    restartBtn = makeRestartButton()
    restartBtn.zIndex = 190
    restartBtn.visible = false
    root.addChild(restartBtn)

    buyBtn = makeBuyButton()
    buyBtn.zIndex = 190
    buyBtn.visible = false
    root.addChild(buyBtn)

    skillBuyBtn = makeSkillBuyButton()
    skillBuyBtn.zIndex = 190
    skillBuyBtn.visible = false
    root.addChild(skillBuyBtn)

    towerSkillDisplayCon = new Container()
    towerSkillDisplayCon.zIndex = 92
    towerSkillDisplayCon.eventMode = 'none'
    root.addChild(towerSkillDisplayCon)
    refreshTowerBattleSkillDisplay(true)

    sellDropZone = new Graphics()
    sellDropZone.zIndex = 65
    sellDropZone.visible = false
    sellDropZone.eventMode = 'none'
    root.addChild(sellDropZone)

    settlement.buildPanel(
      root,
      () => transition.beginExit(engine, enteredSnapshot, backBtn, speedBtn),
      () => {
        clearCurrentRunState()
        resetLifeState()
        resetWinTrophyState(getGameCfg().runRules?.trophyWinsToFinalVictory ?? 10)
        clearBattleSnapshot()
        clearBattleOutcome()
        if (isTowerDefenseBattle()) {
          markTowerAutoStartOnEnter()
          SceneManager.goto('tower-battle')
        }
        else window.location.reload()
      },
      () => {
        if (!hasBattleReplayRecord()) return
        if (!requestBattleReplay()) return
        SceneManager.goto('tower-battle')
      },
      () => transition.battleExitTransitionDurationMs > 0,
    )
    const settlementStatsBtnNew = damageStats.buildSettlementButton(() => {
      damageStats.setVisible(!damageStats.isVisible())
    })
    settlement.attachStatsBtn(settlementStatsBtnNew)

    damageStats.buildPanel(root)
    damageStats.buildButton(root, () => {
      damageStats.setVisible(!damageStats.isVisible())
    })

    await ensureTowerEnemyAssetWarmup()
    await ensureTowerEnemyProjectileAssetWarmupForDay(snapshot.day)

    engine = new TowerDefenseEngine()
    const renderRuntimeFlags = getRenderRuntimeFlags()
    const forceLowFx = renderRuntimeFlags.forceLowFx || renderRuntimeFlags.webgpuFallbackAdapter || renderRuntimeFlags.webgpuDeviceLostCount > 0
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
    if (forceLowFx) {
      autoFxDegradeLevel = 2
      fxPool.setAutoDegradeLevel(2)
      console.warn(`[BattleScene] Force low FX mode (fallback=${renderRuntimeFlags.webgpuFallbackAdapter} deviceLost=${renderRuntimeFlags.webgpuDeviceLostCount} reason=${renderRuntimeFlags.lastDeviceLostReason || 'none'})`)
    }
    // PVP 模式：优先使用快照的 ownerSkillIds（与 Host 权威战斗保持完全相同的输入），
    // 避免 skillUI.getPickedSkills()（来自 localStorage）与 ownerSkillIds（来自快照扫描）不一致
    // 导致本地动画结果与权威结果偏差。PVE 模式仍回退到 skillUI.
    const playerSkillIds = (PvpContext.isActive() && snapshot.ownerSkillIds != null)
      ? snapshot.ownerSkillIds
      : skillUI!.getPickedSkills().map((s) => s.id)
    engine.start(snapshot, {
      playerSkillIds,
      enemySkillIds: snapshot.pvpEnemySkillIds ?? [],
      enemyBackpackItemCount: snapshot.pvpEnemyBackpackItemCount,
      enemyGold: snapshot.pvpEnemyGold,
      enemyTrophyWins: snapshot.pvpEnemyTrophyWins,
    })
    syncTowerBattleSkillPickCountsToEngine()
    towerWaveStartAtMs = battlePresentationMs
    towerWaveTriggerConsumed = false
    skillUI!.loadFromSnapshot(engine.getEnemySkillIds())
    skillUI!.refreshEnemy(playerZone, enemyZone, true)
    console.log(`[BattleScene] 进入战斗场景 day=${snapshot.day} entities=${snapshot.entities.length} cols=${snapshot.activeColCount}`)

    // PVP sync mode setup
    // sync-a 的同步已在商店阶段完成（所有人 battle_sync_ready 后才 goto('tower-battle')）
    // 进入战斗场景时直接启动引擎
    syncAStarted = true
    fxPool.setContext(fxLayerContainer, playerZone, enemyZone, engine, meleeSweepLayerContainer)
    clearItemRoundStatTracking()

    const board = engine.getBoardState()
    damageStats.bootstrapFromBoard(engine)
    await mountZoneItems(playerZone, board.items.filter((it) => it.side === 'player'))
    await mountZoneItems(enemyZone, board.items.filter((it) => it.side === 'enemy'))
    ensureEditableBuildMode(stage)
    syncTowerEnemyPresentation(activeCols)
    drawTowerClassAttackDistanceGuides()
    drawTowerRemainingBar()

    enemyZone.makeItemsInteractive((id, e) => {
      e.stopPropagation()
      showBattleItemInfo(id, 'enemy')
    })
    if (!isTowerDefenseBattle()) {
      playerZone.makeItemsInteractive((id, e) => {
        e.stopPropagation()
        showBattleItemInfo(id, 'player')
      })
    }

    onStageTapHidePopup = () => {
      clearBattleItemSelection()
      skillUI?.hideDetailPopup()
    }
    stage.on('pointerdown', onStageTapHidePopup)

    offTriggerEvent = EventBus.on('battle:item_trigger', (e) => {
      if (!(e.side === 'player' && draggingPlayerItemId === e.sourceItemId)) {
        fxPool.tryPulseItem(e.sourceItemId, e.side)
      }
      damageStats.addTriggerCount(e.sourceItemId, e.side, Math.max(1, Math.round(e.multicast || e.triggerCount || 1)), engine)
    })

    offFireEvent = EventBus.on('battle:item_fire', (e) => {
      if (isTowerDefenseBattle() && e.side === 'player') {
        towerHasPlayerItemFiredOnce = true
        restoreTowerPreFirstAttackSpeed()
      }
      if (!e.projectileFromEnemyUnitId && !(e.side === 'player' && draggingPlayerItemId === e.sourceItemId)) {
        fxPool.tryPulseItem(e.sourceItemId, e.side)
      }
      if (!isTowerDefenseBattle()) return
      if (e.side === 'player') {
        const attackType = e.attackType ?? 'line_projectile'
        if (attackType === 'melee_sweep') {
          const cfg = getGameCfg().towerDefenseRules
          const heroPos = portraitFX.getPlayerHitPoint() ?? getHeroBarCenter('player')
          const originOffsetXRaw = Number(cfg?.playerMeleeSweepOriginOffsetX)
          const originOffsetYRaw = Number(cfg?.playerMeleeSweepOriginOffsetY)
          const startOffsetXRaw = Number(cfg?.playerMeleeSweepStartOffsetX)
          const endOffsetXRaw = Number(cfg?.playerMeleeSweepEndOffsetX)
          const mirrorStartOffsetXRaw = Number((cfg as { playerMeleeSweepMirrorStartOffsetX?: number } | undefined)?.playerMeleeSweepMirrorStartOffsetX)
          const mirrorEndOffsetXRaw = Number((cfg as { playerMeleeSweepMirrorEndOffsetX?: number } | undefined)?.playerMeleeSweepMirrorEndOffsetX)
          const isMirrorSweep = e.meleeSweepDirection === 'rtl'
          const originOffsetX = Number.isFinite(originOffsetXRaw) ? originOffsetXRaw : 92
          const originOffsetY = Number.isFinite(originOffsetYRaw) ? originOffsetYRaw : -36
          const baseStartOffsetX = Number.isFinite(startOffsetXRaw) ? startOffsetXRaw : 0
          const baseEndOffsetX = Number.isFinite(endOffsetXRaw) ? endOffsetXRaw : 0
          const mirrorStartOffsetX = Number.isFinite(mirrorStartOffsetXRaw) ? mirrorStartOffsetXRaw : -baseEndOffsetX
          const mirrorEndOffsetX = Number.isFinite(mirrorEndOffsetXRaw) ? mirrorEndOffsetXRaw : -baseStartOffsetX
          const startOffsetX = isMirrorSweep ? mirrorStartOffsetX : baseStartOffsetX
          const endOffsetX = isMirrorSweep ? mirrorEndOffsetX : baseEndOffsetX
          const durationRaw = Number(cfg?.playerMeleeSweepDurationMs)
          const durationMs = Number.isFinite(durationRaw) ? Math.max(1, durationRaw) : 260
          const startAngleRaw = Number(cfg?.playerMeleeSweepStartAngleDeg)
          const endAngleRaw = Number(cfg?.playerMeleeSweepEndAngleDeg)
          const mirrorStartAngleRaw = Number((cfg as { playerMeleeSweepMirrorStartAngleDeg?: number } | undefined)?.playerMeleeSweepMirrorStartAngleDeg)
          const mirrorEndAngleRaw = Number((cfg as { playerMeleeSweepMirrorEndAngleDeg?: number } | undefined)?.playerMeleeSweepMirrorEndAngleDeg)
          const baseStartAngleDeg = Number.isFinite(startAngleRaw) ? startAngleRaw : -130
          const baseEndAngleDeg = Number.isFinite(endAngleRaw) ? endAngleRaw : -20
          const mirrorStartAngleDeg = Number.isFinite(mirrorStartAngleRaw) ? mirrorStartAngleRaw : baseStartAngleDeg
          const mirrorEndAngleDeg = Number.isFinite(mirrorEndAngleRaw) ? mirrorEndAngleRaw : baseEndAngleDeg
          const startAngleDeg = isMirrorSweep ? mirrorStartAngleDeg : baseStartAngleDeg
          const endAngleDeg = isMirrorSweep ? mirrorEndAngleDeg : baseEndAngleDeg
          const alphaStartRaw = Number(cfg?.playerMeleeSweepAlphaStart)
          const alphaMidRaw = Number(cfg?.playerMeleeSweepAlphaMid)
          const alphaEndRaw = Number(cfg?.playerMeleeSweepAlphaEnd)
          const alphaStart = Number.isFinite(alphaStartRaw) ? Math.max(0, Math.min(1, alphaStartRaw)) : 0.35
          const alphaMid = Number.isFinite(alphaMidRaw) ? Math.max(0, Math.min(1, alphaMidRaw)) : 0.75
          const alphaEnd = Number.isFinite(alphaEndRaw) ? Math.max(0, Math.min(1, alphaEndRaw)) : 0.3
          const attackDistance = Math.max(1, Number(e.attackDistance) || 1)
          const scaleBaseRaw = Number(cfg?.playerMeleeSweepScaleBase)
          const scalePerDistanceRaw = Number(cfg?.playerMeleeSweepScalePerDistance)
          const scaleDistanceUnitRaw = Number(cfg?.playerMeleeSweepScaleDistanceUnit)
          const scaleMinRaw = Number(cfg?.playerMeleeSweepScaleMin)
          const scaleMaxRaw = Number(cfg?.playerMeleeSweepScaleMax)
          const weaponSizeRaw = Number(cfg?.playerMeleeSweepWeaponSizePx)
          const scaleBase = Number.isFinite(scaleBaseRaw) ? scaleBaseRaw : 0.75
          const scalePerDistance = Number.isFinite(scalePerDistanceRaw) ? scalePerDistanceRaw : 0.5
          const scaleDistanceUnit = Number.isFinite(scaleDistanceUnitRaw) ? Math.max(1, scaleDistanceUnitRaw) : 300
          const scaleMin = Number.isFinite(scaleMinRaw) ? Math.max(0.1, scaleMinRaw) : 0.5
          const scaleMax = Number.isFinite(scaleMaxRaw) ? Math.max(scaleMin, scaleMaxRaw) : 2.6
          const weaponSizePx = Number.isFinite(weaponSizeRaw) ? Math.max(8, weaponSizeRaw) : 170
          const sweepScale = Math.max(scaleMin, Math.min(scaleMax, scaleBase + (attackDistance / scaleDistanceUnit) * scalePerDistance))
          enqueueVisualFx({
            run: () => {
              fxPool.spawnMeleeSweep(
                { x: heroPos.x + originOffsetX, y: heroPos.y + originOffsetY },
                e.sourceItemId,
                {
                  durationMs,
                  startAngleDeg,
                  endAngleDeg,
                  startOffsetX,
                  endOffsetX,
                  alphaStart,
                  alphaMid,
                  alphaEnd,
                  sizePx: weaponSizePx,
                  scale: sweepScale,
                  flipX: isMirrorSweep,
                },
              )
            },
          })
          return
        }
        if (e.targetSide !== 'enemy') return
        const from = e.projectileFromEnemyUnitId
          ? (towerEnemyPosById.get(e.projectileFromEnemyUnitId) ?? getHeroBarCenter('enemy'))
          : (getDraggingPlayerSourcePoint(e.sourceItemId, e.side) ?? fxPool.getItemCenterById(e.sourceItemId, e.side) ?? getHeroBarCenter(e.side))
        if (!e.targetId) {
          const cfg = getGameCfg().towerDefenseRules
          const nearY = Number(cfg?.nearY) || 940
          const farY = Number(cfg?.farY) || 320
          const levelDistance = Math.max(1, Number(cfg?.levelDistance) || 1000)
          const farWidthRatio = Math.max(0.1, Math.min(1.2, Number(cfg?.roadFarWidthRatio) || 0.5))
          const nearWidthRatio = Math.max(0.2, Math.min(1.4, Number(cfg?.roadNearWidthRatio) || 1))
          const roadFarCenterX = Number(cfg?.roadFarCenterX) || CANVAS_W / 2
          const roadNearCenterX = Number(cfg?.roadNearCenterX) || CANVAS_W / 2
          const attackDistance = Math.max(1, Number(e.attackDistance) || 1)
          const clampedDistance = Math.max(0, Math.min(levelDistance, attackDistance))
          const progressAtMaxRange = Math.max(0, Math.min(1, 1 - clampedDistance / levelDistance))
          const nearHalfRoadW = Math.max(1, CANVAS_W * nearWidthRatio * 0.5)
          const laneNormRaw = (from.x - roadNearCenterX) / nearHalfRoadW
          const laneNorm = Math.max(-1.5, Math.min(1.5, laneNormRaw))
          const roadWidthRatioAtMax = farWidthRatio + (nearWidthRatio - farWidthRatio) * progressAtMaxRange
          const roadCenterXAtMax = roadFarCenterX + (roadNearCenterX - roadFarCenterX) * progressAtMaxRange
          const yAtMaxRange = farY + (nearY - farY) * progressAtMaxRange
          const to = {
            x: roadCenterXAtMax + laneNorm * (CANVAS_W * roadWidthRatioAtMax * 0.5),
            y: yAtMaxRange,
          }
          const bulletColor = getBattleOrbColor('hp')
          const flyMs = Math.max(1, Math.round(Number(e.projectileFlyMs) || 1))
          enqueueVisualFx({
            run: () => {
              fxPool.spawnProjectile(from, to, bulletColor, undefined, e.sourceItemId, {
                fixedDurationMs: flyMs,
                projectileStyle: 'linear',
                fadeOutMs: 100,
              })
            },
          })
          return
        }
        const targetEnemyUnitPos = towerEnemyPosById.get(e.targetId)
        const to = targetEnemyUnitPos ?? getHeroBarCenter('enemy')
        const bulletColor = getBattleOrbColor('hp')
        let flyMs = Math.max(1, Math.round(Number(e.projectileFlyMs) || 1))
        if (e.projectileFromEnemyUnitId) {
          const speedPxPerSec = Number(getGameCfg().towerDefenseRules?.playerBounceProjectileSpeedPxPerSec)
          if (Number.isFinite(speedPxPerSec) && speedPxPerSec > 0) {
            const dist = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y))
            flyMs = Math.max(1, Math.round((dist / speedPxPerSec) * 1000))
          }
        }
        enqueueVisualFx({
          run: () => {
            fxPool.spawnProjectile(from, to, bulletColor, undefined, e.sourceItemId, {
              fixedDurationMs: flyMs,
              projectileStyle: e.projectileStyle,
            })
          },
        })
        return
      }
      if (e.side !== 'enemy' || e.targetSide !== 'player') return
      const from = towerEnemyPosById.get(e.sourceItemId) ?? getHeroBarCenter('enemy')
      const to = portraitFX.getPlayerHitPoint() ?? getHeroBarCenter('player')
      const bulletColor = getBattleOrbColor('hp')
      const attackType = e.attackType ?? 'melee'
      if (attackType === 'melee') {
        triggerTowerEnemyAttack(e.sourceItemId)
        triggerTowerEnemyMeleeDash(
          e.sourceItemId,
          Math.max(1, Math.round(Number(e.meleeDashOutMs) || 140)),
          Math.max(1, Math.round(Number(e.meleeDashBackMs) || 220)),
        )
        return
      }
      triggerTowerEnemyAttack(e.sourceItemId)
      const flyMs = Math.max(1, Math.round(Number(e.projectileFlyMs) || 1))
      const projectileIcon = String(e.projectileIcon || '').trim()
      const projectileStyle = e.projectileStyle === 'spin' ? 'spin' : 'linear'
      if (attackType === 'spin_projectile') {
        enqueueVisualFx({
          run: () => {
            fxPool.spawnProjectile(from, to, bulletColor, undefined, undefined, {
              fixedDurationMs: flyMs,
              projectileIconName: projectileIcon,
              projectileScale: e.projectileScale,
              projectileStyle,
            })
          },
        })
        return
      }
      enqueueVisualFx({
        run: () => {
          fxPool.spawnProjectile(from, to, bulletColor, undefined, undefined, {
            fixedDurationMs: flyMs,
            projectileIconName: projectileIcon,
            projectileScale: e.projectileScale,
            projectileStyle,
          })
        },
      })
    })
    offItemEffectTriggerEvent = EventBus.on('battle:item_effect_trigger', (e) => {
      damageStats.addTriggerCount(e.sourceItemId, e.side, Math.max(1, Math.round(e.triggerCount || 1)), engine)
    })
    offTowerEnemyAttackPrepareEvent = EventBus.on('battle:tower_enemy_attack_prepare', (e) => {
      triggerTowerEnemyAttackPrepare(e.enemyUnitId, e.prepareLeadMs)
    })
    offItemDestroyEvent = EventBus.on('battle:item_destroy', (e) => {
      const catchUp = markVisualEventTick()
      fxPool.tryPulseItem(e.sourceItemId, e.sourceSide)
      const from = fxPool.getItemCenterById(e.sourceItemId, e.sourceSide) ?? getHeroBarCenter(e.sourceSide)
      const to = fxPool.getItemCenterById(e.targetItemId, e.targetSide) ?? getHeroBarCenter(e.targetSide)
      const destroyOrbColor = getBattleOrbColor('hp')
      enqueueVisualFx({
        run: () => {
          fxPool.spawnProjectile(from, to, destroyOrbColor, () => {
            fxPool.tryPulseItem(e.targetItemId, e.targetSide)
          }, e.sourceItemId)
        },
        mergeKey: catchUp ? `destroy|${e.sourceItemId}|${e.targetItemId}` : undefined,
      })
    })
    offDamageEvent = EventBus.on('battle:take_damage', (e) => {
      const catchUp = markVisualEventTick()
      if (engine) {
        const boardNow = engine.getBoardState()
        drawHeroBars(boardNow.player, boardNow.enemy)
      }
      const side = e.targetSide ?? (e.targetId === 'hero_enemy' ? 'enemy' : 'player')
      const fromSide = e.sourceSide === 'player' || e.sourceSide === 'enemy'
        ? e.sourceSide
        : (side === 'enemy' ? 'player' : 'enemy')
      if (!isTowerDefenseBattle() && fromSide === 'enemy' && e.sourceItemId.startsWith('td-enemy-')) {
        triggerTowerEnemyAttack(e.sourceItemId)
      }
      if (side === 'enemy' && e.targetId.startsWith('td-enemy-')) {
        triggerTowerEnemyHit(e.targetId)
      }
      if (e.sourceItemId && e.sourceType !== 'system' && !e.sourceItemId.startsWith('status_') && e.sourceItemId !== 'fatigue') {
        damageStats.addDamage(e.sourceItemId, fromSide, e.amount, engine)
        addItemRoundDamage(fromSide, e.sourceItemId, e.amount)
      }
      const enemyAttackToPlayer = side === 'player' && fromSide === 'enemy'
      const sourceEnemyUnitPos = fromSide === 'enemy' ? towerEnemyPosById.get(e.sourceItemId) : undefined
      const from = (e.sourceItemId === 'fatigue' || e.sourceItemId.startsWith('status_'))
        ? getHeroBarCenter(fromSide)
        : (fxPool.getItemCenterById(e.sourceItemId, fromSide) ?? sourceEnemyUnitPos ?? getHeroBarCenter(fromSide))
      const to = getHeroBarCenter(side)
      const targetEnemyUnitPos = side === 'enemy' ? towerEnemyPosById.get(e.targetId) : undefined
      const projectileTarget = side === 'enemy'
        ? (targetEnemyUnitPos ?? portraitFX.getEnemyHitPoint() ?? to)
        : enemyAttackToPlayer
          ? (portraitFX.getPlayerHitPoint() ?? to)
          : to
      const isFatigueDamage = e.sourceItemId === 'fatigue'
      if (isTowerDefenseBattle()
        && side === 'enemy'
        && fromSide === 'player'
        && e.targetId.startsWith('td-enemy-')
        && !e.sourceItemId.startsWith('status_')
        && !isFatigueDamage) {
        const dx = projectileTarget.x - from.x
        const dy = projectileTarget.y - from.y
        const mag = Math.hypot(dx, dy)
        if (mag > 0.001) {
          towerEnemyLastHitDirById.set(e.targetId, { x: dx / mag, y: dy / mag })
        }
      }
      const damageShown = e.amount
      const bulletColor = e.type === 'burn' ? getBattleOrbColor('burn') : e.type === 'poison' ? getBattleOrbColor('poison') : getBattleOrbColor('hp')
      const isTowerDeferredDamage = isTowerDefenseBattle()
        && side === 'enemy'
        && fromSide === 'player'
        && e.targetId.startsWith('td-enemy-')
        && !e.sourceItemId.startsWith('status_')
        && !isFatigueDamage
      const isTowerEnemyDeferredDamage = isTowerDefenseBattle()
        && side === 'player'
        && fromSide === 'enemy'
        && e.sourceItemId.startsWith('td-enemy-')
        && !e.sourceItemId.startsWith('status_')
        && !isFatigueDamage
      const isCritDamage = e.type === 'normal' && e.isCrit
      const textColor = e.type === 'burn'
        ? getBattleFloatTextColor('burn')
        : e.type === 'poison'
          ? getBattleFloatTextColor('poison')
          : isCritDamage
            ? getBattleFloatTextColor('crit')
            : getBattleFloatTextColor('damage')
      const textSize = getDebugCfg('battleTextFontSizeDamage')
      const floatingTarget = fxPool.offsetFloatingNumberTarget(side, projectileTarget)
      const playDamageVisual = () => {
        if (e.sourceItemId.startsWith('status_') || isFatigueDamage) {
          if (enemyAttackToPlayer) triggerPlayerPortraitHitFx()
          const task = {
            amount: Math.max(0, Math.round(damageShown)),
            run: () => {
              fxPool.spawnFloatingNumber(fxPool.offsetFloatingNumberTarget(side, to), `-${task.amount}`, textColor, textSize)
            },
            mergeKey: catchUp ? `damage_status|${side}|${e.targetId}|${e.type}` : undefined,
            mergeWith: (incoming: QueuedFxTask) => {
              task.amount += (incoming as QueuedFxTask & { amount?: number }).amount ?? 0
            },
          }
          enqueueVisualFx(task)
          return
        }
        const task = {
          amount: Math.max(0, Math.round(damageShown)),
          run: () => {
            if (isTowerDeferredDamage) {
              fxPool.spawnFloatingNumber(floatingTarget, `-${task.amount}`, textColor, textSize)
              return
            }
            if (isTowerEnemyDeferredDamage) {
              if (enemyAttackToPlayer) triggerPlayerPortraitHitFx()
              fxPool.spawnFloatingNumber(floatingTarget, `-${task.amount}`, textColor, textSize)
              return
            }
            fxPool.spawnProjectile(from, projectileTarget, bulletColor, () => {
              if (side === 'enemy') {
                portraitFX.triggerEnemyHit()
              } else if (enemyAttackToPlayer) {
                triggerPlayerPortraitHitFx()
              }
              fxPool.spawnFloatingNumber(floatingTarget, `-${task.amount}`, textColor, textSize)
            }, e.sourceItemId)
          },
          mergeKey: catchUp ? `damage|${side}|${e.targetId}|${e.sourceItemId}|${e.type}` : undefined,
          mergeWith: (incoming: QueuedFxTask) => {
            task.amount += (incoming as QueuedFxTask & { amount?: number }).amount ?? 0
          },
        }
        enqueueVisualFx(task)
      }

      if (e.sourceItemId.startsWith('status_') || isFatigueDamage) {
        playDamageVisual()
      } else if (isTowerDeferredDamage) {
        playDamageVisual()
      } else if (isTowerEnemyDeferredDamage) {
        playDamageVisual()
      } else {
        const gapMs = Math.max(0, getDebugCfg('battleMulticastVisualGapMs'))
        const dueMs = Math.max(battlePresentationMs, fxPool.sourceNextDamageVisualAtMs.get(e.sourceItemId) ?? battlePresentationMs)
        fxPool.sourceNextDamageVisualAtMs.set(e.sourceItemId, dueMs + gapMs)
        fxPool.scheduleDamageVisual(dueMs - battlePresentationMs, playDamageVisual)
      }
    })
    offShieldEvent = EventBus.on('battle:gain_shield', (e) => {
      const catchUp = markVisualEventTick()
      const side = e.targetSide ?? (e.targetId === 'hero_enemy' ? 'enemy' : 'player')
      if (e.sourceItemId && !e.sourceItemId.startsWith('status_')) {
        damageStats.addShield(e.sourceItemId, side, e.amount, engine)
        addItemRoundShield(side, e.sourceItemId, e.amount)
      }
      const from = fxPool.getItemCenterById(e.sourceItemId, side) ?? getHeroBarCenter(side)
      const to = getHeroBarCenter(side)
      const projectileTarget = side === 'enemy' ? (portraitFX.getEnemyHitPoint() ?? to) : to
      const shieldColor = getBattleFloatTextColor('shield')
      const shieldOrbColor = getBattleOrbColor('shield')
      const textSize = getDebugCfg('battleTextFontSizeDamage')
      const floatingTarget = fxPool.offsetFloatingNumberTarget(side, projectileTarget)
      const sourceDefId = engine?.getBoardState().items.find((it) => it.id === e.sourceItemId)?.defId ?? ''
      const sourceDef = sourceDefId ? getItemDefById(sourceDefId) : null
      const sourceArch = toSkillArchetype(getPrimaryArchetype(sourceDef?.tags ?? ''))
      const instantShieldFx = isTowerDefenseBattle() && side === 'player' && sourceArch === 'warrior'
      const task = {
        amount: Math.max(0, Math.round(e.amount)),
        run: () => {
          if (instantShieldFx) {
            fxPool.spawnFloatingNumber(floatingTarget, `+${task.amount}`, shieldColor, textSize)
          } else {
            fxPool.spawnProjectile(from, projectileTarget, shieldOrbColor, () => {
              if (side === 'enemy') {
                portraitFX.triggerEnemyHit()
              }
              fxPool.spawnFloatingNumber(floatingTarget, `+${task.amount}`, shieldColor, textSize)
            }, e.sourceItemId)
          }
        },
        mergeKey: catchUp ? `shield|${side}|${e.targetId}|${e.sourceItemId}` : undefined,
        mergeWith: (incoming: QueuedFxTask) => {
          task.amount += (incoming as QueuedFxTask & { amount?: number }).amount ?? 0
        },
      }
      enqueueVisualFx(task)
    })
    offHealEvent = EventBus.on('battle:heal', (e) => {
      const catchUp = markVisualEventTick()
      const side = e.targetSide ?? (e.targetId === 'hero_enemy' ? 'enemy' : 'player')
      const from = e.sourceItemId.startsWith('status_') ? getHeroBarCenter(side) : (fxPool.getItemCenterById(e.sourceItemId, side) ?? getHeroBarCenter(side))
      const to = getHeroBarCenter(side)
      const projectileTarget = side === 'enemy' ? (portraitFX.getEnemyHitPoint() ?? to) : to
      const textSize = getDebugCfg('battleTextFontSizeDamage')
      const floatingTarget = fxPool.offsetFloatingNumberTarget(side, projectileTarget)
      if (e.sourceItemId.startsWith('status_')) {
        const task = {
          amount: Math.max(0, Math.round(e.amount)),
          run: () => {
            fxPool.spawnFloatingNumber(fxPool.offsetFloatingNumberTarget(side, to), `+${task.amount}`, getBattleFloatTextColor('regen'), textSize)
          },
          mergeKey: catchUp ? `heal_status|${side}|${e.targetId}` : undefined,
          mergeWith: (incoming: QueuedFxTask) => {
            task.amount += (incoming as QueuedFxTask & { amount?: number }).amount ?? 0
          },
        }
        enqueueVisualFx(task)
      } else {
        const regenColor = getBattleFloatTextColor('regen')
        const regenOrbColor = getBattleOrbColor('regen')
        const task = {
          amount: Math.max(0, Math.round(e.amount)),
          run: () => {
            fxPool.spawnProjectile(from, projectileTarget, regenOrbColor, () => {
              if (side === 'enemy') {
                portraitFX.triggerEnemyHit()
              }
              fxPool.spawnFloatingNumber(floatingTarget, `+${task.amount}`, regenColor, textSize)
            }, e.sourceItemId)
          },
          mergeKey: catchUp ? `heal|${side}|${e.targetId}|${e.sourceItemId}` : undefined,
          mergeWith: (incoming: QueuedFxTask) => {
            task.amount += (incoming as QueuedFxTask & { amount?: number }).amount ?? 0
          },
        }
        enqueueVisualFx(task)
      }
    })
    offStatusApplyEvent = EventBus.on('battle:status_apply', (e) => {
      const catchUp = markVisualEventTick()
      fxPool.tryPulseItem(e.sourceItemId, e.sourceSide === 'player' || e.sourceSide === 'enemy' ? e.sourceSide : undefined)
      const fromResolved = e.sourceSide === 'player' || e.sourceSide === 'enemy'
        ? fxPool.getItemCenterById(e.sourceItemId, e.sourceSide)
        : fxPool.getItemCenterAnySide(e.sourceItemId)?.pos
      const targetIsHero = e.targetType === 'hero' || e.targetId === 'hero_enemy' || e.targetId === 'hero_player'
      const targetResolved = targetIsHero
        ? null
        : (e.targetSide === 'player' || e.targetSide === 'enemy'
            ? fxPool.getItemCenterById(e.targetId, e.targetSide)
            : fxPool.getItemCenterAnySide(e.targetId)?.pos)
      const targetSide = e.targetSide
        ?? (targetIsHero ? (e.targetId === 'hero_enemy' ? 'enemy' : 'player') : 'enemy')
      const from = fromResolved ?? getHeroBarCenter(targetSide === 'enemy' ? 'player' : 'enemy')
      const to = targetIsHero
        ? (targetSide === 'enemy'
            ? (portraitFX.getEnemyHitPoint() ?? getHeroBarCenter(targetSide))
            : (portraitFX.getPlayerHitPoint() ?? getHeroBarCenter(targetSide)))
        : (targetResolved ?? getHeroBarCenter(targetSide))
      const color =
        e.status === 'burn' ? getBattleOrbColor('burn')
          : e.status === 'poison' ? getBattleOrbColor('poison')
            : e.status === 'freeze' ? getBattleOrbColor('freeze')
              : e.status === 'slow' ? getBattleOrbColor('slow')
                : e.status === 'haste' ? getBattleOrbColor('haste')
                  : getBattleOrbColor('regen')
      const forceDot = e.status === 'freeze' || e.status === 'slow' || e.status === 'haste'
      enqueueVisualFx({
        run: () => {
          fxPool.spawnProjectile(from, to, color, () => {
            if (targetIsHero && targetSide === 'enemy') portraitFX.triggerEnemyHit()
            if (targetIsHero && targetSide === 'player') triggerPlayerPortraitHitFx()
          }, e.sourceItemId, { forceDot })
        },
        mergeKey: catchUp ? `status|${e.status}|${targetSide}|${e.targetId}|${e.sourceItemId}` : undefined,
      })
    })
    offStatusRemoveEvent = EventBus.on('battle:status_remove', () => {})
    offFatigueStartEvent = EventBus.on('battle:fatigue_start', () => {
      if (getDebugCfg('toastEnabled') < 0.5 || getDebugCfg('toastShowFatigueStart') < 0.5) return
      showFatigueToast('加时赛风暴来袭')
    })
    offUnitDieEvent = EventBus.on('battle:unit_die', (e) => {
      if (e.unitId === 'hero_player' || e.unitId === 'hero_enemy') return
      if (e.unitId.startsWith('td-enemy-')) {
        const impactPlayer = e.reason === 'impact_player'
        if (isTowerDefenseBattle() && !replayMode) {
          const baseGold = getTowerEnemyKillGoldByUnitId(e.unitId)
          const bonusPct = Math.max(0, Number(e.bonusGoldPct) || 0)
          const scaledGold = Math.max(0, Math.round(baseGold * (1 + bonusPct / 100)))
          const dropGold = bonusPct > 0 && baseGold > 0
            ? Math.max(baseGold + 1, scaledGold)
            : scaledGold
          if (dropGold > 0) {
            editableGold += dropGold
            const pos = towerEnemyPosById.get(e.unitId)
            if (pos) spawnTowerEnemyGoldDropFx(pos.x, pos.y, dropGold)
            const snap = buildEditableSnapshotFromBoard(battleDay)
            if (snap) {
              enteredSnapshot = snap
              setBattleSnapshot(snap)
            }
          }
        }
        if (impactPlayer) {
          removeTowerEnemyImmediately(e.unitId)
          return
        }
        triggerTowerEnemyDeathFly(e.unitId, towerEnemyLastHitDirById.get(e.unitId) ?? null)
        return
      }
      const side = e.side === 'enemy' ? 'enemy' : 'player'
      fxPool.tryPulseItem(e.unitId, side)
      fxPool.pendingDestroyedItemDueMs.set(e.unitId, battlePresentationMs + 180)
    })
    offBattleEndEvent = EventBus.on('battle:end', (e) => {
      const result = e.winner === 'player' ? '胜' : e.winner === 'enemy' ? '败' : '平'
      console.log(`[Battle] ${e.blameLog.join(' ')} result=${result}`)
    })
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
    towerDayText = null
    backBtn = null
    continueBtn = null
    continueBtnText = null
    restartBtn = null
    buyBtn = null
    buyBtnBg = null
    buyBtnPulseFrame = null
    buyBtnText = null
    skillBuyBtn = null
    skillBuyBtnBg = null
    skillBuyBtnText = null
    skillBuyBtnPulseFrame = null
    sellDropZone = null
    speedBtn = null
    speedBtnText = null
    organizeBtn = null
    topLeftFoldBtn = null
    topLeftFoldBtnText = null
    topLeftButtonsExpanded = false
    skillTestBtn = null
    itemTestBtn = null
    closeBattleItemTestOverlay()
    closeBattleSkillTestOverlay()
    battleEndMask = null
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
    playerRangeBlockedHintLayer = null
    enemyItemRoundStatLayer = null
    playerItemRoundStatLayer = null
    for (const one of playerRangeBlockedHintTextById.values()) one.destroy()
    playerRangeBlockedHintTextById.clear()
    for (const one of enemyItemRoundStatTextById.values()) one.destroy()
    enemyItemRoundStatTextById.clear()
    for (const one of playerItemRoundStatTextById.values()) one.destroy()
    playerItemRoundStatTextById.clear()
    enemyItemRoundDamageById.clear()
    playerItemRoundDamageById.clear()
    enemyItemRoundShieldById.clear()
    playerItemRoundShieldById.clear()
    skillUI?.reset()
    skillUI = null
    offTriggerEvent?.(); offTriggerEvent = null
    offFireEvent?.(); offFireEvent = null
    offItemEffectTriggerEvent?.(); offItemEffectTriggerEvent = null
    offDamageEvent?.(); offDamageEvent = null
    offShieldEvent?.(); offShieldEvent = null
    offHealEvent?.(); offHealEvent = null
    offStatusApplyEvent?.(); offStatusApplyEvent = null
    offStatusRemoveEvent?.(); offStatusRemoveEvent = null
    offFatigueStartEvent?.(); offFatigueStartEvent = null
    offUnitDieEvent?.(); offUnitDieEvent = null
    offItemDestroyEvent?.(); offItemDestroyEvent = null
    offBattleEndEvent?.(); offBattleEndEvent = null
    offTowerEnemyAttackPrepareEvent?.(); offTowerEnemyAttackPrepareEvent = null
    itemInfoPopup = null
    fpsHudText = null
    fpsSampleElapsedMs = 0
    fpsSampleFrames = 0
    fpsShown = 0
    selectedItemId = null
    selectedItemSide = null
    selectedItemInfoKey = null
    selectedItemInfoMode = getDefaultItemInfoMode()
    fatigueToastCon = null
    fatigueToastBg = null
    fatigueToastText = null
    towerGoldDropLayer = null
    towerSkillDisplayCon = null
    towerSkillDisplayKey = ''
    towerRemainBarG = null
    towerRemainBarTextBg = null
    towerRemainBarText = null
    towerGoldBadgeBg = null
    towerGoldBadgeText = null
    towerBottomFocusBg = null
    towerDayTextBg = null
    fatigueToastUntilMs = 0
    portraitFX.reset()
    transition.reset()
    settlement.reset()
    enemyPresentationVisible = true
    battleDay = 1
    settlementRevealAtMs = null
    battlePresentationMs = 0
    chargeUiElapsedSinceTickMs = 0
    ammoReloadUiElapsedSinceTickMs = 0
    enteredSnapshot = null
    battleSpeed = getDefaultBattleSpeed()
    towerHasPlayerItemFiredOnce = false
    towerPreFirstAttackSpeedBoostActive = false
    towerPreFirstAttackOriginalSpeed = null
    fxPool.reset()
    fxPool.setRandomProvider(null)
    const cleanupCfg = getGameCfg().runRules?.battleCacheCleanup
    if (cleanupCfg?.enabled && cleanupCfg?.forceTextureGcOnBattleExit) runRendererTextureGcNow()
    visualFxQueue = []
    visualFxMergeMap.clear()
    visualFxDroppedCount = 0
    visualFrameSeenTicks.clear()
    visualFrameHasCatchUp = false
    monitorSampleElapsedMs = 0
    monitorHighStreak = 0
    monitorRecoverStreak = 0
    autoFxDegradeLevel = 0
    diagTickStallElapsedMs = 0
    diagTickStallLastTick = -1
    diagTickStallLastEmitAtMs = 0
    diagBattleSampleElapsedMs = 0
    lastHudTickIndex = -1
    damageStats.reset()
    clearBattleRuntimePerfSampleWindow()
    battleRuntimePerfSnapshot = {}
    battleLastTickIndexForPerf = -1
    appliedActiveCols = -1
    playerZoneResizeTransition = null
    towerPlayerHpBarRowYOffsetTransition = null
    towerPlayerHpBarRowYOffset = 0
    replayMode = false
    replayRandomSourceValues = null
    replayRandomCursor = 0
    battleRandomValues = []
    battleRandomTags = []
    battleEnemyHeroVisualId = null
    battleReplaySaved = false
    towerBattleBuyCount = 0
    towerBattleSkillBuyCount = 0
    towerBattleZoneExpandStep = 0
    towerBattleSkillPickCounts.clear()
    pendingBattleBuyOffer = null
    buyBtnLastCanAfford = null
    buyBtnAffordPulseStartAtMs = null
    buyBtnAffordVisualState = null
    towerZoneExpandBtnLastCanAfford = null
    towerZoneExpandBtnAffordPulseStartAtMs = null
    towerZoneExpandBtnAffordVisualState = null
    towerZoneExpandBtnBg = null
    towerZoneExpandBtnPulseFrame = null
    towerZoneExpandBtnText = null
    skillBuyBtnLastCanAfford = null
    skillBuyBtnAffordPulseStartAtMs = null
    playerFourHeroPortraitLayer = null
    playerFourHeroPortraitUnits.length = 0
    playerFourHeroHitElapsedMs = -1
    playerFourHeroHitStem = null
    playerFourHeroSlotStems = [...PLAYER_FOUR_HERO_SLOT_STEMS_DEFAULT]
    playerFourHeroSwapAnim = null
    towerEnemyDefIdByUnitId.clear()
    clearTowerEnemyGoldDropFx()
    towerNextWaveAutoStartAtMs = null
    towerWaveStartAtMs = 0
    towerWaveTriggerConsumed = false
    towerForceAutoStartOnEnter = false
    closeTowerSkillDraftOverlay()
    editableDrag?.destroy()
    editableDrag = null
    editableSystem = null
    editableMeta.clear()
    editableGold = 0
    draggingPlayerItemId = null
    draggingPlayerItemFirePoint = null
    towerWaveAdvanceInProgress = false
    // PVP sync cleanup
    syncAStarted = false
    earlyReportDone = false
    engine = null
    console.log('[BattleScene] 离开战斗场景')
  },
  update(dt: number) {
    updateFpsHud(dt)
    if (!engine || !enemyZone || !playerZone || !enemyCdOverlay || !playerCdOverlay || !enemyFreezeOverlay || !playerFreezeOverlay || !enemyStatusLayer || !playerStatusLayer) return
    if (transition.tickExit(dt * 1000)) return
    const framePerfStartMs = performance.now()
    const runtimeCacheBefore = engine.getRuntimeCachePerfStats()
    if (isPvpSpeedupDisabled() && battleSpeed !== 1) {
      battleSpeed = 1
    }
    const speed = isPvpSpeedupDisabled() ? 1 : Math.max(1, battleSpeed)
    const simDt = dt * speed
    const dtMs = simDt * 1000
    const pauseVisualBySkillDraft = !!towerSkillDraftOverlay
    const visualDtMs = pauseVisualBySkillDraft ? 0 : dtMs
    visualFrameSeenTicks.clear()
    visualFrameHasCatchUp = false
    battlePresentationMs += visualDtMs
    if (!pauseVisualBySkillDraft) {
      tickTowerEnemyGoldDropFx()
      tickAutoFxDegrade(visualDtMs)
    }
    skillUI?.tickIntro(visualDtMs, playerZone)
    const introDone = transition.tickIntro(simDt * 1000, root)
    const allowSimUpdate = introDone && syncAStarted && !towerSkillDraftOverlay
    let engineUpdateCostMs = 0
    if (allowSimUpdate) {
      const t0 = performance.now()
      engine.update(simDt)
      engineUpdateCostMs = performance.now() - t0
    }
    const queueConsumeStartMs = performance.now()
    if (!pauseVisualBySkillDraft) consumeVisualFxQueue(visualDtMs)
    const queueConsumeCostMs = performance.now() - queueConsumeStartMs
    const pendingDamageImpactFx = fxPool.hasPendingDamageImpactPresentation()
    const towerMode = isTowerDefenseBattle()
    enemyPresentationVisible = !towerMode
    enemyZone.visible = enemyPresentationVisible
    if (portraitFX.enemyBossSprite) portraitFX.enemyBossSprite.visible = enemyPresentationVisible
    if (portraitFX.enemyBossFlashSprite) portraitFX.enemyBossFlashSprite.visible = enemyPresentationVisible
    const runtimeBuildStartMs = performance.now()
    const board = engine.getBoardState()
    const runtime = engine.getRuntimeState()
    const debugState = engine.getDebugState()
    const tickChanged = debugState.tickIndex !== lastHudTickIndex
    const isBattleFinished = engine.isFinished()
    const allowCdUiInterpolation = allowSimUpdate && !isBattleFinished
    const pulseActive = fxPool.getPulseStatesSize() > 0
    chargeUiElapsedSinceTickMs = (!allowCdUiInterpolation || tickChanged)
      ? 0
      : (chargeUiElapsedSinceTickMs + dtMs)
    ammoReloadUiElapsedSinceTickMs = (!allowCdUiInterpolation || tickChanged)
      ? 0
      : (ammoReloadUiElapsedSinceTickMs + dtMs)
    if (allowSimUpdate && !isBattleFinished) {
      if (diagTickStallLastTick === debugState.tickIndex) {
        diagTickStallElapsedMs += dtMs
      } else {
        diagTickStallLastTick = debugState.tickIndex
        diagTickStallElapsedMs = 0
      }
      if (diagTickStallElapsedMs >= 1200) {
        const nowMs = Date.now()
        if (nowMs - diagTickStallLastEmitAtMs >= 2500) {
          diagTickStallLastEmitAtMs = nowMs
          emitDiagEvent('tower_tick_stall', {
            day: battleDay,
            tickIndex: debugState.tickIndex,
            stallMs: Math.round(diagTickStallElapsedMs),
            playerAlive: debugState.playerAlive,
            enemyAlive: debugState.enemyAlive,
            playerHp: debugState.playerHp,
            enemyHp: debugState.enemyHp,
            inFatigue: debugState.inFatigue,
          })
        }
      }
    } else {
      diagTickStallLastTick = debugState.tickIndex
      diagTickStallElapsedMs = 0
    }
    const combatRuntimeCfg = getGameCfg().combatRuntime
    const slowFactor = Math.max(0, Math.min(0.95, combatRuntimeCfg.cardSlowFactor ?? 0.4))
    const hasteFactor = Math.max(0, combatRuntimeCfg.cardHasteFactor ?? 0.4)
    runtimeChargePercentByIdScratch.clear()
    runtimeAmmoReloadMsByIdScratch.clear()
    runtimeByIdScratch.clear()
    runtimeRangeBlockedByIdScratch.clear()
    for (const it of runtime) {
      const rawCooldownMs = Math.max(0, it.cooldownMs)
      if (rawCooldownMs <= 0) {
        runtimeChargePercentByIdScratch.set(it.id, 1)
        runtimeAmmoReloadMsByIdScratch.set(it.id, 0)
        runtimeByIdScratch.set(it.id, it)
        continue
      }
      const cooldownMs = rawCooldownMs
      let gainRate = 1
      if (it.freezeMs > 0) {
        gainRate = 0
      } else {
        if (it.slowMs > 0) gainRate *= Math.max(0.05, 1 - slowFactor)
        if (it.hasteMs > 0) gainRate *= 1 + hasteFactor
      }
      const predictedChargeMs = allowCdUiInterpolation
        ? Math.min(cooldownMs, Math.max(0, it.currentChargeMs + chargeUiElapsedSinceTickMs * gainRate))
        : Math.min(cooldownMs, Math.max(0, it.currentChargeMs))
      const predictedChargePercent = Math.max(0, Math.min(1, predictedChargeMs / cooldownMs))
      const canInterpolateReload = allowCdUiInterpolation
        && it.ammoAutoReloadRemainingMs > 0
        && it.ammoMax > 0
        && it.ammoCurrent <= 0
        && it.currentChargeMs >= cooldownMs
        && it.freezeMs <= 0
      const predictedReloadMs = canInterpolateReload
        ? Math.max(0, it.ammoAutoReloadRemainingMs - ammoReloadUiElapsedSinceTickMs)
        : Math.max(0, it.ammoAutoReloadRemainingMs)
      runtimeChargePercentByIdScratch.set(it.id, predictedChargePercent)
      runtimeAmmoReloadMsByIdScratch.set(it.id, predictedReloadMs)
      runtimeByIdScratch.set(it.id, it)
      runtimeRangeBlockedByIdScratch.set(it.id, it.rangeBlocked === true)
    }
    const runtimeBuildCostMs = performance.now() - runtimeBuildStartMs
    const layoutStartMs = performance.now()
    const activeCols = getDayActiveCols(battleDay)
    const desiredPlayerRows = isTowerDefenseBattle() ? getTowerBattleRowsForCurrentExpandStep() : (playerZone?.activeRowCount ?? 1)
    const rowNeedsUpdate = !!playerZone && playerZone.activeRowCount !== desiredPlayerRows
    if (activeCols !== appliedActiveCols || (rowNeedsUpdate && !playerZoneResizeTransition)) {
      enemyZone.setActiveColCount(activeCols)
      applyZoneVisualStyle(enemyZone, 'enemy')
      const shouldAnimatePlayerResize = isTowerDefenseBattle()
        && appliedActiveCols > 0
        && !!playerZone
        && (playerZone.activeColCount !== activeCols || playerZone.activeRowCount !== desiredPlayerRows)
      if (shouldAnimatePlayerResize) {
        startPlayerZoneResizeTransition(activeCols, desiredPlayerRows)
        applyLayout(activeCols, { keepPlayerZoneX: true, keepPlayerZoneY: true })
      } else {
        playerZone.setActiveColCount(activeCols)
        playerZone.setActiveRowCount(desiredPlayerRows)
        applyZoneVisualStyle(playerZone, 'player')
        if (playerZoneResizeTransition) applyLayout(activeCols, { keepPlayerZoneX: true, keepPlayerZoneY: true })
        else applyLayout(activeCols)
      }
      appliedActiveCols = activeCols
    }
    updatePlayerZoneResizeTransition(dtMs)
    updateTowerPlayerHpBarRowYOffsetTransition(dtMs)
    if (isBattlePlayerFourHeroPortraitEnabled() || playerFourHeroSwapAnim) {
      applyLayout(activeCols, { keepPlayerZoneX: true, keepPlayerZoneY: true })
    }
    const layoutCostMs = performance.now() - layoutStartMs
    syncTowerEnemyPresentation(activeCols)
    drawTowerClassAttackDistanceGuides()
    if (isTowerDefenseBattle()) {
      drawTowerRemainingBar()
      if (towerRemainBarG) towerRemainBarG.visible = false
      if (towerRemainBarTextBg) towerRemainBarTextBg.visible = true
      if (towerRemainBarText) towerRemainBarText.visible = true
    } else {
      if (towerRemainBarG) towerRemainBarG.visible = false
      if (towerRemainBarTextBg) {
        towerRemainBarTextBg.clear()
        towerRemainBarTextBg.visible = false
      }
      if (towerRemainBarText) towerRemainBarText.visible = false
    }

    playerItemsScratch.length = 0
    enemyItemsScratch.length = 0
    playerAliveIdsScratch.clear()
    enemyAliveIdsScratch.clear()
    for (const it of board.items) {
      if (it.side === 'player') {
        playerItemsScratch.push(it)
        playerAliveIdsScratch.add(it.id)
      } else {
        enemyItemsScratch.push(it)
        enemyAliveIdsScratch.add(it.id)
      }
    }
    if (skillUI) {
      skillUI.setEnemyBarVisible(enemyPresentationVisible && skillUI.getEnemySkills().length > 0)
      if (!enemyPresentationVisible && skillUI.isDetailPopupVisible()) skillUI.hideDetailPopup()
    }
    const syncRemovedStartMs = performance.now()
    syncRemovedZoneItems(playerZone, 'player', playerAliveIdsScratch)
    syncRemovedZoneItems(enemyZone, 'enemy', enemyAliveIdsScratch)
    const syncRemovedCostMs = performance.now() - syncRemovedStartMs
    const overlayStartMs = performance.now()
    drawCooldownOverlay(playerZone, playerCdOverlay, playerItemsScratch, runtimeChargePercentByIdScratch)
    drawCooldownOverlay(enemyZone, enemyCdOverlay, enemyItemsScratch, runtimeChargePercentByIdScratch)
    const overlayCostMs = performance.now() - overlayStartMs
    let statusFxCostMs = 0
    if (tickChanged || pulseActive) {
      const statusFxStartMs = performance.now()
      fxPool.updateStatusFx(
        playerZone,
        enemyZone,
        engine,
        playerStatusLayer,
        enemyStatusLayer,
        playerFreezeOverlay,
        enemyFreezeOverlay,
        runtimeByIdScratch,
      )
      statusFxCostMs = performance.now() - statusFxStartMs
    }
    const badgesStartMs = performance.now()
    updateRuntimeStatBadges(playerZone, playerItemsScratch, runtimeByIdScratch, runtimeAmmoReloadMsByIdScratch)
    updateRuntimeStatBadges(enemyZone, enemyItemsScratch, runtimeByIdScratch, runtimeAmmoReloadMsByIdScratch)
    updateItemRoundStatHints(
      playerZone,
      playerItemRoundStatLayer,
      playerItemRoundStatTextById,
      playerItemsScratch,
      playerItemRoundDamageById,
      playerItemRoundShieldById,
    )
    updateItemRoundStatHints(
      enemyZone,
      enemyItemRoundStatLayer,
      enemyItemRoundStatTextById,
      enemyItemsScratch,
      enemyItemRoundDamageById,
      enemyItemRoundShieldById,
    )
    if (towerMode) {
      updatePlayerRangeBlockedHints(playerZone, playerItemsScratch, runtimeRangeBlockedByIdScratch)
    } else {
      for (const one of playerRangeBlockedHintTextById.values()) one.visible = false
    }
    const badgesCostMs = performance.now() - badgesStartMs
    let heroBarsCostMs = 0
    if (tickChanged) {
      const heroBarsStartMs = performance.now()
      drawHeroBars(board.player, board.enemy)
      heroBarsCostMs = performance.now() - heroBarsStartMs
      lastHudTickIndex = debugState.tickIndex
    }

    const fxTickStartMs = performance.now()
    fxPool.tick(visualDtMs)
    const fxTickCostMs = performance.now() - fxTickStartMs
    const portraitStartMs = performance.now()
    portraitFX.tickEnemy(visualDtMs)
    portraitFX.tickPlayer(visualDtMs)
    tickPlayerFourHeroPortrait(visualDtMs)
    const portraitCostMs = performance.now() - portraitStartMs

    const queueStats = engine.getQueuePerfStats()
    const queuePendingRatio = Math.max(
      queueStats.pendingHits / Math.max(1, queueStats.maxPendingHits),
      queueStats.pendingItemFires / Math.max(1, queueStats.maxPendingItemFires),
      queueStats.pendingChargePulses / Math.max(1, queueStats.maxPendingChargePulses),
      queueStats.pendingAmmoRefills / Math.max(1, queueStats.maxPendingAmmoRefills),
    )
    diagBattleSampleElapsedMs += dtMs
    if (diagBattleSampleElapsedMs >= 2000) {
      diagBattleSampleElapsedMs = 0
      const towerStats = engine.getTowerEnemyStats?.()
      emitDiagEvent('tower_runtime_sample', {
        day: battleDay,
        tickIndex: debugState.tickIndex,
        isFinished: isBattleFinished,
        settlementResolved: settlement.isResolved(),
        playerAlive: debugState.playerAlive,
        enemyAlive: debugState.enemyAlive,
        playerHp: debugState.playerHp,
        enemyHp: debugState.enemyHp,
        pendingHits: queueStats.pendingHits,
        pendingItemFires: queueStats.pendingItemFires,
        pendingChargePulses: queueStats.pendingChargePulses,
        pendingAmmoRefills: queueStats.pendingAmmoRefills,
        queuePendingRatio: Math.round(queuePendingRatio * 1000) / 1000,
        remainingCount: towerStats?.remainingCount,
        totalCount: towerStats?.totalCount,
        allEnemiesSpawnedAtMs: towerStats?.allEnemiesSpawnedAtMs,
      }, { level: 'verbose' })
    }
    const prevTick = battleLastTickIndexForPerf
    const tickDelta = prevTick < 0 ? 0 : Math.max(0, debugState.tickIndex - prevTick)
    battleLastTickIndexForPerf = debugState.tickIndex
    const runtimeCacheAfter = engine.getRuntimeCachePerfStats()
    const runtimeCallsDelta = Math.max(0, runtimeCacheAfter.calls - runtimeCacheBefore.calls)
    const runtimeCacheHitsDelta = Math.max(0, runtimeCacheAfter.cacheHits - runtimeCacheBefore.cacheHits)
    let settlementCostMs = 0
    if (battleEndMask) {
      const settlementStartMs = performance.now()
      if (engine.isFinished()) {
        if (!settlement.isResolved()) {
          if (!pendingDamageImpactFx) {
            const extraDelayMs = Math.max(0, getDebugCfg('battleSettlementDelayMs'))
            if (settlementRevealAtMs === null) settlementRevealAtMs = battlePresentationMs + extraDelayMs
            if (battlePresentationMs >= settlementRevealAtMs) {
              settlement.resolve(battleDay, engine, { applyRunState: !replayMode })
            }
          } else {
            settlementRevealAtMs = null
          }
        }
        if (settlement.isResolved() && !battleReplaySaved && enteredSnapshot) {
          const replayEnemyHeroId = battleEnemyHeroVisualId ?? HERO_VISUAL_IDS[0]
          saveBattleReplayRecord({
            snapshot: enteredSnapshot,
            enemyHeroId: replayEnemyHeroId,
            randomValues: [...battleRandomValues],
            randomTags: [...battleRandomTags],
            createdAtMs: Date.now(),
          })
          battleReplaySaved = true
        }
        // PVP：结算面板首次显示时立即提前上报本轮结果，不等待按钮点击
        if (settlement.isResolved() && PvpContext.isActive() && !replayMode && !earlyReportDone) {
          earlyReportDone = true
          PvpContext.reportBattleResultEarly(battleDay)
          // reportBattleResultEarly 可能同步触发场景切换（如被淘汰时）导致 teardown 执行
          // 此时 battleEndMask 已被置 null，需提前返回避免报错
          if (!battleEndMask) return
        }
        const hideMaskForTowerWin = isTowerDefenseBattle() && settlement.isResolved() && !settlement.isGameOver()
        battleEndMask.visible = settlement.isResolved() && !hideMaskForTowerWin
        if (battleEndMask.visible) {
          battleEndMask.clear()
          battleEndMask.rect(0, 0, CANVAS_W, CANVAS_H)
          battleEndMask.fill({ color: 0x000000, alpha: 0.45 })
        }
      } else if (battleEndMask.visible) {
        battleEndMask.visible = false
      }
      settlementCostMs = performance.now() - settlementStartMs
    }

    if (speedBtn) {
      const towerMode = isTowerDefenseBattle()
      const showTopActionButtons = !towerWaveAdvanceInProgress
        && transition.battleExitTransitionDurationMs <= 0
        && !settlement.isGameOver()
      speedBtn.visible = towerMode ? (showTopActionButtons && topLeftButtonsExpanded) : !engine.isFinished()
      if (towerMode) {
        speedBtn.x = getTowerTopLeftActionBtnX()
        speedBtn.y = getTowerTopLeftActionBtnY(4)
      } else {
        speedBtn.y = getClampedTopActionBtnY()
      }
      if (speedBtnText) speedBtnText.text = `倍速:${battleSpeed}x`
    }

    if (topLeftFoldBtn) {
      const towerMode = isTowerDefenseBattle()
      const showTopActionButtons = !towerWaveAdvanceInProgress
        && transition.battleExitTransitionDurationMs <= 0
        && !settlement.isGameOver()
      topLeftFoldBtn.visible = towerMode ? showTopActionButtons : false
      topLeftFoldBtn.x = getTowerTopLeftActionBtnX()
      topLeftFoldBtn.y = getTowerTopLeftActionBtnY(0)
      if (topLeftFoldBtnText) topLeftFoldBtnText.text = topLeftButtonsExpanded ? '◀' : '▶'
    }

    {
      const statsBtn = damageStats.getTopLeftButton()
      if (statsBtn) {
        const towerMode = isTowerDefenseBattle()
        const showTopActionButtons = !towerWaveAdvanceInProgress
          && transition.battleExitTransitionDurationMs <= 0
          && !settlement.isGameOver()
        statsBtn.visible = towerMode ? (showTopActionButtons && topLeftButtonsExpanded) : false
        if (towerMode) {
          statsBtn.x = getTowerTopLeftActionBtnX()
          statsBtn.y = getTowerTopLeftActionBtnY(5)
        }
      }
    }

    if (organizeBtn) {
      const towerMode = isTowerDefenseBattle()
      const canShowTowerOrganizeBtn = !towerWaveAdvanceInProgress
        && transition.battleExitTransitionDurationMs <= 0
        && !settlement.isGameOver()
        && !towerSkillDraftOverlay
      organizeBtn.visible = towerMode ? canShowTowerOrganizeBtn : !engine.isFinished()
      if (towerMode) {
        organizeBtn.x = CANVAS_W / 2 - (TOWER_BOTTOM_ACTION_BTN_W + TOWER_BOTTOM_ACTION_BTN_GAP)
        organizeBtn.y = getTowerBattleBuyButtonY()
        const unlockCount = getTowerZoneExpandBuyUnlockItemCount()
        const expandCost = getTowerZoneExpandBuyCost()
        const unlocked = towerBattleBuyCount >= unlockCount
        const upgradable = !!getTowerZoneExpandNextStage()
        const canAfford = upgradable && unlocked && editableGold >= expandCost
        if (towerZoneExpandBtnLastCanAfford === null) {
          towerZoneExpandBtnLastCanAfford = canAfford
        } else if (!towerZoneExpandBtnLastCanAfford && canAfford && canShowTowerOrganizeBtn) {
          towerZoneExpandBtnAffordPulseStartAtMs = battlePresentationMs
        }
        towerZoneExpandBtnLastCanAfford = canAfford
        if (!canAfford) towerZoneExpandBtnAffordPulseStartAtMs = null
        const nextVisualState = canAfford
        if (towerZoneExpandBtnAffordVisualState !== nextVisualState) {
          redrawTowerZoneExpandButtonVisual(canAfford, unlocked, upgradable)
          towerZoneExpandBtnAffordVisualState = nextVisualState
        }
        if (canShowTowerOrganizeBtn) tickTowerZoneExpandAffordPulse()
        else if (towerZoneExpandBtnPulseFrame) towerZoneExpandBtnPulseFrame.visible = false
        organizeBtn.alpha = upgradable ? (canAfford ? 1 : 0.6) : 0.7
        organizeBtn.cursor = canAfford ? 'pointer' : 'default'
        if (towerZoneExpandBtnText) {
          towerZoneExpandBtnText.text = formatTowerZoneExpandButtonText(editableGold, expandCost, unlockCount)
        }
      } else {
        organizeBtn.y = getClampedTopActionBtnY('battleOrganizeBtnY')
      }
    }
    if (isTowerDefenseBattle() && organizeBtn?.visible) {
      drawTowerGoldBadgeAtExpandButton()
    } else {
      if (towerGoldBadgeBg) {
        towerGoldBadgeBg.clear()
        towerGoldBadgeBg.visible = false
      }
      if (towerGoldBadgeText) towerGoldBadgeText.visible = false
    }

    if (skillTestBtn) {
      skillTestBtn.x = getTowerTopLeftActionBtnX()
      skillTestBtn.y = getTowerTopLeftActionBtnY(1)
      const canEditInBattle = isTowerDefenseBattle() && !replayMode && !towerWaveAdvanceInProgress && transition.battleExitTransitionDurationMs <= 0 && !settlement.isGameOver() && !towerSkillDraftOverlay
      skillTestBtn.visible = canEditInBattle && topLeftButtonsExpanded
    }

    if (itemTestBtn) {
      itemTestBtn.x = getTowerTopLeftActionBtnX()
      itemTestBtn.y = getTowerTopLeftActionBtnY(2)
      const canEditInBattle = isTowerDefenseBattle() && !replayMode && !towerWaveAdvanceInProgress && transition.battleExitTransitionDurationMs <= 0 && !settlement.isGameOver() && !towerSkillDraftOverlay
      itemTestBtn.visible = canEditInBattle && topLeftButtonsExpanded
    }

    const settlementUiStartMs = performance.now()
    settlement.updateVisibility()
    settlementCostMs += performance.now() - settlementUiStartMs

    const damageStatsStartMs = performance.now()
    damageStats.tick(battlePresentationMs, engine)
    const damageStatsCostMs = performance.now() - damageStatsStartMs

    if (backBtn) {
      backBtn.x = getDebugCfg('battleBackBtnX')
      backBtn.y = getDebugCfg('battleBackBtnY')
      backBtn.visible = false
    }

    if (continueBtn) {
      const towerMode = isTowerDefenseBattle()
      const canContinue = engine.isFinished()
        && settlement.isResolved()
        && !settlement.isGameOver()
        && !settlement.isFinalVictory()
        && !towerWaveAdvanceInProgress
        && transition.battleExitTransitionDurationMs <= 0
      const towerStats = towerMode ? engine.getTowerEnemyStats?.() : null
      const bossWave = towerMode && towerStats?.currentWaveHasBoss === true
      const waveElapsedMs = Math.max(0, battlePresentationMs - towerWaveStartAtMs)
      const reachedPostSpawnLimit = towerMode
        && !bossWave
        && !towerWaveTriggerConsumed
        && waveElapsedMs >= getTowerForceNextWaveAfterLastSpawnMs()
      const autoByClear = canContinue && !towerWaveTriggerConsumed
      if (towerMode && (autoByClear || reachedPostSpawnLimit)) {
        towerWaveTriggerConsumed = true
      }
      const shouldAutoAdvanceWave = towerMode
        && !settlement.isGameOver()
        && !settlement.isFinalVictory()
        && !towerWaveAdvanceInProgress
        && transition.battleExitTransitionDurationMs <= 0
        && towerWaveTriggerConsumed
      continueBtn.x = CANVAS_W / 2
      continueBtn.y = 92 + topSafeYOffset + 50
      continueBtn.visible = towerMode ? false : canContinue
      if (towerMode && shouldAutoAdvanceWave) {
        if (towerForceAutoStartOnEnter) towerForceAutoStartOnEnter = false
        void startNextTowerWaveInPlace({ showNewEnemyToast: true })
      } else if (towerMode && canContinue) {
        towerNextWaveAutoStartAtMs = null
        towerForceAutoStartOnEnter = false
        if (continueBtnText) continueBtnText.text = '开始下一波'
      } else {
        towerNextWaveAutoStartAtMs = null
        towerForceAutoStartOnEnter = false
        if (continueBtnText) continueBtnText.text = '开始挑战'
      }
    }

    if (restartBtn) {
      restartBtn.x = getTowerTopLeftActionBtnX()
      restartBtn.y = getTowerTopLeftActionBtnY(3)
      restartBtn.visible = isTowerDefenseBattle() && !replayMode && !towerWaveAdvanceInProgress && transition.battleExitTransitionDurationMs <= 0 && topLeftButtonsExpanded
    }

    if (towerDayText) {
      towerDayText.visible = isTowerDefenseBattle()
      if (towerDayText.visible) {
        const day = Math.max(1, Math.round(battleDay))
        const finalDay = getTowerFinalDay()
        towerDayText.text = `第${day}/${finalDay}天`
        towerDayText.x = CANVAS_W - 16
        towerDayText.y = 102 + topSafeYOffset
        if (towerDayTextBg) {
          const padX = 14
          const padY = 8
          towerDayTextBg.clear()
          towerDayTextBg.roundRect(
            towerDayText.x - towerDayText.width - padX,
            towerDayText.y - padY,
            towerDayText.width + padX * 2,
            towerDayText.height + padY * 2,
            12,
          )
          towerDayTextBg.fill({ color: 0x000000, alpha: 0.45 })
          towerDayTextBg.visible = true
        }
      }
      else if (towerDayTextBg) {
        towerDayTextBg.clear()
        towerDayTextBg.visible = false
      }
    }

    const canEditInBattle = isTowerDefenseBattle() && !replayMode && !towerWaveAdvanceInProgress && transition.battleExitTransitionDurationMs <= 0 && !settlement.isGameOver() && !towerSkillDraftOverlay
    if (buyBtn) {
      buyBtn.x = CANVAS_W / 2
      buyBtn.y = getTowerBattleBuyButtonY()
      buyBtn.visible = canEditInBattle
      const buyCost = getTowerBattleBuyCost()
      const canAfford = editableGold >= buyCost
      if (buyBtnLastCanAfford === null) {
        buyBtnLastCanAfford = canAfford
      } else if (!buyBtnLastCanAfford && canAfford && canEditInBattle) {
        buyBtnAffordPulseStartAtMs = battlePresentationMs
      }
      buyBtnLastCanAfford = canAfford
      if (!canAfford) buyBtnAffordPulseStartAtMs = null
      if (buyBtnAffordVisualState !== canAfford) {
        redrawTowerBattleBuyButtonVisual(canAfford)
        buyBtnAffordVisualState = canAfford
      }
      if (canEditInBattle) tickTowerBattleBuyAffordPulse()
      else if (buyBtnPulseFrame) buyBtnPulseFrame.visible = false
      buyBtn.alpha = canAfford ? 1 : 0.55
      buyBtn.cursor = canAfford ? 'pointer' : 'default'
      if (buyBtnText) buyBtnText.text = formatTowerBattleBuyButtonText(editableGold, buyCost, getTowerBattleBuyOfferLevel())
    }
    if (skillBuyBtn) {
      const unlockCount = getTowerBattleSkillBuyUnlockItemCount()
      const skillCost = getTowerBattleSkillBuyCost()
      const unlocked = towerBattleBuyCount >= unlockCount
      const canAfford = unlocked && editableGold >= skillCost
      skillBuyBtn.x = CANVAS_W / 2 + (TOWER_BOTTOM_ACTION_BTN_W + TOWER_BOTTOM_ACTION_BTN_GAP)
      skillBuyBtn.y = getTowerBattleBuyButtonY()
      skillBuyBtn.visible = canEditInBattle
      if (skillBuyBtnLastCanAfford === null) {
        skillBuyBtnLastCanAfford = canAfford
      } else if (!skillBuyBtnLastCanAfford && canAfford && canEditInBattle) {
        skillBuyBtnAffordPulseStartAtMs = battlePresentationMs
      }
      skillBuyBtnLastCanAfford = canAfford
      if (!canAfford) skillBuyBtnAffordPulseStartAtMs = null
      skillBuyBtn.alpha = canAfford ? 1 : 0.6
      skillBuyBtn.cursor = canAfford ? 'pointer' : 'default'
      if (skillBuyBtnText) {
        skillBuyBtnText.text = formatTowerBattleSkillBuyButtonText(editableGold, skillCost, unlockCount)
      }
      redrawTowerBattleSkillBuyButtonVisual(canAfford, unlocked)
      if (canEditInBattle) tickTowerBattleSkillBuyAffordPulse()
      else if (skillBuyBtnPulseFrame) skillBuyBtnPulseFrame.visible = false
    }
    if (towerSkillDisplayCon) {
      const topRightX = CANVAS_W - 54
      const remainBottomY = (towerRemainBarText?.y ?? (157 + topSafeYOffset))
        + (towerRemainBarText?.height ?? 34)
      towerSkillDisplayCon.x = topRightX
      towerSkillDisplayCon.y = remainBottomY + 66
      towerSkillDisplayCon.visible = isTowerDefenseBattle()
      if (towerSkillDisplayCon.visible) refreshTowerBattleSkillDisplay()
    }
    if (sellDropZone) {
      sellDropZone.visible = false
    }
    editableDrag?.setEnabled(canEditInBattle)
    if (editableMergeHoverTargetId && editableSystem && playerZone) {
      const hoverItem = editableSystem.getItem(editableMergeHoverTargetId)
      if (hoverItem) {
        playerZone.highlightCells(hoverItem.col, hoverItem.row, hoverItem.size, true, getShopUiColor('gold'))
      }
    }

    if (engine.isFinished() && !settlement.isResolved() && damageStats.isVisible()) {
      damageStats.setVisible(false)
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

    if (skillUI?.isDetailPopupVisible()) {
      const detailId = skillUI.getDetailSkillId()
      const active = skillUI.getPickedSkills().find((s) => s.id === detailId)
        ?? skillUI.getEnemySkills().find((s) => s.id === detailId)
      if (!active) skillUI.hideDetailPopup()
    }

    const frameUpdateCostMs = performance.now() - framePerfStartMs
    const mainResidualCostMs = frameUpdateCostMs
      - engineUpdateCostMs
      - runtimeBuildCostMs
      - queueConsumeCostMs
      - overlayCostMs
      - statusFxCostMs
      - layoutCostMs
      - syncRemovedCostMs
      - badgesCostMs
      - heroBarsCostMs
      - portraitCostMs
      - settlementCostMs
      - damageStatsCostMs
      - fxTickCostMs
    recordBattleRuntimePerfFrame(
      dtMs,
      frameUpdateCostMs,
      engineUpdateCostMs,
      runtimeBuildCostMs,
      queueConsumeCostMs,
      overlayCostMs,
      statusFxCostMs,
      layoutCostMs,
      syncRemovedCostMs,
      badgesCostMs,
      heroBarsCostMs,
      portraitCostMs,
      settlementCostMs,
      damageStatsCostMs,
      mainResidualCostMs,
      fxTickCostMs,
      tickDelta,
      queuePendingRatio,
      runtimeCallsDelta,
      runtimeCacheHitsDelta,
    )
  },
}
