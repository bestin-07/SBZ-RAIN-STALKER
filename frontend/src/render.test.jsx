// RENDER CONTRACT — the display blocks added in v2.30 (sky line, five-day strip,
// source line) mount and produce the right markup, in BOTH languages.
//
// gaps.test.js pins what the app DECIDES; this pins that the decision reaches the
// screen. It exists because the failure mode of a display-layer change is silent:
// a missing i18n key renders as the raw key, a mis-plumbed prop renders as nothing
// at all, and neither throws. `mkT` therefore THROWS on an unknown key rather than
// falling back to it, so a translation added to only one language fails the suite.
//
// Rendered with renderToStaticMarkup — no DOM needed, so it runs in the same plain
// node environment as the rest of the suite.
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SkyLine from './components/SkyLine'
import DayStrip from './components/DayStrip'
import GapBanner from './components/GapBanner'
import { translations } from './i18n'

const mkT = lang => (key, vars = {}) => {
  let s = translations[lang][key]
  if (s === undefined) throw new Error('MISSING i18n key: ' + key)
  if (Array.isArray(s)) s = s[0]
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
  return s
}

// A realistic Europe/Vienna daily payload: 6 local midnights + hourly precip.
function daily() {
  const d0 = Math.floor(new Date('2026-09-15T00:00:00+02:00').getTime() / 1000)
  const time = Array.from({ length: 6 }, (_, i) => d0 + i * 86400)
  const htime = [], hprecip = []
  for (let d = 0; d < 6; d++) {
    for (let h = 0; h < 24; h++) {
      htime.push(d0 + d * 86400 + h * 3600)
      hprecip.push(d === 1 && h >= 14 && h < 19 ? 1.8 : 0)  // wet Tue afternoon
    }
  }
  return {
    time, htime, hprecip,
    code:  [3, 63, 80, 0, 95, 2],
    tmax:  [21, 17, 19, 23, 25, 20],
    tmin:  [12, 11, 10, 11, 14, 12],
    psum:  [0, 7.2, 2.1, 0, 5.5, 0.3],
    pprob: [35, 80, 55, 10, 65, 20],
  }
}

for (const lang of ['de', 'en']) {
  describe(`render check (${lang})`, () => {
    const t = mkT(lang)

    it('SkyLine renders the code, temp and wind', () => {
      const html = renderToStaticMarkup(<SkyLine weather={{ code: 3, temp: 19.4, wind: 11.2 }} t={t} />)
      expect(html).toContain('19°')
      expect(html).toContain('11 km/h')
      expect(html).toContain('<svg')
    })

    it('SkyLine renders nothing when there is nothing to say', () => {
      expect(renderToStaticMarkup(<SkyLine weather={null} t={t} />)).toBe('')
      expect(renderToStaticMarkup(
        <SkyLine weather={{ code: null, temp: null, wind: null }} t={t} />)).toBe('')
    })

    it('DayStrip renders five rows and names a window on a dry day', () => {
      const html = renderToStaticMarkup(<DayStrip daily={daily()} theme="light" t={t} lang={lang} />)
      expect(html).toContain(t('today_short'))
      expect((html.match(/<svg/g) || []).length).toBe(5)   // one glyph per day
      expect(html).toContain('%')
      // Wednesday is fully dry → a window must be named, and it must not be today's.
      expect(html).not.toContain(t('best_window_none'))
    })

    it('DayStrip renders nothing without data', () => {
      expect(renderToStaticMarkup(<DayStrip daily={null} theme="dark" t={t} lang={lang} />)).toBe('')
    })

    it('GapBanner source line prints both lanes', () => {
      const status = { type: 'go', headline: 'GEMMA RAUS', sub: 'dry', weather: null }
      const html = renderToStaticMarkup(
        <GapBanner status={status} blocked={[]} t={t}
                   signals={{ ground: 0, radar: 0, held: false, updated: Date.now() }} />)
      expect(html).toContain(t('src_ground', { mm: '0.0' }))
      expect(html).toContain(t('src_radar_clear'))
    })

    it('GapBanner omits the source line when nothing was read', () => {
      const status = { type: 'go', headline: 'GEMMA RAUS', sub: 'dry', weather: null }
      const html = renderToStaticMarkup(<GapBanner status={status} blocked={[]} t={t} />)
      expect(html).not.toContain(t('src_radar_clear'))
    })
  })
}
