import { type ElectronApplication, type Page, _electron as electron, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/**
 * Launching the app for the end-to-end run.
 *
 * This is the only file that knows about `PT_HARNESS`. Keeping it here means a
 * future test of a packaged build cannot set it by accident, and that the gate
 * of ADR-0004 stays a decision the app makes rather than one the suite makes
 * for it.
 *
 * The app is driven exactly as a player drives it: through the port list. There
 * is no injection channel and no test hook in the renderer -- the harness picks
 * a `virtual:` port and everything after that is the real pipeline.
 */

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export interface LaunchOptions {
  /**
   * Defaults to true. False sets `PT_HARNESS=0`, which shuts the gate
   * explicitly even though the build under test is unpackaged.
   */
  harness?: boolean
}

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  /** Every http, https or ws request the renderer attempted. Must stay empty. */
  networkRequests: string[]
  /** Epoch milliseconds at which the main process was created. */
  processCreatedAt: number
  /** The state directory this launch owns, made for it and removed with it. */
  userDataDir: string
  close(): Promise<void>
}

export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  env.PT_HARNESS = options.harness === false ? '0' : '1'

  /**
   * Every launch reads and writes its own scores, takes and settings, so one
   * case cannot see another's -- and the developer's own `npm run dev` state is
   * never touched by a test run either.
   *
   * Electron honours Chromium's `--user-data-dir` for `app.getPath('userData')`
   * (measured on Electron 44), so this needs nothing in main: there is no
   * harness-only path into the state directory to keep shut in a packaged build.
   */
  const userDataDir = mkdtempSync(join(tmpdir(), 'pt-e2e-'))
  const removeUserDataDir = () => {
    // A just-closed Electron can still hold a file open on Windows, hence the
    // retries. A directory left behind under the OS temp dir is harmless.
    try {
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    } catch {
      // Nothing to do about it, and nothing about the case it says.
    }
  }

  const app = await electron.launch({
    args: [repoRoot, `--user-data-dir=${userDataDir}`],
    cwd: repoRoot,
    env,
  })
  // A case that ends by closing the window never calls `close()`; the directory
  // still goes when the process it belonged to does.
  app.process().once('exit', removeUserDataDir)
  const page = await app.firstWindow()

  // NFR 3: nothing in the renderer reaches the network. Recorded from the
  // first window event, and the context is put offline as well so a request
  // that did happen would fail rather than quietly succeed.
  const networkRequests: string[] = []
  page.on('request', (request) => {
    if (/^(https?|wss?):/i.test(request.url())) networkRequests.push(request.url())
  })
  await page.context().setOffline(true)

  const processCreatedAt = await app.evaluate(() => process.getCreationTime() ?? 0)

  return {
    app,
    page,
    networkRequests,
    processCreatedAt,
    userDataDir,
    close: async () => {
      await app.close()
      removeUserDataDir()
    },
  }
}

/** The ports view is the app's first screen; everything starts here. */
export async function waitForPortsView(page: Page): Promise<void> {
  await expect(page.getByTestId('ports-view')).toBeVisible()
}

export interface WindowFlags {
  visible: boolean
  backgroundThrottling: boolean
}

/** Read from main, which is where the window and its flags actually live. */
export async function readWindowFlags(launched: LaunchedApp): Promise<WindowFlags> {
  return launched.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return {
      visible: window.isVisible(),
      backgroundThrottling: window.webContents.getBackgroundThrottling(),
    }
  })
}

/**
 * Only the measuring cases need this. Every other case runs against whatever
 * window happens to be covered, which is what lets several run at once: under
 * the harness gate a window is not throttled when it cannot be seen, so
 * `requestAnimationFrame` keeps its rate whoever is in front.
 */
export async function bringToFront(launched: LaunchedApp): Promise<void> {
  const window = await launched.app.browserWindow(launched.page)
  await window.evaluate((win) => {
    win.setAlwaysOnTop(true)
    win.show()
    win.focus()
  })
}

export interface OpenedScenario {
  /** Epoch milliseconds of the frame that first showed a key. */
  firstKeyPaintedAt: number
}

/** Select a generated port and wait until a key is actually lit. */
export async function openScenario(page: Page, scenarioId: string): Promise<OpenedScenario> {
  await page.locator(`[data-port-id="${scenarioId}"] [data-testid="port-open"]`).click()
  await expect(page.getByTestId('live-view')).toBeVisible()

  const firstKeyPaintedAt = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const check = () => {
          const keyboard = document.querySelector('[data-testid="keyboard"]')
          const sounding = Number(keyboard?.getAttribute('data-sounding') ?? 0)
          if (sounding > 0) resolve(performance.timeOrigin + performance.now())
          else requestAnimationFrame(check)
        }
        check()
      })
  )
  return { firstKeyPaintedAt }
}

/**
 * Point main's open dialog at a file, as the operating system would, and
 * import it. Nothing is added to the app to make this possible: the harness
 * stands where the file dialog stands (ADR-0004).
 */
export async function chooseFile(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, filePath) => {
    Object.assign(dialog, {
      showOpenDialog: async () =>
        filePath === null
          ? { canceled: true, filePaths: [] }
          : { canceled: false, filePaths: [filePath] },
    })
  }, path)
}

export const SCORE_FIXTURES = resolve(repoRoot, 'core', 'fixtures', 'scores')

/**
 * Import a fixture score and wait until the Score view has drawn **it**.
 *
 * The wait is on the drawn id matching the *selected* row's id, not merely on
 * an id being present. Between the click and the new bytes arriving, the
 * previous score is still on the page and its id is still a valid-looking
 * one; waiting on the shape alone reads that stale id and every assertion
 * after it is quietly about the wrong piece. The library selects what it just
 * imported, so the selected row is what the paper has to catch up to.
 */
export async function importScore(launched: LaunchedApp, file: string): Promise<string> {
  const { page } = launched
  await chooseFile(launched.app, resolve(SCORE_FIXTURES, file))
  await page.getByTestId('score-import').click()

  const selected = page.locator('[data-testid="score-row"][aria-current="true"]')
  await expect(selected).toHaveCount(1)
  const id = await selected.getAttribute('data-score-id')
  expect(id).toMatch(/^[0-9a-f]{32}$/)

  const paper = page.getByTestId('osmd-paper')
  await expect(paper).toBeVisible()
  await expect(paper).toHaveAttribute('data-score-id', id as string, { timeout: 20_000 })
  return id as string
}

/** The Score view is behind its own tab; everything score-shaped starts here. */
export async function openScoreView(launched: LaunchedApp): Promise<void> {
  await waitForPortsView(launched.page)
  await launched.page.getByTestId('nav-score').click()
  await expect(launched.page.getByTestId('score-view')).toBeVisible()
}

export async function eventsReceived(page: Page): Promise<number> {
  return Number(await page.getByTestId('event-log').getAttribute('data-received'))
}

/** Wait until the whole passage has arrived, or fail saying how far it got. */
export async function waitForEvents(page: Page, expected: number, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  let received = 0
  while (Date.now() < deadline) {
    received = await eventsReceived(page)
    if (received >= expected) return received
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`only ${received} of ${expected} events arrived`)
}

export interface LatencyReading {
  samples: number
  frameP50: number
  frameP95: number
  frameMax: number
  msP50: number
  msP95: number
  msMax: number
}

export async function readLatency(page: Page): Promise<LatencyReading> {
  const number = async (testId: string) =>
    Number((await page.getByTestId(testId).textContent())?.trim())
  return {
    samples: Number(await page.getByTestId('latency-overlay').getAttribute('data-samples')),
    frameP50: await number('frame-p50'),
    frameP95: await number('frame-p95'),
    frameMax: await number('frame-max'),
    msP50: await number('ms-p50'),
    msP95: await number('ms-p95'),
    msMax: await number('ms-max'),
  }
}
