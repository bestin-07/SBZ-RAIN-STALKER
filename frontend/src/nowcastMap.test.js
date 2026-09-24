import { describe, it, expect } from 'vitest'
import { precipToDbz, nowcastRgba, isRaster, nowcastFrames } from './nowcastMap'
import { DRY_THRESHOLD, DOWNPOUR_MM } from './gaps'

// Universal Blue families, straight from RainViewer's table.
const isBeige = c => c && c[3] < 255 && c[0] > c[2] && c[1] > c[2]   // translucent tan
const isBlue = c => c && c[3] === 255 && c[2] > c[0]
const isYellowOrange = c => c && c[3] === 255 && c[0] === 255 && c[2] === 0

describe('nowcastRgba — forecast frames on the radar frames\' own colours (v2.47.1)', () => {
  it('THE BUG: beige meant dry in a forecast frame and faint rain in a radar frame — dry is now transparent', () => {
    expect(nowcastRgba(0)).toBeNull()
    expect(nowcastRgba(-0.01)).toBeNull()    // -1 hundredths = no data
    expect(nowcastRgba(null)).toBeNull()
    expect(nowcastRgba(undefined)).toBeNull()
  })

  it('trace (under DRY_THRESHOLD) is beige, rain is blue — the boundary sits exactly on DRY_THRESHOLD', () => {
    expect(isBeige(nowcastRgba(0.01))).toBe(true)
    expect(isBeige(nowcastRgba(0.09))).toBe(true)
    expect(isBlue(nowcastRgba(DRY_THRESHOLD))).toBe(true)
    expect(precipToDbz(DRY_THRESHOLD)).toBe(15)
  })

  it('THE BUG: a downpour drew dark blue here and yellow in radar — yellow starts exactly at DOWNPOUR_MM', () => {
    expect(isBlue(nowcastRgba(1.49))).toBe(true)
    expect(nowcastRgba(DOWNPOUR_MM)).toEqual([255, 238, 0, 255])
    expect(isYellowOrange(nowcastRgba(2.12))).toBe(true)
  })

  it('tracks Marshall–Palmer (Z = 200·R^1.6): 1.7 dB from DRY_THRESHOLD up, 3 dB in the trace tail', () => {
    const mp = p => 10 * Math.log10(200 * Math.pow(4 * p, 1.6))   // R in mm/h = 4 × mm/15 min
    for (const p of [0.1, 0.2, 0.3, 0.5, 1, 1.5, 3, 5, 10]) {
      expect(Math.abs(precipToDbz(p) - mp(p))).toBeLessThan(1.7)
    }
    for (const p of [0.01, 0.02, 0.05, 0.09]) {
      expect(Math.abs(precipToDbz(p) - mp(p))).toBeLessThan(3)
    }
  })

  it('heavier never draws lighter, and an extreme value clamps to the top of the ramp', () => {
    let prev = -Infinity
    for (let h = 1; h <= 3000; h++) {
      const d = precipToDbz(h / 100)
      expect(d).toBeGreaterThan(prev)
      prev = d
    }
    expect(nowcastRgba(500)).toEqual([255, 78, 255, 255])
  })
})

describe('isRaster — the /api/nowcast-grid payload', () => {
  const good = () => ({ times: [1, 2], rows: 2, cols: 3, bounds: [[47.45, 12.2], [48.15, 13.9]],
                        v: [[0, 0, 0, 0, 0, 0], [0, 12, -1, 0, 0, 0]] })

  it('accepts a well-formed raster', () => {
    expect(isRaster(good())).toBe(true)
  })

  it('refuses anything that would draw the wrong picture', () => {
    const bad = [
      null, {}, { ...good(), times: [] },
      { ...good(), rows: 0 }, { ...good(), cols: 2.5 },
      { ...good(), bounds: [[47.45, 12.2]] }, { ...good(), bounds: [[47.45, 'x'], [48, 13]] },
      { ...good(), v: [[0, 0, 0, 0, 0, 0]] },                        // a step missing
      { ...good(), v: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]] },       // a short step
    ]
    for (const g of bad) expect(isRaster(g)).toBe(false)
  })
})

describe('nowcastFrames — the slider never runs backwards across "now"', () => {
  const at = (hh, mm) => Date.UTC(2026, 8, 24, hh, mm) / 1000
  const times = [at(11, 15), at(11, 30), at(11, 45), at(12, 0)]

  it('THE BUG: first nowcast step (11:15) older than the newest radar frame (11:20) is dropped', () => {
    const f = nowcastFrames(times, at(11, 20), at(11, 29))
    expect(f.map(x => x.time)).toEqual([at(11, 30), at(11, 45), at(12, 0)])
    expect(f[0]).toEqual({ time: at(11, 30), forecast: true, i: 1 })   // keeps its index into the raster
  })

  it('without radar frames, a step wholly in the past is still dropped', () => {
    expect(nowcastFrames(times, undefined, at(11, 29)).map(x => x.i)).toEqual([1, 2, 3])
  })

  it('a step we are inside the first minutes of is kept', () => {
    expect(nowcastFrames(times, at(11, 10), at(11, 20)).map(x => x.i)).toEqual([0, 1, 2, 3])
  })

  it('nothing to show', () => {
    expect(nowcastFrames(null, at(11, 20), at(11, 29))).toEqual([])
    expect(nowcastFrames(times, at(12, 5), at(12, 6))).toEqual([])
  })
})
