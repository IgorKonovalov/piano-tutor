# ADR-0005 — The expected-note timeline is extracted from OSMD's model, never parsed a second time

> **Status:** proposed
> **Date:** 2026-09-09
> **Related plan(s):** Plan [0002](../plans/0002-a-piece-is-practised.md)

## Context

Practising a piece needs two things that look like one thing. The renderer needs a drawn score
with addressable bars, and `core/` needs an **expected-note timeline** — pitch, onset in beats,
duration, and the bar each note belongs to — to align a recorded take against. ADR-0003 already
settled the first half: OpenSheetMusicDisplay parses the MusicXML and lays out the document.
The open question is where the second half comes from.

The obvious answer is that `core/` parses the MusicXML itself. It is the pure package, alignment
belongs there, and a MusicXML file is just a string — no DOM required if the XML parser is
DOM-free. That keeps `core/` self-sufficient and makes the whole practice path testable with a
file and no window.

It also creates two independent parsers of the same document, and that is the part that decides
this. The output of alignment is **per-bar colouring on the score the player is looking at**.
`core/` says "bar 12 had a wrong note"; the renderer asks OSMD to colour bar 12. If the two
disagree about what bar 12 is, the app confidently paints the wrong bar. MusicXML has several
constructs where two reasonable parsers index differently: a pickup bar that may or may not count
as measure 1, multi-measure rests that collapse several bars into one drawn object, implicit
measures created by mid-bar barlines, and `<measure number="...">` attributes that are display
labels rather than indices and can repeat or skip. Every one of these is a plausible off-by-one,
and an off-by-one here is invisible — it does not throw, it does not fail a build, it produces a
colour on a bar next to the one the player fumbled, which reads as the app being confused rather
than the code being wrong.

The second force is ADR-0001's purity rule. `core/` imports no DOM, so it cannot hold an OSMD
reference. Whatever we choose has to keep the alignment functions pure and testable without a
window, or the reason `core/` exists is gone.

## Decision

`core/` owns the `ExpectedTimeline` type and every function over it — alignment, verdicts, per-bar
rollups, statistics — and **never parses MusicXML**. A thin adapter in the renderer,
`renderer/score/timelineFromOsmd.ts`, walks the `MusicSheet` that OSMD has already parsed and
produces the timeline, indexing bars by OSMD's own measure index so that a bar id travelling out
of `core/` addresses exactly the bar OSMD can colour. There is one parse of the file, by the
library that draws it.

The adapter is held honest by **committed timeline fixtures**: for each fixture score, the
timeline is extracted once and committed as JSON under `core/fixtures/scores/`, and `core/`'s
tests run against those files with no DOM and no OSMD. An end-to-end test loads each fixture
score in the real app and asserts that the freshly extracted timeline still equals the committed
one, so an OSMD upgrade that changes the model shows up as a failing test rather than as drifting
bar numbers.

The same seam takes a second adapter later: a MIDI file read through `@tonejs/midi` produces the
same `ExpectedTimeline`, which is how a MIDI file becomes a second-class score without a second
alignment path.

## Consequences

### Positive

- **Bar indices agree by construction.** The only index in the system is OSMD's, so the colour
  lands on the bar the player is looking at. The failure mode this ADR exists to prevent cannot
  occur, rather than being tested for.
- **`core/` stays pure and alignment stays testable** with a JSON fixture and no window, which is
  what makes the whole practice path checkable by an unattended run (ADR-0004).
- **One parse, one dependency.** No DOM-free XML parser, no re-implementation of MusicXML
  semantics that OSMD already implements — divisions, ties, tuplets, transposing parts, key and
  time changes.
- **The timeline is a seam, not a detail.** MIDI files, and later the exercise generator's own
  output, produce an `ExpectedTimeline` and get alignment for free.

### Negative

- **The adapter is renderer code, and therefore the least-tested link in the chain.** It cannot be
  unit-tested without a DOM, so its correctness rests on the fixture comparison in the e2e run.
  That check must never be quietly skipped; if it is, the committed fixtures become a record of
  what OSMD used to do.
- **A committed fixture is a snapshot.** Regenerating it is a deliberate act with a visible diff,
  and a large diff after an OSMD upgrade needs reading rather than accepting. This is the cost of
  not having a second parser to cross-check against, and it is paid at upgrade time.
- **Extraction runs in the renderer**, so a very large score costs main-thread time at load. It is
  off the MIDI paint path entirely, so NFR 1 and NFR 11 are unaffected, but a score that takes a
  noticeable moment to open is a possibility this decision accepts.
- **`core/` cannot practise a file the renderer has not opened.** Aligning a take against a score
  is not a headless-from-a-file-path operation; it needs the timeline the app extracted. Takes
  therefore record the score id they were played against, and the timeline is cached in the
  library beside the score.

### Neutral

- A new IPC domain, `score:*`, appears for the library (import a file, list, read bytes). It is
  the third domain after `midi:*` and `take:*` and follows the same one-handler-file shape.
- `core/` gains a score vocabulary — bars, beats, expected notes — that the exercise plan will
  emit into rather than invent.

## Alternatives considered

### Alternative A — `core/` parses the MusicXML itself with a DOM-free XML parser

Self-sufficient, headless from a file path, no adapter in the renderer. Rejected because it puts
two independent parsers on the same document and the disagreement between them is silent: a
pickup bar or a multi-measure rest counted differently colours the wrong bar, and nothing in the
system can detect it. It also means re-implementing a large amount of MusicXML semantics that
OSMD already implements correctly, and adding a dependency to do it.

### Alternative B — Main parses the MusicXML and pushes the timeline over IPC

Keeps the renderer thin and the timeline available without a window. Rejected for the same
two-parser reason as A, with an aggravating factor: it puts a heavyweight, allocation-hungry
parse inside the process that owns the MIDI hot path and the arrival stamps that NFR 1 depends on.

### Alternative C — No timeline; align against OSMD's cursor directly

Let the renderer drive OSMD's cursor and compare held notes to whatever the cursor is on.
Rejected because alignment stops being a pure function and becomes a stateful interaction with a
rendering library — untestable without a window, impossible to re-run over an old take, and
unable to look ahead or backtrack, which is exactly what recovering from a stumble requires.

## Notes

This ADR adds NFR 12 (alignment turnaround) to [nfr.md](../nfr.md). It does not decide the
alignment algorithm itself; Plan 0002 fixes that (onset-group alignment with a banded
edit-distance, tempo fitted after the fact) and it is free to change without a superseding ADR,
because the timeline type and the bar indexing are what this decision protects.
