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
  synthFadeOutMs: {
    labelCn:      '合成淡出时长',
    description:  '命中合成后，被吞并的拖拽物品淡出消失时长',
    defaultValue: 120,
    min:  0,
    max:  800,
    step: 10,
    unit: 'ms',
  },
  synthHoldMs: {
    labelCn:      '合成停留时长',
    description:  '合成信息层完全显示后停留多久再开始淡出',
    defaultValue: 260,
    min:  0,
    max:  2000,
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
  enemyBattleZoneY: {
    labelCn:      '敌方战斗区 Y 坐标',
    description:  '敌方战斗区左上角 Y 坐标',
    defaultValue: 180,
    min:  0,
    max:  1300,
    step: 2,
    unit: 'px',
  },
  enemyHpBarY: {
    labelCn:      '敌方血条 Y 坐标',
    description:  '敌方生命条容器左上角 Y 坐标',
    defaultValue: 470,
    min:  0,
    max:  1300,
    step: 2,
    unit: 'px',
  },
  playerHpBarY: {
    labelCn:      '我方血条 Y 坐标',
    description:  '我方生命条容器左上角 Y 坐标',
    defaultValue: 920,
    min:  0,
    max:  1300,
    step: 2,
    unit: 'px',
  },
  battleHpBarH: {
    labelCn:      '战斗血条高度',
    description:  '战斗双方生命进度条高度',
    defaultValue: 28,
    min:  8,
    max:  80,
    step: 1,
    unit: 'px',
  },
  battleHpBarRadius: {
    labelCn:      '战斗血条圆角',
    description:  '战斗双方生命进度条圆角',
    defaultValue: 12,
    min:  0,
    max:  40,
    step: 1,
    unit: 'px',
  },
  battleHpBarWidth: {
    labelCn:      '战斗血条宽度',
    description:  '战斗双方生命进度条宽度',
    defaultValue: 560,
    min:  240,
    max:  620,
    step: 2,
    unit: 'px',
  },
  battleHpTextFontSize: {
    labelCn:      '战斗血条字号',
    description:  '战斗阶段血条文本字体大小',
    defaultValue: 20,
    min:  10,
    max:  56,
    step: 1,
    unit: 'px',
  },
  battleFirePulseScaleMax: {
    labelCn:      '开火放缩最大值',
    description:  '物品触发开火时的最大放缩倍率',
    defaultValue: 1.12,
    min:  1,
    max:  1.8,
    step: 0.01,
    unit: 'x',
  },
  battleFirePulseMs: {
    labelCn:      '开火放缩时长',
    description:  '物品触发开火时放缩与回弹总时长',
    defaultValue: 180,
    min:  40,
    max:  1200,
    step: 10,
    unit: 'ms',
  },
  battleProjectileFlyMs: {
    labelCn:      '飞点飞行时长',
    description:  '伤害/护盾飞点从物品到血条中心的飞行时长',
    defaultValue: 180,
    min:  40,
    max:  1200,
    step: 10,
    unit: 'ms',
  },
  battleDamageFloatRandomX: {
    labelCn:      '伤害数字随机X范围',
    description:  '伤害数字初始位置随机左右偏移范围（±）',
    defaultValue: 14,
    min:  0,
    max:  120,
    step: 1,
    unit: 'px',
  },
  battleDamageFloatRiseMs: {
    labelCn:      '伤害数字上升时长',
    description:  '伤害数字从起点上升到目标高度的时长',
    defaultValue: 260,
    min:  20,
    max:  2000,
    step: 10,
    unit: 'ms',
  },
  battleDamageFloatRiseY: {
    labelCn:      '伤害数字上升高度',
    description:  '伤害数字上升位移高度',
    defaultValue: 46,
    min:  0,
    max:  240,
    step: 1,
    unit: 'px',
  },
  battleDamageFloatHoldMs: {
    labelCn:      '伤害数字停留时长',
    description:  '伤害数字上升结束后停留时长',
    defaultValue: 90,
    min:  0,
    max:  1200,
    step: 10,
    unit: 'ms',
  },
  battleDamageFloatFadeMs: {
    labelCn:      '伤害数字渐隐时长',
    description:  '伤害数字消失渐隐时长',
    defaultValue: 260,
    min:  20,
    max:  2000,
    step: 10,
    unit: 'ms',
  },
  gameplayBurnTickMs: {
    labelCn:      '灼烧结算间隔',
    description:  '灼烧每次结算的时间间隔',
    defaultValue: 500,
    min:  100,
    max:  5000,
    step: 50,
    unit: 'ms',
  },
  gameplayPoisonTickMs: {
    labelCn:      '中毒结算间隔',
    description:  '中毒每次结算的时间间隔',
    defaultValue: 1000,
    min:  100,
    max:  5000,
    step: 50,
    unit: 'ms',
  },
  gameplayRegenTickMs: {
    labelCn:      '生命回复结算间隔',
    description:  '生命回复每次结算的时间间隔',
    defaultValue: 1000,
    min:  100,
    max:  5000,
    step: 50,
    unit: 'ms',
  },
  gameplayBurnShieldFactor: {
    labelCn:      '灼烧对盾系数',
    description:  '灼烧对护盾生效系数（0.5=伤盾减半）',
    defaultValue: 0.5,
    min:  0,
    max:  2,
    step: 0.01,
    unit: 'x',
  },
  gameplayBurnDecayPct: {
    labelCn:      '灼烧衰减比例',
    description:  '每次灼烧结算后层数衰减比例',
    defaultValue: 0.05,
    min:  0,
    max:  1,
    step: 0.01,
    unit: '',
  },
  gameplayHealCleansePct: {
    labelCn:      '治疗净化比例',
    description:  '直接治疗时净化灼烧/中毒层数比例',
    defaultValue: 0.05,
    min:  0,
    max:  1,
    step: 0.01,
    unit: '',
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
  phaseBtnX: {
    labelCn:      '战斗切换按钮 X 坐标',
    description:  '战斗/商店切换按钮圆心 X 坐标',
    defaultValue: 320,
    min:  -100,
    max:  740,
    step: 1,
    unit: 'px',
  },
  phaseBtnY: {
    labelCn:      '战斗切换按钮 Y 坐标',
    description:  '战斗/商店切换按钮圆心 Y 坐标',
    defaultValue: 780,
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
  phaseButtonLabelFontSize: {
    labelCn:      '战斗切换按钮字号',
    description:  '战斗/商店切换按钮主文字大小',
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
    description:  '合成信息层标题字体大小',
    defaultValue: 36,
    min:  12,
    max:  80,
    step: 1,
    unit: 'px',
  },
  synthNameFontSize: {
    labelCn:      '合成名称字号',
    description:  '合成信息层物品名称字体大小',
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
  autoPackThrottleMs: {
    labelCn:      'AutoPack 节流窗口',
    description:  '同一背包状态下 AutoPack 结果复用窗口，减少拖拽高频计算',
    defaultValue: 50,
    min:  0,
    max:  300,
    step: 5,
    unit: 'ms',
  },
  toastEnabled: {
    labelCn:      '显示 Toast 提示',
    description:  '总开关：是否显示商店失败路径的 toast 提示',
    defaultValue: 1,
    min:  0,
    max:  1,
    step: 1,
    unit: '',
  },
  toastShowNoGoldBuy: {
    labelCn:      '金币不足-购买',
    description:  '金币不足导致无法购买时是否显示 toast',
    defaultValue: 1,
    min:  0,
    max:  1,
    step: 1,
    unit: '',
  },
  toastShowNoGoldRefresh: {
    labelCn:      '金币不足-刷新',
    description:  '金币不足导致无法刷新时是否显示 toast',
    defaultValue: 1,
    min:  0,
    max:  1,
    step: 1,
    unit: '',
  },
  toastShowBackpackFullBuy: {
    labelCn:      '背包满-购买',
    description:  '背包已满导致无法购买时是否显示 toast',
    defaultValue: 1,
    min:  0,
    max:  1,
    step: 1,
    unit: '',
  },
  toastShowBackpackFullTransfer: {
    labelCn:      '背包满-转移',
    description:  '背包已满导致无法转移到背包时是否显示 toast',
    defaultValue: 1,
    min:  0,
    max:  1,
    step: 1,
    unit: '',
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
