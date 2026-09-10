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

/** How fast one bar went, and how far its notes reach past its first one. */
export interface BarPace {
  /** Milliseconds per quarter across this bar's own matched groups. */
  msPerQuarter: number
  /**
   * Mean distance, in quarter notes, of the bar's groups after the first from
   * that first one. It is what turns a difference in pace into a distance in
   * milliseconds, and it belongs to the bar rather than to the metre: a bar
   * whose notes are all near its start reaches less far than an even one.
   */
  spread: number
}

/**
 * Each bar's own pace, from the pairs inside it.
 *
 * A bar with fewer than two matched groups is absent: one chord says nothing
 * about pace. `fitTempo` is used where it will fit and a straight line through
 * the bar's first and last group where it will not -- two or three groups is
 * fewer than `MIN_TEMPO_SAMPLES`, and the caution that constant exercises is
 * about calling a handful of pairs a *tempo*, which is not the claim here.
 */
export function barPaces(pairs: readonly BarredPair[]): Map<number, BarPace> {
  const byBar = new Map<number, BarredPair[]>()
  for (const pair of pairs) {
    const own = byBar.get(pair.bar)
    if (own === undefined) byBar.set(pair.bar, [pair])
    else own.push(pair)
  }

  const paces = new Map<number, BarPace>()
  for (const [bar, own] of byBar) {
    if (own.length < 2) continue
    const msPerQuarter = fitTempo(own)?.msPerQuarter ?? straightPace(own)
    if (msPerQuarter === null) continue
    const from = (own[0] as BarredPair).onset
    const spread =
      own.slice(1).reduce((total, pair) => total + (pair.onset - from), 0) / (own.length - 1)
    paces.set(bar, { msPerQuarter, spread })
  }
  return paces
}

function straightPace(own: readonly BarredPair[]): number | null {
  const first = own[0]
  const last = own[own.length - 1]
  if (first === undefined || last === undefined) return null
  const quarters = last.onset - first.onset
  if (quarters <= 0) return null
  const pace = (last.t - first.t) / quarters
  return pace > 0 ? pace : null
}

/**
 * A gap this many times the pace the player was mostly keeping, or this many
 * times shorter, was not the tempo: it is the seam of a restart, a page turn,
 * or a bar taken at half speed while the fingering was worked out. Half again
 * is a wide margin on purpose -- rubato has to survive it, and what has to be
 * thrown out is the five-fold jump a false start leaves.
 */
export const STEADY_FACTOR = 1.5

/**
 * The tempo the player actually **held**: the pace over the stretches where
 * they were steady, in quarter notes per minute.
 *
 * One line fitted across a whole take is an average of a performance and
 * whatever interrupted it, and ADR-0014's measurement is what that costs -- a
 * take played at about 64 read as 53 because the player went back over a bar.
 * So the gaps that were plainly not the tempo are thrown out first, against a
 * median of all of them, and what is reported is the aggregate pace over what
 * is left. A median decides what to keep, because a mean of the gaps is what
 * the restart dragged in the first place.
 *
 * Null when there is nothing to measure: fewer than two matched groups, or no
 * pair of them at different score positions.
 */
export function steadyTempo(pairs: readonly BarredPair[]): number | null {
  const gaps: { quarters: number; ms: number; pace: number }[] = []
  for (let i = 1; i < pairs.length; i++) {
    const from = pairs[i - 1] as BarredPair
    const to = pairs[i] as BarredPair
    const pace = paceBetween(from, to)
    if (pace === null) continue
    gaps.push({ quarters: to.onset - from.onset, ms: to.t - from.t, pace })
  }

  const typical = median(gaps.map((gap) => gap.pace))
  if (typical === null) return null

  let quarters = 0
  let ms = 0
  for (const gap of gaps) {
    if (gap.pace > typical * STEADY_FACTOR || gap.pace * STEADY_FACTOR < typical) continue
    quarters += gap.quarters
    ms += gap.ms
  }
  if (quarters <= 0 || ms <= 0) return null
  return 60_000 / (ms / quarters)
}

/**
 * What the tempo did over a span: information, never a verdict.
 *
 * A player who slows into a cadence has not made a mistake, and ADR-0014 is
 * about not calling it one. But it is worth telling them, because it is the
 * kind of thing a teacher says and the kind of thing a player does without
 * knowing. No bar's state changes because one of these exists.
 */
export interface TempoObservation {
  fromBar: number
  toBar: number
  /** Negative is slower. -22 reads "slowed 22%". */
  percent: number
}

/**
 * How much one bar's pace must differ from the one before it to count as the
 * tempo having moved rather than as a hand being human. Two per cent is over
 * four times the spread a steady take shows across the fixtures, and well
 * under what any listener would call a change.
 */
export const TEMPO_STEP_TOLERANCE = 0.02

/**
 * How far the tempo must have travelled across a run before it is worth a
 * sentence, and how many bars the run must cover. Eight per cent over three
 * bars of pace is about the smallest ritardando a listener would name; below
 * it the app would be telling a player that their steady playing was not.
 */
export const MIN_TEMPO_CHANGE_PERCENT = 8
export const MIN_OBSERVATION_PACES = 3

/** More than this and the observations stop being information and become a wall. */
export const MAX_TEMPO_OBSERVATIONS = 2

/**
 * The largest few monotonic runs in the bar-pace curve, worst first.
 *
 * A run of `n` bar paces describes a change over the **last `n - 1`** of them:
 * the first bar is the tempo it changed *from*, not part of the change. That
 * is why "slowed 30% over bars 1 to 3" comes out of a run that begins at bar 0.
 */
export function tempoObservations(paces: ReadonlyMap<number, BarPace>): TempoObservation[] {
  const bars = [...paces.keys()].sort((a, b) => a - b)

  /**
   * One entry per step from one bar to the next, in order: which way the tempo
   * moved, or 0 for a step too small to be anything but a hand being human.
   * A step over a bar the take skipped is not a step at all -- a pace two bars
   * later is a different stretch of music -- and ends whatever run it was in.
   */
  const directions: number[] = []
  for (let i = 1; i < bars.length; i++) {
    const from = paces.get(bars[i - 1] as number)
    const to = paces.get(bars[i] as number)
    const contiguous = (bars[i] as number) === (bars[i - 1] as number) + 1
    if (from === undefined || to === undefined || !contiguous) {
      directions.push(0)
      continue
    }
    const step = to.msPerQuarter / from.msPerQuarter - 1
    directions.push(Math.abs(step) < TEMPO_STEP_TOLERANCE ? 0 : Math.sign(step))
  }

  const found: TempoObservation[] = []
  let at = 0
  while (at < directions.length) {
    const direction = directions[at] as number
    if (direction === 0) {
      at++
      continue
    }
    let end = at
    while (end + 1 < directions.length && directions[end + 1] === direction) end++

    // A run of `k` steps spans `k + 1` paces, and the first of those is the
    // tempo it changed *from* rather than part of the change: that is why
    // "slowed 30% over bars 1 to 3" comes out of a run beginning at bar 0.
    const steps = end - at + 1
    const fromPace = paces.get(bars[at] as number)
    const toPace = paces.get(bars[end + 1] as number)
    if (steps + 1 >= MIN_OBSERVATION_PACES && fromPace !== undefined && toPace !== undefined) {
      // Pace is milliseconds per quarter, so the tempo moves the other way.
      const percent = Math.round((fromPace.msPerQuarter / toPace.msPerQuarter - 1) * 100)
      if (Math.abs(percent) >= MIN_TEMPO_CHANGE_PERCENT) {
        found.push({
          fromBar: (bars[at] as number) + 1,
          toBar: bars[end + 1] as number,
          percent,
        })
      }
    }
    at = end + 1
  }

  return found
    .sort((a, b) => Math.abs(b.percent) - Math.abs(a.percent))
    .slice(0, MAX_TEMPO_OBSERVATIONS)
}
