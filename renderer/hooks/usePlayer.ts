import { useCallback, useEffect, useRef, useState } from 'react'
import { type HeldNotes, emptyHeldNotes, reduceHeldNotes } from '../../core/src/midi/HeldNotes'
import type { MidiEvent } from '../../shared/midi'
import { type PlayRequest, type PlayerState, idlePlayerState } from '../../shared/player'

/**
 * What the app is playing, as opposed to what the player is playing.
 *
 * It is deliberately a second, smaller hook rather than a branch inside
 * `useMidiEvents`: the two streams are drawn side by side and must never merge,
 * and this one carries none of that one's accounting -- no latency window, no
 * event log, no key estimate. What it keeps is the same discipline about the
 * paint. Events arrive one IPC message at a time and are buffered in a ref,
 * then reduced into `HeldNotes` once per animation frame, because a `setState`
 * per message is one React render per note.
 */
export interface PlayerStream {
  /** What the app has sounding right now. Empty whenever it is idle. */
  held: HeldNotes
  state: PlayerState
  /**
   * Note-ons since this playback started. It is a count, not a log: it is what
   * a view shows to say the app is producing notes, and what an end-to-end run
   * counts against the notes the schedule was built from (NFR 13).
   */
  notesPlayed: number
  /**
   * The last bar playback reached, kept after it stops. The walk ends
   * somewhere and the bar it ended on is the one still worth looking at, so it
   * outlives the `playing` state that produced it. Cleared by the next play,
   * and by `clearLastBar` when the view has something else to point at.
   */
  lastBar: number | null
  play(request: PlayRequest): Promise<void>
  stop(): Promise<void>
  /** The last transport command that failed, for the view to show. */
  error: string | null
  clearError(): void
  clearLastBar(): void
}

export function usePlayer(): PlayerStream {
  const [held, setHeld] = useState<HeldNotes>(emptyHeldNotes)
  const [state, setState] = useState<PlayerState>(idlePlayerState)
  const [notesPlayed, setNotesPlayed] = useState(0)
  const [lastBar, setLastBar] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pending = useRef<MidiEvent[]>([])
  const current = useRef<HeldNotes>(emptyHeldNotes)
  const played = useRef(0)

  useEffect(() => {
    pending.current = []
    current.current = emptyHeldNotes
    played.current = 0

    const stopEvents = window.api.player.onEvent((event) => {
      pending.current.push(event)
    })
    const stopStates = window.api.player.onState((next) => {
      setState(next)
      if (next.state === 'playing' && next.bar !== null) setLastBar(next.bar)
    })

    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const batch = pending.current
      if (batch.length === 0) return
      pending.current = []

      let next = current.current
      // The whole batch is reduced, never a sample of it: a note-off dropped
      // here would leave a key lit after playback ended.
      for (const event of batch) {
        next = reduceHeldNotes(next, event)
        if (event.kind === 'noteOn') played.current++
      }
      current.current = next
      setHeld(next)
      setNotesPlayed(played.current)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      stopEvents()
      stopStates()
      cancelAnimationFrame(raf)
    }
  }, [])

  const play = useCallback(async (request: PlayRequest) => {
    setError(null)
    // Reset before the invoke, not after: main can dispatch an event at at 0
    // before the promise resolves, and counting it against the previous run
    // would be the same off-by-a-note the recorder's own subscribe-first rule
    // avoids.
    played.current = 0
    setNotesPlayed(0)
    setLastBar(null)
    try {
      await window.api.player.play(request)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const stop = useCallback(async () => {
    try {
      await window.api.player.stop()
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const clearError = useCallback(() => setError(null), [])
  const clearLastBar = useCallback(() => setLastBar(null), [])

  return { held, state, notesPlayed, lastBar, play, stop, error, clearError, clearLastBar }
}
