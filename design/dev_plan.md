# 手机大巴扎 Demo — 开发计划

> **版本：** v1.0 · 2026-02-26
> **依据：** 设计案 Demo2.25.docx + 技术 Notebook（WebJs开发指南）+ 设计 Notebook（手机大巴扎设计）
> **目标：** 在 3 周内完成可验证核心体验的 Demo，累计 Day 1–10，单局 25–30 分钟

---

## 一、技术选型

| 层次 | 技术 | 理由 |
|------|------|------|
| 构建工具 | **Vite + TypeScript** | 极速热重载，类型安全，配合 JSON 数据驱动 |
| 渲染引擎 | **PixiJS v8（WebGPU 优先）** | 优先启用 WebGPU 后端，不支持时回退 WebGL；竖屏 Canvas 精准控制，拖拽网格控制力强于 Phaser |
| 输入 | **Pointer Events API** | 统一触控/鼠标，一套代码适配手机与桌面 |
| 数据 | **JSON 数据驱动** | `game_config.json` + `vanessa_items.json` 已就位，引擎读表启动 |
| 音频 | **Web Audio API** | 移动端音频唤醒 + 音效播放 |
| 存档 | **IndexedDB** | 断点续玩，PWA 离线支持（Demo 后期扩展） |

**核心架构原则（来自技术 Notebook）：**
- **逻辑/渲染分离**：战斗逻辑纯 TypeScript，EventBus 解耦表现层
- **数据驱动**：所有数值从 JSON 读取，无硬编码魔法数字
- **对象池**：物品 Sprite、飞字、特效对象均走对象池，避免 GC 抖动
- **性能预算**：单帧逻辑 ≤ 4ms，渲染 ≤ 8ms，主线程长任务 < 50ms

---

## 〇、项目协作约定

### 渲染引擎

- **WebGPU 优先**：PixiJS 初始化时传入 `preference: 'webgpu'`，运行时不支持自动回退 WebGL。禁止在代码中硬编码 WebGL 专用路径，所有渲染代码保持 WebGPU/WebGL 双兼容。

### 开发与 Debug 流程

- **在线技术主程 Notebook（技术 Notebook）为主要策略制订者**：实际代码开发和 Debug 方案，须优先在技术 Notebook 中问询并获得方案确认后再落地实现。
- **代码 Review 须经技术主程确认**：每个阶段完成后，将关键实现提交技术 Notebook 做 Review，确认通过后方可进入下一阶段。
- Claude Code 负责执行已确认方案，不得擅自改变已确认的架构决策。

### 设计确认流程

- **在线设计 Notebook（设计 Notebook）为设计决策者**：UI 布局、交互方式、视觉风格等制作中的设计内容，须向设计 Notebook 问询并获得设计意见后再实现。
- 设计 Notebook 提出的重要设计意见须记录在本文档对应阶段的"设计确认"小节中，作为实现依据。
- 未经设计 Notebook 确认的视觉/交互方案，视为临时占位，后续需补充确认。

### 开发进度追踪

- **进度文件**：`design/progress.md` 记录实时开发进度，每次对话结束前必须更新。
- 记录内容包括：本次完成项、当前阶段状态、待解决问题、技术/设计决定。
- 每次新对话开始，先读取 `design/progress.md` 恢复上下文，再开始工作。

---

## 二、项目结构

```
bigbazzar/
├── data/
│   ├── game_config.json        # 全局数值配置
│   └── vanessa_items.json      # Vanessa 卡牌数据
├── design/
│   ├── Demo2.25.docx           # 原始设计案
│   └── dev_plan.md             # 本文件
└── src/
    ├── main.ts                 # 入口，初始化 PixiJS + 场景管理
    ├── core/
    │   ├── EventBus.ts         # 全局事件总线
    │   ├── GameLoop.ts         # 固定时间步主循环
    │   └── DataLoader.ts       # 读取 JSON 配置
    ├── grid/
    │   ├── GridSystem.ts       # 5x2 网格逻辑（2D 数组 + 相邻关系）
    │   ├── DragController.ts   # 拖拽防误触控制器
    │   └── GridView.ts         # PixiJS 网格渲染层
    ├── shop/
    │   ├── ShopSystem.ts       # 经济逻辑（金币、购买、出售、刷新）
    │   ├── ItemPool.ts         # 卡牌池，三选一抽卡
    │   └── ShopView.ts         # 商店 UI 渲染
    ├── battle/
    │   ├── BattleEngine.ts     # 自动战斗引擎（固定时间步）
    │   ├── StatusSystem.ts     # 状态效果（Burn/Freeze/Haste/Slow/Poison）
    │   ├── AdjacencyResolver.ts# 相邻关系触发器
    │   └── BattleView.ts       # 战斗表现层（飞字、读条、高亮）
    ├── items/
    │   ├── ItemDef.ts          # 物品类型定义（对应 vanessa_items.json）
    │   └── EffectHandlers.ts   # 各物品技能效果实现
    ├── scenes/
    │   ├── ShopScene.ts        # 商店场景
    │   └── BattleScene.ts      # 战斗场景
    └── enemy/
        └── EnemyTemplates.ts   # 10 个敌人模板配置
```

---

## 三、开发阶段

### 阶段 0：工程脚手架（1–2 天）

**目标：** 手机浏览器打开，竖屏空画布跑通

**任务：**
- [ ] `npm create vite@latest` 初始化，TypeScript 模板
- [ ] 安装 PixiJS v8，配置竖屏 Canvas（基准分辨率 **390×844**，iPhone 15 标准）
- [ ] 读取并类型化 `game_config.json` / `vanessa_items.json`
- [ ] 搭建 EventBus（类型安全的发布/订阅）
- [ ] 搭建场景切换框架（ShopScene ↔ BattleScene）
- [ ] 配置 `touch-action: none` 禁用浏览器原生手势

**验收标准：** 手机竖屏打开页面，无滚动/缩放干扰，控制台打印配置数据

---

### 阶段 1：5x2 网格核心（3–4 天）⭐ 最高优先级

**这是与竞品最大的差异化机制，必须最先验证拖拽体验。**

#### 1.1 网格逻辑（GridSystem.ts）

```typescript
// 核心数据结构
type GridCell = string | null;  // null=空，string=物品ID
const grid: GridCell[][] = Array(5).fill(null).map(() => Array(2).fill(null));

// 物品尺寸
type ItemSize = '1x1' | '1x2' | '2x2';
const SIZE_MAP = { '1x1': {w:1,h:1}, '1x2': {w:1,h:2}, '2x2': {w:2,h:2} };

// 放置合法性检测
function canPlace(gridX: number, gridY: number, size: ItemSize): boolean {
  const {w, h} = SIZE_MAP[size];
  if (gridX < 0 || gridY < 0 || gridX + w > 5 || gridY + h > 2) return false;
  for (let x = gridX; x < gridX + w; x++)
    for (let y = gridY; y < gridY + h; y++)
      if (grid[x][y] !== null) return false;
  return true;
}
```

**相邻关系（绝对规则）：**
- 只有**左右相邻**（col±1，同行）计入
- 1×2 / 2×2 物品跨越两行，同时在上下两条轨道拥有左右邻居，是唯一的**跨轨道枢纽**

```typescript
function getAdjacentItems(itemId: string): string[] {
  // 找出物品占据的所有格子
  // 对每个格子检查 col-1 和 col+1 的格子
  // 跨行枢纽的两行都参与计算，结果去重
}
```

#### 1.2 拖拽控制器（DragController.ts）

**防误触策略（技术 Notebook 推荐）：**

```typescript
// 长按阈值 200ms + 移动死区 8px
const LONG_PRESS_MS = 200;
const DEADZONE_PX = 8;

onPointerDown(e: PointerEvent) {
  recordStartPos(e);
  longPressTimer = setTimeout(() => enterDragMode(), LONG_PRESS_MS);
  element.setPointerCapture(e.pointerId); // 防止手指滑出范围中断拖拽
}

onPointerMove(e: PointerEvent) {
  const dist = getDistance(e, startPos);
  if (!isDragging && dist > DEADZONE_PX) {
    clearTimeout(longPressTimer); // 超出死区且未到长按 → 非拖拽操作
    return;
  }
  if (isDragging) updateItemPosition(e);
}

onPointerUp(e: PointerEvent) {
  clearTimeout(longPressTimer);
  if (!isDragging) triggerDetailView();  // tap → 查看详情
  else tryPlaceItem();                   // drag → 放置检测
}
```

**放置流程：**
1. 手指位置 → 除以 tileSize → 取整 → 得到目标 `(gridX, gridY)`
2. 调用 `canPlace()` 检测合法性
3. 合法 → 吸附动画，更新 grid 数组
4. 非法 → Tween 弹回原位（缓动时间 150ms）

**任务清单：**
- [ ] 实现 GridSystem（2D 数组 + canPlace + getAdjacentItems）
- [ ] 实现 DragController（长按/tap 分离，Pointer Capture）
- [ ] PixiJS 渲染：格子高亮（绿=可放/红=非法）
- [ ] 背包区（10 格）与战斗区分区，战斗区格数从配置读取（4/6/8/10 随 Day 解锁）
- [ ] 1x1、1x2、2x2 三种尺寸的 Sprite，不同颜色区分

**验收标准：** 单手竖屏操作，5 次内无误触；放置非法时物品有弹回动画

---

### 阶段 2：商店与经济系统（3–4 天）

**目标：** 完整购买/出售决策循环，产生有意义的"存钱 vs 花钱"博弈

#### 2.1 经济模型

基于 `game_config.json`：
- **每日固定金币：** 15 金
- **物品价格：** 小型 2/4/8/16，中型 4/8/16/32，大型 6/12/24/48（按品质）
- **出售折扣：** 50% 返金币
- **品质出售限制：** 青铜 Day1，白银 Day2，金 Day5，钻 Day8

#### 2.2 三选一商店（Discover 机制）

```
每回合发放 15 金 → 展示 3 张随机卡（从 vanessa_items 池按品质权重抽取）
→ 玩家选一购入背包 或 跳过
→ 刷新按钮（价格递增：1→2→3...10金）重新三选一
```

**刷新成本平衡（设计 Notebook 建议）：**
- 引入"减免刷新成本"的物品/技能，使刷新本身成为一种流派投资（例如：服饰类物品每件减少 1 金刷新费）
- Day 3 前刷新成本不超过 3 金，避免早期惩罚过重

#### 2.3 出售触发效果

出售物品不仅返金币，还触发 `onSell` 效果：

```typescript
interface ItemDef {
  onSell?: (gameState: GameState) => void;
  // 例："出售时最左侧武器 +10 伤害"
}
```

**任务清单：**
- [ ] 每日发金币逻辑
- [ ] 三选一卡池抽卡（按品质权重）
- [ ] 购买 → 进背包，背包 ↔ 战斗区 自由移动
- [ ] 出售按钮 + 50% 返金币 + onSell 触发
- [ ] 刷新按钮（价格递增，从配置读取）
- [ ] UI：金币显示、背包格、商店区、刷新价格

#### 2.4 合成表现规范（当前实现）

- 合成触发：仅在“同物品 + 同品质”且命中目标时触发，落手后执行。
- 合成优先级：命中可合成目标时，优先合成，不触发挤出。
- 表现流程：显示合成信息层（标题/名称/图标/全屏遮罩）→ 停留 → 淡出；不再飞入目标。
- 可调参数：
  - `synthHoldMs`：信息层停留时长
  - `synthFadeOutMs`：信息层淡出时长
  - `synthTitleFontSize` / `synthNameFontSize`：信息层字体
- 图标尺寸：按目标物品尺寸与全局缩放一致（`targetSize × itemVisualScale`）。

**验收标准：** 完整走一个回合的买/卖/摆放流程，金币数字正确

---

### 阶段 3：战斗引擎（4–5 天）⭐ 技术核心

**目标：** 自动战斗流畅运行，战败后可读性清晰

#### 3.1 时间轴架构（固定时间步）

来自技术 Notebook 的核心架构：

```typescript
// BattleEngine.ts
const FIXED_DT = 1 / 60;       // 60 逻辑帧/秒
const MAX_FRAME_TIME = 0.25;    // 防止"死亡螺旋"

let accumulator = 0;
let currentTime = performance.now() / 1000;

function battleLoop(timestamp: number) {
  const newTime = timestamp / 1000;
  const frameTime = Math.min(newTime - currentTime, MAX_FRAME_TIME);
  currentTime = newTime;
  accumulator += frameTime;

  while (accumulator >= FIXED_DT) {
    logicUpdate(FIXED_DT);      // 纯逻辑，≤ 4ms
    accumulator -= FIXED_DT;
  }

  const alpha = accumulator / FIXED_DT;
  renderUpdate(alpha);           // 插值渲染，≤ 8ms
  requestAnimationFrame(battleLoop);
}
```

#### 3.2 状态效果系统（StatusSystem.ts）

5 种状态效果统一接口：

```typescript
interface IStatusEffect {
  id: 'burn' | 'poison' | 'freeze' | 'haste' | 'slow';
  duration: number;
  stacks?: number;        // Poison 可叠加层数
  onApply(target: ItemUnit): void;
  onTick(target: ItemUnit, dt: number): void;
  onRemove(target: ItemUnit): void;
}

// 冰冻：暂停冷却读条
class FreezeEffect implements IStatusEffect {
  onApply(t) { t.cooldownPaused = true; }
  onTick(t, dt) { this.duration -= dt; }
  onRemove(t) { t.cooldownPaused = false; }
}

// 加速/减速：修改冷却倍率
class HasteEffect implements IStatusEffect {
  onApply(t) { t.cooldownMultiplier *= 0.6; }  // 冷却缩短 40%
  onRemove(t) { t.cooldownMultiplier /= 0.6; }
}
```

#### 3.3 战斗循环逻辑

每个 `logicUpdate(dt)` 步骤：

```
1. 更新所有物品的冷却读条（受 Freeze/Haste/Slow 影响）
2. 冷却归零 → 触发物品技能（考虑 Ammo、Multicast）
3. 执行技能效果（造成伤害、施加状态、充能相邻物品...）
4. 更新所有状态效果（onTick，计时到期则 onRemove）
5. 检查战斗结束条件（HP ≤ 0）
6. EventBus.emit 所有状态变化事件（供渲染层订阅）
```

#### 3.4 弹药（Ammo）与多重触发（Multicast）

```typescript
interface ItemUnit {
  cooldown: number;         // 当前冷却（ms）
  maxCooldown: number;      // 满冷却值（from ItemDef）
  ammo: number | null;      // null = 无限弹药
  maxAmmo: number | null;
  multicast: number;        // 单次触发次数
  cooldownMultiplier: number; // 受 Haste/Slow 影响
  cooldownPaused: boolean;    // Freeze 时为 true
}

function tryFireItem(item: ItemUnit) {
  if (item.ammo !== null && item.ammo <= 0) {
    startReload(item);  // 进入装填状态
    return;
  }
  for (let i = 0; i < item.multicast; i++) {
    executeEffect(item);
  }
  if (item.ammo !== null) item.ammo--;
}
```

#### 3.5 战斗可读性（Actionable Blame）

**设计 Notebook 核心要求：** 战败后玩家必须能一眼看出原因。

在特效制作前，用以下纯视觉方式表达因果：

| 事件 | 表现 |
|------|------|
| 物品触发 | 冷却进度条（叠加在物品上），触发时闪光 |
| 受到伤害 | 红色飞字（数值大小与伤害成比例）|
| 被冰冻 | 蓝色外框 + 进度条静止 |
| 被灼烧 | 橙色外框 + 每 tick 红色小数字 |
| 中毒 | 绿色外框 + 层数数字 |
| 物品被摧毁（弹药耗尽）| 物品变灰 + "EMPTY" 标签 |
| 战败结算 | 弹出面板，列出"导致失败的 Top2 原因" |

**任务清单：**
- [ ] GameLoop（固定时间步，防死亡螺旋）
- [ ] BattleEngine（物品冷却、Ammo、Multicast 逻辑）
- [ ] StatusSystem（5 种状态，接口化，生命周期管理）
- [ ] AdjacencyResolver（战斗中实时计算相邻触发）
- [ ] EventBus 事件：`ITEM_FIRE / TAKE_DAMAGE / STATUS_APPLY / UNIT_DIE`
- [ ] BattleView：飞字、冷却进度条、状态外框高亮
- [ ] 战败结算面板（Top2 Blame 分析）

**验收标准：** 战败后 5 秒内能说出 1-2 条明确原因

---

### 阶段 4：Vanessa 物品效果（4–5 天）

**目标：** 实现 3 条流派各自的完整闭环，可打出差异化体验

#### 4.1 优先实现牌单（来自设计 Notebook）

| 流派 | 核心牌 | 尺寸 | 关键效果 |
|------|--------|------|----------|
| **水系流** | 海螺壳 | 1×1 | 每有一件水系物品 → 获得护盾 |
| **水系流** | 龟壳 | 1×2 | 使用非武器物品时充能；护盾效果 |
| **水系流** | 电鳗 | 1×1 | 水系输出；敌方使用物品时充能 |
| **水系流** | 渔网 | 1×2 | 减速 1-4 件敌方物品；每天获得食人鱼 |
| **弹药流** | 填弹杆 | 1×1 | 为相邻弹药物品装填；触发时+暴击 |
| **弹药流** | 鱼雷 | 1×2 | 100 伤害；水系/弹药物品触发时+伤害 |
| **弹药流** | 连发步枪 | 1×2 | 使用其他弹药物品时触发 |
| **单兵流** | 狙击步枪 | 2×2 | 唯一武器时 5/10 倍伤害 |
| **单兵流** | 消音器 | 1×1 | 左侧武器+伤害；唯一武器时缩短冷却 |
| **通用** | 食人鱼 | 1×1 | 基础水系小型打工牌（由渔网生成）|
| **通用** | 零钱/金条 | 1×1 | 战利品；出售变现 + 触发其他物品效果 |

#### 4.2 效果触发框架

```typescript
// EffectHandlers.ts
type TriggerType =
  | 'on_cooldown'      // 冷却结束时
  | 'on_sell'          // 出售时
  | 'on_adjacent'      // 相邻物品触发时
  | 'on_start_of_day'  // 每天开始时
  | 'on_item_used'     // 任意物品触发时（可过滤标签）
  | 'on_enemy_item_used'; // 敌方物品触发时

const EFFECT_HANDLERS: Record<string, EffectFn> = {
  'sea_shell': (state) => {
    const aquaticCount = state.myItems.filter(i => i.tags.includes('Aquatic')).length;
    state.myShield += aquaticCount * SHIELD_PER_AQUATIC[i.tier];
  },
  'sniper_rifle': (state, item) => {
    const weaponCount = state.myItems.filter(i => i.tags.includes('Weapon')).length;
    const multiplier = weaponCount === 1 ? (item.tier >= 2 ? 10 : 5) : 1;
    return item.damage * multiplier;
  },
  // ...
};
```

**任务清单：**
- [ ] 上表 11 张牌的效果实现
- [ ] 触发框架（EffectHandlers，6 种触发时机）
- [ ] 物品升级层级（铜/银/金/钻，从 vanessa_items.json 读取 tiers）
- [ ] 验证 3 条流派各自能跑通 Day 1-5 并产生不同战斗结果

**验收标准：** 能组出水系流/弹药流/单兵流并打出明显差异化体验

---

### 阶段 5：关卡与进程（2–3 天）

**目标：** Day 1–10 完整单局体验，递进难度

#### 5.1 敌人模板

10 个 Enemy Templates，每个是一组物品配置（无 AI，纯数值）：

| Day | 敌人 | 特点 | 参考 HP |
|-----|------|------|---------|
| 1 | 新手海盗 | 1 件 1×1 近战武器 | 300 |
| 2 | 渔夫 | 渔网 + 1 件工具 | 600 |
| 3 | 弓手 | 2 件弓箭（弹药） | 900 |
| 4 | 守卫 | 护盾 + 反击 | 1200 |
| 5 | 巫师 | 灼烧/毒系 | 1500 |
| 6 | 机械师 | 多重触发组合 | 2000 |
| 7 | 铠甲战士 | 高护盾 + 控制 | 2500 |
| 8 | 狙击手 | 高单次爆发 | 3000 |
| 9 | 弹药商 | 全弹药流 | 3500 |
| 10 | Boss：舰队司令 | 混合水系+弹药+控制 | 4000 |

#### 5.2 战斗区格数解锁

来自 `game_config.json`（`daily_battle_area_slots`）：
- Day 1-2：4 格（2 列 × 2 行）
- Day 3-5：6 格（3 列 × 2 行）
- Day 6-8：8 格（4 列 × 2 行）
- Day 9-10：10 格（5 列 × 2 行，满格解锁）

#### 5.3 整局流程

```
Day N 开始
  → 发放 15 金币
  → 商店阶段（买/卖/摆放）
  → 准备好后点击 [出发]
  → 战斗阶段（全自动读条）
  → 结算（胜利 +1 胜 / 失败 -血量）
  → 10 胜通关 / 血量归零出局
```

**任务清单：**
- [ ] 10 个敌人模板配置文件
- [ ] HP 曲线按 game_config 配置
- [ ] 战斗区格数随 Day 解锁
- [ ] 整局 Day 推进状态机
- [ ] 胜/负/通关结算界面

**验收标准：** 能从 Day 1 连续打到 Day 10（或中途出局）

---

### 阶段 6：UI 打磨与手感（2–3 天）

**目标：** 移动端零误触，视觉可读

**任务清单：**
- [ ] 物品卡牌 UI：名称、尺寸色框（小=灰/中=蓝/大=金）、标签 tag、技能文本
- [ ] 拖拽视觉反馈：拖拽时物品稍大 + 半透明，放置位高亮绿/红
- [ ] 冷却进度条（覆盖在物品卡牌底部，颜色与物品品质一致）
- [ ] 状态图标：6 种状态各有独立小图标 + 颜色外框
- [ ] 商店 UI：金币计数、刷新按钮（显示当前价格）、品质出售限制灰色遮罩
- [ ] 战斗 2× 加速按钮
- [ ] 战败结算面板：Blame 分析 Top2

---

## 四、开发顺序与关键路径

```
阶段0  工程脚手架          (1-2天)
  │
阶段1  5x2网格拖拽         (3-4天)  ← 最先验证，失败则重新设计网格
  │
阶段2  商店经济循环         (3-4天)  ← 商店是战斗的前置
  │
阶段3  战斗引擎             (4-5天)  ← 技术难点，可读性优先
  │
阶段4  Vanessa牌效果        (4-5天)  ← 内容填充，3条流派
  │
阶段5  关卡进程             (2-3天)  ← 完整单局
  │
阶段6  UI打磨              (2-3天)  ← 手感最后调
```

**预计总时长：约 3 周（19–24 天）**

---

## 五、Demo 验证指标

| 指标 | 目标值 | 测量方式 |
|------|--------|----------|
| 拖拽误触率 | 单手 5 次内无误触 | 实机测试 iPhone |
| 战败可读性 | 5 秒内说出 1-2 条原因 | 用户访谈（5 人） |
| 单局时长 | 25–30 分钟 | 计时从 Day1 到通关/出局 |
| 商店决策时间 | 每回合 ≤ 3 分钟 | 计时 |
| 渲染性能 | 战斗时 60FPS | Chrome DevTools |
| 三流派差异 | 水系/弹药/单兵打法明显不同 | 设计师内测 |

---

## 六、风险与注意事项

| 风险 | 缓解方案 |
|------|----------|
| 拖拽误触难以消除 | 阶段 1 就验证，早发现早调整长按阈值 |
| vanessa_items.json 中部分效果描述模糊 | 阶段 4 前逐条确认，不实现则标为 TODO |
| 战斗引擎性能 | 对象池 + 逻辑/渲染分离，提前建立性能基准 |
| 单局 10 天内容不足 | 阶段 5 后做内测，日程不够先做 Day 1-5 的完整闭环 |

---

*本文档由 Claude Code 根据设计案、技术 Notebook 和设计 Notebook 综合生成。*
*如需更新，修改本文件并重新同步到相关 Notebook。*
