import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let app: ElectronApplication

test.beforeEach(async () => {
  app = await electron.launch({
    args: [repoRoot],
    cwd: repoRoot,
    env: { ...process.env, PT_HARNESS: '1' },
  })
})

test.afterEach(async () => {
  await app.close()
})

test('the app opens on the ports view with the harness group listed', async () => {
  const page = await app.firstWindow()

  // NFR 3: nothing in the renderer reaches the network. Recorded from the
  // first window event so a request during boot is caught too.
  const networkRequests: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (/^(https?|wss?):/i.test(url)) networkRequests.push(url)
  })

  await expect(page.getByTestId('ports-view')).toBeVisible()
  await expect(page.getByTestId('port-group-hardware')).toBeVisible()

  const virtualRows = page.getByTestId('port-group-virtual').getByTestId('port-row')
  await expect(virtualRows.first()).toBeVisible()
  expect(await virtualRows.count()).toBeGreaterThan(0)
  await expect(page.locator('[data-port-id="virtual:c-major-scale"]')).toBeVisible()

  // An uncaught renderer error paints nothing; the heading is the proof that
  // the bundle, the preload bridge and the IPC round trip all came up.
  await expect(page.getByRole('heading', { name: 'MIDI input ports' })).toBeVisible()

  expect(networkRequests).toEqual([])
})
