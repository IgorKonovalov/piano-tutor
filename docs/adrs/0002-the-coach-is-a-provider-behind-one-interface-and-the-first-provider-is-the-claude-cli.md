# ADR-0002 — The coach is a provider behind one interface, and the first provider is the local Claude Code CLI

> **Status:** proposed
> **Date:** 2026-09-09
> **Related plan(s):** [0001](../plans/done/0001-the-keyboard-shows-on-screen.md) (records the takes the
> coach will read); the coach itself lands in Plan [0003](../plans/0003-the-coach-speaks.md)

## Context

The user wants on-demand coaching: play a take, press Analyse, read what went wrong and what to
practise, ask follow-up questions. They want it to run on their **existing Claude subscription**
rather than a metered API key, and the application must work fully without it.

Three facts constrain how that subscription can be reached:

- **Anthropic's consumer terms tie Pro/Max subscription usage to Anthropic's own products.**
  Third-party applications calling the Messages API with a subscription login are not a supported
  or permitted path, and the tokens involved are not meant to leave Anthropic's clients.
- **Claude Code is one of those products, and it runs on the subscription.** Its CLI has a
  non-interactive mode: `claude -p` takes a prompt, `--output-format json` returns one structured
  result, `--json-schema` constrains it, `--system-prompt` replaces the default, `--tools` limits
  the tool set, and `--resume <session-id>` continues a conversation. The CLI is installed on this
  machine (2.1.266, verified 2026-09-09).
- **Invoking the real CLI for personal use is Claude Code being used**, but wrapping it inside
  another application is a grey zone that Anthropic could narrow at any time. Any design that
  depends on it alone is fragile.

The coaching itself does not need raw MIDI. A take of three minutes is thousands of events; what
a teacher reacts to is a summary: which bars went wrong and how, whether the player rushed or
dragged and where, dynamics against the markings, pedal habits, and a few worst-bar excerpts.

## Decision

We will put the coach behind **one interface in main**, `CoachProvider`, with three
implementations selected in settings:

| Provider        | How it reaches a model                                                                                                   | When it applies                                      |
|-----------------|--------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------|
| `claude-cli`    | Spawns the locally installed `claude` binary in print mode with a JSON schema and our system prompt, tools disabled, `--resume` for follow-ups | Default when the CLI is on `PATH` and authenticated |
| `anthropic-api` | The official `@anthropic-ai/sdk` with a user-pasted API key stored by main, never shown to the renderer                  | When the user enters a key, or if the CLI path stops working |
| `none`          | The Analyse button is hidden; the take statistics panel still renders from `core/`                                       | No CLI, no key, or offline                           |

The renderer never knows which provider answered. It sends one `CoachRequest` (a `TakeSummary`
produced by `core/`, plus the user's question and the conversation id) over `coach:ask` and
receives one `CoachReply` (validated against a Zod schema: an assessment, a ranked list of
issues each anchored to bars, a practice suggestion list, and an optional follow-up question).
Both shapes live in `shared/coach.ts`.

**The model receives a summary, never the raw take.** `core/` compresses a take to a
`TakeSummary` held under a fixed token budget (NFR 7), and the system prompt tells the model what
each summary field means. Raw excerpts appear only for the worst few bars, quoted as note names
with timing offsets.

The `claude-cli` provider is **best-effort by contract**: a missing binary, an unauthenticated
session or a non-zero exit is reported to the user as "coach unavailable, set an API key in
settings" and is never retried in a loop. Its cost to the user is subscription usage, which the
settings panel says in one sentence.

## Consequences

### Positive

- **The user gets coaching on the subscription they already pay for, today**, through the one
  product that is allowed to run on it.
- **The API-key path is a settings toggle away**, not a rewrite, on the day the CLI path stops
  working or the user prefers metered cost.
- **Offline is a first-class state.** Every panel except the coach's reply renders from `core/`.
- **Tokens are bounded.** A take of any length becomes a summary of fixed size.

### Negative

- **The CLI provider is a grey zone and may break without notice.** The interface exists for that
  reason, and the user is told so in the settings panel. This ADR does not claim the path is
  sanctioned; it claims it is the nearest thing to what the user asked for that does not involve
  extracting credentials from Anthropic's clients.
- **A process spawn per question.** Two to ten seconds of latency per reply against an
  in-process API call's one to three. Acceptable for an on-demand button; it is why live nudges
  during playing were deferred in the interview.
- **Two providers to keep true to one schema.** The Zod schema on `CoachReply` is the contract,
  and a provider whose output fails it reports a provider error rather than a half-parsed reply.
- **The coach competes with the user's own coding for the same quota.** Measured 2026-09-10: a
  spawned CLI call draws on the identical five-hour and seven-day windows as the user's own
  Claude Code sessions, and reports their utilisation back on every call. This is not a cost the
  application can manage or amortise — it can only be spent deliberately, which is why Analyse is
  a press rather than anything automatic, and why the `anthropic-api` toggle is the real relief
  valve rather than a fallback nobody expects to use.

### Neutral

- A local model provider (Ollama) fits the same interface and is not built until someone wants
  it; it would be a fourth row in the table, not a design change.

## Alternatives considered

### Alternative A — Reuse the Claude desktop or web login directly from the application
Log in with the subscription and call the API with the resulting token. Rejected outright: it is
against the terms, the token is not ours to hold, and it breaks on the first auth change.

### Alternative B — API key only
The clean, supported path. Rejected as the *only* path because the user explicitly asked for the
subscription; it is the second provider and the documented fallback rather than the default.

### Alternative C — Send the raw MIDI and let the model do the analysis
Simplest to build. Rejected because a three-minute take is tens of thousands of tokens, the
model is poor at counting timing offsets across thousands of numbers, and the alignment and
statistics are deterministic work that `core/` does better and tests can pin.

## Notes

The exact CLI invocation is fixed in Plan 0003. The system prompt lives in
`electron/coach/prompt.ts` and is versioned with the code, not with the user's settings.

### Spike outcome, 2026-09-10 (CLI 2.1.267)

The spike ran ahead of Plan 0003 Phase 2; its transcript is
`core/fixtures/coach/cli-transcript.md`. **The decision above stands unchanged** — the
subscription does reach a model through a spawned CLI, verified with `apiKeySource: "none"` on a
`claude.ai` login. Three corrections to this ADR's own assumptions, recorded here because they
are the ones most likely to be repeated from memory:

- **`--bare` must never be used on this path.** This section previously proposed spiking it
  alongside `--json-schema`. Its help is explicit that Anthropic auth becomes strictly
  `ANTHROPIC_API_KEY` or `apiKeyHelper`, with OAuth and the keychain never read — so it converts
  the subscription provider into the API-key provider. **That suggestion is withdrawn.**
- **Disabling tools does not isolate the process.** `--tools ""` empties the built-in set only;
  the user's personal MCP servers, skills, plugins and `CLAUDE.md` are inherited. The spike's
  first run gave a piano-coaching process twelve connected Google Drive tools. Isolation needs
  `--strict-mcp-config --setting-sources "" --disable-slash-commands --no-session-persistence`,
  which also cuts the per-call context roughly six-fold.
- **The reply is an array of events, and a failed call still says `subtype: "success"`.** The
  provider reads the `type === "result"` element and branches on `is_error`.

The version moved from 2.1.266 to 2.1.267 within a day of this ADR being written, and
`--output-format json`'s documented shape did not match its actual shape. Both are small
confirmations of the Negative consequence above rather than new information.
