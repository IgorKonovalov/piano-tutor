import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The native binding, faked. Real RtMidi cannot be asked "did you open
 * anything?", and the central claim of ADR-0006 is exactly that listing opens
 * nothing, so the count of `openPort` calls has to be observable.
 */
const midi = vi.hoisted(() => {
  const state = {
    /** Port names the driver reports, in RtMidi's own index order. */
    ports: [] as string[],
    /** Port indices whose open should throw, as a held port would. */
    refuse: new Set<number>(),
    /** Every `openPort` call any instance has made. */
    opens: [] as number[],
    instances: 0,
  }

  class FakeInput {
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
      if (state.refuse.has(index)) throw new Error('MidiInWinMM::openPort: cannot open port')
    }
    closePort(): void {}
    destroy(): void {}
    ignoreTypes(): void {}
    on(): void {}
  }

  return { state, FakeInput }
})

vi.mock('@julusian/midi', () => ({ Input: midi.FakeInput }))

import { RtMidiSource } from './RtMidiSource'

const unpackaged = { isPackaged: false, env: {} }

/** Only the hardware rows; the virtual group is virtualPorts.test.ts's job. */
async function hardware(source: RtMidiSource) {
  return (await source.listPorts()).filter((port) => port.kind === 'hardware')
}

beforeEach(() => {
  midi.state.ports = ['CK Series-1', 'CK Series-2']
  midi.state.refuse = new Set()
  midi.state.opens = []
  midi.state.instances = 0
})

describe('listing does not touch the device', () => {
  it('opens no handle, however many times it is polled', async () => {
    const source = new RtMidiSource(unpackaged)
    for (let poll = 0; poll < 5; poll++) await source.listPorts()
    expect(midi.state.opens).toEqual([])
  })

  it('reports every port the driver names, in the driver order', async () => {
    const rows = await hardware(new RtMidiSource(unpackaged))
    expect(rows.map((port) => port.id)).toEqual(['hw:0', 'hw:1'])
    expect(rows.map((port) => port.name)).toEqual(['CK Series-1', 'CK Series-2'])
  })

  it('calls the port a player can try available, having not tried it', async () => {
    const [first] = await hardware(new RtMidiSource(unpackaged))
    expect(first?.availability).toBe('available')
    expect(first?.detail).toBeUndefined()
  })

  it('builds one enumerator and keeps it across polls', async () => {
    const source = new RtMidiSource(unpackaged)
    await source.listPorts()
    await source.listPorts()
    await source.listPorts()
    expect(midi.state.instances).toBe(1)
  })

  it('sees a port that appears, and one that goes away', async () => {
    const source = new RtMidiSource(unpackaged)
    expect(await hardware(source)).toHaveLength(2)
    midi.state.ports = ['CK Series-1']
    expect(await hardware(source)).toHaveLength(1)
    midi.state.ports = ['CK Series-1', 'CK Series-2', 'Something else']
    expect(await hardware(source)).toHaveLength(3)
  })
})

describe('busy is a memory of a refused open', () => {
  it('is not set until an open has actually been refused', async () => {
    midi.state.refuse = new Set([0])
    const source = new RtMidiSource(unpackaged)
    const before = await hardware(source)
    expect(before[0]?.availability).toBe('available')

    await expect(source.open('hw:0')).rejects.toThrow(/would not open/)

    const after = await hardware(source)
    expect(after[0]?.availability).toBe('busy')
  })

  it('carries the driver reason onto the row', async () => {
    midi.state.refuse = new Set([0])
    const source = new RtMidiSource(unpackaged)
    await expect(source.open('hw:0')).rejects.toThrow()
    const [first] = await hardware(source)
    expect(first?.detail).toContain('The last open failed')
    expect(first?.detail).toContain('cannot open port')
  })

  it('marks only the port that refused', async () => {
    midi.state.refuse = new Set([0])
    const source = new RtMidiSource(unpackaged)
    await expect(source.open('hw:0')).rejects.toThrow()
    const rows = await hardware(source)
    expect(rows[0]?.availability).toBe('busy')
    expect(rows[1]?.availability).toBe('available')
  })

  it('forgets the refusal once the port opens', async () => {
    midi.state.refuse = new Set([0])
    const source = new RtMidiSource(unpackaged)
    await expect(source.open('hw:0')).rejects.toThrow()
    expect((await hardware(source))[0]?.availability).toBe('busy')

    // Whatever was holding it lets go, and the retry the row invites succeeds.
    midi.state.refuse = new Set()
    await source.open('hw:0')
    const [first] = await hardware(source)
    expect(first?.availability).toBe('available')
    expect(first?.detail).toBe('Open')
  })

  it('forgets the refusal when the port stops being enumerated', async () => {
    midi.state.refuse = new Set([1])
    const source = new RtMidiSource(unpackaged)
    await expect(source.open('hw:1')).rejects.toThrow()
    expect((await hardware(source))[1]?.availability).toBe('busy')

    // Unplugged, then something plugged back into the same index. A record
    // kept across that would be about a different instrument.
    midi.state.ports = ['CK Series-1']
    await source.listPorts()
    midi.state.ports = ['CK Series-1', 'A different keyboard']
    expect((await hardware(source))[1]?.availability).toBe('available')
  })

  it('says which port is the one currently open', async () => {
    const source = new RtMidiSource(unpackaged)
    await source.open('hw:1')
    const rows = await hardware(source)
    expect(rows[1]?.detail).toBe('Open')
    expect(rows[0]?.detail).toBeUndefined()
  })

  it('refuses a port id that is not a hardware port without touching anything', async () => {
    const source = new RtMidiSource(unpackaged)
    await expect(source.open('virtual:c-major-scale')).rejects.toThrow(/not a hardware port/)
    expect(midi.state.opens).toEqual([])
  })
})
