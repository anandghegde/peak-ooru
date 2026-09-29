// Looks at the score as a player would, at laptop and phone size: the score in the bar and its page; each measure's
// reasons; a measure's map view and the fairness view; a zone's "why is this bad?"; a proposal's forecast of the
// score (a metro line, a road mended, a lever); an event beginning and ending; a yearly review; and a whole game
// skipped to its ending. Saves screenshots to tools/shots/score-*.png and prints timings and any errors in the page.
// Usage: node tools/look-score.mjs [laptop|phone|widths] [--no-end] ; PEAKOORU_URL sets the address.
// Run it against a built copy (npx vite build --outDir X; npx vite preview --outDir X --port 5193), since the dev
// server reloads the page whenever a file is saved; the address needs ?measure for the page's hooks.
import { chromium } from 'playwright-core'

const BASE = process.env.PEAKOORU_URL ?? 'http://localhost:5193/?measure'
const args = process.argv.slice(2)
const only = args.filter((a) => !a.startsWith('--'))
const toEnd = !args.includes('--no-end')
const screens = [
  { name: 'laptop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
]
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const loaded = () => window.peakooru?.month && window.peakooru.play?.game && window.peakooru.map.loaded()

if (only.includes('widths')) {
  for (const width of [360, 390, 768, 900, 1280, 1440, 1920]) {
    const phone = width <= 600
    const context = await browser.newContext({
      viewport: { width, height: phone ? 780 : 900 }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone,
    })
    await context.addInitScript(() => localStorage.setItem('peakooru.intro', 'seen'))
    const page = await context.newPage()
    await page.goto(BASE)
    await page.waitForFunction(loaded, null, { timeout: 120000 })
    await page.evaluate(() => window.peakooru.panel.open('score'))
    await page.waitForTimeout(800)
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    const bar = await page.evaluate(() => {
      const r = document.querySelector('.bar').getBoundingClientRect()
      const s = document.querySelector('.bar-score').getBoundingClientRect()
      return { barH: Math.round(r.height), scoreInside: s.right <= r.right + 0.5 && s.width > 0 }
    })
    console.log(width, 'horizontal scroll:', scroll, JSON.stringify(bar))
    await page.screenshot({ path: `tools/shots/score-width-${width}.png` })
    await context.close()
  }
  await browser.close()
  process.exit(0)
}

if (only.includes('intro')) {
  // The introduction's first two steps, which begin with the score, at laptop and phone size.
  for (const screen of screens) {
    const { name, ...options } = screen
    const context = await browser.newContext(options)
    const page = await context.newPage()
    await page.goto(BASE)
    await page.waitForSelector('.intro:not([hidden])', { timeout: 180000 })
    await page.waitForTimeout(800)
    await page.screenshot({ path: `tools/shots/score-${name}-intro-1.png` })
    await page.locator('.intro .commit').click()
    await page.waitForTimeout(800)
    await page.screenshot({ path: `tools/shots/score-${name}-intro-2.png` })
    console.log(name, 'intro shot')
    await context.close()
  }
  await browser.close()
  process.exit(0)
}

for (const screen of screens) {
  if (only.length && !only.includes(screen.name)) continue
  const { name, ...options } = screen
  const context = await browser.newContext(options)
  await context.addInitScript(() => localStorage.setItem('peakooru.intro', 'seen'))
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()}: ${m.text()}`))
  const figures = {}
  let shot = 0
  const snap = async (what) => {
    await page.waitForTimeout(350)
    const path = `tools/shots/score-${name}-${String(++shot).padStart(2, '0')}-${what}.png`
    await page.screenshot({ path })
    console.log(name, 'saved', path)
  }
  const press = async (selector) => {
    const target = page.locator(selector).first()
    await target.waitFor({ state: 'visible', timeout: 60000 })
    if (screen.hasTouch) await target.tap()
    else await target.click()
  }
  const idle = () => page.waitForFunction(() => window.peakooru?.play && !window.peakooru.play.busy, null, { timeout: 300000 })
  const month = () => page.evaluate(() => window.peakooru.play.game.month)
  const tab = async (which) => {
    const open = await page.evaluate(() => window.peakooru.panel.tab)
    if (open !== which) await press(`.tabs button[data-tab="${which}"]`)
  }
  const closeVeils = () => page.evaluate(() => document.querySelectorAll('.ending.review').forEach((v) => v.remove()))

  let t0 = Date.now()
  await page.goto(BASE)
  await page.waitForFunction(loaded, null, { timeout: 120000 })
  await idle()
  figures.firstSightMs = Date.now() - t0
  figures.startScore = await page.evaluate(() => window.peakooru.play.game.score)
  await snap('start')
  await tab('score')
  await snap('score-page-start')

  // A month ended, so that the measures have a change and reasons.
  t0 = Date.now()
  await press('.next')
  await page.waitForFunction(() => window.peakooru.play.game.month === 1, null, { timeout: 60000 })
  await idle()
  figures.monthMs = Date.now() - t0
  await closeVeils()
  await snap('report-after-month')
  await tab('score')
  await snap('score-page')
  const keys = await page.evaluate(() => [...document.querySelectorAll('.measure')].map((m) => m.dataset.measure))
  for (const key of screen.hasTouch ? keys.slice(0, 3) : keys) {
    await press(`.measure[data-measure="${key}"] .measure-head`)
    await page.locator(`.measure[data-measure="${key}"]`).scrollIntoViewIfNeeded()
    await snap(`measure-${key}`)
  }
  // Commute's view, from its measure.
  await press('.measure[data-measure="commute"] .measure-head')
  await press('.measure[data-measure="commute"] .measure-more .quiet')
  await snap('commute-view')
  await page.evaluate(() => window.peakooru.controls.setView('fairness'))
  await snap('fairness-view')

  // "Why is this bad?" for a zone at the edge of the city.
  await page.evaluate(() => {
    window.peakooru.panel.close()
    window.peakooru.map.jumpTo({ center: [77.75, 12.95], zoom: 11.5 })
  })
  await page.waitForTimeout(800)
  const at = await page.evaluate(() => {
    const p = window.peakooru.map.project([77.75, 12.95])
    return { x: p.x, y: p.y }
  })
  if (screen.hasTouch) await page.touchscreen.tap(at.x, at.y)
  else await page.mouse.click(at.x, at.y)
  await press('.why-ask')
  await page.waitForFunction(() => document.querySelector('.why') && !document.querySelector('.why .working'), null, { timeout: 60000 })
  await snap('zone-why')
  await page.evaluate(() => {
    window.peakooru.controls.setView('plain')
    window.peakooru.controls.showZone(null)
    window.peakooru.map.fitBounds([77.44, 12.83, 77.79, 13.14], { duration: 0 })
  })

  // A proposal's forecast of the score: the first suggested metro line.
  await tab('build')
  t0 = Date.now()
  await page.evaluate(() => window.peakooru.build.choose('metro'))
  await page.waitForFunction(() => window.peakooru.build.suggestions?.length && window.peakooru.build.suggestions.every((s) => s.foreseen),
    null, { timeout: 180000 }).catch(() => null)
  figures.metroSuggestionsMs = Date.now() - t0
  await snap('metro-suggestions')
  await page.evaluate(() => window.peakooru.build.use(0))
  await page.waitForFunction(() => document.querySelector('.proposal .score-forecast') && !document.querySelector('.proposal .working'), null, { timeout: 120000 }).catch(() => null)
  // On a phone the proposal is a summary, its forecast a line with the score's change; its details below that.
  await page.locator('.proposal .forecast, .proposal').first().scrollIntoViewIfNeeded()
  figures.metroForecast = await page.evaluate(() => {
    const f = window.peakooru.build.foreseen
    return f?.score ? { before: f.score.before.total, after: f.score.after.total } : null
  })
  await snap('metro-forecast')
  if (screen.hasTouch) {
    await press('.proposal .quiet >> text=Details')
    await page.locator('.proposal .score-forecast').first().scrollIntoViewIfNeeded()
    await snap('metro-forecast-details')
  }
  await page.evaluate(() => window.peakooru.build.choose(null))

  // A lever's forecast of the score: the bus fare lowered.
  await tab('money')
  await press('button[aria-label="Lower the bus fare"]')
  t0 = Date.now()
  await page.waitForSelector('.outlook .score-forecast', { timeout: 120000 })
  figures.leverForecastMs = Date.now() - t0
  await page.locator('.outlook').first().scrollIntoViewIfNeeded()
  await snap('lever-forecast')
  await press('.outlook .quiet')

  // To a month: skipping, with the reviews and event cards on the way put away.
  const skipTo = async (target) => {
    while ((await month()) < target) {
      const left = target - (await month())
      await page.evaluate((n) => window.peakooru.skip(n), Math.min(12, left))
      await idle()
      if ((await month()) < target) {
        await closeVeils()
        await page.evaluate(() => document.querySelector('.event-card .commit')?.click())
      }
    }
  }
  // An event beginning, and ending: the first of the season's with a place and a road shut (a cave-in or burst main).
  t0 = Date.now()
  await skipTo(55)
  figures.skipTo55Ms = Date.now() - t0
  await closeVeils()
  figures.eventsIn55 = await page.evaluate(() => (window.peakooru.play.game.events ?? []).map((e) => `${e.kind} ${e.started}-${e.ends} ${e.title}`))
  figures.eventCard = await page.evaluate(() => document.querySelector('.event-card h2')?.textContent ?? null)
  await snap('event-begins')
  if (await page.$('.event-card .quiet')) {
    await press('.event-card .quiet')
    await page.waitForTimeout(1200)
    await snap('event-shown')
  }
  await tab('score')
  await page.locator('.events').first().scrollIntoViewIfNeeded().catch(() => null)
  await snap('events-in-force')
  await page.evaluate(() => window.peakooru.next())
  await idle()
  await closeVeils()
  await tab('report')
  await snap('event-ended-report')

  // The yearly review: to the end of December 2030.
  await skipTo(59)
  await page.evaluate(() => window.peakooru.next())
  await idle()
  await page.waitForSelector('.ending.review', { timeout: 10000 }).catch(() => null)
  await snap('yearly-review')
  await closeVeils()

  if (toEnd) {
    t0 = Date.now()
    for (let i = 0; i < 200; i++) {
      const status = await page.evaluate(() => window.peakooru.play.game.status)
      if (status !== 'playing') break
      await page.evaluate(() => window.peakooru.skip(12))
      await idle()
      await closeVeils()
      await page.evaluate(() => document.querySelector('.event-card .commit')?.click())
    }
    figures.skipToEndMs = Date.now() - t0
    await page.waitForSelector('.final', { timeout: 30000 })
    await page.waitForTimeout(1500)
    figures.end = await page.evaluate(() => {
      const g = window.peakooru.play.game
      return { status: g.status, month: g.month, score: g.score?.total, scores: g.scores,
        deeds: [...document.querySelectorAll('.final-deeds li')].map((l) => l.textContent) }
    })
    await snap('ending')
    await page.locator('.final').evaluate((c) => (c.scrollTop = c.scrollHeight))
    await snap('ending-lower')
  }
  figures.errors = errors.slice(0, 12)
  console.log(name, JSON.stringify(figures, null, 1))
  await context.close()
}
await browser.close()
