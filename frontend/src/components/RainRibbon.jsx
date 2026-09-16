import { useEffect, useRef, useState } from 'react'
import { showGhost, radarSpanLabel, hasRadarZone, hoursLabel } from '../gaps'

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
// One point per 30 minutes (was 15). The app never promises a break shorter
// than 30 min (MIN_GAP_SLOTS = 2), so 15-min resolution drew detail the
// verdict cannot act on — and 49 of them across 12 h read as noise, not a
// shape.
const BUCKET_S = 30 * 60
// v2.35: strip between the chart and the time labels, for the dry-window
// bracket. Always reserved rather than added only when a bracket exists — a
// canvas that changes height between refreshes shifts everything below it,
// and this app is read in two-second glances.
const BRACKET_H = 12
// 1 "now" anchor + 48 × 15-min steps = 12 h (v2.2: extended from 3h so the
// model tail is visible, not just implied by a text label). Mobile can't see
// all 49 slots at once — the strip stays horizontally scrollable.
const MAX_SLOTS = 49
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
const TRACE_H    = 6     // sub-threshold echo: a whisper of a rise, never as tall as real rain
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
  if (p < DRY_THRESHOLD) return p > 0 ? TRACE_H : DRY_H
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

// Fold the 15-min series into 30-min points. A point takes the MAX of its two
// slots, never the sum: the height/threshold classes are calibrated per
// 15-min slot, and a max can only ever over-state the intensity — the
// forgiven direction (v2.7's rationale for the model union). agree/prob
// travel WITH the slot that won, so the confidence shown always belongs to
// the reading being drawn rather than to its neighbour.
function bucket30(slots) {
  const out = []
  let cur = null
  for (const s of slots) {
    const start = Math.floor(s.t / BUCKET_S) * BUCKET_S
    if (!cur || cur.t !== start) {
      cur = { t: start, end: start + BUCKET_S, p: s.p, agree: s.agree, prob: s.prob }
      out.push(cur)
    } else if (s.p > cur.p) {
      cur.p = s.p; cur.agree = s.agree; cur.prob = s.prob
    }
  }
  return out
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
  const slots = bucket30(forecast.times
    .map((t, i) => ({ t, p: forecast.precips?.[i] ?? 0 }))
    .filter(s => s.t >= now - 300)
    .slice(0, MAX_SLOTS))
  if (!slots.length) return { splitIdx: null, cssW: 0 }
  const modelOnly  = !hasRadarZone(forecast.radarUntil, now, forecast.isNowcast)
  const radarUntil = modelOnly ? -Infinity : (forecast.radarUntil ?? Infinity)
  return { splitIdx: slots.findIndex(s => s.end > radarUntil), cssW: slots.length * SLOT_W }
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

  useEffect(() => {
    if (!forecast || !canvasRef.current) return
    const { times, precips } = forecast
    const now = Math.floor(Date.now() / 1000)

    // agree/prob are carried on the slot itself — `i` here is the index into
    // the forecast arrays, which no longer matches the slot index after
    // filter+slice.
    const slots = bucket30(times
      .map((t, i) => ({
        t, p: precips[i] ?? 0,
        agree: forecast.modelAgree?.[i],
        prob:  forecast.modelProb?.[i],
      }))
      .filter(s => s.t >= now - 300)
      .slice(0, MAX_SLOTS))

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
    const nowCol   = theme === 'light' ? '#0A0A0A' : '#F1F3F5'
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

    // v2.2: radar only covers ~3h; beyond radarUntil the points ARE the
    // model (no radar to compare against), so they're drawn as a dashed line
    // with no fill to stay honest about being an estimate rather than a
    // radar-precise reading. Fallback timelines (isNowcast === false) are
    // model end-to-end — nothing is ever filled in that case. v2.34: also
    // model-only when the radar zone has shrunk to nothing — hasRadarZone
    // decides it for both the fill boundary and the pinned caption, so the
    // picture and the sentence can never disagree.
    const modelOnly  = !hasRadarZone(forecast.radarUntil, now, forecast.isNowcast)
    const radarUntil = modelOnly ? -Infinity : (forecast.radarUntil ?? Infinity)
    // A 30-min point that only PARTLY overlaps the radar horizon is not a
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
    // was saying dry. The stop at TRACE_H's height clamps everything from
    // there down to the baseline to one neutral tone — real rain (>=
    // MIN_REAL_H) still gets the full blue-to-red scale untouched.
    const gradTop = CHART_H - precipToHeight(GRAD_REF_P)
    const offsetAt = h => (precipToHeight(GRAD_REF_P) - h) / precipToHeight(GRAD_REF_P)
    const grad = ctx.createLinearGradient(0, gradTop, 0, CHART_H)
    grad.addColorStop(0, sky.storm)
    grad.addColorStop(Math.max(0, Math.min(1, offsetAt(MIN_REAL_H))), sky.rain)
    grad.addColorStop(Math.max(0, Math.min(1, offsetAt(TRACE_H))), neutralCol)

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
      const mins = (dryRun.b - dryRun.a + 1) * (BUCKET_S / 60)
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

    // "now" marker. v2.23: positioned WITHIN the first point rather than
    // pinned to x=0 — points are aligned to :00/:30, so the first one can
    // begin up to 30 min in the past.
    const nowX = Math.max(0, Math.min(SLOT_W - 2,
      Math.round(((now - slots[0].t) / BUCKET_S) * SLOT_W)))
    ctx.fillStyle = nowCol
    ctx.fillRect(nowX, 0, 2, cssH)

  }, [forecast, theme, t])

  // v2.34: the chart no longer auto-scrolls. The drift existed so phone
  // users would see all 12 h without knowing they could swipe, but it moved
  // the shape out from under the reader's eye mid-glance. It stays
  // horizontally scrollable; only the self-driving part is gone.

  // A flat all-dry chart looks identical to a failed/empty one — label it so
  // a dry forecast never reads as "broken". No data at all → "waiting for
  // data".
  const nowS = Math.floor(Date.now() / 1000)
  const rslots = (forecast?.times || [])
    .map((tt, i) => ({ t: tt, p: forecast.precips[i] ?? 0, agree: forecast.modelAgree?.[i] }))
    .filter(s => s.t >= nowS - 300)
    .slice(0, MAX_SLOTS)
  // The legend chips below describe the PICTURE, so they're computed from
  // the same 30-min points the canvas draws, not the raw 15-min slots.
  const rbars = bucket30(rslots)
  const sky = skyPalOf(theme) // the gradient swatch's own two colours
  const hasDisagreement = rslots.some(s => s.agree === false && s.p >= DRY_THRESHOLD)
  const hasData = rslots.length > 0
  const showRadarZone = hasRadarZone(forecast?.radarUntil, nowS, forecast?.isNowcast)
  const spanLabel = radarSpanLabel(forecast?.radarUntil, nowS)
  // "Does a bleed marker actually get drawn" — same modelPeakAt/showGhost
  // pair the effect uses, so the chip can never claim a marker that isn't
  // really on the chart (the v2.18.0 lesson, applied to a legend chip this
  // time instead of a caption).
  const mTimesR   = forecast?.isNowcast !== false ? (forecast?.modelTimes ?? []) : []
  const mPrecipsR = forecast?.modelPrecips ?? []
  const rUntilForBleed = showRadarZone ? (forecast?.radarUntil ?? Infinity) : -Infinity
  const hasBleed = showRadarZone && rbars.some(b => {
    if (b.end > rUntilForBleed) return false
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
  const rUntil = showRadarZone ? (forecast?.radarUntil ?? Infinity) : -Infinity
  const rSplit = rbars.findIndex(b => b.end > rUntil)
  const hasBracket = !!dryRunIn(rbars, (rSplit === -1 ? rbars.length : rSplit) - 1)
  const traceOnly = allDry && rslots.some(s => s.p > 0) && forecast.tracePhantom !== true
  const plainDryOnly = hasData && !traceOnly && modelRainMin == null && !unstable
  const showDryLabel = (allDry || !hasData) && !(plainDryOnly && hasBracket)

  // v2.36.4/v2.36.6 — where the pinned caption splits: read from canvasZone
  // (the drawing effect's OWN splitIdx/cssW), not recomputed here from a
  // freshly-read Date.now(), which would drift from the canvas's frozen
  // "now" as time passes between data refreshes.
  const contentW  = canvasZone.cssW
  const boundaryX = !showRadarZone || canvasZone.splitIdx == null ? null
    : canvasZone.splitIdx === -1 ? contentW
    : canvasZone.splitIdx * SLOT_W
  const viewSpan = viewW || contentW
  const view0 = scrollX
  const view1 = scrollX + viewSpan
  const zoneMode = boundaryX == null ? 'radar-only'
    : boundaryX >= view1 ? 'radar-only'
    : boundaryX <= view0 ? 'forecast-only'
    : 'split'
  const zoneSplitPct = zoneMode === 'split' && viewSpan > 0
    ? Math.max(4, Math.min(96, ((boundaryX - view0) / viewSpan) * 100))
    : null

  return (
    <div className="border-t border-border shrink-0">
      {/* Header row, styled exactly like the day-strip header below it, so the two
          read as one block: today, then the days. */}
      <div className="flex items-baseline gap-3 px-4 pt-2.5 pb-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          {t('today_short')}
        </span>
        <span className="font-mono text-[10px] text-muted ml-auto">
          {t('next_12h')}
          {!showRadarZone && <span className="ml-1 opacity-50">·&nbsp;est</span>}
        </span>
      </div>
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
      <div ref={scrollRef} className="relative overflow-x-auto scrollbar-none"
           onScroll={e => setScrollX(e.currentTarget.scrollLeft)}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block' }}
        />
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
      {/* v2.37.2 — the gradient swatch is back (it was in the design mockup this
          shipped from, and a live report noticed its absence). The rest stays
          v2.37's rule: gated on something actually being drawn that it explains
          (v2.18.0) — a trace echo, a bleed spike, or a real models-disagree
          marker. Colour+height+shape (solid fill vs. dashed line) already say
          everything else; the swatch just names what the colour scale itself is,
          since that's the one thing no amount of shape alone can spell out. */}
      {hasData && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 pb-2.5 font-mono text-[9px] tracking-[0.07em] text-muted">
          <span className="flex items-center gap-1">
            <span className="inline-block w-4 h-2 rounded-[1px] shrink-0"
                  style={{ background: `linear-gradient(90deg, ${sky.rain}, ${sky.storm})` }}
                  aria-hidden="true" />
            {t('legend_gradient')}
          </span>
          {hasTrace && <span>{t('legend_trace')}</span>}
          {hasBleed && <span>{t('legend_bleed')}</span>}
          {hasDisagreement && <span>{t('legend_uncertain')}</span>}
        </div>
      )}
    </div>
  )
}
