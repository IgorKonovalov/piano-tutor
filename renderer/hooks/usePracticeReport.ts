import { useCallback, useState } from 'react'
import type { ExpectedTimeline, PracticeReport } from '../../shared/score'
import { practiceReport } from '../../core/src/align/report'

/**
 * Aligning a finished take against the open score.
 *
 * It runs `core/`'s aligner **in the renderer** and entirely off the MIDI
 * path: nothing here happens while a note is arriving. Feedback is after the
 * take, so this is called once, when the player stops, and the time it takes
 * is the turnaround NFR 12 names. That time is measured and reported, never
 * asserted -- it is a figure about one machine.
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
  analyse: (takeId: string, timeline: ExpectedTimeline) => Promise<void>
  clear: () => void
}

export function usePracticeReport(): PracticeAnalysis {
  const [state, setState] = useState<PracticeState>({ status: 'idle' })

  const analyse = useCallback(async (takeId: string, timeline: ExpectedTimeline) => {
    setState({ status: 'working' })
    try {
      const startedAt = performance.now()
      const take = await window.api.take.load(takeId)
      const report = practiceReport({ timeline, events: take.events, takeId })
      setState({
        status: 'ready',
        report,
        elapsedMs: Math.round(performance.now() - startedAt),
        events: take.events.length,
      })
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message })
    }
  }, [])

  const clear = useCallback(() => setState({ status: 'idle' }), [])

  return { state, analyse, clear }
}
