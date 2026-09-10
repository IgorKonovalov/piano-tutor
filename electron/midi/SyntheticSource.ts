import type { MidiPort } from '../../shared/midi'
import { MidiPortUnavailable, type MidiSource } from './MidiSource'
import { toBytes } from './parse'
import { findScenarioById } from '../../core/src/midi/generate'
import { type Clock, TimedByteSource, systemClock } from './timedSource'
import { listVirtualPorts, type HarnessGate } from './virtualPorts'

export { type Clock, systemClock }

/**
 * The app playing itself (ADR-0004). It sits exactly where `RtMidiSource`
 * sits and hands the same callback the same shape of data: **bytes**, not
 * events. Emitting bytes is the point -- the parser, the arrival stamp, the
 * recorder, the Zod boundary and React are all on the path a green harness run
 * has exercised. Feeding events straight in would prove the least interesting
 * third of the pipeline.
 *
 * What it cannot prove: USB, RtMidi's own behaviour, port exclusivity, the
 * CK88's four zones, and the velocity range a player produces. Those are the
 * instrument's phase.
 */
export class SyntheticSource extends TimedByteSource implements MidiSource {
  constructor(
    private readonly gate: HarnessGate,
    clock: Clock = systemClock
  ) {
    super(clock)
  }

  async listPorts(): Promise<MidiPort[]> {
    return listVirtualPorts(this.gate)
  }

  async open(portId: string): Promise<void> {
    const scenario = findScenarioById(portId)
    if (scenario === undefined) {
      throw new MidiPortUnavailable(portId, `No generated scenario is named ${portId}`)
    }
    this.play(
      scenario.generate().map((event) => ({ t: event.t, bytes: Uint8Array.from(toBytes(event)) }))
    )
  }

  async close(): Promise<void> {
    this.stopPlayback()
  }
}
