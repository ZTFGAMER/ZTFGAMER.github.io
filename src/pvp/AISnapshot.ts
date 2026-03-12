// ============================================================
// AiSnapshot — 为断线/AI 玩家生成适合当天的战斗快照
// ============================================================

import type { BattleSnapshotBundle } from '@/battle/BattleSnapshotStore'
import { getAllItems } from '@/core/DataLoader'
import { normalizeSize } from '@/common/items/ItemDef'

// 确定性 RNG（xorshift，与 CombatEngine.makeSeededRng 实现相同）
function makeRng(seed: number): () => number {
  let s = (seed | 0) ^ 0x9e3779b9
  if (s === 0) s = 0x6d2b79f5
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 1000000) / 1000000
  }
}

function shuffleWithRng<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]!; out[i] = out[j]!; out[j] = tmp
  }
  return out
}

/** 生成一个 AI 战斗快照（作为对手使用，side 将在 PvpContext 中设为 enemy） */
export function generateAiSnapshot(day: number): BattleSnapshotBundle {
  const items = getAllItems()
  const activeColCount = Math.min(6, 3 + Math.floor(day / 3))

  const sizeW = (size: '1x1' | '2x1' | '3x1'): number =>
    size === '1x1' ? 1 : size === '2x1' ? 2 : 3

  // 根据天数选择合适等级的道具
  const tierPool = day >= 7 ? ['Gold', 'Silver', 'Bronze'] :
                   day >= 4 ? ['Silver', 'Bronze'] :
                              ['Bronze']

  const rng = makeRng(day * 7919 + items.length * 13)

  const candidates = shuffleWithRng(
    items.filter((it) => {
      const stats = it.damage + it.heal + it.shield + it.burn + it.poison + it.regen
      if (stats <= 0) return false
      const avail = (it.available_tiers || '').toLowerCase()
      return tierPool.some((t) => avail.includes(t.toLowerCase()) || !it.available_tiers)
    }),
    rng,
  )

  const entities: BattleSnapshotBundle['entities'] = []
  let col = 0

  for (let i = 0; i < candidates.length && col < activeColCount; i++) {
    const def = candidates[i]!
    const size = normalizeSize(def.size)
    const w = sizeW(size)
    if (col + w > activeColCount) continue

    const tier = tierPool[Math.floor(rng() * tierPool.length)] as 'Bronze' | 'Silver' | 'Gold' | 'Diamond'

    entities.push({
      instanceId: `ai-day${day}-${i}`,
      defId: def.id,
      size,
      col,
      row: 0,
      tier,
      tierStar: 1,
    })
    col += w
  }

  return {
    day,
    activeColCount,
    createdAtMs: Date.now(),
    entities,
  }
}
