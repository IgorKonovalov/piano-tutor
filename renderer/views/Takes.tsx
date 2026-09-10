import { useCallback, useEffect, useState } from 'react'
import type { TakeSummaryRow } from '../../shared/take'
import { Transport } from '../components/Transport'
import { usePlayer } from '../hooks/usePlayer'
import styles from './Takes.module.css'

/** The speeds the plan asks for, plus normal. */
const SPEEDS = [0.5, 1, 2]

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; takes: TakeSummaryRow[] }

export interface TakesProps {
  /** Hands the replay to the live view, which is where it is watched. */
  onReplay: (take: TakeSummaryRow, speed: number) => void
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

export function Takes({ onReplay }: TakesProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const player = usePlayer()
  /** The last take sent to the instrument, so the transport can send it again. */
  const [chosen, setChosen] = useState<{ take: TakeSummaryRow; speed: number } | null>(null)

  const playOut = useCallback(
    (take: TakeSummaryRow, speed: number) => {
      setChosen({ take, speed })
      void player.play({ kind: 'take', takeId: take.id, speed })
    },
    [player]
  )

  const refresh = useCallback(async () => {
    try {
      setState({ status: 'ready', takes: await window.api.take.list() })
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message })
    }
  }, [])

  // Loaded once on mount, with a cancellation guard so a fast unmount does not
  // set state on a gone component. `refresh` stays for the retry button.
  useEffect(() => {
    let cancelled = false
    window.api.take
      .list()
      .then((takes) => {
        if (!cancelled) setState({ status: 'ready', takes })
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ status: 'error', message: err.message })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className={styles.view} data-testid="takes-view">
      <h1 className={styles.heading}>Takes</h1>
      <p className={styles.lede}>
        Every session is recorded. A take can go two ways, and they are different things.{' '}
        <strong>Replay into the app</strong> feeds it back through the same path the instrument
        feeds, so the live view cannot tell the difference; nothing leaves the computer.{' '}
        <strong>Play on the piano</strong> sends it out of the MIDI port, and the instrument
        sounds it. A take recorded while a score was open remembers which piece it was
        attempting, and the Score view is where it is judged against it.
      </p>

      <Transport
        state={player.state}
        notesPlayed={player.notesPlayed}
        soundingCount={player.held.down.size + player.held.pedalled.size}
        onPlay={() => {
          if (chosen !== null) playOut(chosen.take, chosen.speed)
        }}
        onStop={() => void player.stop()}
        disabled={chosen === null}
        sound={{
          target: player.soundTarget,
          onChange: player.setSoundTarget,
          outputOpen: player.outputOpen,
        }}
        error={player.error}
        onDismissError={player.clearError}
        testId="take-transport"
        playLabel={
          chosen === null
            ? 'Play on the piano'
            : `Play ${chosen.take.id.slice(0, 10)} again at ${chosen.speed}\u00d7`
        }
      />

      {state.status === 'error' && (
        <p className={styles.error} role="alert">
          Could not read the takes: {state.message}
          <button type="button" className={styles.retry} onClick={() => void refresh()}>
            Retry
          </button>
        </p>
      )}

      {state.status === 'loading' && <p className={styles.empty}>Reading the takes folder…</p>}

      {state.status === 'ready' &&
        (state.takes.length === 0 ? (
          <p className={styles.empty}>
            No takes yet. Open a port and play something; a session with at least ten notes is
            kept.
          </p>
        ) : (
          <ul className={styles.list}>
            {state.takes.map((take) => (
              <li
                key={take.id}
                className={take.synthetic ? `${styles.take} ${styles.synthetic}` : styles.take}
                data-testid="take-row"
                data-take-id={take.id}
                data-note-count={take.noteCount}
              >
                <span className={styles.when}>{formatWhen(take.startedAt)}</span>
                <span className={styles.stats}>
                  <span>{formatDuration(take.durationMs)}</span>
                  <span>{take.noteCount} notes</span>
                  <span>{take.eventCount} events</span>
                </span>
                <span className={styles.port}>
                  {take.portName}
                  <br />
                  <span className={styles.portId}>{take.port}</span>
                  {take.synthetic && <span className={styles.syntheticTag}>Generated</span>}
                </span>
                <span className={styles.against} data-testid="take-score">
                  {take.scoreId === null ? (
                    <span className={styles.freePlay}>Free play</span>
                  ) : (
                    <>
                      Practising
                      <br />
                      <span className={styles.portId} data-score-id={take.scoreId}>
                        {take.scoreId.slice(0, 8)}
                      </span>
                    </>
                  )}
                </span>
                {/*
                  * Two verbs that both look like "play", so each says what it
                  * does rather than being distinguished by an icon. Replaying
                  * feeds the app's own input pipeline (a testing capability,
                  * Plan 0001 Phase 5); playing sends the take to the
                  * instrument (ADR-0007). Neither triggers the other.
                  */}
                <span className={styles.verbs}>
                  <span className={styles.verb} data-testid="take-replay">
                    <span className={styles.verbLabel}>Replay into the app</span>
                    <span className={styles.speeds}>
                      {SPEEDS.map((speed) => (
                        <button
                          key={speed}
                          type="button"
                          className={styles.speed}
                          onClick={() => onReplay(take, speed)}
                          data-testid={`take-replay-${speed}`}
                        >
                          {speed}&times;
                        </button>
                      ))}
                    </span>
                  </span>
                  <span className={styles.verb} data-testid="take-play">
                    <span className={styles.verbLabel}>Play on the piano</span>
                    <span className={styles.speeds}>
                      {SPEEDS.map((speed) => (
                        <button
                          key={speed}
                          type="button"
                          className={`${styles.speed} ${styles.outward}`}
                          onClick={() => playOut(take, speed)}
                          data-testid={`take-play-${speed}`}
                        >
                          {speed}&times;
                        </button>
                      ))}
                    </span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ))}
    </section>
  )
}
