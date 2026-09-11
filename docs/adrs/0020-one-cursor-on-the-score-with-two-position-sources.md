# ADR-0020 — One cursor on the score, with two position sources

> **Status:** proposed
> **Date:** 2026-09-11
> **Related plan(s):** Plan [0013](../plans/0013-the-travelling-line.md), and an amendment owed to
> Plan [0006](../plans/0006-the-metronome-and-the-score-follows.md) Phase 3

## Context

Two drafted pieces of work want to show the player where they are on the drawn score, and they
arrived from different directions.

**Plan 0006 Phase 3 — the score follows the click.** With a metronome grid running, the bar the
click is in is highlighted, whether or not anyone is playing. As drafted it is a *bar highlight*
that reuses Plan 0002's existing `bar-mark` overlay — the box OSMD drew for that bar — driven from
the grid on `requestAnimationFrame`. Its done-when is about landing on the correct bar across a
metre change, not about smoothness.

**The travelling line**, raised by the user on 2026-09-11 on seeing playback work: a line that
moves *through* the bar and says exactly which notes are sounding at this instant. Plan 0004
highlights the bar; this is the finer thing.

They look like one feature and are not the same size. The backlog recorded the difference
honestly: "that cursor is bar-level and driven by the click, this one is note-level and driven by
the schedule", and left the question of whether they are one mechanism or two as the first thing
an interview should settle.

Three facts decide it.

**During playback the position is already exact.** A `PlaybackSchedule` holds every event's `at` in
milliseconds and `player:state` carries `positionMs` and the sounding `bar`. Nothing has to be
inferred. That is the whole difference from *score following*, which is a separate backlog item
where position must be recovered from what the player is doing.

**What is missing is a coordinate, not a time.** Turning a musical position into an `x` on OSMD's
engraving is the `sourceNote`-to-SVG mapping that Plan 0007 Phase 1 exists to resolve — it builds
`renderer/score/noteBoxes.ts`, a draw-time index from expected note to drawn notehead, and its
riskiest fact is settled there. Both cursors want that index; only one of them wants it at note
resolution.

**The hard part is neither the time nor the note; it is the page.** A line has to jump to the next
system and down the staves OSMD drew, at the right moment, in a layout that reflows on resize and
zoom. That is more than advancing one `x`, it is the part most likely to be got subtly wrong, and
it is identical whichever source is driving.

There is also a constraint on how the position arrives. `player:state` is pushed about ten times a
second **deliberately** (`STATE_INTERVAL_MS`); the per-event traffic is `player:event`, which the
recorder never sees. Making `player:state` a hot channel to feed a smooth line would undo a
deliberate choice and put renderer paint cost on a path NFR 11 measures.

## Decision

**There is one cursor on the score, and it takes a position rather than a source.** A single
renderer component owns the three things that are the same either way: resolving a musical position
to a coordinate on OSMD's engraving, drawing the marker, and handling the system and stave breaks
as the layout reflows. It is driven by whoever has a position to give it.

Two sources exist and neither knows about the other. **Playback** drives it from `player:state`,
interpolating between the ten-per-second pushes on `requestAnimationFrame` — the channel stays at
its present cadence and the smoothness is the renderer's arithmetic, not more traffic. **The
metronome grid** drives it from the beat, which is where Plan 0006 Phase 3's follow mode already
gets its position.

**Resolution is a property of the position, not of the cursor.** A position carries bar plus a
fraction through it; a source that only knows the bar supplies a fraction of zero and gets a marker
on the barline, which is exactly the bar-level behaviour Plan 0006 drafted. Nothing has to be
configured for the two to coexist.

**The travelling-line plan builds it, and Plan 0006 Phase 3 is amended to consume it** rather than
to add a second way to mark a position — which is what that phase's own notes already forbid ("do
not add a second way to mark a bar"). The harder requirement builds the shared thing, which is the
right way round. If Plan 0006 runs first, its Phase 3 ships the bar box as drafted and the
travelling-line plan absorbs it; that ordering is worse but not wrong, and the amendment says so.

We rejected two independent cursors, and we rejected building a shared component before either
consumer's requirements were real.

## Consequences

### Positive

- **The system-break work happens once**, by the plan whose requirement is strict enough to get it
  right. A bar-level box that jumps a system is forgiving; a line at note resolution is not.
- **Plan 0006 Phase 3 gets cheaper and better.** It stops owning a highlight path and gains, for
  free, the option of a marker that moves within the bar rather than snapping at the barline.
- **`player:state` keeps its cadence.** The smooth line is interpolation in the renderer, so
  nothing on the hot path changes and NFR 11's figures are not put at risk by a feature that only
  draws.
- **A third source costs nothing.** Score following, if it ever arrives, is another position
  producer and no new drawing code.

### Negative

- **It couples two plans that were independent**, and the coupling runs backwards through the
  roadmap: Plan 0006 is drafted and sits earlier in the order than the plan that now owns its
  cursor. The amendment is owed to a drafted plan, and if the order changes the amendment has to be
  reconsidered rather than silently applied.
- **The component serves two resolutions**, which is a real interface risk: a bar-level source that
  supplies a fraction of zero is a slightly dishonest position, and someone will eventually want
  "the whole bar" to mean a band rather than a line at its left edge. The honest fix then is a
  second marker *style*, not a second cursor, and that is a change to this component.
- **It depends on Plan 0007 Phase 1**, which resolves the `sourceNote` identity question. If that
  identity does not hold and the index has to be keyed on `(bar, staff, voice, onset, midi)`
  instead, the cursor still works but the lookup is coarser and a chord's notes become
  indistinguishable — acceptable for a cursor, and named here so it is not a surprise.
- **Nothing is shared until it is built.** Until the travelling-line plan lands, Plan 0006 Phase 3
  has an amendment pointing at a component that does not exist, which is a stale pointer if the
  plan is never picked up.

### Neutral

- Whether the marker is a line, a band, or a moving box is a styling decision inside the one
  component and is not fixed here.
- ADR-0018 expands an ornament into notes with no notehead of their own. The cursor is unaffected:
  it resolves a *position*, not a note, and a position inside an ornament is a fraction through a
  bar like any other.

## Alternatives considered

### Alternative A — two separate cursors

The playback line is schedule-driven and note-resolution; Plan 0006's follow is click-driven and
bar-resolution. They share only Plan 0007's coordinate index. Each stays simple and neither waits
on the other.

Rejected because the expensive, error-prone part — jumping to the next system and down the staves
as the layout reflows — would be written twice, and the second one would be written under the
pressure of a plan that thought it was doing something easy. Two markers that disagree about where
bar 30 is, on the same page, on the same score, is a bug the user would find immediately and
neither plan would own.

### Alternative B — one component, two sources, built by whichever plan lands first

The same sharing, without deciding now who builds it.

Rejected because the interface would then be designed against whichever requirement happened to
arrive first, and that is very likely the bar-level one. A cursor designed for a box that snaps to
a barline does not grow gracefully into a line that interpolates through it; the reverse direction
is nearly free. Deciding the builder is the whole content of this ADR — without it, the "one
component" half is an aspiration.

### Alternative C — drive the line from `player:event`

Feed the cursor the per-event stream so its position is always exact and no interpolation is
needed.

Rejected because it makes a display feature a consumer of the hot channel, for a gain the eye
cannot see. Ten pushes a second interpolated on `requestAnimationFrame` is smooth; per-event is
bursty — events cluster at onsets and say nothing between them — so it is both more traffic and a
*worse* line.

## Notes

`STATE_INTERVAL_MS` in `electron/player/Player.ts` is the ten-per-second cadence this ADR relies on
and deliberately does not change.

Plan 0006 Phase 3's notes already say "do not add a second way to mark a bar, and do not reach for
OSMD's own cursor (considered and not chosen in Plan 0002's followup)". This ADR is that
instruction carried one step further: not a second way to mark a *position* either.

OSMD's own `Cursor` was rejected earlier, in Plan 0002's followup, and nothing here reopens it. It
advances by voice entry on its own model's terms, which is neither of the two clocks these sources
have.
