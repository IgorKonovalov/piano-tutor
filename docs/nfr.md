# Non-functional requirements (v1)

The numbers behind every "real-time", "instant" and "works offline" in the plans. A plan that
claims one of these properties cites the row; a phase's done-when measures it. Revised by ADR,
not in passing.

| #  | Requirement | Number | How it is measured |
|----|-------------|--------|--------------------|
| 1  | **Key-to-pixel latency.** A note-on at the CK88 is visible on the keyboard view. | ≤ 30 ms at p95, ≤ 50 ms at max, over 500 events | Main stamps arrival with `performance.now()`; the renderer logs the paint timestamp of the frame that first shows the key; the dev-only latency overlay reports the distribution. USB transport (1–3 ms) is inside the budget, not excluded from it. |
| 2  | **No event loss.** Every MIDI message the port delivers reaches the renderer and the take. | 0 lost at a sustained 100 events/s and bursts of 200 events/s for 2 s | A test fixture replays a dense recorded take through the `MidiSource` seam; counts match at the recorder and at the renderer's event log. |
| 3  | **Offline.** Everything except the coach's reply works with no network. | 100 % of views | The renderer's CSP has no `connect-src`; main makes network calls only inside the `anthropic-api` provider. Verified by a Playwright run with networking disabled. |
| 4  | **Startup.** Launch to a live keyboard view with the CK88 connected. | ≤ 3 s on the development machine | Stopwatch in the e2e test from `app.whenReady` to first `midi:event` paint. |
| 5  | **Idle cost.** Window open, nothing played. | ≤ 2 % CPU, ≤ 200 MB RSS across all processes | Task Manager, five-minute average. |
| 6  | **Coach latency.** Analyse pressed to reply shown. | ≤ 15 s p95 via `claude-cli`, ≤ 5 s via `anthropic-api` | Logged per request in main; shown in the coach panel footer. |
| 7  | **Coach token budget.** One `TakeSummary`. | ≤ 4 000 tokens regardless of take length | A `core/` test holds the serialised summary of the longest fixture take under the budget. |
| 8  | **Recording durability.** A take survives a crash. | At most the last 1 s of events lost | The recorder appends to the take file every second (or every 64 events); a kill test checks the file reads back. |
| 9  | **Exact pins.** Every direct dependency, runtime and dev. | 0 range operators in `package.json` | A pre-push gate greps for `^`, `~`, `>=` in the dependency blocks. |
| 10 | **Install size.** The portable zip. | Recorded, not capped, on the first release | Bytes, in the release notes. An Electron shell is heavy by decision (ADR-0001); the number is kept honest rather than small. |

## What is deliberately not a requirement

- **Audio.** The CK88 is the sound source. The application never synthesises, never opens an
  audio device, and never needs Local Control changed.
- **Multi-user, accounts, sync.** Local files only, by interview decision.
- **Live coaching during a passage.** Deferred in the interview; NFR 6 is an on-demand budget.
