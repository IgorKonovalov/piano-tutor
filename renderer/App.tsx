import { useState } from 'react'
import { Live, type LiveSource, liveSourceKey } from './views/Live'
import { Ports } from './views/Ports'
import { Takes } from './views/Takes'
import styles from './App.module.css'

/**
 * Three views. Ports and Takes are both ways of choosing something to watch;
 * Live is where it is watched, and it does not care which of the two sent it.
 */
type View = { name: 'ports' } | { name: 'takes' } | { name: 'live'; source: LiveSource }

export function App() {
  const [view, setView] = useState<View>({ name: 'ports' })
  const [lastChooser, setLastChooser] = useState<'ports' | 'takes'>('ports')

  const watch = (source: LiveSource, from: 'ports' | 'takes') => {
    setLastChooser(from)
    setView({ name: 'live', source })
  }

  return (
    <div className={styles.app}>
      <nav className={styles.nav} aria-label="Views">
        <button
          type="button"
          className={view.name === 'ports' ? `${styles.tab} ${styles.current}` : styles.tab}
          aria-current={view.name === 'ports'}
          onClick={() => setView({ name: 'ports' })}
          data-testid="nav-ports"
        >
          Ports
        </button>
        <button
          type="button"
          className={view.name === 'takes' ? `${styles.tab} ${styles.current}` : styles.tab}
          aria-current={view.name === 'takes'}
          onClick={() => setView({ name: 'takes' })}
          data-testid="nav-takes"
        >
          Takes
        </button>
      </nav>

      <main className={styles.content}>
        {view.name === 'ports' && (
          <Ports onOpen={(port) => watch({ kind: 'port', port }, 'ports')} />
        )}
        {view.name === 'takes' && (
          <Takes onReplay={(take, speed) => watch({ kind: 'replay', take, speed }, 'takes')} />
        )}
        {view.name === 'live' && (
          <Live
            key={liveSourceKey(view.source)}
            source={view.source}
            onStop={() =>
              setView(lastChooser === 'ports' ? { name: 'ports' } : { name: 'takes' })
            }
          />
        )}
      </main>
    </div>
  )
}
