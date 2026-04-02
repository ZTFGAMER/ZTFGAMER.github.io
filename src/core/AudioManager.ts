import { getAudioConfig, type AudioBusName, type AudioCueConfig } from '@/core/AudioConfig'
import { resolveTowerWeaponClass, type TowerWeaponClass } from '@/core/TowerWeaponAudioProfile'

type SceneLike = string

type EventBusLike = {
  on(event: string, cb: (payload: Record<string, unknown>) => void): () => void
}

type AudioBusNodes = {
  master: GainNode
  bgm: GainNode
  sfx: GainNode
  ui: GainNode
}

let context: AudioContext | null = null
let buses: AudioBusNodes | null = null
let initialized = false
let enabled = true
const unsubs: Array<() => void> = []
const lastPlayAtByCue = new Map<string, number>()
const towerSourceWeaponClass = new Map<string, { weaponClass: TowerWeaponClass; expiresAtMs: number }>()
const sampleBufferByUrl = new Map<string, AudioBuffer>()
const sampleLoadingByUrl = new Map<string, Promise<void>>()
let bgmSource: AudioBufferSourceNode | null = null
let bgmGainNode: GainNode | null = null

function readStorageNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const n = Number(raw)
    if (!Number.isFinite(n)) return fallback
    return Math.max(0, Math.min(1, n))
  } catch {
    return fallback
  }
}

function readStorageEnabled(key: string): boolean {
  try {
    return localStorage.getItem(key) !== '0'
  } catch {
    return true
  }
}

function ensureContext(): AudioContext | null {
  if (context) return context
  const Ctor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  context = new Ctor()
  return context
}

function ensureGraph(): AudioBusNodes | null {
  if (buses) return buses
  const ctx = ensureContext()
  if (!ctx) return null

  const master = ctx.createGain()
  const bgm = ctx.createGain()
  const sfx = ctx.createGain()
  const ui = ctx.createGain()

  bgm.connect(master)
  sfx.connect(master)
  ui.connect(master)
  master.connect(ctx.destination)

  buses = { master, bgm, sfx, ui }
  return buses
}

function applyVolumesFromConfig(): void {
  const cfg = getAudioConfig()
  const graph = ensureGraph()
  if (!graph) return

  const masterVolume = readStorageNumber(cfg.storageKeys.masterVolume, cfg.buses.master.defaultVolume)
  const bgmVolume = readStorageNumber(cfg.storageKeys.bgmVolume, cfg.buses.bgm.defaultVolume)
  const sfxVolume = readStorageNumber(cfg.storageKeys.sfxVolume, cfg.buses.sfx.defaultVolume)
  const uiVolume = readStorageNumber(cfg.storageKeys.uiVolume, cfg.buses.ui.defaultVolume)

  graph.master.gain.value = enabled ? masterVolume : 0
  graph.bgm.gain.value = bgmVolume
  graph.sfx.gain.value = sfxVolume
  graph.ui.gain.value = uiVolume
}

function shouldPlayCue(cueName: string, cue: AudioCueConfig): boolean {
  const now = performance.now()
  const lastAt = lastPlayAtByCue.get(cueName) ?? -Infinity
  if (now - lastAt < cue.minIntervalMs) return false
  lastPlayAtByCue.set(cueName, now)
  return true
}

function pickCue(name: string): AudioCueConfig | null {
  const cue = getAudioConfig().cues[name]
  return cue ?? null
}

function loadSampleBuffer(url: string): void {
  if (!url || sampleBufferByUrl.has(url) || sampleLoadingByUrl.has(url)) return
  const ctx = ensureContext()
  if (!ctx) return
  const p = fetch(url)
    .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`audio fetch failed: ${res.status}`))))
    .then((ab) => ctx.decodeAudioData(ab))
    .then((buffer) => {
      sampleBufferByUrl.set(url, buffer)
      if (url === getAudioConfig().music.url) startBgmIfReady()
    })
    .catch(() => {
      // ignore and fallback oscillator
    })
    .finally(() => {
      sampleLoadingByUrl.delete(url)
    })
  sampleLoadingByUrl.set(url, p)
}

function playCueSample(cue: AudioCueConfig, busNode: GainNode, ctx: AudioContext): boolean {
  const url = cue.sampleUrl
  if (!url) return false
  const buffer = sampleBufferByUrl.get(url)
  if (!buffer) {
    loadSampleBuffer(url)
    return false
  }
  const src = ctx.createBufferSource()
  const gain = ctx.createGain()
  src.buffer = buffer
  if (cue.detuneCents > 0) {
    src.detune.value = (Math.random() * 2 - 1) * cue.detuneCents
  }
  gain.gain.value = cue.gain
  src.connect(gain)
  gain.connect(busNode)
  src.start()
  return true
}

function playCue(name: string): void {
  if (!enabled) return
  const cue = pickCue(name)
  if (!cue || !shouldPlayCue(name, cue)) return
  if (getAudioConfig().muteSfx && cue.bus !== 'bgm') return
  const graph = ensureGraph()
  const ctx = ensureContext()
  if (!graph || !ctx) return
  if (ctx.state !== 'running') return

  const busNode = graph[cue.bus as Exclude<AudioBusName, 'master'>]
  if (playCueSample(cue, busNode, ctx)) return
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  const startAt = ctx.currentTime
  const attack = cue.attackMs / 1000
  const duration = cue.durationMs / 1000
  const release = cue.releaseMs / 1000
  const peakAt = startAt + attack
  const releaseAt = startAt + duration
  const stopAt = releaseAt + release

  osc.type = cue.wave
  osc.frequency.setValueAtTime(cue.frequency, startAt)

  env.gain.cancelScheduledValues(startAt)
  env.gain.setValueAtTime(0, startAt)
  env.gain.linearRampToValueAtTime(cue.gain, peakAt)
  env.gain.setValueAtTime(cue.gain, releaseAt)
  env.gain.linearRampToValueAtTime(0.0001, stopAt)

  osc.connect(env)
  env.connect(busNode)
  osc.start(startAt)
  osc.stop(stopAt)
}

function stopBgm(): void {
  if (bgmSource) {
    try {
      bgmSource.stop()
    } catch {
      // ignore
    }
  }
  bgmSource = null
  if (bgmGainNode) {
    try {
      bgmGainNode.disconnect()
    } catch {
      // ignore
    }
  }
  bgmGainNode = null
}

function startBgmIfReady(): void {
  const cfg = getAudioConfig()
  if (!enabled) return
  if (!cfg.music.url) return
  if (bgmSource) return
  const graph = ensureGraph()
  const ctx = ensureContext()
  if (!graph || !ctx) return
  if (ctx.state !== 'running') return

  const buffer = sampleBufferByUrl.get(cfg.music.url)
  if (!buffer) {
    loadSampleBuffer(cfg.music.url)
    return
  }

  const outBus = graph[cfg.music.bus]
  const source = ctx.createBufferSource()
  const gain = ctx.createGain()
  source.buffer = buffer
  source.loop = cfg.music.loop
  gain.gain.value = cfg.music.gain
  source.connect(gain)
  gain.connect(outBus)
  source.start(0)
  bgmSource = source
  bgmGainNode = gain
}

function sceneCueName(scene: SceneLike): string | null {
  if (scene.includes('shop')) return 'scene_shop'
  if (scene.includes('battle')) return 'scene_battle'
  return null
}

function getTowerSourceWeaponClass(sourceItemId: string): TowerWeaponClass | null {
  const now = performance.now()
  const one = towerSourceWeaponClass.get(sourceItemId)
  if (!one) return null
  if (one.expiresAtMs < now) {
    towerSourceWeaponClass.delete(sourceItemId)
    return null
  }
  return one.weaponClass
}

function trackTowerWeaponSource(sourceItemId: string, itemId: string): TowerWeaponClass | null {
  const weaponClass = resolveTowerWeaponClass(itemId)
  if (!weaponClass) return null
  towerSourceWeaponClass.set(sourceItemId, {
    weaponClass,
    expiresAtMs: performance.now() + 3000,
  })
  return weaponClass
}

function towerAttackCueName(weaponClass: TowerWeaponClass): string {
  if (weaponClass === 'ninja') return 'tower_ninja_attack'
  if (weaponClass === 'archer') return 'tower_archer_attack'
  if (weaponClass === 'mage') return 'tower_mage_attack'
  return 'tower_warrior_attack'
}

function towerHitCueName(weaponClass: TowerWeaponClass): string {
  if (weaponClass === 'ninja') return 'tower_ninja_hit'
  if (weaponClass === 'archer') return 'tower_archer_hit'
  if (weaponClass === 'mage') return 'tower_mage_hit'
  return 'tower_warrior_hit'
}

function bindBus(bus: EventBusLike): void {
  unsubs.push(bus.on('battle:item_fire', (payload) => {
    if (payload.side !== 'player') return
    const sourceItemId = typeof payload.sourceItemId === 'string' ? payload.sourceItemId : ''
    const itemId = typeof payload.itemId === 'string' ? payload.itemId : ''
    if (!sourceItemId || !itemId) return
    const weaponClass = trackTowerWeaponSource(sourceItemId, itemId)
    if (!weaponClass) return
    playCue(towerAttackCueName(weaponClass))
  }))
  unsubs.push(bus.on('shop:item_bought', () => playCue('shop_buy')))
  unsubs.push(bus.on('shop:item_sold', () => playCue('shop_sell')))
  unsubs.push(bus.on('shop:refresh', () => playCue('shop_refresh')))
  unsubs.push(bus.on('battle:take_damage', (payload) => {
    const sourceSide = String(payload.sourceSide ?? '')
    const targetSide = String(payload.targetSide ?? '')
    const sourceItemId = typeof payload.sourceItemId === 'string' ? payload.sourceItemId : ''
    if (sourceSide === 'player' && targetSide === 'enemy' && sourceItemId) {
      const weaponClass = getTowerSourceWeaponClass(sourceItemId)
      if (weaponClass) {
        playCue(towerHitCueName(weaponClass))
        return
      }
    }
    playCue(payload.isCrit === true ? 'battle_crit' : 'battle_hit')
  }))
  unsubs.push(bus.on('battle:heal', () => playCue('battle_heal')))
  unsubs.push(bus.on('battle:gain_shield', () => playCue('battle_shield')))
  unsubs.push(bus.on('battle:unit_die', () => playCue('battle_unit_die')))
  unsubs.push(bus.on('battle:end', (payload) => {
    playCue(payload.winner === 'player' ? 'battle_win' : 'battle_lose')
  }))
  unsubs.push(bus.on('game:scene_change', (payload) => {
    const cueName = sceneCueName(String(payload.to ?? ''))
    if (cueName) playCue(cueName)
  }))
}

export function initAudioManager(eventBuses: EventBusLike[]): void {
  if (initialized) return
  initialized = true

  const cfg = getAudioConfig()
  enabled = readStorageEnabled(cfg.storageKeys.enabled)
  ensureGraph()
  applyVolumesFromConfig()
  if (cfg.music.url) loadSampleBuffer(cfg.music.url)
  for (const one of Object.values(cfg.cues)) {
    if (one.sampleUrl) loadSampleBuffer(one.sampleUrl)
  }

  eventBuses.forEach((bus) => bindBus(bus))

  document.addEventListener('visibilitychange', () => {
    const ctx = ensureContext()
    if (!ctx) return
    if (document.visibilityState === 'hidden' && ctx.state === 'running') {
      void ctx.suspend()
      return
    }
    if (document.visibilityState === 'visible' && enabled && ctx.state === 'suspended') {
      void ctx.resume()
    }
  })
}

export function unlockAudioFromGesture(): void {
  const ctx = ensureContext()
  if (!ctx || !enabled) return
  if (ctx.state === 'suspended') {
    void ctx.resume().then(() => {
      startBgmIfReady()
    })
    return
  }
  startBgmIfReady()
}

export function audioUiClick(): void {
  playCue('ui_click')
}

export function setAudioEnabled(nextEnabled: boolean): void {
  const cfg = getAudioConfig()
  enabled = !!nextEnabled
  try {
    localStorage.setItem(cfg.storageKeys.enabled, enabled ? '1' : '0')
  } catch {
    // ignore
  }
  applyVolumesFromConfig()
  if (!enabled) stopBgm()
  if (enabled) startBgmIfReady()
}

export function disposeAudioManager(): void {
  stopBgm()
  unsubs.splice(0).forEach((off) => {
    try {
      off()
    } catch {
      // ignore
    }
  })
}
