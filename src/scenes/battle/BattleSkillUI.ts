import { Container, Sprite, Text, Assets, Texture, Graphics } from 'pixi.js'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { getSkillIconUrl } from '@/core/assetPath'
import { getBronzeSkillById, getBronzeSkillByName } from '@/skills/bronzeSkillConfig'
import { getSilverSkillById } from '@/skills/silverSkillConfig'
import { getGoldSkillById } from '@/skills/goldSkillConfig'
import { CANVAS_W } from '@/config/layoutConstants'
import { SHOP_STATE_STORAGE_KEY } from '@/core/RunState'
import type { GridZone } from '@/grid/GridZone'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BattleSkillPick = {
  id: string
  name: string
  desc: string
  detailDesc?: string
  icon?: string
  archetype: 'warrior' | 'archer' | 'assassin' | 'utility'
  tier: 'bronze' | 'silver' | 'gold'
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKILL_BAR_INTRO_DURATION_MS = 500

// ---------------------------------------------------------------------------
// Helpers (duplicated from BattleScene — pure, no external state)
// ---------------------------------------------------------------------------

function getEnemyHpBarScale(): number {
  return getDebugCfg('enemyHpBarScale')
}

function getHeroBarCenter(side: 'player' | 'enemy'): { x: number; y: number } {
  const hpScale = side === 'enemy' ? getEnemyHpBarScale() : 1
  const barW = getDebugCfg('battleHpBarWidth') * hpScale
  const barH = getDebugCfg('battleHpBarH') * hpScale
  const x = (CANVAS_W - barW) / 2 + barW / 2
  const y = (side === 'enemy' ? getDebugCfg('enemyHpBarY') : getDebugCfg('playerHpBarY')) + barH / 2
  return { x, y }
}

function getBattleInfoPanelCenterY(): number {
  const top = getDebugCfg('enemyHpBarY') + getDebugCfg('battleHpBarH') * getEnemyHpBarScale() + 24
  const bottom = getDebugCfg('playerHpBarY') - 24
  return (top + bottom) / 2
}

function shouldShowSimpleDescriptions(): boolean {
  return getDebugCfg('gameplayShowSimpleDescriptions') >= 0.5
}

function getDefaultBattleSkillDetailMode(): 'simple' | 'detailed' {
  return shouldShowSimpleDescriptions() ? 'simple' : 'detailed'
}

function battleSkillTierColor(tier: BattleSkillPick['tier']): number {
  if (tier === 'bronze') return 0xbe8b46
  if (tier === 'silver') return 0x9aafc8
  return 0xd0ac43
}

function battleSkillTierLabelCn(tier: BattleSkillPick['tier']): string {
  if (tier === 'bronze') return '青铜'
  if (tier === 'silver') return '白银'
  return '黄金'
}

function getBattleSkillIconStem(skill: BattleSkillPick): string | null {
  const normalize = (raw: string): string => raw.replace(/\.png$/i, '').trim()
  const fromSkill = normalize(`${skill.icon ?? ''}`)
  if (fromSkill) return fromSkill
  if (/^skill\d+$/.test(skill.id)) return skill.id
  const fromIdCfg = getBronzeSkillById(skill.id)?.icon
    ?? getSilverSkillById(skill.id)?.icon
    ?? getGoldSkillById(skill.id)?.icon
  if (fromIdCfg) return normalize(fromIdCfg)
  const fromNameCfg = getBronzeSkillByName(skill.name)?.icon
  if (fromNameCfg) return normalize(fromNameCfg)
  return null
}

function toBattleSkillPickById(id: string): BattleSkillPick | null {
  const hit = getBronzeSkillById(id) ?? getSilverSkillById(id) ?? getGoldSkillById(id)
  if (!hit) return null
  return {
    id: hit.id,
    name: hit.name,
    desc: hit.desc,
    detailDesc: hit.detailDesc,
    icon: hit.icon,
    archetype: hit.archetype,
    tier: hit.tier,
  }
}

function loadPickedSkillsFromShopState(): BattleSkillPick[] {
  try {
    const raw = localStorage.getItem(SHOP_STATE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { state?: { pickedSkills?: unknown } } | null
    const state = parsed && typeof parsed === 'object' && parsed.state && typeof parsed.state === 'object'
      ? parsed.state
      : parsed
    const list = (state as { pickedSkills?: unknown } | null)?.pickedSkills
    if (!Array.isArray(list)) return []
    return list
      .map((it): BattleSkillPick | null => {
        const rec = it as Record<string, unknown>
        const id = String(rec.id ?? '').trim()
        const name = String(rec.name ?? '').trim()
        const desc = String(rec.desc ?? '').trim()
        const detailDesc = String(rec.detailDesc ?? '').trim()
        const icon = String(rec.icon ?? '').trim()
        const archetype = String(rec.archetype ?? '') as BattleSkillPick['archetype']
        const tier = String(rec.tier ?? '') as BattleSkillPick['tier']
        if (!id || !name) return null
        if (archetype !== 'warrior' && archetype !== 'archer' && archetype !== 'assassin' && archetype !== 'utility') return null
        if (tier !== 'bronze' && tier !== 'silver' && tier !== 'gold') return null
        const one: BattleSkillPick = { id, name, desc, archetype, tier }
        if (detailDesc) one.detailDesc = detailDesc
        if (icon) one.icon = icon
        return one
      })
      .filter((v): v is BattleSkillPick => !!v)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// BattleSkillUI class
// ---------------------------------------------------------------------------

export class BattleSkillUI {
  private root: Container | null = null
  private clearBattleItemSelectionFn: (() => void) | null = null

  // UI containers
  private playerSkillIconBarCon: Container | null = null
  private enemySkillIconBarCon: Container | null = null
  private battleSkillDetailPopupCon: Container | null = null

  // State
  private battleSkillDetailSkillId: string | null = null
  private battleSkillIconBarKey = ''
  private enemySkillIconBarKey = ''
  private battlePickedSkills: BattleSkillPick[] = []
  private enemyPickedSkills: BattleSkillPick[] = []
  private battleSkillDetailMode: 'simple' | 'detailed' = 'detailed'
  skillBarIntroElapsedMs = 0

  constructor(root: Container, clearBattleItemSelection: () => void) {
    this.root = root
    this.clearBattleItemSelectionFn = clearBattleItemSelection
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private mountBattleSkillIconSprite(
    parent: Container,
    skill: BattleSkillPick,
    centerX: number,
    centerY: number,
    iconSize: number,
    fallback: Text,
  ): void {
    const stem = getBattleSkillIconStem(skill)
    if (!stem) return
    const iconUrl = getSkillIconUrl(stem)
    const sprite = new Sprite(Texture.WHITE)
    sprite.anchor.set(0.5)
    sprite.x = centerX
    sprite.y = centerY
    sprite.alpha = 0
    parent.addChild(sprite)

    void Assets.load<Texture>(iconUrl).then((tex) => {
      const side = Math.round(iconSize * 0.78)
      const sw = Math.max(1, tex.width)
      const sh = Math.max(1, tex.height)
      const scale = Math.min(side / sw, side / sh)
      sprite.texture = tex
      sprite.width = Math.max(1, Math.round(sw * scale))
      sprite.height = Math.max(1, Math.round(sh * scale))
      sprite.alpha = 1
      fallback.visible = false
    }).catch(() => {
      sprite.destroy()
    })
  }

  private layoutBattleSkillIconBar(): void {
    if (!this.playerSkillIconBarCon) return
    const hpCenter = getHeroBarCenter('player')
    const hpTopY = hpCenter.y - getDebugCfg('battleHpBarH') / 2
    const introP = Math.max(0, Math.min(1, this.skillBarIntroElapsedMs / SKILL_BAR_INTRO_DURATION_MS))
    const eased = 1 - Math.pow(1 - introP, 3)
    const targetY = hpTopY - 54
    const baseY = targetY - 70
    this.playerSkillIconBarCon.x = hpCenter.x
    this.playerSkillIconBarCon.y = baseY + (targetY - baseY) * eased
  }

  private layoutEnemySkillIconBar(): void {
    if (!this.enemySkillIconBarCon) return
    const hpCenter = getHeroBarCenter('enemy')
    const hpTopY = hpCenter.y - getDebugCfg('battleHpBarH') / 2
    this.enemySkillIconBarCon.x = hpCenter.x
    this.enemySkillIconBarCon.y = hpTopY - 54
  }

  private handleBattleSkillIconTap(skill: BattleSkillPick): void {
    this.clearBattleItemSelectionFn?.()
    if (this.battleSkillDetailSkillId === skill.id) {
      if (shouldShowSimpleDescriptions()) {
        this.battleSkillDetailMode = this.battleSkillDetailMode === 'simple' ? 'detailed' : 'simple'
      } else {
        this.battleSkillDetailMode = 'detailed'
      }
      this.showBattleSkillDetailPopupInternal(skill)
    } else {
      this.battleSkillDetailMode = getDefaultBattleSkillDetailMode()
      this.showBattleSkillDetailPopupInternal(skill)
    }
    this.refreshBattleSkillIconBarInternal(true)
    this.refreshEnemySkillIconBarInternal(true)
  }

  private hideBattleSkillDetailPopupInternal(): void {
    const hadSelection = this.battleSkillDetailSkillId !== null
    this.battleSkillDetailSkillId = null
    this.battleSkillDetailMode = getDefaultBattleSkillDetailMode()
    if (this.battleSkillDetailPopupCon) this.battleSkillDetailPopupCon.visible = false
    if (hadSelection) {
      this.refreshBattleSkillIconBarInternal(true)
      this.refreshEnemySkillIconBarInternal(true)
    }
  }

  private showBattleSkillDetailPopupInternal(skill: BattleSkillPick): void {
    if (!this.root) return
    if (!this.battleSkillDetailPopupCon) {
      this.battleSkillDetailPopupCon = new Container()
      this.battleSkillDetailPopupCon.zIndex = 90
      this.root.addChild(this.battleSkillDetailPopupCon)
    }
    const con = this.battleSkillDetailPopupCon
    con.removeChildren().forEach((c) => c.destroy({ children: true }))

    const panelW = Math.max(360, Math.min(CANVAS_W - 24, getDebugCfg('itemInfoWidth')))
    const pad = 16
    const iconSize = 128
    const textX = pad + iconSize + 16
    const textW = panelW - textX - pad
    const mode = shouldShowSimpleDescriptions() ? this.battleSkillDetailMode : 'detailed'
    const shownDesc = mode === 'detailed' ? (skill.detailDesc ?? skill.desc) : skill.desc

    const title = new Text({
      text: skill.name,
      style: {
        fontSize: getDebugCfg('itemInfoNameFontSize'),
        fill: 0xffefc8,
        fontFamily: 'Arial',
        fontWeight: 'bold',
      },
    })
    const desc = new Text({
      text: shownDesc,
      style: {
        fontSize: getDebugCfg('itemInfoSimpleDescFontSize'),
        fill: 0xd7e2fa,
        fontFamily: 'Arial',
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: textW,
        lineHeight: Math.round(getDebugCfg('itemInfoSimpleDescFontSize') * 1.25),
      },
    })

    const dividerY = pad + 44
    const descY = dividerY + 12
    const contentBottom = Math.max(pad + iconSize, descY + desc.height)
    const panelH = Math.max(getDebugCfg('itemInfoMinHSmall'), contentBottom + pad)
    const px = CANVAS_W / 2 - panelW / 2
    const py = getBattleInfoPanelCenterY() - panelH / 2

    const bg = new Graphics()
    bg.roundRect(px, py, panelW, panelH, Math.max(0, getDebugCfg('gridItemCornerRadius')))
    bg.fill({ color: 0x1e1e30, alpha: 0.97 })
    bg.stroke({ color: 0x5566aa, width: 2 })
    con.addChild(bg)

    const letter = new Text({
      text: skill.name.slice(0, 1),
      style: { fontSize: 56, fill: 0xf5f7ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    letter.anchor.set(0.5)
    letter.x = px + pad + iconSize / 2
    letter.y = py + pad + iconSize / 2 + 2
    con.addChild(letter)
    this.mountBattleSkillIconSprite(con, skill, px + pad + iconSize / 2, py + pad + iconSize / 2 + 2, iconSize, letter)

    title.x = px + textX
    title.y = py + pad + 2
    con.addChild(title)
    if (mode === 'detailed') {
      const tierText = new Text({
        text: battleSkillTierLabelCn(skill.tier),
        style: {
          fontSize: Math.max(16, Math.round(getDebugCfg('itemInfoNameFontSize') * 0.7)),
          fill: 0xfff3cf,
          fontFamily: 'Arial',
          fontWeight: 'bold',
        },
      })
      const badgeX = title.x + title.width + 12
      const badgeY = title.y + 2
      const badgeBg = new Graphics()
      badgeBg.roundRect(badgeX - 10, badgeY - 4, tierText.width + 20, tierText.height + 8, 8)
      badgeBg.fill({ color: battleSkillTierColor(skill.tier), alpha: 0.45 })
      con.addChild(badgeBg)
      tierText.x = badgeX
      tierText.y = badgeY
      con.addChild(tierText)
    }

    const divider = new Graphics()
    divider.moveTo(px + textX, py + dividerY)
    divider.lineTo(px + panelW - pad, py + dividerY)
    divider.stroke({ color: 0x5a628f, width: 1, alpha: 0.9 })
    con.addChild(divider)

    desc.x = px + textX
    desc.y = py + descY
    con.addChild(desc)

    this.battleSkillDetailSkillId = skill.id
    con.visible = true
  }

  private refreshBattleSkillIconBarInternal(forceRebuild = false): void {
    if (!this.root || !this._playerZone) return
    if (!this.playerSkillIconBarCon) {
      this.playerSkillIconBarCon = new Container()
      this.playerSkillIconBarCon.zIndex = 75
      this.root.addChild(this.playerSkillIconBarCon)
    }
    const con = this.playerSkillIconBarCon
    if (this.battlePickedSkills.length <= 0) {
      con.visible = false
      this.battleSkillIconBarKey = ''
      return
    }

    const nextKey = this.battlePickedSkills.map((s) => `${s.id}:${s.tier}:${s.archetype}`).join('|')
    if (!forceRebuild && this.battleSkillIconBarKey === nextKey) {
      con.visible = true
      this.layoutBattleSkillIconBar()
      return
    }

    con.removeChildren().forEach((c) => c.destroy({ children: true }))
    this.battleSkillIconBarKey = nextKey

    const gap = -30
    const iconSize = 128
    const rowW = this.battlePickedSkills.length * iconSize + Math.max(0, this.battlePickedSkills.length - 1) * gap

    for (let i = 0; i < this.battlePickedSkills.length; i++) {
      const s = this.battlePickedSkills[i]!
      const cell = new Container()
      cell.eventMode = 'static'
      cell.cursor = 'pointer'
      const x = -rowW / 2 + i * (iconSize + gap) + iconSize / 2
      const hit = new Graphics()
      hit.roundRect(x - iconSize / 2, -iconSize / 2, iconSize, iconSize, 14)
      hit.fill({ color: 0x000000, alpha: 0.001 })
      cell.addChild(hit)

      const letter = new Text({
        text: s.name.slice(0, 1),
        style: { fontSize: 32, fill: 0xf5f7ff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      letter.anchor.set(0.5)
      letter.x = x
      letter.y = 0
      cell.addChild(letter)
      this.mountBattleSkillIconSprite(cell, s, x, 0, iconSize, letter)

      cell.on('pointerdown', (e) => {
        e.stopPropagation()
        this.handleBattleSkillIconTap(s)
      })

      con.addChild(cell)
    }

    this.layoutBattleSkillIconBar()
    con.visible = true
  }

  private refreshEnemySkillIconBarInternal(forceRebuild = false): void {
    if (!this.root || !this._enemyZone) return
    if (!this.enemySkillIconBarCon) {
      this.enemySkillIconBarCon = new Container()
      this.enemySkillIconBarCon.zIndex = 75
      this.root.addChild(this.enemySkillIconBarCon)
    }
    const con = this.enemySkillIconBarCon
    if (this.enemyPickedSkills.length <= 0) {
      con.visible = false
      this.enemySkillIconBarKey = ''
      return
    }

    const nextKey = this.enemyPickedSkills.map((s) => `${s.id}:${s.tier}:${s.archetype}`).join('|')
    if (!forceRebuild && this.enemySkillIconBarKey === nextKey) {
      con.visible = true
      this.layoutEnemySkillIconBar()
      return
    }

    con.removeChildren().forEach((c) => c.destroy({ children: true }))
    this.enemySkillIconBarKey = nextKey
    const gap = -30
    const iconSize = 128
    const rowW = this.enemyPickedSkills.length * iconSize + Math.max(0, this.enemyPickedSkills.length - 1) * gap

    for (let i = 0; i < this.enemyPickedSkills.length; i++) {
      const s = this.enemyPickedSkills[i]!
      const cell = new Container()
      cell.eventMode = 'static'
      cell.cursor = 'pointer'
      const x = -rowW / 2 + i * (iconSize + gap) + iconSize / 2
      const hit = new Graphics()
      hit.roundRect(x - iconSize / 2, -iconSize / 2, iconSize, iconSize, 14)
      hit.fill({ color: 0x000000, alpha: 0.001 })
      cell.addChild(hit)

      const letter = new Text({
        text: s.name.slice(0, 1),
        style: { fontSize: 32, fill: 0xf5f7ff, fontFamily: 'Arial', fontWeight: 'bold' },
      })
      letter.anchor.set(0.5)
      letter.x = x
      letter.y = 0
      cell.addChild(letter)
      this.mountBattleSkillIconSprite(cell, s, x, 0, iconSize, letter)
      cell.on('pointerdown', (e) => {
        e.stopPropagation()
        this.handleBattleSkillIconTap(s)
      })
      con.addChild(cell)
    }

    con.visible = true
    this.layoutEnemySkillIconBar()
  }

  // Cached zone refs used by internal rebuild methods
  private _playerZone: GridZone | null = null
  private _enemyZone: GridZone | null = null

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Rebuild / update the player skill icon bar */
  refresh(playerZone: GridZone | null, enemyZone: GridZone | null, forceRebuild?: boolean): void {
    this._playerZone = playerZone
    this._enemyZone = enemyZone
    this.refreshBattleSkillIconBarInternal(forceRebuild)
  }

  /** Rebuild / update the enemy skill icon bar */
  refreshEnemy(playerZone: GridZone | null, enemyZone: GridZone | null, forceRebuild?: boolean): void {
    this._playerZone = playerZone
    this._enemyZone = enemyZone
    this.refreshEnemySkillIconBarInternal(forceRebuild)
  }

  /** Advance skillBarIntroElapsedMs and reposition the player skill bar */
  tickIntro(dtMs: number, _playerZone: GridZone | null): void {
    this.skillBarIntroElapsedMs = Math.min(SKILL_BAR_INTRO_DURATION_MS, this.skillBarIntroElapsedMs + dtMs)
    this.layoutBattleSkillIconBar()
    this.layoutEnemySkillIconBar()
  }

  /** Show the skill detail popup */
  showDetailPopup(skill: BattleSkillPick): void {
    this.showBattleSkillDetailPopupInternal(skill)
  }

  /** Hide the skill detail popup */
  hideDetailPopup(): void {
    this.hideBattleSkillDetailPopupInternal()
  }

  /** Whether the detail popup is currently visible */
  isDetailPopupVisible(): boolean {
    return this.battleSkillDetailPopupCon?.visible ?? false
  }

  /** Return the player's picked skills */
  getPickedSkills(): BattleSkillPick[] {
    return this.battlePickedSkills
  }

  /** Return the enemy's picked skills */
  getEnemySkills(): BattleSkillPick[] {
    return this.enemyPickedSkills
  }

  /** Load player picked skills from shop state localStorage */
  loadPlayerSkills(): void {
    this.battlePickedSkills = loadPickedSkillsFromShopState()
  }

  /**
   * Resolve and set skillBarIntroElapsedMs from a snapshot's skillBarMoveStartAtMs.
   * Call this after zones are created but before the first refresh.
   */
  resolveIntroFromSnapshot(snapshot: { skillBarMoveStartAtMs?: unknown } | null | undefined): void {
    const startedAt = snapshot?.skillBarMoveStartAtMs
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) {
      this.skillBarIntroElapsedMs = 0
      return
    }
    const elapsed = Date.now() - startedAt
    this.skillBarIntroElapsedMs = Math.max(0, Math.min(SKILL_BAR_INTRO_DURATION_MS, elapsed))
  }

  /** Initialize enemy skills from engine's getEnemySkillIds() output */
  loadFromSnapshot(enemySkillIds: string[]): void {
    this.enemyPickedSkills = enemySkillIds
      .map((id) => toBattleSkillPickById(id))
      .filter((v): v is BattleSkillPick => !!v)
  }

  /** Set enemy skill icon bar container visibility */
  setEnemyBarVisible(visible: boolean): void {
    if (this.enemySkillIconBarCon) {
      this.enemySkillIconBarCon.visible = visible
    }
  }

  /** Get the detail popup's currently selected skill id */
  getDetailSkillId(): string | null {
    return this.battleSkillDetailSkillId
  }

  /** Reset all state (call on onLeave) */
  reset(): void {
    this.playerSkillIconBarCon = null
    this.enemySkillIconBarCon = null
    this.battleSkillDetailPopupCon = null
    this.battleSkillDetailSkillId = null
    this.battlePickedSkills = []
    this.enemyPickedSkills = []
    this.battleSkillIconBarKey = ''
    this.enemySkillIconBarKey = ''
    this.skillBarIntroElapsedMs = 0
    this.battleSkillDetailMode = 'detailed'
    this._playerZone = null
    this._enemyZone = null
  }
}
