export default function InfoPanel({ open, onClose, t }) {
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
          <div className="font-display font-bold text-2xl text-primary mb-5 tracking-tight">
            {t('info_title')}
          </div>

          <div className="space-y-4 mb-8">
            {['info_p1','info_p2','info_p3','info_p4'].map(k => (
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
            <DataRow label={t('src_radar')}    value="DWD / OPERA" />
            <DataRow label={t('src_accuracy')} value={t('fact_03')} />
          </div>

          <div className="font-mono text-xs tracking-[0.12em] uppercase text-muted mb-3 mt-8">
            {t('privacy_title')}
          </div>
          <div className="space-y-2 mb-8 border-l-2 border-border pl-4">
            {['privacy_1','privacy_2','privacy_3','privacy_basis'].map(k => (
              <p key={k} className="font-mono text-xs text-muted leading-relaxed">{t(k)}</p>
            ))}
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

function DataRow({ label, value }) {
  return (
    <div className="flex items-start gap-3">
      <span className="font-mono text-xs text-muted shrink-0 w-20">{label}</span>
      <span className="font-mono text-xs text-primary">{value}</span>
    </div>
  )
}
