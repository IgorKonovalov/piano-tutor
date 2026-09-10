import { describe, expect, it } from 'vitest'
import { Midi } from '@tonejs/midi'
import type { ExpectedTimeline } from '../../../shared/score'
import {
  DEFAULT_QUANTISE_QUARTERS,
  NO_QUANTISE,
  timelineFromMidi,
} from './timelineFromMidi'

/**
 * The MIDI adapter's arithmetic: quantisation and the bar grid, over files
 * built here in memory.
 *
 * The comparison that matters most -- that this adapter and the OSMD one agree
 * about the same music -- is in `electron/score/midiImport.test.ts`, because it
 * reads a committed `.mid` from disk and `core/` may not touch a filesystem.
 */

const SCORE_ID = 'a'.repeat(32)

describe('quantisation', () => {
  /** A file whose onsets sit a little off the grid, as a played one does. */
  function wonky(offsetsInTicks: readonly number[]): Uint8Array {
    const midi = new Midi()
    midi.header.timeSignatures = [{ ticks: 0, timeSignature: [4, 4] }]
    midi.header.update()
    const track = midi.addTrack()
    const ppq = midi.header.ppq
    offsetsInTicks.forEach((drift, index) => {
      track.addNote({
        midi: 60 + index,
        ticks: index * ppq + drift,
        durationTicks: ppq,
        velocity: 0.6,
      })
    })
    return midi.toArray()
  }

  it('snaps a played onset to the nearest sixteenth by default', () => {
    // 480 ticks to the quarter, so a sixteenth is 120 and anything inside
    // 60 ticks of a beat lands on it.
    const bytes = wonky([0, 37, -29, 53])
    const timeline = timelineFromMidi(bytes, { scoreId: SCORE_ID })
    expect(timeline.notes.map((note) => note.onset)).toEqual([0, 1, 2, 3])
    expect(DEFAULT_QUANTISE_QUARTERS).toBe(0.25)
  })

  it('leaves the onsets alone when quantisation is off', () => {
    const bytes = wonky([0, 240, 0, 0])
    const timeline = timelineFromMidi(bytes, { scoreId: SCORE_ID, quantiseTo: NO_QUANTISE })
    expect(timeline.notes.map((note) => note.onset)).toEqual([0, 1.5, 2, 3])
  })

  it('is coarser on a coarser grid, and says so in the onsets', () => {
    const bytes = wonky([0, 240, 0, 0])
    const timeline = timelineFromMidi(bytes, { scoreId: SCORE_ID, quantiseTo: 1 })
    expect(timeline.notes.map((note) => note.onset)).toEqual([0, 2, 2, 3])
  })

  it('never quantises a struck note out of existence', () => {
    const midi = new Midi()
    const track = midi.addTrack()
    track.addNote({ midi: 60, ticks: 0, durationTicks: 3, velocity: 0.6 })
    const timeline = timelineFromMidi(midi.toArray(), { scoreId: SCORE_ID })
    expect(timeline.notes).toHaveLength(1)
    expect(timeline.notes[0]?.duration).toBeGreaterThan(0)
  })
})

describe('the bar grid', () => {
  function withSignatures(
    signatures: { ticks: number; timeSignature: number[] }[],
    noteTicks: number[]
  ): ExpectedTimeline {
    const midi = new Midi()
    midi.header.timeSignatures = signatures
    midi.header.update()
    const track = midi.addTrack()
    for (const ticks of noteTicks) {
      track.addNote({ midi: 60, ticks, durationTicks: midi.header.ppq, velocity: 0.6 })
    }
    return timelineFromMidi(midi.toArray(), { scoreId: SCORE_ID })
  }

  it('follows a metre change', () => {
    // Two bars of 4/4 (eight quarters), then 3/4.
    const timeline = withSignatures(
      [
        { ticks: 0, timeSignature: [4, 4] },
        { ticks: 480 * 8, timeSignature: [3, 4] },
      ],
      [0, 480 * 4, 480 * 8, 480 * 11]
    )
    expect(timeline.bars.map((bar) => bar.beats)).toEqual([4, 4, 3, 3])
    expect(timeline.bars.map((bar) => bar.onset)).toEqual([0, 4, 8, 11])
  })

  it('reads a compound metre in quarter notes', () => {
    const timeline = withSignatures([{ ticks: 0, timeSignature: [6, 8] }], [0, 480 * 3])
    expect(timeline.bars.map((bar) => bar.beats)).toEqual([3, 3])
  })

  it('assumes four four when the file says nothing, rather than refusing it', () => {
    const timeline = withSignatures([], [0, 480 * 4])
    expect(timeline.bars.map((bar) => bar.beats)).toEqual([4, 4])
  })

  it('is contiguous and covers every note', () => {
    const timeline = withSignatures([{ ticks: 0, timeSignature: [5, 4] }], [0, 480 * 7])
    let onset = 0
    for (const bar of timeline.bars) {
      expect(bar.onset).toBe(onset)
      onset += bar.beats
    }
    for (const note of timeline.notes) {
      const bar = timeline.bars[note.bar]
      expect(bar).toBeDefined()
      expect(note.onset).toBeGreaterThanOrEqual(bar?.onset ?? 0)
    }
  })

  it('gives an empty file one bar rather than none', () => {
    const midi = new Midi()
    midi.addTrack()
    const timeline = timelineFromMidi(midi.toArray(), { scoreId: SCORE_ID })
    expect(timeline.notes).toEqual([])
    expect(timeline.bars).toHaveLength(1)
  })
})
