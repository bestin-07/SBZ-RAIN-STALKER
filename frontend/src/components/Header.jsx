export default function Header({
  accuracy, lastUpdated, onRefresh, loading,
  theme, onThemeToggle,
  lang, onLangToggle,
  onInfo,
  notifyState, onNotifyToggle,
  installable, onInstall,
  t,
}) {
  const acc30 = accuracy?.['30min']?.accuracy

  function formatTime(ts) {
    if (!ts) return null
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <header className="shrink-0 border-b border-border">
      <div className="flex items-center justify-between px-4 pt-safe pb-4">
        <span className="font-display font-bold text-sm tracking-[0.2em] uppercase text-primary">
          GEMMA RAUS
        </span>

        <div className="flex items-center gap-1.5">
          {acc30 !== null && acc30 !== undefined && (
            <span className="font-mono text-xs text-muted mr-1">
              {acc30}{t('pct_accurate')}
            </span>
          )}
          {lastUpdated && (
            <span className="font-mono text-xs text-muted mr-1">
              {formatTime(lastUpdated)}
            </span>
          )}

          <button
            onClick={onRefresh}
            disabled={loading}
            className="font-mono text-xl text-muted hover:text-primary transition-colors disabled:opacity-30 w-10 h-10 flex items-center justify-center leading-none"
            aria-label="refresh"
          >
            {loading ? '·' : '↺'}
          </button>

          <div className="w-px h-5 bg-border mx-0.5" />

          <button
            onClick={onLangToggle}
            className="font-mono text-sm text-muted hover:text-primary transition-colors w-10 h-10 flex items-center justify-center leading-none"
            aria-label="switch language"
          >
            {lang === 'de' ? 'EN' : 'DE'}
          </button>

          <button
            onClick={onThemeToggle}
            className="font-mono text-xl text-muted hover:text-primary transition-colors w-10 h-10 flex items-center justify-center leading-none"
            aria-label="toggle theme"
          >
            {theme === 'dark' ? '☾' : '☀'}
          </button>

          {notifyState !== 'unsupported' && (
            <button
              onClick={onNotifyToggle}
              disabled={notifyState === 'denied'}
              className="font-mono text-xl text-muted hover:text-primary transition-colors disabled:opacity-40 w-10 h-10 flex items-center justify-center leading-none"
              aria-label="toggle notifications"
              title={notifyState === 'denied' ? t('notify_denied') : ''}
            >
              {notifyState === 'subscribed' ? t('notify_on') : t('notify_off')}
            </button>
          )}

          <button
            onClick={onInfo}
            className="font-mono text-sm text-muted hover:text-primary transition-colors w-7 h-7 flex items-center justify-center border border-border rounded-full leading-none"
            aria-label="guide"
          >
            ?
          </button>
        </div>
      </div>

      {/* Install strip — shown when browser supports beforeinstallprompt (Chrome/Edge)
          Brave/Safari users are guided via the info panel instead */}
      {installable && (
        <button
          onClick={onInstall}
          className="w-full flex items-center justify-between px-4 py-2 bg-surface border-t border-border font-mono text-xs text-muted hover:text-primary transition-colors"
        >
          <span>{lang === 'de' ? 'App zum Startbildschirm hinzufügen' : 'Add to home screen'}</span>
          <span className="text-base leading-none">⊕</span>
        </button>
      )}
    </header>
  )
}
