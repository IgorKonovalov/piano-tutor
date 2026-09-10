import { useCallback, useMemo, useState } from 'react'
import type { ScoreMeta } from '../../shared/score'
import {
  barAt,
  canonicalTimeline,
  notesInBar,
  timelineFingerprint,
} from '../../core/src/score/timeline'
import { type BarMark, OsmdView, type ScoreLoaded } from '../score/OsmdView'
import { useScoreContent, useScoreLibrary } from '../hooks/useScore'
import styles from './Score.module.css'

/**
 * The score half of practice: a library of imported pieces on the left, the
 * engraved score on the right, and one bar addressable at a time.
 *
 * Bar addressing is the capability everything later stands on -- the practice
 * report names bars and this view has to be able to mark exactly those. It is
 * exercised here by hand, through the bar field and by clicking a bar, which
 * is also how a player finds the passage they want to work on.
 */
export function Score() {
  const library = useScoreLibrary()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<ScoreLoaded | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [highlighted, setHighlighted] = useState<number | null>(null)
  const [showRead, setShowRead] = useState(false)

  const content = useScoreContent(selectedId)

  const select = useCallback((meta: ScoreMeta) => {
    setSelectedId(meta.id)
    setLoaded(null)
    setRenderError(null)
    setHighlighted(null)
    setShowRead(false)
  }, [])

  const onLoaded = useCallback(
    (info: ScoreLoaded) => {
      setLoaded(info)
      setRenderError(null)
      // The title is the one fact about the file only the renderer can learn,
      // because only the renderer parses it (ADR-0005). Written back once.
      const meta =
        library.state.status === 'ready'
          ? library.state.scores.find((s) => s.id === selectedId)
          : undefined
      if (info.title !== '' && meta !== undefined && meta.title !== info.title) {
        void library.recordTitle(meta.id, info.title)
      }
    },
    [library, selectedId]
  )

  const onError = useCallback((message: string) => {
    setRenderError(message)
    setLoaded(null)
  }, [])

  const marks = useMemo<BarMark[]>(
    () =>
      highlighted === null
        ? []
        : [{ bar: highlighted, state: 'highlight', label: `bar ${highlighted}` }],
    [highlighted]
  )

  const barCount = loaded?.barCount ?? 0
  const timeline = loaded?.timeline ?? null

  return (
    <section className={styles.view} data-testid="score-view">
      <aside className={styles.library} data-testid="score-library">
        <h1 className={styles.heading}>Scores</h1>
        <button
          type="button"
          className={styles.add}
          onClick={() => {
            void library.add().then((meta) => {
              if (meta !== null) select(meta)
            })
          }}
          data-testid="score-import"
        >
          Add a score&hellip;
        </button>

        {library.state.status === 'error' && (
          <p className={styles.error} role="alert">
            Could not read the score library: {library.state.message}
            <button
              type="button"
              className={styles.retry}
              onClick={() => void library.refresh()}
            >
              Retry
            </button>
          </p>
        )}

        {library.state.status === 'loading' && (
          <p className={styles.empty}>Reading the scores folder&hellip;</p>
        )}

        {library.state.status === 'ready' &&
          (library.state.scores.length === 0 ? (
            <p className={styles.empty} data-testid="score-library-empty">
              No scores yet. Add a MusicXML file (<code>.musicxml</code>, <code>.xml</code> or{' '}
              <code>.mxl</code>) exported from MuseScore or anything else that writes it.
            </p>
          ) : (
            <ul className={styles.list}>
              {library.state.scores.map((meta) => (
                <li key={meta.id}>
                  <button
                    type="button"
                    className={
                      meta.id === selectedId ? `${styles.score} ${styles.current}` : styles.score
                    }
                    aria-current={meta.id === selectedId}
                    onClick={() => select(meta)}
                    data-testid="score-row"
                    data-score-id={meta.id}
                  >
                    <span className={styles.title}>{meta.title ?? meta.filename}</span>
                    <span className={styles.filename}>{meta.filename}</span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </aside>

      <div className={styles.sheet}>
        {selectedId === null ? (
          <p className={styles.empty} data-testid="score-none-selected">
            Choose a score to open it.
          </p>
        ) : (
          <>
            <div className={styles.toolbar}>
              <label className={styles.field} htmlFor="highlight-bar">
                Highlight bar
              </label>
              <input
                id="highlight-bar"
                className={styles.barInput}
                type="number"
                min={0}
                max={Math.max(0, barCount - 1)}
                value={highlighted ?? ''}
                disabled={barCount === 0}
                onChange={(event) => {
                  const value = event.target.value
                  setHighlighted(value === '' ? null : Number(value))
                }}
                data-testid="highlight-bar"
              />
              <span className={styles.hint} data-testid="bar-count" data-bars={barCount}>
                {barCount === 0
                  ? 'not drawn yet'
                  : `${barCount} bars, indexed 0 to ${barCount - 1} as the score was parsed`}
              </span>
              <button
                type="button"
                className={styles.clear}
                onClick={() => setHighlighted(null)}
                data-testid="highlight-clear"
              >
                Clear
              </button>
            </div>

            {renderError !== null && (
              <p className={styles.error} role="alert" data-testid="score-error">
                Could not draw this score: {renderError}
              </p>
            )}
            {content.status === 'error' && (
              <p className={styles.error} role="alert" data-testid="score-error">
                Could not read this score: {content.message}
              </p>
            )}
            {content.status === 'loading' && <p className={styles.empty}>Opening the score&hellip;</p>}
            {content.status === 'ready' && (
              <div className={styles.scroll}>
                <OsmdView
                  id={content.id}
                  bytes={content.bytes}
                  marks={marks}
                  onLoaded={onLoaded}
                  onError={onError}
                  onBarClick={setHighlighted}
                />
              </div>
            )}

            {timeline !== null && (
              <details
                className={styles.read}
                open={showRead}
                onToggle={(event) => setShowRead(event.currentTarget.open)}
                data-testid="timeline-details"
              >
                <summary className={styles.readSummary}>
                  What the app read: {timeline.notes.length} notes across {timeline.bars.length}{' '}
                  bars
                  <span className={styles.fingerprint} data-testid="timeline-fingerprint">
                    {timelineFingerprint(timeline)}
                  </span>
                </summary>
                <p className={styles.readNote}>
                  The notes the score is judged against, in quarter notes from the start of the
                  piece. Bars are numbered the way they were parsed, so an anacrusis is bar 0.
                  {highlighted !== null && barAt(timeline, highlighted) !== undefined && (
                    <>
                      {' '}
                      Bar {highlighted} holds {notesInBar(timeline, highlighted).length} notes.
                    </>
                  )}
                </p>
                <pre className={styles.readJson} data-testid="timeline-json">
                  {canonicalTimeline(timeline)}
                </pre>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  )
}
