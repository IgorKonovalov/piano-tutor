import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SPLIT_POINT,
  ONE_HAND_SPAN,
  allPlacements,
  layoutStaff,
} from './staffLayout'
import { spellingFor } from './spelling'
import type { KeyEstimate, KeyMode } from './key'
import fixture from '../../fixtures/chords.json'

interface ChordCase {
  notes: number[]
  key?: string
  why: string
}
const cases = fixture.cases as ChordCase[]

function keyFrom(spec: string | undefined): KeyEstimate | null {
  if (spec === undefined) return null
  const [tonic = 'C', mode = 'major'] = spec.split(' ')
  return { tonic, mode: mode as KeyMode, name: spec, confidence: 1, confident: true }
}

const sharps = spellingFor(null)

describe('the staff shows exactly what is held', () => {
  it.each(cases.map((c) => [c.why, c] as const))('%s', (_why, testCase) => {
    const spelling = spellingFor(keyFrom(testCase.key))
    const layout = layoutStaff(testCase.notes, spelling)
    const placed = allPlacements(layout).map((p) => p.note)

    // Nothing lost and nothing invented: the keyboard and the staff are
    // showing the same set of keys.
    expect(placed).toEqual([...new Set(testCase.notes)].sort((a, b) => a - b))
  })

  it('shows nothing when nothing is held', () => {
    const layout = layoutStaff([], sharps)
    expect(layout.treble).toEqual([])
    expect(layout.bass).toEqual([])
  })

  it('drops an octave doubling only from the pitch set, never from the staff', () => {
    // 60 twice is one key pressed; 60 and 72 are two noteheads.
    expect(allPlacements(layoutStaff([60, 60], sharps)).map((p) => p.note)).toEqual([60])
    expect(allPlacements(layoutStaff([60, 72], sharps)).map((p) => p.note)).toEqual([60, 72])
  })
})

describe('the split', () => {
  it('puts middle C in the treble and a low E in the bass', () => {
    // Wide enough to be two hands, so the plain split rule applies.
    const layout = layoutStaff([40, 60], sharps)
    expect(layout.bass.map((p) => p.note)).toEqual([40])
    expect(layout.treble.map((p) => p.note)).toEqual([60])
  })

  it('splits a two-hand chord across the staves', () => {
    // C2 and E2 in the left hand, a C major triad in the right: nineteen
    // semitones apart, so two hands.
    const layout = layoutStaff([36, 40, 60, 64, 67], sharps)
    expect(layout.bass.map((p) => p.note)).toEqual([36, 40])
    expect(layout.treble.map((p) => p.note)).toEqual([60, 64, 67])
    expect(layout.oneHand).toBe(false)
  })

  it('keeps one hand’s chord on one stave when it crosses the split', () => {
    // A3-C4-E4 is an A minor triad under one hand; splitting it across two
    // staves would say the player used two hands.
    const layout = layoutStaff([57, 60, 64], sharps)
    expect(layout.oneHand).toBe(true)
    expect(layout.treble.map((p) => p.note)).toEqual([57, 60, 64])
    expect(layout.bass).toEqual([])
  })

  it('keeps even a semitone across the split under one hand', () => {
    const layout = layoutStaff([59, 60], sharps)
    expect(layout.oneHand).toBe(true)
    expect(layout.bass.map((p) => p.note)).toEqual([59, 60])
  })

  it('puts a one-hand chord in the stave its middle is nearest', () => {
    // Reaching down from G4: the middle sits above middle C.
    const upper = layoutStaff([59, 64, 67], sharps)
    expect(upper.oneHand).toBe(true)
    expect(upper.treble.map((p) => p.note)).toEqual([59, 64, 67])

    // Reaching up from G3: the middle sits below it, so it reads in the bass.
    const lower = layoutStaff([55, 57, 60], sharps)
    expect(lower.oneHand).toBe(true)
    expect(lower.bass.map((p) => p.note)).toEqual([55, 57, 60])
  })

  it('splits at exactly a tenth and no wider', () => {
    const tenth = layoutStaff([57, 57 + ONE_HAND_SPAN], sharps)
    expect(tenth.oneHand).toBe(true)

    const wider = layoutStaff([57, 57 + ONE_HAND_SPAN + 1], sharps)
    expect(wider.oneHand).toBe(false)
    expect(wider.bass.map((p) => p.note)).toEqual([57])
    expect(wider.treble.map((p) => p.note)).toEqual([74])
  })

  it('never claims one hand for a single note', () => {
    expect(layoutStaff([60], sharps).oneHand).toBe(false)
    expect(layoutStaff([59], sharps).oneHand).toBe(false)
  })

  it('takes a different split point', () => {
    // Two hands' worth of span, so the split itself is what is under test.
    const layout = layoutStaff([40, 70], sharps, { splitPoint: 52 })
    expect(layout.splitPoint).toBe(52)
    expect(layout.bass.map((p) => p.note)).toEqual([40])
    expect(layout.treble.map((p) => p.note)).toEqual([70])

    // The same two notes fall the other way when the split moves above them.
    const higher = layoutStaff([40, 70], sharps, { splitPoint: 80 })
    expect(higher.bass.map((p) => p.note)).toEqual([40, 70])
  })

  it('defaults its split point to middle C', () => {
    expect(layoutStaff([60], sharps).splitPoint).toBe(DEFAULT_SPLIT_POINT)
  })
})

describe('keys and accidentals', () => {
  it('writes VexFlow keys in lower case with the octave', () => {
    expect(layoutStaff([60, 64, 67], sharps).treble.map((p) => p.key)).toEqual([
      'c/4',
      'e/4',
      'g/4',
    ])
  })

  it('carries no accidental for a natural', () => {
    expect(layoutStaff([60], sharps).treble[0]?.accidental).toBeNull()
  })

  it('carries the accidental the key spells, not the one the MIDI number suggests', () => {
    const inF = spellingFor(keyFrom('F major'))
    const [placed] = layoutStaff([70], inF).treble
    expect(placed?.key).toBe('bb/4')
    expect(placed?.accidental).toBe('b')

    const [sharped] = layoutStaff([70], sharps).treble
    expect(sharped?.key).toBe('a#/4')
    expect(sharped?.accidental).toBe('#')
  })

  it('spells the ii-V-I of F major with a B flat on the staff', () => {
    const inF = spellingFor(keyFrom('F major'))
    const layout = layoutStaff([55, 58, 62, 65], inF)
    expect(allPlacements(layout).map((p) => p.key)).toEqual(['g/3', 'bb/3', 'd/4', 'f/4'])
  })

  it('keeps the octave with the letter across the C boundary', () => {
    const cFlat = { names: [...sharps.names], flats: true }
    cFlat.names[11] = 'Cb'
    expect(layoutStaff([59], cFlat).bass[0]?.key).toBe('cb/4')
  })
})
