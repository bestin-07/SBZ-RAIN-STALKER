const COLORS = {
  go:      '#16A34A',
  wait:    '#CA8A04',
  stuck:   '#DC2626',
  loading: '#6B7280',
}

export default function GapBanner({ status }) {
  if (!status) return null

  const color = COLORS[status.type] ?? COLORS.loading

  return (
    <div className="px-4 py-7 shrink-0">
      <div
        className="font-display font-bold text-5xl leading-none tracking-tight"
        style={{ color }}
      >
        {status.headline}
      </div>
      <div className="font-mono text-sm text-muted mt-2">
        {status.sub}
      </div>
    </div>
  )
}
