import type { Sprite } from 'pixi.js'
import { getConfig as getDebugCfg } from '@/config/debugConfig'

export class BattlePortraitFX {
  // Player portrait state
  playerHeroSprite: Sprite | null = null
  playerHeroFlashSprite: Sprite | null = null
  playerHeroBaseScale = 1
  private playerHeroHitElapsedMs = -1
  private playerHeroIdleElapsedMs = 0
  // Enemy portrait state
  enemyBossSprite: Sprite | null = null
  enemyBossFlashSprite: Sprite | null = null
  enemyBossBaseScale = 1
  private enemyBossHitElapsedMs = -1
  enemyBossDeathElapsedMs = -1 // public: set by external event handler
  private enemyBossIdleElapsedMs = 0

  reset(): void {
    this.playerHeroSprite = null
    this.playerHeroFlashSprite = null
    this.playerHeroBaseScale = 1
    this.playerHeroHitElapsedMs = -1
    this.playerHeroIdleElapsedMs = 0
    this.enemyBossSprite = null
    this.enemyBossFlashSprite = null
    this.enemyBossBaseScale = 1
    this.enemyBossHitElapsedMs = -1
    this.enemyBossDeathElapsedMs = -1
    this.enemyBossIdleElapsedMs = 0
  }

  getEnemyHitPoint(): { x: number; y: number } | null {
    if (!this.enemyBossSprite || !this.enemyBossSprite.visible) return null
    const yFactor = Math.max(0, Math.min(1, getDebugCfg('battleEnemyPortraitHitYFactor')))
    const top = this.enemyBossSprite.y - this.enemyBossSprite.height
    return {
      x: this.enemyBossSprite.x,
      y: top + this.enemyBossSprite.height * yFactor,
    }
  }

  triggerEnemyHit(): void {
    if (!this.enemyBossSprite || !this.enemyBossSprite.visible) return
    this.enemyBossHitElapsedMs = 0
  }

  getPlayerHitPoint(): { x: number; y: number } | null {
    if (!this.playerHeroSprite || !this.playerHeroSprite.visible) return null
    const yFactor = Math.max(0, Math.min(1, getDebugCfg('battlePlayerPortraitHitYFactor')))
    const top = this.playerHeroSprite.y - this.playerHeroSprite.height
    return {
      x: this.playerHeroSprite.x,
      y: top + this.playerHeroSprite.height * yFactor,
    }
  }

  triggerPlayerHit(): void {
    if (!this.playerHeroSprite || !this.playerHeroSprite.visible) return
    this.playerHeroHitElapsedMs = 0
  }

  tickPlayer(dtMs: number): void {
    if (!this.playerHeroSprite || !this.playerHeroSprite.visible) return

    const loopMs = Math.max(1, getDebugCfg('battlePlayerPortraitIdleLoopMs'))
    this.playerHeroIdleElapsedMs = (this.playerHeroIdleElapsedMs + dtMs) % loopMs
    const loopP = this.playerHeroIdleElapsedMs / loopMs
    const loopWave = (Math.sin(loopP * Math.PI * 2 - Math.PI / 2) + 1) / 2
    const idleScaleMax = Math.max(1, getDebugCfg('battlePlayerPortraitIdleScaleMax'))
    const idleScale = 1 + (idleScaleMax - 1) * loopWave

    if (this.playerHeroHitElapsedMs < 0) {
      this.playerHeroSprite.scale.set(this.playerHeroBaseScale * idleScale)
      if (this.playerHeroFlashSprite) this.playerHeroFlashSprite.alpha = 0
      return
    }

    const hitMs = Math.max(1, getDebugCfg('battlePlayerPortraitHitPulseMs'))
    this.playerHeroHitElapsedMs += dtMs
    const p = Math.max(0, Math.min(1, this.playerHeroHitElapsedMs / hitMs))
    const pulse = Math.sin(Math.PI * p)
    const maxScale = Math.max(1, getDebugCfg('battlePlayerPortraitHitScaleMax'))
    this.playerHeroSprite.scale.set(this.playerHeroBaseScale * idleScale * (1 + (maxScale - 1) * pulse))
    if (this.playerHeroFlashSprite) {
      const flashMs = Math.max(1, getDebugCfg('battlePlayerPortraitFlashMs'))
      const flashP = Math.max(0, Math.min(1, this.playerHeroHitElapsedMs / flashMs))
      this.playerHeroFlashSprite.visible = true
      this.playerHeroFlashSprite.tint = Math.max(0, Math.min(0xffffff, Math.round(getDebugCfg('battlePlayerPortraitFlashColor'))))
      this.playerHeroFlashSprite.alpha = Math.max(0, getDebugCfg('battlePlayerPortraitFlashAlpha') * (1 - flashP))
      this.playerHeroFlashSprite.scale.copyFrom(this.playerHeroSprite.scale)
      this.playerHeroFlashSprite.x = this.playerHeroSprite.x
      this.playerHeroFlashSprite.y = this.playerHeroSprite.y
    }

    if (p >= 1) {
      this.playerHeroHitElapsedMs = -1
      this.playerHeroSprite.scale.set(this.playerHeroBaseScale * idleScale)
      if (this.playerHeroFlashSprite) this.playerHeroFlashSprite.alpha = 0
    }
  }

  tickEnemy(dtMs: number): void {
    if (!this.enemyBossSprite || !this.enemyBossSprite.visible) return

    const loopMs = Math.max(1, getDebugCfg('battleEnemyPortraitIdleLoopMs'))
    this.enemyBossIdleElapsedMs = (this.enemyBossIdleElapsedMs + dtMs) % loopMs
    const loopP = this.enemyBossIdleElapsedMs / loopMs
    const loopWave = (Math.sin(loopP * Math.PI * 2 - Math.PI / 2) + 1) / 2
    const idleScaleMax = Math.max(1, getDebugCfg('battleEnemyPortraitIdleScaleMax'))
    const idleScale = 1 + (idleScaleMax - 1) * loopWave

    if (this.enemyBossDeathElapsedMs >= 0) {
      const deathMs = Math.max(1, getDebugCfg('battleEnemyPortraitDeathFadeMs'))
      this.enemyBossDeathElapsedMs += dtMs
      const p = Math.max(0, Math.min(1, this.enemyBossDeathElapsedMs / deathMs))
      this.enemyBossSprite.alpha = 1 - p
      if (this.enemyBossFlashSprite) this.enemyBossFlashSprite.alpha = 0
      this.enemyBossSprite.scale.set(this.enemyBossBaseScale * idleScale * (1 - 0.08 * p))
      if (p >= 1) {
        this.enemyBossSprite.visible = false
        this.enemyBossSprite.alpha = 1
        this.enemyBossSprite.scale.set(this.enemyBossBaseScale)
        this.enemyBossDeathElapsedMs = -1
      }
      return
    }

    if (this.enemyBossHitElapsedMs < 0) {
      this.enemyBossSprite.scale.set(this.enemyBossBaseScale * idleScale)
      if (this.enemyBossFlashSprite) this.enemyBossFlashSprite.alpha = 0
      return
    }

    const hitMs = Math.max(1, getDebugCfg('battleEnemyPortraitHitPulseMs'))
    this.enemyBossHitElapsedMs += dtMs
    const p = Math.max(0, Math.min(1, this.enemyBossHitElapsedMs / hitMs))
    const pulse = Math.sin(Math.PI * p)
    const maxScale = Math.max(1, getDebugCfg('battleEnemyPortraitHitScaleMax'))
    this.enemyBossSprite.scale.set(this.enemyBossBaseScale * idleScale * (1 + (maxScale - 1) * pulse))
    if (this.enemyBossFlashSprite) {
      const flashMs = Math.max(1, getDebugCfg('battleEnemyPortraitFlashMs'))
      const flashP = Math.max(0, Math.min(1, this.enemyBossHitElapsedMs / flashMs))
      this.enemyBossFlashSprite.visible = true
      this.enemyBossFlashSprite.tint = Math.max(0, Math.min(0xffffff, Math.round(getDebugCfg('battleEnemyPortraitFlashColor'))))
      this.enemyBossFlashSprite.alpha = Math.max(0, getDebugCfg('battleEnemyPortraitFlashAlpha') * (1 - flashP))
      this.enemyBossFlashSprite.scale.copyFrom(this.enemyBossSprite.scale)
      this.enemyBossFlashSprite.x = this.enemyBossSprite.x
      this.enemyBossFlashSprite.y = this.enemyBossSprite.y
    }

    if (p >= 1) {
      this.enemyBossHitElapsedMs = -1
      this.enemyBossSprite.scale.set(this.enemyBossBaseScale * idleScale)
      if (this.enemyBossFlashSprite) this.enemyBossFlashSprite.alpha = 0
    }
  }
}
