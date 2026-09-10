import { useCallback, useEffect, useRef, useState } from 'react'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import type { BarState as VerdictState, ExpectedTimeline } from '../../shared/score'
import { timelineFromOsmd } from './timelineFromOsmd'
import styles from './OsmdView.module.css'

/**
 * The engraved score (ADR-0003), and the one thing that can address a bar the
 * player is looking at.
 *
 * Bars are marked with an overlay layer rather than by recolouring noteheads.
 * Two reasons, and the second is the load-bearing one: a mark is then a box we
 * position from OSMD's own graphical measure, so a bar mark cannot land
 * anywhere except on the bar OSMD drew; and marking costs no layout pass,
 * which is what keeps the turnaround of NFR 12 about alignment rather than
 * about re-engraving. Note-level colouring is a separate capability and does
 * need a re-render.
 */

/** OSMD lays out in its own units and draws at ten pixels to the unit. */
const UNIT_IN_PIXELS = 10

/** A resize re-engraves the whole score, so it waits for the drag to settle. */
const RESIZE_SETTLE_MS = 150

/**
 * Every verdict a bar can carry, plus `highlight` for a bar the player has
 * simply pointed at. Taking the verdict states from `shared/` rather than
 * restating them means a new one cannot be added to the report and quietly go
 * unpainted.
 */
export type BarState = VerdictState | 'highlight'

export interface BarMark {
  /** OSMD's measure index, verbatim (ADR-0005). */
  bar: number
  state: BarState
  /**
   * Read out beside the mark. Colour is never the only carrier of a verdict,
   * so a marked bar always says something a screen reader can reach.
   */
  label: string
}

export interface ScoreLoaded {
  title: string
  barCount: number
  /**
   * Parse, engrave and extract, in milliseconds on this machine. Extraction
   * runs on the renderer's main thread at load (ADR-0005), off the MIDI paint
   * path entirely, so this is the figure that says whether a large score costs
   * a visible moment to open.
   */
  loadMs: number
  /**
   * Extracted from the model OSMD just parsed, in the same pass that drew it
   * (ADR-0005). One parse of the file, by the library that draws it.
   */
  timeline: ExpectedTimeline
}

export interface OsmdViewProps {
  /** Changing `id` loads a new score; `bytes` is the file, unmodified. */
  id: string
  bytes: Uint8Array
  marks: readonly BarMark[]
  onLoaded: (loaded: ScoreLoaded) => void
  onError: (message: string) => void
  onBarClick?: (bar: number) => void
}

interface BarBox {
  bar: number
  left: number
  top: number
  width: number
  height: number
}

/**
 * One box per source measure, in pixels relative to the rendered sheet's
 * top-left, unioned across the staves the measure spans so a grand-staff bar
 * is one box rather than two.
 *
 * The index into `MeasureList` is OSMD's measure index: the list carries one
 * entry per source measure, including the measures a multi-measure rest
 * collapses into a single drawn object, which is why a box can be missing but
 * an index is never skipped.
 */
function measureBoxes(osmd: OpenSheetMusicDisplay): BarBox[] {
  const unit = UNIT_IN_PIXELS * osmd.zoom
  const list = osmd.GraphicSheet?.MeasureList ?? []
  const boxes: BarBox[] = []

  list.forEach((staves, bar) => {
    let left = Number.POSITIVE_INFINITY
    let top = Number.POSITIVE_INFINITY
    let right = Number.NEGATIVE_INFINITY
    let bottom = Number.NEGATIVE_INFINITY

    for (const measure of staves ?? []) {
      const box = measure?.PositionAndShape
      if (box === undefined) continue
      left = Math.min(left, box.AbsolutePosition.x + box.BorderLeft)
      right = Math.max(right, box.AbsolutePosition.x + box.BorderRight)
      top = Math.min(top, box.AbsolutePosition.y + box.BorderTop)
      bottom = Math.max(bottom, box.AbsolutePosition.y + box.BorderBottom)
    }

    if (!Number.isFinite(left) || right <= left) return
    boxes.push({
      bar,
      left: left * unit,
      top: top * unit,
      width: (right - left) * unit,
      height: (bottom - top) * unit,
    })
  })

  return boxes
}

export function OsmdView({ id, bytes, marks, onLoaded, onError, onBarClick }: OsmdViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)
  const [boxes, setBoxes] = useState<BarBox[]>([])
  const [rendered, setRendered] = useState<string | null>(null)

  // The callbacks are held in refs and the load effect depends only on the
  // score. A parent that hands down a fresh closure each render -- which the
  // title write-back makes certain, since it refreshes the library -- would
  // otherwise re-load and re-engrave the sheet on every render.
  const onLoadedRef = useRef(onLoaded)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onLoadedRef.current = onLoaded
    onErrorRef.current = onError
  })

  // Effect 1: the instance. Created once against the host, cleared on unmount.
  // OSMD is not a React resource -- letting a re-render construct a second one
  // leaks the first and leaves two SVGs in the host (ADR-0001's disposal rule).
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const osmd = new OpenSheetMusicDisplay(host, {
      autoResize: false,
      backend: 'svg',
      drawTitle: false,
      drawPartNames: false,
      drawingParameters: 'default',
    })
    osmdRef.current = osmd
    return () => {
      osmdRef.current = null
      osmd.clear()
      host.replaceChildren()
    }
  }, [])

  // Effect 2: the data. A load that is overtaken by a newer one drops its
  // result rather than drawing a score the player has already navigated away
  // from.
  useEffect(() => {
    const osmd = osmdRef.current
    if (osmd === null) return
    let cancelled = false

    setRendered(null)
    setBoxes([])
    const startedAt = performance.now()

    // A Blob covers all three extensions: OSMD unzips an .mxl and reads the
    // text of a plain .xml, so nothing here has to know which one this is.
    void osmd
      .load(new Blob([bytes as BlobPart]))
      .then(() => {
        if (cancelled) return
        osmd.render()
        setBoxes(measureBoxes(osmd))
        setRendered(id)
        onLoadedRef.current({
          title: osmd.Sheet?.TitleString ?? '',
          barCount: osmd.GraphicSheet?.MeasureList?.length ?? 0,
          timeline: timelineFromOsmd(osmd.Sheet, id),
          loadMs: Math.round(performance.now() - startedAt),
        })
      })
      .catch((err: Error) => {
        if (!cancelled) onErrorRef.current(err.message)
      })

    return () => {
      cancelled = true
    }
  }, [id, bytes])

  // Effect 3: width. Re-engraving is the expensive operation in this view, so
  // it happens on a settled width and nowhere else.
  useEffect(() => {
    const host = hostRef.current
    if (host === null || rendered === null) return

    let timer: ReturnType<typeof setTimeout> | undefined
    let lastWidth = host.clientWidth
    const observer = new ResizeObserver(() => {
      if (host.clientWidth === lastWidth) return
      lastWidth = host.clientWidth
      clearTimeout(timer)
      timer = setTimeout(() => {
        const osmd = osmdRef.current
        if (osmd === null) return
        osmd.render()
        setBoxes(measureBoxes(osmd))
      }, RESIZE_SETTLE_MS)
    })
    observer.observe(host)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [rendered])

  const markFor = useCallback(
    (bar: number) => marks.find((mark) => mark.bar === bar),
    [marks]
  )

  return (
    <div className={styles.paper} data-testid="osmd-paper" data-score-id={rendered ?? ''}>
      <div ref={hostRef} className={styles.host} data-testid="osmd-host" />
      <div className={styles.layer} data-testid="bar-layer" data-bars={boxes.length}>
        {boxes.map((box) => {
          const mark = markFor(box.bar)
          return (
            <button
              key={box.bar}
              type="button"
              className={mark === undefined ? styles.bar : `${styles.bar} ${styles[mark.state]}`}
              style={{
                left: `${box.left}px`,
                top: `${box.top}px`,
                width: `${box.width}px`,
                height: `${box.height}px`,
              }}
              data-testid="bar-mark"
              data-bar={box.bar}
              data-state={mark?.state ?? 'none'}
              aria-label={mark === undefined ? `Bar ${box.bar}` : `Bar ${box.bar}: ${mark.label}`}
              onClick={() => onBarClick?.(box.bar)}
            >
              {mark !== undefined && <span className={styles.barLabel}>{mark.label}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
