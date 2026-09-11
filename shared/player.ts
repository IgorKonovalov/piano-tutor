import { z } from 'zod'
import { type MidiEvent, type MidiPort } from './midi'
import { ExpectedTimelineSchema } from './score'
import { TakeIdSchema, TakeReplayRequestSchema } from './take'

/**
 * The `player:*` domain (ADR-0007): what the app plays, as opposed to what the
 * player plays.
 *
 * Two kinds of shape live here and they are not interchangeable. **What
 * crosses IPC is Zod** — a play request, an output selection, the state push —
 * and is parsed once on receive. **The schedule is not**: it is built in main
 * by `core/` from the request and never leaves the process, so it is a plain
 * type. Giving it a schema would be validation theatre at a boundary it does
 * not cross.
 */

/**
 * What playback supplies where a score states nothing: a tempo before the
 * page's first tempo mark, and a velocity for a passage with no dynamic marked
 * (ADR-0005 keeps the timeline's onsets tempo-free; ADR-0018 adds the page's
 * own marks beside them). They are
 * constants here rather than choices made somewhere in the code, because a
 * score quietly acquiring a tempo or a loudness it never had is the failure
 * mode.
 */
export const DEFAULT_BPM = 80
export const MIN_BPM = 30
export const MAX_BPM = 240

/**
 * The velocity of a passage the page says nothing about: a staff with no
 * dynamic marked, or the notes before its first one. Where the page does mark
 * one, `scheduleFromTimeline` plays that instead (ADR-0018).
 */
export const PLAYBACK_VELOCITY = 72

/**
 * A note is released a little before its written end, so a repeated note
 * retriggers instead of merging into its neighbour. Whichever of the two is
 * smaller: at 80 bpm a quarter note is 750 ms and the gap is the full 30 ms,
 * at 160 bpm a semiquaver is 94 ms and the gap is 19 ms.
 */
export const RELEASE_GAP_MS = 30
export const RELEASE_GAP_FRACTION = 0.2

/** What an ornament gets, having no written duration of its own (ADR-0009). */
export const GRACE_NOTE_MS = 60

export function clampBpm(bpm: number): number {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, bpm))
}

/**
 * Milliseconds from the start of playback. The event inside carries the same
 * value in its own `t`, so a schedule is entirely relative-time; the `t` a
 * renderer finally sees is rewritten at dispatch to the epoch-anchored instant
 * the event actually went out.
 */
export interface ScheduledEvent {
  at: number
  event: MidiEvent
}

/** Where a schedule came from. Carried for the log and the state push. */
export type PlaybackSource =
  | { kind: 'timeline'; fromBar: number; toBar: number; bpm: number }
  | { kind: 'take'; takeId: string; speed: number }
  | { kind: 'scenario'; id: string }

/**
 * Where a bar of the source starts inside the schedule. Empty for a source
 * that has no bars, which is every source but a score's timeline. It is on the
 * schedule rather than computed by whoever pushes state because the schedule
 * is the only thing that knows both the bars and the milliseconds.
 */
export interface ScheduleBar {
  bar: number
  at: number
}

export interface PlaybackSchedule {
  source: PlaybackSource
  durationMs: number
  /**
   * Ordered by `at`, and within one `at` note-offs come before note-ons so a
   * repeated note releases before it restrikes. The invariant the whole design
   * exists to protect holds here: every note-on has a later note-off and
   * nothing is sounding when the last event has gone out.
   */
  events: readonly ScheduledEvent[]
  bars: readonly ScheduleBar[]
}

/**
 * What the renderer asks main to play. Validated once, on receive.
 *
 * The `timeline` variant carries the whole extracted timeline rather than a
 * score id, because the renderer is the only process that parses a score
 * (ADR-0005) and main has no way to produce one. It crosses the bridge once
 * per play, not per event: a 200-bar score is a few hundred kilobytes and this
 * is not a hot path.
 */
export const PlayRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('scenario'), id: z.string().min(1) }),
  z.object({
    kind: z.literal('timeline'),
    timeline: ExpectedTimelineSchema,
    /**
     * The player's tempo, when they set one. Absent, the page's own tempo
     * plays; present, it replaces the written tempo at `fromBar` and scales
     * the rest of the page's tempo with it (ADR-0018).
     */
    bpm: z.number().optional(),
    /** Inclusive, in OSMD's own bar numbering. */
    fromBar: z.number().int().nonnegative(),
    toBar: z.number().int().nonnegative(),
  }),
  /**
   * Playing a take **out** to the instrument, which is not `take:replay`.
   * That one feeds a recording back into the app's own input pipeline as if it
   * were being played (Plan 0001 Phase 5); this one sends it to the piano. The
   * id and the speed reuse the replay request's shapes, because an id is a
   * path segment and the range of speeds is the same question either way.
   */
  z.object({
    kind: z.literal('take'),
    takeId: TakeIdSchema.shape.id,
    speed: TakeReplayRequestSchema.shape.speed,
  }),
])
export type PlayRequest = z.infer<typeof PlayRequestSchema>

export const OpenOutputRequestSchema = z.object({ portId: z.string().min(1) })
export type OpenOutputRequest = z.infer<typeof OpenOutputRequestSchema>

/**
 * Pushed on `player:state` a few times a second, never per event. The
 * per-event traffic is `player:event`; this is the transport's own reading.
 */
export const PlayerStateSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('idle') }),
  z.object({
    state: z.literal('playing'),
    positionMs: z.number(),
    durationMs: z.number(),
    /** Null whenever the source has no bars to be in. */
    bar: z.number().int().nullable(),
  }),
])
export type PlayerState = z.infer<typeof PlayerStateSchema>

export const idlePlayerState: PlayerState = { state: 'idle' }

/**
 * The `player` half of `window.api`, declared where both sides can see it: the
 * preload binding is typed as this and the renderer's `Window` reads it.
 */
export interface PlayerApi {
  listOutputs(): Promise<MidiPort[]>
  openOutput(portId: string): Promise<void>
  closeOutput(): Promise<void>
  play(request: PlayRequest): Promise<void>
  stop(): Promise<void>
  /** Returns the cleanup that removes the listener. Always call it. */
  onEvent(cb: (event: MidiEvent) => void): () => void
  /** Returns the cleanup that removes the listener. Always call it. */
  onState(cb: (state: PlayerState) => void): () => void
}
