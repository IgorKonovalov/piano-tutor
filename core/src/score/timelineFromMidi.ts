import { Midi } from '@tonejs/midi'
import type { ExpectedBar, ExpectedNote, ExpectedTimeline } from '../../../shared/score'
import { compareNotes, roundQuarters } from './timeline'

/**
 * A MIDI file as a second-class score (ADR-0003).
 *
 * **This adapter is in `core/`, and that is not a contradiction of ADR-0005.**
 * That decision exists because two parsers of one MusicXML file disagree about
 * bar numbering in ways nothing can detect -- and the disagreement is possible
 * because one of the parsers is also drawing the thing. A MIDI file has no
 * engraving, so there is no second parser to disagree with: bars come from the
 * file's own time signature and its ticks-per-quarter, which is arithmetic.
 *
 * **Second class is a promise about what this does not do.** No engraved
 * notation, no key or clef inference, no beaming, no enharmonic spelling, no
 * voices, no hands. A MIDI file is a timeline and a bar grid, and the app says
 * so rather than pretending the result is notation.
 */

/**
 * Onsets snap to a sixteenth by default. A MIDI file recorded from a
 * performance has no grid of its own -- its onsets are whenever the player
 * happened to be -- so aligning against one unquantised would judge a take
 * against another take. The value is stated here and shown in the app rather
 * than being an invisible constant; a file exported from notation software is
 * already on the grid and is unchanged by it.
 */
export const DEFAULT_QUANTISE_QUARTERS = 0.25

/** No quantisation at all, for a file that is known to be exact. */
export const NO_QUANTISE = 0

export interface MidiTimelineOptions {
  scoreId: string
  /** The grid in quarter notes; `NO_QUANTISE` leaves onsets where they are. */
  quantiseTo?: number
}

function snap(quarters: number, grid: number): number {
  if (grid <= 0) return roundQuarters(quarters)
  return roundQuarters(Math.round(quarters / grid) * grid)
}

interface Segment {
  /** Quarter notes from the start of the piece. */
  from: number
  barQuarters: number
}

/**
 * Where each metre begins and how long its bars are. A time signature of
 * `n/d` is `n * 4 / d` quarter notes to the bar, which is the only place the
 * denominator matters: everything else here counts in quarters.
 */
function segments(midi: Midi): Segment[] {
  const ppq = midi.header.ppq
  const changes = [...midi.header.timeSignatures].sort((a, b) => a.ticks - b.ticks)
  const found: Segment[] = []

  for (const change of changes) {
    const [beats, unit] = change.timeSignature
    if (beats === undefined || unit === undefined || beats <= 0 || unit <= 0) continue
    found.push({
      from: roundQuarters(change.ticks / ppq),
      barQuarters: roundQuarters((beats * 4) / unit),
    })
  }

  // A file with no time signature at all is common, and 4/4 is what every
  // sequencer assumes when it writes one. Saying so beats refusing the file.
  if (found.length === 0 || (found[0]?.from ?? 0) > 0) {
    found.unshift({ from: 0, barQuarters: 4 })
  }
  return found
}

/** The bar grid, from the first bar to the one holding the last note's end. */
function barsFor(spans: readonly Segment[], endsAt: number): ExpectedBar[] {
  const bars: ExpectedBar[] = []
  let onset = 0

  for (let index = 0; index < spans.length; index++) {
    const span = spans[index]
    if (span === undefined) continue
    const until = spans[index + 1]?.from ?? Number.POSITIVE_INFINITY

    while (onset < until && (onset < endsAt || bars.length === 0)) {
      bars.push({ index: bars.length, onset: roundQuarters(onset), beats: span.barQuarters })
      onset = roundQuarters(onset + span.barQuarters)
    }
    if (onset >= endsAt && bars.length > 0 && until === Number.POSITIVE_INFINITY) break
  }
  return bars
}

function barOf(bars: readonly ExpectedBar[], onset: number): number {
  for (let index = bars.length - 1; index >= 0; index--) {
    const bar = bars[index]
    if (bar !== undefined && onset >= bar.onset) return bar.index
  }
  return 0
}

export function timelineFromMidi(
  bytes: Uint8Array,
  options: MidiTimelineOptions
): ExpectedTimeline {
  const midi = new Midi(bytes)
  const ppq = midi.header.ppq
  const grid = options.quantiseTo ?? DEFAULT_QUANTISE_QUARTERS

  interface Raw {
    midi: number
    onset: number
    duration: number
    voice: number
  }
  const raw: Raw[] = []
  let endsAt = 0

  midi.tracks.forEach((track, index) => {
    for (const note of track.notes) {
      const onset = snap(note.ticks / ppq, grid)
      // A note quantised to nothing is still a note that was struck; the floor
      // is one grid step, or a sixteenth when the grid is off.
      const duration = Math.max(
        grid > 0 ? grid : DEFAULT_QUANTISE_QUARTERS,
        snap(note.durationTicks / ppq, grid)
      )
      raw.push({ midi: note.midi, onset, duration, voice: index + 1 })
      endsAt = Math.max(endsAt, roundQuarters(onset + duration))
    }
  })

  const bars = barsFor(segments(midi), endsAt)

  // One staff, because a MIDI file does not say which hand played what and
  // guessing is the transcription problem ADR-0003 explicitly declined.
  const notes: ExpectedNote[] = raw
    .map((note) => ({
      midi: note.midi,
      onset: note.onset,
      duration: note.duration,
      bar: barOf(bars, note.onset),
      staff: 0,
      voice: note.voice,
      tied: false,
      optional: false,
      ornament: null,
      fermata: false,
    }))
    .sort(compareNotes)

  return { scoreId: options.scoreId, notes, bars, pedal: [], dynamics: [], tempo: [] }
}
