import { useCallback, useEffect, useState } from 'react'
import type { MidiPort } from '../../shared/midi'
import styles from './Ports.module.css'

/**
 * Windows reports no hot-plug event for MIDI, so the list is polled. Two
 * seconds is slow enough to be invisible in Task Manager and fast enough that
 * plugging the CK88 in feels like it just appeared.
 */
const POLL_INTERVAL_MS = 2000

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; ports: MidiPort[] }

export function Ports() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  const refresh = useCallback(async () => {
    try {
      const ports = await window.api.midi.listPorts()
      setState({ status: 'ready', ports })
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message })
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const tick = () => {
      if (!cancelled) void refresh()
    }
    tick()
    const timer = setInterval(tick, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [refresh])

  return (
    <section className={styles.view} data-testid="ports-view">
      <h1 className={styles.heading}>MIDI input ports</h1>
      <p className={styles.lede}>
        Refreshed every two seconds. Windows reports no hot-plug event, so plugging the instrument
        in takes a moment to show.
      </p>

      {state.status === 'error' && (
        <p className={styles.error} role="alert">
          Could not read the port list: {state.message}
          <button type="button" className={styles.retry} onClick={() => void refresh()}>
            Retry
          </button>
        </p>
      )}

      {state.status === 'loading' && <p className={styles.empty}>Reading the port list…</p>}

      {state.status === 'ready' && (
        <>
          <PortGroup
            title="Instruments"
            testId="port-group-hardware"
            ports={state.ports.filter((p) => p.kind === 'hardware')}
            emptyText="Nothing connected. Plug the CK88 into the USB TO HOST port; the list refreshes on its own."
          />
          <PortGroup
            title="Harness"
            testId="port-group-virtual"
            note="Generated passages the app plays into its own pipeline. Not devices."
            ports={state.ports.filter((p) => p.kind === 'virtual')}
            emptyText="Disabled in this build."
          />
        </>
      )}
    </section>
  )
}

interface PortGroupProps {
  title: string
  testId: string
  ports: MidiPort[]
  emptyText: string
  note?: string
}

function PortGroup({ title, testId, ports, emptyText, note }: PortGroupProps) {
  return (
    <div className={styles.group} data-testid={testId}>
      <h2 className={styles.groupHeading}>
        {title}
        {note !== undefined && <span className={styles.groupNote}>{note}</span>}
      </h2>
      {ports.length === 0 ? (
        <p className={styles.empty}>{emptyText}</p>
      ) : (
        <ul className={styles.list}>
          {ports.map((port) => (
            <PortRow key={port.id} port={port} />
          ))}
        </ul>
      )}
    </div>
  )
}

const AVAILABILITY_LABEL: Record<MidiPort['availability'], string> = {
  available: 'Ready',
  busy: 'In use',
  unknown: 'Unknown',
}

function PortRow({ port }: { port: MidiPort }) {
  const isVirtual = port.kind === 'virtual'
  return (
    <li
      className={isVirtual ? `${styles.port} ${styles.virtual}` : styles.port}
      data-testid="port-row"
      data-port-id={port.id}
    >
      <div className={styles.portText}>
        <div className={styles.portName}>{port.name}</div>
        <div className={styles.portId}>{port.id}</div>
        {port.detail !== undefined && (
          <div
            className={
              port.availability === 'busy'
                ? `${styles.portDetail} ${styles.busyDetail}`
                : styles.portDetail
            }
          >
            {port.detail}
          </div>
        )}
      </div>
      <span
        className={`${styles.badge} ${isVirtual ? styles.badgeVirtual : styles[port.availability]}`}
      >
        {isVirtual ? 'Harness' : AVAILABILITY_LABEL[port.availability]}
      </span>
    </li>
  )
}
