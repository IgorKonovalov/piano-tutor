import {
  CC_SOSTENUTO,
  CC_SUSTAIN,
  type MidiEvent,
  PEDAL_DOWN_THRESHOLD,
} from '../../../shared/midi'
import {
  DEFAULT_BPM,
  GRACE_NOTE_MS,
  PLAYBACK_VELOCITY,
  type PlaybackSchedule,
  type PlaybackSource,
  RELEASE_GAP_FRACTION,
  RELEASE_GAP_MS,
  type ScheduleBar,
  type ScheduledEvent,
  clampBpm,
} from '../../../shared/player'
import type { ExpectedTimeline } from '../../../shared/score'

/**
 * A schedule is the whole of playback that can be got wrong without a device
 * (ADR-0007). The clock in main only reads it out; everything decided here —
 * what order events go in, and above all that nothing is left sounding — is a
 * property of a value with fixture tests behind it.
 *
 * The invariant: **every note this schedule starts, it also stops, and by the
 * last event nothing is sounding and no pedal is down.** It is enforced by
 * construction in `normaliseSchedule` and readable back out through
 * `outstandingAtEnd`, so a test can assert it over any schedule the suite
 * builds rather than over the two the author remembered.
 */

/**
 * How long a note the source never released is given before it is closed.
 *
 * Releasing it at the schedule's last instant would make it a click, and a
 * take cut short by a crash (NFR 8 loses at most the last flush) is the
 * ordinary way a note-on arrives with no note-off after it. The length is
 * arbitrary and only ever affects a truncated source; it is a constant so that
 * the schedule stays a pure function of its input.
 */
export const TRUNCATED_TAIL_MS = 200

/**
 * Everything the app plays goes out on channel 1. The timeline carries a
 * `staff`, so playing one hand would be a filter rather than a feature, and
 * nothing in this plan asks for it.
 */
export const PLAYBACK_CHANNEL = 0

/**
 * Order inside one millisecond. A note-off ahead of a note-on is what lets a
 * repeated note release before it restrikes instead of merging into its
 * neighbour; a controller between them puts a pedal down before the chord it
 * is meant to hold. Everything else keeps the order it arrived in, which
 * `Array.prototype.sort` guarantees by being stable.
 */
function rank(event: MidiEvent): number {
  if (event.kind === 'noteOff') return 0
  if (event.kind === 'noteOn') return 2
  return 1
}

/** One key of one channel. Two zones can hold the same note number. */
function voiceKey(ch: number, note: number): number {
  return ch * 128 + note
}

interface Voice {
  ch: number
  note: number
}

export interface Outstanding {
  /** Notes still sounding when the schedule ends. Empty is the invariant. */
  notes: readonly Voice[]
  /** Pedals still down when the schedule ends; they hold notes too. */
  pedals: readonly { ch: number; controller: number }[]
}

/**
 * Read the invariant back out of a finished schedule. A note-off under a held
 * sustain pedal does not stop the sound on a real instrument, which is why a
 * pedal left down counts as outstanding just as a note does.
 */
export function outstandingAtEnd(schedule: PlaybackSchedule): Outstanding {
  const sounding = new Map<number, Voice>()
  const pedals = new Map<number, { ch: number; controller: number }>()

  for (const { event } of schedule.events) {
    switch (event.kind) {
      case 'noteOn':
        sounding.set(voiceKey(event.ch, event.note), { ch: event.ch, note: event.note })
        break
      case 'noteOff':
        sounding.delete(voiceKey(event.ch, event.note))
        break
      case 'cc': {
        if (event.controller !== CC_SUSTAIN && event.controller !== CC_SOSTENUTO) break
        const key = voiceKey(event.ch, event.controller)
        if (event.value >= PEDAL_DOWN_THRESHOLD) {
          pedals.set(key, { ch: event.ch, controller: event.controller })
        } else {
          pedals.delete(key)
        }
        break
      }
      default:
        break
    }
  }

  return { notes: [...sounding.values()], pedals: [...pedals.values()] }
}

function sortScheduled(events: readonly ScheduledEvent[]): ScheduledEvent[] {
  return [...events].sort((a, b) => a.at - b.at || rank(a.event) - rank(b.event))
}

export interface NormaliseOptions {
  bars?: readonly ScheduleBar[]
  /**
   * The written length of what is being played, when that is longer than its
   * last event -- a bar range whose final note is released a release-gap early
   * still lasts to the barline, and the transport's reading should say so.
   */
  durationMs?: number
}

/**
 * Sort, then close whatever the source left open. The closing tail is the
 * reason this exists: it is where a crashed take's ringing chord is stopped,
 * in a pure function with a test, rather than on somebody's piano.
 */
export function normaliseSchedule(
  events: readonly ScheduledEvent[],
  source: PlaybackSource,
  options: NormaliseOptions = {}
): PlaybackSchedule {
  const bars = options.bars ?? []
  const ordered = sortScheduled(events)
  const draft: PlaybackSchedule = {
    source,
    durationMs: Math.max(ordered[ordered.length - 1]?.at ?? 0, options.durationMs ?? 0),
    events: ordered,
    bars,
  }

  const outstanding = outstandingAtEnd(draft)
  if (outstanding.notes.length === 0 && outstanding.pedals.length === 0) return draft

  const lastAt = ordered[ordered.length - 1]?.at ?? 0
  const releaseAt = lastAt + TRUNCATED_TAIL_MS
  const tail: ScheduledEvent[] = []
  // Notes first, then the pedals that were holding them: the same order the
  // sink's own panic uses, so the two paths cannot disagree about what silence
  // looks like.
  for (const voice of [...outstanding.notes].sort((a, b) => a.ch - b.ch || a.note - b.note)) {
    tail.push({
      at: releaseAt,
      event: { kind: 'noteOff', t: releaseAt, ch: voice.ch, note: voice.note, velocity: 0 },
    })
  }
  for (const pedal of [...outstanding.pedals].sort(
    (a, b) => a.ch - b.ch || a.controller - b.controller
  )) {
    tail.push({
      at: releaseAt,
      event: { kind: 'cc', t: releaseAt, ch: pedal.ch, controller: pedal.controller, value: 0 },
    })
  }

  return {
    source,
    durationMs: Math.max(releaseAt, options.durationMs ?? 0),
    events: [...ordered, ...tail],
    bars,
  }
}

/**
 * A recorded take or a generated scenario into a schedule. Both arrive already
 * stamped in milliseconds, so this is a rebase and a normalisation rather than
 * a computation: the first event lands at `at: 0` and every `t` is rewritten to
 * match its `at`, leaving no absolute time inside a value that is entirely
 * about offsets.
 */
export function scheduleFromEvents(
  events: readonly MidiEvent[],
  source: PlaybackSource,
  /** Above 1 plays faster; every recorded interval scales by 1/speed. */
  speed = 1
): PlaybackSchedule {
  if (events.length === 0) return { source, durationMs: 0, events: [], bars: [] }

  let origin = Infinity
  for (const event of events) {
    if (event.t < origin) origin = event.t
  }

  const scheduled = events.map((event) => {
    const at = Math.max(0, event.t - origin) / speed
    return { at, event: { ...event, t: at } }
  })
  return normaliseSchedule(scheduled, source)
}

export interface TimelineScheduleOptions {
  /** Quarter notes per minute. Clamped; the timeline states none (ADR-0005). */
  bpm?: number
  velocity?: number
  /** Inclusive, in OSMD's own bar numbering. Defaults to the whole piece. */
  fromBar?: number
  toBar?: number
}

/**
 * A score into something that can be played: the one place quarter notes
 * become milliseconds.
 *
 * Every number it invents is one the score does not carry -- a tempo, a
 * velocity, a length for an ornament, a gap before a repeated note -- and each
 * is a named constant in `shared/player.ts` rather than a literal here, so
 * that "the score said so" and "we chose this" stay distinguishable.
 *
 * A bar range is clipped by the **bar's** onset, not by its first note: a bar
 * that opens with a rest opens with a rest. A note tied across the end of the
 * range plays out rather than being cut in half, and the schedule's duration
 * covers it.
 */
export function scheduleFromTimeline(
  timeline: ExpectedTimeline,
  options: TimelineScheduleOptions = {}
): PlaybackSchedule {
  const bpm = clampBpm(options.bpm ?? DEFAULT_BPM)
  const velocity = options.velocity ?? PLAYBACK_VELOCITY
  const msPerQuarter = 60000 / bpm

  const first = options.fromBar ?? timeline.bars[0]?.index ?? 0
  const last = options.toBar ?? timeline.bars[timeline.bars.length - 1]?.index ?? first
  const selected = timeline.bars.filter((bar) => bar.index >= first && bar.index <= last)

  const source: PlaybackSource = { kind: 'timeline', fromBar: first, toBar: last, bpm }
  if (selected.length === 0) return { source, durationMs: 0, events: [], bars: [] }

  const originQuarters = selected[0]?.onset ?? 0
  const endBar = selected[selected.length - 1]
  const endQuarters = endBar === undefined ? originQuarters : endBar.onset + endBar.beats

  const events: ScheduledEvent[] = []
  for (const note of timeline.notes) {
    if (note.bar < first || note.bar > last) continue
    // A scored note carrying an ornament is sounded by its realisation, which
    // follows it in the timeline and re-strikes its pitch (ADR-0018). Sounding
    // it too would hold a key the ornament is about to strike again.
    if (!note.optional && note.ornament !== null) continue

    const at = (note.onset - originQuarters) * msPerQuarter
    // A tie is already summed by the timeline, so it is one strike of one key.
    // A grace note has no length of its own; a realised ornament note does.
    const grace = note.optional && note.ornament === null
    const sounding =
      grace || note.duration === 0 ? GRACE_NOTE_MS : note.duration * msPerQuarter
    const gap = Math.min(RELEASE_GAP_MS, RELEASE_GAP_FRACTION * sounding)
    const offAt = at + sounding - gap

    events.push({
      at,
      event: { kind: 'noteOn', t: at, ch: PLAYBACK_CHANNEL, note: note.midi, velocity },
    })
    events.push({
      at: offAt,
      event: { kind: 'noteOff', t: offAt, ch: PLAYBACK_CHANNEL, note: note.midi, velocity: 0 },
    })
  }

  const bars: ScheduleBar[] = selected.map((bar) => ({
    bar: bar.index,
    at: (bar.onset - originQuarters) * msPerQuarter,
  }))

  return normaliseSchedule(events, source, {
    bars,
    durationMs: (endQuarters - originQuarters) * msPerQuarter,
  })
}

/** The bar sounding at a position, or null when the source has no bars. */
export function barAt(schedule: PlaybackSchedule, positionMs: number): number | null {
  let current: number | null = null
  for (const bar of schedule.bars) {
    if (bar.at > positionMs) break
    current = bar.bar
  }
  return current
}
