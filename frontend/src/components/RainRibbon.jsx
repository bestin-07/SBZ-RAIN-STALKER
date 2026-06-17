import { useEffect, useRef } from 'react'

const SLOT_W = 26
const SLOT_H = 44
const DRY_THRESHOLD = 0.1

function precipToColor(p) {
  if (p < DRY_THRESHOLD) return '#D4A017'
  if (p < 0.5)           return '#1E4976'
  if (p < 2)             return '#1A3A5C'
  return                        '#0D2035'
}

function precipToHeight(p) {
  if (p < DRY_THRESHOLD) return 4
  const pct = Math.min(p / 5, 1)
  return Math.round(4 + pct * (SLOT_H - 8))
}

export default function RainRibbon({ forecast }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!forecast || !canvasRef.current) return
    const { times, precips } = forecast
    const now = Math.floor(Date.now() / 1000)

    const slots = times
      .map((t, i) => ({ t, p: precips[i] ?? 0 }))
      .filter(s => s.t >= now - 300)
      .slice(0, 48)

    if (!slots.length) return

    const canvas = canvasRef.current
    canvas.width = slots.length * SLOT_W
    canvas.height = SLOT_H

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    slots.forEach((slot, i) => {
      const x = i * SLOT_W
      const color = precipToColor(slot.p)
      const barH = precipToHeight(slot.p)

      // background slot
      ctx.fillStyle = '#111318'
      ctx.fillRect(x, 0, SLOT_W - 1, SLOT_H)

      // precipitation bar (grows from bottom)
      ctx.fillStyle = color
      ctx.fillRect(x, SLOT_H - barH, SLOT_W - 1, barH)

      // hour label
      const d = new Date(slot.t * 1000)
      if (d.getMinutes() === 0) {
        ctx.fillStyle = '#6B7280'
        ctx.font = '8px JetBrains Mono, monospace'
        ctx.fillText(`${String(d.getHours()).padStart(2, '0')}h`, x + 2, SLOT_H - 6)
      }
    })

    // NOW marker
    ctx.fillStyle = '#F1F3F5'
    ctx.fillRect(0, 0, 2, SLOT_H)

  }, [forecast])

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
        <Legend color="#D4A017" label="dry" />
        <Legend color="#1E4976" label="light rain" />
        <Legend color="#0D2035" label="heavy rain" />
        <span className="font-mono text-xs text-muted ml-auto">next 12 hours</span>
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
