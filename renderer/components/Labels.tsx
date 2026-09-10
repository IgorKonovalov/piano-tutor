import { memo } from 'react'
import { detectChords, romanNumeral, spellSounding } from '../../core/src/theory/chords'
import type { KeyEstimate } from '../../core/src/theory/key'
import { spellingFor } from '../../core/src/theory/spelling'
import styles from './Labels.module.css'

/** A reserved, empty line: keeps a row's height without any content in it. */
const BLANK = ' '

export interface LabelsProps {
  /** Every pitch currently sounding, keys down and pedalled alike. */
  sounding: number[]
  /** Named `musicalKey` because `key` is React's own prop on an element. */
  musicalKey: KeyEstimate | null
}

/**
 * What the held notes are called, in the key they are being played in.
 *
 * Everything shown is derived here, in the renderer, from `core/`. None of it
 * is a round trip to main: the renderer already has the notes, and a
 * `theory:detect` channel would be a capability that buys nothing.
 */
function LabelsView({ sounding, musicalKey }: LabelsProps) {
  const spelling = spellingFor(musicalKey)
  const candidates = detectChords(sounding, spelling)
  const chord = candidates[0] ?? null
  const numeral = chord === null ? null : romanNumeral(chord, musicalKey)
  const notes = spellSounding(sounding, spelling)

  return (
    <div className={styles.labels} data-testid="labels">
      <div className={styles.panel}>
        <p className={styles.caption}>Chord</p>
        <p
          className={chord === null ? `${styles.value} ${styles.silent}` : styles.value}
          data-testid="chord-name"
        >
          {chord?.name ?? (sounding.length === 0 ? '—' : notes.join(' '))}
        </p>
        {/*
          Every row is always rendered, empty ones included. The panel's height
          is then a constant, and the staff and the keyboard below it do not
          move when a chord gains a notes line or an alternative reading. A
          fixed pixel height would do the same until someone changed a font.
        */}
        <p className={styles.notes}>{chord === null ? BLANK : notes.join('  ')}</p>
        <p className={styles.alternatives} title="Other readings of the same notes">
          {chord !== null && candidates.length > 1
            ? `also ${candidates
                .slice(1, 4)
                .map((c) => c.name)
                .join(', ')}`
            : BLANK}
        </p>
      </div>

      <div className={styles.panel}>
        <p className={styles.caption}>Key</p>
        <p
          className={
            musicalKey === null || !musicalKey.confident
              ? `${styles.smallValue} ${styles.tentative}`
              : styles.smallValue
          }
          data-testid="key-name"
          data-confident={musicalKey?.confident ?? false}
        >
          {musicalKey === null ? '—' : musicalKey.name}
        </p>
        <div className={styles.confidence} aria-hidden="true">
          <div
            className={
              musicalKey?.confident === true
                ? styles.confidenceFill
                : `${styles.confidenceFill} ${styles.low}`
            }
            style={{ width: `${Math.round((musicalKey?.confidence ?? 0) * 100)}%` }}
          />
        </div>
      </div>

      <div className={styles.panel}>
        <p className={styles.caption}>Degree</p>
        <p
          className={numeral === null ? `${styles.smallValue} ${styles.silent}` : styles.smallValue}
          data-testid="roman-numeral"
        >
          {numeral ?? '—'}
        </p>
      </div>
    </div>
  )
}

/**
 * Memoised on the held set rather than on the array's identity. The view
 * repaints every frame and chord detection is the most expensive thing on it;
 * the notes only change when a key goes down or comes up.
 */
export const Labels = memo(LabelsView, (a, b) => {
  if (a.musicalKey !== b.musicalKey) return false
  if (a.sounding.length !== b.sounding.length) return false
  return a.sounding.every((note, index) => note === b.sounding[index])
})
