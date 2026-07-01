import { useEffect, useRef } from 'react'

const SLOT_W = 46          // wider — only 12–13 slots now instead of 48
const SLOT_H = 52
const MAX_SLOTS = 13       // 1 "now" anchor + 12 × 15-min nowcast steps = 3 h
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

function precipToHeight(p) {
  if (p < DRY_THRESHOLD) return 4
  const pct = Math.min(p / 5, 1)
  return Math.round(4 + pct * (SLOT_H - 10))
}

export default function RainRibbon({ forecast, theme, t }) {
  const canvasRef = useRef(null)

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

    slots.forEach((slot, i) => {
      const x     = i * SLOT_W
      const color = precipToColor(slot.p, pal)
      const barH  = precipToHeight(slot.p)

      ctx.fillStyle = slotBg
      ctx.fillRect(x, 0, SLOT_W - 1, SLOT_H)

      ctx.fillStyle = color
      ctx.fillRect(x, SLOT_H - barH, SLOT_W - 1, barH)

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

    // "now" marker
    ctx.fillStyle = nowCol
    ctx.fillRect(0, 0, 2, SLOT_H)

  }, [forecast, theme])

  const isNowcast = forecast?.isNowcast !== false
  const pal = palOf(theme)

  return (
    <div className="border-t border-b border-border shrink-0">
      <div className="overflow-x-auto scrollbar-none">
        <canvas
          ref={canvasRef}
          style={{ display: 'block' }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
        <Legend color={pal.dry}   label={t('dry')} />
        <Legend color={pal.light} label={t('light_rain')} />
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
