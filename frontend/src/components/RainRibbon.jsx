import { useEffect, useRef } from 'react'
import { showGhost, radarSpanLabel } from '../gaps'

const SLOT_W = 46
const SLOT_H = 52
// v2.23: dedicated strip for the time labels UNDER the bars. They used to be drawn
// inside the bar area at SLOT_H-6, so every bar taller than ~10px covered its own
// timestamp — and with the rescaled bars below, essentially every wet bar does.
const LABEL_H = 15
// One bar per 30 minutes (was 15). The app never promises a break shorter than
// 30 min (MIN_GAP_SLOTS = 2), so 15-min bars drew a resolution the verdict cannot
// act on — and 49 of them across 12 h read as noise rather than as a shape.
const BUCKET_S = 30 * 60
// v2.6 zone band: thin labelled strip above the bars naming which instrument each
// zone comes from — "radar · next 3h" (observed look-ahead) vs "forecast · model"
// (estimate). The solid→dashed bar switch alone read as confusing; the band makes
// the handoff explicit without overlapping the two zones.
const BAND_H = 14
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

export function precipToColor(p, pal) {
  if (p < DRY_THRESHOLD) return pal.dry
  if (p < 0.5)           return pal.light
  if (p < 2)             return pal.mod
  if (p < 5)             return pal.heavy
  return                        pal.storm
}

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
  const pausedUntilRef = useRef(0)

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
    const cssH = BAND_H + SLOT_H + LABEL_H
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
    const modelOnly  = forecast.isNowcast === false
    const radarUntil = modelOnly ? -Infinity : (forecast.radarUntil ?? Infinity)
    // A 30-min bar that only PARTLY overlaps the radar horizon is not a radar bar —
    // drawing it solid would claim a precision we don't have for half of it, so the
    // split is taken on the bar's END. Errs toward "estimate", the honest direction.
    const splitIdx   = slots.findIndex(s => s.end > radarUntil)
    const boundaryX  = splitIdx <= 0 ? null : splitIdx * SLOT_W
    // …and the band's LABEL is derived from the same boundary, so "NEXT 2½ H" always
    // names the zone actually drawn. v2.18 fixed this label drifting from the data
    // once already; bucketing would have reintroduced it up to half an hour out.
    const lastRadar  = splitIdx === -1 ? slots[slots.length - 1]
                     : splitIdx > 0 ? slots[splitIdx - 1] : null
    const radarSpanTs = Number.isFinite(radarUntil) && lastRadar ? lastRadar.end : radarUntil

    // Zone band (v2.6): radar zone tinted in the dry-gold family, forecast zone in
    // neutral grey — matching the "dimmer = estimate" language of the bars below.
    const bandRadar = theme === 'light' ? 'rgba(122,94,0,0.22)'    : 'rgba(212,160,23,0.22)'
    const bandFcst  = theme === 'light' ? 'rgba(87,84,77,0.14)'    : 'rgba(156,163,175,0.12)'
    const radarEnd  = splitIdx === -1 ? cssW : splitIdx * SLOT_W
    ctx.font = 'bold 9px "JetBrains Mono", monospace'
    // Both band captions are clipped to their own band and skipped outright when the
    // band is too narrow to hold them — a zone label bleeding across the boundary (or
    // off the end of the canvas) mislabels the very thing it exists to name.
    const bandLabel = (text, x0, x1, pad) => {
      const room = x1 - x0
      if (!text || room < 24) return
      ctx.save()
      ctx.beginPath()
      ctx.rect(x0, 0, room, BAND_H - 2)
      ctx.clip()
      if (ctx.measureText(text).width + pad <= room) ctx.fillText(text, x0 + pad, BAND_H - 4)
      ctx.restore()
    }
    if (!modelOnly && radarEnd > 0) {
      ctx.fillStyle = bandRadar
      ctx.fillRect(0, 0, radarEnd, BAND_H - 2)
      ctx.fillStyle = labelCol
      // v2.18: the span is COMPUTED, not the old hardcoded "3 H". The nowcast's 12
      // slots cover 2h45 from their first slot and then age up to 15 min before the
      // next issue, so the radar zone really reaches ~2½ h — saying "3 H" made the
      // boundary look like it was drifting when it was the label that was wrong.
      bandLabel(t ? t('zone_radar', { h: radarSpanLabel(radarSpanTs, now) }) : 'radar', 0, radarEnd, 6)
    }
    if (radarEnd < cssW) {
      ctx.fillStyle = bandFcst
      ctx.fillRect(radarEnd, 0, cssW - radarEnd, BAND_H - 2)
      ctx.fillStyle = labelCol
      bandLabel(t ? t('zone_forecast') : 'forecast · model', radarEnd, cssW, modelOnly ? 6 : 4)
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
        if (x + 3 + w <= cssW) ctx.fillText(label, x + 3, SLOT_H + LABEL_H - 4)
        ctx.restore()
      }
    })

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
      ctx.lineTo(boundaryX, SLOT_H + LABEL_H)
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
    ctx.fillRect(nowX, -BAND_H, 2, BAND_H + SLOT_H + LABEL_H)

  }, [forecast, theme, t])

  // Auto-scroll the ribbon (v2.2) — a slow forward drift so mobile users who can't
  // see all 12h at once still see the whole thing, then a quick rewind flourish back
  // to "now" and repeat. Self-gates to when content actually overflows (desktop where
  // the full ribbon fits does nothing), skips entirely under prefers-reduced-motion,
  // and pauses for a few seconds the moment the user touches/scrolls/wheels it —
  // never fights a manual read.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const FORWARD_PX_S = 34   // slow enough to actually read the bars while it drifts
    const REWIND_PX_S  = 900  // fast "launch back to start" flourish
    const HOLD_END_MS  = 1800
    const HOLD_START_MS = 600
    const RESUME_AFTER_MS = 5000

    let phase = 'forward'     // 'forward' | 'holdEnd' | 'rewind' | 'holdStart'
    let holdUntil = 0
    let lastTs = null
    let rafId
    // Position lives in a float, NOT in el.scrollLeft: iOS Safari rounds
    // scrollLeft reads to whole pixels, so read-add-write of the sub-pixel
    // forward step (34px/s ≈ 0.57px/frame) rounded back to the same value
    // every frame — the ribbon sat frozen on iPhones while desktop browsers
    // (fractional scrollLeft) drifted fine. null = resync from the DOM on the
    // next frame (after a user drag or tab resume).
    let pos = null

    function frame(ts) {
      rafId = requestAnimationFrame(frame)
      if (lastTs == null) lastTs = ts
      // Clamp dt: after a backgrounded tab resumes, ts jumps minutes ahead in
      // one frame — unclamped that teleports the ribbon to the far end.
      const dt = Math.min(0.1, (ts - lastTs) / 1000)
      lastTs = ts

      if (Date.now() < pausedUntilRef.current) { pos = null; return }   // user is interacting — hands off
      const max = el.scrollWidth - el.clientWidth
      if (max <= 4) return                               // fits on screen, nothing to do
      if (pos == null) pos = el.scrollLeft               // resync after pause/resume

      if (phase === 'holdEnd' || phase === 'holdStart') {
        if (Date.now() >= holdUntil) phase = phase === 'holdEnd' ? 'rewind' : 'forward'
        return
      }
      if (phase === 'forward') {
        pos = Math.min(max, pos + FORWARD_PX_S * dt)
        el.scrollLeft = pos
        if (pos >= max - 1) { phase = 'holdEnd'; holdUntil = Date.now() + HOLD_END_MS }
      } else {   // 'rewind'
        pos = Math.max(0, pos - REWIND_PX_S * dt)
        el.scrollLeft = pos
        if (pos <= 1) { phase = 'holdStart'; holdUntil = Date.now() + HOLD_START_MS }
      }
    }
    rafId = requestAnimationFrame(frame)

    const pause = () => { pausedUntilRef.current = Date.now() + RESUME_AFTER_MS }
    const onVis = () => { lastTs = null; pos = null }   // fresh timing after tab resume
    el.addEventListener('pointerdown', pause, { passive: true })
    el.addEventListener('wheel', pause, { passive: true })
    el.addEventListener('touchstart', pause, { passive: true })
    document.addEventListener('visibilitychange', onVis)

    return () => {
      cancelAnimationFrame(rafId)
      el.removeEventListener('pointerdown', pause)
      el.removeEventListener('wheel', pause)
      el.removeEventListener('touchstart', pause)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [forecast])

  const isNowcast = forecast?.isNowcast !== false
  const pal = palOf(theme)

  // A flat all-dry ribbon looks identical to a failed/empty one — label it so a
  // dry forecast never reads as "broken". No data at all → "waiting for data".
  const nowS = Math.floor(Date.now() / 1000)
  const rslots = (forecast?.times || [])
    .map((tt, i) => ({ t: tt, p: forecast.precips[i] ?? 0, agree: forecast.modelAgree?.[i] }))
    .filter(s => s.t >= nowS - 300)
    .slice(0, MAX_SLOTS)
  // Only a WET slot the two models argue about is worth a legend entry — two models
  // disagreeing about nothing is not a disagreement a user needs to see.
  const hasDisagreement = rslots.some(s => s.agree === false && s.p >= DRY_THRESHOLD)
  const hasData = rslots.length > 0
  // A sub-threshold stub is only worth naming when one is actually drawn.
  const hasTrace = rslots.some(s => s.p > 0 && s.p < DRY_THRESHOLD)
  // …and the "model (expected)" key only once the ribbon actually reaches past the
  // radar horizon into the dashed zone.
  // NOTE the optional chaining: `forecast` is null on the very first render, before
  // any data has arrived, and every other read in this render body is written that
  // way for exactly that reason. v2.30.0 shipped this line unguarded and it threw a
  // TypeError on first paint, which unmounted the whole app — a blank page on every
  // device. Pinned by a render test that mounts this component with forecast={null}.
  const hasModelZone = forecast?.isNowcast === false ||
    rslots.some(s => s.t > (forecast?.radarUntil ?? Infinity))
  const allDry  = hasData && rslots.every(s => s.p < DRY_THRESHOLD)
  // Trace slots only (all sub-threshold, at least one non-zero): the overlay must
  // not claim "no rain in 3h" over visible drizzle stubs — name what's there.
  // v2.8: unless both instruments call the carpet phantom (clear sky + quiet
  // RainViewer) — then the dry line is the honest headline, not "faint drizzle".
  const traceOnly = allDry && rslots.some(s => s.p > 0) && forecast.tracePhantom !== true

  return (
    <div className="border-t border-b border-border shrink-0">
      <div ref={scrollRef} className="relative overflow-x-auto scrollbar-none">
        <canvas
          ref={canvasRef}
          style={{ display: 'block' }}
        />
        {(allDry || !hasData) && (
          // Centred on the BARS, not the whole canvas — the zone band above and the
          // time strip below are chrome, and letting them pull the label off-centre
          // drifts it toward the bars it is meant to sit clear of.
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none"
               style={{ paddingTop: BAND_H, paddingBottom: LABEL_H }}>
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
      {/* Legend (v2.30): one ordered SCALE instead of five swatch+label pairs on two
          wrapped lines. The ramp is ordered, so naming its two ends and drawing the
          steps between carries the same information in a fifth of the height — and
          the height it gives back goes to the day strip below.

          The three qualifier chips are now conditional, the way v2.18 already made
          the disagreement chip conditional: a permanent legend entry for something
          not currently drawn is clutter, and on a plain dry day this collapses to
          the scale and the span. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs text-muted whitespace-nowrap">{t('dry')}</span>
          <span className="flex" aria-hidden="true">
            {[pal.dry, pal.light, pal.mod, pal.heavy, pal.storm].map((c, i) => (
              <span key={i} className="block w-3 h-2.5" style={{ background: c }} />
            ))}
          </span>
          <span className="font-mono text-xs text-muted whitespace-nowrap">{t('storm_rain')}</span>
        </div>
        {hasTrace && (
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 shrink-0" style={{ background: pal.light, opacity: 0.45 }} />
            <span className="font-mono text-xs text-muted whitespace-nowrap">{t('legend_trace')}</span>
          </div>
        )}
        {hasModelZone && (
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 shrink-0 border border-dashed" style={{ borderColor: pal.light }} />
            <span className="font-mono text-xs text-muted whitespace-nowrap">{t('legend_model')}</span>
          </div>
        )}
        {hasDisagreement && (
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 shrink-0 border border-dotted opacity-50"
                 style={{ borderColor: pal.light }} />
            <span className="font-mono text-xs text-muted whitespace-nowrap">{t('legend_uncertain')}</span>
          </div>
        )}
        <span className="font-mono text-xs text-muted ml-auto">
          {t('next_12h')}
          {!isNowcast && <span className="ml-1 opacity-50">·&nbsp;est</span>}
        </span>
      </div>
    </div>
  )
}

