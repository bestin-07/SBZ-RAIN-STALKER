function detectBrowser() {
  const ua = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (ios) return 'ios'
  if (/Firefox\//.test(ua)) return 'firefox'
  if (/Edg\//.test(ua) || /Chrome\//.test(ua)) return 'chrome'
  if (/Safari\//.test(ua)) return 'safari'
  return 'generic'
}

const ERR_KEY = { denied: 'loc_denied', timeout: 'loc_timeout',
                  unavailable: 'loc_unavailable', unsupported: 'location_not_supported' }

export default function LocationPrompt({ onRequest, onUseDefault, error, loading, onPrivacy, t }) {
  const helpKey = `loc_help_${detectBrowser()}`
  return (
    <div className="min-h-screen bg-bg flex flex-col items-start justify-center px-6 pb-safe md:items-center">
      {/* Bounded column: left-aligned editorial look on mobile, centered on desktop */}
      <div className="w-full max-w-md">
        <div className="mb-12">
          <div className="font-display font-bold text-3xl text-primary tracking-[0.15em] uppercase mb-1">
            GEMMA RAUS
          </div>
          <div className="font-mono text-sm text-muted">
            {t('app_tagline')}
          </div>
        </div>

        <div className="mb-10 space-y-2">
          <Fact n="01" text={t('fact_01')} />
          <Fact n="02" text={t('fact_02')} />
          <Fact n="03" text={t('fact_03')} />
        </div>

        {error && (
          <div className="mb-6 w-full">
            <div className="font-mono text-xs text-stuck mb-3 border border-stuck rounded px-3 py-2">
              {t(ERR_KEY[error] ?? 'loc_unavailable')}
            </div>
            <div className="bg-surface border border-border rounded-lg px-4 py-3">
              <div className="font-mono text-[11px] tracking-[0.12em] uppercase text-primary mb-2">
                {t('loc_help_title')}
              </div>
              <p className="font-mono text-xs text-muted leading-relaxed">
                {t(helpKey)}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onRequest}
            disabled={loading}
            className="font-display font-bold text-sm tracking-[0.15em] uppercase px-8 py-4 bg-primary text-bg hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {loading ? t('locating') : t('get_location')}
          </button>

          {error && onUseDefault && (
            <button
              onClick={onUseDefault}
              className="font-mono text-xs tracking-wide uppercase px-5 py-4 border border-border text-muted hover:text-primary hover:border-primary transition-colors"
            >
              {t('loc_use_default')}
            </button>
          )}
        </div>

        <div className="font-mono text-xs text-muted mt-4 max-w-xs leading-relaxed">
          {t('privacy')}
        </div>
        <button
          onClick={onPrivacy}
          className="font-mono text-xs text-muted hover:text-primary transition-colors mt-1"
        >
          {t('privacy_worried')}
        </button>

        <div className="font-mono text-xs text-muted mt-10 flex items-center gap-1.5 opacity-70">
          <span>{t('made_with_love')}</span>
          <span aria-hidden="true" style={{ color: '#DC2626' }}>♥</span>
        </div>
      </div>
    </div>
  )
}

function Fact({ n, text }) {
  return (
    <div className="flex items-start gap-3">
      <span className="font-mono text-xs text-muted shrink-0 mt-0.5">{n}</span>
      <span className="font-mono text-xs text-muted">{text}</span>
    </div>
  )
}
