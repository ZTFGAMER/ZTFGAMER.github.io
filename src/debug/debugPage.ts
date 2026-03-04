// ============================================================
// debugPage.ts — 调试配置页逻辑（紧凑版）
// 每个参数一行：标签 | 滑块 | 当前值 | 单位 | 数字输入 | 重置
// ============================================================

import { getConfig, setConfig, resetConfig, CONFIG_DEFS, onConfigChange, getConfigSnapshot } from '@/config/debugConfig'

const LAYOUT_POSITION_KEYS = [
  'shopAreaX',
  'shopAreaY',
  'battleZoneX',
  'battleZoneY',
  'battleZoneYInBattleOffset',
  'enemyBattleZoneY',
  'enemyHpBarY',
  'playerHpBarY',
  'battleHpBarH',
  'battleHpBarRadius',
  'battleHpBarWidth',
  'backpackZoneX',
  'backpackZoneY',
  'backpackBtnX',
  'backpackBtnY',
  'sellBtnX',
  'sellBtnY',
  'refreshBtnX',
  'refreshBtnY',
  'phaseBtnX',
  'phaseBtnY',
  'battleBackBtnX',
  'battleBackBtnY',
  'battleSpeedBtnY',
  'battleStatsPanelY',
  'goldTextCenterX',
  'goldTextY',
  'dayDebugX',
  'dayDebugY',
  'tierBorderWidth',
  'gridItemCornerRadius',
  'gridCellBorderWidth',
  'shopAreaBgWidth',
  'shopAreaBgHeight',
  'backpackAreaBgWidth',
  'backpackAreaBgHeight',
  'itemInfoBottomGapToShop',
  'itemStatBadgeOffsetY',
  'itemTierStarOffsetX',
  'itemTierStarOffsetY',
  'itemInfoWidth',
  'itemInfoMinH',
  'itemInfoMinHSmall',
]

const LAYOUT_FONT_KEYS = [
  'gridZoneLabelFontSize',
  'shopButtonLabelFontSize',
  'phaseButtonLabelFontSize',
  'battleBackButtonLabelFontSize',
  'battleHpTextFontSize',
  'battleTextFontSizeDamage',
  'battleTextFontSizeCrit',
  'battleStatusTimerFontSize',
  'sellButtonSubPriceFontSize',
  'refreshCostFontSize',
  'goldFontSize',
  'dayDebugArrowFontSize',
  'dayDebugLabelFontSize',
  'shopItemNameFontSize',
  'shopItemPriceFontSize',
  'shopItemBoughtFontSize',
  'itemStatBadgeFontSize',
  'itemTierStarFontSize',
  'itemTierStarStrokeWidth',
  'itemInfoNameFontSize',
  'itemInfoTierFontSize',
  'itemInfoPriceFontSize',
  'itemInfoPriceCornerFontSize',
  'itemInfoCooldownFontSize',
  'itemInfoDescFontSize',
  'itemInfoSimpleDescFontSize',
  'synthTitleFontSize',
  'synthNameFontSize',
]

const LAYOUT_KEYS = [...LAYOUT_POSITION_KEYS, ...LAYOUT_FONT_KEYS]
const PERSPECTIVE_KEYS = [
  'shopItemScale',
  'battleItemScale',
  'battleItemScaleBackpackOpen',
  'enemyAreaScale',
  'enemyHpBarScale',
]
const TOAST_KEYS = [
  'toastEnabled',
  'toastShowNoGoldBuy',
  'toastShowNoGoldRefresh',
  'toastShowBackpackFullBuy',
  'toastShowBackpackFullTransfer',
  'toastShowFatigueStart',
]
const BATTLE_VFX_KEYS = [
  'battleFirePulseScaleMax',
  'battleFirePulseMs',
  'battleProjectileFlyMs',
  'battleProjectileFlyMsMin',
  'battleProjectileFlyMsMax',
  'battleProjectileItemSizePx',
  'battleProjectileArcHeight',
  'battleProjectileSideArcMax',
  'battleProjectileScaleStart',
  'battleProjectileScalePeak',
  'battleProjectileScaleEnd',
  'battleProjectileScalePeakT',
  'battleProjectileSpinDegPerSec',
  'battleMulticastVisualGapMs',
  'battleStatusTextStrokeWidth',
  'battleStatusBadgePadX',
  'battleStatusBadgePadY',
  'battleStatusBadgeRadius',
  'battleStatusBadgeMinWidth',
  'battleStatusBadgeAlpha',
  'battleStatusHasteYFactor',
  'battleStatusHasteOffsetY',
  'battleStatusSlowYFactor',
  'battleStatusSlowOffsetY',
  'battleStatusFreezeYFactor',
  'battleStatusFreezeOffsetY',
  'battleFreezeOverlayAlpha',
  'battleDamageFloatRandomX',
  'battleDamageFloatRiseMs',
  'battleDamageFloatRiseY',
  'battleDamageFloatHoldMs',
  'battleDamageFloatFadeMs',
  'battleEnemyPortraitWidthRatio',
  'battleEnemyPortraitOffsetY',
  'battleEnemyPortraitHitYFactor',
  'battleEnemyPortraitHitScaleMax',
  'battleEnemyPortraitHitPulseMs',
  'battleEnemyPortraitIdleLoopMs',
  'battleEnemyPortraitIdleScaleMax',
  'battleEnemyPortraitFlashMs',
  'battleEnemyPortraitFlashColor',
  'battleEnemyPortraitFlashAlpha',
  'battleEnemyPortraitDeathFadeMs',
  'battlePlayerPortraitWidthRatio',
  'battlePlayerPortraitOffsetY',
  'battlePlayerPortraitHitYFactor',
  'battlePlayerPortraitHitScaleMax',
  'battlePlayerPortraitHitPulseMs',
  'battlePlayerPortraitIdleLoopMs',
  'battlePlayerPortraitIdleScaleMax',
  'battlePlayerPortraitFlashMs',
  'battlePlayerPortraitFlashColor',
  'battlePlayerPortraitFlashAlpha',
  'shopToBattleTransitionMs',
  'shopToBattleBackpackDropPx',
  'shopToBattleBackpackAlpha',
  'shopToBattleButtonsAlpha',
  'battleIntroFadeInMs',
  'battleToShopTransitionMs',
  'battleSettlementDelayMs',
  'shopPassiveJumpMoveMs',
  'shopPassiveJumpHoldMs',
  'shopPassiveJumpFadeMs',
  'shopPassiveJumpFontSize',
  'crossSynthesisCarouselSpeedPx',
]
const GAMEPLAY_KEYS = [
  'gameplayBurnTickMs',
  'gameplayPoisonTickMs',
  'gameplayRegenTickMs',
  'gameplayFatigueStartMs',
  'gameplayFatigueTickMs',
  'gameplayFatigueBaseValue',
  'gameplayFatigueDoubleEveryMs',
  'gameplayBurnShieldFactor',
  'gameplayBurnDecayPct',
  'gameplayHealCleansePct',
]
const GAMEPLAY_CHECKBOX_KEYS = [
  'gameplayGrantAllClassItems',
  'gameplayShowSpeedButton',
  'gameplayCrossSynthesisConfirm',
]
const ENEMY_DATA_PARAM_KEYS: string[] = [
  'enemyDraftSameArchetypeBias',
]
const ENEMY_DATA_CHECKBOX_KEYS = [
  'enemyDraftEnabled',
]
const COLOR_KEYS = [
  'tierColorBronze',
  'tierColorSilver',
  'tierColorGold',
  'tierColorDiamond',
  'battleColorHp',
  'battleColorHpBar',
  'battleColorHpText',
  'battleColorShield',
  'battleColorBurn',
  'battleColorPoison',
  'battleColorRegen',
  'battleOrbColorHp',
  'battleOrbColorShield',
  'battleOrbColorBurn',
  'battleOrbColorPoison',
  'battleOrbColorRegen',
  'battleOrbColorFreeze',
  'battleOrbColorSlow',
  'battleOrbColorHaste',
  'battleTextColorDamage',
  'battleTextColorCrit',
  'battleTextColorShield',
  'battleTextColorBurn',
  'battleTextColorPoison',
  'battleTextColorRegen',
  'battleEnemyPortraitFlashColor',
]
const DRAG_KEYS = Object.keys(CONFIG_DEFS).filter((key) => !LAYOUT_KEYS.includes(key) && !PERSPECTIVE_KEYS.includes(key) && !TOAST_KEYS.includes(key) && !BATTLE_VFX_KEYS.includes(key) && !GAMEPLAY_KEYS.includes(key) && !GAMEPLAY_CHECKBOX_KEYS.includes(key) && !ENEMY_DATA_PARAM_KEYS.includes(key) && !ENEMY_DATA_CHECKBOX_KEYS.includes(key) && !COLOR_KEYS.includes(key))

function buildSearchText(key: string): string {
  const def = CONFIG_DEFS[key]
  if (!def) return key.toLowerCase()
  return [key, def.labelCn, def.description]
    .map((s) => String(s || '').toLowerCase())
    .join(' ')
}

function applySearchFilter(raw: string): void {
  const query = raw.trim().toLowerCase()
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.param-row'))
  let visibleCount = 0

  for (const row of rows) {
    const text = row.dataset.searchText || ''
    const matched = query.length === 0 || text.includes(query)
    row.style.display = matched ? '' : 'none'
    if (matched) visibleCount += 1
  }

  const sections = Array.from(document.querySelectorAll<HTMLElement>('.section-dropdown'))
  for (const sec of sections) {
    const secRows = Array.from(sec.querySelectorAll<HTMLElement>('.param-row'))
    const hasVisible = secRows.some((r) => r.style.display !== 'none')
    sec.style.display = hasVisible ? '' : 'none'
    if (query.length > 0 && hasVisible) {
      ;(sec as HTMLDetailsElement).open = true
    }
  }

  const count = document.getElementById('debug-search-count')
  if (count) {
    count.textContent = query.length === 0
      ? '全部显示'
      : `命中 ${visibleCount}`
  }
}

function toHexColor(value: number): string {
  const n = Math.max(0, Math.min(0xffffff, Math.round(value)))
  return `#${n.toString(16).padStart(6, '0')}`
}

function parseHexColor(input: string, fallback: number): number {
  const hex = input.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return fallback
  return parseInt(hex, 16)
}

// ---- 渲染参数行 ----

function buildParamRow(key: string, sectionId: string): void {
  const def   = CONFIG_DEFS[key]!
  const value = getConfig(key)

  const section = document.getElementById(sectionId)!
  const row     = document.createElement('div')
  row.className = 'param-row'

  // 标签（带 title 提示描述）
  const label      = document.createElement('span')
  label.className  = 'param-label'
  label.textContent = def.labelCn
  label.title       = `${def.description}  |  范围：${def.min}~${def.max}${def.unit}  |  默认：${def.defaultValue}${def.unit}`

  // 滑块
  const slider         = document.createElement('input')
  slider.type          = 'range'
  slider.className     = 'param-slider'
  slider.id            = `slider-${key}`
  slider.min           = String(def.min)
  slider.max           = String(def.max)
  slider.step          = String(def.step)
  slider.value         = String(value)

  // 当前值 + 单位
  const valEl      = document.createElement('span')
  valEl.className  = 'param-value'
  valEl.id         = `val-${key}`
  valEl.textContent = String(value)

  const unitEl      = document.createElement('span')
  unitEl.className  = 'param-unit'
  unitEl.textContent = def.unit

  // 数字输入
  const num        = document.createElement('input')
  num.type         = 'number'
  num.className    = 'param-num'
  num.min          = String(def.min)
  num.max          = String(def.max)
  num.step         = String(def.step)
  num.value        = String(value)
  num.id           = `num-${key}`

  // 重置按钮
  const resetBtn        = document.createElement('button')
  resetBtn.className    = 'btn-reset'
  resetBtn.textContent  = '↩'
  resetBtn.title        = `重置为默认值 ${def.defaultValue}${def.unit}`

  row.append(label, slider, valEl, unitEl, num, resetBtn)
  section.appendChild(row)
  row.dataset.searchText = buildSearchText(key)

  // ---- 事件 ----

  function applyValue(v: number): void {
    const clamped = Math.max(def.min, Math.min(def.max, v))
    slider.value       = String(clamped)
    num.value          = String(clamped)
    valEl.textContent  = String(clamped)
    setConfig(key, clamped)
    flashSyncBadge()
  }

  slider.addEventListener('input',  () => applyValue(Number(slider.value)))
  num.addEventListener('change',    () => applyValue(Number(num.value)))
  resetBtn.addEventListener('click', () => {
    resetConfig(key)
    applyValue(CONFIG_DEFS[key]!.defaultValue)
  })

  // 存 slider/num/valEl 引用供外部更新
  ;(row as any)._sliderEl = slider
  ;(row as any)._numEl    = num
  ;(row as any)._valEl    = valEl
  ;(row as any)._key      = key
}

function buildCheckboxRow(key: string, sectionId: string): void {
  const def = CONFIG_DEFS[key]!
  const value = getConfig(key)
  const section = document.getElementById(sectionId)!

  const row = document.createElement('div')
  row.className = 'param-row'

  const label = document.createElement('span')
  label.className = 'param-label'
  label.textContent = def.labelCn
  label.title = `${def.description}`

  const toggle = document.createElement('input')
  toggle.type = 'checkbox'
  toggle.id = `chk-${key}`
  toggle.checked = value >= 0.5

  const state = document.createElement('span')
  state.className = 'param-value'
  state.id = `chk-val-${key}`
  state.textContent = toggle.checked ? '开' : '关'

  const unit = document.createElement('span')
  unit.className = 'param-unit'
  unit.textContent = ''

  const spacer = document.createElement('span')
  spacer.style.width = '52px'
  spacer.style.flexShrink = '0'

  const resetBtn = document.createElement('button')
  resetBtn.className = 'btn-reset'
  resetBtn.textContent = '↩'
  resetBtn.title = `重置为默认值 ${def.defaultValue ? '开' : '关'}`

  row.append(label, toggle, state, unit, spacer, resetBtn)
  section.appendChild(row)
  row.dataset.searchText = buildSearchText(key)

  const applyChecked = (checked: boolean): void => {
    toggle.checked = checked
    state.textContent = checked ? '开' : '关'
    setConfig(key, checked ? 1 : 0)
    flashSyncBadge()
  }

  toggle.addEventListener('change', () => applyChecked(toggle.checked))
  resetBtn.addEventListener('click', () => {
    resetConfig(key)
    applyChecked(!!CONFIG_DEFS[key]!.defaultValue)
  })
}

function buildColorRow(key: string, sectionId: string): void {
  const def = CONFIG_DEFS[key]!
  const value = getConfig(key)
  const section = document.getElementById(sectionId)!

  const row = document.createElement('div')
  row.className = 'param-row'

  const label = document.createElement('span')
  label.className = 'param-label'
  label.textContent = def.labelCn
  label.title = `${def.description}  |  默认：${toHexColor(def.defaultValue)}`

  const picker = document.createElement('input')
  picker.type = 'color'
  picker.className = 'param-color'
  picker.id = `color-${key}`
  picker.value = toHexColor(value)

  const valEl = document.createElement('span')
  valEl.className = 'param-value'
  valEl.id = `val-${key}`
  valEl.style.width = '74px'
  valEl.textContent = toHexColor(value)

  const unitEl = document.createElement('span')
  unitEl.className = 'param-unit'
  unitEl.textContent = 'hex'

  const hexInput = document.createElement('input')
  hexInput.type = 'text'
  hexInput.className = 'param-num'
  hexInput.id = `hex-${key}`
  hexInput.value = toHexColor(value)

  const resetBtn = document.createElement('button')
  resetBtn.className = 'btn-reset'
  resetBtn.textContent = '↩'
  resetBtn.title = `重置为默认值 ${toHexColor(def.defaultValue)}`

  row.append(label, picker, valEl, unitEl, hexInput, resetBtn)
  section.appendChild(row)
  row.dataset.searchText = buildSearchText(key)

  const applyColor = (nextValue: number): void => {
    const clamped = Math.max(def.min, Math.min(def.max, Math.round(nextValue)))
    const hex = toHexColor(clamped)
    picker.value = hex
    hexInput.value = hex
    valEl.textContent = hex
    setConfig(key, clamped)
    flashSyncBadge()
  }

  picker.addEventListener('input', () => {
    applyColor(parseHexColor(picker.value, value))
  })

  hexInput.addEventListener('change', () => {
    applyColor(parseHexColor(hexInput.value, getConfig(key)))
  })

  resetBtn.addEventListener('click', () => {
    resetConfig(key)
    applyColor(CONFIG_DEFS[key]!.defaultValue)
  })
}

// ---- 同步徽章 ----

let flashTimeout: ReturnType<typeof setTimeout> | null = null

function flashSyncBadge(): void {
  const badge = document.getElementById('sync-badge')!
  badge.textContent    = '✅ 已同步'
  badge.style.opacity  = '1'
  if (flashTimeout) clearTimeout(flashTimeout)
  flashTimeout = setTimeout(() => { badge.style.opacity = '0' }, 2000)
}

// ---- 外部更新 UI ----

function updateUIFromExternal(key: string, value: number): void {
  const slider = document.getElementById(`slider-${key}`) as HTMLInputElement | null
  const num    = document.getElementById(`num-${key}`) as HTMLInputElement | null
  const valEl  = document.getElementById(`val-${key}`)
  if (slider) slider.value      = String(value)
  if (num)    num.value         = String(value)
  if (valEl)  valEl.textContent = String(value)
  const chk = document.getElementById(`chk-${key}`) as HTMLInputElement | null
  const chkVal = document.getElementById(`chk-val-${key}`)
  if (chk) chk.checked = value >= 0.5
  if (chkVal) chkVal.textContent = value >= 0.5 ? '开' : '关'
  const color = document.getElementById(`color-${key}`) as HTMLInputElement | null
  const hex = document.getElementById(`hex-${key}`) as HTMLInputElement | null
  if (color) color.value = toHexColor(value)
  if (hex) hex.value = toHexColor(value)
}

function buildSnapshotJson(): string {
  return JSON.stringify(getConfigSnapshot(), null, 2)
}

async function copySnapshotToClipboard(): Promise<void> {
  const text = buildSnapshotJson()
  await navigator.clipboard.writeText(text)
}

function downloadSnapshotFile(): void {
  const blob = new Blob([buildSnapshotJson() + '\n'], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'debug_defaults.json'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

async function saveSnapshotToProjectDefaults(): Promise<boolean> {
  try {
    const resp = await fetch('/__debug/save-defaults', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot: getConfigSnapshot() }),
    })
    if (!resp.ok) return false
    const data = await resp.json() as { ok?: boolean }
    return !!data.ok
  } catch {
    return false
  }
}

// ---- 主入口 ----

document.addEventListener('DOMContentLoaded', () => {
  for (const key of LAYOUT_POSITION_KEYS) {
    if (!CONFIG_DEFS[key]) continue
    buildParamRow(key, 'params-position')
  }

  for (const key of LAYOUT_FONT_KEYS) {
    if (!CONFIG_DEFS[key]) continue
    buildParamRow(key, 'params-font')
  }

  for (const key of DRAG_KEYS) {
    if (!CONFIG_DEFS[key]) continue
    buildParamRow(key, 'params-drag')
  }

  for (const key of PERSPECTIVE_KEYS) {
    if (!CONFIG_DEFS[key]) continue
    buildParamRow(key, 'params-perspective')
  }

  for (const key of TOAST_KEYS) {
    if (!CONFIG_DEFS[key]) continue
    buildCheckboxRow(key, 'params-toast')
  }

  for (const key of BATTLE_VFX_KEYS) {
    if (!CONFIG_DEFS[key]) continue
    buildParamRow(key, 'params-battle-vfx')
  }

  for (const key of GAMEPLAY_KEYS) {
    if (!CONFIG_DEFS[key]) continue
    buildParamRow(key, 'params-gameplay')
  }

  for (const key of GAMEPLAY_CHECKBOX_KEYS) {
    if (!CONFIG_DEFS[key]) continue
    buildCheckboxRow(key, 'params-gameplay')
  }

  for (const key of ENEMY_DATA_CHECKBOX_KEYS) {
    if (!CONFIG_DEFS[key]) continue
    buildCheckboxRow(key, 'params-enemy-data')
  }

  for (const key of ENEMY_DATA_PARAM_KEYS) {
    if (!CONFIG_DEFS[key]) continue
    buildParamRow(key, 'params-enemy-data')
  }

  for (const key of COLOR_KEYS) {
    if (!CONFIG_DEFS[key]) continue
    buildColorRow(key, 'params-color')
  }

  onConfigChange((key, value) => {
    updateUIFromExternal(key, value)
  })

  const btnCopy = document.getElementById('btn-copy-config') as HTMLButtonElement | null
  btnCopy?.addEventListener('click', async () => {
    try {
      await copySnapshotToClipboard()
      const badge = document.getElementById('sync-badge')!
      badge.textContent = '📋 已复制配置 JSON'
      badge.style.opacity = '1'
      setTimeout(() => { badge.style.opacity = '0' }, 2000)
    } catch {
      alert('复制失败，请使用“下载默认值”按钮')
    }
  })

  const btnDownload = document.getElementById('btn-download-defaults') as HTMLButtonElement | null
  btnDownload?.addEventListener('click', async () => {
    const badge = document.getElementById('sync-badge')!
    const saved = await saveSnapshotToProjectDefaults()
    if (saved) {
      badge.textContent = '💾 已写入 data/debug_defaults.json'
      badge.style.opacity = '1'
      setTimeout(() => { badge.style.opacity = '0' }, 2200)
      return
    }

    downloadSnapshotFile()
    badge.textContent = '💾 已下载 debug_defaults.json（请手动替换）'
    badge.style.opacity = '1'
    setTimeout(() => { badge.style.opacity = '0' }, 2400)
  })

  const badge = document.getElementById('sync-badge')!
  badge.textContent = '🔗 已连接'
  setTimeout(() => { badge.style.opacity = '0' }, 2500)

  const searchInput = document.getElementById('debug-search') as HTMLInputElement | null
  searchInput?.addEventListener('input', () => {
    applySearchFilter(searchInput.value)
  })
  applySearchFilter(searchInput?.value || '')
})
