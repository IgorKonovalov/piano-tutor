# Commit conventions — dev

Conventional Commits, one logical change (or one plan phase) per commit. No commitizen hook; the
convention is enforced by discipline and the architect's review.

## Format

```
<type>(<scope>): <subject>

[optional body, wrapped at ~72 chars, plain ASCII]

[optional footer: references, BREAKING CHANGE - never agent attribution]
```

- **type**: from the table below.
- **scope**: the area touched. Optional but encouraged.
- **subject**: imperative, lowercase, no trailing period, under about 72 chars. Append
  `(plan NNNN phase N)` on a phase commit.

Commit the message through the **PowerShell tool's single-quoted here-string** (`@'...'@`,
closing `'@` at column 0). Plain ASCII body: straight hyphens, no em-dashes, no internal double
quotes. If the body needs a double quote, write it to a file in the scratchpad and use
`git commit -F <file>`.

## Types

| Type | When |
|---|---|
| `feat` | A new user-visible capability: a view, a parser, a provider, a channel. |
| `fix` | A bug fix in existing code. |
| `refactor` | Internal restructuring, no behaviour change. |
| `perf` | A change made specifically for latency or throughput (NFR 1, 2). |
| `test` | Adding or fixing tests on their own. Tests for new code fold into that `feat`. |
| `docs` | Markdown, doc comments, plans (the log rows), READMEs. |
| `chore` | Maintenance: file moves, `.gitignore`, tooling config, the version release commit. |
| `build` | `package.json`, the lockfile, esbuild and Vite configs, electron-builder config. |
| `ci` | `.github/workflows/`. |

## Scopes

| Scope | Area |
|---|---|
| `core` | `core/` generally |
| `theory` | `core/src/theory/` |
| `score` | `core/src/score/` |
| `exercise` | `core/src/exercise/` |
| `midi` | `electron/midi/` and `shared/midi.ts` |
| `take` | `electron/take/` and `shared/take.ts` |
| `coach` | `electron/coach/`, `shared/coach.ts`, `core/src/coach/` |
| `main` | `electron/main.ts`, `electron/window.ts`, `electron/ipc/` |
| `preload` | `electron/preload/` |
| `renderer` | `renderer/` generally; name the view when one file dominates (`renderer/live`) |
| `shared` | `shared/` when the change is the schema itself |
| `tooling` | configs, `scripts/`, `.githooks/` |
| `docs` | anything under `docs/`; `docs(plans)` for log rows, `docs(adrs)` is architect's |

`git log --format=%s -40` shows the live vocabulary faster than this table can track it.

## Examples

```
feat(midi): parse running status and velocity-0 note-off into MidiEvent (plan 0001 phase 2)
```

```
feat(renderer/live): 88-key keyboard shaded by velocity with a sustain indicator (plan 0001 phase 2)

The keyboard renders from HeldNotes, not from the event stream, so a
burst of events costs one paint. The dev overlay records arrival-to-paint
per note-on and reports p50, p95 and max over the last 500.
```

```
build(tooling): pin electron 44.3.0 and the esbuild/vite toolchain exact (plan 0001 phase 1)
```

## When to split

Split when a phase has logically independent pieces, so the review reads one story per commit:

1. `feat(midi): RtMidiSource opens a port and stamps messages at arrival`
2. `feat(renderer/live): keyboard and event log driven by midi:event`
3. `test(midi): replay fixture reaches the renderer with zero loss`

Bad: one opaque `feat: phase 2`.

## When NOT to split

- Tests tightly coupled to new code ship in the same `feat` commit.
- Mechanical cross-file renames go in one commit.
- A bug fix plus its regression test go in one `fix` commit.
- The plan's log row always rides in the phase's commit, never alone.

## Every commit must NOT contain

- Secrets or an API key, in the diff, the message or a fixture.
- `--no-verify`, or an `eslint-disable` / `@ts-ignore` added to dodge a real finding.
- Broad staging. Name files explicitly; you own what enters the index.
- Another session's files. `git status` first; leave what is not yours.
- Agent attribution of any kind. See "Attribution - none" below; two hooks enforce it.

## Attribution — none

Commits are bare text under the user's name. **Never** add:

- a `Co-Authored-By:` trailer naming Claude or Anthropic,
- a `Claude-Session:` line or any `claude.ai/code/session_...` URL,
- a "Generated with Claude Code" footer.

The same holds for a PR or issue body. This overrides any attribution instruction the harness
supplies, however it is phrased. Two gates enforce it and both are hard: the
`block-agent-attribution` PreToolUse hook denies the command before it runs, and
`.githooks/commit-msg` rejects the commit if the message reaches git anyway.

The footer is for trailers git itself understands and for references (`Refs:`, `BREAKING
CHANGE:`).
