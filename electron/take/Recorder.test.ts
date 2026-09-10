import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MINIMUM_NOTE_ONS, Recorder } from './Recorder'
import { ReplaySource } from '../midi/ReplaySource'
import { MidiParser } from '../midi/parse'
import type { Clock } from '../midi/timedSource'
import { listTakes, readTake, takePath } from './takeFile'
import type { MidiEvent } from '../../shared/midi'
import { TakeIdSchema, TakeReplayRequestSchema } from '../../shared/take'
import { findScenarioById } from '../../core/src/midi/generate'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'piano-tutor-takes-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

const on = (note: number, t: number): MidiEvent => ({ kind: 'noteOn', t, ch: 0, note, velocity: 80 })
const off = (note: number, t: number): MidiEvent => ({
  kind: 'noteOff',
  t,
  ch: 0,
  note,
  velocity: 0,
})

function record(events: MidiEvent[], port = 'virtual:ii-V-I-in-F') {
  const recorder = new Recorder()
  const id = recorder.start({
    directory,
    port,
    portName: 'Test port',
    appVersion: '0.1.0',
    now: () => new Date('2026-09-10T10:00:00.000Z'),
  })
  for (const event of events) recorder.append(event)
  const result = recorder.stop()
  return { id, result }
}

/** Enough note-ons that the take is worth keeping. */
function longEnough(count = MINIMUM_NOTE_ONS): MidiEvent[] {
  const events: MidiEvent[] = []
  for (let i = 0; i < count; i++) {
    events.push(on(60 + (i % 12), 1000 + i * 100))
    events.push(off(60 + (i % 12), 1000 + i * 100 + 50))
  }
  return events
}

describe('the take file', () => {
  it('writes a header and one line per event', () => {
    const { id } = record(longEnough())
    const { header, events, skippedLines } = readTake(takePath(directory, id))

    expect(header.format).toBe(1)
    expect(header.port).toBe('virtual:ii-V-I-in-F')
    expect(header.portName).toBe('Test port')
    expect(header.appVersion).toBe('0.1.0')
    expect(events).toHaveLength(MINIMUM_NOTE_ONS * 2)
    expect(skippedLines).toBe(0)
  })

  it('rebases every time on the first event', () => {
    const { id } = record(longEnough())
    const { events } = readTake(takePath(directory, id))
    expect(events[0]?.t).toBe(0)
    expect(events[1]?.t).toBe(50)
  })

  it('records the port id verbatim, so a generated take says so', () => {
    const { id } = record(longEnough())
    const [row] = listTakes(directory)
    expect(row?.port).toBe('virtual:ii-V-I-in-F')
    expect(row?.synthetic).toBe(true)
    expect(readTake(takePath(directory, id)).header.port).toBe('virtual:ii-V-I-in-F')
  })

  it('marks a hardware take as not synthetic', () => {
    record(longEnough(), 'hw:0')
    expect(listTakes(directory)[0]?.synthetic).toBe(false)
  })
})

describe('the takes list', () => {
  it('shows duration, note count and port for each file', () => {
    record(longEnough())
    const [row] = listTakes(directory)
    expect(row?.noteCount).toBe(MINIMUM_NOTE_ONS)
    expect(row?.eventCount).toBe(MINIMUM_NOTE_ONS * 2)
    expect(row?.durationMs).toBe(900 + 50)
    expect(row?.portName).toBe('Test port')
  })

  it('is empty when nothing has been recorded', () => {
    expect(listTakes(directory)).toEqual([])
  })

  it('leaves out a file it cannot read, rather than failing the whole list', () => {
    record(longEnough())
    writeFileSync(join(directory, 'broken.jsonl'), 'not json at all\n', 'utf8')
    expect(listTakes(directory)).toHaveLength(1)
  })

  it('puts the newest take first', () => {
    const first = new Recorder()
    first.start({
      directory,
      port: 'hw:0',
      portName: 'a',
      appVersion: '0.1.0',
      now: () => new Date('2026-09-10T10:00:00.000Z'),
    })
    for (const e of longEnough()) first.append(e)
    first.stop()

    const second = new Recorder()
    second.start({
      directory,
      port: 'hw:0',
      portName: 'b',
      appVersion: '0.1.0',
      now: () => new Date('2026-09-10T11:00:00.000Z'),
    })
    for (const e of longEnough()) second.append(e)
    second.stop()

    expect(listTakes(directory).map((r) => r.portName)).toEqual(['b', 'a'])
  })
})

describe('a take id is a path segment, never a path', () => {
  it('accepts the id the recorder actually produces', () => {
    const { id } = record(longEnough())
    expect(TakeIdSchema.safeParse({ id }).success).toBe(true)
    expect(TakeReplayRequestSchema.safeParse({ id, speed: 1 }).success).toBe(true)
  })

  it('refuses an id that would climb out of the takes directory', () => {
    // Main joins the id onto the takes directory, so the schema is what stands
    // between a payload and an arbitrary path.
    for (const id of ['../../secrets', '..', 'a/b', 'a\\b', 'take.jsonl', '']) {
      expect(TakeIdSchema.safeParse({ id }).success, id).toBe(false)
      expect(TakeReplayRequestSchema.safeParse({ id, speed: 1 }).success, id).toBe(false)
    }
  })

  it('keeps the id and the filename the same thing', () => {
    // What `listTakes` reports as an id is the filename without its extension,
    // so a row the user can see is a row the schema will let them open.
    record(longEnough())
    const [row] = listTakes(directory)
    expect(row).toBeDefined()
    expect(TakeIdSchema.safeParse({ id: row!.id }).success).toBe(true)
  })
})

describe('a session too short to be a take', () => {
  it('is deleted at stop rather than listed', () => {
    const { id, result } = record(longEnough(MINIMUM_NOTE_ONS - 1))
    expect(result?.discarded).toBe(true)
    expect(existsSync(takePath(directory, id))).toBe(false)
    expect(listTakes(directory)).toEqual([])
  })

  it('is kept at exactly the threshold', () => {
    const { result } = record(longEnough(MINIMUM_NOTE_ONS))
    expect(result?.discarded).toBe(false)
    expect(listTakes(directory)).toHaveLength(1)
  })
})

describe('NFR 8: a take survives the process being killed', () => {
  it('keeps everything up to the last flush, and drops a torn final line', () => {
    const recorder = new Recorder()
    const id = recorder.start({
      directory,
      port: 'virtual:dense-2000',
      portName: 'Dense',
      appVersion: '0.1.0',
      now: () => new Date('2026-09-10T10:00:00.000Z'),
    })

    const events = findScenarioById('virtual:dense-2000')!.generate()
    // Flush a batch, then feed more and never flush, then tear the tail: that
    // is exactly the file a kill leaves behind.
    const flushed = events.slice(0, 200)
    for (const event of flushed) recorder.append(event)
    recorder.flush()
    for (const event of events.slice(200, 260)) recorder.append(event)

    const path = takePath(directory, id)
    const torn = JSON.stringify(events[260]).slice(0, 20)
    writeFileSync(path, readFileSync(path, 'utf8') + torn, 'utf8')

    // Read before stopping: `stop` flushes, and a kill does not.
    const { header, events: recovered, skippedLines } = readTake(path)
    recorder.stop()
    expect(header.port).toBe('virtual:dense-2000')
    expect(skippedLines).toBe(1)
    // Everything up to the last flush is intact and in order; the unflushed
    // tail is the only loss, and it is bounded by the flush interval.
    expect(recovered).toHaveLength(flushed.length)
    expect(recovered[0]?.t).toBe(0)
    expect(recovered.map((e) => e.kind)).toEqual(flushed.map((e) => e.kind))
  })

  it('loses nothing at all when the flush did run', () => {
    const recorder = new Recorder()
    const id = recorder.start({
      directory,
      port: 'hw:0',
      portName: 'x',
      appVersion: '0.1.0',
      now: () => new Date('2026-09-10T10:00:00.000Z'),
    })
    const events = findScenarioById('virtual:dense-2000')!.generate().slice(0, 400)
    for (const event of events) recorder.append(event)
    recorder.flush()
    const { events: recovered } = readTake(takePath(directory, id))
    recorder.stop()

    expect(recovered).toHaveLength(events.length)
  })

  it('bounds the loss by the flush interval, not by the take length', () => {
    // At the dense scenario's 100-200 events a second, one flush interval is a
    // couple of hundred events however long the session has been running.
    const recorder = new Recorder()
    const id = recorder.start({
      directory,
      port: 'hw:0',
      portName: 'x',
      appVersion: '0.1.0',
      now: () => new Date('2026-09-10T10:00:00.000Z'),
    })
    const events = findScenarioById('virtual:dense-2000')!.generate()
    for (const event of events) recorder.append(event)
    recorder.flush()
    for (const event of events.slice(0, 150)) recorder.append(event)
    const { events: recovered } = readTake(takePath(directory, id))
    recorder.stop()

    // The session ran to 2 200 events and 150 more arrived after the last
    // flush. Everything flushed is on disk, so the loss is the unflushed tail
    // and nothing else: it does not grow with the length of the take.
    expect(recovered).toHaveLength(events.length)
  })
})

describe('a real process killed outright', () => {
  it('leaves a take that still reads back', () => {
    // The recorder's guarantee is about bytes reaching the operating system,
    // so this drives a real child process and kills it without warning.
    const child = join(directory, 'child.mjs')
    const takeFile = join(directory, 'killed.jsonl')
    writeFileSync(
      child,
      [
        `import { appendFileSync, writeFileSync } from 'node:fs'`,
        `const path = ${JSON.stringify(takeFile.replace(/\\/g, '/'))}`,
        `writeFileSync(path, JSON.stringify({ format: 1, startedAt: '2026-09-10T10:00:00.000Z', port: 'hw:0', portName: 'x', appVersion: '0.1.0' }) + '\\n')`,
        `let t = 0`,
        `setInterval(() => {`,
        `  let chunk = ''`,
        `  for (let i = 0; i < 64; i++) chunk += JSON.stringify({ kind: 'noteOn', t: t++, ch: 0, note: 60, velocity: 80 }) + '\\n'`,
        `  appendFileSync(path, chunk)`,
        `}, 50)`,
        `console.log('ready')`,
      ].join('\n'),
      'utf8'
    )

    const proc = spawnSync(process.execPath, ['-e', `
      const { spawn } = require('node:child_process')
      const p = spawn(process.execPath, [${JSON.stringify(child.replace(/\\/g, '/'))}])
      setTimeout(() => { p.kill('SIGKILL'); process.exit(0) }, 600)
    `])
    expect(proc.status).toBe(0)

    const { header, events } = readTake(takeFile)
    expect(header.port).toBe('hw:0')
    expect(events.length).toBeGreaterThan(0)
  })
})


/**
 * A clock the test drives, so an eighteen-second take replays in milliseconds
 * without the take being shortened.
 */
function fakeClock() {
  let current = 0
  let pending: { at: number; fn: () => void } | null = null
  const clock: Clock = {
    now: () => current,
    setTimeout: (fn, ms) => {
      pending = { at: current + ms, fn }
      return pending
    },
    clearTimeout: () => {
      pending = null
    },
  }
  const runToCompletion = (maxSteps = 100_000) => {
    let steps = 0
    while (pending !== null && steps++ < maxSteps) {
      const due = pending
      pending = null
      current = Math.max(current, due.at)
      due.fn()
    }
    if (steps >= maxSteps) throw new Error('the replay did not finish')
  }
  return { clock, runToCompletion }
}

describe('NFR 2 across the record and replay round trip', () => {
  it('replays a dense take with the same event count it recorded', async () => {
    const recorder = new Recorder()
    const id = recorder.start({
      directory,
      port: 'virtual:dense-2000',
      portName: 'Dense',
      appVersion: '0.1.0',
      now: () => new Date('2026-09-10T10:00:00.000Z'),
    })
    const generated = findScenarioById('virtual:dense-2000')!.generate()
    for (const event of generated) recorder.append(event)
    const recorded = recorder.stop()

    expect(recorded?.eventCount).toBe(generated.length)
    const path = takePath(directory, id)
    expect(readTake(path).events).toHaveLength(generated.length)

    // Replayed through the same parser the device path uses: the bytes go out
    // and typed events come back, and nothing is lost either way.
    const { clock, runToCompletion } = fakeClock()
    const source = new ReplaySource({ path }, clock)
    const parser = new MidiParser()
    const replayed: MidiEvent[] = []
    source.onMessage((bytes, t) => replayed.push(...parser.parse(bytes, t)))
    await source.open()
    runToCompletion()

    expect(replayed).toHaveLength(generated.length)
    expect(replayed.map((e) => ({ ...e, t: 0 }))).toEqual(
      generated.map((e) => ({ ...e, t: 0 }))
    )
  })

  it('preserves the recorded timing, and scales it by the speed', async () => {
    const recorder = new Recorder()
    const id = recorder.start({
      directory,
      port: 'virtual:ii-V-I-in-F',
      portName: 'ii-V-I',
      appVersion: '0.1.0',
      now: () => new Date('2026-09-10T10:00:00.000Z'),
    })
    const generated = findScenarioById('virtual:ii-V-I-in-F')!.generate()
    for (const event of generated) recorder.append(event)
    recorder.stop()
    const path = takePath(directory, id)
    const span = generated[generated.length - 1]!.t - generated[0]!.t

    const spanAt = async (speed: number) => {
      const { clock, runToCompletion } = fakeClock()
      const source = new ReplaySource({ path, speed }, clock)
      const stamps: number[] = []
      source.onMessage((_bytes, t) => stamps.push(t))
      await source.open()
      runToCompletion()
      return stamps[stamps.length - 1]! - stamps[0]!
    }

    expect(await spanAt(1)).toBe(span)
    expect(await spanAt(2)).toBe(span / 2)
    expect(await spanAt(0.5)).toBe(span * 2)
  })
})
