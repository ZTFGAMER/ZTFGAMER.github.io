# 大巴扎 — 开发进度记录

> 本文件由 Claude Code 在每次对话结束前自动更新。
> 每次新对话开始必须先读取本文件。

---

## 当前状态

**日期：** 2026-02-26
**当前阶段：** 阶段 2 商店经济系统（视觉验收优化进行中）
**整体进度：** ████████████░░ 约 60%

### 本轮完成要点（进程1挤出机制重构）
| 模块 | 变更内容 |
|------|----------|
| `DragController.ts` | 挤出从"视觉预览可还原"改为"延迟实际提交不可还原" |
| `DragController.ts` | 新增 `dragOrigItem` 字段，处理 DRAG 不在 system 时的 fallback |
| `DragController.ts` | `clearSqueezePreview` 简化为仅取消计时器（不再还原物品位置） |
| `DragController.ts` | `doSnapBack` 支持极端情况：DRAG 原格被占时扫描第一个空格 |
| 状态 | TypeScript 零报错，Vitest 通过 |

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

### ✅ 阶段 2：商店经济系统（视觉验收优化进行中）

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
- [x] TypeScript 零报错，Vitest 60/60 通过

### ⏸ 阶段 3–6（未开始）

依次为：战斗引擎 → 物品效果 → 关卡进程 → UI 打磨

---

## 待解决问题

| 优先级 | 问题 | 说明 |
|--------|------|------|
| 🔴 高 | 阶段 2 视觉验收 | 需在浏览器验证商店渲染、购买流程、出售弹窗、装备缩放与布局正确性 |
| 🟡 中 | 跨区域拖拽移除后重新 addItem 绑定时序 | 跨 zone 移动后 refreshZone 异步调用，极快操作可能短暂失去绑定 |
| 🟢 低 | 背包满时购买体验 | 目前只是 console.log，后续需 UI 提示 |
| 🟢 低 | 出售后 GridZone 内物品的 onTap 需重新绑定 | 目前 backpackView.onTap 是全局 hook，无需重绑 |

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

### 本次对话追加总结（用户最新验收反馈）

- NotebookLM 连通性确认：主程与设计师 notebook 均可访问（列表可读），当前未设置 active notebook。
- 修复“商店小型拖到战斗区误转背包”问题：购买落战斗区改为优先走统一挤出并优先 local 重排。
- 修复“战斗区小型上下互挤失效”与“只能挤一次”问题：
  - 挤出计算传入 `dragOrigItem` 作为原位覆盖，避免 DRAG 已从 system 移除后丢失原位；
  - 每次提交挤出后更新拖拽锚点，支持持续来回互挤。
- 交互颜色规范更新：换位/挤出路径统一黄色高亮（普通可放置维持原规则）。
- 背包规则补充：1x1 拖到 1x2/2x2 且不能立即合法换位时，强制红色并禁止挤出/换位。
- 当前状态：阶段 2 仍在验收优化；自动化测试维持全绿（Vitest 81/81）。

---

## 下一步

1. **浏览器视觉验收（阶段2最终）**
   - 验证战斗区闪光为黄色且略大于格子边框
   - 验证拖拽物品始终高于闪光层（闪光不遮挡被拖拽的物品）
   - 验证挤出机制延迟逻辑（悬停后实际提交、弹回极端情况等）
2. **阶段 2 全部验收通过后开始阶段 3：战斗引擎**
