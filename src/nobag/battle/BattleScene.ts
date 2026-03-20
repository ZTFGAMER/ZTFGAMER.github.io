import type { Scene } from '@/nobag/core/NobagSceneManager'
import { PvpContext } from '@/nobag/pvp/NobagPvpContext'
import { clearBattleSnapshot, getBattleSnapshot } from './BattleSnapshotStore'
import { clearBattleOutcome } from './BattleOutcomeStore'
import { consumeRequestedBattleReplay, hasBattleReplayRecord, requestBattleReplay, saveBattleReplayRecord } from './BattleReplayStore'
import { CombatEngine, setCombatRuntimeOverride, type CombatBoardItem } from './CombatEngine'
import { SceneManager } from '@/nobag/core/NobagSceneManager'
import { getApp, getRenderRuntimeFlags } from '@/nobag/core/NobagAppContext'
import {
  clearCurrentRunState,
  resetLifeState,
  resetWinTrophyState,
  SHOP_STATE_STORAGE_KEY,
} from '@/nobag/core/NobagRunState'
import { Assets, Container, Graphics, Sprite, Texture, Text } from 'pixi.js'
import { GridZone, CELL_SIZE, CELL_HEIGHT } from '@/nobag/common/grid/GridZone'
import { getAllItems, getConfig as getGameCfg } from '@/nobag/core/NobagDataLoader'
import { getConfig as getDebugCfg } from '@/nobag/config/debugConfig'
import type { ItemSizeNorm } from '@/nobag/common/items/ItemDef'
import { EventBus } from '@/nobag/core/NobagEventBus'
import { SellPopup, type ItemInfoEnchantmentDisplay, type ItemInfoMode, type ItemInfoRuntimeOverride } from '@/nobag/common/ui/SellPopup'
import { getItemEnchantmentDisplay, resolveItemEnchantmentEffectCn } from '@/nobag/common/items/ItemEnchantment'
import { getBattleEffectColor, getBattleFloatTextColor, getBattleOrbColor } from '@/nobag/config/colorPalette'
import { getHeroImageUrl, getItemIconUrl } from '@/nobag/core/NobagAssetPath'
import { BattlePortraitFX } from './BattlePortraitFX'
import { BattleSkillUI } from './BattleSkillUI'
import { BattleDamageStats } from './BattleDamageStats'
import { BattleFXPool, type BattleFxPerfStats } from './BattleFXPool'
import { BattleTransition } from './BattleTransition'
import { BattleSettlement } from './BattleSettlement'
import { CANVAS_W, CANVAS_H } from '@/nobag/config/layoutConstants'
import { getAdjustedBattleZoneY, getAdjustedBattleZoneYInBattleOffset } from '@/nobag/shop/ShopMathHelpers'
import { getTopLeftControlYOffset } from '@/nobag/shop/ui/ShopSafeArea'
import { clearLoadedAssetUrls, getLoadedAssetUrls, hasAssetUrlLoaded, markAssetUrlUnloaded } from '@/nobag/core/NobagAssetRuntimeTracker'
import { clearMobileImageDownscaleRuntimeCache } from '@/nobag/core/NobagMobileImageDownscaleCache'

const HERO_VISUAL_IDS = ['hero1', 'hero2', 'hero3', 'hero4', 'hero5', 'hero6', 'hero7', 'hero8', 'hero9', 'hero10'] as const
type HeroVisualId = typeof HERO_VISUAL_IDS[number]

const IS_MOBILE_DEVICE = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)

function randomHeroVisualId(): HeroVisualId {
  return HERO_VISUAL_IDS[Math.floor(nextBattleRandom('hero_visual_pick') * HERO_VISUAL_IDS.length)]!
}

function readPlayerHeroVisualId(): HeroVisualId {
  try {
    const raw = localStorage.getItem(SHOP_STATE_STORAGE_KEY)
    if (!raw) return randomHeroVisualId()
    const parsed = JSON.parse(raw) as { state?: { starterClass?: unknown } } | null
    const key = String(parsed?.state?.starterClass ?? '')
    if ((HERO_VISUAL_IDS as readonly string[]).includes(key)) return key as HeroVisualId
    return randomHeroVisualId()
  } catch {
    return randomHeroVisualId()
  }
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
let titleText: Text | null = null
let backBtn: Container | null = null
let speedBtn: Container | null = null
let speedBtnText: Text | null = null
let battleEndMask: Graphics | null = null
let statsBtn: Container | null = null
let heroHudG: Graphics | null = null
let enemyHpInfoCon: Container | null = null
let playerHpInfoCon: Container | null = null
let enemyZone: GridZone | null = null
let playerZone: GridZone | null = null
let enemyCdOverlay: Graphics | null = null
let playerCdOverlay: Graphics | null = null
let engine: CombatEngine | null = null
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
const BATTLE_SPEED_STEPS = [1, 2, 4, 8] as const
const TOP_ACTION_BTN_H = 58
const TOP_ACTION_BTN_HALF_H = TOP_ACTION_BTN_H / 2
const TOP_ACTION_BTN_SAFE_PAD = 8
const fxPool = new BattleFXPool()

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
const runtimeByIdScratch = new Map<string, ReturnType<CombatEngine['getRuntimeState']>[number]>()
const playerItemsScratch: CombatBoardItem[] = []
const enemyItemsScratch: CombatBoardItem[] = []
const playerAliveIdsScratch = new Set<string>()
const enemyAliveIdsScratch = new Set<string>()
let monitorSampleElapsedMs = 0
let monitorHighStreak = 0
let monitorRecoverStreak = 0
let autoFxDegradeLevel = 0
let fpsHudText: Text | null = null
let fpsSampleElapsedMs = 0
let fpsSampleFrames = 0
let fpsShown = 0
let topSafeYOffset = 0
let appliedActiveCols = -1

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
    transition.beginExit(engine, enteredSnapshot, backBtn, speedBtn)
  })
  return con
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

function applyZoneVisualStyle(zone: GridZone, side: 'player' | 'enemy'): void {
  zone.setItemQualityMarkerEnabled(false)
  zone.setTierBadgeVisible(false)
  zone.setItemFrameUseArchetypeColor(getDebugCfg('gameplayItemFrameColorByArchetype') >= 0.5)
  zone.setTierBorderWidth(getDebugCfg('tierBorderWidth'))
  zone.setCornerRadius(getDebugCfg('gridItemCornerRadius'))
  zone.setCellBorderWidth(getDebugCfg('gridCellBorderWidth'))
  zone.setLabelVisible(false)
  zone.setStatBadgeFontSize(getDebugCfg('itemStatBadgeFontSize'))
  zone.setTierStarFontSize(getDebugCfg('itemTierStarFontSize'))
  zone.setTierStarStrokeWidth(getDebugCfg('itemTierStarStrokeWidth'))
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
    const scale = zone.getNode(it.id)?.visual.scale.x ?? 1
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
  runtimeById: Map<string, ReturnType<CombatEngine['getRuntimeState']>[number]>,
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
    playerZone.y = getAdjustedBattleZoneY(battleDay) + getAdjustedBattleZoneYInBattleOffset(battleDay) + (CELL_HEIGHT * (1 - playerScale)) / 2
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

function clearBattleItemSelection(): void {
  selectedItemId = null
  selectedItemSide = null
  selectedItemInfoKey = null
  selectedItemInfoMode = getDefaultItemInfoMode()
  enemyZone?.setSelected(null)
  playerZone?.setSelected(null)
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
      ammoCurrent: Math.max(0, runtimeState.ammoCurrent),
      ammoMax: Math.max(0, runtimeState.ammoMax),
    }
    : undefined
  const nextKey = `${side}:${instanceId}:${hit.tier}:${runtimeOverride?.cooldownMs ?? -1}:${runtimeOverride?.damage ?? -1}:${runtimeOverride?.shield ?? -1}:${runtimeOverride?.heal ?? -1}:${runtimeOverride?.multicast ?? -1}:${runtimeOverride?.ammoCurrent ?? -1}:${runtimeOverride?.ammoMax ?? -1}`
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
  const enchantmentDisplay: ItemInfoEnchantmentDisplay | undefined = hit.enchantment
    ? {
      ...getItemEnchantmentDisplay(hit.enchantment),
      effectCn: resolveItemEnchantmentEffectCn(item, hit.enchantment),
    }
    : undefined
  itemInfoPopup.show(item, 0, 'none', hit.tier, undefined, selectedItemInfoMode, runtimeOverride, undefined, enchantmentDisplay)
}

export const BattleScene: Scene = {
  name: 'nobag-battle',
  async onEnter() {
    const { stage } = getApp()
    const requestedReplay = consumeRequestedBattleReplay()
    replayMode = requestedReplay != null
    replayRandomSourceValues = requestedReplay ? [...requestedReplay.randomValues] : null
    resetBattleRandomSession()
    const snapshot = getBattleSnapshot()
    if (!snapshot) {
      console.warn('[BattleScene] 缺少战斗快照，回退商店并尝试恢复进度')
      SceneManager.goto('nobag-shop')
      return
    }
    enteredSnapshot = snapshot
    battleEnemyHeroVisualId = null
    battleReplaySaved = false
    const cleanupCfg = getGameCfg().runRules?.battleCacheCleanup
    await purgeMobileBattleAssetCacheIfEnabled()
    if (cleanupCfg?.enabled && cleanupCfg?.forceTextureGcOnBattleEnter) runRendererTextureGcNow()
    battleDay = Math.max(1, snapshot.day)
    settlementRevealAtMs = null
    battlePresentationMs = 0
    chargeUiElapsedSinceTickMs = 0
    ammoReloadUiElapsedSinceTickMs = 0
    fxPool.sourceNextDamageVisualAtMs.clear()
    fxPool.setRandomProvider(() => nextBattleRandom('fx_random'))
    battleSpeed = 1
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

    portraitFX.enemyBossSprite = new Sprite(Texture.WHITE)
    portraitFX.enemyBossSprite.anchor.set(0.5, 1)
    portraitFX.enemyBossSprite.zIndex = 8
    portraitFX.enemyBossSprite.eventMode = 'none'
    portraitFX.enemyBossSprite.visible = true
    root.addChild(portraitFX.enemyBossSprite)

    portraitFX.enemyBossFlashSprite = new Sprite(Texture.WHITE)
    portraitFX.enemyBossFlashSprite.anchor.set(0.5, 1)
    portraitFX.enemyBossFlashSprite.zIndex = 9
    portraitFX.enemyBossFlashSprite.eventMode = 'none'
    portraitFX.enemyBossFlashSprite.visible = true
    portraitFX.enemyBossFlashSprite.tint = 0xffffff
    portraitFX.enemyBossFlashSprite.blendMode = 'add'
    portraitFX.enemyBossFlashSprite.alpha = 0
    root.addChild(portraitFX.enemyBossFlashSprite)

    portraitFX.playerHeroSprite = new Sprite(Texture.WHITE)
    portraitFX.playerHeroSprite.anchor.set(0.5, 1)
    portraitFX.playerHeroSprite.zIndex = 6
    portraitFX.playerHeroSprite.eventMode = 'none'
    portraitFX.playerHeroSprite.visible = true
    root.addChild(portraitFX.playerHeroSprite)

    portraitFX.playerHeroFlashSprite = new Sprite(Texture.WHITE)
    portraitFX.playerHeroFlashSprite.anchor.set(0.5, 1)
    portraitFX.playerHeroFlashSprite.zIndex = 7
    portraitFX.playerHeroFlashSprite.eventMode = 'none'
    portraitFX.playerHeroFlashSprite.visible = true
    portraitFX.playerHeroFlashSprite.tint = 0xffffff
    portraitFX.playerHeroFlashSprite.blendMode = 'add'
    portraitFX.playerHeroFlashSprite.alpha = 0
    root.addChild(portraitFX.playerHeroFlashSprite)

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
    enemyPresentationVisible = true

    try {
      // 优先使用快照的 ownerHeroId（PVP 多标签测试时 localStorage 为共享，snapshot 才是本玩家的准确值）
      const snap = getBattleSnapshot()
      const snapshotHeroId = snap?.ownerHeroId
      const playerHeroId = snapshotHeroId && (HERO_VISUAL_IDS as readonly string[]).includes(snapshotHeroId)
        ? snapshotHeroId as HeroVisualId
        : readPlayerHeroVisualId()
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

    enemyZone = new GridZone('敌方战斗区', 6, activeCols, 1)
    playerZone = new GridZone('战斗区', 6, activeCols, 1)
    enemyZone.zIndex = 20
    playerZone.zIndex = 20
    applyZoneVisualStyle(enemyZone, 'enemy')
    applyZoneVisualStyle(playerZone, 'player')
    enemyZone.setRuntimeValueFxEnabled(true)
    playerZone.setRuntimeValueFxEnabled(true)
    applyLayout(activeCols)
    skillUI!.resolveIntroFromSnapshot(snapshot)
    root.addChild(enemyZone)
    root.addChild(playerZone)
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

    const fxLayerContainer = new Container()
    fxLayerContainer.zIndex = 60
    root.addChild(fxLayerContainer)

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

    statsBtn = damageStats.buildButton(root, () => {
      damageStats.setVisible(!damageStats.isVisible())
    })

    backBtn = makeBackButton()
    backBtn.zIndex = 190
    backBtn.visible = false
    root.addChild(backBtn)

    settlement.buildPanel(
      root,
      () => transition.beginExit(engine, enteredSnapshot, backBtn, speedBtn),
      () => {
        clearCurrentRunState()
        resetLifeState()
        resetWinTrophyState(getGameCfg().runRules?.trophyWinsToFinalVictory ?? 10)
        clearBattleSnapshot()
        clearBattleOutcome()
        window.location.reload()
      },
      () => {
        if (!hasBattleReplayRecord()) return
        if (!requestBattleReplay()) return
        SceneManager.goto('nobag-battle')
      },
      () => transition.battleExitTransitionDurationMs > 0,
    )
    const settlementStatsBtnNew = damageStats.buildSettlementButton(() => {
      damageStats.setVisible(!damageStats.isVisible())
    })
    settlement.attachStatsBtn(settlementStatsBtnNew)

    damageStats.buildPanel(root)

    engine = new CombatEngine()
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
    skillUI!.loadFromSnapshot(engine.getEnemySkillIds())
    skillUI!.refreshEnemy(playerZone, enemyZone, true)
    console.log(`[BattleScene] 进入战斗场景 day=${snapshot.day} entities=${snapshot.entities.length} cols=${snapshot.activeColCount}`)

    // PVP sync mode setup
    // sync-a 的同步已在商店阶段完成（所有人 battle_sync_ready 后才 goto('battle')）
    // 进入战斗场景时直接启动引擎
    syncAStarted = true
    fxPool.setContext(fxLayerContainer, playerZone, enemyZone, engine)

    const board = engine.getBoardState()
    damageStats.bootstrapFromBoard(engine)
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
      skillUI?.hideDetailPopup()
    }
    stage.on('pointerdown', onStageTapHidePopup)

    offTriggerEvent = EventBus.on('battle:item_trigger', (e) => {
      fxPool.tryPulseItem(e.sourceItemId, e.side)
      damageStats.addTriggerCount(e.sourceItemId, e.side, Math.max(1, Math.round(e.multicast || e.triggerCount || 1)), engine)
    })

    offFireEvent = EventBus.on('battle:item_fire', (e) => {
      fxPool.tryPulseItem(e.sourceItemId, e.side)
    })
    offItemEffectTriggerEvent = EventBus.on('battle:item_effect_trigger', (e) => {
      damageStats.addTriggerCount(e.sourceItemId, e.side, Math.max(1, Math.round(e.triggerCount || 1)), engine)
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
      if (e.sourceItemId && e.sourceType !== 'system' && !e.sourceItemId.startsWith('status_') && e.sourceItemId !== 'fatigue') {
        damageStats.addDamage(e.sourceItemId, fromSide, e.amount, engine)
      }
      const enemyAttackToPlayer = side === 'player' && fromSide === 'enemy'
      const from = (e.sourceItemId === 'fatigue' || e.sourceItemId.startsWith('status_'))
        ? getHeroBarCenter(fromSide)
        : (fxPool.getItemCenterById(e.sourceItemId, fromSide) ?? getHeroBarCenter(fromSide))
      const to = getHeroBarCenter(side)
      const projectileTarget = side === 'enemy'
        ? (portraitFX.getEnemyHitPoint() ?? to)
        : enemyAttackToPlayer
          ? (portraitFX.getPlayerHitPoint() ?? to)
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
      const floatingTarget = fxPool.offsetFloatingNumberTarget(side, projectileTarget)
      const playDamageVisual = () => {
        if (e.sourceItemId.startsWith('status_') || isFatigueDamage) {
          if (enemyAttackToPlayer) portraitFX.triggerPlayerHit()
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
            fxPool.spawnProjectile(from, projectileTarget, bulletColor, () => {
              if (side === 'enemy') {
                portraitFX.triggerEnemyHit()
              } else if (enemyAttackToPlayer) {
                portraitFX.triggerPlayerHit()
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
      }
      const from = fxPool.getItemCenterById(e.sourceItemId, side) ?? getHeroBarCenter(side)
      const to = getHeroBarCenter(side)
      const projectileTarget = side === 'enemy' ? (portraitFX.getEnemyHitPoint() ?? to) : to
      const shieldColor = getBattleFloatTextColor('shield')
      const shieldOrbColor = getBattleOrbColor('shield')
      const textSize = getDebugCfg('battleTextFontSizeDamage')
      const floatingTarget = fxPool.offsetFloatingNumberTarget(side, projectileTarget)
      const task = {
        amount: Math.max(0, Math.round(e.amount)),
        run: () => {
          fxPool.spawnProjectile(from, projectileTarget, shieldOrbColor, () => {
            if (side === 'enemy') {
              portraitFX.triggerEnemyHit()
            }
            fxPool.spawnFloatingNumber(floatingTarget, `+${task.amount}`, shieldColor, textSize)
          }, e.sourceItemId)
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
            if (targetIsHero && targetSide === 'player') portraitFX.triggerPlayerHit()
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
    titleText = null
    backBtn = null
    speedBtn = null
    speedBtnText = null
    statsBtn = null
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
    battleSpeed = 1
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
    lastHudTickIndex = -1
    damageStats.reset()
    clearBattleRuntimePerfSampleWindow()
    battleRuntimePerfSnapshot = {}
    battleLastTickIndexForPerf = -1
    appliedActiveCols = -1
    replayMode = false
    replayRandomSourceValues = null
    replayRandomCursor = 0
    battleRandomValues = []
    battleRandomTags = []
    battleEnemyHeroVisualId = null
    battleReplaySaved = false
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
    visualFrameSeenTicks.clear()
    visualFrameHasCatchUp = false
    battlePresentationMs += dtMs
    tickAutoFxDegrade(dtMs)
    skillUI?.tickIntro(dtMs, playerZone)
    const introDone = transition.tickIntro(simDt * 1000, root)
    const allowSimUpdate = introDone && syncAStarted
    let engineUpdateCostMs = 0
    if (allowSimUpdate) {
      const t0 = performance.now()
      engine.update(simDt)
      engineUpdateCostMs = performance.now() - t0
    }
    const queueConsumeStartMs = performance.now()
    consumeVisualFxQueue(dtMs)
    const queueConsumeCostMs = performance.now() - queueConsumeStartMs
    const pendingDamageImpactFx = fxPool.hasPendingDamageImpactPresentation()
    enemyPresentationVisible = true
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
    const combatRuntimeCfg = getGameCfg().combatRuntime
    const slowFactor = Math.max(0, Math.min(0.95, combatRuntimeCfg.cardSlowFactor ?? 0.4))
    const hasteFactor = Math.max(0, combatRuntimeCfg.cardHasteFactor ?? 0.4)
    runtimeChargePercentByIdScratch.clear()
    runtimeAmmoReloadMsByIdScratch.clear()
    runtimeByIdScratch.clear()
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
    }
    const runtimeBuildCostMs = performance.now() - runtimeBuildStartMs
    const layoutStartMs = performance.now()
    const activeCols = getDayActiveCols(battleDay)
    if (activeCols !== appliedActiveCols) {
      enemyZone.setActiveColCount(activeCols)
      playerZone.setActiveColCount(activeCols)
      applyZoneVisualStyle(enemyZone, 'enemy')
      applyZoneVisualStyle(playerZone, 'player')
      applyLayout(activeCols)
      appliedActiveCols = activeCols
    }
    const layoutCostMs = performance.now() - layoutStartMs

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
    const badgesCostMs = performance.now() - badgesStartMs
    let heroBarsCostMs = 0
    if (tickChanged) {
      const heroBarsStartMs = performance.now()
      drawHeroBars(board.player, board.enemy)
      heroBarsCostMs = performance.now() - heroBarsStartMs
      lastHudTickIndex = debugState.tickIndex
    }

    const fxTickStartMs = performance.now()
    fxPool.tick(dtMs)
    const fxTickCostMs = performance.now() - fxTickStartMs
    const portraitStartMs = performance.now()
    portraitFX.tickEnemy(dtMs)
    portraitFX.tickPlayer(dtMs)
    const portraitCostMs = performance.now() - portraitStartMs

    const queueStats = engine.getQueuePerfStats()
    const queuePendingRatio = Math.max(
      queueStats.pendingHits / Math.max(1, queueStats.maxPendingHits),
      queueStats.pendingItemFires / Math.max(1, queueStats.maxPendingItemFires),
      queueStats.pendingChargePulses / Math.max(1, queueStats.maxPendingChargePulses),
      queueStats.pendingAmmoRefills / Math.max(1, queueStats.maxPendingAmmoRefills),
    )
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
        if (settlement.isResolved() && !battleReplaySaved && enteredSnapshot && battleEnemyHeroVisualId) {
          saveBattleReplayRecord({
            snapshot: enteredSnapshot,
            enemyHeroId: battleEnemyHeroVisualId,
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
        battleEndMask.visible = settlement.isResolved()
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
      speedBtn.visible = !engine.isFinished()
      speedBtn.y = getClampedTopActionBtnY()
      if (speedBtnText) speedBtnText.text = `x${battleSpeed}`
    }

    if (statsBtn) {
      statsBtn.visible = !engine.isFinished()
      statsBtn.y = getClampedTopActionBtnY()
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
