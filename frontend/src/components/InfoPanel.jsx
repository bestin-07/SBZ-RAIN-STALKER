import { TileIcon } from './RainRibbon'

// Donation link. Paste your PayPal.me / Stripe Payment Link / Ko-fi URL here,
// or set VITE_DONATE_URL in Railway to override without editing code.
// e.g. 'https://paypal.me/yourhandle'
const DONATE_URL = import.meta.env.VITE_DONATE_URL || ''

export default function InfoPanel({
  open, onClose, onPrivacy, t, theme,
  installable, onInstall, isStandalone, isIOSSafari, isIOSOther, isAndroid,
}) {
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

          {/* One colored sentence per state, not a colored badge word next to
              a separate grey description — the GO state's own headline on
              the real screen is now a colored sentence too (see GapBanner),
              not a repeat of the brand name, so a two-column badge+desc
              layout here no longer matched what the app actually shows. The
              color alone still carries which state is which, same as on the
              real headline. */}
          <div className="space-y-3 mb-5">
            <p className="font-mono text-sm font-bold leading-relaxed" style={{ color: 'var(--c-go)' }}>{t('guide_green')}</p>
            <p className="font-mono text-sm font-bold leading-relaxed" style={{ color: 'var(--c-light)' }}>{t('guide_light')}</p>
            <p className="font-mono text-sm font-bold leading-relaxed" style={{ color: 'var(--c-wait)' }}>{t('guide_yellow')}</p>
            <p className="font-mono text-sm font-bold leading-relaxed" style={{ color: 'var(--c-stuck)' }}>{t('guide_red')}</p>
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
          <RibbonGuide t={t} />
          <div className="space-y-2 mb-5">
            {['guide_ribbon_1','guide_ribbon_2','guide_ribbon_3','guide_ribbon_4'].map(k => (
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
          {/* Device-aware, not a static "Brave OR Safari" paragraph regardless
              of what's actually open — a small standing home for install
              guidance now that the header's own persistent strip is gone
              (see App.jsx/Header.jsx). Chrome/Edge (a captured
              beforeinstallprompt) get a real button; every other case gets
              the one line of text that applies to it. */}
          <div className="space-y-2 mb-10 border-l-2 border-border pl-4">
            {isStandalone ? (
              <p className="font-mono text-xs text-go leading-relaxed">{t('install_already')}</p>
            ) : (
              <>
                <p className="font-mono text-xs text-muted leading-relaxed">
                  {installable ? t('ip_body')
                    : isIOSSafari ? t('ip_ios_safari')
                    : isIOSOther ? t('ip_ios_other')
                    : isAndroid ? t('ip_android')
                    : t('ip_generic')}
                </p>
                {installable && (
                  <button
                    onClick={onInstall}
                    className="min-h-[44px] px-4 rounded-lg bg-primary text-bg font-display font-bold text-sm active:scale-95 transition"
                  >
                    {t('ip_btn')}
                  </button>
                )}
                <p className="font-mono text-xs text-primary leading-relaxed">{t('install_note')}</p>
              </>
            )}
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

// v3.0 — the guide is example TILES, using the exact same TileIcon the real
// ribbon draws (imported, not redrawn) so this cannot drift from the real
// chart the way the old hand-drawn skyline illustration could. solid = radar,
// dashed = model, a ring badge = the two disagree — nothing else about the
// tile grammar needs a diagram, the icon shapes themselves (dry/drizzle/
// rain/storm) are read the way any weather-app icon is, no legend required.
// v3.0.3 — a 4th example added for the trace/"drizzle possible" marker: the
// one piece of the real chart's vocabulary this guide didn't yet explain —
// the small corner badge a reader sees and has no way to look up otherwise.
// `mist` mirrors the real Tile's own badge exactly (top-LEFT, so it can never
// collide with the mismatch ring at top-right on a tile that is both).
function RibbonGuide({ t }) {
  const Example = ({ tier, solid, mismatch, mist, label }) => (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative">
        <div className="w-11 h-14 rounded-[10px] flex items-center justify-center"
             style={solid
               ? { background: 'var(--c-wait)' }
               : { background: 'transparent', border: '1.5px dashed var(--c-wait)' }}>
          <span style={{ color: solid ? '#fff' : 'var(--c-wait)' }}><TileIcon tier={tier} size={22} /></span>
        </div>
        {mismatch && (
          <span aria-hidden="true" className="absolute -top-1 -right-1 w-3 h-3 rounded-full"
                style={{ background: 'var(--c-surface)', border: '1.5px dashed var(--c-wait)' }} />
        )}
        {mist && (
          <span aria-hidden="true" className="absolute -top-1 -left-1 w-3 h-3 rounded-full"
                style={{ background: 'var(--c-light)', border: '1.5px solid var(--c-surface)' }} />
        )}
      </div>
      <span className="font-mono text-[9px] tracking-wide uppercase text-muted text-center leading-tight max-w-[64px]">
        {label}
      </span>
    </div>
  )
  return (
    <div className="flex items-start justify-around gap-2 mb-4 py-1"
         role="img" aria-label={t('guide_ribbon_title')}>
      <Example tier="rain" solid label={t('guide_ribbon_lbl_radar')} />
      <Example tier="rain" label={t('guide_ribbon_lbl_model')} />
      <Example tier="rain" solid mismatch label={t('guide_ribbon_lbl_mismatch')} />
      <Example tier="dry" solid mist label={t('legend_trace')} />
    </div>
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

function DataRow({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-3">
      <span className="font-mono text-xs text-muted shrink-0 sm:w-28">{label}</span>
      <span className="font-mono text-xs text-primary">{value}</span>
    </div>
  )
}
