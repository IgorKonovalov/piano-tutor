# Plans index

The one-minute "what is in flight" view. Read this first each session instead of re-deriving
state from `git log`. Completed plans move to `done/`.

**Next free number: 0004** (ADRs are a separate sequence; next free there is **0006**.)

## Active roster

Each row carries at most two sentences of live constraint: what a reader needs to decide whether
to pick the plan up. The plan file carries everything else.

| Plan | Title | Status | Owner | Live constraint |
|------|-------|--------|-------|-----------------|
| [0001](0001-the-keyboard-shows-on-screen.md) | The keyboard shows on screen | draft | dev, human | ADR-0001, 0003, 0004. The walking skeleton every later plan stands on: MIDI in, keyboard, staff, labels, takes, and the synthetic source that lets everything after it be proved with nothing plugged in. **Phase 1 stops if the native MIDI binding will not install.** Phase 7 is the user at the CK88. |
| [0002](0002-a-piece-is-practised.md) | A piece is practised | draft | dev, human | ADR-0003, 0004, 0005. Score in, take aligned after the fact, bars coloured. Needs Plan 0001 Phases 1-6. Feedback is after the take, not live; repeats are not unfolded in v1. Phase 7 is a real piece at the piano and it is the only evidence the generator cannot supply. |
| [0003](0003-the-coach-speaks.md) | The coach speaks | draft | dev, human | ADR-0002 is its whole design. One-shot Analyse, replies saved beside the take, free-play and practised takes both summarised. Every `dev` phase runs on a recorded fixture reply and a stub binary, so it queues with no subscription; **Phase 2 is a spike against the real `claude` CLI** and Phase 6 is the only phase where a model actually answers. |

## Roadmap (agreed 2026-09-09 in the interview; numbers assigned when drafted)

In dependency order. Each gets its own interview before it is drafted.

**Reordered 2026-09-09:** the coach and the score swapped places. The coach's whole value is the
summary it sends, and the summary's most useful section is the per-bar practice report the score
plan produces — building the coach first meant writing a prompt against a thin summary and
rewriting it a plan later. The score plan is also entirely `dev`-ownable against generated takes,
where the coach carries a credential-shaped `human` phase.

1. **A piece is practised** — drafted as Plan [0002](0002-a-piece-is-practised.md).
2. **The coach speaks** — drafted as Plan [0003](0003-the-coach-speaks.md).
3. **Exercises with a score** — the generator in `core/` (scales, arpeggios, chord progressions,
   a sight-reading drill) emitting MusicXML so it rides Plan 0002's path; accuracy and evenness
   scoring; a history per exercise in a local SQLite file (the first time the app needs more than
   JSON Lines). The seeded generator of ADR-0004 is already half of this.
4. **The first release** — electron-builder zip, the native binary included, install size
   recorded (NFR 10), a READ-ME-FIRST for a second machine. **Verify both harness affordances are
   absent from the packaged build** — ADR-0004's virtual ports and Plan 0003's fixture coach
   provider; that check belongs in this plan's done-when.

**Not drafted yet, deliberately.** Plans 3 and 4 above wait on evidence rather than on time.
Exercises need a decision ADR-0005 just reopened — whether the generator emits MusicXML (heavy,
but engraved, which sight-reading needs) or an `ExpectedTimeline` directly (light, but nothing to
draw) — and the answer depends on how Plan 0002's adapter actually feels; it also needs an ADR for
SQLite, the first store that is not JSON Lines. The release plan is almost entirely claims about a
tree that does not exist yet, and it is the cheapest of all of these to write once it does.

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
