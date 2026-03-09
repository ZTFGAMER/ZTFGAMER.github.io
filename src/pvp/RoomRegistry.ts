// ============================================================
// RoomRegistry — 房间注册表 HTTP 客户端
// 对应服务端：peer.kkopttarr.com/registry/rooms
// ============================================================

const BASE = 'https://peer.kkopttarr.com/registry'

export interface RoomInfo {
  roomId: string
  nickname: string
  roomName: string
  maxPlayers: number
  currentPlayers: number
  mode: string
  createdAt: number
}

export async function registerRoom(info: Omit<RoomInfo, 'createdAt'>): Promise<void> {
  await fetch(`${BASE}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(info),
  })
}

export async function unregisterRoom(roomId: string): Promise<void> {
  await fetch(`${BASE}/rooms/${roomId}`, { method: 'DELETE' })
}

export async function updateRoomPlayers(roomId: string, currentPlayers: number): Promise<void> {
  await fetch(`${BASE}/rooms/${roomId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPlayers }),
  })
}

export async function fetchRooms(): Promise<RoomInfo[]> {
  const res = await fetch(`${BASE}/rooms`)
  if (!res.ok) return []
  return res.json()
}
