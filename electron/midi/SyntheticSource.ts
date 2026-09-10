import type { MidiPort } from '../../shared/midi'
import { MidiPortUnavailable, type MidiSource } from './MidiSource'
import { toBytes } from './parse'
import { findScenarioById } from '../../core/src/midi/generate'
import { listVirtualPorts, type HarnessGate } from './virtualPorts'

/**
 * The app playing itself (ADR-0004). It sits exactly where `RtMidiSource`
 * sits and hands the same callback the same shape of data: **bytes**, not
 * events. Emitting bytes is the point -- the parser, the arrival stamp, the
 * recorder, the Zod boundary and React are all on the path a green harness run
 * has exercised. Feeding events straight in would prove the least interesting
 * third of the pipeline.
 *
 * What it cannot prove: USB, RtMidi's own behaviour, port exclusivity, the
 * CK88's four zones, and the velocity range a player produces. Those are the
 * instrument's phase.
 */

/**
 * Time and timers, injected. Production passes the system clock; a test passes
 * one it can drive, so an eighteen-second scenario is checked in milliseconds
 * without the scenario itself being made shorter or faster than NFR 2 asks.
 */
export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const systemClock: Clock = {
  // Epoch-anchored so the stamp is comparable with the renderer's clock; see
  // the note on `t` in shared/midi.ts.
  now: () => performance.timeOrigin + performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class SyntheticSource implements MidiSource {
  private listeners = new Set<(bytes: Uint8Array, t: number) => void>()
  private timer: unknown = null
  private startedAt = 0
  private queue: { t: number; bytes: Uint8Array }[] = []
  private index = 0

  constructor(
    private readonly gate: HarnessGate,
    private readonly clock: Clock = systemClock
  ) {}

  async listPorts(): Promise<MidiPort[]> {
    return listVirtualPorts(this.gate)
  }

  async open(portId: string): Promise<void> {
    const scenario = findScenarioById(portId)
    if (scenario === undefined) {
      throw new MidiPortUnavailable(portId, `No generated scenario is named ${portId}`)
    }
    await this.close()
    this.queue = scenario.generate().map((event) => ({
      t: event.t,
      bytes: Uint8Array.from(toBytes(event)),
    }))
    this.index = 0
    this.startedAt = this.clock.now()
    this.tick()
  }

  async close(): Promise<void> {
    if (this.timer !== null) this.clock.clearTimeout(this.timer)
    this.timer = null
    this.queue = []
    this.index = 0
  }

  onMessage(cb: (bytes: Uint8Array, t: number) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  /** True once every generated message has been delivered. */
  get finished(): boolean {
    return this.index >= this.queue.length
  }

  /**
   * One timer for the whole scenario rather than one per message: a dense
   * passage is two thousand messages, and two thousand pending timers is a
   * different program from the one being tested. Everything due is flushed on
   * each wake, so a late wake delivers a burst rather than losing it (NFR 2).
   */
  private tick = (): void => {
    this.timer = null
    const elapsed = this.clock.now() - this.startedAt

    while (this.index < this.queue.length) {
      const next = this.queue[this.index]
      if (next === undefined || next.t > elapsed) break
      this.index++
      this.emit(next.bytes)
    }

    const upcoming = this.queue[this.index]
    if (upcoming === undefined) return
    const delay = Math.max(0, upcoming.t - (this.clock.now() - this.startedAt))
    this.timer = this.clock.setTimeout(this.tick, delay)
  }

  private emit(bytes: Uint8Array): void {
    // Stamped here, before anything parses it, exactly as the RtMidi callback
    // stamps a real message.
    const t = this.clock.now()
    for (const listener of this.listeners) listener(bytes, t)
  }
}
