// Uses each lever of roads and streets once, as a player would, at laptop and at phone size: a flyover, a junction,
// footpaths, a speed limit, a one-way street, taller building and a road on the ground; then months pass until the
// flyover opens, and the map, the traffic on it, the report, the road deaths view and the City page are looked at.
// Saves screenshots to tools/shots/roads-*.png and prints timings, forecasts and any errors in the page.
// Usage: node tools/look-roads.mjs [laptop|phone|widths] ; PEAKOORU_URL sets the address (default the dev server).
import { chromium } from 'playwright-core'

const BASE = process.env.PEAKOORU_URL ?? 'http://localhost:5190/'
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const screens = [
  { name: 'laptop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
]
const loaded = () => window.peakooru?.month && window.peakooru.play?.game && window.peakooru.map.loaded()

const browser = await chromium.launch({ channel: 'chrome', headless: true })

// `widths`: the Build page's roads at every width, with a junction chosen.
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
      p.controls.setView('deaths')
      p.controls.setPeriod('evening')
      p.map.jumpTo({ center: [77.6, 12.955], zoom: 13 })
      p.build.choose('junction')
    })
    await page.waitForFunction(() => window.peakooru.build.junctionList, null, { timeout: 60000 })
    await page.evaluate(() => {
      const b = window.peakooru.build
      const c = window.peakooru.map.getCenter()
      const near = b.junctionList.filter((j) => j.jam >= 2)
        .sort((a, z) => Math.hypot(a.at[0] - c.lng, a.at[1] - c.lat) - Math.hypot(z.at[0] - c.lng, z.at[1] - c.lat))[0]
      b.chooseNode(near.id)
    })
    await page.waitForFunction(() => !document.querySelector('.choice .working'), null, { timeout: 60000 })
    await page.waitForTimeout(700)
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    console.log(width, 'horizontal scroll:', scroll)
    await page.screenshot({ path: `tools/shots/roads-width-${width}.png` })
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
  const figures = { forecasts: {}, minuteToOrder: {} }
  let shot = 0
  const snap = async (what) => {
    await page.waitForTimeout(300)
    await page.evaluate(() => new Promise((r) => (window.peakooru.map.loaded() ? r() : window.peakooru.map.once('idle', r))))
    await page.waitForTimeout(400)
    const path = `tools/shots/roads-${name}-${String(++shot).padStart(2, '0')}-${what}.png`
    await page.screenshot({ path })
    console.log(name, 'saved', path)
  }
  const press = async (selector) => {
    const target = page.locator(selector).first()
    await target.waitFor({ state: 'visible', timeout: 30000 })
    await target.scrollIntoViewIfNeeded()
    if (screen.hasTouch) await target.tap()
    else await target.click()
  }
  const idle = () => page.waitForFunction(() => window.peakooru?.play && !window.peakooru.play.busy, null, { timeout: 300000 })
  const tab = async (which) => {
    const open = await page.evaluate(() => window.peakooru.panel.tab)
    if (open !== which) await press(`.tabs button[data-tab="${which}"]`)
  }
  const done = () => page.evaluate(() => window.peakooru.play.game.done.length)
  /** Taps the map at a place, moving the map first if the place is under the sheet or off the screen. */
  const tapAt = async (lng, lat, confirm = true) => {
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
    if (screen.hasTouch && confirm) {
      const shown = await page.waitForSelector('.magnifier:not([hidden])', { timeout: 1500 }).catch(() => null)
      if (shown) {
        await page.waitForTimeout(450)
        await press('.magnifier-bar .commit')
        await page.waitForTimeout(450)
      }
    }
  }
  // Centres a place in what shows of the map: on a phone, above the sheet; on a laptop, right of the panel.
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
      cost: q?.cost, months: q?.months, major: q?.major,
      commute: f.before && [round(f.before.commute / 60), round(f.after.commute / 60)],
      served: f.served && [round(f.served.before / 60), round(f.served.after / 60), f.served.zones],
      deaths: f.before && [f.before.deaths, f.after.deaths], servedDeaths: f.servedDeaths, through: f.through?.map(round),
      unforeseen: f.unforeseen,
    }
  }).then((f) => (figures.forecasts[what] = f))
  /** Orders what the proposal shows, and waits for it to be done. */
  const order = async () => {
    const before = await done()
    const text = await page.locator('.proposal .commit').first().textContent()
    const disabled = await page.locator('.proposal .commit').first().isDisabled()
    if (disabled) {
      console.log(name, 'cannot order:', text, await page.locator('.proposal .reason').allTextContents())
      return false
    }
    await press('.proposal .commit')
    await page.waitForFunction((n) => window.peakooru.play.game.done.length > n, before, { timeout: 30000 })
    // The page leaves the tool once the month has been worked out again with the order in it.
    await page.waitForFunction(() => window.peakooru.build.tool === null, null, { timeout: 30000 })
    return true
  }
  const toolOpen = async (tool) => {
    await tab('build')
    if (await page.locator('.back').count()) await press('.back')
    if (!(await page.locator(`.tool[data-tool="${tool}"]`).count())) await press('.tool-group[data-group="roads"]')
    // The page is drawn again as the game changes, which can take a tap away from a button; so until chosen.
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
    await page.evaluate(() => window.peakooru.controls.setPeriod('evening'))
    await tab('build')
    await snap('build-page')
    await press('.tool-group[data-group="roads"]')
    await snap('roads-group')

    // A flyover along the Outer Ring Road from Silk Board towards Agara: the worst junction in the city.
    let t0 = Date.now()
    await toolOpen('flyover')
    await view(77.632, 12.921, 14.3)
    for (const [lng, lat] of [[77.6229, 12.9172], [77.6386, 12.9112]]) {
      await tapAt(lng, lat)
      await page.waitForTimeout(700)
    }
    await forecast()
    figures.minuteToOrder.flyover = Date.now() - t0
    await keep('flyover')
    await snap('flyover-proposal')
    if (screen.hasTouch) {
      await press('.proposal .quiet:text("Details")')
      await page.locator('.panel-body').evaluate((b) => (b.scrollTop = b.scrollHeight))
      await snap('flyover-details')
    }
    await order()
    await snap('flyover-ordered')

    // A junction: the marks, the three choices, a redesign.
    t0 = Date.now()
    await toolOpen('junction')
    await view(77.585, 12.955, 13.2)
    await page.waitForFunction(() => window.peakooru.build.junctionList, null, { timeout: 60000 })
    await snap('junction-marks')
    const node = await page.evaluate(() => {
      const { build, map } = window.peakooru
      const c = map.getCenter()
      // Only junctions ringed at this zoom can be tapped: the jammed ones, with much of the city in view.
      return build.junctionList.filter((j) => j.jam >= 3 && !j.work)
        .sort((a, z) => Math.hypot(a.at[0] - c.lng, a.at[1] - c.lat) - Math.hypot(z.at[0] - c.lng, z.at[1] - c.lat))[0]
    })
    await tapAt(node.at[0], node.at[1], false)
    await page.waitForFunction(() => window.peakooru.build.node !== null, null, { timeout: 10000 })
    await page.waitForFunction(() => !document.querySelector('.choice .working'), null, { timeout: 120000 })
    await snap('junction-choices')
    if (await page.locator('.choice:has-text("Junction redesign"):not([disabled])').count()) {
      await press('.choice:has-text("Junction redesign")')
    }
    await forecast()
    figures.minuteToOrder.junction = Date.now() - t0
    await keep('junction')
    await snap('junction-proposal')
    await order()

    // Footpaths: the zones shaded by deaths, one tapped.
    t0 = Date.now()
    await toolOpen('footpaths')
    await view(77.6, 12.97, 11.6)
    await snap('footpaths-shading')
    const zone = await page.evaluate(() => {
      const { month, zones } = window.peakooru
      const deaths = month.result.deathsByZone
      const z = deaths ? zones.zones.filter((x) => x.ward).sort((a, b) => deaths[b.id] - deaths[a.id])[0] : zones.zones.find((x) => x.name === 'Shivajinagar') ?? zones.zones[100]
      return { id: z.id, centre: z.centre, name: z.name }
    })
    await tapAt(zone.centre[0], zone.centre[1], false)
    await forecast()
    figures.minuteToOrder.footpaths = Date.now() - t0
    await keep('footpaths')
    await snap('footpaths-proposal')
    await order()

    // A speed limit in a zone on a fast road: Hebbal.
    t0 = Date.now()
    await toolOpen('speedLimit')
    await view(77.593, 13.03, 12.6)
    await tapAt(77.5935, 13.0355, false)
    await page.waitForSelector('.choices .choice, .choices p:not(.working)', { timeout: 30000 })
    await snap('limit-choices')
    if (await page.locator('.choices .choice').count()) {
      await press('.choices .choice')
      await forecast()
      figures.minuteToOrder.speedLimit = Date.now() - t0
      await keep('speedLimit')
      await snap('limit-proposal')
      await order()
    }

    // A one-way street near Jayanagar 4th Block.
    t0 = Date.now()
    await toolOpen('oneWay')
    await view(77.583, 12.93, 14.6)
    await page.waitForFunction(() => window.peakooru?.build?.tool === 'oneWay' && window.peakooru.build.twoWay, null, { timeout: 60000 })
    await snap('oneway-candidates')
    // Read in one step with the wait, so that a page loaded again in between (the dev server reloads it when a file is
    // saved) is waited for rather than read half-ready.
    const link = await page.waitForFunction(() => {
      const { build, map } = window.peakooru ?? {}
      if (build?.tool !== 'oneWay' || !build.twoWay) return null
      const c = map.getCenter()
      const mid = (l) => [(l.ends[0] + l.ends[2]) / 2, (l.ends[1] + l.ends[3]) / 2]
      const l = build.twoWay.filter((x) => x.ends && x.drawn.length)
        .sort((a, z) => Math.hypot(mid(a)[0] - c.lng, mid(a)[1] - c.lat) - Math.hypot(mid(z)[0] - c.lng, mid(z)[1] - c.lat))[0]
      return mid(l)
    }, null, { timeout: 60000 }).then((h) => h.jsonValue())
    await tapAt(link[0], link[1], false)
    await page.waitForSelector('.choices .choice', { timeout: 10000 }).catch(() => null)
    await forecast().catch(() => null)
    figures.minuteToOrder.oneWay = Date.now() - t0
    await keep('oneWay')
    await snap('oneway-proposal')
    await order()
    await page.waitForTimeout(800)
    await snap('oneway-done')

    // Taller building near Indiranagar metro station.
    await toolOpen('density')
    await view(77.64, 12.975, 12.4)
    await snap('density-shading')
    await tapAt(77.6408, 12.9784, false)
    await forecast().catch(() => null)
    await keep('density')
    await snap('density-proposal')
    await order()

    // A road on the ground: next month, since three major works may be started a month.
    await idle()
    await page.evaluate(() => window.peakooru.next())
    await idle()
    t0 = Date.now()
    await toolOpen('road')
    await view(77.69, 12.955, 13.4)
    for (const [lng, lat] of [[77.6795, 12.9564], [77.7005, 12.9598]]) {
      await tapAt(lng, lat)
      await page.waitForTimeout(700)
    }
    await forecast()
    figures.minuteToOrder.road = Date.now() - t0
    await keep('road')
    await snap('road-proposal')
    await order()
    await tab('build')
    if (await page.locator('.back').count()) await press('.back')
    await snap('works-list')

    // Months pass until the flyover opens.
    for (let i = 0; i < 10; i++) {
      const open = await page.evaluate(() => (window.peakooru.play.game.built?.roads?.length ?? 0) >= 2)
      if (open) break
      await page.evaluate(() => window.peakooru.skip(6))
      await idle()
      // The yearly review, if the months took in a December.
      while (await page.locator('.review .commit').count()) {
        if (!figures.review) {
          figures.review = true
          await snap('yearly-review')
        }
        await press('.review .commit')
      }
    }
    await page.evaluate(() => window.peakooru.panel.close())
    await page.evaluate(() => window.peakooru.controls.setPeriod('evening'))
    await view(77.631, 12.919, 14.4)
    await snap('flyover-open-traffic')
    await page.evaluate(() => window.peakooru.controls.setPeriod(null))
    await snap('flyover-open-plain')
    await view(77.631, 12.919, 16.2)
    await snap('flyover-close')
    await view(77.69, 12.958, 14.4)
    await snap('road-open')
    await page.evaluate(() => window.peakooru.controls.setPeriod('evening'))
    await snap('road-open-traffic')
    await tab('report')
    await snap('report')
    await page.evaluate(() => window.peakooru.panel.close())
    await page.evaluate(() => window.peakooru.controls.setView('deaths'))
    await view(77.6, 12.97, 11.3)
    await snap('deaths-view')
    await tab('score')
    await snap('city-page')
    figures.built = await page.evaluate(() => window.peakooru.play.game.built)
    figures.month = await page.evaluate(() => window.peakooru.play.game.month)
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
console.log(JSON.stringify(report, (k, v) => (k === 'built' && v ? { ...v, lines: v.lines?.length, stations: v.stations?.length } : v), 2))
