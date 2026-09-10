import { type IpcRendererEvent, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { MidiEventSchema, MidiPortListSchema } from '../../../shared/midi'
import {
  type PlayRequest,
  type PlayerApi,
  PlayerStateSchema,
} from '../../../shared/player'

export const player: PlayerApi = {
  async listOutputs() {
    return MidiPortListSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.PLAYER_LIST_OUTPUTS))
  },

  async openOutput(portId: string) {
    await ipcRenderer.invoke(IPC_CHANNELS.PLAYER_OPEN_OUTPUT, { portId })
  },

  async closeOutput() {
    await ipcRenderer.invoke(IPC_CHANNELS.PLAYER_CLOSE_OUTPUT)
  },

  async play(request: PlayRequest) {
    await ipcRenderer.invoke(IPC_CHANNELS.PLAYER_PLAY, request)
  },

  async stop() {
    await ipcRenderer.invoke(IPC_CHANNELS.PLAYER_STOP)
  },

  onEvent(cb) {
    // Its own channel, not `midi:event` (ADR-0007): the recorder listens to
    // the source, so nothing arriving here can ever reach a take file.
    const handler = (_event: IpcRendererEvent, raw: unknown) => cb(MidiEventSchema.parse(raw))
    ipcRenderer.on(IPC_CHANNELS.PLAYER_EVENT, handler)
    return () => {
      ipcRenderer.off(IPC_CHANNELS.PLAYER_EVENT, handler)
    }
  },

  onState(cb) {
    const handler = (_event: IpcRendererEvent, raw: unknown) => cb(PlayerStateSchema.parse(raw))
    ipcRenderer.on(IPC_CHANNELS.PLAYER_STATE, handler)
    return () => {
      ipcRenderer.off(IPC_CHANNELS.PLAYER_STATE, handler)
    }
  },
}
