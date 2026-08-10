import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // deploy/ is plain .mjs, not part of the TypeScript project — the webhook
    // ships as its own tiny container with no build step (deploy/webhook/),
    // so its tests are .mjs too and tsconfig never sees them.
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'migrations/**/*.test.ts', 'deploy/**/*.test.mjs'],
    setupFiles: ['./tests/setup.ts'],
    // Every test file shares one Postgres database (contributor_registry_test),
    // so files must not run concurrently — e.g. migrations/run.test.ts drops
    // the contributors table in its own beforeEach.
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': new URL('./src/', import.meta.url).pathname },
  },
})
