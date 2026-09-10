# ADR-0013 — What you played is drawn over the engraving, never into it

> **Status:** proposed
> **Date:** 2026-09-10
> **Related plan(s):** Plan [0007](../plans/0007-what-you-played-drawn-on-the-score.md)

## Context

Plan 0002 shipped the diagnosis as colour and text: a bar goes red, and a panel beside the score
says "E2 was played but not written". The user's verdict after using it at the piano on 2026-09-10
was that this is not enough — "I need to see where and what I've played wrong" — and they are
right about why. A bar is four to twelve notes wide. Telling a player that something in bar 5 was
wrong, and separately telling them the letter name of a pitch, asks them to do the join themselves,
on a page they are already struggling to read. The information is positional and it is being
delivered as prose.

Everything needed is already in hand. `NoteVerdict` carries both sides of the error — a
`wrongPitch` holds `expected` and `played` together. `renderer/score/OsmdView.tsx` already draws
marks as an overlay layer positioned from OSMD's own graphical model, and the comment at the top
of that file records why: "a mark is then a box we position from OSMD's own graphical measure, so
a bar mark cannot land anywhere except on the bar OSMD drew; and marking costs no layout pass".
That is bar granularity; note granularity is one level deeper in the same structure, and each
graphical note carries the `sourceNote` object the timeline extraction already walked, so the
correspondence is object identity rather than a match on (bar, onset, pitch).

What is genuinely new is the second half of the request. **What** you played wrong is a pitch that
is *not in the document*. A wrong note is a note nobody engraved: it has no notehead, no stem, no
accidental and no ledger lines anywhere in OSMD's model, because OSMD only knows the score. So
this is the first time the application must draw a musical symbol that the score does not contain,
and that is a question ADR-0003 did not answer. That ADR assigns VexFlow to the live staff and
OSMD to the score on the grounds that "VexFlow repaints on every event; OSMD lays out a document".
Neither engine owns "a symbol drawn on top of a document, at a pitch the document does not have".

One further constraint comes from ADR-0005 and is easy to trip over. The timeline is extracted
from OSMD's **parsed** model (`sheet.SourceMeasures`), never the drawn one — which is why the
extraction's unit test runs under jsdom, where OSMD parses but does not lay out, and why the
committed fixture timelines are layout-independent and hash-stable. Any correspondence to a *drawn*
notehead is therefore a renderer-only, draw-time concern and must never be baked into a fixture.

## Decision

The application draws what the player played as **its own SVG overlay on top of OSMD's
engraving**, positioned from OSMD's graphical model and never merged into it. A written note that
was missed or mis-struck is marked in place over the notehead OSMD drew; the pitch actually played
is drawn beside it as a distinct ghost notehead at its own staff position, with the ledger lines
and accidental that pitch needs, on the same stave. OSMD is asked for coordinates, never for a
re-layout, and its document is never modified.

Three things follow and are part of the decision:

- **The overlay owns its own glyphs.** Noteheads, ledger lines and accidentals in the overlay are
  drawn by us, not borrowed from either notation engine. They are deliberately not
  engraving-quality and must not try to be: a ghost note is an annotation on a score, and it reads
  correctly only if it is visibly an annotation rather than something the composer wrote.
- **Staff position comes from `core/`, clef reference comes from OSMD.** The diatonic step of a
  MIDI pitch is a pure function of the pitch and the key's spelling, and `spellNote` already
  computes the letter, accidental and octave that determine it. Where that step sits in pixels
  depends on the clef and the staff OSMD actually drew, and is read from the graphical model, so a
  mid-piece clef change is handled by the data rather than by arithmetic in a component.
- **Nothing is re-engraved and no layout pass is spent.** The overlay is recomputed from cached
  boxes on resize, zoom and re-render, exactly as the bar marks already are, so this stays off the
  paint path that NFR 11 defends.

ADR-0003 stands: VexFlow still draws the live staff and OSMD still draws the score. This ADR adds
a third, narrower surface between them and names its bounds.

## Consequences

### Positive

- **The answer is where the question is.** The player looks at one image, at the bar they fumbled,
  and sees both the note that was written and the note they hit, a staff step apart. That is the
  entire request and no other option delivers it in one image.
- **It costs no engine and no dependency.** The mechanism is the overlay Plan 0002 already built
  and proved, one level deeper in the same structure.
- **`extra` notes become expressible.** A note played with nothing written for it has no notehead
  to recolour and cannot exist in a modified document without inventing a duration for it; as an
  overlay glyph it simply appears where it landed.
- **The engraving stays honest.** The score on screen remains exactly what the composer wrote, so
  a player is never taught a wrong reading of their own music by an app annotating it.
- **It generalises.** A fingering hint, a hand-position mark or the sight-reading curtain are all
  the same surface, so the next annotation is a glyph rather than an architecture.

### Negative

- **We are now in the notation-drawing business, slightly.** Ledger lines, accidental glyphs and
  vertical spacing are engraving problems with real edge cases, and we have taken on a small
  corner of one. It will look wrong somewhere — very high or very low pitches, a double
  accidental, a dense chord — and each of those is ours to fix rather than a library's.
- **The overlay depends on OSMD's internal graphical structure**, one level deeper than the bar
  marks already do. `MeasureList`, `staffEntries`, `graphicalVoiceEntries` and `sourceNote` are not
  a stability guarantee, so an OSMD upgrade can break note-level positioning in a way it cannot
  break a measure box. The pin is exact (NFR 9), which turns this into a known cost at upgrade
  time rather than a surprise.
- **Two glyphs can collide.** A ghost a step away from the written note, in a dense chord, on a
  ledger line, will sometimes overlap something. There is no engraver to resolve it, so collision
  is handled by convention (a fixed horizontal offset) rather than by layout, and it will not
  always be pretty.
- **An `extra` note has no horizontal anchor.** Nothing was written for it, so its position is
  derived from when it landed relative to the notes around it — an inference, and the one place in
  this feature where the overlay can point somewhere misleading.

### Neutral

- The overlay grows from one kind of box to three kinds of glyph, so `OsmdView` gains real
  drawing responsibility and will want splitting before it grows again.
- Marks are annotations, so they carry text for a screen reader the way bar marks already do;
  colour is not the only carrier of a verdict here either.

## Alternatives considered

### Alternative A — A "what you played" stave under each system, drawn with VexFlow

Leave the engraving untouched and render a transcription of the take beneath it, bar-aligned,
using the engine ADR-0003 already assigns to live playing. Genuinely strong: extras and rhythm
read naturally because it is a real transcription rather than an annotation, and it needs no
glyph-drawing of our own. Rejected because it delivers two images and asks the eye to correlate
them, which is the same join the player is being asked to make today between a red bar and a line
of text — moved, not removed. It also needs its own bar-alignment layout against OSMD's systems,
which is the expensive half of engraving without the benefit. It remains the right answer the day
rhythm, rather than pitch, is what the player needs to see, and Plan 0007 records it as a followup.

### Alternative B — Recolour OSMD's own noteheads

OSMD exposes `NoteheadColor`, so a missed or mis-struck written note can be turned red inside the
document with almost no code. Rejected because it answers only half the request. A recoloured
notehead says *where* you were wrong and is structurally incapable of saying *what* you played,
because the pitch you played is not in the document to be coloured. It is a good cheap complement
and a bad substitute, and taking it would leave the actual ask unmet.

### Alternative C — Inject the played notes into the score and re-engrave

Modify the parsed sheet, or the MusicXML, to contain the played notes as a second voice, and let
OSMD draw them properly. Rejected on three counts: it spends a full layout pass per take, which is
what the existing overlay comment exists to avoid; it makes the engraving on screen no longer the
score the composer wrote, which is a lie the app should not tell; and it needs a written duration
for every played note, which the alignment does not produce and which would be invented.

### Alternative D — Names only, under the written note

Cross the written notehead and print "Eb4" beneath it. Cheapest by a distance — no staff
arithmetic, no ledger lines, no accidental glyphs. Rejected by the user directly: it is a variant
of what the app already does, and reading a letter name and converting it to a position on the
stave is the work the feature exists to remove.

## Notes

This ADR is about where the annotation is drawn, not about which faults are drawn or when they are
visible. Plan 0007 settles those: wrong pitch, missing and extra are drawn and timing is not, and
one toggle over the whole score shows or hides them. Both are tunables of that plan and neither
needs a superseding record to change.
