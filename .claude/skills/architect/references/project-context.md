# Project context — architect's view

The source of truth for concrete facts about this repo. Trust `Glob` and `git` over it when they
disagree, and surface the drift.

## What the project is

A Windows desktop piano tutor for one player and a Yamaha CK88 connected over USB MIDI. It shows
what is being played as it is played (an 88-key keyboard, a VexFlow grand staff, chord and key
labels), lets the player practise a MusicXML or MIDI piece with per-bar feedback, generates
exercises, and on request hands a compressed `TakeSummary` of a recorded take to an LLM coach.
Everything but the coach's reply works offline. The instrument is the sound source; the app never
opens an audio device.

Founding decisions: ADR-0001 (Electron + TypeScript around a pure `core/`, MIDI owned by main),
ADR-0002 (the coach is a `CoachProvider`; `claude-cli` first, `anthropic-api` second, `none`
third), ADR-0003 (VexFlow draws what is held, OpenSheetMusicDisplay draws the score).

## Repo layout

One npm project at the root. Intended shape for orientation, not an inventory; trust `Glob` for
what exists today.

```
core/            # Pure TypeScript. No Electron, DOM or Node imports, ever.
  src/midi/      #   MidiEvent model, HeldNotes reducer (sustain semantics)
  src/theory/    #   spelling, chord detection (tonal), key estimation, staff layout
  src/score/     #   expected-note timeline from a score, alignment, per-bar statistics
  src/exercise/  #   the generator (seeded), scoring
  src/coach/     #   TakeSummary builder under the token budget
  fixtures/      #   chords.json, takes/*.jsonl, scores/*.musicxml
electron/        # Main process (esbuild -> dist/main/index.cjs)
  main.ts        #   lifecycle, CSP install, window, IPC registration
  window.ts      #   createWindow with the security defaults, installCsp (double CSP)
  midi/          #   MidiSource interface; RtMidiSource, ReplaySource; parse.ts (bytes -> MidiEvent)
  take/          #   Recorder (append-only JSON Lines under userData/takes/), takeFile.ts
  coach/         #   CoachProvider; claude-cli, anthropic-api, none; prompt.ts
  ipc/           #   <domain>Handlers.ts; every payload parsed with Zod on receive
  preload/       #   index.ts assembles window.api from api/<domain>.ts
renderer/        # React + Vite SPA (-> dist/renderer/). Never imports Node.
  views/         #   Live, Takes, Score, Exercises, Settings
  components/    #   Keyboard, LiveStaff, Labels, EventLog, LatencyOverlay, ... + .module.css each
  hooks/         #   useMidiEvents, ...
  styles.css     #   tokens
shared/          # ipc-channels.ts, midi.ts, take.ts, coach.ts (Zod schemas + inferred types)
scripts/         # Node gates: check-doc-links.mjs, check-pins.mjs
docs/            # nfr.md, adrs/, plans/, specs/
.githooks/       # pre-push (opt-in: git config core.hooksPath .githooks)
.claude/         # settings.json (the staging hook), hooks/, skills/architect, skills/dev
```

## The seams

Two interfaces are the project's extension points, and a change to either's shape is ADR-worthy:

- **`MidiSource`** (`electron/midi/MidiSource.ts`): `listPorts`, `open`, `close`, `onMessage`
  delivering raw bytes plus a main-side `performance.now()` stamp. Implementations: `RtMidiSource`
  (USB today), `ReplaySource` (takes). A DIN or Bluetooth adapter is a third implementation.
- **`CoachProvider`** (`electron/coach/CoachProvider.ts`): takes a `CoachRequest` (a
  `TakeSummary`, a question, a conversation id), returns a `CoachReply` validated against the
  schema in `shared/coach.ts`. Implementations: `claude-cli`, `anthropic-api`, `none`.

Domain IPC channels: `midi:*` (port list, one push channel carrying `MidiEvent`), `take:*`
(record, list, load, replay), `coach:*` (ask, reply). A fourth domain is a design decision.

## Canonical commands

Run from the repo root. Until Plan 0001 Phase 1 lands there is no `package.json` and none of the
`npm` rows apply.

| Task | Command |
|---|---|
| Install | `npm ci` |
| Run with hot reload | `npm run dev` |
| Build all three bundles | `npm run build` |
| Typecheck all four tsconfigs | `npm run typecheck` |
| Lint | `npm run lint` |
| Unit tests (core, electron, renderer) | `npm test` |
| End-to-end (Playwright, opens the app) | `npm run test:e2e` |
| One e2e spec file | `npm run test:e2e -- e2e/<name>.spec.ts` |
| The per-phase gate | `npm run gate:fast` |
| The full gate (last `dev` phase, close) | `npm run gate` |
| Doc links | `node scripts/check-doc-links.mjs` |
| Exact pins | `node scripts/check-pins.mjs` |
| Package a portable zip | `npm run package` |

**The per-phase gate** is `npm run gate:fast` (typecheck, lint, unit tests and the two Node
gates, about 25 s), plus each e2e spec file the phase's done-when names. **The whole end-to-end
suite is owed once per plan**, as `npm run gate`, at the last `dev` phase and again at the close
(ADR-0022). It opens windows and takes minutes, which is too slow for every phase and for a
pre-push hook.

## Non-functional requirements

`docs/nfr.md` holds the ten numbered rows. The ones every plan meets: 1 (30 ms key-to-pixel p95),
2 (zero event loss), 3 (offline, no `connect-src`), 7 (the coach summary under 4 000 tokens), 8
(a take survives a crash), 9 (exact pins). Plans cite rows by number; a done-when that
contradicts the file is a plan bug.

## Decisions on the record

The live, complete list is `docs/adrs/README.md`. This file does not enumerate ADRs.

## Plans in flight

`docs/plans/README.md` is the roster, the roadmap and the next free number. This file does not
enumerate plans.

## Ownership map

`architect` owns `docs/`. `dev` owns all code: `core/`, `electron/`, `renderer/`, `shared/`,
`scripts/`, the configs, the tests, the packaging. Phase owner vocabulary: `dev` and `human`.

## Platform realities

- **The CK88's Bluetooth is audio input only.** MIDI is USB-B "TO HOST" (class-compliant MIDI;
  Yamaha's driver is for the USB audio half) or 5-pin DIN through an interface. Bluetooth MIDI
  would need an external adapter on the DIN ports.
- **The CK88 has four zones**, each able to transmit on its own channel. Events keep their
  channel; the display merges by default.
- **RtMidi on Windows has no hot-plug callback.** The port list is polled.
- **A MIDI input port is not exclusive across processes, on this device.** Measured at the CK88
  (Plan 0001 Phase 7): two processes read the same port at once and both received the stream, so
  the app can run beside a DAW. A second open *within one process* does fail, which is where the
  belief comes from. The port list keeps a `busy` path and probes for it; on this instrument it
  has never fired.
- **`@julusian/midi` is N-API**, so one prebuilt binary serves the Node and Electron versions in
  use without `electron-rebuild`. If a prebuilt is missing for a new machine, ADR-0001
  Alternative B (Web MIDI in the renderer behind the same event shape) is the named fallback.
- **The Bash tool mangles heredocs and here-strings on this machine.** Files are written with the
  Write tool; multi-line commit messages go through the PowerShell tool's `@'...'@` here-string.
