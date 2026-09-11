# 0010 — The timeline tells the truth about the page

> **Status:** in-progress 2026-09-11
> **Created:** 2026-09-11
> **Owner skill(s):** dev, human
> **Related ADRs:** [0018](../adrs/0018-the-timeline-carries-the-marks-on-the-page.md) (proposed)
> decides what the timeline extracts and in what shape;
> [0021](../adrs/0021-expression-belongs-to-playback-scoring-only-describes-it.md) (proposed)
> decides who may act on it and is what keeps the aligner tempo-free. Together they are this plan's
> whole design, and they amend
> [0005](../adrs/0005-the-expected-note-timeline-is-extracted-from-osmds-model.md) (accepted),
> which stays the rule that there is one parse and OSMD owns it.
> [0009](../adrs/0009-an-ornament-is-optional-a-grace-note-is-scored-neither-way.md) (accepted) is
> the scoring mechanism this plan gives a second producer;
> [0007](../adrs/0007-playback-is-a-schedule-built-in-core-and-clocked-by-main-behind-a-midisink.md)
> (accepted) owns the schedule that all of it reaches the instrument through;
> [0014](../adrs/0014-timing-is-judged-against-a-local-tempo-not-one-line-through-the-take.md)
> (accepted) is what Phase 8's annotation labels and must not disturb
> **NFRs claimed:** none new. NFR 12, 13 and **14** must be unchanged, and are re-reported — NFR 14
> in particular, because this plan is the one that could break tempo-freedom.
> **Depends on:** nothing in flight. It touches `ExpectedTimeline`, which Plan
> [0009](0009-a-bar-is-judged-note-by-note.md) also reads — see `## Risks & open questions` for the
> one field they could collide on.

## TL;DR

The app stops reading the page and starts reading the music. Two things that are broken today stop
being broken — a real score whose metre-change carrier bar has no length can be played at all, and
a bar with a turn over it stops being marked **wrong for being played correctly**. And the
demonstration stops being a MIDI file read aloud: a piece plays with its dynamics, its hairpins, its
pedal, its ornaments, its fermatas and its changes of tempo, every one of them read from OSMD's own
interpretation rather than invented here. Playback gets all of it; **the aligner gets none of it**,
which is the line ADR-0021 draws and the reason practising a study at half speed is still playing it
correctly. The one thing scoring gains is a better sentence: where the report already says you
slowed, it may now say you slowed *where the score asks you to*.

## Context & problem

Plan 0004's Phase 7 was the first time a real, un-fixtured piece went through the whole path at the
instrument, and it found two defects that every fixture in this repository had agreed to hide.

**`player:play` was refused by Zod for BWV 555.** `bars[25].beats` is `0`; `ExpectedBarSchema`
demands `z.number().positive()`. Measure 25 contains only an `<attributes>` element — no notes, no
rests — the carrier bar where the metre changes. OSMD reports `Duration.RealValue` of 0 and
`renderer/score/timelineFromOsmd.ts:45` maps it straight through.

Two things make it worth more than one file. **`barTableProblems` cannot catch it**: it checks only
that `onset + beats` equals the next bar's `onset`, and a zero-length bar is perfectly contiguous.
And **the timeline is schema-checked only when it crosses IPC for playback** — the practice path
builds it in the renderer and validates nothing — so this score practises fine and only fails to
play. That asymmetry is why it survived until a piece was played at the piano.

**A symbol ornament is a live scoring bug, and ADR-0009 does not cover it.** That ADR made an
ornament optional and fixed one shape of ornament: the written-out grace note, which the extractor
reads as `voiceEntry.IsGrace`. A turn, trill or mordent is a **symbol over a principal note**. OSMD
puts it in `voiceEntry.OrnamentContainer`; the extractor has never looked at that property; the
timeline gets one note. A player who correctly realises the turn plays four or five notes where one
is expected, the surplus matches nothing, `report.ts` charges each as `extra`, and the bar goes
`wrong`. It is the failure ADR-0009 exists to prevent, alive by another route, and **ADR-0009's own
Context argues for fixing it**: "the repertoire Phase 7 exists to try is exactly the repertoire that
has ornaments".

**The blind spot that hid it is still open, verified 2026-09-11.** No fixture score contains a
`<turn>`, `<trill-mark>` or `<mordent>`. The corpus gained `grace-note.musicxml` for ADR-0009 and
that file holds `<grace slash="yes"/>` — the case that was fixed. Its own header comment reads
"real repertoire is full of ornaments"; the symbol form was never added, so this path is exercised
by nothing, exactly as the grace path was not.

**And then the user asked for the rest of it.** On 2026-09-11, having watched playback work: the app
should play the music *as written* — its dynamics, its changes of tempo, its ornaments — and send
pedal if it can. Today **every note is velocity 72** and the tempo comes from a box in the transport.
A demonstration of a nocturne and a demonstration of a scale exercise are, to the ear, the same
performance at different pitches. Phase 7 item 3 of Plan 0004 had already asked for pedal the score
could not carry; that item was mis-specified against a timeline with nowhere to put one.

**The whole list is on OSMD's model, already interpreted.** This is what makes the plan affordable,
and ADR-0018 turns on it:

| Mark | Where | What OSMD decides for us |
|---|---|---|
| Ornaments | `voiceEntry.OrnamentContainer` | `createVoiceEntriesForOrnament` realises it, key and accidentals applied |
| Pedal | `MultiExpression.PedalStart` / `.PedalEnd` | start and end at an `AbsoluteTimestamp` |
| Dynamics | `MultiExpression.InstantaneousDynamic` | `MidiVolume` — the pp-to-ff mapping already exists |
| Hairpins | `.StartingContinuousDynamic` / `.EndingContinuousDynamic` | the span and its end dynamic |
| Tempo words | `MultiTempoExpression.InstantaneousTempo` | Larghissimo to Prestissimo, and metronome marks |
| rit. / accel. | `MultiTempoExpression.ContinuousTempo` | 15 types, and `getInterpolatedTempo` — the curve |
| Articulation, fermata | `voiceEntry.Articulations` | a 28-value enum including `staccato`, `tenuto`, `accent`, `fermata` |

Pedal, dynamics and hairpins hang off the **same** `MultiExpression` objects, so they are one
traversal rather than three. **We write no interpreter** — no turn-realiser, no pp-to-velocity
table, no rit. curve.

**The danger is entirely on the scoring side**, and it is not hypothetical. The aligner is
tempo-free by construction and four ADRs protect that: ADR-0005 makes onsets quarter notes, ADR-0009
refused to let a grace note consult a clock, ADR-0010 preserved it, ADR-0012 kept click-relative
scoring strictly beside it, and ADR-0014 fits tempo from the take's own neighbours. NFR 14 states
the property and `README.md` states it to the player. Let the page's tempo reach `align.ts` and a
learner working a study at half speed — the correct way to work a study — opens the app to find
every bar red. **ADR-0021 is the line, and this plan is where it is either held or lost.**

## Decision

Extract the marks once, in the library that draws them (ADR-0018); let playback use all of them and
the aligner none of them (ADR-0021).

**A bar may be empty.** `beats` relaxes to non-negative, a zero-length bar stays indexed where the
score put it, and `barTableProblems` gains a line that names one rather than passing it silently.

**Marks enter by one of three routes, decided by what kind of thing each is.** An **ornament** is
note-generating and ambiguous, so it is expanded at extraction by OSMD's own realiser and flagged
`optional` — the `grace` boolean generalises, so a realised trill and a written-out grace note share
ADR-0009's one scoring path while staying distinguishable through a new `ornament` kind.
**Articulation and fermata** are properties of a note and ride the note. **Pedal, dynamics,
hairpins and tempo** span or sit between notes, so each gets its own track holding what the page
says rather than a resolved number — a `DynamicMark` says "forte here", not "velocity 88 on these
nineteen notes".

**The arithmetic happens once, in `core/`, at schedule time.** `scheduleFromTimeline` resolves a
dynamic to a velocity, interpolates a hairpin, converts a tempo mark and a rit. curve into
milliseconds, holds a fermata and shortens a staccato. It is a pure function with fixture tests and
the only consumer of those tracks.

**The written tempo is playback's default; the transport's box overrides it**, preserving the
relative shape underneath, because "demonstrate this passage slowly" is the most useful thing a
demonstration does and Plan 0005 depends on it.

**Scoring reads none of it**, and may only annotate an observation it has already made: where the
report says the player slowed and the page asks for a rallentando there, the prose may say so. It
never creates an observation, never changes a verdict or a colour, and never reports the absence of
observance.

We rejected one undifferentiated `marks[]` array, because it makes each consumer re-derive what kind
of thing a mark is and lets one silently ignore them; we rejected resolving dynamics and tempo to
per-note numbers at extraction, because once *forte* is velocity 88 nothing can say the score asked
for forte; and we rejected judging expression, which would put `align.ts` on a clock and grade the
CK88's velocity curve rather than the playing.

Fingering stays out: OSMD draws it, and it changes neither what is played nor how it is judged.

## Architecture diagram

```mermaid
flowchart TB
    subgraph renderer["renderer - one parse, OSMD's reading"]
        OSMD["OSMD model"]
        ORN["voiceEntry.OrnamentContainer"]
        ART["voiceEntry.Articulations"]
        ME["StaffLinkedExpressions - one walk:<br/>pedal, dynamics, hairpins"]
        TE["TempoExpressions:<br/>tempo words, rit., accel."]
        EX["timelineFromOsmd.ts"]
    end

    subgraph shared["shared - what the page says"]
        SCHEMA["ExpectedTimeline<br/>notes[] +optional +ornament +articulation +fermata<br/>bars[] beats: nonnegative<br/>pedal[] dynamics[] tempo[]"]
    end

    subgraph core["core (pure)"]
        SCHED["scheduleFromTimeline<br/>the ONLY reader of the tracks:<br/>velocity, ms, CC 64, holds"]
        ALIGN["align.ts<br/>reads NO mark (ADR-0021)"]
        REPORT["report.ts<br/>may label an observation it already made"]
    end

    OSMD --> ORN
    OSMD --> ART
    OSMD --> ME
    OSMD --> TE
    ORN --> EX
    ART --> EX
    ME --> EX
    TE --> EX
    EX --> SCHEMA
    SCHEMA -->|"notes only"| ALIGN
    SCHEMA -->|"everything"| SCHED
    SCHEMA -.->|"tempo[], read-only, late"| REPORT
    ALIGN --> REPORT
    SCHED -->|player:play| SINK["main: Player -> MidiSink -> CK88"]
```

## Implementation phases

### Phase 1 — A score with a turn in it, and the bug on screen
- **Owner skill:** dev
- **What:** The missing fixture, and the failure made visible before anything is fixed: a score
  whose bar carries a `<turn>`, imported and drawn, whose timeline holds one note where the page
  says four.
- **Files touched:** `core/fixtures/scores/ornaments.musicxml`,
  `core/fixtures/scores/ornaments.timeline.json`, `e2e/score.spec.ts`
- **Notes for the implementer:** Hand-write the MusicXML rather than fetching one; it needs to be
  small and legible, in the shape of the existing fixtures. Put a `<trill-mark>`, a `<turn>` and a
  `<mordent>` in it, on separate principal notes, and an accidental under one of them
  (`<accidental-mark>`), because `OrnamentContainer.AccidentalBelow` is a property this plan will
  later have to honour and a fixture that never exercises it proves nothing. Keep the rest of the
  bar plain. Commit the timeline it produces **as it is today**, wrong: one note per ornament. That
  committed file is the before-picture, and Phase 3 is what changes it. The e2e case follows
  "each fixture score imports and draws" exactly.
- **Done when:** `ornaments.musicxml` imports and draws in the app like every other fixture, and
  the committed `ornaments.timeline.json` shows **one** expected note under each of the three
  ornament symbols — the defect, asserted, so that the next phases cannot claim a fix that is not
  one. `npm run gate` is green.

### Phase 2 — A bar may be empty
- **Owner skill:** dev
- **What:** A score with an attributes-only measure plays instead of being refused.
- **Files touched:** `shared/score.ts`, `core/src/score/timeline.ts`,
  `core/src/score/timeline.test.ts`, `core/fixtures/scores/empty-carrier-bar.musicxml`,
  `core/fixtures/scores/empty-carrier-bar.timeline.json`, `e2e/player.spec.ts`
- **Notes for the implementer:** `beats: z.number().positive()` becomes `z.number().nonnegative()`,
  and that is the whole schema change. Before relaxing it, **read every consumer of `beats` and
  confirm the claim this rests on**: they all use it additively as `onset + beats`
  (`core/src/midi/perturb.ts`, `core/src/player/schedule.ts`, three sites in
  `core/src/score/timeline.ts`) and alignment does not read it at all. If any site divides by it,
  stop and say so — that changes the design, not the implementation. `barTableProblems` gains a
  problem string naming a zero-length bar; it is a **report, not a refusal**, so the bar stays
  legal and stays indexed. `noteBarProblems` already does the right thing by construction: a note
  claiming a zero-length bar fails `note.onset >= bar.onset + bar.beats` and is flagged. The
  fixture is an attributes-only measure between two real ones, the minimal reproduction of BWV
  555's carrier bar.
- **Done when:** A timeline whose middle bar has `beats: 0` parses, and `barTableProblems` returns
  a string naming that bar while reporting no contiguity break. The bar table stays indexed with no
  index skipped across the empty bar. End to end: `empty-carrier-bar` imports and a bar range
  spanning the empty bar plays the notes on both sides of it, where today `player:play` is refused.
  `npm run gate` is green.

### Phase 3 — A turn is played, and costs nothing to play
- **Owner skill:** dev
- **What:** Ornaments expand at extraction into optional notes, so the demonstration plays them and
  the scorer charges nobody for them.
- **Files touched:** `shared/score.ts`, `renderer/score/timelineFromOsmd.ts`,
  `renderer/score/timelineFromOsmd.test.ts`, `core/src/score/timeline.ts`,
  `core/src/score/timeline.test.ts`, `core/src/align/onsetGroups.ts`,
  `core/src/align/onsetGroups.test.ts`, `core/src/align/report.test.ts`,
  `core/src/score/timelineFromMidi.ts`, `core/fixtures/scores/*.timeline.json`,
  `core/fixtures/playback/sampler.timeline.json`, `e2e/score.spec.ts`
- **Notes for the implementer:** Two changes, in this order. **First the rename**: `grace: boolean`
  becomes `optional: boolean`, and a sibling `ornament: OrnamentKind | null` is added, `null` for a
  written-out grace note. Regenerate all six committed timelines; the e2e case "the committed
  timelines still match what the app extracts" is what proves the regeneration was mechanical.
  `graceNotes` becomes `optionalNotes` and `scoredNotes` filters on `!note.optional` — the split
  itself does not move, and `onsetGroups` keeps attaching optional pitches to the group they
  decorate exactly as it does now (ADR-0009). **Then the expansion**: read
  `voiceEntry.OrnamentContainer`, and when it is present call OSMD's own
  `VoiceEntry.createVoiceEntriesForOrnament(entry, activeKey)` rather than realising the ornament
  yourself — ADR-0018 is explicit that the realisation belongs to the library that owns the parse.
  The active key is available from the measure's key instruction the extractor already walks. The
  principal note keeps `optional: false`; everything the expansion adds is `optional: true` with the
  kind set. `timelineFromMidi.ts` has no ornaments to read and only needs the field rename.
  **Do not touch `report.ts`**: if this works, it works because `scoredNotes` never saw the notes.
- **Done when:** For `ornaments.musicxml`, the timeline holds the realised pitches of the trill, the
  turn and the mordent, the principal notes are `optional: false` and every added note is
  `optional: true` with its `ornament` kind set. **The behavioural claim, asserted over the
  aligner:** a generated take that plays the turn out in full and a generated take that plays only
  the principal note both report that bar clean — no `extra`, no `missing` — which is the bug in
  `## Context & problem` stated as a test. The accidental under the mordent reaches the realised
  pitch, so `AccidentalBelow` is exercised rather than assumed. All six previously committed
  timelines differ **only** by the field rename. `npm run gate` is green.

### Phase 4 — The pedal goes down
- **Owner skill:** dev
- **What:** The timeline carries pedal marks and playback sends CC 64 from them.
- **Files touched:** `shared/score.ts`, `renderer/score/timelineFromOsmd.ts`,
  `renderer/score/timelineFromOsmd.test.ts`, `core/src/player/schedule.ts`,
  `core/src/player/schedule.test.ts`, `core/fixtures/scores/pedal.musicxml`,
  `core/fixtures/scores/pedal.timeline.json`, `e2e/player.spec.ts`
- **Notes for the implementer:** `pedal: PedalMark[]` on the timeline, each `{ at, down, staff }`
  with `at` in quarter notes like every other onset in the file. Read
  `SourceMeasure.StaffLinkedExpressions[][]`, take `PedalStart` and `PedalEnd` from each
  `MultiExpression`, and use its `AbsoluteTimestamp` through the same `quarters()` conversion the
  extractor already applies to notes and measures — do not invent a second conversion.
  `scheduleFromTimeline` emits `cc` events with controller 64, value 127 for a press and 0 for a
  lift, interleaved into the ordered event list by `at`. A bar range that starts under a held pedal
  **must press it at the range's start**, or a demonstration of bars 9 to 12 sounds dry where the
  piece is wet; work that out from the marks before the range rather than leaving it to chance. The
  panic path already lifts sustain on every channel it touched (ADR-0007) and needs no change —
  confirm that by test rather than by reading. Scoring must not learn about `pedal[]` at all.
- **Done when:** For `pedal.musicxml`, the timeline's `pedal[]` holds a down at the marked beat and
  an up at the release, and `scheduleFromTimeline` produces CC 64 events at the matching
  milliseconds, ordered correctly against the note-ons around them. A bar range beginning inside a
  pedalled span opens with a CC 64 press. Stopping mid-span still lifts sustain on every channel
  touched. End to end: playing `pedal.musicxml` produces the CC 64 events in the renderer's
  `player:event` stream. NFR 13's property is unchanged — nothing dropped, nothing reordered,
  nothing left sounding. `npm run gate` is green.

### Phase 5 — The music gets louder and softer
- **Owner skill:** dev
- **What:** Dynamics and hairpins reach the instrument. The end of velocity 72.
- **Files touched:** `shared/score.ts`, `renderer/score/timelineFromOsmd.ts`,
  `renderer/score/timelineFromOsmd.test.ts`, `core/src/player/schedule.ts`,
  `core/src/player/schedule.test.ts`, `core/fixtures/scores/dynamics.musicxml`,
  `core/fixtures/scores/dynamics.timeline.json`, `e2e/player.spec.ts`
- **Notes for the implementer:** `dynamics: DynamicMark[]` on the timeline, each
  `{ at, velocity, label, staff, until, endVelocity }` with the last two set only for a hairpin.
  Read them from the **same `MultiExpression` walk Phase 4 already wrote** for pedal —
  `InstantaneousDynamic` for a step, `StartingContinuousDynamic` / `EndingContinuousDynamic` for a
  hairpin — rather than a second traversal. **Take OSMD's `MidiVolume` and do not build a
  pp-to-velocity table**; ADR-0018 is explicit that the mapping belongs to the library. Resolution
  happens in `scheduleFromTimeline`, not in the extractor: a note takes the velocity in force at its
  onset, and inside a hairpin it interpolates linearly between the span's ends. `PLAYBACK_VELOCITY`
  (72) stops being the rule and becomes the fallback for a passage the page says nothing about —
  keep the constant, change its comment. A dynamic on one staff applies to that staff; a piece that
  marks only the left hand must not go quiet in the right.
- **Done when:** For `dynamics.musicxml`, the timeline's `dynamics[]` carries the step marks and the
  hairpin spans with their end dynamics, and `scheduleFromTimeline` gives **every note-on a velocity
  that follows the page**: a note under *ff* is louder than one under *pp*, and consecutive notes
  inside a written crescendo increase monotonically. A score with no dynamics at all produces every
  note at 72, unchanged from today. A dynamic on staff 1 does not alter staff 0's velocities.
  `npm run gate` is green.

### Phase 6 — The music breathes
- **Owner skill:** dev
- **What:** Tempo marks, rit. and accel., and the fermata — the phase that makes a demonstration
  phrase rather than march.
- **Files touched:** `shared/score.ts`, `shared/player.ts`, `renderer/score/timelineFromOsmd.ts`,
  `renderer/score/timelineFromOsmd.test.ts`, `core/src/player/schedule.ts`,
  `core/src/player/schedule.test.ts`, `renderer/components/Transport.tsx`,
  `renderer/views/Score.tsx`, `core/fixtures/scores/tempo-changes.musicxml`,
  `core/fixtures/scores/tempo-changes.timeline.json`, `e2e/player.spec.ts`
- **Notes for the implementer:** `tempo: TempoMark[]` read from `SourceMeasure.TempoExpressions`:
  `InstantaneousTempo` for a word or a metronome mark, `ContinuousTempo` for a ramp, each at its
  `AbsoluteTimestamp`. **Use `getInterpolatedTempo(timestamp)` for a ramp** rather than
  interpolating yourself. `ContinuousTempoType` has fifteen values and not all are a speed ramp —
  **`rubato` is a direction to a human, not a curve**. Read the subset that is unambiguously a ramp,
  ignore the rest, and record in the log which you read; a mark this plan ignores is better than one
  it guesses at.
  **The override is the delicate part and the done-when is written around it.** The written tempo is
  the default; when the player sets a bpm, theirs wins and **the relative shape is preserved**, so a
  rit. at the player's tempo is still a rit. Scale the whole written tempo curve by
  `chosen / writtenAtStart`; do not flatten it, and do not let the box mean "ignore the page". The
  transport shows the written tempo as the starting value so the player sees what the piece asks
  for. A **fermata** is `fermata: boolean` on `ExpectedNote`, read from `voiceEntry.Articulations`;
  `scheduleFromTimeline` lengthens that note and delays everything after it. Pick a hold factor,
  put it in a named constant with a comment, and expect Phase 9 to change it — it is a taste
  number and no test should pin it to a musical claim.
- **Done when:** For `tempo-changes.musicxml`, a marked tempo sets the default and the transport
  shows it; a written *ritardando* makes the gaps between consecutive note-ons **grow monotonically
  across its span** in the schedule, and an *accelerando* shrink them. Setting the bpm box to half
  the written tempo doubles every gap **and leaves the ritardando still reading as a ritardando** —
  the ratio between the span's first and last gap is preserved, which is the assertion that catches
  a flattened curve. A note under a fermata is held longer than the same note without one and
  everything after it shifts by the same amount. A score with no tempo marks behaves exactly as
  today. NFR 13's property is unchanged. `npm run gate` is green.

### Phase 7 — Short notes are short
- **Owner skill:** dev
- **What:** Articulation: staccato shortens, tenuto sustains, accent bites.
- **Files touched:** `shared/score.ts`, `renderer/score/timelineFromOsmd.ts`,
  `renderer/score/timelineFromOsmd.test.ts`, `core/src/player/schedule.ts`,
  `core/src/player/schedule.test.ts`, `core/fixtures/scores/articulation.musicxml`,
  `core/fixtures/scores/articulation.timeline.json`
- **Notes for the implementer:** `articulation: Articulation[]` on `ExpectedNote`, from
  `voiceEntry.Articulations`. `ArticulationEnum` has 28 values and most are irrelevant to a keyboard
  (`upbow`, `snappizzicato`); read the keyboard subset — roughly `staccato`, `staccatissimo`,
  `tenuto`, `accent`, `strongaccent`, `marcatoup`, `marcatodown`, `detachedlegato` — and drop the
  rest rather than modelling them. `scheduleFromTimeline` turns them into **duration and velocity
  changes only**: a staccato note's note-off comes earlier, an accent raises its velocity above
  whatever the dynamic gave it. **Every factor is a named constant with a comment**, for the same
  reason as the fermata's: these are taste, Phase 9 may move them, and no test should assert that a
  particular fraction is musically right. **Shortening must never reorder the event list** — a
  note-off that moves earlier still has to sit after its own note-on, including on a note already
  shorter than the staccato factor.
- **Done when:** For `articulation.musicxml`, a staccato note's sounding length in the schedule is
  shorter than the same written note without the mark, a tenuto note's is not shortened, and an
  accented note's velocity exceeds the dynamic in force around it. The schedule is still ordered and
  still balanced — every note-on matched by a later note-off, the invariant ADR-0007 asserts on
  every schedule the suite builds. A note shorter than the staccato factor still ends after it
  starts. `npm run gate` is green.

### Phase 8 — The report says where the score asked
- **Owner skill:** dev
- **What:** ADR-0021's annotation, and the test that proves the aligner did not learn anything.
- **Files touched:** `core/src/align/report.ts`, `core/src/align/report.test.ts`,
  `shared/score.ts`, `renderer/components/PracticeStats.tsx`, `e2e/practice.spec.ts`
- **Notes for the implementer:** Read ADR-0021 before writing a line; its three rules are the
  specification. The report already produces "You slowed 45% over bars 31 to 33" from the timing
  model. This phase adds **only a label**: if a `tempo[]` entry of a ramp kind overlaps that bar
  range, the sentence may say the score asks for it. **It annotates an existing observation and
  never creates one** — no observation, no sentence, even where a rit. is written.
  **It never changes a verdict, a count or a colour**; compute the bar's state first and do not
  revisit it. **It never reports absence** — "you did not slow where the score asks" is a judgement
  and is out of scope. `align.ts` is not touched **at all**, and that is the phase's real
  deliverable: if a diff to `core/src/align/align.ts` appears, the phase has gone wrong. Consider a
  mechanical guard — ADR-0021 suggests a lint or dependency rule stopping `core/src/align/` from
  importing whatever resolves marks — and if you add one, say so in the log.
- **Done when:** A take that slows where a *rit.* is written gets the annotated sentence; **the same
  take against the same score with the tempo track emptied gets the plain sentence and the identical
  verdict, counts and colours** — which is ADR-0021 stated as a test. A take that slows where
  *nothing* is written gets the plain sentence. A take that holds a steady tempo through a written
  rit. gets **no sentence about it at all**. **NFR 14 is re-asserted unchanged:** every existing
  tempo-free test in `core/src/align/report.test.ts` passes without edit, and a take played evenly
  at half speed against a score marked *Allegro* still reports zero bars in `timing`. `npm run gate`
  is green.

### Phase 9 — At the piano
- **Owner skill:** human
- **What:** Whether it sounds like music. Nothing in the eight phases above can answer that, and
  most of their constants are guesses waiting for this phase.
- **Files touched:** the plan's implementation log
- **Done when:** all of the following are recorded in the log:
  1. **The discriminating pedal run, which Plan 0004 Phase 7 owed and did not do.** Play a score
     **with your foot off the pedal**, before and after this plan. Before: does it sustain? That
     answers whether the sustain heard on 2026-09-11 was the app or the player's own foot, and it
     has been carried as unexplained for a plan.
  2. A score with pedal marks plays with them, foot off the pedal, and sounds right — wet where the
     page says wet, dry where it says dry.
  3. **The ornament, judged as music.** OSMD picks one realisation — how many notes a trill gets,
     whether a turn starts on the note or above. Good enough to demonstrate from, or misleading? A
     "no" for a specific kind is a finding, and ADR-0018's named response is to stop expanding
     **that kind**, never to write our own realiser.
  4. Play the ornamented bar yourself, once realising the ornament and once plainly, and confirm the
     bar reads clean both ways — the Phase 3 assertion, felt rather than generated.
  5. **The dynamics, judged.** Does a marked piece sound shaped, or does it lurch? OSMD's
     `MidiVolume` mapping is inherited and may be too wide or too narrow on this instrument. A
     range that is wrong is a finding with a number attached, not a re-design.
  6. **The tempo, judged — the most likely to be wrong.** Does a written rit. sound like a
     rit. or like a stumble? Does the override still feel like the same piece slower? Play a
     passage at half the written tempo and say whether the shape survived.
  7. **The fermata and the staccato constants.** Both are taste numbers chosen blind in Phases 6
     and 7. Say whether they are close, and in which direction if not.
  8. **The whole point, in one judgement.** Put a piece with real expression on the stand, press
     Play, and say whether it sounds like music being played or like a file being read aloud. That
     is the sentence this plan exists to earn, and a "not yet" with a reason is worth more than
     seven green checks above it.

## Data shapes

```ts
// illustrative — the Zod schemas in shared/score.ts are what is real

type OrnamentKind =
  | 'trill' | 'turn' | 'invertedTurn' | 'delayedTurn'
  | 'delayedInvertedTurn' | 'mordent' | 'invertedMordent'

/** The keyboard-relevant subset of OSMD's 28-value ArticulationEnum. The rest
 *  (upbow, snappizzicato, ...) is dropped rather than modelled. */
type Articulation =
  | 'staccato' | 'staccatissimo' | 'tenuto' | 'accent'
  | 'strongaccent' | 'marcatoUp' | 'marcatoDown' | 'detachedLegato'

type ExpectedNote = {
  midi: number
  onset: number
  duration: number
  bar: number
  staff: number
  voice: number
  tied: boolean
  /** Scored neither way (ADR-0009). Was `grace`; now also every note an
   *  ornament expanded into. */
  optional: boolean
  /** Which symbol produced this note, or null for a written-out grace note
   *  and for every ordinary note. */
  ornament: OrnamentKind | null
  /** Marks that belong to this notehead and to nothing else. Playback reads
   *  them; scoring does not (ADR-0021). */
  articulation: Articulation[]
  fermata: boolean
}

// --- the three tracks. Each holds WHAT THE PAGE SAYS, never a resolved
// --- number: scheduleFromTimeline is the only thing that turns them into
// --- velocities and milliseconds (ADR-0018), and align.ts never reads one.

/** A sustain change at a point in the score. Not a property of a note: a press
 *  happens between notes and over rests, and the lift — the half that decides
 *  whether a chord blurs into the next — belongs to no note at all. */
type PedalMark = { at: number; down: boolean; staff: number }

/** `until` and `endVelocity` are set for a hairpin and null for a step mark.
 *  `velocity` is OSMD's own MidiVolume, not a table of ours. */
type DynamicMark = {
  at: number
  velocity: number
  label: string          // 'ff', 'mp' — for prose, never parsed back
  staff: number
  until: number | null
  endVelocity: number | null
}

/** A word, a metronome mark, or a ramp. `until`/`endBpm` are set for a ramp.
 *  `label` is what the page printed, which is what Phase 8 quotes. */
type TempoMark = {
  at: number
  bpm: number
  kind: 'word' | 'metronome' | 'ramp'
  label: string          // 'Allegro', 'rit.'
  until: number | null
  endBpm: number | null
}

type ExpectedTimeline = {
  scoreId: string
  notes: ExpectedNote[]
  /** `beats` may now be 0: an attributes-only measure is a real bar with no
   *  length, and it keeps its index. */
  bars: ExpectedBar[]
  pedal: PedalMark[]
  dynamics: DynamicMark[]
  tempo: TempoMark[]
}
```

## Risks & open questions

- **This plan's real risk is that it makes the app play the wrong thing rather than crash.**
  `scheduleFromTimeline` goes from arithmetic over onsets to the place that decides how a piece
  sounds. A velocity or a tempo bug is silent to every gate and audible to a human, which is why
  Phase 9 has eight items and why the taste constants are named and commented rather than inlined.
- **Tempo-freedom is the thing that could be lost here**, and losing it would be quiet. Phase 8's
  done-when is written as the guard — the same take against the same score with the tempo track
  emptied must produce identical verdicts, counts and colours — and ADR-0021 suggests a mechanical
  import rule as well. A reviewer should read `git diff core/src/align/` first and expect nothing.
- **The tempo override is the subtlest arithmetic in the plan.** Scaling a written rit. by the
  player's chosen tempo has an obvious wrong implementation (flatten the curve, apply the box) that
  passes a naive test. Phase 6's done-when asserts the **ratio** between the span's first and last
  gap is preserved, which is what catches it.
- **OSMD's interpretation may be musically wrong**, for an ornament's realisation, for
  `MidiVolume`'s range, or for `getInterpolatedTempo`'s curve. Inherited by decision (ADR-0018).
  Phase 9 items 3, 5 and 6 are the checks, and the response is to stop reading that mark rather
  than to start second-guessing the library.
- **`createVoiceEntriesForOrnament` may behave differently than its signature suggests** — it is an
  instance method on `VoiceEntry` in OSMD 2.1.2's typings and its use inside OSMD is for playback,
  not for our extraction path. If it throws, returns empty, or needs state the extractor does not
  have, **Phase 3 stops and says so**: the fallback is to mark the principal note's group as
  accepting surplus without expanding, which fixes the scoring bug and not the demonstration, and
  that is a design change for the architect rather than an improvisation.
- **`ContinuousTempoType` has fifteen values and not all are ramps.** `rubato` in particular is a
  direction to a human. Phase 6 reads a subset and records which; a mark ignored is better than one
  guessed at.
- **The field rename collides with Plan 0009 if both are in flight.** That plan is parked and works
  in `core/src/align/`, which reads `scoredNotes` rather than the field; the collision is one
  identifier, not a design conflict. Whichever lands second rebases over the rename. **Do not run
  these two in parallel worktrees** without agreeing that first.
- **The practice path still validates nothing.** This plan fixes the defect that asymmetry hid; it
  does not fix the asymmetry. A timeline built in the renderer for practice is still unchecked, so
  the next extractor bug will again surface on one path out of two. A followup, because parsing on
  the practice path costs NFR 12 turnaround and wants its own measurement.
- **Fixture churn hides regressions if it is not mechanical.** Six committed timelines change in
  Phase 3 and gain fields in Phases 5 to 7. The e2e case that pins them is the guard, and Phase 3's
  done-when says its diff must be *only* the rename — a timeline whose onsets moved during a rename
  is a bug, not a regeneration.
- **This is nine phases, which is long for one plan.** It is one plan by decision, because every
  phase amends the same schema and a second pass would mean a second fixture migration and a second
  e2e timeline-pinning update. The natural stopping point if it has to be split is **after Phase 4**:
  the two live defects and pedal are fixed, and Phases 5 to 9 are the expressive layer.
- **Offline and latency are untouched.** No new dependency (NFR 9), no network, nothing added to
  the MIDI-in path. NFR 12, 13 and 14 are re-reported from the gate run.

## What this plan does NOT do

- **It does not judge expression.** No verdict, count or colour changes because of a dynamic, a
  tempo mark or an articulation. ADR-0021 Alternative A is the plan that would, and it needs its own
  interview — starting with whether *relative* dynamics within a phrase can be judged where absolute
  ones cannot, because a MIDI velocity is the CK88's curve and not the composer's intent.
- **It does not describe dynamics**, only play them. Annotation is tempo-only, because tempo is
  where an observation the report already makes coincides with something the page already says.
- **It never reports the absence of observance.** "You did not slow where the score asks" is a
  judgement wearing a description's clothes.
- **No fingering.** OSMD draws it; it changes neither what is played nor how it is judged, and it
  enters the data the day the coach comments on it.
- **No slurs or phrase marks.** They are neither a note property nor a simple span with a number
  attached, and phrasing a legato line is a synthesis problem, not an extraction one.
- **No validation on the practice path.** See the risk above.
- **Nothing about how any of this is drawn.** Plan 0007 owns glyphs, and ADR-0018 records the one
  obligation this plan hands it: an expanded ornament note has no notehead of its own.

## Implementation log

> Written by `dev`, one row per phase as that phase's commit lands, and the close block after the
> last one. **The phases above are the contract; everything here is what happened.**
> Observations, never conclusions. A deviation from the plan or an unmet done-when is always
> disclosed. Stays shorter than `## Implementation phases`.

**Lane:** `main` directly. Plan 0009 is parked, so the `grace`/`optional` collision its risk
section names cannot happen.

| phase | owner | state | commit |
|---|---|---|---|
| 1 — A score with a turn in it, and the bug on screen | dev | done | 3788e72 |
| 2 — A bar may be empty | dev | done | committed with this row |
| 3 — A turn is played, and costs nothing to play | dev | not started | |
| 4 — The pedal goes down | dev | not started | |
| 5 — The music gets louder and softer | dev | not started | |
| 6 — The music breathes | dev | not started | |
| 7 — Short notes are short | dev | not started | |
| 8 — The report says where the score asked | dev | not started | |
| 9 — At the piano | human | not started | |

### Measurements

_(NFR 12, 13 and 14 re-reported from the gate run; no new row is claimed. Note which
`ContinuousTempoType` values Phase 6 reads, and the taste constants Phases 6 and 7 chose.)_

### Notes

- **Phase 3's done-when cannot be met as written, and the user ruled on it before Phase 1 was
  cut.** Read in OSMD 2.1.2's bundled source: `createVoiceEntriesForOrnament` consults
  `AccidentalAbove`, and only in the `Trill` branch; `AccidentalBelow` occurs in exactly two
  places, the XML reader that sets it and the VexFlow path that draws it. `Turn` and `Mordent`
  take their alteration from `activeKey.getAlterationForPitch` and read neither. So "the
  accidental under the mordent reaches the realised pitch" is not reachable. Decision taken at
  Phase 1: the fixture carries **both** accidentals, an above on the trill and a below on the
  mordent, and Phase 3 asserts which of the two reaches the sounding pitch. ADR-0018's phrase
  "the ornament's own accidentals applied" is true for a trill's upper note only.
- **Phase 1 touched a file outside its list**, with approval asked and given before the edit:
  `renderer/score/timelineFromOsmd.test.ts` globs every fixture `.musicxml` and asserts a
  hard-coded list of names, so a sixth fixture fails `npm test` — which Phase 1's own done-when
  requires green. One string added to that sorted list, nothing else in the file. The file is in
  Phase 3's list. `core/src/score/timeline.test.ts` needed no change: it imports fixtures by
  explicit name rather than by glob.
- An XML comment may not contain `--`; the first draft of `ornaments.musicxml` had two, and OSMD
  reported it as "not a valid partwise MusicXML" rather than as a comment error.
- **Phase 2's `beats` check, run before the schema was relaxed, as the phase asked.** Seven read
  sites, all additive as `onset + beats`: `core/src/midi/perturb.ts:284` and `:301`,
  `core/src/player/schedule.ts:249`, `core/src/score/timeline.ts:65`, `:85` and `:100`, and
  `:127` which only rounds it through. Nothing divides by it. `core/src/align/` does not contain
  the identifier. `core/src/score/timelineFromMidi.ts:89` writes the field and guards its source
  `> 0` at `:63`, so the MIDI adapter cannot produce a zero-length bar.
- **Phase 2 touched the same two files outside its list as Phase 1**, for the same reason and on
  the same approval: adding a seventh fixture needs its name in `e2e/score.spec.ts`'s
  `FIXTURE_SCORES` (so the committed timeline is regenerated and pinned) and in
  `renderer/score/timelineFromOsmd.test.ts`'s glob assertion. `e2e/score.spec.ts` is in Phase 1's
  list, not Phase 2's.
- The Phase 2 end-to-end test was **run against the unrelaxed schema to confirm it bites**: with
  `beats: z.number().positive()` restored, the transport never leaves `idle` because `player:play`
  is refused on receive. That is the BWV 555 failure, reproduced and then fixed.

### Close triggers

- **What shipped:** _(feature / fix-only / docs-chore-only)_
- **User-visible docs touched:** _
- **Full gate at the last phase:** _
- **Outstanding `human` phases:** _

## Followups (after this lands)

- **Judging expression**, as its own plan and interview. ADR-0021's Alternative A names what it
  would have to reopen; Plan 0001 Phase 7's measured velocity range is where it should start.
- **Describing dynamics**, if Phase 9 item 5 suggests the player wants to be told about them. It
  needs an observation for the annotation to attach to, which today does not exist.
- **Validate the timeline on the practice path too**, or decide deliberately that it stays unchecked
  there. The asymmetry that hid the zero-beats bug is still present.
- **A trill's realisation as a setting**, if Phase 9 item 3 finds OSMD's choice misleading for one
  kind rather than all of them.
- **The taste constants as settings**, if Phase 9 item 7 finds the fermata hold or the staccato
  factor wrong in a way that is a matter of preference rather than of correctness.
- **Slurs and phrasing**, which this plan cut and which is the largest remaining expressive gap.
- **Over-pedalling as an observation.** The timeline now knows where the pedal should lift; a take
  knows where it did. Nothing compares them, and the coach would have something to say if it could.
