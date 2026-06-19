export default function PrivacyPanel({ open, onClose, t }) {
  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-[60]"
        style={{ background: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      />
      <div
        className="fixed bottom-0 left-0 right-0 z-[60] bg-surface border-t border-border overflow-y-auto"
        style={{ maxHeight: '92vh', paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
      >
        <div className="px-6 pt-6 pb-2">

          <div className="flex items-center justify-between mb-6">
            <span className="font-mono text-xs tracking-[0.14em] uppercase text-muted">
              {t('privacy_title')}
            </span>
            <button
              onClick={onClose}
              className="font-mono text-lg text-muted hover:text-primary transition-colors leading-none"
              aria-label="close"
            >
              ✕
            </button>
          </div>

          {/* plain-language lead */}
          <p className="font-display font-bold text-lg text-primary leading-snug mb-4">
            {t('privacy_page_lead')}
          </p>
          <p className="font-mono text-sm text-muted leading-relaxed mb-4">
            {t('privacy_page_honest')}
          </p>
          <p className="font-mono text-sm text-muted leading-relaxed mb-8">
            {t('privacy_page_auto')}
          </p>

          <div className="w-full h-px bg-border mb-6" />

          {/* technical fine print */}
          <div className="font-mono text-xs tracking-[0.12em] uppercase text-muted mb-3">
            {t('privacy_page_tech')}
          </div>
          <p className="font-mono text-xs text-muted leading-relaxed border-l-2 border-border pl-4 mb-8">
            {t('privacy_page_tech_body')}
          </p>

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
