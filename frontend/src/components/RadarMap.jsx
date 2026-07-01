import { useEffect, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

function fmtClock(unix) {
  const d = new Date(unix * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const SALZBURG = [47.802, 13.045]
const SALZBURG_CENTER = [47.8009, 13.0448]  // city centre — an extra tappable point
const ZOOM = 11  // shows surrounding area dots (Hallein, Bad Reichenhall, Bergheim etc)
const BOUNDS = L.latLngBounds([47.50, 12.65], [48.10, 13.65])
const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json'
// Show RainViewer across the whole interactive zoom range. Tiles are native at
// z9 (maxNativeZoom) and upscaled above — slightly soft but visible. The DWD
// WMS overlay used to be the authoritative layer, but its tiles (GetMap) return
// HTTP 403 from Austrian networks just like GetFeatureInfo, so RainViewer is now
// the only radar overlay and must be visible at the default zoom (11).
const RV_MAX_ZOOM = 14

const TILE_DARK  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

const ALLOWED_RV_HOST = 'https://tilecache.rainviewer.com'

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Must match the RainRibbon legend (dry = gold, light/heavy = blue) so the map
// dots and the legend agree. Dry dots still recede via size/opacity, not colour.
function precipColor(p) {
  if (p === null || p === undefined) return '#4B5563' // unknown — neutral grey
  if (p < 0.1)  return '#D4A017'  // dry
  if (p < 0.5)  return '#6CD1EB'  // light rain  — sampled from RainViewer Universal Blue
  if (p < 2)    return '#1BAEE2'  // moderate
  if (p < 5)    return '#0077AA'  // heavy
  return               '#E05C00'  // storm/thunderstorm — matches radar warm core
}

function areaIcon(name, precip, code, status, dryLabel = 'dry') {
  let color, isRaining, valueLine
  if (status && status.type) {
    // Colour by the COMPUTED status (matches the tap popup + the app's verdict),
    // via the same theme-aware --c-* tokens as the headline/legend. No mm value —
    // that came from a different source (Open-Meteo current) and could contradict.
    isRaining = status.type !== 'go' && status.type !== 'loading'
    color = `var(--c-${status.type}, #4B5563)`
    valueLine = ''
  } else {
    // Fallback (status not resolved yet): colour by ACTUAL precip. No blue from
    // weather_code (code 61 lingers with 0 mm). No precip data → assume dry/gold
    // rather than grey (rain is rare; grey next to a GEMMA RAUS popup looked wrong).
    const known = precip !== null && precip !== undefined
    isRaining = known && precip > 0.1
    color = known ? precipColor(precip) : '#D4A017'
    valueLine = known
      ? `<div style="font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:${isRaining ? '600' : '400'};color:${isRaining ? color : '#6B7280'};white-space:nowrap;">${isRaining ? precip.toFixed(1) + 'mm' : dryLabel}</div>`
      : ''
  }
  const dot = isRaining ? 9 : 7

  // Tappable: whole icon clickable; `gr-dot` adds cursor:pointer + a hover lift.
  // Glow uses `0 0 8px 1px <color>` (works with a CSS var, unlike the old alpha-hex).
  return L.divIcon({
    html: `<div style="text-align:center;">
      <div class="gr-dot-core" style="
        width:${dot}px;height:${dot}px;
        background:${color};
        border-radius:50%;
        margin:0 auto;
        ${isRaining ? `box-shadow:0 0 8px 1px ${color};` : 'box-shadow:0 0 0 2px rgba(0,0,0,0.45);opacity:0.9;'}
      "></div>
      <div style="
        font-family:'JetBrains Mono',monospace;
        font-size:9px;
        color:#9CA3AF;
        white-space:nowrap;
        margin-top:3px;
        line-height:1.1;
      ">${escHtml(name)}</div>
      ${valueLine}
    </div>`,
    iconSize: [60, 36],
    iconAnchor: [30, dot / 2],
    className: 'gr-dot',
  })
}

export default function RadarMap({ location, areaPrecip, areaStatus, userStatus, theme, t, lang, onRelocate, computeStatusAt }) {
  const containerRef   = useRef(null)
  const mapRef         = useRef(null)
  const markerRef      = useRef(null)
  const baseTileRef    = useRef(null)
  const areaMarkersRef = useRef([])
  const rvLayersRef    = useRef([])
  const animIdxRef     = useRef(0)
  const animTimerRef   = useRef(null)
  const animRefreshRef = useRef(null)
  const framesMetaRef  = useRef([])
  const computeRef     = useRef(computeStatusAt)
  const statusCacheRef = useRef(new Map())   // key "lat,lon" → { status, ts }
  const currentPopupRef = useRef(null)       // the open popup (for re-render on lang switch)
  const openArgsRef     = useRef(null)       // args of the open popup
  const [radarFrame, setRadarFrame] = useState(null)  // { time, forecast } of the shown frame
  useEffect(() => { computeRef.current = computeStatusAt }, [computeStatusAt])

  // Tap a point → popup with that spot's status. Opens a loading popup first, then
  // fills it once computeStatusAt resolves; session-cached (5-min TTL) so re-taps
  // are instant. Leaflet's popup closes on its × or on an outside tap by default.
  // opts.hint adds a muted nudge line (used on the auto-opened "your location" popup).
  const openStatusPopup = useCallback((lat, lon, name, pre, opts = {}) => {
    const map = mapRef.current
    if (!map) return
    const failMsg  = t ? t('pop_fail') : 'couldn’t load — tap to retry'
    const hintLine = opts.hint ? `<div class="gr-pop-hint">${escHtml(opts.hint)}</div>` : ''
    const render = (status) => {
      const head = (s) => `color:var(--c-${s.type}, var(--c-primary))`
      if (status === undefined) return `<div class="gr-pop"><div class="gr-pop-name">${escHtml(name)}</div><div class="gr-pop-load">…</div></div>`
      if (!status)              return `<div class="gr-pop"><div class="gr-pop-name">${escHtml(name)}</div><div class="gr-pop-sub">${escHtml(failMsg)}</div></div>`
      return `<div class="gr-pop">
        <div class="gr-pop-name">${escHtml(name)}</div>
        <div class="gr-pop-head" style="${head(status)}">${escHtml(status.headline)}</div>
        <div class="gr-pop-sub">${escHtml(status.sub || '')}</div>
        ${hintLine}
      </div>`
    }
    const popup = L.popup({ maxWidth: 240, className: 'gr-status-popup', autoPanPadding: [24, 24] })
      .setLatLng([lat, lon])
    currentPopupRef.current = popup
    openArgsRef.current = { lat, lon, name, isUser: !!opts.isUser, hint: opts.hint }
    // Preloaded status (from the area-status pass) → instant + guaranteed to match
    // the dot colour. null means "computed but failed" → fall through to recompute.
    if (pre) { popup.setContent(render(pre)).openOn(map); return }
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`
    const cached = statusCacheRef.current.get(key)
    if (cached && Date.now() - cached.ts < 5 * 60 * 1000) {
      popup.setContent(render(cached.status)).openOn(map)
      return
    }
    popup.setContent(render(undefined)).openOn(map)
    Promise.resolve(computeRef.current?.(lat, lon)).then(status => {
      statusCacheRef.current.set(key, { status, ts: Date.now() })
      if (popup.isOpen()) { popup.setContent(render(status)); popup.update() }
    }).catch(() => {
      if (popup.isOpen()) { popup.setContent(render(null)); popup.update() }
    })
  }, [t])

  useEffect(() => {
    if (mapRef.current) return

    const map = L.map(containerRef.current, {
      center: location ? [location.lat, location.lon] : SALZBURG,
      zoom: ZOOM,
      minZoom: 9,
      maxZoom: 14,
      maxBounds: BOUNDS,
      maxBoundsViscosity: 1.0,
      zoomControl: false,
      attributionControl: true,
    })

    mapRef.current = map

    // The flex-mounted container can report a stale/zero size when Leaflet
    // initialises (sibling banners settle height after first paint), which
    // leaves the base tiles blank. Re-measure once mounted and on any resize.
    const resizeObs = new ResizeObserver(() => {
      try { mapRef.current?.invalidateSize() } catch {}
    })
    resizeObs.observe(containerRef.current)
    requestAnimationFrame(() => { try { map.invalidateSize() } catch {} })

    // ---- RainViewer animated overlay ----
    // maxNativeZoom:9 ensures Leaflet requests z=9 tiles with z=9 coordinates
    // (no zoom/coordinate mismatch). The zoomend listener hides them above
    // RV_MAX_ZOOM as a belt-and-suspenders guard.
    const rvVisible = () => !!mapRef.current && mapRef.current.getZoom() <= RV_MAX_ZOOM

    const syncRvOpacity = () => {
      const idx = animIdxRef.current
      rvLayersRef.current.forEach((l, i) => {
        try { l.setOpacity(rvVisible() && i === idx ? 0.5 : 0) } catch {}
      })
    }

    map.on('zoomend', syncRvOpacity)

    async function setupAnimation() {
      if (!mapRef.current) return
      try {
        const res = await fetch(RAINVIEWER_API)
        if (!res.ok) return
        const data = await res.json()
        const rawHost = data.host
        const host = typeof rawHost === 'string' && /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/.test(rawHost)
          ? rawHost
          : ALLOWED_RV_HOST
        // Last 4 past frames (~40 min history) + up to 2 nowcast extrapolations
        const past    = (data.radar?.past     ?? []).slice(-4)
        const nowcast = (data.radar?.nowcast  ?? []).slice(0, 2)
        const frames  = [...past, ...nowcast]
        if (!frames.length) return
        // Frame timestamps + past/forecast flag, for the little running-time banner.
        framesMetaRef.current = frames.map((f, i) => ({ time: f.time, forecast: i >= past.length }))

        if (animTimerRef.current) { clearInterval(animTimerRef.current); animTimerRef.current = null }
        rvLayersRef.current.forEach(l => { try { mapRef.current?.removeLayer(l) } catch {} })
        rvLayersRef.current = []

        rvLayersRef.current = frames.map((frame, i) => {
          // 256px tiles, colour scheme 2 (Universal Blue) + smoothing.
          // Scheme 2 is the blue-only palette — confirmed from RainViewer's own
          // example code and their "personal use = Universal Blue only" restriction.
          // Scheme 1 is the classic rainbow (green/yellow/red); do NOT use it.
          // RainViewer's radar tiles only exist up to **zoom 7** — at z8+ it
          // returns a "Zoom Level Not Supported" placeholder PNG (verified by
          // decoding the tiles). So maxNativeZoom MUST be 7; Leaflet then upscales
          // the z7 tile for higher map zooms instead of fetching the placeholder.
          // z7 is ~1.2 km/px, which is already near radar's native resolution, so
          // little real detail is lost — the fine signal comes from the GeoSphere
          // 1 km nowcast that drives the GO/WAIT status, not this visual overlay.
          const layer = L.tileLayer(
            `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`,
            { maxNativeZoom: 7, opacity: 0, zIndex: 200, attribution: '© RainViewer' }
          )
          layer.addTo(mapRef.current)
          return layer
        })
        animIdxRef.current = frames.length - 1
        syncRvOpacity()
        setRadarFrame(framesMetaRef.current[animIdxRef.current] ?? null)

        animTimerRef.current = setInterval(() => {
          const layers = rvLayersRef.current
          if (!layers.length) return
          const prev = animIdxRef.current
          const next = (prev + 1) % layers.length
          try { layers[prev].setOpacity(0) } catch {}
          if (rvVisible()) { try { layers[next].setOpacity(0.5) } catch {} }
          animIdxRef.current = next
          setRadarFrame(framesMetaRef.current[next] ?? null)
        }, 700)
      } catch {
        // RainViewer unavailable — base map + area dots remain
      }
    }

    setupAnimation()
    animRefreshRef.current = setInterval(setupAnimation, 5 * 60 * 1000)

    return () => {
      map.off('zoomend', syncRvOpacity)
      resizeObs.disconnect()
      clearInterval(animRefreshRef.current)
      if (animTimerRef.current) clearInterval(animTimerRef.current)
      rvLayersRef.current.forEach(l => { try { l.remove() } catch {} })
      rvLayersRef.current = []
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Swap base tile layer when theme changes
  useEffect(() => {
    if (!mapRef.current) return
    if (baseTileRef.current) mapRef.current.removeLayer(baseTileRef.current)
    baseTileRef.current = L.tileLayer(theme === 'light' ? TILE_LIGHT : TILE_DARK, {
      attribution: '© CartoDB © OpenStreetMap',
      subdomains: 'abcd',
      maxZoom: 19,
      detectRetina: true,
      zIndex: 1,
    }).addTo(mapRef.current)
  }, [theme])

  // Location pin
  useEffect(() => {
    if (!mapRef.current || !location) return
    const icon = L.divIcon({
      html: `<div style="
        width:12px;height:12px;
        background:#F1F3F5;
        border:2px solid #08090B;
        border-radius:50%;
        box-shadow:0 0 0 3px rgba(241,243,245,0.25);
      "></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
      className: '',
    })
    if (markerRef.current) markerRef.current.remove()
    markerRef.current = L.marker([location.lat, location.lon], { icon }).addTo(mapRef.current)
    mapRef.current.setView([location.lat, location.lon], ZOOM)
  }, [location])

  // Area dots — coloured by computed status when available (falls back to precip).
  useEffect(() => {
    if (!mapRef.current || !areaPrecip?.length) return
    areaMarkersRef.current.forEach(m => m.remove())
    const dryLabel = t ? t('dry') : 'dry'
    const statusOf = (name) => (areaStatus || []).find(s => s.name === name)?.status
    areaMarkersRef.current = areaPrecip.map(area => {
      const st = statusOf(area.name)
      return L.marker([area.lat, area.lon], { icon: areaIcon(area.name, area.precip, area.code, st, dryLabel), zIndexOffset: 200 })
        .on('click', () => openStatusPopup(area.lat, area.lon, area.name, st))
        .addTo(mapRef.current)
    })
    return () => {
      areaMarkersRef.current.forEach(m => m.remove())
      areaMarkersRef.current = []
    }
  }, [areaPrecip, areaStatus, t, openStatusPopup])

  // Salzburg-centre marker — an extra tappable point (city core sits between the
  // surrounding-town dots). Hollow ring, tinted by its status when known.
  useEffect(() => {
    if (!mapRef.current) return
    const st = (areaStatus || []).find(s => s.name === 'Salzburg')?.status
    const ring = st && st.type ? `var(--c-${st.type}, var(--c-primary))` : 'var(--c-primary)'
    const icon = L.divIcon({
      html: `<div style="text-align:center;">
        <div class="gr-dot-core" style="width:11px;height:11px;border:2px solid ${ring};
             border-radius:50%;margin:0 auto;background:transparent;box-shadow:0 0 0 3px rgba(0,0,0,0.35);"></div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:#9CA3AF;margin-top:3px;white-space:nowrap;">Salzburg</div>
      </div>`,
      iconSize: [60, 30], iconAnchor: [30, 5], className: 'gr-dot',
    })
    const m = L.marker(SALZBURG_CENTER, { icon, zIndexOffset: 300 })
      .on('click', () => openStatusPopup(SALZBURG_CENTER[0], SALZBURG_CENTER[1], 'Salzburg', st))
      .addTo(mapRef.current)
    return () => { try { m.remove() } catch {} }
  }, [areaStatus, openStatusPopup])

  // On load, auto-open a popup at the USER's location with their status + a nudge to
  // tap the other dots — so they land on a worked example and learn it's tappable.
  // Uses the real headline status (matches the banner). If they're on the default
  // Salzburg centre (GPS denied), it naturally shows Salzburg's glance.
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    if (autoOpenedRef.current || !mapRef.current || !location) return
    if (!userStatus || userStatus.type === 'loading') return
    autoOpenedRef.current = true
    const isDefault = Math.abs(location.lat - SALZBURG_CENTER[0]) < 0.001 &&
                      Math.abs(location.lon - SALZBURG_CENTER[1]) < 0.001
    const name = isDefault ? 'Salzburg' : (t ? t('your_location') : 'your location')
    openStatusPopup(location.lat, location.lon, name, userStatus, { hint: t ? t('tap_others') : '', isUser: true })
  }, [location, userStatus, openStatusPopup, t])

  // Re-render the open popup when the language switches (Leaflet popup content is
  // set imperatively once, so it wouldn't otherwise translate live). Keyed on lang
  // only — t is a fresh function each render, so we can't depend on it here.
  useEffect(() => {
    const p = currentPopupRef.current, a = openArgsRef.current
    if (!p || !a || !p.isOpen()) return
    statusCacheRef.current.clear()  // cached statuses hold old-language strings
    if (a.isUser) {
      if (!location || !userStatus) return
      const isDefault = Math.abs(location.lat - SALZBURG_CENTER[0]) < 0.001 &&
                        Math.abs(location.lon - SALZBURG_CENTER[1]) < 0.001
      openStatusPopup(location.lat, location.lon, isDefault ? 'Salzburg' : t('your_location'),
        userStatus, { hint: t('tap_others'), isUser: true })
    } else {
      openStatusPopup(a.lat, a.lon, a.name, undefined, { hint: a.hint })
    }
  }, [lang]) // eslint-disable-line react-hooks/exhaustive-deps

  // Smoothly fly back to the user's location (e.g. after they've panned away).
  const recenter = () => {
    if (mapRef.current && location) {
      mapRef.current.flyTo([location.lat, location.lon], ZOOM, { duration: 0.8 })
    }
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={containerRef} className="absolute inset-0" style={{ zIndex: 0 }} />
      {radarFrame && (
        <div className="absolute top-3 left-3 z-30 pointer-events-none flex items-center gap-1.5
                        rounded-full bg-surface/90 backdrop-blur border border-border
                        px-2.5 py-1 font-mono text-xs text-muted">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: radarFrame.forecast ? '#1BAEE2' : 'var(--c-primary)' }}
          />
          {radarFrame.forecast ? (t ? t('lbl_nowcast') : 'nowcast') : (t ? t('lbl_radar') : 'radar')} {fmtClock(radarFrame.time)}
        </div>
      )}
      {location && (
        <button
          onClick={() => { recenter(); onRelocate?.() }}
          aria-label={t ? t('recenter') : 'Center on my location'}
          className="absolute bottom-4 right-4 z-30 w-11 h-11 flex items-center justify-center
                     rounded-full bg-surface/90 backdrop-blur border border-border text-primary
                     shadow-lg hover:bg-surface active:scale-95 transition"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="7" />
            <line x1="12" y1="1"  x2="12" y2="4" />
            <line x1="12" y1="20" x2="12" y2="23" />
            <line x1="1"  y1="12" x2="4"  y2="12" />
            <line x1="20" y1="12" x2="23" y2="12" />
            <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
          </svg>
        </button>
      )}
    </div>
  )
}
