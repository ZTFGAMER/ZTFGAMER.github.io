# 大巴扎 — 开发进度记录

> 本文件由 Claude Code 在每次对话结束前自动更新。
> 每次新对话开始必须先读取本文件。

---

## 本次对话追加（2026-02-28，阶段3-P1最小切片开发中）

- 已开始按主程确认方案落地 P1 最小切片：
  - `src/combat/CombatEngine.ts`：新增 `start(snapshot, { enemyDisabled })` 测试开关；控制类状态过期时发出 `battle:status_remove`；状态周期结算改为基于 Tick 序号（按 `tickMs` 推导 burn/poison/regen 触发节拍）；同 Tick 内顺序调整为“触发队列后结算状态，再结算命中队列”。
  - `src/core/EventBus.ts`：战斗事件 payload 补充 `targetType/targetSide/sourceType/sourceSide`（可选字段），用于明确引擎->表现层目标边界。
  - `src/core/DataLoader.ts`：技能文案数值推导补齐 `burn/poison/regen`（与既有 damage/heal/shield/multicast 一并作为缺省值来源）。
  - `src/combat/CombatEngine.test.ts`：新增两条回归用例——控制效果事件目标类型为 item、毒状态先 apply 后 tick 伤害。
- 验证结果：`npm test` 通过（48/48）；`npm run build` 通过。
- 下一步计划：继续补齐“基础伤害管线+状态优先级”剩余边界（目标选择细化、同 Tick 结算规则固化、BattleScene 事件消费对齐）。

### 本次对话追加（2026-02-28，阶段3-P1最小切片继续推进）

- `src/scenes/BattleScene.ts`：事件消费侧改造为优先使用事件 payload 的 `targetSide/sourceSide/targetType`，并新增 `battle:status_remove` 消费；移除事件回调中对 `engine.getBoardState()` 的反查，改为直接使用 `GridZone.getNode()` 计算物品世界坐标。
- `src/combat/CombatEngine.test.ts`：补充 2 条规则测试（控制状态 remove 事件、同 tick 下 DOT 先于直伤结算）。
- 回归验证：`npm test` 通过（50/50）；`npm run build` 通过。

### 本次对话追加（2026-02-28，战斗中物品详情交互）

- 新增战斗中点按物品查看详情：敌方战斗区与我方战斗区物品均可点击打开详情面板，点击其他空白处关闭；点击其他物品会切换为该物品详情（行为与商店一致）。
- 详情面板位置按战斗中部区域居中：以敌我血条之间区域的中线为锚点居中对齐显示。
- `src/scenes/BattleScene.ts`：接入 `SellPopup` 作为战斗详情面板，新增选中态高亮与 stage 空白点击关闭；详情内容使用物品 `defId + tier` 显示。
- `src/shop/SellPopup.ts`：新增 `setCenterY()` 定位模式，新增 `priceMode='none'`（战斗详情隐藏价格文案）。
- 回归验证：`npm test` 通过（50/50）；`npm run build` 通过。

### 本次对话追加（2026-02-28，战斗 CD 遮罩交互与形态修正）

- `src/scenes/BattleScene.ts`：战斗 CD 遮罩层改为点击穿透（`eventMode='none'`），不再阻挡物品点击查看详情。
- `src/scenes/BattleScene.ts`：CD 遮罩绘制改为固定圆角（8）且按物品框内边距计算，不再受 `gridItemCornerRadius` 调整影响形态；同时保持遮罩位于物品框内。
- 回归验证：`npm test` 通过（50/50）；`npm run build` 通过。

### 本次对话追加（2026-02-28，中/大型物品拖拽判定修正）

- 问题定位：中/大型物品拖拽落点在部分场景下偏向左侧，根因是 1D 改造后仍沿用历史锚点路径，落点判定与当前拖拽容器的可视左上角不完全一致。
- 修复：`src/grid/DragController.ts` 在 `findBestDropTarget` 中优先使用“拖拽容器左上角 -> 目标格”映射（按当前可视位置 round 到最近格），回退才走旧的 `pixelToCellForItem`。
- 效果：中/大型物品在拖动时的高亮与落位更贴合手感，不再频繁出现“判到左侧格子”的错位感。
- 回归验证：`npm test` 通过（50/50）；`npm run build` 通过。

### 本次对话追加（2026-02-28，拖拽锚点偏移规则复核）

- 按反馈修正锚点规则：中型(2x1)按手指向左偏移 0.5 格、大型(3x1)向左偏移 1 格；逻辑统一收口到 `src/grid/GridZone.ts:pixelToCellForItem`。
- 关键修复点：偏移改为“先转本地坐标，再按格宽偏移”计算，避免缩放场景下全局坐标直接减像素带来的误差。
- `src/grid/DragController.ts` 同步移除临时 top-left 优先分支，回归统一锚点判定链路，避免与 `pixelToCellForItem` 双轨冲突。
- 回归验证：`npm test` 通过（50/50）；`npm run build` 通过。

## 当前状态

**日期：** 2026-02-28
**当前阶段：** 阶段 3 战斗引擎（可开工）
**整体进度：** ████████████████░ 约 78%

> 备注：阶段 2 与阶段 2.5 已完成；已同步主程并确认“可以进入阶段3”。

**主程确认（阶段3-P1推进策略）：** 先做最小可交付切片：替换占位伤害管线 + 跑通 Poison（主角通道）+ Freeze/Slow（卡牌/物品通道）+ 事件总线到 BattleScene 表现闭环；事件 payload 必须携带明确 targetType/targetId，表现层不可反查引擎；状态结算建议“控制(卡牌)→充能→触发→DOT/HOT(500ms)→护盾/HP→死亡/胜负”；配置字段建议迭代补齐（边实现边收口到 `data/game_config.json` + debugConfig/debugPage）。NotebookLM 对话：`8f6aff9d-d2c2-4069-a61e-72b527ae405b`。

### 本轮完成要点（阶段3 P0 规则对齐）
| 模块/主题 | 变更内容 |
|----------|----------|
| 阶段状态 | 已按设计师战斗规范对齐 P0：固定 Tick + CD 读条 + 护盾抵扣 + 超时疲劳 + Draw 判定 |
| 代码实现 | `CombatEngine` 改为 Hero-vs-Hero（物品作为触发器）；Tick=100ms；超时 40s 后每 1s 触发疲劳真实伤害；同 Tick 双方归零判 Draw |
| 配置接入 | `data/game_config.json` 新增 `combat_runtime`（tickMs/timeoutMs/fatigueTickMs/fatigueDamagePctPerSec/critMultiplier），并接入 `ItemDef` + `DataLoader` |
| 稳定性修复 | 修复 battle 往返丢状态：保留并恢复商店运行态（金币/天数/商店池/战斗区与背包摆放/tier） |
| 战斗可视化 | BattleScene 新增双方英雄血条/护盾条，并新增敌方战斗区显示（与我方战斗区并排展示，含物品读条进度） |
| 布局对齐 | 我方战斗区改为与商店阶段同坐标/同样式（复用 GridZone 图标渲染）；敌方战斗区独立于上方；CD 覆盖改为“半透明蒙版从下到上揭开” |
| 可调参数 | 新增战斗 UI 调参项：`enemyBattleZoneY`、`enemyHpBarY`、`playerHpBarY`、`battleHpBarH`、`battleHpBarRadius`、`battleHpBarWidth`（已接入 debug 页面） |
| 视觉修正 | 敌我生命值文本改为显示在各自血条内部居中（如 `140/300`），移除条外合并文案，提升读条可读性 |
| 血条表达升级 | 文本改为“当前值优先 + 彩色状态尾缀”（白=血量、黄=护盾、绿=再生、紫=中毒、红=灼烧）；护盾条改为血条上方贴合细条，并按 `shield/maxHp` 左起比例显示（溢出截断满条） |
| 多段触发 | CombatEngine 新增 multicast 分段命中队列：`xN` 触发会按标准 Tick（100ms）逐段生效，而非同帧一次性结算 |
| 战斗特效 | 新增开火放缩+黄边闪烁、伤害红色飞点+红色伤害数字、护盾黄色飞点+黄色护盾数字；并新增“伤害数字”调参分组（随机X/上升时长/上升高度/停留/渐隐） |
| 战斗表现调参重构 | 按需求将放缩、飞点、伤害数字参数统一归入“战斗表现”分类；并新增 `battleProjectileFlyMs`（飞点时长） |
| 触发细节修正 | 物品放缩锚点改为中心；CD 遮罩随物品放缩同步变化；multicast 多段触发时每段都会触发一次放缩 |
| 状态机制细化 | 灼烧/中毒/生命回复改为“物品触发时飞点，周期结算不飞点”；灼烧每0.5s结算且优先护盾并对盾减半；中毒每1s无视护盾直伤；生命回复每1s结算；直接治疗可按5%向上取整净化灼烧/中毒层 |
| 颜色统一 | 灼烧=橙色、中毒=深绿、生命回复/治疗=浅绿；血条文本与跳字增加黑色描边保证可读性 |
| 跳字规则修正 | 周期结算时：灼烧/中毒伤害与生命回复加血均显示对应颜色跳字（不再仅限敌方） |
| 玩法数值可调 | 新增“玩法数值”分组并接入战斗引擎覆盖：灼烧/中毒/生命回复结算间隔、灼烧对盾系数、灼烧衰减比例、治疗净化比例 |
| 阶段3增量 | 已完成“战斗日志面板（最近8条）”与“敌方配置化（按 day 读取配置敌方物品池）”；支持通过 `combat_runtime.enemyByDay` 控制敌方阵容来源 |
| 回店流程修复 | 修复“回到商店回到 Day1”问题：从战斗返回商店后自动推进到下一天（`setDay(currentDay + 1)`，上限 Day20） |
| 日志展示调整 | 按验收要求移除战斗内文本日志，改为仅输出控制台 `[BattleLog] ...` |
| 商店交互修复 | 背包按钮在“打开背包”状态改为黄色高亮（active=`0xffcc44`，inactive 保持蓝色 `0x44aaff`） |
| 商店交互修复 | 修复按钮字号热更新误用 `container.visible` 作为激活态：背包按钮未打开时保持蓝色，仅打开时显示黄色 |
| 阶段2合成规则收口 | 合成改为“命中目标才高亮/落手才触发”：仅拖到可合成目标物品时显示黄色，且合成判定优先于挤出并屏蔽挤出 |
| 阶段2合成补丁 | 修复网格拖拽合成缺失：背包↔背包、背包↔战斗区、战斗区↔战斗区在命中同装备同品质目标时均可合成；命中期间抑制挤出 |
| 合成表现收口 | 移除合成飞入动画链路；同步删除相关调参项（synthPauseMs/synthFlyMs/synthTitleFontSize/synthNameFontSize）及默认值配置 |
| 阶段2合成补丁 | 修复“初始背包物品”无品质元数据导致的单向合成异常：预置物品统一写入 Bronze tier，拖拽命中同物品同品质时双向都可合成 |
| 阶段2合成补丁 | 增加合成吞并淡出可调参数 `synthFadeOutMs`（默认120ms）：命中合成后拖拽物品按配置时长半透消失 |
| 阶段2合成补丁 | 恢复合成信息层（标题/名称/遮罩/图标）并取消飞入：改为整层按 `synthFadeOutMs` 直接淡出；恢复 `synthTitleFontSize/synthNameFontSize` 字号配置 |
| 阶段2合成补丁 | 合成动画时序改为“先显示再淡出”：新增 `synthHoldMs` 控制停留时长，`synthFadeOutMs` 控制淡出时长 |
| 阶段2合成补丁 | 合成信息层图标尺寸改为与物品一致：按 `targetSize × itemVisualScale` 计算展示宽高 |
| 文档同步 | 已将上述合成表现规则与可调参数同步写入 `design/dev_plan.md`（阶段2-合成表现规范） |
| 1D网格改造-P0（进行中） | 启动重大重构：尺寸规范切换为 `1x1/2x1/3x1`；`GridSystem/VirtualGrid/AutoPack` 改为单行语义；战斗区/背包基础列数改为 6，按天可见列改为 4/5/6 |
| 1D网格改造-P0（完成） | `ShopScene/BattleScene/GridZone/DragController` 完成单行与高格适配：格子高宽比改为 1:2、战斗/背包均 `1x6`、拖拽命中与高亮迁移到新尺寸 |
| 1D网格改造-P0（完成） | 测试体系已迁移到 1D 规则：`GridSystem.test` / `SqueezeLogic.test` 重写，`DataLoader/Combat` 测试同步更新 |
| 1D网格改造-P1（完成） | 修复战斗区/背包区居中：按可见列宽动态居中（不再受旧 5 列偏移影响） |
| 1D网格改造-P1（完成） | 商店物品改为“紧贴居中”布局；商店刷新增加总宽约束 `<=6`（杜绝同屏两个大型） |
| 1D网格改造-P1（完成） | 商店图标高度修正为单格高度（`CELL_HEIGHT`），与新格子纵横比一致 |
| 1D网格改造-P1（完成） | 修复商店左右溢出：移除卡片间距，三件物品总宽在 `itemVisualScale=5/6` 下严格不超 640 画布 |
| 1D网格改造-P1（完成） | 商店图标外框改为“向内描边”策略（与背包一致）：按描边宽度动态内缩 frameInset，避免描边外溢出框 |
| 1D网格改造-P1（完成） | 初始背包预置改为 `2小+1中`（占 4/6）：保留 2 格操作空间，避免开局满包影响拖拽/合成体验 |
| 1D网格改造-P1（完成） | 敌方生成规则重平衡：按天目标占宽 Day1-2=3、Day3-4=4、Day5+=5（不再直接按可见列数满铺） |
| 1D网格改造-P1（完成） | 商店/背包背景框改为内容自适应：随真实内容 bounds 动态贴合，避免固定宽高在不同日数/布局下偏大或偏小 |
| 1D网格改造-P1（完成） | 商店拖拽浮层缩放回归统一比例：取消 `*1.06` 放大，严格使用 `itemVisualScale(5/6)` 保持全界面尺寸一致 |
| 1D网格改造-P1（完成） | 新增战斗区背景框并改为内容自适应：与商店/背包视觉一致，随 activeColCount 动态贴合 |
| 1D网格改造-P1（完成） | 修复单行挤出方向异常：新增“优先回填拖拽来源 footprint”规则，解决中型由左向右拖拽时右侧 blocker 未回填左侧空位的问题 |
| 阶段切换准备 | 已完成 1D 网格与商店交互收口，准备继续推进阶段3战斗实现（规则细化 + 表现联动） |
| 阶段3规则细化-P1（进行中） | 战斗效果通道拆分：卡牌状态（冻结/减速/加速）与主角状态（伤害/护盾/治疗/灼烧/中毒/再生）分离，卡牌状态改为作用于物品充能层而非英雄层 |
| 阶段3规则细化-P1（进行中） | `CombatEngine` 新增卡牌状态持续时间（freezeMs/slowMs/hasteMs）与充能修正；`BattleScene` 状态投射支持目标为物品或英雄 |
| 阶段3规则细化-P1（进行中） | 卡牌控制效果从“仅标签存在即触发”升级为“按技能文案解析规格”执行：支持目标数量（N件/所有）、持续时长（秒）、目标阵营（己方/敌方） |
| Notebook 回填 | 已将今日实现总结回填至主程 Notebook（`WebJs开发指南`），并上传记录文档 `design/notebook_updates/2026-02-27_webjs_dev_update.md` |
| 商店刷新规则调整 | 取消按已持有品质过滤：允许刷新同物品其他品质；即使已持有钻石，仍可刷新出同物品钻石 |
| 背包购入规则调整 | 商店拖到背包按钮不再自动合成/自动整理；仅在背包有可见空位时放入，否则提示背包已满 |
| 验证方式 | `npm test` 全通过（45/45）；`npm run build` 通过 |
| Notebook 同步 | 已将今日开发总结写回技术 Notebook「WebJs开发指南」，来源文件：`design/notebook_updates/2026-02-27_webjs_dev_update.md` |
| iOS 打包发布（完成） | 将 `ios/project.yml` 的 `CURRENT_PROJECT_VERSION` 从 `2` 提升到 `3`，重新执行 archive + export + upload 全流程 |
| TestFlight 上传（完成） | 上传成功，`Delivery UUID: b1f38807-5a5f-49a2-ac49-5eb6e52d4ed2`；altool 返回 `No errors uploading archive at 'ios/build/export-testflight/BigBazzar.ipa'.` |
| 出口合规自动化（完成） | 在 `ios/project.yml` 增加 `ITSAppUsesNonExemptEncryption=false`，后续构建可自动声明“未使用受限加密”，避免每个 build 在 App Store Connect 手动点选 |
| Skill 同步（完成） | `~/.claude/skills/ios-web-packager` 已同步出口合规自动化：新增配置项与执行器逻辑，默认在打包前自动写入 `ITSAppUsesNonExemptEncryption=false`（支持 project.yml/Info.plist） |

---

## 各阶段完成情况

### ✅ 阶段 0：工程脚手架（100% 完成，验收通过）

- [x] Vite + TypeScript 初始化
- [x] PixiJS v8 安装（`pixi.js ^8.9.2`）
- [x] EventBus / DataLoader / GameLoop / SceneManager（含单元测试）
- [x] ShopScene / BattleScene 骨架，ItemDef 类型定义
- [x] WebGPU 优先（`preference: 'webgpu'`），控制台打印渲染后端
- [x] 分辨率 640×1384，`touch-action: none`，HMR WebSocket 修复
- [x] AppContext 单例（`src/core/AppContext.ts`），main.ts 调用 setApp

### ✅ 阶段 1：5×2 网格核心（100% 完成）

- [x] `src/grid/GridSystem.ts`：2D 数组 + canPlace + canPlaceExcluding + place / remove + getAdjacentItems + clear
- [x] `src/grid/GridSystem.test.ts`：20 个测试全通过
- [x] `src/grid/GridZone.ts`：PixiJS Container，格子线框 / 物品 Sprite（异步加载真实图片）/ 拖拽高亮（绿/红）/ 坐标转换 / 150ms 弹回缓动
- [x] `src/grid/DragController.ts`：长按 200ms / 死区 8px / setPointerCapture / 跨区域拖拽（battle ↔ backpack）
- [x] `src/scenes/ShopScene.ts`：接入两个 GridZone + DragController，预置测试物品
- [x] **浏览器视觉验收通过**：格子、图标、拖拽、弹回均正常

### ✅ 阶段 1 验收优化（100% 完成，验收通过）

| # | 优化内容 | 状态 | 实现说明 |
|---|----------|------|----------|
| 1 | 拖拽物品始终高于所有格子 | ✅ | DragController 新增 `dragLayer`，拖拽时物品从 GridZone 摘出、放入 dragLayer（stage 最顶层） |
| 2 | 移除长按，改为距离触发拖拽 | ✅ | 删除 200ms timer，移动 > `DRAG_THRESHOLD_PX=12px` 即进入拖拽，否则 onUp = tap |
| 3 | 拖拽时物品向上偏移（可配置） | ✅ | `DRAG_Y_OFFSET=-80px` 在 DragController 顶部常量，跟随坐标 `y + DRAG_Y_OFFSET - ph/2` |
| 4a | 小型/中型以手指中心定位，大型以左1/4定位 | ✅ | `pixelToCellForItem`：1x1/1x2 `anchorGx=globalX`（手指即中心），2x2 `anchorGx=globalX-CELL_SIZE/2`（左1/4）；Y：1x1 `floor(local.y/CELL_SIZE)`，1x2/2x2宽松检测+强制row=0 |
| 4b | 所有参数运行时可配置（调试页实时同步） | ✅ | 新增 `src/config/debugConfig.ts`（localStorage+BroadcastChannel），`debug.html` 紧凑调试页（每参数一行36px），参数修改即时同步游戏 |
| 5 | 1x2/2x2 强制从 row=0 放置 | ✅ | `finalRow = size !== '1x1' ? 0 : cell.row`，tryDrop 和 updateHighlight 均已处理 |

### ✅ 阶段 2：商店经济系统（100% 完成，用户确认完成）

- [x] `src/shop/ShopManager.ts`：纯逻辑层
- [x] `src/shop/ShopPanelView.ts`：视觉验收版重写
  - 物品按**实际格子尺寸**显示（1x1=128, 1x2=128×256, 2x2=256×256）
  - `onDragStart` 回调（拖拽购买，取代点击购买）
  - 金币/Day/刷新按钮 移至 ShopScene 按钮行
- [x] `src/shop/SellPopup.ts`：出售确认弹窗
- [x] `src/scenes/ShopScene.ts`：视觉验收版大幅更新
  - 按钮行：背包（左）| 刷新（中）| 出售（右），金币显示在刷新按钮下方
  - 背包小地图（5×2，黄=占用，暗=空位）显示在背包按钮下方
  - 拖拽购买：商店卡片拖到战斗区/背包按钮完成购买
  - 拖拽时战斗区+背包按钮闪光，背包按钮左右抖动
- [x] `src/grid/GridZone.ts`：补回 previewMoveToCell / snapPreviewBack 方法
- [x] 视觉统一优化（本次）：
  - 商店物品显示改为与背包一致（移除商店外层卡片框，仅保留底部名称/价格）
  - 全场景物品（商店/背包/战斗）统一显示品质外框（青铜/白银/黄金/钻石）
  - 修复商店大型物品尺寸：`2x2` 正确显示为 `256×256`
  - 按验收反馈将品质外框线宽加粗 2 倍（2px → 4px）
  - 品质描边宽度参数化：`tierBorderWidth`（页面布局可调，商店/背包/战斗区实时生效）
  - 修复背包展开时底部 HUD（刷新按钮/刷新费用/金币/出售）偶发被遮挡：切换时强制保持可见并置顶
  - 按新验收要求调整：打开背包时隐藏刷新按钮与刷新费用，关闭背包后恢复显示
  - 刷新费用与持有金币文本统一为金币图标 `💰`，并统一黄色显示
  - 修复持有金币动态刷新文案遗留旧图标：`refreshShopUI` 中 `🪙` 已统一替换为 `💰`
- [x] TypeScript 零报错，Vitest 全绿（最近记录 81/81 或 84/84），build 通过

### ✅ 阶段 2 验收优化（新增需求，已实现）

- [x] 合成触发改为“目标命中式”：仅当可合成商店物品拖到可合成目标物品上时显示黄色，并在落手后才执行合成
- [x] 背包按钮不再触发直接合成：拖到背包按钮只做放入背包；背包无空位时不可放入
- [x] 合成判定优先级高于挤出：命中可合成目标时不触发挤出逻辑
- [x] 商店刷新放开同物品品质限制：允许刷新出已持有物品的其他等级，且即使已持有钻石级也可继续刷新出同物品钻石级

### ⏳ 阶段 3：战斗引擎（进行中）

- [x] P0-1 CombatEngine 骨架（状态机 + Tick 循环 + battle:end 事件）
- [x] P0-2 快照实体化（BattleSnapshot -> CombatUnit）
- [x] P0-3 Shop -> Battle -> Shop 最小闭环（含回到商店按钮）
- [x] P0-4 规则对齐：100ms Tick、CD 读条、伤害流水线（基础/暴击/护盾/生命）、超时疲劳、Draw
- [ ] P1-1 基础技能/伤害规则细化（从占位伤害升级为可配置规则）
- [ ] P1-2 胜负结算与表现层事件联动（动画/飘字）

### ⏸ 阶段 4–6（未开始）

依次为：战斗引擎 → 物品效果 → 关卡进程 → UI 打磨

---

## 待解决问题

| 优先级 | 问题 | 说明 |
|--------|------|------|
| 🔴 高 | P0 战斗规则仍为占位实现 | 当前 CombatEngine 使用占位伤害模型（用于跑通闭环），需替换为正式技能/目标选择规则 |
| 🟡 中 | 1D 网格体验待实机验收 | 规则迁移与自动化已通过，但需你实机确认拖拽手感、挤出反馈与布局观感 |
| 🟡 中 | BattleScene 仍为调试表现 | 仅显示文本与返回按钮，尚未接入正式战斗表现层与动画事件消费 |
| 🟡 中 | 敌方生成为临时规则 | 敌方单位目前按 day/列数临时生成，后续需接入关卡数据配置 |

---

## 重要决定记录

| 日期 | 类型 | 决定内容 |
|------|------|----------|
| 2026-02-26 | 渲染 | WebGPU 优先，回退 WebGL |
| 2026-02-26 | 布局 | Canvas 640×1384，单格 128×128px |
| 2026-02-26 | 图片 | 直接使用真实图标，路径 `resource/itemicon/vanessa/{id}.webp` |
| 2026-02-26 | 布局 | Phase 1 商店场景：战斗区 y=790，背包区 y=1070 |
| 2026-02-26 | 架构 | GridZone（渲染）+ GridSystem（逻辑）+ DragController（输入）三层分离 |
| 2026-02-26 | 拖拽 | 长按 200ms 触发 / 死区 8px / setPointerCapture / 150ms cubic ease-out 弹回 |
| 2026-02-26 | 经济 | 品质权重：铜55%/银30%/金12%/钻3%；价格从 game_config 查表 |
| 2026-02-26 | 架构 | ShopManager（纯逻辑）+ ShopPanelView（PixiJS UI）+ SellPopup（弹窗）三层 |
| 2026-02-26 | 调试 | 新增商店区/战斗区/背包区位置调试参数（X/Y），通过 debugConfig + BroadcastChannel 实时同步 |
| 2026-02-26 | 交互 | 物品信息改为非模态上方浮层（可配置位置），点击空白关闭、点其他物品切换、拖拽开始自动隐藏 |
| 2026-02-26 | 调试 | 页面布局参数补齐：刷新按钮、出售按钮、背包按钮、金币文本、物品信息面板位置均可实时调试 |
| 2026-02-26 | 视觉 | 商店物品样式与背包统一；全场景按品质描边；商店大型物品修正为 2x2 |
| 2026-02-26 | 视觉 | 品质描边加粗 2x：商店与网格区统一改为 4px 提升辨识度 |
| 2026-02-26 | 视觉 | 全局装备显示缩放 = 5/6（item_visual_scale），用于统一缩小图标/底板并修复商店 3 个大型物品同屏展示 |
| 2026-02-26 | 调试 | 新增 `tierBorderWidth` 页面布局参数，支持运行时调整品质描边粗细 |
| 2026-02-26 | 交互 | 修复打开背包时刷新按钮被隐藏问题：切换背包后强制底部 HUD 可见并置顶 |
| 2026-02-26 | 交互 | 需求变更：打开背包时隐藏刷新按钮与刷新费用，避免背包视图干扰 |
| 2026-02-26 | 视觉 | 刷新费用与持有金币文案统一为 `💰` 图标且文字颜色统一黄色 |
| 2026-02-26 | 交互 | 商店支持轻触查看详情；商店拖拽时原位隐藏，结束后恢复或由刷新结果接管 |
| 2026-02-26 | 交互 | 选中态重构：商店/战斗/背包统一详情展示；仅战斗/背包选中时显示出售按钮并显示卖价 |
| 2026-02-26 | 交互 | 详情浮层自适应高度并限制水平不出屏；去掉“技能描述”标题；图标按品质描边 |
| 2026-02-26 | 调试 | 详情面板宽度加入页面布局可配置（itemInfoWidth），并允许贴屏左右边缘 |
| 2026-02-26 | 交互 | 详情面板改为始终水平居中，文本超长自动换行（名称/技能） |
| 2026-02-26 | 交互 | 详情面板改为左右分栏：左图标右文本；商店显示购买价，己方物品显示出售价 |
| 2026-02-26 | 架构 | 游戏内所有文本字号迁移到 game_config.text_sizes 配置，移除场景硬编码字号 |
| 2026-02-26 | 调试 | 文本字号调试项全部归入“页面布局”分组，避免混入“拖拽参数” |
| 2026-02-26 | 调试 | 页面布局下新增二级分组：界面位置 / 字体，参数分类更清晰 |
| 2026-02-26 | 调试 | 按验收要求移除“页面布局”父分组，改为三大平级分组：界面位置 / 字体大小 / 拖拽参数 |
| 2026-02-26 | 交互 | 详情面板名称后新增品质标签（青铜/白银/黄金/钻石），并支持独立字号调试 |
| 2026-02-26 | 规范 | 新增规则：所有新建文本字号必须同步 text_sizes + debugConfig + debugPage（字体大小分组） |
| 2026-02-26 | 交互 | Day 调试控件改为自适应布局：支持 Day10+ 文本宽度，左右箭头与文本间距加大 |
| 2026-02-26 | 机制 | 新增合成规则：同装备同品质可升一阶；商店刷新按已持有品质过滤，钻石持有后不再刷新该装备 |
| 2026-02-26 | 交互 | 合成新增全屏升级动画并飞入目标区域；补齐战斗区/背包可升级箭头提示动效 |
| 2026-02-26 | 交互 | 合成动画节奏与可见性优化：增加停留+飞入可调时长，升级箭头增强对比度与层级 |
| 2026-02-26 | 拖拽 | 挤出规则改为“悬停即提交”，移除挤出预览与回弹动画逻辑 |
| 2026-02-26 | 机制 | 挤出限制为区内，不允许战斗区/背包跨区挤出；商店购入战斗区冲突时可替换并转移到背包 |
| 2026-02-26 | 进度 | 阶段 2 用户确认完成；阶段 3 战斗引擎明天开工（需先完成 P0：数据源收敛 + Phase 输入锁） |
| 2026-02-26 | 计划 | 主程提出的战斗前置风险项调整为“阶段2.5加固”：Phase 输入锁 + 战斗快照边界 + 可见域读取 + AutoPack 节流/缓存 + 最小 UX 提示 |
| 2026-02-27 | 架构 | 输入锁先于战斗实现：以 `PhaseManager` 为单一 phase 来源，Shop 交互统一走 phase guard；DragController 增加可开关能力 |
| 2026-02-27 | 调试 | 在无战斗逻辑阶段开放 DEV 控制台接口 `__setGamePhase/__getGamePhase`，用于输入锁验收 |
| 2026-02-27 | 主程确认 | 已同步阶段2.5完成情况；主程结论：**可进入阶段3**。阶段3首批里程碑：P0（战斗状态机/快照实体化/核心循环），P1（基础攻击伤害/死亡退场/胜负判定/战斗事件总线） |
| 2026-02-27 | 阶段3-P0 | 新增 `CombatEngine` 并接入 `BattleScene`；Shop 点击“战斗”先生成快照再切场景，先打通最小战斗闭环 |
| 2026-02-27 | 主程Review | 阶段3-P0 首版评审通过：允许继续 P1。P0 无阻塞必改项；建议项：Tick 频率配置化、BattleScene 调试显示与正式表现层进一步解耦 |
| 2026-02-27 | 阶段3规则 | 依据设计稿对齐 P0：固定 Tick=100ms；Draw 不扣血（仅无胜场）；burn/poison/regen 每秒环境结算后置到 P1 |
| 2026-02-28 | 主程确认 | 阶段3-P1 先交付“基础伤害管线 + Poison + Freeze/Slow + 事件总线表现闭环”，其余状态/技能按同一流水线迭代填空；配置建议边实现边补齐并同步调参项 |

---

## 本次对话完成内容

### 本轮总结（按需求梳理）

**我们做了什么**

- 完成阶段 1 验收状态更新，阶段 2 持续做视觉与交互细化（缩放、布局、按钮优先级、详情面板、区域背景、Day 控件位置、圆角统一）。
- 商店经济接入按天数品质概率表（Day1~20）：新增 `shop_tier_chances_by_day` 并落地到 `ShopManager` 抽卡逻辑。
- 完成“可合成购买拖拽”优化：可合成时拖入战斗区/背包区任意落点即可触发合成（前提金币足够），并将高亮统一改为黄色。
- 完成拖拽交互增强：出售/背包按钮闪动提示、拖到出售按钮直接卖出、战斗区拖到背包按钮可直接转入背包。
- 完成视觉统一：商店/战斗区/背包/详情/拖拽浮层圆角统一；升级箭头放大并居中（含背包按钮箭头）。
- 补齐大量纯逻辑挤出测试：`SqueezeLogic.test.ts` 扩展到 75 条用例，覆盖不同尺寸、不同初始局面、可见列限制、local/cross、跨区互拖。

**遇到什么问题（含处理结果）**

- 详情字号异常：仅详情面板字体变小/不生效。根因是读取了错误 debug key；已修为 `itemInfo*FontSize` 并修复热更新链路。
- 详情文本换行异常：先赋文案后改 wrap 宽导致排版错误；已调整为先设置宽度/字号再赋值，并启用 `breakWords`。
- 2x2 战斗区挤出越界：中型拖动会把小型挤出可见列；已统一按 `activeColCount` 约束挤出与落点。
- 2x2 中型左右互换失败：local 可见性校验把“挤到 DRAG 原位”误判不可见；已修复并新增回归测试。
- 背景框“拉满仍有边缘”：定位为画布外 letterbox 区域，不属于场景内 Graphics；当前已支持框体宽高独立配置，若需全屏无边需改外层容器/CSS 适配策略。

**当前待验收风险点**

- 阶段 2 仍需浏览器最终验收：重点确认可合成拖拽（黄色提示 + 任意落点触发）、2x2 场景中型互换挤出、区域背景框视觉与配置联动。

**阶段 1 验收状态更新**

- 阶段 1（含验收优化）已全部验收通过，进度状态同步到本文件。

**阶段 2 视觉优化：装备缩放 + 商店大物品布局修复**

- 新增全局配置 `item_visual_scale=5/6`（`data/game_config.json`），用于统一缩小装备显示。
- `src/grid/GridZone.ts`：物品新增 `visual` 子层，按 `item_visual_scale` 缩放并居中留白；点击/拖拽 hitArea 保持占格尺寸不变。
- `src/grid/GridZone.ts`：拖拽落点高亮框同步按 `item_visual_scale` 缩小并居中。
- `src/shop/ShopPanelView.ts`：商店面板内容整体按 `item_visual_scale` 缩放；按物品占用列数累加布局，确保 3 个大型（2x2）同屏不溢出/不重叠。
- `src/shop/ShopPanelView.ts`：商店槽位位置改为固定 3 槽（每槽 2 格宽），不再因物品尺寸变化而自动向中心靠拢。
- `src/shop/ShopPanelView.ts`：小型(1x1)物品在 2 格高图标区内垂直居中（不再贴上）。
- `src/shop/ShopPanelView.ts`：调整为小型(1x1)在图标区内向下对齐（验收反馈优化）。
- `src/shop/ShopPanelView.ts`：商店选中框改为贴合物品图标区（与背包一致的贴合感）。
- `src/scenes/ShopScene.ts`：刷新按钮点击后不再切换为蓝色激活态，按钮初始/默认保持红色描边。
- `src/scenes/ShopScene.ts`：背包/刷新按钮主题色调整为蓝色，出售按钮主题色为红色。
- `src/scenes/ShopScene.ts`：金币不足时刷新价格文本显示红色。
- `src/config/debugConfig.ts` / `src/shop/SellPopup.ts` / `src/scenes/ShopScene.ts`：新增 itemInfoMinH（信息面板最低高度），并将信息面板在该区域内向下对齐（内容超出时向上扩展）。
- `src/shop/SellPopup.ts`：修复详情文本自动换行：开启 breakWords，并确保先设置 wordWrapWidth/字号后再赋值 text。
- `src/shop/SellPopup.ts`：修复字号运行中热更新：去重 setTextSizes，并在 setTextSizes 内触发布局重算。
- `src/config/debugConfig.ts`：修复运行中字号突然为 0 导致文本消失：getConfig/setConfig 统一按 def.min/max 做 clamp。
- `src/config/debugConfig.ts`：进一步修复字号异常变小：读取到越界值时回退 defaultValue 并清理 localStorage（不再 clamp 到 min）。
- `src/scenes/ShopScene.ts`：修复详情面板字号读取错 key 导致字号被设置为 1：统一使用 itemInfo*FontSize。
- `debug.html` / `src/debug/debugPage.ts`：移除“重置所有参数”按钮，避免误操作覆盖调参结果。
- `src/config/debugConfig.ts`：运行中读取/接收 debug 值统一 clamp（不再清理 localStorage），确保调参值稳定生效。
- `src/scenes/ShopScene.ts`：按钮可见性优先级调整为“出售 > 刷新”，两者不再同时出现；出售消失后再按刷新原逻辑判定显示。
- `src/config/debugConfig.ts` / `src/debug/debugPage.ts` / `src/scenes/ShopScene.ts`：新增 Day 控件位置参数 `dayDebugX/dayDebugY`，并接入实时布局更新。
- `src/grid/DragController.ts` / `src/scenes/ShopScene.ts`：新增网格拖拽特殊落点（出售按钮/背包按钮）与按钮闪烁提示：可出售时出售按钮闪烁；战斗区拖拽且背包未打开且有空位时背包按钮闪烁，并可拖到背包按钮直接转入背包。
- `src/config/debugConfig.ts` / `src/debug/debugPage.ts` / `src/grid/GridZone.ts` / `src/scenes/ShopScene.ts`：新增 `gridItemCornerRadius`，统一战斗区/背包格子背景与装备底框圆角，并支持运行时调参。
- `src/shop/ShopPanelView.ts` / `src/shop/SellPopup.ts` / `src/scenes/ShopScene.ts`：将商店图标框、商店选中框、商店拖拽浮层、详情图标框圆角统一接入 `gridItemCornerRadius`，实现全场装备相关圆角一致。
- `src/shop/ShopPanelView.ts` / `src/scenes/ShopScene.ts`：商店区左上角新增“商店”标题，并接入 `gridZoneLabelFontSize`，与“背包/战斗区”字号统一联动。
- `data/game_config.json` / `src/items/ItemDef.ts` / `src/core/DataLoader.ts` / `src/shop/ShopManager.ts`：新增并接入 `shop_tier_chances_by_day`（Day1~20 品质概率）；商店抽卡按天数概率表滚动，最高品质为钻石。
- `src/scenes/ShopScene.ts`：新增商店区与背包区浅色纯色背景（互斥显示），用于顶部视觉分区。
- `src/scenes/ShopScene.ts`：区域背景范围扩大为“整块罩住”（含标题与全部内容区域），贴合验收参考图。
- `src/config/debugConfig.ts` / `src/debug/debugPage.ts` / `src/scenes/ShopScene.ts`：新增并接入 `shopAreaBgWidth/shopAreaBgHeight/backpackAreaBgWidth/backpackAreaBgHeight`，可独立调商店/背包区域背景框宽高。
- `src/grid/DragController.ts`：修复阶段1挤出边界 bug：挤出落点与最终放置统一限制在可见列（activeColCount）内，避免 2x2 战斗区把小型物品挤出区域。
- `src/scenes/ShopScene.ts`：购买拖拽新增“可合成优先”落点规则：当商店物品可合成且金币足够时，拖入战斗区/背包区任意位置即可触发合成（无视空格限制，不新增占格）。
- `src/grid/GridZone.ts` / `src/scenes/ShopScene.ts`：可合成商店拖拽时，格子高亮统一改为黄色（覆盖原红/绿提示），强化“任意落点可合成”反馈。
- `src/grid/SqueezeLogic.test.ts`：新增大批挤出单测（74 总测例覆盖中的新增部分），覆盖不同初始格局、不同尺寸（1x1/1x2/2x2）、row0/row1、可见列限制(activeColCount)、local/cross 方案、跨区域互拖场景。
- `src/grid/GridZone.ts` / `src/shop/ShopPanelView.ts`：可升级箭头放大 2x，并改为居中于物品区域（战斗区/背包区/商店统一）。
- `src/scenes/ShopScene.ts`：背包按钮上的可升级箭头放大 2x 并移至按钮中心（保留轻微上下浮动动画）。
- `src/grid/SqueezeLogic.ts`：修复 2x2 可见列中中型左右互换失败问题：local 可见性校验不再错误地把“挤到 DRAG 原位”判为不可见；新增对应回归测试。
- `src/scenes/ShopScene.ts`：商店拖拽购买浮层同步按 `item_visual_scale` 缩放。
- `src/shop/SellPopup.ts`：出售浮层图标同步按 `item_visual_scale` 缩放。
- `src/scenes/ShopScene.ts`：战斗区/背包区 GridZone 背景整体按 `item_visual_scale` 缩小，位置按缩小后尺寸重新计算。
- `src/grid/DragController.ts`：适配缩放后的 GridZone：拖拽 reparent 保持世界缩放；放置锚点/区域中心计算考虑 scale。
- `src/shop/ShopPanelView.ts`：商店卡片新增“轻触=详情、移动超过 8px=拖拽”分流；拖拽时槽位临时隐藏。
- `src/scenes/ShopScene.ts`：商店物品轻触接入详情浮层；商店拖拽结束统一恢复槽位显示，避免“复制一份”观感。
- `src/shop/SellPopup.ts`：信息浮层改为纯展示（移除出售/关闭按钮），展示图标（按实际尺寸）、名称、出售价格、技能描述。
- `src/grid/GridZone.ts`：新增网格物品选中框（白色描边），支持 `setSelected(instanceId)`。
- `src/shop/ShopPanelView.ts`：新增商店槽位选中框与 `setSelectedSlot`。
- `src/scenes/ShopScene.ts`：
  - 选中商店物品：显示详情，隐藏出售按钮
  - 选中战斗/背包物品：显示详情 + 显示出售按钮及当前卖价，点击出售执行卖出
  - 点击空白或开始拖拽时清除选中态
- `src/shop/SellPopup.ts`（本轮补充）：
  - 浮层 `x` 坐标自动 clamp，避免左右出屏
  - 面板高度按技能文本自动增长（最小高度保底）
  - 去掉“技能描述”字样，仅展示技能内容
  - 图标外圈按物品当前品质（starting_tier）描边
  - 新增 `setWidth`，支持运行时动态调整信息面板宽度
- `src/config/debugConfig.ts`：新增 `itemInfoWidth` 调试参数
- `src/debug/debugPage.ts`：`itemInfoWidth` 已归入“页面布局”分组
- `src/scenes/ShopScene.ts`：布局应用链路接入 `itemInfoWidth`（与 itemInfoX/Y 同步热更新）
- `src/shop/SellPopup.ts`（本轮补充）：
  - 信息面板始终水平居中（X 不再受配置影响）
  - 名称与技能文本超长自动换行
  - 信息面板改为左右排布（左图标、右名称/价格/描述）
  - 支持价格文案模式：`购买价格` / `出售价格`
- `src/scenes/ShopScene.ts`：调用 `sellPopup.show` 时按来源传入价格模式（shop=buy，battle/backpack=sell）
- 文本字号配置化（本轮新增）：
  - `data/game_config.json`：新增 `text_sizes` 配置项（统一管理游戏内字体大小）
  - `src/items/ItemDef.ts`：`GameConfig` 增加 `textSizes` 类型定义
  - `src/core/DataLoader.ts`：接入 `text_sizes` 读取
  - `src/grid/GridZone.ts`、`src/shop/ShopPanelView.ts`、`src/shop/SellPopup.ts`、`src/scenes/ShopScene.ts`：全部文本字号改为从配置读取
- 在线 Debug 联动（本轮补充）：
  - `src/config/debugConfig.ts`：新增全部文本字号调试项（区域标题、按钮、商店文本、信息面板文本等）
  - `src/debug/debugPage.ts`：文本字号调试项全部加入 `页面布局` 分组（不在 `拖拽参数`）
  - `debug.html` + `src/debug/debugPage.ts`：页面布局下拆分二级子项 `界面位置` / `字体`
  - `debug.html` + `src/debug/debugPage.ts`：按最新验收移除 `页面布局` 父层，直接平铺为 `界面位置`、`字体大小`、`拖拽参数`
  - `src/scenes/ShopScene.ts`：接入字号热更新链路，运行中实时生效
- 品质标签与字体扩展（本轮新增）：
  - `src/shop/SellPopup.ts`：名称右侧新增品质标签（底色随品质变化）
  - `data/game_config.json`：`text_sizes` 新增 `itemInfoTier`
  - `src/config/debugConfig.ts`：新增 `itemInfoTierFontSize`
  - `src/debug/debugPage.ts`：`itemInfoTierFontSize` 已归入 `字体大小`
  - `src/scenes/ShopScene.ts`：接入 `itemInfoTierFontSize` 热更新
  - `CLAUDE.md`：补充强制规则——新增字体必须同步到 `text_sizes` + 在线 debug 字号配置
  - 修复：详情品质标签字号在首次选中时未应用 debug 值（show 阶段补齐 tier 字号赋值）
  - 优化：品质标签与名称间距提升到约 2 个字符宽度
  - 新增：小型(1x1)详情面板最低高度独立配置 `itemInfoMinHSmall`，可单独调短小型物品信息框
  - 布局修正：详情面板改为“下边缘对齐商店上边缘固定间距”（`itemInfoBottomGapToShop`）
  - 清理：移除无效调试项 `itemInfoX/itemInfoY`，避免出现在错误分组；位置调节统一由 `itemInfoBottomGapToShop` 控制
  - 优化：Day 控件箭头与文本改为动态排布，Day10+ 不重叠，左右间距更宽
  - 新增合成与提示：
    - `src/shop/ShopManager.ts`：接入 `setOwnedTiers`，刷新时按已持有品质过滤候选；已持有钻石则该装备不再刷新
    - `src/scenes/ShopScene.ts`：购买时若命中同装备同品质则直接合成升级（不落地第二件）；同步维护 `instanceToTier`
    - `src/scenes/ShopScene.ts`：计算可升级匹配关系，联动提示动画（商店槽位、战斗区物品、背包物品、背包按钮）
    - `src/grid/GridZone.ts` / `src/shop/ShopPanelView.ts`：新增“向上升级”半透明箭头滑动提示
  - 合成表现补强（本轮）：
    - `src/scenes/ShopScene.ts`：合成触发时新增全屏遮罩升级动画，图标飞入对应目标（战斗区或背包按钮/背包格）
    - `src/grid/GridZone.ts`：修复升级箭头层级（置于图标上层），确保战斗区/背包可见
  - 二次优化（本轮）：
    - `src/config/debugConfig.ts`：新增 `synthPauseMs`、`synthFlyMs`（归入拖拽参数）
    - `src/scenes/ShopScene.ts`：合成动画改为“停留 -> 飞入”，并按目标物品尺寸生成飞入图标
    - `src/scenes/ShopScene.ts`：合成完成后强制刷新目标区边框（确保显示升级后品质）
    - `src/grid/GridZone.ts` / `src/shop/ShopPanelView.ts` / `src/scenes/ShopScene.ts`：升级箭头提高透明度并加深色描边，显著增强可见性
  - 修复：合成全屏动画边框色改为“升级后品质色”（不再固定金色，避免青铜误显示为黄金）
  - 优化：合成标题品质显示改为中文（青铜/白银/黄金/钻石）
  - 配置补齐：合成全屏界面文字字号加入配置与在线调试（合成标题/合成名称）
  - 挤出规则重构（本轮）：
    - `src/grid/DragController.ts`：悬停冲突格时立即提交挤出（不再等待 delay）
    - `src/grid/DragController.ts`：取消“挤出预览回滚”链路，挤出提交后保持结果
    - `src/grid/DragController.ts`：拖拽失败改为直接归位（移除回弹补间动画）
  - 规则补充（本轮）：
    - `src/grid/DragController.ts`：跨区拖拽不再触发跨区挤出，仅允许目标区内挤出
    - `src/scenes/ShopScene.ts`：商店拖入战斗区时，若战斗区无法区内挤出但目标覆盖物可整体放入背包，则执行购买替换并转移这些物品到背包
    - `src/scenes/ShopScene.ts`：修复背包容量不足仍扣费购买 bug（先校验可放方案，再执行购买）
    - `src/scenes/ShopScene.ts`：战斗区可“替换后转移背包”时，拖拽悬停高亮与区域闪烁均视为可放置
  - 跨区互换兜底（本轮新增）：
    - `src/grid/SqueezeLogic.ts`：新增 `planCrossZoneSwap`，用于“直放失败 + 区内挤出失败”后的跨区互换判定
    - 互换规则按拖拽源 footprint 回填：
      - 拖 1x1：可回填 1 个 1x1
      - 拖 1x2：可回填 1 个 1x2 或 1~2 个 1x1
      - 拖 2x2：可回填 1 个 2x2，或 1~2 个 1x2，或 1x2+1~2 个 1x1，或 1~4 个 1x1
    - `src/grid/DragController.ts`：跨区拖拽（战斗区 ↔ 已打开背包）在挤出失败后新增互换判定与执行；高亮阶段同步显示可互换为可放置
    - `src/grid/SqueezeLogic.test.ts`：新增互换场景单测（1x1、1x2、2x2、失败场景）
  - 回归验证（本次对话）：
    - `npm test` 通过（81/81）
    - `npm run build` 通过（仅保留既有 chunk size warning）
  - 挤出可见列修正（本轮新增）：
    - `src/grid/DragController.ts`：高亮阶段优先使用 `planUnifiedSqueeze` 已判定的 local 方案提交挤出，不再二次用 `trySqueezePlace` 重新选路
    - 修复现象：中/小型拖拽到大型左右侧时，若另一侧仅有 1 列可用，也能正确触发挤出（不再误判需 2 列）
    - 回归验证：`npm test` 81/81、`npm run build` 通过
  - 验收切换（本轮临时）：
    - `src/scenes/ShopScene.ts`：将 `backpackView.setAutoPackEnabled(true)` 临时改为 `false`，用于对比验证“关闭 auto-pack 后的挤出/置换表现”
  - autoPackEnabled 路径清理（本轮）：
    - `src/grid/DragController.ts`：移除 `autoPackEnabled=true` 相关分支（拖拽兜底 auto-pack、高亮可放 auto-pack、小压中/大拦截），保留 auto-pack 体系代码在 `ShopScene` 中不变
    - 清理 `DragController` 中仅服务 `autoPackEnabled` 的私有函数与依赖导入
  - 大型侧向挤出规则（本轮新增）：
    - `src/grid/SqueezeLogic.ts`：新增“小/中拖拽命中大型左右半区”的定向规则
      - 命中大型左半区：仅检查右侧 1 列空位，可则大型右移 1 列
      - 命中大型右半区：仅检查左侧 1 列空位，可则大型左移 1 列
      - 命中该场景但对侧无 1 列空位：直接判定不可挤出
    - `src/grid/SqueezeLogic.test.ts`：新增对应 3 个回归测试（左半区成功、右半区成功、对侧无空位失败）
  - 回归验证（本次对话追加）：
    - `npm test` 通过（84/84）
    - `npm run build` 通过（仅保留既有 chunk size warning）
  - 挤出时机修复（本轮新增）：
    - 现象：战斗区 2x3 场景（中型+大型）中，拖动中型到另一侧时，悬停阶段不触发挤出，抬手后才挤出
    - 原因：`DragController.isSqueezePlanVisible` 校验 move 可见性时未排除“正在移动的 blocker 自身”，导致悬停校验误判失败
    - 修复：`src/grid/DragController.ts` 中可见性校验改为 `canPlaceInVisibleCols(..., excludeId=move.instanceId)`
    - 结果：悬停阶段即可正确提交挤出，不再延迟到拖拽结束
  - 仓库托管（本轮新增）：
    - 初始化本地 Git 仓库（`main`）并补充 `.gitignore`（忽略 `node_modules/`、`dist/`、`*.tsbuildinfo`、`.DS_Store`、`.claude/`）
    - 创建首个提交：`aaf8a01 chore: initialize bigbazzar project`
    - 在 GHE 创建远程仓库并推送：`https://habby.ghe.com/zhengtengfei-161/bigbazzar`（`main` 已跟踪 `origin/main`）

**进程1 挤出机制重构（DragController 大改）**

核心设计变更：挤出从「视觉预览+可还原」改为「延迟实际提交+不可还原」。

- `src/grid/DragController.ts` 重构要点：
  - **`dragOrigItem` 字段**：`enterDrag` 时记录 `{ col, row, size, defId }`，在 DRAG 被临时移出 system 后作为 fallback 数据源
  - **`squeezePreview.animated` → `committed`**：字段语义由”动画已播放”改为”数据已提交”
  - **计时器回调改为真实提交**：触发后临时 `system.remove(DRAG)` → 执行 squeeze moves（`system.remove/place` + `animateToCell`）→ 尝试 `system.place(DRAG, origPos)`（失败则 `doSnapBack` 处理极端情况）
  - **`clearSqueezePreview` 简化**：仅取消计时器 + 置 null，已提交的挤出不还原
  - **`tryDrop` 简化**：移除旧的 `previewMatchesDrop` 缓存逻辑，始终重新计算；`home.system.remove(id)` 幂等，兼容已提交/未提交两种状态
  - **`doSnapBack` 增强**：弹回目标改为从 `cellToLocal` 计算（移除 `origStageX/Y`）；检测 DRAG 是否在 system，若不在则扫描第一个空格放回，用 `snapToCellFromDrag` 更新 node 逻辑坐标
  - **`updateHighlight` 增强**：`item` 优先从 system 读，fallback 到 `dragOrigItem`，避免挤出提交后高亮失效
  - **`reset` 补充**：清除 `dragOrigItem = null`
- 移除死代码：`origStageX` / `origStageY` 字段（新 `doSnapBack` 不再需要）
- TypeScript 零报错

---

**阶段 2 验收优化（本轮）**

- 战斗区闪光颜色改为黄色（与背包按钮一致），闪光区域向外扩展 6px（视觉上略大于格子边框）
- 修复闪光层级：overlay 插入到拖拽浮层下方（`stage.addChildAt(overlay, floaterIdx)`），确保拖拽物品始终在最上层
- 修复大型物品（2x2）闪光误判：闪光可放置检测改为按 `GridZone.activeColCount` 约束，不再把未解锁列当作可用空位
- `src/scenes/ShopScene.ts` 新增 `canPlaceInVisibleCols / hasAnyPlaceInVisibleCols`，并复用到战斗区/背包闪光判定与拖拽高亮可放置判定
- 根因记录：此前直接调用 `battleSystem.canPlace`（system.cols=5），在 Day3（3列）会把隐藏列误判为可放置，导致“空位不足仍黄色闪动”
- 修复拖拽中出售按钮金额丢失：`drag.onDragStart` 内改为先计算 `sellPrice` 并调用 `setSellButtonPrice`，拖拽战斗区/背包物品时持续显示 `💰 xG`
- 修复战斗区/背包拖拽物层级：`DragController.enterDrag` 每次拖拽开始时将 `dragLayer` 重新 `stage.addChild` 置顶，确保被拖动物品高于底部 HUD（背包/出售/刷新按钮）
- 新增背包自动整理能力：`src/grid/AutoPack.ts` 引入回溯装箱（10格）算法，优先保留原位并在必要时整体重排，寻找可容纳新物品的布局
- 商店购买拖入背包（背包按钮/背包区）改为“自动整理后放入”：即使当前摆放无法直接放置，只要重排后可放即视为可放并执行
- 战斗区拖拽到背包按钮（背包未打开）改为“自动整理后转移”：通过 `drag.onSpecialDrop` 复用同一套自动整理逻辑
- 背包开启状态下，战斗区/背包拖拽落点判定支持 auto-pack：`GridZone.autoPackEnabled=true` + `DragController` auto-pack 分支，红/绿高亮与实际可放结果一致
- 购买拖拽闪光与背包区高亮联动 auto-pack：无直接空位但可整理时，仍显示背包可接收提示
- 新增“战斗区/背包底框边框宽度”调试项：`gridCellBorderWidth`（`debugConfig + debugPage + ShopScene` 联动），可运行时调节两区网格底框线宽
- `src/grid/GridZone.ts` 增加 `cellBorderWidth` 与 `setCellBorderWidth()`，格子绘制按线宽自动调整内缩，避免粗边框遮挡填充
- 修复背包内相邻物品边框视觉重叠：`GridZone` 物品品质描边按线宽自动向内收缩（并同步收缩图标显示区域），避免相邻物品描边“挤在一起”
- 区域描述文本对齐规则调整：商店/战斗区/背包标题统一按画布最左侧对齐（global X=0），并在战斗区日切换扩展动画过程中持续保持左对齐
- 文本配置命名更新：`gridZoneLabelFontSize` 在调试页显示名改为“区域描述文本”，商店/战斗区/背包共用同一字号配置
- 修复区域描述文本视觉字号不一致：`ShopScene.applyTextSizesFromDebug` 按容器缩放做字号补偿（`字号 / scale`），确保商店/战斗区/背包显示出来的实际字号一致
- 修复商店品质刷新逻辑：`ShopManager.rollPool` 改为“先按 Day 品质权重抽品质，再按 `available_tiers` 从可用物品池抽物品”，不再错误依赖 `starting_tier` 固定品质
- 支持同一物品按不同品质作为独立商店候选：去重键改为 `item.id:tier`，并为 `ShopSlot` 增加 `tier`
- 价格/出售按实际品质计算：`getItemPrice/getSellPrice/sellItem` 新增 tier 覆盖参数，购买价与卖价跟随实际抽到品质
- 展示与落地统一实际品质：商店卡片/拖拽浮层/信息弹窗按 `slot.tier` 显示；购买后用 `instanceToTier` 追踪实例品质并同步到战斗区/背包描边显示与出售价格
- 稀有度视觉强化（明显版）：
  - 黄金/钻石主色分离（暖金 vs 冷青）并统一到商店卡片、战斗区/背包物品框、拖拽浮层、信息面板
  - 钻石追加内层高亮描边（双层边框），与黄金形成显著形态差异
  - 战斗区/背包与商店卡片新增右上角稀有角标（`金` / `钻`），快速识别高稀有
- 根据验收反馈移除稀有角标：去掉商店卡片与战斗区/背包物品右上角 `金/钻` 标记，保留“颜色分离 + 钻石双层边框”方案
- 修复商店同屏重复物品规则：`ShopManager.rollPool` 去重改为按 `item.id`（不再按 `item.id:tier`），避免同次刷新出现“同一物品不同品质”
- 修复每日刷新价格重置：`ShopManager.setDay` 增加 `refreshIndex = 0`，切天后刷新价格回到首档（1G）
- 修复“商店拖拽到战斗区不触发挤出”问题：此前商店拖拽仅做 `canPlace` 直放判定，不走 `SqueezeLogic`，导致“左侧可挤出到右侧”场景错误显示红框且无法放置
- `ShopScene.onShopDragMove/onShopDragEnd` 接入 `trySqueezePlace`：高亮阶段按“直放或可挤出”判绿；落点阶段可挤出时先执行 blocker 位移动画与数据提交，再放入新购买物品
- 统一挤出入口：新增 `SqueezeLogic.planUnifiedSqueeze`（本区挤出 + 跨区域转移），`DragController` 与 `ShopScene` 统一改用该入口判定/执行
- 新增跨区域挤出：当目标区本地挤出失败时，允许将目标覆盖区 blocker 转移到另一网格区可见空位后再放置拖拽物
- 修复“背包内互拖不触发挤出”体验：`DragController` 调整优先级为“统一挤出优先，auto-pack 兜底”，避免 auto-pack 提前吞掉挤出路径
- 按验收需求改为“悬停立即挤出”：
  - `DragController` 跨区域挤出在高亮阶段即提交（不再等抬手）
  - 商店拖拽到战斗区在 `onShopDragMove` 即执行本地挤出/跨区转移，抬手仅完成购买落子
- 根因修复（拖拽原位占用）：`DragController.enterDrag` 进入拖拽即 `home.system.remove(instanceId)`，原位置立即视为空位，避免“仅松手后释放原位”导致的延迟换位
- 取消拖拽落位规则修复：同区已触发挤出时，取消优先回到“已提交挤出目标位”；否则回原位；原位被占再兜底找首个空位
- 挤出提交语义修复：悬停挤出后不再把拖拽物回填到原位（保持“拖拽物无占位直到落子/取消”）
- 合成可拖动提示修复：若商店物品可合成，`startFlashEffect` 强制战斗区+背包按钮同时闪动，视为均可投放
- 合成拖到战斗区高亮改色：`onShopDragMove` 中战斗区高亮对可合成物品使用黄色（普通物品仍维持“可放绿/不可放红”）
- 购买触发范围修复：`onShopDragEnd` 增加落点守卫，只有落在战斗区/背包区域（或背包按钮）才执行购买，避免非目标区域误购买
- 进一步修复可合成误购买：移除“可合成时背包区域任意点可购买”分支，背包仅接受“背包格子或背包按钮”落点；战斗区判定忽略隐藏区（`isPointInZoneArea` 增加 `view.visible`）
- 小型互换规则新增：`SqueezeLogic` 增加 1x1 上下相邻互换特例（同列上下拖拽优先互换）
- 小型挤出兜底增强：在横向策略失败后，新增“上下/斜向（另一行）”挤出作为最低优先级
- 挤出优先级增强：新增“任意布局重排兜底”策略（仅重排目标覆盖 blocker，预留拖拽物目标区域），保证“只要本区能容纳就优先挤出”
- 修复战斗区小型上下互挤失效：拖拽进入后 `system` 中已移除 DRAG，导致 `SqueezeLogic` 无法读取原位置；现为 `trySqueezePlace/planUnifiedSqueeze` 增加 `draggedOriginOverride`，`DragController` 传入 `dragOrigItem`，恢复战斗区上下互换判定
- 持续来回挤出修复：每次悬停提交挤出后，`DragController` 将 `dragOrigItem` 更新为当前目标位，保证后续继续拖动可基于“新位置”再次触发挤出/互换（不再只生效一次）
- 修复“商店小型拖入战斗区优先挤出”问题：`ShopScene` 战斗区购买判定改为统一走 `planUnifiedSqueeze`（优先 local 重排），避免 local 可解时误走“转移到背包”
- `planUnifiedSqueeze` 增强可见列 local 优先：在 cross 前新增“可见列内 blocker 重排”步骤，满足“只要本区可容纳就先本区挤出”
- 换位高亮色修正：执行换位/挤出路径时统一黄色高亮（`0xffcc44`），替代原绿色；普通可直接放置仍沿用原有颜色规则
- 单测覆盖更新：`src/grid/SqueezeLogic.test.ts` 新增互换与斜向挤出场景，并将“目标行全满”预期更新为可上下挤出
- 验证：`npm test` 通过（Vitest 81/81）
- 验证：`npm run build` 通过（TypeScript + Vite 生产构建成功）
- 回归验证（本次对话）：
  - 复跑 `npm test`：81/81 全通过
  - 复跑 `npm run build`：构建通过（保留既有 chunk size warning，无新增编译错误）

### 本次对话追加总结（阶段2收口 + 阶段3计划）

- 进度更新：按用户确认将阶段 2 标记为完成；阶段 3（战斗引擎）明天开工。
- 遇到的坑/问题（已在阶段2中处理并记录）：可见列误判、商店拖拽未接挤出逻辑、挤出悬停提交时机校验、DRAG 移出 system 导致原位丢失（用 `dragOrigItem` 兜底）、auto-pack 与挤出优先级冲突。
- 与主程讨论结论（阶段3架构）：CombatEngine（纯逻辑）+ PhaseManager（全局阶段机）+ CombatScene（表现编排）；GridSystem 提供 `exportSnapshot()` 将网格导出为纯数据供战斗计算。
- 风险与待优化（主程给出的 P0/P1）：
  - P0：收敛运行期状态为单一数据源（`GameState/ItemManager`），避免战斗读取 UI 中间态；实现 Phase + 输入锁，CombatPhase 禁用拖拽/商店/挤出。
  - P1：AutoPack 增加节流/缓存；GridSystem 补齐“仅可见列”的战斗实体读取接口；背包满/无法购买补最小 UI 反馈。

### 本次对话追加总结（iOS 打包）

- 方案确认：参考主程 Notebook 建议与 `pokemon-pinyin` 实战，采用 `SwiftUI + WKWebView + XcodeGen` 打包路径。
- Web 资源改造：`package.json` 新增 `build:ios-web`，以 `vite build --base ./ --outDir dist-ios` 生成 iOS 可加载静态资源。
- iOS 壳工程新增：
  - `ios/project.yml`（XcodeGen 配置）
  - `ios/BigBazzar/BigBazzarApp.swift`
  - `ios/BigBazzar/ContentView.swift`
  - `ios/BigBazzar/WebView.swift`（加载 `dist-ios/index.html`）
  - `ios/BigBazzar/Info.plist`
  - `ios/build.sh`、`ios/README.md`、`ios/ExportOptions.plist`
- Git 忽略补充：`.gitignore` 新增 `dist-ios/`、`ios/build/`、`ios/*.xcodeproj/`。
- 打包结果：
  - 模拟器构建并启动成功：`./ios/build.sh simulator`
  - 真机归档成功：`IOS_DEVELOPMENT_TEAM=6P57AJV77Q ./ios/build.sh archive`
  - IPA 导出成功：`ios/build/export/BigBazzar.ipa`
  - TestFlight 上传尝试：
    - 已完成 API Key 鉴权参数准备（Key ID: `6QLQ7HG556`，Issuer ID 已确认）
    - 上传失败原因为 App Store Connect 尚未存在 `bundleId=com.zhengtengfei.BigBazzar` 的 App 记录（`altool --list-apps --filter-bundle-id` 结果为空）
  - TestFlight 上传完成（本轮）：
    - 补齐 iOS 上传校验项：新增 `Assets.xcassets/AppIcon.appiconset` + `ASSETCATALOG_COMPILER_APPICON_NAME=AppIcon`，并将 `TARGETED_DEVICE_FAMILY` 调整为 `1`（iPhone）
    - 重新归档与导出后上传成功：`ios/build/export-testflight/BigBazzar.ipa`
    - Delivery UUID：`6bde46b3-f1b1-4f02-9d93-691e3f120eb7`
  - iOS 黑屏排查（本轮）：
    - 现象：启动后显示 `dist-ios/index.html 未找到`，包体仅约 220KB
    - 结论：归档时未携带 Web 静态资源（仅壳工程），常见于未先执行 `npm run build:ios-web` 或资源路径在 bundle 中被扁平化
    - 修复：`ios/BigBazzar/WebView.swift` 增加双路径加载（优先 `dist-ios/index.html`，其次 `index.html`）
    - 本机验证：`./ios/build.sh simulator` 重新生成并构建成功（`BUILD SUCCEEDED`）
  - iOS 资源拷贝修复（本轮）：
    - 根因确认：Xcode 产物中最初仅有壳文件，不含 `dist-ios/`，导致运行时找不到 `index.html`
    - 修复：`ios/project.yml` 新增 postBuildScript，将 `${SRCROOT}/../dist-ios` 显式复制到 app bundle 的 `dist-ios/`
    - 本机验证：Simulator 产物目录已包含 `BigBazzar.app/dist-ios/`，黑屏根因已解除
  - iOS 黑屏二次定位（本轮）：
    - 新发现：旧 `build.sh` 会从全局 DerivedData 随机取 `BigBazzar.app` 安装，容易装到旧壳包
    - 修复：`ios/build.sh` 改为固定使用 `ios/.derivedData` 构建与安装，并在安装前先卸载旧 bundle
    - 新发现：运行期图标路径原本使用绝对 `/resource/...`，在 `file://` 下会失效
    - 修复：新增 `src/core/assetPath.ts`，在 `file://` 场景自动切到相对路径；替换 `GridZone/ShopPanelView/SellPopup/ShopScene` 的图片加载入口
    - 资源补齐：`ios/project.yml` 的 postBuildScript 现同时复制 `dist-ios/` 与 `resource/` 到 app bundle
    - 验证：固定构建产物 `ios/.derivedData/Build/Products/Release-iphonesimulator/BigBazzar.app` 已包含 `dist-ios/` 与 `resource/`
  - iOS 黑屏三次定位（本轮）：
    - 修正资源路径：新增 `src/core/assetPath.ts`，`file://` 场景下图片路径由绝对 `/resource/...` 切换为相对路径（`../resource/...` 或 `./resource/...`）
    - 接入点：`src/grid/GridZone.ts`、`src/shop/ShopPanelView.ts`、`src/shop/SellPopup.ts`、`src/scenes/ShopScene.ts`
    - 规避旧静态资源污染：`ios/project.yml` 在 `sources` 中排除 `ios/BigBazzar/dist-ios/**`，仅保留 postBuild 拷贝链路
    - 启动可视化报错：`src/main.ts` 增加 `showFatalError`，启动异常将直接显示在页面，便于真机/模拟器排查
    - 验证：`npm test` 84/84 通过；`./ios/build.sh simulator` 构建并启动通过
  - iOS Xcode 联调增强（本轮）：
    - `ios/BigBazzar/WebView.swift` 注入 JS Bridge：采集 `window.error`、`unhandledrejection`、`console.log/warn/error` 到 Xcode 控制台（前缀 `[WKBridge]`）
    - 启用 `WKWebView.isInspectable`（iOS 16.4+）以支持 Safari Web Inspector 联调
  - iOS 黑屏四次定位（本轮）：
    - 假设命中 `file://` + `type=module crossorigin` 兼容问题，`ios/build.sh` 在生成 `dist-ios` 后自动移除 `index.html` 中 `crossorigin`
    - `WebView` 在 `didFinish` 后新增页面快照日志（脚本列表、`#app` 子节点数、是否出现 `canvas`），用于快速判定“HTML加载成功但 JS 未执行”
  - iOS 黑屏五次定位（本轮）：
    - 从日志确认 `didFinish/readyState=complete` 但 `hasCanvas=false`，定位到 `app://` 自定义协议下绝对路径资源解析错误
    - 修复：`LocalSchemeHandler` 解析 URL 时纳入 `host`（`app://resource/...` 与 `app://dist-ios/...` 均正确映射）
    - 修复：`src/core/assetPath.ts` 增加 `app:` 协议适配，图片路径改为 `app://resource/...`
  - iOS 图片与调参默认值治理（本轮）：
    - `ios/build.sh` 新增 Step 1.6：将 `resource/itemicon/vanessa/*.webp` 自动转为 `dist-ios/resource/itemicon/vanessa/*.png`（避免 WKWebView 对部分 WEBP 解码失败）
    - `src/core/assetPath.ts`：`app:` 协议改走 `app://dist-ios/resource/.../*.png`，Web 端继续走 `*.webp`
    - 新增项目级调参默认值文件：`data/debug_defaults.json`
    - `src/config/debugConfig.ts`：启动时读取 `data/debug_defaults.json` 覆盖 `CONFIG_DEFS.defaultValue`，并新增 `getConfigSnapshot()`
    - `debug.html` + `src/debug/debugPage.ts`：新增“复制配置”“保存为默认值”按钮，支持一键导出当前在线调参为 `debug_defaults.json`
    - 回归验证：`npm test` 84/84 通过；`./ios/build.sh simulator` 构建通过
  - 调参固化（本轮）：
    - 已读取你下载的 `~/Downloads/debug_defaults.json` 并写回项目 `data/debug_defaults.json`
    - 后续启动会默认使用这套初始调参值（若设备已有 localStorage 旧值，仍会优先命中缓存）
  - 调参与图片继续收口（本轮）：
    - `src/config/debugConfig.ts` 新增 `clearStoredConfig()`，清理 `bigbazzar_cfg_*` 本地缓存
    - `src/main.ts`：`app://` 启动时先清理调参缓存，确保读取 `data/debug_defaults.json` 作为本次初始值
    - `ios/BigBazzar/WebView.swift`：`LocalSchemeHandler` 增加资源请求日志（`[WK][asset]`）与缺失日志（`[WK][asset-missing]`），便于 Xcode 定位图片链路
    - 回归：`npm test` 84/84 通过；`./ios/build.sh simulator` 重新构建并安装完成
  - iOS 图片显示定位增强（本轮）：
    - `ios/BigBazzar/WebView.swift`：自定义协议响应改为 `HTTPURLResponse(200)`，附 `Content-Type` 与 `Access-Control-Allow-Origin`，二进制资源不再携带文本编码
    - `src/grid/GridZone.ts`、`src/shop/ShopPanelView.ts`、`src/shop/SellPopup.ts`、`src/scenes/ShopScene.ts`：图标加载失败不再静默，统一输出 `console.warn`（含 URL/物品 id）
    - 回归：`npm test` 84/84 通过；`./ios/build.sh simulator` 已重建最新包
  - 结果确认（本轮）：
    - Xcode 联调日志显示：`hasCanvas=true`、资源请求命中 `dist-ios/resource/...png`，图片已恢复显示
    - 在线调参默认值已按 `data/debug_defaults.json` 生效
  - TestFlight 更新（本轮）：
    - 初次上传被拒（`cfBundleVersion=1` 已存在）
    - `ios/project.yml` 将 `CURRENT_PROJECT_VERSION` 升为 `2`
    - 重新归档/导出/上传成功：Delivery UUID `3f45d9df-2ac5-4bd2-9a23-419db46ec08f`
  - 文档沉淀（本轮）：
    - 新增 `design/ios_packaging_postmortem.md`，系统总结 iOS 打包全流程问题、根因、修复映射、标准命令、发包验收清单与 Skill 化方案
  - Skill 落地（本轮）：
    - 新建独立纯净目录：`~/.claude/skills/ios-web-packager/`
    - 新增 `SKILL.md`（触发词、流程说明）
    - 新增可编辑网页：`web/config-editor.html`（必填校验，不满足则不给执行配置）
    - 新增配置模板：`config/packaging.config.template.json`
    - 新增执行脚本：`scripts/validate_config.py` + `scripts/run_packaging.py`
    - 目标：跨项目复用 Web->iOS 打包/导出/上传流程，避免再次手工排坑
  - Skill 交互体验升级（本轮）：
    - 新增一键交互流：`~/.claude/skills/ios-web-packager/scripts/assistant_flow.py`
    - 流程支持：自动生成默认配置 -> 自动打开网页 -> 自动采用 Downloads 最新配置 -> 自动校验 -> 询问执行步骤并自动执行
    - `run_packaging.py` 支持 `--step` 分步执行（all/build/xcodegen/archive/export/upload）
    - 新增 `adopt_downloaded_config.py` 自动搬运下载配置，降低“手动拷贝到指定目录”的复杂度
  - Skill 实战验证（本轮）：
    - 在 `~/Documents/web_ai_game/test2048` 从零创建 Web 版 2048（含 UI、键盘/触摸操作、资源图）并补齐 iOS 壳工程
    - 使用 `ios-web-packager` 配置与执行脚本完成打包验证：`validate_config -> run_packaging(all/export)`
    - 产物输出：`~/Documents/web_ai_game/test2048/ios/build/export-testflight/Test2048.ipa`
  - Test2048 发布推进（本轮）：
    - 已尝试上传 TestFlight，但被 ASC 拒绝：`Cannot determine the Apple ID from Bundle ID 'com.zhengtengfei.Test2048'`（说明 App Store Connect 尚未创建该 App 记录）
    - 已完成 GHE 仓库初始化与推送：`https://habby.ghe.com/zhengtengfei-161/test2048`，提交 `25bd4cb`
  - Test2048 发布收口（本轮）：
    - ASC App 创建后首次上传失败（缺少 `CFBundleIconName` 与 iPhone 120x120 图标）
    - 修复：补齐 `ios/Test2048/Assets.xcassets/AppIcon.appiconset` 全套图标 + `CFBundleIconName/CFBundleIcons`（`ios/project.yml`）
    - 重新 xcodegen + archive + export 后上传成功：Delivery UUID `2ab139fc-f230-4e36-be05-327fd6f0d2de`
    - 修复已提交并推送到 GHE：`b7a0577 fix: add required iOS app icon metadata for TestFlight`
  - Skill/经验回传（本轮）：
    - `ios-web-packager` 新增经验文档：`~/.claude/skills/ios-web-packager/TROUBLESHOOTING.md`
    - 已回传主程 Notebook：`iOS Web Packager Skill 与实战经验沉淀（2026-02-27）`（source id: `6b916b42-53c1-4fa1-a3a8-bd0c65576aa5`）

---

## 本次对话完成内容（阶段2.5 输入锁）

- 新增 `src/core/PhaseManager.ts`：提供 `getPhase/setPhase/setPhaseByScene/onChange/isShopInputEnabled`。
- 新增 `src/core/PhaseManager.test.ts`：覆盖默认阶段、事件触发、重复设置去重、场景映射。
- `src/scenes/SceneManager.ts`：`goto()` 时同步 phase（shop->SHOP，battle->COMBAT，result->REWARD）。
- `src/grid/DragController.ts`：新增 `setEnabled/isEnabled`，禁用时会清高亮并终止当前拖拽链路。
- `src/scenes/ShopScene.ts`：
  - 接入 `PhaseManager` 监听并应用输入锁；
  - 商店拖拽/网格点击/背包按钮/刷新/出售/Day 调试入口均加 phase guard；
  - phase 锁定时强制清理拖拽浮层与高亮，避免残留状态；
  - 新增“战斗/商店”切换按钮（phase toggle），在 COMBAT 时按钮文案自动切换为“商店”。
- 战斗态展示规则（本轮新增）：隐藏商店面板、背包面板、背包/刷新/出售按钮、金币与刷新费用、小地图、Day 调试控件，仅保留战斗区与 phase toggle 按钮。
- phase toggle 按钮样式调整：由圆形改为圆角矩形（宽约为普通圆按钮 2 倍、高度与圆按钮直径一致），满足战斗态主操作按钮识别需求。
- 阶段2.5-#1（战斗快照边界）已完成：
  - `GridSystem` 新增 `getCombatEntities(activeColCount)` 与 `exportCombatSnapshot(activeColCount)`；
  - `ShopScene` 在 phase 切换到 COMBAT 时生成并缓存 `BattleSnapshotBundle(day/activeColCount/createdAtMs/entities+tier)`，切回 SHOP 或 onExit 清空；
  - `BattleScene` 临时接入快照读取日志，验证链路可用。
- 阶段2.5-#2（仅可见列读取）已完成：
  - 战斗实体导出统一基于 `activeColCount` 过滤（含 2x2 跨边界排除）；
  - 补充 GridSystem 单测覆盖可见列过滤与快照隔离性。
- 阶段2.5-#3（AutoPack 节流/缓存）已完成：
  - `ShopScene` 新增 AutoPack 结果缓存（签名=背包状态+incoming/transfer 载荷+可见列）与节流窗口；
  - 缓存命中返回深拷贝，防止外部修改污染缓存；
  - 新增调参项 `autoPackThrottleMs`（默认 50ms）并接入调试页；
  - 在背包重排/转移落地与场景退出时清理缓存，避免陈旧条目累积。
- 阶段2.5-#4（最小 UX 提示）已完成：
  - `ShopScene` 新增轻量 toast 提示层（短时显示）；
  - 覆盖路径：金币不足无法购买、金币不足无法刷新、背包已满无法购买、背包已满无法转移；
  - COMBAT 阶段自动隐藏提示层，避免遮挡战斗视图。
- 阶段2.5-#4 验收修正（本轮）：
  - 修复 toast 层级问题：展示时强制置顶，避免被 UI 覆盖导致“看不到提示”；
  - 修复“金币不足时无法点卡片看详情”：商店卡片改为“可点击查看详情但不可拖拽购买”（不可负担时禁用拖拽阈值触发，保留 tap）。
  - 新增 Debug 配置分组“Toast 显示”（checkbox）：支持总开关与四类失败提示独立开关（金币不足-购买、金币不足-刷新、背包满-购买、背包满-转移）。
- 调试工具链优化（本轮）：
  - `保存为默认值` 支持自动写入项目文件：debug 页点击后优先调用本地 dev 接口写入 `data/debug_defaults.json`；
  - 当接口不可用时自动回退为下载 `debug_defaults.json`（手动替换）；
  - Vite 新增 `__debug/save-defaults` 开发期中间件（仅 dev server 生效）。
- 阶段3-P0 验收问题修复（本轮）：
  - 修复“BattleScene 读取不到快照”：Shop->Battle 切场景时不再在 Shop onExit 清空 battle snapshot；
  - 修复“回到商店后重置初始状态”：新增 Shop 运行态保存/恢复（金币、天数、商店池、战斗区/背包区摆放、实例 tier），实现 battle 往返不丢进度。
- 调参项补齐（本轮新增）：
  - `data/game_config.json` 的 `text_sizes` 新增 `phaseButtonLabel`；
  - `src/config/debugConfig.ts` 新增 `phaseBtnX/phaseBtnY/phaseButtonLabelFontSize`；
  - `src/debug/debugPage.ts` 已将上述键归入“界面位置/字体大小”分组。
- `src/main.ts`：DEV 环境注入 `window.__setGamePhase(phase)` / `window.__getGamePhase()` 便于在无战斗逻辑下验收输入锁。

**本次验证结果**

- `npm test` 通过（91/91）
- `npm run build` 通过（保留既有 chunk size warning）

### 本次对话追加（设计师 Notebook 敌方阵容查询）

- 已按“设计师=NotebookLM”约定，查询设计师 Notebook（`auto-battler-design-lab`）并拉取敌方阵容建议。
- 覆盖区间：Day1-3、Day4-7、Day8-12、Day13-20；已获取每个区间的候选阵容及物品中文名+数量。
- 本次查询未发生超时；可继续按需求二次追问（如“每个区间仅保留 1 套标准阵容”或“按掉落池可实现性过滤”）。
- 阶段状态不变：仍处于阶段 3 战斗引擎（进行中），本次为设计数据检索支持。

### 本次对话追加（Vanessa 物品库约束池）

- 已使用设计师 Notebook（`auto-battler-design-lab`）按要求产出 4 个区间池：Day1-3、Day4-7、Day8-12、Day13-20。
- 输出格式按 pool 提供，内容仅保留中文物品名，不包含其他英雄名或抽象敌人命名。
- 已对返回物品名执行 `data/vanessa_items.json` 存在性校验，当前结果全部命中（missing=0）。

---

### 本次对话追加（图标切图产物验收辅助）

- 已对 `~/Downloads/icon` 目录的 38 张图标产物做尺寸巡检，当前尺寸分布与预期规格一致（128x256 / 256x256 / 384x256）。
- 新增 `~/Downloads/icon/_manifest.json`：记录每张图标文件名、宽高与占位标记，便于后续程序化校验。
- 新增 `~/Downloads/icon/_review_sheet.png`：4 列总览审图图，便于快速人工验收命名与裁切边界。
- `活体甲壳.png` 维持占位标记（placeholder=true），待你确认真实源图后替换。

### 本次对话追加（图标两步法重导出）

- 按你的新规则改为两步产物：
  - 第一步：仅做“完整物件截取（去透明边）”，不做目标分辨率约束。
  - 第二步：基于第一步结果做“等比缩放 + 空白补齐”到目标分辨率（保持宽高比不变）。
- 输出目录：
  - `~/Downloads/icon_step1_raw`（第一步原始截取）
  - `~/Downloads/icon_step2_target`（第二步目标尺寸）
- 两个目录均包含：
  - 37 张图标 PNG（排除了 `_review_sheet.png` 这类非图标辅助文件）
  - `_manifest.json`（记录 step1 尺寸、目标尺寸、fit 后尺寸、四边补白像素）
- 新增两份审图图：
  - `~/Downloads/icon_step1_raw/_review_step1.png`
  - `~/Downloads/icon_step2_target/_review_step2.png`
- 修复：针对你反馈“第一步下半部分被截掉”，已改为直接基于原始大图 `20260227-173602.png` 重新做完整物件提取（不再从旧裁切结果二次处理）。
- 提取策略更新：先识别主连通域（37 个主物件）并聚合附近小碎片，得到完整包围框后再输出第一步；第二步再执行等比缩放+透明补齐到目标尺寸。
- 已重新生成上述两个目录与审图图，请以新的 `~/Downloads/icon_step1_raw/_review_step1.png` 复核是否仍有截断。

### 本次对话追加（审图图去中文）

- 按需求将审图图片中的中文名称全部移除，改为英文编号标签（`Item 01...`）+ 尺寸文本。
- 已更新：
  - `~/Downloads/icon_step1_raw/_review_step1.png`
  - `~/Downloads/icon_step2_target/_review_step2.png`
  - `~/Downloads/icon/_review_sheet.png`

### 本次对话追加（切图时去除源图中文碎片）

- 按反馈修正切图识别逻辑：提取时仅使用源图的“图标行”区间（排除文字行区间），避免把中文标注碎片并入物件。
- 行区间自动识别结果：`(2-135) (170-335) (353-479) (526-647) (688-813) (858-1016)`。
- 已据此重新生成：
  - `~/Downloads/icon_step1_raw`（完整物件截取，中文碎片已去除）
  - `~/Downloads/icon_step2_target`（等比缩放+透明补齐）
- 审图图已同步刷新为最新结果：
  - `~/Downloads/icon_step1_raw/_review_step1.png`
  - `~/Downloads/icon_step2_target/_review_step2.png`

### 本次对话追加（中文残留二次清洗）

- 根据你指出的残留样例，新增“底部文字残留”清洗规则：
  - 对每张 step1 图做连通域分析，保留主图标连通域；
  - 删除位于主图标下沿附近、低高度的小连通域（典型中文描边文本特征）；
  - 再由清洗后的 step1 重新生成 step2（等比缩放 + 透明补齐）。
- 自动复检结果：`icon_step1_raw` 已无“主图标下方小文字连通域”残留告警。
- 审图图再次刷新：
  - `~/Downloads/icon_step1_raw/_review_step1.png`
  - `~/Downloads/icon_step2_target/_review_step2.png`

### 本次对话追加（命名与内容错位修复）

- 重新基于源图做组件提取并改为 38 个独立图标候选（阈值 `area>=2500`，避免文字碎片并拆开误合并项）。
- 使用旧命名产物做视觉相似度一对一匹配（Hungarian 分配）重建名称映射，避免“按字典序硬对位”导致的错名。
- 将未命名剩余组件补齐为 `粘液球.png`，并按目标规则输出两步结果：
  - `~/Downloads/icon_step1_raw`（原始完整截取）
  - `~/Downloads/icon_step2_target`（等比缩放 + 透明补齐）
 - 两目录均已更新 `_manifest.json`（含 `component_index/source_bbox/match_similarity`），并刷新审图图。

### 本次对话追加（替换物品配置与 PNG 图标）

- 已将 `~/Downloads/newitem_data.json` 替换为 `data/vanessa_items.json`，并适配新 JSON schema：`src/core/DataLoader.ts` 增加 normalize，缺省字段补齐，且从技能中文里做基础数值推导（damage/multicast 等）以保持 CombatEngine 可跑通（`[待主程确认]`：数值推导规则是否需要更严格的结构化字段）。
- 已将新图标从 `~/Downloads/newitem/*.png` 复制并按物品 id 重命名到 `resource/itemicon/vanessa/{id}.png`（共 37 张）。
- 图标加载链路改为统一 PNG：`src/core/assetPath.ts` Web 与 iOS 均走 `.png`。
- iOS 打包脚本兼容 PNG 源资源：`ios/build.sh` Step 1.6 先 copy `*.png`，再把遗留 `*.webp` 转为 `*.png`（若同名 png 已存在则跳过转换）。
- 回归验证：`npm test` 全绿（46/46），`npm run build` 通过；执行 `./ios/build.sh open` 已成功生成 `dist-ios` 并完成资源拷贝/转换。

### 本次对话追加（物品图标底色修正）

- 修复物品图标出现绿色/蓝色底色问题：底色来自 `GridZone` 的物品框 fill（按尺寸染色）。现改为近乎透明的黑色 fill（仅为保证 stroke 稳定渲染），不再对图标产生明显染色。
- 变更文件：`src/grid/GridZone.ts`；回归：`npm test` 通过（46/46）。

### 本次对话追加（高亮圆角与区域背景）

- 拖拽提示框（绿/红/黄高亮）圆角已与装备圆角一致：`GridZone.highlightCells` 从 rect 改为 roundRect 并按 `gridItemCornerRadius` 对齐。
- 背包/战斗区格子背景改为“整块底板 + 弱分隔线”，不再按每格分别填充圆角底色（`[待设计确认]`：分隔线强度与是否完全去格线）。
- 变更文件：`src/grid/GridZone.ts`；回归：`npm test` 通过（46/46）。

### 本次对话追加（商店/战斗区背景横向延伸到屏幕外）

- 渲染适配改为：Canvas 全屏（`app.renderer` resize 到 `window.innerWidth/innerHeight`），stage 按设计分辨率 `640×1384` 等比缩放并居中；留白区域仍在同一 canvas 内，可用于绘制横向延伸背景。
- `ShopScene` 的商店/战斗区/背包区域背景改为按当前 viewport 的 `bleedX` 向左右延伸（超出 640 设计宽度），实现“背景左右出屏”。
- 变更文件：`index.html`、`src/main.ts`、`src/core/AppContext.ts`、`src/scenes/ShopScene.ts`；回归：`npm test` 通过（46/46），`npm run build` 通过。

### 本次对话追加（移除商店/背包/战斗区半透背景）

- 按需求移除商店/背包/战斗区的半透明底板遮罩（保留网格区域本体与分隔线/描边）。
- 变更文件：`src/scenes/ShopScene.ts`；回归：`npm test` 通过（46/46）。

### 本次对话追加（修复拖拽浮层起始位置偏移）

- 修复商店拖拽浮层从偏高位置出现：原因是 stage 做了缩放居中后，之前直接使用 `e.globalX/Y`（全屏坐标）去设置 stage 子节点坐标，导致位置被二次缩放/偏移。
- 修复方式：商店拖拽浮层定位改为 `stage.toLocal(e.global)`；同时修正 DragController 的拖拽坐标系（内部用 stage local 计算与摆放，但对外/投放判定使用 stage.toGlobal 后的 anchor 全局坐标）。
- 同步修复合成目标/按钮命中：`ShopScene` 的区域命中与物品命中改为使用 `toGlobal` 计算（全局坐标），不再假设 stage=640×1384。
- 变更文件：`src/scenes/ShopScene.ts`、`src/grid/DragController.ts`；回归：`npm test` 通过（46/46）。

### 本次对话追加（拖拽浮层仅显示图标）

- 按需求调整“拖动中的物品”视觉：拖拽浮层不再渲染边框与背景，仅保留物品图片本体。
- 覆盖范围：商店拖拽购买浮层（ShopScene 自绘 floater）+ 网格区拖拽（GridZone detach 的节点在拖拽期间隐藏 bg/选中/升级箭头，落下/弹回恢复）。
- 变更文件：`src/scenes/ShopScene.ts`、`src/grid/GridZone.ts`；回归：`npm test` 通过（46/46）。

### 本次对话追加（换位高亮回归绿色）

- 按需求调整背包/战斗区拖拽换位高亮：可放置/可挤出的有效落点统一显示绿色；仅“合成升级目标”保留黄色高亮。
- 变更文件：`src/grid/DragController.ts`、`src/scenes/ShopScene.ts`；回归：`npm test` 通过（46/46），`npm run build` 通过。

### 本次对话追加（按钮字号统一与新增配置）

- 底部按钮（背包/战斗/刷新）字号配置位置：`shopButtonLabelFontSize` 与 `phaseButtonLabelFontSize`（`data/debug_defaults.json` 默认值 + `src/config/debugConfig.ts` 定义 + `src/debug/debugPage.ts` 展示）。
- 已将默认值统一：`data/debug_defaults.json` 中 `phaseButtonLabelFontSize` 调整为与 `shopButtonLabelFontSize` 一致（28）。
- 新增战斗结算页“回到商店”字号配置：`battleBackButtonLabelFontSize`（同步到 `data/game_config.json:text_sizes.battleBackButtonLabel` + `src/items/ItemDef.ts` 类型 + `src/config/debugConfig.ts` + `src/debug/debugPage.ts` + `src/scenes/BattleScene.ts` 使用）。
- 回归：`npm test` 通过（46/46），`npm run build` 通过。

### 本次对话追加（字号 4 倍数约束 + Day 字号刷新复位修复）

- 新增规则落地：所有 `*FontSize` 配置值统一量化为 4 的倍数（`src/config/debugConfig.ts`），并将字号类滑块 `step` 调整为 `4`。
- 同步文本默认值为 4 倍数：`data/game_config.json` 的 `text_sizes` 已调整为 4 倍数方案（含 `battleBackButtonLabel` 等）。
- 修复 Day 字号“刷新后重置”：根因是 Day 调试文字控件创建晚于首次 `applyLayoutFromDebug()`，导致初次进入使用了 `game_config` 默认字号；现已在创建 Day 控件后追加 `applyTextSizesFromDebug()`，确保刷新后仍应用 Debug 配置。
- 变更文件：`src/config/debugConfig.ts`、`data/game_config.json`、`src/scenes/ShopScene.ts`；回归：`npm test` 通过（46/46），`npm run build` 通过。

### 本次对话追加（Day 文本居中修正）

- 修复 Day 控件中“Day N”未居中：`layoutDayDebugControls()` 改为使用左右等宽箭头槽位布局（按左右箭头最大宽度留位），并增加垂直中线对齐。
- 变更文件：`src/scenes/ShopScene.ts`；回归：`npm test` 通过（46/46）。

### 本次对话追加（Day 文本全局居中修正）

- 进一步修复“Day N”看起来仍偏移：将 Day 容器定位改为画布中心 `CANVAS_W / 2`，并把容器 `pivot.x` 锚到 Day 文本中心（非整组宽度中心），确保视觉中心严格对齐。
- 变更文件：`src/scenes/ShopScene.ts`；回归：`npm test` 通过（48/48）。

### 本次对话追加（Day 首帧左偏修正）

- 修复 Day 首次进入仍偏左：根因是 Day 容器创建时仍使用旧的 `dayDebugX`（260），直到后续配置变更才会触发重排。
- 现已在创建时直接使用画布中心 `CANVAS_W / 2`，与后续布局逻辑保持一致。
- 变更文件：`src/scenes/ShopScene.ts`；回归：`npm test` 通过（50/50）。

### 本次对话追加（品质/战斗效果颜色可配置）

- 按流程先与主程/设计师 Notebook 对齐方案：确定“青铜再暗一点”并新增网页调色配置，覆盖四品质 + 战斗效果（生命值/护盾/灼烧/中毒/回复）。
- 新增统一颜色读取模块：`src/config/colorPalette.ts`，渲染层统一通过 `getTierColor/getBattleEffectColor` 取色，避免多处硬编码。
- 新增调参项（支持保存到 `debug_defaults.json`）：`tierColorBronze/Silver/Gold/Diamond`、`battleColorHp/Shield/Burn/Poison/Regen`（`src/config/debugConfig.ts` + `data/debug_defaults.json`）。
- 调试页新增“颜色配置”分组与色盘输入：支持 `input[type=color]` + `#RRGGBB` 文本输入与重置（`debug.html` + `src/debug/debugPage.ts`）。
- 渲染层接入统一颜色：`GridZone`、`ShopPanelView`、`SellPopup`、`ShopScene` 的品质边框改为可配置；`BattleScene` 的生命值/护盾/灼烧/中毒/回复相关血条/跳字/飞点改为统一可配置。
- 回归：`npm test` 通过（50/50），`npm run build` 通过。

### 本次对话追加（生命值血条色与文字色拆分）

- 按需求将“生命值血条颜色”与“生命值文字颜色”拆分为独立配置项：`battleColorHpBar`、`battleColorHpText`。
- 调试页“颜色配置”分组已新增两项，支持色盘与 Hex 文本输入。
- 战斗渲染接入：血条填充读取 `battleColorHpBar`，生命值数字读取 `battleColorHpText`；原 `battleColorHp` 继续用于生命值伤害相关跳字/飞点。
- 变更文件：`src/config/debugConfig.ts`、`src/config/colorPalette.ts`、`src/debug/debugPage.ts`、`data/debug_defaults.json`、`src/scenes/BattleScene.ts`。

### 本次对话追加（战斗飞出小球颜色可配置）

- 按需求在“颜色配置”中新增战斗飞出小球颜色项：`battleOrbColorHp/Shield/Burn/Poison/Regen/Freeze/Slow`。
- 新增统一读取方法 `getBattleOrbColor()`（`src/config/colorPalette.ts`），并在 `BattleScene` 的伤害/护盾/回复/状态施加飞点全部接入，不再使用硬编码颜色。
- 调试页已接入上述颜色键（色盘 + Hex 输入）；默认值写入 `data/debug_defaults.json`。
- 变更文件：`src/config/debugConfig.ts`、`src/config/colorPalette.ts`、`src/debug/debugPage.ts`、`data/debug_defaults.json`、`src/scenes/BattleScene.ts`；回归：`npm test` 通过（50/50），`npm run build` 通过。

### 本次对话追加（补齐小球色-加速配置）

- 补充遗漏的“加速”飞出小球颜色配置：新增 `battleOrbColorHaste`，并接入颜色配置页。
- 战斗状态施加飞点映射补齐：`status=haste` 时使用 `getBattleOrbColor('haste')`。
- 变更文件：`src/config/debugConfig.ts`、`src/config/colorPalette.ts`、`src/debug/debugPage.ts`、`data/debug_defaults.json`、`src/scenes/BattleScene.ts`。

### 本次对话追加（战斗跳字颜色可配置）

- 修复“普通攻击伤害跳字偏白”诉求：新增 `battleTextColorDamage`，默认红色（`#EF4444`），并用于普通攻击伤害跳字。
- 跳字颜色扩展为可配置：`battleTextColorDamage/Shield/Burn/Poison/Regen`，统一出现在“颜色配置”分组。
- BattleScene 跳字渲染改为统一读取 `getBattleFloatTextColor()`；与小球颜色配置解耦，支持独立调色。
- 变更文件：`src/config/debugConfig.ts`、`src/config/colorPalette.ts`、`src/debug/debugPage.ts`、`data/debug_defaults.json`、`src/scenes/BattleScene.ts`。

### 本次对话追加（预留暴击跳字 + 跳字字号可配置）

- 预留暴击跳字颜色：新增 `battleTextColorCrit`，并在普通伤害事件里按 `isCrit` 分流（暴击走 crit 色，普通走 damage 色）。
- 跳字字号可配置：新增 `battleTextFontSizeDamage`、`battleTextFontSizeCrit`；普通/状态伤害跳字与暴击跳字分别读取。
- 为满足“新建字号同步”约定：已同步到 `data/game_config.json:text_sizes`（`battleTextDamage`、`battleTextCrit`）与 `src/items/ItemDef.ts` 类型定义，并在调试页“字体大小”分组展示。
- 变更文件：`src/config/debugConfig.ts`、`src/config/colorPalette.ts`、`src/scenes/BattleScene.ts`、`src/debug/debugPage.ts`、`data/debug_defaults.json`、`data/game_config.json`、`src/items/ItemDef.ts`；回归：`npm test` 通过（50/50），`npm run build` 通过。

### 本次对话追加（跳字正负号格式）

- 跳字文本格式按需求统一：伤害类显示 `-x`，增益类显示 `+x`。
- 已接入 BattleScene：普通/灼烧/中毒伤害跳字改为 `-amount`；护盾/回复跳字改为 `+amount`。
- 变更文件：`src/scenes/BattleScene.ts`。

### 本次对话追加（护盾条与血条重叠显示）

- 按需求调整战斗 HUD：护盾条改为半透明覆盖在血条上方（与血条重叠），不再绘制在血条外侧。
- 变更文件：`src/scenes/BattleScene.ts`。

### 本次对话追加（护盾条高度与血条一致）

- 按需求将护盾条高度从细条改为与血条等高；仍保持半透明覆盖显示。
- 变更文件：`src/scenes/BattleScene.ts`。

### 本次对话追加（物品面板 CD 与按品质描述）

- 已按主程确认方案实现：物品信息面板显示冷却，并将技能描述从“全档位串”改为“当前品质档位值”。
- 技术实现：
  - `SellPopup` 增加按 `available_tiers` + 当前 `tierOverride` 计算档位索引；
  - 描述文案中数值分档（如 `10/20/30/40`、`1/1.5/2`）按当前档位选值；
  - 冷却显示优先读取 `cooldown_tiers`（按档位取值，ms→秒），回退 `cooldown`；0 或“无”显示“冷却：无”。
- 数据层补齐：`ItemDef` / `DataLoader` 保留 `cooldown_tiers` 字段，供 UI 显示使用。
- 变更文件：`src/shop/SellPopup.ts`、`src/items/ItemDef.ts`、`src/core/DataLoader.ts`；回归：`npm test` 通过（50/50），`npm run build` 通过。

### 本次对话追加（信息面板布局与可配置字号扩展）

- 按需求完成信息面板重排：价格移动到右下角；冷却移动到右上角（无冷却则隐藏）；名称与品质间距缩小。
- 描述改为逐行渲染：当描述有 2 行及以上时，在行与行之间绘制分隔线。
- 新增可配置字号并接入网页“字体大小”：`itemInfoPriceCornerFontSize`（右下价格）、`itemInfoCooldownFontSize`（右上冷却）。
- 同步配置链路：`data/game_config.json:text_sizes`、`data/debug_defaults.json`、`src/config/debugConfig.ts`、`src/debug/debugPage.ts`、`src/items/ItemDef.ts`、`src/scenes/ShopScene.ts`、`src/scenes/BattleScene.ts`、`src/shop/SellPopup.ts`。
- 回归：`npm test` 通过（50/50），`npm run build` 通过。

### 本次对话追加（冷却文字颜色调整）

- 按需求将信息面板右上角“冷却”文字颜色由红色改为蓝色（`0x62a8ff`）。
- 变更文件：`src/shop/SellPopup.ts`。

### 本次对话追加（冷却秒数格式）

- 按需求将冷却显示统一为 `x.x秒`（示例：`5.0秒`）。
- 变更文件：`src/shop/SellPopup.ts`；回归：`npm test` 通过（50/50）。

### 本次对话追加（信息面板结构重排：头部上下 + 内容左右）

- 信息面板布局调整为：第一行展示“名称 + 品质 + 冷却（右上）”；其下展示“左侧图标 + 右侧描述/价格（右下）”的左右结构。
- 图标按需求缩小为原显示尺寸 `2/3`，并放入左侧独立框中居中偏下显示，避免顶栏文字遮挡。
- 冷却与头部文字同一行展示，保证第一行名称/品质/冷却稳定显示；无冷却时不显示冷却文本。
- 变更文件：`src/shop/SellPopup.ts`；回归：`npm test` 通过（50/50），`npm run build` 通过。

### 本次对话追加（左侧图标框缩小与顶对齐）

- 按需求将左侧图标边框同步缩小为 `2/3`，与图标尺度一致。
- 布局改为从左上角开始展示：左侧图标框顶对齐到面板上边距，移除左列上方空白行。
- 变更文件：`src/shop/SellPopup.ts`；回归：`npm test` 通过（50/50）。

---

## 下一步

1. **阶段 2.5：输入锁回归验收（你验收）**
   - 使用 `__setGamePhase('COMBAT')` 验证：拖拽/购买/出售/Day 调试均不可改状态，且商店相关 UI 已隐藏
   - 使用 `__setGamePhase('SHOP')` 验证：上述交互全部恢复
   - 验证 phase toggle 按钮文案切换正确（SHOP=战斗，COMBAT=商店）
   - 验证锁定期间无拖拽浮层残留、无高亮残留、无“锁住后无法恢复”
2. **阶段 2.5：剩余加固项**
   - 已清空（阶段2.5 全部完成）
3. **阶段 3：战斗引擎骨架**
   - CombatEngine（纯逻辑）+ CombatScene（表现层）+ 事件流
