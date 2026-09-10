# 0008 — The timing model

> **Status:** in-progress
> **Created:** 2026-09-10
> **Owner skill(s):** dev, human
> **Related ADRs:** [0014](../adrs/0014-timing-is-judged-against-a-local-tempo-not-one-line-through-the-take.md)
> (proposed) is this plan's whole design;
> [0010](../adrs/0010-alignment-ends-where-the-player-stopped-an-unplayed-tail-is-free.md) (proposed)
> is the previous fix in the same area and the model for how this one is recorded;
> [0012](../adrs/0012-the-metronome-is-a-shared-grid-and-the-timing-reference-when-it-runs.md)
> (proposed) owns the click-relative path and bounds this plan to the other one
> **NFRs claimed:** 12, and a new row **14** in [nfr.md](../nfr.md) this plan adds
> **Depends on:** Plan [0002](0002-a-piece-is-practised.md) Phases 4 and 5 — the aligner, the
> fitted tempo and the per-bar report this plan replaces the timing half of

## TL;DR

You play a piece, fumble, stop, go back a bar and carry on — and the report says *"you restarted
at bar 4"* instead of turning the whole page orange. Each bar's timing is judged against the tempo
its neighbours were keeping, not against one line fitted through everything, so a disturbance no
longer contaminates the bars before and after it. A rallentando is described rather than punished,
the tempo figure becomes the tempo you actually held, and a strictness control lets you say how
fussy the app should be. This is what makes Plan 0002's Phase 7 item 6 — play the same piece well
and badly, do the statistics tell them apart — answerable at all.

## Context & problem

Plan 0002 fits one tempo to a whole take and judges each bar by its distance from that line. The
plan named the cost and accepted it: "a rallentando reads as error … the first thing Plan 0002
Phase 7 asks the player about."

Phase 7 asked, at the CK88 on 2026-09-10. The answer, measured against the real take (Bach
BWV 846, 168 note-ons, a deliberate false start):

```
counts        144 correct, 0 wrongPitch, 0 missing, 24 extra
bars          7 of 9 attempted bars read `timing`
deviations    -2450, +2105, -1235 ms
fit           53.4 qpm where the player played about 64; rms 1671 ms against a 45 ms threshold
residuals     +1741 +1701 +1628 ... +18 -39 ... -1130 -1191
```

**The notes were perfect.** 144 as written, nothing wrong, nothing missing: the aligner picked the
thread straight back up after the restart, which is the question Plan 0002 said no generated take
could ask. It is the *timing* that failed, and the residual ramp says why — replaying a bar gives
one score position two different times, a straight line cannot represent that, so the slope
flattens and every note inherits an error growing linearly with distance from the crossing point.

Two properties of a global reference make this more than a bad number. It **propagates backwards
as well as forwards**, so bars played before the restart were flagged for something that happened
after them. And it leaves the player no way out: "once timing is wrong I can't go back to right
timing after." No threshold fixes it — at an rms of 1671 ms the threshold would need to be
thirty-seven times its current value, and would then report nothing at all.

What this blocks is concrete. Plan 0002 Phase 7 item 6 asks whether the statistics tell a good
take from a bad one. On this scoring path both read out of time throughout, so the answer is
unobtainable, and **Plan 0002 cannot close until this is fixed.**

## Decision

A bar's timing is judged against a tempo fitted from the bars around it, **excluding the bar
itself** so that a rushed bar is measured against what its neighbours were doing rather than
against a line drawn partly through its own notes (ADR-0014). A rallentando is followed by the
local trend and reported as an observation rather than an error; a restart is detected from the
run of played notes that re-covers score already passed, and named; the headline tempo becomes the
steady-state tempo taken from the stretches where the player was steady.

We rejected segmenting the take at restarts and fitting one line per segment, because a long
segment containing a ritardando has the same defect over a shorter span. We rejected judging
evenness alone with no tempo reference, because it cannot say a bar was rushed relative to the
music around it and would delete Plan 0002's `rushBar` property rather than keep it. We rejected a
robust global fit (Theil-Sen, RANSAC), because a rallentando is not an outlier — it is half the
data — and the reference would still be global, so the propagation stays. We rejected widening the
threshold on the measurement above.

Nothing in the matcher changes. Tempo is fitted after the match, over the pairs `align.ts` already
produces, so the tempo-freedom every test in `core/src/align/` defends is untouched.

## Architecture diagram

```mermaid
flowchart TB
    subgraph core ["core/ (pure)"]
        AL["align.ts<br/>matched pairs<br/>(unchanged, no clock)"]
        TC["tempo.ts<br/>local window fit,<br/>bar excluded"]
        RS["restarts.ts<br/>re-covered score"]
        RP["report.ts<br/>BarVerdict + observations"]
    end
    subgraph gen ["core/ oracle"]
        PB["perturb.ts<br/>restartAtBar<br/>rallentando"]
    end
    subgraph rend ["renderer"]
        ST["PracticeStats<br/>steady tempo, restarts,<br/>tempo observations"]
        SC["Score view<br/>strictness control"]
    end
    PB --> AL
    AL --> TC --> RP
    AL --> RS --> RP
    RP --> ST
    SC -- strictness --> RP
```

## Implementation phases

Each phase ships as its own commit. `dev` runs Phases 1 to 5 in one session; the architect reviews
the whole plan once, in a fresh session, after Phase 6. Every `dev` phase is checkable with
nothing plugged in (NFR 11); Phase 6 needs the instrument.

**The oracle comes first, before the model that has to satisfy it.** Plan 0002 adopted the same
ordering for the same reason, recorded in its own notes: an oracle written after the thing it
tests tends to agree with it.

### Phase 1 — The generator restarts, and slows down
- **Owner skill:** dev
- **What:** Two new perturbations, each declaring its own expected verdict, and two generated
  performances you can select in the Score view and practise against. This phase is deliberately
  the oracle alone; what it shows on screen is two new entries in the *Play from* picker, and
  playing one of them demonstrates the defect the rest of the plan removes.
- **Files touched:** `core/src/midi/perturb.ts`, `core/src/midi/perturb.test.ts`,
  `electron/midi/virtualPorts.ts`, `electron/midi/virtualPorts.test.ts`,
  `electron/midi/SyntheticSource.test.ts`, `e2e/app.spec.ts`.
- **Notes for the implementer:**
  - `restartAtBar(bar)` plays up to and including that bar, then **replays it from its start** and
    continues. That is what the player did: the replayed notes are correct notes with nowhere left
    in the score to match, which is where the 24 extras in the measurement came from.
  - `rallentando({ fromBar, toBar, factor })` stretches the inter-onset gaps progressively so the
    final gap is `factor` times the written one, with the bars before `fromBar` untouched.
  - **Both declare no note-level verdict at all**, and that is the assertion that matters: a
    restart is not a mistake and a rallentando is not a mistake. `restartAtBar` declares a
    `restart` verdict; `rallentando` declares a `tempoChange` verdict. Neither declares
    `wrongPitch`, `missing`, `extra` or `timing`.
  - The port list is enumerated by id and by exact count in three existing tests (Plan 0002
    Phase 3's note). They grow by two; keep the counts exact rather than loosening them.
- **Done when:** `restartAtBar(3)` emits every note of bar 3 twice and nothing else changes, with
  the second copy later in time than the first; `rallentando` leaves every gap before `fromBar`
  identical to the unperturbed take and scales the last gap by the stated factor, checked as a
  ratio rather than against absolute times; both are byte-identical across two runs at one seed;
  and both new ports appear in the Score view's picker and record a take when practised.

### Phase 2 — A bar is judged against its neighbours
- **Owner skill:** dev
- **What:** The local tempo curve of ADR-0014, and `timingDeviation` measured against it. The
  visible change is the whole point of the plan: the restart and rallentando takes stop being
  orange.
- **Files touched:** `core/src/align/tempo.ts`, `core/src/align/tempo.test.ts`,
  `core/src/align/report.ts`, `core/src/align/report.test.ts`, `shared/score.ts`, `docs/nfr.md`.
- **Notes for the implementer:**
  - `localTempo(pairs, bar, options)` fits over the matched pairs whose bars lie within a window
    either side of `bar` **and excludes the pairs belonging to `bar` itself**. This exclusion is
    the crux of ADR-0014 and the easiest thing in the plan to get wrong: a reference fitted from
    data including the bar under test moves to meet it, and no bar ever deviates.
  - State the window width in the code with the reasoning. Assert its *effects* — a rallentando is
    clean, a rushed bar is flagged — never the number itself, so tuning cannot make a test pass
    that should not.
  - **A window with too few samples yields no verdict, not a confident one.** A bar near either
    end of the take has neighbours on one side only; below a stated minimum the bar reports
    `timingDeviation` 0 and a state that is not `timing`. Reuse `MIN_TEMPO_SAMPLES`' reasoning.
  - `fitTempo` stays, unchanged and exported: Phase 4 needs a global fit for the steady-state
    figure, and ADR-0012's click path is a separate reference entirely.
  - **`docs/nfr.md` gains row 14**, a property row with no milliseconds in it: *a take played
    evenly reports no timing error, however the take is structured.* Asserted by tests over the
    oracle — a restart, a rallentando, a take at half speed and a take with a long pause all
    report zero bars in `timing`, while a genuinely rushed bar is still flagged.
- **Done when:** a clean take of every fixture score still reports every bar clean and every
  existing test in `core/src/align/` still passes unchanged in meaning; a `rallentando` take
  reports **zero** bars in `timing`; a `restartAtBar` take reports zero bars in `timing` **and no
  bar before the restart is flagged**, which is the propagation property and the single most
  important assertion in this plan; `rushBar` still ranks the rushed bar worst by timing and still
  flags it; a take played evenly at half speed still reports zero timing errors; and NFR 14 is in
  `docs/nfr.md` with those tests named as its method.

### Phase 3 — A restart is named, not counted as mistakes
- **Owner skill:** dev
- **What:** Detection of a restart, a place for it in `PracticeReport`, and a line in the Score
  view that says where it happened. The notes it accounts for stop being reported as extras.
- **Files touched:** `core/src/align/restarts.ts`, `core/src/align/restarts.test.ts`,
  `core/src/align/report.ts`, `core/src/align/report.test.ts`, `shared/score.ts`,
  `renderer/components/PracticeStats.tsx` + `.module.css`, `e2e/practice.spec.ts`.
- **Notes for the implementer:**
  - A restart is **a run of played groups the matcher left over, whose pitches re-cover a stretch
    of expected groups the take has already matched.** The pitch evidence is what identifies it;
    a long time gap beside it is corroboration, not the trigger. Reading a clock here is fine —
    `report.ts` and `tempo.ts` already do — but the matcher still must not.
  - The notes a restart accounts for are **removed from `counts.extra`** and reported under the
    restart instead. They were correct notes played twice, which is care rather than error.
  - `PracticeReport` gains `restarts: RestartVerdict[]`. Keep it sized by the score, not by the
    take: one entry per restart, each naming the bar and how many notes it covered, never a list
    of the notes. Plan 0002's report-size property (NFR 7's lever) applies here too.
  - Colour is never the only carrier: the restart reads as a sentence in the statistics panel.
- **Done when:** a `restartAtBar(3)` take reports exactly one restart, at the bar the perturbation
  declared, and `counts.extra` is **zero** where it was previously the size of the replayed bar; a
  take with no restart reports an empty list; two restarts in one take are reported as two; the
  serialised report for a take with a restart stays within a small factor of the same take
  without one, asserted as a ratio; and the e2e practice run shows the restart sentence in the
  statistics panel.

### Phase 4 — The tempo you kept, and the shape you gave it
- **Owner skill:** dev
- **What:** The headline tempo becomes the steady-state tempo, and a rallentando is described in a
  sentence instead of being invisible.
- **Files touched:** `core/src/align/tempo.ts`, `core/src/align/tempo.test.ts`,
  `core/src/align/report.ts`, `core/src/align/report.test.ts`, `shared/score.ts`,
  `renderer/components/PracticeStats.tsx` + `.module.css`.
- **Notes for the implementer:**
  - **Steady-state tempo** is taken from the local tempi, over the bars where the player was
    steady — a median rather than a mean, so a restart and a ritardando cannot drag it. It stays
    in the existing `fittedTempo` field: same name, same units, refined meaning. Say so in the
    field's comment, because Plan 0003's coach summary reads it.
  - **A tempo observation** names a span and a percentage: "slowed 22% over bars 9 to 11". Derive
    it from a monotonic run in the local tempo curve past a stated size. It is information and
    never a verdict; no bar state changes because of one.
  - Keep observations bounded — the largest few, like `WORST_BARS_SHOWN` in the same component —
    so a take that wanders does not produce a wall of sentences.
- **Done when:** the steady-state tempo of a clean take of each fixture is within one per cent of
  the tempo it was generated at; the steady-state tempo of a `restartAtBar` take is within one per
  cent of the same take without the restart, which is the property that says a restart no longer
  moves the headline number; a `rallentando({ factor: 0.7 })` take produces exactly one tempo
  observation, naming the bars the perturbation named and a percentage within a stated tolerance of
  30%; an even take produces none; and no bar's state changes because an observation exists.

### Phase 5 — How fussy the app should be
- **Owner skill:** dev
- **What:** A strictness control in the Score view, three positions, changing the timing threshold
  and nothing else.
- **Files touched:** `renderer/views/Score.tsx` + `.module.css`,
  `renderer/hooks/usePracticeReport.ts`, `core/src/align/report.ts`, `shared/score.ts`,
  `e2e/practice.spec.ts`, `README.md`.
- **Notes for the implementer:**
  - Three named positions, not a slider: a slider invites tuning the number until the feedback
    flatters. Name them for what they mean to a player, and write the millisecond each maps to in
    the code with the reasoning.
  - **It is not persisted.** There is no settings store yet — `electron/settings/` does not exist
    and Plan 0003 creates it for the API key — so this follows the precedent Plan 0002 Phase 6 set
    for the quantisation grid: a control in the view, remembered for as long as the view is open.
    Persisting it is a one-line followup once that store exists, and is listed below.
  - Changing strictness **re-derives the report from the take already loaded**; it does not
    re-record and does not re-read the file.
  - Only bar *state* moves. `timingDeviation` is a measurement and does not change with strictness,
    and neither do the note counts.
- **Done when:** the same take at the strictest and most relaxed settings produces identical
  `counts`, identical `timingDeviation` values and a different number of bars in `timing`;
  switching the control re-colours the score without a new take; and the e2e practice run drives
  the control and observes the bar count change.

### Phase 6 — At the piano, with the takes that started this
- **Owner skill:** human
- **What:** The user re-runs the scenarios that produced the defect, and answers the Plan 0002
  item that was blocked by it. This is the only evidence that the fix does what the player asked
  for; the oracle can prove the property but not the feel.
- **Checklist:**
  1. **The false start again.** Play four or five bars of BWV 846, stop mid-bar, go back one bar,
     continue, stop. Does the report say you restarted, and are the bars before the restart clean?
  2. **Can you get back to right timing?** After the restart, do the later bars read on their own
     merits, or do they still inherit the disturbance?
  3. **Rubato.** Play a deliberate rallentando into a cadence. Is it described rather than
     reported as error, and is the description one you recognise?
  4. **A genuinely rushed bar.** Rush one bar deliberately, in an otherwise even take. Is it
     flagged? This is the property that must survive, and the one most at risk from a local
     reference.
  5. **Plan 0002 Phase 7 item 6, finally.** Play the same piece well and badly. Do the statistics
     tell the two takes apart in a way you would trust?
  6. **Strictness.** Does the control change what you see in a way that feels like strictness
     rather than like a different opinion?
  7. **The tempo figure.** Does the steady-state number match what you think you were playing?
- **Done when:** every line has an answer in the log, and anything that failed is a followup row
  rather than a fix made in this phase. **Item 5's answer belongs in Plan 0002's log as well**,
  since it is that plan's Phase 7 item 6 and its close depends on it.

## Data shapes

Illustrative, not final; `shared/score.ts` carries the Zod that governs.

```ts
/** One local reference, per bar, fitted from its neighbours and not from itself. */
interface LocalTempo {
  bar: number
  qpm: number
  msPerQuarter: number
  originMs: number
  /** Matched pairs the window drew on, excluding this bar's own. */
  samples: number
}

/** The player went back over music they had already played. */
interface RestartVerdict {
  /** The bar they resumed from. */
  bar: number
  /** How many note-ons the repeat accounted for; not the notes themselves. */
  notes: number
}

/** Information, never a verdict: what the tempo did over a span. */
interface TempoObservation {
  fromBar: number
  toBar: number
  /** Negative is slower. -22 reads "slowed 22%". */
  percent: number
}

/** PracticeReport gains, and refines one field it already has. */
interface PracticeReportAdditions {
  restarts: RestartVerdict[]
  tempoObservations: TempoObservation[]
  /** REFINED: now the steady-state tempo, not a fit across the whole take. */
  fittedTempo: number | null
}
```

## Risks & open questions

- **The window width is a judgement and the plan does not fix it.** Too narrow and the reference
  chases the player, forgiving real unevenness; too wide and it reapproaches the global line.
  Phase 2 states a number with reasoning and asserts effects; Phase 6 item 4 is where a player
  finds out whether it forgives too much.
- **A uniformly rushed take is invisible on this path**, by construction (ADR-0014's stated
  negative). That is ADR-0012's metronome to fill, and the two paths are complementary. Worth
  telling the player, in the copy, that timing here is about evenness rather than about speed.
- **Restart detection may fire on repeated material.** A piece whose figuration repeats exactly
  could look like a restart when the player simply continued. The pitch-run evidence plus a
  corroborating time gap is the guard; Phase 3's tests should include a take with genuinely
  repeating material and no restart in it.
- **`timingDeviation` changing reference is a seam change** that Plan 0003 reads. The field keeps
  its name and units, so nothing breaks mechanically, but the coach's prompt describes it and the
  sentence is now different.
- Whether a restart should also split the tempo curve, rather than only being reported, is left
  open. Phase 2's windows straddle it; if Phase 6 item 2 says the disturbance still leaks, that is
  the first thing to try.

## What this plan does NOT do

- **It does not touch the matcher.** No change to `align.ts`, the band, the cost function or the
  endpoint. Tempo-freedom is preserved exactly.
- **It does not implement click-relative scoring.** ADR-0012 and Plan 0006 own that path; this
  plan is the no-click one, and the two must not be merged into a single reference.
- **It does not persist the strictness control**, because there is no settings store yet.
- **It does not address the unbounded-extras property** carried from Plan 0002's close review —
  a player who repeats a passage still grows the report. Phase 3 removes the *restart* case from
  the extras count, which is the common one, and leaves the general property to Plan 0003.
- **It does not add a tempo graph.** Observations are sentences; drawing the curve is a separate
  question and belongs with Plan 0007's on-score drawing if it is ever wanted.

## Implementation log

> Written by `dev`, one row per phase as that phase's commit lands, and the close block after the
> last one. **The phases above are the contract; everything here is what happened.** Observations,
> never conclusions. A deviation from the plan or an unmet done-when is always disclosed.

**Lane:** `main`, alone in flight.

| phase | owner | state | commit |
|---|---|---|---|
| 1 — The generator restarts, and slows down | dev | done | 60050f7 |
| 2 — A bar is judged against its neighbours | dev | done | 6ba8f05 |
| 3 — A restart is named, not counted as mistakes | dev | done | 1296c40 |
| 4 — The tempo you kept, and the shape you gave it | dev | done | 4e11434 |
| 5 — How fussy the app should be | dev | done | committed with this row |
| 6 — At the piano, with the takes that started this | human | outstanding | — |

### Measurements

Development machine, Windows 10, this checkout. Properties are asserted in tests; everything here
is a number about one machine and is reported, never asserted.

- **The floor of the local model.** Over 40 seeds and 8 generated scenarios of *correct playing* —
  clean takes of `scale-c-major`, `key-and-time-change` and `grace-note`, a take at half speed, a
  restart, and rallentandos of factor 0.5, 0.7 and 1.3 — the worst bar reaches **40 ms** of
  `timingDeviation` (p95 40, and 25 to 28 on the clean takes). A bar the player genuinely rushed
  (`rushBar` at 0.55) sits at **585 ms at its mildest** over the same seeds. The signal is about
  fifteen times the floor, which is what let all three strictness positions sit above the floor.
- **The window width, measured rather than chosen.** Against a rallentando falling to 70 % on the
  scale fixture, a window of one bar either side reads the middle bar **3 ms** out; a window of two
  reads it **72 ms** out, past the threshold. One bar either side is what ships.
- **What the restart costs the tempo figure.** `steadyTempo` of a `restartAtBar(2)` take is
  **1.0008×** the same take without the restart. The global fit ADR-0014 measured was 53.4 qpm
  against a player at about 64, a 17 % error.
- **The rallentando, described.** `rallentando({ fromBar: 1, toBar: 3, factor: 0.7 })` reports one
  observation of **-28 % to -30 %** across seven seeds, against the -30 % the perturbation declares.
- **NFR 12, stop to a coloured score, in the app:** 5 ms (e2e run, `pickup-two-hands`). Well inside
  the 2 s budget; the piece is four bars, so this is a floor and not a stress figure.
- **NFR 11, frames from injection to paint:** p50 1, p95 1, max 1 over 500 note-ons; 3.4 / 6.1 /
  7.1 ms. **NFR 4, process creation to first painted key:** 793 ms.

### Notes

- **Phase 1, `rallentando`'s `factor`.** The phase block reads "the final gap is `factor` times
  the written one"; Phase 4's done-when reads `factor: 0.7` against a percentage of 30, which only
  holds if `factor` is the tempo at the end rather than the gap. Asked at the start of the session;
  the answer was **tempo**. So `rallentando({ factor: 0.7 })` ends at 70 % of the written tempo and
  the last gap is `1 / 0.7` times the written one. Phase 1's done-when is met with that reciprocal,
  which is the one deviation from a phase block's wording in this phase.
- **Phase 1, the gap ramp is discrete.** The stretch runs in equal steps over the onsets actually
  struck rather than continuously over the quarter-note axis, so the last gap inside the span is
  exactly `1 / factor` and the test needs no tolerance for it. A continuous ramp would give that
  gap the ramp's *mean* over the interval, a number no reader could predict.
- **Phase 1, both new ports are on `scale-c-major`.** It is the only fixture with a note on every
  quarter across four bars; the others put a single chord in each bar and have nothing to be uneven
  about. Port ids: `virtual:score:scale-c-major-restart`, `virtual:score:scale-c-major-rallentando`.
- **Phase 2, the local pace is a balanced median of gaps, not a least-squares line.** The phase
  block says "fits over the matched pairs whose bars lie within a window"; what is fitted is the
  **median of the per-quarter gaps either side, taking the same number of gaps from each side**.
  Least squares was written first and measured, and it failed two of the phase's own done-whens:
  a restart's five-fold jump inside the window dragged the line and reported the bars beside it at
  a second of error each, and an unequal window over a rallentando returned the average of a
  stretch that was faster at one end than the other, so the middle bars read 40 to 190 ms out. A
  median ignores the jump; balancing the two sides makes it the pace beside the bar rather than an
  average across a change. Both are recorded in `tempo.ts` with the reasoning.
- **Phase 2, the window is one bar either side, and both sides are required.** Measured on the
  scale fixture against a rallentando falling to 70 %: a window of one bar reads the middle bar
  3 ms out, a window of two reads it 72 ms out. A bar with neighbours on one side only — always
  the first and last bars of a take — reports no verdict rather than a guess, which is ADR-0014's
  own note about the ends of a take and, measured, the difference between the rallentando take
  reporting zero bars in `timing` and reporting two.
- **Phase 2, a bar is read through its own fitted line.** `timingDeviation` compares the bar's
  fitted pace with the local one from the bar's own starting point, rather than averaging the
  distance of each individual arrival. Measured over ten seeds: the second form put a clean take's
  worst bar at 22 ms and the rallentando's at 55 ms, past the 45 ms threshold, because it inherits
  the jitter of the single note-on it anchors on and the convexity of a bar played inside a
  ritardando. The first form leaves a clean take at 24 ms and every rallentando at 39 ms. The cost
  is stated in the code: unevenness *inside* one bar, where the notes drift but the bar keeps its
  pace, is not what this reports.
- **Phase 2, NFR 14's "long pause" is between two bars.** A pause in the middle of a bar makes
  that bar genuinely uneven and is reported; the row and its test say so.
- **Phase 3, a restart is a run of leftover groups that re-covers score matched elsewhere.** The
  phase block says "already matched"; the implementation asks whether the stretch is matched
  *anywhere* in the alignment rather than whether it was matched *before* the run. Both readings
  are the same take, and the weaker one does not depend on which of the two copies the matcher
  chose to keep — a tie it breaks on cost alone.
- **Phase 3, the e2e passage wait became a floor rather than an exact count.** Practising
  `virtual:score:scale-c-major-restart` reached the renderer's "notes so far" banner as 18 of 19.
  The missing one is a **pre-existing race in the Score view**, not event loss: the view subscribes
  to `midi:event` after `window.api.midi.open()` resolves, and a generated note at `t = 0` is
  emitted synchronously inside `open()` before the renderer is listening. Main records it, and the
  take on disk carries all 19 — the report the test asserts on is built from the take. Not fixed
  here: `renderer/views/Score.tsx` is outside this phase's file list. Followup below.
- **Phase 4, the steady-state tempo is not a median of the local tempi.** The phase block says
  "taken from the local tempi, over the bars where the player was steady — a median rather than a
  mean". The local tempo curve does not exist for the first and last bars of a take (Phase 2), and
  it does not exist at all for a piece that puts one chord in each bar, so a median over it left
  `fittedTempo` null for `pickup-two-hands` — a field two existing tests read and Plan 0003's coach
  summary reads. What ships instead keeps the intent exactly: a median of the take's per-quarter
  gaps decides which gaps *were* the tempo, and the figure is the aggregate pace over the ones that
  survive. Measured: a restart moves it by 0.08 %, where the global fit moved it by 17 % on the
  take ADR-0014 was written from.
- **Phase 4, an observation's `fromBar` is one past where its run begins.** A run of bar paces
  describes a change over the last n-1 of them: the first bar is the tempo it changed *from*. That
  is what makes `rallentando({ fromBar: 1, toBar: 3 })` report bars 1 to 3 rather than 0 to 3.
  Measured over seven seeds: -28 to -30 % against the -30 the perturbation declares.
- **Phase 5, the default threshold moved from 45 ms to 75 ms.** The three positions are 45 / 75 /
  130 ms with `normal` the default. 45 ms was chosen for a *global* reference, where the number
  meant a different thing; against a local one the measured floor of correct playing is 40 ms, so
  45 is now the **strictest** honest position rather than the middle one. Every test that asserts
  the timing property does so through `TIMING_THRESHOLD_MS`, and one of them asserts the property
  again at `strict`, which is the stronger claim. No setting calls correct playing an error.
- **Phase 5, one file outside the phase's list: a fourth generated port.** The last done-when
  needs the e2e to see the bar count change, and no existing port has a bar between 45 and 130 ms
  — correct playing tops out at 40 and a rushed bar starts at 585. `virtual:score:scale-c-major-uneven`
  (bar 2 at 93 % of its written length, about -104 ms) is that bar. It touches
  `electron/midi/virtualPorts.ts` and the three exact port counts, which go from 12 to 13. **Asked
  and approved by the user before it was written**, with the alternative — lowering `strict` to
  30 ms so the rallentando port straddles it — rejected because that would have had the strictest
  setting report the model's own noise as the player's error.
- **Phase 5, `renderer/views/Score.tsx.module.css` was not touched.** The control reuses the
  toolbar's existing `.field` and `.port` classes; there was nothing to add.
- **Phase 1, the ratio assertions are to two decimal places.** `playNotes` rounds to whole
  milliseconds, so a ratio over one ~667 ms gap carries about a part in a thousand of rounding.

### Close triggers

- **What shipped:** a feature. `timingDeviation` changes its reference from one line through the
  take to a tempo fitted from each bar's neighbours (ADR-0014); `PracticeReport` gains `restarts`
  and `tempoObservations`; `fittedTempo` keeps its name and units and becomes the steady-state
  tempo; a three-position strictness control appears in the Score view. Three new generated ports.
  Nothing in the matcher changed.
- **User-visible docs touched:** `README.md` (the *Practising a piece* section, rewritten for the
  local reference, restarts, tempo observations and the *Timing* control) and `docs/nfr.md` (new
  row 14).
- **Full gate at the last phase:** `npm run typecheck` 0, `npm run lint` 0, `npm test` 0 (578 tests
  across 26 files), `node scripts/check-pins.mjs` 0, `node scripts/check-doc-links.mjs` 0,
  `npm run build` 0, `npx playwright test` 0 (23 tests).
- **Outstanding `human` phases:** **Phase 6, at the piano.** Not attempted. It needs the CK88 and
  the user's own judgement on seven questions, one of which (item 5) is Plan 0002's Phase 7 item 6
  and belongs in that plan's log as well.

## Followups (after this lands)

- **Persist the strictness control** once Plan 0003 creates the settings store.
- **Re-answer Plan 0002 Phase 7 item 6** in that plan's log, and close Plan 0002. This plan
  existing is the reason that one is still open.
- **Whether a restart should split the tempo curve**, not merely be reported. See Risks.
- **The Score view's "notes so far" counter can miss a note struck at `t = 0`**, because it
  subscribes after `window.api.midi.open()` resolves. Display only — the take is complete — but it
  is one line to move. Found in Phase 3; see the note above.
