// Debug overlay (?debug=1) — a framework-free diagnostic panel for reproducing
// "rapid refresh" / reload-loop reports from real devices in the field.
//
// Deliberately NOT a React component: it has to survive and explain a blank
// white screen (a failed mount, a reload loop that never lets React settle),
// which rules out anything that depends on React having rendered at all. It
// is a no-op unless the URL carries ?debug=1 — every exported function is a
// cheap guard-and-return in production.
//
// What it captures:
//  - every visibilitychange / pageshow / pagehide / freeze / resume /
//    beforeunload firing, with event.persisted where relevant (the bfcache
//    signal iOS uses that a plain visibilitychange listener can miss)
//  - service worker lifecycle: registration state, updatefound, installing
//    worker statechange, controllerchange
//  - a running fetch counter with per-call timestamps (network-call storms
//    are the usual signature of a reload loop re-fetching everything)
//  - explicit RELOAD markers, logged by the caller *before* navigating away,
//    so the reason survives the reload itself
//
// The log is mirrored into sessionStorage so it survives an actual reload —
// the overlay on the NEXT load opens already showing why the PREVIOUS one
// ended, which is the one piece of forensics a live console can't give you
// once the page has already gone.
const ENABLED = (() => {
  try { return new URLSearchParams(location.search).get('debug') === '1' } catch { return false }
})()

const LOG_KEY = 'gr_debug_log'
const MAX_ENTRIES = 300

function loadLog() {
  try { return JSON.parse(sessionStorage.getItem(LOG_KEY) || '[]') } catch { return [] }
}
function saveLog(list) {
  try { sessionStorage.setItem(LOG_KEY, JSON.stringify(list.slice(-MAX_ENTRIES))) } catch {}
}

let entries = ENABLED ? loadLog() : []
let panelEl = null, listEl = null, countsEl = null
let fetchCount = 0

function fmtTime(ts) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:`
    + `${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

function ensurePanel() {
  if (panelEl || !ENABLED || !document.body) return
  panelEl = document.createElement('div')
  panelEl.id = 'gr-debug-overlay'
  panelEl.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:999999',
    'max-height:38vh', 'overflow-y:auto', '-webkit-overflow-scrolling:touch',
    'background:rgba(8,8,8,0.94)', 'color:#5CFF7A', 'font:10px/1.4 "JetBrains Mono",monospace',
    'padding:6px 8px calc(6px + env(safe-area-inset-bottom,0px))',
    'border-top:2px solid #5CFF7A', 'white-space:pre-wrap', 'word-break:break-all',
    'pointer-events:auto',
  ].join(';')

  const header = document.createElement('div')
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;color:#B9FFC6;font-weight:bold;'
  const title = document.createElement('span')
  title.textContent = 'GR DEBUG ?debug=1'
  const btns = document.createElement('span')
  const mkBtn = (label, fn) => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = 'margin-left:8px;background:#111;color:#5CFF7A;border:1px solid #5CFF7A;padding:1px 6px;font:10px monospace;border-radius:3px;'
    b.onclick = fn
    return b
  }
  btns.appendChild(mkBtn('clear', () => { entries = []; saveLog(entries); render() }))
  btns.appendChild(mkBtn('hide', () => { panelEl.style.display = 'none'; showTab() }))
  header.appendChild(title)
  header.appendChild(btns)

  countsEl = document.createElement('div')
  countsEl.style.cssText = 'color:#9ecbff;margin-bottom:4px;'
  listEl = document.createElement('div')

  panelEl.appendChild(header)
  panelEl.appendChild(countsEl)
  panelEl.appendChild(listEl)
  document.body.appendChild(panelEl)
}

// A small always-visible re-open tab, so "hide" doesn't lose the panel for good.
let tabEl = null
function showTab() {
  if (tabEl || !document.body) return
  tabEl = document.createElement('button')
  tabEl.textContent = 'GR DBG'
  tabEl.style.cssText = [
    'position:fixed', 'right:6px', 'bottom:calc(6px + env(safe-area-inset-bottom,0px))',
    'z-index:999999', 'background:#111', 'color:#5CFF7A', 'border:1px solid #5CFF7A',
    'padding:3px 7px', 'font:10px "JetBrains Mono",monospace', 'border-radius:4px', 'opacity:0.85',
  ].join(';')
  tabEl.onclick = () => { tabEl.remove(); tabEl = null; panelEl.style.display = 'block' }
  document.body.appendChild(tabEl)
}

function render() {
  if (!ENABLED) return
  ensurePanel()
  if (!panelEl) return
  const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null
  const swState = sw?.controller ? `controller:${sw.controller.state || 'active'}` : 'no-controller'
  // eslint-disable-next-line no-undef
  const build = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'
  countsEl.textContent =
    `build=${build}  sw=${swState}  fetches=${fetchCount}  vis=${document.visibilityState}  `
    + `standalone=${window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true}`
  listEl.textContent = entries.slice(-80).map(e => `${fmtTime(e.t)} ${e.tag ? '[' + e.tag + '] ' : ''}${e.msg}`).join('\n')
  listEl.scrollTop = listEl.scrollHeight
}

export function dbgLog(msg, tag = '') {
  if (!ENABLED) return
  entries.push({ t: Date.now(), msg, tag })
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES)
  saveLog(entries)
  render()
}

// Call this immediately before any window.location.reload() so the reason is
// on record even though the reload itself wipes all in-memory state.
export function dbgReload(reason) {
  dbgLog(`RELOAD TRIGGERED: ${reason}`, 'reload')
}

if (ENABLED) {
  dbgLog(entries.length > 1 ? 'boot — resumed session log (page reloaded)' : 'boot — fresh session', 'init')

  document.addEventListener('visibilitychange', () => dbgLog(`visibilitychange -> ${document.visibilityState}`, 'lifecycle'))
  window.addEventListener('pageshow', (e) => dbgLog(`pageshow persisted=${e.persisted}`, 'lifecycle'))
  window.addEventListener('pagehide', (e) => dbgLog(`pagehide persisted=${e.persisted}`, 'lifecycle'))
  window.addEventListener('freeze', () => dbgLog('freeze (bfcache)', 'lifecycle'))
  window.addEventListener('resume', () => dbgLog('resume (bfcache)', 'lifecycle'))
  window.addEventListener('beforeunload', () => dbgLog('beforeunload', 'lifecycle'))
  window.addEventListener('online', () => dbgLog('online', 'network'))
  window.addEventListener('offline', () => dbgLog('offline', 'network'))

  // Fetch counter — wrapped once; every call (ours and any library's) is
  // counted and timestamped. A reload loop that keeps re-fetching everything
  // shows up here as a fetch burst immediately followed by a RELOAD marker.
  if (window.fetch && !window.fetch.__grWrapped) {
    const real = window.fetch.bind(window)
    const wrapped = (...args) => {
      fetchCount++
      const raw = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '[request]')
      const url = raw.length > 80 ? raw.slice(0, 80) + '…' : raw
      dbgLog(`fetch #${fetchCount} ${url}`, 'fetch')
      return real(...args)
    }
    wrapped.__grWrapped = true
    window.fetch = wrapped
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => dbgLog('navigator.serviceWorker controllerchange fired', 'sw'))
    navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg) { dbgLog('no SW registration found yet', 'sw'); return }
      const tag = w => w ? `state=${w.state}` : 'none'
      dbgLog(`registration: active=${tag(reg.active)} waiting=${tag(reg.waiting)} installing=${tag(reg.installing)}`, 'sw')
      reg.addEventListener('updatefound', () => {
        dbgLog('updatefound', 'sw')
        const nw = reg.installing
        nw?.addEventListener('statechange', () => dbgLog(`installing worker -> ${nw.state}`, 'sw'))
      })
    }).catch(() => {})
  }

  // Periodic repaint so counts/visibility state stay live even with no new events.
  setInterval(render, 2000)
}
