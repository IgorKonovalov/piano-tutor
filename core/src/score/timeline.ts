import type { ExpectedBar, ExpectedNote, ExpectedTimeline } from '../../../shared/score'

/**
 * The expected-note timeline and the pure functions over it. `core/` owns
 * every one of these and **never parses MusicXML** (ADR-0005): the timeline
 * arrives already extracted, from the library that drew the score, so the bar
 * index a verdict travels under is the same index that bar can be coloured by.
 *
 * Everything is in quarter notes from the start of the piece. Nothing here
 * reads a clock, and nothing here knows a tempo.
 */

export type { ExpectedBar, ExpectedNote, ExpectedTimeline }

/**
 * Durations come from fractions, so a triplet is a repeating decimal. Rounding
 * at extraction and again here keeps a timeline byte-identical across machines
 * and makes a committed fixture diffable, which is the whole point of
 * committing one.
 */
export const TIMELINE_PRECISION = 1e6

export function roundQuarters(value: number): number {
  return Math.round(value * TIMELINE_PRECISION) / TIMELINE_PRECISION
}

/** Ordered by onset, then pitch, then staff and voice: total and stable. */
export function compareNotes(a: ExpectedNote, b: ExpectedNote): number {
  return (
    a.onset - b.onset || a.midi - b.midi || a.staff - b.staff || a.voice - b.voice ||
    a.duration - b.duration
  )
}

export function notesInBar(timeline: ExpectedTimeline, bar: number): ExpectedNote[] {
  return timeline.notes.filter((note) => note.bar === bar)
}

export function barAt(timeline: ExpectedTimeline, index: number): ExpectedBar | undefined {
  return timeline.bars.find((bar) => bar.index === index)
}

/**
 * The notes alignment judges. Grace notes are in the timeline so the score can
 * still be described, and out of this list because scoring an ornament against
 * a beat it deliberately anticipates would mark good playing wrong.
 */
export function scoredNotes(timeline: ExpectedTimeline): ExpectedNote[] {
  return timeline.notes.filter((note) => !note.grace)
}

/** The piece's length in quarter notes, from the bar table rather than the notes. */
export function totalQuarters(timeline: ExpectedTimeline): number {
  const last = timeline.bars[timeline.bars.length - 1]
  return last === undefined ? 0 : roundQuarters(last.onset + last.beats)
}

/**
 * The bar table's invariants, as a list of what is broken rather than a
 * boolean: indices run 0, 1, 2, ... with none skipped, and each bar starts
 * where the previous one ended.
 *
 * Both are the failure ADR-0005 exists to prevent, in the form it actually
 * takes: a multi-measure rest drawn as one object, or a pickup counted as a
 * whole bar, shows up here as a gap rather than as a colour on the wrong bar.
 */
export function barTableProblems(timeline: ExpectedTimeline): string[] {
  const problems: string[] = []
  timeline.bars.forEach((bar, position) => {
    if (bar.index !== position) {
      problems.push(`bar at position ${position} is indexed ${bar.index}`)
    }
    const previous = timeline.bars[position - 1]
    if (previous === undefined) return
    const expected = roundQuarters(previous.onset + previous.beats)
    if (bar.onset !== expected) {
      problems.push(`bar ${bar.index} starts at ${bar.onset}, not ${expected}`)
    }
  })
  return problems
}

/** Every note sits in the bar whose span contains its onset. */
export function noteBarProblems(timeline: ExpectedTimeline): string[] {
  const problems: string[] = []
  for (const note of timeline.notes) {
    const bar = barAt(timeline, note.bar)
    if (bar === undefined) {
      problems.push(`note at ${note.onset} names bar ${note.bar}, which is not in the table`)
    } else if (note.onset < bar.onset || note.onset >= roundQuarters(bar.onset + bar.beats)) {
      problems.push(`note at ${note.onset} is outside bar ${note.bar}`)
    }
  }
  return problems
}

/**
 * One canonical string per timeline: keys in a fixed order, numbers already
 * rounded. This is what a committed fixture holds and what the fingerprint is
 * taken over, so two extractions that agree produce identical text and a diff
 * shows the musical difference rather than a re-serialisation.
 */
export function canonicalTimeline(timeline: ExpectedTimeline): string {
  const notes = timeline.notes.map((note) => ({
    midi: note.midi,
    onset: roundQuarters(note.onset),
    duration: roundQuarters(note.duration),
    bar: note.bar,
    staff: note.staff,
    voice: note.voice,
    tied: note.tied,
    grace: note.grace,
  }))
  const bars = timeline.bars.map((bar) => ({
    index: bar.index,
    onset: roundQuarters(bar.onset),
    beats: roundQuarters(bar.beats),
  }))
  return `${JSON.stringify({ scoreId: timeline.scoreId, notes, bars }, null, 2)}\n`
}

/**
 * A short, stable fingerprint of a timeline. FNV-1a over the canonical text in
 * two 32-bit halves, which is a dozen lines rather than a dependency and needs
 * no platform crypto -- `core/` runs in both processes and in a test.
 *
 * It is a change detector, not a checksum against tampering: it says two
 * extractions differ, and the committed fixture says how.
 */
export function timelineFingerprint(timeline: ExpectedTimeline): string {
  const text = canonicalTimeline(timeline)
  let low = 0x811c9dc5
  let high = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    low = Math.imul(low ^ code, 0x01000193) >>> 0
    high = Math.imul(high ^ ((code << 5) | (i & 31)), 0x85ebca6b) >>> 0
  }
  return `${low.toString(16).padStart(8, '0')}${high.toString(16).padStart(8, '0')}`
}
