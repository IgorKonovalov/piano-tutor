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

/** What OSMD reads. The library stores whatever was imported, unmodified. */
export const SCORE_EXTENSIONS = ['.musicxml', '.xml', '.mxl'] as const
export const ScoreExtensionSchema = z.enum(SCORE_EXTENSIONS)
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
