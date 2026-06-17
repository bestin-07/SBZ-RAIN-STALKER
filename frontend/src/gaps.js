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

  return { currentPrecip, gaps }
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

export function getStatus(currentPrecip, gaps, weather, t = k => k) {
  const weatherNote = getWeatherNote(weather, t)

  if (currentPrecip === null) {
    return { type: 'loading', headline: t('checking'), sub: t('reading_sky'), weather: null }
  }

  const isDry = currentPrecip < DRY_THRESHOLD && !precipByCode(weather?.code)
  const nextGap = gaps[0]

  if (isDry) {
    if (nextGap && nextGap.startsInMinutes === 0) {
      return {
        type: 'go',
        headline: t('GO_NOW'),
        sub: nextGap.opensEnded
          ? t('dry_for_over', { min: nextGap.durationMinutes })
          : t('dry_for', { min: nextGap.durationMinutes }),
        weather: weatherNote,
      }
    }
    return {
      type: 'go',
      headline: t('GO_NOW'),
      sub: t('no_rain'),
      weather: weatherNote,
    }
  }

  if (nextGap) {
    return {
      type: 'wait',
      headline: t('WAIT_MIN', { min: nextGap.startsInMinutes }),
      sub: t('then_clear', { min: nextGap.durationMinutes }),
      weather: weatherNote,
    }
  }

  return {
    type: 'stuck',
    headline: t('STUCK'),
    sub: t('no_gap'),
    weather: weatherNote,
  }
}
