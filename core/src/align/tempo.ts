/**
 * Tempo, fitted after the match rather than assumed before it.
 *
 * The player is given no click, so nothing about the score says how fast it
 * should have gone. What can be said is whether they were **even**: fit a
 * straight line from score position to wall-clock time over the pairs the
 * matcher was confident about, and read a bar's timing as its distance from
 * it. That is what turns "you rushed bar 12" into a statement about the player
 * rather than about a metronome they never heard.
 *
 * `fitTempo` fits **one** line over whatever it is given. It is the right tool
 * for a figure about a whole stretch and the wrong one for judging a bar, for
 * the reasons ADR-0014 sets out; `localTempo`, below, is what a bar is judged
 * against.
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

/**
 * Milliseconds early (negative) or late (positive) against a fitted line --
 * one over the whole take or one bar's local reference, since both are lines.
 */
export function deviationMs(
  line: Pick<TempoFit, 'msPerQuarter' | 'originMs'>,
  pair: TempoPair
): number {
  return pair.t - (line.msPerQuarter * pair.onset + line.originMs)
}

/**
 * A local reference, and why there is one.
 *
 * One line through a whole take cannot represent a player who went back over a
 * bar -- that gives one score position two different times -- and it reads a
 * rallentando as error. Worse, least squares is global, so a disturbance
 * anywhere moves the line everywhere: bars played *before* a false start were
 * flagged for it, and the player had no way back to right timing (ADR-0014).
 *
 * So a bar is judged against the tempo its **neighbours** were keeping.
 */

/** A matched pair that remembers which bar the score put it in. */
export interface BarredPair extends TempoPair {
  bar: number
}

/** The reference one bar is judged against. Shaped like a `TempoFit` on purpose. */
export interface LocalTempo {
  bar: number
  qpm: number
  msPerQuarter: number
  /** Where the line crosses onset zero, in milliseconds. */
  originMs: number
  /** Gaps the reference was taken over, all of them outside this bar. */
  samples: number
}

/**
 * How many bars either side of the bar under test the reference is drawn from.
 *
 * One: the bar before and the bar after. Wide enough that there is a pace to
 * find once the bar itself is taken out, and narrow enough that the reference
 * is about the music around this bar rather than about the piece. Balancing
 * the two sides (below) is what makes the exact width uncritical, so this is a
 * choice about locality and not a tuning knob.
 *
 * Assert the *effects* of this number and never the number itself, so tuning
 * it cannot make a test pass that should not.
 */
export const LOCAL_WINDOW_BARS = 1

/**
 * How many gaps each side of the bar the reference needs before it is a
 * reference at all. Two, for the reason `MIN_TEMPO_SAMPLES` is three: below it
 * the figure is arithmetic on noise, and a bar that reports no verdict is
 * honest where a confident one from a single gap is not.
 */
export const MIN_LOCAL_GAPS = 2

export interface LocalTempoOptions {
  windowBars?: number
}

/** Milliseconds per quarter between two consecutive pairs, or null if there is none. */
function paceBetween(from: TempoPair, to: TempoPair): number | null {
  const quarters = to.onset - from.onset
  if (quarters <= 0) return null
  const pace = (to.t - from.t) / quarters
  return pace > 0 ? pace : null
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] as number
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
}

/**
 * The tempo the bars around `bar` were keeping, as a line through `bar`'s own
 * first note.
 *
 * Three decisions carry this, and all three are load-bearing.
 *
 * **The window excludes the bar under test.** A line fitted from data that
 * includes the bar moves to meet it, and nothing can then deviate from a line
 * drawn partly through itself. Leaving it out is what makes "you rushed bar
 * 12" a statement about bar 12.
 *
 * **The pace is the median of the gaps either side, taking the same number
 * from each side.** Not least squares, for two reasons that ADR-0014's
 * measurement is made of. A median ignores the one enormous gap a restart or a
 * hesitation leaves behind, where a fit swallows it and then reports the bars
 * beside it as a second of error each. And taking an equal count from each
 * side is what makes the estimate unbiased while the player is slowing: the
 * gaps run in order, so their middle value is the pace beside this bar, while
 * a fit over an unequal window returns the average of a stretch that is faster
 * at one end than the other. Both together are why a rallentando is followed
 * rather than punished.
 *
 * **The line is anchored at the bar's first matched pair**, taking only the
 * pace from the neighbours. Where the bar *began* is not this bar's business
 * -- a player who paused, or went back and started again, arrives late through
 * no fault of the bar they are about to play. Anchoring is what lets the
 * player get back to right timing after going wrong. What is left is the
 * question worth asking: given the pace around it, did this bar's notes fall
 * where they should have relative to its own first one?
 *
 * Null when either side is too thin -- the first and last bars of a take
 * always are, and so is a bar of a piece that puts one chord in each bar.
 * ADR-0014: no verdict beats a confident one from nothing.
 */
export function localTempo(
  pairs: readonly BarredPair[],
  bar: number,
  options: LocalTempoOptions = {}
): LocalTempo | null {
  const width = options.windowBars ?? LOCAL_WINDOW_BARS
  const first = pairs.findIndex((pair) => pair.bar === bar)
  if (first < 0) return null
  let last = first
  while (pairs[last + 1]?.bar === bar) last++

  const inWindow = (index: number): boolean => {
    const pair = pairs[index]
    return pair !== undefined && Math.abs(pair.bar - bar) <= width
  }

  // Nearest gap first, on each side, so that trimming to a common length
  // keeps the reference centred on the bar.
  const before: number[] = []
  for (let i = first; i > 0 && inWindow(i - 1); i--) {
    const pace = paceBetween(pairs[i - 1] as BarredPair, pairs[i] as BarredPair)
    if (pace !== null) before.push(pace)
  }
  const after: number[] = []
  for (let i = last; i + 1 < pairs.length && inWindow(i + 1); i++) {
    const pace = paceBetween(pairs[i] as BarredPair, pairs[i + 1] as BarredPair)
    if (pace !== null) after.push(pace)
  }

  const each = Math.min(before.length, after.length)
  if (each < MIN_LOCAL_GAPS) return null

  const msPerQuarter = median([...before.slice(0, each), ...after.slice(0, each)])
  if (msPerQuarter === null || !Number.isFinite(msPerQuarter) || msPerQuarter <= 0) return null

  const anchor = pairs[first] as BarredPair
  return {
    bar,
    qpm: 60_000 / msPerQuarter,
    msPerQuarter,
    originMs: anchor.t - msPerQuarter * anchor.onset,
    samples: each * 2,
  }
}

/** Every bar's local reference, in bar order. Bars with too little evidence are absent. */
export function localTempoCurve(
  pairs: readonly BarredPair[],
  bars: readonly number[],
  options: LocalTempoOptions = {}
): Map<number, LocalTempo> {
  const curve = new Map<number, LocalTempo>()
  for (const bar of bars) {
    const local = localTempo(pairs, bar, options)
    if (local !== null) curve.set(bar, local)
  }
  return curve
}
