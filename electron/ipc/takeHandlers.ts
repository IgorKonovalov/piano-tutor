import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import {
  TakeContentSchema,
  TakeIdSchema,
  TakeReplayRequestSchema,
  TakeSummaryListSchema,
} from '../../shared/take'
import { ReplaySource, replayPortId } from '../midi/ReplaySource'
import type { MidiPipeline } from '../midi/pipeline'
import { listTakes, readTake, takePath } from '../take/takeFile'
import { serialise } from './serial'

export interface TakeHandlerDeps {
  pipeline: MidiPipeline
  takesDirectory: () => string
}

/**
 * The `take:*` domain. Replay goes through the same pipeline a device does,
 * so the live view cannot tell a played take from a played piano; what it does
 * not do is record itself, which would be a recording of a recording.
 */
export function registerTakeHandlers(deps: TakeHandlerDeps): void {
  ipcMain.handle(IPC_CHANNELS.TAKE_LIST, async () => {
    return TakeSummaryListSchema.parse(listTakes(deps.takesDirectory()))
  })

  ipcMain.handle(IPC_CHANNELS.TAKE_LOAD, async (_event, payload: unknown) => {
    const { id } = TakeIdSchema.parse(payload)
    return TakeContentSchema.parse(readTake(takePath(deps.takesDirectory(), id)))
  })

  ipcMain.handle(IPC_CHANNELS.TAKE_REPLAY, async (_event, payload: unknown) => {
    const { id, speed } = TakeReplayRequestSchema.parse(payload)
    const path = takePath(deps.takesDirectory(), id)
    return serialise(() =>
      deps.pipeline.open({
        source: new ReplaySource({ path, speed }),
        portId: replayPortId(id),
        portName: `Replay of ${id}`,
        record: false,
      })
    )
  })

  ipcMain.handle(IPC_CHANNELS.TAKE_STOP_REPLAY, async () => {
    await serialise(() => deps.pipeline.close())
  })
}

export function cleanupTakeHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.TAKE_LIST)
  ipcMain.removeHandler(IPC_CHANNELS.TAKE_LOAD)
  ipcMain.removeHandler(IPC_CHANNELS.TAKE_REPLAY)
  ipcMain.removeHandler(IPC_CHANNELS.TAKE_STOP_REPLAY)
}
