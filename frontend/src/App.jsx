import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchForecast, fetchAccuracy, fetchAreaPrecip, fetchNearbyStationPrecip, fetchNowcastTimeline, fetchRainViewerPrecip, ambientFormingTs, ambientAreaWatch, AREAS } from './api'
import { detectGaps, getStatus, firstDownpourMin, surfaceDrizzle, isUnsettled, modelNextRainAt, modelNowValue, modelEaseAt, hasTraceEcho, traceAheadMin, tracePhantom, combineModelSeries, DRY_THRESHOLD, UNSETTLED_CAPE } from './gaps'
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
import InstallPrompt from './components/InstallPrompt'
import UpdateNote from './components/UpdateNote'

const REFRESH_MS = 5 * 60 * 1000
// Narrative continuity: a small story kept in localStorage so a refresh/re-open
// a few minutes later stays coherent instead of contradicting itself.
const STORY_RADIUS_M   = 1000        // continuity only trusted within 1 km of the stored spot
const RECENT_RAIN_MS   = 15 * 60 * 1000  // "was raining recently" → softer WORDING only (no state forcing)

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
      const p = JSON.parse(localStorage.getItem('last_location') || 'null')
      return (p && typeof p.lat === 'number' && typeof p.lon === 'number') ? { lat: p.lat, lon: p.lon } : null
    } catch { return null }
  })
  // When the stored location was last confirmed (ms) — drives the "location may be
  // outdated" nudge so a user who moved (e.g. cycled across town) is prompted to
  // re-fetch via the map crosshair. Null for legacy stored locations (no timestamp).
  const [locationTime, setLocationTime] = useState(() => {
    try {
      const p = JSON.parse(localStorage.getItem('last_location') || 'null')
      return (p && typeof p.ts === 'number') ? p.ts : null
    } catch { return null }
  })
  const [staleDismissed, setStaleDismissed] = useState(false)
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
  const [areaStatus, setAreaStatus] = useState([])  // per-town computed status → dot colour + popup
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
  const [unsettled, setUnsettled] = useState(false)   // convective-watch Layer 1 (regime)
  const [capeUnstable, setCapeUnstable] = useState(false) // CAPE ≥ 300 → ribbon dry-label says "can change fast"
  const [modelRainMin, setModelRainMin] = useState(null)  // model's first wet slot (min from now) — ribbon dry-label second opinion
  const [formingTs, setFormingTs] = useState(null)    // convective-watch Layer 2 (radar-confirmed)
  const [areaWatch, setAreaWatch] = useState(null)    // city-scale wet/dry direction + trend (v2.4)
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
  const isAndroid   = /Android/.test(_ua)
  const iosHint = (!isStandalone && !iosHintDismissed)
    ? (isIOSSafari ? 'ios_install' : isIOSOther ? 'ios_open_safari' : null)
    : null

  const t = useI18n(lang)
  const status = getStatus(currentPrecip, gaps, currentWeather, t, tickNow, trend)
  const farAway = location ? kmFromSalzburg(location) > FAR_KM : false
  // Nudge to re-fetch location once the current fix is over an hour old (tickNow
  // advances every minute, so this flips on live). Dismissible; reappears only
  // after a fresh fix goes stale again.
  const showStaleBanner = !!location && !farAway && !staleDismissed &&
    locationTime != null && (tickNow * 1000 - locationTime) > 60 * 60 * 1000

  // Derived warning signals — no extra API calls, computed from existing data
  const regionalThunder = areaPrecip.some(a => a.code != null && a.code >= 80)
  const regionalFullStorm = areaPrecip.some(a => a.code != null && a.code >= 95)
  const windWarning     = currentWeather?.wind != null && currentWeather.wind >= 50
  const windStrong      = currentWeather?.wind != null && currentWeather.wind >= 70
  // "cloudy but dry — worth heading out" only when there's actually a dry window:
  // suppress if rain is imminent (would contradict a countdown) and only in daylight
  // (6:00–20:00) — "worth heading out" reads odd at 22:47, and it's not about the sun.
  const rainImminent    = trend.nextRainAt != null && (trend.nextRainAt - tickNow) <= 90 * 60
  const hourNow         = new Date(tickNow * 1000).getHours()
  const showCloudyNote  = currentWeather?.code === 3 && status?.type === 'go' && !rainImminent &&
                          hourNow >= 6 && hourNow < 20
  // Radar-confirmed initiation stays visible for 30 min after the backend stamps it
  // (tickNow-driven, so it expires live without a refresh).
  const formingActive   = formingTs != null && (tickNow - formingTs) < 30 * 60 && (tickNow - formingTs) >= 0

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

  // Persist a fresh fix + its timestamp, and clear the stale nudge. Called on
  // every successful GPS read (even a jittery one) so "location confirmed at" is
  // accurate — the 500 m debounce below only governs whether we re-fetch data.
  const rememberLocation = useCallback((loc) => {
    try { localStorage.setItem('last_location', JSON.stringify({ lat: loc.lat, lon: loc.lon, ts: Date.now() })) } catch {}
    setLocationTime(Date.now())
    setStaleDismissed(false)
  }, [])

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError('unsupported')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        rememberLocation(loc)
        setLocationAccuracy(Math.round(pos.coords.accuracy))
        setLocationError(null)
        setLocating(false)
        // Debounce jitter: keep the current fix if the new one is <500 m away,
        // so a background re-read doesn't churn the whole data pipeline.
        setLocation(prev => (prev && metersBetween(prev, loc) < MIN_MOVE_M) ? prev : loc)
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
  }, [rememberLocation])

  // User-initiated GPS upgrade — only called from the accuracy banner,
  // so the browser allows the prompt and GPS has 30 s to warm up.
  const upgradeLocation = useCallback(() => {
    setUpgradingLocation(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        rememberLocation(loc)
        setLocation(loc)
        setLocationAccuracy(Math.round(pos.coords.accuracy))
        setUpgradingLocation(false)
      },
      () => { setUpgradingLocation(false) },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
    )
  }, [rememberLocation])

  // Explicit "update my location" — bound to the map's crosshair button so a user
  // who has moved (e.g. cycled across town) can force a fresh fix. Bypasses the
  // 500 m jitter debounce (this is an intentional tap) and always applies the new
  // coords, which re-centres the map and reloads data for the new spot.
  const relocate = useCallback(() => {
    if (!navigator.geolocation) return
    setUpgradingLocation(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        rememberLocation(loc)
        setLocation(loc)
        setLocationAccuracy(Math.round(pos.coords.accuracy))
        setUpgradingLocation(false)
      },
      () => { setUpgradingLocation(false) },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }, [rememberLocation])

  // Snapshot status for an arbitrary point (a tapped map dot / Salzburg centre).
  // Mirrors loadData's blend but WITHOUT the user-only continuity (no story /
  // hysteresis / RainViewer) — a clean one-shot for "what would it say here".
  const computeStatusAt = useCallback(async (lat, lon) => {
    const [fRes, sRes, nRes, rvRes] = await Promise.allSettled([
      fetchForecast(lat, lon),
      fetchNearbyStationPrecip(lat, lon),
      fetchNowcastTimeline(lat, lon),
      fetchRainViewerPrecip(lat, lon),   // same radar sample the user's location gets
    ])
    // Resilient like loadData: proceed if ANY source resolved (Open-Meteo can 429),
    // else the popup would read "couldn't load" even though GeoSphere is fine.
    const data        = fRes.status === 'fulfilled' ? fRes.value : null
    const stationData = sRes.status === 'fulfilled' ? sRes.value : null
    const nowcast     = nRes.status === 'fulfilled' ? nRes.value : null
    const rv          = rvRes.status === 'fulfilled' && rvRes.value !== null ? rvRes.value : null
    const rvPrecip    = rv?.now ?? 0
    // Approaching: pixel clear NOW but a RainViewer forecast frame (observed echo
    // motion, 10-min steps) shows rain arriving in ~N min. Moving echo ≠ clutter.
    const rvApproachMin = rvPrecip < DRY_THRESHOLD ? (rv?.approachMin ?? null) : null
    // Ring watch (v2.4): echo sitting ~15km out in some compass sector while the
    // pixel is dry — direction for the approach line, or a "nearby, watching" lead
    // when there's no arrival ETA yet.
    const rvApproachDir = rvApproachMin != null ? (rv?.fromDir ?? null) : null
    const rvNearbyDir   = rvApproachMin == null ? (rv?.fromDir ?? null) : null
    if (!data && !nowcast && stationData === null) return null
    const omTimes   = data?.minutely_15?.time ?? []
    // Model union (v2.7) — same combined series as loadData, so a tapped dot's
    // verdict rests on the same forecast lane the ribbon draws.
    const omPrecips = combineModelSeries(
      omTimes, data?.minutely_15?.precipitation ?? [],
      data?.arome?.times, data?.arome?.precips)
    const measured  = data?.current?.precipitation ?? 0
    const stationPrecip = stationData?.precip ?? 0
    const omForNow = modelNowValue(measured, stationData !== null, stationPrecip)
    const groundPrecip = Math.max(omForNow, stationPrecip)
    const groundDry = stationData !== null && groundPrecip < DRY_THRESHOLD
    const nowSec = Math.floor(Date.now() / 1000)
    const gapTimeline = nowcast
      ? { times: nowcast.times, precips: nowcast.precips }
      : { times: [nowSec, ...omTimes], precips: [groundPrecip, ...omPrecips] }
    let gapPrecips = gapTimeline.precips
    if (groundDry) {
      const ts = gapTimeline.times
      let idx = 0, best = Infinity
      for (let i = 0; i < ts.length; i++) { const dd = Math.abs(ts[i] - nowSec); if (dd < best) { best = dd; idx = i } }
      gapPrecips = gapTimeline.precips.map((p, i) => (i === idx ? 0 : p))
    }
    const { currentPrecip: cp, gaps, nextRainAt, dryEndsOpen } = detectGaps(gapTimeline.times, gapPrecips)
    // Raw nowcast value at "now" (un-zeroed) — to catch a drizzle the gauge misses.
    let rawNowSlot = 0
    if (nowcast) {
      let bi = 0, bd = Infinity
      for (let i = 0; i < nowcast.times.length; i++) { const dd = Math.abs(nowcast.times[i] - nowSec); if (dd < bd) { bd = dd; bi = i } }
      rawNowSlot = nowcast.precips[bi] ?? 0
    }
    // Trace-ahead (v2.5): sub-threshold drizzle starting later on the radar timeline.
    // v2.8: dual-key phantom guard — clear sky + a fully quiet RainViewer overrule
    // the nowcast's model-blend trace noise (see gaps.tracePhantom).
    const phantomTrace = tracePhantom(data?.current?.weather_code, rv)
    const traceAheadM = (!phantomTrace && nowcast) ? traceAheadMin(nowcast.times, nowcast.precips, nowSec) : null
    // Same surfacing rule as loadData (v1.1 + clear-sky clutter guard, v1.1.5) so a
    // town dot matches your live verdict: gauge dry but radar sees a LIGHT drizzle →
    // GO ANYWAY (capped, never STUCK) — unless the only witness is the raw RainViewer
    // pixel under a sunny sky (ground clutter).
    let effectivePrecip, drizzleSurfaced = false
    if (cp === null) {
      effectivePrecip = null
    } else if (stationData !== null) {
      effectivePrecip = groundPrecip
      const surfaced = surfaceDrizzle(groundPrecip, rawNowSlot, rvPrecip, data?.current?.weather_code, rv?.rvSolid ?? false)
      if (surfaced !== null) { effectivePrecip = surfaced; drizzleSurfaced = true }
    } else {
      effectivePrecip = Math.max(cp, groundPrecip, rvPrecip)
    }
    let maxSoon = null
    if (nowcast) {
      const lim = nowSec + 45 * 60
      const soon = nowcast.times.map((tt, i) => ({ tt, p: nowcast.precips[i] ?? 0 }))
        .filter(sl => sl.tt >= nowSec && sl.tt <= lim).map(sl => sl.p)
      if (soon.length) maxSoon = Math.max(...soon)
    }
    const downpourSoonMin = firstDownpourMin(nowcast, nowSec)
    const modelRainAt = modelNextRainAt(omTimes, omPrecips, nowSec)
    const modelEase = modelEaseAt(omTimes, omPrecips, nowSec)
    let rainProb = null
    const hTimes = data?.hourly?.time ?? [], hProb = data?.hourly?.precipitation_probability ?? []
    if (nextRainAt && hTimes.length) {
      let bi = 0, bd = Infinity
      for (let i = 0; i < hTimes.length; i++) { const dd = Math.abs(hTimes[i] - nextRainAt); if (dd < bd) { bd = dd; bi = i } }
      rainProb = typeof hProb[bi] === 'number' ? hProb[bi] : null
    }
    const weather = {
      temp: stationData?.temp ?? data?.current?.temperature_2m ?? null,
      wind: data?.current?.wind_speed_10m ?? null,
      code: data?.current?.weather_code ?? null,
    }
    return getStatus(effectivePrecip, gaps, weather, t, nowSec,
      { nextRainAt, dryEndsOpen, rvRainActive: rvPrecip >= DRY_THRESHOLD || drizzleSurfaced, rainProb, recentRain: false, maxSoon, downpourSoonMin, modelRainAt, modelEaseAt: modelEase, rvApproachMin, rvApproachDir, rvNearbyDir, traceEcho: !phantomTrace && hasTraceEcho(rawNowSlot), traceAheadMin: traceAheadM })
  }, [t])

  // Compute status for every surrounding town + Salzburg centre → colours the map
  // dots by GO/PASST SCHON/WAIT/STUCK and seeds the tap popups (so dot colour and
  // popup always agree). Re-runs on location + language change (below) and every
  // 10 min. Uses computeStatusAt, so the strings are localized to the current lang.
  // Compute every point's status → colours the dots to MATCH the tap popup / verdict
  // (grey precip-fallback made a dry town look grey next to a GEMMA RAUS popup). Runs
  // on location + language change and every 10 min — safe now the render loop is
  // fixed. Limited concurrency (5 at a time) so we don't burst GeoSphere.
  const refreshAreaStatuses = useCallback(() => {
    const pts = [...AREAS, { name: 'Salzburg', lat: SBZ_CENTER.lat, lon: SBZ_CENTER.lon }]
    const out = new Array(pts.length)
    let idx = 0
    const worker = async () => {
      while (idx < pts.length) {
        const i = idx++, p = pts[i]
        try { out[i] = { ...p, status: await computeStatusAt(p.lat, p.lon) } }
        catch { out[i] = { ...p, status: null } }
      }
    }
    Promise.all(Array.from({ length: Math.min(5, pts.length) }, worker))
      .then(() => setAreaStatus(out))
      .catch(() => {})
  }, [computeStatusAt])

  // Fallback so the app is usable even if GPS never resolves (Salzburg centre).
  const useDefaultLocation = useCallback(() => {
    setLocation({ lat: 47.8009, lon: 13.0448 })
    setLocationTime(Date.now())   // chosen centre — don't nag it as "outdated"
    setStaleDismissed(false)
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

      // Sources gathered up front. Open-Meteo (forecast) can 429 / go down; when it
      // does we must NOT get stuck on "checking" while the GeoSphere nowcast + TAWES
      // are fine — so we proceed if ANY primary source resolved and null-guard the OM
      // fields (weather notes, probability, OM-current just degrade gracefully).
      const data        = forecastResult.status === 'fulfilled' ? forecastResult.value : null
      const nowcast     = nowcastResult.status === 'fulfilled' ? nowcastResult.value : null
      const stationData = stationResult?.status === 'fulfilled' ? stationResult.value : null
      // RainViewer is a CDN (unmetered) and survives when all three metered sources
      // (Open-Meteo daily limit + GeoSphere rate limit) are exhausted at once — which
      // otherwise leaves the app stuck forever on "checking". It already flows into
      // effectivePrecip via nowPrecip below, so admitting it here degrades gracefully
      // to a radar-only read (clear / light drizzle) instead of an infinite spinner.
      const rvOk = rvResult?.status === 'fulfilled' && rvResult.value !== null
      if (data || nowcast || stationData !== null || rvOk) {
        // 12 h Open-Meteo series — drives the RainRibbon overview chart.
        // v2.7: unioned with the backend-fetched AROME tail (radar-assimilating,
        // hourly) — whichever model shows rain is displayed, stronger wins per
        // slot. Everything downstream (gap fallback, second-opinions, ribbon
        // tail, ghost bars) reads the combined series.
        const omTimes   = data?.minutely_15?.time ?? []
        const omPrecips = combineModelSeries(
          omTimes, data?.minutely_15?.precipitation ?? [],
          data?.arome?.times, data?.arome?.precips)

        // Current "now" measurements — any signal seeing rain wins:
        // - Open-Meteo current.precip   — model-measured last hour (can lag)
        // - GeoSphere TAWES nearest 6+airport — actual station obs, 10-min updates
        const measured      = data?.current?.precipitation ?? 0
        const stationPrecip = stationData?.precip ?? 0
        const stationTemp   = stationData?.temp ?? null
        // Model-current contribution (v2.0.1, gaps.modelNowValue): a reporting gauge
        // owns the NOW magnitude — the hour-lagged model current is capped at the
        // light band (0.4) and zeroed below 0.10 vs a 0-reading gauge, so a stale
        // model value can never manufacture WAIT/STUCK on the trailing edge.
        const omForNow = modelNowValue(measured, stationData !== null, stationPrecip)
        // RainViewer radar at your exact GPS pixel — { now, soon }. `now` is the
        // freshest is-it-raining signal we have (~5 min latency); `soon` is the
        // forecast frame ~20–30 min out (observed echo motion) → the "approaching"
        // guard. Null if the CORS tile read isn't available.
        const rv = rvResult?.status === 'fulfilled' && rvResult.value !== null
          ? rvResult.value : null
        const rvPrecip = rv?.now ?? 0
        const rvApproachMin = rvPrecip < DRY_THRESHOLD ? (rv?.approachMin ?? null) : null
        const rvApproachDir = rvApproachMin != null ? (rv?.fromDir ?? null) : null
        const rvNearbyDir   = rvApproachMin == null ? (rv?.fromDir ?? null) : null
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
        // Raw (un-zeroed) nowcast value at "now" — gapPrecips zeroes the current slot
        // for gap detection, but here we want the real radar reading to catch a drizzle.
        let rawNowSlot = 0
        if (nowcast) {
          let bi = 0, bd = Infinity
          for (let i = 0; i < nowcast.times.length; i++) {
            const d = Math.abs(nowcast.times[i] - nowSec)
            if (d < bd) { bd = d; bi = i }
          }
          rawNowSlot = nowcast.precips[bi] ?? 0
        }
        // Trace-ahead (v2.5): sub-threshold drizzle starting later on the radar timeline.
        // v2.8: dual-key phantom guard — clear sky + a fully quiet RainViewer overrule
        // the nowcast's model-blend trace noise (see gaps.tracePhantom).
        const phantomTrace = tracePhantom(data?.current?.weather_code, rv)
        const traceAheadM = (!phantomTrace && nowcast) ? traceAheadMin(nowcast.times, nowcast.precips, nowSec) : null
        // NOW magnitude: trust the GROUND when a gauge reports — a stale/over-reading
        // radar must not force STUCK in a drizzle. BUT if the gauge reads dry while the
        // radar/RainViewer see a LIGHT drizzle at your spot the 1–3 km gauge misses
        // (hyperlocal / too fine for the bucket), surface it as GO ANYWAY — err toward
        // caution, a jacket beats a soaking (v1.1). Only light echo (0.1–0.5) surfaces,
        // bumped into the light band (not the GEMMA-RAUS trace zone) and capped so it can
        // NEVER become a false STUCK; a genuine heavier cell keeps the ground's dry call.
        let effectivePrecip, drizzleSurfaced = false
        if (cp === null) {
          effectivePrecip = null
        } else if (stationData !== null) {
          effectivePrecip = groundPrecip
          // v1.1 surfacing + v1.1.5 clear-sky clutter guard + v2.4.1 solid-field
          // self-corroboration (see gaps.surfaceDrizzle)
          const surfaced = surfaceDrizzle(groundPrecip, rawNowSlot, rvPrecip, data?.current?.weather_code, rv?.rvSolid ?? false)
          if (surfaced !== null) { effectivePrecip = surfaced; drizzleSurfaced = true }
        } else {
          effectivePrecip = Math.max(cp, nowPrecip)
        }
        // Peak nowcast intensity over the next 45 min — lets getStatus offer the
        // "light rain, go anyway" nuance only when no real downpour is imminent.
        let maxSoon = null
        if (nowcast) {
          const lim = nowSec + 45 * 60
          const soon = nowcast.times
            .map((tt, i) => ({ tt, p: nowcast.precips[i] ?? 0 }))
            .filter(sl => sl.tt >= nowSec && sl.tt <= lim)
            .map(sl => sl.p)
          if (soon.length) maxSoon = Math.max(...soon)
        }
        const downpourSoonMin = firstDownpourMin(nowcast, nowSec)
        // Model second-opinion (v1.4): the model's own first wet slot within 3 h —
        // consulted by getStatus only when the radar claims a full all-clear.
        const modelRainAt = modelNextRainAt(omTimes, omPrecips, nowSec)
        setModelRainMin(modelRainAt ? Math.max(0, Math.round((modelRainAt - nowSec) / 60)) : null)
        // …and its STUCK-side mirror (v2.1): when does the model say this rain ENDS.
        const modelEase = modelEaseAt(omTimes, omPrecips, nowSec)
        // Ribbon: make the chart tell the SAME truth as the headline, so it can't
        // show "raining now" while the verdict says GO.
        //  • leading "now" bar = effectivePrecip (ground-trusted) — not nowPrecip,
        //    which folds in the binary RainViewer echo (0/0.3) and made the first
        //    bar flicker dry↔light between refreshes.
        //  • nowcast slots = gapPrecips (the virga-corrected series: current slot
        //    zeroed when the ground reads dry) — not the raw nowcast, whose light
        //    echo aloft painted rain bars over a dry verdict.
        // Future slots keep the real radar forecast, so an actual build-up still shows.
        const nowBar = effectivePrecip == null ? 0 : effectivePrecip
        const ribbonTimeline = nowcast
          ? { times: [nowSec, ...nowcast.times], precips: [nowBar, ...gapPrecips] }
          : { times: omTimes, precips: omPrecips }
        // Extend the ribbon to 12h (v2.2): radar only reaches ~3h, so beyond its last
        // slot append the MODEL's own timeline (already fetched to 12h for the ghost
        // bars/second-opinions above) — zero extra API cost. radarUntil marks the
        // handoff point so the renderer can draw hours 3–12 as clearly "model" bars
        // rather than pretending radar precision that far out.
        const radarUntil = ribbonTimeline.times[ribbonTimeline.times.length - 1] ?? nowSec
        const horizon12h = nowSec + 12 * 3600
        const extTimes = [], extPrecips = []
        for (let i = 0; i < omTimes.length; i++) {
          if (omTimes[i] > radarUntil && omTimes[i] <= horizon12h) {
            extTimes.push(omTimes[i]); extPrecips.push(omPrecips[i] ?? 0)
          }
        }
        setForecast({
          times: [...ribbonTimeline.times, ...extTimes],
          precips: [...ribbonTimeline.precips, ...extPrecips],
          isNowcast: !!nowcast,
          radarUntil: nowcast ? radarUntil : nowSec,   // no radar at all → everything is "model"
          // v2.8: both instruments contradict the radar-zone trace carpet → the
          // ribbon dims its stubs and drops the trace-only overlay wording.
          tracePhantom: phantomTrace,
          // Model series for the ribbon's GHOST bars (v2.1): model-only rain drawn as
          // outlined bars so both instruments are visible at a glance within the radar
          // zone. Only meaningful when the bars themselves are radar (isNowcast).
          modelTimes: omTimes, modelPrecips: omPrecips,
        })

        // ---- Narrative continuity across refreshes (persisted per location) ----
        // Remember, in localStorage, when it was last actually raining at ~this spot.
        // The status is otherwise recomputed from scratch every refresh with no
        // memory, so "raining, clearing" could flip to "rain approaching" minutes
        // later and read as nonsense. The story is only trusted within 1 km of where
        // it was written; a far-away or long-stale story is ignored (fresh start).
        const nowMs = Date.now()
        let story = null
        try { story = JSON.parse(localStorage.getItem('story') || 'null') } catch {}
        const nearStory = story && typeof story.lat === 'number' &&
          metersBetween({ lat: story.lat, lon: story.lon }, location) < STORY_RADIUS_M
        let lastWetAt = nearStory && typeof story.lastWetAt === 'number' ? story.lastWetAt : 0
        if (effectivePrecip !== null && effectivePrecip >= DRY_THRESHOLD) lastWetAt = nowMs

        // The story is now a LIGHT reference only: it softens the WORDING (recentRain
        // → "short break / eased") but no longer FORCES the displayed state. The old
        // hysteresis hold made your live location diverge from the fixed-point dots —
        // it clung to "almost out" / flashed STUCK while nearby spots were dry. The
        // status is now the fresh reading, same basis as the dots → they agree.
        const displayPrecip = effectivePrecip
        const recentRain = lastWetAt > 0 && (nowMs - lastWetAt) < RECENT_RAIN_MS

        try {
          localStorage.setItem('story', JSON.stringify({
            lat: location.lat, lon: location.lon, ts: nowMs, lastWetAt,
          }))
        } catch {}

        setCurrentPrecip(displayPrecip)
        setGaps(detectedGaps)
        // Model rain probability for the hour the onset falls in — lets getStatus
        // soften a radar countdown the model isn't confident about (radar over-read
        // / virga) vs a firm "rain in X min" when the probability backs it up.
        const hTimes = data?.hourly?.time ?? []
        const hProb  = data?.hourly?.precipitation_probability ?? []
        let rainProb = null
        if (nextRainAt && hTimes.length) {
          let bi = 0, bd = Infinity
          for (let i = 0; i < hTimes.length; i++) {
            const d = Math.abs(hTimes[i] - nextRainAt)
            if (d < bd) { bd = d; bi = i }
          }
          rainProb = typeof hProb[bi] === 'number' ? hProb[bi] : null
        }
        setTrend({ nextRainAt, dryEndsOpen, rvRainActive: rvPrecip >= DRY_THRESHOLD || drizzleSurfaced, rainProb, recentRain, maxSoon, downpourSoonMin, modelRainAt, modelEaseAt: modelEase, rvApproachMin, rvApproachDir, rvNearbyDir, traceEcho: !phantomTrace && hasTraceEcho(rawNowSlot), traceAheadMin: traceAheadM })
        setTickNow(Math.floor(Date.now() / 1000))
        setCurrentWeather({
          temp: stationTemp ?? data?.current?.temperature_2m ?? null,
          wind: data?.current?.wind_speed_10m ?? null,
          code: data?.current?.weather_code ?? null,
        })
        // Severe storm potential — Alpine/Salzburg specific threshold.
        // CAPE > 1500 J/kg during afternoon hours (12-21h local) signals
        // extreme convective instability. Gap timings become unreliable
        // as cells can fire and intensify within 15-20 min.
        const localHour = new Date().getHours()
        const cape = data?.current?.cape ?? null
        const severeStorm = cape !== null && cape >= 1500 && localHour >= 12 && localHour < 21
        setStormCape(severeStorm ? cape : null)
        // Convective watch (v1.3.0) — banners only, the verdict is untouched.
        // Layer 1: CAPE + rising probability = unsettled regime (pop-up risk today).
        const probs4 = (data?.hourly?.precipitation_probability ?? []).slice(0, 4)
          .filter(v => typeof v === 'number')
        const maxProb4 = probs4.length ? Math.max(...probs4) : null
        setUnsettled(!severeStorm && isUnsettled(cape, maxProb4, localHour))
        // Ribbon honesty: an all-dry ribbon under unstable air must say "can change
        // fast" — CAPE alone gates this (no hour/prob filter; it's wording, not a banner).
        setCapeUnstable(cape != null && cape >= UNSETTLED_CAPE)
        // Layer 2: radar-confirmed initiation stamped by the backend.
        setFormingTs(ambientFormingTs())
        // Layer 3 (v2.4): city-scale wet/dry direction + trend, fresh within 10 min.
        const aw = ambientAreaWatch()
        setAreaWatch(aw && typeof aw.ts === 'number' && (Date.now() / 1000 - aw.ts) < 10 * 60 ? aw : null)
        const uv = data?.current?.uv_index ?? null
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

  // Per-town statuses: on location change, on language change (refreshAreaStatuses
  // depends on the localized computeStatusAt), and every 10 min.
  useEffect(() => {
    if (!location) return
    refreshAreaStatuses()
    const id = setInterval(refreshAreaStatuses, 6 * 60 * 1000)  // tighter so a dot lags your live status less
    return () => clearInterval(id)
  }, [location, refreshAreaStatuses])

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
    // Logo tap → back to the landing view (LocationPrompt). View-only: the
    // stored last_location stays, so a reload returns straight to the app.
    onLogo: () => {
      setLocation(null)
      setLocationError(null)
    },
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

      <UpdateNote t={t} />

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
        /* Scrollable middle column: on busy days the warning banners stack up
           (UV + wind + thunder + gap banner…) inside a fixed-height shell —
           without a scroll path the map got crushed and the page felt frozen
           (iOS report: "the website becomes unscrollable"). */
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col">
          {isOutsideSalzburg(location) && (
            <div className="px-4 py-2 bg-surface border-b border-border shrink-0">
              <span className="font-mono text-xs text-wait">⚠ {t('outside_sbz')}</span>
            </div>
          )}
          {showStaleBanner && (
            <div className="px-4 py-2 bg-surface border-b border-border shrink-0 flex items-center gap-3">
              <span className="font-mono text-xs text-muted flex-1">📍 {t('loc_stale')}</span>
              <button
                onClick={() => setStaleDismissed(true)}
                className="font-mono text-xs text-muted hover:text-primary transition-colors shrink-0"
                aria-label="dismiss"
              >✕</button>
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
          {formingActive && (
            <div className="px-4 py-2.5 bg-surface border-b border-border shrink-0 flex items-center gap-3">
              <span className="font-mono text-xs flex-1 leading-relaxed" style={{ color: 'var(--c-alert)' }}>
                🌩 {t('forming_note')}
              </span>
            </div>
          )}
          {unsettled && !formingActive && (
            <div className="px-4 py-2 bg-surface border-b border-border shrink-0">
              <span className="font-mono text-xs leading-relaxed" style={{ color: 'var(--c-warn)' }}>
                🌤 {t('unsettled_note')}
              </span>
            </div>
          )}
          {areaWatch && !formingActive && (
            <div className="px-4 py-2 bg-surface border-b border-border shrink-0">
              <span className="font-mono text-xs leading-relaxed text-muted">
                🌧 {t('aw_' + areaWatch.trend, { dir: t('dir_' + areaWatch.sector) })}
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
          <RainRibbon forecast={forecast} theme={theme} t={t} unstable={capeUnstable} modelRainMin={modelRainMin} />
          <RadarMap location={location} areaPrecip={areaPrecip} areaStatus={areaStatus} userStatus={status} theme={theme} t={t} lang={lang} onRelocate={relocate} relocating={upgradingLocation} computeStatusAt={computeStatusAt} />
        </div>
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

      <InstallPrompt
        t={t}
        installable={installable && !isStandalone}
        onInstall={headerProps.onInstall}
        isStandalone={isStandalone}
        isIOSSafari={isIOSSafari}
        isIOSOther={isIOSOther}
        isAndroid={isAndroid}
      />
    </div>
  )
}
