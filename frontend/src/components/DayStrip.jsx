import WeatherGlyph from './WeatherGlyph'
import { precipToColor, palOf } from './RainRibbon'
import { dayBuckets, weatherGroup, DRY_THRESHOLD } from '../gaps'

// The five-day strip (v2.30; the "best window" headline removed in v2.39.4 —
// maintainer call, "that's not necessary". `gaps.js`'s own `bestWindow`/
// `preferWindow` are untouched and still fully tested — this only stops
// DayStrip from calling and displaying them).
//
// Gemma Raus answers "when can I go outside" for three hours. The same question
// about the weekend is the one thing a rain app gets asked that this one could not
// answer at all — so people left it to check something else, and that something
// else is what they then trusted for the next three hours too.
//
// One rule keeps the block from undermining the verdict it sits under: it never
// speaks about the next three hours. Those are radar's, and the headline above
// already owns them. Today's row is drawn for completeness and is the one row
// that can disagree with the ribbon in its first hours — which is why it carries
// no claim, only shape.
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

// Hour-only, for the axis strip above the rows — an orientation tick, not a
// reading, so minutes would just be noise. Reads the `hour` part out of
// `formatToParts` rather than using the formatted string directly: German
// appends a literal " Uhr" to an hour-only format ("16 Uhr") that English
// doesn't ("16"), and this axis positions its ticks at tight, fixed percentage
// offsets sized for a bare 2-digit number — the extra word overflowed into
// the next tick and rendered as overlapping text in German only (live
// report). Dropping the locale's own suffix keeps both languages the same
// short width, rather than special-casing German's wording.
function fmtHourOnly(ts, lang) {
  const parts = new Intl.DateTimeFormat(lang === 'de' ? 'de-AT' : 'en-GB', {
    hour: '2-digit', timeZone: TZ, hourCycle: 'h23',
  }).formatToParts(new Date(ts * 1000))
  return parts.find(p => p.type === 'hour')?.value ?? ''
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
      group: weatherGroup(daily.code?.[i] ?? null),
      isToday: i === 0,
      shape: dayBuckets(hT, hP, start, end),
    }
  })

  // v2.36 — a shared hour axis above the rows: every day's shape is the same 12
  // buckets, so one scale is enough, and the reader can finally tell WHEN in the
  // row a wet bucket falls. Ticks come from the first VISIBLE day's own start/end,
  // not from hardcoded clock times — dayBuckets divides the real span into 12
  // equal parts, and on the two DST days a year that span is ~1h55 or ~2h05, not
  // exactly 2h. Reading the tick off the same math keeps the axis honest instead
  // of just looking round.
  const axisDay = days.find((_, i) => !(skipToday && i === 0))
  const axisTicks = axisDay
    ? [0, 0.25, 0.5, 0.75].map(f => fmtHourOnly(axisDay.start + f * (axisDay.end - axisDay.start), lang))
    : null

  return (
    // v2.36.3 — this panel is the ONLY thing under the "Coming days" tab (App.jsx
    // has no sibling to give the leftover space to, unlike "Today" where RadarMap's
    // own flex-1 does this job). Without growing, five thin rows sat pinned to the
    // top of a fixed-height column with the rest of the screen empty — worse on a
    // tall phone than on desktop. flex-1 lets it claim that space; the row list
    // below distributes it, the header/axis above stay their natural size.
    // min-h floor mirrors RadarMap's own (v2.36.1): on a day with several banners
    // stacked above, this panel should shrink before rows overlap, but never past
    // the point of being unreadable.
    <div className="border-b border-border shrink-0 px-4 py-2.5 flex-1 min-h-[200px] flex flex-col">
      {/* v2.39.4 — the "best window" text (right side of this row, v2.35) is
          gone: maintainer call, not necessary. The title alone doesn't need
          the shrink-0/truncate pairing that line required — it's short and
          fixed, never at risk of wrapping on its own. */}
      <div className="flex items-baseline gap-3 mb-1.5 shrink-0">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted whitespace-nowrap">
          {t(skipToday ? 'days_title_forecast' : 'days_title')}
        </span>
      </div>

      {/* v2.36 — the shared hour axis, aligned to the exact same widths/gap as a
          day row below so its ticks land over the day-shape column, not beside
          it. Purely orientation, so it's aria-hidden — the times it names aren't
          read out anywhere else, the shape below it is. */}
      {axisTicks && (
        <div className="flex items-center gap-3 pb-1 shrink-0" aria-hidden="true">
          <span className="w-14 shrink-0" />
          <span className="w-7 shrink-0" />
          <span className="flex-1 min-w-0 max-w-[460px] relative h-3">
            {axisTicks.map((lbl, i) => (
              <span
                key={i}
                className="absolute top-0 font-mono text-[9px] text-muted tabular-nums"
                style={{ left: `${i * 25}%`, transform: i === 0 ? undefined : 'translateX(-50%)' }}
              >
                {lbl}
              </span>
            ))}
            <span className="absolute top-0 right-0 font-mono text-[9px] text-muted tabular-nums">24</span>
          </span>
          <span className="w-10 shrink-0" />
          <span className="w-16 shrink-0" />
        </div>
      )}

      {/* v2.36.3 — bigger glyph/text/bar sizes throughout so the reclaimed height
          reads as "easier to read at a glance on a phone".
          v2.36.6 — `justify-around` (dropped here) did technically fill the
          panel, but by manufacturing large, irregular gaps BETWEEN rows rather
          than by growing the rows themselves — reported live as "lots of lost
          gaps", and the stretched row height also made the small icon/bar
          column gutters read as tall empty vertical bands. Rows now just stack
          at their natural (generously padded) height; any leftover space
          collects as ONE gap below the last row instead of several confusing
          ones threaded through the list. */}
      <div className="flex-1 min-h-0 flex flex-col">
        {days.filter((_, i) => !(skipToday && i === 0)).map((d, i0) => (
          <div
            key={d.start}
            className={'flex items-center gap-3 py-3 shrink-0' + (i0 === 0 ? '' : ' border-t border-border')}
          >
            <span
              className={'font-mono text-sm w-14 shrink-0 tracking-wide' + (d.isToday ? ' font-bold' : '')}
              style={d.isToday ? { color: 'var(--c-go)' } : undefined}
            >
              {d.isToday ? t('today_short') : fmtDay(d.start, lang)}
            </span>

            <span className="w-7 shrink-0 flex justify-center">
              <WeatherGlyph code={d.code} size={28} label={d.group ? t('wx_' + d.group) : null} />
            </span>

            {/* The day shape: 12 × 2 h, drawn on the SAME ramp as the rain ribbon, so
                a wet afternoon is the same colour in both places. Capped in width —
                on a desktop window a full-bleed strip stretches 12 buckets into a
                meaningless smear and pulls the numbers away from the day they belong
                to. A day with no hourly data draws nothing rather than a flat dry
                strip that would read as a promise. */}
            <span className="flex-1 min-w-0 max-w-[460px] flex items-end gap-px h-7">
              {(d.shape || []).map((v, b) => (
                <i
                  key={b}
                  className="flex-1 block rounded-[1px]"
                  style={{
                    height: v < DRY_THRESHOLD ? '3px' : `${Math.max(7, Math.round(Math.sqrt(v / 2.5) * 28))}px`,
                    background: precipToColor(v, pal),
                    opacity: v < DRY_THRESHOLD ? 0.45 : 1,
                  }}
                />
              ))}
            </span>

            <span className="font-mono text-xs text-muted w-10 text-right shrink-0 tabular-nums ml-auto">
              {d.prob !== null ? `${d.prob}%` : '—'}
            </span>
            <span className="font-mono text-sm w-16 text-right shrink-0 tabular-nums">
              {d.hi !== null && <b className="font-bold">{d.hi}°</b>}
              {d.lo !== null && <span className="text-muted"> {d.lo}°</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
