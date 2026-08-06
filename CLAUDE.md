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
│   │   ├── logo.svg             # Brand icons (user-maintained)
│   │   ├── favicon.ico
│   │   ├── favicon-16x16.png / favicon-32x32.png
│   │   ├── apple-touch-icon.png
│   │   ├── android-chrome-192x192.png / android-chrome-512x512.png  # PWA app icons (referenced by InstallPrompt + manifest)
│   │   ├── maskable-icon-512.png
│   │   └── og-image.png
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

### 6. GeoSphere/ZAMG Official Severe Weather Warnings (`backend/main.py: fetch_severe_warnings`)
- **URL:** `https://warnungen.zamg.at/wsapp/api/getWarningsForCoords?lat=<lat>&lon=<lon>` (the real live host — `openapi.hub.geosphere.at` only serves the Swagger/OpenAPI docs, 404s if queried directly).
- **A distinct, authoritative source** from every other section above: those are our own CAPE/wind/UV/storm heuristics computed from model fields; this is GeoSphere Austria's official civil-protection Warn API (7 hazard types: storm/rain/snow/black ice/thunderstorm/heat/cold, 3 severity levels: yellow/orange/red), aggregated at municipality level. License CC BY 4.0.
- **Backend-fetched once per 5-min cycle** for Salzburg's centre point only (municipality-level data — one query represents the whole city, same precedent as the single `city_ground` TAWES fetch). Served as `_ambient["warnings"] = [{id, type, level, start, end}]` via the existing `/api/ambient` route — no endpoint changes needed.
- **Only structured fields are served** (`id` = `warnid:verlaufid`, `type` = warntypid 1-7, `level` = warnstufeid 1-3, `start`/`end` = unix epoch from `rawinfo`) — the API's free-text `text` field is never stored/shown; the frontend translates type+level via `t('warn_type_N')`/`t('warn_level_N')`, matching the `area_watch` `t('dir_' + sector)` pattern (one translation source, not a second API call per language).
- **Gewitter (thunderstorm, warntypid 5) is served like every other type (v2.17.0).** It was previously dropped server-side as "redundant with our own CAPE storm banner" — that reasoning was wrong: the CAPE banner needs ≥1500 J/kg, and the Nonntal thunderstorm of 2026-08-06 ran at CAPE 200–260, so nothing covered it. Do NOT re-add the filter; an official, human-issued warning is a different class of evidence from our own heuristic and is the only warning source with headline-override power. Banner clutter stays bounded by the existing top-2-by-severity cap.
- **Frontend banner** (`App.jsx`): a dismissible banner per currently-ACTIVE warning (`start <= now <= end`), styled like the other stacked banners, **capped to the top 2 by severity** (level desc, soonest-ending tiebreak) — a live incident showed 4 simultaneous warnings stacking into a wall of banners, which was worse than useful. Dismissal persists to `localStorage` keyed by `id` — a multi-day event (e.g. a 5-day heatwave) gets a DIFFERENT `verlaufid` per day, so the banner correctly reissues once the active instance rolls over, even though it's conceptually "the same" hazard. Expired ids are pruned automatically (no longer in the active set → dropped from the dismissed list) — safe, since an id can never become active again.
- **Push** (`backend/main.py: _push_severe_warning`): one push per warning INSTANCE, gated by a `last_warning_push_id` value in the `settings` table (not the daytime/story-slot gates `check_and_push` uses — an official warning can matter overnight, and a multi-day hazard legitimately spans the whole day). Reissues only when the active id changes.
- **RED-level warning overrides the headline** (`App.jsx: redWarning`) — see Logic change log v2.14.0.

### Signal Blending (`App.jsx: loadData` + `computeStatusAt`) — ground-truth NOW, radar NEXT (v1.1.4)
```js
const omForNow    = modelNowValue(measured, stationData !== null, stationPrecip,
                                  Math.max(rawNowSlot, rvPrecip))
                    /* OM current; 0 if TAWES present & 0 (kills OM's 0.10 rounding);
                       capped to 0.4 vs a reporting gauge (v2.0.1 trailing-edge guard)
                       UNLESS ≥1.5 and radar/RV confirm rain falling now (v2.17.0) */
const stationPrecip = /* backend shared `ground` (preferred) or direct TAWES max RR */
const rvPrecip    = /* RainViewer 5×5 sample, 0 if null */
const groundPrecip = Math.max(omForNow, stationPrecip)   // ground only (no radar)
const groundDry    = stationData !== null && groundPrecip < 0.1

// detectGaps runs on the (virga-filtered) nowcast. When groundDry, the CURRENT
// slot is zeroed first so a light over-read overhead (virga) doesn't hide the
// real next rain. Future slots are never touched.
const { currentPrecip: cp, gaps, nextRainAt, dryEndsOpen } = detectGaps(nowcast.times, gapPrecips)
const rawNowSlot = /* the UN-zeroed nowcast value at "now" (for drizzle surfacing) */

// NOW value (exact v1.1.4 blend):
let effectivePrecip, drizzleSurfaced = false
if (cp === null)               effectivePrecip = null
else if (stationData !== null) {
  effectivePrecip = groundPrecip                       // ground magnitude rules
  if (groundPrecip < DRY_THRESHOLD) {                  // gauge says dry, but…
    const drizzle = Math.max(rawNowSlot, rvPrecip)
    if (drizzle >= DRY_THRESHOLD && drizzle < LIGHT_MAX) {   // …radar/RV see LIGHT echo
      effectivePrecip = Math.max(drizzle, LIGHT_MIN)   // → surface as GO ANYWAY
      drizzleSurfaced = true                            //   (capped: never WAIT/STUCK)
    }
  }
} else effectivePrecip = Math.max(cp, groundPrecip, rvPrecip)  // no gauge → radar max

const downpourSoonMin = firstDownpourMin(nowcast, nowSec)  // ≥1.5mm within 30min → warn
// trend.rvRainActive = rvPrecip >= DRY_THRESHOLD || drizzleSurfaced  (blocks gapNow)
```
- **Why ground magnitude:** Salzburg's 2 city gauges are accurate once triggered; the radar nowcast is extrapolation and chronically over-reads light returns (virga). Trusting the ground magnitude when a station reports rain fixes the recurring "drizzle shown as STUCK". Radar/RV still catch rain the stations *miss* (station = 0) — the Nonntal onset case.
- **Why drizzle surfacing (v1.1):** the 2 gauges can't feel a hyperlocal drizzle between them; a wet user was shown GEMMA RAUS. Light radar/RV echo (0.1–0.5) now surfaces as GO ANYWAY — hard-capped at the light band so radar can NEVER manufacture a false WAIT/STUCK, and `drizzleSurfaced` blocks `gapNow` so the two can't tug-of-war. Policy: *a jacket beats a soaking*.

### The sensing layer — one line each
| Instrument | Is | Truth for | Blind spot |
|---|---|---|---|
| **TAWES gauges** (Freisaal 1.3 km, Airport 3 km, 10-min) | physical tipping buckets | "am I wet NOW" | drizzle *between* the gauges |
| **GeoSphere nowcast** (1 km / 15-min / +3 h) | radar echo extrapolated | "when does rain start/stop" | virga (echo that never lands) |
| **ICON-EU** (Open-Meteo) | physics model, hourly prob | confidence — how firmly we speak | lags Alpine convection 2–3 h |
| **RainViewer pixel** (5×5 px ≈ 700 m at GPS) | latest radar frame at your spot | eyewitness: catches gauge-missed rain, blocks false GO | binary echo only |

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

### Override precedence & audit (v1.1.4 — audited 2026-07, no circular contradictions)
The full precedence chain is a **strict one-way ladder**; each override has exactly one guard and no pair can flip each other back and forth:

**ground magnitude → drizzle surfacing → gapNow (RV-guarded) → downpour warning → wording softeners**

| Override | What beats what | Guard against lying | Verdict |
|---|---|---|---|
| **Ground magnitude** | gauge beats radar magnitude for NOW | drizzle surfacing covers the gauge's blind spot | SOUND |
| **Drizzle surfacing** | light echo (0.1–0.5) beats a dry gauge → GO ANYWAY | capped at light band — cannot produce WAIT/STUCK; sets `drizzleSurfaced` which blocks gapNow; an RV-only claim (no filtered-nowcast echo) requires EITHER an independent non-zero radar trace (v2.2.1) OR wide RV coverage `rvSolid` ≥40 % of the ~6×6 km block (v2.4.1 — a drizzle FIELD is not a stuck clutter pixel); clear sky (code ≤ 2) remains an absolute veto | SOUND (live bug pre-v2.2.1: clutter pixel surfaced under overcast; live bug pre-v2.4.1: real drizzle field vetoed when INCA lagged to exact zero) |
| **gapNow** | "gap already started" beats a still-wet gauge → GO (gauge RR lags ~10 min after rain stops) | blocked when RainViewer sees rain overhead or a drizzle was surfaced | ⚠️ SOFT SPOT ① |
| **Virga cap** (backend) | low-prob (<50%) light echo capped to 0.4 | **echo ≥0.8 ALWAYS passes** (v2.17.0, was 1.5) — the lagging model can never veto real rain (v1.1.4, test-locked) | SOUND (was SOFT SPOT ②) |
| **Model-now cap** (`modelNowValue`) | a reporting gauge owns the NOW magnitude; the hour-lagged model current is capped at 0.4 | **released when the model reads ≥1.5 AND radar/RV independently confirm rain is falling** (v2.17.0) — on the trailing edge, which is what the cap was built for, radar is already dry, so the guard still holds | SOUND (was the v2.17.0 incident) |
| **Downpour warning** | imminent heavy radar beats every calm sub in GO/GO ANYWAY | runs on the FILTERED timeline → virga can't false-alarm it | SOUND |
| **Probability softener** | model prob <50% softens countdown WORDING ("possible later") | wording only — never hides rain from ribbon/timeline | SOUND |
| **Story / recentRain** | reframes wording ("rain back" vs "rain approaching") | wording only — state forcing was removed (caused dot/location divergence) | SOUND |
| **Current-slot zeroing** | dry gauge zeroes the nowcast's CURRENT slot pre-gap-detection | only that slot — future rain untouched, onset still reported | SOUND |
| **Night voice** | 00:00–04:59 swaps urgency for calm wording | state & colours unchanged — only the sentence | SOUND |

**⚠️ SOFT SPOT ① — gapNow vs a wet gauge:** if radar declares the gap open while the gauge is still wet AND RainViewer is unreadable (CORS null), a brief false GO is possible. *Symptom: "GEMMA RAUS while I'm still getting wet."* Shelf fix: require the gap to be ≥1 slot old when the gauge is wet.

**✅ SOFT SPOT ② — CLOSED 2026-08-06 (v2.17.0).** The predicted symptom arrived exactly as written — "GO ANYWAY light drizzle that's actually steady moderate rain", during a hail thunderstorm in Nonntal — and the parked shelf fix (`VIRGA_HEAVY_PASS` 1.5 → 0.8) was applied as specified. The incident also exposed a SECOND cap this note never considered (`modelNowValue`, v2.0.1), which is what actually produced the headline; see the v2.17.0 logic-log entry.

**Lesson recorded — audit the ladder for SHARED upstream signals, not just per-override soundness.** Two independently-reasonable caps, each correctly marked SOUND in the table above, were both keyed on the same lagging input (ICON-EU hourly probability) and both wrote the same value (0.4). Stacked, they turned a thunderstorm into a drizzle. The audit checks each override in isolation and structurally could not have caught this. When adding any new suppression, ask what ELSE already keys on the same upstream signal.

Soft spot ① remains a documented trade-off to watch for. If a user report matches its symptom, apply the shelf fix rather than inventing a new mechanism.

### The countdown promise (core product requirement — do not regress)
**Whenever any rain is involved, exactly ONE stable countdown is always on screen:**

| Situation | Countdown shown |
|---|---|
| dry, rain coming (<90 min) | "rain in ~X min" (`s_rain_soon`) |
| dry, rain coming (≥90 min) | "rain in about {1½/2/2½/3} h" (`s_rain_far` / low-conf `s_rain_far_maybe` — softened wording, time kept) |
| downpour ≤30 min | "heavy rain in ~X min" (`s_downpour_soon`) — top priority |
| drizzling, clearing | "clearing in ~X min" (`s_light_clearing`) |
| raining, break coming | "WAIT X MIN · break in X, lasts Y" |
| raining, open-ended clearing | "rain ending in X" (`s_clearing`) |

Stability mechanisms (why "when" never jumps around — **reduce noise is the design goal**):
- **Rounded to 5 min** at ≥10 min; **"any minute / shortly"** under 10 min (radar onset jitters ±5 min between runs — false precision reads as broken).
- **Local per-minute tick** (`tickNow`) — countdowns decrement −1/min on-device between the 5-min data refreshes; they never freeze or jump.
- **One shared backend nowcast** (v1.1.3, cached ~12 calls/cycle) — no reload-roulette from per-IP rate limits.
- **20-min stale cap** on cached timelines — an hour-old forecast can't produce "wait 100 min" garbage.
- **Serve-stale response cache** (4-min TTL) — bursts of taps/re-opens can't flicker the verdict.
- **≥30-min minimum gap** — never promise a break that is one noisy radar slot.
- **Nearest dot mirrors the live verdict** — the map can't contradict the headline where you stand.

### Tests — the logic integrity guard (RUN BEFORE ANY LOGIC CHANGE)
The intended logic is encoded as an executable contract; **run both suites before and after touching gaps.js, the App.jsx blend, or the backend filter/push logic**:

```bash
cd frontend && npm test            # 164 tests: detectGaps, getStatus (all 4 states,
                                   # thresholds, downpour warning, night/evening voice,
                                   # weather notes, notice voice), firstDownpourMin
python backend/test_logic.py      # 23 tests: _filter_virga contract (heavy-pass!),
                                   # threshold constants, MIN_PUSH_AGREEMENT,
                                   # forming detector, area watch, deaccumulate,
                                   # warntypid-5 regression pin (v2.17.0)
```

**CI:** `.github/workflows/tests.yml` runs both suites + a frontend build check on every push/PR to `main`. A red ❌ on a commit = the logic contract broke — don't trust that deploy; roll back by tag (Railway deploys independently of CI, so the X is your signal, not a blocker).

Rules:
- A failing test means the change is a bug — **or the intent changed**, in which case update the test AND add a Logic change log entry **together, never silently**.
- The threshold-contract tests (DRY 0.1 / LIGHT 0.2–0.5 / DOWNPOUR 1.5@30min / VIRGA 50%/0.4/**0.8** / MODEL_NOW_CAP 0.4 + MODEL_HEAVY_PASS 1.5) exist precisely so a "harmless tweak" can't drift the verdict boundaries unnoticed.
- `test_downpour_warning_always_reachable` (v2.17.0) pins the structural invariant `VIRGA_HEAVY_PASS ≤ DOWNPOUR_MM` — the downpour warning reads the FILTERED timeline, so the filter must never be able to clamp a value down from ≥1.5.
- The backend suite extracts the REAL functions from `main.py` via AST (no DB needed) — it always tests shipped code, not a copy.
- v1.1.4's regression (virga filter silently hiding real downpours) is the canonical example these tests now make impossible: `test_real_downpour_survives_lagging_model` replays that exact incident.

### Logic change log
Every change that alters the verdict or the data feeding it — newest first. Behavioural boundaries only; cosmetic/UI omitted.

- **2026-08 · v2.17.0 · Two stacked caps turned a thunderstorm into a drizzle — `modelNowValue` corroboration release, `VIRGA_HEAVY_PASS` 1.5 → 0.8, official Gewitter warnings un-filtered.** Live incident (2026-08-06, ~18:45, Nonntal — hail, thunder, heavy rain; user report: "it is raining like hell and we say passt schon"). Confirmed from the `/api/ambient` snapshot at 18:47 CEST: weather code **96/99** (thunderstorm, hail), Open-Meteo current **6.2 mm** (Altstadt) / **10.8** (Aigen) / **4.8** (Gneis), AROME next hours **14.2 / 11.5 / 9.2 mm**, TAWES ground **1.8 mm/10 min**, CAPE 200–260 — and the served nowcast reading a flat **`0.4, 0.4, 0.4, 0.4`** at Gneis. That carpet is the tell: 0.4 is a clamp value, written four times.
  **Root cause — two caps, one shared upstream signal.** ICON-EU put hour 19 at **43 %** probability (45 % at Aigen), just under `VIRGA_PROB_MIN`. (1) Backend `_filter_virga` clamped every slot below `VIRGA_HEAVY_PASS` (1.5) to `VIRGA_CAP_TO` 0.4. (2) Frontend `modelNowValue` (v2.0.1) clamped the model's 6.2 mm current to `MODEL_NOW_CAP` 0.4 because a gauge was present. `effectivePrecip` = 0.4 → dead centre of the light band (`LIGHT_MIN` 0.2 – `LIGHT_MAX` 0.5) → **PASST SCHON**. Both caps were individually audited SOUND in the precedence table; neither audit could see that they keyed on the SAME lagging model and wrote the SAME value. It only flipped to BLEIB DRIN once the tipping bucket 1.3–3 km away had physically accumulated 1.8 mm — the app waited for the slowest instrument on the list while radar, sky code, AROME and the user all already agreed. **That is a lag, the one failure the doctrine does not forgive.**
  **Fix 1 — `modelNowValue(measured, stationPresent, stationPrecip, radarNow = 0)`:** a heavy model current (≥ new `MODEL_HEAVY_PASS` 1.5) passes UNCAPPED when `radarNow` (= `max(rawNowSlot, rvPrecip)`) is ≥ `DRY_THRESHOLD`. Why this cannot reintroduce the v2.0.1 bug it guards ("WAIT 50 MIN in the sun"): that bug IS the trailing edge — rain over, model still reporting the preceding hour — and there the radar is already dry, so nothing corroborates and the cap still applies at any magnitude (test-pinned at 0.7 AND 3.0). The parameter defaults to 0, so every uncorroborated call behaves exactly as v2.0.1 did. Direction is caution-only: the rule can only RAISE the NOW value, never lower it (test-pinned as an invariant across a matrix of inputs). Applied at BOTH App.jsx call sites (`loadData` and `computeStatusAt`) so the map dots can't diverge from the headline again (v1.1.4 lesson). `nowcastNowSlot()` extracted to gaps.js — the raw-now-slot loop was duplicated at both sites and now has to run BEFORE the blend rather than after.
  **Fix 2 — `VIRGA_HEAVY_PASS` 1.5 → 0.8:** the shelf fix CLAUDE.md parked for SOFT SPOT ②, applied as specified now that the predicted symptom has arrived. Virga is LIGHT by nature — the over-read this filter was built for is 0.10–0.11 mm — so echo at 0.8+ is real weather and the lagging model no longer gets to call it drizzle. Invariant preserved and newly test-pinned: `VIRGA_HEAVY_PASS ≤ DOWNPOUR_MM`, so the filter can never clamp a value down from ≥1.5 and the downpour warning stays reachable on the filtered timeline. **Note for the record:** the claim in the v1.1.4 entry that the filter made the downpour warning unfireable was true of v1.1.0 only; since the heavy-pass exists, ≥1.5 was already immune. The real damage here was the 0.8–1.5 band.
  **Fix 3 — stop dropping Gewitter (warntypid 5)** in `fetch_severe_warnings`. It had been filtered as "redundant with our own CAPE storm banner", but that banner fires at CAPE ≥ 1500 and this storm ran at 200–260, so the redundancy assumption was simply false and nothing covered the hazard. We were discarding the only human-issued, authoritative storm signal we receive — and the only one with headline-override power (`redWarning`, v2.14.0). RED-only override is UNCHANGED (v2.14.0's anti-crying-wolf decision is not reopened); banner clutter stays bounded by the top-2-by-severity cap. Regression-pinned by an AST test that fails if a `wtype == 5` guard reappears.
  **Not changed:** `getStatus`, the state machine, the light band, `DOWNPOUR_MM`, `MODEL_NOW_CAP`, and drizzle surfacing are all untouched. New tests: 6 frontend (158→164), 3 backend (20→23), including a replay of this incident's real served values in both suites.
- **2026-08 · v2.16.0 · Dual-corroborated self-detected storm overrides the headline (`App.jsx: stormImminent`) — same danger plumbing as the v2.14.0 RED override, `gaps.js`/`getStatus` untouched.** Live incident (2026-08-02, ~20:30, Salzburg — genuinely one of the strongest storms of the season): thunder/wind/heavy rain outside while the app still read "GEMMA RAUS". Root cause, confirmed from the actual `/api/ambient` snapshot at 20:42 CEST: CAPE 1610–1860 J/kg at all 11 points and `forming_ts` had fired at ~20:31 — the radar-confirmed initiation detector caught it within a minute of the real onset, so the claim "radar missed it" doesn't hold up; what failed is that both signals (CAPE storm banner, forming banner) are banner-only by design (v1.3.0), and the headline's own `downpourSoonMin` warning only looks `DOWNPOUR_WINDOW_MIN` (30 min) ahead, so a storm still >30 min out on the ribbon couldn't escalate it either. Fix: `stormImminent = stormCape != null && formingActive` — requires BOTH of our own highest-confidence signals simultaneously (CAPE≥1500 alone floods on ordinary hot afternoons; forming alone can be a light shower; the combination is rare and reliable, same dual-key philosophy as v2.8.0/v2.4.1). When true, `GapBanner` gets the same override shape as `redWarning` — `type:'danger'`, `headline: t('STUCK')`, new `sub: t('storm_danger_sub')`, weather/moto cleared — checked after `redWarning` so an active official warning's specific hazard type still wins if both are somehow true. Undismissable, expires automatically when `formingActive` lapses (30 min) or CAPE drops. Also fixed same evening, same incident: v2.15.0 grid-max CAPE (flicker) — this entry is the headline-escalation half of that investigation.
- **2026-08 · v2.15.0 · Storm-CAPE banner flicker fix: grid-max instead of GPS-nearest point (`ambientMaxCape()`) — banner-only, verdict untouched.** Live report (2026-08-02, storm building over Salzburg): "sometimes I see the storm, some refresh no" across reloads with no real change in conditions. Root cause: `cape` was read from whichever of the 11 ambient grid points `nearestAmbientPoint` picked for the user's current GPS fix, with zero hysteresis — a reload landing near the boundary between two grid cells (or catching a slightly different GPS fix on cold app relaunch, since `_ambientPoints` is a page-memory cache that resets on reload) could flip which point counted as "nearest," and CAPE genuinely varies point-to-point even on a broadly unstable day (the live incident showed a real spread, 1560–1710 J/kg, across the grid). Fix: new `ambientMaxCape()` (api.js) returns the highest CAPE across ALL cached grid points; `App.jsx`'s `cape` now prefers this over the single local-point reading (`ambientMaxCape() ?? data.current.cape`), falling back to the old single-point value only when no ambient snapshot is cached yet. Mirrors the backend's own `_detect_forming()`, which already uses `max_cape` across all points for the identical reason (city-scale convective risk, not a single pixel). Grid max is always ≥ the local point's own reading, so this can only make the banner MORE willing to warn, never less — leads forgiven, lags never. Also fixes the same jitter for `capeUnstable`/`isUnsettled` (v1.3.0), which read the same `cape` const.
- **2026-08 · v2.14.0 · RED-level official warning overrides the displayed headline (`App.jsx: redWarning`) — display layer only, `gaps.js`/`getStatus` untouched.** Live incident (2026-07-30/08-01): 4 simultaneous GeoSphere warnings active while the app still showed a calm "GEMMA RAUS" headline from the rain-only verdict — technically correct (it was dry) but misleading during an active civil-protection emergency. `redWarning = warnings.find(w => w.level === 3)` (RED only; orange/yellow stay banner-only, matching the app's existing 2-tier warn/alert colour convention and avoiding crying wolf on routine orange warnings like a multi-day heat advisory). When present, `GapBanner` is given an overridden status object — `type: 'danger'` (new `--c-danger` token, red, distinct from `--c-stuck`'s blue so a warning-driven stop-in reads as a different cause from a rain-driven one), `headline: t('STUCK')` (reuses the existing "BLEIB DRIN"/"STUCK INSIDE" copy verbatim — same voice, different trigger), `sub` naming the hazard type + end time, `weather`/`weatherEmoji`/`moto` cleared (a "good weather to ride" glance would contradict a stay-inside headline). Undismissable by design — the banner list above is closable, this is not; it disappears on its own once the RED instance ends. `getStatus()` in `gaps.js` computes exactly as before; this only swaps what `App.jsx` passes to `GapBanner` for rendering. Paired: Gewitter (warntypid 5) now filtered out of `_ambient["warnings"]` entirely (redundant with the existing CAPE storm banner), and the banner list is capped to the top 2 by severity (4 simultaneous banners was the reported clutter).
- **2026-07 · v2.11.0 · Motorbike glance (`moto`, `MOTO_SAFE_MIN 30`, `minutesToNextRain`) — new additive signal, no existing verdict/wording touched.** User ask: bikers want a "safe to ride the next ~30 min" read that pops up even on days the wider 90-min `RAIN_SOON_NOTE` gate silences the "go enjoy your afternoon" comfort note — a rider only needs half an hour, not the whole afternoon. Deliberately does NOT reuse `rainSoon`/`RAIN_SOON_NOTE`: new pure fn `minutesToNextRain(trend, firstGap, gapNow, nowSec)` computes the minimum "time until rain resumes" across every signal already in `trend` (`nextRainAt`, `modelRainAt`, `downpourSoonMin`, `rvApproachMin`, `traceAheadMin`), PLUS the remaining time in an already-started gap (`firstGap.startsAt + firstGap.durationMinutes*60 - nowSec` — not `durationMinutes` alone, which is the gap's total length and would over-credit a gap that's mostly elapsed). Any signal without a quantified ETA (`traceEcho`, `rvNearbyDir` — real echo close by or already falling, no proven arrival time) counts as 0 minutes (unsafe) — conservative per "leads forgiven, lags never". `moto: motoSafe` is set only on the two `type: 'go'` returns (`motoSafe = goNow && minutesToNextRain(...) >= 30`); every other state (`light`/`wait`/`stuck`/`loading`) hardcodes `moto: false`. Purely additive to the returned object — `weather`, `sub`, `headline`, `notice`, and all existing state transitions are byte-identical; 8 new contract tests including a regression pin proving the 30-min and 90-min windows are independent (rain 45 min out: `weather` suppressed by the 90-min gate, `moto` still true).
- **2026-07 · v2.8.0 · Dual-key phantom-trace guard (`tracePhantom`) — trace tier only, suppression only.** Live incident (2026-07-17): cloudless 30° afternoon (METAR LOWS `NCD`, code 0 at every point, dewpoint spread 17 K) while INCA painted an IDENTICAL trace carpet across all 11 points (first echo the same minute, same 0.01–0.02 values) and RainViewer was byte-identical to an empty ocean tile for ~275 km — the nowcast's model-blend tail leaking numeric noise, shown as 3 h of "drizzle possible" against both instruments and the user's eyes. New pure fn `tracePhantom(code, rv)`: true only when sky clear (code ≤ 2 — the SAME absolute-veto band as `surfaceDrizzle`) AND RainViewer fully quiet (`now < DRY_THRESHOLD && approachMin == null && fromDir == null && !rvSolid`); `rv` null or `now` non-numeric → false (can't corroborate absence → never suppress). When true: `traceAheadMin` → null and `traceEcho` → false at BOTH App.jsx call sites (kills `s_trace_ahead`/`s_trace_echo` wording tiers; via the v2.6 `rainInSight` gate, comfort notes correctly return on a truly clear day), ribbon radar-zone trace stubs dim 0.45 → 0.12 (still drawn — data is de-emphasised, never hidden), and the `ribbon_trace_only` overlay yields to the plain dry label. Why no lag risk: approaching rain releases the RV key (approach frames / 15 km ring) before any cloud is overhead; pop-up cells push code past 2 before raining; and the guard only ever touches the sub-0.1 trace tier — real slots, downpour warnings, approach lanes, countdowns and all verdict states never consult it. Mirrors v1.1.5/v2.2.1 doctrine: clear sky + zero corroboration = clutter/noise, now applied to INCA's own future trace, with RainViewer as the required second key.
- **2026-07 · v2.7.0 · Model union: forecast lane = Open-Meteo ∪ AROME, per-slot max (`combineModelSeries`).** User decision: "forecast is combination of Both — whichever shows rain is displayed, stronger rain > medium > …". Backend fetches GeoSphere AROME (`nwp-v1-1h-2500m`, 2.5 km, hourly, radar-assimilating, re-run 3-hourly) per grid point, cached 30 min (`_AROME_TTL 1800`, ~22 calls/h added vs the nowcast's ~130 — clear of the 429 incident load), precip parameter discovered at RUNTIME from dataset metadata (`rr` preferred, else `rr_acc` → `_deaccumulate`, negatives clamp 0); served raw mm/h as `arome` per point on `/api/ambient`. Frontend `combineModelSeries(times, precips, aTimes, aPrecips)` (pure, gaps.js): per-slot `max(om, arome_hour × slot/3600)`; AROME timestamp = END of its accumulation hour — a wrong convention paints rain one hour EARLY (lead, forgiven), never late. App.jsx shadows `omPrecips` with the combined series at BOTH call sites, so the union feeds: the no-nowcast gap-timeline fallback, `modelNextRainAt` (second-opinion wording), `modelEaseAt` (STUCK ease — max ⇒ later ease, caution direction), ribbon 3–12 h tail, and ghost bars. Radar lane (nowcast/RV/TAWES verdict path) untouched; no AROME on the snapshot → behaviour identical to v2.6.0. Rationale: a union of two independent models can only ADD warnings — the lead/lag asymmetry.
- **2026-07 · v2.6.0 · Comfort notes silenced by ANY rain-in-sight signal (`rainInSight` gate in getStatus) — suppression only.** "Suspiciously perfect 23°C — go before the sky changes its mind" was showing directly under "drizzle possible in 20 min": the `rainSoon` gate only checked a hard `nextRainAt` within `RAIN_SOON_NOTE` (90 min), and none of the radar wording tiers (downpour warning, RV approach ETA, trace echo NOW, nearby ring, trace-ahead) fed it. Now `rainSoon = rainInSight || nextRainAt-within-90`, where `rainInSight` = `downpourSoonMin ≠ null || rvApproachMin ≠ null || rvNearbyDir ≠ null || traceEcho || traceAheadMin ≠ null` — the invariant is *any tier that puts rain in the sub-line also silences the invitation notes*. Strictly one-directional: it can only REMOVE a comfort note, never add one; prep notes (wind/cold/freezing) and hazard notes unaffected; verdict states untouched. (Same release, UI-only: ribbon zone band "RADAR · NEXT 3 H"/"FORECAST · MODEL" above the bars replacing the floating "model →" tag — model-only fallback timelines draw the whole band as FORECAST — and a static N/E/S/W compass rose on the map.)
- **2026-07 · v2.5.0 · Trace-ahead foresight (`traceAheadMin`, `TRACE_RUN_SLOTS 2`) — wording + ribbon only.** Same-day follow-up to v2.4.1: the INCA nowcast showed the drizzle field CONTINUING as 0.01mm slots an hour ahead (the exact signal wetter.com painted as "leicht until 13:00"), but everything below DRY_THRESHOLD rendered as "nothing coming" — dryEndsOpen claimed "clear for hours" over visible foresight. New pure fn: minutes until the first RUN of ≥ TRACE_RUN_SLOTS (2) consecutive trace slots (0 < p < 0.1) within LOOK_AHEAD (3h), else null — a single 0.01 blip can't paint drizzle. New GO tier `s_trace_ahead[_far]` / `n_trace_ahead[_far]`: fires only when `dryEndsOpen && !night`; priority = below downpour/RV-approach/trace-NOW/RV-nearby (observed echo beats a trace forecast), ABOVE the model second-opinion (radar trace beats model guess); real ≥0.1 countdowns (`nextRainAt`) untouched. Ribbon: trace slots draw as 10px translucent stubs (alpha 0.45 radar zone / 0.25 model zone), new "drizzle possible" legend swatch, and an all-trace ribbon labels `ribbon_trace_only` instead of "no rain in 3h". NEVER changes state/effectivePrecip — surfaceDrizzle (v2.4.1 bar) still owns the GO ANYWAY flip. Verified against the live feed: still-dry points got ~13/~28 min drizzle countdowns.
- **2026-07 · v2.4.1 · Drizzle-miss fix: RainViewer self-corroboration by spatial extent (`rvSolid`, `RV_SOLID_COVERAGE 0.4`).** Live incident (2026-07-17): real drizzle over the whole city while gauge = 0.0 (accumulates too slowly per interval), INCA current slot = exact 0.0 (issued ~1 h behind the fresh field — its first 0.01 traces sat at +53 min), model flat 0.00 for 12 h, code 3 (overcast). RainViewer was the ONLY witness (echo blooming over the centre block, 24/25 wet px, grown 0→4→24 across the last three frames) and the v2.2.1 guard vetoed it for lack of a nowcast trace → the app said "totally dry" during real drizzle. Fix: `sampleRvFrameBlocks` now returns wet-pixel COUNTS (0–25 per 5×5 block ≈ 6×6 km) instead of binary; `fetchRainViewerPrecip` derives `rvSolid = centre coverage ≥ RV_SOLID_COVERAGE (0.4)` and `surfaceDrizzle` accepts it as an alternative corroboration: a drizzle FIELD blankets the block, a stuck clutter pixel lights 1–3 px. Guards preserved: clear sky (code ≤ 2) remains an ABSOLUTE veto on RV-only claims (broad sunny anaprop exists); a non-solid RV echo with a flat-zero radar stays suppressed (v2.2.1 replay pinned in tests); surfaced value stays capped to the light band (never WAIT/STUCK). Approach-frame arrival check unchanged in behaviour (any wet px = arrival, as before). Asymmetry honoured: this loosens toward warning — *users forgive leads, not lags*.
- **2026-07 · v2.4.0 · Approach tracker: ring watch + area watch (adds tiers, changes no existing verdicts).** (1) `ringDirection(wetDirs)` (gaps.js, pure): the RV pixel sampler reads an 8-point compass ring ~15 km out off the SAME tile (zero extra network); vector-summed dominant sector, opposite sectors cancel to null. Feeds `trend.rvApproachDir` (direction on the existing approach ETA → `s_rv_approach_dir`) and `trend.rvNearbyDir` (echo in a coherent sector, no ETA → new "nearby, watching" tier `s_rv_nearby`; outranks the forecast hint, yields to trace-at-pixel and any ETA, suppressed at night). (2) Backend `_area_watch(prev_count, wet_now, coords)`: wet-vs-dry centroid bearing (cos-corrected) + wet-count trend when the 11-point grid is PARTIALLY wet → `area_watch {sector,count,trend,ts}` on `/api/ambient` → muted city-scale banner ("rain over the west of Salzburg — spreading"), fresh ≤10 min, hidden during the forming alert. Directions are translated via `dir_*` keys. CHANGELOG switched to "Gemma Raus just got better" release-note style.
- **2026-07 · v2.3.0 · Trace-echo acknowledgment (`hasTraceEcho`) — wording only.** `DRY_THRESHOLD` (0.1mm/15min) is a reporting cutoff, not a physical one — live incident showed real, widespread 0.01–0.06mm echo (below the cutoff, radar's own 3h timeline fully "dry") while it was genuinely (lightly) drizzling; the app said "clear for hours"/"rain in ~2½h" with no acknowledgment. When `dryEndsOpen && hasTraceEcho(rawNowSlot)`, the GO sub now says "light drizzle on radar right now" combined with the model's far-rain time when available. **Wording only** — does not flip GEMMA RAUS→GO ANYWAY (that's `surfaceDrizzle`'s stricter corroborated bar, v2.2.1) and never touches WAIT/STUCK; downpour warning and RV-approach still outrank it; night keeps the cosy drizzle voice. Policy: *better to nudge caution than stay silent about a signal we already have.*
- **2026-07 · v2.2.1 · Overcast-clutter fix — `surfaceDrizzle` now requires radar corroboration, not just "not clear sky".** Live incident: gauge 0.0, radar an exact flat 0.0 across the whole 3h window, overcast (code 3) — GO ANYWAY fired anyway on a raw RV-only echo, and it genuinely wasn't raining. The v1.1.5 clear-sky guard only blocked *clear* skies; overcast was treated as automatic corroboration, but overcast doesn't rule out terrain clutter (Untersberg/Gaisberg reflections) or tile noise. New rule: an RV-only claim (nowcastEcho false) also requires `rawNowSlot > 0` (any non-zero trace) — a flat exact zero is now active disagreement, sky or no sky; "sky unknown" (code null) no longer defaults to allowed. The original hyperlocal-drizzle catch is unaffected (it already had a non-zero near-threshold radar trace, which is corroboration under the new rule too).
- **2026-07 · v2.2.0 · Ribbon extended to 12h + mobile auto-scroll (UI, no verdict change).** `App.jsx` appends the model's own 12h timeline (`omTimes/omPrecips`, already fetched) onto the ribbon after the radar's ~3h horizon, tagged via `forecast.radarUntil`. `RainRibbon.jsx` renders the radar zone as solid bars (unchanged) and the model-only zone as dashed outlined bars (same visual language as the v2.1 ghost bars) with a divider + "model →" tag at the handoff. Added a self-gating auto-scroll (drift forward → pause → fast rewind → repeat) for mobile, that no-ops when content fits the screen, respects `prefers-reduced-motion`, and pauses on any user touch/scroll/wheel. Zero new API calls; MAX_SLOTS 13→49.
- **2026-07 · v2.1.0 · Model in the gaps: ghost bars + STUCK second-opinion (`modelEaseAt`).** (1) Ribbon draws model-only rain (radar dry, model wet) as dashed OUTLINED bars + "model (expected)" legend — radar precision stays solid, model expectation stays visibly distinct. (2) STUCK's "no break in sight" is now cross-checked: if the model's timeline shows the rain ending within 3 h (`modelEaseAt` — requires ≥1 wet model slot first, so a whole-window-dry model can't fake an ease), the sub reads "no break on radar — model expects easing in ~X" (min <90 / hours ≥90; notice too). Wording only, state stays STUCK; thunder wording outranks. Completes the *never-claim-what-a-source-contradicts* law on the STUCK side.
- **2026-07 · v2.0.1 · Trailing-edge lag guard (`modelNowValue`, `MODEL_NOW_CAP 0.4`).** Open-Meteo `current.precipitation` is a preceding-HOUR value; after rain ends it stays high ~an hour and was out-shouting a reporting gauge (`max(model 0.7, gauge 0.0)` → bogus "WAIT 50 MIN" in the sun). A reporting gauge now owns the NOW magnitude: the model current is capped at the light band (0.4) — may whisper "gauge-missed drizzle", can never manufacture WAIT/STUCK. 0.10-rounding guard preserved; no gauge → model passes through (radar-max path).
- **2026-07 · v2.0.0 · Full-frame RainViewer approach with real ETA (`rvApproachMin`).** The approach guard samples ALL RainViewer forecast frames (10-min steps) and reports the FIRST arrival: `trend.rvApproachMin` (minutes) replaces the boolean `rvApproaching`; `s_rv_approach`/`n_rv_approach` interpolate `{min}`. Fixes two v1.4.0 gaps: an early cell (+10) passing before the +30 frame was invisible, and the wording could only say a generic "~30 min". Same precedence (downpour > RV approach > model second-opinion; nearer GeoSphere countdown wins).
- **2026-07 · v1.4.0 · Missed-evening-rain fix: model second-opinion + RainViewer approach guard.** Root cause of the reputation-day miss: the NEXT lane was radar-only, and radar extrapolation is structurally blind to rain that hasn't formed as echo — **for frontal/stratiform onset the model LEADS the radar** (mirror of convection, where radar leads; we'd over-fit to that). Latency reality: GeoSphere nowcast issues **15–25 min behind** real time; RainViewer frames ~5 min. Two guards, radar still leads when it sees rain: (1) `modelNextRainAt` — radar all-clear + model timeline wet → "radar clear so far — model expects rain in ~X" (sub + notice + ribbon dry-label); (2) `rvApproaching` — RainViewer's forecast frame (~+20–30 min, observed motion) shows echo arriving at the pixel while GeoSphere is silent → "rain approaching on radar (~30 min)"; moving echo can't be static clutter, no sky guard needed. Precedence: downpour > RV approach > model second-opinion > radar countdowns; a nearer GeoSphere countdown beats the approach guard. **Design law: never claim a confident all-clear that any of our own sources contradicts.**
- **2026-07 · v1.3.0 · Convective watch (banners + push only — verdict untouched).** Layer 1 `isUnsettled(cape, maxProb, hour)` (gaps.js: CAPE ≥ 300 AND max 4-h prob ≥ 50 AND 11–20 h) → muted "unsettled air, windows may be short" banner; suppressed under the ≥1500 storm banner. Layer 2 `_detect_forming` (backend): ≥3 grid points flipping dry→wet in one 5-min cycle + CAPE ≥ 300 = **radar-confirmed initiation** → `forming_ts` on `/api/ambient` → 30-min alert banner + once-per-day "forming" push (top of story order; single-event verified like "raining", no extra vote). Design rule: **CAPE alone flags potential, only observed echo confirms formation** — neither layer changes GO/LIGHT/WAIT/STUCK.
- **2026-07 · v1.2.1 · Gap-confidence softener (`GAP_FIRM_MIN 60`, `s_break_likely` / `s_clearing_far` / `n_break_likely`).** A break predicted ≥60 min out reads "break **likely** in ~X min"; under an hour stays firm. **Time-based, not probability-based, on purpose:** hourly model probability stays high through a whole rainy spell, so a prob-based softener would mark every intra-rain gap "likely" (over-softening); the 60-min line matches verified skill decay (POD ~50% at 60–90 min). Wording only — the countdown is always kept. Symmetric with the v1.2.0 far-rain rule.
- **2026-07 · v1.2.0 · Far-rain countdown (`FAR_RAIN_MIN 90`, `s_rain_far[_maybe]`, `hoursLabel`).** Rain ≥90 min out now always gets an explicit hours countdown ("rain in about 3 h") in the GO sub AND the popup notice; low confidence softens the wording but **keeps the time** (was: timeless "rain possible later" while the ribbon showed the band — undersold the dry window). Rounded to the nearest ½ h. *The dry window is the product.*
- **2026-07 · v1.1.5 · Clear-sky clutter guard on drizzle surfacing (`gaps.surfaceDrizzle`).** A raw-RainViewer-only echo can no longer surface GO ANYWAY when the model reports a clear sky (code ≤ 2) — raw radar tiles show ground clutter (mountain reflections/insects/anaprop) on sunny days, and one binary pixel must not overrule gauge + model-sky + filtered nowcast all reading dry ("sunny but PASST SCHON" report, Nonntal). Echo in the *filtered* nowcast still surfaces under any sky; RV under overcast/unknown sky still surfaces (the original gauge-blind drizzle case is preserved). Surfacing is now a pure exported function with 7 contract tests.
- **2026-07 · v1.1.4 · CRITICAL regression fix: heavy radar echo bypasses the virga filter.** The v1.1 cap rewrite applied `min(r, 0.4)` to ALL low-probability echo — including a real 2–3 mm convective downpour. ICON-EU lags convection, so probability is <50% exactly when a pop-up cell is real → the served nowcast showed "light drizzle" during a downpour, the ≥1.5 downpour warning could never fire, and the verdict said GO ANYWAY into a soaking (user got caught; backend push analysis, which reads the RAW timeline, correctly fired `rain_incoming` at the same moment — the divergence was the tell). Now echo ≥ `VIRGA_HEAVY_PASS` (1.5 mm) always passes unfiltered: virga is light by nature, heavy radar echo is self-evidencing. **Lesson: never let the (lagging) model veto heavy radar.**

- **2026-07 · v1.1 · Surface a light drizzle the gauge misses (caution policy).** When a gauge reads dry but the radar / RainViewer see a **light** echo (0.1–0.5 mm), `effectivePrecip` is bumped into the light band → **GO ANYWAY** (was GEMMA RAUS). Only light echo surfaces; it's **capped so it can never become a false STUCK**, and `drizzleSurfaced` feeds `rvRainActive` so `gapNow` can't override it back to GO. A genuine heavier cell still keeps the ground's dry call. Rationale: *better to keep someone in than send them into rain* — accepts an occasional "light drizzle" on a truly-dry virga day. Paired change: the **virga filter now caps (0.4 mm) instead of zeroing**, so the ribbon shows the drizzle instead of a false "no rain in 3 h" and a low-confidence heavy echo still can't paint a storm.
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
| RED warning override | `--c-danger` | `#EF4444` | `#991B1B` |

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

`cape` is the MAX across all 11 ambient grid points (`ambientMaxCape()`), not the single GPS-nearest one — see v2.15.0 below for why.

When this banner AND `formingActive` (radar-confirmed initiation) are both true at once, the main headline itself escalates to BLEIB DRIN — see v2.16.0 below.

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

**To check if deployment is live:** Look for the Railway deployment URL in project settings. NB: the bundle hash in `index.html` can contain a `-` (e.g. `index-Bpehv-4X.js`) — when scripting a deploy check, match `index-[A-Za-z0-9_-]+\.js`, not `[A-Za-z0-9_]+`.

---

## Versioning & rollback

**Live since going public (2026-07): the app is versioned so we can always roll back to a known-good state.**

- **Source of truth:** `frontend/package.json` → `version` (SemVer `MAJOR.MINOR.PATCH`). Vite bakes it in as `__APP_VERSION__`; it's shown in the info panel (`Gemma Raus vX.Y.Z`) so we always know what's live.
- **`__BUILD_ID__` vs `__APP_VERSION__`:** `BUILD_ID` is a per-deploy timestamp (from the Dockerfile) used only to bust the service-worker cache — it changes every deploy. `APP_VERSION` is the human release we tag and roll back to. Don't conflate them.
- **When to bump (SemVer):** PATCH = bug fix / copy / UI, no logic change · MINOR = new feature or a **rain-logic behavioural change** (also add a Logic change log entry) · MAJOR = breaking / re-architecture.
- **`CHANGELOG.md`** records every release; **CLAUDE.md → Logic change log** records every change that alters the verdict.

### Cutting a release
```bash
# 1. bump frontend/package.json "version"  →  e.g. 1.1.0
# 2. add a CHANGELOG.md entry (and a Logic change log entry if logic changed)
git add -A && git commit -m "Release v1.1.0: <summary>"
git tag -a v1.1.0 -m "v1.1.0"
git push origin main --tags        # Railway auto-deploys main
```

### Rolling back a bad deploy (fastest → cleanest)
1. **Railway instant rollback (fastest):** Railway dashboard → the service → Deployments → pick the last good deployment → **Redeploy / Rollback**. No git change; buys time while you investigate.
2. **Redeploy a known-good tag:** `git checkout v1.0.0 -- .` on a branch, or reset `main` to the tag and force-push *(only if you own the risk)*; Railway rebuilds it.
3. **Revert the offending commits (cleanest history):** `git revert <sha>...` → push `main` → auto-deploys the reverted state. Then bump a PATCH and tag it.

**Rule of thumb:** on a production failure, hit **Railway rollback first** (seconds), then fix forward with a `git revert` + PATCH release. Never leave `main` in a state you can't identify by tag.

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

## Operations handbook (READ FIRST when working from the maintainer's machine)

Project skills in `.claude/skills/` encode the four recurring procedures — prefer them over re-deriving:
`release` (test → bump → changelog voice → tag → push), `verify-deploy` (sw.js stamp method),
`probe-weather` (safe live-data cross-checks), `logic-change` (mandatory checklist for verdict changes).

### Standing maintainer doctrine (governs every decision)
1. **Leads forgiven, lags never** — early warnings acceptable, late ones are product failures. Any suppression must prove it cannot delay a warning (dual-key template: v2.8.0).
2. **Better someone stays inside than gets sent into rain.**
3. **Only change logic when absolutely better** — decline marginal tweaks; probe live data first. Two proposed threshold bumps (2026-07) were withdrawn when reality validated current behaviour within the hour.
4. **Test extensively**: both suites before AND after; contract tests pin every release scenario.
5. **CHANGELOG voice**: "Gemma Raus just got better: …" — warm second-person prose (see 2.8.0/2.9.0 as templates). Logic log = doctrine record; changelog = user story.
6. The maintainer reports by **voice transcript** — expect phonetic mangling ("Vector dot com" = wetter.com, "Frye Lassing" = Freilassing, "rain ruben" = rain ribbon).

### API quota — HARD RULE
Never call `api.open-meteo.com` or `dataset.api.hub.geosphere.at` from the dev machine — it shares the user's IP; probing burns their per-IP quota and once bricked the live app on "checking". Safe to poll: own `https://www.gemmaraus.at/api/*` (ambient carries per-point nowcast/arome/ground), RainViewer CDN (unmetered), `aviationweather.gov` METAR (LOWS), `api.github.com`.

### Deploy verification — sw.js stamp only
After `git push origin main`, wait ~2–3 min, fetch `https://www.gemmaraus.at/sw.js` and read the cache name `gemma-raus-YYYYMMDDHHMM` (UTC build time, stamped by the Dockerfile). To confirm specific code, grep the referenced `assets/index-*.js` for a new distinctive string. **Never** compare live bundle hashes to a local build (Railway bakes different VITE_* → never match) and **never** wait for a post-push baseline hash to change (Railway is faster than you — the baseline is already the new bundle).

### Dev-machine quirks
- PowerShell **5.1**: no `&&`, no `??`/`?.`; multiline commit messages via file + `git commit -F`; avoid `2>$null` on native exes.
- Machine TZ is **IST (UTC+5:30)**, Salzburg is CEST (UTC+2 summer) — convert unix timestamps explicitly, never trust local wall-clock.
- Backend tests: `python backend/test_logic.py` (**no pytest module**). No `gh` / `railway` CLIs — GitHub via anonymous `api.github.com`.
- `RAIN_LOGIC.md` and `docs/` exports are **local-only by choice** — unstage them if `git add -A` sweeps them in.

### UI layout contracts (v2.9.0 — don't regress these on "cleanup")
- App shell is fixed-height (`h-full`/`100dvh` + overflow-hidden); the **main column scrolls** (`flex-1 min-h-0 overflow-y-auto overscroll-contain`) so stacked banners can never lock the page; RadarMap keeps `min-h-[320px]`.
- RainRibbon auto-scroll keeps its position in a **float accumulator** and only writes `el.scrollLeft` — iOS Safari rounds scrollLeft reads to whole px, so any read-add-write drift under 1 px/frame freezes there. rAF `dt` stays clamped (≤100 ms) against background-resume jumps. The `prefers-reduced-motion` no-op is intentional (iOS Reduce Motion disables auto-drift by design).
- Bottom sheets use `.max-h-sheet` (92dvh under `@supports`) + `overscroll-contain`; `AbortSignal.timeout` polyfill in api.js is load-bearing for iOS ≤ 15.

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
