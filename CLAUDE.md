# CLAUDE.md — Gemma Raus (SBZ-RAIN-STALKER)

## Project Overview

**Gemma Raus** ("let's go outside!" in Austrian dialect) is a hyper-local rain-window PWA for Salzburg, Austria. It answers one question: *when can I go outside without getting wet?*

The app reads 4 real-time precipitation sources, finds dry windows of ≥30 minutes in the next 3 hours, and shows a single clear status: GO / WAIT N MIN / STUCK INSIDE. It works as a web app and installable PWA (no account, no tracking).

**Live URL:** Deployed on Railway (see `.railway.toml`)
**Repo:** `bestin-07/SBZ-RAIN-STALKER`
**Dev branch:** `claude/loving-volta-ywwqz8` → merges to `main`

---

## Architecture

```
SBZ-RAIN-STALKER/
├── frontend/          # React + Vite PWA
│   ├── src/
│   │   ├── App.jsx              # Root component, data loading, state
│   │   ├── api.js               # All API calls (4 precipitation sources)
│   │   ├── gaps.js              # Gap detection + status logic
│   │   ├── i18n.js              # DE/EN translations
│   │   └── components/
│   │       ├── Header.jsx       # Top bar: theme/lang/notify/guide/refresh
│   │       ├── GapBanner.jsx    # Main status display (GO/WAIT/STUCK)
│   │       ├── RainRibbon.jsx   # 12h precipitation bar chart
│   │       ├── RadarMap.jsx     # Leaflet map with DWD+RainViewer overlay
│   │       ├── LocationPrompt.jsx # Initial loading/permission screen
│   │       └── InfoPanel.jsx    # Slide-up guide + about + data sources
│   ├── public/
│   │   ├── sw.js                # Service worker (network-first, cache v2)
│   │   ├── manifest.json        # PWA manifest
│   │   ├── favicon.svg          # Brand icons (user-maintained)
│   │   ├── favicon-32.png
│   │   ├── apple-touch-icon.png
│   │   ├── icon-192.png
│   │   └── icon-512.png
│   ├── index.html
│   ├── vite.config.js
│   └── tailwind.config.js
├── backend/           # Python FastAPI
│   ├── main.py        # /api/forecast, /api/accuracy, /api/subscribe, /api/vapid-public-key
│   └── requirements.txt
├── Dockerfile         # Multi-stage: frontend build → python backend serving static files
├── .railway.toml
└── CLAUDE.md          # This file
```

### Deployment

- **Single Docker container** on Railway: builds Vite frontend, serves it as static files from the Python backend
- Backend `BASE_URL` is set via `VITE_BACKEND_URL` env var (Railway injects this automatically)
- Push to `main` → Railway auto-deploys

---

## Data Sources & Rain Detection Pipeline

All 4 sources are queried in parallel on every refresh (every 5 minutes). The app takes the **maximum** across all sources — any single signal detecting rain wins.

### 1. Open-Meteo ICON-EU Forecast (`api.js: fetchForecast`)
- **URL:** `https://api.open-meteo.com/v1/forecast`
- **Params:** `minutely_15=precipitation&forecast_minutely_15=48&current=temperature_2m,wind_speed_10m,weather_code,precipitation`
- **Update cycle:** ~hourly model run, can lag 2-3h on convective alpine rain
- **Used for:** Gap detection (dry windows in `minutely_15.precipitation`), weather notes (temp/wind/code), current measured precipitation
- **Critical limitation:** ICON-EU is frequently blind to fast-moving convective cells in the Alps. `precipitation=0.00` and `weather_code=3` (partly cloudy) during active heavy rain is confirmed behavior.

### 2. GeoSphere Austria TAWES Stations (`api.js: fetchNearbyStationPrecip`)
- **URL:** `https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min`
- **Update cycle:** Every 10 minutes, actual measured precipitation (not a model)
- **Param:** `parameters=RR&station_ids=<id1>,...,<id6>,11150`
- **`RR`** = precipitation in mm over the last 10 minutes
- **Station discovery:** `GET .../metadata` → `meta.stations` array of ~272 stations with `id`, `lat`, `lon`, `is_active` → drop inactive → haversine sort → **6 nearest**, plus airport anchor `11150` always appended
- **Fallback:** Salzburg Airport station ID `11150` if metadata fails
- **Response path:** `data.features[].properties.parameters.RR.data[0]`
- **Verified (2026-06):** Metadata structure live-confirmed — `meta.stations` is an array of objects with exactly `id`/`lat`/`lon`/`is_active`. The wider net (6 + anchor) exists so a hyper-local convective cell isn't missed when the 3 nearest stations are dry but a 4th–6th nearest (or the airport) is wet.

### 3. GeoSphere INCA 1 km Nowcast (`api.js: fetchRadarPrecipAtPoint`)
- **URL:** `https://dataset.api.hub.geosphere.at/v1/timeseries/historical/inca-v1-1h-1km`
- **Param:** `parameters=RR&start=<-3h>&end=<now>&lat_lon=<lat>,<lon>`
- **`RR`** = 1-hour precipitation sum in kg/m² (= mm) at the point's 1 km grid cell — radar+station blended analysis, independent of the Open-Meteo model
- **Update cycle:** Hourly analysis, lags ~30–90 min (slower than TAWES, but spatially complete)
- **Returns:** most recent non-null hourly value in mm, or `null` on failure
- **Response path:** `data.features[0].properties.parameters.RR.data[]` → last valid entry
- **Why this replaced DWD RADOLAN:** The previous source used DWD `GetFeatureInfo` on `maps.dwd.de`. Live-tested 2026-06: that endpoint returns **HTTP 403 (WAF "Access Denied")** from Austrian user networks (client IP A1 Telekom AT), with or without browser headers — so it returned `null` on every request for real users. **This was a primary cause of false "GO" during rain.** INCA is on the already-working GeoSphere host (no CORS, no WAF block). The DWD WMS *tile* overlay (`GetMap`) in `RadarMap.jsx` is a different request path and is unaffected.

### 4. Open-Meteo Current Measured (`App.jsx: loadData`)
- `data.current.precipitation` — Open-Meteo's reported last-hour measured value
- Same API call as source 1, no extra request
- Can lag but occasionally catches rain the forecast misses

### Signal Blending (App.jsx: loadData)
```js
const cp           = detectGaps(times, precips).currentPrecip   // minutely_15 slot we're in
const measured     = data.current?.precipitation ?? 0            // current.precipitation
const stationPrecip = stationResult?.value ?? 0                  // TAWES max of 3 stations
const radarPrecip   = radarResult?.value   ?? 0                  // DWD RADOLAN point
const effectivePrecip = cp === null ? null : Math.max(cp, measured, stationPrecip, radarPrecip)
```

---

## Gap Detection Logic (`gaps.js`)

- **Threshold:** `DRY_THRESHOLD = 0.1` mm/h — anything below is "dry"
- **Min gap:** `MIN_GAP_SLOTS = 2` → 2 × 15 min = 30 minutes minimum
- **Look-ahead:** `LOOK_AHEAD = 3 * 3600` = 3 hours
- Considers the slot we're currently **inside** (includes 1 slot in the past for current slot identification)
- `opensEnded: true` if gap extends to end of forecast window (shown as "more than N min")

### Status Logic (`getStatus`)
```
currentPrecip === null  → loading state
isDry = currentPrecip < 0.1 AND weather_code not a rain code
gapNow = gaps[0].startsInMinutes === 0

isDry OR gapNow → GO NOW
  + gapNow → show gap duration in sub-text

nextGap exists → WAIT N MIN (then X min clear)
else → STUCK INSIDE (no gap in 3h)
```

**WMO rain codes** checked by `precipByCode()`: `51-67` (drizzle/rain), `71-77` (snow), `80-99` (showers/storms)

**Note:** `gapNow` prevents "WAIT 0 MIN" — if the model says a gap opens right now but a station still shows residual rain (lag up to 10 min after clearing), trust the model.

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `frontend/src/App.jsx` | State management, data fetching, layout |
| `frontend/src/api.js` | All 4 data sources |
| `frontend/src/gaps.js` | `detectGaps()` + `getStatus()` |
| `frontend/src/i18n.js` | All DE/EN strings |
| `frontend/src/components/Header.jsx` | Top bar (always rendered, even before location granted) |
| `frontend/src/components/GapBanner.jsx` | Main status display |
| `frontend/src/components/RadarMap.jsx` | Leaflet + DWD WMS + RainViewer |
| `frontend/src/components/InfoPanel.jsx` | Guide + about + data sources |
| `frontend/public/sw.js` | Service worker, cache name `gemma-raus-v2` |
| `backend/main.py` | Push notifications, accuracy tracking |

---

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `VITE_BACKEND_URL` | Frontend build + Railway | Backend base URL (empty = same origin) |
| `VAPID_PRIVATE_KEY` | Backend (Railway secret) | Push notification signing |
| `VAPID_PUBLIC_KEY` | Backend (Railway secret) | Push notification public key |

---

## Known Issues / Technical Debt

### DWD `maps.dwd.de` — FULLY REMOVED (WAF-blocked, not CORS)
**Resolved 2026-06.** Live testing showed **both** DWD WMS request types return **HTTP 403 ("Access Denied", F5/edge WAF signature)** from Austrian user IPs — not CORS, a server-side block that browser headers don't bypass:
- `GetFeatureInfo` (the old `fetchRadarPrecipAtPoint()` data point) → 403, returned `null` every request → replaced by GeoSphere INCA (data source #3 above).
- `GetMap` (the `dwd:RX-Produkt` **tile overlay** on the map in `RadarMap.jsx`) → also 403, returned an HTML error body instead of a PNG → the radar overlay rendered nothing. **Removed entirely**; RainViewer is now the sole radar overlay.

Do not reintroduce any `maps.dwd.de` request — the whole host is blocked for Austrian (and likely most EU residential) networks.

### ICON-EU Model Lag
The Open-Meteo ICON-EU model runs roughly hourly and can be 2-3h behind convective rain events in the Alps. On fast-moving summer storms, all model-based signals (minutely_15, current.precipitation, weather_code) can show `0` while it's actively raining. The TAWES stations (fast, 10-min) and GeoSphere INCA nowcast (gridded, hourly) are meant to compensate — but only if those API calls succeed.

### GeoSphere TAWES Metadata Format — VERIFIED
Live-confirmed 2026-06: the metadata endpoint returns `{ ..., stations: [...] }` where each station object has exactly `id` (string), `lat`, `lon`, `is_active` (bool). Discovery filters out inactive stations and falls back to `station_ids=11150` only if the whole metadata fetch fails.

### RainViewer Animated Radar — now the sole radar overlay
`RadarMap.jsx` uses the RainViewer API for animated radar tiles (~40 min past + 2 nowcast frames). It is now the **only** radar overlay (DWD removed — see above).
- `maxNativeZoom: 9` → z9 tiles are upscaled (slightly soft) above zoom 9 rather than disappearing.
- `RV_MAX_ZOOM = 14` (was `10`). **This was the "map looks empty" bug:** the default map zoom is `11`, so the old `<= 10` gate hid RainViewer at the default view — and with DWD also blocked, the map showed no radar at all. The gate now spans the full interactive zoom range (minZoom 9 → maxZoom 14).
- A `ResizeObserver` calls `map.invalidateSize()` on mount and resize, so the flex-mounted container (`flex-1 min-h-0`, with sibling banners that settle height after first paint) doesn't leave the base tiles blank.

---

## Local Development Setup

### Prerequisites
- Node.js 20+
- Python 3.11+
- (Optional) Railway CLI for env var access

### Frontend
```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```

The frontend dev server proxies `/api/*` to the backend. Set `VITE_BACKEND_URL=http://localhost:8000` or leave empty (proxy handles it).

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Testing API sources locally
From a browser on your machine, open DevTools → Network tab. With the app loaded and location granted, watch for:
- `forecast` call to `api.open-meteo.com`
- `tawes-v1-10min/metadata` then `tawes-v1-10min?parameters=RR&station_ids=...` to `dataset.api.hub.geosphere.at`
- `maps.dwd.de/geoserver/dwd/wms?...REQUEST=GetFeatureInfo...` — **check if this returns 200 or CORS error**

To debug rain detection:
```js
// In browser console while app is loaded:
// After a data refresh, the effectivePrecip is logged to console (add temporary logging in App.jsx loadData)
```

### Quick API test scripts (run from terminal on local machine)
```bash
# Test GeoSphere TAWES for a Salzburg location
curl "https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min?parameters=RR&station_ids=11150,11101,11102"

# Test GeoSphere metadata
curl "https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min/metadata" | python3 -m json.tool | head -50

# Test GeoSphere INCA 1km nowcast point (replaces DWD RADOLAN, which 403s)
curl "https://dataset.api.hub.geosphere.at/v1/timeseries/historical/inca-v1-1h-1km?parameters=RR&start=2026-06-17T17:00&end=2026-06-17T20:00&lat_lon=47.8,13.04"

# Test Open-Meteo for Salzburg
curl "https://api.open-meteo.com/v1/forecast?latitude=47.8&longitude=13.04&current=precipitation,weather_code,temperature_2m,wind_speed_10m&minutely_15=precipitation&forecast_minutely_15=4&timeformat=unixtime&timezone=UTC"
```

---

## Deployment (Railway)

The Dockerfile is multi-stage:
1. Build Vite frontend (`npm run build` → `dist/`)
2. Copy `dist/` into Python image, serve as static files

Push to `main` → Railway auto-deploys. No manual steps.

**To check if deployment is live:** Look for the Railway deployment URL in project settings.

---

## Development Conventions

- **No TypeScript** — plain JS + JSX
- **Styling:** Tailwind CSS with custom design tokens (`bg-bg`, `text-primary`, `text-muted`, `text-wait`, etc. — see `tailwind.config.js`)
- **Fonts:** `font-display` (bold display), `font-mono` (body/data)
- **i18n:** All user-facing strings go through `t(key)` from `useI18n()`. Add keys to both `de` and `en` objects in `i18n.js`.
- **State:** All in `App.jsx` — no global state library
- **API errors:** All API functions return `null` on failure, never throw to the caller
- **Refresh:** Auto-refresh every 5 minutes (`REFRESH_MS = 5 * 60 * 1000`). Pull-to-refresh button in Header.

---

## Connecting a Local Dev Server to This Session

When connecting Claude Code to a local remote development server (so API scripts can be executed directly from the user's machine):

1. Start the local dev server: `cd frontend && npm run dev`
2. Start the backend: `cd backend && uvicorn main:app --reload`
3. In Claude Code, use the local terminal to run `curl` tests against APIs
4. Check browser DevTools Network tab to see actual API responses during rain events

The most critical thing to verify during the next rain event:
- Does `dataset.api.hub.geosphere.at/.../tawes-v1-10min?parameters=RR&station_ids=...` return non-zero `RR` values for the nearest stations (this is the fast 10-min signal)?
- Does the INCA point query (`inca-v1-1h-1km?parameters=RR&lat_lon=...`) return a non-zero recent hourly sum?
- (DWD GetFeatureInfo is no longer used — it 403s from Austrian networks. Don't reintroduce it.)
