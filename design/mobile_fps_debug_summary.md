# 手机端战斗帧率问题排查复盘

## 1. 问题背景

- 现象：
  - Day1 战斗基本稳定 60 FPS；
  - 天数越往后，战斗 FPS 越低（可到 40/30）；
  - 商店场景稳定 60 FPS。
- 用户直觉：是否后期图片加载过量导致卡顿。

## 2. 初始判断思路

先按“场景隔离 + 负载类型”拆问题：

1. 商店稳、战斗掉帧 -> 优先看战斗 update 主循环，不先归因为通用渲染。  
2. Day1 稳、Day10+ 掉 -> 优先看复杂度增长（逻辑/特效事件密度/布局成本）。  
3. 重启后 Day10 从 30 回到 50 -> 说明存在“跨局累计因素”（缓存/内存/纹理驻留）叠加。  

结论：不是单一原因，属于“后期基线负载高 + 跨流程累计成本”叠加。

## 3. 排查与修复步骤（按时间顺序）

## Step A：先做低风险算力减负（不改玩法）

- 动作：
  - `CombatEngine.getRuntimeState()` 增加同 tick 缓存；
  - 状态层更新复用 BattleScene 已算出的 runtime map，去掉重复拉取。
- 目的：减少每帧重复计算。
- 结果：低复杂场景（Day1）稳定性好，说明优化方向正确。

## Step B：收口战斗前缓存，确保“每场重新加载”

- 动作：
  - 增强移动端战斗入场缓存清理：
    - 卸载已追踪资源；
    - 清空 downscale 运行时缓存；
    - 清空资源追踪表。
- 目的：验证是否有跨局累计导致的额外掉帧。
- 结果：
  - 现象支持“累计因素存在”，但仍有后期基线负载问题。

## Step C：搭建线上真机性能采集链路（关键）

- 动作：
  - 部署 Cloudflare Worker + D1：
    - `POST /perf/ingest`
    - `GET /perf/query`
    - 24h 自动清理。
  - 线上 URL 参数开关上报（`perf=1`）。
- 遇到问题：手机无数据入库。
- 根因：CORS 预检没放行 `X-Perf-Schema`。
- 修复：补齐 `Access-Control-Allow-Headers`，上报恢复。

## 3.1 本次使用的线上工具与真实测试方式

- 游戏线上地址（真机打开）：
  - `https://ztfgamer.github.io/`
- 性能采集服务：
  - Cloudflare Worker：`https://perf-ingest-worker.ztf8938.workers.dev`
  - 入库接口：`POST /perf/ingest`
  - 查询接口：`GET /perf/query`
- 存储：Cloudflare D1（24h 滚动清理）。

真机测试 URL（示例）：

```text
https://ztfgamer.github.io/?v=20260318c&perf=1&perfEndpoint=https%3A%2F%2Fperf-ingest-worker.ztf8938.workers.dev%2Fperf%2Fingest&perfToken=<PERF_TOKEN>
```

说明：

- `perf=1`：开启性能上报。
- `perfEndpoint`：Worker ingest 地址（URL 编码）。
- `perfToken`：鉴权 token（建议临时 token，测试后失效）。
- `v=...`：防缓存参数，确保手机拿到最新构建。

我们实际执行的真机回归脚本：

1. 冷启动（重启浏览器）后直接进 Day10，连续打 2 局。  
2. 从 Day1 连续推进到 Day10，再连续打 2 局。  
3. 每轮记录开始时间（分钟级），便于对齐日志。

数据拉取方式（分析端）：

```bash
curl -H "Authorization: Bearer <PERF_TOKEN>" \
  "https://perf-ingest-worker.ztf8938.workers.dev/perf/query?from=<ms>&to=<ms>&scene=battle&limit=5000"
```

这一步会返回 battle 点位，我们按 `session_id` 切分后看：

- `fps / frame_ms_p95 / long_frame_count`
- `battleUpdateMsP95 / battleLayoutMsP95 / battleMainResidualMsP95`
- `battleDropRate / queuePendingRatio`

## Step D：用数据而非体感做归因

- 实测数据（连续多天）显示：
  - FPS 从 ~50 持续跌到 ~30；
  - `battleDropRate=0`、队列比率接近 0，排除“特效丢弃/队列爆炸”为主因。
- 新增分段埋点（BattleScene 主线程拆分）：
  - `battleUpdateMs*`、`battleEngineUpdateMs*`、`battleRuntimeBuildMs*`、
  - `battleOverlayMs*`、`battleStatusFxMs*`、`battleFxTickMs*`、
  - 后续再加 `battleMainResidualMs*`（总耗时减子项和）。

## Step E：锁定主瓶颈为“每帧重复布局”

- 证据：
  - 残差很小，说明拆分覆盖完整；
  - `battleLayoutMsP95` 在低帧段非常高（可到数十毫秒），远高于其他子项。
- 修复：
  - 将 `setActiveColCount + applyZoneVisualStyle + applyLayout` 改为“仅列数变化时执行”；
  - 增加 `appliedActiveCols` 缓存，进入/离开战斗重置。
- 效果：
  - 用户反馈 Day10 起连续两天不再掉帧。

## Step F：顺带修复视觉问题

- 子弹白块：
  - 根因：首次发射时 sprite 先用 `Texture.WHITE`，贴图异步到达前会闪白；
  - 修复：预热 + 加载去重；仅贴图命中缓存时走精灵弹道，未命中先用 dot。
- 等级徽标偏移争议：
  - 最终按用户要求：战斗内直接隐藏“等级数字+背景框”，避免设备差异下的视觉偏差。

## 4. 这次排查的核心方法论

1. **先做现象切片**：按场景、天数、重启前后切分。  
2. **先证伪大方向**：用数据排除“特效丢弃/队列堆积”等错误假设。  
3. **分段埋点逐层下钻**：从总耗时 -> 子模块 -> 残差。  
4. **优先低风险修复**：先缓存/重复计算/重复布局，不先改玩法数值。  
5. **每轮都可回归复现**：固定脚本（Day10 连续战斗、重启对照）反复验证。

## 5. 最终有效修复清单

- Runtime 计算缓存（同 tick）。
- 状态层复用 runtime，避免重复计算。
- 移动端战斗前缓存清理与资源追踪重置。
- 线上性能上报链路（Worker + D1 + CORS 修复）。
- BattleScene 分段埋点 + 残差埋点。
- **每帧重复布局改为按需布局（关键收益点）**。
- 投射物贴图预热/去重，消除首发白块。
- 战斗内隐藏等级徽标（按产品决定）。

## 6. 可复用的最小排查模板（给其他项目）

1. 先做 A/B 用例：`轻负载 vs 重负载`、`冷启动 vs 热运行`。  
2. 先上报总帧指标：`fps / frameP95 / longFrameCount`。  
3. 再上报子系统耗时：`update / logic / layout / fx / ui`。  
4. 加 residual：`total - sum(children)`，防止漏诊。  
5. 先修重复工作（重复计算、重复布局、重复资源加载），再动算法。

## 7. 当前状态

- 已验证：后期连续战斗稳定性显著改善。
- 后续建议：继续保留线上 perf 链路，作为每次战斗改动后的回归基线。
