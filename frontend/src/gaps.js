const DRY_THRESHOLD = 0.1
const MIN_GAP_SLOTS = 2
const LOOK_AHEAD = 3 * 3600

export function detectGaps(times, precips) {
  const now = Math.floor(Date.now() / 1000)
  const cutoff = now + LOOK_AHEAD

  // Include up to one 15-min slot in the past so we can always identify the
  // "current" slot (the 15-min slot we're currently inside).
  const allSlots = times
    .map((t, i) => ({ t, p: precips[i] ?? 99 }))
    .filter(s => s.t >= now - 15 * 60 && s.t <= cutoff)

  if (!allSlots.length) return { currentPrecip: null, gaps: [] }

  // Slot closest to now = the interval we're actually inside right now
  const nowSlot = allSlots.reduce((best, s) =>
    Math.abs(s.t - now) < Math.abs(best.t - now) ? s : best
  )
  const currentPrecip = nowSlot.p

  // Gap detection only on slots from nowSlot forward
  const slots = allSlots.filter(s => s.t >= nowSlot.t)

  const gaps = []
  let gapStart = null
  let gapCount = 0

  for (const slot of slots) {
    const dry = slot.p < DRY_THRESHOLD
    if (dry && gapStart === null) {
      gapStart = slot
      gapCount = 1
    } else if (dry && gapStart !== null) {
      gapCount++
    } else if (!dry && gapStart !== null) {
      if (gapCount >= MIN_GAP_SLOTS) {
        gaps.push({
          startsAt: gapStart.t,
          startsInMinutes: Math.max(0, Math.round((gapStart.t - now) / 60)),
          durationMinutes: gapCount * 15,
          opensEnded: false,
        })
      }
      gapStart = null
      gapCount = 0
    }
  }

  if (gapStart !== null && gapCount >= MIN_GAP_SLOTS) {
    gaps.push({
      startsAt: gapStart.t,
      startsInMinutes: Math.max(0, Math.round((gapStart.t - now) / 60)),
      durationMinutes: gapCount * 15,
      opensEnded: true,
    })
  }

  // Trend for the narrative: if it's dry right now, when does rain arrive?
  // (Independent of MIN_GAP_SLOTS, so the "rain in X / window closing" countdown
  // works even for short dry spells we wouldn't call a full gap.)
  let nextRainAt = null
  let dryEndsOpen = false
  if (currentPrecip < DRY_THRESHOLD) {
    const firstWet = slots.find(s => s.p >= DRY_THRESHOLD)
    if (firstWet) nextRainAt = firstWet.t
    else dryEndsOpen = true   // dry for the whole 3 h window ahead
  }

  return { currentPrecip, gaps, nextRainAt, dryEndsOpen }
}

function getWeatherNote(weather, t) {
  if (!weather || weather.temp === null || weather.temp === undefined) return null
  const temp = Math.round(weather.temp)
  const wind = Math.round(weather.wind ?? 0)
  const code = weather.code ?? -1

  // Snow (WMO codes 71-77 = snow fall, 85-86 = snow showers)
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return t('weather_snow')
  }
  if (wind > 50) return t('weather_storm', { wind })
  if (temp > 33)  return t('weather_scorching', { temp })
  if (temp > 29)  return t('weather_hot', { temp })
  if (wind > 30)  return t('weather_windy', { wind })
  if (temp < 5)   return t('weather_freezing', { temp })
  if (temp < 12)  return t('weather_cold', { temp })
  if (temp >= 22 && temp <= 29 && wind < 20) return t('weather_perfect')
  return null
}

function precipByCode(code) {
  if (code === null || code === undefined || code < 0) return false
  return (code >= 51 && code <= 67) ||
         (code >= 71 && code <= 77) ||
         (code >= 80 && code <= 99)
}

const URGENT_MIN = 15  // dry now but rain this soon → "window closing, hurry"
const ALMOST_MIN = 10  // raining but clearing this soon → "almost over, get ready"

// nowSec + trend ({ nextRainAt, dryEndsOpen }) let the headline/sub tick down
// live between the 5-min data refreshes. getStatus() wraps this with the
// night-time sleep nudge (below).
export function getStatus(
  currentPrecip, gaps, weather, t = k => k,
  nowSec = Math.floor(Date.now() / 1000), trend = {},
) {
  const weatherNote = getWeatherNote(weather, t)

  if (currentPrecip === null) {
    return { type: 'loading', headline: t('checking'), sub: t('reading_sky'), weather: null }
  }

  // Browser-local clock: 22:00–05:59 → cozy night sub-lines (headline & colour
  // stay normal; nobody's sprinting outside at 3am, so no urgency at night).
  const hour = new Date(nowSec * 1000).getHours()
  const night = hour >= 22 || hour < 6

  const isDry = currentPrecip < DRY_THRESHOLD && !precipByCode(weather?.code)
  const firstGap = gaps[0]
  // A gap that's already started means the forecast says dry now even if a
  // station's RR still lags — trust the model and treat it as "go".
  const gapNow = firstGap && firstGap.startsAt <= nowSec

  // ---- Dry now: narrate the incoming rain ----
  if (isDry || gapNow) {
    let sub
    if (trend.dryEndsOpen) {
      sub = t(night ? 's_night_clear' : 's_clear_hours')
    } else if (trend.nextRainAt) {
      if (night) {
        sub = t('s_night_rain_coming')
      } else {
        const rainInMin = Math.max(0, Math.round((trend.nextRainAt - nowSec) / 60))
        sub = rainInMin <= 0
          ? t('s_rain_any')
          : rainInMin <= URGENT_MIN
            ? t('s_window_closing', { min: rainInMin })
            : t('s_rain_soon', { min: rainInMin })
      }
    } else {
      sub = t(night ? 's_night_dry' : 's_dry_generic')
    }
    return { type: 'go', headline: t('GO_NOW'), sub, weather: weatherNote }
  }

  // ---- Raining now: narrate the break ahead (headline keeps the countdown) ----
  if (firstGap) {
    const clearInMin = Math.max(0, Math.round((firstGap.startsAt - nowSec) / 60))
    const sub = night
      ? t('s_night_raining')
      : clearInMin <= 0
        ? t('s_almost_now')
        : clearInMin <= ALMOST_MIN
          ? t('s_almost_over', { min: clearInMin })
          : t('s_break_opens', { min: clearInMin, dur: firstGap.durationMinutes })
    return { type: 'wait', headline: t('WAIT_MIN', { min: clearInMin }), sub, weather: weatherNote }
  }

  return {
    type: 'stuck',
    headline: t('STUCK'),
    sub: t(night ? 's_night_stuck' : 's_stuck'),
    weather: weatherNote,
  }
}
