// ============================================================
// PeerConnection — PeerJS 底层封装
// 提供 Peer 实例管理和连接生命周期
// ============================================================

import Peer, { type DataConnection } from 'peerjs'

const PEERJS_CONFIG = {
  // 使用 PeerJS 公共信令服务器；正式上线建议自托管
  debug: 0,
}

/** 生成 6 位大写字母数字房间码 */
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export class PeerConnection {
  private peer: Peer | null = null
  private _peerId: string | null = null

  get peerId(): string | null {
    return this._peerId
  }

  /** 以指定 ID 创建 Peer（房主用自己生成的房间码，客户端用随机 ID） */
  create(id?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const p = id ? new Peer(id, PEERJS_CONFIG) : new Peer(PEERJS_CONFIG)
      this.peer = p

      const timeout = setTimeout(() => {
        reject(new Error('连接信令服务器超时，请检查网络'))
      }, 10000)

      p.on('open', (assignedId) => {
        clearTimeout(timeout)
        this._peerId = assignedId
        resolve(assignedId)
      })

      p.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }

  /** 连接到目标 Peer，返回 DataConnection */
  connect(targetId: string): Promise<DataConnection> {
    if (!this.peer) return Promise.reject(new Error('Peer 未初始化'))
    return new Promise((resolve, reject) => {
      const conn = this.peer!.connect(targetId, { reliable: true })

      const timeout = setTimeout(() => {
        reject(new Error('连接超时'))
      }, 10000)

      conn.on('open', () => {
        clearTimeout(timeout)
        resolve(conn)
      })

      conn.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }

  /** 注册有人连接到我时的回调 */
  onConnection(cb: (conn: DataConnection) => void): void {
    this.peer?.on('connection', cb)
  }

  /** 注册 Peer 错误回调 */
  onError(cb: (err: Error) => void): void {
    this.peer?.on('error', cb)
  }

  destroy(): void {
    this.peer?.destroy()
    this.peer = null
    this._peerId = null
  }
}
