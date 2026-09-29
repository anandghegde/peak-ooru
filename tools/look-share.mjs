// The share picture and the sounds, looked at and measured (slice 9, M). Builds its own copy of the game with
// tools/listen.html and tools/look-share.html, serves it on port 5240 with /api and /share passed to the server on
// 5210, and:
//   - renders every sound offline and prints its length, peak, loudness and edges; saves tools/shots/share-sounds.png
//   - for each finished game named (plan=id:token, from a scripted player on the server), draws the share picture at
//     both sizes and as a chat would show them small, saves the share card at laptop and phone size, and checks that
//     the picture reached the server and that the share page names it
//   - tries the buttons: saving and copying where there is no share sheet, and the share sheet with a stand-in for
//     the phone's, reading what it was given
// Usage: node tools/look-share.mjs good=<id>:<token> [middling=<id>:<token> ...]
import { createReadStream, mkdtempSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { build } from 'vite'
import { chromium } from 'playwright-core'

const PORT = 5240
const SERVER = { host: '127.0.0.1', port: 5210 }
const games = process.argv.slice(2).map((a) => {
  const [label, rest] = a.split('=')
  const [id, token] = rest.split(':')
  return { label, id, token }
})

const out = mkdtempSync(join(tmpdir(), 'peakooru-share-'))
await build({
  configFile: 'vite.config.ts',
  logLevel: 'warn',
  build: { outDir: out, emptyOutDir: true, rollupOptions: { input: { main: 'index.html', listen: 'tools/listen.html', look: 'tools/look-share.html' } } },
})

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json', '.png': 'image/png', '.pbf': 'application/x-protobuf' }
const site = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path.startsWith('/api/') || path.startsWith('/share/')) {
    const p = request({ ...SERVER, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers)
      r.pipe(res)
    })
    p.on('error', () => {
      res.writeHead(502)
      res.end()
    })
    req.pipe(p)
    return
  }
  let file = join(out, path)
  if (!file.startsWith(out) || !existsSync(file) || statSync(file).isDirectory()) file = join(out, 'index.html')
  const type = TYPES[extname(file)] ?? 'application/octet-stream'
  const size = statSync(file).size
  // The map's tiles are read by ranges.
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
  if (range) {
    const from = Number(range[1])
    const to = Math.min(size - 1, range[2] ? Number(range[2]) : size - 1)
    res.writeHead(206, { 'content-type': type, 'content-length': to - from + 1, 'content-range': `bytes ${from}-${to}/${size}`, 'accept-ranges': 'bytes' })
    createReadStream(file, { start: from, end: to }).pipe(res)
    return
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' })
  createReadStream(file).pipe(res)
})
await new Promise((r) => site.listen(PORT, '127.0.0.1', r))
const BASE = `http://localhost:${PORT}`

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
const watch = (page, name) => {
  page.on('pageerror', (e) => errors.push(`${name}: ${String(e)}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`))
}

// The sounds.
{
  const page = await browser.newPage({ viewport: { width: 800, height: 900 }, deviceScaleFactor: 2 })
  watch(page, 'listen')
  await page.goto(`${BASE}/tools/listen.html`)
  await page.waitForFunction(() => window.measured, null, { timeout: 60000 })
  const measured = await page.evaluate(() => window.measured)
  console.log('\nsound                               seconds  peak dBFS  RMS dBFS  first      last       most in 1st ms  in last ms  largest step')
  for (const m of measured) {
    console.log(`${m.words.padEnd(36)} ${String(m.seconds).padStart(6)}  ${String(m.peakDb).padStart(9)}  ${String(m.rmsDb).padStart(8)}  ` +
      `${String(m.first).padEnd(9)}  ${String(m.last).padEnd(9)}  ${String(m.headMax).padStart(14)}  ${String(m.tailMax).padStart(10)}  ${String(m.jump).padStart(12)}`)
  }
  await page.screenshot({ path: 'tools/shots/share-sounds.png', fullPage: true })
  console.log('saved tools/shots/share-sounds.png')
  await page.close()
}

/** Saves a canvas's own pixels, and a copy drawn small, as a chat would show it. */
async function canvasShots(page, selector, name, small) {
  const data = await page.evaluate(([sel, small]) => {
    const c = document.querySelector(sel)
    const t = document.createElement('canvas')
    t.width = small
    t.height = Math.round((c.height * small) / c.width)
    const x = t.getContext('2d')
    x.imageSmoothingQuality = 'high'
    x.drawImage(c, 0, 0, t.width, t.height)
    return [c.toDataURL('image/png'), t.toDataURL('image/png'), c.width, c.height]
  }, [selector, small])
  writeFileSync(`tools/shots/share-${name}.png`, Buffer.from(data[0].split(',')[1], 'base64'))
  writeFileSync(`tools/shots/share-${name}-small.png`, Buffer.from(data[1].split(',')[1], 'base64'))
  console.log(`saved tools/shots/share-${name}.png (${data[2]} × ${data[3]}) and -small (${small} wide)`)
}

for (const g of games.filter((g) => g.label !== 'ending')) {
  for (const screen of [
    { name: 'laptop', viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
    { name: 'phone', viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ]) {
    const { name, ...options } = screen
    const context = await browser.newContext({ ...options, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await context.newPage()
    watch(page, `${g.label} ${name}`)
    await page.goto(`${BASE}/tools/look-share.html?game=${g.id}&token=${g.token}`)
    await page.waitForFunction(() => window.done, null, { timeout: 60000 })
    const words = await page.evaluate(() => window.words)
    if (name === 'laptop') {
      console.log(`\n${g.label}: ${JSON.stringify(words)}`)
      await canvasShots(page, '#wide', `${g.label}-wide`, 400)
      await canvasShots(page, '#tall', `${g.label}-tall`, 240)
      await page.waitForFunction(() => window.uploaded, null, { timeout: 30000 }).catch(() => null)
      console.log('upload:', JSON.stringify(await page.evaluate(() => window.uploaded ?? 'not sent (sent before, from this device or another run)')))
      const share = await fetch(`${BASE}/share/${g.id}`)
      const html = await share.text()
      console.log('share page:', share.status, (html.match(/<title>(.*)<\/title>/) ?? [])[1], '|', (html.match(/og:description" content="([^"]*)"/) ?? [])[1])
      const png = await fetch(`${BASE}/share/${g.id}.png`)
      console.log('share picture:', png.status, png.headers.get('content-type'), png.headers.get('x-content-type-options'), (await png.arrayBuffer()).byteLength, 'bytes')
      // No share sheet in headless Chrome: saving and copying.
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save the picture' }).click()])
      const saved = join(out, download.suggestedFilename())
      await download.saveAs(saved)
      console.log('saved picture:', download.suggestedFilename(), statSync(saved).size, 'bytes')
      await page.getByRole('button', { name: 'Copy the link' }).click()
      console.log('copied:', await page.evaluate(() => navigator.clipboard.readText()))
    }
    await page.locator('#card').screenshot({ path: `tools/shots/share-${g.label}-card-${name}.png` })
    console.log(`saved tools/shots/share-${g.label}-card-${name}.png`)
    await context.close()
  }
}

// The share sheet, with a stand-in for the phone's: what it is given.
if (games[0]) {
  const g = games[0]
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await context.addInitScript(() => {
    window.sheet = null
    navigator.canShare = (d) => !!d?.files?.length
    navigator.share = async (d) => {
      window.sheet = { text: d.text, url: d.url ?? null, files: d.files.map((f) => ({ name: f.name, type: f.type, size: f.size })) }
    }
  })
  const page = await context.newPage()
  watch(page, 'sheet')
  await page.goto(`${BASE}/tools/look-share.html?game=${g.id}&token=${g.token}`)
  await page.waitForFunction(() => window.done, null, { timeout: 60000 })
  await page.getByRole('button', { name: 'Share' }).tap()
  await page.waitForFunction(() => window.sheet, null, { timeout: 10000 })
  console.log('\nshare sheet given:', JSON.stringify(await page.evaluate(() => window.sheet)))
  await page.locator('#card').screenshot({ path: `tools/shots/share-${g.label}-card-sheet.png` })
  await context.close()
}

// The ending in the game itself, for the player whose game it is: the share card in its place. A game named `ending`
// is used for this alone (one played by the rules as they are now, which the page can put back together).
const ending = games.find((g) => g.label === 'ending') ?? games[0]
if (ending) {
  const g = ending
  for (const screen of [
    { name: 'laptop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    { name: 'phone', viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ]) {
    const { name, ...options } = screen
    const context = await browser.newContext(options)
    await context.addInitScript(([game, token]) => {
      if (!localStorage.getItem('peakooru.net')) {
        localStorage.setItem('peakooru.net', JSON.stringify({ token, game, player: null, season: null, summaries: {}, hereToken: null }))
        // The introduction has been seen: the ending is what is looked at here.
        localStorage.setItem('peakooru.intro', 'seen')
      }
    }, [g.id, g.token])
    const page = await context.newPage()
    watch(page, `ending ${name}`)
    await page.goto(`${BASE}/?measure`)
    const shown = await page.waitForSelector('.final-share .share-picture', { timeout: 240000 }).then(() => true, () => false)
    if (!shown) console.log(`the ending did not show on the ${name}`)
    await page.waitForTimeout(1500)
    if (name === 'laptop' && shown) await canvasShots(page, '.final-share .share-picture', 'ending-picture', 400)
    await page.screenshot({ path: `tools/shots/share-ending-${name}.png` })
    await page.evaluate(() => document.querySelector('.final-share')?.scrollIntoView())
    await page.waitForTimeout(300)
    await page.screenshot({ path: `tools/shots/share-ending-${name}-share.png` })
    console.log(`saved tools/shots/share-ending-${name}.png and -share`)
    await context.close()
  }
}

// The link as a friend opens it, on a device that has never seen the game: the share page sends them to the city.
if (games[0]) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await context.addInitScript(() => localStorage.setItem('peakooru.intro', 'seen'))
  const page = await context.newPage()
  watch(page, 'link')
  // The share page sends a person to PUBLIC_URL, which here is the dev server: the page is read for where it sends
  // them, and that address is opened on this built copy instead.
  const html = await (await fetch(`${BASE}/share/${games[0].id}`)).text()
  const to = new URL((html.match(/url=([^"]+)"/) ?? [])[1].replaceAll('&amp;', '&'))
  console.log(`\nthe share page sends a person to ${to.href}`)
  await page.goto(`${BASE}/${to.search}`)
  const viewing = await page.waitForFunction(() => document.body.classList.contains('viewing'), null, { timeout: 240000 }).then(() => true, () => false)
  await page.waitForTimeout(2000)
  console.log(`\nthe shared link opened ${page.url()}, looking round another's city: ${viewing}`)
  await page.screenshot({ path: 'tools/shots/share-link-opened.png' })
  console.log('saved tools/shots/share-link-opened.png')
  await context.close()
}

console.log(errors.length ?`\nerrors in the page:\n${errors.join('\n')}` : '\nno errors in the page')
await browser.close()
site.close()
