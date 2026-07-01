const COLORS = {
  go:      '#D4A017',
  wait:    '#1BAEE2',
  stuck:   '#0077AA',
  loading: '#6B7280',
}

export default function GapBanner({ status }) {
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
      {status.weather && (
        <div className="font-mono text-xs text-muted mt-1 leading-snug">
          {status.weather}
        </div>
      )}
    </div>
  )
}
