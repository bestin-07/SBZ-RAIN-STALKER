import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchForecast, fetchAccuracy, fetchAreaPrecip, fetchNearbyStationPrecip } from './api'
import { detectGaps, getStatus } from './gaps'
import { useI18n } from './i18n'
import Header from './components/Header'
import GapBanner from './components/GapBanner'
import RainRibbon from './components/RainRibbon'
import RadarMap from './components/RadarMap'
import LocationPrompt from './components/LocationPrompt'
import InfoPanel from './components/InfoPanel'

const REFRESH_MS = 5 * 60 * 1000

const SBZ_BOUNDS = { minLat: 47.35, maxLat: 48.20, minLon: 12.50, maxLon: 13.80 }

function saved(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}

function isOutsideSalzburg(loc) {
  return loc.lat < SBZ_BOUNDS.minLat || loc.lat > SBZ_BOUNDS.maxLat ||
         loc.lon < SBZ_BOUNDS.minLon || loc.lon > SBZ_BOUNDS.maxLon
}

export default function App() {
  const [location, setLocation] = useState(null)
  const [locationError, setLocationError] = useState(null)
  const [forecast, setForecast] = useState(null)
  const [accuracy, setAccuracy] = useState(null)
  const [currentPrecip, setCurrentPrecip] = useState(null)
  const [currentWeather, setCurrentWeather] = useState(null)
  const [gaps, setGaps] = useState([])
  const [areaPrecip, setAreaPrecip] = useState([])
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [theme, setTheme] = useState(() => saved('theme', 'light'))
  const [lang, setLang] = useState(() => saved('lang', 'de'))
  const [infoOpen, setInfoOpen] = useState(false)
  const [notifyState, setNotifyState] = useState('idle')
  const installPromptRef = useRef(null)
  const [installable, setInstallable] = useState(false)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                    || window.navigator.standalone === true

  const t = useI18n(lang)
  const status = getStatus(currentPrecip, gaps, currentWeather, t)

  useEffect(() => {
    const handler = e => {
      e.preventDefault()
      installPromptRef.current = e
      setInstallable(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => setInstallable(false))
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setNotifyState('unsupported')
      return
    }
    if (Notification.permission === 'denied') { setNotifyState('denied'); return }
    navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => {
      if (sub) setNotifyState('subscribed')
    })
  }, [])

  const toggleNotifications = useCallback(async () => {
    if (notifyState === 'unsupported' || notifyState === 'denied') return

    if (notifyState === 'subscribed') {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch(`${import.meta.env.VITE_BACKEND_URL ?? ''}/api/subscribe`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setNotifyState('idle')
      return
    }

    try {
      const keyRes = await fetch(`${import.meta.env.VITE_BACKEND_URL ?? ''}/api/vapid-public-key`)
      if (!keyRes.ok) return
      const { publicKey } = await keyRes.json()

      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setNotifyState('denied'); return }

      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      })

      await fetch(`${import.meta.env.VITE_BACKEND_URL ?? ''}/api/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub),
      })
      setNotifyState('subscribed')
    } catch (e) {
      console.error('Push subscribe failed', e)
    }
  }, [notifyState])

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
      const [forecastResult, accuracyResult, areaResult, stationResult] = await Promise.allSettled([
        fetchForecast(location.lat, location.lon),
        fetchAccuracy(),
        fetchAreaPrecip(),
        fetchNearbyStationPrecip(location.lat, location.lon),
      ])

      if (forecastResult.status === 'fulfilled') {
        const data = forecastResult.value
        const times = data.minutely_15?.time ?? []
        const precips = data.minutely_15?.precipitation ?? []
        const { currentPrecip: cp, gaps: detectedGaps } = detectGaps(times, precips)
        // Blend three signals — take the highest so any one source catching rain wins:
        // 1. minutely_15 forecast slot (cp) — ICON-EU model, can lag 2-3h on convective events
        // 2. current.precipitation — model-measured mm last hour, same lag problem
        // 3. GeoSphere Austria TAWES — actual station observation, 10-min updates (most reliable)
        const measured = data.current?.precipitation ?? 0
        const stationPrecip = stationResult?.status === 'fulfilled' ? (stationResult.value ?? 0) : 0
        const effectivePrecip = cp === null ? null : Math.max(cp, measured, stationPrecip)
        setForecast({ times, precips })
        setCurrentPrecip(effectivePrecip)
        setGaps(detectedGaps)
        setCurrentWeather({
          temp: data.current?.temperature_2m ?? null,
          wind: data.current?.wind_speed_10m ?? null,
          code: data.current?.weather_code ?? null,
        })
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
        notifyState={notifyState}
        onNotifyToggle={toggleNotifications}
        installable={installable && !isStandalone}
        onInstall={async () => {
          if (installPromptRef.current) {
            installPromptRef.current.prompt()
            const { outcome } = await installPromptRef.current.userChoice
            if (outcome === 'accepted') setInstallable(false)
          }
        }}
        t={t}
      />
      {location && isOutsideSalzburg(location) && (
        <div className="px-4 py-2 bg-surface border-b border-border shrink-0">
          <span className="font-mono text-xs text-wait">⚠ {t('outside_sbz')}</span>
        </div>
      )}
      <GapBanner status={status} />
      <RainRibbon forecast={forecast} theme={theme} t={t} />
      <RadarMap location={location} areaPrecip={areaPrecip} theme={theme} />
      <InfoPanel open={infoOpen} onClose={() => setInfoOpen(false)} t={t} />
    </div>
  )
}
