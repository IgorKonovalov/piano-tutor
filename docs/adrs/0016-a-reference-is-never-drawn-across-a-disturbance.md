# ADR-0016 — A reference is never drawn across a disturbance

> **Status:** proposed
> **Date:** 2026-09-10
> **Related plan(s):** Plan [0009](../plans/0009-a-bar-is-judged-note-by-note.md)

## Context

ADR-0014 replaced a global timing reference with a local one and gave the reason in one sentence:
a line fitted from data that includes the thing being judged moves to meet it. Plan 0008
implemented that exclusion for **the bar under test** and for nothing else. At the CK88 on
2026-09-10 the omission showed up three times in one evening, in three different mechanisms, and
they are one bug.

**A disturbed bar drags the bars beside it.** `localTempo` takes its window as one bar either
side, and it collects gaps beginning with the one that *ends* at the bar's first arrival and the
one that *leaves* its last. Those two gaps belong to the boundary, and when the disturbance is in
bar 2 they are the distorted ones. Judging bar 1 therefore draws part of its reference through
bar 2's mistake. Measured (Plan 0008 Phase 6 item 3): one bar rushed, and bars 1, 2 and 3 report
+200, -619 and +314 ms while the bar the hand actually hurried reads as written.

**A bar the player went back inside is measured across the detour.** A restart is detected and
named, but nothing splits the arrivals at it, so a bar with matched groups on both sides of the
seam has its own pace fitted straight through the gap. Measured (Phase 6 item 2): **+3992 ms** on
that bar, with the whole rest of the take clean. Plan 0008 carried this as an open question in its
`## Risks` — "whether a restart should also split the tempo curve, rather than only being
reported" — and Phase 6 answered it with a number.

**A tempo observation reads across the seam and reports nonsense.** "You pressed on 240 % over
bars 39 to 41" (Phase 6 item 5). The observation machinery walks the bar-pace curve looking for
monotonic runs, and a curve with a restart in it has a step change that is not a tempo at all.

Three symptoms, one cause: **every reference in the model is still allowed to draw through a
disturbance it should not see.** ADR-0014 fixed the one case it was looking at.

## Decision

**No reference is computed across a disturbance, anywhere in the model.** A disturbance is a place
in the take where consecutive arrivals, in score order, are not consecutive in performance — the
player went back, or stopped long enough that the elapsed time says nothing about their tempo.
Where one exists, it becomes a **seam**, and:

- **A neighbouring bar's window excludes the gaps that touch the bar under test.** `localTempo`'s
  window is drawn from the gaps lying *entirely inside* the neighbouring bars. Bar 1's reference
  never contains a gap that ends or begins in bar 2.
- **No pace is fitted across a seam.** Not the local window, not the bar's own pace, not the
  steady-state figure. A bar containing a seam reports no timing verdict of either kind rather
  than a confident number computed across the player's detour.
- **No tempo observation spans a seam.** A monotonic run of bar paces ends where a seam begins.

A seam is earned by evidence, not assumed: the arrivals a restart accounts for (`findRestarts`
already identifies them) and any gap between consecutive arrivals whose elapsed time is wildly out
of proportion to the pace the player was mostly keeping — the same `STEADY_FACTOR` reasoning
`steadyTempo` already uses to decide which gaps were the tempo and which were not.

**A pause is not a disturbance of the playing, and stays free.** NFR 14 says a take played evenly
reports no timing error however the take is structured, and a player who stops between two bars
for a page turn has played evenly. A seam removes the pause from every *reference*; it never
produces a verdict, and the bars either side are still judged on their own merits.

## Consequences

### Positive
- **The propagation property finally holds at every level.** ADR-0014 promised a player who goes
  wrong can get back to right timing; with the boundary gaps excluded, a mistake is confined to
  the bar that contains it rather than to a three-bar neighbourhood.
- The +3992 ms bar disappears, and with it the last case where a number in the report is not a
  fact about the playing.
- The nonsense observation disappears for the same reason, without a special case for it.
- **One rule replaces three fixes.** A future reference — ADR-0012's click-relative path, a drill's
  attempt-to-attempt comparison — inherits the rule instead of rediscovering it.

### Negative
- **Fewer verdicts.** A bar next to a seam, and a bar whose neighbour is too sparse once the
  boundary gaps are gone, report nothing rather than something. On a piece with four arrivals a
  bar this bites: excluding boundary gaps leaves three interior gaps in a four-arrival bar, and
  `MIN_LOCAL_GAPS` is two, so it holds — but a three-arrival bar next to the seam does not.
  Silence is the correct answer and it is still a loss.
- **A seam is a threshold**, and a gap "wildly out of proportion" needs a number. It is chosen
  against the same measured floor as everything else here, and a take that hesitates constantly
  will have seams the player would not call seams.
- The bar-pace curve becomes a curve **per segment**, which every consumer has to respect — the
  observations, the steady tempo and anything Plan 0005's drill comparison later builds.

### Neutral
- Restarts are still detected exactly as they are today; this decides what the rest of the model
  does with the fact, not how it is found.

## Alternatives considered

### Alternative A — Report the restart and let the windows straddle it
What Plan 0008 shipped, and the cheapest thing: name the restart in words, leave every reference
alone. Rejected on the measurement — +3992 ms on the bar the player went back inside, which is not
a small error at the edges but the largest number in the whole report, and it lands on the bar the
player was most careful about. It also leaves the observation machinery free to describe a step
change as a rallentando.

### Alternative B — Widen the window so a disturbance is diluted
Take the reference from two or three bars either side, so one bad bar is a smaller share of it.
Rejected because it walks back towards the global fit ADR-0014 rejected: Plan 0008 measured a
window of two bars reading a rallentando's middle bar 72 ms out where a window of one read it 3 ms
out. Dilution trades the propagation defect for the rubato defect, which is the trade that ADR
exists to refuse.

### Alternative C — Segment the take at seams and fit one reference per segment
ADR-0014's rejected Alternative A, re-examined at the reference level rather than the take level.
Now partly adopted and still rejected as the whole answer: a segment is exactly what a seam
creates here, but the reference *within* a segment stays local. A long segment containing a
ritardando has ADR-0014's original defect over a shorter span, which is the reason that ADR gave
for rejecting it, and it has not changed.

### Alternative D — Drop the leftover arrivals a restart accounts for and renumber
Delete the repeated pass from `timed` altogether, so no seam exists to reason about. Tempting, and
wrong in the case that matters: the player who goes back *inside* a bar leaves the score's own
arrivals matched on both sides of the detour, so there is nothing to drop — the seam is between
two arrivals the score does contain. Deleting the repeat also throws away the evidence that the
second pass was the better one, which a drill comparison will want.

## Notes

The three symptoms were found in one evening because there was finally a report worth reading;
none of them is reachable by the generated oracle, which is [ADR-0017](0017-the-oracle-gains-recorded-playing.md).
`rushBar` produces no boundary distortion that a median over four gaps cannot absorb,
`restartAtBar` goes back to a bar boundary rather than into the middle of a bar, and no generated
take hesitates. Each of those is a gap in the generator, and each is a gap a hand fills without
trying.
