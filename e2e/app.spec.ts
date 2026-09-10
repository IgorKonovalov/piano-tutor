import { expect, test } from '@playwright/test'
import {
  type LaunchedApp,
  bringToFront,
  eventsReceived,
  launchApp,
  openScenario,
  readLatency,
  waitForEvents,
  waitForPortsView,
} from './harness'

/**
 * The whole skeleton, driven with nothing plugged in.
 *
 * What is asserted here is properties, not milliseconds: every view reachable,
 * every generated event delivered (NFR 2), no network request (NFR 3), and the
 * frame bound of NFR 11. The millisecond figures and the startup figure are
 * *reported* into the plan's implementation log instead -- they are
 * measurements of one machine, and a threshold here would fail on a slower one
 * for the wrong reason.
 */

/** `virtual:dense-2000` generates this many events over about eighteen seconds. */
const DENSE_EVENT_COUNT = 2200

/** NFR 11: the frame first showing a key is within this many frames of arrival. */
const FRAME_P95_BUDGET = 2
const FRAME_MAX_BUDGET = 4

let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close()
})

test('the ports view lists the harness with nothing attached', async () => {
  launched = await launchApp()
  const { page } = launched
  await waitForPortsView(page)

  await expect(page.getByTestId('port-group-hardware')).toBeVisible()
  const virtualRows = page.getByTestId('port-group-virtual').getByTestId('port-row')
  await expect(virtualRows).toHaveCount(4)
  for (const id of [
    'virtual:c-major-scale',
    'virtual:ii-V-I-in-F',
    'virtual:a-minor-arpeggios',
    'virtual:dense-2000',
  ]) {
    await expect(page.locator(`[data-port-id="${id}"]`)).toBeVisible()
  }

  expect(launched.networkRequests).toEqual([])
})

test('every view is reachable', async () => {
  launched = await launchApp()
  const { page } = launched
  await waitForPortsView(page)

  await page.getByTestId('nav-takes').click()
  await expect(page.getByTestId('takes-view')).toBeVisible()

  await page.getByTestId('nav-ports').click()
  await expect(page.getByTestId('ports-view')).toBeVisible()

  await openScenario(page, 'virtual:ii-V-I-in-F')
  await expect(page.getByTestId('live-view')).toBeVisible()
  await expect(page.getByTestId('labels')).toBeVisible()
  await expect(page.getByTestId('live-staff')).toBeVisible()
  await expect(page.getByTestId('keyboard')).toBeVisible()
  await expect(page.getByTestId('event-log')).toBeVisible()

  expect(launched.networkRequests).toEqual([])
})

test('a session is recorded, listed and replayed through the same pipeline', async () => {
  launched = await launchApp()
  const { page } = launched
  await waitForPortsView(page)

  await openScenario(page, 'virtual:ii-V-I-in-F')
  const recorded = await waitForEvents(page, 32)
  await page.getByRole('button', { name: 'Close port' }).click()

  await page.getByTestId('nav-takes').click()
  await expect(page.getByTestId('takes-view')).toBeVisible()
  const row = page.getByTestId('take-row').first()
  await expect(row).toBeVisible()

  // The take says where it came from, so a generated one is never read as
  // something a person played (ADR-0004).
  await expect(row).toContainText('virtual:ii-V-I-in-F')
  await expect(row).toContainText('Generated')
  await expect(row).toContainText('notes')

  const takeId = await row.getAttribute('data-take-id')
  const onDisk = await page.evaluate(
    async (id) => (await window.api.take.load(id as string)).events.length,
    takeId
  )
  expect(onDisk).toBe(recorded)

  await row.getByTestId('take-replay-1').click()
  await expect(page.getByTestId('live-view')).toBeVisible()
  const replayed = await waitForEvents(page, onDisk)
  expect(replayed).toBe(onDisk)

  expect(launched.networkRequests).toEqual([])
})

test('the dense passage arrives complete and inside the frame budget', async () => {
  test.setTimeout(120_000)
  launched = await launchApp()
  const { page } = launched
  await waitForPortsView(page)
  await bringToFront(launched)

  await openScenario(page, 'virtual:dense-2000')
  const received = await waitForEvents(page, DENSE_EVENT_COUNT, 90_000)

  // NFR 2: every generated event reached the renderer.
  expect(received).toBe(DENSE_EVENT_COUNT)
  expect(await eventsReceived(page)).toBe(DENSE_EVENT_COUNT)

  // NFR 11: a property, and the one an unattended run can hold to.
  const latency = await readLatency(page)
  expect(latency.samples).toBeGreaterThan(0)
  expect(latency.frameP95).toBeLessThanOrEqual(FRAME_P95_BUDGET)
  expect(latency.frameMax).toBeLessThanOrEqual(FRAME_MAX_BUDGET)

  // Reported, never asserted: these belong in the implementation log.
  console.log(
    `[nfr 11] frames p50 ${latency.frameP50} p95 ${latency.frameP95} max ${latency.frameMax} ` +
      `| ms p50 ${latency.msP50} p95 ${latency.msP95} max ${latency.msMax} ` +
      `over ${latency.samples} note-ons`
  )

  expect(launched.networkRequests).toEqual([])
})

test('shutting the harness gate leaves the suite with no port to open', async () => {
  // The test that the gate of ADR-0004 is real rather than assumed: with
  // PT_HARNESS=0 the app enumerates no generated port, so the harness has
  // nothing to drive and every scenario id is simply absent.
  launched = await launchApp({ harness: false })
  const { page } = launched
  await waitForPortsView(page)

  await expect(page.getByTestId('port-group-virtual').getByTestId('port-row')).toHaveCount(0)
  await expect(page.getByTestId('port-group-virtual')).toContainText('Disabled in this build')
  for (const id of [
    'virtual:c-major-scale',
    'virtual:ii-V-I-in-F',
    'virtual:a-minor-arpeggios',
    'virtual:dense-2000',
  ]) {
    await expect(page.locator(`[data-port-id="${id}"]`)).toHaveCount(0)
  }
})

test('reports the startup figure for NFR 4', async () => {
  launched = await launchApp()
  const { page } = launched
  await waitForPortsView(page)
  await bringToFront(launched)

  const { firstKeyPaintedAt } = await openScenario(page, 'virtual:c-major-scale')
  const ms = Math.round(firstKeyPaintedAt - launched.processCreatedAt)

  // Reported, not asserted (NFR 4): the machine running this is not
  // necessarily the development machine. The figure spans a little more than
  // `app.whenReady` -- it starts at process creation, which is the earliest
  // instant available without a hook in main.
  console.log(`[nfr 4] process creation to first painted key: ${ms} ms`)
  expect(ms).toBeGreaterThan(0)

  expect(launched.networkRequests).toEqual([])
})
