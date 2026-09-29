// Builds by hand, as a player would, at laptop and at phone size: the introduction, a metro line from a suggestion
// and one placed by tap (a stop moved, one put between, one taken out), a bus route, a bus lane, more trains; months
// pass and the works open; the report; a line's vehicles changed and the line closed; a refusal for want of money.
// Saves screenshots to tools/shots/build-*.png and prints timings and any errors in the page.
// Usage: node tools/look-build.mjs [laptop|phone|narrow|...] ; PEAKOORU_URL sets the address (default the dev server).
import { chromium } from 'playwright-core'

const BASE = process.env.PEAKOORU_URL ?? 'http://localhost:5190/'
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const screens = [
  { name: 'laptop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
]

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const out = {}
// `widths`: the game at every width from a small phone to a wide screen, with a line proposed and at a later month.
if (only.includes('widths')) {
  for (const width of [360, 390, 768, 900, 1280, 1440, 1920]) {
    const phone = width <= 600
    const context = await browser.newContext({
      viewport: { width, height: phone ? 780 : 900 }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone,
    })
    await context.addInitScript(() => localStorage.setItem('peakooru.intro', 'seen'))
    const page = await context.newPage()
    await page.goto(BASE)
    await page.waitForFunction(() => window.peakooru?.month && window.peakooru.play?.game && window.peakooru.map.loaded(), null, { timeout: 120000 })
    await page.evaluate(async () => {
      const p = window.peakooru
      await p.next()
      await p.next()
      p.panel.open('build')
      p.build.choose('metro')
    })
    await page.waitForFunction(() => window.peakooru.build.suggestions?.length, null, { timeout: 60000 })
    await page.evaluate(() => window.peakooru.build.use(1))
    await page.waitForFunction(() => window.peakooru.build.foreseen, null, { timeout: 60000 })
    await page.waitForTimeout(900)
    const bar = await page.evaluate(() => {
      const r = document.querySelector('.bar').getBoundingClientRect()
      const lines = new Set([...document.querySelectorAll('.bar-figures > span:not([hidden])')].map((e) => Math.round(e.getBoundingClientRect().top)))
      return { height: Math.round(r.height), right: Math.round(r.right), lines: lines.size, scroll: document.documentElement.scrollWidth > innerWidth }
    })
    console.log(width, JSON.stringify(bar))
    await page.screenshot({ path: `tools/shots/build-width-${width}.png` })
    await context.close()
  }
  await browser.close()
  process.exit(0)
}
for (const screen of screens) {
  if (only.length && !only.includes(screen.name)) continue
  const { name, ...options } = screen
  const context = await browser.newContext(options)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()}: ${m.text()}`))
  const figures = {}
  let shot = 0
  const snap = async (what) => {
    await page.waitForTimeout(400)
    const path = `tools/shots/build-${name}-${String(++shot).padStart(2, '0')}-${what}.png`
    await page.screenshot({ path })
    console.log(name, 'saved', path)
  }
  const press = async (selector) => {
    const target = page.locator(selector).first()
    await target.waitFor({ state: 'visible', timeout: 30000 })
    if (screen.hasTouch) await target.tap()
    else await target.click()
  }
  const idle = () => page.waitForFunction(() => window.peakooru?.play && !window.peakooru.play.busy, null, { timeout: 180000 })
  const tab = async (which) => {
    const open = await page.evaluate(() => window.peakooru.panel.tab)
    if (open !== which) await press(`.tabs button[data-tab="${which}"]`)
  }
  const done = () => page.evaluate(() => window.peakooru.play.game.done.length)
  /** Taps the map at a place; on a phone, confirms the magnified view as it opens. */
  const tapAt = async (lng, lat, confirm = true) => {
    // As a player would, the map is moved first if the place is under the sheet or off the screen.
    const p = await page.evaluate(([lng, lat]) => {
      const { map, panel } = window.peakooru
      let p = map.project([lng, lat])
      const bottom = panel.tab && innerWidth <= 600 ? panel.root.getBoundingClientRect().top - 40 : innerHeight - 40
      const left = panel.tab && innerWidth > 600 ? panel.root.getBoundingClientRect().right + 20 : 20
      if (p.y > bottom || p.y < 90 || p.x < left || p.x > innerWidth - 20) {
        map.jumpTo({ center: map.unproject([p.x - (left + innerWidth) / 2 + innerWidth / 2, p.y - (90 + bottom) / 2 + innerHeight / 2]) })
        p = map.project([lng, lat])
      }
      return p
    }, [lng, lat])
    await page.waitForTimeout(200)
    if (screen.hasTouch) await page.touchscreen.tap(p.x, p.y)
    else await page.mouse.click(p.x, p.y)
    if (screen.hasTouch && confirm) {
      const shown = await page.waitForSelector('.magnifier:not([hidden])', { timeout: 1500 }).catch(() => null)
      if (shown) {
        await page.waitForTimeout(450)
        return true
      }
    }
    return false
  }
  const confirmMagnifier = async () => {
    await press('.magnifier-bar .commit')
    await page.waitForTimeout(450)
  }
  const quoted = (n) => page.waitForFunction((n) => {
    const b = window.peakooru.build
    return b.quote && b.stops.length === n && (b.quote.ok || b.stops.length < 2)
  }, n, { timeout: 30000 })
  const forecast = () => page.waitForFunction(() => window.peakooru.build.foreseen || document.querySelector('.proposal .reason'),
    null, { timeout: 60000 })
  // Centres a place in what shows of the map: on a phone, above the sheet.
  const view = (lng, lat, zoom) => page.evaluate(([lng, lat, zoom]) => {
    const { map, panel } = window.peakooru
    map.jumpTo({ center: [lng, lat], zoom: innerWidth <= 600 ? zoom - 1 : zoom })
    const sheet = panel.tab && innerWidth <= 600 ? innerHeight - panel.root.getBoundingClientRect().top : 0
    if (sheet) map.panBy([0, -sheet / 2], { duration: 0 })
  }, [lng, lat, zoom])

  try {
  await page.goto(BASE)
  await page.waitForFunction(() => window.peakooru?.month && window.peakooru.play?.game && window.peakooru.map.loaded(), null, { timeout: 120000 })
  await idle()
  // The introduction, step by step.
  await page.waitForSelector('.intro:not([hidden])', { timeout: 30000 })
  for (let i = 1; i <= 5; i++) {
    await snap(`intro-${i}`)
    await press('.intro .commit')
  }
  await snap('after-intro')

  // A metro line from a suggestion.
  await tab('build')
  await snap('build-page')
  await press('.tool[data-tool="metro"]')
  await page.waitForSelector('.suggestion', { timeout: 30000 })
  let t0 = Date.now()
  await page.waitForFunction(() => document.querySelectorAll('.suggestion .working').length === 0, null, { timeout: 60000 })
  figures.suggestionsForecastMs = Date.now() - t0
  await snap('metro-suggestions')
  await press('.suggestion-head')
  await snap('metro-suggestion-looked')
  await press('.suggestion .commit')
  await forecast().catch(() => null)
  await snap('metro-proposal')
  if (screen.hasTouch) {
    await page.locator('.panel-body').evaluate((b) => (b.scrollTop = b.scrollHeight))
    await snap('metro-proposal-lower')
  }
  // Not enough money: borrow, then build.
  for (let i = 0; i < 3 && (await page.locator('.proposal .quiet:text("Borrow under Levers")').count()); i++) {
    if (i === 0) await snap('metro-cannot-afford')
    await press('.proposal .quiet:text("Borrow under Levers")')
    await press('.amounts button >> nth=3')
    await page.waitForSelector('.outlook .commit', { timeout: 60000 })
    if (i === 0) await snap('borrow-forecast')
    const before = await done()
    await press('.outlook .commit')
    await page.waitForFunction((n) => window.peakooru.play.game.done.length > n, before, { timeout: 30000 })
    await tab('build')
    await forecast()
  }
  let before = await done()
  await press('.proposal .commit')
  await page.waitForFunction((n) => window.peakooru.play.game.done.length > n, before, { timeout: 30000 })
  await snap('metro-ordered')

  // A metro line by hand: Hebbal to Whitefield by way of KR Puram, one stop moved, one put between, one taken out.
  await press('.tool[data-tool="metro"]')
  await page.waitForSelector('.suggestion', { timeout: 30000 })
  await view(77.66, 13.0, 11.6)
  await page.waitForTimeout(400)
  const taps = []
  for (const [lng, lat] of [[77.5932, 13.044], [77.64, 13.02], [77.69, 13.0], [77.75, 12.97]]) {
    t0 = Date.now()
    const magnified = await tapAt(lng, lat)
    if (magnified) {
      if (taps.length === 0) await snap('metro-magnifier')
      await confirmMagnifier()
    }
    await quoted(taps.length + 1)
    taps.push(Date.now() - t0)
    if (taps.length === 1) await snap('metro-first-stop')
  }
  figures.tapToStopMs = await page.evaluate(() => window.peakooru.build.times.tapToStop.map(Math.round))
  await snap('metro-by-hand')
  await forecast()
  await snap('metro-by-hand-proposal')
  // A tap in the water, or far from a road, is refused beside the tap.
  await tapAt(77.8, 12.8)
  if (screen.hasTouch) await confirmMagnifier().catch(() => {})
  await page.waitForSelector('.tap-note:not([hidden])', { timeout: 10000 }).catch(() => null)
  await snap('metro-refused-tap')
  // Choose the second stop and move it.
  const q = await page.evaluate(() => window.peakooru.build.points())
  await tapAt(q[1][0], q[1][1], false)
  await page.waitForSelector('.stop-pop:not([hidden])', { timeout: 10000 })
  await snap('metro-stop-chosen')
  await press('.stop-pop button:text("Move")')
  if (await tapAt(77.66, 13.01)) await confirmMagnifier()
  await quoted(4).catch(() => {})
  await snap('metro-stop-moved')
  // Put one between the third and fourth, on the line.
  const mid = await page.evaluate(() => {
    const p = window.peakooru.build.quote.path
    const i = Math.floor(p.length / 4) * 2
    return [(p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2]
  })
  if (await tapAt(mid[0], mid[1])) await confirmMagnifier()
  await quoted(5).catch(() => {})
  await snap('metro-stop-between')
  // Take the first out.
  const q3 = await page.evaluate(() => window.peakooru.build.points())
  await tapAt(q3[0][0], q3[0][1], false)
  await press('.stop-pop button:text("Take out")')
  await page.waitForFunction(() => window.peakooru.build.quote?.ok, null, { timeout: 30000 })
  await forecast()
  figures.restToForecastMs = await page.evaluate(() => window.peakooru.build.times.restToForecast.map(Math.round))
  await snap('metro-edited')
  before = await done()
  const affordable = await page.locator('.proposal .commit:not([disabled])').count()
  if (affordable) {
    await press('.proposal .commit')
    await page.waitForFunction((n) => window.peakooru.play.game.done.length > n, before, { timeout: 30000 })
  } else {
    await snap('metro-by-hand-refused')
    await press('.build-head .back')
  }

  // A bus route from a suggestion.
  await tab('build')
  await press('.tool[data-tool="busRoute"]')
  await page.waitForSelector('.suggestion .commit', { timeout: 30000 })
  await snap('bus-suggestions')
  await press('.suggestion .commit')
  await forecast()
  await snap('bus-proposal')
  before = await done()
  await press('.proposal .commit')
  await page.waitForFunction((n) => window.peakooru.play.game.done.length > n, before, { timeout: 30000 })

  // Bus lanes along the Outer Ring Road.
  await press('.tool[data-tool="busLane"]')
  await view(77.67, 12.93, 13.2)
  await page.waitForTimeout(1200)
  await snap('lane-candidates')
  for (const [lng, lat] of [[77.6585, 12.9245], [77.672, 12.925]]) {
    await tapAt(lng, lat, false)
    await page.waitForTimeout(300)
  }
  await page.waitForSelector('.proposal', { timeout: 20000 }).catch(() => null)
  await forecast().catch(() => null)
  await snap('lane-chosen')
  before = await done()
  if (await page.locator('.proposal .commit:not([disabled])').count()) {
    await press('.proposal .commit')
    await page.waitForFunction((n) => window.peakooru.play.game.done.length > n, before, { timeout: 30000 })
  }

  // More trains on a suburban line.
  await press('.tool[data-tool="railService"]')
  await press('.rail-lines button')
  await forecast()
  await snap('rail-proposal')
  before = await done()
  if (await page.locator('.proposal .commit:not([disabled])').count()) {
    await press('.proposal .commit')
    await page.waitForFunction((n) => window.peakooru.play.game.done.length > n, before, { timeout: 30000 })
  }
  await view(77.6, 12.97, 10.6)
  await snap('works-list')

  // Months pass: the bus route and lanes open, the metro is dug.
  for (let i = 0; i < 3; i++) {
    await press('.next')
    await idle()
  }
  await snap('report-after-3-months')
  await tab('build')
  await snap('works-after-3-months')
  await tab('score')
  await page.waitForSelector('.your-lines', { timeout: 30000 }).catch(() => null)
  if (screen.hasTouch) await page.locator('.your-lines').first().scrollIntoViewIfNeeded().catch(() => {})
  await snap('your-lines')
  if (await page.locator('.your-line .stepper button[aria-label^="Add"]').count()) {
    before = await done()
    await press('.your-line .stepper button[aria-label^="Add"]')
    await page.waitForFunction((n) => window.peakooru.play.game.done.length > n, before, { timeout: 30000 })
    await snap('vehicles-added')
    await press('.your-line .quiet:text("Close the line")')
    await snap('close-asked')
    before = await done()
    await press('.your-line .commit')
    await page.waitForFunction((n) => window.peakooru.play.game.done.length > n, before, { timeout: 30000 })
    await snap('line-closed')
  }

  // A year on: the metro lines are dug, the roads beneath lose a lane.
  await page.evaluate(() => window.peakooru.skip(12))
  await idle()
  await snap('year-later-report')
  await page.evaluate(() => window.peakooru.panel.close())
  await view(77.55, 12.97, 11)
  await snap('year-later-map')

  // Refused for want of money: a long line placed by hand once the money is spent.
  await tab('build')
  await press('.tool[data-tool="metro"]')
  await view(77.6, 12.95, 10.8)
  for (const [lng, lat] of [[77.48, 12.9], [77.56, 12.95], [77.64, 12.97], [77.72, 13.03]]) {
    if (await tapAt(lng, lat)) await confirmMagnifier()
    await page.waitForTimeout(300)
  }
  await forecast()
  await page.locator('.proposal .reason').first().scrollIntoViewIfNeeded().catch(() => {})
  await snap('refused-money')

  } catch (error) {
    console.log(name, 'failed:', String(error).split('\n')[0])
    await snap('failed').catch(() => {})
    figures.failed = String(error).split('\n')[0]
  }
  out[name] = { figures, errors: [...new Set(errors)].slice(0, 20) }
  await context.close()
}
await browser.close()
console.log(JSON.stringify(out, null, 2))
