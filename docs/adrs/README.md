# Architecture Decision Records

Numbered, append-only records of decisions that have a rejected alternative worth
remembering. Accepted ADRs are never edited in place: to change a decision, write a new ADR that
supersedes the old one and update the status here.

Rule of thumb: if you cannot name an option you are *not* taking, you do not need an ADR, you
need a code comment.

**Next free number: 0015.**

An index row is a pointer, not an abstract: the link, the title as the ADR's `H1` writes it, and
the status.

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-an-electron-shell-in-typescript-around-a-pure-music-core.md) | An Electron shell in TypeScript around a pure music core, with MIDI owned by the main process | accepted 2026-09-10 |
| [0002](0002-the-coach-is-a-provider-behind-one-interface-and-the-first-provider-is-the-claude-cli.md) | The coach is a provider behind one interface, and the first provider is the local Claude Code CLI | proposed |
| [0003](0003-two-notation-engines-vexflow-for-the-live-staff-and-osmd-for-the-score.md) | Two notation surfaces: VexFlow draws what is being played, OpenSheetMusicDisplay draws the score | accepted 2026-09-10 |
| [0004](0004-the-app-plays-itself-virtual-ports-not-an-injection-channel.md) | The app plays itself: a synthetic MidiSource behind virtual ports, not an injection channel | accepted 2026-09-10 |
| [0005](0005-the-expected-note-timeline-is-extracted-from-osmds-model.md) | The expected-note timeline is extracted from OSMD's model, never parsed a second time | accepted 2026-09-10 |
| [0006](0006-listing-ports-does-not-touch-the-device.md) | Listing ports does not touch the device; `busy` is earned by a failed open | accepted 2026-09-10 |
| [0007](0007-playback-is-a-schedule-built-in-core-and-clocked-by-main-behind-a-midisink.md) | Playback is a schedule built in `core/` and clocked by main behind a `MidiSink` | proposed |
| [0008](0008-the-app-may-sound-what-it-plays-a-synthesised-fallback-voice-no-samples.md) | The app may sound what it plays: a synthesised fallback voice, and no samples | proposed |
| [0009](0009-an-ornament-is-optional-a-grace-note-is-scored-neither-way.md) | An ornament is optional: a grace note is scored neither way | accepted 2026-09-10 |
| [0010](0010-alignment-ends-where-the-player-stopped-an-unplayed-tail-is-free.md) | Alignment ends where the player stopped: an unplayed tail is free | proposed |
| [0011](0011-an-attempt-is-a-take-the-loop-repeats-through-the-recorder.md) | An attempt is a take: the practice loop repeats through the recorder, not through the aligner | proposed |
| [0012](0012-the-metronome-is-a-shared-grid-and-the-timing-reference-when-it-runs.md) | The metronome is a grid both processes schedule from, and the timing reference whenever it runs | proposed |
| [0013](0013-what-you-played-is-drawn-over-the-engraving-never-into-it.md) | What you played is drawn over the engraving, never into it | proposed |
| [0014](0014-timing-is-judged-against-a-local-tempo-not-one-line-through-the-take.md) | Timing is judged against a local tempo, not one line through the take | accepted 2026-09-10 |

## Conventions

- Filename `NNNN-<slug>.md`; the slug is the title in kebab case, shortened where it runs long.
- Template: `Status`, `Date`, `Related plan(s)` header block; `Context`, `Decision`,
  `Consequences` (Positive / Negative / Neutral), `Alternatives considered`, `Notes`.
- Status moves from `proposed` to `accepted` when the user says so, usually when the first plan
  built on it closes.
