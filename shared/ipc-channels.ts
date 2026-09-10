/**
 * The only place an IPC channel string is written. A new channel is a design
 * decision (ADR-0001), not a casual addition: the roster of domains is
 * `midi:*`, `take:*` and `coach:*`.
 */
export const IPC_CHANNELS = {
  /** invoke R->M: () -> MidiPort[] */
  MIDI_LIST_PORTS: 'midi:list-ports',
  /** invoke R->M: { portId } -> void */
  MIDI_OPEN: 'midi:open',
  /** invoke R->M: () -> void */
  MIDI_CLOSE: 'midi:close',
  /** push M->R: one MidiEvent */
  MIDI_EVENT: 'midi:event',

  /** invoke R->M: () -> TakeSummaryRow[] */
  TAKE_LIST: 'take:list',
  /** invoke R->M: { id } -> TakeContent */
  TAKE_LOAD: 'take:load',
  /** invoke R->M: { id, speed } -> void */
  TAKE_REPLAY: 'take:replay',
  /** invoke R->M: () -> void */
  TAKE_STOP_REPLAY: 'take:stop-replay',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
