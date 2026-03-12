import type { BattleSnapshotBundle } from '@/battle/BattleSnapshotStore'

export interface BattleOutcome {
  result: {
    winner: 'player' | 'enemy' | 'draw'
    ticks: number
  } | null
  snapshot: BattleSnapshotBundle | null
  finishedAtMs: number
}

let currentOutcome: BattleOutcome | null = null

export function setBattleOutcome(outcome: BattleOutcome): void {
  currentOutcome = {
    result: outcome.result ? { ...outcome.result } : null,
    snapshot: outcome.snapshot
      ? {
          day: outcome.snapshot.day,
          activeColCount: outcome.snapshot.activeColCount,
          createdAtMs: outcome.snapshot.createdAtMs,
          entities: outcome.snapshot.entities.map((it) => ({ ...it })),
        }
      : null,
    finishedAtMs: outcome.finishedAtMs,
  }
}

export function consumeBattleOutcome(): BattleOutcome | null {
  if (!currentOutcome) return null
  const out: BattleOutcome = {
    result: currentOutcome.result ? { ...currentOutcome.result } : null,
    snapshot: currentOutcome.snapshot
      ? {
          day: currentOutcome.snapshot.day,
          activeColCount: currentOutcome.snapshot.activeColCount,
          createdAtMs: currentOutcome.snapshot.createdAtMs,
          entities: currentOutcome.snapshot.entities.map((it) => ({ ...it })),
        }
      : null,
    finishedAtMs: currentOutcome.finishedAtMs,
  }
  currentOutcome = null
  return out
}

export function clearBattleOutcome(): void {
  currentOutcome = null
}
