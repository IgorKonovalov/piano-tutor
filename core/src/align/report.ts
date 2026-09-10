import type { MidiEvent } from '../../../shared/midi'
import {
  DEFAULT_STRICTNESS,
  type BarState,
  type BarVerdict,
  type ExpectedTimeline,
  type NoteVerdict,
  type PracticeReport,
  type TimingStrictness,
} from '../../../shared/score'
import { type Alignment, align, arrivalTime, confidentPairs, struckPitches } from './align'
import {
  type ExpectedGroup,
  type PlayedGroup,
  ONSET_WINDOW_MS,
  expectedGroups,
  pitchesMissingFrom,
  playedGroups,
  withoutOrnaments,
} from './onsetGroups'
import { findRestarts } from './restarts'
import {
  type BarPace,
  type BarredPair,
  type LocalTempo,
  type TempoFit,
  barPaces,
  fitTempo,
  localTempoCurve,
  steadyTempo,
  tempoObservations,
} from './tempo'

/**
 * The take, rolled up into something a player can read: one verdict per bar,
 * naming the notes that were wrong, missing or extra, and how far that bar sat
 * from the tempo the bars around it were keeping.
 *
 * Everything here is a pure function of a timeline and a list of events. No
 * clock is read, no file is touched, and the same take against the same score
 * produces the same report on any machine.
 */

/**
 * How far a bar may sit from its local reference before the bar is called out
 * for timing, at each of the three positions the player can choose between.
 *
 * The floor is measured, not chosen. Over forty seeds and eight generated
 * scenarios of **correct playing** -- clean takes of three fixtures, a take at
 * half speed, a restart, and rallentandos of 0.5, 0.7 and 1.3 -- the worst bar
 * reaches 40 ms, which is the local reference's own arithmetic and not the
 * player. A bar the player genuinely rushed sits at 585 ms in the same runs.
 * The signal is fifteen times the floor, so every position here can sit above
 * the floor and still be nowhere near a real mistake: a strictness that
 * reported the 40 ms would be reporting the model, which is the thing ADR-0014
 * exists to stop.
 *
 * `strict` is a little under a demisemiquaver at a walking tempo, and the two
 * looser positions are room for a phrase that breathes. The tests assert the
 * **ordering** of bars by badness rather than these numbers, so tuning them
 * cannot make a test pass that should not.
 */
export const STRICTNESS_MS: Record<TimingStrictness, number> = {
  relaxed: 130,
  normal: 75,
  strict: 45,
}

/** The threshold with nothing chosen, which is what every test measures at. */
export const TIMING_THRESHOLD_MS = STRICTNESS_MS[DEFAULT_STRICTNESS]

export interface PracticeReportInput {
  timeline: ExpectedTimeline
  events: readonly MidiEvent[]
  takeId: string
  /** Defaults to the timeline's own score id. */
  scoreId?: string
  onsetWindowMs?: number
  band?: number
  /**
   * How fussy to be about timing. Only bar **state** moves with it: the notes,
   * the counts and every `timingDeviation` are measurements and are the same
   * at every setting.
   */
  strictness?: TimingStrictness
}

export interface PracticeAnalysis {
  report: PracticeReport
  alignment: Alignment
  expected: ExpectedGroup[]
  played: PlayedGroup[]
  fit: TempoFit | null
  /** One reference per bar that had the evidence for one (ADR-0014). */
  localTempi: Map<number, LocalTempo>
}

export function analyse(input: PracticeReportInput): PracticeAnalysis {
  const expected = expectedGroups(input.timeline)
  const played = playedGroups(input.events, input.onsetWindowMs ?? ONSET_WINDOW_MS)
  const alignment = align(expected, played, { band: input.band })
  const fit = fitTempo(confidentPairs(alignment, expected, played))
  // Before the verdicts, because it decides which leftover groups are extra
  // notes and which are the player having gone back over a bar.
  const { restarts, accountedPlayed } = findRestarts(alignment, expected, played)

  const notes = new Map<number, NoteVerdict[]>()
  /**
   * When the player arrived at each group the score can name, in bar order.
   * Timing is judged from these afterwards rather than inside this loop: a
   * bar's reference comes from its neighbours, so no bar can be judged until
   * every bar has been read.
   */
  const timed: BarredPair[] = []
  const counts = { correct: 0, wrongPitch: 0, missing: 0, extra: 0 }

  for (const bar of input.timeline.bars) {
    notes.set(bar.index, [])
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
      // chord, so what it is judged against is every note in the run -- minus
      // this group's ornaments, which are scored neither way (ADR-0009). A
      // grace note the player struck is not in `heard` at all, so it reaches
      // no verdict, no count and no bar state.
      const heard = withoutOrnaments(struckPitches(played, step), expectedGroup.optionalPitches)
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

      if (absent.length < expectedGroup.pitches.length) {
        timed.push({
          bar: expectedGroup.bar,
          onset: expectedGroup.onset,
          // The beat, not the ornament that anticipates it.
          t: arrivalTime(expectedGroup, played, step),
        })
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
      // A group a restart accounts for is not an extra note. It is a note the
      // score does contain, struck a second time on the way back (ADR-0014).
      if (accountedPlayed.has(step.played)) continue
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

  const localTempi = localTempoCurve(
    timed,
    input.timeline.bars.map((bar) => bar.index)
  )
  const paces = barPaces(timed)

  const bars: BarVerdict[] = input.timeline.bars.map((bar) => {
    const barNotes = notes.get(bar.index) ?? []
    const timingDeviation = barDeviation(paces.get(bar.index), localTempi.get(bar.index))

    return {
      bar: bar.index,
      state: stateFor({
        bar: bar.index,
        notes: barNotes,
        timingDeviation,
        threshold: STRICTNESS_MS[input.strictness ?? DEFAULT_STRICTNESS],
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
      fittedTempo: steadyTempo(timed),
      counts,
      restarts,
      tempoObservations: tempoObservations(paces),
      unalignableFromBar,
    },
    alignment,
    expected,
    played,
    fit,
    localTempi,
  }
}

/**
 * How far this bar sat from where the pace around it should have put it, in
 * milliseconds, averaged over the bar and signed: negative is early.
 *
 * The bar is read through **its own fitted pace** rather than through its
 * individual arrivals, and that pace is compared with the local reference from
 * the bar's own starting point. Two things follow, both deliberate. The figure
 * stops depending on the exact millisecond of the bar's first note-on -- one
 * arrival, carrying every hand's ordinary unevenness, which would otherwise
 * displace the whole bar's verdict. And what is measured is the bar's **pace**
 * against its neighbours': "you took this bar faster than the music around
 * it", which is a sentence a player can act on.
 *
 * The cost is that unevenness *inside* a bar, where the notes drift but the
 * bar keeps its overall pace, is not what this reports. That is a second
 * question and this plan does not ask it.
 *
 * Zero when there is no local reference, or when the bar has no pace of its
 * own: a bar holding a single chord cannot be uneven.
 */
function barDeviation(pace: BarPace | undefined, local: LocalTempo | undefined): number {
  if (local === undefined || pace === undefined) return 0
  return (pace.msPerQuarter - local.msPerQuarter) * pace.spread
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
  threshold: number
  abandonedFrom: number | null
  unalignableFromBar: number | null
}): BarState {
  if (input.unalignableFromBar !== null && input.bar >= input.unalignableFromBar) {
    return 'unalignable'
  }
  if (input.abandonedFrom !== null && input.bar >= input.abandonedFrom) return 'notAttempted'
  if (input.notes.some((note) => note.kind !== 'correct')) return 'wrong'
  if (Math.abs(input.timingDeviation) > input.threshold) return 'timing'
  return 'clean'
}

/** Bars ordered by how far they sat from the fitted tempo, worst first. */
export function barsByTiming(report: PracticeReport): BarVerdict[] {
  return [...report.bars]
    .filter((bar) => bar.state !== 'notAttempted' && bar.state !== 'unalignable')
    .sort((a, b) => Math.abs(b.timingDeviation) - Math.abs(a.timingDeviation))
}
