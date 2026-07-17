export const DRY_THRESHOLD = 0.1
const MIN_GAP_SLOTS = 2
const LOOK_AHEAD = 3 * 3600

// Imminent-downpour warning thresholds (used by firstDownpourMin below; surfaced by
// getStatus as the top-priority s_downpour_soon sub in the GO / light states).
export const DOWNPOUR_MM = 1.5           // mm/15-min slot — clearly heavier than the 0.5 light band
export const DOWNPOUR_WINDOW_MIN = 30    // only warn about downpours arriving within this window

// Drizzle surfacing (v1.1) with the clear-sky clutter guard (v1.1.5).
// When the gauge reads dry but radar sees LIGHT echo at the user's spot, surface it
// as GO ANYWAY ("a jacket beats a soaking") — EXCEPT when the only witness is the raw
// RainViewer pixel under a clear sky. Raw radar tiles show ground clutter (Untersberg/
// Gaisberg reflections, insects, anaprop) on sunny days; the GeoSphere nowcast is
// clutter-filtered, RainViewer tiles are not. One binary pixel must not overrule
// gauge + model-sky + filtered nowcast all reading dry ("sunny but PASST SCHON" bug).
// Returns the surfaced precip (≥ LIGHT_MIN) or null (keep the ground's dry call).
// v2.4.1: fraction of the 5×5 RainViewer block (~6×6 km) that must show echo for
// RainViewer to corroborate ITSELF by spatial extent. Clutter (a stuck terrain pixel)
// lights 1–3 px; a real drizzle field blankets the block (live incident 2026-07-17:
// 24/25 px while gauge, INCA slot and model all read exact zero).
export const RV_SOLID_COVERAGE = 0.4

export function surfaceDrizzle(groundPrecip, rawNowSlot, rvPrecip, code, rvSolid = false) {
  if (groundPrecip >= DRY_THRESHOLD) return null       // gauge already wet — not our case
  const drizzle = Math.max(rawNowSlot ?? 0, rvPrecip ?? 0)
  if (drizzle < DRY_THRESHOLD || drizzle >= LIGHT_MAX) return null  // nothing, or a heavier
                                                       // cell → the ground's dry call stands
  const nowcastEcho = (rawNowSlot ?? 0) >= DRY_THRESHOLD   // clutter-filtered source agrees
  const clearSky     = code != null && code <= 2            // model says sunny / mostly clear
  // v2.2.1: a RV-only claim (nowcastEcho false) needs SOME independent corroboration —
  // any non-zero radar trace, however small. Overcast sky alone is NOT enough: real
  // incident (Nonntal, overcast/code 3) showed a flat, exact-zero radar reading across
  // the whole 3h window while a single raw RainViewer pixel claimed echo — that's
  // terrain clutter (Untersberg/Gaisberg) or tile noise, not weather, regardless of
  // cloud cover. "Sky unknown" (code null) no longer gets a free pass either; zero
  // corroboration from anywhere is the same evidence whether or not we know the sky.
  //
  // v2.4.1: …but that guard caused the mirror-image miss (drizzle 2026-07-17): fresh
  // stratus drizzle is invisible to the gauge (<0.1mm/interval), lagged out of the
  // INCA slot, absent from the model — RainViewer was the ONLY witness and we vetoed
  // it. A lone clutter pixel and a drizzle FIELD look nothing alike on the tile, so
  // wide coverage (rvSolid, ≥ RV_SOLID_COVERAGE of the block) now counts as
  // corroboration too. Clear sky remains an absolute veto: sunny-day clutter/anaprop
  // can also be broad, and the v1.1.5 "sunny but PASST SCHON" bug must stay dead.
  const anyRadarTrace = (rawNowSlot ?? 0) > 0
  if (!nowcastEcho && (clearSky || (!anyRadarTrace && !rvSolid))) return null
  return Math.max(drizzle, LIGHT_MIN)
}

// Convective-watch "Layer 1" (v1.3.0): the UNSETTLED regime flag. CAPE says the air
// has fuel; rising model probability says the trigger is plausible; afternoon hours
// are when Alpine convection fires. All three → a muted banner ("showers can form
// fast today, windows may be short") that sets expectations WITHOUT touching the
// verdict. Evidence: soaking day CAPE 200–570 + prob 40–78% vs sunny-clutter day
// CAPE 90–330 + prob 3–53% — CAPE alone doesn't separate them, CAPE+prob does.
// (Layer 2, radar-CONFIRMED initiation, lives in the backend: forming_ts.)
export const UNSETTLED_CAPE = 300   // J/kg
export const UNSETTLED_PROB = 50    // % — max hourly probability over the next ~4 h
export function isUnsettled(cape, maxProb, hour) {
  return cape != null && maxProb != null &&
    cape >= UNSETTLED_CAPE && maxProb >= UNSETTLED_PROB &&
    hour >= 11 && hour < 20
}

// Model-current contribution to the NOW blend (v2.0.1). Open-Meteo's
// current.precipitation is a PRECEDING-HOUR value — after rain ends it stays high for
// up to an hour, and it was out-shouting a reporting gauge (gauge 0.0, model 0.7 →
// max = 0.7 → a bogus "WAIT 50 MIN" on the trailing edge, in the sun). Doctrine:
// a REPORTING gauge owns the NOW magnitude; the hour-lagged model may lift it at most
// into the LIGHT band (cap 0.4 — same philosophy as the virga cap): it can whisper
// "drizzle the gauge missed", it can never manufacture WAIT/STUCK alone. With no
// gauge at all, the model passes through (the radar-max path handles that case).
export const MODEL_NOW_CAP = 0.4
export function modelNowValue(measured, stationPresent, stationPrecip) {
  if (!stationPresent) return measured
  // 0.10-rounding guard (unchanged): a 0-reading gauge needs the model to be
  // STRICTLY above 0.1 before it may claim any wetness at all.
  if (stationPrecip === 0 && measured <= 0.1) return 0
  return Math.min(measured, MODEL_NOW_CAP)
}

// Model second-opinion (v1.4.0). The radar nowcast EXTRAPOLATES existing echo — it is
// structurally blind to rain that hasn't formed yet. For frontal/stratiform onset the
// MODEL leads the radar by hours (the exact mirror of convection, where radar leads a
// lagging model — we'd over-fit to that first lesson and discarded the model whenever
// the radar answered; result: "dry all evening" while every model-based weather app
// showed the incoming rain, and it rained). When the radar sees NOTHING in 3 h, this
// returns the model's own first wet slot so the verdict can say "radar clear so far —
// model expects rain in ~X" instead of a confident all-clear. Radar still wins when it
// sees rain (it's more precise); the model is the safety net, never the override.
export function modelNextRainAt(omTimes, omPrecips, nowSec) {
  if (!omTimes?.length || !omPrecips?.length) return null
  const lim = nowSec + 3 * 3600
  for (let i = 0; i < omTimes.length; i++) {
    const tt = omTimes[i], p = omPrecips[i] ?? 0
    if (tt >= nowSec && tt <= lim && p >= DRY_THRESHOLD) return tt
  }
  return null
}

// Model ease second-opinion (v2.1.0) — the STUCK-side mirror of modelNextRainAt.
// When the radar sees no break in 3 h (STUCK) but the model's own timeline shows the
// rain ENDING, say so: "no break on radar — model expects easing in ~2 h". Returns the
// start of the model's final dry stretch within 3 h, or null. Requires the model to
// actually SHOW the rain first (≥1 wet slot before the ease point) — a model that's
// dry the whole window is contradicting the present, not forecasting the end.
export function modelEaseAt(omTimes, omPrecips, nowSec) {
  if (!omTimes?.length || !omPrecips?.length) return null
  const lim = nowSec + 3 * 3600
  let wetSeen = false, ease = null
  for (let i = 0; i < omTimes.length; i++) {
    const tt = omTimes[i]
    if (tt < nowSec || tt > lim) continue
    const p = omPrecips[i] ?? 0
    if (p >= DRY_THRESHOLD) { wetSeen = true; ease = null }
    else if (wetSeen && ease === null) ease = tt
  }
  return wetSeen ? ease : null
}

// Approach direction from the RainViewer ring watch (v2.4.0). Given the list of
// compass sectors (~15 km out) currently showing echo while the user's own pixel is
// dry, return the dominant direction the rain sits in — vector-summed so adjacent wet
// sectors resolve to their middle, and OPPOSITE sectors cancel to null (echo on both
// sides isn't an approach direction, it's scattered cells). Pure + contract-tested.
const SECTOR_ANGLES = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 }
const SECTOR_ORDER = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
export function ringDirection(wetDirs) {
  if (!wetDirs?.length) return null
  let x = 0, y = 0
  for (const d of wetDirs) {
    const a = SECTOR_ANGLES[d]
    if (a == null) continue
    x += Math.sin(a * Math.PI / 180)
    y += Math.cos(a * Math.PI / 180)
  }
  if (Math.hypot(x, y) < 0.5) return null      // cancelled out → no coherent direction
  const ang = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360
  return SECTOR_ORDER[Math.round(ang / 45) % 8]
}

// Trace-echo acknowledgment (v2.3.0). DRY_THRESHOLD (0.1mm/15min) is a REPORTING
// cutoff, not a physical one — real, patchy light drizzle can sit just below it
// (e.g. 0.01–0.06mm, widespread across several grid points) while genuinely wetting
// someone outside. Policy: better to nudge caution than stay silent about a signal we
// already have. `rawNowSlot` is the un-zeroed current radar slot (the same value the
// ground-dry rule zeroes out before gap detection, precisely so it doesn't hide the
// real NEXT rain) — reusing it here to ACKNOWLEDGE it in wording only. Never changes
// isDry / effectivePrecip / WAIT / STUCK; GEMMA RAUS stays GEMMA RAUS, just says so
// honestly instead of implying total dryness until the next real countdown.
export function hasTraceEcho(rawNowSlot) {
  return (rawNowSlot ?? 0) > 0 && (rawNowSlot ?? 0) < DRY_THRESHOLD
}

// v2.5.0: FUTURE trace drizzle — minutes until sub-threshold echo STARTS on the
// radar's own timeline, or null. Live incident (2026-07-17): the INCA nowcast showed
// the drizzle field arriving as 0.01mm slots an hour ahead, but everything below
// DRY_THRESHOLD rendered as "nothing coming" — the app claimed a clear 3h while
// wetter.com-class apps painted "light until 13:00" from the SAME signal. Requires a
// RUN of ≥ TRACE_RUN_SLOTS consecutive trace slots so a single 0.01 noise blip can't
// paint drizzle on a genuinely dry day. Wording + ribbon only — a trace future never
// creates a countdown-to-WAIT, never flips any state.
export const TRACE_RUN_SLOTS = 2
export function traceAheadMin(times, precips, nowSec) {
  if (!times?.length) return null
  const isTrace = p => p > 0 && p < DRY_THRESHOLD
  const slots = times
    .map((tt, i) => ({ t: tt, p: precips?.[i] ?? 0 }))
    .filter(s => s.t >= nowSec - 300 && s.t <= nowSec + LOOK_AHEAD)
  for (let i = 0; i < slots.length; i++) {
    if (!isTrace(slots[i].p)) continue
    let run = 1
    while (i + run < slots.length && isTrace(slots[i + run].p)) run++
    if (run >= TRACE_RUN_SLOTS) return Math.max(0, Math.round((slots[i].t - nowSec) / 60))
    i += run   // too-short blip — skip past it
  }
  return null
}

// Minutes to the first real DOWNPOUR (≥ DOWNPOUR_MM) the radar shows within
// DOWNPOUR_WINDOW_MIN, or null. Shared by loadData + computeStatusAt so your live
// verdict and the town dots warn identically. Runs on the (virga-filtered) nowcast,
// so it fires only on genuine heavy rain — never on light echo the model rejects.
export function firstDownpourMin(nowcast, nowSec) {
  if (!nowcast) return null
  const lim = nowSec + DOWNPOUR_WINDOW_MIN * 60
  for (let i = 0; i < nowcast.times.length; i++) {
    const tt = nowcast.times[i], p = nowcast.precips[i] ?? 0
    if (tt >= nowSec && tt <= lim && p >= DOWNPOUR_MM) return Math.max(0, Math.round((tt - nowSec) / 60))
  }
  return null
}

export function detectGaps(times, precips) {
  const now = Math.floor(Date.now() / 1000)
  const cutoff = now + LOOK_AHEAD

  // Include up to one 15-min slot in the past so we can always identify the
  // "current" slot (the 15-min slot we're currently inside).
  const allSlots = times
    .map((t, i) => ({ t, p: precips[i] ?? 99 }))
    .filter(s => s.t >= now - 15 * 60 && s.t <= cutoff)

  if (!allSlots.length) return { currentPrecip: null, gaps: [] }

  // Slot closest to now = the interval we're actually inside right now
  const nowSlot = allSlots.reduce((best, s) =>
    Math.abs(s.t - now) < Math.abs(best.t - now) ? s : best
  )
  const currentPrecip = nowSlot.p

  // Gap detection only on slots from nowSlot forward
  const slots = allSlots.filter(s => s.t >= nowSlot.t)

  const gaps = []
  let gapStart = null
  let gapCount = 0

  for (const slot of slots) {
    const dry = slot.p < DRY_THRESHOLD
    if (dry && gapStart === null) {
      gapStart = slot
      gapCount = 1
    } else if (dry && gapStart !== null) {
      gapCount++
    } else if (!dry && gapStart !== null) {
      if (gapCount >= MIN_GAP_SLOTS) {
        gaps.push({
          startsAt: gapStart.t,
          startsInMinutes: Math.max(0, Math.round((gapStart.t - now) / 60)),
          durationMinutes: gapCount * 15,
          opensEnded: false,
        })
      }
      gapStart = null
      gapCount = 0
    }
  }

  if (gapStart !== null && gapCount >= MIN_GAP_SLOTS) {
    gaps.push({
      startsAt: gapStart.t,
      startsInMinutes: Math.max(0, Math.round((gapStart.t - now) / 60)),
      durationMinutes: gapCount * 15,
      opensEnded: true,
    })
  }

  // Trend for the narrative: if it's dry right now, when does rain arrive?
  // (Independent of MIN_GAP_SLOTS, so the "rain in X / window closing" countdown
  // works even for short dry spells we wouldn't call a full gap.)
  let nextRainAt = null
  let dryEndsOpen = false
  if (currentPrecip < DRY_THRESHOLD) {
    const firstWet = slots.find(s => s.p >= DRY_THRESHOLD)
    if (firstWet) nextRainAt = firstWet.t
    else dryEndsOpen = true   // dry for the whole 3 h window ahead
  }

  return { currentPrecip, gaps, nextRainAt, dryEndsOpen }
}

function getWeatherNote(weather, t, { night = false, evening = false, raining = false, rainSoon = false } = {}) {
  if (!weather || weather.temp === null || weather.temp === undefined) return null
  const temp = Math.round(weather.temp)
  const wind = Math.round(weather.wind ?? 0)
  const code = weather.code ?? -1
  const v = { temp, wind }

  // Safety/hazard notes are always shown regardless of time
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    // Snow at night: suppress the "go anyway" encouragement — just skip
    if (night) return null
    return t('weather_snow', v)
  }
  if (code >= 95 && code <= 99) return t('weather_thunder', v)
  // "storm — stay inside" only when we're not saying GO. On a dry, windy day the
  // wind banner already warns; the note falls through to the playful "hold your
  // hat" (weather_windy) so it doesn't contradict the GO headline.
  if (wind > 50 && raining)     return t('weather_storm', v)
  if (code === 45 || code === 48) return t('weather_fog', v)

  // Comfort / "go outside" notes make no sense while it's actively raining — they
  // contradicted the status (e.g. "perfect, no excuse to stay in" showing under a
  // STUCK "wet all the way"). Hazard notes above still surface during rain.
  if (raining) return null

  // Sunny "go out & enjoy" notes contradict an incoming-rain countdown, so skip
  // them when rain is on the way soon. Prep notes (jacket / wind) still apply —
  // useful whether or not rain is coming.
  if (!rainSoon && temp > 33) {
    if (night) return null  // scorching at midnight needs no action
    return t('weather_scorching', v)
  }
  if (!rainSoon && temp > 29) {
    if (night) return null  // hot night, no "go!" advice
    return t('weather_hot', v)
  }
  if (wind > 30) return t('weather_windy', v)
  if (temp < 5)  return t('weather_freezing', v)
  if (temp < 12) return t('weather_cold', v)
  // "Perfect weather" is an invitation to go out — only when it's genuinely clear
  // (not overcast, code<=2) AND no rain is imminent, otherwise it contradicts the
  // countdown ("made for going out" while "rain in 10 min") or the cloudy banner.
  if (!rainSoon && !night && !evening && temp >= 22 && temp <= 29 && wind < 20 && code <= 2) {
    return t('weather_perfect', v)
  }
  return null
}

function precipByCode(code) {
  if (code === null || code === undefined || code < 0) return false
  return (code >= 51 && code <= 67) ||
         (code >= 71 && code <= 77) ||
         (code >= 80 && code <= 99)
}

const RAIN_SHOW_MIN = 10  // below this, say "shortly/any minute" — a numeric ETA is false precision
const ALMOST_MIN = 10  // raining but clearing this soon → "almost over, get ready"
const SOON_MIN = 5     // clears in <5 min → too close to be precise; drop the number, go soft
export const LIGHT_MIN = 0.2  // below this = go (dry-enough) — a 0.1mm tip must not flip GO↔GO-ANYWAY
export const LIGHT_MAX = 0.5  // raining but below this = light/drizzle → "you could still go out"
const RAIN_PROB_MIN = 50  // model rain probability below this → soften the radar countdown
const RAIN_SOON_NOTE = 90 // rain within this many min → drop the "go out & enjoy" weather notes
const FAR_RAIN_MIN = 90   // rain ≥ this far out → speak in hours ("rain in about 2 h"),
                          // so the countdown covers the FULL horizon (gaps-first philosophy:
                          // the ribbon showing a 3h-out band while the sub says nothing
                          // — or a timeless "possible later" — undersold the window)

// 90 → "1½", 120 → "2", 150 → "2½", 170 → "3" — rounded to the nearest half hour.
function hoursLabel(min) {
  const h = Math.round(min / 30) / 2
  return h % 1 ? `${Math.floor(h)}½` : `${h}`
}

// Gap-confidence softener (v1.2.1): our verified nowcast skill is strong under an
// hour and decays past it (POD ~50% at 60–90 min) — so a break predicted ≥60 min out
// is spoken as "likely/should", nearer breaks stay firm. Time-based on purpose: the
// model's HOURLY probability stays high through a whole rainy spell, so it would mark
// every intra-rain gap "likely" (over-softening). Wording only — the time is kept.
const GAP_FIRM_MIN = 60

// Shared "what's ahead" sub-line for a dry window / gap opening — reused by both
// the WAIT state and the light-rain ("go anyway") state so they carry the same
// forward context (clearing vs a fixed break) without inventing new strings.
function breakSub(firstGap, nowSec, t) {
  const clearInMin = Math.max(0, Math.round((firstGap.startsAt - nowSec) / 60))
  const far = clearInMin >= GAP_FIRM_MIN
  if (clearInMin < SOON_MIN)    return t('s_almost_now')
  if (firstGap.opensEnded)      return t(far ? 's_clearing_far' : 's_clearing', { min: clearInMin })
  if (clearInMin <= ALMOST_MIN) return t('s_almost_over', { min: clearInMin, dur: firstGap.durationMinutes })
  return t(far ? 's_break_likely' : 's_break_opens', { min: clearInMin, dur: firstGap.durationMinutes })
}

// Passive, third-person "notice" wording for the MAP POPUPS — a neutral status card
// for a place ("Dry — rain arriving soon"), distinct from the app's first-person brand
// voice (GEMMA RAUS / "bed is better"), which stays on the big headline + the user's own
// banner. Same underlying facts, calmer register. Attached to every status as `notice`
// so the popup renderer can pick it while the banner keeps headline/sub.
function noticeFor(type, currentPrecip, firstGap, trend, nowSec, t) {
  const head = type === 'go' ? t('n_dry') : type === 'light' ? t('n_light') : t('n_raining')
  let sub
  if ((type === 'go' || type === 'light') && trend.downpourSoonMin != null) {
    sub = t('n_downpour_soon', { min: trend.downpourSoonMin })
  } else if (type === 'go') {
    if (trend.rvApproachMin != null && (!trend.nextRainAt || trend.nextRainAt - nowSec > 45 * 60)) {
      sub = trend.rvApproachDir
        ? t('n_rv_approach_dir', { min: trend.rvApproachMin, dir: t('dir_' + trend.rvApproachDir) })
        : t('n_rv_approach', { min: trend.rvApproachMin })
    } else if (trend.dryEndsOpen && trend.traceEcho) {
      if (trend.modelRainAt) {
        const m = Math.max(0, Math.round((trend.modelRainAt - nowSec) / 60))
        sub = m >= FAR_RAIN_MIN ? t('n_trace_now_far', { h: hoursLabel(m) })
            : t('n_trace_now_min', { min: Math.max(5, Math.round(m / 5) * 5) })
      } else {
        sub = t('n_trace_now')
      }
    } else if (trend.dryEndsOpen && trend.rvNearbyDir) {
      sub = t('n_rv_nearby', { dir: t('dir_' + trend.rvNearbyDir) })
    } else if (trend.dryEndsOpen && trend.traceAheadMin != null) {
      sub = trend.traceAheadMin >= FAR_RAIN_MIN
        ? t('n_trace_ahead_far', { h: hoursLabel(trend.traceAheadMin) })
        : t('n_trace_ahead', { min: Math.max(5, Math.round(trend.traceAheadMin / 5) * 5) })
    } else if (trend.dryEndsOpen && trend.modelRainAt) {
      const m = Math.max(0, Math.round((trend.modelRainAt - nowSec) / 60))
      sub = m >= FAR_RAIN_MIN ? t('n_model_rain_far', { h: hoursLabel(m) })
          : t('n_model_rain', { min: Math.max(5, Math.round(m / 5) * 5) })
    } else if (trend.dryEndsOpen) {
      sub = t('n_clear_hours')
    } else if (trend.nextRainAt) {
      const min = Math.max(0, Math.round((trend.nextRainAt - nowSec) / 60))
      const lowConf = trend.rainProb != null && trend.rainProb < RAIN_PROB_MIN
      sub = min >= FAR_RAIN_MIN ? t('n_rain_far', { h: hoursLabel(min) })
          : lowConf ? t('n_rain_maybe')
          : min < RAIN_SHOW_MIN ? t('n_rain_soon')
          : t('n_rain_in', { min: Math.round(min / 5) * 5 })
    } else {
      sub = t('n_dry_now')
    }
  } else if (type === 'light') {
    if (firstGap) {
      const min = Math.max(0, Math.round((firstGap.startsAt - nowSec) / 60))
      sub = min < RAIN_SHOW_MIN ? t('n_break_soon') : t('n_clearing', { min: Math.round(min / 5) * 5 })
    } else {
      sub = t('n_light_here')
    }
  } else if (type === 'wait') {
    const min = firstGap ? Math.max(0, Math.round((firstGap.startsAt - nowSec) / 60)) : 0
    sub = min < SOON_MIN ? t('n_break_soon')
        : min >= GAP_FIRM_MIN ? t('n_break_likely', { min })
        : t('n_break_in', { min })
  } else {
    if (trend.modelEaseAt) {
      const m = Math.max(0, Math.round((trend.modelEaseAt - nowSec) / 60))
      sub = m >= FAR_RAIN_MIN ? t('n_stuck_ease_far', { h: hoursLabel(m) })
          : t('n_stuck_ease', { min: Math.max(5, Math.round(m / 5) * 5) })
    } else {
      sub = t('n_no_break')
    }
  }
  return { head, sub }
}

// nowSec + trend ({ nextRainAt, dryEndsOpen }) let the headline/sub tick down
// live between the 5-min data refreshes. getStatus() wraps this with the
// night-time sleep nudge (below).
export function getStatus(
  currentPrecip, gaps, weather, t = k => k,
  nowSec = Math.floor(Date.now() / 1000), trend = {},
) {
  if (currentPrecip === null) {
    return { type: 'loading', headline: t('checking'), sub: t('reading_sky'), weather: null }
  }

  // Browser-local clock: 00:00–04:59 (12am–5am) → cozy night sub-lines (headline
  // & colour stay normal; nobody's sprinting outside at 3am, so no urgency).
  const hour    = new Date(nowSec * 1000).getHours()
  const night   = hour < 5
  const evening = hour >= 18   // 18:00–23:59 — wind-down tone, no "go sprint outside"

  // Trust currentPrecip (max of TAWES sensors + nowcast + Open-Meteo precipitation).
  // weather_code is NOT used here — it lags significantly after rain stops (code=61
  // persists long after sensors read 0mm) and would block GO even when every source
  // agrees it's dry. precipByCode() remains available for other callers.
  const isDry = currentPrecip < DRY_THRESHOLD
  const firstGap = gaps[0]
  // A gap that's already started means the forecast says dry now even if a
  // station's RR still lags — trust the model and treat it as "go".
  // Exception: if RainViewer radar directly observes active rain at the user's
  // pixel, the nowcast is blind to this cell; suppress the override so we
  // don't flash GO while radar confirms rain overhead.
  const gapNow = firstGap && firstGap.startsAt <= nowSec && !trend?.rvRainActive

  // Weather note needs to know if we're heading out (dry/go) or stuck in the rain,
  // so the "go outside" comfort lines don't contradict a WAIT/STUCK headline; and
  // whether rain is imminent, so "made for going out" doesn't run under a countdown.
  const rainSoon = trend.nextRainAt != null && (trend.nextRainAt - nowSec) <= RAIN_SOON_NOTE * 60
  const weatherNote = getWeatherNote(weather, t, { night, evening, raining: !(isDry || gapNow), rainSoon })

  // ---- Dry now: narrate the incoming rain ----
  if (isDry || gapNow) {
    let sub
    if (trend.downpourSoonMin != null) {
      // Radar shows a real downpour imminent — warn even though it's dry NOW, so
      // "go" doesn't walk you into a soaking. Top priority over the calm dry subs.
      sub = t('s_downpour_soon', { min: trend.downpourSoonMin })
    } else if (trend.rvApproachMin != null && (!trend.nextRainAt || trend.nextRainAt - nowSec > 45 * 60)) {
      // A RainViewer forecast frame shows OBSERVED echo arriving at this pixel in
      // ~N min while the (higher-latency) GeoSphere timeline still claims nothing
      // near. Freshest radar wins, WITH a real ETA (all frames sampled): the "rain
      // was visibly blue on the map while the app said dry" case. Yields to a
      // nearer GeoSphere countdown.
      sub = trend.rvApproachDir
        ? t('s_rv_approach_dir', { min: trend.rvApproachMin, dir: t('dir_' + trend.rvApproachDir) })
        : t('s_rv_approach', { min: trend.rvApproachMin })
    } else if (trend.dryEndsOpen && trend.traceEcho) {
      // Real, patchy light echo below our reporting cutoff (hasTraceEcho) — DRY_
      // THRESHOLD is a reporting line, not a physical one. Radar's own 3h timeline
      // never crosses it (dryEndsOpen), so without this the app would flatly claim
      // "clear for hours" while faint drizzle is genuinely happening. Combines with
      // the model's own far-rain time when we have one (both signals true at once:
      // trace THIS moment, steadier accumulating rain expected later).
      if (night) {
        sub = t('s_night_drizzle')
      } else if (trend.modelRainAt) {
        const m = Math.max(0, Math.round((trend.modelRainAt - nowSec) / 60))
        sub = m >= FAR_RAIN_MIN
          ? t('s_trace_now_far', { h: hoursLabel(m) })
          : t('s_trace_now_min', { min: Math.max(5, Math.round(m / 5) * 5) })
      } else {
        sub = t('s_trace_now')
      }
    } else if (trend.dryEndsOpen && trend.rvNearbyDir && !night) {
      // Ring watch (v2.4): real radar echo ~15 km out in a coherent direction while
      // the pixel and its whole 3h timeline are dry, and no arrival ETA yet — the
      // honest "keep an eye on it" lead. Observed echo outranks a forecast hint.
      sub = t('s_rv_nearby', { dir: t('dir_' + trend.rvNearbyDir) })
    } else if (trend.dryEndsOpen && trend.traceAheadMin != null && !night) {
      // Trace-ahead (v2.5): the radar timeline never crosses the reporting cutoff
      // (dryEndsOpen) but shows a RUN of sub-threshold echo starting in ~N min —
      // drizzle the "clear for hours" line used to hide. Radar's own trace beats
      // the model hint below; observed echo NOW (trace/nearby/approach) beats it.
      sub = trend.traceAheadMin >= FAR_RAIN_MIN
        ? t('s_trace_ahead_far', { h: hoursLabel(trend.traceAheadMin) })
        : t('s_trace_ahead', { min: Math.max(5, Math.round(trend.traceAheadMin / 5) * 5) })
    } else if (trend.dryEndsOpen && trend.modelRainAt) {
      // Radar sees NOTHING in 3 h but the MODEL's own timeline shows rain — the
      // frontal/stratiform case where the model leads the radar by hours. Never
      // claim a confident all-clear the model contradicts: better someone stays
      // home dry than gets sent out into rain the radar couldn't see yet.
      const m = Math.max(0, Math.round((trend.modelRainAt - nowSec) / 60))
      sub = night ? t('s_night_rain_coming')
          : m >= FAR_RAIN_MIN ? t('s_model_rain_far', { h: hoursLabel(m) })
          : t('s_model_rain', { min: Math.max(5, Math.round(m / 5) * 5) })
    } else if (trend.dryEndsOpen) {
      sub = t(night ? 's_night_clear' : evening ? 's_evening_clear' : 's_clear_hours')
    } else if (trend.nextRainAt) {
      if (night) {
        sub = t('s_night_rain_coming')
      } else {
        // Radar onset timing jitters between refreshes, so an exact minute (or a
        // wide ±10 range like "1–18 min") reads as random/false-precise. Under
        // 10 min say "shortly / any minute"; at/above 10 min round to the nearest
        // 5 and say "about X min". recentRain frames it as the same event resuming
        // ("short break — rain back …") instead of a fresh alarm.
        const rainInMin = Math.max(0, Math.round((trend.nextRainAt - nowSec) / 60))
        const about = Math.round(rainInMin / 5) * 5
        const lowConf = trend.rainProb != null && trend.rainProb < RAIN_PROB_MIN
        if (rainInMin >= FAR_RAIN_MIN) {
          // Far-out rain: ALWAYS give the countdown, in hours — the window is the
          // product. Low confidence softens the wording but keeps the time.
          sub = t(lowConf ? 's_rain_far_maybe' : 's_rain_far', { h: hoursLabel(rainInMin) })
        } else if (lowConf) {
          sub = t('s_rain_maybe')
        } else if (rainInMin < RAIN_SHOW_MIN) {
          sub = t(trend.recentRain ? 's_rain_back_soon' : 's_rain_any')
        } else {
          sub = t(trend.recentRain ? 's_rain_back' : 's_rain_soon', { min: about })
        }
      }
    } else {
      sub = (trend.recentRain && !night && !evening)
        ? t('s_rain_eased')
        : t(night ? 's_night_dry' : evening ? 's_evening_dry' : 's_dry_generic')
    }
    return { type: 'go', headline: t('GO_NOW'), sub, weather: weatherNote, notice: noticeFor('go', currentPrecip, firstGap, trend, nowSec, t) }
  }

  // Trace drizzle (< 0.2 mm) → still GO. A 0.1 mm tip must not flip GEMMA RAUS ↔
  // GO ANYWAY; only a genuine ≥0.2 mm drizzle earns the light state.
  if (currentPrecip < LIGHT_MIN) {
    const sub = t(night ? 's_night_dry' : evening ? 's_evening_dry' : 's_dry_generic')
    return { type: 'go', headline: t('GO_NOW'), sub, weather: weatherNote, notice: noticeFor('go', currentPrecip, firstGap, trend, nowSec, t) }
  }

  // ---- Light drizzle (0.2–0.5 mm): "you could still go" ----
  // Driven by the GROUND reading, so a stale/over-reading nowcast can't force STUCK
  // while you're in a drizzle. At NIGHT it stays a calm drizzle (cozy sub) instead of
  // falling through to a WAIT countdown; daytime keeps the forward easing/clearing text.
  if (currentPrecip < LIGHT_MAX) {
    let sub
    if (trend.downpourSoonMin != null) {
      // Drizzling now, but a real downpour is minutes away — warn instead of the
      // casual "go anyway" that soaked the user in Nonntal.
      sub = t('s_downpour_soon', { min: trend.downpourSoonMin })
    } else if (night) {
      sub = t('s_night_drizzle')   // drizzle wording — never "raining" under GO ANYWAY
    } else if (firstGap) {
      const easeMin = Math.max(0, Math.round((firstGap.startsAt - nowSec) / 60))
      sub = easeMin < RAIN_SHOW_MIN
        ? t('s_light_soon')
        : t('s_light_clearing', { min: Math.round(easeMin / 5) * 5 })
    } else {
      sub = t('s_light')
    }
    return { type: 'light', headline: t('LIGHT_RAIN'), sub, weather: weatherNote, notice: noticeFor('light', currentPrecip, firstGap, trend, nowSec, t) }
  }

  // ---- Raining now: narrate the break ahead ----
  if (firstGap) {
    const clearInMin = Math.max(0, Math.round((firstGap.startsAt - nowSec) / 60))
    // Under 5 min the exact minute is noise — drop the number and go soft.
    const soon = clearInMin < SOON_MIN
    const headline = soon ? t('WAIT_SOON') : t('WAIT_MIN', { min: clearInMin })
    const sub = night ? t('s_night_raining') : breakSub(firstGap, nowSec, t)
    return { type: 'wait', headline, sub, weather: weatherNote, notice: noticeFor('wait', currentPrecip, firstGap, trend, nowSec, t) }
  }

  const isThunder = (weather?.code ?? -1) >= 95 && (weather?.code ?? -1) <= 99
  // Model ease second-opinion (v2.1): STUCK means "radar sees no break" — if the
  // model shows the rain ending within 3 h, say so instead of a bare "stay in".
  // Wording only; the state (and colour) stays STUCK until radar confirms a gap.
  let stuckSub
  if (isThunder) {
    stuckSub = t('s_stuck_storm')
  } else if (trend.modelEaseAt) {
    const m = Math.max(0, Math.round((trend.modelEaseAt - nowSec) / 60))
    stuckSub = m >= FAR_RAIN_MIN ? t('s_stuck_ease_far', { h: hoursLabel(m) })
             : t('s_stuck_ease', { min: Math.max(5, Math.round(m / 5) * 5) })
  } else {
    stuckSub = t(night ? 's_night_stuck' : evening ? 's_evening_stuck' : 's_stuck')
  }
  return {
    type: 'stuck',
    headline: t('STUCK'),
    sub: stuckSub,
    weather: weatherNote,
    notice: noticeFor('stuck', currentPrecip, firstGap, trend, nowSec, t),
  }
}
