import { Graphics } from 'pixi.js'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { PvpContext } from '@/pvp/PvpContext'
import { SceneManager } from '@/scenes/SceneManager'
import { setBattleOutcome } from '@/combat/BattleOutcomeStore'
import type { Container } from 'pixi.js'
import type { CombatEngine } from '@/combat/CombatEngine'
import type { getBattleSnapshot } from '@/combat/BattleSnapshotStore'

export class BattleTransition {
  private battleIntroElapsedMs = 0
  battleIntroDurationMs = 0
  battleIntroCover: Graphics | null = null
  private battleExitTransitionElapsedMs = 0
  battleExitTransitionDurationMs = 0
  sceneFadeOverlay: Graphics | null = null

  tickIntro(
    dtMs: number,
    root: Container | null,
  ): boolean {
    if (!root) return true
    if (this.battleIntroDurationMs <= 0) {
      root.alpha = 1
      if (this.battleIntroCover) {
        this.battleIntroCover.parent?.removeChild(this.battleIntroCover)
        this.battleIntroCover.destroy()
        this.battleIntroCover = null
      }
      return true
    }
    this.battleIntroElapsedMs += Math.max(0, dtMs)
    const p = Math.max(0, Math.min(1, this.battleIntroElapsedMs / this.battleIntroDurationMs))
    const eased = 1 - Math.pow(1 - p, 3)
    root.alpha = eased
    if (this.battleIntroCover) this.battleIntroCover.alpha = 1 - eased
    if (p >= 1) {
      if (this.battleIntroCover) {
        this.battleIntroCover.parent?.removeChild(this.battleIntroCover)
        this.battleIntroCover.destroy()
        this.battleIntroCover = null
      }
      return true
    }
    return false
  }

  beginExit(
    engine: CombatEngine | null,
    snapshot: ReturnType<typeof getBattleSnapshot>,
    backBtn: Container | null,
    speedBtn: Container | null,
  ): void {
    if (this.battleExitTransitionDurationMs > 0) return
    setBattleOutcome({
      result: engine?.getResult() ?? null,
      snapshot,
      finishedAtMs: Date.now(),
    })
    this.battleExitTransitionElapsedMs = 0
    this.battleExitTransitionDurationMs = Math.max(1, getDebugCfg('battleToShopTransitionMs'))
    if (this.sceneFadeOverlay) {
      this.sceneFadeOverlay.visible = true
      this.sceneFadeOverlay.alpha = 0
    }
    if (backBtn) {
      backBtn.eventMode = 'none'
      backBtn.cursor = 'default'
    }
    if (speedBtn) {
      speedBtn.eventMode = 'none'
    }
  }

  tickExit(dtMs: number): boolean {
    if (this.battleExitTransitionDurationMs <= 0) return false
    this.battleExitTransitionElapsedMs += Math.max(0, dtMs)
    const p = Math.max(0, Math.min(1, this.battleExitTransitionElapsedMs / this.battleExitTransitionDurationMs))
    const eased = 1 - Math.pow(1 - p, 3)
    if (this.sceneFadeOverlay) this.sceneFadeOverlay.alpha = eased
    if (p >= 1) {
      this.battleExitTransitionElapsedMs = 0
      this.battleExitTransitionDurationMs = 0
      if (PvpContext.isActive()) {
        PvpContext.onBattleComplete()
      } else {
        SceneManager.goto('shop')
      }
      return true
    }
    return true
  }

  reset(): void {
    this.battleIntroElapsedMs = 0
    this.battleIntroDurationMs = 0
    this.battleExitTransitionElapsedMs = 0
    this.battleExitTransitionDurationMs = 0
    if (this.battleIntroCover) {
      this.battleIntroCover.parent?.removeChild(this.battleIntroCover)
      this.battleIntroCover.destroy()
      this.battleIntroCover = null
    }
    this.sceneFadeOverlay = null
  }
}
