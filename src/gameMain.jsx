import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import GamePage from './GamePage.jsx'

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
