// ============================================================
// PvpContext — PVP 全局协调器
// 桥接 PvpRoom ↔ SceneManager ↔ ShopScene/BattleScene
// ============================================================

import { SceneManager } from '@/scenes/SceneManager'
import { getConfig } from '@/core/DataLoader'
import { getBattleSnapshot, setBattleSnapshot } from '@/combat/BattleSnapshotStore'
import { consumeBattleOutcome } from '@/combat/BattleOutcomeStore'
import { SHOP_STATE_STORAGE_KEY } from '@/core/RunState'
import { clearPvpShopState } from '@/scenes/ShopScene'
import type { PvpSession } from '@/pvp/PvpTypes'
import type { PvpRoom } from '@/pvp/PvpRoom'
import type { BattleSnapshotBundle } from '@/combat/BattleSnapshotStore'

const PVE_BACKUP_KEY = 'bigbazzar_pve_backup_v1'

// ShopScene 注册：倒计时结束时自动构建并提交快照
let autoSubmitCallback: (() => void) | null = null

// ---------- 倒计时状态（ShopScene 通过 getCountdownRemainMs() 轮询显示） ----------
let countdownTotalMs = 0
let countdownStartMs = 0
let countdownTimeoutId: ReturnType<typeof setTimeout> | null = null

// ---------- 主状态 ----------
let active = false
let session: PvpSession | null = null
let room: PvpRoom | null = null
// day_ready 在战斗途中到达时延迟显示覆盖层
let pendingDayReadyAt = 0   // 非 0 表示有待展示的 day_ready，值为到达时间戳 ms

// Mode A: sync-start pending
let syncStartCallbacks = new Map<number, (() => void)>() // day → callback


// HP system state
let pendingSurvivingDamage = 0
let pendingRoundWinner: 'player' | 'enemy' | 'draw' = 'draw'


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
    // 优先使用 host 分发时确定的真实对手 index（算法收缩后本地计算不再可靠）
    const opponentIdx = session.currentOpponentPlayerIndex ?? -1
    if (opponentIdx < 0) return null
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
      countdownTotalMs = countdownMs
      // 战斗场景中收到下一天 day_ready 时，延迟启动倒计时，避免干扰战斗界面
      if (SceneManager.currentName() === 'battle') {
        pendingDayReadyAt = Date.now()
      } else {
        startCountdown()
      }
    }

    pvpRoom.onPlayerStatusUpdate = () => { /* 不再显示玩家准备状态 */ }

    pvpRoom.onOpponentSnapshot = (day, opponentSnap, opponentPlayerIndex) => {
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
      // 记录 bye 轮实际对手 index 到 session（host 已解析出真实快照来源）
      if (session && opponentPlayerIndex !== undefined) {
        session.currentOpponentPlayerIndex = opponentPlayerIndex
      }
      stopCountdown()
      applyOpponentSnapshot(day, opponentSnap)
    }

    pvpRoom.onGameOver = (rankings) => {
      if (session) session.rankings = rankings
      // 胜者在 onBattleComplete 里已 advanceToDay 并 goto('shop')，此时需主动跳转结算
      // 观赛/结算场景已在 update() 中检测 rankings，不需要额外处理
      const cur = SceneManager.currentName()
      if (cur === 'shop' || cur === 'battle') {
        console.log('[PvpContext] game_over 到达，当前在 ' + cur + '，跳转结算页')
        stopCountdown()
        autoSubmitCallback = null
        SceneManager.goto('pvp-result')
      }
    }

    pvpRoom.onBattleSyncStart = (day) => {
      const cb = syncStartCallbacks.get(day)
      if (cb) { cb(); syncStartCallbacks.delete(day) }
    }

    pvpRoom.onRoundSummary = (day, hpMap, newlyEliminated) => {
      if (!session) return
      // 更新所有玩家 HP
      Object.entries(hpMap).forEach(([idx, hp]) => {
        session!.playerHps[Number(idx)] = hp
      })
      // 标记淘汰
      newlyEliminated.forEach((idx) => {
        if (!session!.eliminatedPlayers.includes(idx)) {
          session!.eliminatedPlayers.push(idx)
        }
      })
      console.log('[PvpContext] round_summary day=' + day + ' hpMap=' + JSON.stringify(hpMap) + ' eliminated=' + JSON.stringify(newlyEliminated))
      // 我被淘汰：停止倒计时，进入观赛模式（保持连接以接收后续 round_summary / game_over）
      if (newlyEliminated.includes(session.myIndex)) {
        console.log('[PvpContext] 我被淘汰，进入观赛模式')
        stopCountdown()
        autoSubmitCallback = null
        SceneManager.goto('pvp-spectator')
      }
    }

    // 初始化 HP（从 pvp_rules 配置读取，fallback 6）
    if (!session.playerHps || Object.keys(session.playerHps).length === 0) {
      const initHp = getConfig().pvpRules?.initialHp ?? 6
      session.playerHps = {}
      session.players.forEach((p) => { session!.playerHps[p.index] = initHp })
    }
    if (!session.eliminatedPlayers) session.eliminatedPlayers = []
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
    room.submitSnapshot(session.currentDay, mySnap)
  },

  /** BattleScene 结算时调用：记录本场胜负（在 deductLife 等之前） */
  recordBattleResult(winner: 'player' | 'enemy' | 'draw', survivingDamage = 0): void {
    if (!session) return
    if (winner === 'player') session.wins++
    session.dayResults[session.currentDay] = winner
    pendingSurvivingDamage = survivingDamage
    pendingRoundWinner = winner
  },

  /** Mode A: BattleScene calls this to signal ready for sync start */
  notifyBattleSyncReady(day: number, onStart: () => void): void {
    if (!active || !room || !session) return
    if (session.pvpMode !== 'sync-a') return
    syncStartCallbacks.set(day, onStart)
    room.notifySyncReady(day)
  },

  /** Returns current PVP mode */
  getPvpMode(): import('./PvpTypes').PvpMode | null {
    return session?.pvpMode ?? null
  },

  /** Returns whether the current player is the host */
  isHost(): boolean {
    return room?.isHost ?? false
  },

  /** BattleScene 退出过渡结束时调用（替代 SceneManager.goto('shop')） */
  onBattleComplete(): void {
    if (!session) return

    // consumeBattleOutcome 防止 ShopScene 重复处理
    consumeBattleOutcome()

    const nextDay = session.currentDay + 1

    // 进入战斗/结算前清除 autoSubmitCallback，防止下一天倒计时到时调用旧 ShopScene 的闭包
    autoSubmitCallback = null
    // 重置 bye 轮对手缓存，防止跨天串用
    session.currentOpponentPlayerIndex = undefined

    // 上报本轮结果（HP 系统：每轮都上报，由 round_summary 决定淘汰与否）
    // 注意：host 侧 onRoundSummary 可能在此同步触发并调用 goto('pvp-result')
    room?.reportRoundResult(session.currentDay, pendingRoundWinner, pendingSurvivingDamage)
    pendingSurvivingDamage = 0

    // host 侧 onRoundSummary 可能已同步更新 eliminatedPlayers，若已淘汰则不再 goto('shop')
    if (session.eliminatedPlayers.includes(session.myIndex)) return

    if (nextDay > (getConfig().pvpRules?.maxRounds ?? 30) + 2) {
      // 安全兜底：超过 maxRounds（PvpRoom 应更早触发 game_over）
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
        countdownTotalMs = Math.max(0, countdownTotalMs - elapsed)
        pendingDayReadyAt = 0
        startCountdown()
      }
    }
  },

  /** ShopScene 轮询：获取当前剩余倒计时毫秒数（0 表示未激活或已结束） */
  getCountdownRemainMs(): number {
    if (countdownStartMs === 0) return 0
    return Math.max(0, countdownTotalMs - (Date.now() - countdownStartMs))
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
    syncStartCallbacks.clear()
    pendingSurvivingDamage = 0
    pendingRoundWinner = 'draw'
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
    pvpEnemySkillIds: opponentSnap.ownerSkillIds ?? [],
    pvpEnemyBackpackItemCount: opponentSnap.playerBackpackItemCount,
    pvpEnemyGold: opponentSnap.playerGold,
    pvpEnemyTrophyWins: opponentSnap.playerTrophyWins,
  }
  setBattleSnapshot(pvpSnap)
  SceneManager.goto('battle')
}

// ----------------------------------------------------------------
// 覆盖层 UI
// ----------------------------------------------------------------

function startCountdown(): void {
  stopCountdown()
  countdownStartMs = Date.now()
  // 倒计时结束时自动提交快照（若玩家未手动准备）
  countdownTimeoutId = setTimeout(() => {
    countdownTimeoutId = null
    const currentSnap = getBattleSnapshot()
    const alreadySubmitted = currentSnap && currentSnap.day === session?.currentDay
    if (!alreadySubmitted && autoSubmitCallback) {
      console.log('[PvpContext] 倒计时结束，自动触发快照提交')
      autoSubmitCallback()
    }
  }, countdownTotalMs + 500)
}

function stopCountdown(): void {
  if (countdownTimeoutId !== null) {
    clearTimeout(countdownTimeoutId)
    countdownTimeoutId = null
  }
  countdownStartMs = 0
}
