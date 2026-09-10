import { describe, expect, it } from 'vitest'
import {
  MAX_TEMPO_OBSERVATIONS,
  MIN_LOCAL_GAPS,
  MIN_TEMPO_SAMPLES,
  type BarredPair,
  type TempoPair,
  deviationMs,
  fitTempo,
  barPaces,
  localTempo,
  localTempoCurve,
  steadyTempo,
  tempoObservations,
} from './tempo'

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

/**
 * A take as a list of matched pairs: notes one quarter apart, `perBar` of them
 * in each bar, where the gap **after** note `i` takes `pace(i)` milliseconds.
 * Nothing here is generated or aligned -- these are the pairs a matcher would
 * hand over, so what is under test is the reference and not the matcher.
 */
function played(notes: number, pace: (gap: number) => number, perBar = 4): BarredPair[] {
  const pairs: BarredPair[] = []
  let t = 0
  for (let i = 0; i < notes; i++) {
    pairs.push({ bar: Math.floor(i / perBar), onset: i, t })
    t += pace(i)
  }
  return pairs
}

/** The mean of a bar's own inter-onset gaps: the pace it was actually played at. */
function ownPace(pairs: readonly BarredPair[], bar: number): number {
  const own = pairs.filter((pair) => pair.bar === bar)
  const first = own[0]
  const last = own[own.length - 1]
  if (first === undefined || last === undefined) throw new Error(`no bar ${bar}`)
  return (last.t - first.t) / (last.onset - first.onset)
}

describe('localTempo', () => {
  const steady = played(20, () => 500)

  it('is the pace the bars either side were keeping', () => {
    const local = localTempo(steady, 2)
    expect(local?.msPerQuarter).toBeCloseTo(500, 6)
    expect(local?.qpm).toBeCloseTo(120, 6)
    expect(local?.bar).toBe(2)
  })

  it('does not take the bar under test into account, so a rushed bar can deviate', () => {
    // Bar 2 is played at half the pace of everything around it. A reference
    // fitted from data including the bar would move to meet it and the bar
    // would deviate by nothing; this is the crux of ADR-0014.
    const rushed = played(20, (gap) => (gap >= 8 && gap < 11 ? 250 : 500))
    expect(ownPace(rushed, 2)).toBeCloseTo(250, 6)
    expect(localTempo(rushed, 2)?.msPerQuarter).toBeCloseTo(500, 6)

    const own = rushed.filter((pair) => pair.bar === 2)
    const local = localTempo(rushed, 2)
    if (local === null) throw new Error('bar 2 has neighbours either side')
    // Against its neighbours' pace, the bar's last note is a long way early.
    expect(deviationMs(local, own[own.length - 1] as BarredPair)).toBeLessThan(-500)
  })

  it('follows a player who is slowing down instead of averaging over the change', () => {
    // A rallentando: every gap a little longer than the one before it. The
    // reference for a bar in the middle of it is that bar's own pace, so the
    // bar sits on its own neighbourhood's line and is not an error.
    const slowing = played(20, (gap) => 400 + gap * 10)
    for (const bar of [1, 2, 3]) {
      expect(localTempo(slowing, bar)?.msPerQuarter).toBeCloseTo(ownPace(slowing, bar), 6)
    }
  })

  it('is not dragged by the one enormous gap a restart or a hesitation leaves', () => {
    // Ten times the pace, once, in the middle of the window: the player went
    // back and started again, or simply stopped to think.
    const jumped = played(20, (gap) => (gap === 11 ? 5_000 : 500))
    expect(localTempo(jumped, 2)?.msPerQuarter).toBeCloseTo(500, 6)
    expect(localTempo(jumped, 1)?.msPerQuarter).toBeCloseTo(500, 6)
  })

  it('draws its line through the bar\u2019s own first note, not through the neighbours', () => {
    // Where the bar began is not the bar's fault: a player who paused, or went
    // back, arrives late through no fault of the bar they are about to play.
    const late = played(20, (gap) => (gap === 7 ? 9_000 : 500))
    const local = localTempo(late, 2)
    if (local === null) throw new Error('bar 2 has neighbours either side')
    const first = late.find((pair) => pair.bar === 2)
    expect(deviationMs(local, first as BarredPair)).toBeCloseTo(0, 6)
    expect(local.msPerQuarter).toBeCloseTo(500, 6)
  })

  it('refuses rather than guessing when one side has nothing to say', () => {
    // The first and last bars of a take have neighbours on one side only, and
    // extrapolating a trend past the end of the evidence is guessing.
    expect(localTempo(steady, 0)).toBeNull()
    expect(localTempo(steady, 4)).toBeNull()
    // A bar that is not in the take at all.
    expect(localTempo(steady, 9)).toBeNull()
    // One group per bar: a side of the window that is one gap wide.
    const chordal = played(6, () => 500, 1)
    expect(MIN_LOCAL_GAPS).toBeGreaterThan(1)
    expect(localTempo(chordal, 2)).toBeNull()
  })

  it('says how much evidence it used, and takes the same amount from each side', () => {
    const local = localTempo(steady, 2)
    expect(local?.samples).toBe(8)
    expect((local?.samples ?? 0) % 2).toBe(0)
  })

  it('is blind to the tempo itself: the same shape reads the same at any speed', () => {
    const slow = played(20, () => 1_000)
    const fast = played(20, () => 250)
    expect(localTempo(slow, 2)?.msPerQuarter).toBeCloseTo(1_000, 6)
    expect(localTempo(fast, 2)?.msPerQuarter).toBeCloseTo(250, 6)
  })
})

describe('localTempoCurve', () => {
  it('carries one entry per bar that had the evidence, and none for the others', () => {
    const curve = localTempoCurve(played(20, () => 500), [0, 1, 2, 3, 4])
    expect([...curve.keys()]).toEqual([1, 2, 3])
    expect(curve.get(2)?.qpm).toBeCloseTo(120, 6)
  })
})

describe('steadyTempo', () => {
  it('is the tempo of an even take, exactly', () => {
    expect(steadyTempo(played(20, () => 500))).toBeCloseTo(120, 6)
    expect(steadyTempo(played(20, () => 1_000))).toBeCloseTo(60, 6)
  })

  it('is not dragged by the seam a restart leaves behind', () => {
    // The measurement behind ADR-0014: a take played at about 64 read as 53,
    // because one line was fitted through a performance and a false start.
    const even = played(20, () => 500)
    const jumped = played(20, (gap) => (gap === 11 ? 5_000 : 500))
    const found = steadyTempo(jumped)
    if (found === null) throw new Error('there is a tempo in there')
    expect(found / (steadyTempo(even) as number)).toBeCloseTo(1, 2)
  })

  it('is not dragged by a passage taken at half speed while it was worked out', () => {
    const patchy = played(24, (gap) => (gap >= 12 && gap < 16 ? 1_200 : 500))
    expect(steadyTempo(patchy)).toBeCloseTo(120, 1)
  })

  it('refuses rather than guessing when there is nothing to measure', () => {
    expect(steadyTempo([])).toBeNull()
    expect(steadyTempo(played(1, () => 500))).toBeNull()
    // Every pair at the same score position: no pace to find.
    expect(steadyTempo([0, 0, 0].map((onset, i) => ({ bar: 0, onset, t: i * 100 })))).toBeNull()
  })
})

describe('barPaces', () => {
  it('gives each bar the pace it was played at, and skips a bar it cannot', () => {
    const uneven = played(12, (gap) => (gap >= 4 && gap < 7 ? 250 : 500))
    expect(barPaces(uneven).get(1)?.msPerQuarter).toBeCloseTo(250, 6)
    expect(barPaces(uneven).get(0)?.msPerQuarter).toBeCloseTo(500, 6)
    // One group in a bar says nothing about pace.
    expect(barPaces(played(3, () => 500, 1)).size).toBe(0)
  })

  it('says how far the bar reaches past its own first note', () => {
    // Four notes a quarter apart: their mean distance from the first is two.
    expect(barPaces(played(12, () => 500)).get(1)?.spread).toBeCloseTo(2, 6)
  })
})

describe('tempoObservations', () => {
  it('says nothing at all about an even take', () => {
    expect(tempoObservations(barPaces(played(24, () => 500)))).toEqual([])
  })

  it('names the span a player slowed over, and by how much', () => {
    // Bar 0 at 500, then 550, 600, 650: the tempo it changed *from* is bar 0,
    // so the change is over bars 1 to 3.
    const slowing = played(16, (gap) => 500 + Math.floor(gap / 4) * 50)
    expect(tempoObservations(barPaces(slowing))).toEqual([
      { fromBar: 1, toBar: 3, percent: Math.round((500 / 650 - 1) * 100) },
    ])
  })

  it('reads a positive percentage when the player pressed on', () => {
    const pressing = played(16, (gap) => 650 - Math.floor(gap / 4) * 50)
    const found = tempoObservations(barPaces(pressing))
    expect(found).toHaveLength(1)
    expect(found[0]?.percent).toBeGreaterThan(0)
    expect(found[0]).toMatchObject({ fromBar: 1, toBar: 3 })
  })

  it('ignores a change too small or too short to be worth a sentence', () => {
    // One per cent a bar, over four bars: a hand, not a decision.
    expect(tempoObservations(barPaces(played(16, (gap) => 500 * 1.01 ** Math.floor(gap / 4))))).toEqual(
      []
    )
    // A single step, however large: that is one bar out of time, which is a
    // bar verdict and not a description of the tempo.
    expect(tempoObservations(barPaces(played(16, (gap) => (gap < 4 ? 500 : 800))))).toEqual([])
  })

  it('keeps only the largest few, so a wandering take is not a wall of sentences', () => {
    // Down, up, down, up across sixteen bars: more runs than are worth saying.
    const wandering = played(64, (gap) => {
      const bar = Math.floor(gap / 4)
      const leg = Math.floor(bar / 4)
      const step = bar % 4
      return leg % 2 === 0 ? 500 + step * 80 : 820 - step * 80
    })
    const found = tempoObservations(barPaces(wandering))
    expect(found.length).toBeLessThanOrEqual(MAX_TEMPO_OBSERVATIONS)
    expect(found.length).toBeGreaterThan(0)
    // Largest first.
    found.forEach((observation, index) => {
      if (index === 0) return
      expect(Math.abs(observation.percent)).toBeLessThanOrEqual(
        Math.abs(found[index - 1]?.percent ?? 0)
      )
    })
  })
})
