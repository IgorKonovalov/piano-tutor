import { MAX_BPM, MIN_BPM, type PlayerState } from '../../shared/player'
import styles from './Transport.module.css'

/**
 * The controls for what the app plays (ADR-0007): press play, hear it, press
 * stop.
 *
 * Everything it offers is optional, because the sources do not all have the
 * same knobs. A score has a tempo the player sets and a range of bars; a
 * recorded take has neither, having been played at whatever speed it was
 * played at. Passing nothing leaves a play button and a reading, which is the
 * whole of a demonstration.
 */
export interface TransportTempo {
  bpm: number
  onChange(bpm: number): void
}

export interface TransportRange {
  from: number
  to: number
  /** The highest bar index the source has. */
  max: number
  onChange(from: number, to: number): void
}

export interface TransportProps {
  state: PlayerState
  /** Note-ons since this playback started. */
  notesPlayed: number
  /** How many notes the app has sounding right now; zero once it has stopped. */
  soundingCount: number
  onPlay(): void
  onStop(): void
  tempo?: TransportTempo
  range?: TransportRange
  /** Nothing to play: no score drawn, no take chosen. */
  disabled?: boolean
  error?: string | null
  onDismissError?(): void
  /** Set when a page carries more than one transport. */
  testId?: string
  /** What the play button offers to play. */
  playLabel?: string
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(1)
}

export function Transport({
  state,
  notesPlayed,
  soundingCount,
  onPlay,
  onStop,
  tempo,
  range,
  disabled = false,
  error = null,
  onDismissError,
  testId = 'transport',
  playLabel = 'Play',
}: TransportProps) {
  const playing = state.state === 'playing'

  return (
    <div
      className={styles.transport}
      data-testid={testId}
      data-state={state.state}
      data-notes={notesPlayed}
      data-sounding={soundingCount}
      data-bar={playing ? (state.bar ?? '') : ''}
    >
      <button
        type="button"
        className={styles.play}
        onClick={onPlay}
        disabled={disabled || playing}
        data-testid={`${testId}-play`}
      >
        {playLabel}
      </button>
      <button
        type="button"
        className={styles.stop}
        onClick={onStop}
        disabled={!playing}
        data-testid={`${testId}-stop`}
      >
        Stop
      </button>

      {tempo !== undefined && (
        <>
          <label className={styles.field} htmlFor={`${testId}-bpm`}>
            Tempo
          </label>
          <input
            id={`${testId}-bpm`}
            className={styles.number}
            type="number"
            min={MIN_BPM}
            max={MAX_BPM}
            step={1}
            value={tempo.bpm}
            disabled={playing}
            onChange={(event) => tempo.onChange(Number(event.target.value))}
            data-testid={`${testId}-bpm`}
          />
          <span className={styles.unit}>bpm</span>
        </>
      )}

      {range !== undefined && (
        <>
          <label className={styles.field} htmlFor={`${testId}-from`}>
            Bars
          </label>
          <input
            id={`${testId}-from`}
            className={styles.number}
            type="number"
            min={0}
            max={range.max}
            value={range.from}
            disabled={playing}
            onChange={(event) => range.onChange(Number(event.target.value), range.to)}
            data-testid={`${testId}-from`}
          />
          <span className={styles.unit}>to</span>
          <input
            id={`${testId}-to`}
            className={styles.number}
            type="number"
            min={0}
            max={range.max}
            value={range.to}
            disabled={playing}
            onChange={(event) => range.onChange(range.from, Number(event.target.value))}
            aria-label="Last bar to play"
            data-testid={`${testId}-to`}
          />
          <button
            type="button"
            className={styles.reset}
            onClick={() => range.onChange(0, range.max)}
            disabled={playing}
            data-testid={`${testId}-whole`}
          >
            Whole piece
          </button>
        </>
      )}

      <span className={styles.reading} data-testid={`${testId}-reading`}>
        {playing
          ? `Playing ${seconds(state.positionMs)} of ${seconds(state.durationMs)} s${
              state.bar === null ? '' : `, bar ${state.bar}`
            }`
          : notesPlayed === 0
            ? 'Idle'
            : `Played ${notesPlayed} ${notesPlayed === 1 ? 'note' : 'notes'}`}
      </span>

      {error !== null && (
        <span className={styles.error} role="alert" data-testid={`${testId}-error`}>
          {error}
          {onDismissError !== undefined && (
            <button type="button" className={styles.reset} onClick={onDismissError}>
              Dismiss
            </button>
          )}
        </span>
      )}
    </div>
  )
}
