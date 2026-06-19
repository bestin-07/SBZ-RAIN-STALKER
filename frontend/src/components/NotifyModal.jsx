export default function NotifyModal({ onConfirm, onDismiss, onPrivacy, t }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onDismiss} />
      <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 bg-surface border border-border rounded-xl p-6 max-w-sm mx-auto shadow-xl">

        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl leading-none">🔔</span>
          <span className="font-display font-bold text-base tracking-wide text-primary">
            {t('notify_modal_title')}
          </span>
        </div>

        <p className="font-mono text-sm text-muted leading-relaxed mb-6">
          {t('notify_modal_body')}
        </p>

        <button
          onClick={onConfirm}
          className="w-full font-display font-bold text-sm tracking-[0.12em] uppercase px-4 py-3 rounded-lg bg-primary text-bg hover:opacity-85 transition-opacity mb-3"
        >
          {t('notify_modal_on')}
        </button>

        <button
          onClick={onDismiss}
          className="w-full font-mono text-xs text-muted hover:text-primary transition-colors py-1"
        >
          {t('notify_modal_later')}
        </button>

        <div className="mt-4 pt-4 border-t border-border text-center">
          <button
            onClick={onPrivacy}
            className="font-mono text-xs text-muted hover:text-primary transition-colors"
          >
            {t('notify_modal_privacy')}
          </button>
        </div>
      </div>
    </>
  )
}
