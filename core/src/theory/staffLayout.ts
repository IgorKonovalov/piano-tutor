import { spellNote, type Spelling } from './spelling'

/**
 * Where each held note goes on a grand staff, and what accidental it carries.
 *
 * The rule lives here, in `core/`, rather than inside the component, so that
 * "which stave does this note land on" is a fixture test rather than a
 * screenshot. The component's job is to draw the answer.
 *
 * The live staff has no key signature: there are no measures and no rhythm
 * (ADR-0003), so there is nowhere to put one and no bar line to reset it.
 * Every altered note therefore carries its own accidental, and which
 * accidental that is comes from the estimated key through `spelling`.
 */

export type StaveName = 'treble' | 'bass'

/** Middle C. Notes below it read in the bass hand by default. */
export const DEFAULT_SPLIT_POINT = 60

/**
 * A tenth: an octave plus a major third, about the widest a hand reaches. A
 * held set narrower than this is one hand's chord even when it crosses middle
 * C, and splitting it across two staves would misdescribe what was played.
 */
export const ONE_HAND_SPAN = 16

export interface StaffPlacement {
  note: number
  stave: StaveName
  /** VexFlow's key notation: lower-case letter, accidental, slash, octave. */
  key: string
  /** The glyph to draw, or null when the note is a natural in this spelling. */
  accidental: string | null
}

export interface StaffLayout {
  treble: StaffPlacement[]
  bass: StaffPlacement[]
  splitPoint: number
  /** True when a set crossing the split was kept on one stave as one hand. */
  oneHand: boolean
}

const SPELLED = /^([A-G])(#{1,2}|b{1,2})?(-?\d+)$/

function placement(note: number, stave: StaveName, spelling: Spelling): StaffPlacement {
  const spelled = spellNote(note, spelling)
  const parts = SPELLED.exec(spelled)
  const letter = parts?.[1] ?? 'C'
  const accidental = parts?.[2] ?? null
  const octave = parts?.[3] ?? '4'
  return {
    note,
    stave,
    key: `${letter.toLowerCase()}${accidental ?? ''}/${octave}`,
    accidental,
  }
}

export interface StaffLayoutOptions {
  splitPoint?: number
}

export function layoutStaff(
  sounding: readonly number[],
  spelling: Spelling,
  options: StaffLayoutOptions = {}
): StaffLayout {
  const splitPoint = options.splitPoint ?? DEFAULT_SPLIT_POINT
  const notes = [...new Set(sounding)].sort((a, b) => a - b)

  if (notes.length === 0) {
    return { treble: [], bass: [], splitPoint, oneHand: false }
  }

  const lowest = notes[0] as number
  const highest = notes[notes.length - 1] as number
  const crossesSplit = lowest < splitPoint && highest >= splitPoint
  const oneHand = notes.length > 1 && crossesSplit && highest - lowest <= ONE_HAND_SPAN

  if (oneHand) {
    // The stave the chord sits in is the one its middle is nearest, so a chord
    // reaching up from A3 reads in the bass and one reaching down from E4
    // reads in the treble.
    const centre = (lowest + highest) / 2
    const stave: StaveName = centre >= splitPoint ? 'treble' : 'bass'
    const placed = notes.map((note) => placement(note, stave, spelling))
    return {
      treble: stave === 'treble' ? placed : [],
      bass: stave === 'bass' ? placed : [],
      splitPoint,
      oneHand: true,
    }
  }

  const treble: StaffPlacement[] = []
  const bass: StaffPlacement[] = []
  for (const note of notes) {
    const stave: StaveName = note >= splitPoint ? 'treble' : 'bass'
    ;(stave === 'treble' ? treble : bass).push(placement(note, stave, spelling))
  }
  return { treble, bass, splitPoint, oneHand: false }
}

/** Every placement, in pitch order, whichever stave it landed on. */
export function allPlacements(layout: StaffLayout): StaffPlacement[] {
  return [...layout.bass, ...layout.treble].sort((a, b) => a.note - b.note)
}
