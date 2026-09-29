// Uses the levers of upkeep as a player would, at laptop and at phone size: the road condition view at the whole
// city and at street level; patch a stretch of a named road, then all of it that is poor; resurface a named road;
// lay concrete; mend a zone's streets; set the upkeep budget and a standing order; end the month and read what the
// mending did; skip through a monsoon and see what flooded; read the report's worst roads and go to one.
// Saves screenshots to tools/shots/upkeep-*.png and prints timings, forecasts and any errors in the page.
// Usage: node tools/look-upkeep.mjs [laptop|phone|widths] ; PEAKOORU_URL sets the address (default the dev server).
import { chromium } from 'playwright-core'

const BASE = process.env.PEAKOORU_URL ?? 'http://localhost:5190/'
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const screens = [
  { name: 'laptop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
]
const loaded = () => window.peakooru?.month && window.peakooru.play?.game && window.peakooru.map.loaded() && window.peakooru.condition

const browser = await chromium.launch({ channel: 'chrome', headless: true })

/** A stretch of a named road in poor or broken repair near a place, as the page knows it: its middle and its id. */
const findStretch = async (page, name, near) => {
  await page.waitForFunction(() => window.peakooru.roads?.network && window.peakooru.play.surface, null, { timeout: 60000 })
  const found = await page.evaluate(([name, near]) => {
    const p = window.peakooru
    const net = p.roads.network
    const surface = p.play.surface
    let best = null
    for (const l of net.links) {
      if (l.name !== name || (surface.stretch[l.id] & 3) < 2 || l.line.length < 4) continue
      const mid = [(l.line[0] + l.line[l.line.length - 2]) / 2, (l.line[1] + l.line[l.line.length - 1]) / 2]
      const d = Math.hypot(mid[0] - near[0], mid[1] - near[1])
      if (!best || d < best.d) best = { id: l.id, at: mid, d }
    }
    return best
  }, [name, near])
  if (!found) throw new Error(`No poor stretch of ${name} near there.`)
  return found
}

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
    await page.evaluate(() => {
      const p = window.peakooru
      p.panel.open('build')
      p.map.jumpTo({ center: [77.62, 12.93], zoom: 14 })
      p.build.choose('resurface')
    })
    const s = await findStretch(page, 'Hosur Road', [77.62, 12.93]).catch(() => null)
    if (s) await page.evaluate((id) => window.peakooru.build.chooseStretch_(id), s.id)
    await page.waitForFunction(() => document.querySelector('.proposal .commit') && !document.querySelector('.proposal .working'), null, { timeout: 60000 }).catch(() => null)
    await page.waitForTimeout(700)
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    console.log(width, 'horizontal scroll:', scroll)
    await page.screenshot({ path: `tools/shots/upkeep-width-${width}.png` })
    await page.evaluate(() => window.peakooru.panel.open('money'))
    await page.waitForTimeout(1500)
    await page.evaluate(() => { const b = window.peakooru.panel.body; b.scrollTop = b.scrollHeight })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `tools/shots/upkeep-width-${width}-levers.png` })
    await context.close()
  }
  await browser.close()
  process.exit(0)
}

const report = {}
for (const screen of screens) {
  if (only.length && !only.includes(screen.name)) continue
  const { name, ...options } = screen
  const context = await browser.newContext(options)
  await context.addInitScript(() => localStorage.setItem('peakooru.intro', 'seen'))
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()}: ${m.text()}`))
  const figures = { forecasts: {}, seconds: {} }
  let shot = 0
  const snap = async (what) => {
    await page.waitForTimeout(300)
    await page.evaluate(() => new Promise((r) => (window.peakooru.map.loaded() ? r() : window.peakooru.map.once('idle', r))))
    await page.waitForTimeout(400)
    const path = `tools/shots/upkeep-${name}-${String(++shot).padStart(2, '0')}-${what}.png`
    await page.screenshot({ path })
    console.log(name, 'saved', path)
  }
  // The page is drawn again as answers arrive, which can take a button away as it is pressed: so a few tries.
  const press = async (selector) => {
    for (let i = 0; ; i++) {
      try {
        const target = page.locator(selector).first()
        await target.waitFor({ state: 'visible', timeout: 30000 })
        await target.scrollIntoViewIfNeeded({ timeout: 5000 })
        if (screen.hasTouch) await target.tap({ timeout: 5000 })
        else await target.click({ timeout: 5000 })
        return
      } catch (error) {
        if (i >= 3) throw error
        await page.waitForTimeout(400)
      }
    }
  }
  const idle = () => page.waitForFunction(() => window.peakooru?.play && !window.peakooru.play.busy, null, { timeout: 300000 })
  const tab = async (which) => {
    const open = await page.evaluate(() => window.peakooru.panel.tab)
    if (open !== which) await press(`.tabs button[data-tab="${which}"]`)
  }
  const done = () => page.evaluate(() => window.peakooru.play.game.done.length)
  /** Taps the map at a place, moving the map first if the place is under the sheet or off the screen. */
  const tapAt = async (lng, lat) => {
    const p = await page.evaluate(([lng, lat]) => {
      const { map, panel } = window.peakooru
      let p = map.project([lng, lat])
      const bottom = panel.tab && innerWidth <= 600 ? panel.root.getBoundingClientRect().top - 40 : innerHeight - 40
      const left = panel.tab && innerWidth > 600 ? panel.root.getBoundingClientRect().right + 20 : 20
      if (p.y > bottom || p.y < 90 || p.x < left || p.x > innerWidth - 290) {
        map.jumpTo({ center: map.unproject([p.x - (left + innerWidth - 270) / 2 + innerWidth / 2, p.y - (90 + bottom) / 2 + innerHeight / 2]) })
        p = map.project([lng, lat])
      }
      return p
    }, [lng, lat])
    await page.waitForTimeout(300)
    if (screen.hasTouch) await page.touchscreen.tap(p.x, p.y)
    else await page.mouse.click(p.x, p.y)
  }
  const view = (lng, lat, zoom) => page.evaluate(([lng, lat, zoom]) => {
    const { map, panel } = window.peakooru
    map.jumpTo({ center: [lng, lat], zoom: innerWidth <= 600 ? zoom - 1 : zoom })
    const sheet = panel.tab && innerWidth <= 600 ? innerHeight - panel.root.getBoundingClientRect().top : 0
    if (sheet) map.panBy([0, sheet / 2], { duration: 0 })
    else if (panel.tab) map.panBy([-(panel.root.getBoundingClientRect().right - 270) / 2, 0], { duration: 0 })
  }, [lng, lat, zoom])
  const forecast = () => page.waitForFunction(() => {
    const b = window.peakooru.build
    return (b.foreseen && !document.querySelector('.proposal .working')) || document.querySelector('.proposal .reason')
  }, null, { timeout: 90000 })
  const keep = (what) => page.evaluate(() => {
    const f = window.peakooru.build.foreseen
    const q = window.peakooru.build.quote
    const round = (n) => (n === undefined || n === null ? n : Math.round(n * 10) / 10)
    return f && {
      cost: q?.cost, months: q?.months, major: q?.major, lasts: q?.lasts, note: q?.note,
      commute: f.before && [round(f.before.commute / 60), round(f.after.commute / 60)],
      served: f.served && [round(f.served.before / 60), round(f.served.after / 60), f.served.zones],
      road: f.road && { condition: f.road.condition.map(round), kmh: f.road.kmh.map(round) },
      deaths: f.before && [f.before.deaths, f.after.deaths], unforeseen: f.unforeseen,
    }
  }).then((f) => (figures.forecasts[what] = f))
  const order = async () => {
    const before = await done()
    const disabled = await page.locator('.proposal .commit').first().isDisabled()
    if (disabled) {
      console.log(name, 'cannot order:', await page.locator('.proposal .reason').allTextContents())
      return false
    }
    await press('.proposal .commit')
    await page.waitForFunction((n) => window.peakooru.play.game.done.length > n, before, { timeout: 30000 })
    await page.waitForFunction(() => window.peakooru.build.tool === null, null, { timeout: 30000 })
    return true
  }
  const toolOpen = async (tool) => {
    await tab('build')
    if (await page.locator('.back').count()) await press('.back')
    if (!(await page.locator(`.tool[data-tool="${tool}"]`).count())) await press('.tool-group[data-group="upkeep"]')
    for (let i = 0; i < 5; i++) {
      await press(`.tool[data-tool="${tool}"]`).catch(() => {})
      if (await page.evaluate((t) => window.peakooru.build.tool === t, tool)) return
      await page.waitForTimeout(500)
    }
    throw new Error(`The ${tool} tool could not be chosen.`)
  }

  try {
    await page.goto(BASE)
    await page.waitForFunction(loaded, null, { timeout: 120000 })
    await idle()
    // The road condition view, whole city and street level; how long a recolouring takes.
    await page.evaluate(() => window.peakooru.panel.close())
    await page.evaluate(() => window.peakooru.controls.setView('roads'))
    await page.waitForFunction(() => window.peakooru.play.surface, null, { timeout: 60000 })
    figures.recolourMs = await page.evaluate(() => {
      const p = window.peakooru
      const s = p.play.surface.stretch
      const flipped = s.map((v) => (v & 3) === 3 ? 0 : v + 1)
      const t0 = performance.now()
      p.condition.paint(flipped)
      const t1 = performance.now()
      p.condition.paint(s)
      return [Math.round((t1 - t0) * 10) / 10, Math.round((performance.now() - t1) * 10) / 10]
    })
    figures.memoryStartMb = await page.evaluate(() => performance.memory && Math.round(performance.memory.usedJSHeapSize / 1e6))
    if (screen.hasTouch) await tab('score')
    await snap('condition-city')
    if (screen.hasTouch) await page.evaluate(() => window.peakooru.panel.close())
    await view(77.615, 12.93, 14.3)
    await snap('condition-street')

    // The player taps the road they ride, in the road condition view: what it costs, and Mend it.
    let t0 = Date.now()
    const ridden = await findStretch(page, 'Hosur Road', [77.62, 12.925])
    await tapAt(ridden.at[0], ridden.at[1])
    await page.waitForSelector('.zone:not([hidden]) h2', { timeout: 15000 })
    figures.roadCard = await page.locator('.zone').innerText()
    await snap('road-card')
    if (await page.locator('.road-mend').count()) {
      await press('.road-mend')
      await page.waitForFunction(() => window.peakooru.build.tool === 'patch' && window.peakooru.build.mendLinks.length, null, { timeout: 10000 })
      await forecast()
      figures.seconds.cardToProposal = Math.round((Date.now() - t0) / 1000)
      await keep('from-card')
      await snap('road-card-mend')
      await press('.back')
    }

    // The same by the tool: Hosur Road near Madiwala. Patch one stretch, then take the whole road.
    t0 = Date.now()
    await toolOpen('patch')
    await view(77.62, 12.925, 14.5)
    const hosur = await findStretch(page, 'Hosur Road', [77.62, 12.925])
    await tapAt(hosur.at[0], hosur.at[1])
    await page.waitForFunction(() => window.peakooru.build.mendLinks.length > 0, null, { timeout: 10000 })
    figures.tapped = await page.evaluate(() => window.peakooru.build.mendLinks)
    await forecast()
    await keep('patch-one')
    await snap('patch-one-stretch')
    if (await page.locator('.offer').count()) {
      await press('.offer')
      await page.waitForTimeout(800)
      await forecast()
      await keep('patch-whole-road')
      figures.seconds.patchRoad = Math.round((Date.now() - t0) / 1000)
      await snap('patch-whole-road')
    } else console.log(name, 'no whole road was offered')
    if (screen.hasTouch) {
      await press('.proposal .quiet:text("Details")')
      await page.locator('.panel-body').evaluate((b) => (b.scrollTop = b.scrollHeight))
      await snap('patch-details')
    }
    await order()
    await snap('patch-ordered')

    // Resurface a named road: Old Airport Road.
    t0 = Date.now()
    await toolOpen('resurface')
    await view(77.66, 12.96, 14.2)
    // A named road that is poor where the look goes: the first of these that has a poor stretch there.
    let airport = null
    for (const [road, at] of [['Old Airport Road', [77.66, 12.96]], ['Sarjapura Road', [77.66, 12.915]], ['Bannerghatta Road', [77.6, 12.9]]]) {
      airport = await findStretch(page, road, at).catch(() => null)
      if (airport) {
        await view(airport.at[0], airport.at[1], 14.2)
        break
      }
    }
    if (airport) {
      await tapAt(airport.at[0], airport.at[1])
      await page.waitForFunction(() => window.peakooru.build.mendLinks.length > 0, null, { timeout: 10000 })
      if (await page.locator('.offer').count()) await press('.offer')
      await forecast()
      await keep('resurface')
      figures.seconds.resurface = Math.round((Date.now() - t0) / 1000)
      await snap('resurface-proposal')
      await order()
    }

    // Concrete on the Outer Ring Road near Marathahalli.
    await toolOpen('concrete')
    await view(77.70, 12.95, 14)
    const orr = await findStretch(page, 'Outer Ring Road', [77.70, 12.95]).catch(() => null)
    if (orr) {
      await tapAt(orr.at[0], orr.at[1])
      await page.waitForFunction(() => window.peakooru.build.mendLinks.length > 0, null, { timeout: 10000 })
      await forecast()
      await keep('concrete')
      await snap('concrete-proposal')
      await order()
    }

    // A zone's streets.
    await toolOpen('streets')
    await view(77.585, 12.93, 13)
    await tapAt(77.583, 12.929)
    await page.waitForFunction(() => window.peakooru.build.zone !== null, null, { timeout: 10000 })
    await forecast()
    await keep('streets')
    await snap('streets-proposal')
    await order()

    // The budget and the standing order, in the Levers page.
    await tab('money')
    await page.waitForSelector('.levels button[data-level="generous"] span:not(:text("…"))', { timeout: 60000 }).catch(() => null)
    await press('.levels button[data-level="generous"]')
    await page.waitForSelector('.roads-lever .outlook .commit', { timeout: 60000 })
    await snap('upkeep-generous')
    await press('.roads-lever .outlook .commit')
    await page.waitForFunction(() => window.peakooru.play.game.upkeep === 'generous', null, { timeout: 30000 })
    await press('.orders .quiet')
    await page.waitForSelector('.orders .outlook .commit', { timeout: 60000 })
    await press('.orders .outlook .commit')
    await page.waitForTimeout(800)
    await page.locator('.panel-body').evaluate((b) => (b.scrollTop = b.scrollHeight))
    await snap('levers-roads')

    // End the month and read what the mending did.
    t0 = Date.now()
    await page.evaluate(() => window.peakooru.next())
    await idle()
    figures.seconds.endMonth = Math.round((Date.now() - t0) / 1000)
    await tab('report')
    await page.locator('.panel-body').evaluate((b) => (b.scrollTop = b.scrollHeight))
    await snap('report-mended')
    figures.mended = await page.evaluate(() => window.peakooru.play.roads.mended)
    figures.worst = await page.evaluate(() => window.peakooru.play.roads.worst.map((w) => ({ name: w.name, km: Math.round(w.km * 10) / 10, hours: Math.round(w.hours) })))
    // Is the traffic on the road mended better? The traffic view there.
    await page.evaluate(() => window.peakooru.panel.close())
    await page.evaluate(() => window.peakooru.controls.setPeriod('evening'))
    await view(77.62, 12.925, 14)
    await snap('traffic-after-patch')

    // Skip into the monsoon: July.
    for (let i = 0; i < 8; i++) {
      const month = await page.evaluate(() => window.peakooru.play.game.month)
      if (month >= 6) break
      await page.evaluate(() => window.peakooru.skip(Math.min(6, 6 - window.peakooru.play.game.month)))
      await idle()
      while (await page.locator('.review .commit').count()) await press('.review .commit')
    }
    await page.evaluate(() => window.peakooru.panel.close())
    await page.evaluate(() => window.peakooru.controls.setPeriod('evening'))
    figures.flooded = await page.evaluate(() => window.peakooru.play.month.view.flooded?.length ?? 0)
    const flood = await page.evaluate(() => window.peakooru.play.month.view.flooded?.[0]?.ends)
    await view(77.6, 12.97, 11.3)
    await snap('monsoon-city')
    if (flood) {
      await view((flood[0] + flood[2]) / 2, (flood[1] + flood[3]) / 2, 14.5)
      await snap('monsoon-flooded-road')
    }
    await tab('report')
    await snap('monsoon-report')

    // The worst roads in the report: go to one and mend it.
    await page.locator('.panel-body').evaluate((b) => (b.scrollTop = b.scrollHeight))
    await snap('report-worst')
    if (await page.locator('.worst-road .mend').count()) {
      t0 = Date.now()
      await press('.worst-road .mend')
      await page.waitForFunction(() => window.peakooru.build.tool === 'patch' && window.peakooru.build.mendLinks.length, null, { timeout: 10000 })
      await forecast()
      figures.seconds.worstToProposal = Math.round((Date.now() - t0) / 1000)
      await keep('worst')
      await page.waitForTimeout(800)
      await snap('worst-mend')
    }
    // Memory after panning across the city.
    for (const [lng, lat] of [[77.5, 12.9], [77.7, 13.05], [77.6, 12.97], [77.75, 12.9]]) {
      await page.evaluate(([lng, lat]) => window.peakooru.map.jumpTo({ center: [lng, lat], zoom: 14 }), [lng, lat])
      await page.waitForTimeout(700)
    }
    figures.memoryEndMb = await page.evaluate(() => performance.memory && Math.round(performance.memory.usedJSHeapSize / 1e6))
  } catch (error) {
    console.log(name, 'failed:', String(error))
    await snap('failed')
  }
  figures.tapToStopMs = await page.evaluate(() => window.peakooru?.build.times.tapToStop.map(Math.round))
  figures.restToForecastMs = await page.evaluate(() => window.peakooru?.build.times.restToForecast.map(Math.round))
  report[name] = { ...figures, errors }
  await context.close()
}
await browser.close()
console.log(JSON.stringify(report, null, 2))
