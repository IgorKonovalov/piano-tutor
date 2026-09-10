import { describe, expect, it } from 'vitest'
import { CC_SUSTAIN, type MidiEvent } from '../../shared/midi'
import { MidiParser } from './parse'
import { serialise } from './serialise'

/**
 * A round trip rather than a table of expected bytes (ADR-0007). A table
 * asserts that the author and the code agree; the round trip asserts that the
 * two directions of the wire agree, which is the property that keeps a
 * schedule sounding on the instrument as the value in `core/` describes it.
 */
function roundTrip(event: MidiEvent): MidiEvent[] {
  return new MidiParser().parse(serialise(event), event.t)
}

const CASES: MidiEvent[] = [
  { kind: 'noteOn', t: 0, ch: 0, note: 60, velocity: 72 },
  { kind: 'noteOn', t: 12, ch: 15, note: 108, velocity: 127 },
  { kind: 'noteOn', t: 1, ch: 3, note: 21, velocity: 1 },
  { kind: 'noteOff', t: 400, ch: 0, note: 60, velocity: 0 },
  { kind: 'noteOff', t: 401, ch: 9, note: 64, velocity: 64 },
  { kind: 'cc', t: 5, ch: 0, controller: CC_SUSTAIN, value: 127 },
  { kind: 'cc', t: 6, ch: 0, controller: CC_SUSTAIN, value: 0 },
  { kind: 'cc', t: 7, ch: 12, controller: 123, value: 0 },
  { kind: 'programChange', t: 8, ch: 4, program: 0 },
  { kind: 'programChange', t: 9, ch: 4, program: 127 },
  { kind: 'pitchBend', t: 10, ch: 0, value: 0 },
  { kind: 'pitchBend', t: 11, ch: 7, value: 8191 },
  { kind: 'pitchBend', t: 12, ch: 7, value: -8192 },
]

describe('serialise is the parser inverse', () => {
  for (const event of CASES) {
    it(`survives the round trip: ${event.kind} on ${'ch' in event ? `ch ${event.ch}` : 'no channel'}`, () => {
      expect(roundTrip(event)).toEqual([event])
    })
  }

  it('emits three bytes for a note-on, status first', () => {
    // The one shape worth pinning outright: every schedule is mostly this, and
    // a status nibble that drifted would still round-trip through a matching
    // parser bug.
    expect(serialise({ kind: 'noteOn', t: 0, ch: 2, note: 60, velocity: 72 })).toEqual([
      0x92, 60, 72,
    ])
    expect(serialise({ kind: 'noteOff', t: 0, ch: 2, note: 60, velocity: 0 })).toEqual([
      0x82, 60, 0,
    ])
  })

  it('sends a note-on of velocity zero as the note-off it means', () => {
    // The instrument reads 0x90 with velocity 0 as a release, so the round
    // trip changes the kind on purpose. A schedule never produces one -- the
    // normaliser writes real note-offs -- and this records what would happen.
    expect(roundTrip({ kind: 'noteOn', t: 0, ch: 0, note: 60, velocity: 0 })).toEqual([
      { kind: 'noteOff', t: 0, ch: 0, note: 60, velocity: 0 },
    ])
  })
})
