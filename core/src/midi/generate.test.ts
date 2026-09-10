import { describe, expect, it } from 'vitest'
import { SCENARIOS, findScenarioById } from './generate'
import { makeRng } from './rng'
import { CC_SUSTAIN, type MidiEvent } from '../../../shared/midi'

const scenarioIds = SCENARIOS.map((s) => s.id)

describe('the seeded source', () => {
  it('produces the same sequence for the same seed', () => {
    const a = Array.from({ length: 20 }, () => makeRng(1234).next())
    const b = Array.from({ length: 20 }, () => makeRng(1234).next())
    expect(a).toEqual(b)
  })

  it('produces a different sequence for a different seed', () => {
    expect(makeRng(1).next()).not.toEqual(makeRng(2).next())
  })

  it('stays inside the bounds int() is given', () => {
    const rng = makeRng(99)
    for (let i = 0; i < 500; i++) {
      const value = rng.int(36, 96)
      expect(value).toBeGreaterThanOrEqual(36)
      expect(value).toBeLessThanOrEqual(96)
      expect(Number.isInteger(value)).toBe(true)
    }
  })
})

describe('every scenario', () => {
  it('covers the vocabulary the plans cite', () => {
    expect(scenarioIds).toEqual([
      'virtual:c-major-scale',
      'virtual:ii-V-I-in-F',
      'virtual:a-minor-arpeggios',
      'virtual:dense-2000',
    ])
  })

  it.each(scenarioIds)('%s generates identically twice from the same seed', (id) => {
    const scenario = findScenarioById(id)
    expect(scenario).toBeDefined()
    const first = scenario!.generate()
    const second = scenario!.generate()
    expect(JSON.stringify(first)).toEqual(JSON.stringify(second))
  })

  it.each(scenarioIds)('%s emits events in time order', (id) => {
    const events = findScenarioById(id)!.generate()
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.t).toBeGreaterThanOrEqual(events[i - 1]!.t)
    }
  })

  it.each(scenarioIds)('%s releases every note it presses', (id) => {
    const events = findScenarioById(id)!.generate()
    const outstanding = new Map<number, number>()
    for (const event of events) {
      if (event.kind === 'noteOn') outstanding.set(event.note, (outstanding.get(event.note) ?? 0) + 1)
      if (event.kind === 'noteOff') outstanding.set(event.note, (outstanding.get(event.note) ?? 0) - 1)
    }
    expect([...outstanding.values()].filter((n) => n !== 0)).toEqual([])
  })

  it.each(scenarioIds)('%s keeps every value inside the MIDI range', (id) => {
    for (const event of findScenarioById(id)!.generate()) {
      if (event.kind === 'noteOn' || event.kind === 'noteOff') {
        expect(event.note).toBeGreaterThanOrEqual(0)
        expect(event.note).toBeLessThanOrEqual(127)
        expect(event.velocity).toBeGreaterThanOrEqual(0)
        expect(event.velocity).toBeLessThanOrEqual(127)
      }
      expect(event.t).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('virtual:c-major-scale', () => {
  const events = findScenarioById('virtual:c-major-scale')!.generate()

  it('walks two octaves up from middle C and back', () => {
    const onsets = events.filter((e) => e.kind === 'noteOn').map((e) => e.note)
    expect(onsets[0]).toBe(60)
    expect(Math.max(...onsets)).toBe(84)
    expect(onsets[onsets.length - 1]).toBe(60)
  })

  it('uses only the white keys of C major', () => {
    const blackKeys = [1, 3, 6, 8, 10]
    for (const event of events) {
      if (event.kind === 'noteOn') expect(blackKeys).not.toContain(event.note % 12)
    }
  })

  it('is legato: the next note starts before the last one is released', () => {
    const onsets = events.filter((e): e is Extract<MidiEvent, { kind: 'noteOn' }> => e.kind === 'noteOn')
    const first = onsets[0]!
    const release = events.find((e) => e.kind === 'noteOff' && e.note === first.note)!
    expect(onsets[1]!.t).toBeLessThan(release.t)
  })
})

describe('virtual:ii-V-I-in-F', () => {
  const events = findScenarioById('virtual:ii-V-I-in-F')!.generate()

  it('holds each chord on the pedal after the keys are released', () => {
    const down = events.find((e) => e.kind === 'cc' && e.controller === CC_SUSTAIN && e.value > 0)!
    const up = events.find(
      (e) => e.kind === 'cc' && e.controller === CC_SUSTAIN && e.value === 0
    )!
    const firstRelease = events.find((e) => e.kind === 'noteOff')!
    expect(down.t).toBeLessThan(firstRelease.t)
    expect(firstRelease.t).toBeLessThan(up.t)
  })

  it('plays three chords', () => {
    const pedalDowns = events.filter(
      (e) => e.kind === 'cc' && e.controller === CC_SUSTAIN && e.value > 0
    )
    expect(pedalDowns).toHaveLength(3)
  })
})

describe('virtual:dense-2000', () => {
  const events = findScenarioById('virtual:dense-2000')!.generate()

  it('carries more than two thousand events', () => {
    expect(events.length).toBeGreaterThanOrEqual(2000)
  })

  it('sustains at least 100 events a second, and bursts to 200', () => {
    const perSecond = new Map<number, number>()
    for (const event of events) {
      const second = Math.floor(event.t / 1000)
      perSecond.set(second, (perSecond.get(second) ?? 0) + 1)
    }
    // The last bucket is a partial second; every full one carries the rate.
    const full = [...perSecond.entries()].slice(0, -1).map(([, count]) => count)
    expect(Math.min(...full)).toBeGreaterThanOrEqual(100)
    expect(Math.max(...full)).toBeGreaterThanOrEqual(200)
  })

  it('bursts for two seconds at a time, twice', () => {
    const perSecond = new Map<number, number>()
    for (const event of events) {
      const second = Math.floor(event.t / 1000)
      perSecond.set(second, (perSecond.get(second) ?? 0) + 1)
    }
    const burstSeconds = [...perSecond.values()].filter((count) => count >= 200)
    expect(burstSeconds).toHaveLength(4)
  })
})
