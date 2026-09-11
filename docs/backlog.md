# Backlog

Ideas that have been thought about but not drafted. A row here is **not** committed work: it is a
thought worth not re-having, with enough of its reasoning attached that picking it up later does
not mean re-deriving why it was interesting.

Three places hold future work, and they do not overlap:

| Where | What lives there |
|-------|------------------|
| [`plans/README.md`](plans/README.md) `## Roadmap` | initiatives, in dependency order, each destined to become a plan |
| A plan's `## Followups` | debts a specific plan knowingly left behind |
| This file | everything else — mechanics, drills, ideas with no plan yet |

A row graduates out of here by being named in a roadmap item or written into a plan. Delete it
here when it does; a backlog that also duplicates the roadmap is worse than no backlog.

---

## Teaching mechanics

Raised in the pedagogy interview of **2026-09-10**. The goal the user stated: play both simple
classics and jazz/blues, and have the app teach the way the evidence says the skills are built.
Most of it lands in roadmap items 7 and 8. Two rows have since graduated into plans and are
gone from this file: the deliberate-practice loop is Plan [0005](plans/0005-the-practice-loop.md),
and the metronome is Plan [0006](plans/0006-the-metronome-and-the-score-follows.md).

### Decisions taken in that interview

Four calls, made before any of it is planned, so the mechanics below have a fixed frame:

1. **Jazz and blues get a second expectation shape**, not note-exact scoring of transcriptions.
   Per bar: a chord symbol, its guide tones, an admissible pitch-class set; scored on membership,
   function and the timing of the change. Rejected: keeping one expectation shape and practising
   jazz from written-out transcriptions, which teaches reproducing a transcription rather than
   playing the changes. **ADR territory when it is drafted** — the rejected alternative is named
   and real.
2. **Toolbox first, scheduler later.** The player picks what they practise. The store is shaped
   as a scheduler from the first day it exists — due dates, interleaving, a "seen" ledger — but
   nothing schedules yet. Rejected: opening the app on a due queue (only works if submitted to,
   and a skipped queue is worse than none) and a pure history log (then spaced repetition never
   arrives, and retrofitting a scheduler onto a log is the expensive path).
3. **The practice loop is drafted first**, ahead of any new drill type. Done: Plan
   [0005](plans/0005-the-practice-loop.md).
4. **Material is hybrid.** Generated drills for the volume sight reading needs; imported MusicXML
   for real music. Neither alone does the job: a corpus is finite and sight reading exhausts it,
   and generated material does not sound like the classics the user wants to play.

### Sight reading

The strongest finding in the literature is volume, and it is the one a human teacher cannot
supply — they run out of books. A seeded generator does not.

- **Never-repeated material, well below playing level.** Needs a **"seen" ledger** in the store,
  the exact inverse of the spaced-repetition table beside it.
- **No-look mode.** Hide the on-screen keyboard for the duration of a read and score it
  separately. The app is the only thing in the room that can tell whether the player looked down,
  because it sees the notes while their eyes are on the staff. Nearly free — a view flag.
- **The look-ahead curtain.** Hide the notes currently under the hands, leaving the next bar
  visible. Deliberately uncomfortable; it is the fastest builder of the eye-ahead habit. Needs a
  cursor driven by wall-clock rather than by what was played, which Plan
  [0006](plans/0006-the-metronome-and-the-score-follows.md) Phase 3 builds; unblocked the day that
  lands.
- **Continuity weighted above accuracy.** A stop is a worse sight-reading fault than a wrong note.
  `analyse` today knows missing notes and late notes; sight reading wants a third derived metric,
  **hesitation** — a gap in the onset stream where the grid says notes were due — weighted heavier
  than pitch error. An addition on top of `align`, not a second alignment.
- **Interval and contour drills.** Reading by interval rather than by note name is the skill that
  transfers; a two-note drill trains it directly.
- **The pre-play scan.** Thirty seconds on key, metre, hand position and repeated patterns before
  the first note. Cheap as a prompt; unproven as a feature anyone actually uses.

### Rhythm

- **The metronome whose click thins out.** Every beat, then 2 and 4 only, then bar 1 only, then
  silence — comparing tempo drift across the four stages. It is a mask over Plan
  [0006](plans/0006-the-metronome-and-the-score-follows.md)'s `BeatGrid` and needs no further
  decision; what it waits on is somewhere to record drift across the four stages, which is roadmap
  item 7's store. `tempo.ts` already fits the drift.
- **Rhythm-only pass.** Play the piece's rhythm on one note. Decouples the two hard things, and it
  scores against the existing timeline with pitch ignored — a flag on `align`.
- **The tempo ladder.** Raise the target by a fixed step only after a clean pass at the current
  one. This is where the store stops being a log and becomes a mechanism. After Plan 0006 it is
  the grid plus the store and nothing else — a new grid is a value, not a mechanism.

### Harmony

For classical this rides the existing rails — `romanNumeral` already names function, so a
progression drill scores against a generated timeline exactly like a piece does.

- **Progression drills through the cycle of fourths**: ii-V-I and the blues turnaround in all
  twelve keys. Transposition is one integer in the generator and is the central jazz discipline.
- **Voice-leading drills**: the same progression in different inversions, scored on smooth motion
  rather than on a fixed voicing.
- **Guide tones, shell and rootless voicings.** The natural first content for the harmonic
  expectation shape: the 3rd and the 7th are what must sound; the rest is admissible.
- **Cadence and function recognition** from what was played, using `detectChords` plus the key
  estimate that already exists.

### The engine underneath

Worth more than any individual drill:

- **Spaced repetition over musical items** — a bar, a voicing, a key, a rhythm figure — each with
  a due date set by how the last attempt went, and **interleaved rather than blocked**.
  Interleaving tests worse within the session and better a week later; the effect is well
  replicated, and it is the reason the store is shaped as a scheduler under decision 2 above. Plan
  0005 drains its queue worst-first and lists interleaving as a followup, so this is the evidence
  that followup waits on.
- **Session shape.** Short and daily beats long and occasional. Nothing in the architecture cares,
  but any progression gate should be built against sessions rather than against minutes.

---

## Open architectural questions these raise

Each becomes an ADR when the plan that needs it is drafted. None should be answered early.

- **A grid estimated from the take**, which is a different question from the grid Plan
  [0006](plans/0006-the-metronome-and-the-score-follows.md) *gives* the player. That plan answers
  the case where the player accepts a beat we supply. It does not answer rubato ([Plan
  0002](plans/done/0002-a-piece-is-practised.md) Phase 7 item 4, and its piecewise-tempo-fit followup)
  or swing, where the beat has to be inferred from what was played and scored for consistency
  against itself instead of against a single fitted tempo. Both remain open, they are the same
  problem, and this is why jazz sits behind the drill work in the roadmap rather than beside it —
  a swing-ratio parameter would fix only one of the two.
- **What the generator emits.** MusicXML (heavy, but engraved, which sight reading needs) or an
  `ExpectedTimeline` directly (light, but nothing to draw). Reopened by
  [ADR-0005](adrs/0005-the-expected-note-timeline-is-extracted-from-osmds-model.md); the answer
  depends on how Plan 0002's adapter actually feels in use.
- **SQLite, the first store that is not JSON Lines.** Its own ADR, and under decision 2 its schema
  question is "what does a scheduler need" rather than "what does a history need".
- **The second expectation shape.** Whether `ExpectedTimeline` and the harmonic expectation sit
  behind a common interface or stay two types the alignment branches on. Worth deciding only with
  one note-exact plan closed to contrast against.

---

## Not from the pedagogy interview

Longer-standing ideas carried over from the roadmap's tail, and later additions. Each needs its
own interview:

- **Score following**, so the app can accompany the player rather than only demonstrate to them.
  Cut from [Plan 0004](plans/done/0004-the-app-plays-the-piece.md) deliberately.
- **A Bluetooth or DIN adapter as a second `MidiSource`.** The CK88's own Bluetooth is audio only;
  this needs external hardware on the DIN ports.
- **MIDI-to-notation transcription** —
  [ADR-0003](adrs/0003-two-notation-engines-vexflow-for-the-live-staff-and-osmd-for-the-score.md)
  Alternative C.
- **A tablet port of the renderer.**
- **The marks on the page — what Plan 0010 still leaves.** Raised by the user on 2026-09-11 with a
  bar showing a turn, a fingering, a slur, an accidental under the ornament and a hairpin: the app
  should read the signs that influence playing "for correct reference". **Almost all of it
  graduated** on 2026-09-11 into Plan
  [0010](plans/0010-the-timeline-tells-the-truth-about-the-page.md) and
  [ADR-0018](adrs/0018-the-timeline-carries-the-marks-on-the-page.md) — ornaments, pedal, dynamics,
  hairpins, tempo words, rit./accel., fermata and articulation, with
  [ADR-0021](adrs/0021-expression-belongs-to-playback-scoring-only-describes-it.md) keeping all of
  it away from the aligner. Two things did not:
  - **Slurs and phrase marks**, cut from Plan 0010 deliberately. They are neither a property of one
    note nor a span with a number attached, and playing a legato line convincingly is a synthesis
    problem rather than an extraction one — note overlap, release shaping, and a judgement about
    where a phrase breathes. The largest remaining expressive gap, and the one that needs a real
    idea rather than another OSMD property.
  - **Fingering is the one that needs nothing.** OSMD already draws it — it is visible in the
    user's own screenshot — and it changes neither what is played nor how it is judged. It would
    only need to enter the data if the coach were ever to comment on it.
  - **Judging expression** is the other direction, and it is ADR-0021's Alternative A rather than a
    missing extraction: whether the app should say you played *mezzo-piano* where the page says
    *forte*. Its own interview, and it starts with the fact that a MIDI velocity is the CK88's
    curve and not the composer's intent.
