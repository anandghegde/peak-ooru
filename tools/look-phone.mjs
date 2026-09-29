// The whole game in one hand: every page and every kind of building at 360 × 640, 390 × 844 and 412 × 915, by touch
// alone (a finger-sized tap, drags and pinches sent as touch events), on a built copy served on port 5231 with `/api`
// passed to the server on 5210. Checks each page for targets under 44 px, text under 13 px, sideways scrolling and
// controls hidden under something; checks that a drag and a pinch place nothing; measures with the processor slowed
// four times. Saves screenshots to tools/shots/phone-*.png and prints what it found.
// Usage: node tools/look-phone.mjs [360|390|412 ...] [pages] [build] [gestures] [slow] [colour] [motion] [keys] [--no-build]
//   keys: a metro station and a road to mend chosen by keyboard alone, at laptop size, once.
//   With no parts named, all of them; with no size named, all three.
import { execSync, spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const PORT = 5231
const args = process.argv.slice(2)
const SIZES = [
  { name: '360', viewport: { width: 360, height: 640 } },
  { name: '390', viewport: { width: 390, height: 844 } },
  { name: '412', viewport: { width: 412, height: 915 } },
]
const PARTS = ['pages', 'build', 'gestures', 'slow', 'colour', 'motion', 'keys']
const sizes = SIZES.filter((s) => !args.some((a) => /^\d+$/.test(a)) || args.includes(s.name))
const parts = PARTS.filter((p) => !args.some((a) => PARTS.includes(a)) || args.includes(p))

// A built copy in a scratch folder, never the dev server, which reloads whenever anyone saves a file.
const out = process.env.PEAKOORU_OUT ?? join(process.env.TMPDIR ?? '/tmp', 'peakooru-phone')
if (!args.includes('--no-build')) execSync(`npx vite build --outDir ${out} --emptyOutDir`, { stdio: 'ignore' })
if (await fetch(`http://localhost:${PORT}/`).then(() => true, () => false)) {
  console.error(`Port ${PORT} is taken, perhaps by a preview server left over from an earlier run. Stop it first.`)
  process.exit(1)
}
const preview = spawn('node_modules/.bin/vite', ['preview', '--outDir', out, '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
process.on('exit', () => preview.kill())
for (let i = 0; i < 50; i++) {
  if (await fetch(`http://localhost:${PORT}/`).then((r) => r.ok, () => false)) break
  await new Promise((r) => setTimeout(r, 200))
}
// The page's own stand-in for the server, so that each run starts a game of its own and leaves nothing on the server.
const BASE = `http://localhost:${PORT}/?measure&standin-server`
mkdirSync('tools/shots', { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const found = []
const figures = {}
const say = (size, text) => {
  found.push(`${size}: ${text}`)
  console.log(`  ! ${text}`)
}

/** A phone: touch, a small screen, three pixels to the point. */
async function phone(size, extra = {}) {
  const context = await browser.newContext({
    viewport: size.viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true, ...extra,
  })
  await context.addInitScript(() => {
    localStorage.setItem('peakooru.intro', 'seen')
    localStorage.setItem('peakooru.levers', 'all')
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => say(size.name, `page error: ${String(e)}`))
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && say(size.name, `console: ${m.text()}`))
  const cdp = await context.newCDPSession(page)
  let shot = 0
  const h = {
    page, cdp, context,
    snap: async (what) => {
      await page.waitForTimeout(400)
      const path = `tools/shots/phone-${size.name}-${String(++shot).padStart(2, '0')}-${what}.png`
      await page.screenshot({ path })
      console.log('  saved', path)
      return path
    },
    ready: () => page.waitForFunction(() => window.peakooru?.month && window.peakooru.play?.game && window.peakooru.map.loaded()
      && !window.peakooru.play.busy, null, { timeout: 180000 }),
    idle: () => page.waitForFunction(() => !window.peakooru.play.busy, null, { timeout: 300000 }),
    /** Presses a control with a finger: a tap at its centre, as a person would. */
    press: async (selector) => {
      const target = page.locator(selector).first()
      await target.waitFor({ state: 'visible', timeout: 30000 })
      await target.scrollIntoViewIfNeeded()
      const box = await target.boundingBox()
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
      await page.waitForTimeout(150)
    },
    tap: (x, y) => page.touchscreen.tap(x, y),
    /** One finger down, moved along a straight line in steps, and up. */
    drag: async (from, to, steps = 12, ms = 16) => {
      const point = (x, y) => [{ x, y, radiusX: 12, radiusY: 12, force: 1, id: 1 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(...from) })
      for (let i = 1; i <= steps; i++) {
        const x = from[0] + ((to[0] - from[0]) * i) / steps
        const y = from[1] + ((to[1] - from[1]) * i) / steps
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(x, y) })
        await page.waitForTimeout(ms)
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    },
    /** Two fingers apart or together about a centre. */
    pinch: async (centre, from, to, steps = 10) => {
      const points = (d) => [
        { x: centre[0] - d / 2, y: centre[1], radiusX: 12, radiusY: 12, force: 1, id: 1 },
        { x: centre[0] + d / 2, y: centre[1], radiusX: 12, radiusY: 12, force: 1, id: 2 },
      ]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) })
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(from + ((to - from) * i) / steps) })
        await page.waitForTimeout(16)
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    },
    /** Where a place is on the screen. */
    at: (lng, lat) => page.evaluate(([lng, lat]) => {
      const p = window.peakooru.map.project([lng, lat])
      return { x: p.x, y: p.y }
    }, [lng, lat]),
    /** The part of the map that shows between the bar and the sheet (or the dock). */
    open: () => page.evaluate(() => {
      const bar = document.querySelector('.bar').getBoundingClientRect()
      const panel = document.querySelector('.panel.open')
      const sheet = panel && getComputedStyle(panel).display !== 'none' ? panel.getBoundingClientRect() : null
      const dock = document.querySelector('.dock').getBoundingClientRect()
      return { top: bar.bottom, bottom: sheet ? sheet.top : dock.top, width: innerWidth }
    }),
    audit: (where) => audit(page, size, where),
  }
  return h
}

/** Everything wrong with the page as it stands, for a thumb: small targets, small text, sideways scroll, hidden controls. */
async function audit(page, size, where) {
  const problems = await page.evaluate(() => {
    const out = []
    const shown = (el) => {
      const s = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0 && el.closest('[hidden]') === null
    }
    /** Whether the point is inside every box that clips the element. */
    const inView = (el, x, y) => {
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p)
        if (/(auto|scroll|hidden)/.test(s.overflowY + s.overflowX)) {
          const r = p.getBoundingClientRect()
          if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false
        }
      }
      return true
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} px)`)
    for (const el of document.querySelectorAll('.panel-body, .ending-card, .intro')) {
      if (shown(el) && el.scrollWidth > el.clientWidth + 1) out.push(`${el.className} scrolls sideways (${el.scrollWidth} in ${el.clientWidth})`)
    }
    const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40)
    for (const el of document.querySelectorAll('button, a[href], input, select, [role="button"]')) {
      // The map's credit is small print that must be there, not a control.
      if (!shown(el) || el.disabled || el.closest('.credit')) continue
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      if (!inView(el, x, y)) continue
      if (r.height < 43.5 || r.width < 43.5) out.push(`small target ${Math.round(r.width)}×${Math.round(r.height)}: "${name(el)}"`)
      const top = document.elementFromPoint(x, y)
      // Behind a card that covers the page on purpose (the review, the ending, the introduction): not a fault.
      const modal = top?.closest('.ending, .intro, .first-card, .refusal, .event-card')
      if (modal && !modal.contains(el)) continue
      if (top && top !== el && !el.contains(top) && !top.closest('.maplibregl-canvas-container')) {
        out.push(`"${name(el)}" is under ${top.className || top.tagName}`)
      }
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const small = new Map()
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement
      if (!n.textContent.trim() || !el || !shown(el) || el.closest('.kannada, .maplibregl-map canvas, .credit')) continue
      const modal = document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('.ending, .intro, .first-card')
      if (modal && !modal.contains(el)) continue
      const r = el.getBoundingClientRect()
      if (!inView(el, r.left + 1, r.top + r.height / 2)) continue
      const px = parseFloat(getComputedStyle(el).fontSize)
      if (px < 13) small.set(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${px}px`, n.textContent.trim().slice(0, 30))
    }
    for (const [k, v] of small) out.push(`small text ${k}: "${v}"`)
    return out
  })
  for (const p of problems) say(size.name, `${where}: ${p}`)
  return problems
}

// --------------------------------------------------------------------------------------------------------------------

/** Listens in the page for the screen's signals, to check that each act says it happened. */
const listen = (page) => page.evaluate(() => {
  window.heard = []
  window.addEventListener('peakooru', (e) => window.heard.push(e.detail.name))
})
const heard = (page) => page.evaluate(() => window.heard.splice(0))

/** A point on a line of `layers` that shows in the open map, with the feature's id, or null. */
const onLayer = (page, layers, open, test = 'true') => page.evaluate(([layers, open, test]) => {
  const map = window.peakooru.map
  const pass = new Function('f', `return ${test}`)
  const box = [[16, open.top + 24], [open.width - 16, open.bottom - 24]]
  const hits = map.queryRenderedFeatures(box, { layers: layers.filter((l) => map.getLayer(l)) }).filter(pass)
  for (const f of hits) {
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : []
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i]
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        const p = map.project(mid)
        const pa = map.project(a), pb = map.project(b)
        if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < 20) continue
        if (p.x > box[0][0] && p.x < box[1][0] && p.y > box[0][1] && p.y < box[1][1]) return { x: p.x, y: p.y, id: f.id ?? f.properties?.id }
      }
    }
  }
  return null
}, [layers, open, test])

for (const size of sizes) {
  console.log(`\n== ${size.name} × ${size.viewport.height}`)
  if (parts.some((p) => ['pages', 'build', 'gestures'].includes(p))) {
    const h = await phone(size)
    const { page } = h
    await page.goto(BASE)
    await h.ready()
    await listen(page)
    await h.snap('first-sight')
    await h.audit('first sight')
    if (parts.includes('gestures')) await gestures(h, size)
    if (parts.includes('build')) await buildByTouch(h, size)
    if (parts.includes('pages')) await pages(h, size)
    await Promise.race([h.context.close(), new Promise((r) => setTimeout(r, 5000))])
  }
  if (parts.includes('slow')) await slow(size)
  if (parts.includes('colour')) await colour(size)
  if (parts.includes('motion')) await motion(size)
}

if (parts.includes('keys')) await keys()

console.log('\n== Found')
for (const f of found) console.log(f)
console.log(JSON.stringify(figures, null, 1))
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))])
process.exit(0)

/** Frames the map on a place, in the part of it that shows. */
async function frameOn(h, lng, lat, zoom) {
  const view = await h.open()
  await h.page.evaluate(([lng, lat, zoom, top, bottom]) => {
    window.peakooru.map.jumpTo({ center: [lng, lat], zoom, padding: { top, bottom: innerHeight - bottom, left: 0, right: 0 } })
  }, [lng, lat, zoom, view.top, view.bottom])
  await h.page.waitForTimeout(400)
  return view
}

/** A stop placed by finger: a tap on the map, then the magnified view's button. */
async function placeByTouch(h, size, lng, lat, n, what) {
  const { page } = h
  await frameOn(h, lng, lat, 13)
  const p = await h.at(lng, lat)
  await h.tap(p.x, p.y)
  const magnified = await page.waitForSelector('.magnifier:not([hidden])', { timeout: 3000 }).catch(() => null)
  if (!magnified) return say(size.name, `${what} ${n}: no magnified view after a tap`)
  await page.waitForFunction(() => document.querySelector('.snap-hint')?.textContent, null, { timeout: 15000 })
    .catch(() => say(size.name, `${what} ${n}: the magnified view said nothing of where it would go`))
  if (n === 1) await h.snap(`${what}-magnifier`)
  await h.press('[data-build="magnify-ok"]')
  await page.waitForFunction((n) => window.peakooru.build.stops.length === n, n, { timeout: 30000 })
    .catch(() => say(size.name, `${what} ${n} not placed`))
  await page.waitForTimeout(500)
}

async function buildByTouch(h, size) {
  const { page } = h
  const openBuild = async () => {
    if (await page.evaluate(() => window.peakooru.panel.tab !== 'build')) await h.press('.tabs button[data-tab="build"]')
  }
  const tool = async (group, name) => {
    await openBuild()
    if (await page.locator(`.tool[data-tool="${name}"]`).count() === 0) await h.press(`.tool-group[data-group="${group}"]`)
    await h.press(`.tool[data-tool="${name}"]`)
  }
  await openBuild()
  await h.snap('build-home')
  await h.audit('build home')

  // A metro line by hand: three stations north to south, one taken back with Undo and put again.
  await tool('transit', 'metro')
  await page.waitForFunction(() => window.peakooru.build.suggestions, null, { timeout: 60000 })
  await h.snap('metro-chosen')
  await h.audit('metro chosen')
  const stations = [[77.595, 13.035], [77.59, 12.975], [77.62, 12.93]]
  for (const [i, [lng, lat]] of stations.entries()) {
    const t0 = Date.now()
    await placeByTouch(h, size, lng, lat, i + 1, 'metro')
    if (i === 0) {
      figures[`${size.name} first station, tap to drawn (ms)`] = Date.now() - t0
      await h.snap('metro-station-1')
    }
  }
  await page.waitForFunction(() => window.peakooru.build.quote?.ok, null, { timeout: 30000 })
  await h.snap('metro-three-stations')
  await h.audit('metro, three stations, sheet lowered')
  const card = await page.locator('.tap-card:not([hidden])').count()
  if (!card) say(size.name, 'no card beside the last station placed')
  await h.press('[data-build="undo"]')
  await page.waitForFunction(() => window.peakooru.build.stops.length === 2, null, { timeout: 30000 })
    .catch(() => say(size.name, 'Undo did not take the last station back'))
  await h.snap('metro-undone')
  await placeByTouch(h, size, ...stations[2], 3, 'metro-again')
  await page.waitForFunction(() => window.peakooru.build.foreseen, null, { timeout: 60000 })
  await h.press('[data-build="sheet"]')
  await h.snap('metro-sheet-raised')
  await h.audit('metro, sheet raised')
  await h.press('[data-build="sheet"]')
  await h.snap('metro-sheet-lowered')
  const sig = await heard(page)
  if (!sig.includes('placed')) say(size.name, `no 'placed' signal while laying a line (heard ${sig.join(', ')})`)
  await h.press('[data-build="commit"]')
  await page.waitForFunction(() => !window.peakooru.build.tool, null, { timeout: 30000 }).catch(() => say(size.name, 'the metro line was not ordered'))
  await h.snap('metro-ordered')
  if (!(await heard(page)).includes('built')) say(size.name, `no 'built' signal for the metro line`)

  // A bus route by hand: two stops.
  await tool('transit', 'busRoute')
  await page.waitForFunction(() => window.peakooru.build.suggestions, null, { timeout: 60000 })
  await placeByTouch(h, size, 77.64, 12.975, 1, 'bus')
  await placeByTouch(h, size, 77.7, 12.955, 2, 'bus')
  await page.waitForFunction(() => window.peakooru.build.quote?.ok && window.peakooru.build.foreseen, null, { timeout: 60000 })
    .catch(() => say(size.name, 'the bus route had no proposal'))
  await h.snap('bus-route')
  await h.audit('bus route')
  await h.press('[data-build="commit"]')
  await page.waitForFunction(() => !window.peakooru.build.tool, null, { timeout: 30000 }).catch(() => say(size.name, 'the bus route was not ordered'))

  // A bus lane: a tap on a road marked for one, its card, Undo from the card, and again.
  await tool('transit', 'busLane')
  await h.snap('lane-chosen-tool')
  await page.waitForTimeout(1500)
  let view = await frameOn(h, 77.6, 12.97, 13.2)
  const lane = await onLayer(page, ['lane-candidates'], view)
  if (!lane) say(size.name, 'no road for a bus lane in view')
  else {
    await h.tap(lane.x, lane.y)
    await page.waitForFunction(() => window.peakooru.build.lanes.length > 0, null, { timeout: 10000 }).catch(() => say(size.name, 'a tap on a road gave no bus lane'))
    await h.snap('lane-tapped')
    await h.audit('bus lane tapped')
    const undo = page.locator('.tap-card:not([hidden]) [data-build="card-undo"]')
    if (await undo.count()) {
      const b = await undo.boundingBox()
      await h.tap(b.x + b.width / 2, b.y + b.height / 2)
      await page.waitForFunction(() => window.peakooru.build.lanes.length === 0, null, { timeout: 10000 }).catch(() => say(size.name, 'Undo on the card kept the lane'))
    } else say(size.name, 'no Undo beside the lane tapped')
    await h.tap(lane.x, lane.y)
    await page.waitForFunction(() => window.peakooru.build.quote?.ok && window.peakooru.build.foreseen, null, { timeout: 60000 }).catch(() => null)
    await h.snap('lane-proposal')
    await h.press('[data-build="commit"]')
    await page.waitForFunction(() => !window.peakooru.build.tool, null, { timeout: 30000 }).catch(() => say(size.name, 'the bus lane was not ordered'))
  }

  // Mending a road: a tap on a poor road in the road condition view.
  await tool('upkeep', 'patch')
  await page.waitForFunction(() => window.peakooru.condition && document.querySelector('.instruction'), null, { timeout: 30000 })
  await page.waitForTimeout(2000)
  await h.snap('mend-tool')
  view = await frameOn(h, 77.59, 12.96, 13.4)
  const road = await onLayer(page, ['condition', 'condition-broken'], view, '(f.state?.grade ?? 0) >= 2')
  if (!road) say(size.name, 'no poor road in view to mend')
  else {
    await h.tap(road.x, road.y)
    await page.waitForFunction(() => window.peakooru.build.mendLinks.length > 0, null, { timeout: 10000 }).catch(() => say(size.name, 'a tap on a poor road chose nothing'))
    await page.waitForFunction(() => window.peakooru.build.quote?.ok, null, { timeout: 30000 }).catch(() => null)
    await h.snap('mend-tapped')
    await h.audit('mend tapped')
    await h.press('[data-build="commit"]')
    await page.waitForFunction(() => !window.peakooru.build.tool, null, { timeout: 30000 }).catch(() => say(size.name, 'the road was not mended'))
    await h.snap('mend-done')
  }

  // The same by name, without the map: a road from the list of the worst.
  await tool('upkeep', 'resurface')
  await page.waitForSelector('[data-build="list"]', { timeout: 30000 }).catch(() => say(size.name, 'no list of roads for mending'))
  if (await page.locator('[data-build="list"]').count()) {
    await page.selectOption('[data-build="list"]', { index: 1 })
    await page.waitForFunction(() => window.peakooru.build.quote?.ok, null, { timeout: 30000 }).catch(() => say(size.name, 'a road from the list gave no proposal'))
    await h.snap('mend-from-list')
  }
  await h.press('[data-build="back"]')
  const last = await heard(page)
  if (!last.includes('placed')) say(size.name, 'no placed signal for a road from the list')
}

/** Moving the map and pinching must never place a stop; a long press neither; a still tap does. */
async function gestures(h, size) {
  const { page } = h
  await h.press('.tabs button[data-tab="build"]')
  if (await page.locator('.tool[data-tool="metro"]').count() === 0) await h.press('.tool-group[data-group="transit"]')
  await h.press('.tool[data-tool="metro"]')
  await page.waitForFunction(() => window.peakooru.build.suggestions, null, { timeout: 60000 })
  await frameOn(h, 77.6, 12.97, 12.5)
  const view = await h.open()
  const mid = [size.viewport.width / 2, (view.top + view.bottom) / 2]
  const count = () => page.evaluate(() => ({ stops: window.peakooru.build.stops.length, magnifier: !document.querySelector('.magnifier').hidden }))
  const tries = [
    ['drag 60 px', () => h.drag(mid, [mid[0] + 60, mid[1] + 20])],
    ['drag 24 px, slowly', () => h.drag(mid, [mid[0] + 24, mid[1]], 8, 40)],
    ['flick', () => h.drag(mid, [mid[0] - 120, mid[1]], 4, 8)],
    ['pinch out', () => h.pinch(mid, 80, 180)],
    ['pinch in', () => h.pinch(mid, 180, 90)],
    ['long press', async () => {
      await h.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mid[0], y: mid[1], id: 1 }] })
      await page.waitForTimeout(800)
      await h.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }],
  ]
  for (const [what, run] of tries) {
    await run()
    await page.waitForTimeout(900)
    const c = await count()
    const ok = c.stops === 0 && !c.magnifier
    console.log(`  ${what}: ${ok ? 'placed nothing' : 'PLACED'}`)
    if (!ok) {
      say(size.name, `${what} placed a stop or opened the magnified view`)
      if (c.magnifier) await h.press('[data-build="magnify-cancel"]')
      await page.evaluate(() => window.peakooru.build.choose('metro'))
    }
  }
  // A tap that stops the map gliding stops it, and places nothing.
  await h.drag(mid, [mid[0] - 160, mid[1]], 3, 8)
  await page.waitForTimeout(30)
  const moving = await page.evaluate(() => window.peakooru.map.isMoving())
  await h.tap(mid[0], mid[1])
  await page.waitForTimeout(900)
  const glide = await count()
  console.log(`  tap on a gliding map (${moving ? 'it was gliding' : 'it had stopped'}): ${glide.magnifier ? 'PLACED' : 'placed nothing'}`)
  if (moving && glide.magnifier) say(size.name, 'a tap to stop the map gliding opened the magnified view')
  if (glide.magnifier) await h.press('[data-build="magnify-cancel"]')
  // A finger that wobbles within the browser's own slop (about 15 px, inside which Chrome sends the page no moves and
  // the map does not move) is a tap.
  await h.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mid[0], y: mid[1], id: 1 }] })
  await h.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mid[0] + 3, y: mid[1] + 2, id: 1 }] })
  await page.waitForTimeout(90)
  await h.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(900)
  const wobble = await count()
  console.log(`  tap that moved 4 px: ${wobble.magnifier ? 'taken as a tap' : 'NOT taken'}`)
  if (!wobble.magnifier) say(size.name, 'a tap that moved 4 px was not taken as a tap')
  else await h.press('[data-build="magnify-cancel"]')
  figures[`${size.name} gestures ignored`] = await page.evaluate(() => window.peakooru.build.ignored.slice())
  await h.press('[data-build="back"]')
}

/** Every page, as a thumb meets it. */
async function pages(h, size) {
  const { page } = h
  const tab = async (name, what) => {
    if (await page.evaluate((t) => window.peakooru.panel.tab === t, name)) await page.evaluate(() => window.peakooru.panel.close())
    await h.press(`.tabs button[data-tab="${name}"]`)
    await page.waitForTimeout(500)
    await h.snap(what)
    await h.audit(what)
    // The rest of a long page, scrolled to its foot.
    const more = await page.evaluate(() => {
      const b = document.querySelector('.panel-body')
      if (!b || b.scrollHeight <= b.clientHeight + 4) return false
      b.scrollTop = b.scrollHeight
      return true
    })
    if (more) {
      await h.snap(`${what}-foot`)
      await h.audit(`${what}, foot`)
    }
  }
  await tab('score', 'score')
  await page.evaluate(() => window.peakooru.panel.body.scrollTop = 0)
  const measure = page.locator('.measure-head').first()
  if (await measure.count()) {
    await h.press('.measure-head')
    await h.snap('score-measure-open')
    await h.audit('score, a measure open')
  }
  await tab('money', 'money-levers')
  await h.press('.tabs button[data-tab="money"]')
  await h.press('.tabs button[data-tab="money"]')
  await h.press('[data-money="books"]')
  await page.waitForTimeout(1500)
  await h.snap('money-books')
  await h.audit('money, the books')
  await tab('board', 'board')
  // A month ended by the dock's Next, then its report.
  await page.evaluate(() => window.peakooru.panel.close())
  const t0 = Date.now()
  await h.press('.next')
  await h.idle()
  figures[`${size.name} Next to report shown (ms)`] = Date.now() - t0
  await page.waitForTimeout(800)
  await h.snap('report')
  await h.audit('report')
  await page.evaluate(() => {
    const b = document.querySelector('.panel-body')
    b.scrollTop = b.scrollHeight
  })
  await h.snap('report-foot')
  await h.audit('report, foot')
  await tab('build', 'build-after-month')
  // The yearly review: the rest of the year skipped.
  await page.evaluate(() => window.peakooru.panel.close())
  await h.press('.skip')
  await h.snap('skip-menu')
  await h.audit('skip menu')
  await h.press('.skip-menu button[data-skip="12"]')
  // A skip stops early for anything that needs the player: on to the year's end, closing what comes up.
  for (let i = 0; i < 12; i++) {
    await h.idle()
    if (await page.locator('.ending.review').count()) break
    const month = await page.evaluate(() => window.peakooru.play.game.month)
    if (month >= 12) break
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('.event-card .commit, .first-card .quiet')) b.click()
      return window.peakooru.skip(12)
    })
  }
  await page.waitForSelector('.ending.review', { timeout: 30000 }).catch(() => say(size.name, 'no yearly review after skipping a year'))
  await h.idle()
  await page.waitForTimeout(800)
  if (await page.locator('.ending.review').count()) {
    await h.snap('review')
    await h.audit('review')
    const foot = await page.evaluate(() => {
      const c = document.querySelector('.ending.review .ending-card')
      if (!c || c.scrollHeight <= c.clientHeight + 4) return false
      c.scrollTop = c.scrollHeight
      return true
    })
    if (foot) {
      await h.snap('review-foot')
      await h.audit('review, foot')
    }
    const close = page.locator('.ending.review .commit').first()
    if (await close.count()) await h.press('.ending.review .commit')
  }
  // The ending, shown as the game stands.
  await page.evaluate(() => window.peakooru.ending())
  await page.waitForTimeout(1500)
  await h.snap('ending')
  await h.audit('ending')
  await page.evaluate(() => {
    const c = document.querySelector('.ending-card')
    if (c) c.scrollTop = c.scrollHeight
  })
  await h.snap('ending-foot')
  await h.audit('ending, foot')
}

/** The processor slowed four times: first sight, a month, moving the map, laying a line. */
async function slow(size) {
  console.log('  slowed four times')
  const context = await browser.newContext({ viewport: size.viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  await context.addInitScript(() => {
    localStorage.setItem('peakooru.intro', 'seen')
    localStorage.setItem('peakooru.levers', 'all')
  })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const t0 = Date.now()
  await page.goto(BASE)
  await page.waitForFunction(() => window.peakooru?.map?.loaded(), null, { timeout: 180000 })
  const map = Date.now() - t0
  await page.waitForFunction(() => window.peakooru?.month && window.peakooru.play?.game && !window.peakooru.play.busy, null, { timeout: 300000 })
  const game = Date.now() - t0
  const f = { 'map shown (ms)': map, 'game ready, month worked out (ms)': game }
  // A month: from pressing Next to the report on the screen.
  const m0 = Date.now()
  await page.locator('.next').tap()
  await page.waitForFunction(() => !window.peakooru.play.busy && window.peakooru.panel.tab === 'report', null, { timeout: 300000 })
  f['Next to report (ms)'] = Date.now() - m0
  f['worker month (ms)'] = await page.evaluate(() => window.peakooru.play.times.slice(-3))
  await page.evaluate(() => window.peakooru.panel.close())
  // Panning by finger: frames drawn while the map follows a drag.
  const frames = await page.evaluate(() => {
    window.__frames = []
    const tick = (t) => {
      window.__frames.push(t)
      if (window.__frames.length < 2000) window.__raf = requestAnimationFrame(tick)
    }
    window.__raf = requestAnimationFrame(tick)
  })
  const mid = [size.viewport.width / 2, size.viewport.height / 2]
  for (let k = 0; k < 4; k++) {
    const pts = (x, y) => [{ x, y, id: 1 }]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(...mid) })
    for (let i = 1; i <= 30; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(mid[0] + (k % 2 ? -1 : 1) * i * 5, mid[1] + i * 2 * (k < 2 ? 1 : -1)) })
      await page.waitForTimeout(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  const fr = await page.evaluate(() => {
    cancelAnimationFrame(window.__raf)
    const t = window.__frames
    const gaps = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b)
    return { fps: Math.round((t.length - 1) / ((t.at(-1) - t[0]) / 1000)), worst: Math.round(gaps.at(-1)), p95: Math.round(gaps[Math.floor(gaps.length * 0.95)]) }
  })
  void frames
  f['panning by finger, frames a second'] = fr.fps
  f['panning, slowest frame (ms)'] = fr.worst
  // Laying a line: a tap on the map, the magnified view, and the station drawn.
  await page.evaluate(() => {
    window.peakooru.panel.open('build')
    window.peakooru.build.choose('metro')
    window.peakooru.map.jumpTo({ center: [77.6, 12.97], zoom: 13 })
  })
  await page.waitForTimeout(1500)
  const tapAt = await page.evaluate(() => window.peakooru.map.project([77.6, 12.99]))
  const l0 = Date.now()
  await page.touchscreen.tap(tapAt.x, tapAt.y)
  await page.waitForSelector('.magnifier:not([hidden])', { timeout: 10000 })
  f['tap to magnified view (ms)'] = Date.now() - l0
  await page.waitForFunction(() => document.querySelector('.snap-hint')?.textContent, null, { timeout: 30000 }).catch(() => null)
  f['tap to where it goes said (ms)'] = Date.now() - l0
  const ok = await page.locator('[data-build="magnify-ok"]').boundingBox()
  const s0 = Date.now()
  await page.touchscreen.tap(ok.x + ok.width / 2, ok.y + ok.height / 2)
  await page.waitForFunction(() => window.peakooru.build.stops.length === 1 && window.peakooru.build.quote, null, { timeout: 30000 })
  f['confirm to station drawn (ms)'] = Date.now() - s0
  f['tap to stop, in page (ms)'] = await page.evaluate(() => window.peakooru.build.times.tapToStop.map(Math.round))
  figures[`${size.name} slowed ×4`] = f
  console.log(' ', JSON.stringify(f))
  await page.screenshot({ path: `tools/shots/phone-${size.name}-slow-station.png` })
  await Promise.race([context.close(), new Promise((r) => setTimeout(r, 5000))])
}

/** Each map view through the three common kinds of colour blindness. */
async function colour(size) {
  const h = await phone(size)
  const { page, cdp } = h
  await page.goto(BASE)
  await h.ready()
  const views = [
    ['traffic', async () => page.evaluate(() => {
      window.peakooru.controls.setPeriod('evening')
      window.peakooru.map.jumpTo({ center: [77.62, 12.94], zoom: 13 })
    })],
    ['traffic-city', async () => page.evaluate(() => {
      window.peakooru.controls.setPeriod('evening')
      window.peakooru.map.jumpTo({ center: [77.6, 12.97], zoom: 11 })
    })],
    ['roads', async () => {
      await page.evaluate(() => {
        window.peakooru.controls.setPeriod(null)
        window.peakooru.controls.setView('roads')
        window.peakooru.map.jumpTo({ center: [77.6, 12.96], zoom: 13 })
      })
      await page.waitForTimeout(1500)
    }],
    ['people', async () => page.evaluate(() => {
      window.peakooru.controls.setView('people')
      window.peakooru.map.jumpTo({ center: [77.6, 12.97], zoom: 10.6 })
    })],
    ['metro', async () => page.evaluate(() => {
      window.peakooru.controls.setView('plain')
      window.peakooru.map.jumpTo({ center: [77.6, 12.97], zoom: 11.3 })
    })],
  ]
  for (const [what, show] of views) {
    await show()
    await page.waitForTimeout(1200)
    for (const type of ['none', 'deuteranopia', 'protanopia', 'tritanopia']) {
      await cdp.send('Emulation.setEmulatedVisionDeficiency', { type })
      await page.waitForTimeout(300)
      await page.screenshot({ path: `tools/shots/phone-${size.name}-colour-${what}-${type}.png` })
    }
    await cdp.send('Emulation.setEmulatedVisionDeficiency', { type: 'none' })
  }
  console.log(`  saved tools/shots/phone-${size.name}-colour-*.png`)
  await Promise.race([h.context.close(), new Promise((r) => setTimeout(r, 5000))])
}

/** Asked for less motion: the day's playback stands still, and the map jumps rather than glides. */
async function motion(size) {
  const h = await phone(size, { reducedMotion: 'reduce' })
  const { page } = h
  await page.goto(BASE)
  await h.ready()
  await page.waitForFunction(() => window.peakooru.playback, null, { timeout: 60000 })
  const r = await page.evaluate(async () => {
    const p = window.peakooru
    p.controls.setPeriod('evening')
    p.playback.play(p.month.view)
    await new Promise((r) => setTimeout(r, 1500))
    const a = Array.from(p.playback.vehicles.time)
    await new Promise((r) => setTimeout(r, 1500))
    const b = Array.from(p.playback.vehicles.time)
    p.playback.stop()
    const t0 = performance.now()
    p.map.easeTo({ center: [77.62, 12.95], zoom: 13, duration: 600 })
    await new Promise((r) => requestAnimationFrame(() => r()))
    return { still: a.every((x, i) => x === b[i]), eased: p.map.isMoving(), jumped: Math.abs(p.map.getZoom() - 13) < 0.01, ms: performance.now() - t0 }
  })
  console.log(`  reduced motion: vehicles ${r.still ? 'stand still' : 'MOVE'}; the map ${r.jumped ? 'jumps' : 'glides'}`)
  if (!r.still) say(size.name, 'with reduced motion the playback still moves the vehicles')
  if (!r.jumped) say(size.name, 'with reduced motion the map still glides')
  figures[`${size.name} reduced motion`] = r
  await Promise.race([h.context.close(), new Promise((r) => setTimeout(r, 5000))])
}

/** By keyboard alone: Tab to the Build tab, a tool, a station from the list, and the focus kept through each redraw. */
async function keys() {
  console.log('\n== keyboard, 1280 × 800')
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.addInitScript(() => {
    localStorage.setItem('peakooru.intro', 'seen')
    localStorage.setItem('peakooru.levers', 'all')
  })
  const page = await context.newPage()
  await page.goto(BASE)
  await page.waitForFunction(() => window.peakooru?.month && window.peakooru.play?.game && !window.peakooru.play.busy, null, { timeout: 180000 })
  const focused = () => page.evaluate(() => {
    const a = document.activeElement
    return a ? `${a.tagName.toLowerCase()} ${a.dataset?.tab ?? a.dataset?.tool ?? a.dataset?.group ?? a.dataset?.build ?? a.textContent?.trim().slice(0, 30)}` : 'nothing'
  })
  /** Tabs until the focus is on `selector`, as a person would, up to 80 presses. */
  const tabTo = async (selector) => {
    for (let i = 0; i < 80; i++) {
      if (await page.evaluate((s) => document.activeElement?.matches(s), selector)) return i
      await page.keyboard.press('Tab')
    }
    say('keys', `could not reach ${selector} by Tab`)
    return -1
  }
  await page.locator('body').focus()
  console.log('  presses to the Build tab:', await tabTo('.tabs button[data-tab="build"]'))
  await page.keyboard.press('Enter')
  await tabTo('.tool-group[data-group="transit"]')
  await page.keyboard.press('Enter')
  console.log('  after opening the group, focus is on:', await focused())
  await tabTo('.tool[data-tool="metro"]')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  await tabTo('[data-build="list"]')
  const visible = await page.evaluate(() => {
    const a = document.activeElement
    return getComputedStyle(a).outlineStyle !== 'none'
  })
  console.log('  focus ring on the list:', visible)
  if (!visible) say('keys', 'no focus ring on the list')
  await page.selectOption('[data-build="list"]', { label: 'Hebbal station' }).catch(() => page.selectOption('[data-build="list"]', { index: 5 }))
  await page.waitForFunction(() => window.peakooru.build.stops.length === 1, null, { timeout: 30000 }).catch(() => say('keys', 'a station from the list was not placed'))
  console.log('  after choosing a station, focus is on:', await focused())
  await page.screenshot({ path: 'tools/shots/phone-keys-station.png' })
  await Promise.race([context.close(), new Promise((r) => setTimeout(r, 5000))])
}
