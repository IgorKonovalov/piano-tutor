# ADR-0012 — The metronome is a grid both processes schedule from, and the timing reference whenever it runs

> **Status:** proposed
> **Date:** 2026-09-10
> **Related plan(s):** Plan [0006](../plans/0006-the-metronome-and-the-score-follows.md)

## Context

The user asked for a metronome on 2026-09-10 after using the app, and Plan 0002's followup fixed
four things about it at the time. Two of those four are decisions with rejected alternatives, and
one of the rejections has since expired.

**The first is that a click breaks ADR-0008's bounds.** That ADR reversed this project's standing
no-audio non-requirement, but narrowly, and the narrowness is the decision: the app sounds "only
what the application itself is playing, from the `player:event` channel of ADR-0007", and "no
audio device is opened while the app is merely listening to the CK88". A metronome violates both
sentences at once. It is not a note the app is playing back, and it sounds precisely while the app
is listening to the player. The bound cannot be quietly stretched — `docs/nfr.md` requires that
section to be "revised by ADR, not in passing", and ADR-0008's own Negative section names this
exact erosion as the risk it accepted ("the rule now has one named exception rather than none, and
exceptions are how that rule erodes").

**The second is that the rejection of a MIDI click has expired.** Plan 0002's followup rejected
sending the click out to the CK88 because that "needs a MIDI-output path, which is its own roadmap
item". ADR-0007 is that item, and it builds a `MidiSink`. The alternative that lost for want of a
mechanism now has the mechanism, so the question is genuinely open rather than settled.

**The third force is timing, and it is the one that shapes the design.** A metronome is not a
reference pitch. ADR-0008 could accept an IPC hop for playback because a tone that tells you which
note is which is allowed to be a few milliseconds loose. A click is the thing the player
synchronises their body to, and under Plan 0002's followup decision it also becomes the datum
timing is scored against — so jitter in the click is jitter in both what the player hears and what
the app then judges them by. Two voices make this worse rather than better: a Web Audio click
scheduled in the renderer and a MIDI click dispatched from main are two clocks in two processes,
and if they are driven by a stream of tick messages they can disagree with each other and with the
app's own playback.

NFR 13 already names the hazard on this machine: Windows' default 15.6 ms timer granularity, "the
known hazard against the target". A design that puts a message on the IPC bus once per beat
inherits that granularity twice.

## Decision

**The metronome is a grid, not a stream of ticks.** Starting a click publishes one immutable
description of the beat — an epoch-anchored start time, a tempo in quarters per minute, a metre —
and each side then schedules its own clicks locally from it: the renderer against the
`AudioContext` clock, main against the same clock that clocks ADR-0007's playback. Nothing is sent
per beat. The grid is a pure `core/` record with pure arithmetic over it (`beatAt`, and the beat
nearest a timestamp), which is the same arithmetic click-relative scoring needs, so the sound and
the judgement are computed from one definition rather than from two that must be kept in step.

Both processes can anchor to one timeline because ADR-0001 already made them comparable:
`performance.timeOrigin + performance.now()` is how a MIDI event is stamped, and NFR 1 calls that
epoch anchor "what makes the two processes' clocks comparable at all".

Two further points, both part of the decision:

- **The click's voice follows the transport's existing sound target.** ADR-0008 already ships one
  control with three positions — the instrument, this computer, silent. A click sounds as a MIDI
  note through the `MidiSink` when a hardware output is open, through Web Audio when none is, and
  not at all when the player chooses silence. This is the bound on ADR-0008 being widened: the app
  may now open an audio device while it is only listening, and only to sound a click it is
  itself generating. ADR-0008's other bounds are untouched — no samples, no audio files, no
  network request, and a note the player presses is still never sounded by the app.
- **Whenever a grid is running, timing is judged against the grid, not against a tempo fitted from
  the take.** This is a second scoring path beside the tempo-free one, not a replacement:
  alignment stays tempo-free when there is no click, which is what every test in
  `core/src/align/` defends today.

## Consequences

### Positive

- **No per-beat IPC**, so the click's stability is bounded by each process's own scheduler rather
  than by the event loop between them, and the bus stays quiet during a practice session.
- **One definition of the beat.** The click the player hears, the bar the score highlights and the
  grid the scoring uses are the same record, so they cannot drift into disagreeing about where
  beat three was.
- **The tempo ladder becomes reachable.** Raising a target by a fixed step is a new grid, which is
  a value, not a mechanism — which is what the backlog means when it says the ladder is where the
  store stops being a log.
- **Follow mode falls out.** A wall-clock cursor over a grid is the thing the backlog's look-ahead
  curtain also needs, and it is the mechanism Plan 0002's prose promised and never built.
- **The honest claim survives.** With an instrument attached the room still hears only the CK88,
  because the click goes out as MIDI.

### Negative

- **A grid is a constant tempo.** A written accelerando, a rallentando, or the ladder stepping
  mid-session cannot be expressed by bending the grid; the grid is replaced instead, and any
  passage that straddles the replacement is scored against one of the two, not across both. A
  piece with real tempo changes gets a click that is simply wrong for part of it.
- **ADR-0008's bound is widened barely a year of decisions after it was set**, which is the exact
  pattern that ADR warned about. The mitigation is that the widening is named and narrow — a click
  the app generates, nothing else — but the precedent now exists and the next request will cite it.
- **Two voices are two implementations of one behaviour.** A defect can live in one and not the
  other, and the end-to-end suite can only observe the MIDI one; the Web Audio click is asserted to
  be scheduled, never heard.
- **Click-relative scoring is a second path through the report**, so every timing assertion in the
  suite now has a grid case and a no-grid case, and a bar can legitimately be `clean` under one and
  `timing` under the other.
- **A player who is consistently and uniformly ahead of the click is now told so**, where the
  tempo-free path called them in time. That is the point, but it is a harsher app, and it is worth
  knowing that the change in verdicts on the same take will look like a regression.

### Neutral

- The transport grows a tempo and a metre control, and the sound-target control gains a second
  thing it governs.
- Whether the click's own accuracy earns its own NFR row is left open. It is measured against
  NFR 13's method and reported into Plan 0006's log; if the measurement misses, the row is revised
  by ADR rather than tuned around, which is what NFR 13 already says about itself.

## Alternatives considered

### Alternative A — Main emits a tick per beat and each side sounds on receipt

The obvious shape: one clock, one authority, a `metronome:tick` on the bus. Rejected on the
mechanism the app is being asked to provide. An IPC hop per beat puts the reference the player
synchronises to at the mercy of the event loop, on a platform whose timer granularity NFR 13
already flags as the known hazard — and it does so at 120-plus messages a minute for the length of
a practice session. A grid costs one message and is exactly as authoritative.

### Alternative B — Web Audio only, the renderer owning the click entirely

One voice, one code path, sample-accurate scheduling, no dependency on an output port being open.
Rejected because it forfeits the click that comes out of the instrument the player is already
listening to — the voice with no audio device, no autoplay gesture and no IPC in it at all — for
want of a `MidiSink` that ADR-0007 now provides. It also leaves the app making a sound the room
hears while an instrument is attached, which is the claim this project has kept true throughout.

### Alternative C — MIDI out only, leaving ADR-0008 exactly where it is

The cheapest decision available, and it keeps the no-audio-while-listening bound intact. Rejected
because it is silent with nothing plugged in, and every `dev` done-when in this project is written
to be checkable with nothing plugged in (ADR-0004). A metronome that only exists at the piano
cannot be developed, demonstrated or judged anywhere else.

### Alternative D — Keep scoring tempo-free even when a click runs

Sound the click, but continue to fit a tempo from the take and judge against that. Rejected
because it makes the click decorative: a player who rushed uniformly through the whole passage
fits a faster tempo and is told they were in time, which is the precise error practising to a
click exists to catch.

## Notes

This ADR widens ADR-0008 and does not supersede it. ADR-0008's Decision — the synthesised voice,
no samples, no files, no network, the sound-target control — stands as written; what changes is
the sentence bounding *when* an audio device may be opened. ADR-0007's `MidiSink` and clock are
used as they are, with no change to that decision.

The backlog's "metronome whose click thins out" (every beat, then 2 and 4, then bar 1, then
silence) is a mask over this grid and needs no further decision; it is left to a later plan
because the interesting part is comparing tempo drift across the four stages, which wants the
store that does not exist yet.
