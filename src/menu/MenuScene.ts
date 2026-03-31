// ============================================================
// MenuScene — 启动菜单（合成冒险）
// ============================================================

import type { Scene } from '@/core/SceneManager'
import { SceneManager } from '@/core/SceneManager'
import { getApp } from '@/core/AppContext'
import { Container, Graphics, Text } from 'pixi.js'
import { CANVAS_W, CANVAS_H } from '@/config/layoutConstants'

let root: Container | null = null
let panel: Container | null = null
let fadeAlpha = 0
let fadeIn = true

type MenuPage = 'root' | 'other' | 'tower'
type TowerDifficulty = { label: string; scale: number }

const TOWER_DIFFICULTY_STORAGE_KEY = 'bigbazzar_tower_difficulty_scale'
const TOWER_DIFFICULTIES: TowerDifficulty[] = [
  { label: '简单', scale: 0.6 },
  { label: '普通', scale: 0.8 },
  { label: '困难', scale: 1.0 },
  { label: '极难', scale: 1.2 },
  { label: '地狱', scale: 1.4 },
]

let currentPage: MenuPage = 'root'
let selectedTowerDifficultyIndex = 2

function readTowerDifficultyIndex(): number {
  try {
    const raw = Number(localStorage.getItem(TOWER_DIFFICULTY_STORAGE_KEY) || '')
    if (!Number.isFinite(raw) || raw <= 0) return 2
    const idx = TOWER_DIFFICULTIES.findIndex((it) => Math.abs(it.scale - raw) < 1e-6)
    return idx >= 0 ? idx : 2
  } catch {
    return 2
  }
}

function persistTowerDifficulty(scale: number): void {
  try {
    localStorage.setItem(TOWER_DIFFICULTY_STORAGE_KEY, `${scale}`)
  } catch {
    // ignore
  }
}

function enterTowerMode(): void {
  const hit = TOWER_DIFFICULTIES[Math.max(0, Math.min(TOWER_DIFFICULTIES.length - 1, selectedTowerDifficultyIndex))]
  if (hit) persistTowerDifficulty(hit.scale)
  SceneManager.goto('tower-battle')
}

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
  active = false,
): Container {
  const con = new Container()
  con.x = CANVAS_W / 2
  con.y = y

  const W = 480, H = 120, R = 20

  // 外边框光效
  const glow = new Graphics()
  glow.roundRect(-W / 2 - 2, -H / 2 - 2, W + 4, H + 4, R + 2).fill({ color: borderColor, alpha: active ? 0.6 : 0.35 })
  con.addChild(glow)

  // 主背景
  const bg = new Graphics()
  bg.roundRect(-W / 2, -H / 2, W, H, R).fill({ color: bgColor, alpha: active ? 0.88 : 1 })
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
  con.on('pointerover', () => { bg.alpha = active ? 0.8 : 0.85 })
  con.on('pointerout', () => { bg.alpha = active ? 0.88 : 1 })

  return con
}

function makePvpBtn(y: number): Container {
  return makeBtn(
    '同步对战',
    '实时联机 · 同步对战',
    0x4caf50,
    0x0f1f10,
    0x4caf50,
    y,
    () => { SceneManager.goto('pvp-lobby') },
  )
}

function makeTowerDifficultySelector(y: number): Container {
  const con = new Container()
  con.x = CANVAS_W / 2
  con.y = y

  const W = 480
  const H = 124
  const R = 20

  const bg = new Graphics()
  bg.roundRect(-W / 2, -H / 2, W, H, R).fill({ color: 0x3a2413 })
  bg.roundRect(-W / 2, -H / 2, W, H, R).stroke({ color: 0xffa64d, width: 3, alpha: 0.8 })
  con.addChild(bg)

  const picked = TOWER_DIFFICULTIES[Math.max(0, Math.min(TOWER_DIFFICULTIES.length - 1, selectedTowerDifficultyIndex))]
  const title = new Text({
    text: picked?.label ?? '困难',
    style: { fill: 0xffffff, fontSize: 40, fontWeight: 'bold', align: 'center' },
  })
  title.anchor.set(0.5, 0.5)
  title.y = -12
  con.addChild(title)

  const sub = new Text({
    text: '左右切换难度',
    style: { fill: 0xffcf9b, fontSize: 20, align: 'center' },
  })
  sub.anchor.set(0.5, 0.5)
  sub.y = 24
  con.addChild(sub)

  const makeArrow = (dir: 'left' | 'right', x: number): Container => {
    const btn = new Container()
    btn.x = x
    btn.y = 0
    const hit = new Graphics()
    hit.circle(0, 0, 36).fill({ color: 0x000000, alpha: 0.001 })
    btn.addChild(hit)
    const arrow = new Text({
      text: dir === 'left' ? '◀' : '▶',
      style: { fill: 0xffa64d, fontSize: 38, fontWeight: 'bold' },
    })
    arrow.anchor.set(0.5, 0.5)
    btn.addChild(arrow)
    btn.eventMode = 'static'
    btn.cursor = 'pointer'
    btn.on('pointerdown', () => {
      const count = TOWER_DIFFICULTIES.length
      if (count <= 0) return
      selectedTowerDifficultyIndex = dir === 'left'
        ? ((selectedTowerDifficultyIndex - 1 + count) % count)
        : ((selectedTowerDifficultyIndex + 1) % count)
      rebuildPanel()
    })
    return btn
  }

  con.addChild(makeArrow('left', -W / 2 + 40))
  con.addChild(makeArrow('right', W / 2 - 40))

  return con
}

function rebuildPanel(): void {
  if (!panel) return
  panel.removeChildren().forEach((one) => one.destroy({ children: true }))

  const label = new Text({
    text: currentPage === 'root' ? '选择模式' : (currentPage === 'other' ? '其他模式' : '塔防难度'),
    style: { fill: 0x6677aa, fontSize: 22, align: 'center' },
  })
  label.anchor.set(0.5, 0)
  label.x = CANVAS_W / 2
  label.y = CANVAS_H * 0.46
  panel.addChild(label)

  if (currentPage === 'root') {
    panel.addChild(makeBtn('塔防模式', '选择难度后开始', 0xffa64d, 0x3a2413, 0xffa64d, CANVAS_H * 0.56, () => {
      currentPage = 'tower'
      rebuildPanel()
    }))
    panel.addChild(makeBtn('其他模式', '冒险 / 同步对战 / 无背包', 0x5aa6ff, 0x18243d, 0x5aa6ff, CANVAS_H * 0.56 + 144, () => {
      currentPage = 'other'
      rebuildPanel()
    }))
    return
  }

  if (currentPage === 'other') {
    panel.addChild(makeBtn('冒险模式', '单人闯关  击败电脑  收集奖杯', 0x4caf50, 0x1a2e1c, 0x4caf50, CANVAS_H * 0.54, () => {
      SceneManager.goto('shop')
    }))
    panel.addChild(makePvpBtn(CANVAS_H * 0.54 + 144))
    panel.addChild(makeBtn('无背包模式', '独立玩法  零耦合  无背包挑战', 0x5aa6ff, 0x18243d, 0x5aa6ff, CANVAS_H * 0.54 + 288, () => {
      SceneManager.goto('nobag-shop')
    }))
    panel.addChild(makeBtn('返回', '回到模式选择', 0xffd86b, 0x2b2740, 0xffd86b, CANVAS_H * 0.54 + 432, () => {
      currentPage = 'root'
      rebuildPanel()
    }))
    return
  }

  const towerBaseY = CANVAS_H * 0.58
  panel.addChild(makeTowerDifficultySelector(towerBaseY))

  panel.addChild(makeBtn('开始', '进入塔防战斗', 0x4caf50, 0x1a2e1c, 0x4caf50, towerBaseY + 148, () => {
    enterTowerMode()
  }))
  panel.addChild(makeBtn('返回', '回到模式选择', 0xffd86b, 0x2b2740, 0xffd86b, towerBaseY + 286, () => {
    currentPage = 'root'
    rebuildPanel()
  }))
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
    currentPage = 'root'
    selectedTowerDifficultyIndex = readTowerDifficultyIndex()

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
      text: '合成冒险',
      style: { fill: 0xffd86b, fontSize: 80, fontWeight: 'bold', align: 'center' },
    })
    titleText.anchor.set(0.5, 0.5)
    titleCon.addChild(titleText)

    const subtitleText = new Text({
      text: 'S Y N T H E S I S   A D V E N T U R E',
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

    panel = new Container()
    root.addChild(panel)
    rebuildPanel()

    // ── 底部 ──────────────────────────────────────────────
    const ver = new Text({
      text: 'v1.0.4',
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
      panel = null
    }
  },

  update(dt: number) {
    if (!root || !fadeIn) return
    fadeAlpha = Math.min(1, fadeAlpha + dt * 2.5)
    root.alpha = fadeAlpha
    if (fadeAlpha >= 1) fadeIn = false
  },
}
