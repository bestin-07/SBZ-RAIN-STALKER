import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const SALZBURG = [47.802, 13.045]
const ZOOM = 13  // close-in on the user; radar overlay upscales from RainViewer's z7 max
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
  if (p < 0.1)  return '#D4A017'  // dry  (legend gold)
  if (p < 0.5)  return '#5B9CE8'  // light rain
  if (p < 2)    return '#3478D4'  // moderate
  return               '#1D5EC0'  // heavy rain
}

function areaIcon(name, precip, dryLabel = 'dry') {
  const known = precip !== null && precip !== undefined
  const isRaining = known && precip >= 0.1
  const color = precipColor(precip)
  const dot = isRaining ? 9 : 7

  // Every town stays readable (name always shown); raining areas pop with a
  // larger blue dot, glow and mm reading. Dry areas keep a visible dot + name
  // but no value, so the map shows the full network without clutter.
  return L.divIcon({
    html: `<div style="text-align:center;pointer-events:none;">
      <div style="
        width:${dot}px;height:${dot}px;
        background:${color};
        border-radius:50%;
        margin:0 auto;
        ${isRaining ? `box-shadow:0 0 0 4px ${color}40;` : 'box-shadow:0 0 0 2px rgba(0,0,0,0.45);opacity:0.85;'}
      "></div>
      <div style="
        font-family:'JetBrains Mono',monospace;
        font-size:9px;
        color:#9CA3AF;
        white-space:nowrap;
        margin-top:3px;
        line-height:1.1;
        opacity:${isRaining ? '1' : '0.8'};
      ">${escHtml(name)}</div>
      ${known ? `<div style="
        font-family:'JetBrains Mono',monospace;
        font-size:9px;
        font-weight:${isRaining ? '600' : '400'};
        color:${isRaining ? color : '#6B7280'};
        white-space:nowrap;
      ">${isRaining ? precip.toFixed(1) + 'mm' : dryLabel}</div>` : ''}
    </div>`,
    iconSize: [60, 36],
    iconAnchor: [30, dot / 2],
    className: '',
  })
}

export default function RadarMap({ location, areaPrecip, theme, t }) {
  const containerRef   = useRef(null)
  const mapRef         = useRef(null)
  const markerRef      = useRef(null)
  const baseTileRef    = useRef(null)
  const areaMarkersRef = useRef([])
  const rvLayersRef    = useRef([])
  const animIdxRef     = useRef(0)
  const animTimerRef   = useRef(null)
  const animRefreshRef = useRef(null)

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

        if (animTimerRef.current) { clearInterval(animTimerRef.current); animTimerRef.current = null }
        rvLayersRef.current.forEach(l => { try { mapRef.current?.removeLayer(l) } catch {} })
        rvLayersRef.current = []

        rvLayersRef.current = frames.map((frame, i) => {
          // 256px tiles, colour scheme 2 (universal blue) + smoothing.
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

        animTimerRef.current = setInterval(() => {
          const layers = rvLayersRef.current
          if (!layers.length) return
          const prev = animIdxRef.current
          const next = (prev + 1) % layers.length
          try { layers[prev].setOpacity(0) } catch {}
          if (rvVisible()) { try { layers[next].setOpacity(0.5) } catch {} }
          animIdxRef.current = next
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

  // Area precipitation dots
  useEffect(() => {
    if (!mapRef.current || !areaPrecip?.length) return
    areaMarkersRef.current.forEach(m => m.remove())
    const dryLabel = t ? t('dry') : 'dry'
    areaMarkersRef.current = areaPrecip.map(area =>
      L.marker([area.lat, area.lon], { icon: areaIcon(area.name, area.precip, dryLabel), zIndexOffset: 200 })
        .addTo(mapRef.current)
    )
    return () => {
      areaMarkersRef.current.forEach(m => m.remove())
      areaMarkersRef.current = []
    }
  }, [areaPrecip, t])

  // Smoothly fly back to the user's location (e.g. after they've panned away).
  const recenter = () => {
    if (mapRef.current && location) {
      mapRef.current.flyTo([location.lat, location.lon], ZOOM, { duration: 0.8 })
    }
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={containerRef} className="absolute inset-0" style={{ zIndex: 0 }} />
      {location && (
        <button
          onClick={recenter}
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
