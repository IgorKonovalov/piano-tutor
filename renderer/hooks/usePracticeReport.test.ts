import { describe, expect, it } from 'vitest'
import type { ExpectedTimeline } from '../../shared/score'
import { perturb } from '../../core/src/midi/perturb'
import { practiceReport } from '../../core/src/align/report'

/**
 * NFR 12's measurement, taken in the process that actually takes it.
 *
 * `core/` may not read a clock -- time is an input there, and the lint rule
 * that says so is the reason this file is here rather than beside the aligner.
 * The renderer is where alignment is called and where the turnaround the
 * player feels is spent, so this is the honest place to time it.
 *
 * **Reported, never asserted.** A millisecond figure is a measurement of one
 * machine; it goes into the plan's implementation log. What is asserted is the
 * shape of the work: banded alignment is linear in the take, so ten times the
 * take must not cost anything like a hundred times the work.
 */

/** Four beats to a bar, a three-note chord on each: two-hand repertoire, roughly. */
function piece(bars: number): ExpectedTimeline {
  const notes = []
  for (let bar = 0; bar < bars; bar++) {
    for (let beat = 0; beat < 4; beat++) {
      const root = 48 + ((bar * 4 + beat) % 24)
      for (let voice = 0; voice < 3; voice++) {
        notes.push({
          midi: root + voice * 4,
          onset: bar * 4 + beat,
          duration: 1,
          bar,
          staff: voice === 0 ? 1 : 0,
          voice: voice === 0 ? 5 : 1,
          tied: false,
          optional: false,
          ornament: null,
        })
      }
    }
  }
  return {
    scoreId: '0'.repeat(32),
    notes,
    bars: Array.from({ length: bars }, (_, index) => ({ index, onset: index * 4, beats: 4 })),
    pedal: [],
    dynamics: [],
  }
}

function timeAlignment(bars: number): { ms: number; events: number; groups: number } {
  const timeline = piece(bars)
  // 80 quarter notes a minute over 200 bars is ten minutes of playing.
  const take = perturb(timeline, { seed: 4242, bpm: 80 })

  const startedAt = performance.now()
  const report = practiceReport({ timeline, events: take.events, takeId: 'nfr-12' })
  const ms = performance.now() - startedAt

  expect(report.bars).toHaveLength(bars)
  return { ms, events: take.events.length, groups: bars * 4 }
}

describe('NFR 12: stop to a coloured score', () => {
  it('reports the turnaround for a ten-minute take of a 200-bar score', () => {
    const measured = timeAlignment(200)
    console.log(
      `[nfr 12] 200 bars, ${measured.groups} onset groups, ${measured.events} events: ` +
        `alignment ${measured.ms.toFixed(1)} ms on this machine`
    )
    expect(measured.events).toBeGreaterThan(4000)
  })

  it('costs about ten times as much for ten times the take, not a hundred', () => {
    // The property behind the number: the match is banded, so its cost is
    // linear in the take's onset groups rather than quadratic. A generous
    // ceiling -- this is defending against an accidental O(n squared), not
    // measuring a constant factor.
    // Warm the code path first: the first call through a cold JIT is several
    // times slower than the steady state, and comparing a cold small run with
    // a warm large one would read as superlinear when nothing is.
    timeAlignment(40)
    const small = timeAlignment(40)
    const large = timeAlignment(400)
    const ratio = Math.max(large.ms, 0.5) / Math.max(small.ms, 0.5)

    console.log(`[nfr 12] 40 bars ${small.ms.toFixed(1)} ms, 400 bars ${large.ms.toFixed(1)} ms`)
    // Linear is about ten; quadratic would be about a hundred. Thirty sits
    // between them with room for the noise of a busy machine.
    expect(ratio).toBeLessThan(30)
  })
})
