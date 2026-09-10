import type { MidiEvent } from '../../../shared/midi'
import type { ExpectedNote, ExpectedTimeline } from '../../../shared/score'
import { graceNotes, scoredNotes } from '../score/timeline'

/**
 * Both sides of the comparison, reduced to **onset groups** before anything is
 * matched.
 *
 * A chord is one event to a player: they put a hand down once. Aligning notes
 * rather than groups turns a rolled chord into four separate timing errors and
 * a two-hand chord into a question about which hand came first, neither of
 * which is anything the player did wrong. Grouping first is what makes the
 * rest of alignment a comparison of two short sequences instead of two long
 * ones -- and it is why the report stays sized by the score.
 */

/**
 * How far apart two note-ons can be and still be one gesture. Fifty
 * milliseconds is the same order as the whole key-to-pixel budget (NFR 1) and
 * about the spread of a deliberately rolled chord at a moderate tempo. It is a
 * guess until it is measured against a real hand (Plan 0002 Phase 7 item 5);
 * when it moves it moves here, with a test, and not by tuning.
 */
export const ONSET_WINDOW_MS = 50

export interface ExpectedGroup {
  /** Position in the sequence: this is the only thing matching may look at. */
  index: number
  /** Quarter notes from the start of the piece. */
  onset: number
  bar: number
  notes: ExpectedNote[]
  /** Sorted, and a multiset: a doubled pitch is two entries. */
  pitches: number[]
  /**
   * The ornaments written against this group: grace notes, sorted, a multiset
   * like `pitches`. **They cost nothing struck and nothing skipped** (ADR-0009)
   * -- they are removed from what the player played before the two sets are
   * compared, and they produce no verdict of any kind.
   *
   * The player is learning the notes of a piece; an appoggiatura they leave
   * out while they do is not a mistake, and one they put in is not an extra
   * note. Judging ornaments is a later decision and a superseding ADR.
   */
  optionalPitches: number[]
}

export interface PlayedNoteOn {
  midi: number
  /** Milliseconds, as the take recorded them. */
  t: number
  velocity: number
}

export interface PlayedGroup {
  index: number
  /** The first note-on in the group; the one the player would call the beat. */
  t: number
  notes: PlayedNoteOn[]
  pitches: number[]
}

function sortedPitches(midis: readonly number[]): number[] {
  return [...midis].sort((a, b) => a - b)
}

/**
 * A chord in the score is one group. Onsets come from a parsed score and are
 * exact fractions, so equality is the right test here -- no window, and no
 * chance of two adjacent beats merging at a fast tempo.
 */
export function expectedGroups(timeline: ExpectedTimeline): ExpectedGroup[] {
  const byOnset = new Map<number, ExpectedNote[]>()
  for (const note of scoredNotes(timeline)) {
    const existing = byOnset.get(note.onset)
    if (existing === undefined) byOnset.set(note.onset, [note])
    else existing.push(note)
  }

  const groups = [...byOnset.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([onset, notes], index) => ({
      index,
      onset,
      // Every note at one onset is in one bar, because a bar is a span of
      // onsets; taking the first is not a choice between candidates.
      bar: notes[0]?.bar ?? 0,
      notes,
      pitches: sortedPitches(notes.map((note) => note.midi)),
      optionalPitches: [] as number[],
    }))

  attachOrnaments(groups, timeline)
  return groups
}

/**
 * A grace note joins the group at its own onset, and failing that the first
 * group at or after it -- never the one before (ADR-0009). An ornament
 * anticipates the note it decorates; it never trails the previous one, so
 * attaching backwards would charge its pitch to a beat the player had already
 * left.
 *
 * A grace note written after the last scored group has nothing to decorate and
 * is dropped: there is no group whose judgement it could soften.
 */
function attachOrnaments(groups: ExpectedGroup[], timeline: ExpectedTimeline): void {
  if (groups.length === 0) return
  for (const note of graceNotes(timeline)) {
    const host =
      groups.find((group) => group.onset === note.onset) ??
      groups.find((group) => group.onset > note.onset)
    if (host === undefined) continue
    host.optionalPitches.push(note.midi)
  }
  for (const group of groups) {
    if (group.optionalPitches.length > 1) group.optionalPitches.sort((a, b) => a - b)
  }
}

/**
 * Played note-ons within `windowMs` of the **group's first note** are one
 * group. Anchoring to the first rather than to the previous note is what stops
 * a fast run, where every note is inside the window of the one before it, from
 * collapsing into a single group that swallows the passage.
 */
export function playedGroups(
  events: readonly MidiEvent[],
  windowMs: number = ONSET_WINDOW_MS
): PlayedGroup[] {
  const ons: PlayedNoteOn[] = events
    .filter((event): event is Extract<MidiEvent, { kind: 'noteOn' }> => event.kind === 'noteOn')
    // A note-on with velocity 0 is a note-off by another name; the parser
    // already turns those into noteOff, so anything here was really struck.
    .map((event) => ({ midi: event.note, t: event.t, velocity: event.velocity }))
    .sort((a, b) => a.t - b.t || a.midi - b.midi)

  const groups: PlayedGroup[] = []
  let current: PlayedNoteOn[] = []
  let anchor = 0

  const flush = (): void => {
    if (current.length === 0) return
    groups.push({
      index: groups.length,
      t: anchor,
      notes: current,
      pitches: sortedPitches(current.map((note) => note.midi)),
    })
    current = []
  }

  for (const note of ons) {
    if (current.length === 0) {
      anchor = note.t
    } else if (note.t - anchor > windowMs) {
      flush()
      anchor = note.t
    }
    current.push(note)
  }
  flush()
  return groups
}

/**
 * The multiset symmetric difference of two sorted pitch lists: how many notes
 * would have to change for one to become the other. Zero means the player put
 * down exactly what is written, whenever they did it.
 */
export function pitchDifference(a: readonly number[], b: readonly number[]): number {
  let i = 0
  let j = 0
  let difference = 0
  while (i < a.length && j < b.length) {
    const left = a[i] as number
    const right = b[j] as number
    if (left === right) {
      i++
      j++
    } else if (left < right) {
      difference++
      i++
    } else {
      difference++
      j++
    }
  }
  return difference + (a.length - i) + (b.length - j)
}

/**
 * What the player struck, with this group's ornaments taken back out
 * (ADR-0009). Everything downstream -- the cost of a step, the verdicts, the
 * counts -- sees only what is left, which is why an ornament played produces
 * no `extra` and an ornament skipped produces no `missing`.
 *
 * A group with no ornament is the overwhelmingly common case and returns a
 * copy without touching the multiset arithmetic.
 */
export function withoutOrnaments(
  played: readonly number[],
  optional: readonly number[]
): number[] {
  if (optional.length === 0) return [...played]
  return pitchesMissingFrom(played, optional)
}

/** The pitches in `a` that `b` does not have, as a multiset. */
export function pitchesMissingFrom(a: readonly number[], b: readonly number[]): number[] {
  const remaining = [...b]
  const only: number[] = []
  for (const pitch of a) {
    const at = remaining.indexOf(pitch)
    if (at === -1) only.push(pitch)
    else remaining.splice(at, 1)
  }
  return only
}
