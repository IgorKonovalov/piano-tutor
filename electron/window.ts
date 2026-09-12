import { BrowserWindow, app, session, shell } from 'electron'
import { join } from 'node:path'
import { type HarnessGate, virtualPortsEnabled } from './midi/virtualPorts'

/**
 * The policy has **no `connect-src`** (ADR-0001): the renderer makes no network
 * request, so `default-src 'self'` is the whole story and a directive that
 * admits an origin would be an unused hole. While Vite is serving, its origin
 * is named in `default-src` instead, which is what keeps HMR's WebSocket alive
 * without introducing the directive we do not want shipped.
 *
 * `'unsafe-inline'` in `script-src` exists only while Vite is serving, for its
 * HMR client. Never `'unsafe-eval'`.
 *
 * The flag is **"is Vite serving this window"**, not "is the build unpackaged".
 * Those are different questions, and using the second for the first cost us
 * both halves: the end-to-end run drives a built renderer loaded from `file:`
 * out of an unpackaged tree, so it -- and every `electron .` run from source --
 * got a relaxation it has no use for, while the strict policy was left
 * installed by nothing any check runs.
 */
const DEV_ORIGIN = 'http://localhost:5173'

export function csp(viteServing: boolean): string {
  const directives = [
    viteServing ? `default-src 'self' ${DEV_ORIGIN} ws://localhost:5173` : "default-src 'self'",
    viteServing ? `script-src 'self' 'unsafe-inline' ${DEV_ORIGIN}` : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ]
  return directives.join('; ')
}

/**
 * Half of the double CSP; the other half is the `<meta>` in index.html. Both,
 * not one: the meta survives a header a proxy strips, and the header overrides
 * the policy Vite's dev server sends. Vite writes the header in lower case, so
 * the strip is case-insensitive or ours is appended to a policy we did not
 * write and the intersection blocks the app.
 */
export function installCsp(viteServing: boolean): void {
  const policy = csp(viteServing)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-security-policy') delete headers[key]
    }
    headers['Content-Security-Policy'] = [policy]
    callback({ responseHeaders: headers })
  })
}

export interface RendererPaths {
  preloadPath: string
  rendererFile: string
  iconFile: string
}

/**
 * `app.getAppPath()` is the directory holding the manifest whose `main` field
 * loaded us: the repository root in dev, the asar root packaged. Both put the
 * three bundles under `dist/`, so one expression serves both.
 *
 * The icon is the exception, and takes the same "is Vite serving" flag the CSP
 * does. It is one file -- `renderer/public/icon.png`, the same mark as the
 * page favicon beside it -- that Vite copies verbatim into `dist/renderer/`,
 * but only at build. While Vite is serving there is no `dist/renderer/`, so
 * that run reads the source copy out of the unpackaged tree instead.
 */
export function getRendererPaths(viteServing: boolean): RendererPaths {
  const appPath = app.getAppPath()
  return {
    preloadPath: join(appPath, 'dist', 'preload', 'index.cjs'),
    rendererFile: join(appPath, 'dist', 'renderer', 'index.html'),
    iconFile: viteServing
      ? join(appPath, 'renderer', 'public', 'icon.png')
      : join(appPath, 'dist', 'renderer', 'icon.png'),
  }
}

export interface HarnessWindowOptions {
  /**
   * Chromium throttles `requestAnimationFrame` to about 1 Hz in a window it
   * cannot see. Several harness windows at once means all but one is covered,
   * so the suite would be timing a throttle rather than the app.
   *
   * This is **not** one of the security defaults (ADR-0001 names four:
   * `contextIsolation`, `sandbox`, `nodeIntegration`, `webSecurity`, and every
   * one of them is unchanged here). It decides how often a window paints, and
   * nothing about what it may reach.
   */
  backgroundThrottling: boolean
}

/**
 * ADR-0004's gate, and no second one: the same expression that decides whether
 * generated ports are enumerated decides this. A packaged build with
 * `PT_HARNESS` unset is throttled like any other application.
 *
 * The gate does **not** decide whether the window shows itself, though the
 * suite would rather it did not. Measured on Electron 44, 2026-09-12: a window
 * that is never shown does not lay out, whatever its throttling says. Eleven
 * cases went red that way, among them `score.spec.ts` "each fixture score
 * imports and draws", where a row carried the previous score's title while
 * already carrying the new score's id. So every window is shown, and it is
 * throttling alone that stops a covered one from mattering.
 */
export function harnessWindowOptions(gate: HarnessGate): HarnessWindowOptions {
  return { backgroundThrottling: !virtualPortsEnabled(gate) }
}

export interface CreateWindowOptions extends RendererPaths {
  /** Set when Vite is serving; unset means load the built file. */
  rendererUrl?: string | undefined
  harness: HarnessWindowOptions
}

export function createWindow(opts: CreateWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    backgroundColor: '#14161a',
    title: 'piano-tutor',
    icon: opts.iconFile,
    webPreferences: {
      preload: opts.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: opts.harness.backgroundThrottling,
    },
  })

  window.once('ready-to-show', () => window.show())

  // Nothing in this app navigates. An external link opens in the user's
  // browser; anything else is denied rather than loaded into the shell.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  if (opts.rendererUrl !== undefined) {
    void window.loadURL(opts.rendererUrl)
  } else {
    void window.loadFile(opts.rendererFile)
  }

  return window
}
