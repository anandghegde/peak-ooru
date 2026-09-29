import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fakeName, WEIGHTS } from './fill'
import { nameKey } from './names'
import { Pool } from './pool'
import { closeSeason, current, openSeason, SETUPS } from './seasons'
import { SqliteStore } from './store'

/*
 * The server's commands, run against the store named by STORE (as the service is):
 *   season open <set-up> [--id x] [--name "…"] [--twist "…"] [--days 28] [--opens 2026-10-01T00:00:00+05:30]
 *   season close [id]      fixes the ranks of a season (the current one if none is named)
 *   season list
 *   verify [season]        plays every game again from its actions and reports any that differ from what is kept
 *   fill <count> [season]  made-up players and scores for the board: a scratch store only
 *   backup <file>          a consistent copy of the store, taken while the service runs
 */

const here = dirname(fileURLToPath(import.meta.url))
const env = process.env
const storeFile = resolve(env.STORE ?? resolve(here, '../.data/dev.db'))
const data = resolve(env.DATA ?? resolve(here, '../../public/data'))
const [command, ...args] = process.argv.slice(2)

const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const plain = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--')))

if (!existsSync(storeFile) && command !== 'season') {
  console.error(`There is no store at ${storeFile}.`)
  process.exit(1)
}
const store = new SqliteStore(storeFile)
const now = Date.now()

async function season() {
  const [what, name] = plain
  if (what === 'open') {
    const s = await openSeason(store, name ?? 'first', {
      id: flag('id'),
      name: flag('name'),
      twist: flag('twist'),
      days: flag('days') ? Number(flag('days')) : undefined,
      opens: flag('opens') ? Date.parse(flag('opens')!) : undefined,
    }, now)
    console.log(`Opened ${s.id} (${s.name}): ${s.opens} to ${s.closes}, rules ${s.rules}, allowance ${s.season.allowance === false ? 'off' : 'on'}.`)
  } else if (what === 'close') {
    const id = name ?? (await current(store, now))?.id
    if (!id) throw new Error('No season is open.')
    const n = await closeSeason(store, id, now)
    console.log(`Closed ${id}: ${n} ranks fixed.`)
  } else if (what === 'list') {
    for (const s of await store.seasons()) {
      const games = await store.seasonGames(s.id)
      console.log(`${s.id}\t${s.name}\t${s.opens} to ${s.closes}\t${s.closed ? `closed ${s.closed}` : 'open'}\trules ${s.rules}\t${games.length} games`)
    }
  } else {
    console.log(`season open <${Object.keys(SETUPS).join('|')}> | close [id] | list`)
  }
}

async function verify() {
  const seasons = plain[0] ? [(await store.season(plain[0]))!].filter(Boolean) : await store.seasons()
  if (!seasons.length) throw new Error('No such season.')
  const workers = Number(env.WORKERS ?? Math.max(1, availableParallelism() - 2))
  const pool = new Pool(new URL('./worker.js', import.meta.url), data, workers, 1_000_000)
  let checked = 0
  const differ: string[] = []
  const started = Date.now()
  for (const s of seasons) {
    const games = (await store.seasonGames(s.id)).filter((g) => !g.filled)
    await Promise.all(games.map(async (g) => {
      const months = await store.months(g.id)
      try {
        const out = await pool.run<{ digests: string[]; month: number; status: string }>({ kind: 'replay', season: s.season, months: months.map((m) => m.actions) })
        const first = months.findIndex((m, i) => m.digest !== out.digests[i])
        const last = out.digests.at(-1)
        if (first >= 0) differ.push(`${g.id}: differs from month ${months[first]!.month} (kept ${months[first]!.digest}, again ${out.digests[first]})`)
        else if (months.length && last !== g.digest) differ.push(`${g.id}: the kept state (${g.digest}) differs from the months played again (${last})`)
        else if (out.month !== g.month || out.status !== g.status) differ.push(`${g.id}: kept at month ${g.month} ${g.status}, played again to month ${out.month} ${out.status}`)
      } catch (e) {
        differ.push(`${g.id}: could not be played again: ${e instanceof Error ? e.message : String(e)}`)
      }
      checked++
    }))
  }
  await pool.close()
  console.log(`Played ${checked} games again in ${((Date.now() - started) / 1000).toFixed(1)} s with ${workers} workers.`)
  if (differ.length) {
    console.log(`${differ.length} differ:`)
    for (const d of differ) console.log(`  ${d}`)
    process.exitCode = 2
  } else console.log('Every game came out as kept.')
}

async function fill() {
  if (!(await store.meta('scratch'))) {
    throw new Error(`${storeFile} is not a scratch store. fill writes made-up players and scores, and runs only on a store made by \`npm run dev\` (or with SCRATCH=1).`)
  }
  const count = Number(plain[0] ?? 300)
  if (!Number.isInteger(count) || count < 1 || count > 100_000) throw new Error('Say how many players, from 1 to 100,000.')
  const s = plain[1] ? await store.season(plain[1]) : await current(store, now)
  if (!s) throw new Error('No season to fill.')
  const zones = (JSON.parse(readFileSync(resolve(data, 'zones.json'), 'utf8')) as { id: number }[]).map((z) => z.id)
  const random = (n: number) => randomBytes(4).readUInt32LE() % n
  const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 0.58
  let made = 0
  const taken = new Set((store.db.prepare('SELECT name_key FROM players WHERE name_key IS NOT NULL').all() as { name_key: string }[]).map((r) => r.name_key))
  store.db.exec('BEGIN')
  for (let i = 0; i < count; i++) {
    let name = fakeName(random)
    for (let k = 2; taken.has(nameKey(name)); k++) name = `${fakeName(random).slice(0, 16)} ${k}`
    taken.add(nameKey(name))
    const id = randomBytes(9).toString('base64url')
    const score = Math.max(150, Math.min(900, Math.round(520 + 150 * gauss())))
    const r = Math.random()
    const status = r < 0.55 ? 'finished' : r < 0.9 ? 'playing' : r < 0.96 ? 'replaced' : 'default'
    const month = status === 'finished' ? 120 : status === 'playing' ? 1 + random(119) : 24 + random(90)
    // Points near the score, each measure its own way, shifted so that their weighted sum is the score.
    const raw = WEIGHTS.map(() => Math.max(0, Math.min(1000, score + Math.round(140 * gauss()))))
    const off = score - Math.round(raw.reduce((t, p, k) => t + p * WEIGHTS[k]!, 0) / 1000)
    const points = raw.map((p) => Math.max(0, Math.min(1000, p + off)) / 10)
    const started = new Date(Date.parse(s.opens) + random(Math.max(1, Math.min(now, Date.parse(s.closes)) - Date.parse(s.opens)))).toISOString()
    const ended = status === 'playing' ? null : new Date(Math.min(now, Date.parse(started) + (10 + random(8)) * 86_400_000)).toISOString()
    const player = { id, name, email: null, friendCode: randomBytes(6).toString('hex').slice(0, 8).toUpperCase(), zone: zones[random(zones.length)]!, created: started }
    store.db.prepare('INSERT INTO players (id, name, name_key, email, friend_code, zone, created) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, name, nameKey(name), null, player.friendCode, player.zone, started)
    store.db.prepare(
      `INSERT INTO games (id, player, season, ranked, restarted, month, status, score, points, digest, started, ended, rank, filled)
        VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?, '', ?, ?, NULL, 1)`,
    ).run(randomBytes(9).toString('base64url'), id, s.id, month, status, score, JSON.stringify(points), started, ended)
    made++
  }
  store.db.exec('COMMIT')
  console.log(
    `Wrote ${made} made-up players to ${s.id}, each with a ranked game and a score from 150 to 900, straight into the ` +
      'store: these games were not played, have no months, and cannot be played again or looked round as they were.',
  )
}

try {
  if (command === 'season') await season()
  else if (command === 'verify') await verify()
  else if (command === 'fill') await fill()
  else if (command === 'backup') {
    const file = resolve(plain[0] ?? `peak-ooru-${new Date().toISOString().slice(0, 10)}.db`)
    await store.backup(file)
    console.log(`Copied the store to ${file}.`)
  } else console.log('Commands: season, verify, fill, backup.')
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exitCode = 1
} finally {
  await store.close()
}
