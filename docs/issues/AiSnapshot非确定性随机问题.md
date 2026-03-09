# AiSnapshot 非确定性随机问题

## 📋 问题概述

`generateAiSnapshot` 函数（`AiSnapshot.ts`）负责在玩家断线或 AI 补位时生成战斗快照，但内部使用了两处非确定性的 `Math.random()`。尽管 AI 快照由房主生成后统一分发给所有客户端（不直接导致双端同步分叉），但随机性破坏了以下两个保证：

- **可复现性**：同天同参数下，每次调用 `generateAiSnapshot(day)` 的结果不同，无法在调试或重放时还原相同场景。
- **Seed 机制被架空**：函数内已有基于 `day` 的 `seed` 来决定物品选取起点，但在随机 shuffle 后，候选数组顺序随机化，seed 的确定性遍历形同虚设，实际物品选取完全依赖 shuffle 结果。

---

## 🎯 核心问题

### Math.random() shuffle 破坏 seed 确定性

**问题说明**：

- `candidates` 数组在过滤后通过 `.sort(() => Math.random() - 0.5)` 随机打乱
- 随后通过 `seed = (day * 31 + 7) % candidates.length` 计算起点，再以 `(seed + i) % candidates.length` 顺序选取物品
- 由于数组顺序已被随机化，`seed` 的确定性只是在随机结果上提供了一个随机起点，两层随机叠加，AI 阵容完全不可预测

**实现说明**：

- 在 `AiSnapshot.ts` 中的 `generateAiSnapshot` 函数实现，位于候选物品过滤和物品选取循环之间

### Math.random() 影响 tier 选取

**问题说明**：

- 每个物品的等级（Bronze/Silver/Gold）通过 `Math.floor(Math.random() * tierPool.length)` 随机决定
- 同一 `day` 下，每次调用可能产生完全不同的等级分布

**实现说明**：

- 在 `AiSnapshot.ts` 中的 `generateAiSnapshot` 函数内物品构建循环实现

---

## 🔄 系统影响

| 影响维度 | 描述 |
|---------|------|
| 可复现性 | 同 day 同输入，AI 快照内容不同，无法复现 |
| seed 机制 | 已有的 `day * 31 + 7` seed 设计被 shuffle 完全架空 |
| PVP 同步 | AI 快照由房主一次生成并分发，本身不造成双端分叉，但房主重连或重试时快照不同 |
| PVE 影响 | PVE 使用 `makeEnemyRunners` 而非 `generateAiSnapshot`，不受影响 |

---

## 📊 业务流程

```
房主 hostDispatchSnapshots()
    ↓
某玩家未提交快照
    ↓
generateAiSnapshot(day) — 两处 Math.random()
    ├─ candidates.sort(Math.random)  → 随机顺序
    └─ seed 起点 % 随机化数组       → 实际物品随机
    ↓
快照发送给对应客户端
    ↓
如房主重连重新调用 → 生成不同快照
```

---

## 🎯 修复方向

- 移除 `.sort(() => Math.random() - 0.5)` shuffle，改用 `makeSeededRng` 基于 `day` 生成确定性 RNG，对 `candidates` 使用已有的 `shuffleDeterministic` 方法进行确定性洗牌
- tier 选取改为使用同一 RNG 实例的下一次调用，保证同 `day` 输入产生相同结果

---

## 📝 总结

`generateAiSnapshot` 通过 `Math.random()` 引入双重随机性，不仅破坏了函数内已有的 `seed` 设计意图，也使 AI 快照完全不可复现，修复方向是统一改用基于 `day` 的确定性 RNG，与引擎其他随机逻辑保持一致。
