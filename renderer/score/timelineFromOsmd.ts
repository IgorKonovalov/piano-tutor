import type { MusicSheet, Note, Tie } from 'opensheetmusicdisplay'
import type { ExpectedBar, ExpectedNote, ExpectedTimeline } from '../../shared/score'
import { compareNotes, roundQuarters } from '../../core/src/score/timeline'

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

  for (const measure of sheet.SourceMeasures) {
    const bar = measure.measureListIndex

    // The bar's own length, not the metre. An anacrusis is as long as what is
    // written in it, and using the time signature here would make the first
    // full bar start three beats after the pickup that precedes it.
    bars.push({
      index: bar,
      onset: quarters(measure.AbsoluteTimestamp.RealValue),
      beats: quarters(measure.Duration.RealValue),
    })

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

            notes.push({
              midi: pitch,
              onset: quarters(entry.AbsoluteTimestamp.RealValue),
              duration: quarters((tie?.Duration ?? note.Length).RealValue),
              bar,
              staff: entry.ParentStaff.idInMusicSheet,
              voice: voiceEntry.ParentVoice.VoiceId,
              tied: tie !== undefined,
              grace: voiceEntry.IsGrace === true,
            })
          }
        }
      }
    }
  }

  notes.sort(compareNotes)
  bars.sort((a, b) => a.index - b.index)
  return { scoreId, notes, bars }
}

function pitchOf(note: Note): number | undefined {
  const pitch: { getHalfTone(): number } | undefined = note.Pitch
  if (pitch === undefined || pitch === null) return undefined
  const midi = pitch.getHalfTone() + MIDI_OFFSET
  return midi >= 0 && midi <= 127 ? midi : undefined
}
