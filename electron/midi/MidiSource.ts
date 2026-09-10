import type { MidiPort } from '../../shared/midi'

/**
 * The seam every transport sits behind (ADR-0001). Three implementations:
 * `RtMidiSource` (the CK88 over USB), `ReplaySource` (a recorded take) and
 * `SyntheticSource` (a seeded scenario, ADR-0004). A DIN interface or a
 * Bluetooth adapter would be a fourth, with nothing above this line changing.
 *
 * `t` handed to the callback is `performance.now()` taken in the arrival
 * callback before any parsing, so the latency NFR 1 measures includes
 * everything the app adds and nothing it does not.
 */
export interface MidiSource {
  listPorts(): Promise<MidiPort[]>
  open(portId: string): Promise<void>
  close(): Promise<void>
  onMessage(cb: (bytes: Uint8Array, t: number) => void): () => void
}

/** Thrown when a port exists but cannot be opened; carries a line for the user. */
export class MidiPortUnavailable extends Error {
  constructor(
    readonly portId: string,
    message: string
  ) {
    super(message)
    this.name = 'MidiPortUnavailable'
  }
}
