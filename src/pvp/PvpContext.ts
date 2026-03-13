// ============================================================
// PvpContext — PVP 全局协调器
// 桥接 PvpRoom ↔ SceneManager ↔ ShopScene/BattleScene
// ============================================================

import { SceneManager } from '@/core/SceneManager'
import { getConfig } from '@/core/DataLoader'
import { getBattleSnapshot, setBattleSnapshot } from '@/battle/BattleSnapshotStore'
import { consumeBattleOutcome } from '@/battle/BattleOutcomeStore'
import { setPvpPlayerProgressOverride } from '@/core/RunState'

import { getDailyGoldForDay } from '@/shop/ShopManager'
import type { PvpSession, PvpDayPhase } from '@/pvp/PvpTypes'
import type { PvpRoom } from '@/pvp/PvpRoom'
import type { BattleSnapshotBundle } from '@/battle/BattleSnapshotStore'

// 野怪轮胜利奖励系数（相对日收入）：两次野怪各 0.5，满奖励=1× 日收入，从 pvp_rules 读取
function getWildWinBonusRatio(): number {
  return getConfig().pvpRules?.wildWinBonusRatio ?? 0.5
}

// ShopScene 注册：倒计时结束时自动构建并提交快照
let autoSubmitCallback: (() => void) | null = null
let clearShopStateCallback: (() => void) | null = null

// ---------- 倒计时状态（ShopScene 通过 getCountdownRemainMs() 轮询显示） ----------
let countdownTotalMs = 0
let countdownStartMs = 0
let countdownTimeoutId: ReturnType<typeof setTimeout> | null = null

// ---------- 主状态 ----------
let active = false
let session: PvpSession | null = null
let room: PvpRoom | null = null

// Mode A: sync-start pending
let syncStartCallbacks = new Map<number, (() => void)>() // day → callback
// sync-a: 收到对手快照后缓存，等 battle_sync_start 再跳转
let pendingOpponentSnap: import('@/battle/BattleSnapshotStore').BattleSnapshotBundle | null = null
let pendingSyncStartDay = 0  // battle_sync_start 比 opponent_snapshot 先到时记录
// sync-a: 当前轮各玩家就绪状态
let syncReadyIndices: number[] = []

// ---------- 每天阶段状态 ----------
// shop1 → wild1 → shop2 → wild2 → shop3 → pvp
let currentDayPhase: PvpDayPhase = 'shop1'
// 野怪轮胜利后待发放的额外金币（ShopScene 进入时消费）
let pendingWildGoldBonus = 0

// HP system state
let pendingSurvivingDamage = 0
let pendingRoundWinner: 'player' | 'enemy' | 'draw' = 'draw'

// 上局所有玩家快照（round_summary 下发，用于商店阶段查看阵容）
let lastPlayerSnapshots: Record<number, import('@/battle/BattleSnapshotStore').BattleSnapshotBundle> = {}

// sync-a 轮空预分配缓存：day_ready 可能早于 onBattleComplete 到达，需在 onBattleComplete 后补回
let cachedByeOpponent: { day: number; opponentIdx: number } | undefined = undefined


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
    currentDayPhase = 'shop1'
    pendingWildGoldBonus = 0
    // PVP 模式使用独立内存进度，从 Lv1 开始，不污染冒险模式存档
    setPvpPlayerProgressOverride({ level: 1, exp: 0 })

    // 游戏中玩家断线/重连时同步 session.players（客户端 _players 会被整体替换，session 引用需刷新）
    pvpRoom.onRoomStateChange = (players) => {
      if (session) session.players = players
    }

    // 游戏中与 Host 的连接断开（WS 关闭）：停止倒计时，跳转结算页
    pvpRoom.onError = (msg) => {
      console.error('[PvpContext] 连接断开，跳转结算:', msg)
      stopCountdown()
      autoSubmitCallback = null
      const cur = SceneManager.currentName()
      if (cur === 'shop' || cur === 'battle') {
        SceneManager.goto('pvp-result')
      }
    }

    // 注册房间回调
    pvpRoom.onDayReady = (day, countdownMs, byeOpponentMap) => {
      // 异步PVP无倒计时：玩家手动点"准备"推进，无需自动提交
      if (isAsyncMode()) return
      // 注意：不在此处更新 session.currentDay！
      // currentDay 由 session 初始值(1) 和 onBattleComplete 负责推进。
      countdownTotalMs = countdownMs
      cachedByeOpponent = undefined  // 新一天的 day_ready，清空旧缓存
      // 若 host 预计算了轮空配对，提前设置 currentOpponentPlayerIndex（商店徽章即可展示）
      if (session && byeOpponentMap) {
        const preAssigned = byeOpponentMap[session.myIndex]
        if (preAssigned !== undefined) {
          session.currentOpponentPlayerIndex = preAssigned
          cachedByeOpponent = { day, opponentIdx: preAssigned }  // 缓存，防止被 onBattleComplete 清除
          PvpContext.onOpponentPreAssigned?.()
        }
      }
      // 倒计时由 onCountdownStart 统一触发（所有玩家进入商店后才开始）
    }

    pvpRoom.onCountdownStart = (_day) => {
      if (isAsyncMode()) return
      startCountdown()
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

      if (!isAsyncMode()) {
        // sync-a：缓存快照，等 battle_sync_start 再进入战斗场景
        // （若 battle_sync_start 已先到，则立即应用）
        if (pendingSyncStartDay === day) {
          pendingSyncStartDay = 0
          stopCountdown()
          applyOpponentSnapshot(day, opponentSnap)
        } else {
          pendingOpponentSnap = opponentSnap
          // 对手 index 已确认但还在等待 sync_start，通知 ShopScene 刷新等待面板
          PvpContext.onOpponentKnown?.()
        }
        return
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

      if (!isAsyncMode() && session) {
        if (pendingOpponentSnap) {
          // 正常路径：快照已缓存，立即应用并进入战斗
          const snap = pendingOpponentSnap
          pendingOpponentSnap = null
          pendingSyncStartDay = 0
          stopCountdown()
          applyOpponentSnapshot(session.currentDay, snap)
        } else {
          // 边缘情况：battle_sync_start 比 opponent_snapshot 先到，记录等待
          pendingSyncStartDay = day
        }
      }
    }

    pvpRoom.onRoundSummary = (day, hpMap, newlyEliminated, snapshots) => {
      if (!session) return
      // 更新所有玩家 HP
      Object.entries(hpMap).forEach(([idx, hp]) => {
        session!.playerHps[Number(idx)] = hp
      })
      // 更新所有玩家等级（从快照 ownerLevel 提取）
      if (!session.playerLevels) session.playerLevels = {}
      Object.entries(snapshots ?? {}).forEach(([idx, snap]) => {
        if (snap.ownerLevel !== undefined) {
          session!.playerLevels![Number(idx)] = snap.ownerLevel
        }
      })
      // 存储上局快照
      lastPlayerSnapshots = snapshots ?? {}
      // 通知 ShopScene 快照已就绪（解决 round_summary 晚于 onEnter 的竞态）
      PvpContext.onRoundSummaryReceived?.()
      // 标记淘汰
      newlyEliminated.forEach((idx) => {
        if (!session!.eliminatedPlayers.includes(idx)) {
          session!.eliminatedPlayers.push(idx)
        }
      })
      console.log('[PvpContext] round_summary day=' + day + ' hpMap=' + JSON.stringify(hpMap) + ' eliminated=' + JSON.stringify(newlyEliminated))
      // 通知等待面板刷新（eliminatedPlayers 已更新）
      if (newlyEliminated.length > 0) PvpContext.onEliminatedPlayersUpdate?.()
      // 我被淘汰：记录排名，立即离开（host 保留 room 继续管理对局）
      if (newlyEliminated.includes(session.myIndex)) {
        stopCountdown()
        autoSubmitCallback = null
        // 计算淘汰名次：存活人数 + 1（eliminatedPlayers 此时已包含自己）
        const totalHumans = session.players.filter(p => !p.isAi).length
        session.myEliminationRank = totalHumans - (session.eliminatedPlayers.length - 1)
        console.log('[PvpContext] 我被淘汰，排名=' + session.myEliminationRank + ' isHost=' + room?.isHost)
        if (!room?.isHost) {
          // 非 host：断开连接（host 端 handlePeerDisconnect 会标记 connected=false，eliminatedSet 已排除）
          room?.destroy()
          room = null
        }
        // 若已提前（本地预判）跳转到 pvp-result，update 循环会检测 myEliminationRank 变化并刷新，无需重复 goto
        if (SceneManager.currentName() !== 'pvp-result') {
          SceneManager.goto('pvp-result')
        }
      } else if (session.predictedElimination && !newlyEliminated.includes(session.myIndex)) {
        // 本地预判错误：预判被淘汰但实际未被淘汰（HP 扣血后仍 > 0）
        // 清除预判标记，继续正常流程（进入下一天商店）
        console.log('[PvpContext] 本地预判淘汰有误，实际存活，继续游戏 day=' + day)
        session.predictedElimination = false
        const nextDay = day + 1
        currentDayPhase = 'shop1'
        session.currentDay = nextDay
        if (room?.isHost) {
          room.advanceToDay(nextDay)
        }
        SceneManager.goto('shop')
      }
    }

    pvpRoom.onSyncReadyUpdate = (_day, readyIndices) => {
      syncReadyIndices = readyIndices
      PvpContext.onSyncReadyUpdate?.()
    }

    pvpRoom.onUrgeNotify = (fromPlayerIndex, fromNickname) => {
      PvpContext.onUrgeReceived?.(fromPlayerIndex, fromNickname)
    }

    // 初始化 HP（使用 session.initialHp，fallback 30）
    if (!session.playerHps || Object.keys(session.playerHps).length === 0) {
      const initHp = session.initialHp ?? 30
      session.playerHps = {}
      session.players.forEach((p) => { session!.playerHps[p.index] = initHp })
    }
    if (!session.eliminatedPlayers) session.eliminatedPlayers = []
  },

  /** ShopScene 注册自动提交回调（仅 sync-a 模式有效，异步PVP忽略） */
  registerAutoSubmit(cb: () => void): void {
    if (isAsyncMode()) return
    autoSubmitCallback = cb
  },

  /** ShopScene onEnter 时注册清理回调，endSession 时调用 */
  registerClearShopState(cb: () => void): void {
    clearShopStateCallback = cb
  },

  /** ShopScene phaseBtn 点击时调用（替代 beginBattleStartTransition） */
  onPlayerReady(): void {
    if (!active || !session || !room) return
    const mySnap = getBattleSnapshot()
    if (!mySnap) {
      console.warn('[PvpContext] 快照为空，忽略 onPlayerReady')
      return
    }
    console.log('[PvpContext] onPlayerReady phase=' + currentDayPhase + ' day=' + session.currentDay + ' entities=' + mySnap.entities.length)

    if (!isAsyncMode()) {
      // sync-a：提交最终快照 + 立即发 sync_ready，停留商店等所有人准备好
      room.submitSnapshot(session.currentDay, mySnap, true)
      room.notifySyncReady(session.currentDay)
      stopCountdown()
      return
    }

    // async 三阶段逻辑
    if (currentDayPhase === 'shop1' || currentDayPhase === 'shop2') {
      // 提交中间快照（非最终），立即开始本地野怪战
      room.submitSnapshot(session.currentDay, mySnap, false)
      currentDayPhase = currentDayPhase === 'shop1' ? 'wild1' : 'wild2'
      startWildBattle()
    } else if (currentDayPhase === 'shop3') {
      // 提交最终快照，等待 Host 下发对手快照
      room.submitSnapshot(session.currentDay, mySnap, true)
      currentDayPhase = 'pvp'
      // 等待 onOpponentSnapshot 回调触发进入战斗
    }
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

  /** 获取上局所有玩家快照（round_summary 下发后可用，首局前为空） */
  getLastPlayerSnapshots(): Record<number, import('@/battle/BattleSnapshotStore').BattleSnapshotBundle> {
    return lastPlayerSnapshots
  },

  /** sync-a：获取当前轮已就绪的 playerIndex 列表 */
  getSyncReadyIndices(): number[] {
    return syncReadyIndices
  },

  /** sync-a：催促某个玩家 */
  sendUrge(targetPlayerIndex: number): void {
    if (!active || !room) return
    room.sendUrge(targetPlayerIndex)
  },

  /** sync-a：收到催促通知时触发（由 ShopScene 设置） */
  onUrgeReceived: null as ((fromPlayerIndex: number, fromNickname: string) => void) | null,

  /** 跳转战斗前触发（ShopScene 用于主动清理等待面板） */
  onBeforeBattleTransition: null as (() => void) | null,

  /** eliminatedPlayers 更新后触发（ShopScene 用于刷新等待面板） */
  onEliminatedPlayersUpdate: null as (() => void) | null,

  /** 对手 index 确认后触发（sync-a 缓存快照时，ShopScene 用于刷新等待面板对手卡） */
  onOpponentKnown: null as (() => void) | null,

  /** day_ready 携带轮空预分配后触发（ShopScene 用于补建对手徽章） */
  onOpponentPreAssigned: null as (() => void) | null,

  /** round_summary 收到后触发（ShopScene 用于补建对手英雄立绘，解决竞态） */
  onRoundSummaryReceived: null as (() => void) | null,

  /** sync_ready_update 收到后触发（ShopScene 用于刷新侧边卡就绪状态） */
  onSyncReadyUpdate: null as (() => void) | null,

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
    autoSubmitCallback = null
    session.currentOpponentPlayerIndex = undefined
    // 若 day_ready 比本次 onBattleComplete 更早到达（BattleScene 退出过渡期间），
    // currentOpponentPlayerIndex 已被上面清空，需从缓存补回。
    const nextDayForBye = session.currentDay + 1
    if (cachedByeOpponent && cachedByeOpponent.day === nextDayForBye) {
      session.currentOpponentPlayerIndex = cachedByeOpponent.opponentIdx
      cachedByeOpponent = undefined
    }

    if (isAsyncMode() && (currentDayPhase === 'wild1' || currentDayPhase === 'wild2')) {
      // 野怪轮结束：发放奖励，进入下一个商店阶段
      const won = pendingRoundWinner === 'player'
      grantWildBonus(won)
      pendingSurvivingDamage = 0
      currentDayPhase = currentDayPhase === 'wild1' ? 'shop2' : 'shop3'
      console.log('[PvpContext] 野怪轮结束 won=' + won + ' bonus=' + pendingWildGoldBonus + ' nextPhase=' + currentDayPhase)
      SceneManager.goto('shop')
      return
    }

    // PVP 轮结束（async: currentDayPhase === 'pvp'；sync-a: currentDayPhase === 'shop1'）
    const nextDay = session.currentDay + 1

    // 上报本轮结果（HP 系统：每轮都上报，由 round_summary 决定淘汰与否）
    // 注意：host 侧 onRoundSummary 可能在此同步触发并调用 goto('pvp-result')
    room?.reportRoundResult(session.currentDay, pendingRoundWinner, pendingSurvivingDamage)
    pendingSurvivingDamage = 0

    // host 路径：reportRoundResult 内部可能同步触发 game_over → onGameOver → session.rankings 被填充
    if (session.rankings) return

    // host 侧 onRoundSummary 可能已同步更新 eliminatedPlayers，若已淘汰则不再 goto('shop')
    if (session.eliminatedPlayers.includes(session.myIndex)) return

    // 非 host 客户端本地预判：若本轮负且 HP 会归零，跳过商店直接等待 round_summary 确认
    // 扣血公式与 host 一致：Math.max(1, Math.round(day))
    if (!room?.isHost && pendingRoundWinner === 'enemy') {
      const myHp = session.playerHps?.[session.myIndex] ?? session.initialHp
      const damage = Math.max(1, Math.round(session.currentDay))
      if (myHp - damage <= 0) {
        console.log('[PvpContext] 本地预判淘汰，等待 round_summary 确认')
        session.predictedElimination = true
        currentDayPhase = 'shop1'
        SceneManager.goto('pvp-result')
        return
      }
    }

    if (nextDay > (getConfig().pvpRules?.maxRounds ?? 30) + 2) {
      // 安全兜底：超过 maxRounds（PvpRoom 应更早触发 game_over）
      SceneManager.goto('pvp-result')
    } else {
      // 重置为下一天的 Shop1 阶段
      currentDayPhase = 'shop1'
      session.currentDay = nextDay

      // 房主负责触发下一天的倒计时
      if (room?.isHost) {
        room.advanceToDay(nextDay)
      }

      SceneManager.goto('shop')
    }
  },

  /** 当前天内阶段（shop1/wild1/shop2/wild2/shop3/pvp） */
  getCurrentDayPhase(): PvpDayPhase {
    return currentDayPhase
  },

  /** 是否处于中间商店阶段（shop2 或 shop3）：ShopScene 据此跳过基础日收入 */
  isMidDayShopPhase(): boolean {
    return currentDayPhase === 'shop2' || currentDayPhase === 'shop3'
  },

  /** 是否处于野怪轮（BattleScene 据此判断不上报 HP 结果） */
  isWildRound(): boolean {
    return currentDayPhase === 'wild1' || currentDayPhase === 'wild2'
  },

  /** ShopScene 进入 shop2/shop3 时消费野怪奖励金币（消费后清零） */
  consumePendingWildGoldBonus(): number {
    const bonus = pendingWildGoldBonus
    pendingWildGoldBonus = 0
    return bonus
  },

  /** ShopScene 进入时调用：通知 host 本玩家已到商店，所有人到齐后开始倒计时 */
  notifyShopEntered(): void {
    if (!active || !session || !room || isAsyncMode()) return
    room.notifyShopEntered(session.currentDay)
  },

  /** ShopScene 轮询：获取当前剩余倒计时毫秒数（0 表示未激活或已结束） */
  getCountdownRemainMs(): number {
    if (countdownStartMs === 0) return 0
    return Math.max(0, countdownTotalMs - (Date.now() - countdownStartMs))
  },

  /** PvpResultScene 离开时调用 */
  endSession(): void {
    // 清理 ShopScene 的 in-memory 状态，防止 PVP 残留存档污染 PVE 商店
    clearShopStateCallback?.()
    clearShopStateCallback = null
    // 清除 PVP 内存进度覆盖，恢复冒险模式从 localStorage 读取
    setPvpPlayerProgressOverride(null)
    room?.destroy()
    room = null
    session = null
    active = false
    syncStartCallbacks.clear()
    pendingOpponentSnap = null
    pendingSyncStartDay = 0
    syncReadyIndices = []
    PvpContext.onUrgeReceived = null
    PvpContext.onEliminatedPlayersUpdate = null
    PvpContext.onOpponentKnown = null
    PvpContext.onRoundSummaryReceived = null
    PvpContext.onOpponentPreAssigned = null
    pendingSurvivingDamage = 0
    pendingRoundWinner = 'draw'
    currentDayPhase = 'shop1'
    pendingWildGoldBonus = 0
    stopCountdown()
    lastPlayerSnapshots = {}
  },
}

// ----------------------------------------------------------------
// 野怪轮辅助函数
// ----------------------------------------------------------------

/** 开始本地野怪战：构造不含 pvpEnemyEntities 的快照，让 BattleScene 走 PVE 路径 */
function startWildBattle(): void {
  const snap = getBattleSnapshot()
  if (!snap) {
    console.warn('[PvpContext] startWildBattle: 无快照，跳过野怪战')
    return
  }
  // 排除所有 PVP 对手字段，确保 BattleScene 使用 PVE 生成路径
  const {
    pvpEnemyEntities: _e,
    pvpEnemySkillIds: _s,
    pvpEnemyBackpackItemCount: _b,
    pvpEnemyGold: _g,
    pvpEnemyTrophyWins: _t,
    ...baseSnap
  } = snap
  setBattleSnapshot(baseSnap)
  console.log('[PvpContext] 启动野怪战 phase=' + currentDayPhase + ' day=' + session?.currentDay)
  SceneManager.goto('battle')
}

/** 野怪胜利奖励：累积待发放金币 */
function grantWildBonus(won: boolean): void {
  if (!session) return
  if (won) {
    const dailyGold = getDailyGoldForDay(getConfig(), session.currentDay)
    const bonus = Math.floor(dailyGold * getWildWinBonusRatio())
    pendingWildGoldBonus += bonus
    console.log('[PvpContext] 野怪胜利奖励 +' + bonus + 'G (pendingTotal=' + pendingWildGoldBonus + ')')
  }
}

// ----------------------------------------------------------------
// 快照拼装：我的 entities 作为 player，对手 entities 作为 pvpEnemyEntities
// ----------------------------------------------------------------

function applyOpponentSnapshot(day: number, opponentSnap: BattleSnapshotBundle): void {
  // 跳转前主动清理等待面板（防止面板在 onPlayerReady 同步触发 goto 时还未加入 stage）
  PvpContext.onBeforeBattleTransition?.()
  PvpContext.onBeforeBattleTransition = null
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
    pvpEnemyBattleHp: opponentSnap.playerBattleHp,
    pvpEnemyHeroId: opponentSnap.ownerHeroId,
  }
  setBattleSnapshot(pvpSnap)
  SceneManager.goto('battle')
}

// ----------------------------------------------------------------
// 覆盖层 UI
// ----------------------------------------------------------------

function isAsyncMode(): boolean {
  return session?.pvpMode === 'async'
}

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
