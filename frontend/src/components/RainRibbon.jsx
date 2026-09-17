import { useCallback, useEffect, useRef, useState } from 'react'
import { showGhost, radarSpanLabel, hasRadarZone, hoursLabel, LIGHT_MIN, LIGHT_MAX } from '../gaps'

const SLOT_W = 46
// v2.37 — bars became a filled skyline (area + line), maintainer-directed
// redesign after a design-comparison pass (three drawing options mocked up,
// this one picked). CHART_H replaces the old SLOT_H: it's the same footprint
// as before (old BAND_H 5 + SLOT_H 76 = 81), just no longer split into a
// separate zone-tint rail — solid-fill-vs-dashed-line now carries "measured
// vs estimated" on its own, so the rail was pure redundancy once the chart
// itself already answers that question by shape. Total canvas height is
// therefore UNCHANGED from before (81 + BRACKET_H + LABEL_H), so nothing
// downstream in the page layout shifts.
const CHART_H = 81
// v2.23: dedicated strip for the time labels UNDER the chart. They used to be
// drawn inside the bar area, so every bar taller than ~10px covered its own
// timestamp — and with the rescaled bars, essentially every wet bar did.
const LABEL_H = 15
// v2.23: one point per 30 minutes (was 15) end to end — the app never
// promises a break shorter than 30 min (MIN_GAP_SLOTS = 2), so 15-min
// resolution drew detail the verdict cannot act on, and 49 of them across
// 12 h read as noise, not a shape.
// v2.39 — split back to 15 min, but ONLY inside the radar zone (maintainer
// ask): that's real, measured, ~2.5h of data, and the coarser 30-min step
// was throwing detail away exactly where the app has the most to show. The
// forecast/model zone keeps the original 30-min reasoning above — it's an
// hourly-probability ESTIMATE, and 15-min ticks on top of that would be
// false precision, not more information.
const RADAR_BUCKET_S = 15 * 60
const MODEL_BUCKET_S = 30 * 60
// v2.35: strip between the chart and the time labels, for the dry-window
// bracket. Always reserved rather than added only when a bracket exists — a
// canvas that changes height between refreshes shifts everything below it,
// and this app is read in two-second glances.
const BRACKET_H = 12
// 1 "now" anchor + 48 × 15-min steps = 12 h (v2.2: extended from 3h so the
// model tail is visible, not just implied by a text label). Mobile can't see
// all 49 slots at once — the strip stays horizontally scrollable.
const MAX_SLOTS = 49
// v2.38.2 — a live report: the ribbon could run a little past the 12h mark
// it advertises. MAX_SLOTS alone assumed every source was uniformly 15-min
// spaced end to end, which is usually true but isn't a guarantee this file
// can enforce on its own (App.jsx composes the nowcast + two model
// timelines) — a boundary a few minutes past 12h from one of them was
// enough to draw an extra, half-real bucket. This is the actual promise:
// nothing at or past exactly `now + HORIZON_S` is ever included, belt and
// braces alongside MAX_SLOTS rather than instead of it.
const HORIZON_S = 12 * 3600
const DRY_THRESHOLD = 0.1

// Theme-aware two-colour palette, used by precipToColor/tierOf below — kept
// for DayStrip's own five-day bars (still discrete, still on this exact
// scale, still matched to the WAIT/STUCK headline colours per the app's
// "status colour = ribbon legend" doctrine). This is a SEPARATE palette from
// skyPalOf below, which only the TODAY chart uses — see that function's own
// comment for why they're allowed to diverge.
const PALETTE = {
  dark:  { dry: '#D4A017', rain: '#1BAEE2', storm: '#0077AA' },
  light: { dry: '#7A5E00', rain: '#0A6E9C', storm: '#024D6E' },
}
export function palOf(theme) { return PALETTE[theme === 'light' ? 'light' : 'dark'] }

// Three classes only: dry, rain, storm. The storm line sits at the app's own
// DOWNPOUR_MM (1.5 mm/15min, App.jsx) rather than a new number — "storm"
// means the same threshold the downpour warning already means.
const STORM_THRESHOLD = 1.5

export function tierOf(p) {
  if (p < DRY_THRESHOLD)      return 'dry'
  if (p < STORM_THRESHOLD)    return 'rain'
  return                             'storm'
}

export function precipToColor(p, pal) { return pal[tierOf(p)] }

// v2.37 — the TODAY chart's own rain→storm gradient, DELIBERATELY red at the
// storm end rather than reusing --c-stuck's blue. This is a scoped, named
// exception to the app's own "headline colour = ribbon legend" rule
// (CLAUDE.md, "Status colours"): storm-as-red was a maintainer design
// decision for THIS chart specifically, reusing the app's existing
// --c-danger red (the RED official-warning override, v2.14.0) rather than
// inventing a third red. It does NOT touch --c-stuck, palOf, or
// precipToColor above — DayStrip's five-day bars and the STUCK headline stay
// exactly the blue they've always been. A storm on today's chart reading red
// does not mean an official warning is active; it means the same thing the
// blue STUCK headline above it already says, just drawn on this one chart's
// own colour language. Kept as a plain object (not CSS vars) because a
// canvas gradient needs literal colour strings, same as the rest of this
// file already does.
const SKY_PALETTE = {
  dark:  { rain: '#1BAEE2', storm: '#EF4444' },
  light: { rain: '#0A6E9C', storm: '#991B1B' },
}
export function skyPalOf(theme) { return SKY_PALETTE[theme === 'light' ? 'light' : 'dark'] }

// Label priority when the drawn chart is dry/empty: MODEL disagreeing with a
// radar all-clear beats everything (frontal rain the radar can't see yet),
// then CAPE instability, then the plain radar-attributed dry line.
function dryLabel(t, hasData, unstable, modelRainMin) {
  if (!hasData) return t('ribbon_wait')
  if (modelRainMin != null) {
    if (modelRainMin >= 90) {
      const h = Math.round(modelRainMin / 30) / 2
      return t('ribbon_dry_model_far', { h: h % 1 ? `${Math.floor(h)}½` : `${h}` })
    }
    return t('ribbon_dry_model', { min: Math.max(5, Math.round(modelRainMin / 5) * 5) })
  }
  return t(unstable ? 'ribbon_dry_unstable' : 'ribbon_dry')
}

// Point heights (v2.23, kept unchanged by the v2.37 bars→skyline redesign —
// this is still the one function that turns a mm value into a y-position,
// just read as a line point instead of a bar top). A Salzburg 15-min slot is
// almost always between 0.1 and 1.0 mm, so the scale gives each class an
// equal quarter of the range rather than being linear over 0–5mm, which used
// to squeeze 90% of all real rain into the bottom sixth of the chart.
const DRY_H      = 4     // dry (p === 0): effectively flat
// v2.38 — sub-threshold echo ("faint drizzle") no longer gets its own bar
// height at all: it renders at the SAME flat DRY_H as a genuine zero, and is
// carried instead by a dedicated mist marker (below) drawn above the line.
// The old TRACE_H bump (6px vs DRY_H's 4px) was real but nearly invisible —
// a live report called it "redundant" once the mist existed alongside it,
// and on reflection a 2px bar-height difference was always the wrong
// channel for "unconfirmed": height on this chart means measured intensity,
// and trace is precisely the reading that isn't. TRACE_H is kept only as
// the reference height the mist markers float above.
const TRACE_H    = 6
const MIN_REAL_H = 10    // any reporting reading is legibly "this is rain"
const MAX_BAR_H  = CHART_H - 6
const HEIGHT_STOPS = [[DRY_THRESHOLD, 0], [0.5, 0.25], [2, 0.5], [5, 0.75], [15, 1]]
// v2.37 — where the sky gradient (below) reaches full storm-red. HEIGHT_STOPS
// spends its top quarter on 5-15mm — genuinely rare — so anchoring the
// gradient's red end to MAX_BAR_H (i.e. 15mm) left an ordinary 2mm storm
// sampling the MIDDLE of the gradient: a muted purple, not red. Caught by
// screenshotting the real component with mock data before shipping this —
// the artifact mockup this was ported from used a much smaller reference
// max (2.4) for exactly this reason, and that detail didn't survive the
// port on the first pass. GRAD_REF_P matches it: anything at or above this
// reads as fully, unambiguously red; only the shape (via precipToHeight)
// keeps climbing for genuinely extreme rain above it.
const GRAD_REF_P = 2.4

function precipToHeight(p) {
  if (p < DRY_THRESHOLD) return DRY_H
  let f = 1
  for (let i = 1; i < HEIGHT_STOPS.length; i++) {
    const [hi, fHi] = HEIGHT_STOPS[i]
    if (p > hi) continue
    const [lo, fLo] = HEIGHT_STOPS[i - 1]
    f = fLo + (fHi - fLo) * ((p - lo) / (hi - lo))
    break
  }
  return Math.round(MIN_REAL_H + Math.min(1, f) * (MAX_BAR_H - MIN_REAL_H))
}

// Collapse a run of consecutive TRUE flags into spans — same "one annotation
// per contiguous stretch" doctrine as dryRunIn below, applied to the
// bleed/disagreement markers (v2.37.1). Live data showed WHY this matters:
// a real forecast can disagree with itself across many consecutive slots at
// once, and a marker on every one of them reads as a wall of circles rather
// than "here's where the sources diverge" — exactly the "more confusing
// than the reference" report this was built to fix. One marker per run, at
// its peak, keeps the real signal (a disagreement/bleed still gets flagged,
// nothing is hidden — leads forgiven, lags never) without the clutter.
function collapseRuns(flags) {
  const runs = []
  let start = null
  flags.forEach((f, i) => {
    if (f) { if (start === null) start = i }
    else if (start !== null) { runs.push({ a: start, b: i - 1 }); start = null }
  })
  if (start !== null) runs.push({ a: start, b: flags.length - 1 })
  return runs
}

// The model's own reading nearest a given radar-zone window — extracted to
// module scope (v2.37) so both the drawing effect and the legend-gating
// logic in the render body call the exact same function; two independent
// re-derivations of "what did the model say here" is exactly the kind of
// drift CLAUDE.md's own audit log warns about. A 30-min bar spans two model
// slots, so this compares against the model's PEAK across the bar — taking
// one instant would let a model spike in the second half go undrawn.
function modelPeakAt(mTimes, mPrecips, t0, t1) {
  let best = null
  for (let i = 0; i < mTimes.length; i++) {
    if (mTimes[i] < t0 - 8 * 60 || mTimes[i] > t1) continue
    const v = mPrecips[i] ?? 0
    if (best === null || v > best) best = v
  }
  return best
}

// v2.35 — the dry-window bracket. A dry afternoon used to draw twenty-four
// 4px gold baselines, which was honest and indistinguishable from a chart
// that failed to load. The v2.37 skyline makes a dry stretch read as an
// unmistakable flat line on its own, but the bracket's TEXT ("dry for 45
// min") is still information the shape alone doesn't carry, so it stays.
//
// CLIPPED TO THE RADAR ZONE by its caller, always. Drawing it across model
// points would promise a window on evidence the verdict itself declines to
// act on — v2.30.1's refusal rule (never claim a window on thin data),
// applied to a drawing instead of a sentence. Needs MIN_BRACKET_BARS whole
// points, comfortably past the app's own 30-min MIN_GAP_SLOTS floor, so one
// quiet slot cannot draw a window.
export const MIN_BRACKET_BARS = 2

export function dryRunIn(bars, lastIdx) {
  const end = Math.min(lastIdx, (bars?.length ?? 0) - 1)
  let best = null, run = null
  for (let i = 0; i <= end; i++) {
    if (bars[i].p < DRY_THRESHOLD) {
      run = run || { a: i, b: i }
      run.b = i
      if (!best || run.b - run.a > best.b - best.a) best = { a: run.a, b: run.b }
    } else run = null
  }
  return best && best.b - best.a + 1 >= MIN_BRACKET_BARS ? best : null
}

// Fold the raw 15-min series into points — 15 min apiece inside the radar
// zone (i.e. a no-op grouping, one point per raw slot), 30 min beyond it. A
// merged (model-zone) point takes the MAX of its two slots, never the sum:
// the height/threshold classes are calibrated per 15-min slot, and a max can
// only ever over-state the intensity — the forgiven direction (v2.7's
// rationale for the model union). agree/prob travel WITH the slot that won,
// so the confidence shown always belongs to the reading being drawn rather
// than to its neighbour.
//
// The merge check compares SIZE as well as `start`, not `start` alone — a
// scan across every possible "now" (a real bug this file shipped with
// briefly, caught by a flaky render test rather than assumed fixed): a
// model-zone slot's `floor(t / 1800) * 1800` can land on the EXACT SAME
// number as an unrelated PRIOR radar-zone slot's `floor(t / 900) * 900`,
// pure coincidence of the two divisors, and comparing `start` alone treated
// that as "still the same bucket" — silently folding a model-zone slot into
// a radar bucket without ever extending its `end`, corrupting the split
// right at the radar/forecast boundary. Requiring the running bucket's own
// size to match too closes it: two different-sized buckets can never be
// mistaken for one one just because their starts happen to collide.
export function bucketMixed(slots, radarUntil) {
  const out = []
  let cur = null
  for (const s of slots) {
    const size = s.t < radarUntil ? RADAR_BUCKET_S : MODEL_BUCKET_S
    const start = Math.floor(s.t / size) * size
    if (!cur || cur.t !== start || (cur.end - cur.t) !== size) {
      cur = { t: start, end: start + size, p: s.p, agree: s.agree, prob: s.prob }
      out.push(cur)
    } else if (s.p > cur.p) {
      cur.p = s.p; cur.agree = s.agree; cur.prob = s.prob
    }
  }
  return out
}

// The modelOnly/radarUntil pair each `bucketMixed` call needs, computed
// identically everywhere it's needed (the canvas effect, the lazy zone
// initializer, the render-body legend/readout) so none of them can drift
// from what `hasRadarZone` actually decided.
function radarCutoff(forecast, nowSec) {
  const modelOnly = !hasRadarZone(forecast?.radarUntil, nowSec, forecast?.isNowcast)
  return modelOnly ? -Infinity : (forecast?.radarUntil ?? Infinity)
}

// v2.39 — maintainer ask: at rest, the cursor used to sit exactly on bucket
// 0's own start (e.g. 11:30), even when "now" was well into that bucket
// (11:39) — correct in the sense that the chart's own resolution IS the
// bucket, but it read as "the start of the ribbon" rather than "now" being a
// point partway through a span. This computes how far across bucket 0's own
// width "now" actually falls, so the track can rest scrolled in by that much
// instead of always 0 — the cursor then sits over the real elapsed moment,
// while everything about what bucket 0 MEANS (its `p`, its threshold class)
// is completely unchanged; only where the reference point rests within it
// moves. Same bucket-size rule as `bucketMixed` itself, so this can never
// disagree with which zone bucket 0 is actually drawn in.
function restScrollX(forecast, nowSec) {
  if (!forecast?.times?.length) return 0
  const radarUntil = radarCutoff(forecast, nowSec)
  const size = nowSec < radarUntil ? RADAR_BUCKET_S : MODEL_BUCKET_S
  const start = Math.floor(nowSec / size) * size
  const frac = Math.max(0, Math.min(1, (nowSec - start) / size))
  return frac * SLOT_W
}

// v2.36.6 — mirrors the drawing effect's own slots/splitIdx derivation, used
// ONLY as the lazy initial value for canvasZone state below, so the pinned
// caption has something real to show on the very first render, before the
// effect has run even once (an effect never runs at all under
// renderToStaticMarkup, and in a real browser there'd otherwise be one blank
// frame where the caption could only say "RADAR" with no "FORECAST" at all).
// Every SUBSEQUENT value comes from the effect itself, which is the one
// source of truth once it exists.
function computeInitialZone(forecast) {
  if (!forecast?.times?.length) return { splitIdx: null, cssW: 0 }
  const now = Math.floor(Date.now() / 1000)
  const radarUntil = radarCutoff(forecast, now)
  const slots = bucketMixed(forecast.times
    .map((t, i) => ({ t, p: forecast.precips?.[i] ?? 0 }))
    .filter(s => s.t >= now - 300 && s.t < now + HORIZON_S)
    .slice(0, MAX_SLOTS), radarUntil)
  if (!slots.length) return { splitIdx: null, cssW: 0 }
  return { splitIdx: slots.findIndex(s => s.end > radarUntil), cssW: slots.length * SLOT_W }
}

// v2.38 — the scrubber. A fixed reference sits this many px into the
// viewport; the track (padding spacer + canvas) scrolls under it. Because
// the spacer is exactly this wide, the canvas coordinate under the fixed
// reference is always just `scrollLeft` itself — no separate offset math
// needed anywhere else this constant is used (the zone caption's boundary
// check included).
// v2.38.5 — 56 → 96: a live report that "now" sat flush against the left
// edge with nothing behind it, reading as the start of the chart rather
// than a scrubbable position on a longer timeline. There's no PAST data to
// draw back there — this just widens the empty spacer ahead of the cursor
// so the reference visibly sits partway across the track, not at its edge.
// v2.39 — reversed the ORIGINAL v2.38 call to never align sub-bucket
// (maintainer ask): "now" at rest used to sit on bucket 0's own rounded-down
// start (11:30, say, when it's actually 11:39), which is one honest reading
// of "the chart's own resolution is the bucket" but read as the cursor
// marking the start of the ribbon rather than an actual moving point on it.
// `restScrollX` now scrolls in by exactly how far "now" sits across bucket
// 0's own width, so the cursor rests over the real elapsed moment — bucket
// 0's DATA (its `p`, its threshold class) is completely unchanged, only
// where the reference point sits within its width moves.
const CURSOR_X = 96

// Confidence pips for the scrub readout (0.1–0.5 rain band aside, this is
// the only place this chart speaks to source RELIABILITY rather than
// amount). Radar-zone slots are measured, full stop — 5 of 5. Forecast-zone
// slots reuse the SAME modelProb/modelAgree App.jsx already computes for the
// bleed/disagreement markers; this is a new READING of existing data, not a
// new signal, so it can't drift from what the chart already draws. A slot
// past the hourly-probability horizon has no reading at all — shown low (2)
// rather than omitted, the same "unknown reads as caution" doctrine as
// tracePhantom's own null-handling.
export function confidencePips(inRadar, prob, agree) {
  if (inRadar) return 5
  if (typeof prob !== 'number') return 2
  let pips = Math.max(1, Math.min(5, Math.round(prob / 20)))
  if (agree === false) pips = Math.max(1, pips - 1)
  return pips
}

// Scrub-readout wording. Deliberately NOT getStatus: that function decides
// the one verdict for NOW, built from ground + radar + story continuity —
// asking it about an arbitrary future slot is a question it was never
// built to answer, and doing so would blur the one-verdict doctrine this
// app is built around. This instead just names what THIS chart, at THIS
// point, is claiming — the same job the zone caption and legend chips
// already do, extended to a single scrubbed slot.
function slotStatusKey(p, trace) {
  if (trace) return 'ro_status_trace'
  if (p < DRY_THRESHOLD) return 'ro_status_dry'
  // v2.38.3 — a live report caught this band reading "Light rain" here while
  // the real headline still said GEMMA RAUS, and asked "isn't that supposed
  // to be go-anyway?" It wasn't a verdict bug: gaps.js deliberately keeps
  // [DRY_THRESHOLD, LIGHT_MIN) — 0.1 to 0.2mm — in the GO band on purpose
  // (v2.20.0, "a 0.1mm tip must not flip GO↔GO-ANYWAY"), with its own softer
  // wording (`s_barely_drizzle`). This readout had never heard of that
  // threshold and called anything under 0.5 "Light rain", which is a
  // stricter claim than the app itself makes at 0.15mm. Reusing gaps.js's
  // own exported LIGHT_MIN/LIGHT_MAX (not a re-guessed number) means this
  // band can never drift from the one the real verdict uses again.
  if (p < LIGHT_MIN) return 'ro_status_barely'
  if (p < LIGHT_MAX) return 'ro_status_light'
  if (p < STORM_THRESHOLD) return 'ro_status_rain'
  return 'ro_status_storm'
}
function slotSourceKey(inRadar, trace, wet, disagree) {
  if (inRadar) return trace ? 'ro_src_radar_trace' : wet ? 'ro_src_radar_measured' : 'ro_src_radar_clear'
  if (trace) return 'ro_src_model_low'
  if (wet) return disagree ? 'ro_src_model_disagree' : 'ro_src_model'
  return 'ro_src_model_dry'
}
function fmtSlotTime(ts) {
  const d = new Date(ts * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function relFromNow(t, ts, nowSec) {
  if (ts <= nowSec) return t('ro_now')
  const mins = Math.round((ts - nowSec) / 60)
  if (mins < 60) return t('ro_in', { label: `${mins} min` })
  const h = Math.floor(mins / 60), m = mins % 60
  return t('ro_in', { label: m ? `${h}h ${m}m` : `${h}h` })
}

export default function RainRibbon({ forecast, theme, t, unstable, modelRainMin }) {
  const canvasRef = useRef(null)
  const scrollRef = useRef(null)
  // v2.36.4 — the pinned zone caption (below) used to be a static label pair
  // with no relationship to where the radar/forecast split actually falls in
  // the canvas underneath it. viewW/scrollX track the scroll container so
  // the header can be recomputed as a proportional split of the CURRENTLY
  // VISIBLE width — it moves with the chart instead of describing a fixed
  // 50/50 that was never true. ResizeObserver guarded per this file's own
  // browser-support doctrine (RadarMap does the same for the same reason:
  // absent on iOS 13.4).
  const [viewW, setViewW] = useState(0)
  const [scrollX, setScrollX] = useState(0)
  // v2.36.6 — the canvas's OWN splitIdx/cssW, published by the drawing effect
  // below, so the pinned caption's divider can never drift from the canvas's
  // own boundary the way two independent re-derivations of "now" once did.
  const [canvasZone, setCanvasZone] = useState(() => computeInitialZone(forecast))
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setViewW(el.clientWidth)
    if (typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // v2.38 — desktop click-drag on the scrub track. A plain ref, not state:
  // the drag itself never needs a re-render, only the `scroll` events it
  // provokes do (handled by the existing onScroll → setScrollX below).
  const dragRef = useRef(null)

  // v2.38.5 — replaces the one-time "this drags" wiggle: a maintainer call
  // that the hint taught the gesture once and then was gone, while the
  // track sat with "now" flush at the front and nothing ahead in view. This
  // instead drifts the track forward on its own, slowly, once the user has
  // left it alone for AUTOSCROLL_IDLE_MS — and stops the instant they touch
  // it. `armIdle` is the single entry point: call it on any real user
  // interaction (never on a scroll WE produced, or the drift would cancel
  // itself every frame) and it both stops whatever's currently drifting and
  // restarts the idle clock, so the cadence is always "3s of nobody
  // touching it," not "3s since the last frame."
  const AUTOSCROLL_IDLE_MS = 3000
  const AUTOSCROLL_PX_S = 16   // slow — one 30-min bucket (46px) takes ~3s to cross
  const idleTimerRef = useRef(null)
  const driftRafRef = useRef(null)

  const stopDrift = useCallback(() => {
    if (driftRafRef.current) { cancelAnimationFrame(driftRafRef.current); driftRafRef.current = null }
  }, [])

  const armIdle = useCallback(() => {
    clearTimeout(idleTimerRef.current)
    stopDrift()
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    idleTimerRef.current = setTimeout(() => {
      let last = null
      const step = (ts) => {
        const el = scrollRef.current
        if (!el) { driftRafRef.current = null; return }
        if (last == null) last = ts
        el.scrollLeft += AUTOSCROLL_PX_S * (ts - last) / 1000
        last = ts
        // Reached the end — stop rather than snapping/looping; the user can
        // always drag or hit "back to now" themselves.
        if (el.scrollLeft >= el.scrollWidth - el.clientWidth - 1) { driftRafRef.current = null; return }
        driftRafRef.current = requestAnimationFrame(step)
      }
      driftRafRef.current = requestAnimationFrame(step)
    }, AUTOSCROLL_IDLE_MS)
  }, [stopDrift])

  useEffect(() => {
    armIdle()
    return () => { clearTimeout(idleTimerRef.current); stopDrift() }
  }, [armIdle, stopDrift])

  // v2.38.1 — the fixed cursor IS "now" only until the user drags it
  // somewhere else; without this, a scrub position from ten minutes ago
  // silently goes stale the moment the next 5-min refresh lands (a new
  // `forecast` object, "now" quietly moved on), and the cursor keeps
  // pointing at whatever old pixel offset it was left at — a live report:
  // the black line "not always in the beginning" after a while. Every real
  // data refresh re-homes the ribbon to "now", the same way "back to now"
  // does by hand. Keyed on `forecast` itself (a NEW object every refresh
  // cycle, App.jsx's `setForecast`) rather than on a timer of our own, so
  // this can never drift from the actual refresh cadence.
  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const rest = restScrollX(forecast, Math.floor(Date.now() / 1000))
    scrollRef.current?.scrollTo({ left: rest, behavior: reduceMotion ? 'auto' : 'smooth' })
    setScrollX(rest)
    armIdle()
  }, [forecast, armIdle])

  useEffect(() => {
    if (!forecast || !canvasRef.current) return
    const { times, precips } = forecast
    const now = Math.floor(Date.now() / 1000)

    // v2.2: radar only covers ~3h; beyond radarUntil the points ARE the
    // model (no radar to compare against), so they're drawn as a dashed line
    // with no fill to stay honest about being an estimate rather than a
    // radar-precise reading. Fallback timelines (isNowcast === false) are
    // model end-to-end — nothing is ever filled in that case. v2.34: also
    // model-only when the radar zone has shrunk to nothing — hasRadarZone
    // decides it for both the fill boundary and the pinned caption, so the
    // picture and the sentence can never disagree. Computed BEFORE bucketing
    // (v2.39) since bucketMixed itself now needs it to decide 15 vs 30 min.
    const modelOnly  = !hasRadarZone(forecast.radarUntil, now, forecast.isNowcast)
    const radarUntil = modelOnly ? -Infinity : (forecast.radarUntil ?? Infinity)

    // agree/prob are carried on the slot itself — `i` here is the index into
    // the forecast arrays, which no longer matches the slot index after
    // filter+slice.
    const slots = bucketMixed(times
      .map((t, i) => ({
        t, p: precips[i] ?? 0,
        agree: forecast.modelAgree?.[i],
        prob:  forecast.modelProb?.[i],
      }))
      .filter(s => s.t >= now - 300 && s.t < now + HORIZON_S)
      .slice(0, MAX_SLOTS), radarUntil)

    if (!slots.length) return

    const canvas = canvasRef.current
    // Render at device-pixel-ratio so the time labels are crisp (not
    // upscaled/blurry) on retina/mobile screens, then draw in CSS-pixel
    // coordinates. Cap the backing store below the GPU-texture ceiling
    // (8192px) — the 12h chart at dpr 3 is already ~6800 device px; anything
    // past the ceiling renders as a silently blank canvas on iOS.
    const cssW = slots.length * SLOT_W
    const dpr  = Math.max(1, Math.min(window.devicePixelRatio || 1, 8192 / cssW))
    const cssH = CHART_H + BRACKET_H + LABEL_H
    canvas.width  = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    canvas.style.width  = cssW + 'px'
    canvas.style.height = cssH + 'px'

    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const pal      = palOf(theme)     // still needed below: the dry-window bracket stays gold
    const sky      = skyPalOf(theme)  // the chart's own rain→storm gradient endpoints
    // Brighter/darker than before for a readable label at the larger size.
    const labelCol = theme === 'light' ? '#57544D' : '#9CA3AF'
    // The page ground (--c-bg), for knocking the bracket label — and the
    // ghost/disagreement marker rings — out of the line behind them.
    const bgCol    = theme === 'light' ? '#F2F0EB' : '#08090B'
    // v2.37.2 — same tone as --c-border: the baseline colour for a CONFIRMED
    // dry or trace reading (see the grad stops below). Deliberately not
    // "no colour" (a live report showed a truly invisible baseline reads as
    // a chart that failed to load — the same reason DRY_H isn't literally 0)
    // but not rain-blue either, which a live report flagged as reading like
    // "it's calling this dry and still showing rain".
    const neutralCol = theme === 'light' ? '#C8C6C0' : '#1E2128'

    // Model series lookup (bleed markers, within the radar zone): only
    // meaningful when the chart IS radar (isNowcast) — otherwise the points
    // themselves already ARE the model.
    const mTimes = forecast.isNowcast !== false ? (forecast.modelTimes ?? []) : []
    const mPrecips = forecast.modelPrecips ?? []

    // modelOnly/radarUntil: computed above, before bucketing — see that
    // comment for why. A 30-min point that only PARTLY overlaps the radar horizon is not a
    // radar point — the split is taken on the bucket's END, erring toward
    // "estimate", the honest direction.
    const splitIdx  = slots.findIndex(s => s.end > radarUntil)
    const boundaryX = splitIdx <= 0 ? null : splitIdx * SLOT_W
    const radarEnd  = splitIdx === -1 ? cssW : splitIdx * SLOT_W
    // v2.36.6 — hand the pinned caption below the exact splitIdx/cssW this
    // drawing pass used, so its divider can never drift from this line.
    setCanvasZone({ splitIdx, cssW })

    // ---- the skyline itself (v2.37) ----
    // One gradient, reused for the fill AND every stroke below — rain at the
    // bottom (light/low), storm at the top (heavy) of the drawable range.
    // Height already encodes intensity (precipToHeight), so a gradient fixed
    // to Y position tracks value automatically: a peak's pixels sample the
    // red end, a low stretch samples the blue end, with no per-point colour
    // branching needed. Sharing this one gradient across the fill, both line
    // strokes, and the bleed/disagreement markers is what makes it genuinely
    // one continuous scale end to end, rather than a coloured area with a
    // flat-coloured outline.
    // v2.37.2 — a THIRD stop, added after a live report ("it still calls for
    // dry but the ribbon already starts blue — is this normal?"). It wasn't
    // supposed to be: DRY_H/TRACE_H are only 4-6px tall against a ~45px
    // gradient span, so a confirmed-dry or trace reading should barely
    // register on the gradient at all — but with only two stops (red at the
    // top, rain-blue at the very bottom), the baseline itself sampled the
    // blue end at close to full strength, which read as "showing rain"
    // exactly where the chart (and the dry-window bracket right below it)
    // was saying dry. The stop at DRY_H's height (v2.38: the one height ANY
    // sub-threshold reading now renders at, trace included — see TRACE_H's
    // own comment) clamps everything from there down to the baseline to one
    // neutral tone — real rain (>=
    // MIN_REAL_H) still gets the full blue-to-red scale untouched.
    const gradTop = CHART_H - precipToHeight(GRAD_REF_P)
    const offsetAt = h => (precipToHeight(GRAD_REF_P) - h) / precipToHeight(GRAD_REF_P)
    const grad = ctx.createLinearGradient(0, gradTop, 0, CHART_H)
    grad.addColorStop(0, sky.storm)
    grad.addColorStop(Math.max(0, Math.min(1, offsetAt(MIN_REAL_H))), sky.rain)
    grad.addColorStop(Math.max(0, Math.min(1, offsetAt(DRY_H))), neutralCol)

    const pts = slots.map((s, i) => ({
      x: i * SLOT_W + SLOT_W / 2,
      y: CHART_H - precipToHeight(s.p),
    }))
    // Extend flat to the canvas edges for a cleaner silhouette, same
    // reasoning as the old bars' first/last column.
    const full = [{ x: 0, y: pts[0].y }, ...pts, { x: cssW, y: pts[pts.length - 1].y }]

    if (!modelOnly && radarEnd > 0) {
      // filled area, radar zone only
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, radarEnd, cssH)
      ctx.clip()
      ctx.beginPath()
      ctx.moveTo(full[0].x, CHART_H)
      full.forEach(p => ctx.lineTo(p.x, p.y))
      ctx.lineTo(radarEnd, CHART_H)
      ctx.closePath()
      ctx.fillStyle = grad
      ctx.globalAlpha = 0.85
      ctx.fill()
      ctx.restore()

      // radar-zone stroke, solid
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, radarEnd + 1, cssH)
      ctx.clip()
      ctx.beginPath()
      full.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.strokeStyle = grad
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.restore()
    }

    if (radarEnd < cssW) {
      // forecast-zone stroke, dashed, no fill — same gradient as the radar
      // edge, so a dashed segment over a storm-height estimate reads red and
      // one over a light estimate reads blue, exactly like the fill does.
      ctx.save()
      ctx.beginPath()
      ctx.rect(radarEnd - 1, 0, cssW - radarEnd + 1, cssH)
      ctx.clip()
      ctx.beginPath()
      full.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.strokeStyle = grad
      ctx.setLineDash([4, 3])
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.85
      ctx.stroke()
      ctx.restore()
    }

    // Bleed markers (radar zone only, v2.37): the real showGhost() predicate
    // (gaps.js) — a model reading materially higher than what's actually
    // measured at this exact slot, still inside the radar's own window. A
    // small dashed spike breaks up out of the filled area at that point —
    // the fill stays an honest picture of what's measured, the spike says
    // what's expected. This is the same signal the old bar chart's ghost
    // bars carried (v2.1.0/v2.18.0), just drawn in this chart's own line
    // language instead of a second bar.
    // v2.37.1 — ONE marker per contiguous run (collapseRuns), at the run's
    // highest model reading, not one per slot. Live data showed several
    // consecutive slots bleeding at once is the common case, not the rare
    // one, and a marker on every single one of them was the "wall of
    // circles" a live report flagged as more confusing than the design
    // mockup it was built from.
    const bleedFlags = slots.map(slot => {
      if (slot.end > radarUntil) return false // forecast zone: no radar to bleed against
      const mp = modelPeakAt(mTimes, mPrecips, slot.t, slot.end)
      return mp != null && showGhost(slot.p, mp)
    })
    collapseRuns(bleedFlags).forEach(run => {
      let peakI = run.a, peakMp = -Infinity
      for (let i = run.a; i <= run.b; i++) {
        const mp = modelPeakAt(mTimes, mPrecips, slots[i].t, slots[i].end)
        if (mp > peakMp) { peakMp = mp; peakI = i }
      }
      const x  = peakI * SLOT_W + SLOT_W / 2
      const gy = CHART_H - precipToHeight(peakMp)
      ctx.save()
      ctx.strokeStyle = grad
      ctx.setLineDash([3, 2])
      ctx.lineWidth = 1.5
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.moveTo(x - SLOT_W / 2 + 3, CHART_H)
      ctx.lineTo(x, gy)
      ctx.lineTo(x + SLOT_W / 2 - 3, CHART_H)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(x, gy, 3, 0, Math.PI * 2)
      ctx.fillStyle = bgCol
      ctx.fill()
      ctx.strokeStyle = grad
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.restore()
    })

    // Disagreement markers (forecast zone only): the two forecast models
    // (modelsAgree, v2.18.0) argue about the same slot. A dashed ring on the
    // forecast line — same treatment the old hatched hollow bar used to
    // carry, ported to a line instead of a box.
    // v2.37.1 — same run-collapsing as the bleed markers above, and for the
    // same live-data reason: a real model disagreement often spans many
    // consecutive slots, not one.
    const argueFlags = slots.map(slot =>
      slot.end > radarUntil && slot.p >= DRY_THRESHOLD && slot.agree === false)
    collapseRuns(argueFlags).forEach(run => {
      let peakI = run.a, peakP = -Infinity
      for (let i = run.a; i <= run.b; i++) {
        if (slots[i].p > peakP) { peakP = slots[i].p; peakI = i }
      }
      const x = peakI * SLOT_W + SLOT_W / 2
      const y = CHART_H - precipToHeight(peakP)
      ctx.save()
      ctx.strokeStyle = labelCol
      ctx.globalAlpha = 0.55
      ctx.setLineDash([2, 2])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, y - 10)
      ctx.lineTo(x, CHART_H)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(x, y, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = bgCol
      ctx.fill()
      ctx.strokeStyle = grad
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.restore()
    })

    // Time labels live in their own strip BELOW the chart (v2.23). Only on
    // the hour: at 30-min points a label on every one would sit 46px apart
    // for ~36px of text — legible but reads as a wall of numbers. Hourly
    // gridlines are enough to place a point in time.
    slots.forEach((s, i) => {
      const x = i * SLOT_W
      const d = new Date(s.t * 1000)
      if (d.getMinutes() !== 0) return
      ctx.save()
      ctx.fillStyle = labelCol
      ctx.font = 'bold 12px "JetBrains Mono", monospace'
      const label = `${String(d.getHours()).padStart(2, '0')}:00`
      // Never let the last label overhang the canvas edge.
      const w = ctx.measureText(label).width
      if (x + 3 + w <= cssW) ctx.fillText(label, x + 3, CHART_H + BRACKET_H + LABEL_H - 4)
      ctx.restore()
    })

    // The dry-window bracket (v2.35). Radar zone only — see dryRunIn. Stays
    // gold (pal.dry) — this is a textual annotation about a measured span,
    // not the chart's own "colour for dry", which is exactly the thing this
    // redesign removed.
    const lastRadarIdx = (splitIdx === -1 ? slots.length : splitIdx) - 1
    const dryRun = dryRunIn(slots, lastRadarIdx)
    if (dryRun) {
      const x0 = dryRun.a * SLOT_W + 2
      const x1 = (dryRun.b + 1) * SLOT_W - 3
      const y  = CHART_H + 8
      // The run reaches the end of what radar can see AND the model keeps it
      // dry past there: cap the bracket with an arrow rather than a closing
      // tick. The measurement ended; the expectation did not, and the two
      // are not the same claim.
      const openEnd = dryRun.b === lastRadarIdx &&
        slots.slice(lastRadarIdx + 1).every(s => s.p < DRY_THRESHOLD)
      ctx.save()
      ctx.strokeStyle = pal.dry
      ctx.globalAlpha = 0.85
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x0 + 0.5, y - 4)
      ctx.lineTo(x0 + 0.5, y + 0.5)
      ctx.lineTo(x1 - 0.5, y + 0.5)
      if (!openEnd) ctx.lineTo(x1 - 0.5, y - 4)
      ctx.stroke()
      if (openEnd) {
        ctx.beginPath()
        ctx.moveTo(x1 - 5, y - 3)
        ctx.lineTo(x1 - 0.5, y + 0.5)
        ctx.lineTo(x1 - 5, y + 4)
        ctx.stroke()
      }
      // v2.39: duration from the run's OWN start/end timestamps, not a bar
      // count times a fixed bucket size — since the radar zone now mixes 15-
      // and (past its far edge, rare) 30-min buckets, a count-based figure
      // would overstate a run made of the finer buckets by up to 2×.
      const mins = (slots[dryRun.b].end - slots[dryRun.a].t) / 60
      const txt = t
        ? (mins < 60 ? t('bracket_dry_min', { min: mins })
                     : t('bracket_dry_h', { h: hoursLabel(mins) }))
        : ''
      ctx.font = 'bold 9px "JetBrains Mono", monospace'
      const tw = ctx.measureText(txt).width
      // Only label a bracket wide enough to hold the label inside its own
      // span — a caption spilling past the end marks a window we did not
      // measure.
      if (txt && tw + 12 < x1 - x0) {
        const cx = (x0 + x1) / 2
        ctx.globalAlpha = 1
        ctx.fillStyle = bgCol
        ctx.fillRect(cx - tw / 2 - 4, y - 8, tw + 8, 10)
        ctx.fillStyle = pal.dry
        ctx.fillText(txt, cx - tw / 2, y)
      }
      ctx.restore()
    }

    // Radar → model handoff marker: a dashed vertical line through the whole
    // canvas so the zone switch has a crisp edge (the pinned row above the
    // chart names the zones in words).
    if (boundaryX !== null) {
      ctx.save()
      ctx.strokeStyle = labelCol
      ctx.globalAlpha = 0.5
      ctx.setLineDash([2, 3])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(boundaryX, 0)
      ctx.lineTo(boundaryX, cssH)
      ctx.stroke()
      ctx.restore()
    }

    // v2.38 — no in-canvas "now" line any more. The fixed cursor rendered
    // in JSX below (positioned at CURSOR_X, outside the scrolling track) IS
    // "now" at rest, since the track's own left spacer is exactly CURSOR_X
    // wide — a second, canvas-drawn line at the same spot only doubled up
    // visually. See CURSOR_X's own comment for why no sub-bucket offset is
    // computed here any more either.

  }, [forecast, theme, t])

  // v2.34: the chart no longer auto-scrolls. The drift existed so phone
  // users would see all 12 h without knowing they could swipe, but it moved
  // the shape out from under the reader's eye mid-glance. It stays
  // horizontally scrollable; only the self-driving part is gone.

  // A flat all-dry chart looks identical to a failed/empty one — label it so
  // a dry forecast never reads as "broken". No data at all → "waiting for
  // data".
  const nowS = Math.floor(Date.now() / 1000)
  // v2.38: `prob` added alongside the existing `agree` — both already exist
  // on `forecast` (App.jsx's ribbon confidence work), carried through
  // bucket30 the same way `agree` already was, purely for the new scrub
  // readout's confidence pips. Nothing here is a new SIGNAL, only a new
  // READ of one App.jsx already computes for the bleed/disagreement work.
  const rslots = (forecast?.times || [])
    .map((tt, i) => ({ t: tt, p: forecast.precips[i] ?? 0, agree: forecast.modelAgree?.[i], prob: forecast.modelProb?.[i] }))
    .filter(s => s.t >= nowS - 300 && s.t < nowS + HORIZON_S)
    .slice(0, MAX_SLOTS)
  const sky = skyPalOf(theme) // the gradient swatch's own two colours
  const hasDisagreement = rslots.some(s => s.agree === false && s.p >= DRY_THRESHOLD)
  const hasData = rslots.length > 0
  const showRadarZone = hasRadarZone(forecast?.radarUntil, nowS, forecast?.isNowcast)
  const spanLabel = radarSpanLabel(forecast?.radarUntil, nowS)
  // v2.39 — one radarUntil, reused for the bucketing itself AND every zone
  // check below (bleed, the split index, the bracket) — used to be computed
  // twice, separately, which was harmless while it only gated checks, but
  // bucketMixed now needs the SAME value bucket-for-bucket or the legend's
  // idea of the radar/forecast split could disagree with the canvas's.
  const rUntil = showRadarZone ? (forecast?.radarUntil ?? Infinity) : -Infinity
  // The legend chips below describe the PICTURE, so they're computed from
  // the same mixed-resolution points the canvas draws, not the raw 15-min slots.
  const rbars = bucketMixed(rslots, rUntil)
  // "Does a bleed marker actually get drawn" — same modelPeakAt/showGhost
  // pair the effect uses, so the chip can never claim a marker that isn't
  // really on the chart (the v2.18.0 lesson, applied to a legend chip this
  // time instead of a caption).
  const mTimesR   = forecast?.isNowcast !== false ? (forecast?.modelTimes ?? []) : []
  const mPrecipsR = forecast?.modelPrecips ?? []
  const hasBleed = showRadarZone && rbars.some(b => {
    if (b.end > rUntil) return false
    const mp = modelPeakAt(mTimesR, mPrecipsR, b.t, b.end)
    return mp != null && showGhost(b.p, mp)
  })

  // NOTE the optional chaining below: `forecast` is null on the very first
  // render, before any data has arrived, and every other read in this render
  // body is written that way for exactly that reason (v2.30.0 shipped a line
  // unguarded here and it threw on first paint, unmounting the whole app —
  // pinned by a render test that mounts this component with forecast={null}).
  const hasTrace = rslots.some(s => s.p > 0 && s.p < DRY_THRESHOLD)
  const allDry  = hasData && rslots.every(s => s.p < DRY_THRESHOLD)
  const rSplit = rbars.findIndex(b => b.end > rUntil)
  const hasBracket = !!dryRunIn(rbars, (rSplit === -1 ? rbars.length : rSplit) - 1)
  const traceOnly = allDry && rslots.some(s => s.p > 0) && forecast.tracePhantom !== true
  // v2.38 — generalised from `plainDryOnly && hasBracket`: the floating
  // overlay sentence and the dry-window bracket used to both fire for a
  // trace-only stretch (a live report called the pair "redundant" once the
  // mist marker existed too — three things saying "dry" at once). The
  // bracket already carries the DURATION; the overlay only still earns its
  // place when it has something the bracket can't say — an incoming-rain
  // countdown or an instability warning. `plainDryOnly` is retired: a bare
  // "yes, still dry" is exactly the claim the bracket already makes.
  const redundantWithBracket = hasBracket && modelRainMin == null && !unstable
  const showDryLabel = (allDry || !hasData) && !redundantWithBracket

  // v2.36.4/v2.36.6 — where the pinned caption splits: read from canvasZone
  // (the drawing effect's OWN splitIdx/cssW), not recomputed here from a
  // freshly-read Date.now(), which would drift from the canvas's frozen
  // "now" as time passes between data refreshes.
  const contentW  = canvasZone.cssW
  const boundaryX = !showRadarZone || canvasZone.splitIdx == null ? null
    : canvasZone.splitIdx === -1 ? contentW
    : canvasZone.splitIdx * SLOT_W
  // v2.38 — the track now opens with a CURSOR_X-wide spacer (see that
  // constant) before the canvas, so a canvas coordinate sits CURSOR_X
  // further along in SCROLL coordinates than it used to. `boundaryX` above
  // is still the canvas's own measurement (the drawing effect's clip
  // rects don't know or care about the spacer); this is the same value
  // translated into the scroll-content space `scrollX`/`viewW` live in.
  const boundaryScrollX = boundaryX == null ? null : boundaryX + CURSOR_X
  // Same reasoning as `boundaryScrollX`: before the ResizeObserver's first
  // measurement (viewW still 0 — true for a brief instant in the browser,
  // and always true under renderToStaticMarkup, which has no effects at
  // all), the fallback approximates "assume the whole track is visible".
  // That track now includes the CURSOR_X spacer, so the fallback has to
  // too, or a boundary near the end of a SHORT forecast (little content
  // past `contentW`) reads as just past the fallback's edge and the zone
  // caption wrongly collapses to radar-only.
  const viewSpan = viewW || (contentW + CURSOR_X)
  const view0 = scrollX
  const view1 = scrollX + viewSpan
  const zoneMode = boundaryScrollX == null ? 'radar-only'
    : boundaryScrollX >= view1 ? 'radar-only'
    : boundaryScrollX <= view0 ? 'forecast-only'
    : 'split'
  const zoneSplitPct = zoneMode === 'split' && viewSpan > 0
    ? Math.max(4, Math.min(96, ((boundaryScrollX - view0) / viewSpan) * 100))
    : null

  // v2.38 — the scrub readout. `scrollX` IS the canvas coordinate under the
  // fixed cursor (CURSOR_X's own comment explains why the spacer makes that
  // exact, with no further offset). Reading a slot back out of `rbars` is
  // the same "describe the picture" job the legend chips already do —
  // nothing here calls getStatus or touches the verdict.
  // v2.39: floor, not round. At rest `scrollX` is now `restScrollX` — some
  // fraction INTO bucket 0's own width, never a full SLOT_W — so the cursor
  // is genuinely standing partway across bar 0. Rounding would flip to bar 1
  // the moment more than half of bar 0 had elapsed, which is exactly the
  // "now" reading this exists to keep correct. Floor also reads more
  // naturally for a manual drag: the ribbon stays "over" a bar for the whole
  // width it's actually drawn at, not just its near half.
  const scrubIdx = rbars.length
    ? Math.max(0, Math.min(rbars.length - 1, Math.floor(scrollX / SLOT_W)))
    : 0
  const scrubBar = rbars[scrubIdx]
  const scrubRadarSplit = rSplit === -1 ? rbars.length : rSplit
  const scrubInRadar = scrubIdx < scrubRadarSplit
  const scrubTrace = !!scrubBar && scrubBar.p > 0 && scrubBar.p < DRY_THRESHOLD
  const scrubWet = !!scrubBar && scrubBar.p >= DRY_THRESHOLD
  const scrubDisagree = !!scrubBar && scrubBar.agree === false
  const pips = confidencePips(scrubInRadar, scrubBar?.prob, scrubBar?.agree)
  // v2.38.4 — bucket 0 is a 30-min BUCKET starting at or before `nowS` (a
  // live report: "it's 10:26, the readout says 10:00"). At rest that's the
  // bucket's rounded-down START, not the actual time — everywhere else in
  // the ribbon that rounding is deliberate (the chart's own resolution is
  // 30 min), but "now" is the one instant this chart can state exactly, so
  // the readout shows the real clock time there instead of the bucket edge.
  // Any other scrubbed bucket still shows its own start, unchanged.
  const scrubT = scrubIdx === 0 ? nowS : (scrubBar?.t ?? nowS)

  // Mist markers (v2.38): every trace bucket, radar zone or forecast zone
  // alike — trace can show up in either. Positions are in TRACK space (the
  // spacer's CURSOR_X plus the bucket's own canvas x), since these render
  // inside the scrolling track, not the fixed viewport.
  const mistBars = rbars
    .map((b, i) => ({ i, p: b.p }))
    .filter(m => m.p > 0 && m.p < DRY_THRESHOLD)
  const cursorCol = theme === 'light' ? '#0A0A0A' : '#F1F3F5'
  const mistCol   = theme === 'light' ? '#1E86B0' : '#6CD1EB'   // --c-light: the same hue PASST SCHON already uses

  function onScrubPointerDown(e) {
    // armIdle first, unconditionally — this fires for touch too (the early
    // return below only skips the desktop drag simulation; a touch swipe
    // still starts with a real pointerdown), and it's the one moment a
    // native touch-scroll gesture is visible to this component at all.
    armIdle()
    if (e.pointerType && e.pointerType !== 'mouse') return
    dragRef.current = { x: e.clientX, s: e.currentTarget.scrollLeft }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* no-op */ }
  }
  function onScrubPointerMove(e) {
    if (!dragRef.current) return
    e.currentTarget.scrollLeft = dragRef.current.s - (e.clientX - dragRef.current.x)
  }
  function onScrubPointerUp() { dragRef.current = null }
  function onScrubKeyDown(e) {
    const el = e.currentTarget
    const step = e.shiftKey ? SLOT_W * 4 : SLOT_W
    if (e.key === 'ArrowRight') { armIdle(); el.scrollLeft += step; e.preventDefault() }
    else if (e.key === 'ArrowLeft') { armIdle(); el.scrollLeft -= step; e.preventDefault() }
    else if (e.key === 'Home') { armIdle(); el.scrollLeft = restScrollX(forecast, nowS); e.preventDefault() }
    else if (e.key === 'End') { armIdle(); el.scrollLeft = contentW; e.preventDefault() }
  }
  function backToNow() {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    scrollRef.current?.scrollTo({ left: restScrollX(forecast, nowS), behavior: reduceMotion ? 'auto' : 'smooth' })
    armIdle()
  }

  return (
    <div className="border-t border-border shrink-0">
      {/* v2.38.2 — the scrub readout moved ABOVE the chart (a live UX note:
          read the fact first, then look at the ribbon that produced it,
          rather than the other way round). Deliberately plain wording (see
          slotStatusKey/slotSourceKey's own comments): this describes what
          THIS point on the chart is claiming, never the app's one verdict.
          "back to now" moved OUT of this block and down onto the legend
          row, right next to the ribbon it actually acts on — see that
          row's own comment. */}
      {hasData && (
        <div className="px-4 pt-2.5 pb-1">
          {/* v2.39 — two rows instead of three (maintainer ask, off a marked-up
              screenshot): the time/status lines never used the right half of
              their own row, while the source text and confidence pips sat
              stacked in a third row below with room to spare beside them.
              Source now rides the time row, pips ride the status row — same
              four facts, same reading order, less vertical space. */}
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-display font-bold text-xl">{fmtSlotTime(scrubT)}</span>
              <span className="font-mono text-[11px] text-muted">{relFromNow(t, scrubT, nowS)}</span>
            </div>
            <span className="font-mono text-[11px] text-muted shrink-0">
              {t(slotSourceKey(scrubInRadar, scrubTrace, scrubWet, scrubDisagree))}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <span className="font-mono text-sm">
              {t(slotStatusKey(scrubBar?.p ?? 0, scrubTrace))}
            </span>
            <span className="inline-flex gap-[2px] shrink-0" aria-label={t('ro_confidence', { n: pips })}>
              {[0, 1, 2, 3, 4].map(k => (
                <i key={k} className="block w-[5px] h-[9px] rounded-[1px]"
                   style={{ background: k < pips ? 'var(--c-primary)' : 'var(--c-border)' }} />
              ))}
            </span>
          </div>
        </div>
      )}
      {/* v2.38 — the "TODAY · NEXT 12H" header row is gone. It sat above the
          zone row and said, in effect, the same thing that row already
          says more usefully (which hours, which instrument) — a live
          design pass flagged it as space spent restating the obvious right
          before the one row that actually needs the room. `today_short` and
          `next_12h` stay live i18n keys (DayStrip's own header still uses
          `today_short`); only this repetition of them is gone. */}
      {/* v2.35/v2.36.4 — the zone row, pinned outside the scroller so it can never
          scroll fully out of view, and tracking scroll position so the split
          between "RADAR" and "FORECAST" sits at the same proportion of the visible
          width as the actual boundary drawn in the canvas right below it. */}
      {hasData && (
        <div className="flex items-center px-4 pb-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
          {!showRadarZone ? (
            <span className="normal-case tracking-normal">{t('zone_caption_model')}</span>
          ) : zoneMode === 'radar-only' ? (
            <span className="text-primary">{t('zone_radar', { h: spanLabel })}</span>
          ) : zoneMode === 'forecast-only' ? (
            <span>{t('zone_forecast')}</span>
          ) : (
            <>
              <span className="text-primary shrink-0 overflow-hidden whitespace-nowrap border-r border-border pr-1.5"
                    style={{ flexBasis: `${zoneSplitPct}%` }}>
                {t('zone_radar', { h: spanLabel })}
              </span>
              <span className="shrink-0 pl-1.5">{t('zone_forecast')}</span>
            </>
          )}
        </div>
      )}
      {/* v2.38 — the scrubber. A fixed cursor sits CURSOR_X into the viewport;
          the track (spacer + canvas + mist markers) scrolls under it, on a
          native touch swipe or the pointer-drag handlers below on desktop.
          `tabIndex`/`onKeyDown` add arrow-key scrubbing; none of this is new
          STATE beyond the `scrollX` v2.36.4 already tracks for the zone
          caption above — the readout below reads the exact same value. */}
      {/* v2.38.3 — `max-w-[420px]`: a live report found the ribbon simply
          didn't scroll on a wide desktop window. Root cause wasn't the drag
          handlers — it's that the app's own column runs full window width
          (v2.35's own decision, "the pieces that need a line-length limit
          set their own"), and the ribbon's ~1150-1250px of real content can
          be NARROWER than a wide browser window, so there is nothing to
          overflow and `overflow-x-auto` has nothing to do. Capping this one
          element (the same precedent DayStrip's day-shape already set with
          its own `max-w-[460px]`) guarantees the track is always wider than
          its own viewport, so the scrubber — drag, swipe, or arrow keys —
          keeps working identically regardless of window width. */}
      {/* v2.38.4 — outer, non-scrolling wrapper. The fixed cursor used to be a
          child of the overflow-x-auto box itself; even absolutely positioned,
          that box's OWN scroll still panned it (its `left` resolves against
          the scrollport's padding edge, but that resolved position is part of
          the same scrollable content the box translates on drag) — so it
          drifted from "now" during a scrub and could scroll fully out of view
          on a long drag (two live reports: a stranded line and a vanished
          one). This wrapper never scrolls, so a child positioned against IT
          is genuinely fixed on screen, matching the CURSOR_X spacer's own
          promise that the reference sits still while the track moves. */}
      <div className="relative max-w-[420px]">
        <div ref={scrollRef} className="relative overflow-x-auto scrollbar-none cursor-grab active:cursor-grabbing"
             tabIndex={hasData ? 0 : -1}
             role="group"
             aria-label={t('ro_aria')}
             onScroll={e => setScrollX(e.currentTarget.scrollLeft)}
             onPointerDown={onScrubPointerDown}
             onPointerMove={onScrubPointerMove}
             onPointerUp={onScrubPointerUp}
             onPointerLeave={onScrubPointerUp}
             onKeyDown={onScrubKeyDown}
             onWheel={armIdle}>
          <div className="relative flex">
            {/* The spacer is exactly CURSOR_X wide — see that constant's own
                comment for why this makes the fixed cursor "now" at rest with
                no further offset math anywhere else. */}
            <div style={{ width: CURSOR_X }} className="shrink-0" aria-hidden="true" />
            <canvas
              ref={canvasRef}
              style={{ display: 'block' }}
            />
            {/* Mist markers (v2.38): a faint, sub-threshold echo gets a soft
                marker floating above the flat dry line instead of its own bar
                height — see TRACE_H's and precipToHeight's own comments for
                why the old height-based bump was retired. `.gr-mist` (index.css)
                carries the pulse; reduced-motion turns it off there, not here. */}
            {mistBars.map(m => (
              <span key={m.i} aria-hidden="true"
                    className="gr-mist absolute rounded-full pointer-events-none"
                    style={{
                      left: CURSOR_X + m.i * SLOT_W + SLOT_W / 2 - 5,
                      top: CHART_H - TRACE_H - 9,
                      width: 10, height: 10,
                      background: mistCol, opacity: 0.55, filter: 'blur(2px)',
                    }} />
            ))}
          </div>
          {showDryLabel && (
            // Centred on the chart itself, not the whole canvas — the time
            // strip below is chrome, and letting it pull the label off-centre
            // drifts it toward the chart it's meant to sit clear of.
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none"
                 style={{ paddingBottom: BRACKET_H + LABEL_H }}>
              <span className="font-mono text-xs text-muted bg-bg/70 px-2 py-0.5 rounded">
                {/* Honest attribution, in priority order: the MODEL disagreeing with a
                    radar all-clear beats everything (frontal rain the radar can't see
                    yet); then CAPE instability; then the plain radar-attributed dry
                    line. Never an unqualified promise. */}
                {traceOnly ? t('ribbon_trace_only') : dryLabel(t, hasData, unstable, modelRainMin)}
              </span>
            </div>
          )}
        </div>
        {/* Fixed cursor — now a sibling of the scroll box, not a descendant of
            it, positioned against this outer wrapper's own (unmoving) box. It
            never disappears (`hasData` is the only gate) and never drifts:
            dragging the track underneath changes what time is under it, never
            where it sits on screen. */}
        {hasData && (
          <div className="absolute top-0 w-0.5 pointer-events-none"
               style={{ left: CURSOR_X, bottom: BRACKET_H + LABEL_H, background: cursorCol }}
               aria-hidden="true">
            <span className="absolute rounded-full" style={{ top: -4, left: -3, width: 8, height: 8, background: cursorCol }} />
          </div>
        )}
      </div>
      {/* v2.37.2 — the gradient swatch is back (it was in the design mockup this
          shipped from, and a live report noticed its absence). The rest stays
          v2.37's rule: gated on something actually being drawn that it explains
          (v2.18.0) — a trace echo, a bleed spike, or a real models-disagree
          marker. Colour+height+shape (solid fill vs. dashed line) already say
          everything else; the swatch just names what the colour scale itself is,
          since that's the one thing no amount of shape alone can spell out.
          v2.38.2 — "back to now" lives here too, right-aligned: it acts on
          the ribbon directly above it, not on the readout text that moved up
          top, so it sits next to the thing it actually resets. */}
      {hasData && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 pb-2.5 font-mono text-[9px] tracking-[0.07em] text-muted">
          <span className="flex items-center gap-1">
            <span className="inline-block w-4 h-2 rounded-[1px] shrink-0"
                  style={{ background: `linear-gradient(90deg, ${sky.rain}, ${sky.storm})` }}
                  aria-hidden="true" />
            {t('legend_gradient')}
          </span>
          {hasTrace && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ background: mistCol }}
                    aria-hidden="true" />
              {t('legend_trace')}
            </span>
          )}
          {hasBleed && <span>{t('legend_bleed')}</span>}
          {hasDisagreement && <span>{t('legend_uncertain')}</span>}
          <button type="button" onClick={backToNow}
                  className="ml-auto font-mono text-[10px] tracking-normal border border-border rounded-full px-2.5 py-1 text-primary hover:border-primary transition-colors">
            {t('ro_back_now')}
          </button>
        </div>
      )}
    </div>
  )
}
