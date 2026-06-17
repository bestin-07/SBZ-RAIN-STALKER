import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const SALZBURG = [47.8, 13.045]
const ZOOM = 10
const FRAME_INTERVAL_MS = 500
const TILE_COLOR_SCHEME = 2
const TILE_OPACITY = 0.6

export default function RadarMap({ location, radarFrames }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const radarLayerRef = useRef(null)
  const animRef = useRef(null)

  // Init map once
  useEffect(() => {
    if (mapRef.current) return

    const map = L.map(containerRef.current, {
      center: location ? [location.lat, location.lon] : SALZBURG,
      zoom: ZOOM,
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
        width: 12px; height: 12px;
        background: #F1F3F5;
        border: 2px solid #08090B;
        border-radius: 50%;
        box-shadow: 0 0 0 3px rgba(241,243,245,0.25);
      "></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
      className: '',
    })

    if (markerRef.current) markerRef.current.remove()
    markerRef.current = L.marker([location.lat, location.lon], { icon }).addTo(mapRef.current)
    mapRef.current.setView([location.lat, location.lon], ZOOM)
  }, [location])

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
