import { type BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { type MidiEvent, MidiOpenRequestSchema, MidiPortListSchema } from '../../shared/midi'
import type { MidiSource } from '../midi/MidiSource'
import { MidiParser } from '../midi/parse'
import type { RtMidiSource } from '../midi/RtMidiSource'
import type { SyntheticSource } from '../midi/SyntheticSource'
import { isVirtualPortId } from '../midi/virtualPorts'

export interface MidiHandlerDeps {
  rtMidi: RtMidiSource
  synthetic: SyntheticSource
  getWindow: () => BrowserWindow | null
}

/**
 * The `midi:*` domain: one invoke to list, two to open and close, and one push
 * carrying every event.
 *
 * A virtual port id routes to the synthetic source and a `hw:` id to RtMidi
 * (ADR-0004). That is the whole difference between the harness and the
 * instrument; everything downstream of `onMessage` -- the parser, the stamp,
 * the push, the renderer -- is the same code either way.
 */
export function registerMidiHandlers(deps: MidiHandlerDeps): void {
  let active: MidiSource | null = null
  let unsubscribe: (() => void) | null = null

  /**
   * Open and close run one at a time. Both are async and the renderer can send
   * them back to back -- React's development double-mount sends open, close,
   * open within a frame -- so without a queue a close can land after the open
   * it was meant to precede and leave the device shut while the view believes
   * it is listening.
   */
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => undefined)
    return run
  }

  const send = (event: MidiEvent): void => {
    const window = deps.getWindow()
    if (window === null || window.isDestroyed()) return
    // Not validated on the way out: the payload was built from a parsed byte
    // stream by code in this process. The preload parses it on receive, which
    // is the boundary that matters.
    window.webContents.send(IPC_CHANNELS.MIDI_EVENT, event)
  }

  const closeActive = async (): Promise<void> => {
    unsubscribe?.()
    unsubscribe = null
    if (active !== null) await active.close()
    active = null
  }

  ipcMain.handle(IPC_CHANNELS.MIDI_LIST_PORTS, async () => {
    return MidiPortListSchema.parse(await deps.rtMidi.listPorts())
  })

  ipcMain.handle(IPC_CHANNELS.MIDI_OPEN, async (_event, payload: unknown) => {
    const { portId } = MidiOpenRequestSchema.parse(payload)
    return serial(async () => {
      await closeActive()

      const source: MidiSource = isVirtualPortId(portId) ? deps.synthetic : deps.rtMidi
      // One parser per open port: running status is per stream, and a stale
      // status carried across a reopen would mis-read the first bare data byte.
      const parser = new MidiParser()

      unsubscribe = source.onMessage((bytes, t) => {
        for (const parsed of parser.parse(bytes, t)) send(parsed)
      })

      try {
        await source.open(portId)
      } catch (err) {
        await closeActive()
        throw err
      }
      active = source
    })
  })

  ipcMain.handle(IPC_CHANNELS.MIDI_CLOSE, async () => {
    await serial(closeActive)
  })

  cleanup = async () => {
    await closeActive()
    ipcMain.removeHandler(IPC_CHANNELS.MIDI_LIST_PORTS)
    ipcMain.removeHandler(IPC_CHANNELS.MIDI_OPEN)
    ipcMain.removeHandler(IPC_CHANNELS.MIDI_CLOSE)
  }
}

let cleanup: (() => Promise<void>) | null = null

export async function cleanupMidiHandlers(): Promise<void> {
  await cleanup?.()
  cleanup = null
}
