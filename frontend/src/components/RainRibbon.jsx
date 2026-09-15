import { useEffect, useRef } from 'react'
import { showGhost, radarSpanLabel, hasRadarZone, hoursLabel } from '../gaps'

const SLOT_W = 46
// v2.32: 52 -> 88. Today is the one day you can act on, so it gets the height:
// the same bar language as the days below it, but read as a tile rather than a
// strip. Taller bars also separate the light/moderate/heavy tiers visually, which
// at 52px were only a few pixels apart (HEIGHT_STOPS is a ratio scale, so every
// tier grows with it).
// v2.35: 88 -> 76. The tile still has to out-rank the day rows below it, but the
// zone band above the bars shrank from a 14px labelled strip to a 5px rail (its
// words moved to a pinned row outside the scroller), so the whole block reads
// taller than it needs to. Total canvas height goes 117 -> 108 even with the new
// bracket strip, because those are the two changes that pay for each other.
const SLOT_H = 76
// v2.23: dedicated strip for the time labels UNDER the bars. They used to be drawn
// inside the bar area at SLOT_H-6, so every bar taller than ~10px covered its own
// timestamp — and with the rescaled bars below, essentially every wet bar does.
const LABEL_H = 15
// One bar per 30 minutes (was 15). The app never promises a break shorter than
// 30 min (MIN_GAP_SLOTS = 2), so 15-min bars drew a resolution the verdict cannot
// act on — and 49 of them across 12 h read as noise rather than as a shape.
const BUCKET_S = 30 * 60
// v2.6 zone band: thin strip above the bars marking which instrument each zone
// comes from. The solid→dashed bar switch alone read as confusing; the band makes
// the handoff explicit without overlapping the two zones.
//
// v2.35: the band no longer carries its own TEXT — 14px -> a 5px silent rail. The
// words moved to a pinned row above the scroller, because the band scrolls with
// the canvas: swipe toward the evening and "RADAR · NEXT 2½ H" left the screen,
// leaving dashed model bars with nothing naming them. The TINT has to stay here,
// since it marks *where* among the bars the boundary falls.
const BAND_H = 5
// v2.35: strip between the bars and the time labels, for the dry-window bracket.
// Always reserved rather than added only when a bracket exists — a canvas that
// changes height between refreshes shifts everything below it, and this app is
// read in two-second glances.
const BRACKET_H = 12
// 1 "now" anchor + 48 × 15-min steps = 12 h (v2.2: extended from 3h so the model tail
// is visible, not just implied by a text label). Mobile can't see all 49 slots at
// once — that's what the auto-scroll below is for.
const MAX_SLOTS = 49
const DRY_THRESHOLD = 0.1

// Theme-aware rain palette. The dry / moderate / heavy values are kept identical
// to the GO / WAIT / STUCK headline colours (--c-go / --c-wait / --c-stuck in
// index.css) so the status headline always matches its legend swatch and bars —
// in dark AND light mode. Light-mode values are darkened for contrast on cream.
const PALETTE = {
  dark:  { dry: '#D4A017', light: '#6CD1EB', mod: '#1BAEE2', heavy: '#0077AA', storm: '#E05C00' },
  light: { dry: '#7A5E00', light: '#1E86B0', mod: '#0A6E9C', heavy: '#024D6E', storm: '#B34A00' },
}
export function palOf(theme) { return PALETTE[theme === 'light' ? 'light' : 'dark'] }

// The intensity class of a reading. ONE definition, used by the colour, by the
// height ramp's stops and (v2.35) by the colour key under the chart — so a key
// that lists MOD is a key drawn over a bar that actually reached the mod class.
export const TIERS = ['dry', 'light', 'mod', 'heavy', 'storm']

export function tierOf(p) {
  if (p < DRY_THRESHOLD) return 'dry'
  if (p < 0.5)           return 'light'
  if (p < 2)             return 'mod'
  if (p < 5)             return 'heavy'
  return                        'storm'
}

export function precipToColor(p, pal) { return pal[tierOf(p)] }

// Label priority when the drawn ribbon is dry/empty: MODEL disagreeing with a radar
// all-clear beats everything (frontal rain the radar can't see yet), then CAPE
// instability, then the plain radar-attributed dry line.
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

// Bar heights (v2.23). The old scale was linear over 0–5 mm, but a Salzburg 15-min
// slot is almost always between 0.1 and 1.0 mm — so 90% of all real rain was squeezed
// into the bottom sixth of the chart (0.14 mm drew 5 px, 0.70 mm drew 10 px) while the
// top three quarters sat empty waiting for intensities that basically never arrive.
// Every bar looked the same height, which is why the ribbon read as noise.
//
// Worse, the trace stub was a hardcoded 10 px while a real bar was computed — so on
// 2026-08-18 the 0.02/0.04/0.07 mm LULL drew TALLER than the 0.14 mm of rain beside
// it. The dry window, the one thing this app exists to find, was rendered as the
// tallest thing in the middle of the ribbon.
//
// Now the height uses the SAME class stops as precipToColor (0.1 / 0.5 / 2 / 5), each
// class getting an equal quarter of the range, so a band boundary is a colour change
// AND a height step. Strictly ordered: dry < trace < any real reading.
const DRY_H      = 4     // the gold "it's dry" baseline
const TRACE_H    = 6     // sub-threshold echo: visible, never taller than real rain
const MIN_REAL_H = 10    // any reporting reading is legibly "this is rain"
const MAX_BAR_H  = SLOT_H - 6
const HEIGHT_STOPS = [[DRY_THRESHOLD, 0], [0.5, 0.25], [2, 0.5], [5, 0.75], [15, 1]]

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

// v2.35 — the dry-window bracket. A dry afternoon draws twenty-four 4px gold
// baselines, which is honest and is also indistinguishable from a chart that
// failed to load; that is precisely why the floating "no rain" pill had to be
// invented. The bracket draws the one thing a dry stretch actually contains: how
// long it is. On a showery afternoon the same run lands on the gap between bands.
//
// CLIPPED TO THE RADAR ZONE by its caller, always. Drawn across model bars it
// would promise a dry window on evidence the verdict itself declines to act on —
// v2.30.1's refusal rule (never claim a window on thin data), applied to a drawing
// instead of a sentence. Needs MIN_BRACKET_BARS whole bars, comfortably past the
// app's own 30-min MIN_GAP_SLOTS floor, so one quiet slot cannot draw a window.
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

// Fold the 15-min series into 30-min bars. The bar takes the MAX of its two slots,
// never the sum: the colour/height classes are calibrated per 15-min slot, and a max
// can only ever over-state the intensity — the forgiven direction (v2.7's rationale
// for the model union). agree/prob travel WITH the slot that won, so the confidence
// shown always belongs to the reading being drawn rather than to its neighbour.
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

export default function RainRibbon({ forecast, theme, t, unstable, modelRainMin }) {
  const canvasRef = useRef(null)
  const scrollRef = useRef(null)

  useEffect(() => {
    if (!forecast || !canvasRef.current) return
    const { times, precips } = forecast
    const now = Math.floor(Date.now() / 1000)

    // agree/prob are carried on the slot itself — `i` here is the index into the
    // forecast arrays, which no longer matches the slot index after filter+slice.
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
    // Render at device-pixel-ratio so the time labels are crisp (not upscaled/
    // blurry) on retina/mobile screens, then draw in CSS-pixel coordinates.
    // Cap the backing store below the GPU-texture ceiling (8192px) — the 12h
    // ribbon at dpr 3 is already ~6800 device px; anything past the ceiling
    // renders as a silently blank canvas on iOS.
    const cssW = slots.length * SLOT_W
    const dpr  = Math.max(1, Math.min(window.devicePixelRatio || 1, 8192 / cssW))
    const cssH = BAND_H + SLOT_H + BRACKET_H + LABEL_H
    canvas.width  = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    canvas.style.width  = cssW + 'px'
    canvas.style.height = cssH + 'px'

    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const pal      = palOf(theme)
    const slotBg   = theme === 'light' ? '#E8E6E1' : '#111318'
    // Brighter/darker than before for a readable label at the larger size.
    const labelCol = theme === 'light' ? '#57544D' : '#9CA3AF'
    const nowCol   = theme === 'light' ? '#0A0A0A' : '#F1F3F5'
    // The page ground (--c-bg), for knocking the bracket label out of its own line.
    const bgCol    = theme === 'light' ? '#F2F0EB' : '#08090B'

    // Model series lookup (ghost bars, within the radar zone): nearest model slot
    // within ±8 min of a ribbon slot. Only meaningful when the bars ARE radar
    // (isNowcast) — otherwise the bars themselves ARE the model already.
    const mTimes = forecast.isNowcast !== false ? (forecast.modelTimes ?? []) : []
    const mPrecips = forecast.modelPrecips ?? []
    const modelAt = (t0, t1) => {
      // A 30-min bar spans two model slots, so the ghost compares against the model's
      // PEAK across the bar. Taking one instant would let a model spike in the second
      // half go undrawn — the exact silent-drop v2.18's showGhost fix set out to end.
      let best = null
      for (let i = 0; i < mTimes.length; i++) {
        if (mTimes[i] < t0 - 8 * 60 || mTimes[i] > t1) continue
        const v = mPrecips[i] ?? 0
        if (best === null || v > best) best = v
      }
      return best
    }

    // v2.2: radar only covers ~3h; beyond radarUntil the bars ARE the model (no radar
    // to compare against), so they're drawn as dashed/lighter to stay honest about
    // being an estimate rather than a radar-precise reading.
    // Fallback timelines (isNowcast === false) are model end-to-end — the whole
    // band must say "forecast", never claim a radar zone that doesn't exist.
    // v2.34: also model-only when the radar zone has shrunk to nothing — a served
    // nowcast whose last slot is nearly behind us leaves a sliver the band would
    // tint gold and the caption would call "the first 0 h". One predicate decides
    // it for both, so the picture and the sentence can never disagree.
    const modelOnly  = !hasRadarZone(forecast.radarUntil, now, forecast.isNowcast)
    const radarUntil = modelOnly ? -Infinity : (forecast.radarUntil ?? Infinity)
    // A 30-min bar that only PARTLY overlaps the radar horizon is not a radar bar —
    // drawing it solid would claim a precision we don't have for half of it, so the
    // split is taken on the bar's END. Errs toward "estimate", the honest direction.
    const splitIdx   = slots.findIndex(s => s.end > radarUntil)
    const boundaryX  = splitIdx <= 0 ? null : splitIdx * SLOT_W

    // Zone rail (v2.6, silent since v2.35): radar zone tinted in the dry-gold
    // family, forecast zone in neutral grey — matching the "dimmer = estimate"
    // language of the bars below. The words that used to sit in here are rendered
    // as a pinned row above the scroller, so they survive a sideways swipe.
    const bandRadar = theme === 'light' ? 'rgba(122,94,0,0.22)'    : 'rgba(212,160,23,0.22)'
    const bandFcst  = theme === 'light' ? 'rgba(87,84,77,0.14)'    : 'rgba(156,163,175,0.12)'
    const radarEnd  = splitIdx === -1 ? cssW : splitIdx * SLOT_W
    if (!modelOnly && radarEnd > 0) {
      ctx.fillStyle = bandRadar
      ctx.fillRect(0, 0, radarEnd, BAND_H - 1)
    }
    if (radarEnd < cssW) {
      ctx.fillStyle = bandFcst
      ctx.fillRect(radarEnd, 0, cssW - radarEnd, BAND_H - 1)
    }
    // Bars keep their own SLOT_H coordinate system — shift the origin below the band.
    ctx.translate(0, BAND_H)

    slots.forEach((slot, i) => {
      const x = i * SLOT_W
      const beyondRadar = slot.end > radarUntil

      ctx.fillStyle = beyondRadar
        ? (theme === 'light' ? '#DEDBD3' : '#0B0D11')   // subtly dimmer — "estimate" zone
        : slotBg
      ctx.fillRect(x, 0, SLOT_W - 1, SLOT_H)

      if (beyondRadar) {
        // Model-only bar: faint translucent fill + dashed outline at the model's own
        // intensity — visible as a real bar at a glance (v2.3.1), but still clearly
        // "estimate" next to the solid radar bars. Nothing drawn when dry.
        if (slot.p >= DRY_THRESHOLD) {
          const gh = precipToHeight(slot.p)
          const c  = precipToColor(slot.p, pal)
          // v2.18 confidence: the bar height is still max(ICON-EU, AROME) — a union
          // can only ADD warnings — but HOW SOLID it looks now reflects whether the
          // two models actually agree, and how confident the model is that hour.
          // Disagreement was previously invisible: max() drew one confident line over
          // a genuine argument between the two.
          const agree = slot.agree !== false
          const pr    = slot.prob
          // Probability scales the fill within a modest range so a low-confidence hour
          // reads fainter without ever vanishing (we never hide data). No probability
          // at all (past the fetched horizon) → treated as unknown, not as low.
          const prAlpha = typeof pr === 'number' ? 0.16 + 0.22 * Math.min(1, pr / 100) : 0.28
          ctx.save()
          ctx.globalAlpha = agree ? prAlpha : prAlpha * 0.55
          ctx.fillStyle = c
          ctx.fillRect(x + 1.5, SLOT_H - gh + 0.5, SLOT_W - 4, gh - 1)
          ctx.globalAlpha = agree ? 1 : 0.45
          ctx.strokeStyle = c
          // Models disagreeing get a finer, sparser dash than the standard estimate
          // dash — visually "this is contested", not merely "this is a forecast".
          ctx.setLineDash(agree ? [3, 2] : [1, 3])
          ctx.lineWidth = 1.5
          ctx.strokeRect(x + 1.5, SLOT_H - gh + 0.5, SLOT_W - 4, gh - 1)
          ctx.restore()
        }
      } else {
        // Radar zone: solid bar, ground/radar-trusted.
        const color = precipToColor(slot.p, pal)
        const barH  = precipToHeight(slot.p)
        ctx.fillStyle = color
        ctx.fillRect(x, SLOT_H - barH, SLOT_W - 1, barH)

        // GHOST bar (v2.1): the FORECAST expects materially more rain than radar sees
        // here — faint fill + dashed outline (v2.3.1) so it's visible at a glance.
        // v2.18: was gated on radar being bone-dry (< 0.1), so a 0.14 radar reading
        // hid a 2.2 mm model expectation entirely while 0.09 would have drawn it full
        // height — a 0.05 mm cliff, sitting right at the end of the radar zone.
        const mp = modelAt(slot.t, slot.end)
        if (showGhost(slot.p, mp)) {
          const gh = precipToHeight(mp)
          ctx.save()
          ctx.globalAlpha = 0.28
          ctx.fillStyle = pal.light
          ctx.fillRect(x + 1.5, SLOT_H - gh + 0.5, SLOT_W - 4, gh - 1)
          ctx.globalAlpha = 1
          ctx.strokeStyle = pal.light
          ctx.setLineDash([3, 2])
          ctx.lineWidth = 1.5
          ctx.strokeRect(x + 1.5, SLOT_H - gh + 0.5, SLOT_W - 4, gh - 1)
          ctx.restore()
        }
      }

      // Trace tier (v2.5): sub-threshold echo (0 < p < 0.1) — the "drops on your
      // face" band. Drawn as a low translucent stub in the drizzle colour, on top of
      // the dry base bar, so a trace future is VISIBLE instead of rendering as flat
      // dry (live incident: the nowcast showed the drizzle field an hour ahead as
      // 0.01 slots and the ribbon claimed nothing was coming).
      // v2.8: when BOTH independent witnesses contradict the radar-zone carpet
      // (clear sky + fully quiet RainViewer → forecast.tracePhantom), dim those
      // stubs below even the model-zone level — still drawn (we never hide data),
      // but no longer reading as a real drizzle claim on a cloudless afternoon.
      if (slot.p > 0 && slot.p < DRY_THRESHOLD) {
        ctx.save()
        ctx.globalAlpha = beyondRadar ? 0.25 : (forecast.tracePhantom ? 0.12 : 0.45)
        ctx.fillStyle = pal.light
        ctx.fillRect(x, SLOT_H - TRACE_H, SLOT_W - 1, TRACE_H)
        ctx.restore()
      }

      // Time labels live in their own strip BELOW the bars (v2.23). They used to be
      // painted inside the bar area, so any bar taller than the text covered its own
      // timestamp. Only on the hour: at 30-min bars a label on every bar would sit
      // 46 px apart for ~36 px of text, which is legible but reads as a wall of
      // numbers — hourly gridlines are enough to place a bar in time.
      const d = new Date(slot.t * 1000)
      if (d.getMinutes() === 0) {
        ctx.save()
        ctx.fillStyle = labelCol
        ctx.font = 'bold 12px "JetBrains Mono", monospace'
        const label = `${String(d.getHours()).padStart(2, '0')}:00`
        // Never let the last label overhang the canvas edge.
        const w = ctx.measureText(label).width
        if (x + 3 + w <= cssW) ctx.fillText(label, x + 3, SLOT_H + BRACKET_H + LABEL_H - 4)
        ctx.restore()
      }
    })

    // The dry-window bracket (v2.35). Radar zone only — see dryRunIn.
    const lastRadarIdx = (splitIdx === -1 ? slots.length : splitIdx) - 1
    const dryRun = dryRunIn(slots, lastRadarIdx)
    if (dryRun) {
      const x0 = dryRun.a * SLOT_W + 2
      const x1 = (dryRun.b + 1) * SLOT_W - 3
      // Sits fully inside the bracket strip: the label's knock-out box runs from
      // y-8 to y+2, which at SLOT_H+8 starts exactly at the foot of the bars rather
      // than clipping a pixel off them.
      const y  = SLOT_H + 8
      // The run reaches the end of what radar can see AND the model keeps it dry
      // past there: cap the bracket with an arrow rather than a closing tick. The
      // measurement ended; the expectation did not, and the two are not the same
      // claim — which is the whole reason the bracket stops at the boundary.
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
      // Only label a bracket wide enough to hold the label inside its own span —
      // a caption spilling past the end marks a window we did not measure.
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

    // Radar → model handoff marker: a dashed vertical line through band + bars so
    // the zone switch has a crisp edge (the labelled band above names the zones,
    // replacing the old floating "model →" tag).
    if (boundaryX !== null) {
      ctx.save()
      ctx.strokeStyle = labelCol
      ctx.globalAlpha = 0.5
      ctx.setLineDash([2, 3])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(boundaryX, -BAND_H)
      ctx.lineTo(boundaryX, SLOT_H + BRACKET_H + LABEL_H)
      ctx.stroke()
      ctx.restore()
    }

    // "now" marker — through the zone band too, so "now" and "radar zone" visibly
    // start together. v2.23: positioned WITHIN the first bar rather than pinned to
    // x=0. Bars are aligned to :00/:30, so the first one can begin up to 30 min in
    // the past — at 15-min slots that error was ≤5 min and invisible, at 30-min bars
    // a marker nailed to the left edge would claim "now" for a time already gone.
    const nowX = Math.max(0, Math.min(SLOT_W - 2,
      Math.round(((now - slots[0].t) / BUCKET_S) * SLOT_W)))
    ctx.fillStyle = nowCol
    ctx.fillRect(nowX, -BAND_H, 2, BAND_H + SLOT_H + BRACKET_H + LABEL_H)

  }, [forecast, theme, t])

  // v2.34: the ribbon no longer auto-scrolls. The drift existed so phone users
  // would see all 12 h without knowing they could swipe, but it moved the bars out
  // from under the reader's eye mid-glance — on an app whose whole promise is a
  // fast decision, a chart that walks away is worse than one you have to nudge.
  // It stays horizontally scrollable; only the self-driving part is gone.

  const pal = palOf(theme)

  // A flat all-dry ribbon looks identical to a failed/empty one — label it so a
  // dry forecast never reads as "broken". No data at all → "waiting for data".
  const nowS = Math.floor(Date.now() / 1000)
  const rslots = (forecast?.times || [])
    .map((tt, i) => ({ t: tt, p: forecast.precips[i] ?? 0, agree: forecast.modelAgree?.[i] }))
    .filter(s => s.t >= nowS - 300)
    .slice(0, MAX_SLOTS)
  // The key describes the PICTURE, so it is computed from the same 30-min bars the
  // canvas draws, not from the raw 15-min slots. A bar takes the max of its two
  // slots, so a slot's class can vanish in the fold — and a key naming a colour
  // that is nowhere on the chart is the v2.34 label-drift bug in miniature.
  const rbars = bucket30(rslots)
  // Only a WET slot the two models argue about is worth a legend entry — two models
  // disagreeing about nothing is not a disagreement a user needs to see.
  const hasDisagreement = rslots.some(s => s.agree === false && s.p >= DRY_THRESHOLD)
  const hasData = rslots.length > 0
  // The radar span, in words, for the caption below. Derived from the same
  // forecast.radarUntil the canvas band is drawn from, so the sentence and the
  // picture can never name different boundaries (the v2.18.0 lesson).
  const showRadarZone = hasRadarZone(forecast?.radarUntil, nowS, forecast?.isNowcast)
  const spanLabel = radarSpanLabel(forecast?.radarUntil, nowS)
  // A sub-threshold stub is only worth naming when one is actually drawn.
  const hasTrace = rslots.some(s => s.p > 0 && s.p < DRY_THRESHOLD)
  // …and the "model (expected)" key only once the ribbon actually reaches past the
  // radar horizon into the dashed zone.
  // NOTE the optional chaining: `forecast` is null on the very first render, before
  // any data has arrived, and every other read in this render body is written that
  // way for exactly that reason. v2.30.0 shipped this line unguarded and it threw a
  // TypeError on first paint, which unmounted the whole app — a blank page on every
  // device. Pinned by a render test that mounts this component with forecast={null}.
  // v2.35: …and only once a model-zone bar is actually DRAWN dashed. The chip
  // explains the dashed outline; an all-dry model tail draws no outline, so the
  // chip would be explaining something that is not on the screen.
  const hasModelZone = rbars.some(b =>
    (!showRadarZone || b.t > (forecast?.radarUntil ?? Infinity)) && b.p >= DRY_THRESHOLD)
  const allDry  = hasData && rslots.every(s => s.p < DRY_THRESHOLD)
  // Which intensity classes the chart actually reaches. `dry` is always in, because
  // the gold baseline is drawn under every bar.
  const tiersShown = TIERS.filter(k => k === 'dry' || rbars.some(b => tierOf(b.p) === k))
  // The bracket, recomputed here from the same pure function and the same bars the
  // canvas uses, so the two cannot disagree about whether a dry span was drawn.
  const rUntil = showRadarZone ? (forecast?.radarUntil ?? Infinity) : -Infinity
  const rSplit = rbars.findIndex(b => b.end > rUntil)
  const hasBracket = !!dryRunIn(rbars, (rSplit === -1 ? rbars.length : rSplit) - 1)
  // Trace slots only (all sub-threshold, at least one non-zero): the overlay must
  // not claim "no rain in 3h" over visible drizzle stubs — name what's there.
  // v2.8: unless both instruments call the carpet phantom (clear sky + quiet
  // RainViewer) — then the dry line is the honest headline, not "faint drizzle".
  const traceOnly = allDry && rslots.some(s => s.p > 0) && forecast.tracePhantom !== true
  // v2.35: on a plain dry day the bracket now states the same fact WITH a length on
  // it, so the floating pill becomes a second voice on one message — the duplicate
  // v2.18.1 removed for thunderstorms. It stays for every case the bracket cannot
  // express: no data at all, trace echo, the model disagreeing with a radar
  // all-clear, and unstable air. Those all say something a drawn span cannot.
  const plainDryOnly = hasData && !traceOnly && modelRainMin == null && !unstable
  const showDryLabel = (allDry || !hasData) && !(plainDryOnly && hasBracket)

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
      {/* v2.35 — the zone row, PINNED outside the scroller. It used to be drawn
          into the canvas band, which scrolls: swipe toward the evening and the
          words "RADAR · NEXT 2½ H" left the screen, leaving a chart of dashed
          model bars with nothing naming them. The span is still
          radarSpanLabel(forecast.radarUntil) — the same value the canvas splits
          the tint on — so the sentence and the picture keep the single source
          v2.34.0 gave them. With no usable radar zone it says so outright rather
          than naming a boundary that is not drawn. */}
      {hasData && (
        <div className="flex items-center gap-2 px-4 pb-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
          {showRadarZone ? (
            <>
              <span className="text-primary shrink-0">{t('zone_radar', { h: spanLabel })}</span>
              <span className="flex-1 h-px bg-border" aria-hidden="true" />
              <span className="shrink-0">{t('zone_forecast')}</span>
            </>
          ) : (
            <span className="normal-case tracking-normal">{t('zone_caption_model')}</span>
          )}
        </div>
      )}
      <div ref={scrollRef} className="relative overflow-x-auto scrollbar-none">
        <canvas
          ref={canvasRef}
          style={{ display: 'block' }}
        />
        {showDryLabel && (
          // Centred on the BARS, not the whole canvas — the zone band above and the
          // time strip below are chrome, and letting them pull the label off-centre
          // drifts it toward the bars it is meant to sit clear of.
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none"
               style={{ paddingTop: BAND_H, paddingBottom: BRACKET_H + LABEL_H }}>
            <span className="font-mono text-xs text-muted bg-bg/70 px-2 py-0.5 rounded">
              {/* Honest attribution, in priority order: the MODEL disagreeing with a
                  radar all-clear beats everything (frontal rain the radar can't see
                  yet — the missed-evening-rain case); then CAPE instability; then the
                  plain radar-attributed dry line. Never an unqualified promise. */}
              {traceOnly ? t('ribbon_trace_only') : dryLabel(t, hasData, unstable, modelRainMin)}
            </span>
          </div>
        )}
      </div>
      {/* v2.32 replaced a six-swatch key with two lines of prose; v2.35 puts a key
          back, but a CONDITIONAL one. The instrument question the prose answered is
          now answered by the pinned zone row above, in fewer words and in the right
          place — and what is left for this row is the thing a reader genuinely
          cannot deduce from the picture: which colour means what. Every entry is
          gated on something actually being drawn that it explains (v2.18.0's own
          reasoning for the disagreement chip, extended to all of them), so a dry
          day collapses to a single swatch and a storm shows the whole ramp.

          The full scale, including the tiers a calm day never reaches, stays in the
          guide (guide_ribbon_5) where someone learning it is already looking. */}
      {hasData && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 pb-2.5 font-mono text-[9px] tracking-[0.07em] text-muted">
          {tiersShown.map(k => (
            <span key={k} className="flex items-center gap-1">
              <span className="inline-block w-3 h-1.5 rounded-[1px] shrink-0"
                    style={{ background: pal[k] }} aria-hidden="true" />
              {t('key_' + k)}
            </span>
          ))}
          {hasTrace && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-1.5 rounded-[1px] shrink-0 opacity-[0.45]"
                    style={{ background: pal.light }} aria-hidden="true" />
              {t('legend_trace')}
            </span>
          )}
          {hasModelZone && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2 rounded-[1px] shrink-0 border border-dashed border-current"
                    aria-hidden="true" />
              {t('legend_model')}
            </span>
          )}
          {hasDisagreement && <span>{t('legend_uncertain')}</span>}
        </div>
      )}
    </div>
  )
}

