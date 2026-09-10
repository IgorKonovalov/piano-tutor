import { type BrowserWindow, app } from 'electron'
import { createWindow, getRendererPaths, installCsp } from './window'
import { cleanupMidiHandlers, registerMidiHandlers } from './ipc/midiHandlers'
import { cleanupScoreHandlers, registerScoreHandlers } from './ipc/scoreHandlers'
import { cleanupTakeHandlers, registerTakeHandlers } from './ipc/takeHandlers'
import { createMidiPipeline } from './midi/pipeline'
import { RtMidiSource } from './midi/RtMidiSource'
import { SyntheticSource } from './midi/SyntheticSource'
import { scoresDirectory } from './score/library'
import { Recorder } from './take/Recorder'
import { takesDirectory } from './take/takeFile'

/**
 * Lifecycle: whenReady -> installCsp -> registerIpcHandlers -> createWindow.
 * The CSP goes in before any content loads; the handlers before the window can
 * call one.
 */
app.setName('piano-tutor')

if (process.platform === 'win32') {
  app.setAppUserModelId('io.pianotutor.desktop')
}

let mainWindow: BrowserWindow | null = null

const gate = {
  get isPackaged() {
    return app.isPackaged
  },
  env: process.env,
}
const rtMidi = new RtMidiSource(gate)
const synthetic = new SyntheticSource(gate)
const recorder = new Recorder()

// userData is only resolvable once Electron is ready, so the directory is a
// function rather than a value.
const takesDir = () => takesDirectory(app.getPath('userData'))
const scoresDir = () => scoresDirectory(app.getPath('userData'))

const pipeline = createMidiPipeline({
  getWindow: () => mainWindow,
  recorder,
  appVersion: app.getVersion(),
  takesDirectory: takesDir,
})

void app.whenReady().then(() => {
  // The CSP relaxation exists for Vite's HMR client and nothing else, so the
  // question it answers is whether Vite is serving this window -- the same
  // value that decides whether the window loads a URL or a built file. An
  // unpackaged build is not the same question and must not stand in for it.
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  installCsp(rendererUrl !== undefined)
  registerMidiHandlers({ pipeline, rtMidi, synthetic })
  registerTakeHandlers({ pipeline, takesDirectory: takesDir })
  registerScoreHandlers({ getWindow: () => mainWindow, scoresDirectory: scoresDir })

  const paths = getRendererPaths()
  mainWindow = createWindow({ ...paths, rendererUrl })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // Flush and close the take before the process goes; a kill that skips this
  // still loses at most the last flush interval (NFR 8).
  void pipeline.close()
  cleanupMidiHandlers()
  cleanupTakeHandlers()
  cleanupScoreHandlers()
})
