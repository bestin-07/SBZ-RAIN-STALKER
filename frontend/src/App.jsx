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
import NotifyModal from './components/NotifyModal'
import PrivacyPanel from './components/PrivacyPanel'

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
  const [notifyModalOpen, setNotifyModalOpen] = useState(false)
  const [locationAccuracy, setLocationAccuracy] = useState(null) // metres from pos.coords.accuracy
  const [upgradingLocation, setUpgradingLocation] = useState(false)
  const [accuracyDismissed, setAccuracyDismissed] = useState(false)
  const [stormCape, setStormCape] = useState(null)
  const [uvIndex, setUvIndex] = useState(null)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const privacyOpenRef = useRef(false)
  useEffect(() => { privacyOpenRef.current = privacyOpen }, [privacyOpen])
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

  // Derived warning signals — no extra API calls, computed from existing data
  const regionalThunder = areaPrecip.some(a => a.code != null && a.code >= 80)
  const regionalFullStorm = areaPrecip.some(a => a.code != null && a.code >= 95)
  const windWarning     = currentWeather?.wind != null && currentWeather.wind >= 50
  const windStrong      = currentWeather?.wind != null && currentWeather.wind >= 70
  const showCloudyNote  = currentWeather?.code === 3 && status?.type === 'go'

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

  // Bell tapped: if not yet subscribed, open the modal first so the user
  // explicitly presses "Turn on" (cleaner consent UX). If already subscribed,
  // unsubscribe immediately and show a brief confirmation toast.
  const toggleNotifications = useCallback(async () => {
    if (notifyState === 'unsupported') return
    if (notifyState === 'denied') { setNotifyMsg('notify_blocked'); return }

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
      setNotifyMsg('notify_off')
      return
    }

    // Not yet subscribed — show the opt-in modal
    setNotifyModalOpen(true)
  }, [notifyState, isIOS, isStandalone])

  // Called when the user presses "Turn on" inside the NotifyModal
  const handleNotifyConfirm = useCallback(async () => {
    setNotifyModalOpen(false)
    try {
      const keyRes = await fetch(`${import.meta.env.VITE_BACKEND_URL ?? ''}/api/vapid-public-key`)
      if (!keyRes.ok) return
      const { publicKey } = await keyRes.json()

      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setNotifyState('denied'); return }

      const reg = await navigator.serviceWorker.ready
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
  }, [])

  // Auto-dismiss the "turned off" toast after 3 s
  useEffect(() => {
    if (notifyMsg !== 'notify_off') return
    const id = setTimeout(() => setNotifyMsg(null), 3000)
    return () => clearTimeout(id)
  }, [notifyMsg])

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
        setLocationAccuracy(Math.round(pos.coords.accuracy))
        setLocationError(null)
        setLocating(false)
      },
      err => {
        setLocating(false)
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        setLocationError(err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable')
      },
      // enableHighAccuracy: false — network/WiFi location (100-500m) is
      // sufficient for a 1 km nowcast grid. GPS (true) forces hardware
      // that cold-starts in 30-60 s, causing near-certain 10 s timeouts.
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    )
  }, [])

  // User-initiated GPS upgrade — only called from the accuracy banner,
  // so the browser allows the prompt and GPS has 30 s to warm up.
  const upgradeLocation = useCallback(() => {
    setUpgradingLocation(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setLocationAccuracy(Math.round(pos.coords.accuracy))
        setUpgradingLocation(false)
      },
      () => { setUpgradingLocation(false) },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
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
        const stationData   = stationResult?.status === 'fulfilled' ? stationResult.value : null
        const stationPrecip = stationData?.precip ?? 0
        const stationTemp   = stationData?.temp ?? null
        // When TAWES sensors are available and confirm 0mm, require Open-Meteo to
        // be strictly above the threshold (not just == 0.10) before overriding.
        // Open-Meteo model rounds to 0.10mm increments and routinely reports exactly
        // 0.10mm during cloudy/drizzly conditions that sensors don't detect — taking
        // the max would falsely trigger "wet" status.
        const omForNow = stationData !== null && stationPrecip === 0
          ? (measured > 0.1 ? measured : 0)
          : measured
        const nowPrecip = Math.max(omForNow, stationPrecip)

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
        // Ribbon: 3h nowcast only — radar-based, user's exact location.
        // Open-Meteo tail (3–12h) stripped: it's a broad model and looks as
        // confident as the radar data, which it isn't.
        setForecast({ times: timeline.times, precips: timeline.precips, isNowcast: !!nowcast })
        setCurrentPrecip(effectivePrecip)
        setGaps(detectedGaps)
        setTrend({ nextRainAt, dryEndsOpen })
        setTickNow(Math.floor(Date.now() / 1000))
        setCurrentWeather({
          temp: stationTemp ?? data.current?.temperature_2m ?? null,
          wind: data.current?.wind_speed_10m ?? null,
          code: data.current?.weather_code ?? null,
        })
        // Severe storm potential — Alpine/Salzburg specific threshold.
        // CAPE > 1500 J/kg during afternoon hours (12-21h local) signals
        // extreme convective instability. Gap timings become unreliable
        // as cells can fire and intensify within 15-20 min.
        const localHour = new Date().getHours()
        const cape = data.current?.cape ?? null
        const severeStorm = cape !== null && cape >= 1500 && localHour >= 12 && localHour < 21
        setStormCape(severeStorm ? cape : null)
        const uv = data.current?.uv_index ?? null
        setUvIndex(uv !== null && uv >= 6 && localHour >= 7 && localHour < 20 ? uv : null)
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

  // Back button closes the InfoPanel — unless PrivacyPanel is stacked on top,
  // in which case PrivacyPanel's own popstate handler handles the back press.
  // privacyOpenRef is a ref (not state) so the check is synchronous and never stale.
  useEffect(() => {
    if (!infoOpen) return
    window.history.pushState({ infoPanel: true }, '')
    const onPop = () => {
      if (privacyOpenRef.current) return
      setInfoOpen(false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [infoOpen])

  const closeInfo = () => {
    if (window.history.state?.infoPanel) window.history.back()
    else setInfoOpen(false)
  }

  useEffect(() => {
    if (!privacyOpen) return
    window.history.pushState({ privacyPanel: true }, '')
    const onPop = () => setPrivacyOpen(false)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [privacyOpen])

  // source: 'info' | 'modal' | null
  // Keep the originating panel alive underneath so back/✕ returns the user to it.
  const openPrivacy = useCallback((source = null) => {
    if (source !== 'info')  setInfoOpen(false)
    if (source !== 'modal') setNotifyModalOpen(false)
    setPrivacyOpen(true)
  }, [])

  const closePrivacy = () => {
    if (window.history.state?.privacyPanel) window.history.back()
    else setPrivacyOpen(false)
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
          onPrivacy={openPrivacy}
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
          {locationAccuracy > 100 && !accuracyDismissed && (
            <div className="px-4 py-2 bg-surface border-b border-border shrink-0 flex items-center gap-3">
              <span className="font-mono text-xs text-muted flex-1">
                📍 ~{locationAccuracy}m {t('loc_accuracy')}
              </span>
              <button
                onClick={upgradeLocation}
                disabled={upgradingLocation}
                className="font-mono text-xs text-primary hover:opacity-70 transition-opacity disabled:opacity-40 shrink-0"
              >
                {upgradingLocation ? '…' : t('loc_improve')}
              </button>
              <button
                onClick={() => setAccuracyDismissed(true)}
                className="font-mono text-xs text-muted hover:text-primary transition-colors shrink-0"
                aria-label="dismiss"
              >✕</button>
            </div>
          )}
          {uvIndex !== null && (
            <div className="px-4 py-2.5 bg-surface border-b border-border shrink-0 flex items-center gap-3">
              <span className="font-mono text-xs flex-1 leading-relaxed" style={{ color: '#F97316' }}>
                🌞 {uvIndex >= 8 ? t('uv_very_high') : t('uv_high')} (UV {Math.round(uvIndex)})
              </span>
            </div>
          )}
          {windWarning && (
            <div className="px-4 py-2.5 bg-surface border-b border-border shrink-0 flex items-center gap-3">
              <span className="font-mono text-xs flex-1 leading-relaxed" style={{ color: '#FB923C' }}>
                💨 {windStrong ? t('wind_strong') : t('wind_warning')} ({Math.round(currentWeather.wind)} km/h)
              </span>
            </div>
          )}
          {regionalThunder && (
            <div className="px-4 py-2.5 bg-surface border-b border-border shrink-0 flex items-center gap-3">
              <span className="font-mono text-xs flex-1 leading-relaxed" style={{ color: '#FBBF24' }}>
                ⚡ {regionalFullStorm ? t('thunder_regional') : t('showers_regional')}
              </span>
            </div>
          )}
          {stormCape && (
            <div className="px-4 py-2.5 bg-surface border-b border-border shrink-0 flex items-center gap-3">
              <span className="font-mono text-xs flex-1 leading-relaxed" style={{ color: '#FBBF24' }}>
                ⚡ {t('storm_cape_warning')}
              </span>
            </div>
          )}
          <GapBanner status={status} />
          {showCloudyNote && (
            <div className="px-4 py-2 bg-surface border-b border-border shrink-0">
              <span className="font-mono text-xs leading-relaxed" style={{ color: '#6B7280' }}>
                ☁️ {t('cloudy_note')}
              </span>
            </div>
          )}
          <RainRibbon forecast={forecast} theme={theme} t={t} />
          <RadarMap location={location} areaPrecip={areaPrecip} theme={theme} t={t} />
        </>
      )}

      <InfoPanel open={infoOpen} onClose={closeInfo} onPrivacy={() => openPrivacy('info')} t={t} />

      {notifyModalOpen && (
        <NotifyModal
          onConfirm={handleNotifyConfirm}
          onDismiss={() => setNotifyModalOpen(false)}
          onPrivacy={() => openPrivacy('modal')}
          t={t}
        />
      )}

      <PrivacyPanel open={privacyOpen} onClose={closePrivacy} t={t} />
    </div>
  )
}
