// Row/column lattice of the GeoSphere nowcast grid, recovered from its cells' lat/lon.
// The grid is projected (Lambert), so in lat/lon it is slightly tilted and EVERY cell
// has a unique lat and lon — one image row/column per unique value drew 960 lone
// pixels on a 960×960 raster, i.e. nothing (v2.46.1; v2.44.1/2 blamed dry weather).
// Values cluster into bands (tilt = tiny in-band gaps, 1 km step = large gap), split at
// half the largest gap: correct for any tilt under half a cell.
function bands(values) {
  const sorted = [...new Set(values)].sort((a, b) => a - b)
  const index = new Map()
  if (!sorted.length) return { index, centres: [] }
  let maxGap = 0
  for (let i = 1; i < sorted.length; i++) maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1])
  const split = maxGap / 2
  const centres = []
  let band = [sorted[0]]
  const close = () => { centres.push(band.reduce((a, b) => a + b, 0) / band.length) }
  index.set(sorted[0], 0)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > split) { close(); band = [] }
    band.push(sorted[i])
    index.set(sorted[i], centres.length)
  }
  close()
  return { index, centres }
}

// → { rows, cols, rowOf[i], colOf[i], bounds: [[south, west], [north, east]] } for
// cells[i] (row 0 = southernmost, col 0 = westernmost), or null with no cells.
export function gridLattice(cells) {
  if (!Array.isArray(cells) || !cells.length) return null
  const la = bands(cells.map(c => c.lat))
  const lo = bands(cells.map(c => c.lon))
  const rows = la.centres.length, cols = lo.centres.length
  const half = (cs, fallback) => (cs.length > 1 ? (cs[cs.length - 1] - cs[0]) / (cs.length - 1) : fallback) / 2
  const hLat = half(la.centres, 0.009), hLon = half(lo.centres, 0.0133)
  return {
    rows, cols,
    rowOf: cells.map(c => la.index.get(c.lat)),
    colOf: cells.map(c => lo.index.get(c.lon)),
    bounds: [
      [la.centres[0] - hLat, lo.centres[0] - hLon],
      [la.centres[rows - 1] + hLat, lo.centres[cols - 1] + hLon],
    ],
  }
}
