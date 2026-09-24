import { useEffect } from 'react'

// v2.36.7 — the Archivo swap (v2.36.5) is a genuinely wider face than Space
// Grotesk, and the header title / GapBanner headline were sized assuming the
// old metrics: "GEMMA RAUS" wrapped to two lines the moment a real reading
// pushed a notification bell into the header, or a longer sub-line crowded
// the banner. Requirement is absolute — a headline must never wrap, for ANY
// string (GEMMA RAUS, BLEIB DRIN, a countdown with an arbitrary number) at ANY
// viewport width — so this is a real auto-fit, not a tuned font-size that can
// only ever be correct for today's strings on today's screens.
//
// Forces the element onto one line (`white-space: nowrap`) and, if its natural
// width exceeds what `availableWidth()` reports, scales it down uniformly via
// `transform: scale()` — never a font-size change, which would trigger a
// resize→refit→resize loop through ResizeObserver. `availableWidth` is a
// function rather than a number so callers can account for a sibling (the
// header's icon row) rather than assuming the whole parent is free.
// v2.49.2 — `enabled` false = a SENTENCE, not a headline word: it may wrap, and is
// never shrunk (the GO state's promoted tagline was being scaled to a few px tall to
// stay on one line — "the one liner is really small", live report).
export function useFitText(ref, availableWidth, deps, enabled = true) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!enabled) {
      el.style.display = ''
      el.style.whiteSpace = ''
      el.style.transform = 'none'
      return
    }
    el.style.display = 'inline-block'
    el.style.whiteSpace = 'nowrap'
    const fit = () => {
      el.style.transform = 'none'
      const natural = el.scrollWidth
      const avail = availableWidth()
      if (natural > 0 && avail > 0 && natural > avail) {
        el.style.transform = `scale(${avail / natural})`
        el.style.transformOrigin = 'left center'
      }
    }
    fit()
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', fit)
      return () => window.removeEventListener('resize', fit)
    }
    const ro = new ResizeObserver(fit)
    if (el.parentElement) ro.observe(el.parentElement)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
