import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { MidiPortListSchema } from '../../shared/midi'
import type { MidiSource } from '../midi/MidiSource'

export interface MidiHandlerDeps {
  source: MidiSource
}

/**
 * The `midi:*` domain. Payloads are parsed with Zod on receive; the port list
 * is parsed on the way out too, because it is assembled from a native call and
 * a static table and the renderer's contract is the schema, not either source.
 */
export function registerMidiHandlers(deps: MidiHandlerDeps): void {
  ipcMain.handle(IPC_CHANNELS.MIDI_LIST_PORTS, async () => {
    return MidiPortListSchema.parse(await deps.source.listPorts())
  })
}

export function cleanupMidiHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.MIDI_LIST_PORTS)
}
