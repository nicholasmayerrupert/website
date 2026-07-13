import React, { Suspense, lazy, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

// Code-split the two top-level pages so /game (the fullscreen sand game) doesn't
// pull the portfolio bundle (three.js, etc.) and the portfolio doesn't pull the
// game page. The dev server (Vite, appType 'spa') and Cloudflare
// (assets.not_found_handling: single-page-application) both serve index.html for
// /game, and this client-side branch renders the right page.
const App = lazy(() => import('./App.jsx'))
const GamePage = lazy(() => import('./GamePage.jsx'))

const path = typeof window !== 'undefined' ? window.location.pathname.replace(/\/+$/, '') : ''
const isGame = path === '/game'

function BootSignal() {
  useEffect(() => {
    window.dispatchEvent(new Event('portfolio:booted'))
  }, [])
  return null
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <Suspense fallback={null}>
    {isGame ? <GamePage /> : <App />}
    <BootSignal />
  </Suspense>,
)
