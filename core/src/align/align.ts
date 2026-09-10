import {
  type ExpectedGroup,
  type PlayedGroup,
  pitchDifference,
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

export type Step =
  /** Played `played` where the score wanted `expected`. */
  | { kind: 'match'; expected: number; played: number; difference: number }
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

  // One row at a time, but the whole choice grid is kept so the path can be
  // walked back. `choice[i][j]` is how cell (i, j) was reached.
  const cost: number[][] = []
  const choice: Step['kind'][][] = []

  for (let i = 0; i <= n; i++) {
    cost.push(new Array<number>(m + 1).fill(UNREACHABLE))
    choice.push(new Array<Step['kind']>(m + 1).fill('match'))
  }
  const at = (i: number, j: number): number =>
    j < 0 || j > m || Math.abs(i - j) > band ? UNREACHABLE : (cost[i]?.[j] ?? UNREACHABLE)

  const row0 = cost[0]
  if (row0 !== undefined) row0[0] = 0

  for (let i = 0; i <= n; i++) {
    const lo = Math.max(0, i - band)
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
      if (i > 0 && j > 0 && expectedGroup !== undefined && playedGroup !== undefined) {
        const substitution =
          at(i - 1, j - 1) + pitchDifference(expectedGroup.pitches, playedGroup.pitches)
        if (substitution < best) {
          best = substitution
          how = 'match'
        }
      }

      const row = cost[i]
      const choices = choice[i]
      if (row !== undefined) row[j] = best
      if (choices !== undefined) choices[j] = how
    }
  }

  const steps: Step[] = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const how = i === 0 ? 'extra' : j === 0 ? 'missing' : (choice[i]?.[j] ?? 'match')
    if (how === 'match' && i > 0 && j > 0) {
      const expectedGroup = expected[i - 1]
      const playedGroup = played[j - 1]
      steps.push({
        kind: 'match',
        expected: i - 1,
        played: j - 1,
        difference:
          expectedGroup === undefined || playedGroup === undefined
            ? 0
            : pitchDifference(expectedGroup.pitches, playedGroup.pitches),
      })
      i--
      j--
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
      const playedGroup = played[step.played]
      sharesNothing =
        expectedGroup !== undefined &&
        playedGroup !== undefined &&
        step.difference >= expectedGroup.pitches.length + playedGroup.pitches.length
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
    if (step.difference >= expectedGroup.pitches.length + playedGroup.pitches.length) continue
    pairs.push({ onset: expectedGroup.onset, t: playedGroup.t })
  }
  return pairs
}
