import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ScoreMeta } from '../../shared/score'

/**
 * The score library and the bytes of whichever score is open. Both are main's
 * (ADR-0005): the renderer holds an id and asks for content, and never learns
 * a filesystem path.
 */

export type LibraryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; scores: ScoreMeta[] }

export interface ScoreLibrary {
  state: LibraryState
  refresh: () => Promise<void>
  /** Opens main's file dialog. Resolves to null when the player cancels. */
  add: () => Promise<ScoreMeta | null>
  /** Records the title OSMD reported, once, and refreshes the list. */
  recordTitle: (id: string, title: string) => Promise<void>
}

export function useScoreLibrary(): ScoreLibrary {
  const [state, setState] = useState<LibraryState>({ status: 'loading' })

  const refresh = useCallback(async () => {
    try {
      setState({ status: 'ready', scores: await window.api.score.list() })
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message })
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    window.api.score
      .list()
      .then((scores) => {
        if (!cancelled) setState({ status: 'ready', scores })
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ status: 'error', message: err.message })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const add = useCallback(async (): Promise<ScoreMeta | null> => {
    try {
      const result = await window.api.score.import()
      if (result.cancelled) return null
      await refresh()
      return result.meta
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message })
      return null
    }
  }, [refresh])

  const recordTitle = useCallback(
    async (id: string, title: string) => {
      await window.api.score.setTitle(id, title)
      await refresh()
    },
    [refresh]
  )

  // Memoised so the object's identity changes when the library does and not
  // once per render: consumers put it in dependency arrays.
  return useMemo(
    () => ({ state, refresh, add, recordTitle }),
    [state, refresh, add, recordTitle]
  )
}

export type ContentState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; id: string; bytes: Uint8Array }

interface ReadResult {
  id: string
  bytes?: Uint8Array
  message?: string
}

/** Base64 rather than a typed array crosses the bridge; this is the other half. */
function decode(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function useScoreContent(id: string | null): ContentState {
  const [result, setResult] = useState<ReadResult | null>(null)

  useEffect(() => {
    if (id === null) return
    let cancelled = false
    window.api.score
      .read(id)
      .then((content) => {
        if (!cancelled) setResult({ id, bytes: decode(content.base64) })
      })
      .catch((err: Error) => {
        if (!cancelled) setResult({ id, message: err.message })
      })
    return () => {
      cancelled = true
    }
  }, [id])

  // Idle and loading are derived rather than stored, so a read that is still
  // in flight cannot show the previous score's bytes under the new score's id.
  if (id === null) return { status: 'idle' }
  if (result === null || result.id !== id) return { status: 'loading' }
  return result.bytes === undefined
    ? { status: 'error', message: result.message ?? 'unknown error' }
    : { status: 'ready', id, bytes: result.bytes }
}
