import { defineConfig } from 'vitest/config'

// The server's tests are named *.check.ts, so that the game's own `npx vitest run` does not pick them up.
export default defineConfig({
  test: {
    root: __dirname,
    include: ['test/**/*.check.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
  },
})
