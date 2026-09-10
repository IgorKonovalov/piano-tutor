import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { type MidiApi, MidiPortListSchema } from '../../../shared/midi'

export const midi: MidiApi = {
  async listPorts() {
    return MidiPortListSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.MIDI_LIST_PORTS))
  },
}
