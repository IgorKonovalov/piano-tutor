import { contextBridge } from 'electron'
import type { MidiApi } from '../../shared/midi'
import type { PlayerApi } from '../../shared/player'
import type { ScoreApi } from '../../shared/score'
import type { TakeApi } from '../../shared/take'
import { midi } from './api/midi'
import { player } from './api/player'
import { score } from './api/score'
import { take } from './api/take'

/**
 * The only bridge across `contextIsolation`. One `window.api`, assembled from
 * per-domain modules and typed by the interfaces in `shared/`, which the
 * renderer's `Window` declaration reads: a capability added on one side and
 * not the other fails to compile rather than to run.
 */
const api: { midi: MidiApi; take: TakeApi; score: ScoreApi; player: PlayerApi } = {
  midi,
  take,
  score,
  player,
}

contextBridge.exposeInMainWorld('api', api)
