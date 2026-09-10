# ADR-0011 — An attempt is a take: the practice loop repeats through the recorder, not through the aligner

> **Status:** proposed
> **Date:** 2026-09-10
> **Related plan(s):** Plan [0005](../plans/0005-the-practice-loop.md)

## Context

The deliberate-practice loop is repetition. You play two bars, they are wrong, you play them
again, and again, and the app tells you each time whether you got them. That motion — the same
short passage attempted many times in a row — is the whole feature, and it is the one motion
nothing in the codebase currently describes.

`align` matches **one** played stream against **one** expected timeline. Everything in
`core/src/align/` is built on that: the band is `24 + |expected - played|` groups wide, a run of
`band` steps sharing no pitch earns `unalignableFrom`, and `practiceReport` emits a verdict per
bar of the timeline. Hand it a take in which the player looped bar 5 six times and it does the
only thing it can: match one pass and call the other five extra notes. The close review of Plan
0002 already found the sharp edge of this from the other direction — `report.ts` emits one `extra`
verdict per unmatched played pitch, unbounded, so "a player who repeats a passage grows the report
without limit", which is the property NFR 12's stated method rests on.

So repetition has to be represented somewhere, and there are exactly three places it can go: in
the recorder (each attempt is its own take), in a new pure function between the recorder and the
aligner (one take, cut into attempts), or in the aligner itself (one take, a timeline known to
repeat). The choice is not about which is most convenient to write. It is about which of the three
is still true when the player is fumbling, because that is the only time a drill exists at all.

One fact decides it. Segmenting a continuous take into attempts means finding where the player
started over — and the signal for "started over" is a return to the drill's first notes. In a
clean run that signal is unambiguous and the segmentation is unnecessary. In a fumbling run the
player stops halfway, plays the first bar twice, hesitates, restarts from the middle, and the
signal is at its weakest precisely when the feature depends on it. A heuristic that is reliable
only when it is not needed is not a mechanism.

## Decision

Each drill attempt is its own take. The practice loop starts recording when the attempt begins
and stops when it ends, so what reaches `align` is one played stream against one timeline —
exactly the shape every existing test in `core/src/align/` already describes. `align`,
`practiceReport` and the take format are untouched by this plan.

The drill's expected timeline is a **bar-range slice of the score's own `ExpectedTimeline`**,
produced by a pure function in `core/` and valid against the same invariants the full timeline is
(`barTableProblems`, `noteBarProblems`). A drill is therefore not new material and not a second
expectation shape: it is the same piece, narrower. Nothing in the notation path, the alignment
path or the report path learns that drills exist.

Two consequences of that choice are load-bearing rather than incidental, and are part of the
decision:

- **`MINIMUM_NOTE_ONS` must admit a drill attempt.** The recorder discards a take under ten
  note-ons, and a two-bar drill can easily be eight. The loop tells the recorder that a short take
  is expected, rather than the threshold being lowered for every take in the app.
- **The loop owns the start and the stop.** The player does not press Practise and Stop once per
  repetition; the loop re-arms automatically after each verdict, so the repetition still feels
  continuous even though each attempt is a separate file.

## Consequences

### Positive

- **The aligner is not touched**, so every fixture test written for Plan 0002 continues to
  describe the drill case without being re-read. This is the whole reason the option was chosen.
- **A drill attempt is an ordinary take**, so it records, flushes, survives a crash (NFR 8), reads
  back, appears in the Takes view and can be handed to the coach with no new path.
- **The carried Plan 0002 finding stops being on this plan's critical path.** Unbounded `extra`
  verdicts from a repeated passage are still a defect, but the loop no longer creates the
  condition, so the fix stays where the close review put it.
- **A slice is a valid timeline**, so the drill re-uses bar marking, the report, the statistics
  and the demonstration transport with no branch anywhere.

### Negative

- **A practice session produces a lot of small take files.** Twenty attempts at three bars is
  twenty takes on disk with twenty headers, and the Takes view will show them all. Nothing prunes
  them, and a pruning policy is deferred rather than designed.
- **The recorder gains a caller-supplied expectation.** `MINIMUM_NOTE_ONS` stops being a constant
  the recorder alone decides, which is a small widening of a seam that has been simple.
- **A gap between attempts is unavoidable.** The recorder must close and reopen a file, so there
  is a moment in which playing is not recorded. If the player runs straight on from one attempt
  into the next, the first notes of the next attempt can be lost, and the loop has to make the
  re-arm visible enough that they do not.
- **A drill's report has no context.** Aligning against a slice means the bars either side are
  invisible, so a player who is early into the drill's first bar because of what came before is
  told nothing about it. That is what the plan's final in-context re-test exists to recover.

### Neutral

- The take header already carries `scoreId` and gains nothing. Which bars an attempt was
  attempting lives in renderer session state, not on disk, which is the same call the roadmap
  made when it said the practice loop needs no new store.

## Alternatives considered

### Alternative A — One continuous take, segmented in `core/`

The player loops the passage without stopping; a pure function cuts the take into attempts at the
points where they return to the drill's first bar, and each segment aligns separately. It is the
nicest thing to use — no re-arm, no gap, no pile of files — and it would also answer the carried
review finding directly. Rejected because the segmentation is least reliable exactly where the
drill is most needed: a player working through a passage they cannot yet play produces false
starts, partial restarts and mid-phrase resumptions, and every one of those is a place the cut
lands wrongly. A wrong cut does not degrade gracefully — it reports a clean attempt as a failure,
which is the one error a practice loop must not make.

### Alternative B — `align` learns a loop mode

Teach the aligner that its timeline repeats N times and let it match a played stream against all
passes at once. Rejected on blast radius against benefit: it changes the function that every test
in `core/src/align/` defends, and it makes the report per-pass rather than per-bar, which is the
shape NFR 12's stated method ("the report it returns is sized by bars, not by events") rests on.
The seam this project protects hardest would be reopened to buy a button press.

### Alternative C — Drills as generated material

Emit each drill as its own score — MusicXML or a standalone timeline — rather than as a slice of
the parent. Rejected because it walks straight into the open question the backlog explicitly says
should wait ("what the generator emits", reopened by ADR-0005), and it buys nothing: a slice
already draws, because the parent score is already engraved and the bars are already addressable.

## Notes

The pass rule the loop applies — every bar in the drill range verdicts `clean` on two consecutive
attempts — is a tunable of Plan 0005, not part of this decision. It is recorded there so that
changing it does not need a superseding ADR.
