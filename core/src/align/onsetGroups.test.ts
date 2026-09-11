import { describe, expect, it } from 'vitest'
import {
  ExpectedTimelineSchema,
  type ExpectedNote,
  type ExpectedTimeline,
} from '../../../shared/score'
import type { MidiEvent } from '../../../shared/midi'
import graceJson from '../../fixtures/scores/grace-note.timeline.json'
import multiRestJson from '../../fixtures/scores/multi-rest-and-ties.timeline.json'
import pickupJson from '../../fixtures/scores/pickup-two-hands.timeline.json'
import {
  ONSET_WINDOW_MS,
  expectedGroups,
  pitchDifference,
  pitchesMissingFrom,
  playedGroups,
  withoutForgivenOrnaments,
  withoutOrnaments,
} from './onsetGroups'

const pickup: ExpectedTimeline = ExpectedTimelineSchema.parse(pickupJson)
const multiRest: ExpectedTimeline = ExpectedTimelineSchema.parse(multiRestJson)
const grace: ExpectedTimeline = ExpectedTimelineSchema.parse(graceJson)

function on(t: number, note: number): MidiEvent {
  return { kind: 'noteOn', t, ch: 0, note, velocity: 70 }
}

function off(t: number, note: number): MidiEvent {
  return { kind: 'noteOff', t, ch: 0, note, velocity: 0 }
}

describe('expectedGroups', () => {
  it('makes one group of a chord, both hands together', () => {
    const groups = expectedGroups(pickup)
    const first = groups[0]

    // The anacrusis is two notes in each hand struck at once: one gesture.
    expect(first?.onset).toBe(0)
    expect(first?.pitches).toHaveLength(4)
    expect(new Set(first?.notes.map((note) => note.staff))).toEqual(new Set([0, 1]))
  })

  it('numbers groups in score order and carries the bar through untouched', () => {
    const groups = expectedGroups(pickup)
    expect(groups.map((group) => group.index)).toEqual(groups.map((_, index) => index))
    expect(groups.map((group) => group.onset)).toEqual(
      [...groups.map((group) => group.onset)].sort((a, b) => a - b)
    )
    // The pickup's group is in the pickup's bar, whatever that bar is called.
    expect(groups[0]?.bar).toBe(pickup.bars[0]?.index)
    expect(groups[1]?.bar).toBe(pickup.bars[1]?.index)
  })

  it('leaves a bar with nothing in it out of the group list, not out of the score', () => {
    const groups = expectedGroups(multiRest)
    // Bars 2 to 4 are the multi-measure rest: no group, and no index consumed.
    expect(groups.map((group) => group.bar)).toEqual([0, 5, 5, 6])
    expect(multiRest.bars.map((bar) => bar.index)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('counts a tied pair once, because the key goes down once', () => {
    const groups = expectedGroups(multiRest)
    expect(groups).toHaveLength(4)
    expect(groups.reduce((total, group) => total + group.pitches.length, 0)).toBe(4)
  })
})

describe('playedGroups', () => {
  it('groups note-ons struck together', () => {
    const groups = playedGroups([on(0, 60), on(8, 64), on(15, 67), on(900, 72)])
    expect(groups.map((group) => group.pitches)).toEqual([[60, 64, 67], [72]])
    expect(groups[0]?.t).toBe(0)
    expect(groups[1]?.t).toBe(900)
  })

  it('does not let a fast run collapse into one group', () => {
    // Every note is within the window of the one before it, but the run is far
    // longer than the window. Anchoring to the group's first note is what
    // keeps this six gestures instead of one.
    const events = [0, 40, 80, 120, 160, 200].map((t, index) => on(t, 60 + index))
    const groups = playedGroups(events)
    expect(groups.length).toBeGreaterThan(1)
    for (const group of groups) {
      const spread = Math.max(...group.notes.map((n) => n.t)) - group.t
      expect(spread).toBeLessThanOrEqual(ONSET_WINDOW_MS)
    }
    expect(groups.flatMap((group) => group.pitches)).toHaveLength(events.length)
  })

  it('splits exactly at the window', () => {
    expect(playedGroups([on(0, 60), on(ONSET_WINDOW_MS, 64)])).toHaveLength(1)
    expect(playedGroups([on(0, 60), on(ONSET_WINDOW_MS + 1, 64)])).toHaveLength(2)
  })

  it('ignores note-offs and keeps every note-on', () => {
    const groups = playedGroups([on(0, 60), off(100, 60), on(500, 62), off(600, 62)])
    expect(groups.map((group) => group.pitches)).toEqual([[60], [62]])
  })

  it('keeps a doubled pitch as two notes', () => {
    const groups = playedGroups([on(0, 60), on(5, 60)])
    expect(groups[0]?.pitches).toEqual([60, 60])
  })

  it('is empty for a take with nothing in it', () => {
    expect(playedGroups([])).toEqual([])
    expect(playedGroups([off(0, 60)])).toEqual([])
  })

  it('does not care what order the events arrive in', () => {
    const ordered = playedGroups([on(0, 60), on(10, 64), on(800, 67)])
    const jumbled = playedGroups([on(800, 67), on(10, 64), on(0, 60)])
    expect(jumbled).toEqual(ordered)
  })
})

describe('ornaments attach to the group they decorate (ADR-0009)', () => {
  it('hangs the grace note off its principal, and off no other group', () => {
    const groups = expectedGroups(grace)
    const decorated = groups.filter((group) => group.optionalPitches.length > 0)

    expect(decorated).toHaveLength(1)
    // B4 optional, C5 scored: the same group, and the ornament is not one of
    // the pitches the player is judged on.
    expect(decorated[0]?.optionalPitches).toEqual([71])
    expect(decorated[0]?.pitches).toEqual([72])
  })

  it('leaves the ornament out of the scored sequence entirely', () => {
    const groups = expectedGroups(grace)
    expect(groups.flatMap((group) => group.pitches)).not.toContain(71)
    // Eleven scored notes, each its own onset: one group apiece.
    expect(groups).toHaveLength(11)
  })

  it('attaches forwards when no group sits on the ornament, never backwards', () => {
    // A grace note timestamped a shade ahead of its principal, which is what
    // OSMD produces for some engravings. It must decorate the note it comes
    // before, not the beat the player has already left.
    const ahead: ExpectedTimeline = {
      ...grace,
      notes: grace.notes.map((note) =>
        note.optional ? { ...note, onset: note.onset - 0.25 } : note
      ),
    }
    const groups = expectedGroups(ahead)
    const host = groups.find((group) => group.optionalPitches.length > 0)

    expect(host?.pitches).toEqual([72])
    expect(host?.onset).toBe(6)
  })

  it('drops an ornament with nothing after it to decorate', () => {
    // A grace note past the last scored note decorates nothing, so there is no
    // group whose judgement it could soften. Dropping it is the honest end of
    // "attaches forwards, never backwards".
    const trailing: ExpectedTimeline = {
      ...grace,
      notes: grace.notes.map((note) => (note.optional ? { ...note, onset: 99 } : note)),
    }
    const groups = expectedGroups(trailing)
    expect(groups.every((group) => group.optionalPitches.length === 0)).toBe(true)
  })
})

/** One note of a hand-built timeline: plain unless told otherwise. */
function written(
  midi: number,
  onset: number,
  duration: number,
  marks: Partial<Pick<ExpectedNote, 'optional' | 'ornament'>> = {}
): ExpectedNote {
  return {
    midi,
    onset,
    duration,
    bar: 0,
    staff: 0,
    voice: 1,
    tied: false,
    optional: marks.optional ?? false,
    ornament: marks.ornament ?? null,
  }
}

/**
 * A turn on A4 as ADR-0018 records it: the principal scored and carrying the
 * kind, its realisation B4 A4 G4 A4 optional and inside it, then a plain C5.
 */
function turnTimeline(): ExpectedTimeline {
  const realised = { optional: true, ornament: 'turn' } as const
  return {
    scoreId: 'a'.repeat(32),
    notes: [
      written(69, 0, 1, { ornament: 'turn' }),
      written(71, 0, 0.25, realised),
      written(69, 0.25, 0.25, realised),
      written(67, 0.5, 0.25, realised),
      written(69, 0.75, 0.25, realised),
      written(72, 1, 1),
    ],
    bars: [{ index: 0, onset: 0, beats: 2 }],
    pedal: [],
    dynamics: [],
  }
}

describe('a realised ornament attaches backwards (ADR-0018)', () => {
  it('hangs every realised note off its principal, and none off the next beat', () => {
    const groups = expectedGroups(turnTimeline())

    expect(groups.map((group) => group.pitches)).toEqual([[69], [72]])
    expect(groups[0]?.optionalPitches).toEqual([67, 69, 69, 71])
    expect(groups[1]?.optionalPitches).toEqual([])
  })

  it('keeps the principal scored: it is a group, and its realisation is not', () => {
    const groups = expectedGroups(turnTimeline())
    expect(groups).toHaveLength(2)
    expect(groups[0]?.notes.map((note) => note.ornament)).toEqual(['turn'])
  })

  it('still sends a grace note forwards when it sits between two groups', () => {
    // The same position, two readings: a realised note there belongs to the
    // beat before, a grace note to the beat after.
    const between = (ornament: ExpectedNote['ornament']): ExpectedTimeline => ({
      ...turnTimeline(),
      notes: [
        written(69, 0, 1),
        written(71, 0.5, 0.25, { optional: true, ornament }),
        written(72, 1, 1),
      ],
    })

    expect(expectedGroups(between('turn')).map((g) => g.optionalPitches)).toEqual([[71], []])
    expect(expectedGroups(between(null)).map((g) => g.optionalPitches)).toEqual([[], [71]])
  })
})

describe('withoutForgivenOrnaments', () => {
  const chordWithGraceE = { pitches: [60, 64, 67], optionalPitches: [64] }

  it('forgives nothing when the player struck only what is scored', () => {
    // The latent ADR-0009 defect: a grace note repeating a chord tone. Taking
    // the optional E4 out first would remove the E4 the chord scores.
    expect(withoutForgivenOrnaments([60, 64, 67], chordWithGraceE)).toEqual([60, 64, 67])
  })

  it('forgives the surplus copy when the ornament was struck as well', () => {
    expect(withoutForgivenOrnaments([60, 64, 64, 67], chordWithGraceE)).toEqual([60, 64, 67])
  })

  it('never excuses a scored note the player replaced with the ornament', () => {
    // B4 where A4 is written: B4 is surplus and forgiven, and A4 is still
    // absent from what is judged, so it will be reported missing.
    expect(withoutForgivenOrnaments([71], { pitches: [69], optionalPitches: [67, 69, 69, 71] }))
      .toEqual([])
  })

  it('forgives a whole realised turn down to the one scored strike', () => {
    const turn = { pitches: [69], optionalPitches: [67, 69, 69, 71] }
    expect(withoutForgivenOrnaments([67, 69, 69, 71], turn)).toEqual([69])
    expect(withoutForgivenOrnaments([69], turn)).toEqual([69])
  })

  it('leaves an unforgivable surplus in place', () => {
    expect(withoutForgivenOrnaments([60, 64, 66, 67], chordWithGraceE)).toEqual([60, 64, 66, 67])
  })

  it('agrees with the plain subtraction wherever optional and scored are disjoint', () => {
    const group = { pitches: [72], optionalPitches: [71] }
    for (const struck of [[72], [71, 72], [71, 71, 72], [70, 72], []]) {
      expect(withoutForgivenOrnaments(struck, group)).toEqual(
        withoutOrnaments(struck, group.optionalPitches)
      )
    }
  })
})

describe('withoutOrnaments', () => {
  it('takes each ornament out once, not every copy of that pitch', () => {
    // The player struck the grace B4 and also a written B4 in the same group.
    // One of them is the ornament; the other is a note they are judged on.
    expect(withoutOrnaments([71, 71, 72], [71])).toEqual([71, 72])
  })

  it('leaves a group with no ornament exactly as it was', () => {
    expect(withoutOrnaments([60, 64, 67], [])).toEqual([60, 64, 67])
  })

  it('ignores an ornament the player did not strike', () => {
    expect(withoutOrnaments([72], [71])).toEqual([72])
  })
})

describe('pitchDifference', () => {
  it('is zero for the same notes and counts every note that differs', () => {
    expect(pitchDifference([60, 64, 67], [60, 64, 67])).toBe(0)
    // One written note replaced by one unwritten one is two changes.
    expect(pitchDifference([60, 64, 67], [60, 65, 67])).toBe(2)
    expect(pitchDifference([60, 64, 67], [60, 64])).toBe(1)
    expect(pitchDifference([], [60])).toBe(1)
    expect(pitchDifference([], [])).toBe(0)
  })

  it('treats a doubled pitch as two notes, not as one', () => {
    expect(pitchDifference([60, 60], [60])).toBe(1)
    expect(pitchDifference([60, 60], [60, 60])).toBe(0)
  })

  it('is symmetric', () => {
    expect(pitchDifference([60, 62], [64])).toBe(pitchDifference([64], [60, 62]))
  })
})

describe('pitchesMissingFrom', () => {
  it('returns what the first has and the second does not, as a multiset', () => {
    expect(pitchesMissingFrom([60, 64, 67], [60, 67])).toEqual([64])
    expect(pitchesMissingFrom([60, 60], [60])).toEqual([60])
    expect(pitchesMissingFrom([60], [60, 64])).toEqual([])
  })
})
