import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const SALZBURG = [47.8, 13.045]
const ZOOM = 10
const BOUNDS = L.latLngBounds([47.60, 12.80], [47.99, 13.30])
const FRAME_INTERVAL_MS = 500
const TILE_COLOR_SCHEME = 2
const TILE_OPACITY = 0.6

function precipColor(p) {
  if (p === null || p === undefined) return '#374151'
  if (p < 0.1)  return '#D4A017'
  if (p < 0.5)  return '#2A5F8F'
  if (p < 2)    return '#1A3A5C'
  return               '#0D2035'
}

function areaIcon(name, precip) {
  const color = precipColor(precip)
  const isRaining = precip !== null && precip >= 0.1
  const label = precip !== null
    ? (precip < 0.1 ? 'dry' : `${precip.toFixed(1)}mm`)
    : ''

  return L.divIcon({
    html: `<div style="text-align:center;pointer-events:none;">
      <div style="
        width:8px;height:8px;
        background:${color};
        border-radius:50%;
        margin:0 auto;
        box-shadow:0 0 0 2px rgba(0,0,0,0.5);
        ${isRaining ? `box-shadow:0 0 0 3px ${color}44;` : ''}
      "></div>
      <div style="
        font-family:'JetBrains Mono',monospace;
        font-size:9px;
        color:#9CA3AF;
        white-space:nowrap;
        margin-top:3px;
        line-height:1.1;
      ">${name}</div>
      ${label ? `<div style="
        font-family:'JetBrains Mono',monospace;
        font-size:8px;
        color:${color};
        white-space:nowrap;
      ">${label}</div>` : ''}
    </div>`,
    iconSize: [60, 36],
    iconAnchor: [30, 4],
    className: '',
  })
}

export default function RadarMap({ location, radarFrames, areaPrecip }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const radarLayerRef = useRef(null)
  const animRef = useRef(null)
  const areaMarkersRef = useRef([])

  useEffect(() => {
    if (mapRef.current) return

    const map = L.map(containerRef.current, {
      center: location ? [location.lat, location.lon] : SALZBURG,
      zoom: ZOOM,
      minZoom: 9,
      maxZoom: 13,
      maxBounds: BOUNDS,
      maxBoundsViscosity: 1.0,
      zoomControl: false,
      attributionControl: true,
    })

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; CartoDB &copy; OpenStreetMap',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map)

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

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

  // Area dots
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

  // Radar animation
  useEffect(() => {
    if (!mapRef.current || !radarFrames) return

    const frames = [
      ...(radarFrames.radar?.past ?? []),
      ...(radarFrames.radar?.nowcast ?? []),
    ]
    if (!frames.length) return

    let idx = 0
    let currentLayer = null

    function showFrame(frameIdx) {
      const frame = frames[frameIdx]
      if (!frame) return

      const url = `https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/${TILE_COLOR_SCHEME}/1_1.png`
      const next = L.tileLayer(url, { opacity: TILE_OPACITY, zIndex: 100, maxNativeZoom: 12, maxZoom: 19 })
      next.addTo(mapRef.current)

      const prev = currentLayer
      currentLayer = next
      radarLayerRef.current = next

      if (prev) setTimeout(() => mapRef.current?.removeLayer(prev), FRAME_INTERVAL_MS)
    }

    showFrame(0)
    animRef.current = setInterval(() => {
      idx = (idx + 1) % frames.length
      showFrame(idx)
    }, FRAME_INTERVAL_MS)

    return () => {
      clearInterval(animRef.current)
      if (currentLayer && mapRef.current) mapRef.current.removeLayer(currentLayer)
    }
  }, [radarFrames])

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0"
      style={{ zIndex: 0 }}
    />
  )
}
