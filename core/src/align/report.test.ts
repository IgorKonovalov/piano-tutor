import { describe, expect, it } from 'vitest'
import {
  ExpectedTimelineSchema,
  PracticeReportSchema,
  type BarVerdict,
  type ExpectedTimeline,
  type PracticeReport,
} from '../../../shared/score'
import type { MidiEvent } from '../../../shared/midi'
import graceJson from '../../fixtures/scores/grace-note.timeline.json'
import keyAndTimeJson from '../../fixtures/scores/key-and-time-change.timeline.json'
import multiRestJson from '../../fixtures/scores/multi-rest-and-ties.timeline.json'
import pickupJson from '../../fixtures/scores/pickup-two-hands.timeline.json'
import scaleJson from '../../fixtures/scores/scale-c-major.timeline.json'
import { DEFAULT_BPM } from '../midi/generate'
import { type Perturbation, perturb } from '../midi/perturb'
import { align } from './align'
import { expectedGroups, playedGroups } from './onsetGroups'
import { scoredNotes } from '../score/timeline'
import { TIMING_THRESHOLD_MS, barsByTiming, practiceReport } from './report'

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
  'grace-note': ExpectedTimelineSchema.parse(graceJson),
}

const SEED = 20260910

interface RunOptions {
  perturbations?: readonly Perturbation[]
  jitter?: boolean
  /** Whether the generated performance takes the ornaments (ADR-0009). */
  ornaments?: 'skipped' | 'played'
}

function run(name: keyof typeof TIMELINES | string, options: RunOptions = {}) {
  const timeline = TIMELINES[name]
  if (timeline === undefined) throw new Error(`no timeline named ${name}`)
  const take = perturb(timeline, {
    seed: SEED,
    jitter: options.jitter,
    ornaments: options.ornaments,
    perturbations: options.perturbations,
  })
  const report = PracticeReportSchema.parse(
    practiceReport({ timeline, events: take.events, takeId: `take-${name}` })
  )
  return { timeline, take, report }
}

/** The take alone, for a test that wants to bend the events before judging them. */
function runTake(name: keyof typeof TIMELINES | string, options: RunOptions = {}) {
  const timeline = TIMELINES[name]
  if (timeline === undefined) throw new Error(`no timeline named ${name}`)
  return {
    timeline,
    take: perturb(timeline, {
      seed: SEED,
      jitter: options.jitter,
      ornaments: options.ornaments,
      perturbations: options.perturbations,
    }),
  }
}

/** Everything from the first note of `bar` onward, `ms` later: the player stopped. */
function pauseBefore(
  events: readonly MidiEvent[],
  timeline: ExpectedTimeline,
  bar: number,
  ms: number
): MidiEvent[] {
  const onset = timeline.bars.find((entry) => entry.index === bar)?.onset ?? 0
  const at = onset * (60_000 / DEFAULT_BPM)
  // Half a beat of slack either side of the boundary, so the generator's
  // jitter cannot decide which side of the pause a note falls on.
  const from = at - 30_000 / DEFAULT_BPM
  return events.map((event) => (event.t >= from ? { ...event, t: event.t + ms } : event))
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
    // Scored notes, not every note: an ornament is in the timeline and is
    // judged neither way (ADR-0009).
    expect(report.counts.correct).toBe(scoredNotes(timeline).length)
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

describe('an ornament is scored neither way (ADR-0009)', () => {
  const ORNAMENT_BAR = 1

  it('is clean when the player takes the ornament, with no extra note', () => {
    // The defect this fixture exists for: before ADR-0009 the grace note
    // matched nothing on the expected side, so playing what is written was
    // charged as an extra note and reddened the bar.
    const { report } = run('grace-note', { ornaments: 'played' })

    expect(states(report)).toEqual(report.bars.map(() => 'clean'))
    expect(report.counts.extra).toBe(0)
    expect(report.counts.wrongPitch).toBe(0)
    expect(report.counts.missing).toBe(0)
    expect(verdicts(report, 'extra')).toEqual([])
  })

  it('is clean when the player leaves the ornament out, with nothing missing', () => {
    const { report } = run('grace-note', { ornaments: 'skipped' })

    expect(states(report)).toEqual(report.bars.map(() => 'clean'))
    expect(report.counts.missing).toBe(0)
    expect(report.counts.extra).toBe(0)
    expect(verdicts(report, 'missing')).toEqual([])
  })

  it('reports the same counts either way', () => {
    const taken = run('grace-note', { ornaments: 'played' }).report
    const left = run('grace-note', { ornaments: 'skipped' }).report
    expect(taken.counts).toEqual(left.counts)
  })

  it('never names the ornament in any verdict', () => {
    // B4 is the grace note. It appears in the timeline and must appear in no
    // verdict at all -- not correct, not missing, not extra, not wrong.
    const { report } = run('grace-note', { ornaments: 'played' })
    const mentioned = report.bars.flatMap((bar) =>
      bar.notes.flatMap((note) => [
        'expected' in note ? note.expected : -1,
        'played' in note ? note.played : -1,
      ])
    )
    expect(mentioned).not.toContain(71)
  })

  it('does not read the ornament as the beat when timing the bar', () => {
    // The generator strikes the grace note ahead of its principal. If the bar
    // were timed from the ornament it would read early by that lead, so the
    // decorated bar must sit no further from the fitted tempo than the others.
    const { report } = run('grace-note', { ornaments: 'played', jitter: false })
    const decorated = report.bars.find((bar) => bar.bar === ORNAMENT_BAR)
    const worst = Math.max(
      ...report.bars.filter((bar) => bar.bar !== ORNAMENT_BAR).map((bar) =>
        Math.abs(bar.timingDeviation)
      )
    )

    expect(decorated?.state).toBe('clean')
    expect(Math.abs(decorated?.timingDeviation ?? 0)).toBeLessThanOrEqual(worst + 1)
  })

  it('still finds a wrong note in the bar that carries the ornament', () => {
    // The ornament is forgiven; a real mistake beside it is not.
    // Index 3 of the played bar is C5, the note the grace decorates. Index 2
    // is the ornament itself, and perturbing that would be asking the aligner
    // to report something ADR-0009 says it must never report.
    const { take, report } = run('grace-note', {
      ornaments: 'played',
      perturbations: [{ kind: 'substitutePitch', bar: ORNAMENT_BAR, index: 3 }],
    })
    const declared = take.verdicts[0]
    if (declared?.kind !== 'wrongPitch') throw new Error('the oracle changed shape')
    expect(declared.expected).toBe(72)

    const wrong = verdicts(report, 'wrongPitch')
    expect(wrong).toHaveLength(1)
    expect(wrong[0]?.bar).toBe(declared.bar)
    expect(report.counts.extra).toBe(0)
  })
})

describe('a long piece played only at its opening (ADR-0010)', () => {
  /**
   * The regime the fixture corpus does not contain, and the one every real
   * practice session is in: a piece far longer than anything played, stopped
   * after the opening, with real mistakes in what was played.
   *
   * Measured at the CK88 on 2026-09-10 against Bach BWV 847 -- 1 028 expected
   * groups, 73 played -- where the matcher scattered matches out to group 945
   * and reported 1 585 notes missing at a fitted tempo of 2 663 bpm.
   *
   * The material matters and is the reason a first attempt at this test proved
   * nothing. Scattering only pays when a group is **small**: a distant partial
   * match of a one-note group costs about what skipping it costs, while a
   * three-note chord against a different one costs twice a gap and is never
   * worth taking. So this is single-note figuration over a small pitch set --
   * a prelude, not a chorale.
   */
  const BARS = 69
  const PLAYED_BARS = 12
  const PER_BAR = 16

  function figuration(bars: number): ExpectedTimeline {
    const FIGURE = [0, 3, 7, 12, 7, 3, 7, 12]
    const ROOTS = [0, 5, 7, 2, 9, 4]
    const notes = []
    for (let bar = 0; bar < bars; bar++) {
      const root = 48 + (ROOTS[bar % ROOTS.length] as number)
      for (let n = 0; n < PER_BAR; n++) {
        notes.push({
          midi: root + (FIGURE[n % FIGURE.length] as number),
          onset: bar * 4 + (n * 4) / PER_BAR,
          duration: 4 / PER_BAR,
          bar,
          staff: 0,
          voice: 1,
          tied: false,
          grace: false,
        })
      }
    }
    return {
      scoreId: 'e'.repeat(32),
      notes,
      bars: Array.from({ length: bars }, (_, index) => ({ index, onset: index * 4, beats: 4 })),
    }
  }

  const timeline = figuration(BARS)
  const take = perturb(timeline, {
    seed: SEED,
    perturbations: [
      { kind: 'stopAfterBar', bar: PLAYED_BARS - 1 },
      // Real playing, not a clean generated pass: with no mistake in it the
      // true alignment costs nothing and no scattered path could ever beat it.
      { kind: 'substitutePitch', bar: 5, index: 0 },
      { kind: 'substitutePitch', bar: 8, index: 3 },
      { kind: 'dropNote', bar: 9, index: 1 },
    ],
  })
  const report = practiceReport({ timeline, events: take.events, takeId: 'opening' })
  const playedGroupCount = playedGroups(take.events).length

  it('calls the unplayed tail not attempted, not missing', () => {
    // Before ADR-0010: fifty-one bars, because scattered matches made the
    // matcher believe the player had reached bar 17.
    const notAttempted = report.bars.filter((bar) => bar.state === 'notAttempted')
    expect(notAttempted.map((bar) => bar.bar)).toEqual(
      Array.from({ length: BARS - PLAYED_BARS }, (_, i) => PLAYED_BARS + i)
    )
  })

  it('charges no missing note outside the stretch that was played', () => {
    for (const bar of report.bars) {
      if (bar.bar < PLAYED_BARS) continue
      expect(bar.notes).toEqual([])
    }
    // Only the deliberately dropped note. Before ADR-0010: ninety-seven.
    expect(report.counts.missing).toBeLessThanOrEqual(2)
  })

  it('keeps the match at the opening rather than scattering it down the score', () => {
    const alignment = align(expectedGroups(timeline), playedGroups(take.events))
    const matched = alignment.steps.flatMap((step) =>
      step.kind === 'match' ? [step.expected] : []
    )

    // Every match lands within the opening the player actually played. Before
    // ADR-0010 the furthest was group 287, well past anything struck.
    expect(Math.max(...matched)).toBeLessThan(playedGroupCount + PER_BAR)
    expect(alignment.reachedTo).toBeLessThanOrEqual(playedGroupCount + PER_BAR)
  })

  it('fits a tempo that is a tempo', () => {
    // The instrument reported 2 663 bpm; this material reported 166 against a
    // written 90. A fit spread across the whole score is not a tempo at all.
    expect(report.fittedTempo).not.toBeNull()
    expect((report.fittedTempo as number) / DEFAULT_BPM).toBeCloseTo(1, 1)
  })

  it('still judges the bars that were played', () => {
    const played = report.bars.filter((bar) => bar.bar < PLAYED_BARS)
    expect(played.filter((bar) => bar.state === 'clean').length).toBeGreaterThan(0)
    expect(report.counts.wrongPitch).toBeGreaterThan(0)
    expect(report.counts.correct).toBeGreaterThan(PLAYED_BARS * PER_BAR * 0.9)
  })
})

/**
 * The local timing model (ADR-0014). What is under test here is a single
 * property, stated four ways: **a take played evenly reports no timing error,
 * however the take is structured** (NFR 14). A restart, a rallentando, a take
 * at half speed and a take with a long pause in it are all even playing with
 * something else going on, and none of them is a timing mistake.
 *
 * The bar that must still be flagged is the one that was genuinely rushed. A
 * local reference forgives more than a global one by design, and that bar is
 * the property most at risk from it.
 */
describe('timing is judged against the bars around it', () => {
  function timingBars(report: PracticeReport): number[] {
    return report.bars.filter((bar) => bar.state === 'timing').map((bar) => bar.bar)
  }

  it('reports no timing error for a rallentando: slowing down is not a mistake', () => {
    const perturbation: Perturbation = {
      kind: 'rallentando',
      fromBar: 1,
      toBar: 3,
      factor: 0.7,
    }
    const { take, report } = run('scale-c-major', { perturbations: [perturbation] })

    // The oracle declares a tempo change and no note-level verdict at all.
    expect(take.verdicts).toEqual([{ kind: 'tempoChange', bar: 1, toBar: 3, percent: -30 }])
    expect(timingBars(report)).toEqual([])
    expect(states(report)).toEqual(report.bars.map(() => 'clean'))
    expect(report.counts.wrongPitch).toBe(0)
    expect(report.counts.missing).toBe(0)
    expect(report.counts.extra).toBe(0)
  })

  it('forgives a violent rallentando as readily as a gentle one', () => {
    // Half the tempo across three bars. A global line would read the ends of
    // this take as seconds of error; a local one follows the player down.
    const { report } = run('scale-c-major', {
      perturbations: [{ kind: 'rallentando', fromBar: 1, toBar: 3, factor: 0.5 }],
    })
    expect(timingBars(report)).toEqual([])
  })

  it('reports no timing error for a restart, and flags no bar before it', () => {
    // The propagation property, and the most important assertion in this plan.
    // A global fit turned the whole take orange for this take, bars *before*
    // the false start included, and left the player no way back to right
    // timing (ADR-0014).
    const perturbation: Perturbation = { kind: 'restartAtBar', bar: 2 }
    const { take, report } = run('scale-c-major', { perturbations: [perturbation] })

    const declared = take.verdicts[0]
    if (declared?.kind !== 'restart') throw new Error('the oracle changed shape')

    expect(timingBars(report)).toEqual([])
    for (const bar of report.bars.filter((entry) => entry.bar < declared.bar)) {
      expect(bar.state, `bar ${bar.bar} before the restart`).toBe('clean')
      expect(Math.abs(bar.timingDeviation)).toBeLessThan(TIMING_THRESHOLD_MS)
    }
    // The notes themselves were right: what the restart leaves behind is a
    // pile of extras, which is Phase 3's business and not timing's.
    expect(report.counts.wrongPitch).toBe(0)
    expect(report.counts.missing).toBe(0)
  })

  it('reports no timing error for a restart in the middle of the piece either', () => {
    const { report } = run('scale-c-major', {
      perturbations: [{ kind: 'restartAtBar', bar: 1 }],
    })
    expect(timingBars(report)).toEqual([])
    expect(report.bars[0]?.state).toBe('clean')
  })

  it('reports no timing error for a long pause between two bars', () => {
    // Not a perturbation: the player reached bar 2, stopped for three seconds
    // -- a page turn, a breath, a look at the fingering -- and carried on.
    // Every note is where it was relative to its neighbours, so nothing about
    // the playing was uneven and nothing is reported.
    const { timeline, take } = runTake('scale-c-major')
    const paused = pauseBefore(take.events, timeline, 2, 3_000)
    const report = practiceReport({ timeline, events: paused, takeId: 'paused' })

    expect(timingBars(report)).toEqual([])
    expect(report.counts.wrongPitch).toBe(0)
    expect(report.counts.extra).toBe(0)

    // The pause really is in there: the take runs three seconds longer.
    const ran = (events: readonly MidiEvent[]) => Math.max(...events.map((event) => event.t))
    expect(ran(paused) - ran(take.events)).toBe(3_000)
  })

  it('still flags the bar that was genuinely rushed, and ranks it worst', () => {
    const perturbation: Perturbation = { kind: 'rushBar', bar: 2, fraction: 0.55 }
    const { take, report } = run('scale-c-major', { perturbations: [perturbation] })

    const declared = take.verdicts[0]
    if (declared?.kind !== 'timing') throw new Error('the oracle changed shape')

    const rushed = report.bars.find((bar) => bar.bar === declared.bar)
    expect(rushed?.state).toBe('timing')
    expect(rushed?.timingDeviation).toBeLessThan(-TIMING_THRESHOLD_MS)
    expect(barsByTiming(report)[0]?.bar).toBe(declared.bar)

    // And it is the only one: a local reference is what stops one bar's
    // disturbance from reaching its neighbours.
    expect(timingBars(report)).toEqual([declared.bar])
  })

  it('leaves a bar with no evidence either side without a verdict rather than a guess', () => {
    // The first and last bars of a take have neighbours on one side only
    // (ADR-0014), so they carry no timing figure at all.
    const { report } = run('scale-c-major')
    expect(report.bars[0]?.timingDeviation).toBe(0)
    expect(report.bars[report.bars.length - 1]?.timingDeviation).toBe(0)
  })
})

describe('a restart is named, not counted as mistakes', () => {
  it('reports one restart at the bar the oracle declared, and no extra notes', () => {
    const perturbation: Perturbation = { kind: 'restartAtBar', bar: 2 }
    const { take, report } = run('scale-c-major', { perturbations: [perturbation] })

    const declared = take.verdicts[0]
    if (declared?.kind !== 'restart') throw new Error('the oracle changed shape')

    expect(report.restarts).toEqual([{ bar: declared.bar, notes: declared.notes }])

    // The notes the repeat accounts for were previously the whole of
    // `counts.extra`, and they were correct notes: the player was being
    // careful, not wrong (ADR-0014).
    expect(declared.notes).toBeGreaterThan(0)
    expect(report.counts.extra).toBe(0)
    expect(report.counts.wrongPitch).toBe(0)
    expect(report.counts.missing).toBe(0)
    expect(states(report)).toEqual(report.bars.map(() => 'clean'))
  })

  it('reports an empty list for a take with no restart in it', () => {
    expect(run('scale-c-major').report.restarts).toEqual([])
    expect(run('pickup-two-hands').report.restarts).toEqual([])
  })

  it('reports two restarts in a take that has two', () => {
    const { report } = run('scale-c-major', {
      perturbations: [
        { kind: 'restartAtBar', bar: 1 },
        { kind: 'restartAtBar', bar: 2 },
      ],
    })
    expect(report.restarts.map((restart) => restart.bar)).toEqual([1, 2])
    expect(report.counts.extra).toBe(0)
  })

  it('stays sized by the score: a restart does not grow the report', () => {
    // NFR 7's lever, and the reason a restart is one entry naming a bar rather
    // than a list of the notes it covered. A player who goes back three times
    // must not hand the coach three passages of MIDI.
    const plain = run('scale-c-major').report
    const restarted = run('scale-c-major', {
      perturbations: [
        { kind: 'restartAtBar', bar: 1 },
        { kind: 'restartAtBar', bar: 2 },
      ],
    }).report

    const size = (report: PracticeReport) => JSON.stringify(report).length
    expect(size(restarted) / size(plain)).toBeLessThan(1.1)
  })
})
