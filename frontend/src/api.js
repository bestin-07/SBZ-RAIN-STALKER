const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast'
const GEOSPHERE_TAWES = 'https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min'
const SBZ_STATION = '11150' // Salzburg Flughafen — confirmed WMO/TAWES station ID
const BACKEND = import.meta.env.VITE_BACKEND_URL ?? ''

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


// GeoSphere Austria TAWES — actual 10-minute station observations, not a forecast model.
// Station 11150 = Salzburg Flughafen (~3km from city centre), updated every 10 min.
// RR = precipitation sum (mm) for the last 10-minute interval.
// Response path confirmed from python-zamg source: features[0].properties.parameters.RR.data[0]
export async function fetchNearbyStationPrecip() {
  try {
    const r = await fetch(
      `${GEOSPHERE_TAWES}?parameters=RR&station_ids=${SBZ_STATION}`,
      { signal: AbortSignal.timeout(6000) }
    )
    if (!r.ok) return null
    const data = await r.json()
    const val = data?.features?.[0]?.properties?.parameters?.RR?.data?.[0]
    return typeof val === 'number' && !isNaN(val) ? val : null
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
