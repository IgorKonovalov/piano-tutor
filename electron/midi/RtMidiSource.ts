import { Input } from '@julusian/midi'
import type { MidiPort } from '../../shared/midi'
import { MidiPortUnavailable, type MidiSource } from './MidiSource'
import { type HarnessGate, listVirtualPorts } from './virtualPorts'

/**
 * The CK88 over USB, through RtMidi's Windows Multimedia backend.
 *
 * Two Windows realities shape this file. There is no hot-plug callback, so the
 * caller polls `listPorts`. And there is no system-wide MIDI sharing: a port
 * another application holds cannot be opened, which is only discoverable by
 * trying, so `listPorts` probes each device with a short open and reports the
 * failure as `busy` rather than letting the user find out on click.
 *
 * The probe is skipped while this source holds a port open: reopening a handle
 * underneath a live input is the one thing polling could plausibly disturb.
 *
 * Port ids are `hw:<index>`, where the index is RtMidi's own, not Windows'.
 */
const HARDWARE_PORT_ID = /^hw:(\d+)$/

export class RtMidiSource implements MidiSource {
  private openPortIndex: number | null = null
  private probe: Input | null = null
  private input: Input | null = null
  private listeners = new Set<(bytes: Uint8Array, t: number) => void>()

  constructor(private readonly gate: HarnessGate) {}

  /**
   * One long-lived handle, not one per poll: constructing an `Input` runs
   * RtMidi's WinMM initialisation, which is both work and a line on stderr
   * every time it finds no devices.
   */
  private getProbe(): Input {
    this.probe ??= new Input()
    return this.probe
  }

  async listPorts(): Promise<MidiPort[]> {
    const probe = this.getProbe()
    const ports: MidiPort[] = []
    const count = probe.getPortCount()
    for (let index = 0; index < count; index++) {
      ports.push(this.describeHardwarePort(probe, index))
    }
    return [...ports, ...listVirtualPorts(this.gate)]
  }

  private describeHardwarePort(probe: Input, index: number): MidiPort {
    const name = probe.getPortName(index)
    const port: MidiPort = {
      id: `hw:${index}`,
      name,
      kind: 'hardware',
      availability: 'unknown',
      detail: 'In use by this app',
    }
    if (this.openPortIndex === index) return { ...port, availability: 'available', detail: 'Open' }
    if (this.openPortIndex !== null) {
      return { ...port, detail: 'Not checked while another port is open' }
    }
    try {
      probe.openPort(index)
      probe.closePort()
      return { ...port, availability: 'available', detail: undefined }
    } catch {
      return {
        ...port,
        availability: 'busy',
        detail: 'Held by another application. Close it and the port reappears.',
      }
    }
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
      throw new MidiPortUnavailable(
        portId,
        `Windows would not open this port: ${(err as Error).message}. ` +
          'There is no system-wide MIDI sharing, so another application may be holding it.'
      )
    }

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
    this.probe?.destroy()
    this.probe = null
  }

  onMessage(cb: (bytes: Uint8Array, t: number) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }
}
