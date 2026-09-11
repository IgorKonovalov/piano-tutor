# ADR-0003 — Two notation surfaces: VexFlow draws what is being played, OpenSheetMusicDisplay draws the score

> **Status:** accepted 2026-09-10, on the close of Plan 0001 (the live staff half; the score
> half is evidenced when Plan 0002 closes)
> **Date:** 2026-09-09
> **Related plan(s):** [0001](../plans/done/0001-the-keyboard-shows-on-screen.md) (the live staff);
> the score view lands in Plan [0002](../plans/done/0002-a-piece-is-practised.md)

## Context

The interview chose three displays: standard staff notation, an on-screen keyboard, and chord
and key labels. Standard notation hides two different problems:

- **The live staff** shows the notes currently held, as they are played. There is no rhythm to
  engrave: a held chord is one stack of noteheads on a grand staff, respelled as the detected key
  changes. It must repaint within the latency budget (NFR 1) on every event.
- **The score** is a full MusicXML piece, engraved once, with a cursor that follows the player
  and notes coloured by the outcome of Plan 0003's alignment. It repaints rarely and can take a
  second to lay out.

Pieces arrive as MusicXML (first choice, from MuseScore exports), as MIDI files (common, but
carrying no notation), and from the built-in exercise generator (which can emit either).

## Decision

We will use **two engines, one per problem**:

- **VexFlow, directly, for the live staff.** The renderer keeps one grand-staff canvas and, on
  every `MidiEvent`, draws the currently held set as a single chord per stave with key-aware
  spelling from `core/`. No measures, no rhythm, no layout pass.
- **OpenSheetMusicDisplay (OSMD) for the score.** It parses MusicXML, engraves it (on VexFlow
  underneath), and exposes a cursor that iterates notes with their timestamps. `core/` derives the
  **expected-note timeline** for alignment from OSMD's parsed model rather than from its own
  MusicXML parser, so the notes the player is judged against are exactly the notes on screen.
  Feedback is painted by colouring OSMD's note elements per bar.
- **MIDI files are second-class input.** A MIDI file becomes a note timeline directly (via
  `@tonejs/midi`), drives the keyboard's target-key highlighting and the alignment, and is shown
  on the staff only as a best-effort quantised rendering through VexFlow. The exercise generator
  emits MusicXML so exercises get the first-class path.

## Consequences

### Positive

- **Each engine does what it is good at.** OSMD's layout pass would miss the latency budget on
  every key press; VexFlow alone would mean writing a MusicXML engraver.
- **One source of truth for the score.** What is judged is what is drawn.
- **MIDI files work on day one** for play-along, without pretending they carry notation.

### Negative

- **Two engines on the page, and OSMD bundles its own VexFlow.** Two copies in the bundle. The
  renderer imports VexFlow once for the live staff and lets OSMD own its copy; the versions are
  pinned and recorded in Plan 0001.
- **OSMD's parsed model is a semi-public API.** Deriving the timeline from it couples us to OSMD's
  internals, which have moved between versions. The mitigation is a fixture test in `core/` that
  holds the derived timeline for three committed MusicXML files, so an OSMD upgrade that changes
  the model fails a test instead of mis-grading a bar. If the coupling costs more than it saves,
  the fallback is a small MusicXML note parser of our own; the interface the alignment consumes
  does not change.
- **A MIDI file's staff view will sometimes look wrong** (ties, tuplets, voicing). The UI labels
  the view as derived from MIDI, and the user picks MusicXML when the notation matters.

## Alternatives considered

### Alternative A — OSMD for everything, including the live staff
One engine. Rejected because OSMD engraves a document: a full layout pass per key press is tens
of milliseconds at best and allocates heavily, which is the wrong shape for a view that repaints
on every event.

### Alternative B — abcjs or Verovio
abcjs renders ABC notation well but MusicXML import is partial. Verovio (C++ compiled to WASM)
engraves beautifully and handles MEI and MusicXML, but its cursor and note-by-note styling story
is thinner than OSMD's and it adds a WASM toolchain. Either would do for a reader; neither beats
OSMD for a score that must be coloured note by note as the player goes.

### Alternative C — Transcribe MIDI files into proper notation
Quantise, detect key, split hands and voices. A project in itself, and MuseScore already does it
offline: the user can import a MIDI file there and export MusicXML. Rejected for v1; named as a
later plan if MIDI-only material turns out to be most of what is practised.
