// External JS — inline scripts are blocked by the app's CSP (script-src 'self').
const $  = (id) => document.getElementById(id)
const KEY_STORE = 'gr_admin_key'

function colorCls(acc) {
  if (acc === null || acc === undefined) return 'none'
  return acc >= 75 ? 'good' : acc >= 55 ? 'mid' : 'bad'
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

async function load(key) {
  if (!key) { showErr('Enter the key.'); return }
  showErr('')
  let res
  try {
    res = await fetch('/api/admin/accuracy', { headers: { 'X-Admin-Key': key } })
  } catch { showErr('Network error.'); return }
  if (res.status === 401) { showErr('Wrong key.'); sessionStorage.removeItem(KEY_STORE); return }
  if (res.status === 503) { showErr('Admin not configured — set ADMIN_KEY on the server.'); return }
  if (!res.ok) { showErr('Error ' + res.status); return }
  sessionStorage.setItem(KEY_STORE, key)
  render(await res.json())
}

function render(d) {
  $('gate').style.display = 'none'

  const s  = d.summary
  const hz = d.by_horizon

  // Summary cards
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
          <th>horizon</th>
          <th class="r">accuracy</th>
          <th class="r">correct</th>
          <th class="r">false alarm</th>
          <th class="r">missed</th>
        </tr>
      </thead>
      <tbody>${horizonRows}</tbody>
    </table>
    <p class="muted">
      false alarm = predicted rain, stayed dry &nbsp;&middot;&nbsp;
      missed = predicted dry, it rained
    </p>

    <h2>By point</h2>
    <table>
      <thead>
        <tr>
          <th>point</th>
          <th class="r">accuracy</th>
          <th class="r">correct</th>
        </tr>
      </thead>
      <tbody>${pointRows}</tbody>
    </table>

    <div class="actions">
      <a href="#" id="refresh">refresh</a>
      &nbsp;&middot;&nbsp;
      <a href="#" id="logout">logout</a>
    </div>`

  $('dash').style.display = 'block'
  $('refresh').onclick = (e) => { e.preventDefault(); load(sessionStorage.getItem(KEY_STORE)) }
  $('logout').onclick  = (e) => { e.preventDefault(); sessionStorage.removeItem(KEY_STORE); location.reload() }
}

$('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') load($('key').value.trim()) })
const saved = sessionStorage.getItem(KEY_STORE)
if (saved) load(saved)
