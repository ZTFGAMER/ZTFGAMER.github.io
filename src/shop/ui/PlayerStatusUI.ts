// ============================================================
// PlayerStatusUI — 玩家状态面板（函数集合模式）
// 职责：
//   - 玩家等级/经验值计算辅助函数（getPlayerLevelCap 等）
//   - 玩家等级/经验 UI 刷新（refreshPlayerStatusUI）
//   - 玩家状态面板布局（layoutPlayerStatusPanel）
//   - 玩家升级特效（playPlayerLevelUpFx）
//   - 品质等级区间辅助（getQualityLevelRange）
//   - 实例等级辅助（getInstanceLevel）
// ============================================================

import { getConfig } from '@/core/DataLoader'
import { getPlayerProgressState } from '@/core/RunState'
import type { TierKey } from '@/shop/ShopManager'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { Assets, Graphics, Texture, Ticker } from 'pixi.js'
import { tierStarLevelIndex } from '../systems/ShopSynthesisLogic'
import { PvpContext } from '@/pvp/PvpContext'
import type { ShopSceneCtx } from '../ShopSceneContext'
import { getApp } from '@/core/AppContext'
import { getBattleZoneDisplayY } from '../ShopMathHelpers'

// ============================================================
// 品质等级辅助
// ============================================================

export function clampLevel(level: number): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return Math.max(1, Math.min(7, Math.round(level))) as 1 | 2 | 3 | 4 | 5 | 6 | 7
}

export function getQualityLevelRange(quality: TierKey): { min: 1 | 2 | 3 | 4 | 5 | 6 | 7; max: 1 | 2 | 3 | 4 | 5 | 6 | 7 } {
  const cfg = getConfig().shopRules?.qualityLevelRange?.[quality]
  const defaultMin = quality === 'Bronze' ? 1 : quality === 'Silver' ? 2 : quality === 'Gold' ? 4 : 6
  const min = clampLevel(Number(cfg?.min ?? defaultMin))
  const max = clampLevel(Number(cfg?.max ?? 7))
  return { min, max: Math.max(min, max) as 1 | 2 | 3 | 4 | 5 | 6 | 7 }
}

export function levelFromLegacyTierStar(tier: TierKey, star: 1 | 2): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return clampLevel(tierStarLevelIndex(tier, star) + 1)
}


// ============================================================
// 玩家等级/经验辅助函数
// ============================================================

export function getPlayerExpToNextLevelTable(): number[] {
  const raw = getConfig().runRules?.playerExpToNextLevel
  if (!Array.isArray(raw) || raw.length <= 0) return [3, 4, 5, 6, 7, 8, 9, 10, 12]
  return raw.map((n) => Math.max(1, Math.round(Number(n) || 1)))
}

export function getPlayerMaxLifeByLevelTable(): number[] {
  const raw = getConfig().runRules?.playerMaxLifeByLevel
  if (!Array.isArray(raw) || raw.length <= 0) return [30, 34, 38, 42, 46, 50, 54, 58, 62, 66]
  return raw.map((n) => Math.max(1, Math.round(Number(n) || 1)))
}

export function getPlayerLevelCap(): number {
  return Math.max(1, getPlayerMaxLifeByLevelTable().length)
}

export function clampPlayerLevel(level: number): number {
  const cap = getPlayerLevelCap()
  if (!Number.isFinite(level)) return 1
  return Math.max(1, Math.min(cap, Math.round(level)))
}

export function getPlayerExpNeedByLevel(level: number): number {
  const table = getPlayerExpToNextLevelTable()
  const idx = Math.max(0, Math.min(table.length - 1, clampPlayerLevel(level) - 1))
  return Math.max(1, Math.round(table[idx] ?? table[table.length - 1] ?? 1))
}

export function getPlayerMaxLifeByLevel(level: number): number {
  const table = getPlayerMaxLifeByLevelTable()
  const idx = Math.max(0, Math.min(table.length - 1, clampPlayerLevel(level) - 1))
  return Math.max(1, Math.round(table[idx] ?? table[table.length - 1] ?? 1))
}

// ============================================================
// 玩家状态 UI 刷新
// ============================================================

export function refreshPlayerStatusUI(
  ctx: ShopSceneCtx,
  deps: {
    getHeroIconByStarterClass: () => string
    shouldShowHeroDailySkillReadyStar: () => boolean
  },
): void {
  if (!ctx.playerStatusCon || !ctx.playerStatusLvText || !ctx.playerStatusExpBar) return
  const progress = getPlayerProgressState()
  const level = clampPlayerLevel(progress.level)
  const levelCap = getPlayerLevelCap()
  const expNeed = getPlayerExpNeedByLevel(level)
  const exp = level >= levelCap ? 0 : Math.max(0, Math.min(expNeed, Math.round(progress.exp)))

  ctx.playerStatusLvText.text = `Lv${level}`

  ctx.playerStatusExpBar.clear()
  {
    const areaW = Math.max(8, getDebugCfg('shopPlayerStatusExpBarWidth') - 4)
    const areaH = Math.max(8, getDebugCfg('shopPlayerStatusExpBarHeight') - 4)
    const totalBeans = Math.max(1, expNeed)
    const filledBeans = level >= levelCap ? totalBeans : Math.max(0, Math.min(totalBeans, exp))
    let gap = 3
    const minBeanW = 2
    let beanW = (areaW - gap * (totalBeans - 1)) / totalBeans
    while (gap > 0 && beanW < minBeanW) {
      gap -= 1
      beanW = (areaW - gap * (totalBeans - 1)) / totalBeans
    }
    if (beanW > 0) {
      const radius = Math.min(8, Math.max(2, beanW / 2))
      for (let i = 0; i < totalBeans; i++) {
        const x = i * (beanW + gap)
        ctx.playerStatusExpBar.roundRect(x, 0, beanW, areaH, radius)
        ctx.playerStatusExpBar.fill({ color: i < filledBeans ? 0x5db5ff : 0x2d3f63, alpha: 0.98 })
      }
    }
  }

  const nextAvatarUrl = deps.getHeroIconByStarterClass()
  if (ctx.playerStatusAvatar && ctx.playerStatusAvatarUrl !== nextAvatarUrl) {
    ctx.playerStatusAvatarUrl = nextAvatarUrl
    void Assets.load<Texture>(nextAvatarUrl).then((tex) => {
      if (!ctx.playerStatusAvatar || ctx.playerStatusAvatarUrl !== nextAvatarUrl) return
      ctx.playerStatusAvatar.texture = tex
      ctx.playerStatusAvatar.alpha = 1
    }).catch(() => {
      // ignore runtime missing icon
    })
  }

  if (ctx.playerStatusDailySkillStar) {
    ctx.playerStatusDailySkillStar.visible = !PvpContext.isActive() && deps.shouldShowHeroDailySkillReadyStar()
  }
}

// ============================================================
// 玩家状态面板布局
// ============================================================

export function layoutPlayerStatusPanel(ctx: ShopSceneCtx): void {
  if (!ctx.playerStatusCon || !ctx.playerStatusAvatar || !ctx.playerStatusLvText || !ctx.playerStatusExpBg || !ctx.playerStatusExpBar) return

  // 常规布局（冒险模式与 PVP 模式统一）
  const avatarX = 260
  const avatarY = 10
  const avatarW = 120
  const avatarH = 120
  const avatarCenterX = avatarX + avatarW / 2
  const expW = Math.max(40, getDebugCfg('shopPlayerStatusExpBarWidth'))
  const expH = Math.max(12, getDebugCfg('shopPlayerStatusExpBarHeight'))
  const expOffsetX = getDebugCfg('shopPlayerStatusExpBarOffsetX')
  const expOffsetY = getDebugCfg('shopPlayerStatusExpBarOffsetY')
  const expX = avatarCenterX - expW / 2 + expOffsetX
  const expY = avatarY + avatarH + expOffsetY

  ctx.playerStatusCon.x = getDebugCfg('shopPlayerStatusX')
  ctx.playerStatusCon.y = getBattleZoneDisplayY(ctx) + getDebugCfg('shopPlayerStatusY')

  ctx.playerStatusAvatar.x = avatarX
  ctx.playerStatusAvatar.y = avatarY
  ctx.playerStatusAvatar.width = avatarW
  ctx.playerStatusAvatar.height = avatarH
  if (ctx.playerStatusAvatarClickHit) {
    ctx.playerStatusAvatarClickHit.clear()
    ctx.playerStatusAvatarClickHit.rect(avatarX, avatarY, avatarW, avatarH)
    ctx.playerStatusAvatarClickHit.fill({ color: 0xffffff, alpha: 0.001 })
  }

  if (ctx.playerStatusDailySkillStar) {
    ctx.playerStatusDailySkillStar.visible = true
    ctx.playerStatusDailySkillStar.x = avatarX + avatarW - 8
    ctx.playerStatusDailySkillStar.y = avatarY + avatarH - 38
  }

  ctx.playerStatusLvText.x = avatarCenterX
  ctx.playerStatusLvText.y = getDebugCfg('shopPlayerStatusLvY')

  ctx.playerStatusExpBg.visible = true
  ctx.playerStatusExpBg.clear()
  ctx.playerStatusExpBg.roundRect(0, 0, expW, expH, 10)
  ctx.playerStatusExpBg.fill({ color: 0x1a243d, alpha: 0.9 })
  ctx.playerStatusExpBg.stroke({ color: 0x5a78aa, width: 2, alpha: 0.9 })
  ctx.playerStatusExpBg.x = expX
  ctx.playerStatusExpBg.y = expY

  ctx.playerStatusExpBar.visible = true
  ctx.playerStatusExpBar.x = expX + 2
  ctx.playerStatusExpBar.y = expY + 2
}

// ============================================================
// 玩家升级特效
// ============================================================

export function playPlayerLevelUpFx(ctx: ShopSceneCtx): void {
  if (!ctx.playerStatusAvatar || !ctx.playerStatusLvText) return
  const avatar = ctx.playerStatusAvatar
  const lvText = ctx.playerStatusLvText
  const stage = getApp().stage
  const flash = new Graphics()
  flash.eventMode = 'none'
  stage.addChild(flash)

  const baseX = avatar.x
  const baseY = avatar.y
  const baseW = avatar.width
  const baseH = avatar.height
  const avatarBounds = avatar.getBounds()
  const flashPos = stage.toLocal({ x: avatarBounds.x, y: avatarBounds.y })

  const durationMs = 280
  const startAt = Date.now()
  const tick = () => {
    const t = Math.min(1, (Date.now() - startAt) / durationMs)
    const pulse = Math.sin(Math.PI * t)
    const scale = 1 + pulse * 0.16

    const nextW = baseW * scale
    const nextH = baseH * scale
    avatar.width = nextW
    avatar.height = nextH
    avatar.x = baseX - (nextW - baseW) / 2
    avatar.y = baseY - (nextH - baseH) / 2
    lvText.scale.set(1 + pulse * 0.22)

    flash.clear()
    flash.roundRect(flashPos.x, flashPos.y, avatarBounds.width, avatarBounds.height, 18)
    flash.fill({ color: 0xffffff, alpha: pulse * 0.75 })

    if (t >= 1) {
      Ticker.shared.remove(tick)
      flash.parent?.removeChild(flash)
      flash.destroy()
      avatar.width = baseW
      avatar.height = baseH
      avatar.x = baseX
      avatar.y = baseY
      lvText.scale.set(1)
    }
  }
  Ticker.shared.add(tick)
}

// ============================================================
// 经验飞行特效（从合成触发位置飞向经验条）
// ============================================================

export function getPlayerExpCenterOnStage(ctx: ShopSceneCtx): { x: number; y: number } | null {
  if (!ctx.playerStatusExpBg) return null
  const stage = getApp().stage
  const b = ctx.playerStatusExpBg.getBounds()
  return stage.toLocal({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
}

export function playSynthesisExpFlyEffect(ctx: ShopSceneCtx, from: { x: number; y: number } | null): void {
  const to = getPlayerExpCenterOnStage(ctx)
  if (!to) return
  const startPos = from ?? { x: to.x, y: to.y - 120 }
  const stage = getApp().stage
  const orb = new Graphics()
  orb.eventMode = 'none'
  stage.addChild(orb)

  const durationMs = 420
  const startAt = Date.now()
  const tick = () => {
    const t = Math.min(1, (Date.now() - startAt) / durationMs)
    const u = 1 - t
    const x = startPos.x * u + to.x * t
    const y = startPos.y * u + to.y * t - Math.sin(Math.PI * t) * 26
    const r = 5 + Math.sin(Math.PI * t) * 2

    orb.clear()
    orb.circle(x, y, r)
    orb.fill({ color: 0x8fd8ff, alpha: 0.95 })
    orb.circle(x, y, Math.max(2, r - 2.2))
    orb.fill({ color: 0xffffff, alpha: 0.9 })

    if (t >= 1) {
      Ticker.shared.remove(tick)
      orb.parent?.removeChild(orb)
      orb.destroy()
    }
  }
  Ticker.shared.add(tick)
}
