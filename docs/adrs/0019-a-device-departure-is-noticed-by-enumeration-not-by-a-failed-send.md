# ADR-0019 — A device departure is noticed by enumeration, not by a failed send

> **Status:** proposed
> **Date:** 2026-09-11
> **Related plan(s):** Plan [0011](../plans/0011-the-instrument-can-leave.md)

## Context

ADR-0007 gave the application an output: `MidiSink` with `listPorts`, `open`, `close` and `send`,
and a lookahead clock in main that dispatches a schedule into it. `send` returns `void`. That was
not carelessness — the sink was deliberately made **incapable of throwing**, because a throw on the
send line strands a note on somebody's instrument, and `RtMidiSink.write` wraps `sendMessage` in a
`try`/`catch` with a one-shot warning flag for exactly that reason.

Plan 0004's Phase 7 measured what happens when the instrument leaves, and it found the guard is
decorative. Pulling the USB cable mid-chord leaves **no stuck note**, which is the property that
phase existed to check and it held. What fails is everything after: playback does not resume, and
main's console floods with `MidiOutWinMM::sendMessage: error sending MIDI message.` — **one line
per event**. The one-shot flag never fires.

**The cause is the platform, and it is not fixable at this seam.** RtMidi's C++ layer prints that
line to stderr and **returns**. The failure never crosses into JavaScript as an exception, and
`sendMessage` has no return value to inspect. Inside the process, a send into a dead port is
**indistinguishable from a successful one**. So the sink goes on believing it is open: `this.output`
stays non-null, `openPortIndex` stays set, and nothing in main learns the device left. On a replug
Windows may hand out a different index, leaving the old handle dead for good.

This is where ADR-0007 left an explicit open question — whether `MidiSink.send` should be able to
report failure at all — and the measurement answers it rather than the design taste does.

Two facts make the answer cheap. **Listing costs nothing** (ADR-0006: enumerating ports opens no
handle, and `busy` is earned by a failed open rather than predicted), so asking "is my port still
there" is free to ask as often as we like. And **the poll already exists**: `usePlayer` lists
outputs every two seconds to decide whether an instrument is listening, which is how ADR-0008's
anti-doubling default knows what to default to. The signal is already being fetched; nothing is
acting on its disappearance.

## Decision

**`MidiSink.send` stays fire-and-forget, and a device departure is detected by enumeration in
main.** The seam does not gain a return value, because on this platform any status it returned
would be a lie — and a seam that reports success it cannot verify is worse than one that reports
nothing.

Main owns the noticing, as it owns every other device question. While a schedule is running, main
checks the open output port against the enumeration; a port that has stopped being enumerated is
gone. On that, main does what it already does on every other interruption: **release, stop, close
the sink** — the ADR-0007 panic path, unchanged — and then pushes the reason to the renderer on
the existing `player:state` channel, which grows a field for it. The renderer renders the message
and offers the port list; it decides nothing.

The app **notices and says so**. It does not silently reopen and it does not resume a schedule
mid-piece: a piece restarting three seconds later in the middle of a phrase is a worse experience
than being told the cable came out. Reopening a port matched **by name** rather than by index is
the natural next step and is left as a followup, not because it is hard but because the notice is
what removes the broken-feeling failure and the reopen only removes a click.

We rejected giving `send` a status, we rejected detecting from the renderer's poll, and we
rejected having the sink check itself before each send.

## Consequences

### Positive

- **The error flood ends**, and it ends for the right reason: playback stops the moment the device
  is gone rather than continuing to dispatch into a dead handle for the rest of the schedule.
- **The panic path is reused, not duplicated.** A departure becomes one more entry in the list
  ADR-0007 already enumerates — stop, output change, second play, window close, app quit, a throw
  in the tick — with the same release-then-All-Notes-Off behaviour and the same tests shape.
- **The device question stays in main.** The renderer is told what happened; it never has to infer
  a hardware fact from a list it polled for another purpose.
- **It works while the window is hidden or closing**, which a renderer-side detector does not.
- **Name-matched reopen has an obvious home** once it is wanted: the place that already knows the
  port went away is the place that recognises it coming back.

### Negative

- **Detection is polled, so it is late by up to the poll interval.** Some events still go into a
  dead port before the check fires. Nothing is audible — the device is gone — but the console
  still gets a burst of RtMidi's stderr lines, shorter than today's flood rather than absent. The
  only way to make it immediate is a signal the platform does not give us.
- **`player:state` grows a field**, and every consumer of that payload has to be read when it does.
  It is the fourth thing that channel carries and the first that is an error rather than a
  position.
- **We are encoding a platform limitation into a seam's shape.** If a future `MidiSink` over a
  transport that *can* report failure arrives — a network sink, a different native binding — it
  will have a real status to give and no way to give it, and this ADR will want superseding rather
  than extending.
- **A port that disappears and returns within one poll interval is missed entirely**, and the
  handle is dead with nothing having noticed. Rare, real, and left unhandled on purpose.

### Neutral

- The check can ride main's existing scheduler tick or its own timer; that is an implementation
  choice the plan makes, not a decision this ADR fixes.
- Nothing changes when no schedule is running. A device that leaves while the app is idle is
  noticed the next time the port list is drawn, which is already true today.

## Alternatives considered

### Alternative A — `MidiSink.send` returns a status

The truest-sounding fix: the seam stops lying, `send` returns ok-or-failed, and the Player panics
after a threshold of failures.

Rejected because **the platform gives no signal to return**. RtMidi prints to stderr and returns
`void`; there is nothing for `send` to inspect and nothing to propagate. Implementing this would
mean detecting the departure by some other means anyway — the enumeration — and then laundering
that knowledge through a return value, which is more machinery for the same information and a
seam that now claims a capability it does not have.

### Alternative B — the renderer's existing poll detects it

`usePlayer` already lists outputs every two seconds. Notice that the chosen port stopped being
enumerated, call `player.stop()`, show the message. No main change, no new channel, no new field:
by some distance the smallest diff.

Rejected because it puts a hardware decision in the process that is not allowed to touch hardware,
and because it stops working precisely when it is most needed — a hidden, throttled or closing
window notices nothing, and window-close is when the shutdown path and the departure are most
likely to coincide. It also leaves main believing its sink is open, so the next `play` dispatches
into the dead handle again.

### Alternative C — the sink refuses to send into a port that is gone

`RtMidiSink` re-checks the enumeration before dispatching and refuses, reporting upward so the
Player panics.

Rejected because it puts enumeration on the hot path. ADR-0006 makes listing free to *ask*, not
free to ask forty times a second between two note-ons, and NFR 13's onset error is measured in
tenths of a millisecond at p50 — a native enumeration call per event is the one thing in this
design that could plausibly move that figure. It also gives the sink policy, when the sink's whole
value in ADR-0007 is that it is the dumbest object in the chain.

## Notes

The exact stderr line, so a future reader can search for it:
`MidiOutWinMM::sendMessage: error sending MIDI message.`

`RtMidiSink.write`'s existing `try`/`catch` and `warned` flag are not removed by this decision.
They remain correct for a failure mode that *does* throw — a closed handle used after `close`, for
instance — and they cost nothing. They are simply not the thing that catches an unplugged cable,
and the comment beside them should say so.

Plan 0004's Phase 7 item 5 recorded the four interruptions that leave no stuck note, the cable pull
included. That property is not at risk here and is not re-litigated: this ADR is about what happens
in the seconds *after* the silence.
