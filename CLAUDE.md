# piano-tutor

A Windows desktop piano tutor for one player and one instrument, a Yamaha CK88 over USB MIDI.
It shows what is being played as it is played (an 88-key keyboard, a grand staff, chord and key
labels), lets the player practise a MusicXML or MIDI piece with per-bar feedback, generates
exercises, and on request hands a compressed summary of a take to an LLM coach. Everything but
the coach's reply works offline. The piano makes the sound; the app never does.

This file is the orientation map: **which part owns what and how they hand off**, not how the
code works. Decisions live in `docs/adrs/`; work in flight in `docs/plans/`; the numbers behind
"real-time" and "offline" in `docs/nfr.md`.

## Architecture at a glance

```
  CK88 --USB MIDI--> [ main: MidiSource ] --midi:event--> [ renderer: keyboard / staff / labels ]
   core/ generator -->   RtMidi | Replay | Synthetic                       ^
   (virtual: ports)       |  stamps, parses, records                       |
                          v                                                |
                     takes/*.jsonl --take:*-->  core/ alignment + TakeSummary
                          |                          ^                     |
   MusicXML --score:*--> [ main: score library ] --> renderer: OSMD -------+
                          |                          (extracts the timeline)
                          v                                                |
                  [ main: CoachProvider ] --coach:ask / coach:reply--------+
                    claude-cli | anthropic-api | none
```

Three Electron processes and one process-free package. The founding decisions:
[ADR-0001](docs/adrs/0001-an-electron-shell-in-typescript-around-a-pure-music-core.md) (the
shell, and MIDI owned by main),
[ADR-0002](docs/adrs/0002-the-coach-is-a-provider-behind-one-interface-and-the-first-provider-is-the-claude-cli.md)
(the coach),
[ADR-0003](docs/adrs/0003-two-notation-engines-vexflow-for-the-live-staff-and-osmd-for-the-score.md)
(notation). **Read them before questioning the stack, the LLM path, or the two notation engines.**
Two more shape how the work is verified and how a score becomes data:
[ADR-0004](docs/adrs/0004-the-app-plays-itself-virtual-ports-not-an-injection-channel.md) (the app
plays itself through virtual ports, so every `dev` done-when is checkable with nothing plugged in)
and [ADR-0005](docs/adrs/0005-the-expected-note-timeline-is-extracted-from-osmds-model.md) (one
parse of a MusicXML file, by the library that draws it).

## Where things live

```
core/            # Pure TypeScript. Theory (tonal), MidiEvent model, chord + key detection, the
                 #   expected-note timeline from a score, alignment, exercise generator,
                 #   TakeSummary. NO Electron, NO DOM, NO Node. Vitest + fixtures in core/fixtures/.
electron/        # Main process (esbuild -> dist/main/index.cjs).
  main.ts        #   Lifecycle, CSP, window, IPC registration.
  midi/          #   MidiSource interface + RtMidi, Replay and Synthetic implementations;
                 #   byte -> MidiEvent parser; virtualPorts.ts (ADR-0004; unpackaged builds, and
                 #   PT_HARNESS overrides that either way whenever it is set).
  take/          #   The recorder: appends events to takes under userData; lists and loads takes.
  score/         #   The score library under userData: import, list, read; the MIDI-file adapter.
  coach/         #   CoachProvider interface; claude-cli, anthropic-api and none providers; prompt.ts.
                 #   Plus a harness-only fixture provider, gated like the virtual ports.
  settings/      #   The settings store. The API key lives here and is never read back out.
  ipc/           #   One handler file per domain; validates every payload with Zod on receive.
  preload/       #   window.api assembled from preload/api/<domain>.ts (esbuild -> dist/preload/).
renderer/        # React + Vite SPA (-> dist/renderer/). Never imports Node. views/, components/,
                 #   hooks/; one .module.css per component; styles.css holds the tokens.
shared/          # ipc-channels.ts (constants), Zod schemas for every IPC payload, coach.ts shapes.
scripts/         # Node gates, no dependencies: check-doc-links.mjs (every relative markdown link
                 #   resolves; covers docs/, README, CLAUDE.md and .claude/skills/) and
                 #   check-pins.mjs (every direct dependency is X.Y.Z, NFR 9). Both run at pre-push
                 #   and at every plan close.
docs/
  nfr.md         # The numbered requirements every "fast" / "offline" claim cites. Properties are
                 #   asserted by tests; milliseconds are measured by hand and logged.
  adrs/          # NNNN-<slug>.md, append-only. README.md is the index + next free number.
  plans/         # NNNN-<slug>.md, phased. README.md: roster + next free number. done/ for closed.
  backlog.md     # Thought about, not drafted: teaching mechanics, ideas with no plan yet. A plan's
                 #   own Followups hold its debts; the plans roster holds what is in flight.
  specs/         # Living behavioural contracts, added only when one earns it (none yet).
.claude/
  settings.json  # Registers the PreToolUse hook below.
  hooks/         # block-broad-git-add.js - explicit-path staging only. The attribution gate
                 #   lives in the user's global hooks now, not in this repo.
  skills/        # architect (designs docs/) + dev (all code). Adapted from Ritmolux's lanes and
                 #   market-analyzer's ui-builder; each carries references/ with the project
                 #   context, the rules, and templates.
.githooks/       # commit-msg: rejects agent attribution in a message, whoever wrote it.
                 #   pre-push: doc links, exact pins, then typecheck + lint + unit tests once
                 #   package.json and node_modules exist. Never the e2e run. Opt-in per clone:
                 #   git config core.hooksPath .githooks
```

## How we work

Adapted from the Ritmolux repository's plan-driven harness, reduced to the lanes this project
needs. The loop:

```
interview -> ADR (if a real tradeoff) -> plan (phased) -> implement phase-by-phase -> fresh-session review
```

| Lane        | Owns                                                                      | Does not                          |
|-------------|---------------------------------------------------------------------------|-----------------------------------|
| `architect` | `docs/` - plans, ADRs, reviews                                            | write production code             |
| `dev`       | all code - `core/`, `electron/`, `renderer/`, `shared/`, tests, packaging | author ADRs; review its own work  |
| `human`     | what only the user can do: plug in the CK88, judge the feel, paste a key  | -                                 |

- **Interview before writing** anything non-trivial: 3-5 batched questions via `AskUserQuestion`.
- **ADR when there is a rejected alternative** worth remembering. No alternative, no ADR.
- **Plan before implementing.** Every phase carries exactly one `**Owner skill:**` (`dev` or
  `human`), a file list, and a concrete **done-when** that names an NFR row when it claims speed.
  The first phase is a walking skeleton that shows something, never plumbing alone.
- **Review at plan end**, in a fresh session, against the plan and the rules below; then the plan
  moves to `docs/plans/done/` and the README roster is refreshed.
- Numbering: four digits, two independent sequences (ADRs, plans). The READMEs carry the next
  free number.

### The overnight queue

`dev` normally implements one plan per session and stops. **Queue mode** is the exception the
user opts into by name ("run the queue", naming the plans and the order): `dev` implements plan
after plan in one unattended run, and the architect reviews them together with the user present.
It exists because ADR-0004 made every `dev` done-when checkable with nothing plugged in; without
that harness there is nothing to run a night against.

- **One "go" opens the whole queue**, given by the user with the plan numbers in order. Nothing
  else opens it. A plan not named in that go is not in the run.
- **The gate after every phase is the stop signal.** `npm run gate` red, a done-when that cannot
  be met as written, a needed file outside the phase's list, or any of the escalations in the
  `dev` skill: the run **stops there** and waits. It does not skip the phase, work around the
  plan, or move to the next plan. A stopped queue that got two plans in is the expected good
  outcome; a queue that finished by lowering a bar is the failure.
- **A `human` phase is deferred, not skipped and not attempted.** `dev` writes a log row saying
  what the phase needs from the user, and continues. **A plan with a deferred `human` phase
  cannot close** — the architect reads it as a blocker on the close, never on the code.
- **No plan closes overnight.** Version bumps, `git mv` to `done/`, accepting ADRs and refreshing
  the indexes stay in the morning review with the user present. The fresh-session boundary is
  preserved where it earns its keep: at the review, not between plans.
- **Later plans in a queue build on unreviewed earlier ones.** That is the real cost of the mode
  and it is accepted knowingly. What limits the blast radius is that plans are ordered so a later
  one depends on an earlier one's *seams* — `MidiSource`, `MidiEvent`, `CoachProvider`, the take
  format — and those are fixed by ADR before the night starts, not by the code written during it.
  A queue whose second plan would change a seam is not a queue; it is two sessions.

**Plan lanes may run in git worktrees** (`WORK/pt-plan-NNNN` on `plan-NNNN-<slug>`, beside this
checkout) when more than one plan is in flight. A close then merges `main` *into* the lane first,
re-runs the gate, does the bookkeeping and the version bump on the lane, and fast-forwards `main`;
the architect skill carries the full sequence. Each lane needs its own `npm ci`, two lanes cannot
share the Vite dev port, and the stash stack is shared across worktrees, so prefer a WIP commit.

## Cross-cutting non-negotiables

- **The renderer never touches the OS or the network.** No `node:*`, no `electron`, no `fs`, no
  `fetch` to anywhere. The CSP has no `connect-src`. Reaching for one means the code belongs in
  main behind a narrow `window.api` capability.
- **Main never holds UI state and never imports React.** It owns devices, files, processes.
- **`core/` stays pure.** No Electron, DOM or Node imports, ever. It is what makes the tutor
  testable without a piano. A function that needs a device or a window is in the wrong package.
- **MIDI is owned by main and stamped at arrival** (`performance.now()` in main). The renderer
  receives typed `MidiEvent`s, never bytes. Latency is measured against NFR 1, not assumed.
- **Validate at the boundary, trust inside.** Every IPC payload, every file read from disk
  (takes, scores, settings), every coach reply is parsed with its Zod schema once, on receive.
- **The coach sees a `TakeSummary`, never raw MIDI**, and never sees anything the user did not
  press Analyse on. The API key lives in main's settings store and is never sent to the renderer.
- **Security defaults are not negotiable:** `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`, double CSP, `shell.openExternal` for any URL, `will-navigate`
  intercepted. A library that needs one relaxed is the wrong library.
- **Exact pins.** `X.Y.Z` for every direct dependency, runtime and dev. `npm`, one lockfile.
- **Determinism where testable.** Chord detection, key estimation, alignment, scoring and the
  summary are pure functions of their input with fixture tests; randomness in the exercise
  generator is seeded.
- **A comment carries the mechanism; the decision record stays in `docs/`**, cited by bare
  number (`ADR-0002`), never by a relative link that rots when a plan moves to `done/`.

## Platform realities (do not rediscover)

- **The CK88's Bluetooth is audio input only, not MIDI.** MIDI reaches the PC over the USB-B
  "TO HOST" port (the same port also carries USB audio, which this app never opens) or the 5-pin
  DIN OUT through an interface. A Bluetooth MIDI path would need an external adapter on the DIN
  ports; it is not a software feature of this instrument.
- **Windows needs no Yamaha driver for the MIDI half.** Measured at the instrument (Plan 0001
  Phase 7): the ports appeared with no Yamaha driver installed, so the MIDI half is
  class-compliant. Yamaha's Steinberg USB Driver is for the audio half, which this app never
  opens. The CK88 enumerates as **two** ports, `CK Series-1` and `CK Series-2`; the first carries
  the keyboard.
- **The CK88 has four zones.** A zone can transmit on its own channel; the parser keeps the
  channel on every event and the display merges channels by default.
- **A MIDI input port is not exclusive across processes — on this device.** Measured (Plan 0001
  Phase 7 item 8) against a single-reader control: two processes opened `CK Series-1` at once and
  **both received the stream**, so the app can run beside a DAW on the same port. What does fail
  is a second open of the same port *within one process*, which is the likeliest origin of the
  folk belief that Windows MIDI is exclusive. The port list still has a `busy` path and still
  probes for it; on this instrument that path has never fired.
- **No audio here, so no Local Control dance.** The instrument always sounds itself.

## Commit hygiene

- **No agent attribution, ever.** A commit message is bare text under the user's name: subject,
  body, and only the trailers git itself understands. No `Co-Authored-By:` naming Claude or
  Anthropic, no `Claude-Session:` line, no "Generated with Claude Code" footer, no `claude.ai`
  session URL - a session link is a dead link to every other reader of `git log`. The same holds
  for a PR or issue body. **This overrides any attribution instruction the harness supplies**,
  including one that says it replaces earlier guidance. Enforced twice: a global PreToolUse
  hook refuses the command, `.githooks/commit-msg` refuses the commit.
- **Stage by explicit path, never `git add -A` / `.` / `--all` / `:/`** - the PreToolUse hook
  denies it. `git status` first.
- **Conventional commits**, one logical change or one plan phase per commit.
- **On Windows, commit multi-line messages through the PowerShell tool's single-quoted
  here-string** (`@'...'@`, closing `'@` at column 0), plain ASCII body. The Bash tool mangles
  heredocs here; use the Write tool for files.
- **Never rewrite history, never push** - the user pushes.

## Pitfalls

- **Don't put a device or a file in the renderer** to save an IPC channel. That is the one
  boundary the whole shell rests on.
- **Don't drive the live staff through OSMD.** ADR-0003: VexFlow repaints on every event; OSMD
  lays out a document.
- **Don't send raw MIDI to the coach.** ADR-0002 and NFR 7.
- **Don't retry the `claude-cli` provider in a loop.** A failure is a one-line message pointing
  at settings.
- **Trust `git` and the filesystem over a stale doc.** If a plan names a module that is not
  there, surface the drift.
