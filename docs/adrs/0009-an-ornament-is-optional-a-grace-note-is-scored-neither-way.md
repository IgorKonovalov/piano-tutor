# ADR-0009 — An ornament is optional: a grace note is scored neither way

> **Status:** proposed
> **Date:** 2026-09-10
> **Related plan(s):** raised by the close review of Plan
> [0002](../plans/0002-a-piece-is-practised.md); implemented as a scoped change outside a plan,
> before that plan's `human` phase runs

## Context

Plan 0002 deferred grace notes in one line: they are "marked and excluded from alignment scoring
in this plan (a followup)". The extraction honours it — `renderer/score/timelineFromOsmd.ts` sets
`grace` from OSMD's `IsGrace`, and `core/src/score/timeline.ts`'s `scoredNotes` filters those
notes out, so an ornament never becomes an expected group.

**Excluding a note from the expected side does not exclude it from the played side.** The player
still strikes the key. That note-on matches nothing, so `core/src/align/report.ts` charges it as
an `extra`, and `stateFor` turns the bar `wrong`. The deferral was written as "ornaments are not
judged"; what shipped is "playing an ornament is a mistake". Nobody noticed because none of the
four fixture scores contains a grace note — `grep grace core/fixtures/scores/*.musicxml` returns
zero — so the entire path is exercised by nothing in a suite of 481 tests.

The repertoire Phase 7 exists to try is exactly the repertoire that has ornaments. Ten
public-domain pieces were imported at that phase, Clair de lune among them. Phase 7 item 2 asks
the player whether the coloured bars match their own sense of where they fumbled; asked against a
build that reddens every appoggiatura, the answer is about this defect and nothing else.

So the deferral has to be given a shape before the piano session, and there are three honest
shapes it could take. The choice is a real one because it decides what the app is claiming to
teach: the notes, or the page.

## Decision

An expected group carries its attached grace pitches as **optional pitches**, distinct from the
pitches it is scored on. An optional pitch costs nothing when the player strikes it and nothing
when they do not: it is removed from the played set before the pitch difference is taken, and it
produces no verdict of any kind — not `correct`, not `missing`, not `extra`. A bar whose only
divergence from the score is an ornament played or an ornament skipped is `clean`.

A grace note attaches to the expected group at its own onset. If there is no group at that onset
— OSMD may place a grace note in a staff entry slightly ahead of its principal — it attaches to
the first group at or after it. It never attaches backwards, because an ornament anticipates the
note it decorates and never trails the previous one.

This is the rule for as long as the app is teaching a player the notes of a piece. When exercises
or a later plan want ornaments judged, that is a new ADR superseding this one, not a threshold
tuned here.

## Consequences

### Positive
- Practising a piece you are still learning stops being punished for simplifying an ornament,
  which is what every teacher tells a student to do first.
- Real repertoire becomes scoreable at all. Ornamented piano music is most piano music; without
  this the per-bar report is noise on anything past a study.
- Phase 7 items 2 and 6 become answerable questions about the aligner rather than about this bug.
- The change is confined to `core/`: `ExpectedGroup` gains a field, `pitchDifference` gains a
  pre-filter, and `report.ts` skips the pitches that filter removed. No boundary, no schema on
  disk, and no IPC payload moves.

### Negative
- **A wrong note that happens to land on an optional pitch is silently forgiven.** Play the grace
  note where the principal note belongs and the app says nothing. The cost is bounded — an
  ornament is a semitone or a step from what it decorates, so the forgiven interval is small —
  but it is a real blind spot and it is the price of the rule.
- **The report can no longer be read as a complete account of what was struck.** Some note-ons in
  the take appear in no verdict at all. The `TakeSummary` Plan 0003 sends inherits that, and the
  coach will not know an ornament was played or skipped.
- A player who deliberately wants their ornaments assessed cannot get that from this version, and
  the app does not tell them so.
- `ExpectedTimeline` already carries `grace` on every note, so the timeline fixtures do not
  change; but the grouping in `onsetGroups.ts` now reads a field it previously filtered on, which
  means the fixture corpus has to gain an ornamented score before the rule is believed.

### Neutral
- The optional pitches are derived at grouping time from the timeline, not stored. Nothing
  committed changes shape, and no fixture regenerates.

## Alternatives considered

### Alternative A — An ornament is a note: put grace notes in the expected timeline and score them
The honest-to-the-page reading, and the one a published edition would defend: it is written, so
play it. Rejected because it inverts the error rather than removing it. Today the app reports an
ornament you played; this would report an ornament you skipped, and skipping ornaments is the
first thing anyone does while learning the notes. It would also make the per-bar report worse
precisely on the repertoire the feature exists for, and it presumes an answer to "should this
app assess ornamentation" that nothing has yet earned.

### Alternative B — Exclude any bar containing a grace note from scoring
Cheapest to build and impossible to get wrong: mark the bar neutral and judge nothing in it.
Rejected because on ornamented repertoire it stops judging large stretches of the piece without
saying why, and the player cannot tell a bar they played cleanly from a bar the app declined to
look at. A feature whose whole value is per-bar feedback cannot answer "how did that go" with
silence over a third of the page.

### Alternative C — Match ornaments by a time window on the played side
Drop any played note-on that falls within some milliseconds of a matched group and has a grace
note attached there. Rejected because it reads a clock inside the matcher, which is the one thing
`core/src/align/align.ts` is built not to do (its own header: "Nothing in this file reads a
clock"). A tempo-free matcher that consults milliseconds for one case is no longer tempo-free,
and the property every test in `core/src/align/` defends would be defended by nothing.

## Notes

The close review of Plan 0002 raised this alongside two other findings. The report-size property
(extras are unbounded, so a report is not in fact sized by bars) is carried as a followup on that
plan and is Plan 0003's to close, since NFR 7 is what depends on it. The stale-take selection in
`renderer/views/Score.tsx` is a fix with no decision in it and needs no record here.

Believing this rule requires a fixture that has an ornament in it. A fifth hand-written score
beside the existing four is the cheapest place to put one, and it wants a grace note both played
and skipped in the same test.
