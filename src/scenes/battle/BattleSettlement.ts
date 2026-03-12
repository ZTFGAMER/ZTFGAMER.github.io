import { Container, Graphics, Text } from 'pixi.js'
import { getConfig as getDebugCfg } from '@/config/debugConfig'
import { getConfig as getGameCfg } from '@/core/DataLoader'
import { PvpContext } from '@/pvp/PvpContext'
import {
  addWinTrophy,
  clearCurrentRunState,
  deductLife,
  getLifeState,
  getPlayerWinStreakState,
  getWinTrophyState,
  resetLifeState,
  setPlayerWinStreak,
  resetWinTrophyState,
} from '@/core/RunState'
import { clearBattleSnapshot } from '@/combat/BattleSnapshotStore'
import { clearBattleOutcome } from '@/combat/BattleOutcomeStore'
import type { CombatEngine } from '@/combat/CombatEngine'
import { CANVAS_W, CANVAS_H } from '@/config/layoutConstants'

export class BattleSettlement {
  private settlementPanel: Container | null = null
  private settlementTitleText: Text | null = null
  private settlementLifeText: Text | null = null
  private settlementTrophyText: Text | null = null
  private settlementDescText: Text | null = null
  private settlementActionBtn: Container | null = null
  private settlementActionLabel: Text | null = null
  private settlementStatsBtn: Container | null = null

  private settlementResolved = false
  private settlementGameOver = false
  private settlementFinalVictory = false
  private settlementRevealAtMs: number | null = null

  buildPanel(
    root: Container,
    onExitBattle: () => void,
    onRestart: () => void,
    isTransitionActive: () => boolean,
  ): void {
    const panel = new Container()
    const bg = new Graphics()
    const panelW = 560
    const panelH = 400
    bg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 24)
    bg.fill({ color: 0x141824, alpha: 0.95 })
    bg.stroke({ color: 0xf2ce72, width: 3, alpha: 0.95 })
    panel.addChild(bg)

    this.settlementTitleText = new Text({
      text: '战斗结束',
      style: { fontSize: 48, fill: 0xffe2a0, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 4 } },
    })
    this.settlementTitleText.anchor.set(0.5)
    this.settlementTitleText.y = -124
    panel.addChild(this.settlementTitleText)

    this.settlementLifeText = new Text({
      text: '❤️ 5/5',
      style: { fontSize: 34, fill: 0xffd4d4, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 3 } },
    })
    this.settlementLifeText.anchor.set(0.5)
    this.settlementLifeText.y = -38
    panel.addChild(this.settlementLifeText)

    this.settlementTrophyText = new Text({
      text: '🏆 0/10',
      style: { fontSize: 30, fill: 0xffe8b4, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 3 } },
    })
    this.settlementTrophyText.anchor.set(0.5)
    this.settlementTrophyText.y = 14
    panel.addChild(this.settlementTrophyText)

    this.settlementDescText = new Text({
      text: '准备下一步行动',
      style: { fontSize: 26, fill: 0xe7edf9, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 2 } },
    })
    this.settlementDescText.anchor.set(0.5)
    this.settlementDescText.y = 62
    panel.addChild(this.settlementDescText)

    this.settlementActionBtn = new Container()
    const actionBg = new Graphics()
    actionBg.roundRect(-170, -40, 340, 80, 18)
    actionBg.fill({ color: 0x22406a, alpha: 0.92 })
    actionBg.stroke({ color: 0x8ac4ff, width: 3, alpha: 0.95 })
    this.settlementActionLabel = new Text({
      text: '返回商店',
      style: { fontSize: getDebugCfg('battleBackButtonLabelFontSize'), fill: 0xe9f4ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    this.settlementActionLabel.anchor.set(0.5)
    this.settlementActionBtn.addChild(actionBg)
    this.settlementActionBtn.addChild(this.settlementActionLabel)
    this.settlementActionBtn.y = 132
    this.settlementActionBtn.eventMode = 'static'
    this.settlementActionBtn.cursor = 'pointer'
    this.settlementActionBtn.on('pointerdown', () => {
      if (isTransitionActive()) return
      if (this.settlementGameOver || this.settlementFinalVictory) {
        onRestart()
        return
      }
      onExitBattle()
    })
    panel.addChild(this.settlementActionBtn)

    panel.x = CANVAS_W / 2
    panel.y = CANVAS_H / 2
    panel.zIndex = 190
    panel.visible = false

    this.settlementPanel = panel
    root.addChild(panel)
  }

  attachStatsBtn(btn: Container): void {
    this.settlementStatsBtn = btn
    this.settlementPanel?.addChild(btn)
  }

  resolve(day: number, engine: CombatEngine): void {
    if (this.settlementResolved) return
    const result = engine.getResult()
    const winner = result?.winner ?? 'draw'
    const before = getLifeState()
    const roundLifeDamage = Math.max(1, Math.min(8, Math.round(day)))
    const trophyTarget = getGameCfg().runRules?.trophyWinsToFinalVictory ?? 10
    const trophyBefore = getWinTrophyState(trophyTarget)
    const winStreakBefore = getPlayerWinStreakState().count
    // PVP 模式：记录胜负，不修改 PVE 生命/奖杯
    if (PvpContext.isActive()) {
      PvpContext.recordBattleResult(winner, engine.getResult()?.survivingDamage ?? 1)
    }
    const after = (!PvpContext.isActive() && winner === 'enemy') ? deductLife(roundLifeDamage) : before
    const shouldAddTrophy = !PvpContext.isActive() && (winner === 'player' || winner === 'draw')
    const trophyAfter = shouldAddTrophy ? addWinTrophy(trophyTarget) : trophyBefore
    if (!PvpContext.isActive()) {
      if (winner === 'player') setPlayerWinStreak(winStreakBefore + 1)
      else setPlayerWinStreak(0)
    }
    const delta = after.current - before.current
    this.settlementResolved = true
    // PVP 模式不触发 PVE 的游戏结束/最终胜利逻辑，防止意外调用 window.location.reload()
    this.settlementGameOver = !PvpContext.isActive() && winner === 'enemy' && after.current <= 0
    this.settlementFinalVictory = !PvpContext.isActive() && winner === 'player' && trophyAfter.wins >= trophyAfter.target

    if (!this.settlementTitleText || !this.settlementLifeText || !this.settlementTrophyText || !this.settlementDescText || !this.settlementActionLabel) return

    if (this.settlementFinalVictory) {
      this.settlementTitleText.text = '最终胜利'
      this.settlementTitleText.style.fill = 0xffe2a0
    } else if (winner === 'player') {
      this.settlementTitleText.text = '战斗胜利'
      this.settlementTitleText.style.fill = 0xffe2a0
    } else if (winner === 'enemy') {
      this.settlementTitleText.text = this.settlementGameOver ? '游戏失败' : '战斗失败'
      this.settlementTitleText.style.fill = 0xff8e8e
    } else {
      this.settlementTitleText.text = '平局'
      this.settlementTitleText.style.fill = 0xb9d5ff
    }

    if (PvpContext.isActive()) {
      const pvpSession = PvpContext.getSession()
      const myHp = pvpSession?.playerHps?.[pvpSession?.myIndex ?? -1] ?? 30
      const damage = winner === 'enemy' ? roundLifeDamage : 0
      const hpAfter = Math.max(0, myHp - damage)
      this.settlementLifeText.text = '⚔️ PVP 对战'
      this.settlementLifeText.style.fill = 0x99bbdd
      if (damage > 0) {
        this.settlementTrophyText.text = hpAfter <= 0
          ? `❤️ ${myHp} → 0  已淘汰`
          : `❤️ ${myHp} → ${hpAfter}  (-${damage})`
        this.settlementTrophyText.style.fill = hpAfter <= 0 ? 0xff4444 : 0xff9999
      } else {
        this.settlementTrophyText.text = `❤️ ${myHp} HP`
        this.settlementTrophyText.style.fill = 0x7fff7f
      }
    } else {
      this.settlementLifeText.text = delta < 0
        ? `❤️ ${before.current}/${before.max} -> ${after.current}/${after.max} (-${Math.abs(delta)})`
        : `❤️ ${after.current}/${after.max}`
      this.settlementLifeText.style.fill = after.current <= 1 ? 0xff6a6a : 0xffd4d4
      this.settlementTrophyText.text = (winner === 'player' || winner === 'draw')
        ? `🏆 ${trophyBefore.wins}/${trophyBefore.target} -> ${trophyAfter.wins}/${trophyAfter.target} (+1)`
        : `🏆 ${trophyAfter.wins}/${trophyAfter.target}`
      this.settlementTrophyText.style.fill = trophyAfter.wins >= trophyAfter.target ? 0xffde79 : 0xffe8b4
    }

    if (this.settlementFinalVictory) {
      this.settlementDescText.text = `🏆 已达成${trophyAfter.target}场胜利，点击重新开始`
      this.settlementActionLabel.text = '重新开始'
    } else if (this.settlementGameOver) {
      this.settlementDescText.text = '❤️ 已耗尽，点击重新开始'
      this.settlementActionLabel.text = '重新开始'
    } else {
      this.settlementDescText.text = winner === 'enemy' ? '调整阵容后再战' : '继续前往商店'
      this.settlementActionLabel.text = '返回商店'
    }
  }

  isResolved(): boolean {
    return this.settlementResolved
  }

  isGameOver(): boolean {
    return this.settlementGameOver
  }

  isFinalVictory(): boolean {
    return this.settlementFinalVictory
  }

  getRevealAtMs(): number | null {
    return this.settlementRevealAtMs
  }

  setRevealAtMs(ms: number | null): void {
    this.settlementRevealAtMs = ms
  }

  updateVisibility(): void {
    if (this.settlementPanel) {
      this.settlementPanel.visible = this.settlementResolved
    }
    if (this.settlementStatsBtn) {
      this.settlementStatsBtn.visible = this.settlementResolved
    }
  }

  getPanel(): Container | null {
    return this.settlementPanel
  }

  reset(): void {
    this.settlementResolved = false
    this.settlementGameOver = false
    this.settlementFinalVictory = false
    this.settlementRevealAtMs = null
    this.settlementPanel = null
    this.settlementTitleText = null
    this.settlementLifeText = null
    this.settlementTrophyText = null
    this.settlementDescText = null
    this.settlementActionBtn = null
    this.settlementActionLabel = null
    this.settlementStatsBtn = null
  }
}

export function doRestartRun(): void {
  clearCurrentRunState()
  resetLifeState()
  resetWinTrophyState(10) // will be overridden by actual value at call site
  clearBattleSnapshot()
  clearBattleOutcome()
  window.location.reload()
}
