import { useState, useEffect, useCallback } from 'react'
import { fetchForecast, fetchAccuracy, fetchAreaPrecip } from './api'
import { detectGaps, getStatus } from './gaps'
import { useI18n } from './i18n'
import Header from './components/Header'
import GapBanner from './components/GapBanner'
import RainRibbon from './components/RainRibbon'
import RadarMap from './components/RadarMap'
import LocationPrompt from './components/LocationPrompt'
import InfoPanel from './components/InfoPanel'

const REFRESH_MS = 5 * 60 * 1000

function saved(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}

export default function App() {
  const [location, setLocation] = useState(null)
  const [locationError, setLocationError] = useState(null)
  const [forecast, setForecast] = useState(null)
  const [accuracy, setAccuracy] = useState(null)
  const [currentPrecip, setCurrentPrecip] = useState(null)
  const [gaps, setGaps] = useState([])
  const [areaPrecip, setAreaPrecip] = useState([])
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [theme, setTheme] = useState(() => saved('theme', 'dark'))
  const [lang, setLang] = useState(() => saved('lang', 'de'))
  const [infoOpen, setInfoOpen] = useState(false)

  const t = useI18n(lang)
  const status = getStatus(currentPrecip, gaps, t)

  // Apply theme class + meta color
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.content = theme === 'light' ? '#F2F0EB' : '#08090B'
    try { localStorage.setItem('theme', theme) } catch {}
  }, [theme])

  useEffect(() => {
    try { localStorage.setItem('lang', lang) } catch {}
  }, [lang])

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError('location not supported')
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
        const { currentPrecip: cp, gaps: detectedGaps } = detectGaps(times, precips)
        setForecast({ times, precips })
        setCurrentPrecip(cp)
        setGaps(detectedGaps)
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
    return <LocationPrompt loading onRequest={requestLocation} t={t} />
  }

  if (locationError && !location) {
    return <LocationPrompt error={locationError} onRequest={requestLocation} t={t} />
  }

  return (
    <div className="flex flex-col h-full bg-bg text-primary overflow-hidden">
      <Header
        accuracy={accuracy}
        lastUpdated={lastUpdated}
        onRefresh={loadData}
        loading={loading}
        theme={theme}
        onThemeToggle={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
        lang={lang}
        onLangToggle={() => setLang(prev => prev === 'de' ? 'en' : 'de')}
        onInfo={() => setInfoOpen(true)}
        t={t}
      />
      <GapBanner status={status} />
      <RainRibbon forecast={forecast} theme={theme} t={t} />
      <RadarMap location={location} areaPrecip={areaPrecip} theme={theme} />
      <InfoPanel open={infoOpen} onClose={() => setInfoOpen(false)} t={t} />
    </div>
  )
}
