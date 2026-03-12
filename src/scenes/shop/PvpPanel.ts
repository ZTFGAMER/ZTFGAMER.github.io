// ============================================================
// PvpPanel — PVP 商店阶段所有 UI 面板（玩家列表 / 等待面板 / 对手徽章 / 英雄立绘）
// 从 ShopScene.ts 提取，使用 Class 方式（继承 Container）
// ============================================================

import {
  Container, Graphics, Text, Sprite,
  Assets, Texture, Ticker,
} from 'pixi.js'
import { PvpContext } from '@/pvp/PvpContext'
import { getOpponentFromAlive } from '@/pvp/PvpTypes'
import { getItemIconUrl } from '@/core/assetPath'
import { getApp } from '@/core/AppContext'
import type { ShopSceneCtx } from './ShopSceneContext'
import { CANVAS_W, CANVAS_H } from '@/config/layoutConstants'

// ============================================================
// PvpPanel class
// ============================================================

export class PvpPanel extends Container {
  private ctx: ShopSceneCtx
  private pvpPlayerListExpandedIndex = -1

  constructor(ctx: ShopSceneCtx) {
    super()
    this.ctx = ctx
  }

  // ============================================================
  // PVP 玩家列表 Overlay（商店阶段点击 HP 文字弹出）
  // ============================================================

  openPvpPlayerListOverlay(): void {
    const ctx = this.ctx
    if (!ctx.pvpPlayerListOverlay) {
      const { stage } = getApp()
      const overlay = new Container()
      overlay.zIndex = 200
      overlay.visible = false
      stage.addChild(overlay)
      ctx.pvpPlayerListOverlay = overlay
    }
    this.pvpPlayerListExpandedIndex = -1
    this.buildPvpPlayerListContent(ctx.pvpPlayerListOverlay)
    ctx.pvpPlayerListOverlay.visible = true
  }

  closePvpPlayerListOverlay(): void {
    if (this.ctx.pvpPlayerListOverlay) this.ctx.pvpPlayerListOverlay.visible = false
  }

  private buildPvpPlayerListContent(overlay: Container): void {
    overlay.removeChildren()

    const session = PvpContext.getSession()
    if (!session) return

    const snapshots = PvpContext.getLastPlayerSnapshots()

    // 布局常量
    const PANEL_W2 = 580
    const PANEL_X = (CANVAS_W - PANEL_W2) / 2
    const PANEL_Y = 100
    const HEADER_H = 72         // 标题区高度
    const ROW_H = 100           // 每行高度（三行内容：昵称/HP/操作）
    const ROW_GAP = 6
    const SNAP_H = 170
    const BOTTOM_PAD = 24
    const ROW_W = PANEL_W2 - 32
    const initHp = session.initialHp ?? 30

    const players = [...session.players].sort((a, b) => {
      const elimA = session.eliminatedPlayers.includes(a.index) ? 1 : 0
      const elimB = session.eliminatedPlayers.includes(b.index) ? 1 : 0
      if (elimA !== elimB) return elimA - elimB
      return (session.playerHps?.[b.index] ?? 0) - (session.playerHps?.[a.index] ?? 0)
    })

    // 预算面板高度（内容自适应）
    let contentH = HEADER_H
    for (const p of players) {
      contentH += ROW_H + ROW_GAP
      if (this.pvpPlayerListExpandedIndex === p.index && !!snapshots[p.index]) {
        contentH += SNAP_H + 4
      }
    }
    contentH += BOTTOM_PAD
    const panelH = Math.min(contentH, CANVAS_H - PANEL_Y - 80)

    // 背景遮罩（点击关闭）
    const mask = new Graphics()
    mask.rect(0, 0, CANVAS_W, CANVAS_H).fill({ color: 0x000000, alpha: 0.68 })
    mask.eventMode = 'static'
    mask.on('pointerdown', () => this.closePvpPlayerListOverlay())
    overlay.addChild(mask)

    // 面板背景
    const panelBg = new Graphics()
    panelBg.roundRect(PANEL_X, PANEL_Y, PANEL_W2, panelH, 20).fill({ color: 0x0d1520 })
    panelBg.roundRect(PANEL_X, PANEL_Y, PANEL_W2, panelH, 20).stroke({ color: 0x2a3d5c, width: 1.5 })
    panelBg.eventMode = 'static'
    overlay.addChild(panelBg)

    // 标题
    const titleT = new Text({
      text: '玩家状态',
      style: { fill: 0xffd86b, fontSize: 32, fontWeight: 'bold', align: 'center' },
    })
    titleT.anchor.set(0.5, 0.5)
    titleT.x = CANVAS_W / 2
    titleT.y = PANEL_Y + HEADER_H / 2
    overlay.addChild(titleT)

    // 标题分隔线
    const divG = new Graphics()
    divG.rect(PANEL_X + 20, PANEL_Y + HEADER_H - 1, PANEL_W2 - 40, 1).fill({ color: 0x1e2e44 })
    overlay.addChild(divG)

    // 关闭按钮（右上角）
    const closeBtn = new Container()
    const closeBg = new Graphics()
    closeBg.roundRect(-28, -28, 56, 56, 10).fill({ color: 0x162035 })
    closeBtn.addChild(closeBg)
    const closeT = new Text({ text: '✕', style: { fill: 0x8899bb, fontSize: 26, fontWeight: 'bold' } })
    closeT.anchor.set(0.5)
    closeBtn.addChild(closeT)
    closeBtn.x = PANEL_X + PANEL_W2 - 36
    closeBtn.y = PANEL_Y + HEADER_H / 2
    closeBtn.eventMode = 'static'
    closeBtn.cursor = 'pointer'
    closeBtn.on('pointerdown', () => this.closePvpPlayerListOverlay())
    closeBtn.on('pointerover', () => { closeBtn.alpha = 0.7 })
    closeBtn.on('pointerout', () => { closeBtn.alpha = 1 })
    overlay.addChild(closeBtn)

    // 行列表（动态 Y 累加）
    let cursorY = PANEL_Y + HEADER_H + 8

    players.forEach((player, i) => {
      const hp = session.playerHps?.[player.index] ?? 0
      const eliminated = session.eliminatedPlayers.includes(player.index)
      const isMe = player.index === session.myIndex
      const hasSnap = !!snapshots[player.index]
      const isExpanded = this.pvpPlayerListExpandedIndex === player.index && hasSnap

      // HP 颜色
      const hpColor = eliminated ? 0x554433
        : hp <= 2 ? 0xff7766
        : hp <= Math.ceil(initHp / 2) ? 0xffd86b
        : 0x7fff7f

      // ── 行容器 ──────────────────────────────────────────
      const rowCon = new Container()
      rowCon.x = PANEL_X + 16
      rowCon.y = cursorY
      rowCon.eventMode = 'static'

      const rowBg = new Graphics()
      rowBg.roundRect(0, 0, ROW_W, ROW_H, 12)
        .fill({ color: isMe ? 0x18102e : (eliminated ? 0x0c1018 : 0x10192a) })
      rowBg.roundRect(0, 0, ROW_W, ROW_H, 12)
        .stroke({ color: isMe ? 0x6644aa : (eliminated ? 0x1c2230 : 0x1c2e44), width: 1 })
      rowCon.addChild(rowBg)

      // 左侧彩色条
      const stripe = new Graphics()
      stripe.roundRect(0, 8, 4, ROW_H - 16, 2)
        .fill({ color: eliminated ? 0x443322 : (isMe ? 0x8855cc : 0x3a66aa) })
      rowCon.addChild(stripe)

      // 排名序号（居中左侧列）
      const rankT = new Text({
        text: String(i + 1),
        style: { fill: eliminated ? 0x445566 : 0x5577aa, fontSize: 22, fontWeight: 'bold' },
      })
      rankT.anchor.set(0.5, 0.5)
      rankT.x = 26
      rankT.y = ROW_H / 2
      rowCon.addChild(rankT)

      // ── 左侧内容（昵称 + 状态）──
      const nameT = new Text({
        text: player.nickname + (isMe ? ' (我)' : ''),
        style: {
          fill: isMe ? 0xffd86b : (eliminated ? 0x445566 : 0xccddf0),
          fontSize: 26,
          fontWeight: isMe ? 'bold' : 'normal',
        },
      })
      nameT.anchor.set(0, 0)
      nameT.x = 52
      nameT.y = 14
      rowCon.addChild(nameT)

      const gold = snapshots[player.index]?.playerGold
      const goldStr = gold !== undefined ? `  💰 ${gold}G` : ''
      const statusT = new Text({
        text: (eliminated ? '已淘汰' : '存活中') + goldStr,
        style: { fill: eliminated ? 0x665544 : 0x4a9966, fontSize: 17 },
      })
      statusT.anchor.set(0, 0)
      statusT.x = 52
      statusT.y = 50
      rowCon.addChild(statusT)

      if (hasSnap && !eliminated) {
        const hintT = new Text({
          text: isExpanded ? '收起 ▴' : '查看阵容 ▾',
          style: { fill: 0x4488cc, fontSize: 17 },
        })
        hintT.anchor.set(0, 0)
        hintT.x = 52
        hintT.y = 74
        rowCon.addChild(hintT)
      }

      // ── 右侧内容（HP 数字 + 格子）──
      const hpT = new Text({
        text: eliminated ? '0 HP' : `${hp} HP`,
        style: { fill: hpColor, fontSize: 28, fontWeight: 'bold' },
      })
      hpT.anchor.set(1, 0)
      hpT.x = ROW_W - 14
      hpT.y = 14
      rowCon.addChild(hpT)

      // HP 格子
      const maxDots = Math.min(initHp, 12)
      const dotSize = 13
      const dotGap = 4
      const dotsW = maxDots * (dotSize + dotGap) - dotGap
      const dotsStartX = ROW_W - 14 - dotsW
      for (let d = 0; d < maxDots; d++) {
        const filled = !eliminated && d < hp
        const dot = new Graphics()
        dot.roundRect(dotsStartX + d * (dotSize + dotGap), 54, dotSize, dotSize, 3)
          .fill({ color: filled ? hpColor : 0x1a2535 })
        rowCon.addChild(dot)
      }

      // 点击展开/收起
      if (hasSnap && !eliminated) {
        rowCon.cursor = 'pointer'
        rowCon.on('pointerdown', () => {
          this.pvpPlayerListExpandedIndex = this.pvpPlayerListExpandedIndex === player.index ? -1 : player.index
          this.buildPvpPlayerListContent(overlay)
        })
        rowCon.on('pointerover', () => { rowBg.alpha = 0.78 })
        rowCon.on('pointerout', () => { rowBg.alpha = 1 })
      }

      overlay.addChild(rowCon)
      cursorY += ROW_H + ROW_GAP

      // ── 展开阵容面板 ──────────────────────────────────
      if (isExpanded) {
        const snap = snapshots[player.index]!
        const snapCon = new Container()
        snapCon.x = PANEL_X + 16
        snapCon.y = cursorY - ROW_GAP + 2

        const snapBg = new Graphics()
        snapBg.roundRect(0, 0, ROW_W, SNAP_H, 10).fill({ color: 0x0a1420 })
        snapBg.roundRect(0, 0, ROW_W, SNAP_H, 10).stroke({ color: 0x223344, width: 1 })
        snapCon.addChild(snapBg)

        const snapLabel = new Text({ text: '上局阵容', style: { fill: 0x4477aa, fontSize: 17 } })
        snapLabel.x = 14
        snapLabel.y = 10
        snapCon.addChild(snapLabel)

        const ICON_SIZE = 60
        const ICON_GAP = 8
        const ICON_START_X = 14
        const ICON_START_Y = 38
        let col = 0
        let iconRow = 0
        const maxCols = Math.floor((ROW_W - 28) / (ICON_SIZE + ICON_GAP))

        for (const entity of snap.entities) {
          if (!entity.defId) continue
          const ix = ICON_START_X + col * (ICON_SIZE + ICON_GAP)
          const iy = ICON_START_Y + iconRow * (ICON_SIZE + ICON_GAP)

          const iconBg = new Graphics()
          iconBg.roundRect(ix, iy, ICON_SIZE, ICON_SIZE, 8).fill({ color: 0x162030 })
          snapCon.addChild(iconBg)

          Assets.load(getItemIconUrl(entity.defId)).then((tex: Texture) => {
            if (!snapCon.destroyed) {
              const sprite = new Sprite(tex)
              sprite.x = ix
              sprite.y = iy
              sprite.width = ICON_SIZE
              sprite.height = ICON_SIZE
              snapCon.addChild(sprite)
            }
          }).catch(() => {})

          col++
          if (col >= maxCols) { col = 0; iconRow++ }
        }

        if (snap.entities.filter(e => e.defId).length === 0) {
          const emptyT = new Text({ text: '（空阵容）', style: { fill: 0x3a4e60, fontSize: 18 } })
          emptyT.anchor.set(0.5)
          emptyT.x = ROW_W / 2
          emptyT.y = SNAP_H / 2
          snapCon.addChild(emptyT)
        }

        overlay.addChild(snapCon)
        cursorY += SNAP_H + 4
      }
    })
  }

  // ============================================================
  // 臭鸡蛋动效
  // ============================================================

  /** 扔蛋方：从按钮位置飞出一颗旋转上升的鸡蛋 */
  private spawnFloatingEggFx(stageRef: Container, fromX: number, fromY: number): void {
    const eggT = new Text({ text: '🥚', style: { fontSize: 52 } })
    eggT.anchor.set(0.5)
    eggT.x = fromX
    eggT.y = fromY
    eggT.zIndex = 350
    stageRef.addChild(eggT)

    const totalMs = 750
    let elapsed = 0
    const tick = (ticker: { deltaMS: number }): void => {
      elapsed += ticker.deltaMS
      const t = Math.min(1, elapsed / totalMs)
      eggT.y = fromY - 200 * t
      eggT.x = fromX + Math.sin(t * Math.PI * 3) * 28
      eggT.rotation = t * Math.PI * 4
      eggT.scale.set(1 + Math.sin(t * Math.PI) * 0.35)
      eggT.alpha = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45
      if (t >= 1) {
        Ticker.shared.remove(tick)
        if (eggT.parent) eggT.parent.removeChild(eggT)
        eggT.destroy()
      }
    }
    Ticker.shared.add(tick)
  }

  /** 被扔方：全屏大字特效 + 背景闪烁 */
  showEggSplatOverlay(fromNickname: string): void {
    const stageRef = getApp().stage
    const con = new Container()
    con.zIndex = 400
    con.sortableChildren = true
    stageRef.addChild(con)


    // 大鸡蛋
    const bigEgg = new Text({ text: '🥚', style: { fontSize: 128 } })
    bigEgg.anchor.set(0.5)
    bigEgg.x = CANVAS_W / 2
    bigEgg.y = CANVAS_H / 2 - 200
    bigEgg.scale.set(0.1)
    con.addChild(bigEgg)

    // 爆炸符
    const boomT = new Text({ text: '💥', style: { fontSize: 72 } })
    boomT.anchor.set(0.5)
    boomT.x = CANVAS_W / 2 + 60
    boomT.y = CANVAS_H / 2 - 230
    boomT.alpha = 0
    con.addChild(boomT)

    // 说明文字
    const msgT = new Text({
      text: `${fromNickname} 向你扔了一个臭鸡蛋！`,
      style: {
        fill: 0xffee55,
        fontSize: 28,
        fontWeight: 'bold',
        stroke: { color: 0x000000, width: 5 },
        align: 'center',
        wordWrap: true,
        wordWrapWidth: CANVAS_W - 80,
      },
    })
    msgT.anchor.set(0.5)
    msgT.x = CANVAS_W / 2
    msgT.y = CANVAS_H / 2 - 60
    msgT.alpha = 0
    con.addChild(msgT)

    const SCALE_IN_MS = 300
    const HOLD_MS = 700
    const FADE_MS = 400
    let elapsed = 0

    const tick = (ticker: { deltaMS: number }): void => {
      elapsed += ticker.deltaMS
      if (elapsed <= SCALE_IN_MS) {
        const t = elapsed / SCALE_IN_MS
        // 弹性弹入：超出后回弹
        const scale = t < 0.65
          ? 1.5 * (t / 0.65)
          : 1.5 - 0.5 * ((t - 0.65) / 0.35)
        bigEgg.scale.set(scale)
        bigEgg.rotation = (1 - t) * 0.6 * (Math.sin(t * Math.PI * 6) > 0 ? 1 : -1)
        boomT.alpha = t > 0.4 ? (t - 0.4) / 0.6 : 0
        boomT.scale.set(0.5 + t * 0.7)
        msgT.alpha = t > 0.5 ? (t - 0.5) / 0.5 : 0
      } else if (elapsed <= SCALE_IN_MS + HOLD_MS) {
        bigEgg.scale.set(1)
        bigEgg.rotation = 0
        boomT.alpha = 1
        msgT.alpha = 1
      } else {
        const t = (elapsed - SCALE_IN_MS - HOLD_MS) / FADE_MS
        con.alpha = Math.max(0, 1 - t)
        if (t >= 1) {
          Ticker.shared.remove(tick)
          if (con.parent) con.parent.removeChild(con)
          con.destroy({ children: true })
        }
      }
    }
    Ticker.shared.add(tick)
  }

  // ============================================================
  // sync-a 等待面板：按准备后显示，所有人就绪后自动消失
  // 展示玩家就绪状态 + 臭鸡蛋 + 偷看上局阵容
  // ============================================================

  showPvpWaitingPanel(stage: Container): void {
    const ctx = this.ctx
    if (ctx.pvpWaitingPanel) {
      ctx.pvpWaitingPanel.destroy({ children: true })
      stage.removeChild(ctx.pvpWaitingPanel)
    }
    const panel = new Container()
    panel.zIndex = 200
    ctx.pvpWaitingPanel = panel
    stage.addChild(panel)
    this.buildPvpWaitingPanelContent(panel)
  }

  refreshPvpWaitingPanel(): void {
    if (!this.ctx.pvpWaitingPanel) return
    this.buildPvpWaitingPanelContent(this.ctx.pvpWaitingPanel)
  }

  private buildPvpWaitingPanelContent(panel: Container): void {
    panel.removeChildren()

    const session = PvpContext.getSession()
    if (!session) return

    const readySet = new Set(PvpContext.getSyncReadyIndices())
    const snapshots = PvpContext.getLastPlayerSnapshots()
    const alivePlayers = session.players.filter(p => !session.eliminatedPlayers.includes(p.index))
    const totalAlive = alivePlayers.length
    const readyCount = alivePlayers.filter(p => readySet.has(p.index)).length

    // ── 半透明背景遮罩（阻止商店交互）──
    const mask = new Graphics()
    mask.rect(0, 0, CANVAS_W, CANVAS_H).fill({ color: 0x000000, alpha: 0.6 })
    mask.eventMode = 'static'  // 拦截点击，锁定商店
    panel.addChild(mask)

    // ── 本轮对手计算 ──
    const aliveIndices = alivePlayers.map(p => p.index)
    const opponentIdx = session.currentOpponentPlayerIndex
      ?? getOpponentFromAlive(session.myIndex, aliveIndices, session.currentDay - 1)
    const opponentPlayer = opponentIdx >= 0 ? session.players.find(p => p.index === opponentIdx) : null
    const opponentHp = opponentIdx >= 0 ? (session.playerHps?.[opponentIdx] ?? session.initialHp) : 0
    const opponentLastSnap = opponentIdx >= 0 ? snapshots[opponentIdx] : undefined

    // ── 面板主体 ──
    const OPPONENT_CARD_H = 88
    const BOTTOM_BTN_H = 68
    const PANEL_H = Math.min(66 + OPPONENT_CARD_H + 14 + alivePlayers.length * 90 + BOTTOM_BTN_H + 24, CANVAS_H - 80)
    const PANEL_Y = (CANVAS_H - PANEL_H) / 2
    const PANEL_X = 30
    const PANEL_W = CANVAS_W - 60

    const panelBg = new Graphics()
    panelBg.roundRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 20)
      .fill({ color: 0x080f1a })
    panelBg.roundRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 20)
      .stroke({ color: readyCount === totalAlive ? 0x44cc88 : 0x2a3d5c, width: 2 })
    panelBg.eventMode = 'static'
    panel.addChild(panelBg)

    // ── 标题 ──
    const titleT = new Text({
      text: readyCount === totalAlive ? '全员就绪！' : `等待其他玩家... (${readyCount}/${totalAlive})`,
      style: {
        fill: readyCount === totalAlive ? 0x44ee99 : 0xffd86b,
        fontSize: 30,
        fontWeight: 'bold',
      },
    })
    titleT.anchor.set(0.5, 0)
    titleT.x = CANVAS_W / 2
    titleT.y = PANEL_Y + 18
    panel.addChild(titleT)

    // ── 本轮对手预告卡 ──
    const ROW_W = PANEL_W - 32
    const OPP_CARD_X = PANEL_X + 16
    const OPP_CARD_Y = PANEL_Y + 62

    const oppCardG = new Graphics()
    oppCardG.roundRect(OPP_CARD_X, OPP_CARD_Y, ROW_W, OPPONENT_CARD_H, 12)
      .fill({ color: 0x14102e })
    oppCardG.roundRect(OPP_CARD_X, OPP_CARD_Y, ROW_W, OPPONENT_CARD_H, 12)
      .stroke({ color: 0x5544aa, width: 1.5 })
    panel.addChild(oppCardG)

    const oppLabelT = new Text({ text: '⚔️ 本轮对手', style: { fill: 0x8877cc, fontSize: 18 } })
    oppLabelT.anchor.set(0, 0.5)
    oppLabelT.x = OPP_CARD_X + 14
    oppLabelT.y = OPP_CARD_Y + 24
    panel.addChild(oppLabelT)

    if (opponentPlayer) {
      const oppNameT = new Text({
        text: opponentPlayer.nickname,
        style: { fill: 0xddeeff, fontSize: 26, fontWeight: 'bold' },
      })
      oppNameT.anchor.set(0, 0.5)
      oppNameT.x = OPP_CARD_X + 14
      oppNameT.y = OPP_CARD_Y + 60
      panel.addChild(oppNameT)

      const oppHpT = new Text({
        text: `❤️ ${opponentHp}/${session.initialHp}`,
        style: { fill: 0xff9999, fontSize: 20 },
      })
      oppHpT.anchor.set(0, 0.5)
      oppHpT.x = OPP_CARD_X + 14 + oppNameT.width + 16
      oppHpT.y = OPP_CARD_Y + 60
      panel.addChild(oppHpT)

      if (opponentLastSnap) {
        const oppSnapT = new Text({
          text: `${opponentLastSnap.entities.length} 单位（上轮）`,
          style: { fill: 0x6688aa, fontSize: 18 },
        })
        oppSnapT.anchor.set(1, 0.5)
        oppSnapT.x = OPP_CARD_X + ROW_W - 14
        oppSnapT.y = OPP_CARD_Y + 60
        panel.addChild(oppSnapT)
      }
    } else {
      // 对手未知（轮空/镜像尚未到达）：显示占位，等待 onOpponentKnown 触发刷新
      const oppPendingT = new Text({
        text: '对手信息加载中...',
        style: { fill: 0x556688, fontSize: 20 },
      })
      oppPendingT.anchor.set(0, 0.5)
      oppPendingT.x = OPP_CARD_X + 14
      oppPendingT.y = OPP_CARD_Y + OPPONENT_CARD_H / 2
      panel.addChild(oppPendingT)
    }

    // ── 玩家列表 ──
    const ROW_H = 76
    const ROW_GAP = 8
    let cursorY = OPP_CARD_Y + OPPONENT_CARD_H + 14

    alivePlayers.forEach((player) => {
      const isReady = readySet.has(player.index)
      const isMe = player.index === session.myIndex
      const hasSnap = !!snapshots[player.index]

      const rowCon = new Container()
      rowCon.x = PANEL_X + 16
      rowCon.y = cursorY

      // 行背景
      const rowBg = new Graphics()
      rowBg.roundRect(0, 0, ROW_W, ROW_H, 12)
        .fill({ color: isMe ? 0x14102a : (isReady ? 0x0d1e12 : 0x10192a) })
      rowBg.roundRect(0, 0, ROW_W, ROW_H, 12)
        .stroke({ color: isMe ? 0x6644aa : (isReady ? 0x336644 : 0x1c2e44), width: 1 })
      rowCon.addChild(rowBg)

      // 就绪状态图标
      const iconT = new Text({
        text: isReady ? '✅' : '⏳',
        style: { fontSize: 28 },
      })
      iconT.anchor.set(0.5, 0.5)
      iconT.x = 28
      iconT.y = ROW_H / 2
      rowCon.addChild(iconT)

      // 名字
      const nameT = new Text({
        text: player.nickname + (isMe ? ' (我)' : ''),
        style: {
          fill: isMe ? 0xffd86b : (isReady ? 0x88eebb : 0xccddf0),
          fontSize: 26,
          fontWeight: isMe ? 'bold' : 'normal',
        },
      })
      nameT.anchor.set(0, 0.5)
      nameT.x = 56
      nameT.y = ROW_H / 2
      rowCon.addChild(nameT)

      // 右侧按钮区
      const BTN_W = 88
      const BTN_H = 40
      const btnX = ROW_W - BTN_W - 10

      if (!isMe && !isReady) {
        // 臭鸡蛋按钮（无冷却，可无限扔）
        const urgeBtnCon = new Container()
        urgeBtnCon.x = btnX
        urgeBtnCon.y = (ROW_H - BTN_H) / 2

        const urgeBg = new Graphics()
        urgeBg.roundRect(0, 0, BTN_W, BTN_H, 10)
          .fill({ color: 0x3a3010, alpha: 0.95 })
        urgeBg.roundRect(0, 0, BTN_W, BTN_H, 10)
          .stroke({ color: 0xaaaa22, width: 1.5 })
        urgeBtnCon.addChild(urgeBg)

        const urgeT = new Text({
          text: '🥚 扔蛋',
          style: {
            fill: 0xffee55,
            fontSize: 20,
            fontWeight: 'bold',
          },
        })
        urgeT.anchor.set(0.5, 0.5)
        urgeT.x = BTN_W / 2
        urgeT.y = BTN_H / 2
        urgeBtnCon.addChild(urgeT)

        urgeBtnCon.eventMode = 'static'
        urgeBtnCon.cursor = 'pointer'
        urgeBtnCon.on('pointerdown', (e) => {
          e.stopPropagation()
          PvpContext.sendUrge(player.index)
          // 按钮弹跳
          let bounceElapsed = 0
          const bounceTick = (ticker: { deltaMS: number }): void => {
            bounceElapsed += ticker.deltaMS
            const t = Math.min(1, bounceElapsed / 220)
            const scale = t < 0.4 ? 1 - 0.22 * (t / 0.4) : 0.78 + 0.22 * ((t - 0.4) / 0.6)
            urgeBtnCon.scale.set(scale)
            if (t >= 1) { Ticker.shared.remove(bounceTick); urgeBtnCon.scale.set(1) }
          }
          Ticker.shared.add(bounceTick)
          // 飞蛋特效：从按钮中心飞出
          const btnStageX = rowCon.x + btnX + BTN_W / 2
          const btnStageY = rowCon.y + ROW_H / 2
          this.spawnFloatingEggFx(getApp().stage, btnStageX, btnStageY)
        })
        urgeBtnCon.on('pointerover', () => { urgeBg.alpha = 0.75 })
        urgeBtnCon.on('pointerout', () => { urgeBg.alpha = 1 })
        rowCon.addChild(urgeBtnCon)
      } else if (!isMe && hasSnap) {
        // 偷看阵容按钮（已就绪 or 自己）
        const peekBtnCon = new Container()
        peekBtnCon.x = btnX
        peekBtnCon.y = (ROW_H - BTN_H) / 2

        const peekBg = new Graphics()
        peekBg.roundRect(0, 0, BTN_W, BTN_H, 10)
          .fill({ color: 0x0f2238, alpha: 0.95 })
        peekBg.roundRect(0, 0, BTN_W, BTN_H, 10)
          .stroke({ color: 0x2255aa, width: 1.5 })
        peekBtnCon.addChild(peekBg)

        const peekT = new Text({
          text: '看阵容 👀',
          style: { fill: 0x5599ee, fontSize: 18, fontWeight: 'bold' },
        })
        peekT.anchor.set(0.5, 0.5)
        peekT.x = BTN_W / 2
        peekT.y = BTN_H / 2
        peekBtnCon.addChild(peekT)

        peekBtnCon.eventMode = 'static'
        peekBtnCon.cursor = 'pointer'
        peekBtnCon.on('pointerdown', (e) => {
          e.stopPropagation()
          this.pvpPlayerListExpandedIndex = this.pvpPlayerListExpandedIndex === player.index ? -1 : player.index
          this.openPvpPlayerListOverlay()
        })
        peekBtnCon.on('pointerover', () => { peekBg.alpha = 0.75 })
        peekBtnCon.on('pointerout', () => { peekBg.alpha = 1 })
        rowCon.addChild(peekBtnCon)
      }

      panel.addChild(rowCon)
      cursorY += ROW_H + ROW_GAP
    })

    // ── 底部按钮：查看全员阵容 + 查看我的背包 ──
    const BTN_Y = cursorY + 12
    const HALF_BTN_W = Math.floor((ROW_W - 12) / 2)
    const BTN_H = 52

    // 查看全员阵容
    const viewAllCon = new Container()
    const viewAllBg = new Graphics()
    viewAllBg.roundRect(0, 0, HALF_BTN_W, BTN_H, 10).fill({ color: 0x0e1d35 })
    viewAllBg.roundRect(0, 0, HALF_BTN_W, BTN_H, 10).stroke({ color: 0x3355aa, width: 1.5 })
    viewAllCon.addChild(viewAllBg)
    const viewAllT = new Text({ text: '查看全员阵容', style: { fill: 0x5588dd, fontSize: 19, fontWeight: 'bold' } })
    viewAllT.anchor.set(0.5, 0.5)
    viewAllT.x = HALF_BTN_W / 2
    viewAllT.y = BTN_H / 2
    viewAllCon.addChild(viewAllT)
    viewAllCon.x = PANEL_X + 16
    viewAllCon.y = BTN_Y
    viewAllCon.eventMode = 'static'
    viewAllCon.cursor = 'pointer'
    viewAllCon.on('pointerdown', (e) => { e.stopPropagation(); this.openPvpPlayerListOverlay() })
    viewAllCon.on('pointerover', () => { viewAllBg.alpha = 0.75 })
    viewAllCon.on('pointerout', () => { viewAllBg.alpha = 1 })
    panel.addChild(viewAllCon)

    // 查看我的背包
    const bpViewCon = new Container()
    const bpViewBg = new Graphics()
    bpViewBg.roundRect(0, 0, HALF_BTN_W, BTN_H, 10).fill({ color: 0x0e2218 })
    bpViewBg.roundRect(0, 0, HALF_BTN_W, BTN_H, 10).stroke({ color: 0x226644, width: 1.5 })
    bpViewCon.addChild(bpViewBg)
    const bpViewT = new Text({ text: '查看我的背包', style: { fill: 0x44bb88, fontSize: 19, fontWeight: 'bold' } })
    bpViewT.anchor.set(0.5, 0.5)
    bpViewT.x = HALF_BTN_W / 2
    bpViewT.y = BTN_H / 2
    bpViewCon.addChild(bpViewT)
    bpViewCon.x = PANEL_X + 16 + HALF_BTN_W + 12
    bpViewCon.y = BTN_Y
    bpViewCon.eventMode = 'static'
    bpViewCon.cursor = 'pointer'
    bpViewCon.on('pointerdown', (e) => { e.stopPropagation(); this.showBackpackFromWaitingPanel() })
    bpViewCon.on('pointerover', () => { bpViewBg.alpha = 0.75 })
    bpViewCon.on('pointerout', () => { bpViewBg.alpha = 1 })
    panel.addChild(bpViewCon)
  }

  // ── 本轮对手徽章（可重复调用：先销毁旧的，再按当前 session 状态重建）──
  buildPvpOpponentBadge(): void {
    const ctx = this.ctx
    const { stage } = getApp()
    if (ctx.pvpOpponentBadge) {
      stage.removeChild(ctx.pvpOpponentBadge)
      ctx.pvpOpponentBadge.destroy({ children: true })
      ctx.pvpOpponentBadge = null
    }

    const sess = PvpContext.getSession()
    if (!sess) return

    const aliveForBadge = sess.players.filter(p => !sess.eliminatedPlayers.includes(p.index))
    const aliveIdxForBadge = aliveForBadge.map(p => p.index)
    const oppIdxForBadge = sess.currentOpponentPlayerIndex
      ?? getOpponentFromAlive(sess.myIndex, aliveIdxForBadge, sess.currentDay - 1)
    if (oppIdxForBadge < 0) return

    const oppForBadge = sess.players.find(p => p.index === oppIdxForBadge)
    if (!oppForBadge) return

    const oppHpForBadge = sess.playerHps?.[oppIdxForBadge] ?? sess.initialHp
    const BW = 138, BH = 54
    const badge = new Container()
    badge.zIndex = 96

    const badgeGlow = new Graphics()
    badgeGlow.roundRect(-1, -1, BW + 2, BH + 2, 13).fill({ color: 0x9966ff, alpha: 0.18 })
    badge.addChild(badgeGlow)

    const badgeBg = new Graphics()
    badgeBg.roundRect(0, 0, BW, BH, 12).fill({ color: 0x0d1020 })
    badgeBg.roundRect(0, 0, BW, BH, 12).stroke({ color: 0x7755cc, width: 1.5 })
    badgeBg.roundRect(2, 2, BW - 4, BH / 2 - 2, 10).fill({ color: 0xffffff, alpha: 0.04 })
    badge.addChild(badgeBg)

    const labelT = new Text({ text: '本轮对手', style: { fill: 0x9977cc, fontSize: 13 } })
    labelT.anchor.set(0, 0.5)
    labelT.x = 10
    labelT.y = 15
    badge.addChild(labelT)

    const hpT = new Text({ text: `♥ ${oppHpForBadge}/${sess.initialHp}`, style: { fill: 0xff7777, fontSize: 13, fontWeight: 'bold' } })
    hpT.anchor.set(1, 0.5)
    hpT.x = BW - 10
    hpT.y = 15
    badge.addChild(hpT)

    const divG = new Graphics()
    divG.rect(8, 27, BW - 16, 1).fill({ color: 0x4433aa, alpha: 0.7 })
    badge.addChild(divG)

    const nameT = new Text({ text: oppForBadge.nickname, style: { fill: 0xeeddff, fontSize: 20, fontWeight: 'bold' } })
    nameT.anchor.set(0.5, 0.5)
    nameT.x = BW / 2
    nameT.y = 41
    badge.addChild(nameT)

    badge.x = CANVAS_W - BW - 8
    badge.y = 94
    badge.eventMode = 'static'
    badge.cursor = 'pointer'
    badge.on('pointerdown', () => this.openPvpPlayerListOverlay())
    badge.on('pointerover', () => { badge.alpha = 0.8 })
    badge.on('pointerout', () => { badge.alpha = 1 })

    ctx.pvpOpponentBadge = badge
    stage.addChild(badge)
  }

  // ── 对手英雄立绘背景层（PVP 商店阶段，半透明置底）──
  async buildPvpOpponentHeroLayer(): Promise<void> {
    const ctx = this.ctx
    const { stage } = getApp()
    if (ctx.pvpOpponentHeroLayer) {
      stage.removeChild(ctx.pvpOpponentHeroLayer)
      ctx.pvpOpponentHeroLayer.destroy({ children: true })
      ctx.pvpOpponentHeroLayer = null
    }

    const sess = PvpContext.getSession()
    if (!sess) return

    // 获取对手 index（与 badge 逻辑保持一致）
    const aliveIdx = sess.players
      .filter(p => !sess.eliminatedPlayers.includes(p.index))
      .map(p => p.index)
    const oppIdx = sess.currentOpponentPlayerIndex
      ?? getOpponentFromAlive(sess.myIndex, aliveIdx, sess.currentDay - 1)

    const lastSnaps = PvpContext.getLastPlayerSnapshots()
    const heroId = lastSnaps[oppIdx]?.ownerHeroId

    if (oppIdx < 0 || !heroId) return

    // 对手昵称和 HP（供立绘下方标签使用）
    const oppPlayer = sess.players.find(p => p.index === oppIdx)
    const oppHp = sess.playerHps?.[oppIdx] ?? sess.initialHp

    try {
      const tex = await Assets.load<Texture>(`/resource/hero/${heroId}.png`)
      // 场景已切换则丢弃
      if (!PvpContext.isActive()) return

      const layer = new Container()
      layer.zIndex = 5
      layer.eventMode = 'none'

      // 立绘：上移到石墙区，放大，更不透明
      const sprite = new Sprite(tex)
      sprite.anchor.set(0.5, 1)
      const maxW = 310
      if (sprite.width > maxW) sprite.scale.set(maxW / tex.width)
      sprite.x = CANVAS_W / 2
      sprite.y = 520   // 石墙/沙地分界处
      sprite.alpha = 0.5
      layer.addChild(sprite)

      // 对手昵称 + HP 标签（立绘上方）
      if (oppPlayer) {
        const labelY = sprite.y - sprite.height - 44
        const nameBg = new Graphics()
        nameBg.roundRect(-90, 0, 180, 40, 10).fill({ color: 0x0d0d1a, alpha: 0.65 })
        nameBg.x = CANVAS_W / 2
        nameBg.y = labelY
        layer.addChild(nameBg)

        const nameT = new Text({
          text: `${oppPlayer.nickname}  ♥${oppHp}`,
          style: { fill: 0xffdde0, fontSize: 20, fontWeight: 'bold', align: 'center' },
        })
        nameT.anchor.set(0.5, 0)
        nameT.x = CANVAS_W / 2
        nameT.y = labelY + 3
        layer.addChild(nameT)
      }

      ctx.pvpOpponentHeroLayer = layer
      stage.addChild(layer)
    } catch {
      // 贴图加载失败静默忽略
    }
  }

  // ── 查看背包（等待面板临时隐藏，展示背包，浮层返回按钮）──
  showBackpackFromWaitingPanel(): void {
    const ctx = this.ctx
    if (!ctx.pvpWaitingPanel) return
    ctx.pvpWaitingPanel.visible = false
    if (ctx.backpackView) ctx.backpackView.visible = true

    // 清理旧返回按钮
    if (ctx.pvpBackpackReturnBtn) {
      ctx.pvpBackpackReturnBtn.parent?.removeChild(ctx.pvpBackpackReturnBtn)
      ctx.pvpBackpackReturnBtn.destroy({ children: true })
      ctx.pvpBackpackReturnBtn = null
    }

    const { stage } = getApp()
    const returnBtn = new Container()
    returnBtn.zIndex = 300

    const btnBg = new Graphics()
    btnBg.roundRect(0, 0, 300, 72, 16).fill({ color: 0x1a0a2e })
    btnBg.roundRect(0, 0, 300, 72, 16).stroke({ color: 0x7755cc, width: 2 })
    returnBtn.addChild(btnBg)

    const btnT = new Text({ text: '← 返回等待面板', style: { fill: 0xbb99ff, fontSize: 22, fontWeight: 'bold' } })
    btnT.anchor.set(0.5, 0.5)
    btnT.x = 150
    btnT.y = 36
    returnBtn.addChild(btnT)

    returnBtn.x = (CANVAS_W - 300) / 2
    returnBtn.y = CANVAS_H - 112
    returnBtn.eventMode = 'static'
    returnBtn.cursor = 'pointer'
    returnBtn.on('pointerdown', () => {
      if (ctx.pvpBackpackReturnBtn) {
        ctx.pvpBackpackReturnBtn.parent?.removeChild(ctx.pvpBackpackReturnBtn)
        ctx.pvpBackpackReturnBtn.destroy({ children: true })
        ctx.pvpBackpackReturnBtn = null
      }
      if (ctx.pvpWaitingPanel) ctx.pvpWaitingPanel.visible = true
    })
    returnBtn.on('pointerover', () => { btnBg.alpha = 0.8 })
    returnBtn.on('pointerout', () => { btnBg.alpha = 1 })

    ctx.pvpBackpackReturnBtn = returnBtn
    stage.addChild(returnBtn)
  }
}

// ============================================================
// PVP 结束后清理残留的 in-memory 状态，防止 PVP 存档污染 PVE 商店
// 由 PvpContext.endSession() 调用
// ============================================================
export function clearPvpShopState(ctx: ShopSceneCtx): void {
  ctx.savedShopState = null
  ctx.pendingBattleTransition = false
  ctx.pendingAdvanceToNextDay = false
  ctx.pvpReadyLocked = false
  if (ctx.pvpBackpackReturnBtn) {
    ctx.pvpBackpackReturnBtn.parent?.removeChild(ctx.pvpBackpackReturnBtn)
    ctx.pvpBackpackReturnBtn.destroy({ children: true })
    ctx.pvpBackpackReturnBtn = null
  }
}
