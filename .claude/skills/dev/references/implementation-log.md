# The implementation log — field guide

The close brief is **a section of the plan**, `## Implementation log`, written as the phases land.
What you print at Step 4 is a three-line pointer at it. The reason is the medium: a chat brief
lives in one session's scrollback, dies with a context clear, and cannot describe a finished lane
sitting in a worktree. A section of the plan can.

## Why the log is thin

The log carries **your observations, never your conclusions**. It says *where to look*; architect
decides *how it went*. Architect must arrive at the review with a complete map and **no verdict
pre-formed**, because the whole value of the fresh-session close is that it reaches its own. A
written file anchors a reader far harder than a chat message: it looks like a record and travels
with the plan forever. That is why there is no per-criterion `[pass]` list: it would sit exactly
where architect is told that a green `npm test` is not a passing test.

**Thinness applies to your opinions, never to your findings.** A deviation from the plan is
**always** disclosed: what you did differently and the commit, without the argument that it was
fine. A done-when you could not satisfy as stated is always noted with what you did instead.
Reporting non-passes only is asymmetric in the right direction.

## Why the session must still be fresh

Review compares code against plan and ADRs, checks the process boundaries, reads test bodies
across the whole plan. That is hard in a context full of implementation reasoning. The log makes
the handoff durable and asynchronous; it does not let you close your own plan.

## Filling each field

The skeleton is in `.claude/skills/architect/references/templates/plan.md`. If a plan lacks the
section, copy the skeleton in rather than skipping it.

- **`**Lane:**`** — `main` directly, or the worktree path plus its branch
  (`WORK/pt-plan-NNNN` on `plan-NNNN-<slug>`). Architect's worktree close takes both from here.
  Write it on the first phase commit.
- **The table** — `phase | owner | state | commit`. `state` is `done`, `not started` or
  `abandoned`, never a quality word. The row for the phase committing right now reads
  `committed with this row`; backfill its SHA in the next phase's commit, and the last one's in
  the close-block commit.
- **`### Measurements`** — one line per NFR row the plan claimed: the number, the machine, the
  phase. `NFR 1 (Phase 2, keyboard only): p50 9 ms, p95 18 ms, max 31 ms over 500 events,
  development machine.` These are measurements, so they live here and not in a test.
- **`### Notes`** — three things, one line each: deviations (what and the commit), unmet
  done-whens (by exception, with what you did instead), followups noticed and not acted on.
  Nothing else. Not narrative, not self-assessment, not "nothing notable". Empty is valid.
- **`### Close triggers`** — raw facts for architect to verify and decide from, no
  recommendation: what shipped (feature / fix-only / docs-chore-only); user-visible docs touched
  (`README.md`, `CLAUDE.md`, `docs/nfr.md`, or none); the **full gate** at the last phase (each
  command and its exit code, including `npm run test:e2e`); which `human` phases remain.
  **No suggested version bump**; the level is architect's.

**Size.** The log stays shorter than the plan's `## Implementation phases`. If it is breached,
architect reports a `minor`.

**Resume scaffolding.** When a session is cleared mid-plan, write what a resuming `dev` needs (the
diagnosis behind an unfinished symptom, candidate fixes and costs, the gate state at the tip) and
land it as its own `docs(plans): …` commit. That reader is the same lane, so anchoring does not
apply. **Delete it when the phase lands.** Only findings survive to the close.

## The pointer you print at Step 4

After the close block is committed. Three lines, nothing else:

```
Plan 0001 — The keyboard shows on screen  (docs/plans/0001-the-keyboard-shows-on-screen.md)
Lane: main   (or: WORK/pt-plan-0001 on branch plan-0001-the-keyboard-shows-on-screen)
Next: start a fresh session and run /architect close plan 0001
```

## What NOT to include

- No per-criterion pass/fail list.
- No self-review ("landed cleanly").
- No full diff; the table maps phase to commit.
- No session recap.
- No secrets, and no API key even redacted.
