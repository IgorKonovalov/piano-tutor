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

/**
 * The `midi` half of `window.api`, declared where both sides can see it: the
 * preload binding is typed as this, and the renderer's `Window` reads it. A
 * capability added on one side and not the other fails to compile.
 */
export interface MidiApi {
  listPorts(): Promise<MidiPort[]>
}
