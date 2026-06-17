const OPEN_METEO     = 'https://api.open-meteo.com/v1/forecast'
const GEOSPHERE_TAWES = 'https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min'
const DWD_WMS        = 'https://maps.dwd.de/geoserver/dwd/wms'
const BACKEND        = import.meta.env.VITE_BACKEND_URL ?? ''

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

async function tawesNearestIds(lat, lon, n = 3) {
  if (!_tawesStations) {
    try {
      const r = await fetch(`${GEOSPHERE_TAWES}/metadata`, { signal: AbortSignal.timeout(8000) })
      if (!r.ok) return ['11150']
      const meta = await r.json()
      const raw = meta?.stations ?? []
      // API returns array of station objects; fall back to dict form just in case
      _tawesStations = (Array.isArray(raw)
        ? raw.map(s => ({ id: String(s.id), lat: +s.lat, lon: +s.lon }))
        : Object.entries(raw).map(([id, v]) => ({
            id,
            lat: Array.isArray(v) ? +v[0] : +v.lat,
            lon: Array.isArray(v) ? +v[1] : +v.lon,
          }))
      ).filter(s => s.id && isFinite(s.lat) && isFinite(s.lon))
    } catch {
      return ['11150']
    }
  }
  if (!_tawesStations.length) return ['11150']
  return [..._tawesStations]
    .map(s => ({ id: s.id, dist: haversineKm(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n)
    .map(s => s.id)
}

export async function fetchNearbyStationPrecip(lat, lon) {
  try {
    const ids = await tawesNearestIds(lat, lon, 3)
    const r = await fetch(
      `${GEOSPHERE_TAWES}?parameters=RR&station_ids=${ids.join(',')}`,
      { signal: AbortSignal.timeout(6000) }
    )
    if (!r.ok) return null
    const data = await r.json()
    // Confirmed response path (python-zamg): features[].properties.parameters.RR.data[0]
    const values = (data?.features ?? [])
      .map(f => f?.properties?.parameters?.RR?.data?.[0])
      .filter(v => typeof v === 'number' && !isNaN(v))
    return values.length ? Math.max(...values) : null
  } catch {
    return null
  }
}

// ---- DWD RADOLAN — live radar point query via WMS GetFeatureInfo ----
// Same source as the map overlay, but queried as a data value not a tile image.
// GeoServer returns the raw RADOLAN byte value as GRAY_INDEX.
// RADOLAN RX encoding: dBZ = GRAY_INDEX / 2 − 32.5; rain starts at ~7 dBZ.
// Returns 0.1 (triggers "raining" threshold) if radar sees rain, else 0, else null.
export async function fetchRadarPrecipAtPoint(lat, lon) {
  try {
    const m = 0.01 // ~1 km margin
    const params = new URLSearchParams({
      SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo',
      LAYERS: 'dwd:RX-Produkt', QUERY_LAYERS: 'dwd:RX-Produkt',
      CRS: 'CRS:84',
      BBOX: `${lon - m},${lat - m},${lon + m},${lat + m}`,
      WIDTH: '10', HEIGHT: '10', I: '5', J: '5',
      INFO_FORMAT: 'application/json',
    })
    const r = await fetch(`${DWD_WMS}?${params}`, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) return null
    const data = await r.json()
    const raw = data?.features?.[0]?.properties?.GRAY_INDEX
    if (typeof raw !== 'number' || raw >= 250) return 0 // no-data / no-echo flags
    const dBZ = raw / 2 - 32.5
    return dBZ > 7 ? 0.1 : 0 // 7 dBZ ≈ 0.1 mm/h, detectable rain
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
