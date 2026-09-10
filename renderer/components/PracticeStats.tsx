import type { PracticeReport } from '../../shared/score'
import { barsByTiming } from '../../core/src/align/report'
import styles from './PracticeStats.module.css'

/**
 * The take in numbers: how many notes landed, how many did not, the tempo the
 * player turned out to be keeping, and the bars that were furthest from it.
 *
 * The worst-bars list is the useful half. A count of wrong notes says a take
 * went badly; a list of bars says where to start again.
 */

/** More than this and the list stops being a place to start and becomes a wall. */
const WORST_BARS_SHOWN = 3

/**
 * A bar closer than this to the fitted line was not noticeably out of time --
 * it is inside ordinary human unevenness, and inside the generator's own
 * jitter, which is bounded at twelve milliseconds. Listing five-millisecond
 * deviations under "furthest from your own tempo" tells the player their even
 * playing was uneven.
 */
const WORTH_MENTIONING_MS = 15

export interface PracticeStatsProps {
  report: PracticeReport
  /** Take load plus alignment on this machine, for the dev overlay (NFR 12). */
  elapsedMs?: number
}

export function PracticeStats({ report, elapsedMs }: PracticeStatsProps) {
  const { counts } = report
  const attempted = report.bars.filter((bar) => bar.state !== 'notAttempted')
  const clean = attempted.filter((bar) => bar.state === 'clean').length
  const worst = barsByTiming(report)
    .filter((bar) => Math.abs(bar.timingDeviation) >= WORTH_MENTIONING_MS)
    .slice(0, WORST_BARS_SHOWN)

  return (
    <section
      className={styles.stats}
      data-testid="practice-stats"
      data-correct={counts.correct}
      data-wrong={counts.wrongPitch}
      data-missing={counts.missing}
      data-extra={counts.extra}
      data-align-ms={elapsedMs ?? ''}
    >
      <dl className={styles.figures}>
        <Figure label="As written" value={counts.correct} tone="ok" testId="stat-correct" />
        <Figure label="Wrong note" value={counts.wrongPitch} tone="error" testId="stat-wrong" />
        <Figure label="Missed" value={counts.missing} tone="warn" testId="stat-missing" />
        <Figure label="Extra" value={counts.extra} tone="virtual" testId="stat-extra" />
        <Figure
          label="Bars clean"
          value={`${clean}/${attempted.length}`}
          tone="plain"
          testId="stat-bars"
        />
        <Figure
          label="Your tempo"
          value={report.fittedTempo === null ? '--' : `${Math.round(report.fittedTempo)} bpm`}
          tone="plain"
          testId="stat-tempo"
        />
      </dl>

      {report.unalignableFromBar !== null && (
        <p className={styles.lost} role="alert" data-testid="stat-unalignable">
          What was played stopped matching the score at bar {report.unalignableFromBar}. Nothing
          after it is judged.
        </p>
      )}

      <p className={styles.worst} data-testid="stat-worst">
        {worst.length === 0 ? (
          'Nothing stood out as out of time.'
        ) : (
          <>
            Furthest from your own tempo:{' '}
            {worst.map((bar, index) => (
              <span key={bar.bar} className={styles.worstBar} data-bar={bar.bar}>
                {index > 0 && ', '}
                bar {bar.bar} ({bar.timingDeviation < 0 ? '' : '+'}
                {Math.round(bar.timingDeviation)} ms)
              </span>
            ))}
          </>
        )}
      </p>
    </section>
  )
}

interface FigureProps {
  label: string
  value: number | string
  tone: 'ok' | 'error' | 'warn' | 'virtual' | 'plain'
  testId: string
}

function Figure({ label, value, tone, testId }: FigureProps) {
  return (
    <div className={`${styles.figure} ${styles[tone]}`}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value} data-testid={testId}>
        {value}
      </dd>
    </div>
  )
}
