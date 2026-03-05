# 自主调试规程

本文件是操作规程：工作流程、目录规范、异常处理。
设计知识请读取 `design/` 下文档，不在本文件维护。

## 项目配置

**设计文档位置**：`design/`
**配置文件位置**：`data/`、`src/config/`

---

## 目录结构

```
agent-sessions/
└── 年月日时分-主题/               每次测试是一个完全独立的目录。
    ├── report.md                  必需。验证假设、过程摘要、控制台记录、下次重点。
    ├── bugs.md                    本次发现或修复的 Bug（无 Bug 则省略）。
    ├── coverage.md                本次验证的功能行（无更新则省略）。
    ├── balance.md                 本次平衡性观察（无观察则省略）。
    └── screenshots/               本次截图目录（按需创建，建议不提交大图）。
```

每个 session 目录完全独立，运行中只读写自己的目录。

---

## 命名规范

**Session 目录名**：`年月日时分-主题`，主题控制在 10 字以内。

```
202603051430-破釜沉舟验证/
202603052000-overlay全链路/
```

---

## 每轮工作循环

```
① 读取设计文档，理解本轮关注功能的设计意图
      ↓
② 提出验证假设：「设计说 X 应该发生，本轮确认游戏实际是否如此」
      ↓
③ 创建 agent-sessions/年月日时分-主题/，新建 report.md，写入验证假设
      ↓
④ 读取相关源码和配置，推导到达目标状态所需的操作路径
      ↓
⑤ 用 playwright-cli 将游戏导航到目标状态，执行观察并截图
      ↓
⑥ 对比实际行为与设计意图：
   ├── 不符 → 定位原因 → 写 bugs.md → 修改代码 → 重新验证 → 更新状态
   └── 符合 → 记录为通过
      ↓
⑦ 写 coverage.md，完善 report.md（过程 + 控制台 + 平衡观察）
      ↓
⑧ 在 report.md 写「下次测试重点」
      ↓
⑨ 返回 ① 开始下一轮（新建新的 session 目录）
```

---

## 操作约束

- **修复范围**：只修复当前验证假设涉及的问题，不做无关改动，不重构周边代码。
- **控制台采集**：优先 `window.__consoleLogs || []`；若为空，使用 `document.querySelectorAll('[data-error]')` 或直接界面观察。
- **设计权威来源**：`design/` 是设计意图权威来源。代码与设计不符即为 Bug；若设计与配置冲突，优先设计并在 `bugs.md` 注记。

---

## 异常处理

| 情况 | 处理方式 |
|------|----------|
| HMR 热重载导致游戏重置 | 重新导航到目标状态，不视为 Bug，在 report.md 注记 |
| playwright-cli 操作无响应 | 执行 `playwright-cli --headed close` 后重新 `open`，最多重试 2 次 |
| 同一 Bug 修复后仍复现 | 第 3 次失败时停止修复，在 bugs.md 标 `观察中` 并记录尝试方案，本轮结束 |
| 目标功能无法触达 | 重新读取源码确认前置条件；若仍无法触达，在 report.md 记录原因，换下一个验证假设 |

### 停止条件

满足以下任一条件时停止循环，等待用户介入：

- 要求验证的所有已实现功能均已验证，无新的设计点可推导。
- 连续 3 轮均因前置条件无法满足而无法触达目标。
- playwright-cli 重试 2 次后仍无法连接。

---

## 状态标记

| 标记 | 含义 |
|------|------|
| `未修复` | 已确认的问题，尚未处理 |
| `观察中` | 偶发或无法稳定复现，持续观察 |
| `已知限制` | 非 Bug，开发环境或设计约束，无需修复 |
| `已修复` | 已修复并验证 |

---

## 快速使用

先创建本轮 session 目录：

```bash
npm run agent:new -- --topic="合成规则验证" --hypothesis="设计说同物品合成应产出本职业其他物品"
```

如需一并创建 `bugs.md` / `coverage.md` / `balance.md`：

```bash
npm run agent:new -- --topic="战斗结算复测" --with-bugs --with-coverage --with-balance
```

---

## playwright-cli 常用操作

开发服务器：`http://localhost:5173/`

> 注意：所有 `playwright-cli` 命令必须在 `playwright-cli` 后紧跟 `--headed` 参数。

```bash
# 启动 / 关闭
playwright-cli --headed open http://localhost:5173/
playwright-cli --headed close

# 截图
playwright-cli --headed screenshot --filename=agent-sessions/年月日时分-主题/screenshots/描述.png

# 点击 / 等待
playwright-cli --headed click "button:has-text('文字')"
playwright-cli --headed wait-for-selector ".selector"

# 读取当前界面文字
playwright-cli --headed evaluate "document.body.innerText.slice(0,300)"

# 读取控制台
playwright-cli --headed evaluate "window.__consoleLogs || []"

# 拖拽
playwright-cli --headed drag-and-drop ".source" ".target"
```
