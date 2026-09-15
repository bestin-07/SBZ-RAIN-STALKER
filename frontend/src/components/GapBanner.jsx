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

// The source line (v2.30). Three facts, no opinion: what the ground gauge reads,
// what the radar reads over your head, and when that was. `held` names the v2.22
// BLEIB DRIN hold, the one state where the verdict deliberately outlives the
// reading and therefore looks broken without a word of explanation.
//
// This is the cheapest trust the app can buy. Every hyper-local complaint in the
// logic log — "it is raining like hell and we say passt schon", "a sudden
// unreliable jump" — is a moment where the user could not see WHICH instrument was
// talking. A dry gauge printed next to a wet radar explains a GO ANYWAY in one
// glance; it does not change a single verdict.
//
// It reports only what was actually read: a lane with no reading says so (`—`)
// rather than borrowing the other lane's number.
function SourceLine({ signals, t }) {
  if (!signals) return null
  const { ground, radar, held, updated } = signals
  const wet = v => typeof v === 'number' && v >= 0.1
  const dot = v => (v === null || v === undefined ? 'var(--c-muted)' : wet(v) ? 'var(--c-wait)' : 'var(--c-go)')
  const mm = v => v.toFixed(1)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 pt-2.5 border-t border-border">
      <span className="font-mono text-[10px] text-muted flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot(ground) }} />
        {typeof ground === 'number' ? t('src_ground', { mm: mm(ground) }) : t('src_ground_none')}
      </span>
      <span className="font-mono text-[10px] text-muted flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot(radar) }} />
        {typeof radar !== 'number' ? t('src_radar_none')
          : wet(radar) ? t('src_radar', { mm: mm(radar) }) : t('src_radar_clear')}
      </span>
      {held && <span className="font-mono text-[10px] text-muted">{t('src_held')}</span>}
      {updated && (
        <span className="font-mono text-[10px] text-muted ml-auto">
          {new Date(updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  )
}

export default function GapBanner({ status, blocked = [], signals = null, t }) {
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
      <SourceLine signals={signals} t={t} />
    </div>
  )
}
