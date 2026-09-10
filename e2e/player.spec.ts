import { type Page, expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SCORE_FIXTURES,
  type LaunchedApp,
  importScore,
  launchApp,
  openScenario,
  openScoreView,
  waitForEvents,
  waitForPortsView,
} from './harness'

/**
 * The app playing, driven with nothing plugged in (ADR-0004).
 *
 * What is asserted is the property NFR 13 exists for: what the app plays
 * reaches the far end complete, in order, and **nothing is left sounding**.
 * The milliseconds of that row are measured at the instrument and reported
 * into the plan's log; nothing here is a stopwatch.
 *
 * The observable is the renderer's own view of `player:event` -- the note
 * count and the sounding count the transport carries -- because that is the
 * real surface, reached the way a player reaches it.
 */

/** Fast enough that a test is not a wait, slow enough to be a real schedule. */
const TEST_BPM = 240

let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close()
})

interface TimelineNote {
  bar: number
}

function fixtureNotes(file: string, fromBar: number, toBar: number): number {
  const path = join(SCORE_FIXTURES, file.replace(/\.musicxml$/, '.timeline.json'))
  const timeline = JSON.parse(readFileSync(path, 'utf8')) as { notes: TimelineNote[] }
  return timeline.notes.filter((note) => note.bar >= fromBar && note.bar <= toBar).length
}

/**
 * Press play and wait until it is actually running.
 *
 * The wait on `playing` is not decoration. The click only sends the request;
 * main builds the schedule and pushes the first state a moment later, so a
 * test that goes straight to waiting for `idle` is handed the idle it started
 * from and asserts against a playback that never happened.
 */
async function play(page: Page, testId = 'transport'): Promise<void> {
  await page.getByTestId(`${testId}-play`).click()
  await expect(page.getByTestId(testId)).toHaveAttribute('data-state', 'playing')
}

async function waitForIdle(page: Page, testId = 'transport'): Promise<void> {
  await expect(page.getByTestId(testId)).toHaveAttribute('data-state', 'idle', {
    timeout: 30_000,
  })
}

async function attribute(page: Page, testId: string, name: string): Promise<string> {
  return (await page.getByTestId(testId).getAttribute(name)) ?? ''
}

test('the demonstration lights the keyboard and leaves nothing lit', async () => {
  launched = await launchApp()
  const { page } = launched
  await waitForPortsView(page)

  const keyboard = page.getByTestId('playback').getByTestId('keyboard')
  await expect(keyboard).toHaveAttribute('data-playing', '0')

  await page.getByTestId('player-play').click()

  // The C major scale of ADR-0004: two octaves up and back down, so every
  // white key from middle C to C8 is lit at some point and nothing above it.
  const lit = new Set<number>()
  const deadline = Date.now() + 30_000
  let everLit = false
  while (Date.now() < deadline) {
    const notes = await page.$$eval('[data-testid="playback"] [data-state="playing"]', (els) =>
      els.map((el) => Number(el.getAttribute('data-note')))
    )
    for (const note of notes) lit.add(note)
    if (notes.length > 0) everLit = true
    if (everLit && (await page.getByTestId('player-state').textContent())?.trim() === 'Idle') break
    await new Promise((resolve) => setTimeout(resolve, 16))
  }

  expect(everLit).toBe(true)
  expect(Math.min(...lit)).toBe(60)
  expect(Math.max(...lit)).toBe(84)
  expect(lit.size).toBe(15)

  await expect(keyboard).toHaveAttribute('data-playing', '0')

  // ADR-0008 defaults to this computer when no instrument is listening, so
  // the demonstration is audible on a machine with no piano attached. That it
  // is actually heard is a human judgement (Phase 7); what is asserted here is
  // that the app is aimed at the speakers rather than at nothing.
  await expect(page.getByTestId('player-sound')).toHaveValue('computer')

  expect(launched.networkRequests).toEqual([])
})

test('stopping halfway leaves no key lit', async () => {
  launched = await launchApp()
  const { page } = launched
  await waitForPortsView(page)

  await page.getByTestId('player-play').click()
  const keyboard = page.getByTestId('playback').getByTestId('keyboard')
  await expect(keyboard).not.toHaveAttribute('data-playing', '0')

  await page.getByTestId('player-stop').click()

  await expect(keyboard).toHaveAttribute('data-playing', '0')
  await expect(page.getByTestId('player-state')).toHaveText('Idle')
})

test('what the app plays never lands in a take', async () => {
  launched = await launchApp()
  const { page } = launched
  await waitForPortsView(page)

  // The recorder subscribes to a MidiSource and the player is not one
  // (ADR-0007), so playing a passage cannot produce a recording of it.
  await page.getByTestId('nav-takes').click()
  await expect(page.getByTestId('takes-view')).toBeVisible()
  const before = await page.getByTestId('take-row').count()

  await page.getByTestId('nav-ports').click()
  await page.getByTestId('player-play').click()
  await expect(page.getByTestId('playback').getByTestId('keyboard')).not.toHaveAttribute(
    'data-playing',
    '0'
  )
  await page.getByTestId('player-stop').click()

  await page.getByTestId('nav-takes').click()
  expect(await page.getByTestId('take-row').count()).toBe(before)
})

test('a range of bars plays exactly the notes the score holds for it', async () => {
  test.setTimeout(120_000)
  launched = await launchApp()
  const { page } = launched
  await openScoreView(launched)
  await importScore(launched, 'scale-c-major.musicxml')

  await page.getByTestId('transport-from').fill('1')
  await page.getByTestId('transport-to').fill('2')
  await page.getByTestId('transport-bpm').fill(String(TEST_BPM))

  await play(page)
  await waitForIdle(page)

  // Four quarter notes in each of bars 1 and 2 of the fixture, and nothing
  // from the bars either side of them.
  const expected = fixtureNotes('scale-c-major.musicxml', 1, 2)
  expect(expected).toBe(8)
  expect(Number(await attribute(page, 'transport', 'data-notes'))).toBe(expected)

  // The property NFR 13 is about: nothing is sounding once it has stopped.
  expect(Number(await attribute(page, 'transport', 'data-sounding'))).toBe(0)
  expect(launched.networkRequests).toEqual([])
})

test('the highlight walks the bars and lands on the last one chosen', async () => {
  test.setTimeout(120_000)
  launched = await launchApp()
  const { page } = launched
  await openScoreView(launched)
  await importScore(launched, 'scale-c-major.musicxml')

  await page.getByTestId('transport-from').fill('1')
  await page.getByTestId('transport-to').fill('3')
  await page.getByTestId('transport-bpm').fill(String(TEST_BPM))
  await play(page)

  const walked = new Set<string>()
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const bar = await attribute(page, 'transport', 'data-bar')
    if (bar !== '') walked.add(bar)
    if ((await attribute(page, 'transport', 'data-state')) === 'idle') break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  expect([...walked].sort()).toEqual(['1', '2', '3'])

  // The walk ends on the last bar of the range and the mark stays there.
  const marked = page.locator('[data-testid="bar-mark"][data-bar="3"]')
  await expect(marked).toHaveAttribute('data-state', 'highlight')
  expect(Number(await attribute(page, 'transport', 'data-sounding'))).toBe(0)
})

test('a play over a running one replaces it rather than overlapping it', async () => {
  test.setTimeout(120_000)
  launched = await launchApp()
  const { page } = launched
  await openScoreView(launched)
  await importScore(launched, 'scale-c-major.musicxml')

  await page.getByTestId('transport-bpm').fill(String(TEST_BPM))
  await play(page)

  await page.getByTestId('transport-stop').click()
  await waitForIdle(page)

  await page.getByTestId('transport-from').fill('0')
  await page.getByTestId('transport-to').fill('0')
  await play(page)
  await waitForIdle(page)

  // The count belongs to the second play alone: it is reset when a play
  // starts, not accumulated across the view's lifetime.
  expect(Number(await attribute(page, 'transport', 'data-notes'))).toBe(
    fixtureNotes('scale-c-major.musicxml', 0, 0)
  )
  expect(Number(await attribute(page, 'transport', 'data-sounding'))).toBe(0)
})

/**
 * Record a take by playing a generated passage into the app, which is the only
 * way a take is ever made (ADR-0004). Leaving the live view closes the port,
 * which is what finalises the file.
 */
async function recordTake(page: Page, scenarioId: string, events: number): Promise<number> {
  await openScenario(page, scenarioId)
  await waitForEvents(page, events)

  await page.getByTestId('nav-takes').click()
  const row = page.getByTestId('take-row').first()
  await expect(row).toBeVisible()
  return Number(await row.getAttribute('data-note-count'))
}

test('a recorded take plays out with the notes it was recorded with', async () => {
  test.setTimeout(120_000)
  launched = await launchApp()
  const { page } = launched
  await waitForPortsView(page)

  // The scale of ADR-0004 is 29 note-ons and their releases: played into the
  // app and written down, then sent back out of the port again.
  const notes = await recordTake(page, 'virtual:c-major-scale', 58)
  expect(notes).toBe(29)

  await page.getByTestId('take-play-2').first().click()
  const transport = page.getByTestId('take-transport')
  await expect(transport).toHaveAttribute('data-state', 'playing')
  await expect(transport).toHaveAttribute('data-state', 'idle', { timeout: 30_000 })

  expect(Number(await attribute(page, 'take-transport', 'data-notes'))).toBe(notes)
  // The property NFR 13 is about, on the path a truncated take also travels:
  // whatever the file held, nothing is sounding once it has finished.
  expect(Number(await attribute(page, 'take-transport', 'data-sounding'))).toBe(0)
  expect(launched.networkRequests).toEqual([])
})

test('the two verbs are both present and neither triggers the other', async () => {
  test.setTimeout(120_000)
  launched = await launchApp()
  const { page } = launched
  await waitForPortsView(page)
  await recordTake(page, 'virtual:c-major-scale', 58)

  const row = page.getByTestId('take-row').first()
  await expect(row.getByTestId('take-replay')).toContainText('Replay into the app')
  await expect(row.getByTestId('take-play')).toContainText('Play on the piano')

  // Playing out reaches the instrument and leaves the view where it is.
  await row.getByTestId('take-play-2').click()
  await expect(page.getByTestId('take-transport')).toHaveAttribute('data-state', 'playing')
  await expect(page.getByTestId('takes-view')).toBeVisible()
  await expect(page.getByTestId('live-view')).toHaveCount(0)
  await page.getByTestId('take-transport-stop').click()

  // Replaying feeds the app's own input pipeline, which is the live view.
  await row.getByTestId('take-replay-2').click()
  await expect(page.getByTestId('live-view')).toBeVisible()
})
