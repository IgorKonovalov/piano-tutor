import { describe, expect, it } from 'vitest'
import {
  ExpectedBarSchema,
  ExpectedTimelineSchema,
  type ExpectedNote,
  type ExpectedTimeline,
} from '../../../shared/score'
import emptyCarrier from '../../fixtures/scores/empty-carrier-bar.timeline.json'
import grace from '../../fixtures/scores/grace-note.timeline.json'
import keyAndTime from '../../fixtures/scores/key-and-time-change.timeline.json'
import multiRest from '../../fixtures/scores/multi-rest-and-ties.timeline.json'
import pickup from '../../fixtures/scores/pickup-two-hands.timeline.json'
import scale from '../../fixtures/scores/scale-c-major.timeline.json'
import {
  barAt,
  barTableProblems,
  canonicalTimeline,
  compareNotes,
  graceNotes,
  noteBarProblems,
  notesInBar,
  scoredNotes,
  timelineFingerprint,
  totalQuarters,
} from './timeline'

/**
 * The committed timelines are the contract between the renderer's adapter and
 * everything downstream. `core/` reads them as JSON with no DOM and no OSMD,
 * which is the whole point of ADR-0005's split: alignment is testable with a
 * file and no window.
 */

const FIXTURES: Record<string, ExpectedTimeline> = {
  'scale-c-major': ExpectedTimelineSchema.parse(scale),
  'pickup-two-hands': ExpectedTimelineSchema.parse(pickup),
  'key-and-time-change': ExpectedTimelineSchema.parse(keyAndTime),
  'multi-rest-and-ties': ExpectedTimelineSchema.parse(multiRest),
  'grace-note': ExpectedTimelineSchema.parse(grace),
  'empty-carrier-bar': ExpectedTimelineSchema.parse(emptyCarrier),
}

describe.each(Object.entries(FIXTURES))('%s', (_name, timeline) => {
  it('has a bar table with no gap and no skipped index', () => {
    // A zero-length carrier bar is *named* by this function and is not a gap
    // (ADR-0018), so it is the one report a well-formed table may carry. Stated
    // as the exact expected list rather than as a filter, so that a real
    // contiguity break in a fixture that also has an empty bar still fails.
    expect(barTableProblems(timeline)).toEqual(
      timeline.bars.filter((bar) => bar.beats === 0).map((bar) => `bar ${bar.index} has no length`)
    )
  })

  it('puts every note inside the bar it names', () => {
    expect(noteBarProblems(timeline)).toEqual([])
  })

  it('is ordered by onset, then pitch', () => {
    const sorted = [...timeline.notes].sort(compareNotes)
    expect(timeline.notes).toEqual(sorted)
  })
})

describe('scale-c-major', () => {
  const timeline = FIXTURES['scale-c-major'] as ExpectedTimeline

  it('has four bars', () => {
    expect(timeline.bars).toHaveLength(4)
    expect(timeline.bars.map((bar) => bar.index)).toEqual([0, 1, 2, 3])
  })

  it('is the pitches of a two-octave C major scale, in order', () => {
    expect(timeline.notes.map((note) => note.midi)).toEqual([
      60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84,
    ])
  })

  it('is one quarter note per beat, four to a bar', () => {
    expect(timeline.notes.map((note) => note.onset)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ])
    expect(timeline.notes.every((note) => note.duration === 1)).toBe(true)
    expect(timeline.bars.every((bar) => bar.beats === 4)).toBe(true)
    // Sixteen beats, and the last is the written rest.
    expect(totalQuarters(timeline)).toBe(16)
  })

  it('is one voice on one staff, with no ties and no grace notes', () => {
    expect(new Set(timeline.notes.map((note) => note.staff))).toEqual(new Set([0]))
    expect(timeline.notes.some((note) => note.tied)).toBe(false)
    expect(scoredNotes(timeline)).toHaveLength(timeline.notes.length)
  })
})

describe('pickup-two-hands', () => {
  const timeline = FIXTURES['pickup-two-hands'] as ExpectedTimeline
  const pickupBar = timeline.bars[0]
  const firstFullBar = timeline.bars[1]

  it('has an anacrusis: the first bar is shorter than the metre that follows', () => {
    expect(pickupBar?.beats).toBeLessThan(firstFullBar?.beats ?? 0)
    expect(pickupBar?.onset).toBe(0)
  })

  it('puts the first full bar one index after the pickup, whatever the pickup is called', () => {
    // The assertion is the relationship, not a number. Renumbering the pickup
    // to 1 because it looks like bar 1 would satisfy "the first full bar is
    // bar 2" and still colour the wrong bar; it cannot satisfy this.
    expect(firstFullBar?.index).toBe((pickupBar?.index ?? -1) + 1)
    expect(firstFullBar?.onset).toBe(pickupBar?.beats)
  })

  it('attributes the anacrusis notes to the pickup bar and to no other', () => {
    const anacrusis = timeline.notes.filter((note) => note.onset < (firstFullBar?.onset ?? 0))
    expect(anacrusis.length).toBeGreaterThan(0)
    expect(new Set(anacrusis.map((note) => note.bar))).toEqual(new Set([pickupBar?.index]))
    expect(notesInBar(timeline, pickupBar?.index ?? -1)).toEqual(anacrusis)
  })

  it('has a chord in each hand, on two staves', () => {
    const inPickup = notesInBar(timeline, pickupBar?.index ?? -1)
    const staves = new Set(inPickup.map((note) => note.staff))
    expect(staves).toEqual(new Set([0, 1]))
    for (const staff of staves) {
      const struck = inPickup.filter((note) => note.staff === staff && note.onset === 0)
      expect(struck.length).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('key-and-time-change', () => {
  const timeline = FIXTURES['key-and-time-change'] as ExpectedTimeline

  it('changes metre mid-piece: two bars of four beats, then two of three', () => {
    expect(timeline.bars.map((bar) => bar.beats)).toEqual([4, 4, 3, 3])
    expect(timeline.bars.map((bar) => bar.onset)).toEqual([0, 4, 8, 11])
    expect(totalQuarters(timeline)).toBe(14)
  })

  it('carries the sounding pitch through the key change', () => {
    // F sharp 5 is 78, and it is in the key signature rather than written as
    // an accidental: a timeline that read only accidentals would say 77.
    expect(timeline.notes.filter((note) => note.midi === 78)).toHaveLength(2)
    expect(timeline.notes.filter((note) => note.midi === 77)).toHaveLength(0)
  })
})

describe('multi-rest-and-ties', () => {
  const timeline = FIXTURES['multi-rest-and-ties'] as ExpectedTimeline

  it('spans the multi-measure rest without a gap: seven bars, three of them rest', () => {
    expect(timeline.bars.map((bar) => bar.index)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(timeline.bars.map((bar) => bar.onset)).toEqual([0, 4, 8, 12, 16, 20, 24])
    // Bars 2, 3 and 4 are the multi-rest. They are drawn as one object and
    // they are still three bars, each with no note in it.
    for (const bar of [2, 3, 4]) {
      expect(barAt(timeline, bar)).toBeDefined()
      expect(notesInBar(timeline, bar)).toEqual([])
    }
  })

  it('reports one note per tied pair, carrying the summed duration', () => {
    const tied = timeline.notes.filter((note) => note.tied)
    expect(tied).toHaveLength(2)

    // C4 is two whole notes tied across bars 0 and 1: struck once, held eight
    // quarters, and attributed to the bar it was struck in.
    expect(tied[0]).toMatchObject({ midi: 60, onset: 0, duration: 8, bar: 0 })
    // E4 is two halves tied across bars 5 and 6.
    expect(tied[1]).toMatchObject({ midi: 64, onset: 22, duration: 4, bar: 5 })

    // Four key presses in a piece that writes six noteheads.
    expect(timeline.notes).toHaveLength(4)
  })
})

describe('empty-carrier-bar', () => {
  const timeline = FIXTURES['empty-carrier-bar'] as ExpectedTimeline

  it('keeps the attributes-only measure as a bar of no length, at its own index', () => {
    // The shape BWV 555 has and every fixture before this one hid: a real bar,
    // indexed where the engraver put it, with nothing in it and no duration.
    expect(timeline.bars.map((bar) => bar.index)).toEqual([0, 1, 2])
    expect(timeline.bars.map((bar) => bar.beats)).toEqual([4, 0, 3])
    expect(timeline.bars.map((bar) => bar.onset)).toEqual([0, 4, 4])
    expect(notesInBar(timeline, 1)).toEqual([])
  })

  it('parses, where `positive()` refused the whole timeline', () => {
    // The defect itself: this is what `player:play` did to BWV 555. The
    // practice path built the same timeline in the renderer and validated
    // nothing, so the score practised and would not play.
    expect(() => ExpectedTimelineSchema.parse(emptyCarrier)).not.toThrow()
    expect(ExpectedBarSchema.safeParse({ index: 1, onset: 4, beats: 0 }).success).toBe(true)
    expect(ExpectedBarSchema.safeParse({ index: 1, onset: 4, beats: -1 }).success).toBe(false)
  })

  it('names the empty bar and reports no contiguity break', () => {
    // A report, not a refusal (ADR-0018). The bar stays legal and stops being
    // invisible: `onset + beats` of bar 0 reaches bar 1 and bar 1 reaches bar
    // 2, so the check that exists could never have seen this one.
    expect(barTableProblems(timeline)).toEqual(['bar 1 has no length'])
  })

  it('spans the empty bar without losing a beat either side of it', () => {
    expect(totalQuarters(timeline)).toBe(7)
    expect(notesInBar(timeline, 0).map((note) => note.midi)).toEqual([60, 62, 64, 65])
    expect(notesInBar(timeline, 2).map((note) => note.midi)).toEqual([67, 69, 71])
    expect(noteBarProblems(timeline)).toEqual([])
  })

  it('still flags a note that claims the bar of no length', () => {
    // `noteBarProblems` needs no change to catch this: the note fails
    // `onset < bar.onset + bar.beats` for every zero-length bar, whatever its
    // onset, so nothing can hide inside one.
    const firstNote = timeline.notes[0]
    if (firstNote === undefined) throw new Error('fixture has no notes')
    const misplaced: ExpectedTimeline = {
      ...timeline,
      notes: [...timeline.notes, { ...firstNote, midi: 67, onset: 4, bar: 1 }],
    }
    expect(noteBarProblems(misplaced)).toEqual(['note at 4 is outside bar 1'])
  })
})

describe('canonicalTimeline and timelineFingerprint', () => {
  const timeline = FIXTURES['scale-c-major'] as ExpectedTimeline

  it('round-trips a committed fixture byte for byte', () => {
    expect(canonicalTimeline(timeline)).toBe(`${JSON.stringify(scale, null, 2)}\n`)
  })

  it('is stable, and changes when a single note moves', () => {
    const first = timelineFingerprint(timeline)
    expect(timelineFingerprint(timeline)).toBe(first)
    expect(first).toMatch(/^[0-9a-f]{16}$/)

    const firstNote = timeline.notes[0]
    if (firstNote === undefined) throw new Error('fixture has no notes')
    const moved: ExpectedTimeline = {
      ...timeline,
      notes: [{ ...firstNote, midi: firstNote.midi + 1 }, ...timeline.notes.slice(1)],
    }
    expect(timelineFingerprint(moved)).not.toBe(first)
  })

  it('tells two different scores apart', () => {
    const fingerprints = Object.values(FIXTURES).map(timelineFingerprint)
    expect(new Set(fingerprints).size).toBe(fingerprints.length)
  })
})

describe('grace-note', () => {
  const timeline = FIXTURES['grace-note'] as ExpectedTimeline

  it('carries the ornament as a note, marked, rather than dropping it', () => {
    const ornaments = graceNotes(timeline)
    expect(ornaments).toHaveLength(1)
    // B4 before the written C5: the acciaccatura in bar 2 (index 1).
    expect(ornaments[0]?.midi).toBe(71)
    expect(ornaments[0]?.bar).toBe(1)
  })

  it('puts the ornament at the onset of the note it decorates', () => {
    const ornament = graceNotes(timeline)[0] as ExpectedNote
    const principal = scoredNotes(timeline).find((note) => note.midi === 72)
    expect(principal).toBeDefined()
    expect(ornament.onset).toBe(principal?.onset)
  })

  it('leaves the ornament out of what is scored, and only the ornament', () => {
    expect(scoredNotes(timeline)).toHaveLength(timeline.notes.length - 1)
    expect(scoredNotes(timeline).some((note) => note.grace)).toBe(false)
    expect(scoredNotes(timeline).map((note) => note.midi)).toEqual([
      60, 62, 64, 65, 67, 69, 72, 74, 76, 77, 79,
    ])
  })
})

describe('the helpers alignment will use', () => {
  const timeline = FIXTURES['pickup-two-hands'] as ExpectedTimeline

  it('excludes grace notes from what is scored', () => {
    const withGrace: ExpectedTimeline = {
      ...timeline,
      notes: timeline.notes.map((note, index) => ({ ...note, grace: index === 0 })),
    }
    expect(scoredNotes(withGrace)).toHaveLength(timeline.notes.length - 1)
    expect(scoredNotes(withGrace).some((note) => note.grace)).toBe(false)
  })

  it('reports a gap in the bar table rather than hiding it', () => {
    const broken: ExpectedTimeline = {
      ...timeline,
      bars: timeline.bars.filter((bar) => bar.index !== 1),
    }
    expect(barTableProblems(broken)).not.toEqual([])
  })
})
