import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ExpectedTimelineSchema, type ExpectedTimeline } from '../../shared/score'
import { practiceReport } from '../../core/src/align/report'
import { perturb } from '../../core/src/midi/perturb'
import { timelineFromMidi } from '../../core/src/score/timelineFromMidi'
import scaleJson from '../../core/fixtures/scores/scale-c-major.timeline.json'
import { assertReadableMidi, describeMidi, isMidiExtension } from './midiImport'

/**
 * The two adapters, against the same music.
 *
 * `core/src/score/timelineFromMidi.test.ts` covers the arithmetic with files
 * built in memory. This one reads the committed `.mid` off disk, which `core/`
 * may not do, and asks the question the phase exists for: does a MIDI file and
 * a MusicXML file of the same piece produce the same timeline?
 */

const FIXTURES = fileURLToPath(new URL('../../core/fixtures/scores/', import.meta.url))
const SCALE_MID = join(FIXTURES, 'scale-c-major.mid')
const SCORE_ID = 'a'.repeat(32)

const fromMusicXml: ExpectedTimeline = ExpectedTimelineSchema.parse(scaleJson)

function readScaleMid(): Uint8Array {
  return new Uint8Array(readFileSync(SCALE_MID))
}

/** What the two adapters must agree about: which pitch, when, in which bar. */
function shape(timeline: ExpectedTimeline) {
  return timeline.notes.map((note) => ({ midi: note.midi, onset: note.onset, bar: note.bar }))
}

describe('isMidiExtension', () => {
  it('is true for the MIDI extensions and false for the engraved ones', () => {
    expect(isMidiExtension('.mid')).toBe(true)
    expect(isMidiExtension('.midi')).toBe(true)
    expect(isMidiExtension('.musicxml')).toBe(false)
    expect(isMidiExtension('.mxl')).toBe(false)
  })
})

describe('assertReadableMidi', () => {
  it('accepts the committed fixture', () => {
    expect(() => assertReadableMidi(readScaleMid(), 'scale-c-major.mid')).not.toThrow()
  })

  it('refuses a file that is not MIDI at all, naming the file', () => {
    const bytes = new TextEncoder().encode('this is not a MIDI file')
    expect(() => assertReadableMidi(bytes, 'pretend.mid')).toThrow(/pretend\.mid/)
  })

  it('refuses a MIDI file with no notes in it rather than importing an empty score', () => {
    // A valid, empty format-0 file: header chunk plus one empty track.
    const empty = new Uint8Array([
      0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,
      0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 4, 0x00, 0xff, 0x2f, 0x00,
    ])
    expect(() => assertReadableMidi(empty, 'silent.mid')).toThrow(/no notes/)
  })
})

describe('describeMidi', () => {
  it('counts what is in the file', () => {
    expect(describeMidi(readScaleMid())).toEqual({ notes: 15, tracks: 1 })
  })
})

describe('the committed .mid against the committed .musicxml', () => {
  const fromMidi = ExpectedTimelineSchema.parse(
    timelineFromMidi(readScaleMid(), { scoreId: SCORE_ID })
  )

  it('agrees pitch for pitch and bar for bar', () => {
    expect(shape(fromMidi)).toEqual(shape(fromMusicXml))
  })

  it('agrees about the bar grid', () => {
    expect(fromMidi.bars).toEqual(fromMusicXml.bars)
  })

  it('is the two-octave scale, fifteen notes in four bars', () => {
    expect(fromMidi.notes.map((note) => note.midi)).toEqual([
      60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84,
    ])
    expect(fromMidi.bars.map((bar) => bar.beats)).toEqual([4, 4, 4, 4])
  })

  it('claims nothing it cannot know: one staff, no ties, no grace notes', () => {
    expect(new Set(fromMidi.notes.map((note) => note.staff))).toEqual(new Set([0]))
    expect(fromMidi.notes.some((note) => note.tied)).toBe(false)
    expect(fromMidi.notes.some((note) => note.grace)).toBe(false)
  })
})

describe('a take of the MIDI timeline', () => {
  const timeline = timelineFromMidi(readScaleMid(), { scoreId: SCORE_ID })

  it('scores every bar clean when it is played correctly', () => {
    const take = perturb(timeline, { seed: 991 })
    const report = practiceReport({ timeline, events: take.events, takeId: 'from-midi' })

    expect(report.bars.map((bar) => bar.state)).toEqual(timeline.bars.map(() => 'clean'))
    expect(report.counts).toEqual({
      correct: timeline.notes.length,
      wrongPitch: 0,
      missing: 0,
      extra: 0,
    })
  })

  it('finds a wrong note in the bar the perturbation names', () => {
    const take = perturb(timeline, {
      seed: 991,
      perturbations: [{ kind: 'substitutePitch', bar: 2, index: 1, semitones: 1 }],
    })
    const declared = take.verdicts[0]
    if (declared?.kind !== 'wrongPitch') throw new Error('the oracle changed shape')

    const report = practiceReport({ timeline, events: take.events, takeId: 'from-midi' })
    const wrong = report.bars.flatMap((bar) =>
      bar.notes.filter((note) => note.kind === 'wrongPitch').map(() => bar.bar)
    )
    expect(wrong).toEqual([declared.bar])
  })
})
