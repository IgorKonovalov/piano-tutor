import { memo, useEffect, useRef } from 'react'
import { Accidental, Formatter, Renderer, Stave, StaveNote, Voice } from 'vexflow'
import type { KeyEstimate } from '../../core/src/theory/key'
import { spellingFor } from '../../core/src/theory/spelling'
import {
  type StaffLayout,
  type StaffPlacement,
  layoutStaff,
} from '../../core/src/theory/staffLayout'
import styles from './LiveStaff.module.css'

/**
 * The grand staff of what is held, right now.
 *
 * VexFlow, not OSMD (ADR-0003): there is no rhythm to engrave and no document
 * to lay out, just a stack of noteheads that has to be redrawn inside the
 * latency budget on every change. OSMD's layout pass is tens of milliseconds
 * and the wrong shape for this.
 *
 * Which note lands on which stave, and what accidental it carries, is decided
 * in `core/src/theory/staffLayout.ts` so that it is a fixture test rather than
 * a screenshot. Everything here is drawing.
 */

/**
 * The staff redraws at most this often. A VexFlow redraw is a format pass and
 * a fresh SVG for both staves, and it is measurably the most expensive thing
 * on the paint path: through `virtual:dense-2000` mounting it took the
 * key-to-pixel figure from p50 5.0 ms / p95 19.8 ms to 12.1 / 33.0.
 *
 * Coalescing to 30 Hz is the fallback ADR-0003 and the plan name for exactly
 * this. A change is drawn immediately when the staff has been idle -- which is
 * every single key press a player makes -- and only a burst faster than 30
 * changes a second is batched, where the intermediate stacks were never
 * legible anyway. The keyboard stays on the 60 Hz path, because that is the
 * view NFR 1 is about.
 */
const MIN_REDRAW_INTERVAL_MS = 33

const WIDTH = 620
const HEIGHT = 220
const STAVE_X = 10
const STAVE_WIDTH = WIDTH - 2 * STAVE_X
const TREBLE_Y = 12
const BASS_Y = 108

interface StaffHandle {
  context: ReturnType<Renderer['getContext']>
  renderer: Renderer
}

function drawStave(handle: StaffHandle, y: number, clef: string, notes: StaffPlacement[]): void {
  const stave = new Stave(STAVE_X, y, STAVE_WIDTH)
  stave.addClef(clef)
  stave.setContext(handle.context).draw()

  if (notes.length === 0) return

  const staveNote = new StaveNote({
    keys: notes.map((n) => n.key),
    duration: 'w',
    clef,
  })
  // The live staff draws no key signature, so an altered note carries its own
  // accidental or it is read as a natural.
  notes.forEach((n, index) => {
    if (n.accidental !== null) staveNote.addModifier(new Accidental(n.accidental), index)
  })

  const voice = new Voice({ numBeats: 4, beatValue: 4 })
  voice.setStrict(false)
  voice.addTickables([staveNote])
  new Formatter().joinVoices([voice]).format([voice], STAVE_WIDTH - 90)
  voice.draw(handle.context, stave)
}

function draw(handle: StaffHandle, layout: StaffLayout): void {
  handle.context.clear()
  drawStave(handle, TREBLE_Y, 'treble', layout.treble)
  drawStave(handle, BASS_Y, 'bass', layout.bass)
}

export interface LiveStaffProps {
  sounding: number[]
  musicalKey: KeyEstimate | null
  splitPoint?: number
}

function LiveStaffView({ sounding, musicalKey, splitPoint }: LiveStaffProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<StaffHandle | null>(null)

  // Effect 1: the renderer's lifetime. Empty deps, so it is created once and
  // disposed on unmount; recreating it per data change is the canonical
  // Electron leak and it flickers.
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return

    const renderer = new Renderer(host, Renderer.Backends.SVG)
    renderer.resize(WIDTH, HEIGHT)
    handleRef.current = { renderer, context: renderer.getContext() }

    return () => {
      handleRef.current = null
      host.replaceChildren()
    }
  }, [])

  // Effect 2: the data. Redraws into the existing context, never recreating it.
  const layout = layoutStaff(sounding, spellingFor(musicalKey), { splitPoint })
  const lastDrawAt = useRef(0)
  useEffect(() => {
    const handle = handleRef.current
    if (handle === null) return

    const paint = () => {
      lastDrawAt.current = performance.now()
      draw(handle, layout)
    }

    const since = performance.now() - lastDrawAt.current
    if (since >= MIN_REDRAW_INTERVAL_MS) {
      paint()
      return
    }
    // Trailing edge: whatever is held when the burst ends is what gets drawn.
    const timer = setTimeout(paint, MIN_REDRAW_INTERVAL_MS - since)
    return () => clearTimeout(timer)
  }, [layout])

  const label =
    sounding.length === 0
      ? 'Grand staff, nothing held'
      : `Grand staff showing ${layout.treble.length} notes in the treble and ${layout.bass.length} in the bass`

  return (
    <div className={styles.staff} data-testid="live-staff" data-one-hand={layout.oneHand}>
      <div ref={hostRef} role="img" aria-label={label} />
      <span className={styles.hint}>
        split at {layout.splitPoint === 60 ? 'middle C' : layout.splitPoint}
      </span>
    </div>
  )
}

/**
 * Memoised on the held set, like `Labels`: the view repaints every frame and
 * an unchanged chord is an unchanged stave.
 */
export const LiveStaff = memo(LiveStaffView, (a, b) => {
  if (a.musicalKey !== b.musicalKey || a.splitPoint !== b.splitPoint) return false
  if (a.sounding.length !== b.sounding.length) return false
  return a.sounding.every((note, index) => note === b.sounding[index])
})
