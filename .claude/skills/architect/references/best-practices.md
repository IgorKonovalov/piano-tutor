# Best practices — piano-tutor

The correctness rules for this codebase. The architect checks against these in Mode 4; `dev`
implements against them whether or not a plan restates them. Ordered roughly by how much damage a
violation does. Lifted from two shipped Electron applications (Ritmolux's studio, market-analyzer's
desktop) and adjusted for a project with a MIDI device instead of a sidecar.

## Process boundaries (the cardinal rules)

- **The renderer never touches the OS or the network.** No `node:*`, `electron`, `fs`,
  `child_process`, no `fetch` to anywhere. The CSP has no `connect-src`. Reaching for one means
  the code belongs in main behind a narrow `window.api` capability. The four tsconfigs enforce
  this at typecheck; a Node type error in a renderer file is the boundary catching a real bug.
- **Main never holds UI state and never imports React** or anything from `renderer/`. It owns
  devices, files, child processes, dialogs and the window.
- **`core/` imports nothing from a process.** No Electron, no DOM, no Node. It is what makes chord
  detection, alignment, scoring and the coach summary testable with Vitest and fixtures alone. A
  function that needs a device or a window is in the wrong package.
- **Preload is the only bridge.** One `window.api`, assembled from per-domain modules, typed as
  `typeof api`. A push channel's binding returns a cleanup function.

## Security defaults are not optional

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on every `BrowserWindow`;
  `preload` points at the built bundle; `show: false` until `ready-to-show`.
- **Double CSP:** the `<meta http-equiv="Content-Security-Policy">` in `index.html` *and* the
  `onHeadersReceived` hook that strips any incoming policy case-insensitively (Vite sends
  lower-case) before writing ours. Both, not one.
- `'unsafe-inline'` in `script-src` only while `app.isPackaged === false`. Never `'unsafe-eval'`.
- External URLs through `shell.openExternal`; `will-navigate` and `setWindowOpenHandler`
  intercepted.
- **The API key lives in main's settings store.** It is never sent to the renderer, never logged,
  never written into a take file or a commit.
- If a library needs any of these relaxed, the library is wrong, not the rule. Stop and surface.

## Validate at boundaries, trust inside

- **Every IPC payload** is parsed with its Zod schema in the main-process handler (for invokes)
  and in the preload binding (for pushes). Past that, trust the type.
- **Every file read from disk** (a take, a score, the settings file) is parsed, never `as Foo`.
- **Every coach reply** is parsed against `CoachReplySchema`; a reply that fails is a provider
  error shown to the user, never a half-rendered panel.
- **MIDI bytes** are parsed once, at arrival in main. A malformed message produces a typed
  `unknown` event carrying the raw bytes; it never throws and never closes the port.
- Do not re-validate the same payload three times down the stack.

## The hot path

- **Main stamps at arrival.** `performance.now()` in the RtMidi callback, before any parsing, so
  the latency measured against NFR 1 includes everything the app adds and nothing it does not.
- **Forward, then record.** The push to the renderer and the append to the take file are both
  cheap; neither waits on the other, and the recorder's disk flush (every second or 64 events)
  never sits on the event path.
- **No loss.** Events are never dropped or coalesced on the way to the renderer or the take (NFR
  2). If a view cannot keep up, the view paints the latest state on its next frame; the events
  still all arrive.
- **The renderer paints from state, not from events.** `HeldNotes` in `core/` reduces the stream
  to the held set plus pedal state; the keyboard, staff and labels render that. A component that
  appends to an array per event and re-renders the world is the latency bug NFR 1 exists to catch.
- **Measure before optimising.** The dev-only overlay reports p50, p95 and max. A canvas keyboard,
  per-key memoisation or a 30 Hz repaint timer are answers to a number, not guesses.

## Determinism where it is testable

- **`core/` is pure.** Chord detection, key estimation, spelling, alignment, scoring and the
  `TakeSummary` are functions of their input. No wall-clock reads inside; time enters as event
  timestamps. No unseeded randomness; the exercise generator takes a seed.
- **Fixtures are committed.** Chord tables, recorded takes, MusicXML files live under
  `core/fixtures/` and the tests assert exact names, bar indices and counts against them.
- **Numeric assertions state a property or name the machine.** A chord name or event count is
  exact. A latency figure is a measurement of one machine: it goes in the implementation log, not
  in a test CI runs.

## Non-React resources dispose on unmount

VexFlow renderers and contexts, canvas `ResizeObserver`s, the push-channel listener, timers,
`MessagePort`s: every `useEffect` that creates one returns the cleanup that destroys it. Create
once, push data in a second effect; never recreate the instance on a data change. This is the
canonical Electron memory leak and a visible flicker.

## Exact pins and one package manager

- Every direct dependency, runtime and dev, is `X.Y.Z` in `package.json`. No `^`, `~`, `>=`.
  `scripts/check-pins.mjs` gates it (NFR 9). An upgrade is a manifest edit plus `npm install` in
  one commit.
- `npm` with a committed `package-lock.json`. Never `pnpm` or `yarn` in this repo.
- Every new dependency is a cost to justify. A three-line helper beats a package.

## Accessibility basics

`<button>` not `<div onClick>`; every input labelled; the keyboard and staff canvases carry an
`aria-label` describing what they show; colour is never the only carrier of a wrong-note mark
(a shape or a label goes with it); focus stays visible.

## Comments

A comment carries the mechanism: what the code does, the invariant it holds, the trap that bites
whoever changes it, a formula or constant a reader cannot re-derive. The decision record stays in
`docs/`, cited by bare number (`ADR-0002`, `Plan 0001 Phase 2`), never by a relative link that
rots when a plan moves to `done/`. No plan-relative narration: describe the code as it is, not as
a history.

## Security and integrity

- No secrets in code, tests, logs, plans, ADRs or commit messages.
- The `claude-cli` provider spawns a binary found on `PATH`; it passes the prompt as an argument
  and the schema as a flag, never through a shell string that a take's content could escape.
- A take file, a score and the settings file are user data; a malformed one is reported and
  skipped, never a crash at startup.
