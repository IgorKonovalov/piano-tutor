import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MidiPort } from '../../shared/midi'
import { type ScoreMeta, isMidiScore } from '../../shared/score'
import type { BarState } from '../../shared/score'
import {
  barAt,
  canonicalTimeline,
  notesInBar,
  timelineFingerprint,
} from '../../core/src/score/timeline'
import {
  DEFAULT_QUANTISE_QUARTERS,
  NO_QUANTISE,
  timelineFromMidi,
} from '../../core/src/score/timelineFromMidi'
import { BarDetail } from '../components/BarDetail'
import { BarList } from '../components/BarList'
import { PracticeStats } from '../components/PracticeStats'
import { type BarMark, OsmdView, type ScoreLoaded } from '../score/OsmdView'
import { useScoreContent, useScoreLibrary } from '../hooks/useScore'
import { usePracticeReport } from '../hooks/usePracticeReport'
import styles from './Score.module.css'

/**
 * A piece, practised.
 *
 * You open a score, choose what to listen to, play it through with nothing
 * being judged, and stop. Then the bars colour and the numbers appear. The
 * order is the decision of the interview and it is why nothing in this view
 * touches the take while it is being recorded: feedback is after, not during.
 */

/** What each bar state says, so a colour is never carrying the meaning alone. */
const MARK_LABEL: Record<BarState, string> = {
  clean: 'as written',
  timing: 'out of time',
  wrong: 'wrong notes',
  notAttempted: 'not reached',
  unalignable: 'lost',
}

export function Score() {
  const library = useScoreLibrary()
  const practice = usePracticeReport()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<ScoreLoaded | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [selectedBar, setSelectedBar] = useState<number | null>(null)
  const [showRead, setShowRead] = useState(false)

  const [quantiseTo, setQuantiseTo] = useState(DEFAULT_QUANTISE_QUARTERS)
  const [ports, setPorts] = useState<MidiPort[]>([])
  const [portId, setPortId] = useState<string>('')
  const [recording, setRecording] = useState(false)
  const [heard, setHeard] = useState(0)
  const [practiceError, setPracticeError] = useState<string | null>(null)

  const content = useScoreContent(selectedId)
  const selectedMeta =
    library.state.status === 'ready'
      ? library.state.scores.find((meta) => meta.id === selectedId)
      : undefined
  const midi = selectedMeta !== undefined && isMidiScore(selectedMeta.extension)

  /**
   * A MIDI file's timeline is arithmetic over ticks, so it is derived here
   * rather than reported by a drawing library: there is nothing to draw. The
   * engraved path still comes from OSMD's own model (ADR-0005).
   */
  const midiTimeline = useMemo(() => {
    if (!midi || content.status !== 'ready') return null
    try {
      return timelineFromMidi(content.bytes, { scoreId: content.id, quantiseTo })
    } catch (err) {
      return err as Error
    }
  }, [midi, content, quantiseTo])

  const midiError = midiTimeline instanceof Error ? midiTimeline.message : null
  const timeline = midi
    ? midiTimeline instanceof Error
      ? null
      : midiTimeline
    : (loaded?.timeline ?? null)
  const barCount = midi ? (timeline?.bars.length ?? 0) : (loaded?.barCount ?? 0)
  const report = practice.state.status === 'ready' ? practice.state.report : null

  useEffect(() => {
    let cancelled = false
    window.api.midi
      .listPorts()
      .then((found) => {
        if (cancelled) return
        setPorts(found)
        setPortId((current) => (current === '' ? (found[0]?.id ?? '') : current))
      })
      .catch(() => {
        // The port list is not this view's job to report on; the Ports view
        // owns that error, and practising simply has nothing to offer here.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const select = useCallback(
    (meta: ScoreMeta) => {
      setSelectedId(meta.id)
      setLoaded(null)
      setRenderError(null)
      setSelectedBar(null)
      setShowRead(false)
      setPracticeError(null)
      practice.clear()
    },
    [practice]
  )

  const onLoaded = useCallback(
    (info: ScoreLoaded) => {
      setLoaded(info)
      setRenderError(null)
      // The title is the one fact about the file only the renderer can learn,
      // because only the renderer parses it (ADR-0005). Written back once.
      const meta =
        library.state.status === 'ready'
          ? library.state.scores.find((entry) => entry.id === selectedId)
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

  const startPractice = useCallback(async () => {
    if (selectedId === null || portId === '') return
    setPracticeError(null)
    setHeard(0)
    practice.clear()
    try {
      // The score id travels with the open, so the take records what it was
      // attempting rather than main having to remember.
      await window.api.midi.open(portId, selectedId)
      setRecording(true)
    } catch (err) {
      setPracticeError((err as Error).message)
    }
  }, [portId, practice, selectedId])

  const stopPractice = useCallback(async () => {
    setRecording(false)
    try {
      await window.api.midi.close()
      if (timeline === null) return
      const takes = await window.api.take.list()
      const mine = takes.find((take) => take.scoreId === selectedId)
      if (mine === undefined) {
        setPracticeError(
          'That session was too short to keep. Ten notes or more are recorded as a take.'
        )
        return
      }
      await practice.analyse(mine.id, timeline)
    } catch (err) {
      setPracticeError((err as Error).message)
    }
  }, [practice, selectedId, timeline])

  // A count of what has arrived, while it is arriving. Nothing is judged from
  // it -- that is the whole shape of this feature -- but a player needs to see
  // that the app is hearing them before they play a piece through.
  useEffect(() => {
    if (!recording) return
    return window.api.midi.onEvent((event) => {
      if (event.kind === 'noteOn') setHeard((count) => count + 1)
    })
  }, [recording])

  // The port is main's, so a view that unmounts mid-recording has to let go of
  // it or the next open finds it held.
  useEffect(() => {
    return () => {
      void window.api.midi.close()
    }
  }, [])

  const marks = useMemo<BarMark[]>(() => {
    if (report === null) {
      return selectedBar === null
        ? []
        : [{ bar: selectedBar, state: 'highlight', label: `bar ${selectedBar}` }]
    }
    return report.bars.map((bar) => {
      const problems = bar.notes.filter((note) => note.kind !== 'correct').length
      return {
        bar: bar.bar,
        state: bar.state,
        label: problems > 0 ? `${problems} ${MARK_LABEL[bar.state]}` : MARK_LABEL[bar.state],
      }
    })
  }, [report, selectedBar])

  const selectedVerdict =
    report === null || selectedBar === null
      ? null
      : (report.bars.find((bar) => bar.bar === selectedBar) ?? null)

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
            <button type="button" className={styles.retry} onClick={() => void library.refresh()}>
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
              <label className={styles.field} htmlFor="practice-port">
                Play from
              </label>
              <select
                id="practice-port"
                className={styles.port}
                value={portId}
                disabled={recording || ports.length === 0}
                onChange={(event) => setPortId(event.target.value)}
                data-testid="practice-port"
              >
                {ports.length === 0 && <option value="">Nothing connected</option>}
                {ports.map((port) => (
                  <option key={port.id} value={port.id}>
                    {port.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={recording ? `${styles.practise} ${styles.stop}` : styles.practise}
                disabled={portId === '' || barCount === 0}
                onClick={() => void (recording ? stopPractice() : startPractice())}
                data-testid="practice-toggle"
              >
                {recording ? 'Stop and show me' : 'Practise'}
              </button>

              <label className={styles.field} htmlFor="highlight-bar">
                Bar
              </label>
              <input
                id="highlight-bar"
                className={styles.barInput}
                type="number"
                min={0}
                max={Math.max(0, barCount - 1)}
                value={selectedBar ?? ''}
                disabled={barCount === 0}
                onChange={(event) => {
                  const value = event.target.value
                  setSelectedBar(value === '' ? null : Number(value))
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
                onClick={() => setSelectedBar(null)}
                data-testid="highlight-clear"
              >
                Clear
              </button>

              {midi && (
                <>
                  <label className={styles.field} htmlFor="quantise">
                    Snap to
                  </label>
                  <select
                    id="quantise"
                    className={styles.port}
                    value={String(quantiseTo)}
                    onChange={(event) => setQuantiseTo(Number(event.target.value))}
                    data-testid="quantise"
                  >
                    <option value={String(NO_QUANTISE)}>nothing</option>
                    <option value="0.25">a sixteenth</option>
                    <option value="0.5">an eighth</option>
                    <option value="1">a quarter</option>
                  </select>
                </>
              )}
            </div>

            {recording && (
              <p
                className={styles.recording}
                data-testid="practice-recording"
                data-heard={heard}
              >
                Recording, {heard} {heard === 1 ? 'note' : 'notes'} so far. Nothing is judged
                until you stop.
              </p>
            )}
            {practiceError !== null && (
              <p className={styles.error} role="alert" data-testid="practice-error">
                {practiceError}
              </p>
            )}
            {practice.state.status === 'working' && (
              <p className={styles.empty}>Reading the take&hellip;</p>
            )}
            {practice.state.status === 'error' && (
              <p className={styles.error} role="alert" data-testid="practice-error">
                Could not read that take: {practice.state.message}
              </p>
            )}
            {renderError !== null && (
              <p className={styles.error} role="alert" data-testid="score-error">
                Could not draw this score: {renderError}
              </p>
            )}
            {midiError !== null && (
              <p className={styles.error} role="alert" data-testid="score-error">
                Could not read this MIDI file: {midiError}
              </p>
            )}
            {content.status === 'error' && (
              <p className={styles.error} role="alert" data-testid="score-error">
                Could not read this score: {content.message}
              </p>
            )}
            {content.status === 'loading' && (
              <p className={styles.empty}>Opening the score&hellip;</p>
            )}

            {practice.state.status === 'ready' && (
              <PracticeStats
                report={practice.state.report}
                elapsedMs={practice.state.elapsedMs}
              />
            )}

            {content.status === 'ready' && !midi && (
              <div className={styles.scroll}>
                <OsmdView
                  id={content.id}
                  bytes={content.bytes}
                  marks={marks}
                  onLoaded={onLoaded}
                  onError={onError}
                  onBarClick={setSelectedBar}
                />
              </div>
            )}
            {content.status === 'ready' && midi && timeline !== null && (
              <div className={styles.scroll} data-testid="osmd-paper" data-score-id={content.id}>
                <BarList
                  timeline={timeline}
                  marks={marks}
                  selected={selectedBar}
                  onBarClick={setSelectedBar}
                />
              </div>
            )}

            {report !== null && <BarDetail bar={selectedVerdict} index={selectedBar} />}

            {timeline !== null && (
              <details
                className={styles.read}
                open={showRead}
                onToggle={(event) => setShowRead(event.currentTarget.open)}
                data-testid="timeline-details"
                data-load-ms={loaded?.loadMs ?? ''}
              >
                <summary className={styles.readSummary}>
                  What the app read: {timeline.notes.length} notes across {timeline.bars.length}{' '}
                  bars, drawn in {loaded?.loadMs ?? 0} ms
                  <span className={styles.fingerprint} data-testid="timeline-fingerprint">
                    {timelineFingerprint(timeline)}
                  </span>
                </summary>
                <p className={styles.readNote}>
                  The notes the score is judged against, in quarter notes from the start of the
                  piece. Bars are numbered the way they were parsed, so an anacrusis is bar 0.
                  {selectedBar !== null && barAt(timeline, selectedBar) !== undefined && (
                    <>
                      {' '}
                      Bar {selectedBar} holds {notesInBar(timeline, selectedBar).length} notes.
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
