import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { dbgLog, dbgReload } from './debug'

// eslint-disable-next-line no-undef
const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'
console.log('Gemma Raus build', BUILD_ID)

// ─────────────────────────────────────────────────────────────────────────────
// Keeping installed apps current (v2.31).
//
// The service-worker path below is the primary mechanism and it works — but it has
// two failure modes that matter for an app people install and leave on a home
// screen for weeks:
//
//   1. It only ever CHECKS on a visibility change. A PWA left open on a desk, or
//      resumed from iOS's back/forward cache (which fires `pageshow`, not always
//      `visibilitychange`), can sit on week-old JS indefinitely.
//   2. It depends entirely on service-worker semantics. If the registration is
//      wedged — and iOS has a long history of exactly that — there is no path back.
//
// So there is a second, independent check that needs no service worker at all:
// every deploy writes `/version.json` carrying the same DEPLOY_TS that is compiled
// into this bundle as __BUILD_ID__. If the served build id differs from the one we
// are running, this bundle is stale and we reload onto the new one.
//
// The loop guard matters more than the check. If a reload does NOT resolve the
// mismatch (a proxy pinning old HTML, a wedged cache), reloading again would trap
// the user in a refresh loop with no way out — far worse than stale JS. So each
// target build is attempted exactly ONCE per tab, recorded in sessionStorage.
const UPDATE_EVERY_MS = 15 * 60 * 1000

async function checkForNewBuild() {
  if (BUILD_ID === 'dev') return          // vite dev server serves no version.json
  try {
    const r = await fetch('/version.json', { cache: 'no-store' })
    if (!r.ok) return
    const { build } = await r.json()
    if (!build || build === BUILD_ID) return
    // Attempt each target build once per tab, never twice.
    let tried = null
    try { tried = sessionStorage.getItem('gr_reloaded_for') } catch {}
    if (tried === build) return
    try { sessionStorage.setItem('gr_reloaded_for', build) } catch {}
    console.log('Gemma Raus: new build', build, '- reloading from', BUILD_ID)
    dbgReload(`version.json build ${build} != running ${BUILD_ID}`)
    window.location.reload()
  } catch {
    // Offline or the endpoint is missing: not an update, nothing to do.
  }
}

function refreshWorker() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.getRegistration()
    .then(reg => { if (reg) reg.update() })
    .catch(() => {})
}

// Check whenever the app comes back to the foreground. Both events are needed:
// Android fires `visibilitychange`, and an iOS PWA restored from the page cache
// fires `pageshow` with persisted=true and may not fire the former at all.
function onResume() {
  if (document.visibilityState !== 'visible') return
  dbgLog('onResume: visible -> refreshWorker + checkForNewBuild', 'lifecycle')
  refreshWorker()
  checkForNewBuild()
}
document.addEventListener('visibilitychange', onResume)
window.addEventListener('pageshow', onResume)
// …and on a timer, for the install that simply stays open. Jittered so a deploy
// does not bring every open client back at the same instant.
setInterval(onResume, UPDATE_EVERY_MS + Math.floor(Math.random() * 60 * 1000))

if ('serviceWorker' in navigator) {
  // Force a fresh JS load after a new deploy without a manual hard-refresh. Each
  // deploy stamps a new SW cache name (see Dockerfile), so a new SW installs,
  // skipWaiting()s and claims clients → controllerchange fires → we reload once
  // and the page picks up the new Vite content-hashed bundle. Guarded so it never
  // reloads on the very first visit (no prior controller) or loops.
  let refreshing = false
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    dbgLog(`controllerchange: refreshing=${refreshing} hadController=${hadController}`, 'sw')
    if (refreshing || !hadController) return
    refreshing = true
    dbgReload('SW controllerchange (new SW took control)')
    window.location.reload()
  })
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// One check on boot, after first paint, so a stale install lands on the current
// build immediately rather than waiting for the first resume.
window.addEventListener('load', () => { setTimeout(checkForNewBuild, 2000) })

// ─────────────────────────────────────────────────────────────────────────────
// Real visible height (v2.36.8).
//
// CSS `100dvh` (index.css) is meant to track a mobile browser's own collapsing
// toolbar, but it's the BROWSER that decides when it's settled — and this page
// never scrolls by design (v2.36.1), which is exactly the gesture some mobile
// browsers use to decide the toolbar can collapse. Live report: the bottom of
// the app was cropped behind a browser's own bottom bar with no way to reach
// it, since the app has no scroll to fall back on.
//
// window.visualViewport.height is the browser's own live answer to "how much
// is actually visible right now" — updated continuously, and a more reliable
// signal across browsers/webviews than the CSS unit alone. Synced onto a
// custom property that index.css's height rules read ahead of the dvh/percent
// fallback, so nothing changes anywhere dvh was already correct, and the app
// self-corrects anywhere it wasn't. Guarded for browsers without
// visualViewport (Safari < 13, some older Android WebViews): falls back to
// window.innerHeight/resize, which is the same value dvh itself degrades to.
function syncViewportHeight() {
  const h = window.visualViewport?.height ?? window.innerHeight
  document.documentElement.style.setProperty('--app-vh', `${h}px`)
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncViewportHeight)
  window.visualViewport.addEventListener('scroll', syncViewportHeight)
} else {
  window.addEventListener('resize', syncViewportHeight)
}
syncViewportHeight()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
