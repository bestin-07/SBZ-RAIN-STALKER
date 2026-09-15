// LOGIC INTEGRITY GUARD — the intended rain logic as an executable contract.
//
// These tests encode the DESIGNED behaviour of the decision tree (CLAUDE.md →
// "Status Logic" + "Logic change log"). If a change breaks one of these, either the
// change is a bug — or the intent itself changed, in which case update the test AND
// the CLAUDE.md logic log together. Never silently.
//
// Run: npm test   (vitest)
import { describe, it, expect } from 'vitest'
import {
  detectGaps, getStatus, firstDownpourMin, surfaceDrizzle, isUnsettled, modelNextRainAt,
  modelNowValue, MODEL_NOW_CAP, MODEL_HEAVY_PASS, nowcastNowSlot, gaugeSlotValue, GAUGE_SLOT_SCALE,
  aromeSlotSeries, modelsAgree, MODEL_AGREE_FACTOR, probAt, radarSpanLabel,
  goWindowTooShort, GO_MIN_WINDOW, windowWetMm, WINDOW_WET_MM,
  dryWindowOpen, settleStuckHold, CALM_DWELL_MS, HOLD_STALE_MS, HOLD_MAX_MS,
  hasUsableWindow, GO_MIN_SLOTS, easesToGoableMin,
  blockedActivities, ACTIVITIES, WET_GROUND_MS,
  showGhost, GHOST_MIN_FACTOR, hoursLabel,
  modelEaseAt, MODEL_EASE_MIN_DRY, hasTraceEcho, traceAheadMin, tracePhantom,
  ringDirection, combineModelSeries,
  DRY_THRESHOLD, LIGHT_MIN, LIGHT_MAX, DOWNPOUR_MM, DOWNPOUR_WINDOW_MIN,
  UNSETTLED_CAPE, UNSETTLED_PROB, RV_SOLID_COVERAGE,
  rvNowValue, RV_HEAVY_MM,
  dayBuckets, bestWindow, preferWindow, weatherGroup, radarZoneEnd, hasRadarZone, MIN_RADAR_ZONE_MIN, LOOK_AHEAD, HOUR_TO_SLOT, DAY_BUCKETS, BEST_WINDOW_MIN_H,
} from './gaps'

// ---- helpers ---------------------------------------------------------------

// nowSec at a chosen LOCAL hour (getStatus derives night/evening from local time).
function atHour(h, min = 0) {
  const d = new Date()
  d.setHours(h, min, 0, 0)
  return Math.floor(d.getTime() / 1000)
}
const NOON = atHour(13)      // plain daytime
const NIGHT = atHour(3)      // 00:00–04:59 → night wording
const EVENING = atHour(20)   // ≥18:00 → evening wording

// t() that records interpolation vars so we can assert rounded ETAs etc.
function makeT() {
  const calls = []
  const t = (k, vars) => { calls.push([k, vars]); return k }
  t.calls = calls
  t.varsFor = key => (calls.filter(c => c[0] === key).pop() || [])[1]
  return t
}

// 15-min slot timeline builder anchored at `nowSec` (for getStatus/firstDownpourMin).
function timeline(nowSec, precips) {
  return { times: precips.map((_, i) => nowSec + i * 900), precips }
}

// detectGaps reads Date.now() internally — build its timelines from the real clock.
function liveTimeline(precips) {
  const now = Math.floor(Date.now() / 1000)
  return { times: precips.map((_, i) => now + i * 900), precips }
}

const noTrend = {}

// ---- thresholds: the contract values themselves ------------------------------

describe('threshold contract (change ONLY with a logic-log entry)', () => {
  it('dry below 0.1, trace-GO below 0.2, light band 0.2–0.5', () => {
    expect(DRY_THRESHOLD).toBe(0.1)
    expect(LIGHT_MIN).toBe(0.2)
    expect(LIGHT_MAX).toBe(0.5)
  })
  it('downpour warning: ≥1.5mm within 30 min', () => {
    expect(DOWNPOUR_MM).toBe(1.5)
    expect(DOWNPOUR_WINDOW_MIN).toBe(30)
  })
})

// ---- detectGaps ---------------------------------------------------------------

describe('detectGaps — dry-window detection (GeoSphere 15-min slots)', () => {
  it('bone-dry 3h (typical clear Salzburg afternoon) → open-ended gap + dryEndsOpen', () => {
    const { times, precips } = liveTimeline([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const r = detectGaps(times, precips)
    expect(r.currentPrecip).toBe(0)
    expect(r.dryEndsOpen).toBe(true)
    expect(r.gaps.length).toBeGreaterThan(0)
    expect(r.gaps[0].opensEnded).toBe(true)
  })

  it('raining now, 30-min break, then rain again → exactly one gap of 30 min', () => {
    const { times, precips } = liveTimeline([1.2, 1.0, 0, 0, 0.8, 1.5, 1.1, 0.9])
    const r = detectGaps(times, precips)
    expect(r.gaps.length).toBe(1)
    expect(r.gaps[0].durationMinutes).toBe(30)
    expect(r.gaps[0].opensEnded).toBe(false)
  })

  it('a single 15-min dry slot is NOISE, not a promised break', () => {
    const { times, precips } = liveTimeline([1.2, 0, 1.0, 1.4, 1.1, 0.8])
    const r = detectGaps(times, precips)
    expect(r.gaps.length).toBe(0)
  })

  it('dry now with rain arriving → nextRainAt set even without a full gap', () => {
    const { times, precips } = liveTimeline([0, 0, 0.9, 1.2, 1.0, 0.8])
    const r = detectGaps(times, precips)
    expect(r.currentPrecip).toBe(0)
    expect(r.nextRainAt).toBe(times[2])
    expect(r.dryEndsOpen).toBe(false)
  })

  it('empty timeline → currentPrecip null (CHECKING state upstream)', () => {
    const r = detectGaps([], [])
    expect(r.currentPrecip).toBeNull()
    expect(r.gaps).toEqual([])
  })
})

// ---- getStatus: the four verdicts ------------------------------------------------

describe('getStatus — GO (GEMMA RAUS)', () => {
  it('null precip → CHECKING', () => {
    const s = getStatus(null, [], null, makeT(), NOON, noTrend)
    expect(s.type).toBe('loading')
  })

  it('dry all 3h → "clear for hours"', () => {
    const s = getStatus(0, [], null, makeT(), NOON, { dryEndsOpen: true })
    expect(s.type).toBe('go')
    expect(s.sub).toBe('s_clear_hours')
  })

  it('rain in 7 min (confident) → "any minute", NO false-precise number', () => {
    const s = getStatus(0, [], null, makeT(), NOON, { nextRainAt: NOON + 7 * 60, rainProb: 80 })
    expect(s.type).toBe('go')
    expect(s.sub).toBe('s_rain_any')
  })

  it('rain in 47 min (confident) → "about X min" ROUNDED to nearest 5 (45)', () => {
    const t = makeT()
    const s = getStatus(0, [], null, t, NOON, { nextRainAt: NOON + 47 * 60, rainProb: 80 })
    expect(s.sub).toBe('s_rain_soon')
    expect(t.varsFor('s_rain_soon').min).toBe(45)
  })

  it('radar says rain but model probability <50 → soften to "rain possible later"', () => {
    const s = getStatus(0, [], null, makeT(), NOON, { nextRainAt: NOON + 40 * 60, rainProb: 30 })
    expect(s.sub).toBe('s_rain_maybe')
  })

  it('FAR rain (≥90 min) ALWAYS gets a countdown, in hours — the window is the product', () => {
    const t = makeT()
    const s = getStatus(0, [], null, t, NOON, { nextRainAt: NOON + 170 * 60, rainProb: 80 })
    expect(s.sub).toBe('s_rain_far')
    expect(t.varsFor('s_rain_far').h).toBe('3')          // 170 min → "about 3 h"
  })

  it('FAR rain with low confidence keeps the time, softens the wording (the Nonntal 3h case)', () => {
    const t = makeT()
    const s = getStatus(0, [], null, t, NOON, { nextRainAt: NOON + 125 * 60, rainProb: 25 })
    expect(s.sub).toBe('s_rain_far_maybe')               // NOT the timeless "possible later"
    expect(t.varsFor('s_rain_far_maybe').h).toBe('2')    // 125 min → "about 2 h"
  })

  it('90 min is the far boundary → "about 1½ h"', () => {
    const t = makeT()
    const s = getStatus(0, [], null, t, NOON, { nextRainAt: NOON + 90 * 60, rainProb: 80 })
    expect(s.sub).toBe('s_rain_far')
    expect(t.varsFor('s_rain_far').h).toBe('1½')
  })

  it('map-popup notice also carries the far countdown', () => {
    const t = makeT()
    const s = getStatus(0, [], null, t, NOON, { nextRainAt: NOON + 170 * 60, rainProb: 25 })
    expect(s.notice.sub).toBe('n_rain_far')
    expect(t.varsFor('n_rain_far').h).toBe('3')
  })

  it('recent rain + rain returning ≥10min → framed as "short break — rain back"', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { nextRainAt: NOON + 20 * 60, rainProb: 80, recentRain: true })
    expect(s.sub).toBe('s_rain_back')
  })

  it('TRACE drizzle (0.15) stays GEMMA RAUS — the anti-flicker buffer', () => {
    const s = getStatus(0.15, [], null, makeT(), NOON, noTrend)
    expect(s.type).toBe('go')
  })

  it('gap already started → GO even if a station reading lags wet', () => {
    const gap = { startsAt: NOON - 60, startsInMinutes: 0, durationMinutes: 45, opensEnded: false }
    const s = getStatus(1.2, [gap], null, makeT(), NOON, { rvRainActive: false })
    expect(s.type).toBe('go')
  })

  it('…but RainViewer confirming rain overhead BLOCKS that gapNow override', () => {
    const gap = { startsAt: NOON - 60, startsInMinutes: 0, durationMinutes: 45, opensEnded: false }
    const s = getStatus(1.2, [gap], null, makeT(), NOON, { rvRainActive: true })
    expect(s.type).not.toBe('go')
  })
})

describe('getStatus — LIGHT (PASST SCHON / GO ANYWAY)', () => {
  it('0.3mm drizzle, nothing ahead → light state, "just a drizzle"', () => {
    const s = getStatus(0.3, [], null, makeT(), NOON, noTrend)
    expect(s.type).toBe('light')
    expect(s.sub).toBe('s_light')
  })

  it('drizzle clearing in ~40 min → forward context, rounded to 5', () => {
    const t = makeT()
    const gap = { startsAt: NOON + 40 * 60, startsInMinutes: 40, durationMinutes: 60, opensEnded: false }
    const s = getStatus(0.3, [gap], null, t, NOON, noTrend)
    expect(s.type).toBe('light')
    expect(s.sub).toBe('s_light_clearing')
    expect(t.varsFor('s_light_clearing').min).toBe(40)
  })

  it('night drizzle → cosy drizzle wording, NEVER "raining" under GO ANYWAY', () => {
    const s = getStatus(0.3, [], null, makeT(), NIGHT, noTrend)
    expect(s.type).toBe('light')
    expect(s.sub).toBe('s_night_drizzle')
  })

  it('0.5mm is NOT light anymore (band is exclusive at the top)', () => {
    const s = getStatus(0.5, [], null, makeT(), NOON, noTrend)
    expect(s.type).not.toBe('light')
  })
})

describe('getStatus — imminent-downpour warning (the Nonntal soaking fix)', () => {
  // v2.19 CHANGED THE INTENT HERE. These used to assert GO / GO ANYWAY with a
  // heavy-rain SUB. In production that combination no longer occurs: a downpour
  // inside DOWNPOUR_WINDOW_MIN (30) is necessarily inside GO_MIN_WINDOW (45) too,
  // so downpourSoonWideMin is always set alongside downpourSoonMin and the
  // usable-window rule escalates to BLEIB DRIN before these subs are reached.
  // The old sub path is kept in gaps.js purely as a fallback for a trend object
  // that lacks the wide value (a stale cached trend, the initial empty state), and
  // is exercised as such below — never as the shape real data produces.

  it('dry now but downpour in 12 min → BLEIB DRIN (was GO + heavy-rain sub)', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { dryEndsOpen: true, downpourSoonMin: 12, downpourSoonWideMin: 12 })
    expect(s.type).toBe('stuck')
    expect(s.sub).toBe('short_window_sub')
  })

  it('drizzling now + downpour in 8 min → BLEIB DRIN (was GO ANYWAY + warning)', () => {
    const s = getStatus(0.3, [], null, makeT(), NOON,
      { downpourSoonMin: 8, downpourSoonWideMin: 8 })
    expect(s.type).toBe('stuck')
    expect(s.sub).toBe('short_window_sub')
  })

  it('FALLBACK ONLY (no wide value in trend): old GO + heavy-rain sub still works', () => {
    const s = getStatus(0, [], null, makeT(), NOON, { dryEndsOpen: true, downpourSoonMin: 12 })
    expect(s.type).toBe('go')
    expect(s.sub).toBe('s_downpour_soon')   // outranks "clear for hours"
    expect(s.notice.sub).toBe('n_downpour_soon')
  })
})

describe('getStatus — WAIT', () => {
  it('raining, break in ~40 min → WAIT X MIN + "break opens" sub', () => {
    const t = makeT()
    const gap = { startsAt: NOON + 40 * 60, startsInMinutes: 40, durationMinutes: 45, opensEnded: false }
    const s = getStatus(1.2, [gap], null, t, NOON, noTrend)
    expect(s.type).toBe('wait')
    expect(s.headline).toBe('WAIT_MIN')
    expect(t.varsFor('WAIT_MIN').min).toBe(40)
    expect(s.sub).toBe('s_break_opens')
  })

  it('clears in <5 min → soft "ALMOST OUT", no false-precise minute', () => {
    const gap = { startsAt: NOON + 3 * 60, startsInMinutes: 3, durationMinutes: 45, opensEnded: false }
    const s = getStatus(1.2, [gap], null, makeT(), NOON, noTrend)
    expect(s.type).toBe('wait')
    expect(s.headline).toBe('WAIT_SOON')
  })

  it('open-ended clearing → "rain ending in X"', () => {
    const gap = { startsAt: NOON + 30 * 60, startsInMinutes: 30, durationMinutes: 150, opensEnded: true }
    const s = getStatus(1.2, [gap], null, makeT(), NOON, noTrend)
    expect(s.sub).toBe('s_clearing')
  })

  it('FAR break (≥60 min) is softened — "break likely", time kept (skill decays past 1h)', () => {
    const t = makeT()
    const gap = { startsAt: NOON + 75 * 60, startsInMinutes: 75, durationMinutes: 45, opensEnded: false }
    const s = getStatus(1.2, [gap], null, t, NOON, noTrend)
    expect(s.type).toBe('wait')
    expect(s.sub).toBe('s_break_likely')                 // softened, NOT the firm form
    expect(t.varsFor('s_break_likely').min).toBe(75)     // …but the time is kept
    expect(s.notice.sub).toBe('n_break_likely')          // popup notice softened too
  })

  it('FAR open-ended clearing is softened — "rain should end in X"', () => {
    const gap = { startsAt: NOON + 90 * 60, startsInMinutes: 90, durationMinutes: 90, opensEnded: true }
    const s = getStatus(1.2, [gap], null, makeT(), NOON, noTrend)
    expect(s.sub).toBe('s_clearing_far')
  })

  it('NEAR break (40 min) stays FIRM — under an hour the radar earns full confidence', () => {
    const gap = { startsAt: NOON + 40 * 60, startsInMinutes: 40, durationMinutes: 45, opensEnded: false }
    const s = getStatus(1.2, [gap], null, makeT(), NOON, noTrend)
    expect(s.sub).toBe('s_break_opens')
  })
})

describe('getStatus — STUCK (BLEIB DRIN)', () => {
  it('raining with no ≥30-min break in 3h → STUCK', () => {
    const s = getStatus(1.8, [], null, makeT(), NOON, noTrend)
    expect(s.type).toBe('stuck')
    expect(s.sub).toBe('s_stuck')
  })

  it('thunderstorm (WMO 96) → storm-specific sub', () => {
    const s = getStatus(4.0, [], { temp: 18, wind: 20, code: 96 }, makeT(), NOON, noTrend)
    expect(s.type).toBe('stuck')
    expect(s.sub).toBe('s_stuck_storm')
  })
})

describe('getStatus — weather notes (never contradict the verdict)', () => {
  it('perfect summer day (25°C, calm, clear, dry) → "made for going out"', () => {
    const s = getStatus(0, [], { temp: 25, wind: 5, code: 0 }, makeT(), NOON, { dryEndsOpen: true })
    expect(s.weather).toBe('weather_perfect')
  })

  it('same weather but rain <90 min away → comfort note SUPPRESSED', () => {
    const s = getStatus(0, [], { temp: 25, wind: 5, code: 0 }, makeT(), NOON,
      { nextRainAt: NOON + 30 * 60, rainProb: 80 })
    expect(s.weather).toBeNull()
  })

  it('raining → comfort notes suppressed entirely', () => {
    const s = getStatus(1.2, [], { temp: 25, wind: 5, code: 61 }, makeT(), NOON, noTrend)
    expect(s.weather).toBeNull()
  })

  it('thunder hazard ALWAYS shows, even while raining — but with no emoji (a warning, not an invitation)', () => {
    const s = getStatus(1.2, [], { temp: 18, wind: 20, code: 95 }, makeT(), NOON, noTrend)
    expect(s.weather).toBe('weather_thunder')
  })

  it('overcast 25°C is NOT "perfect" (needs clear sky, code ≤ 2)', () => {
    const s = getStatus(0, [], { temp: 25, wind: 5, code: 3 }, makeT(), NOON, { dryEndsOpen: true })
    expect(s.weather).not.toBe('weather_perfect')
  })
})

describe('getStatus — comfort notes vs rain in sight (v2.6)', () => {
  // "suspiciously perfect — go before the sky changes its mind" showed right under
  // "drizzle possible in 20 min". ANY radar signal that puts rain in the sub-line
  // must also silence the invitation notes — they contradict each other.
  const perfect = { temp: 25, wind: 5, code: 0 }

  it('trace-ahead countdown in the sub → perfect note suppressed', () => {
    const s = getStatus(0, [], perfect, makeT(), NOON, { dryEndsOpen: true, traceAheadMin: 25 })
    expect(s.sub).toBe('s_trace_ahead')
    expect(s.weather).toBeNull()
  })

  it('trace echo NOW → perfect note suppressed', () => {
    const s = getStatus(0, [], perfect, makeT(), NOON, { dryEndsOpen: true, traceEcho: true })
    expect(s.weather).toBeNull()
  })

  it('nearby ring echo → perfect note suppressed', () => {
    const s = getStatus(0, [], perfect, makeT(), NOON, { dryEndsOpen: true, rvNearbyDir: 'ne' })
    expect(s.weather).toBeNull()
  })

  it('RainViewer approach ETA → perfect note suppressed', () => {
    const s = getStatus(0, [], perfect, makeT(), NOON, { rvApproachMin: 25 })
    expect(s.weather).toBeNull()
  })

  it('downpour warning → perfect note suppressed', () => {
    const s = getStatus(0, [], perfect, makeT(), NOON, { downpourSoonMin: 20 })
    expect(s.weather).toBeNull()
  })

  it('hot-day "go out" note is suppressed the same way', () => {
    const s = getStatus(0, [], { temp: 31, wind: 5, code: 0 }, makeT(), NOON,
      { dryEndsOpen: true, traceAheadMin: 25 })
    expect(s.weather).toBeNull()
  })

  it('PREP notes (wind) still show — a jacket helps whether or not drizzle comes', () => {
    const s = getStatus(0, [], { temp: 25, wind: 35, code: 0 }, makeT(), NOON,
      { dryEndsOpen: true, traceAheadMin: 25 })
    expect(s.weather).toBe('weather_windy')
  })

  it('regression: NO signals + all-clear → perfect note still shows', () => {
    const s = getStatus(0, [], perfect, makeT(), NOON, { dryEndsOpen: true })
    expect(s.weather).toBe('weather_perfect')
  })

  it('regression: rain far away (nextRainAt in 3h, no radar signals) → note still shows', () => {
    const s = getStatus(0, [], perfect, makeT(), NOON, { nextRainAt: NOON + 180 * 60 })
    expect(s.weather).toBe('weather_perfect')
  })
})

describe('getStatus — moto glance (v2.11): "dry enough for a 30-min ride NOW"', () => {
  it('bone dry, nothing on any radar signal → moto true', () => {
    const s = getStatus(0, [], null, makeT(), NOON, noTrend)
    expect(s.moto).toBe(true)
  })

  it('dry now but rain due in 20 min (< 30) → moto false, even though it is GO', () => {
    const s = getStatus(0, [], null, makeT(), NOON, { nextRainAt: NOON + 20 * 60 })
    expect(s.type).toBe('go')
    expect(s.moto).toBe(false)
  })

  it('dry now, rain due in 45 min (≥ 30) → moto true — the narrower 30-min promise,\n' +
     '   independent of the 90-min "go enjoy" comfort-note suppression', () => {
    const s = getStatus(0, [], { temp: 25, wind: 5, code: 0 }, makeT(), NOON, { nextRainAt: NOON + 45 * 60 })
    expect(s.type).toBe('go')
    // The 90-min rainSoon gate still (correctly) suppresses the "perfect, go enjoy" note...
    expect(s.weather).toBeNull()
    // ...but 45 min is still a genuinely safe 30-min ride window — the icon row
    // would show just 🏍️ alone, with no comfort emoji alongside it.
    expect(s.moto).toBe(true)
  })

  it('a started gap that closes again in 10 min (< 30 min remaining) → moto false', () => {
    const gap = { startsAt: NOON - 5 * 60, startsInMinutes: -5, durationMinutes: 30, opensEnded: false }
    const s = getStatus(0.3, [gap], null, makeT(), NOON, noTrend)
    expect(s.type).toBe('go')  // gapNow promotes this to GO
    expect(s.moto).toBe(false) // but only 25 min of the 30-min gap remain
  })

  it('a started gap with 40 min still remaining → moto true', () => {
    const gap = { startsAt: NOON - 5 * 60, startsInMinutes: -5, durationMinutes: 45, opensEnded: false }
    const s = getStatus(0.3, [gap], null, makeT(), NOON, noTrend)
    expect(s.type).toBe('go')
    expect(s.moto).toBe(true)
  })

  it('unquantified nearby radar echo (no ETA) → moto false, conservative by design', () => {
    const s = getStatus(0, [], null, makeT(), NOON, { rvNearbyDir: 'ne' })
    expect(s.type).toBe('go')
    expect(s.moto).toBe(false)
  })

  it('patchy trace echo happening right now → moto false', () => {
    const s = getStatus(0, [], null, makeT(), NOON, { dryEndsOpen: true, traceEcho: true })
    expect(s.moto).toBe(false)
  })

  it('actively drizzling (LIGHT state) → moto false regardless of what follows', () => {
    const s = getStatus(0.3, [], null, makeT(), NOON, noTrend)
    expect(s.type).toBe('light')
    expect(s.moto).toBe(false)
  })

  it('STUCK (raining, no break in 3h) → moto false', () => {
    const s = getStatus(1.8, [], null, makeT(), NOON, noTrend)
    expect(s.type).toBe('stuck')
    expect(s.moto).toBe(false)
  })
})

describe('getStatus — night & evening voice', () => {
  it('clear night (03:00) → cosy night sub', () => {
    const s = getStatus(0, [], null, makeT(), NIGHT, { dryEndsOpen: true })
    expect(s.sub).toBe('s_night_clear')
  })
  it('clear evening (20:00) → wind-down sub', () => {
    const s = getStatus(0, [], null, makeT(), EVENING, { dryEndsOpen: true })
    expect(s.sub).toBe('s_evening_clear')
  })
  it('raining at night with a break ahead → calm night sub, not a sprint countdown', () => {
    const gap = { startsAt: NIGHT + 40 * 60, startsInMinutes: 40, durationMinutes: 45, opensEnded: false }
    const s = getStatus(1.2, [gap], null, makeT(), NIGHT, noTrend)
    expect(s.sub).toBe('s_night_raining')
  })
})

describe('getStatus — map-popup notice voice (passive, never first-person)', () => {
  it('every state carries a notice {head, sub}', () => {
    const gap = { startsAt: NOON + 40 * 60, startsInMinutes: 40, durationMinutes: 45, opensEnded: false }
    const cases = [
      getStatus(0, [], null, makeT(), NOON, { dryEndsOpen: true }),
      getStatus(0.3, [], null, makeT(), NOON, noTrend),
      getStatus(1.2, [gap], null, makeT(), NOON, noTrend),
      getStatus(1.8, [], null, makeT(), NOON, noTrend),
    ]
    for (const s of cases) {
      expect(s.notice).toBeTruthy()
      expect(typeof s.notice.head).toBe('string')
      expect(typeof s.notice.sub).toBe('string')
    }
    expect(cases[0].notice.head).toBe('n_dry')
    expect(cases[1].notice.head).toBe('n_light')
    expect(cases[2].notice.head).toBe('n_raining')
    expect(cases[3].notice.sub).toBe('n_no_break')
  })
})

// ---- surfaceDrizzle — gauge-blind drizzle, but needs radar corroboration ----------

describe('surfaceDrizzle — catch what the gauges miss, reject unsupported RV-only claims', () => {
  // args: (groundPrecip, rawNowSlot [filtered nowcast at now], rvPrecip, weather_code)

  it('THE SUNNY-CLUTTER BUG (v1.1.5): RV-only echo under a clear sky → NOT surfaced', () => {
    // Nonntal, sunny like crazy: gauge 0, nowcast 0, model code 1 (sunny),
    // raw RainViewer pixel shows clutter echo 0.3 → must stay GEMMA RAUS.
    expect(surfaceDrizzle(0, 0, 0.3, 1)).toBeNull()
    expect(surfaceDrizzle(0, 0, 0.3, 0)).toBeNull()
    expect(surfaceDrizzle(0, 0, 0.3, 2)).toBeNull()
  })

  it('THE OVERCAST-CLUTTER BUG (v2.2.1): RV-only echo + a flat, exact-zero radar → NOT surfaced', () => {
    // Real incident, Nonntal: gauge 0.0, radar nowcast an exact 0.0 across the whole
    // 3h window, sky overcast (code 3), yet a raw RainViewer pixel claimed echo → the
    // app said GO ANYWAY while it genuinely was not raining. Overcast alone is not
    // corroboration — zero radar trace anywhere means clutter (terrain reflection /
    // tile noise), regardless of cloud cover. Must stay GEMMA RAUS.
    expect(surfaceDrizzle(0, 0, 0.3, 3)).toBeNull()
    expect(surfaceDrizzle(0, 0, 0.3, 61)).toBeNull()
    // "sky unknown" no longer gets a free pass either — zero corroboration is zero
    // corroboration whether or not we know the sky.
    expect(surfaceDrizzle(0, 0, 0.3, null)).toBeNull()
  })

  it('RV-only echo WITH a non-zero radar trace + non-clear sky → surfaced (real hyperlocal drizzle)', () => {
    // The original Nonntal case this feature was built for: radar shows SOME trace
    // (even sub-threshold) near the RV pixel's reading — independent corroboration —
    // under an overcast sky. That combination is trustworthy.
    expect(surfaceDrizzle(0, 0.03, 0.3, 3)).toBe(0.3)
    expect(surfaceDrizzle(0, 0.05, 0.3, 61)).toBe(0.3)
  })

  it('a radar trace under a CLEAR sky still does not surface an RV-only claim', () => {
    // Clear-sky clutter (anaprop/insects) can itself produce a faint sub-threshold
    // radar blip — the sky guard stays strict regardless of a small trace.
    expect(surfaceDrizzle(0, 0.03, 0.3, 1)).toBeNull()
  })

  it('filtered-nowcast echo AT/ABOVE threshold surfaces even under a clear sky (trusted source)', () => {
    expect(surfaceDrizzle(0, 0.15, 0, 1)).toBe(LIGHT_MIN)   // bumped into the light band
    expect(surfaceDrizzle(0, 0.3, 0, 0)).toBe(0.3)
  })

  it('wet gauge → not our case (ground magnitude rules)', () => {
    expect(surfaceDrizzle(0.3, 0.4, 0.3, 3)).toBeNull()
  })

  it('heavier cell (≥0.5) → keep the ground dry call (never manufacture WAIT/STUCK)', () => {
    expect(surfaceDrizzle(0, 0.8, 0, 3)).toBeNull()
  })

  it('nothing anywhere → null', () => {
    expect(surfaceDrizzle(0, 0, 0, 3)).toBeNull()
  })

  it('surfaced value is always in the light band (≥0.2, <0.5)', () => {
    const v = surfaceDrizzle(0, 0.12, 0, 3)
    expect(v).toBeGreaterThanOrEqual(LIGHT_MIN)
    expect(v).toBeLessThan(LIGHT_MAX)
  })

  // ---- v2.4.1: RainViewer self-corroboration by spatial extent (rvSolid) ----
  // args: (groundPrecip, rawNowSlot, rvPrecip, weather_code, rvSolid)

  it('THE DRIZZLE MISS (2026-07-17): solid RV field + overcast + everything else zero → surfaced', () => {
    // Real incident: live drizzle over the whole city. Gauge 0.0 (accumulates too
    // slowly per interval), INCA current slot exact 0.0 (lagging ~1h behind), model
    // flat 0.00 for 12h, code 3 (overcast). RainViewer was the ONLY witness — echo
    // blooming over the centre block, 24/25 wet pixels — and the v2.2.1 guard vetoed
    // it. A drizzle FIELD is not a clutter pixel: wide coverage is corroboration.
    expect(surfaceDrizzle(0, 0, 0.3, 3, true)).toBe(0.3)
    // exact-zero rawNowSlot passed as null (source down) behaves the same
    expect(surfaceDrizzle(0, null, 0.3, 3, true)).toBe(0.3)
  })

  it('solid RV field under a CLEAR sky → still vetoed (sunny clutter/anaprop can be broad)', () => {
    expect(surfaceDrizzle(0, 0, 0.3, 0, true)).toBeNull()
    expect(surfaceDrizzle(0, 0, 0.3, 1, true)).toBeNull()
    expect(surfaceDrizzle(0, 0, 0.3, 2, true)).toBeNull()
  })

  it('NON-solid RV echo + zero radar + overcast → still vetoed (Nonntal clutter regression stays dead)', () => {
    // The v2.2.1 incident replayed with the new arg explicit: a lone stuck pixel
    // (rvSolid false) must never surface without an independent radar trace.
    expect(surfaceDrizzle(0, 0, 0.3, 3, false)).toBeNull()
    expect(surfaceDrizzle(0, 0, 0.3, null, false)).toBeNull()
  })

  it('rvSolid omitted defaults to false — all pre-2.4.1 behavior unchanged', () => {
    expect(surfaceDrizzle(0, 0, 0.3, 3)).toBeNull()      // overcast-clutter veto holds
    expect(surfaceDrizzle(0, 0.03, 0.3, 3)).toBe(0.3)    // trace corroboration still works
  })

  it('rvSolid never overrides the other guards (wet gauge / heavy cell / nothing)', () => {
    expect(surfaceDrizzle(0.3, 0.4, 0.3, 3, true)).toBeNull()  // gauge already wet
    expect(surfaceDrizzle(0, 0.8, 0, 3, true)).toBeNull()      // heavier cell → dry call stands
    expect(surfaceDrizzle(0, 0, 0, 3, true)).toBeNull()        // no echo value at all
  })

  it('RV_SOLID_COVERAGE contract: 0.4 of the block (change only with a CLAUDE.md log entry)', () => {
    expect(RV_SOLID_COVERAGE).toBe(0.4)
  })
})


// ---- blockedActivities — what the weather takes off the table (v2.27.0) ----------

describe('blockedActivities — an empty row is the good news', () => {
  const B = o => blockedActivities(o)

  it('A PERFECT DAY SHOWS NOTHING AT ALL', () => {
    expect(B({ code: 0, wind: 5, moto: true, state: 'go' })).toEqual([])
  })

  it('thunderstorm crosses out everything exposed (the reported case)', () => {
    expect(B({ code: 95, wind: 5, moto: false, state: 'stuck' }))
      .toEqual(['swim', 'run', 'bike', 'moto', 'picnic'])
  })

  it('a storm NEARBY counts, but ordinary showers nearby do not', () => {
    // stormNearby is regionalFullStorm (code >= 95). If it were regionalThunder
    // (code >= 80) every showery afternoon would cross out swimming.
    expect(B({ code: 61, moto: true, stormNearby: true })).toContain('swim')
    expect(B({ code: 61, moto: true, stormNearby: false })).not.toContain('swim')
  })

  it('snow crosses the wheels, not the swim (the reported case)', () => {
    expect(B({ code: 73, moto: true, state: 'go' })).toEqual(['bike', 'moto', 'picnic'])
  })

  it('rain crosses the motorbike (the reported case) — via the EXISTING moto glance', () => {
    expect(B({ code: 61, moto: false, state: 'light' })).toEqual(['moto', 'picnic'])
    expect(B({ code: 61, moto: true,  state: 'go' })).toEqual([])
  })

  it('strong wind crosses the wheels', () => {
    expect(B({ code: 3, wind: 55, moto: true })).toEqual(['bike', 'moto', 'picnic'])
    expect(B({ code: 3, wind: 45, moto: true })).toEqual([])
  })

  it('WET GROUND: still no picnic after the rain has stopped', () => {
    // The only activity ruled out by rain that has already ended — and the only icon
    // that shows in a state where the row would otherwise be empty.
    expect(B({ code: 3, moto: true, state: 'go', wetGround: true })).toEqual(['picnic'])
  })

  it('NIGHT hides the row completely', () => {
    expect(B({ code: 95, wind: 80, moto: false, night: true })).toEqual([])
  })

  it('BLEIB DRIN shows hazards only — "stay in" already says the rest', () => {
    // Plain rain in STUCK adds nothing; a wall of crosses would be noise.
    expect(B({ code: 61, moto: false, state: 'stuck' })).toEqual([])
    // ...but a hazard still matters, even for a dash to the car.
    expect(B({ code: 73, moto: false, state: 'stuck' })).toEqual(['bike', 'moto', 'picnic'])
  })

  it('DANGER crosses everything — the one place a wall of crosses IS the message', () => {
    expect(B({ code: 0, moto: true, state: 'danger' })).toEqual(ACTIVITIES)
  })

  it('order is fixed, so icons never re-sort between refreshes', () => {
    const out = B({ code: 96, moto: false })
    expect(out).toEqual(ACTIVITIES.filter(a => out.includes(a)))
  })

  it('WET_GROUND_MS is its own constant, not RECENT_RAIN_MS', () => {
    expect(WET_GROUND_MS).toBe(90 * 60 * 1000)
  })
})

// ---- easesToGoableMin — a word for "much lighter, not zero" (v2.26.0) ------------

describe('easesToGoableMin — the gap we could see but could not say', () => {
  it('THE INVISIBLE GAP (2026-08-18, 16:20, thunderstorm): 2.5 h walkable, 0 dry slots', () => {
    // Live radar at Altstadt. Nothing ever drops below DRY_THRESHOLD, so detectGaps
    // finds zero gaps and the verdict read "no break in sight for 3 hours" over a
    // two-and-a-half-hour window you could comfortably walk in.
    const t = timeline(NOON, [2.12, 0.70, 0.20, 0.13, 0.17, 0.19, 0.18, 0.23, 0.26, 0.26])
    expect(detectGaps(t.times, t.precips).gaps).toHaveLength(0)   // the old blind spot
    expect(easesToGoableMin(t.times, t.precips, NOON)).toBe(30)   // 3rd slot = +30 min
  })

  it('needs a RUN — one light slot between heavy ones is not an easing', () => {
    const t = timeline(NOON, [2.0, 0.3, 2.0, 2.0, 2.0, 2.0])
    expect(easesToGoableMin(t.times, t.precips, NOON)).toBeNull()
  })

  it('uses LIGHT_MAX, the app\'s own "you could still go out" line', () => {
    const under = timeline(NOON, [3.0, 0.49, 0.49, 0.49, 3.0])
    const over  = timeline(NOON, [3.0, 0.51, 0.51, 0.51, 3.0])
    expect(easesToGoableMin(under.times, under.precips, NOON)).toBe(15)
    expect(easesToGoableMin(over.times, over.precips, NOON)).toBeNull()
  })

  it('never eases within the window → null', () => {
    const t = timeline(NOON, new Array(12).fill(2.5))
    expect(easesToGoableMin(t.times, t.precips, NOON)).toBeNull()
  })

  it('no timeline → null (says nothing rather than guessing)', () => {
    expect(easesToGoableMin(null, null, NOON)).toBeNull()
    expect(easesToGoableMin([], [], NOON)).toBeNull()
  })
})

describe('getStatus — STUCK can finally say when it lets up', () => {
  it('names the minutes instead of a bare "no break in sight"', () => {
    const t = makeT()
    const s = getStatus(2.5, [], null, t, NOON, { easeSoonMin: 24 })
    expect(s.type).toBe('stuck')                       // state unchanged — wording only
    expect(s.sub).toBe('s_stuck_easing')
    expect(t.varsFor('s_stuck_easing')).toEqual({ min: 25 })   // rounded to 5
    expect(s.notice.sub).toBe('n_stuck_easing')
  })

  it('THUNDER NO LONGER SWALLOWS THE TIMING — storm named AND minutes given', () => {
    // The live case: code 95/96 with the rain visibly easing on radar, and the thunder
    // sub outranked everything so the user was told nothing about the letting-up.
    const t = makeT()
    const s = getStatus(2.5, [], { code: 96 }, t, NOON, { easeSoonMin: 24 })
    expect(s.type).toBe('stuck')
    expect(s.sub).toBe('s_stuck_storm_easing')
    expect(t.varsFor('s_stuck_storm_easing')).toEqual({ min: 25 })
  })

  it('thunder with no easing keeps the plain storm line', () => {
    expect(getStatus(2.5, [], { code: 96 }, makeT(), NOON, {}).sub).toBe('s_stuck_storm')
  })

  it('radar easing outranks the model second opinion (radar owns the next 3 h)', () => {
    const s = getStatus(2.5, [], null, makeT(), NOON, {
      easeSoonMin: 30, modelEaseAt: NOON + 60 * 60,
    })
    expect(s.sub).toBe('s_stuck_easing')
  })

  it('no easing → every earlier fallback still behaves exactly as before', () => {
    expect(getStatus(2.5, [], null, makeT(), NOON, { modelEaseAt: NOON + 60 * 60 }).sub)
      .toBe('s_stuck_ease')
    expect(getStatus(2.5, [], null, makeT(), NOON, {}).sub).toBe('s_stuck')
  })
})

// ---- hasUsableWindow — "is there any point starting anything?" (v2.24.0) ---------

describe('hasUsableWindow — the closing-window rule', () => {
  const tl = ps => timeline(NOON, ps)

  it('THE WET AFTERNOON (2026-08-18, 14:39): dry now, nothing usable after', () => {
    // Served nowcast: ~21 min dry, then rain from 15:00 climbing straight through
    // 17:00. Longest dry run is 2 slots. Peak never reached DOWNPOUR_MM, the 45-min
    // total was 0.28 and the gauge read 0.0 — so all three earlier escapes were open
    // and the verdict was GEMMA RAUS over a visibly wet afternoon.
    const t = tl([0, 0, 0.19, 0.09, 0.17, 0.34, 0.50, 0.56, 0.66, 0.72, 0.78])
    expect(hasUsableWindow(t.times, t.precips, NOON)).toBe(false)
  })

  it('NO CRYING WOLF: a genuine 40-min window with rain that later clears stays GO', () => {
    // The failure v2.19.0 was explicitly gated against. Dry now, rain arrives, and a
    // real dry stretch opens afterwards → this rule must keep its hands off.
    const t = tl([0, 0, 0.8, 0.8, 0.8, 0, 0, 0, 0, 0, 0])
    expect(hasUsableWindow(t.times, t.precips, NOON)).toBe(true)
    const st = getStatus(0, [], null, makeT(), NOON, {
      nextRainAt: NOON + 1800, noUsableWindow: false,
    })
    expect(st.type).toBe('go')
    expect(st.sub).toBe('s_rain_soon')
  })

  it('exactly GO_MIN_SLOTS dry in a row is enough; one fewer is not', () => {
    const three = tl([0.5, 0.5, 0, 0, 0, 0.5, 0.5, 0.5])
    const two   = tl([0.5, 0.5, 0, 0, 0.5, 0.5, 0.5, 0.5])
    expect(hasUsableWindow(three.times, three.precips, NOON)).toBe(true)
    expect(hasUsableWindow(two.times, two.precips, NOON)).toBe(false)
    expect(GO_MIN_SLOTS * 15).toBe(GO_MIN_WINDOW)   // one meaning of "usable", one number
  })

  it('never escalates on ignorance — no timeline, or nothing in range, reads usable', () => {
    expect(hasUsableWindow([], [], NOON)).toBe(true)
    expect(hasUsableWindow(null, null, NOON)).toBe(true)
    const stale = { times: [NOON - 99999], precips: [0.5] }
    expect(hasUsableWindow(stale.times, stale.precips, NOON)).toBe(true)
  })

  it('rain beyond the 3 h look-ahead cannot make the window "closing"', () => {
    const t = timeline(NOON, new Array(20).fill(0))   // dry for 5 h
    expect(hasUsableWindow(t.times, t.precips, NOON)).toBe(true)
  })
})

describe('getStatus — the closing window keeps you in, and says why', () => {
  it('dry right now, but BLEIB DRIN with the minutes you actually have', () => {
    const t = makeT()
    const st = getStatus(0, [], null, t, NOON, {
      nextRainAt: NOON + 21 * 60, noUsableWindow: true,
    })
    expect(st.type).toBe('stuck')
    expect(st.sub).toBe('s_no_window')
    expect(t.varsFor('s_no_window')).toEqual({ min: 20 })   // rounded to 5, never 0
  })

  it('a burst still outranks it — the more urgent sentence wins', () => {
    const st = getStatus(0, [], null, makeT(), NOON, {
      nextRainAt: NOON + 21 * 60, noUsableWindow: true, downpourSoonWideMin: 12,
    })
    expect(st.sub).toBe('short_window_sub')
  })

  it('already drizzling with no window → names the wetness, not a countdown', () => {
    const st = getStatus(0.3, [], null, makeT(), NOON, { noUsableWindow: true })
    expect(st.type).toBe('stuck')
    expect(st.sub).toBe('window_wet_sub')
  })

  it('gauge wet while radar reads dry → still the wetness line, not "X min dry"', () => {
    // Live 2026-08-18 14:51 at Aigen: the radar slot read 0.08 so detectGaps offered a
    // nextRainAt, but the ground gauge already had 0.1 on it. Telling someone standing
    // in drizzle that they have 20 dry minutes is the wrong sentence.
    const st = getStatus(0.4, [], null, makeT(), NOON, {
      noUsableWindow: true, nextRainAt: NOON + 20 * 60,
    })
    expect(st.type).toBe('stuck')
    expect(st.sub).toBe('window_wet_sub')
  })

  it('WAIT and STUCK are untouched — this only ever converts go/light', () => {
    const gap = [{ startsAt: NOON + 3600, startsInMinutes: 60, durationMinutes: 45, opensEnded: false }]
    expect(getStatus(2.0, gap, null, makeT(), NOON, { noUsableWindow: true }).type).toBe('wait')
    expect(getStatus(2.0, [], null, makeT(), NOON, { noUsableWindow: true }).type).toBe('stuck')
  })
})

// ---- the BLEIB DRIN hold — leaving STUCK has to be earned (v2.22.0) --------------

describe('dryWindowOpen — a window you could actually use', () => {
  it('a real 45-min break opens the window (Bahnhof, 2026-08-18)', () => {
    // Served nowcast through the lull: 0.02 / 0.04 / 0.07 then 0.14 returning.
    expect(dryWindowOpen(timeline(NOON, [0.02, 0.04, 0.07, 0.14]), NOON)).toBe(true)
  })

  it('a continuous drizzle does NOT (Altstadt, same minute, 2 km away)', () => {
    // 0.11 / 0.09 / 0.10 — the SAME physical break, and every slot within a hair of
    // DRY_THRESHOLD. Per-slot logic called this "no gap at all" at one point and a
    // clean 45-min gap at the other; on accumulation it is honestly still drizzling.
    expect(dryWindowOpen(timeline(NOON, [0.11, 0.09, 0.10, 0.19]), NOON)).toBe(false)
  })

  it('one shower crossing an otherwise dry window does NOT open it', () => {
    // The average alone would pass this (0.3 over four slots, well under the line) —
    // but a single 0.3 slot is a shower crossing your route, so the peak vetoes it.
    expect(windowWetMm(timeline(NOON, [0, 0.3, 0, 0]), NOON)).toBeCloseTo(0.3, 5)
    expect(dryWindowOpen(timeline(NOON, [0, 0.3, 0, 0]), NOON)).toBe(false)
  })

  it('bone dry → open; no radar at all → NOT open (absence needs a witness)', () => {
    expect(dryWindowOpen(timeline(NOON, [0, 0, 0, 0]), NOON)).toBe(true)
    expect(dryWindowOpen(null, NOON)).toBe(false)
    expect(dryWindowOpen({ times: [], precips: [] }, NOON)).toBe(false)
  })
})

describe('settleStuckHold — the dwell clock', () => {
  const MIN = 60 * 1000
  const now = 1_700_000_000_000

  it('no previous hold → nothing to hold', () => {
    expect(settleStuckHold(null, { releaseOk: true, nowMs: now }).holding).toBe(false)
  })

  it('calm evidence alone does NOT release — it must hold for two cycles', () => {
    const first = settleStuckHold({ ts: now - 5 * MIN, calmSince: null }, { releaseOk: true, nowMs: now })
    expect(first.holding).toBe(true)          // clock only just started
    expect(first.calmSince).toBe(now)
    const later = settleStuckHold({ ts: now - 5 * MIN, calmSince: now - CALM_DWELL_MS }, { releaseOk: true, nowMs: now })
    expect(later.holding).toBe(false)         // dwell met → released
  })

  it('THE FLAP (2026-08-18): one calm reading between two wet ones never releases', () => {
    // stuck → (a reissue reads calm) → stuck. Without the clock this was
    // BLEIB DRIN → PASST SCHON → BLEIB DRIN inside a few minutes.
    const calm = settleStuckHold({ ts: now - 5 * MIN, calmSince: null }, { releaseOk: true, nowMs: now })
    expect(calm.holding).toBe(true)
    const wetAgain = settleStuckHold({ ts: now, calmSince: calm.calmSince },
                                     { releaseOk: false, nowMs: now + 5 * MIN })
    expect(wetAgain.holding).toBe(true)
    expect(wetAgain.calmSince).toBeNull()     // clock RESET — not "calm at some point"
  })

  it('a long rainy afternoon stays held — staleness measures the HOLD, not the rain', () => {
    // The record is rewritten every refresh, so three hours of rain is still fresh.
    expect(settleStuckHold({ ts: now - 4 * MIN, calmSince: null }, { releaseOk: false, nowMs: now }).holding).toBe(true)
  })

  it('an app left closed resumes with NO hold (nobody checked that evidence since)', () => {
    const r = settleStuckHold({ ts: now - 3 * 60 * MIN, calmSince: null }, { releaseOk: false, nowMs: now })
    expect(r.holding).toBe(false)
  })

  it('THE VALVE: a jammed evidence gate cannot hold a calm reading forever', () => {
    // The gate can jam shut while it is genuinely dry: the nowcast disappears, or INCA
    // lays a sub-threshold trace carpet (v2.8.0) so no window ever reads "usable".
    // A hold may DELAY good news; it must never CANCEL it.
    const jammed = { ts: now, calmSince: null, easedSince: now - HOLD_MAX_MS }
    expect(settleStuckHold(jammed, { releaseOk: false, easing: true, nowMs: now }).holding).toBe(false)
    // …but only once the READING itself has been calm that long — still raining holds.
    const stillWet = { ts: now, calmSince: null, easedSince: null }
    expect(settleStuckHold(stillWet, { releaseOk: false, easing: false, nowMs: now }).holding).toBe(true)
  })

  it('the valve clock resets too — 19 dry minutes then rain does not bank credit', () => {
    const r = settleStuckHold({ ts: now, calmSince: null, easedSince: now - 19 * MIN },
                              { releaseOk: false, easing: false, nowMs: now })
    expect(r.easedSince).toBeNull()
    expect(r.holding).toBe(true)
  })

  it('the evidence path is FASTER than the valve — good evidence is rewarded', () => {
    expect(CALM_DWELL_MS).toBeLessThan(HOLD_MAX_MS)
  })

  it('HOLD_STALE_MS / CALM_DWELL_MS contract (change only with a logic-log entry)', () => {
    expect(CALM_DWELL_MS).toBe(10 * 60 * 1000)
    expect(HOLD_STALE_MS).toBe(20 * 60 * 1000)
  })
})

describe('getStatus — a held STUCK says what it sees', () => {
  it('holds the headline instead of flashing GEMMA RAUS', () => {
    const t = makeT()
    const st = getStatus(0, [], null, t, NOON, { dryEndsOpen: true, heldStuck: true })
    expect(st.type).toBe('stuck')
    expect(st.headline).toBe('STUCK')
    expect(st.moto).toBe(false)
  })

  it('the sub is honest about the improvement — never a silent hold', () => {
    // The user asked for exactly this: "stuck inside, but soon there might be a gap".
    const easing = getStatus(0.3, [], null, makeT(), NOON, { heldStuck: true, releaseOk: false })
    expect(easing.sub).toBe('s_stuck_softening')
    const clearing = getStatus(0, [], null, makeT(), NOON, { dryEndsOpen: true, heldStuck: true, releaseOk: true })
    expect(clearing.sub).toBe('s_stuck_clearing')
  })

  it('ESCALATIONS ARE NEVER GATED — the hold only ever converts go/light', () => {
    // A downpour landing while a hold is active must still read as the rain it is.
    const wait = getStatus(2.0, [{ startsAt: NOON + 3600, startsInMinutes: 60, durationMinutes: 45, opensEnded: false }],
                           null, makeT(), NOON, { heldStuck: true })
    expect(wait.type).toBe('wait')            // untouched by the hold
    const stuck = getStatus(2.0, [], null, makeT(), NOON, { heldStuck: true })
    expect(stuck.type).toBe('stuck')
    expect(stuck.sub).not.toBe('s_stuck_softening')   // real stuck wording, not the hold's
  })

  it('no hold → byte-identical to before (dots and first loads are unaffected)', () => {
    const withoutFlag = getStatus(0, [], null, makeT(), NOON, { dryEndsOpen: true })
    const withFalse   = getStatus(0, [], null, makeT(), NOON, { dryEndsOpen: true, heldStuck: false })
    expect(withoutFlag.type).toBe('go')
    expect(withFalse).toEqual(withoutFlag)
  })
})

// ---- gaugeSlotValue — the gauge speaks in 10-min totals, the ladder in 15-min -----

describe('gaugeSlotValue — unit correction (v2.21.0)', () => {
  it('GAUGE_SLOT_SCALE contract: 1.5 (change only with a CLAUDE.md log entry)', () => {
    expect(GAUGE_SLOT_SCALE).toBe(1.5)
  })

  it('THE MODERATE-RAIN-AS-DRIZZLE BUG (2026-08-18): 0.4 mm/10min is NOT the light band', () => {
    // Live, city-wide rain. METAR LOWS reported RA / -RA continuously for 2.5 h
    // (moderate at 10:20Z and 10:50Z) while the shared TAWES ground read 0.4 mm per
    // 10 min — 2.4 mm/h, meteorologically MODERATE — and the raw value landed dead
    // centre of the 0.2–0.5 "light drizzle, go anyway" band at all eleven points.
    expect(0.4).toBeGreaterThanOrEqual(LIGHT_MIN)     // what the ladder used to see
    expect(0.4).toBeLessThan(LIGHT_MAX)
    expect(gaugeSlotValue(0.4)).toBeCloseTo(0.6, 5)   // what it means on the slot scale
    expect(gaugeSlotValue(0.4)).toBeGreaterThanOrEqual(LIGHT_MAX)   // → out of "go anyway"
  })

  it('RAISE-ONLY: never returns less than it was given', () => {
    for (const rr of [0, 0.05, 0.1, 0.2, 0.4, 1.8, 6.2]) {
      expect(gaugeSlotValue(rr)).toBeGreaterThanOrEqual(rr)
    }
  })

  it('sub-reporting readings pass through UNSCALED — groundDry must not move', () => {
    // Lifting a sub-threshold reading over DRY_THRESHOLD would flip groundDry and
    // silently disable drizzle surfacing (v1.1) — a real drizzle would fall back from
    // GO ANYWAY to GEMMA RAUS. That is a lag; the doctrine does not forgive lags.
    expect(gaugeSlotValue(0.09)).toBe(0.09)
    expect(gaugeSlotValue(0.09)).toBeLessThan(DRY_THRESHOLD)
    expect(gaugeSlotValue(0)).toBe(0)
    // the first REPORTING tip still reads as barely-drizzle, not as light rain
    expect(gaugeSlotValue(0.1)).toBeLessThan(LIGHT_MIN)
  })

  it('junk in → 0 (a broken gauge never invents rain)', () => {
    expect(gaugeSlotValue(null)).toBe(0)
    expect(gaugeSlotValue(undefined)).toBe(0)
    expect(gaugeSlotValue(NaN)).toBe(0)
    expect(gaugeSlotValue(-1)).toBe(0)
  })

  it('the 0.10-rounding guard still sees a dry gauge as exactly 0', () => {
    // modelNowValue keys on stationPrecip === 0; scaling must not break that identity.
    expect(modelNowValue(0.1, true, gaugeSlotValue(0))).toBe(0)
  })

  it('SCENARIO (2026-08-18 Altstadt): gauge 0.4 + model 0.7 → no longer "go anyway"', () => {
    // Served values at 11:46 UTC: ground 0.4, Open-Meteo current 0.7, radar now 0.33.
    // Old blend: modelNowValue capped 0.7 → 0.4, ground 0.4 → effectivePrecip 0.40,
    // i.e. pinned to MODEL_NOW_CAP, dead centre of the light band → PASST SCHON.
    const gauge = gaugeSlotValue(0.4)
    const omForNow = modelNowValue(0.7, true, gauge, 0.33)
    const groundPrecip = Math.max(omForNow, gauge)
    expect(groundPrecip).toBeCloseTo(0.6, 5)
    expect(groundPrecip).toBeGreaterThanOrEqual(LIGHT_MAX)   // out of the light band
    const st = getStatus(groundPrecip, [], null, makeT(), NOON, { dryEndsOpen: false })
    expect(st.type).toBe('stuck')
  })

  it('a genuine light drizzle still reads GO ANYWAY, not STUCK', () => {
    // Regression guard on the v1.1 caution policy: 0.2 mm/10 min → 0.3 on the slot
    // scale, still inside the light band. Scaling must not turn drizzle into STUCK.
    const v = gaugeSlotValue(0.2)
    expect(v).toBeGreaterThanOrEqual(LIGHT_MIN)
    expect(v).toBeLessThan(LIGHT_MAX)
    expect(getStatus(v, [], null, makeT(), NOON, noTrend).type).toBe('light')
  })
})

// ---- modelNowValue — the hour-lagged model can't out-shout a reporting gauge ------

describe('modelNowValue — trailing-edge lag guard (the bogus "WAIT 50 in the sun")', () => {
  it('THE BUG: gauge 0.0 + stale model 0.7 → capped to light (0.4), never WAIT/STUCK', () => {
    expect(modelNowValue(0.7, true, 0)).toBe(MODEL_NOW_CAP)
    expect(MODEL_NOW_CAP).toBe(0.4)
    expect(MODEL_NOW_CAP).toBeLessThan(LIGHT_MAX)   // capped value stays in the light band
  })
  it('0.10-rounding guard preserved: gauge 0 + model ≤0.1 → 0', () => {
    expect(modelNowValue(0.1, true, 0)).toBe(0)
    expect(modelNowValue(0.05, true, 0)).toBe(0)
  })
  it('gauge wet + model higher → model still capped (gauge owns the magnitude)', () => {
    expect(modelNowValue(2.0, true, 1.2)).toBe(MODEL_NOW_CAP)  // groundPrecip=max(1.2,0.4)=1.2
  })
  it('no gauge at all → model passes through (radar-max path handles that case)', () => {
    expect(modelNowValue(0.7, false, 0)).toBe(0.7)
  })
})

// ---- v2.17.0: the cap must not clamp a downpour that is happening RIGHT NOW -------

describe('modelNowValue — corroborated heavy current (Nonntal thunderstorm 2026-08-06)', () => {
  it('THE INCIDENT: gauge dry, model 6.2mm, radar confirms rain → uncapped, NOT light', () => {
    // Live /api/ambient at 18:47 CEST: OM current 6.2mm (10.8 at Aigen), code 96/99,
    // radar served 0.4 (itself clamped). Before the fix this returned 0.4 — dead centre
    // of the light band — and the headline read PASST SCHON during a hail thunderstorm.
    const v = modelNowValue(6.2, true, 0, 0.4)
    expect(v).toBe(6.2)
    expect(v).toBeGreaterThan(LIGHT_MAX)   // cannot be rendered as "light drizzle"
  })

  it('the trailing-edge bug stays fixed: stale model, radar already dry → still capped', () => {
    // v2.0.1's "WAIT 50 MIN in the sun". Rain is over, so nothing corroborates the
    // model's preceding-hour leftover — the cap must still apply, at any magnitude.
    expect(modelNowValue(0.7, true, 0, 0)).toBe(MODEL_NOW_CAP)
    expect(modelNowValue(3.0, true, 0, 0)).toBe(MODEL_NOW_CAP)
    expect(modelNowValue(3.0, true, 0, 0.05)).toBe(MODEL_NOW_CAP)  // sub-threshold trace
  })

  it('only HEAVY passes: corroborated but under the bar → still capped', () => {
    expect(MODEL_HEAVY_PASS).toBe(1.5)
    expect(modelNowValue(0.7, true, 0, 0.9)).toBe(MODEL_NOW_CAP)
    expect(modelNowValue(1.49, true, 0, 0.9)).toBe(MODEL_NOW_CAP)
    expect(modelNowValue(1.5, true, 0, 0.9)).toBe(1.5)
  })

  it('0.10-rounding guard still wins over the new rule', () => {
    expect(modelNowValue(0.1, true, 0, 5.0)).toBe(0)
  })

  it('direction invariant: the new rule can only RAISE the NOW value, never lower it', () => {
    for (const m of [0, 0.05, 0.3, 0.7, 1.4, 1.5, 3.0, 10.8]) {
      for (const r of [0, 0.05, 0.1, 0.4, 2.0]) {
        expect(modelNowValue(m, true, 0, r)).toBeGreaterThanOrEqual(modelNowValue(m, true, 0, 0))
      }
    }
  })

  it('nowcastNowSlot picks the slot nearest now, and is 0 without a nowcast', () => {
    const nc = { times: [NOON - 900, NOON + 60, NOON + 900], precips: [0.2, 1.7, 0.3] }
    expect(nowcastNowSlot(nc, NOON)).toBe(1.7)
    expect(nowcastNowSlot(null, NOON)).toBe(0)
    expect(nowcastNowSlot({ times: [], precips: [] }, NOON)).toBe(0)
  })
})

// ---- v2.18.0: ribbon confidence — say how sure the forecast lane is ---------------

describe('aromeSlotSeries — AROME hours projected onto the 15-min grid', () => {
  const times = [NOON, NOON + 900, NOON + 1800, NOON + 2700]

  it('scales an hourly mm/h total onto the slots it covers (÷4 for 15-min slots)', () => {
    // AROME stamp = END of its accumulation hour, so NOON+3600 covers (NOON, NOON+3600].
    const s = aromeSlotSeries(times, [NOON + 3600], [8])
    expect(s).toEqual([0, 2, 2, 2])   // NOON itself is NOT in (NOON, NOON+3600]
  })

  it('no AROME → all zeros, never undefined', () => {
    expect(aromeSlotSeries(times, [], [])).toEqual([0, 0, 0, 0])
    expect(aromeSlotSeries(times, null, null)).toEqual([0, 0, 0, 0])
    expect(aromeSlotSeries([], [NOON], [5])).toEqual([])
  })

  it('combineModelSeries is still exactly max(own, arome) over this series', () => {
    const own = [0, 0.5, 3, 0]
    const a   = aromeSlotSeries(times, [NOON + 3600], [8])
    const c   = combineModelSeries(times, own, [NOON + 3600], [8])
    expect(c).toEqual(own.map((o, i) => Math.max(o, a[i])))
  })
})

// ---- v2.19.0: a GO headline must promise a window you can actually use -----------

describe('goWindowTooShort — the usable-window predicate', () => {
  it('only GO and GO ANYWAY escalate — WAIT/STUCK already keep you in', () => {
    expect(goWindowTooShort('go', 24)).toBe(true)
    expect(goWindowTooShort('light', 24)).toBe(true)
    expect(goWindowTooShort('wait', 24)).toBe(false)
    expect(goWindowTooShort('stuck', 24)).toBe(false)
    expect(goWindowTooShort('loading', 24)).toBe(false)
  })
  it('no downpour in the window → no escalation', () => {
    expect(goWindowTooShort('go', null)).toBe(false)
    expect(goWindowTooShort('go', undefined)).toBe(false)
  })
  it('the boundary is GO_MIN_WINDOW inclusive', () => {
    expect(GO_MIN_WINDOW).toBe(45)
    expect(goWindowTooShort('go', 45)).toBe(true)
    expect(goWindowTooShort('go', 46)).toBe(false)
  })
})

describe('firstDownpourMin — windowMin parameter (v2.19)', () => {
  it('default window is unchanged at 30 min', () => {
    const nc = { times: [NOON + 40 * 60], precips: [3.4] }
    expect(firstDownpourMin(nc, NOON)).toBeNull()             // 40 min > 30
    expect(firstDownpourMin(nc, NOON, DOWNPOUR_WINDOW_MIN)).toBeNull()
  })
  it('a wider window sees the same downpour', () => {
    const nc = { times: [NOON + 40 * 60], precips: [3.4] }
    expect(firstDownpourMin(nc, NOON, GO_MIN_WINDOW)).toBe(40)
  })
  it('still requires DOWNPOUR_MM — light rain never escalates', () => {
    const nc = { times: [NOON + 20 * 60], precips: [0.9] }
    expect(firstDownpourMin(nc, NOON, GO_MIN_WINDOW)).toBeNull()
  })
})

describe('the Nonntal short-window incident (2026-08-17, 11:36)', () => {
  // Live radar that morning at Altstadt: trace 0.01 now, then 1.53 at 12:00 and
  // 3.43 (~14 mm/h) at 12:15. Gauges 0.0, code 61 — a genuine light drizzle with a
  // downpour ~40 min out. The headline read GEMMA RAUS.
  const nowcast = {
    times:   [NOON, NOON + 15 * 60, NOON + 24 * 60, NOON + 39 * 60],
    precips: [0.01, 0.0,            1.53,           3.43],
  }

  it('THE BUG: dry-now + downpour inside the window no longer says GEMMA RAUS', () => {
    const wide = firstDownpourMin(nowcast, NOON, GO_MIN_WINDOW)
    expect(wide).toBe(24)
    const s = getStatus(0.01, [], null, makeT(), NOON,
      { downpourSoonMin: 24, downpourSoonWideMin: wide })
    expect(s.type).toBe('stuck')
    expect(s.sub).toBe('short_window_sub')
    expect(s.moto).toBe(false)
  })

  it('the sub names the time so the countdown promise is kept', () => {
    const t = makeT()
    getStatus(0.01, [], null, t, NOON, { downpourSoonMin: 24, downpourSoonWideMin: 24 })
    expect(t.varsFor('short_window_sub').min).toBe(24)
  })

  it('a light drizzle with the same downpour ahead also escalates (GO ANYWAY case)', () => {
    const s = getStatus(0.3, [], null, makeT(), NOON,
      { downpourSoonMin: 24, downpourSoonWideMin: 24 })
    expect(s.type).toBe('stuck')
    expect(s.sub).toBe('short_window_sub')
  })

  it('REGRESSION GUARD: a downpour beyond the window still reads GEMMA RAUS', () => {
    // The dry window is the product — this must not swallow a genuinely usable
    // afternoon just because rain exists somewhere on the timeline.
    const s = getStatus(0, [], null, makeT(), NOON,
      { downpourSoonWideMin: null, nextRainAt: NOON + 3 * 3600 })
    expect(s.type).toBe('go')
  })

  it('REGRESSION GUARD: plain light rain ahead (no downpour) still reads GEMMA RAUS', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { downpourSoonWideMin: null, nextRainAt: NOON + 30 * 60, rainProb: 80 })
    expect(s.type).toBe('go')
    expect(s.sub).toBe('s_rain_soon')
  })

  it('an already-raining WAIT verdict is untouched by the new rule', () => {
    const gaps = [{ startsAt: NOON + 60 * 60, durationMinutes: 60, opensEnded: false }]
    const s = getStatus(2.0, gaps, null, makeT(), NOON,
      { downpourSoonMin: 10, downpourSoonWideMin: 10 })
    expect(s.type).toBe('wait')
  })
})

// ---- v2.20.0: steady rain soaks you as well as a burst ----------------------------

describe('windowWetMm — how much actually lands while you would be out', () => {
  const nowcast = {
    times:   [NOON + 6 * 60, NOON + 21 * 60, NOON + 36 * 60, NOON + 51 * 60, NOON + 66 * 60],
    precips: [0.65,          0.40,           0.55,           0.13,           0.18],
  }
  it('THE LIVE CASE (2026-08-17, 11:54 Altstadt): 1.6 mm over the next 45 min', () => {
    expect(windowWetMm(nowcast, NOON, GO_MIN_WINDOW)).toBeCloseTo(1.6, 5)
  })
  it('only counts slots inside the window', () => {
    expect(windowWetMm(nowcast, NOON, 25)).toBeCloseTo(1.05, 5)
  })
  it('a trace carpet sums to nothing — no extra guard needed', () => {
    const trace = { times: [NOON, NOON + 900, NOON + 1800], precips: [0.01, 0.02, 0.01] }
    expect(windowWetMm(trace, NOON, GO_MIN_WINDOW)).toBeLessThan(WINDOW_WET_MM)
  })
  it('no nowcast → 0, never NaN', () => {
    expect(windowWetMm(null, NOON)).toBe(0)
    expect(windowWetMm({ times: [], precips: [] }, NOON)).toBe(0)
  })
})

describe('goWindowTooShort — steady rain, not just bursts (v2.20.0)', () => {
  it('THE BUG: already wet + 1.6 mm of steady rain, no slot at 1.5 → now escalates', () => {
    expect(WINDOW_WET_MM).toBe(1.0)
    expect(goWindowTooShort('go', null, 1.6, true)).toBe(true)
    expect(goWindowTooShort('light', null, 1.6, true)).toBe(true)
  })
  it('DRY now with rain later in the window keeps its usable window', () => {
    // The anti-crying-wolf gate: dry now + rain arriving at minute 40 means you
    // genuinely have 40 minutes. Only a BURST overrides that.
    expect(goWindowTooShort('go', null, 1.6, false)).toBe(false)
    expect(goWindowTooShort('go', 40, 1.6, false)).toBe(true)   // burst still wins
  })
  it('a burst still escalates on its own, with no accumulation at all', () => {
    expect(goWindowTooShort('go', 24, 0, false)).toBe(true)
  })
  it('a passing shower under the accumulation bar still reads GO', () => {
    expect(goWindowTooShort('go', null, 0.45, true)).toBe(false)
    expect(goWindowTooShort('go', null, 0.99, true)).toBe(false)
    expect(goWindowTooShort('go', null, 1.0, true)).toBe(true)   // boundary inclusive
  })
  it('WAIT/STUCK are still never escalated by accumulation', () => {
    expect(goWindowTooShort('wait', null, 5.0, true)).toBe(false)
    expect(goWindowTooShort('stuck', null, 5.0, true)).toBe(false)
  })
  it('null-safe on a trend with no accumulation field', () => {
    expect(goWindowTooShort('go', null, undefined, true)).toBe(false)
  })
})

describe('getStatus — steady-rain escalation names the amount, not a countdown', () => {
  it('steady rain, no burst → BLEIB DRIN with the window sub (no false countdown)', () => {
    const s = getStatus(0.1, [], null, makeT(), NOON,
      { downpourSoonWideMin: null, windowWetMm: 1.6 })
    expect(s.type).toBe('stuck')
    expect(s.sub).toBe('window_wet_sub')
  })
  it('a burst still gets the countdown sub, not the amount sub', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { downpourSoonWideMin: 24, windowWetMm: 1.6 })
    expect(s.type).toBe('stuck')
    expect(s.sub).toBe('short_window_sub')
  })
})

describe('the 0.1-0.2 dead band must not claim "no rain" (v2.20.0)', () => {
  it('THE BUG: gauge reading exactly 0.1 said "no rain right now"', () => {
    // Nonntal, 2026-08-17: ground 0.1, code 61. currentPrecip 0.1 is NOT < 0.1 so it
    // never reached the dry branch, but IS < LIGHT_MIN so it fell into GO with
    // s_dry_generic — the app telling a user standing in drizzle there is no rain.
    const s = getStatus(0.1, [], null, makeT(), NOON, { windowWetMm: 0 })
    expect(s.type).toBe('go')                  // state unchanged — anti-flicker, litigated
    expect(s.sub).toBe('s_barely_drizzle')     // wording no longer lies
  })
  it('genuinely dry still gets the dry sub', () => {
    const s = getStatus(0, [], null, makeT(), NOON, { windowWetMm: 0 })
    expect(s.type).toBe('go')
    expect(s.sub).toBe('s_dry_generic')
  })
  it('0.19 still GO (a 0.1 tip must not flip GEMMA RAUS ↔ GO ANYWAY)', () => {
    const s = getStatus(0.19, [], null, makeT(), NOON, { windowWetMm: 0 })
    expect(s.type).toBe('go')
    expect(s.sub).toBe('s_barely_drizzle')
  })
  it('0.2 earns the light state as before', () => {
    const s = getStatus(0.3, [], null, makeT(), NOON, { windowWetMm: 0 })
    expect(s.type).toBe('light')
  })
})

describe('modelsAgree — the disagreement max() used to hide', () => {
  it('THE LIVE CASE (2026-08-06, 21:15): ICON-EU 2.2 vs AROME 0.20 → disagree', () => {
    // ICON-EU replaying the storm ~2 h late, against AROME and radar both saying it
    // is over. max() drew 2.2 as one confident bar; the ribbon now marks it contested.
    expect(modelsAgree(2.2, 0.20)).toBe(false)
  })
  it('both dry counts as agreement (not a disagreement about nothing)', () => {
    expect(modelsAgree(0, 0)).toBe(true)
    expect(modelsAgree(0.05, 0.02)).toBe(true)
  })
  it('one wet, one dry → disagreement whichever way round', () => {
    expect(modelsAgree(1.2, 0)).toBe(false)
    expect(modelsAgree(0, 1.2)).toBe(false)
  })
  it('same story, comparable magnitude → agreement', () => {
    expect(modelsAgree(1.0, 2.0)).toBe(true)          // within 2.5x
    expect(modelsAgree(1.0, 2.5)).toBe(true)          // exactly at the boundary
    expect(modelsAgree(1.0, 2.6)).toBe(false)         // past it
    expect(MODEL_AGREE_FACTOR).toBe(2.5)
  })
  it('is symmetric and null-safe', () => {
    expect(modelsAgree(3, 1)).toBe(modelsAgree(1, 3))
    expect(modelsAgree(null, undefined)).toBe(true)
  })
})

describe('probAt — no confidence data must not look like low confidence', () => {
  const hT = [NOON, NOON + 3600, NOON + 7200]
  const hP = [80, 43, 10]
  it('picks the nearest hour', () => {
    expect(probAt(hT, hP, NOON + 300)).toBe(80)
    expect(probAt(hT, hP, NOON + 3500)).toBe(43)
  })
  it('returns null past the fetched horizon instead of leaking the last hour', () => {
    // The old ribbon had 6 h of probability under a 12 h chart; the nearest-hour
    // lookup would have applied hour 6's number to hour 11.
    expect(probAt(hT, hP, NOON + 7200 + 3601)).toBeNull()
    expect(probAt([], [], NOON)).toBeNull()
  })
  it('non-numeric probability → null', () => {
    expect(probAt(hT, [80, null, 10], NOON + 3600)).toBeNull()
  })
})

describe('radarSpanLabel — the band must not promise 3 h it never had', () => {
  it('THE LIVE CASE: radar reaching 22:00 at 19:21 is 2½ h, not 3', () => {
    expect(radarSpanLabel(NOON + 159 * 60, NOON)).toBe('2½')
  })
  it('uses the same ½-hour rounding as the countdowns', () => {
    expect(radarSpanLabel(NOON + 180 * 60, NOON)).toBe(hoursLabel(180))
    expect(radarSpanLabel(NOON + 165 * 60, NOON)).toBe('3')
    expect(radarSpanLabel(NOON + 150 * 60, NOON)).toBe('2½')
  })
  it('never goes negative on a stale timeline', () => {
    expect(radarSpanLabel(NOON - 600, NOON)).toBe('0')
  })
})

describe('showGhost — the 0.05 mm cliff at the end of the radar zone', () => {
  it('THE BUG: radar 0.14 hid a 2.2 model expectation; 0.09 drew it full height', () => {
    expect(showGhost(0.14, 2.2)).toBe(true)     // now visible
    expect(showGhost(0.09, 2.2)).toBe(true)     // as it always was
  })
  it('model must MATERIALLY exceed radar — no ghost for a rounding difference', () => {
    expect(showGhost(2.0, 2.1)).toBe(false)     // below the factor and the abs floor
    expect(showGhost(1.0, 1.4)).toBe(false)     // 1.4x < 1.5x
    expect(showGhost(1.0, 1.6)).toBe(true)
    expect(GHOST_MIN_FACTOR).toBe(1.5)
  })
  it('a dry model never ghosts, and radar-above-model never ghosts', () => {
    expect(showGhost(0, 0.05)).toBe(false)
    expect(showGhost(3.0, 0.2)).toBe(false)
  })
  it('null-safe', () => {
    expect(showGhost(null, null)).toBe(false)
    expect(showGhost(0, undefined)).toBe(false)
  })
})

// ---- the missed-evening-rain fixes (v1.4): model second-opinion + RV approach -----

describe('model second-opinion — never claim an all-clear the model contradicts', () => {
  it('modelNextRainAt finds the model\'s first wet slot within 3 h', () => {
    const times = [NOON, NOON + 900, NOON + 1800, NOON + 2700]
    expect(modelNextRainAt(times, [0, 0, 0.3, 0.6], NOON)).toBe(NOON + 1800)
    expect(modelNextRainAt(times, [0, 0, 0, 0], NOON)).toBeNull()
    expect(modelNextRainAt([], [], NOON)).toBeNull()
  })

  it('THE MISSED EVENING RAIN: radar all-clear + model shows rain → says so, with time', () => {
    const t = makeT()
    const s = getStatus(0, [], null, t, NOON,
      { dryEndsOpen: true, modelRainAt: NOON + 45 * 60 })
    expect(s.type).toBe('go')
    expect(s.sub).toBe('s_model_rain')                    // NOT "clear for hours"
    expect(t.varsFor('s_model_rain').min).toBe(45)
  })

  it('far model rain → hours form ("model expects rain in about 2½ h")', () => {
    const t = makeT()
    const s = getStatus(0, [], null, t, NOON,
      { dryEndsOpen: true, modelRainAt: NOON + 150 * 60 })
    expect(s.sub).toBe('s_model_rain_far')
    expect(t.varsFor('s_model_rain_far').h).toBe('2½')
  })

  it('radar seeing rain itself → radar countdown wins, model stays quiet', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { nextRainAt: NOON + 40 * 60, rainProb: 80, modelRainAt: NOON + 60 * 60 })
    expect(s.sub).toBe('s_rain_soon')
  })

  it('popup notice carries the model expectation too', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { dryEndsOpen: true, modelRainAt: NOON + 45 * 60 })
    expect(s.notice.sub).toBe('n_model_rain')
  })
})

describe('RainViewer approach — the "blue on the map while the app said dry" guard', () => {
  it('RV forecast frames show echo arriving in ~20 min + GeoSphere silent → ETA shown', () => {
    const t = makeT()
    const s = getStatus(0, [], null, t, NOON,
      { dryEndsOpen: true, rvApproachMin: 20 })
    expect(s.type).toBe('go')
    expect(s.sub).toBe('s_rv_approach')
    expect(t.varsFor('s_rv_approach').min).toBe(20)      // real ETA, not a generic "~30"
    expect(s.notice.sub).toBe('n_rv_approach')
    expect(t.varsFor('n_rv_approach').min).toBe(20)
  })

  it('an early-arriving cell (~10 min, first frame) is not missed', () => {
    const t = makeT()
    const s = getStatus(0, [], null, t, NOON,
      { dryEndsOpen: true, rvApproachMin: 10 })
    expect(t.varsFor('s_rv_approach').min).toBe(10)
  })

  it('outranks the model second-opinion (observed echo beats expectation)', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { dryEndsOpen: true, rvApproachMin: 20, modelRainAt: NOON + 45 * 60 })
    expect(s.sub).toBe('s_rv_approach')
  })

  it('yields to a NEARER GeoSphere countdown (more precise timing wins)', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { nextRainAt: NOON + 20 * 60, rainProb: 80, rvApproachMin: 20 })
    expect(s.sub).toBe('s_rain_soon')
  })

  it('downpour warning still outranks everything (fallback sub path, no wide value)', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { dryEndsOpen: true, rvApproachMin: 20, downpourSoonMin: 12 })
    expect(s.sub).toBe('s_downpour_soon')
  })
})

// ---- model ease — the STUCK-side second opinion (v2.1) ----------------------------

describe('modelEaseAt + STUCK second-opinion — never a bare "no break" the model contradicts', () => {
  const times = Array.from({ length: 12 }, (_, i) => NOON + i * 900)

  it('model shows rain then a lasting dry stretch → ease point found', () => {
    const p = [0.8, 0.6, 0.4, 0.2, 0, 0, 0, 0, 0, 0, 0, 0]
    expect(modelEaseAt(times, p, NOON)).toBe(NOON + 4 * 900)   // +60 min
  })
  it('rain re-starting later resets the ease point to the FINAL dry stretch', () => {
    const p = [0.8, 0, 0, 0.5, 0.5, 0, 0, 0, 0, 0, 0, 0]
    expect(modelEaseAt(times, p, NOON)).toBe(NOON + 5 * 900)
  })
  it('model wet the whole window → no ease claim', () => {
    expect(modelEaseAt(times, times.map(() => 0.5), NOON)).toBeNull()
  })
  it('model dry the whole window (contradicting the present) → no ease claim', () => {
    expect(modelEaseAt(times, times.map(() => 0), NOON)).toBeNull()
  })

  // ---- v2.25.0: the ease has to LAST ----

  it('THE FALSE ALL-CLEAR (2026-08-18): a dip past the window edge is not "rain ending"', () => {
    // User report: "bleib drin, rain going away in about 2½ h — is this even true?"
    // It was not. The old loop stopped at +3 h, so a dry stretch starting near that
    // edge was announced as the end while the model had rain resuming just outside it.
    // Live shape: four slots of 0.03 (the model's noise floor, under our reporting
    // line so it counts as dry), then straight back to 0.26–0.60 an hour later.
    const long = Array.from({ length: 24 }, (_, i) => NOON + i * 900)   // 6 h of model
    const p = long.map((_, i) => i < 10 ? 0.5 : i < 14 ? 0.03 : 0.30)
    expect(modelEaseAt(long, p, NOON)).toBeNull()
  })

  it('a genuine clearance still reports — rain, then dry for good', () => {
    const long = Array.from({ length: 24 }, (_, i) => NOON + i * 900)
    const p = long.map((_, i) => i < 10 ? 0.5 : 0)
    expect(modelEaseAt(long, p, NOON)).toBe(NOON + 10 * 900)
  })

  it('MODEL_EASE_MIN_DRY is exactly the bar: 90 min dry passes, 75 min does not', () => {
    const long = Array.from({ length: 24 }, (_, i) => NOON + i * 900)
    const easeIdx = 8                                   // ease at +120 min
    const pass = long.map((_, i) => i < easeIdx ? 0.5 : i < easeIdx + 6 ? 0 : 0.4)
    const fail = long.map((_, i) => i < easeIdx ? 0.5 : i < easeIdx + 5 ? 0 : 0.4)
    expect(MODEL_EASE_MIN_DRY).toBe(2 * GO_MIN_WINDOW)
    expect(modelEaseAt(long, pass, NOON)).toBe(NOON + easeIdx * 900)
    expect(modelEaseAt(long, fail, NOON)).toBeNull()
  })

  it('a series too short to confirm the dry stretch makes no claim', () => {
    // Declining an optimistic promise on unverifiable data is the safe direction.
    const short = Array.from({ length: 8 }, (_, i) => NOON + i * 900)   // 2 h only
    const p = short.map((_, i) => i < 4 ? 0.5 : 0)
    expect(modelEaseAt(short, p, NOON)).toBeNull()
  })

  it('SUPPRESSION ONLY: the state is STUCK with or without the ease claim', () => {
    const withEase = getStatus(1.8, [], null, makeT(), NOON, { modelEaseAt: NOON + 60 * 60 })
    const without  = getStatus(1.8, [], null, makeT(), NOON, {})
    expect(withEase.type).toBe('stuck')
    expect(without.type).toBe('stuck')
    expect(without.sub).toBe('s_stuck')                 // falls back to the honest line
  })

  it('STUCK + model ease in ~60 min → "model expects easing", time kept, state stays STUCK', () => {
    const t = makeT()
    const s = getStatus(1.8, [], null, t, NOON, { modelEaseAt: NOON + 60 * 60 })
    expect(s.type).toBe('stuck')                       // colour/state unchanged
    expect(s.sub).toBe('s_stuck_ease')
    expect(t.varsFor('s_stuck_ease').min).toBe(60)
    expect(s.notice.sub).toBe('n_stuck_ease')          // popup carries it too
  })
  it('far ease (~2 h) → hours form', () => {
    const t = makeT()
    const s = getStatus(1.8, [], null, t, NOON, { modelEaseAt: NOON + 120 * 60 })
    expect(s.sub).toBe('s_stuck_ease_far')
    expect(t.varsFor('s_stuck_ease_far').h).toBe('2')
  })
  it('thunderstorm wording still outranks the ease hint', () => {
    const s = getStatus(4.0, [], { temp: 18, wind: 20, code: 96 }, makeT(), NOON,
      { modelEaseAt: NOON + 60 * 60 })
    expect(s.sub).toBe('s_stuck_storm')
  })
  it('no model ease → plain STUCK unchanged', () => {
    const s = getStatus(1.8, [], null, makeT(), NOON, {})
    expect(s.sub).toBe('s_stuck')
  })
})

// ---- ring watch (v2.4) — approach direction from observed echo ---------------------

describe('ringDirection — dominant compass sector from wet ring points', () => {
  it('single wet sector → that direction', () => {
    expect(ringDirection(['w'])).toBe('w')
    expect(ringDirection(['ne'])).toBe('ne')
  })
  it('adjacent wet sectors resolve to their middle', () => {
    expect(ringDirection(['w', 'nw', 'n'])).toBe('nw')
    expect(['s', 'sw']).toContain(ringDirection(['s', 'sw']))
  })
  it('OPPOSITE sectors cancel → null (scattered cells, not an approach)', () => {
    expect(ringDirection(['n', 's'])).toBeNull()
    expect(ringDirection(['e', 'w'])).toBeNull()
    expect(ringDirection(['n', 'e', 's', 'w'])).toBeNull()
  })
  it('empty / no data → null', () => {
    expect(ringDirection([])).toBeNull()
    expect(ringDirection(null)).toBeNull()
  })
})

describe('getStatus — directional approach + nearby watch (v2.4)', () => {
  it('approach WITH direction → "rain moving in from the west — about 20 min out"', () => {
    const t = makeT()
    const s = getStatus(0, [], null, t, NOON,
      { dryEndsOpen: true, rvApproachMin: 20, rvApproachDir: 'w' })
    expect(s.sub).toBe('s_rv_approach_dir')
    expect(t.varsFor('s_rv_approach_dir').min).toBe(20)
    expect(t.varsFor('s_rv_approach_dir').dir).toBe('dir_w')   // translated direction word
    expect(s.notice.sub).toBe('n_rv_approach_dir')
  })
  it('approach WITHOUT a coherent direction → plain approach wording (unchanged)', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { dryEndsOpen: true, rvApproachMin: 20 })
    expect(s.sub).toBe('s_rv_approach')
  })
  it('NEARBY (echo ~15km out, no arrival ETA) → "keeping an eye on it" lead', () => {
    const t = makeT()
    const s = getStatus(0, [], null, t, NOON,
      { dryEndsOpen: true, rvNearbyDir: 'sw' })
    expect(s.type).toBe('go')                          // state untouched — it's a lead
    expect(s.sub).toBe('s_rv_nearby')
    expect(t.varsFor('s_rv_nearby').dir).toBe('dir_sw')
    expect(s.notice.sub).toBe('n_rv_nearby')
  })
  it('nearby OUTRANKS the forecast hint (observed echo beats expectation)', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { dryEndsOpen: true, rvNearbyDir: 'w', modelRainAt: NOON + 60 * 60 })
    expect(s.sub).toBe('s_rv_nearby')
  })
  it('trace drizzle at the pixel OUTRANKS nearby (here-and-now beats 15km away)', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { dryEndsOpen: true, rvNearbyDir: 'w', traceEcho: true })
    expect(s.sub).toBe('s_trace_now')
  })
  it('an arrival ETA OUTRANKS nearby (approach is the stronger claim)', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { dryEndsOpen: true, rvApproachMin: 25, rvApproachDir: 'w', rvNearbyDir: 'w' })
    expect(s.sub).toBe('s_rv_approach_dir')
  })
  it('nearby suppressed at night (no "keep an eye on it" at 3am)', () => {
    const s = getStatus(0, [], null, makeT(), NIGHT,
      { dryEndsOpen: true, rvNearbyDir: 'w' })
    expect(s.sub).toBe('s_night_clear')
  })
})

// ---- trace-echo acknowledgment (v2.3.0) — the Nonntal "sub-threshold drizzle" case -

describe('hasTraceEcho — DRY_THRESHOLD is a reporting cutoff, not a physical one', () => {
  it('THE LIVE INCIDENT: 0.01–0.06mm widespread trace → acknowledged as trace echo', () => {
    expect(hasTraceEcho(0.01)).toBe(true)
    expect(hasTraceEcho(0.06)).toBe(true)
  })
  it('exact zero → no trace (nothing to acknowledge)', () => {
    expect(hasTraceEcho(0)).toBe(false)
    expect(hasTraceEcho(null)).toBe(false)
  })
  it('at/above DRY_THRESHOLD → not "trace" anymore, real dry-branch/gap logic applies', () => {
    expect(hasTraceEcho(0.1)).toBe(false)
    expect(hasTraceEcho(0.5)).toBe(false)
  })
})

describe('getStatus — trace echo acknowledgment (wording only, GEMMA RAUS stays GEMMA RAUS)', () => {
  it('dry (radar 3h clear) + trace echo + model far rain → combined message, state unchanged', () => {
    const t = makeT()
    const s = getStatus(0, [], null, t, NOON,
      { dryEndsOpen: true, traceEcho: true, modelRainAt: NOON + 150 * 60 })
    expect(s.type).toBe('go')                              // NEVER flips the hard state
    expect(s.sub).toBe('s_trace_now_far')
    expect(t.varsFor('s_trace_now_far').h).toBe('2½')
    expect(s.notice.sub).toBe('n_trace_now_far')
  })

  it('trace echo + NEAR model rain (<90min) → minutes form', () => {
    const t = makeT()
    const s = getStatus(0, [], null, t, NOON,
      { dryEndsOpen: true, traceEcho: true, modelRainAt: NOON + 45 * 60 })
    expect(s.sub).toBe('s_trace_now_min')
    expect(t.varsFor('s_trace_now_min').min).toBe(45)
  })

  it('trace echo with NO model rain data at all → standalone acknowledgment', () => {
    const s = getStatus(0, [], null, makeT(), NOON, { dryEndsOpen: true, traceEcho: true })
    expect(s.sub).toBe('s_trace_now')
  })

  it('night + trace echo → cosy drizzle wording, not an alarming trace message', () => {
    const s = getStatus(0, [], null, makeT(), NIGHT, { dryEndsOpen: true, traceEcho: true })
    expect(s.sub).toBe('s_night_drizzle')
  })

  it('no trace echo → falls through to the existing model second-opinion unaffected', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { dryEndsOpen: true, traceEcho: false, modelRainAt: NOON + 150 * 60 })
    expect(s.sub).toBe('s_model_rain_far')
  })

  it('downpour warning still outranks trace echo (fallback sub path, no wide value)', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { dryEndsOpen: true, traceEcho: true, downpourSoonMin: 12 })
    expect(s.sub).toBe('s_downpour_soon')
  })

  it('RV approach still outranks trace echo', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { dryEndsOpen: true, traceEcho: true, rvApproachMin: 15 })
    expect(s.sub).toBe('s_rv_approach')
  })
})

// ---- traceAheadMin — future sub-threshold drizzle on the radar's own timeline ----

describe('traceAheadMin — foresee the drizzle the reporting cutoff used to hide (v2.5)', () => {
  const mk = (vals, step = 900) => ({
    times: vals.map((_, i) => NOON + i * step),
    precips: vals,
  })

  it('THE FORESIGHT MISS (2026-07-17): 0.01 run starting ~53min out → countdown, not silence', () => {
    // Live data: INCA showed the drizzle field arriving as 0.01mm slots at
    // +53/+68/+83min while the ribbon and verdict claimed a clear 3h.
    const { times, precips } = mk([0, 0, 0, 0.01, 0.01, 0.01, 0.01])
    expect(traceAheadMin(times, precips, NOON)).toBe(45)   // 4th slot = +45 min
  })

  it('trace starting NOW (slot 0) → 0 min', () => {
    const { times, precips } = mk([0.01, 0.02, 0.03])
    expect(traceAheadMin(times, precips, NOON)).toBe(0)
  })

  it('a single isolated 0.01 blip → null (noise, not drizzle)', () => {
    const { times, precips } = mk([0, 0, 0.01, 0, 0, 0])
    expect(traceAheadMin(times, precips, NOON)).toBeNull()
  })

  it('two separate single blips → still null; a later real RUN is found past them', () => {
    const { times, precips } = mk([0, 0.01, 0, 0.01, 0, 0.02, 0.03, 0.02])
    expect(traceAheadMin(times, precips, NOON)).toBe(75)   // the ≥2-slot run at slot 5
  })

  it('fully dry timeline → null', () => {
    const { times, precips } = mk([0, 0, 0, 0, 0, 0])
    expect(traceAheadMin(times, precips, NOON)).toBeNull()
  })

  it('values at/above DRY_THRESHOLD are NOT trace (they are real rain, other tiers own them)', () => {
    const { times, precips } = mk([0, 0, 0.1, 0.2, 0.3])
    expect(traceAheadMin(times, precips, NOON)).toBeNull()
  })

  it('trace beyond the 3h look-ahead is ignored', () => {
    const times = [NOON + 4 * 3600, NOON + 4 * 3600 + 900]
    expect(traceAheadMin(times, [0.02, 0.02], NOON)).toBeNull()
  })

  it('empty/missing input → null', () => {
    expect(traceAheadMin([], [], NOON)).toBeNull()
    expect(traceAheadMin(null, null, NOON)).toBeNull()
  })
})

describe('getStatus — trace-ahead tier (wording only, v2.5)', () => {
  it('radar 3h "dry" but trace run starting in ~50min → drizzle-possible countdown', () => {
    const t = makeT()
    const s = getStatus(0, [], null, t, NOON, { dryEndsOpen: true, traceAheadMin: 50 })
    expect(s.type).toBe('go')                              // state untouched
    expect(s.sub).toBe('s_trace_ahead')
    expect(t.varsFor('s_trace_ahead').min).toBe(50)
    expect(s.notice.sub).toBe('n_trace_ahead')
  })

  it('far trace (≥90min) → hours wording', () => {
    const t = makeT()
    const s = getStatus(0, [], null, t, NOON, { dryEndsOpen: true, traceAheadMin: 150 })
    expect(s.sub).toBe('s_trace_ahead_far')
    expect(t.varsFor('s_trace_ahead_far').h).toBe('2½')
  })

  it('trace at the pixel NOW (traceEcho) outranks trace-ahead', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { dryEndsOpen: true, traceEcho: true, traceAheadMin: 30 })
    expect(s.sub).toBe('s_trace_now')
  })

  it('nearby-watch (observed echo now) outranks trace-ahead', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { dryEndsOpen: true, rvNearbyDir: 'w', traceAheadMin: 30 })
    expect(s.sub).toBe('s_rv_nearby')
  })

  it('trace-ahead outranks the model second-opinion (radar trace beats a model guess)', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { dryEndsOpen: true, traceAheadMin: 40, modelRainAt: NOON + 150 * 60 })
    expect(s.sub).toBe('s_trace_ahead')
  })

  it('a real radar countdown (nextRainAt, not dryEndsOpen) is unaffected by trace-ahead', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { dryEndsOpen: false, nextRainAt: NOON + 30 * 60, traceAheadMin: 15 })
    expect(s.sub).toBe('s_rain_soon')
  })

  it('night → stays cosy, no trace-ahead alarm', () => {
    const s = getStatus(0, [], null, makeT(), NIGHT, { dryEndsOpen: true, traceAheadMin: 30 })
    expect(s.sub).toBe('s_night_clear')
  })
})

// ---- isUnsettled — convective-watch Layer 1 (regime flag, banner only) ------------

describe('isUnsettled — CAPE flags the fuel, probability confirms the trigger', () => {
  it('contract: CAPE ≥ 300 AND max prob ≥ 50, afternoon only (11:00–19:59)', () => {
    expect(UNSETTLED_CAPE).toBe(300)
    expect(UNSETTLED_PROB).toBe(50)
  })
  it('the soaking day (CAPE 400, prob 60, 14:00) → unsettled', () => {
    expect(isUnsettled(400, 60, 14)).toBe(true)
  })
  it('the sunny-clutter day (CAPE 200, prob 53) → NOT unsettled (fuel too low)', () => {
    expect(isUnsettled(200, 53, 14)).toBe(false)
  })
  it('fuel without trigger (CAPE 400, prob 30) → NOT unsettled', () => {
    expect(isUnsettled(400, 30, 14)).toBe(false)
  })
  it('outside convective hours (09:00 / 20:00) → NOT unsettled', () => {
    expect(isUnsettled(400, 60, 9)).toBe(false)
    expect(isUnsettled(400, 60, 20)).toBe(false)
  })
  it('missing data → never flags (no data, no claim)', () => {
    expect(isUnsettled(null, 60, 14)).toBe(false)
    expect(isUnsettled(400, null, 14)).toBe(false)
  })
})

// ---- firstDownpourMin ------------------------------------------------------------

describe('firstDownpourMin — radar downpour lookout', () => {
  it('3.4mm cell at +20 min (the Nonntal case) → warns ~20', () => {
    const nc = timeline(NOON, [0.1, 3.4, 2.6, 0.5])
    expect(firstDownpourMin(nc, NOON)).toBe(15)
  })
  it('heavy rain outside the 30-min window → no warning (yet)', () => {
    const nc = timeline(NOON, [0, 0, 0, 4.4, 2.6])   // heavy at +45 min
    expect(firstDownpourMin(nc, NOON)).toBeNull()
  })
  it('light drizzle only → never warns', () => {
    const nc = timeline(NOON, [0.3, 0.4, 0.2, 0.3])
    expect(firstDownpourMin(nc, NOON)).toBeNull()
  })
  it('no nowcast → null (no data, no claim)', () => {
    expect(firstDownpourMin(null, NOON)).toBeNull()
  })
})

describe('combineModelSeries — forecast lane is the UNION of both models (v2.7)', () => {
  // Contract: whichever model shows rain is displayed; the stronger value wins
  // per slot. AROME values are mm-per-HOUR and scale to the slot width (15 min
  // slots -> x0.25). An AROME timestamp is the END of its accumulation hour.
  const t15 = (n) => Array.from({ length: n }, (_, i) => NOON + 900 * i)

  it('no AROME -> Open-Meteo series unchanged', () => {
    const times = t15(4), om = [0, 0.2, 0, 0.4]
    expect(combineModelSeries(times, om, null, null)).toEqual(om)
    expect(combineModelSeries(times, om, [], [])).toEqual(om)
  })

  it('AROME rain where Open-Meteo is dry -> displayed (scaled to 15-min slots)', () => {
    const times = t15(4)                       // NOON .. NOON+45
    const aT = [NOON + 3600], aP = [2.0]       // 2 mm in the hour ENDING at NOON+1h
    const out = combineModelSeries(times, [0, 0, 0, 0], aT, aP)
    // slots NOON+15/+30/+45 fall inside (NOON, NOON+1h] ... slot at NOON is the hour boundary of the PREVIOUS hour
    expect(out[1]).toBeCloseTo(0.5)
    expect(out[2]).toBeCloseTo(0.5)
    expect(out[3]).toBeCloseTo(0.5)
  })

  it('stronger wins per slot, both directions', () => {
    const times = t15(2)
    // om 0.3 vs arome 0.8mm/h -> 0.2 per slot: om wins
    expect(combineModelSeries(times, [0.3, 0.3], [NOON + 3600], [0.8])[1]).toBeCloseTo(0.3)
    // om 0.1 vs arome 4.0mm/h -> 1.0 per slot: arome wins
    expect(combineModelSeries(times, [0.1, 0.1], [NOON + 3600], [4.0])[1]).toBeCloseTo(1.0)
  })

  it('an AROME hour only covers its own slots — no smearing into other hours', () => {
    const times = t15(8)                       // 2 h of slots
    const aT = [NOON + 3600, NOON + 7200], aP = [0, 2.0]
    const out = combineModelSeries(times, new Array(8).fill(0), aT, aP)
    expect(out[1]).toBe(0)                     // first hour: arome dry
    expect(out[5]).toBeCloseTo(0.5)            // second hour: 2mm/h -> 0.5/slot
  })

  it('holes in either input are safe (missing precips -> 0)', () => {
    const times = t15(3)
    const out = combineModelSeries(times, [0.2], [NOON + 3600], [1.2])
    expect(out).toHaveLength(3)
    expect(out[0]).toBeCloseTo(0.2)
    expect(out[1]).toBeCloseTo(0.3)            // 1.2/4 beats missing om (0)
  })

  it('empty base timeline -> empty result (nothing invented)', () => {
    expect(combineModelSeries([], [], [NOON], [3])).toEqual([])
  })
})

describe('tracePhantom — dual-key phantom-trace guard (v2.8)', () => {
  // Contract: suppress the trace TIER only when BOTH keys agree — sky clear
  // (code <= 2, same veto band as surfaceDrizzle) AND RainViewer fully quiet
  // (pixel dry, no approach ETA, no ring echo, no solid field). Either witness
  // dissenting, or RainViewer unavailable -> keep the trace. Never touches real
  // slots, downpours or countdowns (those never consult this fn).
  const quietRV = { now: 0, approachMin: null, fromDir: null, rvSolid: false }

  it('cloudless sky + fully quiet RainViewer -> phantom (the 2026-07-17 carpet)', () => {
    expect(tracePhantom(0, quietRV)).toBe(true)
    expect(tracePhantom(2, quietRV)).toBe(true)   // same <=2 band as surfaceDrizzle
  })

  it('THE USER SCENARIO: rain approaching while the local sky is still clear -> NOT phantom', () => {
    // RV forecast frames see the moving echo before any cloud is overhead —
    // the RV key releases, trace wording stays. This must never regress.
    expect(tracePhantom(0, { ...quietRV, approachMin: 40 })).toBe(false)
  })

  it('ring echo in some sector (~15 km out) -> NOT phantom, even under clear sky', () => {
    expect(tracePhantom(0, { ...quietRV, fromDir: 'W' })).toBe(false)
  })

  it('wet centre pixel or solid RV field -> NOT phantom', () => {
    expect(tracePhantom(0, { ...quietRV, now: 0.3 })).toBe(false)
    expect(tracePhantom(0, { ...quietRV, rvSolid: true })).toBe(false)
  })

  it('any cloud beyond mostly-clear (code >= 3) -> NOT phantom (pop-up cells build towers first)', () => {
    expect(tracePhantom(3, quietRV)).toBe(false)
    expect(tracePhantom(61, quietRV)).toBe(false)
  })

  it('sky unknown -> NOT phantom (no free pass, mirrors surfaceDrizzle v2.2.1)', () => {
    expect(tracePhantom(null, quietRV)).toBe(false)
    expect(tracePhantom(undefined, quietRV)).toBe(false)
  })

  it('RainViewer unavailable -> NOT phantom (cannot corroborate absence)', () => {
    expect(tracePhantom(0, null)).toBe(false)
    expect(tracePhantom(0, { ...quietRV, now: null })).toBe(false)   // tile read failed
  })
})





// ---- v2.29.0: RainViewer intensity — the 2026-08-21 convective-onset miss --------
//
// Incident: a convective shower (METAR LOWS 15:50Z -SHRA, wind 7kt → 19G29kt) sat
// over the city at ~17:50 CEST. TAWES read 0.0 at all 11 points (tipping bucket had
// not tipped, still 0.0 eight minutes later); the served nowcast's current slot read
// 0.00 (issued 17:45, radar-extrapolated from ~17:25). RainViewer was the ONLY
// instrument that saw it — 25/25 wet px with deep-blue cores at the user's pixel —
// but the sampler read only the alpha channel, so EVERY echo scored a flat 0.3,
// which sits dead centre of the light band. Verdict: PASST SCHON, in a downpour.
// The same 0.3 was produced by the 16:40 frame, which was pure trace.

describe('rvNowValue — RainViewer echo carries its intensity, not a flat 0.3', () => {
  it('THE CONVECTIVE-ONSET MISS (2026-08-21): heavy + solid echo → raised out of the light band', () => {
    expect(rvNowValue(0.3, true, true, 61)).toBe(RV_HEAVY_MM)
    // the whole point: it must be able to reach WAIT / BLEIB DRIN
    expect(RV_HEAVY_MM).toBeGreaterThan(LIGHT_MAX)
  })

  it('heavy but NOT block-filling (a stuck clutter pixel) → stays the drizzle value', () => {
    expect(rvNowValue(0.3, true, false, 61)).toBe(0.3)
  })

  it('block-filling but NOT heavy (a broad trace field) → stays the drizzle value', () => {
    // this is the v2.4.1 drizzle case — it must keep surfacing as GO ANYWAY, not escalate
    expect(rvNowValue(0.3, false, true, 3)).toBe(0.3)
  })

  it('clear sky is an absolute veto (the v1.1.5 sunny-clutter bug stays dead)', () => {
    expect(rvNowValue(0.3, true, true, 0)).toBe(0.3)
    expect(rvNowValue(0.3, true, true, 1)).toBe(0.3)
    expect(rvNowValue(0.3, true, true, 2)).toBe(0.3)
    // …but overcast / raining codes are not vetoed
    expect(rvNowValue(0.3, true, true, 3)).toBe(RV_HEAVY_MM)
  })

  it('RAISE-ONLY invariant: can never return less than it was given', () => {
    for (const rv of [0, 0.3, 0.9, 2.0]) {
      for (const heavy of [true, false]) {
        for (const solid of [true, false]) {
          for (const code of [null, 0, 2, 3, 61, 95]) {
            expect(rvNowValue(rv, heavy, solid, code)).toBeGreaterThanOrEqual(rv)
          }
        }
      }
    }
  })

  it('an already-heavier reading is never dragged DOWN to the constant', () => {
    expect(rvNowValue(2.0, true, true, 61)).toBe(2.0)
  })

  it('defaults are inert — a bare call behaves exactly as the old binary value did', () => {
    expect(rvNowValue(0.3)).toBe(0.3)
    expect(rvNowValue(0)).toBe(0)
  })
})

describe('surfaceDrizzle — the heavy branch (v2.29.0)', () => {
  it('THE INCIDENT REPLAY: gauge dry, nowcast slot exactly 0.00, heavy solid RV → surfaced UNCAPPED', () => {
    const v = surfaceDrizzle(0, 0, RV_HEAVY_MM, 61, true)
    expect(v).toBe(RV_HEAVY_MM)
    expect(v).toBeGreaterThan(LIGHT_MAX)   // NOT squeezed back into "go anyway"
  })

  it('what shipped the bug: the flat 0.3 lands mid light band (pinned as the contrast)', () => {
    const v = surfaceDrizzle(0, 0, 0.3, 61, true)
    expect(v).toBe(0.3)
    expect(v).toBeGreaterThanOrEqual(LIGHT_MIN)
    expect(v).toBeLessThan(LIGHT_MAX)
  })

  it('heavy echo under a CLEAR sky still does not surface', () => {
    expect(surfaceDrizzle(0, 0, RV_HEAVY_MM, 0, true)).toBeNull()
    expect(surfaceDrizzle(0, 0, RV_HEAVY_MM, 2, true)).toBeNull()
  })

  it('heavy but not solid → no escalation (falls through to the light-band rules)', () => {
    expect(surfaceDrizzle(0, 0, RV_HEAVY_MM, 61, false)).toBeNull()
  })

  it('a reporting wet gauge still owns the NOW magnitude', () => {
    expect(surfaceDrizzle(0.3, 0, RV_HEAVY_MM, 61, true)).toBeNull()
  })

  it('a heavy NOWCAST slot with no RV echo is UNCHANGED — still the ground dry call', () => {
    // pinned so the new branch cannot be reached by the nowcast on its own
    expect(surfaceDrizzle(0, 0.8, 0, 3, true)).toBeNull()
    expect(surfaceDrizzle(0, 2.0, 0, 61, true)).toBeNull()
  })
})

describe('END TO END — the 2026-08-21 verdict', () => {
  // The served nowcast at 17:45 CEST, Altstadt (from /api/ambient): dry in the two
  // current slots because the extrapolation had not caught the cell yet, rain from
  // 18:15. Meanwhile RainViewer had a heavy, block-filling echo on the pixel.
  const SERIES = [0, 0, 0.55, 1.14, 0.32, 0.18, 0.24, 0.18, 0.24, 0.2, 0.2, 0.2]

  it('with the OLD flat 0.3 the app said GO ANYWAY (the reported bug)', () => {
    const tl = liveTimeline(SERIES)
    const { gaps } = detectGaps(tl.times, tl.precips)
    const now = Math.floor(Date.now() / 1000)
    const s = getStatus(0.3, gaps, null, makeT(), now, { rvRainActive: true })
    expect(s.type).toBe('light')          // PASST SCHON — in a convective shower
  })

  it('with the heavy value surfaced it is no longer a go-outside verdict', () => {
    const tl = liveTimeline(SERIES)
    const { gaps } = detectGaps(tl.times, tl.precips)
    const now = Math.floor(Date.now() / 1000)
    const s = getStatus(RV_HEAVY_MM, gaps, null, makeT(), now, { rvRainActive: true })
    expect(s.type).not.toBe('go')
    expect(s.type).not.toBe('light')
    expect(['wait', 'stuck']).toContain(s.type)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// v2.30 — the day outlook (sky line + five-day strip).
//
// DISPLAY ONLY: none of these functions is reachable from getStatus, a countdown
// or effectivePrecip. What they must never do is make a claim the data does not
// support — an invented dry window is a lag in disguise (someone plans around it
// and gets rained on), so the tests below pin the REFUSALS as hard as the results.
// ─────────────────────────────────────────────────────────────────────────────

describe('v2.30 dayBuckets — hourly mm converted onto the app’s own slot scale', () => {
  // Every threshold in gaps.js is calibrated on 15-MIN slots. Open-Meteo hourly
  // precipitation is mm per HOUR. Getting this wrong is exactly the v2.21.0 gauge
  // incident, so the conversion is pinned as a constant, not a magic number.
  it('HOUR_TO_SLOT is a quarter — one hour is four slots', () => {
    expect(HOUR_TO_SLOT).toBe(1 / 4)
  })

  const day0 = 1757800800            // an arbitrary local midnight
  const day1 = day0 + 86400
  const hours = (vals, start = day0) => ({
    t: vals.map((_, i) => start + i * 3600),
    p: vals.slice(),
  })

  it('buckets 24 hours into DAY_BUCKETS blocks on the slot scale', () => {
    const h = hours(Array.from({ length: 24 }, () => 0.4))   // 0.4 mm/h everywhere
    const b = dayBuckets(h.t, h.p, day0, day1)
    expect(b).toHaveLength(DAY_BUCKETS)
    expect(b.every(v => Math.abs(v - 0.1) < 1e-9)).toBe(true)  // 0.4 mm/h = 0.1 / slot
  })

  it('takes the MAX in a bucket, never the mean — one wet hour makes a wet block', () => {
    const vals = new Array(24).fill(0)
    vals[3] = 8                                    // one downpour hour
    const h = hours(vals)
    const b = dayBuckets(h.t, h.p, day0, day1)
    expect(b[1]).toBeCloseTo(2, 6)                 // bucket covering hours 2–3
    expect(b[0]).toBe(0)                           // neighbours untouched
    expect(b[2]).toBe(0)
  })

  it('returns null for a day the series does not cover — unknown is not dry', () => {
    const h = hours(new Array(24).fill(0))
    expect(dayBuckets(h.t, h.p, day1, day1 + 86400)).toBeNull()
    expect(dayBuckets([], [], day0, day1)).toBeNull()
    expect(dayBuckets(null, null, day0, day1)).toBeNull()
  })

  it('ignores hours outside the day and non-numeric readings', () => {
    const h = hours([0, 0, 5, 0], day0 - 4 * 3600)  // all BEFORE the day
    expect(dayBuckets(h.t, h.p, day0, day1)).toBeNull()
    const mixed = hours([1, null, undefined, 'x', 2])
    const b = dayBuckets(mixed.t, mixed.p, day0, day1)
    expect(b[0]).toBeCloseTo(0.25, 6)               // 1 mm/h in the first block
  })
})

describe('v2.30 bestWindow — a named dry stretch, or nothing', () => {
  const day0 = 1757800800
  const day1 = day0 + 86400
  const series = vals => ({
    t: vals.map((_, i) => day0 + i * 3600),
    p: vals.slice(),
  })

  it('finds the longest dry run and reports its real start and end', () => {
    const vals = new Array(24).fill(1)
    for (let i = 9; i < 15; i++) vals[i] = 0        // 09:00–15:00 dry
    const s = series(vals)
    const w = bestWindow(s.t, s.p, day0, day1)
    expect(w).not.toBeNull()
    expect(w.start).toBe(day0 + 9 * 3600)
    expect(w.end).toBe(day0 + 15 * 3600)
  })

  it('refuses a stretch shorter than BEST_WINDOW_MIN_H', () => {
    const vals = new Array(24).fill(1)
    vals[10] = 0; vals[11] = 0                      // only 2 dry hours
    const s = series(vals)
    expect(BEST_WINDOW_MIN_H).toBe(3)
    expect(bestWindow(s.t, s.p, day0, day1)).toBeNull()
  })

  it('uses the SAME DRY_THRESHOLD as the rest of the app, in the hourly unit', () => {
    // 0.4 mm/h converts to exactly DRY_THRESHOLD — which is NOT dry (the test is
    // `< DRY_THRESHOLD`), so a day of it has no window at all.
    const wetAtTheLine = series(new Array(24).fill(DRY_THRESHOLD / HOUR_TO_SLOT))
    expect(bestWindow(wetAtTheLine.t, wetAtTheLine.p, day0, day1)).toBeNull()
    // A hair under the line is dry, and the whole day becomes one window.
    const justUnder = series(new Array(24).fill(DRY_THRESHOLD / HOUR_TO_SLOT - 0.01))
    expect(bestWindow(justUnder.t, justUnder.p, day0, day1)).not.toBeNull()
  })

  it('a hole in the series BREAKS the run — a missing hour is never counted dry', () => {
    // 4 dry hours, but the third is absent from the series entirely.
    const t = [day0 + 8 * 3600, day0 + 9 * 3600, day0 + 11 * 3600, day0 + 12 * 3600]
    const p = [0, 0, 0, 0]
    expect(bestWindow(t, p, day0, day1)).toBeNull()
  })

  it('never invents a window from empty or malformed data', () => {
    expect(bestWindow([], [], day0, day1)).toBeNull()
    expect(bestWindow(null, null, day0, day1)).toBeNull()
    const s = series(new Array(24).fill(0))
    expect(bestWindow(s.t, s.p, day1, day1 + 86400)).toBeNull()   // wrong day
  })

  it('user scenario: a washed-out day names no window at all', () => {
    // The release scenario in reverse — the strip must be able to say "nothing".
    const s = series(new Array(24).fill(2.5))
    expect(bestWindow(s.t, s.p, day0, day1)).toBeNull()
  })
})

describe('v2.30 weatherGroup — WMO code → glyph family', () => {
  it('maps each family to the right glyph', () => {
    expect(weatherGroup(0)).toBe('clear')
    expect(weatherGroup(1)).toBe('partly')
    expect(weatherGroup(2)).toBe('partly')
    expect(weatherGroup(3)).toBe('cloudy')
    expect(weatherGroup(45)).toBe('fog')
    expect(weatherGroup(51)).toBe('drizzle')
    expect(weatherGroup(57)).toBe('drizzle')
    expect(weatherGroup(61)).toBe('rain')
    expect(weatherGroup(65)).toBe('rain')
    expect(weatherGroup(71)).toBe('snow')
    expect(weatherGroup(86)).toBe('snow')
    expect(weatherGroup(80)).toBe('showers')
    expect(weatherGroup(82)).toBe('showers')
    expect(weatherGroup(95)).toBe('thunder')
    expect(weatherGroup(99)).toBe('thunder')
  })

  it('a thunderstorm never renders as anything but thunder', () => {
    // The failure that matters: a storm code landing in a calm family would put a
    // sun over a thunderstorm while the banner below says "stay safe".
    for (const c of [95, 96, 99]) expect(weatherGroup(c)).toBe('thunder')
  })

  it('unknown or absent code → null, so nothing is drawn rather than guessed', () => {
    expect(weatherGroup(null)).toBeNull()
    expect(weatherGroup(undefined)).toBeNull()
    expect(weatherGroup('61')).toBeNull()
    expect(weatherGroup(NaN)).toBeNull()
    expect(weatherGroup(4)).toBeNull()
  })
})

describe('v2.30.1 bestWindow — a window nobody can use is not a window', () => {
  // THE LIVE BUG. The first real /api/ambient payload offered
  //   "best window: Wed 16 Sept 00:00–19:00"
  // on a day carrying 22 mm and a thunderstorm, and
  //   "best window: Fri 18 Sept 00:00–00:00"
  // for a day that was dry end to end. Both were arithmetically correct and both
  // were unusable: the dry stretch simply started at midnight. Night hours are dry
  // far more often than daylight ones, so counting them also let a night-dry day
  // outrank a genuinely good afternoon later in the week.
  const day0 = 1757800800
  const day1 = day0 + 86400
  const sunrise = day0 + 7 * 3600
  const sunset  = day0 + 19 * 3600
  const light = { from: sunrise, to: sunset }
  const series = vals => ({ t: vals.map((_, i) => day0 + i * 3600), p: vals.slice() })

  it('a dry night before a wet day yields NO window', () => {
    const vals = new Array(24).fill(2)          // wet all day…
    for (let i = 0; i < 6; i++) vals[i] = 0     // …except 00:00–06:00
    const s = series(vals)
    // Without daylight bounds this was a confident 6-hour window at 3 in the morning.
    expect(bestWindow(s.t, s.p, day0, day1)).not.toBeNull()
    expect(bestWindow(s.t, s.p, day0, day1, light)).toBeNull()
  })

  it('an all-dry day reports the daylight span, never 00:00–00:00', () => {
    const s = series(new Array(24).fill(0))
    const w = bestWindow(s.t, s.p, day0, day1, light)
    expect(w.start).toBe(sunrise)
    expect(w.end).toBe(sunset)                  // a real range, not midnight to midnight
  })

  it('replays the live Wednesday: dry until 18:00, offered from sunrise only', () => {
    const vals = new Array(24).fill(0)
    for (let i = 18; i < 24; i++) vals[i] = 3   // the storm, 18:00 onwards
    const s = series(vals)
    const w = bestWindow(s.t, s.p, day0, day1, light)
    expect(w.start).toBe(sunrise)               // not 00:00
    expect(w.end).toBe(day0 + 18 * 3600)        // rain, correctly, ends it
  })

  it('a night-dry day can no longer outrank a good afternoon', () => {
    const nightDry = series(new Array(24).fill(2).map((v, i) => (i < 7 ? 0 : v)))
    const afternoon = series(new Array(24).fill(2).map((v, i) => (i >= 13 && i < 19 ? 0 : v)))
    const a = bestWindow(nightDry.t, nightDry.p, day0, day1, light)
    const b = bestWindow(afternoon.t, afternoon.p, day0, day1, light)
    expect(a).toBeNull()
    expect(b.end - b.start).toBe(6 * 3600)
  })

  it('no daylight info → unchanged pre-v2.30.1 behaviour', () => {
    const vals = new Array(24).fill(2)
    for (let i = 0; i < 6; i++) vals[i] = 0
    const s = series(vals)
    const plain = bestWindow(s.t, s.p, day0, day1)
    expect(plain.start).toBe(day0)
    // A malformed or reversed daylight pair is ignored rather than trusted.
    expect(bestWindow(s.t, s.p, day0, day1, { from: sunset, to: sunrise })).toEqual(plain)
    expect(bestWindow(s.t, s.p, day0, day1, { from: null, to: null })).toEqual(plain)
  })

  it('an hour only PARTLY in daylight does not count — the promise stays conservative', () => {
    // Sunrise at 07:30: the 07:00 hour is not fully inside daylight, so a window
    // starts at 08:00 rather than claiming half an hour of darkness.
    const s = series(new Array(24).fill(0))
    const w = bestWindow(s.t, s.p, day0, day1, { from: day0 + 7.5 * 3600, to: sunset })
    expect(w.start).toBe(day0 + 8 * 3600)
  })
})

describe('v2.30.1 preferWindow — the drier day wins an equal window', () => {
  // The SECOND live finding, immediately after clipping to daylight: every day in
  // the real payload produced the same 12-hour daylight window, so length stopped
  // discriminating and the earliest-day tiebreak offered Wednesday — 22 mm and a
  // thunderstorm, arriving right after sunset — ahead of a clean Friday. The
  // headline sat directly above its own row reading "100% · 22 mm".
  const d = (start, hours, rain, day = start) => ({ start, end: start + hours * 3600, rain, day })

  it('longer window always wins, whatever the rain', () => {
    const long = d(0, 8, 20), short = d(0, 4, 0)
    expect(preferWindow(long, short)).toBe(long)
    expect(preferWindow(short, long)).toBe(long)
  })

  it('equal window → the day with less total rain', () => {
    const storm = d(0, 12, 22), clean = d(86400, 12, 0)
    expect(preferWindow(storm, clean)).toBe(clean)
    expect(preferWindow(clean, storm)).toBe(clean)
  })

  it('a sub-millimetre difference does NOT send the user a day later', () => {
    // Live: Friday 0.1 mm vs Saturday 0.0 mm, identical 12 h windows. An exact
    // comparison picked Saturday. A tenth of a millimetre across a whole day is not
    // worth waiting another day for.
    const friday = d(0, 12, 0.1), saturday = d(86400, 12, 0)
    expect(preferWindow(friday, saturday)).toBe(friday)
  })

  it('equal window AND equal rain → the earlier day keeps it', () => {
    const earlier = d(0, 12, 0), later = d(86400, 12, 0)
    expect(preferWindow(earlier, later)).toBe(earlier)
  })

  it('an unknown rain total never displaces a measured dry day', () => {
    const unknown = d(0, 12, null), dry = d(86400, 12, 0)
    expect(preferWindow(unknown, dry)).toBe(dry)
    expect(preferWindow(dry, unknown)).toBe(dry)
  })

  it('null-safe, so it folds over a list', () => {
    const w = d(0, 6, 1)
    expect(preferWindow(null, w)).toBe(w)
    expect(preferWindow(w, null)).toBe(w)
    expect(preferWindow(null, null)).toBeNull()
  })
})

describe('v2.33 radarZoneEnd — the radar zone never outgrows the doctrine', () => {
  const now = 1757800800

  it('LOOK_AHEAD is the single definition of how far radar is trusted', () => {
    expect(LOOK_AHEAD).toBe(3 * 3600)
  })

  it('a normal 3 h nowcast passes straight through', () => {
    const end = now + 2.66 * 3600
    expect(radarZoneEnd(end, now)).toBe(end)
  })

  it('THE INCIDENT: a 6 h series is clamped to 3 h', () => {
    // 2026-09-15: GeoSphere returned 24 slots (+5.66 h) for bahnhof and lehen while
    // the other nine city points still returned 12. The band read "RADAR · NEXT 5½ H"
    // at one address and 2½ h at the next.
    expect(radarZoneEnd(now + 5.66 * 3600, now)).toBe(now + LOOK_AHEAD)
  })

  it('only ever shrinks the zone, never extends it', () => {
    for (const h of [0, 0.5, 1, 2.5, 3, 4, 6, 12]) {
      const end = now + h * 3600
      expect(radarZoneEnd(end, now)).toBeLessThanOrEqual(end)
      expect(radarZoneEnd(end, now)).toBeLessThanOrEqual(now + LOOK_AHEAD)
    }
  })

  it('malformed input collapses the zone rather than inventing one', () => {
    expect(radarZoneEnd(undefined, now)).toBe(now)
    expect(radarZoneEnd(Infinity, now)).toBe(now)
    expect(radarZoneEnd(NaN, now)).toBe(now)
  })
})

describe('v2.34 hasRadarZone — "the first 0 h are radar" is not a sentence', () => {
  const now = 1757800800

  it('a normal nowcast has a radar zone', () => {
    expect(hasRadarZone(now + 2.66 * 3600, now, true)).toBe(true)
  })

  it('THE REPORT: a zone too thin to name is not a radar zone', () => {
    // hoursLabel rounds to the nearest half hour, so anything under 15 min renders
    // as "0" — and the caption read "the first 0 h are radar — what is actually
    // falling", which is a sentence about nothing.
    expect(hasRadarZone(now + 5 * 60, now, true)).toBe(false)
    expect(hasRadarZone(now + 14 * 60, now, true)).toBe(false)
    expect(hasRadarZone(now + MIN_RADAR_ZONE_MIN * 60, now, true)).toBe(true)
  })

  it('the threshold sits clear of the hoursLabel rounding edge', () => {
    // Anything this predicate lets through must render as a non-zero span, or the
    // bug comes straight back in a narrower band.
    expect(MIN_RADAR_ZONE_MIN).toBeGreaterThan(15)
    expect(radarSpanLabel(now + MIN_RADAR_ZONE_MIN * 60, now)).not.toBe('0')
  })

  it('a model-only fallback timeline never claims a radar zone', () => {
    expect(hasRadarZone(now + 3 * 3600, now, false)).toBe(false)
  })

  it('an expired or unknown boundary claims nothing', () => {
    expect(hasRadarZone(now - 600, now, true)).toBe(false)
    expect(hasRadarZone(undefined, now, true)).toBe(false)
    expect(hasRadarZone(Infinity, now, true)).toBe(false)
    expect(hasRadarZone(now + 3 * 3600, NaN, true)).toBe(false)
  })

  it('agrees with radarZoneEnd across a full series matrix', () => {
    // The two are used together: App.jsx clamps the boundary, the ribbon decides
    // whether what is left is worth drawing as radar. A clamped 6 h series is still
    // a real zone; a series that has run out is not.
    expect(hasRadarZone(radarZoneEnd(now + 5.66 * 3600, now), now, true)).toBe(true)
    expect(hasRadarZone(radarZoneEnd(now - 60, now), now, true)).toBe(false)
  })
})
