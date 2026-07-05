# CLAUDE.md — Gemma Raus (SBZ-RAIN-STALKER)

## Project Overview

**Gemma Raus** ("let's go outside!" in Austrian dialect) is a hyper-local rain-window PWA for Salzburg, Austria. It answers one question: *when can I go outside without getting wet?*

The app reads several real-time precipitation sources, finds dry windows of ≥30 minutes in the next 3 hours, and shows a single clear status: **GEMMA RAUS (GO) / PASST SCHON (light rain, go anyway) / WAIT N MIN / BLEIB DRIN (STUCK)**. It works as a web app and installable PWA (no account, no tracking).

**Core philosophy (read this first):** the app is NOT trying to mirror the exact weather outside — it exists to let a user make a *fast decision about the near future*. Two lanes drive everything:
- **NOW lane** — "am I getting wet right now?" → trusts the **ground** (physical TAWES stations).
- **NEXT lane** — "when does rain start / stop?" → trusts the **radar nowcast** (GeoSphere 1 km).
- A **continuity layer** (localStorage "story") keeps the narrative coherent between refreshes so a quick re-open never contradicts what it just said.

See `RAIN_LOGIC.md` (untracked, local) for the full flowchart.

**Live URL:** Deployed on Railway (see `.railway.toml`)
**Repo:** `bestin-07/SBZ-RAIN-STALKER`
**Dev branch:** `claude/loving-volta-ywwqz8` → merges to `main`

---

## Architecture

```
SBZ-RAIN-STALKER/
├── frontend/          # React + Vite PWA
│   ├── src/
│   │   ├── App.jsx              # Root component, data loading, blending, localStorage "story"
│   │   ├── main.jsx             # Entry + SW registration + JS force-update (controllerchange)
│   │   ├── api.js               # All client-side API calls (weather + radar sources)
│   │   ├── gaps.js              # detectGaps() + getStatus() (status decision tree)
│   │   ├── i18n.js              # DE/EN translations (status one-liners are variant pools)
│   │   └── components/
│   │       ├── Header.jsx       # Top bar: theme/lang/notify/guide/refresh
│   │       ├── GapBanner.jsx    # Main status display (GO/light/WAIT/STUCK), theme-aware colour
│   │       ├── RainRibbon.jsx   # 3h precip bar chart (radar nowcast), theme-aware palette
│   │       ├── RadarMap.jsx     # Leaflet map: RainViewer overlay + town dots + radar-time banner + relocate crosshair
│   │       ├── LocationPrompt.jsx # Initial loading/permission screen
│   │       └── InfoPanel.jsx    # Slide-up guide + about + data sources
│   ├── public/
│   │   ├── admin/              # Hidden accuracy dashboard (index.html + admin.js), noindex
│   │   ├── sw.js                # Service worker (network-first; cache name stamped per deploy)
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

Sources are queried in parallel on every refresh (all **client-side**, browser → API directly). The **NEXT lane** (gaps, countdowns, ribbon) is driven by the GeoSphere 1 km / 15-min nowcast (source #3), falling back to Open-Meteo. The **NOW lane** (is it raining on me) trusts the **ground** — see Signal Blending below.

**Physical-sensor reality (important):** within 15 km of the city there are only **2 active TAWES rain gauges** — Freisaal (11350, 1.3 km) and Airport (11150, 3.0 km); the next is 19 km out (5 within 25 km, 13 within 40 km, of 272 nationwide). Everything else we read is radar (gridded) or a model — **not** a ground gauge. This ~3 km gauge gap is the root cause of the hyper-local misses (convective onset, virga over-read); no blending fully closes it. Checked 2026-07: eHYD/Salzburg Hydrographic Service is the only other *official* physical net (open CC-BY, but 30-min cadence + clunky WebGIS access, mostly valley/mountain stations, not the city gap); Netatmo is OAuth-gated with sparse rain-module coverage. Neither is worth integrating for the city.

### 1. Open-Meteo ICON-EU Forecast (`api.js: fetchForecast`)
- **URL:** `https://api.open-meteo.com/v1/forecast`
- **Params:** `current=temperature_2m,wind_speed_10m,weather_code,precipitation,cape,uv_index` + `minutely_15=precipitation&forecast_minutely_15=48` + `hourly=precipitation_probability&forecast_hours=6`
- **`precipitation_probability`** — model confidence, used to soften the radar countdown: if the nowcast shows rain but probability < `RAIN_PROB_MIN` (50%), the sub-line becomes "rain possible later" (`s_rain_maybe`) instead of a firm ETA — the virga/over-read guard.
- **Update cycle:** ~hourly model run, can lag 2-3h on convective alpine rain
- **Used for:** weather notes (temp/wind/code), current measured precipitation, and **fallback** gap timeline + ribbon if the nowcast is unavailable. The Open-Meteo 3–12 h tail is no longer shown in the ribbon — stripped 2026-06 because it looked as confident as radar but isn't.
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
- **Backend-served (2026-07):** `fetchNearbyStationPrecip` now **prefers the shared `ground` value on `/api/ambient`** (the backend does ONE central TAWES fetch per cycle; all 11 city grid points read the same 2 gauges anyway), falling back to the direct call only if the backend is unreachable. This stabilises the NOW reading — a per-IP direct call intermittently 429s and, when it dropped, `effectivePrecip` fell back to the spiky radar current slot and swung GO ANYWAY↔STUCK on refresh. `ground: null` (TAWES genuinely down) → client returns null → radar fallback (unchanged semantics).

### 3. GeoSphere Nowcast 1 km / 15-min — PRIMARY gap timeline (`api.js: fetchNowcastTimeline`)
- **URL:** `https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/nowcast-v1-15min-1km`
- **Param:** `parameters=rr&lat_lon=<lat>,<lon>` (param name is **lowercase `rr`**; unit kg/m² = mm)
- **Resolution:** 1 km grid, **15-min steps, +3 h horizon** (e.g. issued 20:45 → 21:00…23:45). Radar-extrapolation nowcast — catches convective rain the ICON-EU model lags on, at the user's exact cell.
- **Returns:** `{ times:[unix s], precips:[mm] }`, or `null` on failure → App.jsx prepends a synthetic "now" slot (from live measurements) and runs `detectGaps` on it. Falls back to Open-Meteo `minutely_15` when null.
- **Backend-served (2026-07):** `fetchNowcastTimeline` now **prefers the per-point `nowcast` attached to `/api/ambient`** (the backend already fetches this timeline each 5-min cycle for accuracy — it's reused, no extra API call), falling back to the direct browser→GeoSphere call only when the backend copy is unavailable. This fixes the ribbon going blank on **mobile CGNAT** (many users behind one carrier IP → the per-IP direct call 429s; the shared backend fetch is immune). GPS still stays local — the client picks the nearest served point. Also removes the ~320 GeoSphere calls/hour the map dots used to make client-side (`computeStatusAt` shares this path).
- **Response path:** top-level `timestamps[]` + `features[0].properties.parameters.rr.data[]`
- **History:** replaced the hourly INCA analysis (too coarse in time) which itself replaced DWD RADOLAN `GetFeatureInfo` on `maps.dwd.de` — DWD is **HTTP 403 (WAF block)** from Austrian networks for both `GetFeatureInfo` and `GetMap`, so the whole `maps.dwd.de` host is unusable here.

### 4. Open-Meteo Current Measured (`App.jsx: loadData`)
- `data.current.precipitation` — Open-Meteo's reported last-hour measured value; same call as source 1, contributes to the NOW reading alongside TAWES (guarded against its 0.10 mm rounding when TAWES confirms 0).

### 5. RainViewer radar tile sample at GPS (`api.js: fetchRainViewerPrecip`)
- Downloads the latest RainViewer radar frame, converts the user's GPS to a **z=7 tile + pixel**, and reads a **5×5 pixel block** (~700 m) via a `crossOrigin` canvas; alpha > 30 → echo. Returns `0.3` (rain), `0` (clear), or `null` (CORS canvas tainted / unavailable — graceful no-op).
- Purpose: a radar-at-your-exact-pixel signal that catches rain the stations miss (the Nonntal onset case), faster than the tipping bucket. **Best-effort** — if the CDN doesn't send CORS headers it silently returns null and the app behaves exactly as before.
- **Used for BOTH the live location AND the map dots (2026-07).** Originally sampled only for the user's own location. That created a persistent, confusing mismatch: during a hyperlocal drizzle the 2 sparse gauges miss, the live view read **GO ANYWAY** (RainViewer echo) while the town dots read **GEMMA RAUS** (nowcast/model only, no RainViewer) — the dots were *wrong*, not the location. `computeStatusAt` now folds the same 5×5 RainViewer sample into the dots' `effectivePrecip`/`rvRainActive`, so a dot agrees with the live view. **Do not "fix" this divergence by removing RainViewer from the location** — that makes both consistently wrong (blind to real drizzle). The correct direction is to give the dots the *same* signal, not to strip it from the location. `weather-maps.json` is cached 60 s (`getRainViewerMaps`) so sampling ~15 dots hits the endpoint once, not 15× (the z7 radar tile is already shared/browser-cached — every Salzburg point maps to the same tile).

### Signal Blending (`App.jsx: loadData`) — ground-truth NOW, radar NEXT
```js
const omForNow    = /* OM current, 0 if TAWES present & 0 (kills OM's 0.10 rounding) */
const stationPrecip = /* max RR of nearest TAWES (≤15 km) + airport */
const rvPrecip    = /* RainViewer 5×5 sample, 0 if null */
const groundPrecip = Math.max(omForNow, stationPrecip)   // ground only (no radar)
const groundDry    = stationData !== null && groundPrecip < 0.1

// detectGaps runs on the RAW nowcast (no prepended TAWES slot). When groundDry,
// the CURRENT nowcast slot is zeroed first so a light over-read overhead (virga)
// doesn't hide the real next rain.
const { currentPrecip: cp, gaps, nextRainAt, dryEndsOpen } = detectGaps(nowcast.times, gapPrecips)

// NOW condition: if stations are reporting, trust the GROUND magnitude (not just
// presence) — the radar over-reads light rain (0.4mm → 1.5mm) and would escalate a
// drizzle to STUCK. Only with NO station do we fall back to the radar/RV max.
const effectivePrecip = cp === null ? null
  : stationData !== null ? groundPrecip
  : Math.max(cp, nowPrecip)   // nowPrecip = max(omForNow, stationPrecip, rvPrecip)

const maxSoon = /* peak nowcast precip over next 45 min — gates the light state */
```
- **Why ground magnitude:** Salzburg's 2 city gauges are accurate once triggered; the radar nowcast is extrapolation and chronically over-reads light returns (virga). Trusting the ground magnitude when a station reports rain fixes the recurring "drizzle shown as STUCK". Radar/RV still catch rain the stations *miss* (station = 0) — the Nonntal onset case.

---

## Gap Detection Logic (`gaps.js`)

- **Threshold:** `DRY_THRESHOLD = 0.1` mm/h — anything below is "dry"
- **Min gap:** `MIN_GAP_SLOTS = 2` → 2 × 15 min = 30 minutes minimum. **Kept at 30 (not 15) on purpose** — a single 15-min nowcast slot is too likely to be noise to promise as a "go out" break. The rain-*coming* countdown does NOT depend on this (see below), so shortening it isn't needed for urgency.
- **Look-ahead:** `LOOK_AHEAD = 3 * 3600` = 3 hours
- Considers the slot we're currently **inside** (includes 1 slot in the past for current slot identification)
- `opensEnded: true` if gap extends to end of forecast window
- **Trend fields** also returned by `detectGaps`: `nextRainAt` (unix ts of the next wet slot when it's dry now, independent of `MIN_GAP_SLOTS`) and `dryEndsOpen` (dry for the whole 3 h ahead).

### Status Logic (`getStatus`) — 4 states + live narrative
`getStatus(currentPrecip, gaps, weather, t, nowSec, trend)`. `currentPrecip` is `displayPrecip` (= `effectivePrecip`; the old hysteresis hold was removed). `nowSec` is a per-minute ticker (`tickNow`). `trend` carries `{ nextRainAt, dryEndsOpen, rvRainActive, rainProb, recentRain, maxSoon, downpourSoonMin }`. Every returned status also carries a `notice` `{head, sub}` — the passive third-person wording for the MAP POPUPS (`n_*` strings), separate from the first-person brand headline/sub (used only on the big banner).

Thresholds (`gaps.js`): dry `0.1` · gap `≥30 min` (2 slots) · `SOON_MIN 5` · `RAIN_SHOW_MIN 10` · `ALMOST_MIN 10` · `LIGHT_MIN 0.2` · `LIGHT_MAX 0.5` · `RAIN_PROB_MIN 50` · `RAIN_SOON_NOTE 90`. Downpour-warning thresholds live in `App.jsx`: `DOWNPOUR_MM 1.5` within `DOWNPOUR_WINDOW_MIN 30` (`firstDownpourMin`).

```
currentPrecip === null → CHECKING (loading)

isDry (<0.1) OR gapNow → GO (GEMMA RAUS):
  downpourSoonMin != null → "heavy rain in ~X min" (s_downpour_soon)  ← TOP PRIORITY
  dryEndsOpen              → "clear for hours"                 (s_clear_hours)
  rain coming (nextRainAt):
    prob < 50%             → "rain possible later"             (s_rain_maybe)
    recentRain & <10 min   → "short break — rain back shortly" (s_rain_back_soon)
    recentRain & ≥10 min   → "short break — rain in about X"   (s_rain_back)
    <10 min                → "any minute now"                  (s_rain_any)
    ≥10 min                → "rain in about X" (rounded to 5)  (s_rain_soon)
  recently rained, now dry → "rain's eased, dry now"          (s_rain_eased)
  otherwise               → "no rain right now"               (s_dry_generic)

LIGHT drizzle (currentPrecip 0.2–0.5) → PASST SCHON / GO ANYWAY:
  downpourSoonMin != null → "heavy rain in ~X min" (s_downpour_soon)  ← TOP PRIORITY
  night     → cosy drizzle sub (s_night_drizzle)
  gap ahead → clearing / dry-window-in-X (s_light_soon / s_light_clearing)
  else      → "just a light drizzle, go anyway"               (s_light)

RAINING, ≥30-min break ahead (gaps[0]) → WAIT:
  clears <5 min → headline "GLEICH RAUS / ALMOST OUT"         (s_almost_now)
  else headline "NOCH X MIN / WAIT X MIN"; sub via breakSub:
    open-ended  → "rain ending in X"          (s_clearing)
    ≤10 min     → "almost over, dry in X (Y)"  (s_almost_over)
    else        → "break in X, lasts Y"        (s_break_opens)

RAINING, no break in 3 h → BLEIB DRIN / STUCK                 (s_stuck / s_stuck_storm)
```

- **`gapNow`** = `firstGap.startsAt <= nowSec && !trend.rvRainActive` → routes to GO (model says dry now), *unless* RainViewer radar confirms rain overhead.
- **Rounded ETA (2026-07):** radar onset time jitters between refreshes, so the incoming-rain sub says "shortly/any minute" under 10 min and "about X min" (rounded to nearest 5) at/above — no false-precise ranges like the old "1–18 min".
- **`breakSub()`** is the shared "what's ahead" sub, reused by both WAIT and the light state so PASST SCHON still tells you if the drizzle is clearing / a gap is opening.
- **Weather note** (`getWeatherNote`): hazards (thunder/storm/snow/fog) always show; the "go outside" comfort notes (perfect/hot/etc.) are suppressed when `raining` or when rain is < 90 min away, and `weather_perfect` also needs a clear sky (code ≤ 2) — so no "made for going out" under a countdown.
- **Night nudge:** browser-local 00:00–04:59 → cozy `s_night_*` sub-lines; the light state stays light but uses `s_night_drizzle` (calm drizzle wording, never "raining").
- **Rotating one-liners:** `s_*` keys are **arrays of variants** (3 each, DE & EN). `t()` picks stably via `(phraseSeed + dayNumber + hash(key)) % pool.length` (`phraseSeed` = per-user random in localStorage) → varies by user, stable within a day, rotates daily. Headlines are fixed (brand).

### Logic change log
Every change that alters the verdict or the data feeding it — newest first. Behavioural boundaries only; cosmetic/UI omitted.

- **2026-07 · Imminent-downpour warning (`firstDownpourMin` + `s_downpour_soon`).** GO and light states now surface a **top-priority** "heavy rain in ~X min" sub when the (virga-filtered) radar shows ≥ `DOWNPOUR_MM` (1.5 mm) within `DOWNPOUR_WINDOW_MIN` (30 min). *Additive* — it changes the sub-line, not the state (you still see GO/GO ANYWAY, because it's dry/drizzly **now**). Fixes "GO ANYWAY" walking the user into a convective downpour the model missed (Nonntal). Requires the virga filter to avoid false triggers.
- **2026-07 · Ground reading moved to the backend (stability).** `fetchNearbyStationPrecip` now prefers the shared `ground` value on `/api/ambient` (one central TAWES fetch, all city points share the same 2 gauges) over a per-IP direct call. **No decision-tree change** — same `effectivePrecip` blend; only the *source* of the ground number. Kills the GO ANYWAY↔STUCK flip caused by the direct TAWES call intermittently failing under rate limits and falling back to the spiky radar current slot. `null` (TAWES genuinely down) still falls back to the radar.
- **2026-07 · Virga filter on the served nowcast (`_filter_virga`, backend).** Suppresses LIGHT radar echo (< 0.3 mm) when hourly probability < 50% — kills the stable-day over-read (0.10–0.11 mm the model reads as 0) that painted false rain on the ribbon AND registered as "rain coming". Heavier echo (real cells the model misses) and high-probability slots pass through. Applies to the shared backend nowcast → fixes ribbon + verdict together.
- **2026-07 · Nowcast moved to the backend.** `fetchNowcastTimeline` prefers the per-point `nowcast` on `/api/ambient`; fixes the ribbon/verdict flip-flopping as the direct GeoSphere call got rate-limited (mobile CGNAT).

### Narrative continuity — the localStorage "story"
`App.jsx` persists `story = { lat, lon, ts, lastWetAt }` each refresh. Trusted only **within 1 km** (`STORY_RADIUS_M`) of where it was written (else fresh start). It provides:
- **Time-based hysteresis** (`HOLD_MS = 5 min`): once "raining" was shown, keep showing it up to 5 min after readings go dry — *survives reloads* (the old in-memory streak did not), so a quick refresh mid-shower won't flash GO.
- **`recentRain`** (`RECENT_RAIN_MS = 15 min`): "was raining lately" → getStatus frames incoming rain as "short break — rain back" and a fresh dry spell as "rain's eased", instead of a contradictory "rain approaching" on a quick re-open.
- Server is the *writer* (fresh data); localStorage only carries *continuity*.

### Status colours — matched to the ribbon legend (theme-aware)
Headline colour = `var(--c-<type>)` (GapBanner), and the RainRibbon palette + legend use the **same** values, so the headline always matches its legend swatch in both themes. Dark theme keeps the vivid palette; light theme darkens every accent for WCAG-AA contrast on the cream background (defined in `index.css`):

| state | token | dark | light |
|---|---|---|---|
| GO / dry | `--c-go` | `#D4A017` | `#7A5E00` |
| light | `--c-light` | `#6CD1EB` | `#1E86B0` |
| WAIT / moderate | `--c-wait` | `#1BAEE2` | `#0A6E9C` |
| STUCK / heavy | `--c-stuck` | `#0077AA` | `#024D6E` |

Warning-banner accents (`--c-uv/warn/alert`) and `--c-muted` are likewise darkened in light mode.

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `frontend/src/App.jsx` | State management, data fetching, layout |
| `frontend/src/api.js` | All client-side data sources (Open-Meteo, TAWES, nowcast, RainViewer sample, area dots) |
| `frontend/src/gaps.js` | `detectGaps()` + `getStatus()` + `breakSub()` |
| `frontend/src/i18n.js` | All DE/EN strings |
| `frontend/src/components/Header.jsx` | Top bar (always rendered, even before location granted) |
| `frontend/src/components/GapBanner.jsx` | Main status display |
| `frontend/src/components/RadarMap.jsx` | Leaflet base map + RainViewer overlay + nearby-town precip dots + "recenter on me" `flyTo` button |
| `frontend/src/components/InfoPanel.jsx` | Guide + about + data sources |
| `frontend/src/main.jsx` | SW registration + JS force-update (controllerchange reload) |
| `frontend/public/sw.js` | Service worker; cache name stamped per deploy (Dockerfile) |
| `frontend/public/admin/` | Hidden accuracy dashboard (index.html + admin.js) |
| `backend/main.py` | Push notifications, accuracy tracking, F0.5 calibration, admin API |

### localStorage keys (all client-side, never sent to us)
`theme`, `lang`, `phrase_seed` (one-liner rotation), `push_unsub_token`, `ios_hint_dismissed`, `last_location` (`{lat,lon,ts}` — GPS cache), `story` (`{lat,lon,ts,lastWetAt}` — narrative continuity), `gr_admin_key` (sessionStorage, admin page only). The privacy copy (`privacy_2`, privacy page) discloses the local location cache.

### JS force-update (deploy → fresh JS without hard-refresh)
One `DEPLOY_TS` (Dockerfile) stamps **both** the SW cache name and Vite's `__BUILD_ID__` (logged on boot). A new deploy → new SW installs, `skipWaiting()`s, claims clients → `controllerchange` fires → `main.jsx` reloads once (guarded against first-load/loops) and re-checks for a new SW on tab focus.

---

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `VITE_BACKEND_URL` | Frontend **build** + Railway | Backend base URL (empty = same origin) |
| `VITE_DONATE_URL` | Frontend **build** + Railway | Donate link for the Support button (PayPal.me/Stripe/Ko-fi); empty = button hidden |
| `VAPID_PRIVATE_KEY` | Backend (Railway secret) | Push notification signing |
| `VAPID_PUBLIC_KEY` | Backend (Railway secret) | Push notification public key |
| `CANONICAL_HOST` | Backend (Railway) | If set (e.g. `www.gemmaraus.at`), 301-redirects other `gemmaraus.*` hosts (apex) to it so SEO consolidates to one domain. Unset = no redirect. |
| `ADMIN_KEY` | Backend (Railway secret) | Unlocks the hidden accuracy dashboard at `/admin/` (manual URL). The page sends it as `X-Admin-Key` to `/api/admin/accuracy`; unset = endpoint 503/disabled. Not linked anywhere; `noindex` + robots-disallowed. |

**`VITE_*` are build-time, not runtime.** They're baked into the JS bundle by Vite during `npm run build`. In the Docker build, Railway service variables only reach the build if declared as `ARG` in the Dockerfile's `frontend` stage (see `ARG VITE_DONATE_URL` / `ARG VITE_BACKEND_URL`). Changing one in Railway requires a **rebuild/redeploy** to take effect — restarting the container is not enough.

---

## Known Issues / Technical Debt

### DWD `maps.dwd.de` — FULLY REMOVED (WAF-blocked, not CORS)
**Resolved 2026-06.** Live testing showed **both** DWD WMS request types return **HTTP 403 ("Access Denied", F5/edge WAF signature)** from Austrian user IPs — not CORS, a server-side block that browser headers don't bypass:
- `GetFeatureInfo` (the old `fetchRadarPrecipAtPoint()` data point) → 403, returned `null` every request → replaced by the GeoSphere nowcast (data source #3 above).
- `GetMap` (the `dwd:RX-Produkt` **tile overlay** on the map in `RadarMap.jsx`) → also 403, returned an HTML error body instead of a PNG → the radar overlay rendered nothing. **Removed entirely**; RainViewer is now the sole radar overlay.

Do not reintroduce any `maps.dwd.de` request — the whole host is blocked for Austrian (and likely most EU residential) networks.

### ICON-EU Model Lag
The Open-Meteo ICON-EU model runs roughly hourly and can be 2-3h behind convective rain events in the Alps. On fast-moving summer storms, all model-based signals (minutely_15, current.precipitation, weather_code) can show `0` while it's actively raining. The TAWES stations (fast, 10-min) and the GeoSphere nowcast (1 km / 15-min radar) are meant to compensate — but only if those API calls succeed. The inverse also happens: the radar nowcast **over-reads** light returns (virga) — see the ground-magnitude blending above.

### Storm potential banner — Alpine/Salzburg specific (CAPE ≥ 1500 J/kg)
A yellow ⚡ banner fires when `current.cape ≥ 1500 J/kg` between 12:00–21:00 local time. This threshold is **deliberately calibrated for the Alpine environment**: orographic lifting from the Alps means convective cells can fire and intensify within 15–20 min from a clear sky. 1500 J/kg is genuinely extreme here.

**Do not port this threshold blindly to other regions:**
- Flatland Europe (Bavaria, Vienna plain): convection is slower-building, 1500 J/kg is still severe but cells take longer to fire — threshold may be appropriate but timing behaviour differs.
- Tropical regions (Kerala, coastal India): CAPE routinely exceeds 2000–3000 J/kg; 1500 is unremarkable and would fire constantly. Recalibrate to ≥3000 J/kg or use a different index (e.g. K-index, Total Totals).
- GeoSphere and TAWES do **not** provide realtime lightning data in their public API (APOLIS is historical only). Open-Meteo's `lightning_potential` field is unreliable for Alpine convective events — ignore it, use CAPE + Lifted Index instead.

### GeoSphere TAWES Metadata Format — VERIFIED
Live-confirmed 2026-06: the metadata endpoint returns `{ ..., stations: [...] }` where each station object has exactly `id` (string), `lat`, `lon`, `is_active` (bool). Discovery filters out inactive stations and falls back to `station_ids=11150` only if the whole metadata fetch fails.

### Backend push, accuracy & calibration
`backend/main.py` mirrors the frontend: `_fetch_timeline_sourced()` prefers the GeoSphere 1 km/15-min nowcast (Open-Meteo fallback) for the forward timeline; `fetch_now_precip()` uses nearest TAWES (Open-Meteo current fallback) for the live reading. `run_cycle()` (every 5 min) stores nowcast predictions for 11 city grid points at +30/60/90 min and verifies them against TAWES actuals; `check_and_push` requires ≥3/11 points to agree (majority vote) with a 3-per-4h session budget + per-type cooldowns.

**Accuracy metrics vs the app's verdict:** the dashboard measures the *raw nowcast source* at a fixed 0.1 mm threshold — NOT the app's final blended verdict (ground override / RV / hysteresis / light-state are not logged). So "accuracy" is source health, not user-experienced correctness. Note also that headline "accuracy" (~95%) is **base-rate inflated** (rain ~4% of slots → "always dry" scores ~96%); judge skill by **CSI / FAR / POD**, not accuracy.

**Calibration (F0.5, reviewed 2026-07):** `weekly_calibrate()` tunes each point's push threshold on 30 days of verified data. It optimises **F0.5 (precision-weighted)**, not F1 — rain is rare, so plain F1 drives thresholds down and floods false alarms; for a "should I go out" app a false alarm (false STUCK / false push) is worse than a miss. Candidates start at **0.10** (`get_threshold` floors there, so sub-floor candidates were silent no-ops). The calibrated threshold gates the push "rain incoming" forward detection, and the admin dashboard reports the **effective (floored)** value. `check_accuracy_health()` does an emergency raise if 7-day accuracy drops below 85%.

**Admin dashboard** (`/admin/`, `X-Admin-Key`): restructured 2026-07 to lead with the honest **rain-skill scorecard** (hits/false/missed/POD/FAR/CSI/F1 per horizon) + **push activity** log; accuracy demoted to a footnote. `/api/admin/accuracy` (30-day classification) and `/api/admin/dashboard` (health, thresholds, calibration runs, alerts, rainfall history, source health, push log).

**24/7 caveat:** the cycle only runs continuously if the Railway service stays awake (always-on plan); Web Push still reaches closed browsers via the service worker, subject to OS battery throttling.

### Far-from-Salzburg handling
If the user's location is **> 50 km** from Salzburg centre (`kmFromSalzburg` vs `FAR_KM` in App.jsx), the app shows the `FarAway` screen ("Salzburg misses you") with a **View Salzburg center** button (calls `useDefaultLocation`) instead of loading unreliable far-away data — `loadData` early-returns past 50 km. Within 50 km but outside the bounding box, the softer `isOutsideSalzburg` banner still shows.

### Geolocation: user gesture + denied-state handling (Safari/Firefox)
Do **not** auto-request `getCurrentPosition` on mount — Safari and Firefox suppress or never show the permission prompt unless the call originates from a user gesture (Chrome is lenient, which masked this). The request is triggered only by the "GET MY LOCATION" button; App tracks a `locating` state for the button's loading label.

If the prompt still never appears, the permission is usually pre-**blocked/dismissed** (Firefox won't re-ask once dismissed) or the page isn't a secure context (HTTPS / localhost — a plain-http LAN IP silently fails). App handles this:
- On mount, `navigator.permissions.query({name:'geolocation'})` detects a pre-`denied` state and shows help immediately rather than waiting for a click that won't prompt.
- Error codes are mapped (`denied`/`timeout`/`unavailable`/`unsupported`) to specific messages.
- `LocationPrompt` shows **browser-specific instructions** (`detectBrowser()` → `loc_help_{ios|firefox|chrome|safari|generic}`) to re-enable location.
- A **"Use Salzburg center" fallback** (`useDefaultLocation`, 47.8009/13.0448) lets the app work even if GPS never resolves.

### Nearby-town dots & API rate limits
`fetchAreaPrecip()` shows precip for the 12 surrounding towns. It uses a **single batched Open-Meteo request** (comma-separated `latitude`/`longitude` → array response in order), not 12 separate calls — gentler on the rate limit and it no longer drops towns when individual calls get throttled (the old behaviour made the dots "disappear"). It always returns every AREA (precip `null` on failure) so dots render consistently. **All weather/radar calls are client-side (browser → Open-Meteo / GeoSphere directly); none go through the Railway backend**, so public-API rate limits apply per user IP, not to our server. The backend calls GeoSphere nowcast + TAWES for its own 11 accuracy points every 5 min (expanded from 5 in 2026-06: added itzling, liefering, parsch, aigen, gneis, taxham for full city coverage). Push notifications require ≥3/11 points to agree (majority vote) before firing, preventing single-point false alarms.

### RainViewer Animated Radar — now the sole radar overlay
`RadarMap.jsx` uses the RainViewer API for animated radar tiles (~40 min past + 2 nowcast frames). It is now the **only** radar overlay (DWD removed — see above).
- **`maxNativeZoom: 7` — do NOT raise this.** Verified 2026-06 by decoding the tile PNGs: RainViewer's radar tiles are real only up to **zoom 7**; at **z8 and above it returns a fixed "Zoom Level Not Supported" placeholder image** (a gray box `(0,0,0,140)` with white text — not a transparent/empty tile). Any `maxNativeZoom ≥ 8` makes Leaflet request that placeholder, which is exactly the "Zoom Level Not Supported" boxes that plagued the map. With `7`, Leaflet upscales the z7 tile for higher map zooms. z7 is ~1.2 km/px, already near radar's native resolution, so little real detail is lost.
- Clear sky → RainViewer tiles are fully transparent → **no overlay is the correct, expected look** (not a bug).
- `RV_MAX_ZOOM = 14` gates the animation opacity across the interactive zoom range (minZoom 9 → maxZoom 14). Default map `ZOOM = 11` (shows surrounding-area dots).
- A `ResizeObserver` calls `map.invalidateSize()` on mount and resize, so the flex-mounted container (`flex-1 min-h-0`, with sibling banners that settle height after first paint) doesn't leave the base tiles blank.
- **Radar-time banner** (top-left): shows the timestamp of the animating frame, with a dot + label distinguishing past `radar` from `nowcast` (forecast) frames.
- **Relocate crosshair** (bottom-right): recenters *and* forces a fresh high-accuracy GPS fix (bypassing the 500 m debounce) — for a user who moved (cycled across town). No separate button.

### Geolocation lifecycle (App.jsx)
- On mount, `permissions.query('geolocation')`: `denied` → show help; `granted` → silently `requestLocation()` (no prompt shown when already granted). `last_location` is restored from localStorage first so the app renders immediately.
- **500 m jitter debounce** (`MIN_MOVE_M`): a background GPS re-read < 500 m from the current fix is ignored (keeps `prev`) so it doesn't churn the pipeline / shuffle nearest stations. The explicit relocate crosshair and the accuracy "Improve" upgrade bypass it.
- **Stale-location nudge:** once the stored fix is > 1 h old, a small dismissible banner suggests tapping the crosshair; reappears only after a fresh fix goes stale again.

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
- `forecast` call to `api.open-meteo.com` (current + minutely_15 + hourly precip probability)
- `tawes-v1-10min/metadata` then `tawes-v1-10min?parameters=RR,TL&station_ids=...` to `dataset.api.hub.geosphere.at`
- `nowcast-v1-15min-1km?parameters=rr&lat_lon=...` to `dataset.api.hub.geosphere.at` (the primary NEXT-lane source)
- a RainViewer `weather-maps.json` + a `tilecache.rainviewer.com` tile (the GPS radar sample)

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

# Test GeoSphere nowcast (primary NEXT-lane source; lowercase rr)
curl "https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/nowcast-v1-15min-1km?parameters=rr&lat_lon=47.8,13.04"

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
- Does `tawes-v1-10min?parameters=RR&station_ids=...` return non-zero `RR` for the nearest stations (the fast 10-min ground signal, the NOW lane)?
- Does `nowcast-v1-15min-1km?parameters=rr&lat_lon=...` show the incoming band (the NEXT lane)?
- Watch for the **ground vs radar disagreement**: stations light (e.g. 0.4 mm) while the nowcast reads moderate (1.5 mm) is the virga over-read — the ground-magnitude blend + light-rain state handle it.
- (DWD is no longer used — it 403s from Austrian networks. Don't reintroduce it.)

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
- **Rain/radar calls are client-side** — GeoSphere nowcast + TAWES + RainViewer go browser → external API directly, per-GPS. **Exception:** the coarse Open-Meteo *ambient* fields (temp/wind/code/cape/uv + hourly precip probability) are fetched **once per 5-min cycle by the backend** for the 11 grid POINTS and served via `GET /api/ambient`; the browser picks the nearest point (`fetchForecast` prefers ambient, falls back to a direct Open-Meteo call). This dodges Open-Meteo's per-IP rate limit / shared-NAT throttling. **GPS still never touches the server** — `/api/ambient` returns all grid points and the nearest is chosen client-side.
- **GPS coordinates never leave the browser** — the `/api/forecast` backend endpoint is no longer called from the frontend (data is fetched client-side); lat/lon is only sent to third-party weather APIs directly.
- **Rate limits apply per user IP** (via slowapi) for the Railway backend endpoints. External weather APIs have their own rate limits per user IP.
- **VAPID key pair** — private key is a Railway secret (`VAPID_PRIVATE_KEY` env var); public key is served via `/api/vapid-public-key` GET endpoint (public-key exposure is intentional and required for push subscriptions).
