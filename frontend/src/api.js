const OPEN_METEO     = 'https://api.open-meteo.com/v1/forecast'
const GEOSPHERE_TAWES = 'https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min'
// GeoSphere nowcast: radar-extrapolation forecast at 1 km / 15-min steps,
// +3 h horizon. This is the finest-resolution rain timeline available here —
// it catches convective alpine rain the Open-Meteo ICON-EU model lags on, at
// the user's exact grid cell. Replaces both the WAF-blocked DWD RADOLAN source
// and the coarse hourly INCA analysis.
const GEOSPHERE_NOWCAST = 'https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/nowcast-v1-15min-1km'
const BACKEND        = import.meta.env.VITE_BACKEND_URL ?? ''

// Salzburg Airport (TAWES 11150) — central, reliable. Always queried as an
// anchor so a hyper-local convective cell near the city is never missed even
// if the user's nearest stations happen to be dry.
const ANCHOR_STATION_ID = '11150'

// ---- Response cache (cuts API calls + survives failures) ----------------------
// Keyed by request. Within TTL we return the cached response without a network
// call; on a failed fetch (e.g. GeoSphere rate limit) we serve the last good
// response instead of losing data. TTL < the 5-min refresh so live data still
// updates, but bursts (taps, re-opens, nearby points) reuse the cache.
const _respCache = new Map()
const RESP_TTL = 4 * 60 * 1000

// For fns that return null on failure: serve fresh cache, else fetch, else stale.
async function cachedOrNull(key, fetcher) {
  const now = Date.now()
  const hit = _respCache.get(key)
  if (hit && now - hit.ts < RESP_TTL) return hit.data
  let data = null
  try { data = await fetcher() } catch { data = null }
  if (data != null) { _respCache.set(key, { data, ts: now }); return data }
  return hit ? hit.data : null   // serve stale rather than lose data
}

export const AREAS = [
  // inner-city districts — fill the centre between the surrounding-town ring
  { name: "Lehen",          lat: 47.8100, lon: 13.0200 },  // NW-central
  { name: "Gnigl",          lat: 47.8140, lon: 13.0730 },  // NE
  { name: "Nonntal",        lat: 47.7883, lon: 13.0553 },  // S-central
  // surrounding towns
  { name: "Hallein",         lat: 47.6835, lon: 13.0965 },
  { name: "Grödig",         lat: 47.7283, lon: 13.0432 },
  { name: "Anif",           lat: 47.7432, lon: 13.0632 },
  { name: "Berchtesgaden",  lat: 47.6317, lon: 13.0009 },
  { name: "Bad Reichenhall",lat: 47.7247, lon: 12.8753 },
  { name: "Freilassing",    lat: 47.8366, lon: 12.9699 },
  { name: "Wals",           lat: 47.7922, lon: 12.9724 },
  { name: "Bergheim",       lat: 47.8375, lon: 13.0375 },
  { name: "Elixhausen",     lat: 47.8600, lon: 13.0600 },
  { name: "Seekirchen",     lat: 47.9021, lon: 13.1316 },
  { name: "Oberndorf",      lat: 47.9412, lon: 12.9384 },
  { name: "Eugendorf",      lat: 47.8567, lon: 13.1067 },
]

// ---- Backend ambient snapshot (temp/wind/code/cape/uv + hourly precip prob) ----
// One shared server call for the whole grid; clients pick the nearest point (GPS
// stays in the browser). Prevents every user hitting Open-Meteo directly (rate
// limits / shared NAT). Cached ~90s. Returns points[] or null.
let _ambientPoints = null, _ambientPointsTs = 0
async function fetchAmbient() {
  const now = Date.now()
  if (_ambientPoints && now - _ambientPointsTs < 90 * 1000) return _ambientPoints
  try {
    const r = await fetch(`${BACKEND}/api/ambient`, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) return _ambientPoints
    const j = await r.json()
    if (Array.isArray(j?.points) && j.points.length) { _ambientPoints = j.points; _ambientPointsTs = now; return j.points }
    return _ambientPoints   // empty before first cycle → let caller fall back to direct OM
  } catch { return _ambientPoints }
}
function nearestAmbientPoint(points, lat, lon) {
  let best = null, bd = Infinity
  for (const p of points) {
    const d = haversineKm(lat, lon, p.lat, p.lon)
    if (d < bd) { bd = d; best = p }
  }
  return best
}
// Shape an ambient point into the Open-Meteo response subset the app reads.
function ambientToData(pt) {
  return {
    current: {
      precipitation:  pt.precip ?? 0,
      temperature_2m: pt.temp ?? null,
      wind_speed_10m: pt.wind ?? null,
      weather_code:   pt.code ?? null,
      cape:           pt.cape ?? null,
      uv_index:       pt.uv ?? null,
    },
    hourly: { time: pt.ptime ?? [], precipitation_probability: pt.pprob ?? [] },
    // 15-min series so the ribbon still draws when the GeoSphere nowcast is down.
    minutely_15: { time: pt.mtime ?? [], precipitation: pt.mprecip ?? [] },
  }
}

export async function fetchForecast(lat, lon) {
  // Prefer the backend ambient snapshot (no per-user Open-Meteo). Fall back to a
  // direct Open-Meteo call only if the snapshot isn't available (backend down /
  // not warmed up yet) — so behaviour is unchanged when the backend can't serve it.
  const points = await fetchAmbient()
  const pt = points ? nearestAmbientPoint(points, +lat, +lon) : null
  if (pt) return ambientToData(pt)

  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: 'temperature_2m,wind_speed_10m,weather_code,precipitation,cape,uv_index',
    minutely_15: 'precipitation',
    forecast_minutely_15: 48,
    // Hourly rain probability — a smooth model-confidence signal used to soften
    // the radar countdown when the nowcast shows rain the model isn't sure about.
    hourly: 'precipitation_probability',
    forecast_hours: 6,
    timeformat: 'unixtime',
    timezone: 'UTC',
  })
  // Cached with serve-stale-on-failure. fetchForecast is expected to throw on a
  // hard failure (callers use allSettled), so only throw when there's no stale copy.
  const key = `fc:${(+lat).toFixed(3)},${(+lon).toFixed(3)}`
  const now = Date.now()
  const hit = _respCache.get(key)
  if (hit && now - hit.ts < RESP_TTL) return hit.data
  try {
    const r = await fetch(`${OPEN_METEO}?${params}`)
    if (!r.ok) throw new Error(`Open-Meteo error ${r.status}`)
    const data = await r.json()
    _respCache.set(key, { data, ts: now })
    return data
  } catch (e) {
    if (hit) return hit.data   // serve stale rather than lose data
    throw e
  }
}

// ---- GeoSphere Austria TAWES — dynamic nearest-station discovery ----
// Metadata gives us all ~270 Austrian stations with coordinates.
// We find the 3 closest to the user and take the max RR across them.
// RR = precipitation sum (mm) over the last 10 minutes — actual measurement, not a forecast.

let _tawesStations = null // cached for the session

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, r = Math.PI / 180
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function tawesNearestIds(lat, lon, n = 6) {
  if (!_tawesStations) {
    try {
      const r = await fetch(`${GEOSPHERE_TAWES}/metadata`, { signal: AbortSignal.timeout(8000) })
      if (!r.ok) return [ANCHOR_STATION_ID]
      const meta = await r.json()
      const raw = meta?.stations ?? []
      // Live metadata: meta.stations is an array of objects with id/lat/lon and
      // an is_active flag. Drop decommissioned stations — they return null RR
      // and would otherwise crowd out a live station from the nearest set.
      _tawesStations = (Array.isArray(raw)
        ? raw.map(s => ({ id: String(s.id), lat: +s.lat, lon: +s.lon, active: s.is_active !== false }))
        : Object.entries(raw).map(([id, v]) => ({
            id,
            lat: Array.isArray(v) ? +v[0] : +v.lat,
            lon: Array.isArray(v) ? +v[1] : +v.lon,
            active: true,
          }))
      ).filter(s => s.id && s.active && isFinite(s.lat) && isFinite(s.lon))
    } catch {
      return [ANCHOR_STATION_ID]
    }
  }
  if (!_tawesStations.length) return [ANCHOR_STATION_ID]
  // Cap at 15 km: a mountain station 20+ km away can be raining while the
  // city is dry — including it in the MAX reading causes false WAIT status.
  // If fewer than 2 stations fall within 15 km, fall back to the 2 nearest
  // regardless of distance so we always have something to compare.
  const sorted = [..._tawesStations]
    .map(s => ({ id: s.id, dist: haversineKm(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.dist - b.dist)
  const withinCap = sorted.filter(s => s.dist <= 15)
  const candidates = (withinCap.length >= 2 ? withinCap : sorted).slice(0, n).map(s => s.id)
  // Always include the airport anchor so a cell over the city is caught even
  // when the user's nearest stations are dry.
  return candidates.includes(ANCHOR_STATION_ID) ? candidates : [...candidates, ANCHOR_STATION_ID]
}

// Returns { precip, temp } — both from actual sensor readings, not model.
// precip = max RR across nearest stations (mm / 10 min).
// temp   = average TL across stations that report it (°C), null if none.
export async function fetchNearbyStationPrecip(lat, lon) {
  return cachedOrNull(`tawes:${(+lat).toFixed(3)},${(+lon).toFixed(3)}`, async () => {
    const ids = await tawesNearestIds(lat, lon, 6)
    const r = await fetch(
      `${GEOSPHERE_TAWES}?parameters=RR,TL&station_ids=${ids.join(',')}`,
      { signal: AbortSignal.timeout(6000) }
    )
    if (!r.ok) return null
    const features = (await r.json())?.features ?? []
    const rrVals = features
      .map(f => f?.properties?.parameters?.RR?.data?.[0])
      .filter(v => typeof v === 'number' && !isNaN(v))
    const tlVals = features
      .map(f => f?.properties?.parameters?.TL?.data?.[0])
      .filter(v => typeof v === 'number' && !isNaN(v))
    if (!rrVals.length && !tlVals.length) return null   // nothing usable → let cache serve stale
    return {
      precip: rrVals.length ? Math.max(...rrVals) : null,
      temp:   tlVals.length ? +(tlVals.reduce((a, b) => a + b, 0) / tlVals.length).toFixed(1) : null,
    }
  })
}

// ---- GeoSphere nowcast — 1 km / 15-min radar-extrapolation timeline ----
// The primary gap-detection source: a +3 h precipitation forecast at the user's
// exact 1 km grid cell, in 15-min steps. Same GeoSphere host as TAWES (no CORS /
// no WAF block). Returns { times:[unix seconds], precips:[mm] } or null.
// (param name is lowercase `rr`; unit kg/m² = mm.)
export async function fetchNowcastTimeline(lat, lon) {
  return cachedOrNull(`nc:${(+lat).toFixed(3)},${(+lon).toFixed(3)}`, async () => {
    const r = await fetch(
      `${GEOSPHERE_NOWCAST}?parameters=rr&lat_lon=${lat},${lon}`,
      { signal: AbortSignal.timeout(6000) }
    )
    if (!r.ok) return null
    const data = await r.json()
    const ts = data?.timestamps ?? []
    const rr = data?.features?.[0]?.properties?.parameters?.rr?.data ?? []
    if (!ts.length || ts.length !== rr.length) return null
    const times = ts.map(s => Math.floor(Date.parse(s) / 1000))
    const precips = rr.map(v => (typeof v === 'number' && !isNaN(v)) ? v : 0)
    return { times, precips }
  })
}

export async function fetchAccuracy() {
  if (!BACKEND) return null
  try {
    const r = await fetch(`${BACKEND}/api/accuracy`, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) return null
    return r.json()
  } catch {
    return null
  }
}

const RAINVIEWER_WEATHER_MAPS = 'https://api.rainviewer.com/public/weather-maps.json'
const ALLOWED_RV_TILE_HOST = 'https://tilecache.rainviewer.com'

// Sample the latest RainViewer radar tile at the user's exact lat/lon.
// Returns 0.3 (above dry threshold) if radar sees rain, 0 if clear, null on
// any error (CORS not available, tile fetch failed, etc.). This is the fastest
// "is it raining right now?" signal — it uses the same radar frames displayed
// on the map but reads the pixel at the user's GPS position directly.
export function fetchRainViewerPrecip(lat, lon) {
  return fetch(RAINVIEWER_WEATHER_MAPS, { signal: AbortSignal.timeout(5000) })
    .then(r => r.ok ? r.json() : null)
    .then(mapData => {
      if (!mapData) return null
      const past = mapData.radar?.past ?? []
      if (!past.length) return null

      const frame = past[past.length - 1]
      const rawHost = mapData.host
      const host = typeof rawHost === 'string' && /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/.test(rawHost)
        ? rawHost : ALLOWED_RV_TILE_HOST

      // Web-Mercator tile + pixel coordinates at z=7 (~1.2 km/px, matching
      // RainViewer's native radar resolution — maxNativeZoom 7 in RadarMap.jsx).
      const z = 7, n = 1 << z
      const tileX = Math.floor((lon + 180) / 360 * n)
      const latRad = lat * Math.PI / 180
      const mercY = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2
      const tileY = Math.floor(mercY * n)
      const px = Math.floor(((lon + 180) / 360 * n - tileX) * 256)
      const py = Math.floor((mercY * n - tileY) * 256)

      const tileUrl = `${host}${frame.path}/256/${z}/${tileX}/${tileY}/2/1_1.png`

      // Timeout wrapper so a slow tile server doesn't block the whole loadData cycle
      const imgPromise = new Promise(resolve => {
        const img = new Image()
        // crossOrigin='anonymous' requests CORS headers. If RainViewer responds
        // with Access-Control-Allow-Origin, we can read pixel data. If not,
        // onerror fires (browser treats missing CORS as a load failure) → null.
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          const canvas = document.createElement('canvas')
          canvas.width = 256; canvas.height = 256
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0)
          try {
            // Sample a 5×5 pixel block (~700 m box at z7) centred on the user's
            // pixel and take the max echo — catches a small cell sitting a pixel
            // or two off the exact GPS point. Zero extra network cost (same tile).
            const x0 = Math.max(0, px - 2), y0 = Math.max(0, py - 2)
            const w = Math.min(256 - x0, 5), h = Math.min(256 - y0, 5)
            const block = ctx.getImageData(x0, y0, w, h).data
            // RainViewer Universal Blue scheme: transparent = no rain.
            // alpha > 30 = meaningful radar echo above noise floor.
            let maxAlpha = 0
            for (let i = 3; i < block.length; i += 4) {
              if (block[i] > maxAlpha) maxAlpha = block[i]
            }
            resolve(maxAlpha > 30 ? 0.3 : 0)
          } catch {
            resolve(null)  // tainted canvas — CORS headers not present
          }
        }
        img.onerror = () => resolve(null)
        img.src = tileUrl
      })
      return Promise.race([imgPromise, new Promise(r => setTimeout(() => r(null), 5000))])
    })
    .catch(() => null)
}

export async function fetchAreaPrecip() {
  // One batched Open-Meteo request for all towns (comma-separated coords), cached +
  // serve-stale so it doesn't add to Open-Meteo's rate-limit pressure on every 5-min
  // refresh. Always returns every AREA (precip null on failure) so dots render.
  const cached = await cachedOrNull('area', async () => {
    const lats = AREAS.map(a => a.lat).join(',')
    const lons = AREAS.map(a => a.lon).join(',')
    const r = await fetch(
      `${OPEN_METEO}?latitude=${lats}&longitude=${lons}&current=precipitation,weather_code&timezone=UTC`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (!r.ok) return null
    const data = await r.json()
    const arr = Array.isArray(data) ? data : [data]  // multi-loc → array; single → object
    return AREAS.map((a, i) => ({
      ...a,
      precip: arr[i]?.current?.precipitation ?? null,
      code:   arr[i]?.current?.weather_code  ?? null,
    }))
  })
  return cached ?? AREAS.map(a => ({ ...a, precip: null, code: null }))
}
