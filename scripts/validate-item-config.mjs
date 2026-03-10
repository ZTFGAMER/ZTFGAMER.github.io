import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const ITEMS_PATH = path.join(ROOT, 'data', 'vanessa_items.json')
const ICON_DIR = path.join(ROOT, 'resource', 'itemicon', 'vanessa')

const qualitySeriesLen = {
  Bronze: 7,
  Silver: 6,
  Gold: 4,
  Diamond: 2,
}

function loadItems() {
  const raw = fs.readFileSync(ITEMS_PATH, 'utf8')
  const items = JSON.parse(raw)
  if (!Array.isArray(items)) throw new Error('vanessa_items.json must be an array')
  return items
}

function splitSeries(text) {
  return String(text)
    .split(/[|/]/)
    .map((v) => v.trim())
    .filter(Boolean)
}

function collectSeriesFromSkills(skills) {
  const out = []
  for (const sk of skills || []) {
    const line = String(sk?.cn || '')
    const matches = line.match(/\d+(?:\.\d+)?%?(?:[|/]\d+(?:\.\d+)?%?)+/g) || []
    for (const m of matches) out.push(m)
  }
  return out
}

function main() {
  const items = loadItems()
  const errors = []
  const warns = []

  const idSet = new Set()
  const iconSet = new Set()

  for (const it of items) {
    const name = String(it.name_cn || '(unknown)')
    const id = String(it.id || '')
    const icon = String(it.icon || '')
    const tier = String(it.available_tiers || '').trim()

    if (!id) errors.push(`[${name}] missing id`)
    else if (idSet.has(id)) errors.push(`[${name}] duplicated id: ${id}`)
    else idSet.add(id)

    if (!icon) {
      errors.push(`[${name}] missing icon stem`)
    } else {
      if (iconSet.has(icon)) warns.push(`[${name}] duplicated icon stem: ${icon}`)
      iconSet.add(icon)
      const p = path.join(ICON_DIR, `${icon}.png`)
      if (!fs.existsSync(p)) errors.push(`[${name}] missing icon file: resource/itemicon/vanessa/${icon}.png`)
    }

    for (const av of it.attack_variants || []) {
      const stem = String(av || '').trim()
      if (!stem) continue
      const p = path.join(ICON_DIR, `${stem}.png`)
      if (!fs.existsSync(p)) errors.push(`[${name}] missing attack icon: resource/itemicon/vanessa/${stem}.png`)
    }

    const expected = qualitySeriesLen[tier]
    if (expected) {
      const series = []
      if (it.cooldown_tiers && it.cooldown_tiers !== '无') series.push(String(it.cooldown_tiers))
      series.push(...collectSeriesFromSkills(it.skills))
      for (const s of series) {
        const cnt = splitSeries(s).length
        if (cnt > 1 && cnt !== expected) {
          warns.push(`[${name}] series length ${cnt} != expected ${expected}: ${s}`)
        }
      }
    }
  }

  console.log(`Checked ${items.length} items`)
  if (warns.length) {
    console.log(`Warnings (${warns.length}):`)
    for (const w of warns) console.log(`- ${w}`)
  }
  if (errors.length) {
    console.error(`Errors (${errors.length}):`)
    for (const e of errors) console.error(`- ${e}`)
    process.exit(1)
  }
  console.log('Item config validation passed')
}

main()
