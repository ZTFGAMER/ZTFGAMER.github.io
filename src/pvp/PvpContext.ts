// ============================================================
// PvpContext — PVP 全局协调器
// 桥接 PvpRoom ↔ SceneManager ↔ ShopScene/BattleScene
// ============================================================

import { Container, Graphics, Text } from 'pixi.js'
import { getApp } from '@/core/AppContext'
import { SceneManager } from '@/scenes/SceneManager'
import { getBattleSnapshot, setBattleSnapshot } from '@/combat/BattleSnapshotStore'
import { consumeBattleOutcome } from '@/combat/BattleOutcomeStore'
import { SHOP_STATE_STORAGE_KEY } from '@/core/RunState'
import { clearPvpShopState } from '@/scenes/ShopScene'
import type { PvpSession, PvpPlayer } from '@/pvp/PvpTypes'
import { getOpponentIndex } from '@/pvp/PvpTypes'
import type { PvpRoom } from '@/pvp/PvpRoom'
import type { BattleSnapshotBundle } from '@/combat/BattleSnapshotStore'

const PVE_BACKUP_KEY = 'bigbazzar_pve_backup_v1'
const CANVAS_W = 640

// ShopScene 注册：倒计时结束时自动构建并提交快照
let autoSubmitCallback: (() => void) | null = null

// ---------- 覆盖层 UI 状态 ----------
let overlayContainer: Container | null = null
let overlayCountdownText: Text | null = null
let overlayStatusTexts: Text[] = []
let overlayTitleText: Text | null = null
let countdownInterval: ReturnType<typeof setInterval> | null = null
let countdownRemainMs = 0

// ---------- 主状态 ----------
let active = false
let session: PvpSession | null = null
let room: PvpRoom | null = null
// day_ready 在战斗途中到达时延迟显示覆盖层
let pendingDayReadyAt = 0   // 非 0 表示有待展示的 day_ready，值为到达时间戳 ms


// ----------------------------------------------------------------
// 公开 API（ShopScene / BattleScene 调用）
// ----------------------------------------------------------------

export const PvpContext = {
  isActive(): boolean {
    return active
  },

  getSession(): PvpSession | null {
    return session
  },

  /** 获取当天的对手昵称（BattleScene 使用） */
  getOpponentNickname(): string | null {
    if (!session || !room) return null
    const opponentIdx = getOpponentIndex(session.myIndex, session.totalPlayers, session.currentDay - 1)
    const opponent = session.players.find((p) => p.index === opponentIdx)
    return opponent?.nickname ?? null
  },

  /** 获取自己的昵称（BattleScene 使用） */
  getMyNickname(): string | null {
    if (!session || !room) return null
    const me = session.players.find((p) => p.index === session!.myIndex)
    return me?.nickname ?? null
  },

  /** 从 PvpLobbyScene 调用：开始 PVP 会话 */
  startSession(pvpRoom: PvpRoom, pvpSession: PvpSession): void {
    active = true
    room = pvpRoom
    session = pvpSession

    // 备份并清空 PVE 存档，让 ShopScene 全新开始
    backupAndClearPveSave()

    // 注册房间回调
    pvpRoom.onDayReady = (_day, countdownMs) => {
      // 注意：不在此处更新 session.currentDay！
      // currentDay 由 session 初始值(1) 和 onBattleComplete 负责推进。
      // 若在此处更新，当 day_ready 在战斗途中到达时会提前覆盖 currentDay，
      // 导致 onBattleComplete 计算出错误的 nextDay，使玩家跳过整天甚至误判游戏结束。
      countdownRemainMs = countdownMs
      // 战斗场景中收到下一天 day_ready 时（宿主先完成战斗触发下一天）
      // 不立即弹出覆盖层，等进入商店场景后再显示，避免干扰战斗界面
      if (SceneManager.currentName() === 'battle') {
        pendingDayReadyAt = Date.now()
      } else {
        showOverlay()
        updateOverlayTitle('布置好后点「战斗」准备')
        startCountdown()
      }
    }

    pvpRoom.onPlayerStatusUpdate = (_day, readyIndices) => {
      updateOverlayPlayerStatus(readyIndices)
    }

    pvpRoom.onOpponentSnapshot = (day, opponentSnap) => {
      // 校验 day：只处理与当前天匹配的快照，防止乱序/残留消息导致误入战斗
      if (session && day !== session.currentDay) {
        console.warn('[PvpContext] 忽略不匹配的 opponent_snapshot day=' + day + ' (expected ' + session.currentDay + ')')
        return
      }
      // 已在战斗中：忽略重复快照（如双击准备按钮触发二次补发）
      if (SceneManager.currentName() === 'battle') {
        console.warn('[PvpContext] 已在战斗中，忽略重复的 opponent_snapshot day=' + day)
        return
      }
      hideOverlay()
      stopCountdown()
      applyOpponentSnapshot(day, opponentSnap)
    }

    pvpRoom.onGameOver = (rankings) => {
      // 收到最终排名，写入 session；pvp-result 场景会在 update() 中检测并刷新
      if (session) session.rankings = rankings
    }
  },

  /** ShopScene 注册自动提交回调（倒计时结束时若未手动提交则自动触发） */
  registerAutoSubmit(cb: () => void): void {
    autoSubmitCallback = cb
  },

  /** ShopScene phaseBtn 点击时调用（替代 beginBattleStartTransition） */
  onPlayerReady(): void {
    if (!active || !session || !room) return
    const mySnap = getBattleSnapshot()
    if (!mySnap) {
      console.warn('[PvpContext] 快照为空，忽略 onPlayerReady')
      return
    }
    console.log('[PvpContext] onPlayerReady day=' + session.currentDay + ' entities=' + mySnap.entities.length)
    updateOverlayTitle('已准备，等待其他玩家...')
    room.submitSnapshot(session.currentDay, mySnap)
  },

  /** BattleScene 结算时调用：记录本场胜负（在 deductLife 等之前） */
  recordBattleResult(winner: 'player' | 'enemy' | 'draw'): void {
    if (!session) return
    if (winner === 'player') session.wins++
    session.dayResults[session.currentDay] = winner
  },

  /** BattleScene 退出过渡结束时调用（替代 SceneManager.goto('shop')） */
  onBattleComplete(): void {
    if (!session) return

    // consumeBattleOutcome 防止 ShopScene 重复处理
    consumeBattleOutcome()

    const nextDay = session.currentDay + 1

    // 进入战斗/结算前清除 autoSubmitCallback，防止下一天倒计时到时调用旧 ShopScene 的闭包
    autoSubmitCallback = null

    if (nextDay > session.totalDays) {
      // 上报胜场给房主；房主收齐后广播含真实排名的 game_over
      // pvp-result 场景会在 update() 中检测 session.rankings 后刷新
      // active/session 保持存活直到 endSession()，确保 onGameOver 回调能写入 rankings
      room?.reportWins(session.wins)
      SceneManager.goto('pvp-result')
    } else {
      session.currentDay = nextDay

      // 房主负责触发下一天的倒计时
      if (room?.isHost) {
        room.advanceToDay(nextDay)
      }

      SceneManager.goto('shop')

      // 若 day_ready 在战斗途中已到达（延迟了覆盖层），现在补充显示
      // 并扣除战斗期间已流逝的时间，保持倒计时对齐
      if (pendingDayReadyAt > 0) {
        const elapsed = Date.now() - pendingDayReadyAt
        countdownRemainMs = Math.max(0, countdownRemainMs - elapsed)
        pendingDayReadyAt = 0
        showOverlay()
        updateOverlayTitle('布置好后点「战斗」准备')
        startCountdown()
      }
    }
  },

  /** PvpResultScene 离开时调用 */
  endSession(): void {
    restorePveSave()
    // 清理 ShopScene 的 in-memory 状态，防止 PVP 残留存档污染 PVE 商店
    clearPvpShopState()
    room?.destroy()
    room = null
    session = null
    active = false
    pendingDayReadyAt = 0
    hideOverlay()
    stopCountdown()
  },
}

// ----------------------------------------------------------------
// 存档隔离
// ----------------------------------------------------------------

function backupAndClearPveSave(): void {
  try {
    const pve = localStorage.getItem(SHOP_STATE_STORAGE_KEY)
    if (pve) localStorage.setItem(PVE_BACKUP_KEY, pve)
    localStorage.removeItem(SHOP_STATE_STORAGE_KEY)
  } catch {
    // ignore
  }
}

function restorePveSave(): void {
  try {
    const backup = localStorage.getItem(PVE_BACKUP_KEY)
    if (backup) {
      localStorage.setItem(SHOP_STATE_STORAGE_KEY, backup)
      localStorage.removeItem(PVE_BACKUP_KEY)
    }
  } catch {
    // ignore
  }
}

// ----------------------------------------------------------------
// 快照拼装：我的 entities 作为 player，对手 entities 作为 pvpEnemyEntities
// ----------------------------------------------------------------

function applyOpponentSnapshot(day: number, opponentSnap: BattleSnapshotBundle): void {
  const mySnap = getBattleSnapshot()
  if (!mySnap) {
    console.warn('[PvpContext] 无法获取我方快照，以空阵容参战')
  }
  console.log('[PvpContext] applyOpponentSnapshot day=' + day + ' myEntities=' + (mySnap?.entities.length ?? 0) + ' opponentEntities=' + opponentSnap.entities.length)
  // mySnap 为 null 时（未提交快照）构造空阵容快照，避免使用对手快照导致镜像战斗
  const base: BattleSnapshotBundle = mySnap ?? {
    day,
    activeColCount: opponentSnap.activeColCount,
    createdAtMs: Date.now(),
    entities: [],
  }
  const pvpSnap: BattleSnapshotBundle = {
    ...base,
    day,
    pvpEnemyEntities: opponentSnap.entities,
  }
  setBattleSnapshot(pvpSnap)
  SceneManager.goto('battle')
}

// ----------------------------------------------------------------
// 覆盖层 UI
// ----------------------------------------------------------------

function showOverlay(): void {
  const { stage } = getApp()

  if (!overlayContainer) {
    overlayContainer = new Container()
    overlayContainer.zIndex = 500
    overlayContainer.eventMode = 'passive'  // 子元素可接收事件

    const bg = new Graphics()
    bg.rect(0, 0, CANVAS_W, 430).fill({ color: 0x000000, alpha: 0.78 })  // 只覆盖顶部背景区，不遮挡商店/背包/战斗按钮
    bg.eventMode = 'static'  // 拦截顶部区域误触，底部商店/战斗按钮仍可点击
    overlayContainer.addChild(bg)

    // 标题
    overlayTitleText = new Text({
      text: '等待其他玩家...',
      style: { fill: 0xffd86b, fontSize: 36, fontWeight: 'bold', align: 'center' },
    })
    overlayTitleText.anchor.set(0.5, 0)
    overlayTitleText.x = CANVAS_W / 2
    overlayTitleText.y = 160  // 顶部区域显示，不遮挡商店主界面

    overlayContainer.addChild(overlayTitleText)

    // 倒计时
    overlayCountdownText = new Text({
      text: '',
      style: { fill: 0xffffff, fontSize: 28, align: 'center' },
    })
    overlayCountdownText.anchor.set(0.5, 0)
    overlayCountdownText.x = CANVAS_W / 2
    overlayCountdownText.y = 220
    overlayContainer.addChild(overlayCountdownText)

    // 玩家状态（最多 4 行）
    overlayStatusTexts = []
    for (let i = 0; i < 4; i++) {
      const t = new Text({
        text: '',
        style: { fill: 0xcccccc, fontSize: 24, align: 'center' },
      })
      t.anchor.set(0.5, 0)
      t.x = CANVAS_W / 2
      t.y = 270 + i * 38
      overlayContainer.addChild(t)
      overlayStatusTexts.push(t)
    }
  }

  updateOverlayPlayerStatus([])
  stage.addChild(overlayContainer)
  overlayContainer.visible = true
}

function hideOverlay(): void {
  if (overlayContainer) {
    overlayContainer.visible = false
    try {
      getApp().stage.removeChild(overlayContainer)
    } catch {
      // ignore
    }
  }
}

function updateOverlayTitle(text: string): void {
  if (overlayTitleText) overlayTitleText.text = text
}

function updateOverlayPlayerStatus(readyIndices: number[]): void {
  if (!session) return
  const players = room?.players ?? []

  // 只显示实际在场的玩家，空行隐藏
  for (let i = 0; i < 4; i++) {
    const t = overlayStatusTexts[i]
    if (!t) continue
    const player = players[i] as PvpPlayer | undefined
    if (!player) {
      t.text = ''
      continue
    }
    const isMe = player.index === session.myIndex
    const isReady = readyIndices.includes(player.index)
    const icon = player.isAi ? '[AI]' : isReady ? '✓ 已准备' : '… 未准备'
    const meTag = isMe ? '（我）' : ''
    t.text = `${icon}  ${player.nickname}${meTag}`
    t.style.fill = isReady ? 0x7fff7f : (isMe ? 0xffd86b : 0xaaaaaa)
  }

  // 当有人已准备但自己未准备时，更新标题提示
  const myReady = readyIndices.includes(session?.myIndex ?? -1)
  const othersReady = readyIndices.filter(i => i !== (session?.myIndex ?? -1)).length
  if (!myReady && othersReady > 0) {
    updateOverlayTitle('队友已准备！请点「准备」按钮')
  }
}

function startCountdown(): void {
  stopCountdown()
  const startMs = Date.now()
  const total = countdownRemainMs
  if (overlayCountdownText) overlayCountdownText.text = `${Math.ceil(total / 1000)}s`

  countdownInterval = setInterval(() => {
    const elapsed = Date.now() - startMs
    const remain = Math.max(0, total - elapsed)
    if (overlayCountdownText) {
      overlayCountdownText.text = `${Math.ceil(remain / 1000)}s`
    }
    if (remain <= 0) {
      stopCountdown()
      // 倒计时结束：若玩家还未提交本轮快照，自动提交（防止宿主用 AI 替代）
      // 注意：不能用 !getBattleSnapshot() 判断，因为第 2 轮起 store 里会残留上一轮的合并快照
      // 改为比较快照的 day 与当前轮次：只有快照 day 与 currentDay 一致才说明本轮已手动提交
      const currentSnap = getBattleSnapshot()
      const alreadySubmitted = currentSnap && currentSnap.day === session?.currentDay
      if (!alreadySubmitted && autoSubmitCallback) {
        console.log('[PvpContext] 倒计时结束，自动触发快照提交')
        autoSubmitCallback()
      }
    }
  }, 500)
}

function stopCountdown(): void {
  if (countdownInterval !== null) {
    clearInterval(countdownInterval)
    countdownInterval = null
  }
}
