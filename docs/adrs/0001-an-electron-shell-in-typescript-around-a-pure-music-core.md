# ADR-0001 — An Electron shell in TypeScript around a pure music core, with MIDI owned by the main process

> **Status:** accepted 2026-09-10, on the close of Plan 0001
> **Date:** 2026-09-09
> **Related plan(s):** [0001 — The keyboard shows on screen](../plans/done/0001-the-keyboard-shows-on-screen.md)

## Context

The product is a Windows desktop piano tutor for one user with a Yamaha CK88: a live display of
what is being played, play-along against a score with per-bar feedback, generated exercises, and
on-demand coaching from an LLM. The display must feel instantaneous (a key press that paints
late reads as a wrong note), everything but the coaching must work with no network, and the
instrument is the sound source, so the application never synthesizes audio.

Four forces shape the stack choice:

- **Notation rendering is the hardest UI problem here, and it is solved best on the web.**
  VexFlow and OpenSheetMusicDisplay are the mature engraving libraries; nothing native on
  Windows comes close without a license fee.
- **MIDI input on Windows is a solved problem in two places:** Chromium's Web MIDI API, and
  RtMidi (Windows Multimedia) through a Node binding. Both deliver sub-5 ms input latency; the
  real latency budget is spent in the render loop, not the transport.
- **The machine already runs Node 22, and two sibling repositories on it (Ritmolux's studio,
  market-analyzer's desktop) have settled Electron conventions that have held through large
  applications.** Copying a shipped shell beats designing one.
- **The musical logic — pitch spelling, chord and key detection, score alignment, exercise
  generation, summarising a take for the coach — is pure computation** that must be unit-tested
  against fixtures, and must not depend on a window or a device to run.

The user's interview answers fix the rest: Windows first, USB MIDI primary, standard staff plus
an on-screen keyboard plus chord labels, local files only, Electron + TypeScript.

## Decision

We will build **one npm project at the repository root** in TypeScript, shaped as an Electron
application with three processes and a fourth, process-free package:

- **`core/`** — a pure TypeScript library with **no Electron, no DOM and no Node APIs**: music
  theory (via `tonal`), the MIDI event model, chord and key detection, the note timeline derived
  from a score, alignment of a played take against that timeline, the exercise generator, and the
  `TakeSummary` the coach receives. It is the only place domain logic lives, and Vitest tests it
  against committed fixtures. Both the main process and the renderer import it.
- **Main** (`electron/`) owns the OS and the devices: it enumerates and opens MIDI ports through
  `@julusian/midi` (RtMidi), timestamps every event at arrival, parses raw bytes into a typed
  `MidiEvent`, records takes to disk under `userData`, spawns the coach provider (ADR-0002), and
  owns dialogs, menu and window state. It holds no UI state.
- **Preload** exposes one `window.api` assembled from per-domain modules, the only place Node
  capabilities cross the context bridge.
- **Renderer** (`renderer/`) is a React single-page application that never imports Node. It
  paints the keyboard, the staff (ADR-0003), the labels, the score and the coach panel, and it
  talks to main only through `window.api`.

**MIDI is owned by main, not by the renderer's Web MIDI.** Main receives the bytes, stamps them
with a monotonic clock, and forwards typed events over one push channel; the renderer never sees
a raw byte. The `MidiSource` interface in main has one implementation today (RtMidi over USB) and
is the seam for a 5-pin DIN interface or a Bluetooth MIDI adapter later, without the renderer
knowing.

We adopt the shell conventions already proven in the sibling repositories **verbatim where
nothing here contradicts them**: main and preload bundled with `esbuild`, the renderer with Vite;
four `tsconfig` files (main, preload, renderer, core-and-tests) with `strict` on; `npm` with a
committed lockfile and **every direct dependency pinned exact** (`X.Y.Z`); `contextIsolation`,
`sandbox`, no `nodeIntegration`; the Content Security Policy set as both the `<meta>` tag and the
stripping response header, **with no `connect-src`**, because the renderer makes no network call;
IPC channel names as constants in `shared/`, every payload validated with Zod at the boundary;
Vitest rather than Jest; Playwright for one golden-path end-to-end test; electron-builder
producing a portable zip. The divergence from the studio is that there is no sidecar and no
protocol to mirror: the domain channels are `midi:*` (port list and one push channel carrying a
`MidiEvent`), `take:*` (recording control and retrieval) and `coach:*` (ADR-0002). A new domain
channel is a design decision, not a casual edit.

## Consequences

### Positive

- **Notation is a library import**, not a project.
- **The core is testable without a piano.** Every feature that matters — chord naming, alignment,
  exercise scoring, the coach summary — runs in Vitest on fixtures, and a regression is a failing
  test rather than a feeling at the keyboard.
- **The renderer has no network and no Node**, which is the smallest surface for an application
  that also holds an API key (in main, never in the renderer).
- **Recording survives the window.** Because main owns the device, a take keeps recording while
  the window is minimised or a dialog is open.
- **Nothing about the shell is invented here.** The build, the configs and the security lines come
  from two shipped applications.

### Negative

- **A native module.** `@julusian/midi` is a compiled binding. It targets N-API (version 7), so
  one prebuilt binary serves every Node and Electron release that supports that N-API level and
  an Electron upgrade does not by itself require a rebuild; but a compiled dependency is still a
  thing that can fail to install on a new machine, and `electron-builder` must be told to include
  its binary. The fallback is named in Alternative B and costs a day.
- **Every MIDI event crosses IPC.** At piano rates (rarely above 50 events per second, with
  bursts to 200 in fast passages with pedal) this is far below anything Electron strains at, but
  the latency is measured in Plan 0001 rather than assumed, with a stated budget in `docs/nfr.md`.
- **Electron is heavy.** A 100 MB install and 150 MB idle memory for a single-user tool. Accepted:
  the user chose it, and the notation libraries are the reason.

### Neutral

- The project is one npm project, not a workspace. `core/` is a directory with its own tsconfig,
  not a published package; if a tablet port ever happens, extracting it is mechanical.

## Alternatives considered

### Alternative A — Tauri with a Rust backend (`midir`) and the same web UI
Smaller binary, Rust for the device layer, and the user has a Rust toolchain. Rejected because
nothing here needs Rust's performance — MIDI is kilobytes per minute — while Tauri's IPC and
plugin story is younger than Electron's and neither sibling repository has conventions for it.
The cost of rediscovering the shell outweighs the binary size.

### Alternative B — Web MIDI in the renderer, no native module
Chromium's Web MIDI works in Electron with zero native dependencies and handles hot-plug. It was
the closest call. Rejected as the primary path because it puts the device in the renderer, which
is the process the conventions keep OS-free; it stops recording when the window is hidden; and
its timestamps are taken in the renderer rather than at arrival. **It stays the named fallback**
if the native binding fails to install or behaves badly on the CK88: the `MidiSource` seam is
where it would plug in, and a thin renderer-side forwarder would be the only new code.

### Alternative C — Python desktop (mido + Qt)
The best music-analysis libraries (music21) are Python. Rejected because notation rendering in
Qt is the project, and the coaching and alignment logic here does not need music21's corpus
tooling. `tonal` covers the theory the tutor needs.

## Notes

The reference implementations for the adopted conventions are Ritmolux's ADR-0178 (the studio
shell conventions) and `../trading/market-analyzer/desktop/`, both outside this repository and
cited as worked examples. The double-CSP header hook and the `ELECTRON_RENDERER_URL` contract are
the two pieces worth copying line by line.
