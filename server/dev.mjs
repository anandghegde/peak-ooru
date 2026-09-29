// Runs the server here for the others: port 5210, a scratch store in .data/dev.db, the first season open. Rebuilds
// and restarts when the server, the rules or the model change.
import { spawn } from 'node:child_process'
import { context } from 'esbuild'

const env = {
  ...process.env,
  PORT: process.env.PORT ?? '5210',
  STORE: process.env.STORE ?? '.data/dev.db',
  SCRATCH: '1',
  OPEN_SEASON: process.env.OPEN_SEASON ?? 'first',
  PUBLIC_URL: process.env.PUBLIC_URL ?? 'http://localhost:5190',
}

let child = null
let timer = null
const restart = () => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    const start = () => {
      child = spawn(process.execPath, ['--enable-source-maps', 'dist/main.js'], { env, stdio: 'inherit' })
      child.on('exit', (code, signal) => {
        if (signal !== 'SIGTERM' && code !== 0) console.error(`The server stopped (${code ?? signal}); it starts again on the next change.`)
      })
    }
    if (child && child.exitCode === null) {
      child.once('exit', start)
      child.kill('SIGTERM')
    } else start()
  }, 300)
}

const ctx = await context({
  entryPoints: { main: 'src/main.ts', worker: 'src/worker.ts', cli: 'src/cli.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'warning',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  plugins: [{ name: 'restart', setup: (b) => b.onEnd((r) => r.errors.length === 0 && restart()) }],
})
await ctx.watch()
