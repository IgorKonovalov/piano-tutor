import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { type TakeApi, TakeContentSchema, TakeSummaryListSchema } from '../../../shared/take'

export const take: TakeApi = {
  async list() {
    return TakeSummaryListSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.TAKE_LIST))
  },

  async load(id: string) {
    return TakeContentSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.TAKE_LOAD, { id }))
  },

  async replay(id: string, speed: number) {
    await ipcRenderer.invoke(IPC_CHANNELS.TAKE_REPLAY, { id, speed })
  },

  async stopReplay() {
    await ipcRenderer.invoke(IPC_CHANNELS.TAKE_STOP_REPLAY)
  },
}
