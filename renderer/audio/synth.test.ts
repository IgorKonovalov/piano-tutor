import { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CC_SUSTAIN, type MidiEvent, type MidiPort } from '../../shared/midi'
import { usePlayer } from '../hooks/usePlayer'
import { Synth, cutoffOf, decaySeconds, frequencyOf, peakGainOf } from './synth'

/**
 * Web Audio, faked. `jsdom` has no `AudioContext`, and the claims worth
 * asserting here are all about calls rather than about sound: that a note
 * makes two oscillators, that a released one stops, and above all that
 * disposal closes the device and leaves nothing running (ADR-0008 opens no
 * audio device while the app is merely listening, and a context outliving its
 * view breaks that the slow way).
 */
interface FakeAudio {
  context: AudioContext
  created: FakeOscillator[]
  closed: number
}

interface FakeParam {
  value: number
}

interface FakeOscillator {
  type: string
  started: boolean
  stoppedAt: number | null
  disconnected: boolean
  onended: (() => void) | null
  frequency: FakeParam
  detune: FakeParam
}

function createFakeAudio(): FakeAudio {
  const fake: FakeAudio = { context: null as unknown as AudioContext, created: [], closed: 0 }

  const param = () => {
    const p = {
      value: 0,
      setValueAtTime(v: number) {
        p.value = v
        return p
      },
      linearRampToValueAtTime(v: number) {
        p.value = v
        return p
      },
      exponentialRampToValueAtTime(v: number) {
        p.value = v
        return p
      },
      cancelScheduledValues() {
        return p
      },
    }
    return p
  }

  const node = () => ({ connect() {}, disconnect() {} })

  const context = {
    currentTime: 0,
    state: 'running',
    destination: node(),
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param(), Q: param() }),
    createOscillator: () => {
      // The real node exposes AudioParams; the synth only ever schedules on
      // them, so the fake keeps the scheduled value and reads it back.
      const osc: FakeOscillator & {
        connect(): void
        disconnect(): void
        start(): void
        stop(at: number): void
      } = {
        type: 'sine',
        started: false,
        stoppedAt: null,
        disconnected: false,
        onended: null,
        frequency: param(),
        detune: param(),
        connect() {},
        disconnect() {
          osc.disconnected = true
        },
        start() {
          osc.started = true
        },
        stop(at: number) {
          if (osc.stoppedAt !== null) return
          osc.stoppedAt = at
          osc.onended?.()
        },
      }
      fake.created.push(osc)
      return osc
    },
    close: async () => {
      fake.closed++
    },
    resume: async () => {},
  }

  fake.context = context as unknown as AudioContext
  return fake
}

function on(note: number, velocity = 72): MidiEvent {
  return { kind: 'noteOn', t: 0, ch: 0, note, velocity }
}

function off(note: number): MidiEvent {
  return { kind: 'noteOff', t: 0, ch: 0, note, velocity: 0 }
}

function pedal(down: boolean): MidiEvent {
  return { kind: 'cc', t: 0, ch: 0, controller: CC_SUSTAIN, value: down ? 127 : 0 }
}

describe('the voice is a reference pitch, not an instrument', () => {
  it('tunes A4 to 440 and an octave to twice it', () => {
    expect(frequencyOf(69)).toBeCloseTo(440, 6)
    expect(frequencyOf(81)).toBeCloseTo(880, 6)
    expect(frequencyOf(57)).toBeCloseTo(220, 6)
  })

  it('makes two detuned oscillators per note, and no more', () => {
    const fake = createFakeAudio()
    const synth = new Synth(fake.context)
    synth.noteOn(60, 72)

    expect(fake.created).toHaveLength(2)
    expect(fake.created.every((osc) => osc.started)).toBe(true)
    expect(new Set(fake.created.map((osc) => osc.type))).toEqual(new Set(['triangle', 'sine']))
    expect(fake.created[0]?.detune.value).not.toBe(fake.created[1]?.detune.value)
    expect(fake.created[0]?.frequency.value).toBeCloseTo(frequencyOf(60), 6)
    expect(synth.soundingCount).toBe(1)
  })

  it('gets louder and brighter with velocity, together', () => {
    for (let v = 1; v < 127; v++) {
      expect(peakGainOf(v + 1)).toBeGreaterThan(peakGainOf(v))
      expect(cutoffOf(v + 1)).toBeGreaterThan(cutoffOf(v))
    }
    expect(peakGainOf(0)).toBe(0)
    expect(peakGainOf(127)).toBeCloseTo(1, 6)
  })

  it('lets a low note ring longer than a high one', () => {
    expect(decaySeconds(21)).toBeGreaterThan(decaySeconds(60))
    expect(decaySeconds(60)).toBeGreaterThan(decaySeconds(108))
  })
})

describe('a note stops when it is let go', () => {
  it('releases on note-off', () => {
    const fake = createFakeAudio()
    const synth = new Synth(fake.context)
    synth.feed(on(60))
    expect(synth.soundingCount).toBe(1)

    synth.feed(off(60))

    expect(synth.soundingCount).toBe(0)
    expect(synth.oscillatorCount).toBe(0)
    expect(fake.created.every((osc) => osc.stoppedAt !== null)).toBe(true)
  })

  it('keeps one voice when the same key is struck twice', () => {
    const fake = createFakeAudio()
    const synth = new Synth(fake.context)
    synth.feed(on(60))
    synth.feed(on(60))

    expect(synth.soundingCount).toBe(1)
    expect(synth.oscillatorCount).toBe(2)
    expect(fake.created).toHaveLength(4)
  })

  it('holds a released key while the sustain pedal is down, and lets it go after', () => {
    const fake = createFakeAudio()
    const synth = new Synth(fake.context)
    synth.feed(pedal(true))
    synth.feed(on(60))
    synth.feed(off(60))

    expect(synth.soundingCount).toBe(1)

    synth.feed(pedal(false))

    expect(synth.soundingCount).toBe(0)
    expect(synth.oscillatorCount).toBe(0)
  })

  it('silences everything on releaseAll, pedal or no pedal', () => {
    const fake = createFakeAudio()
    const synth = new Synth(fake.context)
    synth.feed(pedal(true))
    for (const note of [60, 64, 67]) synth.feed(on(note))
    for (const note of [60, 64, 67]) synth.feed(off(note))
    expect(synth.soundingCount).toBe(3)

    synth.releaseAll()

    expect(synth.soundingCount).toBe(0)
    expect(synth.oscillatorCount).toBe(0)
  })

  it('ignores everything that is not a note or the sustain pedal', () => {
    const fake = createFakeAudio()
    const synth = new Synth(fake.context)
    synth.feed({ kind: 'cc', t: 0, ch: 0, controller: 7, value: 100 })
    synth.feed({ kind: 'pitchBend', t: 0, ch: 0, value: 100 })
    synth.feed({ kind: 'unknown', t: 0, bytes: [0xf0, 0xf7] })
    expect(fake.created).toHaveLength(0)
  })
})

describe('disposal leaves nothing running', () => {
  it('stops every oscillator and closes the device', () => {
    const fake = createFakeAudio()
    const synth = new Synth(fake.context)
    for (const note of [60, 64, 67]) synth.feed(on(note))
    expect(synth.oscillatorCount).toBe(6)

    synth.dispose()

    expect(synth.oscillatorCount).toBe(0)
    expect(synth.soundingCount).toBe(0)
    expect(fake.created).toHaveLength(6)
    expect(fake.created.every((osc) => osc.stoppedAt !== null)).toBe(true)
    expect(fake.created.every((osc) => osc.disconnected)).toBe(true)
    expect(fake.closed).toBe(1)
  })

  it('is safe to dispose twice, and sounds nothing after', () => {
    const fake = createFakeAudio()
    const synth = new Synth(fake.context)
    synth.feed(on(60))
    synth.dispose()
    synth.dispose()
    synth.feed(on(64))

    expect(fake.closed).toBe(1)
    expect(synth.oscillatorCount).toBe(0)
  })
})

/**
 * The claim the phase's done-when actually makes: **unmounting the view closes
 * the `AudioContext` and leaves no voice running.** It is checked by mounting
 * the hook for real rather than by inspecting the code that wires it, using
 * `react-dom/client` directly -- there is no testing library here and NFR 9
 * says a new dependency is a cost to justify.
 */
describe('the view owns the audio device', () => {
  let listeners: ((event: MidiEvent) => void)[] = []
  let fake: FakeAudio
  // `MidiPort`, not a shape written out here: the hook reads `open` off these
  // rows, and a hand-rolled literal is exactly what let this test agree with
  // the code by coincidence rather than by schema.
  let outputs: MidiPort[] = []

  /** Mount the hook and hand back the stream, the way a view holds it. */
  async function mount(): Promise<{
    read(): ReturnType<typeof usePlayer>
    unmount(): Promise<void>
  }> {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let stream: ReturnType<typeof usePlayer> | null = null

    function Probe() {
      stream = usePlayer({ createAudioContext: () => fake.context })
      return null
    }

    await act(async () => {
      root.render(createElement(Probe))
    })
    // The output list is read on mount; let that settle before anything reads
    // the target it decides.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    return {
      read: () => stream as ReturnType<typeof usePlayer>,
      unmount: async () => {
        await act(async () => {
          root.unmount()
        })
        host.remove()
      },
    }
  }

  beforeEach(() => {
    listeners = []
    outputs = []
    fake = createFakeAudio()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    window.api = {
      player: {
        listOutputs: vi.fn(async () => outputs),
        openOutput: vi.fn(async () => {}),
        closeOutput: vi.fn(async () => {}),
        play: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
        onEvent: (cb: (event: MidiEvent) => void) => {
          listeners.push(cb)
          return () => {
            listeners = listeners.filter((l) => l !== cb)
          }
        },
        onState: () => () => {},
      },
    } as unknown as Window['api']
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens no device until something is played, then closes it on unmount', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    let stream: ReturnType<typeof usePlayer> | null = null
    function Probe() {
      stream = usePlayer({ createAudioContext: () => fake.context })
      return null
    }

    await act(async () => {
      root.render(createElement(Probe))
    })

    // Nothing has been played, so nothing has been opened: ADR-0008 opens no
    // audio device while the app is only listening.
    expect(fake.created).toHaveLength(0)
    expect(fake.closed).toBe(0)

    await act(async () => {
      await stream?.play({ kind: 'scenario', id: 'virtual:c-major-scale' })
    })

    // The events main would push, arriving on the channel the hook listens to.
    await act(async () => {
      for (const listener of listeners) {
        listener(on(60))
        listener(on(64))
      }
      await new Promise((resolve) => setTimeout(resolve, 60))
    })

    expect(fake.created.length).toBeGreaterThan(0)
    expect(fake.closed).toBe(0)

    await act(async () => {
      root.unmount()
    })

    expect(fake.closed).toBe(1)
    expect(fake.created.every((osc) => osc.stoppedAt !== null)).toBe(true)
    host.remove()
  })

  it('defaults to this computer when no output is open, and sounds through it', async () => {
    const view = await mount()
    expect(view.read().outputOpen).toBe(false)
    expect(view.read().soundTarget).toBe('computer')

    await act(async () => {
      await view.read().play({ kind: 'scenario', id: 'virtual:c-major-scale' })
    })
    await act(async () => {
      for (const listener of listeners) listener(on(60))
      await new Promise((resolve) => setTimeout(resolve, 60))
    })

    expect(fake.created.length).toBeGreaterThan(0)
    await view.unmount()
  })

  it('defaults to the instrument when an output is open, and opens no device', async () => {
    outputs = [
      {
        id: 'out:0',
        name: 'CK Series-1',
        kind: 'hardware',
        availability: 'available',
        open: true,
        detail: 'Open',
      },
    ]
    const view = await mount()

    expect(view.read().outputOpen).toBe(true)
    expect(view.read().soundTarget).toBe('instrument')

    await act(async () => {
      await view.read().play({ kind: 'scenario', id: 'virtual:c-major-scale' })
    })
    await act(async () => {
      for (const listener of listeners) listener(on(60))
      await new Promise((resolve) => setTimeout(resolve, 60))
    })

    // The instrument is sounding it; the app falls silent rather than doubling
    // every note a few milliseconds late (ADR-0008).
    expect(fake.created).toHaveLength(0)
    expect(fake.closed).toBe(0)
    await view.unmount()
  })

  it('lets an explicit choice override the default, in both directions', async () => {
    outputs = [
      {
        id: 'out:0',
        name: 'CK Series-1',
        kind: 'hardware',
        availability: 'available',
        open: true,
        detail: 'Open',
      },
    ]
    const view = await mount()
    expect(view.read().soundTarget).toBe('instrument')

    await act(async () => {
      view.read().setSoundTarget('computer')
    })
    expect(view.read().soundTarget).toBe('computer')

    await act(async () => {
      view.read().setSoundTarget('silent')
    })
    expect(view.read().soundTarget).toBe('silent')

    await act(async () => {
      await view.read().play({ kind: 'scenario', id: 'virtual:c-major-scale' })
    })
    await act(async () => {
      for (const listener of listeners) listener(on(60))
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    expect(fake.created).toHaveLength(0)

    await view.unmount()
  })
})
