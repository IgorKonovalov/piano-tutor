import { describe, expect, it } from 'vitest'
import { type Clock, SyntheticSource } from './SyntheticSource'
import { MidiParser } from './parse'
import { findScenarioById } from '../../core/src/midi/generate'
import type { MidiEvent } from '../../shared/midi'

const gate = { isPackaged: false, env: {} }

/**
 * A clock the test drives. Timers are run in due order and time jumps to each
 * one, so an eighteen-second scenario finishes in milliseconds without the
 * scenario being made shorter than NFR 2 asks for.
 */
function fakeClock() {
  let current = 0
  let pending: { at: number; fn: () => void } | null = null
  const clock: Clock = {
    now: () => current,
    setTimeout: (fn, ms) => {
      pending = { at: current + ms, fn }
      return pending
    },
    clearTimeout: () => {
      pending = null
    },
  }
  const runToCompletion = (maxSteps = 100_000) => {
    let steps = 0
    while (pending !== null && steps++ < maxSteps) {
      const due = pending
      pending = null
      current = Math.max(current, due.at)
      due.fn()
    }
    if (steps >= maxSteps) throw new Error('the scenario did not finish')
  }
  return { clock, runToCompletion }
}

/** Drive a scenario to its end and return everything the parser made of it. */
async function replay(portId: string): Promise<{ events: MidiEvent[]; messages: number }> {
  const { clock, runToCompletion } = fakeClock()
  const source = new SyntheticSource(gate, clock)
  const parser = new MidiParser()
  const events: MidiEvent[] = []
  let messages = 0

  const stop = source.onMessage((bytes, t) => {
    messages++
    events.push(...parser.parse(bytes, t))
  })
  await source.open(portId)
  runToCompletion()
  stop()
  return { events, messages }
}

describe('opening a scenario', () => {
  it('refuses a port id that names no scenario', async () => {
    const source = new SyntheticSource(gate)
    await expect(source.open('virtual:nothing-like-this')).rejects.toThrow(/No generated scenario/)
  })

  it('lists exactly the virtual ports the gate allows', async () => {
    // Four hand-written passages and six written pieces (plan 0002 phase 3).
    expect(await new SyntheticSource(gate).listPorts()).toHaveLength(10)
    expect(await new SyntheticSource({ isPackaged: true, env: {} }).listPorts()).toEqual([])
  })
})

describe('NFR 2: no event is lost between the generator and the seam', () => {
  const scenarioIds = [
    'virtual:c-major-scale',
    'virtual:ii-V-I-in-F',
    'virtual:a-minor-arpeggios',
    'virtual:dense-2000',
  ]

  it.each(scenarioIds)('%s arrives complete and in order', async (id) => {
    const generated = findScenarioById(id)!.generate()
    const { events, messages } = await replay(id)

    expect(messages).toBe(generated.length)
    expect(events).toHaveLength(generated.length)
    // The bytes went through the real parser, so this compares what the
    // renderer would receive against what the generator meant.
    expect(events.map((e) => ({ ...e, t: 0 }))).toEqual(generated.map((e) => ({ ...e, t: 0 })))
  })

  it('delivers every one of the dense passage’s 2000+ events', async () => {
    const generated = findScenarioById('virtual:dense-2000')!.generate()
    expect(generated.length).toBeGreaterThanOrEqual(2000)
    const { events } = await replay('virtual:dense-2000')
    expect(events).toHaveLength(generated.length)
    expect(events.filter((e) => e.kind === 'unknown')).toEqual([])
  })

  it('holds a 200 events/s burst without dropping any of it', async () => {
    const generated = findScenarioById('virtual:dense-2000')!.generate()
    const { events } = await replay('virtual:dense-2000')
    // The generator's bursts are the seconds carrying 200 events; every one of
    // them has to arrive, which is what NFR 2's burst clause means.
    const perSecond = new Map<number, number>()
    const origin = events[0]!.t
    for (const event of events) {
      const second = Math.floor((event.t - origin) / 1000)
      perSecond.set(second, (perSecond.get(second) ?? 0) + 1)
    }
    expect([...perSecond.values()].filter((n) => n >= 200)).toHaveLength(4)
    expect(events).toHaveLength(generated.length)
  })
})

describe('the stamp', () => {
  it('is taken at delivery, and never runs backwards', async () => {
    const { clock, runToCompletion } = fakeClock()
    const source = new SyntheticSource(gate, clock)
    const stamps: number[] = []
    source.onMessage((_bytes, t) => stamps.push(t))
    await source.open('virtual:c-major-scale')
    runToCompletion()

    expect(stamps.length).toBeGreaterThan(0)
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]!).toBeGreaterThanOrEqual(stamps[i - 1]!)
    }
  })

  it('tracks the scenario’s own timeline', async () => {
    const generated = findScenarioById('virtual:c-major-scale')!.generate()
    const { clock, runToCompletion } = fakeClock()
    const source = new SyntheticSource(gate, clock)
    const stamps: number[] = []
    source.onMessage((_bytes, t) => stamps.push(t))
    await source.open('virtual:c-major-scale')
    runToCompletion()

    const span = stamps[stamps.length - 1]! - stamps[0]!
    const expected = generated[generated.length - 1]!.t - generated[0]!.t
    expect(span).toBe(expected)
  })
})

describe('closing', () => {
  it('stops delivering the rest of the scenario', async () => {
    const { clock, runToCompletion } = fakeClock()
    const source = new SyntheticSource(gate, clock)
    let count = 0
    source.onMessage(() => count++)

    await source.open('virtual:dense-2000')
    // Opening delivers whatever is already due at t=0; closing must stop
    // everything after that, not merely cancel the next wake.
    const deliveredBeforeClose = count
    await source.close()
    runToCompletion()

    expect(count).toBe(deliveredBeforeClose)
    expect(count).toBeLessThan(10)
    expect(source.finished).toBe(true)
  })

  it('removes a listener when its cleanup is called', async () => {
    const { clock, runToCompletion } = fakeClock()
    const source = new SyntheticSource(gate, clock)
    let count = 0
    const stop = source.onMessage(() => count++)
    stop()
    await source.open('virtual:c-major-scale')
    runToCompletion()
    expect(count).toBe(0)
  })
})
