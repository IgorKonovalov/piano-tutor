import {
  CC_SOFT,
  CC_SOSTENUTO,
  CC_SUSTAIN,
  type MidiEvent,
  PEDAL_DOWN_THRESHOLD,
} from '../../../shared/midi'

/**
 * The one reduction from a stream of events to what is sounding right now.
 * The keyboard, the staff and the labels all read this rather than the event
 * stream: a view that re-derives state per event is the latency bug NFR 1
 * exists to catch.
 *
 * Pedal semantics are the part worth stating. A key released while sustain is
 * down keeps sounding until sustain lifts. Sostenuto captures exactly the keys
 * that were down when it went down, and holds only those. A note can be held
 * by both; it stops only when neither holds it.
 */
export interface SoundingNote {
  note: number
  ch: number
  velocity: number
  /** The event time of the note-on that started it. */
  t: number
  /** True when the key is up and only a pedal is keeping it sounding. */
  pedalled: boolean
}

export interface HeldNotes {
  /** Keys physically down, by note number. */
  down: ReadonlyMap<number, SoundingNote>
  /** Keys released but still sounding on a pedal. */
  pedalled: ReadonlyMap<number, SoundingNote>
  sustain: boolean
  sostenuto: boolean
  /** CC 67's raw value; the soft pedal changes tone, not what is held. */
  soft: number
  /** The notes sostenuto captured when it went down. */
  sostenutoCaptured: ReadonlySet<number>
}

export const emptyHeldNotes: HeldNotes = {
  down: new Map(),
  pedalled: new Map(),
  sustain: false,
  sostenuto: false,
  soft: 0,
  sostenutoCaptured: new Set(),
}

/** Everything audible: keys down plus keys a pedal is still holding. */
export function soundingNotes(held: HeldNotes): SoundingNote[] {
  return [...held.down.values(), ...held.pedalled.values()].sort((a, b) => a.note - b.note)
}

export function soundingPitches(held: HeldNotes): number[] {
  return soundingNotes(held).map((n) => n.note)
}

function heldByPedal(held: HeldNotes, note: number): boolean {
  if (held.sustain) return true
  return held.sostenuto && held.sostenutoCaptured.has(note)
}

/** Drop anything the pedals no longer hold, after a pedal state change. */
function releaseUnheld(next: HeldNotes): HeldNotes {
  const pedalled = new Map(next.pedalled)
  for (const note of [...pedalled.keys()]) {
    if (!heldByPedal(next, note)) pedalled.delete(note)
  }
  return { ...next, pedalled }
}

export function reduceHeldNotes(state: HeldNotes, event: MidiEvent): HeldNotes {
  switch (event.kind) {
    case 'noteOn': {
      const down = new Map(state.down)
      const pedalled = new Map(state.pedalled)
      // Retriggering a pedalled note takes it back under the key.
      pedalled.delete(event.note)
      down.set(event.note, {
        note: event.note,
        ch: event.ch,
        velocity: event.velocity,
        t: event.t,
        pedalled: false,
      })
      return { ...state, down, pedalled }
    }

    case 'noteOff': {
      const existing = state.down.get(event.note)
      if (existing === undefined) return state
      const down = new Map(state.down)
      down.delete(event.note)
      if (!heldByPedal(state, event.note)) return { ...state, down }
      const pedalled = new Map(state.pedalled)
      pedalled.set(event.note, { ...existing, pedalled: true })
      return { ...state, down, pedalled }
    }

    case 'cc': {
      const isDown = event.value >= PEDAL_DOWN_THRESHOLD
      switch (event.controller) {
        case CC_SUSTAIN:
          return releaseUnheld({ ...state, sustain: isDown })
        case CC_SOSTENUTO:
          return releaseUnheld({
            ...state,
            sostenuto: isDown,
            // Going down captures what is under the keys at that instant;
            // coming up captures nothing.
            sostenutoCaptured: isDown ? new Set(state.down.keys()) : new Set(),
          })
        case CC_SOFT:
          return { ...state, soft: event.value }
        default:
          return state
      }
    }

    case 'programChange':
    case 'pitchBend':
    case 'unknown':
      return state
  }
}

export function reduceAll(state: HeldNotes, events: readonly MidiEvent[]): HeldNotes {
  return events.reduce(reduceHeldNotes, state)
}
