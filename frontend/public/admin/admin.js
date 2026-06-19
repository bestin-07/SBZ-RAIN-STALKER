// External so it satisfies the app's CSP (script-src 'self'; inline is blocked).
const $ = (id) => document.getElementById(id)
const KEY_STORE = 'gr_admin_key'

function cls(acc) {
  if (acc === null || acc === undefined) return 'none'
  if (acc >= 75) return 'good'; if (acc >= 55) return 'mid'; return 'bad'
}
function pct(a) { return a === null || a === undefined ? '—' : a + '%' }
function tstr(t) { return t ? new Date(t * 1000).toLocaleString() : '—' }

function showErr(m) { const e = $('err'); e.textContent = m; e.style.display = 'block' }

async function load(key) {
  if (!key) { showErr('Enter the key.'); return }
  $('err').style.display = 'none'
  let res
  try {
    res = await fetch('/api/admin/accuracy', { headers: { 'X-Admin-Key': key } })
  } catch { showErr('Network error.'); return }
  if (res.status === 401) { showErr('Wrong key.'); sessionStorage.removeItem(KEY_STORE); return }
  if (res.status === 503) { showErr('Admin not configured (set ADMIN_KEY on the server, then redeploy).'); return }
  if (!res.ok) { showErr('Error ' + res.status); return }
  const d = await res.json()
  sessionStorage.setItem(KEY_STORE, key)
  render(d)
}

function render(d) {
  $('gate').style.display = 'none'
  const s = d.summary
  const hz = d.by_horizon
  const horizonRows = Object.keys(hz).map(h => {
    const r = hz[h]
    return `<tr><td>${h}</td>
      <td class="num acc ${cls(r.accuracy)}">${pct(r.accuracy)}</td>
      <td class="num">${r.correct}/${r.total}</td>
      <td class="num">${r.false_alarms}</td>
      <td class="num">${r.missed}</td></tr>`
  }).join('')
  const pointRows = Object.keys(d.by_point).map(p => {
    const r = d.by_point[p]
    return `<tr><td>${p}</td>
      <td class="num acc ${cls(r.accuracy)}">${pct(r.accuracy)}</td>
      <td class="num">${r.correct}/${r.total}</td></tr>`
  }).join('')

  $('dash').innerHTML = `
    <div class="cards">
      <div class="card"><div class="k">verified</div><div class="v">${s.verified}</div></div>
      <div class="card"><div class="k">pending</div><div class="v">${s.pending}</div></div>
      <div class="card"><div class="k">total rows</div><div class="v">${s.total_rows}</div></div>
    </div>
    <p class="muted">Window: last ${d.window_days} days · dry threshold ${d.dry_threshold} mm · last forecast ${tstr(s.last_forecast_at)}</p>

    <h2>By horizon</h2>
    <table><thead><tr><th>horizon</th><th class="num">accuracy</th><th class="num">correct</th><th class="num">false alarm</th><th class="num">missed</th></tr></thead>
    <tbody>${horizonRows}</tbody></table>
    <p class="muted">false alarm = predicted rain, stayed dry · missed = predicted dry, it rained</p>

    <h2>By point</h2>
    <table><thead><tr><th>point</th><th class="num">accuracy</th><th class="num">correct</th></tr></thead>
    <tbody>${pointRows}</tbody></table>

    <p class="muted" style="margin-top:2rem"><a href="#" id="refresh">refresh</a> · <a href="#" id="logout">logout</a></p>`
  $('dash').style.display = 'block'
  $('refresh').onclick = (e) => { e.preventDefault(); load(sessionStorage.getItem(KEY_STORE)) }
  $('logout').onclick = (e) => { e.preventDefault(); sessionStorage.removeItem(KEY_STORE); location.reload() }
}

$('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') load($('key').value.trim()) })
const saved = sessionStorage.getItem(KEY_STORE)
if (saved) load(saved)
