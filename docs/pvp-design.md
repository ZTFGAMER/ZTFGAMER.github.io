# PVP 联机对战设计文档

## 概述

新增独立 PVP 游戏模式，与当前 PVE 模式完全隔离。玩家通过 PeerJS P2P 连接，使用房间码邀请对战。

## 技术架构

### 网络层

- **PeerJS**（npm: `peerjs`）WebRTC P2P，公共信令服务器 `0.peerjs.com`
- **拓扑**：Hub-and-spoke，房主作为中继节点
- **信令流**：所有消息经房主转发；房主同时是玩家
- **房间码**：6 位大写字母数字（如 `ABC123`），即 PeerJS Peer ID

### 模块划分

```
src/pvp/
  PvpTypes.ts        — 共享类型定义
  PeerConnection.ts  — PeerJS 底层封装
  PvpRoom.ts         — 房间协议（加入/消息/快照交换）
  AiSnapshot.ts      — AI 对手快照生成（断线/不足补位）
  PvpContext.ts      — 全局协调器（桥接房间 ↔ SceneManager）

src/scenes/
  MenuScene.ts       — 启动菜单（PVE / PVP 模式选择）
  PvpLobbyScene.ts   — 大厅（创建/加入房间，等待开始）
  PvpResultScene.ts  — 最终排名展示
```

### 对已有代码的改动（最小化）

| 文件 | 改动内容 | 行数 |
|------|---------|------|
| `package.json` | 添加 peerjs 依赖 | +1 |
| `src/core/EventBus.ts` | SceneName 新增 `'menu' \| 'pvp-lobby' \| 'pvp-result'` | +1 |
| `src/combat/BattleSnapshotStore.ts` | 新增可选字段 `pvpEnemyEntities` | +2 |
| `src/combat/CombatEngine.ts` | start() 检查 pvpEnemyEntities 替代 makeEnemyRunners | +5 |
| `src/main.ts` | 注册新场景，入口改为 `menu` | +10 |
| `src/scenes/ShopScene.ts` | 进入战斗按钮增加 PVP hook | +8 |
| `src/scenes/BattleScene.ts` | 结算跳过 PVE 生命/奖杯，增加 PVP 路由 | +15 |

## 游戏流程

### 模式选择

```
启动 → MenuScene
  ├── [冒险模式] → ShopScene (PVE，现有逻辑)
  └── [联机对战] → PvpLobbyScene
```

### PVP 大厅流程

```
PvpLobbyScene
  ├── 输入昵称
  ├── 选择玩家数（2 / 3 / 4）
  ├── [创建房间] → 生成6位房间码，等待其他玩家加入
  └── [加入房间] → 输入房间码，连接房主

等待房间（房主界面）
  ├── 实时显示已连接玩家列表
  ├── 不足时显示 "AI" 占位
  └── [开始游戏] → 房主触发，AI 填满不足人数
```

### 每日流程（共 9 天）

```
Day N:
  1. 所有玩家进入 ShopScene（共用，PvpContext.isActive() = true）
  2. 倒计时 90 秒（PvpContext 覆盖层显示）
  3. 玩家点击"进入战斗"（PVP 模式下 = 准备）
     → buildBattleSnapshot → PvpContext.onPlayerReady()
     → 上传快照到房主，显示等待覆盖层
  4. 所有人准备 OR 倒计时归零 → 房主分发对手快照
  5. PvpContext 组装 pvpEnemyEntities → setBattleSnapshot → goto('battle')
  6. BattleScene 正常运行（不扣 PVE 生命/奖杯）
  7. 战斗结束 → PvpContext.onBattleComplete()
     → 记录胜负 → day++ → goto('shop') 或 goto('pvp-result')
```

### 结算流程

```
Day 9 结束 → PvpResultScene
  ├── 展示排名（按胜场降序）
  ├── [再来一局] → PvpLobbyScene（重新匹配）
  └── [返回主菜单] → MenuScene
```

## 对战编排（固定循环）

对于第 d 天（d 从 0 开始），我的对手 = `opponents[d % opponents.length]`

其中 `opponents` = 房间内除我以外的玩家下标列表（升序排列）。

**4 人示例（玩家 0 视角）：**

| 天 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|----|---|---|---|---|---|---|---|---|---|
| 对手 | P1 | P2 | P3 | P1 | P2 | P3 | P1 | P2 | P3 |

每个对手各打 3 次，对称关系（A 打 B 快照 与 B 打 A 快照 独立计算）。

## 消息协议

```typescript
// Client → Host
{ type: 'join',           nickname: string }
{ type: 'snapshot_ready', day: number, snapshot: BattleSnapshotBundle }

// Host → Client(s)
{ type: 'room_state',       players: PvpPlayer[] }
{ type: 'game_start',       myIndex: number, totalPlayers: number, countdownMs: number }
{ type: 'day_ready',        day: number, countdownMs: number }
{ type: 'player_status',    day: number, readyIndices: number[] }
{ type: 'opponent_snapshot', day: number, snapshot: BattleSnapshotBundle }
{ type: 'game_over',        rankings: { nickname: string, wins: number }[] }
```

## 存档隔离

PVP 模式启动时：
- 备份 PVE 存档至 `bigbazzar_pve_backup_v1`
- 清空 `bigbazzar_shop_state_v1` 以全新开始

PVP 模式结束时：
- 从备份恢复 PVE 存档

PVE 生命/奖杯在整个 PVP 过程中不受影响。

## 已知限制 / 后续优化

- PeerJS 公共信令服务器有速率限制，正式上线建议自托管
- 固定对战编排对 3 人局不完全均等（5:4），后续可优化
- 暂不支持观战和回放
- 断线玩家替换为 AI 后，AI 快照随机生成（无法获取断线玩家实际阵容）
