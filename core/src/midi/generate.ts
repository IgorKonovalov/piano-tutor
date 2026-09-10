import { CC_SUSTAIN, type MidiEvent } from '../../../shared/midi'
import type { ExpectedTimeline } from '../../../shared/score'
import { graceNotes, roundQuarters, scoredNotes } from '../score/timeline'
import { makeRng } from './rng'

/**
 * Seeded passages the app plays into its own pipeline (ADR-0004). Pure and
 * deterministic: the same seed produces the same event list, so a fixture is a
 * few lines of code rather than a committed recording, and a phase's done-when
 * can be checked with nothing plugged in.
 *
 * Times are relative milliseconds from zero. `electron/midi/SyntheticSource.ts`
 * turns them back into bytes on a timer and feeds the same callback the RtMidi
 * source feeds, so the parser is exercised rather than bypassed.
 *
 * These passages are metronomic and evenly voiced. They are not a substitute
 * for a human take, and nothing tuned against them alone should be trusted
 * about real playing.
 */
export interface Scenario {
  id: string
  seed: number
  generate(): MidiEvent[]
}

const CHANNEL = 0

/** Enough spread to look played, small enough not to change what is heard. */
function humanVelocity(base: number, jitter: number, r: number): number {
  return Math.max(1, Math.min(127, Math.round(base + (r * 2 - 1) * jitter)))
}

function noteOn(t: number, note: number, velocity: number): MidiEvent {
  return { kind: 'noteOn', t, ch: CHANNEL, note, velocity }
}

function noteOff(t: number, note: number): MidiEvent {
  return { kind: 'noteOff', t, ch: CHANNEL, note, velocity: 0 }
}

function pedal(t: number, down: boolean): MidiEvent {
  return { kind: 'cc', t, ch: CHANNEL, controller: CC_SUSTAIN, value: down ? 127 : 0 }
}

/** Events are emitted out of time order by construction; the source needs them sorted. */
function byTime(events: MidiEvent[]): MidiEvent[] {
  return events.sort((a, b) => a.t - b.t)
}

/** Scale degrees of C major as MIDI notes, two octaves from middle C. */
const C_MAJOR_TWO_OCTAVES = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84]

function cMajorScale(seed: number): MidiEvent[] {
  const rng = makeRng(seed)
  const events: MidiEvent[] = []
  const step = 150
  // Legato: each note is still down when the next one starts.
  const overlap = 45
  const path = [...C_MAJOR_TWO_OCTAVES, ...C_MAJOR_TWO_OCTAVES.slice(0, -1).reverse()]

  path.forEach((note, index) => {
    const t = index * step
    events.push(noteOn(t, note, humanVelocity(72, 10, rng.next())))
    events.push(noteOff(t + step + overlap, note))
  })
  return byTime(events)
}

/**
 * Gm7 - C7 - F. Each chord is struck, the pedal goes down, the keys are
 * released while it is still down, and the pedal lifts only as the next chord
 * arrives: the sustained-through-release behaviour a keyboard view has to get
 * right.
 */
const II_V_I_CHORDS = [
  [55, 58, 62, 65], // Gm7
  [48, 52, 55, 58], // C7
  [41, 53, 57, 60, 65], // F, doubled root
]

function iiVIinF(seed: number): MidiEvent[] {
  const rng = makeRng(seed)
  const events: MidiEvent[] = []
  const bar = 2000

  II_V_I_CHORDS.forEach((chord, index) => {
    const t = index * bar
    chord.forEach((note, voice) => {
      // A rolled attack, a few milliseconds apart, rather than one instant.
      const onset = t + voice * 8
      events.push(noteOn(onset, note, humanVelocity(80, 8, rng.next())))
      // Keys up well before the bar ends; only the pedal holds the chord.
      events.push(noteOff(t + 700, note))
    })
    events.push(pedal(t + 40, true))
    events.push(pedal(t + bar - 60, false))
  })
  return byTime(events)
}

/** A minor triad, broken, three octaves, left hand under right. */
function aMinorArpeggios(seed: number): MidiEvent[] {
  const rng = makeRng(seed)
  const events: MidiEvent[] = []
  const step = 130
  const roots = [45, 57, 69] // A2, A3, A4
  const triad = [0, 3, 7] // A minor
  let index = 0

  for (let pass = 0; pass < 2; pass++) {
    const order = pass === 0 ? roots : [...roots].reverse()
    for (const root of order) {
      const shape = pass === 0 ? triad : [...triad].reverse()
      for (const interval of [...shape, 12]) {
        const note = root + interval
        const t = index * step
        events.push(noteOn(t, note, humanVelocity(68, 12, rng.next())))
        events.push(noteOff(t + step - 20, note))
        // The left hand doubles the root two octaves down on each beat.
        if (interval === 0) {
          events.push(noteOn(t, root - 24, humanVelocity(60, 8, rng.next())))
          events.push(noteOff(t + step * 3, root - 24))
        }
        index++
      }
    }
  }
  return byTime(events)
}

interface DenseSegment {
  /** MIDI events per second across the segment, counting note-ons and note-offs. */
  rate: number
  seconds: number
}

/**
 * NFR 2's shape: a sustained 100 events/s with two 2 s bursts of 200/s, long
 * enough to put more than 2 000 events through the pipeline. Notes are picked
 * from a wide register so no single key is retriggered before it is released.
 */
const DENSE_SEGMENTS: DenseSegment[] = [
  { rate: 100, seconds: 8 },
  { rate: 200, seconds: 2 },
  { rate: 100, seconds: 4 },
  { rate: 200, seconds: 2 },
  { rate: 100, seconds: 2 },
]

function dense2000(seed: number): MidiEvent[] {
  const rng = makeRng(seed)
  const events: MidiEvent[] = []
  let t = 0

  for (const segment of DENSE_SEGMENTS) {
    // One note is two events (on and off), so a pair every 2/rate seconds.
    const pairs = Math.round((segment.rate * segment.seconds) / 2)
    const gap = (segment.seconds * 1000) / pairs
    for (let i = 0; i < pairs; i++) {
      const note = rng.int(36, 96)
      events.push(noteOn(t, note, humanVelocity(78, 24, rng.next())))
      events.push(noteOff(t + gap * 0.9, note))
      t += gap
    }
  }
  return byTime(events)
}

export const SCENARIOS: readonly Scenario[] = [
  { id: 'virtual:c-major-scale', seed: 0x5ca1e, generate: () => cMajorScale(0x5ca1e) },
  { id: 'virtual:ii-V-I-in-F', seed: 0x2517, generate: () => iiVIinF(0x2517) },
  { id: 'virtual:a-minor-arpeggios', seed: 0xa317, generate: () => aMinorArpeggios(0xa317) },
  { id: 'virtual:dense-2000', seed: 0xde75e, generate: () => dense2000(0xde75e) },
] as const

export function findScenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id)
}

/**
 * Playing a written piece rather than a passage: the same seeded, pure
 * generation, taking its notes from an `ExpectedTimeline` instead of from a
 * hand-written figure. This is what lets a score be practised by the app
 * itself, so alignment has something to align with nothing plugged in.
 */

/** A note as it is about to be played: absolute, in quarter notes. */
export interface PlayedNote {
  midi: number
  onset: number
  duration: number
  /** Carried through only so a test can say which bar an event came from. */
  bar: number
}

export interface PlayOptions {
  /** Quarter notes per minute the passage is played at. */
  bpm?: number
  seed?: number
  /**
   * Human-ish imperfection, on by default. Off makes every inter-onset gap an
   * exact multiple of the beat, which is what a ratio assertion needs.
   */
  jitter?: boolean
  /**
   * Multiplies every time. 0.8 plays the whole piece a quarter faster; the
   * tempo an aligner fits is then `bpm / factor`. It is a property of the
   * performance, not of the notes, so it lives here and not in a perturbation
   * to the note list.
   */
  tempoScale?: number
}

export const DEFAULT_BPM = 90
export const DEFAULT_PLAY_SEED = 0x5c04e

/**
 * The bound on how far a played onset strays from the written one. It is well
 * under the 50 ms window onset grouping uses, so a chord still groups, and far
 * under any threshold that could call a bar late: a clean take has to score
 * clean or every test built on one is measuring the jitter instead.
 */
export const ONSET_JITTER_MS = 12
export const VELOCITY_JITTER = 10
export const BASE_VELOCITY = 76

/** Keys come up before the next note, so a held chord is not a legato blur. */
const RELEASE_GAP_MS = 40
const MIN_HELD_MS = 40

function byOnset(a: PlayedNote, b: PlayedNote): number {
  return a.onset - b.onset || a.midi - b.midi
}

/**
 * Deterministic from the seed, including the jitter: the notes are sorted
 * before anything is drawn from the generator, so the same input produces the
 * same milliseconds every time on every machine.
 */
export function playNotes(notes: readonly PlayedNote[], options: PlayOptions = {}): MidiEvent[] {
  const bpm = options.bpm ?? DEFAULT_BPM
  const scale = options.tempoScale ?? 1
  const msPerQuarter = (60_000 / bpm) * scale
  const rng = makeRng(options.seed ?? DEFAULT_PLAY_SEED)
  const wobbly = options.jitter !== false

  const events: MidiEvent[] = []
  for (const note of [...notes].sort(byOnset)) {
    const drift = wobbly ? (rng.next() * 2 - 1) * ONSET_JITTER_MS : 0
    const t = Math.max(0, Math.round(note.onset * msPerQuarter + drift))
    const velocity = wobbly
      ? humanVelocity(BASE_VELOCITY, VELOCITY_JITTER, rng.next())
      : BASE_VELOCITY
    const held = Math.max(MIN_HELD_MS, Math.round(note.duration * msPerQuarter) - RELEASE_GAP_MS)
    events.push(noteOn(t, note.midi, velocity))
    events.push(noteOff(t + held, note.midi))
  }
  return byTime(events)
}

/**
 * How far ahead of its principal an ornament is struck, in quarter notes. At
 * the default tempo that is a little over eighty milliseconds -- deliberately
 * **outside** the 50 ms grouping window, because a grace note arriving as its
 * own played group is the case ADR-0009 exists for. A generator that placed it
 * on the beat would test the easy half and leave the real one uncovered.
 */
export const GRACE_LEAD_QUARTERS = 0.125

export interface TimelineNoteOptions {
  /**
   * Whether the player takes the ornaments. Both are correct playing
   * (ADR-0009), and `skipped` is the default because it is what a player
   * learning the notes does.
   */
  ornaments?: 'skipped' | 'played'
}

/**
 * Every note the score expects to be struck. Grace notes are not scored, so
 * they are left out unless the caller asks for a performance that takes them.
 */
export function timelineNotes(
  timeline: ExpectedTimeline,
  options: TimelineNoteOptions = {}
): PlayedNote[] {
  const played = scoredNotes(timeline).map((note) => ({
    midi: note.midi,
    onset: note.onset,
    duration: note.duration,
    bar: note.bar,
  }))
  if (options.ornaments !== 'played') return played

  for (const note of graceNotes(timeline)) {
    played.push({
      midi: note.midi,
      onset: roundQuarters(Math.max(0, note.onset - GRACE_LEAD_QUARTERS)),
      duration: GRACE_LEAD_QUARTERS,
      bar: note.bar,
    })
  }
  return played
}

/** The piece, played correctly. `perturb.ts` is how it is played wrongly. */
export function playTimeline(
  timeline: ExpectedTimeline,
  options: PlayOptions & TimelineNoteOptions = {}
): MidiEvent[] {
  return playNotes(timelineNotes(timeline, options), options)
}
