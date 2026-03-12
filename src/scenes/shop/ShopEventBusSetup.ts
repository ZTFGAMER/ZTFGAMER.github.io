// ============================================================
// ShopEventBusSetup — EventBus 与 PVP 回调注册
// 提取自 ShopScene.ts Phase 8
// ============================================================

import type { ShopSceneCtx } from './ShopSceneContext'
import { Container } from 'pixi.js'
import { PvpContext } from '@/pvp/PvpContext'
import { clearBattleOutcome } from '@/combat/BattleOutcomeStore'
import { setBattleSnapshot } from '@/combat/BattleSnapshotStore'
import { buildBattleSnapshot } from './ShopBattleSnapshot'
import { clearPvpShopState } from './PvpPanel'
import { createHintToast } from './ShopToastSystem'
import { clearSelection } from './ShopDragSystem'
import type { ShopDragDeps } from './ShopDragSystem'

export type EventBusSetupCallbacks = {
  refreshShopUI: () => void
  refreshPlayerStatusUI: () => void
  dragDeps: ShopDragDeps
  pvpShowWaitingPanel: (stage: Container) => void
  pvpShowEggSplatOverlay: (name: string) => void
  pvpRefreshWaitingPanel: () => void
}

export function setupEventBusAndPvpCallbacks(
  stage: Container,
  ctx: ShopSceneCtx,
  callbacks: EventBusSetupCallbacks,
): void {
  ctx.events.removeAll()
  ctx.events.on('REFRESH_SHOP_UI',          ()       => callbacks.refreshShopUI())
  ctx.events.on('REFRESH_PLAYER_STATUS_UI', ()       => callbacks.refreshPlayerStatusUI())
  ctx.events.on('SHOW_TOAST',               (_reason) => {})
  ctx.events.on('SELECTION_CLEARED',        ()       => clearSelection(ctx, callbacks.dragDeps))

  PvpContext.registerClearShopState(() => clearPvpShopState(ctx))

  if (PvpContext.isActive()) {
    PvpContext.registerAutoSubmit(() => {
      clearBattleOutcome()
      ctx.pendingSkillBarMoveStartAtMs = Date.now()
      const snapshot = buildBattleSnapshot(ctx, ctx.pendingSkillBarMoveStartAtMs)
      if (snapshot) {
        setBattleSnapshot(snapshot)
        ctx.pendingBattleTransition = true
        ctx.pendingAdvanceToNextDay = true
        ctx.pvpReadyLocked = true
        if (PvpContext.getPvpMode() === 'sync-a') callbacks.pvpShowWaitingPanel(stage)
        PvpContext.onPlayerReady()
      }
    })
    PvpContext.notifyShopEntered()
    if (PvpContext.getPvpMode() === 'sync-a') {
      ctx.pvpUrgeCooldownSet.clear()
      PvpContext.onUrgeReceived = (fromPlayerIndex, fromNickname) => {
        const session = PvpContext.getSession()
        const fromPlayer = session?.players.find(p => p.index === fromPlayerIndex)
        const name = fromPlayer?.nickname ?? fromNickname
        callbacks.pvpShowEggSplatOverlay(name)
      }
      PvpContext.onBeforeBattleTransition = () => {
        if (ctx.pvpWaitingPanel) {
          ctx.pvpWaitingPanel.parent?.removeChild(ctx.pvpWaitingPanel)
          ctx.pvpWaitingPanel.destroy({ children: true })
          ctx.pvpWaitingPanel = null
        }
        if (ctx.pvpBackpackReturnBtn) {
          ctx.pvpBackpackReturnBtn.parent?.removeChild(ctx.pvpBackpackReturnBtn)
          ctx.pvpBackpackReturnBtn.destroy({ children: true })
          ctx.pvpBackpackReturnBtn = null
        }
      }
      PvpContext.onEliminatedPlayersUpdate = () => callbacks.pvpRefreshWaitingPanel()
      PvpContext.onOpponentKnown = () => callbacks.pvpRefreshWaitingPanel()
    }
  }

  ctx.battlePassivePrevStats.clear()
  ctx.battlePassiveResolvedStats.clear()
  ctx.passiveJumpLayer = new Container()
  ctx.passiveJumpLayer.eventMode = 'none'

  createHintToast(stage, ctx)
  ctx.showingBackpack = true
}
