# Non-functional requirements (v1)

The numbers behind every "real-time", "instant" and "works offline" in the plans. A plan that
claims one of these properties cites the row; a phase's done-when measures it. Revised by ADR,
not in passing.

| #  | Requirement | Number | How it is measured |
|----|-------------|--------|--------------------|
| 1  | **Key-to-pixel latency.** A note-on at the CK88 is visible on the keyboard view. | ≤ 30 ms at p95, ≤ 50 ms at max, over 500 events | Main stamps arrival with `performance.timeOrigin + performance.now()` — the epoch anchor is what makes the two processes' clocks comparable at all; the renderer logs the paint timestamp of the frame that first shows the key; the dev-only latency overlay reports the distribution. USB transport (1–3 ms) is inside the budget, not excluded from it. **Measured by hand at the instrument on the development machine and recorded in the plan's implementation log, never asserted in a test.** A synthetic source (ADR-0004) does not traverse the transport and cannot stand in for this row; NFR 11 is what an unattended run checks. |
| 2  | **No event loss.** Every MIDI message the port delivers reaches the renderer and the take. | 0 lost at a sustained 100 events/s and bursts of 200 events/s for 2 s | A generated dense scenario (ADR-0004) runs through the `MidiSource` seam; counts match at the recorder and at the renderer's event log. |
| 3  | **Offline.** Everything except the coach's reply works with no network. | 100 % of views | The renderer's CSP has no `connect-src`; main makes network calls only inside the `anthropic-api` provider. Verified two ways: a unit test over both policy strings, and a Playwright run with networking disabled. **The Playwright run drives the policy the app ships**, because the choice keys off whether Vite is serving rather than off whether the build is packaged; keying it off packaging left the shipped policy exercised by nothing. |
| 4  | **Startup.** Launch to a live keyboard view with the CK88 connected. | ≤ 3 s on the development machine | Stopwatch in the e2e test from **process creation** (`process.getCreationTime()`) to the first painted key on a generated scenario. Process creation is earlier than `app.whenReady` by the Electron bootstrap, so the figure over-estimates the row by tens of milliseconds against a 3 000 ms budget; reading `whenReady` instead would mean a timestamp stored in main for the harness to fetch, which is the kind of test hook ADR-0004 exists to avoid. |
| 5  | **Idle cost.** Window open, nothing played. | ≤ 2 % CPU, ≤ 200 MB RSS across all processes | Task Manager, five-minute average. |
| 6  | **Coach latency.** Analyse pressed to reply shown. | ≤ 15 s p95 via `claude-cli`, ≤ 5 s via `anthropic-api` | Logged per request in main; shown in the coach panel footer. |
| 7  | **Coach token budget.** One `TakeSummary`. | ≤ 4 000 tokens regardless of take length | A `core/` test holds the serialised summary of the longest fixture take under the budget. |
| 8  | **Recording durability.** A take survives a crash. | At most the last 1 s of events lost | The recorder appends to the take file every second (or every 64 events); a kill test checks the file reads back. |
| 9  | **Exact pins.** Every direct dependency, runtime and dev. | 0 range operators in `package.json` | A pre-push gate greps for `^`, `~`, `>=` in the dependency blocks. |
| 10 | **Install size.** The portable zip. | Recorded, not capped, on the first release | Bytes, in the release notes. An Electron shell is heavy by decision (ADR-0001); the number is kept honest rather than small. |
| 11 | **Headless verifiability.** Every `dev`-owned done-when is checkable with no instrument attached, and the paint path stays structurally fast. | Every `dev` phase; and the frame that first shows a key is ≤ 2 frames after the frame the event was injected in at p95, ≤ 4 at max, over 500 synthetic events | The `SyntheticSource` behind a `virtual:<scenario>` port (ADR-0004) drives the real pipeline; the e2e run asserts the frame bound and zero loss and **reports** the millisecond distribution into the implementation log. One frame at 60 Hz is 16.7 ms and the floor is 1 frame (an event cannot paint in the frame already being composited), so this row catches structural regressions — a debounce, a synchronous parse on the paint path, a re-render storm — and is deliberately looser than NFR 1, which a slower machine would fail for the wrong reason. |

| 12 | **Alignment turnaround.** Stop pressed to a coloured score. | ≤ 2 s at p95 for a 10-minute take against a 200-bar score, on the development machine | Timed in the renderer around the `core/` alignment call and reported in the plan's implementation log. The property that keeps it there, and the thing a test asserts, is the shape of the work: alignment is banded, so its cost is linear in the take's onset groups rather than quadratic, and the report it returns is sized by bars, not by events (ADR-0005). |

**Properties are asserted; milliseconds are reported.** Rows 2, 3, 7, 8, 9 and 11 state properties
that hold on any machine and are checked by tests. Rows 1, 4, 5, 6, 10 and 12 are measurements of one
machine: they are run by hand, written into the plan's implementation log against the machine
that produced them, and never asserted in a test CI runs.

## What is deliberately not a requirement

- **Audio.** The CK88 is the sound source. The application never synthesises, never opens an
  audio device, and never needs Local Control changed.
- **Multi-user, accounts, sync.** Local files only, by interview decision.
- **Live coaching during a passage.** Deferred in the interview; NFR 6 is an on-demand budget.
