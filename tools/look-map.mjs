// Opens the map on a laptop-sized and a phone-sized screen, at the places a Bangalorean would check, in each view,
// and saves screenshots to tools/shots/. Reports failed requests and errors in the page.
// Usage: node tools/look-map.mjs [name ...]   (every shot if none is named, else those whose names contain one)
// PEAKOORU_URL sets the address; add ?standin to it to draw the stand-in traffic instead of the model's.
import { chromium } from 'playwright-core'

const BASE = process.env.PEAKOORU_URL ?? 'http://localhost:5190/'
const only = process.argv.slice(2)
const screens = [
  { name: 'laptop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
]
const views = [
  { name: '1-city' },
  { name: '2-inner', centre: [77.5946, 12.9716], zoom: 12.5 },
  { name: '3-silk-board', centre: [77.6238, 12.9177], zoom: 15 },
  { name: '4-majestic', centre: [77.5724, 12.9775], zoom: 15 },
  { name: '5-whitefield', centre: [77.7400, 12.9780], zoom: 13.5 },
  { name: '6-hebbal', centre: [77.5920, 13.0400], zoom: 14 },
  { name: '7-electronic-city', centre: [77.6680, 12.8460], zoom: 13.5 },
  { name: '8-people', view: 'people' },
  { name: '9-jobs', view: 'jobs' },
  { name: '10-network', network: true },
  { name: '11-network-close', network: true, centre: [77.6238, 12.9177], zoom: 14 },
  { name: '12-zone-tapped', view: 'people', centre: [77.6241, 12.9357], zoom: 13, tap: true },
  { name: '13-commute', view: 'commute' },
  { name: '14-access', view: 'access' },
  // Traffic where Bengaluru knows it, at the peaks and at night.
  ...[
    ['city'],
    ['silk-board', [77.6238, 12.9177], 14],
    ['orr-marathahalli', [77.699, 12.9545], 14],
    ['hebbal', [77.592, 13.04], 14],
    ['kr-puram', [77.684, 13.0015], 13.5],
  ].flatMap(([place, centre, zoom], i) =>
    ['morning', 'evening', 'night'].map((period) => ({ name: `${15 + i}-traffic-${place}-${period}`, period, centre, zoom })),
  ),
  // The day played back, caught in the evening peak.
  { name: '20-playback-city', play: 9.4 },
  { name: '21-playback-silk-board', play: 9.4, centre: [77.6238, 12.9177], zoom: 14 },
]

const settled = () =>
  window.peakooru?.ready && window.peakooru.map.loaded() && window.peakooru.map.areTilesLoaded() && !window.peakooru.playback?.playing
const browser = await chromium.launch({ channel: 'chrome', headless: true })
for (const screen of screens) {
  const { name, ...options } = screen
  const page = await (await browser.newContext(options)).newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
  page.on('response', (response) => response.status() >= 400 && errors.push(`${response.status()} ${response.url()}`))
  const started = Date.now()
  await page.goto(BASE)
  await page.waitForFunction(settled, null, { timeout: 60000 })
  console.log(name, 'map ready in', Date.now() - started, 'ms')
  // The road network loads after the first sight of the map.
  await page
    .waitForFunction(() => window.peakooru.roads, null, { timeout: 60000 })
    .catch(() => console.log(name, 'no road network'))
  await page
    .waitForFunction(() => window.peakooru.month, null, { timeout: 60000 })
    .catch(() => console.log(name, 'no month worked out'))
  const home = await page.evaluate(() => {
    const { map } = window.peakooru
    return { centre: map.getCenter().toArray(), zoom: map.getZoom() }
  })
  for (const view of views) {
    if (only.length && !only.some((o) => view.name.includes(o))) continue
    await page.evaluate(
      ({ v, home }) => {
        const { map, controls, panel } = window.peakooru
        // The game's pages are put away, so that the map is seen as a whole.
        panel?.close()
        controls.setView(v.view ?? 'plain')
        controls.setPeriod(v.period ?? null)
        const toggle = controls.root.querySelector('.network-toggle')
        if (!toggle.disabled && (toggle.getAttribute('aria-pressed') === 'true') !== !!v.network) toggle.click()
        document.querySelector('.zone .close')?.click()
        map.jumpTo({ center: v.centre ?? home.centre, zoom: v.zoom ?? home.zoom })
      },
      { v: view, home },
    )
    await page.waitForTimeout(300)
    await page.waitForFunction(settled, null, { timeout: 60000 })
    if (view.tap) {
      const size = page.viewportSize()
      if (name === 'phone') await page.touchscreen.tap(size.width / 2, size.height / 2)
      else await page.mouse.click(size.width / 2, size.height / 2)
    }
    if (view.play) {
      await page.evaluate(() => {
        window.peakooru.controls.setPeriod('morning')
        window.peakooru.controls.root.querySelector('.play').click()
      })
      await page.waitForTimeout(view.play * 1000)
    } else await page.waitForTimeout(700)
    await page.screenshot({ path: `tools/shots/map-${name}-${view.name}.png` })
  }
  console.log(name, 'zoom', home.zoom.toFixed(2), 'errors:', errors)
  await page.close()
}
await browser.close()
