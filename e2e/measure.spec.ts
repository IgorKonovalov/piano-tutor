import { type Page, expect, test } from '@playwright/test'
import {
  type LaunchedApp,
  bringToFront,
  eventsReceived,
  importScore,
  launchApp,
  openScenario,
  openScoreView,
  readLatency,
  waitForEvents,
  waitForPortsView,
} from './harness'

/**
 * The cases that measure, and therefore cannot share the machine.
 *
 * Everything else in the suite asserts a property and runs beside three other
 * Electron instances. These three read a clock: a frame bound (NFR 11), the
 * startup figure (NFR 4) and the time from stop to a coloured score (NFR 12).
 * A frame bound asserted while three other apps compete for the CPU is a flake
 * by construction, and a millisecond figure measured there says nothing about
 * the machine. So they are their own Playwright project, which runs after the
 * parallel one has finished and has the machine to itself.
 *
 * The bodies are unchanged from `app.spec.ts` and `practice.spec.ts`, where
 * they lived until plan 0014 phase 3.
 */

/** `virtual:dense-2000` generates this many events over about eighteen seconds. */
const DENSE_EVENT_COUNT = 2200

/** NFR 11: the frame first showing a key is within this many frames of arrival. */
const FRAME_P95_BUDGET = 2
const FRAME_MAX_BUDGET = 4

/** `pickup-two-hands` is nineteen struck notes over about nine seconds. */
const PIECE_NOTES = 19

let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close()
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

/**
 * The three helpers below are `practice.spec.ts`'s, copied rather than shared.
 * Importing them from that file would register its whole set of tests here as
 * well, and the one place they could be shared from -- `harness.ts` -- is not a
 * file this phase may touch. Moving them there is a followup.
 */
async function heard(page: Page): Promise<number> {
  const banner = page.getByTestId('practice-recording')
  if ((await banner.count()) === 0) return -1
  return Number(await banner.getAttribute('data-heard'))
}

async function waitForPassage(page: Page, expected: number): Promise<number> {
  const deadline = Date.now() + 60_000
  let last = -1
  let stillFor = 0
  while (Date.now() < deadline) {
    const count = await heard(page)
    if (count === last && count >= expected) {
      stillFor += 250
      if (stillFor >= 1500) return count
    } else {
      stillFor = 0
      last = count
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`only ${last} of ${expected} notes arrived`)
}

async function practise(scenarioId: string, atLeast = PIECE_NOTES): Promise<void> {
  const { page } = launched
  await page.getByTestId('practice-port').selectOption(scenarioId)
  await page.getByTestId('practice-toggle').click()
  await expect(page.getByTestId('practice-recording')).toBeVisible()
  await waitForPassage(page, atLeast)
  await page.getByTestId('practice-toggle').click()
  await expect(page.getByTestId('practice-stats')).toBeVisible()
}

test('the statistics show the counts the report carries', async () => {
  test.setTimeout(180_000)
  launched = await launchApp()
  const { page } = launched
  await openScoreView(launched)
  await importScore(launched, 'pickup-two-hands.musicxml')

  await practise('virtual:score:pickup-two-hands-wrong-note')

  const stats = page.getByTestId('practice-stats')
  // Nineteen written notes, one of them struck a semitone out: eighteen as
  // written, one wrong, nothing missing and nothing extra.
  await expect(stats).toHaveAttribute('data-correct', String(PIECE_NOTES - 1))
  await expect(stats).toHaveAttribute('data-wrong', '1')
  await expect(stats).toHaveAttribute('data-missing', '0')
  await expect(stats).toHaveAttribute('data-extra', '0')

  await expect(page.getByTestId('stat-correct')).toHaveText(String(PIECE_NOTES - 1))
  await expect(page.getByTestId('stat-wrong')).toHaveText('1')
  await expect(page.getByTestId('stat-bars')).toHaveText('3/4')
  await expect(page.getByTestId('stat-tempo')).toContainText('bpm')

  // NFR 12 is reported, never asserted: it is a figure about one machine.
  const elapsed = Number(await stats.getAttribute('data-align-ms'))
  console.log(`[nfr 12] stop to a coloured score, in the app: ${elapsed} ms`)
  expect(Number.isFinite(elapsed)).toBe(true)

  expect(launched.networkRequests).toEqual([])
})
