# WebGPU/WebJS移动端战斗冻结优化增量笔记（2025-2026）

> 仅收录增量更新；不重复对象池、通用固定时间步、通用WebGPU基础。

## Safari26 状态

- Safari 26 兼容性跟踪改为三源联查：MDN Baseline、Can I Use、WebKit Standards Positions；每次发版前固定回归一次，避免依赖已退役的旧状态页。
- 将 `GPUAdapterInfo.isFallbackAdapter` 作为启动门禁：命中 fallback 适配器时自动切到低负载战斗配置（粒子/后处理/阴影分级关闭），防止进入战斗后冻结。
- 对 `GPUDevice.lost` 增加热节流恢复闭环：记录丢失原因、重建设备与关键资源、恢复最低可玩画质，避免 iOS 高温场景长时间黑屏。

## Render-Pass / Bind-Group 批处理

- 按“稳定状态优先”重排 bind-group 槽位：低频资源放 `setBindGroup(0/1)`，高频动态数据后置，减少状态切换抖动导致的主线程阻塞。
- 将静态或半静态批次改为 `GPURenderBundle` 复用，避免每帧重编码大量 draw 指令；战斗高峰时优先保护提交节奏稳定。
- 建立“批次预算”守护：单帧 render pass 数、bind-group 切换数、draw call 数设置硬阈值，超阈值直接走降级路径而不是继续堆命令。

## f16 与 Workgroup 默认值

- 仅在 `shader-f16` 可用时启用半精度路径（粒子、后处理、部分中间缓冲），并保留 f32 回退分支，防止机型碎片化触发崩溃。
- 对 compute 任务显式声明一维 workgroup 策略（默认 `y=1,z=1`），统一调度模板，降低误配导致的线程浪费与突发卡顿。
- 生产配置中强制记录每个 compute pass 的 workgroup 尺寸与 dispatch 规模，超预算时先降采样/降分辨率再提交。

## Safari/WebKit 已知问题与缓解

- 外部纹理（视频/相机）在 Safari 中易出现“纹理过期”时序问题：`importExternalTexture` 与采样必须同一 rAF 任务内完成，禁止跨任务复用句柄。
- 对动态生成 shader 增加上线前 fuzz 与白名单校验，避免触发驱动/编译器边界缺陷导致 GPU 进程异常。
- 保留 iOS 资源格式兜底：高风险贴图链路继续优先 PNG，避免特定格式解码异常引发黑屏或系统回收。

## 生产检查清单

- 启动期：记录适配器类型（含 fallback 标记）、功能开关（含 `shader-f16`）、首帧设备稳定性。
- 运行期：监控 GPU 队列延迟、单帧 pass/draw/bind-group 指标、`GPUDevice.lost` 事件与恢复耗时。
- 战斗期：到达阈值时按顺序降级（后处理 -> 粒子 -> 阴影 -> 分辨率），禁止继续放大命令量。
- 资源期：所有关键 `GPUBuffer/Texture/PassEncoder` 打 `label`，便于真机定位冻结前最后一次高风险提交。
- 发布期：Safari 真机高温长局（20-30 分钟）回归 + 弱网场景回归，达标后再放量。
