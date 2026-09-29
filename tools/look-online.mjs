// Plays the game online, as players would, against the server on port 5210 (PEAKOORU_SERVER sets another) and a built
// copy of the game: a first visit; a month ended and checked; the board with the crowd the server's `fill` made, and
// with 50,000 made-up rows from the page's own stand-in; another player's city; naming; a second device on the same
// account; the server going away in the middle of a game and coming back; a month refused for the daily allowance
// (the stand-in, with the allowance on, since the server's first season has it off). Saves screenshots to
// tools/shots/online-*.png and prints timings and anything wrong in the page.
// Usage: node tools/look-online.mjs [laptop|phone|widths] ; build it first: the script builds its own copy.
import { execSync, spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const PORT = 5212
const SERVER = process.env.PEAKOORU_SERVER ?? 'http://localhost:5210'
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const screens = [
  { name: 'laptop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
]
const widths = [360, 390, 768, 900, 1280, 1920]

if (!(await fetch(`${SERVER}/api/me`).then((r) => r.status === 401, () => false))) {
  console.error(`The server does not answer at ${SERVER}. Start it (cd server && npm run dev) first.`)
  process.exit(1)
}
const out = mkdtempSync(join(tmpdir(), 'peakooru-online-'))
execSync(`npx vite build --outDir ${out} --emptyOutDir`, { stdio: 'ignore' })
if (await fetch(`http://localhost:${PORT}/`).then(() => true, () => false)) {
  console.error(`Port ${PORT} is taken, perhaps by a preview server left over from an earlier run. Stop it first.`)
  process.exit(1)
}
const preview = spawn('node_modules/.bin/vite', ['preview', '--outDir', out, '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore', env: { ...process.env, PEAKOORU_SERVER: SERVER },
})
process.on('exit', () => preview.kill())
for (let i = 0; i < 50; i++) {
  if (await fetch(`http://localhost:${PORT}/`).then((r) => r.ok, () => false)) break
  await new Promise((r) => setTimeout(r, 200))
}
const BASE = `http://localhost:${PORT}/?measure`
const STANDIN = `${BASE}&standin-server`

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const figures = {}
const errors = []

/** A new browser: a new device, with nothing kept. */
async function device(screen, storage) {
  const { name, ...options } = screen
  const context = await browser.newContext({ ...options, storageState: storage })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${String(e)}`))
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${name}: ${m.text()}`))
  return { context, page }
}

function helpers(page, screen, prefix) {
  let shot = 0
  return {
    snap: async (what) => {
      await page.waitForTimeout(300)
      const path = `tools/shots/online-${prefix}-${String(++shot).padStart(2, '0')}-${what}.png`
      await page.screenshot({ path })
      console.log('saved', path)
    },
    press: async (selector) => {
      const target = page.locator(selector).first()
      await target.waitFor({ state: 'visible', timeout: 30000 })
      if (screen.hasTouch) await target.tap()
      else await target.click()
    },
    idle: () => page.waitForFunction(() => window.peakooru?.play && !window.peakooru.play.busy, null, { timeout: 300000 }),
    ready: () => page.waitForFunction(() => window.peakooru?.month && window.peakooru.play?.game && window.peakooru.map.loaded()
      && !window.peakooru.play.busy, null, { timeout: 120000 }),
    sent: () => page.waitForFunction(() => window.peakooru.net.outbox.queue.length === 0, null, { timeout: 120000 }),
    game: () => page.evaluate(() => {
      const g = window.peakooru.play.game
      return { month: g.month, done: g.done.length, score: g.score?.total, money: g.money, status: g.status }
    }),
    skipIntro: async () => {
      // A new game's introduction comes once the map has settled: waited for a moment.
      const fresh = await page.evaluate(() => (window.peakooru?.play?.game?.month ?? 0) === 0)
      if (fresh) await page.waitForSelector('.intro:not([hidden])', { timeout: 8000 }).catch(() => null)
      if (await page.locator('.intro:not([hidden])').count()) await page.locator('.intro .quiet').last().click()
      // A game under way opens on the welcome back: carried on from at once.
      const month = await page.evaluate(() => window.peakooru?.play?.game?.month ?? 0)
      if (month > 0 && await page.waitForSelector('.ending.welcome', { timeout: 6000 }).then(() => true, () => false)) {
        await page.locator('.ending.welcome .commit').click()
      }
    },
    tab: async (which) => {
      const open = await page.evaluate(() => window.peakooru.panel.tab)
      if (open !== which) await page.locator(`.tabs button[data-tab="${which}"]`).first().click()
    },
  }
}

async function nextMonth(page, h) {
  const before = (await h.game()).month
  const t0 = Date.now()
  await h.press('.next')
  await page.waitForFunction((m) => window.peakooru.play.game.month === m + 1 && window.peakooru.month, before, { timeout: 60000 })
  const shown = Date.now() - t0
  await h.idle()
  return shown
}

for (const screen of screens) {
  if (only.length && !only.includes(screen.name)) continue
  const f = (figures[screen.name] = {})

  // A first visit: no account, no question; the server makes a player and a game.
  const a = await device(screen)
  const h = helpers(a.page, screen, screen.name)
  let t0 = Date.now()
  await a.page.goto(BASE)
  await a.page.waitForFunction(() => window.peakooru?.play?.game, null, { timeout: 120000 })
  f.firstGameMs = Date.now() - t0
  await h.ready()
  f.firstMonthShownMs = Date.now() - t0
  await a.page.waitForSelector('.intro:not([hidden])', { timeout: 15000 }).catch(() => null)
  f.introShownMs = Date.now() - t0
  f.introShown = await a.page.locator('.intro:not([hidden])').count() > 0
  f.formsOnFirstVisit = await a.page.locator('input:visible').count()
  await h.snap('first-visit')
  await h.skipIntro()

  // A month ended, with something done in it: shown at once, and checked by the server after.
  f.taxRaised = await a.page.evaluate(() => window.peakooru.act({ kind: 'tax', rate: 10500 }))
  f.monthShownMs = await nextMonth(a.page, h)
  t0 = Date.now()
  await h.sent()
  f.monthCheckedMs = Date.now() - t0
  f.afterMonth = await a.page.evaluate(() => ({ summary: window.peakooru.net.summary.month, local: window.peakooru.play.game.month, notice: window.peakooru.play.notice }))
  await h.snap('month-checked')
  await h.tab('score')
  await h.snap('score-page')

  // Two more months, skipped, sent one by one in order.
  await h.press('.skip')
  await h.press('.skip-menu button[data-skip="3"]')
  await h.idle()
  await h.sent()
  f.afterSkip = await a.page.evaluate(() => ({ server: window.peakooru.net.summary.month, local: window.peakooru.play.game.month, notice: window.peakooru.play.notice, fingerprintsDiffered: window.peakooru.own.differed }))
  f.serverList = await a.page.evaluate(async () => { const n = window.peakooru.net; const g = await n.server.game(n.session.game); return { month: g.game.month, done: g.done, score: g.game.score, local: window.peakooru.play.game.score.total } })

  // The board, which asks for a name the first time.
  await h.tab('board')
  await a.page.waitForSelector('.name-box input', { timeout: 30000 })
  await h.snap('board-asks-name')
  await a.page.fill('.name-box input', `Tester ${screen.name} ${Date.now() % 1000}`)
  await a.page.locator('.name-box .commit').click()
  await a.page.waitForFunction(() => !document.querySelector('.name-box') || document.querySelector('.one-field-said')?.textContent, null, { timeout: 30000 })
  f.namingSaid = await a.page.evaluate(() => document.querySelector('.one-field-said')?.textContent ?? null)
  f.boardMine = await a.page.evaluate(async () => {
    const n = window.peakooru.net
    return (await n.server.board(n.session.season.id, 'all', 0, 1)).mine
  })
  await a.page.waitForTimeout(800)
  f.boardRowsDrawn = await a.page.locator('.board-list .board-row').count()
  await h.snap('board-named')
  await h.press('.season-tabs button[data-view="games"]')
  await h.snap('your-games')
  await h.press('.season-tabs button[data-view="you"]')
  await h.snap('you')
  await h.press('.season-tabs button[data-view="board"]')
  // The ending as it would stand now, with the rank in its box.
  await a.page.evaluate(() => window.peakooru.ending())
  await a.page.waitForFunction(() => document.querySelector('.final-rank.filled'), null, { timeout: 30000 }).catch(() => null)
  f.endingRank = await a.page.evaluate(() => document.querySelector('.final-rank')?.textContent)
  await h.snap('ending-rank')
  await a.page.evaluate(() => document.querySelector('.final-veil')?.remove())

  // A second device on the same account: the game is further on at the server, and is played again from its list.
  const storage = await a.context.storageState()
  const token = storage.origins.flatMap((o) => o.localStorage).find((x) => x.name === 'peakooru.net')
  const b = await device(screen, {
    cookies: [], origins: [{ origin: `http://localhost:${PORT}`, localStorage: [{ name: 'peakooru.net', value: JSON.stringify({ token: JSON.parse(token.value).token }) }] }],
  })
  const hb = helpers(b.page, screen, `${screen.name}-second`)
  t0 = Date.now()
  await b.page.goto(BASE)
  await hb.ready()
  f.secondDevice = { ms: Date.now() - t0, ...(await hb.game()), first: await h.game() }
  await hb.skipIntro()
  await hb.snap('second-device')
  await b.context.close()

  // The server goes away in the middle of the game: months are kept, the tab is closed, and they go when it is back.
  await a.page.route('**/api/**', (route) => route.abort('internetdisconnected'))
  await nextMonth(a.page, h)
  await nextMonth(a.page, h)
  await a.page.waitForTimeout(1500)
  f.offline = await a.page.evaluate(() => ({ queued: window.peakooru.net.outbox.queue.length, offline: window.peakooru.net.outbox.offline, bar: document.querySelector('.bar-unsent')?.textContent }))
  await h.snap('offline')
  const reopened = await a.context.newPage()
  await a.page.close()
  await reopened.route('**/api/**', (route) => route.abort('internetdisconnected'))
  const hr = helpers(reopened, screen, `${screen.name}-reopened`)
  await reopened.goto(BASE)
  await hr.ready()
  await hr.skipIntro()
  f.reopenedOffline = { ...(await hr.game()), queued: await reopened.evaluate(() => window.peakooru.net.outbox.queue.length) }
  await hr.snap('reopened-offline')
  await reopened.unroute('**/api/**')
  await reopened.evaluate(() => window.peakooru.net.outbox.poke())
  t0 = Date.now()
  await hr.sent()
  f.backOnline = { ms: Date.now() - t0, server: await reopened.evaluate(() => window.peakooru.net.summary.month), ...(await hr.game()) }
  await hr.snap('back-online')

  // Another player's city, from a finished row of the board, and back to the player's own game unchanged.
  const mine = await hr.game()
  await hr.tab('board')
  await reopened.waitForSelector('.board-list .board-row:not(.waiting)', { timeout: 30000 }).catch(() => null)
  // The first finished city on the board, wherever it stands: scrolled to, then chosen as a player would.
  const openRank = await reopened.evaluate(async () => {
    const n = window.peakooru.net
    for (let from = 0; from < 5000; from += 100) {
      const b = await n.server.board(n.session.season.id, 'all', from, 100)
      const row = b.rows.find((r) => r.open && r.game !== n.session.game)
      if (row) return row.rank
      if (from + 100 >= b.total) return null
    }
    return null
  })
  if (openRank) {
    await reopened.evaluate((rank) => {
      const body = document.querySelector('.panel-body')
      body.scrollTop = document.querySelector('.board-list').offsetTop + (rank - 1) * 44 - 60
    }, openRank)
    await reopened.waitForTimeout(800)
  }
  const open = reopened.locator('.board-list .board-row.open').first()
  if (await open.count()) {
    t0 = Date.now()
    await open.click()
    await reopened.waitForFunction(() => window.peakooru.viewing && !window.peakooru.play.busy && window.peakooru.panel.tab === 'score', null, { timeout: 300000 })
    f.theirCityMs = Date.now() - t0
    f.theirCityGame = await hr.game()
    await hr.snap('their-city')
    await hr.tab('report')
    await hr.snap('their-deeds')
    await hr.press('.turn .back')
    await reopened.waitForFunction(() => !window.peakooru.viewing && window.peakooru.play.game.status === 'playing' && !window.peakooru.play.busy, null, { timeout: 60000 })
    f.backToMine = { before: mine, after: await hr.game() }
  } else f.theirCity = 'no finished city on the board: run `npm run fill` in server/'
  await a.context.close()

  // The board with 50,000 rows, from the page's stand-in, and the daily allowance running out and a month refused.
  const c = await device(screen)
  const hc = helpers(c.page, screen, `${screen.name}-standin`)
  await c.page.goto(`${STANDIN}&crowd=50000&allowance=on`)
  await hc.ready()
  await hc.skipIntro()
  await c.page.evaluate(() => window.peakooru.net.server.setName('Me Myself'))
  await c.page.evaluate(() => { window.peakooru.net.session.player.name = 'Me Myself' })
  t0 = Date.now()
  await hc.tab('board')
  await c.page.waitForSelector('.board-list .board-row:not(.waiting)', { timeout: 30000 })
  f.board50k = { firstRowsMs: Date.now() - t0, elements: await c.page.locator('.board-row').count() }
  await hc.snap('board-50000')
  await c.page.evaluate(() => { const b = document.querySelector('.panel-body'); b.scrollTop = b.scrollHeight * 0.6 })
  await c.page.waitForTimeout(600)
  f.board50k.elementsAfterScroll = await c.page.locator('.board-row').count()
  await hc.snap('board-50000-scrolled')
  await hc.press('.board-pinned .board-row')
  await c.page.waitForTimeout(600)
  await hc.snap('board-50000-found-me')
  // Another player's city from the stand-in's crowd: a finished game with no actions, played again in the browser.
  const mineBefore = await hc.game()
  await c.page.evaluate(() => { document.querySelector('.panel-body').scrollTop = 0 })
  await c.page.waitForTimeout(400)
  t0 = Date.now()
  await c.page.locator('.board-list .board-row.open').first().click()
  await c.page.waitForFunction(() => window.peakooru.viewing && !window.peakooru.play.busy && window.peakooru.panel.tab === 'score', null, { timeout: 300000 })
  f.theirCityStandInMs = Date.now() - t0
  f.theirCityGame = await hc.game()
  await hc.snap('their-city')
  await hc.tab('report')
  await hc.snap('their-deeds')
  f.theirCityCannotAct = await c.page.evaluate(() => window.peakooru.city.ask('end', {}).then(() => 'ended a month: WRONG', (e) => String(e)))
  await hc.press('.turn .back')
  await c.page.waitForFunction(() => !window.peakooru.viewing && window.peakooru.play.game.status === 'playing' && !window.peakooru.play.busy, null, { timeout: 60000 })
  f.backToMineStandIn = { before: mineBefore, after: await hc.game(), queued: await c.page.evaluate(() => window.peakooru.net.outbox.queue.length) }
  await c.page.evaluate(() => window.peakooru.panel.close())
  // Skips stop early for what needs the player: skip until the day's twelve months are spent.
  const spent = () => c.page.evaluate(() => /^No months/.test(document.querySelector('.bar-allow')?.textContent ?? ''))
  for (let i = 0; i < 12 && !(await spent()); i++) {
    await hc.press('.skip')
    await hc.press('.skip-menu button[data-skip="needs"]')
    await hc.idle()
    await hc.sent()
    await c.page.evaluate(() => window.peakooru.panel.close())
  }
  f.allowanceSpent = { ...(await hc.game()), bar: await c.page.locator('.bar-allow').textContent(), nextDisabled: await c.page.locator('.next').first().isDisabled() }
  await hc.snap('allowance-spent')
  // As if this device's count were wrong (another device played meanwhile): the server refuses, the month is undone.
  const before = await hc.game()
  await c.page.evaluate(() => {
    window.peakooru.net.summary.allowance.left = 5
    void window.peakooru.next()
  })
  await c.page.waitForFunction((m) => window.peakooru.play.game.month === m && !window.peakooru.play.busy && window.peakooru.play.notice, before.month, { timeout: 60000 })
    .catch(async (e) => {
      console.log(before, await c.page.evaluate(() => ({ g: window.peakooru.play.game.month, busy: window.peakooru.play.busy, notice: window.peakooru.play.notice, s: window.peakooru.net.summary, q: window.peakooru.net.outbox.queue })))
      throw e
    })
  f.refused = { before, after: await hc.game(), notice: await c.page.evaluate(() => window.peakooru.play.notice) }
  await hc.snap('allowance-refused')
  await c.context.close()
}

// The board and the season's page at every width.
if (!only.length || only.includes('widths')) {
  for (const width of widths) {
    const phone = width <= 600
    const d = await device({ name: `w${width}`, viewport: { width, height: phone ? 800 : 900 }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone })
    const h = helpers(d.page, { hasTouch: phone }, `w${width}`)
    await d.page.goto(`${STANDIN}&crowd=5`)
    await h.ready()
    await h.skipIntro()
    await h.tab('board')
    await d.page.waitForTimeout(800)
    await h.snap('board-5-rows')
    await d.context.close()
  }
}

console.log(JSON.stringify(figures, null, 2))
console.log(errors.length ? `Errors in the page:\n${errors.join('\n')}` : 'No errors in the page.')
await browser.close()
process.exit(0)
