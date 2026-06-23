import { useEffect, useRef } from 'react'

const SLOT_W = 46          // wider — only 12–13 slots now instead of 48
const SLOT_H = 52
const MAX_SLOTS = 13       // 1 "now" anchor + 12 × 15-min nowcast steps = 3 h
const DRY_THRESHOLD = 0.1

function precipToColor(p) {
  if (p < DRY_THRESHOLD) return '#D4A017'
  if (p < 0.5)           return '#6CD1EB'
  if (p < 2)             return '#1BAEE2'
  if (p < 5)             return '#0077AA'
  return                        '#E05C00'
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
    canvas.width  = slots.length * SLOT_W
    canvas.height = SLOT_H

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const slotBg   = theme === 'light' ? '#E8E6E1' : '#111318'
    const labelCol = theme === 'light' ? '#6B6860' : '#6B7280'
    const nowCol   = theme === 'light' ? '#0A0A0A' : '#F1F3F5'

    slots.forEach((slot, i) => {
      const x     = i * SLOT_W
      const color = precipToColor(slot.p)
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
        ctx.font = '8px JetBrains Mono, monospace'
        const label = `${String(d.getHours()).padStart(2, '0')}:${m === 0 ? '00' : '30'}`
        ctx.fillText(label, x + 2, SLOT_H - 5)
      }
    })

    // "now" marker
    ctx.fillStyle = nowCol
    ctx.fillRect(0, 0, 2, SLOT_H)

  }, [forecast, theme])

  const isNowcast = forecast?.isNowcast !== false

  return (
    <div className="border-t border-b border-border shrink-0">
      <div className="overflow-x-auto scrollbar-none">
        <canvas
          ref={canvasRef}
          height={SLOT_H}
          style={{ display: 'block', imageRendering: 'crisp-edges' }}
        />
      </div>
      <div className="flex items-center gap-4 px-4 py-2">
        <Legend color="#D4A017" label={t('dry')} />
        <Legend color="#6CD1EB" label={t('light_rain')} />
        <Legend color="#0077AA" label={t('heavy_rain')} />
        <Legend color="#E05C00" label={t('storm_rain')} />
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
      <span className="font-mono text-xs text-muted">{label}</span>
    </div>
  )
}
