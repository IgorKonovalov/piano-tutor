import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { ExpectedTimelineSchema, type ExpectedTimeline } from '../../shared/score'
import { canonicalTimeline, roundQuarters } from '../../core/src/score/timeline'
import { RAMP_WORDS, normaliseTempoWord, timelineFromOsmd } from './timelineFromOsmd'

/**
 * The adapter against the committed timelines, headless.
 *
 * ADR-0005 calls this the least-tested link in the chain because it is
 * renderer code that needs a DOM, and names the end-to-end fixture comparison
 * as its check. That check stands and is the one that drives the real app --
 * but it only runs in `npm run test:e2e`, which the pre-push hook deliberately
 * skips, so an OSMD upgrade could reach a push unchallenged. OSMD's *parse* is
 * DOM-light enough to run under jsdom (its layout is not, and is not needed
 * here: a timeline comes from the parsed model, never from the drawn one), so
 * the same comparison also runs at every `npm test`.
 */

const scores = import.meta.glob('../../core/fixtures/scores/*.musicxml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const committed = import.meta.glob('../../core/fixtures/scores/*.timeline.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function nameOf(path: string): string {
  return path.split('/').pop()?.replace(/\.(musicxml|timeline\.json)$/, '') ?? path
}

const CASES = Object.entries(scores).map(([path, xml]) => {
  const name = nameOf(path)
  const entry = Object.entries(committed).find(([other]) => nameOf(other) === name)
  if (entry === undefined) {
    throw new Error(`${name}.timeline.json is missing; see scripts/regen-score-timelines.md`)
  }
  return { name, xml, expected: entry[1] }
})

let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  host.remove()
})

it('has a committed timeline for every fixture score', () => {
  expect(CASES.map((c) => c.name).sort()).toEqual([
    'articulation',
    'dynamics',
    'empty-carrier-bar',
    'grace-note',
    'key-and-time-change',
    'multi-rest-and-ties',
    'ornaments',
    'pedal',
    'pickup-two-hands',
    'scale-c-major',
    'tempo-changes',
  ])
})

describe('ornaments, realised by OSMD and captured as they are built (ADR-0018)', () => {
  const ornaments = CASES.find((c) => c.name === 'ornaments')
  if (ornaments === undefined) throw new Error('the ornaments fixture is missing')

  async function extract(): Promise<{ timeline: ExpectedTimeline; osmd: OpenSheetMusicDisplay }> {
    const scoreId = ExpectedTimelineSchema.parse(JSON.parse(ornaments?.expected ?? '')).scoreId
    const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' })
    await osmd.load(ornaments?.xml ?? '')
    return { timeline: timelineFromOsmd(osmd.Sheet, scoreId), osmd }
  }

  const principals = (timeline: ExpectedTimeline) =>
    timeline.notes.filter((note) => !note.optional && note.ornament !== null)

  /** The realisation of the principal at `onset`, relative to that onset. */
  function realisationAt(timeline: ExpectedTimeline, onset: number) {
    return timeline.notes
      .filter((note) => note.optional && note.onset >= onset && note.onset < onset + 1)
      .map((note) => ({ midi: note.midi, at: note.onset - onset, length: note.duration }))
  }

  it('marks the principal, its realisation and nothing else', async () => {
    const { timeline } = await extract()

    expect(principals(timeline).map((note) => [note.midi, note.ornament])).toEqual([
      [67, 'trill'],
      [69, 'turn'],
      [71, 'mordent'],
      [72, 'invertedTurn'],
      [74, 'delayedTurn'],
      [76, 'delayedInvertedTurn'],
      [77, 'invertedMordent'],
    ])
    for (const note of timeline.notes) {
      if (note.optional) expect(note.ornament).not.toBeNull()
    }
    // Every other note is plain: one per written notehead, and no stray copy
    // of a principal left behind by the realiser.
    const plain = timeline.notes.filter((note) => !note.optional && note.ornament === null)
    expect(plain.map((note) => note.onset)).toEqual([0, 1, 2, 3, 7, 12, 13, 14])
    expect(principals(timeline).every((note) => note.duration === 1)).toBe(true)
  })

  it('realises the trill, the turn and the mordent as OSMD intends', async () => {
    const { timeline } = await extract()

    expect(realisationAt(timeline, 4)).toEqual(
      Array.from({ length: 8 }, (_, k) => ({
        midi: k % 2 === 0 ? 67 : 70,
        at: k * 0.125,
        length: 0.125,
      }))
    )
    expect(realisationAt(timeline, 5)).toEqual([
      { midi: 71, at: 0, length: 0.25 },
      { midi: 69, at: 0.25, length: 0.25 },
      { midi: 67, at: 0.5, length: 0.25 },
      { midi: 69, at: 0.75, length: 0.25 },
    ])
    expect(realisationAt(timeline, 6)).toEqual([
      { midi: 71, at: 0, length: 0.25 },
      { midi: 72, at: 0.25, length: 0.25 },
      { midi: 71, at: 0.5, length: 0.5 },
    ])
  })

  it('tiles every principal exactly, all seven kinds, from its onset to its end', async () => {
    // The property the capture exists for. OSMD's returned entries alias one
    // timestamp across a turn and one length across a mordent or delayed turn,
    // so read back from them no realisation but the trill would tile.
    const { timeline } = await extract()

    for (const principal of principals(timeline)) {
      const realised = realisationAt(timeline, principal.onset)
      expect(realised.length, principal.ornament ?? '').toBeGreaterThan(2)
      let reached = 0
      for (const note of realised) {
        expect(note.at, principal.ornament ?? '').toBe(reached)
        reached = roundQuarters(reached + note.length)
      }
      expect(reached, principal.ornament ?? '').toBe(principal.duration)
      expect(
        timeline.notes.filter((note) => note.optional && note.onset === principal.onset)
          .every((note) => note.ornament === principal.ornament)
      ).toBe(true)
    }
  })

  it('sounds the trill above-accidental and not the mordent below-accidental', async () => {
    // OSMD 2.1.2 behaviour, asserted as the library's: its realiser reads
    // AccidentalAbove for a trill only, and never reads AccidentalBelow.
    const { timeline } = await extract()
    expect(realisationAt(timeline, 4).map((note) => note.midi)).toContain(70)
    expect(realisationAt(timeline, 4).map((note) => note.midi)).not.toContain(69)
    expect(realisationAt(timeline, 6).map((note) => note.midi)).toEqual([71, 72, 71])
  })

  it('leaves the model as it was parsed, so extracting twice agrees', async () => {
    const { timeline, osmd } = await extract()
    const entriesPerStaffEntry = () =>
      osmd.Sheet.SourceMeasures.flatMap((measure) =>
        measure.VerticalSourceStaffEntryContainers.flatMap((container) =>
          container.StaffEntries.map((entry) => entry?.VoiceEntries.length ?? 0)
        )
      )
    const before = entriesPerStaffEntry()
    expect(before.every((count) => count === 1)).toBe(true)

    const again = timelineFromOsmd(osmd.Sheet, timeline.scoreId)
    expect(canonicalTimeline(again)).toBe(canonicalTimeline(timeline))
    expect(entriesPerStaffEntry()).toEqual(before)
  })
})

describe('pedal marks, read off the staff-linked expressions (ADR-0018)', () => {
  it('holds a press at the marked beat, a change as lift-then-press, and the release', async () => {
    const fixture = CASES.find((c) => c.name === 'pedal')
    if (fixture === undefined) throw new Error('the pedal fixture is missing')
    const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' })
    await osmd.load(fixture.xml)

    const timeline = timelineFromOsmd(osmd.Sheet, '0'.repeat(32))
    expect(timeline.pedal).toEqual([
      { at: 4, down: true, staff: 0 },
      { at: 6, down: false, staff: 0 },
      { at: 6, down: true, staff: 0 },
      { at: 10, down: false, staff: 0 },
    ])
  })

  it('is empty for a score that marks no pedal', () => {
    for (const { name, expected } of CASES) {
      if (name === 'pedal') continue
      expect(ExpectedTimelineSchema.parse(JSON.parse(expected)).pedal, name).toEqual([])
    }
  })
})

describe('dynamics, read off the same expressions (ADR-0018)', () => {
  it('holds the step marks and the hairpin, with the hairpin running to its written target', async () => {
    const fixture = CASES.find((c) => c.name === 'dynamics')
    if (fixture === undefined) throw new Error('the dynamics fixture is missing')
    const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' })
    await osmd.load(fixture.xml)

    const step = (at: number, velocity: number, label: string, staff: number) => ({
      at,
      velocity,
      label,
      staff,
      until: null,
      endVelocity: null,
    })
    // Every velocity is OSMD's MidiVolume for its mark: pp 12, mf 76, ff 122,
    // p 28. The crescendo's ends are the pp in force and the ff it ends on.
    expect(timelineFromOsmd(osmd.Sheet, '0'.repeat(32)).dynamics).toEqual([
      step(0, 12, 'pp', 0),
      step(0, 76, 'mf', 1),
      { at: 4, velocity: 12, label: 'crescendo', staff: 0, until: 8, endVelocity: 122 },
      step(8, 122, 'ff', 0),
      step(12, 28, 'p', 0),
    ])
  })

  it('is empty for every score that marks no dynamic', () => {
    for (const { name, expected } of CASES) {
      // The articulation fixture is marked mf so an accent has a level to rise above.
      if (name === 'dynamics' || name === 'articulation') continue
      expect(ExpectedTimelineSchema.parse(JSON.parse(expected)).dynamics, name).toEqual([])
    }
  })
})

describe('articulation, read off the voice entry (ADR-0018)', () => {
  it('holds the keyboard marks on the note they are written on', async () => {
    const fixture = CASES.find((c) => c.name === 'articulation')
    if (fixture === undefined) throw new Error('the articulation fixture is missing')
    const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' })
    await osmd.load(fixture.xml)

    const timeline = timelineFromOsmd(osmd.Sheet, '0'.repeat(32))
    // OSMD 2.1.2 behaviour, asserted as the library's: `<strong-accent
    // type="up">` reads as marcatoUp, and `<detached-legato/>` (B4, 71) is
    // not read by its MusicXML reader at all, so it arrives unmarked.
    const dry = ['staccatissimo'] as const
    expect(timeline.notes.map((note) => [note.midi, note.articulation])).toEqual([
      [60, []],
      [62, ['staccato']],
      [64, ['tenuto']],
      [65, ['accent']],
      [67, ['staccatissimo']],
      [69, ['marcatoUp']],
      [71, []],
      [72, []],
      [72, dry],
      [74, dry],
      [76, dry],
      [77, dry],
      [79, []],
    ])
  })

  it('is empty on every note of every score that marks none', () => {
    for (const { name, expected } of CASES) {
      if (name === 'articulation') continue
      const timeline = ExpectedTimelineSchema.parse(JSON.parse(expected))
      expect(timeline.notes.every((note) => note.articulation.length === 0), name).toBe(true)
    }
  })
})

describe('tempo marks, read by what the page wrote (ADR-0018)', () => {
  const fixture = CASES.find((c) => c.name === 'tempo-changes')
  if (fixture === undefined) throw new Error('the tempo-changes fixture is missing')

  async function load(): Promise<OpenSheetMusicDisplay> {
    const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' })
    await osmd.load(fixture?.xml ?? '')
    return osmd
  }

  it('holds the metronome mark, both ramps and both returns, and one fermata', async () => {
    const timeline = timelineFromOsmd((await load()).Sheet, '0'.repeat(32))
    expect(timeline.tempo).toEqual([
      { at: 0, kind: 'metronome', bpm: 120, label: 'quarter = 120' },
      { at: 4, kind: 'ramp', direction: 'slower', until: 8, label: 'rit.' },
      { at: 8, kind: 'return', to: 'previous', label: 'a tempo' },
      { at: 12, kind: 'ramp', direction: 'faster', until: 16, label: 'accel.' },
      { at: 16, kind: 'return', to: 'previous', label: 'a tempo' },
    ])
    expect(timeline.notes.filter((note) => note.fermata).map((n) => [n.midi, n.onset])).toEqual([
      [74, 16],
    ])
  })

  it('reads a ramp word only where OSMD itself lists it, going the same way', async () => {
    // The table is a filter over OSMD's classification, not a classifier of
    // ours: every word in it must sit in OSMD's own list for its direction.
    const osmd = await load()
    const gradual = osmd.Sheet.SourceMeasures.flatMap((m) => m.TempoExpressions)
      .map((expression) => expression.ContinuousTempo)
      .find((tempo) => tempo !== undefined && tempo !== null)
    expect(gradual).toBeDefined()
    const lists = gradual?.constructor as unknown as {
      listContinuousTempoSlower: string[]
      listContinuousTempoFaster: string[]
    }
    const slower = lists.listContinuousTempoSlower.map(normaliseTempoWord)
    const faster = lists.listContinuousTempoFaster.map(normaliseTempoWord)
    expect(slower.length).toBeGreaterThan(0)
    expect(faster.length).toBeGreaterThan(0)

    for (const [word, direction] of RAMP_WORDS) {
      expect(direction === 'slower' ? slower : faster, word).toContain(word)
      expect(direction === 'slower' ? faster : slower, word).not.toContain(word)
    }
  })

  it('is empty, with no fermata, for every score that marks no tempo', () => {
    for (const { name, expected } of CASES) {
      if (name === 'tempo-changes') continue
      const timeline = ExpectedTimelineSchema.parse(JSON.parse(expected))
      expect(timeline.tempo, name).toEqual([])
      expect(timeline.notes.some((note) => note.fermata), name).toBe(false)
    }
  })
})

describe.each(CASES)('$name', ({ xml, expected }) => {
  it('extracts the committed timeline, byte for byte', async () => {
    const parsed = ExpectedTimelineSchema.parse(JSON.parse(expected))
    const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' })
    await osmd.load(xml)

    // The score id is the hash of the file's bytes, which main computes at
    // import; here it comes from the fixture, so what is compared is the music
    // rather than the hashing.
    const extracted = timelineFromOsmd(osmd.Sheet, parsed.scoreId)

    expect(canonicalTimeline(extracted)).toBe(expected)
  })
})
