import React, { Suspense, lazy, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { preloadThreadedSandModule } from './sand/wasmBridge/moduleSelector.js'
import './index.css'

const path = typeof window !== 'undefined' ? window.location.pathname.replace(/\/+$/, '') : ''
const isGame = path === '/game'

// Code-split the two top-level pages so /game (the fullscreen sand game) doesn't
// pull the portfolio bundle (three.js, etc.) and the portfolio doesn't pull the
// game page. Start the selected page request before React renders; on portfolio
// routes, start the hero's sand element independently so it downloads alongside
// App instead of waiting for App -> Hero -> useEffect.
const pageModule = isGame ? import('./GamePage.jsx') : import('./App.jsx')
if (!isGame) void import('./sand/embed/sandGame.js')
preloadThreadedSandModule()
const Page = lazy(() => pageModule)

function BootSignal() {
  useEffect(() => {
    window.dispatchEvent(new Event('portfolio:booted'))
  }, [])
  return null
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <Suspense fallback={null}>
    <Page />
    <BootSignal />
  </Suspense>,
)
