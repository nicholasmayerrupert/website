import { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import GamePage from './GamePage.jsx'

const eagerGameSand = !window.matchMedia ||
  !window.matchMedia('(max-width: 767px), (pointer: coarse)').matches
if (eagerGameSand) void import('./sand/embed/sandGame.js')

function BootSignal() {
  useEffect(() => {
    window.dispatchEvent(new Event('portfolio:booted'))
  }, [])
  return null
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <>
    <GamePage />
    <BootSignal />
  </>,
)
