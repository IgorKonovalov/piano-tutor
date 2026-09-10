import { describe, expect, it } from 'vitest'
import type { ExpectedGroup, PlayedGroup } from './onsetGroups'
import { BAND, align, confidentPairs } from './align'

/**
 * The matcher on its own, with sequences built by hand so each property is
 * about one thing. The property that matters most is at the bottom: nothing
 * here may change when every played time is multiplied by a constant.
 */

function expected(pitchesPerGroup: number[][]): ExpectedGroup[] {
  return pitchesPerGroup.map((pitches, index) => ({
    index,
    onset: index,
    bar: Math.floor(index / 4),
    notes: [],
    pitches: [...pitches].sort((a, b) => a - b),
  }))
}

function played(pitchesPerGroup: number[][], spacingMs = 500): PlayedGroup[] {
  return pitchesPerGroup.map((pitches, index) => ({
    index,
    t: index * spacingMs,
    notes: pitches.map((midi) => ({ midi, t: index * spacingMs, velocity: 70 })),
    pitches: [...pitches].sort((a, b) => a - b),
  }))
}

const SCALE = [[60], [62], [64], [65], [67], [69], [71], [72]]

describe('a take that matches the score', () => {
  it('is all matches, each costing nothing', () => {
    const alignment = align(expected(SCALE), played(SCALE))
    expect(alignment.cost).toBe(0)
    expect(alignment.steps).toHaveLength(SCALE.length)
    expect(alignment.steps.every((step) => step.kind === 'match')).toBe(true)
    expect(alignment.steps.every((step) => step.kind === 'match' && step.difference === 0)).toBe(
      true
    )
    expect(alignment.unalignableFrom).toBeNull()
  })

  it('matches a chord to a chord however the notes are ordered', () => {
    const chords = [[60, 64, 67], [62, 65, 69]]
    const jumbled = [[67, 60, 64], [69, 62, 65]]
    const alignment = align(expected(chords), played(jumbled))
    expect(alignment.cost).toBe(0)
  })
})

describe('a take with a mistake in it', () => {
  it('substitutes rather than deleting and inserting when one note is wrong', () => {
    const wrong = SCALE.map((group, index) => (index === 3 ? [66] : group))
    const alignment = align(expected(SCALE), played(wrong))

    expect(alignment.steps).toHaveLength(SCALE.length)
    expect(alignment.steps.filter((step) => step.kind !== 'match')).toEqual([])
    const at3 = alignment.steps[3]
    expect(at3?.kind === 'match' && at3.difference).toBe(2)
  })

  it('deletes the group a player never struck', () => {
    const short = SCALE.filter((_, index) => index !== 5)
    const alignment = align(expected(SCALE), played(short))

    const missing = alignment.steps.filter((step) => step.kind === 'missing')
    expect(missing).toHaveLength(1)
    expect(missing[0]).toEqual({ kind: 'missing', expected: 5 })
  })

  it('inserts the group the score does not have', () => {
    const long = [...SCALE.slice(0, 4), [61], ...SCALE.slice(4)]
    const alignment = align(expected(SCALE), played(long))

    const extra = alignment.steps.filter((step) => step.kind === 'extra')
    expect(extra).toHaveLength(1)
    expect(extra[0]).toEqual({ kind: 'extra', played: 4 })
  })

  it('keeps everything after a fumble in step, rather than derailing', () => {
    // One dropped note and one added one, three groups apart. Everything else
    // must still line up: an edit distance costs a step for each, where a
    // naive positional comparison would call the whole tail wrong.
    const messy = [SCALE[0], SCALE[1], [63], SCALE[3], SCALE[5], SCALE[6], SCALE[7]] as number[][]
    const alignment = align(expected(SCALE), played(messy))
    const matched = alignment.steps.filter(
      (step) => step.kind === 'match' && step.difference === 0
    )
    expect(matched.length).toBeGreaterThanOrEqual(6)
  })
})

describe('nothing in the match reads a clock', () => {
  it.each([0.25, 0.5, 2, 4])('is the same match when every time is scaled by %s', (factor) => {
    const atTempo = align(expected(SCALE), played(SCALE, 500))
    const scaled = align(expected(SCALE), played(SCALE, 500 * factor))
    expect(scaled.steps).toEqual(atTempo.steps)
    expect(scaled.cost).toBe(atTempo.cost)
  })

  it('is the same match when the take is wildly uneven', () => {
    const even = align(expected(SCALE), played(SCALE, 500))
    const uneven = align(
      expected(SCALE),
      SCALE.map((pitches, index) => ({
        index,
        t: index * index * 137,
        notes: pitches.map((midi) => ({ midi, t: index * index * 137, velocity: 70 })),
        pitches,
      }))
    )
    expect(uneven.steps).toEqual(even.steps)
  })
})

describe('the tie-break puts the player at the earliest place that fits', () => {
  it('reads one struck chord as the first occurrence, not the last', () => {
    // The score plays the same chord four times; the player struck it once.
    // Both readings cost the same, and the take starts at the beginning.
    const repeated = [[60], [60], [60], [60]]
    const alignment = align(expected(repeated), played([[60]]))

    const match = alignment.steps.find((step) => step.kind === 'match')
    expect(match).toEqual({ kind: 'match', expected: 0, played: 0, difference: 0 })
    expect(alignment.steps.filter((step) => step.kind === 'missing').map((s) =>
      s.kind === 'missing' ? s.expected : -1
    )).toEqual([1, 2, 3])
  })

  it('never gives away a match that genuinely lines up', () => {
    const alignment = align(expected(SCALE), played(SCALE))
    expect(alignment.steps.every((step) => step.kind === 'match')).toBe(true)
  })
})

describe('the band', () => {
  it('widens by the difference in length so a take that stops is still reachable', () => {
    const alignment = align(expected(SCALE), played(SCALE.slice(0, 2)))
    expect(alignment.band).toBe(BAND + SCALE.length - 2)
    expect(Number.isFinite(alignment.cost)).toBe(true)
    expect(alignment.unalignableFrom).toBeNull()
  })

  it('says where it lost the player rather than printing a wall of wrong notes', () => {
    // Five bars that line up, then a long stretch with not one pitch in
    // common, then five that line up again. The lengths match, so nothing is
    // out of the band; what makes this a derailment is that for thirty groups
    // running the score and the player share nothing at all.
    const score = expected(Array.from({ length: 40 }, (_, i) => [60 + (i % 12)]))
    const take = played([
      ...Array.from({ length: 5 }, (_, i) => [60 + (i % 12)]),
      ...Array.from({ length: 30 }, () => [100]),
      ...Array.from({ length: 5 }, (_, i) => [60 + ((i + 35) % 12)]),
    ])

    const alignment = align(score, take)
    expect(alignment.unalignableFrom).toBe(5)
  })

  it('a short stretch of nonsense is a fumble, not a derailment', () => {
    const score = expected(Array.from({ length: 40 }, (_, i) => [60 + (i % 12)]))
    const take = played([
      ...Array.from({ length: 5 }, (_, i) => [60 + (i % 12)]),
      ...Array.from({ length: 4 }, () => [100]),
      ...Array.from({ length: 31 }, (_, i) => [60 + ((i + 9) % 12)]),
    ])
    expect(align(score, take).unalignableFrom).toBeNull()
  })

  it('a stop halfway is short, not lost', () => {
    const score = expected(Array.from({ length: 200 }, (_, i) => [60 + (i % 12)]))
    const take = played(Array.from({ length: 40 }, (_, i) => [60 + (i % 12)]))
    const alignment = align(score, take)
    expect(alignment.unalignableFrom).toBeNull()
    expect(alignment.steps.filter((s) => s.kind === 'match')).toHaveLength(40)
  })
})

describe('confidentPairs', () => {
  it('offers one pair per matched group, in score order', () => {
    const score = expected(SCALE)
    const take = played(SCALE, 400)
    const pairs = confidentPairs(align(score, take), score, take)

    expect(pairs).toHaveLength(SCALE.length)
    expect(pairs.map((pair) => pair.onset)).toEqual(score.map((group) => group.onset))
    expect(pairs.map((pair) => pair.t)).toEqual(take.map((group) => group.t))
  })

  it('leaves out a group where nothing at all matched', () => {
    // A group played entirely wrong says nothing about when the player meant
    // to be, so it must not drag the tempo fit towards itself.
    const wrong = SCALE.map((group, index) => (index === 2 ? [90] : group))
    const score = expected(SCALE)
    const take = played(wrong)
    const pairs = confidentPairs(align(score, take), score, take)
    expect(pairs.map((pair) => pair.onset)).not.toContain(2)
  })

  it('is empty when nothing was played', () => {
    const score = expected(SCALE)
    expect(confidentPairs(align(score, []), score, [])).toEqual([])
  })
})
