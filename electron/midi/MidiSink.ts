import type { MidiEvent, MidiPort } from '../../shared/midi'

/**
 * The mirror of `MidiSource` (ADR-0007): where the app's own playing goes out.
 * Two implementations, `RtMidiSink` over `@julusian/midi`'s `Output` and
 * `NullSink` for the ordinary case of a player who is watching rather than
 * listening. A DIN interface or a Bluetooth adapter would be a third, with
 * nothing above this line changing.
 *
 * Output port ids are `out:<index>`, RtMidi's own index, and listing follows
 * ADR-0006 exactly as the input side does: no handle is opened, so enumerating
 * is free and `busy` is a memory of a refused open rather than a prediction.
 */
export interface MidiSink {
  listPorts(): Promise<MidiPort[]>
  open(portId: string): Promise<void>
  close(): Promise<void>

  /**
   * On the hot path, so synchronous. **It never throws.** A throw here unwinds
   * the timer that was going to send the matching note-off, which is how a
   * chord gets left ringing on somebody's instrument; a write that fails is
   * reported and swallowed instead.
   */
  send(event: MidiEvent): void

  /**
   * Silence everything this sink has sounded, whatever the schedule was going
   * to do next. Called on stop, on an output change, on window close, on app
   * quit and from the tick's own error handler. Like `send`, it never throws.
   */
  release(): void
}
