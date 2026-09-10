# 0005 — The practice loop

> **Status:** draft
> **Created:** 2026-09-10
> **Owner skill(s):** dev, human
> **Related ADRs:** [0011](../adrs/0011-an-attempt-is-a-take-the-loop-repeats-through-the-recorder.md) (proposed)
> is this plan's whole design;
> [0005](../adrs/0005-the-expected-note-timeline-is-extracted-from-osmds-model.md) (accepted) supplies
> the timeline a drill slices; [0009](../adrs/0009-an-ornament-is-optional-a-grace-note-is-scored-neither-way.md)
> (accepted) is why a drilled ornament does not fail an attempt;
> [0004](../adrs/0004-the-app-plays-itself-virtual-ports-not-an-injection-channel.md) (accepted)
> is the discipline every phase is checked by;
> [0007](../adrs/0007-playback-is-a-schedule-built-in-core-and-clocked-by-main-behind-a-midisink.md)
> (proposed) is what demonstrates a drill in Phase 5;
> [0010](../adrs/0010-alignment-ends-where-the-player-stopped-an-unplayed-tail-is-free.md)
> (proposed) is why an attempt that stopped early must not be allowed to pass;
> [0001](../adrs/0001-an-electron-shell-in-typescript-around-a-pure-music-core.md) (accepted)
> governs the processes
> **NFRs claimed:** 3, 7b, 9, 11 in [nfr.md](../nfr.md)
> **Depends on:** Plan [0002](0002-a-piece-is-practised.md) Phases 4 and 5 — the aligner, the
> `PracticeReport` and the bar-marked Score view. Phase 5 of this plan additionally needs Plan
> [0004](0004-the-app-plays-the-piece.md) Phase 3; Phase 6 additionally needs Plan
> [0003](0003-the-coach-speaks.md) Phases 1 and 3 for the coach panel and the reply store, and
> **degrades to showing the summary without an Analyse button if that plan has not landed** —
> every other phase needs nothing from either.

## TL;DR

You finish a piece, and instead of a page of colours you are handed a short list: the three bars
you played worst. You pick one and the app drills it — it marks that bar plus a bar of run-up on
the score, plays the passage to you slowly, records you playing it back, and says clean or not.
Two clean attempts in a row and it moves to the next bar. When the list is empty it asks you to
play the whole passage again in context, so the thing you fixed is tested where it lives. Then,
once — not once per attempt — you can ask the coach what the *session* looked like: which drills
you fixed, which fought back, and whether the fix held in context. It is what a teacher does with
the thirty seconds after you stop playing, and every part of it is already reachable: a drill is a
bar range of the score you already imported, scored by the aligner that already exists.

## Context & problem

Plan 0002 built the diagnosis and stopped there. `barsByTiming` ranks a take's bars, the score
colours, the bar detail names the wrong and missing notes — and then the player is alone with a
page of information and no move to make. The roadmap calls this item 4 and calls it "the highest
teaching value the existing seams already reach", which is exactly right: nothing here needs a new
store, a new expectation shape, a new notation path or a new dependency. What it needs is the
loop closed.

Two problems stand between the report and the loop, and both were resolved in the 2026-09-10
interview.

**Repetition has nowhere to live.** `align` matches one played stream against one timeline. A
player who loops two bars six times into one take gets one pass matched and five passes counted as
extra notes. ADR-0011 settles this: each attempt is its own take, the loop starts and stops the
recorder around it, and the aligner is untouched. The cost is a re-arm between repetitions and a
pile of small files; the alternatives — segmenting a continuous take, or teaching `align` to loop
— were rejected there and the reasons are recorded.

**"Worst" is not what the app currently ranks.** `barsByTiming` sorts by distance from the fitted
tempo and nothing else, so a bar in which the player hit three wrong notes but hit them steadily
ranks below a bar that was merely rushed. That is fine as a statistic and useless as a drill
queue. This plan adds a severity ordering that puts note errors above timing errors, and leaves
`barsByTiming` alone because the Score view's "furthest from your own tempo" list is a different
question with a right answer already.

One thing is deliberately absent: a tempo target. Alignment is tempo-free, so "slower" in this
plan is an instruction on screen and a speed the *demonstration* plays at — never a threshold an
attempt is judged by. The tempo ladder, and judging against a click, are Plan
[0006](0006-the-metronome-and-the-score-follows.md); the interview put the loop first on purpose,
so that each plan is useful on its own.

## Decision

We build the loop as a mode of the existing Score view, driven by four new pure functions in
`core/` and no new IPC domain, no new file format and no new dependency.

`selectDrills` turns a `PracticeReport` into an ordered list of bar ranges, worst first, merging
adjacent bad bars and prefixing each with a bar of run-up. `sliceTimeline` turns a bar range into
an `ExpectedTimeline` that is valid on its own terms, so a drill aligns, reports, colours and
plays back through paths that never learn drills exist. `advanceDrill` is a pure state machine
over (session, attempt verdict) that applies the pass rule — every bar in the range verdicts
`clean`, twice consecutively — and decides repeat, next drill, or the closing in-context re-test.
`sessionSummary` turns a finished session into one bounded object for the coach.

**The coach is asked once per session, never once per attempt.** This is the decision that keeps
the loop and the coach compatible. Plan 0003 analyses a take, which is the right grain when a take
is a performance; a drill session is twenty or forty takes of two bars each, and analysing them
one at a time is both wasteful and worse advice. Wasteful because each call carries the provider's
own fixed overhead — measured 2026-09-10 at about 1 000 tokens before our summary is counted — so
forty presses cost roughly ten times one roll-up. Worse advice because the useful thing a teacher
says after a practice session is a *trajectory*: you fixed the left hand by the fourth attempt,
bar 30 got worse every time you came back to it, and the in-context re-test undid half of it.
No single-attempt analysis can see any of that, however good the prompt is. `sessionSummary` is
therefore not a compression of N `TakeSummary`s but a different object, whose subject is the
sequence.

We rejected drills as generated material because it reopens ADR-0005's deferred question and buys
nothing a slice does not already give; we rejected a persisted drill queue because the roadmap's
decision 2 puts the store in item 5 and a session-scoped loop needs no schedule; and we rejected a
separate Drill view because the Score view already owns the OSMD instance, the bar marking and the
report, and a second one would duplicate all three.

## Architecture diagram

```mermaid
flowchart TB
    subgraph core["core/ (pure)"]
        RPT[PracticeReport]
        SEL["selectDrills()<br/>worst bars, merged, + run-up"]
        SLICE["sliceTimeline()<br/>bar range -> ExpectedTimeline"]
        ADV["advanceDrill()<br/>clean twice -> next"]
        ALIGN["align + practiceReport<br/>(unchanged)"]
        SUM["sessionSummary()<br/>whole session -> one<br/>bounded object, NFR 7b"]
        RPT --> SEL --> SLICE --> ALIGN --> ADV
        ADV -->|repeat| SLICE
        ADV -->|done| SUM
    end
    subgraph renderer["renderer/"]
        SCORE["Score view<br/>OSMD, bar marks"]
        LOOP["DrillPanel<br/>+ useDrillSession"]
        SCORE <--> LOOP
    end
    subgraph main["electron/ main"]
        REC["Recorder<br/>short take allowed"]
        SINK["MidiSink (ADR-0007)<br/>demonstrate the passage"]
        PROV["CoachProvider<br/>(Plan 0003)"]
    end
    CK["CK88"] -->|midi:event| LOOP
    LOOP -->|midi:open / midi:close<br/>one take per attempt| REC
    REC -->|take| LOOP
    LOOP --> SEL
    ADV --> LOOP
    LOOP -->|player:play, bar range, slower| SINK --> CK
    SUM -->|coach:ask, once per session| PROV
```

## Implementation phases

### Phase 1 — The worst bars become a list you can act on
- **Owner skill:** dev
- **What:** After a take, the Score view shows an ordered "Work on these" list — the worst bars,
  merged where adjacent, each with its run-up bar — and selecting one marks that range on the
  score. No recording yet; this is the queue made visible.
- **Files touched:** `core/src/drill/select.ts`, `core/src/drill/select.test.ts`,
  `core/src/drill/types.ts`, `core/index.ts`, `renderer/components/DrillPanel.tsx`,
  `renderer/components/DrillPanel.module.css`, `renderer/views/Score.tsx`,
  `renderer/views/Score.module.css`, `e2e/drill.spec.ts`
- **Notes for the implementer:** Severity ordering, worst first: a bar with any note verdict other
  than `correct` outranks every bar whose only fault is timing; within the note-error group order
  by the count of faulty notes, and within the timing group by `|timingDeviation|`. `notAttempted`
  and `unalignable` bars are never drilled — the player did not play them, so there is nothing to
  work on. Merge bars that are adjacent *after* selection, then prefix one bar of run-up, clamped
  at bar 0; a merge that swallows the run-up of the next drill is one drill, not two. Leave
  `barsByTiming` exactly as it is: the Score view's existing tempo list is a different question.
- **Done when:** `selectDrills` over a report whose bars 5 and 6 are `wrong` and whose bar 2 is
  `timing` returns bar 5 to 6 with a run-up from bar 4 first, and bar 2 with a run-up from bar 1
  second. A report whose bars are all `clean` returns an empty list and the panel says so rather
  than showing an empty box. A report with a `notAttempted` tail offers no drill from that tail.
  A drill on bar 0 has no run-up and does not produce a negative bar index. End to end on
  `virtual:score:pickup-two-hands` with a wrong-note perturbation: a take is played, the panel
  lists the perturbed bar, clicking it marks the range on the drawn score.

### Phase 2 — A drill is a bar range of the score, and the aligner cannot tell
- **Owner skill:** dev
- **What:** `sliceTimeline` produces an `ExpectedTimeline` for a bar range that is valid on its own
  terms, so aligning a passage against a drill uses the unmodified aligner.
- **Files touched:** `core/src/drill/sliceTimeline.ts`, `core/src/drill/sliceTimeline.test.ts`,
  `core/src/score/timeline.ts`, `core/index.ts`
- **Notes for the implementer:** The slice re-bases quarter positions so the range starts at zero,
  keeps each note's original bar index in a field the report can name back to the player, and
  keeps the parent's `scoreId` with the range appended so two drills of one score are
  distinguishable. Grace notes attached to a note inside the range come with it (ADR-0009 keeps
  them optional either way); a grace note attached across the boundary is dropped with its parent.
  A tie that begins before the range starts sounds nothing new inside it and so contributes no
  expected onset.
- **Done when:** `barTableProblems` and `noteBarProblems` both return empty for the slice of every
  committed fixture timeline, over every bar range from length one to the whole score.
  `timelineFingerprint` of a slice differs from its parent's, and the slice of the full range has
  the same scored notes in the same order as the parent. Aligning a take generated from a slice
  against that slice scores every bar `clean` with zero wrong, missing and extra. Aligning the
  same take against the **parent** timeline does not — which is the assertion that the slice is
  doing real work.

### Phase 3 — You play the passage and it says clean or not
- **Owner skill:** dev
- **What:** One attempt, end to end: the loop arms the recorder, you play the passage, it stops,
  aligns against the slice and shows a verdict — including when the attempt is only eight notes
  long.
- **Files touched:** `electron/take/Recorder.ts`, `electron/take/Recorder.test.ts`,
  `shared/midi.ts`, `shared/take.ts`, `electron/ipc/midiHandlers.ts`,
  `electron/preload/api/midi.ts`, `renderer/types/global.d.ts`,
  `renderer/hooks/useDrillSession.ts`, `renderer/hooks/useDrillSession.test.ts`,
  `renderer/components/DrillPanel.tsx`, `electron/midi/virtualPorts.ts`,
  `electron/midi/virtualPorts.test.ts`, `e2e/drill.spec.ts`, `e2e/harness.ts`
- **Notes for the implementer:** `MINIMUM_NOTE_ONS` stays 10 for ordinary takes; `midi:open` gains
  an optional flag saying a short take is expected, and the loop sets it (ADR-0011). Validate the
  flag in the payload schema like everything else. The attempt's take id must be the one the
  session wrote, not the newest take of that score — the Plan 0002 close review found exactly that
  defect in `Score.tsx` and it would return here otherwise. For the headless path add a
  `virtual:drill:<slug>:<from>-<to>` port family that plays only that bar range of a fixture
  timeline, cleanly or under a named perturbation, so an attempt can be driven with nothing
  plugged in (ADR-0004). The gap between attempts is real: make the armed state unmistakable on
  screen before the player can start the next one.
- **Done when:** A four-note take recorded with the short-take flag set is written and reads back;
  the same take without the flag is still discarded and still says so. An attempt driven from
  `virtual:drill:pickup-two-hands:1-2` playing the range cleanly reports every bar of the drill
  `clean`; the same range under a wrong-note perturbation reports that bar `wrong` and names the
  substituted pitch. The attempt's report cites the take the attempt just wrote, asserted by id.
  NFR 11: the whole phase is checkable with no instrument attached, and the e2e run proves it.

### Phase 4 — Two clean in a row, and the loop moves on
- **Owner skill:** dev
- **What:** The loop itself: attempt, verdict, repeat or advance, and the closing in-context
  re-test when the queue empties.
- **Files touched:** `core/src/drill/session.ts`, `core/src/drill/session.test.ts`,
  `core/index.ts`, `renderer/hooks/useDrillSession.ts`,
  `renderer/hooks/useDrillSession.test.ts`, `renderer/components/DrillPanel.tsx`,
  `renderer/components/DrillPanel.module.css`, `e2e/drill.spec.ts`
- **Notes for the implementer:** `advanceDrill(session, attempt)` is a pure function and the whole
  rule lives in it; the hook holds no branching of its own. An attempt counts as clean when every
  bar in the drill's range verdicts `clean` — `timing` does not pass, `unalignable` and
  `notAttempted` never pass, and a bar outside the range cannot affect it because the slice has no
  such bars. **`notAttempted` is load-bearing here, not defensive.** ADR-0010 makes an unplayed
  tail free, so a player who plays the drill's first bar cleanly and stops produces an attempt with
  no wrong notes in it; only the `notAttempted` tail distinguishes that from a pass, and without
  the check the loop would advance on half a bar. The streak resets to zero on any non-clean attempt rather than decrementing. The
  player can skip a drill and can end the session; both are transitions in the machine, not
  escapes from it. The closing re-test aligns against the **parent** timeline, which is the whole
  reason it exists.
- **Done when:** Given a drill list of two, the machine advances only on the second consecutive
  clean attempt and a clean-then-wrong-then-clean sequence leaves it on the first drill with a
  streak of one. A `timing` verdict does not advance. Skipping the first drill moves to the
  second with the first recorded as skipped, not passed. An attempt that plays the drill's first
  bar cleanly and then stops does **not** count as clean and does not advance the streak, which is
  the ADR-0010 interaction and is asserted directly. When the last drill passes, the session
  enters the in-context re-test and that re-test is scored against the full score's timeline, not
  a slice. End to end: a drill port that plays the range wrongly, then cleanly, then cleanly
  drives the panel from "again" to the next drill.

### Phase 5 — The app demonstrates the passage, slowly
- **Owner skill:** dev
- **What:** A Listen control on the drill: the passage plays out to the instrument at a reduced
  tempo before you attempt it.
- **Files touched:** `renderer/components/DrillPanel.tsx`, `renderer/hooks/useDrillSession.ts`,
  `renderer/views/Score.tsx`, `e2e/drill.spec.ts`
- **Notes for the implementer:** This is Plan 0004's transport called with the drill's bar range
  and a tempo multiplier; nothing new is scheduled and nothing new is sounded. The reduced tempo
  is a property of the demonstration only — no attempt is judged against it, and the aligner stays
  tempo-free. Listening must not arm the recorder, and stopping a demonstration must leave nothing
  sounding (NFR 13, which Plan 0004 asserts and this phase must not undermine).
- **Done when:** Listen on a drill covering bars 4 to 6 emits `player:event` for the notes of bars
  4 to 6 and for no others, and at half the written tempo the last onset falls at twice the
  written offset. Listening does not create a take. Stop during a demonstration leaves zero notes
  sounding, asserted the way Plan 0004 asserts it.

### Phase 6 — The session is judged once, not forty times
- **Owner skill:** dev
- **What:** When the session finishes, `core/` compresses the whole thing — every drill, the
  sequence of attempts on each, whether it passed, and how the in-context re-test went — into one
  `SessionSummary`, and the drill panel shows it. If a coach provider is configured, one Analyse
  button asks about the session; if not, the summary still renders and the button is simply absent.
- **Files touched:** `core/src/drill/sessionSummary.ts`, `core/src/drill/sessionSummary.test.ts`,
  `core/src/drill/types.ts`, `core/index.ts`, `shared/coach.ts`,
  `renderer/components/DrillPanel.tsx`, `renderer/components/DrillPanel.module.css`,
  `renderer/hooks/useDrillSession.ts`, `e2e/drill.spec.ts`
- **Notes for the implementer:**
  - **The subject is the sequence, not the takes.** Per drill: the bar range, why it was picked,
    the ordered attempt verdicts, how many attempts it took, whether it passed or was skipped, and
    — the part that carries the teaching — *what kept going wrong*, as the recurring fault across
    that drill's failed attempts rather than a list of each attempt's faults. Then the session's
    own shape: how long, how many drills offered against passed, and the in-context re-test's
    verdict, which is the only thing that says whether the fixes survived contact with the piece.
  - **The budget is structural** and this is the same rule as Plan 0003 Phase 1, applied to a
    different axis: **size is a function of the number of drills, capped — never of the number of
    attempts.** A session of 40 attempts over 3 drills summarises to the same order as a session
    of 6 attempts over 3 drills. Per-attempt detail is aggregated into the recurring fault, not
    enumerated and then truncated. Truncating a long attempt list would satisfy the byte count and
    silently drop the end of the session, which is the half that shows whether it worked — do not.
  - Reuse Plan 0003's token approximation, its `CoachRequest`/`CoachReply` shapes, its
    `coach:ask` channel and its reply store unchanged. **This phase adds no IPC and no provider**;
    if it finds itself wanting either, the design is wrong. `SessionSummary` joins `TakeSummary`
    as a second member of the request union in `shared/coach.ts`, validated by its own Zod schema
    at the same boundary.
  - **Where the reply is saved.** Plan 0003 saves a reply beside its take so deleting the take
    deletes the advice. A session has no single take, so the session reply is saved beside the
    session's **last** take with every contributing take id listed inside it. That is a small,
    deliberate inconsistency with this plan's "the session dies with the view": the session
    *state* dies, but advice the player spent subscription quota on is kept, like every other
    reply. A durable session record belongs to roadmap item 5's store and is not retrofitted here.
  - The summary is shown **before** anything can be sent, exactly as Plan 0003 Phase 1 requires —
    it is the same trust surface, and a session summary names more of the player's playing than a
    take summary does.
  - A session ended early, or one where every drill was skipped, still summarises. A summary of a
    session with no attempts is not constructible.
- **Done when:** a session of 40 attempts across 3 drills serialises under NFR 7b's 6 000-token
  budget by Plan 0003's documented approximation, and a session with ten times the attempts over
  the same three drills stays within a small constant factor of it — asserted as a ratio, which is
  the property that keeps the budget true for sessions nobody has played yet. A drill that was
  failed three times on the same wrong pitch and then passed reports that pitch once as the
  recurring fault, not three times. A skipped drill is distinguishable in the summary from a
  passed one and from one never reached. The in-context re-test's verdict is present, and a
  session ended before the re-test says so rather than omitting the field. End to end on
  `virtual:drill:pickup-two-hands:1-2`: driving a full session produces one summary in the panel;
  with the `fixture` coach provider selected, one Analyse press returns one reply covering the
  session, and it is on disk beside the session's last take; with the `none` provider the summary
  still renders and no Analyse button is present (NFR 3).

### Phase 7 — At the piano, with a passage you actually cannot play
- **Owner skill:** human
- **What:** The user runs the loop on real repertoire and answers what the generator cannot ask.
- **Files touched:** this plan's `## Implementation log`
- **Done when:** all nine answered in the log.
  1. Does the "work on these" list name the bars you would have chosen yourself?
  2. Is one bar of run-up enough to get into the passage, or do you want two?
  3. Does the re-arm between attempts break the rhythm of practising? This is ADR-0011's accepted
     cost and this is where it is judged.
  4. Is "clean twice running" the right bar — too easy, too strict, or right?
  5. Does the in-context re-test at the end feel like it tested the right thing?
  6. Does the slow demonstration help, or do you skip it?
  7. After a real session: how many take files did it leave, and does that bother you?
  8. Read the session summary before sending it. Does it describe the session you just had — in
     particular, does the recurring fault per drill match what you know you kept doing wrong?
  9. **Is one answer about the whole session more useful than an answer per attempt would have
     been?** This is the decision this plan is making on the player's behalf, and item 9 is the
     only thing that can check it. A "no" is a finding about the grain, not about the prompt, and
     it is recorded here rather than fixed in this phase.

## Data shapes

```ts
// illustrative — the Zod schemas in shared/ are what is real

/** A bar range of one score, worst first. Produced by selectDrills. */
type Drill = {
  /** Inclusive, in the parent timeline's bar indices. Includes the run-up. */
  fromBar: number
  toBar: number
  /** The bars that earned the drill, excluding the run-up. */
  targetBars: readonly number[]
  /** Why it was picked, for the panel to say out loud. */
  reason: 'notes' | 'timing'
}

/** The loop's whole state. Session-scoped; nothing is written to disk. */
type DrillSession = {
  scoreId: string
  drills: readonly Drill[]
  index: number
  /** Consecutive clean attempts on the current drill. Resets to 0, never decrements. */
  streak: number
  attempts: readonly { drillIndex: number; takeId: string; clean: boolean }[]
  phase: 'idle' | 'listening' | 'armed' | 'recording' | 'verdict' | 'inContext' | 'done'
}

const CLEAN_STREAK_TO_ADVANCE = 2 // a tunable of this plan, not of ADR-0011

/** What the coach is asked about, once, when the session ends. Sibling of Plan 0003's
 *  TakeSummary in shared/coach.ts. Size is a function of drills, capped — never of attempts. */
type SessionSummary = {
  scoreId: string
  scoreTitle: string              // user data, labelled as such in the prompt
  durationSec: number
  drills: {
    fromBar: number
    toBar: number
    targetBars: readonly number[]
    reason: 'notes' | 'timing'
    attempts: number
    verdicts: readonly ('clean' | 'wrong' | 'timing' | 'short')[]   // ordered, capped
    outcome: 'passed' | 'skipped' | 'notReached'
    /** The fault that recurred across the failed attempts — aggregated, never enumerated.
     *  This is the field that makes the summary about a trajectory instead of a pile. */
    recurringFault?: { kind: 'wrongPitch' | 'missing' | 'extra' | 'timing'; detail: string }
  }[]                             // capped; one entry per drill, not per attempt
  inContext?: { attempted: boolean; cleanBars: number; totalBars: number }
}
```

## Risks & open questions

- **The re-arm gap eats the first notes of the next attempt.** The recorder must close a file and
  open another, and a player in a rhythm will start before it is ready. Mitigation: the armed
  state is unmistakable on screen (Phase 3) and the machine will not accept events until it is
  armed. Phase 7 item 3 is where we find out whether that is enough; if it is not, the answer is
  the rejected Alternative A of ADR-0011 and it needs a superseding record, not a tweak.
- **A drill's report has no context**, so a player who is early into the drill's first bar because
  of what preceded it is told nothing. This is ADR-0011's named cost and the in-context re-test is
  the recovery. If Phase 7 item 5 says the re-test does not catch it, a two-bar run-up (item 2) is
  the cheaper fix than context-aware scoring.
- **"Clean twice running" may be unreachable on a hard passage** and turn the loop into a wall.
  `CLEAN_STREAK_TO_ADVANCE` is one constant and the panel always offers Skip, so the failure mode
  is annoyance rather than a trap. Phase 7 item 4 sets the number.
- **Take file proliferation.** Twenty attempts is twenty files and nothing prunes them. No
  mitigation in this plan by decision; Phase 7 item 7 decides whether it needs one.
- **The session grain may be the wrong grain.** This plan decides on the player's behalf that one
  answer about a session beats forty answers about attempts. The token argument is solid and
  measured; the teaching argument is a belief. It is invisible to every test here — a summary can
  serialise under budget, name the right recurring faults, and still produce advice less useful
  than a per-attempt "no, that was the same wrong note again" would have been. Phase 7 item 9 is
  the only thing that can catch it, and the recovery is cheap: Plan 0003's per-take Analyse still
  exists and a drill attempt is a take, so offering both grains is a followup rather than a
  rewrite.
- **The recurring fault is the one piece of real inference in this plan.** Everything else here is
  selection and slicing. "What kept going wrong across these four failed attempts" is a judgement
  compressed into one field, and getting it wrong makes the coach confidently specific about
  something that did not happen. Keep it conservative: a fault that appears in a minority of the
  failed attempts is not recurring, and the field is optional for exactly that reason.
- **Offline (NFR 3) and pins (NFR 9) are untouched** — this plan adds no dependency and makes no
  network call. Phase 6 reaches the network only through Plan 0003's `anthropic-api` provider,
  which already owns that; nothing in `core/` or the renderer gains a network path. Latency is not on this plan's path either: nothing here is in the key-to-pixel
  route, and the alignment turnaround (NFR 12) can only improve, since a drill's timeline is a few
  bars rather than a few hundred.

## What this plan does NOT do

- **No tempo target, no click, no ladder.** Judging against a beat is Plan
  [0006](0006-the-metronome-and-the-score-follows.md). "Slower" here means the demonstration plays
  slower and nothing else.
- **No store and no scheduling.** The session dies with the view. Spaced repetition, due dates and
  the "seen" ledger are roadmap item 5, and the backlog's decision 2 is why they are not here.
- **No new drill material.** A drill is a range of a score you imported. Generated exercises are
  roadmap item 5, and they wait on the question ADR-0005 reopened.
- **No live feedback during an attempt, and no coaching during one.** The verdict arrives when the
  attempt ends, exactly as Plan 0002 established; the coach is asked once, after the session, and
  never automatically. Live bar-by-bar feedback remains Plan 0002's followup and live coaching
  remains ruled out for the project.
- **No per-attempt Analyse.** A drill attempt is a take and Plan 0003's per-take Analyse would
  technically work on one; this plan does not offer it in the drill panel, by the decision above.
- **No repeat unfolding.** Inherited from Plan 0002: a drill on a bar inside a repeat is a drill
  on the bar as written once.

## Implementation log

> Written by `dev`, one row per phase as that phase's commit lands, and the close block after the
> last one. **The phases above are the contract; everything here is what happened.** Observations,
> never conclusions. A deviation from the plan or an unmet done-when is always disclosed.

**Lane:** _(`main` directly, or the worktree path plus its branch)_

| phase | owner | state | commit |
|---|---|---|---|
| 1 — The worst bars become a list you can act on | dev | not started | |
| 2 — A drill is a bar range of the score | dev | not started | |
| 3 — You play the passage and it says clean or not | dev | not started | |
| 4 — Two clean in a row, and the loop moves on | dev | not started | |
| 5 — The app demonstrates the passage, slowly | dev | not started | |
| 6 — The session is judged once, not forty times | dev | not started | |
| 7 — At the piano, with a passage you actually cannot play | human | not started | |

### Measurements

_(NFR 11: frames and the reported millisecond distribution, per phase that ran the gate)_

- **NFR 7b (Phase 6):** a 40-attempt, 3-drill session summarises to _ tokens by Plan 0003's
  documented approximation, against a budget of 6 000; the 400-attempt session to _ .

### Notes

_(deviations, unmet done-whens, followups noticed and not acted on; one line each)_

### Close triggers

- **What shipped:** _(feature / fix-only / docs-chore-only)_
- **User-visible docs touched:** _
- **Full gate at the last phase:** _
- **Outstanding `human` phases:** _

## Followups (after this lands)

- **Pruning drill takes**, if Phase 7 item 7 says the pile bothers the player. The cheapest form
  is a retention rule in the Takes view, not a new store.
- **A two-bar run-up**, if Phase 7 item 2 asks for it. One constant.
- **The drill queue surviving a restart**, which is the first thing that genuinely needs roadmap
  item 5's store and should not be retrofitted before it.
- **Drilling from the coach's advice** rather than from the report — Plan
  [0003](0003-the-coach-speaks.md) names bars in prose, and turning "work on the left hand in bar
  12" into a drill is the return leg of the bridge Phase 6 builds: the loop feeds the coach, and
  the coach's reply feeds the next loop.
- **Offering the per-attempt grain as well**, if Phase 7 item 9 says one session-level answer is
  not enough. A drill attempt is already a take and Plan 0003's per-take Analyse already works on
  takes, so this is a button, not a design.
- **Comparing sessions**, once there is a store: "you drilled these same two bars last Tuesday"
  is the thing a session summary makes possible and a take summary never could. Roadmap item 5.
- **Interleaving the queue** rather than draining it worst-first, which the backlog's evidence
  says tests worse in the session and better a week later. It needs the store to be worth
  measuring.
- The `architect` review decides whether ADR-0011 moves to `accepted`.
