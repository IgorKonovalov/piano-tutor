import type { MidiEvent } from '../../../shared/midi'
import type {
  BarState,
  BarVerdict,
  ExpectedTimeline,
  NoteVerdict,
  PracticeReport,
} from '../../../shared/score'
import { type Alignment, align, confidentPairs, struckPitches } from './align'
import {
  type ExpectedGroup,
  type PlayedGroup,
  ONSET_WINDOW_MS,
  expectedGroups,
  pitchesMissingFrom,
  playedGroups,
} from './onsetGroups'
import { type TempoFit, deviationMs, fitTempo } from './tempo'

/**
 * The take, rolled up into something a player can read: one verdict per bar,
 * naming the notes that were wrong, missing or extra, and how far that bar sat
 * from the one fitted tempo.
 *
 * Everything here is a pure function of a timeline and a list of events. No
 * clock is read, no file is touched, and the same take against the same score
 * produces the same report on any machine.
 */

/**
 * How far a bar's notes may sit from the fitted line before the bar is called
 * out for timing. Forty-five milliseconds is a little under a demisemiquaver
 * at a walking tempo and comfortably inside what a listener hears as "not
 * together"; below it sits ordinary human unevenness and the generator's own
 * jitter, which is bounded at twelve.
 *
 * The tests assert the **ordering** of bars by badness rather than this
 * number, so tuning it cannot make a test pass that should not.
 */
export const TIMING_THRESHOLD_MS = 45

export interface PracticeReportInput {
  timeline: ExpectedTimeline
  events: readonly MidiEvent[]
  takeId: string
  /** Defaults to the timeline's own score id. */
  scoreId?: string
  onsetWindowMs?: number
  band?: number
}

export interface PracticeAnalysis {
  report: PracticeReport
  alignment: Alignment
  expected: ExpectedGroup[]
  played: PlayedGroup[]
  fit: TempoFit | null
}

export function analyse(input: PracticeReportInput): PracticeAnalysis {
  const expected = expectedGroups(input.timeline)
  const played = playedGroups(input.events, input.onsetWindowMs ?? ONSET_WINDOW_MS)
  const alignment = align(expected, played, { band: input.band })
  const fit = fitTempo(confidentPairs(alignment, expected, played))

  const notes = new Map<number, NoteVerdict[]>()
  const deviations = new Map<number, number[]>()
  const counts = { correct: 0, wrongPitch: 0, missing: 0, extra: 0 }

  for (const bar of input.timeline.bars) {
    notes.set(bar.index, [])
    deviations.set(bar.index, [])
  }

  const push = (bar: number, verdict: NoteVerdict): void => {
    const list = notes.get(bar)
    if (list === undefined) notes.set(bar, [verdict])
    else list.push(verdict)
    counts[verdict.kind]++
  }

  /**
   * An extra group belongs to the bar the player was in when they played it.
   * The score has nothing there by definition, so the nearest expected group
   * on either side is the only thing that can say where "there" was.
   */
  let lastBar = input.timeline.bars[0]?.index ?? 0
  let lastMatchedExpected = -1

  for (const step of alignment.steps) {
    if (step.kind === 'match') {
      const expectedGroup = expected[step.expected]
      const playedGroup = played[step.played]
      if (expectedGroup === undefined || playedGroup === undefined) continue

      lastBar = expectedGroup.bar
      lastMatchedExpected = Math.max(lastMatchedExpected, step.expected)

      // A match may span several played groups when the player broke the
      // chord, so what it is judged against is every note in the run.
      const heard = struckPitches(played, step)
      const heardNotes = played
        .slice(step.played, step.played + step.playedCount)
        .flatMap((group) => group.notes)

      const struck = pitchesMissingFrom(heard, expectedGroup.pitches)
      const absent = pitchesMissingFrom(expectedGroup.pitches, heard)

      for (const pitch of expectedGroup.pitches) {
        if (absent.includes(pitch)) continue
        const at = heardNotes.find((note) => note.midi === pitch)?.t ?? playedGroup.t
        push(expectedGroup.bar, { kind: 'correct', expected: pitch, playedAt: at })
      }

      // A wrong note is a written note paired with an unwritten one. Pairing
      // them in pitch order keeps "you played F sharp for F" out of the
      // missing-and-extra pile, which is what the player actually did.
      const pairs = Math.min(absent.length, struck.length)
      for (let k = 0; k < pairs; k++) {
        push(expectedGroup.bar, {
          kind: 'wrongPitch',
          expected: absent[k] as number,
          played: struck[k] as number,
        })
      }
      for (const pitch of absent.slice(pairs)) {
        push(expectedGroup.bar, { kind: 'missing', expected: pitch })
      }
      for (const pitch of struck.slice(pairs)) {
        push(expectedGroup.bar, { kind: 'extra', played: pitch })
      }

      if (fit !== null && absent.length < expectedGroup.pitches.length) {
        deviations
          .get(expectedGroup.bar)
          ?.push(deviationMs(fit, { onset: expectedGroup.onset, t: playedGroup.t }))
      }
    } else if (step.kind === 'missing') {
      const expectedGroup = expected[step.expected]
      if (expectedGroup === undefined) continue
      lastBar = expectedGroup.bar
      for (const pitch of expectedGroup.pitches) {
        push(expectedGroup.bar, { kind: 'missing', expected: pitch })
      }
    } else {
      const playedGroup = played[step.played]
      if (playedGroup === undefined) continue
      for (const pitch of playedGroup.pitches) {
        push(lastBar, { kind: 'extra', played: pitch })
      }
    }
  }

  /**
   * A bar is not attempted when the player never reached it: every one of its
   * expected groups sits after the last one they matched. It is not a mistake
   * and it does not count as missing notes.
   */
  const abandonedFrom = firstAbandonedBar(expected, lastMatchedExpected)

  const bars: BarVerdict[] = input.timeline.bars.map((bar) => {
    const barNotes = notes.get(bar.index) ?? []
    const barDeviations = deviations.get(bar.index) ?? []
    const timingDeviation =
      barDeviations.length === 0
        ? 0
        : barDeviations.reduce((total, value) => total + value, 0) / barDeviations.length

    return {
      bar: bar.index,
      state: stateFor({
        bar: bar.index,
        notes: barNotes,
        timingDeviation,
        abandonedFrom,
        unalignableFromBar:
          alignment.unalignableFrom === null
            ? null
            : (expected[alignment.unalignableFrom]?.bar ?? null),
      }),
      // Not-attempted bars carry no verdicts: the missing notes counted above
      // for them are the player stopping, not the player failing.
      notes: abandonedFrom !== null && bar.index >= abandonedFrom ? [] : barNotes,
      timingDeviation,
    }
  })

  if (abandonedFrom !== null) {
    for (const bar of bars) {
      if (bar.bar < abandonedFrom) continue
      for (const verdict of notes.get(bar.bar) ?? []) counts[verdict.kind]--
    }
  }

  const unalignableFromBar =
    alignment.unalignableFrom === null
      ? null
      : (expected[alignment.unalignableFrom]?.bar ?? null)

  return {
    report: {
      scoreId: input.scoreId ?? input.timeline.scoreId,
      takeId: input.takeId,
      bars,
      fittedTempo: fit === null ? null : fit.qpm,
      counts,
      unalignableFromBar,
    },
    alignment,
    expected,
    played,
    fit,
  }
}

export function practiceReport(input: PracticeReportInput): PracticeReport {
  return analyse(input).report
}

/**
 * The first bar the player never reached, or null if they played to the end.
 *
 * A consequence worth stating: dropping the **last** note of a piece and
 * stopping just before it are the same evidence, and this reads both as
 * stopping. That is the right way round -- inventing a mistake out of silence
 * is worse than saying "you did not get there" -- but it does mean a fluffed
 * final note is never reported as missing. `report.test.ts` asserts it so it
 * stays a decision.
 */
function firstAbandonedBar(
  expected: readonly ExpectedGroup[],
  lastMatchedExpected: number
): number | null {
  if (lastMatchedExpected < 0) return expected[0]?.bar ?? null
  const next = expected[lastMatchedExpected + 1]
  if (next === undefined) return null
  // The bar the player stopped in is only abandoned if nothing in it was
  // matched at all; otherwise they played part of it and it is judged.
  const matchedBar = expected[lastMatchedExpected]?.bar
  return next.bar === matchedBar ? next.bar + 1 : next.bar
}

function stateFor(input: {
  bar: number
  notes: readonly NoteVerdict[]
  timingDeviation: number
  abandonedFrom: number | null
  unalignableFromBar: number | null
}): BarState {
  if (input.unalignableFromBar !== null && input.bar >= input.unalignableFromBar) {
    return 'unalignable'
  }
  if (input.abandonedFrom !== null && input.bar >= input.abandonedFrom) return 'notAttempted'
  if (input.notes.some((note) => note.kind !== 'correct')) return 'wrong'
  if (Math.abs(input.timingDeviation) > TIMING_THRESHOLD_MS) return 'timing'
  return 'clean'
}

/** Bars ordered by how far they sat from the fitted tempo, worst first. */
export function barsByTiming(report: PracticeReport): BarVerdict[] {
  return [...report.bars]
    .filter((bar) => bar.state !== 'notAttempted' && bar.state !== 'unalignable')
    .sort((a, b) => Math.abs(b.timingDeviation) - Math.abs(a.timingDeviation))
}
