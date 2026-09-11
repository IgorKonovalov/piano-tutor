import type { TempoMark } from '../../../shared/score'
import { roundQuarters } from '../score/timeline'

/**
 * Where the page's tempo becomes milliseconds (ADR-0018): the one reader of a
 * timeline's `tempo` track and of its fermatas. Scoring never imports this
 * (ADR-0021), because a take is judged against its own tempo, not the page's.
 */

/**
 * How far a written *rit.* slows, or an *accel.* quickens, over its span, as a
 * fraction of the tempo it starts from. **Taste, not the page's**: a ramp word
 * says which way and not how much, just as a fermata says hold and not for how
 * long. Chosen blind, to be tuned at the piano; no test pins it to a musical
 * claim.
 */
export const RAMP_CHANGE = 0.2

/**
 * How long a fermata holds its note, as a multiple of the note's written
 * length. Taste, like `RAMP_CHANGE`: 2 holds a quarter for a half.
 */
export const FERMATA_HOLD = 2

const MS_PER_MINUTE = 60000

/**
 * One stretch of score time over which the tempo is steady or moves linearly,
 * in quarter notes and quarter notes per minute. The first starts at -Infinity
 * and the last runs to Infinity, both steady.
 */
interface Piece {
  from: number
  to: number
  start: number
  end: number
}

function tempoIn(piece: Piece, at: number): number {
  if (piece.start === piece.end) return piece.start
  return piece.start + ((piece.end - piece.start) * (at - piece.from)) / (piece.to - piece.from)
}

function tempoAt(pieces: readonly Piece[], at: number): number {
  const piece = pieces.find((p) => at < p.to) ?? pieces[pieces.length - 1]
  return piece === undefined ? NaN : tempoIn(piece, at)
}

/**
 * The written tempo as pieces, marks applied in the track's order. A mark
 * arriving mid-ramp cuts it where it has got to, so the next piece starts
 * from the tempo actually reached.
 */
function writtenPieces(tempo: readonly TempoMark[], fallbackBpm: number): Piece[] {
  const pieces: Piece[] = [{ from: -Infinity, to: Infinity, start: fallbackBpm, end: fallbackBpm }]
  let first: number | null = null
  let beforeRamp: number | null = null

  // A piece that starts exactly at `at` is kept, at zero length: it is a mark
  // already applied at this instant, and the next one starts from it.
  const cutAt = (at: number): number => {
    let last = pieces[pieces.length - 1]
    while (pieces.length > 1 && last !== undefined && last.from > at) {
      pieces.pop()
      last = pieces[pieces.length - 1]
    }
    if (last === undefined) return fallbackBpm
    const reached = tempoIn(last, at)
    last.to = at
    last.end = reached
    return reached
  }
  const steady = (at: number, bpm: number) => {
    pieces.push({ from: at, to: Infinity, start: bpm, end: bpm })
  }

  for (const mark of tempo) {
    const current = cutAt(mark.at)
    switch (mark.kind) {
      case 'metronome':
      case 'word':
        first ??= mark.bpm
        steady(mark.at, mark.bpm)
        break
      case 'ramp': {
        beforeRamp = current
        const target = current * (mark.direction === 'slower' ? 1 - RAMP_CHANGE : 1 + RAMP_CHANGE)
        if (mark.until > mark.at) {
          pieces.push({ from: mark.at, to: mark.until, start: current, end: target })
          steady(mark.until, target)
        } else {
          steady(mark.at, current)
        }
        break
      }
      case 'return':
        steady(mark.at, (mark.to === 'first' ? first : beforeRamp) ?? current)
        break
    }
  }
  return pieces
}

/**
 * The tempo the page asks for at a position, before any override: what the
 * transport shows as the value an override scales from.
 */
export function writtenTempoAt(
  tempo: readonly TempoMark[],
  at: number,
  fallbackBpm: number
): number {
  return tempoAt(writtenPieces(tempo, fallbackBpm), at)
}

/**
 * Milliseconds across part of one piece. A steady piece is a multiplication;
 * a ramp is integrated exactly, since the tempo moves linearly in score time:
 * `60000 * dq * ln(T1 / T0) / (T1 - T0)`. Sampling the tempo once per note
 * would make a note's time depend on how many notes came before it.
 */
function msAcross(piece: Piece, from: number, to: number): number {
  const t0 = tempoIn(piece, from)
  const t1 = tempoIn(piece, to)
  if (t0 === t1) return (to - from) * (MS_PER_MINUTE / t0)
  return (MS_PER_MINUTE * (to - from) * Math.log(t1 / t0)) / (t1 - t0)
}

export interface Fermata {
  onset: number
  duration: number
}

export interface TempoMapOptions {
  tempo: readonly TempoMark[]
  /** The range start, in quarters. Milliseconds are counted from here. */
  from: number
  /** The tempo before the page's first mark, and throughout a page with none. */
  fallbackBpm: number
  /**
   * The player's tempo. It replaces the written tempo at `from`, and every
   * tempo in the map scales by the same ratio, so a ramp keeps its shape.
   */
  overrideBpm?: number
  /** Notes with a fermata over them, in the range. */
  fermatas?: readonly Fermata[]
}

export interface TempoMap {
  /** Milliseconds from `from` to a position at or after it, holds included. */
  ms(at: number): number
  /** The tempo that plays at `from`: the override when there is one. */
  bpmAtStart: number
}

/**
 * A timeline's tempo as a function from quarters to milliseconds.
 *
 * Marks before `from` count: they settle the tempo in force there, the way the
 * pedal is settled at a range's start. A fermata inserts
 * `(FERMATA_HOLD - 1)` times its note's written length at that note's written
 * end, and everything at or after that instant moves later by it. Where
 * several fermata notes end at one instant the longest decides, once.
 */
export function tempoMap(options: TempoMapOptions): TempoMap {
  const written = writtenPieces(options.tempo, options.fallbackBpm)
  const writtenAtStart = tempoAt(written, options.from)
  const chosen = options.overrideBpm
  // Multiplied before divided, so that where the page is steady at W the
  // override O comes out as exactly O rather than W * (O / W).
  const scale = (bpm: number) => (chosen === undefined ? bpm : (bpm * chosen) / writtenAtStart)

  const pieces = written
    .filter((piece) => piece.to > options.from)
    .map((piece) => ({
      from: Math.max(piece.from, options.from),
      to: piece.to,
      start: scale(tempoIn(piece, Math.max(piece.from, options.from))),
      end: scale(piece.end),
    }))
  const reached: number[] = []
  let total = 0
  for (const piece of pieces) {
    reached.push(total)
    if (piece.to !== Infinity) total += msAcross(piece, piece.from, piece.to)
  }

  const base = (at: number): number => {
    let index = pieces.findIndex((piece) => at < piece.to)
    if (index === -1) index = pieces.length - 1
    const piece = pieces[index]
    if (piece === undefined) return 0
    return (reached[index] ?? 0) + msAcross(piece, piece.from, at)
  }

  const holdAt = new Map<number, number>()
  for (const note of options.fermatas ?? []) {
    const end = roundQuarters(note.onset + note.duration)
    const hold = (FERMATA_HOLD - 1) * (base(end) - base(note.onset))
    holdAt.set(end, Math.max(hold, holdAt.get(end) ?? 0))
  }
  const holds = [...holdAt].sort(([a], [b]) => a - b)

  return {
    ms(at) {
      let ms = base(at)
      for (const [end, hold] of holds) {
        if (end > at) break
        ms += hold
      }
      return ms
    },
    bpmAtStart: chosen ?? writtenAtStart,
  }
}
