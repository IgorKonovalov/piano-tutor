import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import {
  type ScoreApi,
  ScoreContentSchema,
  ScoreImportResultSchema,
  ScoreMetaListSchema,
  ScoreMetaSchema,
} from '../../../shared/score'

export const score: ScoreApi = {
  async import() {
    return ScoreImportResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.SCORE_IMPORT))
  },

  async list() {
    return ScoreMetaListSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.SCORE_LIST))
  },

  async read(id: string) {
    return ScoreContentSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.SCORE_READ, { id }))
  },

  async setTitle(id: string, title: string) {
    return ScoreMetaSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.SCORE_SET_TITLE, { id, title })
    )
  },
}
