// ============================================================
// PvpContext — PVP 全局协调器
// 桥接 PvpRoom ↔ SceneManager ↔ ShopScene/BattleScene
// ============================================================

import { SceneManager } from '@/nobag/core/NobagSceneManager'
import { getConfig } from '@/nobag/core/NobagDataLoader'
import { getBattleSnapshot, setBattleSnapshot } from '@/nobag/battle/BattleSnapshotStore'
import { consumeBattleOutcome } from '@/nobag/battle/BattleOutcomeStore'
import { setPvpPlayerProgressOverride } from '@/nobag/core/NobagRunState'

import type { PvpSession } from '@/nobag/pvp/NobagPvpTypes'
import type { BattleSnapshotBundle } from '@/nobag/battle/BattleSnapshotStore'

type RoundWinner = 'player' | 'enemy' | 'draw'

type PvpRoom = {
  isHost: boolean
  onRoomStateChange?: (players: PvpSession['players']) => void
  onError?: (msg: string) => void
  onDayReady?: (day: number, countdownMs: number, byeOpponentMap?: Record<number, number>) => void
  onCountdownStart?: (day: number) => void
  onPlayerStatusUpdate?: (day: number, readyIndices: number[]) => void
  onOpponentSnapshot?: (
    day: number,
    opponentSnap: BattleSnapshotBundle,
    opponentPlayerIndex?: number,
    authoritativeWinner?: RoundWinner,
  ) => void
  onGameOver?: (rankings: { nickname: string; wins: number | null; index: number }[]) => void
  onBattleSyncStart?: (day: number) => void
  onRoundSummary?: (
    day: number,
    hpMap: Record<number, number>,
    newlyEliminated: number[],
    snapshots: Record<number, BattleSnapshotBundle>,
    lastStandTriggered: number[],
  ) => void
  onSyncReadyUpdate?: (day: number, readyIndices: number[]) => void
  onUrgeNotify?: (fromPlayerIndex: number, fromNickname: string) => void
  submitSnapshot: (day: number, snapshot: BattleSnapshotBundle, isFinal?: boolean) => void
  notifySyncReady: (day: number) => void
  sendUrge: (targetPlayerIndex: number) => void
  reportRoundResult: (day: number, winner: RoundWinner, survivingDamage: number) => void
  notifyShopEntered: (day: number) => void
  advanceToDay: (day: number) => void
  destroy: () => void
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
let pendingOpponentSnap: import('@/nobag/battle/BattleSnapshotStore').BattleSnapshotBundle | null = null
let pendingSyncStartDay = 0  // battle_sync_start 比 opponent_snapshot 先到时记录
// sync-a: 当前轮各玩家就绪状态
let syncReadyIndices: number[] = []

// HP system state
let pendingSurvivingDamage = 0
let pendingRoundWinner: 'player' | 'enemy' | 'draw' = 'draw'
// 提前上报后 pendingSurvivingDamage 被清零，用此变量在 onBattleComplete 时仍能预判淘汰
let lastReportedSurvivingDamage = 0

// 上局所有玩家快照（round_summary 下发，用于商店阶段查看阵容）
let lastPlayerSnapshots: Record<number, import('@/nobag/battle/BattleSnapshotStore').BattleSnapshotBundle> = {}

// Host 权威战斗结果（从 opponent_snapshot 消息获得，结算时优先使用）
let pendingAuthoritativeWinner: 'player' | 'enemy' | 'draw' | null = null

// sync-a 轮空预分配缓存：day_ready 可能早于 onBattleComplete 到达，需在 onBattleComplete 后补回
let cachedByeOpponent: { day: number; opponentIdx: number } | undefined = undefined

// 提前上报优化：结算面板显示时立即上报，避免等待玩家点击按钮才上报导致卡顿
let preReportedDay = 0                       // 已提前上报的天数（0 = 未上报）
let hostReadyNextDay = 0                     // host onRoundSummary 已处理的下一天（0 = 未就绪）
let hostClickedBeforeRoundSummary = false    // host 先点击按钮但 round_summary 未到时的标志
// round_summary 到达天数记录：防止 round_summary 比按钮点击更早到达时，onBattleComplete 使用
// 已更新的 post-round HP/lastStand 状态做出错误的本地淘汰预判
let lastRoundSummaryDay = 0

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
    if (!session.lastStandUsedPlayers) session.lastStandUsedPlayers = {}
    session.pendingLastStandReward = false
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
      if (cur === 'nobag-shop' || cur === 'nobag-battle') {
        SceneManager.goto('pvp-result')
      }
    }

    // 注册房间回调
    pvpRoom.onDayReady = (day, countdownMs, byeOpponentMap) => {
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
      startCountdown()
    }

    pvpRoom.onPlayerStatusUpdate = () => { /* 不再显示玩家准备状态 */ }

    pvpRoom.onOpponentSnapshot = (day, opponentSnap, opponentPlayerIndex, authoritativeWinner) => {
      pendingAuthoritativeWinner = authoritativeWinner ?? null
      // 校验 day：只处理与当前天匹配的快照，防止乱序/残留消息导致误入战斗
      if (session && day !== session.currentDay) {
        console.warn('[PvpContext] 忽略不匹配的 opponent_snapshot day=' + day + ' (expected ' + session.currentDay + ')')
        return
      }
      // 只允许在商店阶段触发战斗跳转，其他场景（battle/pvp-lobby/pvp-result 等）一律忽略
      if (SceneManager.currentName() !== 'nobag-shop') {
        console.warn('[PvpContext] 当前不在商店，忽略 opponent_snapshot day=' + day + ' scene=' + SceneManager.currentName())
        return
      }
      // 记录 bye 轮实际对手 index 到 session（host 已解析出真实快照来源）
      if (session && opponentPlayerIndex !== undefined) {
        session.currentOpponentPlayerIndex = opponentPlayerIndex
      }

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
    }

    pvpRoom.onGameOver = (rankings) => {
      if (session) session.rankings = rankings
      // 胜者在 onBattleComplete 里已 advanceToDay 并 goto('nobag-shop')，此时需主动跳转结算
      // 观赛/结算场景已在 update() 中检测 rankings，不需要额外处理
      const cur = SceneManager.currentName()
      if (cur === 'nobag-shop' || cur === 'nobag-battle') {
        console.log('[PvpContext] game_over 到达，当前在 ' + cur + '，跳转结算页')
        stopCountdown()
        autoSubmitCallback = null
        SceneManager.goto('pvp-result')
      }
    }

    pvpRoom.onBattleSyncStart = (day) => {
      const cb = syncStartCallbacks.get(day)
      if (cb) { cb(); syncStartCallbacks.delete(day) }

      if (session) {
        // 忽略过期轮次的 battle_sync_start（stateCheckInterval 可能重播旧天的消息）
        if (day !== session.currentDay) {
          console.warn('[PvpContext] 忽略过期的 battle_sync_start day=' + day + ' (expected ' + session.currentDay + ')')
          return
        }
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

    pvpRoom.onRoundSummary = (day, hpMap, newlyEliminated, snapshots, lastStandTriggered) => {
      if (!session) return
      // 记录已到达的 round_summary 天数，供 onBattleComplete 检测（防止按钮点击晚于 round_summary）
      lastRoundSummaryDay = day
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
      // 标记淘汰
      newlyEliminated.forEach((idx) => {
        if (!session!.eliminatedPlayers.includes(idx)) {
          session!.eliminatedPlayers.push(idx)
        }
      })
      // 标记绝地反击触发（每人每局一次）
      if (!session.lastStandUsedPlayers) session.lastStandUsedPlayers = {}
      for (const idx of (lastStandTriggered ?? [])) {
        session.lastStandUsedPlayers[idx] = true
      }
      if ((lastStandTriggered ?? []).includes(session.myIndex)) {
        session.pendingLastStandReward = true
      }
      // 通知 ShopScene 快照已就绪（解决 round_summary 晚于 onEnter 的竞态）
      // 必须在 pendingLastStandReward 设置之后调用，否则 tryGrantLastStandReward 读不到最新标记
      PvpContext.onRoundSummaryReceived?.()
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
        } else if (!session.rankings) {
          // host 被淘汰但游戏未结束（≥2 人存活）：必须继续推进其他玩家的对局
          // 若不调用 advanceToDay，其他玩家将永远收不到 day_ready，游戏卡死
          const nextDay = day + 1
          if (nextDay <= (getConfig().pvpRules?.maxRounds ?? 30) + 2) {
            room.advanceToDay(nextDay)
          }
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
        session.currentDay = nextDay
        if (room?.isHost) {
          room.advanceToDay(nextDay)
        }
        SceneManager.goto('nobag-shop')
      } else if (room?.isHost) {
        // sync-a 房主非淘汰路径：round_summary 处理完毕，推进到下一天
        // advanceToDay 立即发出，让已进店的客户端尽早启动倒计时；
        // 若 host 已提前进入商店（hostClickedBeforeRoundSummary），只更新数据，不重复跳转
        if (session.rankings) return  // game_over 已处理
        const nextDay = day + 1
        if (nextDay > (getConfig().pvpRules?.maxRounds ?? 30) + 2) {
          SceneManager.goto('pvp-result')
        } else {
          room.advanceToDay(nextDay)
          if (hostClickedBeforeRoundSummary) {
            // host 已在 onBattleComplete 里提前进入商店，round_summary 数据（HP/淘汰）
            // 已在顶部静默更新，无需再次跳转
            hostClickedBeforeRoundSummary = false
          } else {
            // host 尚未点击按钮：记录 nextDay，点击时消费
            hostReadyNextDay = nextDay
          }
        }
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
    if (!session.lastStandUsedPlayers) session.lastStandUsedPlayers = {}
    if (!session.eliminatedPlayers) session.eliminatedPlayers = []
  },

  consumePendingLastStandReward(): boolean {
    if (!session?.pendingLastStandReward) return false
    session.pendingLastStandReward = false
    return true
  },

  /** ShopScene 注册自动提交回调 */
  registerAutoSubmit(cb: () => void): void {
    autoSubmitCallback = cb
  },

  /** ShopScene onEnter 时注册清理回调，endSession 时调用 */
  registerClearShopState(cb: () => void): void {
    clearShopStateCallback = cb
  },

  /** ShopScene phaseBtn 点击时调用 */
  onPlayerReady(): void {
    if (!active || !session || !room) return
    const mySnap = getBattleSnapshot()
    if (!mySnap) {
      console.warn('[PvpContext] 快照为空，忽略 onPlayerReady')
      return
    }
    console.log('[PvpContext] onPlayerReady day=' + session.currentDay + ' entities=' + mySnap.entities.length)
    room.submitSnapshot(session.currentDay, mySnap, true)
    room.notifySyncReady(session.currentDay)
    stopCountdown()
  },

  /** BattleScene 结算时调用：记录本场胜负（在 deductLife 等之前） */
  recordBattleResult(winner: 'player' | 'enemy' | 'draw', survivingDamage = 0): void {
    if (!session) return
    // PVP 模式优先使用 Host 权威结果，忽略本地引擎结果，彻底消除双端不一致
    const effectiveWinner = pendingAuthoritativeWinner ?? winner
    pendingAuthoritativeWinner = null
    if (effectiveWinner === 'player') session.wins++
    session.dayResults[session.currentDay] = effectiveWinner
    pendingSurvivingDamage = survivingDamage
    pendingRoundWinner = effectiveWinner
  },

  /** 获取当前权威结果（供 BattleSettlement 结算显示使用） */
  getAuthoritativeWinner(): 'player' | 'enemy' | 'draw' | null {
    return pendingAuthoritativeWinner
  },

  /** BattleScene 通知 sync-a 就绪 */
  notifyBattleSyncReady(day: number, onStart: () => void): void {
    if (!active || !room || !session) return
    syncStartCallbacks.set(day, onStart)
    room.notifySyncReady(day)
  },

  /** 获取上局所有玩家快照（round_summary 下发后可用，首局前为空） */
  getLastPlayerSnapshots(): Record<number, import('@/nobag/battle/BattleSnapshotStore').BattleSnapshotBundle> {
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
  getPvpMode(): import('./NobagPvpTypes').PvpMode | null {
    return session?.pvpMode ?? null
  },

  /** Returns whether the current player is the host */
  isHost(): boolean {
    return room?.isHost ?? false
  },

  /** BattleScene 退出过渡结束时调用（替代 SceneManager.goto('nobag-shop')） */
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

    // PVP 轮结束
    const nextDay = session.currentDay + 1

    // 上报本轮结果：若已由 reportBattleResultEarly 提前上报则跳过（幂等兜底）
    if (preReportedDay !== session.currentDay) {
      room?.reportRoundResult(session.currentDay, pendingRoundWinner, pendingSurvivingDamage)
      pendingSurvivingDamage = 0
    }

    // sync-a 房主路径
    if (room?.isHost) {
      if (session.rankings) return  // game_over 已处理
      if (hostReadyNextDay > 0) {
        // round_summary 已在提前上报后触发，直接跳转商店
        const goDay = hostReadyNextDay
        hostReadyNextDay = 0
        session.currentDay = goDay
        SceneManager.goto('nobag-shop')
      } else {
        // round_summary 尚未到达：先检查是否可本地预判淘汰（避免先进商店再被踢出）
        if (pendingRoundWinner === 'enemy') {
          const myHp = session.playerHps?.[session.myIndex] ?? session.initialHp
          const usedLastStand = session.lastStandUsedPlayers?.[session.myIndex] === true
          if (myHp - lastReportedSurvivingDamage <= 0 && !usedLastStand) {
            // 本地预判绝地反击触发：立即设置奖励，进店时直接发放，无需等 round_summary
            console.log('[PvpContext] 房主本地预判绝地反击，立即设置奖励')
            session.pendingLastStandReward = true
          } else if (myHp - lastReportedSurvivingDamage <= 0 && usedLastStand) {
            console.log('[PvpContext] 房主本地预判淘汰，等待 round_summary 确认')
            session.predictedElimination = true
            SceneManager.goto('pvp-result')
            return
          }
        }
        // 乐观推进，立即进商店，onRoundSummary 到达后静默更新数据
        hostClickedBeforeRoundSummary = true
        session.currentDay = nextDay
        SceneManager.goto('nobag-shop')
      }
      return
    }

    // client 路径：round_summary 可能已到达（提前上报后异步返回），rankings/eliminatedPlayers 已更新
    if (session.rankings) return

    // client 路径：onRoundSummary 可能已更新 eliminatedPlayers，若已淘汰则不再 goto('nobag-shop')
    if (session.eliminatedPlayers.includes(session.myIndex)) return

    // round_summary 已先于按钮点击到达：session.playerHps / lastStandUsedPlayers 已是 post-round 值
    // 直接进入下一天商店，跳过基于旧状态的本地淘汰预判，防止误触发 goto('pvp-result')
    if (lastRoundSummaryDay >= session.currentDay) {
      if (nextDay > (getConfig().pvpRules?.maxRounds ?? 30) + 2) {
        SceneManager.goto('pvp-result')
      } else {
        session.currentDay = nextDay
        SceneManager.goto('nobag-shop')
      }
      return
    }

    // 非 host 客户端本地预判：若本轮负且 HP 会归零，跳过商店直接等待 round_summary 确认
    // 扣血公式与 host 一致：Math.max(1, Math.round(day))
    if (pendingRoundWinner === 'enemy') {
      const myHp = session.playerHps?.[session.myIndex] ?? session.initialHp
      const damage = Math.max(1, Math.round(session.currentDay))
      const usedLastStand = session.lastStandUsedPlayers?.[session.myIndex] === true
      if (myHp - damage <= 0 && !usedLastStand) {
        // 本地预判绝地反击触发：立即设置奖励，进店时直接发放，无需等 round_summary
        console.log('[PvpContext] 本地预判绝地反击，立即设置奖励')
        session.pendingLastStandReward = true
      } else if (myHp - damage <= 0 && usedLastStand) {
        console.log('[PvpContext] 本地预判淘汰，等待 round_summary 确认')
        session.predictedElimination = true
        SceneManager.goto('pvp-result')
        return
      }
    }

    if (nextDay > (getConfig().pvpRules?.maxRounds ?? 30) + 2) {
      // 安全兜底：超过 maxRounds（PvpRoom 应更早触发 game_over）
      SceneManager.goto('pvp-result')
    } else {
      session.currentDay = nextDay
      SceneManager.goto('nobag-shop')
    }
  },

  /** BattleScene 结算面板显示时立即调用，提前上报本轮结果，不等待按钮点击（幂等）。 */
  reportBattleResultEarly(day: number): void {
    if (!active || !session || !room) return
    if (preReportedDay === day) return  // 已上报，幂等
    preReportedDay = day
    console.log('[PvpContext] reportBattleResultEarly day=' + day + ' winner=' + pendingRoundWinner + ' dmg=' + pendingSurvivingDamage)
    lastReportedSurvivingDamage = pendingSurvivingDamage
    room.reportRoundResult(day, pendingRoundWinner, pendingSurvivingDamage)
    pendingSurvivingDamage = 0
  },

  /** ShopScene 进入时调用：通知 host 本玩家已到商店，所有人到齐后开始倒计时 */
  notifyShopEntered(): void {
    if (!active || !session || !room) return
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
    lastReportedSurvivingDamage = 0
    pendingRoundWinner = 'draw'
    pendingAuthoritativeWinner = null
    preReportedDay = 0
    hostReadyNextDay = 0
    hostClickedBeforeRoundSummary = false
    lastRoundSummaryDay = 0
    stopCountdown()
    lastPlayerSnapshots = {}
  },
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
  // 始终以自己为 player、对手为 enemy 运行本地动画（自己在下方，敌人在上方）
  // 胜负判定由 Host 权威结果决定，本地动画仅用于视觉展示
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
  SceneManager.goto('nobag-battle')
}

// ----------------------------------------------------------------
// 倒计时
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
