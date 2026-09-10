import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CC_SUSTAIN, type MidiEvent } from '../../shared/midi'
import type { PlayerState } from '../../shared/player'
import { scheduleFromEvents } from '../../core/src/player/schedule'
import type { MidiSink } from '../midi/MidiSink'
import { LOOKAHEAD_MS, Player, type PlayerClock, TICK_MS } from './Player'

/**
 * A clock the test drives. An eighteen-second passage is checked in
 * milliseconds without the passage being shortened, and -- the reason it is
 * worth the class rather than `vi.useFakeTimers` -- the two kinds of timer the
 * player uses are separable, so a test can prove that onsets come from the
 * armed one-shots and not from the tick boundary.
 */
class TestClock implements PlayerClock {
  private t = 1_000_000
  private nextHandle = 1
  private timeouts = new Map<number, { at: number; fn: () => void }>()
  private intervals = new Map<number, { every: number; next: number; fn: () => void }>()

  now(): number {
    return this.t
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const handle = this.nextHandle++
    this.timeouts.set(handle, { at: this.t + ms, fn })
    return handle
  }

  clearTimeout(handle: unknown): void {
    this.timeouts.delete(handle as number)
  }

  setInterval(fn: () => void, ms: number): unknown {
    const handle = this.nextHandle++
    this.intervals.set(handle, { every: ms, next: this.t + ms, fn })
    return handle
  }

  clearInterval(handle: unknown): void {
    this.intervals.delete(handle as number)
  }

  /** Run time forward, firing everything due, oldest first. */
  advance(ms: number): void {
    const target = this.t + ms
    for (;;) {
      const due = this.nextDue()
      if (due === null || due > target) break
      this.t = due
      this.fireDue()
    }
    this.t = target
  }

  private nextDue(): number | null {
    let due: number | null = null
    for (const timeout of this.timeouts.values()) {
      if (due === null || timeout.at < due) due = timeout.at
    }
    for (const interval of this.intervals.values()) {
      if (due === null || interval.next < due) due = interval.next
    }
    return due
  }

  private fireDue(): void {
    for (const [handle, timeout] of [...this.timeouts]) {
      if (timeout.at > this.t) continue
      this.timeouts.delete(handle)
      timeout.fn()
    }
    for (const [handle, interval] of [...this.intervals]) {
      if (interval.next > this.t) continue
      interval.next = this.t + interval.every
      // Re-read: the callback may have cleared this interval.
      if (this.intervals.has(handle)) interval.fn()
    }
  }
}

class RecordingSink implements MidiSink {
  sent: MidiEvent[] = []
  releases = 0

  async listPorts() {
    return []
  }
  async open() {}
  async close() {}
  send(event: MidiEvent): void {
    this.sent.push(event)
  }
  release(): void {
    this.releases++
  }
}

function on(t: number, note: number, ch = 0): MidiEvent {
  return { kind: 'noteOn', t, ch, note, velocity: 72 }
}

function off(t: number, note: number, ch = 0): MidiEvent {
  return { kind: 'noteOff', t, ch, note, velocity: 0 }
}

const SOURCE = { kind: 'scenario' as const, id: 'test' }

let clock: TestClock
let sink: RecordingSink
let events: MidiEvent[]
let states: PlayerState[]
let player: Player

beforeEach(() => {
  // The onset-error line is a measurement for a human at the instrument
  // (NFR 13), not test output.
  vi.spyOn(console, 'info').mockImplementation(() => {})
  clock = new TestClock()
  sink = new RecordingSink()
  events = []
  states = []
  player = new Player({
    sink,
    clock,
    onEvent: (event) => events.push(event),
    onState: (state) => states.push(state),
  })
})

const SCALE = scheduleFromEvents(
  [on(0, 60), off(300, 60), on(400, 62), off(700, 62), on(800, 64), off(1100, 64)],
  SOURCE
)

describe('the schedule reaches the sink complete and in order', () => {
  it('delivers every event, once, in the schedule order', () => {
    player.play(SCALE)
    clock.advance(2000)

    expect(sink.sent).toHaveLength(SCALE.events.length)
    expect(sink.sent.map((e) => e.kind)).toEqual(SCALE.events.map((e) => e.event.kind))
    expect(sink.sent.map((e) => ('note' in e ? e.note : -1))).toEqual(
      SCALE.events.map((e) => ('note' in e.event ? e.event.note : -1))
    )
  })

  it('pushes the same events to the renderer as it writes to the sink', () => {
    player.play(SCALE)
    clock.advance(2000)
    expect(events).toEqual(sink.sent)
  })

  it('dispatches nothing before its own time', () => {
    player.play(SCALE)
    clock.advance(350)
    // At 350 ms the first note has been struck and released; the second has not.
    expect(events.map((e) => e.kind)).toEqual(['noteOn', 'noteOff'])
  })

  it('restamps each event with the instant it went out', () => {
    const startedAt = clock.now()
    player.play(SCALE)
    clock.advance(2000)

    expect(events.map((e) => e.t - startedAt)).toEqual(SCALE.events.map((e) => e.at))
  })

  it('arms one timer per event rather than dispatching on the tick boundary', () => {
    // The second note falls 10 ms in, inside the first 25 ms tick. Quantised
    // to the tick it would go out at 25 ms; NFR 13 wants it at 10.
    const schedule = scheduleFromEvents([on(0, 48), on(10, 60), off(300, 48), off(300, 60)], SOURCE)
    const startedAt = clock.now()
    player.play(schedule)
    clock.advance(500)

    expect(events[0]?.t).toBe(startedAt)
    expect(events[1]?.t).toBe(startedAt + 10)
    expect(TICK_MS).toBe(25)
  })

  it('reaches past the lookahead window by ticking, not by arming everything', () => {
    const long = scheduleFromEvents([on(0, 60), off(100, 60), on(5000, 72), off(5300, 72)], SOURCE)
    player.play(long)

    clock.advance(200)
    expect(events).toHaveLength(2)
    expect(5000).toBeGreaterThan(LOOKAHEAD_MS)

    clock.advance(5200)
    expect(events).toHaveLength(4)
  })
})

describe('stop always stops', () => {
  it('leaves nothing sounding when stopped mid-chord', () => {
    const chord = scheduleFromEvents([on(0, 60), on(0, 64), on(0, 67), off(4000, 60), off(4000, 64), off(4000, 67)], SOURCE)
    player.play(chord)
    clock.advance(500)
    expect(events.filter((e) => e.kind === 'noteOn')).toHaveLength(3)

    player.stop()

    const offs = events.filter((e) => e.kind === 'noteOff')
    expect(offs.map((e) => ('note' in e ? e.note : -1))).toEqual([60, 64, 67])
    expect(sink.releases).toBeGreaterThan(0)
  })

  it('lifts a pedal it left down, after the notes it was holding', () => {
    const pedalled = scheduleFromEvents(
      [
        { kind: 'cc', t: 0, ch: 0, controller: CC_SUSTAIN, value: 127 },
        on(10, 60),
        off(100, 60),
        { kind: 'cc', t: 4000, ch: 0, controller: CC_SUSTAIN, value: 0 },
      ],
      SOURCE
    )
    player.play(pedalled)
    clock.advance(200)
    events.length = 0

    player.stop()

    expect(events).toEqual([
      { kind: 'noteOff', t: clock.now(), ch: 0, note: 60, velocity: 0 },
      { kind: 'cc', t: clock.now(), ch: 0, controller: CC_SUSTAIN, value: 0 },
    ])
  })

  it('dispatches nothing more after a stop', () => {
    player.play(SCALE)
    clock.advance(350)
    player.stop()
    const after = events.length

    clock.advance(5000)

    expect(events).toHaveLength(after)
  })

  it('releases a chord on every channel it touched', () => {
    const twoZones = scheduleFromEvents([on(0, 60, 0), on(0, 48, 3), off(4000, 60, 0), off(4000, 48, 3)], SOURCE)
    player.play(twoZones)
    clock.advance(100)
    events.length = 0

    player.stop()

    expect(events).toEqual([
      { kind: 'noteOff', t: clock.now(), ch: 3, note: 48, velocity: 0 },
      { kind: 'noteOff', t: clock.now(), ch: 0, note: 60, velocity: 0 },
    ])
  })

  it('is safe to stop when nothing is playing', () => {
    expect(() => player.stop()).not.toThrow()
    expect(events).toEqual([])
    expect(states).toEqual([])
  })

  it('treats a second play as a stop and a start, never two schedules at once', () => {
    player.play(SCALE)
    clock.advance(100)

    player.play(scheduleFromEvents([on(0, 72), off(200, 72)], SOURCE))
    clock.advance(1000)

    // The first schedule's note is released by the interruption, and its
    // remaining notes never arrive.
    const struck = events.filter((e) => e.kind === 'noteOn').map((e) => ('note' in e ? e.note : -1))
    expect(struck).toEqual([60, 72])
  })

  it('runs to the end on its own and reports idle', () => {
    player.play(SCALE)
    clock.advance(2000)

    expect(player.playing).toBe(false)
    expect(states[states.length - 1]).toEqual({ state: 'idle' })
  })
})

describe('the transport reports where it is', () => {
  it('reports playing on the first push and idle on the last', () => {
    player.play(SCALE)
    expect(states[0]).toMatchObject({ state: 'playing', positionMs: 0, durationMs: 1100 })

    clock.advance(2000)
    expect(states[states.length - 1]).toEqual({ state: 'idle' })
  })

  it('advances the position a few times a second, not per event', () => {
    const dense = scheduleFromEvents(
      Array.from({ length: 100 }, (_, i) => [on(i * 20, 60 + (i % 12)), off(i * 20 + 10, 60 + (i % 12))]).flat(),
      SOURCE
    )
    player.play(dense)
    clock.advance(2100)

    const playing = states.filter((s) => s.state === 'playing')
    expect(playing.length).toBeGreaterThan(2)
    expect(playing.length).toBeLessThan(dense.events.length / 4)
  })

  it('has no bar to report for a source with no bars', () => {
    player.play(SCALE)
    expect(states[0]).toMatchObject({ bar: null })
  })
})

describe('the sink can be swapped under a running schedule', () => {
  it('silences the sink it is leaving', () => {
    player.play(SCALE)
    clock.advance(100)

    const other = new RecordingSink()
    player.setSink(other)

    expect(sink.releases).toBe(1)
    clock.advance(2000)
    expect(other.sent.length).toBeGreaterThan(0)
  })

  it('does nothing when handed the sink it already has', () => {
    player.setSink(sink)
    expect(sink.releases).toBe(0)
  })
})

describe('the onset error is measured, not asserted', () => {
  it('summarises the schedule that just ran', () => {
    player.play(SCALE)
    clock.advance(2000)

    // The test clock is exact, so the figures are zero; what is asserted is
    // that there is a reading of the right size for NFR 13's log row, never a
    // millisecond budget.
    expect(player.onsetError).toEqual({ samples: 3, p50: 0, p95: 0, max: 0 })
  })

  it('has nothing to report before anything has played', () => {
    expect(player.onsetError).toBeNull()
  })
})
