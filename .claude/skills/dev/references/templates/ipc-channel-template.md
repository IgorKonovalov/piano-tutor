# Adding an IPC channel — checklist

A channel is a long-lived decision: removing one later breaks a consumer. Before adding one, ask
two questions. **Is it a new domain?** The roster is `midi`, `take`, `coach`, `settings`, `app`,
`shell` (see `dev/references/project-context.md`); a new domain is architect's decision, not a
checklist item. **Does it belong in main at all?** If the renderer could compute it from what it
already has (a chord name from held notes), it is a `core/` call in the renderer, not a channel.

If a channel is right, walk every step.

## 1. Constant in `shared/ipc-channels.ts`

```ts
export const IPC_CHANNELS = {
  // …existing
  TAKE_REPLAY: 'take:replay', // R→M invoke
} as const
```

`<domain>:<action>`, lowercase kebab-case.

## 2. Zod schemas in `shared/<domain>.ts`

```ts
import { z } from 'zod'

export const TakeReplayRequestSchema = z.object({
  takeId: z.string().min(1).max(128),
  speed: z.union([z.literal(0.5), z.literal(1), z.literal(2)]).default(1),
})
export type TakeReplayRequest = z.infer<typeof TakeReplayRequestSchema>

export const TakeReplayResponseSchema = z.object({ started: z.literal(true) })
export type TakeReplayResponse = z.infer<typeof TakeReplayResponseSchema>
```

Narrow types. A schema exists even for an "obviously trusted" shape; the handler trusts this and
nothing else.

## 3. Handler in `electron/ipc/<domain>Handlers.ts`

```ts
import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { TakeReplayRequestSchema } from '../../shared/take'

export function registerTakeHandlers(deps: { replay: ReplaySource }) {
  ipcMain.handle(IPC_CHANNELS.TAKE_REPLAY, async (_event, payload: unknown) => {
    const req = TakeReplayRequestSchema.parse(payload) // throw → invoke rejects in the renderer
    await deps.replay.start(req.takeId, req.speed)
    return { started: true as const }
  })
}

export function cleanupTakeHandlers() {
  ipcMain.removeHandler(IPC_CHANNELS.TAKE_REPLAY)
}
```

Handlers take their collaborators as parameters; they do not construct a `MidiSource` or read
settings themselves.

## 4. Preload binding in `electron/preload/api/<domain>.ts`

```ts
import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import type { TakeReplayRequest, TakeReplayResponse } from '../../../shared/take'

export const take = {
  replay: (req: TakeReplayRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAKE_REPLAY, req) as Promise<TakeReplayResponse>,
}
```

## 5. Merge and register

`electron/preload/index.ts` already spreads the per-domain modules into `api` and exposes it;
`electron/ipc/index.ts` already calls each `register…` and each `cleanup…`. A new domain touches
both; a new action in an existing domain touches neither.

## 6. A push channel (M→R) differs in step 4

The binding subscribes and returns the cleanup; it validates on receive:

```ts
onEvent(cb: (e: MidiEvent) => void): () => void {
  const handler = (_: unknown, raw: unknown) => cb(MidiEventSchema.parse(raw))
  ipcRenderer.on(IPC_CHANNELS.MIDI_EVENT, handler)
  return () => ipcRenderer.off(IPC_CHANNELS.MIDI_EVENT, handler)
}
```

And main sends with `win.webContents.send(IPC_CHANNELS.MIDI_EVENT, event)` after checking
`!win.isDestroyed()`.

## 7. Test what has logic

A handler that only parses and forwards needs no test beyond the schema's. A parser, a reducer,
a recorder, a replay scheduler does; put the test beside the file.
