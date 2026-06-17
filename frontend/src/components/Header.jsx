export default function Header({
  accuracy, lastUpdated, onRefresh, loading,
  theme, onThemeToggle,
  lang, onLangToggle,
  onInfo,
  t,
}) {
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

      <div className="flex items-center gap-3">
        {acc30 !== null && acc30 !== undefined && (
          <span className="font-mono text-xs text-muted">
            {acc30}{t('pct_accurate')}
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

        <div className="w-px h-3 bg-border" />

        <button
          onClick={onLangToggle}
          className="font-mono text-xs text-muted hover:text-primary transition-colors leading-none"
          aria-label="switch language"
        >
          {lang === 'de' ? 'EN' : 'DE'}
        </button>

        <button
          onClick={onThemeToggle}
          className="font-mono text-base text-muted hover:text-primary transition-colors leading-none"
          aria-label="toggle theme"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '☾' : '☀'}
        </button>

        <button
          onClick={onInfo}
          className="font-mono text-xs text-muted hover:text-primary transition-colors w-4 h-4 flex items-center justify-center border border-border rounded-full leading-none"
          aria-label="about"
        >
          i
        </button>
      </div>
    </header>
  )
}
