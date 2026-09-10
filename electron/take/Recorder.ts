import { appendFileSync, rmSync, writeFileSync } from 'node:fs'
import type { MidiEvent } from '../../shared/midi'
import { makeHeader, serialiseLine, takeIdFor, takePath } from './takeFile'

/**
 * Every event of a session, appended to a take file.
 *
 * Two rules shape it. The disk write never sits on the event path: an arriving
 * event goes into an array and returns, and the flush happens on a timer or on
 * a `setImmediate` after the batch. And the flush itself is synchronous, so
 * when it returns the bytes are the operating system's -- which is what makes
 * "at most one second lost" (NFR 8) a fact about the file rather than a hope
 * about how the process died.
 */

/** NFR 8: never more than this much playing is unflushed. */
export const FLUSH_INTERVAL_MS = 1000

/** A dense passage reaches this long before the timer does. */
export const FLUSH_EVENT_COUNT = 64

/**
 * A session shorter than this is a mis-click or a port being tried, not a
 * take. It is deleted at stop rather than listed.
 */
export const MINIMUM_NOTE_ONS = 10

export interface RecorderOptions {
  directory: string
  port: string
  portName: string
  appVersion: string
  /** Injected so a test can record a known clock. */
  now?: () => Date
}

export interface RecordedTake {
  id: string
  path: string
  noteCount: number
  eventCount: number
  /** True when the take was too short to keep and its file was removed. */
  discarded: boolean
}

export class Recorder {
  private path: string | null = null
  private id: string | null = null
  private buffer: string[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private flushScheduled = false
  private startOffset: number | null = null
  private noteCount = 0
  private eventCount = 0

  get recording(): boolean {
    return this.path !== null
  }

  start(options: RecorderOptions): string {
    this.stop()

    const startedAt = (options.now ?? (() => new Date()))()
    const id = takeIdFor(startedAt)
    const path = takePath(options.directory, id)

    writeFileSync(
      path,
      serialiseLine(
        makeHeader({
          startedAt,
          port: options.port,
          portName: options.portName,
          appVersion: options.appVersion,
        })
      ),
      'utf8'
    )

    this.path = path
    this.id = id
    this.buffer = []
    this.startOffset = null
    this.noteCount = 0
    this.eventCount = 0
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)
    return id
  }

  /**
   * Called from the arrival path, so it does no I/O. Times are rebased on the
   * first event, which is what makes a take independent of when the process
   * that recorded it happened to start.
   */
  append(event: MidiEvent): void {
    if (this.path === null) return
    this.startOffset ??= event.t
    this.buffer.push(serialiseLine({ ...event, t: event.t - this.startOffset }))

    this.eventCount++
    if (event.kind === 'noteOn') this.noteCount++

    if (this.buffer.length >= FLUSH_EVENT_COUNT && !this.flushScheduled) {
      this.flushScheduled = true
      setImmediate(() => {
        this.flushScheduled = false
        this.flush()
      })
    }
  }

  flush(): void {
    if (this.path === null || this.buffer.length === 0) return
    const chunk = this.buffer.join('')
    this.buffer = []
    appendFileSync(this.path, chunk, 'utf8')
  }

  stop(): RecordedTake | null {
    if (this.path === null || this.id === null) return null
    this.flush()
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null

    const result: RecordedTake = {
      id: this.id,
      path: this.path,
      noteCount: this.noteCount,
      eventCount: this.eventCount,
      discarded: this.noteCount < MINIMUM_NOTE_ONS,
    }
    if (result.discarded) rmSync(this.path, { force: true })

    this.path = null
    this.id = null
    this.startOffset = null
    return result
  }
}
