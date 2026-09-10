import { defineConfig } from '@playwright/test'

// The suite drives the built Electron app through `_electron.launch`, so there
// is no browser project and no web server: every spec launches its own app.
// `npm run build` must have run first; the launch helper asserts the bundles.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
})
