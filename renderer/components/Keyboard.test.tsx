import { describe, expect, it } from 'vitest'
import { VELOCITY_FLOOR, noteLabel, velocityTint } from './Keyboard'

/**
 * The velocity curve is tuned against a real measurement, so the numbers it is
 * tuned to belong in a test rather than only in a comment. The distribution
 * came off the CK88 at Plan 0001 Phase 7, over 1 139 note-ons.
 */
const MEASURED = { min: 1, p10: 38, p50: 61, p90: 79, p99: 89, max: 94 }

/** What the same velocities used to produce, before the curve. */
const linear = (velocity: number) => velocity / 127

describe('velocityTint', () => {
  it('gives an unpressed key no tint at all', () => {
    expect(velocityTint(0)).toBe(0)
  })

  it('rises with velocity, everywhere', () => {
    for (let v = 1; v < 127; v++) {
      expect(velocityTint(v + 1)).toBeGreaterThan(velocityTint(v))
    }
  })

  it('stays inside the range a colour mix can use', () => {
    for (let v = 0; v <= 127; v++) {
      expect(velocityTint(v)).toBeGreaterThanOrEqual(0)
      expect(velocityTint(v)).toBeLessThanOrEqual(1)
    }
  })

  it('reaches full tint only at the top of the MIDI range', () => {
    expect(velocityTint(127)).toBeCloseTo(1, 5)
    expect(velocityTint(MEASURED.max)).toBeLessThan(1)
  })

  it('keeps the softest note visible', () => {
    expect(velocityTint(MEASURED.min)).toBeGreaterThan(VELOCITY_FLOOR)
    expect(velocityTint(1)).toBeGreaterThan(linear(1))
  })

  it('lifts an ordinary stroke by about twenty points', () => {
    // The complaint the curve answers: a normal stroke read as under half lit.
    const lift = velocityTint(MEASURED.p50) - linear(MEASURED.p50)
    expect(lift).toBeGreaterThan(0.15)
    expect(lift).toBeLessThan(0.3)
    expect(velocityTint(MEASURED.p50)).toBeGreaterThan(0.6)
  })

  it('puts the loudest real playing near the top without pinning it there', () => {
    expect(velocityTint(MEASURED.p99)).toBeGreaterThan(0.8)
    expect(velocityTint(MEASURED.max)).toBeGreaterThan(0.83)
    // Deliberate force still reads louder than the loudest ordinary note, so
    // the curve compresses the top rather than clipping it.
    expect(velocityTint(125)).toBeGreaterThan(velocityTint(MEASURED.max))
  })

  it('keeps every measured quantile distinguishable from its neighbour', () => {
    const quantiles = [MEASURED.min, MEASURED.p10, MEASURED.p50, MEASURED.p90, MEASURED.p99]
    for (let i = 1; i < quantiles.length; i++) {
      const step = velocityTint(quantiles[i]!) - velocityTint(quantiles[i - 1]!)
      expect(step).toBeGreaterThan(0.02)
    }
  })

  it('clamps a value outside the MIDI range instead of overshooting', () => {
    expect(velocityTint(200)).toBeCloseTo(velocityTint(127), 5)
    expect(velocityTint(-5)).toBe(0)
  })
})

describe('noteLabel', () => {
  it('names the ends of an 88-key piano and middle C', () => {
    expect(noteLabel(21)).toBe('A0')
    expect(noteLabel(60)).toBe('C4')
    expect(noteLabel(108)).toBe('C8')
  })
})
