import type { MidiPort } from '../../shared/midi'
import type { MidiSink } from './MidiSink'

/**
 * Where playback goes when no output port is selected — which is not an error
 * and not a degraded mode, but the ordinary case (ADR-0007): the player is
 * watching the keyboard light up, or listening through the fallback voice of
 * ADR-0008, and no instrument is meant to hear any of it.
 *
 * It exists rather than a null check at the call site so that the player
 * always has a sink and the panic path always has something to call. There is
 * no state to release, because nothing was ever sounded.
 */
export class NullSink implements MidiSink {
  async listPorts(): Promise<MidiPort[]> {
    return []
  }

  async open(): Promise<void> {}

  async close(): Promise<void> {}

  send(): void {}

  release(): void {}
}
