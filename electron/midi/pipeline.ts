import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { MidiEvent } from '../../shared/midi'
import type { MidiSource } from './MidiSource'
import { MidiParser } from './parse'
import type { Recorder } from '../take/Recorder'

/**
 * One place where a source becomes events on the renderer's screen and lines
 * in a take file: open a source, parse its bytes, forward, record.
 *
 * It exists as its own thing because three callers open a source -- the ports
 * view, the harness and a take replay -- and the whole claim that replay "is
 * not a second code path" is only true if all three go through the same
 * fifteen lines.
 *
 * Forward, then record. Neither waits on the other and neither drops (NFR 2);
 * the recorder's own flush is what keeps disk off the arrival path.
 */
export interface OpenOptions {
  source: MidiSource
  portId: string
  portName: string
  /** A replay is not recorded: it is already a recording. */
  record: boolean
}

export interface MidiPipeline {
  open(options: OpenOptions): Promise<void>
  close(): Promise<void>
  readonly openPortId: string | null
}

export interface PipelineDeps {
  getWindow: () => BrowserWindow | null
  recorder: Recorder
  appVersion: string
  takesDirectory: () => string
}

export function createMidiPipeline(deps: PipelineDeps): MidiPipeline {
  let active: MidiSource | null = null
  let unsubscribe: (() => void) | null = null
  let openPortId: string | null = null

  const send = (event: MidiEvent): void => {
    const window = deps.getWindow()
    if (window === null || window.isDestroyed()) return
    // Not validated on the way out: the payload was built from a parsed byte
    // stream by code in this process. The preload parses it on receive, which
    // is the boundary that matters.
    window.webContents.send(IPC_CHANNELS.MIDI_EVENT, event)
  }

  const close = async (): Promise<void> => {
    unsubscribe?.()
    unsubscribe = null
    if (active !== null) await active.close()
    active = null
    openPortId = null
    deps.recorder.stop()
  }

  const open = async (options: OpenOptions): Promise<void> => {
    await close()

    // One parser per open source: running status is per stream, and a stale
    // status carried across a reopen would mis-read the first bare data byte.
    const parser = new MidiParser()

    if (options.record) {
      deps.recorder.start({
        directory: deps.takesDirectory(),
        port: options.portId,
        portName: options.portName,
        appVersion: deps.appVersion,
      })
    }

    unsubscribe = options.source.onMessage((bytes, t) => {
      for (const event of parser.parse(bytes, t)) {
        send(event)
        if (options.record) deps.recorder.append(event)
      }
    })

    try {
      await options.source.open(options.portId)
    } catch (err) {
      await close()
      throw err
    }
    active = options.source
    openPortId = options.portId
  }

  return {
    open,
    close,
    get openPortId() {
      return openPortId
    },
  }
}
