import { useCallback, useEffect, useRef, useState } from 'react'
import { type HeldNotes, emptyHeldNotes, reduceHeldNotes } from '../../core/src/midi/HeldNotes'
import type { MidiEvent } from '../../shared/midi'
import { type PlayRequest, type PlayerState, idlePlayerState } from '../../shared/player'
import { type SoundTarget, Synth } from '../audio/synth'

/** How often the output list is re-read, matching the ports view's poll. */
const OUTPUT_POLL_MS = 2000

/**
 * Injected rather than constructed, the way `Player` takes a clock and
 * `MidiSource` takes a harness gate. Production leaves it out; a test hands in
 * a fake, which is the only way a `jsdom` run can see this lifecycle at all.
 */
export interface UsePlayerOptions {
  createAudioContext?: () => AudioContext
}

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
  /**
   * Where the app's own playing is heard (ADR-0008). It defaults to the
   * instrument when an output port is open and to this computer when none is,
   * so the two paths never sound the same note together unless asked; an
   * explicit choice sticks and stops the default from moving under it.
   */
  soundTarget: SoundTarget
  setSoundTarget(target: SoundTarget): void
  /** True while main holds an output port open. */
  outputOpen: boolean
  play(request: PlayRequest): Promise<void>
  stop(): Promise<void>
  /** The last transport command that failed, for the view to show. */
  error: string | null
  clearError(): void
  clearLastBar(): void
}

export function usePlayer(options: UsePlayerOptions = {}): PlayerStream {
  const [held, setHeld] = useState<HeldNotes>(emptyHeldNotes)
  const [state, setState] = useState<PlayerState>(idlePlayerState)
  const [notesPlayed, setNotesPlayed] = useState(0)
  const [lastBar, setLastBar] = useState<number | null>(null)
  const [outputOpen, setOutputOpen] = useState(false)
  const [chosenTarget, setChosenTarget] = useState<SoundTarget | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pending = useRef<MidiEvent[]>([])
  const current = useRef<HeldNotes>(emptyHeldNotes)
  const played = useRef(0)
  const synth = useRef<Synth | null>(null)
  /**
   * The paint loop below has empty dependencies by design, so it cannot close
   * over the target. The ref is written in an effect rather than during render
   * -- a render-time write is what `react-hooks/refs` refuses, and rightly.
   */
  const audible = useRef(false)

  // Derived, not stored: an explicit choice wins, and until there is one the
  // default follows whether an instrument is listening.
  const soundTarget: SoundTarget = chosenTarget ?? (outputOpen ? 'instrument' : 'computer')
  const makeContext = options.createAudioContext

  useEffect(() => {
    audible.current = soundTarget === 'computer'
  }, [soundTarget])

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
        // Only what the app is playing, and only when nothing else is
        // sounding it (ADR-0008). The context is never opened by this line --
        // it is made on the click that starts playback, or not at all.
        if (audible.current) synth.current?.feed(event)
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
      // Every voice, node and timer the view made goes with the view.
      synth.current?.dispose()
      synth.current = null
    }
  }, [])

  /**
   * Whether an instrument is listening. Polled because Windows reports no
   * hot-plug event and because the port can be opened from another view;
   * listing opens no handle (ADR-0006), so it is free to ask.
   */
  useEffect(() => {
    let cancelled = false
    const read = () => {
      window.api.player
        .listOutputs()
        .then((ports) => {
          if (!cancelled) setOutputOpen(ports.some((port) => port.detail === 'Open'))
        })
        .catch(() => {
          // The ports view owns reporting on the output list; here its absence
          // simply means nothing is listening.
        })
    }
    read()
    const timer = setInterval(read, OUTPUT_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const play = useCallback(
    async (request: PlayRequest) => {
      setError(null)
      // Reset before the invoke, not after: main can dispatch an event at at 0
      // before the promise resolves, and counting it against the previous run
      // would be the same off-by-a-note the recorder's own subscribe-first
      // rule avoids.
      played.current = 0
      setNotesPlayed(0)
      setLastBar(null)

      // Made here and nowhere else: autoplay policy will not let an
      // `AudioContext` start itself, and this call is inside the click that
      // asked for the sound (ADR-0008).
      if (soundTarget === 'computer' && synth.current === null) {
        const make = makeContext ?? (() => new AudioContext())
        try {
          synth.current = new Synth(make())
        } catch (err) {
          setError(`Could not open an audio device: ${(err as Error).message}`)
        }
      }

      try {
        await window.api.player.play(request)
      } catch (err) {
        setError((err as Error).message)
      }
    },
    [makeContext, soundTarget]
  )

  const stop = useCallback(async () => {
    // The note-offs main sends will silence it anyway; this is the belt for
    // the case where they do not arrive.
    synth.current?.releaseAll()
    try {
      await window.api.player.stop()
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const clearError = useCallback(() => setError(null), [])
  const clearLastBar = useCallback(() => setLastBar(null), [])
  const setSoundTarget = useCallback((target: SoundTarget) => {
    setChosenTarget(target)
    if (target !== 'computer') synth.current?.releaseAll()
  }, [])

  return {
    held,
    state,
    notesPlayed,
    lastBar,
    soundTarget,
    setSoundTarget,
    outputOpen,
    play,
    stop,
    error,
    clearError,
    clearLastBar,
  }
}
