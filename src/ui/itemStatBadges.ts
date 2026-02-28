import { Container, Graphics, Text } from 'pixi.js'
import type { ItemDef } from '@/items/ItemDef'
import { getConfig as getDebugCfg } from '@/config/debugConfig'

type StatKey = 'damage' | 'shield' | 'heal' | 'burn' | 'poison'

const STAT_ORDER: StatKey[] = ['damage', 'shield', 'heal', 'burn', 'poison']

function getStatColor(key: StatKey): number {
  if (key === 'shield') return Math.round(getDebugCfg('battleColorShield'))
  if (key === 'heal') return Math.round(getDebugCfg('battleColorRegen'))
  if (key === 'burn') return Math.round(getDebugCfg('battleColorBurn'))
  if (key === 'poison') return Math.round(getDebugCfg('battleColorPoison'))
  return Math.round(getDebugCfg('battleOrbColorHp'))
}

function toDisplayNumber(value: number): string {
  if (Math.abs(value - Math.round(value)) < 0.001) return String(Math.round(value))
  return String(Math.round(value * 10) / 10)
}

function toBadgeText(value: number, multicast: number): string {
  const base = toDisplayNumber(value)
  if (multicast > 1) return `${base}x${Math.round(multicast)}`
  return base
}

export function createItemStatBadges(item: ItemDef, fontSize: number, maxWidth: number): Container {
  const badges = STAT_ORDER
    .map((k) => ({ key: k, value: item[k] }))
    .filter((it) => Number.isFinite(it.value) && it.value > 0)
  const root = new Container()
  if (badges.length === 0) return root

  const gapX = 4
  const gapY = 2
  const padX = 8
  const padY = 3
  const safeMaxWidth = Math.max(44, maxWidth)

  const multicast = Math.max(1, Math.round(item.multicast || 1))
  const nodes = badges.map((it) => {
    const txt = new Text({
      text: toBadgeText(it.value, multicast),
      style: {
        fontSize,
        fill: 0xffffff,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x000000, width: 2 },
      },
    })
    const w = txt.width + padX * 2
    const h = txt.height + padY * 2
    const con = new Container()
    const bg = new Graphics()
    bg.roundRect(0, 0, w, h, 6)
    bg.fill({ color: getStatColor(it.key), alpha: 0.95 })
    bg.roundRect(0, 0, w, h, 6)
    bg.stroke({ color: 0x000000, width: 2, alpha: 0.88 })
    con.addChild(bg)
    txt.x = padX
    txt.y = padY
    con.addChild(txt)
    return { con, w, h }
  })

  const rows: Array<Array<{ con: Container; w: number; h: number }>> = []
  let row: Array<{ con: Container; w: number; h: number }> = []
  let rowW = 0
  for (const n of nodes) {
    const nextW = row.length === 0 ? n.w : rowW + gapX + n.w
    if (row.length > 0 && nextW > safeMaxWidth) {
      rows.push(row)
      row = [n]
      rowW = n.w
    } else {
      row.push(n)
      rowW = nextW
    }
  }
  if (row.length > 0) rows.push(row)

  let cursorY = -4
  for (const r of rows) {
    const width = r.reduce((sum, n, idx) => sum + n.w + (idx > 0 ? gapX : 0), 0)
    const rowH = r.reduce((m, n) => Math.max(m, n.h), 0)
    const rowY = cursorY - rowH
    let x = -width / 2
    for (const n of r) {
      n.con.x = x
      n.con.y = rowY
      root.addChild(n.con)
      x += n.w + gapX
    }
    cursorY = rowY - gapY
  }

  return root
}
