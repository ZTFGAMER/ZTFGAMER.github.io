import { Graphics } from 'pixi.js'
import { getConfig as getDebugCfg } from '@/tower/config/debugConfig'
import { getConfig } from '@/tower/core/DataLoader'
import { getDailyGoldForDay } from '@/tower/shop/ShopManager'
import { PvpContext } from '@/tower/pvp/PvpContext'
import { SceneManager } from '@/tower/core/SceneManager'
import { setBattleOutcome } from './BattleOutcomeStore'
import { setBattleSnapshot } from './BattleSnapshotStore'
import type { Container } from 'pixi.js'
import type { BattleEngineLike } from './BattleEngineTypes'
import type { getBattleSnapshot } from './BattleSnapshotStore'

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
    engine: BattleEngineLike | null,
    snapshot: ReturnType<typeof getBattleSnapshot>,
    backBtn: Container | null,
    speedBtn: Container | null,
  ): void {
    if (this.battleExitTransitionDurationMs > 0) return
    const towerMode = getConfig().towerDefenseRules?.enabled === true
    if (towerMode && snapshot) {
      const winner = engine?.getResult()?.winner ?? null
      const nextDay = Math.max(1, Math.round((snapshot.day || 1) + 1))
      const rewardGold = winner === 'player' ? getDailyGoldForDay(getConfig(), nextDay) : 0
      setBattleSnapshot({
        ...snapshot,
        day: nextDay,
        createdAtMs: Date.now(),
        playerGold: Math.max(0, Math.round((snapshot.playerGold ?? 0) + rewardGold)),
      })
    }
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
        const towerMode = getConfig().towerDefenseRules?.enabled === true
        SceneManager.goto(towerMode ? 'tower-battle' : 'tower-shop')
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
