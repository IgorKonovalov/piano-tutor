import type { ExpectedTimeline } from '../../shared/score'
import type { BarMark } from '../score/OsmdView'
import styles from './BarList.module.css'

/**
 * A MIDI file's score, which is a bar grid and nothing else.
 *
 * There is no engraving to draw, so this does not pretend there is (ADR-0003:
 * MIDI is second-class input, and a best-effort transcription is the project
 * Alternative C declined). What it shows is exactly what the app actually
 * knows: how many bars, how many notes in each, and the verdict on each -- the
 * same marks, the same click-to-select and the same bar detail as the engraved
 * view, on a grid instead of a stave.
 */

export interface BarListProps {
  timeline: ExpectedTimeline
  marks: readonly BarMark[]
  selected: number | null
  onBarClick: (bar: number) => void
}

export function BarList({ timeline, marks, selected, onBarClick }: BarListProps) {
  const counts = new Map<number, number>()
  for (const note of timeline.notes) {
    counts.set(note.bar, (counts.get(note.bar) ?? 0) + 1)
  }

  return (
    <div className={styles.wrap} data-testid="bar-list">
      <p className={styles.lede}>
        This is a MIDI file, so there is no engraving to show: no clefs, no beams, no spelling.
        What it carries is the notes and the bars, and that is what is judged.
      </p>
      <ol className={styles.grid} data-bars={timeline.bars.length}>
        {timeline.bars.map((bar) => {
          const mark = marks.find((candidate) => candidate.bar === bar.index)
          const notes = counts.get(bar.index) ?? 0
          return (
            <li key={bar.index}>
              <button
                type="button"
                className={
                  [
                    styles.bar,
                    mark === undefined ? '' : (styles[mark.state] ?? ''),
                    bar.index === selected ? styles.selected : '',
                  ]
                    .filter(Boolean)
                    .join(' ')
                }
                onClick={() => onBarClick(bar.index)}
                aria-current={bar.index === selected}
                aria-label={
                  mark === undefined
                    ? `Bar ${bar.index}, ${notes} notes`
                    : `Bar ${bar.index}, ${notes} notes: ${mark.label}`
                }
                data-testid="bar-mark"
                data-bar={bar.index}
                data-state={mark?.state ?? 'none'}
              >
                <span className={styles.index}>{bar.index}</span>
                <span className={styles.notes}>
                  {notes === 0 ? 'rest' : `${notes} ${notes === 1 ? 'note' : 'notes'}`}
                </span>
                {mark !== undefined && <span className={styles.mark}>{mark.label}</span>}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
