import WeatherGlyph from './WeatherGlyph'
import { weatherGroup } from '../gaps'

// The sky line (v2.30): the weather code, the temperature and the wind, in a fixed
// place, always.
//
// Why it earns the row: all four values were already fetched and already on the
// ambient snapshot, but the only path they had to the screen was getWeatherNote's
// rotating sentence — which `rainInSight` / RAIN_SOON_NOTE deliberately suppress
// whenever rain is in the picture. So on exactly the days people open the app most,
// the app knew the temperature and showed it nowhere.
//
// The split is by JOB, not by source: the note keeps the advice ("grab a jacket",
// "hold onto your hat"), this line carries the facts. Neither repeats the other.
//
// Deliberately NOT here: UV. The app already raises a dedicated UV banner at ≥ 6,
// and a second UV reading two rows above it is the duplicate-message mistake
// v2.18.1 fixed for thunderstorms. One hazard, one voice.
// v2.35 — `compact` renders the same four values INSIDE the verdict block instead
// of as a section of its own. A full bordered row for a glyph, a word, a
// temperature and a wind speed, sitting directly above a block that often says the
// same thing in a sentence ("Cloudy 16° 14 km/h" over "16°C out there, grab a
// jacket"), was a divider and a band of padding spent on chrome. The job split
// above is untouched: the note still carries the advice, this still carries the
// facts, and getWeatherNote's suppression gates are not altered. Only the
// container changed.
export default function SkyLine({ weather, t, compact = false }) {
  if (!weather) return null
  const group = weatherGroup(weather.code)
  const temp = typeof weather.temp === 'number' ? Math.round(weather.temp) : null
  const wind = typeof weather.wind === 'number' ? Math.round(weather.wind) : null
  // Nothing worth a row: no sky, no temperature, no wind.
  if (!group && temp === null && wind === null) return null

  return (
    <div className={compact
      // v2.36 — a rounded chip instead of a bare row, so the sky facts read as
      // one self-contained fact (Apple Weather's "today" capsule) rather than
      // floating loose above the headline they sit next to.
      ? 'flex items-center gap-2 mb-3 bg-surface border border-border rounded-2xl px-3 py-2 shadow-sm'
      : 'px-4 py-2.5 border-b border-border shrink-0 flex items-center gap-2.5'}>
      <WeatherGlyph code={weather.code} size={compact ? 18 : 22} />
      <span className={'font-mono flex-1 min-w-0 truncate '
        + (compact ? 'text-[11px] text-muted' : 'text-xs text-primary')}>
        {group ? t('wx_' + group) : ''}
      </span>
      <span className={'font-mono text-muted flex items-center shrink-0 tabular-nums '
        + (compact ? 'text-[11px] gap-2.5' : 'text-xs gap-3')}>
        {temp !== null && <span className="text-primary font-bold">{temp}°</span>}
        {wind !== null && <span>{wind} km/h</span>}
      </span>
    </div>
  )
}
