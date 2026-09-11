# ADR-0007 — Playback is a schedule built in `core/` and clocked by main behind a `MidiSink`

> **Status:** accepted 2026-09-11, on the close of Plan 0004
> **Date:** 2026-09-10
> **Related plan(s):** Plan [0004](../plans/done/0004-the-app-plays-the-piece.md)

## Context

Until now this application only listens. Every seam in it points one way: `MidiSource` delivers
bytes, main stamps and parses them, the renderer draws them, the recorder writes them down. The
user asked for the app to play a piece by itself — a demonstration, not an accompaniment — and
the roadmap has carried the stub for it since the first interview ("MIDI out to demonstrate a
passage through the CK88"). Three things become true at once: the app acquires an output, it
acquires a clock, and it acquires the ability to leave a note sounding on somebody else's
instrument.

**The output is nearly free.** The CK88's USB "TO HOST" port is bidirectional and
class-compliant (measured in Plan 0001 Phase 7: the ports appeared with no Yamaha driver), and
`@julusian/midi`, already pinned at 3.8.1 for the input side, ships an `Output` class beside its
`Input`. Adding the ability to send costs no new dependency and no new native binary, which is
why this is a plan rather than a spike.

**The clock is not free, and it is the whole feature.** A player is a scheduler: something has to
decide that this note-on happens 412 ms from the start and then make it happen at 412 ms. Node's
`setInterval` drifts and Node's `setTimeout` is accurate to a few milliseconds at best. A tick
coarse enough to be cheap is coarse enough to be audible — at 120 bpm a semiquaver is 125 ms, and
a 25 ms scheduling error inside it is a listenable smear. The standard answer, a lookahead
scheduler that ticks coarsely and arms fine timers for everything due in the next window, is well
understood; what it needs from us is a decision about **which process runs it**, because this
application has three and they do not have the same clock, the same lifetime, or the same rules.

**The third thing is the real hazard.** A dropped note-off is not a rendering glitch; it is a note
that keeps sounding on the instrument in the room until the player finds a way to stop it. Any
design where the thing that sent the note-on can die, be throttled, or be garbage-collected before
it sends the matching note-off is a design that will strand a chord on the CK88. This constrains
the choice more than accuracy does.

There is also a shape constraint from ADR-0005. The `ExpectedTimeline` is deliberately tempo-free
— quarter notes, never seconds — because the score obliges the player to no particular speed.
Playback is the first feature that must supply a tempo the score does not carry, and it must
supply dynamics the timeline does not carry either. Whatever computes seconds from quarter notes
is doing a real, testable, deterministic transformation, and it should be somewhere it can be
tested without a device, a window or a clock.

## Decision

Playback is split into a **pure schedule** and a **dumb clock**, and the clock lives in main.

`core/` gains `PlaybackSchedule`: an immutable, ordered list of `{ at, event }` where `at` is
milliseconds from the start of playback, together with the three builders that produce one — from
an `ExpectedTimeline` plus a tempo, from a recorded take, and from a seeded scenario. The builders
are pure functions with fixture tests, and they enforce one invariant that a test asserts on every
schedule: **every note-on is matched by a later note-off, and no schedule ends with anything
sounding.** Computing seconds from quarter notes, choosing a velocity the score does not state,
clipping a bar range, closing the notes a crashed take left open — all of it happens here, where
no device is involved and the answer is the same every run.

Main gains `MidiSink`, the mirror of `MidiSource`: `listPorts`, `open`, `close`, `send`. Two
implementations ship — `RtMidiSink` over `@julusian/midi`'s `Output`, and `NullSink` for when no
output port is selected, which is not an error state but the ordinary case of a player who is
watching rather than listening. Output ports enumerate under `out:<index>` and follow ADR-0006:
listing opens no handle, and `busy` is earned by a failed open rather than predicted.

Main runs the scheduler: a 25 ms tick that arms an individual timer for every event falling in the
next 100 ms, dispatching each one to the sink and pushing it to the renderer on a new `player:*`
domain. The renderer therefore lights the keyboard and the staff with the app's playing exactly as
it lights them with the player's, from a channel it is already shaped to consume — but on a
separate channel from `midi:event`, so that **the recorder never sees playback** and a take can
never contain notes the player did not play.

Main also owns the panic. The sink tracks what it has sounded (`HeldNotes`, already in `core/`) and
releases everything — note-offs for the held set, then All Notes Off and sustain-up on every
channel touched — on stop, on an output change, on window close, on app quit, and inside the tick's
own error handler. This is main's job precisely because main is the process that cannot be
throttled by a hidden window and outlives the renderer at shutdown.

We rejected making the renderer the player, and we rejected running two synchronised clocks.

## Consequences

### Positive

- **The seam is symmetric, and that is worth something.** `MidiSource` has three implementations
  and `MidiSink` starts with two; a DIN interface or a Bluetooth adapter becomes an implementation
  of each rather than a rewrite, exactly as ADR-0001 intended for the input half.
- **The hard part is pure.** Tempo arithmetic, bar-range clipping, note-off closing and the
  stuck-note invariant are all `core/` functions with fixture tests, so the riskiest logic in the
  feature is provable with no piano, no window and no timer (NFR 11).
- **The display comes free, and honestly.** Because dispatched events are pushed to the renderer,
  the keyboard and the staff show what the app is playing with no new drawing code — and because
  they arrive on `player:event` rather than `midi:event`, they can be drawn in a distinct colour
  and can never be recorded as the player's own.
- **No new dependency and no new bytes.** `@julusian/midi` already carries the `Output`; NFR 9's
  pin gate has nothing new to check and NFR 10's install size does not move.
- **One process owns the instrument, still.** ADR-0001's central claim — devices belong to main —
  survives the app gaining an output rather than being quietly amended by it.

### Negative

- **The renderer's copy of the note is late by an IPC hop.** Every dispatched event crosses the
  bridge, so the synth of ADR-0008 and the key highlight inherit a few milliseconds of jitter the
  hardware path does not have. For a fallback voice and a highlight this is inaudible and
  invisible respectively; for anything that ever needs sample-accurate audio it is not, and that
  feature would reopen this ADR.
- **We have written a scheduler, and schedulers are where timing bugs live.** A tick that fires
  late, a timer armed twice, a stop racing an in-flight timer, a schedule mutated mid-play — each
  is a real defect class that did not exist in this codebase yesterday, and the sink is where they
  become audible on somebody's piano.
- **Two output paths can sound the same note.** With a CK88 connected and the fallback voice on,
  the note plays twice with a few milliseconds between them. A mute rule fixes it and the rule is
  one more piece of state to get wrong.
- **`out:<index>` is positional and can go stale**, the same weakness `hw:<index>` already has on
  the input side. Unplugging one device renumbers the rest, so a remembered output selection can
  point at a different instrument. The consequence here is louder than on the input side: an input
  aimed at the wrong device shows nothing, an output aimed at the wrong device plays into it.
- **A schedule is materialised in full before playback starts.** A ten-minute piece is tens of
  thousands of events held in memory and shipped over IPC once. That is fine at the sizes this app
  sees and it is a real ceiling for a feature that ever wants to stream.

### Neutral

- `player:*` becomes the fifth IPC domain, after `midi:*`, `take:*`, `score:*` and `coach:*`.
- The Takes view now has two verbs that both look like "play": replaying a take **into** the app's
  input pipeline (which already exists, for testing the pipeline) and playing it **out** to the
  instrument. They are genuinely different operations and the interface has to say so.

## Alternatives considered

### Alternative A — The renderer is the player

The renderer holds the schedule and drives it from `AudioContext.currentTime`, the most accurate
clock anywhere in the application, sending each due event to main for the hardware output. It is
the least new machinery, it makes the fallback synth sample-accurate for free, and it puts the
schedule next to the `ExpectedTimeline` that the renderer already extracted from OSMD.

Rejected on the stuck note. A renderer is a window: it can be minimised, backgrounded, throttled
by Chromium's timer policy, or torn down before main knows playback was in progress, and every one
of those strands the note-offs of whatever chord was sounding at the time. It also puts one IPC
round trip on every note-on *and* every note-off in the hot path, and it makes the renderer the
thing that drives a device, which is the single boundary ADR-0001 exists to hold.

### Alternative B — Two clocks over one shared schedule

`core/` builds the schedule once; main plays it to the hardware and the renderer plays the same
immutable schedule to Web Audio, both anchored to one epoch-stamped `t0` — the same anchor NFR 1
already relies on to make two processes' clocks comparable. No per-event IPC, and the synth is
sample-accurate.

Rejected as the wrong amount of machinery for what the second path is. The renderer's audio is a
fallback tone (ADR-0008), not an instrument, and paying for it with two free-running clocks that
drift apart over a ten-minute piece — plus the re-anchoring tick that corrects them, plus a
synchronisation test that will flake — buys accuracy nothing in this feature needs. It is the
right design the day the app's own voice matters as much as the CK88's, and that day is not this
plan.

### Alternative C — Let the schedule stay implicit and just walk the timeline with `setTimeout`

Arm one timer per note at play time straight from the `ExpectedTimeline`, with no intermediate
type. Rejected because it makes the interesting logic untestable: there is no value to assert
against, so the tempo arithmetic, the bar clipping and above all the note-off completeness would
only ever be checked by listening. The `PlaybackSchedule` exists so that "no note is left
sounding" is a property of a data structure rather than a hope about a timer.

## Notes

This ADR adds NFR 13 (playback onset accuracy) to [nfr.md](../nfr.md), in the "reported, not
asserted" half of that table: the milliseconds are a measurement of the development machine and go
into the plan's implementation log, while the property a test does assert is that a schedule
arrives at the sink complete, in order, and with nothing left sounding.

The byte serialiser this needs is the inverse of `electron/midi/parse.ts`, and the two get a
round-trip test — `parse(serialise(event))` reproduces the event — which is worth more than either
direction tested alone.

Whether the CK88 sounds notes received on MIDI channel 1 specifically, or on any channel, is not
known and is not knowable from the documentation this project has. Plan 0004's `human` phase
measures it; if the instrument is selective, the transport gains a channel selector and this ADR
is unaffected.

## Outcome, 2026-09-11

Accepted on the close of Plan [0004](../plans/done/0004-the-app-plays-the-piece.md), measured at
the CK88 rather than argued.

**The split held and the numbers were not close.** NFR 13's onset error over 1286 note-ons at the
instrument came out p50 -0.3 ms, p95 0.6 ms, max 1.4 ms against a target of 10 ms at p95 and 25 ms
at max. Windows' 15.6 ms timer granularity — the hazard this ADR named as the reason a coarse tick
would not do — never appeared. One run in the session did produce a 1.4 to 80.7 ms outlier once,
unexplained; it is in the plan's `### Measurements`.

**The panic held on all four interruptions**, including the one no software can fix: the USB cable
pulled mid-chord left the instrument silent. That is the property this ADR exists for.

**Two things the body does not say, learned by building it.**

- **`MidiSink.send` returns nothing, and on Windows it cannot tell that it failed.** RtMidi's C++
  layer prints `MidiOutWinMM::sendMessage: error sending MIDI message.` to stderr and **returns**,
  so a send into a dead port never becomes a JavaScript exception. `RtMidiSink.write` has a
  `try`/`catch` with a one-shot warning that therefore never fires, and the sink goes on believing
  it is open after the device has gone. This is not a bug in the split; it is a gap in the seam's
  shape, and **whether `send` should be able to report failure at all is a question for a
  successor to this ADR.** The observed consequence — an unplug is survived, a replug is not
  recovered from — is in [`../backlog.md`](../backlog.md).
- **The CK88 sounds notes on channel 1.** The open question in `## Notes` is closed: the
  instrument is not selective, and no channel selector is owed.
