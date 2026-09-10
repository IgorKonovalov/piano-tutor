import { describe, expect, it } from 'vitest'
import { MidiParser, toBytes } from './parse'
import type { MidiEvent } from '../../shared/midi'

const T = 1000

function parse(bytes: number[]): MidiEvent[] {
  return new MidiParser().parse(bytes, T)
}

describe('channel messages', () => {
  it('parses a note-on with its channel and velocity', () => {
    expect(parse([0x93, 60, 100])).toEqual([
      { kind: 'noteOn', t: T, ch: 3, note: 60, velocity: 100 },
    ])
  })

  it('parses a note-off', () => {
    expect(parse([0x81, 64, 40])).toEqual([
      { kind: 'noteOff', t: T, ch: 1, note: 64, velocity: 40 },
    ])
  })

  it('treats a note-on with velocity 0 as a note-off', () => {
    expect(parse([0x90, 60, 0])).toEqual([
      { kind: 'noteOff', t: T, ch: 0, note: 60, velocity: 0 },
    ])
  })

  it('parses a control change', () => {
    expect(parse([0xb0, 64, 127])).toEqual([
      { kind: 'cc', t: T, ch: 0, controller: 64, value: 127 },
    ])
  })

  it('parses a program change from its single data byte', () => {
    expect(parse([0xc5, 42])).toEqual([{ kind: 'programChange', t: T, ch: 5, program: 42 }])
  })

  it('parses pitch bend as a signed value centred on zero', () => {
    expect(parse([0xe0, 0x00, 0x40])).toEqual([{ kind: 'pitchBend', t: T, ch: 0, value: 0 }])
    expect(parse([0xe0, 0x00, 0x00])).toEqual([{ kind: 'pitchBend', t: T, ch: 0, value: -8192 }])
    expect(parse([0xe0, 0x7f, 0x7f])).toEqual([{ kind: 'pitchBend', t: T, ch: 0, value: 8191 }])
  })

  it('keeps every one of the CK88 zones on its own channel', () => {
    const events = parse([0x90, 60, 64, 0x91, 62, 64, 0x92, 64, 64, 0x93, 65, 64])
    expect(events.map((e) => (e.kind === 'noteOn' ? e.ch : -1))).toEqual([0, 1, 2, 3])
  })
})

describe('running status', () => {
  it('reuses the last channel status for bare data bytes', () => {
    expect(parse([0x90, 60, 100, 62, 100, 64, 100])).toEqual([
      { kind: 'noteOn', t: T, ch: 0, note: 60, velocity: 100 },
      { kind: 'noteOn', t: T, ch: 0, note: 62, velocity: 100 },
      { kind: 'noteOn', t: T, ch: 0, note: 64, velocity: 100 },
    ])
  })

  it('carries running status across separate arrivals', () => {
    const parser = new MidiParser()
    expect(parser.parse([0x90, 60, 100], T)).toHaveLength(1)
    expect(parser.parse([62, 100], T + 5)).toEqual([
      { kind: 'noteOn', t: T + 5, ch: 0, note: 62, velocity: 100 },
    ])
  })

  it('releases notes under running status through velocity 0', () => {
    expect(parse([0x90, 60, 100, 60, 0])).toEqual([
      { kind: 'noteOn', t: T, ch: 0, note: 60, velocity: 100 },
      { kind: 'noteOff', t: T, ch: 0, note: 60, velocity: 0 },
    ])
  })

  it('is cancelled by a system common message', () => {
    const events = parse([0x90, 60, 100, 0xf3, 2, 62, 100])
    expect(events[0]).toEqual({ kind: 'noteOn', t: T, ch: 0, note: 60, velocity: 100 })
    expect(events[1]).toEqual({ kind: 'unknown', t: T, bytes: [0xf3, 2] })
    // 62 and 100 arrive with no armed status and are reported, not guessed at.
    expect(events.slice(2)).toEqual([
      { kind: 'unknown', t: T, bytes: [62] },
      { kind: 'unknown', t: T, bytes: [100] },
    ])
  })
})

describe('real-time bytes interleaved mid-message', () => {
  it('drops a clock byte between the status and the data bytes', () => {
    expect(parse([0x90, 0xf8, 60, 0xf8, 100])).toEqual([
      { kind: 'noteOn', t: T, ch: 0, note: 60, velocity: 100 },
    ])
  })

  it('drops active sensing without breaking running status', () => {
    expect(parse([0x90, 60, 100, 0xfe, 62, 100])).toEqual([
      { kind: 'noteOn', t: T, ch: 0, note: 60, velocity: 100 },
      { kind: 'noteOn', t: T, ch: 0, note: 62, velocity: 100 },
    ])
  })
})

describe('what cannot be understood', () => {
  it('reports a data byte that arrives before any status', () => {
    expect(parse([60, 100])).toEqual([
      { kind: 'unknown', t: T, bytes: [60] },
      { kind: 'unknown', t: T, bytes: [100] },
    ])
  })

  it('types polyphonic key pressure rather than dropping it', () => {
    expect(parse([0xa0, 60, 90])).toEqual([{ kind: 'unknown', t: T, bytes: [0xa0, 60, 90] }])
  })

  it('collects a complete sysex dump as one unknown event', () => {
    expect(parse([0xf0, 0x43, 0x10, 0x4c, 0xf7])).toEqual([
      { kind: 'unknown', t: T, bytes: [0xf0, 0x43, 0x10, 0x4c, 0xf7] },
    ])
  })

  it('reports a truncated sysex and still parses the message that interrupted it', () => {
    expect(parse([0xf0, 0x43, 0x10, 0x90, 60, 100])).toEqual([
      { kind: 'unknown', t: T, bytes: [0xf0, 0x43, 0x10] },
      { kind: 'noteOn', t: T, ch: 0, note: 60, velocity: 100 },
    ])
  })

  it('never throws on a truncated message, and recovers on the next status', () => {
    const parser = new MidiParser()
    expect(() => parser.parse([0x90, 60], T)).not.toThrow()
    expect(parser.parse([0x80, 60, 0], T)).toEqual([
      { kind: 'noteOff', t: T, ch: 0, note: 60, velocity: 0 },
    ])
  })
})

describe('toBytes', () => {
  it('round-trips every event kind back through the parser', () => {
    const events: MidiEvent[] = [
      { kind: 'noteOn', t: T, ch: 2, note: 60, velocity: 100 },
      { kind: 'noteOff', t: T, ch: 2, note: 60, velocity: 64 },
      { kind: 'cc', t: T, ch: 0, controller: 64, value: 127 },
      { kind: 'programChange', t: T, ch: 9, program: 3 },
      { kind: 'pitchBend', t: T, ch: 1, value: -4096 },
    ]
    for (const event of events) {
      expect(new MidiParser().parse(toBytes(event), T)).toEqual([event])
    }
  })
})
