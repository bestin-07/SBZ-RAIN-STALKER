import { useEffect, useRef } from 'react'

const SLOT_W = 46
const SLOT_H = 52
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
function palOf(theme) { return PALETTE[theme === 'light' ? 'light' : 'dark'] }

function precipToColor(p, pal) {
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

function precipToHeight(p) {
  if (p < DRY_THRESHOLD) return 4
  const pct = Math.min(p / 5, 1)
  return Math.round(4 + pct * (SLOT_H - 10))
}

export default function RainRibbon({ forecast, theme, t, unstable, modelRainMin }) {
  const canvasRef = useRef(null)
  const scrollRef = useRef(null)
  const pausedUntilRef = useRef(0)

  useEffect(() => {
    if (!forecast || !canvasRef.current) return
    const { times, precips } = forecast
    const now = Math.floor(Date.now() / 1000)

    const slots = times
      .map((t, i) => ({ t, p: precips[i] ?? 0 }))
      .filter(s => s.t >= now - 300)
      .slice(0, MAX_SLOTS)

    if (!slots.length) return

    const canvas = canvasRef.current
    // Render at device-pixel-ratio so the time labels are crisp (not upscaled/
    // blurry) on retina/mobile screens, then draw in CSS-pixel coordinates.
    const dpr  = window.devicePixelRatio || 1
    const cssW = slots.length * SLOT_W
    canvas.width  = Math.round(cssW * dpr)
    canvas.height = Math.round(SLOT_H * dpr)
    canvas.style.width  = cssW + 'px'
    canvas.style.height = SLOT_H + 'px'

    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, SLOT_H)

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
    const modelAt = (tt) => {
      let best = null, bd = 8 * 60
      for (let i = 0; i < mTimes.length; i++) {
        const d = Math.abs(mTimes[i] - tt)
        if (d < bd) { bd = d; best = mPrecips[i] ?? 0 }
      }
      return best
    }

    // v2.2: radar only covers ~3h; beyond radarUntil the bars ARE the model (no radar
    // to compare against), so they're drawn as dashed/lighter to stay honest about
    // being an estimate rather than a radar-precise reading.
    const radarUntil = forecast.radarUntil ?? Infinity
    let boundaryX = null

    slots.forEach((slot, i) => {
      const x = i * SLOT_W
      const beyondRadar = slot.t > radarUntil
      if (beyondRadar && boundaryX === null) boundaryX = x

      ctx.fillStyle = beyondRadar
        ? (theme === 'light' ? '#DEDBD3' : '#0B0D11')   // subtly dimmer — "estimate" zone
        : slotBg
      ctx.fillRect(x, 0, SLOT_W - 1, SLOT_H)

      if (beyondRadar) {
        // Model-only bar: dashed outline at the model's own intensity (or nothing if
        // dry — a dry read this far out isn't worth flagging as a special estimate).
        if (slot.p >= DRY_THRESHOLD) {
          const gh = precipToHeight(slot.p)
          ctx.save()
          ctx.strokeStyle = precipToColor(slot.p, pal)
          ctx.setLineDash([3, 2])
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

        // GHOST bar (v2.1): radar says dry here but the MODEL expects rain.
        const mp = modelAt(slot.t)
        if (slot.p < DRY_THRESHOLD && mp != null && mp >= DRY_THRESHOLD) {
          const gh = precipToHeight(mp)
          ctx.save()
          ctx.strokeStyle = pal.light
          ctx.setLineDash([3, 2])
          ctx.lineWidth = 1.5
          ctx.strokeRect(x + 1.5, SLOT_H - gh + 0.5, SLOT_W - 4, gh - 1)
          ctx.restore()
        }
      }

      // label at :00 and :30 boundaries
      const d = new Date(slot.t * 1000)
      const m = d.getMinutes()
      if (m === 0 || m === 30) {
        ctx.fillStyle = labelCol
        ctx.font = 'bold 12px "JetBrains Mono", monospace'
        const label = `${String(d.getHours()).padStart(2, '0')}:${m === 0 ? '00' : '30'}`
        ctx.fillText(label, x + 3, SLOT_H - 6)
      }
    })

    // Radar → model handoff marker: a dashed vertical line + small tag so the switch
    // in bar style (solid → dashed) has an obvious reason.
    if (boundaryX !== null) {
      ctx.save()
      ctx.strokeStyle = labelCol
      ctx.globalAlpha = 0.5
      ctx.setLineDash([2, 3])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(boundaryX, 0)
      ctx.lineTo(boundaryX, SLOT_H)
      ctx.stroke()
      ctx.restore()
      ctx.fillStyle = labelCol
      ctx.font = '9px "JetBrains Mono", monospace'
      ctx.fillText(t ? t('ribbon_model_from') : 'model →', boundaryX + 3, 11)
    }

    // "now" marker
    ctx.fillStyle = nowCol
    ctx.fillRect(0, 0, 2, SLOT_H)

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

    function frame(ts) {
      rafId = requestAnimationFrame(frame)
      if (lastTs == null) lastTs = ts
      const dt = (ts - lastTs) / 1000
      lastTs = ts

      if (Date.now() < pausedUntilRef.current) return   // user is interacting — hands off
      const max = el.scrollWidth - el.clientWidth
      if (max <= 4) return                               // fits on screen, nothing to do

      if (phase === 'holdEnd' || phase === 'holdStart') {
        if (Date.now() >= holdUntil) phase = phase === 'holdEnd' ? 'rewind' : 'forward'
        return
      }
      if (phase === 'forward') {
        el.scrollLeft = Math.min(max, el.scrollLeft + FORWARD_PX_S * dt)
        if (el.scrollLeft >= max - 1) { phase = 'holdEnd'; holdUntil = Date.now() + HOLD_END_MS }
      } else {   // 'rewind'
        el.scrollLeft = Math.max(0, el.scrollLeft - REWIND_PX_S * dt)
        if (el.scrollLeft <= 1) { phase = 'holdStart'; holdUntil = Date.now() + HOLD_START_MS }
      }
    }
    rafId = requestAnimationFrame(frame)

    const pause = () => { pausedUntilRef.current = Date.now() + RESUME_AFTER_MS }
    el.addEventListener('pointerdown', pause, { passive: true })
    el.addEventListener('wheel', pause, { passive: true })
    el.addEventListener('touchstart', pause, { passive: true })

    return () => {
      cancelAnimationFrame(rafId)
      el.removeEventListener('pointerdown', pause)
      el.removeEventListener('wheel', pause)
      el.removeEventListener('touchstart', pause)
    }
  }, [forecast])

  const isNowcast = forecast?.isNowcast !== false
  const pal = palOf(theme)

  // A flat all-dry ribbon looks identical to a failed/empty one — label it so a
  // dry forecast never reads as "broken". No data at all → "waiting for data".
  const nowS = Math.floor(Date.now() / 1000)
  const rslots = (forecast?.times || [])
    .map((tt, i) => ({ t: tt, p: forecast.precips[i] ?? 0 }))
    .filter(s => s.t >= nowS - 300)
    .slice(0, MAX_SLOTS)
  const hasData = rslots.length > 0
  const allDry  = hasData && rslots.every(s => s.p < DRY_THRESHOLD)

  return (
    <div className="border-t border-b border-border shrink-0">
      <div ref={scrollRef} className="relative overflow-x-auto scrollbar-none">
        <canvas
          ref={canvasRef}
          style={{ display: 'block' }}
        />
        {(allDry || !hasData) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="font-mono text-xs text-muted bg-bg/70 px-2 py-0.5 rounded">
              {/* Honest attribution, in priority order: the MODEL disagreeing with a
                  radar all-clear beats everything (frontal rain the radar can't see
                  yet — the missed-evening-rain case); then CAPE instability; then the
                  plain radar-attributed dry line. Never an unqualified promise. */}
              {dryLabel(t, hasData, unstable, modelRainMin)}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
        <Legend color={pal.dry}   label={t('dry')} />
        <Legend color={pal.light} label={t('light_rain')} />
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 shrink-0 border border-dashed" style={{ borderColor: pal.light }} />
          <span className="font-mono text-xs text-muted whitespace-nowrap">{t('legend_model')}</span>
        </div>
        <Legend color={pal.mod}   label={t('mod_rain')} />
        <Legend color={pal.heavy} label={t('heavy_rain')} />
        <Legend color={pal.storm} label={t('storm_rain')} />
        <span className="font-mono text-xs text-muted ml-auto">
          {t('next_12h')}
          {!isNowcast && <span className="ml-1 opacity-50">·&nbsp;est</span>}
        </span>
      </div>
    </div>
  )
}

function Legend({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-2.5 h-2.5 shrink-0" style={{ background: color }} />
      <span className="font-mono text-xs text-muted whitespace-nowrap">{label}</span>
    </div>
  )
}
