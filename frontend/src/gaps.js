export const DRY_THRESHOLD = 0.1
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

function getWeatherNote(weather, t, { night = false, evening = false, raining = false, rainSoon = false } = {}) {
  if (!weather || weather.temp === null || weather.temp === undefined) return null
  const temp = Math.round(weather.temp)
  const wind = Math.round(weather.wind ?? 0)
  const code = weather.code ?? -1
  const v = { temp, wind }

  // Safety/hazard notes are always shown regardless of time
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    // Snow at night: suppress the "go anyway" encouragement — just skip
    if (night) return null
    return t('weather_snow', v)
  }
  if (code >= 95 && code <= 99) return t('weather_thunder', v)
  // "storm — stay inside" only when we're not saying GO. On a dry, windy day the
  // wind banner already warns; the note falls through to the playful "hold your
  // hat" (weather_windy) so it doesn't contradict the GO headline.
  if (wind > 50 && raining)     return t('weather_storm', v)
  if (code === 45 || code === 48) return t('weather_fog', v)

  // Comfort / "go outside" notes make no sense while it's actively raining — they
  // contradicted the status (e.g. "perfect, no excuse to stay in" showing under a
  // STUCK "wet all the way"). Hazard notes above still surface during rain.
  if (raining) return null

  // Sunny "go out & enjoy" notes contradict an incoming-rain countdown, so skip
  // them when rain is on the way soon. Prep notes (jacket / wind) still apply —
  // useful whether or not rain is coming.
  if (!rainSoon && temp > 33) {
    if (night) return null  // scorching at midnight needs no action
    return t('weather_scorching', v)
  }
  if (!rainSoon && temp > 29) {
    if (night) return null  // hot night, no "go!" advice
    return t('weather_hot', v)
  }
  if (wind > 30) return t('weather_windy', v)
  if (temp < 5)  return t('weather_freezing', v)
  if (temp < 12) return t('weather_cold', v)
  // "Perfect weather" is an invitation to go out — only when it's genuinely clear
  // (not overcast, code<=2) AND no rain is imminent, otherwise it contradicts the
  // countdown ("made for going out" while "rain in 10 min") or the cloudy banner.
  if (!rainSoon && !night && !evening && temp >= 22 && temp <= 29 && wind < 20 && code <= 2) {
    return t('weather_perfect', v)
  }
  return null
}

function precipByCode(code) {
  if (code === null || code === undefined || code < 0) return false
  return (code >= 51 && code <= 67) ||
         (code >= 71 && code <= 77) ||
         (code >= 80 && code <= 99)
}

const RAIN_SHOW_MIN = 10  // below this, say "shortly/any minute" — a numeric ETA is false precision
const ALMOST_MIN = 10  // raining but clearing this soon → "almost over, get ready"
const SOON_MIN = 5     // clears in <5 min → too close to be precise; drop the number, go soft
export const LIGHT_MIN = 0.2  // below this = go (dry-enough) — a 0.1mm tip must not flip GO↔GO-ANYWAY
export const LIGHT_MAX = 0.5  // raining but below this = light/drizzle → "you could still go out"
const RAIN_PROB_MIN = 50  // model rain probability below this → soften the radar countdown
const RAIN_SOON_NOTE = 90 // rain within this many min → drop the "go out & enjoy" weather notes

// Shared "what's ahead" sub-line for a dry window / gap opening — reused by both
// the WAIT state and the light-rain ("go anyway") state so they carry the same
// forward context (clearing vs a fixed break) without inventing new strings.
function breakSub(firstGap, nowSec, t) {
  const clearInMin = Math.max(0, Math.round((firstGap.startsAt - nowSec) / 60))
  if (clearInMin < SOON_MIN)    return t('s_almost_now')
  if (firstGap.opensEnded)      return t('s_clearing',    { min: clearInMin })
  if (clearInMin <= ALMOST_MIN) return t('s_almost_over', { min: clearInMin, dur: firstGap.durationMinutes })
  return t('s_break_opens', { min: clearInMin, dur: firstGap.durationMinutes })
}

// Passive, third-person "notice" wording for the MAP POPUPS — a neutral status card
// for a place ("Dry — rain arriving soon"), distinct from the app's first-person brand
// voice (GEMMA RAUS / "bed is better"), which stays on the big headline + the user's own
// banner. Same underlying facts, calmer register. Attached to every status as `notice`
// so the popup renderer can pick it while the banner keeps headline/sub.
function noticeFor(type, currentPrecip, firstGap, trend, nowSec, t) {
  const head = type === 'go' ? t('n_dry') : type === 'light' ? t('n_light') : t('n_raining')
  let sub
  if ((type === 'go' || type === 'light') && trend.downpourSoonMin != null) {
    sub = t('n_downpour_soon', { min: trend.downpourSoonMin })
  } else if (type === 'go') {
    if (trend.dryEndsOpen) {
      sub = t('n_clear_hours')
    } else if (trend.nextRainAt) {
      const min = Math.max(0, Math.round((trend.nextRainAt - nowSec) / 60))
      const lowConf = trend.rainProb != null && trend.rainProb < RAIN_PROB_MIN
      sub = lowConf ? t('n_rain_maybe')
          : min < RAIN_SHOW_MIN ? t('n_rain_soon')
          : t('n_rain_in', { min: Math.round(min / 5) * 5 })
    } else {
      sub = t('n_dry_now')
    }
  } else if (type === 'light') {
    if (firstGap) {
      const min = Math.max(0, Math.round((firstGap.startsAt - nowSec) / 60))
      sub = min < RAIN_SHOW_MIN ? t('n_break_soon') : t('n_clearing', { min: Math.round(min / 5) * 5 })
    } else {
      sub = t('n_light_here')
    }
  } else if (type === 'wait') {
    const min = firstGap ? Math.max(0, Math.round((firstGap.startsAt - nowSec) / 60)) : 0
    sub = min < SOON_MIN ? t('n_break_soon') : t('n_break_in', { min })
  } else {
    sub = t('n_no_break')
  }
  return { head, sub }
}

// nowSec + trend ({ nextRainAt, dryEndsOpen }) let the headline/sub tick down
// live between the 5-min data refreshes. getStatus() wraps this with the
// night-time sleep nudge (below).
export function getStatus(
  currentPrecip, gaps, weather, t = k => k,
  nowSec = Math.floor(Date.now() / 1000), trend = {},
) {
  if (currentPrecip === null) {
    return { type: 'loading', headline: t('checking'), sub: t('reading_sky'), weather: null }
  }

  // Browser-local clock: 00:00–04:59 (12am–5am) → cozy night sub-lines (headline
  // & colour stay normal; nobody's sprinting outside at 3am, so no urgency).
  const hour    = new Date(nowSec * 1000).getHours()
  const night   = hour < 5
  const evening = hour >= 18   // 18:00–23:59 — wind-down tone, no "go sprint outside"

  // Trust currentPrecip (max of TAWES sensors + nowcast + Open-Meteo precipitation).
  // weather_code is NOT used here — it lags significantly after rain stops (code=61
  // persists long after sensors read 0mm) and would block GO even when every source
  // agrees it's dry. precipByCode() remains available for other callers.
  const isDry = currentPrecip < DRY_THRESHOLD
  const firstGap = gaps[0]
  // A gap that's already started means the forecast says dry now even if a
  // station's RR still lags — trust the model and treat it as "go".
  // Exception: if RainViewer radar directly observes active rain at the user's
  // pixel, the nowcast is blind to this cell; suppress the override so we
  // don't flash GO while radar confirms rain overhead.
  const gapNow = firstGap && firstGap.startsAt <= nowSec && !trend?.rvRainActive

  // Weather note needs to know if we're heading out (dry/go) or stuck in the rain,
  // so the "go outside" comfort lines don't contradict a WAIT/STUCK headline; and
  // whether rain is imminent, so "made for going out" doesn't run under a countdown.
  const rainSoon = trend.nextRainAt != null && (trend.nextRainAt - nowSec) <= RAIN_SOON_NOTE * 60
  const weatherNote = getWeatherNote(weather, t, { night, evening, raining: !(isDry || gapNow), rainSoon })

  // ---- Dry now: narrate the incoming rain ----
  if (isDry || gapNow) {
    let sub
    if (trend.downpourSoonMin != null) {
      // Radar shows a real downpour imminent — warn even though it's dry NOW, so
      // "go" doesn't walk you into a soaking. Top priority over the calm dry subs.
      sub = t('s_downpour_soon', { min: trend.downpourSoonMin })
    } else if (trend.dryEndsOpen) {
      sub = t(night ? 's_night_clear' : evening ? 's_evening_clear' : 's_clear_hours')
    } else if (trend.nextRainAt) {
      if (night) {
        sub = t('s_night_rain_coming')
      } else {
        // Radar onset timing jitters between refreshes, so an exact minute (or a
        // wide ±10 range like "1–18 min") reads as random/false-precise. Under
        // 10 min say "shortly / any minute"; at/above 10 min round to the nearest
        // 5 and say "about X min". recentRain frames it as the same event resuming
        // ("short break — rain back …") instead of a fresh alarm.
        const rainInMin = Math.max(0, Math.round((trend.nextRainAt - nowSec) / 60))
        const about = Math.round(rainInMin / 5) * 5
        const lowConf = trend.rainProb != null && trend.rainProb < RAIN_PROB_MIN
        if (lowConf) {
          sub = t('s_rain_maybe')
        } else if (rainInMin < RAIN_SHOW_MIN) {
          sub = t(trend.recentRain ? 's_rain_back_soon' : 's_rain_any')
        } else {
          sub = t(trend.recentRain ? 's_rain_back' : 's_rain_soon', { min: about })
        }
      }
    } else {
      sub = (trend.recentRain && !night && !evening)
        ? t('s_rain_eased')
        : t(night ? 's_night_dry' : evening ? 's_evening_dry' : 's_dry_generic')
    }
    return { type: 'go', headline: t('GO_NOW'), sub, weather: weatherNote, notice: noticeFor('go', currentPrecip, firstGap, trend, nowSec, t) }
  }

  // Trace drizzle (< 0.2 mm) → still GO. A 0.1 mm tip must not flip GEMMA RAUS ↔
  // GO ANYWAY; only a genuine ≥0.2 mm drizzle earns the light state.
  if (currentPrecip < LIGHT_MIN) {
    const sub = t(night ? 's_night_dry' : evening ? 's_evening_dry' : 's_dry_generic')
    return { type: 'go', headline: t('GO_NOW'), sub, weather: weatherNote, notice: noticeFor('go', currentPrecip, firstGap, trend, nowSec, t) }
  }

  // ---- Light drizzle (0.2–0.5 mm): "you could still go" ----
  // Driven by the GROUND reading, so a stale/over-reading nowcast can't force STUCK
  // while you're in a drizzle. At NIGHT it stays a calm drizzle (cozy sub) instead of
  // falling through to a WAIT countdown; daytime keeps the forward easing/clearing text.
  if (currentPrecip < LIGHT_MAX) {
    let sub
    if (trend.downpourSoonMin != null) {
      // Drizzling now, but a real downpour is minutes away — warn instead of the
      // casual "go anyway" that soaked the user in Nonntal.
      sub = t('s_downpour_soon', { min: trend.downpourSoonMin })
    } else if (night) {
      sub = t('s_night_drizzle')   // drizzle wording — never "raining" under GO ANYWAY
    } else if (firstGap) {
      const easeMin = Math.max(0, Math.round((firstGap.startsAt - nowSec) / 60))
      sub = easeMin < RAIN_SHOW_MIN
        ? t('s_light_soon')
        : t('s_light_clearing', { min: Math.round(easeMin / 5) * 5 })
    } else {
      sub = t('s_light')
    }
    return { type: 'light', headline: t('LIGHT_RAIN'), sub, weather: weatherNote, notice: noticeFor('light', currentPrecip, firstGap, trend, nowSec, t) }
  }

  // ---- Raining now: narrate the break ahead ----
  if (firstGap) {
    const clearInMin = Math.max(0, Math.round((firstGap.startsAt - nowSec) / 60))
    // Under 5 min the exact minute is noise — drop the number and go soft.
    const soon = clearInMin < SOON_MIN
    const headline = soon ? t('WAIT_SOON') : t('WAIT_MIN', { min: clearInMin })
    const sub = night ? t('s_night_raining') : breakSub(firstGap, nowSec, t)
    return { type: 'wait', headline, sub, weather: weatherNote, notice: noticeFor('wait', currentPrecip, firstGap, trend, nowSec, t) }
  }

  const isThunder = (weather?.code ?? -1) >= 95 && (weather?.code ?? -1) <= 99
  return {
    type: 'stuck',
    headline: t('STUCK'),
    sub: t(isThunder ? 's_stuck_storm' : night ? 's_night_stuck' : evening ? 's_evening_stuck' : 's_stuck'),
    weather: weatherNote,
    notice: noticeFor('stuck', currentPrecip, firstGap, trend, nowSec, t),
  }
}
