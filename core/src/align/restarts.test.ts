import { describe, expect, it } from 'vitest'
import { ExpectedTimelineSchema, type ExpectedTimeline } from '../../../shared/score'
import scaleJson from '../../fixtures/scores/scale-c-major.timeline.json'
import { perturb } from '../midi/perturb'
import { align } from './align'
import { expectedGroups, playedGroups } from './onsetGroups'
import { MIN_RESTART_GROUPS, findRestarts } from './restarts'

/**
 * Restart detection against the oracle. `restartAtBar` declares the bar it
 * went back over, so "bar 2 and only bar 2" is a claim about this code rather
 * than a description of whatever it produced.
 */

const scale: ExpectedTimeline = ExpectedTimelineSchema.parse(scaleJson)
const SEED = 20260910

function found(timeline: ExpectedTimeline, events: ReturnType<typeof perturb>['events']) {
  const expected = expectedGroups(timeline)
  const played = playedGroups(events)
  return findRestarts(align(expected, played), expected, played)
}

describe('findRestarts', () => {
  it('finds the bar the perturbation says the player went back over', () => {
    const played = perturb(scale, {
      seed: SEED,
      perturbations: [{ kind: 'restartAtBar', bar: 2 }],
    })
    const declared = played.verdicts[0]
    if (declared?.kind !== 'restart') throw new Error('the oracle changed shape')

    const { restarts } = found(scale, played.events)
    expect(restarts).toEqual([{ bar: declared.bar, notes: declared.notes }])
  })

  it('accounts for exactly the groups the player struck a second time', () => {
    const played = perturb(scale, {
      seed: SEED,
      perturbations: [{ kind: 'restartAtBar', bar: 2 }],
    })
    const inBar = scale.notes.filter((note) => note.bar === 2)
    const { restarts, accountedPlayed } = found(scale, played.events)

    expect(restarts[0]?.notes).toBe(inBar.length)
    expect(accountedPlayed.size).toBe(inBar.length)
  })

  it('reports nothing at all when the player did not go back', () => {
    const clean = perturb(scale, { seed: SEED })
    const { restarts, accountedPlayed } = found(scale, clean.events)
    expect(restarts).toEqual([])
    expect(accountedPlayed.size).toBe(0)
  })

  it('reports two restarts in a take that has two', () => {
    const played = perturb(scale, {
      seed: SEED,
      perturbations: [
        { kind: 'restartAtBar', bar: 1 },
        { kind: 'restartAtBar', bar: 2 },
      ],
    })
    const { restarts } = found(scale, played.events)
    expect(restarts.map((restart) => restart.bar)).toEqual([1, 2])
  })

  it('is not fooled by a wrong note, which is a mistake and not a repeat', () => {
    const played = perturb(scale, {
      seed: SEED,
      perturbations: [{ kind: 'substitutePitch', bar: 2, index: 0, semitones: 1 }],
    })
    expect(found(scale, played.events).restarts).toEqual([])
  })

  it('does not call one leftover group a restart', () => {
    // A doubled note, a hand that came down twice, a note the piece never had:
    // whatever it is, it is not evidence that the player went back to a bar.
    const played = perturb(scale, {
      seed: SEED,
      perturbations: [{ kind: 'insertNote', bar: 1, midi: 66, index: 0 }],
    })
    expect(MIN_RESTART_GROUPS).toBeGreaterThan(1)
    expect(found(scale, played.events).restarts).toEqual([])
  })

  it('does not read a piece whose figuration repeats as a restart', () => {
    // The risk this guard exists for: a piece that says the same thing twice.
    // Bars 1 and 2 of `repeated` are identical, and the player plays them both
    // as written. Nothing is left over, so there is nothing to mistake.
    const repeated = repeatedTimeline()
    const clean = perturb(repeated, { seed: SEED })
    expect(found(repeated, clean.events).restarts).toEqual([])

    // And with the same piece genuinely restarted, it is still found.
    const again = perturb(repeated, {
      seed: SEED,
      perturbations: [{ kind: 'restartAtBar', bar: 2 }],
    })
    expect(found(repeated, again.events).restarts).toEqual([{ bar: 2, notes: 4 }])
  })
})

/** Three bars of four quarters, where bars 1 and 2 are note for note the same. */
function repeatedTimeline(): ExpectedTimeline {
  const figure = [60, 62, 64, 65]
  const notes = [0, 1, 2].flatMap((bar) =>
    figure.map((midi, index) => ({
      midi,
      onset: bar * 4 + index,
      duration: 1,
      bar,
      staff: 0,
      voice: 0,
      tied: false,
      optional: false,
      ornament: null,
      fermata: false,
    }))
  )
  return ExpectedTimelineSchema.parse({
    scoreId: '0'.repeat(32),
    notes,
    bars: [0, 1, 2].map((index) => ({ index, onset: index * 4, beats: 4 })),
    pedal: [],
    dynamics: [],
    tempo: [],
  })
}
