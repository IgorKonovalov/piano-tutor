# ADR-0018 — The timeline carries the page: ornaments expanded, pedal as its own track

> **Status:** proposed
> **Date:** 2026-09-11
> **Related plan(s):** Plan [0010](../plans/0010-the-timeline-tells-the-truth-about-the-page.md)

## Context

ADR-0005 decided that the expected-note timeline is extracted once, from OSMD's model, by the
library that draws the page. It said nothing about the marks *over* the notes, and
`ExpectedNote` has carried the same eight fields since: `midi`, `onset`, `duration`, `bar`,
`staff`, `voice`, `tied`, `grace`. That silence has now produced two defects on real scores, both
found at the CK88 on 2026-09-11 during Plan 0004's Phase 7, and neither visible to any fixture.

**A bar of zero beats makes a real score unplayable.** `ExpectedBarSchema` requires
`beats: z.number().positive()`; `renderer/score/timelineFromOsmd.ts` maps OSMD's
`Duration.RealValue` straight through, and that value is **0** for an attributes-only measure —
the carrier bar where BWV 555's Prelude ends, the metre changes and the Fugue begins. `player:play`
is refused by Zod. The score practises fine, because the practice path builds the timeline in the
renderer and validates nothing, so the defect surfaces on one path out of two. `barTableProblems`
cannot catch it either: it checks only that `onset + beats` reaches the next bar's `onset`, and a
zero-length bar is perfectly contiguous.

**A symbol ornament scores a correctly-played bar as wrong.** ADR-0009 made an ornament optional
and it fixed exactly one shape of ornament: the *written-out grace note*, a small notehead on the
stave, which `timelineFromOsmd.ts` reads as `voiceEntry.IsGrace`. A turn, trill or mordent is not a
note at all; it is a **symbol over a principal note**, and OSMD puts it in
`voiceEntry.OrnamentContainer`, a property the extractor has never looked at. The timeline gets
**one** note. A player who correctly realises the turn plays four or five where one is expected,
the surplus matches nothing, `report.ts` charges each as `extra`, and the bar goes `wrong` — the
precise failure ADR-0009 was written to end, still live by another route. The blind spot that hid
the first one is still open: no fixture score in this repository contains a `<turn>`,
`<trill-mark>` or `<mordent>`, and `grace-note.musicxml`'s own header comment reads "real
repertoire is full of ornaments".

**And the user asked for pedal.** Plan 0004's Phase 7 item 3 asks for a piece to play "with the
sustain pedal messages included" and a score cannot: there is nowhere in the timeline for a pedal
mark to live, so `scheduleFromTimeline` has none to emit. The item was mis-specified against this
ADR's predecessor rather than wrong to want.

Three facts about the libraries narrow the field before taste does.

- **OSMD already realises an ornament.** `VoiceEntry.createVoiceEntriesForOrnament(entry,
  activeKey)` returns the voice entries a turn or trill means, with the active key applied and the
  `AccidentalAbove` / `AccidentalBelow` of the `OrnamentContainer` honoured. We do not have to
  write a turn-realiser, and under ADR-0005 we should not: the realisation belongs to the library
  that owns the parse.
- **Pedal is reachable and already carries our coordinate.**
  `SourceMeasure.StaffLinkedExpressions[][]` yields `MultiExpression`s with `PedalStart` and
  `PedalEnd`, each with an `AbsoluteTimestamp` — the same `Fraction` the extractor already uses for
  notes and measures.
- **Nothing divides by `beats`.** Every consumer in the repository uses it additively, as
  `onset + beats`: `perturb.ts`, `schedule.ts`, and three sites in `timeline.ts`. Alignment does
  not read it at all. A zero is arithmetically harmless everywhere it lands today.

The backlog argued, before any of this was planned, that the shape question "should be taken once
for the whole list rather than per sign". This is that once.

## Decision

`ExpectedTimeline` gains what the page says, in three moves, and the rest of the application goes
on seeing plain notes.

**A bar may be empty.** `beats` relaxes from `positive()` to `nonnegative()`. A zero-length bar is
a true report of an attributes-only measure and it stays indexed where the score put it, because
"indexed 0 to N as the score was parsed, with no index skipped" is the contract bar-clicking and
every take's bar numbers depend on. `barTableProblems` gains a line that *names* a zero-length bar:
it remains legal and stops being invisible.

**An ornament is expanded at extraction, and what it expands into is not scored.** The extractor
reads `voiceEntry.OrnamentContainer`, calls OSMD's own `createVoiceEntriesForOrnament`, and puts
the resulting pitches into `notes[]`. The `grace` boolean generalises to **`optional: boolean`**
alongside **`ornament: OrnamentKind | null`**, so a written-out grace note and a realised trill
share one scoring path — ADR-0009's, where `scoredNotes` excludes them and `onsetGroups` attaches
them to the group they decorate as optional pitches — while staying distinguishable in the data.
Playing the ornament costs nothing and leaving it out costs nothing, and the demonstration plays it.

**Pedal is its own track.** `ExpectedTimeline` gains `pedal: PedalMark[]`, each
`{ at, down, staff }`, read from the `PedalStart` and `PedalEnd` expressions at their
`AbsoluteTimestamp`. It is not a field on a note, because a pedal press happens *between* notes and
over rests, and because the pedal-**up** moment — the one that decides whether a chord blurs into
the next — belongs to no note at all. Scoring ignores the track entirely; it exists for playback,
which emits CC 64 from it.

Dynamics stay out. ADR-0005's tempo-free and dynamics-free premise is untouched: playback's fixed
velocity remains a decision, and a hairpin reaching velocity needs its own ADR amending that one.
Fingering stays out because it changes neither what is played nor how it is judged.

We rejected a parallel `marks[]` array because it makes two consumers each implement what a turn
means, and we rejected pedal as a field on a note because a press over a rest has nowhere to live.

## Consequences

### Positive

- **Both live defects close, and the ornament one closes through the mechanism that already
  works.** The fix is `optional` where `grace` was, not a new scoring path — ADR-0009's
  `scoredNotes` / `graceNotes` split is proven and gains one more producer.
- **The demonstration plays the music.** A piece with ornaments and pedal sounds like the piece,
  which is the whole point of an app that plays a passage back to you.
- **We never own a turn-realiser.** Realisation stays inside OSMD, which is what ADR-0005 bought
  and what a second parser would have cost.
- **One home for the next sign.** A future ornament kind is an enum value and a flag, not a
  schema debate.
- **Pedal timing is first-class**, so the pedal-up is available to anything later that wants to
  say a passage was over-pedalled.

### Negative

- **`notes[]` stops being one-to-one with noteheads on the page.** This is the real price. An
  expanded ornament note **has no notehead of its own**: four pitches point at one glyph.
  Plan [0007](../plans/0007-what-you-played-drawn-on-the-score.md) keys its draw-time index on
  `sourceNote` identity, and its Phase 1 done-when is stated over *scored* notes — which the
  `optional` flag excludes, so that done-when survives this change untouched. What does not survive
  untouched is the second half of that plan: a player who correctly realises a turn produces played
  notes that match **optional expected notes with no glyph to ghost onto**, and that plan has to
  decide whether they draw on the principal note, draw nowhere, or are skipped like the grace notes
  they now share a flag with. The obligation is narrow and it is recorded here rather than
  discovered there.
- **We inherit OSMD's realisation choices.** How many notes a trill gets, whether a turn starts on
  the note or above, what a delayed turn delays by: OSMD picks one answer, the answer is
  tempo- and era-dependent, and it may not be what the player was taught. The `optional` flag is
  what makes this affordable — a mismatch costs nothing in scoring, and only the demonstration
  sounds one particular reading. If that reading is wrong enough to mislead, the response is to
  stop expanding that kind, not to write our own realiser.
- **Fixture churn.** Renaming `grace` to `optional` rewrites five committed timelines and the e2e
  test that pins them ("the committed timelines still match what the app extracts"). That test is
  doing its job; the churn is the cost of it doing its job.
- **A zero-length bar stays a trap for anything that later divides.** Nothing does today. The named
  check in `barTableProblems` is the only guard, and it reports rather than refuses.

### Neutral

- The timeline grows. Fixture files get longer wherever a score has ornaments, which makes the
  committed-timeline diffs more informative and more tedious in equal measure.
- `pedal[]` is a third top-level array beside `notes` and `bars`. Consumers that ignore it are
  correct to ignore it, which is the property `marks[]` could not offer.

## Alternatives considered

### Alternative A — a parallel `marks[]` beside the notes, expanded by whoever needs it

The timeline keeps `notes[]` literally faithful to the page and gains
`marks: { kind, at, bar, staff, … }[]` holding ornaments, pedal, dynamics, hairpins and fingering
together. Playback expands an ornament at schedule time; scoring consults the marks to decide what
is optional.

Rejected because it puts "what a turn means" in two places that can disagree, and because a
consumer that simply ignores `marks[]` scores wrong while looking correct — which is exactly how
the present bug survived. The faithfulness it buys is real but is worth less than one answer in one
place, and the cases it uniquely serves (dynamics, hairpins) are excluded from this ADR anyway.

### Alternative B — pedal as a field on `ExpectedNote`

Each note carries `pedalled: boolean`, and no new array appears.

Rejected because a pedal press between two notes, or held across a bar of rests, has no note to
hang on, and because the pedal-up moment is lost entirely — and the lift is the half that decides
whether a chord blurs into the next. A model that can say "pedal down" and not "pedal up" is worse
than no model.

### Alternative C — fix the two defects and defer the model

Relax `beats`, teach the aligner to accept surplus notes in an ornamented group, and leave
extraction alone: no expansion, no pedal.

Rejected because it buys the smaller half of the fix at nearly the price of the larger one. The
demonstration would still play the passage stripped of its ornaments, which is a worse reference
than none for a player learning the piece; the pedal answer the user gave would go unhonoured; and
the amendment to ADR-0005 would still be owed the first time anything else read the page.

## Notes

The ornament kinds OSMD's `OrnamentEnum` distinguishes, and therefore the vocabulary of
`OrnamentKind`: `Trill`, `Turn`, `InvertedTurn`, `DelayedTurn`, `DelayedInvertedTurn`, `Mordent`,
`InvertedMordent`.

The accidental drawn under or over an ornament — visible in the user's own screenshot of the bar
that prompted this — is `OrnamentContainer.AccidentalAbove` and `.AccidentalBelow`, and
`createVoiceEntriesForOrnament` takes the active key, so both are OSMD's to apply rather than ours.

Whether `beats` of `0` should instead have been prevented at the source — by merging an
attributes-only measure into its neighbour — was considered and dropped in one line: it breaks the
bar-index contract, and a bar the engraver drew is a bar the player can click.
