/**
 * The only place an IPC channel string is written. A new channel is a design
 * decision (ADR-0001), not a casual addition: the roster of domains is
 * `midi:*`, `take:*`, `score:*` (ADR-0005) and `coach:*`.
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

  /** invoke R->M: () -> ScoreImportResult; opens the native file dialog */
  SCORE_IMPORT: 'score:import',
  /** invoke R->M: () -> ScoreMeta[] */
  SCORE_LIST: 'score:list',
  /** invoke R->M: { id } -> ScoreContent */
  SCORE_READ: 'score:read',
  /** invoke R->M: { id, title } -> ScoreMeta */
  SCORE_SET_TITLE: 'score:set-title',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
