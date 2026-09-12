import { expect, test } from '@playwright/test'
import { existsSync, statSync } from 'node:fs'
import {
  type LaunchedApp,
  launchApp,
  openScenario,
  readWindowFlags,
  waitForEvents,
  waitForPortsView,
} from './harness'

/**
 * The whole skeleton, driven with nothing plugged in.
 *
 * What is asserted here is properties, never milliseconds: every view
 * reachable, every generated event delivered, no network request (NFR 3), and
 * the two things that let these cases run four at a time -- a state directory
 * per launch and a window that paints while covered. Anything that reads a
 * clock lives in `measure.spec.ts`, which runs afterwards with the machine to
 * itself.
 */

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
  // Four hand-written passages, the six written pieces of plan 0002 phase 3
  // and the three takes of plan 0008. The count is exact on purpose: a port
  // that quietly stops being enumerated is the failure this is watching for.
  await expect(virtualRows).toHaveCount(13)
  for (const id of [
    'virtual:c-major-scale',
    'virtual:ii-V-I-in-F',
    'virtual:a-minor-arpeggios',
    'virtual:dense-2000',
    'virtual:score:scale-c-major',
    'virtual:score:pickup-two-hands',
    'virtual:score:pickup-two-hands-wrong-note',
    'virtual:score:scale-c-major-stopped',
    'virtual:score:scale-c-major-restart',
    'virtual:score:scale-c-major-rallentando',
    'virtual:score:scale-c-major-uneven',
  ]) {
    await expect(page.locator(`[data-port-id="${id}"]`)).toBeVisible()
  }

  expect(launched.networkRequests).toEqual([])
})

test('each launch reads and writes a state directory of its own', async () => {
  // What lets several apps run at once: no launch can see the scores, takes or
  // settings of another, or of the developer's own `npm run dev`.
  const beforeLaunch = Date.now()
  launched = await launchApp()
  const first = launched.userDataDir

  // Read from inside the app, because what matters is the directory main
  // actually resolves `userData` to, not the one the switch asked for.
  const reported = await launched.app.evaluate(({ app }) => app.getPath('userData'))
  expect(reported).toBe(first)

  // It did not exist before this launch: it was created after the case started.
  // `mkdtemp` picks a fresh random name every time, so NTFS cannot hand back an
  // older creation stamp for a name it saw before.
  expect(statSync(first).birthtimeMs).toBeGreaterThanOrEqual(beforeLaunch)

  await launched.close()
  expect(existsSync(first)).toBe(false)

  launched = await launchApp()
  const second = await launched.app.evaluate(({ app }) => app.getPath('userData'))
  expect(second).toBe(launched.userDataDir)
  expect(second).not.toBe(first)
})

test('a harness window paints whether or not it is the one in front', async () => {
  launched = await launchApp()
  await waitForPortsView(launched.page)

  // The other half of running several at once: with four windows open only one
  // can be in front, and a covered window's requestAnimationFrame drops to
  // about 1 Hz. Under the gate the throttle is off, so being covered costs a
  // case nothing. The window is still shown -- one that is never shown does not
  // lay out at all, measured on Electron 44 and recorded in plan 0014.
  expect(await readWindowFlags(launched)).toEqual({ visible: true, backgroundThrottling: false })
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

test('shutting the harness gate leaves the suite with no port to open', async () => {
  // The test that the gate of ADR-0004 is real rather than assumed: with
  // PT_HARNESS=0 the app enumerates no generated port, so the harness has
  // nothing to drive and every scenario id is simply absent.
  launched = await launchApp({ harness: false })
  const { page } = launched
  await waitForPortsView(page)

  // The gate shut is also what a player gets: the window puts itself on screen
  // at `ready-to-show` and is throttled when it is not in front, exactly as
  // before the suite ever needed otherwise.
  expect(await readWindowFlags(launched)).toEqual({ visible: true, backgroundThrottling: true })

  await expect(page.getByTestId('port-group-virtual').getByTestId('port-row')).toHaveCount(0)
  await expect(page.getByTestId('port-group-virtual')).toContainText('Disabled in this build')
  for (const id of [
    'virtual:c-major-scale',
    'virtual:ii-V-I-in-F',
    'virtual:a-minor-arpeggios',
    'virtual:dense-2000',
    'virtual:score:scale-c-major',
    'virtual:score:pickup-two-hands-wrong-note',
  ]) {
    await expect(page.locator(`[data-port-id="${id}"]`)).toHaveCount(0)
  }
})
