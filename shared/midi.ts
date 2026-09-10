import { z } from 'zod'

/**
 * `hardware` is a port Windows reports; `virtual` is a seeded scenario played
 * by the app into its own pipeline (ADR-0004). The kind is carried all the way
 * to a take file's header so a generated take is never read as a played one.
 */
export const MidiPortKindSchema = z.enum(['hardware', 'virtual'])
export type MidiPortKind = z.infer<typeof MidiPortKindSchema>

/**
 * `busy` is the Windows reality that matters: there is no system-wide MIDI
 * sharing, so a DAW holding the port makes it unopenable. It is discovered by
 * a probe open in `listPorts`, not guessed.
 */
export const MidiPortAvailabilitySchema = z.enum(['available', 'busy', 'unknown'])
export type MidiPortAvailability = z.infer<typeof MidiPortAvailabilitySchema>

export const MidiPortSchema = z.object({
  /** `hw:<index>` for a device, `virtual:<scenario>` for a generated one. */
  id: z.string().min(1),
  name: z.string(),
  kind: MidiPortKindSchema,
  availability: MidiPortAvailabilitySchema,
  /** One line for the user when the port is not simply available. */
  detail: z.string().optional(),
})
export type MidiPort = z.infer<typeof MidiPortSchema>

export const MidiPortListSchema = z.array(MidiPortSchema)

export const MidiOpenRequestSchema = z.object({ portId: z.string().min(1) })
export type MidiOpenRequest = z.infer<typeof MidiOpenRequestSchema>

const channel = z.number().int().min(0).max(15)
const data7 = z.number().int().min(0).max(127)

/**
 * What crosses IPC and what lands in a take file. The renderer never sees a
 * raw byte (ADR-0001): main parses once, at arrival.
 *
 * `t` is an epoch-anchored monotonic millisecond taken in main's arrival
 * callback before any parsing -- `performance.timeOrigin + performance.now()`.
 * The epoch anchor is what makes it comparable with a renderer timestamp:
 * a bare `performance.now()` from two processes has two different origins and
 * subtracting them measures nothing. In a take file `t` is relative to the
 * header's start instead.
 */
export const MidiEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('noteOn'),
    t: z.number(),
    ch: channel,
    note: data7,
    velocity: data7,
  }),
  z.object({
    kind: z.literal('noteOff'),
    t: z.number(),
    ch: channel,
    note: data7,
    velocity: data7,
  }),
  z.object({
    kind: z.literal('cc'),
    t: z.number(),
    ch: channel,
    controller: data7,
    value: data7,
  }),
  z.object({
    kind: z.literal('programChange'),
    t: z.number(),
    ch: channel,
    program: data7,
  }),
  z.object({
    kind: z.literal('pitchBend'),
    t: z.number(),
    ch: channel,
    /** Signed, -8192 to 8191; 0 is centre. */
    value: z.number().int().min(-8192).max(8191),
  }),
  z.object({
    kind: z.literal('unknown'),
    t: z.number(),
    bytes: z.array(z.number().int().min(0).max(255)),
  }),
])
export type MidiEvent = z.infer<typeof MidiEventSchema>

/** The pedals the CK88 sends, by controller number. */
export const CC_SUSTAIN = 64
export const CC_SOSTENUTO = 66
export const CC_SOFT = 67

/** A pedal is down at 64 and up below it -- the MIDI convention for a switch. */
export const PEDAL_DOWN_THRESHOLD = 64

/**
 * The `midi` half of `window.api`, declared where both sides can see it: the
 * preload binding is typed as this, and the renderer's `Window` reads it. A
 * capability added on one side and not the other fails to compile.
 */
export interface MidiApi {
  listPorts(): Promise<MidiPort[]>
  open(portId: string): Promise<void>
  close(): Promise<void>
  /** Returns the cleanup that removes the listener. Always call it. */
  onEvent(cb: (event: MidiEvent) => void): () => void
}
