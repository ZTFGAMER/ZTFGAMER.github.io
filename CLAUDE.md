# 大巴扎项目 — Claude Code 工作约定

## 渲染引擎

- **WebGPU 优先**：PixiJS 初始化必须使用 `preference: 'webgpu'`，不支持时自动回退 WebGL。
- 所有渲染代码保持 WebGPU/WebGL 双兼容，禁止硬编码 WebGL 专用路径。

## 角色别名（重要）

- **"设计师"** = 在线设计 Notebook（NotebookLM）。用户说"和设计师沟通"即指使用 NotebookLM 工具查询该 Notebook。
- **"主程"** = 在线技术主程 Notebook（NotebookLM）。用户说"和主程沟通"即指使用 NotebookLM 工具查询该 Notebook。

## 开发与 Debug 流程

- **Notebook 询问触发规则（最高优先）**：默认不主动询问 Notebook；仅当用户明确要求（如“和主程沟通/和设计师沟通/查询 Notebook”）时，才使用 Notebook 工具。
- **技术方案确认**：未收到用户明确指令前，Claude Code 可直接基于仓库现状与既有约定实施；若用户要求走主程确认流程，再向主程（在线技术 Notebook）问询并按确认方案落地。
- **Claude Code 的角色是执行者**：负责落地已确认的方案，不得擅自变更已确认的架构决策。
- **代码 Review 触发规则**：默认不强制提交主程 Notebook Review；仅在用户明确要求主程 Review 时执行。
- **自主调试规程入口**：执行自主验证任务时，先读取项目根目录 `AGENT.md`，按其中 session 流程推进。
- **会话目录初始化**：优先使用 `npm run agent:new -- --topic="主题"` 创建 `agent-sessions/` 记录目录。

## 设计确认流程

- **设计确认触发规则**：默认不主动询问设计师 Notebook；仅当用户明确要求设计确认时再询问并执行。
- 未经设计师确认的方案视为临时占位，需在设计文档中标注 `[待设计确认]`。

## 开发进度追踪

- **进度文件**：`design/progress.md` 是唯一的进度记录文件。
- **每次对话结束前必须更新**：完成任何开发工作后，Claude Code 须在本次对话结束前更新 `design/progress.md`，记录：
  - 本次完成的内容（打勾已完成的任务）
  - 当前所处阶段和下一步计划
  - 遇到的问题、待解决项、技术债务
  - 重要的设计/技术决定记录
- 禁止跨对话遗忘进度：每次新对话开始，先读取 `design/progress.md` 了解当前状态。

## 阶段验收规则（重要）

- **每完成一个阶段，必须先询问用户是否完成所有验收和优化，再进入下一阶段。**
- 用户在验收阶段提出的优化意见必须全部完成并重新验收后，才能推进。
- 优化意见须记录到 `design/progress.md` 的对应阶段中，并标记完成状态。

## 其他约定

- 所有数值从 JSON 读取，禁止硬编码魔法数字。
- 所有新建文本字号必须同步：`data/game_config.json` 的 `text_sizes` + `src/config/debugConfig.ts`（字体大小分组）+ `src/debug/debugPage.ts`（归入“字体大小”），确保可在线调试。
- Canvas 设计分辨率 640×1384，单格 128×128px，CSS 自动缩放适配屏幕。
- 图片路径规则：`resource/itemicon/vanessa/{item.id}.webp`。

## 发布规则（新增）

- **Vercel 发布触发规则（最高优先）**：仅当用户明确提出“更新/发布/上传 Vercel”时，才允许执行 `vercel --prod --yes`。
- 未收到用户明确发布指令时，禁止自动发布到 Vercel；默认只做本地修改与本地验证。
