# ADR-0017 — The oracle gains recorded playing: a take from the instrument is a committed fixture

> **Status:** proposed
> **Date:** 2026-09-10
> **Related plan(s):** Plan [0009](../plans/0009-a-bar-is-judged-note-by-note.md)

## Context

ADR-0004 made the app play itself: a seeded synthetic `MidiSource` behind virtual ports, so every
`dev` done-when is checkable with nothing plugged in. It has been worth more than anything else in
the harness — Plan 0002 and Plan 0008 were both built and verified without the CK88 attached, and
NFR 11 exists because of it.

Plan 0008's Phase 6 then found the limit, and found it in the most expensive way. Five `dev`
phases passed 578 tests, forty seeds and eight generated scenarios; the plan's central property
was asserted, measured and green. At the instrument, three of seven checklist items failed
immediately, and **every one of the failures is invisible to the generator**:

- `rushBar` compresses every gap in a bar by one factor, so the bar's pace changes and the model
  catches it. A hand hurries three notes in the middle and arrives at the next barline on time,
  which the generator has no way to express (Phase 6 item 3).
- `rallentando` ramps in equal steps with no bar-to-bar noise, so a strictly monotonic run of three
  bar paces is trivially there. A human ritardando wobbles, the run breaks at two, and no
  observation is produced at all (Phase 6 item 4).
- `restartAtBar` goes back to a bar *boundary*. A player goes back into the middle of a bar, which
  is what produced the +3992 ms nobody had seen (Phase 6 item 2).
- No fixture repeats its own figuration, so restart detection was never shown a piece that says
  the same thing twice. The Prelude does it every bar and produced thirty-five false restarts
  (Phase 6 item 5).

The pattern is not that the generator is bad. It is that **an oracle written beside the model
tends to agree with it** — the reason Plan 0002 and Plan 0008 both ordered the oracle before the
code — and a *generated* oracle agrees with it about the shape of human error no matter which
order it is written in. Every perturbation encodes somebody's guess about how playing goes wrong,
and the guesses were made by the same reasoning that wrote the model.

Meanwhile, 32 real takes from that evening sit in `userData/takes`, each one a few kilobytes of
JSON Lines, recorded by the shipped recorder in the shipped format, against a score the repository
cannot carry because the arrangement is somebody else's work (`scripts/fetch-scores.mjs`).

## Decision

**Recorded playing becomes part of the oracle: a take from the CK88, paired with a score this
repository owns, is committed under `core/fixtures/takes/` and asserted against like any other
fixture.**

Three things make it work, and all three are part of the decision:

- **The score is ours.** A recorded fixture is paired with a MusicXML file written in this
  repository, never with a fetched arrangement. Where the music is real repertoire, the notes of a
  public-domain composition are engraved here as our own file; nothing from `scores-local/` is
  committed, which is the arrangement policy `fetch-scores.mjs` already states.
- **The take carries its provenance.** Each fixture take is accompanied by what it is: the
  instrument, the date, the machine, the piece, and *what the player was doing* — "bar 5
  deliberately rushed", "a false start into the middle of bar 3". The intent is the expected
  verdict, exactly as a perturbation's declared verdict is, and it is written down by the person
  who played it while they remember.
- **It extends ADR-0004 rather than contradicting it.** A committed take needs no instrument to
  replay: it is a file, read by the same reader, in CI, on any machine, deterministically. The
  virtual ports remain how the *app* is driven end to end; recorded takes are how the *model* is
  held to what a hand actually does.

The generated oracle is not replaced. It keeps what it is good at — forty seeds, exact declared
verdicts, a property asserted across a fixture family, and a regression net that costs nothing to
run. A recorded take is the thing that says whether the property was worth asserting.

## Consequences

### Positive
- **A test can finally fail for the reason the player would.** Every defect Plan 0008's Phase 6
  found becomes an assertion instead of a paragraph in a log.
- **The failures stay fixed.** Nothing else in this repository could have caught the return of the
  rushed-bar defect; it passed 578 tests on the way out.
- It costs the player minutes, once, and costs CI nothing: the takes are kilobytes and replay
  faster than the generator builds a schedule.
- It gives Plan 0003's coach a real summary to be measured against, and Plan 0005's drill loop a
  real attempt.

### Negative
- **A recorded take is frozen evidence that cannot be re-recorded.** The player cannot play the
  same take twice, so a fixture that becomes inconvenient cannot be regenerated — it can only be
  replaced by a different performance, and any test tuned to its exact milliseconds is tuned to
  one night. Assertions over recorded takes state **properties** ("the bar the player rushed is
  the bar reported"), never a millisecond, for exactly this reason.
- **The take format has to stay readable.** `TAKE_FORMAT_VERSION` migration now has committed data
  behind it, not only files in `userData` a player could lose without noticing.
- **It is performance data about a person**, in the repository, forever. Small and unremarkable
  here — a list of note numbers and times, of the user's own playing, committed by the user — but
  it is worth having decided rather than drifted into, and it is a reason not to accept recorded
  takes from anybody else without asking.
- **The provenance is prose and can rot.** "Bar 5 deliberately rushed" is a claim nobody can
  re-derive from the file; if it is wrong, a test asserts the wrong thing confidently. The
  mitigation is that it is written the same evening and checked once against the report.

### Neutral
- Nothing about the recorder, the take format or the virtual ports changes. This is a decision
  about what the test suite is allowed to read.

## Alternatives considered

### Alternative A — Keep the oracle generated, and add the missing perturbations
Write `rushWithinBar`, a noisy rallentando, a restart into the middle of a bar, and a repeating
fixture. Cheap, fully `dev`-ownable, and it fixes the four known holes. Rejected as sufficient,
adopted as necessary: it repeats the mistake exactly one level up. Each new perturbation is
another guess about human error written by the same hand as the model, and the next Phase 6 finds
the next thing nobody thought to generate. The plan does both — the perturbations for seeded
property tests across forty seeds, the recordings for whether the properties are the right ones.

### Alternative B — Measure against real takes by hand, and commit nothing
Run the model over `userData/takes` on the development machine, report the numbers in the plan's
implementation log, keep the repository free of performance data. This is what Plan 0008 did, and
it is why the defects were found by a person reading a screen. Rejected because nothing regresses:
a measurement in a log is a fact about one evening that no future change is checked against, and
the rushed-bar defect would return silently.

### Alternative C — Record at test time from the instrument
Have the suite drive the CK88 and capture what comes back. Rejected on ADR-0004's own ground: it
puts an instrument in the loop of every `dev` done-when, which is the thing that makes overnight
queues and CI possible. It also cannot record a *mistake* on demand — the player has to make it.

## Notes

The first fixture under this ADR is the opening of BWV 846, engraved in this repository from the
composition, because that is the piece every measurement behind ADR-0014, ADR-0015 and ADR-0016
was taken from, and because it is dense: about sixteen arrivals a bar, where the existing
hand-written fixtures give one to four. A shape verdict (ADR-0015) needs arrivals to have a shape
at all.

The 32 takes already in `userData/takes` from 2026-09-10 are not fixtures — they were played
against a fetched arrangement and cannot be paired with a committed score — but they remain the
best smoke test on the development machine, and Plan 0009 reads them as a measurement.
