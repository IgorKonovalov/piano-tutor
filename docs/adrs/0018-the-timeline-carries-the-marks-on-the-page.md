# ADR-0018 — The timeline carries the marks on the page, as OSMD reads them

> **Status:** proposed
> **Date:** 2026-09-11; revised the same day, while still proposed, after Plan 0010's Phase 3
> stopped on OSMD's ornament realiser (route 1 and two alternatives)
> **Related plan(s):** Plan [0010](../plans/0010-the-timeline-tells-the-truth-about-the-page.md)
> **See also:** [ADR-0021](0021-expression-belongs-to-playback-scoring-only-describes-it.md), which
> decides *who may act* on what this ADR extracts. The two were written together and neither is
> complete alone.

## Context

ADR-0005 decided that the expected-note timeline is extracted once, from OSMD's model, by the
library that draws the page. It said nothing about the marks *over* the notes, and `ExpectedNote`
has carried the same eight fields since: `midi`, `onset`, `duration`, `bar`, `staff`, `voice`,
`tied`, `grace`. The timeline knows what to play and when. It knows nothing about how.

That silence has produced two defects on real scores, both found at the CK88 on 2026-09-11 during
Plan 0004's Phase 7, and neither visible to any fixture.

**A bar of zero beats makes a real score unplayable.** `ExpectedBarSchema` requires
`beats: z.number().positive()`; `renderer/score/timelineFromOsmd.ts` maps OSMD's
`Duration.RealValue` straight through, and that value is **0** for an attributes-only measure —
the carrier bar where BWV 555's Prelude ends, the metre changes and the Fugue begins. `player:play`
is refused by Zod. The score practises fine, because the practice path builds the timeline in the
renderer and validates nothing, so the defect surfaces on one path out of two. `barTableProblems`
cannot catch it either: it checks only that `onset + beats` reaches the next bar's `onset`, and a
zero-length bar is perfectly contiguous.

**A symbol ornament scores a correctly-played bar as wrong.** ADR-0009 made an ornament optional
and it fixed exactly one shape of ornament: the *written-out grace note*, which the extractor reads
as `voiceEntry.IsGrace`. A turn, trill or mordent is not a note at all; it is a **symbol over a
principal note**, and OSMD puts it in `voiceEntry.OrnamentContainer`, a property the extractor has
never looked at. The timeline gets **one** note. A player who correctly realises the turn plays four
or five where one is expected, the surplus matches nothing, `report.ts` charges each as `extra`, and
the bar goes `wrong` — the precise failure ADR-0009 was written to end, still live by another route.
No fixture score in this repository contains a `<turn>`, `<trill-mark>` or `<mordent>`.

**And then the user asked for the rest of it.** On 2026-09-11, having watched playback work: the
app should play the music *as written* — its dynamics, its changes of tempo, its ornaments — and
send pedal if it can. Today playback fixes **velocity at 72 for every note** and takes its tempo
from a box in the transport. A demonstration of a Chopin nocturne and a demonstration of a scale
exercise are, to the ear, the same performance at different pitches. That is not a missing feature
so much as a missing dimension: the app can say *what* to play and cannot say *how*.

**The library reads all of it already, and this is the fact that decides the shape.** Every mark
under discussion is on OSMD's model, and in each case OSMD has done the interpretation that is
easy to get wrong:

| Mark | Where | What OSMD already decides for us |
|---|---|---|
| Ornaments | `voiceEntry.OrnamentContainer` | `createVoiceEntriesForOrnament(entry, activeKey)` **realises the turn into notes**, with the active key applied, plus a trill's above-accidental (a below-accidental is drawn and never played) |
| Pedal | `MultiExpression.PedalStart` / `.PedalEnd` | start and end, at an `AbsoluteTimestamp` |
| Dynamics | `MultiExpression.InstantaneousDynamic` | `MidiVolume` and `Volume` — **the pp-to-ff mapping already exists** (`dynamicToRelativeVolumeDict`) |
| Hairpins | `MultiExpression.StartingContinuousDynamic` / `.EndingContinuousDynamic` | the span, and its end dynamic |
| Tempo words | `MultiTempoExpression.InstantaneousTempo` | the whole Italian vocabulary, Larghissimo to Prestissimo, plus metronome marks |
| rit. / accel. | `MultiTempoExpression.ContinuousTempo` | 15 types, and **`getInterpolatedTempo(timestamp)`** — the curve itself |
| Articulation, fermata | `voiceEntry.Articulations` | a 28-value `ArticulationEnum` including `staccato`, `tenuto`, `accent` and `fermata` |

Pedal, dynamics and hairpins come off **the same walk** — they are all properties of the
`MultiExpression`s in `SourceMeasure.StaffLinkedExpressions`. Tempo is one more walk over
`SourceMeasure.TempoExpressions`. This is a day's extraction, not a project, and the reason it is
cheap is precisely ADR-0005: we bought one parse by a real engraver, and this is the dividend.

The backlog argued, before any of this was planned, that the shape question "should be taken once
for the whole list rather than per sign". This is that once.

## Decision

`ExpectedTimeline` gains what the page says. **OSMD's reading is the reading** — wherever that
library has already interpreted a mark, we take its answer rather than computing our own.

Marks enter by one of three routes, and which route a mark takes is decided by **what kind of thing
it is**, not by which consumer wants it:

**1. Note-generating and ambiguous marks are expanded at extraction.** An ornament becomes real
notes, via `createVoiceEntriesForOrnament`. They enter `notes[]` flagged `optional: true` with an
`ornament` kind recorded, so a written-out grace note and a realised trill share ADR-0009's single
scoring path — `scoredNotes` excludes them, `onsetGroups` attaches them to the group they decorate —
while staying distinguishable in the data. Playing the ornament costs nothing, leaving it out costs
nothing, and the demonstration plays it. This route exists because realising a turn is a *judgement*
with more than one defensible answer, and a judgement must be made once, by one party, at one time.

Four refinements come from running the realiser against a real fixture (Plan 0010, Phase 3):

- **OSMD's rhythm is captured as it is made.** In OSMD 2.1.2 every branch except the trill passes
  one `Fraction` by reference into each entry it builds and then mutates it, so the returned
  timestamps, and for some kinds the lengths, all read the final value. The values are correct at
  the moment each entry is built. The extractor wraps the two private builders on the one
  `VoiceEntry` for the duration of the call and records them there. The pitches, their order and
  their rhythm all stay OSMD's; only the moment we read them changes.
- **The principal stays scored and is sounded by its realisation.** It keeps `optional: false`
  and its written length, and it carries the ornament's kind. Every OSMD realisation re-emits the
  principal's pitch, so sounding the principal as well would restrike a key that is already held.
- **This amends ADR-0009's subtraction.** ADR-0009 removes optional pitches from what was played
  before comparing. Because a realisation re-emits the principal's pitch, that would remove the
  principal the player struck and report it `missing`. An optional pitch now forgives only a
  **surplus** strike: the scored pitches come out of the struck set first, and only what is left
  over may be excused. Wherever optional and scored pitches are disjoint this is identical to
  ADR-0009. Where they are not, it is what ADR-0009's own decision says, "nothing when the player
  strikes it and nothing when they do not", and the literal mechanism was not. That also closes a
  latent case the rule always had: a grace note repeating a chord tone.
- **A realised note attaches backwards.** It sounds within its principal, after that note's onset,
  so it joins the last group at or before its own onset. A grace note keeps ADR-0009's forward
  rule, because it anticipates its principal.

**2. Marks that are properties of a note ride the note.** `articulation: Articulation[]` and
`fermata: boolean` are fields on `ExpectedNote`, because a staccato dot and a fermata sit over a
specific notehead and belong to nothing else.

**3. Everything spanning or between notes becomes its own track.** `ExpectedTimeline` gains
`pedal: PedalMark[]`, `dynamics: DynamicMark[]` and `tempo: TempoMark[]`. A pedal press happens
*between* notes and over rests; a hairpin spans a passage; a rit. is a property of a stretch of
music. None of them is a property of any single note, and the pedal-**up** — the moment that decides
whether a chord blurs into the next — belongs to no note at all. These tracks are a faithful record
of the page: a `DynamicMark` says "forte here", not "velocity 88 on these nineteen notes".

**The arithmetic on those tracks happens once, in `core/`, at schedule time.**
`scheduleFromTimeline` resolves a dynamic to a velocity per note, interpolates a hairpin across its
span, converts a tempo mark and a rit. curve into milliseconds, lengthens a fermata, and shortens a
staccato. It is a pure function with fixture tests, and it is the **only** consumer of these tracks.

**A bar may be empty.** `beats` relaxes from `positive()` to `nonnegative()`. A zero-length bar is a
true report of an attributes-only measure and it keeps its index, because "indexed 0 to N as the
score was parsed, with no index skipped" is the contract bar-clicking and every take's bar numbers
depend on. `barTableProblems` gains a line that *names* a zero-length bar: it stays legal and stops
being invisible.

Fingering stays out. OSMD already draws it; it changes neither what is played nor how it is judged,
and it enters the data the day the coach comments on it.

We rejected a single undifferentiated `marks[]` array, and we rejected resolving dynamics and tempo
into per-note numbers at extraction.

## Consequences

### Positive

- **Both live defects close, and the ornament one closes through the mechanism that already
  works.** The fix is `optional` where `grace` was, not a new scoring path.
- **The demonstration becomes music.** A piece plays with its dynamics, its pedal, its ornaments
  and its changes of tempo, which is the difference between a reference recording and a MIDI file
  read aloud.
- **We never own an interpreter.** No turn-realiser, no pp-to-velocity table, no rit. curve. Each of
  those is a place to be subtly wrong, and each stays inside the library that owns the parse.
- **One home for the next sign**, and a rule for which home: note-generating and ambiguous expands,
  note-owned rides the note, spanning gets a track.
- **The tracks stay faithful to the page**, so anything later that wants to *say* something about a
  mark — that the score asked for this rallentando — reads the mark rather than reverse-engineering
  it from a velocity.
- **Pedal, dynamics and hairpins are one traversal.** The extraction is smaller than the list
  suggests.

### Negative

- **`notes[]` stops being one-to-one with noteheads on the page.** This is the real price. An
  expanded ornament note **has no notehead of its own**: four pitches point at one glyph.
  Plan [0007](../plans/0007-what-you-played-drawn-on-the-score.md) keys its draw-time index on
  `sourceNote` identity, and its Phase 1 done-when is stated over *scored* notes — which the
  `optional` flag excludes, so that done-when survives untouched. What does not survive is the
  second half of that plan: a player who correctly realises a turn produces played notes matching
  **optional expected notes with no glyph to ghost onto**, and that plan must decide whether they
  draw on the principal note, draw nowhere, or are skipped like the grace notes they now share a
  flag with. Recorded here rather than discovered there.
- **We inherit OSMD's interpretive choices, and some are genuinely arguable.** How many notes a
  trill gets, whether a turn starts on the note or above, what `dynamicToRelativeVolumeDict` thinks
  *mezzo-forte* is worth, how steep `getInterpolatedTempo` makes a rallentando. Where the choice is
  note-generating the `optional` flag makes it free — a mismatch costs nothing in scoring and only
  the demonstration sounds one particular reading. Where it is a velocity or a tempo it is simply
  audible, and the remedy is to stop reading that mark rather than to start second-guessing the
  library.
- **Three new top-level arrays and two new note fields.** The timeline roughly doubles in
  description, fixture files get materially longer, and the committed-timeline diffs get more
  informative and more tedious in equal measure.
- **Fixture churn, twice over.** Renaming `grace` to `optional` and adding the tracks rewrites six
  committed timelines and the e2e test that pins them. That test is doing its job.
- **The schedule builder gets substantially more interesting**, and it is now the place where a
  bug makes the app play the wrong thing rather than crash. It needs fixture tests per mark, and it
  is where this plan's real risk sits.
- **A zero-length bar stays a trap for anything that later divides.** Nothing does today; the named
  check in `barTableProblems` reports rather than refuses.
- **The ornament extraction leans on two private OSMD methods** keeping their names and call order.
  The exact pin means only a deliberate upgrade can break it. The extractor declines to expand an
  ornament whose captured and returned entries disagree, so a break shows as an unexpanded
  ornament and a failing fixture property, never as a wrong rhythm.
- **Some of OSMD's choices here are arguably mistakes rather than interpretations.** Its reader
  maps MusicXML's `<mordent>` (the sign with the vertical line, conventionally the lower mordent)
  to a realisation that goes up. Inheriting that costs the scorer as well as the demonstration: a
  player who follows the page strikes a lower auxiliary that is not optional.

### Neutral

- Consumers that ignore the new tracks are *correct* to ignore them, which is the property a single
  `marks[]` array could not offer.
- Dynamics no longer make Plan 0004's fixed velocity of 72 a decision; it becomes the fallback for a
  passage the page says nothing about.

## Alternatives considered

### Alternative A — one undifferentiated `marks[]` beside the notes

The timeline keeps `notes[]` literally faithful and gains a single `marks[]` holding ornaments,
pedal, dynamics, hairpins, tempo and articulation together, which each consumer filters.

Rejected because it puts "what a turn means" in whichever consumers care, and because a consumer
that ignores `marks[]` scores wrong while looking correct — exactly how the present ornament bug
survived. It also flattens a real distinction: an ornament needs a *judgement* made once at
extraction, a hairpin needs *arithmetic* done once at schedule time, and a staccato is a property of
one note. One array for three kinds of thing means the kind has to be re-derived at every use.

### Alternative B — resolve dynamics and tempo to per-note numbers at extraction

Every `ExpectedNote` gets a final `velocity`, and every onset a final millisecond offset. The
schedule builder stays trivial.

Rejected because it throws away the page. Once forte has become velocity 88 on nineteen notes,
nothing downstream can say "the score asks for forte here" — and ADR-0021 turns on exactly that
sentence. It also puts musical interpretation in the renderer, where it is hardest to test, instead
of in `core/`, where it is a pure function with fixtures. The extractor's job is to report what is
written; deciding what it sounds like is a separate step and belongs on the other side of the
process boundary.

### Alternative C — fix the two defects and defer the expression

Relax `beats`, teach the aligner to accept surplus notes in an ornamented group, and leave
extraction otherwise alone.

Rejected on the user's explicit ask. It also buys the smaller half of the fix at nearly the price of
the larger: the demonstration would still play every piece stripped to a uniform 72, and the
amendment to ADR-0005 would still be owed the first time anything else read the page.

### Alternative D — transcribe OSMD's intended ornament rhythm into a table of ours

Take only the pitches from `createVoiceEntriesForOrnament` and lay them out with per-kind fractions
copied from its source (trill 8 x 1/8, turn 4 x 1/4, mordent 1/4 1/4 1/2, and so on). It needs no
private method.

Rejected because it is the realiser this ADR refuses to own, reached by copying rather than by
writing. The table would silently disagree with the library the day OSMD changes a rhythm, while
the captured values follow it.

### Alternative E — keep ADR-0009's subtraction and leave the principal's pitch out of the optional set

Make the optional pitches the realisation minus the principal's pitch, so a plain strike of the
principal is never subtracted.

Rejected because it fails the other take. A turn played in full strikes the principal's pitch
twice, and with no optional copy to absorb the second strike it is charged `extra`. The two correct
performances ADR-0009 protects, the ornament taken and the ornament left out, can only both come
out clean if forgiveness is limited to the surplus.

## Notes

`OrnamentEnum`, and therefore the vocabulary of `OrnamentKind`: `Trill`, `Turn`, `InvertedTurn`,
`DelayedTurn`, `DelayedInvertedTurn`, `Mordent`, `InvertedMordent`.

`ContinuousTempoType` carries fifteen values — `accelerando`, `stretto`, `stringendo`, `mosso`,
`piuMosso`, `allargando`, `calando`, `menoMosso`, `rallentando`, `ritardando`, `ritard`, `rit`,
`ritenuto`, `rubato`, `precipitando`. Not all of them are a simple speed ramp; `rubato` in
particular is a direction to a human, not a curve, and the plan is free to read a subset and say so.

`ArticulationEnum` has 28 values, most of them irrelevant to a keyboard (`upbow`, `snappizzicato`).
The keyboard-relevant subset is roughly `staccato`, `staccatissimo`, `tenuto`, `accent`,
`strongaccent`, `marcatoup`, `marcatodown`, `detachedlegato` and `fermata`.

Whether `beats` of `0` should instead be prevented by merging an attributes-only measure into its
neighbour was considered and dropped in one line: it breaks the bar-index contract, and a bar the
engraver drew is a bar the player can click.
