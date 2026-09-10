import type { MidiPort } from '../../shared/midi'

/**
 * The seam every transport sits behind (ADR-0001). Three implementations:
 * `RtMidiSource` (the CK88 over USB), `ReplaySource` (a recorded take) and
 * `SyntheticSource` (a seeded scenario, ADR-0004). A DIN interface or a
 * Bluetooth adapter would be a fourth, with nothing above this line changing.
 *
 * `t` handed to the callback is `performance.timeOrigin + performance.now()`,
 * taken in the arrival callback before any parsing, so the latency NFR 1
 * measures includes everything the app adds and nothing it does not. The epoch
 * anchor is not decoration: main and the renderer are separate processes with
 * separate `performance.now()` origins, and subtracting two bare readings
 * measures nothing. A fourth transport keeps the anchor or NFR 1 stops being
 * measurable at all.
 */
export interface MidiSource {
  /**
   * Enumerate without touching the device (ADR-0006): no handle is opened, so
   * listing is free of side effects and safe to poll, which the absence of a
   * Windows hot-plug callback makes necessary. A transport that can only
   * report availability by trying to open reports `available` and lets `open`
   * be the one that finds out.
   */
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
