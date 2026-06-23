// External JS — inline scripts are blocked by the app's CSP (script-src 'self').
const $  = (id) => document.getElementById(id)
const KEY_STORE = 'gr_admin_key'

// ── formatting helpers ────────────────────────────────────────────────────────

function colorCls(acc) {
  if (acc === null || acc === undefined) return 'none'
  return acc >= 95 ? 'good' : acc >= 85 ? 'mid' : 'bad'
}
function csiCls(v) {
  if (v === null || v === undefined) return 'none'
  return v >= 70 ? 'good' : v >= 40 ? 'mid' : 'bad'
}
function pct(a, decimals = 1) {
  return (a === null || a === undefined) ? null : a.toFixed(decimals) + '%'
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
// opts.csiMode — use CSI color thresholds (≥70 green, ≥40 amber) instead of accuracy thresholds
// opts.sub     — bottom label override

function gauge(value, label, falseAlarms, opts = {}) {
  const R    = 48
  const circ = +(2 * Math.PI * R).toFixed(1)   // 301.6
  const v    = value ?? 0
  const off  = +(circ * (1 - v / 100)).toFixed(1)

  const col = value === null
    ? '#374151'
    : opts.csiMode
      ? (v >= 70 ? '#34D399' : v >= 40 ? '#FBBF24' : '#EF4444')
      : (v >= 95 ? '#34D399' : v >= 85 ? '#FBBF24' : '#EF4444')

  const centerTxt = value === null
    ? (opts.nullText || '—')
    : v.toFixed(1) + '%'

  let bottomLine = ''
  if (opts.sub) {
    bottomLine = `<text x="60" y="84" text-anchor="middle" fill="#4B5563" font-size="8" font-family="ui-monospace,monospace">${opts.sub}</text>`
  } else if (falseAlarms !== null && falseAlarms !== undefined) {
    bottomLine = falseAlarms === 0
      ? `<text x="60" y="84" text-anchor="middle" fill="#34D399" font-size="8" font-family="ui-monospace,monospace">clean ✓</text>`
      : `<text x="60" y="84" text-anchor="middle" fill="#F87171" font-size="8" font-family="ui-monospace,monospace">${falseAlarms} false alarm${falseAlarms !== 1 ? 's' : ''}</text>`
  }

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
        ${bottomLine}
      </svg>
      <div class="gauge-sub">${label}</div>
    </div>`
}

// ── skill breakdown card ──────────────────────────────────────────────────────

function skillBreakdown(key, h) {
  if (!h || !h.total) return ''
  const label     = key.replace('min', ' MIN')
  const correctDry = Math.max(0, (h.total || 0) - (h.false_alarms || 0) - (h.missed || 0) - (h.hits || 0))
  const oneInN     = h.base_rate > 0 ? Math.round(100 / h.base_rate) : null

  const podTxt = h.pod  !== null && h.pod  !== undefined ? `<span class="${csiCls(h.pod)}">${h.pod.toFixed(1)}%</span>`  : '<span class="nodata">no rain events yet</span>'
  const farTxt = h.far  !== null && h.far  !== undefined ? `${h.far.toFixed(1)}%`   : '<span class="nodata">—</span>'
  const csiTxt = h.csi  !== null && h.csi  !== undefined ? `<span class="${csiCls(h.csi)}">${h.csi.toFixed(1)}%</span>`  : '<span class="nodata">not enough rain data yet</span>'

  return `
    <div class="skill-card">
      <div class="skill-title">${label} · slot-by-slot breakdown</div>

      <div class="skill-row">
        <span class="skill-label">Total verified slots</span>
        <span class="skill-val">${h.total.toLocaleString()}</span>
        <span class="skill-note">each slot = one 15-min window that has since elapsed</span>
      </div>

      <div class="skill-divider"></div>

      <div class="skill-row muted-row">
        <span class="skill-label">Correct dry predictions <em>(predicted dry → stayed dry)</em></span>
        <span class="skill-val">${correctDry.toLocaleString()}</span>
        <span class="skill-note warn-note">inflates overall accuracy — Salzburg is dry most of the time</span>
      </div>
      <div class="skill-row hit-row">
        <span class="skill-label">Hits <em>(predicted rain → it actually rained)</em></span>
        <span class="skill-val good">${h.hits ?? 0}</span>
        <span class="skill-note">the only column that proves the model works on rain</span>
      </div>
      <div class="skill-row fa-row">
        <span class="skill-label">False alarms <em>(predicted rain → stayed dry)</em></span>
        <span class="skill-val bad">${h.false_alarms ?? 0}</span>
        <span class="skill-note">we cried wolf</span>
      </div>
      <div class="skill-row miss-row">
        <span class="skill-label">Missed <em>(predicted dry → it actually rained)</em></span>
        <span class="skill-val mid">${h.missed ?? 0}</span>
        <span class="skill-note">we sent someone out in the rain</span>
      </div>

      <div class="skill-divider"></div>

      <div class="skill-row">
        <span class="skill-label">Base rate — how often it actually rained</span>
        <span class="skill-val">${h.base_rate ?? 0}%</span>
        <span class="skill-note">${oneInN ? `about 1 in every ${oneInN} slots` : '—'}</span>
      </div>
      <div class="skill-row">
        <span class="skill-label">Hit Rate (POD) — when rain came, did we predict it?</span>
        <span class="skill-val">${podTxt}</span>
        <span class="skill-note">hits ÷ (hits + missed)</span>
      </div>
      <div class="skill-row">
        <span class="skill-label">False Alarm Ratio — of our "rain" calls that were wrong</span>
        <span class="skill-val">${farTxt}</span>
        <span class="skill-note">false alarms ÷ (hits + false alarms)</span>
      </div>
      <div class="skill-row skill-csi-row">
        <span class="skill-label">Critical Success Index (CSI) — the honest number</span>
        <span class="skill-val">${csiTxt}</span>
        <span class="skill-note">hits ÷ (hits + false alarms + missed) — ignores dry baseline entirely</span>
      </div>
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
        <td class="r nodata" colspan="6">collecting…</td>
      </tr>`
    }
    const csiDisplay = r.csi !== null && r.csi !== undefined
      ? `<span class="${csiCls(r.csi)}">${r.csi.toFixed(1)}%</span>`
      : '<span class="nodata">—</span>'
    return `<tr>
      <td class="label">${h}</td>
      ${accCell(r.accuracy)}
      <td class="r muted">${r.correct}/${r.total}</td>
      <td class="r">${pill(r.false_alarms, 'pill-red')}</td>
      <td class="r">${pill(r.missed, 'pill-amb')}</td>
      <td class="r"><span class="good">${r.hits ?? 0}</span></td>
      <td class="r">${csiDisplay}</td>
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

    <h2>By horizon
      <span class="muted" style="text-transform:none;letter-spacing:0;font-size:.72rem;margin-left:.5rem">
        30-day window &middot; overall accuracy inflated by dry baseline &middot; CSI = honest rain skill
      </span>
    </h2>
    <table>
      <thead>
        <tr>
          <th>horizon</th><th class="r">accuracy</th><th class="r">correct</th>
          <th class="r">false alarms</th><th class="r">missed</th>
          <th class="r">hits</th><th class="r">CSI</th>
        </tr>
      </thead>
      <tbody>${horizonRows}</tbody>
    </table>
    <p class="muted">
      false alarm = predicted rain, stayed dry &nbsp;&middot;&nbsp;
      missed = predicted dry, it rained &nbsp;&middot;&nbsp;
      hits = predicted rain, it rained &nbsp;&middot;&nbsp;
      CSI = hits ÷ (hits + false alarms + missed)
    </p>

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

  // row 1: overall accuracy gauges (inflated by dry baseline)
  const accGauges = `
    <p class="metric-note">Counts every slot including the ~99% that are dry→dry correct. High in Salzburg summers because it rarely rains.</p>
    <div class="gauges">
      ${gauge(h['30min']?.accuracy ?? null, '30 MIN', h['30min']?.false_alarms ?? null)}
      ${gauge(h['60min']?.accuracy ?? null, '60 MIN', h['60min']?.false_alarms ?? null)}
      ${gauge(h['90min']?.accuracy ?? null, '90 MIN', h['90min']?.false_alarms ?? null)}
    </div>`

  // row 2: CSI gauges (rain-only skill, ignores dry baseline)
  const csiGauges = `
    <p class="metric-note">Ignores all the dry→dry correct slots. Only looks at actual rain events: hits ÷ (hits + false alarms + missed). A model that always predicts dry scores 0%.</p>
    <div class="gauges">
      ${gauge(h['30min']?.csi ?? null, '30 MIN', null,
          { csiMode: true, sub: h['30min']?.csi === null ? 'no rain yet' : `${h['30min']?.hits ?? 0} hits` })}
      ${gauge(h['60min']?.csi ?? null, '60 MIN', null,
          { csiMode: true, sub: h['60min']?.csi === null ? 'no rain yet' : `${h['60min']?.hits ?? 0} hits` })}
      ${gauge(h['90min']?.csi ?? null, '90 MIN', null,
          { csiMode: true, sub: h['90min']?.csi === null ? 'no rain yet' : `${h['90min']?.hits ?? 0} hits` })}
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
          const get = hv => row.find(t => t.horizon === hv) || { threshold: 0.1, tuned: false }
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
    <h2 style="margin-top:0;padding-top:0;border-top:none">Overall accuracy · 7-day</h2>
    ${accGauges}

    <h2>Rain detection skill (CSI) · 7-day</h2>
    ${csiGauges}

    ${['30min', '60min', '90min'].map(k => skillBreakdown(k, h[k])).join('')}

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
