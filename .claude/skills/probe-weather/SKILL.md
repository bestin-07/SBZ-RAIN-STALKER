---
name: probe-weather
description: Safely probe live weather data to cross-check what the app is showing (phantom drizzle, countdowns, radar vs model) WITHOUT burning the metered API quota. Use whenever the user asks "is this real?" about anything the app displays.
---

# Probing live weather safely

## HARD RULE — forbidden endpoints from this machine

NEVER call `api.open-meteo.com` or `dataset.api.hub.geosphere.at` directly.
This machine shares the user's IP; probing burns their per-IP quota and has
previously bricked the live app on "checking" for a day. There is no exception
for "just one call".

## Safe endpoints

| Source | URL | Gives you |
|---|---|---|
| Own API (cached, shared) | `https://www.gemmaraus.at/api/ambient` | per-point INCA `nowcast` {times,precips}, `arome`, `ground` (TAWES), weather fields for all 11 city grid points |
| RainViewer (unmetered CDN) | `https://api.rainviewer.com/public/weather-maps.json` → `{host}{frame.path}/256/{z}/{x}/{y}/2/0_0.png` | actual radar frames, past ~40 min + ~30 min nowcast |
| METAR ground truth | `https://aviationweather.gov/api/data/metar?ids=LOWS` | airport observation (NCD = no cloud detected, RA/DZ = rain/drizzle) |

## Timezone trap

The machine runs IST (UTC+5:30). Salzburg is CEST (UTC+2, summer). Convert unix
timestamps as `[DateTimeOffset]::FromUnixTimeSeconds($t).UtcDateTime.AddHours(2)`
and label output CEST. Never use local Get-Date for Salzburg wall-clock.

## RainViewer tile math (Salzburg ≈ 47.80 N, 13.05 E)

- z8 tile (137, 89) ≈ 110 km; z6 tile (34, 22) ≈ 430 km (covers the approach region).
- Pixel in z6/(34,22): col ≈ 82, row ≈ 77 for Salzburg centre.
- **Empty-tile trick:** RainViewer serves byte-identical shared PNGs for empty
  tiles — md5-compare a suspect tile against a known-empty ocean tile to prove
  "zero echo", don't eyeball alpha.
- **Motion/centroid:** decode a tile with System.Drawing, count pixels with
  alpha > 30, compute the wet-pixel centroid across 3–4 past frames → position,
  growth, and drift vector of an approaching band (≈ arrival ETA at ~observed
  speed). This independently cross-checks INCA onset times.

## Phantom-vs-real drizzle checklist (the v2.8.0 method)

1. **Uniformity test** (from `/api/ambient`): identical trace values/onset minute
   across ALL 11 points = model-blend noise; spatial gradient = plausibly real.
2. **RainViewer emptiness** over a wide area (empty-tile md5) = no echo exists.
3. **METAR LOWS** for sky/precip ground truth (manual cross-check only — never app logic).
4. Sky code ≤ 2 at every point + all of the above quiet → phantom (the
   `tracePhantom` guard should already be suppressing it; if not, that's the bug).

## Known display "artifacts" that are NOT bugs

- Same countdown at every point (e.g. "~80 min" / "~2 h everywhere"): INCA speaks
  in 15-min slots and wording rounds (5-min steps <90 min; ½-h steps ≥90 min).
  A single band crossing a 10 km city lands on 1–2 slot boundaries. By design.
- Heavy radar bars stepping down to light model bars at the 3 h mark: the ribbon
  hands over from INCA radar (first 3 h, solid bars) to the model union
  (dashed bars, "FORECAST · MODEL"). Models lag Alpine convection 2–3 h — trust
  the radar side inside its window.
- "Drizzle shown but I'm dry": radar sees precipitation aloft minutes before it
  reaches ground — a lead, not a false alarm. Wait 15–30 min before touching
  thresholds; on 2026-07-18 the drizzle arrived on schedule and the proposed
  threshold bump was withdrawn.
