// ============================================================
// WsConnection — WebSocket 中继传输层
// 替代 PeerJS P2P，所有消息经服务端 wss://peer.kkopttarr.com/relay 转发
// 对外接口与原 PeerConnection + DataConnection 保持一致，PvpRoom.ts 无需感知底层变化
// ============================================================

const WS_RELAY_URL = 'wss://peer.kkopttarr.com/relay'

/** 简易 EventEmitter，模拟 PeerJS DataConnection 的事件接口 */
class SimpleEventEmitter {
  private _listeners = new Map<string, Array<(...args: unknown[]) => void>>()

  on(event: string, handler: (...args: unknown[]) => void): void {
    if (!this._listeners.has(event)) this._listeners.set(event, [])
    this._listeners.get(event)!.push(handler)
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    const list = this._listeners.get(event)
    if (!list) return
    const idx = list.indexOf(handler)
    if (idx >= 0) list.splice(idx, 1)
  }

  emit(event: string, ...args: unknown[]): void {
    const list = this._listeners.get(event) ?? []
    // 复制一份，防止回调内修改 listeners 导致问题
    for (const h of [...list]) h(...args)
  }
}

/**
 * 虚拟数据连接，模拟 PeerJS DataConnection 接口。
 * 底层只有一条 WebSocket 连接到服务器，此类仅代表"与某个 peer 的逻辑通道"。
 */
export class VirtualDataConnection extends SimpleEventEmitter {
  /** 远端 peer 的 ID（对应 PeerJS DataConnection.peer） */
  readonly peer: string
  private _closeFired = false

  constructor(
    private ws: WebSocket,
    remotePeerId: string,
  ) {
    super()
    this.peer = remotePeerId
  }

  send(data: unknown): void {
    if (this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WsConnection] send() called but ws not open, peer=' + this.peer)
      // ws 处于 CLOSING/CLOSED 状态，连接已断——主动通知上层触发断线处理
      // （ws.onclose 可能还未触发，提前感知避免消息静默丢失后卡住）
      if (this.ws.readyState !== WebSocket.CONNECTING) {
        this._receiveClose()
      }
      return
    }
    try {
      this.ws.send(JSON.stringify({ type: 'data', toId: this.peer, payload: data }))
    } catch (e) {
      console.warn('[WsConnection] send error', e)
    }
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'close', toId: this.peer }))
      } catch { /* ignore */ }
    }
    this.emit('close')
  }

  /** 由 WsConnection 内部调用 */
  _receiveData(data: unknown): void { this.emit('data', data) }
  _receiveClose(): void {
    if (this._closeFired) return
    this._closeFired = true
    this.emit('close')
  }
  _receiveError(err: unknown): void { this.emit('error', err) }
}

/** 生成 4 位数字房间码 */
export function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

/**
 * WebSocket 中继连接管理器，替代原 PeerConnection（PeerJS）。
 * 与服务器维护唯一一条 WebSocket 连接；通过消息信封模拟多路虚拟连接。
 */
export class WsConnection {
  private ws: WebSocket | null = null
  private _peerId: string | null = null
  private virtualConns = new Map<string, VirtualDataConnection>()
  private onConnectionCb?: (conn: VirtualDataConnection) => void
  private onErrorCb?: (err: Error) => void

  get peerId(): string | null { return this._peerId }

  /**
   * 连接到 relay 服务器并注册 peerId。
   * @param id 指定 ID（房主传入房间码），不传则服务端自动分配（目前由客户端本地生成随机 ID）
   */
  create(id?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_RELAY_URL)
      this.ws = ws

      const timeout = setTimeout(() => {
        reject(new Error('连接信令服务器超时，请检查网络'))
      }, 10000)

      ws.onopen = () => {
        const peerId = id ?? this._generateRandomId()
        this._peerId = peerId
        ws.send(JSON.stringify({ type: 'register', peerId }))
      }

      ws.onmessage = (event) => {
        let msg: Record<string, unknown>
        try { msg = JSON.parse(event.data as string) } catch { return }

        switch (msg.type) {
          case 'registered':
            clearTimeout(timeout)
            resolve(this._peerId!)
            break

          case 'connection': {
            // 房主收到：有客户端想连接进来
            const fromId = msg.fromId as string
            const conn = new VirtualDataConnection(ws, fromId)
            this.virtualConns.set(fromId, conn)
            this.onConnectionCb?.(conn)
            // 服务端已完成路由注册，立即触发 open
            setTimeout(() => conn.emit('open'), 0)
            break
          }

          case 'connected': {
            // 客户端收到：到房主的连接已建立
            const toId = msg.toId as string
            const conn = this.virtualConns.get(toId)
            if (conn) setTimeout(() => conn.emit('open'), 0)
            break
          }

          case 'data': {
            const fromId = msg.fromId as string
            this.virtualConns.get(fromId)?._receiveData(msg.payload)
            break
          }

          case 'close': {
            const fromId = msg.fromId as string
            const conn = this.virtualConns.get(fromId)
            if (conn) {
              conn._receiveClose()
              this.virtualConns.delete(fromId)
            }
            break
          }

          case 'error':
            this.onErrorCb?.(new Error(msg.message as string))
            break
        }
      }

      ws.onerror = () => {
        clearTimeout(timeout)
        reject(new Error('WebSocket 连接失败，请检查网络'))
      }

      ws.onclose = () => {
        // 底层断开时通知所有虚拟连接
        for (const conn of this.virtualConns.values()) conn._receiveClose()
        this.virtualConns.clear()
      }
    })
  }

  /** 连接到目标 peer（客户端调用），返回 VirtualDataConnection */
  connect(targetId: string): Promise<VirtualDataConnection> {
    if (!this.ws || !this._peerId) return Promise.reject(new Error('WsConnection 未初始化'))

    return new Promise((resolve, reject) => {
      const conn = new VirtualDataConnection(this.ws!, targetId)
      this.virtualConns.set(targetId, conn)

      const timeout = setTimeout(() => {
        reject(new Error('连接超时'))
      }, 10000)

      conn.on('open', () => {
        clearTimeout(timeout)
        resolve(conn)
      })

      conn.on('error', (err: unknown) => {
        clearTimeout(timeout)
        reject(err)
      })

      // 向服务器发送连接请求
      this.ws!.send(JSON.stringify({ type: 'connect', toId: targetId }))
    })
  }

  onConnection(cb: (conn: VirtualDataConnection) => void): void {
    this.onConnectionCb = cb
  }

  onError(cb: (err: Error) => void): void {
    this.onErrorCb = cb
  }

  destroy(): void {
    this.ws?.close()
    this.ws = null
    this._peerId = null
    this.virtualConns.clear()
  }

  private _generateRandomId(): string {
    return Math.random().toString(36).slice(2, 10)
  }
}
