import WeatherGlyph from './WeatherGlyph'
import { precipToColor, palOf } from './RainRibbon'
import { dayBuckets, bestWindow, preferWindow, weatherGroup, DRY_THRESHOLD } from '../gaps'

// The five-day strip (v2.30).
//
// Gemma Raus answers "when can I go outside" for three hours. The same question
// about the weekend is the one thing a rain app gets asked that this one could not
// answer at all — so people left it to check something else, and that something
// else is what they then trusted for the next three hours too.
//
// Two rules keep the block from undermining the verdict it sits under:
//   1. It never speaks about the next three hours. Those are radar's, and the
//      headline above already owns them. Today's row is drawn for completeness and
//      is the one row that can disagree with the ribbon in its first hours —
//      which is why it carries no window and no claim, only shape.
//   2. It is a PLAN, never a verdict. "Best window" names a dry stretch to aim at;
//      it is not permission to go out, and the wording (i18n `best_window`) is
//      written so it cannot be read as one.
//
// Day boundaries come from the server as real Europe/Vienna midnights, and every
// label here is formatted in that same zone — so the row labelled WED is exactly
// the hours the server bucketed as Wednesday, whatever timezone the device is in.
const TZ = 'Europe/Vienna'
const MAX_DAYS = 5

function fmtDay(ts, lang) {
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-AT' : 'en-GB', {
    weekday: 'short', timeZone: TZ,
  }).format(new Date(ts * 1000))
}

function fmtHour(ts, lang) {
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-AT' : 'en-GB', {
    // hourCycle, not hour12:false — the latter renders midnight as "24:00" in
    // several locales on both Safari and Chrome.
    hour: '2-digit', minute: '2-digit', timeZone: TZ, hourCycle: 'h23',
  }).format(new Date(ts * 1000))
}

// `skipToday` (v2.32): today is drawn above as the tall tile, from radar + model,
// so repeating it here as a thin row would be the same day claimed twice by two
// different instruments at two different resolutions. The rows below are therefore
// ALL forecast, which is exactly what the section label now says.
export default function DayStrip({ daily, theme, t, lang, skipToday = false }) {
  if (!daily || !Array.isArray(daily.time) || daily.time.length < 2) return null
  const pal = palOf(theme)
  const hT = daily.htime || [], hP = daily.hprecip || []

  const days = daily.time.slice(0, MAX_DAYS).map((start, i) => {
    // Real next-midnight rather than start + 86400, so the two DST days a year
    // bucket their actual 23 or 25 hours instead of losing/duplicating one.
    const end = daily.time[i + 1] ?? (start + 86400)
    return {
      start, end,
      code: daily.code?.[i] ?? null,
      hi:   typeof daily.tmax?.[i] === 'number' ? Math.round(daily.tmax[i]) : null,
      lo:   typeof daily.tmin?.[i] === 'number' ? Math.round(daily.tmin[i]) : null,
      prob: typeof daily.pprob?.[i] === 'number' ? Math.round(daily.pprob[i]) : null,
      rain: typeof daily.psum?.[i] === 'number' ? daily.psum[i] : null,
      group: weatherGroup(daily.code?.[i] ?? null),
      isToday: i === 0,
      shape: dayBuckets(hT, hP, start, end),
      // Sunrise/sunset bound the window search (v2.30.1). Absent on an older
      // snapshot → null → the whole day is considered, as before.
      daylight: typeof daily.sunrise?.[i] === 'number' && typeof daily.sunset?.[i] === 'number'
        ? { from: daily.sunrise[i], to: daily.sunset[i] } : null,
    }
  })

  // The headline window is picked from TOMORROW ONWARDS. Today is already the
  // verdict's subject, and a "best window 14:00–18:00" sitting under a BLEIB DRIN
  // about this very afternoon is the contradiction this app exists not to make.
  let best = null
  for (let i = 1; i < days.length; i++) {
    const w = bestWindow(hT, hP, days[i].start, days[i].end, days[i].daylight)
    // Longer wins; equal length → the drier DAY wins; equal in both → the earlier
    // day keeps the slot. See gaps.preferWindow for why length alone is not enough.
    if (w) best = preferWindow(best, { ...w, day: days[i].start, rain: days[i].rain })
  }

  return (
    <div className="border-b border-border shrink-0 px-4 py-2.5">
      <div className="flex items-baseline gap-3 mb-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          {t(skipToday ? 'days_title_forecast' : 'days_title')}
        </span>
        <span className="font-mono text-[10px] text-muted ml-auto text-right truncate">
          {best
            ? t('best_window', {
                day: fmtDay(best.day, lang),
                from: fmtHour(best.start, lang),
                to: fmtHour(best.end, lang),
              })
            : t('best_window_none')}
        </span>
      </div>

      {days.filter((_, i) => !(skipToday && i === 0)).map((d, i0) => (
        <div
          key={d.start}
          className={'flex items-center gap-2.5 py-1.5' + (i0 === 0 ? '' : ' border-t border-border')}
        >
          <span
            className={'font-mono text-[11px] w-12 shrink-0 tracking-wide' + (d.isToday ? ' font-bold' : '')}
            style={d.isToday ? { color: 'var(--c-go)' } : undefined}
          >
            {d.isToday ? t('today_short') : fmtDay(d.start, lang)}
          </span>

          <span className="w-5 shrink-0 flex justify-center">
            <WeatherGlyph code={d.code} size={19} label={d.group ? t('wx_' + d.group) : null} />
          </span>

          {/* The day shape: 12 × 2 h, drawn on the SAME ramp as the rain ribbon, so
              a wet afternoon is the same colour in both places. Capped in width —
              on a desktop window a full-bleed strip stretches 12 buckets into a
              meaningless smear and pulls the numbers away from the day they belong
              to. A day with no hourly data draws nothing rather than a flat dry
              strip that would read as a promise. */}
          <span className="flex-1 min-w-0 max-w-[460px] flex items-end gap-px h-4">
            {(d.shape || []).map((v, b) => (
              <i
                key={b}
                className="flex-1 block rounded-[1px]"
                style={{
                  height: v < DRY_THRESHOLD ? '2px' : `${Math.max(4, Math.round(Math.sqrt(v / 2.5) * 16))}px`,
                  background: precipToColor(v, pal),
                  opacity: v < DRY_THRESHOLD ? 0.45 : 1,
                }}
              />
            ))}
          </span>

          <span className="font-mono text-[10px] text-muted w-9 text-right shrink-0 tabular-nums ml-auto">
            {d.prob !== null ? `${d.prob}%` : '—'}
          </span>
          <span className="font-mono text-[11px] w-14 text-right shrink-0 tabular-nums">
            {d.hi !== null && <b className="font-bold">{d.hi}°</b>}
            {d.lo !== null && <span className="text-muted"> {d.lo}°</span>}
          </span>
        </div>
      ))}
    </div>
  )
}
