// ============================================================
// PvpResultScene — PVP 最终排名展示
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
/** 已渲染时 session.rankings 的引用；非 null 说明已用真实排名渲染过一次 */
let renderedRankings: object | null = null
/** 已渲染时的 myEliminationRank；用于检测 round_summary 确认淘汰后刷新（预判路径） */
let renderedElimRank: number | undefined = undefined

const RANK_LABELS  = ['第一名', '第二名', '第三名', '第四名']
const RANK_COLORS  = [0xffd700, 0xc0c0c0, 0xcd7f32, 0x778899]
const RANK_BG      = [0x2a2200, 0x1e1e1e, 0x1a0f00, 0x111122]
const RANK_BORDER  = [0xffd700, 0xc0c0c0, 0xcd7f32, 0x445566]

function makeBtn(label: string, color: number, borderColor: number, onClick: () => void): Container {
  const con = new Container()
  const W = 420, H = 88, R = 16

  const border = new Graphics()
  border.roundRect(-W / 2 - 2, -H / 2 - 2, W + 4, H + 4, R + 1).fill({ color: borderColor, alpha: 0.4 })
  con.addChild(border)

  const bg = new Graphics()
  bg.roundRect(-W / 2, -H / 2, W, H, R).fill({ color })
  con.addChild(bg)

  const t = new Text({ text: label, style: { fill: 0xffffff, fontSize: 28, fontWeight: 'bold', align: 'center' } })
  t.anchor.set(0.5)
  con.addChild(t)

  con.eventMode = 'static'
  con.cursor = 'pointer'
  con.on('pointerdown', onClick)
  con.on('pointerover', () => { con.alpha = 0.85 })
  con.on('pointerout', () => { con.alpha = 1 })
  return con
}


function buildContent(): void {
  if (!root) return
  root.removeChildren()

  // ── 背景 ──────────────────────────────────────────────
  const bg = new Graphics()
  bg.rect(0, 0, CANVAS_W, CANVAS_H).fill({ color: 0x0d0d1a })
  root.addChild(bg)

  const topGlow = new Graphics()
  topGlow.circle(CANVAS_W / 2, 0, 240).fill({ color: 0xffd700, alpha: 0.05 })
  root.addChild(topGlow)

  const session = PvpContext.getSession()
  const hasRealRankings = !!(session?.rankings && session.rankings.length > 0)
  const isEliminatedView = !hasRealRankings && !!(session?.myEliminationRank)
  // 本地预判已淘汰，但 round_summary 还未到达（排名未知）
  const isPendingElimination = !hasRealRankings && !session?.myEliminationRank && !!(session?.predictedElimination)

  // ── 预判等待状态：仅显示"结算中"，等 round_summary 到达后自动重建 ──
  if (isPendingElimination) {
    const waitT = new Text({
      text: '结算中...',
      style: { fill: 0x556677, fontSize: 36, align: 'center' },
    })
    waitT.anchor.set(0.5, 0.5)
    waitT.x = CANVAS_W / 2
    waitT.y = CANVAS_H / 2
    root.addChild(waitT)
    return
  }

  // ── 标题 ──────────────────────────────────────────────
  const titleText = new Text({
    text: isEliminatedView ? '你已被淘汰' : '对战结束',
    style: { fill: isEliminatedView ? 0xcc8844 : 0xffd86b, fontSize: 56, fontWeight: 'bold', align: 'center' },
  })
  titleText.anchor.set(0.5, 0)
  titleText.x = CANVAS_W / 2
  titleText.y = 90
  root.addChild(titleText)

  const decoColor = isEliminatedView ? 0xcc8844 : 0xffd86b
  const decoG = new Graphics()
  decoG.rect(CANVAS_W / 2 - 80, 166, 160, 2).fill({ color: decoColor, alpha: 0.5 })
  decoG.rect(CANVAS_W / 2 - 16, 164, 32, 4).fill({ color: decoColor })
  root.addChild(decoG)

  // ── 排名列表 ──────────────────────────────────────────
  type RankEntry = { nickname: string; wins: number | null; isMe: boolean; winsKnown: boolean }
  const entries: RankEntry[] = []

  if (session) {
    if (hasRealRankings) {
      // 真实排名（已从 game_over 收到，已按复合分数降序）
      // 复合分数：存活者 = totalPlayers + remainingHP，淘汰者 = eliminationOrder index（< totalPlayers）
      const totalPlayers = session.players.length
      session.rankings!.forEach((r) => {
        // 解码复合分数：>= totalPlayers 表示存活，实际 HP = wins - totalPlayers
        const isSurvivor = r.wins !== null && r.wins >= totalPlayers
        const displayHp = isSurvivor ? r.wins! - totalPlayers : 0
        entries.push({
          nickname: r.nickname,
          wins: isSurvivor ? displayHp : 0,
          isMe: r.index === session.myIndex,
          winsKnown: isSurvivor,  // false 表示已淘汰，显示"已淘汰"
        })
      })
    } else if (isEliminatedView) {
      // 只显示已淘汰的玩家（含自己），按淘汰顺序逆序（最晚淘汰=排名最好排在前）
      // 存活玩家排名未定，不列入列表，仅在下方显示"N名玩家仍在对战"
      ;[...session.eliminatedPlayers].reverse().forEach((idx) => {
        const p = session.players.find((p2) => p2.index === idx)
        if (!p || p.isAi) return
        entries.push({ nickname: p.nickname, wins: 0, isMe: idx === session.myIndex, winsKnown: false })
      })
    } else {
      // 我存活但 game_over 未到：自己 HP 准确，其他人显示"结算中"
      entries.push({
        nickname: session.players.find((p) => p.index === session.myIndex)?.nickname ?? '我',
        wins: session.playerHps?.[session.myIndex] ?? 0,
        isMe: true,
        winsKnown: true,
      })
      session.players.forEach((p) => {
        if (p.index !== session.myIndex) {
          entries.push({ nickname: p.nickname, wins: 0, isMe: false, winsKnown: false })
        }
      })
      entries.sort((a, b) => {
        if (a.winsKnown && !b.winsKnown) return -1
        if (!a.winsKnown && b.winsKnown) return 1
        return (b.wins ?? -1) - (a.wins ?? -1)
      })
    }
  }

  const listStartY = 210

  // isEliminatedView 时排名从 aliveCount+1 开始（存活玩家占据前几名，排名未定）
  const elimRankOffset = isEliminatedView && session
    ? session.players.filter(p => !p.isAi).length - session.eliminatedPlayers.length
    : 0

  entries.forEach((entry, i) => {
    // ri：真实名次 index（0=第一名），用于样式和标签
    const ri = i + elimRankOffset
    const rowH = ri === 0 ? 155 : 120
    const rowW = ri === 0 ? 560 : 520
    // rowY：行中心 Y；isEliminatedView 所有行等高（均 120px），normal view 第一行特大
    const rowY = elimRankOffset > 0
      ? listStartY + rowH / 2 + i * 128
      : listStartY + (i === 0 ? rowH / 2 : 155 + (i - 1) * 128 + rowH / 2)

    const rowCon = new Container()
    rowCon.x = CANVAS_W / 2
    rowCon.y = rowY

    const glow = new Graphics()
    glow.roundRect(-rowW / 2 - 2, -rowH / 2 - 2, rowW + 4, rowH + 4, 16)
      .fill({ color: RANK_BORDER[ri] ?? 0x445566, alpha: entry.isMe ? 0.6 : 0.2 })
    rowCon.addChild(glow)

    const rowBg = new Graphics()
    rowBg.roundRect(-rowW / 2, -rowH / 2, rowW, rowH, 14).fill({ color: RANK_BG[ri] ?? 0x111122 })
    rowCon.addChild(rowBg)

    const stripe = new Graphics()
    stripe.roundRect(-rowW / 2, -rowH / 2, 6, rowH, 14).fill({ color: RANK_COLORS[ri] ?? 0x445566 })
    rowCon.addChild(stripe)

    const rankT = new Text({
      text: RANK_LABELS[ri] ?? `第${ri + 1}名`,
      style: { fill: RANK_COLORS[ri] ?? 0x778899, fontSize: ri === 0 ? 22 : 18, fontWeight: 'bold' },
    })
    rankT.anchor.set(0, 0.5)
    rankT.x = -rowW / 2 + 22
    rankT.y = ri === 0 ? -22 : -16
    rowCon.addChild(rankT)

    const nameT = new Text({
      text: entry.nickname + (entry.isMe ? '（我）' : ''),
      style: { fill: entry.isMe ? 0xffd86b : 0xddeeff, fontSize: ri === 0 ? 32 : 26, fontWeight: entry.isMe ? 'bold' : 'normal' },
    })
    nameT.anchor.set(0, 0.5)
    nameT.x = -rowW / 2 + 22
    nameT.y = ri === 0 ? 10 : 8
    rowCon.addChild(nameT)

    // winsKnown=true 表示存活（显示 HP），winsKnown=false 表示已淘汰
    const isEliminated = !entry.winsKnown
    const winsLabel = entry.wins === null ? '断线' : isEliminated ? '已淘汰' : `${entry.wins} HP`
    const wins = entry.wins ?? 0
    const winsColor = entry.wins === null
      ? 0x556677
      : !entry.winsKnown
        ? 0x778899
        : (isEliminated ? 0x886655 : (wins >= 4 ? 0x7fff7f : (wins >= 2 ? 0xffd86b : 0xaabbcc)))
    const winsT = new Text({
      text: winsLabel,
      style: { fill: winsColor, fontSize: ri === 0 ? 36 : 28, fontWeight: 'bold' },
    })
    winsT.anchor.set(1, 0.5)
    winsT.x = rowW / 2 - 20
    winsT.y = 0
    rowCon.addChild(winsT)

    // HP dots removed: showing numeric HP value instead

    root!.addChild(rowCon)
  })

  // ── 总结 ──────────────────────────────────────────────
  if (session) {
    const myHpVal = session.playerHps?.[session.myIndex] ?? session.wins
    const myRank = isEliminatedView
      ? (session.myEliminationRank ?? (entries.findIndex((e) => e.isMe) + 1 + elimRankOffset))
      : (entries.findIndex((e) => e.isMe) + 1)

    const summaryY = isEliminatedView
      ? listStartY + entries.length * 128 + 40
      : listStartY + 155 + (entries.length - 1) * 128 + 80

    const summaryBg = new Graphics()
    summaryBg.roundRect(CANVAS_W / 2 - 240, summaryY - 36, 480, 72, 14).fill({ color: 0x1a2035 })
    root.addChild(summaryBg)

    const rankLabel = RANK_LABELS[myRank - 1] ?? `第${myRank}名`
    const summaryT = new Text({
      text: isEliminatedView
        ? rankLabel
        : `HP剩余 ${myHpVal}  ·  ${rankLabel}`,
      style: { fill: isEliminatedView ? (RANK_COLORS[myRank - 1] ?? 0x778899) : 0x99bbdd, fontSize: isEliminatedView ? 28 : 24, fontWeight: isEliminatedView ? 'bold' : 'normal', align: 'center' },
    })
    summaryT.anchor.set(0.5, 0.5)
    summaryT.x = CANVAS_W / 2
    summaryT.y = summaryY
    root.addChild(summaryT)
  }

  // ── 按钮 ──────────────────────────────────────────────
  const btnY = CANVAS_H - 240

  const replayBtn = makeBtn('再来一局', 0x15305c, 0x5b8def, () => {
    PvpContext.endSession()
    SceneManager.goto('pvp-lobby')
  })
  replayBtn.x = CANVAS_W / 2
  replayBtn.y = btnY
  root.addChild(replayBtn)

  const menuBtn = makeBtn('返回主菜单', 0x1c1c2e, 0x445566, () => {
    PvpContext.endSession()
    SceneManager.goto('menu')
  })
  menuBtn.x = CANVAS_W / 2
  menuBtn.y = btnY + 116
  root.addChild(menuBtn)
}

export const PvpResultScene: Scene = {
  name: 'pvp-result',

  onEnter() {
    const { stage } = getApp()
    root = new Container()
    root.sortableChildren = true
    fadeAlpha = 0
    fadeIn = true
    renderedRankings = PvpContext.getSession()?.rankings ?? null
    renderedElimRank = PvpContext.getSession()?.myEliminationRank

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
    renderedRankings = null
    renderedElimRank = undefined
  },

  update(dt: number) {
    if (!root) return

    // 检测 session.rankings 是否新到达（onGameOver 回调写入后，这里触发重建）
    const currentRankings = PvpContext.getSession()?.rankings ?? null
    if (currentRankings && currentRankings !== renderedRankings) {
      renderedRankings = currentRankings
      buildContent()
      root.alpha = 0
      fadeAlpha = 0
      fadeIn = true
    }

    // 检测 myEliminationRank 是否新到达（预判路径：round_summary 确认后从"结算中"刷新为真实结果）
    const currentElimRank = PvpContext.getSession()?.myEliminationRank
    if (currentElimRank !== undefined && currentElimRank !== renderedElimRank) {
      renderedElimRank = currentElimRank
      buildContent()
      root.alpha = 0
      fadeAlpha = 0
      fadeIn = true
      return
    }

    if (fadeIn) {
      fadeAlpha = Math.min(1, fadeAlpha + dt * 2.5)
      root.alpha = fadeAlpha
      if (fadeAlpha >= 1) fadeIn = false
    }
  },
}
