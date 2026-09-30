const SUMMARY = [
  'privacy_sum_location', 'privacy_sum_fallback', 'privacy_sum_services',
  'privacy_sum_device', 'privacy_sum_push', 'privacy_sum_rights',
]

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
        className="fixed bottom-0 left-0 right-0 z-[60] bg-surface border-t border-border overflow-y-auto overscroll-contain max-h-sheet"
        style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
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

          {/* The short layer. The full, GDPR-complete policy is the static page at
              /privacy/ (public/privacy/index.html) — linkable, indexable, readable
              without the app. Keep the two consistent. */}
          <p className="font-display font-bold text-lg text-primary leading-snug mb-5">
            {t('privacy_page_lead')}
          </p>
          <ul className="space-y-3 mb-6">
            {SUMMARY.map(k => (
              <li key={k} className="font-mono text-sm text-muted leading-relaxed border-l-2 border-border pl-4">
                {t(k)}
              </li>
            ))}
          </ul>
          <a
            href={t('privacy_full_href')}
            className="inline-block font-mono text-sm text-primary underline underline-offset-4 hover:opacity-70 transition-opacity mb-8"
          >
            {t('privacy_full_link')}
          </a>

          <div className="w-full h-px bg-border mb-6" />

          {/* terms of use */}
          <div className="font-mono text-xs tracking-[0.12em] uppercase text-muted mb-3">
            {t('privacy_terms_title')}
          </div>
          <p className="font-mono text-xs text-muted leading-relaxed border-l-2 border-border pl-4 mb-8">
            {t('privacy_terms_body')}
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
