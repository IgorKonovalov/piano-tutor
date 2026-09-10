# ADR-0015 — A bar is judged twice: the pace it kept, and the shape of its arrivals inside it

> **Status:** proposed
> **Date:** 2026-09-10
> **Related plan(s):** Plan [0009](../plans/0009-a-bar-is-judged-note-by-note.md)

## Context

ADR-0014 moved the timing reference from one line through the take to a tempo fitted from each
bar's neighbours, and Plan 0008 shipped it. Taken to the CK88 on 2026-09-10, the half of it that
concerns a *disturbance* held: a false start is named, the bars before it stay clean, the tempo
figure is one the player recognises. The half that concerns a *mistake* did not.

The measurement, from Plan 0008's `### Phase 6 at the piano`, item 3. One bar rushed deliberately
in an otherwise even take:

```
bar 2   -619 ms   out of time
bar 3   +314 ms   out of time
bar 1   +200 ms   out of time
the bar the player actually rushed        as written
```

Three bars amber, and not the one the hand hurried. The player's own reading was the diagnosis:
*"i think that we measure time between bars, not individual notes - we should measure notes taking
into account everything."*

That is exactly what the code does, and its own comment says so. `barDeviation` in
`core/src/align/report.ts` compares the bar's **fitted pace** with the local reference and states
the cost in place: "unevenness *inside* one bar, where the notes drift but the bar keeps its
overall pace, is not what this reports." A hand does not rush a bar the way the oracle does. The
generator's `rushBar` compresses every gap in the bar by one factor, which changes the bar's pace
and is duly caught; a player hurries three notes in the middle and arrives at the next bar on
time, which leaves the bar's pace almost untouched and its interior ragged. Every seeded test
passes and the property is not there.

**The obstacle in front of the obvious repair is measured, not hypothetical.** Plan 0008's Phase 2
wrote a note-level residual first and dropped it: reading a bar through its individual arrivals
against the local pace put a clean take's worst bar at 22 ms and a rallentando's at 55 ms, past
the 45 ms threshold then in force. Two things did that. The measure inherited the jitter of the
single note-on the line was anchored on, and a bar played inside a ritardando curves away from any
straight line. The second is arithmetic, and it decides the design, so it is worked here over a
bar of the Prelude — sixteen arrivals, 3 750 ms at the tempo the player kept:

| the bar contains | rms against a **line** | rms against a **quadratic** |
|---|---|---|
| a smooth ritardando, 10 % across the bar | 16 ms | **0 ms** |
| a smooth ritardando, 25 % across the bar | 40 ms | **0 ms** |
| keystroke jitter alone, sd 20 ms | 20 ms (p95 35) | 20 ms (p95 26) |
| three of sixteen notes hurried to 75 %, caught up by the barline | 57 ms | 49 ms |
| the same, hurried to 60 % | 92 ms | 78 ms |

Two readings of that table matter. **The curvature vanishes exactly against a quadratic**, because
a pace changing linearly integrates to a quadratic in time — the ritardando is not approximately
removed, it is removed. And against a line, a violent ritardando (40 ms) is indistinguishable from
a genuinely hurried bar (57 ms), which is the 55-against-45 measurement that killed the first
attempt, recovered from first principles.

The last row of the table is also the diagnosis of Phase 6 item 3, in one number that needs no
instrument: **that bar's total duration is unchanged**. The hand takes three notes early and gives
them back before the barline, so the bar's pace is what it was written to be and
`timingDeviation` is exactly zero. The bar did not read `as written` because the threshold was
wrong. It read `as written` because nothing was measuring.

So the per-arrival residual is not a small change to the current measure; it is a different
measure with its own noise floor — the hand's own jitter, and nothing else — and it is usable only
against a null that does not punish smoothness.

What is *not* in question is the atom. The aligner already reduces both sides to **onset groups**
(`core/src/align/onsetGroups.ts`): a chord is one arrival with one time, because judging the notes
of a rolled chord separately turns one gesture into four timing errors. Every matched arrival is
already carried, with its bar and its score position, in `report.ts`'s `timed: BarredPair[]`. The
data this ADR needs exists; the model averages it away per bar before it compares anything.

## Decision

**A bar carries two timing numbers, and either one can call it out.**

- **`timingDeviation` keeps its name, units and meaning**: how far this bar's overall pace sat from
  the pace the bars around it were keeping (ADR-0014). "You took this bar faster than the music
  around it."
- **`timingShape` is new**: how far this bar's arrivals sat from the smoothest curve the bar itself
  could be, in milliseconds, with the bar's placement *and* its overall pace removed before
  anything is measured. "Your pace through this bar was right; the notes inside it were ragged."

A bar's state is `timing` when **either** number is past its own threshold, and both thresholds
move together with the existing three-position strictness control. Each threshold is chosen from a
measured floor of correct playing, the way `STRICTNESS_MS` was, and never from taste.

**The null the shape is measured against is the smoothest thing the bar could have been**, which
is a quadratic in score position and not a straight line. A bar that speeds up smoothly through
itself is musical; a bar whose notes fall unevenly is not, and only the second is raggedness. The
table above is the whole argument: against a quadratic a ritardando reads zero and a hurried bar
reads 49 to 78 ms, and against a line the two are the same number.

**A bar with too few arrivals reports no shape**, exactly as a bar with no neighbours reports no
pace. A quadratic through three arrivals is exact and through four has one degree of freedom,
which is an estimate of raggedness made out of one number. The minimum is stated in the code with
its reasoning and, like both thresholds, is **chosen from a floor measured on recorded playing**
(ADR-0017) rather than picked — Plan 0008's Phase 2 procedure, which is what turned a
least-squares local fit into the median-of-gaps that actually works. `pickup-two-hands` and
`multi-rest-and-ties`, at one and two arrivals a bar, will never carry a shape verdict at all.
That is the same honesty ADR-0014 chose at the ends of a take, and it is why the recorded fixtures
are of a piece that is dense.

## Consequences

### Positive
- **The thing the player asked for.** A bar the hand hurried is reported as the bar the hand
  hurried, and the sentence says which of the two things went wrong.
- **The two numbers want different practice**, which is why they are two. "Ragged" is a
  hands-together, slow-it-down problem; "faster than the music around it" is a counting problem.
  One combined number would have told the player neither.
- **The floor of the shape number is the hand's own jitter and nothing else.** It reads no
  neighbours, so no disturbance anywhere else in the take can move it and it cannot propagate —
  the property ADR-0014 exists to protect, obtained here for free rather than by construction.
- ADR-0014's pace verdict survives intact, so `rushBar`, `barsByTiming` and every test in
  `core/src/align/` that ranks bars by timing keep their meaning.

### Negative
- **A bar that is evenly and smoothly wrong is invisible to both numbers.** Shape sees nothing
  because it is smooth, pace sees nothing when the neighbours did the same thing. This is
  ADR-0014's stated blindness, unchanged: with no click nothing said what tempo to keep, and
  ADR-0012's metronome is the path that fills it.
- **Two numbers cost a sentence.** The bar detail has to say which one fired, and the coach's
  prompt (Plan 0003) has to describe both. A report that says "out of time" without saying which
  kind is now the worse report, so nothing may keep saying it.
- **The quadratic null forgives an accelerando *within* one bar** by construction. A player who
  speeds up smoothly through every bar and resets at each barline is reported by neither number.
  That is a strange way to play and the price is accepted, but it is real.
- **Sparse pieces get less.** A bar of one or two arrivals carries no shape, so on chordal music
  this plan changes nothing at all.
- **The margin is thinner than the pace number's.** Plan 0008 could put its threshold fifteen
  times above the floor of correct playing; here the floor is the hand's own jitter and the signal
  is a hurried bar, which the table puts at about three times it. A player whose ordinary
  unevenness is 30 ms will see more amber than one whose is 10 ms, and the strictness control is
  the only answer this design has. It is the reason the thresholds are measured against **this**
  player's recorded takes rather than chosen.
- More arithmetic per bar, still linear in the matched arrivals. NFR 12's shape holds; the
  constant grows again.

### Neutral
- Nothing on disk changes. The take format, `ExpectedTimeline` and the alignment are untouched;
  this is a change to how a report is computed from a match.

## Alternatives considered

### Alternative A — Recurse ADR-0014 down a level: judge each arrival against its neighbours
Give every arrival a local pace from the arrivals either side of it, excluding its own two gaps,
and let a bar's verdict be the worst or the rms of its own arrivals' deviations. The most literal
reading of the player's words, and the most uniform: one rule at every level. Rejected as the
*primary* measure because it inherits precisely the failure it would be fixing. A reference drawn
from a window forgives any disturbance longer than the window, so a hand that hurries four
consecutive notes inside a bar of sixteen is followed rather than flagged, exactly as a whole
rushed bar is followed by a bar-level window; only the edges of the rush light up, and the player
is told the wrong notes were wrong. It also spends the noise budget on the worst possible term —
one keystroke's jitter, with nothing averaging it — which is the 22 ms measurement above. The
shape number keeps what is good in it, an evidence base of individual arrivals, and drops the
window that makes it blind.

### Alternative B — One combined number
Fold shape and pace into a single `timingDeviation` so nothing downstream changes: `BarDetail`,
`barsByTiming` and the coach summary all keep reading one field. Rejected because the two things
are different mistakes with different repairs, and a player who is told "bar 12 is 90 ms out"
cannot tell whether to practise counting or to practise evenness. The seam saving is small — one
field on a schema this plan is editing anyway — and it would have to be undone the first time the
coach tried to give advice.

### Alternative C — Shape alone, with pace demoted to an observation
Make raggedness the only timing error and report "you took bars 9 to 11 faster than the music
around them" as information beside the rallentando sentences, never as a verdict. Attractive, and
arguably the honest end of ADR-0014's own logic: with no click, nobody said what tempo to keep, so
a bar taken faster than its neighbours is a choice unless the player says otherwise. Rejected for
this plan because it deletes a property Plan 0002's tests assert and Plan 0008's Phase 6 confirmed
the player wants — a bar genuinely out of step with the music around it is worth seeing — and
because a decision that quiet should be made from a report the player trusts, which is what this
plan is trying to produce. Worth reopening once both numbers have been read at the piano.

### Alternative D — Keep the bar pace and raise the threshold
Do nothing to the measure and widen `STRICTNESS_MS` until the neighbours stop going amber.
Rejected on the measurement: the bar the player rushed read **as written**, at a deviation smaller
than the bars beside it. No threshold makes a number that is near zero exceed one that is not, in
either direction. This is ADR-0014's own Alternative D repeating itself one level down, and it
fails for the same reason: the symptom is in the reference and the measure, not in the cut.

## Notes

The two failures Plan 0008's Phase 6 found have different causes, and this ADR addresses only the
first. A bar judged by its overall pace cannot see a hand hurrying inside it — that is here. The
three *neighbouring* bars going amber is a reference-contamination problem, because the window
that judges bar 1 is drawn partly from gaps that touch the disturbed bar 2; that is
[ADR-0016](0016-a-reference-is-never-drawn-across-a-disturbance.md), and a plan that fixed either
one alone would still read wrong at the instrument.

The atom being judged is the **arrival**, decided in the interview on 2026-09-10: a chord counts
once, however it is rolled. "Which note of the chord was late" is a different question that wants
Plan 0007's ghost noteheads to display it and `ONSET_WINDOW_MS` measured against a real hand
first, and it is not asked here.
