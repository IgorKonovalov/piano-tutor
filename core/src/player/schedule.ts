import {
  CC_SOSTENUTO,
  CC_SUSTAIN,
  type MidiEvent,
  PEDAL_DOWN_THRESHOLD,
} from '../../../shared/midi'
import type {
  PlaybackSchedule,
  PlaybackSource,
  ScheduleBar,
  ScheduledEvent,
} from '../../../shared/player'

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

/**
 * Sort, then close whatever the source left open. The closing tail is the
 * reason this exists: it is where a crashed take's ringing chord is stopped,
 * in a pure function with a test, rather than on somebody's piano.
 */
export function normaliseSchedule(
  events: readonly ScheduledEvent[],
  source: PlaybackSource,
  bars: readonly ScheduleBar[] = []
): PlaybackSchedule {
  const ordered = sortScheduled(events)
  const draft: PlaybackSchedule = {
    source,
    durationMs: ordered[ordered.length - 1]?.at ?? 0,
    events: ordered,
    bars,
  }

  const outstanding = outstandingAtEnd(draft)
  if (outstanding.notes.length === 0 && outstanding.pedals.length === 0) return draft

  const releaseAt = draft.durationMs + TRUNCATED_TAIL_MS
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

  return { source, durationMs: releaseAt, events: [...ordered, ...tail], bars }
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
  source: PlaybackSource
): PlaybackSchedule {
  if (events.length === 0) return { source, durationMs: 0, events: [], bars: [] }

  let origin = Infinity
  for (const event of events) {
    if (event.t < origin) origin = event.t
  }

  const scheduled = events.map((event) => {
    const at = Math.max(0, event.t - origin)
    return { at, event: { ...event, t: at } }
  })
  return normaliseSchedule(scheduled, source)
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
