import {
  type ExpectedGroup,
  type PlayedGroup,
  pitchDifference,
  withoutOrnaments,
} from './onsetGroups'

/**
 * Matching what was played against what was written.
 *
 * **Nothing in this file reads a clock.** The cost of a step is the difference
 * between two sets of pitches and the position of the step in the two
 * sequences; not one millisecond enters it. That is what "tempo-free" means
 * and it is the property the tests defend: a piece played evenly at half speed
 * matches perfectly, because a matcher that could tell would be scoring the
 * player against a metronome they were never given. Timing is judged
 * afterwards, by `tempo.ts`, over the pairs this produces.
 *
 * The algorithm is a **banded edit distance** over the two group sequences:
 * substitute one group for another at the cost of their pitch difference,
 * insert a group the score does not have, delete one the player did not play.
 * Banding is what keeps the cost linear in the length of the take rather than
 * quadratic (NFR 12).
 */

/**
 * How far the match may wander from the diagonal, in groups. A player who
 * fumbles adds or drops a handful of notes; twenty-four groups is several bars
 * of slack, far past any stumble, and short enough that a five-thousand-group
 * take is fifty times cheaper than the unbanded comparison.
 *
 * The band is widened by the difference in the two lengths so the end of the
 * take is always reachable -- a take that stops halfway is short, not
 * misaligned, and must not be pushed out of the band for it.
 */
export const BAND = 24

const UNREACHABLE = Number.POSITIVE_INFINITY

/**
 * Inserting or deleting a whole group costs its size plus one. The `+1` breaks
 * the tie in favour of substitution when the two are otherwise equal, which
 * keeps the match in step with the score instead of drifting a group at a time.
 */
function gapCost(pitches: readonly number[]): number {
  return pitches.length + 1
}

/**
 * A written chord may reach the app as several separate events -- broken,
 * rolled, arpeggiated, or simply spread by a player taking their time over it.
 * None of those is a mistake, and **no onset window can join them**: a chord
 * spread across half a second is indistinguishable, by time alone, from two
 * deliberate beats. So one expected group may instead absorb a *run* of played
 * groups.
 *
 * The run is bounded by the size of the chord written -- five written notes
 * can account for at most five struck ones -- so absorbing can never swallow a
 * passage. Measured at the instrument: a player working through a chordal
 * piece put roughly 650 ms between the notes of one chord, thirteen times the
 * grouping window, and every note of it was correct.
 */
const MAX_ABSORBED_GROUPS = 8

/**
 * What absorbing one extra group costs. Small enough that a broken chord beats
 * calling four of its notes missing and four more extra; large enough that two
 * chords played correctly as two events are never merged, since an exact match
 * costs nothing and nothing beats nothing.
 */
const ROLL_COST = 1

/**
 * How far this group's pitches are from what the player struck, with the
 * group's ornaments removed from the played side first (ADR-0009). Every cost
 * in the matcher goes through here, so an ornament can never make a step look
 * more expensive than the same passage without one.
 */
export function ornamentAwareDifference(
  group: ExpectedGroup,
  struck: readonly number[]
): number {
  return pitchDifference(group.pitches, withoutOrnaments(struck, group.optionalPitches))
}

/**
 * How many played groups one expected group may absorb. A written chord bounds
 * it by the notes in the chord; an ornament adds to that bound, because a
 * grace note struck ahead of its principal arrives as **its own played group**
 * -- 50 ms cannot hold an acciaccatura together with the note it decorates,
 * and no window could without also merging two deliberate beats.
 *
 * That is the case the ornament rule mostly turns on: not an extra pitch
 * inside a matched group, but a whole group that is nothing but ornament.
 */
function absorbLimit(group: ExpectedGroup): number {
  return Math.min(MAX_ABSORBED_GROUPS, group.pitches.length + group.optionalPitches.length)
}

export type Step =
  /**
   * Played `playedCount` groups from `played` onward where the score wanted
   * the single group `expected`. `playedCount` is 1 for a chord struck
   * together, and more for one the player broke.
   */
  | { kind: 'match'; expected: number; played: number; playedCount: number; difference: number }
  /** The score wanted this group and nothing was played for it. */
  | { kind: 'missing'; expected: number }
  /** This group was played and the score has nothing there. */
  | { kind: 'extra'; played: number }

export interface Alignment {
  steps: Step[]
  cost: number
  band: number
  /**
   * The expected group index from which the match stopped being trustworthy,
   * or null. See `findUnalignable` for what earns it: past that point the
   * report says "we lost you here", which is honest, rather than printing a
   * wall of wrong notes, which is a confident lie.
   */
  unalignableFrom: number | null
}

export interface AlignOptions {
  band?: number
}

export function align(
  expected: readonly ExpectedGroup[],
  played: readonly PlayedGroup[],
  options: AlignOptions = {}
): Alignment {
  const n = expected.length
  const m = played.length
  const band = (options.band ?? BAND) + Math.abs(n - m)

  // **Only the band is stored.** Each row holds the cells between `lo` and
  // `hi` and nothing else, so the memory is `n x min(m, 2 x band)` rather than
  // `n x m`. Keeping the full grid would make the allocation quadratic even
  // though the inner loop is not, which is the whole of what NFR 12 rests on:
  // a four-hundred-bar take must cost ten times a forty-bar one, not a
  // hundred.
  const lows: number[] = []
  const cost: number[][] = []
  const choice: Step['kind'][][] = []
  const absorbedAt: number[][] = []

  for (let i = 0; i <= n; i++) {
    const lo = Math.max(0, i - band)
    const hi = Math.min(m, i + band)
    lows.push(lo)
    const size = Math.max(0, hi - lo + 1)
    cost.push(new Array<number>(size).fill(UNREACHABLE))
    choice.push(new Array<Step['kind']>(size).fill('match'))
    absorbedAt.push(new Array<number>(size).fill(1))
  }

  const at = (i: number, j: number): number => {
    if (i < 0 || i > n || j < 0 || j > m) return UNREACHABLE
    const row = cost[i]
    const k = j - (lows[i] ?? 0)
    if (row === undefined || k < 0 || k >= row.length) return UNREACHABLE
    return row[k] ?? UNREACHABLE
  }

  const choiceAt = (i: number, j: number): Step['kind'] => {
    const row = choice[i]
    const k = j - (lows[i] ?? 0)
    if (row === undefined || k < 0 || k >= row.length) return 'match'
    return row[k] ?? 'match'
  }

  const absorbedFor = (i: number, j: number): number => {
    const row = absorbedAt[i]
    const k = j - (lows[i] ?? 0)
    if (row === undefined || k < 0 || k >= row.length) return 1
    return row[k] ?? 1
  }

  const row0 = cost[0]
  if (row0 !== undefined) row0[0] = 0

  for (let i = 0; i <= n; i++) {
    const lo = lows[i] ?? 0
    const hi = Math.min(m, i + band)
    for (let j = lo; j <= hi; j++) {
      if (i === 0 && j === 0) continue

      const expectedGroup = expected[i - 1]
      const playedGroup = played[j - 1]

      let best = UNREACHABLE
      let how: Step['kind'] = 'match'

      // The gaps are considered before the match, and every comparison is
      // strict, so a tie goes to the gap. That is the tie-break, and it says:
      // when the evidence cannot choose, put the player at the earliest place
      // in the score that fits. A take is played from the beginning, so one
      // struck chord that could equally be the first or the last occurrence of
      // that chord is the first. Without it, a player who stops after two bars
      // is read as having played the last two, and the bars they never reached
      // come back as wrong notes instead of as not attempted.
      //
      // A match that costs nothing is still strictly cheaper than any gap, so
      // nothing that genuinely lines up is given away by this.
      if (i > 0 && expectedGroup !== undefined) {
        const deletion = at(i - 1, j) + gapCost(expectedGroup.pitches)
        if (deletion < best) {
          best = deletion
          how = 'missing'
        }
      }
      if (j > 0 && playedGroup !== undefined) {
        const insertion = at(i, j - 1) + gapCost(playedGroup.pitches)
        if (insertion < best) {
          best = insertion
          how = 'extra'
        }
      }
      let absorbed = 1
      if (i > 0 && j > 0 && expectedGroup !== undefined && playedGroup !== undefined) {
        const substitution =
          at(i - 1, j - 1) + ornamentAwareDifference(expectedGroup, playedGroup.pitches)
        if (substitution < best) {
          best = substitution
          how = 'match'
          absorbed = 1
        }

        // The same written chord against a run of played groups: the chord as
        // the player actually broke it, or the ornament they played ahead of
        // it, or both.
        //
        // `ROLL_COST` is charged per *spread* group, and a group that is
        // nothing but this group's ornaments is not one: it is not part of the
        // chord, it is the decoration in front of it. Charging it would make
        // taking an ornament cost more than leaving it out, which is the one
        // thing ADR-0009 says must not happen.
        const most = Math.min(absorbLimit(expectedGroup), j)
        const union = [...playedGroup.pitches]
        let ornamentGroups = 0
        for (let run = 2; run <= most; run++) {
          const earlier = played[j - run]
          if (earlier === undefined) break
          union.push(...earlier.pitches)
          if (
            expectedGroup.optionalPitches.length > 0 &&
            withoutOrnaments(earlier.pitches, expectedGroup.optionalPitches).length === 0
          ) {
            ornamentGroups++
          }
          const rolled =
            at(i - 1, j - run) +
            ornamentAwareDifference(expectedGroup, [...union].sort((a, b) => a - b)) +
            Math.max(0, run - 1 - ornamentGroups) * ROLL_COST
          if (rolled < best) {
            best = rolled
            how = 'match'
            absorbed = run
          }
        }
      }

      const row = cost[i]
      const choices = choice[i]
      const runs = absorbedAt[i]
      const k = j - lo
      if (row !== undefined) row[k] = best
      if (choices !== undefined) choices[k] = how
      if (runs !== undefined) runs[k] = absorbed
    }
  }

  const steps: Step[] = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const how = i === 0 ? 'extra' : j === 0 ? 'missing' : choiceAt(i, j)
    if (how === 'match' && i > 0 && j > 0) {
      const run = Math.min(absorbedFor(i, j), j)
      const expectedGroup = expected[i - 1]
      const struck = played.slice(j - run, j).flatMap((group) => group.pitches)
      steps.push({
        kind: 'match',
        expected: i - 1,
        played: j - run,
        playedCount: run,
        difference:
          expectedGroup === undefined
            ? 0
            : ornamentAwareDifference(expectedGroup, [...struck].sort((a, b) => a - b)),
      })
      i--
      j -= run
    } else if (how === 'missing' && i > 0) {
      steps.push({ kind: 'missing', expected: i - 1 })
      i--
    } else {
      steps.push({ kind: 'extra', played: j - 1 })
      j--
    }
  }
  steps.reverse()

  return {
    steps,
    cost: at(n, m),
    band,
    unalignableFrom: findUnalignable(steps, expected, played, band),
  }
}

/**
 * Where the match stops meaning anything.
 *
 * The band is a hard constraint on how far the path may leave the diagonal,
 * but it is widened by the difference in the two lengths, so a take that is
 * simply short -- a player who stopped -- can never be pushed out of it. What
 * a genuine derailment produces instead is a **run of steps with nothing in
 * common**: gaps, or matches where not one pitch of the score's group appears
 * in the player's. That is the wall of errors this exists to avoid printing,
 * and a run of it as long as the band itself is where it stops being a fumble
 * and starts being two different pieces of music.
 *
 * A player who stops halfway produces a long run too -- and their run is
 * exactly the length difference, which the band already exceeds by `BAND`, so
 * it does not trip this. That separation is the whole design: stopping is not
 * derailing.
 */
function findUnalignable(
  steps: readonly Step[],
  expected: readonly ExpectedGroup[],
  played: readonly PlayedGroup[],
  band: number
): number | null {
  let run = 0
  let runStartsAt: number | null = null
  let nextExpected = 0

  for (const step of steps) {
    const here = step.kind === 'extra' ? nextExpected : step.expected
    if (step.kind !== 'extra') nextExpected = step.expected + 1

    let sharesNothing: boolean
    if (step.kind !== 'match') {
      sharesNothing = true
    } else {
      const expectedGroup = expected[step.expected]
      sharesNothing = expectedGroup !== undefined && matchSharesNothing(expectedGroup, played, step)
    }

    if (!sharesNothing) {
      run = 0
      runStartsAt = null
      continue
    }
    if (run === 0) runStartsAt = here
    run++
    if (run >= band && runStartsAt !== null) return runStartsAt
  }
  return null
}

/**
 * True when a matched step has not one pitch in common with what was written:
 * the difference is as large as it could possibly be, which is every expected
 * pitch missing plus every struck one unaccounted for.
 *
 * The struck side is counted **after** the group's ornaments come out
 * (ADR-0009), because `step.difference` was computed that way too. Counting
 * them here and not there would make a group with an ornament look like it
 * shared something it did not, and a run of those is what earns
 * `unalignableFrom`.
 */
function matchSharesNothing(
  expectedGroup: ExpectedGroup,
  played: readonly PlayedGroup[],
  step: Extract<Step, { kind: 'match' }>
): boolean {
  const kept = withoutOrnaments(struckPitches(played, step), expectedGroup.optionalPitches)
  return step.difference >= expectedGroup.pitches.length + kept.length
}

/**
 * When the player arrived at this group, for the purpose of timing.
 *
 * Not simply the first group of the run: an ornament is struck **ahead of the
 * beat**, so a grace note is the wrong thing to measure a bar's timing from --
 * it would read a correctly placed note as early by however long the player
 * took over the ornament. The beat is the first group in the run that carries
 * a pitch the score actually scores.
 */
export function arrivalTime(
  expectedGroup: ExpectedGroup,
  played: readonly PlayedGroup[],
  step: Extract<Step, { kind: 'match' }>
): number {
  const fallback = played[step.played]?.t ?? 0
  if (expectedGroup.optionalPitches.length === 0) return fallback
  for (let k = 0; k < step.playedCount; k++) {
    const group = played[step.played + k]
    if (group === undefined) continue
    if (withoutOrnaments(group.pitches, expectedGroup.optionalPitches).length > 0) return group.t
  }
  return fallback
}

/** How many pitches a match consumed from the played side. */
export function struckCount(
  played: readonly PlayedGroup[],
  step: Extract<Step, { kind: 'match' }>
): number {
  let total = 0
  for (let k = 0; k < step.playedCount; k++) {
    total += played[step.played + k]?.pitches.length ?? 0
  }
  return total
}

/** Every pitch a match consumed, sorted: a broken chord as one set of notes. */
export function struckPitches(
  played: readonly PlayedGroup[],
  step: Extract<Step, { kind: 'match' }>
): number[] {
  const pitches: number[] = []
  for (let k = 0; k < step.playedCount; k++) {
    pitches.push(...(played[step.played + k]?.pitches ?? []))
  }
  return pitches.sort((a, b) => a - b)
}

/** Matched pairs, in order, that a tempo can honestly be fitted to. */
export function confidentPairs(
  alignment: Alignment,
  expected: readonly ExpectedGroup[],
  played: readonly PlayedGroup[]
): { onset: number; t: number }[] {
  const pairs: { onset: number; t: number }[] = []
  for (const step of alignment.steps) {
    if (step.kind !== 'match') continue
    const expectedGroup = expected[step.expected]
    const playedGroup = played[step.played]
    if (expectedGroup === undefined || playedGroup === undefined) continue
    // A group where nothing at all matched says nothing about when the player
    // meant to be; it would drag the fit towards a note they did not intend.
    if (matchSharesNothing(expectedGroup, played, step)) continue
    // The first note of a broken chord is when the player arrived at it -- but
    // an ornament ahead of the beat is not the arrival.
    pairs.push({ onset: expectedGroup.onset, t: arrivalTime(expectedGroup, played, step) })
  }
  return pairs
}
