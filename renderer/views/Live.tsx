import { useEffect, useState } from 'react'
import type { MidiPort } from '../../shared/midi'
import type { TakeSummaryRow } from '../../shared/take'
import { soundingPitches } from '../../core/src/midi/HeldNotes'
import { EventLog } from '../components/EventLog'
import { Keyboard } from '../components/Keyboard'
import { Labels } from '../components/Labels'
import { LatencyOverlay } from '../components/LatencyOverlay'
import { LiveStaff } from '../components/LiveStaff'
import { useMidiEvents } from '../hooks/useMidiEvents'
import styles from './Live.module.css'

/**
 * What is being watched: a port, or a take played back. The views below cannot
 * tell which, because a replay travels the identical pipeline (ADR-0001), and
 * that is exactly the property this view is evidence for.
 */
export type LiveSource =
  | { kind: 'port'; port: MidiPort }
  | { kind: 'replay'; take: TakeSummaryRow; speed: number }

export interface LiveProps {
  source: LiveSource
  onStop: () => void
}

/** A stable string per source, so App can key the component on it. */
export function liveSourceKey(source: LiveSource): string {
  return source.kind === 'port'
    ? `port:${source.port.id}`
    : `replay:${source.take.id}:${source.speed}`
}

function describe(source: LiveSource): { name: string; id: string; generated: boolean } {
  if (source.kind === 'port') {
    return {
      name: source.port.name,
      id: source.port.id,
      generated: source.port.kind === 'virtual',
    }
  }
  return {
    name: `${source.take.portName} at ${source.speed}×`,
    id: source.take.id,
    generated: source.take.synthetic,
  }
}

/**
 * What is being played, right now. Everything here reads `HeldNotes` rather
 * than the event stream; the one component that shows raw events is the log,
 * and it is fed the same per-frame batch.
 */
export function Live({ source, onStop }: LiveProps) {
  const [openError, setOpenError] = useState<string | null>(null)
  // Listening starts on mount; the source is opened underneath it.
  const stream = useMidiEvents()
  const sounding = soundingPitches(stream.held)
  const what = describe(source)

  // The component is keyed by source in App, so a different one remounts it
  // and the open state starts clean without an effect resetting it.
  useEffect(() => {
    let cancelled = false

    const opening =
      source.kind === 'port'
        ? window.api.midi.open(source.port.id)
        : window.api.take.replay(source.take.id, source.speed)

    void opening.catch((err: Error) => {
      if (!cancelled) setOpenError(err.message)
    })

    return () => {
      cancelled = true
      void (source.kind === 'port' ? window.api.midi.close() : window.api.take.stopReplay())
    }
  }, [source])

  return (
    <section className={styles.view} data-testid="live-view" data-source-id={what.id}>
      <header className={styles.header}>
        <div className={styles.port}>
          <span className={styles.portName}>{what.name}</span>
          <span className={styles.portId}>{what.id}</span>
          {what.generated && <span className={styles.virtualTag}>Harness</span>}
          {source.kind === 'replay' && <span className={styles.virtualTag}>Replay</span>}
        </div>
        <button type="button" className={styles.stop} onClick={onStop}>
          {source.kind === 'port' ? 'Close port' : 'Stop replay'}
        </button>
      </header>

      {openError !== null && (
        <p className={styles.error} role="alert" data-testid="live-error">
          {openError}
        </p>
      )}

      <div className={styles.section}>
        <h2 className={styles.sectionHeading}>Playing</h2>
        <Labels sounding={sounding} musicalKey={stream.key} />
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionHeading}>Staff</h2>
        <LiveStaff sounding={sounding} musicalKey={stream.key} />
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionHeading}>Keyboard</h2>
        <Keyboard held={stream.held} />
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionHeading}>
          Events <span className={styles.counts}>{stream.received} received</span>
        </h2>
        <EventLog entries={stream.log} received={stream.received} />
      </div>

      {import.meta.env.DEV && <LatencyOverlay stats={stream.latency} synthetic={what.generated} />}
    </section>
  )
}
