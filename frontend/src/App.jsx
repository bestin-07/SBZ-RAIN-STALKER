import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchForecast, fetchAccuracy, fetchAreaPrecip, fetchNearbyStationPrecip, fetchNowcastTimeline } from './api'
import { detectGaps, getStatus } from './gaps'
import { useI18n } from './i18n'
import Header from './components/Header'
import GapBanner from './components/GapBanner'
import RainRibbon from './components/RainRibbon'
import RadarMap from './components/RadarMap'
import LocationPrompt from './components/LocationPrompt'
import FarAway from './components/FarAway'
import InfoPanel from './components/InfoPanel'

const REFRESH_MS = 5 * 60 * 1000

const SBZ_BOUNDS = { minLat: 47.35, maxLat: 48.20, minLon: 12.50, maxLon: 13.80 }
const SBZ_CENTER = { lat: 47.8009, lon: 13.0448 }
const FAR_KM = 50  // beyond this, the app is the wrong tool — offer Salzburg instead

function saved(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}

function isOutsideSalzburg(loc) {
  return loc.lat < SBZ_BOUNDS.minLat || loc.lat > SBZ_BOUNDS.maxLat ||
         loc.lon < SBZ_BOUNDS.minLon || loc.lon > SBZ_BOUNDS.maxLon
}

function kmFromSalzburg(loc) {
  const R = 6371, r = Math.PI / 180
  const dLat = (loc.lat - SBZ_CENTER.lat) * r, dLon = (loc.lon - SBZ_CENTER.lon) * r
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(loc.lat * r) * Math.cos(SBZ_CENTER.lat * r) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// VAPID public key (base64url) → Uint8Array. The most compatible form for
// pushManager.subscribe — a raw string is rejected by some browsers.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export default function App() {
  const [location, setLocation] = useState(null)
  const [locationError, setLocationError] = useState(null)
  const [locating, setLocating] = useState(false)
  const [forecast, setForecast] = useState(null)
  const [accuracy, setAccuracy] = useState(null)
  const [currentPrecip, setCurrentPrecip] = useState(null)
  const [currentWeather, setCurrentWeather] = useState(null)
  const [gaps, setGaps] = useState([])
  const [trend, setTrend] = useState({ nextRainAt: null, dryEndsOpen: false })
  const [tickNow, setTickNow] = useState(() => Math.floor(Date.now() / 1000))
  const [areaPrecip, setAreaPrecip] = useState([])
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [theme, setTheme] = useState(() => saved('theme', 'light'))
  const [lang, setLang] = useState(() => saved('lang', 'de'))
  const [infoOpen, setInfoOpen] = useState(false)
  const [notifyState, setNotifyState] = useState('idle')
  const [notifyMsg, setNotifyMsg] = useState(null)
  const installPromptRef = useRef(null)
  const [installable, setInstallable] = useState(false)
  const [iosHintDismissed, setIosHintDismissed] = useState(() => saved('ios_hint_dismissed', '') === '1')
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                    || window.navigator.standalone === true
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
             || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  // iOS install hints. Safari can install via Share → Add to Home Screen; every
  // other iOS browser (Chrome/Firefox/Edge/Opera = CriOS/FxiOS/...) cannot install
  // at all on iOS, so point those users to Safari. Returns the i18n key, or null.
  const _ua = navigator.userAgent
  const isIOSSafari = isIOS && /Safari/.test(_ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(_ua)
  const isIOSOther  = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS/.test(_ua)
  const iosHint = (!isStandalone && !iosHintDismissed)
    ? (isIOSSafari ? 'ios_install' : isIOSOther ? 'ios_open_safari' : null)
    : null

  const t = useI18n(lang)
  const status = getStatus(currentPrecip, gaps, currentWeather, t, tickNow, trend)
  const farAway = location ? kmFromSalzburg(location) > FAR_KM : false

  // Tick every minute so the "rain in X" / "dry in X" countdown moves live
  // between the 5-minute data refreshes (re-synced on each refresh).
  useEffect(() => {
    const id = setInterval(() => setTickNow(Math.floor(Date.now() / 1000)), 60000)
    return () => clearInterval(id)
  }, [])

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
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(async sub => {
        if (!sub) return
        setNotifyState('subscribed')
        // Re-register with the backend in case its subscription store was reset
        // (e.g. on redeploy, ephemeral DB). Idempotent; confirm:false skips the
        // welcome push so opening the app doesn't ping every time.
        try {
          const res = await fetch(`${import.meta.env.VITE_BACKEND_URL ?? ''}/api/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...sub.toJSON(), confirm: false }),
          })
          if (res.ok) {
            const data = await res.json().catch(() => ({}))
            if (data.token) { try { localStorage.setItem('push_unsub_token', data.token) } catch {} }
          }
        } catch {}
      })
  }, [])

  const toggleNotifications = useCallback(async () => {
    if (notifyState === 'unsupported') return
    if (notifyState === 'denied') { setNotifyMsg('notify_blocked'); return }

    // iOS only delivers web push to an INSTALLED home-screen app. In a Safari
    // tab, subscribe silently fails — so guide the user instead of doing nothing.
    if (notifyState !== 'subscribed' && isIOS && !isStandalone) {
      setNotifyMsg('notify_ios_install')
      return
    }

    if (notifyState === 'subscribed') {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        const token = localStorage.getItem('push_unsub_token') ?? ''
        await fetch(`${import.meta.env.VITE_BACKEND_URL ?? ''}/api/subscribe`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint, token }),
        })
        localStorage.removeItem('push_unsub_token')
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
      // Drop any stale subscription first. If the VAPID key changed (e.g. earlier
      // deploys generated different keys), subscribe() throws InvalidStateError
      // because a subscription with a different applicationServerKey exists.
      const existing = await reg.pushManager.getSubscription()
      if (existing) { try { await existing.unsubscribe() } catch {} }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })

      const subRes = await fetch(`${import.meta.env.VITE_BACKEND_URL ?? ''}/api/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sub.toJSON(), confirm: true }),
      })
      if (!subRes.ok) { setNotifyMsg('notify_fail'); return }
      const subData = await subRes.json().catch(() => ({}))
      if (subData.token) {
        try { localStorage.setItem('push_unsub_token', subData.token) } catch {}
      }
      setNotifyState('subscribed')
      setNotifyMsg(null)
    } catch (e) {
      console.error('Push subscribe failed', e)
      setNotifyMsg('notify_fail')
    }
  }, [notifyState, isIOS, isStandalone])

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
      setLocationError('unsupported')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setLocationError(null)
        setLocating(false)
      },
      err => {
        setLocating(false)
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        setLocationError(err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }, [])

  // Fallback so the app is usable even if GPS never resolves (Salzburg centre).
  const useDefaultLocation = useCallback(() => {
    setLocation({ lat: 47.8009, lon: 13.0448 })
    setLocationError(null)
  }, [])

  // Detect a pre-blocked permission up front so we can show help immediately
  // instead of making the user wait for a click that won't prompt (Firefox/Chrome).
  useEffect(() => {
    if (!navigator.permissions?.query) return
    navigator.permissions.query({ name: 'geolocation' })
      .then(p => { if (p.state === 'denied') setLocationError('denied') })
      .catch(() => {})
  }, [])

  const loadData = useCallback(async () => {
    if (!location) return
    if (kmFromSalzburg(location) > FAR_KM) return  // too far — FarAway screen shown instead
    setLoading(true)
    try {
      const [forecastResult, accuracyResult, areaResult, stationResult, nowcastResult] = await Promise.allSettled([
        fetchForecast(location.lat, location.lon),
        fetchAccuracy(),
        fetchAreaPrecip(),
        fetchNearbyStationPrecip(location.lat, location.lon),
        fetchNowcastTimeline(location.lat, location.lon),
      ])

      if (forecastResult.status === 'fulfilled') {
        const data = forecastResult.value
        // 12 h Open-Meteo series — drives the RainRibbon overview chart.
        const omTimes   = data.minutely_15?.time ?? []
        const omPrecips = data.minutely_15?.precipitation ?? []

        // Current "now" measurements — any signal seeing rain wins:
        // - Open-Meteo current.precip   — model-measured last hour (can lag)
        // - GeoSphere TAWES nearest 6+airport — actual station obs, 10-min updates
        const measured      = data.current?.precipitation ?? 0
        const stationPrecip = stationResult?.status === 'fulfilled' ? (stationResult.value ?? 0) : 0
        const nowPrecip     = Math.max(measured, stationPrecip)

        // Gap timeline: prefer the GeoSphere 1 km / 15-min radar nowcast (catches
        // convective rain the ICON-EU model lags on); fall back to Open-Meteo.
        // Anchor a real "now" slot from live measurements so gap timing is exact.
        const nowcast = nowcastResult.status === 'fulfilled' ? nowcastResult.value : null
        const nowSec = Math.floor(Date.now() / 1000)
        const timeline = nowcast
          ? { times: [nowSec, ...nowcast.times], precips: [nowPrecip, ...nowcast.precips] }
          : { times: omTimes, precips: omPrecips }

        const { currentPrecip: cp, gaps: detectedGaps, nextRainAt, dryEndsOpen } = detectGaps(timeline.times, timeline.precips)
        const effectivePrecip = cp === null ? null : Math.max(cp, nowPrecip)
        setForecast({ times: omTimes, precips: omPrecips })
        setCurrentPrecip(effectivePrecip)
        setGaps(detectedGaps)
        setTrend({ nextRainAt, dryEndsOpen })
        setTickNow(Math.floor(Date.now() / 1000))
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

  // NOTE: do NOT auto-request geolocation on mount. Safari and Firefox suppress
  // (or never show) the permission prompt unless the request originates from a
  // user gesture — the "GET MY LOCATION" button in LocationPrompt provides it.

  useEffect(() => {
    if (!location) return
    loadData()
    const id = setInterval(loadData, REFRESH_MS)
    return () => clearInterval(id)
  }, [location, loadData])

  // Make the browser / Android back button close the About panel instead of
  // navigating away from the app: push a history entry while it's open and
  // close on popstate.
  useEffect(() => {
    if (!infoOpen) return
    window.history.pushState({ infoPanel: true }, '')
    const onPop = () => setInfoOpen(false)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [infoOpen])

  const closeInfo = () => {
    // Route close through history so the X button, the backdrop and the back
    // button all consume the pushed entry consistently.
    if (window.history.state?.infoPanel) window.history.back()
    else setInfoOpen(false)
  }

  const headerProps = {
    theme, onThemeToggle: () => setTheme(prev => prev === 'dark' ? 'light' : 'dark'),
    lang,  onLangToggle:  () => setLang(prev  => prev === 'de'   ? 'en'   : 'de'),
    onInfo: () => setInfoOpen(true),
    t,
    // below only meaningful once we have location data
    accuracy:     location ? accuracy     : null,
    lastUpdated:  location ? lastUpdated  : null,
    onRefresh:    location ? loadData     : null,
    loading:      location ? loading      : false,
    notifyState:  location ? notifyState  : 'unsupported',
    onNotifyToggle: location ? toggleNotifications : null,
    installable: installable && !isStandalone,
    onInstall: async () => {
      if (installPromptRef.current) {
        installPromptRef.current.prompt()
        const { outcome } = await installPromptRef.current.userChoice
        if (outcome === 'accepted') setInstallable(false)
      }
    },
    iosHint,
    onDismissIosHint: () => {
      setIosHintDismissed(true)
      try { localStorage.setItem('ios_hint_dismissed', '1') } catch {}
    },
  }

  return (
    <div className="flex flex-col h-full bg-bg text-primary overflow-hidden">
      <Header {...headerProps} />

      {notifyMsg && (
        <button
          onClick={() => setNotifyMsg(null)}
          className="w-full text-left px-4 py-2 bg-surface border-b border-border shrink-0 flex items-start gap-2"
        >
          <span className="font-mono text-xs text-wait leading-relaxed flex-1">{t(notifyMsg)}</span>
          <span className="font-mono text-xs text-muted shrink-0">✕</span>
        </button>
      )}

      {!location ? (
        <LocationPrompt
          loading={locating}
          error={locationError}
          onRequest={requestLocation}
          onUseDefault={useDefaultLocation}
          t={t}
        />
      ) : farAway ? (
        <FarAway
          km={Math.round(kmFromSalzburg(location))}
          onViewSalzburg={useDefaultLocation}
          t={t}
        />
      ) : (
        <>
          {isOutsideSalzburg(location) && (
            <div className="px-4 py-2 bg-surface border-b border-border shrink-0">
              <span className="font-mono text-xs text-wait">⚠ {t('outside_sbz')}</span>
            </div>
          )}
          <GapBanner status={status} />
          <RainRibbon forecast={forecast} theme={theme} t={t} />
          <RadarMap location={location} areaPrecip={areaPrecip} theme={theme} t={t} />
        </>
      )}

      <InfoPanel open={infoOpen} onClose={closeInfo} t={t} />
    </div>
  )
}
