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
export default function SkyLine({ weather, t }) {
  if (!weather) return null
  const group = weatherGroup(weather.code)
  const temp = typeof weather.temp === 'number' ? Math.round(weather.temp) : null
  const wind = typeof weather.wind === 'number' ? Math.round(weather.wind) : null
  // Nothing worth a row: no sky, no temperature, no wind.
  if (!group && temp === null && wind === null) return null

  return (
    <div className="px-4 py-2.5 border-b border-border shrink-0 flex items-center gap-2.5">
      <WeatherGlyph code={weather.code} size={22} />
      <span className="font-mono text-xs text-primary flex-1 min-w-0 truncate">
        {group ? t('wx_' + group) : ''}
      </span>
      <span className="font-mono text-xs text-muted flex items-center gap-3 shrink-0 tabular-nums">
        {temp !== null && <span className="text-primary font-bold">{temp}°</span>}
        {wind !== null && <span>{wind} km/h</span>}
      </span>
    </div>
  )
}
