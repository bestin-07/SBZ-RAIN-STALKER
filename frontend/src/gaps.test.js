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
  DRY_THRESHOLD, LIGHT_MIN, LIGHT_MAX, DOWNPOUR_MM, DOWNPOUR_WINDOW_MIN,
  UNSETTLED_CAPE, UNSETTLED_PROB,
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
  it('dry now but downpour in 12 min → GO with TOP-PRIORITY heavy-rain sub', () => {
    const s = getStatus(0, [], null, makeT(), NOON, { dryEndsOpen: true, downpourSoonMin: 12 })
    expect(s.type).toBe('go')
    expect(s.sub).toBe('s_downpour_soon')   // outranks "clear for hours"
  })

  it('drizzling now + downpour in 8 min → GO ANYWAY but warns, not the casual sub', () => {
    const s = getStatus(0.3, [], null, makeT(), NOON, { downpourSoonMin: 8 })
    expect(s.type).toBe('light')
    expect(s.sub).toBe('s_downpour_soon')
  })

  it('notice (map popup voice) also carries the downpour warning', () => {
    const s = getStatus(0, [], null, makeT(), NOON, { dryEndsOpen: true, downpourSoonMin: 12 })
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

  it('thunder hazard ALWAYS shows, even while raining', () => {
    const s = getStatus(1.2, [], { temp: 18, wind: 20, code: 95 }, makeT(), NOON, noTrend)
    expect(s.weather).toBe('weather_thunder')
  })

  it('overcast 25°C is NOT "perfect" (needs clear sky, code ≤ 2)', () => {
    const s = getStatus(0, [], { temp: 25, wind: 5, code: 3 }, makeT(), NOON, { dryEndsOpen: true })
    expect(s.weather).not.toBe('weather_perfect')
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

// ---- surfaceDrizzle — gauge-blind drizzle + the clear-sky clutter guard -----------

describe('surfaceDrizzle — catch what the gauges miss, reject sunny clutter', () => {
  // args: (groundPrecip, rawNowSlot [filtered nowcast at now], rvPrecip, weather_code)

  it('THE SUNNY-CLUTTER BUG (v1.1.5): RV-only echo under a clear sky → NOT surfaced', () => {
    // Nonntal, sunny like crazy: gauge 0, nowcast 0, model code 1 (sunny),
    // raw RainViewer pixel shows clutter echo 0.3 → must stay GEMMA RAUS.
    expect(surfaceDrizzle(0, 0, 0.3, 1)).toBeNull()
    expect(surfaceDrizzle(0, 0, 0.3, 0)).toBeNull()
    expect(surfaceDrizzle(0, 0, 0.3, 2)).toBeNull()
  })

  it('RV-only echo under an OVERCAST sky → surfaced (real drizzle the gauges miss)', () => {
    expect(surfaceDrizzle(0, 0, 0.3, 3)).toBe(0.3)      // overcast
    expect(surfaceDrizzle(0, 0, 0.3, 61)).toBe(0.3)     // rain code
    expect(surfaceDrizzle(0, 0, 0.3, null)).toBe(0.3)   // sky unknown → don't assume clutter
  })

  it('filtered-nowcast echo surfaces even under a clear sky (clutter-filtered source)', () => {
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

  it('downpour warning still outranks everything', () => {
    const s = getStatus(0, [], null, makeT(), NOON,
      { dryEndsOpen: true, rvApproachMin: 20, downpourSoonMin: 12 })
    expect(s.sub).toBe('s_downpour_soon')
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
