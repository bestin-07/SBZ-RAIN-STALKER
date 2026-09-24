import { useRef } from 'react'
import { useFitText } from '../useFitText'
import { formatClock } from '../time'
import WeatherGlyph from './WeatherGlyph'
import { weatherGroup } from '../gaps'

// v2.48.1 — the sky glance, moved here from its own chip row above the headline (whose
// condition word only repeated the verdict). Rain-family codes draw as plain cloud, as
// the chip did since v2.46.0: whether it's raining on you is the headline's job.
// On a phone the header has no room for it — the extra 50px pushed the guide "?" off
// screen (checked in Chrome at 390px) — so there it sits at the end of the headline row
// (GapBanner), and the header shows it from `sm` up. Same component, two places.
const PRECIP_GROUPS = new Set(['drizzle', 'rain', 'showers'])
export function SkyGlance({ weather, className = '', compact = false }) {
  if (!weather) return null
  const grp = weatherGroup(weather.code)
  const code = PRECIP_GROUPS.has(grp) ? 3 : weather.code
  const temp = typeof weather.temp === 'number' ? Math.round(weather.temp) : null
  const wind = typeof weather.wind === 'number' ? Math.round(weather.wind) : null
  if (grp == null && temp === null) return null
  return (
    <span className={'items-center gap-1 font-mono text-xs text-muted tabular-nums ' + className}>
      {grp != null && <WeatherGlyph code={code} size={16} />}
      {temp !== null && <span className="text-primary font-bold">{temp}°</span>}
      {wind !== null && !compact && <span>· {wind} km/h</span>}
    </span>
  )
}

export default function Header({
  accuracy, lastUpdated, weather = null,
  theme, onThemeToggle,
  lang, onLangToggle,
  onInfo, onLogo,
  notifyState, onNotifyToggle,
  t,
}) {
  const acc30 = accuracy?.['30min']?.accuracy
  // v2.36.7 — the brand title must never wrap (see useFitText.js): it's shrunk
  // to fit whatever the icon row (a variable-width sibling — the notify bell is
  // conditional) actually leaves it, not assumed to always have room.
  const rowRef = useRef(null)
  const titleRef = useRef(null)
  const iconsRef = useRef(null)
  useFitText(titleRef, () => {
    const row = rowRef.current, icons = iconsRef.current
    if (!row || !icons) return 0
    const cs = getComputedStyle(row)
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
    const gap = parseFloat(cs.columnGap || cs.gap) || 0
    return row.clientWidth - pad - icons.offsetWidth - gap
  }, [notifyState, lang])

  function formatTime(ts) {
    if (!ts) return null
    return formatClock(ts)
  }

  return (
    <header className="shrink-0 border-b border-border">
      <div ref={rowRef} className="flex items-center justify-between pl-safe pr-safe pt-safe pb-4 gr-col">
        <button
          onClick={onLogo}
          className="shrink-0 min-w-0 hover:opacity-70 transition-opacity"
          aria-label="Gemma Raus — start"
        >
          <span
            ref={titleRef}
            className="font-display font-bold text-sm tracking-[0.2em] uppercase text-primary"
          >
            GEMMA RAUS
          </span>
        </button>

        <div ref={iconsRef} className="flex items-center gap-1.5">
          {acc30 !== null && acc30 !== undefined && (
            <span className="hidden sm:inline font-mono text-xs text-muted mr-1">
              {acc30}{t('pct_accurate')}
            </span>
          )}
          <SkyGlance weather={weather} className="hidden sm:flex mr-1" />
          {/* The LAST-UPDATED time, not a clock (live read: "I think it's not time
              but last updated") — so it says so with ↻, not a word. */}
          {lastUpdated && (
            <span className="hidden sm:inline font-mono text-xs text-muted mr-1"
                  title={t('updated_at', { time: formatTime(lastUpdated) })}
                  aria-label={t('updated_at', { time: formatTime(lastUpdated) })}>
              ↻ {formatTime(lastUpdated)}
            </span>
          )}

          {/* The manual refresh button is gone — pull-to-refresh (the gesture
              on the scrollable column, App.jsx) already calls the same
              handleRefresh, and a second, redundant trigger was one of five
              44px buttons competing for the same row: on a narrow phone the
              row overflowed and pushed the guide ("?") button off-screen
              entirely. One fewer button fixes both the redundancy and the
              overflow.
              w-11 h-11 (44px) — the minimum touch target size on what
              remains; the glyph inside each button stays its original
              visual size (text-xl/text-sm/19px svg), only the tappable box
              grew, matching the 44px buttons RadarMap already uses for
              relocate/close. */}

          {/* Segmented language toggle: active language highlighted — no guessing
              what a bare "EN"/"DE" means. */}
          <button
            onClick={onLangToggle}
            className="flex items-center h-11 px-1 rounded-lg border border-border font-mono text-xs leading-none"
            aria-label="switch language"
          >
            <span className={`px-1.5 py-1 rounded ${lang === 'de' ? 'bg-primary text-bg' : 'text-muted'}`}>DE</span>
            <span className={`px-1.5 py-1 rounded ${lang === 'en' ? 'bg-primary text-bg' : 'text-muted'}`}>EN</span>
          </button>

          <button
            onClick={onThemeToggle}
            className="w-11 h-11 flex items-center justify-center rounded-lg border border-border font-mono text-xl text-muted hover:text-primary hover:border-primary transition-colors leading-none"
            aria-label="toggle theme"
          >
            {theme === 'dark' ? '☾' : '☀'}
          </button>

          {notifyState !== 'unsupported' && (
            <button
              onClick={onNotifyToggle}
              className={`w-11 h-11 flex items-center justify-center rounded-lg border transition-colors ${
                notifyState === 'subscribed'
                  ? 'text-go border-go'
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
            className="w-11 h-11 flex items-center justify-center rounded-lg border border-border font-mono text-sm text-muted hover:text-primary hover:border-primary transition-colors leading-none"
            aria-label="guide"
          >
            ?
          </button>
        </div>
      </div>

      {/* The persistent "Add to home screen" strip and the iOS install hint
          used to live here — one with no dismiss at all, the other only
          dismissible via its own separate flag. Both nagged on every visit.
          Install guidance now lives in exactly one place: InstallPrompt.jsx,
          a one-time popup (closable, remembered in localStorage like the
          app's other one-off notices) that covers every browser/device case,
          plus a standing "Install app" row in the info panel for anyone who
          dismissed it and wants it again later. */}
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
