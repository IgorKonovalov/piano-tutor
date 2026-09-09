# 0001 — The keyboard shows on screen

> **Status:** draft
> **Created:** 2026-09-09
> **Owner skill(s):** dev, human
> **Related ADRs:** [0001](../adrs/0001-an-electron-shell-in-typescript-around-a-pure-music-core.md) (proposed),
> [0003](../adrs/0003-two-notation-engines-vexflow-for-the-live-staff-and-osmd-for-the-score.md) (proposed);
> [0002](../adrs/0002-the-coach-is-a-provider-behind-one-interface-and-the-first-provider-is-the-claude-cli.md)
> is built on by Plan 0002, and Phase 5 here records the takes it will read
> **NFRs claimed:** 1, 2, 3, 4, 8, 9 in [nfr.md](../nfr.md)
> **Amended:** 2026-09-09 — the former Phase 0 (copy and adapt the skills) was done at scaffold
> time, before the plan started; removed rather than marked done

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
second code path. The last phase is the user at the instrument with a checklist.

We rejected Web MIDI in the renderer (ADR-0001 Alternative B) as the primary path, and we
rejected starting with the score view because it would put a week of OSMD work in front of the
first lit key.

## Architecture diagram

```mermaid
flowchart LR
    CK[CK88<br/>USB MIDI]
    subgraph main["main process"]
        MS[MidiSource<br/>RtMidiSource | ReplaySource]
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
    end
    CK --> MS --> PARSE --> REC
    PARSE -- midi:event --> API --> HELD
    HELD --> KB
    HELD --> SP --> ST
    HELD --> CH --> LB
    TK -- take:replay --> API -- take:* --> REC
    PARSE -.-> OV
```

## Implementation phases

Each phase ships as its own commit. `dev` runs Phases 1 to 5 in one session; the architect
reviews the whole plan once, in a fresh session, after Phase 6. The harness itself (the two
skills, the staging hook, `scripts/check-doc-links.mjs`, `scripts/check-pins.mjs` and the opt-in
pre-push hook) landed with the scaffold on 2026-09-09 and is not a phase here.

### Phase 1 — The shell opens and lists the ports
- **Owner skill:** dev
- **What:** The npm project exists per ADR-0001 and opens a window that lists the MIDI input
  ports Windows reports, refreshed every two seconds (RtMidi has no hot-plug event on Windows),
  with a one-line status when a port cannot be opened because another application holds it.
  The pre-push gate exists and runs the four checks.
- **Files touched:** `package.json`, `package-lock.json`, `tsconfig.*.json` (base, main, preload,
  renderer, core), `esbuild.main.mjs`, `esbuild.preload.mjs`, `vite.config.ts`,
  `eslint.config.mjs`, `.prettierrc.json`, `vitest.config.ts`, `playwright.config.ts`,
  `electron/main.ts`, `electron/window.ts` (CSP install, `createWindow`),
  `electron/midi/MidiSource.ts` (the interface), `electron/midi/RtMidiSource.ts` (`listPorts`
  only this phase), `electron/ipc/midiHandlers.ts`, `electron/preload/index.ts`,
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
- **Done when:** `npm run dev` opens a window listing the CK88's port by the name Windows gives
  it (recorded in the implementation log), the list updates within two seconds of unplugging and
  replugging, and with the port held by another program the row says so. `npm run typecheck`,
  `npm run lint`, `npm test` and the pins check are green, and the Playwright golden path opens
  the app and finds the ports view with zero or more rows without an error dialog. The renderer
  bundle makes no network request (NFR 3, checked by the e2e run with networking disabled).

### Phase 2 — The keys light up
- **Owner skill:** dev
- **What:** Main opens the selected port, stamps each message with `performance.now()` on
  arrival, parses it into a `MidiEvent`, and pushes it over `midi:event`. The renderer paints an
  88-key keyboard with pressed keys shaded by velocity, a sustain indicator, and a scrolling
  event log. A dev-only overlay measures arrival-to-paint latency and shows its distribution.
- **Files touched:** `electron/midi/RtMidiSource.ts` (`open`, `close`, `onMessage`),
  `electron/midi/parse.ts`, `electron/midi/parse.test.ts`, `electron/ipc/midiHandlers.ts`,
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
    shows the key, and shows p50, p95 and max over the last 500 events.
- **Done when:** NFR 1 is measured on the CK88 and the p95 and max are written into the
  implementation log; NFR 2's replay fixture (a recorded dense take of at least 2 000 events,
  committed under `core/fixtures/takes/`) reaches the renderer's log with no loss, counted by a
  test at the `MidiSource` seam; and a sustained chord held through a pedal release reads
  correctly on the keyboard.

### Phase 3 — The notes get names
- **Owner skill:** dev
- **What:** `core/` names what is held: key-aware pitch spelling, chord detection from the held
  set, and a key estimate over a sliding window of recent pitch classes. The renderer shows
  chord name, key, and Roman numeral of the chord in the key.
- **Files touched:** `core/src/theory/spelling.ts`, `core/src/theory/chords.ts`,
  `core/src/theory/key.ts`, their `.test.ts` files, `core/fixtures/chords.json`,
  `core/fixtures/keys/*.jsonl`, `renderer/components/Labels.tsx` + `.module.css`,
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
  chords, open voicings across two hands) names as the table says; fixture takes of a C major
  scale, an A minor arpeggio passage and a ii-V-I in F report those keys with confidence above
  the display threshold; and the labels update with the same latency budget as the keyboard
  (the overlay from Phase 2 is reused).

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
  splits across the staves as written, and the Phase 2 overlay's p95 with the staff mounted
  stays within NFR 1.

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
- **Done when:** a recorded take replays into the live view and the event log's sequence equals
  the file's; killing the main process mid-session (the test spawns and kills it) leaves a take
  that reads back with at most one second of events missing (NFR 8); the takes list shows
  duration, note count and port for each file; and the NFR 2 fixture take from Phase 2 is itself
  a valid take file.

### Phase 6 — At the instrument
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
  5. Latency by feel: does the lit key ever visibly trail the sound? Compare with the overlay's
     number.
  6. Unplug and replug mid-session: does the port list recover and can the port be reopened
     without a restart?
  7. Open a DAW holding the port first: does the app say so?
- **Done when:** every line has an answer in the log, and anything that failed is a followup
  row rather than a fix made in this phase.

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

## What this plan does NOT do

- **No grading, no score, no OSMD.** That is Plan 0003, on top of the takes this plan records.
- **No coach, no settings for an API key.** Plan 0002, on ADR-0002.
- **No exercises.** Plan 0004.
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

**Lane:** _(main checkout or worktree path and branch)_

| phase | owner | state | commit |
|---|---|---|---|
| 1 — The shell opens and lists the ports | dev | not started | |
| 2 — The keys light up | dev | not started | |
| 3 — The notes get names | dev | not started | |
| 4 — The staff draws what is held | dev | not started | |
| 5 — Every session is a take | dev | not started | |
| 6 — At the instrument | human | not started | |

### Measurements

- **NFR 1 (Phase 2, keyboard only):** p50 _ ms, p95 _ ms, max _ ms over 500 events.
- **NFR 1 (Phase 4, staff mounted):** p50 _ ms, p95 _ ms, max _ ms.
- **Windows port name (Phase 6):** _
- **Yamaha USB driver needed for MIDI (Phase 6):** yes / no

### Notes

_(deviations, unmet done-whens, followups noticed and not acted on; one line each)_

## Followups (after this lands)

- The `architect` review decides whether ADR-0001 and ADR-0003 move to `accepted`.
- `CLAUDE.md`'s platform note on the Yamaha driver is rewritten from Phase 6's answer.
