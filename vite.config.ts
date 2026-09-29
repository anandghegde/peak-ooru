import { defineConfig } from 'vite'

/** The game's server, which the dev server and the preview of a built copy pass `/api` to. */
const server = process.env.PEAKOORU_SERVER ?? 'http://localhost:5210'
const proxy = { '/api': { target: server, changeOrigin: false }, '/share': { target: server, changeOrigin: false } }

export default defineConfig({
  // The map library loads its worker from a file beside it, which pre-bundling would move.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  build: { target: 'es2022' },
  worker: { format: 'es' },
  server: { proxy },
  preview: { proxy },
})
