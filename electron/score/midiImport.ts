import { Midi } from '@tonejs/midi'
import { MIDI_EXTENSIONS, type ScoreExtension } from '../../shared/score'

/**
 * The library's side of a MIDI file (ADR-0003: MIDI is second-class input).
 *
 * Main stores bytes and does not read music out of them -- turning a file into
 * an `ExpectedTimeline` is `core/src/score/timelineFromMidi.ts`, and it stays
 * there because it is arithmetic over ticks that anything can do. What main
 * does here is refuse a file that is not a MIDI file at all, at the moment the
 * player chooses it, so the failure lands on the dialog they just used rather
 * than on a blank score five clicks later.
 */

export function isMidiExtension(extension: ScoreExtension): boolean {
  return (MIDI_EXTENSIONS as readonly string[]).includes(extension)
}

export class NotAMidiFile extends Error {
  constructor(filename: string, cause: string) {
    super(`${filename} is not a MIDI file this app can read: ${cause}`)
    this.name = 'NotAMidiFile'
  }
}

/**
 * Parses far enough to know the file is real. A MIDI file with no notes in it
 * is rejected too: it imports cleanly and then has nothing to practise, which
 * reads as the app being broken rather than the file being empty.
 */
export function assertReadableMidi(bytes: Uint8Array, filename: string): void {
  let midi: Midi
  try {
    midi = new Midi(bytes)
  } catch (err) {
    throw new NotAMidiFile(filename, (err as Error).message)
  }

  const notes = midi.tracks.reduce((total, track) => total + track.notes.length, 0)
  if (notes === 0) throw new NotAMidiFile(filename, 'it contains no notes')
}

/** How many notes and tracks a file holds, for the library row. */
export function describeMidi(bytes: Uint8Array): { notes: number; tracks: number } {
  const midi = new Midi(bytes)
  return {
    notes: midi.tracks.reduce((total, track) => total + track.notes.length, 0),
    tracks: midi.tracks.filter((track) => track.notes.length > 0).length,
  }
}
