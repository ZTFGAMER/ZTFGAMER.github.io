// ============================================================
// PvpLobbyScene — PVP 大厅
// 功能：输入昵称 → 创建/加入房间 → 等待开始
// 输入方式：PixiJS 原生显示 + 隐藏 HTML input（唤起键盘）
// ============================================================

import type { Scene } from './SceneManager'
import { SceneManager } from './SceneManager'
import { getApp } from '@/core/AppContext'
import { Container, Graphics, Text } from 'pixi.js'
import { PvpRoom } from '@/pvp/PvpRoom'
import { PvpContext } from '@/pvp/PvpContext'
import { generateRoomCode } from '@/pvp/WsConnection'
import type { PvpSession, PvpMode } from '@/pvp/PvpTypes'
import { calcTotalDays } from '@/pvp/PvpTypes'
import { registerRoom, unregisterRoom, updateRoomPlayers, fetchRooms } from '@/pvp/RoomRegistry'
import type { RoomInfo } from '@/pvp/RoomRegistry'

const CANVAS_W = 640
const CANVAS_H = 1384
const PANEL_W = 560

// ----------------------------------------------------------------
// 场景状态
// ----------------------------------------------------------------
let root: Container | null = null
let pvpRoom: PvpRoom | null = null
let roomCode = ''
let myNickname = ''
let roomName = ''
const maxPlayers = 8
let statusText: Text | null = null
let activeInput: PixiInputHandle | null = null
let selectedMode: PvpMode = 'async'
let modePreSelected = false  // 从主菜单直接带入模式时为 true，跳过模式选择页
let searchPollTimer: ReturnType<typeof setInterval> | null = null
let createRoomInitialHp = 6

// ----------------------------------------------------------------
// PixiJS 原生输入控件
// ----------------------------------------------------------------
interface PixiInputHandle {
  container: Container
  getValue(): string
  focus(): void
  update(dt: number): void
  destroy(): void
}

// designCx/designCy：输入框中心在 PixiJS 设计坐标中的绝对位置（用于精确定位 HTML 覆盖层）
function createPixiInput(
  placeholder: string,
  maxLen: number,
  onConfirm: (val: string) => void,
  designCx: number,
  designCy: number,
  w = 420,
): PixiInputHandle {
  const H = 72
  let value = ''
  let focused = false

  const con = new Container()
  const borderG = new Graphics()
  const boxG = new Graphics()
  con.addChild(borderG)
  con.addChild(boxG)

  const textT = new Text({
    text: placeholder,
    style: { fill: 0x445566, fontSize: 30, align: 'center' },
  })
  textT.anchor.set(0.5)
  con.addChild(textT)

  const cursorG = new Graphics()
  cursorG.rect(-1, -18, 2, 36).fill({ color: 0x5b8def })
  cursorG.visible = false
  con.addChild(cursorG)

  function redraw(): void {
    borderG.clear()
    boxG.clear()
    if (focused) {
      borderG.roundRect(-w / 2 - 3, -H / 2 - 3, w + 6, H + 6, 17)
        .fill({ color: 0x5b8def, alpha: 0.5 })
    }
    boxG.roundRect(-w / 2, -H / 2, w, H, 14)
      .fill({ color: focused ? 0x1a2845 : 0x131828 })
    boxG.roundRect(-w / 2, -H / 2, w, H, 14)
      .stroke({ color: focused ? 0x5b8def : 0x2a3a5c, width: 2, alpha: 0.8 })
  }

  function refreshText(): void {
    if (value) {
      textT.text = value
      textT.style.fill = 0xffffff
      const approxCharW = 18
      cursorG.x = Math.min((value.length * approxCharW) / 2 + 4, w / 2 - 12)
    } else {
      textT.text = focused ? '' : placeholder
      textT.style.fill = 0x445566
      cursorG.x = 2
    }
    cursorG.y = 0
  }

  redraw()
  refreshText()

  // HTML input：物理覆盖在 PixiJS 输入框上方，透明但可点击
  // 用户点击时浏览器原生聚焦，无需任何 focus() 调用
  const hiddenEl = document.createElement('input')
  hiddenEl.type = 'text'
  hiddenEl.maxLength = maxLen
  hiddenEl.setAttribute('autocomplete', 'off')
  hiddenEl.setAttribute('autocorrect', 'off')
  hiddenEl.setAttribute('autocapitalize', 'off')

  function repositionHtml(): void {
    const canvas = getApp().canvas as HTMLCanvasElement
    const rect = canvas.getBoundingClientRect()
    const scale = Math.min(rect.width / CANVAS_W, rect.height / CANVAS_H)
    const oX = (rect.width - CANVAS_W * scale) / 2
    const oY = (rect.height - CANVAS_H * scale) / 2
    Object.assign(hiddenEl.style, {
      position:   'fixed',
      left:       `${rect.left + oX + (designCx - w / 2) * scale}px`,
      top:        `${rect.top  + oY + (designCy - H / 2) * scale}px`,
      width:      `${w * scale}px`,
      height:     `${H * scale}px`,
      fontSize:   '16px',
      opacity:    '0.01',
      background: 'transparent',
      color:      'transparent',
      caretColor: 'transparent',
      border:     'none',
      outline:    'none',
      zIndex:     '9999',
      cursor:     'text',
      // 注意：不设置 pointer-events:none，让浏览器原生处理点击焦点
    })
  }

  repositionHtml()
  document.body.appendChild(hiddenEl)
  window.addEventListener('resize', repositionHtml)

  hiddenEl.addEventListener('input', () => {
    value = hiddenEl.value.slice(0, maxLen)
    refreshText()
  })
  hiddenEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && value.trim()) {
      onConfirm(value.trim())
    }
  })
  hiddenEl.addEventListener('focus', () => {
    focused = true; redraw(); refreshText(); cursorG.visible = true
  })
  hiddenEl.addEventListener('blur', () => {
    focused = false; redraw(); refreshText(); cursorG.visible = false
  })

  // 不需要 PixiJS pointerdown 监听，HTML input 自己处理点击

  let cursorInterval: ReturnType<typeof setInterval> | null = setInterval(() => {
    if (focused) cursorG.visible = !cursorG.visible
  }, 520)

  return {
    container: con,
    getValue: () => value,
    focus: () => { hiddenEl.focus() },
    update: (_dt: number) => { /* interval 驱动 */ },
    destroy: () => {
      if (cursorInterval) { clearInterval(cursorInterval); cursorInterval = null }
      window.removeEventListener('resize', repositionHtml)
      hiddenEl.remove()
    },
  }
}

// ----------------------------------------------------------------
// 通用 UI 工具
// ----------------------------------------------------------------
function makeText(text: string, fontSize: number, fill: number, bold = false): Text {
  return new Text({
    text,
    style: { fill, fontSize, fontWeight: bold ? 'bold' : 'normal', align: 'center' },
  })
}

function makeBtn(label: string, w: number, color: number, borderColor = 0, onClick?: () => void): Container {
  const H = 88, R = 16
  const con = new Container()
  if (borderColor) {
    const b = new Graphics()
    b.roundRect(-w / 2 - 2, -H / 2 - 2, w + 4, H + 4, R + 1).fill({ color: borderColor, alpha: 0.35 })
    con.addChild(b)
  }
  const bg = new Graphics()
  bg.roundRect(-w / 2, -H / 2, w, H, R).fill({ color })
  con.addChild(bg)
  const t = makeText(label, 28, 0xffffff, true)
  t.anchor.set(0.5)
  con.addChild(t)
  con.eventMode = 'static'
  con.cursor = 'pointer'
  if (onClick) con.on('pointerdown', onClick)
  con.on('pointerover', () => { con.alpha = 0.82 })
  con.on('pointerout', () => { con.alpha = 1 })
  return con
}

function clearRoot(): void {
  activeInput?.destroy()
  activeInput = null
  if (root) {
    root.removeChildren()
    statusText = null
  }
}

function drawPageBg(): void {
  if (!root) return
  const bg = new Graphics()
  bg.rect(0, 0, CANVAS_W, CANVAS_H).fill({ color: 0x0d0d1a })
  root.addChild(bg)
  const glow = new Graphics()
  glow.circle(CANVAS_W / 2, 180, 200).fill({ color: 0x5b8def, alpha: 0.06 })
  root.addChild(glow)
}

function drawPageTitle(text: string, sub = ''): void {
  if (!root) return
  const t = makeText(text, 44, 0xffd86b, true)
  t.anchor.set(0.5, 0)
  t.x = CANVAS_W / 2
  t.y = 100
  root.addChild(t)
  if (sub) {
    const s = makeText(sub, 22, 0x6677aa)
    s.anchor.set(0.5, 0)
    s.x = CANVAS_W / 2
    s.y = 156
    root.addChild(s)
  }
  const g = new Graphics()
  g.rect(CANVAS_W / 2 - 120, 184, 240, 2).fill({ color: 0x5b8def, alpha: 0.3 })
  g.rect(CANVAS_W / 2 - 20, 182, 40, 4).fill({ color: 0x5b8def, alpha: 0.8 })
  root.addChild(g)
}

function setStatus(msg: string): void {
  if (statusText) {
    statusText.text = msg
  } else if (root) {
    // drawMainView 没有 statusText，创建临时错误提示
    const errT = makeText(msg, 20, 0xff6655)
    errT.anchor.set(0.5)
    errT.x = CANVAS_W / 2
    errT.y = 620
    root.addChild(errT)
    statusText = errT
  }
}

// ----------------------------------------------------------------
// 昵称输入视图（完全 PixiJS，无 HTML popup）
// ----------------------------------------------------------------
function drawNicknameView(): void {
  clearRoot()
  drawPageBg()
  drawPageTitle(modePreSelected ? pvpModeLabel(selectedMode) : 'PVP 联机对战', modePreSelected ? '设置昵称后即可匹配' : '选择对战模式')

  if (!root) return

  // 居中卡片
  const cardCon = new Container()
  cardCon.x = CANVAS_W / 2
  cardCon.y = CANVAS_H / 2 - 60

  const cardG = new Graphics()
  cardG.roundRect(-260, -200, 520, 400, 24).fill({ color: 0x111828 })
  cardG.roundRect(-262, -202, 524, 404, 25).fill({ color: 0x2a3a5c, alpha: 0.35 })
  cardCon.addChild(cardG)

  const iconT = makeText('✦', 44, 0x5b8def)
  iconT.anchor.set(0.5)
  iconT.y = -148
  cardCon.addChild(iconT)

  const promptT = makeText('设置你的昵称', 32, 0xddeeff, true)
  promptT.anchor.set(0.5)
  promptT.y = -84
  cardCon.addChild(promptT)

  const hintT = makeText('用于在对战中显示给对手', 20, 0x556688)
  hintT.anchor.set(0.5)
  hintT.y = -44
  cardCon.addChild(hintT)

  // PixiJS 原生输入框（designCx=320, designCy=cardConY+30=CANVAS_H/2-60+30）
  const inp = createPixiInput('输入昵称（最多8字）', 8, (val) => {
    myNickname = val
    modePreSelected ? drawMainView() : drawModeSelectView()
  }, CANVAS_W / 2, CANVAS_H / 2 - 30, 400)
  inp.container.x = 0
  inp.container.y = 30
  cardCon.addChild(inp.container)
  activeInput = inp

  // 确认按钮
  const confirmBtn = makeBtn('确认', 280, 0x163a22, 0x4caf50, () => {
    const val = inp.getValue().trim()
    if (val) { myNickname = val; modePreSelected ? drawMainView() : drawModeSelectView() }
  })
  confirmBtn.x = 0
  confirmBtn.y = 140
  cardCon.addChild(confirmBtn)

  const charHint = makeText('最多8字，输入后按回车或点确认', 18, 0x445566)
  charHint.anchor.set(0.5)
  charHint.y = 196
  cardCon.addChild(charHint)

  root.addChild(cardCon)

  // 返回按钮
  const backBtn = makeBtn('← 返回主菜单', 220, 0x1c1c2e, 0x334466, () => SceneManager.goto('menu'))
  backBtn.x = CANVAS_W / 2
  backBtn.y = CANVAS_H - 140
  root.addChild(backBtn)

  // 自动聚焦
  setTimeout(() => inp.focus(), 100)
}

// ----------------------------------------------------------------
// 搜索房间视图
// ----------------------------------------------------------------
function pvpModeShortLabel(mode: string): string {
  if (mode === 'sync-a') return '同步'
  return '异步'
}

// ----------------------------------------------------------------
// 创建房间设置视图（填房间名后确认创建）
// ----------------------------------------------------------------
function drawCreateRoomView(): void {
  clearRoot()
  drawPageBg()
  drawPageTitle('创建房间', '设置房间信息')
  if (!root) return

  if (!roomName) roomName = myNickname ? `${myNickname}的房间` : ''
  const inp = createPixiInput(
    roomName || '输入房间名（最多8字）',
    8,
    (val) => { roomName = val },
    CANVAS_W / 2,
    340,
    420,
  )
  inp.container.x = CANVAS_W / 2
  inp.container.y = 340
  root.addChild(inp.container)
  activeInput = inp

  // 血量步进器
  const hpLabelT = makeText('初始血量', 24, 0x99aabb)
  hpLabelT.anchor.set(0.5)
  hpLabelT.x = CANVAS_W / 2
  hpLabelT.y = 436
  root.addChild(hpLabelT)

  const hpCon = new Container()
  hpCon.x = CANVAS_W / 2
  hpCon.y = 496

  const hpBg = new Graphics()
  hpBg.roundRect(-130, -30, 260, 60, 12).fill({ color: 0x111828 })
  hpBg.roundRect(-130, -30, 260, 60, 12).stroke({ color: 0x2a3a5c, width: 1.5 })
  hpCon.addChild(hpBg)

  const hpValT = makeText(String(createRoomInitialHp), 32, 0xffd86b, true)
  hpValT.anchor.set(0.5)
  hpValT.x = 0
  hpValT.y = 0
  hpCon.addChild(hpValT)

  function makeStepBtn(label: string, dx: number, delta: number): Container {
    const btn = new Container()
    const bg = new Graphics()
    bg.roundRect(-24, -24, 48, 48, 10).fill({ color: 0x1a2845 })
    bg.roundRect(-24, -24, 48, 48, 10).stroke({ color: 0x5b8def, width: 1.5 })
    btn.addChild(bg)
    const t = makeText(label, 28, 0xaaccff, true)
    t.anchor.set(0.5)
    btn.addChild(t)
    btn.x = dx
    btn.y = 0
    btn.eventMode = 'static'
    btn.cursor = 'pointer'
    btn.on('pointerdown', () => {
      createRoomInitialHp = Math.max(1, createRoomInitialHp + delta)
      hpValT.text = String(createRoomInitialHp)
    })
    btn.on('pointerover', () => { btn.alpha = 0.75 })
    btn.on('pointerout', () => { btn.alpha = 1 })
    return btn
  }

  hpCon.addChild(makeStepBtn('−', -96, -1))
  hpCon.addChild(makeStepBtn('+', 96, 1))
  root.addChild(hpCon)

  const confirmBtn = makeBtn('确认创建', PANEL_W - 60, 0x163a22, 0x4caf50, handleCreateRoom)
  confirmBtn.x = CANVAS_W / 2
  confirmBtn.y = 580
  root.addChild(confirmBtn)

  const backBtn = makeBtn('← 返回', 180, 0x1c1c2e, 0x334466, drawMainView)
  backBtn.x = CANVAS_W / 2
  backBtn.y = 696
  root.addChild(backBtn)
}

function drawSearchRoomsView(rooms: RoomInfo[] = [], loading = true): void {
  clearRoot()
  drawPageBg()
  drawPageTitle('搜索房间', '选择一个房间加入')
  if (!root) return

  if (loading) {
    const loadT = makeText('加载中...', 24, 0x6677aa)
    loadT.anchor.set(0.5)
    loadT.x = CANVAS_W / 2
    loadT.y = 500
    root.addChild(loadT)
  } else if (rooms.length === 0) {
    const emptyT = makeText('暂无可用房间', 26, 0x445566)
    emptyT.anchor.set(0.5)
    emptyT.x = CANVAS_W / 2
    emptyT.y = 480
    root.addChild(emptyT)
    const hintT = makeText('创建房间并邀请好友，或稍后刷新', 20, 0x334455)
    hintT.anchor.set(0.5)
    hintT.x = CANVAS_W / 2
    hintT.y = 530
    root.addChild(hintT)
  } else {
    rooms.slice(0, 6).forEach((room, i) => {
      const cardY = 240 + i * 116
      const cardG = new Graphics()
      cardG.roundRect(CANVAS_W / 2 - 260, cardY, 520, 100, 14).fill({ color: 0x111828 })
      cardG.roundRect(CANVAS_W / 2 - 261, cardY - 1, 522, 102, 15).fill({ color: 0x223355, alpha: 0.5 })
      root!.addChild(cardG)

      const nameT = makeText(room.roomName || room.nickname, 26, 0xddeeff, true)
      nameT.anchor.set(0, 0.5)
      nameT.x = CANVAS_W / 2 - 236
      nameT.y = cardY + 32
      root!.addChild(nameT)

      const hostT = makeText(room.nickname, 18, 0x6677aa)
      hostT.anchor.set(0, 0.5)
      hostT.x = CANVAS_W / 2 - 236 + 200
      hostT.y = cardY + 32
      root!.addChild(hostT)

      const modeT = makeText(pvpModeShortLabel(room.mode), 18, 0x5b8def)
      modeT.anchor.set(0, 0.5)
      modeT.x = CANVAS_W / 2 - 236
      modeT.y = cardY + 70
      root!.addChild(modeT)

      const countT = makeText(`${room.currentPlayers}/${room.maxPlayers}人`, 20, 0x99bbaa)
      countT.anchor.set(0, 0.5)
      countT.x = CANVAS_W / 2 - 236 + 100
      countT.y = cardY + 70
      root!.addChild(countT)

      const joinBtn = makeBtn('加入', 120, 0x163a22, 0x4caf50, () => {
        stopSearchPoll()
        handleJoinRoom(room.roomId)
      })
      joinBtn.x = CANVAS_W / 2 + 180
      joinBtn.y = cardY + 50
      root!.addChild(joinBtn)
    })
  }

  const refreshBtn = makeBtn('刷新', 160, 0x12213a, 0x5b8def, startSearchPoll)
  refreshBtn.x = CANVAS_W / 2
  refreshBtn.y = CANVAS_H - 280
  root.addChild(refreshBtn)

  const backBtn = makeBtn('← 返回', 180, 0x1c1c2e, 0x334466, () => {
    stopSearchPoll()
    drawMainView()
  })
  backBtn.x = CANVAS_W / 2
  backBtn.y = CANVAS_H - 140
  root.addChild(backBtn)
}

function stopSearchPoll(): void {
  if (searchPollTimer !== null) {
    clearInterval(searchPollTimer)
    searchPollTimer = null
  }
}

function startSearchPoll(): void {
  stopSearchPoll()
  fetchRooms().then(rooms => drawSearchRoomsView(rooms, false)).catch(() => drawSearchRoomsView([], false))
  searchPollTimer = setInterval(() => {
    fetchRooms().then(rooms => drawSearchRoomsView(rooms, false)).catch(() => {})
  }, 3000)
}

// ----------------------------------------------------------------
// 加入房间视图
// ----------------------------------------------------------------
function drawJoinRoomView(): void {
  clearRoot()
  drawPageBg()
  drawPageTitle('加入房间', '输入好友的房间码')

  if (!root) return

  const cardCon = new Container()
  cardCon.x = CANVAS_W / 2
  cardCon.y = CANVAS_H / 2 - 60

  const cardG = new Graphics()
  cardG.roundRect(-260, -200, 520, 400, 24).fill({ color: 0x111828 })
  cardG.roundRect(-262, -202, 524, 404, 25).fill({ color: 0x2a3a5c, alpha: 0.35 })
  cardCon.addChild(cardG)

  const iconT = makeText('⌨', 44, 0x5b8def)
  iconT.anchor.set(0.5)
  iconT.y = -148
  cardCon.addChild(iconT)

  const promptT = makeText('输入6位房间码', 32, 0xddeeff, true)
  promptT.anchor.set(0.5)
  promptT.y = -88
  cardCon.addChild(promptT)

  const hintT = makeText('区分大小写，输入后回车或点加入', 20, 0x556688)
  hintT.anchor.set(0.5)
  hintT.y = -48
  cardCon.addChild(hintT)

  const inp = createPixiInput('例：ABC123', 6, (val) => {
    handleJoinRoom(val)
  }, CANVAS_W / 2, CANVAS_H / 2 - 30, 360)
  inp.container.x = 0
  inp.container.y = 30
  cardCon.addChild(inp.container)
  activeInput = inp

  const joinBtn = makeBtn('加入 →', 280, 0x12213a, 0x5b8def, () => {
    const val = inp.getValue().trim()
    if (val) handleJoinRoom(val)
  })
  joinBtn.x = 0
  joinBtn.y = 140
  cardCon.addChild(joinBtn)

  statusText = makeText('', 20, 0xff7766)
  statusText.anchor.set(0.5)
  statusText.y = 196
  cardCon.addChild(statusText)

  root.addChild(cardCon)

  const backBtn = makeBtn('← 返回', 200, 0x1c1c2e, 0x334466, drawMainView)
  backBtn.x = CANVAS_W / 2
  backBtn.y = CANVAS_H - 140
  root.addChild(backBtn)

  setTimeout(() => inp.focus(), 100)
}

// ----------------------------------------------------------------
// 模式选择视图
// ----------------------------------------------------------------
function drawModeSelectView(): void {
  clearRoot()
  drawPageBg()
  drawPageTitle('选择对战模式', `昵称：${myNickname}`)

  if (!root) return

  const modes: { mode: PvpMode; label: string; sub: string; color: number; border: number }[] = [
    { mode: 'async', label: '巴扎对战（伪）', sub: '野怪闯关·异步联机', color: 0x12213a, border: 0x5b8def },
    { mode: 'sync-a', label: '同步对战', sub: '实时联机·同步对战', color: 0x1a2a12, border: 0x4caf50 },
  ]

  modes.forEach((m, i) => {
    const y = 360 + i * 148
    const active = m.mode === selectedMode
    const con = new Container()
    con.x = CANVAS_W / 2
    con.y = y

    const bg = new Graphics()
    if (active) bg.roundRect(-250, -58, 500, 116, 18).fill({ color: m.border, alpha: 0.18 })
    bg.roundRect(-248, -56, 496, 112, 16).fill({ color: m.color })
    bg.roundRect(-248, -56, 496, 112, 16).stroke({ color: active ? m.border : 0x2a3a5c, width: active ? 2.5 : 1.5 })
    con.addChild(bg)

    const label = makeText(m.label, 30, active ? 0xffd86b : 0xddeeff, true)
    label.anchor.set(0.5, 0.5)
    label.y = -14
    con.addChild(label)

    const subT = makeText(m.sub, 18, active ? 0xaaccee : 0x445566)
    subT.anchor.set(0.5, 0.5)
    subT.y = 24
    con.addChild(subT)

    if (active) {
      const checkT = makeText('✓', 26, m.border, true)
      checkT.anchor.set(1, 0.5)
      checkT.x = 226
      checkT.y = 0
      con.addChild(checkT)
    }

    con.eventMode = 'static'
    con.cursor = 'pointer'
    con.on('pointerdown', () => { selectedMode = m.mode; drawModeSelectView() })
    root!.addChild(con)
  })

  const confirmBtn = makeBtn('确认 →', PANEL_W - 60, 0x163a22, 0x4caf50, drawMainView)
  confirmBtn.x = CANVAS_W / 2
  confirmBtn.y = CANVAS_H - 240
  root.addChild(confirmBtn)

  const backBtn = makeBtn('← 返回修改昵称', 260, 0x1c1c2e, 0x334466, drawNicknameView)
  backBtn.x = CANVAS_W / 2
  backBtn.y = CANVAS_H - 140
  root.addChild(backBtn)
}

function pvpModeLabel(mode: PvpMode): string {
  if (mode === 'sync-a') return '即时同步对战'
  return '巴扎异步对战'
}

// ----------------------------------------------------------------
// 主操作视图
// ----------------------------------------------------------------
function drawMainView(): void {
  clearRoot()
  drawPageBg()
  drawPageTitle(pvpModeLabel(selectedMode), '创建或加入一个房间')

  if (!root) return

  // 紧凑信息行：昵称 · 模式（只读，无操作入口）
  const infoT = makeText(`${myNickname}  ·  ${pvpModeLabel(selectedMode)}`, 18, 0x556688)
  infoT.anchor.set(0.5)
  infoT.x = CANVAS_W / 2
  infoT.y = 228
  root.addChild(infoT)

  const divG = new Graphics()
  divG.rect(CANVAS_W / 2 - 220, 270, 440, 1).fill({ color: 0x223355, alpha: 0.8 })
  root.addChild(divG)

  // 创建房间
  const createLabel = makeText('成为房主，邀请好友加入', 20, 0x6677aa)
  createLabel.anchor.set(0.5)
  createLabel.x = CANVAS_W / 2
  createLabel.y = 296
  root.addChild(createLabel)

  const createBtn = makeBtn('＋ 创建房间', PANEL_W - 60, 0x163a22, 0x4caf50, drawCreateRoomView)
  createBtn.x = CANVAS_W / 2
  createBtn.y = 370
  root.addChild(createBtn)

  // 加入房间
  const joinLabel = makeText('已有房间？直接加入', 20, 0x6677aa)
  joinLabel.anchor.set(0.5)
  joinLabel.x = CANVAS_W / 2
  joinLabel.y = 480
  root.addChild(joinLabel)

  const searchBtn = makeBtn('搜索房间', PANEL_W - 60, 0x12213a, 0x5b8def, () => { drawSearchRoomsView(); startSearchPoll() })
  searchBtn.x = CANVAS_W / 2
  searchBtn.y = 554
  root.addChild(searchBtn)

  const codeJoinT = makeText('用房间码加入', 18, 0x445577)
  codeJoinT.anchor.set(0.5)
  codeJoinT.x = CANVAS_W / 2
  codeJoinT.y = 634
  codeJoinT.eventMode = 'static'
  codeJoinT.cursor = 'pointer'
  codeJoinT.on('pointerdown', drawJoinRoomView)
  root.addChild(codeJoinT)

  const backBtn = makeBtn('← 返回主菜单', 220, 0x1c1c2e, 0x334466, () => SceneManager.goto('menu'))
  backBtn.x = CANVAS_W / 2
  backBtn.y = CANVAS_H - 140
  root.addChild(backBtn)
}

// ----------------------------------------------------------------
// 房主等待视图
// ----------------------------------------------------------------
function drawHostWaitingView(): void {
  clearRoot()
  drawPageBg()
  drawPageTitle('等待玩家加入', `已创建 · 最多 ${maxPlayers} 人`)

  if (!root) return

  // 房间码卡片
  const codeCardG = new Graphics()
  codeCardG.roundRect(CANVAS_W / 2 - 220, 212, 440, 148, 20).fill({ color: 0x111828 })
  codeCardG.roundRect(CANVAS_W / 2 - 222, 210, 444, 152, 21).fill({ color: 0x5b8def, alpha: 0.25 })
  root.addChild(codeCardG)

  const codeLabelT = makeText('房间码', 20, 0x6677aa)
  codeLabelT.anchor.set(0.5)
  codeLabelT.x = CANVAS_W / 2
  codeLabelT.y = 238
  root.addChild(codeLabelT)

  const codeT = makeText(roomCode, 64, 0xffd86b, true)
  codeT.anchor.set(0.5)
  codeT.x = CANVAS_W / 2
  codeT.y = 292
  root.addChild(codeT)

  const hintT = makeText('发给好友，输入此码即可加入', 20, 0x445566)
  hintT.anchor.set(0.5)
  hintT.x = CANVAS_W / 2
  hintT.y = 344
  root.addChild(hintT)

  // 玩家列表
  const listLabelT = makeText('玩家列表', 22, 0x6677aa)
  listLabelT.anchor.set(0.5)
  listLabelT.x = CANVAS_W / 2
  listLabelT.y = 398
  root.addChild(listLabelT)

  const players = pvpRoom?.players ?? []
  for (let i = 0; i < players.length; i++) {
    const player = players[i]!
    const cardY = 430 + i * 78
    const cardG = new Graphics()
    cardG.roundRect(CANVAS_W / 2 - 220, cardY, 440, 64, 12).fill({ color: 0x131828 })
    root.addChild(cardG)
    const icon = player.connected ? '●' : '○'
    const t = makeText(`${icon}  ${player.nickname}`, 24, player.connected ? 0xddeeff : 0xff8877)
    t.anchor.set(0, 0.5)
    t.x = CANVAS_W / 2 - 194
    t.y = cardY + 32
    root.addChild(t)
  }

  statusText = makeText('', 20, 0xff9966)
  statusText.anchor.set(0.5)
  statusText.x = CANVAS_W / 2
  statusText.y = 430 + players.length * 78 + 28
  root.addChild(statusText)

  const startY = 430 + players.length * 78 + 92
  const startBtn = makeBtn('开始游戏 ▶', PANEL_W - 60, 0x163a22, 0x4caf50, handleStartGame)
  startBtn.x = CANVAS_W / 2
  startBtn.y = startY
  root.addChild(startBtn)

  const cancelBtn = makeBtn('取消', 180, 0x1c1c2e, 0x553333, () => {
    unregisterRoom(roomCode).catch(() => {})
    pvpRoom?.destroy()
    pvpRoom = null
    drawMainView()
  })
  cancelBtn.x = CANVAS_W / 2
  cancelBtn.y = startY + 110
  root.addChild(cancelBtn)
}

// ----------------------------------------------------------------
// 客户端等待视图
// ----------------------------------------------------------------
function drawClientWaitingView(): void {
  clearRoot()
  drawPageBg()
  drawPageTitle('已加入房间', '等待房主开始游戏')

  if (!root) return

  const waitG = new Graphics()
  waitG.roundRect(CANVAS_W / 2 - 220, 212, 440, 100, 20).fill({ color: 0x111828 })
  waitG.roundRect(CANVAS_W / 2 - 222, 210, 444, 104, 21).fill({ color: 0x5b8def, alpha: 0.2 })
  root.addChild(waitG)

  const waitT = makeText('等待房主点击「开始游戏」', 26, 0x99bbff)
  waitT.anchor.set(0.5)
  waitT.x = CANVAS_W / 2
  waitT.y = 262
  root.addChild(waitT)

  const listLabelT = makeText('当前玩家', 22, 0x6677aa)
  listLabelT.anchor.set(0.5)
  listLabelT.x = CANVAS_W / 2
  listLabelT.y = 346
  root.addChild(listLabelT)

  const clientPlayers = pvpRoom?.players ?? []
  for (let i = 0; i < clientPlayers.length; i++) {
    const player = clientPlayers[i]!
    const cardY = 380 + i * 76
    const cardG = new Graphics()
    cardG.roundRect(CANVAS_W / 2 - 220, cardY, 440, 62, 12).fill({ color: 0x131828 })
    root.addChild(cardG)
    const icon = player.connected ? '●' : '○'
    const t = makeText(`${icon}  ${player.nickname}`, 24, player.connected ? 0xddeeff : 0xff8877)
    t.anchor.set(0, 0.5)
    t.x = CANVAS_W / 2 - 194
    t.y = cardY + 31
    root.addChild(t)
  }

  statusText = makeText('', 20, 0xff9966)
  statusText.anchor.set(0.5)
  statusText.x = CANVAS_W / 2
  statusText.y = 380 + clientPlayers.length * 76 + 28
  root.addChild(statusText)

  const cancelBtn = makeBtn('离开房间', 200, 0x1c1c2e, 0x553333, () => {
    pvpRoom?.destroy()
    pvpRoom = null
    drawMainView()
  })
  cancelBtn.x = CANVAS_W / 2
  cancelBtn.y = 380 + clientPlayers.length * 76 + 96
  root.addChild(cancelBtn)
}

// ----------------------------------------------------------------
// 玩家列表刷新
// ----------------------------------------------------------------
// ----------------------------------------------------------------
// 事件处理
// ----------------------------------------------------------------
async function handleCreateRoom(): Promise<void> {
  roomCode = generateRoomCode()
  pvpRoom = new PvpRoom()
  pvpRoom.pvpMode = selectedMode
  pvpRoom.onRoomStateChange = () => {
    drawHostWaitingView()
    updateRoomPlayers(roomCode, pvpRoom!.players.filter(p => !p.isAi).length).catch(() => {})
  }
  pvpRoom.onError = (msg) => { setStatus(`错误：${msg}`) }
  pvpRoom.onGameStart = (myIndex, totalPlayers) => {
    const sess: PvpSession = {
      myIndex, totalPlayers, players: pvpRoom!.players,
      totalDays: calcTotalDays(totalPlayers),
      currentDay: 1, wins: 0, dayResults: {},
      pvpMode: selectedMode,
      playerHps: {},
      eliminatedPlayers: [],
      initialHp: createRoomInitialHp,
    }
    PvpContext.startSession(pvpRoom!, sess)
    SceneManager.goto('shop')
  }
  try {
    await pvpRoom.createRoom(roomCode, myNickname, maxPlayers, createRoomInitialHp)
    console.log('[PvpLobby] 房间已创建 code=' + roomCode)
    registerRoom({ roomId: roomCode, nickname: myNickname, roomName: roomName || myNickname, maxPlayers, currentPlayers: 1, mode: selectedMode }).catch(() => {})
    drawHostWaitingView()
  } catch (e) {
    setStatus(`创建房间失败：${e instanceof Error ? e.message : String(e)}`)
    pvpRoom.destroy()
    pvpRoom = null
  }
}

async function handleJoinRoom(code: string): Promise<void> {
  const upperCode = code.toUpperCase().trim()
  if (upperCode.length < 4) return
  pvpRoom = new PvpRoom()
  pvpRoom.pvpMode = selectedMode
  pvpRoom.onRoomStateChange = () => { drawClientWaitingView() }
  pvpRoom.onError = (msg) => { setStatus(`加入失败：${msg}`) }
  pvpRoom.onGameStart = (myIndex, totalPlayers) => {
    const sess: PvpSession = {
      myIndex, totalPlayers, players: pvpRoom!.players,
      totalDays: calcTotalDays(totalPlayers),
      currentDay: 1, wins: 0, dayResults: {},
      pvpMode: selectedMode,
      playerHps: {},
      eliminatedPlayers: [],
      initialHp: pvpRoom!.initialHp,
    }
    PvpContext.startSession(pvpRoom!, sess)
    SceneManager.goto('shop')
  }
  try {
    await pvpRoom.joinRoom(upperCode, myNickname)
    drawClientWaitingView()
  } catch (e) {
    setStatus(`${e instanceof Error ? e.message : String(e)}`)
    pvpRoom.destroy()
    pvpRoom = null
  }
}

function handleStartGame(): void {
  if (!pvpRoom) return
  unregisterRoom(roomCode).catch(() => {})
  pvpRoom.startGame()
}

// ----------------------------------------------------------------
// Scene 接口
// ----------------------------------------------------------------
/** 从主菜单预设模式后直接进入大厅（跳过模式选择页） */
export function setPvpLobbyMode(mode: PvpMode): void {
  selectedMode = mode
  modePreSelected = true
}

export const PvpLobbyScene: Scene = {
  name: 'pvp-lobby',

  onEnter() {
    const { stage } = getApp()
    root = new Container()
    root.sortableChildren = true
    stage.addChild(root)
    if (myNickname) {
      drawMainView()
    } else {
      drawNicknameView()
    }
  },

  onExit() {
    stopSearchPoll()
    activeInput?.destroy()
    activeInput = null
    if (root) {
      getApp().stage.removeChild(root)
      root.destroy({ children: true })
      root = null
    }
    statusText = null
  },

  update(dt: number) {
    activeInput?.update(dt)
  },
}
