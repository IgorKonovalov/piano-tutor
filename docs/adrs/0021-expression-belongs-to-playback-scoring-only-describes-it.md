# ADR-0021 — Expression belongs to playback; scoring only describes it

> **Status:** proposed
> **Date:** 2026-09-11
> **Related plan(s):** Plan [0010](../plans/0010-the-timeline-tells-the-truth-about-the-page.md)
> **See also:** [ADR-0018](0018-the-timeline-carries-the-marks-on-the-page.md), which decides what
> the timeline extracts. This one decides who may act on it. Neither is complete alone.

## Context

ADR-0018 puts the page's dynamics, tempo marks, hairpins, pedal and articulation into the
`ExpectedTimeline`. The moment that lands, the application knows two things it has never known: how
loud the composer asked for, and how fast. Both are immediately useful to playback and both are
**dangerous to scoring**, and the danger is not hypothetical — it would undo a property this project
has spent three ADRs and a plan protecting.

**The aligner is tempo-free by construction, and that is load-bearing.** ADR-0005 makes onsets
quarter notes rather than milliseconds. ADR-0009 refused to let a grace note consult a clock, in as
many words: "a tempo-free matcher that consults milliseconds for one case is no longer tempo-free."
ADR-0010 preserved it explicitly. ADR-0012 kept a click-relative scoring path strictly *beside* the
tempo-free one rather than replacing it. ADR-0014 judges a bar against a tempo fitted from its
neighbours — the take's own tempo, never an external one. NFR 14 states the resulting property, and
`README.md` states it to the player: **"playing the whole piece evenly at half speed is playing it
correctly, and the app says so."**

Make the page's tempo authoritative for judging and every one of those falls over in the same
afternoon. A learner working a Chopin study at half speed — which is the correct way to work a
Chopin study — would open the app and find every bar red.

**Dynamics carry a second problem that tempo does not.** A MIDI velocity is not a measurement of
musical loudness; it is a number the CK88 computes from how fast a key went down, through a velocity
curve that is a property of *that instrument*, adjustable in its own menus. Plan 0001 Phase 7
measured the range this player actually produces. Judging *forte* against velocity would be judging
the keyboard's curve and the player's action as much as their musicianship, and a wrong answer there
is worse than no answer: it teaches the player to hit harder to satisfy a meter.

**And yet silence is its own failure.** The app would know the score asks for a rallentando at bar
31 and watch the player produce one without comment. Plan 0002's Phase 7 produced exactly the
sentence that makes this concrete. A real take reported:

```
You slowed 45% over bars 31 to 33.
```

That is a good sentence. With the page in hand it could be a better one — *you slowed 45% where the
score asks you to* — and the difference costs nothing to compute, because the observation is already
there. Only the label is missing.

So the decision is not whether to read expression. ADR-0018 settles that. It is **which side of the
play/judge line each mark lands on**, and the honest answer is that the line does not run where it
first appears to.

## Decision

**Playback uses every mark. Scoring uses none of them to decide anything, and may use them to
describe what it has already decided.**

`scheduleFromTimeline` reads the dynamics, tempo, pedal, articulation and fermata tracks and turns
them into velocities, milliseconds and CC 64. The demonstration sounds like the music.

`align.ts` does not read them, and does not learn how. No expression mark enters the cost function,
the onset grouping, the tempo fit, or any verdict. A bar cannot become `wrong`, `out of time` or
anything else because of a dynamic or a tempo word. **The tempo-free property is unchanged and every
existing test of it stays exactly as written** — which is how this ADR is enforced in practice
rather than merely stated.

`report.ts` may **annotate**. Where the report already makes an observation, and a mark coincides
with it, the prose may say so: a rallentando the player produced where the page asks for one is
described as such. The rules are narrow and deliberate:

- **It annotates an existing observation. It never creates one.** If the timing model said nothing
  about bars 31 to 33, the presence of a *rit.* there produces no sentence. The score does not get
  to raise a subject.
- **It never changes a verdict, a count or a colour.** The bar's state is computed before any mark
  is consulted, and is not revisited.
- **It never reports the absence of observance.** "You did not slow where the score asks" is a
  judgement wearing a description's clothes, and it is out of scope.

**Dynamics are not described at all in this decision**, only played. Tempo is where the coincidence
between what the report already computes and what the page already says is real; loudness has no
corresponding existing observation, and inventing one would be judging velocity through the side
door.

**The written tempo becomes playback's default and the transport's box becomes an override.** A
piece marked ♩=60 demonstrates at 60; a rit. actually slows, by the amount ADR-0018 names. When
the player sets a tempo, theirs wins and the *relative* shape of the written tempo is preserved
underneath it, because "demonstrate this passage slowly" is the most useful thing a demonstration
does and Plan 0005's practice loop depends on it.

We rejected scoring expression properly, and we rejected staying silent about it.

## Consequences

### Positive

- **The demonstration gains everything and the judge gains nothing to be wrong about.** The whole
  user-visible benefit of ADR-0018 lands on the side of the line where a mistake is merely
  audible.
- **Every tempo-free test survives unchanged**, which makes this ADR checkable rather than
  aspirational: a diff that touches `align.ts` to read a mark is a violation on sight.
- **The report gets better sentences for almost no code.** The observation, the bar range and the
  percentage already exist; the mark is a lookup on a track ADR-0018 already extracts.
- **The player is not taught to satisfy a meter.** Nothing rewards hitting harder or chasing a
  metronome mark, which is the failure mode of most software that tries to grade expression.
- **It leaves the door open and says where the door is.** Judging expression is a coherent future
  plan; this ADR names what that plan would have to reopen rather than pretending the question is
  closed forever.

### Negative

- **The app will visibly know more than it says.** It plays a crescendo and never remarks on
  whether the player made one. A user who sees the dynamics being played will reasonably ask why
  the report is silent about them, and the answer — that velocity is the instrument's number, not
  the music's — is a good answer that still has to be given every time it is asked.
- **"Describe, never judge" is a line that will be pushed.** The distance between *you slowed where
  the score asks you to* and *you did not slow where the score asks you to* is one `else` branch,
  and the second is a verdict. The rule is written narrowly here precisely because the code will
  make it cheap to cross.
- **Annotation couples `report.ts` to the tempo track**, a coupling that did not exist. It is
  read-only and late, but it means the report can no longer be computed from a take and an
  expression-free timeline alone.
- **The tempo override has to define what "override" means**, and the obvious reading —
  proportional scaling, so a written rit. still reads as a rit. at the player's tempo — is arithmetic
  the plan must get right or the feature is worse than not having it.
- **Two paths now turn quarter notes into milliseconds**: the schedule builder, with expression, and
  the tempo fit in alignment, without it. They must never be unified for tidiness' sake, and a
  future reader will be tempted.

### Neutral

- ADR-0012's click-relative scoring path is untouched and stays the answer for "was this in time
  against a beat we supplied". Expression is a different axis from the grid.
- Whether a fermata should be described as well as played is left open; it is a tempo event and
  would fit the annotation rule, but no existing observation currently coincides with one.

## Alternatives considered

### Alternative A — judge expression properly

Dynamics and tempo observance become scored, with verdicts of their own: the bar goes amber if you
played *mezzo-piano* where the page says *forte*, or held a steady tempo through a marked
rallentando.

Rejected for this plan, on two grounds. The smaller one is that it would rewrite NFR 14 and put
`align.ts` on a clock, undoing ADR-0005, ADR-0009, ADR-0010 and ADR-0014 in a single change. The
larger one is that **it would probably be wrong even if it were free**: velocity is the CK88's
curve, not the composer's intent, and the app would be grading the action of a keyboard. This is a
real future plan with a real interview in front of it — beginning with whether relative dynamics
within a phrase can be judged where absolute ones cannot — and it is not this one.

### Alternative B — playback only; say nothing

The timeline carries the marks, `scheduleFromTimeline` uses them, and the report never mentions
them. The cleanest possible separation, no coupling, no line to be pushed.

Rejected because the app would hold the answer and withhold it. It would compute "you slowed 45%
over bars 31 to 33", hold a track saying a rallentando is written at bar 31, and print the first
without the second — which does not read as principled restraint to a player, it reads as the app
not noticing. The annotation rule costs one lookup and buys the sentence that makes the observation
useful.

### Alternative C — let the score's tempo drive scoring, with a tolerance

Keep the tempo-free aligner for pieces with no marked tempo, and judge against the marked tempo
where one exists, generously.

Rejected because "generously" is doing all the work and none of it is definable. It also produces
the worst possible failure: the app behaves differently on two scores of the same music depending on
whether whoever typeset the file wrote a tempo in, which is a property of the *file* and not of the
playing. A learner cannot debug that, and the app would be unable to explain itself.

## Notes

The sentence this ADR is arguing about is real, from Plan 0002's Phase 7 at the CK88 on 2026-09-11:
"You slowed 45% over bars 31 to 33", on a take that reported 32 of 35 bars clean. The rallentando
was correctly *not* treated as an error — ADR-0014's doing — and this ADR is about the next word,
not about that judgement.

The velocity range this player produces at the CK88 was measured in Plan 0001 Phase 7 and is in that
plan's log. Anyone reopening Alternative A should read it first.

`align.ts` reading no expression mark is the invariant. The cheapest way to keep it true is that
`core/src/align/` must not import from whatever module resolves marks into numbers; a lint rule or a
dependency check would make that mechanical, and the plan may choose to add one.
