export default function LocationPrompt({ onRequest, error, loading, t }) {
  return (
    <div className="min-h-screen bg-bg flex flex-col items-start justify-center px-6 pb-safe">
      <div className="mb-12">
        <div className="font-display font-bold text-3xl text-primary tracking-[0.15em] uppercase mb-1">
          SBZ RAIN STALKER
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
        <div className="font-mono text-xs text-stuck mb-6 border border-stuck px-3 py-2">
          {error === 'location access denied' ? t('location_denied') : t('location_not_supported')}
          {' '}{t('try_again')}
        </div>
      )}

      <button
        onClick={onRequest}
        disabled={loading}
        className="font-display font-bold text-sm tracking-[0.15em] uppercase px-8 py-4 bg-primary text-bg hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {loading ? t('locating') : t('get_location')}
      </button>

      <div className="font-mono text-xs text-muted mt-4 max-w-xs leading-relaxed">
        {t('privacy')}
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
