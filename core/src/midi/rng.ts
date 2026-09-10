/**
 * A seeded pseudo-random source. `core/` is deterministic (ADR-0001), so
 * nothing here reaches for `Math.random`: a scenario, and later an exercise,
 * is a function of its seed and reproduces byte for byte on any machine.
 *
 * mulberry32: one 32-bit state word, a well-distributed generator that is a
 * few lines rather than a dependency. Not for anything cryptographic.
 */
export interface Rng {
  /** [0, 1) */
  next(): number
  /** An integer in [min, max], both ends included. */
  int(min: number, max: number): number
  /** One of the items, uniformly. */
  pick<T>(items: readonly T[]): T
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1))
  return {
    next,
    int,
    pick: <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T,
  }
}
