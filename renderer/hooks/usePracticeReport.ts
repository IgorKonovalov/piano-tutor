import { useCallback, useRef, useState } from 'react'
import type { MidiEvent } from '../../shared/midi'
import {
  DEFAULT_STRICTNESS,
  type ExpectedTimeline,
  type PracticeReport,
  type TimingStrictness,
} from '../../shared/score'
import { practiceReport } from '../../core/src/align/report'

/**
 * Aligning a finished take against the open score.
 *
 * It runs `core/`'s aligner **in the renderer** and entirely off the MIDI
 * path: nothing here happens while a note is arriving. Feedback is after the
 * take, so this is called once, when the player stops, and the time it takes
 * is the turnaround NFR 12 names. That time is measured and reported, never
 * asserted -- it is a figure about one machine.
 *
 * The take is kept after it is analysed so that changing how fussy the app
 * should be re-derives the report from it: nothing is re-recorded and the file
 * is not read again. Strictness is an opinion about a measurement, so
 * measuring twice would be the wrong shape.
 */

export interface Analysed {
  report: PracticeReport
  /** Take load plus alignment, in milliseconds, on this machine. */
  elapsedMs: number
  events: number
}

export type PracticeState =
  | { status: 'idle' }
  | { status: 'working' }
  | { status: 'error'; message: string }
  | ({ status: 'ready' } & Analysed)

export interface PracticeAnalysis {
  state: PracticeState
  /** Loads the take, aligns it against the timeline, and times both. */
  analyse: (
    takeId: string,
    timeline: ExpectedTimeline,
    strictness?: TimingStrictness
  ) => Promise<void>
  /** Re-derives the report from the take already loaded, at a new strictness. */
  restrict: (strictness: TimingStrictness) => void
  clear: () => void
}

interface Loaded {
  takeId: string
  timeline: ExpectedTimeline
  events: MidiEvent[]
}

export function usePracticeReport(): PracticeAnalysis {
  const [state, setState] = useState<PracticeState>({ status: 'idle' })
  const loaded = useRef<Loaded | null>(null)

  const analyse = useCallback(
    async (
      takeId: string,
      timeline: ExpectedTimeline,
      strictness: TimingStrictness = DEFAULT_STRICTNESS
    ) => {
      setState({ status: 'working' })
      try {
        const startedAt = performance.now()
        const take = await window.api.take.load(takeId)
        const report = practiceReport({ timeline, events: take.events, takeId, strictness })
        loaded.current = { takeId, timeline, events: take.events }
        setState({
          status: 'ready',
          report,
          elapsedMs: Math.round(performance.now() - startedAt),
          events: take.events.length,
        })
      } catch (err) {
        loaded.current = null
        setState({ status: 'error', message: (err as Error).message })
      }
    },
    []
  )

  const restrict = useCallback((strictness: TimingStrictness) => {
    const take = loaded.current
    if (take === null) return
    setState((current) => {
      if (current.status !== 'ready') return current
      return {
        ...current,
        report: practiceReport({
          timeline: take.timeline,
          events: take.events,
          takeId: take.takeId,
          strictness,
        }),
      }
    })
  }, [])

  const clear = useCallback(() => {
    loaded.current = null
    setState({ status: 'idle' })
  }, [])

  return { state, analyse, restrict, clear }
}
