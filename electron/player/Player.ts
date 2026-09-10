import {
  type HeldNotes,
  emptyHeldNotes,
  reduceHeldNotes,
  soundingNotes,
} from '../../core/src/midi/HeldNotes'
import { barAt } from '../../core/src/player/schedule'
import { CC_SOSTENUTO, CC_SUSTAIN, type MidiEvent } from '../../shared/midi'
import type { PlaybackSchedule, PlayerState, ScheduledEvent } from '../../shared/player'
import type { MidiSink } from '../midi/MidiSink'
import { type Clock, systemClock } from '../midi/timedSource'

/**
 * The clock half of ADR-0007. It reads a schedule out; it decides nothing.
 *
 * **Lookahead, not a fine interval.** A coarse tick wakes up every 25 ms and
 * arms an individual timer for everything falling in the next 100 ms, so an
 * onset lands on its own millisecond instead of being quantised to the tick.
 * Dispatching on the tick boundary would smear every onset by up to 25 ms,
 * which at 120 bpm is a fifth of a semiquaver and plainly audible (NFR 13).
 * The tick itself only has to be reliable, not accurate.
 *
 * **It lives in main** because main is the process that cannot be throttled by
 * a hidden window and that outlives the renderer at shutdown. A note-on
 * dispatched by something that can be suspended before its note-off is a chord
 * left ringing on the instrument in the room.
 *
 * It keeps its own `HeldNotes` beside the sink's. The two are not redundant:
 * the sink's memory is what silences the *instrument*, and this one is what
 * lets a stop push real note-offs to the *renderer*, so the on-screen keyboard
 * goes dark by the same events rather than by a separate reset message.
 */
export const TICK_MS = 25
export const LOOKAHEAD_MS = 100

/** How often the transport's own reading is pushed. Not per event. */
const STATE_INTERVAL_MS = 100

/**
 * The player needs a coarse repeating tick as well as the one-shot timers
 * `Clock` already provides, and a test needs to drive both without waiting out
 * a passage in real time.
 */
export interface PlayerClock extends Clock {
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

export const systemPlayerClock: PlayerClock = {
  ...systemClock,
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
}

export interface PlayerDeps {
  /** Where playback starts; `NullSink` until an output port is chosen. */
  sink: MidiSink
  /** Every dispatched event, for `player:event`. Never the recorder. */
  onEvent(event: MidiEvent): void
  onState(state: PlayerState): void
  clock?: PlayerClock
}

/** NFR 13's milliseconds, over the schedule that just finished. */
export interface OnsetError {
  samples: number
  p50: number
  p95: number
  max: number
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0
}

export class Player {
  private readonly clock: PlayerClock
  private sink: MidiSink
  private schedule: PlaybackSchedule | null = null
  private tickHandle: unknown = null
  private armed = new Set<unknown>()
  private nextIndex = 0
  private startedAt = 0
  private lastStateAt = -Infinity
  private held: HeldNotes = emptyHeldNotes
  private channelsTouched = new Set<number>()
  private onsetErrors: number[] = []
  private lastOnsetError: OnsetError | null = null

  constructor(private readonly deps: PlayerDeps) {
    this.clock = deps.clock ?? systemPlayerClock
    this.sink = deps.sink
  }

  get playing(): boolean {
    return this.schedule !== null
  }

  /**
   * Swapping where playback goes. The sink being left behind is silenced
   * first: it is about to stop receiving the note-offs for whatever it is
   * currently sounding.
   */
  setSink(sink: MidiSink): void {
    if (sink === this.sink) return
    this.sink.release()
    this.sink = sink
  }

  /** The distribution of the schedule that last ran, for NFR 13's log row. */
  get onsetError(): OnsetError | null {
    return this.lastOnsetError
  }

  play(schedule: PlaybackSchedule): void {
    // A second play over a running one is a stop and a start, not two
    // schedules interleaved on one instrument.
    this.stop()
    if (schedule.events.length === 0) return

    this.schedule = schedule
    this.nextIndex = 0
    this.onsetErrors = []
    this.startedAt = this.clock.now()
    this.lastStateAt = 0
    this.tickHandle = this.clock.setInterval(this.tick, TICK_MS)
    this.pushState()
    // Armed immediately: anything at `at: 0` would otherwise wait a whole tick
    // for its first look at the schedule.
    this.tick()
  }

  stop(): void {
    const wasPlaying = this.schedule !== null
    this.clearTimers()
    this.schedule = null
    this.nextIndex = 0
    // Nothing this player has not started can be sounding, so an idle stop is
    // genuinely a no-op. It matters because `play` stops first: releasing
    // unconditionally would put a panic in front of every single play.
    if (!wasPlaying) return

    this.releaseSounding()
    this.sink.release()
    this.lastOnsetError = summarise(this.onsetErrors)
    if (this.lastOnsetError !== null) reportOnsetError(this.lastOnsetError)
    this.pushState()
  }

  private tick = (): void => {
    try {
      const schedule = this.schedule
      if (schedule === null) return

      const elapsed = this.clock.now() - this.startedAt
      const horizon = elapsed + LOOKAHEAD_MS
      while (this.nextIndex < schedule.events.length) {
        const next = schedule.events[this.nextIndex]
        if (next === undefined || next.at > horizon) break
        this.nextIndex++
        this.arm(next)
      }

      if (this.finished()) {
        this.stop()
        return
      }

      if (elapsed - this.lastStateAt >= STATE_INTERVAL_MS) {
        this.lastStateAt = elapsed
        this.pushState()
      }
    } catch (err) {
      // A throw inside the tick must not be the thing that decides whether a
      // note-off gets sent. Silence first, then let it propagate.
      this.stop()
      throw err
    }
  }

  private finished(): boolean {
    return (
      this.schedule !== null &&
      this.nextIndex >= this.schedule.events.length &&
      this.armed.size === 0
    )
  }

  private arm(scheduled: ScheduledEvent): void {
    const dueIn = this.startedAt + scheduled.at - this.clock.now()
    let handle: unknown = null
    handle = this.clock.setTimeout(() => {
      this.armed.delete(handle)
      this.dispatch(scheduled)
      if (this.finished()) this.stop()
    }, Math.max(0, dueIn))
    this.armed.add(handle)
  }

  private dispatch(scheduled: ScheduledEvent): void {
    const now = this.clock.now()
    if (scheduled.event.kind === 'noteOn') {
      this.onsetErrors.push(now - (this.startedAt + scheduled.at))
    }
    // Restamped at the instant it actually went out, epoch-anchored like every
    // other `t` in this app, so the renderer's clock and main's are comparable.
    this.emit({ ...scheduled.event, t: now })
  }

  private emit(event: MidiEvent): void {
    this.held = reduceHeldNotes(this.held, event)
    if (event.kind !== 'unknown') this.channelsTouched.add(event.ch)
    this.sink.send(event)
    this.deps.onEvent(event)
  }

  /**
   * Note-offs for everything this player has sounded, dispatched down the
   * ordinary path so the instrument and the on-screen keyboard fall silent by
   * the same events. A pedal left down is lifted after them: a note-off under
   * a held sustain does not stop the sound.
   */
  private releaseSounding(): void {
    const sounding = soundingNotes(this.held)
    const sustain = this.held.sustain
    const sostenuto = this.held.sostenuto
    const channels = [...this.channelsTouched].sort((a, b) => a - b)
    const t = this.clock.now()

    for (const note of sounding) {
      this.emit({ kind: 'noteOff', t, ch: note.ch, note: note.note, velocity: 0 })
    }
    for (const ch of channels) {
      if (sustain) this.emit({ kind: 'cc', t, ch, controller: CC_SUSTAIN, value: 0 })
      if (sostenuto) this.emit({ kind: 'cc', t, ch, controller: CC_SOSTENUTO, value: 0 })
    }

    this.held = emptyHeldNotes
    this.channelsTouched.clear()
  }

  private clearTimers(): void {
    if (this.tickHandle !== null) this.clock.clearInterval(this.tickHandle)
    this.tickHandle = null
    for (const handle of this.armed) this.clock.clearTimeout(handle)
    this.armed.clear()
  }

  private pushState(): void {
    const schedule = this.schedule
    if (schedule === null) {
      this.deps.onState({ state: 'idle' })
      return
    }
    const positionMs = Math.min(this.clock.now() - this.startedAt, schedule.durationMs)
    this.deps.onState({
      state: 'playing',
      positionMs,
      durationMs: schedule.durationMs,
      bar: barAt(schedule, positionMs),
    })
  }
}

/**
 * NFR 13's milliseconds are reported, never asserted: they are a measurement
 * of one machine and belong in a plan's implementation log. Main's console is
 * where the figure is read from after a run at the instrument; nothing in the
 * app displays it, and no test checks it.
 */
function reportOnsetError(error: OnsetError): void {
  console.info(
    `player: onset error over ${error.samples} note-ons — ` +
      `p50 ${error.p50.toFixed(1)} ms, p95 ${error.p95.toFixed(1)} ms, max ${error.max.toFixed(1)} ms`
  )
}

function summarise(samples: readonly number[]): OnsetError | null {
  if (samples.length === 0) return null
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    samples: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? 0,
  }
}
