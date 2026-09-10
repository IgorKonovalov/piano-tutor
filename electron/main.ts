import { type BrowserWindow, app } from 'electron'
import { createWindow, getRendererPaths, installCsp } from './window'
import { cleanupMidiHandlers, registerMidiHandlers } from './ipc/midiHandlers'
import { cleanupPlayerHandlers, registerPlayerHandlers } from './ipc/playerHandlers'
import { cleanupScoreHandlers, registerScoreHandlers } from './ipc/scoreHandlers'
import { cleanupTakeHandlers, registerTakeHandlers } from './ipc/takeHandlers'
import { createMidiPipeline } from './midi/pipeline'
import { NullSink } from './midi/NullSink'
import { RtMidiSink } from './midi/RtMidiSink'
import { RtMidiSource } from './midi/RtMidiSource'
import { SyntheticSource } from './midi/SyntheticSource'
import { Player } from './player/Player'
import { scoresDirectory } from './score/library'
import { Recorder } from './take/Recorder'
import { takesDirectory } from './take/takeFile'
import { IPC_CHANNELS } from '../shared/ipc-channels'

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

const output = new RtMidiSink()
const silence = new NullSink()

/**
 * Pushed to the window, never to the recorder (ADR-0007). The recorder
 * subscribes to a `MidiSource`, and the player is not one, so a take cannot
 * contain notes the player did not play; the way that stays true is that
 * nothing here is wired into the pipeline at all.
 */
const sendToWindow = (channel: string, payload: unknown): void => {
  if (mainWindow === null || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

const player = new Player({
  sink: silence,
  onEvent: (event) => sendToWindow(IPC_CHANNELS.PLAYER_EVENT, event),
  onState: (state) => sendToWindow(IPC_CHANNELS.PLAYER_STATE, state),
})

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
  registerPlayerHandlers({ player, output, silence, gate, takesDirectory: takesDir })

  const paths = getRendererPaths(rendererUrl !== undefined)
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
  // Silence before anything else: a chord left sounding outlives this process
  // on the instrument, which no later cleanup can undo.
  player.stop()
  void output.close()
  cleanupMidiHandlers()
  cleanupTakeHandlers()
  cleanupScoreHandlers()
  cleanupPlayerHandlers()
})
