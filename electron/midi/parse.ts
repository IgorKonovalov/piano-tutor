import type { MidiEvent } from '../../shared/midi'

/**
 * Bytes to typed events, once, in main (ADR-0001).
 *
 * A byte stream, not a message list: RtMidi normally hands over whole
 * messages, but the parser owns running status and interleaved real-time bytes
 * so that the shape of what arrives is the transport's business and not the
 * pipeline's. Nothing here throws. A byte that cannot be understood becomes an
 * `unknown` event carrying the raw bytes, because a malformed message must
 * never close the port under a player's hands.
 *
 * Instances are stateful: one parser per open port, discarded on close.
 */

/** Beyond this a sysex dump is a stuck stream, not a message; stop collecting. */
const MAX_SYSEX_BYTES = 256

function statusKind(status: number): 'channel' | 'systemCommon' | 'realTime' | 'sysexStart' {
  if (status >= 0xf8) return 'realTime'
  if (status === 0xf0) return 'sysexStart'
  if (status >= 0xf1) return 'systemCommon'
  return 'channel'
}

/** Program change and channel pressure carry one data byte; the rest carry two. */
function dataBytesFor(status: number): number {
  const type = status & 0xf0
  return type === 0xc0 || type === 0xd0 ? 1 : 2
}

/** How many data bytes a system common message expects before it is complete. */
function systemCommonDataBytes(status: number): number {
  if (status === 0xf2) return 2
  if (status === 0xf1 || status === 0xf3) return 1
  return 0
}

export class MidiParser {
  /** The last channel status seen; reused when a data byte arrives bare. */
  private runningStatus: number | null = null
  private status: number | null = null
  private data: number[] = []
  private expected = 0
  private sysex: number[] | null = null

  parse(bytes: Uint8Array | number[], t: number): MidiEvent[] {
    const events: MidiEvent[] = []
    for (const byte of bytes) this.feed(byte & 0xff, t, events)
    return events
  }

  private feed(byte: number, t: number, out: MidiEvent[]): void {
    // Real-time bytes are legal anywhere, including between the status byte
    // and the data bytes of another message. They carry nothing this app uses,
    // so they are dropped without disturbing the message in flight.
    if (byte >= 0xf8) return

    if (this.sysex !== null) {
      if (byte === 0xf7) {
        this.sysex.push(byte)
        out.push({ kind: 'unknown', t, bytes: this.sysex })
        this.sysex = null
        return
      }
      if (byte < 0x80) {
        if (this.sysex.length < MAX_SYSEX_BYTES) this.sysex.push(byte)
        return
      }
      // A status byte inside a sysex means the dump was truncated. Report what
      // was collected and let the byte start its own message.
      out.push({ kind: 'unknown', t, bytes: this.sysex })
      this.sysex = null
    }

    if (byte >= 0x80) {
      this.beginMessage(byte, t, out)
      return
    }

    if (this.status === null) {
      // A data byte with no status before it: a stream joined mid-message.
      out.push({ kind: 'unknown', t, bytes: [byte] })
      return
    }

    this.data.push(byte)
    if (this.data.length === this.expected) {
      this.complete(t, out)
    }
  }

  private beginMessage(status: number, t: number, out: MidiEvent[]): void {
    switch (statusKind(status)) {
      case 'realTime':
        return
      case 'sysexStart':
        this.runningStatus = null
        this.status = null
        this.data = []
        this.sysex = [status]
        return
      case 'systemCommon': {
        // System common cancels running status (MIDI 1.0). F7 outside a dump
        // and the undefined statuses carry no data and are reported as they are.
        this.runningStatus = null
        this.status = status
        this.data = []
        this.expected = systemCommonDataBytes(status)
        if (this.expected === 0) {
          out.push({ kind: 'unknown', t, bytes: [status] })
          this.status = null
        }
        return
      }
      case 'channel':
        this.runningStatus = status
        this.status = status
        this.data = []
        this.expected = dataBytesFor(status)
        return
    }
  }

  private complete(t: number, out: MidiEvent[]): void {
    const status = this.status
    const data = this.data
    this.data = []
    if (status === null) return

    if (statusKind(status) === 'systemCommon') {
      out.push({ kind: 'unknown', t, bytes: [status, ...data] })
      this.status = null
      return
    }

    // Running status: the next bare data byte starts another message of the
    // same type, so the status stays armed.
    this.status = this.runningStatus
    out.push(toEvent(status, data, t))
  }
}

function toEvent(status: number, data: number[], t: number): MidiEvent {
  const ch = status & 0x0f
  const type = status & 0xf0
  const [a = 0, b = 0] = data

  switch (type) {
    case 0x80:
      return { kind: 'noteOff', t, ch, note: a, velocity: b }
    case 0x90:
      // Note-on at velocity 0 is a note-off. Instruments use it constantly to
      // keep running status alive across a legato passage.
      return b === 0
        ? { kind: 'noteOff', t, ch, note: a, velocity: 0 }
        : { kind: 'noteOn', t, ch, note: a, velocity: b }
    case 0xb0:
      return { kind: 'cc', t, ch, controller: a, value: b }
    case 0xc0:
      return { kind: 'programChange', t, ch, program: a }
    case 0xe0:
      return { kind: 'pitchBend', t, ch, value: ((b << 7) | a) - 8192 }
    default:
      // Polyphonic key pressure (0xA0) and channel pressure (0xD0) are typed
      // and kept whole rather than dropped; no view reads them yet.
      return { kind: 'unknown', t, bytes: [status, ...data] }
  }
}

/**
 * The inverse, for the synthetic source: an event back into the bytes an
 * instrument would have sent. The harness must go through the parser rather
 * than around it (ADR-0004), so it has to speak bytes.
 */
export function toBytes(event: MidiEvent): number[] {
  switch (event.kind) {
    case 'noteOn':
      return [0x90 | event.ch, event.note, event.velocity]
    case 'noteOff':
      return [0x80 | event.ch, event.note, event.velocity]
    case 'cc':
      return [0xb0 | event.ch, event.controller, event.value]
    case 'programChange':
      return [0xc0 | event.ch, event.program]
    case 'pitchBend': {
      const raw = event.value + 8192
      return [0xe0 | event.ch, raw & 0x7f, (raw >> 7) & 0x7f]
    }
    case 'unknown':
      return [...event.bytes]
  }
}
