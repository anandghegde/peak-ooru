// Measures the map against PRD section 14 on a production build: first sight of the map on Chrome's "Fast 4G",
// frames a second while panning and zooming by script, memory, the size of the first download, the response to a
// tap, the cost of recolouring every stretch of the road network at once, the time from asking for a month to the
// map showing it, and frames a second while the day plays back. At laptop size, and at phone size with the processor
// slowed four times.
//
// Memory is each process's footprint as macOS counts it (what Activity Monitor shows), which unlike the resident size
// includes the graphics memory the GPU process holds for the page. It is taken at its highest while panning, after
// the panning, and again after Chrome is told memory is short, which makes it hand back what its allocators hold
// but no longer use: the last is what the page needs, the others what it holds when nothing asks it to give back.
// Usage: node tools/look-perf.mjs [--gpu] [--intro] [laptop|phone]
//   --intro: as a first visit, with the introduction (which turns traffic on).
//   PEAKOORU_QUERY is added to the address, as `&standin` to measure with the stand-in model.
//   --gpu: a visible window, drawn by the graphics card for certain. A screen named: that one only, in a browser of
//   its own, which makes the memory figures cleaner.
import { execSync, spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { chromium } from 'playwright-core'

const PORT = 5233
const gpu = process.argv.includes('--gpu')
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'))
// Chrome DevTools' "Fast 4G".
const FAST_4G = {
  offline: false,
  latency: 165,
  downloadThroughput: (9e6 / 8) * 0.9,
  uploadThroughput: (1.5e6 / 8) * 0.9,
}
const screens = [
  { name: 'laptop', cpu: 1, context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
  {
    name: 'phone',
    cpu: 4,
    context: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  },
]

const out = mkdtempSync(join(tmpdir(), 'peakooru-perf-'))
execSync(`npx vite build --outDir ${out} --emptyOutDir`, { stdio: 'ignore' })
// A server left running on the port would serve an old build and every figure would be of that build.
if (await fetch(`http://localhost:${PORT}/`).then(() => true, () => false)) {
  console.error(`Port ${PORT} is taken, perhaps by a preview server left over from an earlier run. Stop it first.`)
  process.exit(1)
}
// Vite itself, not through npx: killing npx leaves its child serving.
const server = spawn('node_modules/.bin/vite', ['preview', '--outDir', out, '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
})
server.on('exit', (code) => {
  if (!code) return
  console.error(`The preview server stopped (${code}); is port ${PORT} taken?`)
  process.exit(1)
})
process.on('exit', () => server.kill())
for (let i = 0; i < 50; i++) {
  if (await fetch(`http://localhost:${PORT}/`).then((r) => r.ok, () => false)) break
  await new Promise((r) => setTimeout(r, 200))
}

const settled = () => window.peakooru?.ready && window.peakooru.map.loaded() && window.peakooru.map.areTilesLoaded()

/** A process's footprint in MB, as macOS counts it. */
function footprint(pid) {
  if (!pid) return 0
  try {
    const out = execSync(`footprint -p ${pid} --noCategories 2>/dev/null`).toString()
    const [, value, unit] = /Footprint: ([\d.]+) (KB|MB|GB)/.exec(out)
    return Math.round(Number(value) * { KB: 1 / 1024, MB: 1, GB: 1024 }[unit])
  } catch {
    return 0
  }
}

/** Frames drawn while `motion` runs in the page, as frames a second and the slowest frame times. */
async function frames(page, motion) {
  return page.evaluate(async (motion) => {
    const { map } = window.peakooru
    const times = []
    let running = true
    const tick = (t) => {
      times.push(t)
      if (running) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    await new Function('map', `return (async () => { ${motion} })()`)(map)
    running = false
    const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b)
    const seconds = (times.at(-1) - times[0]) / 1000
    return {
      fps: +(gaps.length / seconds).toFixed(1),
      medianMs: +gaps[Math.floor(gaps.length / 2)].toFixed(1),
      p95Ms: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1),
      over50ms: gaps.filter((g) => g > 50).length,
      frames: gaps.length,
    }
  }, motion)
}

// Panning across the city and zooming in and out: about 12 seconds of motion.
const MOTION = `
  const ease = (o) => new Promise((done) => { map.once('moveend', done); map.easeTo({ ...o, essential: true }) })
  await ease({ center: [77.62, 12.93], zoom: 13, duration: 2000 })
  await ease({ center: [77.70, 12.97], duration: 1500 })
  await ease({ center: [77.57, 12.98], zoom: 15, duration: 2500 })
  await ease({ center: [77.60, 13.03], duration: 1500 })
  await ease({ center: [77.60, 12.97], zoom: 11, duration: 2500 })
  await ease({ center: [77.55, 12.95], zoom: 12, duration: 2000 })
`

const browser = await chromium.launch({
  channel: 'chrome',
  headless: !gpu,
  args: gpu ? ['--use-angle=metal', '--enable-gpu'] : [],
})
const report = {}
for (const screen of screens) {
  if (only.length && !only.includes(screen.name)) continue
  const context = await browser.newContext(screen.context)
  // The introduction turns traffic on for its first step; measured as a returning player, as before it existed.
  if (!process.argv.includes('--intro')) await context.addInitScript(() => localStorage.setItem('peakooru.intro', 'seen'))
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await cdp.send('Network.emulateNetworkConditions', FAST_4G)
  if (screen.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: screen.cpu })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  const responses = new Map()
  let bytes = 0
  const byKind = {}
  cdp.on('Network.responseReceived', (e) => responses.set(e.requestId, e.response))
  cdp.on('Network.loadingFinished', async (e) => {
    const response = responses.get(e.requestId)
    if (!response) return
    const url = new URL(response.url)
    const { pathname } = url
    const kind = pathname.endsWith('.pmtiles') ? 'tiles' : pathname.endsWith('.pbf') ? 'fonts' : pathname.split('.').pop()
    let size = e.encodedDataLength
    // The preview server does not compress; a real host would, so text is counted as gzip would send it.
    if (/javascript|css|html|json/.test(response.mimeType)) {
      try {
        const { body, base64Encoded } = await cdp.send('Network.getResponseBody', { requestId: e.requestId })
        size = gzipSync(Buffer.from(body, base64Encoded ? 'base64' : 'utf8')).length
      } catch {}
    }
    bytes += size
    byKind[kind] = (byKind[kind] ?? 0) + size
  })

  const started = Date.now()
  await page.goto(`http://localhost:${PORT}/?measure${process.env.PEAKOORU_QUERY ?? ''}`)
  await page.waitForFunction(settled, null, { timeout: 120000, polling: 50 })
  const firstSight = Date.now() - started
  await page.waitForTimeout(500)
  const firstBytes = bytes
  const firstByKind = { ...byKind }
  const renderer = await page.evaluate(() => {
    const gl = window.peakooru.map.painter.context.gl
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown'
  })

  // The page's process is the largest renderer; the others are spares Chrome keeps ready.
  const browserCdp = await browser.newBrowserCDPSession()
  const processes = (await browserCdp.send('SystemInfo.getProcessInfo')).processInfo
  const rss = (pid) => Math.round(Number(execSync(`ps -o rss= -p ${pid} || echo 0`)) / 1024)
  const pagePid = processes.filter((p) => p.type === 'renderer').sort((a, b) => rss(b.id) - rss(a.id))[0]?.id
  const gpuPid = processes.find((p) => p.type === 'GPU')?.id
  const atFirstSight = { pageMB: footprint(pagePid), graphicsMB: footprint(gpuPid) }
  const peak = { pageMB: 0, graphicsMB: 0 }
  const sampler = setInterval(() => {
    peak.pageMB = Math.max(peak.pageMB, footprint(pagePid))
    peak.graphicsMB = Math.max(peak.graphicsMB, footprint(gpuPid))
  }, 1000)

  // Frames on the slowed network, as a first visit would have it, then again with the tiles at hand.
  const cold = await frames(page, MOTION)
  const warm = await frames(page, MOTION)

  // A tap on a zone, to the frame that shows its card.
  const size = page.viewportSize()
  await page.evaluate(() => window.peakooru.map.jumpTo({ center: [77.6241, 12.9357], zoom: 13 }))
  await page.waitForFunction(settled, null, { timeout: 60000 })
  await page.evaluate(() => {
    window.tapTimes = {}
    document.addEventListener('pointerdown', (e) => (window.tapTimes.down = e.timeStamp), { capture: true, once: true })
    new MutationObserver(() => {
      if (window.tapTimes.shown) return
      window.tapTimes.shown = performance.now()
      requestAnimationFrame(() => requestAnimationFrame(() => (window.tapTimes.drawn = performance.now())))
    }).observe(document.querySelector('.zone'), { attributes: true, childList: true })
  })
  if (screen.context.hasTouch) await page.touchscreen.tap(size.width / 2, size.height / 2)
  else await page.mouse.click(size.width / 2, size.height / 2)
  await page.waitForTimeout(1500)
  const tap = await page.evaluate(() => {
    const t = window.tapTimes
    return t.drawn ? +(t.drawn - t.down).toFixed(0) : null
  })

  // Every stretch of the road network recoloured at once, as traffic will each month.
  await page.waitForFunction(() => window.peakooru.roads, null, { timeout: 60000 }).catch(() => {})
  const recolour = await page.evaluate(async () => {
    const { roads, map } = window.peakooru
    if (!roads) return null
    roads.show(true)
    await new Promise((r) => map.once('idle', r))
    const colours = ['#f2a531', '#e4592b', '#a51d1d', null]
    const results = []
    for (let round = 0; round < 3; round++) {
      const all = new Map(roads.network.links.map((l, i) => [l.id, colours[(i + round) % colours.length]]))
      const t0 = performance.now()
      roads.paint(all)
      const t1 = performance.now()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      results.push({ setMs: +(t1 - t0).toFixed(1), toFrameMs: +(performance.now() - t0).toFixed(1) })
    }
    return { links: roads.network.links.length, rounds: results }
  })
  const withNetwork = recolour ? await frames(page, MOTION) : null
  clearInterval(sampler)

  // A month asked for and shown: in the worker, then zones, figures and congestion on the map.
  await page.waitForFunction(() => window.peakooru.month, null, { timeout: 120000 }).catch(() => {})
  const month = await page.evaluate(async () => {
    const { work, month, city } = window.peakooru
    if (!work || !month) return null
    const shown = []
    const took = []
    for (let i = 0; i < 3; i++) {
      shown.push(Math.round(await work()))
      took.push(Math.round(window.peakooru.month.result.took))
    }
    return { askedToShownMs: shown, modelMs: took, standIn: city.stand }
  })

  // Turns: "Next month" to its report shown, and a skip of up to twelve months (it stops at the year's end) to its
  // report shown, with each page of the game opened once, as a player would.
  const turns = await page.evaluate(async () => {
    const { next, skip, play, panel } = window.peakooru
    if (!next || !play.game) return null
    const t0 = performance.now()
    await next()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const nextMs = Math.round(performance.now() - t0)
    const from = play.game.month
    const t1 = performance.now()
    await skip(12)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const skipMs = Math.round(performance.now() - t1)
    for (const tab of ['money', 'score', 'report']) {
      panel.open(tab)
      await new Promise((r) => setTimeout(r, 1500))
    }
    return { nextMs, skipMs, skipMonths: play.game.month - from, perSkippedMonthMs: Math.round(skipMs / (play.game.month - from)) }
  })

  // The day played back with the whole city in view.
  const playback = await page.evaluate(async () => {
    const { map, playback, month, controls } = window.peakooru
    if (!playback || !month) return null
    map.jumpTo({ center: [77.6, 12.97], zoom: map.getZoom() < 11 ? map.getZoom() : 10.8 })
    await new Promise((r) => map.once('idle', r))
    controls.setPeriod('morning')
    controls.root.querySelector('.play').click()
    await new Promise((r) => setTimeout(r, 15500))
    const t = playback.frames
    const gaps = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b)
    return {
      dots: playback.dots,
      fps: +(gaps.length / ((t.at(-1) - t[0]) / 1000)).toFixed(1),
      medianMs: +gaps[Math.floor(gaps.length / 2)].toFixed(1),
      p95Ms: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1),
      over50ms: gaps.filter((g) => g > 50).length,
    }
  })

  // Kannada names while moving: how many are drawn, and how far each is from where its English name is drawn.
  const kannada = await page.evaluate(async () => {
    const { map, labels } = window.peakooru
    map.jumpTo({ center: [77.57, 12.98], zoom: 13.5 })
    await new Promise((r) => map.once('idle', r))
    let worst = 0
    const check = () => {
      for (const { el, props } of labels.shown.values()) {
        const p = map.project([props.lng, props.lat])
        const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform)
        const x = props.side === 'right' ? p.x + 0.8 * props.size : p.x
        worst = Math.max(worst, Math.abs(Number(m[1]) - x))
      }
    }
    map.on('render', check)
    await new Promise((r) => { map.once('moveend', r); map.panBy([300, 200], { duration: 1500 }) })
    map.off('render', check)
    return { count: labels.count, worstOffsetPx: +worst.toFixed(2) }
  })

  // Memory: the page's JavaScript after a collection, and the resident size of the page's and the graphics
  // processes as the system counts it (the graphics process's includes the map's textures and buffers).
  await cdp.send('HeapProfiler.collectGarbage')
  await cdp.send('Performance.enable')
  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
  const afterPanning = { pageMB: footprint(pagePid), graphicsMB: footprint(gpuPid) }
  await cdp.send('Memory.simulatePressureNotification', { level: 'critical' })
  await browserCdp.send('Memory.simulatePressureNotification', { level: 'critical' })
  await page.waitForTimeout(3000)
  const afterPressure = { pageMB: footprint(pagePid), graphicsMB: footprint(gpuPid) }
  // Last, since it loads a second copy of the model and its data into the page and would count in the memory above.
  // Chrome slows only the page's main thread, not its workers, so the month above takes as long at "phone" speed as
  // at laptop speed. The model is timed again here on the main thread, where the slowing applies: loaded from the
  // chunk the worker loads it from, with the same data.
  const workerFile = readdirSync(join(out, 'assets')).find((f) => /^worker-.*\.js$/.test(f))
  const chunk = workerFile && /import\("\.\/([^"]+)"\)/.exec(readFileSync(join(out, 'assets', workerFile), 'utf8'))?.[1]
  const modelOnMainThreadMs = chunk
    ? await page.evaluate(async (chunk) => {
        const { simulate } = await import(`/assets/${chunk}`)
        const json = (f) => fetch(`/data/${f}`).then((r) => r.json())
        const [zones, transit, roads] = await Promise.all([json('zones.json'), json('transit.json'), json('routing.json')])
        const times = []
        for (let i = 0; i < 3; i++) {
          const t0 = performance.now()
          simulate({ month: i, seed: 1, zones, transit, roads })
          times.push(Math.round(performance.now() - t0))
        }
        return times
      }, chunk)
    : null

  report[screen.name] = {
    renderer,
    firstSightMs: firstSight,
    firstDownloadKB: Math.round(firstBytes / 1024),
    firstDownloadByKindKB: Object.fromEntries(Object.entries(firstByKind).map(([k, v]) => [k, Math.round(v / 1024)])),
    framesColdTiles: cold,
    framesWarmTiles: warm,
    framesWithNetworkShown: withNetwork,
    memory: {
      atFirstSight,
      peakWhilePanning: peak,
      afterPanning,
      afterPressure,
      pageResidentMB: rss(pagePid),
      jsHeapMB: Math.round(metrics.JSHeapUsedSize / 2 ** 20),
    },
    month,
    turns,
    modelOnMainThreadMs,
    playback,
    tapToFrameMs: tap,
    recolour,
    kannada,
    errors,
  }
  await context.close()
}
await browser.close()
server.kill()
console.log(JSON.stringify(report, null, 2))
