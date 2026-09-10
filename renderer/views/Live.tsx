import { useEffect, useState } from 'react'
import type { MidiPort } from '../../shared/midi'
import { soundingPitches } from '../../core/src/midi/HeldNotes'
import { EventLog } from '../components/EventLog'
import { Keyboard } from '../components/Keyboard'
import { Labels } from '../components/Labels'
import { LatencyOverlay } from '../components/LatencyOverlay'
import { LiveStaff } from '../components/LiveStaff'
import { useMidiEvents } from '../hooks/useMidiEvents'
import styles from './Live.module.css'

export interface LiveProps {
  port: MidiPort
  onStop: () => void
}

/**
 * What is being played, right now. Everything here reads `HeldNotes` rather
 * than the event stream; the one component that shows raw events is the log,
 * and it is fed the same per-frame batch.
 */
export function Live({ port, onStop }: LiveProps) {
  const [openError, setOpenError] = useState<string | null>(null)
  // Listening starts on mount; the port is opened underneath it.
  const stream = useMidiEvents()
  const sounding = soundingPitches(stream.held)

  // The component is keyed by port id in App, so a different port remounts it
  // and the open state starts clean without an effect resetting it.
  useEffect(() => {
    let cancelled = false

    void window.api.midi.open(port.id).catch((err: Error) => {
      if (!cancelled) setOpenError(err.message)
    })

    return () => {
      cancelled = true
      void window.api.midi.close()
    }
  }, [port.id])

  return (
    <section className={styles.view} data-testid="live-view" data-port-id={port.id}>
      <header className={styles.header}>
        <div className={styles.port}>
          <span className={styles.portName}>{port.name}</span>
          <span className={styles.portId}>{port.id}</span>
          {port.kind === 'virtual' && <span className={styles.virtualTag}>Harness</span>}
        </div>
        <button type="button" className={styles.stop} onClick={onStop}>
          Close port
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

      {import.meta.env.DEV && (
        <LatencyOverlay stats={stream.latency} synthetic={port.kind === 'virtual'} />
      )}
    </section>
  )
}
