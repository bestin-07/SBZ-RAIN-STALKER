import { useState, useEffect, useCallback } from 'react'
import { fetchForecast, fetchAccuracy, fetchAreaPrecip } from './api'
import { detectGaps, getStatus } from './gaps'
import Header from './components/Header'
import GapBanner from './components/GapBanner'
import RainRibbon from './components/RainRibbon'
import RadarMap from './components/RadarMap'
import LocationPrompt from './components/LocationPrompt'

const REFRESH_MS = 5 * 60 * 1000

export default function App() {
  const [location, setLocation] = useState(null)
  const [locationError, setLocationError] = useState(null)
  const [forecast, setForecast] = useState(null)
  const [accuracy, setAccuracy] = useState(null)
  const [status, setStatus] = useState(null)
  const [gaps, setGaps] = useState([])
  const [areaPrecip, setAreaPrecip] = useState([])
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError('geolocation not supported by this browser')
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setLocationError(null)
      },
      () => setLocationError('location access denied'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }, [])

  const loadData = useCallback(async () => {
    if (!location) return
    setLoading(true)
    try {
      const [forecastResult, accuracyResult, areaResult] = await Promise.allSettled([
        fetchForecast(location.lat, location.lon),
        fetchAccuracy(),
        fetchAreaPrecip(),
      ])

      if (forecastResult.status === 'fulfilled') {
        const data = forecastResult.value
        const times = data.minutely_15?.time ?? []
        const precips = data.minutely_15?.precipitation ?? []
        const { currentPrecip, gaps: detectedGaps } = detectGaps(times, precips)
        setForecast({ times, precips })
        setGaps(detectedGaps)
        setStatus(getStatus(currentPrecip, detectedGaps))
        setLastUpdated(Date.now())
      }

      if (accuracyResult.status === 'fulfilled') setAccuracy(accuracyResult.value)
      if (areaResult.status === 'fulfilled') setAreaPrecip(areaResult.value)
    } finally {
      setLoading(false)
    }
  }, [location])

  useEffect(() => { requestLocation() }, [])

  useEffect(() => {
    if (!location) return
    loadData()
    const id = setInterval(loadData, REFRESH_MS)
    return () => clearInterval(id)
  }, [location, loadData])

  if (!location && !locationError) {
    return <LocationPrompt loading onRequest={requestLocation} />
  }

  if (locationError && !location) {
    return <LocationPrompt error={locationError} onRequest={requestLocation} />
  }

  return (
    <div className="flex flex-col h-full bg-bg text-primary overflow-hidden">
      <Header accuracy={accuracy} lastUpdated={lastUpdated} onRefresh={loadData} loading={loading} />
      <GapBanner status={status} loading={loading && !status} />
      <RainRibbon forecast={forecast} />
      <RadarMap location={location} areaPrecip={areaPrecip} />
    </div>
  )
}
