export default function Header({ accuracy, lastUpdated, onRefresh, loading }) {
  const acc30 = accuracy?.['30min']?.accuracy

  function formatTime(ts) {
    if (!ts) return null
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <header className="flex items-center justify-between px-4 pt-safe pb-3 border-b border-border shrink-0">
      <span className="font-display font-bold text-xs tracking-[0.2em] uppercase text-primary">
        SBZ RAIN STALKER
      </span>

      <div className="flex items-center gap-4">
        {acc30 !== null && acc30 !== undefined && (
          <span className="font-mono text-xs text-muted">
            {acc30}% accurate
          </span>
        )}
        {lastUpdated && (
          <span className="font-mono text-xs text-muted">
            {formatTime(lastUpdated)}
          </span>
        )}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="font-mono text-sm text-muted hover:text-primary transition-colors disabled:opacity-30"
          aria-label="refresh"
        >
          {loading ? '·' : '↺'}
        </button>
      </div>
    </header>
  )
}
