// ============================================================
// PvpPanel — PVP 商店阶段所有 UI 面板（玩家列表 / 等待面板 / 对手徽章 / 英雄立绘）
// 从 ShopScene.ts 提取，使用 Class 方式（继承 Container）
// ============================================================

import {
  Container, Graphics, Text, Sprite,
  Assets, Texture, Ticker,
} from 'pixi.js'
import { PvpContext } from '@/pvp/PvpContext'
import { getOpponentFromAlive, type PvpPlayer } from '@/pvp/PvpTypes'
import { getItemIconUrl } from '@/core/AssetPath'
import { getApp } from '@/core/AppContext'
import type { ShopSceneCtx } from '../ShopSceneContext'
import { CANVAS_W, CANVAS_H } from '@/config/layoutConstants'

// ============================================================
// PvpPanel class
// ============================================================

// ---- 侧边玩家卡片布局常量 ----
const SIDE_CARD_W = 84
const SIDE_CARD_H = 148
const SIDE_CARD_GAP = 8
const SIDE_PORTRAIT_H = 110

export class PvpPanel extends Container {
  private ctx: ShopSceneCtx
  private pvpPlayerListExpandedIndex = -1
  private pvpSideCardMeta = new Map<number, { readyOverlay: Graphics; portraitH: number }>()
  private pvpSnapshotBubble: Container | null = null
  private pvpSnapshotBubbleBackdrop: Graphics | null = null
  private pvpAllPlayersLayerVersion = 0

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

      // 排名序号（左侧小列）
      const rankT = new Text({
        text: String(i + 1),
        style: { fill: eliminated ? 0x445566 : 0x5577aa, fontSize: 16, fontWeight: 'bold' },
      })
      rankT.anchor.set(0.5, 0.5)
      rankT.x = 18
      rankT.y = 20
      rowCon.addChild(rankT)

      // 英雄头像（异步加载）
      const AVATAR_SIZE = 52
      const avatarSpr = new Sprite(Texture.WHITE)
      avatarSpr.width = AVATAR_SIZE
      avatarSpr.height = AVATAR_SIZE
      avatarSpr.x = 6
      avatarSpr.y = (ROW_H - AVATAR_SIZE) / 2
      avatarSpr.alpha = eliminated ? 0.35 : 0.9
      rowCon.addChild(avatarSpr)
      const heroId = snapshots[player.index]?.ownerHeroId
      if (heroId) {
        void Assets.load<Texture>(`/resource/hero/${heroId}icon.png`).then((tex) => {
          if (!avatarSpr.destroyed) avatarSpr.texture = tex
        }).catch(() => { /* 静默忽略缺失贴图 */ })
      }

      // ── 左侧内容（昵称 + 状态）── 向右移以容纳头像
      const nameT = new Text({
        text: player.nickname + (isMe ? ' (我)' : ''),
        style: {
          fill: isMe ? 0xffd86b : (eliminated ? 0x445566 : 0xccddf0),
          fontSize: 26,
          fontWeight: isMe ? 'bold' : 'normal',
        },
      })
      nameT.anchor.set(0, 0)
      nameT.x = 66
      nameT.y = 14
      rowCon.addChild(nameT)

      const gold = snapshots[player.index]?.playerGold
      const goldStr = gold !== undefined ? `  💰 ${gold}G` : ''
      const statusT = new Text({
        text: (eliminated ? '已淘汰' : '存活中') + goldStr,
        style: { fill: eliminated ? 0x665544 : 0x4a9966, fontSize: 17 },
      })
      statusT.anchor.set(0, 0)
      statusT.x = 66
      statusT.y = 50
      rowCon.addChild(statusT)

      if (hasSnap && !eliminated) {
        const hintT = new Text({
          text: isExpanded ? '收起 ▴' : '查看阵容 ▾',
          style: { fill: 0x4488cc, fontSize: 17 },
        })
        hintT.anchor.set(0, 0)
        hintT.x = 66
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
    // 等待计数只统计在线玩家（断线玩家不再阻塞战斗，不应计入等待分母）
    const onlineAlive = alivePlayers.filter(p => p.connected || p.index === session.myIndex)
    const totalAlive = onlineAlive.length
    const readyCount = onlineAlive.filter(p => readySet.has(p.index)).length

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
      const isOffline = !player.connected && !isMe
      const hasSnap = !!snapshots[player.index]

      const rowCon = new Container()
      rowCon.x = PANEL_X + 16
      rowCon.y = cursorY

      // 行背景
      const rowBg = new Graphics()
      rowBg.roundRect(0, 0, ROW_W, ROW_H, 12)
        .fill({ color: isMe ? 0x14102a : isOffline ? 0x1a1818 : (isReady ? 0x0d1e12 : 0x10192a) })
      rowBg.roundRect(0, 0, ROW_W, ROW_H, 12)
        .stroke({ color: isMe ? 0x6644aa : isOffline ? 0x555555 : (isReady ? 0x336644 : 0x1c2e44), width: 1 })
      rowCon.addChild(rowBg)

      // 就绪状态图标
      const iconT = new Text({
        text: isReady ? '✅' : isOffline ? '📵' : '⏳',
        style: { fontSize: 28 },
      })
      iconT.anchor.set(0.5, 0.5)
      iconT.x = 28
      iconT.y = ROW_H / 2
      rowCon.addChild(iconT)

      // 名字
      const nameT = new Text({
        text: player.nickname + (isMe ? ' (我)' : isOffline ? ' (已断线)' : ''),
        style: {
          fill: isMe ? 0xffd86b : isOffline ? 0x888888 : (isReady ? 0x88eebb : 0xccddf0),
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

      if (!isMe && !isReady && !isOffline) {
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

  // ── 本轮对手徽章已移除：对手信息由英雄立绘背景层中央标签展示，右上角改为玩家自身头像+等级 ──
  buildPvpOpponentBadge(): void {
    const ctx = this.ctx
    const { stage } = getApp()
    // 清理旧徽章（若存在）
    if (ctx.pvpOpponentBadge) {
      stage.removeChild(ctx.pvpOpponentBadge)
      ctx.pvpOpponentBadge.destroy({ children: true })
      ctx.pvpOpponentBadge = null
    }
  }

  // ── 全员立绘背景层（PVP 商店阶段：中央大立绘 + 两侧小卡片）──
  buildPvpAllPlayersLayer(): void {
    const ctx = this.ctx
    const { stage } = getApp()

    this.pvpAllPlayersLayerVersion++
    const version = this.pvpAllPlayersLayerVersion
    this.pvpSideCardMeta.clear()

    if (ctx.pvpAllPlayersLayer) {
      stage.removeChild(ctx.pvpAllPlayersLayer)
      ctx.pvpAllPlayersLayer.destroy({ children: true })
      ctx.pvpAllPlayersLayer = null
    }

    const sess = PvpContext.getSession()
    if (!sess) return

    const layer = new Container()
    layer.zIndex = 5
    layer.eventMode = 'passive'
    ctx.pvpAllPlayersLayer = layer
    stage.addChild(layer)

    const aliveIdx = sess.players
      .filter(p => !sess.eliminatedPlayers.includes(p.index))
      .map(p => p.index)
    const oppIdx = sess.currentOpponentPlayerIndex
      ?? getOpponentFromAlive(sess.myIndex, aliveIdx, sess.currentDay - 1)

    const lastSnaps = PvpContext.getLastPlayerSnapshots()
    const readySet = new Set(PvpContext.getSyncReadyIndices())

    // ── 中央对手大立绘（仅当有快照/heroId 时显示）──
    const oppHeroId = oppIdx >= 0 ? lastSnaps[oppIdx]?.ownerHeroId : undefined
    const oppPlayer = oppIdx >= 0 ? sess.players.find(p => p.index === oppIdx) : null
    const oppHp = oppIdx >= 0 ? (sess.playerHps?.[oppIdx] ?? sess.initialHp) : 0

    if (oppHeroId) {
      const oppSprite = new Sprite(Texture.WHITE)
      oppSprite.anchor.set(0.5, 1)
      oppSprite.x = CANVAS_W / 2
      oppSprite.y = 520
      oppSprite.alpha = 0
      layer.addChild(oppSprite)

      const oppLevel = sess.playerLevels?.[oppIdx]

      void Assets.load<Texture>(`/resource/hero/${oppHeroId}.png`).then((tex) => {
        if (version !== this.pvpAllPlayersLayerVersion || !PvpContext.isActive()) return
        const maxW = 310
        if (tex.width > maxW) oppSprite.scale.set(maxW / tex.width)
        oppSprite.texture = tex
        oppSprite.alpha = 0.5

        if (oppPlayer) {
          const topY = oppSprite.y - oppSprite.height  // 立绘顶端
          const bottomY = oppSprite.y                   // 立绘底端

          // 顶部：昵称（白字，无背景）
          const oppNicknameT = new Text({
            text: oppPlayer.nickname,
            style: {
              fill: 0xffffff,
              fontSize: 20,
              fontWeight: 'bold',
              stroke: { color: 0x000000, width: 3 },
              align: 'center',
            },
          })
          oppNicknameT.anchor.set(0.5, 1)
          oppNicknameT.x = CANVAS_W / 2
          oppNicknameT.y = topY - 2
          layer.addChild(oppNicknameT)

          // 底部：等级（白字）+ 血量（红字）
          const lvStr = oppLevel !== undefined ? `Lv${oppLevel}` : ''
          const oppLvT = new Text({
            text: lvStr,
            style: { fill: 0xffffff, fontSize: 18, fontWeight: 'bold', stroke: { color: 0x000000, width: 3 } },
          })
          const oppHpT = new Text({
            text: `♥${oppHp}`,
            style: { fill: 0xff6666, fontSize: 18, fontWeight: 'bold', stroke: { color: 0x000000, width: 3 } },
          })
          const bottomGap = 8
          if (lvStr) {
            const combinedW = oppLvT.width + bottomGap + oppHpT.width
            const startX = CANVAS_W / 2 - combinedW / 2
            oppLvT.anchor.set(0, 0)
            oppLvT.x = startX
            oppLvT.y = bottomY - 15
            oppHpT.anchor.set(0, 0)
            oppHpT.x = startX + oppLvT.width + bottomGap
            oppHpT.y = bottomY - 15
            layer.addChild(oppLvT)
          } else {
            oppHpT.anchor.set(0.5, 0)
            oppHpT.x = CANVAS_W / 2
            oppHpT.y = bottomY - 15
          }
          layer.addChild(oppHpT)

          // 对手上局上阵物品：直接显示在立绘下方
          const oppItems = (oppIdx >= 0 ? lastSnaps[oppIdx] : undefined)?.entities.filter(e => e.defId) ?? []
          if (oppItems.length > 0) {
            const ITEM_SIZE = 32
            const ITEM_GAP = 5
            const rowW = oppItems.length * ITEM_SIZE + (oppItems.length - 1) * ITEM_GAP
            const rowStartX = CANVAS_W / 2 - rowW / 2
            const rowY = bottomY + 8  // 立绘底端下方
            oppItems.forEach((entity, i) => {
              const ix = rowStartX + i * (ITEM_SIZE + ITEM_GAP)
              const iconBg = new Graphics()
              iconBg.roundRect(ix, rowY, ITEM_SIZE, ITEM_SIZE, 5).fill({ color: 0x0d1520, alpha: 0.75 })
              layer.addChild(iconBg)
              void Assets.load<Texture>(getItemIconUrl(entity.defId)).then((tex: Texture) => {
                if (version !== this.pvpAllPlayersLayerVersion || !PvpContext.isActive()) return
                const spr = new Sprite(tex)
                spr.x = ix; spr.y = rowY
                spr.width = ITEM_SIZE; spr.height = ITEM_SIZE
                layer.addChild(spr)
              }).catch(() => {})
            })
          }
        }
      }).catch(() => {})
    }

    // ── 侧边其他玩家小卡片 ──
    const LEFT_X = 8
    const RIGHT_X = CANVAS_W - 8 - SIDE_CARD_W
    // SAFE_TOP：设置按钮下方，避免卡片进入顶部 UI 区域
    // SAFE_BOTTOM：避免卡片延伸到玩家头像区域
    const SAFE_TOP = 160
    const SAFE_BOTTOM = 460
    const safeAreaH = SAFE_BOTTOM - SAFE_TOP

    const otherPlayers = sess.players.filter(p => p.index !== sess.myIndex && p.index !== oppIdx)
    const leftPlayers = otherPlayers.filter((_, i) => i % 2 === 0)
    const rightPlayers = otherPlayers.filter((_, i) => i % 2 === 1)

    // 人数多时动态缩小卡片，使所有卡片都在安全区内不重叠玩家头像
    const maxSideCount = Math.max(leftPlayers.length, rightPlayers.length, 1)
    const dynCardH = Math.max(80, Math.min(SIDE_CARD_H, Math.floor((safeAreaH - (maxSideCount - 1) * SIDE_CARD_GAP) / maxSideCount)))
    const dynPortraitH = Math.round(dynCardH * SIDE_PORTRAIT_H / SIDE_CARD_H)

    const getStartY = (count: number): number => {
      if (count === 0) return SAFE_TOP
      const totalH = count * dynCardH + (count - 1) * SIDE_CARD_GAP
      return SAFE_TOP + Math.max(0, (safeAreaH - totalH) / 2)
    }

    const buildSideCard = (player: PvpPlayer, x: number, y: number): void => {
      const heroId = lastSnaps[player.index]?.ownerHeroId
      // Day 1 无快照时不渲染（无立绘则整张卡不显示）
      if (!heroId) return

      const hp = sess.playerHps?.[player.index] ?? 0
      const isElim = sess.eliminatedPlayers.includes(player.index)
      const isReady = readySet.has(player.index)
      const level = sess.playerLevels?.[player.index]

      const cardCon = new Container()
      cardCon.x = x
      cardCon.y = y
      cardCon.eventMode = 'static'
      cardCon.cursor = 'pointer'
      layer.addChild(cardCon)

      // 立绘（按宽高均适配 SIDE_PORTRAIT_H，不溢出）
      const portrait = new Sprite(Texture.WHITE)
      portrait.alpha = 0
      portrait.anchor.set(0.5, 0)
      portrait.x = SIDE_CARD_W / 2
      portrait.y = 0
      cardCon.addChild(portrait)

      // 立绘顶部：昵称（白字）
      const shortName = player.nickname.length > 5 ? player.nickname.slice(0, 4) + '…' : player.nickname
      const nameT = new Text({
        text: shortName,
        style: {
          fill: isElim ? 0x888888 : 0xffffff,
          fontSize: 12,
          fontWeight: 'bold',
          stroke: { color: 0x000000, width: 3 },
        },
      })
      nameT.anchor.set(0.5, 1)
      nameT.x = SIDE_CARD_W / 2
      nameT.y = -3
      cardCon.addChild(nameT)

      // 立绘底部：等级（白字）+ 血量（红字）—— 在图片加载后用真实高度定位
      const lvStr = level !== undefined ? `Lv${level}` : ''
      const lvT = lvStr ? new Text({
        text: lvStr,
        style: {
          fill: isElim ? 0x888888 : 0xffffff,
          fontSize: 11,
          fontWeight: 'bold',
          stroke: { color: 0x000000, width: 2.5 },
        },
      }) : null
      const hpT = new Text({
        text: `♥${hp}`,
        style: {
          fill: isElim ? 0x887777 : 0xff6666,
          fontSize: 11,
          fontWeight: 'bold',
          stroke: { color: 0x000000, width: 2.5 },
        },
      })

      void Assets.load<Texture>(`/resource/hero/${heroId}.png`).then((tex) => {
        if (!portrait.destroyed && version === this.pvpAllPlayersLayerVersion) {
          portrait.texture = tex
          const scale = Math.min(SIDE_CARD_W / tex.width, dynPortraitH / tex.height)
          portrait.scale.set(scale)
          portrait.alpha = isElim ? 0.3 : 0.88
          // 紧贴真实立绘底部放置文字
          const infoY = tex.height * scale + 1
          const infoGap = 4
          if (lvT) {
            const combinedW = lvT.width + infoGap + hpT.width
            const startX = SIDE_CARD_W / 2 - combinedW / 2
            lvT.anchor.set(0, 0)
            lvT.x = startX
            lvT.y = infoY
            hpT.anchor.set(0, 0)
            hpT.x = startX + lvT.width + infoGap
            hpT.y = infoY
            cardCon.addChild(lvT)
          } else {
            hpT.anchor.set(0.5, 0)
            hpT.x = SIDE_CARD_W / 2
            hpT.y = infoY
          }
          cardCon.addChild(hpT)
        }
      }).catch(() => {})

      // 未就绪遮罩（只有自己已准备时才显示，表示在等待谁）
      const readyOverlay = new Graphics()
      if (!isElim && !isReady && readySet.has(sess.myIndex)) {
        readyOverlay.rect(0, 0, SIDE_CARD_W, dynPortraitH).fill({ color: 0x000000, alpha: 0.45 })
      }
      cardCon.addChild(readyOverlay)

      // 淘汰遮罩
      if (isElim) {
        const elimG = new Graphics()
        elimG.rect(0, 0, SIDE_CARD_W, dynPortraitH).fill({ color: 0x334455, alpha: 0.55 })
        cardCon.addChild(elimG)
        const elimFontSize = Math.max(24, Math.round(44 * dynPortraitH / SIDE_PORTRAIT_H))
        const xT = new Text({ text: '×', style: { fill: 0x4a5e6a, fontSize: elimFontSize, fontWeight: 'bold' } })
        xT.anchor.set(0.5, 0.5)
        xT.x = SIDE_CARD_W / 2
        xT.y = dynPortraitH / 2
        cardCon.addChild(xT)
      }

      // 点击：气泡展示该玩家阵容
      const isLeftCard = x < CANVAS_W / 2
      cardCon.on('pointerdown', (e) => {
        e.stopPropagation()
        this.togglePlayerSnapshotBubble(player, x, y, isLeftCard)
      })
      cardCon.on('pointerover', () => { cardCon.alpha = 0.8 })
      cardCon.on('pointerout', () => { cardCon.alpha = 1 })

      this.pvpSideCardMeta.set(player.index, { readyOverlay, portraitH: dynPortraitH })
    }

    leftPlayers.forEach((p, i) => buildSideCard(p, LEFT_X, getStartY(leftPlayers.length) + i * (dynCardH + SIDE_CARD_GAP)))
    rightPlayers.forEach((p, i) => buildSideCard(p, RIGHT_X, getStartY(rightPlayers.length) + i * (dynCardH + SIDE_CARD_GAP)))
  }

  // ── 玩家阵容气泡（点击侧边立绘弹出，再次点击或点外部关闭）──
  private closePvpSnapshotBubble(): void {
    const stage = getApp().stage
    if (this.pvpSnapshotBubble) {
      stage.removeChild(this.pvpSnapshotBubble)
      this.pvpSnapshotBubble.destroy({ children: true })
      this.pvpSnapshotBubble = null
    }
    if (this.pvpSnapshotBubbleBackdrop) {
      stage.removeChild(this.pvpSnapshotBubbleBackdrop)
      this.pvpSnapshotBubbleBackdrop.destroy()
      this.pvpSnapshotBubbleBackdrop = null
    }
  }

  private togglePlayerSnapshotBubble(player: PvpPlayer, cardX: number, cardY: number, isLeft: boolean): void {
    const stage = getApp().stage
    const sess = PvpContext.getSession()
    // 再次点击同一张卡关闭
    if (this.pvpSnapshotBubble) {
      this.closePvpSnapshotBubble()
      return
    }

    const snap = PvpContext.getLastPlayerSnapshots()[player.index]
    const hp = sess?.playerHps?.[player.index] ?? 0
    const level = sess?.playerLevels?.[player.index]
    const items = snap?.entities.filter(e => e.defId) ?? []

    const ICON_SIZE = 44
    const ICON_GAP = 5
    const PAD = 10
    const HEADER_H = 34
    const itemCount = Math.max(1, items.length)
    const BUBBLE_W = PAD * 2 + itemCount * ICON_SIZE + (itemCount - 1) * ICON_GAP
    const BUBBLE_H = HEADER_H + PAD + ICON_SIZE + PAD

    const bxRaw = isLeft ? cardX + SIDE_CARD_W + 8 : cardX - BUBBLE_W - 8
    const bx = Math.max(4, Math.min(bxRaw, CANVAS_W - BUBBLE_W - 4))
    const by = Math.max(160, Math.min(cardY, CANVAS_H - BUBBLE_H - 10))

    // 透明背景板：点击外部关闭
    const backdrop = new Graphics()
    backdrop.rect(0, 0, CANVAS_W, CANVAS_H).fill({ color: 0x000000, alpha: 0.001 })
    backdrop.eventMode = 'static'
    backdrop.zIndex = 149
    backdrop.on('pointerdown', () => this.closePvpSnapshotBubble())
    stage.addChild(backdrop)
    this.pvpSnapshotBubbleBackdrop = backdrop

    const bubble = new Container()
    bubble.zIndex = 150
    bubble.eventMode = 'static'
    bubble.on('pointerdown', (e) => e.stopPropagation())

    // 气泡背景
    const bg = new Graphics()
    bg.roundRect(bx, by, BUBBLE_W, BUBBLE_H, 10).fill({ color: 0x0d1520, alpha: 0.94 })
    bg.roundRect(bx, by, BUBBLE_W, BUBBLE_H, 10).stroke({ color: 0x2a4a6a, width: 1.2 })
    bubble.addChild(bg)

    // 标题：名字 + Lv + HP
    const headerParts = [player.nickname, level !== undefined ? `Lv${level}` : '', `♥${hp}`].filter(Boolean)
    const headerT = new Text({
      text: headerParts.join('  '),
      style: { fill: 0xddeeff, fontSize: 15, fontWeight: 'bold' },
    })
    headerT.anchor.set(0, 0.5)
    headerT.x = bx + PAD
    headerT.y = by + HEADER_H / 2
    bubble.addChild(headerT)

    // 分隔线
    const div = new Graphics()
    div.rect(bx + PAD, by + HEADER_H - 1, BUBBLE_W - PAD * 2, 1).fill({ color: 0x1e2e44 })
    bubble.addChild(div)

    if (items.length === 0) {
      const emptyT = new Text({ text: '（无阵容数据）', style: { fill: 0x446688, fontSize: 14 } })
      emptyT.anchor.set(0.5, 0.5)
      emptyT.x = bx + BUBBLE_W / 2
      emptyT.y = by + HEADER_H + PAD + ICON_SIZE / 2
      bubble.addChild(emptyT)
    }

    items.forEach((entity, i) => {
      const ix = bx + PAD + i * (ICON_SIZE + ICON_GAP)
      const iy = by + HEADER_H + PAD

      const iconBg = new Graphics()
      iconBg.roundRect(ix, iy, ICON_SIZE, ICON_SIZE, 6).fill({ color: 0x162030 })
      bubble.addChild(iconBg)

      void Assets.load<Texture>(getItemIconUrl(entity.defId)).then((tex) => {
        if (!bubble.destroyed) {
          const spr = new Sprite(tex)
          spr.x = ix; spr.y = iy
          spr.width = ICON_SIZE; spr.height = ICON_SIZE
          bubble.addChild(spr)
        }
      }).catch(() => {})
    })

    stage.addChild(bubble)
    this.pvpSnapshotBubble = bubble
  }

  // ── 就绪状态轻量刷新（仅更新未就绪遮罩）──
  refreshPvpSideCardStates(): void {
    const session = PvpContext.getSession()
    if (!session) return
    const readySet = new Set(PvpContext.getSyncReadyIndices())

    const meReady = readySet.has(session.myIndex)
    this.pvpSideCardMeta.forEach(({ readyOverlay, portraitH }, playerIndex) => {
      const isElim = session!.eliminatedPlayers.includes(playerIndex)
      const isReady = readySet.has(playerIndex)
      readyOverlay.clear()
      if (!isElim && !isReady && meReady) {
        readyOverlay.rect(0, 0, SIDE_CARD_W, portraitH).fill({ color: 0x000000, alpha: 0.45 })
      }
    })
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
  if (ctx.pvpAllPlayersLayer) {
    ctx.pvpAllPlayersLayer.parent?.removeChild(ctx.pvpAllPlayersLayer)
    ctx.pvpAllPlayersLayer.destroy({ children: true })
    ctx.pvpAllPlayersLayer = null
  }
}
