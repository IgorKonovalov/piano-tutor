# Plans index

The one-minute "what is in flight" view. Read this first each session instead of re-deriving
state from `git log`. Completed plans move to `done/`.

**Next free number: 0008** (ADRs are a separate sequence; next free there is **0014**.)

## Active roster

Each row carries at most two sentences of live constraint: what a reader needs to decide whether
to pick the plan up. The plan file carries everything else.

| Plan | Title | Status | Owner | Live constraint |
|------|-------|--------|-------|-----------------|
| [0002](0002-a-piece-is-practised.md) | A piece is practised | in-progress | human | All six `dev` phases landed and the close review ran on 2026-09-10; both defects it asked to be fixed before Phase 7 are fixed. **The only thing left is Phase 7 at the CK88** — items 2, 3 and 6 unanswered, item 4 observed and not judged — and the plan cannot close until those answers are in its log. Nothing else in the roster is blocked by it. |
| [0004](0004-the-app-plays-the-piece.md) | The app plays the piece | approved | dev, human | ADR-0007 and 0008 are its whole design; the second reverses the standing "no audio" non-requirement, bounded to a sample-free fallback tone. **Runs first of the approved pair** (decided 2026-09-10): fully `dev`-ownable until its Phase 7, its first two phases need nothing from anything, and its `MidiSink` and Web Audio voice are what Plans 0005 and 0006 build on. Demonstration only — no accompaniment, no score following. |
| [0003](0003-the-coach-speaks.md) | The coach speaks | approved | dev, human | ADR-0002 is its whole design. One-shot Analyse, replies saved beside the take, free-play and practised takes both summarised. Every `dev` phase runs on a recorded fixture reply and a stub binary, so it queues with no subscription; **Phase 2 is a spike against the real `claude` CLI** and Phase 6 is the only phase where a model actually answers. It also owns the carried Plan 0002 finding that an `extra` verdict per unmatched pitch is unbounded, because its token budget is what depends on it. |
| [0005](0005-the-practice-loop.md) | The practice loop | draft | dev, human | ADR-0011 is its whole design: each drill attempt is its own take, and a drill is a bar-range slice of the score's own timeline, so the aligner is untouched. Roadmap item 4, and the highest teaching value the existing seams already reach. Tempo-free by decision — "slower" is the demonstration's speed, never a threshold. Only its Phase 5 needs Plan 0004. |
| [0007](0007-what-you-played-drawn-on-the-score.md) | What you played, drawn on the score | draft | dev, human | ADR-0013 is its whole design: the played pitch is drawn as our own SVG ghost notehead over OSMD's engraving, never merged into it. Raised by the user at the piano on 2026-09-10 — a red bar and a letter name make the player do the join. Depends on nothing but Plan 0002, so it can be picked up at any time; its riskiest fact (`sourceNote` identity) is resolved in its first phase. |
| [0006](0006-the-metronome-and-the-score-follows.md) | The metronome, and the score follows | draft | dev, human | ADR-0012 is its whole design: the click is a grid both processes schedule from, not a tick per beat, and it becomes the timing reference whenever it runs. Widens ADR-0008's bound to let the app open an audio device while it is only listening. Needs Plan 0004's sink, clock, voice and stop path; builds the follow cursor Plan 0002's prose promised and never shipped. |

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

**Ordered 2026-09-10:** playback before the coach, and the practice loop before the metronome.
Playback goes first because it is the one of the pair that is fully `dev`-ownable and because two
later plans build on its sink and its voice. The loop goes before the metronome so that each is
useful alone: the loop ships against the tempo-free aligner, and the metronome then adds the
click, click-relative scoring and — once there is a store — the ladder.

1. **A piece is practised** — drafted as Plan [0002](0002-a-piece-is-practised.md), `dev` phases
   landed and reviewed, open on its `human` phase.
2. **The app plays the piece** — drafted as Plan [0004](0004-the-app-plays-the-piece.md), approved
   and next up. The roadmap's "MIDI out to demonstrate a passage" grown into a plan after the
   2026-09-10 interview.
3. **The coach speaks** — drafted as Plan [0003](0003-the-coach-speaks.md), approved. Independent
   of Plan 0004; either can be picked up once that one lands.
4. **The practice loop** — drafted as Plan [0005](0005-the-practice-loop.md). The
   deliberate-practice cycle closed automatically: `barsByTiming` already ranks the take's worst
   bars, so take the worst few, build a drill from each (the bar plus a bar of run-up, slower,
   looped), and re-test the passage in context afterwards. No new material and no new store, as
   the roadmap always said; it did earn an ADR, because how a repeated attempt is recorded turned
   out to be a real fork with two alternatives worth remembering.
5. **What you played, drawn on the score** — drafted as Plan
   [0007](0007-what-you-played-drawn-on-the-score.md), out of the user's verdict at the piano on
   2026-09-10: colour plus prose localises an error to somewhere in a twelve-note bar and names a
   pitch as a letter, and the player does the join. It deepens Plan 0002's bar overlay from boxes
   to glyphs and depends on nothing else, so it can run beside either approved plan.
6. **The metronome, and the score follows** — drafted as Plan
   [0006](0006-the-metronome-and-the-score-follows.md), out of Plan 0002's followup after the user
   asked for a metronome on 2026-09-10. It also pays that plan's debt: the follow cursor its prose
   promised and no phase built.
7. **Drills, and a store that schedules them** — the generator in `core/` (scales, arpeggios,
   chord progressions, a sight-reading drill) riding Plan 0002's path, plus the sight-reading and
   rhythm mechanics in [`../backlog.md`](../backlog.md). Material is **hybrid by decision**:
   generated for drills, imported MusicXML for real pieces. The local SQLite file arrives here and
   is **shaped as a scheduler from the start even though nothing schedules yet**; the player still
   picks what they practise. The seeded generator of ADR-0004 is already half of this. It is now
   also what three separate followups wait on — the tempo ladder, the drill queue surviving a
   restart, and the thinning click's drift comparison.
8. **Jazz and blues** — the fork the note-exact model cannot cross. A **second expectation shape
   beside `ExpectedTimeline`**: per bar a chord symbol, its guide tones and an admissible
   pitch-class set, scored on membership, function and the timing of the change, because a blues
   chorus is note-different every time and still right. Lead-sheet mode, twelve-key transposition,
   the twelve-bar form; `detectChords` and `romanNumeral` are the half that exists. Wants item 7's
   grid work under it — swing is a different grid, not an error.
9. **The first release** — electron-builder zip, the native binary included, install size
   recorded (NFR 10), a READ-ME-FIRST for a second machine. **Verify every harness affordance is
   absent from the packaged build** — ADR-0004's virtual ports, Plan 0003's fixture coach
   provider, and Plan 0005's `virtual:drill:*` ports; that check belongs in this plan's done-when,
   and Plan 0002's close review already found one leak to fix there (`SyntheticSource.open` does
   not consult the harness gate).

**Items 7 to 9 are not drafted, deliberately**, and they wait on evidence rather than on time.
Item 7 needs a decision ADR-0005 just reopened — whether the generator emits MusicXML (heavy, but
engraved, which sight-reading needs) or an `ExpectedTimeline` directly (light, but nothing to
draw) — and the answer depends on how Plan 0002's adapter actually feels; it also needs an ADR for
SQLite, the first store that is not JSON Lines. Item 8 needs an ADR for the second expectation
shape, and it is worth writing only once there is one note-exact plan closed to contrast it
against. The release plan is almost entirely claims about a tree that does not exist yet, and it
is the cheapest of all of these to write once it does.

**The detail behind items 7 and 8 lives in [`../backlog.md`](../backlog.md)** — the individual
drills, the decisions the 2026-09-10 pedagogy interview fixed, and the open architectural
questions they raise (chief among them that rubato and swing are one problem: a beat grid
estimated from the take rather than a single fitted tempo, which is a different question from the
grid Plan 0006 *gives* the player). That file also carries the longer-standing ideas that were the
tail of this roadmap — score following, a Bluetooth or DIN `MidiSource`, MIDI-to-notation
transcription, a tablet port — each still needing its own interview.

## Conventions

- Filename `NNNN-<slug>.md`. Header block: `Status`, `Created`, `Owner skill(s)`, `Related
  ADRs`, `NFRs claimed`. Sections: TL;DR, Context & problem, Decision, Architecture diagram,
  Implementation phases, Data shapes, Risks & open questions, What this plan does NOT do,
  Implementation log, Followups.
- `Status` moves `draft` → `approved` (the architect and the user agree it is ready, and `dev` may
  be given the go on it) → `in-progress` → `done`.
- Every phase carries exactly one `**Owner skill:**` line, `dev` or `human`, a file list, and a
  done-when that is checkable. A done-when that claims speed names the NFR row.
- `dev` edits only the `Status:` line and the implementation log. The review at close is a fresh
  `architect` session; the plan then moves to `done/` and leaves this roster.
