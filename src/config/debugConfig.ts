import projectDebugDefaults from '../../data/debug_defaults.json'

// ============================================================
// debugConfig — 可运行时调整的调试参数
// 存储：localStorage（key 前缀 bigbazzar_cfg_）
// 实时同步：BroadcastChannel（bigbazzar_debug）
//
// 游戏侧：调用 getConfig() / 订阅 onConfigChange()
// 调试页侧：调用 setConfig() 即可同步到正在运行的游戏
// ============================================================

const STORAGE_PREFIX = 'bigbazzar_cfg_'
const BC_NAME        = 'bigbazzar_debug'

// ---- 参数定义 ----

export interface ConfigDef {
  labelCn:       string    // 中文标签
  description:   string    // 说明文字
  defaultValue:  number
  min:           number
  max:           number
  step:          number
  unit:          string    // 显示单位（px / ms 等）
}

export const CONFIG_DEFS: Record<string, ConfigDef> = {
  dragThresholdPx: {
    labelCn:      '触发拖拽的最小移动距离',
    description:  '手指移动超过此距离触发拖拽，低于则视为点击',
    defaultValue: 12,
    min:  2,
    max:  80,
    step: 1,
    unit: 'px',
  },
  dragYOffset: {
    labelCn:      '拖拽时物品向上偏移量',
    description:  '负值 = 物品显示在手指上方，让手指不遮挡物品',
    defaultValue: -80,
    min:  -240,
    max:  0,
    step: 4,
    unit: 'px',
  },
  snapBackMs: {
    labelCn:      '放置失败弹回动画时长',
    description:  '物品放置失败时弹回原位的动画时长',
    defaultValue: 150,
    min:  30,
    max:  600,
    step: 10,
    unit: 'ms',
  },
  squeezeMs: {
    labelCn:      '挤出动画时长',
    description:  '挤出其他物品腾出空位的滑动动画时长（新挤出会打断旧动画）',
    defaultValue: 120,
    min:  20,
    max:  400,
    step: 10,
    unit: 'ms',
  },
  squeezePreviewDelayMs: {
    labelCn:      '挤出预览触发延迟',
    description:  '拖动时悬停多少毫秒后预览挤出效果（0=立即预览）',
    defaultValue: 300,
    min:  0,
    max:  1000,
    step: 50,
    unit: 'ms',
  },
  synthPauseMs: {
    labelCn:      '合成停留时长',
    description:  '合成全屏提示停留时间，结束后开始飞入目标',
    defaultValue: 420,
    min:  0,
    max:  2000,
    step: 20,
    unit: 'ms',
  },
  synthFlyMs: {
    labelCn:      '合成飞入时长',
    description:  '合成图标飞入目标位置动画时长',
    defaultValue: 900,
    min:  120,
    max:  2400,
    step: 20,
    unit: 'ms',
  },
  shopAreaX: {
    labelCn:      '商店区 X 坐标',
    description:  '商店面板左上角 X 坐标',
    defaultValue: 0,
    min:  -200,
    max:  200,
    step: 1,
    unit: 'px',
  },
  shopAreaY: {
    labelCn:      '商店区 Y 坐标',
    description:  '商店面板左上角 Y 坐标',
    defaultValue: 430,
    min:  0,
    max:  1300,
    step: 2,
    unit: 'px',
  },
  battleZoneX: {
    labelCn:      '战斗区 X 坐标',
    description:  '战斗区左上角 X 坐标',
    defaultValue: 0,
    min:  -200,
    max:  200,
    step: 1,
    unit: 'px',
  },
  battleZoneY: {
    labelCn:      '战斗区 Y 坐标',
    description:  '战斗区左上角 Y 坐标',
    defaultValue: 1020,
    min:  0,
    max:  1300,
    step: 2,
    unit: 'px',
  },
  backpackZoneX: {
    labelCn:      '背包区 X 坐标',
    description:  '背包区左上角 X 坐标',
    defaultValue: 0,
    min:  -200,
    max:  200,
    step: 1,
    unit: 'px',
  },
  backpackZoneY: {
    labelCn:      '背包区 Y 坐标',
    description:  '背包区左上角 Y 坐标',
    defaultValue: 430,
    min:  0,
    max:  1300,
    step: 2,
    unit: 'px',
  },
  backpackBtnX: {
    labelCn:      '背包按钮 X 坐标',
    description:  '背包按钮圆心 X 坐标',
    defaultValue: 80,
    min:  -100,
    max:  740,
    step: 1,
    unit: 'px',
  },
  backpackBtnY: {
    labelCn:      '背包按钮 Y 坐标',
    description:  '背包按钮圆心 Y 坐标',
    defaultValue: 900,
    min:  0,
    max:  1384,
    step: 2,
    unit: 'px',
  },
  sellBtnX: {
    labelCn:      '出售按钮 X 坐标',
    description:  '出售按钮圆心 X 坐标',
    defaultValue: 560,
    min:  -100,
    max:  740,
    step: 1,
    unit: 'px',
  },
  sellBtnY: {
    labelCn:      '出售按钮 Y 坐标',
    description:  '出售按钮圆心 Y 坐标',
    defaultValue: 900,
    min:  0,
    max:  1384,
    step: 2,
    unit: 'px',
  },
  refreshBtnX: {
    labelCn:      '刷新按钮 X 坐标',
    description:  '刷新按钮圆心 X 坐标',
    defaultValue: 320,
    min:  -100,
    max:  740,
    step: 1,
    unit: 'px',
  },
  refreshBtnY: {
    labelCn:      '刷新按钮 Y 坐标',
    description:  '刷新按钮圆心 Y 坐标',
    defaultValue: 900,
    min:  0,
    max:  1384,
    step: 2,
    unit: 'px',
  },
  goldTextCenterX: {
    labelCn:      '当前金币中心 X 坐标',
    description:  '当前金币文字中心 X 坐标',
    defaultValue: 320,
    min:  -100,
    max:  740,
    step: 1,
    unit: 'px',
  },
  goldTextY: {
    labelCn:      '当前金币 Y 坐标',
    description:  '当前金币文字左上角 Y 坐标',
    defaultValue: 958,
    min:  0,
    max:  1384,
    step: 2,
    unit: 'px',
  },
  dayDebugX: {
    labelCn:      'Day 控件 X 坐标',
    description:  'Day 调试控件容器左上角 X 坐标',
    defaultValue: 8,
    min:  -100,
    max:  740,
    step: 1,
    unit: 'px',
  },
  dayDebugY: {
    labelCn:      'Day 控件 Y 坐标',
    description:  'Day 调试控件容器左上角 Y 坐标',
    defaultValue: 984,
    min:  0,
    max:  1384,
    step: 2,
    unit: 'px',
  },
  tierBorderWidth: {
    labelCn:      '品质描边宽度',
    description:  '商店、背包、战斗区物品品质描边线宽',
    defaultValue: 4,
    min:  1,
    max:  12,
    step: 1,
    unit: 'px',
  },
  gridItemCornerRadius: {
    labelCn:      '格子/装备圆角',
    description:  '战斗区/背包格子背景与装备底框统一圆角大小',
    defaultValue: 10,
    min:  0,
    max:  32,
    step: 1,
    unit: 'px',
  },
  gridCellBorderWidth: {
    labelCn:      '战斗/背包底框边框宽度',
    description:  '战斗区与背包区网格底框边框线宽',
    defaultValue: 1,
    min:  1,
    max:  12,
    step: 1,
    unit: 'px',
  },
  shopAreaBgWidth: {
    labelCn:      '商店背景宽度',
    description:  '商店区域纯色背景宽度',
    defaultValue: 660,
    min:  320,
    max:  900,
    step: 1,
    unit: 'px',
  },
  shopAreaBgHeight: {
    labelCn:      '商店背景高度',
    description:  '商店区域纯色背景高度',
    defaultValue: 328,
    min:  120,
    max:  700,
    step: 1,
    unit: 'px',
  },
  backpackAreaBgWidth: {
    labelCn:      '背包背景宽度',
    description:  '背包区域纯色背景宽度',
    defaultValue: 607,
    min:  320,
    max:  900,
    step: 1,
    unit: 'px',
  },
  backpackAreaBgHeight: {
    labelCn:      '背包背景高度',
    description:  '背包区域纯色背景高度',
    defaultValue: 266,
    min:  120,
    max:  700,
    step: 1,
    unit: 'px',
  },
  itemInfoBottomGapToShop: {
    labelCn:      '信息面板距商店间距',
    description:  '信息面板下边缘到商店上边缘的固定距离',
    defaultValue: 12,
    min:  0,
    max:  240,
    step: 1,
    unit: 'px',
  },
  itemInfoWidth: {
    labelCn:      '物品信息面板宽度',
    description:  '上方面板宽度（支持贴边）',
    defaultValue: 400,
    min:  360,
    max:  640,
    step: 2,
    unit: 'px',
  },
  itemInfoMinH: {
    labelCn:      '物品信息面板最低高度',
    description:  '非小型物品的信息面板最低高度；面板向下对齐，内容超出时向上扩展',
    defaultValue: 240,
    min:  160,
    max:  900,
    step: 2,
    unit: 'px',
  },
  itemInfoMinHSmall: {
    labelCn:      '小型信息面板最低高度',
    description:  '小型(1x1)物品的信息面板最低高度；可单独调小',
    defaultValue: 180,
    min:  120,
    max:  900,
    step: 2,
    unit: 'px',
  },
  gridZoneLabelFontSize: {
    labelCn:      '区域描述文本',
    description:  '商店/战斗区/背包 区域描述文本大小',
    defaultValue: 22,
    min:  10,
    max:  48,
    step: 1,
    unit: 'px',
  },
  shopButtonLabelFontSize: {
    labelCn:      '商店按钮字号',
    description:  '背包/刷新/出售 按钮主文字大小',
    defaultValue: 22,
    min:  10,
    max:  48,
    step: 1,
    unit: 'px',
  },
  sellButtonSubPriceFontSize: {
    labelCn:      '出售按钮副文字字号',
    description:  '出售按钮下方价格文字大小',
    defaultValue: 16,
    min:  10,
    max:  40,
    step: 1,
    unit: 'px',
  },
  refreshCostFontSize: {
    labelCn:      '刷新费用字号',
    description:  '刷新费用文本字体大小',
    defaultValue: 18,
    min:  10,
    max:  40,
    step: 1,
    unit: 'px',
  },
  goldFontSize: {
    labelCn:      '金币字号',
    description:  '持有金币文本字体大小',
    defaultValue: 20,
    min:  10,
    max:  48,
    step: 1,
    unit: 'px',
  },
  dayDebugArrowFontSize: {
    labelCn:      '天数箭头字号',
    description:  'Day 调试箭头字体大小',
    defaultValue: 22,
    min:  10,
    max:  48,
    step: 1,
    unit: 'px',
  },
  dayDebugLabelFontSize: {
    labelCn:      '天数字号',
    description:  'Day 调试文本字体大小',
    defaultValue: 18,
    min:  10,
    max:  48,
    step: 1,
    unit: 'px',
  },
  shopItemNameFontSize: {
    labelCn:      '商店名字号',
    description:  '商店物品名称字体大小',
    defaultValue: 16,
    min:  10,
    max:  40,
    step: 1,
    unit: 'px',
  },
  shopItemPriceFontSize: {
    labelCn:      '商店价格字号',
    description:  '商店物品价格字体大小',
    defaultValue: 15,
    min:  10,
    max:  40,
    step: 1,
    unit: 'px',
  },
  shopItemBoughtFontSize: {
    labelCn:      '已购标记字号',
    description:  '商店已购标记字体大小',
    defaultValue: 24,
    min:  10,
    max:  56,
    step: 1,
    unit: 'px',
  },
  itemInfoNameFontSize: {
    labelCn:      '信息名称字号',
    description:  '上方面板名称字体大小',
    defaultValue: 22,
    min:  10,
    max:  56,
    step: 1,
    unit: 'px',
  },
  itemInfoTierFontSize: {
    labelCn:      '信息品质标字号',
    description:  '上方面板品质标签字体大小',
    defaultValue: 14,
    min:  10,
    max:  40,
    step: 1,
    unit: 'px',
  },
  itemInfoPriceFontSize: {
    labelCn:      '信息价格字号',
    description:  '上方面板价格字体大小',
    defaultValue: 20,
    min:  10,
    max:  56,
    step: 1,
    unit: 'px',
  },
  itemInfoDescFontSize: {
    labelCn:      '信息描述字号',
    description:  '上方面板描述字体大小',
    defaultValue: 16,
    min:  10,
    max:  40,
    step: 1,
    unit: 'px',
  },
  synthTitleFontSize: {
    labelCn:      '合成标题字号',
    description:  '合成全屏动画标题字体大小',
    defaultValue: 36,
    min:  12,
    max:  80,
    step: 1,
    unit: 'px',
  },
  synthNameFontSize: {
    labelCn:      '合成名称字号',
    description:  '合成全屏动画物品名称字体大小',
    defaultValue: 24,
    min:  12,
    max:  64,
    step: 1,
    unit: 'px',
  },
  battleZoneExpandMs: {
    labelCn:      '战斗区扩展动画时长',
    description:  '切换天数时战斗区向两侧扩展的过渡动画时长',
    defaultValue: 400,
    min:  100,
    max:  2000,
    step: 50,
    unit: 'ms',
  },
}

const _projectDefaults = projectDebugDefaults as Record<string, number>
for (const [key, val] of Object.entries(_projectDefaults)) {
  const def = CONFIG_DEFS[key]
  if (!def) continue
  if (!Number.isFinite(val)) continue
  def.defaultValue = Math.max(def.min, Math.min(def.max, Number(val)))
}

// ---- 读写 ----

/** 读取配置值（localStorage > 默认值） */
export function getConfig(key: string): number {
  const def = CONFIG_DEFS[key]
  const clamp = (v: number): number => def ? Math.max(def.min, Math.min(def.max, v)) : v
  const raw = localStorage.getItem(STORAGE_PREFIX + key)
  if (raw !== null) {
    const n = Number(raw)
    if (!Number.isNaN(n)) {
      return clamp(n)
    }
  }
  return def?.defaultValue ?? 0
}

/** 写入配置值并广播到同源的其他页面（例如正在运行的游戏） */
export function setConfig(key: string, value: number): void {
  const def = CONFIG_DEFS[key]
  const v = def ? Math.max(def.min, Math.min(def.max, value)) : value
  localStorage.setItem(STORAGE_PREFIX + key, String(v))
  try {
    _getChannel().postMessage({ key, value: v })
  } catch { /* BroadcastChannel 不支持时静默失败 */ }
}

/** 重置某个参数到默认值 */
export function resetConfig(key: string): void {
  localStorage.removeItem(STORAGE_PREFIX + key)
  const def = CONFIG_DEFS[key]?.defaultValue ?? 0
  try {
    _getChannel().postMessage({ key, value: def })
  } catch {}
}

/** 重置所有参数到默认值 */
export function resetAllConfig(): void {
  for (const key of Object.keys(CONFIG_DEFS)) resetConfig(key)
}

export function clearStoredConfig(): void {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k)
  }
  for (const k of keys) localStorage.removeItem(k)
}

export function getConfigSnapshot(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of Object.keys(CONFIG_DEFS)) {
    out[key] = getConfig(key)
  }
  return out
}

// ---- 订阅（供游戏侧调用）----

type ConfigChangeCallback = (key: string, value: number) => void

const _listeners: Set<ConfigChangeCallback> = new Set()

/** 订阅来自调试页的实时更新，返回取消订阅函数 */
export function onConfigChange(cb: ConfigChangeCallback): () => void {
  _listeners.add(cb)
  return () => _listeners.delete(cb)
}

// ---- 内部 BroadcastChannel ----

let _channel: BroadcastChannel | null = null

function _getChannel(): BroadcastChannel {
  if (!_channel) {
    _channel = new BroadcastChannel(BC_NAME)
    _channel.onmessage = (e: MessageEvent<{ key: string; value: number }>) => {
      const { key, value } = e.data
      const def = CONFIG_DEFS[key]
      const v = def ? Math.max(def.min, Math.min(def.max, value)) : value
      // 同步写入 localStorage，让下次 getConfig() 也返回新值
      localStorage.setItem(STORAGE_PREFIX + key, String(v))
      // 通知所有监听器
      for (const cb of _listeners) cb(key, v)
    }
  }
  return _channel
}

// 初始化 channel 以便监听来自其他标签页的更新
_getChannel()
