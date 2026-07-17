import { useState } from 'react'

// One-time, closable "Gemma Raus just got better" release note. Shown once per
// device (localStorage), dismissible, never again after close. Bump the KEY for any
// future announcement (old dismissals stay dismissed).
const KEY = 'update_note_20260717'

export default function UpdateNote({ t }) {
  const [seen, setSeen] = useState(() => {
    try { return localStorage.getItem(KEY) === '1' } catch { return true }
  })
  if (seen) return null
  const dismiss = () => {
    setSeen(true)
    try { localStorage.setItem(KEY, '1') } catch {}
  }
  return (
    <div className="px-4 py-3 bg-surface border-b border-border shrink-0 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="font-display font-bold text-sm text-primary">{t('update_note_title')}</div>
        <p className="font-mono text-xs text-muted leading-relaxed mt-1">{t('update_note_body')}</p>
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
