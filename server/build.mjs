// Bundles the server, its worker threads and its commands into dist/, with the game's rules and model compiled in
// from ../src as they are: one body of code for the browser and the server (PRD SIM-1).
import { build } from 'esbuild'

await build({
  entryPoints: { main: 'src/main.ts', worker: 'src/worker.ts', cli: 'src/cli.ts', load: 'tools/load.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'warning',
  // The rules read `import.meta.env` nowhere, but the screen's data loaders do; the server never imports them.
  define: { 'import.meta.env.BASE_URL': '"/"' },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
})
