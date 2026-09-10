import { describe, expect, it } from 'vitest'
import { CC_SUSTAIN, type MidiEvent } from '../../../shared/midi'
import type { PlaybackSource } from '../../../shared/player'
import { findScenarioById } from '../midi/generate'
import {
  TRUNCATED_TAIL_MS,
  normaliseSchedule,
  outstandingAtEnd,
  scheduleFromEvents,
} from './schedule'

const scenario: PlaybackSource = { kind: 'scenario', id: 'test' }

function on(t: number, note: number, ch = 0): MidiEvent {
  return { kind: 'noteOn', t, ch, note, velocity: 72 }
}

function off(t: number, note: number, ch = 0): MidiEvent {
  return { kind: 'noteOff', t, ch, note, velocity: 0 }
}

function pedal(t: number, down: boolean, ch = 0): MidiEvent {
  return { kind: 'cc', t, ch, controller: CC_SUSTAIN, value: down ? 127 : 0 }
}

describe('a schedule is relative time', () => {
  it('rebases the first event to zero and keeps the gaps', () => {
    const schedule = scheduleFromEvents([on(5000, 60), off(5300, 60)], scenario)
    expect(schedule.events.map((e) => e.at)).toEqual([0, 300])
    expect(schedule.durationMs).toBe(300)
  })

  it('rewrites each event t to its own at, leaving no absolute time inside', () => {
    const schedule = scheduleFromEvents([on(5000, 60), off(5300, 60)], scenario)
    expect(schedule.events.map((e) => e.event.t)).toEqual([0, 300])
  })

  it('is empty, and lasts nothing, for a source with no events', () => {
    const schedule = scheduleFromEvents([], scenario)
    expect(schedule.events).toEqual([])
    expect(schedule.durationMs).toBe(0)
  })
})

describe('order inside one millisecond', () => {
  it('releases a repeated note before it restrikes', () => {
    // Both at 1000: struck again the instant it is let go. Dispatched the
    // other way round the instrument merges the two into one held note.
    const schedule = scheduleFromEvents([on(1000, 60), off(1000, 60), off(1400, 60)], scenario)
    expect(schedule.events.map((e) => e.event.kind)).toEqual(['noteOff', 'noteOn', 'noteOff'])
  })

  it('puts a pedal between the release and the strike', () => {
    const schedule = scheduleFromEvents([on(0, 60), pedal(0, true), off(0, 62)], scenario)
    expect(schedule.events.slice(0, 3).map((e) => e.event.kind)).toEqual([
      'noteOff',
      'cc',
      'noteOn',
    ])
  })

  it('keeps the arrival order of a chord struck together', () => {
    const schedule = scheduleFromEvents(
      [on(0, 64), on(0, 60), on(0, 67), off(500, 60), off(500, 64), off(500, 67)],
      scenario
    )
    expect(schedule.events.slice(0, 3).map((e) => (e.event as { note: number }).note)).toEqual([
      64, 60, 67,
    ])
  })
})

describe('nothing is left sounding', () => {
  it('releases a note the source never released', () => {
    // A take truncated by a crash: the note-on is written, the note-off never was.
    const schedule = scheduleFromEvents([on(0, 60), off(400, 60), on(800, 67)], scenario)

    const last = schedule.events[schedule.events.length - 1]
    expect(last?.event).toMatchObject({ kind: 'noteOff', note: 67, ch: 0 })
    expect(last?.at).toBe(800 + TRUNCATED_TAIL_MS)
    expect(schedule.durationMs).toBe(800 + TRUNCATED_TAIL_MS)
    expect(outstandingAtEnd(schedule).notes).toEqual([])
  })

  it('releases every open note, on every channel, lowest first', () => {
    const schedule = scheduleFromEvents([on(0, 67), on(0, 60, 1), on(0, 64)], scenario)
    const tail = schedule.events.slice(3).map((e) => e.event)
    expect(tail).toEqual([
      { kind: 'noteOff', t: TRUNCATED_TAIL_MS, ch: 0, note: 64, velocity: 0 },
      { kind: 'noteOff', t: TRUNCATED_TAIL_MS, ch: 0, note: 67, velocity: 0 },
      { kind: 'noteOff', t: TRUNCATED_TAIL_MS, ch: 1, note: 60, velocity: 0 },
    ])
  })

  it('lifts a pedal left down, because a note-off under it does not stop the sound', () => {
    const schedule = scheduleFromEvents([pedal(0, true), on(0, 60), off(400, 60)], scenario)
    const last = schedule.events[schedule.events.length - 1]
    expect(last?.event).toMatchObject({ kind: 'cc', controller: CC_SUSTAIN, value: 0 })
    expect(outstandingAtEnd(schedule).pedals).toEqual([])
  })

  it('closes the notes before it lifts the pedal that was holding them', () => {
    const schedule = scheduleFromEvents([pedal(0, true), on(0, 60)], scenario)
    expect(schedule.events.slice(2).map((e) => e.event.kind)).toEqual(['noteOff', 'cc'])
  })

  it('adds no tail to a schedule that already ends silent', () => {
    const events = [on(0, 60), off(400, 60)]
    const schedule = scheduleFromEvents(events, scenario)
    expect(schedule.events).toHaveLength(2)
    expect(schedule.durationMs).toBe(400)
  })

  it('is not fooled by a note-off for a note that was never struck', () => {
    const schedule = scheduleFromEvents([off(0, 60), on(100, 62), off(200, 62)], scenario)
    expect(outstandingAtEnd(schedule).notes).toEqual([])
    expect(schedule.events).toHaveLength(3)
  })
})

describe('every generated passage produces a silent ending', () => {
  const ids = [
    'virtual:c-major-scale',
    'virtual:ii-V-I-in-F',
    'virtual:a-minor-arpeggios',
    'virtual:dense-2000',
  ]

  for (const id of ids) {
    it(`${id} leaves nothing sounding and nothing pedalled`, () => {
      const generator = findScenarioById(id)
      expect(generator).toBeDefined()
      const schedule = scheduleFromEvents(generator?.generate() ?? [], { kind: 'scenario', id })

      expect(schedule.events.length).toBeGreaterThan(0)
      expect(outstandingAtEnd(schedule)).toEqual({ notes: [], pedals: [] })
      expect(schedule.events.map((e) => e.at)).toEqual(
        [...schedule.events.map((e) => e.at)].sort((a, b) => a - b)
      )
    })
  }

  it('plays the scale up two octaves and back down', () => {
    const generator = findScenarioById('virtual:c-major-scale')
    const schedule = scheduleFromEvents(generator?.generate() ?? [], {
      kind: 'scenario',
      id: 'virtual:c-major-scale',
    })
    const struck = schedule.events
      .filter((e) => e.event.kind === 'noteOn')
      .map((e) => (e.event as { note: number }).note)

    expect(struck).toHaveLength(29)
    expect(struck[0]).toBe(60)
    expect(Math.max(...struck)).toBe(84)
    expect(struck[struck.length - 1]).toBe(60)
  })
})

describe('bars', () => {
  it('carries none for a source that has no bars', () => {
    expect(scheduleFromEvents([on(0, 60), off(100, 60)], scenario).bars).toEqual([])
  })

  it('keeps the bars it was given through the normaliser', () => {
    const schedule = normaliseSchedule(
      [{ at: 0, event: on(0, 60) }],
      { kind: 'timeline', fromBar: 1, toBar: 2, bpm: 80 },
      [
        { bar: 1, at: 0 },
        { bar: 2, at: 750 },
      ]
    )
    expect(schedule.bars).toEqual([
      { bar: 1, at: 0 },
      { bar: 2, at: 750 },
    ])
  })
})
