import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The native binding, faked the way `RtMidiSource.test.ts` fakes the input
 * half. Real RtMidi cannot be asked what bytes it was handed, and the bytes
 * are the whole claim: ADR-0006's "listing opens nothing" and ADR-0007's "the
 * schedule reaches the instrument in order" are both statements about calls
 * that have to be observable.
 */
const midi = vi.hoisted(() => {
  const state = {
    ports: [] as string[],
    refuse: new Set<number>(),
    opens: [] as number[],
    /** Every message any instance has written, in order. */
    written: [] as number[][],
    /** Ports whose `sendMessage` should throw, as an unplugged device would. */
    broken: false,
    closes: 0,
    instances: 0,
  }

  class FakeOutput {
    constructor() {
      state.instances++
    }
    getPortCount(): number {
      return state.ports.length
    }
    getPortName(index: number): string {
      return state.ports[index] ?? ''
    }
    openPort(index: number): void {
      state.opens.push(index)
      if (state.refuse.has(index)) throw new Error('MidiOutWinMM::openPort: cannot open port')
    }
    sendMessage(bytes: number[]): void {
      if (state.broken) throw new Error('MidiOutWinMM::sendMessage: error sending message')
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

import type { MidiEvent } from '../../shared/midi'
import { CC_SUSTAIN } from '../../shared/midi'
import { scheduleFromEvents } from '../../core/src/player/schedule'
import { CC_ALL_NOTES_OFF, RtMidiSink } from './RtMidiSink'
import { serialise } from './serialise'

beforeEach(() => {
  midi.state.ports = ['CK Series-1', 'Microsoft GS Wavetable Synth']
  midi.state.refuse = new Set()
  midi.state.opens = []
  midi.state.written = []
  midi.state.broken = false
  midi.state.closes = 0
  midi.state.instances = 0
})

function on(t: number, note: number, ch = 0): MidiEvent {
  return { kind: 'noteOn', t, ch, note, velocity: 72 }
}

function off(t: number, note: number, ch = 0): MidiEvent {
  return { kind: 'noteOff', t, ch, note, velocity: 0 }
}

describe('listing does not touch the device', () => {
  it('opens no handle, however many times it is polled', async () => {
    const sink = new RtMidiSink()
    for (let poll = 0; poll < 5; poll++) await sink.listPorts()
    expect(midi.state.opens).toEqual([])
  })

  it('enumerates outputs as out:<index>, in the driver order', async () => {
    const ports = await new RtMidiSink().listPorts()
    expect(ports.map((p) => p.id)).toEqual(['out:0', 'out:1'])
    expect(ports.map((p) => p.name)).toEqual(['CK Series-1', 'Microsoft GS Wavetable Synth'])
    expect(ports.every((p) => p.kind === 'hardware')).toBe(true)
  })

  it('builds one enumerator and keeps it across polls', async () => {
    const sink = new RtMidiSink()
    await sink.listPorts()
    await sink.listPorts()
    expect(midi.state.instances).toBe(1)
  })

  it('sets busy only after an open has actually been refused', async () => {
    midi.state.refuse = new Set([0])
    const sink = new RtMidiSink()
    expect((await sink.listPorts())[0]?.availability).toBe('available')

    await expect(sink.open('out:0')).rejects.toThrow(/would not open/)

    const rows = await sink.listPorts()
    expect(rows[0]?.availability).toBe('busy')
    expect(rows[0]?.detail).toContain('cannot open port')
    expect(rows[1]?.availability).toBe('available')
  })

  it('forgets the refusal when the port stops being enumerated', async () => {
    midi.state.refuse = new Set([1])
    const sink = new RtMidiSink()
    await expect(sink.open('out:1')).rejects.toThrow()
    expect((await sink.listPorts())[1]?.availability).toBe('busy')

    midi.state.ports = ['CK Series-1']
    await sink.listPorts()
    midi.state.ports = ['CK Series-1', 'A different instrument']
    expect((await sink.listPorts())[1]?.availability).toBe('available')
  })

  it('says which port is the one currently open', async () => {
    const sink = new RtMidiSink()
    await sink.open('out:1')
    const rows = await sink.listPorts()
    expect(rows[1]?.detail).toBe('Open')
    expect(rows[0]?.detail).toBeUndefined()
  })

  it('refuses an id that is not an output port without touching anything', async () => {
    const sink = new RtMidiSink()
    await expect(sink.open('hw:0')).rejects.toThrow(/not an output port/)
    expect(midi.state.opens).toEqual([])
  })
})

describe('a schedule reaches the instrument as bytes', () => {
  it('writes exactly the byte sequence the schedule describes, in order', async () => {
    const schedule = scheduleFromEvents(
      [
        on(0, 60),
        { kind: 'cc', t: 0, ch: 0, controller: CC_SUSTAIN, value: 127 },
        on(200, 64),
        off(400, 60),
        off(600, 64),
        { kind: 'cc', t: 600, ch: 0, controller: CC_SUSTAIN, value: 0 },
      ],
      { kind: 'scenario', id: 'test' }
    )

    const sink = new RtMidiSink()
    await sink.open('out:0')
    for (const { event } of schedule.events) sink.send(event)

    expect(midi.state.written).toEqual(schedule.events.map((e) => serialise(e.event)))
  })

  it('writes nothing before a port is open, and everything after', async () => {
    const sink = new RtMidiSink()
    sink.send(on(0, 60))
    expect(midi.state.written).toEqual([])

    await sink.open('out:0')
    sink.send(on(0, 62))
    expect(midi.state.written).toEqual([[0x90, 62, 72]])
  })
})

describe('the sink remembers what it has sounded', () => {
  /**
   * The controllers that follow the note-offs on every channel the sink has
   * written to. Both are sent because neither is sufficient: the note-offs
   * only cover what this process knows it started, and CC 123 is a message
   * some instruments ignore.
   */
  function controllers(channel: number): number[][] {
    return [
      [0xb0 | channel, CC_ALL_NOTES_OFF, 0],
      [0xb0 | channel, CC_SUSTAIN, 0],
    ]
  }

  it('releases every note still down, on every channel it touched', async () => {
    const sink = new RtMidiSink()
    await sink.open('out:0')
    sink.send(on(0, 60))
    sink.send(on(0, 64, 2))
    sink.send(on(0, 67))
    sink.send(off(100, 64, 2))
    midi.state.written = []

    sink.release()

    expect(midi.state.written).toEqual([
      [0x80, 60, 0],
      [0x80, 67, 0],
      ...controllers(0),
      ...controllers(2),
    ])
  })

  it('releases a note the pedal is still holding after the key came up', async () => {
    const sink = new RtMidiSink()
    await sink.open('out:0')
    sink.send({ kind: 'cc', t: 0, ch: 0, controller: CC_SUSTAIN, value: 127 })
    sink.send(on(0, 60))
    sink.send(off(100, 60))
    midi.state.written = []

    sink.release()

    expect(midi.state.written).toEqual([[0x80, 60, 0], ...controllers(0)])
  })

  it('spends the memory, so a second release writes nothing', async () => {
    const sink = new RtMidiSink()
    await sink.open('out:0')
    sink.send(on(0, 60))
    sink.release()
    midi.state.written = []

    sink.release()

    expect(midi.state.written).toEqual([])
  })

  it('silences the notes before it closes the port', async () => {
    const sink = new RtMidiSink()
    await sink.open('out:0')
    sink.send(on(0, 60))
    midi.state.written = []

    await sink.close()

    expect(midi.state.written).toEqual([[0x80, 60, 0], ...controllers(0)])
    expect(midi.state.closes).toBe(1)
  })

  it('never throws when the output refuses a message', async () => {
    const sink = new RtMidiSink()
    await sink.open('out:0')
    midi.state.broken = true

    expect(() => sink.send(on(0, 60))).not.toThrow()
    expect(() => sink.release()).not.toThrow()
  })
})
