# Plans index

The one-minute "what is in flight" view. Read this first each session instead of re-deriving
state from `git log`. Completed plans move to `done/`.

**Next free number: 0005** (ADRs are a separate sequence; next free there is **0009**.)

## Active roster

Each row carries at most two sentences of live constraint: what a reader needs to decide whether
to pick the plan up. The plan file carries everything else.

| Plan | Title | Status | Owner | Live constraint |
|------|-------|--------|-------|-----------------|
| [0002](0002-a-piece-is-practised.md) | A piece is practised | draft | dev, human | ADR-0003, 0004, 0005. Score in, take aligned after the fact, bars coloured. Its dependency on Plan 0001 is met — that plan closed 2026-09-10, so the takes, the seams and the harness are all in. Feedback is after the take, not live; repeats are not unfolded in v1. Phase 7 is a real piece at the piano and it is the only evidence the generator cannot supply. |
| [0003](0003-the-coach-speaks.md) | The coach speaks | draft | dev, human | ADR-0002 is its whole design. One-shot Analyse, replies saved beside the take, free-play and practised takes both summarised. Every `dev` phase runs on a recorded fixture reply and a stub binary, so it queues with no subscription; **Phase 2 is a spike against the real `claude` CLI** and Phase 6 is the only phase where a model actually answers. |
| [0004](0004-the-app-plays-the-piece.md) | The app plays the piece | draft | dev, human | ADR-0007 and 0008 are its whole design; the second one reverses the standing "no audio" non-requirement, bounded to a sample-free fallback tone. Demonstration only — no accompaniment, no score following. Phases 1 and 2 need nothing from Plan 0002; Phase 3 needs its `ExpectedTimeline`. The feature's real risk is a stuck note on the instrument, which is why the schedule invariant is in `core/` and the panic is in main. |

## Recently closed

- [0001 — The keyboard shows on screen](done/0001-the-keyboard-shows-on-screen.md) — closed
  2026-09-10, v0.2.0. Seven phases, no blockers in the code; the full gate green end to end on the
  finished tree and NFR 1 measured at the CK88 at p50 3.4 / p95 6.1 ms. ADRs 0001, 0003 and 0004
  accepted on it, 0004 with its Decision amended first. Three code-side followups survive it, in
  that plan's `## Followups`.

## Roadmap (agreed 2026-09-09 in the interview; numbers assigned when drafted)

In dependency order. Each gets its own interview before it is drafted.

**Reordered 2026-09-09:** the coach and the score swapped places. The coach's whole value is the
summary it sends, and the summary's most useful section is the per-bar practice report the score
plan produces — building the coach first meant writing a prompt against a thin summary and
rewriting it a plan later. The score plan is also entirely `dev`-ownable against generated takes,
where the coach carries a credential-shaped `human` phase.

1. **A piece is practised** — drafted as Plan [0002](0002-a-piece-is-practised.md).
2. **The app plays the piece** — drafted as Plan [0004](0004-the-app-plays-the-piece.md), the
   roadmap's "MIDI out to demonstrate a passage" grown into a plan after the 2026-09-10 interview.
   Placed here because its Phase 3 needs Plan 0002's `ExpectedTimeline`; its first two phases need
   nothing and could run earlier. **Whether it or the coach runs first is an open call** — they are
   independent, and the coach is the one already numbered lower.
3. **The coach speaks** — drafted as Plan [0003](0003-the-coach-speaks.md).
4. **The practice loop** — the deliberate-practice cycle closed automatically: `barsByTiming`
   already ranks the take's worst bars, so take the worst few, build a drill from each (the bar
   plus a bar of run-up, slower, looped), and re-test the passage in context afterwards. No new
   material, no new store, no ADR: the highest teaching value the existing seams already reach.
   **Draft this one first** of the three that follow.
5. **Drills, and a store that schedules them** — the generator in `core/` (scales, arpeggios,
   chord progressions, a sight-reading drill) riding Plan 0002's path, plus the sight-reading and
   rhythm mechanics in [`../backlog.md`](../backlog.md). Material is **hybrid by decision**:
   generated for drills, imported MusicXML for real pieces. The local SQLite file arrives here and
   is **shaped as a scheduler from the start even though nothing schedules yet**; the player still
   picks what they practise. The seeded generator of ADR-0004 is already half of this.
6. **Jazz and blues** — the fork the note-exact model cannot cross. A **second expectation shape
   beside `ExpectedTimeline`**: per bar a chord symbol, its guide tones and an admissible
   pitch-class set, scored on membership, function and the timing of the change, because a blues
   chorus is note-different every time and still right. Lead-sheet mode, twelve-key transposition,
   the twelve-bar form; `detectChords` and `romanNumeral` are the half that exists. Wants item 5's
   grid work under it — swing is a different grid, not an error.
7. **The first release** — electron-builder zip, the native binary included, install size
   recorded (NFR 10), a READ-ME-FIRST for a second machine. **Verify both harness affordances are
   absent from the packaged build** — ADR-0004's virtual ports and Plan 0003's fixture coach
   provider; that check belongs in this plan's done-when.

**Items 4 to 7 are not drafted, deliberately**, and they wait on evidence rather than on time.
Item 4 needs Plan 0002's per-bar report to exist against a real piece before a drill can be built
from it. Item 5 needs a decision ADR-0005 just reopened — whether the generator emits MusicXML
(heavy, but engraved, which sight-reading needs) or an `ExpectedTimeline` directly (light, but
nothing to draw) — and the answer depends on how Plan 0002's adapter actually feels; it also needs
an ADR for SQLite, the first store that is not JSON Lines. Item 6 needs an ADR for the second
expectation shape, and it is worth writing only once there is one note-exact plan closed to
contrast it against. The release plan is almost entirely claims about a tree that does not exist
yet, and it is the cheapest of all of these to write once it does.

**The detail behind items 4 to 6 lives in [`../backlog.md`](../backlog.md)** — the individual
drills, the decisions the 2026-09-10 pedagogy interview fixed, and the open architectural
questions they raise (chief among them that rubato, swing and the tempo ladder are one problem: a
beat grid estimated from the take rather than a single fitted tempo). That file also carries the
longer-standing ideas that were the tail of this roadmap — score following, a Bluetooth or DIN
`MidiSource`, MIDI-to-notation transcription, a tablet port — each still needing its own
interview.

## Conventions

- Filename `NNNN-<slug>.md`. Header block: `Status`, `Created`, `Owner skill(s)`, `Related
  ADRs`, `NFRs claimed`. Sections: TL;DR, Context & problem, Decision, Architecture diagram,
  Implementation phases, Data shapes, Risks & open questions, What this plan does NOT do,
  Implementation log, Followups.
- Every phase carries exactly one `**Owner skill:**` line, `dev` or `human`, a file list, and a
  done-when that is checkable. A done-when that claims speed names the NFR row.
- `dev` edits only the `Status:` line and the implementation log. The review at close is a fresh
  `architect` session; the plan then moves to `done/` and leaves this roster.
