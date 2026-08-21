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

// v2.29.0 — the RainViewer NOW magnitude. `rvPrecip` arrives BINARY (0.3 for any
// echo at all), because the sampler used to read only the alpha channel; intensity
// lives in the RGB and is now carried separately as `rvHeavy`. A heavy echo that
// also BLANKETS the block is real weather and gets its true class instead of the
// drizzle constant — two independent keys, intensity AND extent, so neither a
// stuck-clutter pixel (heavy but tiny) nor a broad trace field (wide but faint)
// can escalate on its own. Clear sky stays an absolute veto, exactly as it is for
// drizzle surfacing (v1.1.5/v2.4.1) — sunny-day anaprop off the Untersberg can be
// intense as well as broad, and the "sunny but PASST SCHON" bug must stay dead.
// Raise-only by construction: it can never return LESS than it was given.
export function rvNowValue(rvPrecip, rvHeavy = false, rvSolid = false, code = null) {
  const clearSky = code != null && code <= 2
  if (rvHeavy && rvSolid && !clearSky) return Math.max(rvPrecip ?? 0, RV_HEAVY_MM)
  return rvPrecip ?? 0
}

export function surfaceDrizzle(groundPrecip, rawNowSlot, rvPrecip, code, rvSolid = false) {
  if (groundPrecip >= DRY_THRESHOLD) return null       // gauge already wet — not our case
  const drizzle = Math.max(rawNowSlot ?? 0, rvPrecip ?? 0)
  // v2.29.0 — THE HEAVY BRANCH. Live incident 2026-08-21: a convective shower
  // (METAR LOWS -SHRA, 7kt → 19G29kt) sat over the city while the gauge read 0.0
  // (bucket not tipped) and the nowcast's current slot read 0.00 (issued 17:45,
  // extrapolated from ~17:25) — RainViewer was the ONLY instrument that saw it, at
  // 25/25 px with deep-blue cores. Because rvPrecip was a hardcoded 0.3 it landed
  // mid light band and we said GO ANYWAY into it. A heavy, block-filling echo is
  // now surfaced UNCAPPED so the verdict can reach WAIT/BLEIB DRIN. Note this is
  // checked BEFORE the light-band return below — that return exists to stop radar
  // manufacturing a false STUCK from a value it half-trusts, which is precisely
  // NOT this case: here two independent RainViewer keys agree it is heavy AND wide.
  if (rvSolid && (rvPrecip ?? 0) >= RV_HEAVY_MM && !(code != null && code <= 2)) {
    return rvPrecip
  }
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

// ---- Gauge units (v2.21.0) --------------------------------------------------------
// Every threshold on this page is calibrated on the nowcast's 15-MINUTE slots — read
// as a rate they line up with the standard rain classes (LIGHT_MAX 0.5 = 2 mm/h, the
// light/moderate boundary; DOWNPOUR_MM 1.5 = 6 mm/h). TAWES `RR`, however, is the
// total over the last TEN minutes (the dataset is literally tawes-v1-10min), and it
// was being compared against those thresholds raw — so every ground reading entered
// the ladder 1.5x under-scaled. Live incident (2026-08-18, city-wide rain, METAR LOWS
// reporting RA/-RA continuously for 2.5 h): the gauge read 0.4 mm/10 min — 2.4 mm/h,
// meteorologically MODERATE rain — and landed dead centre of the "light drizzle, go
// anyway" band. Five of the eleven city points said PASST SCHON while it rained.
//
// This is a unit correction, not a tuned constant: it puts the gauge on the same
// scale as the thresholds it is measured against.
export const GAUGE_SLOT_SCALE = 1.5

// Sub-reporting readings are deliberately NOT scaled. Lifting a 0.07 across
// DRY_THRESHOLD would flip `groundDry` and silently disable drizzle surfacing (v1.1) —
// a real drizzle would drop from GO ANYWAY back to GEMMA RAUS, which is a LAG, the one
// direction the doctrine does not forgive. Below the reporting line the value passes
// through untouched, so `groundDry` and surfaceDrizzle behave exactly as before and
// this function can only ever RAISE a value that already says "it is raining".
export function gaugeSlotValue(rr) {
  const v = typeof rr === 'number' && Number.isFinite(rr) && rr > 0 ? rr : 0
  if (v < DRY_THRESHOLD) return v
  return v * GAUGE_SLOT_SCALE
}

// Model-current contribution to the NOW blend (v2.0.1). Open-Meteo's
// current.precipitation is a PRECEDING-HOUR value — after rain ends it stays high for
// up to an hour, and it was out-shouting a reporting gauge (gauge 0.0, model 0.7 →
// max = 0.7 → a bogus "WAIT 50 MIN" on the trailing edge, in the sun). Doctrine:
// a REPORTING gauge owns the NOW magnitude; the hour-lagged model may lift it at most
// into the LIGHT band (cap 0.4 — same philosophy as the virga cap): it can whisper
// "drizzle the gauge missed", it can never manufacture WAIT/STUCK alone. With no
// gauge at all, the model passes through (the radar-max path handles that case).
// v2.17.0 — the cap's blind spot (Nonntal thunderstorm, 2026-08-06): the cap was
// written for the TRAILING edge (rain over, model still reporting last hour). It
// cannot tell that case apart from a downpour happening RIGHT NOW, so a model
// reading 6-10 mm during a hail thunderstorm was clamped to 0.4 — dead centre of
// the light band — and the app said PASST SCHON while the user was being soaked.
// The distinguishing evidence is an INDEPENDENT witness: on the trailing edge the
// radar is already dry, during a live downpour it is not. So a heavy model current
// passes uncapped only when radar/RainViewer confirm rain is falling at this cell —
// the same "heavy echo is self-evidencing" rule VIRGA_HEAVY_PASS applies to radar
// (v1.1.4), now applied to the second cap that was missed. `radarNow` defaults to 0,
// so an uncorroborated call behaves exactly as v2.0.1 did.
export const MODEL_NOW_CAP = 0.4
export const MODEL_HEAVY_PASS = 1.5
export function modelNowValue(measured, stationPresent, stationPrecip, radarNow = 0) {
  if (!stationPresent) return measured
  // 0.10-rounding guard (unchanged): a 0-reading gauge needs the model to be
  // STRICTLY above 0.1 before it may claim any wetness at all.
  if (stationPrecip === 0 && measured <= 0.1) return 0
  if (measured >= MODEL_HEAVY_PASS && (radarNow ?? 0) >= DRY_THRESHOLD) return measured
  return Math.min(measured, MODEL_NOW_CAP)
}

// The radar's own reading at this moment — nearest nowcast slot to `nowSec`.
// Extracted (v2.17.0) from the loop duplicated at both App.jsx call sites, because
// the NOW blend now needs it BEFORE modelNowValue rather than after.
export function nowcastNowSlot(nowcast, nowSec) {
  if (!nowcast?.times?.length) return 0
  let bi = 0, bd = Infinity
  for (let i = 0; i < nowcast.times.length; i++) {
    const d = Math.abs(nowcast.times[i] - nowSec)
    if (d < bd) { bd = d; bi = i }
  }
  return nowcast.precips[bi] ?? 0
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
// Model union (v2.7): the forecast lane is the COMBINATION of both models —
// whichever shows rain is displayed, the stronger value wins per slot. Open-Meteo
// gives the 15-min base series; GeoSphere AROME (radar-assimilating, hourly
// totals in mm/h) is overlaid by scaling each hour onto the slots it covers
// (slot width ÷ 3600). An AROME timestamp is treated as the END of its
// accumulation hour (the meteorological convention for accumulated params);
// if the product actually stamps the START, rain paints one hour EARLY — a
// lead, our forgiven direction — never an hour late.
// AROME's hourly totals projected onto the 15-min slot grid. Extracted (v2.18.0)
// so the ribbon can compare the two models slot-by-slot instead of only seeing the
// max of them. combineModelSeries below is unchanged in behaviour — same loop, same
// window condition, same scale — and its existing contract tests pin that.
export function aromeSlotSeries(times, aTimes, aPrecips) {
  if (!times?.length) return []
  if (!aTimes?.length) return times.map(() => 0)
  const dt = times.length > 1 ? Math.max(60, times[1] - times[0]) : 900
  const scale = Math.min(1, dt / 3600)
  return times.map(tt => {
    for (let j = 0; j < aTimes.length; j++) {
      if (tt > aTimes[j] - 3600 && tt <= aTimes[j]) return (aPrecips?.[j] ?? 0) * scale
    }
    return 0
  })
}

export function combineModelSeries(times, precips, aTimes, aPrecips) {
  const base = times?.map((_, i) => precips?.[i] ?? 0) ?? []
  if (!times?.length || !aTimes?.length) return base
  const a = aromeSlotSeries(times, aTimes, aPrecips)
  return base.map((own, i) => Math.max(own, a[i] ?? 0))
}

// ---- Ribbon confidence (v2.18.0) -------------------------------------------------
// The forecast lane is max(ICON-EU, AROME). A max can never sit below either input,
// so when the two models disagree the ribbon drew one confident line over a genuine
// argument. Live case (2026-08-06 storm): at 21:15 ICON-EU said 2.2 mm while AROME
// said 0.20 and radar read 0.14 — ICON-EU was replaying the same storm ~2 h late (its
// documented Alpine convective lag). The verdict lane keeps using the max (a union can
// only ADD warnings — the lead/lag asymmetry); the RIBBON now says how sure that is.
export const MODEL_AGREE_FACTOR = 2.5

export function modelsAgree(om, arome) {
  const a = typeof om === 'number' ? om : 0
  const b = typeof arome === 'number' ? arome : 0
  const aWet = a >= DRY_THRESHOLD, bWet = b >= DRY_THRESHOLD
  if (!aWet && !bWet) return true            // both say dry — that IS agreement
  if (aWet !== bWet) return false            // one sees rain, the other nothing
  const hi = Math.max(a, b), lo = Math.min(a, b)
  return hi <= lo * MODEL_AGREE_FACTOR       // same story, comparable magnitude
}

// Model probability at a moment. Returns null past the fetched horizon rather than
// letting the last hour's number leak across the tail — "no data" and "low confidence"
// must not render the same way.
export function probAt(hTimes, hProb, tt) {
  if (!hTimes?.length) return null
  let bi = -1, bd = Infinity
  for (let i = 0; i < hTimes.length; i++) {
    const d = Math.abs(hTimes[i] - tt)
    if (d < bd) { bd = d; bi = i }
  }
  if (bi < 0 || bd > 3600) return null
  return typeof hProb?.[bi] === 'number' ? hProb[bi] : null
}

// How far the radar zone ACTUALLY reaches, as a "3" / "2½" label. The band said a
// hardcoded "NEXT 3 H" while the nowcast's 12 slots span 2h45 from their first slot
// and then age up to 15 min before the next issue — so the promise was never once
// what the data delivered, and the boundary visibly slid between refreshes.
export function radarSpanLabel(radarUntil, nowSec) {
  if (!Number.isFinite(radarUntil) || !Number.isFinite(nowSec)) return '3'  // never "Infinity H"
  const mins = Math.max(0, Math.round((radarUntil - nowSec) / 60))
  return hoursLabel(mins)
}

// Ghost bars showed model rain only where radar was bone-dry (< 0.1), so a radar
// reading of 0.14 hid a 2.2 mm model expectation completely while 0.09 would have
// drawn it full height. That 0.05 mm cliff sat right at the end of the radar zone.
// Now: draw whenever the model MATERIALLY exceeds what radar sees.
export const GHOST_MIN_FACTOR = 1.5
export function showGhost(radarP, modelP) {
  const r = typeof radarP === 'number' ? radarP : 0
  const m = typeof modelP === 'number' ? modelP : 0
  if (m < DRY_THRESHOLD) return false            // model sees nothing worth drawing
  if (m - r < DRY_THRESHOLD) return false        // difference too small to be a claim
  return m >= r * GHOST_MIN_FACTOR
}

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
// v2.25.0 — the ease has to LAST. User report (2026-08-18): "bleib drin, rain going
// away in about 2½ h — is this even true?" It was not. The loop below only ever looked
// 3 h ahead, so a dry stretch that began near the end of that window was announced as
// the rain ending while the model had it raining again shortly AFTER the window — the
// one place the old code was structurally blind. The live series showed exactly that:
// four slots of 0.03 mm (the model's noise floor, under our reporting line, so it
// counts as dry) and then straight back to 0.26–0.60 an hour later.
//
// So the dry stretch is now measured on the FULL model series rather than truncated at
// the window edge, and must run at least MODEL_EASE_MIN_DRY. Why twice GO_MIN_WINDOW:
// one usable window is a PAUSE, and radar already has its own wording for a pause
// (breakSub). For this sentence to say the rain is *ending* it needs clearly more than
// one window's worth, or it is over-promising. Suppression only — it can just remove an
// optimistic sub-line, never delay a warning; the state stays STUCK either way.
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
  if (!wetSeen || ease === null) return null
  const until = ease + MODEL_EASE_MIN_DRY * 60
  // Can't see far enough to confirm it lasts → don't claim it. Declining to make an
  // optimistic promise on unverifiable data is the safe direction.
  if (omTimes[omTimes.length - 1] < until) return null
  for (let i = 0; i < omTimes.length; i++) {
    const tt = omTimes[i]
    if (tt >= ease && tt < until && (omPrecips[i] ?? 0) >= DRY_THRESHOLD) return null
  }
  return ease
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

// v2.8.0: dual-key phantom-trace guard. Live incident (2026-07-17): cloudless 30°
// afternoon (METAR NCD, code 0 at every point) while the INCA timeline painted an
// IDENTICAL trace carpet across all 11 city points — first echo the same minute,
// same 0.01–0.02 values everywhere, and RainViewer byte-identical to an empty
// Atlantic tile for ~275 km around. Real drizzle never arrives at eleven
// neighbourhoods simultaneously with the same value: that's the nowcast's
// model-blend tail leaking numeric noise, and the app answered a cloudless sky
// with three hours of "drizzle possible". Suppress the trace TIER (traceEcho +
// traceAheadMin wording; the ribbon dims its stubs separately) only when BOTH
// keys agree it's phantom: the sky is clear (code ≤ 2, the same absolute-veto
// band surfaceDrizzle uses) AND RainViewer — an independent instrument — is
// fully quiet: pixel dry, no approach ETA, no ring echo in any sector, no solid
// field. Why this can't create a lag: rain that is really coming shows on
// RainViewer (approach frames / ~15 km ring) before it reaches you, releasing
// the RV key; a pop-up cell builds visible towers first, pushing the sky code
// past 2 and releasing the sky key. RainViewer unavailable (rv null / now not a
// number) means we CANNOT corroborate absence → never suppress. Trace tier only:
// real slots (≥ DRY_THRESHOLD), downpour warnings, approach lanes and countdowns
// are untouched by design.
export function tracePhantom(code, rv) {
  const clearSky = code != null && code <= 2
  if (!clearSky) return false
  if (!rv || typeof rv.now !== 'number') return false   // no RV witness → keep the trace
  return rv.now < DRY_THRESHOLD && rv.approachMin == null &&
         rv.fromDir == null && !rv.rvSolid
}

// Minutes to the first real DOWNPOUR (≥ DOWNPOUR_MM) the radar shows within
// DOWNPOUR_WINDOW_MIN, or null. Shared by loadData + computeStatusAt so your live
// verdict and the town dots warn identically. Runs on the (virga-filtered) nowcast,
// so it fires only on genuine heavy rain — never on light echo the model rejects.
// windowMin is a parameter since v2.19.0 — the SUB-line warning keeps its 30-min
// window (unchanged wording behaviour), while the headline escalation below looks
// GO_MIN_WINDOW ahead. Same detector, two horizons, one place to get it right.
export function firstDownpourMin(nowcast, nowSec, windowMin = DOWNPOUR_WINDOW_MIN) {
  if (!nowcast) return null
  const lim = nowSec + windowMin * 60
  for (let i = 0; i < nowcast.times.length; i++) {
    const tt = nowcast.times[i], p = nowcast.precips[i] ?? 0
    if (tt >= nowSec && tt <= lim && p >= DOWNPOUR_MM) return Math.max(0, Math.round((tt - nowSec) / 60))
  }
  return null
}

// ---- The usable-window rule (v2.19.0) --------------------------------------------
// "GEMMA RAUS" is a promise that you have time to actually GO somewhere, not merely
// an observation that this instant is dry. Live incident (2026-08-17, ~11:36, Nonntal):
// gauges 0.0, radar trace 0.01, code 61 — genuinely a light drizzle — with 3.43 mm/15min
// (~14 mm/h) arriving at 12:15. The headline read GEMMA RAUS with "heavy rain in ~24 min"
// underneath, because downpourSoonMin was built as additive wording that never touches
// the state. The app already applied exactly this judgment elsewhere and disagreed with
// its own headline: the motorbike glance (`motoSafe`, MOTO_SAFE_MIN 30) was returning
// FALSE at that same moment. This lifts that judgment to the headline, with a longer
// window because a walk commits you for longer than a ride.
//
// Gated on a real DOWNPOUR (>= DOWNPOUR_MM), never on any rain: "rain in 40 min" is true
// on half of all Salzburg afternoons and escalating on it would cry wolf, which is its
// own kind of lie. Only GO / GO ANYWAY escalate — WAIT and STUCK already keep you in.
export const GO_MIN_WINDOW = 45

// How long the model's dry stretch must last before we call it the rain ENDING rather
// than a pause (see modelEaseAt). Derived, not tuned: one GO_MIN_WINDOW is a usable
// window — a pause — and radar already words those. Two is the smallest honest bar for
// "it's going away".
export const MODEL_EASE_MIN_DRY = 2 * GO_MIN_WINDOW   // 90 min

// v2.20.0 — peak intensity was the wrong (only) measure. Live follow-up the same
// morning: the storm was re-forecast DOWN (12:15 went 3.43 → 0.40 between two
// nowcast issues), so no single slot reached DOWNPOUR_MM and nothing escalated —
// yet the radar showed 0.65 + 0.40 + 0.55 = 1.6 mm falling steadily across the next
// 45 min at every city point, with the gauge already reading 0.1. Sustained light
// rain soaks you exactly as well as one hard burst; the app simply couldn't see it,
// because it only ever asked "how hard is the worst slot" and never "how much lands
// while I'm out". This adds the second question.
export const WINDOW_WET_MM = 1.0

// Total precipitation expected across the window — the accumulation you'd actually
// walk through. Trace noise (0.01 carpets) sums to nothing, so no extra guard needed.
export function windowWetMm(nowcast, nowSec, windowMin = GO_MIN_WINDOW) {
  if (!nowcast?.times?.length) return 0
  const lim = nowSec + windowMin * 60
  let sum = 0
  for (let i = 0; i < nowcast.times.length; i++) {
    const tt = nowcast.times[i]
    if (tt >= nowSec && tt <= lim) sum += nowcast.precips?.[i] ?? 0
  }
  return sum
}

// `wetNow` gates the accumulation arm on purpose. A BURST escalates whichever way —
// 14 mm/h in 24 min isn't worth starting anything for, dry or not. But steady rain is
// only disqualifying when there is no dry window to use: if it's dry now and the rain
// arrives at minute 40, you HAVE 40 minutes, and taking that away would be exactly the
// crying-wolf failure this rule was gated against in v2.19.0. The reported case is
// "already wet AND it keeps going" — gauge 0.1 with 1.6 mm still to fall.
// v2.24.0 — the third question. The two arms above both ask about INTENSITY: how hard
// is the worst moment (burst), and how much lands while I'm out (steady). Neither asks
// "is there any point starting anything this afternoon?"
//
// Live case (2026-08-18, 14:39): dry right now, but only for ~21 min, then rain from
// 15:00 climbing 0.19 → 0.78 mm/15min straight through 17:00 — 4 mm over three hours
// with no break anywhere in it. Peak never reached DOWNPOUR_MM, the 45-min total was
// 0.28, and the gauge read 0.0 so `wetNow` was false: all three escapes open, verdict
// GEMMA RAUS. The ribbon plainly showed a wet afternoon.
//
// One run of GO_MIN_SLOTS dry slots, using the SAME DRY_THRESHOLD as everything else —
// no new dryness test, no new constant. (Deliberately not dryWindowOpen: on this very
// afternoon its averaging passed the window by a hair, 0.28 against 0.30 and a 0.19
// peak against 0.20, so the rule would have missed the case it exists for.)
export const GO_MIN_SLOTS = 3   // 3 × 15 min = GO_MIN_WINDOW

// True when a usable dry stretch exists in the look-ahead — OR when we cannot tell.
// No timeline means no grounds to keep anyone in: escalating on ignorance is how an
// app starts crying wolf.
export function hasUsableWindow(times, precips, nowSec) {
  if (!times?.length) return true
  let run = 0, seen = 0
  for (let i = 0; i < times.length; i++) {
    const t = times[i]
    if (t < nowSec - 900 || t > nowSec + LOOK_AHEAD) continue
    seen++
    if ((precips?.[i] ?? 0) < DRY_THRESHOLD) { if (++run >= GO_MIN_SLOTS) return true }
    else run = 0
  }
  return seen === 0
}

// ---- "It's easing" (v2.26.0) -----------------------------------------------------
// Live report (2026-08-18, ~16:20, during a thunderstorm): "now it is kind of a gap,
// and I am a bit sad we can't see this gap into the future and tell people hey look a
// gap came." The radar could see it perfectly — 2.12 mm/15min now, then 0.20 / 0.13 /
// 0.17 / 0.19 straight through the next 2½ h. What it could not do is SAY it: a gap is
// defined as slots below DRY_THRESHOLD, nothing dropped below 0.1 all afternoon, so
// there were zero gaps and the verdict read "no break in sight for 3 hours" over a
// two-and-a-half-hour walkable window.
//
// The missing idea is not foresight, it is vocabulary: we had no word for "much
// lighter, though not zero". LIGHT_MAX is already the app's own line for "you could
// still go out" (it is what PASST SCHON means), so a run of GO_MIN_SLOTS slots below
// it is, by our own existing standard, a window you could use. Same two constants as
// everywhere else — nothing new to calibrate.
//
// Wording only. The state stays STUCK until the easing actually arrives, so this can
// never send anyone out into rain; it tells them when to look again.
export function easesToGoableMin(times, precips, nowSec) {
  if (!times?.length) return null
  const slots = times
    .map((t, i) => ({ t, p: precips?.[i] ?? 0 }))
    .filter(s => s.t >= nowSec - 900 && s.t <= nowSec + LOOK_AHEAD)
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].p >= LIGHT_MAX) continue
    let run = 1
    while (i + run < slots.length && slots[i + run].p < LIGHT_MAX) run++
    if (run >= GO_MIN_SLOTS) return Math.max(0, Math.round((slots[i].t - nowSec) / 60))
    i += run
  }
  return null
}

export function goWindowTooShort(type, downpourMin, wetMm = 0, wetNow = false, noWindow = false) {
  if (type !== 'go' && type !== 'light') return false
  if (typeof downpourMin === 'number' && downpourMin <= GO_MIN_WINDOW) return true
  if (noWindow) return true
  return !!wetNow && (wetMm ?? 0) >= WINDOW_WET_MM
}

// ---- Leaving BLEIB DRIN is a promise, not a reading (v2.22.0) ---------------------
// Live incident (2026-08-18): "a sudden unreliable jump from stuck inside, no break
// for three hours, to go anyways, to back to stuck inside". Every refresh recomputed
// the verdict from zero, so a nowcast reissue that moved one number across one
// threshold swung the headline — and the user, quite reasonably, stopped trusting it.
//
// The asymmetry is the whole design, and it is the doctrine rather than a compromise
// of it: telling someone to stay in a few minutes longer than strictly necessary costs
// them a few minutes. Telling them to go out a few minutes early costs them a soaking.
// So this gate is ONE-DIRECTIONAL — it can only ever delay GOOD news:
//
//   * anything → wait/stuck        immediate, ungated, always (leads forgiven)
//   * stuck    → wait              free — both keep you in, and WAIT carries a countdown
//   * wait     → go/light          free — WAIT already PROMISED that break; reneging on
//                                  a countdown we just showed is its own broken promise
//   * stuck    → go/light          GATED (below): the one transition that says
//                                  "you can head out now" out of nowhere
//
// Releasing STUCK needs a window you could actually USE, corroborated and held:
//   1. dryWindowOpen  — the radar averages below the reporting line across the whole
//                       GO_MIN_WINDOW and never spikes into the light band;
//   2. the gauge agrees it has stopped (checked at the call site);
//   3. it has stayed that way for CALM_DWELL_MS — two refresh cycles, so a single
//      reissue cannot flip the headline.
// Same 45 minutes v2.19.0 requires to ENTER a GO verdict, now symmetric on the way out.
export const CALM_DWELL_MS = 10 * 60 * 1000   // ≈ two 5-min refresh cycles
export const HOLD_STALE_MS = 20 * 60 * 1000   // a hold not REWRITTEN within this long is
                                              // not continuity, it's a stale app — same
                                              // cap the cached timelines use.
export const HOLD_MAX_MS   = 20 * 60 * 1000   // hard ceiling: however jammed the evidence
                                              // gate gets, a calm READING alone releases
                                              // after this. See the valve below.

// Accumulation AND peak, because they fail differently: three slots of 0.09 average out
// dry but are a continuous drizzle, and one 0.4 spike inside an otherwise dry window is
// a shower crossing your route. A usable window has neither.
export function dryWindowOpen(nowcast, nowSec, windowMin = GO_MIN_WINDOW) {
  if (!nowcast?.times?.length) return false   // no radar → absence cannot be corroborated
  const lim = nowSec + windowMin * 60
  let sum = 0, peak = 0, count = 0
  for (let i = 0; i < nowcast.times.length; i++) {
    const tt = nowcast.times[i]
    if (tt < nowSec || tt > lim) continue
    const p = nowcast.precips?.[i] ?? 0
    sum += p; peak = Math.max(peak, p); count++
  }
  if (!count) return false                    // window off the end of the timeline
  return sum < DRY_THRESHOLD * count && peak < LIGHT_MIN
}

// The dwell clock. `prev` is the hold record carried in the localStorage story
// ({ ts, calmSince }), rewritten every refresh for as long as the verdict is STUCK —
// so `ts` measures how fresh the HOLD is, not how long the rain has lasted. (A three
// hour downpour must stay held throughout; an app that was closed for half an hour
// must not resume holding on evidence nobody has checked since.) Returns whether the
// hold still applies plus the updated clock. Pure so the whole gate is testable
// without a browser: no Date.now(), no storage.
export function settleStuckHold(prev, { releaseOk, easing, nowMs, stale = HOLD_STALE_MS } = {}) {
  if (!prev || typeof prev.ts !== 'number' || !(nowMs - prev.ts <= stale)) {
    return { holding: false, calmSince: null, easedSince: null }   // no hold, or too old
  }
  // The calm clock starts the first cycle the evidence appears and RESETS the moment
  // it lapses — "45 dry minutes, twice in a row", not "45 dry minutes at some point".
  const calmSince = releaseOk ? (typeof prev.calmSince === 'number' ? prev.calmSince : nowMs) : null
  const dwellMet = calmSince != null && nowMs - calmSince >= CALM_DWELL_MS
  // The safety valve. A hold may DELAY good news; it must never be able to CANCEL it.
  // Two ways the evidence gate can jam shut while it is genuinely dry outside: the
  // nowcast goes away entirely, or INCA lays down one of its documented sub-threshold
  // trace carpets (v2.8.0) that keeps the window "not usable" for an hour. Either way
  // the NOW reading is calm and the user is standing in the dry, so a second, longer
  // clock releases on the reading alone. Without this the hold could lag indefinitely,
  // which is the one failure the doctrine does not forgive.
  const easedSince = easing ? (typeof prev.easedSince === 'number' ? prev.easedSince : nowMs) : null
  const valveMet = easedSince != null && nowMs - easedSince >= HOLD_MAX_MS
  return { holding: !(dwellMet || valveMet), calmSince, easedSince }
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

// ---- What the weather takes off the table (v2.27.0) -------------------------------
// The emoji row used to list what you COULD do — 🚶🏃🏊 on a perfect day. Inverted, it
// lists what you can't, and a perfect day costs zero pixels: an empty row IS the good
// news, and every icon that does appear is worth reading.
//
// Two rules keep it honest:
//   1. Never duplicate the headline. There is no 🚶 here, because "can I walk" is
//      precisely what GEMMA RAUS / BLEIB DRIN already answers.
//   2. Only cross what the WEATHER took, not what the season took. "Too cold to swim"
//      in January is not news, it is winter — and an icon that sits crossed for eight
//      months is one nobody sees any more. So nothing here keys on temperature.
export const ACTIVITIES = ['swim', 'run', 'bike', 'moto', 'picnic']

// The one activity still ruled out after the rain stops: the grass stays wet. That is
// why picnic earns a slot — it carries information in the exact state where the row
// would otherwise be empty (GEMMA RAUS, twenty minutes after a shower). Deliberately
// NOT RECENT_RAIN_MS (15 min): that constant is tuned for wording ("rain back soon"),
// and reusing a constant tuned for another job is what produced the v2.17.0 and
// v2.21.0 incidents. Starting value — expect to tune once it has seen real afternoons.
export const WET_GROUND_MS = 90 * 60 * 1000

// `moto` is the EXISTING motorbike glance (v2.11.0) — true when it is dry for the next
// 30 min. Inverted it means "motorbike is off", and because every non-GO state already
// hardcodes moto:false, WAIT and STUCK cross it out with no extra logic at all.
export function blockedActivities({
  code = -1, wind = 0, moto = false, state = 'go', night = false,
  stormNearby = false, iceWarning = false, wetGround = false,
} = {}) {
  if (night) return []                       // nobody is deciding about swimming at 3am
  const out = new Set()
  const add = (...a) => a.forEach(x => out.add(x))

  // DANGER is the one state where a wall of crosses IS the message.
  if (state === 'danger') return [...ACTIVITIES]

  // `stormNearby` is regionalFullStorm (code >= 95) or a dual-confirmed forming storm —
  // NOT regionalThunder, which is code >= 80 and so includes ordinary rain showers.
  // Crossing out swimming on every showery afternoon would make the row meaningless.
  const lightning = (code >= 95 && code <= 99) || stormNearby
  const hail      = code === 96 || code === 99
  const snow      = (code >= 71 && code <= 77) || code === 85 || code === 86
  const ice       = code === 66 || code === 67 || iceWarning
  const gale      = (wind ?? 0) >= 50         // same threshold as the storm banner

  if (lightning || hail) add('swim', 'run', 'bike', 'moto', 'picnic')
  if (snow) add('bike', 'moto', 'picnic')
  if (ice)  add('bike', 'moto')
  if (gale) add('bike', 'moto', 'picnic')

  // Rain tier — skipped in BLEIB DRIN, where "stay in" already says all of this and a
  // full row of crosses would be noise rather than information. Hazards above still
  // show, because they matter even for a dash to the car.
  if (state !== 'stuck') {
    if (!moto) add('moto', 'picnic')
    if (wetGround) add('picnic')
  }

  return ACTIVITIES.filter(a => out.has(a))   // fixed order — icons never re-sort
}

// Shared band logic for both the translated note (getWeatherNote) and its emoji
// (getWeatherEmoji) — kept as ONE function so the two can never drift apart into
// showing an emoji for one band and text for another.
function weatherNoteKey(weather, { night = false, evening = false, raining = false, rainSoon = false } = {}) {
  if (!weather || weather.temp === null || weather.temp === undefined) return null
  const temp = Math.round(weather.temp)
  const wind = Math.round(weather.wind ?? 0)
  const code = weather.code ?? -1

  // Safety/hazard notes are always shown regardless of time
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    // Snow at night: suppress the "go anyway" encouragement — just skip
    return night ? null : 'weather_snow'
  }
  if (code >= 95 && code <= 99) return 'weather_thunder'
  // "storm — stay inside" only when we're not saying GO. On a dry, windy day the
  // wind banner already warns; the note falls through to the playful "hold your
  // hat" (weather_windy) so it doesn't contradict the GO headline.
  if (wind > 50 && raining) return 'weather_storm'
  if (code === 45 || code === 48) return 'weather_fog'

  // Comfort / "go outside" notes make no sense while it's actively raining — they
  // contradicted the status (e.g. "perfect, no excuse to stay in" showing under a
  // STUCK "wet all the way"). Hazard notes above still surface during rain.
  if (raining) return null

  // Sunny "go out & enjoy" notes contradict an incoming-rain countdown, so skip
  // them when rain is on the way soon. Prep notes (jacket / wind) still apply —
  // useful whether or not rain is coming.
  if (!rainSoon && temp > 33) return night ? null : 'weather_scorching'  // scorching at midnight needs no action
  if (!rainSoon && temp > 29) return night ? null : 'weather_hot'        // hot night, no "go!" advice
  if (wind > 30) return 'weather_windy'
  if (temp < 5)  return 'weather_freezing'
  if (temp < 12) return 'weather_cold'
  // "Perfect weather" is an invitation to go out — only when it's genuinely clear
  // (not overcast, code<=2) AND no rain is imminent, otherwise it contradicts the
  // countdown ("made for going out" while "rain in 10 min") or the cloudy banner.
  if (!rainSoon && !night && !evening && temp >= 22 && temp <= 29 && wind < 20 && code <= 2) {
    return 'weather_perfect'
  }
  return null
}

function getWeatherNote(weather, t, opts) {
  const key = weatherNoteKey(weather, opts)
  if (!key) return null
  return t(key, { temp: Math.round(weather.temp), wind: Math.round(weather.wind ?? 0) })
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
// v2.29.0 — the magnitude a HEAVY, wide RainViewer echo asserts when the gauge has
// not tipped yet. Deliberately the same 0.8 as the backend's VIRGA_HEAVY_PASS, which
// already encodes "echo at this strength is real weather, not virga": we are not
// claiming a measured mm figure from a colour ramp, we are asserting a CLASS —
// clearly past the light band, so the verdict can reach WAIT/BLEIB DRIN.
export const RV_HEAVY_MM = 0.8
const RAIN_PROB_MIN = 50  // model rain probability below this → soften the radar countdown
const RAIN_SOON_NOTE = 90 // rain within this many min → drop the "go out & enjoy" weather notes
const FAR_RAIN_MIN = 90   // rain ≥ this far out → speak in hours ("rain in about 2 h"),
                          // so the countdown covers the FULL horizon (gaps-first philosophy:
                          // the ribbon showing a 3h-out band while the sub says nothing
                          // — or a timeless "possible later" — undersold the window)

const MOTO_SAFE_MIN = 30 // a rider only needs the next half hour, not the whole afternoon — a
                          // narrower, separate promise from RAIN_SOON_NOTE above (see motoSafe)

// Motorbike glance (v2.11): "is it dry enough for a ~30-min ride RIGHT NOW" — deliberately
// stricter and narrower than rainSoon/RAIN_SOON_NOTE, which governs the "go enjoy your
// afternoon" comfort notes and rightly stays quiet on any 90-min-out signal. A rider only
// cares about the next half hour, so this checks its own window instead of reusing that flag.
// Any signal without a quantified ETA (rvNearbyDir, traceEcho — real radar echo close by or
// already falling, but no proven arrival time) counts as "inside the window": never claim a
// dry ride when a source can't rule out rain in the next 30 min (leads forgiven, lags never).
function minutesToNextRain(trend, firstGap, gapNow, nowSec) {
  const mins = []
  if (gapNow && firstGap) {
    mins.push((firstGap.startsAt + firstGap.durationMinutes * 60 - nowSec) / 60)
  }
  if (trend.nextRainAt != null) mins.push((trend.nextRainAt - nowSec) / 60)
  if (trend.modelRainAt != null) mins.push((trend.modelRainAt - nowSec) / 60)
  if (trend.downpourSoonMin != null) mins.push(trend.downpourSoonMin)
  if (trend.rvApproachMin != null) mins.push(trend.rvApproachMin)
  if (trend.traceAheadMin != null) mins.push(trend.traceAheadMin)
  if (trend.traceEcho) mins.push(0)
  if (trend.rvNearbyDir != null) mins.push(0)
  return mins.length ? Math.min(...mins) : Infinity
}

// 90 → "1½", 120 → "2", 150 → "2½", 170 → "3" — rounded to the nearest half hour.
// Exported since v2.18.0 so the ribbon's radar-zone label uses the SAME rounding
// convention the countdowns do.
export function hoursLabel(min) {
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
    if (trend.easeSoonMin != null) {
      sub = t('n_stuck_easing', { min: Math.max(5, Math.round(trend.easeSoonMin / 5) * 5) })
    } else if (trend.modelEaseAt) {
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
    return { type: 'loading', headline: t('checking'), sub: t('reading_sky'), weather: null, moto: false }
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
  // "Go" covers both a started gap and a trace reading below LIGHT_MIN (see the
  // early-return below) — computed once here so the moto glance matches exactly
  // what will actually be returned as type 'go'.
  const goNow = gapNow || currentPrecip < LIGHT_MIN
  const motoSafe = goNow && minutesToNextRain(trend, firstGap, gapNow, nowSec) >= MOTO_SAFE_MIN

  // Weather note needs to know if we're heading out (dry/go) or stuck in the rain,
  // so the "go outside" comfort lines don't contradict a WAIT/STUCK headline; and
  // whether rain is imminent, so "made for going out" doesn't run under a countdown.
  // v2.6: "imminent" includes every radar rain-in-sight signal, not just a hard
  // nextRainAt — "suspiciously perfect, go before the sky changes its mind" was
  // showing right under "drizzle possible in 20 min". Any tier that puts rain in
  // the sub-line must also silence the invitation notes.
  const rainInSight = trend.downpourSoonMin != null || trend.rvApproachMin != null ||
                      trend.rvNearbyDir != null || !!trend.traceEcho ||
                      trend.traceAheadMin != null
  const rainSoon = rainInSight ||
    (trend.nextRainAt != null && (trend.nextRainAt - nowSec) <= RAIN_SOON_NOTE * 60)
  const weatherOpts = { night, evening, raining: !(isDry || gapNow), rainSoon }
  const weatherNote = getWeatherNote(weather, t, weatherOpts)

  // ---- Usable-window rule (v2.19.0) — see goWindowTooShort above ----
  // Lives HERE rather than in App.jsx's display layer (where redWarning/stormImminent
  // sit) because this IS a rain decision, not an external alert: putting it in the
  // state machine means the map dots and the popup notices get it too, so the map
  // can't contradict the headline where you stand — and it's unit-testable.
  const goOrLight = (isDry || gapNow) ? 'go' : (currentPrecip < LIGHT_MAX ? 'light' : null)
  if (goOrLight && goWindowTooShort(goOrLight, trend.downpourSoonWideMin, trend.windowWetMm,
                                    currentPrecip >= DRY_THRESHOLD, trend.noUsableWindow)) {
    // Three ways to be too wet to go out, three sentences. A burst gets a countdown
    // ("heavy rain in ~X min"). A closing window keeps the countdown but says what it
    // is — the minutes you have left, not the minutes until something. Steady rain has
    // no single moment to count down TO, so it names the amount instead.
    const burst = typeof trend.downpourSoonWideMin === 'number'
    // A BLEIB DRIN under a dry sky has to explain itself, or it just looks broken.
    // Only when it is actually dry ON THE GROUND, though: the radar can read dry while
    // the gauge is already measuring drizzle, and "only ~20 min dry" is a strange thing
    // to tell someone who is currently getting wet.
    const closing = trend.noUsableWindow && trend.nextRainAt != null &&
                    currentPrecip < DRY_THRESHOLD
    // v2.26.0: this branch returns EARLY, so it never reached the easing wording below
    // and answered a visibly slackening sky with "rain right through the next 45 min".
    // Live case: 2.12 mm/15min dropping to 0.13–0.26 for two and a half hours — every
    // one of those slots inside the band we ourselves call "go anyway" — and the app
    // had nothing to say about it. The STATE is untouched (v2.24.0's decision stands,
    // the conservative direction); only the sentence gets the timing it already knew.
    const easeMin = trend.easeSoonMin != null
      ? Math.max(5, Math.round(trend.easeSoonMin / 5) * 5) : null
    return {
      type: 'stuck',
      headline: t('STUCK'),
      sub: burst
        ? t('short_window_sub', { min: trend.downpourSoonWideMin })
        : closing
        ? t('s_no_window', { min: Math.max(5, Math.round((trend.nextRainAt - nowSec) / 60 / 5) * 5) })
        : easeMin != null
        ? t(((weather?.code ?? -1) >= 95 && (weather?.code ?? -1) <= 99)
            ? 's_stuck_storm_easing' : 's_stuck_easing', { min: easeMin })
        : t('window_wet_sub', { min: GO_MIN_WINDOW }),
      weather: weatherNote,
      moto: false,
      notice: noticeFor('stuck', currentPrecip, firstGap, trend, nowSec, t),
    }
  }

  // ---- Held BLEIB DRIN (v2.22.0) — see settleStuckHold above ----
  // We said "no break in sight" and the reading has now turned calm. Until that calm
  // is a usable window, corroborated and held for two cycles, we do NOT flip the
  // headline — but we say what we're seeing, because sitting silently on improving
  // radar is its own kind of lie. The user's words: "I should have seen more like
  // stuck inside, but soon there might be a gap or soon it might calm down a little".
  // Only ever converts a go/light candidate; wait and stuck return untouched, so this
  // can never delay an escalation.
  if (goOrLight && trend.heldStuck) {
    return {
      type: 'stuck',
      headline: t('STUCK'),
      sub: t(trend.releaseOk ? 's_stuck_clearing' : 's_stuck_softening'),
      weather: weatherNote,
      moto: false,
      notice: { head: t('n_raining'), sub: t('n_stuck_softening') },
    }
  }

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
    return { type: 'go', headline: t('GO_NOW'), sub, weather: weatherNote, moto: motoSafe, notice: noticeFor('go', currentPrecip, firstGap, trend, nowSec, t) }
  }

  // Trace drizzle (< 0.2 mm) → still GO. A 0.1 mm tip must not flip GEMMA RAUS ↔
  // GO ANYWAY; only a genuine ≥0.2 mm drizzle earns the light state (litigated, kept).
  if (currentPrecip < LIGHT_MIN) {
    // v2.20.0: the STATE stays GO (anti-flicker, as above) but the SUB must not lie.
    // DRY_THRESHOLD..LIGHT_MIN (0.1–0.2) is a real reading — the gauge is measuring
    // rain — and this branch was answering it with `s_dry_generic`, literally "no
    // rain right now". Reported from Nonntal with the gauge at exactly 0.1: "now it
    // says no rain at my spot and gemma raus whyyyy". Dry-enough to go is a fair
    // verdict; "no rain" is not a fair description of 0.1 mm falling on you.
    const sub = currentPrecip >= DRY_THRESHOLD
      ? t('s_barely_drizzle')
      : t(night ? 's_night_dry' : evening ? 's_evening_dry' : 's_dry_generic')
    return { type: 'go', headline: t('GO_NOW'), sub, weather: weatherNote, moto: motoSafe, notice: noticeFor('go', currentPrecip, firstGap, trend, nowSec, t) }
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
    return { type: 'light', headline: t('LIGHT_RAIN'), sub, weather: weatherNote, moto: false, notice: noticeFor('light', currentPrecip, firstGap, trend, nowSec, t) }
  }

  // ---- Raining now: narrate the break ahead ----
  if (firstGap) {
    const clearInMin = Math.max(0, Math.round((firstGap.startsAt - nowSec) / 60))
    // Under 5 min the exact minute is noise — drop the number and go soft.
    const soon = clearInMin < SOON_MIN
    const headline = soon ? t('WAIT_SOON') : t('WAIT_MIN', { min: clearInMin })
    const sub = night ? t('s_night_raining') : breakSub(firstGap, nowSec, t)
    return { type: 'wait', headline, sub, weather: weatherNote, moto: false, notice: noticeFor('wait', currentPrecip, firstGap, trend, nowSec, t) }
  }

  const isThunder = (weather?.code ?? -1) >= 95 && (weather?.code ?? -1) <= 99
  // Model ease second-opinion (v2.1): STUCK means "radar sees no break" — if the
  // model shows the rain ending within 3 h, say so instead of a bare "stay in".
  // Wording only; the state (and colour) stays STUCK until radar confirms a gap.
  // v2.26.0: the radar's own easing time, rounded like every other countdown. Beats
  // the model second opinion below — radar owns the next 3 h, and this is observed
  // echo rather than a model guess.
  const easeMin = trend.easeSoonMin != null
    ? Math.max(5, Math.round(trend.easeSoonMin / 5) * 5) : null
  let stuckSub
  if (isThunder) {
    // Thunder still owns the sentence — it is a hazard, not a rain intensity, and
    // "light enough to go" during lightning is not a thing we will ever say. But it
    // no longer SWALLOWS the timing: the storm stays named, the easing gets its
    // minutes, and the state stays BLEIB DRIN either way.
    stuckSub = easeMin != null ? t('s_stuck_storm_easing', { min: easeMin }) : t('s_stuck_storm')
  } else if (easeMin != null) {
    stuckSub = t('s_stuck_easing', { min: easeMin })
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
    moto: false,
    notice: noticeFor('stuck', currentPrecip, firstGap, trend, nowSec, t),
  }
}
