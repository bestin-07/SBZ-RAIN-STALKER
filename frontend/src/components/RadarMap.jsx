import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const SALZBURG = [47.802, 13.045]
const ZOOM = 11
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

// Clean blue precipitation ramp; dry/unknown recede to a muted slate so the
// map isn't a field of loud dots. Matches the RainViewer "universal blue" scheme.
function precipColor(p) {
  if (p === null || p === undefined) return '#4B5563' // unknown
  if (p < 0.1)  return '#5B6472'  // dry — muted, low emphasis
  if (p < 0.5)  return '#60A5FA'  // light
  if (p < 2)    return '#3B82F6'  // moderate
  return               '#1D4ED8'  // heavy
}

function areaIcon(name, precip) {
  const known = precip !== null && precip !== undefined
  const isRaining = known && precip >= 0.1
  const color = precipColor(precip)
  const dot = isRaining ? 9 : 6

  // Dry areas recede (small dim dot + faint name, no value); raining areas pop
  // (larger blue dot with a glow + the mm reading). Keeps the map uncluttered.
  return L.divIcon({
    html: `<div style="text-align:center;pointer-events:none;">
      <div style="
        width:${dot}px;height:${dot}px;
        background:${color};
        border-radius:50%;
        margin:0 auto;
        ${isRaining ? `box-shadow:0 0 0 4px ${color}40;` : 'opacity:0.6;'}
      "></div>
      <div style="
        font-family:'JetBrains Mono',monospace;
        font-size:9px;
        color:#9CA3AF;
        white-space:nowrap;
        margin-top:3px;
        line-height:1.1;
        opacity:${isRaining ? '1' : '0.5'};
      ">${name}</div>
      ${isRaining ? `<div style="
        font-family:'JetBrains Mono',monospace;
        font-size:9px;
        font-weight:600;
        color:${color};
        white-space:nowrap;
      ">${precip.toFixed(1)}mm</div>` : ''}
    </div>`,
    iconSize: [60, 36],
    iconAnchor: [30, dot / 2],
    className: '',
  })
}

export default function RadarMap({ location, areaPrecip, theme }) {
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
        const host    = data.host ?? 'https://tilecache.rainviewer.com'
        // Last 4 past frames (~40 min history) + up to 2 nowcast extrapolations
        const past    = (data.radar?.past     ?? []).slice(-4)
        const nowcast = (data.radar?.nowcast  ?? []).slice(0, 2)
        const frames  = [...past, ...nowcast]
        if (!frames.length) return

        if (animTimerRef.current) { clearInterval(animTimerRef.current); animTimerRef.current = null }
        rvLayersRef.current.forEach(l => { try { mapRef.current?.removeLayer(l) } catch {} })
        rvLayersRef.current = []

        rvLayersRef.current = frames.map((frame, i) => {
          // 512px tiles + colour scheme 2 (universal blue) + smoothing for a
          // clean overlay. maxNativeZoom 11 lets RainViewer serve real tiles up
          // to city zoom instead of stretching one z9 tile (the "blurry / not
          // supported" look). Note: radar is natively ~1 km, so beyond ~z11 it's
          // interpolated, not finer detail — the fine signal comes from the
          // GeoSphere 1 km nowcast that drives the GO/WAIT status.
          const layer = L.tileLayer(
            `${host}${frame.path}/512/{z}/{x}/{y}/2/1_1.png`,
            { tileSize: 512, maxNativeZoom: 11, opacity: 0, zIndex: 200, attribution: '© RainViewer' }
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
    areaMarkersRef.current = areaPrecip.map(area =>
      L.marker([area.lat, area.lon], { icon: areaIcon(area.name, area.precip), zIndexOffset: 200 })
        .addTo(mapRef.current)
    )
    return () => {
      areaMarkersRef.current.forEach(m => m.remove())
      areaMarkersRef.current = []
    }
  }, [areaPrecip])

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0"
      style={{ zIndex: 0 }}
    />
  )
}
