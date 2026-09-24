import { useState } from 'react'

// One-time, closable "Gemma Raus just got better" release note. Shown once per
// device (localStorage), dismissible, never again after close. Bump the KEY for any
// future announcement (old dismissals stay dismissed).
const KEY = 'update_note_20260717'

export default function UpdateNote({ t }) {
  const [seen, setSeen] = useState(() => {
    try { return localStorage.getItem(KEY) === '1' } catch { return true }
  })
  // v2.48.1 — one line; the paragraph only on "more" (maintainer: "too many writings").
  const [open, setOpen] = useState(false)
  if (seen) return null
  const dismiss = () => {
    setSeen(true)
    try { localStorage.setItem(KEY, '1') } catch {}
  }
  return (
    <div className="px-4 py-2 bg-surface border-b border-border shrink-0 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-display font-bold text-sm text-primary truncate">{t('update_note_title')}</span>
          {!open && (
            <button type="button" onClick={() => setOpen(true)}
                    className="shrink-0 font-mono text-xs text-muted underline underline-offset-2 hover:text-primary">
              {t('more')}
            </button>
          )}
        </div>
        {open && <p className="font-mono text-xs text-muted leading-relaxed mt-1">{t('update_note_body')}</p>}
      </div>
      <button
        onClick={dismiss}
        aria-label={t('close')}
        className="shrink-0 w-8 h-8 -mt-1 -mr-1 flex items-center justify-center text-muted hover:text-primary text-xl leading-none"
      >
        ×
      </button>
    </div>
  )
}
