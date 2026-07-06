import { useState, useEffect } from 'react'

const SEEN_KEY = 'install_prompt_seen'

// One-time, closable "install as an app" nudge for NEW users. Appears ~2 s after the
// app loads (once), is dismissible, and tailors its guidance to the browser:
//  • Chrome / Edge / Android Chrome (beforeinstallprompt fired) → a real Install button
//  • iOS Safari                                                → Share → Add to Home Screen
//  • iOS other (Chrome/Firefox on iOS can't install)           → open in Safari
//  • Android without the prompt (Samsung/Firefox)              → open in Chrome
// Never shown when already installed (standalone) or once dismissed/installed.
export default function InstallPrompt({
  t, installable, onInstall, isStandalone, isIOSSafari, isIOSOther, isAndroid,
}) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (isStandalone) return
    let seen = false
    try { seen = localStorage.getItem(SEEN_KEY) === '1' } catch {}
    if (seen) return
    const id = setTimeout(() => setShow(true), 2000)   // ~2 s after entering
    return () => clearTimeout(id)
  }, [isStandalone])

  const dismiss = () => {
    setShow(false)
    try { localStorage.setItem(SEEN_KEY, '1') } catch {}
  }

  if (!show || isStandalone) return null

  // Pick the guidance for this browser. `installable` (a captured beforeinstallprompt)
  // means we can trigger the native installer directly.
  let body, action = null
  if (installable) {
    body = t('ip_body')
    action = (
      <button
        onClick={async () => { try { await onInstall?.() } finally { dismiss() } }}
        className="mt-2 px-4 py-1.5 rounded-lg bg-primary text-bg font-display font-bold text-sm active:scale-95 transition"
      >
        {t('ip_btn')}
      </button>
    )
  } else if (isIOSSafari) {
    body = t('ip_ios_safari')
  } else if (isIOSOther) {
    body = t('ip_ios_other')
  } else if (isAndroid) {
    body = t('ip_android')
  } else {
    body = t('ip_generic')
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[1000] px-3 pb-3 pointer-events-none">
      <div className="mx-auto max-w-md rounded-xl bg-surface border border-border shadow-xl p-3.5 pointer-events-auto">
        <div className="flex items-start gap-3">
          <img src="/android-chrome-192x192.png" alt="" width="40" height="40" className="rounded-lg shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-display font-bold text-primary">{t('ip_title')}</div>
            <div className="text-sm text-muted mt-0.5 leading-snug">{body}</div>
            {action}
          </div>
          <button
            onClick={dismiss}
            aria-label={t('close') || 'Close'}
            className="shrink-0 -mt-1 -mr-1 w-8 h-8 flex items-center justify-center text-muted hover:text-primary text-xl leading-none"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  )
}
