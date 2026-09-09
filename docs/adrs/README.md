# Architecture Decision Records

Numbered, append-only records of decisions that have a rejected alternative worth
remembering. Accepted ADRs are never edited in place: to change a decision, write a new ADR that
supersedes the old one and update the status here.

Rule of thumb: if you cannot name an option you are *not* taking, you do not need an ADR, you
need a code comment.

**Next free number: 0004.**

An index row is a pointer, not an abstract: the link, the title as the ADR's `H1` writes it, and
the status.

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-an-electron-shell-in-typescript-around-a-pure-music-core.md) | An Electron shell in TypeScript around a pure music core, with MIDI owned by the main process | proposed |
| [0002](0002-the-coach-is-a-provider-behind-one-interface-and-the-first-provider-is-the-claude-cli.md) | The coach is a provider behind one interface, and the first provider is the local Claude Code CLI | proposed |
| [0003](0003-two-notation-engines-vexflow-for-the-live-staff-and-osmd-for-the-score.md) | Two notation surfaces: VexFlow draws what is being played, OpenSheetMusicDisplay draws the score | proposed |

## Conventions

- Filename `NNNN-<slug>.md`; the slug is the title in kebab case, shortened where it runs long.
- Template: `Status`, `Date`, `Related plan(s)` header block; `Context`, `Decision`,
  `Consequences` (Positive / Negative / Neutral), `Alternatives considered`, `Notes`.
- Status moves from `proposed` to `accepted` when the user says so, usually when the first plan
  built on it closes.
