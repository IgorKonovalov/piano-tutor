import { describe, expect, it } from 'vitest'
import type { TempoMark } from '../../../shared/score'
import { FERMATA_HOLD, RAMP_CHANGE, tempoMap, writtenTempoAt } from './tempoMap'

const metronome = (at: number, bpm: number): TempoMark => ({
  at,
  kind: 'metronome',
  bpm,
  label: `quarter = ${bpm}`,
})
const rit = (at: number, until: number): TempoMark => ({
  at,
  kind: 'ramp',
  direction: 'slower',
  until,
  label: 'rit.',
})
const accel = (at: number, until: number): TempoMark => ({
  at,
  kind: 'ramp',
  direction: 'faster',
  until,
  label: 'accel.',
})
const aTempo = (at: number): TempoMark => ({ at, kind: 'return', to: 'previous', label: 'a tempo' })
const tempoPrimo = (at: number): TempoMark => ({
  at,
  kind: 'return',
  to: 'first',
  label: 'Tempo primo',
})

/** The length of one quarter starting at `at`, in milliseconds. */
function quarterAt(map: { ms(at: number): number }, at: number): number {
  return map.ms(at + 1) - map.ms(at)
}

/** The same integral by brute force: many small steps at the midpoint tempo. */
function sampled(t0: number, t1: number, span: number, steps = 100_000): number {
  let ms = 0
  for (let k = 0; k < steps; k++) {
    const tempo = t0 + ((t1 - t0) * (k + 0.5)) / steps
    ms += (span / steps) * (60000 / tempo)
  }
  return ms
}

describe('with no marks', () => {
  it('is the fallback tempo, a multiplication', () => {
    const map = tempoMap({ tempo: [], from: 3, fallbackBpm: 80 })
    expect(map.ms(3)).toBe(0)
    expect(map.ms(7)).toBe(4 * (60000 / 80))
    expect(map.bpmAtStart).toBe(80)
  })

  it('is exactly the override when there is one', () => {
    const map = tempoMap({ tempo: [], from: 0, fallbackBpm: 80, overrideBpm: 120 })
    expect(map.ms(5)).toBe(2500)
    expect(map.bpmAtStart).toBe(120)
  })
})

describe('a metronome mark or a word', () => {
  it('sets the tempo from where it is written, the fallback holding before it', () => {
    const map = tempoMap({ tempo: [metronome(4, 120)], from: 0, fallbackBpm: 60 })
    expect(quarterAt(map, 0)).toBe(1000)
    expect(quarterAt(map, 4)).toBe(500)
    expect(map.ms(6)).toBe(4000 + 1000)
  })
})

describe('a ramp', () => {
  const tempo = [metronome(0, 120), rit(4, 8)]

  it('runs from the tempo in force to that tempo times one minus RAMP_CHANGE', () => {
    expect(writtenTempoAt(tempo, 4, 80)).toBe(120)
    expect(writtenTempoAt(tempo, 6, 80)).toBeCloseTo(120 * (1 - RAMP_CHANGE / 2), 9)
    expect(writtenTempoAt(tempo, 8, 80)).toBeCloseTo(120 * (1 - RAMP_CHANGE), 9)
    // And holds there until the next mark.
    expect(writtenTempoAt(tempo, 20, 80)).toBeCloseTo(120 * (1 - RAMP_CHANGE), 9)
    expect(writtenTempoAt([metronome(0, 100), accel(0, 4)], 4, 80)).toBeCloseTo(
      100 * (1 + RAMP_CHANGE),
      9
    )
  })

  it('is integrated exactly, not once per note', () => {
    const map = tempoMap({ tempo, from: 0, fallbackBpm: 80 })
    const span = map.ms(8) - map.ms(4)
    expect(span).toBeCloseTo(sampled(120, 120 * (1 - RAMP_CHANGE), 4), 3)
    // A quarter split in two costs what the whole quarter costs.
    expect(map.ms(5.5) - map.ms(5) + (map.ms(6) - map.ms(5.5))).toBeCloseTo(quarterAt(map, 5), 9)
  })

  it('slows beat by beat through a rit. and quickens through an accel.', () => {
    const slower = tempoMap({ tempo, from: 0, fallbackBpm: 80 })
    const beats = [4, 5, 6, 7].map((at) => quarterAt(slower, at))
    for (let k = 1; k < beats.length; k++) expect(beats[k]).toBeGreaterThan(beats[k - 1] ?? 0)

    const faster = tempoMap({ tempo: [metronome(0, 120), accel(4, 8)], from: 0, fallbackBpm: 80 })
    const quick = [4, 5, 6, 7].map((at) => quarterAt(faster, at))
    for (let k = 1; k < quick.length; k++) expect(quick[k]).toBeLessThan(quick[k - 1] ?? 0)
  })

  it('is cut where a mark interrupts it, and the next piece starts from the tempo reached', () => {
    const cut = [metronome(0, 120), rit(4, 12), aTempo(8)]
    expect(writtenTempoAt(cut, 8, 80)).toBe(120)
    expect(writtenTempoAt([metronome(0, 120), rit(4, 12), rit(8, 12)], 8, 80)).toBeCloseTo(
      120 * (1 - RAMP_CHANGE / 2),
      9
    )
  })
})

describe('a return', () => {
  it('a tempo restores the tempo in force when the last ramp began', () => {
    const tempo = [metronome(0, 120), rit(4, 8), aTempo(8)]
    expect(writtenTempoAt(tempo, 8, 80)).toBe(120)
    expect(writtenTempoAt([metronome(0, 90), aTempo(4)], 4, 80)).toBe(90)
  })

  it('tempo primo restores the first metronome mark or word', () => {
    const tempo = [metronome(0, 120), metronome(4, 72), rit(8, 12), tempoPrimo(12)]
    expect(writtenTempoAt(tempo, 12, 80)).toBe(120)
    expect(writtenTempoAt([tempoPrimo(4)], 4, 80)).toBe(80)
  })
})

describe('a range starts at the tempo in force there', () => {
  it('applies the marks before the range, including a ramp it starts inside', () => {
    const tempo = [metronome(0, 120), rit(4, 8), aTempo(8)]
    expect(tempoMap({ tempo, from: 8, fallbackBpm: 80 }).bpmAtStart).toBe(120)
    expect(quarterAt(tempoMap({ tempo, from: 8, fallbackBpm: 80 }), 8)).toBe(500)

    const inside = tempoMap({ tempo, from: 6, fallbackBpm: 80 })
    expect(inside.bpmAtStart).toBeCloseTo(120 * (1 - RAMP_CHANGE / 2), 9)
    const whole = tempoMap({ tempo, from: 0, fallbackBpm: 80 })
    expect(quarterAt(inside, 6)).toBeCloseTo(quarterAt(whole, 6), 9)
  })
})

describe('the override keeps the shape', () => {
  it('scales every length by written over chosen, a ramp included', () => {
    const tempo = [metronome(0, 120), rit(4, 8), aTempo(8), accel(12, 16)]
    const written = tempoMap({ tempo, from: 0, fallbackBpm: 80 })
    const halved = tempoMap({ tempo, from: 0, fallbackBpm: 80, overrideBpm: 60 })
    expect(halved.bpmAtStart).toBe(60)
    for (let at = 0; at < 20; at += 0.5) {
      expect(halved.ms(at)).toBeCloseTo(written.ms(at) * 2, 6)
    }
  })

  it('scales from the written tempo at the range start, not from the first mark', () => {
    const tempo = [metronome(0, 120), metronome(4, 60)]
    const map = tempoMap({ tempo, from: 4, fallbackBpm: 80, overrideBpm: 90 })
    expect(quarterAt(map, 4)).toBe(60000 / 90)
  })
})

describe('a fermata', () => {
  const tempo = [metronome(0, 120)]

  it('holds at its note end by FERMATA_HOLD - 1 times the note, moving everything at or after', () => {
    const plain = tempoMap({ tempo, from: 0, fallbackBpm: 80 })
    const held = tempoMap({ tempo, from: 0, fallbackBpm: 80, fermatas: [{ onset: 2, duration: 1 }] })
    const hold = (FERMATA_HOLD - 1) * 500
    for (const at of [0, 1, 2, 2.5, 2.999]) expect(held.ms(at)).toBe(plain.ms(at))
    for (const at of [3, 4, 7]) expect(held.ms(at)).toBe(plain.ms(at) + hold)
  })

  it('is held once, from the longest, where several end together', () => {
    const plain = tempoMap({ tempo, from: 0, fallbackBpm: 80 })
    const held = tempoMap({
      tempo,
      from: 0,
      fallbackBpm: 80,
      fermatas: [
        { onset: 2, duration: 2 },
        { onset: 3, duration: 1 },
      ],
    })
    expect(held.ms(4) - plain.ms(4)).toBe((FERMATA_HOLD - 1) * 1000)
  })

  it('is measured at the tempo where it is written', () => {
    const slow = tempoMap({
      tempo: [metronome(0, 60)],
      from: 0,
      fallbackBpm: 80,
      fermatas: [{ onset: 0, duration: 1 }],
    })
    expect(slow.ms(1)).toBe(1000 * FERMATA_HOLD)
  })
})
