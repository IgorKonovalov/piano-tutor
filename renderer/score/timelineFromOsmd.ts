import {
  type Fraction,
  type KeyInstruction,
  type MusicSheet,
  type Note,
  OrnamentEnum,
  type SourceMeasure,
  type Tie,
  type VoiceEntry,
} from 'opensheetmusicdisplay'
import type {
  ExpectedBar,
  ExpectedNote,
  ExpectedTimeline,
  OrnamentKind,
  PedalMark,
} from '../../shared/score'
import { comparePedalMarks, compareNotes, roundQuarters } from '../../core/src/score/timeline'

/**
 * The one place a MusicXML file becomes an `ExpectedTimeline` (ADR-0005).
 *
 * It walks the `MusicSheet` OSMD has already parsed rather than parsing the
 * file a second time, because two parsers of one document disagree about bar
 * numbering in ways nothing can detect: a pickup counted as measure 1, a
 * multi-measure rest collapsed to one bar, an implicit measure from a mid-bar
 * barline. Every one of those silently colours the bar next to the one the
 * player fumbled. Here there is one index, OSMD's, and it is passed through
 * untouched.
 *
 * This is renderer code and it is the least-tested link in the chain, which is
 * why the timelines it produces for the fixture scores are committed and
 * compared -- in `timelineFromOsmd.test.ts` against a headless parse, and in
 * the end-to-end run against the app's own. Neither check is optional.
 */

/** OSMD counts half tones from C0 = 0; MIDI counts from C-1 = 0. */
const MIDI_OFFSET = 12

/** OSMD's fractions are in whole notes; a timeline is in quarter notes. */
const QUARTERS_PER_WHOLE = 4

function quarters(whole: number): number {
  return roundQuarters(whole * QUARTERS_PER_WHOLE)
}

export function timelineFromOsmd(sheet: MusicSheet, scoreId: string): ExpectedTimeline {
  const notes: ExpectedNote[] = []
  const bars: ExpectedBar[] = []
  const pedal: PedalMark[] = []
  // The key in force on each staff. A measure carries a key instruction only
  // where one is written, so this is carried forward from the last one seen.
  const keys = new Map<number, KeyInstruction>()

  for (const measure of sheet.SourceMeasures) {
    const bar = measure.measureListIndex
    for (let staffIndex = 0; staffIndex < measure.FirstInstructionsStaffEntries.length; staffIndex++) {
      const key: KeyInstruction | undefined = measure.getKeyInstruction(staffIndex)
      if (key !== undefined) keys.set(staffIndex, key)
    }

    // The bar's own length, not the metre. An anacrusis is as long as what is
    // written in it, and using the time signature here would make the first
    // full bar start three beats after the pickup that precedes it.
    bars.push({
      index: bar,
      onset: quarters(measure.AbsoluteTimestamp.RealValue),
      beats: quarters(measure.Duration.RealValue),
    })

    readStaffExpressions(measure, pedal)

    for (const container of measure.VerticalSourceStaffEntryContainers) {
      for (const entry of container.StaffEntries) {
        // A staff with nothing at this timestamp leaves a hole in the row.
        if (entry === undefined || entry === null) continue

        for (const voiceEntry of entry.VoiceEntries) {
          for (const note of voiceEntry.Notes) {
            if (note.isRest()) continue

            // A tie is one key press, so only the tie's first note becomes an
            // expected note and it carries the whole tie's duration. Skipping
            // the continuations is what stops a note held across a barline
            // reading as a missing second strike.
            const tie: Tie | undefined = note.NoteTie
            if (tie !== undefined && tie.StartNote !== note) continue

            const pitch = pitchOf(note)
            if (pitch === undefined) continue

            const lengthWhole = (tie?.Duration ?? note.Length).RealValue
            const staff = entry.ParentStaff.idInMusicSheet
            const voice = voiceEntry.ParentVoice.VoiceId
            const key = keys.get(staff)
            // OSMD realises the entry's first note and nothing else; any other
            // note of the chord stays plain.
            const realisation =
              note === voiceEntry.Notes[0] &&
              voiceEntry.IsGrace !== true &&
              voiceEntry.OrnamentContainer !== undefined &&
              voiceEntry.OrnamentContainer !== null &&
              key !== undefined
                ? realiseOrnament(voiceEntry, key, lengthWhole)
                : undefined

            // The principal stays scored at its written onset and length. It
            // carries the ornament's kind so that playback sounds its
            // realisation in its place, which re-strikes its pitch (ADR-0018).
            notes.push({
              midi: pitch,
              onset: quarters(entry.AbsoluteTimestamp.RealValue),
              duration: quarters(lengthWhole),
              bar,
              staff,
              voice,
              tied: tie !== undefined,
              optional: voiceEntry.IsGrace === true,
              ornament: realisation?.kind ?? null,
            })

            for (const realised of realisation?.notes ?? []) {
              notes.push({
                midi: realised.midi,
                onset: quarters(entry.AbsoluteTimestamp.RealValue + realised.offset),
                duration: quarters(realised.length),
                bar,
                staff,
                voice,
                tied: false,
                optional: true,
                ornament: realisation?.kind ?? null,
              })
            }
          }
        }
      }
    }
  }

  notes.sort(compareNotes)
  bars.sort((a, b) => a.index - b.index)
  pedal.sort(comparePedalMarks)
  return { scoreId, notes, bars, pedal }
}

/**
 * The marks OSMD hangs off a measure's staff-linked `MultiExpression`s: what
 * the page says, at the position it says it (ADR-0018). One walk, because the
 * pedal, the dynamics and the hairpins all live on the same objects.
 *
 * A pedal *change* reaches here as a `PedalEnd` and a `PedalStart` on one
 * expression -- OSMD's reader closes the open line and opens the next at the
 * same timestamp -- so both are read from every expression, and the sort puts
 * the lift first.
 */
function readStaffExpressions(measure: SourceMeasure, pedal: PedalMark[]): void {
  measure.StaffLinkedExpressions.forEach((expressions, staff) => {
    for (const expression of expressions) {
      const at = quarters(expression.AbsoluteTimestamp.RealValue)
      if (expression.PedalEnd !== undefined && expression.PedalEnd !== null) {
        pedal.push({ at, down: false, staff })
      }
      if (expression.PedalStart !== undefined && expression.PedalStart !== null) {
        pedal.push({ at, down: true, staff })
      }
    }
  })
}

/** OSMD's `OrnamentEnum`, by the names the timeline uses. */
const ORNAMENT_KINDS: Record<OrnamentEnum, OrnamentKind> = {
  [OrnamentEnum.Trill]: 'trill',
  [OrnamentEnum.Turn]: 'turn',
  [OrnamentEnum.InvertedTurn]: 'invertedTurn',
  [OrnamentEnum.DelayedTurn]: 'delayedTurn',
  [OrnamentEnum.DelayedInvertedTurn]: 'delayedInvertedTurn',
  [OrnamentEnum.Mordent]: 'mordent',
  [OrnamentEnum.InvertedMordent]: 'invertedMordent',
}

/** Two sums of the same fractions, in whole notes, agree to far better than this. */
const TILE_TOLERANCE = 1e-9

interface Realisation {
  kind: OrnamentKind
  /** Whole notes: `offset` from the principal's onset, and each note's `length`. */
  notes: { midi: number; offset: number; length: number }[]
}

/** The two private builders `createVoiceEntriesForOrnament` makes every note through. */
type Builder = (this: VoiceEntry, timestamp: Fraction, length: Fraction, ...rest: unknown[]) => void
type BuilderName = 'createBaseVoiceEntry' | 'createAlteratedVoiceEntry'
const BUILDERS: readonly BuilderName[] = ['createBaseVoiceEntry', 'createAlteratedVoiceEntry']

/**
 * An ornament symbol, realised into notes by OSMD's own realiser (ADR-0018):
 * its pitches, their order and their rhythm are all the library's.
 *
 * **OSMD 2.1.2 aliases the rhythm.** `createVoiceEntriesForOrnament` passes one
 * `Fraction` by reference into every entry it builds and then mutates it, so
 * the entries it returns all read the final timestamp -- and, for the mordents
 * and the delayed turns, the final length as well. The values are right at the
 * moment each entry is built. So the two builders are wrapped **on this one
 * instance**, for the length of the call, to record each timestamp and length
 * as a number when it is handed over; the i-th record pairs with the i-th
 * returned entry's pitch. `VoiceEntry.prototype` is never touched. The builders
 * are private in the typings, hence the one cast below. Check this first when
 * upgrading OSMD: if the aliasing is fixed, read the returned entries instead.
 *
 * The realiser's other side effect, on the staff entry, is undone below.
 *
 * Undefined, and the principal stays a plain note, whenever the realiser
 * throws, the capture and the result disagree in count, or the captured notes
 * do not tile the principal exactly from its onset to its end. A partial
 * realisation is never written.
 */
function realiseOrnament(
  entry: VoiceEntry,
  key: KeyInstruction,
  principalWhole: number
): Realisation | undefined {
  const kind = ORNAMENT_KINDS[entry.OrnamentContainer.GetOrnament]
  if (kind === undefined) return undefined

  // Both builders live on the prototype, so wrapping sets an own property and
  // restoring deletes it. Anything else is not the library this was written
  // against.
  if (BUILDERS.some((name) => Object.hasOwn(entry, name))) return undefined

  const builders = entry as unknown as Record<BuilderName, Builder>
  const captured: { timestamp: number; length: number }[] = []
  for (const name of BUILDERS) {
    const original = builders[name]
    builders[name] = function (this: VoiceEntry, timestamp, length, ...rest) {
      captured.push({ timestamp: timestamp.RealValue, length: length.RealValue })
      original.call(this, timestamp, length, ...rest)
    }
  }

  // The realiser also **writes to the model**: `createBaseVoiceEntry` builds its
  // entry with the principal's staff entry as parent, and the VoiceEntry
  // constructor appends itself to that staff entry's `VoiceEntries`. Left
  // there, each one is a new scored note to this extractor, which is walking
  // that same array, and a new notehead to OSMD's next layout. So whatever the
  // call appended is taken back out, and the model is left as it was parsed.
  const siblings = entry.ParentSourceStaffEntry?.VoiceEntries
  const before = siblings === undefined ? [] : [...siblings]

  let returned: VoiceEntry[] | undefined
  try {
    returned = entry.createVoiceEntriesForOrnament(entry, key)
  } catch {
    return undefined
  } finally {
    for (const name of BUILDERS) delete builders[name]
    if (siblings !== undefined) {
      for (let i = siblings.length - 1; i >= 0; i--) {
        if (!before.includes(siblings[i] as VoiceEntry)) siblings.splice(i, 1)
      }
    }
  }
  if (returned === undefined || returned.length === 0 || returned.length !== captured.length) {
    return undefined
  }

  const start = entry.Timestamp.RealValue
  let reached = start
  const notes: Realisation['notes'] = []
  for (let i = 0; i < returned.length; i++) {
    const record = captured[i]
    const sounding = returned[i]?.Notes[0]
    const midi = sounding === undefined ? undefined : pitchOf(sounding)
    if (record === undefined || midi === undefined || record.length <= 0) return undefined
    if (Math.abs(record.timestamp - reached) > TILE_TOLERANCE) return undefined
    notes.push({ midi, offset: record.timestamp - start, length: record.length })
    reached = record.timestamp + record.length
  }
  if (Math.abs(reached - (start + principalWhole)) > TILE_TOLERANCE) return undefined
  return { kind, notes }
}

function pitchOf(note: Note): number | undefined {
  const pitch: { getHalfTone(): number } | undefined = note.Pitch
  if (pitch === undefined || pitch === null) return undefined
  const midi = pitch.getHalfTone() + MIDI_OFFSET
  return midi >= 0 && midi <= 127 ? midi : undefined
}
