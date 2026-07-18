export default function FarAway({ km, onViewSalzburg, t }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-bg flex flex-col items-start px-6 pb-safe md:items-center">
      <div className="w-full max-w-md my-auto py-10">
        <div className="font-display font-bold text-3xl text-primary tracking-[0.1em] uppercase mb-3">
          {t('far_title')}
        </div>
        <p className="font-mono text-sm text-muted leading-relaxed mb-8">
          {t('far_body', { km })}
        </p>

        <button
          onClick={onViewSalzburg}
          className="font-display font-bold text-sm tracking-[0.15em] uppercase px-8 py-4 bg-primary text-bg hover:opacity-90 transition-opacity"
        >
          {t('far_view')}
        </button>

        <p className="font-mono text-xs text-muted mt-6 max-w-xs leading-relaxed">
          {t('far_note')}
        </p>
      </div>
    </div>
  )
}
