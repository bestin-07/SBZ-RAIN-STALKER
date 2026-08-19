const ACTIVITY_EMOJI = {
  swim: '🏊', run: '🏃', bike: '🚴', moto: '🏍️', picnic: '🧺',
}

const COLORS = {
  go:      '#D4A017',
  light:   '#6CD1EB',
  wait:    '#1BAEE2',
  stuck:   '#0077AA',
  danger:  '#EF4444',
  loading: '#6B7280',
}

export default function GapBanner({ status, blocked = [], t }) {
  if (!status) return null

  // Theme-aware colour via CSS var (light mode darkens these for contrast);
  // the hex from COLORS stays as a fallback if the var is ever missing.
  const fallback = COLORS[status.type] ?? COLORS.loading

  return (
    <div className="px-4 py-6 shrink-0">
      <div
        className="font-display font-bold text-5xl leading-none tracking-tight"
        style={{ color: `var(--c-${status.type}, ${fallback})` }}
      >
        {status.headline}
      </div>
      <div className="font-mono text-sm text-muted mt-2 leading-snug">
        {status.sub}
      </div>
      {/* What the weather has taken off the table. An EMPTY row is the good news —
          on a clear day nothing renders here at all. Each icon carries its own
          label, so a screen reader hears "no swimming" rather than a bare emoji.
          (The old row listed what you COULD do, with hardcoded English labels.) */}
      {blocked.length > 0 && (
        <div className="flex items-center gap-2 mt-2 leading-none">
          {blocked.map(a => (
            <span
              key={a}
              className="gr-no"
              role="img"
              title={t ? t('no_' + a) : a}
              aria-label={t ? t('no_' + a) : a}
            >
              <span aria-hidden="true">{ACTIVITY_EMOJI[a]}</span>
            </span>
          ))}
        </div>
      )}
      {status.weather && (
        <div className="font-mono text-xs text-muted mt-1 leading-snug">
          {status.weather}
        </div>
      )}
    </div>
  )
}
