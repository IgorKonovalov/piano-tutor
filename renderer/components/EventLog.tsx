import { memo } from 'react'
import type { MidiEvent } from '../../shared/midi'
import type { LoggedEvent } from '../hooks/useMidiEvents'
import { noteLabel } from './Keyboard'
import styles from './EventLog.module.css'

/**
 * The raw stream, newest first. This is the view that says the pipeline is
 * intact -- what main parsed, in the order it parsed it -- so it shows the
 * event as it is rather than an interpretation of it.
 */

const KIND_LABEL: Record<MidiEvent['kind'], string> = {
  noteOn: 'note on',
  noteOff: 'note off',
  cc: 'control',
  programChange: 'program',
  pitchBend: 'bend',
  unknown: 'unknown',
}

const CC_LABEL: Record<number, string> = {
  64: 'sustain',
  66: 'sostenuto',
  67: 'soft',
}

function detailOf(event: MidiEvent): string {
  switch (event.kind) {
    case 'noteOn':
      return `${noteLabel(event.note)} (${event.note}) vel ${event.velocity}`
    case 'noteOff':
      return `${noteLabel(event.note)} (${event.note})`
    case 'cc': {
      const name = CC_LABEL[event.controller]
      return `${name !== undefined ? `${name} ` : ''}cc${event.controller} = ${event.value}`
    }
    case 'programChange':
      return `program ${event.program}`
    case 'pitchBend':
      return `${event.value > 0 ? '+' : ''}${event.value}`
    case 'unknown':
      return event.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')
  }
}

export interface EventLogProps {
  entries: LoggedEvent[]
  received: number
}

/**
 * Memoised, and the reason is measured. The log holds 250 rows and the view
 * repaints every frame; rendering all of them each time cost 37 ms at p50
 * through a dense passage, which backed IPC messages up behind the renderer's
 * own work. A logged event never changes after it is appended, so `seq` makes
 * every existing row a cache hit and the per-frame cost falls to the handful
 * of rows that are actually new.
 */
const EventRow = memo(function EventRow({ entry }: { entry: LoggedEvent }) {
  return (
    <div className={`${styles.row} ${styles[entry.event.kind] ?? ''}`} data-testid="event-row">
      <span className={styles.seq}>{entry.seq}</span>
      <span className={styles.kind}>{KIND_LABEL[entry.event.kind]}</span>
      <span className={styles.detail}>{detailOf(entry.event)}</span>
      <span className={styles.channel}>
        {entry.event.kind === 'unknown' ? '' : `ch ${entry.event.ch + 1}`}
      </span>
    </div>
  )
})

export function EventLog({ entries, received }: EventLogProps) {
  if (entries.length === 0) {
    return (
      <div className={styles.log} data-testid="event-log" data-received={received}>
        <p className={styles.empty}>Nothing has arrived yet. Play a note.</p>
      </div>
    )
  }

  return (
    <div className={styles.log} data-testid="event-log" data-received={received}>
      {/* Reversed by the stylesheet's column-reverse, so the newest row is at
          the top without re-sorting the array on every frame. */}
      {entries.map((entry) => (
        <EventRow key={entry.seq} entry={entry} />
      ))}
    </div>
  )
}
