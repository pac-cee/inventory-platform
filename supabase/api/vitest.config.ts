import { defineConfig } from 'vitest/config'

// Set before anything imports the app — globalSetup builds the users through
// it, so it has to be reading the test schema by then. env.ts reads this at
// module load, and imports are hoisted, so a config-module assignment is the
// earliest place that reliably wins.
process.env.DB_SCHEMA = 'test'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: 'tests/setup/global.ts',
    environment: 'node',
    // The harness builds an isolated schema; the app must be told to read it
    // rather than inheriting it from a pooled connection.
    env: { DB_SCHEMA: 'test' },
    testTimeout: 30000,
    // Vitest defaults hookTimeout to 10s independently of testTimeout above —
    // beforeAll hooks that make several real network calls (logins, seed
    // locations) against the remote Neon DB can exceed that on their own, and
    // a login's bcrypt compare alone was measured at 9.8s against a cold Neon
    // compute, right on the old default. Raised past both so setup gets a
    // real budget and a slow first request fails on its merits, not the clock.
    hookTimeout: 60000,
    // Files share one `test` schema and one admin/member pair, so running them
    // in parallel had them treading on each other — failures that vanish when a
    // file runs alone. Serial execution is what fixes that.
    //
    // `isolate: false` was tried here to claw back the re-import cost and must
    // not come back: sharing the module registry leaks vi.mock state between
    // files, which broke five assertions in auth and resend-verification. The
    // suite is 208/208 in ~447s with isolation on, against 190/5 in ~281s
    // without — the speed is not worth an untrustworthy result.
    fileParallelism: false,
  },
})
