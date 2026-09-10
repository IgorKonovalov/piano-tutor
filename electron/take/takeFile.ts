import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { MidiEventSchema, type MidiEvent } from '../../shared/midi'
import {
  TAKE_FORMAT_VERSION,
  TakeHeaderSchema,
  type TakeContent,
  type TakeHeader,
  type TakeSummaryRow,
} from '../../shared/take'

/**
 * Reading and writing the take format. One header line, then one event per
 * line, times relative to the header's start.
 *
 * Reading is deliberately forgiving of the *end* of a file and strict about
 * everything else. A take that was being written when the process died has a
 * truncated final line; dropping it costs the events since the last flush and
 * nothing more, which is the whole of NFR 8. A line that is malformed anywhere
 * else is still dropped rather than thrown on, because a take is user data and
 * one bad line should not make a session unopenable.
 */

export const TAKE_FILE_EXTENSION = '.jsonl'

export function takesDirectory(userDataPath: string): string {
  const dir = join(userDataPath, 'takes')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** A sortable id from the wall clock; `:` is not legal in a Windows filename. */
export function takeIdFor(startedAt: Date): string {
  return startedAt.toISOString().replace(/[:.]/g, '-')
}

export function takePath(directory: string, id: string): string {
  return join(directory, `${id}${TAKE_FILE_EXTENSION}`)
}

export function makeHeader(options: {
  startedAt: Date
  port: string
  portName: string
  appVersion: string
}): TakeHeader {
  return {
    format: TAKE_FORMAT_VERSION,
    startedAt: options.startedAt.toISOString(),
    port: options.port,
    portName: options.portName,
    appVersion: options.appVersion,
  }
}

export function serialiseLine(value: TakeHeader | MidiEvent): string {
  return `${JSON.stringify(value)}\n`
}

/** A port id that names a generated scenario rather than a device (ADR-0004). */
export function isSyntheticPort(port: string): boolean {
  return port.startsWith('virtual:')
}

export function readTake(path: string): TakeContent {
  const raw = readFileSync(path, 'utf8')
  const lines = raw.split('\n').filter((line) => line.length > 0)

  const [headerLine, ...eventLines] = lines
  if (headerLine === undefined) throw new Error(`${path} is empty`)
  const header = TakeHeaderSchema.parse(JSON.parse(headerLine))

  const events: MidiEvent[] = []
  let skippedLines = 0
  for (const line of eventLines) {
    try {
      events.push(MidiEventSchema.parse(JSON.parse(line)))
    } catch {
      skippedLines++
    }
  }
  return { header, events, skippedLines }
}

export function summarise(path: string, id: string): TakeSummaryRow {
  const { header, events } = readTake(path)
  const first = events[0]
  const last = events[events.length - 1]
  return {
    id,
    startedAt: header.startedAt,
    port: header.port,
    portName: header.portName,
    durationMs: first === undefined || last === undefined ? 0 : last.t - first.t,
    noteCount: events.filter((e) => e.kind === 'noteOn').length,
    eventCount: events.length,
    synthetic: isSyntheticPort(header.port),
  }
}

/** Newest first. A file that will not parse at all is left out, not fatal. */
export function listTakes(directory: string): TakeSummaryRow[] {
  if (!existsSync(directory)) return []
  const rows: TakeSummaryRow[] = []
  for (const name of readdirSync(directory)) {
    if (!name.endsWith(TAKE_FILE_EXTENSION)) continue
    const path = join(directory, name)
    if (!statSync(path).isFile()) continue
    try {
      rows.push(summarise(path, name.slice(0, -TAKE_FILE_EXTENSION.length)))
    } catch {
      // A file we cannot read is a file we do not list. It stays on disk.
    }
  }
  return rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}
