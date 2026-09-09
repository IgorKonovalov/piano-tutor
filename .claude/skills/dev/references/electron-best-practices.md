# Electron best practices — dev

The mechanics behind the rules. `SKILL.md` and the architect's `best-practices.md` say what; this
file says how, with the patterns lifted from `../trading/market-analyzer/desktop/` and Ritmolux's
studio conventions, adjusted for a shell whose domain traffic is a MIDI stream crossing IPC
rather than HTTP to a sidecar. Read on demand.

## The three bundles and four tsconfigs

Main and preload are bundled by esbuild to CommonJS (`dist/main/index.cjs`,
`dist/preload/index.cjs`) with `electron` external, and for main also `@julusian/midi` (a native
module cannot be bundled). The renderer is bundled by Vite. Four tsconfigs extend one base; each
`include`s only its own directory plus `shared/` (and `core/` where allowed), so a renderer file
importing `node:fs` fails typecheck. That is the boundary working.

`ELECTRON_RENDERER_URL` set means main loads the Vite dev server; unset means it loads
`dist/renderer/index.html`. `app.isPackaged` decides only the CSP relaxation, never which file
loads.

## Security: the window and the double CSP

```ts
// electron/window.ts — the shape to copy, not to redesign
new BrowserWindow({
  show: false,
  webPreferences: {
    preload: preloadPath,            // the BUILT bundle, never a .ts path
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
})
win.once('ready-to-show', () => win.show())
win.webContents.on('will-navigate', (e) => e.preventDefault())
win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
```

The CSP is set twice. Once as `<meta http-equiv="Content-Security-Policy">` in
`renderer/index.html`, and once in `session.defaultSession.webRequest.onHeadersReceived`, which
**strips any incoming `content-security-policy` header case-insensitively** (Vite sends it
lower-case) before writing ours. This project's policy has **no `connect-src`**: the renderer
makes no network request. `'unsafe-inline'` in `script-src` only when `!app.isPackaged`, because
Vite's HMR needs it. If you see a CSP violation in dev that does not exist packaged, it is Vite;
the other way round is a real bug, usually an inline handler.

## IPC: invoke and push

The renderer calls `window.api.<domain>.<action>(payload)` and gets a Promise. Under it is
`ipcRenderer.invoke(channel, payload)`; the main handler `ipcMain.handle(channel, (_, payload) =>
…)` parses with Zod and returns or throws (a throw rejects the renderer's Promise).

### Adding a channel, in order

1. **`shared/ipc-channels.ts`** — the constant: `MIDI_OPEN: 'midi:open'`.
2. **`shared/<domain>.ts`** — the Zod schema for the request and the response, and the
   `z.infer` types beside them.
3. **`electron/ipc/<domain>Handlers.ts`** — the handler. `Schema.parse(payload)` first, then the
   work. A `cleanup<Domain>Handlers()` that `removeHandler`s, called from `before-quit`.
4. **`electron/preload/api/<domain>.ts`** — the binding, typed from the schema.
5. `electron/preload/index.ts` merges the module; `electron/ipc/index.ts` registers it. Usually
   nothing new.

### Push channels (main to renderer)

```ts
// electron/preload/api/midi.ts
export const midi = {
  onEvent(cb: (e: MidiEvent) => void): () => void {
    const handler = (_: unknown, raw: unknown) => cb(MidiEventSchema.parse(raw))
    ipcRenderer.on(IPC_CHANNELS.MIDI_EVENT, handler)
    return () => ipcRenderer.off(IPC_CHANNELS.MIDI_EVENT, handler)
  },
}
```

```tsx
// renderer/hooks/useMidiEvents.ts
useEffect(() => window.api.midi.onEvent(dispatch), [dispatch])
```

The `return` of the cleanup is the contract. A listener without a stored cleanup accumulates
across mounts and fires twice after the first hot reload.

**The event rate is not a concern for `webContents.send`.** Piano playing peaks around 200
messages per second in a pedalled run; Electron's IPC handles thousands. What costs is the
*renderer* doing work per message. Reduce to state (`HeldNotes`) and paint the state.

### What is not IPC

Anything the renderer could compute from what it already has. Chord names come from `core/` in
the renderer, not from a `theory:detect` channel. Anything that belongs in main (a port, a file,
a child process) is IPC by construction; anything that does not is not.

## Non-React resources: create once, dispose on unmount

VexFlow's renderer and context, a canvas `ResizeObserver`, a timer, a `MessagePort`:

```tsx
const hostRef = useRef<HTMLDivElement>(null)
const vfRef = useRef<VexFlowHandle | null>(null)

// Effect 1: instance lifecycle. Empty deps; runs once.
useEffect(() => {
  if (!hostRef.current) return
  const vf = createGrandStaff(hostRef.current)
  vfRef.current = vf
  return () => { vf.dispose(); vfRef.current = null }
}, [])

// Effect 2: data. Runs on change; never recreates the instance.
useEffect(() => { vfRef.current?.draw(held) }, [held])
```

Combining the two effects recreates the instance on every data change: a memory leak that also
flickers. Keep creation and data separate.

## The four async states

Every view that loads something (the takes list, a score, a coach reply) shows all four states in
the code: **loading**, **error** with the action that failed and a retry, **empty** ("no takes
yet"), **populated**. A spinner that never resolves is the most common failure; give the coach
request a timeout in main and surface it as an error.

## CSS Modules

One `.module.css` per component, co-located. Tokens as custom properties in
`renderer/styles.css` (`--space-2`, `--color-fg`, `--color-key-pressed`); hex codes scattered in
component CSS are the refactor smell. Conditional classes with a three-line `cx()` helper, not a
dependency.

## Vite versus Electron

- Renderer assets are `http://localhost:5173/...` in dev and `file://.../dist/renderer/` packaged.
  Use `import.meta.env` and imported asset URLs; never hard-code `file://`.
- `process.env.NODE_ENV` does not exist in the renderer; use `import.meta.env.DEV`.
- `process.resourcesPath` is main's; if the renderer needs a packaged resource, it goes through IPC.
- Hot reload covers the renderer. After a main or preload change, restart Electron.

## The native module

`@julusian/midi` is N-API and ships prebuilt binaries, so no `electron-rebuild`. Two things to
get right: it is `external` in the esbuild main config, and `electron-builder` must include
`node_modules/@julusian/midi/**` in `files` (`asarUnpack` it) so the `.node` binary is on disk.
If `npm ci` cannot fetch a prebuilt for this platform, stop: ADR-0001 Alternative B is the
architect's call.

## Common mistakes caught in review

- `useEffect` with a missing dependency silenced without a comment.
- Appending every `MidiEvent` to a React state array and re-rendering the keyboard per event.
- `window.api?.midi` — the `?.` hides a preload that failed to load. Throw loudly.
- `as MidiEvent` on anything that crossed a boundary. Parse it.
- A `fetch` in the renderer "just for the coach". The coach lives in main.
- `new Date()` inside `core/`. Time is an input.
- A latency number asserted in a Vitest test. It is a measurement; log it.
- `spawn('claude ' + prompt, { shell: true })`. Argument arrays, never a shell string.
- A dependency added with `npm install foo` and left as `^x.y.z`. Pin it.
