// ============================================================
// EventBus — 类型安全的全局事件总线
// 逻辑层通过 emit 发布事件，表现层（渲染/音效/UI）订阅事件
// 两层完全解耦，互不直接引用
// ============================================================

/** 全局事件类型表 —— 在此处扩展新事件 */
export type GameEvents = {
  // 战斗事件
  'battle:item_fire':    { itemId: string; sourceItemId: string; side: 'player' | 'enemy'; multicast: number };
  'battle:take_damage':  {
    targetId: string;
    sourceItemId: string;
    amount: number;
    isCrit: boolean;
    type: 'normal' | 'burn' | 'poison';
    targetType?: 'hero' | 'item';
    targetSide?: 'player' | 'enemy';
    sourceType?: 'hero' | 'item' | 'system';
    sourceSide?: 'player' | 'enemy' | 'system';
    baseDamage?: number;
    finalDamage?: number;
  };
  'battle:gain_shield':  {
    targetId: string;
    sourceItemId: string;
    amount: number;
    targetType?: 'hero' | 'item';
    targetSide?: 'player' | 'enemy';
    sourceType?: 'hero' | 'item' | 'system';
    sourceSide?: 'player' | 'enemy' | 'system';
  };
  'battle:heal':         {
    targetId: string;
    sourceItemId: string;
    amount: number;
    isRegen: boolean;
    targetType?: 'hero' | 'item';
    targetSide?: 'player' | 'enemy';
    sourceType?: 'hero' | 'item' | 'system';
    sourceSide?: 'player' | 'enemy' | 'system';
  };
  'battle:status_apply': {
    targetId: string;
    sourceItemId: string;
    status: StatusType;
    amount: number;
    targetType?: 'hero' | 'item';
    targetSide?: 'player' | 'enemy';
    sourceType?: 'hero' | 'item' | 'system';
    sourceSide?: 'player' | 'enemy' | 'system';
  };
  'battle:status_remove':{
    targetId: string;
    status: StatusType;
    targetType?: 'hero' | 'item';
    targetSide?: 'player' | 'enemy';
  };
  'battle:fatigue_start': { elapsedMs: number };
  'battle:fatigue_tick':  { elapsedMs: number; tick: number; playerDamage: number; enemyDamage: number };
  'battle:unit_die':     { unitId: string; side: 'player' | 'enemy' };
  'battle:end':          { winner: 'player' | 'enemy' | 'draw'; blameLog: string[] };

  // 商店事件
  'shop:item_bought':    { itemId: string; cost: number };
  'shop:item_sold':      { itemId: string; refund: number };
  'shop:refresh':        { cost: number };
  'shop:gold_changed':   { gold: number; delta: number };

  // 流程事件
  'game:day_start':      { day: number; gold: number };
  'game:scene_change':   { from: SceneName; to: SceneName };
};

export type StatusType = 'burn' | 'poison' | 'regen' | 'freeze' | 'haste' | 'slow';
export type SceneName  = 'shop' | 'battle' | 'result';

type Listener<T> = (payload: T) => void;

class EventBusImpl {
  private listeners = new Map<keyof GameEvents, Listener<unknown>[]>();

  on<K extends keyof GameEvents>(event: K, cb: Listener<GameEvents[K]>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(cb as Listener<unknown>);
    // 返回取消订阅函数
    return () => this.off(event, cb);
  }

  off<K extends keyof GameEvents>(event: K, cb: Listener<GameEvents[K]>): void {
    const list = this.listeners.get(event);
    if (!list) return;
    const idx = list.indexOf(cb as Listener<unknown>);
    if (idx !== -1) list.splice(idx, 1);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    this.listeners.get(event)?.forEach(cb => cb(payload as unknown));
  }

  /** 清空所有监听（场景切换时调用） */
  clear(): void {
    this.listeners.clear();
  }

  /** 返回当前订阅数（用于测试验证） */
  listenerCount(event: keyof GameEvents): number {
    return this.listeners.get(event)?.length ?? 0;
  }
}

export const EventBus = new EventBusImpl();
