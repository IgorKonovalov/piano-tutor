import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type LaunchedApp, launchApp, repoRoot, waitForPortsView } from './harness'

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

const FIXTURES = join(repoRoot, 'core', 'fixtures', 'scores')

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

/** Point main's open dialog at a fixture, as the operating system would. */
async function chooseFile(app: LaunchedApp['app'], path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, filePath) => {
    Object.assign(dialog, {
      showOpenDialog: async () =>
        filePath === null
          ? { canceled: true, filePaths: [] }
          : { canceled: false, filePaths: [filePath] },
    })
  }, path)
}

async function openScoreView(): Promise<void> {
  await waitForPortsView(launched.page)
  await launched.page.getByTestId('nav-score').click()
  await expect(launched.page.getByTestId('score-view')).toBeVisible()
}

/** Import the chosen file and wait for the Score view to have drawn it. */
async function importAndDraw(file: string): Promise<string> {
  const { page } = launched
  await chooseFile(launched.app, join(FIXTURES, file))
  await page.getByTestId('score-import').click()

  // The id appears on the paper only once OSMD has parsed and drawn, so this
  // is also the wait for the render to finish.
  const paper = page.getByTestId('osmd-paper')
  await expect(paper).toBeVisible()
  await expect(paper).toHaveAttribute('data-score-id', /^[0-9a-f]{32}$/)
  return (await paper.getAttribute('data-score-id')) as string
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
