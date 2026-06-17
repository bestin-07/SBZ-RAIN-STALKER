const OPEN_METEO     = 'https://api.open-meteo.com/v1/forecast'
const GEOSPHERE_TAWES = 'https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min'
// GeoSphere INCA: radar+station blended 1 km analysis grid. Replaces the DWD
// RADOLAN WMS GetFeatureInfo source, which is WAF-blocked (HTTP 403) from
// Austrian user networks and silently returned null on every request.
const GEOSPHERE_INCA = 'https://dataset.api.hub.geosphere.at/v1/timeseries/historical/inca-v1-1h-1km'
const BACKEND        = import.meta.env.VITE_BACKEND_URL ?? ''

// Salzburg Airport (TAWES 11150) — central, reliable. Always queried as an
// anchor so a hyper-local convective cell near the city is never missed even
// if the user's nearest stations happen to be dry.
const ANCHOR_STATION_ID = '11150'

export const AREAS = [
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

export async function fetchForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: 'temperature_2m,wind_speed_10m,weather_code,precipitation',
    minutely_15: 'precipitation',
    forecast_minutely_15: 48,
    timeformat: 'unixtime',
    timezone: 'UTC',
  })
  const r = await fetch(`${OPEN_METEO}?${params}`)
  if (!r.ok) throw new Error(`Open-Meteo error ${r.status}`)
  return r.json()
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
  const nearest = [..._tawesStations]
    .map(s => ({ id: s.id, dist: haversineKm(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n)
    .map(s => s.id)
  // Always include the airport anchor so a cell over the city is caught even
  // when the user's nearest stations are dry.
  return nearest.includes(ANCHOR_STATION_ID) ? nearest : [...nearest, ANCHOR_STATION_ID]
}

export async function fetchNearbyStationPrecip(lat, lon) {
  try {
    const ids = await tawesNearestIds(lat, lon, 6)
    const r = await fetch(
      `${GEOSPHERE_TAWES}?parameters=RR&station_ids=${ids.join(',')}`,
      { signal: AbortSignal.timeout(6000) }
    )
    if (!r.ok) return null
    const data = await r.json()
    // Confirmed response path (live): features[].properties.parameters.RR.data[0]
    const values = (data?.features ?? [])
      .map(f => f?.properties?.parameters?.RR?.data?.[0])
      .filter(v => typeof v === 'number' && !isNaN(v))
    return values.length ? Math.max(...values) : null
  } catch {
    return null
  }
}

// ---- GeoSphere INCA — radar+station blended 1 km nowcast point value ----
// Replaces the DWD RADOLAN WMS GetFeatureInfo source, which is WAF-blocked
// (HTTP 403) from Austrian user networks. INCA is the same GeoSphere host as
// TAWES (no CORS issues) and gives an actual analysed precipitation value at
// the user's exact 1 km grid cell — independent of the Open-Meteo model that
// lags fast convective alpine rain.
// RR = 1-hour precipitation sum in kg/m² (= mm). Returns the most recent
// hourly value in mm, or null on failure.
export async function fetchRadarPrecipAtPoint(lat, lon) {
  try {
    // INCA hourly analysis lags ~30–90 min; ask for the last 3 h and take the
    // most recent non-null hourly sum.
    const now = new Date()
    const start = new Date(now.getTime() - 3 * 3600 * 1000)
    const iso = d => d.toISOString().slice(0, 16) // YYYY-MM-DDTHH:mm
    const params = new URLSearchParams({
      parameters: 'RR',
      start: iso(start),
      end: iso(now),
      lat_lon: `${lat},${lon}`,
    })
    const r = await fetch(`${GEOSPHERE_INCA}?${params}`, { signal: AbortSignal.timeout(6000) })
    if (!r.ok) return null
    const data = await r.json()
    const series = data?.features?.[0]?.properties?.parameters?.RR?.data ?? []
    const valid = series.filter(v => typeof v === 'number' && !isNaN(v))
    return valid.length ? valid[valid.length - 1] : null
  } catch {
    return null
  }
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

export async function fetchAreaPrecip() {
  const results = await Promise.allSettled(
    AREAS.map(area =>
      fetch(`${OPEN_METEO}?latitude=${area.lat}&longitude=${area.lon}&current=precipitation&timezone=UTC`)
        .then(r => r.json())
        .then(data => ({ ...area, precip: data.current?.precipitation ?? null }))
    )
  )
  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)
}
