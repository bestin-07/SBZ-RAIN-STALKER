// External JS — inline scripts are blocked by the app's CSP (script-src 'self').
const $  = (id) => document.getElementById(id)
const KEY_STORE = 'gr_admin_key'

// ── formatting helpers ────────────────────────────────────────────────────────

function colorCls(acc) {
  if (acc === null || acc === undefined) return 'none'
  return acc >= 95 ? 'good' : acc >= 85 ? 'mid' : 'bad'
}
function pct(a) {
  return (a === null || a === undefined) ? null : a + '%'
}
function tstr(t) {
  if (!t) return '—'
  return new Date(t * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
function tstrShort(t) {
  if (!t) return '—'
  return new Date(t * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric' })
}
function accCell(acc) {
  const p = pct(acc)
  if (!p) return '<td class="r nodata">—</td>'
  const cls  = colorCls(acc)
  const fill = `background:${cls === 'good' ? '#34D399' : cls === 'mid' ? '#FBBF24' : '#F87171'}`
  return `
    <td class="r">
      <div class="acc-wrap">
        <div class="bar-track"><div class="bar-fill" style="width:${acc}%;${fill}"></div></div>
        <span class="acc-pct ${cls}">${p}</span>
      </div>
    </td>`
}
function pill(n, type) {
  if (n === 0) return `<span class="pill pill-0">0</span>`
  return `<span class="pill ${type}">${n}</span>`
}
function showErr(m) { $('err').textContent = m }

// ── circular gauge SVG ────────────────────────────────────────────────────────

function gauge(accuracy, label, falseAlarms) {
  const R    = 48
  const circ = +(2 * Math.PI * R).toFixed(1)   // 301.6
  const acc  = accuracy ?? 0
  const off  = +(circ * (1 - acc / 100)).toFixed(1)
  const col  = accuracy === null ? '#374151'
    : acc >= 95 ? '#34D399'
    : acc >= 85 ? '#FBBF24' : '#EF4444'
  const centerTxt = accuracy === null ? '—' : acc.toFixed(1) + '%'
  const faLabel   = falseAlarms === 0
    ? `<text x="60" y="84" text-anchor="middle" fill="#34D399" font-size="8" font-family="ui-monospace,monospace">clean ✓</text>`
    : `<text x="60" y="84" text-anchor="middle" fill="#F87171" font-size="8" font-family="ui-monospace,monospace">${falseAlarms} false alarm${falseAlarms !== 1 ? 's' : ''}</text>`

  return `
    <div class="gauge-wrap">
      <svg viewBox="0 0 120 120" width="140" height="140">
        <circle class="track" cx="60" cy="60" r="${R}" fill="none" stroke="#1a1c22" stroke-width="9"/>
        <circle class="arc"   cx="60" cy="60" r="${R}" fill="none" stroke="${col}" stroke-width="9"
          stroke-dasharray="${circ}" stroke-dashoffset="${off}"
          stroke-linecap="round" transform="rotate(-90 60 60)"/>
        <text x="60" y="55" text-anchor="middle" fill="#E7EAF0"
              font-size="18" font-weight="700" font-family="ui-monospace,monospace">${centerTxt}</text>
        <text x="60" y="70" text-anchor="middle" fill="#6B7280"
              font-size="9" font-family="ui-monospace,monospace">${label}</text>
        ${falseAlarms !== null ? faLabel : ''}
      </svg>
      <div class="gauge-sub">${label}</div>
    </div>`
}

// ── threshold badge ───────────────────────────────────────────────────────────

function thBadge(val, tuned) {
  if (!tuned) return `<span class="th-badge th-default">${val.toFixed(2)} default</span>`
  const raised = val > 0.1
  return `<span class="th-badge ${raised ? 'th-raised' : ''}">${val.toFixed(2)}${raised ? ' ↑' : ''}</span>`
}

// ── render existing accuracy data ─────────────────────────────────────────────

function render(d) {
  $('gate').style.display = 'none'

  const s  = d.summary
  const hz = d.by_horizon

  const hasData = s.verified > 0

  const horizonRows = Object.keys(hz).map(h => {
    const r = hz[h]
    if (!r.total) {
      return `<tr>
        <td class="label">${h}</td>
        <td class="r nodata" colspan="4">collecting…</td>
      </tr>`
    }
    return `<tr>
      <td class="label">${h}</td>
      ${accCell(r.accuracy)}
      <td class="r muted">${r.correct}/${r.total}</td>
      <td class="r">${pill(r.false_alarms, 'pill-red')}</td>
      <td class="r">${pill(r.missed, 'pill-amb')}</td>
    </tr>`
  }).join('')

  const pointRows = Object.keys(d.by_point).map(p => {
    const r = d.by_point[p]
    if (!r.total) {
      return `<tr>
        <td class="label">${p}</td>
        <td class="r nodata" colspan="2">collecting…</td>
      </tr>`
    }
    return `<tr>
      <td class="label">${p}</td>
      ${accCell(r.accuracy)}
      <td class="r muted">${r.correct}/${r.total}</td>
    </tr>`
  }).join('')

  $('dash').innerHTML = `
    <div id="dashboard-section"></div>

    <div class="cards">
      <div class="card">
        <div class="k">verified</div>
        <div class="v ${s.verified > 0 ? 'good' : 'none'}">${s.verified}</div>
      </div>
      <div class="card">
        <div class="k">pending</div>
        <div class="v ${s.pending > 0 ? '' : 'none'}">${s.pending}</div>
      </div>
      <div class="card">
        <div class="k">total rows</div>
        <div class="v">${s.total_rows}</div>
      </div>
    </div>
    <p class="muted">
      Last ${d.window_days}-day window &middot;
      dry threshold ${d.dry_threshold} mm &middot;
      last forecast ${tstr(s.last_forecast_at)}
      ${!hasData ? '&middot; <em>first verification arrives ~30 min after deploy</em>' : ''}
    </p>

    <h2>By horizon</h2>
    <table>
      <thead>
        <tr>
          <th>horizon</th><th class="r">accuracy</th><th class="r">correct</th>
          <th class="r">false alarm</th><th class="r">missed</th>
        </tr>
      </thead>
      <tbody>${horizonRows}</tbody>
    </table>
    <p class="muted">false alarm = predicted rain, stayed dry &nbsp;&middot;&nbsp; missed = predicted dry, it rained</p>

    <h2>By point</h2>
    <table>
      <thead>
        <tr><th>point</th><th class="r">accuracy</th><th class="r">correct</th></tr>
      </thead>
      <tbody>${pointRows}</tbody>
    </table>

    <div class="actions">
      <a href="#" id="refresh">refresh</a>
      &nbsp;&middot;&nbsp;
      <a href="#" id="logout">logout</a>
    </div>`

  $('dash').style.display = 'block'
  $('refresh').onclick = (e) => { e.preventDefault(); loadAll(sessionStorage.getItem(KEY_STORE)) }
  $('logout').onclick  = (e) => {
    e.preventDefault()
    sessionStorage.removeItem(KEY_STORE)
    location.reload()
  }
}

// ── render calibration dashboard ──────────────────────────────────────────────

function renderDashboard(d) {
  const el = $('dashboard-section')
  if (!el) return

  const h = d.health

  // health gauges
  const gaugesHtml = `
    <h2 style="margin-top:0;padding-top:0;border-top:none">Forecast health · 7-day</h2>
    <div class="gauges">
      ${gauge(h['30min']?.accuracy ?? null, '30 MIN', h['30min']?.false_alarms ?? null)}
      ${gauge(h['60min']?.accuracy ?? null, '60 MIN', h['60min']?.false_alarms ?? null)}
      ${gauge(h['90min']?.accuracy ?? null, '90 MIN', h['90min']?.false_alarms ?? null)}
    </div>`

  // calibration table
  const lastRun  = d.calibration.last_run
  const nextRun  = d.calibration.next_run
  const runsHtml = d.calibration.runs.length === 0
    ? '<p class="muted">No calibration runs yet — first run after 7 days of data.</p>'
    : `<table>
        <thead>
          <tr>
            <th>run</th><th>point</th><th class="r">horizon</th>
            <th class="r">old</th><th class="r">new</th>
            <th class="r">samples</th><th class="r">FA before→after</th><th class="r">F1</th>
          </tr>
        </thead>
        <tbody>
          ${d.calibration.runs.map(r => `
            <tr>
              <td class="muted" style="white-space:nowrap">${tstrShort(r.run_at)}</td>
              <td class="label">${r.point}</td>
              <td class="r muted">${r.horizon}m</td>
              <td class="r">${r.old_th !== null ? r.old_th.toFixed(2) : '—'}</td>
              <td class="r">${thBadge(r.new_th ?? 0.1, r.new_th !== r.old_th)}</td>
              <td class="r muted">${r.samples ?? '—'}</td>
              <td class="r">
                <span class="pill pill-red" style="font-size:.72rem">${r.fa_before ?? '—'}</span>
                →
                <span class="pill ${(r.fa_after ?? 0) === 0 ? 'pill-0' : 'pill-red'}" style="font-size:.72rem">${r.fa_after ?? '—'}</span>
              </td>
              <td class="r muted">${r.f1 !== null ? r.f1.toFixed(3) : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`

  // active thresholds grid
  const points = [...new Set(d.thresholds.map(t => t.point))]
  const thHtml = `
    <table>
      <thead>
        <tr><th>point</th><th class="r">30 min</th><th class="r">60 min</th><th class="r">90 min</th></tr>
      </thead>
      <tbody>
        ${points.map(pt => {
          const row = d.thresholds.filter(t => t.point === pt)
          const get = h => row.find(t => t.horizon === h) || { threshold: 0.1, tuned: false }
          return `<tr>
            <td class="label">${pt}</td>
            <td class="r">${thBadge(get(30).threshold, get(30).tuned)}</td>
            <td class="r">${thBadge(get(60).threshold, get(60).tuned)}</td>
            <td class="r">${thBadge(get(90).threshold, get(90).tuned)}</td>
          </tr>`
        }).join('')}
      </tbody>
    </table>`

  // alerts
  const alertsHtml = d.alerts.length === 0
    ? '<p class="muted" style="color:#34D399;font-size:.8rem">✓ No alerts triggered</p>'
    : d.alerts.map(a => `
        <div class="alert-row">
          <span class="alert-ts">${tstrShort(a.at)}</span>
          <span class="alert-badge">${a.point} / ${a.horizon}min</span>
          <span class="alert-txt">${a.accuracy}% accuracy → threshold ${(a.old_th||0).toFixed(2)}→${(a.new_th||0).toFixed(2)}</span>
        </div>`).join('')

  // source health
  const srcHtml = d.source_health.map(s => `
    <div class="src-row">
      <span class="src-name">${s.point}</span>
      <div class="src-track"><div class="src-fill" style="width:${s.nowcast_pct ?? 0}%"></div></div>
      <span class="src-pct good">${s.nowcast_pct !== null ? s.nowcast_pct + '% geo' : '—'}</span>
      <span class="src-pct" style="color:#FBBF24">${s.om_pct !== null && s.om_pct > 0 ? s.om_pct + '% om' : ''}</span>
    </div>`).join('')

  el.innerHTML = `
    ${gaugesHtml}

    <h2>Active thresholds
      <span class="muted" style="text-transform:none;letter-spacing:0;font-size:.72rem;margin-left:.5rem">
        last calibration: ${tstr(lastRun)} &middot; next: ${tstr(nextRun)}
      </span>
    </h2>
    ${thHtml}

    <h2>Calibration runs</h2>
    ${runsHtml}

    <h2>Accuracy alerts</h2>
    ${alertsHtml}

    <h2>Source health · 7-day</h2>
    ${srcHtml}
  `
}

// ── load + auth ───────────────────────────────────────────────────────────────

async function loadAll(key) {
  if (!key) { showErr('Enter the key.'); return }
  showErr('')
  let res
  try {
    res = await fetch('/api/admin/accuracy', { headers: { 'X-Admin-Key': key } })
  } catch { showErr('Network error.'); return }
  if (res.status === 401) { showErr('Wrong key.'); sessionStorage.removeItem(KEY_STORE); return }
  if (res.status === 503) { showErr('Admin not configured — set ADMIN_KEY on the server.'); return }
  if (!res.ok)            { showErr('Error ' + res.status); return }
  sessionStorage.setItem(KEY_STORE, key)
  render(await res.json())

  // Load calibration dashboard alongside
  try {
    const dr = await fetch('/api/admin/dashboard', { headers: { 'X-Admin-Key': key } })
    if (dr.ok) renderDashboard(await dr.json())
  } catch {}
}

// ── inactivity auto-logout ────────────────────────────────────────────────────

const INACTIVITY_MS = 30 * 60 * 1000
let _logoutTimer

function _resetInactivity() {
  clearTimeout(_logoutTimer)
  if (sessionStorage.getItem(KEY_STORE)) {
    _logoutTimer = setTimeout(() => {
      sessionStorage.removeItem(KEY_STORE)
      location.reload()
    }, INACTIVITY_MS)
  }
}

;['click', 'keydown', 'mousemove', 'touchstart'].forEach(ev =>
  document.addEventListener(ev, _resetInactivity, { passive: true })
)

$('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadAll($('key').value.trim()) })
const saved = sessionStorage.getItem(KEY_STORE)
if (saved) { _resetInactivity(); loadAll(saved) }
