import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SCORE_FIXTURES,
  type LaunchedApp,
  chooseFile,
  importScore,
  launchApp,
  openScenario,
  openScoreView as openScore,
  waitForEvents,
  waitForPortsView,
} from './harness'

/**
 * The score library and the engraved score, driven with nothing plugged in.
 *
 * The one thing the suite reaches into is main's open dialog, replaced from
 * outside the app before the view asks for it. Nothing is added to the app to
 * make this possible -- there is no test hook and no extra channel (ADR-0004);
 * the harness stands where the operating system stands and hands back a path.
 *
 * The library lives in the real userData and therefore survives the run, so
 * nothing here asserts a total. Every claim is about one entry: that this file
 * is present exactly once, or that importing it again did not add a second.
 * A run against a library that already holds these scores asserts the same
 * things as a run against an empty one.
 */

const FIXTURES = SCORE_FIXTURES

/**
 * Bar counts are `MeasureList.length` -- one entry per source measure, which
 * is what a bar index addresses (ADR-0005). They are read off the fixture
 * files, not off a run: four measures each in the first three, and seven in
 * `multi-rest-and-ties`, whose bars 3 to 5 are a multi-measure rest that is
 * drawn as one object but is still three bars.
 */
const FIXTURE_SCORES = [
  { file: 'scale-c-major.musicxml', title: 'C major scale', bars: 4 },
  { file: 'pickup-two-hands.musicxml', title: 'Pickup, two hands', bars: 4 },
  { file: 'key-and-time-change.musicxml', title: 'Key and time change', bars: 4 },
  { file: 'multi-rest-and-ties.musicxml', title: 'Multi-rest and ties', bars: 7 },
  { file: 'grace-note.musicxml', title: 'Grace note', bars: 3 },
  { file: 'ornaments.musicxml', title: 'Ornaments', bars: 4 },
  { file: 'empty-carrier-bar.musicxml', title: 'Empty carrier bar', bars: 3 },
  { file: 'pedal.musicxml', title: 'Pedal', bars: 4 },
]

/** `scripts/regen-score-timelines.md` is the procedure this flag belongs to. */
const REGENERATING = process.env.PT_REGEN_TIMELINES === '1'

function timelinePath(scoreFile: string): string {
  return join(FIXTURES, scoreFile.replace(/\.musicxml$/, '.timeline.json'))
}

let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close()
})

async function openScoreView(): Promise<void> {
  await openScore(launched)
}

async function importAndDraw(file: string): Promise<string> {
  return importScore(launched, file)
}

test('each fixture score imports and draws', async () => {
  test.setTimeout(120_000)
  launched = await launchApp()
  const { page } = launched
  await openScoreView()

  for (const fixture of FIXTURE_SCORES) {
    const id = await importAndDraw(fixture.file)

    // OSMD drew it: an SVG in the host, and a bar box for at least the bars
    // that are not collapsed into a multi-measure rest.
    await expect(page.getByTestId('osmd-host').locator('svg')).toBeVisible()
    await expect(page.getByTestId('bar-count')).toHaveAttribute(
      'data-bars',
      String(fixture.bars)
    )
    expect(await page.getByTestId('bar-mark').count()).toBeGreaterThan(0)

    // Reported, never asserted: parse, engrave and extract on this machine.
    console.log(
      `[score load] ${fixture.file}: ` +
        `${await page.getByTestId('timeline-details').getAttribute('data-load-ms')} ms`
    )

    // One row for this file, found by its id rather than its title -- a title
    // is not unique and the library outlives the run. The title is the one
    // fact only the renderer can learn, and it is written back to that row.
    const row = page.locator(`[data-testid="score-row"][data-score-id="${id}"]`)
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(fixture.title)
  }

  expect(launched.networkRequests).toEqual([])
})

test('importing the same file twice is one library entry', async () => {
  launched = await launchApp()
  const { page } = launched
  await openScoreView()

  // Idempotency end to end: the second import neither adds a row nor a second
  // row for the same id. That the id comes from the bytes, and that a re-import
  // keeps the original timestamp, is `electron/score/library.test.ts`.
  const id = await importAndDraw('key-and-time-change.musicxml')
  const row = page.locator(`[data-testid="score-row"][data-score-id="${id}"]`)
  await expect(row).toHaveCount(1)
  const total = await page.getByTestId('score-row').count()

  const again = await importAndDraw('key-and-time-change.musicxml')
  expect(again).toBe(id)
  await expect(row).toHaveCount(1)
  await expect(page.getByTestId('score-row')).toHaveCount(total)

  expect(launched.networkRequests).toEqual([])
})

test('cancelling the dialog leaves the library alone', async () => {
  launched = await launchApp()
  const { page } = launched
  await openScoreView()

  await importAndDraw('scale-c-major.musicxml')
  const before = await page.getByTestId('score-row').count()

  await chooseFile(launched.app, null)
  await page.getByTestId('score-import').click()

  await expect(page.getByTestId('score-row')).toHaveCount(before)
  await expect(page.getByTestId('osmd-paper')).toBeVisible()
})

test('a bar marks on command, and only that bar', async () => {
  launched = await launchApp()
  const { page } = launched
  await openScoreView()
  await importAndDraw('scale-c-major.musicxml')

  const marks = page.getByTestId('bar-mark')
  const drawn = await marks.count()
  expect(drawn).toBe(4)
  await expect(marks.filter({ has: page.locator('[data-state="highlight"]') })).toHaveCount(0)

  for (const bar of [0, 2, 3]) {
    await page.getByTestId('highlight-bar').fill(String(bar))
    const highlighted = page.locator('[data-testid="bar-mark"][data-state="highlight"]')
    await expect(highlighted).toHaveCount(1)
    await expect(highlighted).toHaveAttribute('data-bar', String(bar))
    // Colour is never the only carrier: the mark says which bar it is.
    await expect(highlighted).toContainText(`bar ${bar}`)
    await expect(highlighted).toHaveAttribute('aria-label', `Bar ${bar}: bar ${bar}`)
  }

  await page.getByTestId('highlight-clear').click()
  await expect(page.locator('[data-testid="bar-mark"][data-state="highlight"]')).toHaveCount(0)

  // Clicking a bar selects it, which is how the player reaches a passage.
  await marks.nth(1).click()
  const clicked = page.locator('[data-testid="bar-mark"][data-state="highlight"]')
  await expect(clicked).toHaveCount(1)
  await expect(clicked).toHaveAttribute('data-bar', '1')

  expect(launched.networkRequests).toEqual([])
})

test('a bar mark sits on the box OSMD drew for that bar', async () => {
  launched = await launchApp()
  const { page } = launched
  await openScoreView()
  await importAndDraw('scale-c-major.musicxml')

  // The marks come off OSMD's own graphical measures, so they must read as
  // four bars in order across the page: each one non-degenerate, none
  // overlapping the next, and every one inside the drawn sheet.
  const boxes = await page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="osmd-host"] svg')?.getBoundingClientRect()
    return {
      sheet: sheet === undefined ? null : { left: sheet.left, right: sheet.right },
      marks: [...document.querySelectorAll('[data-testid="bar-mark"]')].map((el) => {
        const rect = el.getBoundingClientRect()
        return { bar: Number(el.getAttribute('data-bar')), left: rect.left, right: rect.right, width: rect.width }
      }),
    }
  })

  expect(boxes.sheet).not.toBeNull()
  expect(boxes.marks.map((m) => m.bar)).toEqual([0, 1, 2, 3])
  for (const mark of boxes.marks) {
    expect(mark.width).toBeGreaterThan(0)
    expect(mark.left).toBeGreaterThanOrEqual((boxes.sheet?.left ?? 0) - 1)
    expect(mark.right).toBeLessThanOrEqual((boxes.sheet?.right ?? 0) + 1)
  }
  for (let i = 1; i < boxes.marks.length; i++) {
    const previous = boxes.marks[i - 1]
    const current = boxes.marks[i]
    if (previous === undefined || current === undefined) continue
    expect(current.left).toBeGreaterThanOrEqual(previous.left)
  }
})

test('the committed timelines still match what the app extracts', async () => {
  test.setTimeout(120_000)
  launched = await launchApp()
  const { page } = launched
  await openScoreView()

  // ADR-0005's standing check. The adapter reads OSMD's parsed model, which is
  // a semi-public API that has moved between versions, so an upgrade that
  // changes the model has to fail here rather than quietly renumber bars in a
  // practice report. A failure is read, not regenerated away.
  const stale: string[] = []

  for (const fixture of FIXTURE_SCORES) {
    await importAndDraw(fixture.file)
    await page.getByTestId('timeline-details').evaluate((el: HTMLDetailsElement) => {
      el.open = true
    })
    const extracted = await page.getByTestId('timeline-json').textContent()
    expect(extracted).not.toBeNull()

    const path = timelinePath(fixture.file)
    if (REGENERATING) {
      writeFileSync(path, extracted as string, 'utf8')
      continue
    }

    expect(existsSync(path), `${path} is missing; see scripts/regen-score-timelines.md`).toBe(true)
    if (readFileSync(path, 'utf8') !== extracted) stale.push(fixture.file)
  }

  expect(
    stale,
    'the app now extracts a different timeline for these scores; read the diff before regenerating'
  ).toEqual([])

  expect(launched.networkRequests).toEqual([])
})

test('a written piece plays itself into a take, through the ports view', async () => {
  launched = await launchApp()
  const { page } = launched
  await waitForPortsView(page)

  // The whole loop with nothing plugged in (ADR-0004): the app plays a score
  // it holds a timeline for, through the same parse, record and paint path a
  // player's CK88 feeds, and a take exists at the end of it to be aligned.
  await openScenario(page, 'virtual:score:pickup-two-hands')
  const received = await waitForEvents(page, 38)
  await page.getByRole('button', { name: 'Close port' }).click()

  await page.getByTestId('nav-takes').click()
  const row = page.getByTestId('take-row').first()
  await expect(row).toContainText('virtual:score:pickup-two-hands')
  await expect(row).toContainText('Generated')

  const takeId = await row.getAttribute('data-take-id')
  const onDisk = await page.evaluate(
    async (id) => (await window.api.take.load(id as string)).events.length,
    takeId
  )
  expect(onDisk).toBe(received)

  expect(launched.networkRequests).toEqual([])
})

test('a MIDI file imports as a score with a bar list instead of an engraving', async () => {
  launched = await launchApp()
  const { page } = launched
  await openScoreView()

  await importAndDraw('scale-c-major.mid')

  // No engraving, by decision rather than by omission (ADR-0003): what the app
  // knows about a MIDI file is the notes and the bars, and that is what it
  // shows.
  await expect(page.getByTestId('bar-list')).toBeVisible()
  await expect(page.getByTestId('osmd-host')).toHaveCount(0)
  await expect(page.getByTestId('bar-list')).toContainText('no engraving to show')

  // Four bars, the same four the MusicXML of the same music produces.
  const bars = page.getByTestId('bar-mark')
  await expect(bars).toHaveCount(4)
  await expect(page.getByTestId('bar-count')).toHaveAttribute('data-bars', '4')

  // The same marking and the same selection as the engraved view.
  await page.getByTestId('highlight-bar').fill('2')
  const marked = page.locator('[data-testid="bar-mark"][data-state="highlight"]')
  await expect(marked).toHaveCount(1)
  await expect(marked).toHaveAttribute('data-bar', '2')

  await bars.nth(3).click()
  await expect(page.locator('[data-testid="bar-mark"][data-state="highlight"]')).toHaveAttribute(
    'data-bar',
    '3'
  )

  // Quantisation is stated, not implied.
  await expect(page.getByTestId('quantise')).toBeVisible()
  await expect(page.getByTestId('quantise')).toHaveValue('0.25')

  expect(launched.networkRequests).toEqual([])
})

test('a compressed .mxl reads as the same music as the .musicxml inside it', async () => {
  launched = await launchApp()
  const { page } = launched
  await openScoreView()

  /**
   * The only automated check the compressed path has, and it can only live
   * here. A `.mxl` is a zip that OSMD unpacks with JSZip, and JSZip cannot read
   * a jsdom `Blob` -- so the jsdom test that covers the adapter for every other
   * fixture is blind to this one, and reports a valid file as a corrupt zip.
   * Chromium's `Blob` is fine, which is what makes the end-to-end run the only
   * place the claim "we read .mxl" can be tested at all.
   *
   * `pickup-two-hands.mxl` is the committed `pickup-two-hands.musicxml`, zipped:
   * same music, different bytes, therefore a different score id. So the two must
   * produce timelines that differ in exactly one field.
   */
  await importAndDraw('pickup-two-hands.musicxml')
  const plain = JSON.parse(
    (await page.getByTestId('timeline-json').textContent()) as string
  ) as { scoreId: string; notes: unknown[]; bars: unknown[] }

  const zippedId = await importAndDraw('pickup-two-hands.mxl')
  await expect(page.getByTestId('osmd-host').locator('svg')).toBeVisible()
  await expect(page.getByTestId('bar-count')).toHaveAttribute('data-bars', '4')

  const zipped = JSON.parse(
    (await page.getByTestId('timeline-json').textContent()) as string
  ) as { scoreId: string; notes: unknown[]; bars: unknown[] }

  expect(zipped.notes).toEqual(plain.notes)
  expect(zipped.bars).toEqual(plain.bars)
  expect(zipped.scoreId).toBe(zippedId)
  expect(zipped.scoreId).not.toBe(plain.scoreId)

  // It is its own library entry, and it says what it came from.
  const row = page.locator(`[data-testid="score-row"][data-score-id="${zippedId}"]`)
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('pickup-two-hands.mxl')

  expect(launched.networkRequests).toEqual([])
})
