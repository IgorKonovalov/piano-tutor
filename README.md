# piano-tutor

A Windows desktop piano tutor for a Yamaha CK88 over USB MIDI. It shows what you play as you
play it, lets you practise a piece with per-bar feedback, plays a piece back to you through the
instrument, generates exercises, and on request asks an LLM coach what to work on. Everything but
the coach works offline. **The piano makes the sound.** The app sounds nothing the player presses;
it synthesises only what it is itself playing, and only when no instrument is listening
([ADR-0008](docs/adrs/0008-the-app-may-sound-what-it-plays-a-synthesised-fallback-voice-no-samples.md)).

**Status:** in build. The walking skeleton, the practice path and playback are in —
[Plan 0001](docs/plans/done/0001-the-keyboard-shows-on-screen.md) (the Electron shell, the MIDI
pipeline, the live keyboard, staff and labels, take recording and replay),
[Plan 0002](docs/plans/done/0002-a-piece-is-practised.md) (the score library, the aligner and the
per-bar report), [Plan 0008](docs/plans/done/0008-the-timing-model.md) (how a bar's timing is
judged) and [Plan 0004](docs/plans/done/0004-the-app-plays-the-piece.md) (the app plays the
piece), each measured at the CK88 on real repertoire. What is in flight and what comes next is in
[docs/plans/README.md](docs/plans/README.md).

## Where to start reading

| Want to know | Read |
|---|---|
| What the pieces are and the rules they follow | [CLAUDE.md](CLAUDE.md) |
| Why Electron, why MIDI lives in the main process | [ADR-0001](docs/adrs/0001-an-electron-shell-in-typescript-around-a-pure-music-core.md) |
| How the LLM coach reaches a model, and the terms-of-service caveat | [ADR-0002](docs/adrs/0002-the-coach-is-a-provider-behind-one-interface-and-the-first-provider-is-the-claude-cli.md) |
| Why two notation engines | [ADR-0003](docs/adrs/0003-two-notation-engines-vexflow-for-the-live-staff-and-osmd-for-the-score.md) |
| Why a score is parsed once, by the library that draws it | [ADR-0005](docs/adrs/0005-the-expected-note-timeline-is-extracted-from-osmds-model.md) |
| How the app plays a piece, and why the clock lives in main | [ADR-0007](docs/adrs/0007-playback-is-a-schedule-built-in-core-and-clocked-by-main-behind-a-midisink.md) |
| Why the app may now make a sound, and how little of one | [ADR-0008](docs/adrs/0008-the-app-may-sound-what-it-plays-a-synthesised-fallback-voice-no-samples.md) |
| The numbers behind "real-time" and "offline" | [docs/nfr.md](docs/nfr.md) |
| How the live pipeline was built, phase by phase | [Plan 0001](docs/plans/done/0001-the-keyboard-shows-on-screen.md) |
| What comes after | [docs/plans/README.md](docs/plans/README.md) |

## Decisions from the interview (2026-09-09)

| Question | Answer |
|---|---|
| Platform | Windows desktop app |
| Connection | USB primary, `MidiSource` seam kept abstract for adapters later. The CK88's Bluetooth is audio only, so Bluetooth MIDI is not a software option. |
| First-month features | Live display; practise against a score; exercises and drills; on-demand LLM coaching |
| Repertoire | Classical from sheet music; pop, jazz, chords and improvisation |
| LLM access | The user's Claude subscription, reached through the local Claude Code CLI, behind a provider interface with an API-key provider as the fallback (ADR-0002 records the caveat) |
| Stack | Electron + TypeScript; React renderer; pure `core/` for all musical logic |
| Displays | Standard staff, 88-key keyboard, chord and key labels |
| Data | Local files only |
| Coaching trigger | On demand after a take, never live |
| Score sources | MusicXML first-class; MIDI files second-class; built-in exercise generator |
| Build order | MIDI in and live display first |
| Workflow | Plan doc first, then decide |

## Running and building

Node 22 and npm 10. Windows.

```
npm ci            # install exactly the lockfile
npm run dev       # Vite + esbuild watchers + Electron, hot reload in the renderer
npm run build     # the three bundles into dist/
npm run package   # a portable zip through electron-builder
```

Two gate commands, and the difference is the end-to-end suite:

```
npm run gate:fast # typecheck, lint, unit tests, the two Node gates -- about 25 s
npm run gate      # all of that, then the end-to-end suite -- about 2.5 minutes
```

Both stop at the first failure. `gate:fast` is what runs after a change; the
full `npm run gate` is owed once per plan, at its last implementation phase and
again at the close
([ADR-0022](docs/adrs/0022-the-per-phase-gate-is-the-fast-gate-and-the-end-to-end-suite-is-owed-once-per-plan.md)).
The pieces individually:

```
npm run typecheck # tsc over all four tsconfigs
npm run lint      # eslint, including the process-boundary rules
npm test          # vitest
npm run test:e2e  # builds, then Playwright drives the app (opens windows)
node scripts/check-pins.mjs      # every dependency pinned exact (NFR 9)
node scripts/check-doc-links.mjs # every relative markdown link resolves
```

The end-to-end suite launches **four apps at once**, each with its own state
directory under the OS temp dir, so it touches neither your score library nor
your takes. The three cases that read a clock run alone afterwards. A single
spec file runs on its own with `npm run test:e2e -- e2e/player.spec.ts`.

The pre-push hook runs `gate:fast` only; the end-to-end step is slow and opens
windows. Run the full `npm run gate` before closing a plan.

Hot reload covers the renderer only. After a change under `electron/`, restart Electron; the
esbuild watchers rebuild the bundle but Electron does not reload it.

### Running with no instrument attached

The app can play itself. An unpackaged build (and any build started with `PT_HARNESS=1`) lists a
**Harness** group of virtual ports beside the hardware ones -- `virtual:c-major-scale`,
`virtual:ii-V-I-in-F`, `virtual:a-minor-arpeggios`, `virtual:dense-2000`. Opening one runs a
seeded generated passage through the identical parse, record and paint path a real instrument
uses, which is what makes every check above runnable with nothing plugged in
([ADR-0004](docs/adrs/0004-the-app-plays-itself-virtual-ports-not-an-injection-channel.md)). A
packaged build without that variable lists hardware only.

`PT_HARNESS` decides in both directions whenever it is set: `PT_HARNESS=0` hides the harness even
when running from source, which is how the end-to-end suite proves the gate is real.

A green run of those checks means the pipeline is intact. It does not mean the piano works: only a
human at the instrument says that.
[Plan 0001](docs/plans/done/0001-the-keyboard-shows-on-screen.md) Phase 7 is the checklist that did
it, and its answers — the port names, the real key-to-pixel figures, the velocity range — are in
that plan's implementation log.

### Scores

The **Score** view keeps a library of pieces. *Add a score...* opens a file dialog and accepts
`.musicxml`, `.xml` and `.mxl`, and also `.mid` and `.midi`; the file is copied verbatim into the
app's data folder under an id that is a hash of its bytes, so importing the same file twice is one
entry and a take can always be re-aligned against the exact bytes it was played against. Editing
the piece and re-importing makes a new entry rather than silently changing what an old take was
judged against.

Bars are indexed the way the file was parsed, starting at zero, which is not always the number
printed on the page -- an anacrusis is bar 0. The bar field above the score marks one, and
clicking a bar marks it too.

Ten well-known pieces can be fetched to practise against, into a gitignored `scores-local/`:

```
node scripts/fetch-scores.mjs --list   # what the subset is
node scripts/fetch-scores.mjs          # fetch anything missing
```

They are **never committed**. The source repository states no licence and the arrangements are
community uploads; the compositions chosen are public domain, but redistributing somebody's
arrangement is not this repository's to do. Import them with *Add a score...* like any other file.

**A MIDI file is a second-class score**
([ADR-0003](docs/adrs/0003-two-notation-engines-vexflow-for-the-live-staff-and-osmd-for-the-score.md)).
It carries no notation, so there is nothing to engrave: the view shows a bar grid instead of a
stave, with the same colouring, the same selection and the same bar detail. Onsets snap to a
sixteenth by default -- a file recorded from a performance has no grid of its own -- and the
setting is on screen rather than implied.

## Practising a piece

Open a score, choose what to play from, press *Practise*, and play it through. Nothing is judged
while you play. Press *Stop and show me* and the bars colour: green where you played what is
written, amber where the timing wandered, red where the notes did not match, and grey for the bars
you never reached. Clicking a bar says what happened in it, note by note.

The tempo is not given to you and not assumed. Each bar is judged against the tempo **the bars
around it** were keeping, so timing here is about evenness rather than about speed: playing the
whole piece evenly at half speed is playing it correctly, and the app says so. Going back over a
bar is said in words -- "you went back over bar 4" -- and the notes you played twice are not
counted as mistakes. Slowing into a cadence is described the same way, "you slowed 29% over bars
1 to 3", and never marked as an error; where the page prints a *rit.* over those bars the sentence
says so, and that is the only thing the page's expression is ever allowed to do to a verdict
([ADR-0021](docs/adrs/0021-expression-belongs-to-playback-scoring-only-describes-it.md)). The tempo
figure is the one you actually held, taken from the stretches where you were steady, so a false
start does not drag it.

An ornament costs nothing either way. A grace note, and a trill, turn or mordent sign, may be
played or left out and the bar reads the same, so learning the notes of a piece is not a run of red
bars for the decorations you have not got to yet
([ADR-0009](docs/adrs/0009-an-ornament-is-optional-a-grace-note-is-scored-neither-way.md)).

The *Timing* control says how fussy to be about it: *Let it breathe*, *Normal* or *Keep it
tight*. It changes only how many bars are called out -- the notes, the counts and the numbers
themselves are the same at every setting -- and it re-colours the take you have just played
without your having to play it again. It is not remembered between sessions yet.

With nothing plugged in, the *Play from* list includes generated performances of the fixture
pieces -- one with a deliberate wrong note in bar 3, one that goes back over bar 2, one that
slows to the end and one with a single hurried bar -- so the whole path can be watched end to end
without an instrument.

## Playing a piece back

The app can play a piece to you rather than only listen to you. Choose the CK88's **output** port
in the **Ports** view — its input and output halves open together, so it can listen and play at
the same time — and the Score view's transport gains a *Play*. It plays the bars you ask for
(*Whole piece* resets the range) **as the page is written**: its dynamics and hairpins, its
pedalling, its tempo marks and the *rit.* and *accel.* between them, its fermatas, its staccatos
and accents, and its ornament signs realised into the notes they stand for. Every one of those is
read from the engraver's own reading of the file rather than invented here
([ADR-0018](docs/adrs/0018-the-timeline-carries-the-marks-on-the-page.md)); where the page says
nothing, the app falls back to one velocity and a default tempo and still invents nothing. The
tempo box shows what the page asks for, and a tempo you set scales the whole piece against it
rather than flattening it, so a passage demonstrated slowly is still the same music. While it
plays, the keyboard and the staff light in a colour that is not yours, and the bar being sounded is
marked on the score.

A take plays back too, out of the **Takes** view, so a recorded performance can be heard on the
instrument that recorded it.

*Heard through* chooses where the sound comes from: **The instrument**, **This computer** or
**Nothing**. It defaults to the instrument whenever an output port is open and to the computer
when none is, so nothing is ever sounded twice a few milliseconds apart. The computer's voice is a
plain synthesised tone with no samples behind it and it does not pretend to be a piano; it exists
so the feature works on a machine with no piano attached
([ADR-0008](docs/adrs/0008-the-app-may-sound-what-it-plays-a-synthesised-fallback-voice-no-samples.md)).
Nothing the *player* presses is ever sounded by the app.

**Stop always stops.** Pressing stop, changing the output, starting a second run, closing the
window, quitting and an error inside the scheduler all send a note-off for everything sounding,
then All Notes Off and sustain-up on every channel touched. Measured at the CK88 on 2026-09-11,
including pulling the USB cable mid-chord: no stuck note in any of them. What is *not* recovered is
the replug — playback does not resume and the old port handle is dead; unplugging mid-piece means
choosing the output again.

With nothing plugged in, the generated passages in the **Harness** group play through the computer
as readily as a score does, which is how the whole path stays checkable without an instrument.

## Working in this repository

The repository runs a plan-driven harness adapted from the Ritmolux project: decisions as ADRs
in `docs/adrs/`, work as phased plans in `docs/plans/`, an `architect` lane that designs and a
`dev` lane that builds, a fresh-session review at each plan's close. The pre-commit rule that
matters most is enforced by a hook: stage files by explicit path, never `git add -A`.
