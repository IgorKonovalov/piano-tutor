/**
 * One tempo, fitted after the match rather than assumed before it.
 *
 * The player is given no click, so nothing about the score says how fast it
 * should have gone. What can be said is whether they were **even**: fit a
 * single straight line from score position to wall-clock time over every pair
 * the matcher was confident about, and each bar's timing verdict is its
 * distance from that line. That is what turns "you rushed bar 12" into a
 * statement about the player rather than about a metronome they never heard.
 *
 * The cost of one line is that a rallentando reads as error, which is accepted
 * for this version and is the first thing Plan 0002 Phase 7 asks the player
 * about.
 */

export interface TempoPair {
  /** Quarter notes from the start of the piece. */
  onset: number
  /** Milliseconds, as the take recorded them. */
  t: number
}

export interface TempoFit {
  /** Quarter notes per minute. */
  qpm: number
  /** Milliseconds per quarter note: the slope of the fitted line. */
  msPerQuarter: number
  /** Where the line crosses onset zero, in milliseconds. */
  originMs: number
  /** Root-mean-square distance of the pairs from the line, in milliseconds. */
  rmsMs: number
  samples: number
}

/** Below this many matched groups a line through them means nothing. */
export const MIN_TEMPO_SAMPLES = 3

/**
 * Ordinary least squares of `t` on `onset`. Returns null rather than a
 * confident-looking number when there is nothing to fit: too few pairs, every
 * pair at the same score position, or a slope that says time ran backwards.
 */
export function fitTempo(pairs: readonly TempoPair[]): TempoFit | null {
  if (pairs.length < MIN_TEMPO_SAMPLES) return null

  const n = pairs.length
  let sumX = 0
  let sumY = 0
  for (const pair of pairs) {
    sumX += pair.onset
    sumY += pair.t
  }
  const meanX = sumX / n
  const meanY = sumY / n

  let covariance = 0
  let variance = 0
  for (const pair of pairs) {
    const dx = pair.onset - meanX
    covariance += dx * (pair.t - meanY)
    variance += dx * dx
  }
  if (variance === 0) return null

  const msPerQuarter = covariance / variance
  if (!Number.isFinite(msPerQuarter) || msPerQuarter <= 0) return null

  const originMs = meanY - msPerQuarter * meanX

  let squares = 0
  for (const pair of pairs) {
    const residual = pair.t - (msPerQuarter * pair.onset + originMs)
    squares += residual * residual
  }

  return {
    qpm: 60_000 / msPerQuarter,
    msPerQuarter,
    originMs,
    rmsMs: Math.sqrt(squares / n),
    samples: n,
  }
}

/** Milliseconds early (negative) or late (positive) against the fitted line. */
export function deviationMs(fit: TempoFit, pair: TempoPair): number {
  return pair.t - (fit.msPerQuarter * pair.onset + fit.originMs)
}
