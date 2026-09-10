# piano-tutor

A Windows desktop piano tutor for a Yamaha CK88 over USB MIDI. It shows what you play as you
play it, lets you practise a piece with per-bar feedback, generates exercises, and on request
asks an LLM coach what to work on. Everything but the coach works offline. The piano makes the
sound; the app never does.

**Status:** in build. The walking skeleton is in —
[Plan 0001](docs/plans/done/0001-the-keyboard-shows-on-screen.md) closed on 2026-09-10 with the
Electron shell, the MIDI pipeline, the live keyboard, staff and labels, and take recording and
replay, all measured at the CK88. Next is
[Plan 0002](docs/plans/0002-a-piece-is-practised.md): a piece is practised.

## Where to start reading

| Want to know | Read |
|---|---|
| What the pieces are and the rules they follow | [CLAUDE.md](CLAUDE.md) |
| Why Electron, why MIDI lives in the main process | [ADR-0001](docs/adrs/0001-an-electron-shell-in-typescript-around-a-pure-music-core.md) |
| How the LLM coach reaches a model, and the terms-of-service caveat | [ADR-0002](docs/adrs/0002-the-coach-is-a-provider-behind-one-interface-and-the-first-provider-is-the-claude-cli.md) |
| Why two notation engines | [ADR-0003](docs/adrs/0003-two-notation-engines-vexflow-for-the-live-staff-and-osmd-for-the-score.md) |
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

One command runs everything:

```
npm run gate
```

That is typecheck, lint, unit tests, the two Node gates and the end-to-end run,
in that order, stopping at the first failure. The pieces individually:

```
npm run typecheck # tsc over all four tsconfigs
npm run lint      # eslint, including the process-boundary rules
npm test          # vitest
npm run test:e2e  # builds, then Playwright drives the app (opens a window)
node scripts/check-pins.mjs      # every dependency pinned exact (NFR 9)
node scripts/check-doc-links.mjs # every relative markdown link resolves
```

The pre-push hook runs everything except the end-to-end step, which is slow and
opens a window. Run `npm run gate` before closing a plan.

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

## Working in this repository

The repository runs a plan-driven harness adapted from the Ritmolux project: decisions as ADRs
in `docs/adrs/`, work as phased plans in `docs/plans/`, an `architect` lane that designs and a
`dev` lane that builds, a fresh-session review at each plan's close. The pre-commit rule that
matters most is enforced by a hook: stage files by explicit path, never `git add -A`.
