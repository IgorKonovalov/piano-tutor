# Plans index

The one-minute "what is in flight" view. Read this first each session instead of re-deriving
state from `git log`. Completed plans move to `done/`.

**Next free number: 0014** (ADRs are a separate sequence; next free there is **0021**.)

## Active roster

Each row carries at most two sentences of live constraint: what a reader needs to decide whether
to pick the plan up. The plan file carries everything else.

| Plan | Title | Status | Owner | Live constraint |
|------|-------|--------|-------|-----------------|
| [0002](0002-a-piece-is-practised.md) | A piece is practised | in-progress | human | All six `dev` phases landed and the close review ran on 2026-09-10; both defects it asked to be fixed before Phase 7 are fixed. **The only thing left is Phase 7 at the CK88** — items 2, 3 and 6 unanswered, item 4 observed and not judged — and the plan cannot close until those answers are in its log. **Item 6 is no longer blocked**: Plan 0008 closed 2026-09-10 and a good take and a bad one no longer both read out of time. It was attempted that evening and did not land — two performances ran into one take — so it wants one clean take each, nothing more. Nothing else in the roster is blocked by it. |
| [0009](0009-a-bar-is-judged-note-by-note.md) | A bar is judged note by note | draft | dev, human | ADRs 0015, 0016 and 0017 are its design. **Plan 0008's eight followups, taken as one piece of work**, because four of them are the same bug: every reference in the model still draws through the disturbance it is judging around. A bar gains a second number - the shape of its arrivals inside it, read against a quadratic null so a ritardando reads zero - because a hand that hurries three notes and gives them back leaves the bar's duration unchanged to the millisecond. **Its Phase 2 is a `human` phase in the middle of the run** and Plan 0002's last open item rides on it. **Parked 2026-09-10 until the player can sit at the CK88** — it blocks nothing and nothing blocks it. Its Phase 1 is `dev`-only, self-contained and makes no threshold decisions, so it can be picked up alone to have the fixture waiting. |
| [0010](0010-the-timeline-tells-the-truth-about-the-page.md) | The timeline tells the truth about the page | draft | dev, human | ADR-0018 is its whole design, and it amends ADR-0005's seam once for the whole list of marks rather than per sign. **The only plan in the roster fixing things that are broken right now**, both found at the CK88 on 2026-09-11: a real score with an attributes-only carrier bar cannot be played at all, and a bar with a turn over it is marked wrong for being played *correctly* — the failure ADR-0009 exists to prevent, alive by another route and exercised by no fixture. OSMD realises the ornament itself (`createVoiceEntriesForOrnament`), so we never own a turn-realiser. **Its Phase 3 renames `grace` to `optional`**, which is the one identifier Plan 0009 could collide on: do not run the two in parallel worktrees without agreeing that first. Its Phase 5 also settles the pedal question Plan 0004 Phase 7 left unexplained. |
| [0011](0011-the-instrument-can-leave.md) | The instrument can leave | draft | dev, human | ADR-0019 is its whole design and it closes the open question ADR-0007 left: `MidiSink.send` stays fire-and-forget, because RtMidi on Windows prints to stderr and returns, so any status it gave back would be a lie. Main notices a departure by enumeration — free to ask, ADR-0006 — runs the panic path it already has, and tells the renderer. **Notice and say so, not reopen and resume**, by decision; name-matched reopen stays a followup. Depends on nothing in flight; Plan 0004 is closed and shipped everything it needs. It also pays Plan 0004's carried debt that **NFR 13's magnitude is asserted by nothing** larger than 29 note-ons against a row that says 500. |
| [0012](0012-the-score-view-on-a-real-piece.md) | The Score view on a real piece | draft | dev | The three things the user asked for at the piano on 2026-09-11 after using the view on a four-page score: it scrolls to keep up with playback, a small keyboard sits in a corner, and the library list folds away. **No new ADR and no new seam** — both halves of the scroll already exist, `player:state` carries the bar and Plan 0002 maps a bar to the box OSMD drew. Depends on nothing and blocks nothing, so it can be picked up at any time. **It must not grow a moving cursor**: that is ADR-0020 and Plan 0013, and the plan says so explicitly. |
| [0013](0013-the-travelling-line.md) | The travelling line | draft | dev, human | ADR-0020 is its whole design: one cursor on the score that takes a position rather than a source, so Plan 0006's metronome follow drives the same component instead of growing a second marker that can disagree about where bar 30 is. **Its Phase 3 edits Plan 0006 Phase 3** to consume it. The hard part is the page, not the time — during playback the position is already exact, and what is missing is a coordinate. **Needs Plan 0007 Phase 1 only** (the `sourceNote`-to-SVG index), not that whole plan, and it is last in the order for that reason. |
| [0003](0003-the-coach-speaks.md) | The coach speaks | approved | dev, human | ADR-0002 is its whole design. One-shot Analyse, replies saved beside the take, free-play and practised takes both summarised. Every `dev` phase runs on a recorded fixture reply and a stub binary, so it queues with no subscription; **Phase 2 is a spike against the real `claude` CLI** and Phase 6 is the only phase where a model actually answers. It also owns the carried Plan 0002 finding that an `extra` verdict per unmatched pitch is unbounded, because its token budget is what depends on it. |
| [0005](0005-the-practice-loop.md) | The practice loop | draft | dev, human | ADR-0011 is its whole design: each drill attempt is its own take, and a drill is a bar-range slice of the score's own timeline, so the aligner is untouched. Roadmap item 4, and the highest teaching value the existing seams already reach. Tempo-free by decision — "slower" is the demonstration's speed, never a threshold. **It also owns the coach's session grain** (added 2026-09-10): the coach is asked once per session, never once per attempt, because forty presses cost roughly ten times one roll-up and a trajectory is better advice than forty isolated verdicts. Its Phase 5 needed Plan 0004, which **closed 2026-09-11**, so the demonstration it plays is real rather than degraded; only its Phase 6 still waits on Plan 0003, and that degrades rather than blocks. |
| [0007](0007-what-you-played-drawn-on-the-score.md) | What you played, drawn on the score | draft | dev, human | ADR-0013 is its whole design: the played pitch is drawn as our own SVG ghost notehead over OSMD's engraving, never merged into it. Raised by the user at the piano on 2026-09-10 — a red bar and a letter name make the player do the join. Depends on nothing but Plan 0002, so it can be picked up at any time; its riskiest fact (`sourceNote` identity) is resolved in its first phase. |
| [0006](0006-the-metronome-and-the-score-follows.md) | The metronome, and the score follows | draft | dev, human | ADR-0012 is its whole design: the click is a grid both processes schedule from, not a tick per beat, and it becomes the timing reference whenever it runs. Widens ADR-0008's bound to let the app open an audio device while it is only listening. **Unblocked 2026-09-11:** Plan 0004 closed and its sink, lookahead clock, synthesised voice and stop path are shipped and measured. Builds the follow cursor Plan 0002's prose promised and never shipped. |

## Recently closed

- [0004 — The app plays the piece](done/0004-the-app-plays-the-piece.md) — closed 2026-09-11,
  v0.4.0. Six `dev` phases, three pre-Phase-7 fixes and a `human` phase at the CK88; **no
  blockers**, the full gate green end to end on the finished tree (717 unit tests, 33 end-to-end).
  ADRs 0007 and 0008 accepted on it, **each with a dated `Outcome`**. NFR 13 measured at the
  instrument over 1286 note-ons — p95 0.6 ms against a 10 ms target, and Windows' 15.6 ms timer
  granularity never appeared. No stuck note on any of the four interruptions, the USB cable pulled
  mid-chord included. **What the instrument taught, and the code did not:** a `MidiSink.send` into
  a dead port cannot tell that it failed, so an unplug is survived and a replug is not recovered
  from; and **a real score with an attributes-only carrier measure refuses to play at all**,
  because `beats` of 0 fails `ExpectedTimelineSchema`. Both were drafted into plans on 2026-09-11
  — [0011](0011-the-instrument-can-leave.md) and
  [0010](0010-the-timeline-tells-the-truth-about-the-page.md). Five followups
  survive in that plan's `## Followups`, and NFR 13's *magnitude* is still asserted by nothing
  larger than 29 note-ons.

- [0008 — The timing model](done/0008-the-timing-model.md) — closed 2026-09-10, v0.3.0. Five
  `dev` phases and a `human` phase at the CK88; **no blockers**, two `major` and four `minor`, the
  full gate green end to end on the finished tree. ADR-0014 accepted on it, **with a dated
  `Outcome`**: the local reference lands — a restart is named and costs nothing, the bars before
  it stay clean, the tempo figure is one the player recognises — and the two things built on top
  of it do not. A bar the player really rushed read `as written` while three bars around it went
  amber, and a real rallentando produced no observation at all; both pass on the generated oracle,
  which is the finding behind the finding. Eight followups survive in that plan's `## Followups`,
  worst first, and **the first of them wants an ADR before any code**.
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
   landed and reviewed, open on its `human` phase — and now blocked on item 2 below, because its
   Phase 7 item 6 cannot be answered while a good take and a bad one both read out of time.
2. **The timing model** — **closed** as Plan [0008](done/0008-the-timing-model.md), out of Plan 0002's
   Phase 7 at the CK88 on 2026-09-10. One tempo fitted across a whole take cannot describe a take
   with a restart or a rallentando in it; the residuals ramp from +1741 to -1191 ms and the player
   cannot get back to right timing after going wrong. It sat here, ahead of everything else,
   because Plan 0002's close depended on it and because every plan below judges timing on the path
   it repairs. No-click path only: ADR-0012 owns the metronome's. **Half of it wants a successor**
   (see `## Recently closed`): judging a bar by its overall pace cannot see a hand that hurries
   inside a bar, and a real rallentando is still not described. That successor is an interview and
   an ADR, not a tuning pass, and it is worth writing before anything else reads `timingDeviation`
   — Plan 0003's coach summary is the next thing that does.
2b. **A bar is judged note by note** — drafted as Plan
   [0009](0009-a-bar-is-judged-note-by-note.md), out of Plan 0008's own Phase 6 at the CK88. The
   local reference landed and what was built on it did not: a bar judged by its overall pace
   cannot see a hand that hurries inside it, and every reference in the model still draws through
   the disturbance it is judging around. **It sits with item 2 rather than after it** — it is the
   same area of the same file, its evidence is already recorded, and Plan 0002's last open item is
   answered in its Phase 2. It is also where the test suite stops being made only of things we
   imagined (ADR-0017).

3. **The app plays the piece** — **closed** as Plan
   [0004](done/0004-the-app-plays-the-piece.md) on 2026-09-11. The roadmap's "MIDI out to
   demonstrate a passage" grown into a plan after the 2026-09-10 interview. **The seams the two
   plans below were drafted against are now real rather than planned:** `MidiSink`, the lookahead
   clock in main, `PlaybackSchedule` in `core/` and the synthesised voice. Two things it leaves
   behind, neither blocking anything on this list: a dead output port is invisible to the sink, so a
   replug is not recovered from; and a score whose bars include an attributes-only measure cannot
   be played at all. **Both now have plans**, drafted 2026-09-11 as items 3b and 3c below, along
   with the two things the user asked for at the instrument on seeing playback work.
3b. **The timeline tells the truth about the page** — drafted as Plan
   [0010](0010-the-timeline-tells-the-truth-about-the-page.md), out of Plan 0004's Phase 7 and its
   close. **It sits first among the four drafted that day** because it is the only one repairing
   things that are broken right now: a real score that cannot be played, and a bar marked wrong for
   being played correctly. ADR-0018 is its design and it amends ADR-0005 once for the whole list of
   marks, which is what the backlog argued for before any of it was planned.
3c. **The instrument can leave** — drafted as Plan [0011](0011-the-instrument-can-leave.md), out
   of the same Phase 7. ADR-0019 closes the question ADR-0007 left open by answering it with the
   measurement: a send into a dead port cannot report failure on this platform, so the departure is
   noticed by enumeration instead. It also pays Plan 0004's carried NFR 13 magnitude debt.
3d. **The Score view on a real piece** — drafted as Plan
   [0012](0012-the-score-view-on-a-real-piece.md): autoscroll, a corner keyboard and a folding
   library list, all three asked for at the piano on 2026-09-11 after a four-page score made the
   view's gaps obvious. No ADR, no new seam, no dependency — the cheapest item on this list and
   pickable at any time.
4. **The coach speaks** — drafted as Plan [0003](0003-the-coach-speaks.md), approved and pickable
   now. Independent of Plan 0004, which no longer has to land first.
5. **The practice loop** — drafted as Plan [0005](0005-the-practice-loop.md). The
   deliberate-practice cycle closed automatically: `barsByTiming` already ranks the take's worst
   bars, so take the worst few, build a drill from each (the bar plus a bar of run-up, slower,
   looped), and re-test the passage in context afterwards. No new material and no new store, as
   the roadmap always said; it did earn an ADR, because how a repeated attempt is recorded turned
   out to be a real fork with two alternatives worth remembering.
6. **What you played, drawn on the score** — drafted as Plan
   [0007](0007-what-you-played-drawn-on-the-score.md), out of the user's verdict at the piano on
   2026-09-10: colour plus prose localises an error to somewhere in a twelve-note bar and names a
   pitch as a letter, and the player does the join. It deepens Plan 0002's bar overlay from boxes
   to glyphs and depends on nothing else, so it can run beside either approved plan. **Its Phase 1
   is now load-bearing for two plans**: Plan 0013's cursor consumes the same `sourceNote`-to-SVG
   index, and ADR-0018 hands that plan one obligation — an expanded ornament note has no notehead
   of its own.
6b. **The travelling line** — drafted as Plan [0013](0013-the-travelling-line.md), out of the
   user's request on 2026-09-11 on seeing playback work: the bar highlight says *somewhere in these
   twelve notes* and the ear is already ahead of it. **It sits here rather than earlier because it
   needs item 6's Phase 1 underneath it** — during playback the position is already exact, and what
   is missing is a coordinate. ADR-0020 makes it one cursor with two position sources, so item 7
   below consumes it instead of growing a second marker.
7. **The metronome, and the score follows** — drafted as Plan
   [0006](0006-the-metronome-and-the-score-follows.md), out of Plan 0002's followup after the user
   asked for a metronome on 2026-09-10. It also pays that plan's debt: the follow cursor its prose
   promised and no phase built. **Its Phase 3 is amended by Plan 0013** (ADR-0020) to drive that
   plan's cursor rather than build a second highlight path; if this one runs first, it ships the
   bar box as drafted and Plan 0013 absorbs it.
8. **Drills, and a store that schedules them** — the generator in `core/` (scales, arpeggios,
   chord progressions, a sight-reading drill) riding Plan 0002's path, plus the sight-reading and
   rhythm mechanics in [`../backlog.md`](../backlog.md). Material is **hybrid by decision**:
   generated for drills, imported MusicXML for real pieces. The local SQLite file arrives here and
   is **shaped as a scheduler from the start even though nothing schedules yet**; the player still
   picks what they practise. The seeded generator of ADR-0004 is already half of this. It is now
   also what three separate followups wait on — the tempo ladder, the drill queue surviving a
   restart, and the thinning click's drift comparison.
9. **Jazz and blues** — the fork the note-exact model cannot cross. A **second expectation shape
   beside `ExpectedTimeline`**: per bar a chord symbol, its guide tones and an admissible
   pitch-class set, scored on membership, function and the timing of the change, because a blues
   chorus is note-different every time and still right. Lead-sheet mode, twelve-key transposition,
   the twelve-bar form; `detectChords` and `romanNumeral` are the half that exists. Wants item 7's
   grid work under it — swing is a different grid, not an error.
10. **The first release** — electron-builder zip, the native binary included, install size
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
