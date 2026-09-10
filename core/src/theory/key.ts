import type { MidiEvent } from '../../../shared/midi'

/**
 * Which key the playing is in, by Krumhansl-Schmuckler correlation of a
 * pitch-class histogram against the twenty-four major and minor profiles.
 *
 * Pure and deterministic: the histogram is a function of the event list and
 * their own timestamps. Nothing here reads a clock, so the same take estimates
 * the same key on any machine and in any test.
 */

/**
 * Krumhansl and Kessler's probe-tone ratings (1982), indexed from the tonic.
 * These are the published constants, not tuned values; changing one changes
 * every key estimate the app has ever made.
 */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_TONIC_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/**
 * How long a note keeps half its weight. Eight seconds of playing is about a
 * phrase: long enough that a passing chromatic run does not move the key,
 * short enough that a modulation shows within a few bars.
 */
export const HALF_LIFE_MS = 8000

/**
 * Below this correlation the label is shown greyed rather than asserted. Two
 * notes correlate with almost everything; the threshold is what stops the
 * label flickering between keys while a phrase is still only a few notes old.
 */
export const KEY_CONFIDENCE_THRESHOLD = 0.55

export type KeyMode = 'major' | 'minor'

export interface KeyEstimate {
  tonic: string
  mode: KeyMode
  /** 'F major', for display. */
  name: string
  /** The winning correlation, clamped to [0, 1]. */
  confidence: number
  /** True when confidence clears the display threshold. */
  confident: boolean
}

/**
 * Weighted count per pitch class. Each note-on contributes its decayed weight
 * at `now`; `now` defaults to the last event's own timestamp, which is what
 * keeps this a pure function of the take.
 */
export function pitchClassHistogram(events: readonly MidiEvent[], now?: number): number[] {
  const histogram = new Array<number>(12).fill(0)
  const last = events.length === 0 ? 0 : (events[events.length - 1]?.t ?? 0)
  const reference = now ?? last

  for (const event of events) {
    if (event.kind !== 'noteOn') continue
    const age = reference - event.t
    if (age < 0) continue
    histogram[event.note % 12] += Math.pow(0.5, age / HALF_LIFE_MS)
  }
  return histogram
}

function correlate(histogram: readonly number[], profile: readonly number[], rotation: number) {
  const n = 12
  let sumX = 0
  let sumY = 0
  for (let i = 0; i < n; i++) {
    sumX += histogram[(i + rotation) % n] ?? 0
    sumY += profile[i] ?? 0
  }
  const meanX = sumX / n
  const meanY = sumY / n

  let covariance = 0
  let varianceX = 0
  let varianceY = 0
  for (let i = 0; i < n; i++) {
    const dx = (histogram[(i + rotation) % n] ?? 0) - meanX
    const dy = (profile[i] ?? 0) - meanY
    covariance += dx * dy
    varianceX += dx * dx
    varianceY += dy * dy
  }
  if (varianceX === 0 || varianceY === 0) return 0
  return covariance / Math.sqrt(varianceX * varianceY)
}

export function estimateKeyFromHistogram(histogram: readonly number[]): KeyEstimate | null {
  if (histogram.every((value) => value === 0)) return null

  let best: { tonic: number; mode: KeyMode; r: number } | null = null
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, profile] of [
      ['major', MAJOR_PROFILE],
      ['minor', MINOR_PROFILE],
    ] as const) {
      const r = correlate(histogram, profile, tonic)
      if (best === null || r > best.r) best = { tonic, mode, r }
    }
  }
  if (best === null) return null

  // A minor key is spelled from the flat side more often than not (D minor,
  // not C## minor); major keys keep the sharp names unless the estimate is one
  // of the conventional flat tonics.
  const names = best.mode === 'minor' ? FLAT_TONIC_NAMES : PITCH_CLASS_NAMES
  const tonicName = names[best.tonic] ?? 'C'
  const confidence = Math.max(0, Math.min(1, best.r))

  return {
    tonic: tonicName,
    mode: best.mode,
    name: `${tonicName} ${best.mode}`,
    confidence,
    confident: confidence >= KEY_CONFIDENCE_THRESHOLD,
  }
}

export function estimateKey(events: readonly MidiEvent[], now?: number): KeyEstimate | null {
  return estimateKeyFromHistogram(pitchClassHistogram(events, now))
}
