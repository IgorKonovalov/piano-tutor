# ADR-0010 — Alignment ends where the player stopped: an unplayed tail is free

> **Status:** accepted 2026-09-11, on the close of Plan 0002
> **Date:** 2026-09-10
> **Related plan(s):** raised at the piano during Plan
> [0002](../plans/done/0002-a-piece-is-practised.md) Phase 7; implemented as a scoped change outside a
> plan, because Phase 7 cannot be answered on a build that has this defect

## Context

The aligner of Plan 0002 is a banded edit distance from `(0, 0)` to `(n, m)`: **every** expected
group must be consumed by the path, as a match or as a deletion. Deleting the tail of a piece the
player never reached is therefore not a choice the matcher makes, it is an obligation, and its
cost is paid on every candidate path equally.

Measured at the instrument on 2026-09-10, against the real take and the real score. Bach, BWV 847,
69 bars, 1 851 notes, **1 028 expected groups**. The player played the opening — 117 note-ons,
**73 played groups** — and stopped. What the report said:

```
matched expected indices  0,1,2,...,16,  34,36,38,...,50,  82, 129..141, 176..196,
                          528, 543, 594, 700, 713, 735, 761, 776, 791, 851, 911, 945
counts                    correct 94, wrongPitch 17, missing 1585, extra 6
fittedTempo               2663 bpm
notAttempted              7 bars of 69
```

The first seventeen groups matched at difference 0 or 1: the player did play the opening, and the
matcher found it. Everything after that scattered across the whole score, out to group 945 of
1 028, each at a difference of one to three.

The economics are the whole explanation. The band is widened by the length difference, so here it
is `24 + |1028 - 73| = 979` and constrains nothing. Skipping an expected group costs
`pitches.length + 1`, roughly three or four; pairing a played group with *any* remotely similar
expected group costs one to three. A Bach prelude is a repeating semiquaver figuration over a
small pitch set, so almost every played group partially fits almost every expected group. Since
the path is obliged to reach row 1 028 either way, **spending a played group on a distant match is
cheaper than leaving it as an extra.** Scattering is not a bug in the search; it is the optimum of
the cost function as written.

Two further numbers follow from it mechanically, and both are what the player actually complained
about. `missing: 1585`, because the last match at group 945 puts `firstAbandonedBar` at bar 62, so
the gaps *between* the scattered matches are charged as missed notes rather than as a tail never
reached. And `2663 bpm`, because the tempo is least-squares-fitted over pairs whose score
positions span some 940 quarter notes while the clock spans about sixty seconds.

Nothing in 508 tests catches this. Every fixture score is three to seven bars and every generated
take plays to the end or stops one bar short; `n` and `m` are always within a few groups of each
other. **A partial take of a long piece is a regime the fixture corpus does not contain**, and it
is the regime every real practice session is in — nobody sits down and plays a 69-bar prelude
end to end while learning it.

## Decision

The alignment **ends where the player stopped.** The path must still consume every played group —
a note that was struck is always accounted for, as a match or as an extra — but it is no longer
obliged to consume every expected group. After the grid is filled, the endpoint is the row that
minimises the cost in the final column, earliest row winning a tie; the backtrack starts there,
and the expected groups beyond it produce no steps at all.

Those groups are **`notAttempted`**, which is what they already were called and is now what the
cost function says too: reaching the end of a piece the player never reached costs nothing,
because it did not happen.

The band keeps its widening by the length difference. It is still needed for the other direction —
a player who attempts the whole piece but drops many notes drifts from the diagonal by exactly
that much — and with a free tail it is no longer harmful, because scattering now has to pay for
every expected group it skips on the way out and back.

## Consequences

### Positive
- **Real repertoire becomes scoreable.** The failure above is not an edge case; it is what the
  application does on every piece longer than the fixtures whenever the player stops.
- `missing` recovers its meaning: a note inside the stretch the player attempted, not a note in a
  half of the piece they never opened.
- The fitted tempo is fitted over pairs from one stretch of the score, so it is a tempo.
- **The cost function now agrees with the vocabulary.** `notAttempted` was already a state the
  report could produce; it was simply not something the matcher believed in.
- Nothing about tempo-freedom changes. No clock enters the cost, and the endpoint is chosen from
  the cost grid, not from a timestamp.

### Negative
- **A player who stops early and then plays the coda is read as stopping early.** The tail they
  did play is beyond the chosen endpoint and its notes become extras against the stretch before
  it. Playing the piece out of order is not supported and now fails in a new way.
- **`unalignableFrom` still cannot fire for a partial take of a long piece**, because the run
  required is the band and the band is a thousand groups wide. This ADR does not fix that; it
  makes it matter less, since the wall of missing notes that made it urgent is gone. A followup.
- The endpoint is a second argmin pass over the final column, which is `n` more comparisons. It is
  linear and does not touch NFR 12's shape.
- One existing assertion changes meaning. A struck chord against a four-chord score used to
  produce three `missing` steps; it now produces none, and the report calls those bars
  `notAttempted`. The new answer is the correct one and the old test encoded the old model.

### Neutral
- The take file, the timeline, `PracticeReport` and every IPC payload are untouched. This is a
  change to one function's stopping condition.

## Alternatives considered

### Alternative A — Cap the band instead of freeing the tail
Stop widening by `|n - m|` and keep a fixed twenty-four groups, so the matcher cannot wander.
Rejected because it makes stopping early *unrepresentable* rather than cheap: the true path for a
take that ends at group 73 of 1 028 must travel down 955 rows in the final column, so a fixed band
excludes the correct answer entirely and the matcher returns the best of a set of wrong ones. The
widening is not the defect; the obligation to reach the last row is.

### Alternative B — Reject matches whose timing is inconsistent with the fitted tempo
Fit a tempo, discard pairs with wild residuals, re-match. Rejected on two counts. It puts a clock
inside the matcher, which `align.ts` is built not to have — its tempo-freedom is the property
every test in `core/src/align/` defends, and a piece played evenly at half speed must still match
perfectly. And it treats the symptom: the scattered matches are the optimum of the cost function,
so a filter after the fact leaves the search still preferring them.

### Alternative C — Refuse to score a take that covers too little of the score
Detect that 73 played groups cannot account for 1 028 expected ones and decline, showing "too
little of this piece to judge". Rejected because it is the common case, not the exceptional one.
Practising the opening of a long piece is the ordinary use of this application, and an app that
declines to help until you can play the whole thing has the requirement backwards.

## Notes

The diagnosis was made by running the shipped aligner against the take on disk
(`userData/takes`) and the score in the library, not against a reconstruction. The regression test
committed with the fix is synthetic — a long repetitive piece played imperfectly for its opening —
because the real take is the user's playing and does not belong in the repository.

`findUnalignable`'s inability to fire on a wide band is recorded in Plan 0002's followups rather
than fixed here, so this ADR stays about one decision.

## Outcome, 2026-09-11

Accepted on the close of Plan [0002](../plans/done/0002-a-piece-is-practised.md), and measured on
real playing at the CK88 the same day rather than only on the take that provoked it.

**It is the reason a partial practice session is readable at all.** Two takes of BWV 846, a 62-bar
score: one attempted 35 bars and one attempted 11. Missed notes came out at **1 and 0**. Without
this ADR they would have been roughly 27 and 51 bars' worth of missing, which is not a report a
player can learn anything from — the number they care about would have been buried under the tail
they had not reached yet.

**The regime it was written for turns out to be the normal one, not the exception.** The ADR was
raised against a take that played the opening of BWV 847 and stopped; both of these takes did the
same thing without being asked to, because that is what practising a piece is. A player works at
the part they are learning. The original diagnosis — 1 585 notes missing, a fitted tempo of
2 663 bpm — was not an edge case being handled, it was the ordinary case being repaired.

Nothing in the body is falsified and no part of it wants revisiting.
