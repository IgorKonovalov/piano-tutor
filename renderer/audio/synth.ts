import { CC_SUSTAIN, type MidiEvent, PEDAL_DOWN_THRESHOLD } from '../../shared/midi'

/**
 * The bounded exception of ADR-0008: the app may sound what **it** plays, and
 * only that, when no instrument is doing it.
 *
 * It is a reference pitch, not an instrument, and the bounds are the decision
 * as much as the tone is. **No samples, no audio files, no network request** —
 * every sound here is oscillators, so nothing ships, nothing is licensed, and
 * NFR 3's CSP has nothing to refuse. A note the player presses is never
 * sounded: the instrument in front of them is already making that sound and
 * doubling it would be both pointless and late.
 *
 * It will sound cheap. That is the consequence being paid for, and the reason
 * a plan that wants a real piano voice writes a new ADR rather than adding a
 * sample set here.
 */

/** Where the app's own playing is heard. One choice, three positions. */
export type SoundTarget = 'instrument' | 'computer' | 'silent'

export const SOUND_TARGET_LABELS: Record<SoundTarget, string> = {
  instrument: 'The instrument',
  computer: 'This computer',
  silent: 'Nothing',
}

export const SOUND_TARGETS: readonly SoundTarget[] = ['instrument', 'computer', 'silent']

/** Loud enough to hear over a room, quiet enough that a chord does not clip. */
const MASTER_GAIN = 0.22

/** Two oscillators a few cents apart is what stops a pure tone sounding dead. */
const DETUNE_CENTS = 7

/**
 * A hammer strike is immediate. Anything slower reads as a swell, and anything
 * faster than about a millisecond is a click rather than an attack.
 */
const ATTACK_S = 0.004

/** Where the decay is aiming. Never zero: an exponential ramp cannot reach it. */
const SILENCE = 0.0005

/** A key released still takes a moment to stop, as a damper does. */
const RELEASE_S = 0.12

/** The lowest and highest notes an 88-key instrument has. */
const LOWEST_NOTE = 21
const HIGHEST_NOTE = 108

interface Voice {
  oscillators: OscillatorNode[]
  gain: GainNode
  filter: BiquadFilterNode
}

export function frequencyOf(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

/**
 * How long a struck note takes to fade. Low strings ring and high ones do not,
 * which is most of what makes a decay sound like a keyboard rather than an
 * organ with the power cut.
 */
export function decaySeconds(note: number): number {
  const height = Math.min(1, Math.max(0, (note - LOWEST_NOTE) / (HIGHEST_NOTE - LOWEST_NOTE)))
  return 0.7 + 3.6 * (1 - height)
}

/** Struck harder is louder and brighter, which is one gesture, not two. */
export function peakGainOf(velocity: number): number {
  return Math.pow(Math.min(127, Math.max(0, velocity)) / 127, 1.4)
}

export function cutoffOf(velocity: number): number {
  return 320 + 7200 * Math.pow(Math.min(127, Math.max(0, velocity)) / 127, 1.6)
}

export class Synth {
  private readonly master: GainNode
  private voices = new Map<number, Voice>()
  /** Notes whose key is up but which the sustain pedal is still holding. */
  private sustained = new Set<number>()
  private sustainDown = false
  /** Every oscillator that has been started and not yet stopped. */
  private live = new Set<OscillatorNode>()
  private disposed = false

  constructor(private readonly context: AudioContext) {
    this.master = context.createGain()
    this.master.gain.value = MASTER_GAIN
    this.master.connect(context.destination)
  }

  /** Notes sounding under a key or a pedal. */
  get soundingCount(): number {
    return this.voices.size
  }

  /** Oscillators started and not stopped. Zero is what disposal must leave. */
  get oscillatorCount(): number {
    return this.live.size
  }

  /**
   * The one entry point the player's stream needs. Everything the app plays
   * comes through here; nothing else may.
   */
  feed(event: MidiEvent): void {
    switch (event.kind) {
      case 'noteOn':
        this.noteOn(event.note, event.velocity)
        return
      case 'noteOff':
        this.noteOff(event.note)
        return
      case 'cc':
        if (event.controller === CC_SUSTAIN) {
          this.sustain(event.value >= PEDAL_DOWN_THRESHOLD)
        }
        return
      default:
        return
    }
  }

  noteOn(note: number, velocity: number): void {
    if (this.disposed) return
    // A key struck again while it is still sounding is one note, not two
    // voices fighting over the same pitch.
    this.release(note, 0)
    this.sustained.delete(note)

    const now = this.context.currentTime
    const peak = peakGainOf(velocity) * 1
    if (peak <= 0) return

    const gain = this.context.createGain()
    gain.gain.setValueAtTime(SILENCE, now)
    gain.gain.linearRampToValueAtTime(peak, now + ATTACK_S)
    gain.gain.exponentialRampToValueAtTime(SILENCE, now + ATTACK_S + decaySeconds(note))

    const filter = this.context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(cutoffOf(velocity), now)
    filter.Q.value = 0.8

    const frequency = frequencyOf(note)
    const oscillators = [
      this.oscillator('triangle', frequency, -DETUNE_CENTS, now),
      this.oscillator('sine', frequency, DETUNE_CENTS, now),
    ]

    for (const oscillator of oscillators) oscillator.connect(filter)
    filter.connect(gain)
    gain.connect(this.master)

    this.voices.set(note, { oscillators, gain, filter })
  }

  noteOff(note: number): void {
    if (this.sustainDown && this.voices.has(note)) {
      // The key is up and the pedal is still holding it; the damper has not
      // touched the string.
      this.sustained.add(note)
      return
    }
    this.release(note, RELEASE_S)
  }

  sustain(down: boolean): void {
    this.sustainDown = down
    if (down) return
    for (const note of this.sustained) this.release(note, RELEASE_S)
    this.sustained.clear()
  }

  /** Silence everything, as the player's own stop does on the instrument. */
  releaseAll(): void {
    for (const note of [...this.voices.keys()]) this.release(note, RELEASE_S)
    this.sustained.clear()
    this.sustainDown = false
  }

  /**
   * Everything this voice created, gone: every oscillator stopped and
   * disconnected, and the audio device closed. ADR-0008 opens no device while
   * the app is merely listening, so leaving one open past the view that made
   * it would break the same promise a slower way.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    for (const voice of this.voices.values()) {
      voice.gain.disconnect()
      voice.filter.disconnect()
    }
    this.voices.clear()
    this.sustained.clear()

    const now = this.context.currentTime
    for (const oscillator of this.live) {
      oscillator.onended = null
      oscillator.stop(now)
      oscillator.disconnect()
    }
    this.live.clear()

    this.master.disconnect()
    void this.context.close()
  }

  private oscillator(
    type: OscillatorType,
    frequency: number,
    detune: number,
    now: number
  ): OscillatorNode {
    const oscillator = this.context.createOscillator()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, now)
    oscillator.detune.setValueAtTime(detune, now)
    oscillator.onended = () => {
      oscillator.disconnect()
      this.live.delete(oscillator)
    }
    oscillator.start(now)
    this.live.add(oscillator)
    return oscillator
  }

  private release(note: number, over: number): void {
    const voice = this.voices.get(note)
    if (voice === undefined) return
    this.voices.delete(note)
    this.sustained.delete(note)

    const now = this.context.currentTime
    const endsAt = now + over
    voice.gain.gain.cancelScheduledValues(now)
    voice.gain.gain.setValueAtTime(Math.max(SILENCE, voice.gain.gain.value), now)
    if (over > 0) {
      voice.gain.gain.exponentialRampToValueAtTime(SILENCE, endsAt)
    }
    for (const oscillator of voice.oscillators) oscillator.stop(endsAt)
  }
}
