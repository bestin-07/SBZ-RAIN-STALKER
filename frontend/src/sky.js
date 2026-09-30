// Sun and moon for the sky glyphs: when it's night, and what the moon looks like.
//
// Night is decided by the REAL sunrise and sunset for Salzburg, computed here for any
// moment. Until v2.49.4 the ribbon read only TODAY's sunrise/sunset from the daily
// forecast (so tiles after midnight never turned back into a sun, and a snapshot from
// before midnight shifted the whole day), fell back to a fixed 06:00–21:00 band when
// that hadn't loaded, and the header glyph drew a sun at any hour. Computing it has no
// data to wait for and no day to get wrong.
//
// Maths: the standard NOAA/"suncalc" solar-position approximation (sun centre 0.833°
// below the horizon = refraction + half the solar disc, the same definition weather
// services use). Checked against Open-Meteo's own times for Salzburg (within 3 min).
// The moon phase is the mean lunation from a known new moon; the real moon runs up to
// ~half a day off the mean, which moves the drawn shape by a sliver at most.

export const SALZBURG = { lat: 47.8009, lon: 13.0448 }

const RAD = Math.PI / 180
const DAY_S = 86400
const J1970 = 2440588
const J2000 = 2451545
const J0 = 0.0009
const OBLIQUITY = RAD * 23.4397

const toDays = ts => ts / DAY_S - 0.5 + J1970 - J2000
const fromJulian = j => (j + 0.5 - J1970) * DAY_S
const meanAnomaly = d => RAD * (357.5291 + 0.98560028 * d)
const eclipticLongitude = M =>
  M + RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + RAD * 102.9372 + Math.PI
const transitJ = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L)

// Sunrise and sunset (unix seconds) of the solar day whose noon is nearest `ts`.
// Null in polar day/night (never in Salzburg, but the maths shouldn't lie if moved).
export function sunTimes(ts, lat = SALZBURG.lat, lon = SALZBURG.lon) {
  const lw = -lon * RAD
  const phi = lat * RAD
  const n = Math.round(toDays(ts) - J0 - lw / (2 * Math.PI))
  const ds = J0 + lw / (2 * Math.PI) + n
  const M = meanAnomaly(ds)
  const L = eclipticLongitude(M)
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L))
  const noon = transitJ(ds, M, L)
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec))
  if (!(cosW >= -1 && cosW <= 1)) return null
  const w = Math.acos(cosW)
  const set = transitJ(J0 + (w + lw) / (2 * Math.PI) + n, M, L)
  return { sunrise: Math.round(fromJulian(noon - (set - noon))), sunset: Math.round(fromJulian(set)) }
}

// Night = the sun is below the horizon at `ts`. The nearest solar day always holds the
// answer: before its sunrise or after its sunset is night either way.
export function isNight(ts, lat = SALZBURG.lat, lon = SALZBURG.lon) {
  if (!Number.isFinite(ts)) return false
  const s = sunTimes(ts, lat, lon)
  if (!s) return false
  return ts < s.sunrise || ts > s.sunset
}

// ── Moon ────────────────────────────────────────────────────────────────────────
const SYNODIC_DAYS = 29.530588853
const NEW_MOON_REF = 947182440          // 2000-01-06 18:14 UTC, a new moon

// 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter (→ 1 = new again).
export function moonPhase(ts) {
  const cycles = (ts - NEW_MOON_REF) / DAY_S / SYNODIC_DAYS
  return cycles - Math.floor(cycles)
}

// Share of the disc that is lit, 0..1.
export const moonIllumination = phase => (1 - Math.cos(2 * Math.PI * phase)) / 2

// The lit part of the moon as an SVG path, as seen from the northern hemisphere: a
// waxing moon is lit on the RIGHT, a waning one on the LEFT. The outline runs along
// the lit limb (a half circle) and back along the terminator, an ellipse whose width
// is r·|cos 2πφ| — bulging toward the lit side for a crescent, away from it for a
// gibbous moon, and a straight line at the quarters. Null at new moon (nothing lit).
export function moonPath(phase, cx = 12, cy = 12, r = 8) {
  const k = moonIllumination(phase)
  if (k < 0.02) return null
  if (k > 0.98) return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`
  const waxing = phase < 0.5
  const crescent = k < 0.5
  const rx = +(r * Math.abs(Math.cos(2 * Math.PI * phase))).toFixed(3)
  const limb = waxing ? 1 : 0
  const term = waxing ? (crescent ? 0 : 1) : (crescent ? 1 : 0)
  return `M${cx} ${cy - r}A${r} ${r} 0 0 ${limb} ${cx} ${cy + r}A${rx} ${r} 0 0 ${term} ${cx} ${cy - r}Z`
}

// Name of the phase in eight steps (for labels and tests; the drawing is continuous).
const PHASE_NAMES = ['new', 'waxing_crescent', 'first_quarter', 'waxing_gibbous',
                     'full', 'waning_gibbous', 'last_quarter', 'waning_crescent']
export const moonPhaseName = phase => PHASE_NAMES[Math.round(phase * 8) % 8]
