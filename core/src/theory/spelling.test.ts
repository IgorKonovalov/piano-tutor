import { describe, expect, it } from 'vitest'
import { spellNote, spellNotes, spellPitchClass, spellingFor } from './spelling'
import type { KeyEstimate, KeyMode } from './key'

function key(tonic: string, mode: KeyMode = 'major', confident = true): KeyEstimate {
  return { tonic, mode, name: `${tonic} ${mode}`, confidence: confident ? 1 : 0.2, confident }
}

describe('with no key in force', () => {
  const spelling = spellingFor(null)

  it('defaults to sharps', () => {
    expect(spelling.flats).toBe(false)
    expect(spellPitchClass(1, spelling)).toBe('C#')
    expect(spellPitchClass(10, spelling)).toBe('A#')
  })

  it('names the naturals plainly', () => {
    expect(spellNotes([60, 62, 64, 65, 67, 69, 71], spelling)).toEqual([
      'C4',
      'D4',
      'E4',
      'F4',
      'G4',
      'A4',
      'B4',
    ])
  })

  it('does the same for a key it is not confident about', () => {
    expect(spellPitchClass(10, spellingFor(key('F', 'major', false)))).toBe('A#')
  })
})

describe('the key signature decides', () => {
  it('spells the seventh of F major as B flat', () => {
    expect(spellPitchClass(10, spellingFor(key('F')))).toBe('Bb')
  })

  it('spells F sharp in D major and G flat in D flat major', () => {
    expect(spellPitchClass(6, spellingFor(key('D')))).toBe('F#')
    expect(spellPitchClass(6, spellingFor(key('Db')))).toBe('Gb')
  })

  it('gives every degree of D flat major its own letter', () => {
    const spelling = spellingFor(key('Db'))
    expect(spellNotes([61, 63, 65, 66, 68, 70, 72], spelling)).toEqual([
      'Db4',
      'Eb4',
      'F4',
      'Gb4',
      'Ab4',
      'Bb4',
      'C5',
    ])
  })

  it('follows a minor key’s signature', () => {
    const spelling = spellingFor(key('C', 'minor'))
    expect(spelling.flats).toBe(true)
    expect(spellPitchClass(3, spelling)).toBe('Eb')
    expect(spellPitchClass(8, spelling)).toBe('Ab')
  })

  it('leans the same way for a note outside the scale', () => {
    // B natural is not in F major; a flat key still spells the chromatic
    // neighbours from the flat side.
    const spelling = spellingFor(key('F'))
    expect(spellPitchClass(6, spelling)).toBe('Gb')
  })

  it('keeps A minor on the naturals', () => {
    const spelling = spellingFor(key('A', 'minor'))
    expect(spellNotes([57, 59, 60, 62, 64, 65, 67], spelling)).toEqual([
      'A3',
      'B3',
      'C4',
      'D4',
      'E4',
      'F4',
      'G4',
    ])
  })
})

describe('octave numbers', () => {
  it('puts middle C in octave 4', () => {
    expect(spellNote(60, spellingFor(null))).toBe('C4')
  })

  it('numbers the bottom and top of an 88-key piano', () => {
    expect(spellNote(21, spellingFor(null))).toBe('A0')
    expect(spellNote(108, spellingFor(null))).toBe('C8')
  })

  it('keeps a B sharp in the octave its letter belongs to', () => {
    // C4 named as a B sharp is B#3: the letter B sits below the octave
    // boundary the MIDI number has already crossed.
    const spelling = { names: ['B#', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'], flats: false }
    expect(spellNote(60, spelling)).toBe('B#3')
  })

  it('keeps a C flat in the octave its letter belongs to', () => {
    const spelling = { names: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'Cb'], flats: true }
    // Cb4 and B3 are the same key; the letter C carries it into the next octave.
    expect(spellNote(59, spelling)).toBe('Cb4')
  })
})
