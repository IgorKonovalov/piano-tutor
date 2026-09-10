import { memo } from 'react'
import type { HeldNotes } from '../../core/src/midi/HeldNotes'
import styles from './Keyboard.module.css'

/** An 88-key piano runs A0 to C8. */
const LOWEST_NOTE = 21
const HIGHEST_NOTE = 108
const MIDDLE_C = 60

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

interface KeyLayout {
  note: number
  black: boolean
  /** Percentage of the keyboard's width, for the black keys only. */
  left: number
  width: number
}

/**
 * Computed once. White keys share the width evenly; a black key straddles the
 * boundary between the two white keys it sits between, which is what makes the
 * gaps look like a piano rather than a grid.
 */
const LAYOUT: KeyLayout[] = (() => {
  const whites: number[] = []
  for (let note = LOWEST_NOTE; note <= HIGHEST_NOTE; note++) {
    if (!BLACK_PITCH_CLASSES.has(note % 12)) whites.push(note)
  }
  const whiteWidth = 100 / whites.length
  const blackWidth = whiteWidth * 0.62

  const layout: KeyLayout[] = []
  for (let note = LOWEST_NOTE; note <= HIGHEST_NOTE; note++) {
    if (!BLACK_PITCH_CLASSES.has(note % 12)) {
      layout.push({ note, black: false, left: 0, width: whiteWidth })
      continue
    }
    // The white key below this black one fixes its position.
    const whiteBelow = whites.filter((w) => w < note).length
    layout.push({
      note,
      black: true,
      left: whiteBelow * whiteWidth - blackWidth / 2,
      width: blackWidth,
    })
  }
  return layout
})()

const WHITE_KEYS = LAYOUT.filter((k) => !k.black)
const BLACK_KEYS = LAYOUT.filter((k) => k.black)

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function noteLabel(note: number): string {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`
}

type KeyState = 'off' | 'down' | 'pedalled'

interface KeyProps {
  layout: KeyLayout
  state: KeyState
  velocity: number
}

/**
 * Memoised per key. A dense passage repaints the keyboard sixty times a second
 * while at most a handful of keys change; without this every frame reconciles
 * all eighty-eight.
 */
const Key = memo(function Key({ layout, state, velocity }: KeyProps) {
  const classes = [layout.black ? styles.black : styles.white]
  if (state === 'down') classes.push(styles.pressed)
  if (state === 'pedalled') classes.push(styles.pedalled)
  if (layout.note === MIDDLE_C) classes.push(styles.middleC)

  const style = layout.black
    ? {
        left: `${layout.left}%`,
        width: `${layout.width}%`,
        '--velocity': velocity / 127,
      }
    : { '--velocity': velocity / 127 }

  return (
    <div
      className={classes.join(' ')}
      style={style as React.CSSProperties}
      data-note={layout.note}
      data-state={state}
    />
  )
})

export interface KeyboardProps {
  held: HeldNotes
}

export function Keyboard({ held }: KeyboardProps) {
  const stateOf = (note: number): KeyState => {
    if (held.down.has(note)) return 'down'
    if (held.pedalled.has(note)) return 'pedalled'
    return 'off'
  }
  const velocityOf = (note: number): number =>
    held.down.get(note)?.velocity ?? held.pedalled.get(note)?.velocity ?? 0

  const soundingCount = held.down.size + held.pedalled.size

  return (
    <div>
      <div
        className={styles.keyboard}
        role="img"
        aria-label={
          soundingCount === 0
            ? 'Piano keyboard, nothing held'
            : `Piano keyboard, holding ${[...held.down.keys(), ...held.pedalled.keys()]
                .sort((a, b) => a - b)
                .map(noteLabel)
                .join(', ')}`
        }
        data-testid="keyboard"
        data-sounding={soundingCount}
      >
        <div className={styles.whiteRow}>
          {WHITE_KEYS.map((layout) => (
            <Key
              key={layout.note}
              layout={layout}
              state={stateOf(layout.note)}
              velocity={velocityOf(layout.note)}
            />
          ))}
        </div>
        <div className={styles.blackLayer}>
          {BLACK_KEYS.map((layout) => (
            <Key
              key={layout.note}
              layout={layout}
              state={stateOf(layout.note)}
              velocity={velocityOf(layout.note)}
            />
          ))}
        </div>
      </div>

      <div className={styles.pedals}>
        <Pedal label="Sustain" down={held.sustain} />
        <Pedal label="Sostenuto" down={held.sostenuto} />
        <Pedal label="Soft" down={held.soft >= 64} value={held.soft} />
      </div>
    </div>
  )
}

function Pedal({ label, down, value }: { label: string; down: boolean; value?: number }) {
  return (
    <span
      className={down ? `${styles.pedal} ${styles.pedalDown}` : styles.pedal}
      data-testid={`pedal-${label.toLowerCase()}`}
      data-down={down}
    >
      <span className={styles.pedalDot} />
      {label}
      {value !== undefined && value > 0 ? ` ${value}` : ''}
      {down ? ' down' : ' up'}
    </span>
  )
}
