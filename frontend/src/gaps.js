const DRY_THRESHOLD = 0.1
const MIN_GAP_SLOTS = 2
const LOOK_AHEAD = 3 * 3600

export function detectGaps(times, precips) {
  const now = Math.floor(Date.now() / 1000)
  const cutoff = now + LOOK_AHEAD

  const slots = times
    .map((t, i) => ({ t, p: precips[i] ?? 99 }))
    .filter(s => s.t >= now - 300 && s.t <= cutoff)

  if (!slots.length) return { currentPrecip: null, gaps: [] }

  const currentPrecip = slots[0].p

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

export function getStatus(currentPrecip, gaps, t = k => k) {
  if (currentPrecip === null) {
    return { type: 'loading', headline: t('checking'), sub: t('reading_sky') }
  }

  const isDry = currentPrecip < DRY_THRESHOLD
  const nextGap = gaps[0]

  if (isDry) {
    if (nextGap && nextGap.startsInMinutes === 0) {
      return {
        type: 'go',
        headline: t('GO_NOW'),
        sub: nextGap.opensEnded
          ? t('dry_for_over', { min: nextGap.durationMinutes })
          : t('dry_for', { min: nextGap.durationMinutes }),
      }
    }
    return {
      type: 'go',
      headline: t('GO_NOW'),
      sub: t('no_rain'),
    }
  }

  if (nextGap) {
    return {
      type: 'wait',
      headline: t('WAIT_MIN', { min: nextGap.startsInMinutes }),
      sub: t('then_clear', { min: nextGap.durationMinutes }),
    }
  }

  return {
    type: 'stuck',
    headline: t('STUCK'),
    sub: t('no_gap'),
  }
}
