import { describe, expect, it } from 'vitest'
import { detectChord, detectChords, romanNumeral, spellSounding } from './chords'
import { type KeyEstimate, type KeyMode } from './key'
import { spellingFor } from './spelling'
import fixture from '../../fixtures/chords.json'

interface ChordCase {
  notes: number[]
  name?: string
  anyOf?: string[]
  key?: string
  why: string
}

const cases = fixture.cases as ChordCase[]

/** A fixture's `key` field, as the estimate the spelling reads. */
function keyFrom(spec: string | undefined): KeyEstimate | null {
  if (spec === undefined) return null
  const [tonic = 'C', mode = 'major'] = spec.split(' ')
  return {
    tonic,
    mode: mode as KeyMode,
    name: spec,
    confidence: 1,
    confident: true,
  }
}

describe('the chord fixture', () => {
  it('carries at least forty held sets', () => {
    expect(cases.length).toBeGreaterThanOrEqual(40)
  })

  it('covers triads, sevenths, inversions, slash chords and two-hand voicings', () => {
    expect(cases.filter((c) => c.notes.length === 3).length).toBeGreaterThanOrEqual(10)
    expect(cases.filter((c) => c.notes.length === 4).length).toBeGreaterThanOrEqual(10)
    expect(cases.filter((c) => c.notes.length >= 5).length).toBeGreaterThanOrEqual(5)
    expect(cases.filter((c) => (c.name ?? '').includes('/')).length).toBeGreaterThanOrEqual(5)
    // A two-hand voicing spans more than an octave and a half.
    const spans = cases.map((c) => Math.max(...c.notes) - Math.min(...c.notes))
    expect(spans.filter((s) => s >= 19).length).toBeGreaterThanOrEqual(5)
  })

  it.each(cases.map((c) => [c.why, c] as const))('%s', (_why, testCase) => {
    const spelling = spellingFor(keyFrom(testCase.key))
    const detected = detectChord(testCase.notes, spelling)
    expect(detected, `nothing detected for ${testCase.notes.join('-')}`).not.toBeNull()

    const accepted = testCase.anyOf ?? [testCase.name as string]
    expect(accepted).toContain(detected!.name)
  })
})

describe('naming', () => {
  const sharps = spellingFor(null)

  it('names a plain major triad the way a player writes it, not CM', () => {
    expect(detectChord([60, 64, 67], sharps)?.name).toBe('C')
  })

  it('prefers a first-inversion triad over the augmented reading of the same notes', () => {
    // Tonal offers Em#5 first for E-G-C; a player is holding a C.
    const candidates = detectChords([64, 67, 72], sharps)
    expect(candidates[0]?.name).toBe('C/E')
    expect(candidates.map((c) => c.name)).toContain('Em#5')
  })

  it('prefers the root-position sixth over the inverted seventh', () => {
    expect(detectChord([60, 64, 67, 69], sharps)?.name).toBe('C6')
    expect(detectChord([57, 60, 64, 67], sharps)?.name).toBe('Am7')
  })

  it('reports the bass separately from the tonic', () => {
    const chord = detectChord([64, 67, 72], sharps)
    expect(chord?.tonic).toBe('C')
    expect(chord?.bass).toBe('E')
  })

  it('ignores octave doubling', () => {
    expect(detectChord([60, 64, 67], sharps)?.name).toBe(
      detectChord([48, 60, 64, 67, 72], sharps)?.name
    )
  })

  it('names nothing for a single note', () => {
    expect(detectChords([60], sharps)).toEqual([])
    expect(detectChord([60], sharps)).toBeNull()
  })

  it('keeps every reading available, most plausible first', () => {
    const candidates = detectChords([62, 65, 69, 72], sharps)
    expect(candidates.length).toBeGreaterThan(1)
    expect(candidates[0]?.name).toBe('Dm7')
    expect(candidates.map((c) => c.name)).toContain('F6/D')
  })
})

describe('spelling in context', () => {
  it('spells the ii-V-I of F major with a B flat', () => {
    const key = keyFrom('F major')!
    const spelling = spellingFor(key)
    expect(spellSounding([55, 58, 62, 65], spelling)).toEqual(['G3', 'Bb3', 'D4', 'F4'])
  })

  it('spells the same key as a sharp with no key in force', () => {
    expect(spellSounding([58], spellingFor(null))).toEqual(['A#3'])
  })

  it('spells F sharp in D major and G flat in D flat major', () => {
    expect(spellSounding([66], spellingFor(keyFrom('D major')))).toEqual(['F#4'])
    expect(spellSounding([66], spellingFor(keyFrom('Db major')))).toEqual(['Gb4'])
  })
})

describe('roman numerals', () => {
  const key = keyFrom('F major')!
  const spelling = spellingFor(key)

  it('places the ii, the V and the I of F major', () => {
    const ii = detectChord([55, 58, 62, 65], spelling)!
    const five = detectChord([48, 52, 55, 58], spelling)!
    const one = detectChord([53, 57, 60], spelling)!
    expect(romanNumeral(ii, key)).toBe('iim7')
    expect(romanNumeral(five, key)).toBe('V7')
    expect(romanNumeral(one, key)).toBe('I')
  })

  it('gives no numeral when no key is confident', () => {
    const chord = detectChord([60, 64, 67], spelling)!
    expect(romanNumeral(chord, null)).toBeNull()
  })
})
