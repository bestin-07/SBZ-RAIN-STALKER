import { ringDirection, RV_SOLID_COVERAGE } from './gaps'

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

// For fns that return null on failure: serve fresh cache, else fetch, else stale
// (but not beyond maxStaleMs — a very old nowcast still has ~2h of "future" slots
// from its old forecast and produces garbage gaps like "wait 100 min").
async function cachedOrNull(key, fetcher, maxStaleMs = Infinity) {
  const now = Date.now()
  const hit = _respCache.get(key)
  if (hit && now - hit.ts < RESP_TTL) return hit.data
  let data = null
  try { data = await fetcher() } catch { data = null }
  if (data != null) { _respCache.set(key, { data, ts: now }); return data }
  return (hit && now - hit.ts <= maxStaleMs) ? hit.data : null
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
let _ambientPoints = null, _ambientPointsTs = 0, _ambientFormingTs = null, _ambientAreaWatch = null
async function fetchAmbient() {
  const now = Date.now()
  if (_ambientPoints && now - _ambientPointsTs < 90 * 1000) return _ambientPoints
  try {
    const r = await fetch(`${BACKEND}/api/ambient`, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) return _ambientPoints
    const j = await r.json()
    // Radar-confirmed convective initiation stamp (unix s) — set by the backend when
    // several grid points flip dry→wet in one cycle under real CAPE. Drives the
    // "showers forming right now" banner (App checks freshness).
    if (typeof j?.forming_ts === 'number') _ambientFormingTs = j.forming_ts
    // City-scale wet/dry direction + trend (v2.4) — {sector, count, trend, ts} or absent.
    _ambientAreaWatch = j?.area_watch ?? null
    if (Array.isArray(j?.points) && j.points.length) { _ambientPoints = j.points; _ambientPointsTs = now; return j.points }
    return _ambientPoints   // empty before first cycle → let caller fall back to direct OM
  } catch { return _ambientPoints }
}

// Latest convective-initiation timestamp seen on /api/ambient (unix s), or null.
export function ambientFormingTs() { return _ambientFormingTs }

// Latest area-watch reading ({sector,count,trend,ts}) seen on /api/ambient, or null.
export function ambientAreaWatch() { return _ambientAreaWatch }
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
    // AROME hourly tail (v2.7, backend-fetched, mm/h) — unioned with the 15-min
    // series client-side (combineModelSeries). Absent on the direct-OM fallback.
    arome: pt.arome ?? null,
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
  // Prefer the backend's shared ground reading. A per-IP direct TAWES call flip-flops
  // under rate limits, and when it drops the app falls back to the spiky radar current
  // slot → the GO ANYWAY<->STUCK instability. The backend value is one stable shared
  // fetch (all city points read the same 2 gauges anyway). GPS stays local — nearest
  // point picked here. Only fall back to a direct call if the backend is unreachable.
  try {
    const points = await fetchAmbient()
    if (points) {
      const pt = nearestAmbientPoint(points, +lat, +lon)
      if (pt && 'ground' in pt) {
        // Backend reachable → authoritative. null = TAWES genuinely down server-side →
        // return null so effectivePrecip uses the radar fallback (unchanged semantics).
        return pt.ground == null ? null : { precip: pt.ground, temp: pt.temp ?? null }
      }
    }
  } catch { /* fall through to the direct call */ }
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
  // Prefer the backend's per-point nowcast (one shared server fetch) over a direct
  // browser→GeoSphere call. The direct call is per-IP, so on mobile CGNAT (many
  // users behind one carrier IP) it gets rate-limited and the ribbon goes blank.
  // The backend snapshot is immune to that; GPS still stays local (we pick the
  // nearest served point). Only fall back to the direct call if it isn't available.
  try {
    const points = await fetchAmbient()
    if (points) {
      const pt = nearestAmbientPoint(points, +lat, +lon)
      const nc = pt?.nowcast
      if (nc && Array.isArray(nc.times) && nc.times.length && nc.times.length === nc.precips?.length) {
        return { times: nc.times, precips: nc.precips }
      }
    }
  } catch { /* fall through to the direct call */ }
  // Cap stale serving at 20 min — the nowcast is a time-aligned timeline; older than
  // that its slots no longer line up with "now" and detectGaps yields nonsense.
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
  }, 20 * 60 * 1000)
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

// weather-maps.json is identical for every point, so cache the fetch briefly.
// Without this, sampling all ~15 town dots would hit the endpoint 15× per refresh
// (the radar tile itself is already shared: every Salzburg point maps to the SAME
// z7 tile, so the browser HTTP-caches it after the first download).
let _rvMapsCache = { ts: 0, promise: null }
function getRainViewerMaps() {
  const now = Date.now()
  if (_rvMapsCache.promise && now - _rvMapsCache.ts < 60_000) return _rvMapsCache.promise
  const p = fetch(RAINVIEWER_WEATHER_MAPS, { signal: AbortSignal.timeout(5000) })
    .then(r => r.ok ? r.json() : null)
    .catch(() => null)
  _rvMapsCache = { ts: now, promise: p }
  return p
}

// Sample ONE RainViewer frame's tile at one or more pixel blocks. Resolves an array
// of wet-pixel COUNTS (0–25 per 5×5 block) — one per requested block — or null
// (CORS/tile failure). The count is the spatial-extent signal (v2.4.1): a stuck
// clutter pixel lights 1–3 px, a real drizzle field blankets the block.
// Reading extra blocks off the SAME canvas costs zero additional network.
function sampleRvFrameBlocks(host, framePath, z, tileX, tileY, blocks) {
  const tileUrl = `${host}${framePath}/256/${z}/${tileX}/${tileY}/2/1_1.png`
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
        const out = blocks.map(({ px, py }) => {
          // Each block: 5×5 px (~700 m at z7) centred on the target, max echo —
          // catches a small cell sitting a pixel or two off the exact point.
          const x0 = Math.min(251, Math.max(0, px - 2))
          const y0 = Math.min(251, Math.max(0, py - 2))
          const block = ctx.getImageData(x0, y0, 5, 5).data
          // RainViewer Universal Blue scheme: transparent = no rain.
          // alpha > 30 = meaningful radar echo above noise floor.
          let wet = 0
          for (let i = 3; i < block.length; i += 4) {
            if (block[i] > 30) wet++
          }
          return wet
        })
        resolve(out)
      } catch {
        resolve(null)  // tainted canvas — CORS headers not present
      }
    }
    img.onerror = () => resolve(null)
    img.src = tileUrl
  })
  return Promise.race([imgPromise, new Promise(r => setTimeout(() => r(null), 5000))])
}

// Compass ring around the user's pixel, ~15 km out at z7 (1 px ≈ 1.2 km): the
// "approach watch". Diagonals use 9px legs so all 8 points sit at a similar radius.
const RING_DIRS = [
  { d: 'n',  dx: 0,   dy: -13 }, { d: 'ne', dx: 9,  dy: -9 },
  { d: 'e',  dx: 13,  dy: 0 },   { d: 'se', dx: 9,  dy: 9 },
  { d: 's',  dx: 0,   dy: 13 },  { d: 'sw', dx: -9, dy: 9 },
  { d: 'w',  dx: -13, dy: 0 },   { d: 'nw', dx: -9, dy: -9 },
]

// Read RainViewer at the user's exact lat/lon:
//  • now         — the latest PAST frame (real radar, ~5 min latency: the freshest
//                  "is echo over me" signal we have; GeoSphere issues 15–25 min behind).
//  • approachMin — minutes until the FIRST RainViewer forecast frame (10-min steps,
//                  ~+10/+20/+30, observed echo motion) that shows echo at this pixel,
//                  or null. ALL frames are sampled (v1.4.1), so an early-arriving cell
//                  isn't missed and the verdict gets a real ETA ("~10 min"), not a
//                  generic "~30". The "blue on the map while the app claims dry"
//                  signal, promoted from the map into the verdict with a countdown.
// Returns { now, approachMin } or null when RainViewer is unavailable.
export function fetchRainViewerPrecip(lat, lon) {
  return getRainViewerMaps()
    .then(mapData => {
      if (!mapData) return null
      const past = mapData.radar?.past ?? []
      const fcst = mapData.radar?.nowcast ?? []
      if (!past.length) return null

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

      // Latest past frame: centre + the 8-point ~15 km ring, all read off ONE tile.
      // The ring gives the approach DIRECTION (v2.4): echo sitting to the west of a
      // dry centre = rain nearby to the west — the lead signal users see as "blue on
      // the map" before anything reaches their pixel.
      const ringBlocks = [{ px, py }, ...RING_DIRS.map(r => ({ px: px + r.dx, py: py + r.dy }))]
      const nowP = sampleRvFrameBlocks(host, past[past.length - 1].path, z, tileX, tileY, ringBlocks)
      // Sample EVERY forecast frame at the centre (usually 2–3; same tile x/y, so
      // the browser caches per frame path — dots and the live location share them).
      const soonPs = fcst.map(f =>
        sampleRvFrameBlocks(host, f.path, z, tileX, tileY, [{ px, py }])
          .then(v => ({ time: f.time, v: v === null ? null : v[0] })))
      return Promise.all([nowP, Promise.all(soonPs)]).then(([nowArr, soons]) => {
        if (nowArr === null && soons.every(s => s.v === null)) return null
        // Blocks resolve as wet-pixel counts (0–25). Centre count → binary echo value
        // (compat with the mm-ish contract) + coverage fraction for the solid check.
        const nowCount = nowArr === null ? null : nowArr[0]
        const now = nowCount === null ? null : (nowCount > 0 ? 0.3 : 0)
        // v2.4.1: wide echo across the ~6×6 km centre block = a FIELD, not a stuck
        // clutter pixel — lets RainViewer corroborate itself in gaps.surfaceDrizzle.
        const rvSolid = nowCount !== null && nowCount / 25 >= RV_SOLID_COVERAGE
        const wetDirs = nowArr === null ? [] :
          RING_DIRS.filter((r, i) => nowArr[i + 1] > 0).map(r => r.d)
        const nowSec = Date.now() / 1000
        let approachMin = null
        for (const s of soons) {                    // frames are chronological
          if (s.v !== null && s.v >= 1) {            // ≥1 wet px in the block
            approachMin = Math.max(1, Math.round((s.time - nowSec) / 60))
            break                                    // first arrival = the ETA
          }
        }
        // Direction only means "approach/nearby" when the centre itself is dry.
        const fromDir = (now !== null && now < 0.1) ? ringDirection(wetDirs) : null
        return { now, approachMin, fromDir, rvSolid }
      })
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
