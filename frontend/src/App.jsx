import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchForecast, fetchAccuracy, fetchAreaPrecip, fetchNearbyStationPrecip, fetchNowcastTimeline, fetchRainViewerPrecip } from './api'
import { detectGaps, getStatus, DRY_THRESHOLD } from './gaps'
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

// Metres between two {lat,lon}. Used to ignore GPS jitter (a re-read a few
// hundred metres away from the same spot) that would otherwise trigger a full
// re-fetch and shift the nearest stations / nowcast cell for no real change.
const MIN_MOVE_M = 500
function metersBetween(a, b) {
  const R = 6371000, r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
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
  // Restore last known GPS from localStorage so the app loads immediately on
  // subsequent visits without waiting for the GPS permission prompt.
  const [location, setLocation] = useState(() => {
    try {
      const s = localStorage.getItem('last_location')
      return s ? JSON.parse(s) : null
    } catch { return null }
  })
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
  // Asymmetric rain hysteresis: track whether we're currently showing "raining"
  // and how many consecutive dry reads we've seen, so a lone dry blip mid-shower
  // doesn't flash GO. See loadData for the flip rules.
  const precipHoldRef = useRef({ wet: false, dryStreak: 0 })
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
        const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        setLocationAccuracy(Math.round(pos.coords.accuracy))
        setLocationError(null)
        setLocating(false)
        // Debounce jitter: keep the current fix if the new one is <500 m away,
        // so a background re-read doesn't churn the whole data pipeline.
        setLocation(prev => {
          if (prev && metersBetween(prev, loc) < MIN_MOVE_M) return prev
          try { localStorage.setItem('last_location', JSON.stringify(loc)) } catch {}
          return loc
        })
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
        const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        try { localStorage.setItem('last_location', JSON.stringify(loc)) } catch {}
        setLocation(loc)
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

  // Detect pre-blocked permission (show help immediately) or already-granted
  // permission (auto-refresh GPS silently — safe because no prompt is shown
  // when state='granted'). This lets the app load with cached location first,
  // then quietly update to the latest GPS reading in the background.
  useEffect(() => {
    if (!navigator.permissions?.query) return
    navigator.permissions.query({ name: 'geolocation' })
      .then(p => {
        if (p.state === 'denied') setLocationError('denied')
        else if (p.state === 'granted') requestLocation()
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadData = useCallback(async () => {
    if (!location) return
    if (kmFromSalzburg(location) > FAR_KM) return  // too far — FarAway screen shown instead
    setLoading(true)
    try {
      const [forecastResult, accuracyResult, areaResult, stationResult, nowcastResult, rvResult] = await Promise.allSettled([
        fetchForecast(location.lat, location.lon),
        fetchAccuracy(),
        fetchAreaPrecip(),
        fetchNearbyStationPrecip(location.lat, location.lon),
        fetchNowcastTimeline(location.lat, location.lon),
        fetchRainViewerPrecip(location.lat, location.lon),
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
        // RainViewer radar tile sample at the user's exact GPS pixel. Faster than
        // TAWES for new convective cells (radar sees rain ~5 min after onset vs
        // TAWES ~10 min). Returns null if CORS tile reading isn't available.
        const rvPrecip = rvResult?.status === 'fulfilled' && rvResult.value !== null
          ? rvResult.value : 0
        const nowPrecip = Math.max(omForNow, stationPrecip, rvPrecip)
        // Ground truth = physical stations + model current (no radar). When these
        // are available and read dry they are authoritative for "is it raining on
        // me right now": the radar nowcast can over-read echo that never reaches the
        // ground (virga / aloft returns), which otherwise showed light rain for 3 h
        // straight and produced a false STUCK on a dry 23°C morning (Itzling,
        // 2026-07). This is the mirror image of the Nonntal blind-spot: there radar
        // missed real rain, here it invented rain the stations never saw.
        const groundPrecip = Math.max(omForNow, stationPrecip)
        const groundDry = stationData !== null && groundPrecip < 0.1

        // Gap timeline: prefer the GeoSphere 1 km / 15-min radar nowcast (catches
        // convective rain the ICON-EU model lags on); fall back to Open-Meteo.
        // detectGaps runs on the RAW nowcast without a prepended TAWES slot so that
        // the current nowcast slot (e.g. 23:15) is never shadowed by a synthetic
        // nowSec entry (e.g. 23:17) that would push the real slot out of the
        // detection window — which caused STUCK when the ribbon correctly showed a gap.
        // TAWES still protects against false-GO via effectivePrecip: if sensors show
        // active rain but the nowcast gap has already started, gapNow in getStatus
        // routes to GO (trust the model) — the intended "clearing" behaviour.
        const nowcast = nowcastResult.status === 'fulfilled' ? nowcastResult.value : null
        const nowSec = Math.floor(Date.now() / 1000)
        const gapTimeline = nowcast
          ? { times: nowcast.times, precips: nowcast.precips }
          : { times: [nowSec, ...omTimes], precips: [nowPrecip, ...omPrecips] }

        // When the ground says dry, correct only the nowcast's *current* slot to
        // dry before gap detection. The radar nowcast can over-read a light echo
        // over your head that never reaches the ground (virga); left as-is, that
        // current-slot blip makes detectGaps think it's "raining now" — so it can't
        // report the real next rain (headline says "clear") or my earlier fix cried
        // "rain any minute". Zeroing just the current slot keeps the nowcast's
        // genuine *future* rain intact, so we report the true onset (e.g. "rain in
        // ~1h" when it's building later) rather than reacting to the blip.
        let gapPrecips = gapTimeline.precips
        if (groundDry) {
          const ts = gapTimeline.times
          let idx = 0, best = Infinity
          for (let i = 0; i < ts.length; i++) {
            const d = Math.abs(ts[i] - nowSec)
            if (d < best) { best = d; idx = i }
          }
          gapPrecips = gapTimeline.precips.map((p, i) => (i === idx ? 0 : p))
        }

        const { currentPrecip: cp, gaps: detectedGaps, nextRainAt, dryEndsOpen } = detectGaps(gapTimeline.times, gapPrecips)
        // If the ground says dry, trust it — never let the radar nowcast alone force
        // a raining/STUCK state. Otherwise catch rain the stations miss via the max
        // of the nowcast now-slot + measured + radar-at-pixel (the Nonntal case).
        const effectivePrecip = cp === null
          ? null
          : groundDry
            ? groundPrecip
            : Math.max(cp, nowPrecip)
        // Ribbon: anchor a real "now" bar from TAWES so the chart reflects the live
        // reading, even though gap detection uses the raw nowcast above.
        const ribbonTimeline = nowcast
          ? { times: [nowSec, ...nowcast.times], precips: [nowPrecip, ...nowcast.precips] }
          : { times: omTimes, precips: omPrecips }
        setForecast({ times: ribbonTimeline.times, precips: ribbonTimeline.precips, isNowcast: !!nowcast })

        // Asymmetric hysteresis to stop single-read flicker between refreshes:
        // flip to "raining" instantly (onset is urgent, no lag), but require 2
        // consecutive dry reads (~10 min) before clearing — a lone dry reading
        // mid-shower shouldn't flash GO. A radar/sensor spike is trusted at once.
        let displayPrecip = effectivePrecip
        if (effectivePrecip !== null) {
          const hold = precipHoldRef.current
          if (effectivePrecip >= DRY_THRESHOLD) {
            hold.wet = true
            hold.dryStreak = 0
          } else if (hold.wet) {
            hold.dryStreak += 1
            if (hold.dryStreak < 2) displayPrecip = DRY_THRESHOLD  // hold one more cycle
            else hold.wet = false
          }
        }
        setCurrentPrecip(displayPrecip)
        setGaps(detectedGaps)
        // Model rain probability for the hour the onset falls in — lets getStatus
        // soften a radar countdown the model isn't confident about (radar over-read
        // / virga) vs a firm "rain in X min" when the probability backs it up.
        const hTimes = data.hourly?.time ?? []
        const hProb  = data.hourly?.precipitation_probability ?? []
        let rainProb = null
        if (nextRainAt && hTimes.length) {
          let bi = 0, bd = Infinity
          for (let i = 0; i < hTimes.length; i++) {
            const d = Math.abs(hTimes[i] - nextRainAt)
            if (d < bd) { bd = d; bi = i }
          }
          rainProb = typeof hProb[bi] === 'number' ? hProb[bi] : null
        }
        setTrend({ nextRainAt, dryEndsOpen, rvRainActive: rvPrecip >= DRY_THRESHOLD, rainProb })
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
              <span className="font-mono text-xs flex-1 leading-relaxed" style={{ color: 'var(--c-uv)' }}>
                🌞 {uvIndex >= 8 ? t('uv_very_high') : t('uv_high')} (UV {Math.round(uvIndex)})
              </span>
            </div>
          )}
          {windWarning && (
            <div className="px-4 py-2.5 bg-surface border-b border-border shrink-0 flex items-center gap-3">
              <span className="font-mono text-xs flex-1 leading-relaxed" style={{ color: 'var(--c-warn)' }}>
                💨 {windStrong ? t('wind_strong') : t('wind_warning')} ({Math.round(currentWeather.wind)} km/h)
              </span>
            </div>
          )}
          {regionalThunder && (
            <div className="px-4 py-2.5 bg-surface border-b border-border shrink-0 flex items-center gap-3">
              <span className="font-mono text-xs flex-1 leading-relaxed" style={{ color: 'var(--c-alert)' }}>
                ⚡ {regionalFullStorm ? t('thunder_regional') : t('showers_regional')}
              </span>
            </div>
          )}
          {stormCape && (
            <div className="px-4 py-2.5 bg-surface border-b border-border shrink-0 flex items-center gap-3">
              <span className="font-mono text-xs flex-1 leading-relaxed" style={{ color: 'var(--c-alert)' }}>
                ⚡ {t('storm_cape_warning')}
              </span>
            </div>
          )}
          <GapBanner status={status} />
          {showCloudyNote && (
            <div className="px-4 py-2 bg-surface border-b border-border shrink-0">
              <span className="font-mono text-xs leading-relaxed text-muted">
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
