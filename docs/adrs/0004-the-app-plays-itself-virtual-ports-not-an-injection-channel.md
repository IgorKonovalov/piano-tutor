# ADR-0004 — The app plays itself: a synthetic MidiSource behind virtual ports, not an injection channel

> **Status:** accepted 2026-09-10, on the close of Plan 0001, with the Decision amended the
> same day (see the note under Decision)
> **Date:** 2026-09-09
> **Related plan(s):** Plan [0001](../plans/done/0001-the-keyboard-shows-on-screen.md) (amended by this
> ADR), and every plan after it

## Context

The user asked for development that can run unattended — plan after plan, overnight, with the
human in the loop only where a human is genuinely required. The obstacle is not the harness or
the lanes; it is that the pipeline this application exists to serve starts at a piece of
hardware that is plugged in or it is not.

The dependency is already load-bearing in the first plan, and earlier than it looks. Plan 0001
Phase 2 claims NFR 2 (no event loss) against "a recorded dense take of at least 2 000 events,
committed under `core/fixtures/takes/`". That fixture has to be recorded at the CK88 before the
phase that needs it can pass, which puts a human in the middle of the walking skeleton rather
than at the end of it. Phase 3's key-estimation fixtures ("a C major scale, an A minor arpeggio
passage, a ii-V-I in F") have the same shape. Every plan after 0001 inherits the pattern: score
alignment needs a take to align, the coach needs a take to summarise, the exercise generator
needs a take to score.

Two things make this cheap to fix rather than expensive. ADR-0001 already puts MIDI behind a
`MidiSource` interface in main — `listPorts`, `open`, `close`, `onMessage` — precisely so the
transport is replaceable. Plan 0001 Phase 5 already builds a second implementation, `ReplaySource`,
whose whole purpose is that "replay is not a second code path". Simulation is not new
architecture here; it is a third implementation of a seam that exists, and a seam with three
implementations is better evidence that the seam is right than a seam with one.

What is a real decision is **how the simulated events get in**. The obvious route — a dev-only
IPC channel the test harness calls to push events — adds a capability to `window.api` and a
renderer-reachable channel into main whose only defence is a build-time flag. ADR-0001's security
posture (`contextIsolation`, `sandbox`, `nodeIntegration: false`, double CSP, one narrow
capability per need) is the thing the whole shell rests on, and "it is only there in development"
is the argument that precedes most Electron CVEs.

The second real decision is **what a headless run is allowed to assert**. NFR 1 is 30 ms
key-to-pixel at p95 and it deliberately includes the USB transport, which a synthetic source does
not traverse. `references/best-practices.md` already fixes the principle: a latency figure is a
measurement of one machine and belongs in the implementation log, never in a test CI runs. An
unattended night that asserts milliseconds would either fail on a slow machine or pass on a fast
one while a real regression hid inside the budget.

## Decision

We add a third `MidiSource`, `SyntheticSource`, driven by a seeded scenario generator in `core/`,
and we select it **the way any other port is selected**: `listPorts()` returns virtual ports
alongside the hardware ports, with ids of the form `virtual:<scenario>`, and `open()` on one of
those ids starts that scenario through the identical parse, record, IPC and paint path. There is
**no new IPC channel, no new preload capability and no test hook in the renderer** — the harness
drives the application through the same `midi:*` surface a player drives it through. Virtual
ports are enumerated when the build is unpackaged, and `PT_HARNESS` overrides that in **both**
directions whenever it is set at all: `PT_HARNESS=1` opens the gate on a packaged build, and any
other value shuts it even on an unpackaged one. A packaged build with the variable unset lists
hardware.

*Amended 2026-09-10, before acceptance, at the user's decision during Plan 0001 Phase 6.* As
first written the gate was `!app.isPackaged || PT_HARNESS=1`, with no way to shut it. Under that
rule the claim this ADR rests on — that the gate is a real runtime decision rather than an
assumption — could not be tested: the end-to-end suite drives an unpackaged build, where the
first half of the disjunction is already true, so there was no configuration in which the suite
could watch the harness disappear. The alternatives were to package a build for the e2e run or
to leave the claim unproven; making the variable authoritative in both directions is cheaper
than either and takes nothing away, since a packaged build with the variable unset still lists
hardware only.

A headless run **asserts properties and reports measurements**. The properties are
machine-independent and are the ones a regression actually breaks: every injected event reaches
the renderer and the take (NFR 2), and the frame that first shows a key is within a bounded
number of animation frames of the frame the event was injected in (NFR 11). The milliseconds go
into the plan's implementation log against the machine that produced them, as NFR 1 has always
required, and the only thing that proves NFR 1 end to end remains a human at the instrument.

## Consequences

### Positive

- **Every `dev` phase becomes verifiable with nothing plugged in**, which is what makes an
  unattended queue of plans possible at all.
- **Fixtures stop being recordings.** A generated scenario is deterministic from a seed, is a few
  lines of code rather than a committed binary-ish blob, is diffable, and can be regenerated at a
  different density or length when a plan needs one. Plan 0001's 2 000-event NFR 2 fixture and
  its three key-estimation passages all become generated.
- **The exercised path is the real one.** `SyntheticSource` sits where `RtMidiSource` sits, so a
  green harness run has gone through the byte parser, the arrival stamp, the recorder, the Zod
  boundary, IPC and React — the places a regression lands.
- **No new attack surface**, and `open`/`close`/port-selection get exercised as a side effect
  rather than bypassed.
- **The generator is not throwaway.** The roadmap's exercise plan needs exactly this: seeded
  generation of scales, arpeggios and progressions as note events.

### Negative

- **A green night is not a working piano.** The synthetic source proves nothing about the USB
  transport, RtMidi's own behaviour on Windows, port exclusivity, the CK88's four zone channels,
  the velocity range a player actually produces, or running status as the instrument emits it.
  Plan 0001's final human phase remains the only evidence that the product works, and every plan
  that touches the device keeps one.
- **Generated MIDI is clean MIDI.** It will not produce the malformed messages, interleaved
  real-time bytes and truncated running status that the parser's typed `unknown` path exists for.
  Those stay byte-fixture tests and must not be quietly retired because "the harness covers it".
- **`PT_HARNESS=1` ships in the binary** as an environment check. We accept it: the capability it
  unlocks injects fake notes into a local display, holds no secret, touches no network, and
  writes only take files the user already owns. It is a smaller hole than the injection channel
  it replaces, but it is not zero, and it is a deliberate call rather than an oversight.
- **Frames are a coarse unit.** One frame at 60 Hz is 16.7 ms, so NFR 11 catches a debounce, a
  synchronous parse on the paint path or a re-render storm; it will not catch a 5 ms regression.
  NFR 1 on the development machine is what catches that, and it is measured by hand.
- **Plans can now be written that never meet the instrument.** The discipline that stops this is
  procedural, not technical: a plan that changes what the player observes carries a `human`
  phase, and the queue defers those rather than deleting them.

### Neutral

- Scenario names become a small shared vocabulary (`virtual:c-major-scale`, `virtual:dense-2000`,
  `virtual:ii-V-I-in-F`) that plans cite in done-whens the way they cite NFR rows.
- The port list view grows a visually distinct group for virtual ports, which is the honest
  presentation of a port that is not a device.

## Alternatives considered

### Alternative A — A dev-only `midi:inject` IPC channel

The harness calls `window.api.midi.inject(bytes)` or main exposes a channel the Playwright driver
pushes to. Rejected because it adds a preload capability and a renderer-reachable path into the
main-side MIDI pipeline whose only defence is `if (!app.isPackaged)`, and because it bypasses
`listPorts`/`open`/`close` — the parts of the seam most likely to break on the machine that has a
DAW holding the port. The virtual port gets the same events in with no new surface and more
coverage.

### Alternative B — A Windows virtual MIDI driver (loopMIDI or similar) plus a sender process

Genuinely closer to the real thing: real ports, real RtMidi, real bytes. Rejected because it is
an out-of-band installation on every machine that ever runs the tests, it is not reproducible in
CI or on a fresh clone, it puts a second process in the test harness, and it still needs
something to generate the notes — so it is the seeded generator plus a driver install, not
instead of it. Worth revisiting as a second `MidiSource` if the parser ever needs adversarial
byte-level input at the port rather than in a fixture.

### Alternative C — Mock at the renderer hook or the preload boundary

Have `useMidiEvents` read from a fixture array in test mode. Cheapest by a wide margin. Rejected
because it skips the parser, the arrival stamp, the recorder and IPC, which is where regressions
land; a suite green under this mock proves the least interesting third of the pipeline while
reading as if it proved the whole thing.

## Notes

This ADR adds NFR 11 (headless verifiability) to [nfr.md](../nfr.md) and amends NFR 1's
measurement column to say explicitly which half of the number the harness can and cannot see. It
also amends Plan 0001: Phase 2 absorbs the generator and the synthetic source, Phases 3 to 5 take
their fixtures from generated scenarios, and a new Phase 6 makes the full end-to-end gate runnable
with nothing attached.
