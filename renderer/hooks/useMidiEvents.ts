import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { type HeldNotes, emptyHeldNotes, reduceHeldNotes } from '../../core/src/midi/HeldNotes'
import { type KeyEstimate, estimateKey } from '../../core/src/theory/key'
import type { MidiEvent } from '../../shared/midi'

/**
 * The renderer's whole hot path.
 *
 * Events arrive from main one IPC message at a time, each in its own task. A
 * `setState` per message would be one React render per message -- two hundred
 * renders a second in a pedalled run, which is the latency bug NFR 1 exists to
 * catch. So arrivals are buffered in a ref and reduced into `HeldNotes` once
 * per animation frame. **No event is dropped or coalesced** (NFR 2): the whole
 * buffer is reduced, and the log gets every one; what happens once per frame is
 * the paint, not the accounting.
 *
 * The flush is `flushSync` so React commits inside the frame that scheduled it.
 * Left to the scheduler the commit lands a macrotask later, which costs a whole
 * extra frame on the measurement NFR 11 bounds.
 */

/**
 * How many recent events the log keeps. Older ones leave the view, never the
 * count -- `received` is what NFR 2 is checked against.
 *
 * The number is measured, not chosen. The log repaints every frame, and its
 * rows churn: each frame appends a few and drops a few, so React re-keys the
 * whole list and the browser re-lays-out every row. Through `virtual:dense-2000`
 * on this machine that cost 37 ms at p50 with 250 rows and 5.9 ms with 60,
 * while the box itself only ever shows about eleven. Raising it again is a
 * latency change, not a display change.
 */
const LOG_CAPACITY = 60

/** NFR 1 and NFR 11 are both quoted over the last 500 events. */
const LATENCY_WINDOW = 500

/**
 * The slow lane. Percentiles and the key estimate are both recomputed on this
 * interval rather than every frame: nobody reads a percentile sixty times a
 * second, and a key is a property of a phrase, not of a frame. The chord name
 * is not on this lane -- it follows the held notes immediately, because that
 * is the whole point of it.
 */
const STATS_INTERVAL_MS = 400

/**
 * How many recent note-ons the key estimate reads. The estimator decays a note's
 * weight by its own age, so this is only a bound on the work, not the window.
 */
const KEY_WINDOW = 400

export interface LoggedEvent {
  seq: number
  event: MidiEvent
}

export interface LatencyStats {
  samples: number
  /** Arrival in main to the frame that first shows the key, in milliseconds. */
  msP50: number
  msP95: number
  msMax: number
  /** The same distance counted in animation frames, which is what NFR 11 bounds. */
  frameP50: number
  frameP95: number
  frameMax: number
}

export const emptyLatencyStats: LatencyStats = {
  samples: 0,
  msP50: 0,
  msP95: 0,
  msMax: 0,
  frameP50: 0,
  frameP95: 0,
  frameMax: 0,
}

export interface MidiStream {
  held: HeldNotes
  log: LoggedEvent[]
  /** Every event since the port opened, including those the log has dropped. */
  received: number
  latency: LatencyStats
  /** Null until enough has been played to correlate against anything. */
  key: KeyEstimate | null
}

interface Pending {
  event: MidiEvent
  /** The frame in flight when the event reached the renderer. */
  arrivalFrame: number
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))
  return sorted[index] ?? 0
}

/**
 * Subscribes on mount, before the caller asks main to open a port. A source
 * can deliver its first message inside `open()` -- the synthetic one does,
 * for anything due at t=0 -- so a hook that waited for the open to resolve
 * would lose the head of every passage and quietly fail NFR 2.
 */
export function useMidiEvents(): MidiStream {
  const [stream, setStream] = useState<MidiStream>({
    held: emptyHeldNotes,
    log: [],
    received: 0,
    latency: emptyLatencyStats,
    key: null,
  })

  const pending = useRef<Pending[]>([])
  const held = useRef<HeldNotes>(emptyHeldNotes)
  const log = useRef<LoggedEvent[]>([])
  const received = useRef(0)
  const frame = useRef(0)
  const msSamples = useRef<number[]>([])
  const frameSamples = useRef<number[]>([])
  const latency = useRef<LatencyStats>(emptyLatencyStats)
  const noteOns = useRef<MidiEvent[]>([])
  const key = useRef<KeyEstimate | null>(null)
  const lastStatsAt = useRef(0)

  useEffect(() => {
    pending.current = []
    held.current = emptyHeldNotes
    log.current = []
    received.current = 0
    msSamples.current = []
    frameSamples.current = []
    latency.current = emptyLatencyStats
    noteOns.current = []
    key.current = null
    lastStatsAt.current = 0

    const stopListening = window.api.midi.onEvent((event) => {
      pending.current.push({ event, arrivalFrame: frame.current })
    })

    let raf = 0
    const tick = (frameTime: number) => {
      frame.current++
      raf = requestAnimationFrame(tick)

      const batch = pending.current
      if (batch.length === 0) return
      pending.current = []

      // The frame timestamp is when this frame's pixels are produced; main's
      // `t` is epoch-anchored, so the two clocks are directly comparable.
      const paintedAt = performance.timeOrigin + frameTime

      let next = held.current
      const appended: LoggedEvent[] = []
      for (const { event, arrivalFrame } of batch) {
        next = reduceHeldNotes(next, event)
        received.current++
        appended.push({ seq: received.current, event })
        if (event.kind === 'noteOn') {
          msSamples.current.push(paintedAt - event.t)
          frameSamples.current.push(frame.current - arrivalFrame)
          noteOns.current.push(event)
        }
      }
      held.current = next

      const merged = [...log.current, ...appended]
      log.current = merged.length > LOG_CAPACITY ? merged.slice(-LOG_CAPACITY) : merged

      if (msSamples.current.length > LATENCY_WINDOW) {
        msSamples.current = msSamples.current.slice(-LATENCY_WINDOW)
        frameSamples.current = frameSamples.current.slice(-LATENCY_WINDOW)
      }
      if (noteOns.current.length > KEY_WINDOW) {
        noteOns.current = noteOns.current.slice(-KEY_WINDOW)
      }

      if (frameTime - lastStatsAt.current >= STATS_INTERVAL_MS) {
        lastStatsAt.current = frameTime
        key.current = estimateKey(noteOns.current)
        const ms = [...msSamples.current].sort((a, b) => a - b)
        const frames = [...frameSamples.current].sort((a, b) => a - b)
        latency.current = {
          samples: ms.length,
          msP50: percentile(ms, 0.5),
          msP95: percentile(ms, 0.95),
          msMax: ms[ms.length - 1] ?? 0,
          frameP50: percentile(frames, 0.5),
          frameP95: percentile(frames, 0.95),
          frameMax: frames[frames.length - 1] ?? 0,
        }
      }

      flushSync(() => {
        setStream({
          held: held.current,
          log: log.current,
          received: received.current,
          latency: latency.current,
          key: key.current,
        })
      })
    }
    raf = requestAnimationFrame(tick)

    return () => {
      stopListening()
      cancelAnimationFrame(raf)
    }
  }, [])

  return stream
}
