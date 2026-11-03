import React from 'react'
import ReactDOM from 'react-dom/client'
import PublicJournal from './PublicJournal'
import './styles.css'

// The public route never mounts the private journal or initializes its Firebase session.
const App = React.lazy(() => import('./App'))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {location.pathname === '/view' || location.pathname === '/view/' ? (
      <PublicJournal />
    ) : (
      <React.Suspense fallback={<p role="status">Loading your journal…</p>}>
        <App />
      </React.Suspense>
    )}
  </React.StrictMode>,
)
