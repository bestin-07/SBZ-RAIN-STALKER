const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast'
const RAINVIEWER = 'https://api.rainviewer.com/public/weather-maps.json'
const BACKEND = import.meta.env.VITE_BACKEND_URL || ''

export async function fetchForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    minutely_15: 'precipitation',
    forecast_minutely_15: 48,
    timeformat: 'unixtime',
    timezone: 'UTC',
  })
  const r = await fetch(`${OPEN_METEO}?${params}`)
  if (!r.ok) throw new Error(`Open-Meteo error ${r.status}`)
  return r.json()
}

export async function fetchRadarFrames() {
  const r = await fetch(RAINVIEWER)
  if (!r.ok) throw new Error(`RainViewer error ${r.status}`)
  return r.json()
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
