import { describe, expect, it } from 'vitest'
import { ExpectedTimelineSchema, type ExpectedTimeline } from '../../../shared/score'
import type { MidiEvent } from '../../../shared/midi'
import pickupJson from '../../fixtures/scores/pickup-two-hands.timeline.json'
import scaleJson from '../../fixtures/scores/scale-c-major.timeline.json'
import { DEFAULT_BPM, playTimeline, timelineNotes } from './generate'
import { perturb } from './perturb'

/**
 * The oracle, checked against the timeline it came from -- never against an
 * aligner, which does not exist yet. What each of these proves is that a
 * perturbation changes exactly what it says it changes and declares exactly
 * what it did.
 */

const scale: ExpectedTimeline = ExpectedTimelineSchema.parse(scaleJson)
const pickup: ExpectedTimeline = ExpectedTimelineSchema.parse(pickupJson)

const SEED = 4242

function noteOns(events: readonly MidiEvent[]): Extract<MidiEvent, { kind: 'noteOn' }>[] {
  return events.filter((event): event is Extract<MidiEvent, { kind: 'noteOn' }> =>
    event.kind === 'noteOn'
  )
}

function pitches(events: readonly MidiEvent[]): number[] {
  return noteOns(events).map((event) => event.note)
}

function gaps(events: readonly MidiEvent[]): number[] {
  const onsets = noteOns(events).map((event) => event.t)
  return onsets.slice(1).map((t, index) => t - (onsets[index] as number))
}

describe('playTimeline, clean', () => {
  it('is deterministic: the same seed twice is the same events', () => {
    const a = playTimeline(scale, { seed: SEED })
    const b = playTimeline(scale, { seed: SEED })
    expect(a).toEqual(b)
  })

  it('plays every written note once, in the order the score writes them', () => {
    const events = playTimeline(scale, { seed: SEED })
    expect(pitches(events)).toEqual(timelineNotes(scale).map((note) => note.midi))
  })

  it('pairs every note-on with a note-off of the same pitch', () => {
    const events = playTimeline(pickup, { seed: SEED })
    const ons = events.filter((event) => event.kind === 'noteOn')
    const offs = events.filter((event) => event.kind === 'noteOff')
    expect(offs).toHaveLength(ons.length)
    for (const on of ons) {
      if (on.kind !== 'noteOn') continue
      const off = offs.find(
        (candidate) => candidate.kind === 'noteOff' && candidate.note === on.note && candidate.t > on.t
      )
      expect(off, `no note-off for ${on.note} at ${on.t}`).toBeDefined()
    }
  })

  it('is in time order, which is what the playback timer assumes', () => {
    const events = playTimeline(scale, { seed: SEED })
    for (let i = 1; i < events.length; i++) {
      expect((events[i] as MidiEvent).t).toBeGreaterThanOrEqual((events[i - 1] as MidiEvent).t)
    }
  })

  it('keeps its jitter well under the window a chord is grouped by', () => {
    // A clean take has to score clean. If the jitter approached the 50 ms
    // grouping window, every test built on a clean take would be measuring
    // the generator instead of the aligner.
    const msPerQuarter = 60_000 / DEFAULT_BPM
    const written = timelineNotes(scale)
    const played = noteOns(playTimeline(scale, { seed: SEED }))
    played.forEach((event, index) => {
      const expected = (written[index]?.onset ?? 0) * msPerQuarter
      expect(Math.abs(event.t - expected)).toBeLessThanOrEqual(13)
    })
  })

  it('strikes the two hands of a chord together', () => {
    const events = noteOns(playTimeline(pickup, { seed: SEED }))
    const first = events.filter((event) => event.t < 100)
    expect(first.length).toBe(4)
    const spread = Math.max(...first.map((e) => e.t)) - Math.min(...first.map((e) => e.t))
    expect(spread).toBeLessThan(50)
  })

  it('declares nothing to find when nothing was perturbed', () => {
    const take = perturb(scale, { seed: SEED })
    expect(take.verdicts).toEqual([])
    expect(take.fittedTempo).toBe(DEFAULT_BPM)
    expect(pitches(take.events)).toEqual(pitches(playTimeline(scale, { seed: SEED })))
  })
})

describe('substitutePitch', () => {
  it('changes exactly one note-on, and says which', () => {
    const clean = playTimeline(scale, { seed: SEED })
    const take = perturb(scale, {
      seed: SEED,
      perturbations: [{ kind: 'substitutePitch', bar: 2, index: 0, semitones: 1 }],
    })

    const before = pitches(clean)
    const after = pitches(take.events)
    expect(after).toHaveLength(before.length)

    const changed = after.map((midi, i) => (midi === before[i] ? null : i)).filter((i) => i !== null)
    expect(changed).toHaveLength(1)

    expect(take.verdicts).toEqual([{ kind: 'wrongPitch', bar: 2, expected: 74, played: 75 }])
    expect(after[changed[0] as number]).toBe(75)
  })

  it('leaves the timing alone', () => {
    const clean = playTimeline(scale, { seed: SEED })
    const take = perturb(scale, {
      seed: SEED,
      perturbations: [{ kind: 'substitutePitch', bar: 2, index: 1 }],
    })
    expect(noteOns(take.events).map((e) => e.t)).toEqual(noteOns(clean).map((e) => e.t))
  })
})

describe('dropNote', () => {
  it('removes exactly one note-on, and says which pitch went missing', () => {
    const clean = playTimeline(scale, { seed: SEED })
    const take = perturb(scale, {
      seed: SEED,
      perturbations: [{ kind: 'dropNote', bar: 2, index: 0 }],
    })

    expect(pitches(take.events)).toHaveLength(pitches(clean).length - 1)
    expect(take.verdicts).toEqual([{ kind: 'missing', bar: 2, expected: 74 }])
    // The dropped pitch appears once in the clean take and not at all here.
    expect(pitches(clean).filter((m) => m === 74)).toHaveLength(1)
    expect(pitches(take.events).filter((m) => m === 74)).toHaveLength(0)
  })
})

describe('insertNote', () => {
  it('adds exactly one note-on, between two written ones, and says so', () => {
    const clean = playTimeline(scale, { seed: SEED })
    const take = perturb(scale, {
      seed: SEED,
      perturbations: [{ kind: 'insertNote', bar: 1, midi: 66, index: 0 }],
    })

    expect(pitches(take.events)).toHaveLength(pitches(clean).length + 1)
    expect(pitches(take.events).filter((m) => m === 66)).toHaveLength(1)
    expect(take.verdicts).toEqual([{ kind: 'extra', bar: 1, played: 66 }])

    const extra = noteOns(take.events).find((e) => e.note === 66)
    const bar1 = noteOns(take.events).filter((e) => e.note === 67 || e.note === 69)
    expect(extra?.t).toBeGreaterThan(bar1[0]?.t ?? 0)
    expect(extra?.t).toBeLessThan(bar1[1]?.t ?? 0)
  })
})

describe('rushBar', () => {
  it('compresses that bar and leaves every other bar where it was', () => {
    const clean = noteOns(playTimeline(scale, { seed: SEED, jitter: false }))
    const take = perturb(scale, {
      seed: SEED,
      jitter: false,
      perturbations: [{ kind: 'rushBar', bar: 2, fraction: 0.6 }],
    })
    const rushed = noteOns(take.events)

    expect(take.verdicts).toEqual([{ kind: 'timing', bar: 2 }])
    expect(rushed).toHaveLength(clean.length)

    // The bar's first note is where the rushing starts, so it does not move;
    // every later note in the bar arrives early, and no other bar shifts.
    const written = timelineNotes(scale)
    const firstOfBar = written.findIndex((note) => note.bar === 2)
    expect(firstOfBar).toBeGreaterThanOrEqual(0)
    let movedEarlier = 0

    rushed.forEach((event, index) => {
      const before = clean[index]?.t ?? 0
      if (written[index]?.bar !== 2) {
        expect(event.t).toBe(before)
      } else if (index === firstOfBar) {
        expect(event.t).toBe(before)
      } else {
        expect(event.t).toBeLessThan(before)
        movedEarlier++
      }
    })
    expect(movedEarlier).toBeGreaterThan(0)
  })

  it('refuses a bar that is not in the timeline rather than doing nothing', () => {
    expect(() =>
      perturb(scale, { perturbations: [{ kind: 'rushBar', bar: 99, fraction: 0.5 }] })
    ).toThrow(/no bar 99/)
  })
})

describe('tempoScale', () => {
  it('scales every inter-onset gap by the same factor and declares no error', () => {
    const clean = playTimeline(scale, { seed: SEED, jitter: false })
    const take = perturb(scale, {
      seed: SEED,
      jitter: false,
      perturbations: [{ kind: 'tempoScale', factor: 0.8 }],
    })

    // The property, as a ratio: absolute times say nothing about whether a
    // player kept time, and this is the one the aligner has to be blind to.
    const before = gaps(clean)
    const after = gaps(take.events)
    expect(after).toHaveLength(before.length)
    after.forEach((gap, index) => {
      expect(gap / (before[index] as number)).toBeCloseTo(0.8, 2)
    })

    expect(take.verdicts).toEqual([])
    expect(take.fittedTempo).toBeCloseTo(DEFAULT_BPM / 0.8, 6)
    expect(pitches(take.events)).toEqual(pitches(clean))
  })

  it('works the other way too: a slower piece is still a correct one', () => {
    const take = perturb(scale, {
      seed: SEED,
      jitter: false,
      perturbations: [{ kind: 'tempoScale', factor: 1.5 }],
    })
    expect(take.verdicts).toEqual([])
    expect(take.fittedTempo).toBeCloseTo(DEFAULT_BPM / 1.5, 6)
  })
})

describe('stopAfterBar', () => {
  it('emits no note-on from a later bar, and declares those bars not attempted', () => {
    const take = perturb(scale, {
      seed: SEED,
      perturbations: [{ kind: 'stopAfterBar', bar: 2 }],
    })

    const survived = timelineNotes(scale).filter((note) => note.bar <= 2)
    expect(pitches(take.events)).toEqual(survived.map((note) => note.midi))

    // Nothing from bar 3 was struck: not one of its pitches is in the take.
    const abandoned = timelineNotes(scale).filter((note) => note.bar >= 3)
    expect(abandoned.length).toBeGreaterThan(0)
    for (const note of abandoned) {
      expect(pitches(take.events)).not.toContain(note.midi)
    }

    expect(take.verdicts).toEqual([{ kind: 'notAttempted', bar: 3 }])
  })

  it('a stop before the end is not a pile of missing notes', () => {
    const take = perturb(scale, {
      seed: SEED,
      perturbations: [{ kind: 'stopAfterBar', bar: 0 }],
    })
    expect(take.verdicts.every((verdict) => verdict.kind === 'notAttempted')).toBe(true)
  })
})

describe('perturbations together', () => {
  it('declares one verdict each and applies both', () => {
    const take = perturb(scale, {
      seed: SEED,
      perturbations: [
        { kind: 'substitutePitch', bar: 0, index: 0, semitones: 2 },
        { kind: 'dropNote', bar: 3, index: 0 },
      ],
    })
    expect(take.verdicts).toEqual([
      { kind: 'wrongPitch', bar: 0, expected: 60, played: 62 },
      { kind: 'missing', bar: 3, expected: 81 },
    ])
    expect(pitches(take.events)).toHaveLength(timelineNotes(scale).length - 1)
  })

  it('is deterministic with perturbations applied', () => {
    const options = {
      seed: SEED,
      perturbations: [{ kind: 'insertNote' as const, bar: 1, midi: 61 }],
    }
    expect(perturb(scale, options).events).toEqual(perturb(scale, options).events)
  })
})
