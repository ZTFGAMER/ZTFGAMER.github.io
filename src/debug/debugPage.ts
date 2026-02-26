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
  'backpackZoneX',
  'backpackZoneY',
  'backpackBtnX',
  'backpackBtnY',
  'sellBtnX',
  'sellBtnY',
  'refreshBtnX',
  'refreshBtnY',
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
  'itemInfoWidth',
  'itemInfoMinH',
  'itemInfoMinHSmall',
]

const LAYOUT_FONT_KEYS = [
  'gridZoneLabelFontSize',
  'shopButtonLabelFontSize',
  'sellButtonSubPriceFontSize',
  'refreshCostFontSize',
  'goldFontSize',
  'dayDebugArrowFontSize',
  'dayDebugLabelFontSize',
  'shopItemNameFontSize',
  'shopItemPriceFontSize',
  'shopItemBoughtFontSize',
  'itemInfoNameFontSize',
  'itemInfoTierFontSize',
  'itemInfoPriceFontSize',
  'itemInfoDescFontSize',
  'synthTitleFontSize',
  'synthNameFontSize',
]

const LAYOUT_KEYS = [...LAYOUT_POSITION_KEYS, ...LAYOUT_FONT_KEYS]
const DRAG_KEYS = Object.keys(CONFIG_DEFS).filter((key) => !LAYOUT_KEYS.includes(key))

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
  btnDownload?.addEventListener('click', () => {
    downloadSnapshotFile()
    const badge = document.getElementById('sync-badge')!
    badge.textContent = '💾 已下载 debug_defaults.json'
    badge.style.opacity = '1'
    setTimeout(() => { badge.style.opacity = '0' }, 2200)
  })

  const badge = document.getElementById('sync-badge')!
  badge.textContent = '🔗 已连接'
  setTimeout(() => { badge.style.opacity = '0' }, 2500)
})
