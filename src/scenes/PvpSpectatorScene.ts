// ============================================================
// PvpSpectatorScene — 被淘汰玩家观战界面
// 实时显示存活玩家 HP，game_over 后显示"查看结果"按钮
// ============================================================

import type { Scene } from './SceneManager'
import { SceneManager } from './SceneManager'
import { getApp } from '@/core/AppContext'
import { Container, Graphics, Text } from 'pixi.js'
import { PvpContext } from '@/pvp/PvpContext'

const CANVAS_W = 640
const CANVAS_H = 1384

let root: Container | null = null
let fadeAlpha = 0
let fadeIn = true
/** 上一帧渲染时的 HP 快照，用于检测变化 */
let lastHpSnapshot = ''
/** game_over 后已渲染过结果按钮 */
let hasRankings = false

function hpColor(hp: number, eliminated: boolean): number {
  if (eliminated || hp <= 0) return 0x886655
  if (hp >= 4) return 0x7fff7f
  if (hp >= 2) return 0xffd86b
  return 0xaabbcc
}

function buildContent(): void {
  if (!root) return
  root.removeChildren()

  const session = PvpContext.getSession()

  // ── 背景 ──────────────────────────────────────────────
  const bg = new Graphics()
  bg.rect(0, 0, CANVAS_W, CANVAS_H).fill({ color: 0x0a0a18 })
  root.addChild(bg)

  const topGlow = new Graphics()
  topGlow.circle(CANVAS_W / 2, 0, 200).fill({ color: 0x4466aa, alpha: 0.06 })
  root.addChild(topGlow)

  // ── 标题 ──────────────────────────────────────────────
  const titleT = new Text({
    text: '你已被淘汰',
    style: { fill: 0xcc8844, fontSize: 52, fontWeight: 'bold', align: 'center' },
  })
  titleT.anchor.set(0.5, 0)
  titleT.x = CANVAS_W / 2
  titleT.y = 80
  root.addChild(titleT)

  const decoG = new Graphics()
  decoG.rect(CANVAS_W / 2 - 80, 152, 160, 2).fill({ color: 0xcc8844, alpha: 0.4 })
  decoG.rect(CANVAS_W / 2 - 16, 150, 32, 4).fill({ color: 0xcc8844 })
  root.addChild(decoG)

  const gameOver = session?.rankings && session.rankings.length > 0
  const subLabel = gameOver ? '对局已结束' : '正在观战中...'
  const subT = new Text({
    text: subLabel,
    style: { fill: gameOver ? 0x88aacc : 0x667799, fontSize: 26, align: 'center' },
  })
  subT.anchor.set(0.5, 0)
  subT.x = CANVAS_W / 2
  subT.y = 170
  root.addChild(subT)

  if (!session) return

  // ── 玩家状态列表 ──────────────────────────────────────
  const players = [...session.players].sort((a, b) => {
    const hpA = session.playerHps?.[a.index] ?? 0
    const hpB = session.playerHps?.[b.index] ?? 0
    const elimA = session.eliminatedPlayers.includes(a.index) ? 1 : 0
    const elimB = session.eliminatedPlayers.includes(b.index) ? 1 : 0
    if (elimA !== elimB) return elimA - elimB
    return hpB - hpA
  })

  const initHp = Math.max(...Object.values(session.playerHps ?? {}), 6)
  const listStartY = 240
  const rowH = 110
  const rowW = 560

  players.forEach((player, i) => {
    const hp = session.playerHps?.[player.index] ?? 0
    const eliminated = session.eliminatedPlayers.includes(player.index)
    const isMe = player.index === session.myIndex
    const rowY = listStartY + i * (rowH + 14)

    const rowCon = new Container()
    rowCon.x = CANVAS_W / 2
    rowCon.y = rowY + rowH / 2

    // 行背景
    const rowBg = new Graphics()
    rowBg.roundRect(-rowW / 2, -rowH / 2, rowW, rowH, 12)
      .fill({ color: isMe ? 0x1a1020 : 0x111824 })
    rowCon.addChild(rowBg)

    // 左侧状态条
    const statusColor = eliminated ? 0x664433 : 0x3366aa
    const stripe = new Graphics()
    stripe.roundRect(-rowW / 2, -rowH / 2, 5, rowH, 12).fill({ color: statusColor })
    rowCon.addChild(stripe)

    // 昵称
    const nameT = new Text({
      text: player.nickname + (isMe ? '（我）' : ''),
      style: { fill: isMe ? 0xffd86b : (eliminated ? 0x667788 : 0xddeeff), fontSize: 26, fontWeight: isMe ? 'bold' : 'normal' },
    })
    nameT.anchor.set(0, 0.5)
    nameT.x = -rowW / 2 + 20
    nameT.y = -12
    rowCon.addChild(nameT)

    // 状态标签
    const statusLabel = eliminated ? '已淘汰' : '存活'
    const statusT = new Text({
      text: statusLabel,
      style: { fill: eliminated ? 0x886655 : 0x55aa66, fontSize: 18 },
    })
    statusT.anchor.set(0, 0.5)
    statusT.x = -rowW / 2 + 20
    statusT.y = 16
    rowCon.addChild(statusT)

    // HP 数值
    const hpT = new Text({
      text: eliminated ? '0 HP' : `${hp} HP`,
      style: { fill: hpColor(hp, eliminated), fontSize: 32, fontWeight: 'bold' },
    })
    hpT.anchor.set(1, 0.5)
    hpT.x = rowW / 2 - 16
    hpT.y = -10
    rowCon.addChild(hpT)

    // HP 格子
    const dotY = 20
    const maxDots = Math.min(initHp, 8)
    const dotSize = 14
    const dotGap = 4
    const dotsW = maxDots * (dotSize + dotGap) - dotGap
    const dotsStartX = rowW / 2 - 16 - dotsW

    for (let d = 0; d < maxDots; d++) {
      const filled = !eliminated && d < hp
      const dot = new Graphics()
      dot.roundRect(dotsStartX + d * (dotSize + dotGap), dotY - dotSize / 2, dotSize, dotSize, 3)
        .fill({ color: filled ? hpColor(hp, false) : 0x223344 })
      rowCon.addChild(dot)
    }

    root!.addChild(rowCon)
  })

  // ── game_over 后：查看结果按钮 / 等待提示 ──────────────
  const bottomY = listStartY + players.length * (rowH + 14) + 60

  if (gameOver) {
    const btnCon = new Container()
    const BW = 420, BH = 88, BR = 16

    const btnBorder = new Graphics()
    btnBorder.roundRect(-BW / 2 - 2, -BH / 2 - 2, BW + 4, BH + 4, BR + 1)
      .fill({ color: 0x5b8def, alpha: 0.4 })
    btnCon.addChild(btnBorder)

    const btnBg = new Graphics()
    btnBg.roundRect(-BW / 2, -BH / 2, BW, BH, BR).fill({ color: 0x15305c })
    btnCon.addChild(btnBg)

    const btnT = new Text({
      text: '查看最终结果',
      style: { fill: 0xffffff, fontSize: 28, fontWeight: 'bold', align: 'center' },
    })
    btnT.anchor.set(0.5)
    btnCon.addChild(btnT)

    btnCon.x = CANVAS_W / 2
    btnCon.y = bottomY + BH / 2
    btnCon.eventMode = 'static'
    btnCon.cursor = 'pointer'
    btnCon.on('pointerdown', () => SceneManager.goto('pvp-result'))
    btnCon.on('pointerover', () => { btnCon.alpha = 0.85 })
    btnCon.on('pointerout', () => { btnCon.alpha = 1 })
    root.addChild(btnCon)
  } else {
    const waitT = new Text({
      text: '等待对局结束...',
      style: { fill: 0x445566, fontSize: 22, align: 'center' },
    })
    waitT.anchor.set(0.5, 0)
    waitT.x = CANVAS_W / 2
    waitT.y = bottomY
    root.addChild(waitT)
  }
}

export const PvpSpectatorScene: Scene = {
  name: 'pvp-spectator',

  onEnter() {
    const { stage } = getApp()
    root = new Container()
    root.sortableChildren = true
    fadeAlpha = 0
    fadeIn = true
    hasRankings = false
    lastHpSnapshot = JSON.stringify(PvpContext.getSession()?.playerHps ?? {})

    buildContent()

    root.alpha = 0
    stage.addChild(root)
  },

  onExit() {
    if (root) {
      getApp().stage.removeChild(root)
      root.destroy({ children: true })
      root = null
    }
    lastHpSnapshot = ''
    hasRankings = false
  },

  update(dt: number) {
    if (!root) return

    const session = PvpContext.getSession()

    // 检测 HP 变化或 game_over 到达，触发重建
    const currentHpSnapshot = JSON.stringify(session?.playerHps ?? {})
    const currentHasRankings = !!(session?.rankings && session.rankings.length > 0)

    if (currentHpSnapshot !== lastHpSnapshot || currentHasRankings !== hasRankings) {
      lastHpSnapshot = currentHpSnapshot
      hasRankings = currentHasRankings
      buildContent()
      // 不重置 fadeIn，保持当前透明度继续显示
    }

    if (fadeIn) {
      fadeAlpha = Math.min(1, fadeAlpha + dt * 2.5)
      root.alpha = fadeAlpha
      if (fadeAlpha >= 1) fadeIn = false
    }
  },
}
