import { Input } from '@julusian/midi'
import type { MidiPort } from '../../shared/midi'
import { MidiPortUnavailable, type MidiSource } from './MidiSource'
import { type HarnessGate, listVirtualPorts } from './virtualPorts'

/**
 * The CK88 over USB, through RtMidi's Windows Multimedia backend.
 *
 * **Listing does not touch the device** (ADR-0006). `listPorts` reads the
 * driver's port count and names and never opens a handle, so enumerating is
 * free, has no effect on another application reading the same port, and can be
 * polled -- which it has to be, because Windows gives RtMidi no hot-plug
 * callback.
 *
 * `busy` is therefore a memory of a refused open rather than a prediction of
 * one. An open that throws is recorded against that port id and shown on its
 * row; a successful open clears it, and so does the port leaving the
 * enumeration. The row stays clickable, because the record is history and a
 * retry is how the player finds out the other application has let go.
 *
 * The predecessor probed each port with a short open on every poll. It went
 * because it could not replace the open path -- a port can be taken between the
 * poll and the click, so `open` has to handle a refusal anyway -- and because a
 * MIDI input port here is shared rather than exclusive (Plan 0001 Phase 7), so
 * the probe was joining and leaving a stream another application may have been
 * recording, sixty times a minute.
 *
 * Port ids are `hw:<index>`, where the index is RtMidi's own, not Windows'.
 */
const HARDWARE_PORT_ID = /^hw:(\d+)$/

export class RtMidiSource implements MidiSource {
  private openPortIndex: number | null = null
  private enumerator: Input | null = null
  private input: Input | null = null
  private listeners = new Set<(bytes: Uint8Array, t: number) => void>()
  /** Port id -> why its last open failed. The only thing that sets `busy`. */
  private failures = new Map<string, string>()

  constructor(private readonly gate: HarnessGate) {}

  /**
   * One long-lived handle, not one per poll: constructing an `Input` runs
   * RtMidi's WinMM initialisation, which is both work and a line on stderr
   * every time it finds no devices. It is never opened, so holding it costs
   * the device nothing, and `getPortCount` reads the driver live -- which is
   * what lets polling see an unplug at all.
   */
  private getEnumerator(): Input {
    this.enumerator ??= new Input()
    return this.enumerator
  }

  async listPorts(): Promise<MidiPort[]> {
    const enumerator = this.getEnumerator()
    const hardware: MidiPort[] = []
    const count = enumerator.getPortCount()
    for (let index = 0; index < count; index++) {
      hardware.push(this.describeHardwarePort(enumerator, index))
    }
    this.forgetVanishedPorts(hardware)
    return [...hardware, ...listVirtualPorts(this.gate)]
  }

  /**
   * A remembered failure outlives nothing. An index that is no longer
   * enumerated may be a different instrument by the time it comes back, so the
   * record is dropped with the port rather than left to attach itself to
   * whatever takes the id next.
   */
  private forgetVanishedPorts(hardware: readonly MidiPort[]): void {
    const present = new Set(hardware.map((port) => port.id))
    for (const id of this.failures.keys()) {
      if (!present.has(id)) this.failures.delete(id)
    }
  }

  private describeHardwarePort(enumerator: Input, index: number): MidiPort {
    const id = `hw:${index}`
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
    const match = HARDWARE_PORT_ID.exec(portId)
    if (match === null) throw new MidiPortUnavailable(portId, `${portId} is not a hardware port`)
    const index = Number(match[1])

    await this.close()
    const input = new Input()
    // Clock and active sensing arrive continuously from some instruments and
    // carry nothing any view reads; dropping them at the source keeps the take
    // file and the event log about what was played. Sysex is let through so it
    // lands as a typed `unknown` rather than vanishing.
    input.ignoreTypes(false, true, true)

    input.on('message', (_deltaTime, message) => {
      // Stamped first, before anything parses it: NFR 1 measures everything
      // the app adds from this instant on.
      const t = performance.timeOrigin + performance.now()
      const bytes = Uint8Array.from(message)
      for (const listener of this.listeners) listener(bytes, t)
    })

    try {
      input.openPort(index)
    } catch (err) {
      input.destroy()
      const reason = (err as Error).message
      // The row can say so from here on (ADR-0006). This is the only thing
      // that sets `busy`, which is what makes the label a fact rather than a
      // prediction that was already two seconds old when it was drawn.
      this.failures.set(portId, `The last open failed: ${reason}`)
      throw new MidiPortUnavailable(
        portId,
        `Windows would not open this port: ${reason}. ` +
          'The instrument may have been unplugged, or another application may be holding it. ' +
          'Not every application shares a port; closing the other one and reopening is the fix.'
      )
    }

    this.failures.delete(portId)
    this.input = input
    this.openPortIndex = index
  }

  async close(): Promise<void> {
    if (this.input !== null) {
      this.input.closePort()
      this.input.destroy()
      this.input = null
    }
    this.openPortIndex = null
    // The enumerator is not destroyed here. It holds no port open, so it costs
    // the device nothing, and rebuilding it on the next poll would re-run
    // WinMM initialisation for no gain. Only the opened input is released.
  }

  onMessage(cb: (bytes: Uint8Array, t: number) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }
}
