import type {
  DynamicMark,
  ExpectedBar,
  ExpectedNote,
  ExpectedTimeline,
  PedalMark,
  TempoMark,
} from '../../../shared/score'

/**
 * The expected-note timeline and the pure functions over it. `core/` owns
 * every one of these and **never parses MusicXML** (ADR-0005): the timeline
 * arrives already extracted, from the library that drew the score, so the bar
 * index a verdict travels under is the same index that bar can be coloured by.
 *
 * Everything is in quarter notes from the start of the piece. Nothing here
 * reads a clock, and nothing here knows a tempo.
 */

export type { DynamicMark, ExpectedBar, ExpectedNote, ExpectedTimeline, PedalMark, TempoMark }

/** Where a tempo mark goes among others at its instant. */
const TEMPO_MARK_ORDER: Record<TempoMark['kind'], number> = {
  return: 0,
  metronome: 1,
  word: 1,
  ramp: 2,
}

/**
 * Tempo marks in the order playback applies them: by position, and at one
 * position a return, then a metronome mark or word, then a ramp. So a
 * metronome mark written beside `a tempo` wins, and a ramp that starts there
 * starts from it.
 */
export function compareTempoMarks(a: TempoMark, b: TempoMark): number {
  return a.at - b.at || TEMPO_MARK_ORDER[a.kind] - TEMPO_MARK_ORDER[b.kind]
}

/** By position, and at one position a step mark ahead of a hairpin, then by staff. */
export function compareDynamicMarks(a: DynamicMark, b: DynamicMark): number {
  return a.at - b.at || Number(a.until !== null) - Number(b.until !== null) || a.staff - b.staff
}

/**
 * Pedal marks in the order playback needs them: by position, and at one
 * position a lift ahead of a press, so a pedal change clears the old harmony
 * before it catches the new one.
 */
export function comparePedalMarks(a: PedalMark, b: PedalMark): number {
  return a.at - b.at || Number(a.down) - Number(b.down) || a.staff - b.staff
}

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
 * The notes alignment judges. Optional notes -- grace notes and realised
 * ornaments -- are in the timeline so the score can still be described and
 * played, and out of this list because scoring an ornament would mark good
 * playing wrong whichever way the player took it.
 */
export function scoredNotes(timeline: ExpectedTimeline): ExpectedNote[] {
  return timeline.notes.filter((note) => !note.optional)
}

/**
 * The ornaments, in onset order. They are what `scoredNotes` leaves behind,
 * and they are not discarded: alignment attaches them to the group they
 * decorate as optional pitches, so that playing one costs nothing and leaving
 * one out costs nothing (ADR-0009).
 */
export function optionalNotes(timeline: ExpectedTimeline): ExpectedNote[] {
  return timeline.notes.filter((note) => note.optional)
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
 *
 * A **zero-length bar is named but not refused** (ADR-0018). An attributes-only
 * measure is a legal bar with no length, so it stays in the table and keeps its
 * index; what it must stop doing is passing silently, which it did, because a
 * bar of no length is perfectly contiguous with both its neighbours and the
 * contiguity check below can never see one.
 */
export function barTableProblems(timeline: ExpectedTimeline): string[] {
  const problems: string[] = []
  timeline.bars.forEach((bar, position) => {
    if (bar.index !== position) {
      problems.push(`bar at position ${position} is indexed ${bar.index}`)
    }
    if (bar.beats === 0) {
      problems.push(`bar ${bar.index} has no length`)
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
    optional: note.optional,
    ornament: note.ornament,
    articulation: [...note.articulation],
    fermata: note.fermata,
  }))
  const bars = timeline.bars.map((bar) => ({
    index: bar.index,
    onset: roundQuarters(bar.onset),
    beats: roundQuarters(bar.beats),
  }))
  const pedal = timeline.pedal.map((mark) => ({
    at: roundQuarters(mark.at),
    down: mark.down,
    staff: mark.staff,
  }))
  const dynamics = timeline.dynamics.map((mark) => ({
    at: roundQuarters(mark.at),
    velocity: mark.velocity,
    label: mark.label,
    staff: mark.staff,
    until: mark.until === null ? null : roundQuarters(mark.until),
    endVelocity: mark.endVelocity,
  }))
  const tempo = timeline.tempo.map((mark) => {
    const at = roundQuarters(mark.at)
    switch (mark.kind) {
      case 'metronome':
      case 'word':
        return { at, kind: mark.kind, bpm: roundQuarters(mark.bpm), label: mark.label }
      case 'ramp':
        return {
          at,
          kind: mark.kind,
          direction: mark.direction,
          until: roundQuarters(mark.until),
          label: mark.label,
        }
      case 'return':
        return { at, kind: mark.kind, to: mark.to, label: mark.label }
    }
  })
  const text = JSON.stringify(
    { scoreId: timeline.scoreId, notes, bars, pedal, dynamics, tempo },
    null,
    2
  )
  return `${text}\n`
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
