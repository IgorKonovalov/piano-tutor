import type { BarVerdict, NoteVerdict } from '../../shared/score'
import { spellNote, spellingFor } from '../../core/src/theory/spelling'
import styles from './BarDetail.module.css'

/**
 * What happened in one bar, in words.
 *
 * This is the half of the feedback that is not a colour. A bar can be red on
 * the score and still tell the player nothing; here it says which note was
 * written, which one was struck instead, and whether the bar sat early or
 * late. House rule and ADR-0001's accessibility line: colour is never the only
 * carrier of a verdict.
 */

const STATE_TEXT: Record<BarVerdict['state'], string> = {
  clean: 'Played as written',
  timing: 'Right notes, out of time',
  wrong: 'Wrong notes',
  notAttempted: 'Not reached',
  unalignable: 'Could not follow you here',
}

export interface BarDetailProps {
  bar: BarVerdict | null
  /** Null when no bar is selected yet. */
  index: number | null
}

/**
 * A score has a key signature; a report does not carry it, and a bar detail
 * that says "F sharp" about a piece written in flats reads as a different
 * note. Sharps are the neutral default here, the same one the live staff uses
 * when no key is confident.
 */
const NEUTRAL = spellingFor(null)

function noteName(midi: number): string {
  return spellNote(midi, NEUTRAL)
}

function describe(verdict: NoteVerdict): string {
  switch (verdict.kind) {
    case 'correct':
      return `${noteName(verdict.expected)} as written`
    case 'wrongPitch':
      return `${noteName(verdict.played)} played where ${noteName(verdict.expected)} is written`
    case 'missing':
      return `${noteName(verdict.expected)} written, not played`
    case 'extra':
      return `${noteName(verdict.played)} played, not written`
  }
}

export function BarDetail({ bar, index }: BarDetailProps) {
  if (index === null) {
    return (
      <section className={styles.detail} data-testid="bar-detail">
        <p className={styles.empty}>Click a bar, or type its number, to see what happened in it.</p>
      </section>
    )
  }

  if (bar === undefined || bar === null) {
    return (
      <section className={styles.detail} data-testid="bar-detail" data-bar={index}>
        <h2 className={styles.heading}>Bar {index}</h2>
        <p className={styles.empty}>Nothing has been played against this score yet.</p>
      </section>
    )
  }

  const problems = bar.notes.filter((note) => note.kind !== 'correct')
  const correct = bar.notes.length - problems.length
  const early = bar.timingDeviation < 0

  return (
    <section className={styles.detail} data-testid="bar-detail" data-bar={bar.bar}>
      <h2 className={styles.heading}>
        Bar {bar.bar}
        <span className={`${styles.state} ${styles[bar.state]}`} data-testid="bar-detail-state">
          {STATE_TEXT[bar.state]}
        </span>
      </h2>

      {bar.state === 'notAttempted' || bar.state === 'unalignable' ? (
        <p className={styles.empty}>
          {bar.state === 'notAttempted'
            ? 'The take stopped before this bar, so nothing here is counted against you.'
            : 'What was played and what is written had stopped agreeing by this point.'}
        </p>
      ) : (
        <>
          <p className={styles.summary} data-testid="bar-detail-summary">
            {correct} of {bar.notes.length} notes as written
            {problems.length > 0 && `, ${problems.length} not`}. Timing{' '}
            {Math.abs(Math.round(bar.timingDeviation))} ms {early ? 'early' : 'late'} against the
            fitted tempo.
          </p>
          {problems.length > 0 && (
            <ul className={styles.notes}>
              {problems.map((verdict, position) => (
                <li
                  key={`${verdict.kind}-${position}`}
                  className={`${styles.note} ${styles[verdict.kind]}`}
                  data-testid="bar-detail-note"
                  data-kind={verdict.kind}
                >
                  {describe(verdict)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
