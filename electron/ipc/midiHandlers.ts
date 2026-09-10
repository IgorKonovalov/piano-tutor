import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { MidiOpenRequestSchema, MidiPortListSchema } from '../../shared/midi'
import type { MidiPipeline } from '../midi/pipeline'
import type { RtMidiSource } from '../midi/RtMidiSource'
import type { SyntheticSource } from '../midi/SyntheticSource'
import { findScenario, isVirtualPortId } from '../midi/virtualPorts'
import { serialise } from './serial'

export interface MidiHandlerDeps {
  pipeline: MidiPipeline
  rtMidi: RtMidiSource
  synthetic: SyntheticSource
}

/**
 * The `midi:*` domain: one invoke to list, two to open and close, and one push
 * carrying every event.
 *
 * A virtual port id routes to the synthetic source and a `hw:` id to RtMidi
 * (ADR-0004). That is the whole difference between the harness and the
 * instrument; everything downstream is the pipeline, the same either way.
 */
export function registerMidiHandlers(deps: MidiHandlerDeps): void {
  ipcMain.handle(IPC_CHANNELS.MIDI_LIST_PORTS, async () => {
    return MidiPortListSchema.parse(await deps.rtMidi.listPorts())
  })

  ipcMain.handle(IPC_CHANNELS.MIDI_OPEN, async (_event, payload: unknown) => {
    const { portId, scoreId } = MidiOpenRequestSchema.parse(payload)
    return serialise(async () => {
      const virtual = isVirtualPortId(portId)
      const ports = await deps.rtMidi.listPorts()
      await deps.pipeline.open({
        source: virtual ? deps.synthetic : deps.rtMidi,
        portId,
        portName:
          findScenario(portId)?.name ?? ports.find((p) => p.id === portId)?.name ?? portId,
        record: true,
        scoreId,
      })
    })
  })

  ipcMain.handle(IPC_CHANNELS.MIDI_CLOSE, async () => {
    await serialise(() => deps.pipeline.close())
  })
}

export function cleanupMidiHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.MIDI_LIST_PORTS)
  ipcMain.removeHandler(IPC_CHANNELS.MIDI_OPEN)
  ipcMain.removeHandler(IPC_CHANNELS.MIDI_CLOSE)
}
