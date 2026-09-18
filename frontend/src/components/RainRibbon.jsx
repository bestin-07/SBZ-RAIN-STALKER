import { useEffect, useRef, useState } from 'react'
import { showGhost, hasRadarZone, hoursLabel, LIGHT_MIN, LIGHT_MAX } from '../gaps'

// v3.0 — the skyline (a continuous gradient area, v2.37–v2.39) is replaced by
// discrete icon tiles: 15-min solid chips in the radar zone, 30-min dashed
// chips in the forecast zone (maintainer-directed redesign, worked through
// against a mocked-up comparison first — a "standard weather app" reference
// with hand-drawn icon placeholders over the shipped chart). The reasoning
// for going back to discrete units after v2.23 deliberately moved AWAY from
// them: a bar's exact height was never the thing people read at a glance — a
// shape (rain vs. no rain, solid vs. dashed) reads faster than a height on a
// continuous scale, and standard weather apps settled on this convention for
// a reason. Solid-fill-vs-dashed-outline still carries "measured vs
// estimated" — same doctrine as the skyline, just on a chip's BORDER instead
// of a line's stroke style.
const TILE_W = 46
// v3.0 — kept at 15 min in the radar zone / 30 min beyond it, unchanged from
// the skyline's own v2.39 reasoning: radar is real, ~2.5h of measured data,
// worth the finer step; the model zone is an hourly-probability ESTIMATE,
// where a 15-min tick would be false precision.
const RADAR_BUCKET_S = 15 * 60
const MODEL_BUCKET_S = 30 * 60
const MAX_SLOTS = 49
const HORIZON_S = 12 * 3600
export const DRY_THRESHOLD = 0.1
const STORM_THRESHOLD = 1.5

// Theme-aware two-colour palette — kept EXACTLY as before, for DayStrip's own
// five-day bars (still discrete, still matched to the WAIT/STUCK headline
// colours). Untouched by the tile redesign: DayStrip imports this directly.
const PALETTE = {
  dark:  { dry: '#D4A017', rain: '#1BAEE2', storm: '#0077AA' },
  light: { dry: '#7A5E00', rain: '#0A6E9C', storm: '#024D6E' },
}
export function palOf(theme) { return PALETTE[theme === 'light' ? 'light' : 'dark'] }

export function tierOf(p) {
  if (p < DRY_THRESHOLD)      return 'dry'
  if (p < STORM_THRESHOLD)    return 'rain'
  return                             'storm'
}
export function precipToColor(p, pal) { return pal[tierOf(p)] }

// v3.0 — a 4-way tier for the TILE icon only (dry/drizzle/rain/storm): the
// same DRY_THRESHOLD/LIGHT_MAX/STORM_THRESHOLD the rest of the app already
// decides on (gaps.js's own light band, v2.20.0's "0.1mm tip can't flip
// GO↔GO-ANYWAY"), never a re-guessed boundary. Exported so InfoPanel's guide
// picks the same tier for its own example tiles, rather than a second,
// hand-copied threshold that could drift from this one (the v2.18.0 lesson).
export function tileTierOf(p) {
  if (p < DRY_THRESHOLD)   return 'dry'
  if (p < LIGHT_MAX)       return 'drizzle'
  if (p < STORM_THRESHOLD) return 'rain'
  return                          'storm'
}
// CSS custom properties, not literal hex: tiles are DOM, not canvas, so — unlike
// the old skyline's gradient, which needed literal colour strings for a 2D
// context — they can read the theme tokens directly and never go stale in one
// theme. Storm reuses --c-danger (same scoped exception the skyline itself
// carried since v2.37: "a storm on THIS chart reads the same red the RED
// warning override uses, not a new one"); dry is deliberately colourless — a
// dry tile gets a plain bordered chip, never a tinted one (the skyline's own
// "dry has no colour of any kind" rule, v2.37, carried into tile form).
const TIER_VAR = { dry: null, drizzle: 'var(--c-light)', rain: 'var(--c-wait)', storm: 'var(--c-danger)' }

// One glyph family per tier, reused for BOTH the radar (solid) and forecast
// (outline) rendering of a tile, and for the info-panel guide — the only
// difference between "radar measured this" and "model predicts this" is the
// chip's OWN style (filled vs. dashed-outline), never a different icon. That
// is also the whole of what the guide needs to teach (see InfoPanel.jsx).
function TileIcon({ tier, size = 20 }) {
  // v3.0.1 — `stroke` was missing from this list entirely. SVG's own default
  // is `stroke: none`, and `currentColor` only reaches a shape that actually
  // says `stroke="currentColor"` — the wrapping <span style={{color}}> alone
  // never draws anything. Every tile shipped as a visually empty box because
  // of this; renderToStaticMarkup only pins markup, not what a browser
  // actually paints, so the test suite could not have caught it (this is
  // exactly the gap flagged when this shipped — a live screenshot did).
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }
  const cloud = 'M7 13.6a3.6 3.6 0 0 1-.4-7.2 4.6 4.6 0 0 1 8.8-1.4A4 4 0 0 1 16.4 13.6H7Z'
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="shrink-0" aria-hidden="true">
      {tier === 'dry' && <line x1="6" y1="12" x2="18" y2="12" {...p} />}
      {tier === 'drizzle' && (
        <g {...p}>
          <path d={cloud} />
          <path d="M9.6 17v2.2M14.4 17v2.2" />
        </g>
      )}
      {tier === 'rain' && (
        <g {...p}>
          <path d={cloud} transform="translate(0,-1)" />
          <path d="M8 16.3l-1 3.3M12 16.3l-1 3.3M16 16.3l-1 3.3" />
        </g>
      )}
      {tier === 'storm' && (
        <g {...p}>
          <path d={cloud} transform="translate(0,-2)" />
          <polyline points="13.4,12.8 10.5,17.8 12.8,17.8 11.3,22.2 15.8,16.1 13.3,16.1 14.6,12.8" />
        </g>
      )}
    </svg>
  )
}

// v3.0 — one tile, one visual per zone. Solid, filled, white icon = radar
// measured it. Dashed outline, no fill, tier-coloured icon = the model
// predicted it. A small ring badge in the corner, on EITHER style, means the
// two sources on THAT tile disagree — see the mismatch computation below for
// what "disagree" means in each zone. This is deliberately the ONLY marker
// language left: the skyline used to carry two separate treatments (a dashed
// spike for "model expects more than radar measures", a dashed ring for "the
// two forecast models disagree with each other") — different shapes for what
// a reader experiences as the same fact, "the sources here don't agree".
// Maintainer call: one badge, not two, once the chart itself stopped being a
// continuous line these could ride along.
function Tile({ tier, solid, mismatch, mist, timeLabel }) {
  const col = TIER_VAR[tier]
  return (
    <div style={{ width: TILE_W }} className="shrink-0 flex flex-col items-center gap-1">
      <div className="relative">
        <div
          className="w-10 h-[52px] rounded-[10px] flex items-center justify-center"
          // v3.0.3 (round 2) — the solid dry tile's own outline used
          // `--c-border`, the app's general hairline-border token, tuned
          // subtle everywhere else it's used. On this tile it needed to be a
          // real, deliberately visible chip edge, not a hairline — ask, "make
          // the border really lighter" (dark mode). Switched to `--c-muted`,
          // the same tone the dashed/forecast dry tile already used, so a
          // solid dry tile and a dashed dry tile now share one border colour,
          // differing only by line style — one fewer thing to keep in sync.
          style={solid
            ? { background: col ?? 'transparent', border: col ? 'none' : '1.3px solid var(--c-muted)' }
            : { background: 'transparent', border: `1.5px dashed ${col ?? 'var(--c-muted)'}` }}
        >
          <span style={{ color: solid ? (col ? '#fff' : 'var(--c-muted)') : (col ?? 'var(--c-muted)') }}>
            <TileIcon tier={tier} />
          </span>
        </div>
        {mismatch && (
          <span aria-hidden="true"
                className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full"
                style={{ background: 'var(--c-panel)', border: `1.5px dashed ${col ?? 'var(--c-muted)'}` }} />
        )}
        {/* v3.0.2 — was a blurred, low-opacity dot floating above the tile's
            centre, which read as a stray artifact rather than something
            belonging to the tile (a live screenshot: "what's with these
            small blue dots?"). Now a small solid badge in the OPPOSITE
            corner from the mismatch ring (top-left, so the two can never
            collide on the same tile — a trace reading can also be a
            mismatch), same size language as that badge, no blur. Keeps its
            `.gr-mist` pulse (index.css, reduced-motion guarded) as the one
            thing that still marks it "unconfirmed" rather than measured. */}
        {mist && <span aria-hidden="true" className="gr-mist absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full pointer-events-none"
                       style={{ background: 'var(--c-light)', border: '1.5px solid var(--c-panel)' }} />}
      </div>
      <span className="font-mono text-[9px] text-muted leading-none">{timeLabel || ' '}</span>
    </div>
  )
}

// v2.35 — the dry-window bracket, unchanged logic (still exported for the
// same reason DayStrip needs `palOf`/`precipToColor`: nothing here reasons
// about DRAWING, only about which run of bars is the longest dry stretch, so
// the tile redesign doesn't touch it at all).
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

// Fold the raw 15-min series into points — unchanged from the skyline's own
// v2.39 bucketing (15 min inside the radar zone, 30 beyond it; a merged
// model-zone point takes the MAX of its two slots, the forgiven direction).
// See the v2.39 comment history in git blame for the bucket-collision fix
// this carries forward (`(cur.end - cur.t) !== size`, not `start` alone).
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

function radarCutoff(forecast, nowSec) {
  const modelOnly = !hasRadarZone(forecast?.radarUntil, nowSec, forecast?.isNowcast)
  return modelOnly ? -Infinity : (forecast?.radarUntil ?? Infinity)
}

// v2.39 — the cursor rests scrolled in by how far "now" sits across bucket
// 0's own width, so it reads as an actual moving point on the timeline
// rather than the rounded-down start of the ribbon. UNCHANGED by the tile
// redesign — this is exactly the "time line" mechanism the maintainer asked
// to leave alone, and TILE_W plays the same role SLOT_W used to.
function restScrollX(forecast, nowSec) {
  if (!forecast?.times?.length) return 0
  const radarUntil = radarCutoff(forecast, nowSec)
  const size = nowSec < radarUntil ? RADAR_BUCKET_S : MODEL_BUCKET_S
  const start = Math.floor(nowSec / size) * size
  const frac = Math.max(0, Math.min(1, (nowSec - start) / size))
  return frac * TILE_W
}

// A fixed reference sits this many px into the viewport; the track (spacer +
// tiles) scrolls under it. UNCHANGED — see restScrollX's comment above.
const CURSOR_X = 96
// v3.0.4 — trailing spacer after the LAST tile, so the browser's own native
// scroll max actually lets the final tile reach the cursor. Without this,
// the native max is `scrollWidth - clientWidth`, and since `clientWidth`
// (up to ~420px, the card's own cap) is far bigger than `CURSOR_X`, the
// natural end of the content runs out of room to scroll long before the
// last tile can ever line up under the fixed cursor — a live report: "I can
// see the end but can't scroll to it." `420 - CURSOR_X` covers the widest
// the card can ever be (its own `max-w-[420px]`), so this is always enough
// room regardless of actual viewport width, never too little.
const TRAIL_W = 420 - CURSOR_X

// v3.1 (confidence fix) — `prob` is the model's chance of RAIN, but the tile
// reads "confidence in this tile's own claim". Those are the same number
// only when the tile claims rain; when it claims DRY, a low rain-probability
// is exactly what a *confident* dry forecast looks like, and the old code
// used `prob` directly — so a bone-dry day (Salzburg, most days: rain
// probability legitimately 0-5% end to end) showed the LOWEST possible
// confidence at every forecast tile, every time. Live-checked against
// /api/ambient before writing this (2026-09-18, all 11 points: code 3, prob
// 0-3% for the full 12h) — not a hunch, a reproduced bug. Fix: read the
// probability relative to what the tile itself is claiming — `prob` when the
// tile shows rain (unchanged from before), `100 - prob` when it shows dry.
// Radar-zone behaviour is untouched (still measured, full unless a trace
// echo); the floor-at-20 and the disagreement penalty are unchanged too.
export function confidencePct(inRadar, trace, prob, agree, isDry = false) {
  if (inRadar) return trace ? 70 : 100
  if (trace) return 20
  if (typeof prob !== 'number') return 40
  let pct = Math.max(20, Math.min(100, isDry ? 100 - prob : prob))
  if (agree === false) pct = Math.max(20, pct - 20)
  return pct
}

function pctToPips(pct) {
  return Math.max(1, Math.min(5, Math.round(pct / 20)))
}
function ConfidencePips({ pct }) {
  const n = pctToPips(pct)
  return (
    <span className="inline-flex gap-[2px] shrink-0" aria-hidden="true">
      {[0, 1, 2, 3, 4].map(k => (
        <i key={k} className="block w-[5px] h-[9px] rounded-[1px]"
           style={{ background: k < n ? 'var(--c-primary)' : 'var(--c-border)' }} />
      ))}
    </span>
  )
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
function slotStatusKey(p, trace) {
  if (trace) return 'ro_status_trace'
  if (p < DRY_THRESHOLD) return 'ro_status_dry'
  if (p < LIGHT_MIN) return 'ro_status_barely'
  if (p < LIGHT_MAX) return 'ro_status_light'
  if (p < STORM_THRESHOLD) return 'ro_status_rain'
  return 'ro_status_storm'
}
function slotSourceKey(inRadar) {
  return inRadar ? 'ro_src_radar' : 'ro_src_model'
}

// Label priority when the tile row is entirely dry/empty — unchanged from the
// skyline (this never depended on how the chart drew, only on rbars).
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

// The model's own reading nearest a given radar-zone window (bleed check).
function modelPeakAt(mTimes, mPrecips, t0, t1) {
  let best = null
  for (let i = 0; i < mTimes.length; i++) {
    if (mTimes[i] < t0 - 8 * 60 || mTimes[i] > t1) continue
    const v = mPrecips[i] ?? 0
    if (best === null || v > best) best = v
  }
  return best
}

export default function RainRibbon({ forecast, theme, t, unstable, modelRainMin }) {
  const scrollRef = useRef(null)
  const [scrollX, setScrollX] = useState(0)
  // v2.39.6, kept and widened (v3.0 — "emphasise the fade" ask): the fade is
  // now the ONLY discoverability cue for horizontal scroll — the idle
  // auto-drift below is gone, on purpose (see that removal's own note). A
  // thin fade is easy to miss; a wider one visibly cuts a tile in half.
  const [atEnd, setAtEnd] = useState(false)
  const dragRef = useRef(null)

  // v3.0 — the idle auto-drift (v2.38.5) is REMOVED outright, maintainer
  // ask. It existed to teach a first-time viewer the ribbon scrolls, but it
  // fought the reader: it could start moving the track out from under a
  // finger that had just let go, and the RIGHT fix for "how do I know this
  // scrolls" is a visible affordance, not a timer nudging content around on
  // its own — which is exactly what the widened fade above now is. Nothing
  // replaces armIdle(); every call site that used to arm it is now a plain
  // drag/keyboard handler with nothing else attached.

  // Every real data refresh re-homes the ribbon to "now" (v2.38.1) — this is
  // NOT the removed auto-drift: it only fires on a genuinely new `forecast`
  // object (App.jsx's 5-min refresh cycle), never on a timer of its own, and
  // it is what keeps a scrub position from ten minutes ago from silently
  // going stale. Left exactly as it was.
  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const rest = restScrollX(forecast, Math.floor(Date.now() / 1000))
    scrollRef.current?.scrollTo({ left: rest, behavior: reduceMotion ? 'auto' : 'smooth' })
    setScrollX(rest)
    setAtEnd(false)
  }, [forecast])

  const nowS = Math.floor(Date.now() / 1000)
  const rslots = (forecast?.times || [])
    .map((tt, i) => ({ t: tt, p: forecast.precips[i] ?? 0, agree: forecast.modelAgree?.[i], prob: forecast.modelProb?.[i] }))
    .filter(s => s.t >= nowS - 300 && s.t < nowS + HORIZON_S)
    .slice(0, MAX_SLOTS)
  const hasData = rslots.length > 0
  const showRadarZone = hasRadarZone(forecast?.radarUntil, nowS, forecast?.isNowcast)
  const rUntil = showRadarZone ? (forecast?.radarUntil ?? Infinity) : -Infinity
  const rbars = bucketMixed(rslots, rUntil)
  const rSplit = rbars.findIndex(b => b.end > rUntil)
  const splitI = rSplit === -1 ? rbars.length : rSplit

  const mTimesR   = forecast?.isNowcast !== false ? (forecast?.modelTimes ?? []) : []
  const mPrecipsR = forecast?.modelPrecips ?? []
  const hasBleed = showRadarZone && rbars.some((b, i) => {
    if (i >= splitI) return false
    const mp = modelPeakAt(mTimesR, mPrecipsR, b.t, b.end)
    return mp != null && showGhost(b.p, mp)
  })
  const hasDisagreement = rbars.some((b, i) => i >= splitI && b.p >= DRY_THRESHOLD && b.agree === false)

  const hasTrace = rslots.some(s => s.p > 0 && s.p < DRY_THRESHOLD)
  const allDry  = hasData && rslots.every(s => s.p < DRY_THRESHOLD)
  const dryRun = dryRunIn(rbars, splitI - 1)
  const hasBracket = !!dryRun
  const traceOnly = allDry && rslots.some(s => s.p > 0) && forecast?.tracePhantom !== true
  const redundantWithBracket = hasBracket && modelRainMin == null && !unstable
  const showDryLabel = (allDry || !hasData) && !redundantWithBracket

  const contentW = rbars.length * TILE_W

  const scrubIdx = rbars.length
    ? Math.max(0, Math.min(rbars.length - 1, Math.floor(scrollX / TILE_W)))
    : 0
  const scrubBar = rbars[scrubIdx]
  const scrubInRadar = scrubIdx < splitI
  const scrubTrace = !!scrubBar && scrubBar.p > 0 && scrubBar.p < DRY_THRESHOLD
  const scrubIsDry = (scrubBar?.p ?? 0) < DRY_THRESHOLD
  const confPct = confidencePct(scrubInRadar, scrubTrace, scrubBar?.prob, scrubBar?.agree, scrubIsDry)
  const scrubT = scrubIdx === 0 ? nowS : (scrubBar?.t ?? nowS)

  const cursorCol = theme === 'light' ? '#0A0A0A' : '#F1F3F5'

  function onScrubPointerDown(e) {
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
    const step = e.shiftKey ? TILE_W * 4 : TILE_W
    if (e.key === 'ArrowRight') { el.scrollLeft += step; e.preventDefault() }
    else if (e.key === 'ArrowLeft') { el.scrollLeft -= step; e.preventDefault() }
    else if (e.key === 'Home') { el.scrollLeft = restScrollX(forecast, nowS); e.preventDefault() }
    // v3.0.4 — was `el.scrollLeft = contentW`, which undershoots now that the
    // track carries a trailing spacer (TRAIL_W) past the last tile — the
    // browser's own `scrollWidth` already accounts for it and always lands
    // on the true native max, so reading it back is simpler AND correct
    // regardless of TRAIL_W's exact value.
    else if (e.key === 'End') { el.scrollLeft = el.scrollWidth; e.preventDefault() }
  }
  function backToNow() {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    scrollRef.current?.scrollTo({ left: restScrollX(forecast, nowS), behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  return (
    <div className="border-t border-border shrink-0">
      {/* Scrub readout — UNCHANGED (time/status/source/confidence). The only
          change here is confidencePct's own 5th argument, above. */}
      {hasData && (
        <div className="px-4 pt-2.5 pb-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-display font-bold text-xl">{fmtSlotTime(scrubT)}</span>
              <span className="font-mono text-[11px] text-muted">{relFromNow(t, scrubT, nowS)}</span>
            </div>
            <span className="font-mono text-xs text-primary shrink-0">
              {t(slotSourceKey(scrubInRadar))}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <span className="font-mono text-sm">
              {t(slotStatusKey(scrubBar?.p ?? 0, scrubTrace))}
            </span>
            <span className="flex items-center gap-1.5 shrink-0" aria-label={t('ro_confidence', { n: pctToPips(confPct) })}>
              <span className="font-mono text-[9px] text-muted uppercase tracking-wide">{t('ro_confidence_label')}</span>
              <ConfidencePips pct={confPct} />
            </span>
          </div>
        </div>
      )}

      {/* v3.0 — the tile track sits in its own bordered, elevated card.
          v3.0.2 — `bg-surface` (`--c-surface`) turned out too close to
          `--c-bg` to read as boxed at a glance, dark theme especially (a
          live screenshot showed it: the panel barely separated from the
          page, and the right-edge fade had almost nothing to fade INTO).
          `--c-panel` (index.css) is a second, more deliberate elevation step
          reserved for exactly this — a panel that needs to stand on its own,
          not the gentle lift `--c-surface` gives a popup. The fixed cursor
          stays a sibling of the scroll box, positioned against this same
          wrapper — its own logic is completely untouched (see
          restScrollX/CURSOR_X above). */}
      <div className="px-4 pb-2">
        <div className="relative max-w-[420px] rounded-xl border border-border bg-[var(--c-panel)]">
          <div ref={scrollRef}
               className="relative overflow-x-auto scrollbar-none rounded-xl cursor-grab active:cursor-grabbing"
               tabIndex={hasData ? 0 : -1}
               role="group"
               aria-label={t('ro_aria')}
               style={hasData && !atEnd ? {
                 // v3.0 — widened 36px → 56px ("emphasise the fade" ask):
                 // with the idle auto-drift gone, this is the ONLY cue that
                 // the strip continues — it needs to visibly cut a tile in
                 // half, not just soften an edge.
                 // v3.0.3 — most of that width was a slow, low-contrast taper
                 // that a live screenshot review called "not that visible" —
                 // largely the `--c-panel` fix above (the fade reveals the
                 // panel's own colour, so a panel too close to the tiles gave
                 // it almost nothing to fade INTO), but the curve itself is
                 // also tightened: solid right up to `calc(100% - 44px)`,
                 // then a shorter, steeper drop — a crisper cut instead of a
                 // long gradual one.
                 WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 44px), transparent 100%)',
                 maskImage: 'linear-gradient(to right, black calc(100% - 44px), transparent 100%)',
               } : undefined}
               onScroll={e => {
                 const el = e.currentTarget
                 setScrollX(el.scrollLeft)
                 // v3.0.4 — measured against the real content edge
                 // (CURSOR_X + contentW), not el.scrollWidth: scrollWidth now
                 // includes TRAIL_W, the padding added so the last tile CAN
                 // reach the cursor, and that padding isn't something the
                 // fade should still be hinting at once the last real tile is
                 // already fully on screen.
                 setAtEnd(el.scrollLeft + el.clientWidth >= CURSOR_X + contentW - 1)
               }}
               onPointerDown={onScrubPointerDown}
               onPointerMove={onScrubPointerMove}
               onPointerUp={onScrubPointerUp}
               onPointerLeave={onScrubPointerUp}
               onKeyDown={onScrubKeyDown}>
            {/* v3.0.4 — TRAIL_W added past the tiles: see that constant's own
                comment. Purely extra scroll room; nothing inside this div is
                sized or positioned relative to it, so it changes nothing
                about the bracket or the tiles themselves. */}
            <div style={{ width: CURSOR_X + contentW + TRAIL_W }}>
              {/* v3.0 — the dry-window bracket moves ABOVE the tile row
                  (was: a canvas-drawn strip below the skyline). Same
                  dryRunIn run, same duration text; only where it sits
                  changed, per the maintainer's own read of the mockup. It
                  scrolls WITH the tiles it labels — it is a row inside the
                  same track, not a fixed overlay. */}
              {/* v3.0.2 — h-5→h-7 and the underline's own margin widened: a
                  live screenshot showed the gold underline sitting close
                  enough to the tiles below that it visually clipped into
                  their top edge. The bracket strip now leaves clear air
                  between its own rule and the first tile. */}
              <div className="h-7 relative px-3 pt-2">
                {dryRun && (() => {
                  const mins = (rbars[dryRun.b].end - rbars[dryRun.a].t) / 60
                  const txt = mins < 60 ? t('bracket_dry_min', { min: mins }) : t('bracket_dry_h', { h: hoursLabel(mins) })
                  return (
                    <div className="absolute" style={{ left: CURSOR_X + dryRun.a * TILE_W + 3, width: (dryRun.b - dryRun.a + 1) * TILE_W - 6 }}>
                      <div className="font-mono font-bold text-[9px] tracking-wide truncate" style={{ color: 'var(--c-go)' }}>{txt}</div>
                      <div className="h-[1.5px] mt-[5px]" style={{ background: 'var(--c-go)', opacity: 0.6 }} />
                    </div>
                  )
                })()}
              </div>
              <div className="relative flex items-end pb-2.5 pt-1.5">
                <div style={{ width: CURSOR_X }} className="shrink-0" aria-hidden="true" />
                {rbars.map((b, i) => {
                  const inRadar = i < splitI
                  const trace = b.p > 0 && b.p < DRY_THRESHOLD
                  const tier = tileTierOf(b.p)
                  const mismatch = inRadar
                    ? (() => { const mp = modelPeakAt(mTimesR, mPrecipsR, b.t, b.end); return mp != null && showGhost(b.p, mp) })()
                    : (b.p >= DRY_THRESHOLD && b.agree === false)
                  const d = new Date(b.t * 1000)
                  return (
                    <Tile key={i} tier={tier} solid={inRadar} mismatch={mismatch} mist={trace}
                          timeLabel={d.getMinutes() === 0 ? `${String(d.getHours()).padStart(2, '0')}:00` : ''} />
                  )
                })}
              </div>
            </div>
            {showDryLabel && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="font-mono text-xs text-muted bg-bg/70 px-2 py-0.5 rounded">
                  {traceOnly ? t('ribbon_trace_only') : dryLabel(t, hasData, unstable, modelRainMin)}
                </span>
              </div>
            )}
          </div>
          {/* Fixed cursor — untouched positioning/behaviour. It never moves;
              the track scrolls under it. */}
          {hasData && (
            <div className="absolute top-0 bottom-0 w-0.5 pointer-events-none"
                 style={{ left: CURSOR_X, background: cursorCol }}
                 aria-hidden="true">
              <span className="absolute rounded-full" style={{ top: -4, left: -3, width: 8, height: 8, background: cursorCol }} />
            </div>
          )}
        </div>
      </div>

      {/* Legend + "back to now" — unchanged wording/positions, gated on the
          same predicates as before (a chip only shows for something actually
          on screen, v2.18.0's own rule). legend_bleed/legend_uncertain keep
          their existing text; both now describe the SAME visual (the small
          ring badge on a tile) instead of two different marker shapes. */}
      {hasData && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 pb-2.5 font-mono text-[9px] tracking-[0.07em] text-muted">
          {hasTrace && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--c-light)' }} aria-hidden="true" />
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

export { TileIcon }
