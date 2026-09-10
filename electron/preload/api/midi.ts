import { type IpcRendererEvent, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { type MidiApi, MidiEventSchema, MidiPortListSchema } from '../../../shared/midi'

export const midi: MidiApi = {
  async listPorts() {
    return MidiPortListSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.MIDI_LIST_PORTS))
  },

  async open(portId: string) {
    await ipcRenderer.invoke(IPC_CHANNELS.MIDI_OPEN, { portId })
  },

  async close() {
    await ipcRenderer.invoke(IPC_CHANNELS.MIDI_CLOSE)
  },

  onEvent(cb) {
    // The returned cleanup is the contract. A listener registered without one
    // survives the component that made it and fires twice after a hot reload.
    const handler = (_event: IpcRendererEvent, raw: unknown) => cb(MidiEventSchema.parse(raw))
    ipcRenderer.on(IPC_CHANNELS.MIDI_EVENT, handler)
    return () => {
      ipcRenderer.off(IPC_CHANNELS.MIDI_EVENT, handler)
    }
  },
}
