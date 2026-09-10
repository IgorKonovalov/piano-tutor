import { describe, expect, it } from 'vitest'
import {
  ExpectedTimelineSchema,
  PracticeReportSchema,
  type BarVerdict,
  type ExpectedTimeline,
  type PracticeReport,
} from '../../../shared/score'
import type { MidiEvent } from '../../../shared/midi'
import keyAndTimeJson from '../../fixtures/scores/key-and-time-change.timeline.json'
import multiRestJson from '../../fixtures/scores/multi-rest-and-ties.timeline.json'
import pickupJson from '../../fixtures/scores/pickup-two-hands.timeline.json'
import scaleJson from '../../fixtures/scores/scale-c-major.timeline.json'
import { DEFAULT_BPM } from '../midi/generate'
import { type Perturbation, perturb } from '../midi/perturb'
import { barsByTiming, practiceReport } from './report'

/**
 * The aligner against the oracle of Phase 3.
 *
 * **Every expectation here comes from the perturbation's own declaration**, or
 * from a property that must hold whatever the aligner does. Nothing is copied
 * from a run: an oracle and an implementation that agree because one was
 * written from the other's output prove only that they are consistent.
 */

const TIMELINES: Record<string, ExpectedTimeline> = {
  'scale-c-major': ExpectedTimelineSchema.parse(scaleJson),
  'pickup-two-hands': ExpectedTimelineSchema.parse(pickupJson),
  'key-and-time-change': ExpectedTimelineSchema.parse(keyAndTimeJson),
  'multi-rest-and-ties': ExpectedTimelineSchema.parse(multiRestJson),
}

const SEED = 20260910

interface RunOptions {
  perturbations?: readonly Perturbation[]
  jitter?: boolean
}

function run(name: keyof typeof TIMELINES | string, options: RunOptions = {}) {
  const timeline = TIMELINES[name]
  if (timeline === undefined) throw new Error(`no timeline named ${name}`)
  const take = perturb(timeline, {
    seed: SEED,
    jitter: options.jitter,
    perturbations: options.perturbations,
  })
  const report = PracticeReportSchema.parse(
    practiceReport({ timeline, events: take.events, takeId: `take-${name}` })
  )
  return { timeline, take, report }
}

function verdicts(report: PracticeReport, kind: string): { bar: number; verdict: unknown }[] {
  return report.bars.flatMap((bar) =>
    bar.notes.filter((note) => note.kind === kind).map((verdict) => ({ bar: bar.bar, verdict }))
  )
}

function states(report: PracticeReport): BarVerdict['state'][] {
  return report.bars.map((bar) => bar.state)
}

describe('a clean take of every fixture score', () => {
  it.each(Object.keys(TIMELINES))('scores %s clean, bar for bar', (name) => {
    const { timeline, report } = run(name)

    expect(report.bars.map((bar) => bar.bar)).toEqual(timeline.bars.map((bar) => bar.index))
    expect(states(report)).toEqual(timeline.bars.map(() => 'clean'))
    expect(report.counts.wrongPitch).toBe(0)
    expect(report.counts.missing).toBe(0)
    expect(report.counts.extra).toBe(0)
    expect(report.counts.correct).toBe(timeline.notes.length)
    expect(report.unalignableFromBar).toBeNull()
  })

  it('fits the tempo it was played at', () => {
    const { report } = run('scale-c-major')
    expect(report.fittedTempo).toBeCloseTo(DEFAULT_BPM, 0)
  })

  it('attributes the anacrusis to the bar the timeline puts it in', () => {
    const { timeline, report } = run('pickup-two-hands')
    const pickupBar = timeline.bars[0]?.index ?? -1
    const firstFull = timeline.bars[1]?.onset ?? 0

    const written = timeline.notes.filter((note) => note.onset < firstFull)
    expect(written.length).toBeGreaterThan(0)

    const pickupVerdict = report.bars.find((bar) => bar.bar === pickupBar)
    expect(pickupVerdict?.notes).toHaveLength(written.length)
    expect(pickupVerdict?.notes.every((note) => note.kind === 'correct')).toBe(true)
    expect(new Set(written.map((note) => note.midi))).toEqual(
      new Set(
        pickupVerdict?.notes.map((note) => (note.kind === 'correct' ? note.expected : -1)) ?? []
      )
    )
  })

  it('keeps a two-hand chord together instead of calling it four late notes', () => {
    const { report } = run('pickup-two-hands')
    expect(report.bars.every((bar) => Math.abs(bar.timingDeviation) < 45)).toBe(true)
  })
})

describe('substitutePitch', () => {
  it('reports exactly one wrong pitch, in the bar the perturbation names', () => {
    const perturbation: Perturbation = {
      kind: 'substitutePitch',
      bar: 5,
      index: 0,
      semitones: 1,
    }
    const { take, report } = run('multi-rest-and-ties', { perturbations: [perturbation] })

    const declared = take.verdicts
    expect(declared).toHaveLength(1)
    const expectedVerdict = declared[0]
    if (expectedVerdict?.kind !== 'wrongPitch') throw new Error('the oracle changed shape')

    const found = verdicts(report, 'wrongPitch')
    expect(found).toHaveLength(1)
    expect(found[0]?.bar).toBe(expectedVerdict.bar)
    expect(found[0]?.verdict).toEqual({
      kind: 'wrongPitch',
      expected: expectedVerdict.expected,
      played: expectedVerdict.played,
    })

    expect(report.counts.missing).toBe(0)
    expect(report.counts.extra).toBe(0)
    expect(report.bars.find((bar) => bar.bar === expectedVerdict.bar)?.state).toBe('wrong')
  })

  it('leaves every other bar clean', () => {
    const { report } = run('scale-c-major', {
      perturbations: [{ kind: 'substitutePitch', bar: 2, index: 0, semitones: -1 }],
    })
    expect(states(report)).toEqual(['clean', 'clean', 'wrong', 'clean'])
  })
})

describe('dropNote', () => {
  it.each([
    ['scale-c-major', 2, 1],
    ['scale-c-major', 1, 3],
    ['multi-rest-and-ties', 5, 0],
  ])('in %s bar %s reports exactly one missing note there', (name, bar, index) => {
    const perturbation: Perturbation = { kind: 'dropNote', bar, index }
    const { take, report } = run(name, { perturbations: [perturbation] })

    const declared = take.verdicts[0]
    if (declared?.kind !== 'missing') throw new Error('the oracle changed shape')

    const found = verdicts(report, 'missing')
    expect(found).toHaveLength(1)
    expect(found[0]?.bar).toBe(declared.bar)
    expect(found[0]?.verdict).toEqual({ kind: 'missing', expected: declared.expected })
    expect(report.counts.extra).toBe(0)
    expect(report.counts.wrongPitch).toBe(0)
    expect(report.bars.find((entry) => entry.bar === declared.bar)?.state).toBe('wrong')
  })

  it('reads a dropped LAST note as stopping short, not as a missing note', () => {
    // The two are the same evidence: nothing was played after the last thing
    // that matched. The report says "you did not get there" rather than
    // inventing a mistake, and the choice is asserted here so it stays a
    // decision rather than becoming an accident.
    const { report } = run('multi-rest-and-ties', {
      perturbations: [{ kind: 'dropNote', bar: 6, index: 0 }],
    })
    expect(report.counts.missing).toBe(0)
    expect(report.bars.find((bar) => bar.bar === 6)?.state).toBe('notAttempted')
    expect(report.bars.find((bar) => bar.bar === 5)?.state).toBe('clean')
  })
})

describe('insertNote', () => {
  it('reports exactly one extra note, and nothing missing', () => {
    const perturbation: Perturbation = { kind: 'insertNote', bar: 1, midi: 66, index: 0 }
    const { take, report } = run('scale-c-major', { perturbations: [perturbation] })

    const declared = take.verdicts[0]
    if (declared?.kind !== 'extra') throw new Error('the oracle changed shape')

    const found = verdicts(report, 'extra')
    expect(found).toHaveLength(1)
    expect(found[0]?.verdict).toEqual({ kind: 'extra', played: declared.played })
    expect(report.counts.missing).toBe(0)
    expect(report.counts.wrongPitch).toBe(0)
    expect(report.counts.correct).toBe(TIMELINES['scale-c-major']?.notes.length)
  })
})

describe('tempoScale: the tempo-free property', () => {
  it.each([0.8, 1.25, 0.5])(
    'a piece played evenly at %s of the written speed has no timing error',
    (factor) => {
      const { take, report } = run('scale-c-major', {
        perturbations: [{ kind: 'tempoScale', factor }],
      })

      // The perturbation declares no verdict at all, and that is the point:
      // playing evenly at the wrong tempo is playing correctly.
      expect(take.verdicts).toEqual([])
      expect(states(report)).toEqual(report.bars.map(() => 'clean'))
      expect(report.counts.wrongPitch).toBe(0)
      expect(report.counts.missing).toBe(0)
      expect(report.counts.extra).toBe(0)

      // The tempo is found rather than assumed, within a per cent.
      expect(report.fittedTempo).not.toBeNull()
      expect((report.fittedTempo as number) / take.fittedTempo).toBeCloseTo(1, 2)
    }
  )

  it('holds for a two-hand piece as well as a single line', () => {
    const { report } = run('pickup-two-hands', {
      perturbations: [{ kind: 'tempoScale', factor: 0.75 }],
    })
    expect(states(report)).toEqual(report.bars.map(() => 'clean'))
    expect((report.fittedTempo as number) / (DEFAULT_BPM / 0.75)).toBeCloseTo(1, 2)
  })
})

describe('rushBar', () => {
  it('ranks the rushed bar worst by timing, and calls no note wrong', () => {
    const perturbation: Perturbation = { kind: 'rushBar', bar: 2, fraction: 0.55 }
    const { take, report } = run('scale-c-major', { perturbations: [perturbation] })

    const declared = take.verdicts[0]
    if (declared?.kind !== 'timing') throw new Error('the oracle changed shape')

    // The ordering is the assertion, not the threshold: a bar can only be
    // ranked worst by being further from the fitted line than every other.
    expect(barsByTiming(report)[0]?.bar).toBe(declared.bar)
    expect(report.counts.wrongPitch).toBe(0)
    expect(report.counts.missing).toBe(0)
    expect(report.counts.extra).toBe(0)

    // Rushed means early, and early is negative.
    const rushed = report.bars.find((bar) => bar.bar === declared.bar)
    expect(rushed?.timingDeviation).toBeLessThan(0)
  })

  it('says nothing about timing when the piece is even', () => {
    const { report } = run('scale-c-major')
    const worst = barsByTiming(report)[0]
    expect(Math.abs(worst?.timingDeviation ?? 0)).toBeLessThan(45)
  })
})

describe('stopAfterBar', () => {
  it('reports the abandoned bars as not attempted, and none of them as missing', () => {
    const perturbation: Perturbation = { kind: 'stopAfterBar', bar: 4 }
    const { take, report } = run('multi-rest-and-ties', { perturbations: [perturbation] })

    const abandoned = take.verdicts
      .filter((verdict) => verdict.kind === 'notAttempted')
      .map((verdict) => verdict.bar)
    expect(abandoned).toEqual([5, 6])

    for (const bar of abandoned) {
      const verdict = report.bars.find((entry) => entry.bar === bar)
      expect(verdict?.state).toBe('notAttempted')
      expect(verdict?.notes).toEqual([])
    }

    // A player who stopped has not played the rest wrongly.
    expect(report.counts.missing).toBe(0)
    expect(report.counts.wrongPitch).toBe(0)
    expect(report.counts.extra).toBe(0)
    for (const bar of report.bars) {
      if (abandoned.includes(bar.bar)) continue
      expect(bar.state).toBe('clean')
    }
  })

  it('does not read a stop as a derailment', () => {
    const { report } = run('scale-c-major', {
      perturbations: [{ kind: 'stopAfterBar', bar: 1 }],
    })
    expect(report.unalignableFromBar).toBeNull()
    expect(states(report)).toEqual(['clean', 'clean', 'notAttempted', 'notAttempted'])
  })
})

describe('the report is sized by the score, not by the take', () => {
  it('is one entry per bar however many events arrived', () => {
    const short = run('scale-c-major', { perturbations: [{ kind: 'stopAfterBar', bar: 0 }] })
    const full = run('scale-c-major')
    expect(short.report.bars).toHaveLength(full.report.bars.length)
    expect(short.report.bars).toHaveLength(TIMELINES['scale-c-major']?.bars.length ?? 0)
  })

  it('a ten-minute take of a piece serialises to the size of a one-minute one', () => {
    // NFR 7's lever, guaranteed here where it is cheap. A player who takes ten
    // times as long over the same piece produces ten times the events and the
    // same report, because what a report describes is the score.
    const timeline = longTimeline(200)
    const oneMinute = perturb(timeline, { seed: SEED, bpm: 800 })
    const tenMinutes = perturb(timeline, { seed: SEED, bpm: 80 })

    const spanMinutes = (events: typeof oneMinute.events) =>
      ((events[events.length - 1]?.t ?? 0) - (events[0]?.t ?? 0)) / 60_000
    expect(spanMinutes(oneMinute.events)).toBeLessThan(2)
    expect(spanMinutes(tenMinutes.events)).toBeGreaterThan(9)
    expect(tenMinutes.events.length).toBe(oneMinute.events.length)

    const size = (events: typeof oneMinute.events, takeId: string) =>
      JSON.stringify(practiceReport({ timeline, events, takeId })).length

    const ratio = size(tenMinutes.events, 'long') / size(oneMinute.events, 'short')
    expect(ratio).toBeGreaterThan(0.9)
    expect(ratio).toBeLessThan(1.1)
  })

})

/**
 * A plain 4/4 piece of `bars` bars, four beats to a bar and a three-note chord
 * on each: a fair stand-in for real two-hand repertoire rather than a single
 * line, which would make the NFR 12 figure below look better than it is.
 */
function longTimeline(bars: number, chord = 3): ExpectedTimeline {
  const notes = []
  for (let bar = 0; bar < bars; bar++) {
    for (let beat = 0; beat < 4; beat++) {
      const root = 48 + ((bar * 4 + beat) % 24)
      for (let voice = 0; voice < chord; voice++) {
        notes.push({
          midi: root + voice * 4,
          onset: bar * 4 + beat,
          duration: 1,
          bar,
          staff: voice === 0 ? 1 : 0,
          voice: voice === 0 ? 5 : 1,
          tied: false,
          grace: false,
        })
      }
    }
  }
  return {
    scoreId: '0'.repeat(32),
    notes,
    bars: Array.from({ length: bars }, (_, index) => ({ index, onset: index * 4, beats: 4 })),
  }
}

describe('mixed mistakes', () => {
  it('reports each one once, in its own bar, and leaves the rest clean', () => {
    const { take, report } = run('scale-c-major', {
      perturbations: [
        { kind: 'substitutePitch', bar: 0, index: 1, semitones: 1 },
        { kind: 'dropNote', bar: 3, index: 0 },
      ],
    })

    expect(take.verdicts).toHaveLength(2)
    expect(verdicts(report, 'wrongPitch')).toHaveLength(1)
    expect(verdicts(report, 'missing')).toHaveLength(1)
    expect(verdicts(report, 'wrongPitch')[0]?.bar).toBe(0)
    expect(verdicts(report, 'missing')[0]?.bar).toBe(3)
    expect(states(report)).toEqual(['wrong', 'clean', 'clean', 'wrong'])
  })
})

describe('an empty take', () => {
  it('is every bar not attempted rather than every note missing', () => {
    const timeline = TIMELINES['scale-c-major'] as ExpectedTimeline
    const report = practiceReport({ timeline, events: [], takeId: 'nothing' })
    expect(states(report)).toEqual(timeline.bars.map(() => 'notAttempted'))
    expect(report.counts).toEqual({ correct: 0, wrongPitch: 0, missing: 0, extra: 0 })
    expect(report.fittedTempo).toBeNull()
  })
})

describe('a piece played with broken chords', () => {
  /**
   * The take that found this: a player working through `pickup-two-hands` at
   * the instrument, arpeggiating every chord about 650 ms per note, all
   * nineteen pitches correct and in order. The report said four as written,
   * fifteen missed and fifteen extra -- the same pitches counted as both.
   */
  const timeline = TIMELINES['pickup-two-hands'] as ExpectedTimeline

  function brokenTake(): MidiEvent[] {
    const events: MidiEvent[] = []
    let t = 0
    for (const note of [...timeline.notes].sort(
      (a, b) => a.onset - b.onset || a.midi - b.midi
    )) {
      events.push({ kind: 'noteOn', t, ch: 0, note: note.midi, velocity: 70 })
      events.push({ kind: 'noteOff', t: t + 500, ch: 0, note: note.midi, velocity: 0 })
      t += 650
    }
    return events.sort((a, b) => a.t - b.t)
  }

  it('counts every note as written, not as missing and extra at once', () => {
    const report = practiceReport({ timeline, events: brokenTake(), takeId: 'broken' })
    expect(report.counts).toEqual({
      correct: timeline.notes.length,
      wrongPitch: 0,
      missing: 0,
      extra: 0,
    })
  })

  it('never reports a pitch as both missing and extra in the same bar', () => {
    // The signature of the failure, asserted directly so it cannot come back
    // in another form: a note the player did strike cannot be missing.
    const report = practiceReport({ timeline, events: brokenTake(), takeId: 'broken' })
    for (const bar of report.bars) {
      const missing = bar.notes.filter((n) => n.kind === 'missing').map((n) => n.expected)
      const extra = bar.notes.filter((n) => n.kind === 'extra').map((n) => n.played)
      expect(missing.filter((pitch) => extra.includes(pitch))).toEqual([])
    }
  })

  it('finds a wrong note inside a broken chord, and only that one', () => {
    const events = brokenTake()
    const target = events.find((e) => e.kind === 'noteOn' && e.note === 76)
    if (target === undefined || target.kind !== 'noteOn') throw new Error('no E5 in the take')
    target.note = 77

    const report = practiceReport({ timeline, events, takeId: 'broken-wrong' })
    expect(report.counts.wrongPitch).toBe(1)
    expect(report.counts.missing).toBe(0)
    expect(report.counts.extra).toBe(0)
  })
})
