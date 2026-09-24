// The expanded map's forecast frames (v2.47.1) — pure helpers, no Leaflet/DOM.
//
// The past frames are RainViewer tiles in its "Universal Blue" scheme; the future frames
// are the GeoSphere nowcast. They used to be drawn in two different colour languages, and
// the same colour meant opposite things either side of "now": beige was faint rain in a
// radar frame and DRY in a forecast frame; yellow was a downpour in radar and never
// appeared in the forecast at all (live report 2026-09-24). The forecast is now drawn on
// RainViewer's own ramp, so one colour means one thing across the whole slider.
import { DRY_THRESHOLD, DOWNPOUR_MM } from './gaps'

// RainViewer Universal Blue, dBZ -10…64 (index = dBZ + 10), RGBA, copied from RainViewer's
// published colour table (rainviewer_api_colors_table.csv) — checked against a live tile:
// every pixel of the raw scheme-2 tile is one of these values.
const UB_HEX = [
  '63615914', '66635a19', '69665c1e', '6c685d24', '6f6b5f29', '726e612e', '75706234', '78736439',
  '7c75653e', '7f786744', '827b6949', '857d6a4e', '88806c54', '8b826d59', '8e856f5e', '92887164',
  '9e93756e', 'aa9e7978', 'b6a97e82', 'c2b4828c', 'cec08796', 'd2c48ba0', 'd6c88faa', 'dacc93b4',
  'ded097be', '88ddeeff', '6cd1ebff', '51c5e8ff', '36bae5ff', '1baee2ff', '00a3e0ff', '009ad5ff',
  '0091caff', '0088bfff', '007fb4ff', '0077aaff', '0070a3ff', '00699cff', '006295ff', '005b8eff',
  '005588ff', '005180ff', '004e78ff', '004a70ff', '004768ff', 'ffee00ff', 'ffe000ff', 'ffd200ff',
  'ffc500ff', 'ffb700ff', 'ffaa00ff', 'ff9f00ff', 'ff9500ff', 'ff8b00ff', 'ff8100ff', 'ff4400ff',
  'f23600ff', 'e62800ff', 'd91b00ff', 'cd0d00ff', 'c10000ff', 'a80000ff', '8f0000ff', '760000ff',
  '5d0000ff', 'ffaaffff', 'ff9fffff', 'ff95ffff', 'ff8bffff', 'ff81ffff', 'ff77ffff', 'ff6cffff',
  'ff62ffff', 'ff58ffff', 'ff4effff',
]
const UB_MIN_DBZ = -10
const UB = UB_HEX.map(h => [0, 2, 4, 6].map(i => parseInt(h.slice(i, i + 2), 16)))

// Universal Blue turns from beige to blue at 15 dBZ and from blue to yellow at 35 dBZ.
// Those two boundaries are pinned exactly to DRY_THRESHOLD and DOWNPOUR_MM, with a log
// curve through them — within 1.7 dB of Marshall–Palmer (Z = 200·R^1.6) from
// DRY_THRESHOLD up, and under 3 dB in the trace tail below it, where it only shades the beige.
// So the same rain draws the same colour in a radar frame and a forecast frame, AND
// beige / blue / yellow mean trace / rain / downpour, as everywhere else in the app.
const LOG_SPAN = Math.log(DOWNPOUR_MM / DRY_THRESHOLD)

export function precipToDbz(p) {
  if (typeof p !== 'number' || !(p > 0)) return null
  return 15 + 20 * Math.log(p / DRY_THRESHOLD) / LOG_SPAN
}

// mm per 15 min → [r, g, b, a] on RainViewer's ramp, or null (nothing to draw: dry, or
// no data). Dry is transparent, as it is in a radar frame — never a "dry" tint.
export function nowcastRgba(p) {
  const dbz = precipToDbz(p)
  if (dbz === null) return null
  const i = Math.floor(dbz + 1e-9) - UB_MIN_DBZ
  if (i < 0) return null
  return UB[Math.min(i, UB.length - 1)]
}

// A served raster (backend _grid_to_raster): { times[], rows, cols, bounds, v[step][row*cols+col] },
// values in hundredths of a mm, -1 = no data. Anything malformed is refused whole.
export function isRaster(g) {
  if (!g || !Array.isArray(g.times) || !g.times.length || !Array.isArray(g.v)) return false
  if (!Number.isInteger(g.rows) || !Number.isInteger(g.cols) || g.rows < 1 || g.cols < 1) return false
  const b = g.bounds
  if (!Array.isArray(b) || b.length !== 2 || !b.every(c => Array.isArray(c) && c.length === 2
      && c.every(Number.isFinite))) return false
  if (g.v.length !== g.times.length) return false
  return g.v.every(step => Array.isArray(step) && step.length === g.rows * g.cols)
}

// Which forecast steps the slider shows. Only steps AFTER the newest radar frame, and
// never one wholly in the past: the nowcast is issued 15–25 min behind real time, so its
// first step (e.g. 13:15) is often OLDER than the newest radar frame (13:20) — shown, the
// slider ran backwards in time across "now" and labelled a past slot "+0 min".
export function nowcastFrames(times, newestPastTime, nowSec) {
  if (!Array.isArray(times)) return []
  const after = Math.max(Number.isFinite(newestPastTime) ? newestPastTime : -Infinity, nowSec - 450)
  return times.map((t, i) => ({ time: t, forecast: true, i })).filter(f => f.time > after)
}
