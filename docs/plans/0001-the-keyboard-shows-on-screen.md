# 0001 — The keyboard shows on screen

> **Status:** in-progress
> **Created:** 2026-09-09
> **Owner skill(s):** dev, human
> **Related ADRs:** [0001](../adrs/0001-an-electron-shell-in-typescript-around-a-pure-music-core.md) (proposed),
> [0003](../adrs/0003-two-notation-engines-vexflow-for-the-live-staff-and-osmd-for-the-score.md) (proposed),
> [0004](../adrs/0004-the-app-plays-itself-virtual-ports-not-an-injection-channel.md) (proposed);
> [0002](../adrs/0002-the-coach-is-a-provider-behind-one-interface-and-the-first-provider-is-the-claude-cli.md)
> is built on by Plan 0003, and Phase 5 here records the takes it will read
> **NFRs claimed:** 1, 2, 3, 4, 8, 9, 11 in [nfr.md](../nfr.md)
> **Amended:** 2026-09-09 — the former Phase 0 (copy and adapt the skills) was done at scaffold
> time, before the plan started; removed rather than marked done
> **Amended:** 2026-09-09 — ADR-0004. Phase 2 absorbs the seeded scenario generator and
> `SyntheticSource`; Phases 3 to 5 take their fixtures from generated scenarios rather than from
> takes recorded at the instrument; a new Phase 6 makes the whole gate runnable with nothing
> plugged in; the human checklist moves to Phase 7. The reason: as written, Phase 2's NFR 2
> fixture and Phase 3's key passages had to be recorded at the CK88 first, which put a human in
> the middle of the walking skeleton instead of at the end of it.

## TL;DR

The CK88 is plugged in over USB, the app opens, and every key pressed lights on an 88-key
keyboard, appears on a grand staff, and is named as a chord in a key, within 30 ms. Every session
is recorded as a take that replays into the same view. Nothing in this plan grades the player or
talks to a model; it is the pipeline every later plan stands on, and it is useful on day one as a
display of what is being played.

## Context & problem

The interview (2026-09-09) fixed the product: Windows desktop, Electron + TypeScript, USB MIDI
from a Yamaha CK88, a live display (keyboard, staff, chord and key labels), score practice,
exercises, and an on-demand LLM coach, all local, everything but the coach offline. The user
asked for MIDI in and the live display first, because it proves the pipeline and is worth
having by itself.

The pipeline has three seams that every later plan depends on and that are cheapest to get right
before anything sits on them: the `MidiSource` interface in main (USB today, replay in this plan,
DIN or Bluetooth adapters later), the `MidiEvent` shape that crosses IPC and lands in take files,
and the purity of `core/`, which is what lets alignment, exercises and the coach summary be
tested without a piano.

## Decision

We build the walking skeleton as ADR-0001 lays it out: one npm project, three bundles, four
tsconfigs, exact pins, the security defaults and double CSP lifted from the sibling repositories.
Main owns the CK88 through `@julusian/midi` behind `MidiSource`, stamps and parses every event,
forwards it over one push channel, and records it. The renderer paints a keyboard, a VexFlow
grand staff (ADR-0003) and a labels panel fed by `core/`. A `ReplaySource` that implements the
same `MidiSource` interface plays a take back through the identical path, so replay is not a
second code path, and a `SyntheticSource` behind `virtual:<scenario>` ports (ADR-0004) plays
seeded, generated passages through that same path, so every phase below this one can be proved
with nothing plugged in. The last phase is the user at the instrument with a checklist, and it is
the only thing in this plan that proves the product rather than the pipeline.

We rejected Web MIDI in the renderer (ADR-0001 Alternative B) as the primary path, and we
rejected starting with the score view because it would put a week of OSMD work in front of the
first lit key.

## Architecture diagram

```mermaid
flowchart LR
    CK[CK88<br/>USB MIDI]
    subgraph main["main process"]
        MS[MidiSource<br/>RtMidiSource | ReplaySource | SyntheticSource]
        PARSE[parser<br/>bytes -> MidiEvent<br/>stamped at arrival]
        REC[recorder<br/>takes/*.jsonl]
        PORTS[port list<br/>poll 2 s]
    end
    subgraph preload["preload"]
        API[window.api.midi / .take]
    end
    subgraph renderer["renderer (React)"]
        KB[Keyboard<br/>88 keys + sustain]
        ST[LiveStaff<br/>VexFlow grand staff]
        LB[Labels<br/>chord / key / roman]
        TK[Takes<br/>list + replay]
        OV[latency overlay<br/>dev only]
    end
    subgraph core["core/ (pure TS)"]
        HELD[HeldNotes]
        CH[chord + key detection]
        SP[spelling]
        GEN[generate.ts<br/>seeded scenarios]
    end
    GEN -.-> MS
    CK --> MS --> PARSE --> REC
    PARSE -- midi:event --> API --> HELD
    HELD --> KB
    HELD --> SP --> ST
    HELD --> CH --> LB
    TK -- take:replay --> API -- take:* --> REC
    PARSE -.-> OV
```

## Implementation phases

Each phase ships as its own commit. `dev` runs Phases 1 to 6 in one session; the architect
reviews the whole plan once, in a fresh session, after Phase 7. The harness itself (the two
skills, the staging hook, `scripts/check-doc-links.mjs`, `scripts/check-pins.mjs` and the opt-in
pre-push hook) landed with the scaffold on 2026-09-09 and is not a phase here.

### Phase 1 — The shell opens and lists the ports
- **Owner skill:** dev
- **What:** The npm project exists per ADR-0001 and opens a window that lists the MIDI input
  ports Windows reports, refreshed every two seconds (RtMidi has no hot-plug event on Windows),
  with a one-line status when a port cannot be opened because another application holds it.
  Below them, in a visually distinct group, the virtual ports of ADR-0004 — listed only when
  `app.isPackaged === false` or `PT_HARNESS=1`, and not openable until Phase 2. The pre-push gate
  exists and runs the four checks.
- **Files touched:** `package.json`, `package-lock.json`, `tsconfig.*.json` (base, main, preload,
  renderer, core), `esbuild.main.mjs`, `esbuild.preload.mjs`, `vite.config.ts`,
  `eslint.config.mjs`, `.prettierrc.json`, `vitest.config.ts`, `playwright.config.ts`,
  `electron/main.ts`, `electron/window.ts` (CSP install, `createWindow`),
  `electron/midi/MidiSource.ts` (the interface), `electron/midi/RtMidiSource.ts` (`listPorts`
  only this phase), `electron/midi/virtualPorts.ts` (the scenario id vocabulary and the
  `isPackaged`/`PT_HARNESS` gate), `electron/midi/virtualPorts.test.ts`,
  `electron/ipc/midiHandlers.ts`, `electron/preload/index.ts`,
  `electron/preload/api/midi.ts`, `shared/ipc-channels.ts`, `shared/midi.ts` (Zod: `MidiPort`),
  `renderer/index.html`, `renderer/main.tsx`, `renderer/App.tsx`, `renderer/views/Ports.tsx`,
  `renderer/styles.css`, `README.md` (the run and build commands). `.githooks/pre-push` and
  `scripts/check-pins.mjs` already exist and need no edit: the hook runs the npm steps as soon as
  `package.json` and `node_modules` exist.
- **Notes for the implementer:**
  - Versions below were verified against the npm registry on 2026-09-09. Re-verify at install
    and pin exactly what installs. **TypeScript is pinned to the 5.9 line, not 7.0:** 7.0 is the
    new native compiler and `typescript-eslint` 8.70 does not yet target it. Revisit when it
    does, as a one-line manifest change.

    | Package | Version | Package | Version |
    |---|---|---|---|
    | `electron` | 44.3.0 | `typescript` | 5.9.3 |
    | `electron-builder` | 26.15.3 | `zod` | 4.6.0 |
    | `esbuild` | 0.28.2 | `@julusian/midi` | 3.8.1 |
    | `vite` | 8.2.2 | `tonal` | 6.4.3 |
    | `@vitejs/plugin-react` | 6.1.1 | `vexflow` | 5.0.0 |
    | `react` / `react-dom` | 19.3.0 | `vitest` | 5.0.0 |
    | `@types/react` / `@types/react-dom` | 19.3.0 | `eslint` | 10.10.0 |
    | `@types/node` | 22.20.2 | `typescript-eslint` | 8.70.0 |
    | `@playwright/test` | 1.63.0 | `eslint-plugin-react-hooks` | 7.1.1 |
    | `concurrently` | 10.0.5 | `prettier` | 3.9.6 |
    | `cross-env` | 10.1.0 | `wait-on` | 9.1.0 |

    `opensheetmusicdisplay` 2.1.2, `@tonejs/midi` 2.0.28 and `@anthropic-ai/sdk` 0.124.0 are
    recorded here for Plans 0002 and 0003 and are **not** installed by this plan.
  - Copy, do not redesign: the double-CSP hook (`<meta>` plus `onHeadersReceived` stripping any
    incoming policy case-insensitively) and the `ELECTRON_RENDERER_URL` dev contract come from
    `../trading/market-analyzer/desktop/electron/window.ts` and `main.ts`. The CSP has **no
    `connect-src`** at all; `'unsafe-inline'` in `script-src` only while unpackaged.
  - `@julusian/midi` is N-API; no `electron-rebuild`. If `npm install` cannot fetch a prebuilt
    binary on this machine, stop and surface it: ADR-0001 Alternative B is the fallback and it is
    the architect's call, not a quiet swap.
  - The `package.json` scripts the hook and the skills assume are `dev`, `build`, `typecheck`
    (all four tsconfigs), `lint`, `test` (Vitest), `test:e2e` (Playwright) and `package`. Name
    them exactly so; `.githooks/pre-push` calls `typecheck`, `lint` and `test` by those names.
    Verify the installed hook goes green once `node_modules` exists (NFR 9 is its pins step).
- **Done when:** with **nothing plugged in**, `npm run dev` opens a window whose ports view shows
  the virtual group with at least one row and a hardware group that is empty or holds whatever
  Windows reports; a unit test asserts that `listPorts` returns no virtual entry when
  `app.isPackaged` is true and `PT_HARNESS` is unset, and returns them when either gate opens.
  `npm run typecheck`, `npm run lint`, `npm test` and the pins check are green, and the Playwright
  golden path opens the app and finds the ports view without an error dialog. The renderer bundle
  makes no network request (NFR 3, checked by the e2e run with networking disabled). *The CK88's
  own port name, the two-second refresh across an unplug, and the DAW-holds-the-port row are
  Phase 7's checklist; they cannot be checked without the instrument and are not gates here.*

### Phase 2 — The keys light up, and the app can play itself
- **Owner skill:** dev
- **What:** Main opens the selected port, stamps each message with `performance.now()` on
  arrival, parses it into a `MidiEvent`, and pushes it over `midi:event`. The renderer paints an
  88-key keyboard with pressed keys shaded by velocity, a sustain indicator, and a scrolling
  event log. A dev-only overlay measures arrival-to-paint latency and shows its distribution.
  Opening a `virtual:<scenario>` port runs a seeded generated passage through that identical
  path (ADR-0004), so this phase and every one after it is provable with nothing plugged in.
- **Files touched:** `electron/midi/RtMidiSource.ts` (`open`, `close`, `onMessage`),
  `electron/midi/parse.ts`, `electron/midi/parse.test.ts`,
  `electron/midi/SyntheticSource.ts`, `electron/midi/SyntheticSource.test.ts`,
  `electron/midi/virtualPorts.ts` (the scenario table gains its generators),
  `core/src/midi/generate.ts`, `core/src/midi/generate.test.ts`, `core/src/midi/rng.ts`
  (a seeded PRNG, no `Math.random`), `electron/ipc/midiHandlers.ts`,
  `electron/preload/api/midi.ts` (`onEvent` returning a cleanup), `shared/midi.ts` (Zod:
  `MidiEvent`), `core/src/midi/HeldNotes.ts`, `core/src/midi/HeldNotes.test.ts`,
  `renderer/components/Keyboard.tsx` + `.module.css`, `renderer/components/EventLog.tsx`,
  `renderer/components/LatencyOverlay.tsx`, `renderer/hooks/useMidiEvents.ts`,
  `renderer/views/Live.tsx`.
- **Notes for the implementer:**
  - The parser handles: note-on, note-off, **note-on with velocity 0 as note-off**, running
    status, CC 64 (sustain), 66 (sostenuto), 67 (soft), program change and pitch bend (typed,
    then ignored by the views), and system real-time bytes interleaved mid-message (dropped, not
    fatal). It keeps the channel on every event (the CK88's four zones may transmit on different
    channels). Unknown status bytes produce a typed `unknown` event with the raw bytes, never an
    exception. `parse.test.ts` covers each of these from byte fixtures.
  - `HeldNotes` in `core/` is the one reducer from a stream of `MidiEvent`s to the currently held
    set plus pedal state, with sustain semantics (a note released while sustain is down stays
    sounding until sustain lifts). The keyboard, the staff and the labels all read from it.
  - The push channel's preload binding returns a cleanup function; `useMidiEvents` calls it on
    unmount (no fire-and-forget listeners).
  - The overlay is behind `import.meta.env.DEV`: it records, per note-on, the main-side stamp
    (carried in the event) against the `requestAnimationFrame` timestamp of the first frame that
    shows the key, and shows p50, p95 and max over the last 500 events **and the frame delta**
    (the count of animation frames between the frame the event arrived in and the frame that
    first shows the key), which is what NFR 11 bounds.
  - **The generator lives in `core/`, not in main**, because it is pure and because the exercise
    plan needs the same code later. It emits `MidiEvent`s with relative times from a seed; the
    synthetic source is the thin main-side piece that turns those into byte messages on a timer
    and hands them to the same `onMessage` callback `RtMidiSource` uses — the parser must not be
    bypassed, or the harness stops covering it. Emitting bytes rather than events is the point.
  - Four scenarios this phase: `virtual:c-major-scale` (two octaves up and down, legato),
    `virtual:ii-V-I-in-F` (block chords with pedal), `virtual:a-minor-arpeggios`, and
    `virtual:dense-2000` (at least 2 000 events sustaining 100 events/s with two 2 s bursts of
    200/s, for NFR 2). `virtual:` ids are the vocabulary later plans cite.
  - **Generated MIDI is clean MIDI.** ADR-0004 is explicit that it will not exercise the parser's
    malformed, running-status and interleaved-real-time paths. Those stay byte-fixture tests in
    `parse.test.ts` and must not be retired on the grounds that the harness runs.
- **Done when:** opening `virtual:dense-2000` with nothing plugged in delivers every generated
  event to the renderer's log and to the recorder with no loss, counted by a test at the
  `MidiSource` seam (NFR 2), and the overlay's frame delta over those events holds p95 ≤ 2 and
  max ≤ 4 (NFR 11); the same generated event list produced twice from the same seed is
  byte-identical (determinism); opening `virtual:ii-V-I-in-F` shows a sustained chord held
  through a pedal release correctly on the keyboard; and the millisecond distribution the overlay
  reports for that run is written into the implementation log against this machine, labelled as
  the synthetic figure it is. *NFR 1 proper — a real note-on at the CK88 — is Phase 7.*

### Phase 3 — The notes get names
- **Owner skill:** dev
- **What:** `core/` names what is held: key-aware pitch spelling, chord detection from the held
  set, and a key estimate over a sliding window of recent pitch classes. The renderer shows
  chord name, key, and Roman numeral of the chord in the key.
- **Files touched:** `core/src/theory/spelling.ts`, `core/src/theory/chords.ts`,
  `core/src/theory/key.ts`, their `.test.ts` files, `core/fixtures/chords.json` (a hand-written
  table, the one fixture that is not generated because it is the ground truth),
  `renderer/components/Labels.tsx` + `.module.css`,
  `renderer/views/Live.tsx`.
- **Notes for the implementer:**
  - Chord detection uses `tonal`'s `Chord.detect` on the pitch-class set of held notes, with the
    lowest held note as a bass hint; the result list is ordered and the first is shown, the rest
    available on hover. Inversions and slash chords are shown as `tonal` names them.
  - Key estimation is a Krumhansl-Schmuckler correlation of a decayed pitch-class histogram
    (half-life about eight seconds of playing) against the 24 major and minor profiles; it
    reports the best key and a confidence, and the label greys out below a confidence threshold
    rather than flickering between keys. Deterministic: the histogram is a function of the event
    list, with no wall-clock reads inside `core/`.
  - Spelling follows the estimated key (F# in D major, Gb in Db major); when no key is confident,
    default to sharps for ascending and flats for descending context, or simply sharps.
- **Done when:** a fixture table of at least 40 held sets (triads, sevenths, inversions, slash
  chords, open voicings across two hands) names as the table says — `C-E-G` with `E` lowest names
  `C/E`, `D-F-A-C` names `Dm7`, `C-Eb-Gb-A` names a diminished seventh by one of its four
  spellings and the test accepts that set; the generated scenarios `virtual:c-major-scale`,
  `virtual:a-minor-arpeggios` and `virtual:ii-V-I-in-F` report C major, A minor and F major with
  confidence above the display threshold, run as `core/` tests over the generator's output with
  no app and no instrument; and the Phase 2 overlay's frame delta with the labels mounted still
  holds NFR 11.

### Phase 4 — The staff draws what is held
- **Owner skill:** dev
- **What:** A VexFlow grand staff that redraws the held set as one chord per stave on every
  event, with a configurable split point (default middle C) and spelling from Phase 3, inside
  the latency budget.
- **Files touched:** `renderer/components/LiveStaff.tsx` + `.module.css`,
  `renderer/components/LiveStaff.test.tsx` (the split and spelling inputs, not pixels),
  `core/src/theory/staffLayout.ts` (which stave each note lands on, accidentals to show),
  `core/src/theory/staffLayout.test.ts`, `renderer/views/Live.tsx`.
- **Notes for the implementer:** VexFlow 5's API differs from 4; read its current docs rather
  than older examples. Create the renderer once in a `useEffect` and dispose it on unmount
  (ADR-0001's non-React-resource rule); redraw the chord on each `HeldNotes` change without
  recreating the context. Notes held across the split that form one hand's chord stay on one
  stave when the span is under a tenth; the rule lives in `staffLayout.ts` so it is tested.
- **Done when:** the staff shows what the keyboard shows for every entry in Phase 3's chord
  fixture (checked by a test on `staffLayout`'s output, not a screenshot), a two-hand chord
  splits across the staves as written, and the Phase 2 overlay's frame delta with the staff
  mounted still holds NFR 11 over `virtual:dense-2000` — the staff is the component most likely
  to break it, and this is the run that says so before a human ever plays a note.

### Phase 5 — Every session is a take
- **Owner skill:** dev
- **What:** Main records every event of a session to a take file under `userData/takes/`,
  flushed every second or 64 events (NFR 8). The renderer lists takes and replays one into the
  same live view. Replay is a `ReplaySource` implementing `MidiSource`, so the events travel the
  identical path and the views cannot tell the difference.
- **Files touched:** `electron/take/Recorder.ts`, `electron/take/Recorder.test.ts`,
  `electron/take/takeFile.ts` (format read and write), `electron/midi/ReplaySource.ts`,
  `electron/ipc/takeHandlers.ts`, `electron/preload/api/take.ts`, `shared/take.ts` (Zod:
  `TakeHeader`, `TakeSummaryRow`), `shared/ipc-channels.ts`, `renderer/views/Takes.tsx` +
  `.module.css`, `renderer/App.tsx` (navigation between Live and Takes).
- **Notes for the implementer:** the take file is JSON Lines: one `TakeHeader` line (format
  version, start time, port name, app version) followed by one `MidiEvent` per line with the
  main-side timestamp relative to the header's start. Append-only, so a crash loses at most the
  unflushed tail. A take with fewer than ten note-ons is deleted at session end rather than
  listed. Replay preserves the recorded inter-event timing and can run at 0.5x and 2x.
- **Done when:** a session driven from `virtual:ii-V-I-in-F` records a take that replays into the
  live view with an event log sequence equal to the file's; killing the main process mid-session
  (the test spawns and kills it) leaves a take that reads back with at most one second of events
  missing (NFR 8); the takes list shows duration, note count and port for each file, and a take
  recorded from a virtual port says so in its header's `port` field rather than pretending to be
  hardware; and a `virtual:dense-2000` session recorded and then replayed through `ReplaySource`
  delivers the same event count both times (NFR 2 across the record-replay round trip).

### Phase 6 — The whole gate runs with nothing plugged in
- **Owner skill:** dev
- **What:** The end-to-end suite drives every view of the finished skeleton through virtual ports
  alone, with networking disabled, and one npm script runs the entire gate. This is the phase
  that makes an unattended queue of later plans safe: after it, a red gate is the run's stop
  signal and a green gate means the pipeline is intact without anyone in the room.
- **Files touched:** `e2e/app.spec.ts` (ports view, live view, takes view), `e2e/harness.ts`
  (launch helper: `PT_HARNESS=1`, networking off, select a virtual port, wait for the first
  painted key), `playwright.config.ts`, `package.json` (the `gate` script), `README.md` (how to
  run the app with no instrument attached).
- **Notes for the implementer:**
  - `npm run gate` is `typecheck`, `lint`, `test`, `check-pins`, `check-doc-links`, then
    `test:e2e`, in that order, stopping at the first failure. It is the single command an
    overnight run and the pre-push hook mean by "the gate"; the hook still never runs the e2e
    step (it is slow and it opens a window), so the script and the hook are not the same list.
  - The e2e run asserts **properties**: every view reachable, every generated event visible in
    the log, zero network requests (NFR 3), the frame bound of NFR 11. It **reports** the startup
    milliseconds (NFR 4, measured from `app.whenReady` to the first painted key on
    `virtual:c-major-scale`) into the log rather than asserting them; the CI machine is not the
    development machine and a threshold there would fail for the wrong reason.
  - Playwright drives Electron through `_electron.launch`. Keep the harness helper the only place
    that knows about `PT_HARNESS`, so a future packaged-build test cannot accidentally set it.
- **Done when:** on a machine with no MIDI device attached and networking disabled,
  `npm run gate` is green end to end and the e2e suite has visited the ports, live and takes
  views; the run reports the NFR 4 startup figure and the NFR 11 frame distribution into the
  implementation log; and unsetting `PT_HARNESS` makes the e2e suite fail to find a port, which
  is the test that the gate of ADR-0004 is real rather than assumed.

### Phase 7 — At the instrument
- **Owner skill:** human
- **What:** The user plugs in the CK88 and runs the checklist, writing the answers into the
  implementation log.
- **Checklist:**
  1. What Windows names the port, and whether it appeared without installing Yamaha's USB
     driver (the answer settles the `CLAUDE.md` platform note).
  2. Each of the four zones on its own channel: do all four reach the event log with the right
     channel?
  3. Sustain, sostenuto and soft pedals each show on the indicator; a chord held through a
     sustain release behaves as it sounds.
  4. Velocity: does the shading span the range the player actually produces, pianissimo to
     fortissimo?
  5. **NFR 1 for real.** Play at least 500 note-ons and read the overlay's p50, p95 and max.
     This is the only measurement in the plan that traverses USB, and it is the number NFR 1
     means. Write it into the log beside Phase 2's synthetic figure; the gap between the two is
     what the harness cannot see, and it is worth knowing once.
  6. Latency by feel: does the lit key ever visibly trail the sound?
  7. Unplug and replug mid-session: does the port list recover within two seconds and can the
     port be reopened without a restart?
  8. Open a DAW holding the port first: does the app say so instead of failing silently?
  9. Does the hardware port list look right beside the virtual group — is it obvious which rows
     are the instrument and which are the harness?
- **Done when:** every line has an answer in the log, and anything that failed is a followup
  row rather than a fix made in this phase.
- **If this phase is deferred by an unattended run** (`dev` logs it and moves on, per the queue
  protocol in `CLAUDE.md`), the plan **cannot close**: the architect's review at the close reads
  an outstanding `human` phase as a blocker on the close, not on the code. Everything above is
  what the harness is structurally unable to prove.

## Data shapes

Illustrative, not final; `shared/midi.ts` and `shared/take.ts` hold the Zod schemas that are.

```ts
// illustrative — shared/midi.ts
type MidiEvent =
  | { kind: 'noteOn';  t: number; ch: number; note: number; velocity: number }
  | { kind: 'noteOff'; t: number; ch: number; note: number; velocity: number }
  | { kind: 'cc';      t: number; ch: number; controller: number; value: number }
  | { kind: 'programChange'; t: number; ch: number; program: number }
  | { kind: 'pitchBend'; t: number; ch: number; value: number }
  | { kind: 'unknown'; t: number; bytes: number[] }
// t: main-side performance.now() at arrival, ms; in a take file, relative to the header start.

// illustrative — electron/midi/MidiSource.ts
interface MidiSource {
  listPorts(): Promise<MidiPort[]>
  open(portId: string): Promise<void>
  close(): Promise<void>
  onMessage(cb: (bytes: Uint8Array, t: number) => void): () => void
}

// illustrative — shared/take.ts, first line of a take file
type TakeHeader = { format: 1; startedAt: string; port: string; appVersion: string }
// port carries the virtual id verbatim ('virtual:dense-2000') when the take came from the
// harness, so a generated take is never mistaken for a played one.

// illustrative — core/src/midi/generate.ts (pure, seeded; ADR-0004)
type Scenario = { id: string; seed: number; generate(): MidiEvent[] }
// The events carry relative times from zero. electron/midi/SyntheticSource.ts turns them back
// into byte messages on a timer and feeds the same onMessage the RtMidi source feeds, so the
// parser is exercised rather than bypassed.
```

## Risks & open questions

- **The native binding does not install or misbehaves on the CK88.** Stop at Phase 1 and surface;
  ADR-0001 Alternative B (Web MIDI in the renderer behind the same event shape) is a day's work
  and the architect's call.
- **RtMidi on Windows has no hot-plug callback.** Polling every two seconds is the plan; if
  polling itself disturbs an open port (it should not, but RtMidi reopens a probe handle), the
  poll pauses while a port is open and resumes on close.
- **The latency budget is not met.** The likely culprit is React re-rendering the whole keyboard
  per event; the fix is a canvas keyboard or per-key memoisation, decided by the overlay's
  numbers, not guessed. NFR 1 is the acceptance.
- **VexFlow 5 is new and its API has moved.** Phase 4 reads the current docs; if the chord
  redraw cannot be made cheap, the staff repaints on a 30 Hz timer fed by `HeldNotes` rather
  than per event, which still meets NFR 1.
- **React 19, Vite 8 and ESLint 10 are all recent majors**; a plugin gap would show at Phase 1
  and the fix is to pin one major lower, recorded in the log, never a range.
- **Windows port naming.** Yamaha devices sometimes enumerate as two ports (one per USB MIDI
  interface); the ports view shows both and the user picks.
- **A green harness is mistaken for a working piano.** This is the risk ADR-0004 creates and it
  is a habit risk, not a technical one: after a few unattended nights it becomes easy to read
  `npm run gate` as "it works". It does not; it means the pipeline is intact. Phase 7 is the only
  evidence about the product, and the mitigation is procedural — a deferred `human` phase blocks
  the plan's close, and the plan's `### Measurements` carries the synthetic and the real latency
  figures side by side so the difference stays visible.
- **The generator drifts from real playing.** Generated passages are metronomic and evenly
  voiced; a key estimator or an alignment tuned against them can be quietly wrong about a human
  performance. From Phase 7 onward, one real recorded take is committed as a fixture and the
  `core/` tests run against it as well as against the generated scenarios.

## What this plan does NOT do

- **No grading, no score, no OSMD.** That is Plan 0002, on top of the takes this plan records.
- **No coach, no settings for an API key.** Plan 0003, on ADR-0002.
- **No exercises.** Plan 0004.
- **No MusicXML in the generator.** The seeded scenarios of ADR-0004 emit `MidiEvent`s only. The
  exercise plan is what teaches the generator to emit a score as well.
- **No packaging to a zip, no release.** The first release is its own plan once there is
  something worth handing to a second machine.
- **No MIDI out.** Playing a passage back through the CK88 is a later idea; the port list lists
  inputs only.
- **No Bluetooth.** The CK88 has no Bluetooth MIDI; an adapter on the DIN ports would be a second
  `MidiSource` and its own short plan.

## Implementation log

> Written by `dev`, one row per phase as that phase's commit lands. **The phases above are the
> contract; everything here is what happened.** Observations, never conclusions. A deviation from
> the plan or an unmet done-when is always disclosed; silence on the rest means it passed.

**Lane:** main

| phase | owner | state | commit |
|---|---|---|---|
| 1 — The shell opens and lists the ports | dev | done | 37ae827 |
| 2 — The keys light up, and the app can play itself | dev | done | ad95841 |
| 3 — The notes get names | dev | done | dd1f69f |
| 4 — The staff draws what is held | dev | done | 8d4b9d9 |
| 5 — Every session is a take | dev | done | 11b6d77 |
| 6 — The whole gate runs with nothing plugged in | dev | done | b4a67c3 |
| 7 — At the instrument | human | done | answers below |

### Measurements

- **NFR 11 (Phase 2, keyboard only), synthetic:** frame delta p50 1, p95 1, max 1; milliseconds
  p50 6.1, p95 23.3, max 29.5 over 500 note-ons from `virtual:dense-2000` (2 200 events, 18 s),
  on the development machine (Windows 10, Electron 44). Read from the dev-only overlay with the
  window in the foreground. **These milliseconds never crossed USB and are not NFR 1**; NFR 1 is
  Phase 7.
- **NFR 11 (Phase 3, labels mounted), synthetic:** frame delta p50 1, p95 1, max 1; milliseconds
  p50 5.0, p95 19.8, max 31.8 over 500 note-ons from `virtual:dense-2000`, development machine.
- **NFR 11 (Phase 4, staff mounted), synthetic:** frame delta p50 1, p95 1, max 1; milliseconds
  p50 9.3, p95 30.0, max 49.6 over 500 note-ons from `virtual:dense-2000`, development machine.
  Before the 30 Hz coalescing described below the same run read p50 12.1, p95 33.0, max 88.3.
- **NFR 11 (Phase 6, whole app, production build), synthetic:** frame delta p50 1, p95 1, max 1;
  milliseconds p50 5.3, p95 7.9, max 14.2 over 500 note-ons from `virtual:dense-2000`, development
  machine. Three runs of the same suite gave 4.1/6.2/7.4, 5.0/6.9/7.1 and 5.3/7.9/14.2 ms. These
  are lower than Phases 2 to 4 because those were read through the Vite dev server, which adds
  HMR and React's development double-render; this is the built renderer.
- **NFR 4 (Phase 6), synthetic:** 437 ms, 463 ms and 806 ms across three runs on the development
  machine, measured from **process creation** to the first painted key on `virtual:c-major-scale`.
  Process creation is earlier than `app.whenReady`, so the figure is a slight over-estimate of the
  row as written; it is the earliest instant available without putting a hook in main. Budget is
  3 000 ms.
- **NFR 1 (Phase 7), at the instrument:** p50 3.4 ms, p95 6.1 ms, max 12.1 ms over 500 note-ons,
  CK88 over USB into `hw:0`, development machine. Frame delta p50 1, p95 1, max 1. Budget is
  30 ms at p95 and 50 ms at max. The synthetic figure at Phase 6 was p50 5.3 / p95 7.9 on the same
  machine, so **the real transport measured slightly faster than the harness**, and the gap the
  harness cannot see turned out to be nothing.
  *This is the number NFR 1 means; the synthetic figures above do not traverse USB.*
- **Windows port name (Phase 7):** two ports, `CK Series-1` (`hw:0`) and `CK Series-2` (`hw:1`).
  `hw:0` is the one that carries the keyboard. This is the two-port enumeration the plan's risk
  list anticipated.
- **Yamaha USB driver needed for MIDI (Phase 7):** **no.** The ports appeared with no Yamaha
  driver installed on this machine, so the MIDI half is class-compliant.

### Notes

- Phase 1 also created `e2e/app.spec.ts` (listed under Phase 6): Phase 1's done-when names a
  Playwright golden path, and the config alone cannot supply one. Phase 6 extends it.
- Phase 1 also created `renderer/types/global.d.ts` and `renderer/views/Ports.module.css`, neither
  in its file list; the first is where `window.api` is typed, the second is the per-component
  stylesheet the house style requires.
- `MidiApi` (the `window.api.midi` surface) is declared in `shared/midi.ts` rather than exported
  from the preload bundle, so the renderer types the bridge without importing a module that
  imports `electron`.
- `RtMidiSource.listPorts` probes each hardware port with a short open to report `busy`, and skips
  the probe while this source holds a port open. Nothing exercised that path yet: this machine
  reported zero hardware ports for every run in this phase.
- Followup not acted on: the preload bundle is 727 kB because Zod is bundled into it. It parses
  one push channel's payload per event from Phase 2, so it stays for now; if NFR 4 is missed at
  Phase 6, this is the first place to look.
- Phase 2 also edited `renderer/views/Ports.tsx` and `renderer/App.tsx`, neither in its file list.
  Its done-when requires opening `virtual:dense-2000` and `virtual:ii-V-I-in-F` from the app, and
  nothing in the listed files can select a port or reach the live view.
- `MidiEvent.t` is `performance.timeOrigin + performance.now()` at arrival, not the bare
  `performance.now()` the plan's illustrative shape shows. Main and the renderer are separate
  processes with separate time origins, so bare values cannot be subtracted and NFR 1 could not be
  measured at all; the epoch anchor makes both clocks comparable.
- Main serialises `midi:open` and `midi:close` through a promise queue. React's development
  double-mount sends open, close, open within a frame, and without the queue the close landed
  after the second open and left the port shut while the view believed it was listening.
- `useMidiEvents` subscribes on mount rather than after `open()` resolves: a source can deliver
  its first message inside `open()` (the synthetic one does, for anything due at t=0), so waiting
  lost the head of every passage.
- Measured, not guessed: the event log's rows are memoised and the log holds 60 entries. Through
  `virtual:dense-2000` the unmemoised 250-row log cost p50 37.3 ms / p95 103.4 ms; memoising took
  it to 27.1 / 49.2 and 60 rows took it to 6.1 / 23.3. The frame delta was 1 in every one of those
  runs, so NFR 11 alone would not have caught it -- the milliseconds are what showed it.
- The renderer's event count reads 2 201 rather than 2 200 for `virtual:dense-2000` under the Vite
  dev server: React's StrictMode opens the port twice, and the first open's t=0 event arrives
  before the second one restarts the scenario. A production build does not double-invoke, and the
  built app counts 2 200.
- Not acted on: RtMidi's `open`, `close` and `onMessage` have no automated test. They need a
  device; `SyntheticSource` covers the same seam and the parser, and Phase 7 covers the rest.
- Three of the forty-six fixture chords were wrong when first written, in the fixture rather than
  in the code: Eb major is 63-67-70, not 63-66-70 (that is Eb minor), and one entry named an Eb
  chord over a set that contained no Eb. Corrected in the fixture.
- Two rankings and one format are this project's, not tonal's, and each is a judgement a review
  should look at. Tonal offers `Em#5` before `CM/E` for a first-inversion C, and `Dm6/B` before
  `Bm7b5`; `chords.ts` sorts candidates by a table of how ordinary each chord type is plus a fixed
  penalty for an inversion. Tonal also writes `CM` for a major triad and `IM` for its numeral, and
  every numeral in upper case; the display strips the `M` and lower-cases a minor or diminished
  numeral.
- The key estimate is recomputed every 400 ms rather than every frame, on the same slow lane as
  the latency percentiles. The chord name is not: it follows the held notes immediately.
- `Labels` is memoised on the contents of the held set rather than the array's identity, because
  the view repaints every frame and chord detection is the most expensive thing on it.
- The key confidence threshold is 0.55. It is a chosen number, not a measured one: it is high
  enough that the three generated scenarios clear it and low enough that a four-note chord does
  not read as unknown. Nothing calibrates it against human playing yet, which is the
  generator-drift risk the plan names.
- The staff is the most expensive thing on the paint path, as the plan predicted. Mounting it
  moved `virtual:dense-2000` from p50 5.0 ms / p95 19.8 ms to 12.1 / 33.0. `LiveStaff` now
  coalesces its VexFlow redraws to 30 Hz -- the fallback ADR-0003 and the plan both name -- which
  brought it to 9.3 / 30.0. A change is still drawn immediately whenever the staff has been idle,
  so a single key press is never delayed; only a burst faster than 30 changes a second is batched.
  The keyboard stays on the 60 Hz path.
- Three of the staff-split tests were wrong as first written, in the test rather than the code:
  a semitone straddling middle C is one hand under the plan's own under-a-tenth rule, and A3-C4-E4
  reads in the treble because its middle sits above middle C. Corrected in the test.
- The live staff draws no key signature. There are no measures and no bar line to reset one
  (ADR-0003), so every altered note carries its own accidental, spelled from the estimated key.
- `LiveStaff.test.tsx` stubs `HTMLCanvasElement.getContext`: jsdom implements no canvas and
  VexFlow measures text through one. Without the stub the file logged 29 warnings and took 47 s;
  with it, 4 s.
- Phase 5 added two files outside its list and edited two more, all so that "replay is not a
  second code path" is true rather than asserted. `electron/midi/pipeline.ts` is the one place a
  source becomes events on screen and lines in a take file, and `electron/ipc/serial.ts` is the
  open/close queue that used to live inside `midiHandlers.ts`; `midiHandlers.ts` and `main.ts`
  were rewritten onto them. Three callers now open a source -- the ports view, the harness and a
  replay -- through the same fifteen lines.
- `electron/midi/timedSource.ts` is also new: `SyntheticSource` and `ReplaySource` differ only in
  where their bytes come from, and a second copy of the flush loop would be a second place for an
  event to go missing. `SyntheticSource` re-exports `Clock` and `systemClock` from it.
- The recorder's flush is synchronous (`appendFileSync`) but never runs on the arrival path: an
  event goes into an array and returns, and the flush happens on the interval or on a
  `setImmediate` after a batch of 64. Synchronous is the point -- when it returns the bytes are
  the operating system's, which is what makes NFR 8 a fact about the file.
- NFR 8 is covered two ways: a test that tears the final line of a real take and reads it back
  (everything up to the last flush survives, the torn line is dropped, `skippedLines` is 1), and a
  test that spawns a real child process, kills it with SIGKILL mid-write and reads the file it
  left behind.
- Verified in the running production build rather than only in tests: a `virtual:ii-V-I-in-F`
  session recorded 32 events, the file held 32, and replaying it delivered 32 to the live view.
  The takes row read 0:06, 13 notes, 32 events, `virtual:ii-V-I-in-F`, tagged Generated.
- Under the Vite dev server the same check reads one event higher, for the StrictMode reason
  already noted at Phase 2. It is a development-only artifact and does not appear in a build.
- **A change to ADR-0004's gate, authorised by the user during this session.** `PT_HARNESS` is now
  authoritative in both directions: `1` opens the harness, and any other value shuts it even in an
  unpackaged build. The ADR as written says virtual ports are enumerated when
  `!app.isPackaged || PT_HARNESS=1`, under which Phase 6's done-when clause "unsetting
  `PT_HARNESS` makes the e2e suite fail to find a port" cannot hold: the suite drives an
  unpackaged build, where the first half of the disjunction is already true. The alternatives put
  to the user were leaving the gate alone and logging the clause unmet, or packaging a build for
  the e2e; the opt-out was chosen. **ADR-0004 needs amending to match.**
- The latency overlay is now shown when a `virtual:` port is being watched, not only under
  `import.meta.env.DEV`. Without it the end-to-end run could not read NFR 11 off the build it
  actually drives. A `virtual:` port only exists when the gate above is open, so this adds no
  capability and no new way to reach one.
- `e2e/harness.ts` is the only file that names `PT_HARNESS`, as the plan asks.
- NFR 4 is reported from process creation rather than from `app.whenReady`, because reading
  `whenReady` would mean storing a timestamp in main for the harness to fetch -- the kind of test
  hook ADR-0004 exists to avoid. The difference is the Electron bootstrap, tens of milliseconds
  against a 3 000 ms budget.
- Followup not acted on: the renderer bundle is 1.48 MB (799 kB gzipped) and Vite warns about it.
  VexFlow is most of it. It costs startup, which NFR 4 has room for today; the release plan's
  install-size row (NFR 10) is where it will matter.
- Followup not acted on: `npm run test:e2e` runs `npm run build` first, so `npm run gate` builds
  even when nothing changed. It costs a couple of seconds.

### Phase 7 answers, at the instrument

Run on 2026-09-10 with the CK88 on USB, against `npm run dev` so the overlay was mounted.

1. **Port name and driver.** `CK Series-1` and `CK Series-2`; `CK Series-1` carries the keyboard.
   No Yamaha driver was installed. Both ports probed as openable.
2. **Four zones on their own channels.** *Not verified.* Every event of the session arrived on
   channel 1 (2 334 events checked in the recorded take), because the zones were not configured to
   transmit separately. The parser keeps the channel on every event and that is covered by
   `parse.test.ts`; what is unconfirmed is the instrument half.
3. **Pedals.** Sustain only -- the other two pedals are not connected to this instrument. Sustain
   works: 56 CC 64 events in the take, the indicator lights, and a chord held through a pedal
   release behaves as it sounds.
4. **Velocity range.** Spans the range but saturates too early at the top. Over 1 139 note-ons:
   min 1, p10 38, p50 61, p90 79, p99 89, max 94. Deliberate hammering reached 125 in a separate
   take. The shading is linear in `velocity / 127`, so an ordinary stroke tints to 48 % and the
   loudest real playing to 74 %. Followup below.
5. **NFR 1 for real.** p50 3.4 ms, p95 6.1 ms, max 12.1 ms over 500 note-ons. See Measurements.
6. **Latency by feel.** No visible trailing of the lit key behind the sound.
7. **Unplug and replug mid-session.** The port list recovers and the port reopens without
   restarting the app.
8. **A DAW holding the port.** No DAW is installed, so this was tested with a second process
   holding `CK Series-1` instead -- and it produced a finding rather than a pass. **A MIDI input
   port on this machine is not exclusive.** With one process holding the port open, a second
   process opened the same port successfully, and two independent readers held it at once. The
   ports view therefore keeps showing `Ready`, and the `busy` path never fires. Whether both
   readers actually receive the notes was not established: the two-reader run happened while
   nothing was being played, and both counted zero messages.

   This contradicts the platform note in `CLAUDE.md` ("Windows has no system-wide MIDI sharing.
   If a DAW holds the port, the app cannot open it"). Within a single process a second open of
   the same port does fail, which is probably where the belief came from. Followup below.
9. **Hardware beside the harness.** The two groups read as distinct.

### Close triggers

- **What shipped:** feature. The whole walking skeleton: the Electron shell, the MIDI pipeline,
  the live keyboard, staff and labels, take recording and replay, and the end-to-end gate.
- **User-visible docs touched:** `README.md` (status, the run/build/gate commands, and how to run
  with no instrument attached). `CLAUDE.md` and `docs/nfr.md` untouched.
- **Full gate at the last phase**, each run from the repository root on the development machine:
  - `npm run typecheck` - exit 0
  - `npm run lint` - exit 0
  - `npm test` - exit 0 (11 files, 263 tests)
  - `node scripts/check-pins.mjs` - exit 0
  - `node scripts/check-doc-links.mjs` - exit 0
  - `npm run test:e2e` - exit 0 (6 tests)
  - `npm run gate`, which is all six in that order - exit 0
- **Outstanding `human` phases:** none. Phase 7 ran on 2026-09-10; its answers are above. Two of
  its nine lines could not be checked on this machine (zones on separate channels, a DAW holding
  the port) and are recorded as not verified rather than as passes. Everything in it
- **Also for the architect:** ADR-0004's gate no longer matches the code, by a change the user
  authorised in session. See the first line of `### Notes`.

## Followups (after this lands)

- ~~**Velocity shading saturates too early.**~~ Raised at Phase 7, fixed in `5174bb8`: the
  keyboard now shades on a gamma curve fitted to the measured distribution instead of on
  `velocity / 127`.
- ~~**The live view shifts vertically as notes are added.**~~ Raised at Phase 7, fixed in
  `5174bb8`. It was the labels panel, not the staff: it grew by up to 60 px as rows appeared. Every
  row is now always rendered and none may wrap.
- **`CLAUDE.md`'s MIDI-sharing note is wrong, at least for this device.** Phase 7 item 8 found
  that two processes can hold `CK Series-1` open at the same time; the note says a port another
  application holds cannot be opened. Rewriting it needs one more observation -- whether both
  readers actually receive the notes, which needs someone playing during the test.
- **The `busy` port path has never fired.** It is implemented, probed on every poll, and covered
  by nothing: this instrument does not produce the condition. Either find a device or an
  application that does hold a port exclusively, or reconsider whether the probe earns the open
  and close it does on every poll.
- The `architect` review decides whether ADR-0001, ADR-0003 and ADR-0004 move to `accepted`.
  ADR-0004's evidence is Phase 6 going green with nothing attached and Phase 7 confirming that
  the real instrument still behaves.
- `CLAUDE.md`'s platform note on the Yamaha driver is rewritten from Phase 7's answer.
- One real recorded take is committed under `core/fixtures/takes/` after Phase 7 and the `core/`
  tests gain it alongside the generated scenarios, so the theory code sees human timing at least
  once (the generator-drift risk above).
