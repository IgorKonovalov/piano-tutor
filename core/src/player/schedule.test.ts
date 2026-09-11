import { describe, expect, it } from 'vitest'
import samplerJson from '../../fixtures/playback/sampler.timeline.json'
import ornamentsJson from '../../fixtures/scores/ornaments.timeline.json'
import pedalJson from '../../fixtures/scores/pedal.timeline.json'
import dynamicsJson from '../../fixtures/scores/dynamics.timeline.json'
import { CC_SUSTAIN, type MidiEvent } from '../../../shared/midi'
import {
  DEFAULT_BPM,
  GRACE_NOTE_MS,
  MAX_BPM,
  MIN_BPM,
  PLAYBACK_VELOCITY,
  type PlaybackSchedule,
  type PlaybackSource,
  RELEASE_GAP_MS,
} from '../../../shared/player'
import { ExpectedTimelineSchema, type ExpectedTimeline } from '../../../shared/score'
import { findScenarioById } from '../midi/generate'
import { barTableProblems, noteBarProblems } from '../score/timeline'
import {
  TRUNCATED_TAIL_MS,
  normaliseSchedule,
  outstandingAtEnd,
  scheduleFromEvents,
  scheduleFromTimeline,
} from './schedule'

/**
 * Five bars of 4/4 behind a one-beat anacrusis, carrying the four shapes a
 * tempo conversion can get wrong: a chord struck together, an ornament with no
 * written length, a note tied across a barline, and a bar that opens with a
 * rest.
 */
const sampler = ExpectedTimelineSchema.parse(samplerJson)

/** Seven symbol ornaments, each realised by OSMD at extraction. */
const ornaments = ExpectedTimelineSchema.parse(ornamentsJson)

/** A press, a change and a lift, in a four-bar line (bars 1 and 2 pedalled). */
const pedalled = ExpectedTimelineSchema.parse(pedalJson)

/** pp, a crescendo to ff, and p in the right hand; one mf in the left. */
const dynamics = ExpectedTimelineSchema.parse(dynamicsJson)

function struck(schedule: PlaybackSchedule) {
  return schedule.events.filter((e) => e.event.kind === 'noteOn')
}

function released(schedule: PlaybackSchedule) {
  return schedule.events.filter((e) => e.event.kind === 'noteOff')
}

/** How long one pitch is held, from its strike to its release. */
function soundingFor(schedule: PlaybackSchedule, note: number): number {
  const on = struck(schedule).find((e) => (e.event as { note: number }).note === note)
  const off = released(schedule).find((e) => (e.event as { note: number }).note === note)
  return (off?.at ?? NaN) - (on?.at ?? NaN)
}

const scenario: PlaybackSource = { kind: 'scenario', id: 'test' }

function on(t: number, note: number, ch = 0): MidiEvent {
  return { kind: 'noteOn', t, ch, note, velocity: 72 }
}

function off(t: number, note: number, ch = 0): MidiEvent {
  return { kind: 'noteOff', t, ch, note, velocity: 0 }
}

function pedal(t: number, down: boolean, ch = 0): MidiEvent {
  return { kind: 'cc', t, ch, controller: CC_SUSTAIN, value: down ? 127 : 0 }
}

describe('a schedule is relative time', () => {
  it('rebases the first event to zero and keeps the gaps', () => {
    const schedule = scheduleFromEvents([on(5000, 60), off(5300, 60)], scenario)
    expect(schedule.events.map((e) => e.at)).toEqual([0, 300])
    expect(schedule.durationMs).toBe(300)
  })

  it('rewrites each event t to its own at, leaving no absolute time inside', () => {
    const schedule = scheduleFromEvents([on(5000, 60), off(5300, 60)], scenario)
    expect(schedule.events.map((e) => e.event.t)).toEqual([0, 300])
  })

  it('is empty, and lasts nothing, for a source with no events', () => {
    const schedule = scheduleFromEvents([], scenario)
    expect(schedule.events).toEqual([])
    expect(schedule.durationMs).toBe(0)
  })
})

describe('order inside one millisecond', () => {
  it('releases a repeated note before it restrikes', () => {
    // Both at 1000: struck again the instant it is let go. Dispatched the
    // other way round the instrument merges the two into one held note.
    const schedule = scheduleFromEvents([on(1000, 60), off(1000, 60), off(1400, 60)], scenario)
    expect(schedule.events.map((e) => e.event.kind)).toEqual(['noteOff', 'noteOn', 'noteOff'])
  })

  it('puts a pedal between the release and the strike', () => {
    const schedule = scheduleFromEvents([on(0, 60), pedal(0, true), off(0, 62)], scenario)
    expect(schedule.events.slice(0, 3).map((e) => e.event.kind)).toEqual([
      'noteOff',
      'cc',
      'noteOn',
    ])
  })

  it('keeps the arrival order of a chord struck together', () => {
    const schedule = scheduleFromEvents(
      [on(0, 64), on(0, 60), on(0, 67), off(500, 60), off(500, 64), off(500, 67)],
      scenario
    )
    expect(schedule.events.slice(0, 3).map((e) => (e.event as { note: number }).note)).toEqual([
      64, 60, 67,
    ])
  })
})

describe('nothing is left sounding', () => {
  it('releases a note the source never released', () => {
    // A take truncated by a crash: the note-on is written, the note-off never was.
    const schedule = scheduleFromEvents([on(0, 60), off(400, 60), on(800, 67)], scenario)

    const last = schedule.events[schedule.events.length - 1]
    expect(last?.event).toMatchObject({ kind: 'noteOff', note: 67, ch: 0 })
    expect(last?.at).toBe(800 + TRUNCATED_TAIL_MS)
    expect(schedule.durationMs).toBe(800 + TRUNCATED_TAIL_MS)
    expect(outstandingAtEnd(schedule).notes).toEqual([])
  })

  it('releases every open note, on every channel, lowest first', () => {
    const schedule = scheduleFromEvents([on(0, 67), on(0, 60, 1), on(0, 64)], scenario)
    const tail = schedule.events.slice(3).map((e) => e.event)
    expect(tail).toEqual([
      { kind: 'noteOff', t: TRUNCATED_TAIL_MS, ch: 0, note: 64, velocity: 0 },
      { kind: 'noteOff', t: TRUNCATED_TAIL_MS, ch: 0, note: 67, velocity: 0 },
      { kind: 'noteOff', t: TRUNCATED_TAIL_MS, ch: 1, note: 60, velocity: 0 },
    ])
  })

  it('lifts a pedal left down, because a note-off under it does not stop the sound', () => {
    const schedule = scheduleFromEvents([pedal(0, true), on(0, 60), off(400, 60)], scenario)
    const last = schedule.events[schedule.events.length - 1]
    expect(last?.event).toMatchObject({ kind: 'cc', controller: CC_SUSTAIN, value: 0 })
    expect(outstandingAtEnd(schedule).pedals).toEqual([])
  })

  it('closes the notes before it lifts the pedal that was holding them', () => {
    const schedule = scheduleFromEvents([pedal(0, true), on(0, 60)], scenario)
    expect(schedule.events.slice(2).map((e) => e.event.kind)).toEqual(['noteOff', 'cc'])
  })

  it('adds no tail to a schedule that already ends silent', () => {
    const events = [on(0, 60), off(400, 60)]
    const schedule = scheduleFromEvents(events, scenario)
    expect(schedule.events).toHaveLength(2)
    expect(schedule.durationMs).toBe(400)
  })

  it('is not fooled by a note-off for a note that was never struck', () => {
    const schedule = scheduleFromEvents([off(0, 60), on(100, 62), off(200, 62)], scenario)
    expect(outstandingAtEnd(schedule).notes).toEqual([])
    expect(schedule.events).toHaveLength(3)
  })
})

describe('every generated passage produces a silent ending', () => {
  const ids = [
    'virtual:c-major-scale',
    'virtual:ii-V-I-in-F',
    'virtual:a-minor-arpeggios',
    'virtual:dense-2000',
  ]

  for (const id of ids) {
    it(`${id} leaves nothing sounding and nothing pedalled`, () => {
      const generator = findScenarioById(id)
      expect(generator).toBeDefined()
      const schedule = scheduleFromEvents(generator?.generate() ?? [], { kind: 'scenario', id })

      expect(schedule.events.length).toBeGreaterThan(0)
      expect(outstandingAtEnd(schedule)).toEqual({ notes: [], pedals: [] })
      expect(schedule.events.map((e) => e.at)).toEqual(
        [...schedule.events.map((e) => e.at)].sort((a, b) => a - b)
      )
    })
  }

  it('plays the scale up two octaves and back down', () => {
    const generator = findScenarioById('virtual:c-major-scale')
    const schedule = scheduleFromEvents(generator?.generate() ?? [], {
      kind: 'scenario',
      id: 'virtual:c-major-scale',
    })
    const struck = schedule.events
      .filter((e) => e.event.kind === 'noteOn')
      .map((e) => (e.event as { note: number }).note)

    expect(struck).toHaveLength(29)
    expect(struck[0]).toBe(60)
    expect(Math.max(...struck)).toBe(84)
    expect(struck[struck.length - 1]).toBe(60)
  })
})

describe('bars', () => {
  it('carries none for a source that has no bars', () => {
    expect(scheduleFromEvents([on(0, 60), off(100, 60)], scenario).bars).toEqual([])
  })

  it('keeps the bars it was given through the normaliser', () => {
    const schedule = normaliseSchedule(
      [{ at: 0, event: on(0, 60) }],
      { kind: 'timeline', fromBar: 1, toBar: 2, bpm: 80 },
      {
        bars: [
          { bar: 1, at: 0 },
          { bar: 2, at: 750 },
        ],
      }
    )
    expect(schedule.bars).toEqual([
      { bar: 1, at: 0 },
      { bar: 2, at: 750 },
    ])
  })
})

describe('the fixture is a timeline the app could have extracted', () => {
  it('has a well-formed bar table and notes that sit in their bars', () => {
    expect(barTableProblems(sampler)).toEqual([])
    expect(noteBarProblems(sampler)).toEqual([])
  })
})

describe('quarter notes become milliseconds', () => {
  it('lasts four seconds over two bars of 4/4 at 120 bpm', () => {
    // Bars 3 and 4 are eight quarters, and a quarter at 120 bpm is 500 ms.
    const schedule = scheduleFromTimeline(sampler, { bpm: 120, fromBar: 3, toBar: 4 })
    expect(schedule.durationMs).toBe(4000)

    // The last note-off sits a release gap inside the barline, by the rule
    // that keeps a repeated note from merging into its neighbour: the final
    // chord is written to 4000 ms and is let go at 3970.
    const last = schedule.events[schedule.events.length - 1]
    expect(last?.at).toBe(4000 - RELEASE_GAP_MS)
  })

  it('doubles every onset when the tempo halves', () => {
    const fast = scheduleFromTimeline(sampler, { bpm: 120 })
    const slow = scheduleFromTimeline(sampler, { bpm: 60 })

    expect(slow.events).toHaveLength(fast.events.length)
    expect(slow.durationMs).toBe(fast.durationMs * 2)
    for (const [index, event] of struck(slow).entries()) {
      // Not "about twice": 60000/60 and 60000/120 are exact, and a rounding
      // step anywhere in the conversion would show up here first.
      expect(event.at).toBe((struck(fast)[index]?.at ?? NaN) * 2)
    }
  })

  it('takes the same absolute gap off a note however slow the tempo is', () => {
    // The note-offs are the one thing that does not simply double, and it is
    // deliberate: the gap is 30 ms of wall clock rather than a fraction of a
    // beat. C3 in bar 1 is written for four quarters, so it sounds 2000 ms at
    // 120 bpm and 4000 at 60, each released the same 30 ms early.
    const fast = scheduleFromTimeline(sampler, { bpm: 120, fromBar: 1, toBar: 1 })
    const slow = scheduleFromTimeline(sampler, { bpm: 60, fromBar: 1, toBar: 1 })
    expect(soundingFor(fast, 48)).toBe(2000 - RELEASE_GAP_MS)
    expect(soundingFor(slow, 48)).toBe(4000 - RELEASE_GAP_MS)
  })

  it('takes the tempo the player set, and nothing from the score', () => {
    const written = scheduleFromTimeline(sampler)
    expect(written.source).toMatchObject({ kind: 'timeline', bpm: DEFAULT_BPM })
    // 17 quarters at 80 bpm.
    expect(written.durationMs).toBeCloseTo((17 * 60000) / DEFAULT_BPM, 6)
  })

  it('clamps a tempo outside the range the transport offers', () => {
    expect(scheduleFromTimeline(sampler, { bpm: 5 }).source).toMatchObject({ bpm: MIN_BPM })
    expect(scheduleFromTimeline(sampler, { bpm: 5000 }).source).toMatchObject({ bpm: MAX_BPM })
  })

  it('strikes every note at one velocity, the score having no dynamics', () => {
    const velocities = new Set(
      struck(scheduleFromTimeline(sampler)).map((e) => (e.event as { velocity: number }).velocity)
    )
    expect([...velocities]).toEqual([PLAYBACK_VELOCITY])
  })
})

describe('the shapes a score makes', () => {
  it('strikes a chord as one instant', () => {
    const schedule = scheduleFromTimeline(sampler, { bpm: 120, fromBar: 1, toBar: 1 })
    // Bar 1 opens with C3 under a C-E-G chord: four notes, one onset.
    const together = struck(schedule).filter((e) => e.at === 0)
    expect(together.map((e) => (e.event as { note: number }).note).sort((a, b) => a - b)).toEqual([
      48, 60, 64, 67,
    ])
  })

  it('strikes a tied note once and holds it across the barline', () => {
    const schedule = scheduleFromTimeline(sampler, { bpm: 120, fromBar: 2, toBar: 3 })
    const tied = sampler.notes.find((note) => note.tied)
    expect(tied).toMatchObject({ midi: 79, onset: 8, duration: 2, bar: 2 })

    const ons = struck(schedule).filter((e) => (e.event as { note: number }).note === 79)
    const offs = released(schedule).filter((e) => (e.event as { note: number }).note === 79)
    expect(ons).toHaveLength(1)
    expect(offs).toHaveLength(1)

    // Struck three quarters into the range and held for two, which carries it
    // one quarter past the barline eight quarters into the range.
    expect(ons[0]?.at).toBe(1500)
    expect(offs[0]?.at).toBe(1500 + 1000 - RELEASE_GAP_MS)
    expect(offs[0]?.at).toBeGreaterThan(schedule.bars[1]?.at ?? Infinity)
  })

  it('gives an ornament a length the score does not state', () => {
    const schedule = scheduleFromTimeline(sampler, { bpm: 120, fromBar: 2, toBar: 2 })
    const grace = struck(schedule).find((e) => (e.event as { note: number }).note === 59)
    const release = released(schedule).find((e) => (e.event as { note: number }).note === 59)
    expect(grace?.at).toBe(0)
    expect((release?.at ?? 0) - (grace?.at ?? 0)).toBe(
      GRACE_NOTE_MS - Math.min(RELEASE_GAP_MS, 0.2 * GRACE_NOTE_MS)
    )
  })

  it('releases a note before the same key is struck again', () => {
    const schedule = scheduleFromTimeline(sampler, { bpm: MAX_BPM })
    for (const note of new Set(sampler.notes.map((n) => n.midi))) {
      const times = schedule.events
        .filter((e) => 'note' in e.event && e.event.note === note)
        .map((e) => ({ at: e.at, kind: e.event.kind }))
      let sounding = false
      for (const event of times) {
        if (event.kind === 'noteOn') {
          expect(sounding, `note ${note} was struck twice without a release`).toBe(false)
          sounding = true
        }
        if (event.kind === 'noteOff') sounding = false
      }
    }
  })
})

describe('an ornament plays its realisation, not the note under it (ADR-0018)', () => {
  const at120 = scheduleFromTimeline(ornaments, { bpm: 120 })

  it('strikes the turn as B4 A4 G4 A4 at the realised times, and holds no A4 across it', () => {
    // Bar 1 at 120 bpm: the turn's principal is written on beat 2, 500 ms in.
    const schedule = scheduleFromTimeline(ornaments, { bpm: 120, fromBar: 1, toBar: 1 })
    const turn = struck(schedule)
      .filter((e) => e.at >= 500 && e.at < 1000)
      .map((e) => [(e.event as { note: number }).note, e.at])
    expect(turn).toEqual([
      [71, 500],
      [69, 625],
      [67, 750],
      [69, 875],
    ])

    // Each A4 is released within its own sixteenth, never held for the beat.
    const a4 = schedule.events.filter(
      (e) => 'note' in e.event && e.event.note === 69 && e.at >= 500 && e.at < 1000
    )
    expect(a4.map((e) => e.event.kind)).toEqual(['noteOn', 'noteOff', 'noteOn', 'noteOff'])
    expect(soundingFor(schedule, 69)).toBeLessThan(125)
  })

  it('never strikes the principal at its written length', () => {
    const principals = ornaments.notes.filter((n) => !n.optional && n.ornament !== null)
    const written = ornaments.notes.filter((n) => n.optional || n.ornament === null)
    expect(struck(at120)).toHaveLength(written.length)
    for (const principal of principals) {
      const onsetMs = principal.onset * 500
      const heldForBeat = struck(at120).some((on) => {
        if (on.at !== onsetMs || (on.event as { note: number }).note !== principal.midi) return false
        const release = released(at120).find(
          (e) => e.at > on.at && (e.event as { note: number }).note === principal.midi
        )
        return (release?.at ?? 0) - on.at > (principal.duration * 500) / 2
      })
      expect(heldForBeat, principal.ornament ?? '').toBe(false)
    }
  })

  it('plays each realised note for its own length, not a grace note length', () => {
    const trillStep = struck(at120).filter((e) => e.at >= 2000 && e.at < 2500)
    expect(trillStep).toHaveLength(8)
    expect(trillStep.map((e) => e.at)).toEqual([2000, 2062.5, 2125, 2187.5, 2250, 2312.5, 2375, 2437.5])
  })

  it('strikes no pitch while it is still sounding, at any tempo', () => {
    for (const bpm of [MIN_BPM, DEFAULT_BPM, MAX_BPM]) {
      const schedule = scheduleFromTimeline(ornaments, { bpm })
      const sounding = new Set<number>()
      for (const { event } of schedule.events) {
        if (event.kind === 'noteOn') {
          expect(sounding.has(event.note), `${event.note} restruck at ${bpm} bpm`).toBe(false)
          sounding.add(event.note)
        } else if (event.kind === 'noteOff') {
          sounding.delete(event.note)
        }
      }
    }
  })

  it('stays ordered and balanced', () => {
    for (const bpm of [MIN_BPM, DEFAULT_BPM, MAX_BPM]) {
      const schedule = scheduleFromTimeline(ornaments, { bpm })
      expect(outstandingAtEnd(schedule)).toEqual({ notes: [], pedals: [] })
      expect(schedule.events.map((e) => e.at)).toEqual(
        [...schedule.events.map((e) => e.at)].sort((a, b) => a - b)
      )
      expect(struck(schedule)).toHaveLength(released(schedule).length)
    }
  })
})

describe('the pedal goes down where the page says (ADR-0018)', () => {
  /** Every CC 64 in a schedule, as [at, value], in schedule order. */
  const sustainAt = (schedule: PlaybackSchedule) =>
    schedule.events
      .filter((e) => e.event.kind === 'cc' && e.event.controller === CC_SUSTAIN)
      .map((e) => [e.at, (e.event as { value: number }).value])

  it('presses at the marked beat, changes, and lifts at the release', () => {
    // 120 bpm is 500 ms a quarter: down on quarter 4, a change on 6, up on 10.
    expect(sustainAt(scheduleFromTimeline(pedalled, { bpm: 120 }))).toEqual([
      [2000, 127],
      [3000, 0],
      [3000, 127],
      [5000, 0],
    ])
  })

  it('orders the pedal after the release and before the strike at one instant', () => {
    const schedule = scheduleFromTimeline(pedalled, { bpm: 120 })
    const atChange = schedule.events
      .filter((e) => e.at === 3000)
      .map((e) =>
        e.event.kind === 'cc' ? `cc${(e.event as { value: number }).value}` : e.event.kind
      )
    // Nothing is released exactly at 3000 (the gap is taken first), so the
    // lift and the press lead, and B4 is struck into the fresh pedal.
    expect(atChange).toEqual(['cc0', 'cc127', 'noteOn'])
    const press = schedule.events.findIndex((e) => e.at === 2000 && e.event.kind === 'cc')
    const g4 = schedule.events.findIndex((e) => e.at === 2000 && e.event.kind === 'noteOn')
    expect(press).toBeLessThan(g4)
  })

  it('presses at the start of a range that begins under a held pedal', () => {
    // Bar 2 begins on quarter 8, inside the span the change at 6 opened.
    const schedule = scheduleFromTimeline(pedalled, { bpm: 120, fromBar: 2, toBar: 2 })
    expect(sustainAt(schedule)).toEqual([
      [0, 127],
      [1000, 0],
    ])
    expect(schedule.events[0]?.event.kind).toBe('cc')
  })

  it('sends nothing for a range the pedal never reaches, and lifts one it leaves down', () => {
    expect(sustainAt(scheduleFromTimeline(pedalled, { bpm: 120, fromBar: 0, toBar: 0 }))).toEqual([])

    // Bars 1 alone: down at 4, changed at 6, still down at the range's end.
    const held = scheduleFromTimeline(pedalled, { bpm: 120, fromBar: 1, toBar: 1 })
    expect(outstandingAtEnd(held)).toEqual({ notes: [], pedals: [] })
    expect(sustainAt(held).at(-1)?.[1]).toBe(0)
  })

  it('sends no CC 64 at all for a score with no pedal marks', () => {
    expect(sustainAt(scheduleFromTimeline(sampler, { bpm: 120 }))).toEqual([])
  })

  it('stays ordered and balanced over every range', () => {
    for (const [fromBar, toBar] of [
      [0, 3],
      [1, 1],
      [1, 2],
      [2, 3],
      [3, 3],
    ] as const) {
      const schedule = scheduleFromTimeline(pedalled, { bpm: 120, fromBar, toBar })
      expect(outstandingAtEnd(schedule)).toEqual({ notes: [], pedals: [] })
      expect(schedule.events.map((e) => e.at)).toEqual(
        [...schedule.events.map((e) => e.at)].sort((a, b) => a - b)
      )
    }
  })
})

describe('the music gets louder and softer where the page says (ADR-0018)', () => {
  /** Note-on velocities for one staff, in onset order, as [midi, velocity]. */
  function velocities(timeline: ExpectedTimeline, staff: number): [number, number][] {
    const onStaff = new Set(timeline.notes.filter((n) => n.staff === staff).map((n) => n.onset))
    return struck(scheduleFromTimeline(timeline, { bpm: 120 }))
      .filter((e) => onStaff.has(e.at / 500) && staffOf(timeline, e) === staff)
      .map((e) => [(e.event as { note: number }).note, (e.event as { velocity: number }).velocity])
  }

  function staffOf(timeline: ExpectedTimeline, e: { at: number; event: MidiEvent }): number {
    const note = (e.event as { note: number }).note
    return timeline.notes.find((n) => n.midi === note && n.onset === e.at / 500)?.staff ?? -1
  }

  it('plays a note under ff louder than one under pp', () => {
    const right = velocities(dynamics, 0)
    const underPp = right[0]?.[1] ?? 0
    const underFf = right[8]?.[1] ?? 0
    expect(underPp).toBeLessThan(underFf)
    // OSMD's own MidiVolume for each mark, carried through untouched.
    expect(right.slice(0, 4).map(([, v]) => v)).toEqual([12, 12, 12, 12])
    expect(right.slice(8, 12).map(([, v]) => v)).toEqual([122, 122, 122, 122])
    expect(right[12]?.[1]).toBe(28)
  })

  it('rises through a written crescendo, note by note', () => {
    // Bar 2: from pp's 12 towards ff's 122, strictly increasing.
    const cresc = velocities(dynamics, 0).slice(4, 8).map(([, v]) => v)
    for (let k = 1; k < cresc.length; k++) {
      expect(cresc[k] ?? 0).toBeGreaterThan(cresc[k - 1] ?? 0)
    }
    expect(cresc[0]).toBe(12)
    expect(cresc.at(-1) ?? 0).toBeLessThan(122)
  })

  it('keeps each staff to its own marks', () => {
    // The left hand's mf is its own; the right hand's levels do not move for it.
    expect(velocities(dynamics, 1).map(([, v]) => v)).toEqual([76, 76, 76, 76])
    const withoutLeftMarks: ExpectedTimeline = {
      ...dynamics,
      dynamics: dynamics.dynamics.filter((mark) => mark.staff !== 1),
    }
    expect(velocities(withoutLeftMarks, 0)).toEqual(velocities(dynamics, 0))
    // And a staff the page marks nothing on plays at the fallback.
    expect(velocities(withoutLeftMarks, 1).map(([, v]) => v)).toEqual([72, 72, 72, 72])
  })

  it('plays every note at the fallback for a score with no dynamics, as before', () => {
    const schedule = scheduleFromTimeline(sampler, { bpm: 120 })
    expect(struck(schedule).every((e) => (e.event as { velocity: number }).velocity === 72)).toBe(
      true
    )
    expect(PLAYBACK_VELOCITY).toBe(72)
  })

  it('lets an explicit velocity override the page', () => {
    const schedule = scheduleFromTimeline(dynamics, { bpm: 120, velocity: 90 })
    expect(struck(schedule).every((e) => (e.event as { velocity: number }).velocity === 90)).toBe(
      true
    )
  })
})

describe('a range of bars', () => {
  it('plays only the bars asked for, from at zero', () => {
    const schedule = scheduleFromTimeline(sampler, { bpm: 120, fromBar: 2, toBar: 3 })

    const expected = sampler.notes.filter((note) => note.bar === 2 || note.bar === 3)
    expect(struck(schedule)).toHaveLength(expected.length)

    const notes = new Set(struck(schedule).map((e) => (e.event as { note: number }).note))
    expect([...notes].sort((a, b) => a - b)).toEqual(
      [...new Set(expected.map((n) => n.midi))].sort((a, b) => a - b)
    )

    expect(schedule.events[0]?.at).toBe(0)
    expect(schedule.source).toMatchObject({ kind: 'timeline', fromBar: 2, toBar: 3 })
  })

  it('opens at the barline, not at the first note, when a bar begins with a rest', () => {
    // Bar 3 rests through its first beat while bar 2's tie is still sounding.
    const schedule = scheduleFromTimeline(sampler, { bpm: 120, fromBar: 3, toBar: 4 })
    expect(sampler.notes.filter((n) => n.bar === 3).map((n) => n.onset)).not.toContain(9)
    expect(struck(schedule)[0]?.at).toBe(500)
    expect(schedule.bars[0]).toEqual({ bar: 3, at: 0 })
  })

  it('marks where each bar of the range starts', () => {
    const schedule = scheduleFromTimeline(sampler, { bpm: 120, fromBar: 1, toBar: 4 })
    expect(schedule.bars).toEqual([
      { bar: 1, at: 0 },
      { bar: 2, at: 2000 },
      { bar: 3, at: 4000 },
      { bar: 4, at: 6000 },
    ])
  })

  it('plays the whole piece, anacrusis included, when no range is asked for', () => {
    const schedule = scheduleFromTimeline(sampler, { bpm: 120 })
    expect(schedule.bars[0]).toEqual({ bar: 0, at: 0 })
    expect(struck(schedule)).toHaveLength(sampler.notes.length)
    expect(schedule.source).toMatchObject({ fromBar: 0, toBar: 4 })
  })

  it('is empty for a range with no bars in it', () => {
    const schedule = scheduleFromTimeline(sampler, { fromBar: 40, toBar: 50 })
    expect(schedule.events).toEqual([])
    expect(schedule.durationMs).toBe(0)
  })

  it('lets a tie ring past the end of the range rather than cutting it in half', () => {
    const schedule = scheduleFromTimeline(sampler, { bpm: 120, fromBar: 1, toBar: 2 })
    const offs = released(schedule).filter((e) => (e.event as { note: number }).note === 79)
    // Bars 1 and 2 are eight quarters; the tie is struck at seven and held for
    // two, so it finishes after the written end and the duration covers it.
    expect(offs[0]?.at).toBeGreaterThan(4000)
    expect(schedule.durationMs).toBeGreaterThanOrEqual(offs[0]?.at ?? 0)
  })
})

describe('every schedule the suite builds ends silent', () => {
  const ranges: [number, number][] = [
    [0, 4],
    [0, 0],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 4],
  ]

  for (const bpm of [MIN_BPM, 60, DEFAULT_BPM, 120, MAX_BPM]) {
    for (const [fromBar, toBar] of ranges) {
      it(`bars ${fromBar} to ${toBar} at ${bpm} bpm`, () => {
        const schedule = scheduleFromTimeline(sampler, { bpm, fromBar, toBar })
        expect(outstandingAtEnd(schedule)).toEqual({ notes: [], pedals: [] })
        expect(schedule.events.map((e) => e.at)).toEqual(
          [...schedule.events.map((e) => e.at)].sort((a, b) => a - b)
        )
      })
    }
  }
})

describe('a take can be played faster or slower than it was recorded', () => {
  it('scales every interval by one over the speed', () => {
    const events = [on(0, 60), off(400, 60), on(800, 62), off(1200, 62)]
    const half = scheduleFromEvents(events, { kind: 'take', takeId: 't', speed: 0.5 }, 0.5)
    expect(half.events.map((e) => e.at)).toEqual([0, 800, 1600, 2400])
  })
})
