import { Output } from '@julusian/midi'
import { CC_SUSTAIN, type MidiEvent, type MidiPort } from '../../shared/midi'
import {
  type HeldNotes,
  emptyHeldNotes,
  reduceHeldNotes,
  soundingNotes,
} from '../../core/src/midi/HeldNotes'
import type { MidiSink } from './MidiSink'
import { MidiPortUnavailable } from './MidiSource'
import { serialise } from './serialise'

/**
 * The CK88's other half, over the same USB "TO HOST" cable RtMidi already
 * reads. The input port and the output port are two ends of one
 * class-compliant device and are opened independently.
 *
 * The shape is `RtMidiSource`'s, deliberately: one long-lived enumerator that
 * is never opened (ADR-0006 -- listing must not touch the device, and Windows
 * gives no hot-plug callback, so the list is polled), `busy` set only by an
 * open that actually failed, and the record dropped when the port leaves the
 * enumeration rather than left to attach itself to whatever takes the index
 * next.
 *
 * What it adds over the source is the accounting. It remembers what it has
 * sounded, because it is the last thing between a schedule and a chord that
 * keeps ringing in the room; `release` is the only way that memory is spent.
 *
 * Port ids are `out:<index>`, RtMidi's output index, which is a different
 * numbering from the input side's `hw:<index>` on the same machine.
 */
const OUTPUT_PORT_ID = /^out:(\d+)$/

/**
 * All Notes Off. The belt; the explicit note-offs are the braces.
 *
 * Both are sent because neither is sufficient alone. The note-offs only cover
 * what this process knows it started, which is nothing if it has just been
 * handed a port another application left notes ringing on; and CC 123 is a
 * message some instruments ignore, which must not be the only thing standing
 * between the player and a chord that will not stop.
 */
export const CC_ALL_NOTES_OFF = 123

export class RtMidiSink implements MidiSink {
  private enumerator: Output | null = null
  private output: Output | null = null
  private openPortIndex: number | null = null
  private failures = new Map<string, string>()
  private held: HeldNotes = emptyHeldNotes
  /** Every channel this sink has written to, so the panic reaches all of them. */
  private channelsTouched = new Set<number>()
  /** Reported once per open; a failing port would otherwise flood the log. */
  private warned = false

  private getEnumerator(): Output {
    this.enumerator ??= new Output()
    return this.enumerator
  }

  async listPorts(): Promise<MidiPort[]> {
    const enumerator = this.getEnumerator()
    const ports: MidiPort[] = []
    const count = enumerator.getPortCount()
    for (let index = 0; index < count; index++) {
      ports.push(this.describePort(enumerator, index))
    }
    const present = new Set(ports.map((port) => port.id))
    for (const id of this.failures.keys()) {
      if (!present.has(id)) this.failures.delete(id)
    }
    return ports
  }

  private describePort(enumerator: Output, index: number): MidiPort {
    const id = `out:${index}`
    const port: MidiPort = {
      id,
      name: enumerator.getPortName(index),
      kind: 'hardware',
      availability: 'available',
      open: false,
    }
    if (this.openPortIndex === index) return { ...port, open: true, detail: 'Open' }

    const failure = this.failures.get(id)
    if (failure !== undefined) return { ...port, availability: 'busy', detail: failure }
    return port
  }

  async open(portId: string): Promise<void> {
    const match = OUTPUT_PORT_ID.exec(portId)
    if (match === null) throw new MidiPortUnavailable(portId, `${portId} is not an output port`)
    const index = Number(match[1])

    await this.close()
    const output = new Output()
    try {
      output.openPort(index)
    } catch (err) {
      output.destroy()
      const reason = (err as Error).message
      this.failures.set(portId, `The last open failed: ${reason}`)
      throw new MidiPortUnavailable(
        portId,
        `Windows would not open this output: ${reason}. ` +
          'The instrument may have been unplugged, or another application may be holding it.'
      )
    }

    this.failures.delete(portId)
    this.output = output
    this.openPortIndex = index
    this.warned = false
  }

  /**
   * Silence first, then let go. Closing a port with notes still down leaves
   * them down: the driver stops accepting messages and nothing else will ever
   * send the note-offs.
   */
  async close(): Promise<void> {
    this.release()
    if (this.output !== null) {
      this.output.closePort()
      this.output.destroy()
      this.output = null
    }
    this.openPortIndex = null
  }

  send(event: MidiEvent): void {
    // Tracked whether or not a port is open, so that opening one mid-schedule
    // never inherits an empty idea of what is sounding.
    this.held = reduceHeldNotes(this.held, event)
    if (event.kind !== 'unknown') this.channelsTouched.add(event.ch)
    this.write(event)
  }

  /**
   * Everything this sink has sounded, stopped: a note-off for each note it
   * knows is down, then All Notes Off and sustain-up on every channel it has
   * written to. This is the last thing between a schedule and a chord ringing
   * in the room, so it is deliberately more than is strictly needed.
   */
  release(): void {
    for (const note of soundingNotes(this.held)) {
      this.write({ kind: 'noteOff', t: 0, ch: note.ch, note: note.note, velocity: 0 })
    }
    for (const ch of [...this.channelsTouched].sort((a, b) => a - b)) {
      this.write({ kind: 'cc', t: 0, ch, controller: CC_ALL_NOTES_OFF, value: 0 })
      this.write({ kind: 'cc', t: 0, ch, controller: CC_SUSTAIN, value: 0 })
    }
    this.held = emptyHeldNotes
    this.channelsTouched.clear()
  }

  private write(event: MidiEvent): void {
    const output = this.output
    if (output === null) return
    try {
      output.sendMessage(serialise(event))
    } catch (err) {
      // Never throws (ADR-0007): unwinding here would abandon the timer that
      // was going to send the matching note-off.
      if (!this.warned) {
        this.warned = true
        console.warn(`RtMidiSink: the output refused a message: ${(err as Error).message}`)
      }
    }
  }
}
