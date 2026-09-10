import { useCallback, useEffect, useState } from 'react'
import { emptyHeldNotes } from '../../core/src/midi/HeldNotes'
import type { MidiPort } from '../../shared/midi'
import { Keyboard } from '../components/Keyboard'
import { usePlayer } from '../hooks/usePlayer'
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

export interface PortsProps {
  onOpen: (port: MidiPort) => void
}

export function Ports({ onOpen }: PortsProps) {
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
            onOpen={onOpen}
          />
          <PortGroup
            title="Harness"
            testId="port-group-virtual"
            note="Generated passages the app plays into its own pipeline. Not devices."
            ports={state.ports.filter((p) => p.kind === 'virtual')}
            emptyText="Disabled in this build."
            onOpen={onOpen}
          />
          <Playback harnessAvailable={state.ports.some((p) => p.kind === 'virtual')} />
        </>
      )}
    </section>
  )
}

/** The scale of ADR-0004, which is also the passage Phase 1 demonstrates. */
const DEMONSTRATION_ID = 'virtual:c-major-scale'

/**
 * The output half (ADR-0007): where the app sends what it plays, and one
 * passage to prove it does. The keyboard here shows `player:event` and nothing
 * else, so what lights up is unambiguously the app's own playing.
 */
function Playback({ harnessAvailable }: { harnessAvailable: boolean }) {
  const player = usePlayer()
  const [outputs, setOutputs] = useState<MidiPort[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [outputError, setOutputError] = useState<string | null>(null)

  const refreshOutputs = useCallback(async () => {
    try {
      setOutputs(await window.api.player.listOutputs())
    } catch (err) {
      setOutputError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const tick = () => {
      if (!cancelled) void refreshOutputs()
    }
    tick()
    const timer = setInterval(tick, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [refreshOutputs])

  const chooseOutput = async (port: MidiPort) => {
    setOutputError(null)
    try {
      await window.api.player.openOutput(port.id)
      setOpenId(port.id)
    } catch (err) {
      setOutputError((err as Error).message)
      setOpenId(null)
    }
    void refreshOutputs()
  }

  const releaseOutput = async () => {
    setOutputError(null)
    try {
      await window.api.player.closeOutput()
    } catch (err) {
      setOutputError((err as Error).message)
    }
    setOpenId(null)
    void refreshOutputs()
  }

  const playing = player.state.state === 'playing'

  return (
    <div className={styles.group} data-testid="playback">
      <h2 className={styles.groupHeading}>
        Playback
        <span className={styles.groupNote}>
          Where the app sends what it plays. Nothing selected means it plays to the screen only.
        </span>
      </h2>

      {outputError !== null && (
        <p className={styles.error} role="alert">
          {outputError}
        </p>
      )}
      {player.error !== null && (
        <p className={styles.error} role="alert">
          {player.error}
          <button type="button" className={styles.retry} onClick={player.clearError}>
            Dismiss
          </button>
        </p>
      )}

      {outputs.length === 0 ? (
        <p className={styles.empty}>
          No MIDI outputs. Plug the CK88 into the USB TO HOST port; the list refreshes on its own.
        </p>
      ) : (
        <ul className={styles.list} data-testid="output-list">
          {outputs.map((port) => (
            <li
              key={port.id}
              className={styles.port}
              data-testid="output-row"
              data-output-id={port.id}
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
              <span className={`${styles.badge} ${styles[port.availability]}`}>
                {AVAILABILITY_LABEL[port.availability]}
              </span>
              <button
                type="button"
                className={styles.open}
                data-testid="output-open"
                onClick={() => (openId === port.id ? void releaseOutput() : void chooseOutput(port))}
              >
                {openId === port.id ? 'Release' : 'Send here'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.transport} data-testid="transport">
        <button
          type="button"
          className={styles.play}
          data-testid="player-play"
          disabled={!harnessAvailable}
          onClick={() => void player.play({ kind: 'scenario', id: DEMONSTRATION_ID })}
        >
          Play the C major scale
        </button>
        <button
          type="button"
          className={styles.open}
          data-testid="player-stop"
          disabled={!playing}
          onClick={() => void player.stop()}
        >
          Stop
        </button>
        <span className={styles.transportState} data-testid="player-state">
          {player.state.state === 'playing'
            ? `Playing, ${(player.state.positionMs / 1000).toFixed(1)} of ${(player.state.durationMs / 1000).toFixed(1)} s`
            : harnessAvailable
              ? 'Idle'
              : 'Nothing to demonstrate in this build'}
        </span>
      </div>

      <div className={styles.playbackKeyboard}>
        <Keyboard held={emptyHeldNotes} playback={player.held} />
      </div>
    </div>
  )
}

interface PortGroupProps {
  title: string
  testId: string
  ports: MidiPort[]
  emptyText: string
  onOpen: (port: MidiPort) => void
  note?: string
}

function PortGroup({ title, testId, ports, emptyText, note, onOpen }: PortGroupProps) {
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
            <PortRow key={port.id} port={port} onOpen={onOpen} />
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

function PortRow({ port, onOpen }: { port: MidiPort; onOpen: (port: MidiPort) => void }) {
  const isVirtual = port.kind === 'virtual'
  // A `busy` row stays clickable (ADR-0006): the label records that the last
  // open failed, which may already be stale, and the retry is the re-check.
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
      <button
        type="button"
        className={styles.open}
        onClick={() => onOpen(port)}
        data-testid="port-open"
      >
        {isVirtual ? 'Play' : port.availability === 'busy' ? 'Try again' : 'Open'}
      </button>
    </li>
  )
}
