import { defineConfig } from '@playwright/test'

// The suite drives the built Electron app through `_electron.launch`, so there
// is no browser project and no web server: every spec launches its own app.
// `npm run build` must have run first; the launch helper asserts the bundles.
//
// Two projects, because they want opposite things of the machine. `suite` runs
// cases side by side, which it can because each launch has its own userData
// directory and no window depends on being the one in front. `measure` holds
// the three cases that read a clock -- NFR 4, 11 and 12 -- and runs after
// `suite` has finished, one at a time, with no other app open. A figure
// measured beside three other Electron instances is not a figure about this
// app.
//
// The dependency is what orders them. It also means a red in `suite` skips
// `measure` and fails the run, which is the right way round: there is nothing
// worth measuring about a broken app.
export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // Measured on the development machine, 2026-09-12, running the whole suite at
  // one, two, three and four workers: 173 s, 124 s, 99 s, 84 s. Four is the
  // fastest of the counts tried and the one that then came back green three
  // times; the figures are in plan 0014's implementation log. The curve was
  // still falling there and this machine has sixteen logical cores, so a higher
  // count is worth measuring -- against a suite that mostly waits on real time
  // rather than on the CPU, and four apps at once already sound four fallback
  // voices at the desk.
  workers: 4,

  projects: [
    {
      name: 'suite',
      testIgnore: /measure\.spec\.ts/,
      fullyParallel: true,
    },
    {
      name: 'measure',
      testMatch: /measure\.spec\.ts/,
      // One file, not fully parallel: its cases run one after another in a
      // single worker, which is the whole point of the project.
      fullyParallel: false,
      dependencies: ['suite'],
    },
  ],
})
