# piano-tutor

A Windows desktop piano tutor for a Yamaha CK88 over USB MIDI. It shows what you play as you
play it, lets you practise a piece with per-bar feedback, generates exercises, and on request
asks an LLM coach what to work on. Everything but the coach works offline. The piano makes the
sound; the app never does.

**Status:** scoped, not yet built. The first plan is drafted and waiting for a "go".

## Where to start reading

| Want to know | Read |
|---|---|
| What the pieces are and the rules they follow | [CLAUDE.md](CLAUDE.md) |
| Why Electron, why MIDI lives in the main process | [ADR-0001](docs/adrs/0001-an-electron-shell-in-typescript-around-a-pure-music-core.md) |
| How the LLM coach reaches a model, and the terms-of-service caveat | [ADR-0002](docs/adrs/0002-the-coach-is-a-provider-behind-one-interface-and-the-first-provider-is-the-claude-cli.md) |
| Why two notation engines | [ADR-0003](docs/adrs/0003-two-notation-engines-vexflow-for-the-live-staff-and-osmd-for-the-score.md) |
| The numbers behind "real-time" and "offline" | [docs/nfr.md](docs/nfr.md) |
| What gets built first, phase by phase | [Plan 0001](docs/plans/0001-the-keyboard-shows-on-screen.md) |
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

Not yet. Plan 0001 Phase 1 adds the npm project and writes this section.

## Working in this repository

The repository runs a plan-driven harness adapted from the Ritmolux project: decisions as ADRs
in `docs/adrs/`, work as phased plans in `docs/plans/`, an `architect` lane that designs and a
`dev` lane that builds, a fresh-session review at each plan's close. The pre-commit rule that
matters most is enforced by a hook: stage files by explicit path, never `git add -A`.
