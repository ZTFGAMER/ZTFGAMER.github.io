import { Container, Graphics, Text } from 'pixi.js'
import { getConfig as getDebugCfg } from '@/tower/config/debugConfig'
import { getConfig as getGameCfg } from '@/tower/core/DataLoader'
import { PvpContext } from '@/tower/pvp/PvpContext'
import {
  addWinTrophy,
  clearCurrentRunState,
  applyLifeDamageWithLastStand,
  getLifeState,
  getPlayerWinStreakState,
  getWinTrophyState,
  getTowerEndlessRecordState,
  recordTowerEndlessReachedDay,
  resetLifeState,
  setPlayerWinStreak,
  resetWinTrophyState,
} from '@/tower/core/RunState'
import { clearBattleSnapshot } from './BattleSnapshotStore'
import { clearBattleOutcome } from './BattleOutcomeStore'
import type { BattleEngineLike } from './BattleEngineTypes'
import { CANVAS_W, CANVAS_H } from '@/tower/config/layoutConstants'

type CounterAnimState = {
  startMs: number
  delayMs: number
  durationMs: number
  from: number
  to: number
  total: number
  delta: number
  lineY: number
  lineFill: number
  icon: string
  suffix: string
  lineText: Text
  deltaText: Text
  done: boolean
}

function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export class BattleSettlement {
  private settlementPanel: Container | null = null
  private settlementTitleText: Text | null = null
  private settlementLifeText: Text | null = null
  private settlementTrophyText: Text | null = null
  private settlementDescText: Text | null = null
  private settlementActionBtn: Container | null = null
  private settlementActionLabel: Text | null = null
  private settlementReplayBtn: Container | null = null
  private settlementReplayLabel: Text | null = null
  private settlementStatsBtn: Container | null = null
  private settlementLifeDeltaText: Text | null = null
  private settlementTrophyDeltaText: Text | null = null

  private lifeCounterAnim: CounterAnimState | null = null
  private trophyCounterAnim: CounterAnimState | null = null

  private settlementResolved = false
  private settlementGameOver = false
  private settlementFinalVictory = false
  private settlementTowerMode = false
  private settlementRevealAtMs: number | null = null
  private replayMode = false

  buildPanel(
    root: Container,
    onExitBattle: () => void,
    onRestart: () => void,
    onReplay: () => void,
    isTransitionActive: () => boolean,
  ): void {
    const TITLE_Y = -164
    const LIFE_Y = -95
    const TROPHY_Y = -37
    const DESC_Y = 8
    const AUX_BTNS_Y = 44
    const ACTION_BTN_Y = 150
    const MAIN_BTN_W = 380
    const BTN_H = 84
    const SIDE_BTN_GAP = 20
    const SIDE_BTN_W = (MAIN_BTN_W - SIDE_BTN_GAP) / 2

    const panel = new Container()
    const bg = new Graphics()
    const panelW = 584
    const panelH = 560
    bg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 24)
    bg.fill({ color: 0x141824, alpha: 0.95 })
    bg.stroke({ color: 0xf2ce72, width: 3, alpha: 0.95 })
    panel.addChild(bg)

    this.settlementTitleText = new Text({
      text: '战斗结束',
      style: { fontSize: 48, fill: 0xffe2a0, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 4 } },
    })
    this.settlementTitleText.anchor.set(0.5)
    this.settlementTitleText.y = TITLE_Y
    panel.addChild(this.settlementTitleText)

    this.settlementLifeText = new Text({
      text: '❤️ 5/5',
      style: { fontSize: 34, fill: 0xffd4d4, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 3 } },
    })
    this.settlementLifeText.anchor.set(0.5)
    this.settlementLifeText.y = LIFE_Y
    panel.addChild(this.settlementLifeText)

    this.settlementLifeDeltaText = new Text({
      text: '',
      style: { fontSize: 30, fill: 0xff8e8e, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 3 } },
    })
    this.settlementLifeDeltaText.anchor.set(0.5)
    this.settlementLifeDeltaText.visible = false
    panel.addChild(this.settlementLifeDeltaText)

    this.settlementTrophyText = new Text({
      text: '🏆 0/10',
      style: { fontSize: 30, fill: 0xffe8b4, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 3 } },
    })
    this.settlementTrophyText.anchor.set(0.5)
    this.settlementTrophyText.y = TROPHY_Y
    panel.addChild(this.settlementTrophyText)

    this.settlementTrophyDeltaText = new Text({
      text: '',
      style: { fontSize: 30, fill: 0xffe8b4, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: 0x000000, width: 3 } },
    })
    this.settlementTrophyDeltaText.anchor.set(0.5)
    this.settlementTrophyDeltaText.visible = false
    panel.addChild(this.settlementTrophyDeltaText)

    this.settlementDescText = new Text({
      text: '准备下一步行动',
      style: {
        fontSize: 34,
        lineHeight: 44,
        fill: 0xeaf2ff,
        align: 'center',
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x000000, width: 3 },
      },
    })
    this.settlementDescText.anchor.set(0.5)
    this.settlementDescText.y = DESC_Y
    panel.addChild(this.settlementDescText)

    this.settlementActionBtn = new Container()
    const actionBg = new Graphics()
    actionBg.roundRect(-MAIN_BTN_W / 2, -BTN_H / 2, MAIN_BTN_W, BTN_H, 18)
    actionBg.fill({ color: 0x22406a, alpha: 0.92 })
    actionBg.stroke({ color: 0x8ac4ff, width: 3, alpha: 0.95 })
    this.settlementActionLabel = new Text({
      text: '返回商店',
      style: { fontSize: getDebugCfg('battleBackButtonLabelFontSize'), fill: 0xe9f4ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    this.settlementActionLabel.anchor.set(0.5)
    this.settlementActionBtn.addChild(actionBg)
    this.settlementActionBtn.addChild(this.settlementActionLabel)
    this.settlementActionBtn.y = ACTION_BTN_Y
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

    this.settlementReplayBtn = new Container()
    const replayBg = new Graphics()
    replayBg.roundRect(-SIDE_BTN_W / 2, -BTN_H / 2, SIDE_BTN_W, BTN_H, 16)
    replayBg.fill({ color: 0x3b2e62, alpha: 0.92 })
    replayBg.stroke({ color: 0xc7afff, width: 3, alpha: 0.95 })
    this.settlementReplayLabel = new Text({
      text: '重放本局',
      style: { fontSize: 30, fill: 0xf1e9ff, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    this.settlementReplayLabel.anchor.set(0.5)
    this.settlementReplayBtn.addChild(replayBg)
    this.settlementReplayBtn.addChild(this.settlementReplayLabel)
    this.settlementReplayBtn.y = AUX_BTNS_Y
    this.settlementReplayBtn.eventMode = 'static'
    this.settlementReplayBtn.cursor = 'pointer'
    this.settlementReplayBtn.on('pointerdown', () => {
      if (isTransitionActive()) return
      onReplay()
    })
    panel.addChild(this.settlementReplayBtn)

    panel.x = CANVAS_W / 2
    panel.y = CANVAS_H / 2
    panel.zIndex = 190
    panel.visible = false

    this.settlementPanel = panel
    root.addChild(panel)
    this.layoutSettlementButtons()
  }

  private layoutSettlementButtons(): void {
    if (!this.settlementActionBtn) return
    const isTowerGameOver = this.settlementTowerMode && this.settlementGameOver
    const showDesc = this.settlementDescText?.visible === true
    const useTowerCompactLayout = this.settlementTowerMode && showDesc
    const auxY = useTowerCompactLayout ? (isTowerGameOver ? 74 : 82) : (isTowerGameOver ? 88 : 44)
    this.settlementActionBtn.y = useTowerCompactLayout ? (isTowerGameOver ? 190 : 198) : (isTowerGameOver ? 186 : 150)
    if (this.settlementTitleText) {
      this.settlementTitleText.y = useTowerCompactLayout ? -150 : -164
    }
    if (this.settlementDescText) {
      this.settlementDescText.y = useTowerCompactLayout ? (isTowerGameOver ? -28 : -44) : 8
    }
    if (this.settlementReplayBtn) {
      this.settlementReplayBtn.y = auxY
      this.settlementReplayBtn.x = 100
    }
    if (this.settlementStatsBtn) {
      this.settlementStatsBtn.y = auxY
      this.settlementStatsBtn.x = this.settlementReplayBtn?.visible ? -100 : 0
    }
  }

  private startCounterAnimation(
    type: 'life' | 'trophy',
    from: number,
    to: number,
    total: number,
    lineFill: number,
    icon: string,
    suffix: string,
  ): void {
    if (from === to) return
    const lineText = type === 'life' ? this.settlementLifeText : this.settlementTrophyText
    const deltaText = type === 'life' ? this.settlementLifeDeltaText : this.settlementTrophyDeltaText
    if (!lineText || !deltaText) return
    const delta = to - from
    lineText.text = `${icon} ${from}/${total} (${delta > 0 ? '+' : ''}${delta})`
    lineText.style.fill = lineFill
    lineText.scale.set(1)

    deltaText.text = `${delta > 0 ? '+' : ''}${delta}`
    deltaText.style.fill = delta > 0 ? 0x7fff9a : 0xff8e8e
    deltaText.x = 132
    deltaText.y = lineText.y
    deltaText.alpha = 1
    deltaText.visible = true
    deltaText.scale.set(1)

    const anim: CounterAnimState = {
      startMs: Date.now(),
      delayMs: 1000,
      durationMs: 500,
      from,
      to,
      total,
      delta,
      lineY: lineText.y,
      lineFill,
      icon,
      suffix,
      lineText,
      deltaText,
      done: false,
    }
    if (type === 'life') this.lifeCounterAnim = anim
    else this.trophyCounterAnim = anim
  }

  private tickCounterAnimation(anim: CounterAnimState | null): CounterAnimState | null {
    if (!anim || anim.done) return anim
    const elapsed = Date.now() - anim.startMs
    if (elapsed < anim.delayMs) return anim
    const t = Math.max(0, Math.min(1, (elapsed - anim.delayMs) / Math.max(1, anim.durationMs)))

    const cur = Math.round(lerpNumber(anim.from, anim.to, t))
    anim.lineText.text = `${anim.icon} ${cur}/${anim.total}${anim.suffix}`
    anim.lineText.style.fill = anim.lineFill

    const flyT = t
    anim.deltaText.x = lerpNumber(132, 0, flyT)
    anim.deltaText.y = lerpNumber(anim.lineY, anim.lineY - 8, flyT)
    anim.deltaText.alpha = 1 - flyT

    const scale = t < 0.5
      ? lerpNumber(1, 1.15, t / 0.5)
      : lerpNumber(1.15, 1, (t - 0.5) / 0.5)
    anim.lineText.scale.set(scale)

    if (t >= 1) {
      anim.lineText.text = `${anim.icon} ${anim.to}/${anim.total}${anim.suffix}`
      anim.lineText.scale.set(1)
      anim.deltaText.visible = false
      anim.done = true
      return null
    }
    return anim
  }

  private tickCounterAnimations(): void {
    this.lifeCounterAnim = this.tickCounterAnimation(this.lifeCounterAnim)
    this.trophyCounterAnim = this.tickCounterAnimation(this.trophyCounterAnim)
  }

  attachStatsBtn(btn: Container): void {
    this.settlementStatsBtn = btn
    btn.visible = false
    btn.zIndex = 191
    const bg = btn.children.find((n) => n instanceof Graphics) as Graphics | undefined
    if (bg) {
      bg.clear()
      bg.roundRect(-90, -42, 180, 84, 16)
      bg.stroke({ color: 0x96b2ff, width: 3, alpha: 0.95 })
      bg.fill({ color: 0x1f2945, alpha: 0.92 })
    }
    const txt = btn.children.find((n) => n instanceof Text) as Text | undefined
    if (txt) {
      txt.style.fontSize = 34
      txt.style.fill = 0xd9e4ff
      txt.style.fontWeight = 'bold'
      txt.anchor.set(0.5)
      txt.x = 0
      txt.y = 0
    }
    this.settlementPanel?.addChild(btn)
    this.layoutSettlementButtons()
  }

  resolve(day: number, engine: BattleEngineLike, opts?: { applyRunState?: boolean }): void {
    if (this.settlementResolved) return
    const applyRunState = opts?.applyRunState !== false
    this.replayMode = !applyRunState
    const result = engine.getResult()
    const localWinner = result?.winner ?? 'draw'
    // PVP 模式：优先使用 Host 权威结果，彻底消除双端不一致
    // 若权威结果尚未到达（极端竞态），则 fallback 到本地结果
    // 注意：必须在 recordBattleResult 之前读取，因为 recordBattleResult 会消费并清空权威结果
    const winner = PvpContext.isActive()
      ? (PvpContext.getAuthoritativeWinner() ?? localWinner)
      : localWinner
    if (PvpContext.isActive() && PvpContext.getAuthoritativeWinner() === null) {
      console.warn('[BattleSettlement] PVP 权威结果未到达，使用本地结果:', localWinner)
    }
    const towerMode = getGameCfg().towerDefenseRules?.enabled === true
    this.settlementTowerMode = towerMode
    const before = getLifeState()
    const roundLifeDamage = Math.max(1, Math.min(8, Math.round(day)))
    const trophyTarget = getGameCfg().runRules?.trophyWinsToFinalVictory ?? 10
    const trophyBefore = getWinTrophyState(trophyTarget)
    const winStreakBefore = getPlayerWinStreakState().count
    // PVP 模式：记录胜负，不修改 PVE 生命/奖杯
    if (PvpContext.isActive() && applyRunState) {
      PvpContext.recordBattleResult(localWinner, engine.getResult()?.survivingDamage ?? 1)
    }
    const lifeResult = (applyRunState && !PvpContext.isActive() && !towerMode && winner === 'enemy')
      ? applyLifeDamageWithLastStand(roundLifeDamage)
      : { life: before, triggered: false }
    const after = lifeResult.life
    const pveLastStandTriggered = lifeResult.triggered
    const shouldAddTrophy = applyRunState && !PvpContext.isActive() && !towerMode && (winner === 'player' || winner === 'draw')
    const trophyAfter = shouldAddTrophy ? addWinTrophy(trophyTarget) : trophyBefore
    if (applyRunState && !PvpContext.isActive() && !towerMode) {
      if (winner === 'player') setPlayerWinStreak(winStreakBefore + 1)
      else setPlayerWinStreak(0)
    }
    const endlessRecordAfter = applyRunState && !PvpContext.isActive() && towerMode
      ? recordTowerEndlessReachedDay(day)
      : getTowerEndlessRecordState()
    const delta = after.current - before.current
    this.settlementResolved = true
    // PVP 模式不触发 PVE 的游戏结束/最终胜利逻辑，防止意外调用 window.location.reload()
    this.settlementGameOver = applyRunState && !PvpContext.isActive()
      ? (towerMode
        ? winner === 'enemy'
        : (winner === 'enemy' && after.current <= 0 && !pveLastStandTriggered))
      : false
    this.settlementFinalVictory = applyRunState && !PvpContext.isActive() && !towerMode && winner === 'player' && trophyAfter.wins >= trophyAfter.target

    if (!this.settlementTitleText || !this.settlementLifeText || !this.settlementTrophyText || !this.settlementDescText || !this.settlementActionLabel) return

    this.lifeCounterAnim = null
    this.trophyCounterAnim = null
    if (this.settlementLifeDeltaText) this.settlementLifeDeltaText.visible = false
    if (this.settlementTrophyDeltaText) this.settlementTrophyDeltaText.visible = false

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

    if (PvpContext.isActive() && applyRunState) {
      const pvpSession = PvpContext.getSession()
      const myHp = pvpSession?.playerHps?.[pvpSession?.myIndex ?? -1] ?? 30
      const damage = winner === 'enemy' ? roundLifeDamage : 0
      const hpAfter = Math.max(0, myHp - damage)
      this.settlementLifeText.text = '⚔️ PVP 对战'
      this.settlementLifeText.style.fill = 0x99bbdd
      if (damage > 0) {
        const usedLastStand = pvpSession?.lastStandUsedPlayers?.[pvpSession?.myIndex ?? -1] === true
        const willTriggerLastStand = !usedLastStand && myHp - damage <= 0
        this.settlementTrophyText.text = willTriggerLastStand
          ? `❤️ ${myHp} → 1  绝地反击`
          : hpAfter <= 0
          ? `❤️ ${myHp} → 0  已淘汰`
          : `❤️ ${myHp} → ${hpAfter}  (-${damage})`
        this.settlementTrophyText.style.fill = willTriggerLastStand ? 0xffd86b : (hpAfter <= 0 ? 0xff4444 : 0xff9999)
      } else {
        this.settlementTrophyText.text = `❤️ ${myHp} HP`
        this.settlementTrophyText.style.fill = 0x7fff7f
      }
    } else if (towerMode) {
      this.settlementLifeText.visible = false
      this.settlementTrophyText.visible = false
      this.settlementLifeText.text = ''
      this.settlementTrophyText.text = ''
    } else {
      this.settlementLifeText.visible = true
      this.settlementTrophyText.visible = true
      this.settlementLifeText.text = pveLastStandTriggered
        ? `❤️ ${before.current}/${before.max} -> 1/${after.max} (绝地反击)`
        : delta < 0
        ? `❤️ ${before.current}/${before.max} -> ${after.current}/${after.max} (-${Math.abs(delta)})`
        : `❤️ ${after.current}/${after.max}`
      this.settlementLifeText.style.fill = pveLastStandTriggered ? 0xffd86b : (after.current <= 1 ? 0xff6a6a : 0xffd4d4)
      this.settlementTrophyText.text = (winner === 'player' || winner === 'draw')
        ? `🏆 ${trophyBefore.wins}/${trophyBefore.target} -> ${trophyAfter.wins}/${trophyAfter.target} (+1)`
        : `🏆 ${trophyAfter.wins}/${trophyAfter.target}`
      this.settlementTrophyText.style.fill = trophyAfter.wins >= trophyAfter.target ? 0xffde79 : 0xffe8b4

      if (applyRunState && !pveLastStandTriggered && delta !== 0) {
        this.startCounterAnimation('life', before.current, after.current, after.max, this.settlementLifeText.style.fill as number, '❤️', '')
      }
      if (applyRunState && shouldAddTrophy && trophyAfter.wins !== trophyBefore.wins) {
        this.startCounterAnimation('trophy', trophyBefore.wins, trophyAfter.wins, trophyAfter.target, this.settlementTrophyText.style.fill as number, '🏆', '')
      }
    }

    if (towerMode) {
      if (this.settlementGameOver) {
        this.settlementDescText.text = `本次止步第${day}关\n最高关卡：${endlessRecordAfter.bestDay}`
        this.settlementDescText.visible = true
        this.settlementActionLabel.text = '重新开始'
      } else {
        this.settlementDescText.text = `继续挑战：第${day + 1}关`
        this.settlementDescText.visible = true
        this.settlementActionLabel.text = '返回商店'
      }
    } else if (this.settlementFinalVictory) {
      this.settlementDescText.text = `🏆 已达成${trophyAfter.target}场胜利，点击重新开始`
      this.settlementDescText.visible = true
      this.settlementActionLabel.text = '重新开始'
    } else if (this.settlementGameOver) {
      this.settlementDescText.text = '❤️ 已耗尽，点击重新开始'
      this.settlementDescText.visible = true
      this.settlementActionLabel.text = '重新开始'
    } else {
      this.settlementDescText.text = ''
      this.settlementDescText.visible = false
      this.settlementActionLabel.text = '返回商店'
    }

    if (!applyRunState) {
      this.settlementDescText.text = ''
      this.settlementDescText.visible = false
      this.settlementActionLabel.text = '返回商店'
      this.settlementLifeText.style.fill = 0x9fb8d9
      this.settlementTrophyText.style.fill = 0xbccae2
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
    const towerWinHidePanel = this.settlementTowerMode && this.settlementResolved && !this.settlementGameOver
    if (this.settlementPanel) {
      this.settlementPanel.visible = this.settlementResolved && !towerWinHidePanel
    }
    if (this.settlementReplayBtn) {
      this.settlementReplayBtn.visible = this.settlementResolved && !this.settlementGameOver && !this.settlementFinalVictory && !towerWinHidePanel
      this.settlementReplayBtn.eventMode = this.settlementReplayBtn.visible ? 'static' : 'none'
      this.settlementReplayBtn.cursor = this.settlementReplayBtn.visible ? 'pointer' : 'default'
    }
    if (this.settlementReplayLabel) {
      this.settlementReplayLabel.text = this.replayMode ? '再次重放' : '重放本局'
    }
    if (this.settlementStatsBtn) {
      this.settlementStatsBtn.visible = this.settlementResolved && !towerWinHidePanel
    }
    this.layoutSettlementButtons()
    this.tickCounterAnimations()
  }

  getPanel(): Container | null {
    return this.settlementPanel
  }

  prepareForNextWave(): void {
    this.settlementResolved = false
    this.settlementGameOver = false
    this.settlementFinalVictory = false
    this.settlementRevealAtMs = null
    this.lifeCounterAnim = null
    this.trophyCounterAnim = null
    if (this.settlementLifeDeltaText) this.settlementLifeDeltaText.visible = false
    if (this.settlementTrophyDeltaText) this.settlementTrophyDeltaText.visible = false
    if (this.settlementPanel) this.settlementPanel.visible = false
    if (this.settlementReplayBtn) {
      this.settlementReplayBtn.visible = false
      this.settlementReplayBtn.eventMode = 'none'
      this.settlementReplayBtn.cursor = 'default'
    }
    if (this.settlementStatsBtn) this.settlementStatsBtn.visible = false
  }

  reset(): void {
    this.settlementResolved = false
    this.settlementGameOver = false
    this.settlementFinalVictory = false
    this.settlementTowerMode = false
    this.settlementRevealAtMs = null
    this.settlementPanel = null
    this.settlementTitleText = null
    this.settlementLifeText = null
    this.settlementTrophyText = null
    this.settlementDescText = null
    this.settlementActionBtn = null
    this.settlementActionLabel = null
    this.settlementReplayBtn = null
    this.settlementReplayLabel = null
    this.settlementStatsBtn = null
    this.settlementLifeDeltaText = null
    this.settlementTrophyDeltaText = null
    this.lifeCounterAnim = null
    this.trophyCounterAnim = null
    this.replayMode = false
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
