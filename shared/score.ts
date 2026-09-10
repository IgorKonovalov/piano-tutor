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
  /** Marked here, excluded from alignment scoring in this plan. */
  grace: z.boolean(),
})
export type ExpectedNote = z.infer<typeof ExpectedNoteSchema>

export const ExpectedBarSchema = z.object({
  index: z.number().int().nonnegative(),
  onset: z.number().nonnegative(),
  /**
   * The bar's own length in quarter notes, which is not always the metre: an
   * anacrusis is as long as what is written in it. Bars are contiguous, so
   * `onset + beats` of one bar is the `onset` of the next.
   */
  beats: z.number().positive(),
})
export type ExpectedBar = z.infer<typeof ExpectedBarSchema>

export const ExpectedTimelineSchema = z.object({
  scoreId: scoreId,
  /** Ordered by onset, then pitch. */
  notes: z.array(ExpectedNoteSchema),
  /** One entry per source measure, in order, with no index skipped. */
  bars: z.array(ExpectedBarSchema),
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
   * Mean signed distance of this bar's notes from the one fitted tempo, in
   * milliseconds. Negative is early. Zero when the bar has nothing to time.
   */
  timingDeviation: z.number(),
})
export type BarVerdict = z.infer<typeof BarVerdictSchema>

export const PracticeReportSchema = z.object({
  scoreId: z.string(),
  takeId: z.string(),
  /** One entry per bar in the timeline, in order. */
  bars: z.array(BarVerdictSchema),
  /** Quarter notes per minute, fitted after the match. Null if unfittable. */
  fittedTempo: z.number().nullable(),
  counts: z.object({
    correct: z.number().int().nonnegative(),
    wrongPitch: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
    extra: z.number().int().nonnegative(),
  }),
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
