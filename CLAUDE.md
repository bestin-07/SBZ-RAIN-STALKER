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
- **Param:** `parameters=RR&station_ids=<id1>,<id2>,<id3>`
- **`RR`** = precipitation in mm over the last 10 minutes
- **Station discovery:** `GET .../metadata` → array of ~270 stations with `id`, `lat`, `lon` → haversine sort → 3 nearest
- **Fallback:** Salzburg Airport station ID `11150` if metadata fails
- **Response path:** `data.features[].properties.parameters.RR.data[0]`
- **Known uncertainty:** Metadata response field names (`id`, `lat`, `lon`) verified via python-zamg source but not live-tested from remote environment. Defensive code handles both array and dict forms.

### 3. DWD RADOLAN Radar Point (`api.js: fetchRadarPrecipAtPoint`)
- **URL:** `https://maps.dwd.de/geoserver/dwd/wms` (same server as map tiles)
- **Request:** `GetFeatureInfo` with `CRS:84`, `LAYERS: dwd:RX-Produkt`
- **Update cycle:** Every 5 minutes — fastest available source
- **Encoding:** `GRAY_INDEX` → `dBZ = GRAY_INDEX / 2 - 32.5`. Rain detected at `dBZ > 7` (≈ 0.1 mm/h)
- **Returns:** `0.1` if rain detected, `0` if dry, `null` on error
- **No-data flags:** `GRAY_INDEX >= 250` = no signal, returns `0` (not null)
- **Known uncertainty:** CORS behavior of `GetFeatureInfo` from browser not confirmed. May silently return `null` every time. **This is the most likely reason rain still isn't detected.** Needs testing from a local browser with DevTools.

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

### DWD RADOLAN GetFeatureInfo CORS
The `fetchRadarPrecipAtPoint()` function uses `GetFeatureInfo` on the DWD GeoServer. This works as a map tile source in Leaflet but `GetFeatureInfo` requests from the browser may be blocked by CORS. If so, this source silently returns `null` on every request. **Must test with browser DevTools (Network tab) to confirm.**

Workaround if CORS fails: proxy the request through the backend (`/api/radar-point?lat=&lon=`).

### ICON-EU Model Lag
The Open-Meteo ICON-EU model runs roughly hourly and can be 2-3h behind convective rain events in the Alps. On fast-moving summer storms, all model-based signals (minutely_15, current.precipitation, weather_code) can show `0` while it's actively raining. The TAWES stations and RADOLAN radar are meant to compensate — but only if those API calls succeed.

### GeoSphere TAWES Metadata Format
The metadata endpoint response format was inferred from the python-zamg library, not live-tested. If the field names differ (e.g. `stationid` vs `id`, `latitude` vs `lat`), dynamic station discovery silently falls back to `station_ids=11150` (Salzburg Airport).

### RainViewer Animated Radar
`RadarMap.jsx` uses RainViewer API for animated radar tiles (past 2h animation). `maxNativeZoom: 9` and a `zoomend` guard at `RV_MAX_ZOOM = 10` prevent broken tiles at high zoom. The DWD WMS static overlay is the authoritative source; RainViewer is visual context only.

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

# Test DWD RADOLAN GetFeatureInfo for Salzburg (lat=47.8, lon=13.04)
curl "https://maps.dwd.de/geoserver/dwd/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=dwd:RX-Produkt&QUERY_LAYERS=dwd:RX-Produkt&CRS=CRS:84&BBOX=13.03,47.79,13.05,47.81&WIDTH=10&HEIGHT=10&I=5&J=5&INFO_FORMAT=application/json"

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
4. Confirm DWD RADOLAN GetFeatureInfo CORS behavior (see Known Issues above)
5. Confirm GeoSphere TAWES metadata field names
6. Check browser DevTools Network tab to see actual API responses during rain events

The most critical thing to verify during the next rain event:
- Does `maps.dwd.de/geoserver/dwd/wms?...GetFeatureInfo...` return `200` with `GRAY_INDEX` in the response, or is it blocked by CORS?
- Does `dataset.api.hub.geosphere.at/.../tawes-v1-10min?parameters=RR&station_ids=...` return non-zero `RR` values?
