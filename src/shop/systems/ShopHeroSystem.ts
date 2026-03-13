// ============================================================
// HeroSystem — 英雄/职业系统（函数集合模式）
// 职责：
//   - 初始职业选择面板（ensureStarterClassSelection）
//   - 被动属性徽章刷新（refreshBattlePassiveStatBadges）
//   - 新手合成引导（showStarterSynthesisGuide）
//   - 英雄被动详情弹窗（showHeroPassiveDetailPopup / toggleHeroPassiveDetailPopup）
//   - 按职业授予初始物品（grantStarterItemsByClass）
//   - 被动跳字特效（spawnPassiveJumpText）
//   - 每日英雄周期效果（grantHeroPeriodicEffectsOnNewDay / grantHeroStartDayEffectsIfNeeded）
//   - 每日金币加成（grantSilverDailyGoldBonusesOnNewDay）
//   - 周期奖励派发（checkAndPopPendingHeroPeriodicRewards / enqueueHeroPeriodicReward）
//   - 职业工具函数（isSelectedHero / getStarterClassTag / 等）
// ============================================================

import { getAllItems } from '@/core/DataLoader'
import { getPlayerProgressState, setLifeState } from '@/core/RunState'
import { normalizeSize, type ItemDef } from '@/common/items/ItemDef'
import { resolveItemTierBaseStats } from '@/common/items/ItemTierStats'
import type { TierKey } from '@/shop/ShopManager'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { getItemIconUrl } from '@/core/AssetPath'
import { createItemStatBadges } from '@/common/ui/ItemStatBadges'
import { getTierColor, getClassColor } from '@/config/colorPalette'
import { calcSkill94DailyGoldBonus } from '@/common/skills/GoldSkillRules'
import {
  Container, Graphics, Text, Sprite,
  Assets, Texture, Rectangle, Ticker,
  type FederatedPointerEvent,
} from 'pixi.js'
import {
  parseTierName,
  isNeutralItemDef,
  getItemDefById,
} from './ShopSynthesisLogic'
import type { ShopSceneCtx, StarterClass, PendingHeroPeriodicReward } from '../ShopSceneContext'
import type { NeutralChoiceCandidate } from '../panels/NeutralItemPanel'
import { clampPlayerLevel, getPlayerMaxLifeByLevel } from '../ui/PlayerStatusUI'
import { getItemInfoPanelBottomAnchorByBattle } from '../ShopMathHelpers'

// ============================================================
// 本地常量
// ============================================================

import { CANVAS_W, CANVAS_H } from '@/config/layoutConstants'
const CELL_SIZE = 128
const CELL_HEIGHT = 128
const HERO_DETAIL_POPUP_ID = '__hero_passive__'

// ============================================================
// 类型
// ============================================================

type PassiveResolvedStat = {
  damage: number
  shield: number
  heal: number
  burn: number
  poison: number
  multicast: number
  cooldownMs: number
  ammoCurrent: number
  ammoMax: number
}

type PoolCandidate = {
  item: ItemDef
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7
  tier: TierKey
  star: 1 | 2
  price: number
}

type SynthesizeResult = {
  instanceId: string
  targetZone: 'battle' | 'backpack'
  fromTier: TierKey
  fromStar: 1 | 2
  toTier: TierKey
  toStar: 1 | 2
  targetSize: ReturnType<typeof normalizeSize>
}

// ============================================================
// 职业预设数据
// ============================================================

export const HERO_STARTER_POOL: StarterClass[] = [
  'hero1', 'hero2', 'hero3', 'hero4', 'hero5',
  'hero6', 'hero7', 'hero8', 'hero9', 'hero10',
]

export const STARTER_CLASS_PRESETS: Record<StarterClass, {
  title: string
  subtitle: string
  gifts: [string, string]
  heroImage: string
}> = {
  swordsman: {
    title: '剑士',
    subtitle: '稳扎稳打，\n护盾连携持续输出。',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/warrior.png',
  },
  archer: {
    title: '弓手',
    subtitle: '管理弹药节奏，\n打出高频远程火力。',
    gifts: ['木弓', '弹药袋'],
    heroImage: '/resource/hero/archer.png',
  },
  assassin: {
    title: '刺客',
    subtitle: '低冷却连击，\n快速压制并终结对手。',
    gifts: ['匕首', '连发镖'],
    heroImage: '/resource/hero/assassin.png',
  },
  hero1: {
    title: '占卜师',
    subtitle: '不同物品合成时可以3选1（每天限1次）',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero1.png',
  },
  hero2: {
    title: '大亨',
    subtitle: '每天额外获得天数+1的金币',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero2.png',
  },
  hero3: {
    title: '魔术师',
    subtitle: '每天首次丢弃物品，获得同等级的其他物品',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero3.png',
  },
  hero4: {
    title: '戏法师',
    subtitle: '相同物品合成时可以3选1（每天限1次）',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero4.png',
  },
  hero5: {
    title: '铁匠',
    subtitle: '每隔5天获得1颗升级石（效果：随机升级1个物品）',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero5.png',
  },
  hero6: {
    title: '冒险家',
    subtitle: '每隔3天获得1张冒险券（效果：进行1次冒险）',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero6.png',
  },
  hero7: {
    title: '指挥官',
    subtitle: '每隔3天获得1枚勋章（效果：获得1个特定职业物品）',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero7.png',
  },
  hero8: {
    title: '继承者',
    subtitle: '第3天获得1个黄金宝箱（效果：获得1个黄金物品）',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero8.png',
  },
  hero9: {
    title: '大胃王',
    subtitle: '初始红心设置为40点',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero9.png',
  },
  hero10: {
    title: '大力士',
    subtitle: '战斗中最大生命值+30%',
    gifts: ['短剑', '圆盾'],
    heroImage: '/resource/hero/hero10.png',
  },
}

// ============================================================
// 内部工具：解析 available_tiers
// ============================================================

function parseAvailableTiers(raw: string): TierKey[] {
  const s = (raw || '').trim()
  if (!s) return ['Bronze', 'Silver', 'Gold', 'Diamond']
  const out = s
    .split('/')
    .map((v) => parseTierName(v.trim()))
    .filter((v): v is TierKey => !!v)
  return out.length > 0 ? out : ['Bronze', 'Silver', 'Gold', 'Diamond']
}

function tierValueFromSkillLineByStar(
  item: ReturnType<typeof getAllItems>[number],
  tier: TierKey,
  star: 1 | 2,
  line: string,
): number {
  const m = line.match(/(\d+(?:\.\d+)?(?:[\/|]\d+(?:\.\d+)?)+)/)
  if (!m?.[1]) return 0
  const parts = m[1].split(/[\/|]/).map((v) => v.trim()).filter(Boolean)
  if (parts.length === 0) return 0
  const tiers = parseAvailableTiers(item.available_tiers)
  const base = Math.max(0, tiers.indexOf(tier))
  const idx = Math.max(0, Math.min(parts.length - 1, base + (star - 1)))
  const n = Number(parts[idx])
  return Number.isFinite(n) ? n : 0
}

function ammoValueFromLineByStar(
  item: ReturnType<typeof getAllItems>[number],
  tier: TierKey,
  star: 1 | 2,
  line: string,
): number {
  const m = line.match(/弹药\s*[:：]\s*(\d+(?:[\/|]\d+)*)/)
  if (!m?.[1]) return 0
  const parts = m[1].split(/[\/|]/).map((v) => v.trim()).filter(Boolean)
  if (parts.length === 0) return 0
  const tiers = parseAvailableTiers(item.available_tiers)
  const base = Math.max(0, tiers.indexOf(tier))
  const idx = Math.max(0, Math.min(parts.length - 1, base + (star - 1)))
  const n = Number(parts[idx])
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
}

// ============================================================
// 职业查询工具
// ============================================================

export function getStarterClassTag(ctx: ShopSceneCtx): string {
  if (ctx.starterClass === 'swordsman') return '战士'
  if (ctx.starterClass === 'archer') return '弓手'
  if (ctx.starterClass === 'assassin') return '刺客'
  return ''
}

export function isSelectedHero(ctx: ShopSceneCtx, id: StarterClass): boolean {
  return ctx.starterClass === id
}

export function getHeroIconByStarterClass(ctx: ShopSceneCtx): string {
  if (ctx.starterClass === 'hero1') return '/resource/hero/hero1icon.png'
  if (ctx.starterClass === 'hero2') return '/resource/hero/hero2icon.png'
  if (ctx.starterClass === 'hero3') return '/resource/hero/hero3icon.png'
  if (ctx.starterClass === 'hero4') return '/resource/hero/hero4icon.png'
  if (ctx.starterClass === 'hero5') return '/resource/hero/hero5icon.png'
  if (ctx.starterClass === 'hero6') return '/resource/hero/hero6icon.png'
  if (ctx.starterClass === 'hero7') return '/resource/hero/hero7icon.png'
  if (ctx.starterClass === 'hero8') return '/resource/hero/hero8icon.png'
  if (ctx.starterClass === 'hero9') return '/resource/hero/hero9icon.png'
  if (ctx.starterClass === 'hero10') return '/resource/hero/hero10icon.png'
  if (ctx.starterClass === 'archer') return '/resource/hero/archericon.png'
  if (ctx.starterClass === 'assassin') return '/resource/hero/assassinicon.png'
  return '/resource/hero/warrioricon.png'
}

export function isStarterClassItem(ctx: ShopSceneCtx, item: ItemDef): boolean {
  const tag = getStarterClassTag(ctx)
  if (!tag) return true
  return `${item.tags ?? ''}`.includes(tag)
}

export function isFirstPurchaseLockedToStarterClass(): boolean {
  return false
}

export function canBuyItemUnderFirstPurchaseRule(ctx: ShopSceneCtx, item: ItemDef): boolean {
  if (!isFirstPurchaseLockedToStarterClass()) return true
  return isStarterClassItem(ctx, item)
}

// ============================================================
// 英雄每日触发状态
// ============================================================

export function canUseHeroDailyCardReroll(ctx: ShopSceneCtx): boolean {
  return isSelectedHero(ctx, 'hero1') && !ctx.heroDailyCardRerollUsedDays.has(ctx.currentDay)
}

export function markHeroDailyCardRerollUsed(
  ctx: ShopSceneCtx,
  callbacks: { refreshPlayerStatusUI: () => void },
): void {
  if (isSelectedHero(ctx, 'hero1')) {
    ctx.heroDailyCardRerollUsedDays.add(ctx.currentDay)
    callbacks.refreshPlayerStatusUI()
  }
}

export function canTriggerHeroFirstDiscardReward(ctx: ShopSceneCtx): boolean {
  return isSelectedHero(ctx, 'hero3') && !ctx.heroFirstDiscardRewardedDays.has(ctx.currentDay)
}

export function markHeroFirstDiscardRewardTriggered(
  ctx: ShopSceneCtx,
  callbacks: { refreshPlayerStatusUI: () => void },
): void {
  if (isSelectedHero(ctx, 'hero3')) {
    ctx.heroFirstDiscardRewardedDays.add(ctx.currentDay)
    callbacks.refreshPlayerStatusUI()
  }
}

export function canTriggerHeroSameItemSynthesisChoice(ctx: ShopSceneCtx): boolean {
  return isSelectedHero(ctx, 'hero4') && !ctx.heroFirstSameItemSynthesisChoiceDays.has(ctx.currentDay)
}

export function markHeroSameItemSynthesisChoiceTriggered(
  ctx: ShopSceneCtx,
  callbacks: { refreshPlayerStatusUI: () => void },
): void {
  if (isSelectedHero(ctx, 'hero4')) {
    ctx.heroFirstSameItemSynthesisChoiceDays.add(ctx.currentDay)
    callbacks.refreshPlayerStatusUI()
  }
}

export function shouldShowHeroDailySkillReadyStar(ctx: ShopSceneCtx): boolean {
  if (
    ctx.pendingHeroPeriodicRewards.length > 0
    && (
      isSelectedHero(ctx, 'hero5')
      || isSelectedHero(ctx, 'hero6')
      || isSelectedHero(ctx, 'hero7')
      || isSelectedHero(ctx, 'hero8')
    )
  ) {
    return true
  }
  if (isSelectedHero(ctx, 'hero1')) return canUseHeroDailyCardReroll(ctx)
  if (isSelectedHero(ctx, 'hero3')) return canTriggerHeroFirstDiscardReward(ctx)
  if (isSelectedHero(ctx, 'hero4')) return canTriggerHeroSameItemSynthesisChoice(ctx)
  return false
}

// ============================================================
// 英雄特效 - 丢弃奖励
// ============================================================

export function grantHeroDiscardSameLevelReward(
  ctx: ShopSceneCtx,
  discardedDefId: string,
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7,
  callbacks: {
    collectPoolCandidatesByLevel: (level: 1 | 2 | 3 | 4 | 5 | 6 | 7) => PoolCandidate[]
    grantPoolCandidateToBoardOrBackpack: (
      candidate: PoolCandidate,
      source: string,
      opts?: { flyFromHeroAvatar?: boolean },
    ) => boolean
    refreshPlayerStatusUI: () => void
  },
): void {
  if (!canTriggerHeroFirstDiscardReward(ctx)) return
  const discardedDef = getItemDefById(discardedDefId)
  if (!discardedDef || isNeutralItemDef(discardedDef)) return
  const candidates = callbacks.collectPoolCandidatesByLevel(level).filter((one) => one.item.id !== discardedDefId)
  if (candidates.length <= 0) return
  const picked = candidates[Math.floor(Math.random() * candidates.length)]
  if (!picked) return
  if (callbacks.grantPoolCandidateToBoardOrBackpack(picked, '魔术师', { flyFromHeroAvatar: true })) {
    markHeroFirstDiscardRewardTriggered(ctx, { refreshPlayerStatusUI: callbacks.refreshPlayerStatusUI })
  }
}

// ============================================================
// 英雄特效 - 跨物品合成改写
// ============================================================

export function tryRunHeroCrossSynthesisReroll(
  ctx: ShopSceneCtx,
  stage: Container,
  synth: SynthesizeResult,
  callbacks: {
    collectPoolCandidatesByLevel: (level: 1 | 2 | 3 | 4 | 5 | 6 | 7) => PoolCandidate[]
    showNeutralChoiceOverlay: (
      stage: Container,
      title: string,
      candidates: NeutralChoiceCandidate[],
      onConfirm?: (c: NeutralChoiceCandidate) => boolean,
      mode?: 'default' | 'special_shop_like',
    ) => boolean
    isLevelQuickDraftEnabled: () => boolean
    enqueueLevelQuickDraftChoices: (
      title: string,
      choices: NeutralChoiceCandidate[],
      opts?: {
        consumePickedAsReward?: boolean
        onPicked?: (picked: NeutralChoiceCandidate) => void
      },
    ) => boolean
    removePlacedItemInstance: (instanceId: string, zone: 'battle' | 'backpack') => boolean
    transformPlacedItemKeepLevelTo: (
      instanceId: string,
      zone: 'battle' | 'backpack',
      item: ItemDef,
      keepLevel: boolean,
    ) => boolean
    setInstanceQualityLevel: (instanceId: string, defId: string, quality?: TierKey, level?: number) => void
    applyInstanceTierVisuals: () => void
    syncShopOwnedTierRules: () => void
    refreshUpgradeHints: () => void
    showHintToast: (reason: string, message: string, color?: number) => void
    refreshShopUI: () => void
    refreshPlayerStatusUI: () => void
    tierStarLevelIndex: (tier: TierKey, star: 1 | 2) => number
    pickRandomElements: <T>(list: T[], count: number) => T[]
  },
): boolean {
  if (!canUseHeroDailyCardReroll(ctx)) return false
  const system = synth.targetZone === 'battle' ? ctx.battleSystem : ctx.backpackSystem
  const current = system?.getItem(synth.instanceId)
  if (!current) return false
  const targetLevel = Math.max(1, Math.min(7, callbacks.tierStarLevelIndex(synth.toTier, synth.toStar) + 1)) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  const currentDefId = current.defId
  const currentDef = getItemDefById(currentDefId)
  if (!currentDef) return false
  const targetSize = synth.targetSize
  const pool = callbacks.collectPoolCandidatesByLevel(targetLevel)
    .filter((one) => normalizeSize(one.item.size) === targetSize && one.item.id !== currentDefId)
  const altPicks = callbacks.pickRandomElements(pool, 2)
  if (altPicks.length < 2) return false
  const choices: NeutralChoiceCandidate[] = [
    { item: currentDef, tier: synth.toTier, star: synth.toStar },
    ...altPicks.map((one) => ({ item: one.item, tier: one.tier, star: one.star })),
  ]

  if (callbacks.isLevelQuickDraftEnabled()) {
    const queued = callbacks.enqueueLevelQuickDraftChoices('占卜师：选择合成结果', choices, {
      consumePickedAsReward: true,
    })
    if (queued) {
      markHeroDailyCardRerollUsed(ctx, { refreshPlayerStatusUI: callbacks.refreshPlayerStatusUI })
      callbacks.removePlacedItemInstance(synth.instanceId, synth.targetZone)
      callbacks.showHintToast('no_gold_buy', '占卜师：本次异物合成可选结果', 0x9be5ff)
      callbacks.refreshShopUI()
      return true
    }
  }

  return callbacks.showNeutralChoiceOverlay(stage, '占卜师：选择合成结果', choices, (picked) => {
    if (picked.item.id !== currentDefId) {
      const ok = callbacks.transformPlacedItemKeepLevelTo(synth.instanceId, synth.targetZone, picked.item, true)
      if (!ok) {
        callbacks.showHintToast('backpack_full_buy', '占卜师：转化失败', 0xff8f8f)
        return false
      }
      callbacks.setInstanceQualityLevel(synth.instanceId, picked.item.id, parseTierName(picked.item.starting_tier) ?? 'Bronze', targetLevel)
      callbacks.applyInstanceTierVisuals()
      callbacks.syncShopOwnedTierRules()
      callbacks.refreshUpgradeHints()
    }
    markHeroDailyCardRerollUsed(ctx, { refreshPlayerStatusUI: callbacks.refreshPlayerStatusUI })
    callbacks.showHintToast('no_gold_buy', '占卜师：本次异物合成可选结果', 0x9be5ff)
    callbacks.refreshShopUI()
    return true
  }, 'special_shop_like')
}

// ============================================================
// 英雄图标 & 被动数据
// ============================================================

export function getHeroPassiveDetailData(ctx: ShopSceneCtx): { name: string; desc: string; icon: string } {
  if (!ctx.starterClass) {
    return {
      name: '未选择英雄',
      desc: '暂无技能效果',
      icon: '/resource/hero/warrioricon.png',
    }
  }
  const preset = STARTER_CLASS_PRESETS[ctx.starterClass]
  if (!preset) {
    return {
      name: '未选择英雄',
      desc: '暂无技能效果',
      icon: '/resource/hero/warrioricon.png',
    }
  }
  return {
    name: preset.title,
    desc: (preset.subtitle || '暂无技能效果').trim(),
    icon: getHeroIconByStarterClass(ctx),
  }
}

export function showHeroPassiveDetailPopup(ctx: ShopSceneCtx, stage: Container): void {
  if (!ctx.skillDetailPopupCon) {
    const con = new Container()
    con.zIndex = 220
    con.eventMode = 'none'
    con.visible = false
    stage.addChild(con)
    ctx.skillDetailPopupCon = con
  }
  const con = ctx.skillDetailPopupCon
  con.removeChildren().forEach((c) => c.destroy({ children: true }))

  const detail = getHeroPassiveDetailData(ctx)
  const panelW = Math.max(360, Math.min(CANVAS_W - 24, getDebugCfg('itemInfoWidth')))
  const pad = 16
  const iconSize = 128
  const iconX = pad
  const iconY = pad
  const textX = iconX + iconSize + 16
  const textW = panelW - textX - pad
  const titleFontSize = getDebugCfg('itemInfoNameFontSize')
  const descFontSize = getDebugCfg('itemInfoSimpleDescFontSize')

  const title = new Text({
    text: (() => {
      const progress = getPlayerProgressState()
      const level = clampPlayerLevel(progress.level)
      let battleHp = getPlayerMaxLifeByLevel(level)
      if (isSelectedHero(ctx, 'hero10')) battleHp = Math.max(1, Math.round(battleHp * 1.3))
      return `${detail.name}  Lv${level}  生命${battleHp}`
    })(),
    style: { fontSize: titleFontSize, fill: 0xffefc8, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  const desc = new Text({
    text: detail.desc,
    style: {
      fontSize: descFontSize,
      fill: 0xd7e2fa,
      fontFamily: 'Arial',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: textW,
      lineHeight: Math.round(descFontSize * 1.25),
    },
  })

  const dividerY = iconY + 44
  const descY = dividerY + 12
  const contentBottom = Math.max(iconY + iconSize, descY + desc.height)
  const panelH = Math.max(getDebugCfg('itemInfoMinHSmall'), contentBottom + pad)
  const px = CANVAS_W / 2 - panelW / 2
  let panelBottomY = getItemInfoPanelBottomAnchorByBattle(ctx)
  if (ctx.skillIconBarCon?.visible) {
    panelBottomY = Math.min(panelBottomY, ctx.skillIconBarCon.y - 44)
  }
  const py = panelBottomY - panelH

  const bg = new Graphics()
  bg.roundRect(px, py, panelW, panelH, Math.max(0, getDebugCfg('gridItemCornerRadius')))
  bg.fill({ color: 0x1e1e30, alpha: 0.97 })
  bg.stroke({ color: 0x5566aa, width: 2, alpha: 1 })
  con.addChild(bg)

  const iconLetter = new Text({
    text: detail.name.slice(0, 1),
    style: { fontSize: 56, fill: 0xf5f7ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  iconLetter.anchor.set(0.5)
  iconLetter.x = px + iconX + iconSize / 2
  iconLetter.y = py + iconY + iconSize / 2 + 2
  con.addChild(iconLetter)

  const iconSprite = new Sprite(Texture.WHITE)
  iconSprite.x = px + iconX
  iconSprite.y = py + iconY
  iconSprite.width = iconSize
  iconSprite.height = iconSize
  iconSprite.alpha = 0
  con.addChild(iconSprite)
  const iconUrl = detail.icon
  void Assets.load<Texture>(iconUrl).then((tex) => {
    if (!ctx.skillDetailPopupCon || ctx.skillDetailSkillId !== HERO_DETAIL_POPUP_ID || iconSprite.destroyed) return
    iconSprite.texture = tex
    iconSprite.alpha = 1
    iconLetter.visible = false
  }).catch(() => {
    // ignore runtime missing icon
  })

  title.x = px + textX
  title.y = py + iconY + 2
  con.addChild(title)

  const divider = new Graphics()
  divider.moveTo(px + textX, py + dividerY)
  divider.lineTo(px + panelW - pad, py + dividerY)
  divider.stroke({ color: 0x5a628f, width: 1, alpha: 0.9 })
  con.addChild(divider)

  desc.x = px + textX
  desc.y = py + descY
  con.addChild(desc)

  ctx.skillDetailSkillId = HERO_DETAIL_POPUP_ID
  con.visible = true
}

export function toggleHeroPassiveDetailPopup(
  ctx: ShopSceneCtx,
  stage: Container,
  callbacks: {
    hideSkillDetailPopup: () => void
    resetInfoModeSelection: () => void
    applySellButtonState: () => void
  },
): void {
  if (ctx.skillDetailSkillId === HERO_DETAIL_POPUP_ID) {
    callbacks.hideSkillDetailPopup()
    return
  }
  ctx.currentSelection = { kind: 'none' }
  ctx.selectedSellAction = null
  callbacks.resetInfoModeSelection()
  ctx.shopPanel?.setSelectedSlot(-1)
  ctx.battleView?.setSelected(null)
  ctx.backpackView?.setSelected(null)
  ctx.sellPopup?.hide()
  callbacks.applySellButtonState()
  showHeroPassiveDetailPopup(ctx, stage)
}

// ============================================================
// 被动跳字特效
// ============================================================

export function spawnPassiveJumpText(
  ctx: ShopSceneCtx,
  instanceId: string,
  text: string,
  color: number,
  offsetRow = 0,
): void {
  if (!ctx.battleView || !ctx.passiveJumpLayer) return
  const node = ctx.battleView.getNode(instanceId)
  if (!node) return
  const w = node.size === '1x1' ? CELL_SIZE : node.size === '2x1' ? CELL_SIZE * 2 : CELL_SIZE * 3
  const x = node.container.x + w / 2
  const y = node.container.y + CELL_HEIGHT * 0.3 + 40 - offsetRow * 24
  const label = new Text({
    text,
    style: {
      fontSize: Math.max(8, getDebugCfg('shopPassiveJumpFontSize')),
      fontFamily: 'Arial',
      fontWeight: 'bold',
      fill: color,
      stroke: { color: 0x101018, width: 4 },
    },
  })
  label.anchor.set(0.5, 0.5)
  label.x = x
  label.y = y
  ctx.passiveJumpLayer.addChild(label)

  const start = Date.now()
  const moveMs = Math.max(0, getDebugCfg('shopPassiveJumpMoveMs'))
  const holdMs = Math.max(0, getDebugCfg('shopPassiveJumpHoldMs'))
  const fadeMs = Math.max(0, getDebugCfg('shopPassiveJumpFadeMs'))
  const risePx = 42
  const total = Math.max(1, moveMs + holdMs + fadeMs)
  const tick = () => {
    const elapsed = Date.now() - start
    if (elapsed <= moveMs) {
      const p = moveMs <= 0 ? 1 : Math.min(1, elapsed / moveMs)
      const eased = 1 - Math.pow(1 - p, 3)
      label.y = y - eased * risePx
      label.alpha = 1
    } else if (elapsed <= moveMs + holdMs) {
      label.y = y - risePx
      label.alpha = 1
    } else {
      const t = elapsed - moveMs - holdMs
      const p = fadeMs <= 0 ? 1 : Math.min(1, t / fadeMs)
      label.y = y - risePx
      label.alpha = 1 - p
    }
    if (elapsed >= total) {
      Ticker.shared.remove(tick)
      label.parent?.removeChild(label)
      label.destroy()
    }
  }
  Ticker.shared.add(tick)
}

// ============================================================
// 被动属性徽章刷新
// ============================================================

export function refreshBattlePassiveStatBadges(
  ctx: ShopSceneCtx,
  showJump = true,
  callbacks: {
    getInstanceTier: (instanceId: string) => TierKey | undefined
    getInstanceTierStar: (instanceId: string) => 1 | 2
    getInstancePermanentDamageBonus: (instanceId: string) => number
    setZoneItemAmmo: (instanceId: string, current: number, max: number) => void
  },
): void {
  if (!ctx.battleSystem || !ctx.battleView) return
  const allItems = getAllItems()
  const byId = new Map(allItems.map((it) => [it.id, it] as const))
  const placed = ctx.battleSystem.getAllItems()
  const next = new Map<string, PassiveResolvedStat>()

  for (const it of placed) {
    const def = byId.get(it.defId)
    if (!def) continue
    const tier = callbacks.getInstanceTier(it.instanceId) ?? 'Bronze'
    const star = callbacks.getInstanceTierStar(it.instanceId)
    const stats = resolveItemTierBaseStats(def, `${tier}#${star}`)
    const permanent = Math.max(0, Math.round(callbacks.getInstancePermanentDamageBonus(it.instanceId)))
    const ammoLine = (def.skills ?? []).map((s) => s.cn ?? '').find((s) => /弹药\s*[:：]\s*\d+/.test(s))
    const ammoMax = ammoLine ? ammoValueFromLineByStar(def, tier, star, ammoLine) : 0
    next.set(it.instanceId, {
      damage: Math.max(0, Math.round(stats.damage + permanent)),
      shield: Math.max(0, Math.round(stats.shield)),
      heal: Math.max(0, Math.round(stats.heal)),
      burn: Math.max(0, Math.round(stats.burn)),
      poison: Math.max(0, Math.round(stats.poison)),
      multicast: Math.max(1, Math.round(stats.multicast)),
      cooldownMs: Math.max(0, Math.round(stats.cooldownMs)),
      ammoCurrent: ammoMax,
      ammoMax,
    })
  }

  const baseBeforePassive = new Map<string, PassiveResolvedStat>()
  for (const [id, st] of next) baseBeforePassive.set(id, { ...st })

  const isWeapon = (id: string): boolean => (next.get(id)?.damage ?? 0) > 0
  const isShield = (id: string): boolean => (next.get(id)?.shield ?? 0) > 0
  const isDamageBonusEligible = (id: string): boolean => isWeapon(id) && !isShield(id)

  for (const owner of placed) {
    const def = byId.get(owner.defId)
    if (!def) continue
    const tier = callbacks.getInstanceTier(owner.instanceId) ?? 'Bronze'
    const star = callbacks.getInstanceTierStar(owner.instanceId)
    const lines = (def.skills ?? []).map((s) => s.cn ?? '')
    const adjacentIds = ctx.battleSystem.getAdjacentItems(owner.instanceId)

    const shortSwordLine = lines.find((s) => /相邻的护盾物品护盾\+\d+(?:\/\d+)*/.test(s))
    if (shortSwordLine) {
      const v = Math.round(tierValueFromSkillLineByStar(def, tier, star, shortSwordLine))
      if (v > 0) {
        for (const aid of adjacentIds) {
          if (!isShield(aid)) continue
          const st = next.get(aid)
          if (!st) continue
          st.shield += v
        }
      }
    }

    const roundShieldLine = lines.find((s) => /相邻的?武器伤害\+\d+(?:\/\d+)*/.test(s))
    if (roundShieldLine) {
      const v = Math.round(tierValueFromSkillLineByStar(def, tier, star, roundShieldLine))
      if (v > 0) {
        for (const aid of adjacentIds) {
          if (!isDamageBonusEligible(aid)) continue
          const st = next.get(aid)
          if (!st) continue
          st.damage += v
        }
      }
    }

    const boomerangLine = lines.find(
      (s) => /武器伤害\+\d+(?:\/\d+)*/.test(s)
        && !/相邻/.test(s)
        && !/其他武器攻击时该(?:武器|物品)伤害\+/.test(s),
    )
    if (boomerangLine) {
      const v = Math.round(tierValueFromSkillLineByStar(def, tier, star, boomerangLine))
      if (v > 0) {
        for (const st of next.values()) {
          if (st.damage <= 0 || st.shield > 0) continue
          st.damage += v
        }
      }
    }

    const adjacentAmmoCapLine = lines.find((s) => /相邻物品\+\d+(?:\/\d+)*最大弹药量/.test(s))
    if (adjacentAmmoCapLine) {
      const v = Math.round(tierValueFromSkillLineByStar(def, tier, star, adjacentAmmoCapLine))
      if (v > 0) {
        for (const aid of adjacentIds) {
          const st = next.get(aid)
          if (!st || st.ammoMax <= 0) continue
          st.ammoMax += v
          st.ammoCurrent = Math.min(st.ammoMax, st.ammoCurrent + v)
        }
      }
    }
  }

  for (const it of placed) {
    const st = next.get(it.instanceId)
    if (!st) {
      ctx.battleView.setItemStatOverride(it.instanceId, null)
      callbacks.setZoneItemAmmo(it.instanceId, 0, 0)
      continue
    }
    ctx.battleView.setItemStatOverride(it.instanceId, {
      damage: st.damage,
      shield: st.shield,
      heal: st.heal,
      burn: st.burn,
      poison: st.poison,
      multicast: st.multicast,
    })
    callbacks.setZoneItemAmmo(it.instanceId, st.ammoCurrent, st.ammoMax)

    const prev = ctx.battlePassivePrevStats.get(it.instanceId) ?? baseBeforePassive.get(it.instanceId)
    if (showJump && prev) {
      const deltas: Array<{ text: string; color: number }> = []
      const dDmg = st.damage - prev.damage
      const dShield = st.shield - prev.shield
      if (dDmg !== 0) deltas.push({ text: `⚔ ${dDmg > 0 ? '+' : ''}${dDmg}`, color: dDmg > 0 ? 0xff7b7b : 0xbfc7f5 })
      if (dShield !== 0) deltas.push({ text: `🛡 ${dShield > 0 ? '+' : ''}${dShield}`, color: dShield > 0 ? 0xffd86b : 0xbfc7f5 })
      for (let i = 0; i < deltas.length; i++) {
        const d = deltas[i]!
        spawnPassiveJumpText(ctx, it.instanceId, d.text, d.color, i)
      }
    }
    ctx.battlePassivePrevStats.set(it.instanceId, { ...st })
  }

  for (const id of Array.from(ctx.battlePassivePrevStats.keys())) {
    if (!next.has(id)) ctx.battlePassivePrevStats.delete(id)
  }
  for (const id of Array.from(ctx.battlePassiveResolvedStats.keys())) {
    if (!next.has(id)) callbacks.setZoneItemAmmo(id, 0, 0)
  }
  ctx.battlePassiveResolvedStats.clear()
  for (const [id, st] of next) ctx.battlePassiveResolvedStats.set(id, st)
}

// ============================================================
// 解锁池初始化
// ============================================================

export function seedInitialUnlockPoolByStarterClass(
  ctx: ShopSceneCtx,
  _pick: StarterClass,
  callbacks: {
    resetSkill15NextBuyDiscountState: () => void
    resetSkill30BundleState: () => void
    syncUnlockPoolToManager: () => void
  },
): void {
  ctx.unlockedItemIds.clear()
  ctx.neutralObtainedCountByKind.clear()
  ctx.neutralRandomCategoryPool = []
  ctx.neutralDailyRollCountByDay.clear()
  ctx.levelRewardCategoryPool = []
  ctx.pendingLevelRewards = []
  ctx.pendingHeroPeriodicRewards = []
  ctx.pendingHeroPeriodicRewardDispatching = false
  ctx.levelRewardObtainedByKind.clear()
  callbacks.resetSkill15NextBuyDiscountState()
  callbacks.resetSkill30BundleState()
  ctx.quickBuyNoSynthRefreshStreak = 0
  ctx.quickBuyNeutralMissStreak = 0
  ctx.nextQuickBuyOffer = null
  ctx.heroDailyCardRerollUsedDays.clear()
  ctx.heroFirstDiscardRewardedDays.clear()
  ctx.heroFirstSameItemSynthesisChoiceDays.clear()
  ctx.heroSmithStoneGrantedDays.clear()
  ctx.heroAdventurerScrollGrantedDays.clear()
  ctx.heroCommanderMedalGrantedDays.clear()
  ctx.heroHeirGoldEquipGrantedDays.clear()
  ctx.heroTycoonGoldGrantedDays.clear()
  // 按当前规则：开局解锁"所有青铜物品"，不再仅限所选职业
  const bronzeIds = getAllItems()
    .filter((it) => (parseTierName(it.starting_tier) ?? 'Bronze') === 'Bronze')
    .map((it) => it.id)
  for (const id of bronzeIds) ctx.unlockedItemIds.add(id)
  callbacks.syncUnlockPoolToManager()
}

// ============================================================
// 授予初始物品
// ============================================================

export function grantStarterItemsByClass(
  ctx: ShopSceneCtx,
  pick: StarterClass,
  callbacks: {
    getItemDefByCn: (nameCn: string) => ItemDef | null
    findFirstBattlePlace: (size: ReturnType<typeof normalizeSize>) => { col: number; row: number } | null
    findFirstBackpackPlace: (size: ReturnType<typeof normalizeSize>) => { col: number; row: number } | null
    nextId: () => string
    toVisualTier: (tier?: TierKey, star?: 1 | 2) => string | undefined
    setInstanceQualityLevel: (instanceId: string, defId: string, quality?: TierKey, level?: number) => void
    levelFromLegacyTierStar: (tier: TierKey, star: 1 | 2) => 1 | 2 | 3 | 4 | 5 | 6 | 7
    recordNeutralItemObtained: (defId: string) => void
    syncUnlockPoolToManager: () => void
    instanceToDefIdSet: (id: string, defId: string) => void
    instanceToPermanentDamageBonusSet: (id: string, value: number) => void
  },
): void {
  if (!ctx.battleSystem || !ctx.battleView || !ctx.backpackSystem || !ctx.backpackView) return
  const preset = STARTER_CLASS_PRESETS[pick]
  if (!preset) return

  const grantAllByClass = getDebugCfg('gameplayGrantAllClassItems') >= 0.5
  const classTag = pick === 'swordsman' ? '战士' : pick === 'archer' ? '弓手' : '刺客'
  const grantList: Array<{ item: ItemDef; tier: TierKey; star: 1 | 2 }> = grantAllByClass
    ? getAllItems()
      .filter((it) => String(it.tags || '').includes(classTag))
      .map((it) => ({
        item: it,
        tier: parseTierName(it.starting_tier) ?? 'Bronze' as TierKey,
        star: 1 as const,
      }))
    : preset.gifts
      .map((nameCn) => callbacks.getItemDefByCn(nameCn))
      .filter((it): it is ItemDef => !!it)
      .map((it) => ({ item: it, tier: 'Bronze' as TierKey, star: 1 as const }))

  for (const grant of grantList) {
    const item = grant.item
    if (!item) continue
    const size = normalizeSize(item.size)
    const battleSlot = callbacks.findFirstBattlePlace(size)
    const backpackSlot = battleSlot ? null : callbacks.findFirstBackpackPlace(size)
    if (!battleSlot && !backpackSlot) continue

    const id = callbacks.nextId()
    const visualTier = callbacks.toVisualTier(grant.tier, grant.star)
    if (battleSlot) {
      ctx.battleSystem.place(battleSlot.col, battleSlot.row, size, item.id, id)
      void ctx.battleView.addItem(id, item.id, size, battleSlot.col, battleSlot.row, visualTier).then(() => {
        ctx.battleView!.setItemTier(id, visualTier)
        ctx.drag?.refreshZone(ctx.battleView!)
      })
    } else if (backpackSlot) {
      ctx.backpackSystem.place(backpackSlot.col, backpackSlot.row, size, item.id, id)
      void ctx.backpackView.addItem(id, item.id, size, backpackSlot.col, backpackSlot.row, visualTier).then(() => {
        ctx.backpackView!.setItemTier(id, visualTier)
        ctx.drag?.refreshZone(ctx.backpackView!)
      })
    }

    callbacks.instanceToDefIdSet(id, item.id)
    callbacks.setInstanceQualityLevel(
      id, item.id,
      parseTierName(item.starting_tier) ?? 'Bronze',
      callbacks.levelFromLegacyTierStar(grant.tier, grant.star),
    )
    callbacks.instanceToPermanentDamageBonusSet(id, 0)
    callbacks.recordNeutralItemObtained(item.id)
    ctx.unlockedItemIds.add(item.id)
  }
  callbacks.syncUnlockPoolToManager()
}

// ============================================================
// 新手合成引导辅助
// ============================================================

function pickGuideOtherArchetypeResultItem(
  pick: StarterClass,
  getItemDefByCn: (nameCn: string) => ItemDef | null,
): ItemDef | null {
  const targetTagByPick: Partial<Record<StarterClass, string>> = {
    swordsman: '弓手',
    archer: '刺客',
    assassin: '战士',
  }
  const preferredByPick: Partial<Record<StarterClass, string[]>> = {
    swordsman: ['木弓'],
    archer: ['匕首', '刺客匕首'],
    assassin: ['短剑'],
  }
  for (const nameCn of (preferredByPick[pick] ?? [])) {
    const hit = getItemDefByCn(nameCn)
    if (hit && parseTierName(hit.starting_tier) === 'Bronze') return hit
  }
  const targetTag = targetTagByPick[pick] ?? '战士'
  return getAllItems().find((it) => `${it.tags ?? ''}`.includes(targetTag) && parseTierName(it.starting_tier) === 'Bronze')
    ?? getAllItems().find((it) => `${it.tags ?? ''}`.includes(targetTag))
    ?? null
}

function pickGuideSameArchetypeResultItem(_pick: StarterClass, sourceItem: ItemDef): ItemDef | null {
  void _pick
  return sourceItem
}

function getGuideArchetypeBadge(item: ItemDef): { text: string; color: number } {
  const tags = `${item.tags ?? ''}`
  if (tags.includes('战')) return { text: '战', color: 0xc74444 }
  if (tags.includes('弓')) return { text: '弓', color: 0x4d9e52 }
  if (tags.includes('刺')) return { text: '刺', color: 0x3f73bf }
  return { text: '通', color: 0x7b6ad2 }
}

export function getGuideFrameTierByLevel(levelText: string): 'Bronze' | 'Silver' | 'Gold' | 'Diamond' {
  const levelNum = Math.max(1, Math.round(Number(levelText) || 1))
  if (levelNum >= 7) return 'Diamond'
  if (levelNum >= 5) return 'Gold'
  if (levelNum >= 3) return 'Silver'
  return 'Bronze'
}

export function createGuideItemCard(item: ItemDef, levelText: string, tierForFrame: 'Bronze' | 'Silver' | 'Gold' | 'Diamond' = 'Bronze'): Container {
  const con = new Container()
  const scale = 0.72
  const cardW = CELL_SIZE
  const cardH = CELL_HEIGHT
  const cornerRadius = Math.max(0, Math.round(getDebugCfg('gridItemCornerRadius')))
  const guideStrokePx = 8
  const borderW = Math.max(2, Math.round(guideStrokePx / scale))
  const frameInset = Math.max(3, 2 + Math.ceil(borderW / 2))
  const frameW = Math.max(1, cardW - frameInset * 2)
  const frameH = Math.max(1, cardH - frameInset * 2)
  const frameRadius = Math.max(0, cornerRadius - (frameInset - 3))
  const spriteInset = frameInset + Math.max(2, Math.ceil(borderW / 2))

  const levelNum = Math.max(1, Math.round(Number(levelText) || 1))
  const useArchetypeFrame = getDebugCfg('gameplayItemFrameColorByArchetype') >= 0.5
  const tierColor = useArchetypeFrame
    ? (() => {
      const tags = String(item.tags ?? '')
      if (tags.includes('战') || /warrior/i.test(tags)) return getClassColor('战士')
      if (tags.includes('弓') || /archer/i.test(tags)) return getClassColor('弓手')
      if (tags.includes('刺') || /assassin/i.test(tags)) return getClassColor('刺客')
      return getClassColor('中立')
    })()
    : getTierColor(tierForFrame)

  const frame = new Graphics()
  frame.roundRect(frameInset, frameInset, frameW, frameH, frameRadius)
  frame.fill({ color: 0x000000, alpha: 0.001 })
  frame.stroke({ color: tierColor, width: borderW, alpha: 0.98 })
  con.addChild(frame)

  const icon = new Sprite(Texture.WHITE)
  const baseCellInner = Math.max(1, CELL_SIZE - spriteInset * 2)
  const spriteSide = Math.max(1, Math.min(frameW, baseCellInner))
  icon.width = spriteSide
  icon.height = spriteSide
  icon.x = frameInset + (frameW - spriteSide) / 2
  icon.y = frameInset + (frameH - spriteSide) / 2
  icon.alpha = 0
  con.addChild(icon)
  const url = getItemIconUrl(item.id)
  void Assets.load<Texture>(url).then((tex) => {
    const sw = Math.max(1, tex.width)
    const sh = Math.max(1, tex.height)
    const side = spriteSide
    const sc = Math.min(side / sw, side / sh)
    icon.texture = tex
    icon.width = Math.max(1, Math.round(sw * sc))
    icon.height = Math.max(1, Math.round(sh * sc))
    icon.x = frameInset + (frameW - icon.width) / 2
    icon.y = frameInset + (frameH - icon.height) / 2
    icon.alpha = 1
  }).catch(() => {
    // ignore missing icon in runtime
  })

  const archetype = getGuideArchetypeBadge(item)
  const badges = createItemStatBadges(
    item,
    getDebugCfg('itemStatBadgeFontSize'),
    Math.max(44, cardW - 8),
    undefined,
    'archetype',
    { archetypeSuffix: String(Math.min(7, Math.max(1, levelNum))) },
  )
  badges.x = cardW / 2
  badges.y = getDebugCfg('itemStatBadgeOffsetY') + 14
  // 兜底：若被配置隐藏，则强制给出一枚同风格角标
  if (badges.children.length === 0) {
    const fallback = new Graphics()
    fallback.roundRect(4, 4, 48, 34, 8)
    fallback.fill({ color: archetype.color, alpha: 0.95 })
    fallback.stroke({ color: 0x000000, width: 2, alpha: 0.88 })
    con.addChild(fallback)
    const t = new Text({
      text: `${archetype.text}${levelNum}`,
      style: { fontSize: 24, fill: 0xffffff, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 2 } },
    })
    t.anchor.set(0.5)
    t.x = 28
    t.y = 22
    con.addChild(t)
  } else {
    con.addChild(badges)
  }

  con.scale.set(scale)
  return con
}

export function showStarterSynthesisGuide(
  ctx: ShopSceneCtx,
  stage: Container,
  pick: StarterClass,
  callbacks: {
    getItemDefByCn: (nameCn: string) => ItemDef | null
    captureAndSave: () => void
    ensureDailyChoiceSelection: (stage: Container) => void
  },
): void {
  if (ctx.starterGuideOverlay) return
  const preset = STARTER_CLASS_PRESETS[pick]
  if (!preset) return
  const itemA = callbacks.getItemDefByCn(preset.gifts[0])
  const itemB = callbacks.getItemDefByCn(preset.gifts[1])
  const sameArchetypeResultItem = itemA ? pickGuideSameArchetypeResultItem(pick, itemA) : null
  const otherArchetypeResultItem = pickGuideOtherArchetypeResultItem(pick, callbacks.getItemDefByCn)
  if (!itemA || !itemB || !sameArchetypeResultItem || !otherArchetypeResultItem) return

  ctx.starterBattleGuideShown = true
  callbacks.captureAndSave()

  const overlay = new Container()
  overlay.zIndex = 3200
  overlay.eventMode = 'static'
  overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

  const mask = new Graphics()
  mask.rect(0, 0, CANVAS_W, CANVAS_H)
  mask.fill({ color: 0x090d18, alpha: 0.84 })
  overlay.addChild(mask)

  const panel = new Container()
  panel.x = CANVAS_W / 2
  panel.y = CANVAS_H / 2
  panel.eventMode = 'static'
  panel.on('pointerdown', (e) => e.stopPropagation())
  overlay.addChild(panel)

  const panelW = 586
  const panelH = 860
  const panelBg = new Graphics()
  panelBg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 24)
  panelBg.fill({ color: 0x171b2c, alpha: 0.97 })
  panelBg.stroke({ color: 0x7ea7ff, width: 3, alpha: 1 })
  panel.addChild(panelBg)

  const title = new Text({
    text: '合成规则',
    style: { fontSize: 52, fill: 0xffefc8, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  title.anchor.set(0.5)
  title.y = -354
  panel.addChild(title)

  const verticalDivider = new Graphics()
  verticalDivider.moveTo(0, -304)
  verticalDivider.lineTo(0, 260)
  verticalDivider.stroke({ color: 0x5b6790, width: 2, alpha: 0.95 })
  panel.addChild(verticalDivider)

  const createGuideColumn = (
    centerX: number,
    label: string,
    leftDef: ItemDef,
    leftLv: string,
    rightDef: ItemDef,
    rightLv: string,
    resultDef: ItemDef,
    resultLv: string,
  ): Container => {
    const col = new Container()
    col.x = centerX

    const line = new Text({
      text: label,
      style: { fontSize: 28, fill: 0xdce8ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    line.anchor.set(0.5)
    line.y = -266
    col.addChild(line)

    const topRow = new Container()
    topRow.y = -176
    const a = createGuideItemCard(leftDef, leftLv, 'Bronze')
    a.x = -114
    topRow.addChild(a)
    const plus = new Text({ text: '+', style: { fontSize: 50, fill: 0x8ec6ff, fontFamily: 'Arial', fontWeight: 'bold' } })
    plus.anchor.set(0.5)
    plus.x = 0
    plus.y = 42
    topRow.addChild(plus)
    const b = createGuideItemCard(rightDef, rightLv, 'Bronze')
    b.x = 22
    topRow.addChild(b)
    col.addChild(topRow)

    const downArrow = new Text({ text: '↓', style: { fontSize: 60, fill: 0x8ec6ff, fontFamily: 'Arial', fontWeight: 'bold' } })
    downArrow.anchor.set(0.5)
    downArrow.y = -12
    col.addChild(downArrow)

    const resultRow = new Container()
    resultRow.y = 66
    const result = createGuideItemCard(resultDef, resultLv, getGuideFrameTierByLevel(resultLv))
    result.x = -46
    resultRow.addChild(result)
    col.addChild(resultRow)

    return col
  }

  panel.addChild(createGuideColumn(-145, '相同物品 → 升级', itemA, '1', itemA, '1', sameArchetypeResultItem, '2'))
  panel.addChild(createGuideColumn(145, '相同职业 → 其他职业', itemA, '1', itemB, '1', otherArchetypeResultItem, '2'))

  const closeBtn = new Container()
  closeBtn.eventMode = 'static'
  closeBtn.cursor = 'pointer'
  closeBtn.y = 352
  const closeBg = new Graphics()
  closeBg.roundRect(-158, -40, 316, 80, 18)
  closeBg.fill({ color: 0x315a94, alpha: 0.95 })
  closeBg.stroke({ color: 0x89c3ff, width: 3, alpha: 1 })
  closeBtn.addChild(closeBg)
  const closeTxt = new Text({
    text: '我知道了',
    style: { fontSize: 34, fill: 0xeaf4ff, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  closeTxt.anchor.set(0.5)
  closeBtn.addChild(closeTxt)
  closeBtn.on('pointerdown', (e) => {
    e.stopPropagation()
    if (ctx.starterGuideOverlay?.parent) ctx.starterGuideOverlay.parent.removeChild(ctx.starterGuideOverlay)
    ctx.starterGuideOverlay?.destroy({ children: true })
    ctx.starterGuideOverlay = null
    callbacks.ensureDailyChoiceSelection(stage)
  })
  panel.addChild(closeBtn)

  ctx.starterGuideOverlay = overlay
  stage.addChild(overlay)
}

// ============================================================
// 初始英雄选择面板
// ============================================================

export function ensureStarterClassSelection(
  ctx: ShopSceneCtx,
  stage: Container,
  callbacks: {
    setTransitionInputEnabled: (enabled: boolean) => void
    applyPhaseInputLock: () => void
    refreshShopUI: () => void
    captureAndSave: () => void
    ensureDailyChoiceSelection: (stage: Container) => void
    grantHeroStartDayEffectsIfNeeded: () => void
    seedInitialUnlockPoolByStarterClass: (pick: StarterClass) => void
  },
): void {
  if (ctx.starterGranted) return
  if (ctx.classSelectOverlay) return
  if (!ctx.shopManager) return

  callbacks.setTransitionInputEnabled(false)

  const overlay = new Container()
  overlay.zIndex = 3000
  overlay.eventMode = 'static'
  overlay.hitArea = new Rectangle(0, 0, CANVAS_W, CANVAS_H)

  const bg = new Graphics()
  bg.rect(0, 0, CANVAS_W, CANVAS_H)
  bg.fill({ color: 0x0a1020, alpha: 0.94 })
  overlay.addChild(bg)

  const titleText = new Text({
    text: '选择你的初始英雄',
    style: { fontSize: 42, fill: 0xfff2cf, fontFamily: 'Arial', fontWeight: 'bold' },
  })
  titleText.anchor.set(0.5)
  titleText.x = CANVAS_W / 2
  titleText.y = 150
  overlay.addChild(titleText)

  const subtitle = new Text({
    text: '仅影响头像展示，不附带初始物品',
    style: { fontSize: 24, fill: 0xb9c8e8, fontFamily: 'Arial' },
  })
  subtitle.anchor.set(0.5)
  subtitle.x = CANVAS_W / 2
  subtitle.y = 202
  overlay.addChild(subtitle)

  const cards: Array<{ key: StarterClass; border: Graphics; pick: Text }> = []
  const showAllHeroes = getDebugCfg('gameplayStarterHeroShowAll') >= 0.5
  if (!showAllHeroes && (ctx.starterHeroChoiceOptions.length !== 3 || ctx.starterHeroChoiceOptions.some((id) => !HERO_STARTER_POOL.includes(id)))) {
    const pool = HERO_STARTER_POOL.slice()
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const t = pool[i]
      pool[i] = pool[j]!
      pool[j] = t!
    }
    ctx.starterHeroChoiceOptions = pool.slice(0, 3)
  }
  const order: StarterClass[] = showAllHeroes ? HERO_STARTER_POOL : ctx.starterHeroChoiceOptions
  const compact = order.length > 3
  const cols = compact ? 5 : 3
  const cardW = compact ? 114 : 190
  const cardH = compact ? 370 : 624
  const gapX = compact ? 10 : 16
  const gapY = compact ? 12 : 0
  const cardX = (CANVAS_W - (cardW * cols + gapX * (cols - 1))) / 2
  const startY = compact ? 340 : 460
  let selected: StarterClass | null = ctx.starterClass

  const confirmSelection = () => {
    if (!selected) return
    ctx.starterClass = selected
    ctx.starterGranted = true
    ctx.starterBattleGuideShown = false
    if (selected === 'hero9') {
      setLifeState(40, 40)
    }
    callbacks.seedInitialUnlockPoolByStarterClass(selected)
    callbacks.grantHeroStartDayEffectsIfNeeded()
    callbacks.captureAndSave()
    if (ctx.classSelectOverlay?.parent) ctx.classSelectOverlay.parent.removeChild(ctx.classSelectOverlay)
    ctx.classSelectOverlay?.destroy({ children: true })
    ctx.classSelectOverlay = null
    callbacks.setTransitionInputEnabled(true)
    callbacks.applyPhaseInputLock()
    callbacks.refreshShopUI()
    callbacks.ensureDailyChoiceSelection(stage)
  }

  const redrawCards = () => {
    for (const c of cards) {
      const active = c.key === selected
      c.border.clear()
      c.border.roundRect(0, 0, cardW, cardH, 24)
      c.border.stroke({ color: active ? 0x5fd3ff : 0x6d7791, width: active ? 4 : 2, alpha: 1 })
      c.border.fill({ color: active ? 0x132a46 : 0x1b2438, alpha: active ? 0.95 : 0.85 })
      c.pick.visible = active
    }
  }

  for (let i = 0; i < order.length; i++) {
    const key = order[i]!
    const preset = STARTER_CLASS_PRESETS[key]
    const con = new Container()
    const col = i % cols
    const row = Math.floor(i / cols)
    con.x = cardX + col * (cardW + gapX)
    con.y = startY + row * (cardH + gapY)
    con.eventMode = 'static'
    con.cursor = 'pointer'
    con.hitArea = new Rectangle(0, 0, cardW, cardH)

    const border = new Graphics()
    con.addChild(border)

    const t = new Text({
      text: preset.title,
      style: { fontSize: compact ? 20 : 36, fill: 0xfff2cf, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    t.x = compact ? 12 : 32
    t.y = compact ? 10 : 24
    con.addChild(t)

    const d = new Text({
      text: preset.subtitle,
      style: {
        fontSize: compact ? 14 : 22,
        fill: 0xc7d5f2,
        fontFamily: 'Arial',
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: compact ? (cardW - 14) : (cardW - 30),
        lineHeight: compact ? 18 : 30,
      },
    })
    d.x = compact ? 7 : 18
    d.y = compact ? 182 : 352
    con.addChild(d)

    const pick = new Text({
      text: '点击选择',
      style: { fontSize: compact ? 16 : 28, fill: 0x8fe6b2, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    pick.anchor.set(0.5)
    pick.x = cardW / 2
    pick.y = cardH - (compact ? 52 : 64)
    pick.visible = false
    con.addChild(pick)

    const hero = new Sprite(Texture.WHITE)
    const heroMaxW = compact ? 96 : 154
    const heroMaxH = compact ? 120 : 230
    hero.visible = false
    hero.x = (cardW - heroMaxW) / 2
    hero.y = compact ? 56 : 102
    void Assets.load<Texture>(preset.heroImage).then((tex) => {
      hero.texture = tex
      const sw = Math.max(1, tex.width)
      const sh = Math.max(1, tex.height)
      const sc = Math.min(heroMaxW / sw, heroMaxH / sh)
      hero.width = Math.max(1, Math.round(sw * sc))
      hero.height = Math.max(1, Math.round(sh * sc))
      hero.x = (cardW - hero.width) / 2
      hero.y = (compact ? 56 : 102) + (heroMaxH - hero.height) / 2
      hero.visible = true
    }).catch(() => {
      // ignore missing asset in runtime
    })
    con.addChild(hero)

    con.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      if (selected !== key) {
        selected = key
        redrawCards()
        return
      }
      confirmSelection()
    })

    overlay.addChild(con)
    cards.push({ key, border, pick })
  }

  redrawCards()

  ctx.classSelectOverlay = overlay
  stage.addChild(overlay)
}

// ============================================================
// 周期奖励派发
// ============================================================

export function enqueueHeroPeriodicReward(
  ctx: ShopSceneCtx,
  candidate: PoolCandidate,
  source: string,
  callbacks: {
    refreshPlayerStatusUI: () => void
    captureAndSave: () => void
  },
): void {
  ctx.pendingHeroPeriodicRewards.push({
    itemId: candidate.item.id,
    level: candidate.level,
    tier: candidate.tier,
    star: candidate.star,
    source,
  })
  callbacks.refreshPlayerStatusUI()
  callbacks.captureAndSave()
}

export function checkAndPopPendingHeroPeriodicRewards(
  ctx: ShopSceneCtx,
  callbacks: {
    getUnlockPoolBuyPriceByLevel: (level: 1 | 2 | 3 | 4 | 5 | 6 | 7) => number
    grantPoolCandidateToBoardOrBackpack: (
      candidate: PoolCandidate,
      source: string,
      opts?: { flyFromHeroAvatar?: boolean; silentNoSpaceToast?: boolean; onSettled?: () => void },
    ) => boolean
    refreshPlayerStatusUI: () => void
    captureAndSave: () => void
  },
): void {
  if (ctx.pendingHeroPeriodicRewardDispatching) return
  if (ctx.pendingHeroPeriodicRewards.length <= 0) return

  const next = ctx.pendingHeroPeriodicRewards[0]
  if (!next) return
  const item = getItemDefById(next.itemId)
  if (!item) {
    ctx.pendingHeroPeriodicRewards.shift()
    callbacks.refreshPlayerStatusUI()
    callbacks.captureAndSave()
    checkAndPopPendingHeroPeriodicRewards(ctx, callbacks)
    return
  }

  const candidate: PoolCandidate = {
    item,
    level: next.level,
    tier: next.tier,
    star: next.star,
    price: callbacks.getUnlockPoolBuyPriceByLevel(next.level),
  }
  ctx.pendingHeroPeriodicRewardDispatching = true
  const ok = callbacks.grantPoolCandidateToBoardOrBackpack(candidate, `${next.source}补发`, {
    flyFromHeroAvatar: true,
    silentNoSpaceToast: true,
    onSettled: () => {
      ctx.pendingHeroPeriodicRewardDispatching = false
      checkAndPopPendingHeroPeriodicRewards(ctx, callbacks)
    },
  })
  if (!ok) {
    ctx.pendingHeroPeriodicRewardDispatching = false
    return
  }
  ctx.pendingHeroPeriodicRewards.shift()
  callbacks.refreshPlayerStatusUI()
  callbacks.captureAndSave()
}

export function grantHeroPeriodicRewardOrQueue(
  ctx: ShopSceneCtx,
  nameCn: string,
  source: string,
  callbacks: {
    buildNamedPoolCandidate: (nameCn: string) => PoolCandidate | null
    grantPoolCandidateToBoardOrBackpack: (
      candidate: PoolCandidate,
      source: string,
      opts?: { flyFromHeroAvatar?: boolean; silentNoSpaceToast?: boolean },
    ) => boolean
    showHintToast: (reason: string, message: string, color?: number) => void
    refreshPlayerStatusUI: () => void
    captureAndSave: () => void
  },
): boolean {
  const candidate = callbacks.buildNamedPoolCandidate(nameCn)
  if (!candidate) return false
  const ok = callbacks.grantPoolCandidateToBoardOrBackpack(candidate, source, {
    flyFromHeroAvatar: true,
    silentNoSpaceToast: true,
  })
  if (ok) return true
  enqueueHeroPeriodicReward(ctx, candidate, source, {
    refreshPlayerStatusUI: callbacks.refreshPlayerStatusUI,
    captureAndSave: callbacks.captureAndSave,
  })
  callbacks.showHintToast('backpack_full_buy', `${source}：空间不足，已暂存待补发`, 0xffd48f)
  return true
}

// ============================================================
// 每日开始效果
// ============================================================

export function grantHeroStartDayEffectsIfNeeded(
  ctx: ShopSceneCtx,
  callbacks: {
    showHintToast: (reason: string, message: string, color?: number) => void
  },
): void {
  if (!ctx.shopManager) return
  if (isSelectedHero(ctx, 'hero2') && !ctx.heroTycoonGoldGrantedDays.has(ctx.currentDay)) {
    const bonus = Math.max(0, ctx.currentDay + 1)
    if (bonus > 0) {
      ctx.shopManager.gold += bonus
      ctx.heroTycoonGoldGrantedDays.add(ctx.currentDay)
      callbacks.showHintToast('no_gold_buy', `大亨：额外获得${bonus}金币`, 0xf4d67d)
    }
  }
}

export function grantHeroPeriodicEffectsOnNewDay(
  ctx: ShopSceneCtx,
  day: number,
  callbacks: {
    showHintToast: (reason: string, message: string, color?: number) => void
    grantHeroPeriodicRewardOrQueue: (nameCn: string, source: string) => boolean
  },
): void {
  if (!ctx.shopManager) return
  if (isSelectedHero(ctx, 'hero2') && !ctx.heroTycoonGoldGrantedDays.has(day)) {
    const bonus = Math.max(0, day + 1)
    if (bonus > 0) {
      ctx.shopManager.gold += bonus
      ctx.heroTycoonGoldGrantedDays.add(day)
      callbacks.showHintToast('no_gold_buy', `大亨：额外获得${bonus}金币`, 0xf4d67d)
    }
  }
  if (day % 5 === 0) {
    if (isSelectedHero(ctx, 'hero5') && !ctx.heroSmithStoneGrantedDays.has(day)) {
      if (callbacks.grantHeroPeriodicRewardOrQueue('升级石', '铁匠')) ctx.heroSmithStoneGrantedDays.add(day)
    }
  }
  if (day % 3 === 0) {
    if (isSelectedHero(ctx, 'hero6') && !ctx.heroAdventurerScrollGrantedDays.has(day)) {
      if (callbacks.grantHeroPeriodicRewardOrQueue('冒险卷轴', '冒险家')) ctx.heroAdventurerScrollGrantedDays.add(day)
    }
    if (isSelectedHero(ctx, 'hero7') && !ctx.heroCommanderMedalGrantedDays.has(day)) {
      if (callbacks.grantHeroPeriodicRewardOrQueue('勋章', '指挥官')) ctx.heroCommanderMedalGrantedDays.add(day)
    }
  }
  if (day === 3 && isSelectedHero(ctx, 'hero8') && !ctx.heroHeirGoldEquipGrantedDays.has(day)) {
    if (callbacks.grantHeroPeriodicRewardOrQueue('黄金宝箱', '继承者')) ctx.heroHeirGoldEquipGrantedDays.add(day)
    else callbacks.showHintToast('backpack_full_buy', '继承者：当前无可发放黄金宝箱', 0xffb27a)
  }
}

// ============================================================
// 每日银币/金币加成
// ============================================================

export function grantSilverDailyGoldBonusesOnNewDay(
  ctx: ShopSceneCtx,
  callbacks: {
    hasPickedSkill: (skillId: string) => boolean
    showHintToast: (reason: string, message: string, color?: number) => void
  },
): void {
  if (!ctx.shopManager) return
  if (callbacks.hasPickedSkill('skill29')) {
    const bonus = Math.max(0, ctx.currentDay)
    if (bonus > 0) {
      ctx.shopManager.gold += bonus
      callbacks.showHintToast('no_gold_buy', `投资达人：额外获得${bonus}金币`, 0x9be5ff)
    }
  }
  if (callbacks.hasPickedSkill('skill34')) {
    const interest = Math.min(30, Math.max(0, Math.floor(ctx.shopManager.gold / 5)))
    if (interest > 0) {
      ctx.shopManager.gold += interest
      callbacks.showHintToast('no_gold_buy', `利息循环：获得${interest}金币`, 0xa8f0b6)
    }
  }
  if (callbacks.hasPickedSkill('skill94')) {
    const bonus = calcSkill94DailyGoldBonus(ctx.shopManager.gold)
    if (bonus > 0) {
      ctx.shopManager.gold += bonus
      callbacks.showHintToast('no_gold_buy', `财富密码：额外获得${bonus}金币`, 0xf4d67d)
    }
  }
}

// Re-export PendingHeroPeriodicReward type for consumers
export type { PendingHeroPeriodicReward }
