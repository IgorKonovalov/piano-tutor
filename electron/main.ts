import { type BrowserWindow, app } from 'electron'
import { createWindow, getRendererPaths, installCsp } from './window'
import { cleanupMidiHandlers, registerMidiHandlers } from './ipc/midiHandlers'
import { RtMidiSource } from './midi/RtMidiSource'
import { SyntheticSource } from './midi/SyntheticSource'

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

void app.whenReady().then(() => {
  const isDev = !app.isPackaged
  installCsp(isDev)
  registerMidiHandlers({ rtMidi, synthetic, getWindow: () => mainWindow })

  const paths = getRendererPaths()
  mainWindow = createWindow({
    ...paths,
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void cleanupMidiHandlers()
})
