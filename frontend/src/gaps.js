// mm per 15min slot — below this is walkably dry
const DRY_THRESHOLD = 0.1
// minimum consecutive dry slots to call it a gap (2 = 30 min)
const MIN_GAP_SLOTS = 2
// how far ahead to scan in seconds
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
        })
      }
      gapStart = null
      gapCount = 0
    }
  }

  // gap that runs to end of window
  if (gapStart !== null && gapCount >= MIN_GAP_SLOTS) {
    gaps.push({
      startsAt: gapStart.t,
      startsInMinutes: Math.max(0, Math.round((gapStart.t - now) / 60)),
      durationMinutes: gapCount * 15,
    })
  }

  return { currentPrecip, gaps }
}

export function getStatus(currentPrecip, gaps) {
  if (currentPrecip === null) {
    return { type: 'loading', headline: '...', sub: 'checking the sky' }
  }

  const isDry = currentPrecip < DRY_THRESHOLD
  const nextGap = gaps[0]

  if (isDry) {
    if (nextGap && nextGap.startsInMinutes === 0) {
      return {
        type: 'go',
        headline: 'GO NOW',
        sub: `dry for ${nextGap.durationMinutes} more minutes`,
      }
    }
    return {
      type: 'go',
      headline: 'GO NOW',
      sub: 'no rain at your location',
    }
  }

  if (nextGap) {
    return {
      type: 'wait',
      headline: `WAIT ${nextGap.startsInMinutes} MIN`,
      sub: `then ${nextGap.durationMinutes} minutes clear`,
    }
  }

  return {
    type: 'stuck',
    headline: 'STUCK INSIDE',
    sub: 'no gap in the next 3 hours',
  }
}
