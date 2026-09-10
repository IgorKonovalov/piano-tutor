import type { MidiEvent } from '../../../shared/midi'
import type { ExpectedTimeline } from '../../../shared/score'
import { barAt, roundQuarters } from '../score/timeline'
import {
  DEFAULT_BPM,
  type PlayOptions,
  type PlayedNote,
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
 * What a correct aligner must report, and nothing besides. `timing` and
 * `notAttempted` are per bar; the rest name the pitch involved.
 */
export type ExpectedVerdict =
  | { kind: 'wrongPitch'; bar: number; expected: number; played: number }
  | { kind: 'missing'; bar: number; expected: number }
  | { kind: 'extra'; bar: number; played: number }
  | { kind: 'timing'; bar: number }
  | { kind: 'notAttempted'; bar: number }

export interface PerturbOptions extends PlayOptions {
  perturbations?: readonly Perturbation[]
}

export interface PerturbedTake {
  events: MidiEvent[]
  /** The exact verdict list, ordered by bar then kind. */
  verdicts: ExpectedVerdict[]
  /** Quarter notes per minute an aligner should fit to these events. */
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

export function perturb(
  timeline: ExpectedTimeline,
  options: PerturbOptions = {}
): PerturbedTake {
  let notes = timelineNotes(timeline)
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
