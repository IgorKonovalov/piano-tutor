import { describe, expect, it } from 'vitest'
import { MIN_TEMPO_SAMPLES, type TempoPair, deviationMs, fitTempo } from './tempo'

/** A piece played perfectly evenly at `qpm`, starting `originMs` in. */
function even(qpm: number, count: number, originMs = 0): TempoPair[] {
  const msPerQuarter = 60_000 / qpm
  return Array.from({ length: count }, (_, index) => ({
    onset: index,
    t: originMs + index * msPerQuarter,
  }))
}

describe('fitTempo', () => {
  it.each([60, 90, 120, 144])('recovers %s quarter notes per minute exactly', (qpm) => {
    const fit = fitTempo(even(qpm, 16))
    expect(fit?.qpm).toBeCloseTo(qpm, 6)
    expect(fit?.msPerQuarter).toBeCloseTo(60_000 / qpm, 6)
    expect(fit?.rmsMs).toBeCloseTo(0, 6)
    expect(fit?.samples).toBe(16)
  })

  it('does not care when the player started', () => {
    const late = fitTempo(even(90, 16, 4321))
    expect(late?.qpm).toBeCloseTo(90, 6)
    expect(late?.originMs).toBeCloseTo(4321, 3)
  })

  it('is unaffected by an uneven spacing of the score positions', () => {
    // Whole notes, then quarters: the line is the same line.
    const msPerQuarter = 500
    const pairs: TempoPair[] = [0, 4, 8, 9, 10, 11].map((onset) => ({
      onset,
      t: onset * msPerQuarter,
    }))
    expect(fitTempo(pairs)?.qpm).toBeCloseTo(120, 6)
  })

  it('reports how far the pairs sit from the line it found', () => {
    const pairs = even(120, 8)
    const third = pairs[3]
    if (third === undefined) throw new Error('unreachable')
    third.t += 100

    const fit = fitTempo(pairs)
    expect(fit?.rmsMs).toBeGreaterThan(0)
    // A single 100 ms outlier in eight pairs moves the line a little and
    // leaves most of the error in the residual.
    expect(fit?.rmsMs).toBeLessThan(100)
  })

  it('refuses to guess rather than returning a confident-looking number', () => {
    expect(fitTempo([])).toBeNull()
    expect(fitTempo(even(90, MIN_TEMPO_SAMPLES - 1))).toBeNull()
    // Every pair at the same score position: no slope to find.
    expect(fitTempo([0, 0, 0, 0].map((onset, i) => ({ onset, t: i * 100 })))).toBeNull()
    // Time running backwards is not a tempo.
    expect(fitTempo([0, 1, 2, 3].map((onset) => ({ onset, t: -onset * 100 })))).toBeNull()
  })

  it('takes the fewest samples it is willing to and no fewer', () => {
    expect(fitTempo(even(90, MIN_TEMPO_SAMPLES))).not.toBeNull()
  })
})

describe('deviationMs', () => {
  it('is zero on the line, negative early and positive late', () => {
    const fit = fitTempo(even(120, 8))
    if (fit === null) throw new Error('the fit should exist')

    expect(deviationMs(fit, { onset: 4, t: 4 * 500 })).toBeCloseTo(0, 6)
    expect(deviationMs(fit, { onset: 4, t: 4 * 500 - 80 })).toBeCloseTo(-80, 6)
    expect(deviationMs(fit, { onset: 4, t: 4 * 500 + 80 })).toBeCloseTo(80, 6)
  })

  it('is blind to the tempo itself: the same unevenness reads the same at any speed', () => {
    const slow = fitTempo(even(60, 8))
    const fast = fitTempo(even(240, 8))
    if (slow === null || fast === null) throw new Error('both fits should exist')

    // A note 50 ms early is 50 ms early whatever the piece's tempo. This is
    // what makes "you rushed" a claim about the player.
    expect(deviationMs(slow, { onset: 3, t: 3 * 1000 - 50 })).toBeCloseTo(-50, 6)
    expect(deviationMs(fast, { onset: 3, t: 3 * 250 - 50 })).toBeCloseTo(-50, 6)
  })
})
