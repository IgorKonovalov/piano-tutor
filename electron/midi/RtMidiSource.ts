import { Input } from '@julusian/midi'
import type { MidiPort } from '../../shared/midi'
import type { MidiSource } from './MidiSource'
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
 */
export class RtMidiSource implements MidiSource {
  private openPortIndex: number | null = null
  private probe: Input | null = null

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

  async open(_portId: string): Promise<void> {
    throw new Error('RtMidiSource cannot open a port yet')
  }

  async close(): Promise<void> {
    this.openPortIndex = null
    this.probe?.destroy()
    this.probe = null
  }

  onMessage(_cb: (bytes: Uint8Array, t: number) => void): () => void {
    throw new Error('RtMidiSource does not deliver messages yet')
  }
}
