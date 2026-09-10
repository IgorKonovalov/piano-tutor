import type { MidiApi } from '../../shared/midi'

declare global {
  interface Window {
    /**
     * Injected by the preload bundle through `contextBridge`. It is never
     * optional: if it is missing the preload failed to load, and the app
     * should fail loudly rather than degrade behind a `?.`.
     */
    api: {
      midi: MidiApi
    }
  }
}

export {}
