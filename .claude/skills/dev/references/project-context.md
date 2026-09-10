# Project context — dev's view

Where things live and the canonical commands. Trust `Glob` and `git` over this when they disagree.

## Repo layout (one npm project at the root)

Intended shape for orientation; trust `Glob` for what exists today. Before Plan 0001 Phase 1
lands there is no `package.json` and only `docs/`, `scripts/`, `.githooks/` and `.claude/` exist.

```
package.json              # exact pins only (scripts/check-pins.mjs), npm, one lockfile
tsconfig.base.json        # strict, noUnusedLocals, noImplicitReturns; the four below extend it
tsconfig.main.json        #   electron/** minus preload, shared/**, core/**   types: node
tsconfig.preload.json     #   electron/preload/**, shared/**                 types: node
tsconfig.renderer.json    #   renderer/**, shared/**, core/**                types: vite/client, jsx
tsconfig.core.json        #   core/** + every *.test.ts(x)                   types: node (vitest)
esbuild.main.mjs          # -> dist/main/index.cjs    (external: electron, @julusian/midi)
esbuild.preload.mjs       # -> dist/preload/index.cjs (external: electron)
vite.config.ts            # renderer -> dist/renderer/, aliases @/* and @shared/* and @core/*
vitest.config.ts          # core + electron (node env) and renderer (jsdom) projects
playwright.config.ts      # the golden path: launch, find the ports view, no network
eslint.config.mjs  .prettierrc.json

core/                     # PURE. No electron, no DOM, no node imports. Vitest + fixtures.
  src/midi/               #   MidiEvent helpers, HeldNotes reducer
  src/theory/             #   spelling, chords, key, staffLayout
  src/score/              #   timeline from a score, alignment, per-bar stats   (Plan 0003)
  src/exercise/           #   generator (seeded), scoring                        (Plan 0004)
  src/coach/              #   TakeSummary builder                                 (Plan 0002)
  fixtures/               #   chords.json, takes/*.jsonl, scores/*.musicxml
electron/
  main.ts                 #   lifecycle: whenReady -> installCsp -> registerIpcHandlers -> createWindow
  window.ts               #   createWindow (security defaults), installCsp (double CSP), paths
  midi/                   #   MidiSource.ts, RtMidiSource.ts, ReplaySource.ts, parse.ts, ports.ts
  take/                   #   Recorder.ts, takeFile.ts
  coach/                  #   CoachProvider.ts, claudeCli.ts, anthropicApi.ts, none.ts, prompt.ts
  ipc/                    #   index.ts (register/cleanup), midiHandlers.ts, takeHandlers.ts, coachHandlers.ts
  preload/                #   index.ts (contextBridge.exposeInMainWorld('api', api)), api/<domain>.ts
renderer/
  index.html              #   carries the <meta> CSP that matches the header
  main.tsx  App.tsx  styles.css
  views/  components/  hooks/
  types/global.d.ts       #   declare global { interface Window { api: ElectronAPI } }
shared/
  ipc-channels.ts         #   IPC_CHANNELS const object; the only place channel strings live
  midi.ts  take.ts  coach.ts  settings.ts   # Zod schemas + z.infer types
scripts/                  # check-doc-links.mjs, check-pins.mjs (Node, no deps)
tests/e2e/                # Playwright specs
docs/  .githooks/  .claude/
```

## Canonical commands (from the repo root)

| Task | Command |
|---|---|
| Install exactly the lockfile | `npm ci` |
| Run with hot reload (Vite + esbuild watch + Electron) | `npm run dev` |
| Build the three bundles | `npm run build` |
| **Per-phase gate** | `npm run typecheck && npm run lint && npm test && node scripts/check-pins.mjs && node scripts/check-doc-links.mjs` |
| **Once per plan, last phase and close** | `npm run test:e2e` |
| Package a portable zip | `npm run package` |

`npm run typecheck` runs `tsc --noEmit` over all four tsconfigs in sequence. A Node type error in
a renderer file, or a JSX error in `electron/`, is the boundary catching a real bug, not noise.

**Hot reload covers the renderer only.** Main and preload are rebuilt by the esbuild watchers,
but Electron must be restarted to load them; if an IPC handler change is not visible, that is why.

## The seams you implement behind

- **`MidiSource`** (`electron/midi/MidiSource.ts`): `listPorts()`, `open(portId)`, `close()`,
  `onMessage(cb: (bytes: Uint8Array, t: number) => void): () => void`. `t` is
  `performance.now()` taken in the callback before anything else. `RtMidiSource` wraps
  `@julusian/midi`; `ReplaySource` reads a take file and re-emits with the recorded timing.
- **`CoachProvider`** (`electron/coach/CoachProvider.ts`): `ask(req: CoachRequest): Promise<CoachReply>`
  where both shapes come from `shared/coach.ts`. A provider that cannot answer throws a typed
  `CoachUnavailable` with a one-line user-facing reason; the handler turns it into
  `{ error }`, never into a retry loop.

A change to either interface's shape is an escalation to architect, not an edit.

## IPC domains (the whole roster)

| Channel | Direction | Payload |
|---|---|---|
| `midi:list-ports` | invoke R→M | → `MidiPort[]` |
| `midi:open` / `midi:close` | invoke R→M | `{ portId }` / none |
| `midi:event` | push M→R | one `MidiEvent` |
| `take:list` / `take:load` / `take:replay` / `take:stop-replay` | invoke R→M | ids and a speed |
| `coach:ask` | invoke R→M | `CoachRequest` → `CoachReply \| { error }` |
| `settings:get` / `settings:set` | invoke R→M | the settings shape minus the API key's value |
| `app:get-info` | invoke R→M | version, provider in use |
| `shell:open-external` | invoke R→M | an allow-listed URL |

Channel names are constants in `shared/ipc-channels.ts`. A domain not in this table is a design
decision for architect.

## Ownership map

`dev` (you): all code. `architect`: `docs/`. `human`: the user at the instrument, a pasted key, a
product call. No sibling implementer.

## Rules you implement against (summary; the architect's best-practices.md is the authority)

- **Renderer never touches the OS or the network**; the CSP has no `connect-src`.
- **Main holds no UI state**; **`core/` imports no process**.
- **Security defaults** on every window; double CSP; `'unsafe-inline'` in `script-src` only while
  Vite is serving, never merely because the build is unpackaged.
- **Validate at the boundary** with Zod, once; trust inside.
- **Stamp at arrival, forward then record, never drop** (NFR 1, 2, 8).
- **Pure, deterministic `core/`** with committed fixtures.
- **Dispose every non-React resource** in the effect cleanup.
- **Exact pins; `npm` only.**
- **The API key never leaves main.**

## NFR rows you will measure

`docs/nfr.md`. Row 1 (latency) is measured with the dev overlay and recorded in the log, never
asserted in CI. Row 2 (no loss) is a replay-fixture test at the `MidiSource` seam. Row 7 (token
budget) is a fixture test on the longest take. Row 8 (durability) is a spawn-and-kill test on the
recorder. Row 9 (pins) is `scripts/check-pins.mjs`.
