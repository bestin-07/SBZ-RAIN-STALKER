import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const SALZBURG = [47.802, 13.045]
const ZOOM = 11
const BOUNDS = L.latLngBounds([47.50, 12.65], [48.10, 13.65])
const DWD_WMS = 'https://maps.dwd.de/geoserver/dwd/wms'

const TILE_DARK  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

function precipColor(p) {
  if (p === null || p === undefined) return '#374151'
  if (p < 0.1)  return '#D4A017'
  if (p < 0.5)  return '#5B9CE8'
  if (p < 2)    return '#3478D4'
  return               '#1D5EC0'
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
        ${isRaining
          ? `box-shadow:0 0 0 3px ${color}55;`
          : 'box-shadow:0 0 0 2px rgba(0,0,0,0.4);'}
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

export default function RadarMap({ location, areaPrecip, theme }) {
  const containerRef   = useRef(null)
  const mapRef         = useRef(null)
  const markerRef      = useRef(null)
  const baseTileRef    = useRef(null)
  const areaMarkersRef = useRef([])

  // Init map + DWD OPERA radar (WMS — no tile-zoom issues at any map zoom)
  useEffect(() => {
    if (mapRef.current) return

    const map = L.map(containerRef.current, {
      center: location ? [location.lat, location.lon] : SALZBURG,
      zoom: ZOOM,
      minZoom: 10,
      maxZoom: 14,
      maxBounds: BOUNDS,
      maxBoundsViscosity: 1.0,
      zoomControl: false,
      attributionControl: true,
    })

    L.tileLayer.wms(DWD_WMS, {
      layers: 'dwd:RX-Produkt',
      format: 'image/png',
      transparent: true,
      version: '1.3.0',
      opacity: 0.55,
      zIndex: 100,
      attribution: '© DWD',
    }).addTo(map)

    mapRef.current = map

    return () => {
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
