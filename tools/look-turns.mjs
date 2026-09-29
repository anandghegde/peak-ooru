// Plays the first year by hand, as a player would, at laptop and at phone size: each lever once, a month, the report
// and the books, a skip, a skip stopped partway, leaving and coming back; then skips to the end of the game. Saves
// screenshots to tools/shots/turns-*.png, and prints timings, how much of a phone's screen the closed game takes,
// and any errors in the page.
// Usage: node tools/look-turns.mjs [laptop|phone] [--no-end]
// PEAKOORU_URL sets the address (default the dev server).
import { chromium } from 'playwright-core'

const BASE = process.env.PEAKOORU_URL ?? 'http://localhost:5190/'
const args = process.argv.slice(2)
const only = args.filter((a) => !a.startsWith('--'))
const toEnd = !args.includes('--no-end')
const screens = [
  { name: 'laptop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
]

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const report = {}
for (const screen of screens) {
  if (only.length && !only.includes(screen.name)) continue
  const { name, ...options } = screen
  const context = await browser.newContext(options)
  let page = await context.newPage()
  const errors = []
  const watch = (p) => {
    p.on('pageerror', (error) => errors.push(String(error)))
    p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()}: ${m.text()}`))
  }
  watch(page)
  const figures = {}
  let shot = 0
  const snap = async (what) => {
    await page.waitForTimeout(250)
    const path = `tools/shots/turns-${name}-${String(++shot).padStart(2, '0')}-${what}.png`
    await page.screenshot({ path })
    console.log(name, 'saved', path)
  }
  /** A tap on a phone, a click on a laptop. */
  const press = async (selector) => {
    const target = page.locator(selector).first()
    await target.waitFor({ state: 'visible', timeout: 30000 })
    if (screen.hasTouch) await target.tap()
    else await target.click()
  }
  const idle = () => page.waitForFunction(() => window.peakooru?.play && !window.peakooru.play.busy, null, { timeout: 120000 })
  const game = () => page.evaluate(() => {
    const g = window.peakooru.play.game
    return { month: g.month, money: g.money, status: g.status, done: g.done.length, loans: g.loans.length, taxRate: g.taxRate }
  })
  const ready = async () => {
    await page.waitForFunction(() => window.peakooru?.month && window.peakooru.play?.game && window.peakooru.map.loaded(),
      null, { timeout: 120000 })
    await idle()
  }
  const tab = async (which) => {
    const open = await page.evaluate(() => window.peakooru.panel.tab)
    if (open !== which) await press(`.tabs button[data-tab="${which}"]`)
  }
  const forecast = async () => {
    await page.waitForSelector('.outlook .commit, .outlook .reason', { timeout: 60000 })
  }

  let t0 = Date.now()
  await page.goto(BASE)
  await ready()
  figures.firstMonthShownMs = Date.now() - t0
  await snap('start')

  // The levers, each once, with its forecast before committing.
  await tab('money')
  await snap('levers')
  await press('.lever >> nth=0 >> button[aria-label="Raise the tax rate"]')
  t0 = Date.now()
  await forecast()
  figures.taxForecastMs = Date.now() - t0
  await snap('tax-forecast')
  await press('.outlook .commit')
  await idle()
  await page.waitForFunction(() => window.peakooru.play.game.done.length === 1, null, { timeout: 30000 })
  // The rate can change once a year: a second change says why not.
  await page.waitForSelector('.lever >> nth=0 >> .reason', { timeout: 30000 }).catch(() => {})
  await snap('tax-changed')

  await press('button[aria-label="Lower the bus fare"]')
  await press('button[aria-label="Lower the bus fare"]')
  t0 = Date.now()
  await forecast()
  figures.fareForecastMs = Date.now() - t0
  await page.locator('.outlook').first().scrollIntoViewIfNeeded()
  await snap('fare-forecast')
  await press('.outlook .commit')
  await page.waitForFunction(() => window.peakooru.play.game.done.length === 2, null, { timeout: 30000 })

  await press('.amounts button >> nth=2')
  await forecast()
  await page.locator('.outlook').first().scrollIntoViewIfNeeded()
  await snap('borrow-forecast')
  await press('.outlook .commit')
  await page.waitForFunction(() => window.peakooru.play.game.done.length === 3, null, { timeout: 30000 })

  // A month, and its report.
  t0 = Date.now()
  await press('.next')
  await page.waitForFunction(() => window.peakooru.play.game.month === 1, null, { timeout: 60000 })
  figures.monthLandsMs = Date.now() - t0
  await idle()
  figures.monthReportMs = Date.now() - t0
  await snap('report-month')
  await tab('money')
  await page.waitForSelector('.chart', { timeout: 30000 })
  await snap('books')
  if (screen.hasTouch) await page.locator('.panel-body').evaluate((b) => (b.scrollTop = b.scrollHeight))
  await snap('books-lower')

  // Skip three months, caught partway with traffic on the map, then its report.
  await press('.skip')
  await snap('skip-menu')
  await press('.skip-menu button[data-skip="3"]')
  await page.waitForFunction(() => window.peakooru.play.game.month === 2, null, { timeout: 60000 })
  await snap('skipping')
  await idle()
  await snap('report-skip')

  // A skip of twelve, stopped after the first month lands. It stops at the year's end in any case.
  const before = (await game()).month
  await press('.skip')
  await press('.skip-menu button[data-skip="12"]')
  await page.waitForFunction((m) => window.peakooru.play.game.month > m, before, { timeout: 60000 })
  await press('.next')
  await idle()
  figures.stoppedAfter = (await game()).month - before
  await snap('skip-stopped')

  // To the next thing that needs the player: the year's end.
  await press('.skip')
  await press('.skip-menu button[data-skip="needs"]')
  await idle()
  figures.afterNeeds = await game()
  await snap('report-year-end')

  // Repay the loan.
  await tab('money')
  await press('.loan button')
  await forecast()
  await page.locator('.outlook').first().scrollIntoViewIfNeeded()
  await snap('repay-forecast')
  await press('.outlook .commit')
  await page.waitForFunction(() => window.peakooru.play.game.done.length === 4, null, { timeout: 30000 })

  // The city page; on a phone it holds the map's controls too.
  await tab('score')
  await snap('city')

  // The closed game over the map, with traffic on: how much of the screen it takes.
  await page.evaluate(() => {
    window.peakooru.panel.close()
    window.peakooru.controls.setPeriod('evening')
  })
  await snap('closed-traffic')
  figures.closedCover = await page.evaluate(() => {
    const rows = new Set()
    for (const el of document.querySelectorAll('.bar, .dock, .chip, .credit, .controls, .panel, .zone')) {
      if (!el.isConnected || getComputedStyle(el).display === 'none' || el.hidden) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      for (let y = Math.max(0, Math.floor(r.top)); y < Math.min(innerHeight, Math.ceil(r.bottom)); y++) rows.add(y)
    }
    return { rows: rows.size, of: innerHeight, share: +(rows.size / innerHeight).toFixed(3) }
  })

  // Leave and come back: the game is kept, and comes back where it was.
  const kept = await game()
  await page.close()
  page = await context.newPage()
  watch(page)
  t0 = Date.now()
  await page.goto(BASE)
  await ready()
  figures.returnMs = Date.now() - t0
  const back = await game()
  figures.returned = { same: JSON.stringify(back) === JSON.stringify(kept), kept, back }
  await snap('returned')

  // To the end: twelve months at a time, going on past whatever stops a skip.
  if (toEnd) {
    const skips = []
    for (let i = 0; i < 40 && (await game()).status === 'playing'; i++) {
      const from = (await game()).month
      t0 = Date.now()
      await press('.skip')
      await press('.skip-menu button:not(:disabled) >> nth=-1')
      await idle()
      const to = (await game()).month
      skips.push({ from, to, ms: Date.now() - t0 })
      if (i === 2) await snap('report-later')
    }
    figures.skips = skips
    figures.end = await game()
    await page.waitForSelector('.ending-card', { timeout: 30000 })
    await snap('ending')
    // Start again from the ending.
    await press('.ending-card .commit')
    await page.waitForFunction(() => window.peakooru.play.game.month === 0, null, { timeout: 60000 })
    await ready()
    figures.restarted = await game()
    await snap('restarted')
  }

  // A game kept by an older version says so.
  await page.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('peak-ooru', 1)
    open.onsuccess = () => {
      const store = open.result.transaction('games', 'readwrite').objectStore('games')
      const get = store.get('current')
      get.onsuccess = () => {
        store.put({ ...get.result, version: '0.old' }, 'current').onsuccess = resolve
      }
    }
  }))
  await page.reload()
  await ready()
  await page.waitForSelector('.notice', { timeout: 30000 })
  await snap('older')

  report[name] = { ...figures, errors }
  await context.close()
}
await browser.close()
console.log(JSON.stringify(report, null, 2))
