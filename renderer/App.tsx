import { useState } from 'react'
import { Live, type LiveSource, liveSourceKey } from './views/Live'
import { Ports } from './views/Ports'
import { Score } from './views/Score'
import { Takes } from './views/Takes'
import styles from './App.module.css'

/**
 * Ports and Takes are both ways of choosing something to watch; Live is where
 * it is watched, and it does not care which of the two sent it. Score stands
 * apart: it is the piece, not the playing.
 */
type View =
  | { name: 'ports' }
  | { name: 'takes' }
  | { name: 'score' }
  | { name: 'live'; source: LiveSource }

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
        <button
          type="button"
          className={view.name === 'score' ? `${styles.tab} ${styles.current}` : styles.tab}
          aria-current={view.name === 'score'}
          onClick={() => setView({ name: 'score' })}
          data-testid="nav-score"
        >
          Score
        </button>
      </nav>

      <main className={styles.content}>
        {view.name === 'ports' && (
          <Ports onOpen={(port) => watch({ kind: 'port', port }, 'ports')} />
        )}
        {view.name === 'takes' && (
          <Takes onReplay={(take, speed) => watch({ kind: 'replay', take, speed }, 'takes')} />
        )}
        {view.name === 'score' && <Score />}
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
