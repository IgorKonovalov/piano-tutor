import type { MidiPort } from '../../shared/midi'
import type { MidiSource } from './MidiSource'
import { toBytes } from './parse'
import { readTake } from '../take/takeFile'
import { type Clock, TimedByteSource, systemClock } from './timedSource'

/**
 * A recorded take, played back through the identical path a device feeds.
 *
 * Replay is not a second code path. The take's events become bytes again and
 * go through the same parser, the same arrival stamp and the same push channel
 * a real note travels, so the live view genuinely cannot tell the difference --
 * and the seam that makes that true is the same one the harness uses
 * (ADR-0001, ADR-0004).
 *
 * The recorded inter-event timing is preserved; `speed` scales it.
 */
export const REPLAY_PORT_PREFIX = 'replay:'

export function replayPortId(takeId: string): string {
  return `${REPLAY_PORT_PREFIX}${takeId}`
}

export class ReplaySource extends TimedByteSource implements MidiSource {
  constructor(
    private readonly options: { path: string; speed?: number },
    clock: Clock = systemClock
  ) {
    super(clock)
  }

  /** A take is not a port. Nothing enumerates a replay. */
  async listPorts(): Promise<MidiPort[]> {
    return []
  }

  async open(): Promise<void> {
    const { events } = readTake(this.options.path)
    const first = events[0]?.t ?? 0
    this.play(
      events.map((event) => ({
        // Take times are already relative to the header, but a take whose
        // first event is not at zero should still start immediately.
        t: event.t - first,
        bytes: Uint8Array.from(toBytes(event)),
      })),
      this.options.speed ?? 1
    )
  }

  async close(): Promise<void> {
    this.stopPlayback()
  }
}
