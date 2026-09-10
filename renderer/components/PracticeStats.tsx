import type { PracticeReport } from '../../shared/score'
import { barsByTiming } from '../../core/src/align/report'
import styles from './PracticeStats.module.css'

/**
 * The take in numbers: how many notes landed, how many did not, the tempo the
 * player turned out to be keeping, and the bars that were furthest from it.
 *
 * The worst-bars list is the useful half. A count of wrong notes says a take
 * went badly; a list of bars says where to start again.
 *
 * A restart reads as a **sentence**, not as a mark on the score. The player
 * did nothing wrong there, so there is no colour that would be honest, and
 * saying it in words is what keeps colour from being the only carrier of
 * anything here. What the tempo did over a span reads the same way and for
 * the same reason (ADR-0014).
 *
 * "Tempo you kept" rather than "your tempo": the figure is the pace over the
 * stretches where the player was steady, not an average of a performance and
 * whatever interrupted it.
 */

/** More than this and the list stops being a place to start and becomes a wall. */
const WORST_BARS_SHOWN = 3

/**
 * A bar closer than this to its local reference was not noticeably out of time --
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
          label="Tempo you kept"
          value={report.fittedTempo === null ? '--' : `${Math.round(report.fittedTempo)} bpm`}
          tone="plain"
          testId="stat-tempo"
        />
      </dl>

      {report.restarts.length > 0 && (
        <p className={styles.restarts} data-testid="stat-restarts">
          {report.restarts.map((restart, index) => (
            <span key={restart.bar} data-bar={restart.bar} data-notes={restart.notes}>
              {index > 0 && ' '}
              You went back over bar {restart.bar} and played {restart.notes}{' '}
              {restart.notes === 1 ? 'note' : 'notes'} again.
            </span>
          ))}{' '}
          Those are not counted as wrong or extra.
        </p>
      )}

      {report.tempoObservations.length > 0 && (
        <p className={styles.tempoShape} data-testid="stat-tempo-shape">
          {report.tempoObservations.map((observation, index) => (
            <span
              key={`${observation.fromBar}-${observation.toBar}`}
              data-from={observation.fromBar}
              data-to={observation.toBar}
              data-percent={observation.percent}
            >
              {index > 0 && ' '}
              You {observation.percent < 0 ? 'slowed' : 'pressed on'}{' '}
              {Math.abs(observation.percent)}% over bars {observation.fromBar} to{' '}
              {observation.toBar}.
            </span>
          ))}
        </p>
      )}

      {report.unalignableFromBar !== null && (
        <p className={styles.lost} role="alert" data-testid="stat-unalignable">
          What was played stopped matching the score at bar {report.unalignableFromBar}. Nothing
          after it is judged.
        </p>
      )}

      <p className={styles.worst} data-testid="stat-worst">
        {worst.length === 0 ? (
          'Nothing stood out as uneven against the music around it.'
        ) : (
          <>
            Furthest from the tempo around them:{' '}
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

      <p className={styles.which} data-testid="stat-take">
        This take: <time dateTime={takeStartedAt(report.takeId)}>{takeLabel(report.takeId)}</time>
      </p>
    </section>
  )
}

/**
 * A take id is its start time with the colons taken out, because a colon is
 * not legal in a Windows filename. Turning it back into something a person can
 * read matters when two takes of one piece are being compared: without it a
 * report is silent about which performance it describes.
 */
function takeStartedAt(takeId: string): string {
  const [date, time] = takeId.split('T')
  if (date === undefined || time === undefined) return takeId
  const [h, m, rest] = time.split('-')
  return `${date}T${h ?? '00'}:${m ?? '00'}:${rest ?? '00'}`
}

function takeLabel(takeId: string): string {
  const parsed = new Date(takeStartedAt(takeId))
  if (Number.isNaN(parsed.getTime())) return takeId
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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
