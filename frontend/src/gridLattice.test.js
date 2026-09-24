import { describe, it, expect } from 'vitest'
import { gridLattice } from './gridLattice'

// Shape of the live /api/ambient nowcastGrid (measured 2026-09-24): 24 columns × 40
// rows, served column-major south→north, lon drifting -0.00324 over a column and lat
// +0.00088 along a row — so all 960 lats and all 960 lons are unique.
function liveShapedGrid() {
  const cells = []
  for (let c = 0; c < 24; c++) {
    for (let r = 0; r < 40; r++) {
      cells.push({
        lat: 47.60644 + r * 0.009 + c * (0.00088 / 23),
        lon: 12.85364 + c * 0.0133 - r * (0.00324 / 39),
        precips: [0.5], r, c,
      })
    }
  }
  return cells
}

describe('gridLattice — the tilted nowcast grid (v2.46.1)', () => {
  it('THE BUG: every lat and lon is unique, so one-row-per-value drew 0.1 % of the image', () => {
    const cells = liveShapedGrid()
    expect(new Set(cells.map(c => c.lat)).size).toBe(960)
    expect(new Set(cells.map(c => c.lon)).size).toBe(960)
  })

  it('recovers the real 40 × 24 lattice, one cell per slot', () => {
    const cells = liveShapedGrid()
    const g = gridLattice(cells)
    expect(g.rows).toBe(40)
    expect(g.cols).toBe(24)
    const slots = new Set(cells.map((_, i) => `${g.rowOf[i]},${g.colOf[i]}`))
    expect(slots.size).toBe(960)
    cells.forEach((cell, i) => {
      expect(g.rowOf[i]).toBe(cell.r)   // row 0 = south
      expect(g.colOf[i]).toBe(cell.c)   // col 0 = west
    })
  })

  it('bounds enclose every cell centre', () => {
    const cells = liveShapedGrid()
    const [[s, w], [n, e]] = gridLattice(cells).bounds
    for (const c of cells) {
      expect(c.lat).toBeGreaterThan(s); expect(c.lat).toBeLessThan(n)
      expect(c.lon).toBeGreaterThan(w); expect(c.lon).toBeLessThan(e)
    }
  })

  it('an untilted grid degrades to one band per value', () => {
    const cells = []
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) cells.push({ lat: 47 + r * 0.01, lon: 13 + c * 0.01 })
    const g = gridLattice(cells)
    expect([g.rows, g.cols]).toEqual([3, 4])
  })

  it('no cells → null; one cell → a 1 × 1 lattice', () => {
    expect(gridLattice(null)).toBeNull()
    expect(gridLattice([])).toBeNull()
    const g = gridLattice([{ lat: 47.8, lon: 13.0 }])
    expect([g.rows, g.cols, g.rowOf[0], g.colOf[0]]).toEqual([1, 1, 0, 0])
  })
})
