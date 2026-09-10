import { describe, expect, it } from 'vitest'
import {
  type HeldNotes,
  emptyHeldNotes,
  reduceAll,
  reduceHeldNotes,
  soundingPitches,
} from './HeldNotes'
import { CC_SOFT, CC_SOSTENUTO, CC_SUSTAIN, type MidiEvent } from '../../../shared/midi'
import { findScenarioById } from './generate'

let clock = 0
const on = (note: number, velocity = 80, ch = 0): MidiEvent => ({
  kind: 'noteOn',
  t: clock++,
  ch,
  note,
  velocity,
})
const off = (note: number, ch = 0): MidiEvent => ({
  kind: 'noteOff',
  t: clock++,
  ch,
  note,
  velocity: 0,
})
const cc = (controller: number, value: number): MidiEvent => ({
  kind: 'cc',
  t: clock++,
  ch: 0,
  controller,
  value,
})

const play = (...events: MidiEvent[]): HeldNotes => reduceAll(emptyHeldNotes, events)

describe('keys', () => {
  it('starts with nothing sounding', () => {
    expect(soundingPitches(emptyHeldNotes)).toEqual([])
  })

  it('holds a note between its on and its off', () => {
    expect(soundingPitches(play(on(60)))).toEqual([60])
    expect(soundingPitches(play(on(60), off(60)))).toEqual([])
  })

  it('reports a chord in pitch order however it was struck', () => {
    expect(soundingPitches(play(on(67), on(60), on(64)))).toEqual([60, 64, 67])
  })

  it('keeps the velocity and the channel of each key', () => {
    const state = play(on(60, 120, 2))
    expect(state.down.get(60)).toMatchObject({ velocity: 120, ch: 2 })
  })

  it('ignores a note-off for a key that is not down', () => {
    expect(play(off(60))).toBe(emptyHeldNotes)
  })

  it('is unmoved by program change, pitch bend and unknown bytes', () => {
    const base = play(on(60))
    const after = reduceAll(base, [
      { kind: 'programChange', t: 1, ch: 0, program: 4 },
      { kind: 'pitchBend', t: 2, ch: 0, value: -2000 },
      { kind: 'unknown', t: 3, bytes: [0xf6] },
    ])
    expect(soundingPitches(after)).toEqual([60])
  })
})

describe('the sustain pedal', () => {
  it('keeps a released note sounding until the pedal lifts', () => {
    const pressed = play(on(60), cc(CC_SUSTAIN, 127), off(60))
    expect(soundingPitches(pressed)).toEqual([60])
    expect(pressed.down.size).toBe(0)
    expect(pressed.pedalled.get(60)?.pedalled).toBe(true)

    const lifted = reduceHeldNotes(pressed, cc(CC_SUSTAIN, 0))
    expect(soundingPitches(lifted)).toEqual([])
  })

  it('is down at 64 and up below it', () => {
    expect(play(on(60), cc(CC_SUSTAIN, 64), off(60)).pedalled.size).toBe(1)
    expect(play(on(60), cc(CC_SUSTAIN, 63), off(60)).pedalled.size).toBe(0)
  })

  it('catches a note released after the pedal went down, not one already up', () => {
    const state = play(on(60), off(60), cc(CC_SUSTAIN, 127))
    expect(soundingPitches(state)).toEqual([])
  })

  it('takes a retriggered note back under the key', () => {
    const state = play(on(60), cc(CC_SUSTAIN, 127), off(60), on(60, 100))
    expect(state.pedalled.size).toBe(0)
    expect(state.down.get(60)?.velocity).toBe(100)
  })

  it('holds a whole chord through the release, and drops it all at once', () => {
    const held = play(on(60), on(64), on(67), cc(CC_SUSTAIN, 127), off(60), off(64), off(67))
    expect(soundingPitches(held)).toEqual([60, 64, 67])
    expect(soundingPitches(reduceHeldNotes(held, cc(CC_SUSTAIN, 0)))).toEqual([])
  })
})

describe('the sostenuto pedal', () => {
  it('holds only what was down when it went down', () => {
    const state = play(on(60), cc(CC_SOSTENUTO, 127), on(72), off(60), off(72))
    expect(soundingPitches(state)).toEqual([60])
  })

  it('releases its captured notes when it lifts', () => {
    const state = play(on(60), cc(CC_SOSTENUTO, 127), off(60))
    expect(soundingPitches(reduceHeldNotes(state, cc(CC_SOSTENUTO, 0)))).toEqual([])
  })

  it('keeps a note sustain also holds until both pedals are up', () => {
    const both = play(on(60), cc(CC_SOSTENUTO, 127), cc(CC_SUSTAIN, 127), off(60))
    expect(soundingPitches(reduceHeldNotes(both, cc(CC_SUSTAIN, 0)))).toEqual([60])
    expect(
      soundingPitches(
        reduceAll(both, [cc(CC_SUSTAIN, 0), cc(CC_SOSTENUTO, 0)])
      )
    ).toEqual([])
  })
})

describe('the soft pedal', () => {
  it('records its value and holds nothing', () => {
    const state = play(on(60), cc(CC_SOFT, 90), off(60))
    expect(state.soft).toBe(90)
    expect(soundingPitches(state)).toEqual([])
  })
})

describe('over a generated scenario', () => {
  it('ends with nothing sounding after virtual:ii-V-I-in-F', () => {
    const events = findScenarioById('virtual:ii-V-I-in-F')!.generate()
    expect(soundingPitches(reduceAll(emptyHeldNotes, events))).toEqual([])
  })

  it('holds the first chord after its keys are up but before the pedal lifts', () => {
    const events = findScenarioById('virtual:ii-V-I-in-F')!.generate()
    const firstPedalUp = events.find((e) => e.kind === 'cc' && e.value === 0)!
    const beforeLift = events.filter((e) => e.t < firstPedalUp.t)
    expect(soundingPitches(reduceAll(emptyHeldNotes, beforeLift))).toEqual([55, 58, 62, 65])
  })

  it('ends with nothing sounding after virtual:dense-2000', () => {
    const events = findScenarioById('virtual:dense-2000')!.generate()
    expect(soundingPitches(reduceAll(emptyHeldNotes, events))).toEqual([])
  })
})
