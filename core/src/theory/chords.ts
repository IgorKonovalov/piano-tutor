import { Chord, Progression } from 'tonal'
import type { KeyEstimate } from './key'
import { spellNote, spellPitchClass, type Spelling } from './spelling'

/**
 * What the held notes are called.
 *
 * `tonal` does the recognition; this module does the choosing and the naming.
 * Two things it adds. Tonal returns every reading of a set, ordered by its own
 * rules, and those rules will offer `Em#5` for a C major triad in first
 * inversion -- correct, and not what anybody plays. And tonal spells a plain
 * major triad `CM`, where a player reads `C`.
 */

/**
 * How ordinary each chord type is, lowest first. A type that is not here is
 * not wrong, just rarer than everything that is, and sorts after all of it.
 */
const TYPE_RANK: Record<string, number> = {
  major: 0,
  minor: 1,
  'dominant seventh': 2,
  'minor seventh': 3,
  'major seventh': 4,
  sixth: 5,
  // A m7b5 is the ii of every minor key; the same four notes read as an
  // inverted minor sixth are the rarer intent by a wide margin.
  'half-diminished': 6,
  'minor sixth': 7,
  'suspended fourth': 8,
  'suspended second': 9,
  diminished: 10,
  'diminished seventh': 11,
  augmented: 12,
  'minor major seventh': 13,
  'dominant ninth': 14,
  'major ninth': 15,
  'minor ninth': 16,
  'major sixth ninth': 17,
  'dominant eleventh': 18,
  'dominant thirteenth': 19,
}
const UNRANKED = 40

/**
 * What an inversion costs in the ranking. A slash chord is a real reading, but
 * when a root-position name fits the same notes the player is far likelier to
 * be thinking of that one -- C-E-G-A over a C is a C6, not an Am7/C. Three is
 * enough to outweigh a couple of places in the type table and not enough to
 * beat the gap between a triad and something exotic, which is what keeps
 * `C/E` ahead of `Em#5` for a first-inversion C.
 */
const INVERSION_PENALTY = 3

export interface ChordCandidate {
  /** As a player reads it: 'C', 'C/E', 'Dm7', 'Cdim7'. */
  name: string
  /** Tonal's own symbol, kept so a caller can ask tonal about it again. */
  symbol: string
  type: string
  tonic: string
  /** The bass note when it is not the tonic, otherwise null. */
  bass: string | null
}

/** Tonal spells a plain major triad `CM`; the alias list carries the empty one players use. */
function shortAlias(aliases: readonly string[]): string {
  return aliases.includes('') ? '' : (aliases[0] ?? '')
}

function toCandidate(symbol: string): ChordCandidate | null {
  const chord = Chord.get(symbol)
  if (chord.empty || chord.tonic === null) return null
  const bass = chord.root === '' ? null : chord.root
  return {
    name: `${chord.tonic}${shortAlias(chord.aliases)}${bass === null ? '' : `/${bass}`}`,
    symbol,
    type: chord.type,
    tonic: chord.tonic,
    bass,
  }
}

function score(candidate: ChordCandidate): number {
  return (TYPE_RANK[candidate.type] ?? UNRANKED) + (candidate.bass === null ? 0 : INVERSION_PENALTY)
}

/**
 * Every reading of the held notes, most plausible first. The lowest sounding
 * note is the bass hint: tonal reads the first name it is given as the bass,
 * which is what produces an inversion rather than a different chord.
 */
export function detectChords(
  sounding: readonly number[],
  spelling: Spelling
): ChordCandidate[] {
  if (sounding.length < 2) return []

  const sorted = [...sounding].sort((a, b) => a - b)
  const bass = sorted[0] as number

  // Pitch classes, bass first, each once: an octave doubling is the same
  // chord, and a repeated name confuses the detector.
  const seen = new Set<number>()
  const names: string[] = []
  for (const midi of sorted) {
    const pc = midi % 12
    if (seen.has(pc)) continue
    seen.add(pc)
    names.push(spellPitchClass(pc, spelling))
  }
  // Put the bass first even if a higher voice shares its pitch class.
  const bassName = spellPitchClass(bass % 12, spelling)
  const ordered = [bassName, ...names.filter((n) => n !== bassName)]

  return Chord.detect(ordered)
    .map(toCandidate)
    .filter((c): c is ChordCandidate => c !== null)
    .sort((a, b) => score(a) - score(b))
}

export function detectChord(
  sounding: readonly number[],
  spelling: Spelling
): ChordCandidate | null {
  return detectChords(sounding, spelling)[0] ?? null
}

/**
 * The chord's function in the key, as a roman numeral. Returns null when the
 * chord is not diatonic enough for tonal to place it, which is honest: a
 * numeral nobody can read is worse than no numeral.
 */
export function romanNumeral(candidate: ChordCandidate, key: KeyEstimate | null): string | null {
  if (key === null || !key.confident) return null
  const [numeral] = Progression.toRomanNumerals(key.tonic, [candidate.symbol])
  if (numeral === undefined || numeral === '' || numeral.includes('undefined')) return null

  const degree = /^([b#]*)([IV]+)/.exec(numeral)
  if (degree === null) return null
  const [, accidental = '', roman = ''] = degree

  // Two things tonal does not do. It writes every numeral in upper case, where
  // the convention a player reads carries the quality in the case: I and V for
  // major, ii and vii for minor and diminished. And it suffixes a plain major
  // triad with `M`, the same way it names one `CM`.
  const chord = Chord.get(candidate.symbol)
  const minor = chord.quality === 'Minor' || chord.quality === 'Diminished'
  return `${accidental}${minor ? roman.toLowerCase() : roman}${shortAlias(chord.aliases)}`
}

/** The held notes as names, for the labels panel and the log. */
export function spellSounding(sounding: readonly number[], spelling: Spelling): string[] {
  return [...sounding].sort((a, b) => a - b).map((midi) => spellNote(midi, spelling))
}
