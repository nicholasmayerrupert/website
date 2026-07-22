import { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Start the hero engine alongside the statically imported portfolio entry,
// rather than waiting for App -> Hero -> useEffect. /game has its own HTML entry.
void import('./sand/embed/sandGame.js')

function BootSignal() {
  useEffect(() => {
    window.dispatchEvent(new Event('portfolio:booted'))
  }, [])
  return null
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <>
    <App />
    <BootSignal />
  </>,
)
