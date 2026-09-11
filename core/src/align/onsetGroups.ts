import type { MidiEvent } from '../../../shared/midi'
import type { ExpectedNote, ExpectedTimeline } from '../../../shared/score'
import { optionalNotes, scoredNotes } from '../score/timeline'

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
   * The ornaments written against this group: grace notes and the notes an
   * ornament symbol was realised into, sorted, a multiset like `pitches`.
   * **They cost nothing struck and nothing skipped** (ADR-0009) -- they may
   * excuse a strike the scored pitches leave over (`withoutForgivenOrnaments`),
   * and they produce no verdict of any kind.
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
 * Where an optional note attaches depends on which side of its principal it
 * sounds.
 *
 * A **grace note** (`ornament: null`) joins the group at its own onset, and
 * failing that the first group at or after it -- never the one before
 * (ADR-0009). It anticipates the note it decorates and never trails the
 * previous one, so attaching backwards would charge its pitch to a beat the
 * player had already left. One written after the last scored group has
 * nothing to decorate and is dropped.
 *
 * A **realised ornament note** sounds *within* its principal, from the
 * principal's onset onward, so it joins the last group at or before its own
 * onset (ADR-0018). Attaching it forwards would forgive a trill's tail on the
 * next beat and leave the beat it decorates unprotected.
 */
function attachOrnaments(groups: ExpectedGroup[], timeline: ExpectedTimeline): void {
  if (groups.length === 0) return
  for (const note of optionalNotes(timeline)) {
    const host =
      note.ornament === null
        ? (groups.find((group) => group.onset === note.onset) ??
          groups.find((group) => group.onset > note.onset))
        : lastGroupAtOrBefore(groups, note.onset)
    if (host === undefined) continue
    host.optionalPitches.push(note.midi)
  }
  for (const group of groups) {
    if (group.optionalPitches.length > 1) group.optionalPitches.sort((a, b) => a - b)
  }
}

/** `groups` is in onset order, so the last one that qualifies is the nearest. */
function lastGroupAtOrBefore(
  groups: readonly ExpectedGroup[],
  onset: number
): ExpectedGroup | undefined {
  let found: ExpectedGroup | undefined
  for (const group of groups) {
    if (group.onset > onset) break
    found = group
  }
  return found
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
 * What the player struck that this group is **judged on**: every strike, less
 * the ones an ornament forgives (ADR-0009, as ADR-0018 narrows it). The cost
 * of a step, the verdicts and the counts all see only what this leaves, which
 * is why an ornament played produces no `extra` and an ornament skipped
 * produces no `missing`.
 *
 * An optional pitch forgives only a **surplus** strike: the scored pitches are
 * taken out of the struck set first, and only what is left over may be
 * excused. The order matters whenever an ornament shares a pitch with its
 * group, which every realised ornament does -- a turn on A4 re-emits A4 -- and
 * which a grace note repeating a chord tone does too. Subtracting the optional
 * pitches first would remove the scored A4 the player struck and report it
 * missing. Where optional and scored pitches are disjoint the two orders agree.
 *
 * `played` must be sorted; the result is.
 */
export function withoutForgivenOrnaments(
  played: readonly number[],
  group: Pick<ExpectedGroup, 'pitches' | 'optionalPitches'>
): number[] {
  if (group.optionalPitches.length === 0) return [...played]
  const surplus = pitchesMissingFrom(played, group.pitches)
  const unforgiven = pitchesMissingFrom(surplus, group.optionalPitches)
  const forgiven = pitchesMissingFrom(surplus, unforgiven)
  return pitchesMissingFrom(played, forgiven)
}

/**
 * What the player struck with every one of this group's ornament pitches taken
 * out, whether or not the scored pitches needed it. This is **not** what a
 * group is judged on -- `withoutForgivenOrnaments` is. It answers a different
 * question: whether a played group is *nothing but ornament*, which is what
 * the roll cost and the arrival time ask. A trill's repeated principal counts
 * as ornament there, because the strike is part of the realisation.
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
