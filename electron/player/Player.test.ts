import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `@julusian/midi`, faked the way the sink's own test fakes it. It is here as
 * well because the panic paths are only worth asserting where they land: the
 * bytes an instrument would actually receive.
 */
const midi = vi.hoisted(() => {
  const state = { written: [] as number[][], closes: 0 }

  class FakeOutput {
    getPortCount(): number {
      return 1
    }
    getPortName(): string {
      return 'CK Series-1'
    }
    openPort(): void {}
    sendMessage(bytes: number[]): void {
      state.written.push([...bytes])
    }
    closePort(): void {
      state.closes++
    }
    destroy(): void {}
  }

  return { state, FakeOutput }
})

vi.mock('@julusian/midi', () => ({ Output: midi.FakeOutput }))

import { CC_SUSTAIN, type MidiEvent } from '../../shared/midi'
import type { PlayerState } from '../../shared/player'
import { scheduleFromEvents } from '../../core/src/player/schedule'
import type { MidiSink } from '../midi/MidiSink'
import { CC_ALL_NOTES_OFF, RtMidiSink } from '../midi/RtMidiSink'
import { LOOKAHEAD_MS, Player, type PlayerClock, TICK_MS, silence } from './Player'

/**
 * A clock the test drives. An eighteen-second passage is checked in
 * milliseconds without the passage being shortened, and -- the reason it is
 * worth the class rather than `vi.useFakeTimers` -- the two kinds of timer the
 * player uses are separable, so a test can prove that onsets come from the
 * armed one-shots and not from the tick boundary.
 */
class TestClock implements PlayerClock {
  /** Set to make the next reading throw, once, as a bug in the tick would. */
  throwOnNextNow = false
  private t = 1_000_000
  private nextHandle = 1
  private timeouts = new Map<number, { at: number; fn: () => void }>()
  private intervals = new Map<number, { every: number; next: number; fn: () => void }>()

  now(): number {
    if (this.throwOnNextNow) {
      this.throwOnNextNow = false
      throw new Error('something went wrong inside the tick')
    }
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
/** Set to make every push to the renderer throw, as a dead window does. */
let rendererRefuses = false

beforeEach(() => {
  // The onset-error line is a measurement for a human at the instrument
  // (NFR 13), not test output.
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  rendererRefuses = false
  midi.state.written = []
  midi.state.closes = 0
  clock = new TestClock()
  sink = new RecordingSink()
  events = []
  states = []
  player = new Player({
    sink,
    clock,
    onEvent: (event) => {
      if (rendererRefuses) throw new Error('the window has gone')
      events.push(event)
    },
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

  it('reports idle when handed a schedule with nothing in it', () => {
    // Silence is a legitimate answer; saying nothing at all is not. A caller
    // waiting for a state push after play() would otherwise wait forever.
    player.play(scheduleFromEvents([], SOURCE))

    expect(player.playing).toBe(false)
    expect(states).toEqual([{ state: 'idle' }])
    expect(events).toEqual([])
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

/**
 * The six ways playback can end that are not the schedule running out.
 *
 * They are checked against the **faked `Output`** rather than against the
 * player's own callbacks, because the thing this plan exists to prevent
 * happens on the far side of that boundary: a chord ringing on an instrument
 * in the room. What each path must produce is the same three things -- a
 * note-off for every note then sounding, then All Notes Off and sustain-up on
 * every channel touched.
 */
describe('stop always stops, and the instrument hears it', () => {
  const CHORD = scheduleFromEvents(
    [
      { kind: 'cc', t: 0, ch: 0, controller: CC_SUSTAIN, value: 127 },
      on(0, 60),
      on(0, 64, 3),
      off(9000, 60),
      off(9000, 64, 3),
      { kind: 'cc', t: 9000, ch: 0, controller: CC_SUSTAIN, value: 0 },
    ],
    SOURCE
  )

  let sink: RtMidiSink

  /** Play the chord, let it sound, and forget everything written so far. */
  async function sounding(): Promise<void> {
    sink = new RtMidiSink()
    await sink.open('out:0')
    player.setSink(sink)
    player.play(CHORD)
    clock.advance(200)
    expect(midi.state.written.length).toBeGreaterThan(0)
    midi.state.written = []
  }

  /**
   * The note-offs for what was sounding, then the controllers on every channel
   * the schedule touched. Channel 0 held the pedal and note 60; channel 3 held
   * note 64.
   */
  const RELEASED = [
    [0x80, 60, 0],
    [0x83, 64, 0],
    [0xb0, CC_ALL_NOTES_OFF, 0],
    [0xb0, CC_SUSTAIN, 0],
    [0xb3, CC_ALL_NOTES_OFF, 0],
    [0xb3, CC_SUSTAIN, 0],
  ]

  /** Everything the player pushes on a release, before the sink's own panic. */
  const PLAYER_RELEASE = [
    [0x80, 60, 0],
    [0x83, 64, 0],
    [0xb0, CC_SUSTAIN, 0],
    [0xb3, CC_SUSTAIN, 0],
  ]

  it('on stop', async () => {
    await sounding()
    player.stop()
    expect(midi.state.written).toEqual([
      ...PLAYER_RELEASE,
      [0xb0, CC_ALL_NOTES_OFF, 0],
      [0xb0, CC_SUSTAIN, 0],
      [0xb3, CC_ALL_NOTES_OFF, 0],
      [0xb3, CC_SUSTAIN, 0],
    ])
  })

  it('on an output change mid-play', async () => {
    await sounding()
    player.setSink(new RecordingSink())

    // The sink being left behind is silenced by its own panic: the note-offs
    // the schedule still holds are about to go somewhere else entirely.
    expect(midi.state.written).toEqual(RELEASED)
  })

  it('on a second play over a running one', async () => {
    await sounding()
    player.play(scheduleFromEvents([on(0, 72), off(400, 72)], SOURCE))

    // The first schedule's chord is released before the second is struck.
    expect(midi.state.written.slice(0, PLAYER_RELEASE.length + 4)).toEqual([
      ...PLAYER_RELEASE,
      [0xb0, CC_ALL_NOTES_OFF, 0],
      [0xb0, CC_SUSTAIN, 0],
      [0xb3, CC_ALL_NOTES_OFF, 0],
      [0xb3, CC_SUSTAIN, 0],
    ])
  })

  it('on the window closing, and on the app quitting', async () => {
    // Both lifecycle events run the same two lines in main; this is them.
    await sounding()
    await silence(player, sink)

    expect(midi.state.written).toEqual([
      ...PLAYER_RELEASE,
      [0xb0, CC_ALL_NOTES_OFF, 0],
      [0xb0, CC_SUSTAIN, 0],
      [0xb3, CC_ALL_NOTES_OFF, 0],
      [0xb3, CC_SUSTAIN, 0],
    ])
    expect(midi.state.closes).toBe(1)
  })

  it('on a throw inside the tick', async () => {
    await sounding()
    clock.throwOnNextNow = true

    // The throw propagates -- a scheduler that silently swallows its own bugs
    // is worse than one that stops -- but not before the release has gone out.
    expect(() => clock.advance(TICK_MS + 1)).toThrow(/tick/)

    expect(midi.state.written).toEqual([
      ...PLAYER_RELEASE,
      [0xb0, CC_ALL_NOTES_OFF, 0],
      [0xb0, CC_SUSTAIN, 0],
      [0xb3, CC_ALL_NOTES_OFF, 0],
      [0xb3, CC_SUSTAIN, 0],
    ])
    expect(player.playing).toBe(false)
  })

  it('even when every push to the renderer throws', async () => {
    await sounding()
    // The window going is not a reason for the instrument to keep sounding.
    // `webContents.send` can fail on exactly the path that carries the last
    // note-offs, so the release must not depend on the renderer accepting it.
    rendererRefuses = true

    player.stop()

    expect(midi.state.written).toEqual([
      ...PLAYER_RELEASE,
      [0xb0, CC_ALL_NOTES_OFF, 0],
      [0xb0, CC_SUSTAIN, 0],
      [0xb3, CC_ALL_NOTES_OFF, 0],
      [0xb3, CC_SUSTAIN, 0],
    ])
    expect(player.playing).toBe(false)
  })

  it('leaves nothing armed after any of them', async () => {
    await sounding()
    player.stop()
    midi.state.written = []

    clock.advance(20_000)

    expect(midi.state.written).toEqual([])
  })
})
