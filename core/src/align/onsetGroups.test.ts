import { describe, expect, it } from 'vitest'
import { ExpectedTimelineSchema, type ExpectedTimeline } from '../../../shared/score'
import type { MidiEvent } from '../../../shared/midi'
import multiRestJson from '../../fixtures/scores/multi-rest-and-ties.timeline.json'
import pickupJson from '../../fixtures/scores/pickup-two-hands.timeline.json'
import {
  ONSET_WINDOW_MS,
  expectedGroups,
  pitchDifference,
  pitchesMissingFrom,
  playedGroups,
} from './onsetGroups'

const pickup: ExpectedTimeline = ExpectedTimelineSchema.parse(pickupJson)
const multiRest: ExpectedTimeline = ExpectedTimelineSchema.parse(multiRestJson)

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
