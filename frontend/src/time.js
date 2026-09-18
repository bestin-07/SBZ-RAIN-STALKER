// Single 24-hour clock formatter. Before this existed, three timestamps on the
// main screen went through three different paths — RadarMap's own hand-rolled
// padStart, RainRibbon's own copy of the same thing, and GapBanner's
// toLocaleTimeString([]), which resolves to the BROWSER's locale, not the
// app's own language — so an English-locale device showed "03:41 PM" right
// next to a "15:45" from the other two. The app is German-locale first and
// 24-hour throughout; route every clock display through this so the three
// can't drift apart again.
export function formatClock(date) {
  const d = date instanceof Date ? date : new Date(date)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
