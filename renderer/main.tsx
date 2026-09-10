import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

const container = document.getElementById('root')
if (container === null) throw new Error('renderer: #root is missing from index.html')

// A missing bridge means the preload bundle did not load. Fail here, loudly,
// rather than let every call site paper over it with `window.api?.`.
if (window.api === undefined) {
  throw new Error('renderer: window.api is missing; the preload bundle did not load')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
