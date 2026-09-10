# ADR-0014 — Timing is judged against a local tempo, not one line through the take

> **Status:** proposed
> **Date:** 2026-09-10
> **Related plan(s):** Plan [0008](../plans/0008-the-timing-model.md)

## Context

Plan 0002 fits **one** tempo to a whole take by least squares over every matched pair
(`core/src/align/tempo.ts`), and a bar's timing verdict is its mean signed distance from that one
line, flagged past 45 ms (`TIMING_THRESHOLD_MS` in `core/src/align/report.ts`). The plan knew the
cost and wrote it down: "a rallentando reads as error, which is accepted for this version and is
the first thing Plan 0002 Phase 7 asks the player about."

Phase 7 asked, at the CK88 on 2026-09-10, and the answer is that the cost is larger than the
plan estimated. Measured against the real take (Bach BWV 846, 168 note-ons, a deliberate false
start: four bars, stop mid-bar, back one bar, continue):

```
counts        144 correct, 0 wrongPitch, 0 missing, 24 extra
bars          7 of 9 attempted bars read `timing`
deviations    -2450, +2105, -1235 ms
fit           53.4 qpm, where the player played about 64; rms 1671 ms against a 45 ms threshold
residuals     +1741 +1701 +1628 ... +18 -39 ... -1130 -1191
```

The residuals are the diagnosis. They form a **monotonic ramp** from +1.7 s through zero to
-1.2 s. That is not a pause and not bad playing: it is a slope error. Replaying a bar gives one
score position two different times, which a straight line cannot represent, so least squares
compromises, the slope flattens, and every note inherits an error growing linearly with distance
from where the wrong line crosses the right one.

Two consequences follow, and the second is what makes this a decision rather than a tuning
exercise. **A global reference propagates a local disturbance to the entire take, backwards as
well as forwards** — bars *before* the restart were flagged, because least squares is global. And
**the player cannot recover.** In their words: "once timing is wrong I can't go back to right
timing after." That is a true description of the mechanism, and no threshold fixes it: at an rms
of 1671 ms the threshold would have to be thirty-seven times its current value, at which point it
reports nothing at all.

It also makes Plan 0002's own Phase 7 item 6 — play the same piece well and badly, do the
statistics tell them apart — **unanswerable**, because both takes read out of time throughout.
Plan 0002 cannot close on a scoring path that cannot distinguish the two things it exists to
distinguish.

The scope is bounded by a decision already taken. ADR-0012 gives the metronome its own scoring
path and preserves this one explicitly: "alignment stays tempo-free when there is no click, which
is what every test in `core/src/align/` defends today." This ADR is about the no-click path only.

## Decision

**A bar's timing is judged against a tempo fitted from its own neighbourhood, and never against a
line fitted across the whole take.** For each bar, a local tempo is fitted from the matched pairs
in a window of bars either side of it, and the bar's deviation is measured against that local
reference.

**The window excludes the bar under test.** A reference fitted from data that includes the bar
being judged moves to meet it, and a bar can barely deviate from a line drawn partly through
itself; a rushed bar would then flag nothing. Leaving it out is what makes "you rushed bar 12" a
statement about bar 12 against the tempo its neighbours were keeping.

Three things follow from the local reference and are part of this decision:

- **A rallentando is followed, not punished.** The local trend slows with the player, so a bar
  inside a ritardando sits on its own neighbourhood's line. It is reported as a tempo observation
  — what changed, over which bars, by how much — and never as a bar in error.
- **A restart is detected and named** rather than absorbed. The player going back over music they
  have already played appears as a run of played groups the matcher has no score left for, over a
  stretch it has already covered. Those notes are reported as a restart, not as extra notes and
  not as mistakes.
- **The single tempo figure becomes the steady-state tempo**, taken from the local tempi where the
  player was steady, so it stops being an average of a restart and a performance.

`BarVerdict.timingDeviation` keeps its units, its sign convention and its name, and **changes its
reference**: milliseconds from the local tempo rather than from the global line.

## Consequences

### Positive
- **The player can recover.** A disturbance is confined to the windows that span it; the bars
  before it and the bars well after it are judged against tempi they actually had.
- Plan 0002 Phase 7 item 6 becomes answerable, which is what unblocks that plan's close.
- Rubato stops being a defect the app reports and becomes something it can describe, which is
  closer to what a teacher says.
- The rushed-bar property survives, and is in fact sharper: a bar is now compared with the tempo
  around it rather than with an average over material minutes away.
- Nothing in the matcher changes. Tempo is fitted after the match, over pairs `align.ts` already
  produces, so the tempo-freedom every test in `core/src/align/` defends is untouched.

### Negative
- **A take that is uniformly and deliberately wrong is invisible.** A player who rushes the entire
  piece evenly has a local tempo that matches their rushing everywhere, so no bar is flagged. That
  is the correct answer for a tempo-free path — nothing said what tempo to keep — and it is
  precisely the gap ADR-0012's metronome fills. The two paths are complementary by design, and
  neither is complete alone.
- **A window has a size, and the size is a judgement.** Too narrow and the reference chases the
  player, forgiving real unevenness; too wide and it reapproaches the global line. The number is
  chosen with reasoning in the code and its *effects* are asserted, never the number itself.
- **Timing verdicts near the ends of a take rest on less evidence**, since a window at bar 0 has
  neighbours on one side only. A bar whose window is too thin reports no timing verdict rather
  than a confident one from three samples.
- `timingDeviation` changing reference is a **seam change**. Plan 0003's coach summary reads it,
  and a number that meant "distance from the take's tempo" now means "distance from the local
  tempo". Same units, different sentence; the coach's prompt has to say the new one.
- More arithmetic per bar than one fit over the take. It stays linear in the matched pairs, so
  NFR 12's stated shape holds, but the constant is larger.

### Neutral
- The take file and `ExpectedTimeline` are untouched. This is a change to how a report is computed
  from a match, not to anything on disk.

## Alternatives considered

### Alternative A — Segment the take at restarts and fit one line per segment
Split where the player restarted or paused, fit a tempo to each stretch, judge each bar against
its own stretch. Restarts fall out for free and it is the easiest to explain. Rejected because it
solves only the discontinuity and not the drift: a long segment containing a rallentando has
exactly tonight's problem over a shorter span, and a ritardando into a final cadence is the single
most common expressive thing a pianist does. It fixes the take that was measured and not the class
of takes it belongs to.

### Alternative B — Judge evenness only, with no tempo reference at all
Score a bar on whether its notes are evenly spaced relative to one another and ignore where the
bar sits in time. Immune to restarts, pauses and rubato by construction, and the simplest thing
that could work. Rejected because it discards the feedback that is most useful: it cannot say a
bar was rushed or dragged relative to the music around it, since a bar played evenly at half speed
is internally perfect. Plan 0002's `rushBar` test asserts exactly that ranking, and it would have
to be deleted rather than kept.

### Alternative C — Keep the global line but fit it robustly
Theil-Sen or RANSAC instead of least squares, so a replayed passage is an outlier group that
cannot drag the slope. Genuinely fixes the restart case and is a small change. Rejected because a
robust *global* line is still one line: a rallentando is not an outlier, it is half the data, and
a robust estimator either follows it and misjudges the opening or ignores it and misjudges the
end. It also leaves the propagation property untouched — the reference is still global, so the
player still cannot get back to right timing after going wrong.

### Alternative D — Widen the threshold
Raise `TIMING_THRESHOLD_MS` until ordinary takes stop going orange. Rejected on the measurement:
the rms of the false-start take is 1671 ms, so the threshold would need to be around 37 times its
current value to pass it, and at that width it would not report a bar the player held for a second
too long. It treats a symptom whose cause is known and is not a threshold.

## Notes

The diagnosis was made by running the shipped aligner over the take file in `userData/takes` and
the score in the library, not against a reconstruction. Plan 0008 carries the work; its oracle
gains a restart and a rallentando perturbation, each declaring its own expected verdict, before
the local model that has to satisfy them is written — the ordering Plan 0002 adopted for the same
reason, that an oracle written after the thing it tests tends to agree with it.

ADR-0011 makes each drill attempt in the practice loop its own take, which shortens takes and
reduces the exposure to this defect. It does not remove it: a single attempt can still contain a
hesitation, and a player practising outside a drill is in exactly tonight's case.
