// A stranger's first day (slice 9): a new player, against the server on port 5210 (PEAKOORU_SERVER sets another) and a
// built copy of the game, goes through the introduction by pressing and tapping only what it points at, then plays on
// to the end of month 12 pressing only what the screen suggests ("What could I do now?", its first idea each month,
// then Next month). At laptop and phone size. A second new player does nothing for 12 months, for comparison.
// Saves screenshots of every step to tools/shots/first-*.png and prints the scores, timings and anything wrong.
// Usage: node tools/look-first.mjs [laptop|phone] [--no-baseline] [--months=12]
import { execSync, spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const PORT = Number(process.env.PEAKOORU_PORT ?? 5221)
const SERVER = process.env.PEAKOORU_SERVER ?? 'http://localhost:5210'
const args = process.argv.slice(2)
const only = args.filter((a) => !a.startsWith('--'))
const baseline = !args.includes('--no-baseline')
const MONTHS = Number(args.find((a) => a.startsWith('--months='))?.slice(9) ?? 12)
const screens = [
  { name: 'laptop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
]

if (!(await fetch(`${SERVER}/api/me`).then((r) => r.status === 401, () => false))) {
  console.error(`The server does not answer at ${SERVER}. Start it (cd server && npm run dev) first.`)
  process.exit(1)
}
const out = mkdtempSync(join(tmpdir(), 'peakooru-first-'))
execSync(`npx vite build --outDir ${out} --emptyOutDir`, { stdio: 'ignore' })
if (await fetch(`http://localhost:${PORT}/`).then(() => true, () => false)) {
  console.error(`Port ${PORT} is taken. Stop what is on it first.`)
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

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
const results = {}

async function device(screen) {
  const { name, ...options } = screen
  const context = await browser.newContext(options)
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${String(e)}`))
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${name}: ${m.text()}`))
  return { context, page }
}

function helpers(page, screen, prefix) {
  let shot = 0
  const h = {
    snap: async (what) => {
      await page.waitForTimeout(500)
      const path = `tools/shots/first-${prefix}-${String(++shot).padStart(2, '0')}-${what}.png`
      await page.screenshot({ path })
      console.log('saved', path)
    },
    /** Presses a thing on the screen as the player would: a tap on a phone, a click on a laptop. */
    press: async (target) => {
      const t = typeof target === 'string' ? page.locator(target).first() : target
      await t.waitFor({ state: 'visible', timeout: 60000 })
      await t.scrollIntoViewIfNeeded()
      if (screen.hasTouch) await t.tap()
      else await t.click()
    },
    /** Taps the map at a point, as a finger or a mouse would. */
    tapAt: async (x, y) => {
      if (screen.hasTouch) await page.touchscreen.tap(x, y)
      else await page.mouse.click(x, y)
    },
    idle: () => page.waitForFunction(() => window.peakooru?.play && !window.peakooru.play.busy, null, { timeout: 300000 }),
    game: () => page.evaluate(() => {
      const g = window.peakooru.play.game
      return { month: g.month, done: g.done.length, score: g.score?.total, money: g.money, status: g.status }
    }),
    card: () => page.locator('.first-card:not([hidden])'),
    words: () => page.locator('.first-card:not([hidden]) .first-words').innerText().catch(() => ''),
    /** What the introduction's card is pointing at, by its classes. */
    pointed: () => page.evaluate(() => {
      const t = document.querySelector('.intro-target')
      return t ? `${t.tagName.toLowerCase()}.${[...t.classList].join('.')}: ${t.textContent?.trim().slice(0, 40)}` : null
    }),
    /** Puts away what the game put up over the map on its own: an event's card, the yearly review. */
    clear: async () => {
      for (let i = 0; i < 3; i++) {
        const review = page.locator('.ending.review .commit')
        if (await review.count()) {
          await h.snap('review')
          await h.press(review)
          continue
        }
        const event = page.locator('.event-card .commit')
        if (await event.count()) {
          await h.snap('event')
          await h.press(event)
          continue
        }
        break
      }
    },
  }
  return h
}

/** Waits for the introduction to reach the step whose words match. */
async function waitWords(h, pattern, timeout = 60000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const w = await h.words()
    if (pattern.test(w)) return w
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`The introduction never said ${pattern}; it says "${await h.words()}"`)
}

/** Taps the ring the introduction shows on the map; on a phone, puts the stop where the magnifier's cross is. */
async function tapRing(page, h, screen) {
  const ring = page.locator('.first-ring:not(.later) i').first()
  await ring.waitFor({ state: 'visible', timeout: 30000 })
  // The card says where to tap only once the ring is in sight; the ring's centre must then show the map itself, not
  // the card, the bar or the sheet over it (the ring lets taps through, so the map's canvas is what is found there).
  await page.waitForFunction(() => {
    const words = document.querySelector('.first-card:not([hidden]) .first-words')?.textContent ?? ''
    const r = document.querySelector('.first-ring:not(.later):not([hidden]) i')?.getBoundingClientRect()
    if (!r || /Moving the map/.test(words) || window.peakooru.map.isMoving()) return false
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !!hit && hit.tagName === 'CANVAS'
  }, null, { timeout: 30000 })
  // A touch while the map still glides only stops it, as on a phone: the map is let come to rest first.
  await page.waitForTimeout(600)
  const box = await ring.boundingBox()
  await h.tapAt(box.x + box.width / 2, box.y + box.height / 2)
  // On a phone a spot off the stations is put in a magnified view first; a tap on a station is taken as it is.
  if (screen.hasTouch) {
    const ok = page.locator('.magnifier:not([hidden]) .commit')
    if (await ok.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)) {
      await page.waitForTimeout(500)
      await h.snap('magnifier')
      await h.press(ok)
    }
  }
}

async function nextMonth(page, h) {
  const before = (await h.game()).month
  await h.press('.next')
  await page.waitForFunction((m) => window.peakooru.play.game.month === m + 1, before, { timeout: 120000 })
  await h.idle()
  await page.waitForTimeout(300)
}

for (const screen of screens) {
  if (only.length && !only.includes(screen.name)) continue
  const r = (results[screen.name] = { steps: [] })
  const { page, context } = await device(screen)
  const h = helpers(page, screen, screen.name)
  const t0 = Date.now()
  await page.goto(BASE)
  await h.card().waitFor({ state: 'visible', timeout: 120000 })
  r.introAfterMs = Date.now() - t0
  const step = async (name) => {
    r.steps.push({ step: name, words: await h.words(), pointed: await h.pointed() })
    await h.snap(name)
  }
  await step('score')
  const start = await h.game()
  r.startScore = start.score
  await h.press(h.card().locator('.commit'))

  // Mending a road: the page opens with the road chosen; the card points at the button that patches it.
  await waitWords(h, /Patch them/)
  await page.waitForSelector('.panel.open .commit.intro-target', { timeout: 60000 })
  r.firstActAfterMs = Date.now() - t0
  await step('mend')
  await h.press('.panel.open .commit.intro-target')

  // A bus route: two taps on the map, at the rings.
  await waitWords(h, /tap the ring|click the ring/i)
  await step('bus-start')
  await tapRing(page, h, screen)
  await waitWords(h, /to end the route/)
  await step('bus-end')
  await tapRing(page, h, screen)
  await waitWords(h, /Build the route/)
  // The stops as the route has them, against the names the rings gave.
  r.route = await page.evaluate(() => window.peakooru.build.quote?.stations.map((x) => x.name) ?? null)
  await page.waitForSelector('.panel.open .commit.intro-target', { timeout: 60000 })
  await step('bus-build')
  await h.press('.panel.open .commit.intro-target')

  // Ending the month, and what the player's acts did.
  await waitWords(h, /end it/i)
  await step('end')
  await h.press('.next')
  await waitWords(h, /This is what your work did/, 180000)
  await h.idle()
  await page.waitForTimeout(800)
  await step('read')
  r.reportYours = await page.locator('.report-yours').innerText().catch(() => null)
  await h.press(h.card().locator('.commit'))
  await waitWords(h, /three ideas/)
  await step('help')
  await h.press(h.card().locator('.commit'))
  await h.clear()
  r.afterIntro = await h.game()

  // On to month 12, doing only what the screen suggests: the first of "What could I do now?", then the next month.
  r.months = []
  for (let m = (await h.game()).month; m < MONTHS; m = (await h.game()).month) {
    await h.clear()
    if (await page.locator('.day-end').count()) break
    // The pages as a new player finds them: a few tools at first, more as the year goes on.
    if (m === 1 || m === 6) {
      for (const tab of ['build', 'money']) {
        await h.press(`.tabs button[data-tab="${tab}"]`)
        if (tab === 'build') {
          const transit = page.locator('.tool-group[data-group="transit"][aria-expanded="false"]')
          if (await transit.count()) await h.press(transit)
        }
        await h.snap(`${tab}-page-${m}`)
      }
      if (screen.hasTouch) await h.press('.tabs button[data-tab="money"]')
    }
    await h.press('.what-now')
    const item = page.locator('.advice:not([hidden]) .advice-item').first()
    const took = Date.now()
    let idea = null
    try {
      await item.waitFor({ state: 'visible', timeout: 30000 })
      idea = await item.locator('strong').innerText()
      const adviceMs = Date.now() - took
      if (m === 1 || m === 6) await h.snap(`advice-${m}`)
      await h.press(item.locator('.commit'))
      await page.waitForFunction(() => document.querySelector('.advice:not([hidden]) .advice-item p.small'), null, { timeout: 30000 })
      const said = await page.locator('.advice:not([hidden]) .advice-item p.small').first().innerText()
      r.months.push({ month: m, idea, adviceMs, said })
    } catch (error) {
      r.months.push({ month: m, idea, error: String(error).slice(0, 200), none: await page.locator('.advice:not([hidden]) p').allInnerTexts() })
    }
    if (await page.locator('.advice:not([hidden])').count()) await page.keyboard.press('Escape')
    await nextMonth(page, h)
    const g = await h.game()
    r.months.at(-1).score = g.score
    console.log(screen.name, JSON.stringify(r.months.at(-1)))
    if (m % 3 === 2 || m === MONTHS - 1) await h.snap(`month-${g.month}`)
    if (g.status !== 'playing') break
  }
  console.log(screen.name, 'played to', await h.game())
  await page.waitForTimeout(1500)
  await h.clear()
  const end = page.locator('.day-end')
  await end.waitFor({ state: 'visible', timeout: 8000 }).catch(() => null)
  r.dayEnd = await end.count() ? await end.innerText() : null
  if (r.dayEnd) await h.snap('day-end')
  r.end = await h.game()
  if (r.dayEnd) await h.press('.day-end .quiet')
  // Coming back: the page opened again shows where the game was left and the top of the board.
  await page.reload()
  await page.waitForSelector('.ending.welcome', { timeout: 120000 }).catch(() => null)
  r.welcome = await page.locator('.ending.welcome').innerText().catch(() => null)
  if (r.welcome) {
    await page.waitForTimeout(1500)
    await h.snap('welcome-back')
  }
  await context.close()
}

// Doing nothing for 12 months: a new player who skips the introduction and ends each month.
if (baseline && (!only.length || only.includes('laptop'))) {
  const { page, context } = await device(screens[0])
  const h = helpers(page, screens[0], 'nothing')
  await page.goto(BASE)
  await h.card().waitFor({ state: 'visible', timeout: 120000 })
  await h.press(h.card().locator('.quiet'))
  for (let m = 0; m < MONTHS; m++) {
    await h.clear()
    if (await page.locator('.day-end').count()) break
    await nextMonth(page, h)
  }
  results.nothing = await h.game()
  await context.close()
}

await browser.close()
console.log(JSON.stringify(results, null, 1))
if (errors.length) console.log('Errors in the page:\n' + [...new Set(errors)].join('\n'))
preview.kill()
process.exit(0)
