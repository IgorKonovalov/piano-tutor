import type { MidiEvent } from '../../shared/midi'
import { toBytes } from './parse'

/**
 * The outbound half of the wire (ADR-0007): a typed event back into the bytes
 * an instrument expects.
 *
 * The implementation is the parser's own inverse rather than a second table of
 * status bytes, and that is the point. A schedule serialised by one table and
 * read back by another is a pair that can drift apart one status byte at a
 * time; sharing the function makes `parse(serialise(event))` true by
 * construction, and `serialise.test.ts` asserts it over every kind of event
 * this app can send.
 *
 * It exists as its own module so the sink imports the direction it means. A
 * `send` path reaching into the parser reads as a mistake even when it is not.
 */
export function serialise(event: MidiEvent): number[] {
  return toBytes(event)
}
