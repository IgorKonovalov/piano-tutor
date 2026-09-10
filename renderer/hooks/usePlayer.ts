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
  play(request: PlayRequest): Promise<void>
  stop(): Promise<void>
  /** The last transport command that failed, for the view to show. */
  error: string | null
  clearError(): void
}

export function usePlayer(): PlayerStream {
  const [held, setHeld] = useState<HeldNotes>(emptyHeldNotes)
  const [state, setState] = useState<PlayerState>(idlePlayerState)
  const [error, setError] = useState<string | null>(null)

  const pending = useRef<MidiEvent[]>([])
  const current = useRef<HeldNotes>(emptyHeldNotes)

  useEffect(() => {
    pending.current = []
    current.current = emptyHeldNotes

    const stopEvents = window.api.player.onEvent((event) => {
      pending.current.push(event)
    })
    const stopStates = window.api.player.onState(setState)

    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const batch = pending.current
      if (batch.length === 0) return
      pending.current = []

      let next = current.current
      // The whole batch is reduced, never a sample of it: a note-off dropped
      // here would leave a key lit after playback ended.
      for (const event of batch) next = reduceHeldNotes(next, event)
      current.current = next
      setHeld(next)
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

  return { held, state, play, stop, error, clearError }
}
