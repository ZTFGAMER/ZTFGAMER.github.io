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

import { getConfig } from '@/tower/core/DataLoader'
import { getPlayerProgressState } from '@/tower/core/RunState'
import type { TierKey } from '@/tower/shop/ShopManager'
import { getConfig as getDebugCfg } from '@/tower/config/debugConfig'
import { Assets, Graphics, Text, Texture, Ticker } from 'pixi.js'
import { tierStarLevelIndex } from '../systems/ShopSynthesisLogic'
import { PvpContext } from '@/tower/pvp/PvpContext'
import type { ShopSceneCtx } from '../ShopSceneContext'
import { getApp } from '@/tower/core/AppContext'
import { getBattleZoneDisplayY } from '../ShopMathHelpers'

const SHOW_HERO_AVATAR_AND_LEVEL = false
const SHOW_PLAYER_LEVEL_PROGRESS = false

// ============================================================
// 品质等级辅助
// ============================================================

export function clampLevel(level: number): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 8 {
  return Math.max(1, Math.min(8, Math.round(level))) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 8
}

export function getQualityLevelRange(quality: TierKey): { min: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 8; max: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 8 } {
  const cfg = getConfig().shopRules?.qualityLevelRange?.[quality]
  const defaultMin = quality === 'Bronze' ? 1 : quality === 'Silver' ? 3 : quality === 'Gold' ? 5 : 7
  const min = clampLevel(Number(cfg?.min ?? defaultMin))
  const max = clampLevel(Number(cfg?.max ?? 8))
  return { min, max: Math.max(min, max) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 8 }
}

export function levelFromLegacyTierStar(tier: TierKey, star: 1 | 2): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 8 {
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

  ctx.playerStatusLvText.text = SHOW_PLAYER_LEVEL_PROGRESS ? `Lv${level}` : ''
  ctx.playerStatusLvText.visible = SHOW_PLAYER_LEVEL_PROGRESS && SHOW_HERO_AVATAR_AND_LEVEL

  ctx.playerStatusExpBar.clear()
  if (SHOW_PLAYER_LEVEL_PROGRESS) {
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
  if (ctx.playerStatusExpBg) ctx.playerStatusExpBg.visible = SHOW_PLAYER_LEVEL_PROGRESS
  ctx.playerStatusExpBar.visible = SHOW_PLAYER_LEVEL_PROGRESS

  if (SHOW_HERO_AVATAR_AND_LEVEL) {
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
  }

  if (ctx.playerStatusDailySkillStar) {
    ctx.playerStatusDailySkillStar.visible = SHOW_HERO_AVATAR_AND_LEVEL && !PvpContext.isActive() && deps.shouldShowHeroDailySkillReadyStar()
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
  ctx.playerStatusAvatar.visible = SHOW_HERO_AVATAR_AND_LEVEL
  if (ctx.playerStatusAvatarClickHit) {
    ctx.playerStatusAvatarClickHit.clear()
    if (SHOW_HERO_AVATAR_AND_LEVEL) {
      ctx.playerStatusAvatarClickHit.rect(avatarX, avatarY, avatarW, avatarH)
      ctx.playerStatusAvatarClickHit.fill({ color: 0xffffff, alpha: 0.001 })
      ctx.playerStatusAvatarClickHit.visible = true
      ctx.playerStatusAvatarClickHit.eventMode = 'static'
    } else {
      ctx.playerStatusAvatarClickHit.visible = false
      ctx.playerStatusAvatarClickHit.eventMode = 'none'
    }
  }

  if (ctx.playerStatusDailySkillStar) {
    ctx.playerStatusDailySkillStar.visible = SHOW_HERO_AVATAR_AND_LEVEL
    ctx.playerStatusDailySkillStar.x = avatarX + avatarW - 8
    ctx.playerStatusDailySkillStar.y = avatarY + avatarH - 38
  }

  if (ctx.itemCompendiumBtn && ctx.itemCompendiumBtn.parent === ctx.playerStatusCon) {
    ctx.itemCompendiumBtn.x = avatarCenterX + getDebugCfg('gameplayCompendiumBtnOffsetX')
    ctx.itemCompendiumBtn.y = avatarY + avatarH / 2 + getDebugCfg('gameplayCompendiumBtnOffsetY')
  }

  ctx.playerStatusLvText.x = avatarCenterX
  ctx.playerStatusLvText.y = getDebugCfg('shopPlayerStatusLvY')
  ctx.playerStatusLvText.visible = SHOW_PLAYER_LEVEL_PROGRESS && SHOW_HERO_AVATAR_AND_LEVEL

  ctx.playerStatusExpBg.visible = SHOW_PLAYER_LEVEL_PROGRESS
  ctx.playerStatusExpBg.clear()
  if (SHOW_PLAYER_LEVEL_PROGRESS) {
    ctx.playerStatusExpBg.roundRect(0, 0, expW, expH, 10)
    ctx.playerStatusExpBg.fill({ color: 0x1a243d, alpha: 0.9 })
    ctx.playerStatusExpBg.stroke({ color: 0x5a78aa, width: 2, alpha: 0.9 })
  }
  ctx.playerStatusExpBg.x = expX
  ctx.playerStatusExpBg.y = expY

  ctx.playerStatusExpBar.visible = SHOW_PLAYER_LEVEL_PROGRESS
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
  const ring = new Graphics()
  const levelUpText = new Graphics()
  const levelUpLabel = new Text({
    text: 'LEVEL UP',
    style: {
      fontSize: 18,
      fill: 0xfff3b0,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      stroke: { color: 0x4a2f00, width: 3 },
      letterSpacing: 1.5,
    },
  })
  flash.eventMode = 'none'
  ring.eventMode = 'none'
  levelUpText.eventMode = 'none'
  flash.zIndex = 520
  ring.zIndex = 521
  levelUpText.zIndex = 522
  levelUpLabel.zIndex = 523
  stage.addChild(flash)
  stage.addChild(ring)
  stage.addChild(levelUpText)
  stage.addChild(levelUpLabel)

  const baseX = avatar.x
  const baseY = avatar.y
  const baseW = avatar.width
  const baseH = avatar.height
  const lvBaseX = lvText.x
  const lvBaseY = lvText.y
  const lvBaseScaleX = lvText.scale.x
  const lvBaseScaleY = lvText.scale.y
  const lvBaseBounds = lvText.getBounds()
  const lvBaseCenterX = lvBaseBounds.x + lvBaseBounds.width / 2
  const lvBaseCenterY = lvBaseBounds.y + lvBaseBounds.height / 2
  const avatarParent = avatar.parent
  const avatarCenterGlobal = avatarParent
    ? avatarParent.toGlobal({ x: baseX + baseW / 2, y: baseY + baseH / 2 })
    : { x: baseX + baseW / 2, y: baseY + baseH / 2 }
  const avatarTopGlobal = avatarParent
    ? avatarParent.toGlobal({ x: baseX, y: baseY })
    : { x: baseX, y: baseY }
  const avatarCenterStage = stage.toLocal(avatarCenterGlobal)
  const avatarTopStage = stage.toLocal(avatarTopGlobal)
  const avatarBaseRadius = Math.max(12, Math.min(baseW, baseH) / 2)

  const durationMs = 620
  const startAt = Date.now()
  const tick = () => {
    const t = Math.min(1, (Date.now() - startAt) / durationMs)
    const pulse = Math.sin(Math.PI * t)
    const scale = 1 + pulse * 0.3

    const nextW = baseW * scale
    const nextH = baseH * scale
    avatar.width = nextW
    avatar.height = nextH
    avatar.x = baseX - (nextW - baseW) / 2
    avatar.y = baseY - (nextH - baseH) / 2
    const lvScale = 1 + pulse * 0.4
    lvText.x = lvBaseX
    lvText.y = lvBaseY
    lvText.scale.set(lvBaseScaleX * lvScale, lvBaseScaleY * lvScale)
    const lvBoundsAfter = lvText.getBounds()
    lvText.x += lvBaseCenterX - (lvBoundsAfter.x + lvBoundsAfter.width / 2)
    lvText.y += lvBaseCenterY - (lvBoundsAfter.y + lvBoundsAfter.height / 2)
    lvText.style.fill = 0xfff2a1

    const avatarRadius = avatarBaseRadius
    const avatarCenterX = avatarCenterStage.x
    const avatarCenterY = avatarCenterStage.y

    flash.clear()
    flash.circle(avatarCenterX, avatarCenterY, avatarRadius)
    flash.fill({ color: 0xfff3a3, alpha: pulse * 0.65 })
    flash.circle(avatarCenterX, avatarCenterY, avatarRadius + 3)
    flash.stroke({ color: 0xfff3b5, width: 2, alpha: pulse * 0.9 })

    const cx = avatarCenterX
    const cy = avatarCenterY
    const r = avatarBaseRadius * (1 + t * 1.1)
    ring.clear()
    ring.circle(cx, cy, r)
    ring.stroke({ color: 0xffe37a, width: Math.max(2, 8 * (1 - t)), alpha: Math.max(0, 1 - t) * 0.9 })

    const textW = baseW + 64
    const textH = 28
    const textX = cx - textW / 2
    const textY = avatarTopStage.y - 34 - (1 - t) * 10
    levelUpText.clear()
    levelUpText.roundRect(textX, textY, textW, textH, 10)
    levelUpText.fill({ color: 0x2f2244, alpha: 0.9 * Math.max(0, 1 - t * 0.8) })
    levelUpText.stroke({ color: 0xffe28f, width: 2, alpha: Math.max(0, 1 - t * 0.7) })
    levelUpLabel.x = textX + (textW - levelUpLabel.width) / 2
    levelUpLabel.y = textY + (textH - levelUpLabel.height) / 2 - 1
    levelUpLabel.alpha = Math.max(0, 1 - t * 0.75)

    if (t >= 1) {
      Ticker.shared.remove(tick)
      flash.parent?.removeChild(flash)
      ring.parent?.removeChild(ring)
      levelUpText.parent?.removeChild(levelUpText)
      levelUpLabel.parent?.removeChild(levelUpLabel)
      flash.destroy()
      ring.destroy()
      levelUpText.destroy()
      levelUpLabel.destroy()
      avatar.width = baseW
      avatar.height = baseH
      avatar.x = baseX
      avatar.y = baseY
      lvText.x = lvBaseX
      lvText.y = lvBaseY
      lvText.scale.set(lvBaseScaleX, lvBaseScaleY)
      lvText.style.fill = 0xffffff
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

function playExpReceivePulseFx(ctx: ShopSceneCtx): void {
  const stage = getApp().stage
  const expBg = ctx.playerStatusExpBg
  const expBar = ctx.playerStatusExpBar
  const avatar = ctx.playerStatusAvatar
  if (!expBg && !avatar && !expBar) return
  const flash = new Graphics()
  flash.eventMode = 'none'
  flash.zIndex = 520
  stage.addChild(flash)

  const avatarBaseBounds = avatar?.getBounds() ?? null
  const avatarParent = avatar?.parent ?? null
  const avatarCenterStage = avatar && avatarParent
    ? stage.toLocal(avatarParent.toGlobal({ x: avatar.x + avatar.width / 2, y: avatar.y + avatar.height / 2 }))
    : (avatarBaseBounds ? stage.toLocal({ x: avatarBaseBounds.x + avatarBaseBounds.width / 2, y: avatarBaseBounds.y + avatarBaseBounds.height / 2 }) : null)
  const avatarPulseRadius = avatar ? Math.max(10, Math.min(avatar.width, avatar.height) / 2 + 3) : 0

  const expBgParent = expBg?.parent ?? null
  const expBarParent = expBar?.parent ?? null
  const expW = Math.max(40, getDebugCfg('shopPlayerStatusExpBarWidth'))
  const expH = Math.max(12, getDebugCfg('shopPlayerStatusExpBarHeight'))
  const expInnerW = Math.max(8, expW - 4)
  const expInnerH = Math.max(8, expH - 4)
  const expBgStage = expBg && expBgParent
    ? stage.toLocal(expBgParent.toGlobal({ x: expBg.x, y: expBg.y }))
    : null
  const expBarStage = expBar && expBarParent
    ? stage.toLocal(expBarParent.toGlobal({ x: expBar.x, y: expBar.y }))
    : null

  const durationMs = 260
  const startAt = Date.now()
  const tick = () => {
    const t = Math.min(1, (Date.now() - startAt) / durationMs)
    const pulse = Math.sin(Math.PI * t)

    flash.clear()
    if (avatarCenterStage) {
      const center = avatarCenterStage
      const r = avatarPulseRadius
      flash.circle(center.x, center.y, r)
      flash.stroke({ color: 0x8fd8ff, width: 2, alpha: pulse * 0.9 })
      flash.circle(center.x, center.y, Math.max(6, r - 2.5))
      flash.fill({ color: 0xbde8ff, alpha: pulse * 0.22 })
    }
    if (expBgStage) {
      const p = expBgStage
      const radius = Math.max(6, expH / 2)
      flash.roundRect(p.x - 3, p.y - 3, expW + 6, expH + 6, radius)
      flash.stroke({ color: 0x8fd8ff, width: 2, alpha: pulse * 0.9 })
      flash.roundRect(p.x - 1, p.y - 1, expW + 2, expH + 2, Math.max(5, radius - 1))
      flash.fill({ color: 0xbde8ff, alpha: pulse * 0.28 })
    }
    if (expBarStage) {
      const p = expBarStage
      const radius = Math.max(4, expInnerH / 2)
      flash.roundRect(p.x - 1, p.y - 1, expInnerW + 2, expInnerH + 2, radius)
      flash.stroke({ color: 0xccecff, width: 1.5, alpha: pulse * 0.85 })
    }

    if (t >= 1) {
      Ticker.shared.remove(tick)
      flash.parent?.removeChild(flash)
      flash.destroy()
    }
  }
  Ticker.shared.add(tick)
}

export function playSynthesisExpFlyEffect(
  ctx: ShopSceneCtx,
  from: { x: number; y: number } | null,
  onArrive?: () => void,
): void {
  const to = getPlayerExpCenterOnStage(ctx)
  if (!to) {
    onArrive?.()
    return
  }
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
      playExpReceivePulseFx(ctx)
      onArrive?.()
    }
  }
  Ticker.shared.add(tick)
}
