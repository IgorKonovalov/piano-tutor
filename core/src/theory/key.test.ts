import { describe, expect, it } from 'vitest'
import {
  HALF_LIFE_MS,
  KEY_CONFIDENCE_THRESHOLD,
  estimateKey,
  estimateKeyFromHistogram,
  pitchClassHistogram,
} from './key'
import type { MidiEvent } from '../../../shared/midi'
import { findScenarioById } from '../midi/generate'

const on = (note: number, t: number): MidiEvent => ({
  kind: 'noteOn',
  t,
  ch: 0,
  note,
  velocity: 80,
})

/** A scale played once through, one note every 200 ms. */
function scale(degrees: number[], from = 0): MidiEvent[] {
  return degrees.map((note, index) => on(note, from + index * 200))
}

describe('the histogram', () => {
  it('is empty for a stream with no note-ons', () => {
    expect(pitchClassHistogram([])).toEqual(new Array(12).fill(0))
    expect(pitchClassHistogram([{ kind: 'cc', t: 0, ch: 0, controller: 64, value: 127 }])).toEqual(
      new Array(12).fill(0)
    )
  })

  it('counts by pitch class, ignoring octave', () => {
    const histogram = pitchClassHistogram([on(60, 0), on(72, 0), on(84, 0)], 0)
    expect(histogram[0]).toBeCloseTo(3)
    expect(histogram.filter((_, i) => i !== 0)).toEqual(new Array(11).fill(0))
  })

  it('halves a note’s weight after one half-life', () => {
    const histogram = pitchClassHistogram([on(60, 0)], HALF_LIFE_MS)
    expect(histogram[0]).toBeCloseTo(0.5)
  })

  it('reads the clock from the events, never from the machine', () => {
    const events = [on(60, 1000), on(64, 2000)]
    expect(pitchClassHistogram(events)).toEqual(pitchClassHistogram(events))
    // Explicitly passing the last event's time is the same as the default.
    expect(pitchClassHistogram(events)).toEqual(pitchClassHistogram(events, 2000))
  })

  it('lets a recent phrase outweigh an older one', () => {
    // Four bars of C material, then four bars of F# material much later.
    const old = scale([60, 62, 64, 65, 67, 69, 71], 0)
    const recent = scale([66, 68, 70, 71, 73, 75, 77], 60_000)
    const key = estimateKey([...old, ...recent])
    expect(key?.tonic).not.toBe('C')
  })
})

describe('estimating a key', () => {
  it('reports nothing when nothing has been played', () => {
    expect(estimateKey([])).toBeNull()
    expect(estimateKeyFromHistogram(new Array(12).fill(0))).toBeNull()
  })

  it('hears a C major scale as C major', () => {
    const key = estimateKey(scale([60, 62, 64, 65, 67, 69, 71, 72]))
    expect(key?.name).toBe('C major')
    expect(key?.confident).toBe(true)
  })

  it('hears an A natural minor passage as A minor, not C major', () => {
    // The same seven pitch classes; only the weighting tells them apart, so
    // this is the case that says the profiles are doing real work.
    const key = estimateKey([
      ...scale([57, 60, 64, 57, 60, 64]),
      ...scale([57, 59, 60, 62, 64, 65, 67, 69], 1400),
      ...scale([57, 64, 57, 64], 3200),
    ])
    expect(key?.name).toBe('A minor')
  })

  it('hears a flat key as a flat key', () => {
    const key = estimateKey(scale([53, 55, 57, 58, 60, 62, 64, 65]))
    expect(key?.name).toBe('F major')
  })

  it('is not confident about two notes', () => {
    const key = estimateKey([on(60, 0), on(61, 100)])
    expect(key?.confidence).toBeLessThan(KEY_CONFIDENCE_THRESHOLD)
    expect(key?.confident).toBe(false)
  })

  it('reports a confidence inside [0, 1]', () => {
    const key = estimateKey(scale([60, 62, 64, 65, 67, 69, 71, 72]))
    expect(key!.confidence).toBeGreaterThanOrEqual(0)
    expect(key!.confidence).toBeLessThanOrEqual(1)
  })
})

describe('over the generated scenarios, with no app and no instrument', () => {
  const expectations = [
    ['virtual:c-major-scale', 'C major'],
    ['virtual:a-minor-arpeggios', 'A minor'],
    ['virtual:ii-V-I-in-F', 'F major'],
  ] as const

  it.each(expectations)('%s is heard as %s, above the display threshold', (id, expected) => {
    const key = estimateKey(findScenarioById(id)!.generate())
    expect(key?.name).toBe(expected)
    expect(key!.confidence).toBeGreaterThan(KEY_CONFIDENCE_THRESHOLD)
  })

  it('estimates the same key twice from the same seed', () => {
    const scenario = findScenarioById('virtual:ii-V-I-in-F')!
    expect(estimateKey(scenario.generate())).toEqual(estimateKey(scenario.generate()))
  })
})
