# Plans index

The one-minute "what is in flight" view. Read this first each session instead of re-deriving
state from `git log`. Completed plans move to `done/`.

**Next free number: 0003** (ADRs are a separate sequence; next free there is **0006**.)

## Active roster

Each row carries at most two sentences of live constraint: what a reader needs to decide whether
to pick the plan up. The plan file carries everything else.

| Plan | Title | Status | Owner | Live constraint |
|------|-------|--------|-------|-----------------|
| [0001](0001-the-keyboard-shows-on-screen.md) | The keyboard shows on screen | draft | dev, human | ADR-0001, 0003, 0004. The walking skeleton every later plan stands on: MIDI in, keyboard, staff, labels, takes, and the synthetic source that lets everything after it be proved with nothing plugged in. **Phase 1 stops if the native MIDI binding will not install.** Phase 7 is the user at the CK88. |
| [0002](0002-a-piece-is-practised.md) | A piece is practised | draft | dev, human | ADR-0003, 0004, 0005. Score in, take aligned after the fact, bars coloured. Needs Plan 0001 Phases 1-6. Feedback is after the take, not live; repeats are not unfolded in v1. Phase 7 is a real piece at the piano and it is the only evidence the generator cannot supply. |

## Roadmap (agreed 2026-09-09 in the interview; numbers assigned when drafted)

In dependency order. Each gets its own interview before it is drafted.

**Reordered 2026-09-09:** the coach and the score swapped places. The coach's whole value is the
summary it sends, and the summary's most useful section is the per-bar practice report the score
plan produces — building the coach first meant writing a prompt against a thin summary and
rewriting it a plan later. The score plan is also entirely `dev`-ownable against generated takes,
where the coach carries a credential-shaped `human` phase.

1. **A piece is practised** — drafted as Plan [0002](0002-a-piece-is-practised.md).
2. **The coach speaks** — ADR-0002. `CoachProvider` in main, the `claude-cli` provider first, a
   `TakeSummary` from `core/` under NFR 7 built from Plan 0002's `PracticeReport`, the Analyse
   button and a reply panel on the takes view, a settings view with the provider choice and the
   API-key field. Starts with a spike that fixes the exact CLI flags. Needs Plan 0001 Phase 5
   (takes) and reads Plan 0002's report. **Carries a `human` phase** — whether the `claude` CLI
   on this machine is logged in, and pasting an API key, are things only the user can settle, so
   an unattended run defers them and the plan waits to close.
3. **Exercises with a score** — the generator in `core/` (scales, arpeggios, chord progressions,
   a sight-reading drill) emitting MusicXML so it rides Plan 0002's path; accuracy and evenness
   scoring; a history per exercise in a local SQLite file (the first time the app needs more than
   JSON Lines). The seeded generator of ADR-0004 is already half of this.
4. **The first release** — electron-builder zip, the native binary included, install size
   recorded (NFR 10), a READ-ME-FIRST for a second machine. **Verify the virtual ports of
   ADR-0004 are absent from the packaged build**; that check belongs in this plan's done-when.

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
