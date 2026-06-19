export default function PrivacyPanel({ open, onClose, t }) {
  if (!open) return null

  const sections = [
    ['privacy_page_what',    'privacy_page_what_body'],
    ['privacy_page_notrack', 'privacy_page_notrack_body'],
    ['privacy_page_browser', 'privacy_page_browser_body'],
    ['privacy_page_push',    'privacy_page_push_body'],
    ['privacy_page_basis',   'privacy_page_basis_body'],
    ['privacy_page_rights',  'privacy_page_rights_body'],
    ['privacy_page_who',     'privacy_page_who_body'],
  ]

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ background: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      />
      <div
        className="fixed bottom-0 left-0 right-0 z-50 bg-surface border-t border-border overflow-y-auto"
        style={{ maxHeight: '92vh', paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
      >
        <div className="px-6 pt-6 pb-2">

          {/* header row */}
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

          {/* summary blurb */}
          <p className="font-mono text-sm text-muted leading-relaxed mb-6">
            {t('privacy_1')}
          </p>
          <p className="font-mono text-sm text-muted leading-relaxed mb-8">
            {t('privacy_2')}
          </p>

          <div className="w-full h-px bg-border mb-8" />

          {/* detailed sections */}
          {sections.map(([titleKey, bodyKey]) => (
            <div key={titleKey} className="mb-6">
              <div className="font-mono text-xs tracking-[0.12em] uppercase text-muted mb-2">
                {t(titleKey)}
              </div>
              <p className="font-mono text-sm text-muted leading-relaxed border-l-2 border-border pl-4">
                {t(bodyKey)}
              </p>
            </div>
          ))}

          <div className="w-full h-px bg-border mb-6" />

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
