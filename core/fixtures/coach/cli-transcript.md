# `claude` CLI spike — what the binary actually accepts

> Run 2026-09-10 by `architect`, ahead of Plan 0003 Phase 2, to settle whether the user's
> subscription reaches a model through a spawned CLI at all. Everything below is what was run and
> what came back. Failures and surprises are recorded, not tidied away.
>
> **Machine:** Windows 10 Home Single Language 10.0.19045. **CLI:** 2.1.267 (ADR-0002 recorded
> 2.1.266 on 2026-09-09 — the version moved under us inside a day, which is itself the finding
> ADR-0002 warns about).

## 0. Is the subscription reachable at all?

```
$ claude auth status
{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "subscriptionType": "max",
  ...
}
```

**Answer: yes.** `authMethod: claude.ai` is the subscription login, not a key. Every run below
reported `apiKeySource: "none"`, so nothing in this transcript went through an API key.

This is a machine-local, point-in-time fact. It says the path works today on this machine; it says
nothing about whether it is sanctioned, which ADR-0002 already addresses and this spike does not
improve on.

## 1. Do the flags ADR-0002 assumed exist?

From `claude --help` on 2.1.267 — all four exist, and one of them is a trap:

| Flag | Status | Note |
|---|---|---|
| `-p` / `--print` | exists | |
| `--output-format json` | exists | **but see finding A — it does not return one object** |
| `--json-schema <schema>` | exists | takes the schema inline as a string, not a path |
| `--system-prompt <prompt>` | exists | replaces; `--append-system-prompt` is the separate append form |
| `--tools ""` | exists | `""` disables the built-in set — **but not MCP; see finding B** |
| `--resume <id>` | exists | not used by this plan (Analyse is one-shot) |
| `--bare` | exists | **must never be used here; see finding C** |

## 2. Run A — the naive invocation (no isolation)

```
$ echo "Say the note names of a C major triad." | claude -p \
    --output-format json \
    --tools "" \
    --system-prompt 'You are a piano teacher. Answer only with the requested JSON.' \
    --json-schema '{"type":"object","properties":{"notes":{"type":"array","items":{"type":"string"}}},"required":["notes"],"additionalProperties":false}'
```

Exit 0. Correct answer (`{"notes":["C","E","G"]}`). And three problems.

### Finding A — `--output-format json` returns an **array of events**, not a single object

The help text says `"json (single result)"`. What actually came back was a JSON array:

```
[ {type: "rate_limit_event"}, {type: "system", subtype: "init"},
  {type: "system", subtype: "thinking_tokens"} × 2,
  {type: "assistant"} × 2, {type: "user"},
  {type: "rate_limit_event"}, {type: "result", subtype: "success"} ]
```

**The provider parses `JSON.parse(stdout)` as an array and takes the element with
`type === "result"`.** On that element:

- `structured_output` holds the schema-validated object — this is the field to read.
- `result` holds the same thing as a JSON *string*. Redundant; prefer `structured_output`.

A provider written to `JSON.parse(stdout)` and read `.result` directly would throw on every call.

### Finding B — `--tools ""` does **not** isolate the process

The init event listed the tools the spawned session actually had:

```
"tools": ["StructuredOutput",
          "mcp__claude_ai_Google_Drive__copy_file",
          "mcp__claude_ai_Google_Drive__create_file",
          "mcp__claude_ai_Google_Drive__download_file_content",
          ... 12 Google Drive tools in total ]
"mcp_servers": [ {blender, pending}, {claude.ai Google Drive, connected},
                 {claude.ai Google Calendar, needs-auth}, {claude.ai Gmail, needs-auth} ]
```

`--tools ""` empties the *built-in* set only. The user's personal MCP servers, skills, plugins and
`CLAUDE.md` discovery all came through. **A coach process analysing a piano take was holding a
connected Google Drive credential.** That is not acceptable and the fix is in Run B.

### Finding D (cost) — the harness charges ~6 200 tokens before our prompt is counted

`cache_creation_input_tokens: 6188` for a fifteen-token question, plus a side-call to
`claude-haiku-4-5` (903 input tokens — an internal classifier, not ours). List-equivalent
$0.0673. The model that answered was `claude-opus-5[1m]` — whatever the user's Claude Code is
configured to, **not** anything the app chose.

## 3. Run B — the settled invocation

Adding the isolation flags and pinning the model by exact id:

```
$ echo "Name the notes of a C major triad." | claude -p \
    --model claude-opus-5 \
    --output-format json \
    --tools "" \
    --strict-mcp-config \
    --setting-sources "" \
    --disable-slash-commands \
    --no-session-persistence \
    --system-prompt '...' \
    --json-schema '{...}'
```

Exit 0, empty stderr, `structured_output: {"notes":["C","E","G"]}`. And the isolation is total:

| | Run A | Run B |
|---|---|---|
| `tools` | `StructuredOutput` + 12 Google Drive tools | `["StructuredOutput"]` |
| `mcp_servers` | 4 | `[]` |
| skills / plugins | 17 / 1 | 0 / 0 |
| `cache_creation_input_tokens` | 6 188 | **1 039** |
| list-equivalent cost | $0.0673 | **$0.0140** |
| `duration_ms` | 3 089 | 1 897 |
| model that answered | `claude-opus-5[1m]` (inherited) | `claude-opus-5` (pinned) |

**Isolating the process is not only the correct thing, it is 6× cheaper and ~40 % faster.**
`--setting-sources ""` is accepted (no error, and the effect is visible in the table).

`--model` accepts the exact id `claude-opus-5`; the answering model reported exactly that, with
no `[1m]` suffix, so pinning also pins the context window away from the user's 1M setting.

### On `--system-prompt`: replaces, on the evidence

1 039 tokens of context in Run B is far too small to contain Claude Code's default system prompt
on top of our fifteen-token instruction. Combined with the output carrying no Claude Code framing,
the flag replaces rather than appends. **Inferred from the token count and the behaviour, not
proven by a differential test** — if a future change makes this load-bearing, test it directly
against `--append-system-prompt`.

## 4. Run C — the unauthenticated path

Provoked without touching the user's login, by using `--bare` (which reads only
`ANTHROPIC_API_KEY`) with no key set:

```
$ unset ANTHROPIC_API_KEY; echo "hello" | claude -p --bare --output-format json --tools ""
```

**Exit code 1. stderr empty.** The error is in stdout, inside the result element:

```json
{ "is_error": true,
  "subtype": "success",
  "result": "Not logged in · Please run /login",
  "terminal_reason": "api_error",
  "api_error_status": null }
```

### Finding E — `subtype` is `"success"` on a failed call. Branch on `is_error`.

A provider that checks `subtype === "success"` will treat "not logged in" as a good reply and hand
a schema-violating object to Zod. **The failure test is `is_error === true` (corroborated by a
non-zero exit code), and the user-facing message is `result`.** Do not read stderr for this — it
was empty.

### Finding C — `--bare` defeats the subscription by construction

`--bare`'s own help: *"Anthropic auth is strictly `ANTHROPIC_API_KEY` or `apiKeyHelper` via
`--settings` (OAuth and keychain are never read)."*

ADR-0002's Notes proposed spiking `--bare` alongside `--json-schema`. **It must never be used on
the `claude-cli` path** — it is precisely the flag that turns the subscription path into an
API-key path. It was useful here only as a way to *simulate* being logged out.

## 5. Run D — a realistic payload over stdin

The real risk on Windows is not the flags, it is piping a multi-kilobyte prompt. Sent a
summary-shaped JSON payload of **13 852 bytes** containing newlines, double quotes, an apostrophe
and angle brackets:

```
$ claude -p --model claude-opus-5 --output-format json --tools "" --strict-mcp-config \
    --setting-sources "" --disable-slash-commands --no-session-persistence \
    --system-prompt '...' --json-schema '{...}' < bigprompt.txt
```

Exit 0, empty stderr, `structured_output: {"bar":28}`, `duration_ms: 4615`.

**stdin carries a realistic summary intact on Windows.** No temp file is needed, and no prompt
text, filename or key ever touches the command line — which is what the plan requires.

Token cost of that call: `cache_creation_input_tokens: 8737` for a 13.8 KB prompt. Note this is
**well above NFR 7's 4 000-token budget** — deliberately, because the payload carried 120
uncapped `worstBars` entries. It is direct evidence that the plan's cap on the summary is what
keeps NFR 7 true, and that an uncapped summary would blow it at a realistic take length.

## 6. What is still open

- **What a schema violation looks like.** Could not be provoked — the model satisfied the schema
  every time. The `anthropic-api` provider's Zod validation covers this path regardless, and the
  fixture provider can inject a violation directly (Phase 3 already requires that test).
- **Timeout and orphan behaviour.** Not probed live; Phase 4 tests it against the stub binary,
  which is the right place.
- **Whether a packaged Electron app finds the same OAuth credential** when `claude` is spawned
  outside a terminal. Every run here was from a shell under the user's account. Phase 6 item 1
  settles it. `claude setup-token` ("long-lived authentication token, requires Claude
  subscription") is the documented escape hatch if it does not.

## 7. The invocation Phase 4 builds

```
claude -p
  --model claude-opus-5
  --output-format json
  --json-schema <CoachReply schema, inline>
  --system-prompt <electron/coach/prompt.ts>
  --tools ""
  --strict-mcp-config
  --setting-sources ""
  --disable-slash-commands
  --no-session-persistence
```

Prompt over **stdin**. Argument **array**, never a shell string, never `shell: true`.
Success is `exit 0 && result.is_error === false`; read `result.structured_output`.
Failure is anything else, and its one-line message is `result.result`.
