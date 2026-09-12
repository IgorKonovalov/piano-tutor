import { type Page, expect, test } from '@playwright/test'
import {
  type LaunchedApp,
  importScore,
  launchApp,
  openScenario,
  openScoreView,
  waitForEvents,
  waitForPortsView,
} from './harness'

/**
 * The whole feature, end to end, with nothing plugged in: import a piece,
 * choose a generated performance of it, play it through, stop, and read what
 * the app made of it.
 *
 * The performance is `virtual:score:pickup-two-hands-wrong-note` -- the same
 * fixture the timeline tests use, played with one seeded pitch a semitone out
 * in bar 3 and everything else correct. Because the perturbation declared that
 * verdict in `core/src/midi/perturb.ts`, "bar 3 and only bar 3" is a claim
 * about the app rather than a description of whatever it happened to produce.
 */

/** `pickup-two-hands` is nineteen struck notes over about nine seconds. */
const PIECE_NOTES = 19

let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close()
})

async function heard(page: Page): Promise<number> {
  const banner = page.getByTestId('practice-recording')
  if ((await banner.count()) === 0) return -1
  return Number(await banner.getAttribute('data-heard'))
}

/**
 * Wait until the passage has finished arriving: the count has reached the
 * piece and then stopped moving. Waiting on a fixed duration would be a race
 * on a slow machine, and stopping early would cut off the very bar under test.
 */
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

/**
 * `atLeast` is a floor, not the count: what ends the wait is the counter
 * standing still. The banner subscribes after `open()` resolves, so a note the
 * generator puts at t = 0 is emitted before the renderer is listening and is
 * missing from the count -- from the count only; main records it, and the take
 * on disk is what the report is built from.
 */
async function practise(scenarioId: string, atLeast = PIECE_NOTES): Promise<void> {
  const { page } = launched
  await page.getByTestId('practice-port').selectOption(scenarioId)
  await page.getByTestId('practice-toggle').click()
  await expect(page.getByTestId('practice-recording')).toBeVisible()
  await waitForPassage(page, atLeast)
  await page.getByTestId('practice-toggle').click()
  await expect(page.getByTestId('practice-stats')).toBeVisible()
}

test('one wrong note colours one bar, and the detail says which note', async () => {
  test.setTimeout(180_000)
  launched = await launchApp()
  const { page } = launched
  await openScoreView(launched)
  await importScore(launched, 'pickup-two-hands.musicxml')

  await practise('virtual:score:pickup-two-hands-wrong-note')

  // Bar 3 and only bar 3 is wrong. Every other bar is clean -- not merely
  // "not wrong": a report that gave up would show them as not attempted.
  const wrong = page.locator('[data-testid="bar-mark"][data-state="wrong"]')
  await expect(wrong).toHaveCount(1)
  await expect(wrong).toHaveAttribute('data-bar', '3')
  await expect(page.locator('[data-testid="bar-mark"][data-state="clean"]')).toHaveCount(3)
  await expect(page.locator('[data-testid="bar-mark"][data-state="notAttempted"]')).toHaveCount(0)

  // Colour is never the only carrier: the mark itself says what it means, and
  // it counts correctly -- one wrong note is not "1 wrong notes".
  await expect(wrong).toHaveText('1 wrong note')

  // The bar detail names the pitch written and the pitch played. The
  // perturbation substitutes the lowest note of bar 3, C3, a semitone up.
  await page.getByTestId('highlight-bar').fill('3')
  const detail = page.getByTestId('bar-detail')
  await expect(detail).toHaveAttribute('data-bar', '3')
  await expect(page.getByTestId('bar-detail-state')).toContainText('Wrong notes')

  const notes = page.getByTestId('bar-detail-note')
  await expect(notes).toHaveCount(1)
  await expect(notes).toHaveAttribute('data-kind', 'wrongPitch')
  await expect(notes).toContainText('C#3')
  await expect(notes).toContainText('C3')

  expect(launched.networkRequests).toEqual([])
})

test('a piece played correctly is clean, bar for bar', async () => {
  test.setTimeout(180_000)
  launched = await launchApp()
  const { page } = launched
  await openScoreView(launched)
  await importScore(launched, 'pickup-two-hands.musicxml')

  await practise('virtual:score:pickup-two-hands')

  await expect(page.locator('[data-testid="bar-mark"][data-state="clean"]')).toHaveCount(4)
  await expect(page.locator('[data-testid="bar-mark"][data-state="wrong"]')).toHaveCount(0)
  await expect(page.getByTestId('stat-wrong')).toHaveText('0')
  await expect(page.getByTestId('stat-missing')).toHaveText('0')
  await expect(page.getByTestId('stat-extra')).toHaveText('0')
  await expect(page.getByTestId('stat-correct')).toHaveText(String(PIECE_NOTES))

  expect(launched.networkRequests).toEqual([])
})

test('a free-play take still lists and replays, and says it was free play', async () => {
  test.setTimeout(180_000)
  launched = await launchApp()
  const { page } = launched
  await waitForPortsView(page)

  // Nothing about practising changes what a take recorded from the ports view
  // is: the score column says so rather than being left blank.
  await openScenario(page, 'virtual:ii-V-I-in-F')
  const recorded = await waitForEvents(page, 32)
  await page.getByRole('button', { name: 'Close port' }).click()

  await page.getByTestId('nav-takes').click()
  const row = page.getByTestId('take-row').first()
  await expect(row).toContainText('virtual:ii-V-I-in-F')
  await expect(row.getByTestId('take-score')).toContainText('Free play')

  const takeId = await row.getAttribute('data-take-id')
  const onDisk = await page.evaluate(
    async (id) => (await window.api.take.load(id as string)).events.length,
    takeId
  )
  expect(onDisk).toBe(recorded)

  await row.getByTestId('take-replay-1').click()
  await expect(page.getByTestId('live-view')).toBeVisible()
  expect(await waitForEvents(page, onDisk)).toBe(onDisk)

  expect(launched.networkRequests).toEqual([])
})

test('a practised take remembers the piece it was attempting', async () => {
  test.setTimeout(180_000)
  launched = await launchApp()
  const { page } = launched
  await openScoreView(launched)
  const scoreId = await importScore(launched, 'pickup-two-hands.musicxml')

  await practise('virtual:score:pickup-two-hands')

  await page.getByTestId('nav-takes').click()
  const row = page.getByTestId('take-row').first()
  await expect(row).toContainText('virtual:score:pickup-two-hands')
  await expect(row.getByTestId('take-score')).toContainText('Practising')
  await expect(row.locator(`[data-score-id="${scoreId}"]`)).toHaveCount(1)

  expect(launched.networkRequests).toEqual([])
})

test('a session too short to keep does not report a previous take', async () => {
  // The regression: the view used to find its take by score id alone, which
  // returns the NEWEST take of that piece. A session under ten note-ons is
  // never written, so that search reached back to the take before it and
  // showed a report about a performance the player had not just given.
  test.setTimeout(180_000)
  launched = await launchApp()
  const { page } = launched
  await openScoreView(launched)
  await importScore(launched, 'scale-c-major.musicxml')

  // A first take of this piece, kept. The bound is what matters, not the
  // exact count: comfortably over the ten note-ons a take is kept at.
  await page.getByTestId('practice-port').selectOption('virtual:score:scale-c-major')
  await page.getByTestId('practice-toggle').click()
  await expect(page.getByTestId('practice-recording')).toBeVisible()
  await waitForPassage(page, 12)
  await page.getByTestId('practice-toggle').click()
  await expect(page.getByTestId('practice-stats')).toBeVisible()
  const first = await page.getByTestId('stat-take').textContent()

  // A second, abandoned after bar 1: two bars of four, so at most eight notes
  // however the passage lands -- under the threshold, and no take is written.
  await page.getByTestId('practice-port').selectOption('virtual:score:scale-c-major-stopped')
  await page.getByTestId('practice-toggle').click()
  await expect(page.getByTestId('practice-recording')).toBeVisible()
  await waitForPassage(page, 6)
  await page.getByTestId('practice-toggle').click()

  // It must say so, and it must not show the earlier take's report instead.
  await expect(page.getByTestId('practice-error')).toContainText('too short to keep')
  expect(await page.getByTestId('practice-stats').count()).toBe(0)
  expect(first).not.toBeNull()
})

test('a false start is named as a restart, not counted as extra notes', async () => {
  // The take ADR-0014 was written from, in miniature: the player reaches the
  // end of bar 2, goes back, plays it again and carries on.
  test.setTimeout(180_000)
  launched = await launchApp()
  const { page } = launched
  await openScoreView(launched)
  await importScore(launched, 'scale-c-major.musicxml')

  // Fifteen written notes and four played again; the floor allows for the
  // one the counter can miss at t = 0.
  await practise('virtual:score:scale-c-major-restart', 15)

  const restarts = page.getByTestId('stat-restarts')
  await expect(restarts).toBeVisible()
  await expect(restarts).toContainText('went back over bar 2')
  await expect(restarts.locator('[data-bar="2"]')).toHaveAttribute('data-notes', '4')

  // What the repeat accounted for is not a mistake of any kind, and the whole
  // piece still reads as played: four bars, every one of them clean.
  await expect(page.getByTestId('stat-extra')).toHaveText('0')
  await expect(page.getByTestId('stat-wrong')).toHaveText('0')
  await expect(page.getByTestId('stat-missing')).toHaveText('0')
  await expect(page.locator('[data-testid="bar-mark"][data-state="clean"]')).toHaveCount(4)

  expect(launched.networkRequests).toEqual([])
})

test('the timing control changes how many bars are called out, on the take already played', async () => {
  // `scale-c-major-uneven` takes bar 2 at 93% of its written length: past the
  // strictest threshold and inside the most relaxed one. Nothing is recorded
  // again -- the report is re-derived from the take that is already loaded.
  test.setTimeout(180_000)
  launched = await launchApp()
  const { page } = launched
  await openScoreView(launched)
  await importScore(launched, 'scale-c-major.musicxml')

  await practise('virtual:score:scale-c-major-uneven', 12)

  const timing = page.locator('[data-testid="bar-mark"][data-state="timing"]')
  const takeLabel = await page.getByTestId('stat-take').textContent()

  await page.getByTestId('strictness').selectOption('strict')
  await expect(timing).toHaveCount(1)
  await expect(timing).toHaveAttribute('data-bar', '2')

  await page.getByTestId('strictness').selectOption('relaxed')
  await expect(timing).toHaveCount(0)
  await expect(page.locator('[data-testid="bar-mark"][data-state="clean"]')).toHaveCount(4)

  await page.getByTestId('strictness').selectOption('strict')
  await expect(timing).toHaveCount(1)

  // The same take throughout: no new recording, and the counts never moved.
  expect(await page.getByTestId('stat-take').textContent()).toBe(takeLabel)
  await expect(page.getByTestId('stat-wrong')).toHaveText('0')
  await expect(page.getByTestId('stat-missing')).toHaveText('0')
  await expect(page.getByTestId('stat-extra')).toHaveText('0')

  expect(launched.networkRequests).toEqual([])
})
