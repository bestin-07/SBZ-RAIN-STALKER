// Sun and moon (v2.49.4): the night switch and the moon's drawn phase.
import { describe, it, expect } from 'vitest'
import { sunTimes, isNight, moonPhase, moonIllumination, moonPath, moonPhaseName } from './sky'

const at = iso => Math.floor(new Date(iso).getTime() / 1000)

describe('sunTimes — real Salzburg sunrise/sunset', () => {
  // Open-Meteo's own values for the Salzburg centre, served on /api/ambient (2026-09-30).
  const OPEN_METEO = [
    [1790744721, 1790786967],   // 2026-09-30  07:05:21 / 18:49:27 CEST
    [1790831204, 1790873243],   // 2026-10-01
    [1791177140, 1791218357],   // 2026-10-05
  ]
  it('agrees with the weather service to within 3 minutes', () => {
    for (const [rise, set] of OPEN_METEO) {
      const s = sunTimes(rise + 6 * 3600)
      expect(Math.abs(s.sunrise - rise)).toBeLessThan(180)
      expect(Math.abs(s.sunset - set)).toBeLessThan(180)
    }
  })
  it('gives the same day from any moment of that day', () => {
    expect(sunTimes(at('2026-09-30T08:00:00+02:00'))).toEqual(sunTimes(at('2026-09-30T17:00:00+02:00')))
  })
  it('follows the seasons (long June day, short December day)', () => {
    const june = sunTimes(at('2026-06-21T12:00:00+02:00'))
    const dec = sunTimes(at('2026-12-21T12:00:00+01:00'))
    expect((june.sunset - june.sunrise) / 3600).toBeGreaterThan(15.8)
    expect((dec.sunset - dec.sunrise) / 3600).toBeLessThan(8.6)
  })
})

describe('isNight', () => {
  it('switches at the real sunrise and sunset, not a fixed hour', () => {
    expect(isNight(at('2026-09-30T07:00:00+02:00'))).toBe(true)    // before 07:05
    expect(isNight(at('2026-09-30T07:10:00+02:00'))).toBe(false)
    expect(isNight(at('2026-09-30T18:45:00+02:00'))).toBe(false)   // before 18:49
    expect(isNight(at('2026-09-30T18:55:00+02:00'))).toBe(true)
    expect(isNight(at('2026-06-21T21:00:00+02:00'))).toBe(false)   // midsummer: still light at 21:00
    expect(isNight(at('2026-12-21T16:40:00+01:00'))).toBe(true)    // midwinter: dark by 16:40
  })
  it('is night all the way through midnight, and day again the next morning', () => {
    expect(isNight(at('2026-09-30T23:59:00+02:00'))).toBe(true)
    expect(isNight(at('2026-10-01T00:30:00+02:00'))).toBe(true)
    expect(isNight(at('2026-10-01T08:00:00+02:00'))).toBe(false)
  })
  it('never claims night for a missing time', () => {
    expect(isNight(NaN)).toBe(false)
    expect(isNight(undefined)).toBe(false)
  })
})

describe('moonPhase — which moon it is', () => {
  const near = (p, target) => Math.min(Math.abs(p - target), 1 - Math.abs(p - target))
  const DAY = 1 / 29.53
  it('lands on known full and new moons (to within a day)', () => {
    expect(near(moonPhase(at('2026-08-28T04:18:00Z')), 0.5)).toBeLessThan(DAY)   // full (lunar eclipse)
    expect(near(moonPhase(at('2026-09-26T16:49:00Z')), 0.5)).toBeLessThan(DAY)   // full
    expect(near(moonPhase(at('2026-08-12T17:37:00Z')), 0)).toBeLessThan(DAY)     // new (solar eclipse)
  })
  it('names the eight phases in order through one cycle', () => {
    const newMoon = at('2026-09-11T03:27:00Z')
    const names = [0.5, 4, 7.4, 11, 14.8, 18.5, 22.1, 26]
      .map(d => moonPhaseName(moonPhase(newMoon + d * 86400)))
    expect(names).toEqual(['new', 'waxing_crescent', 'first_quarter', 'waxing_gibbous',
                           'full', 'waning_gibbous', 'last_quarter', 'waning_crescent'])
  })
  it('illumination runs 0 at new, 0.5 at the quarters, 1 at full', () => {
    expect(moonIllumination(0)).toBeCloseTo(0)
    expect(moonIllumination(0.25)).toBeCloseTo(0.5)
    expect(moonIllumination(0.5)).toBeCloseTo(1)
    expect(moonIllumination(0.75)).toBeCloseTo(0.5)
  })
})

describe('moonPath — the shape that gets drawn', () => {
  it('new moon: nothing lit (only the faint disc is drawn)', () => {
    expect(moonPath(0)).toBeNull()
    expect(moonPath(0.995)).toBeNull()
  })
  it('full moon: the whole disc', () => {
    expect(moonPath(0.5, 12, 12, 8)).toBe('M4 12a8 8 0 1 0 16 0a8 8 0 1 0 -16 0Z')
  })
  it('waxing moon is lit on the right, waning on the left (seen from Salzburg)', () => {
    // limb arc sweep flag: 1 = runs through the right side, 0 = through the left
    expect(moonPath(0.1)).toMatch(/^M12 4A8 8 0 0 1 12 20/)
    expect(moonPath(0.4)).toMatch(/^M12 4A8 8 0 0 1 12 20/)
    expect(moonPath(0.6)).toMatch(/^M12 4A8 8 0 0 0 12 20/)
    expect(moonPath(0.9)).toMatch(/^M12 4A8 8 0 0 0 12 20/)
  })
  it('a crescent is thin and a gibbous is fat: the terminator bulges the right way', () => {
    const term = d => d.match(/A([\d.]+) 8 0 0 ([01]) 12 4Z$/)
    expect(term(moonPath(0.1))[2]).toBe('0')   // waxing crescent: terminator bulges right
    expect(term(moonPath(0.4))[2]).toBe('1')   // waxing gibbous: bulges left
    expect(term(moonPath(0.6))[2]).toBe('0')   // waning gibbous: bulges right
    expect(term(moonPath(0.9))[2]).toBe('1')   // waning crescent: bulges left
    expect(+term(moonPath(0.25))[1]).toBe(0)   // quarter: a straight line down the middle
    expect(+term(moonPath(0.1))[1]).toBeGreaterThan(+term(moonPath(0.2))[1])
  })
})
