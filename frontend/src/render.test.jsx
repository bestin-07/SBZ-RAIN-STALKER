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
import RainRibbon from './components/RainRibbon'
import InfoPanel from './components/InfoPanel'
import { translations } from './i18n'

// React escapes text when it serialises; assertions have to compare like with like.
const esc = str => str
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#x27;')

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
      expect(html).toContain(t('lane_ground', { mm: '0.0' }))
      expect(html).toContain(t('lane_radar_clear'))
    })

    // THE v2.30.0 OUTAGE. `forecast` is null on the very first render, before any
    // data arrives — every read in RainRibbon's render body is written `forecast?.`
    // for that reason, and v2.30.0's new hasModelZone line was not. It threw a
    // TypeError on first paint, React unmounted the whole tree, and the app was a
    // blank page on every device until data that never got a chance to load arrived.
    //
    // The lesson this pins: the empty/initial state is a state, and a display block
    // that only ever gets tested with realistic data is untested where it breaks.
    it('RainRibbon survives the empty first render (forecast null/empty)', () => {
      expect(() => renderToStaticMarkup(
        <RainRibbon forecast={null} theme="light" t={t} unstable={false} modelRainMin={null} />)).not.toThrow()
      expect(() => renderToStaticMarkup(
        <RainRibbon forecast={{}} theme="dark" t={t} unstable={false} modelRainMin={null} />)).not.toThrow()
      expect(() => renderToStaticMarkup(
        <RainRibbon forecast={{ times: [], precips: [] }} theme="light" t={t} />)).not.toThrow()
    })

    it('every new block survives being handed nothing at all', () => {
      // Same class of bug, swept across the whole release: the initial state passes
      // null or empty into all of these before the first refresh completes.
      expect(() => renderToStaticMarkup(<SkyLine weather={null} t={t} />)).not.toThrow()
      expect(() => renderToStaticMarkup(<DayStrip daily={null} theme="light" t={t} lang={lang} />)).not.toThrow()
      expect(() => renderToStaticMarkup(<DayStrip daily={{}} theme="light" t={t} lang={lang} />)).not.toThrow()
      expect(() => renderToStaticMarkup(
        <DayStrip daily={{ time: [1, 2] }} theme="light" t={t} lang={lang} />)).not.toThrow()
      expect(() => renderToStaticMarkup(<GapBanner status={null} t={t} />)).not.toThrow()
      expect(() => renderToStaticMarkup(
        <GapBanner status={{ type: 'loading', headline: '…', sub: '' }} t={t}
                   signals={{ ground: null, radar: null, held: false, updated: null }} />)).not.toThrow()
    })

    it('the guide renders every section, with no missing strings', () => {
      // The guide is the one place a new i18n key is easy to forget, because nothing
      // in the app reads it until someone opens the panel. mkT throws on an unknown
      // key, so this fails loudly rather than rendering "guide_days_2" to a user.
      const html = renderToStaticMarkup(
        <InfoPanel open={true} onClose={() => {}} onPrivacy={() => {}} t={t} />)
      for (const k of ['guide_sky_title', 'guide_sky', 'guide_lanes_title', 'guide_lanes_1',
                       'guide_lanes_2', 'guide_lanes_3', 'guide_days_title', 'guide_days_1',
                       'guide_days_2', 'guide_days_3', 'src_daily']) {
        expect(html).toContain(esc(t(k).slice(0, 24)))
      }
      expect(renderToStaticMarkup(
        <InfoPanel open={false} onClose={() => {}} onPrivacy={() => {}} t={t} />)).toBe('')
    })

    it('carries an imprint, and the name appears ONLY there', () => {
      // An Austrian site needs an imprint (ECG §5 / MedienG §25), but the
      // maintainer asked for the name to be out of the app's voice — so the
      // support line must stay anonymous while the legal block still names them.
      const html = renderToStaticMarkup(
        <InfoPanel open={true} onClose={() => {}} onPrivacy={() => {}} t={t} />)
      expect(html).toContain(t('imprint_title'))
      expect(html).toContain('Bestin Antu')
      expect(html).toContain('Salzburg, AT')
      expect(t('made_by')).not.toMatch(/Bestin/i)
      // Exactly one mention, in the imprint — not scattered back through the copy.
      expect(html.match(/Bestin/g)).toHaveLength(1)
    })

    it('GapBanner omits the source line when nothing was read', () => {
      const status = { type: 'go', headline: 'GEMMA RAUS', sub: 'dry', weather: null }
      const html = renderToStaticMarkup(<GapBanner status={status} blocked={[]} t={t} />)
      expect(html).not.toContain(t('lane_radar_clear'))
    })
  })
}
