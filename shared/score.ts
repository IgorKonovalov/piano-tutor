import { z } from 'zod'

/**
 * The score library: a MusicXML file the player chose, copied into userData so
 * a take can be re-aligned later against the exact bytes it was played
 * against (ADR-0005).
 */
export const SCORE_LIBRARY_VERSION = 1

/**
 * A score id is **content-addressed** -- the first 128 bits of the SHA-256 of
 * the imported bytes, in lower-case hex. Two consequences, both load-bearing:
 * importing the same file twice is idempotent rather than a second entry, and
 * a take's score reference cannot go stale, because changing the file changes
 * the id.
 *
 * Like a take id it is a **path segment, never a path** (`shared/take.ts` says
 * why at length). Main turns it straight into a directory name under
 * `userData/scores`, so the shape is the boundary check.
 */
export const SCORE_ID_PATTERN = /^[0-9a-f]{32}$/

const scoreId = z.string().regex(SCORE_ID_PATTERN)

export const ScoreIdSchema = z.object({ id: scoreId })

/**
 * What the library accepts. The first three are engraved scores, read by OSMD;
 * the last two are MIDI files, which carry no notation and are second-class by
 * decision (ADR-0003) rather than by omission. The library stores whatever was
 * imported, unmodified, either way.
 */
export const MUSICXML_EXTENSIONS = ['.musicxml', '.xml', '.mxl'] as const
export const MIDI_EXTENSIONS = ['.mid', '.midi'] as const
export const SCORE_EXTENSIONS = [...MUSICXML_EXTENSIONS, ...MIDI_EXTENSIONS] as const
export const ScoreExtensionSchema = z.enum(SCORE_EXTENSIONS)

/** True for a file with no engraving in it: a timeline and a bar grid only. */
export function isMidiScore(extension: string): boolean {
  return (MIDI_EXTENSIONS as readonly string[]).includes(extension)
}
export type ScoreExtension = z.infer<typeof ScoreExtensionSchema>

export const ScoreMetaSchema = z.object({
  format: z.literal(SCORE_LIBRARY_VERSION),
  id: scoreId,
  /** The basename the file had when it was chosen; display only. */
  filename: z.string().min(1),
  extension: ScoreExtensionSchema,
  /** ISO 8601, wall clock, for display and ordering only. */
  importedAt: z.string(),
  byteLength: z.number().int().nonnegative(),
  /**
   * The title OSMD reports once it has parsed the file, written back after the
   * first successful render. Null until then: main never parses MusicXML
   * (ADR-0005), so it cannot know a title at import time.
   */
  title: z.string().nullable(),
})
export type ScoreMeta = z.infer<typeof ScoreMetaSchema>

export const ScoreMetaListSchema = z.array(ScoreMetaSchema)

/**
 * A cancelled open dialog is an outcome, not a failure: the renderer shows the
 * library unchanged rather than an error nobody caused.
 */
export const ScoreImportResultSchema = z.discriminatedUnion('cancelled', [
  z.object({ cancelled: z.literal(true) }),
  z.object({ cancelled: z.literal(false), meta: ScoreMetaSchema }),
])
export type ScoreImportResult = z.infer<typeof ScoreImportResultSchema>

/**
 * The bytes, base64-encoded. Base64 rather than a typed array because it
 * survives the context bridge with no assumptions about which structured-clone
 * types Electron carries across it, and a score is read once at open, not on
 * any hot path.
 */
export const ScoreContentSchema = z.object({
  meta: ScoreMetaSchema,
  base64: z.string(),
})
export type ScoreContent = z.infer<typeof ScoreContentSchema>

export const ScoreTitleRequestSchema = z.object({
  id: scoreId,
  title: z.string().min(1).max(200),
})
export type ScoreTitleRequest = z.infer<typeof ScoreTitleRequestSchema>

/**
 * The expected-note timeline: what the score says should be played, extracted
 * from the model OSMD has already parsed (ADR-0005) and consumed by `core/`.
 *
 * Everything here is in **quarter notes from the start of the piece**, never
 * in seconds. The score carries no tempo the player is obliged to keep, so a
 * timeline that spoke in seconds would be asserting one; alignment fits a
 * tempo after the fact instead, and is tempo-free by construction.
 */

/** OSMD's `OrnamentEnum`, one name per value it can realise into notes. */
export const OrnamentKindSchema = z.enum([
  'trill',
  'turn',
  'invertedTurn',
  'delayedTurn',
  'delayedInvertedTurn',
  'mordent',
  'invertedMordent',
])
export type OrnamentKind = z.infer<typeof OrnamentKindSchema>

/**
 * The keyboard-relevant subset of OSMD's `ArticulationEnum`, in a fixed order.
 * The rest (`upbow`, `snappizzicato`, ...) is dropped rather than modelled.
 */
export const ArticulationSchema = z.enum([
  'staccato',
  'staccatissimo',
  'tenuto',
  'accent',
  'strongaccent',
  'marcatoUp',
  'marcatoDown',
  'detachedLegato',
])
export type Articulation = z.infer<typeof ArticulationSchema>

export const ExpectedNoteSchema = z.object({
  midi: z.number().int().min(0).max(127),
  /** Quarter notes from the start of the piece. */
  onset: z.number().nonnegative(),
  /** Quarter notes. A tied pair carries the summed duration. */
  duration: z.number().nonnegative(),
  /** OSMD's measure index, verbatim -- never renumbered (ADR-0005). */
  bar: z.number().int().nonnegative(),
  /** Zero-based within the part: 0 is the right hand of a grand staff. */
  staff: z.number().int().nonnegative(),
  voice: z.number().int().nonnegative(),
  /** This note absorbed a tie: the player strikes the key once. */
  tied: z.boolean(),
  /**
   * Scored neither way (ADR-0009): a written-out grace note, or one of the
   * notes an ornament symbol was realised into (ADR-0018). Striking it costs
   * nothing and leaving it out costs nothing.
   */
  optional: z.boolean(),
  /**
   * The ornament this note carries or was realised from. On a scored note it
   * means "sounded by its realisation, scored as written"; on an optional one,
   * "one of those notes". Null for a written-out grace note and for every
   * ordinary note, and on a scored note only when its realisation exists.
   */
  ornament: OrnamentKindSchema.nullable(),
  /**
   * The marks on this notehead, in `ArticulationSchema`'s order. Playback
   * shortens and accents from them; scoring never reads them (ADR-0021).
   */
  articulation: z.array(ArticulationSchema),
  /** A fermata is written over this note. Playback holds it; scoring never reads it (ADR-0021). */
  fermata: z.boolean(),
})
export type ExpectedNote = z.infer<typeof ExpectedNoteSchema>

export const ExpectedBarSchema = z.object({
  index: z.number().int().nonnegative(),
  onset: z.number().nonnegative(),
  /**
   * The bar's own length in quarter notes, which is not always the metre: an
   * anacrusis is as long as what is written in it. Bars are contiguous, so
   * `onset + beats` of one bar is the `onset` of the next.
   *
   * **May be zero** (ADR-0018). An attributes-only measure -- the carrier bar
   * where the metre changes, holding no note and no rest -- is a real bar with
   * no length, and it keeps its index, because "indexed 0 to N as the score was
   * parsed, with no index skipped" is what bar-clicking and every take's bar
   * numbers depend on. Refusing it here is what stopped BWV 555 playing at all
   * while it practised fine. Every reader uses this additively, as
   * `onset + beats`; `barTableProblems` names a zero-length bar rather than
   * rejecting it, and anything that later divides by it has a trap to avoid.
   */
  beats: z.number().nonnegative(),
})
export type ExpectedBar = z.infer<typeof ExpectedBarSchema>

/**
 * A sustain-pedal change where the page marks one (ADR-0018). Not a property
 * of a note: a press happens between notes and over rests, and the lift -- the
 * half that decides whether a chord blurs into the next -- belongs to no note
 * at all. Playback reads it; scoring never does (ADR-0021).
 */
export const PedalMarkSchema = z.object({
  /** Quarter notes from the start of the piece, like every other onset here. */
  at: z.number().nonnegative(),
  down: z.boolean(),
  /** The staff the mark is written under. The pedal itself is the whole instrument's. */
  staff: z.number().int().nonnegative(),
})
export type PedalMark = z.infer<typeof PedalMarkSchema>

const velocity = z.number().int().min(1).max(127)

/**
 * A dynamic where the page writes one (ADR-0018): what the page says, not a
 * velocity per note. `velocity` is OSMD's own `MidiVolume` for the mark, never
 * a table of ours; `scheduleFromTimeline` is what resolves a note's velocity
 * from these, and scoring never reads them (ADR-0021).
 *
 * A step mark (`p`, `ff`) has `until` and `endVelocity` null. A hairpin has
 * both: it runs from `at` to `until`, from the level in force at its start to
 * the level written at its end. OSMD reads the span but not the end level, so
 * the end is the dynamic written at or after `until` on the same staff, and a
 * hairpin with no written target stays level.
 */
export const DynamicMarkSchema = z.object({
  at: z.number().nonnegative(),
  velocity,
  /** What the page printed -- `ff`, `crescendo` -- for prose; never parsed back. */
  label: z.string(),
  /** A dynamic belongs to the staff it is written on and to no other. */
  staff: z.number().int().nonnegative(),
  until: z.number().nonnegative().nullable(),
  endVelocity: velocity.nullable(),
})
export type DynamicMark = z.infer<typeof DynamicMarkSchema>

/** What the page printed -- `quarter = 120`, `rit.` -- which is what a report quotes. */
const tempoLabel = z.string()

/**
 * What the page says about speed (ADR-0018), never a resolved number.
 *
 * A metronome mark or a word carries OSMD's own bpm, in quarter notes per
 * minute. A ramp and a return carry no number, because the page gives none:
 * `scheduleFromTimeline` sizes a ramp and resolves a return against the marks
 * before it. A ramp runs from `at` to `until`, the next mark read or the end
 * of the piece.
 *
 * Playback reads this and scoring never does to decide anything (ADR-0021):
 * the aligner stays tempo-free, and the report may only quote `label` beside
 * an observation it already made.
 */
export const TempoMarkSchema = z.discriminatedUnion('kind', [
  z.object({
    at: z.number().nonnegative(),
    kind: z.enum(['metronome', 'word']),
    bpm: z.number().positive(),
    label: tempoLabel,
  }),
  z.object({
    at: z.number().nonnegative(),
    kind: z.literal('ramp'),
    direction: z.enum(['slower', 'faster']),
    until: z.number().nonnegative(),
    label: tempoLabel,
  }),
  z.object({
    at: z.number().nonnegative(),
    kind: z.literal('return'),
    /** `a tempo` restores the tempo before the last ramp; `tempo primo` the first one. */
    to: z.enum(['previous', 'first']),
    label: tempoLabel,
  }),
])
export type TempoMark = z.infer<typeof TempoMarkSchema>

export const ExpectedTimelineSchema = z.object({
  scoreId: scoreId,
  /** Ordered by onset, then pitch. */
  notes: z.array(ExpectedNoteSchema),
  /** One entry per source measure, in order, with no index skipped. */
  bars: z.array(ExpectedBarSchema),
  /** Ordered by `at`, a lift ahead of a press at the same instant. */
  pedal: z.array(PedalMarkSchema),
  /** Ordered by `at`, a step mark ahead of a hairpin at the same instant. */
  dynamics: z.array(DynamicMarkSchema),
  /** Ordered by `at`, and at one instant a return, then a tempo, then a ramp. */
  tempo: z.array(TempoMarkSchema),
})
export type ExpectedTimeline = z.infer<typeof ExpectedTimelineSchema>

/**
 * What a take was, judged against a score. Produced by `core/src/align/`,
 * rendered by the Score view, and summarised for the coach in Plan 0003.
 *
 * It is **sized by bars, not by events**: a ten-minute take and a one-minute
 * take of the same piece produce reports of the same order of size, because
 * what is described is the score. That is the property that keeps the coach's
 * token budget (NFR 7) reachable, and it is cheapest to guarantee here.
 */
export const NoteVerdictSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('correct'),
    expected: z.number().int().min(0).max(127),
    /** Milliseconds into the take. */
    playedAt: z.number(),
  }),
  z.object({
    kind: z.literal('wrongPitch'),
    expected: z.number().int().min(0).max(127),
    played: z.number().int().min(0).max(127),
  }),
  z.object({ kind: z.literal('missing'), expected: z.number().int().min(0).max(127) }),
  z.object({ kind: z.literal('extra'), played: z.number().int().min(0).max(127) }),
])
export type NoteVerdict = z.infer<typeof NoteVerdictSchema>

/**
 * `notAttempted` is a third thing beside right and wrong: a player who stops
 * halfway has not played the second half wrongly, and must not be shown a red
 * one. `unalignable` is the fourth: past a certain amount of divergence the
 * matcher has lost the thread, and saying so is honest where a wall of wrong
 * notes would be a confident lie.
 */
export const BarStateSchema = z.enum(['clean', 'timing', 'wrong', 'notAttempted', 'unalignable'])
export type BarState = z.infer<typeof BarStateSchema>

export const BarVerdictSchema = z.object({
  bar: z.number().int().nonnegative(),
  state: BarStateSchema,
  notes: z.array(NoteVerdictSchema),
  /**
   * How far this bar sat from the tempo **the bars around it** were keeping,
   * in milliseconds, averaged over the bar. Negative is early.
   *
   * The reference is local, not one line through the take (ADR-0014): a
   * player who goes back over a bar, or slows into a cadence, is not making a
   * timing mistake, and a global line reported both as error over the whole
   * performance -- backwards as well as forwards. Same name, same units, and
   * a different sentence: this is distance from the local pace, so anything
   * that describes it in words has to say so.
   *
   * Zero when the bar has nothing to time: fewer than two matched groups in
   * it, or too little evidence either side of it to have a reference at all,
   * which is always true of the first and last bars of a take.
   */
  timingDeviation: z.number(),
})
export type BarVerdict = z.infer<typeof BarVerdictSchema>

/**
 * The player went back over music they had already played -- a false start,
 * a fumble, a bar taken again before carrying on.
 *
 * It is **sized by the score, not by the take**: one entry per restart naming
 * the bar and how many note-ons the repeat accounted for, never the notes
 * themselves. That is the same property the bar list rests on and the reason
 * the coach's budget (NFR 7) stays reachable however many times a player
 * repeats a passage.
 */
export const RestartVerdictSchema = z.object({
  /** The bar they resumed from. */
  bar: z.number().int().nonnegative(),
  /** How many note-ons the repeat accounted for; not the notes. */
  notes: z.number().int().nonnegative(),
})
export type RestartVerdict = z.infer<typeof RestartVerdictSchema>

/**
 * How fussy the player wants the app to be about timing.
 *
 * Three named positions rather than a slider, because a slider invites tuning
 * the number until the feedback flatters. It moves the threshold a bar's
 * deviation is called out at and **nothing else**: the same take reports the
 * same notes, the same counts and the same `timingDeviation` at every setting,
 * because those are measurements and this is an opinion about them.
 *
 * Not persisted in this version: there is no settings store yet, so it is
 * remembered for as long as the view is open, the precedent the quantisation
 * grid set.
 */
export const TimingStrictnessSchema = z.enum(['relaxed', 'normal', 'strict'])
export type TimingStrictness = z.infer<typeof TimingStrictnessSchema>

export const DEFAULT_STRICTNESS: TimingStrictness = 'normal'

/** What each position is called where a player reads it. */
export const STRICTNESS_LABELS: Record<TimingStrictness, string> = {
  relaxed: 'Let it breathe',
  normal: 'Normal',
  strict: 'Keep it tight',
}

/**
 * What the tempo did over a span: **information, never a verdict**. No bar's
 * state changes because one of these exists (ADR-0014). A player who slows
 * into a cadence has done something worth telling them about and nothing worth
 * marking them down for.
 */
export const TempoObservationSchema = z.object({
  fromBar: z.number().int().nonnegative(),
  toBar: z.number().int().nonnegative(),
  /** Negative is slower. -22 reads "slowed 22%". */
  percent: z.number(),
})
export type TempoObservation = z.infer<typeof TempoObservationSchema>

export const PracticeReportSchema = z.object({
  scoreId: z.string(),
  takeId: z.string(),
  /** One entry per bar in the timeline, in order. */
  bars: z.array(BarVerdictSchema),
  /**
   * Quarter notes per minute: the tempo the player actually **held**, taken
   * over the stretches where they were steady rather than fitted across the
   * whole take (ADR-0014). Same name and same units as before and a refined
   * meaning -- a false start or a ritardando no longer drags it, where one
   * line through everything read a take played at about 64 as 53. Anything
   * that describes this in words, the coach's summary included, should say
   * "the tempo you kept" rather than "your average tempo".
   *
   * Null when there is nothing to measure.
   */
  fittedTempo: z.number().nullable(),
  counts: z.object({
    correct: z.number().int().nonnegative(),
    wrongPitch: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
    extra: z.number().int().nonnegative(),
  }),
  /**
   * Where the player went back over music they had already played, in order.
   * The notes a restart accounts for are **not** in `counts.extra`: they were
   * correct notes played twice, which is care rather than error (ADR-0014).
   */
  restarts: z.array(RestartVerdictSchema),
  /** What the tempo did, where it did something. Bounded, and never a verdict. */
  tempoObservations: z.array(TempoObservationSchema),
  /** The first bar the matcher lost, or null when the take aligned throughout. */
  unalignableFromBar: z.number().int().nonnegative().nullable(),
})
export type PracticeReport = z.infer<typeof PracticeReportSchema>

/**
 * The `score` half of `window.api`, declared where both sides can see it.
 */
export interface ScoreApi {
  /** Opens a native file dialog in main; the renderer never sees a path. */
  import(): Promise<ScoreImportResult>
  list(): Promise<ScoreMeta[]>
  read(id: string): Promise<ScoreContent>
  /** Records what OSMD called the piece, once it has parsed it. */
  setTitle(id: string, title: string): Promise<ScoreMeta>
}
