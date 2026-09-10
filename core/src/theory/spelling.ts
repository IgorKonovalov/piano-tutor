import { Key, Note, Scale } from 'tonal'
import type { KeyEstimate } from './key'

/**
 * What to call a pitch. The same key on the piano is F# in D major and Gb in
 * Db major, and the staff, the chord names and the labels all have to agree,
 * so the choice is made once, here, from the estimated key.
 *
 * With no confident key the default is sharps, which is the convention for an
 * ascending chromatic line and the least surprising fallback.
 */

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

export interface Spelling {
  /** Pitch-class index to note letter with accidental, e.g. 'Bb'. */
  names: readonly string[]
  /** True when the key signature is written with flats. */
  flats: boolean
}

/** How many flats or sharps the key signature carries; negative means flats. */
function alterationOf(key: KeyEstimate): number {
  return key.mode === 'major'
    ? Key.majorKey(key.tonic).alteration
    : Key.minorKey(key.tonic).alteration
}

/**
 * The scale's own note names take priority, so a degree of the key is always
 * spelled the way the key signature writes it. Pitch classes outside the scale
 * fall back to the side the signature leans, which keeps a chromatic passing
 * note from being spelled against its neighbours.
 */
export function spellingFor(key: KeyEstimate | null): Spelling {
  if (key === null || !key.confident) return { names: SHARP_NAMES, flats: false }

  const alteration = alterationOf(key)
  const flats = alteration < 0
  const names = [...(flats ? FLAT_NAMES : SHARP_NAMES)]

  const scale =
    key.mode === 'major'
      ? Scale.get(`${key.tonic} major`).notes
      : Scale.get(`${key.tonic} minor`).notes

  for (const note of scale) {
    const chroma = Note.chroma(note)
    if (chroma !== undefined) names[chroma] = note
  }
  return { names, flats }
}

/** 'Bb' for a pitch class, in the given spelling. */
export function spellPitchClass(pitchClass: number, spelling: Spelling): string {
  return spelling.names[((pitchClass % 12) + 12) % 12] ?? 'C'
}

/**
 * 'Bb3' for a MIDI note. The octave is the one the letter belongs to, which is
 * not always the octave of the MIDI number: B#3 and C4 are the same key, and
 * naming it B# has to keep it in octave 3.
 */
export function spellNote(midi: number, spelling: Spelling): string {
  const name = spellPitchClass(midi % 12, spelling)
  const naturalOctave = Math.floor(midi / 12) - 1

  // The octave belongs to the letter, not to the MIDI number, and the two part
  // company at the C boundary: B#3 and C4 are one key, and so are Cb4 and B3.
  const letter = name[0]
  let octave = naturalOctave
  if (letter === 'B' && midi % 12 === 0) octave -= 1
  if (letter === 'C' && midi % 12 === 11) octave += 1

  return `${name}${octave}`
}

export function spellNotes(midiNotes: readonly number[], spelling: Spelling): string[] {
  return midiNotes.map((midi) => spellNote(midi, spelling))
}
