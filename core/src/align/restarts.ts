import type { RestartVerdict } from '../../../shared/score'
import type { Alignment } from './align'
import type { ExpectedGroup, PlayedGroup } from './onsetGroups'

/**
 * The player went back over music they had already played.
 *
 * This is the commonest thing that happens in a practice room and the aligner
 * has no room in the score for it: the score says each group once, the player
 * struck it twice, and the second copy comes out of the matcher as a run of
 * groups nothing was written for. Reported as extra notes it reads as a pile
 * of mistakes, and it is the opposite -- correct notes, played again, because
 * the player was being careful (ADR-0014).
 *
 * **The pitch evidence is what identifies it.** A run of leftover groups whose
 * pitches re-cover a stretch of the score the take has matched elsewhere is a
 * restart, whatever the clock says. A long gap beside it is corroboration a
 * reader may notice and not something this needs: a player who goes straight
 * back without pausing has still gone back.
 */

/**
 * How many groups a run must carry before it can be a restart. Two: one
 * leftover group is a slip, a doubled note or a hand that came down twice, and
 * calling that "you went back to bar 4" would be a confident lie about a piece
 * whose figuration happens to repeat.
 */
export const MIN_RESTART_GROUPS = 2

export interface RestartsFound {
  restarts: RestartVerdict[]
  /**
   * Played groups a restart accounts for, by index. They are not extra notes
   * and the report does not count them as any.
   */
  accountedPlayed: Set<number>
}

function sameGroup(expected: ExpectedGroup, played: PlayedGroup): boolean {
  if (expected.pitches.length !== played.pitches.length) return false
  return expected.pitches.every((pitch, index) => pitch === played.pitches[index])
}

export function findRestarts(
  alignment: Alignment,
  expected: readonly ExpectedGroup[],
  played: readonly PlayedGroup[]
): RestartsFound {
  // Where the score was matched at all. A stretch the player covered twice is
  // matched once and left over once, so the run has to line up with score the
  // matcher did find a home for; a run that lines up with nothing matched is
  // notes the piece never contained.
  const matched = new Set<number>()
  for (const step of alignment.steps) {
    if (step.kind === 'match') matched.add(step.expected)
  }

  const restarts: RestartVerdict[] = []
  const accountedPlayed = new Set<number>()

  for (const run of leftoverRuns(alignment)) {
    if (run.length < MIN_RESTART_GROUPS) continue
    const groups = run.map((index) => played[index]).filter((group) => group !== undefined)
    if (groups.length !== run.length) continue

    const at = lastCovering(expected, matched, groups)
    if (at === null) continue

    restarts.push({
      bar: (expected[at] as ExpectedGroup).bar,
      notes: groups.reduce((total, group) => total + group.notes.length, 0),
    })
    for (const index of run) accountedPlayed.add(index)
  }

  return { restarts, accountedPlayed }
}

/** Maximal runs of consecutive played groups the matcher had no score for. */
function leftoverRuns(alignment: Alignment): number[][] {
  const runs: number[][] = []
  let current: number[] = []
  for (const step of alignment.steps) {
    if (step.kind === 'extra') {
      current.push(step.played)
      continue
    }
    if (current.length > 0) runs.push(current)
    current = []
  }
  if (current.length > 0) runs.push(current)
  return runs
}

/**
 * The **last** stretch of matched score this run re-covers, group for group,
 * or null if there is none. Last rather than first because a player who goes
 * back goes back over the passage they were just in, not over the first place
 * in the piece those notes happen to appear.
 */
function lastCovering(
  expected: readonly ExpectedGroup[],
  matched: ReadonlySet<number>,
  groups: readonly PlayedGroup[]
): number | null {
  for (let start = expected.length - groups.length; start >= 0; start--) {
    let covers = true
    for (let offset = 0; offset < groups.length; offset++) {
      const group = expected[start + offset]
      if (
        group === undefined ||
        !matched.has(start + offset) ||
        !sameGroup(group, groups[offset] as PlayedGroup)
      ) {
        covers = false
        break
      }
    }
    if (covers) return start
  }
  return null
}
