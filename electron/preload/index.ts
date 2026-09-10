import { contextBridge } from 'electron'
import type { MidiApi } from '../../shared/midi'
import { midi } from './api/midi'

/**
 * The only bridge across `contextIsolation`. One `window.api`, assembled from
 * per-domain modules and typed by the interfaces in `shared/`, which the
 * renderer's `Window` declaration reads: a capability added on one side and
 * not the other fails to compile rather than to run.
 */
const api: { midi: MidiApi } = {
  midi,
}

contextBridge.exposeInMainWorld('api', api)
