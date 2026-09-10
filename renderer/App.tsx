import { useState } from 'react'
import type { MidiPort } from '../shared/midi'
import { Live } from './views/Live'
import { Ports } from './views/Ports'

/**
 * Two views for now: pick a port, then watch it. The port travels as the whole
 * `MidiPort`, not just its id, so the live view can say what it is looking at
 * -- including that it is the harness -- without asking main again.
 */
type View = { name: 'ports' } | { name: 'live'; port: MidiPort }

export function App() {
  const [view, setView] = useState<View>({ name: 'ports' })

  return (
    <main>
      {view.name === 'ports' ? (
        <Ports onOpen={(port) => setView({ name: 'live', port })} />
      ) : (
        <Live key={view.port.id} port={view.port} onStop={() => setView({ name: 'ports' })} />
      )}
    </main>
  )
}
