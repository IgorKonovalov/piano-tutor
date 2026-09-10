/**
 * The scheduling both non-device sources share: a list of byte messages with
 * relative times, played out on one timer, stamped at delivery.
 *
 * It is shared rather than written twice because this is the code NFR 2 is
 * about. `SyntheticSource` and `ReplaySource` differ only in where their bytes
 * come from -- a seeded generator or a take file -- and a second copy of the
 * flush loop would be a second place for an event to go missing.
 */

/**
 * Time and timers, injected. Production passes the system clock; a test passes
 * one it can drive, so an eighteen-second passage is checked in milliseconds
 * without the passage being shortened.
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

export interface TimedMessage {
  /** Milliseconds from the start of the passage. */
  t: number
  bytes: Uint8Array
}

export abstract class TimedByteSource {
  private listeners = new Set<(bytes: Uint8Array, t: number) => void>()
  private timer: unknown = null
  private startedAt = 0
  private queue: TimedMessage[] = []
  private index = 0
  private rate = 1

  constructor(protected readonly clock: Clock = systemClock) {}

  onMessage(cb: (bytes: Uint8Array, t: number) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  /** True once every message has been delivered. */
  get finished(): boolean {
    return this.index >= this.queue.length
  }

  /** `speed` above 1 plays faster; the recorded intervals scale by 1/speed. */
  protected play(messages: TimedMessage[], speed = 1): void {
    this.stopPlayback()
    this.queue = messages
    this.index = 0
    this.rate = speed
    this.startedAt = this.clock.now()
    this.tick()
  }

  protected stopPlayback(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer)
    this.timer = null
    this.queue = []
    this.index = 0
  }

  /**
   * One timer for the whole passage rather than one per message: a dense
   * passage is two thousand messages, and two thousand pending timers is a
   * different program from the one being tested. Everything due is flushed on
   * each wake, so a late wake delivers a burst rather than losing it.
   */
  private tick = (): void => {
    this.timer = null
    const elapsed = (this.clock.now() - this.startedAt) * this.rate

    while (this.index < this.queue.length) {
      const next = this.queue[this.index]
      if (next === undefined || next.t > elapsed) break
      this.index++
      this.emit(next.bytes)
    }

    const upcoming = this.queue[this.index]
    if (upcoming === undefined) return
    const remaining = upcoming.t - (this.clock.now() - this.startedAt) * this.rate
    this.timer = this.clock.setTimeout(this.tick, Math.max(0, remaining / this.rate))
  }

  private emit(bytes: Uint8Array): void {
    // Stamped here, before anything parses it, exactly as the RtMidi callback
    // stamps a real message.
    const t = this.clock.now()
    for (const listener of this.listeners) listener(bytes, t)
  }
}
