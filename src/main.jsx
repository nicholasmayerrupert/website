import { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Fine-pointer desktop loads the hero engine alongside the portfolio entry.
// Small and coarse-pointer devices schedule it after the first portfolio paint.
const eagerSand = !window.matchMedia ||
  window.matchMedia('(min-width: 768px) and (pointer: fine)').matches
if (eagerSand) void import('./sand/embed/sandGame.js')

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
