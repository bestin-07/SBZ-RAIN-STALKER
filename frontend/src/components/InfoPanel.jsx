import { skyPalOf } from './RainRibbon'

// Donation link. Paste your PayPal.me / Stripe Payment Link / Ko-fi URL here,
// or set VITE_DONATE_URL in Railway to override without editing code.
// e.g. 'https://paypal.me/yourhandle'
const DONATE_URL = import.meta.env.VITE_DONATE_URL || ''

export default function InfoPanel({ open, onClose, onPrivacy, t, theme }) {
  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-surface border-t border-border overflow-y-auto overscroll-contain max-h-sheet"
        style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
      >
        <div className="px-6 pt-6 pb-2">

          {/* ── GUIDE ── */}
          <div className="font-display font-bold text-2xl text-primary mb-5 tracking-tight">
            {t('guide_title')}
          </div>

          <p className="font-mono text-sm text-muted leading-relaxed mb-5">
            {t('guide_what_is')}
          </p>

          <div className="space-y-4 mb-5">
            <StatusRow color="var(--c-go)"    badge="GEMMA RAUS"        desc={t('guide_green')} />
            <StatusRow color="var(--c-light)" badge={t('LIGHT_RAIN')}    desc={t('guide_light')} />
            <StatusRow color="var(--c-wait)"  badge={t('guide_ex_wait')}  desc={t('guide_yellow')} />
            <StatusRow color="var(--c-stuck)" badge={t('guide_ex_stuck')} desc={t('guide_red')} />
          </div>

          {/* ── THE SKY LINE (v2.30) ── */}
          <div className="font-mono text-xs tracking-[0.12em] uppercase text-muted mb-3">
            {t('guide_sky_title')}
          </div>
          <p className="font-mono text-xs text-muted leading-relaxed mb-5">
            {t('guide_sky')}
          </p>

          {/* ── WHERE THE ANSWER COMES FROM (v2.30) ── */}
          <div className="font-mono text-xs tracking-[0.12em] uppercase text-muted mb-3">
            {t('guide_lanes_title')}
          </div>
          <div className="space-y-2 mb-5">
            {['guide_lanes_1','guide_lanes_2','guide_lanes_3'].map(k => (
              <p key={k} className="font-mono text-xs text-muted leading-relaxed">{t(k)}</p>
            ))}
          </div>

          {/* ── HOW TO READ THE RIBBON ── */}
          <div className="font-mono text-xs tracking-[0.12em] uppercase text-muted mb-3">
            {t('guide_ribbon_title')}
          </div>
          <RibbonGuide t={t} theme={theme} />
          <div className="space-y-2 mb-5">
            {['guide_ribbon_1','guide_ribbon_2','guide_ribbon_3','guide_ribbon_4','guide_ribbon_5','guide_ribbon_6','guide_ribbon_7'].map(k => (
              <p key={k} className="font-mono text-xs text-muted leading-relaxed">{t(k)}</p>
            ))}
          </div>

          {/* ── THE FIVE-DAY STRIP (v2.30) ── */}
          <div className="font-mono text-xs tracking-[0.12em] uppercase text-muted mb-3">
            {t('guide_days_title')}
          </div>
          <DayGuide t={t} />
          <div className="space-y-2 mb-5">
            {['guide_days_1','guide_days_2'].map(k => (
              <p key={k} className="font-mono text-xs text-muted leading-relaxed">{t(k)}</p>
            ))}
          </div>

          <p className="font-mono text-xs text-muted leading-relaxed mb-5">
            {t('guide_weather')}
          </p>

          <p className="font-mono text-xs text-muted leading-relaxed mb-5">
            {t('guide_locate')}
          </p>

          <div className="border border-border px-4 py-3 mb-8">
            <p className="font-mono text-xs text-muted leading-relaxed">
              {t('guide_disclaimer')}
            </p>
          </div>

          <div className="w-full h-px bg-border mb-8" />

          {/* ── ABOUT ── */}
          <div className="font-mono text-xs tracking-[0.12em] uppercase text-muted mb-3">
            {t('info_title')}
          </div>
          <div className="space-y-4 mb-8">
            {['info_p1','info_p2','info_p3','info_p4','info_p5','info_p6'].map(k => (
              <p key={k} className="font-mono text-sm text-muted leading-relaxed">
                {t(k)}
              </p>
            ))}
          </div>

          <div className="font-mono text-xs tracking-[0.12em] uppercase text-muted mb-3">
            {t('data_sources')}
          </div>
          <div className="space-y-3 mb-10">
            <DataRow label={t('src_forecast')} value="Open-Meteo ICON-EU" />
            <DataRow label={t('src_radar')}    value="RainViewer · EU composite" />
            <DataRow label={t('src_station')}  value="GeoSphere TAWES · 6 nearest + airport" />
            <DataRow label={t('src_radar_pt')} value="GeoSphere nowcast · 1 km / 15 min" />
            <DataRow label={t('src_daily')}    value="Open-Meteo daily · 5 days + sun times" />
            <DataRow label={t('src_accuracy')} value={t('fact_03')} />
          </div>

          <div className="font-mono text-xs tracking-[0.12em] uppercase text-muted mb-3 mt-8">
            {t('install_title')}
          </div>
          <div className="space-y-2 mb-10 border-l-2 border-border pl-4">
            <p className="font-mono text-xs text-muted leading-relaxed">{t('install_brave')}</p>
            <p className="font-mono text-xs text-muted leading-relaxed">{t('install_safari')}</p>
            <p className="font-mono text-xs text-primary leading-relaxed">{t('install_note')}</p>
          </div>

          <div className="font-mono text-xs tracking-[0.12em] uppercase text-muted mb-3 mt-8">
            {t('privacy_title')}
          </div>
          <div className="space-y-2 mb-3 border-l-2 border-border pl-4">
            <p className="font-mono text-xs text-muted leading-relaxed">{t('privacy_page_lead')}</p>
            <p className="font-mono text-xs text-muted leading-relaxed">{t('privacy_page_honest')}</p>
            <p className="font-mono text-xs text-muted leading-relaxed">{t('privacy_page_auto')}</p>
          </div>
          <button
            onClick={onPrivacy}
            className="font-mono text-xs text-primary hover:opacity-70 transition-opacity mb-8 inline-block"
          >
            {t('privacy_link')}
          </button>

          {/* ── SUPPORT ── */}
          <div className="w-full h-px bg-border mb-8" />
          <div className="font-mono text-xs tracking-[0.12em] uppercase text-muted mb-3">
            {t('support_title')}
          </div>
          <p className="font-mono text-sm text-muted leading-relaxed mb-5">
            {t('made_by')}
          </p>

          <div className="mb-6">
            {DONATE_URL ? (
              <a
                href={DONATE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 font-display font-bold text-sm tracking-[0.12em] uppercase px-6 py-3 rounded-lg bg-go text-bg hover:opacity-90 transition-opacity"
              >
                ☕ {t('buy_coffee')}
              </a>
            ) : (
              <span className="font-mono text-xs text-muted">{t('coffee_soon')}</span>
            )}
          </div>

          <div className="mb-8">
            <p className="font-mono text-xs text-muted mb-2">{t('contact_line')}</p>
            <a
              href="mailto:contact@gemmaraus.at"
              className="font-mono text-xs text-primary hover:opacity-70 transition-opacity"
            >
              contact@gemmaraus.at
            </a>
          </div>

          <button
            onClick={onClose}
            className="font-display font-bold text-sm tracking-[0.15em] uppercase px-6 py-3 bg-primary text-bg transition-opacity hover:opacity-80"
          >
            {t('close')}
          </button>

          {/* Impressum / Offenlegung. Legally required of an Austrian site
              (ECG §5, MedienG §25) and deliberately kept to the minimum that
              satisfies it: the name is not part of the app's voice anywhere else.
              Not translated — a person's name and city are the same in both.
              v2.34: sits BELOW the close button with the version line — it is a
              legal footer, not a section of the guide, and reading it was never a
              step on the way out of the panel. */}
          <div className="mt-8 opacity-70">
            <div className="font-mono text-[11px] tracking-[0.12em] uppercase text-muted mb-1">
              {t('imprint_title')}
            </div>
            <address className="font-mono text-[11px] text-muted leading-relaxed not-italic">
              Bestin Antu · Salzburg, AT
            </address>
          </div>

          <p className="font-mono text-[11px] text-muted mt-3 opacity-70">
            Gemma Raus v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'}
          </p>
        </div>
      </div>
    </>
  )
}

// A miniature of the real chart, drawn as SVG rather than shipped as a picture:
// it reads the same colour tokens the chart itself uses, so it stays correct in
// both themes and cannot drift out of date the way a screenshot would.
// v2.37 — redrawn as a filled skyline (area + line) instead of bars, matching the
// real ribbon's own bars→skyline redesign. A bar-shaped guide describing a chart
// the app no longer draws is exactly the v2.18.0 lesson (the guide must never
// drift from the picture it explains) — this keeps the two in lockstep the same
// way DayGuide below stays honest about DayStrip's own, separate colour scale.
// Deliberately shows one story: dry, a bleed the model already sees, the storm
// itself, easing — then, past the radar horizon, a forecast line the two models
// disagree about — because that is the shape people need to learn to read.
function RibbonGuide({ t, theme }) {
  const W = 40, BASE = 66, N = 8, SPLIT = 6 * W
  const sky = skyPalOf(theme)
  const vals = [0, 0, 0.3, 1.6, 2.3, 0.4, 0.5, 1.9]
  const h = v => (v < 0.1 ? 2 : 6 + Math.min(1, v / 2.4) * 56)
  const pts = vals.map((v, i) => ({ x: i * W + W / 2, y: BASE - h(v) }))
  const full = [{ x: 0, y: pts[0].y }, ...pts, { x: N * W, y: pts[N - 1].y }]
  const path = full.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const areaPath = `M0,${BASE} ${full.map(p => `L${p.x},${p.y}`).join(' ')} L${SPLIT},${BASE} Z`
  // The bleed: still inside the radar zone (index 1, still measured dry), the
  // model already expects the rise that only actually arrives at index 3.
  const bleedX = 1 * W + W / 2, bleedY = BASE - h(1.6)
  // The argument: past the radar horizon, the two models disagree about index 7.
  const argX = pts[7].x, argY = pts[7].y
  return (
    // w-full alone let the 320-wide viewBox stretch to the full panel on desktop —
    // ~6x scale, so the 7px zone captions rendered larger than the headings. Capped at
    // roughly its natural size: fills the width on a phone, stays a diagram on a laptop.
    <svg viewBox="0 0 320 82" className="w-full max-w-[360px] h-auto text-primary mb-4"
         role="img" aria-label={t('guide_ribbon_title')}>
      <defs>
        <linearGradient id="skyGuideGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={sky.storm} />
          <stop offset="100%" stopColor={sky.rain} />
        </linearGradient>
        <clipPath id="skyGuideRadar"><rect x="0" y="0" width={SPLIT} height={BASE + 2} /></clipPath>
        <clipPath id="skyGuideFcst"><rect x={SPLIT} y="0" width={320 - SPLIT} height={BASE + 2} /></clipPath>
      </defs>
      <text x="6" y="9" fontSize="7" fontFamily="monospace" fill="var(--c-muted)">RADAR</text>
      <text x={SPLIT + 6} y="9" fontSize="7" fontFamily="monospace" fill="var(--c-muted)">
        {t('guide_ribbon_lbl_model')}
      </text>
      {/* filled radar zone */}
      <path d={areaPath} fill="url(#skyGuideGrad)" fillOpacity="0.85" clipPath="url(#skyGuideRadar)" />
      <path d={path} stroke="url(#skyGuideGrad)" strokeWidth="2" fill="none" clipPath="url(#skyGuideRadar)" />
      {/* dashed forecast continuation, no fill */}
      <path d={path} stroke="url(#skyGuideGrad)" strokeWidth="2" fill="none"
            strokeDasharray="4 3" clipPath="url(#skyGuideFcst)" />
      {/* bleed spike */}
      <path d={`M${bleedX - W / 2 + 3},${BASE} L${bleedX},${bleedY} L${bleedX + W / 2 - 3},${BASE}`}
            stroke={sky.storm} strokeWidth="1.5" strokeDasharray="3 2" fill="none" />
      <circle cx={bleedX} cy={bleedY} r="3" fill="var(--c-bg)" stroke={sky.storm} strokeWidth="1.5" />
      {/* disagreement ring */}
      <line x1={argX} y1={argY - 10} x2={argX} y2={BASE} stroke="var(--c-primary)"
            strokeWidth="1" strokeDasharray="2 2" opacity="0.55" />
      <circle cx={argX} cy={argY} r="3.5" fill="var(--c-bg)" stroke={sky.storm} strokeWidth="1.5" />
      {/* radar → model divider */}
      <line x1={SPLIT} y1="0" x2={SPLIT} y2={BASE + 14} stroke="var(--c-muted)"
            strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
      {/* "now" */}
      <rect x="0" y="0" width="2" height={BASE + 14} fill="currentColor" />
      {[0, 2, 4, 6].map((i, n) => (
        <text key={i} x={i * W + 4} y="78" fontSize="8" fontFamily="monospace"
              fill="var(--c-muted)">{15 + n}:00</text>
      ))}
    </svg>
  )
}

// A miniature day row, drawn the same way as RibbonGuide above and for the same
// reason: it reads the live colour tokens, so it cannot drift out of date or go
// wrong in one theme the way a screenshot would. One day, one story — dry through
// the morning, rain arriving late afternoon, easing at night — with the dry window
// marked, because the window is the part people need to learn to spot.
function DayGuide({ t }) {
  const W = 22, GAP = 3, BASE = 30, X0 = 44
  // 12 buckets of 2 h, on the app's own precip ramp.
  const buckets = [0, 0, 0, 0, 0, 0, 0, 0.3, 1.4, 2.6, 0.9, 0.2]
  const col = v => v < 0.1 ? 'var(--c-go)' : v < 0.5 ? 'var(--c-light)'
                : v < 2 ? 'var(--c-wait)' : 'var(--c-stuck)'
  const h = v => v < 0.1 ? 3 : Math.max(5, Math.round(Math.sqrt(v / 2.5) * 22))
  const width = X0 + buckets.length * (W + GAP) + 58
  return (
    <svg viewBox={`0 0 ${width} 46`} className="w-full max-w-[360px] h-auto mb-4"
         role="img" aria-label={t('guide_days_title')}>
      <text x="0" y={BASE} fontSize="9" fontFamily="monospace" fill="var(--c-muted)">WED</text>
      {buckets.map((v, i) => {
        const bh = h(v)
        return <rect key={i} x={X0 + i * (W + GAP)} y={BASE - bh} width={W} height={bh}
                     fill={col(v)} fillOpacity={v < 0.1 ? 0.45 : 1} rx="1" />
      })}
      <text x={width - 52} y={BASE} fontSize="9" fontFamily="monospace" fill="var(--c-muted)">60%</text>
      <text x={width - 22} y={BASE} fontSize="9" fontFamily="monospace" fill="var(--c-primary)">21°</text>
      {/* the dry window, which is the thing to learn to spot */}
      <line x1={X0} y1={BASE + 6} x2={X0 + 7 * (W + GAP) - GAP} y2={BASE + 6}
            stroke="var(--c-go)" strokeWidth="1.5" />
      <text x={X0} y={BASE + 16} fontSize="8" fontFamily="monospace" fill="var(--c-go)">
        {t('guide_days_lbl_window')}
      </text>
    </svg>
  )
}

function StatusRow({ color, badge, desc }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="font-display font-bold text-sm shrink-0 leading-tight"
        style={{ color }}
      >
        {badge}
      </span>
      <span className="font-mono text-xs text-muted leading-relaxed pt-px">{desc}</span>
    </div>
  )
}

function DataRow({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-3">
      <span className="font-mono text-xs text-muted shrink-0 sm:w-28">{label}</span>
      <span className="font-mono text-xs text-primary">{value}</span>
    </div>
  )
}
