# Plans index

The one-minute "what is in flight" view. Read this first each session instead of re-deriving
state from `git log`. Completed plans move to `done/`.

**Next free number: 0002** (ADRs are a separate sequence; next free there is **0004**.)

## Active roster

Each row carries at most two sentences of live constraint: what a reader needs to decide whether
to pick the plan up. The plan file carries everything else.

| Plan | Title | Status | Owner | Live constraint |
|------|-------|--------|-------|-----------------|
| [0001](0001-the-keyboard-shows-on-screen.md) | The keyboard shows on screen | draft | dev, human | ADR-0001 + ADR-0003. The walking skeleton every later plan stands on: MIDI in, keyboard, staff, labels, takes. **Phase 1 stops if the native MIDI binding will not install.** Phase 6 is the user at the CK88. |

## Roadmap (agreed 2026-09-09 in the interview; numbers assigned when drafted)

In dependency order. Each gets its own interview before it is drafted.

1. **The coach speaks** — ADR-0002. `CoachProvider` in main, the `claude-cli` provider first, a
   `TakeSummary` from `core/` under NFR 7, the Analyse button and a reply panel on the takes
   view, a settings view with the provider choice and the API-key field. Starts with a spike that
   fixes the exact CLI flags. Needs Plan 0001 Phase 5 (takes).
2. **A piece is practised** — ADR-0003. OSMD renders a MusicXML file, `core/` derives the
   expected-note timeline from OSMD's model, alignment of a take against the timeline (tempo-free
   dynamic alignment first, metronome mode second), per-bar colouring, wrong-note and timing
   statistics on the takes view, MIDI files as second-class input via `@tonejs/midi`. The
   `TakeSummary` grows the per-bar section the coach needs most.
3. **Exercises with a score** — the generator in `core/` (scales, arpeggios, chord progressions,
   a sight-reading drill) emitting MusicXML so it rides the Plan 0003 path; accuracy and
   evenness scoring; a history per exercise in a local SQLite file (the first time the app needs
   more than JSON Lines).
4. **The first release** — electron-builder zip, the native binary included, install size
   recorded (NFR 10), a READ-ME-FIRST for a second machine.

Later, each needing its own interview: MIDI out to demonstrate a passage through the CK88; a
Bluetooth or DIN adapter as a second `MidiSource`; MIDI-to-notation transcription (ADR-0003
Alternative C); a tablet port of the renderer.

## Conventions

- Filename `NNNN-<slug>.md`. Header block: `Status`, `Created`, `Owner skill(s)`, `Related
  ADRs`, `NFRs claimed`. Sections: TL;DR, Context & problem, Decision, Architecture diagram,
  Implementation phases, Data shapes, Risks & open questions, What this plan does NOT do,
  Implementation log, Followups.
- Every phase carries exactly one `**Owner skill:**` line, `dev` or `human`, a file list, and a
  done-when that is checkable. A done-when that claims speed names the NFR row.
- `dev` edits only the `Status:` line and the implementation log. The review at close is a fresh
  `architect` session; the plan then moves to `done/` and leaves this roster.
