// ============================================================
// MenuScene — 启动菜单（PVE / PVP 模式选择）
// ============================================================

import type { Scene } from './SceneManager'
import { SceneManager } from './SceneManager'
import { getApp } from '@/core/AppContext'
import { Container, Graphics, Text } from 'pixi.js'
import type { PvpMode } from '@/pvp/PvpTypes'
import { setPvpLobbyMode } from '@/scenes/PvpLobbyScene'

const CANVAS_W = 640
const CANVAS_H = 1384

let root: Container | null = null
let fadeAlpha = 0
let fadeIn = true

// ----------------------------------------------------------------
// 绘制工具
// ----------------------------------------------------------------

function drawDecoLine(g: Graphics, cx: number, y: number, w: number, color: number): void {
  // 中间粗两端细的装饰线
  g.rect(cx - w / 2, y - 1, w, 2).fill({ color, alpha: 0.6 })
  g.rect(cx - 16, y - 2, 32, 4).fill({ color, alpha: 1 })
}

function makeBtn(
  label: string,
  subLabel: string,
  iconColor: number,
  bgColor: number,
  borderColor: number,
  y: number,
  onClick: () => void,
): Container {
  const con = new Container()
  con.x = CANVAS_W / 2
  con.y = y

  const W = 480, H = 120, R = 20

  // 外边框光效
  const glow = new Graphics()
  glow.roundRect(-W / 2 - 2, -H / 2 - 2, W + 4, H + 4, R + 2).fill({ color: borderColor, alpha: 0.35 })
  con.addChild(glow)

  // 主背景
  const bg = new Graphics()
  bg.roundRect(-W / 2, -H / 2, W, H, R).fill({ color: bgColor })
  con.addChild(bg)

  // 左侧色块装饰
  const accent = new Graphics()
  accent.roundRect(-W / 2, -H / 2, 8, H, R).fill({ color: iconColor })
  // clip right side of accent
  accent.roundRect(-W / 2, -H / 2, 8, H, 0).fill({ color: iconColor })
  con.addChild(accent)

  // 主标题
  const main = new Text({
    text: label,
    style: { fill: 0xffffff, fontSize: 38, fontWeight: 'bold', align: 'left' },
  })
  main.anchor.set(0, 0.5)
  main.x = -W / 2 + 30
  main.y = -14
  con.addChild(main)

  // 副标题
  const sub = new Text({
    text: subLabel,
    style: { fill: 0xaabbcc, fontSize: 20, align: 'left' },
  })
  sub.anchor.set(0, 0.5)
  sub.x = -W / 2 + 30
  sub.y = 22
  con.addChild(sub)

  // 右侧箭头
  const arrow = new Text({
    text: '▶',
    style: { fill: borderColor, fontSize: 28 },
  })
  arrow.anchor.set(1, 0.5)
  arrow.x = W / 2 - 24
  arrow.y = 0
  con.addChild(arrow)

  con.eventMode = 'static'
  con.cursor = 'pointer'
  con.on('pointerdown', onClick)
  con.on('pointerover', () => { bg.alpha = 0.85 })
  con.on('pointerout', () => { bg.alpha = 1 })

  return con
}

function makePvpModeBtn(
  label: string,
  subLabel: string,
  accentColor: number,
  bgColor: number,
  y: number,
  mode: PvpMode,
): Container {
  const con = new Container()
  con.x = CANVAS_W / 2
  con.y = y

  const W = 480, H = 96, R = 16

  const glow = new Graphics()
  glow.roundRect(-W / 2 - 2, -H / 2 - 2, W + 4, H + 4, R + 2).fill({ color: accentColor, alpha: 0.28 })
  con.addChild(glow)

  const bg = new Graphics()
  bg.roundRect(-W / 2, -H / 2, W, H, R).fill({ color: bgColor })
  con.addChild(bg)

  const accent = new Graphics()
  accent.roundRect(-W / 2, -H / 2, 6, H, 0).fill({ color: accentColor })
  con.addChild(accent)

  const main = new Text({
    text: label,
    style: { fill: 0xffffff, fontSize: 28, fontWeight: 'bold', align: 'left' },
  })
  main.anchor.set(0, 0.5)
  main.x = -W / 2 + 26
  main.y = -10
  con.addChild(main)

  const sub = new Text({
    text: subLabel,
    style: { fill: 0x8899bb, fontSize: 18, align: 'left' },
  })
  sub.anchor.set(0, 0.5)
  sub.x = -W / 2 + 26
  sub.y = 20
  con.addChild(sub)

  const arrow = new Text({
    text: '▶',
    style: { fill: accentColor, fontSize: 22 },
  })
  arrow.anchor.set(1, 0.5)
  arrow.x = W / 2 - 20
  arrow.y = 0
  con.addChild(arrow)

  con.eventMode = 'static'
  con.cursor = 'pointer'
  con.on('pointerdown', () => {
    setPvpLobbyMode(mode)
    SceneManager.goto('pvp-lobby')
  })
  con.on('pointerover', () => { bg.alpha = 0.85 })
  con.on('pointerout', () => { bg.alpha = 1 })

  return con
}

// ----------------------------------------------------------------
// 场景
// ----------------------------------------------------------------

export const MenuScene: Scene = {
  name: 'menu',

  onEnter() {
    const { stage } = getApp()
    root = new Container()
    root.sortableChildren = true
    fadeAlpha = 0
    fadeIn = true

    // ── 背景 ──────────────────────────────────────────────
    const bg = new Graphics()
    bg.rect(0, 0, CANVAS_W, CANVAS_H).fill({ color: 0x0d0d1a })
    root.addChild(bg)

    // 背景装饰圆圈（低调的几何感）
    const deco = new Graphics()
    // 大圆背景光
    deco.circle(CANVAS_W / 2, CANVAS_H * 0.3, 280).fill({ color: 0x1a1f3d, alpha: 0.6 })
    deco.circle(CANVAS_W / 2, CANVAS_H * 0.3, 200).fill({ color: 0x1e2445, alpha: 0.5 })
    // 小装饰点
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2
      const r = 260
      const x = CANVAS_W / 2 + Math.cos(angle) * r
      const y = CANVAS_H * 0.3 + Math.sin(angle) * r
      deco.circle(x, y, 3).fill({ color: 0xffd86b, alpha: 0.3 })
    }
    root.addChild(deco)

    // ── 标题区 ────────────────────────────────────────────
    const titleCon = new Container()
    titleCon.x = CANVAS_W / 2
    titleCon.y = CANVAS_H * 0.28

    const titleGlow = new Graphics()
    titleGlow.roundRect(-180, -50, 360, 100, 8).fill({ color: 0xffd86b, alpha: 0.06 })
    titleCon.addChild(titleGlow)

    const titleText = new Text({
      text: '大巴扎',
      style: { fill: 0xffd86b, fontSize: 80, fontWeight: 'bold', align: 'center' },
    })
    titleText.anchor.set(0.5, 0.5)
    titleCon.addChild(titleText)

    const subtitleText = new Text({
      text: 'B I G  B A Z Z A R',
      style: { fill: 0x8899bb, fontSize: 20, align: 'center' },
    })
    subtitleText.anchor.set(0.5, 0)
    subtitleText.y = 52
    titleCon.addChild(subtitleText)

    root.addChild(titleCon)

    // 装饰分割线
    const decoG = new Graphics()
    drawDecoLine(decoG, CANVAS_W / 2, CANVAS_H * 0.44, 200, 0xffd86b)
    root.addChild(decoG)

    // ── 模式标签 ──────────────────────────────────────────
    const modeLabel = new Text({
      text: '选择游戏模式',
      style: { fill: 0x6677aa, fontSize: 22, align: 'center' },
    })
    modeLabel.anchor.set(0.5, 0)
    modeLabel.x = CANVAS_W / 2
    modeLabel.y = CANVAS_H * 0.46
    root.addChild(modeLabel)

    // ── 按钮 ──────────────────────────────────────────────
    const pveBtn = makeBtn(
      '冒险模式',
      '单人闯关  击败电脑  收集奖杯',
      0x4caf50,
      0x1a2e1c,
      0x4caf50,
      CANVAS_H * 0.54,
      () => SceneManager.goto('shop'),
    )
    root.addChild(pveBtn)

    // ── PVP 分区：分隔线 + 标签 ───────────────────────────
    const pvpSepY = CANVAS_H * 0.54 + 96   // 冒险模式底部下方约 36px
    const pvpSep = new Graphics()
    pvpSep.rect(CANVAS_W / 2 - 200, pvpSepY, 400, 1).fill({ color: 0x2a3a5c, alpha: 0.8 })
    pvpSep.rect(CANVAS_W / 2 - 20, pvpSepY - 1, 40, 3).fill({ color: 0x445577, alpha: 1 })
    root.addChild(pvpSep)

    const pvpLabel = new Text({
      text: '联机对战',
      style: { fill: 0x7788aa, fontSize: 20, align: 'center' },
    })
    pvpLabel.anchor.set(0.5, 0)
    pvpLabel.x = CANVAS_W / 2
    pvpLabel.y = pvpSepY + 16             // 标签顶部在分隔线下 16px
    root.addChild(pvpLabel)

    // 三个 PVP 模式按钮（标签底部约 pvpSepY+42，按钮光效顶部需留 14px 间距）
    const pvpBtn1 = makePvpModeBtn('巴扎异步对战', '经典模式 · 双方独立结算', 0x5b8def, 0x12213a, pvpSepY + 106, 'async')
    root.addChild(pvpBtn1)

    const pvpBtn2 = makePvpModeBtn('即时同步对战',   '双端同步启动 · 确定性模拟',  0x4caf50, 0x0f1f10, pvpSepY + 220, 'sync-a')
    root.addChild(pvpBtn2)

    // ── 底部 ──────────────────────────────────────────────
    const ver = new Text({
      text: 'v0.1.1',
      style: { fill: 0x6688aa, fontSize: 18 },
    })
    ver.anchor.set(1, 1)
    ver.x = CANVAS_W - 24
    ver.y = CANVAS_H - 24
    root.addChild(ver)

    // 入场动画初始透明
    root.alpha = 0

    stage.addChild(root)
  },

  onExit() {
    if (root) {
      getApp().stage.removeChild(root)
      root.destroy({ children: true })
      root = null
    }
  },

  update(dt: number) {
    if (!root || !fadeIn) return
    fadeAlpha = Math.min(1, fadeAlpha + dt * 2.5)
    root.alpha = fadeAlpha
    if (fadeAlpha >= 1) fadeIn = false
  },
}
