import type { MidiEvent } from '../../../shared/midi'
import type { ExpectedTimeline } from '../../../shared/score'
import { barAt, roundQuarters } from '../score/timeline'
import {
  DEFAULT_BPM,
  type PlayOptions,
  type PlayedNote,
  type TimelineNoteOptions,
  playNotes,
  timelineNotes,
} from './generate'

/**
 * Playing a score wrongly, on purpose and on a seed.
 *
 * This is the test oracle for alignment, and it exists in its own file, ahead
 * of the aligner, for one reason: an oracle written after the thing it tests
 * tends to agree with it. **A perturbation declares its own expected verdict.**
 * A test asserts the aligner's output against that declaration, never against
 * an expectation copied out of a failing run -- which is the way a wrong
 * aligner and a wrong test quietly settle on each other.
 *
 * Everything here is pure and seeded. The same perturbation on the same
 * timeline is the same milliseconds every time.
 */

export type Perturbation =
  /** The `index`-th note of the bar is played `semitones` away from written. */
  | { kind: 'substitutePitch'; bar: number; index?: number; semitones?: number }
  /** The `index`-th note of the bar is never struck. */
  | { kind: 'dropNote'; bar: number; index?: number }
  /** An extra note lands in the bar, between two written ones. */
  | { kind: 'insertNote'; bar: number; midi: number; index?: number }
  /**
   * The bar is played in `fraction` of the time it is written to take, and the
   * bars after it resume at their written times -- the player hurried through
   * it and then waited. Localising it is what makes "this bar, worst" an exact
   * claim rather than a claim about everything downstream.
   *
   * A bar whose notes all fall on one onset cannot be rushed and will show no
   * deviation; that is honest, not a bug.
   */
  | { kind: 'rushBar'; bar: number; fraction: number }
  /**
   * The whole piece faster or slower. 0.8 is a quarter faster. It declares no
   * verdict at all: a piece played evenly at the wrong tempo is a piece played
   * correctly, and an aligner that says otherwise is not tempo-free.
   */
  | { kind: 'tempoScale'; factor: number }
  /** Nothing after this bar is played. */
  | { kind: 'stopAfterBar'; bar: number }
  /**
   * The player reaches the end of this bar, goes back, and plays it again
   * before carrying on. Everything from the next bar onward is pushed later by
   * one bar's worth of time; the replayed notes fill the gap.
   *
   * The replay is **correct notes with nowhere left in the score to match** --
   * the aligner has already spent that bar -- which is where the extras in the
   * measurement behind ADR-0014 came from. It is care, not error, and it
   * declares no note-level verdict.
   */
  | { kind: 'restartAtBar'; bar: number }
  /**
   * The player slows (or presses on) across a span. `factor` is the tempo at
   * the **end** of `toBar` as a fraction of the written one: 0.7 ends at 70 %
   * of the tempo it started at, so the last inter-onset gap is `1 / 0.7` times
   * the written one. Bars before `fromBar` are untouched and bars after
   * `toBar` continue at the tempo the ramp finished on.
   *
   * A rallentando is not a mistake, so this declares a `tempoChange` and
   * nothing else.
   */
  | { kind: 'rallentando'; fromBar: number; toBar: number; factor: number }

/**
 * What a correct aligner must report, and nothing besides. `timing` and
 * `notAttempted` are per bar; the rest name the pitch involved.
 */
export type ExpectedVerdict =
  | { kind: 'wrongPitch'; bar: number; expected: number; played: number }
  | { kind: 'missing'; bar: number; expected: number }
  | { kind: 'extra'; bar: number; played: number }
  | { kind: 'timing'; bar: number }
  | { kind: 'notAttempted'; bar: number }
  /** The player went back over this bar. `notes` is how many they replayed. */
  | { kind: 'restart'; bar: number; notes: number }
  /**
   * The tempo changed across a span. `bar` is where it began, so this sorts
   * with the rest; `percent` is negative when the player slowed, so -30 reads
   * "slowed 30 %".
   */
  | { kind: 'tempoChange'; bar: number; toBar: number; percent: number }

export interface PerturbOptions extends PlayOptions, TimelineNoteOptions {
  perturbations?: readonly Perturbation[]
}

export interface PerturbedTake {
  events: MidiEvent[]
  /** The exact verdict list, ordered by bar then kind. */
  verdicts: ExpectedVerdict[]
  /**
   * Quarter notes per minute an aligner should fit to these events. A
   * `rallentando` gives the take more than one tempo, and this stays the one
   * it began at; what an aligner should report for such a take is the
   * steady-state figure, which is the report's business and not the oracle's.
   */
  fittedTempo: number
  /** What was actually played, for a test that wants to say why. */
  played: PlayedNote[]
}

const DEFAULT_SEMITONES = 1

function inBar(notes: readonly PlayedNote[], bar: number): PlayedNote[] {
  return notes.filter((note) => note.bar === bar).sort((a, b) => a.onset - b.onset || a.midi - b.midi)
}

function pick(notes: readonly PlayedNote[], bar: number, index: number): PlayedNote {
  const candidates = inBar(notes, bar)
  const chosen = candidates[index]
  if (chosen === undefined) {
    throw new Error(`bar ${bar} has ${candidates.length} notes, so there is no note ${index}`)
  }
  return chosen
}

function without(notes: readonly PlayedNote[], target: PlayedNote): PlayedNote[] {
  const at = notes.indexOf(target)
  return [...notes.slice(0, at), ...notes.slice(at + 1)]
}

function replace(notes: readonly PlayedNote[], target: PlayedNote, next: PlayedNote): PlayedNote[] {
  return notes.map((note) => (note === target ? next : note))
}

/**
 * Every inter-onset gap arriving inside `[start, end)` stretched, in equal
 * steps, from the written one to `finalStretch` times it; gaps after the span
 * hold at `finalStretch`, gaps before it are untouched.
 *
 * The ramp is **discrete over the onsets the player actually strikes** rather
 * than continuous over the quarter-note axis, so the last gap inside the span
 * is exactly the stated ratio and a test can assert it without a tolerance.
 * A continuous ramp would give the last gap the ramp's *mean* over that
 * interval, which is a number no reader could predict.
 */
function stretchGaps(
  notes: readonly PlayedNote[],
  start: number,
  end: number,
  finalStretch: number
): PlayedNote[] {
  const positions = [...new Set(notes.map((note) => note.onset))].sort((a, b) => a - b)
  const inSpan = (onset: number): boolean => onset > start && onset < end
  const total = positions.filter(inSpan).length

  const moved = new Map<number, number>()
  const stretched = new Map<number, number>()
  let ramped = 0
  let previous = positions[0] ?? 0
  let cursor = previous
  moved.set(previous, previous)
  stretched.set(previous, 1)

  for (const onset of positions.slice(1)) {
    let scale = 1
    if (inSpan(onset)) {
      ramped++
      scale = total === 0 ? finalStretch : 1 + (finalStretch - 1) * (ramped / total)
    } else if (onset >= end) {
      scale = finalStretch
    }
    cursor = roundQuarters(cursor + (onset - previous) * scale)
    moved.set(onset, cursor)
    stretched.set(onset, scale)
    previous = onset
  }

  return notes.map((note) => ({
    ...note,
    onset: moved.get(note.onset) ?? note.onset,
    duration: roundQuarters(note.duration * (stretched.get(note.onset) ?? 1)),
  }))
}

export function perturb(
  timeline: ExpectedTimeline,
  options: PerturbOptions = {}
): PerturbedTake {
  let notes = timelineNotes(timeline, options)
  const verdicts: ExpectedVerdict[] = []
  let tempoScale = options.tempoScale ?? 1

  for (const perturbation of options.perturbations ?? []) {
    switch (perturbation.kind) {
      case 'substitutePitch': {
        const target = pick(notes, perturbation.bar, perturbation.index ?? 0)
        const played = target.midi + (perturbation.semitones ?? DEFAULT_SEMITONES)
        notes = replace(notes, target, { ...target, midi: played })
        verdicts.push({
          kind: 'wrongPitch',
          bar: target.bar,
          expected: target.midi,
          played,
        })
        break
      }

      case 'dropNote': {
        const target = pick(notes, perturbation.bar, perturbation.index ?? 0)
        notes = without(notes, target)
        verdicts.push({ kind: 'missing', bar: target.bar, expected: target.midi })
        break
      }

      case 'insertNote': {
        // Placed between two written onsets so it is unambiguously an extra
        // note rather than a second voice in a chord the aligner may group.
        const neighbours = inBar(notes, perturbation.bar)
        const anchor = neighbours[perturbation.index ?? 0]
        if (anchor === undefined) {
          throw new Error(`bar ${perturbation.bar} has no note to insert beside`)
        }
        const gap = (neighbours[(perturbation.index ?? 0) + 1]?.onset ?? anchor.onset + 1) -
          anchor.onset
        notes = [
          ...notes,
          {
            midi: perturbation.midi,
            onset: roundQuarters(anchor.onset + gap / 2),
            duration: Math.min(anchor.duration, gap / 2),
            bar: perturbation.bar,
          },
        ]
        verdicts.push({ kind: 'extra', bar: perturbation.bar, played: perturbation.midi })
        break
      }

      case 'rushBar': {
        const bar = barAt(timeline, perturbation.bar)
        if (bar === undefined) throw new Error(`no bar ${perturbation.bar} in the timeline`)
        notes = notes.map((note) =>
          note.bar === perturbation.bar
            ? {
                ...note,
                onset: roundQuarters(bar.onset + (note.onset - bar.onset) * perturbation.fraction),
                duration: roundQuarters(note.duration * perturbation.fraction),
              }
            : note
        )
        verdicts.push({ kind: 'timing', bar: perturbation.bar })
        break
      }

      case 'tempoScale': {
        tempoScale *= perturbation.factor
        break
      }

      case 'stopAfterBar': {
        notes = notes.filter((note) => note.bar <= perturbation.bar)
        for (const bar of timeline.bars) {
          if (bar.index > perturbation.bar) {
            verdicts.push({ kind: 'notAttempted', bar: bar.index })
          }
        }
        break
      }

      case 'restartAtBar': {
        const bar = barAt(timeline, perturbation.bar)
        if (bar === undefined) throw new Error(`no bar ${perturbation.bar} in the timeline`)
        const replayed = notes.filter((note) => note.bar === perturbation.bar)
        if (replayed.length === 0) {
          throw new Error(`bar ${perturbation.bar} has no notes to go back over`)
        }
        // Everything from the next bar on is pushed later by one bar's worth
        // of time, and the replay fills the gap that opens. Working on the
        // onset axis keeps `playNotes` the only place a millisecond is
        // computed, so the whole take is still one tempo away from another.
        const shift = (note: PlayedNote): PlayedNote => ({
          ...note,
          onset: roundQuarters(note.onset + bar.beats),
        })
        notes = [
          ...notes.map((note) => (note.bar > perturbation.bar ? shift(note) : note)),
          ...replayed.map(shift),
        ]
        verdicts.push({ kind: 'restart', bar: perturbation.bar, notes: replayed.length })
        break
      }

      case 'rallentando': {
        const from = barAt(timeline, perturbation.fromBar)
        const to = barAt(timeline, perturbation.toBar)
        if (from === undefined) throw new Error(`no bar ${perturbation.fromBar} in the timeline`)
        if (to === undefined) throw new Error(`no bar ${perturbation.toBar} in the timeline`)
        if (perturbation.factor <= 0) throw new Error('a tempo factor is a positive number')
        const start = from.onset
        const end = roundQuarters(to.onset + to.beats)
        if (end <= start) {
          throw new Error(`bars ${perturbation.fromBar} to ${perturbation.toBar} are not a span`)
        }
        notes = stretchGaps(notes, start, end, 1 / perturbation.factor)
        verdicts.push({
          kind: 'tempoChange',
          bar: perturbation.fromBar,
          toBar: perturbation.toBar,
          percent: roundQuarters((perturbation.factor - 1) * 100),
        })
        break
      }
    }
  }

  const bpm = options.bpm ?? DEFAULT_BPM
  return {
    events: playNotes(notes, { ...options, tempoScale }),
    verdicts: verdicts.sort((a, b) => a.bar - b.bar || a.kind.localeCompare(b.kind)),
    fittedTempo: bpm / tempoScale,
    played: [...notes].sort((a, b) => a.onset - b.onset || a.midi - b.midi),
  }
}
