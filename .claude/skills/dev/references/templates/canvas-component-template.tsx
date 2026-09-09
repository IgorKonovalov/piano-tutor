// Template: renderer/components/<CanvasName>.tsx
//
// For any component that owns a non-React resource: a VexFlow renderer and context, a canvas
// 2D context with a ResizeObserver, a timer, a MessagePort, a push-channel subscription.
//
// The pattern is TWO effects:
//   1. Create the resource ONCE on mount and return the cleanup that disposes it.
//   2. Push data into the resource when props change. Never recreate it on a data change.
//
// Combining the two is the canonical Electron memory leak, and it flickers.

import { useEffect, useRef } from 'react'
import type { HeldNotes } from '@core/midi/HeldNotes'
import styles from './CanvasName.module.css'

interface Props {
  held: HeldNotes
  /** Read by assistive technology; the canvas itself carries no text. */
  ariaLabel: string
}

interface Handle {
  draw(held: HeldNotes): void
  resize(width: number, height: number): void
  dispose(): void
}

// The library-specific construction lives in one function so the component stays a lifecycle.
function createHandle(host: HTMLDivElement): Handle {
  // e.g. new Renderer(host, Renderer.Backends.SVG) for VexFlow, or host.appendChild(canvas)
  throw new Error('replace with the real construction')
}

export function CanvasName({ held, ariaLabel }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<Handle | null>(null)

  // Effect 1: lifecycle. Empty deps; runs once per mount.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const handle = createHandle(host)
    handleRef.current = handle

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      handle.resize(width, height)
    })
    observer.observe(host)

    return () => {
      observer.disconnect()
      handle.dispose()
      handleRef.current = null
    }
  }, [])

  // Effect 2: data. Runs when the held set changes; does not touch the instance's lifetime.
  useEffect(() => {
    handleRef.current?.draw(held)
  }, [held])

  return <div ref={hostRef} className={styles.host} role="img" aria-label={ariaLabel} />
}

// Notes:
// - Every resource created in effect 1 is destroyed in its cleanup: the observer AND the handle.
// - If drawing per event proves too slow for NFR 1, the fix is inside `draw` (dirty flag, a
//   30 Hz requestAnimationFrame coalescer), measured with the overlay, not a rewrite here.
// - A push-channel subscription follows the same shape: subscribe in effect 1, return the
//   cleanup the preload binding handed back.
