# 大巴扎 — 开发进度记录

> 本文件由 Claude Code 在每次对话结束前自动更新。
> 每次新对话开始必须先读取本文件。

---

### 本次对话追加（2026-03-03，阶段验收通过：准备回传主程 + GHE更新 + 打包）

- 验收结果：
  - 背包第二排与战斗区换位链路通过；
  - 拖拽出售大区视觉/交互通过；
  - 按钮主副文案布局通过。
- 本次收口动作：
  - [x] 更新进度文档（本条）；
  - [ ] 回传主程 Notebook 做阶段 Review 归档；
  - [ ] 更新 GHE（提交并推送当前分支）；
  - [ ] 执行打包并记录结果。
- 下一步计划：
  - 完成 Notebook 回传、GHE 推送与打包后，等待下一阶段需求输入。

### 本次对话追加（2026-03-03，出售大区下移 + 第二排下沿拾取进一步收窄）

- 用户反馈：
  - 红色出售大区视觉仍偏高，压到背包边缘；
  - 背包第二排下侧拾取仍需再小一点。
- 调整：
  - `src/scenes/ShopScene.ts`
    - 出售大区上边界继续下移：`getGridDragSellAreaTopLocalY()` 从 `yTop - BTN_RADIUS - 16` 进一步调整为 `yTop - BTN_RADIUS*0.72`，减少与背包区视觉重叠。
  - `src/grid/GridZone.ts`
    - 多行区域下沿拾取裁切从 `0.2*CELL_SIZE` 提升到 `0.32*CELL_SIZE`，第二排下沿误拾取进一步降低。
- 回归验证：`npm test` 通过（82/82）。

### 本次对话追加（2026-03-03，拖拽出售大区改造 + 背包下沿拾取缩小）

- 用户需求：
  - 背包第二排下方拾取区域减小，降低误触；
  - 拖拽中下方整块区域都视为出售；
  - 拖拽时隐藏底部按钮，改为红色大出售区；
  - 悬停到出售区时出现红色强化特效与文案“拖动到此处出售 + 售价”。
- 已实现：
  - `src/grid/GridZone.ts`
    - 多行网格物品 hitArea 下边缘缩小（`MULTI_ROW_PICKUP_BOTTOM_TRIM`），减少背包下沿误触拾取。
  - `src/scenes/ShopScene.ts`
    - 新增拖拽出售大区判定 `isOverGridDragSellArea()` 与 hover 判定 `updateGridDragSellAreaHover()`；
    - `onSpecialDrop` 改为“命中下方出售大区且未命中任何格子候选”才出售（保持先识别放置再识别出售）；
    - `startGridDragButtonFlash` 升级：拖拽可出售时隐藏底部按钮，并绘制全宽红色出售区 + 价格文案；
    - 悬停出售区时红色高亮强化（边框/底色/文案颜色增强）；
    - `stopGridDragButtonFlash` 结束拖拽后恢复底部按钮可见性。
- 额外同步：
  - 拖拽调试日志持续关闭（`DragController.isDragDebugEnabled() = false`）。
- 回归验证：
  - `npm test` 通过（82/82）；
  - `npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-03，按钮主副文案共同居中）

- 用户反馈：购买/出售按钮中，主文案在按钮中心、副文案在下方，整体视觉偏下；希望“主文案+金币副文案”作为整体上下居中。
- 修复：`src/scenes/ShopScene.ts`
  - `makeCircleBtn` 与 `makePhaseRectBtn` 的 `redraw()` 改为按“主文案+副文案”整体计算组高并居中布局；
  - 当副文案隐藏时回退为主文案单独居中。
- 金币字号：两个按钮副文案继续统一使用同一字号配置 `sellButtonSubPriceFontSize`。
- 回归验证：`npm test` 通过（82/82）。

### 本次对话追加（2026-03-03，购买/出售按钮金币文案内置显示）

- 用户需求：
  - 出售按钮金币数恢复并显示在按钮内部；
  - 购买按钮也显示金币文案，位于“购买”字样下方，居中对齐。
- 已实现：`src/scenes/ShopScene.ts`
  - 将按钮副标题（金币文案）位置改为按钮内部、主标题下方居中：
    - 圆形按钮 `makeCircleBtn`；
    - 矩形按钮 `makePhaseRectBtn`。
  - 购买按钮启用副标题：`refreshBtn.setSubLabel(💰 当前金币/购买价)`；
  - `refreshShopUI()` 实时更新购买按钮金币文案，并按金币是否足够切换副标题颜色；
  - 旧的按钮外部 `refreshCostText` 停用（改为按钮内显示，避免重复）。
- 同步完成：
  - 关闭拖拽调试日志：`DragController.isDragDebugEnabled()` 返回 `false`。
- 回归验证：`npm test` 通过（82/82）。

### 本次对话追加（2026-03-03，关闭拖拽日志 + 出售误触防护）

- 用户验收通过：第二排与战斗区换位问题已修复，要求关闭相关调试日志并优化出售误触。
- 出售误触修复：`src/scenes/ShopScene.ts`
  - 缩小出售按钮拖放判定半径：`BTN_RADIUS + 24` -> `BTN_RADIUS + 8`；
  - 新增 `isOverAnyGridDropTarget(gx, gy, size)`，当拖拽指针命中任意格子候选时，优先走落位/换位，不触发出售。
  - `onSpecialDrop` 出售分支增加保护条件：仅“命中出售按钮且未命中任何格子候选”才执行出售。
- 用户诉求“先识别放置再识别出售”已落地：与格子重叠时不再误卖。
- 回归验证：`npm test` 通过（82/82）。

### 本次对话追加（2026-03-03，根因修复：VirtualGrid 单行硬编码导致第二排换位全红）

- 用户日志：`plan_none { reason: no_unified_and_no_swap, row: 1, size: 2x1 }`，战斗区中型拖到背包第二排（目标为中型或两个小型）均红判。
- 根因定位：`src/grid/VirtualGrid.ts` 仍存在历史单行硬编码：
  - `place()` / `canPlaceExcluding()` 使用 `row + h > 1`；
  - 这会使 `SqueezeLogic.planCrossZoneSwap()` 在第二排场景必然失败，进而触发 `plan_none`。
- 修复：
  - `VirtualGrid` 增加动态 `rows`（由 snapshot grid 推导）；
  - 行边界判断改为 `row + h > this.rows`；
  - `cols` 同步由 snapshot grid 推导，避免固定值隐患。
- 新增回归用例：`src/grid/SqueezeLogic.test.ts`
  - `supports cross swap when dropping to backpack lower row`，覆盖“战斗区 2x1 -> 背包第二排（两个 1x1）”换位。
- 结果：战斗区拖到背包第二排占位目标时，换位不再全红。
- 回归验证：
  - `npm test` 通过（82/82）；
  - `npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-03，战斗区->背包第二排换位不触发修复）

- 用户反馈：战斗区拖到背包第二排目标点时，空位/合成正常，但占位换位常出现“不拾取”。
- 根因定位：跨区 swap 候选在多行目标区会尝试邻近行（`targetRow-1/+1`），导致第二排目标点未被强约束，换位计划可能偏离实际命中行，进而表现为目标位不触发换位。
- 修复：`src/grid/DragController.ts`
  - 对 `planSwapWithFlexibleAnchor(...)` 在多行目标区统一启用 `lockTargetRow`；
  - 这样战斗区 -> 背包第二排换位只在第二排求解，不再串到第一排候选。
- 结果：战斗区拖到背包第二排占位点时，换位触发与落点一致。
- 回归验证：
  - `npm test` 通过（81/81）；
  - `npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-03，跨区换位行锁修复：第二排换下物品优先回第二排）

- 用户反馈：第二排跨区换位时，若第一排有空位，被换下物品会被放到第一排；期望应回到第二排。
- 根因：跨区换位兜底 `planCrossSwapViaBackpackRepack()` 使用背包重排时，未对“换下物品”的目标行做约束，求解会优先命中第一排空位。
- 修复：
  - `src/grid/DragController.ts`：将拖拽源行（`dragOrigItem.row`）传入跨区换位兜底规划；
  - `src/grid/BackpackLogic.ts`：`buildTransferPlan()` 新增 `lockedIncomingRow`，当传入时对 incoming blocker 做严格行锁（并提高 incoming 排布优先级），确保“第二排拖出，换下来的也回第二排”。
- 结果：一中换2小场景下，被换下的两个小件不会再跑到第一排，优先回拖拽来源排（第二排）。
- 回归验证：`npm test` 通过（81/81）。

### 本次对话追加（2026-03-03，第二排跨区换位补丁：背包重排兜底）

- 用户提供日志定位：`plan_none { reason: no_unified_and_no_swap }` 仍在背包第二排跨区换位出现。
- 日志结论：当前 cross/swap 在部分 `2x1` 场景无法生成方案（尤其 battle 目标被占时），导致直接红判。
- 本轮修复：`src/grid/DragController.ts`
  - 新增 `planCrossSwapViaBackpackRepack()`：
    - 当“跨区拖拽 + 目标战斗区被 blocker 占用 + 来源是多行背包”时，
    - 不再强依赖 footprint swap，而是把目标 blocker 集合作为 `incoming`，调用背包重排求解；
    - 若背包可吸纳，则生成 `swapTransfers`，跨区按真实换位提交。
  - `tryDrop()` 与 `updateHighlight()` 同步接入该兜底，避免“高亮/落地判定不一致”。
- 同步扩展：`src/grid/BackpackLogic.ts`
  - 新增 `buildTransferPlan()`，用于“背包吸纳多件跨区转移 blocker”的统一重排求解。
- 结果：第二排跨区换位在“旧 cross/swap 无解但背包可重排吸纳”时可继续成功，不再直接 `plan_none`。
- 回归验证：
  - `npm test` 通过（81/81）；
  - `npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-03，跨区换位恢复：背包仅同区走新逻辑）

- 验收反馈：仅“背包第一行 -> 战斗区”可换位；其余（背包内、背包第二行 -> 战斗区、战斗区 -> 背包）换位异常。
- 已先向主程 Notebook 确认边界：
  - 背包内拖动（同一背包 zone）走 `BackpackLogic`；
  - 背包 <-> 战斗区（跨区）恢复走 `DragController + SqueezeLogic` 的 cross/swap 换位链路。
- 代码修复：`src/grid/DragController.ts`
  - `tryDrop()`：仅在 `targetPair.system.rows > 1 && targetPair === home` 时才走 `tryDropToBackpack()`；
  - 跨区拖到背包不再提前进入背包重排分支，改回旧 cross/swap 方案。
  - `updateHighlight()`：同样仅“背包同区拖动”使用 `BackpackLogic` 高亮判定；跨区仍按换位链路高亮。
- 结果：
  - 背包同区移动继续使用新背包重排；
  - 背包第二行 <-> 战斗区、战斗区 -> 背包恢复真正跨区换位判定。
- 回归验证：`npm test` 通过（81/81）。

### 本次对话追加（2026-03-03，合成高亮颜色修复）

- 验收反馈：拖拽命中可合成目标时，应显示黄色高亮，当前被绿色覆盖。
- 根因：`ShopScene` 的 `highlightSynthesisTarget()` 先画黄框，但随后 `DragController.updateHighlight()` 继续执行默认可放置高亮，覆盖为绿色。
- 修复：`src/grid/DragController.ts`
  - `updateHighlight()` 在 `suppressSqueeze=true`（合成预览态）时直接返回，不再执行默认高亮覆盖；
  - 保留已存在的 `clearSqueezePreview()`，避免预览残留。
- 结果：拖到可合成物品上时，黄色高亮稳定显示，不再被绿色刷掉。
- 回归验证：`npm test` 通过（81/81）。

### 本次对话追加（2026-03-03，背包拖拽逻辑重写：新类接管）

- 已按流程先向主程 Notebook（`WebJs开发指南`）询问并确认方案：采用“新类 + 适配接管”，不再在旧背包分支上继续补丁。
- 本次完成：
  - [x] 新增 `src/grid/BackpackLogic.ts`，把背包落位重排收敛为独立类：
    - `buildDropPlan()`：基于 `planAutoPack` 生成“现有物品+拖拽物”的一次性排布方案；
    - `applyDropPlan()`：原子重建背包格子并返回移动明细。
  - [x] `src/grid/DragController.ts` 接入新逻辑：
    - 目标区为背包（2行）时，统一走 `tryDropToBackpack()`，不再走历史 `rowLock/cross/swap` 背包分支；
    - 背包高亮改为“是否存在可行重排方案”的直接判定。
  - [x] 删除旧背包关键分支（跨排拦截与逻辑分区判定链路），背包不再依赖历史补丁路径。
  - [x] 新增 `src/grid/BackpackLogic.test.ts`，覆盖偏好落点、可重排吸纳、方案应用三个核心场景。
- 验证结果：
  - `npm test` 通过（81/81）。
  - `npm run build` 通过（保留既有 chunk size warning）。
- 当前阶段：
  - 背包“落位/重排”主链路已切换到新类；战斗区拖拽链路保持原逻辑。
- 下一步计划：
  - 对“背包 -> 战斗区（目标被占）”链路做专项验收，确认 battle 侧换位/挤出口径与当前版本一致。
- 问题与技术债：
  - `DragController` 内 battle 路径仍保留历史挤出实现（`planUnifiedSqueeze/planCrossZoneSwap`），后续可继续拆分成 battle-only controller。
- 重要决定记录：
  - 背包采用“全局重排求解”替代“局部挤出补丁”；
  - 保持“战斗区不动、背包重写”的边界，避免回归战斗区已稳定行为。

### 本次对话追加（2026-03-02，问题留档 + GHE上传 + iOS打包与TF上传）

- 问题留档（未完全解决，待明日继续）：
  - 双行备战区（row0/row1）与战斗区之间的 `2x1` 互换链路仍有不稳定：出现 `plan_none` 红判或 `place_failed` 后回弹。
  - 现象口径：
    - row1 -> row0：偶发直接红色不可换位；
    - row0 -> row1：偶发不可拾取/不可命中；
    - 战斗区 -> row1：可合成，但换位/放置存在卡死风险。
- 今日已完成内容总结：
  - 新增拖拽全链路日志（`target/plan/plan_none/pre_place_state/place_failed/fallback_*`），用于定位方案阶段与执行阶段分叉；
  - 修复同区提交失败后的回滚保护，避免半提交状态导致卡死；
  - 调整 swap fallback 与目标命中策略（含宽物品目标格中心距离）。
- 临时验证动作：
  - 将备战区改为单行验证（稳定）；
  - 已恢复为双行，并按“跨排不挤出”规则收敛，但跨区互换问题仍待继续。
- GHE状态：本地改动已整理，准备推送（见本次会话终端结果）。
- iOS打包/TF上传结果：
  - Web build、xcodegen、archive、export 均成功；
  - TestFlight 上传失败：`cfBundleVersion` 重复（当前 `5` 已被使用，需提升 build number 后重传）。
  - 失败原文关键：`The bundle version must be higher than the previously uploaded version (previousBundleVersion: 5)`。

### 本次对话追加（2026-03-02，GHE已推送 + TestFlight上传成功）

- 处理结果更新：
  - 已将 iOS build number 从 `5` 提升到 `6`（`ios/project.yml` 的 `CURRENT_PROJECT_VERSION`）。
  - 重新执行 `xcodegen -> archive -> export -> upload` 后，TestFlight 上传成功。
  - 上传成功回执：`Delivery UUID: 34f8eb2a-1b9b-45b2-89d0-6cc698834206`。
- 代码仓库：
  - 已提交并推送到 GHE `main` 分支。
  - commit: `ce5f0da` (`feat: stabilize drag interactions and publish iOS build 6`)。
- 备注：`ios/packaging.config.local.json` 含本机本地打包参数，保留未入库（当前为 untracked）。

### 本次对话追加（2026-03-02，用户手动回退显示口径确认）

- 用户确认已手动改回信息展示口径：
  - 简版：显示“速度（很快/快/中等/慢/很慢）”
  - 详细版：继续显示“间隔（x.x秒）”
- 本轮未再覆盖该口径，后续以用户当前版本为准继续迭代。

### 本次对话追加（2026-03-02，黄金袖箭详情CD实时刷新修复）

- 验收反馈：黄金袖箭实际 CD 已按规则缩短，但详情面板中的“间隔”未实时变化。
- 根因：`SellPopup` 简版统计条“间隔”读取的是静态配置 `getCooldownMsByTier()`，未消费 battle runtime 的 `cooldownMs`。
- 修复：`src/shop/SellPopup.ts`
  - `extractSimpleStatEntries()` 新增 `runtimeOverride` 入参；
  - 简版“间隔”优先读取 `runtimeOverride.cooldownMs`，仅在无 runtime 时回退静态配置。
- 同步完善：去除已不再使用的 `formatSpeedLine()`。
- 回归验证：`npm test` 通过（76/76）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：黄金袖箭每次使用后，详情里的间隔会同步显示 `5.0 -> 4.0 -> 3.0 -> 2.0 -> 1.0`。

### 本次对话追加（2026-03-02，本对话范围总结 + 回传主程 Notebook）

- 已按你要求汇总本对话内所有改动（仅本对话范围，不跨历史对话）。
- 已将本对话技术更新摘要回传到主程 Notebook（用于方案复盘与后续验收对齐）。
- 汇总维度包含：拖拽/挤出/合成链路修复、战斗数值显示一致性、商店随机规则、UI 文案与信息层级、资源替换与平衡调整。

### 本次对话追加（2026-03-02，简版恢复“速度”展示，详细保留“间隔”）

- 验收反馈：简版描述不应显示具体“间隔x.x秒”，应回到“速度”等级表达。
- `src/shop/SellPopup.ts`：
  - `extractSimpleStatEntries()` 增加 `displayMode` 参数。
  - 简版（`simple`）显示 `速度：很快/快/中等/慢/很慢`。
  - 详细（`detailed`）继续显示 `间隔：x.x秒`。
- 结果：简版与详细模式各自回归预期口径（简版抽象、详细数值化）。
- 回归验证：`npm test` 通过（76/76）。

### 本次对话追加（2026-03-02，木弓伤害下调为30/60）

- 按你的最新口径，木弓数值改为：
  - 基础伤害：`30|60`
  - 使用后增伤：`+30|60`
- `data/vanessa_items.json`：木弓两条技能文案由 `50/100` 全部替换为 `30/60`。
- 回归验证：`npm test` 通过（76/76）。

### 本次对话追加（2026-03-02，黄金袖箭CD规则与被动物品展示收口）

- 根据验收意见完成以下修复：
  - `src/combat/CombatEngine.ts`：黄金袖箭“攻击后间隔不断缩短”改为固定 `-1000ms`，下限 `1000ms`（不再按比例 0.88）。
  - `src/combat/CombatEngine.ts`：无 CD 物品保留 `cooldownMs=0` 且不进入充能/触发队列，确保弹药堆等纯被动不跑 CD。
  - `src/combat/CombatEngine.ts`：相邻最大弹药量解析兼容 `+2/+4`、`+2|+4`，并在开场被动正确作用到相邻弹药武器。
  - `src/combat/CombatEngine.ts`：实时 `multicast` 显示对“一次打出所有弹药”物品取 `max(base, ammoCurrent)`，支持 `50*4` 风格展示。
  - `src/shop/SellPopup.ts`：无 CD 物品简版显示改为 `类型：被动物品`，不再显示“间隔无”。
  - `src/shop/SellPopup.ts`：详情分档替换正则支持 `+` 前缀（`+2|+4` 在 Lv4 显示为 `+4`）。
- 新增测试：`src/combat/CombatEngine.test.ts` 增加“黄金袖箭每次使用后 CD 固定 -1 秒且最低 1 秒”用例。
- 回归验证：`npm test` 通过（76/76）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：你提到的被动物品、弹药堆、手弩显示、黄金袖箭 CD 与详情同步已全量收口。

### 本次对话追加（2026-03-02，超级弩机连发实时显示修复）

- 验收需求：超级弩机“使用其他弹药物品时攻击次数+1”应实时体现在战斗内卡面数字（如 `300*2`、`300*3`）。
- 根因：`CombatEngine.getRuntimeState().multicast` 未叠加 `bonusMulticast`，导致逻辑生效但显示不变。
- 修复：`src/combat/CombatEngine.ts`
  - runtime `multicast` 改为 `baseMulticast + bonusMulticast`（一次打完弹药的卡继续与 `ammoCurrent` 取最大值）。
- 显示格式：`src/ui/itemStatBadges.ts` 将乘号展示从 `x` 改为 `*`，与验收示例一致。
- 新增回归：`src/combat/CombatEngine.test.ts` 增加“超级弩机会因其他弹药物品使用而提高实时连发显示”。
- 回归验证：`npm test` 通过（75/75）；`npm run build` 通过（保留 chunk size warning）。

### 本次对话追加（2026-03-02，皇家佩剑“使用后生效”触发时机修复）

- 验收反馈：皇家佩剑（每次使用后给相邻护盾物品+护盾）在开场就错误触发了1次。
- 根因：`shieldGainBonusForItem()` 的文案匹配过宽，误把“每次使用后相邻护盾物品+X护盾”当成开场常驻被动。
- 修复：`src/combat/CombatEngine.ts` 在该匹配条件中排除 `每次使用后/使用后` 文案，仅保留真正常驻 aura。
- 结果：皇家佩剑不会开场白送一次加成，只会在“自身使用后”触发。
- 回归验证：`npm test` 通过（74/74）。

### 本次对话追加（2026-03-02，手弩相邻弹药堆时弹药显示联动修复）

- 验收反馈：手弩相邻弹药堆后，战斗区卡面弹药与详情文案中的弹药数未同步变化。
- `src/scenes/ShopScene.ts`：扩展备战被动重算结构，新增 `ammoCurrent/ammoMax` 实时字段。
  - 基础弹药从技能文案（`弹药:X`）按品质+星级解析。
  - 接入“弹药堆”被动：`相邻物品+X最大弹药量` 会对相邻弹药物品同时提升 `ammoMax` 与 `ammoCurrent`。
  - 每次重算后同步调用战斗区 `setItemAmmo()`，卡面弹药显示实时更新。
- 详情联动：`getItemInfoRuntimeOverrideForShop()` 现在回传 `ammoCurrent/ammoMax`，弹窗文案中的 `弹药:4` 会按当前实际值替换（如 `8/8`）。
- 回归验证：`npm run build` 通过；`npm test` 通过（73/73）。

### 本次对话追加（2026-03-02，大手里剑伤害下调 + 取消初始测试发放）

- 配置调整：`data/vanessa_items.json` 中“大手里剑”伤害文案由 `200/400` 下调为 `50/100`。
- 初始流程调整：`src/scenes/ShopScene.ts` 移除 `placeInitialItems()` 调用并删除该函数，不再开局注入测试装。
- 结果：开局恢复纯随机，不再自动给“大手里剑”；你可直接按自然流程验证。
- 回归验证：`npm test` 通过（73/73）。

### 本次对话追加（2026-03-02，详情分档文案支持“+2|+4”按等级替换）

- 验收反馈：`Lv4` 的弹药堆详情仍显示 `+2|+4` 原串，未替换为单档 `+4`。
- 根因：`SellPopup` 的分档替换正则只匹配无符号数字分档，未覆盖带 `+` 前缀的分档串。
- 修复：`src/shop/SellPopup.ts`
  - `formatDescByTier()` 与 `formatDescDiffByTier()` 正则改为支持 `+` 前缀（如 `+2|+4`、`+5/+10`）。
- 效果：`Lv4` 弹药堆详情现应显示 `相邻物品+4最大弹药量`。
- 回归验证：`npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-02，初始测试装改为大手里剑）

- 按测试需求，开局初始发放物品改为 `大手里剑`（Bronze Lv1）。
- `src/scenes/ShopScene.ts`：`placeInitialItems()` 从“手弩+弹药堆”测试装改为单件 `大手里剑`（背包 `col0,row0`）。
- 目的：便于你直接验证大手里剑相关交互/合成/战斗表现。
- 回归验证：`npm test` 通过（73/73）。

### 本次对话追加（2026-03-02，被动物品显示与弹药联动修复）

- 验收反馈（弹药堆/手弩链路）：
  - 无 CD 物品显示为“间隔无”，期望改为“被动物品”；
  - 弹药堆不应走 CD 触发；
  - 相邻最大弹药提升未生效（手弩应到 `8/8`）；
  - 手弩“一次打出所有弹药”未在显示上体现 `50*4` 风格。
- `src/shop/SellPopup.ts`：简版统计条调整
  - 无 CD 时不再显示“间隔无”，改显示 `类型：被动物品`。
- `src/combat/CombatEngine.ts`：
  - `validCooldown()`：`cd<=0` 改为保留 `0`（不再强制回退 3000）；
  - `stepOneTick()`：`cooldownMs<=0` 物品不进入充能/触发队列（被动不跑 CD）；
  - 开场被动“相邻最大弹药”解析增强：支持 `+2/+4` 与 `+2|+4` 写法；
  - `getRuntimeState()`：对“一次打出所有弹药”物品，`multicast` 显示取 `max(base, ammoCurrent)`，用于卡面显示 `伤害*当前弹药`（如 `50*4`）；
  - `getBoardState()` 充能比例分母加 `Math.max(1, cooldownMs)`，避免 0 分母问题。
- 回归验证：`npm test` 通过（73/73）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：被动物品展示、弹药堆被动生效与手弩多发显示已对齐预期。

### 本次对话追加（2026-03-02，弹药徽标上移避让 Lv）

- 验收反馈：弹药徽标与底部 `Lv` 文本发生重叠（1x1 物品尤为明显）。
- `src/grid/GridZone.ts`：调整 `updateStatBadgePosition()` 的弹药徽标 Y 计算：
  - 新增按尺寸上移量（`1x1` 上移更多，`2x1/3x1` 适度上移）；
  - 增加与 `starText` 的避让上限（徽标底部不压到 `Lv` 行）。
- 回归验证：`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：弹药徽标与等级文本已分离，不再重叠。

### 本次对话追加（2026-03-02，开局预置测试装：手弩+弹药堆（不同等级））

- 按你的测试诉求，开局初始化从“空背包”临时改为预置两件测试装：
  - 手弩：`Silver#1`
  - 弹药堆：`Silver#2`
- 实现位置：`src/scenes/ShopScene.ts` 的 `placeInitialItems()`。
- 关键点：同步写入实例级元数据（`instanceToTier` / `instanceToTierStar` / `instanceToDefId`），确保等级显示、战斗结算和弹药联动都按预期生效。
- 回归验证：`npm test` 通过（73/73）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：可直接开局验证“不同等级下手弩+弹药堆”弹药与显示行为。

### 本次对话追加（2026-03-02，商店随机规则新增：弹药依赖 + Day1 第3件职业约束）

- 新增配置字段：`data/game_config.json` -> `shop_rules`
  - `ammoSupportRequiresAmmoOwned: true`
  - `ammoSupportItemNames: ["弹药袋", "弹药堆"]`
  - `day1ThirdItemMatchExistingArchetype: true`
  - `shopSizeWeights: { small: 2, medium: 1, large: 1 }`
- 类型与加载：
  - `src/items/ItemDef.ts` 为 `GameConfig` 增加 `shopRules`。
  - `src/core/DataLoader.ts` 增加 `shop_rules` 读取（可选）。
- `src/shop/ShopManager.ts` 规则实现：
  - 弹药支持物品（按配置名匹配）在“未拥有任意弹药类物品（技能文案含`弹药`）”时不进入随机候选。
  - Day1 初始首轮（constructor 首次 roll）第3件物品强制与前两件之一同职业（`tags` 首标签）。
  - 增加 Day1 第3件兜底校正：若仍出现三职业全不同，最终强制重选第3件为前两件职业之一。
  - 新增尺寸权重抽样：按 `shopSizeWeights` 做候选加权，当前小型:中型≈`2:1`。
  - 规则作用于随机与后续刷新，合成后因 `setOwnedTiers()` 同步已拥有物品也可解锁弹药支持物品随机。
- 新增测试：`src/shop/ShopManager.test.ts`
  - 覆盖“弹药依赖解锁”“Day1 第3件职业约束”“小型>中型约2:1权重”三条规则。
- 回归验证：`npm test` 通过（73/73）；`npm run build` 通过（保留 chunk size warning）。

### 本次对话追加（2026-03-02，简版描述未读取问题修复）

- 验收反馈：简版文案仍显示旧正则推导结果（如“相邻的护盾物品护盾”），未命中 JSON 配置“相邻物品护盾提升”。
- 根因：`DataLoader.normalizeItem()` 未把 `simple_desc/simple_desc_tiered` 字段写入运行时 `ItemDef`，导致前端读取为空并回退旧逻辑。
- 修复：`src/core/DataLoader.ts` 补充字段映射：
  - `simple_desc: toSafeString(r.simple_desc).trim()`
  - `simple_desc_tiered: toSafeString(r.simple_desc_tiered).trim()`
- 回归验证：`npm test` 通过（69/69）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：简版描述已按 JSON 显式字段优先显示，与策划配置一致。

### 本次对话追加（2026-03-02，简版描述迁移到 JSON 并与配置对齐）

- 数据层：`data/vanessa_items.json` 为 18 件物品新增 `simple_desc` 与 `simple_desc_tiered`，按你给的表逐条录入。
- 类型层：`src/items/ItemDef.ts` 扩展 `ItemDef`，新增可选字段 `simple_desc`、`simple_desc_tiered`。
- 展示层：`src/shop/SellPopup.ts` 去除硬编码 `ITEM_DESC_GUIDE`，改为优先读取物品 JSON 的简版文案字段。
- 兼容处理：分档解析支持 `|` 和 `/` 两种分隔，确保配置写法与展示结果一致。
- 当前规则：
  - 简版模式优先显示 `simple_desc`；
  - 详细/升级预览优先显示 `simple_desc_tiered`（按品质星级分档）。
- 回归验证：`npm test` 通过（68/68）；`npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-02，被动跳字初始位置下移40）

- 验收调整：被动跳字初始位置整体再向下。
- `src/scenes/ShopScene.ts`：`spawnPassiveJumpText()` 的起始 Y 增加 `+40`，让跳字更贴近物品主体区域。
- 说明：仅调整初始位置，不影响移动/停留/淡出时序配置。

### 本次对话追加（2026-03-02，设计确认：简版描述改为 JSON 显式字段）

- 已按流程通过设计师 Notebook（`手机大巴扎设计`，id: `98dc4c7c-dcf5-4391-a65e-1529a4a6b6e5`）确认方案。
- 设计结论：同意将 18 件物品“简版描述”改为 JSON 显式字段，并在 `SellPopup` 简版优先显示该字段，以确保展示与策划配置一致。
- 关键注意项（设计侧）：
  - 简版字段建议使用模板+变量注入，避免硬编码数值导致与升星/品质分档脱节。
  - UI 需有降级链路：显式字段优先，缺失时回退正则推导，再回退完整描述，避免空白。
  - 简版信息需保持低文本高可读：不重复展示 UI 已表达的信息，不放复杂公式和风味文案。
  - 验收需覆盖：分档数值一致性、窄屏溢出边界、空字段兜底表现。

### 本次对话追加（2026-03-02，新增被动跳字字号调试配置）

- 已按主程建议执行最小改动：为备战被动跳字新增字号配置项，便于在线调参。
- 配置接入：
  - `src/config/debugConfig.ts` 新增 `shopPassiveJumpFontSize`（10~72，默认26）。
  - `data/debug_defaults.json` 新增默认值 `shopPassiveJumpFontSize: 26`。
  - `src/debug/debugPage.ts` 将该项加入战斗表现调参分组。
- 渲染生效：`src/scenes/ShopScene.ts` 跳字渲染改为读取 `getDebugCfg('shopPassiveJumpFontSize')`，替代硬编码字号。
- 回归验证：`npm test` 通过（67/67）。

### 本次对话追加（2026-03-02，战斗详情护盾值与实际结算同步）

- 验收反馈：局外备战相邻加成后护盾显示 35，但进战斗详情/徽标显示回到 20；实际结算仍按 35。
- 根因：`CombatEngine.getRuntimeState()` 的 `shield` 仅返回 `baseStats.shield`，未叠加相邻护盾加成（该加成在结算时通过 `shieldGainBonusForItem()` 参与）。
- 修复：`src/combat/CombatEngine.ts` 将 runtime `shield` 改为 `baseStats.shield + shieldGainBonusForItem(it)`，使战斗详情与卡面徽标与实际结算口径一致。
- 影响范围：主要体现在护盾类物品（你反馈的“只有护盾类有问题”与此一致）。
- 回归验证：`npm test` 通过（67/67）。

### 本次对话追加（2026-03-02，木弓弹药调整为2）

- 配置调整：`data/vanessa_items.json` 中木弓技能文案由 `弹药:1` 改为 `弹药:2`。
- 影响：木弓基础最大弹药提升为 2（同分档规则下战斗与徽标显示同步生效）。
- 回归验证：`npm test` 通过（67/67）。
- 当前状态：木弓弹药容量已按新设定生效。

### 本次对话追加（2026-03-02，被动跳字位置与时序配置修复）

- 验收反馈：
  - 跳字位置偏到场外右侧，不在物品上；
  - 只看到部分物品跳字；
  - 需要支持“移动时长/停留时长/淡出时长”可配置。
- 根因：
  - 跳字坐标使用 `toGlobal` + stage 层绘制，受全局坐标系偏移影响；
  - 仅比较正向增量且只看已存在 prev 快照，新增上阵物品的被动增量不会触发；
  - 仅处理正增量，未覆盖负向变化。
- 修复（`src/scenes/ShopScene.ts`）：
  - 跳字层挂到 `battleView` 内，坐标改为物品本地坐标，保证文本贴在物品上方。
  - 新增 `baseBeforePassive` 对比：首次上阵也能正确识别被动增减并跳字。
  - 跳字改为“增减都显示”（`+/-`），并对同物品多条变化做堆叠偏移显示。
  - 拖拽结束与点选前继续触发实时重算，保证跳字与数值同步。
- 新增可调参数（已接入 debug 配置与调试页）：
  - `shopPassiveJumpMoveMs`（移动时长）
  - `shopPassiveJumpHoldMs`（停留时长）
  - `shopPassiveJumpFadeMs`（淡出时长）
  - 文件：`src/config/debugConfig.ts`、`data/debug_defaults.json`、`src/debug/debugPage.ts`
- 回归验证：`npm test` 通过（67/67）；`npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-02，备战拖拽后未实时重算被动值修复）

- 用户定位准确：从战斗回来数据正确，说明非战斗阶段（备战手动调位）未及时走重算链路。
- 根因：`ShopScene` 普通拖拽落位后仅做视觉收尾（`onDragEnd`），未触发 `refreshBattlePassiveStatBadges()`；
  导致战斗区被动面板值与详情 override 仍是旧快照。
- 修复：
  - `src/scenes/ShopScene.ts`：`drag.onDragEnd` 增加 `refreshBattlePassiveStatBadges(true)`，确保每次摆位完成后立即重算。
  - `src/scenes/ShopScene.ts`：点击战斗区物品前先 `refreshBattlePassiveStatBadges(false)`，避免“刚调位立刻点详情”读到旧值。
- 结果：备战中每次换位后，短剑/圆盾/回旋镖被动值与详情面板都会立即更新，不再依赖“打一场回来才正确”。
- 回归验证：`npm test` 通过（67/67）。

### 本次对话追加（2026-03-02，连发飞镖次数修正为3次）

- 验收反馈：连发飞镖详情显示“连续发射1次”，预期应为3次。
- 根因：`resolveItemTierBaseStats()` 的 `multicast` 解析只匹配“触发X次”，未覆盖“连续发射X次”语义，导致回退默认值 1。
- 修复：`src/items/itemTierStats.ts` 扩展连发解析正则，支持“连续发射/连发次数/触发”多种文本模式。
- 新增回归：`src/items/itemTierStats.test.ts` 增加“连发飞镖 Bronze -> multicast=3”断言。
- 回归验证：`npm test` 通过（67/67）。

### 本次对话追加（2026-03-02，弹药徽标实时刷新修复）

- 验收反馈：战斗中弹药信息（如 `1/1`）未随使用/补弹及时变化。
- 根因：`BattleScene` 每帧仅更新了数值徽标（伤害/护盾等），未把运行时 `ammoCurrent/ammoMax` 回写到 `GridZone`。
- 修复：`src/scenes/BattleScene.ts` 的 `updateRuntimeStatBadges()` 新增
  - `zone.setItemAmmo(it.id, rt.ammoCurrent, rt.ammoMax)`（有 runtime 时实时更新）
  - `zone.setItemAmmo(it.id, 0, 0)`（runtime 缺失时清空覆盖，避免脏显示）
- 回归验证：`npm test` 通过（66/66）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：弹药徽标已与战斗运行时一致，使用与补弹均会即时反映。

### 本次对话追加（2026-03-02，战斗详情图标丢失与实时数值错位修复）

- 验收反馈（局内）：
  - 详情面板图标丢失（空框）；
  - 详情面板数值与上方徽标不一致（短剑卡面30但详情仍20）。
- 根因定位：
  - `BattleScene` 在详情面板打开期间每帧重复调用 `SellPopup.show()`，每次都会把图标 alpha 置0并重新异步加载，导致视觉上常驻空框。
  - 同时未把 runtime override 传入 `SellPopup.show()`，详情继续走静态档位文案，和战斗实时数值脱节。
- 修复：
  - `src/scenes/BattleScene.ts`：
    - `showBattleItemInfo()` 组装并传入 runtime override（冷却/伤害/护盾/状态/连发/弹药）；
    - 新增 `nextKey` 比较，若实时值未变化则不重复 `show()`，避免每帧重载图标。
  - `src/shop/SellPopup.ts`：runtime override 数值替换链路继续生效。
- 结果：
  - 战斗详情图标恢复正常显示；
  - 战斗详情中的核心数值可跟随实时逻辑（例如短剑被加成后显示30，而非固定20）。
- 回归验证：`npm test` 通过（66/66）；`npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-02，详情去重：移除与效果条重复的纯数值句）

- 验收反馈：详细描述第一行“攻击造成20伤害”与上方效果条“伤害20”重复。
- `src/shop/SellPopup.ts`：新增 `isPureStatLine()` 过滤规则。
  - 在详细模式中，自动移除纯数值句（如“造成X伤害”“间隔X秒”“获得X护盾”等）
  - 保留机制/条件类描述（例如“相邻的护盾物品护盾+5”）。
- 结果：详情区只保留非重复信息，避免同屏重复表达。
- 回归验证：`npm test` 通过（66/66）。

### 本次对话追加（2026-03-02，弹药武器“无弹不空转CD”修复）

- 验收反馈：带弹药武器在弹药为 0 时，CD 转满后仍继续走下一轮 CD，导致补弹后不能立刻发射。
- `src/combat/CombatEngine.ts`：在充能结算（`currentChargeMs >= cooldownMs`）处增加弹药判定：
  - 若为弹药武器且当前无弹：`currentChargeMs` 固定停在 `cooldownMs`（已就绪状态），不入执行队列、不重置 CD。
  - 一旦补到弹药，下次结算将直接触发发射（不再额外等待完整一轮 CD）。
- 回归验证：`npm test` 通过（66/66）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：弹药体系手感符合“无弹待机、补弹即开火”预期。

### 本次对话追加（2026-03-02，备战徽标口径修正 + 备战详情按实时被动值显示）

### 本次对话追加（2026-03-02，新增拖拽参数 bool：关闭挤出，仅保留合成/换位）

### 本次对话追加（2026-03-02，移除初始临时背包数据 + Day1 金币=10）

### 本次对话追加（2026-03-02，拖拽重叠卡死修复：落点失败自动择近空位）

- 再次验收补丁：战斗区中型拖到背包第二排、背包满场景下仍有“应可互换但判失败”的情况。
- 根因：`dragSqueezeEnabled=0` 时我们把 `planUnifiedSqueeze` 全部禁用，导致其 `cross` 模式（将目标阻挡物转移到来源区的合法空位）也被禁掉，只剩 footprint swap，容量稍复杂就失败。
- 修复：`src/grid/DragController.ts`
  - 即使 `dragSqueezeEnabled=0` 也会计算 `planUnifiedSqueeze`；
  - 仅允许其 `cross` 模式通过（等价“换位转移”），`local` 挤出仍禁止。
  - 保持“关闭挤出”语义：不做本区挤出预览/本区连锁挤出，只保留合成+换位/跨区转移。
- 结果：背包满且目标为中型/小型混排时，若存在合法转移路径会判定可换位（绿），不再误判红色失败。
- 深挖“第一排可换、第二排不可换”的核心差异并修复：
  - 根因：`planUnifiedSqueeze` 的 `cross` 转移此前是贪心“第一个可放位置”逐个放置 blocker，未做全局回溯；当目标覆盖中含“1个中型+2个小型”时，若先放小型会堵住中型的唯一空位，导致第二排更容易失败（第一排场景较少触发该组合）。
  - 修复：`src/grid/SqueezeLogic.ts` 将 `cross` 转移改为 DFS 回溯排布（按面积大到小优先），在来源区可见列内寻找全局可行解。
  - 结果：战斗区 <-> 背包第二排在满格复杂组合下也能找到可交换方案，不再出现“第一排能换、第二排不能换”的不一致。
- 回归验证：`npm test` 通过（73/73）。

- 规则再调整（本轮用户指令）：区域间拖动不要挤出，仅战斗区内允许相互挤出。
- `src/grid/DragController.ts`：
  - `tryDrop()`：仅当 `targetPair===home && targetZone.rows===1` 时启用 `planUnifiedSqueeze`；
  - `updateHighlight()`：同样仅该条件下显示/执行挤出预览；
  - 跨区拖动与背包内拖动统一不再走挤出，仅保留合成+换位+可落位判定。
- 备注：当前以 `rows===1` 作为战斗区判定（商店场景 battle=1 行，backpack=2 行）。
- 回归验证：`npm test` 通过（73/73）。

- 用户继续要求：背包两排视为两个独立背包（重点排查第二排）。
- 已落地的“独立背包”约束（`src/grid/DragController.ts`）：
  - 背包内拖拽时，禁止跨排落位（row0 仅 row0，row1 仅 row1）；
  - 背包落位失败兜底（nearest place）增加 `rowLock`，只在当前排找最近合法位；
  - 回弹兜底扫描在背包场景也只回到原排，避免跨排漂移造成“第一排/第二排行为不一致”；
  - 高亮层同样对跨排目标直接红色。
- 同时保留上一条规则：区域间不挤出，仅战斗区内可挤出。
- 回归验证：`npm test` 通过（73/73，重跑确认）。

- 再次排查“第二排无法与第一排/战斗区平等换位”：
  - 结论：并非历史“中型强制上排”代码在生效；`GridZone.pixelToCellForItem()` 当前按 `pointerLocal.y` 计算 row（无 `row=0` 强制），旧注释为遗留描述。
  - 真正影响点是此前新增的“锁排”限制与回弹/兜底 rowLock，导致第二排在跨排与跨区时被额外约束。
- 本轮修复（`src/grid/DragController.ts`）：
  - 移除背包内跨排硬拦截（drop + highlight 两条链路）；
  - 移除 nearest-place 的 `rowLock` 限制；
  - 回弹兜底扫描恢复全行可选，不再只限原排；
  - 保留“区域间不挤出，仅战斗区内 local 挤出”规则，同时跨区可继续走 `unified.cross` 转移（视作换位）。
- 结果：第二排与第一排、战斗区的换位判定口径一致，避免“同目标第一排能换、第二排不能换”的差异。
- 回归验证：`npm test` 通过（74/74）。

- 用户继续反馈“仍不对”，本轮再修：
  - 发现我们在“区域间不挤出，仅战斗区内 local 挤出”改造后，误把 `unified.cross` 也一并限制掉，导致部分第二排<->第一排/战斗区的可行换位被误判失败。
  - `src/grid/DragController.ts`：
    - 恢复 `unified.cross` 在跨区场景可用（仍不启用跨区 local 挤出）；
    - 新增 `planSwapWithFlexibleAnchor()`：当当前锚点换位失败时，自动尝试邻近列锚点（0, -1, +1, -2, +2）寻找可行 swap，避免“明明可换位但当前锚点恰好覆盖过多 blocker”导致红判。
    - drop 阶段使用该可行锚点的 `dropCol/dropRow`，高亮也同步到可行锚点。
  - 移除上轮为“独立背包”引入的锁排行为，恢复两排行为一致（跨排可换位）。
- 结果：第二排与第一排/战斗区在换位判定上恢复平等，复杂布局下可行换位更容易被识别。
- 回归验证：`npm test` 通过（76/76）。

- 用户最终决策：明确要求“背包视为两个独立背包区域，复用背包1逻辑”。
- 本轮按该策略执行（`src/grid/DragController.ts`）：
  - 恢复并固化背包内跨排限制：同区且目标为背包时，不允许 row0<->row1 跨排落位；
  - highight 链路同步跨排红判；
  - nearest-place 兜底在背包目标区启用 `rowLock`，仅当前排找可落位；
  - snapBack 兜底在背包来源区也只扫描原排，避免跨排漂移。
- 保留：跨区换位（`unified.cross` / `swap`）逻辑仍可用，战斗区内 local 挤出规则不变。
- 回归验证：`npm test` 通过（76/76）。

- 用户追加反馈：“现在空位都放不进去了”。
- 紧急回退修复（`src/grid/DragController.ts`）：
  - 移除本轮新增的 `targetRowLock` 在 `planUnifiedSqueeze` / fallback 中的强约束；
  - 移除背包内 drop/highlight 的跨排硬拦截；
  - 回弹兜底扫描恢复全行可选，优先保证“空位可放入”正常。
- 当前口径：先保证基本拖放和空位放置稳定，再继续针对“背包两排独立但不影响跨区/跨排互换”做下一轮精确规则拆分。
- 回归验证：`npm test` 通过（76/76）。

- 用户明确业务口径：背包2应可正常放入背包1/战斗区空位，也应可进行互换。
- 本轮修正（`src/grid/DragController.ts`）：
  - 将“同一物理背包但不同行”视为**不同逻辑区域**（`isLogicalSameZone`），而不是同区硬判；
  - 因此 row0<->row1 走跨区换位链路（`unified.cross` / `swap`），而非被当作本区不可换位；
  - `swapTransfers/crossTransfers` 的执行分支也按“逻辑区域”判断，确保同物理 view 不同行时仍按跨区迁移执行；
  - 保留“空位可放”优先，不再加 rowLock 强约束。
- 结果：背包第二排可与第一排/战斗区进行平等放置与互换，不再被同区判定拦截。
- 回归验证：`npm test` 通过（76/76）。

- 用户继续反馈“仍不对”，并定位到核心漏改：
  - `crossTransfers` 执行分支条件仍是 `targetPair !== home`，导致“同物理背包 view 但不同行（逻辑跨区）”时 `unified.cross` 结果不会被真正执行。
- 修复（`src/grid/DragController.ts`）：
  - 将 `crossTransfers` 执行条件改为 `!isLogicalSameZone`，与前面的逻辑分区判定一致。
  - 这样 row0<->row1 作为逻辑跨区时，cross transfer 可落地执行，不再只高亮绿但落地失败。
- 回归验证：`npm test` 通过（77/77）。

- 进一步修复（同一问题链路）
  - 发现第二个漏点：当 `isLogicalSameZone=false` 但 `targetPair===home`（背包 row0<->row1）时，`crossTransfers` 仍可能走到“跨区 remove/add”路径，导致同一 view 下节点迁移不稳定。
  - 修复：
    - `crossTransfers` 在“同一物理区但逻辑跨区”时改为 `commitLocalSqueezeMoves` 本区提交；
    - `swapTransfers` 同样在 `targetPair===home` 时走本区提交，避免同 view remove/add 抖动。
  - `planCrossZoneSwap` 侧补丁：在 DFS 之前同步从 `homeVg` 移除 blocker 自身，兼容“同一物理 Grid 逻辑分区互换”场景，避免 blocker 原位自占导致无解。
- 结果：row0<->row1 的逻辑跨区换位链路可稳定提交，不再出现高亮可行但落地失败。
- 回归验证：`npm test` 通过（77/77）。

- 用户明确新规则（原话）：
  - 背包第一行要有“和战斗区一样”的内部挤出；
  - 第一行不应挤出到第二行；
  - 第二行完全复制第一行逻辑。
- 本轮实现（`src/grid/DragController.ts`）：
  - `local squeeze` 启用条件从“仅 1 行区”改为“同逻辑区即可”（背包同排也可 local squeeze）；
  - 对 2 行背包启用 `rowLock=finalRow`，确保挤出仅在当前排内发生，不跨到另一排；
  - `unified.cross` 仅保留给真正跨物理区（`targetPair !== home`），避免背包两排之间走 cross 挤出。
  - fallback 最近落位对背包也加 `rowLock`，保持每排逻辑一致。
- 结果：背包 row0 / row1 都按“战斗区式内部挤出（限本排）”执行，且不会把 blocker 挤到另一排。
- 回归验证：`npm test` 通过（77/77）。

- 用户补充精确症状：第一/二排内部挤出正常，仅“第二排与其他区域互换”异常。
- 针对性修复：
  - `DragController`：
    - `local squeeze` 放开到“同逻辑区即启用”（不再限制 1 行区），背包每一排都拥有与战斗区一致的本排内部挤出能力；
    - 对 2 行区 `planUnifiedSqueeze` 传入 `rowLock=finalRow`，确保挤出只在当前排内；
    - `unified.cross` 仅用于真实跨物理区（`targetPair !== home`），避免背包两排互换误走 cross。
  - `SqueezeLogic.planUnifiedSqueeze`：新增 `homeRowLock`，cross DFS 可锁定来源排，兼容“逻辑分区互换”时 blocker 落位范围。
- 结果：
  - row0 / row1 内部均可本排挤出；
  - row1 不会把物品挤出到 row2（反之亦然）；
  - 第二排与战斗区/第一排互换链路按 swap 执行。
- 回归验证：`npm test` 通过（77/77）。

- 用户继续反馈“图示仍不行”，追加针对性修复：
  - 发现 `updateSqueezePreview()` 在多行背包里会持续更新 `dragOrigItem.col/row`，导致跨排/跨区 swap 的 footprint 锚点被漂移（拖拽过程中被改写），进而出现“本来可换却红判”。
  - 修复：仅在 1 行区（战斗区）允许更新 `dragOrigItem` 锚点；2 行背包保持 drag 开始时原始锚点不变。
- 结果：第二排拖向第一排/战斗区时，swap 规划使用稳定 footprint，不再因中途预览挤出改写原锚点。
- 回归验证：`npm test` 通过（78/78）。

- 进一步逐项排查并尝试（本轮）：
  1) 先移除 cross 的来源行锁（`homeRowLock` 传 `undefined`）并允许 swap 试探邻近行；
  2) 复测后继续收敛：
     - `local squeeze` 改为“同逻辑区可用”，并在 2 行区启用 `rowLock=finalRow`，保证每排内部独立挤出；
     - `unified.cross` 仅用于真实跨物理区；
  3) 再次修复锚点漂移：
     - `updateSqueezePreview()` 在 2 行背包不再改写 `dragOrigItem`，避免 swap footprint 在拖拽中漂移导致误判。
- 当前观察：问题仍集中在“第二排对外互换链路”，非内部挤出。
- 现状回归：`npm test` 通过（78/78，包含重跑确认）。

- 本轮继续排查（用户反馈“还是不对”）并新增诊断能力：
  - 在 `src/grid/DragController.ts` 增加可开关拖拽调试日志（`localStorage.drag_debug=1` 开启）：
    - `drop_target`：命中目标格/逻辑区判定/是否可直放
    - `drop_plan`：命中后的方案选择（local/cross/swap）与计划落点
    - `drop_place_failed` / `drop_fallback_*`：落位失败与兜底结果
  - 目的：对“第二排互换失败”做路径级真因采样，避免继续盲改。
- 同步尝试：
  - swap 试探增加邻近行（不仅邻近列）；
  - cross 来源行锁继续放开。
- 回归验证：`npm test` 通过（78/78）。

- 基于用户提供日志的本轮结论与改动：
  - 日志显示第二排失败时仅有 `target`，缺少 `plan`，说明失败发生在“方案生成（unified/swap）”阶段，而非最终 `place` 阶段。
  - 新增 `plan_none` 诊断日志，明确记录“无 unified 且无 swap”的分支命中。
  - `planCrossZoneSwap` 增加 fallback：footprint DFS 失败后，允许在来源区可见列内做任意排布 DFS（仍保持大件优先），用于兜住第二排复杂布局。
  - 保留已加的 `drag_debug` 日志开关（`localStorage.drag_debug=1`）。
- 回归验证：`npm test` 通过（78/78）。

- 用户反馈“第二排拖到第一排后卡死”，本轮补上执行期保护：
  - `DragController.tryDrop()` 新增 `plan_none` 详细日志，明确“无方案”分支；
  - 对同区已提交的 `local/swap/cross` 变更记录 `revert`，当最终 `place/fallback` 失败时先回滚已提交变更，再执行 `doSnapBack()`，避免卡死。
  - 新增 `rollbackLocalMoves()` 统一回滚提交结果。
- 结果：即使出现“计划可行但落位失败”的边缘场景，也不会把局面留在半提交状态导致拖拽物卡死。
- 回归验证：`npm test` 通过（78/78）。

- 基于新日志再次定位并修正：
  - 日志显示 `swapTransfers>0` 但 `pre_place_state.blockers=2`，说明 swap fallback 在某些分支把 blocker 重新放回目标落点 footprint，导致最终 `place_failed`。
  - 修复：`src/grid/SqueezeLogic.ts` 在 `planCrossZoneSwap()` 的 fallback（任意排布 DFS）增加约束：禁止 blocker 新位置与目标落点 footprint 重叠。
- 同步修复：`planSwapWithFlexibleAnchor()` 对“背包跨排互换”锁定目标行（不再试邻近行），避免第一排拖第二排时计划落点被回退到原行。
- 结果：
  - 减少“有 swap 方案但 drop 位仍被占”的假阳性；
  - 第一排→第二排互换不再因 row 候选漂移回原排。
- 回归验证：`npm test` 通过（78/78）。

- 用户新增症状：
  - 第一排拖第二排、第二排拖第一排均出现 `plan_none` 红判；
  - 战斗区可命中第一排，难命中第二排（宽物品）。
- 本轮修复：
  1) `SqueezeLogic.planUnifiedSqueeze` cross 分支补齐 `homeVg.remove(blocker)`，避免同物理 Grid 逻辑跨区时 blocker 自占位导致无解；
  2) `DragController.findBestDropTarget` 宽物品候选距离由“区域中心”改为“命中格中心”，提高第二排命中优先级；
  3) `planSwapWithFlexibleAnchor` 对背包跨排互换启用 `lockTargetRow=true`，避免 row 候选漂移回原行。
- 当前仍保留全量拖拽日志，便于继续收敛。
- 回归验证：`npm test` 通过（78/78）。

- 用户现场补充：
  - 第二排拖第一排会触发“跨排挤出”（与预期不符，应仅换位/放置）；
  - 战斗区拖到第二排仍有卡死。
- 本轮修正（`src/grid/DragController.ts`）：
  - `canUseLocalSqueeze` 收紧：
    - 同物理区 2 行背包仅在 `isLogicalSameZone=true` 时允许 local squeeze；
    - 跨排（row0<->row1）不再允许 local squeeze，避免“跨排挤出”。
  - `unified.cross` 仅用于真实跨物理区（`targetPair !== home`），避免同背包跨排误走 cross。
  - 同物理区跨排落位渲染改回 `snapToCellFromDrag`（不 destroy/add），降低同 view 迁移导致的卡死概率。
- 回归验证：`npm test` 通过（78/78）。

- 用户临时决策：先把“备战区”改为一行验证效果。
- 本轮落地：`src/scenes/ShopScene.ts`
  - `backpackSystem = new GridSystem(6, 1)`
  - `backpackView = new GridZone('背包', 6, 6, 1)`
- 同步清理：删除未使用的 `getItemInfoRuntimeOverrideForShop`（避免编译告警）。
- 目的：绕开双行背包互换链路复杂度，先验证单行备战区交互稳定性。
- 回归验证：`npm test` 通过（78/78）。

- 用户继续反馈“双行时跨排行为与第二排命中异常”，本轮按“严格两排独立”再收敛：
  - 恢复双行：`backpackSystem(6,2)` + `backpackView(...,2)`；
  - `DragController` 收紧规则：
    - 同物理背包跨排（`isLogicalSameZone=false`）直接拦截并红判，不允许跨排挤出；
    - 同物理背包内 `unified.cross` 禁止，仅真实跨物理区可用；
    - 落位渲染分支改为 `targetPair !== home` 判定，避免同 view 跨排误走 destroy/add。
- 目标：两排按“两个独立一行背包”运行，杜绝跨排挤出与跨排卡死。
- 回归验证：`npm test` 通过（78/78）。

- 用户要求“不想手动开关，直接打日志”。
- `src/grid/DragController.ts`：将 `isDragDebugEnabled()` 临时改为恒 `true`，拖拽诊断日志全量输出到控制台（`target/plan/plan_none/place_failed/fallback_*`）。
- 目的：现场复现时无需改 localStorage，可直接采集完整链路。

- 验收反馈：出现“物品穿插/重叠”视觉，拖到目标点位（2/3）时应落到可排放位置，不应重叠卡死。
- 根因（`src/grid/DragController.ts`）：
  - 放置阶段在执行挤出/换位后，拖拽物 `system.place(...)` 未做失败兜底（直接按目标格吸附视觉），会出现“系统未成功放置但视觉已叠加”的错位。
- 修复：
  - 新增 `findNearestVisiblePlace()`，当目标格不可放置时，自动查找同区域最近合法空位（优先同排，再按列距离）。
  - `tryDrop()` 改为：先尝试目标格 `place`，失败则 fallback 到最近合法格；若仍失败再回弹。
  - 该兜底同时覆盖同区/跨区放置链路，避免视觉穿插。
- 结果：无论是否开启挤出，拖到目标附近若有合法空位会自动吸附到可排放格；仅在确实无位时红色并回弹。
- 回归验证：`npm test` 通过（69/69）；`npm run build` 通过（保留既有 chunk size warning）。

- 需求：去掉初始临时数据、开局背包清空、第一天金币为 10。
- `src/scenes/ShopScene.ts`：`placeInitialItems()` 改为空实现，移除开局注入的调试预置物品（短剑/圆盾/回旋镖等）。
- `data/game_config.json`：`daily_gold_by_day` 的 Day1 从 `12` 调整为 `10`。
- 现状：
  - 新开局（无存档恢复）时背包为空；
  - ShopManager Day1 初始金币按 `daily_gold_by_day[0]` 发放，现为 `10`。

- 验收追加：合成拾取范围过大，拖到两个可合成目标中间时误触发合成，期望按实际命中区域判定（中间应走换位/放置，不应吸附合成）。
- `src/scenes/ShopScene.ts` 收敛合成命中策略：
  - 移除“多点 probe 扩大命中圈”逻辑（原先对 X/Y 多偏移采样）。
  - 合成目标判定改为单点命中：使用拖拽视觉锚点（`gy + dragYOffset`）做一次检测。
  - 命中规则改为仅按目标物品边界（bounds）命中，不再用 footprint overlap 扩张到相邻格。
- 结果：合成命中范围与普通拖拽命中区域对齐；拖在两个候选中间不会被强行判为合成。
- 回归验证：`npm test` 通过（66/66）；`npm run build` 通过（保留既有 chunk size warning）。

- 需求：在“拖拽参数”里增加一个 bool 开关，临时关闭挤出；只保留“合成（黄）+换位（绿）+不可换位（红）”。
- 配置新增：
  - `src/config/debugConfig.ts` 新增 `dragSqueezeEnabled`（`0/1`，`unit: bool`）
  - `data/debug_defaults.json` 新增默认值 `dragSqueezeEnabled: 1`
- 拖拽逻辑调整（`src/grid/DragController.ts`）：
  - 当 `dragSqueezeEnabled=0`：
    - 禁用 `planUnifiedSqueeze` 与挤出预览提交；
    - 仅允许 `planCrossZoneSwap` 换位（含同区/跨区）；
    - 不可放置且不可换位时直接红色高亮并回弹。
  - 当 `dragSqueezeEnabled=1`：保持当前挤出逻辑。
- 颜色口径：
  - 合成仍由现有合成高亮链路控制为黄色；
  - 可放置/可换位为绿色；
  - 不可换位为红色。
- 回归验证：`npm test` 通过（66/66）。

- 验收反馈：
  - 备战（商店）战斗区仍出现数值徽标，未回到职业徽标；
  - 备战详情面板文本未按当前被动后真实值显示（圆盾示例仍显示20而非25）。
- 修复一（徽标口径）：
  - `src/scenes/ShopScene.ts`：战斗区固定为 `archetype` 模式；
  - `src/ui/itemStatBadges.ts`：`archetype` 模式不再回退显示数值徽标（无职业标签则不显示徽标），彻底避免备战出现数值角标。
- 修复二（备战详情面板）：
  - `src/scenes/ShopScene.ts`：新增 `battlePassiveResolvedStats`，保存战斗区当前“被动结算后”的实时属性；
  - 点击战斗区物品时把该实时属性作为 runtime override 传给 `SellPopup`，详情面板的护盾/伤害等数值同步当前逻辑结果（仅描述面板显示数值）。
- 战斗中详情继续实时：
  - `src/shop/SellPopup.ts` 保持 runtime override 通道；
  - `src/scenes/BattleScene.ts` 面板每帧刷新并保持当前简/详模式，展示战斗实时值。
- 回归验证：`npm test` 通过（66/66）；`npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-02，去掉详情右上角“间隔”文案）

- 按验收截图，移除详情卡右上角的 `间隔：x.x秒` 文案，避免与下方效果条中的“间隔”重复。
- `src/shop/SellPopup.ts`：`cooldownT` 统一设为不显示（简单/详细模式均隐藏）。
- 详情保留信息：名称、Lv 标签、效果条（含间隔值）与分割线后的详细描述。

### 本次对话追加（2026-03-02，战斗详情按实时数值展示 + 商店战斗区恢复职业徽标）

- 验收反馈：
  - 商店战斗区不应显示具体数值，需继续显示职业徽标；
  - 战斗中详情面板数值仍不准，需要按实时战斗数值展示。
- 修复一（商店显示口径）：
  - `src/scenes/ShopScene.ts`：战斗区徽标模式改回 `archetype`，不显示伤害/护盾数值。
- 修复二（战斗详情口径）：
  - `src/shop/SellPopup.ts`：新增 `ItemInfoRuntimeOverride`，支持注入实时 `cooldown/damage/shield/burn/poison/multicast/ammo`。
  - `SellPopup.show()` 增加 runtime 参数，且在 runtime 模式下禁用静态文案 guide，优先用真实技能行并替换为当前实时值。
  - `src/combat/CombatEngine.ts`：`getRuntimeState()` 新增 `cooldownMs` 字段，供详情面板展示实际冷却值。
  - `src/scenes/BattleScene.ts`：点击物品时把当前 runtime 数值传给详情面板；详情面板打开后每帧刷新（保持当前简/详模式不跳变）。
- 兼容补修：`src/combat/CombatEngine.ts` 放宽短剑“相邻护盾物品+护盾”文案匹配，确保战斗里该被动可稳定命中。
- 回归验证：`npm test` 通过（66/66）；`npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-02，详情模式补充效果条 + 间隔数值化）

- 先向主程确认实现路径：仅改 `src/shop/SellPopup.ts`，复用现有 `extractSimpleStatEntries`，将效果条渲染扩展到详细模式。
- 详细模式（detailed）现已与简版一致显示效果条（伤害/护盾/间隔等），并使用同一套字体大小与样式。
- 效果条下方新增分割线后再显示具体文本描述，信息分层更清晰。
- “速度”文案改为具体数值：统一显示 `间隔：x.x秒`（含顶部间隔文案与效果条中的间隔项）。
- 升级预览中的冷却对比也同步改为 `间隔：old秒 -> new秒`。
- 回归验证：`npm test` 通过（66/66）。

### 本次对话追加（2026-03-02，卡牌 Lv 字样改白字黑描边）

- 按验收要求调整卡牌上的 `Lv` 字样样式：
  - 文字改为白色（`0xffffff`）
  - 描边改为黑色（`0x000000`）
  - 描边宽度固定为 `2`
- `src/grid/GridZone.ts`：初始化与刷新逻辑统一使用上述样式。
- `src/grid/GridZone.ts`：`setTierStarStrokeWidth()` 保持接口兼容，但内部固定为 `2`，避免被调试项误改。
- 回归验证：`npm test` 通过（66/66）。

### 本次对话追加（2026-03-02，商店内战斗区被动实时生效 + 跳字提示）

- 验收目标：短剑/圆盾/回旋镖这类被动在商店战斗区内实时改面板，并在生效时出现跳字提示。
- `src/scenes/ShopScene.ts`：新增战斗区被动实时结算与徽标覆盖。
  - 新增 `refreshBattlePassiveStatBadges()`：按战斗区当前摆位实时计算并写入 `battleView.setItemStatOverride()`。
  - 已实现被动：
    - 短剑：相邻护盾物品护盾 +X
    - 圆盾：相邻武器伤害 +X
    - 回旋镖：全体武器伤害 +X
  - 支持星级分档（1星/2星）取值，按 `tier + star` 解析 `10/20` 这类序列。
- 跳字反馈：新增 `spawnPassiveJumpText()`，当被动使某装备数值上升时，在对应装备位置飘字提示（如 `🛡 +5`、`⚔ +10`）。
- 初始测试编队：`placeInitialItems()` 改为在背包预置以下 1星/2星各1件，便于你直接拖到战斗区联动测试：
  - 短剑（Bronze#1 / Bronze#2）
  - 圆盾（Bronze#1 / Bronze#2）
  - 回旋镖（Silver#1 / Silver#2）
- 作用域控制：仅战斗区应用该被动面板覆盖；背包区不吃被动。
- 回归验证：`npm test` 通过（66/66）；`npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-02，被动显示与短剑护盾加成补修）

- 验收反馈：
  - 战斗中圆盾→短剑增伤生效，但短剑→圆盾护盾未生效；
  - 商店阶段未看到战斗区数值变化与跳字。
- 修复一（战斗逻辑）：
  - `src/combat/CombatEngine.ts`：`shieldGainBonusForItem()` 的短剑匹配正则放宽，兼容“相邻的护盾物品护盾+X”写法，确保短剑能给相邻护盾物品加值。
- 修复二（商店可视化）：
  - `src/scenes/ShopScene.ts`：战斗区徽标模式改为 `stats`（不再是 `archetype`），可直接看到伤害/护盾数值变化。
  - 跳字层与实时被动刷新保持启用，拖拽调整相邻关系时会触发 `⚔/🛡 +X` 飘字。
- 回归验证：`npm test` 通过（66/66）；`npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-02，Vanessa 18件物品战斗逻辑全量接入）

- 已按流程先问主程 Notebook（`WebJs开发指南`）确认实现顺序；本次请求超时（timeout），先按技能文案全量落地。
- `src/combat/CombatEngine.ts`：完成当前 `data/vanessa_items.json` 全部18件物品核心战斗逻辑接入，重点包括：
  - 弹药体系：新增实例运行态 `ammoMax/ammoCurrent`，支持“弹药:X”“一次打出所有弹药”“补充弹药”“相邻最大弹药量”。
  - 攻击次数体系：支持“连续发射3次”“使用弹药物品时攻击次数+1（战斗内叠加）”。
  - 使用后成长：支持“每次攻击后伤害+X”“每次使用后护盾+X”“每次使用后伤害翻倍”“攻击后间隔不断缩短”。
  - 被动/触发：支持“相邻武器伤害+X”“全体武器伤害+X”“相邻武器攻击触发额外攻击”“其他武器攻击时自身伤害+X”“获得护盾时充能X秒”。
  - 护盾转伤：支持“根据当前护盾值对对方造成伤害”。
- `src/combat/CombatEngine.ts`：运行态扩展 `bonusMulticast`，并在 `toRunner()` / 敌方生成路径统一初始化；`getRuntimeState()` 新增返回弹药状态，便于调试。
- `src/combat/CombatEngine.test.ts`：新增三条回归用例：
  - 手弩“一次打出全部弹药”；
  - 圆盾“开场给相邻武器增伤”；
  - 超级手雷“每次使用后伤害翻倍”。
- 关联修复：前序已改动的 `SellPopup` 星级分档修复生效，局外描述可正确显示二星数值。
- 回归验证：`npm test` 通过（66/66）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：Vanessa 物品逻辑已从“基础伤害/状态”扩展为“弹药+连发+被动+触发”完整链路；后续可继续补可视化（弹药UI/触发飘字）和更细粒度数值校验。

### 本次对话追加（2026-03-02，Lv 字样描边改白色宽度 3）

- 按验收要求调整卡牌 `Lv` 字样描边：改为白色描边，固定宽度 `3`。
- `src/grid/GridZone.ts`：初始化样式与刷新样式统一使用 `stroke: { color: 0xffffff, width: 3 }`（通过 `tierStarStrokeWidth=3` 固定）。
- `setTierStarStrokeWidth()` 保持接口兼容，但内部固定为 `3`，防止被调试参数改走样。
- 回归验证：`npm test` 通过（66/66）。

### 本次对话追加（2026-03-02，简版描述去掉“玩法：”前缀）

- `src/shop/SellPopup.ts`：简版描述文案不再显示“玩法：”前缀。
- 兼容处理：若数据里已写了“玩法：xxx”，会在显示前自动去掉该前缀，避免重复或残留。
- 回归验证：`npm test` 通过（63/63）。

### 本次对话追加（2026-03-02，星级改 Lv1~Lv7 + 详情等级文案替换）

- 已与设计师确认展示口径：卡片底部用 `Lv1~Lv7` 文本替代星星；详情中等级改为 `LvX`，颜色仍按品质固定。
- `src/grid/GridZone.ts`：底部星级文本从 `★/★★` 改为 `Lv` 等级映射（青铜1/2=Lv1/2，白银1/2=Lv3/4，黄金1/2=Lv5/6，钻石=Lv7）。
- `src/grid/GridZone.ts`：等级文字描边改深色（`0x111111`），提升复杂背景可读性。
- `src/shop/SellPopup.ts`：详情等级标签不再显示“青铜1星”等字样，统一显示 `LvX`；徽章底色继续沿用品质色。
- 回归验证：`npm test` 通过（66/66）；`npm run build` 通过（保留 chunk size warning）。

### 本次对话追加（2026-03-02，敌方资金系数改线性50%→150% + 职业偏好构筑）

- 按验收口径调整敌方资金系数：
  - `src/combat/CombatEngine.ts` 新增 `getEnemyGoldFactorByDay(day)`，Day1 固定 `0.5`，Day20 固定 `1.5`，中间线性递增。
  - 敌方每日资金改为 `我方当日资金 × 该线性系数`（不再随机 50%~150%）。
- 敌方构筑策略增强：
  - 新增职业标签解析 `getPrimaryArchetypeTag()`，从 `tags` 提取主职业。
  - 敌方购买阶段会优先同职业池（约 85% 概率优先），尽量凑齐单职业装备；无可买时自动回退全池，避免卡死。
- 既有“同规则购入+随机合成+装配”流程保持不变，Day1 青铜限制口径保持。
- 回归验证：`npm test` 通过（63/63）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：敌方强度随天数稳定抬升，且更偏向形成单职业协同。

### 本次对话追加（2026-03-02，物品详情按星级分档显示修复）

- 验收反馈：局外详情中二星仍显示一星数值（木弓示例：应为“攻击100、每次使用后+100”）。
- 根因：`src/shop/SellPopup.ts` 详情分档索引仅按品质计算，未叠加 `#2` 星级偏移，导致 `50/100` 始终取第一档。
- 修复：
  - `src/shop/SellPopup.ts`：`tierIndex` 改为“品质索引 + 星级偏移”；
  - 同步修正 `fromTierIndex` 也按星级计算，保证带 `#2` 的描述替换一致。
- 结果：同品质二星详情会正确显示第二档数值（如木弓“攻击造成100伤害”“每次攻击后伤害+100”）。
- 回归验证：`npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-02，敌方改为同规则购入+随机合成，资金系数50%~150%）

- 按你的新规则完成战斗敌方经济/构筑改造：
  - `src/combat/CombatEngine.ts`：敌方不再固定模板铺场，改为“按天资金购入 + 合成 + 装配”流程。
  - 敌方日资金 = 我方当日资金 × 随机系数（`0.5~1.5`，按天种子随机，结果可复现）。
  - 购入规则与玩家一致：单次购入成本按 `3`，从可购候选池随机拿 Bronze。
  - 合成规则对齐玩家：同名+同品质+同星级触发合成，按品质阶梯进化（Bronze1→Bronze2→Silver1→Silver2→Gold1→Gold2→Diamond），并在“同尺寸 + 目标品质可用池”随机进化为新物品。
  - 装配规则：将库存物品随机装配到敌方战斗格，能放就上。
- 兼容口径：Day1 继续强制青铜池候选，避免开局出现高品质敌装。
- 额外修正：`toRunner()` 统一使用 `tier + tierStar` 计算玩家快照物品基础数值，确保星级加成在战斗中生效。
- 回归验证：`npm test` 通过（63/63）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：敌我都走“买→合→装”同类规则，敌方仅通过资金系数形成强弱差。

### 本次对话追加（2026-03-02，实例级基础数值入快照 + 星级生效）

- 已按流程先问主程 Notebook（`WebJs开发指南`）确认方案；本轮请求超时（timeout），先按你的口径做最小落地。
- 目标：让“合成升级后的数值”明确绑定到物品实例，进入战斗后按实例基础值结算，不再出现星级遗漏。
- `src/scenes/ShopScene.ts`：构建 `BattleSnapshot` 时，除 `tier/tierStar` 外新增实例 `baseStats` 写入（由 `resolveItemTierBaseStats` + 实例永久伤害加成计算）。
- `src/combat/BattleSnapshotStore.ts`：扩展 `BattleSnapshotEntity`，新增可选 `baseStats` 字段承载实例基础面板。
- `src/combat/CombatEngine.ts`：
  - `toRunner()` 优先消费快照中的 `entity.baseStats`，缺失时再回退到 `def + tier/tierStar` 推导；
  - 统一按 `tier + tierStar` 生成 `tierRaw`（如 `Bronze#2`）用于分档解析，确保星级进入战斗数值；
  - `tierIndex()` 改为“品质索引 + 星级偏移”，修复星级下技能文案分档取值；
  - runner 与 `getBoardState()` 补充 `tierStar`，表现层可直接读取实例星级。
- `src/combat/CombatEngine.test.ts`：新增回归用例“短剑青铜2星=20伤害”，验证星级确实影响基础伤害。
- 回归验证：`npm test` 通过（63/63）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：实例物品已具备“基础值（快照）+战斗内修正（runtime）”双层结构，可继续扩展其他实例级成长来源。

### 本次对话追加（2026-03-02，Day1 敌方品质锁定青铜）

- 验收反馈：Day1 观察到敌方疑似出现白银品质，不符合前期开局预期。
- 已先向主程 Notebook 快速确认口径：Day1 敌方应强制为“青铜1星”。
- `src/combat/CombatEngine.ts`：在敌方生成 `makeEnemyRunners()` 中新增 Day1 候选过滤：
  - 仅保留 `available_tiers` 含 Bronze 的物品；
  - Day1 进一步优先 `starting_tier=Bronze` 的物品池，避免首日出现高起始品质候选。
- 回归验证：`npm test` 通过（62/62）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：Day1 敌方品质已被强约束为青铜口径，后续天数仍按既有曲线推进。

### 本次对话追加（2026-03-02，简版/详细版循环切换 + 简版字号独立）

- 验收新增问题：背包拖拽（尤其下排拖到第一排失败）出现“红色松手后卡住”。
- 根因定位（`src/grid/DragController.ts`）：`doSnapBack()` 先清空了 squeeze 预览状态，再执行回弹恢复；当挤出已提交时，原位可能被占，导致回弹无法在系统层正确复位，出现“视觉在但逻辑不在”的卡住感。
- 修复：`doSnapBack()` 改为失败回弹时**回滚已提交挤出**（`clearSqueezePreview(true)`），优先保证拖拽物能稳定回到合法位置，不再出现红色松手后卡死。
- 当前行为：非法落位时会正常回弹并恢复可继续拖拽，不会把物品留在无效逻辑态。
- 回归验证：`npm test` 通过（66/66）。
- 追加修复（同问题链路）：对战区拖入背包第二排、以及背包一二排互换不稳定。
  - 根因：`DragController.findBestDropTarget()` 落点检测未带 `dragYOffset`，导致“手指锚点行”和“视觉物品行”错位，第二排常被判成第一排命中。
  - 修复：`src/grid/DragController.ts` 两处 `pixelToCellForItem(...)` 改为传入 `getConfig('dragYOffset')`，让拖放判定与视觉位置一致。
  - 结果：第二排命中恢复，背包第一/第二排换位逻辑与第一排一致。
- 再次回归修复（用户实测仍失败）：
  - 根因：`DragController.tryDrop()/updateHighlight()` 调用 `planUnifiedSqueeze()` 时未传 `homeZone`，跨区拖拽无法启用 cross-mode 方案（只能 fallback 到 footprint swap），在“对战区 -> 背包第二排”特定占位下会被误判不可换位。
  - 修复：`src/grid/DragController.ts` 为 `planUnifiedSqueeze()` 传入 `{ system: home.system, activeColCount: home.view.activeColCount }`（含高亮与实际落位两条链路）。
  - 结果：跨区换位/挤出可使用完整 unified 方案，不再局限于 footprint，第二排换位成功率恢复。
- 用户要求“背包两排按两个背包处理（视觉不变）”。
  - 实现策略（最小改动）：不拆 UI，不新增第二个 GridZone；仅在挤出算法层对 2 行背包启用 `rowLock`（按目标行锁定），达到“同排内独立换位”的效果。
  - `src/grid/SqueezeLogic.ts`：`trySqueezePlace/planUnifiedSqueeze/attemptRelocateBlockersAnyLayout` 新增可选 `rowLock`，在 rowLock 生效时禁用跨排的垂直/斜向挤出策略，只在目标行重排。
  - `src/grid/DragController.ts`：调用 `planUnifiedSqueeze()` 时，若目标区是 2 行（背包）则传入 `rowLock=finalRow`。
  - 结果：逻辑上把背包两排当作“两个独立背包”处理，避免跨排挤出导致的第二排换位失败；视觉与布局保持不变。
- 回归验证：`npm test` 通过（66/66）。

- 验收追加：简版参考示例样式，要求“伤害/护盾”用不同颜色，并在数值前加对应图标。
- `src/shop/SellPopup.ts`：简版首行改为“属性条目行”渲染（非纯文本）：
  - 伤害：红色 + 图标 `✦`
  - 护盾：金色 + 图标 `🛡`
  - 速度：蓝色 + 图标 `⏱`
- 条目行支持自动换行，避免窄宽度时溢出；下方保留“玩法”一行与分隔线。
- 当前效果：简版视觉层级更接近参考图（图标化 + 数值高亮）。
- 修正：补充窄面板自适应布局（`simpleNarrowLayout`），当“左图标 + 右文本”空间不足时，简版文本自动换到图标下方全宽显示，避免出现“简版信息看不到”。
- 问题回归修复：用户反馈“战斗中有简版，商店中直接是复杂版”。
  - 根因：`ShopScene` 的 `sellPopup.show(...)` 调用链路在近期合并中丢失了 `infoMode` 传参与切换状态机，导致默认落到 detailed。
  - 修复：`src/scenes/ShopScene.ts` 恢复商店侧简版/详细版状态机（`selectedInfoKey/selectedInfoMode`），并在点选物品/商店槽位时传入 `infoMode`。
  - 补充：拖拽中详情固定使用简版，避免拖拽过程中误切详细。
  - 行为：商店与战斗统一为“首次简版、再次点击同目标详细、再点回简版”的循环逻辑。
- 回归验证：`npm test` 通过（63/63）。

- 验收反馈：
  - 同一物品详情应在“简版 <-> 详细版”之间循环切换（再次点击同物品可回到简版）。
  - 简版文字大小需要单独配置。
- `src/scenes/ShopScene.ts`：`resolveInfoMode()` 改为双向切换逻辑：同 key 点击时 `simple/detailed` 循环切换；切换到新物品时重置为 `simple`。
- `src/scenes/BattleScene.ts`：战斗场景同样改为 `simple/detailed` 循环切换。
- `src/shop/SellPopup.ts`：新增简版独立字号参数 `simpleDesc`，简版文本不再复用详细描述字号。
- 配置同步（按约定：`game_config + debugConfig + debugPage`）：
  - `data/game_config.json`：`text_sizes` 已包含 `itemInfoSimpleDesc`。
  - `src/items/ItemDef.ts`：`textSizes.itemInfoSimpleDesc` 类型字段已接入。
  - `src/config/debugConfig.ts`：新增 `itemInfoSimpleDescFontSize`。
  - `src/debug/debugPage.ts`：将 `itemInfoSimpleDescFontSize` 加入“字体大小”分组。
  - `data/debug_defaults.json`：新增默认值 `itemInfoSimpleDescFontSize: 24`。
- 场景接线：`ShopScene/BattleScene` 调用 `setTextSizes()` 时都传入 `simpleDesc`，可在线独立调简版字号。
- 回归验证：
  - `npm run build` 通过（保留既有 chunk size warning）。
  - `npm test` 本次存在 1 个现有失败（`src/items/itemTierStats.test.ts` 期望与当前数据不一致：期望 20，实际 10），与本轮 UI 交互改动无直接关联。

### 本次对话追加（2026-03-02，紧急难度回调：打不过问题热修）

- 验收反馈：当前版本“敌方数值过高，基本无法通关”。
- 已做紧急平衡热修（`data/game_config.json`）：
  - `daily_gold_by_day` 上调（Day1~20：`12 -> 52`，整体更快增量）。
  - `daily_enemy_health` 全段下调（Day1~20：`140 -> 1780`）。
  - `daily_player_health` 全段上调（Day1~20：`240 -> 2140`）。
  - `daily_health` 兼容字段同步为敌方曲线，避免旧逻辑口径不一致。
  - `combat_runtime.fatigueStartMs` 从 `25000` 调整为 `30000`，减少疲劳主导导致的“无力感”。
- 配套修复：
  - `src/items/ItemDef.ts` 补全 `text_sizes.itemInfoSimpleDesc` 类型，修复构建阶段类型报错。
  - `src/scenes/BattleScene.ts` 修正战斗退出转场变量引用，恢复 TS 构建通过。
- 回归验证：`npm test` 通过（62/62）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：已切到“更易打赢”的首轮修正版；待你体验后再做第二轮精调。

## 本次对话追加（2026-02-28，阶段3-P1最小切片开发中）

### 本次对话追加（2026-03-02，按要求清空初始物品 + 回传Notebook）

- `src/scenes/ShopScene.ts`：已移除新局自动刷“4长盾+1长剑”测试物品逻辑，当前新局初始为清空状态（无额外测试刷物）。
- `src/combat/CombatEngine.ts`：护盾充能调试日志开关已关闭（`DEBUG_SHIELD_CHARGE=false`）。
- Notebook 回传：已将本轮变更与排查结论写入主程 Notebook（source id: `2e4bfeb3-c7ed-4838-90dc-93af28482b43`，标题“2026-03-02 商店初始清空与护盾充能排查结果”）。
- 回归验证：聚焦回归（ShopManager/DataLoader/CombatEngine）通过。

### 本次对话追加（2026-03-02，护盾充能调试日志已关闭）

- 你确认“本次成功且效果生效”后，已关闭护盾充能调试日志开关。
- `src/combat/CombatEngine.ts`：`DEBUG_SHIELD_CHARGE` 从 `true` 改为 `false`，运行时不再输出 `shield-charge/护盾充能` 日志。

### 本次对话追加（2026-03-02，护盾充能日志可见性修复 + 单值解析修复）

- 你反馈“搜不到 shield 日志”，已改为 `console.warn`，并统一前缀：`[CombatEngine][shield-charge][护盾充能]`，在浏览器控制台可直接搜 `护盾充能`。
- 排查出核心原因：`tierValueFromLine()` 原正则只支持 `a/b` 分档，不支持单值（如“充能1秒”），导致“获得护盾时充能1秒”实际取值为 0。
- `src/combat/CombatEngine.ts`：将数值解析正则从“必须含分档”改为“支持单值或分档”，护盾充能现已实际入账。
- 聚焦验证日志已出现：
  - `shield_gain_happened`
  - `on_shield_gain_detected`（含 `gainMs: 1000`）
- 回归：护盾充能相关聚焦测试通过。

### 本次对话追加（2026-03-02，按验收要求增加护盾充能日志）

- 因你反馈“硬刷新后仍不对”，已在 `CombatEngine` 增加护盾充能全链路调试日志（默认开启）。
- `src/combat/CombatEngine.ts` 日志前缀：`[CombatEngine][shield-charge]`，覆盖关键节点：
  - `on_shield_gain_detected`
  - `queued_fire_exists_add_pending`
  - `overflow_to_pending`
  - `queue_extra_fire`
  - `dequeue_fire`
  - `dequeue_fire_resolve`
  - `apply_pending_to_fresh_cycle`
  - `queue_from_pending_charge`
- 额外修正：战斗详情面板去除每帧冷却键抖动来源（不再因 cooldown 字段变化导致重建闪烁）。
- 当前对比口径已恢复同CD：长剑/长盾均为 `5000ms`（便于观察你要求的“4/5进度”）。
- 验证：护盾充能相关聚焦测试通过（`长盾触发护盾后...`、`护盾充能触发...100ms排队...`）。

### 本次对话追加（2026-03-02，CD显示抖动与充能进度继承修正）

- 问题1（你反馈）：信息面板“间隔”持续变化且图标闪动。
  - 原因：战斗面板按每帧剩余 CD 刷新并重建内容。
  - 修复：`src/scenes/BattleScene.ts` 改为展示基础间隔（不按每帧剩余值替换），并移除 `nextKey` 中的 cooldown 维度，避免每帧反复刷新导致闪动。
- 问题2（你反馈）：获得护盾后长剑进度无明显修正。
  - 修复：`src/combat/CombatEngine.ts` 增加 `pendingChargeMs` 机制：
    - 护盾充能在“当前循环无法立即体感生效”时记录为待应用充能；
    - 进入新一轮 CD 后优先扣减（等价于直接前移进度）；
    - 与既有“100ms 排队触发”规则兼容（不会同 tick 连续触发）。
- 数据核对修正：`data/vanessa_items.json` 当前确认为 `长盾=6000ms`，`短剑/圆盾=5000ms`（已排除之前误改）。
- 回归验证：聚焦 DataLoader + CombatEngine 测试通过。

### 本次对话追加（2026-03-02，长盾CD临时改为6秒用于对比测试）

- 按你的建议做临时对照实验：将“长盾”CD从 `5000ms` 改为 `6000ms`，便于观察“获得护盾时充能”对长剑节奏的差异。
- 修改位置：`data/vanessa_items.json`（长盾 `cooldown` 与 `cooldown_tiers` 同步改为 `6000`）。
- 现有初始测试阵容仍保持：4 长盾 + 1 长剑。
- 验证：针对 DataLoader + CombatEngine 回归通过。
- 修正记录：过程中曾误改到短剑/圆盾CD，现已恢复为 `5000ms`；当前生效值为：短剑 `5000`、圆盾 `5000`、长盾 `6000`。

### 本次对话追加（2026-03-02，回归同CD口径便于验证4/5进度）

- 根据你最新验收反馈，已把“长盾”CD从临时 `6000ms` 回滚到 `5000ms`，恢复与长剑同CD口径，便于复测“同轮触发后长剑应有4/5进度”场景。
- 当前CD口径：短剑 `5000`、圆盾 `5000`、长盾 `5000`。

### 本次对话追加（2026-03-02，初始测试阵容改为 4 长盾 + 1 长剑）

- 按你的测试要求调整初始刷物：新局（无恢复存档）只刷以下 5 件，其他不再刷：
  - 长盾 x4（Silver#1）
  - 长剑 x1（Silver#1）
- `src/scenes/ShopScene.ts`：复用 `spawnAllLv3ItemsForTest()` 作为固定测试阵容入口，内容改为上述清单。
- 验证：已跑针对性回归（DataLoader/ShopManager/CombatEngine）通过。

### 本次对话追加（2026-03-02，按验收要求改为“100ms排队充能触发”）

- 依据你的明确口径，重做“获得护盾时充能1秒”触发时序：
  - 不再同 tick 立即 `resolveFire`。
  - 当充能达到可释放阈值后，统一进入 `pendingItemFires` 队列，最早 `+1 tick`（100ms）触发。
  - 同一物品多重触发按队列顺延（每个触发至少间隔 100ms）。
- `src/combat/CombatEngine.ts`：
  - 新增 `PendingItemFire`、`pendingItemFires`、`lastQueuedFireTickByItem`。
  - `applyOnShieldGainCharge()` 改为“记录并排队”。
  - `stepOneTick()` 增加 `resolveQueuedItemFiresForCurrentTick()`，按 tick 出队触发。
  - 冻结状态下会顺延到下一 tick，保持队列语义。
- `src/combat/CombatEngine.test.ts`：新增
  - `护盾充能触发的额外释放会按100ms排队而非同tick立即连续触发`。
- 回归验证：`npm test` 通过（78/78）。
- 过程备注：尝试向主程 NotebookLM 再次确认该具体实现方案时请求超时；本轮按你给出的明确执行口径直接落地。

### 本次对话追加（2026-03-02，长剑/长盾“同5秒”观感排查与显示口径修正）

- 结论：战斗逻辑侧已生效，长盾触发护盾后长剑触发频率确实更高；但信息面板此前展示的是基础 `cooldownMs`，会造成“看起来一直5秒”的错觉。
- `src/scenes/BattleScene.ts`：战斗信息面板 runtime override 的 `cooldownMs` 改为“剩余冷却”(`cooldownMs - currentChargeMs`)，不再显示固定基础值。
- 现象变化：长剑在吃到“获得护盾时充能1秒”后，面板间隔数值会即时下降，能直观看到快于长盾。
- 新增/强化验证：`src/combat/CombatEngine.test.ts` 增加 `长盾触发护盾后，长剑触发频率应高于长盾`，并提高断言强度（至少多触发 2 次）。
- 回归验证：`npm test` 通过（77/77）；并单测聚焦跑通该条用例。

### 本次对话追加（2026-03-02，护盾充能“立即生效到下一轮CD”）

- 验收反馈：同 CD 情况下，获得护盾后“充能1秒”体感不明显，期望一触发就立即作用到下一轮。
- `src/combat/CombatEngine.ts`：`applyOnShieldGainCharge()` 改为“充能后立即判定可释放”。
  - 先给符合技能的物品累加 `currentChargeMs`。
  - 若达到 `cooldownMs`（且弹药条件满足），立即重置充能并在同一触发链里 `resolveFire(owner)`，不等待下一 tick。
  - 效果：护盾触发后可即时推进下一次 CD（达到阈值时立即开火）。
- 回归验证：`npm test` 通过（76/76）。

### 本次对话追加（2026-03-02，补充初始测试武器：长剑/长盾）

- `src/scenes/ShopScene.ts`：新增 `spawnSpecificTestItems()`，在新局初始测试布置中额外加入：
  - 长剑（Silver#1）
  - 长盾（Silver#1）
- 放置规则与现有测试刷物保持一致：优先战斗区、放不下再进背包，默认从前到后。
- 回归验证：`npm test` 通过（76/76）。

### 本次对话追加（2026-03-02，商店态被动预览同步修复：切割镰刀不再误加全局伤害）

- 复核后发现你反馈属实：虽然战斗引擎已修复，但商店态 `refreshBattlePassiveStatBadges()` 里仍有同类正则误匹配，导致拖上切割镰刀时预览里仍出现“全武器+100”。
- `src/scenes/ShopScene.ts`：修正商店态 `boomerangLine` 匹配，新增排除 `其他武器攻击时该物品伤害+...`，与战斗引擎口径保持一致。
- 回归验证：`npm test` 通过（74/74）。

### 本次对话追加（2026-03-02，切割镰刀被动误判修复）

- 问题：切割镰刀“使用其他物品攻击时该物品伤害+100/200”被误匹配为开场“全武器伤害+X”，导致所有武器自动+100。
- 修复：`src/combat/CombatEngine.ts` 中开场被动匹配 `allWeaponDamageLine` 增加排除条件：`! /其他武器攻击时该武器伤害\+/`，避免把切割镰刀误判成全局被动。
- 新增回归：`src/combat/CombatEngine.test.ts`
  - `切割镰刀不会在开场给所有武器自动+100伤害`，验证短剑首发基础伤害仍为 10。
- 回归验证：`npm test` 通过（74/74）。

### 本次对话追加（2026-03-02，初始刷出全部 Lv3 物品用于联调）

- `src/scenes/ShopScene.ts`：新增 `spawnAllLv3ItemsForTest()`。
  - 在“无恢复存档的新局”进入商店时自动执行。
  - 会把所有可出 Gold 品质物品（视作 Lv3）按“先战斗区、后背包；从前到后”规则依次放置。
  - 新刷出的测试物品统一为 `Gold#1`。
- 兼容修正：顺手修正 `selectGridItem` 中 `ShopManager.getSellPrice/sellItem` 的参数签名，避免类型不匹配。
- 回归验证：`npm test` 通过（73/73）。

### 本次对话追加（2026-03-02，连发子弹“立即生效”修正）

- 需求补充：连发增加攻击力应立即作用于当次飞出的子弹，三连发每一发伤害应不同。
- `src/combat/CombatEngine.ts`：
  - 在 `PendingHit` 增加 `attackerDamageAtQueue`（记录入队时攻击面板基准）。
  - 在 `resolvePendingHitsForCurrentTick()` 中：先触发 `battle:item_fire` 与攻击类被动，再以 `currentAttackerDamage - attackerDamageAtQueue` 计算当发动态增量，实时修正该发 `baseDamage/damage`。
  - 结果：同一轮连发中，后续子弹会吃到前序触发链带来的增伤，形成逐发差异。
- `src/combat/CombatEngine.test.ts`：新增用例 `连发飞镖三发伤害逐发变化（同轮内不应完全相同）`，验证三发 `amount` 严格递增。
- 回归验证：`npm test` 通过（72/72）。

### 本次对话追加（2026-03-02，连发触发时机修正为逐发tick）

- 已按主程确认口径调整：`相邻物品攻击后` 类被动从 `resolveFire` 阶段下沉到 `pending hit` 实际发射结算 tick 同步触发（与 `battle:item_fire` 同 tick）。
- `src/combat/CombatEngine.ts`：
  - 移除在 `resolveFire` 中按 `fireCount` 预先叠加触发的逻辑。
  - 在 `resolvePendingHitsForCurrentTick()` 内每个 hit 结算时触发 `applyOnWeaponAttackTriggers(attacker)`。
  - 效果：连发3次会在三个 tick 分别触发，而不是一次性+3倍。
- 新增回归测试：`src/combat/CombatEngine.test.ts`
  - `连发触发按实际发射tick逐次生效（10->12->14->16）`，验证匕首增伤按三次发射时序逐步生效。
- 主程沟通记录：本轮已通过主程 NotebookLM 获得“下沉到 pending hit 实际结算 tick”的确认后实施。
- 回归验证：`npm test` 通过（69/69）。

### 本次对话追加（2026-03-02，连发触发链修复：按连发次数触发攻击类被动）

- 问题：连发飞镖（3连发）在匕首旁只触发 1 次“相邻物品攻击后，所有武器伤害+2/4”。
- 修复：`src/combat/CombatEngine.ts` 中将 `applyOnWeaponAttackTriggers(item)` 从“单次开火后调用一次”改为“随 `fireCount` 每次子攻击调用一次”。
  - 结果：连发次数会正确驱动“物品攻击时”类被动（与你确认的口径一致）。
- 新增回归：`src/combat/CombatEngine.test.ts`
  - 用例 `连发飞镖3连发会触发3次“相邻物品攻击后全体增伤”`，验证短剑基础伤害至少从 10 提升到 16（+2 * 3）。
- 主程沟通过程：已尝试调用主程 NotebookLM 获取最小改动建议，但本次请求超时；本轮修复按现有引擎触发口径与测试驱动落地。
- 回归验证：`npm test` 通过（68/68）。

### 本次对话追加（2026-03-02，弹药物品右下角 x/x 显示）

- `src/grid/GridZone.ts`：新增卡牌右下角弹药徽标（半透黑底 + 弹药图标 + `x/x` 文案）。
  - 静态场景（商店/背包）：从物品技能文案中的 `弹药:1/2/...` 按当前品质/星级解析，显示 `max/max`。
  - 运行场景（战斗）：支持外部实时覆盖 `current/max`，用于反映战斗中的消耗与补充。
  - 拖拽时与其他徽标一致隐藏，落位后恢复。
- `src/grid/GridZone.ts`：新增 `setItemAmmo(instanceId, current, max)` 接口，统一驱动弹药显示更新。
- `src/scenes/BattleScene.ts`：在每帧 runtime 同步里接入 `zone.setItemAmmo(rt.ammoCurrent, rt.ammoMax)`，弹药会随战斗实时变化。
- 兼容修正：清理 `BattleScene` 中遗留的 `SellPopup` 旧签名调用，保持当前信息面板接口一致。
- 回归验证：`npm test` 通过（66/66）；`npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-02，商店简版字号未生效修复）

- 问题定位：商店 `SellPopup` 在调试字号同步时遗漏了 `simpleDesc` 参数，导致“信息简版字号”滑杆（28）未传入商店面板，使用了默认较小字号。
- `src/scenes/ShopScene.ts`：在 `applyItemInfoPanelLayout()` 与 `applyTextSizesFromDebug()` 两处 `sellPopup.setTextSizes()` 中补回 `simpleDesc: getDebugCfg('itemInfoSimpleDescFontSize')`。
- 结果：商店与战斗场景的简版字号来源统一，调试页“信息简版字号”设置可同时生效。
- 回归验证：`npm test` 通过（63/63）。

### 本次对话追加（2026-03-02，按表格更新简版/复杂版描述）

- `src/shop/SellPopup.ts`：新增 18 件物品的“简版/复杂版描述”映射（按你提供表格口径）。
  - 简版用于 `simple` 模式玩法文案。
  - 复杂版用于 `detailed` 模式，并支持随星级/品质分档替换与升级对比。
- `data/vanessa_items.json`：已保持与当前星级口径一致（青铜/白银/黄金单品质 + 1|2 星分档），并恢复“弹药袋”文案为 `补充1/2发弹药`。
- 稳定性修复：清理了此前残留的详情模式调用不一致问题，避免再次出现 `resetInfoModeSelection` 类运行时错误。
- 回归验证：`npm test` 通过（63/63）；`npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-02，按表格口径修正品质与星级数值）

- 修复启动报错：`resetInfoModeSelection is not defined`（清理了遗留调用与不兼容的 `SellPopup.show(..., mode)` 旧参数）。
- `data/vanessa_items.json`：按表格“对应品质=XX1|2星”口径收敛物品品质范围：
  - 青铜组（前 6 件）统一为 `available_tiers: Bronze`
  - 白银组（中 6 件）统一为 `available_tiers: Silver`
  - 黄金组（后 6 件）统一为 `available_tiers: Gold`
  - `弹药袋` 文案恢复为 `给相邻的物品补充1/2发弹药。`
- `src/items/itemTierStats.ts`：新增 `#星级` 解析（如 `Bronze#2`），基础数值按“品质基准 + 星级位移”选取分档值，支持同品质 1/2 星数值差异。
- `src/scenes/ShopScene.ts`：战斗快照保留 `tierStar`，并在快照里写入星级后的 `baseStats`，确保战斗内按星级生效。
- 回归验证：`npm test` 通过（63/63）；`npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-02，弹药袋品质边界修正）

- 验收问题定位：之所以会出现“白银弹药袋”，是因为该物品在数据里配置为 `available_tiers: Bronze/Silver`，合成升级池会合法抽到白银版本。
- `data/vanessa_items.json`：将“弹药袋”品质范围改为仅 `Bronze`。
- `data/vanessa_items.json`：同步将技能文案从“补充1/2发弹药”调整为“补充1发弹药”，与单品质配置一致。
- 回归验证：`npm test` 通过（62/62）。

### 本次对话追加（2026-03-02，回到商店转场动画）

- 已按流程先问询：
  - 主程 Notebook（`WebJs开发指南`）已返回可执行建议，本轮按“最小侵入”落地。
  - 设计师 Notebook（`手机大巴扎设计`）本次请求超时（timeout）。
- `src/scenes/BattleScene.ts`：回店不再立即切场，点击“回到商店”后先播放战斗侧淡出转场。
  - 新增 `sceneFadeOverlay` 全屏黑幕层，alpha 从 0 渐变到 1。
  - 淡出完成后再 `SceneManager.goto('shop')`，保持结算/快照写入先于切场。
  - 转场期间禁用回店按钮与倍速按钮交互，避免重复触发。
- 新增可调参数：
  - `battleToShopTransitionMs`（回店转场时长）
  - 已同步：`src/config/debugConfig.ts`、`data/debug_defaults.json`、`src/debug/debugPage.ts`（战斗表现分组）。
- 兼容修正：`src/shop/SellPopup.ts` 启动默认字号读取 `simpleDesc` 改为复用 `itemInfoDesc`，避免缺失字段导致构建失败。
- 回归验证：`npm test` 通过（62/62）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：开战与回店都具备过渡动画；可继续按你手感调参细化时序。

### 本次对话追加（2026-03-02，简版详情去头部与图标）

- 验收反馈：简版信息不需要显示左侧图标和顶部信息（名称/品质/冷却）。
- `src/shop/SellPopup.ts`：简版模式下隐藏以下元素：
  - 左侧图标与图标边框
  - 顶部名称、品质徽标、冷却文本
  - 描述区改为全宽布局，仅保留三行简版内容（核心数值/速度/玩法）。
- `src/shop/SellPopup.ts`：简版玩法去数值后补充清洗规则，修复“连续发射次”这类尾字残留（去掉尾部“次”）。
- 回归验证：`npm test` 通过（62/62）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：简版已收敛为纯关键信息块，无图标和头部干扰。

### 本次对话追加（2026-03-02，简版信息布局二次调整）

- 验收反馈：简版仍需显示左侧图标；“核心数值 + 速度”需合并到同一行。
- `src/shop/SellPopup.ts`：简版模式调整为：
  - 恢复左侧图标与图标框显示。
  - 头部信息（名称/品质/冷却）继续隐藏。
  - 简版文本改为两行：
    - 第一行：`核心数值 + 速度`（如 `伤害：5  速度：快`）
    - 第二行：`玩法：...`
- `src/shop/SellPopup.ts`：简版布局恢复为“左图标 + 右文本”结构，保证与卡片视觉一致。
- 回归验证：`npm test` 通过（62/62）。
- 当前状态：简版信息密度进一步收敛，接近验收目标。

### 本次对话追加（2026-03-02，15天体验首版平衡 + 设计师/主程同步）

- 已完成“当前机制与卡设定”同步：
  - 设计师 Notebook（`手机大巴扎设计`）同步成功，收到确认“已完全收到并理解”；反馈建议强调前期低保经济、中后期倒卖爆发、分段HP膨胀与可解释失败原因。
  - 主程 Notebook（`WebJs开发指南`）复核通过：认可本版可测，并给出下一轮 AB 调参方向（重点关注后期金币溢出、Fatigue 触发率、Day15通关率）。
- 已落地首版可体验参数（配置化）：
  - `data/game_config.json` 新增 `daily_gold_by_day`（Day1~20 递增），用于“购买价3”下的逐日增长经济曲线。
  - `data/game_config.json` 新增 `daily_enemy_health` / `daily_player_health`（Day1~20），并将 `daily_health` 作为兼容字段对齐敌方曲线。
  - `src/shop/ShopManager.ts` 新增 `getDailyGoldForDay()`，开局与跨天金币发放均改为按天读取。
  - `src/scenes/ShopScene.ts`：Debug 改天时补金币改为按 `daily_gold_by_day` 发放。
  - `src/combat/CombatEngine.ts`：战斗开局 HP 改为按 `daily_enemy_health` / `daily_player_health` 分别读取。
  - `src/core/DataLoader.ts` 与 `src/items/ItemDef.ts`：扩展新配置字段读取与类型定义。
  - `src/core/DataLoader.test.ts`：新增按天金币与敌我 HP 曲线配置测试。
- 回归验证：`npm test` 通过（62/62）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：15天体验首版平衡已可直接体验；下一步建议按主程指标做 A/B（平均时长18~22s、Fatigue触发率<15%、Day15通关率45~55%）。

### 本次对话追加（2026-03-02，商店套路徽标下移避让）

- 根据验收截图反馈，商店中的套路徽标（战/弓/刺）整体下移，避免遮挡上一行卡牌。
- `src/grid/GridZone.ts`：在 `archetype` 徽标模式下追加 `+14px` 的 Y 偏移；战斗数值徽标模式保持原位置不变。
- 回归验证：`npm test` 通过（62/62）。

### 本次对话追加（2026-03-02，开战转场动画首版落地）

- 已按流程先问询：
  - 主程 Notebook（`WebJs开发指南`）本次请求超时（timeout）。
  - 设计师 Notebook（`手机大巴扎设计`）本次请求超时（timeout）。
  - 因两侧均超时，本轮先按你的口径落地最小可验收版本，并标注为 `[待设计确认]`。
- 交互实现（`src/scenes/ShopScene.ts`）：
  - 点击“战斗”后不再立即切场，新增商店侧转场流程。
  - 背包区执行“向下移动 + 淡出”；底部按钮区与 Day 调试区渐隐。
  - 我方战斗区按 `battleZoneYInBattleOffset` 向下移动，模拟对齐战斗场景位置。
  - 转场结束后再执行 `SceneManager.goto('battle')`，并保持既有快照/进度保存链路。
- 战斗入场实现（`src/scenes/BattleScene.ts`）：
  - 新增战斗场景整体淡入（主角/敌人/UI 一起渐显）。
  - 淡入完成前暂停战斗 Tick 推进，避免“UI未出现就已开打”。
- 新增可调参数（已接入配置与调试页“战斗表现”分组）：
  - `shopToBattleTransitionMs`
  - `shopToBattleBackpackDropPx`
  - `shopToBattleBackpackAlpha`
  - `shopToBattleButtonsAlpha`
  - `battleIntroFadeInMs`
  - 对应文件：`src/config/debugConfig.ts`、`data/debug_defaults.json`、`src/debug/debugPage.ts`。
- 回归验证：`npm test` 通过（62/62）；`npm run build` 通过（保留既有 chunk size warning）。
- 设计待确认项 `[待设计确认]`：
  - 转场是否需要“分段时序”（先背包后按钮再战斗区）还是保持当前并行渐变。
  - 主角/敌人/UI 是否需要分层错峰淡入（当前为整体统一淡入）。

### 本次对话追加（2026-03-02，物品详情“简版/详细版”二段点击）

- 已按流程先问主程与设计师 Notebook：
  - 主程（`WebJs开发指南`）请求超时（timeout）。
  - 设计师（`手机大巴扎设计`）请求超时（timeout）。
  - 本轮按你的交互要求先落地最小实现。
- `src/shop/SellPopup.ts`：新增信息模式 `simple/detailed`。
  - 简版文案改为三行：核心数值（如“伤害：30”）、速度（快/中等/慢等）、玩法一句（去数值描述）。
  - 详细版保持现有完整数值描述与多行分隔展示。
  - 升级预览入口固定使用详细版，避免对比信息被折叠。
- `src/scenes/ShopScene.ts`：接入“同一目标二次点击切详细”的选择状态机。
  - 首次点击任意商店/战斗区/背包物品显示简版。
  - 再次点击同一物品切换到详细版；切到其他物品时重置为简版。
  - 拖拽态详情统一显示简版。
- `src/scenes/BattleScene.ts`：战斗中物品详情同样接入二段点击规则（首次简版、再次同物品详细）。
- 回归验证：`npm test` 通过（62/62）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：该交互已可人工验收（商店与战斗场景一致口径）。
- 下一步计划：按你的验收反馈微调“简版玩法一句”的去数值措辞（若需对个别物品定制文案，再补充到数据配置层）。

### 本次对话追加（2026-03-02，商店武器徽标改为套路图标，战斗仍显示数值）

- `src/ui/itemStatBadges.ts`：新增徽标显示模式 `stats | archetype`。
  - `archetype` 模式下，对武器（含 战士/弓手/刺客 标签）显示套路徽标，不显示数值。
  - 徽标使用不同颜色与字符：战/弓/刺。
- `src/grid/GridZone.ts`：新增 `setStatBadgeMode()`，支持按场景切换徽标显示模式。
- `src/scenes/ShopScene.ts`：商店中的战斗区与背包区都切到 `archetype` 模式（显示套路）。
- `src/scenes/BattleScene.ts`：保持默认 `stats` 模式（战斗中显示具体数值），无需额外改动。
- 兼容修正：`ShopScene` 移除无效导入 `getDailyGoldForDay`，日金币发放改回 `getConfig().dailyGold`。
- 回归验证：`npm test` 通过（62/62）；`npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-02，下排合成优先再增强：多点探针）

- 针对“仍有下排先挤出未合成”的复现反馈，继续增强合成优先命中逻辑。
- `src/scenes/ShopScene.ts`：`findSynthesisTargetWithDragProbe()` 从单一 Y 补偿升级为多点探针：
  - X 方向加入左右偏移探针（覆盖手指不在物品中心的情况）。
  - Y 方向同时探测原始点、`dragYOffset`、半偏移及上下扩展点。
- 作用：在拖拽视觉偏移和手指偏位场景下，优先识别同物品同品质同星目标，降低误入挤出分支概率。
- 回归验证：`npm test` 通过（62/62）；`npm run build` 通过（保留 chunk size warning）。

### 本次对话追加（2026-03-02，下排同物品优先合成修复）

- 验收反馈：下排同物品拖拽时未优先触发合成，仍进入挤出。
- 根因：拖拽合成判定使用手指锚点坐标；受 `dragYOffset` 影响，手指与物品视觉位置存在偏移，尤其在下排靠近底部时更易漏判，导致未抑制挤出。
- 修复：`src/scenes/ShopScene.ts` 新增 `findSynthesisTargetWithDragProbe()`，对同一拖拽点使用多组 Y 探针（原始锚点 + 偏移补偿）做合成命中检测。
- 已替换调用点：商店拖拽移动/抬手、网格拖拽移动/抬手的合成判定均改用该探针函数，确保“合成优先于挤出”在下排同样稳定生效。
- 回归验证：`npm test` 通过（62/62）；`npm run build` 通过（保留 chunk size warning）。

### 本次对话追加（2026-03-02，挤出重叠覆盖修复：原子提交）

- 验收复现：挤出时偶发把物品挤到已占位置，出现同格叠放（短剑/手里剑/箭袋重叠）。
- 根因：本地挤出执行仍是逐个 `remove/place`，链式移动在某些顺序下会产生临时占位冲突。
- 方案（主程确认）：改为两阶段原子提交。
  - `src/grid/DragController.ts` 新增 `commitLocalSqueezeMoves()`：先收集并移除所有待移动物品，再统一 `place`；若任一失败则整体回滚到原位。
  - `tryDrop()` 与 `updateSqueezePreview()` 均改为调用该原子提交函数，不再逐个提交。
- 结果：链式挤出不再出现“挤到已占位导致重叠”问题。
- 回归验证：`npm test` 通过（62/62）；`npm run build` 通过（保留 chunk size warning）。

### 本次对话追加（2026-03-02，合成优先策略修正：仅命中目标时禁挤出）

- 最新验收反馈确认：全局“有候选即禁挤出”会误伤正常换位（拖到非合成位置也不能挤出）。
- 已修正为目标态策略：
  - `src/scenes/ShopScene.ts`：移除 `hasAnySynthesisCandidate()` 全局抑制，仅在 `findSynthesisTargetWithDragProbe()` 命中时才 `setSqueezeSuppressed(true, true)`。
  - `src/scenes/ShopScene.ts`：合成命中增强（取消 zone-area 门槛 + 双向偏移探针），重点提升第二排命中稳定性。
  - `src/grid/DragController.ts`：保留“命中合成时回滚已预提交挤出”和“drop 阶段 suppress 下不走挤出”的硬保护。
- 结果：拖到可合成目标时只合成不挤出；拖到其他目标时恢复正常挤出。
- 回归验证：`npm test` 通过（62/62）；`npm run build` 通过（保留 chunk size warning）。

### 本次对话追加（2026-03-02，合成优先时禁止预提交挤出）

- 验收复现：拖到可合成目标时，先发生了挤出，随后才显示合成高亮，造成“同时触发”错觉与错误行为。
- 根因：`DragController` 在 hover 阶段会预提交挤出（含跨区），而合成命中在后续帧才抑制，导致已提交的挤出不回滚。
- 修复：
  - `src/grid/DragController.ts`：当判定为 `cross` 挤出时改为“仅高亮可放置”，不在 hover 阶段执行跨区搬运。
  - `src/grid/DragController.ts`：本地挤出预提交增加 `revert` 记录；`setSqueezeSuppressed(true, true)` 时回滚本次已提交挤出。
  - `src/scenes/ShopScene.ts`：合成命中时改为调用 `drag?.setSqueezeSuppressed(true, true)`，确保合成优先并撤销预提交挤出。
- 结果：命中可合成目标时，不再保留挤出结果；视觉与逻辑都保持“只合成，不挤出”。
- 回归验证：`npm test` 通过（62/62）；`npm run build` 通过（保留 chunk size warning）。

### 本次对话追加（2026-03-02，背包下排挤出与下排合成命中修复）

- 已先问主程与设计师：
  - 主程 Notebook 请求超时，本轮先按最小技术修复落地。
  - 设计师 Notebook 返回“当前资料无该交互细则”，因此按验收口径执行“上下排一致规则”。
- 根因与修复：
  - `src/grid/SqueezeLogic.ts` 仍有多处单行硬编码（`row+h>1`、`maxRow=1-h`、`for r<1`、列上限写死 `6`），导致下排挤出策略退化。
  - 已改为按虚拟网格实际行列数计算（从 `VirtualGrid` / `system.rows` 读取），下排也可参与完整挤出与重排。
  - `src/scenes/ShopScene.ts` 的 `findSynthesisTargetAtPointer()` 之前在 cell 命中分支仅做 footprint 判定，易漏下排目标；现改为 `point bounds OR footprint` 双判定，修复下排合成命中不稳。
- 测试补充：
  - `src/grid/SqueezeLogic.test.ts` 新增 lower row 挤出用例，覆盖 2 行背包下排场景。
- 回归验证：`npm test` 通过（60/60）；`npm run build` 通过（保留 chunk size warning）。

### 本次对话追加（2026-03-02，战斗区固定 6 格）

- `data/game_config.json`：`daily_battle_area_slots` 改为 `[6, 6, 6]`，战斗区不再随天数动态变化。
- `data/game_config.json`：相关注释同步为“固定 6 格”。
- `src/core/DataLoader.test.ts`：测试期望从 `[4,5,6]` 更新为 `[6,6,6]`。
- 回归验证：`npm test` 通过（59/59）。

### 本次对话追加（2026-03-02，星级字号与描边开放可配）

- `src/grid/GridZone.ts`：新增星级样式运行时配置能力：
  - `setTierStarFontSize()`：控制物品星级（★/★★）字号。
  - `setTierStarStrokeWidth()`：控制物品星级文字描边宽度。
- `src/scenes/ShopScene.ts` 与 `src/scenes/BattleScene.ts`：接入并实时应用两项新配置（商店/背包/战斗区统一生效）。
- `data/game_config.json`：`text_sizes` 新增 `itemTierStar`（遵循“新文字字号入配置”约定）。
- `src/items/ItemDef.ts`：同步扩展 `GameConfig.textSizes.itemTierStar` 类型。
- `src/config/debugConfig.ts`：新增 `itemTierStarFontSize`、`itemTierStarStrokeWidth` 两项调试参数。
- `src/debug/debugPage.ts`：将上述两项参数加入“字体大小”分组，支持你在调试页直接调。
- `data/debug_defaults.json`：补充两项默认值（`36`、`5`）。
- 回归验证：`npm test` 通过（59/59）；`npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-02，飞行子弹图白条清理）

- 已排查当前飞行投射图（`attack_variants`）并做连通域检测，定位到存在独立白色细线组件的文件：
  - `resource/itemicon/vanessa/item4_a.png`
  - `resource/itemicon/vanessa/item9_a.png`
- 已清理上述两张图中的白条像素（仅移除独立的高亮低饱和细线组件，不改动箭体本身）。
- 其余投射图（`item6_a.png / item16_a.png / item17_a.png`）未发现同类白条组件，本轮未改动。
- 回归验证：`npm run build` 通过（保留 chunk size warning）。

### 本次对话追加（2026-03-02，物品详情星级文案 + 价格信息隐藏 + 星星样式放大）

- `src/shop/SellPopup.ts`：物品详情品质文案改为“品质+星级”（例如 `青铜1星`），支持从 `Bronze#1 / Silver#2` 解析展示。
- `src/shop/SellPopup.ts`：详情浮层隐藏出售/购买价格文本（不再显示“出售价格/购买价格”一行）。
- `src/scenes/ShopScene.ts`：调用 `sellPopup.show()` 时统一传入带星级的可视品质（实例物品按当前星级，商店物品默认 1 星）。
- `src/grid/GridZone.ts`：按反馈将星星放大约 50%，并改为白色粗描边（宽度 5）。
- 回归验证：`npm test` 通过（59/59）。

### 本次对话追加（2026-03-02，合成取消弹窗改为目标物品闪白变身）

- 已按流程分别向主程（`WebJs开发指南`）与设计师（`手机大巴扎设计`）发起确认；NotebookLM 两侧请求均超时（timeout），本轮按最小改动先落地。
- `src/scenes/ShopScene.ts`：移除合成后的全屏遮罩/标题/图标弹窗链路，不再弹出“合成升级”界面。
- `src/scenes/ShopScene.ts`：新增 `playSynthesisFlashEffect()`，在目标物品格子位置播放约 `220ms` 的白色闪变效果（不打断操作流程）。
- 合成流程保持：命中合成后立即替换为新物品（同步逻辑不变），仅表现层改为“局部闪白变身”。
- 回归验证：`npm test` 通过（59/59）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：合成表现已调整为“直接变身 + 闪白”，无弹窗打断。

### 本次对话追加（2026-03-02，新物品 JSON + 图标整包替换）

- 已按你的新资源完成全量替换：
  - 数据：`/Users/zhengtengfei/Downloads/newitem2_data.json` → `data/vanessa_items.json`。
  - 图标：`/Users/zhengtengfei/Downloads/newitem2/*.png` 批量写入 `resource/itemicon/vanessa/`。
- 图标映射规则：
  - 基础图标按 `icon` 字段从 `newitemX.png` 映射，重命名为 `{item.id}.png`（匹配当前 `getItemIconUrl(defId)`）。
  - 投射变体按 `attack_variants` 从 `newitem*_a.png` 覆盖到 `item*_a.png`。
- 替换统计：18 个物品基础图标全部完成，5 个变体图标全部完成，无缺失。
- 配套修正：
  - `src/core/DataLoader.test.ts` 调整为适配新数据尺寸分布（当前无 `3x1`）。
  - `src/items/itemTierStats.test.ts` 改为验证新数据分档伤害解析。
  - `src/combat/CombatEngine.test.ts` 中依赖冻结/灼烧/剧毒专门词条的用例改为“数据缺项时跳过”，避免新卡池语义不覆盖导致假失败。
- 回归验证：`npm test` 通过（59/59）；`npm run build` 通过（保留 chunk size warning）。

### 本次对话追加（2026-03-02，出售价按7档品质统一 + 青铜购买价改3）

- 已按约定先向主程 Notebook（`WebJs开发指南`）问询方案；NotebookLM 本次请求超时（timeout），先按你的规则做最小实现。
- `src/shop/ShopManager.ts`：出售价格从“按尺寸购买价×折损”改为“仅按品质档位定价”（与尺寸无关）：
  - 青铜1/2、白银1/2、黄金1/2、钻石 对应 `1/2/4/8/16/32/64`。
  - 新增 `TierStar` 入参，出售价可区分同品质不同星级。
- `src/scenes/ShopScene.ts`：出售链路统一传入 `tier + star` 计算售价（拖拽出售、点选出售均已同步）。
- `src/scenes/ShopScene.ts`：快速购买青铜价格从 `2` 调整为 `3`（`SHOP_QUICK_BUY_PRICE=3`）。
- 回归验证：`npm test` 通过（59/59）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：出售已与尺寸解耦并按7档品质计价，青铜购买价已生效为 3。

### 本次对话追加（2026-03-02，星级位置回调到底部）

- 根据验收反馈，星级从“图标上方”回调到“图标下方原始位置”，并保持在图标上层显示。
- `src/grid/GridZone.ts`：星级位置改为按物品可视框底部计算（靠下内边距），同时保留 `badgeLayer` 层级与黑色描边。
- 回归验证：`npm test` 通过（59/59）。

### 本次对话追加（2026-03-02，升级后徽标数值与战斗实时数值同步修复）

- 已按流程先问主程确认方案：根因是详情文案按 tier 分档显示，但网格徽标与战斗 `baseStats` 仍取首档，导致白银/黄金显示与实际不一致。
- 新增 `src/items/itemTierStats.ts`：统一按 `skills` 文案分档解析基础数值（`cooldown/damage/heal/shield/burn/poison/regen/multicast`）。
- `src/combat/CombatEngine.ts`：`toRunner` 与敌方 runner 构建改为使用 tier 分档基础值，修复升级后进战斗仍按首档结算的问题。
- `src/combat/CombatEngine.ts`：扩展 `getRuntimeState()` 返回实时面板数值（含临时增益后的 `damage` 等），供前端显示层使用。
- `src/grid/GridZone.ts`：徽标渲染改为“tier 基础值 + 可选运行时覆盖”；新增 `setItemStatOverride()` 以支持战斗中实时刷新。
- `src/scenes/BattleScene.ts`：每帧根据 `runtimeState` 刷新物品顶部徽标（例如临时伤害/剧毒变化会同步到卡片顶部数值）。
- `src/ui/itemStatBadges.ts`：支持传入覆盖值，避免徽标固定读 `ItemDef` 首档。
- 新增 `src/items/itemTierStats.test.ts`：覆盖“毒气飞镖 4/6/8/10 按品质解析”回归。
- 回归验证：`npm test` 通过（59/59）；`npm run build` 通过（保留 chunk size warning）。

### 本次对话追加（2026-03-02，星级层级修正：置顶覆盖图标）

- `src/grid/GridZone.ts`：将星级节点从物品 `visual` 层迁移到 `badgeLayer`，确保渲染层级始终在图标之上。
- `src/grid/GridZone.ts`：统一在 `updateStatBadgePosition()` 计算星级位置，固定显示在物品上方（靠近顶部）。
- `src/grid/GridZone.ts`：拖拽开始/结束与删除节点流程已同步处理星级节点显示与销毁，避免残留。
- 回归验证：`npm test` 通过（59/59）；`npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-02，合成改为同尺寸同目标品质随机进化）

- 已按约定先向主程 Notebook（`WebJs开发指南`）问询方案；NotebookLM 本次请求超时（timeout），按需求先落地最小实现。
- `src/scenes/ShopScene.ts`：`synthesizeTarget()` 从“同名物品升阶”改为“同尺寸 + 目标品质候选池随机进化”。
  - 候选过滤：`normalizeSize(item.size) === target.size` 且 `available_tiers` 包含进化目标品质。
  - 兼容“部分物品无高品质”配置：不再依赖原物品是否拥有目标品质。
  - 进化时保留原 `instanceId`（延续实例级元数据），仅替换 `defId` + 品质/星级并重建卡面。
- 现有合成门槛保持不变：仍需同名 + 同品质 + 同星级命中目标后触发合成。
- 回归验证：`npm test` 通过（58/58）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：合成结果已从“固定升自己”切换为“随机同尺寸同目标品质物品”。

### 本次对话追加（2026-03-02，星级显示位置/样式调整）

- `src/grid/GridZone.ts`：将物品星级显示从底部调整到物品上方区域。
- 星级颜色改为与当前品质一致（青铜/白银/黄金/钻石对应边框色），并统一加黑色描边，提升暗背景可读性。
- 回归验证：`npm test` 通过（58/58）；`npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-02，剩1格仍可购买1x1修复）

- 已按约定先向主程 Notebook（`WebJs开发指南`）问询最小修复方案；NotebookLM 本次请求超时（timeout），按既有购买规则先行修复。
- `src/scenes/ShopScene.ts`：`buyRandomBronzeToBoardOrBackpack()` 改为“先按当前可落位空间过滤候选池”，仅从可放置物品中随机购买。
- 修复效果：当只剩 1 格时，仍可购买并落位 `1x1`；仅在没有任何可放置候选时才提示“格子不够，无法购买”。
- 回归验证：`npm test` 通过（58/58）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：快速购买空间判定与“按实际可放置候选随机”口径一致。

### 本次对话追加（2026-03-02，恢复合成命中黄色高亮）

- 已按约定先向主程 Notebook（`WebJs开发指南`）问询本次修复方案；NotebookLM 两次请求超时（timeout），本轮按既有“合成优先于挤出”规则做最小修复落地。
- `src/scenes/ShopScene.ts`：新增 `SYNTH_HIGHLIGHT_COLOR=0xffcc44` 与 `highlightSynthesisTarget()`，命中可合成目标时改为高亮目标物品 footprint（黄色），离开目标即恢复默认高亮逻辑。
- 覆盖两条链路：
  - 商店拖拽购买链路：`onShopDragMove` 命中可合成目标时显示黄色高亮。
  - 网格内拖拽链路：`drag.onDragMove` 命中可合成目标时显示黄色高亮，并继续保持“合成判定优先于挤出”（`setSqueezeSuppressed(true)`）。
- 回归验证：`npm test` 通过（58/58）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：可人工验收“拖到可合成物品即黄底提示，移开即取消”。

### 本次对话追加（2026-03-02，出售按钮常显 + 购买格子不足判定修正）

- `src/scenes/ShopScene.ts`：出售按钮改为商店阶段始终显示（不再依赖是否选中物品才显示按钮本体）。
- `src/scenes/ShopScene.ts`：出售金额仍保持“仅选中战斗区/背包物品后显示”；未选中时清空金额副文案。
- `src/scenes/ShopScene.ts`：快速购买逻辑新增“格子不足”前置判定：
  - 当候选池包含宽物品（`2x1`）且战斗区+背包均无法容纳 `2x1` 时，直接提示“格子不够，无法购买”。
  - 不再在仅剩 1 格时通过抽到 `1x1` 继续购买绕过空间不足提示。
- 回归验证：`npm test` 通过（58/58）；`npm run build` 通过（保留 chunk size warning）。

### 本次对话追加（2026-03-02，开局无默认装备 + 每日金币改10）

- `src/scenes/ShopScene.ts`：`placeInitialItems()` 改为不再预置任何背包装备；新开局需完全通过购买获得物品。
- `data/game_config.json`：`daily_gold` 从 `15` 调整为 `10`。
- `src/core/DataLoader.test.ts`：同步更新配置断言（`dailyGold === 10`）。
- 回归验证：`npm test` 通过（58/58）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：已满足“空背包开局 + 每日10金币”口径，可直接体验验收首日经济节奏。

### 本次对话追加（2026-03-02，背包下排拾取/挤出修正）

- 已按流程先问询：
  - 主程（`WebJs开发指南`）确认可实施最小修复方向：去除非 `1x1` 的 `row=0` 强制、修正 zone 中心 Y 计算。
  - 设计师（`手机大巴扎设计`）反馈当前资料中暂无“两行背包拖拽/挤出”正式规范；本轮按“上排与下排一致规则”先行修复，标记为 `[待设计确认]`。
- 代码修复：
  - `src/grid/DragController.ts`：移除高亮链路中对非 `1x1` 的 `finalRow=0` 强制，统一使用命中 `cell.row`，修复下排中/大型物品高亮与挤出判定偏差。
  - `src/grid/DragController.ts`：`findBestDropTarget` 的 zone center Y 改为 `zone.y + (CELL_HEIGHT * zoneRows * scaleY)/2`，兼容两行区域的就近判定。
  - 清理旧注释中的 `1x2/2x2` 历史描述，统一为当前 `2x1/3x1` 语义。
- 测试补充：
  - `src/grid/GridSystem.test.ts` 新增 `supports two-row placement for wide items`，覆盖 2 行网格下 `2x1` 在下排放置与边界判定。
- 回归验证：`npm test` 通过（58/58）；`npm run build` 通过（保留 chunk size warning）。
- 设计待确认项 `[待设计确认]`：
  - 两行背包是否允许跨行挤出/交换（当前实现：允许，且规则与上排一致）。
  - 宽物品（`2x1/3x1`）在上下排边界附近的“优先吸附上排/下排”策略是否需要单独偏置。

### 本次对话追加（2026-03-02，左上角“重新开始”按钮 + 刷新不重开修复）

- `src/scenes/ShopScene.ts`：新增左上角“重新开始”按钮（常驻商店场景）。
- 点击“重新开始”后执行：清理本地商店存档（`bigbazzar_shop_state_v1`）+ 清理战斗快照/战斗结果缓存 + `window.location.reload()`，确保从 Day1 初始状态重新开始。
- 目的：修复“浏览器刷新后继续旧进度、无法从头开始”的体验问题，改为由显式按钮触发可预期的重开流程。
- 回归验证：`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：阶段3-P1 验收优化中；本项已可人工验收（左上角按钮可见、点击后从头开局）。

### 本次对话追加（2026-03-02，购买/出售显示与按钮样式互换 + 金币/消耗合并）

- `src/scenes/ShopScene.ts`：购买与出售按钮不再互斥，购买按钮在商店阶段始终显示；出售按钮按选中物品逻辑显示，可与购买按钮同时出现。
- `src/scenes/ShopScene.ts`：按钮形态已按要求互换：
  - 购买按钮改为原战斗按钮样式（圆角矩形）。
  - 战斗按钮改为原购买按钮样式（圆形）。
- `src/scenes/ShopScene.ts`：将金币与购买消耗合并显示为单行（例如 `118/2`），替换原先分离的金币与消耗显示。
- 回归验证：`npm test` 通过（57/57）；`npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-02，背包拖拽行拾取修复 + 去小地图格子/去合成提示）

- `src/scenes/ShopScene.ts`：修复背包 6x2 下中/大型物品拖拽到第二行时仍按第一行拾取/落位的问题。
  - 移除旧逻辑里对非 `1x1` 物品强制 `row=0` 的处理，改为按实际 `pixelToCellForItem` 返回行落位与命中。
  - 覆盖了商店拖拽命中、战斗区/背包落点、合成目标命中相关分支。
- `src/scenes/ShopScene.ts`：去掉背包左下角小地图格子显示（不再创建 mini-map 容器）。
- `src/scenes/ShopScene.ts`：去掉“可合成提示”视觉：
  - 清空升级提示高亮（shop/battle/backpack）。
  - 取消拖拽时对可合成目标的高亮描边与升级预览提示。
- 回归验证：`npm test` 通过（57/57）；`npm run build` 通过（保留既有 chunk size warning）。

### 本次对话追加（2026-03-02，商店背包默认展开 + 去背包按钮 + 战斗Y偏移扩容）

- `src/scenes/ShopScene.ts`：商店阶段改为默认保持背包展开显示（不再在相位切换中收起）。
- `src/scenes/ShopScene.ts`：已移除背包按钮入口（不再渲染背包按钮），背包区直接作为商店默认主视图存在。
- `src/config/debugConfig.ts`：`battleZoneYInBattleOffset` 调参范围上限从 `300` 扩展到 `1000`，支持你在战斗场景将我方战斗区 Y 偏移配置到 `+1000`。
- 回归验证：`npm test` 通过（57/57）；`npm run build` 通过（保留既有 chunk size warning）。
- 当前状态：可直接进入人工体验验收（商店入场默认背包可见、无背包按钮、战斗区Y偏移大范围可调）。

### 本次对话追加（2026-03-02，商店改版：去三选一/去刷新/点击随机购买）

- 已完成商店购买模型改版：移除“三选一卡池购买 + 刷新”主流程，改为“点击购买按钮（固定 2G）直接购买随机青铜物品”。
- `src/scenes/ShopScene.ts`：
  - 新增 `SHOP_QUICK_BUY_PRICE = 2`，购买按钮文案改为“购买”，费用文案固定显示 `2G`。
  - 购买逻辑改为 `buyRandomBronzeToBoardOrBackpack()`：随机抽取可出青铜品质的物品，优先按列从前到后放入战斗区；战斗区无位时按列从前到后放入背包；两区都满则提示。
  - 刷新按钮行为已替换为购买行为（不再调用 `shopManager.refresh()`）。
  - 商店阶段默认打开背包（进入商店时 `showingBackpack = true`），并隐藏三选一面板展示。
  - 背包布局改为跟随战斗区下方自动定位（满足“出现在战斗区下方”）。
- `src/grid/GridSystem.ts`：网格系统从固定 1 行改为支持构造参数行数（默认仍为 1 行），为背包 6x2 提供基础能力。
- `src/scenes/ShopScene.ts`：背包实例改为 `GridSystem(6, 2)` + `GridZone('背包', 6, 6, 2)`，并同步小地图按 2 行绘制。
- 回归验证：`npm test` 通过（57/57）；`npm run build` 通过（仅保留既有 chunk size warning）。
- 当前状态：可进入你的人工体验验收（点击购买节奏、落位顺序、背包 6x2 操作手感、战斗切换后的状态保持）。

### 本次对话追加（2026-03-01，阶段3-P1 卡牌语义补齐第4批）

- 已按“直接推进，不中途询问”执行本轮实现，目标为加速“全卡牌效果可验收”。
- `src/combat/CombatEngine.ts`：新增 4 类卡牌语义处理：
  - 新增“使用灼烧物品时，减速敌方1件物品X秒”触发链（灼烧物品触发后由被动持有者施加 slow）。
  - 新增战斗开始时“灼烧物品+X灼烧”被动增益（对同阵营灼烧物品生效，本场战斗内）。
  - 新增战斗开始时“护盾物品护盾值+X”被动增益（对同阵营护盾物品生效，本场战斗内）。
  - 新增战斗开始时“相邻剧毒物品+X剧毒”被动增益（仅对相邻且具剧毒面板的物品生效，本场战斗内）。
- `src/combat/CombatEngine.test.ts`：新增 3 条稳定回归用例：
  - 灼烧物品开场增益生效。
  - 相邻剧毒增益仅影响相邻目标（非相邻不增益）。
  - 使用灼烧物品可触发敌方物品 slow 事件。
- 回归验证：`npm test` 通过（56/56）；`npm run build` 通过（保留既有 chunk size warning）。
- 过程备注：本轮尝试通过主程 NotebookLM 获取“剩余效果优先级清单”时工具超时（timeout），未拿到新增答复；实现口径沿用已确认的阶段3-P1规则与进度文档中已约定的“护盾/灼烧/相邻剧毒”待补项继续推进。
- 下一步计划：继续补齐剩余“非战中即时结算型”效果（如“战后复制/战后永久成长”）的系统边界与数据落点，并整理“全卡牌效果验收清单（触发/不触发）”供统一验收。

### 本次对话追加（2026-03-01，移动端卡顿 + 战斗回 Day1 排查与止血）

- 已按“先问主程再改”执行：向主程 Notebook（`WebJs开发指南`）提交排查问题并拿到优先方案，结论聚焦两类高概率根因：
  - ShopScene stage 级指针监听未解绑导致累计回调（越玩越卡）
  - 战斗/商店状态仅内存保存，异常重载后丢进度（表现为回 Day1）
- 已完成代码止血修复：
  - `src/scenes/ShopScene.ts`：为 `pointermove/pointerup/pointerupoutside` 保存回调引用，并在 `onExit` 对应 `stage.off(...)`，修复监听器泄漏。
  - `src/scenes/ShopScene.ts`：新增商店状态持久化（`localStorage`），在 `refreshShopUI()` 与战斗切场前落盘，`onEnter` 优先恢复；增加版本字段（`SHOP_STATE_STORAGE_VERSION`）避免旧缓存污染。
  - `src/scenes/BattleScene.ts`：无快照时不再以 Day1 占位开战，改为直接回商店恢复；战斗中 activeCols 改为使用进入战斗时锁定的 `battleDay`，避免外部快照丢失导致日数回退。
- 主程复核结论：上述 3 项修复方向通过；补充建议已采纳（存档版本化、切场清理一致性检查）。
- 回归验证：`npm test` 通过（53/53）；`npm run build` 通过（保留 chunk size warning）。
- 当前阶段：仍在阶段3-P1 验收与优化中（稳定性专项）。
- 下一步计划：
  - 真机复现链路复测（连续多局、长时挂战）验证“卡顿斜率”是否下降。
  - 增加 battle 特效并发上限/池化（第二层止血，降低移动端 GC 压力）。
  - 若仍有偶发回退，补充 battle 中断恢复标记（区分“战斗未结算返回商店”与“正常结算+1天”）。
- 待解决项/技术债：当前持久化为 `localStorage`（同步 IO），后续数据量增大时应迁移 IndexedDB。

### 本次对话追加（2026-03-01，战斗特效并发上限 + 轻量池化）

- 已先与主程确认方案后实施：采用“并发上限 + 轻量池化 + 丢弃兜底不影响结算”最小改动路径。
- `src/scenes/BattleScene.ts`：新增特效并发上限常量：`FX_MAX_PROJECTILES=40`、`FX_MAX_FLOATING_NUMBERS=30`、`FX_MAX_ACTIVE_TOTAL=80`。
- `src/scenes/BattleScene.ts`：超上限时启用丢弃策略：
  - 投射物丢弃时立即执行 `onHit`（保证受击反馈/逻辑链不断）。
  - 跳字丢弃为静默跳过（血条变化仍正常）。
- `src/scenes/BattleScene.ts`：加入轻量对象池与复用：
  - `projectileSpritePool` / `projectileDotPool` / `floatingNumberPool`
  - 动画结束后回收复用，池满再 `destroy()`。
  - 对投射物 sprite 增加 useId 防抖，避免异步贴图回写到已复用实例。
- `src/scenes/BattleScene.ts`：状态栏调试文案新增最小监控指标（`activeFx`、投射物/跳字并发、drop 计数），便于真机压测观察。
- 回归验证：`npm test` 通过（56/56）；`npm run build` 通过（保留 chunk size warning）。
- 下一步计划：真机长时压测（连续多局 + 加时赛）观察 drop 计数与帧率曲线；若 drop 常态偏高，再按项细化上限或引入分级降特效策略。

### 本次对话追加（2026-03-01，自动化 Soak Test 开关）

- 已按“继续稳定性验证”补充自动化长时压测入口，便于本地/真机重复跑：
  - `src/main.ts` 新增 `__startSoakTest/__stopSoakTest/__getSoakStats`（DEV 环境注入到 window）。
  - 支持 URL 自动启动：`?soak=1&rounds=...&battleMs=...&shopMs=...`。
  - 压测流程：自动循环 `shop -> battle -> shop`，每轮随机 day（默认 6~20），自动构建战斗快照并切场景。
  - 统计项：最大 `activeFx`、最大投射物并发、最大跳字并发、投射物/跳字 drop 计数。
- `src/scenes/BattleScene.ts` 新增 `getBattleFxPerfStats()` 导出，供 soak runner 采样读取。
- 采样频率：战斗中每 500ms 拉取一次 FX 指标并累计峰值，结束时控制台输出汇总。
- 回归验证：`npm test` 通过（57/57）；`npm run build` 通过（保留 chunk size warning）。
- 下一步计划：在手机端执行 20~50 轮自动压测，结合 `__getSoakStats()` 输出评估是否需要进一步下调特效上限或引入分级降特效。

### 本次对话追加（2026-03-01，进度写回确认）

- 已按你的要求完成本轮进度写回：`design/progress.md` 已同步记录“特效并发上限+轻量池化”与“自动化 Soak Test 开关”两项内容。

### 本次对话追加（2026-03-01，阶段3-P1 卡牌效果收口：战后类 + 永久成长）

- `src/combat/BattleSnapshotStore.ts`：战斗快照实体新增 `permanentDamageBonus`（可选），用于把商店中的实例级永久伤害成长带入战斗。
- `src/combat/CombatEngine.ts`：`toRunner()` 已接入快照 `permanentDamageBonus`，基础伤害按 `def.damage + permanentDamageBonus` 进入伤害管线。
- 新增 `src/combat/BattleOutcomeStore.ts`：保存/消费单次战斗结果与战斗快照，供回店后结算“战后效果”。
- `src/scenes/BattleScene.ts`：点击“回到商店”时写入 battle outcome（结果 + 入场快照），并在 `onExit` 清理入场快照引用。
- `src/scenes/ShopScene.ts`：新增战后结算链路（回店且 `pendingAdvanceToNextDay` 时执行）：
  - 实现“如果这是你唯一的攻击物品，战斗结束后永久+X伤害”实例级成长（按品质取值，累加到实例永久伤害）。
  - 实现“如果背包中有空位，每次战斗后自动复制”自动复制到背包（按源物品品质复制）。
  - 新增实例元数据 `instanceToPermanentDamageBonus`，并接入存档捕获/恢复、快照构建、实例删除清理。
- `src/combat/CombatEngine.test.ts`：新增回归用例“快照永久伤害加成进入直伤基值”。
- 回归验证：`npm test` 通过（57/57）；`npm run build` 通过（保留 chunk size warning）。
- 当前状态：Vanessa 37 件物品的技能语义已覆盖到引擎与回店结算链路，可进入“全卡牌效果统一验收”。

### 本次对话追加（2026-03-01，阶段3-P1 统一验收预检-自动化）

- 已执行统一验收前自动化预检：`npm test && npm run build`。
- 结果：
  - 单测：`57/57` 全通过（含 CombatEngine 新增“永久伤害加成入战斗基值”用例）。
  - 构建：TypeScript + Vite 生产构建通过。
  - 已知非阻塞项：仍有既有 `chunk size warning`（>500k），本轮未新增构建错误。
- 预检结论：代码层可进入你的人工体验验收阶段（全卡牌触发/不触发、战后复制/永久成长、多局连续稳定性）。

### 本次对话追加（2026-02-28，iOS 场景图修复后重新发 TF）

- 已按验收反馈直接重发 TestFlight（携带 `app://resource` 路径修复）。
- 构建号更新：`ios/project.yml` 的 `CURRENT_PROJECT_VERSION` 已升至 `5`。
- 打包与上传结果：
  - Archive：成功（`IOS_DEVELOPMENT_TEAM=6P57AJV77Q ./ios/build.sh archive`）
  - Export：成功（`xcodebuild -exportArchive`）
  - Upload：成功（`xcrun altool --upload-app`）
  - Delivery UUID：`9f13c565-2a30-4c71-a36c-662e07e5b2f1`
  - 回执：`UPLOAD SUCCEEDED with no errors`。

### 本次对话追加（2026-02-28，iOS 场景图资源路径修复）

- 问题复盘：英雄/敌人/背景图片文件已打入 ipa（`resource/scene/background.png|boss.png|hero.png`），但 iOS `app://` 路径指向了 `dist-ios/resource/...`，与包内真实目录 `resource/...` 不一致，导致运行时 404。
- 修复：`src/core/assetPath.ts` 将 iOS 协议资源基路径从 `app://dist-ios/resource` 改为 `app://resource`（`getResourceBasePath` 与 `getItemIconBasePath` 同步）。
- 验证：`npm run build` 通过；后续重新打包 iOS 后即可生效。

### 本次对话追加（2026-02-28，GHE 上传 + TestFlight 发包）

- GHE：已完成代码上传。
  - 提交1：`b38a58c` `feat: advance stage3 combat effects and battle presentation`
  - 提交2：`3909310` `chore: bump iOS build number to 4`
  - 远端分支：`origin/main`
- iOS 打包：
  - 首次归档因签名缺少 Team 失败；改用 `IOS_DEVELOPMENT_TEAM=6P57AJV77Q ./ios/build.sh archive` 后归档成功。
  - `xcodebuild -exportArchive` 导出 IPA 成功：`ios/build/export-testflight/BigBazzar.ipa`。
- TestFlight 上传：
  - `xcrun altool --upload-app` 上传成功。
  - Delivery UUID：`ee4d86b7-f1b7-42bf-84cc-f10482d24e9d`
  - 返回：`UPLOAD SUCCEEDED with no errors`。
- 备注：`ios/packaging.config.local.json` 含本地 API 配置，未提交到仓库。

### 本次对话追加（2026-02-28，阶段3-P1 技能语义补齐第3批）

- `src/combat/CombatEngine.ts`：继续补齐技能文案语义，新增以下战斗内规则：
  - 控制目标模式新增 `left`，支持“加速左侧物品X秒”按左侧紧邻目标选择。
  - 新增“使用相邻物品时，造成X灼烧”触发链：相邻物品触发时可对敌方英雄叠加灼烧。
  - 新增“冻结敌方时，相邻攻击物品+X伤害（本场战斗内）”触发链：冻结触发后给相邻攻击物品叠加临时伤害。
  - 新增“并使目标身上的剧毒层数翻倍”处理：中毒命中后额外叠加同量剧毒层数。
- `src/combat/CombatEngine.test.ts`：本轮未新增稳定回归用例（尝试添加数据驱动回归后发现当前数据集存在触发不稳定，已回退，避免引入波动测试）。
- 回归验证：`npm test` 通过（53/53）；`npm run build` 通过（保留 chunk size warning）。
- 下一步计划：继续按技能文案补齐剩余“条件触发型”规则（例如护盾物品/灼烧物品被动增益、相邻剧毒增益等），并优先补可稳定复现的单测样例后再并入主分支。

### 本次对话追加（2026-02-28，总结回填与Notebook同步）

- 已按要求完成本轮总结回填（process）：本文件已记录“技能语义补齐第3批”的实现、验证结果与下一步计划。
- 已写回主程 Notebook（NotebookLM：`WebJs开发指南`，id=`9baa2b32-22e4-4896-92bf-ced78ca0d148`）。
- Notebook 新增来源：`2026-02-28_阶段3P1_技能语义补齐第3批`（source id=`4f2bae08-de43-443e-bb1a-cb6f4354258c`）。

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

### 本次对话追加（2026-02-28，阶段3-P1 运行时分层最小切片）

- 已与主程确认可直接实施（NotebookLM 对话：`cd99d1da-61b7-40ca-b727-0783fe5f0920`）：采用 `baseStats + runtime` 分层，战斗内状态不回写 `ItemDef/GridItem`。
- `src/combat/CombatEngine.ts`：
  - 物品运行时字段收口到 `runtime`（`currentChargeMs`、`executeCount`、`tempDamageBonus`、`modifiers.freeze/slow/haste`）。
  - 基础面板收口到 `baseStats`（`cooldown/damage/heal/shield/burn/poison/regen/crit/multicast`），结算按 `baseStats + runtime` 计算。
  - 新增 `getRuntimeState()`，返回表现层友好的运行时快照（含 `chargePercent` 与控制状态时长）。
  - 直伤事件补充 `baseDamage/finalDamage`（`battle:take_damage`），用于后续表现与调试展示。
- `src/core/EventBus.ts`：扩展 `battle:take_damage` 事件类型，新增 `baseDamage`、`finalDamage` 可选字段。
- `src/combat/CombatEngine.test.ts`：新增用例覆盖 `getRuntimeState()` 与直伤事件 payload 扩展字段。
- 回归验证：`npm test` 通过（52/52）；`npm run build` 通过。

### 本次对话追加（2026-02-28，阶段3-P1 目标选择细化 + 表现层对齐）

- `src/combat/CombatEngine.ts`：控制目标选择新增模式解析与执行（`leftmost/adjacent/random/fastest`），并保持同 tick 稳定可复现（random 采用确定性洗牌）。
- `src/combat/CombatEngine.ts`：控制目标筛选支持按源物品邻接关系（footprint 邻接）与“最快充能剩余”排序。
- `src/scenes/BattleScene.ts`：CD 遮罩优先读取 `engine.getRuntimeState()` 的 `chargePercent`，逐步去耦为 runtime 驱动；普通伤害飘字改为优先显示 `finalDamage`。
- 回归验证：`npm test` 通过（52/52）；`npm run build` 通过。

### 本次对话追加（2026-02-28，统一物品卡面数值徽标）

- 已与设计师规范对齐（NotebookLM 对话：`52c6cc97-4456-41f9-8e11-773e626874ff`）：卡牌顶部仅显示 `伤害/护盾/回血/灼烧/中毒`，白字黑描边，按属性色底框，0 值隐藏。
- `src/ui/itemStatBadges.ts`：新增统一徽标组件，支持顺序固定（伤害→护盾→回血→灼烧→中毒）、多属性自动换行并向上生长。
- `src/grid/GridZone.ts`：背包/战斗区/战斗中物品统一接入顶部数值徽标；新增 `setStatBadgeFontSize()` 便于调试页实时调字号。
- `src/shop/ShopPanelView.ts`：商店物品卡同样接入顶部数值徽标，保证商店与网格区一致展示口径。
- 字号配置同步：
  - `data/game_config.json` 的 `text_sizes` 新增 `itemStatBadge`
  - `src/config/debugConfig.ts` 新增 `itemStatBadgeFontSize`
  - `src/debug/debugPage.ts` 字体大小分组新增 `itemStatBadgeFontSize`
  - `data/debug_defaults.json` 同步默认值
- 回归验证：`npm test` 通过（52/52）；`npm run build` 通过。

### 本次对话追加（2026-02-28，商店/背包徽标一致性与可配偏移）

- 修复商店与背包/战斗区的徽标视觉不一致：`src/shop/ShopPanelView.ts` 的徽标字号改为按商店内容缩放自动反算，确保与 GridZone 视觉尺寸一致。
- 新增徽标整体 Y 偏移配置：
  - `src/config/debugConfig.ts` 新增 `itemStatBadgeOffsetY`
  - `data/debug_defaults.json` 新增默认值
  - `src/debug/debugPage.ts` 纳入布局分组调试
  - `src/scenes/ShopScene.ts` 与 `src/scenes/BattleScene.ts` 同步接入该配置
  - `src/grid/GridZone.ts`、`src/shop/ShopPanelView.ts` 增加对应 setter 实时生效
- 回归验证：`npm test` 通过（52/52）；`npm run build` 通过。

### 本次对话追加（2026-02-28，拖拽态徽标隐藏与描边优化）

- `src/grid/GridZone.ts`：拖拽时隐藏顶部数值徽标，放置/回弹后恢复显示，避免拖动过程中出现悬浮数值标签。
- `src/ui/itemStatBadges.ts`：优化徽标样式，增大内边距并减小文字描边宽度，去除“框外黑边”观感。
- 回归验证：`npm test` 通过（52/52）；`npm run build` 通过。

### 本次对话追加（2026-02-28，徽标层级高于战斗 CD 遮罩）

- `src/grid/GridZone.ts`：新增独立 `badgeLayer`，将物品顶部数值徽标从物品视觉层剥离到独立层；补齐位置同步（静态摆放、吸附、挤出动画、预览动画、回弹）。
- `src/grid/GridZone.ts`：新增 `bringStatBadgesToFront()`，用于外部场景在添加覆盖层后将徽标层提升到最上层。
- `src/scenes/BattleScene.ts`：战斗 CD 遮罩创建后调用 `bringStatBadgesToFront()`，确保徽标显示在 CD 遮罩上方。
- 回归验证：`npm test` 通过（52/52）；`npm run build` 通过。

### 本次对话追加（2026-02-28，徽标颜色改走战斗色配置）

- `src/ui/itemStatBadges.ts`：徽标底色改为读取调试配置色值，确保与战斗色体系一致：
  - 护盾 -> `battleColorShield`
  - 回复 -> `battleColorRegen`
  - 灼烧 -> `battleColorBurn`
  - 中毒 -> `battleColorPoison`
  - 伤害 -> `battleOrbColorHp`
- `src/ui/itemStatBadges.ts`：色块新增黑色外描边（2px），满足“色块黑描边”视觉要求。
- `src/scenes/ShopScene.ts`：监听战斗色配置项变化时触发布局重建，保证商店视图可实时同步徽标颜色。
- 回归验证：`npm test` 通过（52/52）；`npm run build` 通过。

### 本次对话追加（2026-02-28，徽标文字描边加强）

- `src/ui/itemStatBadges.ts`：将徽标文字黑描边宽度由 1 调整为 2，保证在高亮背景和特效下可读性。
- 回归验证：`npm test` 通过（52/52）；`npm run build` 通过。

### 本次对话追加（2026-02-28，商店选中框层级下沉）

- `src/shop/ShopPanelView.ts`：调整子节点层级，确保商店选中框位于顶部数值徽标下层（被徽标遮挡），避免选中描边压到数值块。
- 回归验证：`npm test` 通过（52/52）；`npm run build` 通过。

### 本次对话追加（2026-02-28，多重触发数值显示）

- 已按主程确认口径实现（NotebookLM 对话：`9e4a93a7-bd88-4ffc-9733-be4eb34fed32`）：当 `multicast > 1` 时，五类顶部数值统一显示 `值xN`（如 `5x2`），`N=1` 不显示 `x1`。
- `src/ui/itemStatBadges.ts`：新增 `toBadgeText()`，将徽标文本格式统一为 `baseValue` 或 `baseValuexmulticast`。
- 回归验证：`npm test` 通过（53/53）；`npm run build` 通过。

### 本次对话追加（2026-02-28，商店按下暗闪去除）

- `src/shop/ShopPanelView.ts`：移除商店卡牌的 `pointerover/pointerout` alpha 变暗逻辑，按下/悬停不再出现整体变暗闪动。
- 回归验证：`npm test` 通过（53/53）；`npm run build` 通过。

### 本次对话追加（2026-02-28，全局背景与战斗敌人立绘）

- 资源拷贝：将下载目录素材复制到项目资源目录 `resource/scene/background.png` 与 `resource/scene/boss.png`。
- `src/core/assetPath.ts`：新增 `getSceneImageUrl()`，统一场景图资源路径（兼容 web/app/file 协议）。
- `src/main.ts`：新增全局常驻背景图层，启动后加载 `background.png` 并铺满设计分辨率；跨场景始终显示。
- `src/scenes/BattleScene.ts`：新增敌人立绘精灵，加载 `boss.png` 并放在敌方血条下方居中；仅战斗进行中显示，战斗结束（`engine.isFinished()`）自动隐藏。
- 回归验证：`npm test` 通过（53/53）；`npm run build` 通过。

### 本次对话追加（2026-02-28，近大远小分层缩放与拖拽统一 100%）

- 新增可配置缩放参数（调试配置）：
  - `shopItemScale`（商店物品缩放，默认 0.9）
  - `battleItemScale`（我方战斗区/背包物品缩放，默认 1.0）
  - `enemyAreaScale`（敌方血条+敌方战斗区缩放，默认 0.8）
- `src/scenes/ShopScene.ts`：
  - 商店区缩放改走 `shopItemScale`
  - 战斗区/背包缩放改走 `battleItemScale`
  - 战斗区居中计算改按新的缩放值
  - 商店拖拽浮层改为固定 100% 缩放
- `src/shop/ShopPanelView.ts`：新增 `setItemScale()`，商店卡面按配置重建缩放。
- `src/scenes/BattleScene.ts`：
  - 我方战斗区缩放改为 `battleItemScale`
  - 敌方战斗区缩放改为 `battleItemScale * enemyAreaScale`
  - 敌方血条宽高与文字按 `enemyAreaScale` 缩放
  - 敌人立绘与信息面板锚点同步按敌方缩放修正
- `src/grid/GridZone.ts`：网格拖拽从各区域抬起时统一为 100% 大小（不再继承区域缩放或额外放大）。
- 配置同步：`src/config/debugConfig.ts`、`data/debug_defaults.json` 已新增并提供默认值。
- 回归验证：`npm test` 通过（53/53）；`npm run build` 通过。

### 本次对话追加（2026-02-28，调参页搜索）

- `debug.html`：新增调参搜索栏（置于顶部，支持实时输入），并显示命中数量。
- `src/debug/debugPage.ts`：新增参数搜索过滤逻辑，支持按中文标签、英文 key、描述文本检索；未命中的参数行与分组自动隐藏，命中分组自动展开。
- 回归验证：`npm run build` 通过。

### 本次对话追加（2026-02-28，近大远小分组与缩放行为修正）

- 调参页分组：将 `shopItemScale/battleItemScale/enemyAreaScale` 单独归类到“近大远小设置”。
- 修复商店缩小时文字变大的问题：
  - `src/scenes/ShopScene.ts`：移除商店标题/数值徽标字号对 `shopItemScale` 的反向除法。
  - `src/shop/ShopPanelView.ts`：移除数值徽标字号对内容缩放的反向除法。
  - 结论：缩小商店时，物品与其文字会一起缩小，不再反向变大。
- 修复战斗区/敌方区不居中：`src/scenes/ShopScene.ts` 与 `src/scenes/BattleScene.ts` 的区域 X 计算改为“按当前缩放后宽度居中”。
- 我方战斗区关联 UI 同步缩放：`src/scenes/ShopScene.ts` 中金币文本按 `battleItemScale` 同步缩放显示。
- 回归验证：`npm test` 通过（53/53）；`npm run build` 通过。

### 本次对话追加（2026-02-28，敌方血条取消缩放）

- 根据验收反馈，`enemyAreaScale` 仅作用于敌方战斗区（含物品），不再作用于敌方血条与血条文字。
- `src/scenes/BattleScene.ts`：
  - 敌方/我方血条统一使用原始 `battleHpBarWidth/battleHpBarH` 绘制；敌方数值文字不再随 `enemyAreaScale` 变化。
  - 敌人立绘与战斗信息面板锚点改回按未缩放血条高度定位，避免额外叠加缩放。
- 回归验证：`npm test` 通过（53/53）；`npm run build` 通过。

### 本次对话追加（2026-02-28，去除战斗区标签文案）

- `src/grid/GridZone.ts`：新增 `setLabelVisible()`，支持按区域控制标签显隐。
- `src/scenes/BattleScene.ts`：我方“战斗区”与敌方“敌方战斗区”标签统一隐藏。
- `src/scenes/ShopScene.ts`：商店场景中的“战斗区”标签隐藏（保留其他区域标签）。
- 回归验证：`npm test` 通过（53/53）；`npm run build` 通过。

### 本次对话追加（2026-02-28，分离敌方数值缩放与背包打开缩放）

- 新增近大远小参数：
  - `battleItemScaleBackpackOpen`：背包打开时我方战斗区及关联信息缩放
  - `enemyHpBarScale`：敌方血条与血条文字独立缩放
- `src/config/debugConfig.ts`、`data/debug_defaults.json`、`src/debug/debugPage.ts` 已同步接入，均归类到“近大远小设置”。
- 敌方数值徽标与敌方战斗区比例一致：
  - `src/scenes/BattleScene.ts` 去除顶部数值徽标字号/偏移对 `zone.scale` 的反向除法。
  - 结果：敌方战斗区缩小后，顶部数值也按同等比例缩小。
- 背包打开时我方缩放：
  - `src/scenes/ShopScene.ts` 中 `battleItemScale` 改为按 `showingBackpack` 在 `battleItemScale` 与 `battleItemScaleBackpackOpen` 之间切换。
- 回归验证：`npm test` 通过（53/53）；`npm run build` 通过。

### 本次对话追加（2026-02-28，战斗中下方英雄立绘与受击反馈）

- 资源拷贝：新增 `resource/scene/hero.png`（来自下载目录）。
- `src/scenes/BattleScene.ts`：
  - 新增下方英雄立绘（底部贴边显示，层级低于战斗区与血条，可被遮挡）。
  - 新增英雄受击反馈（闪白 + 缩放 pulse），效果参数复用敌方立绘受击参数。
  - 敌方攻击命中我方英雄时，投射物目标改为英雄立绘命中点（无立绘时回退到血条中心）。
  - 我方/敌方英雄目标状态投射统一支持命中立绘点并触发对应受击反馈。
- 回归验证：`npm test` 通过（53/53）；`npm run build` 通过。

### 本次对话追加（2026-02-28，我方立绘参数独立可配）

- 按验收要求补齐“我方立绘”独立参数集（与敌方同口径）：
  - `battlePlayerPortraitWidthRatio`
  - `battlePlayerPortraitOffsetY`
  - `battlePlayerPortraitHitYFactor`
  - `battlePlayerPortraitHitScaleMax`
  - `battlePlayerPortraitHitPulseMs`
  - `battlePlayerPortraitIdleLoopMs`
  - `battlePlayerPortraitIdleScaleMax`
  - `battlePlayerPortraitFlashMs`
  - `battlePlayerPortraitFlashColor`
  - `battlePlayerPortraitFlashAlpha`
- `src/scenes/BattleScene.ts`：我方立绘宽度/位置、命中点、受击缩放、闪白、呼吸循环均改为读取我方参数，不再复用敌方参数。
- 调参页接入：`src/debug/debugPage.ts` 的“战斗表现”分组已纳入我方立绘参数。
- 配置与默认值同步：`src/config/debugConfig.ts`、`data/debug_defaults.json`。
- 回归验证：`npm test` 通过（53/53）；`npm run build` 通过。

### 本次对话总结（P1 验收前收口）

- 已完成战斗/商店核心体验收口：战斗中物品详情、CD 遮罩点击穿透、CD 遮罩层级与形态、数值徽标统一、拖拽锚点与中/大型判定修复、商店按下暗闪去除。
- 已完成 P1 关键技术推进：`CombatEngine` 引入 `baseStats + runtime` 分层、`getRuntimeState()` 输出、事件边界字段补齐（含 `baseDamage/finalDamage`）、控制目标模式细化（leftmost/adjacent/random/fastest）。
- 已完成近大远小配置化：新增“近大远小设置”分组与多参数（商店/我方/敌方/背包打开/敌方血条），并修复缩放导致字号反向变大的问题。
- 已完成场景美术接入：全局背景常驻、战斗敌方立绘、战斗下方我方立绘（受击闪白/放缩/命中点），并新增我方立绘独立可调参数全集。
- 战斗结束表现调整：敌方立绘、敌方血条、敌方战斗区物品在战斗结束统一隐藏。
- 当前状态：`npm test` 53/53 通过，`npm run build` 通过；阶段3-P1 代码侧已基本就绪，等待你统一验收与优化意见回收。

### 本次对话追加（2026-02-28，我方立绘宽度比例上限提升）

- `src/config/debugConfig.ts`：`battlePlayerPortraitWidthRatio` 上限由 `1` 提升到 `2`，支持最多 2 倍宽度比例调节。
- 回归验证：`npm run build` 通过。

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

### 本次对话追加（所有物品触发均执行放缩）

- 按主程方案补齐触发范围：除开火外，`battle:status_apply`（含加速/减速/冻结等控制效果）也会触发来源物品放缩。
- 新增统一入口 `tryPulseItem()`：自动解析来源物品所在阵营并执行 `animateItemFirePulse`；过滤 `fatigue/status_*` 等非物品来源。
- 增加短窗口去重（基于 `battleFirePulseMs` 派生阈值），避免同一物品在相邻事件（如开火+状态施加）中重复闪烁。
- 变更文件：`src/scenes/BattleScene.ts`；回归：`npm test` 通过（50/50）。

### 本次对话追加（购买替换进背包高亮改绿）

- 修复商店购买拖到战斗区时的高亮语义：当落点属于“可替换并回背包”路径时，不再显示黄色升级高亮，改为绿色可放置高亮。
- 同步修复落点判定：在 `onShopDragMove` 与 `onShopDragEnd` 两处都屏蔽该场景下的合成优先级，确保视觉与实际行为一致。
- 变更文件：`src/scenes/ShopScene.ts`。

### 本次对话追加（被顶回背包飞入小黄格动画）

- 新增“战斗区物品被顶回背包”过渡动画：物品图标从战斗区飞向背包下方小地图目标格，过程中沿弧线移动并逐步缩小。
- 终点过渡为小黄格：动画后段图标淡出、小黄格淡入，落点短暂保留后消失，与小地图占用态自然衔接。
- 动画触发位置：`applyBackpackPlanWithTransferred` 在完成转移后调用，按每个被转移物品的目标背包格播放。
- 变更文件：`src/scenes/ShopScene.ts`；回归：`npm test` 通过（52/52），`npm run build` 通过。

### 本次对话追加（顶回背包动画参数接入拖拽参数）

- 按需求将“被顶回背包飞入小黄格”动画参数全部接入 Debug 拖拽参数分组（自动归入拖拽参数）：
  - `transferToBackpackAnimMs`
  - `transferToBackpackArcY`
  - `transferToBackpackIconScale`
  - `transferToBackpackMorphStartPct`
  - `transferToBackpackHoldMs`
- 同步默认值写入 `data/debug_defaults.json`，并替换 `ShopScene` 中对应硬编码值为配置读取。
- 变更文件：`src/config/debugConfig.ts`、`data/debug_defaults.json`、`src/scenes/ShopScene.ts`。

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

### 本次对话追加（战斗子弹改为可配置图标飞行）

- 按主程确认方案实现：可飞行物品（依据 `attack_style`，如“直线飞行/旋转飞行”）发射时可改为“物品图标子弹”，非飞行物品与状态来源仍走小圆点。
- 图标来源策略：优先可选 `attack_variants`（或 `icon_a/icon_a2` 推导），失败自动回退物品主图标；已支持向左旋转（仅 `attack_style` 含“旋转”时生效）。
- 轨迹表现可配置：飞行时长、弧线高度、缩放曲线（起始/峰值/结束/峰值时机）、旋转速度、图标子弹尺寸。
- 新增战斗表现配置并接入调试页“战斗表现”：
  - `battleProjectileUseItemSprite`
  - `battleProjectileUseVariants`
  - `battleProjectileItemSizePx`
  - `battleProjectileArcHeight`
  - `battleProjectileScaleStart`
  - `battleProjectileScalePeak`
  - `battleProjectileScaleEnd`
  - `battleProjectileScalePeakT`
  - `battleProjectileSpinDegPerSec`
- 数据层补齐字段：`ItemDef/DataLoader` 新增并透传 `icon`、`attack_style`、`attack_variants`，以支撑子弹贴图与旋转判定。
- 变更文件：`src/scenes/BattleScene.ts`、`src/config/debugConfig.ts`、`src/debug/debugPage.ts`、`data/debug_defaults.json`、`src/items/ItemDef.ts`、`src/core/DataLoader.ts`、`src/core/assetPath.ts`；回归：`npm test` 通过（52/52），`npm run build` 通过。

### 本次对话追加（特殊攻击图标优先 + 多变体交替发射）

- 对于有 `attack_variants` / `icon_a` / `icon_a2` 的飞行物品，子弹优先使用这些“攻击图标”，不再随机。
- 当存在多个攻击图标时，按同一物品实例逐次交替发射（round-robin），满足“交替发射”表现；场景退出时清空轮转状态。
- 变更文件：`src/scenes/BattleScene.ts`；回归：`npm test` 通过（52/52），`npm run build` 通过。

### 本次对话追加（移除两项子弹开关，固定默认逻辑）

- 按需求将“飞行物品改图标子弹”“优先使用_a/_a2贴图”从调试配置中移除，不再暴露给网页调参。
- 逻辑固定为默认：飞行物品始终使用图标子弹，且优先使用攻击变体图标（含交替发射）。
- 变更文件：`src/scenes/BattleScene.ts`、`src/config/debugConfig.ts`、`src/debug/debugPage.ts`、`data/debug_defaults.json`；回归：`npm test` 通过（52/52），`npm run build` 通过。

### 本次对话追加（修复变体贴图缺失告警刷屏）

- 修复 Pixi 资源告警：不再调用 `Assets.get(url)` 读取未缓存资源（该调用会在未命中时打印 warning）。
- 新增子弹贴图缓存与缺失 URL 黑名单：
  - 命中缓存直接复用；
  - 404/加载失败 URL 记录到缺失集合，后续不再重复请求与告警。
- 保留回退链路：变体贴图不存在时自动回退主图标，不影响飞行动画。
- 变更文件：`src/scenes/BattleScene.ts`；回归：`npm test` 通过（52/52），`npm run build` 通过。

### 本次对话追加（连发飞镖变体资源补齐 + 直线朝向旋转）

- 资源补齐：将 `~/Downloads/newitem/item*_a*.png` 同步复制到 `resource/itemicon/vanessa/`，修复 `item1_a/item1_a2` 等攻击图标缺失导致无法按变体显示的问题。
- 表现补齐：直线飞行子弹新增“朝向目标点”旋转（发射点→目标点方向锁定）；旋转飞行仍按配置角速度左旋。
- 变更文件：`resource/itemicon/vanessa/`（新增变体图标）、`src/scenes/BattleScene.ts`；回归：`npm test` 通过（52/52），`npm run build` 通过。

### 本次对话追加（直线飞行朝向前向修正）

- 针对“素材默认朝上”补齐朝向基准：直线飞行角度在发射线方向上额外 `+90°`（`+Math.PI/2`），修复出现左偏 90° 的问题。
- 变更文件：`src/scenes/BattleScene.ts`；回归：`npm test` 通过（52/52）。

### 本次对话追加（战斗卡牌状态持续时间与冻结遮罩）

- 实现卡牌状态持续时间显示：
  - 加速（haste）显示在卡牌偏上；
  - 减速（slow）显示在卡牌偏下；
  - 冻结（freeze）显示在卡牌中心；
  - 文案统一 `x.x` 动态更新（按 runtime 毫秒转秒，每帧刷新，带脏检查）。
- 视觉样式：
  - 状态底板颜色使用对应小球色（`getBattleOrbColor`）；
  - 文字白色 + 黑描边；
  - 冻结时增加整卡偏白遮罩（类似 CD 覆盖效果）。
- 配置全部接入“战斗表现”分组：
  - `battleStatusTimerScale`
  - `battleStatusTextStrokeWidth`
  - `battleStatusBadgePadX`
  - `battleStatusBadgePadY`
  - `battleStatusBadgeRadius`
  - `battleStatusBadgeMinWidth`
  - `battleStatusBadgeAlpha`
  - `battleStatusHasteYFactor`
  - `battleStatusHasteOffsetY`
  - `battleStatusSlowYFactor`
  - `battleStatusSlowOffsetY`
  - `battleStatusFreezeYFactor`
  - `battleStatusFreezeOffsetY`
  - `battleFreezeOverlayAlpha`
- 变更文件：`src/scenes/BattleScene.ts`、`src/config/debugConfig.ts`、`src/debug/debugPage.ts`、`data/debug_defaults.json`；回归：`npm test` 通过（53/53），`npm run build` 通过。

### 本次对话追加（状态计时字号可配 + 层级与尺寸修复）

- 计时字号改为独立配置 `battleStatusTimerFontSize`（已同步到 `data/game_config.json:text_sizes`、`src/items/ItemDef.ts`、`src/config/debugConfig.ts`、`src/debug/debugPage.ts`“字体大小”分组）。
- 描边按需求调细：`battleStatusTextStrokeWidth` 默认从 3 降为 2（仍可在“战斗表现”调）。
- 层级修复：状态数字层（最上） > 冻结遮罩层 > CD 遮罩层，符合验收要求。
- 冻结遮罩“持续放大”修复：不再用 `node.container.width/height` 回写遮罩尺寸，改为基于物品格尺寸（`size -> CELL_SIZE/CELL_HEIGHT`）计算，避免因 UI 子节点参与包围盒导致的反馈放大。
- 变更文件：`src/scenes/BattleScene.ts`、`src/config/debugConfig.ts`、`src/debug/debugPage.ts`、`data/game_config.json`、`src/items/ItemDef.ts`、`data/debug_defaults.json`；回归：`npm test` 通过（53/53），`npm run build` 通过。

### 本次对话追加（战斗物品数值标记字号回归）

- 修复战斗场景物品数值标记（红/橙角标）变小：原因是 BattleScene 的 `applyZoneVisualStyle()` 中漏掉了 `setStatBadgeFontSize/setStatBadgeOffsetY`。
- 已恢复按配置应用：`itemStatBadgeFontSize`、`itemStatBadgeOffsetY`（与商店场景一致，按缩放反算）。
- 变更文件：`src/scenes/BattleScene.ts`；回归：`npm test` 通过（53/53）。

### 本次对话追加（CD遮罩层级与状态字号一致性）

- CD 遮罩层级调整：通过 `bringStatBadgesToFront()` 确保物品伤害角标在 CD 遮罩上方。
- 修复“角标 24 与状态计时 24 看起来不一致”：状态计时字号改为按战斗区缩放反算（与角标同口径），避免因 zone scale 导致视觉变小。
- 顺手修复 BattleScene 误引入的场景资源导入报错（`getSceneImageUrl`）。
- 变更文件：`src/scenes/BattleScene.ts`；回归：`npm test` 通过（53/53）。

### 本次对话追加（阶段3-P1 卡牌效果细化第一批落地）

- 已按主程确认进入 P1-1 全量补齐路径，并先完成第一批“高收益战斗内效果”实现（非跨系统）：
  - 伤害公式补齐：
    - `攻击造成等同于当前自身护盾值的伤害`
    - `掷出造成目标最大生命值X%伤害`
    - `相邻物品攻击时，攻击造成X伤害`（邻接被动叠加）
    - `如果这是你唯一的攻击物品，触发2次`
  - 触发链补齐：
    - 控制触发增益（冻结/减速触发后加伤、加灼烧、加剧毒）
    - `触发加速时，额外造成X伤害`
    - `飞出时加速相邻物品`
    - `获得护盾时，加速1件物品`
  - DOT/HOT 联动补齐：
    - `造成剧毒时恢复+X生命`
    - `造成剧毒时灼烧物品+X灼烧`
    - `造成灼烧时剧毒物品+X剧毒`
  - 战斗节奏补齐：
    - `每次使用后自身CD减少1秒（本场战斗内）`
    - 开场技能触发：`开场时自动触发` 与 `开场时冻结/减速/加速...`
    - 受击反应：`受到攻击伤害时获得X护盾`
- 当前仍待下一批补齐（P1-1 未完成）：`相邻物品使用时，加速另一侧...`、`相邻护盾物品...`、永久局外成长/复制/复活等跨系统或高语义效果。
- 变更文件：`src/combat/CombatEngine.ts`；回归：`npm test` 通过（53/53），`npm run build` 通过。

### 本次对话追加（阶段3-P1 卡牌效果细化第二批推进）

- 继续推进战斗内效果补齐（仍在 P1-1 范围）：
  - 新增 `相邻物品使用时，加速另一侧的物品`（按触发源相对被动拥有者位置，选另一侧邻接目标）
  - 新增 `相邻物品攻击造成伤害时，该物品+X伤害（本场战斗内）`
  - 新增 `相邻护盾物品的获得+X护盾（本场战斗内）`（邻接来源叠加）
  - 新增 `首次被击败时复活并恢复X生命值`（战斗内一次性复活）
- 同步战斗时机修正：
  - 命中造成生命伤害后触发邻接攻击成长
  - 结算胜负前尝试复活（避免被直接判负）
- 变更文件：`src/combat/CombatEngine.ts`；回归：`npm test` 通过（53/53），`npm run build` 通过（含 chunk 体积提示，无构建失败）。

### 本次对话追加（商店拖拽合成优先 + 升级预览面板）

- 按主程确认方案修正拖拽优先级：商店物品拖拽命中可合成目标时，合成判定优先于挤出/替换回背包；移除此前对该场景的“屏蔽合成”分支。
- 详情面板新增升级预览：命中可合成目标时，面板切换为“升级预览”，以 `旧值 -> 新值` 展示所有发生变化的技能数值；未变化项默认隐藏。
- 冷却也纳入预览：若升级导致冷却变化，显示 `冷却：x.x秒 -> y.y秒`；品质徽标显示 `旧品质→新品质`。
- 设计确认结果：采用“变化项优先、未变化项隐藏”的低噪音展示策略（移动端可读性优先）。
- 变更文件：`src/scenes/ShopScene.ts`、`src/shop/SellPopup.ts`；回归：`npm test` 通过（52/52），`npm run build` 通过。

### 本次对话追加（升级预览文案精简）

- 按需求去掉“升级预览”字样：标题恢复为物品名本体（不追加括号文案）。
- 按需求简化品质徽标：不再显示“青铜→白银”，仅显示目标品质（如“白银”）。
- 升级描述改为行内差值：由“整句 old -> 整句 new”改为“仅变化数值 old->new”嵌入原句（示例：`攻击造成10->20伤害`）。
- 变更文件：`src/shop/SellPopup.ts`；回归：`npm test` 通过（52/52），`npm run build` 通过。

### 本次对话追加（超时扣血不中断CD + 扣血参数可配置）

- 按主程方案修复战斗超时逻辑：进入超时扣血（fatigue）后不再冻结 TICK，物品 CD 继续推进并可正常触发攻击/治疗/状态；fatigue 仅作为并行环境伤害通道。
- Tick 流程调整：每个 `tickMs` 仍执行 `stepOneTick`，同时按独立间隔叠加 fatigue 伤害；新增 `battle:fatigue_start` 与 `battle:fatigue_tick` 事件，便于后续表现层扩展。
- 参考设计师数值建议并落地为可调参数（放到调试页“玩法数值”）：
  - `gameplayFatigueStartMs`（默认 25000）
  - `gameplayFatigueIntervalMs`（默认 1000）
  - `gameplayFatigueDamagePctPerInterval`（默认 0.02）
  - `gameplayFatigueDamageFixedPerInterval`（默认 10）
  - `gameplayFatigueDamagePctRampPerInterval`（默认 0.01）
  - `gameplayFatigueDamageFixedRampPerInterval`（默认 10）
- 配置链路同步：`data/game_config.json:combat_runtime`、`src/items/ItemDef.ts` 类型、`src/config/debugConfig.ts`、`data/debug_defaults.json`、`src/debug/debugPage.ts`、`src/scenes/BattleScene.ts` 覆盖到运行时 override。
- 增加回归用例：`CombatEngine.test.ts` 新增“进入超时扣血后物品CD仍持续并继续触发”。
- 变更文件：`src/combat/CombatEngine.ts`、`src/combat/CombatEngine.test.ts`、`src/core/EventBus.ts`、`src/scenes/BattleScene.ts`、`src/config/debugConfig.ts`、`src/debug/debugPage.ts`、`data/debug_defaults.json`、`data/game_config.json`、`src/items/ItemDef.ts`；回归：`npm test` 通过（53/53），`npm run build` 通过。

### 本次对话追加（超时扣血改为直接跳字）

- 按需求调整 fatigue 表现：超时扣血不再从对方飞出小球，改为在目标血条处直接掉血跳字。
- 实现方式：`battle:take_damage` 里当 `sourceItemId === 'fatigue'` 时走与状态伤害同路径，直接 `spawnFloatingNumber`。
- 变更文件：`src/scenes/BattleScene.ts`；回归：`npm test` 通过（53/53）。

### 本次对话追加（超时扣血先扣盾 + 风暴来袭Toast）

- fatigue 伤害结算调整为“先扣护盾再扣生命”：与普通伤害一致的护盾优先规则，`battle:take_damage` 同步携带 `finalDamage`（真实掉血值）用于跳字。
- fatigue 开始时增加提示：监听 `battle:fatigue_start`，显示 Toast 文案“加时赛风暴来袭”。
- Toast 开关接入“Toast 显示”配置：新增 `toastShowFatigueStart`（受总开关 `toastEnabled` 控制）。
- 变更文件：`src/combat/CombatEngine.ts`、`src/scenes/BattleScene.ts`、`src/config/debugConfig.ts`、`src/debug/debugPage.ts`、`data/debug_defaults.json`；回归：`npm test` 通过（53/53），`npm run build` 通过。

### 本次对话追加（敌方立绘受击目标化 + 受击/死亡表现配置）

- 按主程方案实现：我方打向敌方英雄的飞点终点从血条改为敌方立绘命中点；命中时敌方立绘执行“闪白 + 快速放缩”反馈。
- 敌方立绘尺寸与布局增强：默认更大，并稳定放置于敌方血条下方；死亡时执行半透淡出后隐藏。
- 新增“战斗表现”可调参数：
  - `battleEnemyPortraitWidthRatio`
  - `battleEnemyPortraitOffsetY`
  - `battleEnemyPortraitHitYFactor`
  - `battleEnemyPortraitHitScaleMax`
  - `battleEnemyPortraitHitPulseMs`
  - `battleEnemyPortraitFlashAlpha`
  - `battleEnemyPortraitDeathFadeMs`
- 同步修正运行时覆盖：`BattleScene` 重新接入 fatigue 相关 gameplay 参数到 `setCombatRuntimeOverride`，确保调试页改动即时生效。
- 变更文件：`src/scenes/BattleScene.ts`、`src/config/debugConfig.ts`、`src/debug/debugPage.ts`、`data/debug_defaults.json`；回归：`npm test` 通过（53/53），`npm run build` 通过。

### 本次对话追加（修复敌方受击闪白不生效）

- 修复原因：`applyLayout` 每帧重置敌方立绘 scale，覆盖了受击放缩曲线，导致闪白/放缩观感不明显。
- 修复方案：受击/死亡动画进行中不再被布局层重置；闪白叠层改为 `blendMode='add'` 提升可见度。
- 变更文件：`src/scenes/BattleScene.ts`；回归：`npm test` 通过（53/53）。

### 本次对话追加（仅直伤触发受击 + 下锚点向上放大）

- 按需求收敛触发条件：敌方立绘受击放缩仅由“直伤命中（normal）”触发；中毒/灼烧与 fatigue 不再触发该抖动反馈。
- 受击放缩锚点改为下边缘：敌方立绘与闪白层 anchor 改为 `(0.5, 1)`，并将布局 Y 改为“顶部坐标 + 高度”，实现“以下方为锚点向上放大”。
- 命中点计算同步修正：立绘命中点 Y 基于 `top = y - height` 计算，保证飞点命中位置与新锚点一致。
- 变更文件：`src/scenes/BattleScene.ts`；回归：`npm test` 通过（53/53）。

### 本次对话追加（DOT施加触发受击 + 立绘默认呼吸 + 闪白可配色）

- 受击触发扩展：除直伤命中外，`status_apply` 的中毒/灼烧施加到敌方英雄时也触发立绘受击放缩；DOT持续结算伤害仍不触发。
- 新增敌方立绘默认循环放缩（呼吸感）：可配置周期与最大倍率，且与受击/死亡动画叠加兼容。
- 闪白效果增强并可配置：新增闪白时长与闪白颜色参数，配合现有强度参数；保留 add 混合提升可见度。
- 新增参数（战斗表现）：
  - `battleEnemyPortraitIdleLoopMs`
  - `battleEnemyPortraitIdleScaleMax`
  - `battleEnemyPortraitFlashMs`
  - `battleEnemyPortraitFlashColor`
- 变更文件：`src/scenes/BattleScene.ts`、`src/config/debugConfig.ts`、`src/debug/debugPage.ts`、`data/debug_defaults.json`；回归：`npm test` 通过（53/53），`npm run build` 通过。

### 本次对话追加（所有指向敌方的飞点命中敌人 + 命中时触发受击）

- 飞点目标统一：凡“目标为敌方英雄”的飞行效果，终点统一改为敌方立绘命中点（不再落到敌方血条），覆盖：
  - 普通伤害飞点
  - 敌方自身护盾飞点
  - 治疗飞点（目标为敌方英雄）
  - 状态施加飞点（含我方投掷的灼烧/中毒）
- 触发时机修正：敌方立绘闪白与放缩统一改为 `spawnProjectile` 的命中回调触发，确保“到达目标时”才反馈，不提前触发。
- 保持不变：fatigue 与状态持续结算（非飞点路径）仍不触发飞点命中反馈。
- 变更文件：`src/scenes/BattleScene.ts`；回归：`npm test` 通过（53/53）。

### 本次对话追加（闪白颜色改为颜色控件显示）

- 修复调试页交互：`battleEnemyPortraitFlashColor` 从“战斗表现数值滑条”迁移到“颜色配置”分组，以 `#RRGGBB` 色盘/文本输入显示，不再展示十进制数值滑条。
- 变更文件：`src/debug/debugPage.ts`。

### 本次对话追加（状态数字避让与描边增强）

- 按需求下调“加速”状态数字位置，避免与上方数值重叠（默认 `battleStatusHasteYFactor=0.26`、`battleStatusHasteOffsetY=6`）。
- 强化加速/冻结/减速状态数字的黑色描边效果：描边 join 改为 `round`，默认描边宽度由 2 调整为 3，接近卡牌数值观感。
- 变更文件：`src/scenes/BattleScene.ts`、`data/debug_defaults.json`；回归：`npm test` 通过（53/53）。

### 本次对话追加（敌方状态计时字号跟随敌区缩放）

- 修复敌方加速/减速/冻结数字不随敌方战斗区缩放的问题：移除对 `battleStatusTimerFontSize` 的 `1/zone.scale` 抵消，改为直接使用配置字号，由战斗区缩放统一控制最终屏幕尺寸。
- 结果：当敌方战斗区通过 `enemyAreaScale` 放大/缩小时，敌方状态计时数字与卡牌同步放大/缩小。
- 变更文件：`src/scenes/BattleScene.ts`；回归：`npm test` 通过（53/53）。

### 本次对话追加（背包区下移避免遮挡标题）

- 按需求将背包区整体下移，避免物品与顶部“背包”字样发生遮挡。
- 默认值调整：`backpackZoneY` 从 `560` 调整为 `588`。
- 变更文件：`data/debug_defaults.json`。

### 本次对话追加（背包标签与背包区解耦）

- 针对“背包文字跟随背包区一起移动导致仍被遮挡”问题，新增 `GridZone.setLabelGlobalTop()`，支持标签使用全局 Y 对齐。
- 在 `ShopScene` 中对背包区应用：背包标签固定在背包区上方固定间距（`BACKPACK_LABEL_GLOBAL_Y_GAP=60`），背包网格与物品可继续下移而不压住“背包”字样。
- 变更文件：`src/grid/GridZone.ts`、`src/scenes/ShopScene.ts`；回归：`npm test` 通过（53/53）。

### 本次对话追加（战斗/商店我方战斗区Y对齐）

- 修复“商店阶段与战斗阶段我方战斗区位置不一致”：`BattleScene` 的我方战斗区 Y 改为与 `ShopScene` 相同的缩放补偿公式。
- 调整为：`battleZoneY + (CELL_HEIGHT * (1 - playerScale)) / 2`，避免同一配置在两场景落点不同。
- 变更文件：`src/scenes/BattleScene.ts`。

### 本次对话追加（战斗区额外偏移 + 结束后显示返回按钮）

- 新增“仅战斗场景生效”的我方战斗区附加偏移配置：`battleZoneYInBattleOffset`，用于在 `battleZoneY` 基础上单独微调战斗场景位置。
- 战斗返回按钮改为“仅战斗结束后显示”：`backBtn.visible = engine.isFinished()`；战斗中隐藏。
- 新增战斗返回按钮位置配置：`battleBackBtnX`、`battleBackBtnY`，支持调试页单独拖拽定位。
- 按钮绘制坐标改为局部坐标（容器中心锚点），便于实时应用位置配置。
- 配置接入文件：`src/config/debugConfig.ts`、`src/debug/debugPage.ts`、`data/debug_defaults.json`；逻辑改动：`src/scenes/BattleScene.ts`。
- 回归：`npm test` 通过（53/53），`npm run build` 通过。

### 本次对话追加（战斗结束遮罩 + 倍速按钮）

- 战斗结束展示层优化：返回按钮置于最上层（`zIndex=190`），并在其下增加全屏半透明黑色遮罩（`zIndex=180`），只在战斗结束时显示。
- 新增战斗倍速按钮：战斗中显示，点击循环 `x1/x2/x4/x8`；实际驱动为 `engine.update(dt * speed)`，同时特效/跳字/受击动画按同倍速推进。
- 倍速重置规则：每次进入战斗场景自动重置为 `x1`。
- 交互收口：战斗结束后隐藏倍速按钮，仅保留遮罩 + 返回按钮。
- 变更文件：`src/scenes/BattleScene.ts`；回归：`npm test` 通过（53/53），`npm run build` 通过。

### 本次对话追加（阶段总结回写）

- 已整理本阶段战斗表现与交互改动总结，回写 `design/progress.md` 并同步回传主程 Notebook 供复盘与评审。

### 本次对话追加（总结回传 Notebook）

- 已将本轮 fatigue 相关改动总结回传主程 Notebook，便于后续评审与参数对齐。

### 本次对话追加（2026-03-02，NotebookLM 快速确认 Day1 敌方品质）

- 已按需求通过主程 Notebook（`WebJs开发指南`，id=`9baa2b32-22e4-4896-92bf-ced78ca0d148`）快速确认 Day1 敌方品质规则。
- 结论确认：Day1 敌方应强制仅青铜1星；出现白银属于生成逻辑偏差。
- 最小修复点建议：`buildBattleSnapshot`（`src/scenes/ShopScene.ts`）中敌方 tier 生成分支。
- 本次仅做方案确认，未修改代码文件。

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
