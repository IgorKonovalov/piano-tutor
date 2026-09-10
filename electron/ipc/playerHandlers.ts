import { ipcMain } from 'electron'
import { scheduleFromEvents, scheduleFromTimeline } from '../../core/src/player/schedule'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { MidiPortListSchema } from '../../shared/midi'
import {
  OpenOutputRequestSchema,
  type PlayRequest,
  PlayRequestSchema,
  type PlaybackSchedule,
} from '../../shared/player'
import { readTake, takePath } from '../take/takeFile'
import type { MidiSink } from '../midi/MidiSink'
import type { RtMidiSink } from '../midi/RtMidiSink'
import { type HarnessGate, findScenario, virtualPortsEnabled } from '../midi/virtualPorts'
import type { Player } from '../player/Player'
import { serialise } from './serial'

export interface PlayerHandlerDeps {
  player: Player
  output: RtMidiSink
  /** Where playback goes while no output port is chosen. */
  silence: MidiSink
  gate: HarnessGate
  /** Resolvable only once Electron is ready, so a function rather than a value. */
  takesDirectory: () => string
}

/**
 * The `player:*` domain (ADR-0007): the output port list, the transport, and
 * the two pushes the renderer draws from.
 *
 * The request is turned into a schedule **here, in main**, by the same `core/`
 * builder whatever the source is. The renderer asks for a piece of music; it
 * never assembles one.
 */
export function registerPlayerHandlers(deps: PlayerHandlerDeps): void {
  ipcMain.handle(IPC_CHANNELS.PLAYER_LIST_OUTPUTS, async () => {
    return MidiPortListSchema.parse(await deps.output.listPorts())
  })

  ipcMain.handle(IPC_CHANNELS.PLAYER_OPEN_OUTPUT, async (_event, payload: unknown) => {
    const { portId } = OpenOutputRequestSchema.parse(payload)
    await serialise(async () => {
      await deps.output.open(portId)
      deps.player.setSink(deps.output)
    })
  })

  ipcMain.handle(IPC_CHANNELS.PLAYER_CLOSE_OUTPUT, async () => {
    await serialise(async () => {
      // The player is moved off the port before the port is closed, so the
      // next event cannot arrive at a handle that is being destroyed.
      deps.player.setSink(deps.silence)
      await deps.output.close()
    })
  })

  ipcMain.handle(IPC_CHANNELS.PLAYER_PLAY, async (_event, payload: unknown) => {
    const request = PlayRequestSchema.parse(payload)
    deps.player.play(buildSchedule(request, deps))
  })

  ipcMain.handle(IPC_CHANNELS.PLAYER_STOP, async () => {
    deps.player.stop()
  })
}

export function cleanupPlayerHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.PLAYER_LIST_OUTPUTS)
  ipcMain.removeHandler(IPC_CHANNELS.PLAYER_OPEN_OUTPUT)
  ipcMain.removeHandler(IPC_CHANNELS.PLAYER_CLOSE_OUTPUT)
  ipcMain.removeHandler(IPC_CHANNELS.PLAYER_PLAY)
  ipcMain.removeHandler(IPC_CHANNELS.PLAYER_STOP)
}

function buildSchedule(request: PlayRequest, deps: PlayerHandlerDeps): PlaybackSchedule {
  switch (request.kind) {
    case 'scenario': {
      // The generated passages are a harness affordance and stay behind the
      // same gate that decides whether they are listed at all (ADR-0004). A
      // packaged build has nothing to play here and says so.
      if (!virtualPortsEnabled(deps.gate)) {
        throw new Error(`Generated passages are not available in this build: ${request.id}`)
      }
      const scenario = findScenario(request.id)
      if (scenario === undefined) {
        throw new Error(`No generated scenario is named ${request.id}`)
      }
      return scheduleFromEvents(scenario.generate(), { kind: 'scenario', id: request.id })
    }

    case 'timeline':
      // The same core/ builder as every other source, so the tempo arithmetic
      // and the note-off invariant have one implementation rather than three.
      return scheduleFromTimeline(request.timeline, {
        bpm: request.bpm,
        fromBar: request.fromBar,
        toBar: request.toBar,
      })

    case 'take': {
      // Parsed at the reader, as every take already is, and trusted from
      // there. A file that ends mid-note -- what a crash leaves behind (NFR 8)
      // -- has its open notes closed by the normaliser rather than on the
      // instrument.
      const content = readTake(takePath(deps.takesDirectory(), request.takeId))
      return scheduleFromEvents(
        content.events,
        { kind: 'take', takeId: request.takeId, speed: request.speed },
        request.speed
      )
    }
  }
}
