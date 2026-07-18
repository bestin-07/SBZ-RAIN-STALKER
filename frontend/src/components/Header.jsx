export default function Header({
  accuracy, lastUpdated, onRefresh, loading,
  theme, onThemeToggle,
  lang, onLangToggle,
  onInfo, onLogo,
  notifyState, onNotifyToggle,
  installable, onInstall,
  iosHint, onDismissIosHint,
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
        <button
          onClick={onLogo}
          className="font-display font-bold text-sm tracking-[0.2em] uppercase text-primary hover:opacity-70 transition-opacity"
          aria-label="Gemma Raus — start"
        >
          GEMMA RAUS
        </button>

        <div className="flex items-center gap-1.5">
          {acc30 !== null && acc30 !== undefined && (
            <span className="hidden sm:inline font-mono text-xs text-muted mr-1">
              {acc30}{t('pct_accurate')}
            </span>
          )}
          {lastUpdated && (
            <span className="hidden sm:inline font-mono text-xs text-muted mr-1">
              {formatTime(lastUpdated)}
            </span>
          )}

          <button
            onClick={onRefresh}
            disabled={loading}
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-border font-mono text-xl text-muted hover:text-primary hover:border-primary transition-colors disabled:opacity-30 leading-none"
            aria-label="refresh"
          >
            {loading ? '·' : '↺'}
          </button>

          {/* Segmented language toggle: active language highlighted — no guessing
              what a bare "EN"/"DE" means. */}
          <button
            onClick={onLangToggle}
            className="flex items-center h-9 px-1 rounded-lg border border-border font-mono text-xs leading-none"
            aria-label="switch language"
          >
            <span className={`px-1.5 py-1 rounded ${lang === 'de' ? 'bg-primary text-bg' : 'text-muted'}`}>DE</span>
            <span className={`px-1.5 py-1 rounded ${lang === 'en' ? 'bg-primary text-bg' : 'text-muted'}`}>EN</span>
          </button>

          <button
            onClick={onThemeToggle}
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-border font-mono text-xl text-muted hover:text-primary hover:border-primary transition-colors leading-none"
            aria-label="toggle theme"
          >
            {theme === 'dark' ? '☾' : '☀'}
          </button>

          {notifyState !== 'unsupported' && (
            <button
              onClick={onNotifyToggle}
              className={`w-9 h-9 flex items-center justify-center rounded-lg border transition-colors ${
                notifyState === 'subscribed'
                  ? 'text-[#D4A017] border-[#D4A017]'
                  : 'text-muted border-border hover:text-primary hover:border-primary'
              }`}
              aria-label="toggle notifications"
              title={notifyState === 'denied' ? t('notify_denied') : ''}
            >
              <BellIcon state={notifyState} />
            </button>
          )}


          <button
            onClick={onInfo}
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-border font-mono text-sm text-muted hover:text-primary hover:border-primary transition-colors leading-none"
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

      {/* iOS install hint: Safari = manual Share→A2HS; other iOS browsers = open in Safari */}
      {iosHint && (
        <div className="w-full flex items-center justify-between gap-3 px-4 py-2 bg-surface border-t border-border font-mono text-xs text-muted">
          <span className="leading-relaxed">{t(iosHint)}</span>
          <button onClick={onDismissIosHint} aria-label="dismiss" className="shrink-0 text-muted hover:text-primary px-1">✕</button>
        </div>
      )}
    </header>
  )
}

function BellIcon({ state }) {
  const filled = state === 'subscribed'
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'}
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      {state === 'denied' && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  )
}
