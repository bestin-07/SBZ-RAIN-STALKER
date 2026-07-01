// Donation link. Paste your PayPal.me / Stripe Payment Link / Ko-fi URL here,
// or set VITE_DONATE_URL in Railway to override without editing code.
// e.g. 'https://paypal.me/yourhandle'
const DONATE_URL = import.meta.env.VITE_DONATE_URL || ''

export default function InfoPanel({ open, onClose, onPrivacy, t }) {
  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-surface border-t border-border overflow-y-auto"
        style={{ maxHeight: '92vh', paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
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
                className="inline-flex items-center gap-2 font-display font-bold text-sm tracking-[0.12em] uppercase px-6 py-3 rounded-lg bg-[#D4A017] text-bg hover:opacity-90 transition-opacity"
              >
                ☕ {t('buy_coffee')}
              </a>
            ) : (
              <span className="font-mono text-xs text-muted">{t('coffee_soon')}</span>
            )}
          </div>

          <div className="mb-10">
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
        </div>
      </div>
    </>
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
