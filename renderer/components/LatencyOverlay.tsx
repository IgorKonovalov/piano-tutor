import type { LatencyStats } from '../hooks/useMidiEvents'
import styles from './LatencyOverlay.module.css'

/**
 * Arrival in main to the frame that first shows the key, over the last 500
 * note-ons. Dev-only.
 *
 * Two units, because they answer different questions. **Frames** (NFR 11) hold
 * on any machine and are what an unattended run checks: one frame at 60 Hz is
 * 16.7 ms and the floor is 1, because an event cannot paint in the frame
 * already being composited. A regression that adds a debounce, a synchronous
 * parse on the paint path or a re-render storm moves this number.
 * **Milliseconds** (NFR 1) are a measurement of one machine and belong in a
 * plan's implementation log, never in an assertion -- and against a virtual
 * port they exclude the USB transport entirely, so they are a floor on the real
 * figure rather than the figure.
 */

/** NFR 11: the frame that first shows a key is within this many frames. */
const FRAME_P95_BUDGET = 2
const FRAME_MAX_BUDGET = 4

export interface LatencyOverlayProps {
  stats: LatencyStats
  /** True when the events came from a generated scenario rather than a device. */
  synthetic: boolean
}

export function LatencyOverlay({ stats, synthetic }: LatencyOverlayProps) {
  const ms = (value: number) => (stats.samples === 0 ? '-' : value.toFixed(1))
  const frames = (value: number) => (stats.samples === 0 ? '-' : value.toFixed(0))

  return (
    <aside className={styles.overlay} data-testid="latency-overlay" data-samples={stats.samples}>
      <div className={styles.title}>
        <span>key to pixel</span>
        <span>{stats.samples} note-ons</span>
      </div>

      <div className={styles.row}>
        <span className={styles.label} />
        <span>p50</span>
        <span>p95</span>
        <span>max</span>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>frames</span>
        <span className={styles.value} data-testid="frame-p50">
          {frames(stats.frameP50)}
        </span>
        <span
          className={stats.frameP95 > FRAME_P95_BUDGET ? styles.over : styles.value}
          data-testid="frame-p95"
        >
          {frames(stats.frameP95)}
        </span>
        <span
          className={stats.frameMax > FRAME_MAX_BUDGET ? styles.over : styles.value}
          data-testid="frame-max"
        >
          {frames(stats.frameMax)}
        </span>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>ms</span>
        <span className={styles.value} data-testid="ms-p50">
          {ms(stats.msP50)}
        </span>
        <span className={styles.value} data-testid="ms-p95">
          {ms(stats.msP95)}
        </span>
        <span className={styles.value} data-testid="ms-max">
          {ms(stats.msMax)}
        </span>
      </div>

      <p className={styles.note}>
        {synthetic
          ? 'Generated source: these milliseconds never crossed USB and are not NFR 1.'
          : `NFR 11 budget: p95 ${FRAME_P95_BUDGET} frames, max ${FRAME_MAX_BUDGET}.`}
      </p>
    </aside>
  )
}
