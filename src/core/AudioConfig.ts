import rawAudioConfig from '../../data/audio_config.json'

export type AudioBusName = 'master' | 'bgm' | 'sfx' | 'ui'
export type AudioWaveType = 'sine' | 'square' | 'sawtooth' | 'triangle'

export type AudioCueConfig = {
  bus: Exclude<AudioBusName, 'master'>
  sampleUrl?: string
  detuneCents: number
  wave: AudioWaveType
  frequency: number
  durationMs: number
  gain: number
  attackMs: number
  releaseMs: number
  minIntervalMs: number
}

export type AudioConfig = {
  version: number
  muteSfx: boolean
  music: {
    url: string
    bus: Exclude<AudioBusName, 'master'>
    gain: number
    loop: boolean
  }
  storageKeys: {
    enabled: string
    masterVolume: string
    bgmVolume: string
    sfxVolume: string
    uiVolume: string
  }
  buses: Record<AudioBusName, { defaultVolume: number }>
  cues: Record<string, AudioCueConfig>
}

type RawAudioConfig = {
  version?: unknown
  mute_sfx?: unknown
  music?: {
    url?: unknown
    bus?: unknown
    gain?: unknown
    loop?: unknown
  }
  storage_keys?: {
    enabled?: unknown
    master_volume?: unknown
    bgm_volume?: unknown
    sfx_volume?: unknown
    ui_volume?: unknown
  }
  buses?: Record<string, { default_volume?: unknown }>
  cues?: Record<string, {
    bus?: unknown
    sample_url?: unknown
    detune_cents?: unknown
    wave?: unknown
    frequency?: unknown
    duration_ms?: unknown
    gain?: unknown
    attack_ms?: unknown
    release_ms?: unknown
    min_interval_ms?: unknown
  }>
}

const VALID_BUSES: AudioBusName[] = ['master', 'bgm', 'sfx', 'ui']
const VALID_CUE_BUSES: Exclude<AudioBusName, 'master'>[] = ['bgm', 'sfx', 'ui']
const VALID_WAVES: AudioWaveType[] = ['sine', 'square', 'sawtooth', 'triangle']

function toFiniteNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function toSafeString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v : fallback
}

function parseAudioConfig(raw: RawAudioConfig): AudioConfig {
  const version = Math.max(1, Math.round(toFiniteNumber(raw.version, 1)))
  const muteSfx = raw.mute_sfx === true
  const storageRaw = raw.storage_keys ?? {}
  const storageKeys = {
    enabled: toSafeString(storageRaw.enabled, 'bb_audio_enabled'),
    masterVolume: toSafeString(storageRaw.master_volume, 'bb_audio_master_volume'),
    bgmVolume: toSafeString(storageRaw.bgm_volume, 'bb_audio_bgm_volume'),
    sfxVolume: toSafeString(storageRaw.sfx_volume, 'bb_audio_sfx_volume'),
    uiVolume: toSafeString(storageRaw.ui_volume, 'bb_audio_ui_volume'),
  }

  const buses = VALID_BUSES.reduce((acc, bus) => {
    const fromJson = raw.buses?.[bus]?.default_volume
    acc[bus] = { defaultVolume: Math.max(0, Math.min(1, toFiniteNumber(fromJson, bus === 'master' ? 1 : 0.8))) }
    return acc
  }, {} as Record<AudioBusName, { defaultVolume: number }>)

  const musicBusRaw = typeof raw.music?.bus === 'string' ? raw.music.bus : 'bgm'
  const musicBus = VALID_CUE_BUSES.includes(musicBusRaw as Exclude<AudioBusName, 'master'>)
    ? (musicBusRaw as Exclude<AudioBusName, 'master'>)
    : 'bgm'
  const music = {
    url: typeof raw.music?.url === 'string' ? raw.music.url.trim() : '',
    bus: musicBus,
    gain: Math.max(0, Math.min(1, toFiniteNumber(raw.music?.gain, 0.7))),
    loop: raw.music?.loop !== false,
  }

  const cues: Record<string, AudioCueConfig> = {}
  for (const [cueName, cueRaw] of Object.entries(raw.cues ?? {})) {
    const busRaw = typeof cueRaw?.bus === 'string' ? cueRaw.bus : 'sfx'
    const bus = VALID_CUE_BUSES.includes(busRaw as Exclude<AudioBusName, 'master'>)
      ? busRaw as Exclude<AudioBusName, 'master'>
      : 'sfx'
    const waveRaw = typeof cueRaw?.wave === 'string' ? cueRaw.wave : 'sine'
    const wave = VALID_WAVES.includes(waveRaw as AudioWaveType) ? (waveRaw as AudioWaveType) : 'sine'
    cues[cueName] = {
      bus,
      sampleUrl: typeof cueRaw?.sample_url === 'string' && cueRaw.sample_url.trim()
        ? cueRaw.sample_url.trim()
        : undefined,
      detuneCents: Math.max(0, Math.min(1200, toFiniteNumber(cueRaw?.detune_cents, 0))),
      wave,
      frequency: Math.max(20, toFiniteNumber(cueRaw?.frequency, 440)),
      durationMs: Math.max(10, toFiniteNumber(cueRaw?.duration_ms, 80)),
      gain: Math.max(0, Math.min(1, toFiniteNumber(cueRaw?.gain, 0.1))),
      attackMs: Math.max(0, toFiniteNumber(cueRaw?.attack_ms, 3)),
      releaseMs: Math.max(0, toFiniteNumber(cueRaw?.release_ms, 50)),
      minIntervalMs: Math.max(0, toFiniteNumber(cueRaw?.min_interval_ms, 50)),
    }
  }

  return { version, muteSfx, music, storageKeys, buses, cues }
}

let cachedConfig: AudioConfig | null = null

export function getAudioConfig(): AudioConfig {
  if (!cachedConfig) cachedConfig = parseAudioConfig(rawAudioConfig as RawAudioConfig)
  return cachedConfig
}
