import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// eslint-disable-next-line no-undef
const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'
console.log('Gemma Raus build', BUILD_ID)

if ('serviceWorker' in navigator) {
  // Force a fresh JS load after a new deploy without a manual hard-refresh. Each
  // deploy stamps a new SW cache name (see Dockerfile), so a new SW installs,
  // skipWaiting()s and claims clients → controllerchange fires → we reload once
  // and the page picks up the new Vite content-hashed bundle. Guarded so it never
  // reloads on the very first visit (no prior controller) or loops.
  let refreshing = false
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing || !hadController) return
    refreshing = true
    window.location.reload()
  })
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
    // A long-lived PWA session may never reload — re-check for a new SW whenever
    // the tab regains focus so deploys still reach open installs.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        navigator.serviceWorker.getRegistration()
          .then(reg => { if (reg) reg.update() })
          .catch(() => {})
      }
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
