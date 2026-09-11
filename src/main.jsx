import { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Start the runtime download alongside the portfolio on every input type.
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
