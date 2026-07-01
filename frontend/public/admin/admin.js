// External JS — inline scripts are blocked by the app's CSP (script-src 'self').
const $  = (id) => document.getElementById(id)
const KEY_STORE = 'gr_admin_key'

// ── formatting ────────────────────────────────────────────────────────────────
const tstr = (t) => t ? new Date(t * 1000).toLocaleString(undefined,
  { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const tday = (t) => t ? new Date(t * 1000).toLocaleDateString(undefined,
  { month: 'short', day: 'numeric' }) : '—'
const n = (v) => (v ?? 0).toLocaleString()
function showErr(m) { $('err').textContent = m }

// F1 from raw counts (dashboard sends counts, not F1)
function f1of(hits, fa, missed) {
  const p = (hits + fa) ? hits / (hits + fa) : 0
  const r = (hits + missed) ? hits / (hits + missed) : 0
  return (p + r) ? 2 * p * r / (p + r) * 100 : 0
}
// realistic colour bands for a 1 km radar nowcast (CSI 20-40 is normal here)
const podCls = (v) => v == null ? 'none' : v >= 50 ? 'good' : v >= 35 ? 'mid' : 'bad'
const farCls = (v) => v == null ? 'none' : v <= 40 ? 'good' : v <= 60 ? 'mid' : 'bad'  // lower = better
const csiCls = (v) => v == null ? 'none' : v >= 35 ? 'good' : v >= 20 ? 'mid' : 'bad'
function cspan(v, cls) { return v == null ? '<span class="none">—</span>' : `<span class="${cls}">${v.toFixed(1)}%</span>` }

const PUSH_STYLE = {
  rain_incoming: { c: '#F87171', bg: 'rgba(248,113,113,.12)', label: 'rain in' },
  gap:           { c: '#60A5FA', bg: 'rgba(96,165,250,.12)',  label: 'gap' },
  rain_clearing: { c: '#34D399', bg: 'rgba(52,211,153,.12)',  label: 'clearing' },
}

// ── main render (single pass over both payloads) ────────────────────────────────
function render(acc, dash) {
  $('gate').style.display = 'none'
  const s  = acc.summary
  const hz = acc.by_horizon
  const r30 = hz['30min'] || {}
  const baseRate = r30.base_rate ?? 0

  // ── 1. status strip ──
  const strip = `
    <div class="cards">
      <div class="card"><div class="k">last forecast</div><div class="v" style="font-size:1rem">${tstr(s.last_forecast_at)}</div></div>
      <div class="card"><div class="k">verified</div><div class="v good">${n(s.verified)}</div></div>
      <div class="card"><div class="k">pending</div><div class="v ${s.pending ? '' : 'none'}">${n(s.pending)}</div></div>
      <div class="card"><div class="k">rain base rate</div><div class="v">${baseRate}%</div></div>
    </div>`

  // ── 2. rain skill scorecard (the hero) ──
  const skillRows = ['30min', '60min', '90min'].map(h => {
    const r = hz[h]
    if (!r || !r.total) return `<tr><td class="label">${h.replace('min','m')}</td><td class="r nodata" colspan="8">collecting…</td></tr>`
    const f1 = f1of(r.hits || 0, r.false_alarms || 0, r.missed || 0)
    return `<tr>
      <td class="label">${h.replace('min','m')}</td>
      <td class="r muted">${n(r.actual_rain)}</td>
      <td class="r"><span class="good">${r.hits ?? 0}</span></td>
      <td class="r"><span class="bad">${r.false_alarms ?? 0}</span></td>
      <td class="r"><span class="mid">${r.missed ?? 0}</span></td>
      <td class="r">${cspan(r.pod, podCls(r.pod))}</td>
      <td class="r">${cspan(r.far, farCls(r.far))}</td>
      <td class="r">${cspan(r.csi, csiCls(r.csi))}</td>
      <td class="r">${cspan(f1, csiCls(f1))}</td>
    </tr>`
  }).join('')

  const insight = (r30.actual_rain)
    ? `At 30 min we catch <b class="${podCls(r30.pod)}">${(r30.pod ?? 0).toFixed(0)}%</b> of rain,
       but <b class="${farCls(r30.far)}">${(r30.far ?? 0).toFixed(0)}%</b> of our rain calls are false.
       Honest skill (CSI) <b class="${csiCls(r30.csi)}">${(r30.csi ?? 0).toFixed(0)}%</b>.`
    : 'Not enough rain events in the window yet.'

  const accLine = ['30min','60min','90min']
    .map(h => hz[h]?.accuracy != null ? hz[h].accuracy.toFixed(0) + '%' : '—').join(' / ')

  const skill = `
    <h2 style="margin-top:2rem">Rain skill · ${acc.window_days}-day</h2>
    <p class="metric-note" style="color:#9CA3AF">${insight}</p>
    <table>
      <thead><tr>
        <th>horizon</th><th class="r">rain</th><th class="r">hits</th>
        <th class="r">false</th><th class="r">missed</th>
        <th class="r">POD</th><th class="r">FAR</th><th class="r">CSI</th><th class="r">F1</th>
      </tr></thead>
      <tbody>${skillRows}</tbody>
    </table>
    <p class="muted">
      POD = of real rain, how much we caught (higher better) ·
      FAR = of our rain calls, how many were false (lower better) ·
      CSI = hits ÷ (hits+false+missed) — the honest number.<br>
      Overall "accuracy" (${accLine}) is <b>inflated</b> by the ~${(100 - baseRate).toFixed(0)}% dry baseline — ignore it, judge by CSI/FAR.
    </p>`

  // ── 3. push activity (what users actually received) ──
  const pushRows = (dash?.push_log || []).slice(0, 12).map(p => {
    const st = PUSH_STYLE[p.type] || { c: '#9CA3AF', bg: 'transparent', label: p.type }
    return `<tr>
      <td class="muted" style="white-space:nowrap">${tstr(p.sent_at)}</td>
      <td><span class="pill" style="color:${st.c};background:${st.bg}">${st.label}</span></td>
      <td class="muted">${p.body_en || ''}</td>
    </tr>`
  }).join('')
  const pushSection = `
    <h2>Push activity <span class="muted" style="text-transform:none;letter-spacing:0;font-size:.72rem;margin-left:.5rem">max ${'3'} / 4 h · city-level</span></h2>
    ${pushRows
      ? `<table><thead><tr><th>sent</th><th>type</th><th>copy (EN)</th></tr></thead><tbody>${pushRows}</tbody></table>`
      : '<p class="muted">No pushes in the recent log.</p>'}`

  // ── 4. actual rainfall (context for CSI) ──
  const rainSection = (() => {
    const hist = dash?.rain_history || []
    if (!hist.length) return ''
    const maxMm = Math.max(...hist.map(r => r.max_mm), 0.5)
    const BAR_W = 16, BAR_H = 48, GAP = 3
    const W = hist.length * (BAR_W + GAP)
    const bars = hist.map((r, i) => {
      const x = i * (BAR_W + GAP)
      const fill = r.max_mm < 0.1 ? '#1a1d24' : r.max_mm < 1 ? '#6CD1EB' : r.max_mm < 5 ? '#1BAEE2' : '#0077AA'
      const bh = r.max_mm < 0.1 ? 2 : Math.max(3, Math.round((r.max_mm / maxMm) * BAR_H))
      const d2 = new Date(r.day * 1000)
      const lbl = (d2.getDate() === 1 || i === 0) ? d2.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''
      return `<rect x="${x}" y="${BAR_H - bh}" width="${BAR_W}" height="${bh}" fill="${fill}" rx="2">
        <title>${tday(r.day)}: ${r.max_mm}mm (${r.rain_slots}/${r.total_slots} wet slots)</title></rect>
        ${lbl ? `<text x="${x}" y="${BAR_H + 10}" font-size="7" fill="#4B5563" font-family="ui-monospace,monospace">${lbl}</text>` : ''}`
    }).join('')
    const rainyDays = hist.filter(r => r.max_mm >= 0.1).length
    return `
      <h2>Actual rainfall · 30-day (sensors)</h2>
      <p class="metric-note">${rainyDays} rainy day${rainyDays !== 1 ? 's' : ''} in the window — if this is sparse, low CSI is expected, not a bug.</p>
      <div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${BAR_H + 14}" width="${W}" height="${BAR_H + 14}" style="display:block;min-width:${W}px">${bars}</svg></div>`
  })()

  // ── 5. calibration + thresholds (compact) ──
  const calibSection = (() => {
    if (!dash) return ''
    const raised = (dash.thresholds || []).filter(t => t.tuned)
    const byPoint = {}
    raised.forEach(t => { (byPoint[t.point] ??= []).push(`${t.horizon}m→${t.threshold.toFixed(2)}`) })
    const raisedHtml = Object.keys(byPoint).length
      ? Object.entries(byPoint).map(([p, xs]) => `<span class="th-badge th-raised" style="margin:.15rem .25rem .15rem 0">${p}: ${xs.join(' ')}</span>`).join('')
      : '<span class="muted">All points at the 0.10 mm floor — no point over-predicts enough to warrant raising.</span>'
    const runs = (dash.calibration?.runs || []).slice(0, 6).map(r => `
      <tr>
        <td class="muted" style="white-space:nowrap">${tday(r.run_at)}</td>
        <td class="label">${r.point}</td>
        <td class="r muted">${r.horizon}m</td>
        <td class="r">${r.old_th?.toFixed(2) ?? '—'} → ${r.new_th?.toFixed(2) ?? '—'}</td>
        <td class="r muted">FA ${r.fa_before ?? '—'}→${r.fa_after ?? '—'}</td>
        <td class="r muted">${r.f1?.toFixed(3) ?? '—'}</td>
      </tr>`).join('')
    return `
      <h2>Calibration <span class="muted" style="text-transform:none;letter-spacing:0;font-size:.72rem;margin-left:.5rem">
        F0.5 (precision-weighted) · floor 0.10 mm · last ${tday(dash.calibration?.last_run)} · next ${tday(dash.calibration?.next_run)}</span></h2>
      <p class="metric-note">Per-point push thresholds. Higher = fewer false "rain incoming" pushes for points that over-predict light rain.</p>
      <div style="margin-bottom:1rem">${raisedHtml}</div>
      ${runs ? `<table><thead><tr><th>run</th><th>point</th><th class="r">hz</th><th class="r">old→new</th><th class="r">false alarms</th><th class="r">score</th></tr></thead><tbody>${runs}</tbody></table>` : ''}`
  })()

  // ── 6. alerts (only if any) ──
  const alertSection = (dash?.alerts?.length)
    ? `<h2>Health alerts</h2>${dash.alerts.map(a => `
        <div class="alert-row">
          <span class="alert-ts">${tday(a.at)}</span>
          <span class="alert-badge">${a.point}/${a.horizon}m</span>
          <span class="alert-txt">${a.accuracy}% → threshold ${(a.old_th||0).toFixed(2)}→${(a.new_th||0).toFixed(2)}</span>
        </div>`).join('')}`
    : ''

  // ── 7. source health (one line, only flag problems) ──
  const srcSection = (() => {
    const src = dash?.source_health || []
    if (!src.length) return ''
    const low = src.filter(x => (x.nowcast_pct ?? 100) < 95)
    return low.length
      ? `<h2>Source health</h2>${low.map(x => `<div class="src-row"><span class="src-name">${x.point}</span><span class="src-pct" style="color:#FBBF24">${x.nowcast_pct}% nowcast · ${x.om_pct}% fallback</span></div>`).join('')}`
      : `<p class="muted" style="margin-top:1.5rem;color:#34D399">✓ Nowcast coverage ≥95% across all ${src.length} points</p>`
  })()

  $('dash').innerHTML = `
    ${strip}
    ${skill}
    ${pushSection}
    ${rainSection}
    ${calibSection}
    ${alertSection}
    ${srcSection}
    <div class="actions">
      <a href="#" id="refresh">refresh</a> &nbsp;&middot;&nbsp; <a href="#" id="logout">logout</a>
    </div>`
  $('dash').style.display = 'block'
  $('refresh').onclick = (e) => { e.preventDefault(); loadAll(sessionStorage.getItem(KEY_STORE)) }
  $('logout').onclick  = (e) => { e.preventDefault(); sessionStorage.removeItem(KEY_STORE); location.reload() }
}

// ── load + auth ─────────────────────────────────────────────────────────────
async function loadAll(key) {
  if (!key) { showErr('Enter the key.'); return }
  showErr('')
  let res
  try { res = await fetch('/api/admin/accuracy', { headers: { 'X-Admin-Key': key } }) }
  catch { showErr('Network error.'); return }
  if (res.status === 401) { showErr('Wrong key.'); sessionStorage.removeItem(KEY_STORE); return }
  if (res.status === 503) { showErr('Admin not configured — set ADMIN_KEY on the server.'); return }
  if (!res.ok)            { showErr('Error ' + res.status); return }
  sessionStorage.setItem(KEY_STORE, key)
  const acc = await res.json()

  let dash = null
  try {
    const dr = await fetch('/api/admin/dashboard', { headers: { 'X-Admin-Key': key } })
    if (dr.ok) dash = await dr.json()
  } catch {}

  render(acc, dash)
}

// ── inactivity auto-logout ────────────────────────────────────────────────────
const INACTIVITY_MS = 30 * 60 * 1000
let _logoutTimer
function _resetInactivity() {
  clearTimeout(_logoutTimer)
  if (sessionStorage.getItem(KEY_STORE)) {
    _logoutTimer = setTimeout(() => { sessionStorage.removeItem(KEY_STORE); location.reload() }, INACTIVITY_MS)
  }
}
;['click', 'keydown', 'mousemove', 'touchstart'].forEach(ev =>
  document.addEventListener(ev, _resetInactivity, { passive: true }))

$('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadAll($('key').value.trim()) })
const saved = sessionStorage.getItem(KEY_STORE)
if (saved) { _resetInactivity(); loadAll(saved) }
