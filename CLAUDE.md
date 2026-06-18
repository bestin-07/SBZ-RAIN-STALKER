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
│   │   ├── support/            # Donate docs — set VITE_DONATE_URL (or DONATE_URL in InfoPanel.jsx) to a PayPal.me/Stripe/Ko-fi link
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

Sources are queried in parallel on every refresh. The **gap timeline** (GO/WAIT/STUCK and "dry for N min") is driven by the finest-resolution forecast available — the GeoSphere 1 km / 15-min nowcast (source #3), falling back to Open-Meteo. The **current "now" condition** is the **maximum** of the live measurements (Open-Meteo current + TAWES) so any single signal seeing rain wins.

### 1. Open-Meteo ICON-EU Forecast (`api.js: fetchForecast`)
- **URL:** `https://api.open-meteo.com/v1/forecast`
- **Params:** `minutely_15=precipitation&forecast_minutely_15=48&current=temperature_2m,wind_speed_10m,weather_code,precipitation`
- **Update cycle:** ~hourly model run, can lag 2-3h on convective alpine rain
- **Used for:** the 12 h RainRibbon overview chart, weather notes (temp/wind/code), current measured precipitation, and **fallback** gap timeline if the nowcast is unavailable
- **Critical limitation:** ICON-EU is frequently blind to fast-moving convective cells in the Alps. `precipitation=0.00` and `weather_code=3` (partly cloudy) during active heavy rain is confirmed behavior — which is exactly why it is no longer the primary gap source.

### 2. GeoSphere Austria TAWES Stations (`api.js: fetchNearbyStationPrecip`)
- **URL:** `https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min`
- **Update cycle:** Every 10 minutes, actual measured precipitation (not a model)
- **Param:** `parameters=RR&station_ids=<id1>,...,<id6>,11150`
- **`RR`** = precipitation in mm over the last 10 minutes
- **Station discovery:** `GET .../metadata` → `meta.stations` array of ~272 stations with `id`, `lat`, `lon`, `is_active` → drop inactive → haversine sort → **6 nearest**, plus airport anchor `11150` always appended
- **Fallback:** Salzburg Airport station ID `11150` if metadata fails
- **Response path:** `data.features[].properties.parameters.RR.data[0]`
- **Verified (2026-06):** Metadata structure live-confirmed — `meta.stations` is an array of objects with exactly `id`/`lat`/`lon`/`is_active`. The wider net (6 + anchor) exists so a hyper-local convective cell isn't missed when the 3 nearest stations are dry but a 4th–6th nearest (or the airport) is wet.

### 3. GeoSphere Nowcast 1 km / 15-min — PRIMARY gap timeline (`api.js: fetchNowcastTimeline`)
- **URL:** `https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/nowcast-v1-15min-1km`
- **Param:** `parameters=rr&lat_lon=<lat>,<lon>` (param name is **lowercase `rr`**; unit kg/m² = mm)
- **Resolution:** 1 km grid, **15-min steps, +3 h horizon** (e.g. issued 20:45 → 21:00…23:45). Radar-extrapolation nowcast — catches convective rain the ICON-EU model lags on, at the user's exact cell.
- **Returns:** `{ times:[unix s], precips:[mm] }`, or `null` on failure → App.jsx prepends a synthetic "now" slot (from live measurements) and runs `detectGaps` on it. Falls back to Open-Meteo `minutely_15` when null.
- **Response path:** top-level `timestamps[]` + `features[0].properties.parameters.rr.data[]`
- **History:** replaced the hourly INCA analysis (too coarse in time) which itself replaced DWD RADOLAN `GetFeatureInfo` on `maps.dwd.de` — DWD is **HTTP 403 (WAF block)** from Austrian networks for both `GetFeatureInfo` and `GetMap`, so the whole `maps.dwd.de` host is unusable here.

### 4. Open-Meteo Current Measured (`App.jsx: loadData`)
- `data.current.precipitation` — Open-Meteo's reported last-hour measured value
- Same API call as source 1, no extra request
- Contributes to the live "now" reading alongside TAWES

### Signal Blending (App.jsx: loadData)
```js
const measured      = data.current?.precipitation ?? 0           // Open-Meteo current
const stationPrecip = stationResult?.value ?? 0                  // TAWES max of nearest 6 + airport
const nowPrecip     = Math.max(measured, stationPrecip)          // live "now" condition

// Gap timeline: GeoSphere 1km/15-min nowcast (preferred) else Open-Meteo,
// with a real "now" slot anchored from nowPrecip.
const timeline = nowcast
  ? { times: [nowSec, ...nowcast.times], precips: [nowPrecip, ...nowcast.precips] }
  : { times: omTimes, precips: omPrecips }
const cp = detectGaps(timeline.times, timeline.precips).currentPrecip
const effectivePrecip = cp === null ? null : Math.max(cp, nowPrecip)
```

---

## Gap Detection Logic (`gaps.js`)

- **Threshold:** `DRY_THRESHOLD = 0.1` mm/h — anything below is "dry"
- **Min gap:** `MIN_GAP_SLOTS = 2` → 2 × 15 min = 30 minutes minimum. **Kept at 30 (not 15) on purpose** — a single 15-min nowcast slot is too likely to be noise to promise as a "go out" break. The rain-*coming* countdown does NOT depend on this (see below), so shortening it isn't needed for urgency.
- **Look-ahead:** `LOOK_AHEAD = 3 * 3600` = 3 hours
- Considers the slot we're currently **inside** (includes 1 slot in the past for current slot identification)
- `opensEnded: true` if gap extends to end of forecast window
- **Trend fields** also returned by `detectGaps`: `nextRainAt` (unix ts of the next wet slot when it's dry now, independent of `MIN_GAP_SLOTS`) and `dryEndsOpen` (dry for the whole 3 h ahead).

### Status Logic (`getStatus`) — narrative + live countdown
`getStatus(currentPrecip, gaps, weather, t, nowSec, trend)`. `nowSec` is a per-minute ticker in App (`tickNow`, re-synced on each 5-min data refresh) so the countdowns move live. Thresholds: `URGENT_MIN = 15`, `ALMOST_MIN = 10`.

```
currentPrecip === null → loading

DRY now (isDry, or a gap already started):
  dryEndsOpen            → GO · "clear skies for hours"          (s_clear_hours)
  rain in ≤ 0 min        → GO · "rain could start any minute"    (s_rain_any)
  rain in ≤ 15 min       → GO · "window closing, rain in X min"  (s_window_closing)  ← urgency
  rain in > 15 min       → GO · "dry now, rain in about X min"   (s_rain_soon)
  no trend info          → GO · "no rain right now"              (s_dry_generic)

RAINING now, a ≥30-min break ahead (gaps[0]):
  clears in ≤ 10 min     → WAIT · "almost over, dry in X, get ready" (s_almost_over)
  clears in > 10 min     → WAIT · "break opens in X, lasts Y"        (s_break_opens)

RAINING, no break in 3 h → STUCK · "rain straight through"       (s_stuck)
```
- **Time-to-rain countdown** (`nextRainAt`) is what powers the "window closing" urgency; it uses the next wet slot's exact timestamp, so "rain in 10 min" is legitimate even though slots are 15-min apart.
- **"Almost over"** (`ALMOST_MIN`) counts down to `gaps[0].startsAt` — i.e. the start of a *confirmed* ≥30-min break.
- Countdown is cosmetic interpolation between refreshes; soft cases use "about/any minute" to avoid overstating precision.

**WMO rain codes** checked by `precipByCode()`: `51-67` (drizzle/rain), `71-77` (snow), `80-99` (showers/storms). Snow is treated as "wet" (no separate arc); it surfaces only via the weather note.

**Note:** `gapNow` (a gap whose `startsAt <= nowSec`) routes to GO even if a station's RR still shows residual rain — trust the model when it says dry now.

**Night nudge:** if the **browser-local** hour (from `nowSec`) is **00:00–04:59 (12am–5am)**, `getStatus` keeps the normal headline + colour but swaps the **sub-line** for a cozy `s_night_*` variant (and drops the "make it quick" urgency). The `NOCH X MIN` countdown headline still shows when raining, so timing info isn't lost.

**Rotating one-liners:** the `s_*` status sub-line keys in `i18n.js` are **arrays of variants** (3 each, DE & EN). `useI18n`'s `t()` picks one stably via `(phraseSeed + dayNumber + hash(key)) % pool.length` — where `phraseSeed` is a per-user random stored once in `localStorage`. Result: different users see different phrasings, the choice is stable within a day (no flicker on the minute-tick), and it rotates daily. Headlines stay fixed (brand). To add variety, just add strings to a pool; non-array values still work as plain strings.

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
| `frontend/src/components/RadarMap.jsx` | Leaflet base map + RainViewer overlay + nearby-town precip dots + "recenter on me" `flyTo` button |
| `frontend/src/components/InfoPanel.jsx` | Guide + about + data sources |
| `frontend/public/sw.js` | Service worker, cache name `gemma-raus-v2` |
| `backend/main.py` | Push notifications, accuracy tracking |

---

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `VITE_BACKEND_URL` | Frontend **build** + Railway | Backend base URL (empty = same origin) |
| `VITE_DONATE_URL` | Frontend **build** + Railway | Donate link for the Support button (PayPal.me/Stripe/Ko-fi); empty = button hidden |
| `VAPID_PRIVATE_KEY` | Backend (Railway secret) | Push notification signing |
| `VAPID_PUBLIC_KEY` | Backend (Railway secret) | Push notification public key |

**`VITE_*` are build-time, not runtime.** They're baked into the JS bundle by Vite during `npm run build`. In the Docker build, Railway service variables only reach the build if declared as `ARG` in the Dockerfile's `frontend` stage (see `ARG VITE_DONATE_URL` / `ARG VITE_BACKEND_URL`). Changing one in Railway requires a **rebuild/redeploy** to take effect — restarting the container is not enough.

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

### Backend push & accuracy now use the nowcast (aligned with the app)
`backend/main.py` previously computed push alerts and accuracy from Open-Meteo only — the lagging model — so it could miss convective rain and fire stale alerts. It now mirrors the frontend: `fetch_timeline()` prefers the GeoSphere 1 km/15-min nowcast (Open-Meteo fallback) for the forward timeline, and `fetch_now_precip()` uses nearest TAWES stations (Open-Meteo current fallback) for the live reading. `check_and_push` anchors a real "now" slot from TAWES before running `_analyze_forecast`; `run_cycle` stores nowcast predictions and verifies them against TAWES actuals. **24/7 caveat:** this only runs continuously if the Railway service stays awake (always-on plan); Web Push still reaches closed browsers via the service worker, subject to OS battery throttling.

### Geolocation: user gesture + denied-state handling (Safari/Firefox)
Do **not** auto-request `getCurrentPosition` on mount — Safari and Firefox suppress or never show the permission prompt unless the call originates from a user gesture (Chrome is lenient, which masked this). The request is triggered only by the "GET MY LOCATION" button; App tracks a `locating` state for the button's loading label.

If the prompt still never appears, the permission is usually pre-**blocked/dismissed** (Firefox won't re-ask once dismissed) or the page isn't a secure context (HTTPS / localhost — a plain-http LAN IP silently fails). App handles this:
- On mount, `navigator.permissions.query({name:'geolocation'})` detects a pre-`denied` state and shows help immediately rather than waiting for a click that won't prompt.
- Error codes are mapped (`denied`/`timeout`/`unavailable`/`unsupported`) to specific messages.
- `LocationPrompt` shows **browser-specific instructions** (`detectBrowser()` → `loc_help_{ios|firefox|chrome|safari|generic}`) to re-enable location.
- A **"Use Salzburg center" fallback** (`useDefaultLocation`, 47.8009/13.0448) lets the app work even if GPS never resolves.

### Nearby-town dots & API rate limits
`fetchAreaPrecip()` shows precip for the 12 surrounding towns. It uses a **single batched Open-Meteo request** (comma-separated `latitude`/`longitude` → array response in order), not 12 separate calls — gentler on the rate limit and it no longer drops towns when individual calls get throttled (the old behaviour made the dots "disappear"). It always returns every AREA (precip `null` on failure) so dots render consistently. **All weather/radar calls are client-side (browser → Open-Meteo / GeoSphere directly); none go through the Railway backend**, so public-API rate limits apply per user IP, not to our server. The backend only calls Open-Meteo for its own 5 accuracy points every 5 min.

### RainViewer Animated Radar — now the sole radar overlay
`RadarMap.jsx` uses the RainViewer API for animated radar tiles (~40 min past + 2 nowcast frames). It is now the **only** radar overlay (DWD removed — see above).
- **`maxNativeZoom: 7` — do NOT raise this.** Verified 2026-06 by decoding the tile PNGs: RainViewer's radar tiles are real only up to **zoom 7**; at **z8 and above it returns a fixed "Zoom Level Not Supported" placeholder image** (a gray box `(0,0,0,140)` with white text — not a transparent/empty tile). Any `maxNativeZoom ≥ 8` makes Leaflet request that placeholder, which is exactly the "Zoom Level Not Supported" boxes that plagued the map. With `7`, Leaflet upscales the z7 tile for higher map zooms. z7 is ~1.2 km/px, already near radar's native resolution, so little real detail is lost.
- Clear sky → RainViewer tiles are fully transparent → **no overlay is the correct, expected look** (not a bug).
- `RV_MAX_ZOOM = 14` gates the animation opacity across the interactive zoom range (minZoom 9 → maxZoom 14). Default map `ZOOM = 13` (close on the user).
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

---

## Security Audit — Findings & Fixes (2026-06)

Full security review conducted covering backend API, frontend JS, Docker build, and CSP headers. All critical and high findings were fixed.

### Backend (`backend/main.py`)

| Finding | Severity | Fix Applied |
|---------|----------|-------------|
| `/api/vapid-keys` exposed VAPID private key in a GET response | **Critical** | Endpoint deleted entirely |
| CORS allowed `*` wildcard origins | High | Restricted to `ALLOWED_ORIGINS` env var (default: localhost only) |
| No rate limiting on subscribe/unsubscribe | High | `slowapi` added; POST subscribe → 5/min, DELETE → 10/min, GET accuracy → 30/min |
| Unsubscribe required only `endpoint` — any caller could remove anyone's subscription | High | Unsubscribe token (UUID4) issued on POST, stored in DB, required on DELETE (403 on mismatch) |
| No input validation on POST /api/subscribe | High | Body size limit 4096 bytes, endpoint validated by regex `_PUSH_ORIGIN_RE`, p256dh/auth length-checked |
| No security headers (CSP, HSTS, X-Frame-Options, etc.) | High | Middleware adds full header set on every response |
| `FastAPI(debug=True)` could leak stack traces | Medium | Changed to `debug=False`; generic `@app.exception_handler(Exception)` returns `{"error": "internal error"}` |
| DB_PATH could be path-traversed via env var | Medium | `os.path.basename()` sanitizes the value |
| Unlimited push subscriptions (DoS vector) | Medium | `MAX_PUSH_SUBS = 50_000` cap enforced |
| SQLite `check_same_thread=True` (default) unsafe for async | Medium | Shared connection with `check_same_thread=False`, WAL mode, `busy_timeout=5000` |
| Forecast rows grew unbounded in DB | Low | Pruned to 8-day window on every run cycle |
| TAWES station list unbounded | Low | Capped at 500 entries |

**Security headers set by middleware:**
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://*.cartocdn.com https://*.openstreetmap.org https://*.rainviewer.com https://tilecache.rainviewer.com; connect-src 'self' https://api.open-meteo.com https://dataset.api.hub.geosphere.at https://api.rainviewer.com https://tilecache.rainviewer.com; frame-ancestors 'none'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=()
Strict-Transport-Security: max-age=31536000; includeSubDomains (HTTPS only)
```

### Frontend (`frontend/src/`)

| Finding | Severity | Fix Applied |
|---------|----------|-------------|
| `RadarMap.jsx`: town `name` interpolated raw into `divIcon` innerHTML — XSS if a malicious area name ever reaches the component | Medium | `escHtml()` helper added; all name interpolations now escaped |
| `RadarMap.jsx`: RainViewer `data.host` used as tile URL prefix without validation | Medium | Validated against `^https://[a-z0-9.-]+\.[a-z]{2,}$`; falls back to known-good `ALLOWED_RV_HOST` |
| `App.jsx`: DELETE /api/subscribe sent only `endpoint` — no token → anyone who knows an endpoint can unsubscribe a victim | High | Token read from `localStorage` and included in DELETE body; stored on successful POST, removed after DELETE |
| `sw.js`: error responses (4xx/5xx) cached in navigate handler | Low | Added `if (r.ok)` guard before `cache.put()` |
| `vite.config.js`: `allowedHosts: 'all'` in preview config exposes dev server to any host header | Low | Removed; `preview` now only sets `host` and `port` |

### Infrastructure

| Finding | Severity | Fix Applied |
|---------|----------|-------------|
| Docker container ran as `root` | High | Non-root `appuser` added; `chown` + `USER appuser` in Dockerfile |
| No `.dockerignore` — `.git`, `.env`, node_modules copied into build context | Medium | `.dockerignore` created (excludes `.git`, `.env*`, `node_modules`, `*.db`, `*.md`, etc.) |
| `requirements.txt` pinned old fastapi/uvicorn/httpx with known CVEs in older ranges | Medium | Upgraded: `fastapi==0.115.0`, `uvicorn==0.32.0`, `httpx==0.27.2`; added `slowapi==0.1.9`, `cryptography==43.0.3` |

### Threat model notes

- **No user accounts / sessions** — there is nothing to hijack. The only persistent identity is the push subscription endpoint URL, which is now protected by an unsubscribe token.
- **All weather API calls are client-side** — Open-Meteo, GeoSphere, RainViewer calls go browser → external API directly. Our Railway backend handles only push subscriptions and accuracy tracking; it is not a proxy.
- **GPS coordinates never leave the browser** — the `/api/forecast` backend endpoint is no longer called from the frontend (data is fetched client-side); lat/lon is only sent to third-party weather APIs directly.
- **Rate limits apply per user IP** (via slowapi) for the Railway backend endpoints. External weather APIs have their own rate limits per user IP.
- **VAPID key pair** — private key is a Railway secret (`VAPID_PRIVATE_KEY` env var); public key is served via `/api/vapid-public-key` GET endpoint (public-key exposure is intentional and required for push subscriptions).
