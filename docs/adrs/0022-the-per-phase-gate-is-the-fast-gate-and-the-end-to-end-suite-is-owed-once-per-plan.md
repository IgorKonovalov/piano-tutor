# ADR-0022 — The per-phase gate is the fast gate, and the end-to-end suite is owed once per plan

> **Status:** accepted 2026-09-12, on the close of Plan 0014
> **Date:** 2026-09-11
> **Related plan(s):** [0014](../plans/done/0014-the-end-to-end-suite-runs-in-parallel.md), which adds
> the `gate:fast` script and makes the once-per-plan run cheaper

## Context

**The gate has two halves, and they differ by an order of magnitude.** Measured on the development
machine on 2026-09-11, against the tree at `2f01d0f`: `npm run typecheck` 11 s, `npm run lint`
8 s, `npm test` 6 s for 760 unit tests, and the two Node gates are negligible, so about 25 s in all.
`npm run test:e2e` took **277 s** for 34 cases on one worker. Plan 0004's close logged the same
suite at 3.0 to 3.6 minutes. The e2e time is not spent launching the app, since the score cases
each finish in about a second. It goes on the playback and practice cases, which play a passage
in real time and take 8 to 20 s each. So it grows with every such case a plan adds.

**The skills already say the suite is owed once per plan, and the plans overrule them.** The `dev`
skill's per-phase gate is typecheck, lint, unit tests and the two Node gates, with `test:e2e` at the
last phase, "a phase whose done-when names it runs it regardless". Nearly every per-phase done-when
in Plans 0010 to 0013 ends "`npm run gate` is green", and `npm run gate` runs `test:e2e`. `CLAUDE.md`'s
queue rule names `npm run gate` as the stop signal after every phase. The exception has become
the rule. An eight-phase plan pays the suite eight times, more than half an hour. Flakes make it
worse: Plan 0010 Phase 3 needed three runs to come back green, each red on a different case.

**Running everything at every phase buys little.** Most phases change `core/` or a single
component, and the unit layer covers them in seconds. The e2e cases exist for what only the real
app shows: OSMD's layout, which jsdom cannot do, the IPC path, and the panic path through a real
window. A phase that touches one of those is known when the plan is written, so the plan can
name the spec that covers it.

Ritmolux met the same shape, a uniform per-phase gate dominated by a small, slow slice of the
suite, and settled it in its own ADR-0156. The evidence there was that an unscoped rule gets
narrowed silently and inconsistently, and then the log cannot say what any phase ran.

## Decision

**The per-phase gate is `npm run gate:fast`**: typecheck, lint, unit tests and the two Node gates.
**A phase whose change can be seen end to end names its spec files** in its done-when, one
file at a time, and they run as `npm run test:e2e -- e2e/<name>.spec.ts`. **The full `npm run gate`,
the whole e2e suite included, is owed once per plan**, at the last `dev` phase and again at the
close, and the close block records its result. So a plan's done-when names `npm run gate` only
on its last `dev` phase. In queue mode the stop signal is a red phase gate at any phase, or a red
full gate at a plan's last phase.

The rule narrows the default and never caps it. A phase that changes `e2e/harness.ts`,
`playwright.config.ts` or the launch path runs the whole suite, and `dev` may always run more than
the plan names. **A red that goes green on a rerun is logged** with the case's name and its error
line. It is never absorbed as a pass, because a flake that nobody records never gets fixed.

## Consequences

### Positive
- A phase costs about 25 s of gate, plus the one or two specs it actually affects, instead of
  about 5 minutes.
- The narrowing is written down and uniform. A phase's log row says exactly what ran, instead of
  leaving each phase to improvise, which Ritmolux found happens anyway.
- A flake becomes a logged fact with a case name, which is what Plan 0010's two recurring
  score-view flakes needed and did not get.
- The spec named in a done-when states which surface the phase's claim lives on. A reviewer
  can then read that claim against the spec, not against "the suite passed".

### Negative
- **A phase can break a spec it did not name, and nobody finds out until the last phase.** The red
  then shows up several commits after its cause, and finding the cause costs a bisect. The full
  gate at the last phase bounds the damage to one plan and never lets it reach `main` unseen.
- **The plan author now chooses the specs, and a wrong choice silently under-tests.** A phase that
  changes something end-to-end visible and names no spec falls back to the unit layer. The close
  review checks for this: a phase whose file list includes `renderer/` or `electron/` and whose
  done-when names no spec is questioned.
- Two gate commands where there was one. `CLAUDE.md`, both skills and the plan template carry the
  distinction.

## Alternatives considered

### Alternative A — The whole gate at every phase (the status quo)
It rejects every regression at the phase that caused it, and nothing else does. It lost on cost:
five minutes a phase before any flake, growing with every playback case. Ritmolux's evidence is
that a rule this expensive is not actually followed, just followed invisibly.

### Alternative B — The fast gate only, with e2e strictly once per plan
It is the cheapest option, and the one the `dev` skill already describes. It lost because some
phases' claims can only be checked end to end. "The bar mark sits on the box OSMD drew" has no
unit form, since OSMD does not lay out under jsdom. Deferring those to the plan's end means a
phase's done-when cannot actually be checked at that phase.

### Alternative C — `dev` picks the affected specs by judgement
It needs less plan wording. It lost on auditability: what a phase ran would depend on the session,
the review could not hold a phase to a choice nobody wrote down, and the plan could not be read
in advance for what each phase will prove.

### Alternative D — Make the suite fast enough to keep running it at every phase
This one complements the decision rather than replacing it, and Plan 0014 does it: a separate
state directory per launch, several workers, and no window that depends on being seen. It cannot
replace the scoping, because the longest case alone is 20 s of real-time playback. Even perfectly
parallel, the suite stays well above the fast gate, and it grows with every plan.

## Notes

- Timings are from 2026-09-11 on the development machine, one worker, with a dev lane's
  uncommitted Plan 0010 changes in the tree. That run's single red was
  `e2e/score.spec.ts:313`, where the drawn score id was a different score's. It is the same symptom
  as Plan 0010's logged "wrong title on a row" flake, and Plan 0014 Phase 1 is where that shared
  state is removed.
- Modelled on Ritmolux's ADR-0156 ("the per-phase gate is scoped, and the suite is owed once per
  plan"). The difference is the grain: there the fast set is a test-runner filter, here it is a
  spec file named by the plan, because this suite is small enough to name.

## Outcome, 2026-09-12

Accepted on the close of Plan [0014](../plans/done/0014-the-end-to-end-suite-runs-in-parallel.md),
which built the `gate:fast` script the decision names and made the once-per-plan run cheaper: the
suite fell from about 3.5 minutes to about 1.4, and the whole gate now costs less than the suite
alone did.

**The decision holds as written, with one limit the body does not state.** `npm run test:e2e --
e2e/<name>.spec.ts` runs that file and only that file for four of the five spec files. It does not
for `e2e/measure.spec.ts`: Plan 0014 gave the measuring cases their own Playwright project ordered
behind the parallel one with `dependencies: ['suite']`, and Playwright runs a dependency project's
whole set even when a file filter is given — 40 tests in 5 files, measured at the close. Plan 0014
checked the property for `e2e/player.spec.ts`, where it holds. The cost is time, never a false
green, since the run is always a superset. **A phase whose done-when names `e2e/measure.spec.ts`
pays the full suite**, and no plan names it today. Removing the limit means ordering the two
projects without a `dependencies` edge, and that is a followup in Plan 0014, not a change here.

**The negative the ADR predicted did not fire in its first plan.** Plan 0014's own phases each
changed the launch path, so each ran the whole suite by the rule's own exception, and nothing
reached the last phase unseen. The other negative — a plan author naming no spec where one was
needed — is still untested: every phase here named the full suite.
