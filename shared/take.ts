import { z } from 'zod'
import { MidiEventSchema } from './midi'

/**
 * A take is JSON Lines: one header line, then one `MidiEvent` per line with
 * its time relative to the header's start.
 *
 * Append-only and line-oriented on purpose. A crash costs at most the events
 * since the last flush plus a half-written final line, and a half-written line
 * is a line the reader can drop -- which is what makes NFR 8 a property of the
 * format rather than a promise about shutdown.
 */
export const TAKE_FORMAT_VERSION = 1

export const TakeHeaderSchema = z.object({
  format: z.literal(TAKE_FORMAT_VERSION),
  /** ISO 8601, wall clock, for display and ordering only. */
  startedAt: z.string(),
  /**
   * The port id verbatim, `virtual:dense-2000` included. A generated take says
   * so here and is never mistaken for something a person played (ADR-0004).
   */
  port: z.string(),
  portName: z.string(),
  appVersion: z.string(),
  /**
   * The score this take was played against, or null for free play.
   *
   * Additive, and deliberately not a format bump: a take written before this
   * field existed reads back with `null` here and is otherwise unchanged, so
   * every take already on disk stays openable. `TAKE_FORMAT_VERSION` moves
   * when an existing field changes meaning, which is the case a reader cannot
   * recover from.
   */
  scoreId: z.string().nullable().default(null),
})
export type TakeHeader = z.infer<typeof TakeHeaderSchema>

/** One row of the takes list. Derived from the file; never stored. */
export const TakeSummaryRowSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  port: z.string(),
  portName: z.string(),
  /** From the first event to the last, in milliseconds. */
  durationMs: z.number(),
  noteCount: z.number(),
  eventCount: z.number(),
  /** True when the port id names a generated scenario rather than a device. */
  synthetic: z.boolean(),
  /** The score it was played against, or null for free play. */
  scoreId: z.string().nullable(),
})
export type TakeSummaryRow = z.infer<typeof TakeSummaryRowSchema>

export const TakeSummaryListSchema = z.array(TakeSummaryRowSchema)

export const TakeContentSchema = z.object({
  header: TakeHeaderSchema,
  events: z.array(MidiEventSchema),
  /** Lines that would not parse. A crash leaves at most one, at the end. */
  skippedLines: z.number(),
})
export type TakeContent = z.infer<typeof TakeContentSchema>

/**
 * A take id is a **path segment, never a path**. It is the take's start time
 * with the characters Windows will not put in a filename swapped for hyphens
 * (`takeIdFor`), so it is exactly this shape and nothing else.
 *
 * The pattern is the boundary check, not a formatting nicety: main turns an id
 * straight into a path under `userData/takes`, and a bare `string().min(1)`
 * would let `../../…` out of that directory. Validating the shape here means
 * one parse at the seam decides it, rather than the filesystem deciding it by
 * failing.
 */
export const TAKE_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/

const takeId = z.string().regex(TAKE_ID_PATTERN)

export const TakeIdSchema = z.object({ id: takeId })

/**
 * What closing a recording port hands back: the take main actually wrote.
 *
 * It exists because the renderer cannot work it out. Inferring "the newest
 * take of this score" reaches for a *previous* take whenever this session was
 * too short to keep, and then shows a report about a performance that is not
 * the one the player just gave.
 *
 * There is deliberately **no path here.** Main writes the file and the
 * renderer addresses it by id (ADR-0001); a filesystem path crossing this
 * boundary is the thing the whole shell is arranged to prevent.
 */
export const RecordedTakeResultSchema = z.object({
  id: takeId,
  noteCount: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  /**
   * True when the session was too short to keep and its file was removed. The
   * id then names a take that is not on disk, which is exactly what the view
   * needs to know to say so rather than to show something else.
   */
  discarded: z.boolean(),
})
export type RecordedTakeResult = z.infer<typeof RecordedTakeResultSchema>

/** `null` when the port was not recording: a replay, or a closed-twice port. */
export const RecordedTakeResultOrNullSchema = RecordedTakeResultSchema.nullable()

/** 0.5x, 1x and 2x are the speeds the replay view offers. */
export const TakeReplayRequestSchema = z.object({
  id: takeId,
  speed: z.number().min(0.25).max(4),
})
export type TakeReplayRequest = z.infer<typeof TakeReplayRequestSchema>

/**
 * The `take` half of `window.api`, declared where both sides can see it.
 */
export interface TakeApi {
  list(): Promise<TakeSummaryRow[]>
  load(id: string): Promise<TakeContent>
  /** Plays the take back through the same pipeline a device feeds. */
  replay(id: string, speed: number): Promise<void>
  stopReplay(): Promise<void>
}
